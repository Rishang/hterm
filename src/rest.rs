use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::tools;
use crate::ws::AppState;

#[derive(Deserialize)]
pub struct ToolCallRequest {
    name: String,
    #[serde(default)]
    arguments: Value,
}

#[derive(Deserialize)]
pub struct FilesQuery {
    path: Option<String>,
}

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
pub struct ReadFileResponse {
    content: String,
    is_binary: bool,
    size: u64,
}

pub async fn list_files_handler(
    Query(q): Query<FilesQuery>,
) -> impl IntoResponse {
    let dir = q.path.unwrap_or_else(|| "/".to_string());
    let path = Path::new(&dir);

    let mut rd = match tokio::fs::read_dir(path).await {
        Ok(rd) => rd,
        Err(e) => {
            let err = serde_json::json!({ "error": e.to_string() });
            return (StatusCode::BAD_REQUEST, Json(err)).into_response();
        }
    };

    let mut entries = Vec::new();
    loop {
        let entry = match rd.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(e) => {
                let err = serde_json::json!({ "error": e.to_string() });
                return (StatusCode::BAD_REQUEST, Json(err)).into_response();
            }
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        let path = entry.path().to_string_lossy().to_string();
        entries.push(FileEntry { name, path, is_dir });
    }

    // dirs first, then alphabetical
    entries.sort_by_cached_key(|e| (!e.is_dir, e.name.to_lowercase()));

    (StatusCode::OK, Json(entries)).into_response()
}

pub async fn list_tools_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        tools::handle_tools_list_json(),
    )
}

pub async fn call_tool_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ToolCallRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    match tools::call_tool(&request.name, &request.arguments, &state.config).await {
        Ok(val) => (StatusCode::OK, Json(val)).into_response(),
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            (StatusCode::BAD_REQUEST, Json(err)).into_response()
        }
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_tools_handler))
        .route("/call", post(call_tool_handler))
}

// ── File CRUD ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateFileRequest {
    path: String,
    #[serde(rename = "type")]
    kind: String, // "file" | "folder"
}

#[derive(Deserialize)]
pub struct RenameFileRequest {
    #[serde(rename = "newPath")]
    new_path: String,
}

fn bad(msg: impl ToString) -> axum::response::Response {
    (StatusCode::BAD_REQUEST, msg.to_string()).into_response()
}

fn readonly() -> axum::response::Response {
    (
        StatusCode::FORBIDDEN,
        "File write operations are disabled (hterm is running in read-only mode).",
    )
        .into_response()
}

fn safe_path(p: &str) -> Option<PathBuf> {
    let p = Path::new(p);
    // must be absolute and must not escape via ..
    if !p.is_absolute() { return None; }
    let clean = p.components().fold(PathBuf::new(), |mut acc, c| {
        match c {
            std::path::Component::ParentDir => { acc.pop(); acc }
            std::path::Component::Normal(n) => { acc.push(n); acc }
            std::path::Component::RootDir   => { acc.push("/"); acc }
            _ => acc,
        }
    });
    Some(clean)
}

pub async fn create_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateFileRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !state.config.writable {
        return readonly();
    }

    let Some(path) = safe_path(&req.path) else { return bad("invalid path"); };
    if req.kind == "folder" {
        match tokio::fs::create_dir_all(&path).await {
            Ok(_)  => StatusCode::CREATED.into_response(),
            Err(e) => bad(e),
        }
    } else {
        if let Some(parent) = path.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return bad(e);
            }
        }
        match tokio::fs::OpenOptions::new().create_new(true).write(true).open(&path).await {
            Ok(_)  => StatusCode::CREATED.into_response(),
            Err(e) => bad(e),
        }
    }
}

pub async fn rename_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(tail): axum::extract::Path<String>,
    Json(req): Json<RenameFileRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !state.config.writable {
        return readonly();
    }

    let src = format!("/{}", tail);
    let Some(src_path) = safe_path(&src) else { return bad("invalid source path"); };
    let Some(dst_path) = safe_path(&req.new_path) else { return bad("invalid dest path"); };
    if let Some(parent) = dst_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return bad(e);
        }
    }
    match tokio::fs::rename(&src_path, &dst_path).await {
        Ok(_)  => StatusCode::OK.into_response(),
        Err(e) => bad(e),
    }
}

pub async fn delete_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(tail): axum::extract::Path<String>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !state.config.writable {
        return readonly();
    }

    let p = format!("/{}", tail);
    let Some(path) = safe_path(&p) else { return bad("invalid path"); };
    let result = tokio::task::spawn_blocking(move || {
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        }
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))
    .and_then(|result| result);
    match result {
        Ok(_)  => StatusCode::NO_CONTENT.into_response(),
        Err(e) => bad(e),
    }
}

pub fn files_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_files_handler).post(create_file_handler))
        .route("/read", get(read_file_handler))
        .route("/copy", post(copy_file_handler))
        .route("/{*path}", patch(rename_file_handler).delete(delete_file_handler))
}

pub async fn read_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<FilesQuery>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let Some(path) = q.path.as_deref().and_then(safe_path) else {
        return bad("invalid path");
    };

    match tools::read_file_content(&path.to_string_lossy()).await {
        Ok(tools::FileRead::Text { content, size }) => (
            StatusCode::OK,
            Json(ReadFileResponse {
                content,
                is_binary: false,
                size,
            }),
        )
            .into_response(),
        Ok(tools::FileRead::Binary { size }) => (
            StatusCode::OK,
            Json(ReadFileResponse {
                content: String::new(),
                is_binary: true,
                size,
            }),
        )
            .into_response(),
        Err(e) => bad(e),
    }
}

#[derive(Deserialize)]
pub struct CopyFileRequest {
    src: String,
    dst: String,
}

pub async fn copy_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CopyFileRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !state.config.writable {
        return readonly();
    }

    let Some(src) = safe_path(&req.src) else { return bad("invalid src path"); };
    let Some(dst) = safe_path(&req.dst) else { return bad("invalid dst path"); };
    let src_meta = match tokio::fs::metadata(&src).await {
        Ok(meta) => meta,
        Err(e) => return bad(e),
    };
    if src_meta.is_dir() && (dst == src || dst.starts_with(&src)) {
        return bad("cannot copy a directory into itself");
    }
    if let Some(parent) = dst.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return bad(e);
        }
    }
    let result = tokio::task::spawn_blocking(move || copy_recursive(&src, &dst))
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))
        .and_then(|result| result);
    match result {
        Ok(_)  => StatusCode::CREATED.into_response(),
        Err(e) => bad(e),
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}
