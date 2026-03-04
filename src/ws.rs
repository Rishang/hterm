use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
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

// Binary protocol constants (must match terminal.js).
const MSG_INPUT: u8 = 0;
const MSG_OUTPUT: u8 = 1;
const MSG_RESIZE: u8 = 2;

// Tuning constants.
const PTY_BUF_SIZE: usize = 4 * 1024;
const COALESCE_WINDOW: Duration = Duration::from_millis(4);
const MAX_COALESCE_SIZE: usize = 16 * 1024;
const WS_OUT_CAP: usize = 32; // outbound message channel depth
const PTY_CMD_CAP: usize = 8; // keystroke/resize channel depth (bursts are rare)

/// Shared application state.
pub struct AppState {
    pub config: AppConfig,
    pub client_count: std::sync::atomic::AtomicU32,
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,
}

/// Commands sent from the WebSocket reader to the PTY owner task.
enum PtyCmd {
    Input(Bytes),     // zero-copy slice of the incoming Binary frame
    Resize(u16, u16), // (cols, rows)
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = &state.config;

    if !cfg.credential.is_empty() && !check_basic_auth(&headers, &cfg.credential) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // One atomic load covers both the max-clients and once-mode checks.
    let current = state.client_count.load(std::sync::atomic::Ordering::Relaxed);
    if (cfg.max_clients > 0 && current >= cfg.max_clients) || (cfg.once && current > 0) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    if cfg.check_origin {
        if let (Some(origin), Some(host)) = (
            headers.get("origin").and_then(|v| v.to_str().ok()),
            headers.get("host").and_then(|v| v.to_str().ok()),
        ) {
            if !origin.contains(host) {
                return StatusCode::FORBIDDEN.into_response();
            }
        }
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state))
        .into_response()
}

/// Handle a single WebSocket connection.
///
/// Task topology per session — 3 tasks, down from 4; no Arc<PtySession>:
///
///   ws_reader ──[PtyCmd]──► pty_main ──[Message]──► writer ──► ws_sink
///   lightweight              owns PTY               owns sink
///                            ping merged here
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let cfg = &state.config;
    let ping_interval = Duration::from_secs(cfg.ping_interval);
    let writable = cfg.writable;

    state.client_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let count = state.client_count.load(std::sync::atomic::Ordering::Relaxed);
    tracing::info!(shell = %cfg.shell, clients = count, "New terminal session started");

    let session = match PtySession::spawn(&cfg.shell, &cfg.cwd, &cfg.terminal_type) {
        Ok(s) => s, // owned value — no Arc needed
        Err(e) => {
            tracing::error!("PTY spawn error: {}", e);
            state.client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            return;
        }
    };

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Outbound channel: pty_main → writer → ws_sink
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(WS_OUT_CAP);
    // Command channel: ws_reader → pty_main (keystrokes + resize)
    let (cmd_tx, cmd_rx) = mpsc::channel::<PtyCmd>(PTY_CMD_CAP);

    // ── Writer task: owns ws_sink exclusively, zero contention ────────────────
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // ── PTY main task: owns session, coalesces output, handles cmds + pings ──
    // Pings are merged here via select!, eliminating the 4th task entirely.
    let mut pty_main = tokio::spawn(pty_main_loop(
        session,
        cmd_rx,
        out_tx.clone(),
        ping_interval,
    ));

    // ── WS reader task: minimal work — parse frames, forward PtyCmd ──────────
    let mut ws_reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) if !data.is_empty() => match data[0] {
                    MSG_INPUT if writable && data.len() > 1 => {
                        // Bytes::slice is zero-copy (refcount bump + offset adjust).
                        if cmd_tx.send(PtyCmd::Input(data.slice(1..))).await.is_err() {
                            break;
                        }
                    }
                    MSG_RESIZE if data.len() >= 5 => {
                        let cols = u16::from_be_bytes([data[1], data[2]]);
                        let rows = u16::from_be_bytes([data[3], data[4]]);
                        if cols > 0 && rows > 0 {
                            // Best-effort: ignore backpressure for resize (idempotent).
                            let _ = cmd_tx.send(PtyCmd::Resize(cols, rows)).await;
                        }
                    }
                    _ => {}
                },
                Message::Close(_) => break,
                _ => {}
            }
            // When this task exits, cmd_tx is dropped → cmd_rx in pty_main sees None.
        }
    });

    // ── Wait for whichever side finishes first ────────────────────────────────
    tokio::select! {
        _ = &mut pty_main  => {
            // Shell exited: no more output to produce; stop reading the WebSocket.
            ws_reader.abort();
        }
        _ = &mut ws_reader => {
            // Client disconnected: no point in continuing PTY I/O.
            pty_main.abort();
        }
    }

    // ── Correct shutdown sequence ─────────────────────────────────────────────
    // Drop our clone of out_tx.  Once pty_main's clone also drops (task completed
    // or aborted above), the writer sees a closed channel, drains any already-queued
    // frames, then exits naturally.
    //
    // This fixes the previous writer.abort() bug that discarded the shell's final
    // output frame.  On clean shell exit, pty_main flushes before returning, so
    // all output is enqueued; writer.await ensures it reaches the WebSocket.
    drop(out_tx);
    let _ = writer.await;

    // fetch_sub returns the *previous* value; subtract 1 for the current count.
    let remaining = state.client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed) - 1;
    tracing::info!(clients = remaining, "Terminal session ended");

    if cfg.once || (cfg.exit_no_conn && remaining == 0) {
        let reason = if cfg.once { "--once" } else { "--exit-no-conn" };
        tracing::info!("Shutting down ({})", reason);
        let _ = state.shutdown_tx.send(true);
    }
}

/// Owns `PtySession`. Reads PTY output with coalescing, handles incoming commands
/// (keystrokes / resize), and sends keepalive pings — all in one task.
async fn pty_main_loop(
    session: PtySession,
    mut cmd_rx: mpsc::Receiver<PtyCmd>,
    out_tx: mpsc::Sender<Message>,
    ping_interval: Duration,
) {
    let mut buf = [0u8; PTY_BUF_SIZE];
    let mut coalesce: Vec<u8> = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
    coalesce.push(MSG_OUTPUT);

    let mut ping_ticker = time::interval(ping_interval);
    ping_ticker.tick().await; // discard immediate first tick

    'outer: loop {
        tokio::select! {
            // ── PTY → client (most frequent path) ────────────────────────────
            res = session.read(&mut buf) => match res {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    coalesce.extend_from_slice(&buf[..n]);

                    // Accumulate up to MAX_COALESCE_SIZE within COALESCE_WINDOW.
                    // The sleep is pinned once per outer read; it is not re-created
                    // on each inner iteration.
                    if coalesce.len() < MAX_COALESCE_SIZE {
                        let deadline = time::sleep(COALESCE_WINDOW);
                        tokio::pin!(deadline);

                        'inner: loop {
                            tokio::select! {
                                biased; // drain PTY first; handle cmds opportunistically
                                res = session.read(&mut buf) => match res {
                                    Ok(0) | Err(_) => {
                                        // Shell exited mid-window: flush then stop.
                                        flush_coalesce(&mut coalesce, &out_tx).await;
                                        break 'outer;
                                    }
                                    Ok(n) => {
                                        coalesce.extend_from_slice(&buf[..n]);
                                        if coalesce.len() >= MAX_COALESCE_SIZE { break 'inner; }
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

            // ── Keepalive ping ────────────────────────────────────────────────
            // Merged here: eliminates the separate ping task and its ~64 KB stack.
            _ = ping_ticker.tick() => {
                if out_tx.send(Message::Ping(Bytes::new())).await.is_err() { break; }
            },
        }
    }
}

/// Flush the coalesce buffer to the outbound channel.
/// Returns `true` if the channel is closed (caller should exit).
/// Uses mem::replace so `Bytes::from(Vec)` moves the allocation zero-copy.
async fn flush_coalesce(coalesce: &mut Vec<u8>, tx: &mpsc::Sender<Message>) -> bool {
    if coalesce.len() > 1 {
        let mut next = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
        next.push(MSG_OUTPUT);
        let payload = std::mem::replace(coalesce, next);
        return tx.send(Message::Binary(Bytes::from(payload))).await.is_err();
    }
    false
}

/// Apply a `PtyCmd`. Returns `true` if the caller should exit the loop
/// (channel closed or unrecoverable write error).
async fn apply_cmd(cmd: Option<PtyCmd>, session: &PtySession) -> bool {
    match cmd {
        None => true, // cmd_rx closed → ws_reader exited
        Some(PtyCmd::Input(data)) => {
            if let Err(e) = session.write(&data).await {
                tracing::error!("PTY write: {}", e);
                return true;
            }
            false
        }
        Some(PtyCmd::Resize(cols, rows)) => {
            if let Err(e) = session.resize(rows, cols) {
                tracing::error!("PTY resize: {}", e);
            }
            false // resize errors are non-fatal
        }
    }
}

/// Check HTTP Basic Authentication.
fn check_basic_auth(headers: &HeaderMap, credential: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .and_then(|b64| {
            let mut decoded = Vec::new();
            base64_decode(b64, &mut decoded).ok()?;
            String::from_utf8(decoded).ok().map(|s| s == credential)
        })
        .unwrap_or(false)
}

/// Base64 decode: O(1) per character via match ranges (no 64-element linear scan).
fn base64_decode(input: &str, output: &mut Vec<u8>) -> Result<(), ()> {
    #[inline(always)]
    fn val(b: u8) -> Option<u32> {
        match b {
            b'A'..=b'Z' => Some((b - b'A') as u32),
            b'a'..=b'z' => Some((b - b'a' + 26) as u32),
            b'0'..=b'9' => Some((b - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in input.trim_end_matches('=').as_bytes() {
        buf = (buf << 6) | val(b).ok_or(())?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(())
}