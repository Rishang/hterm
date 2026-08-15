use axum::{
    extract::{Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::HashMap,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdout, Command},
    sync::{mpsc, Mutex as AsyncMutex, OnceCell},
};

use crate::{config::AppConfig, tools, ws::AppState};

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(8);
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(3);
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);
const PYTHON_FALLBACK_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_DOCUMENT_SIZE: usize = 2 * 1024 * 1024;
// JSON-escaping a document can nearly double it (every newline becomes `\n`), and
// axum's 2 MiB default would reject the request before MAX_DOCUMENT_SIZE applied.
const MAX_REQUEST_BODY_SIZE: usize = 2 * MAX_DOCUMENT_SIZE + 16 * 1024;
const MAX_LSP_MESSAGE_SIZE: usize = 4 * 1024 * 1024;
const MAX_LSP_HEADER_SIZE: usize = 8 * 1024;
const MAX_COMPLETION_ITEMS: usize = 200;
const MAX_OPEN_DOCUMENTS: usize = 8;
const MAX_SESSIONS: usize = 16;
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const UNAVAILABLE_RETRY: Duration = Duration::from_secs(15);
const MAX_JEDI_PROCESSES: usize = 4;
static JEDI_PROCESSES: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(MAX_JEDI_PROCESSES);
// Each in-flight request pins a copy of the document plus the server's reply, so
// the ceiling on concurrency is also the ceiling on transient memory. Past it,
// requests fall back to local completion rather than queueing behind a keystroke.
const MAX_INFLIGHT_REQUESTS: usize = 8;
static INFLIGHT_REQUESTS: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(MAX_INFLIGHT_REQUESTS);

// Ty currently returns `null` for some third-party `from module import Name`
// completions. Jedi supplies those import symbols without replacing Ty's LSP.
const PYTHON_JEDI_COMPLETIONS: &str = r#"
import itertools
import json
import sys
import jedi

request = json.load(sys.stdin)
script = jedi.Script(code=request["content"], path=request["path"])
print(json.dumps([
    {"label": item.name, "kind": 7, "detail": item.type}
    for item in itertools.islice(
        script.complete(request["line"] + 1, request["character"]), 200
    )
]))
"#;

type ServerCommand = (&'static str, &'static [&'static str]);

/// Language ID to its candidate servers, most preferred first.
const SERVERS: &[(&str, &[ServerCommand])] = &[
    ("rust", &[("rust-analyzer", &[])]),
    ("go", &[("gopls", &[])]),
    ("python", &[("ty", &["server"]), ("pyright-langserver", &["--stdio"]), ("pylsp", &[])]),
    ("typescript", &[("typescript-language-server", &["--stdio"])]),
    ("cpp", &[("clangd", &[])]),
    ("json", &[("vscode-json-language-server", &["--stdio"])]),
    ("html", &[("vscode-html-language-server", &["--stdio"])]),
    ("css", &[("vscode-css-language-server", &["--stdio"])]),
    ("yaml", &[("yaml-language-server", &["--stdio"])]),
    ("kubernetes", &[("yaml-language-server", &["--stdio"])]),
    ("dockerfile", &[("docker-langserver", &["--stdio"])]),
    ("helm", &[("helm_ls", &["serve"])]),
    ("toml", &[("taplo", &["lsp", "stdio"])]),
    ("shellscript", &[("bash-language-server", &["start"])]),
    ("lua", &[("lua-language-server", &[])]),
    ("terraform", &[("terraform-ls", &["serve"])]),
];

/// Separates a session that is still usable — a slow reply, or an error response
/// such as `ContentModified` — from one that must be torn down and restarted.
#[derive(Debug)]
enum LspError {
    Transient(String),
    Fatal(String),
}

impl LspError {
    fn is_fatal(&self) -> bool {
        matches!(self, Self::Fatal(_))
    }
}

impl From<String> for LspError {
    fn from(error: String) -> Self {
        Self::Fatal(error)
    }
}

impl From<&str> for LspError {
    fn from(error: &str) -> Self {
        Self::Fatal(error.to_string())
    }
}

impl std::fmt::Display for LspError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (Self::Transient(error) | Self::Fatal(error)) = self;
        formatter.write_str(error)
    }
}

#[derive(Clone, Copy)]
enum Operation {
    Completion,
    Hover,
}

impl Operation {
    fn method(self) -> &'static str {
        match self {
            Self::Completion => "textDocument/completion",
            Self::Hover => "textDocument/hover",
        }
    }

    /// Extra `params` members merged over the shared document/position pair.
    fn extra_params(self) -> Value {
        match self {
            Self::Completion => json!({ "context": { "triggerKind": 1 } }),
            Self::Hover => Value::Null,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletionRequest {
    path: String,
    language: String,
    server: Option<String>,
    content: String,
    position: Position,
}

#[derive(Deserialize)]
struct Position {
    line: u32,
    character: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    language: &'static str,
    server: &'static str,
    workspace: PathBuf,
    environment: Option<PathBuf>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspEnvironment {
    kind: &'static str,
    name: Cow<'static, str>,
    path: Option<PathBuf>,
}

impl LspEnvironment {
    fn global() -> Self {
        Self { kind: "global", name: Cow::Borrowed("Global"), path: None }
    }

    fn venv(path: PathBuf) -> Self {
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("venv").to_string();
        Self { kind: "venv", name: Cow::Owned(name), path: Some(path) }
    }

    fn root(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}

struct DocumentState {
    version: u64,
    content_hash: u64,
    last_used: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextDocument<'a> {
    uri: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    language_id: Option<&'a str>,
    version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSync<'a> {
    text_document: TextDocument<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_changes: Option<[TextChange<'a>; 1]>,
}

#[derive(Serialize)]
struct TextChange<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct PythonCompletionInput<'a> {
    path: &'a str,
    content: &'a str,
    line: u32,
    character: u32,
}

#[derive(Serialize)]
struct RpcNotification<'a, P> {
    jsonrpc: &'static str,
    method: &'a str,
    params: P,
}

struct LspSession {
    child: Child,
    stdin: tokio::process::ChildStdin,
    messages: mpsc::Receiver<Value>,
    next_id: u64,
    documents: HashMap<PathBuf, DocumentState>,
}

type SessionSlot = Arc<OnceCell<Arc<AsyncMutex<LspSession>>>>;

struct SessionEntry {
    slot: SessionSlot,
    last_used: Instant,
    unavailable_until: Option<Instant>,
}

/// A bounded pool of language-server sessions, one per protocol/workspace pair.
#[derive(Default)]
pub struct LspManager {
    sessions: HashMap<SessionKey, SessionEntry>,
}

pub fn router() -> Router<std::sync::Arc<AppState>> {
    let document_routes = Router::new()
        .route("/completion", post(completion_handler))
        .route("/hover", post(hover_handler))
        .route_layer(middleware::from_fn(limit_document_requests));
    Router::new()
        .merge(document_routes)
        .route("/environment", get(environment_handler))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_REQUEST_BODY_SIZE))
}

/// Shed excess document requests before Axum buffers and deserializes their bodies.
async fn limit_document_requests(request: Request, next: Next) -> Response {
    let Ok(_permit) = INFLIGHT_REQUESTS.try_acquire() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    next.run(request).await
}

#[derive(Deserialize)]
struct EnvironmentQuery {
    path: String,
    language: String,
}

async fn environment_handler(
    State(state): State<std::sync::Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<EnvironmentQuery>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let path = PathBuf::from(&query.path);
    let language = language_id(&query.language, &path);
    let environment = language.map(|language| environment_for(language, &path)).unwrap_or_else(LspEnvironment::global);
    Json(environment).into_response()
}

/// Run one document request, replacing the session only when it is truly broken.
/// Missing servers and protocol failures must never disable local completion.
async fn dispatch(
    state: &AppState,
    request: &CompletionRequest,
    operation: Operation,
) -> Option<(Value, LspEnvironment)> {
    let (session, context) = match session_for(state, request).await {
        Ok(session) => session,
        Err(error) => {
            tracing::debug!(%error, method = operation.method(), "LSP request unavailable");
            return None;
        }
    };
    let result = {
        let mut session = session.lock().await;
        session.document_request(operation, &context, request).await
    };
    match result {
        Ok(result) => Some((result, context.environment)),
        Err(error) => {
            if error.is_fatal() {
                manager(state).discard(&context.key, &session);
            }
            tracing::debug!(%error, method = operation.method(), "LSP request unavailable");
            None
        }
    }
}

async fn completion_handler(
    State(state): State<std::sync::Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CompletionRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if request.content.len() > MAX_DOCUMENT_SIZE {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let empty = || Json(json!({ "items": [], "isIncomplete": false })).into_response();
    if !Path::new(&request.path).is_absolute() {
        return empty();
    }

    let Some((result, environment)) = dispatch(&state, &request, Operation::Completion).await else {
        return empty();
    };
    let (items, incomplete) = if result.is_null() && use_jedi(&request) {
        python_import_completions(&request, &environment).await.unwrap_or((json!([]), false))
    } else {
        completion_items(result)
    };
    Json(json!({ "items": items, "isIncomplete": incomplete, "environment": environment })).into_response()
}

async fn hover_handler(
    State(state): State<std::sync::Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CompletionRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if request.content.len() > MAX_DOCUMENT_SIZE || !Path::new(&request.path).is_absolute() {
        return Json(Value::Null).into_response();
    }

    match dispatch(&state, &request, Operation::Hover).await {
        Some((result, environment)) => {
            Json(json!({ "result": result, "environment": environment })).into_response()
        }
        None => Json(Value::Null).into_response(),
    }
}

/// Ty returns `null` for some third-party import completions; Jedi fills only that gap.
fn use_jedi(request: &CompletionRequest) -> bool {
    language_id(&request.language, Path::new(&request.path)) == Some("python")
        && request.server.as_deref().is_none_or(|server| server == "ty")
        && is_python_import_completion(request)
}

struct RequestContext {
    path: PathBuf,
    language: &'static str,
    environment: LspEnvironment,
    server: ServerCommand,
    key: SessionKey,
}

impl RequestContext {
    /// The workspace lives in the session key; keeping a second copy per request
    /// only invited the two to disagree.
    fn workspace(&self) -> &Path {
        &self.key.workspace
    }
}

fn request_context(request: &CompletionRequest) -> Result<RequestContext, String> {
    let path = std::fs::canonicalize(&request.path).map_err(|error| error.to_string())?;
    let language = language_id(&request.language, &path).ok_or("unsupported language")?;
    let server = server_command(language, request.server.as_deref()).ok_or("unsupported language server")?;
    // Marker discovery keys off the source language ("helm", "kubernetes"); the
    // protocol ID sent to the server is the mapped one.
    let workspace = workspace_root(language, &path);
    let environment = environment_for(language, &path);
    let language = document_language_id(language);
    Ok(RequestContext {
        key: SessionKey {
            language,
            server: server.0,
            workspace,
            environment: environment.root().map(Path::to_path_buf),
        },
        path,
        language,
        environment,
        server,
    })
}

fn manager(state: &AppState) -> std::sync::MutexGuard<'_, LspManager> {
    state.lsp.lock().expect("LSP manager mutex poisoned")
}

async fn session_for(
    state: &AppState,
    request: &CompletionRequest,
) -> Result<(Arc<AsyncMutex<LspSession>>, RequestContext), String> {
    let context = request_context(request)?;
    let slot = manager(state).checkout(&context.key)?;
    let session = slot.get_or_try_init(|| async {
        LspSession::start(context.server, context.workspace(), &context.environment, &state.config)
            .await
            .map(|session| Arc::new(AsyncMutex::new(session)))
    }).await.map_err(|error| error.to_string());
    match session {
        Ok(session) => Ok((session.clone(), context)),
        Err(error) => {
            manager(state).mark_unavailable(&context.key, &slot);
            Err(error)
        }
    }
}

impl LspManager {
    fn checkout(&mut self, key: &SessionKey) -> Result<SessionSlot, String> {
        let now = Instant::now();
        // Language servers are the heaviest thing this process owns, so reap idle
        // ones on every checkout. `retain` keeps the common no-op case allocation free.
        self.sessions.retain(|_, entry| {
            let idle = now.duration_since(entry.last_used) >= SESSION_IDLE_TIMEOUT;
            if idle {
                retire_slot(&entry.slot);
            }
            !idle
        });
        if let Some(entry) = self.sessions.get_mut(key) {
            if entry.unavailable_until.is_some_and(|until| until > now) {
                return Err("language server is temporarily unavailable".into());
            }
            entry.last_used = now;
            return Ok(entry.slot.clone());
        }
        if self.sessions.len() >= MAX_SESSIONS {
            if let Some(oldest) = self.sessions.iter().min_by_key(|(_, entry)| entry.last_used).map(|(key, _)| key.clone()) {
                if let Some(entry) = self.sessions.remove(&oldest) {
                    retire_slot(&entry.slot);
                }
            }
        }
        let slot = Arc::new(OnceCell::new());
        self.sessions.insert(key.clone(), SessionEntry { slot: slot.clone(), last_used: now, unavailable_until: None });
        Ok(slot)
    }

    fn mark_unavailable(&mut self, key: &SessionKey, slot: &SessionSlot) {
        let now = Instant::now();
        if let Some(entry) = self.sessions.get_mut(key).filter(|entry| Arc::ptr_eq(&entry.slot, slot)) {
            retire_slot(&entry.slot);
            entry.slot = Arc::new(OnceCell::new());
            entry.last_used = now;
            entry.unavailable_until = Some(now + UNAVAILABLE_RETRY);
        }
    }

    fn discard(&mut self, key: &SessionKey, session: &Arc<AsyncMutex<LspSession>>) {
        if self.sessions.get(key).and_then(|entry| entry.slot.get()).is_some_and(|current| Arc::ptr_eq(current, session)) {
            if let Some(entry) = self.sessions.remove(key) {
                retire_slot(&entry.slot);
            }
        }
    }
}

/// Shut a session down off the request path. A slot that never finished starting
/// holds nothing to shut down; `kill_on_drop` reaps that child instead.
fn retire_slot(slot: &SessionSlot) {
    let Some(session) = slot.get().cloned() else { return };
    tokio::spawn(async move {
        session.lock().await.shutdown().await;
    });
}

/// Returns the capped item list plus whether it is a partial view of what the
/// server could offer, so the client knows to re-query instead of filtering
/// a stale list locally. Our own cap counts as incomplete.
fn completion_items(result: Value) -> (Value, bool) {
    let (mut items, incomplete) = match result {
        Value::Array(items) => (items, false),
        Value::Object(mut result) => {
            let incomplete = result.get("isIncomplete").and_then(Value::as_bool).unwrap_or(false);
            let items = result
                .remove("items")
                .and_then(|items| match items {
                    Value::Array(items) => Some(items),
                    _ => None,
                })
                .unwrap_or_default();
            (items, incomplete)
        }
        _ => (Vec::new(), false),
    };
    let capped = items.len() > MAX_COMPLETION_ITEMS;
    items.truncate(MAX_COMPLETION_ITEMS);
    (Value::Array(items), incomplete || capped)
}

fn is_python_import_completion(request: &CompletionRequest) -> bool {
    request
        .content
        .lines()
        .nth(request.position.line as usize)
        .is_some_and(|line| {
            let line = line.trim_start();
            line.starts_with("from ") && line.contains(" import ")
        })
}

async fn python_import_completions(request: &CompletionRequest, environment: &LspEnvironment) -> Result<(Value, bool), String> {
    // Every fallback is a fresh interpreter; cap how many exist at once.
    let _permit = tokio::time::timeout(PYTHON_FALLBACK_TIMEOUT, JEDI_PROCESSES.acquire())
        .await
        .map_err(|_| "Python completion queue timed out".to_string())?
        .map_err(|error| error.to_string())?;
    let input = PythonCompletionInput {
        path: &request.path,
        content: &request.content,
        line: request.position.line,
        character: request.position.character,
    };
    let mut command = Command::new(python_command(environment));
    apply_environment(&mut command, environment)?;
    command
        .arg("-c")
        .arg(PYTHON_JEDI_COMPLETIONS)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Python fallback stdin unavailable")?;
    let mut stdout = child.stdout.take().ok_or("Python fallback stdout unavailable")?;
    let mut output = Vec::new();
    let operation = async {
        stdin.write_all(&serde_json::to_vec(&input).map_err(|error| error.to_string())?)
            .await
            .map_err(|error| error.to_string())?;
        drop(stdin);
        stdout.read_to_end(&mut output).await.map_err(|error| error.to_string())?;
        child.wait().await.map_err(|error| error.to_string())
    };
    let status = match tokio::time::timeout(PYTHON_FALLBACK_TIMEOUT, operation).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("Python completion timed out".to_string());
        }
    };
    if !status.success() {
        return Err("Python completion failed".to_string());
    }
    serde_json::from_slice(&output)
        .map(completion_items)
        .map_err(|error| error.to_string())
}

impl LspSession {
    async fn document_request(
        &mut self,
        operation: Operation,
        context: &RequestContext,
        request: &CompletionRequest,
    ) -> Result<Value, LspError> {
        self.sync_document(&context.path, context.language, &request.content).await?;
        let mut params = json!({
            "textDocument": { "uri": file_uri(&context.path) },
            "position": { "line": request.position.line, "character": request.position.character },
        });
        if let (Some(params), Value::Object(extra)) = (params.as_object_mut(), operation.extra_params()) {
            params.extend(extra);
        }
        self.request(operation.method(), params, COMPLETION_TIMEOUT).await
    }

    async fn start(
        (program, args): ServerCommand,
        workspace: &Path,
        environment: &LspEnvironment,
        config: &AppConfig,
    ) -> Result<Self, LspError> {
        let mut command = Command::new(environment_program(program, environment));
        apply_environment(&mut command, environment)?;
        command
            .args(args)
            .current_dir(workspace)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        if let Some(gid) = config.gid {
            command.gid(gid);
        }
        #[cfg(unix)]
        if let Some(uid) = config.uid {
            command.uid(uid);
        }
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdin = child.stdin.take().ok_or("language server stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("language server stdout unavailable")?;
        let (sender, messages) = mpsc::channel(2);
        tokio::spawn(read_messages(stdout, sender));

        let mut session = Self {
            child,
            stdin,
            messages,
            next_id: 1,
            documents: HashMap::new(),
        };
        if let Err(error) = session.initialize(workspace).await {
            let _ = session.child.kill().await;
            return Err(error);
        }
        Ok(session)
    }

    async fn initialize(&mut self, workspace: &Path) -> Result<(), LspError> {
        let uri = file_uri(workspace);
        self.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": uri,
                "workspaceFolders": [{ "uri": uri, "name": workspace.file_name().and_then(|name| name.to_str()).unwrap_or("workspace") }],
                "capabilities": {
                    "textDocument": {
                        "completion": { "completionItem": { "snippetSupport": false } }
                    }
                }
            }),
            INITIALIZE_TIMEOUT,
        ).await?;
        self.notify("initialized", json!({})).await
    }

    async fn sync_document(&mut self, path: &Path, language: &str, content: &str) -> Result<(), LspError> {
        let content_hash = content_hash(content);
        let now = Instant::now();
        // Unchanged content needs no round trip at all: a hover right after a
        // completion at the same position is free.
        let open_version = match self.documents.get_mut(path) {
            Some(document) => {
                document.last_used = now;
                if document.content_hash == content_hash {
                    return Ok(());
                }
                document.content_hash = content_hash;
                document.version += 1;
                Some(document.version)
            }
            None => None,
        };

        let uri = file_uri(path);
        match open_version {
            Some(version) => {
                self.notify(
                    "textDocument/didChange",
                    DocumentSync {
                        text_document: TextDocument { uri: &uri, language_id: None, version, text: None },
                        content_changes: Some([TextChange { text: content }]),
                    },
                ).await
            }
            None => {
                self.close_oldest_document().await?;
                self.documents.insert(path.to_path_buf(), DocumentState { version: 1, content_hash, last_used: now });
                self.notify(
                    "textDocument/didOpen",
                    DocumentSync {
                        text_document: TextDocument { uri: &uri, language_id: Some(language), version: 1, text: Some(content) },
                        content_changes: None,
                    },
                ).await
            }
        }
    }

    /// Servers keep a parsed tree per open document, so bound how many we hold open.
    async fn close_oldest_document(&mut self) -> Result<(), LspError> {
        if self.documents.len() < MAX_OPEN_DOCUMENTS {
            return Ok(());
        }
        let Some(oldest) = self
            .documents
            .iter()
            .min_by_key(|(_, document)| document.last_used)
            .map(|(path, _)| path.clone())
        else {
            return Ok(());
        };
        self.documents.remove(&oldest);
        self.notify("textDocument/didClose", json!({ "textDocument": { "uri": file_uri(&oldest) } })).await
    }

    async fn notify(&mut self, method: &str, params: impl Serialize) -> Result<(), LspError> {
        self.send(RpcNotification { jsonrpc: "2.0", method, params }).await
    }

    async fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, LspError> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await?;
        self.wait_for_response(id, timeout).await
    }

    async fn wait_for_response(&mut self, id: u64, timeout: Duration) -> Result<Value, LspError> {
        let response: Value = match tokio::time::timeout(timeout, async {
            loop {
                let message = self.messages.recv().await.ok_or("language server stopped")?;
                // Only a message without `method` is a response. Server-initiated
                // requests draw ids from their own counter, which collides with ours.
                let server_method = message.get("method").and_then(Value::as_str);
                if server_method.is_none() && message.get("id").and_then(Value::as_u64) == Some(id) {
                    return Ok::<Value, LspError>(message);
                }
                // Servers may issue requests such as workspace/configuration. A null
                // response is valid for capability registration, while configuration
                // requires one result for each requested item.
                if let (Some(server_id), Some(method)) = (message.get("id"), server_method) {
                    let reply = match method {
                        "workspace/configuration" => {
                            let count = message
                                .pointer("/params/items")
                                .and_then(Value::as_array)
                                .map_or(0, Vec::len);
                            json!({ "jsonrpc": "2.0", "id": server_id, "result": vec![Value::Null; count] })
                        }
                        "client/registerCapability" | "client/unregisterCapability" => {
                            json!({ "jsonrpc": "2.0", "id": server_id, "result": null })
                        }
                        "workspace/workspaceFolders" => {
                            json!({ "jsonrpc": "2.0", "id": server_id, "result": [] })
                        }
                        _ => json!({
                            "jsonrpc": "2.0",
                            "id": server_id,
                            "error": { "code": -32601, "message": "method not supported" }
                        }),
                    };
                    self.send(reply).await?;
                }
            }
        }).await {
            Ok(response) => response?,
            // A slow server is still a usable server; restarting it here would
            // stall exactly when it is busiest, such as during initial indexing.
            Err(_) => return Err(LspError::Transient("language server request timed out".to_string())),
        };

        if let Some(error) = response.get("error") {
            // Error responses (`ContentModified` and friends) are routine.
            return Err(LspError::Transient(error.to_string()));
        }
        // Move the result out rather than cloning it: a completion payload runs to
        // thousands of items, and deep-copying that tree costs more than the request.
        Ok(match response {
            Value::Object(mut response) => response.remove("result").unwrap_or(Value::Null),
            _ => Value::Null,
        })
    }

    async fn send(&mut self, message: impl Serialize) -> Result<(), LspError> {
        let body = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        tokio::time::timeout(WRITE_TIMEOUT, async {
            self.stdin.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).await?;
            self.stdin.write_all(&body).await?;
            self.stdin.flush().await
        }).await.map_err(|_| "language server write timed out".to_string())?.map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn shutdown(&mut self) {
        let _ = self.request("shutdown", Value::Null, SHUTDOWN_TIMEOUT).await;
        let _ = self.notify("exit", Value::Null).await;
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, self.child.wait()).await.is_err() {
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
    }
}

async fn read_messages(stdout: ChildStdout, sender: mpsc::Sender<Value>) {
    let mut reader = BufReader::new(stdout);
    while let Ok(message) = read_message(&mut reader).await {
        if sender.send(message).await.is_err() {
            break;
        }
    }
}

fn content_hash(content: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut content_length = None;
    let mut header_bytes = 0;
    loop {
        let mut line = String::new();
        let remaining = MAX_LSP_HEADER_SIZE.checked_sub(header_bytes)
            .ok_or("language server message header is too large")?;
        let bytes = (&mut *reader)
            .take(remaining as u64)
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err("language server closed stdout".to_string());
        }
        header_bytes += bytes;
        if !line.ends_with('\n') {
            return Err("language server message header is too large".to_string());
        }
        let line = line.trim();
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("Content-Length:") {
            content_length = Some(value.trim().parse::<usize>().map_err(|e| e.to_string())?);
        }
    }

    let length = content_length.ok_or("language server message has no Content-Length")?;
    if length > MAX_LSP_MESSAGE_SIZE {
        return Err("language server message is too large".to_string());
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

fn language_id(language: &str, path: &Path) -> Option<&'static str> {
    let value = if language.is_empty() {
        path.extension().and_then(|extension| extension.to_str()).unwrap_or("")
    } else {
        language
    }.to_ascii_lowercase();

    match value.as_str() {
        "rs" | "rust" => Some("rust"),
        "go" => Some("go"),
        "py" | "python" => Some("python"),
        "js" | "mjs" | "cjs" | "jsx" | "javascript" | "ts" | "tsx" | "typescript" => Some("typescript"),
        "c" | "h" | "cc" | "cp" | "cpp" | "cxx" | "hpp" | "hxx" => Some("cpp"),
        "json" => Some("json"),
        "html" | "htm" | "vue" | "svelte" => Some("html"),
        "css" | "scss" | "sass" | "less" => Some("css"),
        "yaml" | "yml" => Some("yaml"),
        "kubernetes" | "k8s" => Some("kubernetes"),
        "dockerfile" | "docker" => Some("dockerfile"),
        "helm" => Some("helm"),
        "toml" => Some("toml"),
        "sh" | "bash" | "zsh" | "fish" | "shell" => Some("shellscript"),
        "lua" => Some("lua"),
        "tf" | "tfvars" | "hcl" | "terraform" => Some("terraform"),
        _ => None,
    }
}

fn document_language_id(language: &str) -> &str {
    match language {
        // Kubernetes manifests use the YAML LSP implementation and protocol ID.
        "kubernetes" => "yaml",
        language => language,
    }
}

fn server_command(language: &str, selected: Option<&str>) -> Option<ServerCommand> {
    let commands = server_commands(language)?;
    match selected {
        Some(selected) => commands.iter().copied().find(|(program, _)| *program == selected),
        None => commands.first().copied(),
    }
}

fn server_commands(language: &str) -> Option<&'static [ServerCommand]> {
    SERVERS.iter().find(|(id, _)| *id == language).map(|(_, servers)| *servers)
}

fn environment_for(language: &str, path: &Path) -> LspEnvironment {
    if language != "python" {
        return LspEnvironment::global();
    }
    python_venv(path).map(LspEnvironment::venv).unwrap_or_else(LspEnvironment::global)
}

fn python_venv(path: &Path) -> Option<PathBuf> {
    path.parent()?.ancestors().find_map(|directory| {
        [".venv", "venv", "env"]
            .iter()
            .map(|name| directory.join(name))
            .find(|candidate| python_command_path(candidate).is_file())
    })
}

fn environment_bin(root: &Path) -> PathBuf {
    #[cfg(windows)]
    { root.join("Scripts") }
    #[cfg(not(windows))]
    { root.join("bin") }
}

fn python_command_path(root: &Path) -> PathBuf {
    #[cfg(windows)]
    { environment_bin(root).join("python.exe") }
    #[cfg(not(windows))]
    { environment_bin(root).join("python") }
}

fn python_command(environment: &LspEnvironment) -> PathBuf {
    environment.root().map(python_command_path).filter(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("python3"))
}

fn environment_program(program: &str, environment: &LspEnvironment) -> PathBuf {
    environment.root().map(|root| environment_bin(root).join(program)).filter(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(program))
}

fn apply_environment(command: &mut Command, environment: &LspEnvironment) -> Result<(), String> {
    let Some(root) = environment.root() else { return Ok(()); };
    let bin = environment_bin(root);
    let path = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&path)))
        .map_err(|error| error.to_string())?;
    command.env("VIRTUAL_ENV", root).env("PATH", path).env_remove("PYTHONHOME");
    Ok(())
}

fn workspace_root(language: &str, path: &Path) -> PathBuf {
    let markers: &[&str] = match language {
        "helm" => &["Chart.yaml", "helmfile.yaml", ".git", "Cargo.toml", "go.mod", "package.json", "pyproject.toml", "requirements.txt"],
        "kubernetes" => &["kustomization.yaml", "Kustomization", ".git", "Cargo.toml", "go.mod", "package.json", "pyproject.toml", "requirements.txt"],
        _ => &[".git", "Cargo.toml", "go.mod", "package.json", "pyproject.toml", "requirements.txt"],
    };
    let directory = path.parent().unwrap_or(path);
    directory.ancestors().find(|candidate| markers.iter().any(|marker| candidate.join(marker).exists()))
        .unwrap_or(directory).to_path_buf()
}

fn file_uri(path: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        let path = path.as_os_str().as_bytes();
        let mut uri = String::with_capacity("file://".len() + path.len());
        uri.push_str("file://");
        for &byte in path {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                    uri.push(char::from(byte));
                }
                _ => {
                    uri.push('%');
                    uri.push(char::from(HEX[usize::from(byte >> 4)]));
                    uri.push(char::from(HEX[usize::from(byte & 0x0f)]));
                }
            }
        }
        uri
    }
    #[cfg(not(unix))]
    {
        format!("file:///{}", path.to_string_lossy().replace('\\', "/").replace(' ', "%20"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_supported_languages() {
        assert_eq!(language_id("", Path::new("main.rs")), Some("rust"));
        assert_eq!(language_id("tsx", Path::new("component")), Some("typescript"));
        assert_eq!(language_id("", Path::new("compose.yaml")), Some("yaml"));
        assert_eq!(language_id("dockerfile", Path::new("Dockerfile")), Some("dockerfile"));
        assert_eq!(language_id("helm", Path::new("Chart.yaml")), Some("helm"));
        assert_eq!(language_id("k8s", Path::new("deployment.yaml")), Some("kubernetes"));
        assert_eq!(language_id("toml", Path::new("Cargo.toml")), Some("toml"));
        assert_eq!(server_command("toml", None).map(|server| server.0), Some("taplo"));
        assert_eq!(document_language_id("kubernetes"), "yaml");
        assert_eq!(language_id("md", Path::new("README.md")), None);
        assert_eq!(server_command("python", None).map(|server| server.0), Some("ty"));
        assert_eq!(server_command("python", Some("pylsp")).map(|server| server.0), Some("pylsp"));
        assert_eq!(server_command("python", Some("unknown")), None);
    }

    #[test]
    fn caps_completion_results_and_pools_kubernetes_with_yaml() {
        let items = (0..MAX_COMPLETION_ITEMS + 1).map(|index| json!({ "label": index })).collect();
        let (capped, incomplete) = completion_items(Value::Array(items));
        assert_eq!(capped.as_array().unwrap().len(), MAX_COMPLETION_ITEMS);
        // Truncating on our side leaves the client with a partial view too.
        assert!(incomplete);
        assert_eq!(document_language_id("yaml"), document_language_id("kubernetes"));
    }

    #[test]
    fn preserves_the_server_incomplete_flag() {
        let list = json!({ "isIncomplete": true, "items": [{ "label": "a" }] });
        assert_eq!(completion_items(list), (json!([{ "label": "a" }]), true));
        let list = json!({ "isIncomplete": false, "items": [{ "label": "a" }] });
        assert_eq!(completion_items(list), (json!([{ "label": "a" }]), false));
        assert_eq!(completion_items(json!([])), (json!([]), false));
    }

    #[test]
    fn keeps_the_session_after_recoverable_failures() {
        assert!(!LspError::Transient("timed out".into()).is_fatal());
        assert!(LspError::Fatal("closed stdout".into()).is_fatal());
        assert!(LspError::from("stdin unavailable").is_fatal());
    }

    /// A server request carrying the same id as our pending request must not be
    /// mistaken for its response.
    #[tokio::test]
    async fn distinguishes_server_requests_from_responses() {
        let (sender, messages) = mpsc::channel(4);
        let mut child = Command::new("cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut session = LspSession { child, stdin, messages, next_id: 1, documents: HashMap::new() };

        sender.send(json!({ "jsonrpc": "2.0", "id": 7, "method": "client/registerCapability", "params": {} })).await.unwrap();
        sender.send(json!({ "jsonrpc": "2.0", "id": 7, "result": { "value": "ours" } })).await.unwrap();
        let response = session.wait_for_response(7, COMPLETION_TIMEOUT).await.unwrap();
        assert_eq!(response, json!({ "value": "ours" }));

        let _ = session.child.kill().await;
    }

    #[test]
    fn limits_jedi_fallback_to_import_completions() {
        let mut request = CompletionRequest {
            path: "/tmp/main.py".into(),
            language: "python".into(),
            server: Some("ty".into()),
            content: "from pydantic import BaseM".into(),
            position: Position { line: 0, character: 26 },
        };
        assert!(is_python_import_completion(&request));
        request.content = "BaseM".into();
        assert!(!is_python_import_completion(&request));
    }

    #[test]
    fn hashes_identical_content_identically() {
        assert_eq!(content_hash("unchanged"), content_hash("unchanged"));
        assert_ne!(content_hash("before"), content_hash("after"));
    }

    #[tokio::test]
    #[ignore = "requires python3 and the jedi package"]
    async fn completes_third_party_python_imports() {
        let request = CompletionRequest {
            path: "/tmp/main.py".into(),
            language: "python".into(),
            server: Some("ty".into()),
            content: "from pydantic import BaseM".into(),
            position: Position { line: 0, character: 26 },
        };
        let (completions, _) = python_import_completions(&request, &LspEnvironment::global()).await.unwrap();
        assert!(completions.as_array().unwrap().iter().any(|item| item["label"] == "BaseModel"));
    }

    #[test]
    fn detects_the_nearest_python_venv() {
        let root = std::env::temp_dir().join(format!("hterm-lsp-{}", std::process::id()));
        let venv = root.join(".venv");
        let source = root.join("nested/main.py");
        std::fs::create_dir_all(environment_bin(&venv)).unwrap();
        std::fs::write(python_command_path(&venv), "").unwrap();
        let environment = environment_for("python", &source);
        assert_eq!(environment.kind, "venv");
        assert_eq!(environment.root(), Some(venv.as_path()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_escaped_file_uris() {
        assert_eq!(file_uri(Path::new("/tmp/a file.rs")), "file:///tmp/a%20file.rs");
    }
}
