use crate::errors::Failure;
use crate::exec::Control;
use crate::frame::{EVENT, Frame};
use crate::output::Output;
use crate::sys;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata};
use std::hash::Hasher;
use std::io;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime};

const DEBOUNCE: Duration = Duration::from_millis(50);
const FSEVENTS_SETTLE: Duration = Duration::from_millis(500);
const DEFAULT_POLL_MS: u64 = 2000;
const DEFAULT_MAX_DIRECTORIES: usize = 10_000;
const HASH_MAX_BYTES: u64 = 256 * 1024;
const HASH_RECENT: Duration = Duration::from_secs(5);
const CANCEL_POLL: Duration = Duration::from_millis(100);

#[cfg(any(target_os = "linux", target_os = "android"))]
const UNRELIABLE_FILE_SYSTEMS: [u64; 12] = [
    0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0x65735546, 0x01021997, 0x0bd00bd0, 0x47504653,
    0x00c36400, 0x5346414f, 0x6b414653, 0x5dca2df5,
];

struct Target {
    path: String,
    recursive: bool,
    hidden: bool,
    names: HashSet<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, PartialEq, Eq)]
struct Entry {
    kind: Kind,
    dev: u64,
    ino: u64,
    size: u64,
    mtime: (i64, i64),
    hash: Option<u64>,
}

type Snapshot = HashMap<String, Entry>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Native,
    Polling,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Native => "native",
            Mode::Polling => "polling",
        }
    }
}

enum ScanError {
    Budget(usize),
    Io(io::Error, &'static str, String),
}

impl ScanError {
    fn failure(&self) -> Failure {
        match self {
            ScanError::Budget(max) => {
                Failure::new("EINVAL", format!("Watched paths exceed {max} directories"))
            }
            ScanError::Io(error, syscall, path) => Failure::io(error, syscall, path),
        }
    }

    fn code(&self) -> &'static str {
        match self {
            ScanError::Io(error, ..) if denied(error) => "permission_denied",
            _ => "invalid",
        }
    }
}

fn denied(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::PermissionDenied
}

fn kind_of(metadata: &Metadata) -> Kind {
    let file_type = metadata.file_type();
    if file_type.is_file() {
        Kind::File
    } else if file_type.is_dir() {
        Kind::Directory
    } else if file_type.is_symlink() {
        Kind::Symlink
    } else {
        Kind::Other
    }
}

fn entry_of(path: &str, metadata: &Metadata, follow: bool, hash: Option<u64>) -> Entry {
    let kind = kind_of(metadata);
    let (dev, ino) = sys::path_identity(path, metadata, follow);
    let directory = kind == Kind::Directory;
    Entry {
        kind,
        dev,
        ino,
        size: if directory { 0 } else { metadata.len() },
        mtime: if directory {
            (0, 0)
        } else {
            sys::mtime(metadata)
        },
        hash,
    }
}

fn ancestors(path: &str) -> Vec<String> {
    Path::new(path)
        .ancestors()
        .skip(1)
        .map(|ancestor| ancestor.to_string_lossy().into_owned())
        .collect()
}

fn with_separator(directory: &str) -> String {
    if directory.ends_with(sys::PATH_SEPARATOR) {
        directory.to_string()
    } else {
        format!("{directory}{}", sys::PATH_SEPARATOR)
    }
}

fn is_within(path: &str, ancestor: &str) -> bool {
    path == ancestor || path.starts_with(&with_separator(ancestor))
}

fn excluded(target: &Target, name: &str) -> bool {
    (target.hidden && name.starts_with('.')) || target.names.contains(name)
}

fn sort_like_javascript(paths: &mut [String]) {
    paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn any_unreliable(targets: &[Target]) -> bool {
    use std::ffi::CString;
    for target in targets {
        for candidate in std::iter::once(target.path.clone()).chain(ancestors(&target.path)) {
            let Ok(name) = CString::new(candidate) else {
                break;
            };
            let mut info: libc::statfs = unsafe { std::mem::zeroed() };
            if unsafe { libc::statfs(name.as_ptr(), &mut info) } != 0 {
                continue;
            }
            #[allow(clippy::unnecessary_cast)]
            let kind = (info.f_type as u64) & 0xffff_ffff;
            if UNRELIABLE_FILE_SYSTEMS.contains(&kind) {
                return true;
            }
            break;
        }
    }
    false
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn any_unreliable(_targets: &[Target]) -> bool {
    false
}

struct Scan {
    snapshot: Snapshot,
    linked_files: HashSet<String>,
    counted: HashSet<String>,
    traversed: HashSet<(usize, String)>,
    listed: HashMap<String, Kind>,
}

struct Installed {
    dev: u64,
    ino: u64,
    canonical: Option<String>,
}

struct FileWatcher<'a> {
    id: u32,
    output: &'a Output,
    control: &'a Control,
    targets: Vec<Target>,
    mode: Mode,
    poll_interval: Duration,
    max_directories: usize,
    snapshot: Snapshot,
    native: Option<RecommendedWatcher>,
    events_sender: Sender<notify::Result<Event>>,
    installed: HashMap<String, Installed>,
    events: HashSet<String>,
    settle_at: Option<Instant>,
}

impl FileWatcher<'_> {
    fn send(&self, json: Value) {
        self.output.control(Frame::new(EVENT, self.id, json));
    }

    fn cancelled(&self) -> bool {
        self.control.aborted.load(Ordering::SeqCst)
    }

    fn record(&self, scan: &mut Scan, path: &str, metadata: &Metadata, follow: bool) {
        let mut hash = None;
        let recent = metadata
            .modified()
            .map(|modified| {
                SystemTime::now()
                    .duration_since(modified)
                    .map_or(true, |age| age < HASH_RECENT)
            })
            .unwrap_or(false);
        if self.mode == Mode::Polling
            && metadata.is_file()
            && metadata.len() <= HASH_MAX_BYTES
            && recent
        {
            hash = fs::read(path).ok().map(|content| {
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                hasher.write(&content);
                hasher.finish()
            });
        }
        scan.snapshot
            .insert(path.to_string(), entry_of(path, metadata, follow, hash));
    }

    fn count(&self, scan: &mut Scan, path: &str) -> Result<(), ScanError> {
        scan.counted.insert(path.to_string());
        if scan.counted.len() > self.max_directories {
            return Err(ScanError::Budget(self.max_directories));
        }
        Ok(())
    }

    fn scan_directory(
        &self,
        scan: &mut Scan,
        index: usize,
        directory: &str,
    ) -> Result<(), ScanError> {
        let target = &self.targets[index];
        if !scan.traversed.insert((index, directory.to_string())) {
            return Ok(());
        }
        let skip = |error: io::Error| -> Result<(), ScanError> {
            if directory == target.path && denied(&error) {
                return Err(ScanError::Io(error, "scandir", directory.to_string()));
            }
            match error.kind() {
                io::ErrorKind::NotFound
                | io::ErrorKind::PermissionDenied
                | io::ErrorKind::NotADirectory => Ok(()),
                _ => Err(ScanError::Io(error, "scandir", directory.to_string())),
            }
        };
        let mut names = Vec::new();
        match fs::read_dir(directory) {
            Err(error) => return skip(error),
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => names.push(entry.file_name().to_string_lossy().into_owned()),
                        Err(error) => return skip(error),
                    }
                }
            }
        }
        let prefix = with_separator(directory);
        for name in names {
            if excluded(target, &name) {
                continue;
            }
            let path = format!("{prefix}{name}");
            let kind = match scan.listed.get(&path) {
                Some(kind) => *kind,
                None => {
                    let Ok(metadata) = fs::symlink_metadata(&path) else {
                        continue;
                    };
                    let kind = kind_of(&metadata);
                    scan.listed.insert(path.clone(), kind);
                    if !scan.snapshot.contains_key(&path) {
                        self.record(scan, &path, &metadata, false);
                    }
                    kind
                }
            };
            if target.recursive && kind == Kind::Directory {
                self.count(scan, &path)?;
                self.scan_directory(scan, index, &path)?;
            }
        }
        Ok(())
    }

    fn scan(&self) -> Result<Scan, ScanError> {
        let mut scan = Scan {
            snapshot: Snapshot::new(),
            linked_files: HashSet::new(),
            counted: HashSet::new(),
            traversed: HashSet::new(),
            listed: HashMap::new(),
        };
        for (index, target) in self.targets.iter().enumerate() {
            for ancestor in ancestors(&target.path) {
                if scan.snapshot.contains_key(&ancestor) {
                    continue;
                }
                if let Ok(metadata) = fs::symlink_metadata(&ancestor) {
                    let entry = Entry {
                        size: 0,
                        mtime: (0, 0),
                        ..entry_of(&ancestor, &metadata, false, None)
                    };
                    scan.snapshot.insert(ancestor, entry);
                }
            }
            let metadata = match fs::metadata(&target.path) {
                Ok(metadata) => metadata,
                Err(error) if denied(&error) => {
                    return Err(ScanError::Io(error, "stat", target.path.clone()));
                }
                Err(_) => continue,
            };
            self.record(&mut scan, &target.path, &metadata, true);
            if metadata.is_file()
                && fs::symlink_metadata(&target.path)
                    .is_ok_and(|link| link.file_type().is_symlink())
            {
                scan.linked_files.insert(target.path.clone());
            }
            if metadata.is_dir() {
                self.count(&mut scan, &target.path)?;
                self.scan_directory(&mut scan, index, &target.path)?;
            }
        }
        Ok(scan)
    }

    fn reported(&self, path: &str) -> String {
        if self
            .targets
            .iter()
            .any(|target| is_within(path, &target.path))
        {
            return path.to_string();
        }
        self.targets
            .iter()
            .find(|target| is_within(&target.path, path))
            .map_or_else(|| path.to_string(), |target| target.path.clone())
    }

    fn diff(&self, previous: &Snapshot, next: &Snapshot) -> Vec<String> {
        let mut changed = Vec::new();
        for (path, entry) in next {
            if previous.get(path) != Some(entry) {
                changed.push(self.reported(path));
            }
        }
        for path in previous.keys() {
            if !next.contains_key(path) {
                changed.push(self.reported(path));
            }
        }
        changed
    }

    fn sync(&mut self, mut report: bool) -> Result<HashSet<String>, ScanError> {
        let mut changed = HashSet::new();
        for _ in 0..10 {
            if self.cancelled() {
                break;
            }
            let scan = self.scan()?;
            if report {
                changed.extend(self.diff(&self.snapshot, &scan.snapshot));
            }
            self.snapshot = scan.snapshot;
            if self.mode == Mode::Polling || !self.reconcile(&scan.linked_files) {
                break;
            }
            if cfg!(target_os = "macos") {
                self.settle_at = Some(Instant::now() + FSEVENTS_SETTLE);
            }
            report = true;
        }
        Ok(changed)
    }

    fn reconcile(&mut self, linked_files: &HashSet<String>) -> bool {
        let per_directory = cfg!(any(target_os = "linux", target_os = "android"));
        let mut wanted: HashMap<String, bool> = linked_files
            .iter()
            .map(|path| (path.clone(), false))
            .collect();
        for target in &self.targets {
            for ancestor in ancestors(&target.path) {
                if self
                    .snapshot
                    .get(&ancestor)
                    .is_some_and(|entry| entry.kind == Kind::Directory)
                {
                    wanted.entry(ancestor).or_insert(false);
                }
            }
            if self
                .snapshot
                .get(&target.path)
                .is_none_or(|entry| entry.kind != Kind::Directory)
            {
                continue;
            }
            wanted.insert(target.path.clone(), target.recursive && !per_directory);
            if target.recursive && per_directory {
                for (path, entry) in &self.snapshot {
                    if entry.kind == Kind::Directory
                        && *path != target.path
                        && is_within(path, &target.path)
                    {
                        wanted.insert(path.clone(), false);
                    }
                }
            }
        }
        let stale: Vec<String> = self
            .installed
            .iter()
            .filter(|(path, installed)| {
                !wanted.contains_key(*path)
                    || self.snapshot.get(*path).is_none_or(|entry| {
                        entry.dev != installed.dev || entry.ino != installed.ino
                    })
            })
            .map(|(path, _)| path.clone())
            .collect();
        for path in stale {
            self.installed.remove(&path);
            if let Some(native) = &mut self.native {
                let _ = native.unwatch(Path::new(&path));
            }
        }
        let mut added = false;
        for (path, recursive) in wanted {
            let Some(entry) = self.snapshot.get(&path) else {
                continue;
            };
            if self.installed.contains_key(&path) {
                continue;
            }
            let (dev, ino) = (entry.dev, entry.ino);
            if self.native.is_none() {
                let sender = self.events_sender.clone();
                match RecommendedWatcher::new(
                    move |event| drop(sender.send(event)),
                    notify::Config::default(),
                ) {
                    Ok(native) => self.native = Some(native),
                    Err(_) => {
                        self.switch_to_polling();
                        return false;
                    }
                }
            }
            let mode = if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            match self.native.as_mut().unwrap().watch(Path::new(&path), mode) {
                Ok(()) => {
                    let canonical = fs::canonicalize(&path)
                        .ok()
                        .map(|canonical| canonical.to_string_lossy().into_owned())
                        .filter(|canonical| *canonical != path);
                    self.installed.insert(
                        path,
                        Installed {
                            dev,
                            ino,
                            canonical,
                        },
                    );
                    added = true;
                }
                Err(error) => {
                    let gone = match &error.kind {
                        notify::ErrorKind::PathNotFound => true,
                        notify::ErrorKind::Io(io) => {
                            matches!(
                                io.kind(),
                                io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
                            )
                        }
                        _ => false,
                    };
                    if !gone {
                        self.switch_to_polling();
                        return false;
                    }
                }
            }
        }
        added
    }

    fn switch_to_polling(&mut self) {
        if self.mode == Mode::Polling {
            return;
        }
        self.mode = Mode::Polling;
        self.native = None;
        self.installed.clear();
        self.send(json!({ "kind": "change", "overflow": true, "mode": "polling" }));
    }

    fn in_scope(&self, path: &str) -> bool {
        for target in &self.targets {
            if is_within(&target.path, path) {
                return true;
            }
            if !is_within(path, &target.path) || path == target.path {
                continue;
            }
            let relative = &path[with_separator(&target.path).len()..];
            let components: Vec<&str> = relative.split(sys::PATH_SEPARATOR).collect();
            if !target.recursive && components.len() > 1 {
                continue;
            }
            if components.iter().any(|name| excluded(target, name)) {
                continue;
            }
            return true;
        }
        false
    }

    fn watched_spelling(&self, path: &str) -> String {
        let mut best: Option<(&str, &str)> = None;
        for (watched, installed) in &self.installed {
            if let Some(canonical) = &installed.canonical
                && is_within(path, canonical)
                && best.is_none_or(|(_, longest)| canonical.len() > longest.len())
            {
                best = Some((watched, canonical));
            }
        }
        match best {
            Some((watched, canonical)) => format!("{watched}{}", &path[canonical.len()..]),
            None => path.to_string(),
        }
    }

    fn on_event(&mut self, event: notify::Result<Event>) -> bool {
        let event = match event {
            Ok(event) => event,
            Err(error) => {
                for path in &error.paths {
                    self.installed.remove(&*path.to_string_lossy());
                }
                return true;
            }
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return false;
        }
        if event.need_rescan() || event.paths.is_empty() {
            return true;
        }
        let mut flush = false;
        for path in &event.paths {
            let path = self.watched_spelling(&path.to_string_lossy());
            if self.in_scope(&path) {
                let reported = self.reported(&path);
                self.events.insert(reported);
                flush = true;
            }
        }
        flush
    }

    fn flush(&mut self) -> bool {
        let events = std::mem::take(&mut self.events);
        match self.sync(true) {
            Ok(mut changed) => {
                changed.extend(events);
                if !changed.is_empty() && !self.cancelled() {
                    let mut paths: Vec<String> = changed.into_iter().collect();
                    sort_like_javascript(&mut paths);
                    self.send(json!({ "kind": "change", "paths": paths }));
                }
                true
            }
            Err(error) => {
                let message = error.failure().message;
                self.send(json!({ "kind": "error", "code": error.code(), "message": message }));
                false
            }
        }
    }
}

fn parse_targets(json: &Value) -> Result<Vec<Target>, Failure> {
    let invalid = || Failure::new("EINVAL", "watch needs targets");
    json["targets"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .map(|target| {
            Ok(Target {
                path: target["path"].as_str().ok_or_else(invalid)?.to_string(),
                recursive: target["recursive"].as_bool().unwrap_or(false),
                hidden: target["exclude"]["hidden"].as_bool().unwrap_or(false),
                names: target["exclude"]["names"]
                    .as_array()
                    .map(|names| {
                        names
                            .iter()
                            .filter_map(|name| name.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub fn run(id: u32, json: &Value, output: &Output, control: &Control) -> Result<Value, Failure> {
    let targets = parse_targets(json)?;
    let mode = match json["mode"].as_str() {
        Some("native") => Mode::Native,
        Some("polling") => Mode::Polling,
        _ if cfg!(windows) || any_unreliable(&targets) => Mode::Polling,
        _ => Mode::Native,
    };
    let (events_sender, events) = mpsc::channel();
    let mut watcher = FileWatcher {
        id,
        output,
        control,
        targets,
        mode,
        poll_interval: Duration::from_millis(
            json["pollIntervalMs"].as_u64().unwrap_or(DEFAULT_POLL_MS),
        ),
        max_directories: json["maxDirectories"]
            .as_u64()
            .map_or(DEFAULT_MAX_DIRECTORIES, |max| max as usize),
        snapshot: Snapshot::new(),
        native: None,
        events_sender,
        installed: HashMap::new(),
        events: HashSet::new(),
        settle_at: None,
    };
    watcher.sync(false).map_err(|error| error.failure())?;
    watcher.send(json!({ "kind": "ready", "mode": watcher.mode.name() }));
    let mut flush_at: Option<Instant> = None;
    let mut poll_at = Instant::now() + watcher.poll_interval;
    loop {
        if watcher.cancelled() {
            return Ok(json!({}));
        }
        let now = Instant::now();
        let mut wake = now + CANCEL_POLL;
        for at in [flush_at, watcher.settle_at].into_iter().flatten() {
            wake = wake.min(at);
        }
        if watcher.mode == Mode::Polling {
            wake = wake.min(poll_at);
        }
        match events.recv_timeout(wake.saturating_duration_since(now)) {
            Ok(event) => {
                if watcher.on_event(event) && flush_at.is_none() && watcher.mode == Mode::Native {
                    flush_at = Some(Instant::now() + DEBOUNCE);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => unreachable!("the watcher holds a sender"),
        }
        let now = Instant::now();
        let due = |at: Option<Instant>| at.is_some_and(|at| at <= now);
        let polling_due = watcher.mode == Mode::Polling && poll_at <= now;
        if due(flush_at) || due(watcher.settle_at) || polling_due {
            if due(flush_at) {
                flush_at = None;
            }
            if due(watcher.settle_at) {
                watcher.settle_at = None;
            }
            if !watcher.flush() {
                return Ok(json!({}));
            }
            if polling_due {
                poll_at = Instant::now() + watcher.poll_interval;
            }
        }
    }
}
