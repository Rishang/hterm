mod config;
mod pty;
mod ws;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use nix::libc;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use clap::Parser;
use rust_embed::Embed;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::signal;

#[derive(Embed)]
#[folder = "ui/dist/"]
struct Assets;

use config::{AppConfig, ConfigResponse};
use ws::AppState;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser, Debug)]
#[command(name = "hterm", about = "Share your terminal over the web", version = VERSION)]
struct Cli {
    /// Port to listen (default: 7681, use 0 for random)
    #[arg(short = 'p', long = "port")]
    port: Option<u16>,

    /// Host/interface to bind (default: 127.0.0.1)
    #[arg(short = 'H', long = "host")]
    host: Option<String>,

    /// Shell to use (default: $SHELL or /bin/bash)
    #[arg(long)]
    shell: Option<String>,

    /// Working directory for the shell
    #[arg(short = 'w', long = "cwd")]
    cwd: Option<String>,

    /// Terminal type to report (default: xterm-256color)
    #[arg(short = 'T', long = "terminal-type")]
    terminal_type: Option<String>,

    /// Allow clients to write to the TTY
    #[arg(short = 'W', long = "writable")]
    writable: bool,

    /// Make terminal read-only (overrides -W)
    #[arg(short = 'R', long = "readonly")]
    readonly: bool,

    /// Maximum clients (default: 0, no limit)
    #[arg(short = 'm', long = "max-clients")]
    max_clients: Option<u32>,

    /// Accept only one client and exit on disconnection
    #[arg(short = 'o', long = "once")]
    once: bool,

    /// Exit on all clients disconnection
    #[arg(short = 'q', long = "exit-no-conn")]
    exit_no_conn: bool,

    /// Do not allow websocket connection from different origin
    #[arg(short = 'O', long = "check-origin")]
    check_origin: bool,

    /// Credential for basic auth (format: username:password)
    #[arg(short = 'c', long = "credential")]
    credential: Option<String>,

    /// Base path for reverse proxy
    #[arg(short = 'b', long = "base-path")]
    base_path: Option<String>,

    /// Custom index.html path
    #[arg(short = 'I', long = "index")]
    index: Option<String>,

    /// WebSocket ping interval in seconds (default: 5)
    #[arg(short = 'P', long = "ping-interval")]
    ping_interval: Option<u64>,

    /// Enable SSL/TLS
    #[arg(short = 'S', long)]
    ssl: bool,

    /// SSL certificate file path
    #[arg(short = 'C', long = "ssl-cert")]
    ssl_cert: Option<String>,

    /// SSL key file path
    #[arg(short = 'K', long = "ssl-key")]
    ssl_key: Option<String>,

    /// Enable debug logging
    #[arg(short = 'd', long)]
    debug: bool,

    /// Path to config.json
    #[arg(long, default_value = "config.json")]
    config: String,

    /// Shell command (positional argument)
    #[arg(trailing_var_arg = true)]
    command: Vec<String>,
}

// current_thread: one OS thread, one ~2 MB stack.  All async awaits yield
// correctly so multiple concurrent sessions are handled without parallelism.
// multi_thread would spin up N×2 MB worker threads (N = num_cpus) for no gain
// here, since the bottleneck is PTY I/O, not CPU.
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();

    let filter = if cli.debug { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .compact()
        .init();

    // Auto-reap child processes (PTY shells) the moment they exit.
    // POSIX: setting SIGCHLD to SIG_IGN causes the kernel to reap children
    // immediately, producing no zombies.  This is cheaper than any waitpid
    // strategy and requires zero per-session overhead.
    unsafe { libc::signal(libc::SIGCHLD, libc::SIG_IGN); }

    let mut cfg = AppConfig::load(&cli.config);

    if let Some(p) = cli.port          { cfg.port = p; }
    if let Some(h) = cli.host          { cfg.host = h; }
    if let Some(s) = cli.shell         { cfg.shell = s; }
    if !cli.command.is_empty()          { cfg.shell = cli.command[0].clone(); }
    if let Some(c) = cli.cwd           { cfg.cwd = c; }
    if let Some(t) = cli.terminal_type { cfg.terminal_type = t; }
    if cli.writable                     { cfg.writable = true; }
    if cli.readonly                     { cfg.writable = false; }
    if let Some(m) = cli.max_clients   { cfg.max_clients = m; }
    if cli.once                         { cfg.once = true; }
    if cli.exit_no_conn                 { cfg.exit_no_conn = true; }
    if cli.check_origin                 { cfg.check_origin = true; }
    if let Some(c) = cli.credential    { cfg.credential = c; }
    if let Some(b) = cli.base_path     { cfg.base_path = b.trim_end_matches('/').to_string(); }
    if let Some(i) = cli.index         { cfg.index_path = i; }
    if let Some(p) = cli.ping_interval { cfg.ping_interval = p; }
    if cli.ssl                          { cfg.ssl = true; }
    if let Some(c) = cli.ssl_cert      { cfg.ssl_cert = c; }
    if let Some(k) = cli.ssl_key       { cfg.ssl_key = k; }

    if !Path::new(&cfg.shell).exists() {
        tracing::error!("Shell not found: {}", cfg.shell);
        std::process::exit(1);
    }
    if !cfg.cwd.is_empty() && !Path::new(&cfg.cwd).is_dir() {
        tracing::error!("Working directory not valid: {}", cfg.cwd);
        std::process::exit(1);
    }
    if cfg.ssl && (cfg.ssl_cert.is_empty() || cfg.ssl_key.is_empty()) {
        tracing::error!("SSL enabled but --ssl-cert and --ssl-key are required");
        std::process::exit(1);
    }

    // Serialise config once at startup; leak for a 'static reference valid for the
    // server's lifetime, avoiding per-request serialisation or Arc overhead.
    let config_json: &'static str = Box::leak(
        serde_json::to_string(&ConfigResponse {
            theme: cfg.theme.clone(),
            writable: cfg.writable,
        })
        .unwrap()
        .into_boxed_str(),
    );

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    let state = Arc::new(AppState {
        config: cfg.clone(),
        client_count: std::sync::atomic::AtomicU32::new(0),
        shutdown_tx,
    });

    let bp = cfg.base_path.clone();

    let app = Router::new()
        .route(&format!("{}/", bp),                 get(serve_index))
        .route(&format!("{}/api/config", bp),        get(move || async move { serve_config(config_json).await }))
        .route(&format!("{}/ws", bp),                get(ws::ws_handler))
        .route(&format!("{}/static/{{*path}}", bp), get(serve_asset))
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", cfg.host, cfg.port)
        .parse()
        .expect("Invalid address");

    tracing::info!("hterm v{} starting on http://{}{}", VERSION, addr, bp);
    tracing::info!(
        "Shell: {} | Terminal: {} | Writable: {}",
        cfg.shell, cfg.terminal_type, cfg.writable
    );

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = signal::ctrl_c() => tracing::info!("Received Ctrl+C, shutting down..."),
                _ = async {
                    loop {
                        shutdown_rx.changed().await.ok();
                        if *shutdown_rx.borrow() { break; }
                    }
                } => {}
            }
        })
        .await
        .unwrap();

    tracing::info!("Server stopped");
}

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