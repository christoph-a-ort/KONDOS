mod csv;
mod filename;
mod json;
mod meta;
mod node;
mod paths;
mod persist;
mod txt;

use std::io::{self, Write};

use crate::model::{ExportFormat, ScanResult};

pub use filename::suggested_export_file_name;
pub use node::node_name;
pub use persist::write_export_file;

use meta::meta_flags_from_root;
pub(crate) use meta::ExportMetaFlags;

pub fn write_export<W: Write>(
    writer: &mut W,
    format: ExportFormat,
    result: &ScanResult,
    txt_columns: Option<ExportMetaFlags>,
) -> io::Result<()> {
    let data_flags = meta_flags_from_root(&result.root);
    match format {
        ExportFormat::Txt => txt::write_txt(writer, result, txt_columns.unwrap_or(data_flags)),
        ExportFormat::Csv => csv::write_csv(writer, result, data_flags),
        ExportFormat::Json => json::write_json(writer, result, data_flags),
    }
}

pub fn render_export(format: ExportFormat, result: &ScanResult) -> Result<String, io::Error> {
    render_export_with_txt_columns(format, result, None)
}

pub(crate) fn render_export_with_txt_columns(
    format: ExportFormat,
    result: &ScanResult,
    txt_columns: Option<ExportMetaFlags>,
) -> Result<String, io::Error> {
    let mut buffer = Vec::new();
    write_export(&mut buffer, format, result, txt_columns)?;
    String::from_utf8(buffer).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

#[cfg(test)]
mod tests;
