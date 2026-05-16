use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
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
            // skip hidden files
            if name.starts_with('.') { return None; }
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
