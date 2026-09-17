use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::export::filename::suggested_export_file_name;
use crate::export::node::node_name;
use crate::export::paths::{looks_like_absolute_local_path, to_portable_path};
use crate::export::{render_export, write_export_file};
use crate::model::{
    ExportFormat, FsNode, ScanResult, ScanStats, ScanWarning, WarningCode,
};
use crate::state::AppState;

fn dir(name: &str, path: &str, depth: u8, children: Vec<FsNode>) -> FsNode {
    FsNode::Directory {
        id: path.to_string(),
        name: name.to_string(),
        path: path.to_string(),
        depth,
        children,
        size_bytes: None,
        created_at_ms: None,
        modified_at_ms: None,
    }
}

fn file(
    name: &str,
    path: &str,
    depth: u8,
    size: Option<u64>,
    created: Option<u64>,
    modified: Option<u64>,
) -> FsNode {
    FsNode::File {
        id: path.to_string(),
        name: name.to_string(),
        path: path.to_string(),
        depth,
        size_bytes: size,
        created_at_ms: created,
        modified_at_ms: modified,
    }
}

fn fixture() -> ScanResult {
    let root = r"C:\Users\COrt\Projekte\Mustermann";
    ScanResult {
        root: dir(
            "Mustermann",
            root,
            0,
            vec![
                dir(
                    "DOKUMENTE",
                    &format!(r"{root}\DOKUMENTE"),
                    1,
                    vec![file(
                        "Angebot.PDF",
                        &format!(r"{root}\DOKUMENTE\Angebot.PDF"),
                        2,
                        Some(12),
                        Some(0),
                        Some(1_001),
                    )],
                ),
                file(
                    r#"say "hello", world"#,
                    &format!(r#"{root}\say "hello", world"#),
                    1,
                    None,
                    None,
                    None,
                ),
                file(
                    "Äpfel 📁.txt",
                    &format!(r"{root}\Äpfel 📁.txt"),
                    1,
                    None,
                    None,
                    None,
                ),
                dir("empty", &format!(r"{root}\empty"), 1, Vec::new()),
            ],
        ),
        warnings: vec![
            ScanWarning {
                path: format!(r"{root}\secret"),
                code: WarningCode::PermissionDenied,
                message: "Keine Leseberechtigung.".into(),
            },
            ScanWarning {
                path: r"D:\other\skip".into(),
                code: WarningCode::Skipped,
                message: "Dateisystemverweis wird nicht gefolgt.".into(),
            },
        ],
        stats: ScanStats {
            directory_count: 3,
            file_count: 3,
            skipped_count: 1,
            duration_ms: 42,
        },
    }
}

fn contains_absolute(payload: &str) -> bool {
    payload.lines().any(|line| {
        looks_like_absolute_local_path(line)
            || line.contains(r"C:\")
            || line.contains("C:/Users")
            || line.contains(r"D:\")
    }) || payload.contains(r"C:\\Users")
}

#[test]
fn txt_is_deterministic_utf8_lf_without_bom_or_absolute_paths() {
    let result = fixture();
    let first = render_export(ExportFormat::Txt, &result).expect("txt");
    let second = render_export(ExportFormat::Txt, &result).expect("txt");
    assert_eq!(first, second);
    assert!(!first.starts_with('\u{feff}'));
    assert!(!first.contains('\r'));
    assert!(first.ends_with('\n'));
    assert!(first.starts_with("[Root] Mustermann/\n"));
    assert!(first.contains("├── DOKUMENTE/\n"));
    assert!(first.contains("│   └── Angebot.PDF (12 B, erstellt 1970-01-01T00:00:00.000Z, geändert 1970-01-01T00:00:01.001Z)\n"));
    assert!(first.contains("├── Äpfel 📁.txt\n"));
    assert!(first.contains("└── empty/\n"));
    assert!(!contains_absolute(&first));
}

#[test]
fn csv_is_deterministic_bom_lf_and_escapes() {
    let result = fixture();
    let first = render_export(ExportFormat::Csv, &result).expect("csv");
    let second = render_export(ExportFormat::Csv, &result).expect("csv");
    assert_eq!(first, second);
    assert!(first.as_bytes().starts_with(&[0xEF, 0xBB, 0xBF]));
    let body = first.trim_start_matches('\u{feff}');
    assert!(!body.contains('\r'));
    assert!(body.ends_with('\n'));
    assert!(body.starts_with("path,kind,name,depth,sizeBytes,createdAt,modifiedAt\n"));
    assert!(body.contains("Mustermann/DOKUMENTE/Angebot.PDF,file,Angebot.PDF,2,12,1970-01-01T00:00:00.000Z,1970-01-01T00:00:01.001Z\n"));
    assert!(body.contains(r#""Mustermann/say ""hello"", world",file,"say ""hello"", world",1,,,"#));
    assert!(body.contains("Mustermann/Äpfel 📁.txt,file,Äpfel 📁.txt,1,,,"));
    assert!(!contains_absolute(body));
}

#[test]
fn json_contract_version_order_children_and_warnings() {
    let result = fixture();
    let json = render_export(ExportFormat::Json, &result).expect("json");
    assert_eq!(json, render_export(ExportFormat::Json, &result).expect("json"));
    assert!(!json.starts_with('\u{feff}'));
    assert!(json.ends_with('\n'));
    assert!(!json.contains('\r'));

    let export_version = json.find("\"exportVersion\"").expect("exportVersion");
    let root = json.find("\"root\"").expect("root");
    let stats = json.find("\"stats\"").expect("stats");
    let warnings = json.find("\"warnings\"").expect("warnings");
    assert!(export_version < root && root < stats && stats < warnings);
    assert!(json.contains("\"exportVersion\": 1"));

    let first_node = json.find("\"name\": \"Mustermann\"").expect("root name");
    let path_idx = json[first_node..].find("\"path\"").expect("path") + first_node;
    let kind_idx = json[first_node..].find("\"kind\"").expect("kind") + first_node;
    let children_idx = json[first_node..].find("\"children\"").expect("children") + first_node;
    assert!(first_node < path_idx && path_idx < kind_idx && kind_idx < children_idx);

    assert!(json.contains("\"name\": \"Angebot.PDF\""));
    assert!(json.contains("\"children\": []"));
    assert!(json.contains("\"name\": \"empty\""));
    assert!(json.contains("\"code\": \"permissionDenied\""));
    let warning_secret = json
        .find("\"path\": \"Mustermann/secret\"")
        .expect("portable warning");
    let warning_null = json.find("\"path\": null").expect("unrelated warning null");
    assert!(warning_secret < warning_null);
    assert!(!json.contains("\"path\": \"\""));
    assert!(!contains_absolute(&json));
    assert!(json.contains("\"directoryCount\": 3"));
}

#[test]
fn json_warning_path_is_portable_or_explicit_null() {
    let result = fixture();
    let json = render_export(ExportFormat::Json, &result).expect("json");
    assert!(json.contains("\"path\": \"Mustermann/secret\""));
    assert!(json.contains("\"path\": null"));
    assert!(!json.contains("\"path\": \"\""));
    assert!(!json.contains(r"C:\\Users"));
    assert!(!json.contains(r"D:\\other"));
    let skipped = json
        .find("\"code\": \"skipped\"")
        .expect("skipped warning");
    let window = &json[skipped.saturating_sub(80)..skipped];
    assert!(
        window.contains("\"path\": null"),
        "path field must remain present as null next to skipped warning"
    );
}

#[test]
fn node_and_warning_order_and_case_are_preserved() {
    let result = fixture();
    let txt = render_export(ExportFormat::Txt, &result).expect("txt");
    let dok = txt.find("DOKUMENTE").unwrap();
    let quoted = txt.find(r#"say "hello""#).unwrap();
    let apples = txt.find("Äpfel").unwrap();
    let empty = txt.find("empty").unwrap();
    assert!(dok < quoted && quoted < apples && apples < empty);

    let json = render_export(ExportFormat::Json, &result).expect("json");
    assert!(json.contains("Angebot.PDF"));
    assert!(json.contains("Äpfel 📁.txt"));
}

#[test]
fn missing_metadata_is_not_invented() {
    let result = ScanResult {
        root: dir("root", r"C:\root", 0, vec![file("a.txt", r"C:\root\a.txt", 1, None, None, None)]),
        warnings: Vec::new(),
        stats: ScanStats::default(),
    };
    let json = render_export(ExportFormat::Json, &result).expect("json");
    assert!(!json.contains("sizeBytes"));
    assert!(!json.contains("createdAt"));
    assert!(!json.contains("modifiedAt"));
    let csv = render_export(ExportFormat::Csv, &result).expect("csv");
    assert_eq!(
        csv.trim_start_matches('\u{feff}').lines().next(),
        Some("path,kind,name,depth")
    );
}

#[test]
fn json_escapes_quotes() {
    let result = fixture();
    let json = render_export(ExportFormat::Json, &result).expect("json");
    assert!(json.contains(r#""name": "say \"hello\", world""#));
}

#[test]
fn export_does_not_mutate_scan_result() {
    let mut result = fixture();
    let before_root = node_name(&result.root).to_string();
    let before_warnings = result.warnings.len();
    let before_path = result.warnings[0].path.clone();
    let _ = render_export(ExportFormat::Json, &result).unwrap();
    let _ = render_export(ExportFormat::Csv, &result).unwrap();
    let _ = render_export(ExportFormat::Txt, &result).unwrap();
    assert_eq!(node_name(&result.root), before_root);
    assert_eq!(result.warnings.len(), before_warnings);
    assert_eq!(result.warnings[0].path, before_path);
    result.stats.duration_ms = 99;
    assert_eq!(result.stats.duration_ms, 99);
}

#[test]
fn portable_paths_use_slash() {
    let root = r"C:\Users\COrt\Projekte\Mustermann";
    assert_eq!(
        to_portable_path(root, "Mustermann", &format!(r"{root}\DOKUMENTE\Angebot.PDF")),
        "Mustermann/DOKUMENTE/Angebot.PDF"
    );
}

#[test]
fn write_file_uses_temp_and_protects_existing_on_failure() {
    let root = unique_temp("kondos-export-ok");
    fs::create_dir_all(&root).unwrap();
    let target = root.join("Mustermann.txt");
    fs::write(&target, b"ORIGINAL").unwrap();
    let written = write_export_file(
        target.to_str().unwrap(),
        ExportFormat::Txt,
        &fixture(),
    )
    .expect("write");
    let body = fs::read_to_string(&written).unwrap();
    assert!(body.starts_with("[Root] Mustermann/"));
    assert!(!body.contains("ORIGINAL"));

    let as_dir = root.join("not-a-file");
    fs::create_dir(&as_dir).unwrap();
    let err = write_export_file(as_dir.to_str().unwrap(), ExportFormat::Csv, &fixture());
    assert!(err.is_err());
    assert!(as_dir.is_dir());

    let missing_parent = root.join("missing-parent").join("out.csv");
    let original_target = root.join("keep.csv");
    fs::write(&original_target, b"KEEP").unwrap();
    assert!(write_export_file(
        missing_parent.to_str().unwrap(),
        ExportFormat::Csv,
        &fixture()
    )
    .is_err());
    assert_eq!(fs::read(&original_target).unwrap(), b"KEEP");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn repeated_export_same_snapshot_is_allowed() {
    let state = AppState::new();
    state.store_snapshot(7, fixture());
    {
        let first = state.try_begin_export(7).expect("first");
        let _ = render_export(ExportFormat::Json, first.result().as_ref()).unwrap();
    }
    let second = state.try_begin_export(7).expect("second");
    let _ = render_export(ExportFormat::Csv, second.result().as_ref()).unwrap();
}

#[test]
fn missing_or_stale_scan_id_is_rejected() {
    let state = AppState::new();
    assert!(state.try_begin_export(1).is_err());
    state.store_snapshot(4, fixture());
    assert!(state.try_begin_export(5).is_err());
    assert!(state.snapshot_for(5).is_err());
    assert!(state.try_begin_export(4).is_ok());
}

#[test]
fn suggested_name_uses_root() {
    assert_eq!(
        suggested_export_file_name("Mustermann", ExportFormat::Csv),
        "Mustermann.csv"
    );
}

fn unique_temp(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ))
}
