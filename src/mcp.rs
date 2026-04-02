//! MCP (Model Context Protocol) server — stdio transport.
//!
//! When hterm is launched with `--mcp` it does **not** start the HTTP/WebSocket
//! server. Instead this module owns the process:
//!
//! 1. Reads newline-delimited JSON-RPC 2.0 messages from **stdin**.
//! 2. Dispatches `initialize`, `tools/list`, `tools/call`, and handles
//!    notification-only messages (no `id` field) silently.
//! 3. Writes newline-delimited JSON responses to **stdout**.
//! 4. All tracing/diagnostic output goes to **stderr** so it never pollutes
//!    the JSON-RPC stream.
//!
//! Protocol version: `2024-11-05` (initial stable MCP release).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::config::AppConfig;

const PROTOCOL_VERSION: &str = "2024-11-05";

// ── JSON-RPC envelope types ───────────────────────────────────────────────────

/// An incoming JSON-RPC 2.0 request/notification from the MCP client.
///
/// `id` is `None` for notifications (which must not be replied to).
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    // `jsonrpc` field is required by spec but we don't need to inspect it.
    #[allow(dead_code)]
    jsonrpc: String,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// A JSON-RPC 2.0 success response.
#[derive(Debug, Serialize)]
struct JsonRpcResponse<'a> {
    jsonrpc: &'a str,
    id: &'a Value,
    result: Value,
}

/// A JSON-RPC 2.0 error response.
#[derive(Debug, Serialize)]
struct JsonRpcError<'a> {
    jsonrpc: &'a str,
    id: &'a Value,
    error: RpcError,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

// ── Standard JSON-RPC error codes ────────────────────────────────────────────
const PARSE_ERROR:      i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS:   i32 = -32602;

// ── Tool definitions (static, built once) ────────────────────────────────────


fn tool_run_command() -> Value {
    json!({
        "name": "run_command",
        "description": "Execute a shell command on the remote host and return its stdout and stderr. \
                         Commands run non-interactively via the configured shell (default: $SHELL). \
                         A 30-second timeout is enforced.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "The shell command to execute" },
                "cwd": { "type": "string", "description": "(Optional) Working directory" },
                "timeout_secs": { "type": "integer", "description": "(Optional) Execution timeout in seconds, 1-300" }
            },
            "required": ["command"]
        }
    })
}

fn tool_read_file() -> Value {
    json!({
        "name": "read_file",
        "description": "Read the contents of a file as a string.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file to read" }
            },
            "required": ["path"]
        }
    })
}

fn tool_write_file() -> Value {
    json!({
        "name": "write_file",
        "description": "Write text content to a file (overwrites existing).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file to write" },
                "content": { "type": "string", "description": "Text content to write" }
            },
            "required": ["path", "content"]
        }
    })
}

fn tool_list_processes() -> Value {
    json!({
        "name": "list_processes",
        "description": "List running processes on the system (runs 'ps aux').",
        "inputSchema": {
            "type": "object",
            "properties": {},
        }
    })
}

fn tool_list_files() -> Value {
    json!({
        "name": "list_files",
        "description": "List files in a directory with details (runs 'ls -la').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Directory path to list" }
            },
            "required": ["path"]
        }
    })
}

fn tool_list_tree() -> Value {
    json!({
        "name": "list_tree",
        "description": "List directory tree recursively (runs 'find' or 'tree').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Directory path" },
                "max_depth": { "type": "integer", "description": "(Optional) Max depth (default 3)" }
            },
            "required": ["path"]
        }
    })
}

fn tool_count_file_lines() -> Value {
    json!({
        "name": "count_file_lines",
        "description": "Count the number of lines in a file (runs 'wc -l').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file" }
            },
            "required": ["path"]
        }
    })
}

fn tool_read_file_size() -> Value {
    json!({
        "name": "read_file_size",
        "description": "Read the file size in bytes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file" }
            },
            "required": ["path"]
        }
    })
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Run the MCP stdio server loop.  Never returns under normal operation; exits
/// when stdin is closed (i.e. the MCP host terminates the process).
pub async fn run_mcp_server(cfg: AppConfig) {
    tracing::info!("hterm MCP server starting (stdio transport)");

    let stdin  = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let mut reader = BufReader::new(stdin).lines();
    let mut writer = tokio::io::BufWriter::new(stdout);

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        // ── Parse ─────────────────────────────────────────────────────────────
        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r)  => r,
            Err(e) => {
                tracing::warn!("MCP parse error: {}", e);
                // Use JSON null as the id when parsing fails entirely.
                let resp = JsonRpcError {
                    jsonrpc: "2.0",
                    id:      &Value::Null,
                    error:   RpcError { code: PARSE_ERROR, message: e.to_string() },
                };
                send(&mut writer, &resp).await;
                continue;
            }
        };

        // ── Notifications (no id) — no reply ──────────────────────────────────
        if request.id.is_none() {
            tracing::debug!("MCP notification: {}", request.method);
            continue;
        }
        let id = request.id.as_ref().unwrap();

        tracing::debug!(method = %request.method, "MCP request");

        // ── Dispatch ──────────────────────────────────────────────────────────
        let result: Value = match request.method.as_str() {
            "initialize" => handle_initialize(&request.params),
            "tools/list" => handle_tools_list(),
            "tools/call" => match handle_tools_call(&request.params, &cfg).await {
                Ok(v)  => v,
                Err(e) => {
                    let resp = JsonRpcError {
                        jsonrpc: "2.0",
                        id,
                        error: e,
                    };
                    send(&mut writer, &resp).await;
                    continue;
                }
            },
            // Ping — just acknowledge with an empty result.
            "ping" => json!({}),
            other => {
                tracing::debug!("MCP unknown method: {}", other);
                let resp = JsonRpcError {
                    jsonrpc: "2.0",
                    id,
                    error: RpcError {
                        code: METHOD_NOT_FOUND,
                        message: format!("Method not found: {}", other),
                    },
                };
                send(&mut writer, &resp).await;
                continue;
            }
        };

        let resp = JsonRpcResponse { jsonrpc: "2.0", id, result };
        send(&mut writer, &resp).await;
    }

    tracing::info!("MCP stdin closed — shutting down");
}

// ── Serialise & write one newline-delimited JSON message ─────────────────────

async fn send<T: Serialize>(writer: &mut tokio::io::BufWriter<tokio::io::Stdout>, msg: &T) {
    match serde_json::to_string(msg) {
        Ok(json) => {
            if let Err(e) = writer.write_all(json.as_bytes()).await {
                tracing::error!("MCP stdout write error: {}", e);
                return;
            }
            if let Err(e) = writer.write_all(b"\n").await {
                tracing::error!("MCP stdout write error: {}", e);
                return;
            }
            if let Err(e) = writer.flush().await {
                tracing::error!("MCP stdout flush error: {}", e);
            }
        }
        Err(e) => {
            tracing::error!("MCP serialization error: {}", e);
        }
    }
}

// ── Method handlers ───────────────────────────────────────────────────────────

fn handle_initialize(_params: &Value) -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name":    "hterm",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn handle_tools_list() -> Value {
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

// ── tools/call ────────────────────────────────────────────────────────────────

async fn handle_tools_call(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code:    INVALID_PARAMS,
            message: "Missing required field: name".into(),
        })?;

    tracing::info!(tool = %name, "MCP tools/call");

    match name {
        "run_command" => run_command_tool(params, cfg).await,
        "read_file" => read_file_tool(params).await,
        "write_file" => write_file_tool(params).await,
        "list_processes" => list_processes_tool(params).await,
        "list_files" => list_files_tool(params).await,
        "list_tree" => list_tree_tool(params).await,
        "count_file_lines" => count_file_lines_tool(params).await,
        "read_file_size" => read_file_size_tool(params).await,
        other => Err(RpcError {
            code: INVALID_PARAMS,
            message: format!("Unknown tool: {}", other),
        }),
    }
}

// ── Tool Implementations ──────────────────────────────────────────────────────

async fn read_file_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(tool_success(content)),
        Err(e) => Ok(tool_error(format!("Failed to read file: {}", e))),
    }
}

async fn write_file_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    let content = extract_string(args, "content")?;
    
    match tokio::fs::write(&path, content).await {
        Ok(_) => Ok(tool_success(format!("Successfully wrote to {}", path))),
        Err(e) => Ok(tool_error(format!("Failed to write file: {}", e))),
    }
}

async fn list_processes_tool(_params: &Value) -> Result<Value, RpcError> {
    let output = tokio::process::Command::new("ps")
        .arg("aux")
        .output()
        .await;
    
    handle_cmd_output(output)
}

async fn list_files_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    
    let output = tokio::process::Command::new("ls")
        .arg("-la")
        .arg(&path)
        .output()
        .await;
        
    handle_cmd_output(output)
}

async fn list_tree_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    let max_depth = args.get("max_depth").and_then(Value::as_u64).unwrap_or(3);
    
    // Using find as standard unix tool
    let output = tokio::process::Command::new("find")
        .arg(&path)
        .arg("-maxdepth")
        .arg(max_depth.to_string())
        .output()
        .await;
        
    handle_cmd_output(output)
}

async fn count_file_lines_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    
    let output = tokio::process::Command::new("wc")
        .arg("-l")
        .arg(&path)
        .output()
        .await;
        
    handle_cmd_output(output)
}

async fn read_file_size_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    
    match tokio::fs::metadata(&path).await {
        Ok(meta) => {
            Ok(tool_success(format!("{} bytes", meta.len())))
        },
        Err(e) => Ok(tool_error(format!("Failed to read file size: {}", e))),
    }
}

async fn run_command_tool(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);

    let command = extract_string(args, "command")?;

    // Optional working-directory override
    let cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cfg.cwd.clone());

    // Optional per-call timeout (1–300 s, default 30)
    let timeout_secs: u64 = args
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(30)
        .clamp(1, 300);

    // ── Spawn ─────────────────────────────────────────────────────────────────
    let mut cmd = tokio::process::Command::new(&cfg.shell);
    cmd.arg("-c").arg(&command);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    if !cwd.is_empty() {
        cmd.current_dir(&cwd);
    }

    #[cfg(unix)]
    if let Some(uid) = cfg.uid { cmd.uid(uid); }
    #[cfg(unix)]
    if let Some(gid) = cfg.gid { cmd.gid(gid); }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Ok(tool_error(format!("Failed to spawn command: {}", e)));
        }
    };

    // ── Wait with timeout ─────────────────────────────────────────────────────
    let timeout = tokio::time::Duration::from_secs(timeout_secs);
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(out))  => out,
        Ok(Err(e))   => return Ok(tool_error(format!("Command I/O error: {}", e))),
        Err(_elapsed) => {
            return Ok(tool_error(format!(
                "Command timed out after {}s: {}",
                timeout_secs, command
            )));
        }
    };

    // ── Format result ─────────────────────────────────────────────────────────
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    let exit_code  = output.status.code().unwrap_or(-1);

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

// ── Sub-helpers ───────────────────────────────────────────────────────────────

fn extract_string(args: &Value, key: &str) -> Result<String, RpcError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code: INVALID_PARAMS,
            message: format!("Missing required argument: {}", key),
        })
        .map(String::from)
}

fn handle_cmd_output(output: io::Result<std::process::Output>) -> Result<Value, RpcError> {
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
        },
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
