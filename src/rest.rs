use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, sync::Arc};

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
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<FilesQuery>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
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

pub async fn list_tools_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return tools::unauthorized(&state.config);
    }
    (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], tools::handle_tools_list_json()).into_response()
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
        .layer(axum::extract::DefaultBodyLimit::max(tools::MAX_TOOL_REQUEST_BODY))
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
    /// Replace an existing destination instead of answering 409.
    #[serde(default)]
    overwrite: bool,
}

fn bad(msg: impl ToString) -> axum::response::Response {
    (StatusCode::BAD_REQUEST, msg.to_string()).into_response()
}

fn exists() -> axum::response::Response {
    (StatusCode::CONFLICT, "destination already exists").into_response()
}

/// Same inode, so writing one truncates the other (also true for hard links
/// and for a symlink followed by `metadata`).
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

fn readonly() -> axum::response::Response {
    (StatusCode::FORBIDDEN, "File write operations are disabled (hterm is running in read-only mode).").into_response()
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

    let Some(path) = tools::safe_path(&req.path) else {
        return bad("invalid path");
    };
    if req.kind == "folder" {
        match tokio::fs::create_dir_all(&path).await {
            Ok(_) => StatusCode::CREATED.into_response(),
            Err(e) => bad(e),
        }
    } else {
        if let Some(parent) = path.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                return bad(e);
            }
        }
        match tokio::fs::OpenOptions::new().create_new(true).write(true).open(&path).await {
            Ok(_) => StatusCode::CREATED.into_response(),
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
    let Some(src_path) = tools::safe_path(&src) else {
        return bad("invalid source path");
    };
    let Some(dst_path) = tools::safe_path(&req.new_path) else {
        return bad("invalid dest path");
    };
    if dst_path == src_path {
        return StatusCode::OK.into_response();
    }
    // rename(2) silently replaces an existing file, so refuse unless asked.
    if !req.overwrite && tokio::fs::symlink_metadata(&dst_path).await.is_ok() {
        return exists();
    }
    if let Some(parent) = dst_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return bad(e);
        }
    }
    match tokio::fs::rename(&src_path, &dst_path).await {
        Ok(_) => StatusCode::OK.into_response(),
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
    let Some(path) = tools::safe_path(&p) else {
        return bad("invalid path");
    };
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
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => bad(e),
    }
}

pub fn files_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_files_handler).post(create_file_handler))
        .route("/read", get(read_file_handler))
        .route("/copy", post(copy_file_handler))
        .route("/download", get(download_file_handler))
        .route("/find", get(find_files_handler))
        .route("/search", get(search_files_handler))
        .route("/upload", axum::routing::put(upload_file_handler))
        .route("/watch", crate::watch::routes())
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

    let Some(path) = q.path.as_deref().and_then(tools::safe_path) else {
        return bad("invalid path");
    };

    match tools::read_file_content(&path.to_string_lossy()).await {
        Ok(tools::FileRead::Text { content, size }) => {
            (StatusCode::OK, Json(ReadFileResponse { content, is_binary: false, size })).into_response()
        }
        Ok(tools::FileRead::Binary { size }) => {
            (StatusCode::OK, Json(ReadFileResponse { content: String::new(), is_binary: true, size })).into_response()
        }
        Err(e) => bad(e),
    }
}

#[derive(Deserialize)]
pub struct CopyFileRequest {
    src: String,
    dst: String,
    /// Replace an existing file (or merge into an existing directory) instead of answering 409.
    #[serde(default)]
    overwrite: bool,
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

    let Some(src) = tools::safe_path(&req.src) else {
        return bad("invalid src path");
    };
    let Some(dst) = tools::safe_path(&req.dst) else {
        return bad("invalid dst path");
    };
    let src_meta = match tokio::fs::metadata(&src).await {
        Ok(meta) => meta,
        Err(e) => return bad(e),
    };
    if src_meta.is_dir() && (dst == src || dst.starts_with(&src)) {
        return bad("cannot copy a directory into itself");
    }
    if let Ok(dst_meta) = tokio::fs::symlink_metadata(&dst).await {
        // Copying a file onto itself would truncate it to zero bytes.
        let target = tokio::fs::metadata(&dst).await.unwrap_or(dst_meta);
        if same_file(&src_meta, &target) {
            return bad("source and destination are the same file");
        }
        if !req.overwrite {
            return exists();
        }
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
        Ok(_) => StatusCode::CREATED.into_response(),
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
        // A same-inode destination inside a merged directory would be truncated.
        if let Ok(dst_meta) = std::fs::metadata(dst) {
            if same_file(&std::fs::metadata(src)?, &dst_meta) {
                return Ok(());
            }
        }
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

// ── Download ──────────────────────────────────────────────────────────────────

/// Chunks buffered between the blocking reader/zip task and the response body.
/// Bounds memory per download: a slow client back-pressures the producer.
const DOWNLOAD_CHANNEL_CAP: usize = 8;
const DOWNLOAD_CHUNK_BYTES: usize = 64 * 1024;

type DownloadChunk = std::io::Result<bytes::Bytes>;

/// `std::io::Write` sink feeding the response body. A dropped receiver (client
/// went away) surfaces as `BrokenPipe`, which aborts the producer early.
struct ChannelWriter(tokio::sync::mpsc::Sender<DownloadChunk>);

impl std::io::Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .blocking_send(Ok(bytes::Bytes::copy_from_slice(buf)))
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    path: Option<String>,
    /// JSON array of absolute paths, downloaded together as `selection.zip`.
    paths: Option<String>,
}

/// `GET /api/files/download?path=…` — a regular file is sent as-is; a directory
/// is streamed as `<name>.zip`. `?paths=[…]` streams several files and
/// directories as one `selection.zip`. Either way the body is produced on a
/// blocking task and never buffered whole in memory.
pub async fn download_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<DownloadQuery>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let raw = match (q.path, q.paths) {
        (Some(path), None) => vec![path],
        (None, Some(json)) => match serde_json::from_str::<Vec<String>>(&json) {
            Ok(paths) if !paths.is_empty() => paths,
            _ => return bad("paths must be a non-empty JSON array of strings"),
        },
        _ => return bad("pass either path or paths"),
    };
    let mut paths = Vec::with_capacity(raw.len());
    let mut single_file_len = None;
    for raw_path in &raw {
        let Some(path) = tools::safe_path(raw_path) else {
            return bad("invalid path");
        };
        let meta = match tokio::fs::metadata(&path).await {
            Ok(meta) => meta,
            Err(e) => return bad(format!("{}: {e}", path.display())),
        };
        // Devices and FIFOs can stream forever; only files and directories are offered.
        if !meta.is_file() && !meta.is_dir() {
            return bad(format!("{}: not a regular file or directory", path.display()));
        }
        if raw.len() == 1 && meta.is_file() {
            single_file_len = Some(meta.len());
        }
        paths.push(path);
    }
    let name = |p: &Path| p.file_name().map_or_else(|| "root".to_string(), |n| n.to_string_lossy().into_owned());
    let (file_name, content_type) = match (single_file_len, paths.as_slice()) {
        (Some(_), [path]) => {
            (name(path), mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string())
        }
        (None, [dir]) => (format!("{}.zip", name(dir)), "application/zip".to_string()),
        _ => ("selection.zip".to_string(), "application/zip".to_string()),
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<DownloadChunk>(DOWNLOAD_CHANNEL_CAP);
    tokio::task::spawn_blocking(move || {
        let sink = std::io::BufWriter::with_capacity(DOWNLOAD_CHUNK_BYTES, ChannelWriter(tx.clone()));
        let result = if single_file_len.is_some() {
            std::fs::File::open(&paths[0]).and_then(|mut file| {
                let mut sink = sink;
                std::io::copy(&mut file, &mut sink)?;
                std::io::Write::flush(&mut sink)
            })
        } else {
            tools::zip_paths(&paths, sink)
        };
        if let Err(e) = result {
            if e.kind() != std::io::ErrorKind::BrokenPipe {
                tracing::warn!(paths = ?paths, error = %e, "download aborted");
                // Erroring the body stream makes the client see a failed download
                // instead of a silently truncated file.
                let _ = tx.blocking_send(Err(e));
            }
        }
    });

    let body = axum::body::Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx));
    let mut response = (
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type), (header::CONTENT_DISPOSITION, content_disposition(&file_name))],
        body,
    )
        .into_response();
    if let Some(len) = single_file_len {
        response.headers_mut().insert(header::CONTENT_LENGTH, len.into());
    }
    response
}

/// `attachment` disposition with an ASCII fallback plus the RFC 5987 UTF-8 name.
fn content_disposition(name: &str) -> String {
    let fallback: String =
        name.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' }).collect();
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{}", tools::percent_encode(name.as_bytes(), b""))
}

// ── Upload ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UploadQuery {
    path: String,
    #[serde(default)]
    overwrite: bool,
}

/// `PUT /api/files/upload?path=…[&overwrite=true]` — the raw request body is
/// streamed to `path` (see `tools::write_upload`), creating missing parent
/// directories so folder uploads can send one request per file. An existing
/// file is a 409 unless `overwrite` is set; over `MAX_UPLOAD_FILE` is a 413.
pub async fn upload_file_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<UploadQuery>,
    body: axum::body::Body,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !state.config.writable {
        return readonly();
    }

    let Some(path) = tools::safe_path(&q.path) else {
        return bad("invalid path");
    };
    match tools::write_upload(&path, q.overwrite, tools::MAX_UPLOAD_FILE, body.into_data_stream()).await {
        Ok(_) => StatusCode::CREATED.into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            (StatusCode::CONFLICT, "file already exists").into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::FileTooLarge => {
            (StatusCode::PAYLOAD_TOO_LARGE, e.to_string()).into_response()
        }
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "upload aborted");
            bad(e)
        }
    }
}

// ── Project file index and content search ───────────────────────────────────
//
// Both run rg/grep/fd/find with fixed arguments and no shell, so they stay
// available in read-only mode, where the `bash` tool and `/api/exec` are off.

/// Heavy directories search skips; rg and fd also honour .gitignore.
const SEARCH_EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "bower_components",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    ".hypothesis",
    ".eggs",
    "__pypackages__",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    ".gradle",
    ".dart_tool",
    ".build",
    "bin",
    "obj",
    "vendor",
    ".bundle",
    "Pods",
    ".terraform",
    ".cache",
];
/// One more line than the browser shows (`MAX_RESULT_LINES` in globalSearch.js),
/// so it can tell "exactly at the cap" from "more than the cap".
const MAX_SEARCH_LINES: usize = 2001;
const MAX_INDEX_FILES: usize = 200_000;
const SEARCH_TIMEOUT_SECS: u64 = 60;

/// Run the first of `candidates` that is installed and return its index, up to
/// `max_lines` of stdout, and its exit code when it finished on its own (a
/// command stopped at the line or byte cap has none).
async fn first_installed_lines(
    cfg: &crate::config::AppConfig,
    candidates: &[(&str, Vec<String>)],
    max_lines: usize,
) -> std::io::Result<(usize, String, Option<i32>)> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt};

    for (i, (program, args)) in candidates.iter().enumerate() {
        let mut cmd = tokio::process::Command::new(program);
        cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(unix)]
        if let Some(uid) = cfg.uid {
            cmd.uid(uid);
        }
        #[cfg(unix)]
        if let Some(gid) = cfg.gid {
            cmd.gid(gid);
        }
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        let stdout = child.stdout.take().expect("stdout is piped");
        let mut reader = tokio::io::BufReader::new(stdout.take(tools::MAX_CMD_OUTPUT_TOTAL as u64));
        let (mut out, mut lines, mut buf) = (String::new(), 0, Vec::new());
        let read = async {
            while lines < max_lines {
                buf.clear();
                if reader.read_until(b'\n', &mut buf).await? == 0 {
                    return Ok::<_, std::io::Error>(true);
                }
                out.push_str(&String::from_utf8_lossy(&buf));
                lines += 1;
            }
            Ok(false)
        };
        let finished = tokio::time::timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS), read)
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "search timed out"))??;
        let code = if finished { child.wait().await?.code() } else { None };
        // Stops a command cut off at the cap; kill_on_drop covers the error paths.
        let _ = child.kill().await;
        return Ok((i, out, code));
    }
    let names: Vec<&str> = candidates.iter().map(|(program, _)| *program).collect();
    Err(std::io::Error::new(std::io::ErrorKind::NotFound, format!("none of {} is installed", names.join(", "))))
}

/// `GET /api/files/find` — every file under the server's working directory as
/// newline-separated absolute paths (rg, then fd, then find).
pub async fn find_files_handler(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let cfg = &state.config;
    let root = if cfg.cwd.is_empty() {
        std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_else(|_| "/".into())
    } else {
        cfg.cwd.clone()
    };
    let mut find = vec![root.clone(), "-type".into(), "f".into()];
    for dir in [".git", "node_modules", "dist", "target"] {
        find.extend(["-not".into(), "-path".into(), format!("*/{dir}/*")]);
    }
    let candidates = [
        ("rg", vec!["--files".into(), root.clone()]),
        ("fd", vec!["-t".into(), "f".into(), ".".into(), root]),
        ("find", find),
    ];
    match first_installed_lines(cfg, &candidates, MAX_INDEX_FILES).await {
        Ok((_, out, _)) => (StatusCode::OK, out).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    query: String,
    root: String,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regexp: bool,
    /// Comma/space separated globs.
    #[serde(default)]
    include: String,
    #[serde(default)]
    exclude: String,
}

/// `GET /api/files/search?query=…&root=…` — content search with rg, or grep
/// when rg is missing. The plain-text body starts with a `__RG__` or `__GREP__`
/// line naming the format of the `path:line[:column]:text` lines that follow.
pub async fn search_files_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(root) = tools::safe_path(&q.root) else {
        return bad("invalid root");
    };
    if q.query.is_empty() {
        return bad("empty query");
    }
    let root = root.to_string_lossy().into_owned();
    let globs = |raw: &str| raw.split([',', ' ', '\t', '\n']).filter(|g| !g.is_empty()).map(str::to_string).collect();
    let (includes, excludes): (Vec<String>, Vec<String>) = (globs(&q.include), globs(&q.exclude));

    let mut rg: Vec<String> =
        ["--line-number", "--column", "--no-heading", "--color", "never", "--hidden"].map(String::from).into();
    for dir in SEARCH_EXCLUDED_DIRS {
        rg.extend(["--glob".into(), format!("!**/{dir}/**")]);
    }
    rg.push(if q.case_sensitive { "--case-sensitive" } else { "--ignore-case" }.into());
    if q.whole_word {
        rg.push("--word-regexp".into());
    }
    if !q.regexp {
        rg.push("--fixed-strings".into());
    }
    for g in &includes {
        rg.extend(["--glob".into(), g.clone()]);
    }
    for g in &excludes {
        rg.extend(["--glob".into(), format!("!{g}")]);
    }
    rg.extend(["--regexp".into(), q.query.clone(), root.clone()]);

    // grep can't report columns, so the browser falls back to column 1 for it.
    let mut grep: Vec<String> = ["-rnI", "--binary-files=without-match"].map(String::from).into();
    for dir in SEARCH_EXCLUDED_DIRS {
        grep.push(format!("--exclude-dir={dir}"));
    }
    if !q.case_sensitive {
        grep.push("-i".into());
    }
    if q.whole_word {
        grep.push("-w".into());
    }
    grep.push(if q.regexp { "-E" } else { "-F" }.into());
    grep.extend(includes.iter().map(|g| format!("--include={g}")));
    grep.extend(excludes.iter().map(|g| format!("--exclude={g}")));
    grep.extend(["-e".into(), q.query, root]);

    match first_installed_lines(&state.config, &[("rg", rg), ("grep", grep)], MAX_SEARCH_LINES).await {
        // Exit 1 is "no match"; 2 with no output is a bad pattern or root.
        Ok((_, out, Some(2))) if out.is_empty() => bad("search failed: check the pattern and folder"),
        Ok((tool, out, _)) => {
            let marker = if tool == 0 { "__RG__" } else { "__GREP__" };
            (StatusCode::OK, format!("{marker}\n{out}")).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[cfg(test)]
mod download_tests {
    use super::*;

    #[test]
    fn content_disposition_escapes_quotes_and_utf8() {
        let header = content_disposition("a\"b é.txt");
        assert_eq!(header, "attachment; filename=\"a_b _.txt\"; filename*=UTF-8''a%22b%20%C3%A9.txt");
    }

    #[test]
    fn copy_into_a_directory_holding_a_hard_link_keeps_the_file() {
        let root = std::env::temp_dir().join(format!("hterm-copy-{}", uuid::Uuid::new_v4()));
        let (src, dst) = (root.join("src"), root.join("dst"));
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "keep").unwrap();
        std::fs::hard_link(src.join("a.txt"), dst.join("a.txt")).unwrap();
        copy_recursive(&src, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(src.join("a.txt")).unwrap(), "keep");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn search_falls_back_past_missing_programs_and_caps_lines() {
        let cfg = crate::config::AppConfig::default();
        let candidates = [("hterm-no-such-program", vec![]), ("printf", vec!["a\\nb\\nc\\n".to_string()])];
        let (tool, out, code) = first_installed_lines(&cfg, &candidates, 2).await.unwrap();
        assert_eq!((tool, out.as_str(), code), (1, "a\nb\n", None));
        let (_, out, code) = first_installed_lines(&cfg, &candidates, 10).await.unwrap();
        assert_eq!((out.as_str(), code), ("a\nb\nc\n", Some(0)));
    }
}
