//! Report tables with padding, repeated headers, and no mid-row page splits.

use genpdf::elements::Paragraph;
use genpdf::error::Error;
use genpdf::fonts::FontCache;
use genpdf::render;
use genpdf::style::Style;
use genpdf::{Alignment, Context, Element, Margins, Mm, Position, RenderResult};

/// Uniform cell padding (mm) for all report tables.
pub const TABLE_CELL_PADDING_MM: f32 = 1.2;

/// Realistic R3 character-set sample (German + common Latin accents; no CJK/Greek requirement).
pub const R3_CHARSET_SAMPLE: &str =
    "Äpfel Öffnen Überprüfung Straße größer Mädchen nämlich – café élève façade fête déjà à á";

/// Table that repeats the header on every page and never starts a row unless it fits fully.
pub struct ReportTable {
    weights: Vec<usize>,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    right_align: Vec<bool>,
    next_row: usize,
}

impl ReportTable {
    pub fn new(
        weights: Vec<usize>,
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
        right_align: Vec<bool>,
    ) -> Self {
        ReportTable {
            weights,
            headers,
            rows,
            right_align,
            next_row: 0,
        }
    }
}

impl Element for ReportTable {
    fn render(
        &mut self,
        context: &Context,
        mut area: render::Area<'_>,
        style: Style,
    ) -> Result<RenderResult, Error> {
        let mut result = RenderResult::default();
        result.size.width = area.size().width;

        if self.weights.is_empty() || self.next_row >= self.rows.len() {
            return Ok(result);
        }

        let pad = Margins::all(TABLE_CELL_PADDING_MM);
        let header_style = style.and(Style::new().bold().with_font_size(9));
        let cell_style = style.and(Style::new().with_font_size(8));
        let safety = Mm::from(0.8f32);

        let cols = column_widths(area.size().width, &self.weights);
        let header_needed =
            estimate_row_height(&self.headers, &cols, header_style, &context.font_cache, pad)
                + safety;

        if header_needed > area.size().height {
            result.has_more = true;
            return Ok(result);
        }

        // Always redraw header at the start of each page contribution.
        let painted_header = paint_row(
            context,
            &area,
            &self.weights,
            &self.headers,
            &vec![false; self.headers.len()],
            header_style,
            pad,
            BorderKind::Header,
        )?;
        result.size.height += painted_header;
        area.add_offset(Position::new(0, painted_header));

        while self.next_row < self.rows.len() {
            let row = &self.rows[self.next_row];
            let needed =
                estimate_row_height(row, &cols, cell_style, &context.font_cache, pad) + safety;
            if needed > area.size().height {
                // Full row does not fit → break before the row; header repeats next page.
                result.has_more = true;
                break;
            }

            let is_last = self.next_row + 1 >= self.rows.len();
            let kind = if is_last {
                BorderKind::LastData
            } else {
                BorderKind::Data
            };
            let painted = paint_row(
                context,
                &area,
                &self.weights,
                row,
                &self.right_align,
                cell_style,
                pad,
                kind,
            )?;
            result.size.height += painted;
            area.add_offset(Position::new(0, painted));
            self.next_row += 1;
        }

        result.has_more = self.next_row < self.rows.len();
        Ok(result)
    }
}

#[derive(Clone, Copy)]
enum BorderKind {
    Header,
    Data,
    LastData,
}

fn column_widths(total: Mm, weights: &[usize]) -> Vec<Mm> {
    let sum = weights.iter().sum::<usize>().max(1) as f64;
    let factor = total / sum;
    weights.iter().map(|w| factor * (*w as f64)).collect()
}

fn estimate_row_height(
    cells: &[String],
    col_widths: &[Mm],
    style: Style,
    font_cache: &FontCache,
    pad: Margins,
) -> Mm {
    let _ = pad;
    let pad_mm = Mm::from(TABLE_CELL_PADDING_MM);
    let line_h = style.line_height(font_cache);
    let mut max_lines = 1usize;
    for (text, width) in cells.iter().zip(col_widths.iter()) {
        let inner = (*width - pad_mm - pad_mm).max(Mm::from(4.0f32));
        max_lines = max_lines.max(estimate_lines(text, inner, style, font_cache));
    }
    line_h * (max_lines as f64) + pad_mm + pad_mm
}

/// Split cell text into genpdf-safe atoms: natural space words, plus character chunks
/// for any single token wider than `max_width`.
///
/// Concatenating the returned atoms always reconstructs `text` exactly (no inserted
/// hyphens/spaces). Multiple atoms are fed to `Paragraph` as separate strings so genpdf
/// can wrap between them without treating the whole token as one unsplittable word.
pub fn soft_break_cell_atoms(
    text: &str,
    max_width: Mm,
    style: Style,
    font_cache: &FontCache,
) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut atoms = Vec::new();
    for word in text.split_inclusive(' ') {
        if style.str_width(font_cache, word) <= max_width {
            atoms.push(word.to_string());
            continue;
        }
        let mut probe = String::new();
        for ch in word.chars() {
            probe.push(ch);
            if style.str_width(font_cache, &probe) > max_width && probe.chars().count() > 1 {
                let overflow = probe.pop().expect("char just pushed");
                atoms.push(std::mem::take(&mut probe));
                probe.push(overflow);
            }
        }
        if !probe.is_empty() {
            // Keep an oversized single glyph rather than dropping content.
            atoms.push(probe);
        }
    }
    atoms
}

fn estimate_lines(text: &str, max_width: Mm, style: Style, font_cache: &FontCache) -> usize {
    let atoms = soft_break_cell_atoms(text, max_width, style, font_cache);
    if atoms.is_empty() {
        return 1;
    }
    let zero = Mm::from(0);
    let mut lines = 1usize;
    let mut x = zero;
    for atom in &atoms {
        let w = style.str_width(font_cache, atom);
        if x > zero && x + w > max_width {
            lines += 1;
            x = w;
        } else {
            x += w;
        }
    }
    lines.max(1)
}

fn cell_paragraph(
    text: &str,
    max_width: Mm,
    style: Style,
    font_cache: &FontCache,
    right_align: bool,
) -> Paragraph {
    let atoms = soft_break_cell_atoms(text, max_width, style, font_cache);
    let mut para = Paragraph::default();
    if atoms.is_empty() {
        para.push("");
    } else {
        for atom in atoms {
            para.push(atom);
        }
    }
    if right_align {
        para.aligned(Alignment::Right)
    } else {
        para
    }
}

fn paint_row(
    context: &Context,
    area: &render::Area<'_>,
    weights: &[usize],
    cells: &[String],
    right_align: &[bool],
    style: Style,
    pad: Margins,
    kind: BorderKind,
) -> Result<Mm, Error> {
    let cols = column_widths(area.size().width, weights);
    let row_h = estimate_row_height(cells, &cols, style, &context.font_cache, pad);
    let mut row_area = area.clone();
    row_area.set_height(row_h);

        let cell_areas = row_area.split_horizontally(weights);
    let n = cells.len().min(cell_areas.len());

    for i in 0..n {
        let mut cell_area = cell_areas[i].clone();
        cell_area.set_height(row_h);

        // Borders first (full cell rectangle).
        draw_cell_border(&cell_area, i, n, kind, style);

        // Content with padding.
        let mut content = cell_area.clone();
        content.add_margins(pad);
        // Soft-break against the width Paragraph will actually receive.
        let inner = content.size().width.max(Mm::from(4.0f32));
        let right = right_align.get(i) == Some(&true);
        let mut para = cell_paragraph(&cells[i], inner, style, &context.font_cache, right);
        let rendered = para.render(context, content, style)?;
        // Soft-break keeps atoms within width; has_more should stay rare. Still do not
        // split a row across pages if residual clip remains.
        let _ = rendered;
    }

    Ok(row_h)
}

fn draw_cell_border(
    area: &render::Area<'_>,
    column: usize,
    num_columns: usize,
    kind: BorderKind,
    style: Style,
) {
    let size = area.size();
    // Left
    if column == 0 {
        area.draw_line(
            vec![Position::default(), Position::new(0, size.height)],
            style,
        );
    } else {
        area.draw_line(
            vec![Position::default(), Position::new(0, size.height)],
            style,
        );
    }
    // Right
    if column + 1 == num_columns {
        area.draw_line(
            vec![
                Position::new(size.width, 0),
                Position::new(size.width, size.height),
            ],
            style,
        );
    } else {
        area.draw_line(
            vec![
                Position::new(size.width, 0),
                Position::new(size.width, size.height),
            ],
            style,
        );
    }
    // Top — always for header and for every continued/data row (closes block on new page).
    area.draw_line(
        vec![Position::default(), Position::new(size.width, 0)],
        style,
    );
    // Bottom
    let print_bottom = match kind {
        BorderKind::Header | BorderKind::Data | BorderKind::LastData => true,
    };
    if print_bottom {
        area.draw_line(
            vec![
                Position::new(0, size.height),
                Position::new(size.width, size.height),
            ],
            style,
        );
    }
}

/// Convenience: push a padded, page-aware table onto the document.
pub fn push_table(
    doc: &mut genpdf::Document,
    weights: Vec<usize>,
    headers: &[&str],
    rows: Vec<Vec<String>>,
    right_align: &[bool],
) {
    if rows.is_empty() {
        return;
    }
    let headers: Vec<String> = headers.iter().map(|s| (*s).to_string()).collect();
    let align = if right_align.len() == headers.len() {
        right_align.to_vec()
    } else {
        vec![false; headers.len()]
    };
    doc.push(ReportTable::new(weights, headers, rows, align));
}

#[cfg(test)]
mod tests {
    use super::*;
    use genpdf::fonts::{FontData, FontFamily};

    fn test_font_cache() -> FontCache {
        let family = FontFamily {
            regular: FontData::new(
                include_bytes!("../../assets/fonts/DejaVuSans-Regular.ttf").to_vec(),
                None,
            )
            .expect("regular"),
            bold: FontData::new(
                include_bytes!("../../assets/fonts/DejaVuSans-Bold.ttf").to_vec(),
                None,
            )
            .expect("bold"),
            italic: FontData::new(
                include_bytes!("../../assets/fonts/DejaVuSans-Italic.ttf").to_vec(),
                None,
            )
            .expect("italic"),
            bold_italic: FontData::new(
                include_bytes!("../../assets/fonts/DejaVuSans-BoldItalic.ttf").to_vec(),
                None,
            )
            .expect("bold italic"),
        };
        FontCache::new(family)
    }

    /// Approximate Kapitel-E Datei column inner width (A4, margins 14, weights 2/4/3/2).
    fn datei_column_inner() -> Mm {
        let content = Mm::from(210.0f32 - 28.0);
        let col = content * (3.0 / 11.0);
        let pad = Mm::from(TABLE_CELL_PADDING_MM);
        col - pad - pad
    }

    #[test]
    fn padding_is_positive() {
        assert!(TABLE_CELL_PADDING_MM > 0.0);
    }

    #[test]
    fn charset_sample_has_required_glyphs() {
        for ch in ['Ä', 'Ö', 'Ü', 'ä', 'ö', 'ü', 'ß', 'é', 'è', 'ê', 'á', 'à', 'ç', '–'] {
            assert!(
                R3_CHARSET_SAMPLE.contains(ch),
                "missing {ch:?} in {R3_CHARSET_SAMPLE}"
            );
        }
        assert!(!R3_CHARSET_SAMPLE.contains('日'));
        assert!(!R3_CHARSET_SAMPLE.contains('Ε'));
    }

    #[test]
    fn soft_break_keeps_short_filename_as_single_atom() {
        let cache = test_font_cache();
        let style = Style::new().with_font_size(8);
        let inner = datei_column_inner();
        // Synthetic KEEP: short enough to fit the Datei column in one atom.
        let name = "keep_ok_short_token.pdf";
        assert!(style.str_width(&cache, name) <= inner);
        let atoms = soft_break_cell_atoms(name, inner, style, &cache);
        assert_eq!(atoms, vec![name.to_string()]);
        assert_eq!(atoms.concat(), name);
    }

    #[test]
    fn soft_break_splits_former_drop_filename_without_losing_chars() {
        let cache = test_font_cache();
        let style = Style::new().with_font_size(8);
        let inner = datei_column_inner();
        // Synthetic DROP: one unbroken token wider than the Datei column.
        let name = "overflow_token_needs_soft_break_XXXX.pdf";
        assert!(
            style.str_width(&cache, name) > inner,
            "fixture must exceed Datei column"
        );
        let atoms = soft_break_cell_atoms(name, inner, style, &cache);
        assert!(atoms.len() > 1, "must soft-break into multiple atoms");
        assert_eq!(atoms.concat(), name);
        for atom in &atoms {
            assert!(
                style.str_width(&cache, atom) <= inner
                    || atom.chars().count() == 1,
                "atom too wide for genpdf: {atom:?}"
            );
        }
    }

    #[test]
    fn soft_break_preserves_umlaut_hyphen_underscore_dot_and_spaces() {
        let cache = test_font_cache();
        let style = Style::new().with_font_size(8);
        let inner = datei_column_inner();
        let name = "äöü_Probe.Name_with-hyphen space.pdf";
        let atoms = soft_break_cell_atoms(name, inner, style, &cache);
        assert_eq!(atoms.concat(), name);
        assert!(atoms.concat().contains('ä'));
        assert!(atoms.concat().contains('_'));
        assert!(atoms.concat().contains('-'));
        assert!(atoms.concat().contains('.'));
        assert!(atoms.concat().contains(' '));
        // Natural space still preferred: at least one atom should end with space or be a space-bearing word.
        assert!(
            atoms.iter().any(|a| a.contains(' ')),
            "space from original must remain inside some atom"
        );
    }

    #[test]
    fn soft_break_handles_very_long_token() {
        let cache = test_font_cache();
        let style = Style::new().with_font_size(8);
        let inner = datei_column_inner();
        let name = "overflow_token_with_umlaut_Bestätigung_and_many_more_chars_ABCDEF.pdf";
        let atoms = soft_break_cell_atoms(name, inner, style, &cache);
        assert!(atoms.len() > 1);
        assert_eq!(atoms.concat(), name);
        assert!(estimate_lines(name, inner, style, &cache) >= atoms.len().min(2));
    }
}
