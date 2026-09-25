//! Compact PDF IST-Bericht from InventoryReportModel (no re-analysis).

use std::fmt;

use genpdf::elements::{Break, LinearLayout, Paragraph};
use genpdf::fonts::{FontData, FontFamily};
use genpdf::style::{Style, StyledString};
use genpdf::{Alignment, Document, Element as _, SimplePageDecorator};

use crate::report::model::InventoryReportModel;
use crate::report::pdf_table::push_table;

pub use crate::report::pdf_table::{
    R3_CHARSET_SAMPLE as PDF_R3_CHARSET_SAMPLE, TABLE_CELL_PADDING_MM as PDF_TABLE_CELL_PADDING_MM,
};

/// Soft cap for detail rows per fachlichem Abschnitt (not silent).
pub const PDF_DETAIL_ROW_LIMIT: usize = 500;

/// Compact folder overview rows shown in PDF.
pub const PDF_FOLDER_OVERVIEW_LIMIT: usize = 10;

#[derive(Debug)]
pub struct ReportPdfError(String);

impl fmt::Display for ReportPdfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<genpdf::error::Error> for ReportPdfError {
    fn from(value: genpdf::error::Error) -> Self {
        ReportPdfError(value.to_string())
    }
}

/// Build PDF bytes for the given report model.
pub fn build_report_pdf_bytes(report: &InventoryReportModel) -> Result<Vec<u8>, ReportPdfError> {
    let font = embedded_font_family()?;
    let mut doc = Document::new(font);
    doc.set_title("DottyFM – IST-Bericht");
    doc.set_minimal_conformance();
    doc.set_line_spacing(1.15);
    doc.set_font_size(10);

    let mut decorator = SimplePageDecorator::new();
    decorator.set_margins(14);
    decorator.set_header(|page| {
        let mut layout = LinearLayout::vertical();
        if page > 1 {
            layout.push(
                Paragraph::new("DottyFM – IST-Bericht")
                    .aligned(Alignment::Left)
                    .styled(Style::new().bold().with_font_size(9)),
            );
            layout.push(
                Paragraph::new(format!("Seite {page}"))
                    .aligned(Alignment::Right)
                    .styled(Style::new().with_font_size(8)),
            );
            layout.push(Break::new(0.6));
        }
        layout
    });
    doc.set_page_decorator(decorator);

    push_document_body(&mut doc, report);
    let mut bytes = Vec::new();
    doc.render(&mut bytes)?;
    Ok(bytes)
}

fn embedded_font_family() -> Result<FontFamily<FontData>, ReportPdfError> {
    Ok(FontFamily {
        regular: FontData::new(
            include_bytes!("../../assets/fonts/DejaVuSans-Regular.ttf").to_vec(),
            None,
        )?,
        bold: FontData::new(
            include_bytes!("../../assets/fonts/DejaVuSans-Bold.ttf").to_vec(),
            None,
        )?,
        italic: FontData::new(
            include_bytes!("../../assets/fonts/DejaVuSans-Italic.ttf").to_vec(),
            None,
        )?,
        bold_italic: FontData::new(
            include_bytes!("../../assets/fonts/DejaVuSans-BoldItalic.ttf").to_vec(),
            None,
        )?,
    })
}

fn push_document_body(doc: &mut Document, report: &InventoryReportModel) {
    let sel = &report.chapter_selection;
    let chapters = &report.chapters;
    let meta = &report.meta;

    doc.push(
        Paragraph::new("DottyFM – IST-Bericht")
            .aligned(Alignment::Center)
            .styled(Style::new().bold().with_font_size(18)),
    );
    doc.push(Break::new(0.8));

    push_heading(doc, "Metadaten");
    kv(doc, "Erstellt", &format_created_at(meta.created_at_ms));
    kv(doc, "Startordner", &meta.root_path);
    kv(doc, "Root-Name", &meta.root_name);
    kv(
        doc,
        "Maximale Einlesetiefe",
        &meta
            .max_depth
            .map(|d| d.to_string())
            .unwrap_or_else(|| "—".into()),
    );
    kv(
        doc,
        "Maximal beobachtete Tiefe",
        &meta.max_observed_depth.to_string(),
    );
    kv(
        doc,
        "Scan-ID",
        &meta
            .scan_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "—".into()),
    );
    doc.push(Break::new(0.6));

    if sel.overview {
        push_heading(doc, "A. Bestandsübersicht");
        let o = &chapters.overview;
        kv(doc, "Ordner gesamt", &o.directory_count.to_string());
        kv(doc, "Dateien gesamt", &o.file_count.to_string());
        kv(doc, "Bekannte Größe (Bytes)", &o.known_size_bytes.to_string());
        kv(
            doc,
            "Dateien ohne bekannte Größe",
            &o.files_without_known_size.to_string(),
        );
        kv(
            doc,
            "Tiefenbegrenzte Ordner",
            &o.depth_limited_folder_count.to_string(),
        );
        kv(doc, "Unterordner", &o.subdirectory_count.to_string());
        doc.push(Break::new(0.5));
    }

    if sel.file_types {
        push_heading(doc, "B. Dateitypen");
        if chapters.file_types.is_empty() {
            empty_note(doc);
        } else {
            let rows: Vec<Vec<String>> = chapters
                .file_types
                .iter()
                .map(|row| {
                    vec![
                        row.extension.clone(),
                        row.label.clone(),
                        row.file_count.to_string(),
                        row.known_size_bytes.to_string(),
                    ]
                })
                .collect();
            push_table(
                doc,
                vec![2, 3, 2, 3],
                &["Endung", "Typ", "Anzahl", "Größe (Bytes)"],
                rows,
                &[false, false, true, true],
            );
        }
        doc.push(Break::new(0.5));
    }

    if sel.folders {
        push_heading(doc, "C. Ordnerübersicht");
        let total = chapters.folders.len();
        if total == 0 {
            empty_note(doc);
        } else {
            let shown = total.min(PDF_FOLDER_OVERVIEW_LIMIT);
            doc.push(Paragraph::new(format!(
                "Angezeigt werden {shown} von {total} Ordnern (Reihenfolge wie im Report-Modell). \
Die vollständige Ordnerliste ist für die Excel-Ausgabe vorgesehen."
            )));
            doc.push(Break::new(0.3));
            let rows: Vec<Vec<String>> = chapters
                .folders
                .iter()
                .take(shown)
                .map(|row| {
                    vec![
                        row.name.clone(),
                        row.relative_path.clone(),
                        row.depth.to_string(),
                        row.direct_file_count.to_string(),
                        row.direct_directory_count.to_string(),
                        row.direct_known_size_bytes.to_string(),
                    ]
                })
                .collect();
            push_table(
                doc,
                vec![2, 4, 1, 1, 1, 2],
                &[
                    "Name",
                    "Relativer Pfad",
                    "Tiefe",
                    "Dateien",
                    "Unterordner",
                    "Größe",
                ],
                rows,
                &[false, false, true, true, true, true],
            );
        }
        doc.push(Break::new(0.5));
    }

    if sel.empty_folders {
        push_heading(doc, "D. Leere Ordner");
        push_path_rows(doc, &chapters.empty_folders);
        doc.push(Break::new(0.4));
    }

    if sel.single_file_folders {
        push_heading(doc, "E. Ein-Datei-Ordner");
        if chapters.single_file_folders.is_empty() {
            empty_note(doc);
        } else {
            let total = chapters.single_file_folders.len();
            let (slice, note) = limited_slice(total, PDF_DETAIL_ROW_LIMIT);
            if let Some(n) = note {
                doc.push(Paragraph::new(n));
                doc.push(Break::new(0.2));
            }
            let rows: Vec<Vec<String>> = chapters
                .single_file_folders
                .iter()
                .take(slice)
                .map(|row| {
                    vec![
                        row.folder_name.clone(),
                        row.relative_path.clone(),
                        row.file_name.clone(),
                        row.extension.clone(),
                    ]
                })
                .collect();
            push_table(
                doc,
                vec![2, 4, 3, 2],
                &["Ordner", "Relativer Pfad", "Datei", "Endung"],
                rows,
                &[false, false, false, false],
            );
        }
        doc.push(Break::new(0.4));
    }

    if sel.unreadable {
        push_heading(doc, "F. Nicht prüfbare Bereiche");
        let warnings = &chapters.unreadable.warnings;
        let unconfirmed = &chapters.unreadable.unconfirmed_empty_looking_folders;
        if warnings.is_empty() && unconfirmed.is_empty() {
            empty_note(doc);
        } else {
            if !warnings.is_empty() {
                doc.push(Paragraph::new("Warnungen").styled(Style::new().bold()));
                let total = warnings.len();
                let (slice, note) = limited_slice(total, PDF_DETAIL_ROW_LIMIT);
                if let Some(n) = note {
                    doc.push(Paragraph::new(n));
                }
                let rows: Vec<Vec<String>> = warnings
                    .iter()
                    .take(slice)
                    .map(|row| {
                        vec![
                            row.relative_path.clone(),
                            row.code.clone(),
                            row.message.clone(),
                        ]
                    })
                    .collect();
                push_table(
                    doc,
                    vec![3, 2, 5],
                    &["Pfad", "Code", "Meldung"],
                    rows,
                    &[false, false, false],
                );
                doc.push(Break::new(0.3));
            }
            if !unconfirmed.is_empty() {
                doc.push(
                    Paragraph::new("Unbestätigte leer wirkende Ordner")
                        .styled(Style::new().bold()),
                );
                push_path_rows(doc, unconfirmed);
            }
        }
        doc.push(Break::new(0.4));
    }

    if sel.repeated_folder_names {
        push_heading(doc, "G. Wiederkehrende Ordnernamen");
        push_name_groups(doc, &chapters.repeated_folder_names);
        doc.push(Break::new(0.4));
    }

    if sel.repeated_file_names {
        push_heading(doc, "H. Wiederkehrende Dateinamen");
        push_name_groups(doc, &chapters.repeated_file_names);
        doc.push(Break::new(0.4));
    }

    if sel.year_structures {
        push_heading(doc, "I. Jahresstrukturen");
        if chapters.year_structures.is_empty() {
            empty_note(doc);
        } else {
            let total = chapters.year_structures.len();
            let (slice, note) = limited_slice(total, PDF_DETAIL_ROW_LIMIT);
            if let Some(n) = note {
                doc.push(Paragraph::new(n));
            }
            for ys in chapters.year_structures.iter().take(slice) {
                doc.push(
                    Paragraph::new(format!(
                        "{} ({}) — Jahre {}–{}",
                        ys.parent_name, ys.parent_relative_path, ys.min_year, ys.max_year
                    ))
                    .styled(Style::new().bold()),
                );
                if !ys.missing_years.is_empty() {
                    doc.push(Paragraph::new(format!(
                        "Fehlende Jahre: {}",
                        ys.missing_years
                            .iter()
                            .map(|y| y.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )));
                }
                for yf in &ys.year_folders {
                    doc.push(Paragraph::new(format!(
                        "  · {} — {}",
                        yf.year, yf.relative_path
                    )));
                }
                doc.push(Break::new(0.2));
            }
        }
        doc.push(Break::new(0.4));
    }

    if sel.file_name_patterns {
        push_heading(doc, "J. Muster in Dateinamen");
        let p = &chapters.file_name_patterns;
        kv(doc, "Analysierte Dateien", &p.analyzed_file_count.to_string());
        kv(doc, "Dateien mit Ziffern", &p.files_with_digits.to_string());
        kv(
            doc,
            "Dateien mit führenden Ziffern",
            &p.files_with_leading_digits.to_string(),
        );
        kv(
            doc,
            "Erkannte Datumsformen",
            &p.files_with_recognized_date_forms.to_string(),
        );
        kv(
            doc,
            "Sechsstellige Zahlenfolgen",
            &p.files_with_six_digit_blocks.to_string(),
        );
        if !p.date_form_groups.is_empty() {
            doc.push(Break::new(0.2));
            let rows: Vec<Vec<String>> = p
                .date_form_groups
                .iter()
                .map(|g| {
                    vec![
                        g.format.clone(),
                        g.label.clone(),
                        g.match_count.to_string(),
                    ]
                })
                .collect();
            push_table(
                doc,
                vec![2, 4, 2],
                &["Format", "Bezeichnung", "Treffer"],
                rows,
                &[false, false, true],
            );
        }
        if !p.date_forms_hint.is_empty() {
            doc.push(Break::new(0.2));
            doc.push(Paragraph::new(&p.date_forms_hint));
        }
        if !p.six_digit_hint.is_empty() {
            doc.push(Paragraph::new(&p.six_digit_hint));
        }
        doc.push(Break::new(0.4));
    }

    if sel.same_file_stems {
        push_heading(doc, "K. Gleiche Dateistämme");
        if chapters.same_file_stems.is_empty() {
            empty_note(doc);
        } else {
            let mut detail_budget = PDF_DETAIL_ROW_LIMIT;
            let group_total = chapters.same_file_stems.len();
            let mut groups_shown = 0usize;
            let mut rows_shown = 0usize;
            let mut truncated = false;
            for group in &chapters.same_file_stems {
                if detail_budget == 0 {
                    truncated = true;
                    break;
                }
                groups_shown += 1;
                doc.push(
                    Paragraph::new(format!(
                        "Stamm „{}“ — {} Vorkommen",
                        group.normalized_stem, group.occurrence_count
                    ))
                    .styled(Style::new().bold()),
                );
                for occ in &group.occurrences {
                    if detail_budget == 0 {
                        truncated = true;
                        break;
                    }
                    doc.push(Paragraph::new(format!(
                        "  · {} ({})",
                        occ.relative_path, occ.extension_key
                    )));
                    detail_budget -= 1;
                    rows_shown += 1;
                }
                doc.push(Break::new(0.15));
            }
            if truncated {
                doc.push(Paragraph::new(format!(
                    "Hinweis: {rows_shown} Detailzeilen aus {groups_shown} von {group_total} Gruppen dargestellt \
(Limit {PDF_DETAIL_ROW_LIMIT}). Die vollständigen Detaildaten sind für die Excel-Ausgabe vorgesehen."
                )));
            }
        }
        doc.push(Break::new(0.4));
    }

    if sel.exact_file_name_structures || sel.extension_distributions {
        push_heading(doc, "L. Exakte Strukturen / Endungsverteilungen");
        if sel.exact_file_name_structures {
            doc.push(
                Paragraph::new("Exakte Dateinamensstrukturen").styled(Style::new().bold()),
            );
            if chapters.exact_file_name_structures.is_empty() {
                empty_note(doc);
            } else {
                let total = chapters.exact_file_name_structures.len();
                let (slice, note) = limited_slice(total, PDF_DETAIL_ROW_LIMIT);
                if let Some(n) = note {
                    doc.push(Paragraph::new(n));
                }
                for g in chapters.exact_file_name_structures.iter().take(slice) {
                    doc.push(
                        Paragraph::new(format!("{} — {} Ordner", g.signature, g.folder_count))
                            .styled(Style::new().bold()),
                    );
                    for folder in g.folders.iter().take(30) {
                        doc.push(Paragraph::new(format!(
                            "  · {} (Tiefe {})",
                            folder.relative_path, folder.depth
                        )));
                    }
                    doc.push(Break::new(0.15));
                }
            }
            doc.push(Break::new(0.3));
        }
        if sel.extension_distributions {
            doc.push(Paragraph::new("Endungsverteilungen").styled(Style::new().bold()));
            if chapters.extension_distributions.is_empty() {
                empty_note(doc);
            } else {
                for g in chapters
                    .extension_distributions
                    .iter()
                    .take(PDF_DETAIL_ROW_LIMIT)
                {
                    doc.push(
                        Paragraph::new(format!(
                            "{} — {} Ordner, {} Dateien",
                            g.signature, g.folder_count, g.direct_file_count
                        ))
                        .styled(Style::new().bold()),
                    );
                    if !g.hint.is_empty() {
                        doc.push(Paragraph::new(g.hint.as_str()));
                    }
                    for folder in g.folders.iter().take(20) {
                        doc.push(Paragraph::new(format!(
                            "  · {} (Tiefe {})",
                            folder.relative_path, folder.depth
                        )));
                    }
                    doc.push(Break::new(0.15));
                }
            }
        }
        doc.push(Break::new(0.4));
    }

    if sel.interpretation {
        push_heading(doc, "M. Hinweise zur Interpretation");
        if chapters.interpretation.notes.is_empty() {
            empty_note(doc);
        } else {
            for note in &chapters.interpretation.notes {
                doc.push(Paragraph::new(format!("• {note}")));
                doc.push(Break::new(0.15));
            }
        }
    }
}

fn push_name_groups(doc: &mut Document, groups: &[crate::report::model::InventoryReportNameGroup]) {
    if groups.is_empty() {
        empty_note(doc);
        return;
    }
    let mut budget = PDF_DETAIL_ROW_LIMIT;
    let group_total = groups.len();
    let mut groups_shown = 0usize;
    let mut paths_shown = 0usize;
    let mut truncated = false;
    for group in groups {
        if budget == 0 {
            truncated = true;
            break;
        }
        groups_shown += 1;
        doc.push(
            Paragraph::new(format!("„{}“ — {}×", group.name, group.count))
                .styled(Style::new().bold()),
        );
        for path in &group.relative_paths {
            if budget == 0 {
                truncated = true;
                break;
            }
            doc.push(Paragraph::new(format!("  · {path}")));
            budget -= 1;
            paths_shown += 1;
        }
        doc.push(Break::new(0.15));
    }
    if truncated {
        doc.push(Paragraph::new(format!(
            "Hinweis: {paths_shown} Pfade aus {groups_shown} von {group_total} Gruppen dargestellt \
(Limit {PDF_DETAIL_ROW_LIMIT}). Die vollständigen Detaildaten sind für die Excel-Ausgabe vorgesehen."
        )));
    }
}

fn push_path_rows(doc: &mut Document, rows: &[crate::report::model::InventoryReportPathRow]) {
    if rows.is_empty() {
        empty_note(doc);
        return;
    }
    let total = rows.len();
    let (slice, note) = limited_slice(total, PDF_DETAIL_ROW_LIMIT);
    if let Some(n) = note {
        doc.push(Paragraph::new(n));
    }
    let rows: Vec<Vec<String>> = rows
        .iter()
        .take(slice)
        .map(|row| vec![row.name.clone(), row.relative_path.clone()])
        .collect();
    push_table(
        doc,
        vec![2, 5],
        &["Name", "Relativer Pfad"],
        rows,
        &[false, false],
    );
}

fn limited_slice(total: usize, limit: usize) -> (usize, Option<String>) {
    if total <= limit {
        (total, None)
    } else {
        (
            limit,
            Some(format!(
                "Hinweis: {limit} von {total} Einträgen dargestellt (Limit {limit}). \
Die vollständigen Detaildaten sind für die Excel-Ausgabe vorgesehen."
            )),
        )
    }
}

fn push_heading(doc: &mut Document, title: &str) {
    doc.push(
        Paragraph::new(title)
            .styled(Style::new().bold().with_font_size(13)),
    );
    doc.push(Break::new(0.35));
}

fn empty_note(doc: &mut Document) {
    doc.push(Paragraph::new(
        "Keine entsprechenden Einträge im eingelesenen Bestand.",
    ));
}

fn kv(doc: &mut Document, key: &str, value: &str) {
    let mut p = Paragraph::default();
    p.push(StyledString::new(format!("{key}: "), Style::new().bold()));
    p.push(value);
    doc.push(p);
}

fn format_created_at(ms: i64) -> String {
    if ms <= 0 {
        return "—".to_string();
    }
    let secs = ms / 1000;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    // Compact UTC stamp for PDF meta (local formatting is filename-helper concern).
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
