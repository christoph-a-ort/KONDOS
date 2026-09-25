pub mod filename;
pub mod model;
pub mod pdf;
mod pdf_table;
pub mod persist;
pub mod xlsx;

#[cfg(test)]
mod tests;

pub use model::InventoryReportModel;
pub use persist::{write_report_pdf_file, write_report_xlsx_file};
