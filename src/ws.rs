use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time;

use crate::config::AppConfig;
use crate::pty::PtySession;

/// Binary protocol constants (must match terminal.js).
const MSG_INPUT: u8 = 0;
const MSG_OUTPUT: u8 = 1;
const MSG_RESIZE: u8 = 2;
const MSG_ERROR: u8 = 3;

/// Tuning constants.
const PTY_BUF_SIZE: usize = 8 * 1024;
const COALESCE_WINDOW: Duration = Duration::from_millis(4);
const MAX_COALESCE_SIZE: usize = 16 * 1024;

/// Shared application state.
pub struct AppState {
    pub config: AppConfig,
    pub client_count: std::sync::atomic::AtomicU32,
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = &state.config;

    // Basic auth check
    if !cfg.credential.is_empty() {
        if !check_basic_auth(&headers, &cfg.credential) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }

    // Max clients check
    if cfg.max_clients > 0 {
        let current = state.client_count.load(std::sync::atomic::Ordering::Relaxed);
        if current >= cfg.max_clients {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }

    // Once mode
    if cfg.once {
        let current = state.client_count.load(std::sync::atomic::Ordering::Relaxed);
        if current > 0 {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }

    // Origin check
    if cfg.check_origin {
        if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
            if let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) {
                if !origin.contains(host) {
                    return StatusCode::FORBIDDEN.into_response();
                }
            }
        }
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state))
        .into_response()
}

/// Handle a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let cfg = &state.config;

    state
        .client_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let count = state
        .client_count
        .load(std::sync::atomic::Ordering::Relaxed);
    tracing::info!(
        shell = %cfg.shell,
        clients = count,
        "New terminal session started"
    );

    let session = match PtySession::spawn(&cfg.shell, &cfg.cwd, &cfg.terminal_type) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            tracing::error!("PTY spawn error: {}", e);
            state
                .client_count
                .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            return;
        }
    };

    let (ws_tx, mut ws_rx) = socket.split();
    let ws_tx = Arc::new(Mutex::new(ws_tx));

    // Ping ticker
    let ws_tx_ping = ws_tx.clone();
    let ping_interval = Duration::from_secs(cfg.ping_interval);
    let ping_task = tokio::spawn(async move {
        let mut interval = time::interval(ping_interval);
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            let mut tx = ws_tx_ping.lock().await;
            if tx.send(Message::Ping(vec![].into())).await.is_err() {
                break;
            }
        }
    });

    // PTY → WebSocket with output coalescing
    let session_read = session.clone();
    let ws_tx_out = ws_tx.clone();
    let pty_to_ws = tokio::spawn(async move {
        let mut buf = vec![0u8; PTY_BUF_SIZE];
        let mut coalesce_buf: Vec<u8> = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
        coalesce_buf.push(MSG_OUTPUT);

        loop {
            // Read from PTY
            match session_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    coalesce_buf.extend_from_slice(&buf[..n]);

                    if coalesce_buf.len() >= MAX_COALESCE_SIZE {
                        // Flush immediately if buffer is full
                        let data_to_send = std::mem::replace(
                            &mut coalesce_buf,
                            {
                                let mut b = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
                                b.push(MSG_OUTPUT);
                                b
                            }
                        );
                        let mut tx = ws_tx_out.lock().await;
                        let _ = tx
                            .send(Message::Binary(data_to_send.into()))
                            .await;
                    } else {
                        // Wait for coalesce window to accumulate more data
                        let deadline = time::Instant::now() + COALESCE_WINDOW;
                        loop {
                            match time::timeout_at(deadline, session_read.read(&mut buf)).await {
                                Ok(Ok(0)) => break,
                                Ok(Ok(n)) => {
                                    coalesce_buf.extend_from_slice(&buf[..n]);
                                    if coalesce_buf.len() >= MAX_COALESCE_SIZE {
                                        break;
                                    }
                                }
                                Ok(Err(_)) => break,
                                Err(_timeout) => break,
                            }
                        }
                        // Flush coalesced data
                        if coalesce_buf.len() > 1 {
                            let data_to_send = std::mem::replace(
                                &mut coalesce_buf,
                                {
                                    let mut b = Vec::with_capacity(MAX_COALESCE_SIZE + 1);
                                    b.push(MSG_OUTPUT);
                                    b
                                }
                            );
                            let mut tx = ws_tx_out.lock().await;
                            let _ = tx
                                .send(Message::Binary(data_to_send.into()))
                                .await;
                        }
                    }
                }
                Err(e) => {
                    // EIO is expected when child exits
                    if e.raw_os_error() != Some(5) {
                        tracing::error!("PTY read error: {}", e);
                    }
                    break;
                }
            }
        }
    });

    // WebSocket → PTY
    let session_write = session.clone();
    let writable = cfg.writable;
    let ws_to_pty = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Binary(data) => {
                    if data.is_empty() {
                        continue;
                    }
                    match data[0] {
                        MSG_INPUT => {
                            if !writable {
                                continue;
                            }
                            if data.len() > 1 {
                                if let Err(e) = session_write.write(&data[1..]).await {
                                    tracing::error!("PTY write error: {}", e);
                                    break;
                                }
                            }
                        }
                        MSG_RESIZE => {
                            if data.len() >= 5 {
                                let cols = u16::from_be_bytes([data[1], data[2]]);
                                let rows = u16::from_be_bytes([data[3], data[4]]);
                                if cols > 0 && rows > 0 {
                                    if let Err(e) = session_write.resize(rows, cols) {
                                        tracing::error!("PTY resize error: {}", e);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either side to finish
    tokio::select! {
        _ = pty_to_ws => {},
        _ = ws_to_pty => {},
    }

    ping_task.abort();
    drop(session);

    state
        .client_count
        .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);

    let remaining = state
        .client_count
        .load(std::sync::atomic::Ordering::Relaxed);
    tracing::info!(clients = remaining, "Terminal session ended");

    // Handle --once and --exit-no-conn
    if cfg.once || (cfg.exit_no_conn && remaining == 0) {
        let reason = if cfg.once {
            "--once mode"
        } else {
            "--exit-no-conn mode"
        };
        tracing::info!("Shutting down ({})", reason);
        let _ = state.shutdown_tx.send(true);
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
            let s = String::from_utf8(decoded).ok()?;
            Some(s == credential)
        })
        .unwrap_or(false)
}

/// Minimal base64 decode (avoids pulling in a full base64 crate).
fn base64_decode(input: &str, output: &mut Vec<u8>) -> Result<(), ()> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let input = input.trim_end_matches('=');
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in input.as_bytes() {
        let val = TABLE.iter().position(|&c| c == b).ok_or(())? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(())
}

/// Construct an error message in binary protocol format.
#[allow(dead_code)]
fn make_error_msg(message: &str) -> Vec<u8> {
    let mut msg = Vec::with_capacity(1 + message.len());
    msg.push(MSG_ERROR);
    msg.extend_from_slice(message.as_bytes());
    msg
}
