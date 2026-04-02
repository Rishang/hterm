mod config;
mod mcp;
mod pty;
mod ws;

#[global_allocator]
// static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
static ALLOC: snmalloc_rs::SnMalloc = snmalloc_rs::SnMalloc;

use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_server::Handle;
use clap::Parser;
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::signal;

#[cfg(unix)]
use nix::libc;

#[derive(Embed)]
#[folder = "ui/dist/"]
struct Assets;

use config::{AppConfig, ConfigResponse};
use ws::AppState;

const VERSION: &str = env!("CARGO_PKG_VERSION");

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(
    name    = "hterm",
    about   = "Share your terminal over the web",
    version = VERSION,
)]
struct Cli {
    // ── Network ───────────────────────────────────────────────────────────────

    /// TCP port to listen on (default: 7681, 0 = random)
    #[arg(short = 'p', long = "port")]
    port: Option<u16>,

    /// Host/interface to bind; accepts IPv4, IPv6 (e.g. `::` or `::1`),
    /// or a hostname
    #[arg(short = 'H', long = "host")]
    host: Option<String>,

    /// Bind to a Unix domain socket instead of TCP (Linux/macOS only).
    /// Overrides --host, --port, and --ssl.
    #[arg(short = 'i', long = "interface")]
    unix_socket: Option<String>,

    // ── Shell ─────────────────────────────────────────────────────────────────

    /// Shell executable (default: $SHELL or /bin/bash)
    #[arg(long)]
    shell: Option<String>,

    /// Working directory for the shell
    #[arg(short = 'w', long = "cwd")]
    cwd: Option<String>,

    /// TERM environment variable reported to the shell
    #[arg(short = 'T', long = "terminal-type")]
    terminal_type: Option<String>,

    // ── Access control ────────────────────────────────────────────────────────

    /// Allow clients to write keystrokes to the TTY
    #[arg(short = 'W', long = "writable")]
    writable: bool,

    /// Force read-only mode (overrides -W and config)
    #[arg(short = 'R', long = "readonly")]
    readonly: bool,

    /// Maximum concurrent clients (0 = unlimited)
    #[arg(short = 'm', long = "max-clients")]
    max_clients: Option<u32>,

    /// Accept only one client and exit on disconnection
    #[arg(short = 'o', long = "once")]
    once: bool,

    /// Exit when the last client disconnects
    #[arg(short = 'q', long = "exit-no-conn")]
    exit_no_conn: bool,

    /// Reject WebSocket upgrades from a different origin
    #[arg(short = 'O', long = "check-origin")]
    check_origin: bool,

    /// HTTP Basic Auth credential (username:password)
    #[arg(short = 'c', long = "credential")]
    credential: Option<String>,

    /// HTTP header name for reverse-proxy auth (e.g. X-Remote-User).
    /// When set, the presence of this header (injected by an upstream proxy)
    /// authenticates the request; Basic Auth is skipped entirely.
    #[arg(short = 'A', long = "auth-header")]
    auth_header: Option<String>,

    /// Allow clients to pass extra shell arguments via ?arg=value in the URL
    #[arg(short = 'a', long = "url-arg")]
    url_arg: bool,

    // ── Routing ───────────────────────────────────────────────────────────────

    /// URL base-path for reverse-proxy deployments (e.g. /terminal)
    #[arg(short = 'b', long = "base-path")]
    base_path: Option<String>,

    /// Custom index.html path
    #[arg(short = 'I', long = "index")]
    index: Option<String>,

    /// WebSocket ping interval in seconds
    #[arg(short = 'P', long = "ping-interval")]
    ping_interval: Option<u64>,

    // ── Privilege drop ────────────────────────────────────────────────────────

    /// Drop to this numeric user ID in each spawned shell child
    #[arg(short = 'u', long = "uid")]
    uid: Option<u32>,

    /// Drop to this numeric group ID in each spawned shell child
    #[arg(short = 'g', long = "gid")]
    gid: Option<u32>,

    // ── TLS ───────────────────────────────────────────────────────────────────

    /// Enable TLS (requires --ssl-cert and --ssl-key)
    #[arg(short = 'S', long)]
    ssl: bool,

    /// TLS certificate file (PEM)
    #[arg(short = 'C', long = "ssl-cert")]
    ssl_cert: Option<String>,

    /// TLS private key file (PEM)
    #[arg(short = 'K', long = "ssl-key")]
    ssl_key: Option<String>,

    // ── Terminal features ─────────────────────────────────────────────────────

    /// Enable Sixel graphics support in the xterm.js frontend
    #[arg(long = "sixel")]
    sixel: bool,

    // ── Misc ──────────────────────────────────────────────────────────────────

    /// Enable debug-level logging
    #[arg(short = 'd', long)]
    debug: bool,

    /// Path to config.json
    #[arg(long, default_value = "config.json")]
    config: String,

    /// Run as an MCP (Model Context Protocol) server over stdio instead of
    /// starting the HTTP/WebSocket terminal server.  AI clients such as
    /// Claude Desktop connect to hterm by launching it with this flag and
    /// communicating via JSON-RPC 2.0 on stdin/stdout.
    #[arg(long = "mcp")]
    mcp: bool,

    /// Optional command to run instead of the configured shell (positional)
    #[arg(trailing_var_arg = true)]
    command: Vec<String>,
}

// ── Entry point ───────────────────────────────────────────────────────────────

// `current_thread`: one OS thread, one event loop.  All async awaits yield
// cooperatively; many concurrent sessions are handled without parallelism.
// The bottleneck is PTY I/O, not CPU, so extra worker threads add only
// context-switch overhead.
//
// For 50+ simultaneous heavy sessions, change to:
//   #[tokio::main(flavor = "multi_thread", worker_threads = 2)]
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();

    // ── Logging ───────────────────────────────────────────────────────────────
    tracing_subscriber::fmt()
        .with_env_filter(if cli.debug { "debug" } else { "info" })
        .compact()
        .init();

    // ── SIGCHLD → SIG_IGN (Unix only) ────────────────────────────────────────
    // Causes the kernel to auto-reap child processes the moment they exit,
    // producing no zombies and requiring no waitpid per session.
    #[cfg(unix)]
    unsafe { libc::signal(libc::SIGCHLD, libc::SIG_IGN); }

    // ── Config: JSON file first, then CLI overrides ───────────────────────────
    let mut cfg = AppConfig::load(&cli.config);

    if let Some(p) = cli.port          { cfg.port          = p; }
    if let Some(h) = cli.host          { cfg.host          = h; }
    if let Some(s) = cli.unix_socket   { cfg.unix_socket   = s; }
    if let Some(s) = cli.shell         { cfg.shell         = s; }
    if !cli.command.is_empty()         { cfg.shell         = cli.command[0].clone(); }
    if let Some(c) = cli.cwd           { cfg.cwd           = c; }
    if let Some(t) = cli.terminal_type { cfg.terminal_type = t; }
    if cli.writable                    { cfg.writable      = true; }
    if cli.readonly                    { cfg.writable      = false; }
    if let Some(m) = cli.max_clients   { cfg.max_clients   = m; }
    if cli.once                        { cfg.once          = true; }
    if cli.exit_no_conn                { cfg.exit_no_conn  = true; }
    if cli.check_origin                { cfg.check_origin  = true; }
    if let Some(c) = cli.credential    { cfg.credential    = c; }
    if let Some(a) = cli.auth_header   { cfg.auth_header   = a; }
    if cli.url_arg                     { cfg.url_arg       = true; }
    if let Some(b) = cli.base_path     { cfg.base_path     = b.trim_end_matches('/').to_string(); }
    if let Some(i) = cli.index         { cfg.index_path    = i; }
    if let Some(p) = cli.ping_interval { cfg.ping_interval = p; }
    if let Some(u) = cli.uid           { cfg.uid           = Some(u); }
    if let Some(g) = cli.gid           { cfg.gid           = Some(g); }
    if cli.ssl                         { cfg.ssl           = true; }
    if let Some(c) = cli.ssl_cert      { cfg.ssl_cert      = c; }
    if let Some(k) = cli.ssl_key       { cfg.ssl_key       = k; }
    if cli.sixel                       { cfg.sixel         = true; }

    // ── Validation ────────────────────────────────────────────────────────────
    if !Path::new(&cfg.shell).exists() {
        tracing::error!("Shell not found: {}", cfg.shell);
        std::process::exit(1);
    }
    if !cfg.cwd.is_empty() && !Path::new(&cfg.cwd).is_dir() {
        tracing::error!("Working directory not valid: {}", cfg.cwd);
        std::process::exit(1);
    }

    // ── MCP mode: bypass HTTP server entirely ─────────────────────────────────
    if cli.mcp {
        mcp::run_mcp_server(cfg).await;
        return;
    }

    if cfg.ssl && (cfg.ssl_cert.is_empty() || cfg.ssl_key.is_empty()) {
        tracing::error!("--ssl requires both --ssl-cert and --ssl-key");
        std::process::exit(1);
    }
    if cfg.ssl && !cfg.unix_socket.is_empty() {
        tracing::warn!("--ssl is ignored when --interface (Unix socket) is set");
    }
    if !cfg.auth_header.is_empty() && !cfg.credential.is_empty() {
        tracing::warn!("Both auth_header and credential are set; auth_header takes precedence");
    }

    // ── Pre-compute Basic Auth expected header value ──────────────────────────
    // Build "Basic <base64(user:pass)>" once at startup so ws_handler can
    // authenticate with a single string comparison per upgrade — no per-request
    // allocations or decoding.
    let expected_auth: Option<String> = if cfg.credential.is_empty() {
        None
    } else {
        Some(format!("Basic {}", base64_encode(&cfg.credential)))
    };

    // ── Serialise /api/config response once ───────────────────────────────────
    // Leaked for a 'static reference valid for the server's lifetime, avoiding
    // per-request serialisation.
    let config_json: &'static str = Box::leak(
        serde_json::to_string(&ConfigResponse {
            theme:    cfg.theme.clone(),
            writable: cfg.writable,
            sixel:    cfg.sixel,
            url_arg:  cfg.url_arg,
        })
        .unwrap()
        .into_boxed_str(),
    );

    // ── Shutdown channel ──────────────────────────────────────────────────────
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    let state = Arc::new(AppState {
        config:        cfg.clone(),
        client_count:  std::sync::atomic::AtomicU32::new(0),
        shutdown_tx,
        expected_auth,
    });

    // ── Router ────────────────────────────────────────────────────────────────
    let bp = cfg.base_path.clone();

    let app = Router::new()
        .route(&format!("{}/",                 bp), get(serve_index))
        .route(&format!("{}/api/config",        bp), get(move || async move { serve_config(config_json).await }))
        .route(&format!("{}/exec",              bp), post(serve_exec))
        .route(&format!("{}/ws",                bp), get(ws::ws_handler))
        .route(&format!("{}/static/{{*path}}",  bp), get(serve_asset))
        .with_state(state);

    // ── Serve ─────────────────────────────────────────────────────────────────
    // Three mutually exclusive paths:
    //   1. Unix domain socket  (--interface, Unix only, no TLS)
    //   2. TLS TCP             (--ssl, uses axum-server + rustls)
    //   3. Plain TCP           (default)
    //
    // For paths 2 and 3, the TCP listener is bound via std::net::TcpListener
    // *before* privilege drop so the process can bind privileged ports (<1024)
    // as root and then safely drop to a less-privileged UID.

    #[cfg(unix)]
    if !cfg.unix_socket.is_empty() {
        serve_unix(app, &cfg, shutdown_rx).await;
        return;
    }

    serve_tcp(app, &cfg, shutdown_rx).await;
}

// ── Unix domain socket server ─────────────────────────────────────────────────

#[cfg(unix)]
async fn serve_unix(
    app: Router,
    cfg: &AppConfig,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    use tokio::net::UnixListener;

    let path = &cfg.unix_socket;

    // Remove a stale socket file from a previous run so bind doesn't fail.
    if Path::new(path).exists() {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::error!("Cannot remove stale socket {}: {}", path, e);
            std::process::exit(1);
        }
    }

    let listener = match UnixListener::bind(path) {
        Ok(l)  => l,
        Err(e) => {
            tracing::error!("Cannot bind Unix socket {}: {}", path, e);
            std::process::exit(1);
        }
    };

    tracing::info!("hterm v{} listening on unix:{}{}", VERSION, path, cfg.base_path);
    tracing::info!(
        "Shell: {}  |  Terminal: {}  |  Writable: {}",
        cfg.shell, cfg.terminal_type, cfg.writable
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(make_shutdown_signal(shutdown_rx))
        .await
        .unwrap();

    tracing::info!("Server stopped");
}

// ── TCP server (plain or TLS) ─────────────────────────────────────────────────

async fn serve_tcp(
    app: Router,
    cfg: &AppConfig,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    // ── Build SocketAddr supporting both IPv4 and IPv6 ────────────────────────
    // IPv6 addresses must be wrapped in brackets for SocketAddr parsing:
    //   "::1"  →  "[::1]:7681"
    //   "0.0.0.0" →  "0.0.0.0:7681"
    let addr_str = if cfg.host.contains(':') {
        format!("[{}]:{}", cfg.host, cfg.port)
    } else {
        format!("{}:{}", cfg.host, cfg.port)
    };

    let addr: std::net::SocketAddr = match addr_str.parse() {
        Ok(a)  => a,
        Err(e) => {
            tracing::error!("Invalid bind address '{}': {}", addr_str, e);
            std::process::exit(1);
        }
    };

    // ── Bind the TCP socket first (may require root for port < 1024) ──────────
    let std_listener = match std::net::TcpListener::bind(addr) {
        Ok(l)  => l,
        Err(e) => {
            tracing::error!("Cannot bind {}: {}", addr, e);
            std::process::exit(1);
        }
    };
    std_listener.set_nonblocking(true).unwrap();

    // ── Load TLS cert/key while we still have file-system access ─────────────
    // (must happen before privilege drop in case certs are root-readable only)
    let tls_config = if cfg.ssl {
        match axum_server::tls_rustls::RustlsConfig::from_pem_file(&cfg.ssl_cert, &cfg.ssl_key).await {
            Ok(c)  => Some(c),
            Err(e) => {
                tracing::error!("Failed to load TLS certificate/key: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let scheme = if cfg.ssl { "https" } else { "http" };
    tracing::info!("hterm v{} listening on {}://{}{}", VERSION, scheme, addr, cfg.base_path);
    tracing::info!(
        "Shell: {}  |  Terminal: {}  |  Writable: {}",
        cfg.shell, cfg.terminal_type, cfg.writable
    );

    // ── axum-server Handle for graceful shutdown ──────────────────────────────
    let handle = Handle::new();
    let handle_for_shutdown = handle.clone();

    tokio::spawn(async move {
        make_shutdown_signal(shutdown_rx).await;
        // Allow up to 10 seconds for in-flight WebSocket sessions to drain.
        handle_for_shutdown.graceful_shutdown(Some(Duration::from_secs(10)));
    });

    // ── Serve plain or TLS from the pre-bound std listener ───────────────────
    if let Some(tls) = tls_config {
        axum_server::from_tcp_rustls(std_listener, tls)
            .handle(handle)
            .serve(app.into_make_service())
            .await
            .unwrap();
    } else {
        axum_server::from_tcp(std_listener)
            .handle(handle)
            .serve(app.into_make_service())
            .await
            .unwrap();
    }

    tracing::info!("Server stopped");
}

// ── Route handlers ────────────────────────────────────────────────────────────

async fn serve_index(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    let path = &state.config.index_path;
    if path.is_empty() {
        if let Some(content) = Assets::get("index.html") {
            return axum::response::Html(content.data).into_response();
        }
    } else if let Ok(content) = tokio::fs::read(path).await {
        return axum::response::Html(content).into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

async fn serve_asset(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    match Assets::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            ([(axum::http::header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_config(json: &'static str) -> impl IntoResponse {
    ([(axum::http::header::CONTENT_TYPE, "application/json")], json)
}

#[derive(Deserialize)]
struct ExecPayload {
    cmd: String,
}

#[derive(Serialize)]
struct ExecResponse {
    stdout: String,
    stderr: String,
    status: Option<i32>,
}

async fn serve_exec(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ExecPayload>,
) -> impl IntoResponse {
    let cfg = &state.config;

    // Optional auth check, reusing WS logic
    if !cfg.auth_header.is_empty() {
        if headers.get(cfg.auth_header.as_str()).is_none() {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    } else if let Some(ref expected) = state.expected_auth {
        if !ws::check_basic_auth(&headers, expected) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }

    let mut command = Command::new(&cfg.shell);
    command.arg("-c");
    command.arg(&payload.cmd);
    
    // Attempt privilege drop to match CLI
    #[cfg(unix)]
    if let Some(uid) = cfg.uid {
        command.uid(uid);
    }
    #[cfg(unix)]
    if let Some(gid) = cfg.gid {
        command.gid(gid);
    }
    
    // Set cwd
    if !cfg.cwd.is_empty() {
        command.current_dir(&cfg.cwd);
    }

    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    match command.spawn() {
        Ok(mut child) => {
            let stdout_opt = child.stdout.take();
            let stderr_opt = child.stderr.take();

            let stdout_fut = async {
                let mut buf = Vec::new();
                if let Some(mut out) = stdout_opt {
                    let _ = out.read_to_end(&mut buf).await;
                }
                buf
            };

            let stderr_fut = async {
                let mut buf = Vec::new();
                if let Some(mut err) = stderr_opt {
                    let _ = err.read_to_end(&mut buf).await;
                }
                buf
            };

            let (stdout_bytes, stderr_bytes) = tokio::join!(stdout_fut, stderr_fut);

            let res = ExecResponse {
                stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
                stderr: String::from_utf8_lossy(&stderr_bytes).to_string(),
                status: None, // Cannot get reliable exit code because SIGCHLD == SIG_IGN
            };
            (StatusCode::OK, Json(res)).into_response()
        }
        Err(e) => {
            let res = ExecResponse {
                stdout: String::new(),
                stderr: e.to_string(),
                status: None,
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(res)).into_response()
        }
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/// Future that resolves when either Ctrl+C is received or the internal
/// shutdown channel fires.  Used for both `axum::serve` and `axum-server`
/// graceful-shutdown paths.
async fn make_shutdown_signal(mut rx: tokio::sync::watch::Receiver<bool>) {
    tokio::select! {
        _ = signal::ctrl_c() => {
            tracing::info!("Received Ctrl+C, shutting down…");
        }
        _ = async {
            loop {
                rx.changed().await.ok();
                if *rx.borrow() { break; }
            }
        } => {}
    }
}

/// Standard Base64 encoder (RFC 4648 §4).
///
/// Called once at startup to build the expected `Authorization` header value
/// from the configured `credential`, so `ws_handler` can authenticate with a
/// single `==` comparison.
fn base64_encode(input: &str) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let bytes = input.as_bytes();
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n  = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}