use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
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

const RUST: &[ServerCommand] = &[("rust-analyzer", &[])];
const GO: &[ServerCommand] = &[("gopls", &[])];
const PYTHON: &[ServerCommand] = &[("ty", &["server"]), ("pyright-langserver", &["--stdio"]), ("pylsp", &[])];
const TYPESCRIPT: &[ServerCommand] = &[("typescript-language-server", &["--stdio"])];
const CPP: &[ServerCommand] = &[("clangd", &[])];
const JSON: &[ServerCommand] = &[("vscode-json-language-server", &["--stdio"])];
const HTML: &[ServerCommand] = &[("vscode-html-language-server", &["--stdio"])];
const CSS: &[ServerCommand] = &[("vscode-css-language-server", &["--stdio"])];
const YAML: &[ServerCommand] = &[("yaml-language-server", &["--stdio"])];
const KUBERNETES: &[ServerCommand] = &[("yaml-language-server", &["--stdio"])];
const DOCKER: &[ServerCommand] = &[("docker-langserver", &["--stdio"])];
const HELM: &[ServerCommand] = &[("helm_ls", &["serve"])];
const TOML: &[ServerCommand] = &[("taplo", &["lsp", "stdio"])];
const SHELL: &[ServerCommand] = &[("bash-language-server", &["start"])];
const LUA: &[ServerCommand] = &[("lua-language-server", &[])];
const TERRAFORM: &[ServerCommand] = &[("terraform-ls", &["serve"])];

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
    Router::new()
        .route("/completion", post(completion_handler))
        .route("/hover", post(hover_handler))
        .route("/environment", get(environment_handler))
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

    let path = PathBuf::from(&request.path);
    if !path.is_absolute() {
        return Json(json!([])).into_response();
    }

    let use_jedi = language_id(&request.language, Path::new(&request.path)) == Some("python")
        && request.server.as_deref().is_none_or(|server| server == "ty")
        && is_python_import_completion(&request);
    match session_for(&state, &request).await {
        Ok((session, context)) => {
            let result = {
                let mut session = session.lock().await;
                session.completion(&context, &request).await
            };
            match result {
                Ok(result) => {
                    let items = if result.is_null() && use_jedi {
                        python_import_completions(&request, &context.environment).await.unwrap_or_else(|_| json!([]))
                    } else {
                        completion_items(result)
                    };
                    Json(json!({ "items": items, "environment": context.environment })).into_response()
                }
                Err(error) => {
                    discard_session(&state, &context.key, &session).await;
                    tracing::debug!(%error, "LSP completion unavailable");
                    Json(json!({ "items": [] })).into_response()
                }
            }
        }
        Err(error) => {
            // Missing servers and protocol failures should not disable local completion.
            tracing::debug!(%error, "LSP completion unavailable");
            Json(json!({ "items": [] })).into_response()
        }
    }
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

    match session_for(&state, &request).await {
        Ok((session, context)) => {
            let result = {
                let mut session = session.lock().await;
                session.hover(&context, &request).await
            };
            match result {
                Ok(result) => Json(json!({ "result": result, "environment": context.environment })).into_response(),
                Err(error) => {
                    discard_session(&state, &context.key, &session).await;
                    tracing::debug!(%error, "LSP hover unavailable");
                    Json(Value::Null).into_response()
                }
            }
        }
        Err(error) => {
            tracing::debug!(%error, "LSP hover unavailable");
            Json(Value::Null).into_response()
        }
    }
}

struct RequestContext {
    path: PathBuf,
    language: &'static str,
    workspace: PathBuf,
    environment: LspEnvironment,
    server: ServerCommand,
    key: SessionKey,
}

fn request_context(request: &CompletionRequest) -> Result<RequestContext, String> {
    let path = std::fs::canonicalize(&request.path).map_err(|error| error.to_string())?;
    let language = language_id(&request.language, &path).ok_or("unsupported language")?;
    let server = server_command(language, request.server.as_deref()).ok_or("unsupported language server")?;
    let workspace = workspace_root(language, &path);
    let environment = environment_for(language, &path);
    Ok(RequestContext {
        path,
        language: document_language_id(language),
        workspace: workspace.clone(),
        environment: environment.clone(),
        server,
        key: SessionKey {
            language: document_language_id(language),
            server: server.0,
            workspace,
            environment: environment.root().map(Path::to_path_buf),
        },
    })
}

async fn session_for(
    state: &AppState,
    request: &CompletionRequest,
) -> Result<(Arc<AsyncMutex<LspSession>>, RequestContext), String> {
    let context = request_context(request)?;
    let slot = state.lsp.lock().expect("LSP manager mutex poisoned").checkout(&context.key)?;
    let session = slot.get_or_try_init(|| async {
        LspSession::start(
            context.server,
            &context.workspace,
            &context.environment,
            &state.config,
        )
            .await
            .map(|session| Arc::new(AsyncMutex::new(session)))
    }).await.map_err(|error| error.to_string());
    match session {
        Ok(session) => Ok((session.clone(), context)),
        Err(error) => {
            state
                .lsp
                .lock()
                .expect("LSP manager mutex poisoned")
                .mark_unavailable(&context.key, &slot);
            Err(error)
        }
    }
}

async fn discard_session(
    state: &AppState,
    key: &SessionKey,
    session: &Arc<AsyncMutex<LspSession>>,
) {
    state.lsp.lock().expect("LSP manager mutex poisoned").discard(key, session);
}

impl LspManager {
    fn checkout(&mut self, key: &SessionKey) -> Result<SessionSlot, String> {
        let now = Instant::now();
        let stale: Vec<_> = self
            .sessions
            .iter()
            .filter(|(_, entry)| now.duration_since(entry.last_used) >= SESSION_IDLE_TIMEOUT)
            .map(|(key, _)| key.clone())
            .collect();
        for key in stale {
            if let Some(entry) = self.sessions.remove(&key) {
                retire_session(entry);
            }
        }
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
                    retire_session(entry);
                }
            }
        }
        let slot = Arc::new(OnceCell::new());
        self.sessions.insert(key.clone(), SessionEntry { slot: slot.clone(), last_used: now, unavailable_until: None });
        Ok(slot)
    }

    fn mark_unavailable(&mut self, key: &SessionKey, slot: &SessionSlot) {
        let now = Instant::now();
        if self.sessions.get(key).is_some_and(|entry| Arc::ptr_eq(&entry.slot, slot)) {
            self.sessions.insert(key.clone(), SessionEntry {
                slot: Arc::new(OnceCell::new()),
                last_used: now,
                unavailable_until: Some(now + UNAVAILABLE_RETRY),
            });
        }
    }

    fn discard(&mut self, key: &SessionKey, session: &Arc<AsyncMutex<LspSession>>) {
        if self.sessions.get(key).and_then(|entry| entry.slot.get()).is_some_and(|current| Arc::ptr_eq(current, session)) {
            if let Some(entry) = self.sessions.remove(key) {
                retire_session(entry);
            }
        }
    }
}

fn retire_session(entry: SessionEntry) {
    let Some(session) = entry.slot.get().cloned() else { return; };
    tokio::spawn(async move {
        session.lock().await.shutdown().await;
    });
}

fn completion_items(result: Value) -> Value {
    let mut items = match result {
        Value::Array(items) => items,
        Value::Object(mut result) => result
            .remove("items")
            .and_then(|items| match items {
                Value::Array(items) => Some(items),
                _ => None,
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    items.truncate(MAX_COMPLETION_ITEMS);
    Value::Array(items)
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

async fn python_import_completions(request: &CompletionRequest, environment: &LspEnvironment) -> Result<Value, String> {
    let _permit = tokio::time::timeout(PYTHON_FALLBACK_TIMEOUT, JEDI_PROCESSES.acquire())
        .await
        .map_err(|_| "Python completion queue timed out".to_string())?
        .map_err(|error| error.to_string())?;
    run_python_import_completions(request, environment).await
}

async fn run_python_import_completions(request: &CompletionRequest, environment: &LspEnvironment) -> Result<Value, String> {
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
    async fn completion(&mut self, context: &RequestContext, request: &CompletionRequest) -> Result<Value, String> {
        self.sync_document(&context.path, context.language, &request.content).await?;
        self.request(
            "textDocument/completion",
            json!({
                "textDocument": { "uri": file_uri(&context.path) },
                "position": { "line": request.position.line, "character": request.position.character },
                "context": { "triggerKind": 1 }
            }),
            COMPLETION_TIMEOUT,
        ).await
    }

    async fn hover(&mut self, context: &RequestContext, request: &CompletionRequest) -> Result<Value, String> {
        self.sync_document(&context.path, context.language, &request.content).await?;
        self.request(
            "textDocument/hover",
            json!({
                "textDocument": { "uri": file_uri(&context.path) },
                "position": { "line": request.position.line, "character": request.position.character },
            }),
            COMPLETION_TIMEOUT,
        ).await
    }

    async fn start(
        (program, args): ServerCommand,
        workspace: &Path,
        environment: &LspEnvironment,
        config: &AppConfig,
    ) -> Result<Self, String> {
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

    async fn initialize(&mut self, workspace: &Path) -> Result<(), String> {
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

    async fn sync_document(&mut self, path: &Path, language: &str, content: &str) -> Result<(), String> {
        let content_hash = content_hash(content);
        let now = Instant::now();
        if let Some(document) = self.documents.get_mut(path) {
            document.last_used = now;
            if document.content_hash == content_hash {
                return Ok(());
            }
        }

        let uri = file_uri(path);
        if let Some(document) = self.documents.get_mut(path) {
            document.version += 1;
            document.content_hash = content_hash;
            let version = document.version;
            self.notify(
                "textDocument/didChange",
                DocumentSync {
                    text_document: TextDocument {
                        uri: &uri,
                        language_id: None,
                        version,
                        text: None,
                    },
                    content_changes: Some([TextChange { text: content }]),
                },
            ).await
        } else {
            if self.documents.len() >= MAX_OPEN_DOCUMENTS {
                let oldest = self
                    .documents
                    .iter()
                    .min_by_key(|(_, document)| document.last_used)
                    .map(|(path, _)| path.clone());
                if let Some(oldest) = oldest {
                    self.documents.remove(&oldest);
                    self.notify(
                        "textDocument/didClose",
                        json!({ "textDocument": { "uri": file_uri(&oldest) } }),
                    )
                    .await?;
                }
            }
            self.documents.insert(path.to_path_buf(), DocumentState { version: 1, content_hash, last_used: now });
            self.notify(
                "textDocument/didOpen",
                DocumentSync {
                    text_document: TextDocument {
                        uri: &uri,
                        language_id: Some(language),
                        version: 1,
                        text: Some(content),
                    },
                    content_changes: None,
                },
            ).await
        }
    }

    async fn notify(&mut self, method: &str, params: impl Serialize) -> Result<(), String> {
        self.send(RpcNotification { jsonrpc: "2.0", method, params }).await
    }

    async fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await?;
        self.wait_for_response(id, timeout).await
    }

    async fn wait_for_response(&mut self, id: u64, timeout: Duration) -> Result<Value, String> {
        let response: Value = tokio::time::timeout(timeout, async {
            loop {
                let message = self.messages.recv().await.ok_or_else(|| "language server stopped".to_string())?;
                if message.get("id").and_then(Value::as_u64) == Some(id) {
                    return Ok::<Value, String>(message);
                }
                // Servers may issue requests such as workspace/configuration. A null
                // response is valid for capability registration, while configuration
                // requires one result for each requested item.
                if let (Some(server_id), Some(method)) =
                    (message.get("id"), message.get("method").and_then(Value::as_str))
                {
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
        }).await.map_err(|_| "language server request timed out".to_string())??;

        if let Some(error) = response.get("error") {
            return Err(error.to_string());
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn send(&mut self, message: impl Serialize) -> Result<(), String> {
        let body = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        tokio::time::timeout(WRITE_TIMEOUT, async {
            self.stdin.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).await?;
            self.stdin.write_all(&body).await?;
            self.stdin.flush().await
        }).await.map_err(|_| "language server write timed out".to_string())?.map_err(|error| error.to_string())
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
    loop {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err("language server closed stdout".to_string());
        }
        if line.len() > MAX_LSP_HEADER_SIZE {
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
    match language {
        "rust" => Some(RUST),
        "go" => Some(GO),
        "python" => Some(PYTHON),
        "typescript" => Some(TYPESCRIPT),
        "cpp" => Some(CPP),
        "json" => Some(JSON),
        "html" => Some(HTML),
        "css" => Some(CSS),
        "yaml" => Some(YAML),
        "kubernetes" => Some(KUBERNETES),
        "dockerfile" => Some(DOCKER),
        "helm" => Some(HELM),
        "toml" => Some(TOML),
        "shellscript" => Some(SHELL),
        "lua" => Some(LUA),
        "terraform" => Some(TERRAFORM),
        _ => None,
    }
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
        assert_eq!(completion_items(Value::Array(items)).as_array().unwrap().len(), MAX_COMPLETION_ITEMS);
        assert_eq!(document_language_id("yaml"), document_language_id("kubernetes"));
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
        let completions = python_import_completions(&request, &LspEnvironment::global()).await.unwrap();
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
