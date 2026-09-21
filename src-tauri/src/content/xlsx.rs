use std::collections::HashMap;

use quick_xml::events::Event;
use quick_xml::name::QName;
use super::ooxml::{
    append_general_ref, append_xml_text, find_part_index, normalize_zip_name, open_office_zip,
    read_zip_part, scan_zip_names, MAX_XLSX_XML_TOTAL_BYTES,
};
use super::ContentStatus;

const WORKBOOK_XML: &str = "xl/workbook.xml";
const WORKBOOK_RELS: &str = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS: &str = "xl/sharedStrings.xml";
const STYLES_XML: &str = "xl/styles.xml";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DateTimeKind {
    None,
    Date,
    Time,
    DateTime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NumberStyle {
    kind: DateTimeKind,
    with_seconds: bool,
}

impl Default for NumberStyle {
    fn default() -> Self {
        Self {
            kind: DateTimeKind::None,
            with_seconds: false,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct StyleTable {
    xf: Vec<NumberStyle>,
}

impl StyleTable {
    fn get(&self, index: Option<u32>) -> NumberStyle {
        let Some(index) = index else {
            return NumberStyle::default();
        };
        self.xf
            .get(index as usize)
            .copied()
            .unwrap_or_default()
    }
}

/// Extrahiert suchbaren Tabellentext aus einem XLSX-Container.
pub(crate) fn extract_xlsx_text(bytes: &[u8]) -> Result<String, ContentStatus> {
    let mut archive = open_office_zip(bytes)?;
    let (names, encrypted_office) = scan_zip_names(&mut archive)?;
    let Some(workbook_index) = find_part_index(&names, WORKBOOK_XML) else {
        return if encrypted_office {
            Err(ContentStatus::Protected)
        } else {
            Err(ContentStatus::ParseError)
        };
    };

    let mut budget = 0_u64;
    let workbook_xml = read_zip_part(
        &mut archive,
        workbook_index,
        &mut budget,
        MAX_XLSX_XML_TOTAL_BYTES,
    )?;
    let sheets = parse_workbook_sheets(&workbook_xml)?;
    if sheets.is_empty() {
        return Err(ContentStatus::ParseError);
    }

    let Some(rels_index) = find_part_index(&names, WORKBOOK_RELS) else {
        return Err(ContentStatus::ParseError);
    };
    let rels_xml = read_zip_part(
        &mut archive,
        rels_index,
        &mut budget,
        MAX_XLSX_XML_TOTAL_BYTES,
    )?;
    let rels = parse_workbook_rels(&rels_xml)?;
    if rels.is_empty() {
        return Err(ContentStatus::ParseError);
    }

    let date1904 = workbook_uses_1904(&workbook_xml);
    let shared_strings = match find_part_index(&names, SHARED_STRINGS) {
        Some(index) => {
            let xml = read_zip_part(&mut archive, index, &mut budget, MAX_XLSX_XML_TOTAL_BYTES)?;
            parse_shared_strings(&xml)?
        }
        None => Vec::new(),
    };
    let styles = match find_part_index(&names, STYLES_XML) {
        Some(index) => match read_zip_part(
            &mut archive,
            index,
            &mut budget,
            MAX_XLSX_XML_TOTAL_BYTES,
        ) {
            Ok(xml) => parse_styles(&xml),
            Err(ContentStatus::TooLarge) => return Err(ContentStatus::TooLarge),
            Err(ContentStatus::Protected) => return Err(ContentStatus::Protected),
            Err(_) => StyleTable::default(),
        },
        None => StyleTable::default(),
    };

    let mut output = String::new();
    for sheet in &sheets {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&sheet.name);
        output.push('\n');
        let Some(target) = rels.get(&sheet.rid) else {
            continue;
        };
        let part_name = resolve_sheet_target(target);
        let Some(index) = find_part_index(&names, &part_name) else {
            continue;
        };
        let sheet_xml = read_zip_part(&mut archive, index, &mut budget, MAX_XLSX_XML_TOTAL_BYTES)?;
        let cells = parse_worksheet_text(&sheet_xml, &shared_strings, &styles, date1904)?;
        output.push_str(&cells);
        if !output.ends_with('\n') {
            output.push('\n');
        }
    }
    Ok(output)
}

struct SheetRef {
    name: String,
    rid: String,
}

fn resolve_sheet_target(target: &str) -> String {
    let trimmed = normalize_zip_name(target)
        .trim_start_matches('/')
        .to_string();
    if trimmed.len() >= 3 && trimmed[..3].eq_ignore_ascii_case("xl/") {
        trimmed
    } else {
        format!("xl/{trimmed}")
    }
}

fn local_name_is(name: QName<'_>, local: &str) -> bool {
    name.local_name().as_ref() == local
}

fn attr_local_eq(attr: &quick_xml::events::attributes::Attribute<'_>, local: &str) -> bool {
    attr.key.local_name().as_ref().eq_ignore_ascii_case(local)
}

fn attr_unescaped(attr: &quick_xml::events::attributes::Attribute<'_>) -> Result<String, ContentStatus> {
    attr.normalized_value(quick_xml::XmlVersion::Implicit1_0)
        .map(|value| value.into_owned())
        .map_err(|_| ContentStatus::ParseError)
}

fn workbook_uses_1904(xml: &str) -> bool {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(event) | Event::Start(event)) => {
                if local_name_is(event.name(), "workbookPr") {
                    for attr in event.attributes().flatten() {
                        if attr_local_eq(&attr, "date1904") {
                            if let Ok(value) = attr_unescaped(&attr) {
                                return is_xml_true(&value);
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return false,
            _ => {}
        }
        buf.clear();
    }
    false
}

fn is_xml_true(value: &str) -> bool {
    matches!(value.trim(), "1" | "true" | "TRUE" | "True")
}

fn parse_styles(xml: &str) -> StyleTable {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut custom = HashMap::new();
    let mut xf = Vec::new();
    let mut in_cell_xfs = false;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event) | Event::Empty(event)) => {
                let name = event.name();
                if local_name_is(name, "numFmt") {
                    let mut id = None;
                    let mut code = None;
                    for attr in event.attributes().flatten() {
                        if attr_local_eq(&attr, "numFmtId") {
                            if let Ok(raw) = attr_unescaped(&attr) {
                                id = raw.parse().ok();
                            }
                        } else if attr_local_eq(&attr, "formatCode") {
                            if let Ok(raw) = attr_unescaped(&attr) {
                                code = Some(raw);
                            }
                        }
                    }
                    if let (Some(id), Some(code)) = (id, code) {
                        custom.insert(id, code);
                    }
                } else if local_name_is(name, "cellXfs") {
                    in_cell_xfs = true;
                } else if local_name_is(name, "cellStyleXfs") {
                    in_cell_xfs = false;
                } else if local_name_is(name, "xf") && in_cell_xfs {
                    let mut num_fmt_id = 0_u32;
                    for attr in event.attributes().flatten() {
                        if attr_local_eq(&attr, "numFmtId") {
                            if let Ok(raw) = attr_unescaped(&attr) {
                                if let Ok(parsed) = raw.parse() {
                                    num_fmt_id = parsed;
                                }
                            }
                        }
                    }
                    xf.push(style_from_num_fmt(num_fmt_id, &custom));
                }
            }
            Ok(Event::End(event)) => {
                if local_name_is(event.name(), "cellXfs") {
                    in_cell_xfs = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return StyleTable::default(),
            _ => {}
        }
        buf.clear();
    }
    StyleTable { xf }
}

fn style_from_num_fmt(id: u32, custom: &HashMap<u32, String>) -> NumberStyle {
    if let Some(code) = custom.get(&id) {
        return classify_custom_format(code);
    }
    builtin_number_style(id)
}

fn is_builtin_date_time_id(id: u32) -> bool {
    matches!(id, 14..=22 | 27..=36 | 45..=47 | 50..=58)
}

fn builtin_number_style(id: u32) -> NumberStyle {
    if !is_builtin_date_time_id(id) {
        return NumberStyle::default();
    }
    match id {
        18 | 20 => NumberStyle {
            kind: DateTimeKind::Time,
            with_seconds: false,
        },
        19 | 21 | 45 | 46 | 47 => NumberStyle {
            kind: DateTimeKind::Time,
            with_seconds: true,
        },
        22 => NumberStyle {
            kind: DateTimeKind::DateTime,
            with_seconds: false,
        },
        _ => NumberStyle {
            kind: DateTimeKind::Date,
            with_seconds: false,
        },
    }
}

fn classify_custom_format(code: &str) -> NumberStyle {
    let cleaned = strip_format_noise(code);
    let first = cleaned
        .split(';')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if first.is_empty() {
        return NumberStyle::default();
    }

    let has_ampm = first.contains("am/pm") || first.contains("a/p");
    let mut has_year = false;
    let mut has_day = false;
    let mut has_hour = false;
    let mut has_sec = false;
    let mut month_name = false;
    let mut has_elapsed = false;
    let bytes = first.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let start = i + 1;
            i += 1;
            while i < bytes.len() && bytes[i] != b']' {
                i += 1;
            }
            let inner = &first[start..i.min(first.len())];
            if is_elapsed_time_bracket(inner) {
                has_elapsed = true;
                let token = inner.trim();
                if token.starts_with('h') {
                    has_hour = true;
                } else if token.starts_with('s') {
                    has_sec = true;
                }
            }
            if i < bytes.len() {
                i += 1;
            }
            continue;
        }
        match bytes[i] {
            b'y' => {
                has_year = true;
                i += 1;
            }
            b'd' => {
                has_day = true;
                i += 1;
            }
            b'h' => {
                has_hour = true;
                i += 1;
            }
            b's' => {
                has_sec = true;
                i += 1;
            }
            b'm' => {
                let start = i;
                while i < bytes.len() && bytes[i] == b'm' {
                    i += 1;
                }
                if i - start >= 3 {
                    month_name = true;
                }
            }
            _ => i += 1,
        }
    }

    let has_date = has_year || has_day || month_name;
    let has_time = has_hour || has_sec || has_ampm || has_elapsed;
    let kind = match (has_date, has_time) {
        (true, true) => DateTimeKind::DateTime,
        (true, false) => DateTimeKind::Date,
        (false, true) => DateTimeKind::Time,
        (false, false) => DateTimeKind::None,
    };
    if kind == DateTimeKind::None {
        return NumberStyle::default();
    }
    NumberStyle {
        kind,
        with_seconds: has_sec,
    }
}

fn is_elapsed_time_bracket(inner: &str) -> bool {
    matches!(inner.trim(), "h" | "hh" | "m" | "mm" | "s" | "ss")
}

fn strip_format_noise(code: &str) -> String {
    let chars: Vec<char> = code.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut in_quotes = false;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '"' {
            in_quotes = !in_quotes;
            i += 1;
            continue;
        }
        if in_quotes {
            i += 1;
            continue;
        }
        if ch == '\\' {
            i += 2;
            continue;
        }
        if ch == '*' || ch == '_' {
            i += 2;
            continue;
        }
        if ch == '[' {
            let start = i + 1;
            let mut end = start;
            while end < chars.len() && chars[end] != ']' {
                end += 1;
            }
            let inner: String = chars[start..end.min(chars.len())].iter().collect();
            if is_elapsed_time_bracket(&inner.to_ascii_lowercase()) {
                out.push('[');
                out.push_str(&inner.to_ascii_lowercase());
                out.push(']');
            }
            i = if end < chars.len() { end + 1 } else { chars.len() };
            continue;
        }
        out.push(ch);
        i += 1;
    }
    out
}

fn format_numeric_for_search(raw: &str, style: NumberStyle, date1904: bool) -> String {
    if style.kind == DateTimeKind::None {
        return raw.to_string();
    }
    excel_serial_to_search_text(raw, style, date1904).unwrap_or_else(|| raw.to_string())
}

fn excel_serial_to_search_text(raw: &str, style: NumberStyle, date1904: bool) -> Option<String> {
    let serial: f64 = raw.trim().parse().ok()?;
    if !serial.is_finite() || serial < 0.0 || serial > 3_000_000.0 {
        return None;
    }
    let mut day = serial.trunc() as i64;
    let (hour, minute, second, carry) = frac_to_hms(serial.fract());
    if carry {
        day = day.checked_add(1)?;
    }

    let mut parts = Vec::new();
    match style.kind {
        DateTimeKind::None => return None,
        DateTimeKind::Date => {
            let (year, month, date) = excel_day_to_ymd(day, date1904)?;
            parts.push(format!("{date:02}.{month:02}.{year:04}"));
            parts.push(format!("{year:04}-{month:02}-{date:02}"));
        }
        DateTimeKind::Time => {
            parts.push(format_hms(hour, minute, second, style.with_seconds));
        }
        DateTimeKind::DateTime => {
            let (year, month, date) = excel_day_to_ymd(day, date1904)?;
            parts.push(format!("{date:02}.{month:02}.{year:04}"));
            parts.push(format_hms(hour, minute, second, style.with_seconds));
            parts.push(format!("{year:04}-{month:02}-{date:02}"));
        }
    }
    parts.push(raw.to_string());
    Some(parts.join(" "))
}

fn format_hms(hour: u32, minute: u32, second: u32, with_seconds: bool) -> String {
    if with_seconds {
        format!("{hour:02}:{minute:02}:{second:02}")
    } else {
        format!("{hour:02}:{minute:02}")
    }
}

fn frac_to_hms(frac: f64) -> (u32, u32, u32, bool) {
    let mut secs = (frac * 86_400.0).round() as i64;
    let mut carry = false;
    if secs >= 86_400 {
        secs = 0;
        carry = true;
    } else if secs < 0 {
        secs = 0;
    }
    let hour = (secs / 3600) as u32;
    let minute = ((secs % 3600) / 60) as u32;
    let second = (secs % 60) as u32;
    (hour, minute, second, carry)
}

/// Excel-1900: Serial 1 = 01.01.1900, Serial 60 = 29.02.1900 (Schaltjahr-Bug),
/// Serial >= 61 entspricht dem OLE-Datum. 1904: Serial 0 = 01.01.1904.
fn excel_day_to_ymd(day: i64, date1904: bool) -> Option<(i32, u8, u8)> {
    let (year, month, date) = if date1904 {
        if day < 0 {
            return None;
        }
        civil_from_unix_days(day - 24_107)?
    } else {
        match day {
            1..=59 => civil_from_unix_days(day - 25_568)?,
            60 => (1900, 2, 29),
            day if day >= 61 => civil_from_unix_days(day - 25_569)?,
            _ => return None,
        }
    };
    if year < 1900 || year > 9999 {
        return None;
    }
    Some((year, month, date))
}

fn civil_from_unix_days(days: i64) -> Option<(i32, u8, u8)> {
    let z = days.checked_add(719_468)?;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = u32::try_from(z - era * 146_097).ok()?;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = i64::from(yoe) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + i64::from(m <= 2);
    if y < 0 || y > 9999 {
        return None;
    }
    Some((y as i32, m as u8, d as u8))
}

fn parse_workbook_sheets(xml: &str) -> Result<Vec<SheetRef>, ContentStatus> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut sheets = Vec::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(event) | Event::Start(event)) => {
                if local_name_is(event.name(), "sheet") {
                    let mut name = None;
                    let mut rid = None;
                    for attr in event.attributes() {
                        let attr = attr.map_err(|_| ContentStatus::ParseError)?;
                        if attr_local_eq(&attr, "name") {
                            name = Some(attr_unescaped(&attr)?);
                        } else if attr_local_eq(&attr, "id") {
                            rid = Some(attr_unescaped(&attr)?);
                        }
                    }
                    if let (Some(name), Some(rid)) = (name, rid) {
                        if !name.is_empty() && !rid.is_empty() {
                            sheets.push(SheetRef { name, rid });
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(ContentStatus::ParseError),
            _ => {}
        }
        buf.clear();
    }
    Ok(sheets)
}

fn parse_workbook_rels(xml: &str) -> Result<HashMap<String, String>, ContentStatus> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut rels = HashMap::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(event) | Event::Start(event)) => {
                if local_name_is(event.name(), "Relationship") {
                    let mut id = None;
                    let mut target = None;
                    for attr in event.attributes() {
                        let attr = attr.map_err(|_| ContentStatus::ParseError)?;
                        if attr_local_eq(&attr, "id") {
                            id = Some(attr_unescaped(&attr)?);
                        } else if attr_local_eq(&attr, "target") {
                            target = Some(attr_unescaped(&attr)?);
                        }
                    }
                    if let (Some(id), Some(target)) = (id, target) {
                        rels.insert(id, target);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(ContentStatus::ParseError),
            _ => {}
        }
        buf.clear();
    }
    Ok(rels)
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>, ContentStatus> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_si = false;
    let mut in_t = false;
    let mut phonetic_depth: i32 = 0;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let name = event.name();
                if local_name_is(name, "si") {
                    in_si = true;
                    current.clear();
                } else if local_name_is(name, "rPh") {
                    phonetic_depth += 1;
                } else if local_name_is(name, "t") && in_si && phonetic_depth == 0 {
                    in_t = true;
                }
            }
            Ok(Event::Empty(event)) => {
                if local_name_is(event.name(), "si") {
                    strings.push(String::new());
                }
            }
            Ok(Event::End(event)) => {
                let name = event.name();
                if local_name_is(name, "t") {
                    in_t = false;
                } else if local_name_is(name, "rPh") {
                    phonetic_depth = phonetic_depth.saturating_sub(1);
                } else if local_name_is(name, "si") {
                    strings.push(std::mem::take(&mut current));
                    in_si = false;
                    in_t = false;
                }
            }
            Ok(Event::Text(value)) => {
                if in_t {
                    append_xml_text(&mut current, &value);
                }
            }
            Ok(Event::GeneralRef(value)) => {
                if in_t {
                    append_general_ref(&mut current, &value);
                }
            }
            Ok(Event::CData(value)) => {
                if in_t {
                    current.push_str(value.as_ref());
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(ContentStatus::ParseError),
            _ => {}
        }
        buf.clear();
    }
    let _ = in_si;
    Ok(strings)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CellType {
    Shared,
    Inline,
    Bool,
    Str,
    Number,
    Skip,
}

fn parse_worksheet_text(
    xml: &str,
    shared: &[String],
    styles: &StyleTable,
    date1904: bool,
) -> Result<String, ContentStatus> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = String::new();
    let mut last_row: Option<u32> = None;
    let mut cell_type = CellType::Number;
    let mut cell_style = NumberStyle::default();
    let mut cell_row = None;
    let mut in_v = false;
    let mut in_is = false;
    let mut in_t = false;
    let mut in_f = false;
    let mut phonetic_depth: i32 = 0;
    let mut v_buf = String::new();
    let mut inline_buf = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let name = event.name();
                if local_name_is(name, "c") {
                    cell_type = cell_type_from_attrs(&event)?;
                    cell_style = styles.get(style_index_from_attrs(&event)?);
                    cell_row = row_from_ref(&event)?;
                    v_buf.clear();
                    inline_buf.clear();
                    in_v = false;
                    in_is = false;
                    in_t = false;
                    in_f = false;
                } else if local_name_is(name, "f") {
                    in_f = true;
                } else if local_name_is(name, "v") && !in_f {
                    in_v = true;
                } else if local_name_is(name, "is") {
                    in_is = true;
                } else if local_name_is(name, "rPh") {
                    phonetic_depth += 1;
                } else if local_name_is(name, "t") && in_is && phonetic_depth == 0 {
                    in_t = true;
                }
            }
            Ok(Event::Empty(event)) => {
                if local_name_is(event.name(), "c") {
                    // leere Zelle
                }
            }
            Ok(Event::End(event)) => {
                let name = event.name();
                if local_name_is(name, "f") {
                    in_f = false;
                } else if local_name_is(name, "v") {
                    in_v = false;
                } else if local_name_is(name, "t") {
                    in_t = false;
                } else if local_name_is(name, "rPh") {
                    phonetic_depth = phonetic_depth.saturating_sub(1);
                } else if local_name_is(name, "is") {
                    in_is = false;
                } else if local_name_is(name, "c") {
                    if let Some(value) =
                        cell_value(cell_type, &v_buf, &inline_buf, shared, cell_style, date1904)
                    {
                        push_cell(&mut out, &mut last_row, cell_row, &value);
                    }
                    in_v = false;
                    in_is = false;
                    in_t = false;
                    in_f = false;
                }
            }
            Ok(Event::Text(value)) => {
                if in_f {
                    // Formeltext bewusst nicht in den Suchtext.
                } else if in_v {
                    append_xml_text(&mut v_buf, &value);
                } else if in_t {
                    append_xml_text(&mut inline_buf, &value);
                }
            }
            Ok(Event::GeneralRef(value)) => {
                if in_f {
                } else if in_v {
                    append_general_ref(&mut v_buf, &value);
                } else if in_t {
                    append_general_ref(&mut inline_buf, &value);
                }
            }
            Ok(Event::CData(value)) => {
                if in_f {
                } else if in_v {
                    v_buf.push_str(value.as_ref());
                } else if in_t {
                    inline_buf.push_str(value.as_ref());
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(ContentStatus::ParseError),
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

fn cell_type_from_attrs(event: &quick_xml::events::BytesStart<'_>) -> Result<CellType, ContentStatus> {
    for attr in event.attributes() {
        let attr = attr.map_err(|_| ContentStatus::ParseError)?;
        if attr_local_eq(&attr, "t") {
            let raw = attr_unescaped(&attr)?;
            return Ok(match raw.as_str() {
                "s" => CellType::Shared,
                "inlineStr" => CellType::Inline,
                "b" => CellType::Bool,
                "str" => CellType::Str,
                "n" => CellType::Number,
                "e" => CellType::Skip,
                _ => CellType::Number,
            });
        }
    }
    Ok(CellType::Number)
}

fn style_index_from_attrs(
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<Option<u32>, ContentStatus> {
    for attr in event.attributes() {
        let attr = attr.map_err(|_| ContentStatus::ParseError)?;
        if attr_local_eq(&attr, "s") {
            let raw = attr_unescaped(&attr)?;
            return Ok(raw.parse().ok());
        }
    }
    Ok(None)
}

fn row_from_ref(event: &quick_xml::events::BytesStart<'_>) -> Result<Option<u32>, ContentStatus> {
    for attr in event.attributes() {
        let attr = attr.map_err(|_| ContentStatus::ParseError)?;
        if attr_local_eq(&attr, "r") {
            let raw = attr_unescaped(&attr)?;
            return Ok(parse_row_number(&raw));
        }
    }
    Ok(None)
}

fn parse_row_number(cell_ref: &str) -> Option<u32> {
    let digits = cell_ref.bytes().skip_while(|b| b.is_ascii_alphabetic());
    let raw = String::from_utf8(digits.collect()).ok()?;
    raw.parse().ok()
}

fn cell_value(
    kind: CellType,
    v: &str,
    inline: &str,
    shared: &[String],
    style: NumberStyle,
    date1904: bool,
) -> Option<String> {
    match kind {
        CellType::Skip => None,
        CellType::Inline => {
            let text = inline.trim();
            if text.is_empty() {
                None
            } else {
                Some(inline.to_string())
            }
        }
        CellType::Shared => {
            let index: usize = v.trim().parse().ok()?;
            let text = shared.get(index)?;
            if text.chars().any(|ch| !ch.is_whitespace()) {
                Some(text.clone())
            } else {
                None
            }
        }
        CellType::Bool => {
            let trimmed = v.trim();
            if trimmed == "1" || trimmed.eq_ignore_ascii_case("true") {
                Some("TRUE".into())
            } else if trimmed == "0" || trimmed.eq_ignore_ascii_case("false") {
                Some("FALSE".into())
            } else if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        CellType::Str => {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        CellType::Number => {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(format_numeric_for_search(trimmed, style, date1904))
            }
        }
    }
}

fn push_cell(out: &mut String, last_row: &mut Option<u32>, row: Option<u32>, value: &str) {
    if value.chars().all(|ch| ch.is_whitespace()) {
        return;
    }
    match (row, *last_row) {
        (Some(current), Some(previous)) if current != previous => {
            if !out.ends_with('\n') {
                out.push('\n');
            }
        }
        (Some(_), None) => {}
        _ => {
            if !out.is_empty() && !out.ends_with('\n') && !out.ends_with(' ') {
                out.push(' ');
            }
        }
    }
    if let Some(current) = row {
        *last_row = Some(current);
    }
    out.push_str(value);
}

#[cfg(test)]
fn zip_with_entries(entries: &[(&str, &str)]) -> Vec<u8> {
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, body) in entries {
        zip.start_file(*name, options).expect("start");
        zip.write_all(body.as_bytes()).expect("write");
    }
    zip.finish().expect("finish").into_inner()
}

#[cfg(test)]
pub(crate) fn test_xlsx_from_parts(
    sheet_name: &str,
    shared_strings_xml: Option<&str>,
    sheet_xml: &str,
) -> Vec<u8> {
    test_xlsx_workbook(
        &[(sheet_name, "rId1", "worksheets/sheet1.xml", sheet_xml)],
        shared_strings_xml,
        None,
        false,
    )
}

#[cfg(test)]
fn test_xlsx_sheets(
    sheets: &[(&str, &str, &str, &str)],
    shared_strings_xml: Option<&str>,
) -> Vec<u8> {
    test_xlsx_workbook(sheets, shared_strings_xml, None, false)
}

#[cfg(test)]
fn test_xlsx_workbook(
    sheets: &[(&str, &str, &str, &str)],
    shared_strings_xml: Option<&str>,
    styles_xml: Option<&str>,
    date1904: bool,
) -> Vec<u8> {
    let sheet_tags = sheets
        .iter()
        .enumerate()
        .map(|(i, (name, rid, _, _))| {
            format!(
                r#"<sheet name="{name}" sheetId="{id}" r:id="{rid}"/>"#,
                id = i + 1
            )
        })
        .collect::<String>();
    let workbook_pr = if date1904 {
        r#"<workbookPr date1904="1"/>"#
    } else {
        ""
    };
    let workbook = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  {workbook_pr}
  <sheets>{sheet_tags}</sheets>
</workbook>"#
    );
    let rels_body = sheets
        .iter()
        .map(|(_, rid, target, _)| {
            format!(
                r#"<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{target}"/>"#
            )
        })
        .collect::<String>();
    let rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels_body}</Relationships>"#
    );

    let mut entries: Vec<(String, String)> = vec![
        ("[Content_Types].xml".into(), "<Types/>".into()),
        (WORKBOOK_XML.into(), workbook),
        (WORKBOOK_RELS.into(), rels),
    ];
    if let Some(sst) = shared_strings_xml {
        entries.push((SHARED_STRINGS.into(), sst.to_string()));
    }
    if let Some(styles) = styles_xml {
        entries.push((STYLES_XML.into(), styles.to_string()));
    }
    for (_, _, target, xml) in sheets {
        entries.push((resolve_sheet_target(target), (*xml).to_string()));
    }
    let borrowed: Vec<(&str, &str)> = entries.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    zip_with_entries(&borrowed)
}

#[cfg(test)]
fn sst(items: &[&str]) -> String {
    let body = items
        .iter()
        .map(|text| format!("<si><t>{}</t></si>", xml_escape(text)))
        .collect::<String>();
    format!(r#"<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{body}</sst>"#)
}

#[cfg(test)]
fn sheet_cells(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{body}</sheetData>
</worksheet>"#
    )
}

#[cfg(test)]
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
fn styles_xml(custom: &[(&str, u32)], xf_num_fmt_ids: &[u32]) -> String {
    let num_fmts = if custom.is_empty() {
        String::new()
    } else {
        let inner = custom
            .iter()
            .map(|(code, id)| {
                format!(
                    r#"<numFmt numFmtId="{id}" formatCode="{}"/>"#,
                    xml_escape(code)
                )
            })
            .collect::<String>();
        format!(r#"<numFmts count="{}">{inner}</numFmts>"#, custom.len())
    };
    let xfs = xf_num_fmt_ids
        .iter()
        .map(|id| {
            format!(r#"<xf numFmtId="{id}" fontId="0" fillId="0" borderId="0" xfId="0"/>"#)
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  {num_fmts}
  <cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
  <cellXfs count="{count}">{xfs}</cellXfs>
</styleSheet>"#,
        count = xf_num_fmt_ids.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::extract::MAX_EXTRACTED_TEXT_BYTES;
    use crate::content::extract_path;
    use crate::content::search_file_content;
    use crate::content::{ContentEntry, ContentFormat, ContentStatus};
    use crate::content::ooxml::{
        looks_like_ole_compound, xml_part_exceeds_limit, zip_entry_count_exceeds_limit, OLE_MAGIC,
        MAX_XML_PART_BYTES, MAX_ZIP_ENTRIES,
    };
    use crate::model::{DirectoryListing, FsNode, ScanResult, ScanStats};
    use crate::state::AppState;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempXlsx {
        path: PathBuf,
    }

    impl TempXlsx {
        fn write(label: &str, bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kondos-e3-{}-{}-{}.xlsx",
                label,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            fs::write(&path, bytes).expect("write xlsx");
            Self { path }
        }
    }

    impl Drop for TempXlsx {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn extract_temp(bytes: &[u8]) -> crate::content::ContentEntry {
        let file = TempXlsx::write("case", bytes);
        extract_path(&file.path)
    }

    fn text_of(bytes: &[u8]) -> String {
        extract_xlsx_text(bytes).expect("xlsx text")
    }

    fn text_styled(body: &str, styles: &str, date1904: bool) -> String {
        let sheet = sheet_cells(body);
        let bytes = test_xlsx_workbook(
            &[("Blatt", "rId1", "worksheets/sheet1.xml", &sheet)],
            None,
            Some(styles),
            date1904,
        );
        text_of(&bytes)
    }

    fn search_hits(text: &str, query: &str) -> u64 {
        let path = "C:\\root\\datum.xlsx";
        let state = AppState::new();
        state.store_snapshot(
            1,
            ScanResult {
                root: FsNode::Directory {
                    id: "C:\\root".into(),
                    name: "root".into(),
                    path: "C:\\root".into(),
                    depth: 0,
                    listing: DirectoryListing::Read,
                    children: vec![FsNode::File {
                        id: path.into(),
                        name: "datum.xlsx".into(),
                        path: path.into(),
                        depth: 1,
                        size_bytes: None,
                        created_at_ms: None,
                        modified_at_ms: None,
                    }],
                    size_bytes: None,
                    created_at_ms: None,
                    modified_at_ms: None,
                },
                warnings: Vec::new(),
                stats: ScanStats::default(),
            },
        );
        state
            .insert_content_entry(
                1,
                ContentEntry {
                    path: path.into(),
                    name: "datum.xlsx".into(),
                    format: ContentFormat::Xlsx,
                    status: ContentStatus::Searchable,
                    text: Some(text.into()),
                    extracted_chars: text.chars().count(),
                    truncated: false,
                },
            )
            .expect("insert");
        search_file_content(&state, 1, query)
            .expect("search")
            .total_hit_count
    }

    #[test]
    fn simple_shared_string_and_sheet_name_are_searchable() {
        let bytes = test_xlsx_from_parts(
            "Angebot",
            Some(&sst(&["Hallo Welt"])),
            &sheet_cells(r#"<row r="1"><c r="A1" t="s"><v>0</v></c></row>"#),
        );
        let entry = extract_temp(&bytes);
        assert_eq!(entry.format, ContentFormat::Xlsx);
        assert_eq!(entry.status, ContentStatus::Searchable);
        let text = entry.text.expect("text");
        assert!(text.contains("Angebot"), "{text:?}");
        assert!(text.contains("Hallo Welt"), "{text:?}");
    }

    #[test]
    fn multiple_sheets_follow_workbook_order_and_relationships() {
        let sheet_a = sheet_cells(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Alpha</t></is></c></row>"#);
        let sheet_b = sheet_cells(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Beta</t></is></c></row>"#);
        let bytes = test_xlsx_sheets(
            &[
                ("Zweitblatt", "rId2", "worksheets/customB.xml", &sheet_b),
                ("Erstblatt", "rId1", "worksheets/customA.xml", &sheet_a),
            ],
            None,
        );
        let text = text_of(&bytes);
        let first = text.find("Zweitblatt").expect("first sheet name");
        let second = text.find("Erstblatt").expect("second sheet name");
        assert!(first < second, "{text:?}");
        assert!(text.contains("Beta") && text.contains("Alpha"), "{text:?}");
    }

    #[test]
    fn hidden_and_very_hidden_sheets_are_included() {
        let workbook = r#"<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sichtbar" sheetId="1" r:id="rId1"/>
    <sheet name="Versteckt" sheetId="2" state="hidden" r:id="rId2"/>
    <sheet name="GanzWeg" sheetId="3" state="veryHidden" r:id="rId3"/>
  </sheets>
</workbook>"#;
        let rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>"#;
        let visible = sheet_cells(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>offen</t></is></c></row>"#);
        let hidden = sheet_cells(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>geheim</t></is></c></row>"#);
        let very_hidden = sheet_cells(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>unsichtbar</t></is></c></row>"#);
        let bytes = zip_with_entries(&[
            ("[Content_Types].xml", "<Types/>"),
            (WORKBOOK_XML, workbook),
            (WORKBOOK_RELS, rels),
            ("xl/worksheets/sheet1.xml", &visible),
            ("xl/worksheets/sheet2.xml", &hidden),
            ("xl/worksheets/sheet3.xml", &very_hidden),
        ]);
        let text = text_of(&bytes);
        assert!(text.contains("Versteckt") && text.contains("geheim"), "{text:?}");
        assert!(text.contains("GanzWeg") && text.contains("unsichtbar"), "{text:?}");
    }

    #[test]
    fn shared_string_rich_text_concatenates_t_nodes() {
        let sst = r#"<sst><si><r><t>Hel</t></r><r><t>lo</t></r></si></sst>"#;
        let bytes = test_xlsx_from_parts(
            "Blatt",
            Some(sst),
            &sheet_cells(r#"<row r="1"><c r="A1" t="s"><v>0</v></c></row>"#),
        );
        let text = text_of(&bytes);
        assert!(text.contains("Hello"), "{text:?}");
    }

    #[test]
    fn inline_string_and_inline_rich_text_are_extracted() {
        let body = r#"
          <row r="1">
            <c r="A1" t="inlineStr"><is><t>Einfach</t></is></c>
            <c r="B1" t="inlineStr"><is><r><t>Rich</t></r><r><t>Text</t></r></is></c>
          </row>"#;
        let bytes = test_xlsx_from_parts("Blatt", None, &sheet_cells(body));
        let text = text_of(&bytes);
        assert!(text.contains("Einfach"), "{text:?}");
        assert!(text.contains("Rich") && text.contains("Text"), "{text:?}");
    }

    #[test]
    fn numbers_booleans_and_cached_formula_values_are_extracted() {
        let body = r#"
          <row r="1">
            <c r="A1"><v>42</v></c>
            <c r="B1" t="b"><v>1</v></c>
            <c r="C1"><f>SUM(A1)</f><v>99</v></c>
            <c r="D1" t="str"><v>cached</v></c>
          </row>"#;
        let bytes = test_xlsx_from_parts("Zahlen", None, &sheet_cells(body));
        let text = text_of(&bytes);
        assert!(text.contains("42"), "{text:?}");
        assert!(text.contains("TRUE"), "{text:?}");
        assert!(text.contains("99"), "{text:?}");
        assert!(text.contains("cached"), "{text:?}");
        assert!(!text.contains("SUM"), "{text:?}");
    }

    #[test]
    fn numeric_excel_date_serial_stays_numeric() {
        let body = r#"<row r="1"><c r="A1"><v>44927</v></c></row>"#;
        let bytes = test_xlsx_from_parts("Datum", None, &sheet_cells(body));
        let text = text_of(&bytes);
        assert!(text.contains("44927"), "{text:?}");
        assert!(!text.contains("01.01."), "{text:?}");
        assert!(!text.contains("2023"), "{text:?}");
    }

    #[test]
    fn empty_cells_are_omitted() {
        let body = r#"
          <row r="1">
            <c r="A1"/>
            <c r="B1"><v></v></c>
            <c r="C1" t="inlineStr"><is><t>da</t></is></c>
          </row>"#;
        let bytes = test_xlsx_from_parts("Leer", None, &sheet_cells(body));
        let text = text_of(&bytes);
        assert_eq!(text.matches("da").count(), 1);
    }

    #[test]
    fn unicode_and_umlauts_are_preserved() {
        let bytes = test_xlsx_from_parts(
            "Prüfung",
            Some(&sst(&["Änderung Straße 😀"])),
            &sheet_cells(r#"<row r="1"><c r="A1" t="s"><v>0</v></c></row>"#),
        );
        let text = text_of(&bytes);
        assert!(text.contains("Prüfung") && text.contains("Änderung") && text.contains("Straße"), "{text:?}");
        assert!(text.contains("😀"), "{text:?}");
    }

    #[test]
    fn long_cell_survives_extractor_and_is_truncated_in_cache() {
        let long = "ä".repeat(MAX_EXTRACTED_TEXT_BYTES + 80);
        let body = format!(
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>{}</t></is></c></row>"#,
            xml_escape(&long)
        );
        let bytes = test_xlsx_from_parts("Lang", None, &sheet_cells(&body));
        let entry = extract_temp(&bytes);
        assert_eq!(entry.status, ContentStatus::Searchable);
        assert!(entry.truncated);
        let text = entry.text.expect("text");
        assert!(text.len() <= MAX_EXTRACTED_TEXT_BYTES);
        assert!(text.contains("Lang"));
    }

    #[test]
    fn damaged_zip_is_parse_error() {
        assert_eq!(extract_xlsx_text(b"not-a-zip"), Err(ContentStatus::ParseError));
    }

    #[test]
    fn missing_workbook_is_parse_error() {
        let bytes = zip_with_entries(&[("[Content_Types].xml", "<Types/>")]);
        assert_eq!(extract_xlsx_text(&bytes), Err(ContentStatus::ParseError));
    }

    #[test]
    fn missing_workbook_rels_is_parse_error() {
        let workbook = r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
        let bytes = zip_with_entries(&[(WORKBOOK_XML, workbook)]);
        assert_eq!(extract_xlsx_text(&bytes), Err(ContentStatus::ParseError));
    }

    #[test]
    fn encrypted_office_without_workbook_is_protected() {
        let bytes = zip_with_entries(&[("EncryptionInfo", "x"), ("EncryptedPackage", "y")]);
        assert_eq!(extract_xlsx_text(&bytes), Err(ContentStatus::Protected));
    }

    #[test]
    fn ole_compound_is_protected() {
        let mut bytes = OLE_MAGIC.to_vec();
        bytes.extend_from_slice(&[0; 32]);
        assert!(looks_like_ole_compound(&bytes));
        assert_eq!(extract_xlsx_text(&bytes), Err(ContentStatus::Protected));
    }

    #[test]
    fn xml_and_zip_limits_match_shared_helpers() {
        assert!(xml_part_exceeds_limit(MAX_XML_PART_BYTES + 1));
        assert!(!xml_part_exceeds_limit(MAX_XML_PART_BYTES));
        assert!(zip_entry_count_exceeds_limit(MAX_ZIP_ENTRIES + 1));
        assert_eq!(MAX_XLSX_XML_TOTAL_BYTES, 64 * 1024 * 1024);
        assert!(crate::content::ooxml::xml_total_exceeds_limit(
            MAX_XLSX_XML_TOTAL_BYTES + 1,
            MAX_XLSX_XML_TOTAL_BYTES
        ));
    }

    #[test]
    fn oversized_xml_part_is_too_large() {
        let huge = "a".repeat((MAX_XML_PART_BYTES as usize) + 8);
        let sheet = sheet_cells(&format!(
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>{huge}</t></is></c></row>"#
        ));
        let bytes = test_xlsx_from_parts("Riesig", None, &sheet);
        assert_eq!(extract_xlsx_text(&bytes), Err(ContentStatus::TooLarge));
    }

    #[test]
    fn excel_serial_conversion_covers_1900_leap_and_1904() {
        assert!(is_builtin_date_time_id(14));
        assert!(is_builtin_date_time_id(22));
        assert!(!is_builtin_date_time_id(0));
        assert!(!is_builtin_date_time_id(49));
        assert_eq!(excel_day_to_ymd(1, false), Some((1900, 1, 1)));
        assert_eq!(excel_day_to_ymd(59, false), Some((1900, 2, 28)));
        assert_eq!(excel_day_to_ymd(60, false), Some((1900, 2, 29)));
        assert_eq!(excel_day_to_ymd(61, false), Some((1900, 3, 1)));
        assert_eq!(excel_day_to_ymd(41_720, false), Some((2014, 3, 22)));
        assert_eq!(excel_day_to_ymd(45_794, false), Some((2025, 5, 17)));
        assert_eq!(excel_day_to_ymd(0, true), Some((1904, 1, 1)));
        assert_eq!(excel_day_to_ymd(44_332, true), Some((2025, 5, 17)));
        assert_eq!(excel_day_to_ymd(40_258, true), Some((2014, 3, 22)));
        assert_eq!(
            classify_custom_format("dd.mm.yyyy").kind,
            DateTimeKind::Date
        );
        assert_eq!(classify_custom_format("d.m.yyyy").kind, DateTimeKind::Date);
        assert_eq!(
            classify_custom_format("yyyy-mm-dd").kind,
            DateTimeKind::Date
        );
        assert_eq!(
            classify_custom_format("dd/mm/yyyy").kind,
            DateTimeKind::Date
        );
        assert_eq!(
            classify_custom_format("mm/dd/yyyy").kind,
            DateTimeKind::Date
        );
        assert_eq!(
            classify_custom_format("hh:mm").kind,
            DateTimeKind::Time
        );
        assert!(classify_custom_format("hh:mm:ss").with_seconds);
        assert_eq!(
            classify_custom_format("dd.mm.yyyy hh:mm").kind,
            DateTimeKind::DateTime
        );
        assert_eq!(
            classify_custom_format(r#""Date: "dd.mm.yyyy"#).kind,
            DateTimeKind::Date
        );
        assert_eq!(
            classify_custom_format("[$de-DE]dd.mm.yyyy").kind,
            DateTimeKind::Date
        );
        assert_eq!(classify_custom_format("0.00").kind, DateTimeKind::None);
        assert_eq!(classify_custom_format("#,##0").kind, DateTimeKind::None);
    }

    #[test]
    fn styled_1900_date_17_05_2025_is_extracted() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1"><v>45794</v></c></row>"#, &styles, false);
        assert!(text.contains("17.05.2025"), "{text:?}");
        assert!(text.contains("2025-05-17"), "{text:?}");
        assert!(text.contains("45794"), "{text:?}");
        assert_eq!(search_hits(&text, "17.05.2025"), 1);
        assert_eq!(search_hits(&text, "2025-05-17"), 1);
    }

    #[test]
    fn styled_1900_date_22_03_2014_from_41720() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1"><v>41720</v></c></row>"#, &styles, false);
        assert!(text.contains("22.03.2014"), "{text:?}");
        assert!(text.contains("2014-03-22"), "{text:?}");
        assert!(text.contains("41720"), "{text:?}");
        assert_eq!(search_hits(&text, "22.03.2014"), 1);
        assert_eq!(search_hits(&text, "720"), 0);
    }

    #[test]
    fn date1904_system_converts_serial() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1"><v>44332</v></c></row>"#, &styles, true);
        assert!(text.contains("17.05.2025"), "{text:?}");
        assert!(text.contains("2025-05-17"), "{text:?}");
        assert!(text.contains("44332"), "{text:?}");
    }

    #[test]
    fn excel_1900_leap_serial_60_is_29_feb_1900() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1"><v>60</v></c></row>"#, &styles, false);
        assert!(text.contains("29.02.1900"), "{text:?}");
        assert!(text.contains("1900-02-29"), "{text:?}");
        let serial_59 = text_styled(r#"<row r="1"><c r="A1" s="1"><v>59</v></c></row>"#, &styles, false);
        assert!(serial_59.contains("28.02.1900"), "{serial_59:?}");
        let serial_61 = text_styled(r#"<row r="1"><c r="A1" s="1"><v>61</v></c></row>"#, &styles, false);
        assert!(serial_61.contains("01.03.1900"), "{serial_61:?}");
    }

    #[test]
    fn builtin_numfmt_14_is_date() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1" t="n"><v>45794</v></c></row>"#, &styles, false);
        assert!(text.contains("17.05.2025"), "{text:?}");
    }

    #[test]
    fn custom_dd_mm_yyyy_and_variants() {
        let styles = styles_xml(
            &[
                ("dd.mm.yyyy", 164),
                ("d.m.yyyy", 165),
                ("yyyy-mm-dd", 166),
                ("dd/mm/yyyy", 167),
                ("mm/dd/yyyy", 168),
            ],
            &[0, 164, 165, 166, 167, 168],
        );
        let body = r#"
          <row r="1">
            <c r="A1" s="1"><v>45794</v></c>
            <c r="B1" s="2"><v>45794</v></c>
            <c r="C1" s="3"><v>45794</v></c>
            <c r="D1" s="4"><v>45794</v></c>
            <c r="E1" s="5"><v>45794</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert_eq!(text.matches("17.05.2025").count(), 5, "{text:?}");
        assert!(text.contains("2025-05-17"), "{text:?}");
    }

    #[test]
    fn quoted_and_locale_custom_formats_still_detect_date() {
        let styles = styles_xml(
            &[(r#""am "dd.mm.yyyy"#, 164), ("[$de-DE]dd.mm.yyyy", 165)],
            &[0, 164, 165],
        );
        let body = r#"
          <row r="1">
            <c r="A1" s="1"><v>45794</v></c>
            <c r="B1" s="2"><v>45794</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert_eq!(text.matches("17.05.2025").count(), 2, "{text:?}");
    }

    #[test]
    fn time_hh_mm_and_hh_mm_ss() {
        let styles = styles_xml(&[], &[0, 20, 21]);
        let body = r#"
          <row r="1">
            <c r="A1" s="1"><v>0.3541666666666667</v></c>
            <c r="B1" s="2"><v>0.6024884259259259</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert!(text.contains("08:30"), "{text:?}");
        assert!(!text.contains("08:30:00"), "{text:?}");
        assert!(text.contains("14:27:35"), "{text:?}");
    }

    #[test]
    fn datetime_combined_is_searchable_by_date_and_time() {
        let styles = styles_xml(&[("dd.mm.yyyy hh:mm", 164)], &[0, 164, 22]);
        let body = r#"
          <row r="1">
            <c r="A1" s="1"><v>45794.604166666664</v></c>
            <c r="B1" s="2"><v>45794.604166666664</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert!(text.contains("17.05.2025"), "{text:?}");
        assert!(text.contains("14:30"), "{text:?}");
        assert!(text.contains("2025-05-17"), "{text:?}");
        assert_eq!(search_hits(&text, "17.05.2025"), 1);
        assert_eq!(search_hits(&text, "14:30"), 1);
    }

    #[test]
    fn style_id_maps_to_cellxfs_not_cellstylexfs() {
        let styles = styles_xml(&[], &[0, 14]);
        let body = r#"
          <row r="1">
            <c r="A1" s="0"><v>41720</v></c>
            <c r="B1" s="1"><v>41720</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert!(text.contains("22.03.2014"), "{text:?}");
        let general_only = text_styled(r#"<row r="1"><c r="A1" s="0"><v>41720</v></c></row>"#, &styles, false);
        assert!(general_only.contains("41720"), "{general_only:?}");
        assert!(!general_only.contains("22.03.2014"), "{general_only:?}");
    }

    #[test]
    fn unstyled_720_and_41720_stay_numbers() {
        let styles = styles_xml(&[], &[0, 14]);
        let body = r#"
          <row r="1">
            <c r="A1"><v>720</v></c>
            <c r="B1"><v>41720</v></c>
            <c r="C1"><v>1234.56</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert!(text.contains("720"), "{text:?}");
        assert!(text.contains("41720"), "{text:?}");
        assert!(text.contains("1234.56"), "{text:?}");
        assert!(!text.contains("22.03.2014"), "{text:?}");
        assert_eq!(search_hits(&text, "22.03.2014"), 0);
        assert_eq!(search_hits(&text, "720"), 1);
    }

    #[test]
    fn missing_styles_xml_keeps_numeric_even_with_style_attr() {
        let sheet = sheet_cells(r#"<row r="1"><c r="A1" s="1"><v>45794</v></c></row>"#);
        let bytes = test_xlsx_workbook(
            &[("Blatt", "rId1", "worksheets/sheet1.xml", &sheet)],
            None,
            None,
            false,
        );
        let text = text_of(&bytes);
        assert!(text.contains("45794"), "{text:?}");
        assert!(!text.contains("17.05.2025"), "{text:?}");
    }

    #[test]
    fn unknown_style_index_keeps_numeric() {
        let styles = styles_xml(&[], &[0]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="9"><v>45794</v></c></row>"#, &styles, false);
        assert!(text.contains("45794"), "{text:?}");
        assert!(!text.contains("17.05.2025"), "{text:?}");
    }

    #[test]
    fn unknown_numfmt_and_invalid_custom_format_keep_numeric() {
        let styles = styles_xml(&[("0.00", 164), ("#,##0", 165)], &[0, 99, 164, 165]);
        let body = r#"
          <row r="1">
            <c r="A1" s="1"><v>41720</v></c>
            <c r="B1" s="2"><v>41720</v></c>
            <c r="C1" s="3"><v>41720</v></c>
          </row>"#;
        let text = text_styled(body, &styles, false);
        assert!(!text.contains("22.03.2014"), "{text:?}");
        assert!(text.contains("41720"), "{text:?}");
    }

    #[test]
    fn damaged_styles_xml_does_not_fail_workbook() {
        let sheet = sheet_cells(r#"<row r="1"><c r="A1" s="1"><v>45794</v></c><c r="B1" t="inlineStr"><is><t>ok</t></is></c></row>"#);
        let bytes = test_xlsx_workbook(
            &[("Blatt", "rId1", "worksheets/sheet1.xml", &sheet)],
            None,
            Some("<not-xml"),
            false,
        );
        let text = extract_xlsx_text(&bytes).expect("readable xlsx survives bad styles");
        assert!(text.contains("ok"), "{text:?}");
        assert!(text.contains("45794"), "{text:?}");
        assert!(!text.contains("17.05.2025"), "{text:?}");
    }

    #[test]
    fn invalid_numeric_value_with_date_style_keeps_raw() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(r#"<row r="1"><c r="A1" s="1"><v>kein-datum</v></c></row>"#, &styles, false);
        assert!(text.contains("kein-datum"), "{text:?}");
        assert!(!text.contains("17.05.2025"), "{text:?}");
    }

    #[test]
    fn formula_cached_date_value_uses_style() {
        let styles = styles_xml(&[], &[0, 14]);
        let text = text_styled(
            r#"<row r="1"><c r="A1" s="1"><f>DATE(2025,5,17)</f><v>45794</v></c></row>"#,
            &styles,
            false,
        );
        assert!(text.contains("17.05.2025"), "{text:?}");
        assert!(!text.contains("DATE("), "{text:?}");
    }
}
