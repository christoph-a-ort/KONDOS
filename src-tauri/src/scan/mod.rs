mod config;
mod hidden;
mod sort;
mod walker;

#[cfg(test)]
mod scanner_tests;
#[cfg(test)]
mod perf_tests;

pub use walker::run;
