use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
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

pub async fn list_tools_handler() -> impl IntoResponse {
    Json(tools::handle_tools_list())
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
