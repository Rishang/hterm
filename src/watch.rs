//! Filesystem change notifications for the file explorer — native watchers over SSE.
//!
//! The browser opens one persistent stream at GET `/api/files/watch` and POSTs
//! the set of directories its tree currently has expanded. The OS wakes the
//! session task only when one of those directories actually changes (inotify on
//! Linux, FSEvents on macOS), so an idle session costs no CPU, no syscalls, and
//! no polling traffic. This is why the explorer notices `rm`/`mv`/`touch` typed
//! in a terminal tab without the UI ever asking "did anything change?".
//!
//! Watches are **non-recursive and demand-driven**: only the expanded
//! directories are watched. A recursive watch on a project root would cost
//! thousands of kernel watch descriptors for `node_modules`/`target` and report
//! churn nobody is looking at. `MAX_WATCHES` bounds the set regardless.
//!
//! One watcher multiplexes every watch for a session, so the per-session cost is
//! a single watcher plus one watch per visible directory.

use axum::{
    extract::{Query, State},
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, MethodRouter},
    Json,
};
use futures::stream::Stream;
use notify::{event::AccessKind, event::AccessMode, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::sync::mpsc;
use tokio::time::{sleep_until, Duration, Instant};
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::tools;
use crate::ws::AppState;

/// Upper bound on watches per session. Deep trees stop adding watches here
/// rather than exhausting the OS limit (`fs.inotify.max_user_watches` on Linux).
const MAX_WATCHES: usize = 512;
const MAX_SESSIONS: usize = 32;

/// Events inside one burst (an editor save, `git checkout`, a build) are
/// coalesced into a single SSE message. The deadline is set once per burst, not
/// extended per event, so sustained write activity still reports on schedule.
const DEBOUNCE: Duration = Duration::from_millis(150);

/// Filenames whose churn would wake the UI without changing what it shows.
///
/// Editors and VCS tools rewrite these constantly; a `git status` or a Vim save
/// would otherwise re-list a directory several times. Tune this list to change
/// how chatty the explorer is.
fn is_noise(name: &str) -> bool {
    name.ends_with('~')
        || name.ends_with(".swp")
        || name.ends_with(".swx")
        || name.ends_with(".tmp")
        || name.starts_with(".#")
        || name.starts_with("4913") // Vim's atomic-write probe file
}

/// What the watcher callback hands to the session task.
enum Change {
    /// Paths touched by one filesystem event.
    Paths(Vec<PathBuf>),
    /// The backend dropped events; every watched directory must be re-listed.
    Rescan,
}

/// The watch set for one session: a native watcher plus the bookkeeping needed
/// to map an event path back to the directory string the UI asked about.
struct Watches {
    watcher: RecommendedWatcher,
    by_path: HashMap<String, Vec<PathBuf>>,
    /// Every spelling of a watched directory (as given and canonical — FSEvents
    /// reports canonical paths, e.g. `/private/var` for `/var`) → the UI's string.
    lookup: HashMap<PathBuf, String>,
}

impl Watches {
    fn new() -> notify::Result<(Self, mpsc::UnboundedReceiver<Change>)> {
        let (tx, rx) = mpsc::unbounded_channel();
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let change = match res {
                Ok(ev) if ev.need_rescan() => Change::Rescan,
                Ok(ev) if is_relevant(&ev.kind) => Change::Paths(ev.paths),
                Ok(_) => return,
                Err(_) => Change::Rescan,
            };
            let _ = tx.send(change);
        })?;
        Ok((
            Self { watcher, by_path: HashMap::new(), lookup: HashMap::new() },
            rx,
        ))
    }

    /// Make the watch set exactly `desired`, adding and removing the difference.
    ///
    /// Re-watching an unchanged directory would churn descriptors on every
    /// folder toggle, so only the delta is applied.
    fn sync(&mut self, desired: &[String]) {
        let wanted: HashSet<&str> = desired.iter().map(String::as_str).collect();

        let stale: Vec<String> = self
            .by_path
            .keys()
            .filter(|path| !wanted.contains(path.as_str()))
            .cloned()
            .collect();
        for path in stale {
            self.remove(&path);
        }

        for path in desired {
            if self.by_path.contains_key(path) || self.by_path.len() >= MAX_WATCHES {
                continue;
            }
            let raw = PathBuf::from(path);
            if !raw.is_dir() {
                continue;
            }
            match self.watcher.watch(&raw, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    let mut keys = vec![raw.clone()];
                    if let Ok(canon) = raw.canonicalize() {
                        if canon != raw {
                            keys.push(canon);
                        }
                    }
                    for key in &keys {
                        self.lookup.insert(key.clone(), path.clone());
                    }
                    self.by_path.insert(path.clone(), keys);
                }
                // A directory can vanish between the UI listing it and this call.
                Err(e) => tracing::debug!(path = %path, error = %e, "watch failed"),
            }
        }

        if desired.len() > MAX_WATCHES {
            tracing::warn!(
                requested = desired.len(),
                cap = MAX_WATCHES,
                "watch cap reached; deeper directories will not report changes"
            );
        }
    }

    fn remove(&mut self, path: &str) {
        let Some(keys) = self.by_path.remove(path) else {
            return;
        };
        let _ = self.watcher.unwatch(Path::new(path));
        for key in keys {
            self.lookup.remove(&key);
        }
    }

    /// Directories (UI spelling) affected by an event on `path`: the directory
    /// itself (deleted/moved) or the directory containing it.
    fn resolve(&self, path: &Path, changed: &mut HashSet<String>) {
        if path.file_name().and_then(|n| n.to_str()).is_some_and(is_noise) {
            return;
        }
        if let Some(dir) = self.lookup.get(path) {
            changed.insert(dir.clone());
        }
        if let Some(dir) = path.parent().and_then(|p| self.lookup.get(p)) {
            changed.insert(dir.clone());
        }
    }
}

/// Directory-level mutations the explorer tree can actually render.
///
/// Plain reads are excluded; of the access events only a finished write counts,
/// which is what Linux reports once per save instead of per `write(2)`.
fn is_relevant(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) => true,
        EventKind::Any | EventKind::Other => true,
    }
}

/// Owns the watcher for one SSE session.
///
/// Exits when `dirs_rx` closes — the session's sender lives in
/// `AppState::watch_sessions` and is removed by [`WatchStream::drop`], so a
/// client disconnect tears the watcher down and releases its watches.
async fn run_session(
    mut watches: Watches,
    mut changes_rx: mpsc::UnboundedReceiver<Change>,
    mut dirs_rx: mpsc::Receiver<Vec<String>>,
    events_tx: mpsc::Sender<Event>,
) {
    let mut pending: HashSet<String> = HashSet::new();
    let mut deadline: Option<Instant> = None;

    loop {
        tokio::select! {
            desired = dirs_rx.recv() => {
                match desired {
                    Some(desired) => watches.sync(&desired),
                    None => break,
                }
            }
            change = changes_rx.recv() => {
                let Some(change) = change else { break };
                let mut changed = HashSet::new();
                match change {
                    Change::Rescan => changed.extend(watches.by_path.keys().cloned()),
                    Change::Paths(paths) => {
                        for path in &paths {
                            watches.resolve(path, &mut changed);
                        }
                    }
                }
                if !changed.is_empty() {
                    // Set the deadline once per burst so continuous writes cannot
                    // postpone delivery indefinitely.
                    if pending.is_empty() {
                        deadline = Some(Instant::now() + DEBOUNCE);
                    }
                    pending.extend(changed);
                }
            }
            () = sleep_until(deadline.unwrap_or_else(Instant::now)), if deadline.is_some() => {
                deadline = None;
                let dirs: Vec<String> = pending.drain().collect();
                let payload = serde_json::json!({ "dirs": dirs }).to_string();
                if events_tx.send(Event::default().event("change").data(payload)).await.is_err() {
                    break;
                }
            }
        }
    }
}

// ── SSE session lifecycle ─────────────────────────────────────────────────────

/// Removes the session's command channel when the SSE connection is dropped.
/// Closing that channel is what stops [`run_session`] and frees its watches.
struct WatchStream {
    inner: ReceiverStream<Event>,
    session_id: String,
    state: Arc<AppState>,
}

impl Stream for WatchStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.inner).poll_next(cx).map(|opt| opt.map(Ok))
    }
}

impl Drop for WatchStream {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.watch_sessions.write() {
            map.remove(&self.session_id);
        }
        tracing::debug!(session_id = %self.session_id, "file watch session removed");
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WatchSessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Deserialize)]
struct WatchDirsRequest {
    /// Absolute directory paths the client wants change events for. Replaces the
    /// session's previous set rather than adding to it.
    paths: Vec<String>,
}

/// `GET /api/files/watch` — open the change stream.
///
/// Emits an `endpoint` event with the URL to POST the watched-directory set to,
/// mirroring the MCP SSE handshake, then `change` events carrying
/// `{ "dirs": [...] }`.
async fn watch_sse_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, axum::http::StatusCode> {
    if !tools::check_auth(&state, &headers) {
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }

    let (watches, changes_rx) = match Watches::new() {
        Ok(pair) => pair,
        Err(e) => {
            tracing::warn!(error = %e, "file watcher unavailable; file watching disabled");
            return Err(axum::http::StatusCode::SERVICE_UNAVAILABLE);
        }
    };

    let session_id = Uuid::new_v4().to_string();
    // Bounded channels cap memory if the browser stalls; a dropped `change`
    // event only delays a re-list, and the next event supersedes it.
    let (events_tx, events_rx) = mpsc::channel(16);
    let (dirs_tx, dirs_rx) = mpsc::channel(4);

    let mut sessions = state.watch_sessions.write().unwrap_or_else(|e| e.into_inner());
    if sessions.len() >= MAX_SESSIONS {
        return Err(axum::http::StatusCode::SERVICE_UNAVAILABLE);
    }
    sessions.insert(session_id.clone(), dirs_tx);
    drop(sessions);

    let endpoint = format!(
        "{}/api/files/watch?sessionId={}",
        state.config.base_path, session_id
    );
    let _ = events_tx.try_send(Event::default().event("endpoint").data(&endpoint));

    tokio::spawn(run_session(watches, changes_rx, dirs_rx, events_tx));
    tracing::debug!(session_id = %session_id, "file watch session opened");

    Ok(Sse::new(WatchStream {
        inner: ReceiverStream::new(events_rx),
        session_id,
        state: Arc::clone(&state),
    })
    .keep_alive(axum::response::sse::KeepAlive::new().text("ping")))
}

/// `POST /api/files/watch?sessionId=…` — declare the directories to watch.
async fn watch_dirs_handler(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Query(query): Query<WatchSessionQuery>,
    Json(req): Json<WatchDirsRequest>,
) -> impl IntoResponse {
    if !tools::check_auth(&state, &headers) {
        return axum::http::StatusCode::UNAUTHORIZED;
    }

    let sender = state
        .watch_sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&query.session_id)
        .cloned();

    let Some(sender) = sender else {
        return axum::http::StatusCode::NOT_FOUND;
    };
    // Only absolute paths are watchable, matching the rest of the files API.
    let paths: Vec<String> = req
        .paths
        .into_iter()
        .filter(|p| p.starts_with('/'))
        .collect();

    match sender.send(paths).await {
        Ok(_) => axum::http::StatusCode::NO_CONTENT,
        Err(_) => axum::http::StatusCode::GONE,
    }
}

pub fn routes() -> MethodRouter<Arc<AppState>> {
    get(watch_sse_handler).post(watch_dirs_handler)
}
