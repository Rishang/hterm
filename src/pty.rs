// PTY support requires a Unix-like OS.  The nix crate covers Linux, macOS,
// FreeBSD, OpenBSD, NetBSD, Solaris/illumos, and Android.
// Windows support is not yet implemented (needs ConPTY via windows-rs).
#[cfg(not(unix))]
compile_error!(
    "hterm requires a Unix-like OS (Linux, macOS, *BSD). \
     Windows PTY support is not yet implemented."
);

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
///
/// The master fd is held as a non-blocking [`AsyncFd`] so Tokio can drive
/// reads and writes without blocking the executor thread.
///
/// On [`Drop`] the child receives `SIGHUP`.  Because `SIGCHLD` is set to
/// `SIG_IGN` at startup, the kernel reaps the zombie immediately with no
/// `waitpid` required.
pub struct PtySession {
    master:    AsyncFd<OwnedFd>,
    child_pid: Pid,
}

impl PtySession {
    /// Spawn a new shell inside a fresh PTY.
    ///
    /// # Arguments
    ///
    /// * `shell`       – path to the shell executable (e.g. `/bin/bash`)
    /// * `shell_args`  – extra argv appended after `argv[0]`; populated from
    ///                   URL `?arg=` query params when `url_arg` is enabled
    /// * `cwd`         – working directory; empty means inherit from parent
    /// * `term_type`   – value for the `TERM` environment variable
    /// * `uid`         – if `Some(u)`, call `setuid(u)` in the child before exec
    /// * `gid`         – if `Some(g)`, call `setgid(g)` in the child before exec
    ///                   (applied before `uid` so the process still has privilege
    ///                   to change its own GID)
    ///
    /// # Child process sequence
    ///
    /// 1. `setsid()` — become a process-group and session leader
    /// 2. `TIOCSCTTY` — acquire the slave as the controlling terminal
    /// 3. `dup2` slave → stdin / stdout / stderr
    /// 4. optionally `chdir(cwd)`
    /// 5. optionally `setgid(gid)` then `setuid(uid)` (privilege drop)
    /// 6. `execve(shell, argv, env)` — replace image with the shell
    pub fn spawn(
        shell:      &str,
        shell_args: &[String],
        cwd:        &str,
        term_type:  &str,
        uid:        Option<u32>,
        gid:        Option<u32>,
    ) -> io::Result<Self> {
        let OpenptyResult { master, slave } = openpty(None, None)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        match unsafe { unistd::fork() }
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?
        {
            // ── Child ─────────────────────────────────────────────────────────
            ForkResult::Child => {
                // Master fd is not needed in the child; drop it so the parent
                // detects EOF when the shell exits.
                drop(master);

                unsafe {
                    // Detach from any existing session and become the leader of a new one.
                    libc::setsid();
                    // Acquire the slave as the controlling terminal.
                    libc::ioctl(slave.as_raw_fd(), libc::TIOCSCTTY, 0i32);
                    // Wire stdin / stdout / stderr to the slave PTY.
                    libc::dup2(slave.as_raw_fd(), libc::STDIN_FILENO);
                    libc::dup2(slave.as_raw_fd(), libc::STDOUT_FILENO);
                    libc::dup2(slave.as_raw_fd(), libc::STDERR_FILENO);
                }
                // The slave fd is now referenced via 0 / 1 / 2; drop the original.
                drop(slave);

                if !cwd.is_empty() {
                    if let Err(e) = std::env::set_current_dir(cwd) {
                        eprintln!("PTY: Failed to chdir to '{}': {}", cwd, e);
                        std::process::exit(1);
                    }
                }

                // ── Privilege drop ─────────────────────────────────────────────
                // GID must be dropped first while we still have the privilege to do so.
                if let Some(g) = gid {
                    let ret = unsafe { libc::setgid(g) };
                    if ret != 0 {
                        eprintln!("PTY: Failed to setgid({}): {}", g, std::io::Error::last_os_error());
                        std::process::exit(1);
                    }
                }
                if let Some(u) = uid {
                    let ret = unsafe { libc::setuid(u) };
                    if ret != 0 {
                        eprintln!("PTY: Failed to setuid({}): {}", u, std::io::Error::last_os_error());
                        std::process::exit(1);
                    }
                }

                // ── Build argv ─────────────────────────────────────────────────
                let c_shell = match CString::new(shell) {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("PTY: Shell path contains invalid characters: {}", shell);
                        std::process::exit(1);
                    }
                };

                // argv[0] is the shell path; the rest come from URL ?arg= params.
                let mut argv: Vec<CString> = Vec::with_capacity(1 + shell_args.len());
                argv.push(c_shell.clone());
                for arg in shell_args {
                    // Silently skip args that contain interior NUL bytes (they
                    // cannot be represented as C strings and would be misleading).
                    if let Ok(s) = CString::new(arg.as_str()) {
                        argv.push(s);
                    }
                }

                // ── Build envp ─────────────────────────────────────────────────
                // Inherit the full parent environment, overriding TERM.
                let c_term = CString::new(format!("TERM={}", term_type)).unwrap();
                let env_vars: Vec<CString> = std::env::vars()
                    .filter(|(k, _)| k != "TERM")
                    .map(|(k, v)| CString::new(format!("{}={}", k, v)).unwrap())
                    .chain(std::iter::once(c_term))
                    .collect();

                // execve replaces the child image; if it returns, something went
                // badly wrong — exit immediately so the master EOF fires.
                let _ = unistd::execve(&c_shell, &argv, &env_vars);
                std::process::exit(1);
            }

            // ── Parent ────────────────────────────────────────────────────────
            ForkResult::Parent { child } => {
                // Slave fd is only needed in the child; releasing it here ensures
                // the parent does not hold a reference that delays EOF propagation
                // when all child file descriptors close.
                drop(slave);

                // Set master fd non-blocking so AsyncFd can poll it without
                // blocking the Tokio executor thread.
                let raw = master.as_raw_fd();
                unsafe {
                    let flags = libc::fcntl(raw, libc::F_GETFL);
                    if flags < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    if libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                }

                let async_fd = AsyncFd::new(master)
                    .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

                Ok(PtySession { master: async_fd, child_pid: child })
            }
        }
    }

    /// Read PTY output into `buf` (async, non-blocking).
    ///
    /// Returns the number of bytes read, or an error if the shell has exited
    /// (typically `EIO` on Linux once all slave-side fds close).
    pub async fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.master.ready(Interest::READABLE).await?;
            match guard.try_io(|fd| {
                let n = unsafe {
                    libc::read(fd.as_raw_fd(), buf.as_mut_ptr() as *mut libc::c_void, buf.len())
                };
                if n < 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
            }) {
                Ok(result) => return result,
                Err(_would_block) => continue,
            }
        }
    }

    /// Write `data` to the PTY master, delivering it to the shell as if typed.
    pub async fn write(&self, data: &[u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.master.ready(Interest::WRITABLE).await?;
            match guard.try_io(|fd| {
                let n = unsafe {
                    libc::write(fd.as_raw_fd(), data.as_ptr() as *const libc::c_void, data.len())
                };
                if n < 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
            }) {
                Ok(result) => return result,
                Err(_would_block) => continue,
            }
        }
    }

    /// Resize the PTY window (columns × rows).
    ///
    /// The kernel sends `SIGWINCH` to the shell's foreground process group
    /// automatically — no manual signal needed.
    pub fn resize(&self, rows: u16, cols: u16) -> io::Result<()> {
        let ws = Winsize { ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0 };
        let ret = unsafe { libc::ioctl(self.master.as_raw_fd(), libc::TIOCSWINSZ, &ws) };
        if ret < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Send SIGHUP to ask the shell to terminate gracefully.
        // Tokio's runtime will handle reaping the child process.
        let _ = signal::kill(self.child_pid, Signal::SIGHUP);
    }
}