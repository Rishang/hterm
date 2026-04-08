use axum::http::HeaderMap;
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use crate::config::AppConfig;
use crate::ws::AppState;

/// Maximum bytes to read from a command's stdout or stderr before truncating.
/// Prevents OOM from commands that produce unbounded output.
const MAX_CMD_OUTPUT: usize = 10 * 1024 * 1024; // 10 MiB

/// Maximum file size that `read_file` will load into memory.
const MAX_READ_FILE: u64 = 50 * 1024 * 1024; // 50 MiB

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
                    "description": "The bash command or script to execute. Supports pipes, redirects, and multiline scripts.",
                    "examples": [
                        "ls -la",
                        "cat package.json | jq .version",
                        "npm install && npm test",
                        "for i in {1..3}; do echo $i; done"
                    ]
                },
                "cwd": {
                    "type": "string",
                    "description": "(Optional) Working directory to run the command in.",
                    "examples": ["/home/user/project", "./src", "/tmp"]
                },
                "timeout": {
                    "type": "integer",
                    "description": "(Optional) Timeout in seconds (1-3600, default 300).",
                    "examples": [60, 300, 600]
                }
            },
            "required": ["command"],
            "examples": [
                {"command": "git status"},
                {"command": "npm test", "cwd": "/home/user/project", "timeout": 120}
            ]
        }
    })
}

fn tool_read_file() -> Value {
    json!({
        "name": "read_file",
        "description": "Read the complete contents of a file as UTF-8 text. Use this to inspect source code, configuration files, logs, or any text-based file. Returns the raw file content.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file.",
                    "examples": ["README.md", "src/main.rs", "/etc/hosts", "package.json"]
                }
            },
            "required": ["path"],
            "examples": [
                {"path": "README.md"},
                {"path": "src/lib.rs"}
            ]
        }
    })
}

fn tool_write_file() -> Value {
    json!({
        "name": "write_file",
        "description": "Create a new file or completely overwrite an existing file with the provided content. Use this for creating new files from scratch. For modifying existing files, prefer 'editFile' instead. Maximum file size: 100MB.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path where the file should be written.",
                    "examples": ["output.txt", "src/new_module.rs", "/tmp/data.json"]
                },
                "content": {
                    "type": "string",
                    "description": "The complete text content to write.",
                    "examples": [
                        "Hello, world!",
                        "{\"key\": \"value\"}",
                        "fn main() {\n    println!(\"Hello!\");\n}"
                    ]
                }
            },
            "required": ["path", "content"],
            "examples": [
                {"path": "test.txt", "content": "Hello, world!"},
                {"path": "config.json", "content": "{\"debug\": true}"}
            ]
        }
    })
}

fn tool_edit_file() -> Value {
    json!({
        "name": "edit_file",
        "description": "Edit an existing file by replacing exact text matches. This is more efficient than rewriting entire files. You must provide the exact 'oldText' string to find (must be unique in the file) and the 'newText' to replace it with. Use 'replaceAll' to change all occurrences. The file must be read first before editing.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to edit.",
                    "examples": ["src/main.rs", "config.yaml", "README.md"]
                },
                "oldText": {
                    "type": "string",
                    "description": "The exact text to find and replace. Must be unique unless replaceAll is true.",
                    "examples": [
                        "const PORT = 3000;",
                        "fn old_function() {",
                        "    println!(\"debug\");"
                    ]
                },
                "newText": {
                    "type": "string",
                    "description": "The text to replace it with.",
                    "examples": [
                        "const PORT = 8080;",
                        "fn new_function() {",
                        "    // removed debug statement"
                    ]
                },
                "replaceAll": {
                    "type": "boolean",
                    "description": "(Optional) Replace all occurrences instead of requiring uniqueness. Defaults to false.",
                    "examples": [false, true]
                }
            },
            "required": ["path", "oldText", "newText"],
            "examples": [
                {
                    "path": "config.js",
                    "oldText": "port: 3000",
                    "newText": "port: 8080"
                },
                {
                    "path": "src/utils.rs",
                    "oldText": "TODO",
                    "newText": "DONE",
                    "replaceAll": true
                }
            ]
        }
    })
}

fn tool_read_file_metadata() -> Value {
    json!({
        "name": "read_file_metadata",
        "description": "Get comprehensive metadata about a file including size, permissions, modification time, and detailed file type detection (via 'file' command). Shows MIME type, encoding, binary format, and other file characteristics. Useful for checking file properties before reading large files or verifying file attributes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file or directory.",
                    "examples": ["package.json", "/var/log/app.log", "src/", "image.png", "binary-file"]
                }
            },
            "required": ["path"],
            "examples": [
                {"path": "README.md"},
                {"path": "/tmp/data.bin"},
                {"path": "hterm"}
            ]
        }
    })
}

fn tool_list_processes() -> Value {
    json!({
        "name": "list_processes",
        "description": "List all running processes on the host system with details like PID, CPU%, MEM%, user, and command. Equivalent to 'ps aux'. Useful for monitoring background jobs, checking if services are running, or debugging resource usage.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "examples": [{}]
        }
    })
}

fn tool_list_files() -> Value {
    json!({
        "name": "list_files",
        "description": "List all files and directories in a given path with detailed information including permissions, ownership, size, and modification time. Equivalent to 'ls -la'. Use this to browse directory contents.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path to list.",
                    "examples": [".", "src/", "/home/user", "/var/log"]
                }
            },
            "required": ["path"],
            "examples": [
                {"path": "."},
                {"path": "src/components"}
            ]
        }
    })
}

fn tool_list_tree() -> Value {
    json!({
        "name": "list_tree",
        "description": "Generate a recursive tree view of files and directories from a root path. Shows the complete directory structure up to a specified depth. Uses 'tree' command if available, otherwise falls back to 'find' with formatting.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Root directory for the tree.",
                    "examples": [".", "src/", "/home/user/project"]
                },
                "maxDepth": {
                    "type": "integer",
                    "description": "(Optional) Maximum depth to traverse (1-20, default 3).",
                    "examples": [2, 3, 5]
                }
            },
            "required": ["path"],
            "examples": [
                {"path": "."},
                {"path": "src", "maxDepth": 2}
            ]
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
                tool_edit_file(),
                tool_read_file_metadata(),
                tool_list_processes(),
                tool_list_files(),
                tool_list_tree()
            ]
        })
    });
    TOOLS.clone()
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

/// Validate tool arguments and provide detailed error messages
fn validate_tool_arguments(tool_name: &str, arguments: &Value) -> Result<(), String> {
    use std::collections::HashMap;

    static TOOL_DEFS: std::sync::LazyLock<HashMap<&'static str, Value>> = std::sync::LazyLock::new(|| {
        HashMap::from([
            ("bash", tool_bash()),
            ("read_file", tool_read_file()),
            ("write_file", tool_write_file()),
            ("edit_file", tool_edit_file()),
            ("read_file_metadata", tool_read_file_metadata()),
            ("list_processes", tool_list_processes()),
            ("list_files", tool_list_files()),
            ("list_tree", tool_list_tree()),
        ])
    });

    let tool_def = match TOOL_DEFS.get(tool_name) {
        Some(def) => def,
        None => return Ok(()),
    };

    let schema = tool_def.get("inputSchema").unwrap();
    let properties = schema.get("properties").and_then(Value::as_object);
    let required_fields = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let examples = schema.get("examples");

    let args_obj = match arguments.as_object() {
        Some(obj) => obj,
        None => {
            return Err(format!(
                "❌ Invalid arguments for tool '{}'.\n\n\
                 Expected: JSON object\n\
                 Received: {}\n\n\
                 Examples:\n{}\n\n\
                 Full schema:\n{}",
                tool_name,
                arguments,
                examples.map(|e| format!("{:#}", e)).unwrap_or_else(|| "N/A".to_string()),
                serde_json::to_string_pretty(schema).unwrap_or_default()
            ));
        }
    };

    // Check for missing required fields
    let mut missing_fields = Vec::new();
    for field in &required_fields {
        if !args_obj.contains_key(*field) {
            missing_fields.push(*field);
        }
    }

    if !missing_fields.is_empty() {
        let field_list = missing_fields.join(", ");
        return Err(format!(
            "❌ Missing required field(s) for tool '{}': {}\n\n\
             Received arguments:\n{}\n\n\
             Examples:\n{}\n\n\
             Full schema:\n{}",
            tool_name,
            field_list,
            serde_json::to_string_pretty(arguments).unwrap_or_default(),
            examples.map(|e| format!("{:#}", e)).unwrap_or_else(|| "N/A".to_string()),
            serde_json::to_string_pretty(schema).unwrap_or_default()
        ));
    }

    // Check for type mismatches
    if let Some(props) = properties {
        for (key, value) in args_obj {
            if let Some(prop_schema) = props.get(key) {
                let expected_type = prop_schema.get("type").and_then(Value::as_str);
                let actual_type = match value {
                    Value::String(_) => "string",
                    Value::Number(_) => "number",
                    Value::Bool(_) => "boolean",
                    Value::Array(_) => "array",
                    Value::Object(_) => "object",
                    Value::Null => "null",
                };

                if let Some(expected) = expected_type {
                    let type_matches = match expected {
                        "string" => value.is_string(),
                        "integer" | "number" => value.is_number(),
                        "boolean" => value.is_boolean(),
                        "array" => value.is_array(),
                        "object" => value.is_object(),
                        _ => true,
                    };

                    if !type_matches {
                        let prop_examples = prop_schema.get("examples");
                        return Err(format!(
                            "❌ Type mismatch for field '{}' in tool '{}'.\n\n\
                             Expected type: {}\n\
                             Actual type: {}\n\
                             Received value: {}\n\n\
                             Valid examples for this field:\n{}\n\n\
                             Complete examples:\n{}\n\n\
                             Full schema:\n{}",
                            key,
                            tool_name,
                            expected,
                            actual_type,
                            value,
                            prop_examples.map(|e| format!("{:#}", e)).unwrap_or_else(|| "N/A".to_string()),
                            examples.map(|e| format!("{:#}", e)).unwrap_or_else(|| "N/A".to_string()),
                            serde_json::to_string_pretty(schema).unwrap_or_default()
                        ));
                    }
                }
            }
        }
    }

    // Check for unexpected fields (warning, not error)
    if let Some(props) = properties {
        let unexpected: Vec<_> = args_obj
            .keys()
            .filter(|k| !props.contains_key(*k))
            .collect();

        if !unexpected.is_empty() {
            tracing::warn!(
                tool = %tool_name,
                fields = ?unexpected,
                "Unexpected fields in tool call (will be ignored)"
            );
        }
    }

    Ok(())
}

/// Call a tool by name with arguments directly (no "arguments" wrapper needed)
pub async fn call_tool(name: &str, arguments: &Value, cfg: &AppConfig) -> Result<Value, String> {
    // Validate arguments before calling the tool
    if let Err(validation_error) = validate_tool_arguments(name, arguments) {
        return Err(validation_error);
    }

    match name {
        "bash" => bash_tool(arguments, cfg).await,
        "read_file" => read_file_tool(arguments).await,
        "write_file" => write_file_tool(arguments, cfg).await,
        "edit_file" => edit_file_tool(arguments, cfg).await,
        "read_file_metadata" => read_file_metadata_tool(arguments).await,
        "list_processes" => list_processes_tool().await,
        "list_files" => list_files_tool(arguments).await,
        "list_tree" => list_tree_tool(arguments, cfg).await,
        other => Err(format!("Unknown tool: {}", other)),
    }
}

// ── Tool implementations ──────────────────────────────────────────────────────

/// Helper to run a command with a timeout and standardized error handling.
async fn run_simple_command_with_timeout(
    mut cmd: tokio::process::Command,
    cmd_name: &str,
    timeout_secs: u64,
) -> Result<Value, String> {
    let timeout = tokio::time::Duration::from_secs(timeout_secs);

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn {}: {}", cmd_name, e))),
    };

    let mut child = child;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    match tokio::time::timeout(timeout, async {
        let (out, err, wait) = tokio::join!(
            read_capped(stdout_pipe, MAX_CMD_OUTPUT),
            read_capped(stderr_pipe, MAX_CMD_OUTPUT),
            child.wait()
        );
        (out, err, wait)
    }).await {
        Ok((out, err, wait)) => {
            let mut text = String::from_utf8_lossy(&out).into_owned();
            let stderr = String::from_utf8_lossy(&err);
            if !stderr.is_empty() {
                if !text.is_empty() { text.push_str("\n--- stderr ---\n"); }
                text.push_str(&stderr);
            }
            if text.is_empty() { text = "(no output)".into(); }
            if wait.map(|s| s.success()).unwrap_or(false) {
                Ok(tool_success(text))
            } else {
                Ok(tool_error(text))
            }
        }
        Err(_) => {
            let _ = child.kill().await;
            Ok(tool_error(format!("{} command timed out after {}s", cmd_name, timeout_secs)))
        }
    }
}

/// Execute bash commands with verbose mode (set -x) enabled.
async fn bash_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    let command = extract_string(args, "command")?;

    let cwd = args
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cfg.cwd.clone());

    let timeout_secs: u64 = args
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(300)
        .clamp(1, 3600);

    let mut cmd = tokio::process::Command::new("bash");
    // Pre-size to avoid reallocation during format
    let mut verbose_command = String::with_capacity(7 + command.len());
    verbose_command.push_str("set -x\n");
    verbose_command.push_str(&command);
    cmd.arg("-c").arg(&verbose_command);
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

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to spawn bash: {}", e))),
    };

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let timeout = tokio::time::Duration::from_secs(timeout_secs);
    let result = tokio::time::timeout(timeout, async {
        let stdout_fut = read_capped(stdout_pipe, MAX_CMD_OUTPUT);
        let stderr_fut = read_capped(stderr_pipe, MAX_CMD_OUTPUT);
        let (stdout_bytes, stderr_bytes, wait_res) =
            tokio::join!(stdout_fut, stderr_fut, child.wait());
        (stdout_bytes, stderr_bytes, wait_res)
    })
    .await;

    let (stdout_bytes, stderr_bytes, wait_res) = match result {
        Ok(t) => t,
        Err(_) => {
            // Kill the child on timeout so it doesn't linger.
            let _ = child.kill().await;
            return Ok(tool_error(format!(
                "Bash command timed out after {}s",
                timeout_secs
            )));
        }
    };

    let stdout_str = String::from_utf8_lossy(&stdout_bytes);
    let stderr_str = String::from_utf8_lossy(&stderr_bytes);
    let status = wait_res.ok();
    let exit_code = status.and_then(|s| s.code()).unwrap_or(-1);

    let mut text = String::new();
    if !stdout_str.is_empty() {
        text.push_str(&stdout_str);
    }
    if stdout_bytes.len() >= MAX_CMD_OUTPUT {
        text.push_str("\n... (stdout truncated at 10 MiB)");
    }
    if !stderr_str.is_empty() {
        if !text.is_empty() {
            text.push_str("\n--- stderr ---\n");
        }
        text.push_str(&stderr_str);
    }
    if stderr_bytes.len() >= MAX_CMD_OUTPUT {
        text.push_str("\n... (stderr truncated at 10 MiB)");
    }
    if text.is_empty() {
        text = "(no output)".into();
    }

    let is_error = !status.map(|s| s.success()).unwrap_or(false);
    tracing::info!(exit_code, "bash tool finished");

    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    }))
}

async fn read_file_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    // Check file size before reading to prevent OOM on huge files.
    match tokio::fs::metadata(&path).await {
        Ok(m) if m.len() > MAX_READ_FILE => {
            return Ok(tool_error(format!(
                "File '{}' is too large ({} bytes, max {} MiB). Use bash tool with head/tail instead.",
                path,
                m.len(),
                MAX_READ_FILE / (1024 * 1024)
            )));
        }
        Err(e) => {
            return Ok(tool_error(format!("Failed to read '{}': {}", path, e)));
        }
        _ => {}
    }

    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(tool_success(content)),
        Err(e) => Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
    }
}

async fn write_file_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    if !cfg.writable {
        return Ok(tool_error(
            "Write operations are disabled (hterm is running in read-only mode). \
             Restart with --writable to enable."
                .into(),
        ));
    }

    let path = extract_string(args, "path")?;
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

/// Edit a file by replacing exact text matches (like Claude Code's Edit tool).
async fn edit_file_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    if !cfg.writable {
        return Ok(tool_error(
            "Edit operations are disabled (hterm is running in read-only mode). \
             Restart with --writable to enable."
                .into(),
        ));
    }

    let path = extract_string(args, "path")?;
    let old_text = extract_string(args, "oldText")?;
    let new_text = extract_string(args, "newText")?;
    let replace_all = args
        .get("replaceAll")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    // Guard against huge files
    if let Ok(m) = tokio::fs::metadata(&path).await {
        if m.len() > MAX_READ_FILE {
            return Ok(tool_error(format!(
                "File '{}' is too large ({} bytes, max {} MiB)",
                path, m.len(), MAX_READ_FILE / (1024 * 1024)
            )));
        }
    }

    // Read the file
    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => return Ok(tool_error(format!("Failed to read '{}': {}", path, e))),
    };

    // Check if old_text exists
    if !content.contains(&old_text) {
        return Ok(tool_error(format!(
            "Text not found in '{}'. Looking for:\n{}",
            path, old_text
        )));
    }

    // Check uniqueness if not replace_all
    if !replace_all {
        let occurrences = content.matches(&old_text).count();
        if occurrences > 1 {
            return Ok(tool_error(format!(
                "Text appears {} times in '{}'. Use replaceAll: true to replace all occurrences, \
                 or provide a unique text match.",
                occurrences, path
            )));
        }
    }

    // Perform replacement
    let new_content = if replace_all {
        content.replace(&old_text, &new_text)
    } else {
        content.replacen(&old_text, &new_text, 1)
    };

    // Write back
    match tokio::fs::write(&path, new_content).await {
        Ok(_) => {
            let msg = if replace_all {
                format!("Successfully replaced all occurrences in '{}'", path)
            } else {
                format!("Successfully edited '{}'", path)
            };
            Ok(tool_success(msg))
        }
        Err(e) => Ok(tool_error(format!("Failed to write '{}': {}", path, e))),
    }
}

async fn read_file_metadata_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;

    let metadata_result = tokio::fs::metadata(&path).await;

    match metadata_result {
        Ok(meta) => {
            let file_type = if meta.is_dir() {
                "directory"
            } else if meta.is_file() {
                "file"
            } else if meta.is_symlink() {
                "symlink"
            } else {
                "other"
            };

            let permissions = if cfg!(unix) {
                format!("{:o}", meta.permissions().mode() & 0o777)
            } else {
                "N/A".to_string()
            };

            let readonly = meta.permissions().readonly();

            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            // Detect detailed file type information
            let file_info = if meta.is_file() {
                detect_file_type(&path).await
            } else {
                "N/A".to_string()
            };

            let info = format!(
                "Path: {}\n\
                 Type: {}\n\
                 Size: {} bytes\n\
                 Permissions: {}\n\
                 Read-only: {}\n\
                 Modified: {} (unix timestamp)\n\
                 File Info: {}",
                path, file_type, meta.len(), permissions, readonly, modified, file_info
            );

            Ok(tool_success(info))
        }
        Err(e) => Ok(tool_error(format!(
            "Failed to read metadata of '{}': {}",
            path, e
        ))),
    }
}

/// Detect file type using magic bytes (via infer crate) and MIME type guessing.
/// Only reads the first 8 KiB of the file to avoid loading large files into memory.
async fn detect_file_type(path: &str) -> String {
    use tokio::io::AsyncReadExt;

    let path_obj = Path::new(path);

    // Get MIME type from extension as fallback
    let mime_from_ext = mime_guess::from_path(path_obj)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let mut details = Vec::new();

    // Read only the first 8 KiB — enough for magic bytes, shebangs, and encoding detection
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => return format!("unable to read file: {}", e),
    };
    let mut sample = vec![0u8; 8192];
    let n = match file.read(&mut sample).await {
        Ok(0) => return "empty file".to_string(),
        Ok(n) => n,
        Err(e) => return format!("unable to read file: {}", e),
    };
    sample.truncate(n);

    // Check for ELF first to add detailed info
    let is_elf = sample.len() >= 18 && sample.starts_with(&[0x7F, b'E', b'L', b'F']);

    // Use infer crate for magic byte detection
    if let Some(kind) = infer::get(&sample) {
        details.push(format!("type: {}", kind.mime_type()));

        // Add ELF-specific details if it's an ELF file
        if is_elf || kind.extension() == "elf" {
            if let Some(elf_info) = parse_elf_details(&sample) {
                details.push(elf_info);
            }
        } else {
            details.push(format!("extension: .{}", kind.extension()));
        }

        // Add human-readable description based on type
        let category = match kind.matcher_type() {
            infer::MatcherType::App => "application",
            infer::MatcherType::Archive => "archive",
            infer::MatcherType::Audio => "audio",
            infer::MatcherType::Book => "ebook",
            infer::MatcherType::Doc => "document",
            infer::MatcherType::Font => "font",
            infer::MatcherType::Image => "image",
            infer::MatcherType::Video => "video",
            infer::MatcherType::Custom => "custom",
            _ => "unknown",
        };
        details.push(format!("category: {}", category));
    } else if is_elf {
        // ELF not detected by infer, parse manually
        details.push("type: application/x-executable".to_string());
        if let Some(elf_info) = parse_elf_details(&sample) {
            details.push(elf_info);
        }
    } else if is_text_content(&sample) {
        // Text file
        details.push("type: text/plain".to_string());

        // Detect encoding from the sample (avoids reading entire file)
        if is_utf8(&sample) {
            details.push("encoding: UTF-8".to_string());
        } else if is_ascii(&sample) {
            details.push("encoding: ASCII".to_string());
        } else {
            details.push("encoding: unknown".to_string());
        }

        // Check for script shebangs
        if let Some(shebang) = detect_shebang(&sample) {
            details.push(format!("script: {}", shebang));
        }
    } else {
        // Unknown binary
        details.push(format!("type: {} (from extension)", mime_from_ext));
        details.push("category: binary (unknown format)".to_string());
    }

    details.join(", ")
}

/// Parse ELF file details (architecture, endianness, type)
fn parse_elf_details(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 18 || !bytes.starts_with(&[0x7F, b'E', b'L', b'F']) {
        return None;
    }

    let class = match bytes.get(4) {
        Some(1) => "32-bit",
        Some(2) => "64-bit",
        _ => "unknown-bit",
    };

    let endian = match bytes.get(5) {
        Some(1) => "LSB",
        Some(2) => "MSB",
        _ => "unknown-endian",
    };

    let os_abi = match bytes.get(7) {
        Some(0) => "SYSV",
        Some(3) => "Linux",
        Some(9) => "FreeBSD",
        Some(2) => "NetBSD",
        _ => "Unix",
    };

    // e_type is at offset 16 (little-endian u16)
    let exec_type = if endian == "LSB" && bytes.len() >= 18 {
        match u16::from_le_bytes([bytes[16], bytes[17]]) {
            1 => "relocatable",
            2 => "executable",
            3 => "shared object",
            4 => "core dump",
            _ => "unknown",
        }
    } else if endian == "MSB" && bytes.len() >= 18 {
        match u16::from_be_bytes([bytes[16], bytes[17]]) {
            1 => "relocatable",
            2 => "executable",
            3 => "shared object",
            4 => "core dump",
            _ => "unknown",
        }
    } else {
        "unknown"
    };

    // e_machine is at offset 18 (little-endian u16)
    let machine = if endian == "LSB" && bytes.len() >= 20 {
        match u16::from_le_bytes([bytes[18], bytes[19]]) {
            0x03 => "x86",
            0x3E => "x86-64",
            0x28 => "ARM",
            0xB7 => "AArch64",
            0xF3 => "RISC-V",
            _ => "",
        }
    } else if endian == "MSB" && bytes.len() >= 20 {
        match u16::from_be_bytes([bytes[18], bytes[19]]) {
            0x03 => "x86",
            0x3E => "x86-64",
            0x28 => "ARM",
            0xB7 => "AArch64",
            0xF3 => "RISC-V",
            _ => "",
        }
    } else {
        ""
    };

    let mut parts = vec![class, endian];
    if !machine.is_empty() {
        parts.push(machine);
    }
    parts.push(exec_type);
    parts.push(os_abi);

    Some(parts.join(" "))
}

/// Detect script type from shebang line
fn detect_shebang(bytes: &[u8]) -> Option<String> {
    if !bytes.starts_with(b"#!") {
        return None;
    }

    let first_line = bytes.iter()
        .take_while(|&&b| b != b'\n')
        .copied()
        .collect::<Vec<u8>>();

    let shebang = String::from_utf8_lossy(&first_line);

    if shebang.contains("bash") {
        Some("bash".to_string())
    } else if shebang.contains("sh") {
        Some("shell".to_string())
    } else if shebang.contains("python") {
        Some("python".to_string())
    } else if shebang.contains("node") {
        Some("node.js".to_string())
    } else if shebang.contains("ruby") {
        Some("ruby".to_string())
    } else if shebang.contains("perl") {
        Some("perl".to_string())
    } else {
        Some(shebang.trim().to_string())
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
    let printable_count = bytes[..check_len].iter().filter(|&&b| {
        b.is_ascii_graphic() || b.is_ascii_whitespace()
    }).count();

    // If >85% printable, consider it text
    (printable_count as f64 / check_len as f64) > 0.85
}

/// Check if content is valid UTF-8
fn is_utf8(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok()
}

/// Check if content is pure ASCII
fn is_ascii(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| b.is_ascii())
}

async fn list_processes_tool() -> Result<Value, String> {
    let mut cmd = tokio::process::Command::new("ps");
    cmd.arg("aux");
    run_simple_command_with_timeout(cmd, "ps", 10).await
}

async fn list_files_tool(args: &Value) -> Result<Value, String> {
    let path = extract_string(args, "path")?;
    let mut cmd = tokio::process::Command::new("ls");
    cmd.arg("-la").arg(&path);
    run_simple_command_with_timeout(cmd, "ls", 10).await
}

async fn list_tree_tool(args: &Value, cfg: &AppConfig) -> Result<Value, String> {
    let path = extract_string(args, "path")?;
    let max_depth = args
        .get("maxDepth")
        .and_then(Value::as_u64)
        .unwrap_or(3)
        .clamp(1, 20);

    let tree_cmd = format!(
        "tree -L {depth} -- {path} 2>/dev/null || \
         find {path} -maxdepth {depth} | sort | \
         awk -F/ '{{indent=\"\"; for(i=NF-1;i>0;i--) indent=indent\"  \"; print indent $NF}}'",
        depth = max_depth,
        path = shell_escape(&path),
    );

    let mut cmd = tokio::process::Command::new(&cfg.shell);
    cmd.arg("-c").arg(&tree_cmd);
    run_simple_command_with_timeout(cmd, "tree/find", 10).await
}


// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing required argument: {}", key))
        .map(String::from)
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

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Read from an async reader up to `max` bytes, then discard the rest.
/// Returns the capped buffer.  Used to prevent OOM from unbounded command output.
pub(crate) async fn read_capped<R: tokio::io::AsyncRead + Unpin>(
    reader: Option<R>,
    max: usize,
) -> Vec<u8> {
    use tokio::io::AsyncReadExt;

    let mut reader = match reader {
        Some(r) => r,
        None => return Vec::new(),
    };
    let mut buf = Vec::with_capacity(max.min(64 * 1024)); // start small
    let mut total = 0usize;
    let mut tmp = [0u8; 8192];
    loop {
        match reader.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => {
                let remaining = max.saturating_sub(total);
                let take = n.min(remaining);
                if take > 0 {
                    buf.extend_from_slice(&tmp[..take]);
                }
                total += n;
                if total >= max {
                    // Keep draining to avoid SIGPIPE killing the child, but
                    // don't store anything beyond the cap.
                    tokio::io::copy(&mut reader, &mut tokio::io::sink()).await.ok();
                    break;
                }
            }
            Err(_) => break,
        }
    }
    buf
}
