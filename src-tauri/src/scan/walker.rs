use std::fs::{self, DirEntry, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::error::{warning_code_from_io, warning_message_from_io, AppError};
use crate::filter::file_matches_extensions;
use crate::model::{
    FsNode, ScanConfig, ScanProgress, ScanResult, ScanStats, ScanStatus, ScanWarning, WarningCode,
};

use super::hidden::is_hidden;

const PROGRESS_MIN_INTERVAL_MS: u128 = 100;
const PROGRESS_EVERY_N_ENTRIES: u64 = 250;

struct WalkContext<'a, F> {
    config: &'a ScanConfig,
    cancel: &'a AtomicBool,
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

    fn note_skip(&mut self, path: &Path, code: WarningCode, message: impl Into<String>) {
        self.stats.skipped_count += 1;
        self.processed += 1;
        self.warnings.push(ScanWarning {
            path: path_to_string(path),
            code,
            message: message.into(),
        });
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
            processed_count: self.processed,
            current_path: path_to_string(path),
            status,
        });
        self.last_emit = Instant::now();
    }
}

pub fn run<F>(config: ScanConfig, cancel: &AtomicBool, on_progress: F) -> Result<ScanResult, AppError>
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
    if depth < ctx.config.max_depth {
        match fs::read_dir(path) {
            Ok(entries) => {
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
                            ctx.note_io_skip(path, &err);
                            ctx.emit(path, ScanStatus::Running, false);
                        }
                    }
                }
            }
            Err(err) => {
                ctx.note_io_skip(path, &err);
                ctx.emit(path, ScanStatus::Running, false);
            }
        }
    }

    super::sort::sort_children(&mut children);

    Some(FsNode::Directory {
        id: path_to_string(path),
        name: node_name(path),
        path: path_to_string(path),
        depth,
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

    if file_type.is_symlink() {
        ctx.note_skip(
            &path,
            WarningCode::Skipped,
            "Symbolische Verknüpfung wird nicht gefolgt.",
        );
        ctx.emit(&path, ScanStatus::Running, false);
        return None;
    }

    let metadata = if need_full_metadata(ctx.config, file_type.is_file()) {
        match entry.metadata() {
            Ok(metadata) => Some(metadata),
            Err(err) => {
                ctx.note_io_skip(&path, &err);
                ctx.emit(&path, ScanStatus::Running, false);
                return None;
            }
        }
    } else {
        None
    };

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

fn need_full_metadata(config: &ScanConfig, is_file: bool) -> bool {
    if config.exclude_hidden && (cfg!(windows) || cfg!(target_os = "macos")) {
        return true;
    }
    if config.include_created_at || config.include_modified_at {
        return true;
    }
    is_file && config.include_size
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
            system_time_to_ms(meta.created().ok())
        } else {
            None
        },
        modified_at_ms: if config.include_modified_at {
            system_time_to_ms(meta.modified().ok())
        } else {
            None
        },
    }
}

fn system_time_to_ms(time: Option<SystemTime>) -> Option<u64> {
    time.and_then(|value| {
        value
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_millis() as u64)
    })
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
            "dateiliste-walk-{}-{}",
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
        let result = run(config, &cancel, |_| {}).expect("scan");
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
}
