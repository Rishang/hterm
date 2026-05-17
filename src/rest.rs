use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::ws::AppState;
use crate::tools;

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

pub async fn list_files_handler(
    Query(q): Query<FilesQuery>,
) -> impl IntoResponse {
    let dir = q.path.unwrap_or_else(|| "/".to_string());
    let path = std::path::Path::new(&dir);

    let rd = match std::fs::read_dir(path) {
        Ok(rd) => rd,
        Err(e) => {
            let err = serde_json::json!({ "error": e.to_string() });
            return (StatusCode::BAD_REQUEST, Json(err)).into_response();
        }
    };

    let mut entries: Vec<FileEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let full = format!("{}/{}", dir.trim_end_matches('/'), name);
            Some(FileEntry { name, path: full, is_dir })
        })
        .collect();

    // dirs first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

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

fn safe_path(p: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(p);
    // must be absolute and must not escape via ..
    if !p.is_absolute() { return None; }
    let clean = p.components().fold(std::path::PathBuf::new(), |mut acc, c| {
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

    let Some(path) = safe_path(&req.path) else { return bad("invalid path"); };
    if req.kind == "folder" {
        match std::fs::create_dir_all(&path) {
            Ok(_)  => StatusCode::CREATED.into_response(),
            Err(e) => bad(e),
        }
    } else {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::OpenOptions::new().create_new(true).write(true).open(&path) {
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

    let src = format!("/{}", tail);
    let Some(src_path) = safe_path(&src) else { return bad("invalid source path"); };
    let Some(dst_path) = safe_path(&req.new_path) else { return bad("invalid dest path"); };
    if let Some(parent) = dst_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::rename(&src_path, &dst_path) {
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

    let p = format!("/{}", tail);
    let Some(path) = safe_path(&p) else { return bad("invalid path"); };
    let result = if path.is_dir() {
        std::fs::remove_dir_all(&path)
    } else {
        std::fs::remove_file(&path)
    };
    match result {
        Ok(_)  => StatusCode::NO_CONTENT.into_response(),
        Err(e) => bad(e),
    }
}

pub fn files_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_files_handler).post(create_file_handler))
        .route("/copy", post(copy_file_handler))
        .route("/{*path}", patch(rename_file_handler).delete(delete_file_handler))
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

    let Some(src) = safe_path(&req.src) else { return bad("invalid src path"); };
    let Some(dst) = safe_path(&req.dst) else { return bad("invalid dst path"); };
    if src.is_dir() && (dst == src || dst.starts_with(&src)) {
        return bad("cannot copy a directory into itself");
    }
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match copy_recursive(&src, &dst) {
        Ok(_)  => StatusCode::CREATED.into_response(),
        Err(e) => bad(e),
    }
}

fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
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
