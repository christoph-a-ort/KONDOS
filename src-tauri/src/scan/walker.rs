use std::fs::{self, DirEntry, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::error::{
    warning_code_from_io, warning_code_from_metadata_io, warning_message_from_io, AppError,
};
use crate::filter::file_matches_extensions;
use crate::model::{
    DirectoryListing, FsNode, ScanConfig, ScanProgress, ScanResult, ScanStats, ScanStatus,
    ScanWarning, WarningCode,
};

use super::hidden::is_hidden;
use super::reparse::{must_not_follow, refuse_unverified_windows_directory};

const PROGRESS_MIN_INTERVAL_MS: u128 = 100;
const PROGRESS_EVERY_N_ENTRIES: u64 = 250;
const LINK_SKIP_MESSAGE: &str = "Dateisystemverweis wird nicht gefolgt.";

struct WalkContext<'a, F> {
    config: &'a ScanConfig,
    cancel: &'a AtomicBool,
    scan_id: u64,
    warnings: Vec<ScanWarning>,
    stats: ScanStats,
    processed: u64,
    last_emit: Instant,
    on_progress: &'a F,
}

impl<'a, F> WalkContext<'a, F>
where
    F: Fn(ScanProgress),
{
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn note_warning(&mut self, path: &Path, code: WarningCode, message: impl Into<String>) {
        self.warnings.push(ScanWarning {
            path: path_to_string(path),
            code,
            message: message.into(),
        });
    }

    fn note_skip(&mut self, path: &Path, code: WarningCode, message: impl Into<String>) {
        self.stats.skipped_count += 1;
        self.processed += 1;
        self.note_warning(path, code, message);
    }

    fn note_io_skip(&mut self, path: &Path, err: &std::io::Error) {
        self.note_skip(path, warning_code_from_io(err), warning_message_from_io(err));
    }

    fn emit(&mut self, path: &Path, status: ScanStatus, force: bool) {
        let elapsed = self.last_emit.elapsed().as_millis();
        if !force
            && elapsed < PROGRESS_MIN_INTERVAL_MS
            && self.processed % PROGRESS_EVERY_N_ENTRIES != 0
        {
            return;
        }
        (self.on_progress)(ScanProgress {
            scan_id: self.scan_id,
            processed_count: self.processed,
            current_path: path_to_string(path),
            status,
        });
        self.last_emit = Instant::now();
    }
}

pub fn run<F>(
    config: ScanConfig,
    cancel: &AtomicBool,
    scan_id: u64,
    on_progress: F,
) -> Result<ScanResult, AppError>
where
    F: Fn(ScanProgress),
{
    let started = Instant::now();
    let root_path = PathBuf::from(&config.root_path);

    if !root_path.exists() {
        return Err(AppError::invalid_path(
            "Das Startverzeichnis existiert nicht.",
        ));
    }

    let root_meta = match fs::metadata(&root_path) {
        Ok(meta) => meta,
        Err(_) => return Err(AppError::root_inaccessible()),
    };

    if !root_meta.is_dir() {
        return Err(AppError::invalid_path(
            "Bitte wählen Sie ein Verzeichnis, keine Datei.",
        ));
    }

    let mut ctx = WalkContext {
        config: &config,
        cancel,
        scan_id,
        warnings: Vec::new(),
        stats: ScanStats::default(),
        processed: 0,
        last_emit: Instant::now(),
        on_progress: &on_progress,
    };

    ctx.emit(&root_path, ScanStatus::Running, true);

    let root = match walk_directory(&root_path, 0, Some(root_meta), &mut ctx) {
        Some(node) => node,
        None if ctx.cancelled() => {
            ctx.emit(&root_path, ScanStatus::Cancelled, true);
            return Err(AppError::cancelled());
        }
        None => {
            ctx.emit(&root_path, ScanStatus::Failed, true);
            return Err(AppError::root_inaccessible());
        }
    };

    if ctx.cancelled() {
        ctx.emit(&root_path, ScanStatus::Cancelled, true);
        return Err(AppError::cancelled());
    }

    ctx.stats.duration_ms = started.elapsed().as_millis() as u64;
    ctx.emit(&root_path, ScanStatus::Completed, true);

    Ok(ScanResult {
        root,
        warnings: ctx.warnings,
        stats: ctx.stats,
    })
}

fn walk_directory<F>(
    path: &Path,
    depth: u8,
    known_meta: Option<Metadata>,
    ctx: &mut WalkContext<'_, F>,
) -> Option<FsNode>
where
    F: Fn(ScanProgress),
{
    if ctx.cancelled() {
        return None;
    }

    let extra = optional_node_times_and_size(known_meta.as_ref(), ctx.config);
    ctx.stats.directory_count += 1;
    ctx.processed += 1;
    ctx.emit(path, ScanStatus::Running, false);

    let mut children = Vec::new();
    let listing = if depth < ctx.config.max_depth {
        match fs::read_dir(path) {
            Ok(entries) => {
                let mut listing = DirectoryListing::Read;
                for entry in entries {
                    if ctx.cancelled() {
                        break;
                    }
                    match entry {
                        Ok(dir_entry) => {
                            if let Some(child) = walk_dir_entry(dir_entry, depth + 1, ctx) {
                                children.push(child);
                            }
                        }
                        Err(err) => {
                            listing = DirectoryListing::Incomplete;
                            ctx.note_io_skip(path, &err);
                            ctx.emit(path, ScanStatus::Running, false);
                        }
                    }
                }
                listing
            }
            Err(err) => {
                ctx.note_io_skip(path, &err);
                ctx.emit(path, ScanStatus::Running, false);
                DirectoryListing::Incomplete
            }
        }
    } else {
        DirectoryListing::DepthLimited
    };

    super::sort::sort_children(&mut children);

    Some(FsNode::Directory {
        id: path_to_string(path),
        name: node_name(path),
        path: path_to_string(path),
        depth,
        listing,
        children,
        size_bytes: None,
        created_at_ms: extra.created_at_ms,
        modified_at_ms: extra.modified_at_ms,
    })
}

fn walk_dir_entry<F>(
    entry: DirEntry,
    depth: u8,
    ctx: &mut WalkContext<'_, F>,
) -> Option<FsNode>
where
    F: Fn(ScanProgress),
{
    if ctx.cancelled() {
        return None;
    }

    let path = entry.path();
    let file_type = match entry.file_type() {
        Ok(file_type) => file_type,
        Err(err) => {
            ctx.note_io_skip(&path, &err);
            ctx.emit(&path, ScanStatus::Running, false);
            return None;
        }
    };

    let metadata = match entry.metadata() {
        Ok(metadata) => Some(metadata),
        Err(err) => {
            ctx.note_warning(
                &path,
                warning_code_from_metadata_io(&err),
                "Metadaten konnten nicht gelesen werden.",
            );
            None
        }
    };

    if must_not_follow(file_type, metadata.as_ref()) {
        let is_file = metadata
            .as_ref()
            .map(Metadata::is_file)
            .unwrap_or_else(|| file_type.is_file());
        return link_leaf(&path, depth, !is_file, metadata, ctx);
    }

    if refuse_unverified_windows_directory(file_type, metadata.as_ref()) {
        return Some(directory_leaf(&path, depth, None, ctx));
    }

    if ctx.config.exclude_hidden && is_hidden(&path, metadata.as_ref()) {
        ctx.processed += 1;
        ctx.emit(&path, ScanStatus::Running, false);
        return None;
    }

    if file_type.is_dir() {
        return walk_directory(&path, depth, metadata, ctx);
    }

    if file_type.is_file() {
        return walk_file(&path, depth, metadata, ctx);
    }

    ctx.note_skip(
        &path,
        WarningCode::Skipped,
        "Nicht unterstützter Dateisystemeintrag.",
    );
    ctx.emit(&path, ScanStatus::Running, false);
    None
}

fn link_leaf<F>(
    path: &Path,
    depth: u8,
    is_directory: bool,
    metadata: Option<Metadata>,
    ctx: &mut WalkContext<'_, F>,
) -> Option<FsNode>
where
    F: Fn(ScanProgress),
{
    ctx.stats.skipped_count += 1;
    ctx.note_warning(path, WarningCode::Skipped, LINK_SKIP_MESSAGE);

    if is_directory {
        if ctx.config.exclude_hidden && is_hidden(path, metadata.as_ref()) {
            ctx.processed += 1;
            ctx.emit(path, ScanStatus::Running, false);
            return None;
        }
        return Some(directory_leaf(path, depth, metadata, ctx));
    }

    walk_file(path, depth, metadata, ctx)
}

fn directory_leaf<F>(
    path: &Path,
    depth: u8,
    metadata: Option<Metadata>,
    ctx: &mut WalkContext<'_, F>,
) -> FsNode
where
    F: Fn(ScanProgress),
{
    let extra = optional_node_times_and_size(metadata.as_ref(), ctx.config);
    ctx.stats.directory_count += 1;
    ctx.processed += 1;
    ctx.emit(path, ScanStatus::Running, false);
    FsNode::Directory {
        id: path_to_string(path),
        name: node_name(path),
        path: path_to_string(path),
        depth,
        listing: DirectoryListing::Read,
        children: Vec::new(),
        size_bytes: None,
        created_at_ms: extra.created_at_ms,
        modified_at_ms: extra.modified_at_ms,
    }
}

fn walk_file<F>(
    path: &Path,
    depth: u8,
    metadata: Option<Metadata>,
    ctx: &mut WalkContext<'_, F>,
) -> Option<FsNode>
where
    F: Fn(ScanProgress),
{
    let name = node_name(path);
    if !file_matches_extensions(&name, &ctx.config.extensions) {
        ctx.processed += 1;
        ctx.emit(path, ScanStatus::Running, false);
        return None;
    }

    let extra = optional_node_times_and_size(metadata.as_ref(), ctx.config);
    ctx.stats.file_count += 1;
    ctx.processed += 1;
    ctx.emit(path, ScanStatus::Running, false);

    Some(FsNode::File {
        id: path_to_string(path),
        name,
        path: path_to_string(path),
        depth,
        size_bytes: extra.size_bytes,
        created_at_ms: extra.created_at_ms,
        modified_at_ms: extra.modified_at_ms,
    })
}

struct OptionalMeta {
    size_bytes: Option<u64>,
    created_at_ms: Option<u64>,
    modified_at_ms: Option<u64>,
}

fn optional_node_times_and_size(metadata: Option<&Metadata>, config: &ScanConfig) -> OptionalMeta {
    let Some(meta) = metadata else {
        return OptionalMeta {
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        };
    };

    OptionalMeta {
        size_bytes: config.include_size.then_some(meta.len()),
        created_at_ms: if config.include_created_at {
            created_at_ms(meta)
        } else {
            None
        },
        modified_at_ms: if config.include_modified_at {
            meta.modified().ok().and_then(system_time_to_ms)
        } else {
            None
        },
    }
}

fn created_at_ms(metadata: &Metadata) -> Option<u64> {
    if let Ok(time) = metadata.created() {
        if let Some(ms) = system_time_to_ms(time) {
            return Some(ms);
        }
    }
    windows_created_at_ms(metadata)
}

#[cfg(windows)]
fn windows_created_at_ms(metadata: &Metadata) -> Option<u64> {
    use std::os::windows::fs::MetadataExt;
    windows_filetime_to_unix_ms(metadata.creation_time())
}

#[cfg(not(windows))]
fn windows_created_at_ms(_metadata: &Metadata) -> Option<u64> {
    None
}

/// Windows FILETIME: 100-Nanosekunden-Intervalle seit 1601-01-01 UTC.
/// Unix-Epoche als FILETIME: 116_444_736_000_000_000.
fn windows_filetime_to_unix_ms(filetime: u64) -> Option<u64> {
    const FILETIME_UNIX_EPOCH: u64 = 116_444_736_000_000_000;
    const HUNDRED_NS_PER_MS: u64 = 10_000;
    if filetime == 0 || filetime < FILETIME_UNIX_EPOCH {
        return None;
    }
    Some((filetime - FILETIME_UNIX_EPOCH) / HUNDRED_NS_PER_MS)
}

fn system_time_to_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn node_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_to_string(path))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ScanConfig;
    use std::fs;

    #[test]
    fn respects_depth_extension_filter_and_skips_dotfiles() {
        let root = std::env::temp_dir().join(format!(
            "kondos-walk-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(root.join("a").join("b")).expect("dirs");
        fs::write(root.join("a").join("keep.pdf"), b"pdf").expect("pdf");
        fs::write(root.join("a").join("skip.png"), b"png").expect("png");
        fs::write(root.join("a").join("b").join("deep.pdf"), b"deep").expect("deep");
        fs::write(root.join(".hidden.txt"), b"hid").expect("hidden");

        let config = ScanConfig {
            root_path: path_to_string(&root),
            max_depth: 2,
            exclude_hidden: true,
            extensions: vec![".pdf".into()],
            include_size: true,
            include_created_at: false,
            include_modified_at: false,
        };

        let cancel = AtomicBool::new(false);
        let result = run(config, &cancel, 1, |_| {}).expect("scan");
        let _ = fs::remove_dir_all(&root);

        assert_eq!(result.stats.directory_count, 3);
        assert_eq!(result.stats.file_count, 1);
        match result.root {
            FsNode::Directory { children, .. } => {
                let names: Vec<&str> = children
                    .iter()
                    .map(|child| match child {
                        FsNode::Directory { name, .. } | FsNode::File { name, .. } => name.as_str(),
                    })
                    .collect();
                assert_eq!(names, vec!["a"]);
                match &children[0] {
                    FsNode::Directory { children: inner, .. } => {
                        let inner_names: Vec<&str> = inner
                            .iter()
                            .map(|child| match child {
                                FsNode::Directory { name, .. } | FsNode::File { name, .. } => {
                                    name.as_str()
                                }
                            })
                            .collect();
                        assert!(inner_names.contains(&"keep.pdf"));
                        assert!(inner_names.contains(&"b"));
                        assert!(!inner_names.contains(&"skip.png"));
                        assert!(!inner_names.contains(&"deep.pdf"));
                        let pdf = inner.iter().find(|child| matches!(child, FsNode::File { name, .. } if name == "keep.pdf"));
                        match pdf {
                            Some(FsNode::File { size_bytes, .. }) => {
                                assert_eq!(*size_bytes, Some(3));
                            }
                            _ => panic!("expected keep.pdf with size"),
                        }
                    }
                    FsNode::File { .. } => panic!("expected directory a"),
                }
            }
            FsNode::File { .. } => panic!("root must be a directory"),
        }
    }

    #[test]
    fn windows_filetime_unix_epoch_is_zero_ms() {
        assert_eq!(
            windows_filetime_to_unix_ms(116_444_736_000_000_000),
            Some(0)
        );
    }

    #[test]
    fn windows_filetime_known_2020_01_01_utc() {
        // 2020-01-01T00:00:00Z = 1_577_836_800_000 ms since Unix epoch.
        const UNIX_MS: u64 = 1_577_836_800_000;
        const FILETIME: u64 = 132_223_104_000_000_000;
        assert_eq!(windows_filetime_to_unix_ms(FILETIME), Some(UNIX_MS));
    }

    #[test]
    fn windows_filetime_rejects_invalid_and_pre_epoch() {
        assert_eq!(windows_filetime_to_unix_ms(0), None);
        assert_eq!(windows_filetime_to_unix_ms(1), None);
        assert_eq!(windows_filetime_to_unix_ms(116_444_735_999_999_999), None);
        assert_eq!(
            windows_filetime_to_unix_ms(u64::MAX),
            Some((u64::MAX - 116_444_736_000_000_000) / 10_000)
        );
    }
}
