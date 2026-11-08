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
pub(crate) use reparse::{
    attributes_are_recall_on_data_access, handle_attributes, handle_has_blocking_reparse,
    must_not_follow_with_path, path_has_blocking_reparse,
};
pub(crate) use sort::cmp_name_then_path;
