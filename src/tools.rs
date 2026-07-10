use axum::http::HeaderMap;
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use crate::config::AppConfig;
use crate::ws::AppState;

/// Combined stdout + stderr bytes captured from command tools.
/// Excess output is drained but not retained, preventing unbounded memory use.
pub(crate) const MAX_CMD_OUTPUT_TOTAL: usize = 10 * 1024 * 1024; // 10 MiB

/// Maximum file size that `read_file` will load into memory.
pub(crate) const MAX_READ_FILE: u64 = 8 * 1024 * 1024; // 8 MiB

/// Maximum custom index.html size accepted from disk.
pub(crate) const MAX_CUSTOM_INDEX_SIZE: u64 = 2 * 1024 * 1024; // 2 MiB

/// Bytes sampled to classify files before deciding whether full reads are safe.
const FILE_TYPE_SAMPLE_SIZE: usize = 8 * 1024;

pub(crate) enum FileRead {
    Text { content: String, size: u64 },
    Binary { size: u64 },
}

// ── Tool definitions (camelCase, Claude Code inspired) ───────────────────────

fn tool_bash() -> Value {
    json!({
        "name": "bash",
        "description": "Execute bash commands or scripts on the remote host. Commands run with 'set -x' (verbose mode) enabled, showing each command before execution for better debugging. Use this as your primary way to explore the environment, run scripts, install dependencies, compile code, and interact with the system. Returns stdout, stderr, and exit code.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The bash command or script to execute. Supports pipes, redirects, and multiline scripts."
                },
                "cwd": {
                    "type": "string",
                    "description": "(Optional) Working directory to run the command in."
                },
                "timeout": {
                    "type": "integer",
                    "description": "(Optional) Timeout in seconds (1-3600, default 300)."
                }
            },
            "required": ["command"]
        }
    })
}

fn tool_read_file() -> Value {
    json!({
        "name": "read_file",
        "description": "Read the complete contents of a UTF-8 text file. Use this to inspect source code, configuration files, logs, or any text-based file. Binary files are not read; metadata and file type information are returned instead.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file."
                }
            },
            "required": ["path"]
        }
    })
}

fn tool_write_file() -> Value {
    json!({
        "name": "write_file",
        "description": "Create a new file or completely overwrite an existing file with the provided content. Use this for creating new files from scratch and for modifying existing files (read it first, then write back the full updated content). For surgical in-place edits, use the 'bash' tool (e.g. sed). Maximum file size: 100MB.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path where the file should be written."
                },
                "content": {
                    "type": "string",
                    "description": "The complete text content to write."
                }
            },
            "required": ["path", "content"]
        }
    })
}

pub fn handle_tools_list() -> Value {
    static TOOLS: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| {
        json!({
            "tools": [
                tool_bash(),
                tool_read_file(),
                tool_write_file()
            ]
        })
    });
    TOOLS.clone()
}

pub fn handle_tools_list_json() -> &'static str {
    static TOOLS_JSON: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| serde_json::to_string(&handle_tools_list()).unwrap_or_default());
    TOOLS_JSON.as_str()
}

/// Unified authentication check for both MCP and REST APIs
pub fn check_auth(state: &AppState, headers: &HeaderMap) -> bool {
    let cfg = &state.config;
    if !cfg.auth_header.is_empty() {
        headers.get(cfg.auth_header.as_str()).is_some()
    } else if let Some(ref expected) = state.expected_auth {
        crate::ws::check_basic_auth(headers, expected)
    } else {
        true
    }
}

/// Call a tool by name with arguments directly (no "arguments" wrapper needed)
pub async fn call_tool(name: &str, arguments: &Value, cfg: &AppConfig) -> Result<Value, String> {
    match name {
        "bash" => bash_tool(arguments, cfg).await,
        "read_file" => read_file_tool(arguments).await,
        "write_file" => write_file_tool(arguments, cfg).await,
        other => Err(format!("Unknown tool: {}", other)),
    }
}

// ── Tool implementations ──────────────────────────────────────────────────────

/// Captured result of running a child process: the (capped) output streams,
/// the exit status if it finished, and whether it was killed for exceeding the
/// timeout. This is the shared "base exec" primitive; callers format it into
/// their own response shape (MCP tool result, JSON, etc.).
pub(crate) struct CommandCapture {
    pub(crate) stdout: CappedOutput,
    pub(crate) stderr: CappedOutput,
    pub(crate) status: Option<std::process::ExitStatus>,
    pub(crate) timed_out: bool,
}

/// Spawn `cmd` with stdout/stderr piped, enforce `timeout_secs`, and capture
/// combined-capped output. Returns `Err` only when the process cannot be
/// spawned; a timeout yields `Ok` with `timed_out = true` (child is killed).
pub(crate) async fn run_command_captured(
    mut cmd: tokio::process::Command,
    timeout_secs: u64,
) -> Result<CommandCapture, String> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), async {
        let budget = output_budget(MAX_CMD_OUTPUT_TOTAL);
        tokio::join!(
            read_capped_text(stdout_pipe, Arc::clone(&budget)),
            read_capped_text(stderr_pipe, budget),
            child.wait()
        )
    })
    .await
    {
        Ok((stdout, stderr, wait)) => Ok(CommandCapture {
            stdout,
            stderr,
            status: wait.ok(),
            timed_out: false,
        }),
        Err(_) => {
            let _ = child.kill().await;
            Ok(CommandCapture {
                stdout: CappedOutput { text: String::new(), truncated: false },
                stderr: CappedOutput { text: String::new(), truncated: false },
                status: None,
                timed_out: true,
            })
        }
    }
}

/// Run a command with a timeout, capping combined stdout/stderr and reporting
/// success/failure as an MCP tool result.
async fn run_command(
    cmd: tokio::process::Command,
    cmd_name: &str,
    timeout_secs: u64,
) -> Result<Value, String> {
    let capture = match run_command_captured(cmd, timeout_secs).await {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn {}: {}", cmd_name, e))),
    };

    if capture.timed_out {
        return Ok(tool_error(format!(
            "{} command timed out after {}s",
            cmd_name, timeout_secs
        )));
    }

    let mut text = capture.stdout.text;
    if capture.stdout.truncated {
        text.push_str("\n... (stdout truncated; combined output limit reached)");
    }
    if !capture.stderr.text.is_empty() {
        if !text.is_empty() {
            text.push_str("\n--- stderr ---\n");
        }
        text.push_str(&capture.stderr.text);
    }
    if capture.stderr.truncated {
        text.push_str("\n... (stderr truncated; combined output limit reached)");
    }
    if text.is_empty() {
        text = "(no output)".into();
    }
    let ok = capture.status.map(|s| s.success()).unwrap_or(false);
    tracing::info!(tool = cmd_name, success = ok, "command finished");
    Ok(if ok { tool_success(text) } else { tool_error(text) })
}

/// Execute bash commands with verbose mode (set -x) enabled.
async fn bash_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    let command = extract_string(args, "command")?;

    let cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cfg.cwd.clone());

    let timeout_secs: u64 = args
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(300)
        .clamp(1, 3600);

    let mut cmd = tokio::process::Command::new("bash");
    let mut verbose_command = String::with_capacity(7 + command.len());
    verbose_command.push_str("set -x\n");
    verbose_command.push_str(&command);
    cmd.arg("-c").arg(&verbose_command);

    if !cwd.is_empty() {
        cmd.current_dir(&cwd);
    }

    #[cfg(unix)]
    if let Some(uid) = cfg.uid {
        cmd.uid(uid);
    }
    #[cfg(unix)]
    if let Some(gid) = cfg.gid {
        cmd.gid(gid);
    }

    run_command(cmd, "bash", timeout_secs).await
}

async fn read_file_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    match read_file_content(&path).await {
        Ok(FileRead::Text { content, .. }) => Ok(tool_success(content)),
        Ok(FileRead::Binary { .. }) => {
            let meta = tokio::fs::metadata(&path).await
                .map_err(|e| format!("Failed to read metadata of '{}': {}", path, e))?;
            let metadata = format_file_metadata(&path, &meta).await;
            Ok(tool_success(format!(
                "Binary file not read. Returning metadata only.\n{}",
                metadata
            )))
        }
        Err(e) => Ok(tool_error(e)),
    }
}

pub(crate) async fn read_file_content(path: &str) -> Result<FileRead, String> {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) if !m.is_file() => {
            return Err(format!("'{}' is not a regular file", path));
        }
        Ok(m) if m.len() > MAX_READ_FILE => {
            return Err(format!(
                "File '{}' is too large ({} bytes, max {} MiB). Use bash tool with head/tail instead.",
                path,
                m.len(),
                MAX_READ_FILE / (1024 * 1024)
            ));
        }
        Err(e) => {
            return Err(format!("Failed to read '{}': {}", path, e));
        }
        Ok(m) => m,
    };

    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Failed to read '{}': {}", path, e))?;
    let sample_len = bytes.len().min(FILE_TYPE_SAMPLE_SIZE);
    if !is_text_content(&bytes[..sample_len]) {
        return Ok(FileRead::Binary { size: meta.len() });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(FileRead::Text { content, size: meta.len() }),
        Err(_) => Ok(FileRead::Binary { size: meta.len() }),
    }
}

async fn write_file_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    if !cfg.writable {
        return Ok(tool_error(
            "Write operations are disabled (hterm is running in read-only mode). \
             Restart with --writable to enable."
                .into(),
        ));
    }

    let path = extract_string(args, "path")?;
    let content = extract_string(args, "content")?;

    const MAX_FILE_SIZE: usize = 100 * 1024 * 1024;
    if content.len() > MAX_FILE_SIZE {
        return Ok(tool_error(format!(
            "Content too large: {} bytes (max {} MB)",
            content.len(),
            MAX_FILE_SIZE / (1024 * 1024)
        )));
    }

    match tokio::fs::write(&path, content).await {
        Ok(_) => Ok(tool_success(format!("Successfully wrote to '{}'", path))),
        Err(e) => Ok(tool_error(format!("Failed to write '{}': {}", path, e))),
    }
}

/// Format metadata for the binary-file branch of `read_file`.
async fn format_file_metadata(path: &str, meta: &std::fs::Metadata) -> String {
    let file_type = if meta.is_dir() {
        "directory"
    } else if meta.is_file() {
        "file"
    } else if meta.is_symlink() {
        "symlink"
    } else {
        "other"
    };

    let permissions = format!("{:o}", meta.permissions().mode() & 0o777);

    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let file_info = if meta.is_file() {
        detect_file_type(path).await
    } else {
        "N/A".to_string()
    };

    format!(
        "Path: {}\n\
         Type: {}\n\
         Size: {} bytes\n\
         Permissions: {}\n\
         Modified: {} (unix timestamp)\n\
         File Info: {}",
        path,
        file_type,
        meta.len(),
        permissions,
        modified,
        file_info
    )
}

/// Detect file type via the `file` command, falling back to extension-based MIME.
async fn detect_file_type(path: &str) -> String {
    let out = tokio::process::Command::new("file")
        .arg("-b")
        .arg("--")
        .arg(path)
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() && !o.stdout.is_empty() => {
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        }
        _ => mime_guess::from_path(path).first_or_octet_stream().to_string(),
    }
}

/// Check if content appears to be text (no null bytes, mostly printable chars)
fn is_text_content(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }

    // If contains null bytes in first 512 bytes, likely binary
    let check_len = bytes.len().min(512);
    if bytes[..check_len].contains(&0) {
        return false;
    }

    // Count printable/whitespace characters
    let printable_count = bytes[..check_len].iter().filter(|&&b| {
        b.is_ascii_graphic() || b.is_ascii_whitespace()
    }).count();

    // If >85% printable, consider it text
    (printable_count as f64 / check_len as f64) > 0.85
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing required argument: {}", key))
        .map(String::from)
}

fn tool_success(msg: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": msg }],
        "isError": false
    })
}

fn tool_error(msg: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": msg }],
        "isError": true
    })
}

pub(crate) struct CappedOutput {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

type OutputBudget = Arc<AtomicUsize>;

pub(crate) fn output_budget(max: usize) -> OutputBudget {
    Arc::new(AtomicUsize::new(max))
}

/// Read from an async reader into a shared output budget, then discard the rest.
/// This bounds combined stdout/stderr memory while letting the child finish.
pub(crate) async fn read_capped_text<R: tokio::io::AsyncRead + Unpin>(
    reader: Option<R>,
    budget: OutputBudget,
) -> CappedOutput {
    use tokio::io::AsyncReadExt;

    let mut reader = match reader {
        Some(r) => r,
        None => return CappedOutput { text: String::new(), truncated: false },
    };
    let mut text = String::with_capacity(8 * 1024);
    let mut truncated = false;
    let mut tmp = [0u8; 8192];

    loop {
        match reader.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => {
                let take = take_output_budget(&budget, n);
                if take > 0 {
                    text.push_str(&String::from_utf8_lossy(&tmp[..take]));
                }
                if take < n {
                    truncated = true;
                    // Keep draining to avoid SIGPIPE killing the child while
                    // retaining no additional command output.
                    tokio::io::copy(&mut reader, &mut tokio::io::sink()).await.ok();
                    break;
                }
            }
            Err(_) => break,
        }
    }

    CappedOutput { text, truncated }
}

fn take_output_budget(budget: &AtomicUsize, requested: usize) -> usize {
    let mut available = budget.load(Ordering::Relaxed);
    loop {
        if available == 0 {
            return 0;
        }
        let take = requested.min(available);
        match budget.compare_exchange_weak(
            available,
            available - take,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return take,
            Err(next) => available = next,
        }
    }
}
