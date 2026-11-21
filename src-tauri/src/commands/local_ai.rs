//! P2-L.10b: optional local Ollama. Loopback only, never a remote host.
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::workbench_prefs::{app_data_json_path, read_workbench_prefs_file, write_workbench_prefs_file};
use crate::error::AppError;

pub const LOCAL_AI_PREFS_FILE_NAME: &str = "local-ai.v1.json";
const OLLAMA_PORT: u16 = 11434;
const PROBE_TIMEOUT_MS: u64 = 2500;
const GENERATE_TIMEOUT_MS: u64 = 45_000;
const MAX_HEADER_BYTES: usize = 16_384;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS: usize = 12_000;
const OLLAMA_NUM_PREDICT: u32 = 160;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaProbe {
    pub reachable: bool,
    pub message: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OllamaTimings {
    pub total_ms: u64,
    pub load_ms: u64,
    pub prompt_eval_ms: u64,
    pub eval_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaGenerateResult {
    pub ok: bool,
    pub response: Option<String>,
    pub message: String,
    pub timings: Option<OllamaTimings>,
    pub done_reason: Option<String>,
    pub eval_count: Option<u64>,
}

#[tauri::command]
pub fn load_local_ai_prefs(app: AppHandle) -> Result<Option<String>, AppError> {
    let path = app_data_json_path(&app, LOCAL_AI_PREFS_FILE_NAME)?;
    read_workbench_prefs_file(&path)
}

#[tauri::command]
pub fn save_local_ai_prefs(app: AppHandle, prefs_json: String) -> Result<(), AppError> {
    let path = app_data_json_path(&app, LOCAL_AI_PREFS_FILE_NAME)?;
    write_workbench_prefs_file(&path, &prefs_json)
}

#[tauri::command]
pub fn probe_local_ollama() -> Result<OllamaProbe, AppError> {
    Ok(probe_ollama())
}

#[tauri::command]
pub fn generate_local_ollama(model: String, prompt: String) -> Result<OllamaGenerateResult, AppError> {
    Ok(generate_ollama(&model, &prompt))
}

#[tauri::command]
pub fn log_name_suggest_timings(message: String) -> Result<(), AppError> {
    let trimmed = message.trim();
    if trimmed.starts_with("[Namensvorschlag]") && trimmed.len() <= 800 {
        eprintln!("{trimmed}");
    }
    Ok(())
}

pub fn ollama_loopback_addrs() -> [SocketAddr; 2] {
    [
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), OLLAMA_PORT),
        SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), OLLAMA_PORT),
    ]
}

fn probe_ollama() -> OllamaProbe {
    match http_json("GET", "/api/tags", None, Duration::from_millis(PROBE_TIMEOUT_MS)) {
        Ok((_status, body)) => match parse_model_names(&body) {
            Ok(models) => OllamaProbe {
                reachable: true,
                message: if models.is_empty() {
                    "Ollama ist erreichbar, es ist aber kein Modell installiert.".into()
                } else {
                    format!("Ollama ist erreichbar ({} Modelle).", models.len())
                },
                models,
            },
            Err(_) => OllamaProbe {
                reachable: true,
                message: "Ollama hat eine unerwartete Antwort geliefert.".into(),
                models: Vec::new(),
            },
        },
        Err(message) => OllamaProbe {
            reachable: false,
            message,
            models: Vec::new(),
        },
    }
}

fn generate_ollama(model: &str, prompt: &str) -> OllamaGenerateResult {
    let model = model.trim();
    if !is_allowed_model_name(model) {
        return OllamaGenerateResult {
            ok: false,
            response: None,
            message: "Bitte ein gültiges lokales Modell wählen.".into(),
            timings: None,
            done_reason: None,
            eval_count: None,
        };
    }
    let prompt = truncate_chars(prompt, MAX_PROMPT_CHARS);
    if prompt.trim().is_empty() {
        return OllamaGenerateResult {
            ok: false,
            response: None,
            message: "Für die lokale KI liegt kein Dokumenttext vor.".into(),
            timings: None,
            done_reason: None,
            eval_count: None,
        };
    }
    let body = generate_request_body(model, &prompt);
    match http_json(
        "POST",
        "/api/generate",
        Some(&body),
        Duration::from_millis(GENERATE_TIMEOUT_MS),
    ) {
        Ok((_status, raw)) => match extract_generate_response(&raw) {
            Ok(parsed) => OllamaGenerateResult {
                ok: true,
                response: Some(parsed.response),
                message: "Lokale KI hat einen Vorschlag geliefert.".into(),
                timings: Some(parsed.timings),
                done_reason: parsed.done_reason,
                eval_count: parsed.eval_count,
            },
            Err(message) => OllamaGenerateResult {
                ok: false,
                response: None,
                message,
                timings: None,
                done_reason: None,
                eval_count: None,
            },
        },
        Err(message) => OllamaGenerateResult {
            ok: false,
            response: None,
            message,
            timings: None,
            done_reason: None,
            eval_count: None,
        },
    }
}

fn generate_request_body(model: &str, prompt: &str) -> String {
    json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "format": "json",
        "keep_alive": "30m",
        "options": { "temperature": 0, "num_predict": OLLAMA_NUM_PREDICT }
    })
    .to_string()
}

fn is_allowed_model_name(model: &str) -> bool {
    if model.is_empty() || model.len() > 128 || model.contains("://") {
        return false;
    }
    model
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':' | '/'))
}

fn parse_model_names(body: &str) -> Result<Vec<String>, ()> {
    let value: Value = serde_json::from_str(body).map_err(|_| ())?;
    let models = value.get("models").and_then(Value::as_array).ok_or(())?;
    let mut names = Vec::new();
    for model in models {
        if let Some(name) = model.get("name").and_then(Value::as_str) {
            let trimmed = name.trim();
            if is_allowed_model_name(trimmed) && !names.iter().any(|existing: &String| existing == trimmed) {
                names.push(trimmed.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[derive(Debug)]
struct ParsedGenerateResponse {
    response: String,
    timings: OllamaTimings,
    done_reason: Option<String>,
    eval_count: Option<u64>,
}

fn extract_generate_response(body: &str) -> Result<ParsedGenerateResponse, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| "Die lokale KI hat kein gültiges JSON geliefert.".to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(format!("Lokale KI: {error}"));
    }
    let response = value
        .get("response")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Die lokale KI hat keinen Text geliefert.".to_string())?;
    Ok(ParsedGenerateResponse {
        response: response.to_string(),
        timings: ollama_timings_from_value(&value),
        done_reason: value
            .get("done_reason")
            .and_then(Value::as_str)
            .map(|reason| reason.trim().to_string())
            .filter(|reason| !reason.is_empty()),
        eval_count: json_u64(&value, "eval_count"),
    })
}

fn json_u64(value: &Value, key: &str) -> Option<u64> {
    match value.get(key) {
        Some(Value::Number(number)) => number
            .as_u64()
            .or_else(|| number.as_i64().map(|value| value.max(0) as u64))
            .or_else(|| number.as_f64().map(|value| value.max(0.0) as u64)),
        _ => None,
    }
}

fn ollama_timings_from_value(value: &Value) -> OllamaTimings {
    OllamaTimings {
        total_ms: json_ns_to_ms(value, "total_duration"),
        load_ms: json_ns_to_ms(value, "load_duration"),
        prompt_eval_ms: json_ns_to_ms(value, "prompt_eval_duration"),
        eval_ms: json_ns_to_ms(value, "eval_duration"),
    }
}

fn json_ns_to_ms(value: &Value, key: &str) -> u64 {
    let raw = match value.get(key) {
        Some(Value::Number(number)) => number
            .as_u64()
            .or_else(|| number.as_i64().map(|value| value.max(0) as u64))
            .or_else(|| number.as_f64().map(|value| value.max(0.0) as u64))
            .unwrap_or(0),
        _ => 0,
    };
    raw / 1_000_000
}

fn http_json(
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
) -> Result<(u16, String), String> {
    let payload = body.unwrap_or("");
    let mut last_error = "Ollama ist lokal nicht erreichbar.".to_string();
    for addr in ollama_loopback_addrs() {
        if !addr.ip().is_loopback() {
            continue;
        }
        match http_json_to(addr, method, path, payload, timeout) {
            Ok(result) => return Ok(result),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn http_json_to(
    addr: SocketAddr,
    method: &str,
    path: &str,
    payload: &str,
    timeout: Duration,
) -> Result<(u16, String), String> {
    if !addr.ip().is_loopback() || addr.port() != OLLAMA_PORT {
        return Err("Lokale KI darf nur auf diesem Rechner angesprochen werden.".into());
    }
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|_| unavailable_message())?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|_| "Die Verbindung zur lokalen KI ist fehlgeschlagen.".to_string())?;

    let host = if addr.is_ipv6() {
        format!("[{}]:{OLLAMA_PORT}", addr.ip())
    } else {
        format!("{}:{OLLAMA_PORT}", addr.ip())
    };
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n"
    );
    if !payload.is_empty() {
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .and_then(|_| {
            if payload.is_empty() {
                Ok(())
            } else {
                stream.write_all(payload.as_bytes())
            }
        })
        .and_then(|_| stream.flush())
        .map_err(|_| "Die Anfrage an die lokale KI konnte nicht gesendet werden.".to_string())?;

    let mut bytes = Vec::new();
    let mut buf = [0_u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(read) => {
                bytes.extend_from_slice(&buf[..read]);
                if bytes.len() > MAX_HEADER_BYTES + MAX_BODY_BYTES {
                    return Err("Die Antwort der lokalen KI ist zu groß.".into());
                }
            }
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Err("Die lokale KI hat zu lange nicht geantwortet.".into());
            }
            Err(_) => return Err("Die Antwort der lokalen KI konnte nicht gelesen werden.".into()),
        }
    }
    parse_http_body(&bytes)
}

fn parse_http_body(bytes: &[u8]) -> Result<(u16, String), String> {
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Die lokale KI hat keine vollständige Antwort geliefert.".to_string())?;
    let header = std::str::from_utf8(&bytes[..split])
        .map_err(|_| "Die lokale KI hat eine unlesbare Antwort geliefert.".to_string())?;
    let mut lines = header.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let chunked = header
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked");
    let body = if chunked {
        decode_chunked(&bytes[split + 4..])?
    } else {
        bytes[split + 4..].to_vec()
    };
    if status == 0 {
        return Err("Die lokale KI hat keine HTTP-Antwort geliefert.".into());
    }
    if status == 404 {
        return Err("Ollama ist erreichbar, der Dienst antwortet aber nicht wie erwartet.".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Ollama hat den Zugriff abgelehnt (Status {status})."));
    }
    String::from_utf8(body)
        .map(|text| (status, text))
        .map_err(|_| "Die lokale KI hat keinen Text geliefert.".to_string())
}

fn decode_chunked(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut rest = bytes;
    loop {
        let line_end = rest
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "Die lokale KI hat eine unvollständige Antwort geliefert.".to_string())?;
        let size_line = std::str::from_utf8(&rest[..line_end])
            .map_err(|_| "Die lokale KI hat eine unlesbare Antwort geliefert.".to_string())?;
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "Die lokale KI hat eine unlesbare Antwort geliefert.".to_string())?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            break;
        }
        if rest.len() < size {
            return Err("Die lokale KI hat eine unvollständige Antwort geliefert.".into());
        }
        out.extend_from_slice(&rest[..size]);
        rest = &rest[size..];
        if rest.starts_with(b"\r\n") {
            rest = &rest[2..];
        }
    }
    Ok(out)
}

fn unavailable_message() -> String {
    "Ollama ist lokal nicht erreichbar. Bitte Ollama installieren und starten, ohne Dokumente in die Cloud zu senden.".into()
}

fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_generate_response, generate_request_body, is_allowed_model_name, ollama_loopback_addrs,
        parse_http_body, parse_model_names, probe_ollama, OLLAMA_PORT,
    };

    #[test]
    fn loopback_addresses_are_local_ollama_only() {
        for addr in ollama_loopback_addrs() {
            assert!(addr.ip().is_loopback());
            assert_eq!(addr.port(), OLLAMA_PORT);
        }
    }

    #[test]
    fn model_names_are_restricted() {
        assert!(is_allowed_model_name("llama3.2:latest"));
        assert!(is_allowed_model_name("qwen2.5:7b"));
        assert!(!is_allowed_model_name(""));
        assert!(!is_allowed_model_name("http://example.com/model"));
        assert!(!is_allowed_model_name("model name"));
    }

    #[test]
    fn tags_json_lists_unique_sorted_names() {
        let body = r#"{"models":[{"name":"b:latest"},{"name":"a:latest"},{"name":"a:latest"}]}"#;
        let names = parse_model_names(body).expect("tags");
        assert_eq!(names, vec!["a:latest".to_string(), "b:latest".to_string()]);
    }

    #[test]
    fn generate_json_reads_response_and_errors() {
        let parsed = extract_generate_response(
            r#"{"response":"{\"betreff\":\"Wartung\"}","done_reason":"stop","eval_count":42,"total_duration":2500000000,"load_duration":8000000,"prompt_eval_duration":700000000,"eval_duration":1800000000}"#,
        )
        .expect("ok");
        assert!(parsed.response.contains("Wartung"));
        assert_eq!(parsed.done_reason.as_deref(), Some("stop"));
        assert_eq!(parsed.eval_count, Some(42));
        assert_eq!(parsed.timings.total_ms, 2500);
        assert_eq!(parsed.timings.load_ms, 8);
        assert_eq!(parsed.timings.prompt_eval_ms, 700);
        assert_eq!(parsed.timings.eval_ms, 1800);
        let truncated_body = serde_json::json!({
            "response": "{\"absender\":null,\"dokumenttyp\":\"Z",
            "done_reason": "length",
            "eval_count": 80
        })
        .to_string();
        let truncated = extract_generate_response(&truncated_body).expect("truncated payload is still returned");
        assert_eq!(truncated.done_reason.as_deref(), Some("length"));
        assert_eq!(truncated.eval_count, Some(80));
        assert!(!truncated.response.trim().ends_with('}'), "truncated JSON is not repaired");
        let err = extract_generate_response(r#"{"error":"model not found"}"#).expect_err("err");
        assert!(err.contains("model not found"));
    }

    #[test]
    fn generate_request_keeps_model_loaded_and_caps_output() {
        let body = generate_request_body("llama3.2:3b", "test");
        assert!(body.contains("\"keep_alive\":\"30m\""));
        assert!(body.contains("\"num_predict\":160"));
        assert!(body.contains("\"format\":\"json\""));
    }

    #[test]
    fn live_generate_short_json_reports_done_reason_or_skips() {
        let probe = probe_ollama();
        if !probe.reachable || probe.models.is_empty() {
            eprintln!("live ollama generate skipped: unreachable");
            return;
        }
        let model = &probe.models[0];
        let result = super::generate_ollama(
            model,
            "Nur JSON: {\"absender\":null,\"dokumenttyp\":null,\"betreff\":null,\"thema\":null}. Kein Dokumenttext. Unsicher=null. Kurz.",
        );
        eprintln!(
            "live ollama generate ok={} done={:?} eval_count={:?} response_len={}",
            result.ok,
            result.done_reason,
            result.eval_count,
            result.response.as_deref().unwrap_or("").len()
        );
        if !result.ok {
            return;
        }
        assert_ne!(
            result.done_reason.as_deref(),
            Some("length"),
            "short JSON must not hit num_predict"
        );
        let raw = result.response.as_deref().unwrap_or("");
        assert!(raw.contains('{') && raw.contains('}'), "short JSON should be complete");
    }

    #[test]
    fn http_body_parser_reads_json() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"models\":[]}";
        let (status, body) = parse_http_body(raw).expect("http");
        assert_eq!(status, 200);
        assert!(body.contains("models"));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n000d\r\n{\"models\":[]}\r\n0\r\n\r\n";
        let (_status, chunked_body) = parse_http_body(chunked).expect("chunked");
        assert_eq!(chunked_body, "{\"models\":[]}");
    }

    #[test]
    fn probe_without_server_is_unavailable_not_a_crash() {
        let probe = probe_ollama();
        if probe.reachable {
            eprintln!("live ollama models: {:?}", probe.models);
            assert!(!probe.message.is_empty());
        } else {
            assert!(probe.models.is_empty());
            assert!(probe.message.contains("Ollama"));
        }
    }
}
