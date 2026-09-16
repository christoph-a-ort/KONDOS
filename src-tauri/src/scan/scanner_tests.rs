use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppErrorKind;
use crate::model::{
    FsNode, ScanConfig, ScanProgress, ScanResult, ScanStatus, WarningCode, DEFAULT_DEPTH,
};
use crate::scan::run;

struct TempTree {
    root: PathBuf,
}

impl TempTree {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "kondos-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temp root");
        Self { root }
    }

    fn mkdir(&self, rel: &str) {
        fs::create_dir_all(self.root.join(rel)).expect("mkdir");
    }

    fn write_file(&self, rel: &str, contents: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, contents).expect("write");
    }

    fn base_config(&self) -> ScanConfig {
        ScanConfig {
            root_path: self.root.to_string_lossy().into_owned(),
            max_depth: DEFAULT_DEPTH,
            exclude_hidden: false,
            extensions: vec![],
            include_size: false,
            include_created_at: false,
            include_modified_at: false,
        }
    }

    fn scan(&self, adjust: impl FnOnce(&mut ScanConfig)) -> ScanResult {
        let mut config = self.base_config();
        adjust(&mut config);
        run(config, &AtomicBool::new(false), 1, |_| {}).expect("scan")
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FlatNode {
    kind: &'static str,
    name: String,
    depth: u8,
}

fn flatten(node: &FsNode) -> Vec<FlatNode> {
    let mut out = Vec::new();
    flatten_into(node, &mut out);
    out
}

fn flatten_into(node: &FsNode, out: &mut Vec<FlatNode>) {
    match node {
        FsNode::Directory {
            name,
            depth,
            children,
            ..
        } => {
            out.push(FlatNode {
                kind: "directory",
                name: name.clone(),
                depth: *depth,
            });
            for child in children {
                flatten_into(child, out);
            }
        }
        FsNode::File { name, depth, .. } => {
            out.push(FlatNode {
                kind: "file",
                name: name.clone(),
                depth: *depth,
            });
        }
    }
}

fn as_dir(node: &FsNode) -> &Vec<FsNode> {
    match node {
        FsNode::Directory { children, .. } => children,
        FsNode::File { .. } => panic!("expected directory"),
    }
}

fn json_of(node: &FsNode) -> serde_json::Value {
    serde_json::to_value(node).expect("json")
}

fn assert_no_optional_meta(node: &FsNode) {
    let value = json_of(node);
    assert!(value.get("sizeBytes").is_none());
    assert!(value.get("createdAtMs").is_none());
    assert!(value.get("modifiedAtMs").is_none());
    if let Some(children) = value.get("children").and_then(|item| item.as_array()) {
        for child in children {
            assert!(child.get("sizeBytes").is_none());
            assert!(child.get("createdAtMs").is_none());
            assert!(child.get("modifiedAtMs").is_none());
        }
    }
}

/// S.01–S.03, S.40
#[test]
fn root_is_depth_zero_and_empty_root_has_no_children() {
    let tree = TempTree::new("empty-root");
    let result = tree.scan(|_| {});
    match &result.root {
        FsNode::Directory {
            depth, children, ..
        } => {
            assert_eq!(*depth, 0);
            assert!(children.is_empty());
        }
        FsNode::File { .. } => panic!("root must be a directory"),
    }
    assert_eq!(result.stats.directory_count, 1);
    assert_eq!(result.stats.file_count, 0);
}

/// S.03, S.06, S.08, S.42
#[test]
fn depth_one_captures_only_level_one() {
    let tree = TempTree::new("depth-one");
    tree.write_file("a.txt", b"a");
    tree.write_file("nested/b.txt", b"b");
    tree.mkdir("empty");
    let result = tree.scan(|config| config.max_depth = 1);
    let nodes = flatten(&result.root);
    assert!(nodes.iter().any(|n| n.name == "a.txt" && n.depth == 1 && n.kind == "file"));
    assert!(nodes.iter().any(|n| n.name == "empty" && n.depth == 1 && n.kind == "directory"));
    assert!(nodes.iter().any(|n| n.name == "nested" && n.depth == 1 && n.kind == "directory"));
    assert!(!nodes.iter().any(|n| n.name == "b.txt"));
    assert_eq!(nodes.iter().map(|n| n.depth).max(), Some(1));
}

/// S.07, S.08, S.09
#[test]
fn depth_eight_includes_level_eight_but_not_nine() {
    let tree = TempTree::new("depth-eight");
    tree.write_file("l1.txt", b"1");
    tree.write_file("d1/d2/d3/l4.txt", b"4");
    tree.mkdir("d1/d2/d3/d4/d5/d6/d7/d8");
    tree.write_file("d1/d2/d3/d4/d5/d6/d7/l8.txt", b"8");
    tree.write_file("d1/d2/d3/d4/d5/d6/d7/d8/l9.txt", b"9");
    let result = tree.scan(|config| config.max_depth = 8);
    let nodes = flatten(&result.root);
    assert!(nodes.iter().any(|n| n.name == "l1.txt" && n.depth == 1 && n.kind == "file"));
    assert!(nodes.iter().any(|n| n.name == "l4.txt" && n.depth == 4 && n.kind == "file"));
    assert!(nodes.iter().any(|n| n.name == "l8.txt" && n.depth == 8 && n.kind == "file"));
    assert!(nodes.iter().any(|n| n.name == "d8" && n.depth == 8 && n.kind == "directory"));
    assert!(!nodes.iter().any(|n| n.name == "l9.txt"));
    assert_eq!(nodes.iter().map(|n| n.depth).max(), Some(8));
}

/// S.10, S.11
#[test]
fn files_are_leaf_nodes_without_children_field() {
    let tree = TempTree::new("file-leaf");
    tree.write_file("note.txt", b"n");
    let result = tree.scan(|_| {});
    match &as_dir(&result.root)[0] {
        FsNode::File { .. } => {}
        FsNode::Directory { .. } => panic!("expected file"),
    }
    let json = json_of(&as_dir(&result.root)[0]);
    assert_eq!(json["kind"], "file");
    assert!(json.get("children").is_none());
}

/// S.12, S.13, S.41, S.43
#[test]
fn folders_are_traversed_including_empty_and_mixed_siblings() {
    let tree = TempTree::new("mixed");
    tree.mkdir("empty");
    tree.mkdir("only-dirs/inner");
    tree.write_file("mixed/file.txt", b"x");
    tree.mkdir("mixed/sub");
    let result = tree.scan(|_| {});
    let nodes = flatten(&result.root);
    assert!(nodes.iter().any(|n| n.name == "empty" && n.kind == "directory"));
    assert!(nodes.iter().any(|n| n.name == "inner" && n.kind == "directory"));
    assert!(nodes.iter().any(|n| n.name == "file.txt" && n.kind == "file"));
    assert!(nodes.iter().any(|n| n.name == "sub" && n.kind == "directory"));
    let mixed_children = as_dir(&result.root)
        .iter()
        .find(|node| matches!(node, FsNode::Directory { name, .. } if name == "mixed"))
        .map(as_dir)
        .expect("mixed");
    assert!(mixed_children
        .iter()
        .any(|node| matches!(node, FsNode::File { name, .. } if name == "file.txt")));
    assert!(mixed_children
        .iter()
        .any(|node| matches!(node, FsNode::Directory { name, .. } if name == "sub")));
}

/// S.16, S.17, S.18
#[test]
fn hidden_dot_files_and_folders_can_be_excluded() {
    let tree = TempTree::new("dotfiles");
    tree.write_file("visible.txt", b"v");
    tree.write_file(".secret.txt", b"s");
    tree.write_file(".hidden_dir/inside.txt", b"i");
    let excluded = tree.scan(|config| config.exclude_hidden = true);
    let excluded_names: Vec<String> = flatten(&excluded.root).into_iter().map(|n| n.name).collect();
    assert!(excluded_names.contains(&"visible.txt".to_string()));
    assert!(!excluded_names.iter().any(|n| n.starts_with('.')));

    let included = tree.scan(|config| config.exclude_hidden = false);
    let included_names: Vec<String> = flatten(&included.root).into_iter().map(|n| n.name).collect();
    assert!(included_names.contains(&".secret.txt".to_string()));
    assert!(included_names.contains(&".hidden_dir".to_string()));
    assert!(included_names.contains(&"inside.txt".to_string()));
}

/// S.19
#[cfg(windows)]
#[test]
fn windows_hidden_attribute_is_excluded() {
    let tree = TempTree::new("win-hidden");
    tree.write_file("visible.txt", b"v");
    tree.write_file("attr_hidden.txt", b"h");
    tree.mkdir("attr_hidden_dir");
    tree.write_file("attr_hidden_dir/inside.txt", b"i");
    set_hidden_attribute(&tree.root.join("attr_hidden.txt"));
    set_hidden_attribute(&tree.root.join("attr_hidden_dir"));

    let result = tree.scan(|config| config.exclude_hidden = true);
    let names: Vec<String> = flatten(&result.root).into_iter().map(|n| n.name).collect();
    assert!(names.contains(&"visible.txt".to_string()));
    assert!(!names.contains(&"attr_hidden.txt".to_string()));
    assert!(!names.contains(&"attr_hidden_dir".to_string()));
    assert!(!names.contains(&"inside.txt".to_string()));
}

#[cfg(windows)]
fn set_hidden_attribute(path: &Path) {
    let status = std::process::Command::new("attrib")
        .arg("+H")
        .arg(path)
        .status()
        .expect("attrib");
    assert!(status.success(), "attrib +H failed for {}", path.display());
}

/// S.21, S.22, S.23, S.25, S.26, S.27
#[test]
fn extension_filter_keeps_folders_and_nested_matches() {
    let tree = TempTree::new("ext-filter");
    tree.write_file("A/B/C/datei.pdf", b"pdf");
    tree.write_file("A/skip.png", b"png");
    tree.write_file("A/keep.TXT", b"txt");
    tree.mkdir("A/B/empty");
    let result = tree.scan(|config| {
        config.extensions = vec!["pdf".into(), ".Txt".into()];
        config.extensions = crate::filter::normalize_extensions(&config.extensions);
    });
    let names: Vec<String> = flatten(&result.root).into_iter().map(|n| n.name).collect();
    assert!(names.contains(&"A".to_string()));
    assert!(names.contains(&"B".to_string()));
    assert!(names.contains(&"C".to_string()));
    assert!(names.contains(&"empty".to_string()));
    assert!(names.contains(&"datei.pdf".to_string()));
    assert!(names.contains(&"keep.TXT".to_string()));
    assert!(!names.contains(&"skip.png".to_string()));
}

/// S.21
#[test]
fn without_extension_filter_all_regular_files_are_kept() {
    let tree = TempTree::new("all-files");
    tree.write_file("a.pdf", b"p");
    tree.write_file("b.png", b"n");
    tree.write_file("Makefile", b"m");
    let names: Vec<String> = flatten(&tree.scan(|_| {}).root)
        .into_iter()
        .map(|n| n.name)
        .collect();
    assert!(names.contains(&"a.pdf".to_string()));
    assert!(names.contains(&"b.png".to_string()));
    assert!(names.contains(&"Makefile".to_string()));
}

/// S.28–S.31
#[test]
fn optional_metadata_is_omitted_unless_enabled() {
    let tree = TempTree::new("meta");
    tree.write_file("data.bin", b"abc");
    tree.mkdir("folder");

    let off = tree.scan(|_| {});
    assert_no_optional_meta(&off.root);
    let off_file = as_dir(&off.root)
        .iter()
        .find(|node| matches!(node, FsNode::File { name, .. } if name == "data.bin"))
        .expect("file");
    match off_file {
        FsNode::File {
            size_bytes,
            created_at_ms,
            modified_at_ms,
            ..
        } => {
            assert_eq!(*size_bytes, None);
            assert_eq!(*created_at_ms, None);
            assert_eq!(*modified_at_ms, None);
        }
        FsNode::Directory { .. } => panic!("expected file"),
    }

    let on = tree.scan(|config| {
        config.include_size = true;
        config.include_created_at = true;
        config.include_modified_at = true;
    });
    let file = as_dir(&on.root)
        .iter()
        .find(|node| matches!(node, FsNode::File { name, .. } if name == "data.bin"))
        .expect("file");
    match file {
        FsNode::File {
            size_bytes,
            created_at_ms,
            modified_at_ms,
            ..
        } => {
            assert_eq!(*size_bytes, Some(3));
            assert!(created_at_ms.is_some());
            assert!(modified_at_ms.is_some());
        }
        FsNode::Directory { .. } => panic!("expected file"),
    }
    let folder = as_dir(&on.root)
        .iter()
        .find(|node| matches!(node, FsNode::Directory { name, .. } if name == "folder"))
        .expect("folder");
    match folder {
        FsNode::Directory { size_bytes, .. } => assert_eq!(*size_bytes, None),
        FsNode::File { .. } => panic!("expected folder"),
    }
}

/// S.35, S.36
#[test]
fn invalid_roots_are_rejected() {
    let missing = ScanConfig {
        root_path: std::env::temp_dir()
            .join("kondos-missing-root-xyz")
            .to_string_lossy()
            .into_owned(),
        max_depth: 8,
        exclude_hidden: false,
        extensions: vec![],
        include_size: false,
        include_created_at: false,
        include_modified_at: false,
    };
    let err = run(missing, &AtomicBool::new(false), 1, |_| {}).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);

    let file_root = TempTree::new("file-root");
    file_root.write_file("not-a-dir.txt", b"x");
    let mut as_file = file_root.base_config();
    as_file.root_path = file_root
        .root
        .join("not-a-dir.txt")
        .to_string_lossy()
        .into_owned();
    let err = run(as_file, &AtomicBool::new(false), 1, |_| {}).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::InvalidPath);
}

/// S.37, S.38, S.39
#[test]
fn special_unicode_and_long_names_are_preserved() {
    let tree = TempTree::new("names");
    tree.write_file("my file.txt", b"space");
    tree.write_file("Ordner_äöü/datei (1).txt", b"umlaut");
    tree.write_file("a-b_c.txt", b"dash");
    tree.write_file("文档/файл.txt", b"unicode");
    tree.write_file("emoji 📄.txt", b"emoji");
    let long_name = format!("{}.txt", "n".repeat(120));
    tree.write_file(&long_name, b"long");

    let names: Vec<String> = flatten(&tree.scan(|_| {}).root)
        .into_iter()
        .map(|n| n.name)
        .collect();
    assert!(names.contains(&"my file.txt".to_string()));
    assert!(names.contains(&"Ordner_äöü".to_string()));
    assert!(names.contains(&"datei (1).txt".to_string()));
    assert!(names.contains(&"a-b_c.txt".to_string()));
    assert!(names.contains(&"文档".to_string()));
    assert!(names.contains(&"файл.txt".to_string()));
    assert!(names.contains(&"emoji 📄.txt".to_string()));
    assert!(names.contains(&long_name));
}

/// S.45
#[test]
fn cancel_before_walk_does_not_panic() {
    let tree = TempTree::new("cancel");
    tree.write_file("a.txt", b"a");
    let cancel = AtomicBool::new(true);
    let err = run(tree.base_config(), &cancel, 1, |_| {}).unwrap_err();
    assert_eq!(err.kind, AppErrorKind::Cancelled);
}

/// S.47, S.48
#[test]
fn rescan_after_success_and_cancel_works() {
    let tree = TempTree::new("rescan");
    tree.write_file("a.txt", b"a");
    let first = run(tree.base_config(), &AtomicBool::new(false), 1, |_| {}).expect("first");
    assert_eq!(first.stats.file_count, 1);

    let cancelled = run(tree.base_config(), &AtomicBool::new(true), 1, |_| {}).unwrap_err();
    assert_eq!(cancelled.kind, AppErrorKind::Cancelled);

    let second = run(tree.base_config(), &AtomicBool::new(false), 1, |_| {}).expect("second");
    assert_eq!(second.stats.file_count, 1);
}

/// S.49, S.50
#[test]
fn progress_is_throttled_and_has_no_percentage() {
    let tree = TempTree::new("progress");
    for index in 0..300 {
        tree.write_file(&format!("f{index:03}.txt"), b"x");
    }
    let emissions = AtomicU64::new(0);
    let saw_percent_like = AtomicBool::new(false);
    let result = run(
        tree.base_config(),
        &AtomicBool::new(false),
        1,
        |progress: ScanProgress| {
            emissions.fetch_add(1, Ordering::SeqCst);
            match progress.status {
                ScanStatus::Running | ScanStatus::Completed | ScanStatus::Cancelled | ScanStatus::Failed => {}
            }
            if progress.current_path.contains('%') {
                saw_percent_like.store(true, Ordering::SeqCst);
            }
            assert_eq!(progress.scan_id, 1);
        },
    )
    .expect("scan");
    assert!(emissions.load(Ordering::SeqCst) < result.stats.file_count + result.stats.directory_count);
    assert!(emissions.load(Ordering::SeqCst) >= 2);
    assert!(!saw_percent_like.load(Ordering::SeqCst));
    let last_statuses_ok = matches!(
        result.root,
        FsNode::Directory { .. }
    );
    assert!(last_statuses_ok);
}

/// S.14, S.15 — Datei-Symlink. Benötigt unter Windows das Recht SeCreateSymbolicLinkPrivilege.
#[test]
#[ignore = "Windows-Symlink-Erzeugung benötigt SeCreateSymbolicLinkPrivilege (os error 1314)"]
fn file_symlink_is_observed_but_not_followed() {
    let tree = TempTree::new("symlink");
    tree.write_file("real.txt", b"ok");
    tree.write_file("target.txt", b"secret-target");
    let link = tree.root.join("link.txt");
    create_symlink_file(&tree.root.join("target.txt"), &link)
        .unwrap_or_else(|err| panic!("Symlink-Setup fehlgeschlagen, Test wird nicht still übersprungen: {err}"));

    let result = tree.scan(|_| {});
    let names: Vec<String> = flatten(&result.root).into_iter().map(|n| n.name).collect();
    assert!(names.contains(&"real.txt".to_string()));
    assert!(names.contains(&"target.txt".to_string()));
    assert!(names.contains(&"link.txt".to_string()));
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.code == WarningCode::Skipped && warning.path.ends_with("link.txt")));
}

fn create_symlink_file(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link)
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
}

/// Junctions dürfen denselben Baum nicht bis max_depth vervielfachen.
#[cfg(windows)]
#[test]
fn windows_junction_is_not_traversed() {
    let tree = TempTree::new("junction");
    tree.write_file("keep.txt", b"ok");
    tree.mkdir("A/B");
    tree.write_file("A/nested.txt", b"n");
    let junction = tree.root.join("A").join("B").join("loop");
    create_junction(&junction, &tree.root)
        .unwrap_or_else(|err| panic!("Junction-Setup fehlgeschlagen, Test wird nicht still übersprungen: {err}"));

    let result = tree.scan(|_| {});
    let nodes = flatten(&result.root);
    let keep_count = nodes.iter().filter(|node| node.name == "keep.txt").count();
    assert_eq!(keep_count, 1, "Junction darf keep.txt nicht duplizieren");
    assert!(nodes.iter().any(|node| node.name == "loop" && node.kind == "directory"));
    let loop_node = as_dir(&result.root)
        .iter()
        .find(|node| matches!(node, FsNode::Directory { name, .. } if name == "A"))
        .map(as_dir)
        .and_then(|children| {
            children.iter().find(|node| matches!(node, FsNode::Directory { name, .. } if name == "B"))
        })
        .map(as_dir)
        .and_then(|children| {
            children.iter().find(|node| matches!(node, FsNode::Directory { name, .. } if name == "loop"))
        })
        .expect("junction leaf");
    match loop_node {
        FsNode::Directory { children, .. } => {
            assert!(children.is_empty(), "Junction darf nicht rekursiv gelesen werden");
        }
        FsNode::File { .. } => panic!("expected directory leaf"),
    }
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.code == WarningCode::Skipped));
}

#[cfg(windows)]
fn create_junction(link: &Path, target: &Path) -> std::io::Result<()> {
    let command = format!("mklink /J {} {}", link.display(), target.display());
    let output = std::process::Command::new("cmd")
        .arg("/c")
        .arg(&command)
        .output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "mklink /J failed: {} {}",
                String::from_utf8_lossy(&output.stderr),
                String::from_utf8_lossy(&output.stdout)
            ),
        ))
    }
}

/// S.32, S.33 — Windows ACL, falls icacls verfügbar.
#[cfg(windows)]
#[test]
fn unreadable_child_is_warned_and_scan_continues() {
    let tree = TempTree::new("acl");
    tree.write_file("ok.txt", b"ok");
    tree.mkdir("locked");
    tree.write_file("locked/secret.txt", b"s");
    let locked = tree.root.join("locked");
    assert!(
        deny_list(&locked),
        "icacls /deny fehlgeschlagen; Test wird nicht still übersprungen"
    );
    let _restore = RestoreAcl(locked.clone());
    let result = tree.scan(|_| {});
    let names: Vec<String> = flatten(&result.root).into_iter().map(|n| n.name).collect();
    assert!(names.contains(&"ok.txt".to_string()));
    assert!(names.contains(&"locked".to_string()));
    assert!(
        result.warnings.iter().any(|warning| {
            matches!(
                warning.code,
                WarningCode::PermissionDenied | WarningCode::IoError | WarningCode::NotReadable
            )
        }),
        "unlesbarer Ordner muss eine Warnung erzeugen"
    );
    assert!(!names.contains(&"secret.txt".to_string()));
}

fn child_names(node: &FsNode) -> Vec<String> {
    as_dir(node)
        .iter()
        .map(|child| match child {
            FsNode::Directory { name, .. } | FsNode::File { name, .. } => name.clone(),
        })
        .collect()
}

/// S.44
#[test]
fn children_use_folder_then_file_natural_order() {
    let tree = TempTree::new("sort-order");
    tree.write_file("Datei 10.pdf", b"10");
    tree.write_file("zebra.txt", b"z");
    tree.write_file("Datei 2.pdf", b"2");
    tree.mkdir("Bilder 10");
    tree.mkdir("alpha");
    tree.mkdir("Bilder 2");

    let first = tree.scan(|_| {});
    let second = tree.scan(|_| {});
    let expected = vec![
        "alpha",
        "Bilder 2",
        "Bilder 10",
        "Datei 2.pdf",
        "Datei 10.pdf",
        "zebra.txt",
    ];
    assert_eq!(child_names(&first.root), expected);
    assert_eq!(child_names(&second.root), expected);
}

/// S.44 Unicode-Stabilität über wiederholte Scans
#[test]
fn unicode_child_order_is_stable_across_scans() {
    let tree = TempTree::new("sort-unicode");
    tree.write_file("文件.txt", b"c");
    tree.write_file("äpfel.txt", b"a");
    tree.mkdir("Österreich");
    tree.write_file("zeta.txt", b"z");
    let first = child_names(&tree.scan(|_| {}).root);
    let second = child_names(&tree.scan(|_| {}).root);
    assert_eq!(first, second);
    assert_eq!(first[0], "Österreich");
    assert!(first.iter().any(|name| name == "äpfel.txt"));
    assert!(first.iter().any(|name| name == "文件.txt"));
}

#[test]
fn cancel_during_walk_returns_cancelled_without_result() {
    let tree = TempTree::new("mid-cancel");
    for index in 0..400 {
        tree.write_file(&format!("f{index:03}.txt"), b"x");
    }
    let cancel = AtomicBool::new(false);
    let err = run(
        tree.base_config(),
        &cancel,
        9,
        |progress: ScanProgress| {
            assert_eq!(progress.scan_id, 9);
            if progress.processed_count >= 250 && progress.status == ScanStatus::Running {
                cancel.store(true, Ordering::SeqCst);
            }
        },
    )
    .unwrap_err();
    assert_eq!(err.kind, AppErrorKind::Cancelled);

    let again = run(tree.base_config(), &AtomicBool::new(false), 10, |_| {}).expect("rescan");
    assert!(again.stats.file_count >= 400);
}

#[test]
fn warning_codes_from_io_are_structured() {
    use std::io::{Error, ErrorKind};

    assert_eq!(
        crate::error::warning_code_from_io(&Error::from(ErrorKind::PermissionDenied)),
        WarningCode::PermissionDenied
    );
    assert_eq!(
        crate::error::warning_code_from_io(&Error::from(ErrorKind::NotFound)),
        WarningCode::NotFound
    );
    assert_eq!(
        crate::error::warning_code_from_metadata_io(&Error::from(ErrorKind::Other)),
        WarningCode::NotReadable
    );
}

#[cfg(windows)]
struct RestoreAcl(std::path::PathBuf);

#[cfg(windows)]
impl Drop for RestoreAcl {
    fn drop(&mut self) {
        grant_list(&self.0);
    }
}

#[cfg(windows)]
fn deny_list(path: &Path) -> bool {
    std::process::Command::new("icacls")
        .arg(path)
        .arg("/deny")
        .arg("*S-1-1-0:(OI)(CI)(GR)")
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn grant_list(path: &Path) {
    let _ = std::process::Command::new("icacls")
        .arg(path)
        .arg("/remove:d")
        .arg("*S-1-1-0")
        .status();
}
