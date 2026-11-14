//! On-demand local OCR via Windows.Media.Ocr and Windows.Data.Pdf.
//! Used only from inspect. Does not run during scan, prepare, or folder open.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{ContentFormat, ContentStatus};

pub const OCR_PROGRESS_EVENT: &str = "content://ocr-progress";
pub const MAX_OCR_PAGES: u32 = 8;
pub const MIN_USABLE_TEXT_ALNUM: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrProgress {
    pub scan_id: u64,
    pub current_page: u32,
    pub total_pages: u32,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OcrText {
    pub text: String,
    pub page_count: u32,
    pub pages_processed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OcrError {
    Unavailable(String),
    Failed(String),
    Empty,
}

impl OcrError {
    pub fn user_message(&self) -> String {
        match self {
            Self::Unavailable(message) => message.clone(),
            Self::Failed(message) => message.clone(),
            Self::Empty => "Die Texterkennung hat keinen Text gefunden.".into(),
        }
    }
}

pub fn text_layer_is_usable(text: &str) -> bool {
    text.chars().filter(|ch| ch.is_alphanumeric()).count() >= MIN_USABLE_TEXT_ALNUM
}

pub fn should_try_ocr(format: ContentFormat, status: ContentStatus, text: Option<&str>) -> bool {
    match format {
        ContentFormat::Png | ContentFormat::Jpeg => matches!(
            status,
            ContentStatus::NoExtractableText
                | ContentStatus::ParseError
                | ContentStatus::Searchable
        ),
        ContentFormat::Pdf => match status {
            ContentStatus::NoExtractableText | ContentStatus::ParseError => true,
            ContentStatus::Searchable => !text_layer_is_usable(text.unwrap_or("")),
            ContentStatus::Protected
            | ContentStatus::Missing
            | ContentStatus::AccessDenied
            | ContentStatus::IoError
            | ContentStatus::TooLarge => false,
        },
        ContentFormat::Docx | ContentFormat::Xlsx => false,
    }
}

enum OcrMsg {
    Progress(OcrProgress),
    Done(Result<OcrText, OcrError>),
}

pub fn ocr_file(
    path: &Path,
    format: ContentFormat,
    scan_id: u64,
    mut on_progress: impl FnMut(OcrProgress),
) -> Result<OcrText, OcrError> {
    if matches!(format, ContentFormat::Docx | ContentFormat::Xlsx) {
        return Err(OcrError::Failed(
            "Für diesen Dateityp ist keine Texterkennung vorgesehen.".into(),
        ));
    }
    let path = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::Builder::new()
        .name("dottyfm-ocr".into())
        .spawn(move || {
            let mut emit = |progress: OcrProgress| {
                let _ = tx.send(OcrMsg::Progress(progress));
            };
            let result = match format {
                ContentFormat::Pdf => ocr_pdf(&path, scan_id, &mut emit),
                ContentFormat::Png | ContentFormat::Jpeg => ocr_image(&path, scan_id, &mut emit),
                ContentFormat::Docx | ContentFormat::Xlsx => Err(OcrError::Failed(
                    "Für diesen Dateityp ist keine Texterkennung vorgesehen.".into(),
                )),
            };
            let _ = tx.send(OcrMsg::Done(result));
        })
        .map_err(|err| OcrError::Failed(format!("Texterkennung konnte nicht starten ({err}).")))?;
    let mut outcome = Err(OcrError::Failed("Die Texterkennung lieferte kein Ergebnis.".into()));
    while let Ok(message) = rx.recv() {
        match message {
            OcrMsg::Progress(progress) => on_progress(progress),
            OcrMsg::Done(result) => outcome = result,
        }
    }
    match worker.join() {
        Ok(()) => outcome,
        Err(_) => Err(OcrError::Failed("Die Texterkennung wurde unerwartet beendet.".into())),
    }
}

#[cfg(windows)]
fn ocr_image(
    path: &Path,
    scan_id: u64,
    on_progress: &mut dyn FnMut(OcrProgress),
) -> Result<OcrText, OcrError> {
    let bytes = read_limited(path)?;
    on_progress(OcrProgress {
        scan_id,
        current_page: 1,
        total_pages: 1,
        status: "starting".into(),
    });
    let _com = ComGuard::new()?;
    let engine = create_engine()?;
    let text = recognize_image_bytes(&engine, &bytes)?;
    on_progress(OcrProgress {
        scan_id,
        current_page: 1,
        total_pages: 1,
        status: "done".into(),
    });
    if text_layer_is_usable(&text) || !text.trim().is_empty() {
        Ok(OcrText {
            text,
            page_count: 1,
            pages_processed: 1,
        })
    } else {
        Err(OcrError::Empty)
    }
}

#[cfg(windows)]
fn ocr_pdf(
    path: &Path,
    scan_id: u64,
    on_progress: &mut dyn FnMut(OcrProgress),
) -> Result<OcrText, OcrError> {
    let bytes = read_limited(path)?;
    on_progress(OcrProgress {
        scan_id,
        current_page: 0,
        total_pages: 0,
        status: "starting".into(),
    });
    let _com = ComGuard::new()?;
    let engine = create_engine()?;
    let pages = render_pdf_pages(&bytes)?;
    let total = pages.len() as u32;
    if total == 0 {
        return Err(OcrError::Empty);
    }
    let mut combined = String::new();
    for (index, page_bytes) in pages.iter().enumerate() {
        on_progress(OcrProgress {
            scan_id,
            current_page: index as u32 + 1,
            total_pages: total,
            status: "page".into(),
        });
        match recognize_image_bytes(&engine, page_bytes) {
            Ok(page_text) => {
                if !combined.is_empty() && !page_text.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&page_text);
            }
            Err(OcrError::Empty) => {}
            Err(err) => return Err(err),
        }
    }
    on_progress(OcrProgress {
        scan_id,
        current_page: total,
        total_pages: total,
        status: "done".into(),
    });
    if combined.trim().is_empty() {
        Err(OcrError::Empty)
    } else {
        Ok(OcrText {
            text: combined,
            page_count: total,
            pages_processed: total,
        })
    }
}

#[cfg(not(windows))]
fn ocr_image(
    _path: &Path,
    _scan_id: u64,
    _on_progress: &mut dyn FnMut(OcrProgress),
) -> Result<OcrText, OcrError> {
    Err(OcrError::Unavailable(
        "Texterkennung ist nur unter Windows verfügbar.".into(),
    ))
}

#[cfg(not(windows))]
fn ocr_pdf(
    _path: &Path,
    _scan_id: u64,
    _on_progress: &mut dyn FnMut(OcrProgress),
) -> Result<OcrText, OcrError> {
    Err(OcrError::Unavailable(
        "Texterkennung ist nur unter Windows verfügbar.".into(),
    ))
}

fn read_limited(path: &Path) -> Result<Vec<u8>, OcrError> {
    let metadata = std::fs::metadata(path).map_err(|err| io_to_ocr(err))?;
    if super::extract::file_exceeds_size_limit(metadata.len()) {
        return Err(OcrError::Failed(
            "Die Datei ist zu groß für die Texterkennung.".into(),
        ));
    }
    let bytes = std::fs::read(path).map_err(io_to_ocr)?;
    if super::extract::file_exceeds_size_limit(bytes.len() as u64) {
        return Err(OcrError::Failed(
            "Die Datei ist zu groß für die Texterkennung.".into(),
        ));
    }
    Ok(bytes)
}

fn io_to_ocr(err: std::io::Error) -> OcrError {
    match err.kind() {
        std::io::ErrorKind::NotFound => OcrError::Failed("Die Datei ist nicht mehr vorhanden.".into()),
        std::io::ErrorKind::PermissionDenied => {
            OcrError::Failed("Der Zugriff auf die Datei wurde verweigert.".into())
        }
        _ => OcrError::Failed(format!("Die Datei konnte nicht gelesen werden ({err}).")),
    }
}

#[cfg(windows)]
struct ComGuard {
    uninit: bool,
}

#[cfg(windows)]
impl ComGuard {
    fn new() -> Result<Self, OcrError> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        const S_OK: windows::core::HRESULT = windows::core::HRESULT(0);
        const S_FALSE: windows::core::HRESULT = windows::core::HRESULT(1);
        if hr == S_OK {
            Ok(Self { uninit: true })
        } else if hr == S_FALSE || hr == windows::Win32::Foundation::RPC_E_CHANGED_MODE {
            Ok(Self { uninit: false })
        } else {
            Err(OcrError::Failed(format!(
                "Texterkennung konnte nicht starten ({hr})."
            )))
        }
    }
}

#[cfg(windows)]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.uninit {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn create_engine() -> Result<windows::Media::Ocr::OcrEngine, OcrError> {
    use windows::Globalization::Language;
    use windows::Media::Ocr::OcrEngine;
    let unavailable = || {
        OcrError::Unavailable(
            "Texterkennung ist auf diesem Gerät nicht verfügbar. Unter Windows die OCR-Sprache Deutsch installieren.".into(),
        )
    };
    let languages = OcrEngine::AvailableRecognizerLanguages().map_err(|_| unavailable())?;
    if languages.Size().unwrap_or(0) == 0 {
        return Err(unavailable());
    }
    let german = Language::CreateLanguage(&windows::core::HSTRING::from("de-DE")).ok();
    if let Some(language) = german {
        if OcrEngine::IsLanguageSupported(&language).unwrap_or(false) {
            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                return Ok(engine);
            }
        }
    }
    OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| unavailable())
}

#[cfg(windows)]
fn bytes_to_stream(bytes: &[u8]) -> Result<windows::Storage::Streams::InMemoryRandomAccessStream, OcrError> {
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    let stream = InMemoryRandomAccessStream::new().map_err(win_err)?;
    let output = stream.GetOutputStreamAt(0).map_err(win_err)?;
    let writer = DataWriter::CreateDataWriter(&output).map_err(win_err)?;
    writer.WriteBytes(bytes).map_err(win_err)?;
    writer.StoreAsync().map_err(win_err)?.get().map_err(win_err)?;
    writer.FlushAsync().map_err(win_err)?.get().map_err(win_err)?;
    drop(writer);
    stream.Seek(0).map_err(win_err)?;
    Ok(stream)
}

#[cfg(windows)]
fn recognize_image_bytes(
    engine: &windows::Media::Ocr::OcrEngine,
    bytes: &[u8],
) -> Result<String, OcrError> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    let stream = bytes_to_stream(bytes)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let converted = SoftwareBitmap::ConvertWithAlpha(&bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
        .unwrap_or(bitmap);
    let result = engine
        .RecognizeAsync(&converted)
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let text = result.Text().map_err(win_err)?.to_string();
    if text.trim().is_empty() {
        Err(OcrError::Empty)
    } else {
        Ok(text)
    }
}

#[cfg(windows)]
fn render_pdf_pages(bytes: &[u8]) -> Result<Vec<Vec<u8>>, OcrError> {
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Storage::Streams::{Buffer, DataReader, InMemoryRandomAccessStream, InputStreamOptions};
    let input = bytes_to_stream(bytes)?;
    let document = PdfDocument::LoadFromStreamAsync(&input)
        .map_err(win_err)?
        .get()
        .map_err(win_err)?;
    let page_count = document.PageCount().map_err(win_err)?;
    if page_count == 0 {
        return Ok(Vec::new());
    }
    let render_count = page_count.min(MAX_OCR_PAGES);
    let mut pages = Vec::new();
    for index in 0..render_count {
        let page = document.GetPage(index).map_err(win_err)?;
        let stream = InMemoryRandomAccessStream::new().map_err(win_err)?;
        let options = PdfPageRenderOptions::new().map_err(win_err)?;
        let _ = options.SetDestinationWidth(1600);
        page.RenderWithOptionsToStreamAsync(&stream, &options)
            .map_err(win_err)?
            .get()
            .map_err(win_err)?;
        stream.Seek(0).map_err(win_err)?;
        let size = stream.Size().map_err(win_err)?;
        if size == 0 || size > u32::MAX as u64 {
            continue;
        }
        let buffer = Buffer::Create(size as u32).map_err(win_err)?;
        stream
            .ReadAsync(&buffer, size as u32, InputStreamOptions::None)
            .map_err(win_err)?
            .get()
            .map_err(win_err)?;
        let reader = DataReader::FromBuffer(&buffer).map_err(win_err)?;
        let mut page_bytes = vec![0_u8; buffer.Length().map_err(win_err)? as usize];
        reader.ReadBytes(&mut page_bytes).map_err(win_err)?;
        pages.push(page_bytes);
        let _ = page.Close();
    }
    Ok(pages)
}

#[cfg(windows)]
fn win_err(err: windows::core::Error) -> OcrError {
    OcrError::Failed(format!("Texterkennung fehlgeschlagen ({err})."))
}

#[cfg(test)]
mod tests {
    use super::{should_try_ocr, text_layer_is_usable};
    use crate::content::{ContentFormat, ContentStatus};

    #[test]
    fn short_garbage_is_not_a_usable_text_layer() {
        assert!(!text_layer_is_usable(""));
        assert!(!text_layer_is_usable("   \n"));
        assert!(!text_layer_is_usable("iii"));
    }

    #[test]
    fn invoice_text_layer_is_usable() {
        assert!(text_layer_is_usable(
            "Rechnung Mueller GmbH\nRechnungsdatum 28.10.2026"
        ));
    }

    #[test]
    fn pdf_without_text_tries_ocr() {
        assert!(should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::NoExtractableText,
            None
        ));
        assert!(should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::ParseError,
            None
        ));
        assert!(!should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::Protected,
            None
        ));
        assert!(!should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::TooLarge,
            None
        ));
    }

    #[test]
    fn usable_pdf_text_skips_ocr() {
        assert!(!should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::Searchable,
            Some("Rechnung Mueller GmbH Rechnungsdatum 28.10.2026 Betrag")
        ));
        assert!(should_try_ocr(
            ContentFormat::Pdf,
            ContentStatus::Searchable,
            Some("x")
        ));
    }

    #[test]
    fn images_try_ocr_office_does_not() {
        assert!(should_try_ocr(
            ContentFormat::Png,
            ContentStatus::NoExtractableText,
            None
        ));
        assert!(should_try_ocr(
            ContentFormat::Jpeg,
            ContentStatus::NoExtractableText,
            None
        ));
        assert!(!should_try_ocr(
            ContentFormat::Docx,
            ContentStatus::NoExtractableText,
            None
        ));
        assert!(!should_try_ocr(
            ContentFormat::Xlsx,
            ContentStatus::NoExtractableText,
            None
        ));
    }

    fn render_image(path: &std::path::Path, text: &str, jpeg: bool) {
        let script = path.with_extension("ps1");
        let save_path = path.to_string_lossy().replace('\'', "''");
        let format = if jpeg { "[System.Drawing.Imaging.ImageFormat]::Jpeg" } else { "[System.Drawing.Imaging.ImageFormat]::Png" };
        let draw = if text.is_empty() {
            String::new()
        } else {
            let escaped = text.replace('\'', "''");
            format!("$font = New-Object System.Drawing.Font 'Arial', 36\n$g.DrawString('{escaped}', $font, [System.Drawing.Brushes]::Black, 40, 90)\n$font.Dispose()\n")
        };
        std::fs::write(
            &script,
            format!(
                r#"Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1000, 240
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
{draw}$bmp.Save('{save_path}', {format})
$g.Dispose(); $bmp.Dispose()
"#
            ),
        )
        .expect("write ps1");
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .status()
            .expect("powershell");
        let _ = std::fs::remove_file(&script);
        assert!(status.success(), "powershell image render");
        assert!(path.is_file(), "image exists");
    }

    fn temp_image(ext: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kondos-ocr-{}-{}.{ext}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    fn assert_live_date(result: Result<super::OcrText, super::OcrError>, label: &str) {
        match result {
            Ok(text) => {
                eprintln!("live ocr {label} text: {:?}", text.text);
                assert!(
                    text.text.contains("28.10.2026")
                        || text.text.contains("2026-10-28")
                        || text.text.contains("28.10.26"),
                    "{label} ocr text should contain the drawn date, got {:?}",
                    text.text
                );
            }
            Err(err) => panic!("{label} unexpected ocr error: {err:?}"),
        }
    }

    #[test]
    fn live_ocr_png_with_invoice_date() {
        let png = temp_image("png");
        render_image(&png, "Rechnungsdatum 28.10.2026", false);
        let result = super::ocr_file(&png, ContentFormat::Png, 1, |_| {});
        let _ = std::fs::remove_file(&png);
        assert_live_date(result, "png");
    }

    #[test]
    fn live_ocr_jpeg_with_invoice_date() {
        let jpg = temp_image("jpg");
        render_image(&jpg, "Rechnungsdatum 28.10.2026", true);
        let result = super::ocr_file(&jpg, ContentFormat::Jpeg, 1, |_| {});
        let _ = std::fs::remove_file(&jpg);
        assert_live_date(result, "jpeg");
    }

    #[test]
    fn live_ocr_blank_png_has_no_date() {
        let png = temp_image("png");
        render_image(&png, "", false);
        let result = super::ocr_file(&png, ContentFormat::Png, 2, |_| {});
        let _ = std::fs::remove_file(&png);
        match result {
            Err(super::OcrError::Empty) => {}
            Ok(text) => {
                eprintln!("live ocr blank text: {:?}", text.text);
                assert!(
                    !text.text.contains("28.10.2026") && !text.text.contains("2026"),
                    "blank image must not invent a document date"
                );
            }
            Err(err) => panic!("blank png unexpected ocr error: {err:?}"),
        }
    }

    fn original_word_jpeg_fixture() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("testdata")
            .join("ocr")
            .join("original-word-jpg-771x320.jpg")
    }

    #[test]
    fn live_ocr_original_word_jpeg_raw_text() {
        let path = original_word_jpeg_fixture();
        assert!(path.is_file(), "original jpeg fixture missing: {}", path.display());
        match super::ocr_file(&path, ContentFormat::Jpeg, 9, |_| {}) {
            Ok(text) => {
                eprintln!("P2-L.9a ORIGINAL JPEG OCR RAW TEXT BEGIN");
                eprintln!("{}", text.text);
                eprintln!("P2-L.9a ORIGINAL JPEG OCR RAW TEXT END");
                let compact = text.text.replace([' ', '\u{00a0}'], "");
                assert!(
                    text.text.contains("sichtbarem Text"),
                    "original jpeg ocr should read the visible sentence, got {:?}",
                    text.text
                );
                assert!(
                    compact.contains("28.10.2026") || compact.contains("28.10.26"),
                    "original jpeg ocr should contain the visible date, got {:?}",
                    text.text
                );
            }
            Err(err) => {
                eprintln!("P2-L.9a ORIGINAL JPEG OCR ERROR: {err:?}");
                panic!("original jpeg ocr failed: {err:?}");
            }
        }
    }
}
