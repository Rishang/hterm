//! MCP (Model Context Protocol) server — HTTP/SSE transport.
//!
//! Clients connect via GET `/mcp/sse` which returns a persistent SSE stream.
//! They POST JSON-RPC 2.0 messages to `/mcp/message?sessionId=<uuid>`.
//! All diagnostic output goes to **stderr** / tracing so it never pollutes the
//! JSON-RPC stream.
//!
//! Protocol version: `2024-11-05` (initial stable MCP release).

use axum::extract::{Query, State};
use axum::response::{
    sse::{Event, Sse},
    IntoResponse,
};
use axum::Json;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::ws::AppState;

const PROTOCOL_VERSION: &str = "2024-11-05";

// ── JSON-RPC envelope types ───────────────────────────────────────────────────

/// An incoming JSON-RPC 2.0 request/notification from the MCP client.
///
/// `id` is `None` for notifications (which must not be replied to).
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    #[allow(dead_code)]
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
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
#[allow(dead_code)]
const PARSE_ERROR: i32 = -32700;
const METHOD_NOT_FOUND: i32 = -32601;
const INVALID_PARAMS: i32 = -32602;

// ── Session-aware SSE stream ──────────────────────────────────────────────────

/// Wraps an `UnboundedReceiverStream<Event>` and removes the session entry
/// from `AppState::mcp_transmitters` when the SSE connection is dropped
/// (client disconnects or server shuts down).
///
/// Without this guard, every connection leaks an entry in the transmitters map
/// for the lifetime of the process.
struct SessionStream {
    inner: UnboundedReceiverStream<Event>,
    session_id: String,
    state: Arc<AppState>,
}

impl Stream for SessionStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.inner)
            .poll_next(cx)
            .map(|opt| opt.map(Ok))
    }
}

impl Drop for SessionStream {
    fn drop(&mut self) {
        let session_id = self.session_id.clone();
        let state = Arc::clone(&self.state);
        // We're in a sync drop context; spawn a task to do the async remove.
        tokio::spawn(async move {
            state.mcp_transmitters.write().await.remove(&session_id);
            tracing::debug!(session_id = %session_id, "MCP session removed");
        });
    }
}

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

// ── HTTP / SSE Handlers ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct McpSessionQuery {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

fn check_auth(state: &AppState, headers: &axum::http::HeaderMap) -> bool {
    let cfg = &state.config;
    if !cfg.auth_header.is_empty() {
        headers.get(cfg.auth_header.as_str()).is_some()
    } else if let Some(ref expected) = state.expected_auth {
        crate::ws::check_basic_auth(headers, expected)
    } else {
        true
    }
}

pub async fn mcp_sse_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, axum::http::StatusCode> {
    if !check_auth(&state, &headers) {
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }

    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();

    state
        .mcp_transmitters
        .write()
        .await
        .insert(session_id.clone(), tx.clone());

    // Tell the client where to POST messages.
    let bp = &state.config.base_path;
    let endpoint = format!("{}/mcp/message?sessionId={}", bp, session_id);
    let _ = tx.send(Event::default().event("endpoint").data(&endpoint));

    tracing::info!(session_id = %session_id, "MCP session opened");

    // SessionStream cleans up the transmitters entry when the SSE stream is dropped.
    let stream = SessionStream {
        inner: UnboundedReceiverStream::new(rx),
        session_id,
        state: Arc::clone(&state),
    };

    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new().text("ping")))
}

pub async fn mcp_message_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Query(query): Query<McpSessionQuery>,
    Json(request): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }

    let tx = {
        let transmitters = state.mcp_transmitters.read().await;
        match transmitters.get(&query.session_id) {
            Some(tx) => tx.clone(),
            None => return axum::http::StatusCode::NOT_FOUND.into_response(),
        }
    };

    // Notifications have no `id` and must not be replied to.
    if request.id.is_none() {
        match request.method.as_str() {
            "notifications/initialized" => {
                tracing::info!(session_id = %query.session_id, "MCP client signalled initialized");
            }
            "notifications/cancelled" => {
                tracing::debug!(session_id = %query.session_id, "MCP request cancelled");
            }
            other => {
                tracing::debug!(session_id = %query.session_id, method = %other, "MCP notification (ignored)");
            }
        }
        return axum::http::StatusCode::ACCEPTED.into_response();
    }

    let state_clone = Arc::clone(&state);

    // Spawn to return 202 Accepted immediately, as required by the MCP SSE spec.
    tokio::spawn(async move {
        let id_value = request.id.unwrap_or(Value::Null);

        let result = match request.method.as_str() {
            "initialize" => Ok(handle_initialize(&request.params)),
            "tools/list" => Ok(handle_tools_list()),
            "tools/call" => handle_tools_call(&request.params, &state_clone.config).await,
            // These capability-discovery methods must return empty lists, not
            // METHOD_NOT_FOUND, or several MCP clients will refuse to connect.
            "resources/list" => Ok(json!({ "resources": [] })),
            "prompts/list" => Ok(json!({ "prompts": [] })),
            "ping" => Ok(json!({})),
            other => Err(RpcError {
                code: METHOD_NOT_FOUND,
                message: format!("Method not found: {}", other),
            }),
        };

        let response_str = match result {
            Ok(res) => {
                let resp = JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: &id_value,
                    result: res,
                };
                serde_json::to_string(&resp).unwrap_or_default()
            }
            Err(e) => {
                let resp = JsonRpcError {
                    jsonrpc: "2.0",
                    id: &id_value,
                    error: e,
                };
                serde_json::to_string(&resp).unwrap_or_default()
            }
        };

        if !response_str.is_empty() {
            let _ = tx.send(Event::default().event("message").data(response_str));
        }
    });

    axum::http::StatusCode::ACCEPTED.into_response()
}

// ── Method handlers ───────────────────────────────────────────────────────────

fn handle_initialize(params: &Value) -> Value {
    let client_name = params
        .get("clientInfo")
        .and_then(|c| c.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let client_version = params
        .get("clientInfo")
        .and_then(|c| c.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("?");
    tracing::info!(client = %client_name, version = %client_version, "MCP client initialized");

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

// ── tools/call dispatcher ─────────────────────────────────────────────────────

async fn handle_tools_call(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code: INVALID_PARAMS,
            message: "Missing required field: name".into(),
        })?;

    tracing::info!(tool = %name, "MCP tools/call");

    match name {
        "run_command" => run_command_tool(params, cfg).await,
        "read_file" => read_file_tool(params).await,
        "write_file" => write_file_tool(params, cfg).await,
        "list_processes" => list_processes_tool().await,
        "list_files" => list_files_tool(params).await,
        "list_tree" => list_tree_tool(params, cfg).await,
        "count_file_lines" => count_file_lines_tool(params).await,
        "read_file_size" => read_file_size_tool(params).await,
        other => Err(RpcError {
            code: INVALID_PARAMS,
            message: format!("Unknown tool: {}", other),
        }),
    }
}

// ── Tool implementations ──────────────────────────────────────────────────────

async fn read_file_tool(params: &Value) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;

    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(tool_success(content)),
        Err(e) => Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
    }
}

/// Write file — guarded by the `writable` config flag so a read-only hterm
/// instance cannot be used to modify the host filesystem via MCP.
async fn write_file_tool(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    if !cfg.writable {
        return Ok(tool_error(
            "Write operations are disabled (hterm is running in read-only mode). \
             Restart with --writable to enable."
                .into(),
        ));
    }

    let args = params.get("arguments").unwrap_or(&Value::Null);
    let path = extract_string(args, "path")?;
    let content = extract_string(args, "content")?;

    match tokio::fs::write(&path, content).await {
        Ok(_) => Ok(tool_success(format!("Successfully wrote to '{}'", path))),
        Err(e) => Ok(tool_error(format!("Failed to write '{}': {}", path, e))),
    }
}

async fn list_processes_tool() -> Result<Value, RpcError> {
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

/// Produce a real directory tree.
///
/// Strategy:
///   1. Try `tree -L <depth> <path>` — most readable output.
///   2. Fall back to `find <path> -maxdepth <depth>` sorted and indented.
///
/// Both are run via the system shell so they respect `$PATH`.
async fn list_tree_tool(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);
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

    let output = tokio::process::Command::new(&cfg.shell)
        .arg("-c")
        .arg(&tree_cmd)
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
async fn run_command_tool(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let args = params.get("arguments").unwrap_or(&Value::Null);

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

fn extract_string(args: &Value, key: &str) -> Result<String, RpcError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code: INVALID_PARAMS,
            message: format!("Missing required argument: {}", key),
        })
        .map(String::from)
}

fn handle_cmd_output(
    output: std::io::Result<std::process::Output>,
) -> Result<Value, RpcError> {
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
