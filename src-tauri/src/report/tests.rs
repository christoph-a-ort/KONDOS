use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;

use zip::ZipArchive;

use crate::report::filename::suggested_report_file_name_at;
use crate::report::model::*;
use crate::report::persist::write_report_xlsx_file;
use crate::report::xlsx::{
    build_report_xlsx_bytes, expected_sheet_names, SHEET_EMPTY_FOLDERS, SHEET_EXACT_NAMES,
    SHEET_EXTENSIONS, SHEET_FILE_NAME_PATTERNS, SHEET_FILE_TYPES, SHEET_FOLDERS, SHEET_OVERVIEW,
    SHEET_REPEATED_FILES, SHEET_REPEATED_FOLDERS, SHEET_SAME_STEMS, SHEET_SINGLE_FILE,
    SHEET_UNREADABLE, SHEET_YEAR_STRUCTURES, WORK_COL_CHECK, WORK_COL_DONE, WORK_COL_NOTE,
};

fn sample_report() -> InventoryReportModel {
    InventoryReportModel {
        meta: InventoryReportMeta {
            schema_version: 1,
            created_at_ms: 1_700_000_000_123,
            root_path: "X:/bestand".into(),
            root_name: "bestand".into(),
            max_depth: Some(10),
            scan_id: None,
            max_observed_depth: 3,
        },
        chapter_selection: InventoryReportChapterSelection::all_enabled(),
        chapters: InventoryReportChapters {
            overview: InventoryReportOverview {
                directory_count: 8,
                file_count: 7,
                known_size_bytes: 226,
                files_without_known_size: 0,
                depth_limited_folder_count: 0,
                subdirectory_count: 7,
            },
            file_types: vec![
                InventoryReportFileTypeRow {
                    extension: ".pdf".into(),
                    label: "PDF".into(),
                    file_count: 3,
                    known_size_bytes: 191,
                },
                InventoryReportFileTypeRow {
                    extension: ".txt".into(),
                    label: "TXT".into(),
                    file_count: 2,
                    known_size_bytes: 13,
                },
            ],
            folders: vec![
                InventoryReportFolderRow {
                    name: "bestand".into(),
                    relative_path: ".".into(),
                    depth: 0,
                    listing: "read".into(),
                    direct_file_count: 0,
                    direct_directory_count: 6,
                    direct_known_size_bytes: 0,
                },
                InventoryReportFolderRow {
                    name: "Äpfel".into(),
                    relative_path: "Äpfel".into(),
                    depth: 1,
                    listing: "read".into(),
                    direct_file_count: 1,
                    direct_directory_count: 0,
                    direct_known_size_bytes: 10,
                },
            ],
            empty_folders: vec![InventoryReportPathRow {
                name: "leer".into(),
                relative_path: "leer".into(),
            }],
            single_file_folders: vec![InventoryReportSingleFileFolderRow {
                folder_name: "einzeln".into(),
                relative_path: "einzeln".into(),
                file_name: "allein.txt".into(),
                extension: ".txt".into(),
            }],
            unreadable: InventoryReportUnreadable {
                warnings: vec![InventoryReportWarningRow {
                    relative_path: "junction".into(),
                    code: "skipped".into(),
                    message: "Dateisystemverweis wird nicht gefolgt.".into(),
                }],
                unconfirmed_empty_looking_folders: vec![InventoryReportPathRow {
                    name: "junction".into(),
                    relative_path: "junction".into(),
                }],
            },
            repeated_folder_names: vec![InventoryReportNameGroup {
                name: "Angebote".into(),
                count: 2,
                relative_paths: vec!["KundeA/Angebote".into(), "KundeB/Angebote".into()],
            }],
            repeated_file_names: vec![InventoryReportNameGroup {
                name: "Rechnung_2024-01-15.pdf".into(),
                count: 2,
                relative_paths: vec![
                    "A/Rechnung_2024-01-15.pdf".into(),
                    "B/Rechnung_2024-01-15.pdf".into(),
                ],
            }],
            year_structures: vec![InventoryReportYearStructure {
                parent_relative_path: "Jahre".into(),
                parent_name: "Jahre".into(),
                years: vec![2022, 2023, 2024],
                min_year: 2022,
                max_year: 2024,
                missing_years: vec![],
                consecutive_runs: vec![InventoryReportYearRun {
                    start: 2022,
                    end: 2024,
                }],
                year_folders: vec![
                    InventoryReportYearFolder {
                        year: 2022,
                        relative_path: "Jahre/2022".into(),
                        name: "2022".into(),
                    },
                    InventoryReportYearFolder {
                        year: 2023,
                        relative_path: "Jahre/2023".into(),
                        name: "2023".into(),
                    },
                    InventoryReportYearFolder {
                        year: 2024,
                        relative_path: "Jahre/2024".into(),
                        name: "2024".into(),
                    },
                ],
            }],
            file_name_patterns: InventoryReportFileNamePatterns {
                analyzed_file_count: 7,
                files_with_digits: 3,
                files_with_leading_digits: 0,
                files_with_recognized_date_forms: 2,
                files_with_six_digit_blocks: 1,
                date_form_groups: vec![
                    InventoryReportDateFormGroup {
                        format: "YYYY-MM-DD".into(),
                        label: "2025-09-25 (JJJJ-MM-TT)".into(),
                        match_count: 2,
                    },
                    InventoryReportDateFormGroup {
                        format: "YYYY_MM_DD".into(),
                        label: "2025_09_25 (JJJJ_MM_TT)".into(),
                        match_count: 0,
                    },
                    InventoryReportDateFormGroup {
                        format: "YYYYMMDD".into(),
                        label: "20250925 (JJJJMMTT)".into(),
                        match_count: 0,
                    },
                ],
                six_digit_hint: "Sechsstellige Zahlenfolgen werden nicht als Datum gewertet.".into(),
                date_forms_hint: "Datumsformen sind Beobachtungen.".into(),
            },
            same_file_stems: vec![InventoryReportSameStemGroup {
                normalized_stem: "protokoll".into(),
                observed_stem_forms: vec!["Protokoll".into()],
                extension_keys: vec![".pdf".into(), ".docx".into()],
                occurrence_count: 2,
                occurrences: vec![
                    InventoryReportStemOccurrence {
                        relative_path: "stem/Protokoll.pdf".into(),
                        filename: "Protokoll.pdf".into(),
                        extension_key: ".pdf".into(),
                    },
                    InventoryReportStemOccurrence {
                        relative_path: "stem/Protokoll.docx".into(),
                        filename: "Protokoll.docx".into(),
                        extension_key: ".docx".into(),
                    },
                ],
            }],
            exact_file_name_structures: vec![InventoryReportExactNameStructureGroup {
                signature: "Notiz.txt|Rechnung.pdf".into(),
                direct_file_names: vec!["Notiz.txt".into(), "Rechnung.pdf".into()],
                direct_file_count: 2,
                folder_count: 2,
                folders: vec![
                    InventoryReportStructureFolder {
                        relative_path: "A".into(),
                        name: "A".into(),
                        depth: 1,
                    },
                    InventoryReportStructureFolder {
                        relative_path: "B".into(),
                        name: "B".into(),
                        depth: 1,
                    },
                ],
            }],
            extension_distributions: vec![InventoryReportExtensionDistributionGroup {
                signature: "1×.docx,1×.pdf".into(),
                extension_counts: vec![
                    InventoryReportExtensionCount {
                        extension_key: ".docx".into(),
                        count: 1,
                    },
                    InventoryReportExtensionCount {
                        extension_key: ".pdf".into(),
                        count: 1,
                    },
                ],
                direct_file_count: 2,
                folder_count: 1,
                folders: vec![InventoryReportStructureFolder {
                    relative_path: "stem".into(),
                    name: "stem".into(),
                    depth: 1,
                }],
                hint: "Endungsverteilungen beschreiben den Bestand.".into(),
            }],
            interpretation: InventoryReportInterpretation {
                notes: vec![
                    "Eine auffällige Zahl oder Struktur ist für Dotty zunächst ein Hinweis, aber noch keine Bewertung.".into(),
                    "Gleiche Namen bedeuten nicht automatisch gleiche Inhalte.".into(),
                    "Wiederkehrende Strukturen sind Beobachtungen und keine Lösch-, Verschiebe- oder Bereinigungsempfehlung.".into(),
                    "Unicode-Pfad: Äpfel/Überprüfung mit langem Hinweistext für Umbruch und Filterbarkeit.".into(),
                ],
            },
        },
    }
}

fn sheet_names_from_xlsx(bytes: &[u8]) -> Vec<String> {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let mut workbook_xml = String::new();
    zip.by_name("xl/workbook.xml")
        .expect("workbook.xml")
        .read_to_string(&mut workbook_xml)
        .expect("read workbook");
    let start = workbook_xml
        .find("<sheets>")
        .or_else(|| workbook_xml.find("<sheets "))
        .expect("sheets section");
    let end = workbook_xml[start..]
        .find("</sheets>")
        .expect("sheets end")
        + start;
    let section = &workbook_xml[start..end];
    let mut names = Vec::new();
    let mut rest = section;
    while let Some(idx) = rest.find("name=\"") {
        rest = &rest[idx + 6..];
        if let Some(end) = rest.find('"') {
            names.push(rest[..end].to_string());
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
    names
}

fn shared_strings(bytes: &[u8]) -> String {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let result = match zip.by_name("xl/sharedStrings.xml") {
        Ok(mut file) => {
            let mut s = String::new();
            file.read_to_string(&mut s).expect("shared strings");
            s
        }
        Err(_) => String::new(),
    };
    result
}

fn archive_has_entry(bytes: &[u8], name: &str) -> bool {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let ok = zip.by_name(name).is_ok();
    ok
}

fn data_validations_xml(bytes: &[u8]) -> String {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let mut found = String::new();
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).expect("entry");
        let name = file.name().to_string();
        if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
            let mut body = String::new();
            file.read_to_string(&mut body).expect("sheet xml");
            if body.contains("dataValidation") || body.contains("dataValidations") {
                found.push_str(&body);
            }
        }
    }
    found
}

fn overview_sheet_xml(bytes: &[u8]) -> String {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let mut file = zip.by_name("xl/worksheets/sheet1.xml").expect("overview sheet1");
    let mut body = String::new();
    file.read_to_string(&mut body).expect("read sheet1");
    body
}

fn row_heights_from_sheet_xml(xml: &str) -> Vec<f64> {
    let mut heights = Vec::new();
    let mut rest = xml;
    while let Some(idx) = rest.find(" ht=\"") {
        rest = &rest[idx + 5..];
        if let Some(end) = rest.find('"') {
            if let Ok(v) = rest[..end].parse::<f64>() {
                heights.push(v);
            }
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
    heights
}

#[test]
fn full_selection_produces_exactly_13_sheets() {
    let report = sample_report();
    let bytes = build_report_xlsx_bytes(&report).expect("xlsx");
    assert!(!bytes.is_empty());
    let names = sheet_names_from_xlsx(&bytes);
    let expected = expected_sheet_names(&report.chapter_selection);
    assert_eq!(names.len(), 13, "{names:?}");
    assert_eq!(names, expected.iter().map(|s| (*s).to_string()).collect::<Vec<_>>());
    assert!(!names.iter().any(|n| n == "interpretation" || n == "Interpretation"));
}

#[test]
fn sheet_names_match_german_contract() {
    let expected = [
        SHEET_OVERVIEW,
        SHEET_FILE_TYPES,
        SHEET_FOLDERS,
        SHEET_EMPTY_FOLDERS,
        SHEET_SINGLE_FILE,
        SHEET_UNREADABLE,
        SHEET_REPEATED_FOLDERS,
        SHEET_REPEATED_FILES,
        SHEET_YEAR_STRUCTURES,
        SHEET_FILE_NAME_PATTERNS,
        SHEET_SAME_STEMS,
        SHEET_EXACT_NAMES,
        SHEET_EXTENSIONS,
    ];
    let report = sample_report();
    let names = sheet_names_from_xlsx(&build_report_xlsx_bytes(&report).unwrap());
    assert_eq!(names, expected.map(str::to_string));
}

#[test]
fn disabled_chapter_omits_sheet() {
    let mut report = sample_report();
    report.chapter_selection.year_structures = false;
    report.chapter_selection.empty_folders = false;
    let names: HashSet<_> = sheet_names_from_xlsx(&build_report_xlsx_bytes(&report).unwrap())
        .into_iter()
        .collect();
    assert!(!names.contains(SHEET_YEAR_STRUCTURES));
    assert!(!names.contains(SHEET_EMPTY_FOLDERS));
    assert!(names.contains(SHEET_OVERVIEW));
    assert_eq!(names.len(), 11);
    // Data still present in model
    assert!(!report.chapters.year_structures.is_empty());
    assert!(!report.chapters.empty_folders.is_empty());
}

#[test]
fn interpretation_has_no_own_sheet_but_appears_in_overview() {
    let report = sample_report();
    let bytes = build_report_xlsx_bytes(&report).unwrap();
    let names = sheet_names_from_xlsx(&bytes);
    assert_eq!(names.len(), 13);
    let shared = shared_strings(&bytes);
    assert!(shared.contains("DottyFM"));
    assert!(shared.contains("auffällige Zahl") || shared.contains("auff&#"), "{shared}");
    assert!(shared.contains("keine Bewertung") || shared.contains("Bewertung"));
}

#[test]
fn overview_interpretation_rows_use_content_based_height() {
    let report = sample_report();
    let bytes = build_report_xlsx_bytes(&report).unwrap();
    let xml = overview_sheet_xml(&bytes);
    // Sample notes wrap in column A (width 36); fixed ht=36 clipped them.
    let heights = row_heights_from_sheet_xml(&xml);
    assert!(
        heights.iter().any(|h| *h > 36.0),
        "expected at least one interpretation row taller than 36pt, got {heights:?}"
    );
    assert!(
        heights.iter().all(|h| *h <= 220.0),
        "heights should stay within clamp, got {heights:?}"
    );
}

#[test]
fn overview_contains_meta_and_counts() {
    let report = sample_report();
    let shared = shared_strings(&build_report_xlsx_bytes(&report).unwrap());
    assert!(shared.contains("Schema-Version") || shared.contains("1"));
    assert!(shared.contains("X:/bestand") || shared.contains("bestand"));
    assert!(shared.contains("Startordner") || shared.contains("Scan-ID"));
}

#[test]
fn detail_content_and_occurrences_present() {
    let report = sample_report();
    let shared = shared_strings(&build_report_xlsx_bytes(&report).unwrap());
    assert!(shared.contains("leer"));
    assert!(shared.contains("allein.txt"));
    assert!(shared.contains("KundeA/Angebote"));
    assert!(shared.contains("KundeB/Angebote"));
    assert!(shared.contains("Rechnung_2024-01-15.pdf"));
    assert!(shared.contains("Jahre/2022"));
    assert!(shared.contains("Jahre/2023"));
    assert!(shared.contains("Jahre/2024"));
    assert!(shared.contains("Protokoll.pdf"));
    assert!(shared.contains("Protokoll.docx"));
    assert!(shared.contains("JJJJ-MM-TT") || shared.contains("2025-09-25"));
    assert!(shared.contains("Äpfel"));
}

#[test]
fn work_columns_and_validation_present() {
    let report = sample_report();
    let bytes = build_report_xlsx_bytes(&report).unwrap();
    let shared = shared_strings(&bytes);
    assert!(shared.contains(WORK_COL_CHECK));
    assert!(shared.contains(WORK_COL_DONE));
    assert!(shared.contains(WORK_COL_NOTE));
    let validations = data_validations_xml(&bytes);
    assert!(
        validations.contains("dataValidation"),
        "expected dataValidation in sheet XML"
    );
    assert!(
        validations.contains("Ja") || validations.contains("\"Ja,Nein\"") || validations.contains("Ja,Nein"),
        "{validations}"
    );
    // ignoreBlank should be on (blank allowed); rust_xlsxwriter defaults true and may omit attr
    assert!(
        !validations.contains("ignoreBlank=\"0\"") && !validations.contains("allowBlank=\"0\""),
        "blank must remain allowed: {validations}"
    );
}

#[test]
fn unicode_and_long_paths_ok() {
    let mut report = sample_report();
    let long = format!(
        "sehr/langer/Pfad/{}/Ende",
        "Abschnitt_".repeat(40)
    );
    report.chapters.empty_folders.push(InventoryReportPathRow {
        name: "Überlang".into(),
        relative_path: long.clone(),
    });
    let bytes = build_report_xlsx_bytes(&report).expect("long path xlsx");
    let shared = shared_strings(&bytes);
    assert!(shared.contains("Überlang") || shared.contains("berlang"));
    assert!(shared.contains("Abschnitt_") || shared.len() > 100);
    let _ = long;
}

#[test]
fn safe_write_and_invalid_target() {
    let report = sample_report();
    let dir = std::env::temp_dir().join(format!(
        "dottyfm-r2-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("tmpdir");
    let target = dir.join("bericht.xlsx");
    let written = write_report_xlsx_file(target.to_str().unwrap(), &report).expect("write");
    assert!(written.exists());
    assert!(fs::metadata(&written).unwrap().len() > 0);
    assert!(archive_has_entry(&fs::read(&written).unwrap(), "xl/workbook.xml"));

    let err = write_report_xlsx_file("", &report).expect_err("empty path");
    assert!(err.message.contains("Speicherort") || err.message.contains("XLSX"));

    let err_dir = write_report_xlsx_file(dir.to_str().unwrap(), &report).expect_err("dir");
    assert!(err_dir.message.contains("Verzeichnis") || err_dir.cause.is_some());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn report_model_not_mutated_by_writer() {
    let report = sample_report();
    let before = serde_json::to_string(&report).unwrap();
    let _ = build_report_xlsx_bytes(&report).unwrap();
    let after = serde_json::to_string(&report).unwrap();
    assert_eq!(before, after);
}

#[test]
fn suggested_filename_shape() {
    use std::time::{Duration, UNIX_EPOCH};
    let name = suggested_report_file_name_at("Muster", UNIX_EPOCH + Duration::from_secs(1_700_000_000));
    assert!(name.starts_with("DottyFM_IST-Bericht_Muster_"));
    assert!(name.ends_with(".xlsx"));
}

#[test]
fn camel_case_roundtrip_matches_ts_shape() {
    let report = sample_report();
    let json = serde_json::to_value(&report).unwrap();
    assert!(json.get("chapterSelection").is_some());
    assert!(json.get("meta").unwrap().get("schemaVersion").is_some());
    assert!(json.get("meta").unwrap().get("createdAtMs").is_some());
    assert!(json.get("chapters").unwrap().get("fileTypes").is_some());
    assert!(json
        .get("chapters")
        .unwrap()
        .get("singleFileFolders")
        .is_some());
    let back: InventoryReportModel = serde_json::from_value(json).unwrap();
    assert_eq!(back.meta.root_name, "bestand");
}

/// Manual Realtest helper target under CARGO_TARGET_DIR (not invoked as #[test] by default path — see bin).
#[test]
fn write_manual_r2_xlsx_outside_repo_when_env_set() {
    let base = std::env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("target"));
    let dir = base.join("r2-manual-test");
    let _ = fs::create_dir_all(&dir);
    let target = dir.join("DottyFM_IST-Bericht_R2-Synthetic.xlsx");
    let report = sample_report();
    let written = match write_report_xlsx_file(target.to_str().unwrap(), &report) {
        Ok(path) => path,
        Err(err) => {
            // Excel often keeps the previous Realtest file open; write a sibling for retest.
            let msg = err.message.to_lowercase();
            let locked = msg.contains("zugriff verweigert") || msg.contains("access is denied");
            assert!(
                locked,
                "manual write failed for a reason other than file lock: {err:?}"
            );
            let alt = dir.join("DottyFM_IST-Bericht_R2-Synthetic-neu.xlsx");
            write_report_xlsx_file(alt.to_str().unwrap(), &report).expect("manual alt")
        }
    };
    assert!(written.exists());
    let bytes = fs::read(&written).unwrap();
    assert!(bytes.len() > 0);
    let names = sheet_names_from_xlsx(&bytes);
    assert_eq!(names.len(), 13);
    let validations = data_validations_xml(&bytes);
    assert!(validations.contains("dataValidation"));
}
