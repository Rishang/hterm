use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// xterm.js theme — maps directly to `ITheme`.
///
/// Every field is optional; missing keys are omitted from JSON so xterm.js
/// falls back to its own defaults rather than receiving `null`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_accent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_foreground: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub red: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub green: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yellow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub magenta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cyan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_black: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_red: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_green: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_yellow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_blue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_magenta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_cyan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bright_white: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u16>,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            background:          Some("#1c1d1f".into()),
            foreground:          Some("#abb2bf".into()),
            cursor:              Some("#528bff".into()),
            cursor_accent:       None,
            selection_background:None,
            selection_foreground:None,
            black:               Some("#282c34".into()),
            red:                 Some("#e06c75".into()),
            green:               Some("#98c379".into()),
            yellow:              Some("#e5c07b".into()),
            blue:                Some("#61afef".into()),
            magenta:             Some("#c678dd".into()),
            cyan:                Some("#56b6c2".into()),
            white:               Some("#abb2bf".into()),
            bright_black:        Some("#5c6370".into()),
            bright_red:          Some("#e06c75".into()),
            bright_green:        Some("#98c379".into()),
            bright_yellow:       Some("#e5c07b".into()),
            bright_blue:         Some("#61afef".into()),
            bright_magenta:      Some("#c678dd".into()),
            bright_cyan:         Some("#56b6c2".into()),
            bright_white:        Some("#ffffff".into()),
            font_family:         Some("'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace".into()),
            font_size:           Some(14),
        }
    }
}

/// Full application configuration loaded from `config.json`.
///
/// All fields carry serde defaults so partial JSON files work; missing keys
/// fall back to the same values as [`AppConfig::default`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    // ── Network ───────────────────────────────────────────────────────────────

    /// TCP port to listen on (default: 7681, 0 = random).
    #[serde(default = "default_port")]
    pub port: u16,

    /// Host/interface to bind. Accepts IPv4 (`127.0.0.1`), IPv6 (`::1` / `::`),
    /// or a hostname. When `unix_socket` is non-empty this field is ignored.
    #[serde(default = "default_host")]
    pub host: String,

    /// Bind to a Unix domain socket path instead of a TCP port.
    /// When set, `host`, `port`, and `ssl` are all ignored.
    /// Unix sockets are not available on Windows.
    #[serde(default)]
    pub unix_socket: String,

    // ── Shell ─────────────────────────────────────────────────────────────────

    /// Shell executable (default: `$SHELL` or `/bin/bash`).
    #[serde(default = "default_shell")]
    pub shell: String,

    /// Working directory for the spawned shell. Empty means inherit.
    #[serde(default)]
    pub cwd: String,

    /// `TERM` environment variable reported to the shell.
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,

    // ── Access control ────────────────────────────────────────────────────────

    /// Allow clients to write keystrokes to the TTY (read-only by default for
    /// safety, matching ttyd's `-W` / `--writable` convention).
    #[serde(default = "default_true")]
    pub writable: bool,

    /// Maximum concurrent clients (0 = unlimited).
    #[serde(default)]
    pub max_clients: u32,

    /// Exit after the first client disconnects.
    #[serde(default)]
    pub once: bool,

    /// Exit when the last client disconnects.
    #[serde(default)]
    pub exit_no_conn: bool,

    /// Reject WebSocket upgrades whose `Origin` header doesn't match `Host`.
    #[serde(default)]
    pub check_origin: bool,

    /// HTTP Basic Auth credential in `username:password` format.
    /// Empty disables Basic Auth.
    #[serde(default)]
    pub credential: String,

    /// HTTP header name for reverse-proxy authentication (e.g. `X-Remote-User`).
    ///
    /// When non-empty, the server trusts this header (set by the upstream proxy)
    /// to mean the request is authenticated, and skips Basic Auth entirely.
    /// The header *value* is treated as the username and logged, but not
    /// validated — only use this behind a trusted proxy.
    #[serde(default)]
    pub auth_header: String,

    // ── Reverse-proxy / routing ───────────────────────────────────────────────

    /// URL prefix for reverse-proxy deployments (e.g. `/terminal`).
    #[serde(default)]
    pub base_path: String,

    /// Serve a custom `index.html` from this path instead of the embedded one.
    #[serde(default)]
    pub index_path: String,

    // ── Behaviour ─────────────────────────────────────────────────────────────

    /// Allow clients to append extra shell arguments via the WebSocket URL's
    /// query string (e.g. `ws://host/ws?arg=-c&arg=ls`).
    ///
    /// When enabled, repeated `arg=<value>` pairs are decoded and appended to
    /// the shell's argv before `execve`.  Disabled by default because it lets
    /// any connected client run arbitrary commands.
    #[serde(default)]
    pub url_arg: bool,

    /// WebSocket keepalive ping interval in seconds.
    #[serde(default = "default_ping_interval")]
    pub ping_interval: u64,

    // ── Privilege drop ────────────────────────────────────────────────────────

    /// Drop to this numeric user ID **in each spawned shell child**.
    /// The server process itself keeps its original UID so it can accept
    /// new connections and bind to the configured port.
    #[serde(default)]
    pub uid: Option<u32>,

    /// Drop to this numeric group ID **in each spawned shell child**.
    /// Applied before `uid` drop in the child.
    #[serde(default)]
    pub gid: Option<u32>,

    // ── TLS ───────────────────────────────────────────────────────────────────

    /// Enable TLS.  Requires `ssl_cert` and `ssl_key`.
    #[serde(default)]
    pub ssl: bool,

    #[serde(default)]
    pub ssl_cert: String,

    #[serde(default)]
    pub ssl_key: String,

    // ── Terminal feature hints (forwarded to the frontend) ────────────────────

    /// Tell the frontend to enable Sixel graphics support in xterm.js.
    ///
    /// Sixel escape sequences pass through the PTY transparently; this flag
    /// enables the xterm.js `SixelAddon` on the client side.
    #[serde(default)]
    pub sixel: bool,

    #[serde(default)]
    pub theme: ThemeConfig,
}

fn default_port()          -> u16    { 7681 }
fn default_host()          -> String { "127.0.0.1".into() }
fn default_shell()         -> String { std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()) }
fn default_terminal_type() -> String { "xterm-256color".into() }
fn default_true()          -> bool   { true }
fn default_ping_interval() -> u64    { 5 }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port:          default_port(),
            host:          default_host(),
            unix_socket:   String::new(),
            shell:         default_shell(),
            cwd:           String::new(),
            terminal_type: default_terminal_type(),
            writable:      true,
            max_clients:   0,
            once:          false,
            exit_no_conn:  false,
            check_origin:  false,
            credential:    String::new(),
            auth_header:   String::new(),
            base_path:     String::new(),
            index_path:    String::new(),
            url_arg:       false,
            ping_interval: default_ping_interval(),
            uid:           None,
            gid:           None,
            ssl:           false,
            ssl_cert:      String::new(),
            ssl_key:       String::new(),
            sixel:         false,
            theme:         ThemeConfig::default(),
        }
    }
}

impl AppConfig {
    /// Load from a JSON file, falling back to [`Default`] for any missing field.
    pub fn load(path: &str) -> Self {
        let p = Path::new(path);
        if !p.exists() { return Self::default(); }
        match fs::read_to_string(p) {
            Ok(data)  => match serde_json::from_str(&data) {
                Ok(cfg) => cfg,
                Err(e)  => { tracing::warn!("Cannot parse {}: {}", path, e); Self::default() }
            },
            Err(e) => { tracing::warn!("Cannot read {}: {}", path, e); Self::default() }
        }
    }
}

/// Response body for `GET /api/config`.
///
/// Only the fields the browser needs are included.
/// Secrets (credentials, key file paths) are never sent to the client.
#[derive(Serialize)]
pub struct ConfigResponse {
    pub theme:    ThemeConfig,
    pub writable: bool,
    /// Whether to activate the Sixel graphics addon in xterm.js.
    pub sixel:    bool,
    /// Whether the server will honour `?arg=` query parameters on the WS URL.
    pub url_arg:  bool,
}