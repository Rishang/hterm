use nix::libc;
use nix::pty::{openpty, OpenptyResult, Winsize};
use nix::sys::signal::{self, Signal};
use nix::unistd::{self, ForkResult, Pid};
use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};
use tokio::io::unix::AsyncFd;
use tokio::io::Interest;

/// A PTY session: a child shell process connected to a pseudo-terminal.
pub struct PtySession {
    master: AsyncFd<OwnedFd>,
    child_pid: Pid,
}

impl PtySession {
    /// Spawn a new shell in a PTY. Returns immediately; the child is running.
    pub fn spawn(shell: &str, cwd: &str, term_type: &str) -> io::Result<Self> {
        let OpenptyResult { master, slave } = openpty(None, None)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        match unsafe { unistd::fork() } {
            Ok(ForkResult::Child) => {
                // Child process: set up session, dup slave fd, exec shell
                drop(master);
                unsafe {
                    libc::setsid();
                    libc::ioctl(slave.as_raw_fd(), libc::TIOCSCTTY, 0);
                    libc::dup2(slave.as_raw_fd(), 0);
                    libc::dup2(slave.as_raw_fd(), 1);
                    libc::dup2(slave.as_raw_fd(), 2);
                }
                drop(slave);

                if !cwd.is_empty() {
                    let _ = std::env::set_current_dir(cwd);
                }

                let term = format!("TERM={}", term_type);
                let c_shell = CString::new(shell).unwrap();
                let c_term = CString::new(term).unwrap();

                // Collect current env + TERM override
                let mut env_vars: Vec<CString> = std::env::vars()
                    .filter(|(k, _)| k != "TERM")
                    .map(|(k, v)| CString::new(format!("{}={}", k, v)).unwrap())
                    .collect();
                env_vars.push(c_term);

                let _ = unistd::execve(&c_shell, &[&c_shell], &env_vars);
                std::process::exit(1);
            }
            Ok(ForkResult::Parent { child }) => {
                drop(slave);

                // Set master fd to non-blocking for async I/O
                let raw = master.as_raw_fd();
                let flags = unsafe { libc::fcntl(raw, libc::F_GETFL) };
                unsafe { libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) };

                let async_fd = AsyncFd::new(master)
                    .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

                Ok(PtySession {
                    master: async_fd,
                    child_pid: child,
                })
            }
            Err(e) => Err(io::Error::new(io::ErrorKind::Other, e)),
        }
    }

    /// Read from the PTY (non-blocking, async).
    pub async fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.master.ready(Interest::READABLE).await?;
            match guard.try_io(|fd| {
                let n = unsafe {
                    libc::read(
                        fd.as_raw_fd(),
                        buf.as_mut_ptr() as *mut libc::c_void,
                        buf.len(),
                    )
                };
                if n < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            }) {
                Ok(result) => return result,
                Err(_would_block) => continue,
            }
        }
    }

    /// Write data to the PTY (sends input to the shell).
    pub async fn write(&self, data: &[u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.master.ready(Interest::WRITABLE).await?;
            match guard.try_io(|fd| {
                let n = unsafe {
                    libc::write(
                        fd.as_raw_fd(),
                        data.as_ptr() as *const libc::c_void,
                        data.len(),
                    )
                };
                if n < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            }) {
                Ok(result) => return result,
                Err(_would_block) => continue,
            }
        }
    }

    /// Resize the PTY window.
    pub fn resize(&self, rows: u16, cols: u16) -> io::Result<()> {
        let ws = Winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let raw = self.master.as_raw_fd();
        let ret = unsafe { libc::ioctl(raw, libc::TIOCSWINSZ, &ws) };
        if ret < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        let _ = signal::kill(self.child_pid, Signal::SIGHUP);
        let _ = nix::sys::wait::waitpid(self.child_pid, None);
    }
}
