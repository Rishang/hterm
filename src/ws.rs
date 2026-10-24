use axum::extract::ws::{CloseFrame, Message, WebSocket};
use axum::extract::{RawQuery, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use bytes::{Bytes, BytesMut};
use futures::{SinkExt, StreamExt};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time;

use crate::config::AppConfig;
use crate::pty::PtySession;

// ── Binary protocol constants (must match TermTab.svelte) ─────────────────────
const MSG_INPUT: u8 = 0; // client → server: keystroke data
const MSG_OUTPUT: u8 = 1; // server → client: PTY output
const MSG_RESIZE: u8 = 2; // client → server: terminal resize (cols u16 BE, rows u16 BE)
                          // 3 is reserved for the error frame the browser renders inline.
const MSG_CWD: u8 = 4; // server → client: shell working directory (UTF-8 path)
const MSG_ECHO_ACK: u8 = 5; // server → client: input frames answered (u32 BE), input hidden (u8)
const MSG_SESSION: u8 = 6; // server → client: flags (u8), heartbeat secs (u16 BE), replay offset (u64 BE), input frames applied (u64 BE), session id
const MSG_CLOSE: u8 = 7; // client → server: end this shell (its tab was closed)
const MSG_HEARTBEAT: u8 = 8; // both ways: keeps proxies and tunnels from idling the socket out
const MSG_REPLAY: u8 = 9; // server → client: output replayed on a reattach; its queries were answered already

/// `MSG_SESSION` flags.
const SESSION_RESUMED: u8 = 1; // an existing shell was reattached
const SESSION_OUTPUT_LOST: u8 = 2; // part of the output after the client's offset is gone

/// Close code for a connection whose session was attached elsewhere: the
/// browser doesn't reconnect, or two windows would keep taking it from each other.
const CLOSE_TAKEN_OVER: u16 = 4001;

// ── Tuning ────────────────────────────────────────────────────────────────────

/// PTY read buffer.  8 KiB halves syscall count vs. 4 KiB on heavy output
/// while staying well inside one 16 KiB coalesce window.
const PTY_BUF_SIZE: usize = 8 * 1024;

/// Maximum time to accumulate PTY output before flushing a WebSocket frame.
const COALESCE_WINDOW: Duration = Duration::from_millis(1);

/// Flush immediately once coalesced data reaches this size.
const MAX_COALESCE_SIZE: usize = 16 * 1024;

/// Output kept per session for a reattach: what a reconnecting browser missed,
/// or the whole screen after a page reload.
const OUTPUT_LOG_SIZE: usize = 2 * 1024 * 1024;

/// A connection that sends nothing (not even heartbeat replies) for this many
/// heartbeat intervals is dead: it detaches, so its shell can expire.
const HEARTBEAT_MISSES: u32 = 3;

/// Outbound message channel depth (writer task).  Kept small so a slow link
/// backpressures the PTY (and the shell) instead of queueing seconds of output
/// ahead of keystroke echoes: worst case 4 × 16 KiB = 64 KiB per session.
const WS_OUT_CAP: usize = 4;

/// How long the shell gets to answer a keystroke before the browser is told
/// it was answered (mosh uses the same 50 ms). Output it produced in that time
/// is sent ahead of the acknowledgement, so the browser's local echo knows the
/// screen is up to date.
const ECHO_WAIT: Duration = Duration::from_millis(50);

/// Inbound command channel depth. Keep this large enough that short paste/input
/// bursts do not block the WebSocket reader while PTY output is busy.
const PTY_CMD_CAP: usize = 64;

// ─────────────────────────────────────────────────────────────────────────────

/// Shared application state held in an `Arc` by every connection handler.
pub struct AppState {
    pub config: Arc<AppConfig>,

    /// Number of currently connected clients.
    pub client_count: std::sync::atomic::AtomicU32,

    /// Send `true` to trigger a graceful server shutdown.
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,

    /// Pre-built `"Basic <base64(user:pass)>"` string for O(1) Basic Auth
    /// comparison on each WebSocket upgrade.  `None` when auth is disabled.
    pub expected_auth: Option<String>,

    /// Optional custom index.html loaded once at startup.
    pub custom_index: Option<&'static [u8]>,

    /// Shells kept across connections, for reattaching.
    pub term_sessions: TermSessions,

    /// Active MCP SSE channels.
    ///
    /// Uses a `std::sync::RwLock` because the lock is never held across `.await`
    /// points — only quick insert/remove/lookup operations.  This avoids the
    /// overhead of tokio's async lock machinery.
    pub mcp_transmitters:
        std::sync::RwLock<std::collections::HashMap<String, tokio::sync::mpsc::Sender<axum::response::sse::Event>>>,

    /// Active file-explorer watch sessions, mapping session id to the channel
    /// that updates which directories that session watches. Removing an entry
    /// closes the channel, which stops the watcher task and releases its inotify
    /// watches. Same `std::sync::RwLock` rationale as `mcp_transmitters`.
    pub watch_sessions: std::sync::RwLock<std::collections::HashMap<String, tokio::sync::mpsc::Sender<Vec<String>>>>,

    /// Persistent language-server sessions used by the file editor. The lock is
    /// only held for synchronous pool bookkeeping, never across process I/O.
    pub lsp: std::sync::Mutex<crate::lsp::LspManager>,
}

/// What the browser's local echo is told about input (`MSG_ECHO_ACK`): how
/// many input frames the shell has had `ECHO_WAIT` to answer, and whether the
/// program reading the terminal hides input (a password prompt).
#[derive(Default)]
struct EchoAck {
    /// Input frames written to the PTY.
    received: u32,
    received_at: Option<time::Instant>,
    /// The next acknowledgement: when it is due, and the frame count it covers.
    due: Option<(time::Instant, u32)>,
    acked: u32,
    hidden: bool,
}

impl EchoAck {
    fn on_input(&mut self) {
        let now = time::Instant::now();
        self.received = self.received.wrapping_add(1);
        self.received_at = Some(now);
        self.due.get_or_insert((now + ECHO_WAIT, self.received));
    }

    fn due_at(&self) -> Option<time::Instant> {
        self.due.map(|(at, _)| at)
    }

    /// Acknowledge the input that is due, and schedule the input received since.
    fn ack_due(&mut self) {
        if let Some((_, seq)) = self.due.take() {
            self.acked = seq;
        }
        if let (true, Some(at)) = (self.received != self.acked, self.received_at) {
            self.due = Some((at + ECHO_WAIT, self.received));
        }
    }

    fn frame(&mut self, hidden: bool) -> Message {
        self.hidden = hidden;
        let mut frame = BytesMut::with_capacity(6);
        frame.extend_from_slice(&[MSG_ECHO_ACK]);
        frame.extend_from_slice(&self.acked.to_be_bytes());
        frame.extend_from_slice(&[hidden as u8]);
        Message::Binary(frame.freeze())
    }
}

/// Commands forwarded from the WebSocket reader task to the PTY owner task.
enum PtyCmd {
    /// Keystroke data from connection `conn` — a zero-copy slice of the
    /// incoming binary frame.
    Input { conn: u64, data: Bytes },
    /// Terminal resize: (cols, rows).
    Resize(u16, u16),
    /// Connection `conn` takes over the session. `offset` is how many bytes
    /// of output a reattaching client already has; `None` for a new shell.
    Attach { conn: u64, out: mpsc::Sender<Message>, offset: Option<u64> },
    /// Connection `conn` closed: keep the shell for a reattach.
    Detach(u64),
    /// The client ended the session on purpose (closed its tab).
    Close,
}

// ── WebSocket upgrade handler ─────────────────────────────────────────────────

/// axum handler for `GET /ws`.
///
/// Performs authentication, rate-limiting, and origin checks before handing
/// the connection off to [`handle_socket`].
///
/// URL query parameters of the form `?arg=foo&arg=bar` are extracted here and
/// forwarded to the shell's argv when `url_arg` is enabled in config.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    RawQuery(query): RawQuery,
    uri: axum::http::Uri,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = &state.config;

    // ── Authentication ────────────────────────────────────────────────────────
    // Shared with REST/MCP/LSP so the rule lives in one place. Plain 401: a
    // WebSocket client cannot answer a Basic challenge.
    if !crate::tools::check_auth(&state, &headers) {
        tracing::warn!("WebSocket upgrade rejected: not authenticated");
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // ── Origin check ──────────────────────────────────────────────────────────
    // Always on: browsers apply no CORS to WebSockets, so this is the only thing
    // stopping any website from opening a shell here with the user's cached
    // credentials. Runs before a client slot is taken so rejects cannot leak it.
    let origin = headers.get(axum::http::header::ORIGIN).and_then(|v| v.to_str().ok());
    let host = crate::tools::request_host(&headers, &uri);
    if !origin_allowed(cfg, origin, host) {
        tracing::warn!(origin, host, "WebSocket upgrade rejected: origin mismatch");
        return StatusCode::FORBIDDEN.into_response();
    }

    // ── Reattach, or a new shell within the client limit / once mode ────────
    // A session belongs to the proxy-auth user who started it.
    let user = crate::tools::proxy_user(cfg, &headers);
    let query = query.as_deref().unwrap_or("");
    let resume = parse_resume(query).and_then(|(id, offset)| {
        let cmds = state.term_sessions.find(&id, user.as_deref())?;
        Some(Target::Resume { cmds, offset })
    });
    let target = match resume {
        Some(target) => target,
        None => match ClientSlot::acquire(&state) {
            Some(slot) => Target::New(slot),
            None => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        },
    };

    // ── URL arg passthrough ───────────────────────────────────────────────────
    // Decode repeated `?arg=<value>` pairs from the query string and pass them
    // as extra shell argv entries.  Only active when `url_arg = true`.
    //
    // Example: `ws://host/ws?arg=-c&arg=ls%20-la`
    //   → execve("/bin/bash", ["/bin/bash", "-c", "ls -la"], env)
    // Extra argv is command execution, so read-only mode never honours it
    // (startup also clears `url_arg` without `writable`; checked here too).
    let url_args: Vec<String> = if cfg.url_arg && cfg.writable { parse_url_args(query) } else { vec![] };

    // A failed handshake drops this callback, and with it the slot.
    ws.on_upgrade(move |socket| handle_socket(socket, state, target, user, url_args)).into_response()
}

/// Whether a WebSocket upgrade may proceed. A browser always sends `Origin`,
/// so a present one must name this server: its authority equals `Host`, or its
/// host name is in `allowed_hosts` (e.g. `localhost` for the Vite dev server).
/// Browsers omit the scheme's default port from `Origin` while some proxies add
/// it to `Host` (`$host:$server_port`), so it is ignored on both sides.
/// Opaque origins (`null`) fail. A missing `Origin` means a non-browser client,
/// which cannot ride the user's credentials; `check_origin` rejects it too.
fn origin_allowed(cfg: &AppConfig, origin: Option<&str>, host: Option<&str>) -> bool {
    let Some(origin) = origin else { return !cfg.check_origin };
    let Some((scheme, authority)) = origin.split_once("://") else { return false };
    let default_port = if scheme.eq_ignore_ascii_case("https") { ":443" } else { ":80" };
    let authority_name = authority.strip_suffix(default_port).unwrap_or(authority);
    if host.is_some_and(|h| authority_name.eq_ignore_ascii_case(h.strip_suffix(default_port).unwrap_or(h))) {
        return true;
    }
    let name = match authority.rsplit_once(':') {
        Some((name, port)) if !port.contains(']') => name,
        _ => authority,
    };
    cfg.allowed_hosts.iter().any(|h| name.eq_ignore_ascii_case(h))
}

/// One reserved terminal slot in `client_count`. Released on drop, so every
/// exit path (failed handshake, PTY spawn error, session end) gives it back.
struct ClientSlot(Arc<AppState>);

impl ClientSlot {
    /// Atomically reserves a slot, or `None` when `max_clients` or `once` is
    /// already satisfied.
    fn acquire(state: &Arc<AppState>) -> Option<Self> {
        let cfg = &state.config;
        let previous = state.client_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let slot = Self(Arc::clone(state));
        if (cfg.max_clients > 0 && previous >= cfg.max_clients) || (cfg.once && previous > 0) {
            return None; // `slot` drops here and reverts the increment
        }
        Some(slot)
    }
}

impl Drop for ClientSlot {
    fn drop(&mut self) {
        self.0.client_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

// ── Session handler ───────────────────────────────────────────────────────────

/// Shells kept across connections, so a dropped connection or a page reload
/// reattaches to the same shell. Keyed by an unguessable session id.
#[derive(Default)]
pub struct TermSessions(std::sync::Mutex<HashMap<String, SessionEntry>>);

struct SessionEntry {
    cmds: mpsc::Sender<PtyCmd>,
    /// The proxy-auth user who started it: an id seen in a proxy's access
    /// log is no use to anyone else.
    user: Option<String>,
}

impl TermSessions {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionEntry>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The session `id`, when it is still running and `user` started it.
    fn find(&self, id: &str, user: Option<&str>) -> Option<mpsc::Sender<PtyCmd>> {
        self.lock().get(id).filter(|e| e.user.as_deref() == user).map(|e| e.cmds.clone())
    }
}

/// Source of connection ids, so a late `Detach` from a connection that was
/// taken over can't detach its successor.
static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

/// Which shell a new connection attaches to.
enum Target {
    /// A new shell, holding the client slot it was admitted with.
    New(ClientSlot),
    /// A running shell, and how many bytes of its output the client already
    /// has (0 after a page reload: replay everything kept).
    Resume { cmds: mpsc::Sender<PtyCmd>, offset: u64 },
}

/// Handle one WebSocket connection.
///
/// ### Task topology
///
/// ```text
/// ws_reader ──[PtyCmd]──► session ──[Message]──► writer ──► ws_sink
/// per connection          owns the PTY;           per connection
///                         outlives connections
/// ```
///
/// The session task ([`run_session`]) owns the `PtySession` and keeps running
/// when the connection drops, so the browser can reattach. This function only
/// bridges one connection to it.
async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    target: Target,
    user: Option<String>,
    url_args: Vec<String>,
) {
    let writable = state.config.writable;
    let (cmds, offset) = match target {
        Target::Resume { cmds, offset } => (cmds, Some(offset)),
        Target::New(slot) => match start_session(&state, slot, user, &url_args) {
            Some(cmds) => (cmds, None),
            None => return, // dropping the socket closes it
        },
    };

    let (mut ws_sink, mut ws_stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(WS_OUT_CAP);
    let conn = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    // The session holds the only sender from here on: when the shell ends, or
    // another connection takes the session over, the writer sees the channel
    // close and closes this socket.
    if cmds.send(PtyCmd::Attach { conn, out: out_tx, offset }).await.is_err() {
        return;
    }

    // ── Writer: owns ws_sink exclusively — zero lock contention ──────────────
    let mut writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
        // Send a clean WebSocket close frame after draining the outbound queue.
        let _ = ws_sink.close().await;
    });

    // ── WS reader: minimal work — parse frames, forward PtyCmd ───────────────
    let reader_cmds = cmds.clone();
    let silence_limit = Duration::from_secs(state.config.ping_interval.max(1)) * HEARTBEAT_MISSES;
    let mut ws_reader = tokio::spawn(async move {
        // The browser answers every heartbeat, so silence means the connection
        // died without a close (common through tunnels).
        while let Ok(Some(Ok(msg))) = time::timeout(silence_limit, ws_stream.next()).await {
            let cmd = match msg {
                Message::Binary(data) if !data.is_empty() => match data[0] {
                    // `Bytes::slice` is zero-copy (refcount bump + offset adjust).
                    MSG_INPUT if writable && data.len() > 1 => PtyCmd::Input { conn, data: data.slice(1..) },
                    MSG_RESIZE if data.len() >= 5 => {
                        let cols = u16::from_be_bytes([data[1], data[2]]);
                        let rows = u16::from_be_bytes([data[3], data[4]]);
                        if cols > 0 && rows > 0 {
                            // Resize is idempotent; best-effort, skip if the
                            // channel is full rather than blocking the reader.
                            let _ = reader_cmds.try_send(PtyCmd::Resize(cols, rows));
                        }
                        continue;
                    }
                    MSG_CLOSE => PtyCmd::Close,
                    _ => continue,
                },
                Message::Close(_) => break,
                _ => continue,
            };
            if reader_cmds.send(cmd).await.is_err() {
                break;
            }
        }
    });

    // ── Wait for whichever side finishes first ────────────────────────────────
    let client_left = tokio::select! {
        _ = &mut writer    => { ws_reader.abort(); false } // shell ended, or taken over
        _ = &mut ws_reader => true,                       // client disconnected
    };
    // A client that went silent can leave the writer stuck sending into a
    // dead connection for minutes; stop it so the session isn't held up
    // behind it. Then keep the shell for a reattach (a no-op when it already
    // moved on).
    if client_left {
        writer.abort();
    }
    let _ = cmds.send(PtyCmd::Detach(conn)).await;
}

/// Spawn a shell and the session task that owns it, and register it for
/// reattaching. Returns the session's command channel.
fn start_session(
    state: &Arc<AppState>,
    slot: ClientSlot,
    user: Option<String>,
    url_args: &[String],
) -> Option<mpsc::Sender<PtyCmd>> {
    let cfg = &state.config;
    let pty = match PtySession::spawn(&cfg.shell, url_args, &cfg.cwd, &cfg.terminal_type, cfg.uid, cfg.gid) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("PTY spawn failed: {}", e);
            return None; // dropping `slot` releases the count
        }
    };
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (cmds, cmd_rx) = mpsc::channel::<PtyCmd>(PTY_CMD_CAP);
    state.term_sessions.lock().insert(id.clone(), SessionEntry { cmds: cmds.clone(), user });

    // `slot` already counts this session; just read the total for logging.
    let count = state.client_count.load(Ordering::Relaxed);
    tracing::info!(shell = %cfg.shell, url_args = ?url_args, sessions = count, "Terminal session started");
    tokio::spawn(run_session(pty, id, cmd_rx, Arc::clone(state), slot));
    Some(cmds)
}

/// The life of one shell, across connections: it ends when the shell exits,
/// the client closes it on purpose (`MSG_CLOSE`, closing its tab), or nobody
/// reattached within `detach_timeout`.
async fn run_session(
    pty: PtySession,
    id: String,
    mut cmd_rx: mpsc::Receiver<PtyCmd>,
    state: Arc<AppState>,
    slot: ClientSlot,
) {
    let cfg = &state.config;
    let mut session = Session {
        pty,
        id,
        out: None,
        detached_at: None, // the connection that started it attaches next
        detach_timeout: Duration::from_secs(cfg.detach_timeout),
        log: OutputLog::default(),
        coalesce: BytesMut::with_capacity(MAX_COALESCE_SIZE + 1),
        echo: EchoAck::default(),
        last_cwd: String::new(),
        heartbeat: Duration::from_secs(cfg.ping_interval.max(1)),
        inputs: 0,
    };
    session.coalesce.extend_from_slice(&[MSG_OUTPUT]);
    session.run(&mut cmd_rx).await;

    state.term_sessions.lock().remove(&session.id);
    drop(session); // hangs up the shell; a still attached socket closes
    drop(slot);
    let remaining = state.client_count.load(Ordering::SeqCst);
    tracing::info!(sessions = remaining, "Terminal session ended");

    if cfg.once || (cfg.exit_no_conn && remaining == 0) {
        let reason = if cfg.once { "--once" } else { "--exit-no-conn" };
        tracing::info!("Initiating shutdown ({})", reason);
        let _ = state.shutdown_tx.send(true);
    }
}

/// One shell and the connection attached to it, if any. See [`run_session`].
struct Session {
    pty: PtySession,
    id: String,
    /// The attached connection's id and outbound queue; `None` while detached.
    out: Option<(u64, mpsc::Sender<Message>)>,
    /// When the session was last left without a connection.
    detached_at: Option<time::Instant>,
    detach_timeout: Duration,
    log: OutputLog,
    /// Output read but not flushed yet, behind the `MSG_OUTPUT` type byte so
    /// each flush is a single Binary frame with no header copy.
    coalesce: BytesMut,
    echo: EchoAck,
    last_cwd: String,
    heartbeat: Duration,
    /// Input frames written to the shell, across connections: a reattaching
    /// browser resends the ones after this.
    inputs: u64,
}

impl Session {
    /// Reads PTY output with a 1 ms coalesce window (up to 16 KiB per frame),
    /// applies commands, sends echo acks and heartbeats while attached, and
    /// ends a session left detached for too long — all in one task.
    async fn run(&mut self, cmd_rx: &mut mpsc::Receiver<PtyCmd>) {
        let mut buf = [0u8; PTY_BUF_SIZE];
        let mut ping_ticker = time::interval(self.heartbeat);
        // Default `Burst` would fire every tick missed during heavy output back to
        // back, filling the small outbound queue with pings instead of output.
        ping_ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
        ping_ticker.tick().await; // discard the immediate first tick

        'outer: loop {
            let expires = self.detached_at.map(|at| at + self.detach_timeout);
            let attached = self.out.is_some();
            tokio::select! {
                biased;

                // ── Client → PTY (keystrokes / resize / attach) ──────────────
                cmd = cmd_rx.recv() => {
                    if self.apply(cmd).await { break; }
                },

                // ── PTY → client (hot path) ───────────────────────────────────
                res = self.pty.read(&mut buf) => match res {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        self.coalesce.extend_from_slice(&buf[..n]);

                        // Accumulate further output within COALESCE_WINDOW before
                        // flushing, up to MAX_COALESCE_SIZE.  The sleep is pinned
                        // once per outer read, not re-created per inner iteration.
                        if self.coalesce.len() < MAX_COALESCE_SIZE {
                            let deadline = time::sleep(COALESCE_WINDOW);
                            tokio::pin!(deadline);

                            'inner: loop {
                                tokio::select! {
                                    biased;
                                    cmd = cmd_rx.recv() => {
                                        if self.apply(cmd).await { break 'outer; }
                                    },
                                    res = self.pty.read(&mut buf) => match res {
                                        Ok(0) | Err(_) => {
                                            self.flush(cmd_rx).await;
                                            break 'outer;
                                        }
                                        Ok(n) => {
                                            self.coalesce.extend_from_slice(&buf[..n]);
                                            if self.coalesce.len() >= MAX_COALESCE_SIZE {
                                                break 'inner;
                                            }
                                        }
                                    },
                                    _ = &mut deadline => break 'inner,
                                }
                            }
                        }

                        if self.flush(cmd_rx).await { break; }
                        self.report_state().await;
                    }
                },

                // ── Echo acknowledgement: after any output read above (biased) ──
                _ = time::sleep_until(self.echo.due_at().unwrap_or_else(time::Instant::now)),
                    if attached && self.echo.due_at().is_some() => {
                    self.echo.ack_due();
                    let msg = self.echo.frame(self.pty.hides_input());
                    self.send(msg).await;
                },

                // ── Heartbeat (merged here — avoids another task) ────────────
                // A data frame, not a WebSocket ping: tunnels that only count
                // traffic inside the socket close it after a quiet spell
                // otherwise, and the browser can't see pings to notice a dead
                // connection. A full queue means frames are already flowing,
                // so skip it rather than block keystrokes behind it.
                _ = ping_ticker.tick(), if attached => {
                    let closed = self.out.as_ref().is_some_and(|(_, tx)| {
                        let beat = Message::Binary(Bytes::from_static(&[MSG_HEARTBEAT]));
                        matches!(tx.try_send(beat), Err(mpsc::error::TrySendError::Closed(_)))
                    });
                    if closed { self.detach(); }
                },

                // ── Nobody reattached in time ─────────────────────────────────
                _ = time::sleep_until(expires.unwrap_or_else(time::Instant::now)), if expires.is_some() => {
                    tracing::info!("Detached terminal session expired");
                    break;
                },
            }
        }
    }

    /// Apply one command. Returns `true` if the session should end.
    async fn apply(&mut self, cmd: Option<PtyCmd>) -> bool {
        match cmd {
            // `None`: impossible while registered, since the registry holds a sender.
            None | Some(PtyCmd::Close) => true,
            Some(PtyCmd::Input { conn, data }) => {
                // Input still in flight from a connection that was replaced:
                // the browser resends what the session hasn't counted.
                if !self.out.as_ref().is_some_and(|(c, _)| *c == conn) {
                    return false;
                }
                if let Err(e) = self.pty.write(&data).await {
                    tracing::error!("PTY write error: {}", e);
                    return true;
                }
                self.inputs += 1;
                self.echo.on_input();
                false
            }
            Some(PtyCmd::Resize(cols, rows)) => {
                if let Err(e) = self.pty.resize(rows, cols) {
                    // Non-fatal: the terminal just won't reflow until the next resize.
                    tracing::warn!("PTY resize error: {}", e);
                }
                false
            }
            Some(PtyCmd::Attach { conn, out, offset }) => {
                self.attach(conn, out, offset).await;
                false
            }
            Some(PtyCmd::Detach(conn)) => {
                if self.out.as_ref().is_some_and(|(c, _)| *c == conn) {
                    self.detach();
                }
                false
            }
        }
    }

    /// A connection takes over the session. The previous one, if any (the
    /// same session opened elsewhere, or a connection that hasn't noticed it
    /// dropped), is told why and closed. The client first learns which
    /// session this is, then gets the output it doesn't have yet.
    async fn attach(&mut self, conn: u64, out: mpsc::Sender<Message>, offset: Option<u64>) {
        let resumed = offset.is_some();
        if let Some((_, previous)) = self.out.take() {
            // Behind the output still queued for it, without holding up the
            // session. Dropped, the old window would see a plain close,
            // reconnect, and take the session back.
            let frame = CloseFrame { code: CLOSE_TAKEN_OVER, reason: "attached elsewhere".into() };
            tokio::spawn(async move {
                let _ = previous.send(Message::Close(Some(frame))).await;
            });
        }
        self.out = Some((conn, out));
        self.detached_at = None;
        self.echo = EchoAck::default(); // input frames are numbered per connection
        self.last_cwd.clear();

        let offset = offset.unwrap_or(0);
        let (start, missed, lost) = self.log.since(offset);
        let flags = if resumed { SESSION_RESUMED } else { 0 } | if lost { SESSION_OUTPUT_LOST } else { 0 };
        let heartbeat = u16::try_from(self.heartbeat.as_secs()).unwrap_or(u16::MAX);
        let mut frame = BytesMut::with_capacity(self.id.len() + 20);
        frame.extend_from_slice(&[MSG_SESSION, flags]);
        frame.extend_from_slice(&heartbeat.to_be_bytes());
        // Where the replay starts in the session's output, for the client's next offset.
        frame.extend_from_slice(&start.to_be_bytes());
        frame.extend_from_slice(&self.inputs.to_be_bytes());
        frame.extend_from_slice(self.id.as_bytes());
        self.send(Message::Binary(frame.freeze())).await;
        for chunk in missed.chunks(MAX_COALESCE_SIZE) {
            let mut frame = BytesMut::with_capacity(chunk.len() + 1);
            frame.extend_from_slice(&[MSG_REPLAY]);
            frame.extend_from_slice(chunk);
            self.send(Message::Binary(frame.freeze())).await;
        }
        // A replay with a gap may have missed the start of a full-screen
        // program (vim, htop), and a page reload starts from an empty screen:
        // make the program redraw itself, as shpool does.
        if resumed && (lost || (offset == 0 && self.log.in_alternate_screen())) {
            self.pty.nudge_redraw();
        }
        self.report_state().await;
    }

    fn detach(&mut self) {
        if self.out.take().is_some() {
            self.detached_at = Some(time::Instant::now());
        }
    }

    /// Send a frame to the attached connection, if any; a closed one detaches.
    async fn send(&mut self, msg: Message) {
        let closed = match &self.out {
            Some((_, tx)) => tx.send(msg).await.is_err(),
            None => false,
        };
        if closed {
            self.detach();
        }
    }

    /// Record the coalesced output for a reattach and send it to the attached
    /// connection.
    ///
    /// While the outbound queue is full (client slower than the shell),
    /// keystrokes keep being applied so Ctrl+C reaches the shell without
    /// waiting for the backlog to drain.
    ///
    /// Returns `true` if the session should end.
    async fn flush(&mut self, cmd_rx: &mut mpsc::Receiver<PtyCmd>) -> bool {
        if self.coalesce.len() <= 1 {
            return false;
        }
        let payload = self.coalesce.split().freeze();
        self.coalesce.reserve(MAX_COALESCE_SIZE + 1);
        self.coalesce.extend_from_slice(&[MSG_OUTPUT]);
        self.log.push(&payload[1..]);
        loop {
            let Some((conn, tx)) = self.out.clone() else { return false };
            tokio::select! {
                biased;
                cmd = cmd_rx.recv() => {
                    if self.apply(cmd).await { return true; }
                    // A connection that attached meanwhile got this output from the log.
                    if self.out.as_ref().map(|(c, _)| *c) != Some(conn) { return false; }
                },
                permit = tx.reserve() => {
                    match permit {
                        Ok(p) => p.send(Message::Binary(payload)),
                        Err(_) => self.detach(),
                    }
                    return false;
                },
            }
        }
    }

    /// After output (the moment a command can have finished, or a password
    /// prompt turned echo off), tell the attached client what changed: the
    /// shell's working directory, and whether input is hidden.
    async fn report_state(&mut self) {
        if self.out.is_none() {
            return;
        }
        if let Some(msg) = cwd_frame(&self.pty, &mut self.last_cwd) {
            self.send(msg).await;
        }
        let hidden = self.pty.hides_input();
        if hidden != self.echo.hidden {
            let msg = self.echo.frame(hidden);
            self.send(msg).await;
        }
    }
}

/// Output kept for a reattach: the latest `OUTPUT_LOG_SIZE` bytes, and how
/// many bytes the session has produced in all (clients count in the same unit).
struct OutputLog {
    buf: VecDeque<u8>,
    total: u64,
}

impl Default for OutputLog {
    /// Allocated once at full size: pages are only touched as output fills
    /// it, and it never regrows, so a session holds at most `OUTPUT_LOG_SIZE`.
    fn default() -> Self {
        Self { buf: VecDeque::with_capacity(OUTPUT_LOG_SIZE), total: 0 }
    }
}

impl OutputLog {
    fn push(&mut self, data: &[u8]) {
        let excess = (self.buf.len() + data.len()).saturating_sub(OUTPUT_LOG_SIZE);
        self.buf.drain(..excess.min(self.buf.len()));
        self.buf.extend(&data[data.len().saturating_sub(OUTPUT_LOG_SIZE)..]);
        self.total += data.len() as u64;
    }

    /// The output after its first `offset` bytes: where in the output the
    /// replay starts, the bytes, and whether part of what was asked for was
    /// already dropped. A replay with a gap starts at the next line, not in the
    /// middle of an escape sequence or a UTF-8 character.
    fn since(&self, offset: u64) -> (u64, Vec<u8>, bool) {
        let kept_from = self.total - self.buf.len() as u64;
        let (skip, lost) = if offset >= kept_from {
            ((offset.min(self.total) - kept_from) as usize, false)
        } else {
            (self.buf.iter().position(|&b| b == b'\n').map_or(self.buf.len(), |i| i + 1), true)
        };
        (kept_from + skip as u64, self.buf.range(skip..).copied().collect(), lost)
    }

    /// Whether the kept output last switched to the alternate screen (a
    /// full-screen program still running) rather than back.
    fn in_alternate_screen(&self) -> bool {
        const MODES: [&[u8]; 3] = [b"\x1b[?1049", b"\x1b[?1047", b"\x1b[?47"];
        let (front, back) = self.buf.as_slices();
        // Scanning is rare (a page reload), so one contiguous copy is fine.
        let log = [front, back].concat();
        let mut last = None;
        for i in (0..log.len()).filter(|&i| log[i] == 0x1b) {
            if let Some(mode) = MODES.iter().find(|m| log[i..].starts_with(m)) {
                last = log.get(i + mode.len()).copied();
            }
        }
        last == Some(b'h')
    }
}

/// Build a `MSG_CWD` frame when the shell has moved to a different directory.
///
/// Called after each output flush — the point at which a command has finished and
/// the prompt has been redrawn. Returns `None` when the path is unchanged, so an
/// unchanging cwd never puts a frame on the wire, and an idle terminal (no
/// output, no flush) does no work at all.
fn cwd_frame(session: &PtySession, last: &mut String) -> Option<Message> {
    let cwd = session.cwd()?;
    if cwd == *last {
        return None;
    }

    let mut frame = BytesMut::with_capacity(cwd.len() + 1);
    frame.extend_from_slice(&[MSG_CWD]);
    frame.extend_from_slice(cwd.as_bytes());
    *last = cwd;
    Some(Message::Binary(frame.freeze()))
}

/// Check HTTP Basic Auth against a pre-built expected header value.
///
/// `expected` is the full `"Basic <base64(user:pass)>"` string built once at
/// startup — this function performs a single string comparison with no
/// allocations or decoding.
pub fn check_basic_auth(headers: &HeaderMap, expected: &str) -> bool {
    headers.get("authorization").and_then(|v| v.to_str().ok()).map(|v| v == expected).unwrap_or(false)
}

/// Parse `?arg=<value>&arg=<value>` pairs from a raw query string.
///
/// Only `arg` keys are extracted; all other parameters are ignored.
/// Values are percent-decoded (e.g. `%20` → space, `%2F` → `/`).
///
/// ```
/// // ?arg=-c&arg=ls%20-la  →  vec!["-c", "ls -la"]
/// ```
fn parse_url_args(query: &str) -> Vec<String> {
    query_pairs(query).filter(|(key, _)| *key == "arg").map(|(_, val)| percent_decode(val)).collect()
}

/// The session to reattach from `?resume=<id>&offset=<bytes>`: `offset` is
/// how much of its output the client already has (0 or absent after a page
/// reload).
fn parse_resume(query: &str) -> Option<(String, u64)> {
    let mut id = None;
    let mut offset = 0;
    for (key, val) in query_pairs(query) {
        match key {
            "resume" => id = Some(percent_decode(val)),
            "offset" => offset = val.parse().ok()?,
            _ => {}
        }
    }
    id.map(|id| (id, offset))
}

/// The `key=value` pairs of a query string, values still percent-encoded.
fn query_pairs(query: &str) -> impl Iterator<Item = (&str, &str)> {
    query.split('&').filter_map(|pair| pair.split_once('='))
}

/// Percent-decode a URL query value (replaces `%XX` sequences and `+` → space).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((hi << 4) | lo);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[inline(always)]
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_log_replays_what_a_client_missed() {
        let mut log = OutputLog::default();
        log.push(b"one\ntwo\n");
        assert_eq!(log.since(4), (4, b"two\n".to_vec(), false), "a reconnect gets only the rest");
        assert_eq!(log.since(8), (8, vec![], false), "nothing missed");
        assert_eq!(log.since(99), (8, vec![], false), "an offset past the end replays nothing");
        assert_eq!(log.since(0), (0, b"one\ntwo\n".to_vec(), false), "a page reload gets everything kept");

        let mut full = OutputLog::default();
        let capacity = full.buf.capacity();
        full.push(&vec![b'x'; OUTPUT_LOG_SIZE]);
        let tail = b"\x1b[31mred\nnext\n";
        full.push(tail);
        assert_eq!(full.total, (OUTPUT_LOG_SIZE + tail.len()) as u64);
        assert_eq!(full.buf.len(), OUTPUT_LOG_SIZE);
        assert_eq!(full.buf.capacity(), capacity, "the log never regrows");
        let (start, replay, lost) = full.since(0);
        assert!(lost);
        assert_eq!(replay, b"next\n", "a replay with a gap starts at a line, not mid-sequence");
        assert_eq!(start, full.total - replay.len() as u64, "the client learns where it starts");
    }

    #[test]
    fn output_log_knows_when_a_full_screen_program_is_running() {
        let mut log = OutputLog::default();
        log.push(b"$ vim\r\n\x1b[?1049h\x1b[H~");
        assert!(log.in_alternate_screen());
        log.push(b"\x1b[?1049l$ ");
        assert!(!log.in_alternate_screen());
        log.push(b"\x1b[?47h");
        assert!(log.in_alternate_screen());
    }

    #[test]
    fn resume_query_names_the_session_and_offset() {
        assert_eq!(parse_resume("resume=abc&offset=42"), Some(("abc".into(), 42)));
        assert_eq!(parse_resume("arg=ls&resume=abc"), Some(("abc".into(), 0)), "a page reload has no offset");
        assert_eq!(parse_resume("arg=ls"), None);
        assert_eq!(parse_resume("resume=abc&offset=-1"), None, "a bad offset doesn't resume");
    }

    /// A second connection takes the session over: the first is told why,
    /// and its late `Detach` and input leave the second attached and
    /// untouched. A reattach learns how much input was applied, and
    /// `MSG_CLOSE` ends the session.
    #[tokio::test]
    async fn a_session_moves_to_the_newest_connection() {
        let state = state_with(AppConfig { shell: "/bin/sh".into(), ..Default::default() });
        let slot = ClientSlot::acquire(&state).unwrap();
        let cmds = start_session(&state, slot, None, &[]).unwrap();
        let (first_tx, mut first) = mpsc::channel(64);
        let (second_tx, mut second) = mpsc::channel(64);
        cmds.send(PtyCmd::Attach { conn: 1, out: first_tx, offset: None }).await.unwrap();
        cmds.send(PtyCmd::Attach { conn: 2, out: second_tx, offset: Some(0) }).await.unwrap();
        cmds.send(PtyCmd::Detach(1)).await.unwrap();
        cmds.send(PtyCmd::Input { conn: 1, data: Bytes::from_static(b"echo stale\n") }).await.unwrap();
        cmds.send(PtyCmd::Input { conn: 2, data: Bytes::from_static(b"echo still-$((1+1))\n") }).await.unwrap();

        let taken_over = time::timeout(Duration::from_secs(5), async {
            while let Some(msg) = first.recv().await {
                if let Message::Close(Some(frame)) = msg {
                    return frame.code;
                }
            }
            0
        });
        assert_eq!(taken_over.await.expect("the takeover"), CLOSE_TAKEN_OVER);

        let mut output = Vec::new();
        let echoed = time::timeout(Duration::from_secs(5), async {
            while let Some(Message::Binary(frame)) = second.recv().await {
                if frame[0] == MSG_OUTPUT {
                    output.extend_from_slice(&frame[1..]);
                    if output.windows(7).any(|w| w == b"still-2") {
                        return;
                    }
                }
            }
            panic!("session ended early");
        });
        echoed.await.expect("output on the new connection");
        assert!(!output.windows(5).any(|w| w == b"stale"), "input from a replaced connection is dropped");

        let (third_tx, mut third) = mpsc::channel(64);
        cmds.send(PtyCmd::Attach { conn: 3, out: third_tx, offset: Some(u64::MAX) }).await.unwrap();
        let Some(Message::Binary(frame)) = third.recv().await else { panic!("session frame") };
        assert_eq!(frame[0], MSG_SESSION);
        assert_eq!(u64::from_be_bytes(frame[12..20].try_into().unwrap()), 1, "the session counts input it applied");

        cmds.send(PtyCmd::Close).await.unwrap();
        let ended = time::timeout(Duration::from_secs(5), async { while third.recv().await.is_some() {} });
        ended.await.expect("the session to end");
        assert!(state.term_sessions.lock().is_empty(), "an ended session is unregistered");
    }

    #[test]
    fn echo_ack_covers_input_the_shell_had_time_to_answer() {
        let mut echo = EchoAck::default();
        assert!(echo.due_at().is_none(), "nothing to acknowledge before input");
        echo.on_input();
        let first_due = echo.due_at().unwrap();
        echo.on_input();
        echo.on_input();
        assert_eq!(echo.due_at(), Some(first_due), "later input doesn't delay the first acknowledgement");
        echo.ack_due();
        assert_eq!(echo.acked, 1);
        assert!(echo.due_at().is_some(), "input received since is scheduled next");
        echo.ack_due();
        assert_eq!(echo.acked, 3);
        assert!(echo.due_at().is_none());
        let Message::Binary(frame) = echo.frame(true) else { panic!("binary frame") };
        assert_eq!(&frame[..], &[MSG_ECHO_ACK, 0, 0, 0, 3, 1]);
    }

    #[test]
    fn origin_allowed_rejects_cross_site_upgrades() {
        let mut cfg = AppConfig { allowed_hosts: vec!["localhost".into()], ..Default::default() };
        let host = Some("127.0.0.1:7681");
        for ok in [None, Some("http://127.0.0.1:7681"), Some("HTTPS://127.0.0.1:7681"), Some("http://localhost:5173")] {
            assert!(origin_allowed(&cfg, ok, host), "{ok:?}");
        }
        assert!(origin_allowed(&cfg, Some("http://[::1]:7681"), Some("[::1]:7681")));
        // Default port only on one side (proxy sends `$host:$server_port`).
        assert!(origin_allowed(&cfg, Some("https://term.example"), Some("term.example:443")));
        assert!(origin_allowed(&cfg, Some("http://term.example:80"), Some("term.example")));
        assert!(!origin_allowed(&cfg, Some("https://term.example"), Some("term.example:80")));
        for bad in ["https://evil.example", "http://127.0.0.1:7681.evil.example", "null", "http://127.0.0.1:8080"] {
            assert!(!origin_allowed(&cfg, Some(bad), host), "{bad}");
        }
        assert!(!origin_allowed(&cfg, Some("http://evil.example"), None));
        cfg.check_origin = true;
        assert!(!origin_allowed(&cfg, None, host));
    }

    fn state_with(config: AppConfig) -> Arc<AppState> {
        Arc::new(AppState {
            config: Arc::new(config),
            client_count: std::sync::atomic::AtomicU32::new(0),
            shutdown_tx: tokio::sync::watch::channel(false).0,
            expected_auth: None,
            custom_index: None,
            term_sessions: Default::default(),
            mcp_transmitters: Default::default(),
            watch_sessions: Default::default(),
            lsp: Default::default(),
        })
    }

    /// Finding #8: every rejected or finished client must give its slot back,
    /// or `--once` / `--max-clients` lock out the real user for good.
    #[test]
    fn client_slot_is_released_on_drop() {
        let count = |s: &AppState| s.client_count.load(std::sync::atomic::Ordering::SeqCst);

        let once = state_with(AppConfig { once: true, ..Default::default() });
        let first = ClientSlot::acquire(&once).expect("first client");
        assert!(ClientSlot::acquire(&once).is_none(), "--once admits a single client");
        assert_eq!(count(&once), 1, "a refused acquire must not leak");
        drop(first);
        assert_eq!(count(&once), 0);
        assert!(ClientSlot::acquire(&once).is_some(), "slot is reusable after release");

        let max = state_with(AppConfig { max_clients: 2, ..Default::default() });
        let slots = [ClientSlot::acquire(&max), ClientSlot::acquire(&max), ClientSlot::acquire(&max)];
        assert_eq!(slots.iter().filter(|s| s.is_some()).count(), 2);
        assert_eq!(count(&max), 2);
        drop(slots);
        assert_eq!(count(&max), 0);
    }
}
