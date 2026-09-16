# Dateiliste

Desktop-Anwendung (Tauri 2, React, TypeScript, Rust) zur Erfassung, Anzeige und zum Export von Ordner- und Dateistrukturen.

Architektur: siehe `ARCHITECTURE.md`.

## Entwicklung

Voraussetzungen: Node.js, Rust (MSVC unter Windows), WebView2.

```bash
npm install
npm run typecheck
npm run build
npm run tauri dev
```

Rust-Prüfung im Backend:

```bash
cd src-tauri
cargo test
cargo check
```
