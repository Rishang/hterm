use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// xterm.js theme configuration — maps directly to xterm.js ITheme.
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
            background: Some("#1e1e2e".into()),
            foreground: Some("#cdd6f4".into()),
            cursor: Some("#f5e0dc".into()),
            cursor_accent: Some("#1e1e2e".into()),
            selection_background: Some("#585b70".into()),
            selection_foreground: Some("#cdd6f4".into()),
            black: Some("#45475a".into()),
            red: Some("#f38ba8".into()),
            green: Some("#a6e3a1".into()),
            yellow: Some("#f9e2af".into()),
            blue: Some("#89b4fa".into()),
            magenta: Some("#f5c2e7".into()),
            cyan: Some("#94e2d5".into()),
            white: Some("#bac2de".into()),
            bright_black: Some("#585b70".into()),
            bright_red: Some("#f38ba8".into()),
            bright_green: Some("#a6e3a1".into()),
            bright_yellow: Some("#f9e2af".into()),
            bright_blue: Some("#89b4fa".into()),
            bright_magenta: Some("#f5c2e7".into()),
            bright_cyan: Some("#94e2d5".into()),
            bright_white: Some("#a6adc8".into()),
            font_family: Some("'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace".into()),
            font_size: Some(15),
        }
    }
}

/// Application config loaded from config.json, overrideable by CLI flags.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,
    #[serde(default = "default_true")]
    pub writable: bool,
    #[serde(default)]
    pub max_clients: u32,
    #[serde(default)]
    pub once: bool,
    #[serde(default)]
    pub exit_no_conn: bool,
    #[serde(default)]
    pub check_origin: bool,
    #[serde(default)]
    pub credential: String,
    #[serde(default)]
    pub base_path: String,
    #[serde(default)]
    pub index_path: String,
    #[serde(default = "default_ping_interval")]
    pub ping_interval: u64,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub ssl_cert: String,
    #[serde(default)]
    pub ssl_key: String,
    #[serde(default)]
    pub theme: ThemeConfig,
}

fn default_port() -> u16 { 7681 }
fn default_host() -> String { "127.0.0.1".into() }
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
}
fn default_terminal_type() -> String { "xterm-256color".into() }
fn default_true() -> bool { true }
fn default_ping_interval() -> u64 { 5 }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            host: default_host(),
            shell: default_shell(),
            cwd: String::new(),
            terminal_type: default_terminal_type(),
            writable: true,
            max_clients: 0,
            once: false,
            exit_no_conn: false,
            check_origin: false,
            credential: String::new(),
            base_path: String::new(),
            index_path: String::new(),
            ping_interval: default_ping_interval(),
            ssl: false,
            ssl_cert: String::new(),
            ssl_key: String::new(),
            theme: ThemeConfig::default(),
        }
    }
}

impl AppConfig {
    /// Load config from a JSON file, falling back to defaults for missing fields.
    pub fn load(path: &str) -> Self {
        let p = Path::new(path);
        if !p.exists() {
            return Self::default();
        }
        match fs::read_to_string(p) {
            Ok(data) => match serde_json::from_str(&data) {
                Ok(cfg) => cfg,
                Err(e) => {
                    tracing::warn!("Could not parse {}: {}", path, e);
                    Self::default()
                }
            },
            Err(e) => {
                tracing::warn!("Could not read {}: {}", path, e);
                Self::default()
            }
        }
    }
}

/// Response shape for GET /api/config.
#[derive(Serialize)]
pub struct ConfigResponse {
    pub theme: ThemeConfig,
    pub writable: bool,
}
