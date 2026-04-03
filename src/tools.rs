use axum::http::HeaderMap;
use serde_json::{json, Value};
use crate::config::AppConfig;
use crate::ws::AppState;

// ── Tool definitions (static, built once) ────────────────────────────────────

fn tool_run_command() -> Value {
    json!({
        "name": "run_command",
        "description": "Execute an arbitrary shell command on the remote host system. Use this tool heavily as your primary way to explore the host environment, execute scripts, install dependencies, compile code, and run system utilities. The command runs non-interactively via the user's configured shell (default $SHELL), but you can span complex pipelines. Returns stdout, stderr, and exit code. An enforced timeout applies (default 5 min) to prevent infinite hanging.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The exact shell command line string to execute, supporting standard piping and quoting rules."
                },
                "cwd": {
                    "type": "string",
                    "description": "(Optional) Absolute directory path to run the command inside."
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "(Optional) Command timeout in seconds. Allowed values: 1–3600 (default 300)."
                }
            },
            "required": ["command"]
        }
    })
}

fn tool_read_file() -> Value {
    json!({
        "name": "read_file",
        "description": "Read the exact, raw text contents of a specified file on the remote host filesystem. Use this when you need to inspect source code, configuration files, or logs directly. Returns the entire UTF-8 string content.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or relative path to the file to be read." }
            },
            "required": ["path"]
        }
    })
}

fn tool_write_file() -> Value {
    json!({
        "name": "write_file",
        "description": "Write arbitrary text content to a file on the remote host filesystem, replacing existing contents. If the file does not exist, it will be created. Use this for programmatic file edits instead of running echo/cat pipelines via run_command.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or relative path where the file should be saved." },
                "content": { "type": "string", "description": "The full text content to write into the file." }
            },
            "required": ["path", "content"]
        }
    })
}

fn tool_list_processes() -> Value {
    json!({
        "name": "list_processes",
        "description": "Fetch which processes are actively executing on the host system. Returns a tabular text format containing PID, CPU%, MEM%, user, and command line. Useful for monitoring background jobs or checking if a daemon is alive.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    })
}

fn tool_list_files() -> Value {
    json!({
        "name": "list_files",
        "description": "Inspect the contents of a specific directory on the host filesystem. Provides a detailed list of files and folders including ownership, permissions, and sizes (equivalent to 'ls -la'). Use this to browse directories rather than running run_command.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or relative path of the directory to inspect." }
            },
            "required": ["path"]
        }
    })
}

fn tool_list_tree() -> Value {
    json!({
        "name": "list_tree",
        "description": "Generate a recursive visual tree of all files and folders from a root directory. Uses the 'tree' command if available, falling back to 'find'. You can bound the depth to prevent huge outputs.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The root directory to begin the tree from." },
                "max_depth": {
                    "type": "integer",
                    "description": "(Optional) Maximum depth to traverse recursively. Defaults to 3 if omitted."
                }
            },
            "required": ["path"]
        }
    })
}

fn tool_count_file_lines() -> Value {
    json!({
        "name": "count_file_lines",
        "description": "Return the total line count of a text file. Best used before invoking read_file to ensure you don't accidentally ingest massive payloads that overflow context limits.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or relative path to the file." }
            },
            "required": ["path"]
        }
    })
}

fn tool_read_file_size() -> Value {
    json!({
        "name": "read_file_size",
        "description": "Return the exact byte-size of a file. Useful for verifying sizes before pulling content into the context window.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Absolute or relative path to the file to measure." }
            },
            "required": ["path"]
        }
    })
}


pub fn handle_tools_list() -> Value {
    json!({
        "tools": [
            tool_run_command(),
            tool_read_file(),
            tool_write_file(),
            tool_list_processes(),
            tool_list_files(),
            tool_list_tree(),
            tool_count_file_lines(),
            tool_read_file_size()
        ]
    })
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
        "run_command" => run_command_tool(arguments, cfg).await,
        "read_file" => read_file_tool(arguments).await,
        "write_file" => write_file_tool(arguments, cfg).await,
        "list_processes" => list_processes_tool().await,
        "list_files" => list_files_tool(arguments).await,
        "list_tree" => list_tree_tool(arguments, cfg).await,
        "count_file_lines" => count_file_lines_tool(arguments).await,
        "read_file_size" => read_file_size_tool(arguments).await,
        other => Err(format!("Unknown tool: {}", other)),
    }
}

// ── Tool implementations ──────────────────────────────────────────────────────
// All tools now receive arguments directly without wrapper

/// Helper to run a command with a timeout and standardized error handling.
/// Eliminates duplication across list_processes, list_files, count_file_lines, etc.
async fn run_simple_command_with_timeout(
    mut cmd: tokio::process::Command,
    cmd_name: &str,
    timeout_secs: u64,
) -> Result<Value, String> {
    let timeout = tokio::time::Duration::from_secs(timeout_secs);

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn {}: {}", cmd_name, e))),
    };

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => handle_cmd_output(Ok(output)),
        Ok(Err(e)) => Ok(tool_error(format!("{} command failed: {}", cmd_name, e))),
        Err(_) => Ok(tool_error(format!("{} command timed out after {}s", cmd_name, timeout_secs))),
    }
}

async fn read_file_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(tool_success(content)),
        Err(e) => Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
    }
}

/// Write file — guarded by the `writable` config flag so a read-only hterm
/// instance cannot be used to modify the host filesystem via MCP.
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

    // Enforce a 100 MB size limit to prevent disk filling attacks
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

async fn list_processes_tool() -> Result<Value, String> {
    let mut cmd = tokio::process::Command::new("ps");
    cmd.arg("aux");
    run_simple_command_with_timeout(cmd, "ps", 10).await
}

async fn list_files_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;
    let mut cmd = tokio::process::Command::new("ls");
    cmd.arg("-la").arg(&path);
    run_simple_command_with_timeout(cmd, "ls", 10).await
}

/// Produce a real directory tree.
///
/// Strategy:
///   1. Try `tree -L <depth> <path>` — most readable output.
///   2. Fall back to `find <path> -maxdepth <depth>` sorted and indented.
///
/// Both are run via the system shell so they respect `$PATH`.
async fn list_tree_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    let path = extract_string(args, "path")?;
    let max_depth = args
        .get("max_depth")
        .and_then(Value::as_u64)
        .unwrap_or(3)
        .clamp(1, 20);

    // Try `tree` first; if it's absent the shell will exit non-zero and we fall
    // back to a `find`-based simulation that produces indented output.
    let tree_cmd = format!(
        "tree -L {depth} -- {path} 2>/dev/null || \
         find {path} -maxdepth {depth} | sort | \
         awk -F/ '{{indent=\"\"; for(i=NF-1;i>0;i--) indent=indent\"  \"; print indent $NF}}'",
        depth = max_depth,
        path = shell_escape(&path),
    );

    let mut cmd = tokio::process::Command::new(&cfg.shell);
    cmd.arg("-c").arg(&tree_cmd);
    run_simple_command_with_timeout(cmd, "tree/find", 10).await
}

async fn count_file_lines_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;
    let mut cmd = tokio::process::Command::new("wc");
    cmd.arg("-l").arg(&path);
    run_simple_command_with_timeout(cmd, "wc", 10).await
}

async fn read_file_size_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    match tokio::fs::metadata(&path).await {
        Ok(meta) => Ok(tool_success(format!("{} bytes", meta.len()))),
        Err(e) => Ok(tool_error(format!(
            "Failed to read size of '{}': {}",
            path, e
        ))),
    }
}

/// Run an arbitrary shell command with an optional timeout and cwd.
///
/// # SIGCHLD note
/// The parent process sets `SIGCHLD = SIG_IGN` so that shell children are
/// auto-reaped by the kernel.  Tokio's process handling uses `pidfd_open(2)`
/// on Linux (≥ 5.3), which reaps independently of the signal disposition.
/// On macOS / older kernels Tokio falls back to a global SIGCHLD handler it
/// installs via `libc::sigaction`, which *overrides* SIG_IGN for its own
/// children — so exit-status retrieval still works correctly on all supported
/// platforms.
async fn run_command_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    let command = extract_string(args, "command")?;

    let cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cfg.cwd.clone());

    let timeout_secs: u64 = args
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(300)
        .clamp(1, 3600);

    let mut cmd = tokio::process::Command::new(&cfg.shell);
    cmd.arg("-c").arg(&command);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

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

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn command: {}", e))),
    };

    let timeout = tokio::time::Duration::from_secs(timeout_secs);
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Ok(tool_error(format!("Command I/O error: {}", e))),
        Err(_elapsed) => {
            return Ok(tool_error(format!(
                "Command timed out after {}s: {}",
                timeout_secs, command
            )));
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code().unwrap_or(-1);

    let mut text = String::new();
    if !stdout_str.is_empty() {
        text.push_str(&stdout_str);
    }
    if !stderr_str.is_empty() {
        if !text.is_empty() {
            text.push_str("\n--- stderr ---\n");
        }
        text.push_str(&stderr_str);
    }
    if text.is_empty() {
        text = "(no output)".into();
    }

    let is_error = !output.status.success();
    tracing::info!(exit_code, "MCP run_command finished");

    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing required argument: {}", key))
        .map(String::from)
}

fn handle_cmd_output(
    output: std::io::Result<std::process::Output>,
) -> Result<Value, String> {
    match output {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.is_empty() {
                if !text.is_empty() {
                    text.push_str("\n--- stderr ---\n");
                }
                text.push_str(&stderr);
            }
            if text.is_empty() {
                text = "(no output)".into();
            }
            if out.status.success() {
                Ok(tool_success(text))
            } else {
                Ok(tool_error(text))
            }
        }
        Err(e) => Ok(tool_error(format!("Command execution failed: {}", e))),
    }
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

/// Minimal single-quote shell escaping: wraps the string in single quotes and
/// escapes any embedded single quotes as `'\''`.
/// Used only for building the `list_tree` fallback command.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}