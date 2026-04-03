use axum::extract::ws::{Message, WebSocket};
use axum::extract::{RawQuery, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time;

use crate::config::AppConfig;
use crate::pty::PtySession;

// ── Binary protocol constants (must match terminal.js) ────────────────────────
const MSG_INPUT:  u8 = 0;   // client → server: keystroke data
const MSG_OUTPUT: u8 = 1;   // server → client: PTY output
const MSG_RESIZE: u8 = 2;   // client → server: terminal resize (cols u16 BE, rows u16 BE)

// ── Tuning ────────────────────────────────────────────────────────────────────

/// PTY read buffer.  8 KiB halves syscall count vs. 4 KiB on heavy output
/// while staying well inside one 16 KiB coalesce window.
const PTY_BUF_SIZE: usize = 8 * 1024;

/// Maximum time to accumulate PTY output before flushing a WebSocket frame.
const COALESCE_WINDOW: Duration = Duration::from_millis(4);

/// Flush immediately once coalesced data reaches this size.
const MAX_COALESCE_SIZE: usize = 16 * 1024;

/// Outbound message channel depth (writer task).
const WS_OUT_CAP: usize = 32;

/// Inbound command channel depth (keystroke + resize bursts are small).
const PTY_CMD_CAP: usize = 8;

// ─────────────────────────────────────────────────────────────────────────────

/// Shared application state held in an `Arc` by every connection handler.
pub struct AppState {
    pub config: AppConfig,

    /// Number of currently connected clients.
    pub client_count: std::sync::atomic::AtomicU32,

    /// Send `true` to trigger a graceful server shutdown.
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,

    /// Pre-built `"Basic <base64(user:pass)>"` string for O(1) Basic Auth
    /// comparison on each WebSocket upgrade.  `None` when auth is disabled.
    pub expected_auth: Option<String>,

    /// Active MCP SSE channels.
    pub mcp_transmitters: tokio::sync::RwLock<std::collections::HashMap<String, tokio::sync::mpsc::UnboundedSender<axum::response::sse::Event>>>,
}

/// Commands forwarded from the WebSocket reader task to the PTY owner task.
enum PtyCmd {
    /// Keystroke data — a zero-copy slice of the incoming binary frame.
    Input(Bytes),
    /// Terminal resize: (cols, rows).
    Resize(u16, u16),
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
    ws:              WebSocketUpgrade,
    RawQuery(query): RawQuery,
    headers:         HeaderMap,
    State(state):    State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = &state.config;

    // ── Authentication ────────────────────────────────────────────────────────
    //
    // Two mutually exclusive modes, tried in order:
    //
    // 1. Reverse-proxy header auth (`auth_header` is set):
    //    Trust the specified header value placed by the upstream proxy.
    //    The *presence* of the header means "authenticated"; the value is the
    //    remote username (logged but not validated here).
    //
    // 2. HTTP Basic Auth (`credential` is set):
    //    Compare against the pre-built expected header string stored in
    //    AppState — one string comparison, no per-request allocations.
    //
    // If neither is configured, all connections are accepted.
    if !cfg.auth_header.is_empty() {
        match headers.get(cfg.auth_header.as_str()) {
            Some(user) => {
                let name = user.to_str().unwrap_or("<non-utf8>");
                tracing::debug!(proxy_user = name, "Proxy-authenticated connection");
            }
            None => {
                tracing::warn!(
                    auth_header = %cfg.auth_header,
                    "WebSocket upgrade rejected: proxy auth header missing"
                );
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
    } else if let Some(ref expected) = state.expected_auth {
        if !check_basic_auth(&headers, expected) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }

    // ── Client-limit + once-mode guard ────────────────────────────────────────
    // Use fetch_add to atomically check and increment, avoiding race conditions
    let previous = state.client_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if (cfg.max_clients > 0 && previous >= cfg.max_clients) || (cfg.once && previous > 0) {
        // Revert the increment since we're rejecting this connection
        state.client_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    // ── Origin check ──────────────────────────────────────────────────────────
    if cfg.check_origin {
        let origin = headers.get("origin").and_then(|v| v.to_str().ok());
        let host   = headers.get("host").and_then(|v| v.to_str().ok());
        if let (Some(o), Some(h)) = (origin, host) {
            if !o.contains(h) {
                tracing::warn!(origin = o, host = h, "WebSocket upgrade rejected: origin mismatch");
                return StatusCode::FORBIDDEN.into_response();
            }
        }
    }

    // ── URL arg passthrough ───────────────────────────────────────────────────
    // Decode repeated `?arg=<value>` pairs from the query string and pass them
    // as extra shell argv entries.  Only active when `url_arg = true`.
    //
    // Example: `ws://host/ws?arg=-c&arg=ls%20-la`
    //   → execve("/bin/bash", ["/bin/bash", "-c", "ls -la"], env)
    let url_args: Vec<String> = if cfg.url_arg {
        parse_url_args(query.as_deref().unwrap_or(""))
    } else {
        vec![]
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, url_args))
        .into_response()
}

// ── Session handler ───────────────────────────────────────────────────────────

/// Handle one WebSocket connection.
///
/// ### Task topology (3 tasks, no `Arc<PtySession>`)
///
/// ```text
/// ws_reader ──[PtyCmd]──► pty_main ──[Message]──► writer ──► ws_sink
/// lightweight              owns PTY               owns sink
///                          pings merged here
/// ```
///
/// `pty_main` owns the `PtySession` value directly — no `Arc` overhead.
/// Pings are merged into `pty_main` via `select!` to avoid a 4th task.
async fn handle_socket(socket: WebSocket, state: Arc<AppState>, url_args: Vec<String>) {
    let cfg           = &state.config;
    let ping_interval = Duration::from_secs(cfg.ping_interval);
    let writable      = cfg.writable;

    // Count was already incremented in ws_handler, just read it for logging
    let count = state.client_count.load(std::sync::atomic::Ordering::Relaxed);
    tracing::info!(
        shell    = %cfg.shell,
        url_args = ?url_args,
        clients  = count,
        "Terminal session started"
    );

    let session = match PtySession::spawn(
        &cfg.shell,
        &url_args,
        &cfg.cwd,
        &cfg.terminal_type,
        cfg.uid,
        cfg.gid,
    ) {
        Ok(s)  => s,
        Err(e) => {
            tracing::error!("PTY spawn failed: {}", e);
            state.client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            return;
        }
    };

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Outbound channel: pty_main → writer → ws_sink
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(WS_OUT_CAP);
    // Inbound command channel: ws_reader → pty_main
    let (cmd_tx, cmd_rx)     = mpsc::channel::<PtyCmd>(PTY_CMD_CAP);

    // ── Writer: owns ws_sink exclusively — zero lock contention ──────────────
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
        // Send a clean WebSocket close frame after draining the outbound queue.
        let _ = ws_sink.close().await;
    });

    // ── PTY main: owns PtySession, coalesces output, handles cmds + pings ────
    let mut pty_main = tokio::spawn(pty_main_loop(
        session,
        cmd_rx,
        out_tx.clone(),
        ping_interval,
    ));

    // ── WS reader: minimal work — parse frames, forward PtyCmd ───────────────
    let mut ws_reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) if !data.is_empty() => match data[0] {
                    MSG_INPUT if writable && data.len() > 1 => {
                        // `Bytes::slice` is zero-copy (refcount bump + offset adjust).
                        if cmd_tx.send(PtyCmd::Input(data.slice(1..))).await.is_err() {
                            break;
                        }
                    }
                    MSG_RESIZE if data.len() >= 5 => {
                        let cols = u16::from_be_bytes([data[1], data[2]]);
                        let rows = u16::from_be_bytes([data[3], data[4]]);
                        if cols > 0 && rows > 0 {
                            // Resize is idempotent; best-effort, skip if the
                            // channel is full rather than blocking the reader.
                            let _ = cmd_tx.try_send(PtyCmd::Resize(cols, rows));
                        }
                    }
                    _ => {}
                },
                Message::Close(_) => break,
                _ => {}
            }
            // Dropping cmd_tx when this task exits signals pty_main to stop.
        }
    });

    // ── Wait for whichever side finishes first ────────────────────────────────
    tokio::select! {
        _ = &mut pty_main  => ws_reader.abort(),  // shell exited
        _ = &mut ws_reader => pty_main.abort(),   // client disconnected
    }

    // Drop our clone of out_tx.  Once pty_main's clone also drops (task
    // completed or aborted above), the writer sees a closed channel, drains
    // any already-queued frames (including the shell's final output), then
    // exits naturally.  Previously writer.abort() was used here, which
    // discarded the last output frame on clean shell exit.
    drop(out_tx);
    let _ = writer.await;

    // fetch_sub returns the *previous* value; subtract 1 for the current count.
    let remaining = state.client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed) - 1;
    tracing::info!(clients = remaining, "Terminal session ended");

    if cfg.once || (cfg.exit_no_conn && remaining == 0) {
        let reason = if cfg.once { "--once" } else { "--exit-no-conn" };
        tracing::info!("Initiating shutdown ({})", reason);
        let _ = state.shutdown_tx.send(true);
    }
}

// ── PTY main loop ─────────────────────────────────────────────────────────────

/// Owns `PtySession`. Reads PTY output with a 4 ms coalesce window (up to
/// 16 KiB per frame), handles incoming keystrokes/resize commands, and sends
/// WebSocket keepalive pings — all in a single task.
async fn pty_main_loop(
    session:       PtySession,
    mut cmd_rx:    mpsc::Receiver<PtyCmd>,
    out_tx:        mpsc::Sender<Message>,
    ping_interval: Duration,
) {
    let mut buf = [0u8; PTY_BUF_SIZE];
    // Pre-allocate the coalesce buffer with the MSG_OUTPUT type byte already
    // at index 0, so each flush is a single Binary frame with no header copy.
    let mut coalesce: Vec<u8> = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
    coalesce.push(MSG_OUTPUT);

    let mut ping_ticker = time::interval(ping_interval);
    ping_ticker.tick().await; // discard the immediate first tick

    'outer: loop {
        tokio::select! {
            // ── PTY → client (hot path) ───────────────────────────────────────
            res = session.read(&mut buf) => match res {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    coalesce.extend_from_slice(&buf[..n]);

                    // Accumulate further output within COALESCE_WINDOW before
                    // flushing, up to MAX_COALESCE_SIZE.  The sleep is pinned
                    // once per outer read, not re-created per inner iteration.
                    if coalesce.len() < MAX_COALESCE_SIZE {
                        let deadline = time::sleep(COALESCE_WINDOW);
                        tokio::pin!(deadline);

                        'inner: loop {
                            tokio::select! {
                                biased; // drain PTY first; handle cmds opportunistically
                                res = session.read(&mut buf) => match res {
                                    Ok(0) | Err(_) => {
                                        flush_coalesce(&mut coalesce, &out_tx).await;
                                        break 'outer;
                                    }
                                    Ok(n) => {
                                        coalesce.extend_from_slice(&buf[..n]);
                                        if coalesce.len() >= MAX_COALESCE_SIZE {
                                            break 'inner;
                                        }
                                    }
                                },
                                cmd = cmd_rx.recv() => {
                                    if apply_cmd(cmd, &session).await { break 'outer; }
                                },
                                _ = &mut deadline => break 'inner,
                            }
                        }
                    }

                    if flush_coalesce(&mut coalesce, &out_tx).await { break; }
                }
            },

            // ── Client → PTY (keystrokes / resize) ───────────────────────────
            cmd = cmd_rx.recv() => {
                if apply_cmd(cmd, &session).await { break; }
            },

            // ── Keepalive ping (merged here — avoids a 4th task + ~64 KiB stack)
            _ = ping_ticker.tick() => {
                if out_tx.send(Message::Ping(Bytes::new())).await.is_err() { break; }
            },
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Flush the coalesce buffer as a single `Binary` WebSocket frame.
///
/// Uses `mem::replace` to hand the `Vec`'s allocation to `Bytes::from`
/// zero-copy, then resets the buffer for the next window.
///
/// Returns `true` if the outbound channel is closed (caller should stop).
async fn flush_coalesce(coalesce: &mut Vec<u8>, tx: &mpsc::Sender<Message>) -> bool {
    if coalesce.len() > 1 {
        let mut next = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
        next.push(MSG_OUTPUT);
        let payload = std::mem::replace(coalesce, next);
        return tx.send(Message::Binary(Bytes::from(payload))).await.is_err();
    }
    false
}

/// Apply a `PtyCmd`. Returns `true` if the loop should exit.
async fn apply_cmd(cmd: Option<PtyCmd>, session: &PtySession) -> bool {
    match cmd {
        None => true, // cmd_rx closed → ws_reader exited
        Some(PtyCmd::Input(data)) => {
            if let Err(e) = session.write(&data).await {
                tracing::error!("PTY write error: {}", e);
                return true;
            }
            false
        }
        Some(PtyCmd::Resize(cols, rows)) => {
            if let Err(e) = session.resize(rows, cols) {
                // Non-fatal: the terminal just won't reflow until the next resize.
                tracing::warn!("PTY resize error: {}", e);
            }
            false
        }
    }
}

/// Check HTTP Basic Auth against a pre-built expected header value.
///
/// `expected` is the full `"Basic <base64(user:pass)>"` string built once at
/// startup — this function performs a single string comparison with no
/// allocations or decoding.
pub fn check_basic_auth(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == expected)
        .unwrap_or(false)
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
    if query.is_empty() {
        return vec![];
    }
    query
        .split('&')
        .filter_map(|pair| {
            let (key, val) = pair.split_once('=')?;
            if key == "arg" { Some(percent_decode(val)) } else { None }
        })
        .collect()
}

/// Percent-decode a URL query value (replaces `%XX` sequences and `+` → space).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => { out.push(b' '); i += 1; }
            b'%' if i + 2 < bytes.len() => {
                if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((hi << 4) | lo);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b => { out.push(b); i += 1; }
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
        _            => None,
    }
}