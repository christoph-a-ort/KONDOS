use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::export::filename::suggested_export_file_name;
use crate::export::node::node_name;
use crate::export::paths::{looks_like_absolute_local_path, to_portable_path};
use crate::export::{render_export, render_export_with_txt_columns, write_export_file};
use crate::export::ExportMetaFlags;
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
        listing: crate::model::DirectoryListing::Read,
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

fn txt_columns(size: bool, modified: bool, created: bool) -> ExportMetaFlags {
    ExportMetaFlags {
        include_size: size,
        include_created_at: created,
        include_modified_at: modified,
    }
}

fn render_txt(result: &ScanResult, columns: ExportMetaFlags) -> String {
    render_export_with_txt_columns(ExportFormat::Txt, result, Some(columns)).expect("txt")
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
    let created = super::txt::format_txt_datetime(0);
    let modified = super::txt::format_txt_datetime(1_001);
    assert!(first.contains(&format!(
        "│   └── Angebot.PDF (12 B, geändert {modified}, erstellt {created})\n"
    )));
    assert!(!created.contains('Z') && !created.contains('T'));
    assert!(!modified.contains(':' ) || modified.matches(':').count() == 1);
    assert_eq!(created.chars().filter(|ch| *ch == '.').count(), 2);
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
    assert!(
        !json.contains("\"listing\""),
        "internes listing-Feld gehört nicht zum öffentlichen JSON-Exportvertrag"
    );
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
        None,
    )
    .expect("write");
    let body = fs::read_to_string(&written).unwrap();
    assert!(body.starts_with("[Root] Mustermann/"));
    assert!(!body.contains("ORIGINAL"));

    let as_dir = root.join("not-a-file");
    fs::create_dir(&as_dir).unwrap();
    let err = write_export_file(as_dir.to_str().unwrap(), ExportFormat::Csv, &fixture(), None);
    assert!(err.is_err());
    assert!(as_dir.is_dir());

    let missing_parent = root.join("missing-parent").join("out.csv");
    let original_target = root.join("keep.csv");
    fs::write(&original_target, b"KEEP").unwrap();
    assert!(write_export_file(
        missing_parent.to_str().unwrap(),
        ExportFormat::Csv,
        &fixture(),
        None
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

#[test]
fn txt_name_only_omits_metadata_suffixes() {
    let txt = render_txt(&fixture(), txt_columns(false, false, false));
    assert!(txt.contains("│   └── Angebot.PDF\n"));
    assert!(!txt.contains(" B"));
    assert!(!txt.contains("geändert"));
    assert!(!txt.contains("erstellt"));
}

#[test]
fn txt_name_and_modified_omits_size_and_created() {
    let txt = render_txt(&fixture(), txt_columns(false, true, false));
    let modified = super::txt::format_txt_datetime(1_001);
    assert!(txt.contains(&format!("│   └── Angebot.PDF (geändert {modified})\n")));
    assert!(!txt.contains("12 B"));
    assert!(!txt.contains("erstellt"));
}

#[test]
fn txt_name_size_modified_omits_created() {
    let txt = render_txt(&fixture(), txt_columns(true, true, false));
    let modified = super::txt::format_txt_datetime(1_001);
    assert!(txt.contains(&format!(
        "│   └── Angebot.PDF (12 B, geändert {modified})\n"
    )));
    assert!(!txt.contains("erstellt"));
}

#[test]
fn txt_all_visible_metadata_uses_treeview_order() {
    let txt = render_txt(&fixture(), txt_columns(true, true, true));
    let created = super::txt::format_txt_datetime(0);
    let modified = super::txt::format_txt_datetime(1_001);
    let line = format!("│   └── Angebot.PDF (12 B, geändert {modified}, erstellt {created})\n");
    assert!(txt.contains(&line));
    let start = txt.find("Angebot.PDF").unwrap();
    let size = txt[start..].find("12 B").unwrap();
    let changed = txt[start..].find("geändert").unwrap();
    let created_at = txt[start..].find("erstellt").unwrap();
    assert!(size < changed && changed < created_at);
}

#[test]
fn txt_hidden_column_stays_in_snapshot_and_returns_when_shown() {
    let result = fixture();
    let hidden = render_txt(&result, txt_columns(true, true, false));
    assert!(!hidden.contains("erstellt"));
    let shown = render_txt(&result, txt_columns(true, true, true));
    assert!(shown.contains("erstellt"));
    assert_eq!(node_name(&result.root), "Mustermann");
}

#[test]
fn txt_directories_never_get_metadata_suffixes() {
    let result = ScanResult {
        root: FsNode::Directory {
            id: r"C:\root".into(),
            name: "Hausverwaltung".into(),
            path: r"C:\root".into(),
            depth: 0,
            listing: crate::model::DirectoryListing::Read,
            children: vec![FsNode::Directory {
                id: r"C:\root\Weßling".into(),
                name: "Weßling".into(),
                path: r"C:\root\Weßling".into(),
                depth: 1,
                listing: crate::model::DirectoryListing::Read,
                children: Vec::new(),
                size_bytes: None,
                created_at_ms: Some(0),
                modified_at_ms: Some(1_001),
            }],
            size_bytes: None,
            created_at_ms: Some(0),
            modified_at_ms: Some(1_001),
        },
        warnings: Vec::new(),
        stats: ScanStats::default(),
    };
    let txt = render_txt(&result, txt_columns(true, true, true));
    assert!(txt.starts_with("[Root] Hausverwaltung/\n"));
    assert!(txt.contains("└── Weßling/\n"));
    assert!(!txt.contains("geändert"));
    assert!(!txt.contains("erstellt"));
    assert!(!txt.contains(" B,"));
}

#[test]
fn txt_datetime_is_local_treeview_style() {
    let stamp = super::txt::format_txt_datetime(0);
    assert_eq!(stamp, super::txt::format_txt_datetime(0));
    let parts: Vec<&str> = stamp.split(['.', ' ']).collect();
    assert_eq!(parts.len(), 4);
    assert_eq!(parts[0].len(), 2);
    assert_eq!(parts[1].len(), 2);
    assert_eq!(parts[2].len(), 4);
    assert_eq!(parts[3].len(), 5);
    assert_eq!(parts[3].matches(':').count(), 1);
    assert!(!stamp.contains('Z'));
    assert!(!stamp.contains('T'));
    assert!(!stamp.contains(".000"));
    let txt = render_txt(&fixture(), txt_columns(false, true, false));
    assert!(txt.contains(&format!(
        "geändert {}",
        super::txt::format_txt_datetime(1_001)
    )));
}

#[test]
fn csv_and_json_ignore_txt_column_flags() {
    let result = fixture();
    let csv = render_export(ExportFormat::Csv, &result).expect("csv");
    let csv_forced = render_export_with_txt_columns(
        ExportFormat::Csv,
        &result,
        Some(txt_columns(false, false, false)),
    )
    .expect("csv");
    assert_eq!(csv, csv_forced);
    assert!(csv
        .trim_start_matches('\u{feff}')
        .starts_with("path,kind,name,depth,sizeBytes,createdAt,modifiedAt\n"));
    assert!(csv.contains("1970-01-01T00:00:00.000Z"));
    let json = render_export(ExportFormat::Json, &result).expect("json");
    let json_forced = render_export_with_txt_columns(
        ExportFormat::Json,
        &result,
        Some(txt_columns(false, false, false)),
    )
    .expect("json");
    assert_eq!(json, json_forced);
    assert!(json.contains("1970-01-01T00:00:00.000Z"));
}

#[test]
fn txt_clipboard_matches_saved_txt_for_same_columns() {
    let result = fixture();
    let columns = txt_columns(true, false, true);
    let clipboard = render_txt(&result, columns);
    let saved = render_export_with_txt_columns(ExportFormat::Txt, &result, Some(columns)).expect("txt");
    assert_eq!(clipboard, saved);
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
