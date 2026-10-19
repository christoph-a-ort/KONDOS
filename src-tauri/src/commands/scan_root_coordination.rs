//! OS-backed, process-wide coordination only; independent of persistent reservations.
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;

use fs4::fs_std::FileExt;

use crate::error::AppError;

#[cfg(windows)]
const FILE_SHARE_READ: u32 = 0x0000_0001;
#[cfg(windows)]
const FILE_SHARE_WRITE: u32 = 0x0000_0002;

fn identity(root: &str) -> Result<String, AppError> {
    if root.is_empty() || root.contains('\0') {
        return Err(AppError::invalid_config("Ungültige Scanwurzel."));
    }
    let mut hash = 14_695_981_039_346_656_037u64;
    for byte in root.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    Ok(format!("{hash:016x}"))
}

pub fn coordination_lock_path(base: &Path, root: &str) -> Result<PathBuf, AppError> {
    Ok(base
        .join("scan-root-coordination")
        .join(format!("{}.lock", identity(root)?)))
}

pub struct ScanRootCoordination {
    _file: File,
}

#[cfg(any(test, feature = "lock-test-helper"))]
pub fn run_lock_test_helper() {
    use std::io::{self, BufRead, Write};

    let id = std::env::var("DOTTY_COORD_ID").expect("DOTTY_COORD_ID");
    let base = PathBuf::from(std::env::var("DOTTY_COORD_DIR").expect("DOTTY_COORD_DIR"));
    let root = std::env::var("DOTTY_COORD_ROOT").expect("DOTTY_COORD_ROOT");
    let emit = |status: &str| {
        let mut out = io::stdout().lock();
        writeln!(out, "{status}:{id}").expect("write helper status");
        out.flush().expect("flush helper status");
    };
    emit("READY");
    let mut guard = None;
    for line in io::stdin().lock().lines() {
        match line.expect("helper stdin").trim() {
            "ACQUIRE" => match acquire_at(&base, &root) {
                Ok(held) => {
                    guard = Some(held);
                    emit("LOCK_ACQUIRED");
                }
                Err(_) => emit("LOCK_DENIED"),
            },
            "RELEASE" => {
                drop(guard.take());
                emit("RELEASED");
                return;
            }
            "EXIT" => {
                drop(guard.take());
                emit("EXITED");
                return;
            }
            _ => {
                emit("ERROR");
                std::process::exit(2);
            }
        }
    }
}

pub fn acquire_at(base: &Path, root: &str) -> Result<ScanRootCoordination, AppError> {
    let dir = base.join("scan-root-coordination");
    fs::create_dir_all(&dir).map_err(|_| AppError::internal())?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)]
    options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    let file = options
        .open(coordination_lock_path(base, root)?)
        .map_err(|_| AppError::internal())?;
    match file.try_lock_exclusive() {
        Ok(true) => Ok(ScanRootCoordination { _file: file }),
        Ok(false) | Err(_) => {
            Err(AppError::invalid_config("Scanwurzel wird bereits koordiniert."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    const WAIT: Duration = Duration::from_secs(8);

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "dotty-coord-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn helper_command() -> Command {
        if let Ok(path) = std::env::var("CARGO_BIN_EXE_dotty_lock_test_helper") {
            return Command::new(path);
        }
        let mut command = Command::new(std::env::current_exe().expect("current test exe"));
        command.args([
            "--exact",
            "commands::scan_root_coordination::tests::coordination_process_helper",
            "--nocapture",
        ]);
        command.env("DOTTY_COORD_HELPER", "1");
        command
    }

    fn is_helper_status(line: &str) -> bool {
        ["READY", "LOCK_ACQUIRED", "LOCK_DENIED", "RELEASED", "EXITED", "ERROR"]
            .iter()
            .any(|status| line.starts_with(&format!("{status}:")))
    }

    struct ChildProcess {
        id: String,
        child: Child,
        stdin: ChildStdin,
        lines: Receiver<String>,
    }

    impl ChildProcess {
        fn spawn(id: &str, base: &Path, root: &str) -> Self {
            let mut child = helper_command()
                .env("DOTTY_COORD_ID", id)
                .env("DOTTY_COORD_DIR", base)
                .env("DOTTY_COORD_ROOT", root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn lock helper");
            let stdout = child.stdout.take().expect("helper stdout");
            let stdin = child.stdin.take().expect("helper stdin");
            let (tx, rx) = mpsc::channel();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
            Self {
                id: id.to_string(),
                child,
                stdin,
                lines: rx,
            }
        }

        fn wait_status(&mut self, status: &str) -> String {
            let expected = format!("{}:{}", status, self.id);
            let deadline = Instant::now() + WAIT;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    self.terminate();
                    panic!("{} timed out waiting for {expected}", self.id);
                }
                match self.lines.recv_timeout(remaining) {
                    Ok(line) if line == expected => return line,
                    Ok(line) if line.trim().is_empty() || !is_helper_status(&line) => continue,
                    Ok(line) => {
                        self.terminate();
                        panic!("{} received unexpected {line}, expected {expected}", self.id);
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        self.terminate();
                        panic!("{} timed out waiting for {expected}", self.id);
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        let _ = self.child.try_wait();
                        panic!("{} stdout closed while waiting for {expected}", self.id);
                    }
                }
            }
        }

        fn send(&mut self, command: &str) {
            writeln!(self.stdin, "{command}").unwrap();
            self.stdin.flush().unwrap();
        }

        fn wait_exit(&mut self) {
            let deadline = Instant::now() + WAIT;
            loop {
                if let Some(status) = self.child.try_wait().expect("wait helper") {
                    assert!(status.success(), "{} exited with {status}", self.id);
                    return;
                }
                if Instant::now() >= deadline {
                    self.terminate();
                    panic!("{} did not exit in time", self.id);
                }
                thread::yield_now();
            }
        }

        fn kill_now(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }

        fn terminate(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    impl Drop for ChildProcess {
        fn drop(&mut self) {
            if self.child.try_wait().ok().flatten().is_none() {
                self.terminate();
            }
        }
    }

    #[test]
    fn coordination_process_helper() {
        if std::env::var("DOTTY_COORD_HELPER").is_err() {
            return;
        }
        run_lock_test_helper();
    }

    #[cfg(windows)]
    #[test]
    fn held_coordination_file_cannot_be_renamed_or_deleted() {
        let dir = temp_dir();
        let guard = acquire_at(&dir, "C:/test").unwrap();
        let path = coordination_lock_path(&dir, "C:/test").unwrap();
        assert!(fs::rename(&path, path.with_extension("moved")).is_err());
        assert!(fs::remove_file(&path).is_err());
        assert!(path.exists());
        drop(guard);
        fs::remove_file(&path).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn independent_processes_serialize_scan_root_coordination() {
        let dir = temp_dir();
        let root = "C:/coord-exclusive";
        let mut first = ChildProcess::spawn("A", &dir, root);
        first.wait_status("READY");
        first.send("ACQUIRE");
        first.wait_status("LOCK_ACQUIRED");

        let mut second = ChildProcess::spawn("B", &dir, root);
        second.wait_status("READY");
        second.send("ACQUIRE");
        second.wait_status("LOCK_DENIED");
        second.send("EXIT");
        second.wait_status("EXITED");
        second.wait_exit();

        first.send("RELEASE");
        first.wait_status("RELEASED");
        first.wait_exit();

        let mut third = ChildProcess::spawn("C", &dir, root);
        third.wait_status("READY");
        third.send("ACQUIRE");
        third.wait_status("LOCK_ACQUIRED");
        third.send("RELEASE");
        third.wait_status("RELEASED");
        third.wait_exit();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn killed_holder_releases_os_lock_without_deleting_file() {
        let dir = temp_dir();
        let root = "C:/coord-crash";
        let path = coordination_lock_path(&dir, root).unwrap();
        let mut holder = ChildProcess::spawn("A", &dir, root);
        holder.wait_status("READY");
        holder.send("ACQUIRE");
        holder.wait_status("LOCK_ACQUIRED");
        assert!(path.is_file(), "coordination file must exist while held");
        holder.kill_now();
        assert!(
            path.is_file(),
            "coordination file must survive forced process end"
        );

        let mut successor = ChildProcess::spawn("B", &dir, root);
        successor.wait_status("READY");
        successor.send("ACQUIRE");
        successor.wait_status("LOCK_ACQUIRED");
        successor.send("RELEASE");
        successor.wait_status("RELEASED");
        successor.wait_exit();
        assert!(path.is_file());
        let _ = fs::remove_dir_all(dir);
    }
}
