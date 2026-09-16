//! Performance-Messungen (P0-D2). Nicht Teil der regulären Suite.
//!
//! Gezielt ausführen:
//!
//! ```text
//! cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture perf_scan_approximately_100k_entries
//! cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture perf_scan_approximately_100k_entries
//! cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture perf_natural_sort_wide_folder
//! ```
//!
//! Die 100k-Testdaten liegen nur temporär unter dem System-Temp-Verzeichnis.
//! Gemessen wird ausschließlich `scan::run`, nicht Erzeugung, Cleanup oder JSON-Serialisierung.

use std::cmp::Ordering;
use std::fs;
use std::hint::black_box;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::model::{FsNode, ScanConfig, ScanProgress, ScanStatus, DEFAULT_DEPTH};
use crate::scan::run;

use super::sort::sort_children;

const DIR_COUNT: u32 = 100;
const FILES_PER_DIR: u32 = 999;
const SCAN_RUNS: u32 = 2;
const SORT_RUNS: usize = 5;
const SORT_B1: usize = 1_000;
const SORT_B2: usize = 100_000;

struct ProgressProbe {
    count: AtomicU64,
    running: AtomicU64,
    completed: AtomicU64,
    cancelled: AtomicU64,
    failed: AtomicU64,
    first_processed: AtomicU64,
    last_processed: AtomicU64,
    first_path: Mutex<String>,
    last_path: Mutex<String>,
}

impl ProgressProbe {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            running: AtomicU64::new(0),
            completed: AtomicU64::new(0),
            cancelled: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            first_processed: AtomicU64::new(0),
            last_processed: AtomicU64::new(0),
            first_path: Mutex::new(String::new()),
            last_path: Mutex::new(String::new()),
        }
    }

    fn observe(&self, progress: ScanProgress) {
        let n = self.count.fetch_add(1, AtomicOrdering::Relaxed);
        match progress.status {
            ScanStatus::Running => {
                self.running.fetch_add(1, AtomicOrdering::Relaxed);
            }
            ScanStatus::Completed => {
                self.completed.fetch_add(1, AtomicOrdering::Relaxed);
            }
            ScanStatus::Cancelled => {
                self.cancelled.fetch_add(1, AtomicOrdering::Relaxed);
            }
            ScanStatus::Failed => {
                self.failed.fetch_add(1, AtomicOrdering::Relaxed);
            }
        }
        self.last_processed
            .store(progress.processed_count, AtomicOrdering::Relaxed);
        if let Ok(mut last_path) = self.last_path.lock() {
            *last_path = progress.current_path.clone();
        }
        if n == 0 {
            self.first_processed
                .store(progress.processed_count, AtomicOrdering::Relaxed);
            if let Ok(mut first_path) = self.first_path.lock() {
                *first_path = progress.current_path;
            }
        }
    }
}

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

    println!("building_tree...");
    let _ = io::stdout().flush();
    let created = build_tree(&root);
    println!("tree_ready");
    let _ = io::stdout().flush();
    let config = ScanConfig {
        root_path: root.to_string_lossy().into_owned(),
        max_depth: DEFAULT_DEPTH,
        exclude_hidden: false,
        extensions: vec![],
        include_size: false,
        include_created_at: false,
        include_modified_at: false,
    };

    println!("kondos performance");
    println!(
        "build_profile={}",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );
    println!("os={}", std::env::consts::OS);
    println!("arch={}", std::env::consts::ARCH);
    println!("temp_root={}", root.display());
    println!("created_entries={created}");
    println!("scan_runs={SCAN_RUNS}");
    println!("tree_build_outside_timer=yes");
    println!("cleanup_outside_timer=yes");
    println!("serialize_outside_scan_timer=yes");

    let mut last_result = None;
    for run_index in 1..=SCAN_RUNS {
        let probe = ProgressProbe::new();
        let started = Instant::now();
        let result = run(config.clone(), &std::sync::atomic::AtomicBool::new(false), 1, |progress| {
            probe.observe(progress);
        });
        let scan_ms = started.elapsed().as_millis();

        match result {
            Ok(result) => {
                let scanned = result.stats.directory_count + result.stats.file_count;
                let callbacks = probe.count.load(AtomicOrdering::Relaxed);
                let wall_minus_stat = scan_ms.saturating_sub(result.stats.duration_ms as u128);
                let callbacks_per_1000 = if scanned == 0 {
                    0.0
                } else {
                    (callbacks as f64) * 1000.0 / (scanned as f64)
                };
                let callbacks_per_sec = if scan_ms == 0 {
                    0.0
                } else {
                    (callbacks as f64) * 1000.0 / (scan_ms as f64)
                };
                println!("--- run {run_index} ---");
                println!("scan_ok=yes");
                println!("crash=no");
                println!("scanned_entries={scanned}");
                println!("files={}", result.stats.file_count);
                println!("directories={}", result.stats.directory_count);
                println!("warnings={}", result.warnings.len());
                println!("scan_ms={scan_ms}");
                println!("scan_duration_ms_stat={}", result.stats.duration_ms);
                println!("wall_minus_stat_ms={wall_minus_stat}");
                println!("progress_callbacks={callbacks}");
                println!("progress_running={}", probe.running.load(AtomicOrdering::Relaxed));
                println!(
                    "progress_completed={}",
                    probe.completed.load(AtomicOrdering::Relaxed)
                );
                println!(
                    "progress_cancelled={}",
                    probe.cancelled.load(AtomicOrdering::Relaxed)
                );
                println!("progress_failed={}", probe.failed.load(AtomicOrdering::Relaxed));
                println!(
                    "progress_first_processed={}",
                    probe.first_processed.load(AtomicOrdering::Relaxed)
                );
                println!(
                    "progress_last_processed={}",
                    probe.last_processed.load(AtomicOrdering::Relaxed)
                );
                println!(
                    "progress_first_path={}",
                    probe.first_path.lock().map(|s| s.clone()).unwrap_or_default()
                );
                println!(
                    "progress_last_path={}",
                    probe.last_path.lock().map(|s| s.clone()).unwrap_or_default()
                );
                println!("progress_callbacks_per_1000_nodes={callbacks_per_1000:.3}");
                println!("progress_callbacks_per_sec={callbacks_per_sec:.3}");
                last_result = Some(result);
            }
            Err(err) => {
                let _ = fs::remove_dir_all(&root);
                panic!("scan failed: {err:?} scan_ms={scan_ms}");
            }
        }
    }

    let _ = fs::remove_dir_all(&root);

    let result = last_result.expect("scan result");
    let scanned = result.stats.directory_count + result.stats.file_count;
    let serialize_started = Instant::now();
    let json = serde_json::to_vec(&result).expect("serialize ScanResult");
    let serialize_ms = serialize_started.elapsed().as_millis();
    let bytes = json.len();
    let mib = (bytes as f64) / (1024.0 * 1024.0);
    let bytes_per_node = if scanned == 0 {
        0.0
    } else {
        (bytes as f64) / (scanned as f64)
    };

    println!("--- serialize ---");
    println!("json_bytes={bytes}");
    println!("json_mib={mib:.3}");
    println!("json_bytes_per_node={bytes_per_node:.3}");
    println!("serialize_ms={serialize_ms}");

    assert!(
        scanned >= 100_000,
        "expected about 100000 scanned entries, got {scanned}"
    );
}

#[test]
#[ignore]
fn perf_natural_sort_wide_folder() {
    println!("kondos natural-sort performance");
    println!(
        "build_profile={}",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );
    measure_natural_sort("B1", SORT_B1);
    measure_natural_sort("B2", SORT_B2);
}

fn measure_natural_sort(label: &str, n: usize) {
    let unsorted = shuffled_files(n);
    let mut times_ms = Vec::with_capacity(SORT_RUNS);
    let mut all_correct = true;

    for run_index in 1..=SORT_RUNS {
        let mut children = black_box(unsorted.clone());
        let started = Instant::now();
        sort_children(&mut children);
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        black_box(&children);
        let correct = is_natural_file_sequence(&children, n);
        all_correct &= correct;
        times_ms.push(elapsed_ms);
        println!(
            "sort_profile={label} n={n} run={run_index} ms={elapsed_ms:.3} correct={}",
            if correct { "yes" } else { "no" }
        );
    }

    let median = median_f64(&times_ms);
    println!(
        "sort_profile={label} n={n} runs={SORT_RUNS} median_ms={median:.3} correct={}",
        if all_correct { "yes" } else { "no" }
    );
    assert!(all_correct, "{label}: natural sort order incorrect");
}

fn shuffled_files(n: usize) -> Vec<FsNode> {
    let mut names: Vec<String> = (1..=n).map(|index| format!("file{index}.txt")).collect();
    lcg_shuffle(&mut names);
    names
        .into_iter()
        .map(|name| FsNode::File {
            id: name.clone(),
            name: name.clone(),
            path: format!("/tmp/wide/{name}"),
            depth: 1,
            size_bytes: None,
            created_at_ms: None,
            modified_at_ms: None,
        })
        .collect()
}

fn lcg_shuffle(values: &mut [String]) {
    let mut state: u64 = 0xC0FFEE_u64.wrapping_add(values.len() as u64);
    for i in (1..values.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        let j = (state as usize) % (i + 1);
        values.swap(i, j);
    }
}

fn is_natural_file_sequence(nodes: &[FsNode], n: usize) -> bool {
    if nodes.len() != n {
        return false;
    }
    nodes.iter().enumerate().all(|(index, node)| {
        let expected = (index + 1) as u32;
        file_number(node) == expected
    })
}

fn file_number(node: &FsNode) -> u32 {
    let name = match node {
        FsNode::File { name, .. } | FsNode::Directory { name, .. } => name,
    };
    name.trim_start_matches("file")
        .trim_end_matches(".txt")
        .parse::<u32>()
        .unwrap_or(0)
}

fn median_f64(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
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
