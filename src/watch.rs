//! Filesystem change notifications for the file explorer — inotify over SSE.
//!
//! The browser opens one persistent stream at GET `/api/files/watch` and POSTs
//! the set of directories its tree currently has expanded. The kernel wakes the
//! session task only when one of those directories actually changes, so an idle
//! session costs no CPU, no syscalls, and no polling traffic. This is why the
//! explorer notices `rm`/`mv`/`touch` typed in a terminal tab without the UI
//! ever asking "did anything change?".
//!
//! Watches are **non-recursive and demand-driven**: only the expanded
//! directories are watched. A recursive watch on a project root would cost
//! thousands of kernel watch descriptors for `node_modules`/`target` and report
//! churn nobody is looking at. `MAX_WATCHES` bounds the set regardless.
//!
//! One inotify instance multiplexes every watch for a session, so the per-session
//! cost is a single file descriptor plus one kernel watch per visible directory.

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
use nix::errno::Errno;
use nix::sys::inotify::{AddWatchFlags, InitFlags, Inotify, WatchDescriptor};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::os::fd::{AsFd, AsRawFd, RawFd};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::unix::AsyncFd;
use tokio::sync::mpsc;
use tokio::time::{sleep_until, Duration, Instant};
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::tools;
use crate::ws::AppState;

/// Upper bound on kernel watch descriptors per session. Deep trees stop adding
/// watches here rather than exhausting `fs.inotify.max_user_watches`.
const MAX_WATCHES: usize = 512;
const MAX_SESSIONS: usize = 32;

/// Events inside one burst (an editor save, `git checkout`, a build) are
/// coalesced into a single SSE message. The deadline is set once per burst, not
/// extended per event, so sustained write activity still reports on schedule.
const DEBOUNCE: Duration = Duration::from_millis(150);

/// Directory-level mutations the explorer tree can actually render.
///
/// `IN_MODIFY` is deliberately excluded: it fires repeatedly while a file is
/// being written, whereas `IN_CLOSE_WRITE` fires once when the writer is done.
/// `IN_ONLYDIR` makes a watch on a non-directory an error instead of a surprise.
const WATCH_FLAGS: AddWatchFlags = AddWatchFlags::IN_CREATE
    .union(AddWatchFlags::IN_DELETE)
    .union(AddWatchFlags::IN_MOVED_FROM)
    .union(AddWatchFlags::IN_MOVED_TO)
    .union(AddWatchFlags::IN_DELETE_SELF)
    .union(AddWatchFlags::IN_MOVE_SELF)
    .union(AddWatchFlags::IN_CLOSE_WRITE)
    .union(AddWatchFlags::IN_ATTRIB)
    .union(AddWatchFlags::IN_ONLYDIR);

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

/// `AsyncFd` needs `AsRawFd`; nix's `Inotify` only exposes `AsFd`. This newtype
/// bridges the two and keeps ownership of the fd, so dropping the session task
/// closes the instance and the kernel releases every watch it held.
struct WatchFd(Inotify);

impl AsRawFd for WatchFd {
    fn as_raw_fd(&self) -> RawFd {
        self.0.as_fd().as_raw_fd()
    }
}

/// The watch set for one session: an inotify instance plus the descriptor
/// bookkeeping needed to map an event back to the directory the UI asked about.
struct Watches {
    fd: AsyncFd<WatchFd>,
    by_path: HashMap<String, WatchDescriptor>,
    by_wd: HashMap<WatchDescriptor, HashSet<String>>,
}

impl Watches {
    fn new() -> Result<Self, Errno> {
        // IN_NONBLOCK is required: AsyncFd must never block the runtime thread.
        let inotify = Inotify::init(InitFlags::IN_NONBLOCK | InitFlags::IN_CLOEXEC)?;
        let fd = AsyncFd::new(WatchFd(inotify)).map_err(|_| Errno::EINVAL)?;
        Ok(Self {
            fd,
            by_path: HashMap::new(),
            by_wd: HashMap::new(),
        })
    }

    /// Make the watch set exactly `desired`, adding and removing the difference.
    ///
    /// Re-watching an unchanged directory would churn kernel descriptors on every
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
            match self.fd.get_ref().0.add_watch(path.as_str(), WATCH_FLAGS) {
                Ok(wd) => {
                    self.by_path.insert(path.clone(), wd);
                    self.by_wd.entry(wd).or_default().insert(path.clone());
                }
                // A directory can vanish between the UI listing it and this call.
                Err(e) => tracing::debug!(path = %path, error = %e, "inotify watch failed"),
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
        let Some(wd) = self.by_path.remove(path) else {
            return;
        };
        let remove_watch = match self.by_wd.get_mut(&wd) {
            Some(paths) => {
                paths.remove(path);
                paths.is_empty()
            }
            None => true,
        };
        if remove_watch {
            self.by_wd.remove(&wd);
            let _ = self.fd.get_ref().0.rm_watch(wd);
        }
    }
}

/// Drain every queued event, returning the directories that changed.
///
/// Reads until `EAGAIN` before clearing readiness — leaving events queued would
/// make `AsyncFd` report ready again immediately and spin the task.
///
/// Takes the watch set's fields separately rather than `&mut Watches`: the ready
/// guard already borrows `Watches::fd`, so the descriptor maps must be borrowed
/// as disjoint fields.
fn drain_events(
    inotify: &Inotify,
    by_wd: &mut HashMap<WatchDescriptor, HashSet<String>>,
    by_path: &mut HashMap<String, WatchDescriptor>,
    guard: &mut tokio::io::unix::AsyncFdReadyGuard<'_, WatchFd>,
) -> HashSet<String> {
    let mut changed = HashSet::new();
    loop {
        match inotify.read_events() {
            Ok(events) => {
                for ev in events {
                    if ev.mask.contains(AddWatchFlags::IN_Q_OVERFLOW) {
                        tracing::warn!("inotify queue overflowed; refreshing watched directories");
                        changed.extend(by_path.keys().cloned());
                        continue;
                    }
                    // The kernel dropped this watch; forget it so `sync` can re-add it.
                    if ev.mask.contains(AddWatchFlags::IN_IGNORED) {
                        if let Some(paths) = by_wd.remove(&ev.wd) {
                            for path in paths {
                                by_path.remove(&path);
                            }
                        }
                        continue;
                    }
                    let name_is_noise = ev
                        .name
                        .as_ref()
                        .and_then(|n| n.to_str())
                        .is_some_and(is_noise);
                    if name_is_noise {
                        continue;
                    }
                    if let Some(paths) = by_wd.get(&ev.wd) {
                        changed.extend(paths.iter().cloned());
                    }
                }
            }
            Err(Errno::EAGAIN) => {
                guard.clear_ready();
                break;
            }
            Err(e) => {
                tracing::warn!(error = %e, "inotify read failed");
                guard.clear_ready();
                break;
            }
        }
    }
    changed
}

/// Owns the inotify instance for one SSE session.
///
/// Exits when `dirs_rx` closes — the session's sender lives in
/// `AppState::watch_sessions` and is removed by [`WatchStream::drop`], so a
/// client disconnect tears the watcher down and releases its kernel watches.
async fn run_session(mut watches: Watches, mut dirs_rx: mpsc::Receiver<Vec<String>>, events_tx: mpsc::Sender<Event>) {
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
            ready = watches.fd.readable() => {
                let Ok(mut guard) = ready else { break };
                let changed = drain_events(
                    &watches.fd.get_ref().0,
                    &mut watches.by_wd,
                    &mut watches.by_path,
                    &mut guard,
                );
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

    let watches = match Watches::new() {
        Ok(watches) => watches,
        Err(e) => {
            tracing::warn!(error = %e, "inotify unavailable; file watching disabled");
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

    tokio::spawn(run_session(watches, dirs_rx, events_tx));
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
