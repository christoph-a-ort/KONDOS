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
pub(crate) use reparse::must_not_follow;
pub(crate) use sort::cmp_name_then_path;
