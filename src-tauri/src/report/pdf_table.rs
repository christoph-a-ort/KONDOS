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

fn estimate_lines(text: &str, max_width: Mm, style: Style, font_cache: &FontCache) -> usize {
    if text.is_empty() {
        return 1;
    }
    let zero = Mm::from(0);
    let mut lines = 1usize;
    let mut x = zero;
    for word in text.split_inclusive(' ') {
        let w = style.str_width(font_cache, word);
        if w > max_width {
            // Long token: pack by growing a probe string until width overflows.
            let mut probe = String::new();
            let mut token_lines = 1usize;
            for ch in word.chars() {
                probe.push(ch);
                if style.str_width(font_cache, &probe) > max_width && probe.chars().count() > 1 {
                    token_lines += 1;
                    probe.clear();
                    probe.push(ch);
                }
            }
            if x > zero {
                lines += 1;
            }
            lines += token_lines.saturating_sub(1);
            x = zero;
            continue;
        }
        if x + w > max_width && x > zero {
            lines += 1;
            x = w;
        } else {
            x += w;
        }
    }
    lines.max(1)
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
        let mut para = Paragraph::new(cells[i].clone());
        if right_align.get(i) == Some(&true) {
            para = para.aligned(Alignment::Right);
        }
        let rendered = para.render(context, content, style)?;
        // If content still claims has_more despite our estimate, accept residual clip for R3
        // rather than splitting the row across pages (we already reserved full row_h).
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
}
