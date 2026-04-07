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
        // std::sync::RwLock can be used directly in a sync Drop context —
        // no need to spawn a task for cleanup.
        if let Ok(mut map) = self.state.mcp_transmitters.write() {
            map.remove(&self.session_id);
        }
        tracing::debug!(session_id = %self.session_id, "MCP session removed");
    }
}

// ── HTTP / SSE Handlers ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct McpSessionQuery {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

pub async fn mcp_sse_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, axum::http::StatusCode> {
    if !crate::tools::check_auth(&state, &headers) {
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }

    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();

    state
        .mcp_transmitters
        .write()
        .unwrap_or_else(|e| e.into_inner())
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
    if !crate::tools::check_auth(&state, &headers) {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }

    let tx = {
        let transmitters = state.mcp_transmitters.read()
            .unwrap_or_else(|e| e.into_inner());
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
            "tools/list" => Ok(crate::tools::handle_tools_list()),
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



// ── tools/call dispatcher ─────────────────────────────────────────────────────

async fn handle_tools_call(params: &Value, cfg: &AppConfig) -> Result<Value, RpcError> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError {
            code: INVALID_PARAMS,
            message: "Missing required field: name".into(),
        })?;

    let arguments = params.get("arguments").unwrap_or(&Value::Null);

    tracing::info!(tool = %name, "MCP tools/call");

    crate::tools::call_tool(name, arguments, cfg).await.map_err(|e| RpcError {
        code: INVALID_PARAMS,
        message: e,
    })
}


