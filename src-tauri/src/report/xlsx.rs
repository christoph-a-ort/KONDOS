//! IST-Bericht XLSX writer. Render-only — no filesystem analysis.

use rust_xlsxwriter::{
    ColNum, DataValidation, Format, FormatAlign, Workbook, Worksheet, XlsxError,
};

use super::model::{
    InventoryReportChapterSelection, InventoryReportModel,
};

pub const SHEET_OVERVIEW: &str = "Übersicht";
pub const SHEET_FILE_TYPES: &str = "Dateitypen";
pub const SHEET_FOLDERS: &str = "Ordner";
pub const SHEET_EMPTY_FOLDERS: &str = "Leere Ordner";
pub const SHEET_SINGLE_FILE: &str = "Ein-Datei-Ordner";
pub const SHEET_UNREADABLE: &str = "Nicht prüfbar";
pub const SHEET_REPEATED_FOLDERS: &str = "Wiederkehrende Ordnernamen";
pub const SHEET_REPEATED_FILES: &str = "Wiederkehrende Dateinamen";
pub const SHEET_YEAR_STRUCTURES: &str = "Jahresstrukturen";
pub const SHEET_FILE_NAME_PATTERNS: &str = "Muster Dateinamen";
pub const SHEET_SAME_STEMS: &str = "Gleiche Dateistämme";
pub const SHEET_EXACT_NAMES: &str = "Exakte Dateinamensstrukturen";
pub const SHEET_EXTENSIONS: &str = "Endungsverteilungen";

pub const WORK_COL_CHECK: &str = "Prüfen";
pub const WORK_COL_DONE: &str = "Erledigt";
pub const WORK_COL_NOTE: &str = "Notiz";

const JA_NEIN: &[&str] = &["Ja", "Nein"];

#[derive(Debug)]
pub struct ReportXlsxError(String);

impl std::fmt::Display for ReportXlsxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<XlsxError> for ReportXlsxError {
    fn from(value: XlsxError) -> Self {
        Self(value.to_string())
    }
}

/// Build workbook bytes for the given report (chapterSelection respected).
pub fn build_report_xlsx_bytes(report: &InventoryReportModel) -> Result<Vec<u8>, ReportXlsxError> {
    let mut workbook = Workbook::new();
    let header = header_format();
    let wrap = wrap_format();
    let title = title_format();

    let sel = &report.chapter_selection;

    if sel.overview {
        write_overview(&mut workbook, report, &title, &wrap)?;
    }
    if sel.file_types {
        write_file_types(&mut workbook, report, &header, &wrap)?;
    }
    if sel.folders {
        write_folders(&mut workbook, report, &header, &wrap)?;
    }
    if sel.empty_folders {
        write_empty_folders(&mut workbook, report, &header, &wrap)?;
    }
    if sel.single_file_folders {
        write_single_file_folders(&mut workbook, report, &header, &wrap)?;
    }
    if sel.unreadable {
        write_unreadable(&mut workbook, report, &header, &wrap)?;
    }
    if sel.repeated_folder_names {
        write_repeated_folder_names(&mut workbook, report, &header, &wrap)?;
    }
    if sel.repeated_file_names {
        write_repeated_file_names(&mut workbook, report, &header, &wrap)?;
    }
    if sel.year_structures {
        write_year_structures(&mut workbook, report, &header, &wrap)?;
    }
    if sel.file_name_patterns {
        write_file_name_patterns(&mut workbook, report, &header, &wrap)?;
    }
    if sel.same_file_stems {
        write_same_file_stems(&mut workbook, report, &header, &wrap)?;
    }
    if sel.exact_file_name_structures {
        write_exact_name_structures(&mut workbook, report, &header, &wrap)?;
    }
    if sel.extension_distributions {
        write_extension_distributions(&mut workbook, report, &header, &wrap)?;
    }

    // Ensure at least one sheet exists (Excel requires it).
    if workbook.worksheets().is_empty() {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Leer")?;
        sheet.write_string(0, 0, "Keine Kapitel ausgewählt.")?;
    }

    Ok(workbook.save_to_buffer()?)
}

pub fn expected_sheet_names(sel: &InventoryReportChapterSelection) -> Vec<&'static str> {
    let mut names = Vec::new();
    if sel.overview {
        names.push(SHEET_OVERVIEW);
    }
    if sel.file_types {
        names.push(SHEET_FILE_TYPES);
    }
    if sel.folders {
        names.push(SHEET_FOLDERS);
    }
    if sel.empty_folders {
        names.push(SHEET_EMPTY_FOLDERS);
    }
    if sel.single_file_folders {
        names.push(SHEET_SINGLE_FILE);
    }
    if sel.unreadable {
        names.push(SHEET_UNREADABLE);
    }
    if sel.repeated_folder_names {
        names.push(SHEET_REPEATED_FOLDERS);
    }
    if sel.repeated_file_names {
        names.push(SHEET_REPEATED_FILES);
    }
    if sel.year_structures {
        names.push(SHEET_YEAR_STRUCTURES);
    }
    if sel.file_name_patterns {
        names.push(SHEET_FILE_NAME_PATTERNS);
    }
    if sel.same_file_stems {
        names.push(SHEET_SAME_STEMS);
    }
    if sel.exact_file_name_structures {
        names.push(SHEET_EXACT_NAMES);
    }
    if sel.extension_distributions {
        names.push(SHEET_EXTENSIONS);
    }
    names
}

fn header_format() -> Format {
    Format::new().set_bold()
}

fn title_format() -> Format {
    Format::new().set_bold().set_font_size(14)
}

fn wrap_format() -> Format {
    Format::new()
        .set_align(FormatAlign::Top)
        .set_text_wrap()
}

/// Rough Excel row height for wrapped text in a column of the given character width.
/// Intentionally simple: no pixel/font measurement, only for interpretation notes.
fn wrapped_text_row_height(text: &str, column_width_chars: f64) -> f64 {
    const LINE_PT: f64 = 15.0;
    const PADDING_PT: f64 = 8.0;
    const MIN_PT: f64 = 36.0;
    const MAX_PT: f64 = 220.0;
    // Slightly under the set width so umlauts / padding do not underestimate lines.
    let usable = (column_width_chars * 0.9).max(8.0);
    let mut lines = 0.0_f64;
    for paragraph in text.split('\n') {
        let len = paragraph.chars().count().max(1) as f64;
        lines += (len / usable).ceil().max(1.0);
    }
    if lines <= 0.0 {
        lines = 1.0;
    }
    (lines * LINE_PT + PADDING_PT).clamp(MIN_PT, MAX_PT)
}

fn write_overview(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    title: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_OVERVIEW)?;
    sheet.set_column_width(0, 36)?;
    sheet.set_column_width(1, 72)?;

    let meta = &report.meta;
    let overview = &report.chapters.overview;
    let mut row: u32 = 0;

    sheet.write_string_with_format(row, 0, "DottyFM – IST-Bericht", title)?;
    row += 2;

    row = write_kv(sheet, row, "Schema-Version", &meta.schema_version.to_string(), wrap)?;
    row = write_kv(
        sheet,
        row,
        "Erstellt",
        &format_created_at(meta.created_at_ms),
        wrap,
    )?;
    row = write_kv(sheet, row, "Startordner", &meta.root_path, wrap)?;
    row = write_kv(sheet, row, "Root-Name", &meta.root_name, wrap)?;
    let max_depth = meta
        .max_depth
        .map(|d| d.to_string())
        .unwrap_or_else(|| "—".to_string());
    row = write_kv(sheet, row, "Maximale Einlesetiefe", &max_depth, wrap)?;
    row = write_kv(
        sheet,
        row,
        "Maximal beobachtete Tiefe",
        &meta.max_observed_depth.to_string(),
        wrap,
    )?;
    let scan_id = meta
        .scan_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "—".to_string());
    row = write_kv(sheet, row, "Scan-ID", &scan_id, wrap)?;
    row += 1;

    sheet.write_string_with_format(row, 0, "Bestandskennzahlen", title)?;
    row += 1;
    row = write_kv_num(sheet, row, "Ordner", overview.directory_count, wrap)?;
    row = write_kv_num(sheet, row, "Dateien", overview.file_count, wrap)?;
    row = write_kv_num(sheet, row, "Bekannte Größe (Bytes)", overview.known_size_bytes, wrap)?;
    row = write_kv_num(
        sheet,
        row,
        "Dateien ohne bekannte Größe",
        overview.files_without_known_size,
        wrap,
    )?;
    row = write_kv_num(
        sheet,
        row,
        "Tiefenbegrenzte Ordner",
        overview.depth_limited_folder_count,
        wrap,
    )?;
    row = write_kv_num(sheet, row, "Unterordner", overview.subdirectory_count, wrap)?;
    row += 1;

    if report.chapter_selection.interpretation {
        sheet.write_string_with_format(row, 0, "Hinweise zur Interpretation", title)?;
        row += 1;
        // Notes live in column A (width 36). Fixed height clipped wrapped lines;
        // estimate height from text length only for these interpretation rows.
        const NOTE_COL_WIDTH: f64 = 36.0;
        for note in &report.chapters.interpretation.notes {
            sheet.write_string_with_format(row, 0, note, wrap)?;
            sheet.set_row_height(row, wrapped_text_row_height(note, NOTE_COL_WIDTH))?;
            row += 1;
        }
    }

    let _ = row;
    Ok(())
}

fn write_kv(
    sheet: &mut Worksheet,
    row: u32,
    key: &str,
    value: &str,
    wrap: &Format,
) -> Result<u32, ReportXlsxError> {
    sheet.write_string(row, 0, key)?;
    sheet.write_string_with_format(row, 1, value, wrap)?;
    Ok(row + 1)
}

fn write_kv_num(
    sheet: &mut Worksheet,
    row: u32,
    key: &str,
    value: u64,
    wrap: &Format,
) -> Result<u32, ReportXlsxError> {
    sheet.write_string(row, 0, key)?;
    sheet.write_number_with_format(row, 1, value as f64, wrap)?;
    Ok(row + 1)
}

fn format_created_at(ms: i64) -> String {
    if ms <= 0 {
        return "—".to_string();
    }
    let secs = ms / 1000;
    // Reuse filename local formatter path via UTC fallback for overview readability.
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    let (year, month, day) = civil_from_days(days + 719_468);
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02} UTC")
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn write_headers(
    sheet: &mut Worksheet,
    headers: &[&str],
    header: &Format,
) -> Result<(), ReportXlsxError> {
    for (col, text) in headers.iter().enumerate() {
        sheet.write_string_with_format(0, col as ColNum, *text, header)?;
    }
    Ok(())
}

fn finish_table(
    sheet: &mut Worksheet,
    last_col: ColNum,
    data_rows: u32,
    work_cols: Option<(ColNum, ColNum)>,
) -> Result<(), ReportXlsxError> {
    sheet.set_freeze_panes(1, 0)?;
    let last_row = if data_rows == 0 { 0 } else { data_rows };
    sheet.autofilter(0, 0, last_row, last_col)?;
    if let Some((check_col, done_col)) = work_cols {
        if data_rows >= 1 {
            let dv = DataValidation::new()
                .allow_list_strings(JA_NEIN)?
                .ignore_blank(true);
            sheet.add_data_validation(1, check_col, data_rows, check_col, &dv)?;
            sheet.add_data_validation(1, done_col, data_rows, done_col, &dv)?;
        }
    }
    Ok(())
}

fn set_path_widths(sheet: &mut Worksheet, cols: &[ColNum]) -> Result<(), ReportXlsxError> {
    for &col in cols {
        sheet.set_column_width(col, 48)?;
    }
    Ok(())
}

fn write_file_types(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_FILE_TYPES)?;
    let headers = ["Endung", "Bezeichnung", "Anzahl", "Größe (Bytes)"];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 14)?;
    sheet.set_column_width(1, 28)?;
    sheet.set_column_width(2, 12)?;
    sheet.set_column_width(3, 18)?;

    for (i, row) in report.chapters.file_types.iter().enumerate() {
        let r = (i + 1) as u32;
        sheet.write_string_with_format(r, 0, &row.extension, wrap)?;
        sheet.write_string_with_format(r, 1, &row.label, wrap)?;
        sheet.write_number(r, 2, row.file_count as f64)?;
        sheet.write_number(r, 3, row.known_size_bytes as f64)?;
    }
    finish_table(sheet, 3, report.chapters.file_types.len() as u32, None)?;
    Ok(())
}

fn write_folders(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_FOLDERS)?;
    let headers = [
        "Name",
        "Relativer Pfad",
        "Tiefe",
        "Listing",
        "Direkte Dateien",
        "Direkte Unterordner",
        "Direkte Größe (Bytes)",
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 24)?;
    set_path_widths(sheet, &[1])?;
    for col in 2..=6u16 {
        sheet.set_column_width(col, 16)?;
    }

    for (i, row) in report.chapters.folders.iter().enumerate() {
        let r = (i + 1) as u32;
        sheet.write_string_with_format(r, 0, &row.name, wrap)?;
        sheet.write_string_with_format(r, 1, &row.relative_path, wrap)?;
        sheet.write_number(r, 2, row.depth as f64)?;
        sheet.write_string(r, 3, &row.listing)?;
        sheet.write_number(r, 4, row.direct_file_count as f64)?;
        sheet.write_number(r, 5, row.direct_directory_count as f64)?;
        sheet.write_number(r, 6, row.direct_known_size_bytes as f64)?;
    }
    finish_table(sheet, 6, report.chapters.folders.len() as u32, None)?;
    Ok(())
}

fn write_empty_folders(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_EMPTY_FOLDERS)?;
    let headers = ["Name", "Relativer Pfad", WORK_COL_CHECK, WORK_COL_DONE, WORK_COL_NOTE];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 24)?;
    set_path_widths(sheet, &[1])?;
    sheet.set_column_width(2, 12)?;
    sheet.set_column_width(3, 12)?;
    sheet.set_column_width(4, 36)?;

    let rows = &report.chapters.empty_folders;
    for (i, row) in rows.iter().enumerate() {
        let r = (i + 1) as u32;
        sheet.write_string_with_format(r, 0, &row.name, wrap)?;
        sheet.write_string_with_format(r, 1, &row.relative_path, wrap)?;
        // Prüfen / Erledigt / Notiz left blank intentionally
    }
    finish_table(sheet, 4, rows.len() as u32, Some((2, 3)))?;
    Ok(())
}

fn write_single_file_folders(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_SINGLE_FILE)?;
    let headers = [
        "Ordnername",
        "Relativer Pfad",
        "Dateiname",
        "Dateityp",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 20)?;
    set_path_widths(sheet, &[1])?;
    sheet.set_column_width(2, 28)?;
    sheet.set_column_width(3, 12)?;
    sheet.set_column_width(4, 12)?;
    sheet.set_column_width(5, 12)?;
    sheet.set_column_width(6, 36)?;

    let rows = &report.chapters.single_file_folders;
    for (i, row) in rows.iter().enumerate() {
        let r = (i + 1) as u32;
        sheet.write_string_with_format(r, 0, &row.folder_name, wrap)?;
        sheet.write_string_with_format(r, 1, &row.relative_path, wrap)?;
        sheet.write_string_with_format(r, 2, &row.file_name, wrap)?;
        sheet.write_string(r, 3, &row.extension)?;
    }
    finish_table(sheet, 6, rows.len() as u32, Some((4, 5)))?;
    Ok(())
}

fn write_unreadable(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_UNREADABLE)?;
    let headers = [
        "Kategorie",
        "Relativer Pfad",
        "Code",
        "Hinweis",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 28)?;
    set_path_widths(sheet, &[1])?;
    sheet.set_column_width(2, 16)?;
    sheet.set_column_width(3, 40)?;
    sheet.set_column_width(4, 12)?;
    sheet.set_column_width(5, 12)?;
    sheet.set_column_width(6, 36)?;

    let mut row_idx: u32 = 1;
    for warning in &report.chapters.unreadable.warnings {
        sheet.write_string(row_idx, 0, "Warnung")?;
        sheet.write_string_with_format(row_idx, 1, &warning.relative_path, wrap)?;
        sheet.write_string(row_idx, 2, &warning.code)?;
        sheet.write_string_with_format(row_idx, 3, &warning.message, wrap)?;
        row_idx += 1;
    }
    for folder in &report.chapters.unreadable.unconfirmed_empty_looking_folders {
        sheet.write_string(row_idx, 0, "Unbestätigt leer wirkend")?;
        sheet.write_string_with_format(row_idx, 1, &folder.relative_path, wrap)?;
        sheet.write_string(row_idx, 2, "")?;
        sheet.write_string_with_format(row_idx, 3, &folder.name, wrap)?;
        row_idx += 1;
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 6, data_rows, Some((4, 5)))?;
    Ok(())
}

fn write_repeated_folder_names(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_REPEATED_FOLDERS)?;
    let headers = [
        "Ordnername",
        "Anzahl Vorkommen",
        "Vorkommenspfad",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 24)?;
    sheet.set_column_width(1, 16)?;
    set_path_widths(sheet, &[2])?;
    sheet.set_column_width(3, 12)?;
    sheet.set_column_width(4, 12)?;
    sheet.set_column_width(5, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.repeated_folder_names {
        for path in &group.relative_paths {
            sheet.write_string_with_format(row_idx, 0, &group.name, wrap)?;
            sheet.write_number(row_idx, 1, group.count as f64)?;
            sheet.write_string_with_format(row_idx, 2, path, wrap)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 5, data_rows, Some((3, 4)))?;
    Ok(())
}

fn write_repeated_file_names(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_REPEATED_FILES)?;
    let headers = [
        "Dateiname",
        "Anzahl Vorkommen",
        "Vorkommenspfad",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 28)?;
    sheet.set_column_width(1, 16)?;
    set_path_widths(sheet, &[2])?;
    sheet.set_column_width(3, 12)?;
    sheet.set_column_width(4, 12)?;
    sheet.set_column_width(5, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.repeated_file_names {
        for path in &group.relative_paths {
            sheet.write_string_with_format(row_idx, 0, &group.name, wrap)?;
            sheet.write_number(row_idx, 1, group.count as f64)?;
            sheet.write_string_with_format(row_idx, 2, path, wrap)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 5, data_rows, Some((3, 4)))?;
    Ok(())
}

fn write_year_structures(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_YEAR_STRUCTURES)?;
    let headers = [
        "Elternpfad",
        "Elternname",
        "Jahr",
        "Jahresordner-Pfad",
        "Jahresordner-Name",
        "MinJahr",
        "MaxJahr",
        "Fehlende Jahre",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    set_path_widths(sheet, &[0, 3])?;
    sheet.set_column_width(1, 18)?;
    sheet.set_column_width(2, 10)?;
    sheet.set_column_width(4, 16)?;
    sheet.set_column_width(5, 10)?;
    sheet.set_column_width(6, 10)?;
    sheet.set_column_width(7, 24)?;
    sheet.set_column_width(8, 12)?;
    sheet.set_column_width(9, 12)?;
    sheet.set_column_width(10, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.year_structures {
        let missing = group
            .missing_years
            .iter()
            .map(|y| y.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        for folder in &group.year_folders {
            sheet.write_string_with_format(row_idx, 0, &group.parent_relative_path, wrap)?;
            sheet.write_string_with_format(row_idx, 1, &group.parent_name, wrap)?;
            sheet.write_number(row_idx, 2, folder.year as f64)?;
            sheet.write_string_with_format(row_idx, 3, &folder.relative_path, wrap)?;
            sheet.write_string(row_idx, 4, &folder.name)?;
            sheet.write_number(row_idx, 5, group.min_year as f64)?;
            sheet.write_number(row_idx, 6, group.max_year as f64)?;
            sheet.write_string_with_format(row_idx, 7, &missing, wrap)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 10, data_rows, Some((8, 9)))?;
    Ok(())
}

fn write_file_name_patterns(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_FILE_NAME_PATTERNS)?;
    let headers = ["Kennzahl", "Wert"];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 40)?;
    sheet.set_column_width(1, 48)?;

    let p = &report.chapters.file_name_patterns;
    let mut row: u32 = 1;
    let stats: [(&str, u64); 5] = [
        ("Analysierte Dateien", p.analyzed_file_count),
        ("Mit Ziffern", p.files_with_digits),
        ("Mit führenden Ziffern", p.files_with_leading_digits),
        ("Erkannte Datumsformen", p.files_with_recognized_date_forms),
        ("Sechsstellige Zahlenfolgen", p.files_with_six_digit_blocks),
    ];
    for (label, value) in stats {
        sheet.write_string(row, 0, label)?;
        sheet.write_number(row, 1, value as f64)?;
        row += 1;
    }
    row += 1;
    sheet.write_string_with_format(row, 0, "Datumsformen", header)?;
    row += 1;
    for group in &p.date_form_groups {
        sheet.write_string_with_format(row, 0, &group.label, wrap)?;
        sheet.write_number(row, 1, group.match_count as f64)?;
        row += 1;
    }
    row += 1;
    sheet.write_string_with_format(row, 0, "Hinweis Datumsformen", wrap)?;
    sheet.write_string_with_format(row, 1, &p.date_forms_hint, wrap)?;
    row += 1;
    sheet.write_string_with_format(row, 0, "Hinweis sechsstellige Zahlen", wrap)?;
    sheet.write_string_with_format(row, 1, &p.six_digit_hint, wrap)?;

    sheet.set_freeze_panes(1, 0)?;
    sheet.autofilter(0, 0, row, 1)?;
    Ok(())
}

fn write_same_file_stems(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_SAME_STEMS)?;
    let headers = [
        "Dateistamm",
        "Anzahl",
        "Vorkommenspfad",
        "Dateiname",
        "Endung",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 24)?;
    sheet.set_column_width(1, 12)?;
    set_path_widths(sheet, &[2])?;
    sheet.set_column_width(3, 28)?;
    sheet.set_column_width(4, 12)?;
    sheet.set_column_width(5, 12)?;
    sheet.set_column_width(6, 12)?;
    sheet.set_column_width(7, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.same_file_stems {
        for occ in &group.occurrences {
            sheet.write_string_with_format(row_idx, 0, &group.normalized_stem, wrap)?;
            sheet.write_number(row_idx, 1, group.occurrence_count as f64)?;
            sheet.write_string_with_format(row_idx, 2, &occ.relative_path, wrap)?;
            sheet.write_string_with_format(row_idx, 3, &occ.filename, wrap)?;
            sheet.write_string(row_idx, 4, &occ.extension_key)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 7, data_rows, Some((5, 6)))?;
    Ok(())
}

fn write_exact_name_structures(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_EXACT_NAMES)?;
    let headers = [
        "Signatur",
        "Ordneranzahl",
        "Dateianzahl",
        "Dateinamen",
        "Vorkommenspfad",
        "Ordnername",
        "Tiefe",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 36)?;
    sheet.set_column_width(1, 12)?;
    sheet.set_column_width(2, 12)?;
    sheet.set_column_width(3, 40)?;
    set_path_widths(sheet, &[4])?;
    sheet.set_column_width(5, 20)?;
    sheet.set_column_width(6, 10)?;
    sheet.set_column_width(7, 12)?;
    sheet.set_column_width(8, 12)?;
    sheet.set_column_width(9, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.exact_file_name_structures {
        let names = group.direct_file_names.join(", ");
        for folder in &group.folders {
            sheet.write_string_with_format(row_idx, 0, &group.signature, wrap)?;
            sheet.write_number(row_idx, 1, group.folder_count as f64)?;
            sheet.write_number(row_idx, 2, group.direct_file_count as f64)?;
            sheet.write_string_with_format(row_idx, 3, &names, wrap)?;
            sheet.write_string_with_format(row_idx, 4, &folder.relative_path, wrap)?;
            sheet.write_string(row_idx, 5, &folder.name)?;
            sheet.write_number(row_idx, 6, folder.depth as f64)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 9, data_rows, Some((7, 8)))?;
    Ok(())
}

fn write_extension_distributions(
    workbook: &mut Workbook,
    report: &InventoryReportModel,
    header: &Format,
    wrap: &Format,
) -> Result<(), ReportXlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name(SHEET_EXTENSIONS)?;
    let headers = [
        "Signatur",
        "Ordneranzahl",
        "Dateianzahl",
        "Endungsverteilung",
        "Vorkommenspfad",
        "Ordnername",
        "Tiefe",
        WORK_COL_CHECK,
        WORK_COL_DONE,
        WORK_COL_NOTE,
    ];
    write_headers(sheet, &headers, header)?;
    sheet.set_column_width(0, 36)?;
    sheet.set_column_width(1, 12)?;
    sheet.set_column_width(2, 12)?;
    sheet.set_column_width(3, 36)?;
    set_path_widths(sheet, &[4])?;
    sheet.set_column_width(5, 20)?;
    sheet.set_column_width(6, 10)?;
    sheet.set_column_width(7, 12)?;
    sheet.set_column_width(8, 12)?;
    sheet.set_column_width(9, 36)?;

    let mut row_idx: u32 = 1;
    for group in &report.chapters.extension_distributions {
        let distribution = group
            .extension_counts
            .iter()
            .map(|item| format!("{}×{}", item.count, item.extension_key))
            .collect::<Vec<_>>()
            .join(", ");
        for folder in &group.folders {
            sheet.write_string_with_format(row_idx, 0, &group.signature, wrap)?;
            sheet.write_number(row_idx, 1, group.folder_count as f64)?;
            sheet.write_number(row_idx, 2, group.direct_file_count as f64)?;
            sheet.write_string_with_format(row_idx, 3, &distribution, wrap)?;
            sheet.write_string_with_format(row_idx, 4, &folder.relative_path, wrap)?;
            sheet.write_string(row_idx, 5, &folder.name)?;
            sheet.write_number(row_idx, 6, folder.depth as f64)?;
            row_idx += 1;
        }
    }
    let data_rows = row_idx.saturating_sub(1);
    finish_table(sheet, 9, data_rows, Some((7, 8)))?;
    Ok(())
}
