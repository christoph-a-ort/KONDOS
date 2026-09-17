mod classify;
mod config;
mod hidden;
mod reparse;
mod sort;
mod walker;

#[cfg(test)]
mod scanner_tests;
#[cfg(test)]
mod perf_tests;

pub use classify::{classify_root, RootKind};
pub use walker::run;
