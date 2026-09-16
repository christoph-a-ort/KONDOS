//! Performance-Test für ~100.000 Dateisystemelemente.
//!
//! Nicht Teil der regulären Suite. Gezielt ausführen:
//!
//! ```text
//! cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture perf_scan_approximately_100k_entries
//! ```
//!
//! Die Testdaten liegen nur temporär unter dem System-Temp-Verzeichnis.
//! Gemessen wird ausschließlich `scan::run`, nicht die Erzeugung der Struktur.

use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::model::{ScanConfig, DEFAULT_DEPTH};
use crate::scan::run;

const DIR_COUNT: u32 = 100;
const FILES_PER_DIR: u32 = 999;

#[test]
#[ignore]
fn perf_scan_approximately_100k_entries() {
    let root = std::env::temp_dir().join(format!(
        "kondos-perf-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&root).expect("perf root");

    let created = build_tree(&root);
    let config = ScanConfig {
        root_path: root.to_string_lossy().into_owned(),
        max_depth: DEFAULT_DEPTH,
        exclude_hidden: false,
        extensions: vec![],
        include_size: false,
        include_created_at: false,
        include_modified_at: false,
    };

    let started = Instant::now();
    let result = run(config, &AtomicBool::new(false), |_| {});
    let scan_ms = started.elapsed().as_millis();
    let _ = fs::remove_dir_all(&root);

    let result = result.expect("scan");
    let scanned = result.stats.directory_count + result.stats.file_count;
    println!("kondos performance");
    println!("os={}", std::env::consts::OS);
    println!("arch={}", std::env::consts::ARCH);
    println!("created_entries={created}");
    println!("scanned_entries={scanned}");
    println!("files={}", result.stats.file_count);
    println!("directories={}", result.stats.directory_count);
    println!("scan_ms={scan_ms}");
    println!("scan_duration_ms_stat={}", result.stats.duration_ms);

    assert!(
        scanned >= 100_000,
        "expected about 100000 scanned entries, got {scanned}"
    );
}

fn build_tree(root: &Path) -> u64 {
    let mut created = 1;
    for dir_index in 0..DIR_COUNT {
        let dir = root.join(format!("d{dir_index:03}"));
        fs::create_dir(&dir).expect("perf dir");
        created += 1;
        for file_index in 0..FILES_PER_DIR {
            fs::write(dir.join(format!("f{file_index:04}.txt")), b"x").expect("perf file");
            created += 1;
        }
    }
    created
}
