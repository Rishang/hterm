use axum::http::HeaderMap;
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use crate::config::AppConfig;
use crate::ws::AppState;

/// Combined stdout + stderr bytes captured from command tools.
/// Excess output is drained but not retained, preventing unbounded memory use.
pub(crate) const MAX_CMD_OUTPUT_TOTAL: usize = 10 * 1024 * 1024; // 10 MiB

/// Maximum file size that `read_file` will load into memory.
pub(crate) const MAX_READ_FILE: u64 = 8 * 1024 * 1024; // 8 MiB

/// Maximum custom index.html size accepted from disk.
pub(crate) const MAX_CUSTOM_INDEX_SIZE: u64 = 2 * 1024 * 1024; // 2 MiB

/// Maximum raw bytes `download_file`/`upload_file` move through one tool call.
/// The payload travels base64-encoded inside JSON-RPC, so it is held in memory.
pub(crate) const MAX_TOOL_TRANSFER: usize = 8 * 1024 * 1024; // 8 MiB

/// JSON body limit for tool calls: a full `MAX_TOOL_TRANSFER` upload once
/// base64-encoded, plus room for the JSON-RPC envelope.
pub(crate) const MAX_TOOL_REQUEST_BODY: usize = MAX_TOOL_TRANSFER.div_ceil(3) * 4 + 64 * 1024;

/// Largest file `PUT /api/files/upload` streams to disk.
pub(crate) const MAX_UPLOAD_FILE: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB

/// Bytes sampled to classify files before deciding whether full reads are safe.
const FILE_TYPE_SAMPLE_SIZE: usize = 8 * 1024;

pub(crate) enum FileRead {
    Text { content: String, size: u64 },
    Binary { size: u64 },
}

// ── Tool definitions (camelCase, Claude Code inspired) ───────────────────────

fn tool_bash() -> Value {
    json!({
        "name": "bash",
        "description": "Execute bash commands or scripts on the remote host. Commands run with 'set -x' (verbose mode) enabled, showing each command before execution for better debugging. Use this as your primary way to explore the environment, run scripts, install dependencies, compile code, and interact with the system. Returns stdout, stderr, and exit code.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The bash command or script to execute. Supports pipes, redirects, and multiline scripts."
                },
                "cwd": {
                    "type": "string",
                    "description": "(Optional) Working directory to run the command in."
                },
                "timeout": {
                    "type": "integer",
                    "description": "(Optional) Timeout in seconds (1-3600, default 300)."
                }
            },
            "required": ["command"]
        }
    })
}

fn tool_read_file() -> Value {
    json!({
        "name": "read_file",
        "description": "Read the complete contents of a UTF-8 text file. Use this to inspect source code, configuration files, logs, or any text-based file. Binary files are not read; metadata and file type information are returned instead.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file."
                }
            },
            "required": ["path"]
        }
    })
}

fn tool_write_file() -> Value {
    json!({
        "name": "write_file",
        "description": "Create a new file or completely overwrite an existing file with the provided content. Use this for creating new files from scratch and for modifying existing files (read it first, then write back the full updated content). For surgical in-place edits, use the 'bash' tool (e.g. sed). Maximum file size: 100MB.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path where the file should be written."
                },
                "content": {
                    "type": "string",
                    "description": "The complete text content to write."
                }
            },
            "required": ["path", "content"]
        }
    })
}

fn tool_download_file() -> Value {
    json!({
        "name": "download_file",
        "description": "Download a file or directory from the remote host as base64. A regular file is returned as-is; a directory is returned as a zip archive (top-level folder included, symlinked directories and unreadable entries skipped). The bytes arrive as an embedded resource ('blob', base64) next to a text summary. Maximum payload: 8 MiB; use the REST endpoint GET /api/files/download for larger transfers.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path of the file or directory."
                }
            },
            "required": ["path"]
        }
    })
}

fn tool_upload_file() -> Value {
    json!({
        "name": "upload_file",
        "description": "Upload binary or text content to a file on the remote host. The content is base64-encoded; missing parent directories are created. Fails if the file already exists unless 'overwrite' is true. Maximum decoded size: 8 MiB; use the REST endpoint PUT /api/files/upload for larger transfers. For plain text, 'write_file' is simpler.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path of the file to create."
                },
                "content": {
                    "type": "string",
                    "description": "File content, base64-encoded (standard alphabet, padded)."
                },
                "overwrite": {
                    "type": "boolean",
                    "description": "(Optional) Replace an existing file (default false)."
                }
            },
            "required": ["path", "content"]
        }
    })
}

pub fn handle_tools_list() -> Value {
    static TOOLS: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| {
        json!({
            "tools": [
                tool_bash(),
                tool_read_file(),
                tool_write_file(),
                tool_download_file(),
                tool_upload_file()
            ]
        })
    });
    TOOLS.clone()
}

pub fn handle_tools_list_json() -> &'static str {
    static TOOLS_JSON: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| serde_json::to_string(&handle_tools_list()).unwrap_or_default());
    TOOLS_JSON.as_str()
}

/// Unified authentication check for both MCP and REST APIs
pub fn check_auth(state: &AppState, headers: &HeaderMap) -> bool {
    let cfg = &state.config;
    if !cfg.auth_header.is_empty() {
        headers.get(cfg.auth_header.as_str()).is_some()
    } else if let Some(ref expected) = state.expected_auth {
        crate::ws::check_basic_auth(headers, expected)
    } else {
        true
    }
}

/// DNS-rebinding guard. With no auth configured, any website could point its
/// own DNS name at this server and call the API as a same-origin page. Such a
/// page can only reach us under a DNS name it controls, so without auth only
/// loopback names, IP literals, the bind host, and `allowed_hosts` pass.
/// Requests without a Host (HTTP/1.0 clients, never browsers) pass too.
pub fn host_allowed(cfg: &AppConfig, host: Option<&str>) -> bool {
    let Some(host) = host else { return true };
    if !cfg.auth_header.is_empty() || !cfg.credential.is_empty() || host.starts_with('[') {
        return true;
    }
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name).to_ascii_lowercase();
    name.parse::<std::net::Ipv4Addr>().is_ok()
        || name == "localhost"
        || name.ends_with(".localhost")
        || name.eq_ignore_ascii_case(&cfg.host)
        || cfg.allowed_hosts.iter().any(|h| name.eq_ignore_ascii_case(h))
}

/// 401 response for a failed [`check_auth`] check.
///
/// Includes a `WWW-Authenticate` header only in `--credential` (Basic Auth)
/// mode, so the browser's native login prompt appears on the first page
/// load. Omitted for `--auth-header` (reverse-proxy) mode, since that
/// credential is injected by the upstream proxy, not typed by a user.
pub fn unauthorized(cfg: &AppConfig) -> axum::response::Response {
    use axum::response::IntoResponse;
    if cfg.auth_header.is_empty() && !cfg.credential.is_empty() {
        (axum::http::StatusCode::UNAUTHORIZED, [(axum::http::header::WWW_AUTHENTICATE, r#"Basic realm="hterm""#)])
            .into_response()
    } else {
        axum::http::StatusCode::UNAUTHORIZED.into_response()
    }
}

/// Call a tool by name with arguments directly (no "arguments" wrapper needed)
pub async fn call_tool(name: &str, arguments: &Value, cfg: &AppConfig) -> Result<Value, String> {
    match name {
        "bash" => bash_tool(arguments, cfg).await,
        "read_file" => read_file_tool(arguments).await,
        "write_file" => write_file_tool(arguments, cfg).await,
        "download_file" => download_file_tool(arguments).await,
        "upload_file" => upload_file_tool(arguments, cfg).await,
        other => Err(format!("Unknown tool: {}", other)),
    }
}

// ── Tool implementations ──────────────────────────────────────────────────────

/// Captured result of running a child process: the (capped) output streams,
/// the exit status if it finished, and whether it was killed for exceeding the
/// timeout. This is the shared "base exec" primitive; callers format it into
/// their own response shape (MCP tool result, JSON, etc.).
pub(crate) struct CommandCapture {
    pub(crate) stdout: CappedOutput,
    pub(crate) stderr: CappedOutput,
    pub(crate) status: Option<std::process::ExitStatus>,
    pub(crate) timed_out: bool,
}

/// Spawn `cmd` with stdout/stderr piped, enforce `timeout_secs`, and capture
/// combined-capped output. Returns `Err` only when the process cannot be
/// spawned; a timeout yields `Ok` with `timed_out = true` (child is killed).
pub(crate) async fn run_command_captured(
    mut cmd: tokio::process::Command,
    timeout_secs: u64,
) -> Result<CommandCapture, String> {
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), async {
        let budget = output_budget(MAX_CMD_OUTPUT_TOTAL);
        tokio::join!(
            read_capped_text(stdout_pipe, Arc::clone(&budget)),
            read_capped_text(stderr_pipe, budget),
            child.wait()
        )
    })
    .await
    {
        Ok((stdout, stderr, wait)) => Ok(CommandCapture { stdout, stderr, status: wait.ok(), timed_out: false }),
        Err(_) => {
            let _ = child.kill().await;
            Ok(CommandCapture {
                stdout: CappedOutput { text: String::new(), truncated: false },
                stderr: CappedOutput { text: String::new(), truncated: false },
                status: None,
                timed_out: true,
            })
        }
    }
}

/// Run a command with a timeout, capping combined stdout/stderr and reporting
/// success/failure as an MCP tool result.
async fn run_command(cmd: tokio::process::Command, cmd_name: &str, timeout_secs: u64) -> Result<Value, String> {
    let capture = match run_command_captured(cmd, timeout_secs).await {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn {}: {}", cmd_name, e))),
    };

    if capture.timed_out {
        return Ok(tool_error(format!("{} command timed out after {}s", cmd_name, timeout_secs)));
    }

    let mut text = capture.stdout.text;
    if capture.stdout.truncated {
        text.push_str("\n... (stdout truncated; combined output limit reached)");
    }
    if !capture.stderr.text.is_empty() {
        if !text.is_empty() {
            text.push_str("\n--- stderr ---\n");
        }
        text.push_str(&capture.stderr.text);
    }
    if capture.stderr.truncated {
        text.push_str("\n... (stderr truncated; combined output limit reached)");
    }
    if text.is_empty() {
        text = "(no output)".into();
    }
    let ok = capture.status.map(|s| s.success()).unwrap_or(false);
    tracing::info!(tool = cmd_name, success = ok, "command finished");
    Ok(if ok { tool_success(text) } else { tool_error(text) })
}

/// Execute bash commands with verbose mode (set -x) enabled.
async fn bash_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    if !cfg.writable {
        return Ok(read_only_error());
    }
    let command = extract_string(args, "command")?;

    let cwd = args.get("cwd").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cfg.cwd.clone());

    let timeout_secs: u64 = args.get("timeout").and_then(Value::as_u64).unwrap_or(300).clamp(1, 3600);

    let mut cmd = tokio::process::Command::new("bash");
    let mut verbose_command = String::with_capacity(7 + command.len());
    verbose_command.push_str("set -x\n");
    verbose_command.push_str(&command);
    cmd.arg("-c").arg(&verbose_command);

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

    run_command(cmd, "bash", timeout_secs).await
}

async fn read_file_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    match read_file_content(&path).await {
        Ok(FileRead::Text { content, .. }) => Ok(tool_success(content)),
        Ok(FileRead::Binary { .. }) => {
            let meta = tokio::fs::metadata(&path)
                .await
                .map_err(|e| format!("Failed to read metadata of '{}': {}", path, e))?;
            let metadata = format_file_metadata(&path, &meta).await;
            Ok(tool_success(format!("Binary file not read. Returning metadata only.\n{}", metadata)))
        }
        Err(e) => Ok(tool_error(e)),
    }
}

pub(crate) async fn read_file_content(path: &str) -> Result<FileRead, String> {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) if !m.is_file() => {
            return Err(format!("'{}' is not a regular file", path));
        }
        Ok(m) if m.len() > MAX_READ_FILE => {
            return Err(format!(
                "File '{}' is too large ({} bytes, max {} MiB). Use bash tool with head/tail instead.",
                path,
                m.len(),
                MAX_READ_FILE / (1024 * 1024)
            ));
        }
        Err(e) => {
            return Err(format!("Failed to read '{}': {}", path, e));
        }
        Ok(m) => m,
    };

    let bytes = tokio::fs::read(path).await.map_err(|e| format!("Failed to read '{}': {}", path, e))?;
    let sample_len = bytes.len().min(FILE_TYPE_SAMPLE_SIZE);
    if !is_text_content(&bytes[..sample_len]) {
        return Ok(FileRead::Binary { size: meta.len() });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(FileRead::Text { content, size: meta.len() }),
        Err(_) => Ok(FileRead::Binary { size: meta.len() }),
    }
}

async fn write_file_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    if !cfg.writable {
        return Ok(read_only_error());
    }

    let path = extract_path(args, "path")?;
    let content = extract_string(args, "content")?;

    const MAX_FILE_SIZE: usize = 100 * 1024 * 1024;
    if content.len() > MAX_FILE_SIZE {
        return Ok(tool_error(format!(
            "Content too large: {} bytes (max {} MB)",
            content.len(),
            MAX_FILE_SIZE / (1024 * 1024)
        )));
    }

    match tokio::fs::write(&path, content).await {
        Ok(_) => Ok(tool_success(format!("Successfully wrote to '{}'", path))),
        Err(e) => Ok(tool_error(format!("Failed to write '{}': {}", path, e))),
    }
}

async fn download_file_tool(args: &Value) -> Result<Value, String> {
    use base64::Engine;

    let path = extract_path(args, "path")?;
    let meta = match tokio::fs::metadata(&path).await {
        Ok(meta) => meta,
        Err(e) => return Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
    };
    let (bytes, mime) = if meta.is_dir() {
        let dir = std::path::PathBuf::from(&path);
        let zipped = tokio::task::spawn_blocking(move || {
            let mut sink = CappedWriter { buf: Vec::new(), cap: MAX_TOOL_TRANSFER };
            zip_paths(std::slice::from_ref(&dir), &mut sink).map(|_| sink.buf)
        })
        .await
        .map_err(|e| e.to_string())?;
        match zipped {
            Ok(bytes) => (bytes, "application/zip".to_string()),
            Err(e) => return Ok(tool_error(format!("Failed to zip '{}': {}", path, e))),
        }
    } else if meta.is_file() {
        if meta.len() > MAX_TOOL_TRANSFER as u64 {
            return Ok(tool_error(format!(
                "File '{}' is too large ({} bytes, max {} MiB).",
                path,
                meta.len(),
                MAX_TOOL_TRANSFER / (1024 * 1024)
            )));
        }
        match tokio::fs::read(&path).await {
            Ok(bytes) => (bytes, mime_guess::from_path(&path).first_or_octet_stream().to_string()),
            Err(e) => return Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
        }
    } else {
        return Ok(tool_error(format!("'{}' is not a regular file or directory", path)));
    };

    let absolute = std::path::absolute(&path).unwrap_or_else(|_| path.clone().into());
    Ok(json!({
        "content": [
            { "type": "text", "text": format!("{} ({} bytes, {})", path, bytes.len(), mime) },
            {
                "type": "resource",
                "resource": {
                    "uri": file_uri(&absolute),
                    "mimeType": mime,
                    "blob": base64::engine::general_purpose::STANDARD.encode(&bytes)
                }
            }
        ],
        "isError": false
    }))
}

async fn upload_file_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    use base64::Engine;

    if !cfg.writable {
        return Ok(read_only_error());
    }

    let path = extract_path(args, "path")?;
    let content = extract_string(args, "content")?;
    let overwrite = args.get("overwrite").and_then(Value::as_bool).unwrap_or(false);
    // Base64 inflates by 4/3; reject before decoding an oversized payload.
    if content.len() > MAX_TOOL_TRANSFER.div_ceil(3) * 4 {
        return Ok(tool_error(format!("Content too large (max {} MiB decoded)", MAX_TOOL_TRANSFER / (1024 * 1024))));
    }
    let bytes = match base64::engine::general_purpose::STANDARD.decode(content.trim()) {
        Ok(bytes) => bytes,
        Err(e) => return Ok(tool_error(format!("Invalid base64 content: {}", e))),
    };

    let chunks = futures::stream::iter([Ok::<_, std::io::Error>(bytes::Bytes::from(bytes))]);
    match write_upload(std::path::Path::new(&path), overwrite, MAX_TOOL_TRANSFER as u64, chunks).await {
        Ok(written) => Ok(tool_success(format!("Uploaded {} bytes to '{}'", written, path))),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Ok(tool_error(format!("'{}' already exists; pass overwrite: true to replace it", path)))
        }
        Err(e) => Ok(tool_error(format!("Failed to write '{}': {}", path, e))),
    }
}

fn read_only_error() -> Value {
    tool_error(
        "Write operations and command execution are disabled (hterm is running in read-only mode). \
         Restart with --writable to enable."
            .into(),
    )
}

/// Streams `chunks` to `path` through a temp file in the same directory that is
/// renamed into place only after every chunk has landed, so a failed transfer
/// never leaves a partial file nor touches the file it was replacing. Missing
/// parent directories are created. An existing file is `AlreadyExists` unless
/// `overwrite`; more than `max` bytes is `FileTooLarge`. Returns bytes written.
pub(crate) async fn write_upload<E>(
    path: &std::path::Path,
    overwrite: bool,
    max: u64,
    chunks: impl futures::Stream<Item = Result<bytes::Bytes, E>>,
) -> std::io::Result<u64>
where
    E: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    use futures::StreamExt;
    use std::io::{Error, ErrorKind};
    use tokio::io::AsyncWriteExt;

    let name = path.file_name().ok_or_else(|| Error::new(ErrorKind::InvalidInput, "path has no file name"))?;
    let existing = tokio::fs::metadata(path).await.ok();
    if existing.is_some() && !overwrite {
        return Err(ErrorKind::AlreadyExists.into());
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(std::path::Path::new("."));
    tokio::fs::create_dir_all(parent).await?;
    let tmp = parent.join(format!(".{}.upload-{}", name.to_string_lossy(), uuid::Uuid::new_v4()));

    let result = async {
        let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).await?;
        let mut chunks = std::pin::pin!(chunks);
        let mut written = 0u64;
        while let Some(chunk) = chunks.next().await {
            let chunk = chunk.map_err(Error::other)?;
            written += chunk.len() as u64;
            if written > max {
                return Err(Error::new(ErrorKind::FileTooLarge, format!("upload exceeds {max} bytes")));
            }
            file.write_all(&chunk).await?;
        }
        // tokio's `File` writes in the background; flush so errors surface here.
        file.flush().await?;
        // A replaced file keeps its mode (e.g. an executable script stays executable).
        if let Some(meta) = &existing {
            tokio::fs::set_permissions(&tmp, meta.permissions()).await?;
        }
        if !overwrite && tokio::fs::try_exists(path).await? {
            return Err(ErrorKind::AlreadyExists.into());
        }
        tokio::fs::rename(&tmp, path).await?;
        Ok(written)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

/// Percent-encodes every byte outside the RFC 3986 unreserved set and `keep`.
pub(crate) fn percent_encode(bytes: &[u8], keep: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    for &b in bytes {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) || keep.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `file://` URI with every byte outside RFC 3986 unreserved characters (and `/`) percent-encoded.
fn file_uri(path: &std::path::Path) -> String {
    use std::os::unix::ffi::OsStrExt;
    format!("file://{}", percent_encode(path.as_os_str().as_bytes(), b"/"))
}

/// In-memory `Write` sink that fails once `cap` bytes would be exceeded, so an
/// oversized directory stops zipping instead of growing without bound.
struct CappedWriter {
    buf: Vec<u8>,
    cap: usize,
}

impl std::io::Write for CappedWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if self.buf.len() + data.len() > self.cap {
            return Err(std::io::Error::other(format!("archive exceeds {} MiB", self.cap / (1024 * 1024))));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ── Archives ──────────────────────────────────────────────────────────────────

/// Writes `paths` as one zip: each file or directory becomes a top-level entry
/// under its own name (`name (2)` etc. when two share one), directories keeping
/// their tree. Symlinked directories are skipped (no cycles) and so are special
/// files and entries that cannot be read, so one bad entry does not void the archive.
pub(crate) fn zip_paths(paths: &[std::path::PathBuf], sink: impl std::io::Write) -> std::io::Result<()> {
    let mut zip = zip::ZipWriter::new_stream(sink).set_auto_large_file();
    let mut taken = std::collections::HashSet::new();
    for path in paths {
        let base = path.file_name().map_or_else(|| "root".to_string(), |n| n.to_string_lossy().into_owned());
        // `notes.txt` repeats as `notes (2).txt`, keeping the extension last.
        let (stem, ext) = match base.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
            _ => (base.as_str(), String::new()),
        };
        let name = (1..)
            .map(|i| if i == 1 { base.clone() } else { format!("{stem} ({i}){ext}") })
            .find(|n| taken.insert(n.clone()))
            .expect("an unused name always exists");
        let Ok(meta) = std::fs::metadata(path) else { continue };
        if meta.is_dir() {
            zip_dir_into(&mut zip, path, name)?;
        } else if meta.is_file() {
            zip_file_into(&mut zip, path, &meta, name)?;
        }
    }
    let mut sink = zip.finish().map_err(std::io::Error::other)?.into_inner();
    sink.flush()
}

fn zip_dir_into<W: std::io::Write>(
    zip: &mut zip::ZipWriter<zip::write::StreamWriter<W>>,
    dir: &std::path::Path,
    name: String,
) -> std::io::Result<()> {
    let mut stack = vec![(dir.to_path_buf(), name)];
    while let Some((current, rel)) = stack.pop() {
        // A directory removed mid-walk is skipped like any other unreadable entry.
        let Ok(dir_meta) = std::fs::metadata(&current) else { continue };
        zip.add_directory(format!("{rel}/"), zip_options(&dir_meta)).map_err(std::io::Error::other)?;

        let entries = match std::fs::read_dir(&current) {
            Ok(rd) => rd,
            Err(e) => {
                tracing::debug!(path = %current.display(), error = %e, "zip: skipping unreadable directory");
                continue;
            }
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let entry_name = format!("{rel}/{}", entry.file_name().to_string_lossy());
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_dir() {
                stack.push((entry_path, entry_name));
                continue;
            }
            // Follow symlinks to files, never to directories.
            let Ok(meta) = std::fs::metadata(&entry_path) else { continue };
            if meta.is_file() {
                zip_file_into(zip, &entry_path, &meta, entry_name)?;
            }
        }
    }
    Ok(())
}

fn zip_file_into<W: std::io::Write>(
    zip: &mut zip::ZipWriter<zip::write::StreamWriter<W>>,
    path: &std::path::Path,
    meta: &std::fs::Metadata,
    name: String,
) -> std::io::Result<()> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) => {
            tracing::debug!(path = %path.display(), error = %e, "zip: skipping unreadable file");
            return Ok(());
        }
    };
    // `set_auto_large_file` only fixes up the data descriptor; the writer
    // still aborts a >4 GiB entry unless it is flagged before writing.
    let options =
        zip_options(meta).unix_permissions(meta.permissions().mode()).large_file(meta.len() >= u64::from(u32::MAX));
    zip.start_file(name, options).map_err(std::io::Error::other)?;
    std::io::copy(&mut file, zip)?;
    Ok(())
}

fn zip_options(meta: &std::fs::Metadata) -> zip::write::SimpleFileOptions {
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    match meta.modified().ok().and_then(zip_mtime) {
        Some(mtime) => options.last_modified_time(mtime),
        None => options,
    }
}

/// Converts a timestamp to the zip (DOS, UTC) date-time. Uses Howard Hinnant's
/// days-to-civil algorithm so no calendar crate is needed.
fn zip_mtime(t: std::time::SystemTime) -> Option<zip::DateTime> {
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as u16;
    zip::DateTime::from_date_and_time(year, month, day, (rem / 3_600) as u8, (rem % 3_600 / 60) as u8, (rem % 60) as u8)
        .ok()
}

/// Format metadata for the binary-file branch of `read_file`.
async fn format_file_metadata(path: &str, meta: &std::fs::Metadata) -> String {
    let file_type = if meta.is_dir() {
        "directory"
    } else if meta.is_file() {
        "file"
    } else if meta.is_symlink() {
        "symlink"
    } else {
        "other"
    };

    let permissions = format!("{:o}", meta.permissions().mode() & 0o777);

    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let file_info = if meta.is_file() { detect_file_type(path).await } else { "N/A".to_string() };

    format!(
        "Path: {}\n\
         Type: {}\n\
         Size: {} bytes\n\
         Permissions: {}\n\
         Modified: {} (unix timestamp)\n\
         File Info: {}",
        path,
        file_type,
        meta.len(),
        permissions,
        modified,
        file_info
    )
}

/// Detect file type via the `file` command, falling back to extension-based MIME.
async fn detect_file_type(path: &str) -> String {
    let out = tokio::process::Command::new("file").arg("-b").arg("--").arg(path).output().await;
    match out {
        Ok(o) if o.status.success() && !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => mime_guess::from_path(path).first_or_octet_stream().to_string(),
    }
}

/// Check if content appears to be text (no null bytes, mostly printable chars)
fn is_text_content(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }

    // If contains null bytes in first 512 bytes, likely binary
    let check_len = bytes.len().min(512);
    if bytes[..check_len].contains(&0) {
        return false;
    }

    // Count printable/whitespace characters
    let printable_count =
        bytes[..check_len].iter().filter(|&&b| b.is_ascii_graphic() || b.is_ascii_whitespace()).count();

    // If >85% printable, consider it text
    (printable_count as f64 / check_len as f64) > 0.85
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| format!("Missing required argument: {}", key)).map(String::from)
}

/// A required path argument, made absolute-only and `..`-free by `safe_path`,
/// so tool writes cannot land relative to wherever hterm was started.
fn extract_path(args: &Value, key: &str) -> Result<String, String> {
    let raw = extract_string(args, key)?;
    safe_path(&raw)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| format!("'{}' must be an absolute path, got '{}'", key, raw))
}

/// Normalizes an absolute path lexically: `..` and `.` are resolved without
/// touching the filesystem. Relative paths are rejected.
pub(crate) fn safe_path(p: &str) -> Option<std::path::PathBuf> {
    use std::path::{Component, Path, PathBuf};
    let p = Path::new(p);
    if !p.is_absolute() {
        return None;
    }
    let clean = p.components().fold(PathBuf::new(), |mut acc, c| match c {
        Component::ParentDir => {
            acc.pop();
            acc
        }
        Component::Normal(n) => {
            acc.push(n);
            acc
        }
        Component::RootDir => {
            acc.push("/");
            acc
        }
        _ => acc,
    });
    Some(clean)
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

pub(crate) struct CappedOutput {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

type OutputBudget = Arc<AtomicUsize>;

pub(crate) fn output_budget(max: usize) -> OutputBudget {
    Arc::new(AtomicUsize::new(max))
}

/// Read from an async reader into a shared output budget, then discard the rest.
/// This bounds combined stdout/stderr memory while letting the child finish.
pub(crate) async fn read_capped_text<R: tokio::io::AsyncRead + Unpin>(
    reader: Option<R>,
    budget: OutputBudget,
) -> CappedOutput {
    use tokio::io::AsyncReadExt;

    let mut reader = match reader {
        Some(r) => r,
        None => return CappedOutput { text: String::new(), truncated: false },
    };
    let mut text = String::with_capacity(8 * 1024);
    let mut truncated = false;
    let mut tmp = [0u8; 8192];

    loop {
        match reader.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => {
                let take = take_output_budget(&budget, n);
                if take > 0 {
                    text.push_str(&String::from_utf8_lossy(&tmp[..take]));
                }
                if take < n {
                    truncated = true;
                    // Keep draining to avoid SIGPIPE killing the child while
                    // retaining no additional command output.
                    tokio::io::copy(&mut reader, &mut tokio::io::sink()).await.ok();
                    break;
                }
            }
            Err(_) => break,
        }
    }

    CappedOutput { text, truncated }
}

fn take_output_budget(budget: &AtomicUsize, requested: usize) -> usize {
    let mut available = budget.load(Ordering::Relaxed);
    loop {
        if available == 0 {
            return 0;
        }
        let take = requested.min(available);
        match budget.compare_exchange_weak(available, available - take, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return take,
            Err(next) => available = next,
        }
    }
}

#[cfg(test)]
mod archive_tests {
    use super::*;

    #[test]
    fn zip_mtime_matches_known_date() {
        // 2024-02-29T13:45:30Z
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_709_214_330);
        let dt = zip_mtime(t).unwrap();
        assert_eq!((dt.year(), dt.month(), dt.day()), (2024, 2, 29));
        assert_eq!((dt.hour(), dt.minute(), dt.second()), (13, 45, 30));
    }

    #[test]
    fn zip_dir_round_trips_and_skips_symlinked_dirs() {
        let root = std::env::temp_dir().join(format!("hterm-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("proj/sub")).unwrap();
        std::fs::write(root.join("proj/a.txt"), b"hello").unwrap();
        std::fs::write(root.join("proj/sub/b.txt"), b"world").unwrap();
        std::os::unix::fs::symlink(root.join("proj"), root.join("proj/sub/loop")).unwrap();

        let mut out = Vec::new();
        zip_paths(&[root.join("proj")], &mut out).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(out)).unwrap();
        let mut names: Vec<_> = archive.file_names().map(|n| n.unwrap().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["proj/", "proj/a.txt", "proj/sub/", "proj/sub/b.txt"]);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("proj/sub/b.txt").unwrap(), &mut text).unwrap();
        assert_eq!(text, "world");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn zip_paths_bundles_a_selection_and_dedupes_names() {
        let root = std::env::temp_dir().join(format!("hterm-sel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("x/docs")).unwrap();
        std::fs::create_dir_all(root.join("y")).unwrap();
        std::fs::write(root.join("x/notes.txt"), "one").unwrap();
        std::fs::write(root.join("y/notes.txt"), "two").unwrap();
        std::fs::write(root.join("x/docs/d.md"), "doc").unwrap();

        let mut out = Vec::new();
        zip_paths(&[root.join("x/notes.txt"), root.join("y/notes.txt"), root.join("x/docs")], &mut out).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(out)).unwrap();
        let mut names: Vec<_> = archive.file_names().map(|n| n.unwrap().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["docs/", "docs/d.md", "notes (2).txt", "notes.txt"]);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("notes (2).txt").unwrap(), &mut text).unwrap();
        assert_eq!(text, "two");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn upload_then_download_round_trips() {
        use base64::Engine;
        let cfg = AppConfig { writable: true, ..Default::default() };
        let root = std::env::temp_dir().join(format!("hterm-up-{}", uuid::Uuid::new_v4()));
        let path = root.join("nested/blob.bin");
        let path_str = path.to_string_lossy().to_string();
        let payload = base64::engine::general_purpose::STANDARD.encode([0u8, 255, 10, 13]);
        let args = json!({ "path": path_str, "content": payload });

        assert_eq!(upload_file_tool(&args, &cfg).await.unwrap()["isError"], false);
        assert_eq!(std::fs::read(&path).unwrap(), [0u8, 255, 10, 13]);
        // A second upload without overwrite must not clobber the file.
        assert_eq!(upload_file_tool(&args, &cfg).await.unwrap()["isError"], true);
        let args = json!({ "path": path_str, "content": "aGk=", "overwrite": true });
        assert_eq!(upload_file_tool(&args, &cfg).await.unwrap()["isError"], false);

        let result = download_file_tool(&json!({ "path": path_str })).await.unwrap();
        assert_eq!(result["content"][1]["resource"]["blob"], "aGk=");

        let readonly = AppConfig { writable: false, ..Default::default() };
        assert_eq!(upload_file_tool(&args, &readonly).await.unwrap()["isError"], true);
        let marker = root.join("ran");
        let cmd = json!({ "command": format!("touch {}", marker.display()) });
        assert_eq!(bash_tool(&cmd, &readonly).await.unwrap()["isError"], true);
        assert!(!marker.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn host_allowed_blocks_unknown_names_without_auth() {
        let mut cfg = AppConfig { allowed_hosts: vec!["box.lan".into()], ..Default::default() };
        for ok in [None, Some("localhost:7681"), Some("127.0.0.1:7681"), Some("[::1]:7681"), Some("Box.LAN:80")] {
            assert!(host_allowed(&cfg, ok), "{ok:?}");
        }
        for bad in ["attacker.com:7681", "attacker.com", "127.0.0.1.attacker.com"] {
            assert!(!host_allowed(&cfg, Some(bad)), "{bad}");
        }
        cfg.credential = "u:p".into();
        assert!(host_allowed(&cfg, Some("attacker.com")));
    }

    #[tokio::test]
    async fn mutating_tools_require_absolute_paths() {
        let cfg = AppConfig { writable: true, ..Default::default() };
        let args = json!({ "path": "relative.txt", "content": "aGk=" });
        assert!(upload_file_tool(&args, &cfg).await.unwrap_err().contains("absolute"));
        assert!(write_file_tool(&args, &cfg).await.unwrap_err().contains("absolute"));
        assert!(download_file_tool(&args).await.unwrap_err().contains("absolute"));
        assert_eq!(safe_path("/a/./b/../c").unwrap(), std::path::Path::new("/a/c"));
    }

    #[tokio::test]
    async fn failed_overwrite_keeps_the_original_file() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("hterm-up-{}", uuid::Uuid::new_v4()));
        let path = root.join("script.sh");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&path, "original").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let chunk = |b: &'static [u8]| Ok::<_, std::io::Error>(bytes::Bytes::from_static(b));

        // The connection drops mid-transfer.
        let broken = futures::stream::iter([chunk(b"part"), Err(std::io::ErrorKind::ConnectionReset.into())]);
        assert!(write_upload(&path, true, 1024, broken).await.is_err());
        // The body is larger than allowed.
        let oversized = futures::stream::iter([chunk(b"0123456789")]);
        let err = write_upload(&path, true, 4, oversized).await.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::FileTooLarge);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1, "temp files must be cleaned up");

        // A successful overwrite replaces the content and keeps the mode.
        write_upload(&path, true, 1024, futures::stream::iter([chunk(b"new")])).await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o755);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn download_file_tool_rejects_oversized_directory() {
        let root = std::env::temp_dir().join(format!("hterm-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        // Random-ish bytes defeat deflate so the archive really exceeds the cap.
        let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
        let noise: Vec<u8> = (0..MAX_TOOL_TRANSFER + 1024)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                x as u8
            })
            .collect();
        std::fs::write(root.join("big.bin"), noise).unwrap();
        let result = download_file_tool(&json!({ "path": root.to_string_lossy() })).await.unwrap();
        assert_eq!(result["isError"], true);
        std::fs::remove_dir_all(root).unwrap();
    }
}
