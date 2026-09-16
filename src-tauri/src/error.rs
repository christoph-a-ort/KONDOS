use std::io;

use serde::Serialize;

use crate::model::WarningCode;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorKind {
    InvalidPath,
    InvalidConfig,
    RootInaccessible,
    Cancelled,
    ExportFailed,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: AppErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: AppErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn invalid_path(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::InvalidPath, message)
    }

    pub fn invalid_config(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::InvalidConfig, message)
    }

    pub fn root_inaccessible() -> Self {
        Self::new(
            AppErrorKind::RootInaccessible,
            "Das Startverzeichnis konnte nicht gelesen werden.",
        )
    }

    pub fn cancelled() -> Self {
        Self::new(AppErrorKind::Cancelled, "Die Analyse wurde abgebrochen.")
    }

    pub fn export_failed(message: impl Into<String>) -> Self {
        Self::new(AppErrorKind::ExportFailed, message)
    }

    pub fn internal() -> Self {
        Self::new(
            AppErrorKind::Internal,
            "Die Analyse ist unerwartet fehlgeschlagen.",
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

pub fn warning_code_from_io(err: &io::Error) -> WarningCode {
    match err.kind() {
        io::ErrorKind::PermissionDenied => WarningCode::PermissionDenied,
        io::ErrorKind::NotFound => WarningCode::NotFound,
        _ => WarningCode::IoError,
    }
}

pub fn warning_message_from_io(err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::PermissionDenied => "Keine Leseberechtigung.".to_string(),
        io::ErrorKind::NotFound => "Datei oder Ordner nicht gefunden.".to_string(),
        io::ErrorKind::InvalidInput => "Der Pfad ist ungültig.".to_string(),
        _ => "Element konnte nicht gelesen werden.".to_string(),
    }
}
