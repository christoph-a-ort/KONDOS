# Architektur — DottyFM

Leichtgewichtiges Desktop-Werkzeug zur Erfassung, Visualisierung und zum Export von Ordner- und Dateistrukturen (max. Tiefe 8).

## Modulgrenzen

| Schicht | Ort | Verantwortung |
| --- | --- | --- |
| UI | `src/ui`, `src/App.tsx` | Darstellung, Benutzereingaben, keine Dateisystemanalyse |
| Zustand | `src/state` | Scan-Konfiguration, Fortschritt, Ergebnis, Fehlermeldung |
| Filterung (Eingabe) | `src/filter` | Parsen und Normalisieren von Dateiendungen |
| Scan-API | `src/scan` | Tauri-Invoke, Fortschritts-Events, benutzerfreundliche Fehler |
| Exportformatierung | `src-tauri/src/export` | READ-ONLY-Projektion `ScanResult` → TXT / JSON / CSV |
| Datenmodell | `src/model` und `src-tauri/src/model.rs` | Gemeinsamer IPC-Vertrag |
| Dateisystemanalyse | `src-tauri/src/scan` | Traversierung, Hidden-Erkennung, Metadaten, Warnungen |
| Filterung (Scan) | `src-tauri/src/filter.rs` | Dateiendungsabgleich während der Traversierung |
| Schreibzugriff | `src-tauri/src/commands/export.rs` | Nur expliziter Export (`save_export`) |

Analysezugriffe sind ausschließlich lesend. Schreibzugriffe gibt es nur für vom Benutzer ausgelöste Exportdateien.

## Datenmodell

### `FsNode`

Intern getaggte Unterscheidung `kind: "file" | "directory"`.

- Dateien sind Blattknoten und besitzen **keine** `children`.
- Ordner besitzen immer `children` (ggf. leer).
- `depth`: Root = 0, direkte Kinder = 1, … bis maximal 8.
- `id`: identisch mit dem absoluten Pfad (eindeutig innerhalb eines Scans).
- `sizeBytes` wird nur für Dateien gesetzt (Dateigröße aus Metadaten, keine rekursive Ordnergröße).
- Zeitstempel (`createdAtMs`, `modifiedAtMs`) sind optional und nur gesetzt, wenn die jeweilige Option aktiv ist.
- Kinder eines Ordners: zuerst Ordner, dann Dateien; innerhalb jeder Gruppe Natural Sort nach Name (Groß/Klein ignoriert, Zahlen natürlich). Tie-Breaker: Originalname, dann Pfad.

### `ScanConfig`

- `rootPath`, `maxDepth` (1–8, Standard 8)
- `excludeHidden`
- `extensions` (leer = alle Dateien; Ordner werden trotzdem traversiert)
- `includeSize`, `includeCreatedAt`, `includeModifiedAt`

### `ScanResult`

- `root: DirectoryNode`
- `warnings: ScanWarning[]`
- `stats`: Verzeichnis-/Datei-/Übersprungen-Zähler, `durationMs`

### Fehler

- **Warnung** (unkritisch): Element überspringen, Scan läuft weiter.
- **AppError** (kritisch): Abbruch mit `{ kind, message }` ohne Stacktraces.

## IPC (Rust ↔ React)

| Richtung | Name | Zweck |
| --- | --- | --- |
| Command | `start_scan(config)` | Validieren, Scan im Blocking-Pool, Ergebnis |
| Command | `cancel_scan()` | Kooperativer Abbruch über `AtomicBool` |
| Command | `save_export(path, format, scanId)` | Schreibzugriff nur für Export |
| Command | `copy_export(format, scanId)` | Exporttext für die Zwischenablage |
| Command | `suggest_export_filename(format, scanId)` | Dateinamensvorschlag |
| Event | `scan://progress` | `processedCount`, `currentPath`, `status` |

Ordnerauswahl und „Speichern unter“ laufen über `tauri-plugin-dialog` im Frontend (keine Analyse).

Zwischenablage: `tauri-plugin-clipboard-manager` (nur Schreiben).

## Asynchrone Verarbeitung

1. UI ruft `start_scan` per `invoke` auf (Promise, UI-Thread bleibt frei).
2. Command setzt `AppState.scanning`, setzt Cancel-Flag zurück.
3. Traversierung in `spawn_blocking` (kein Blockieren der async Runtime / UI).
4. Fortschritt gedrosselt (Zeit- und Mengenschwelle), nicht pro Datei.
5. `Drop`-Guard hebt `scanning` auch bei Fehler oder Panic-Pfad auf.
6. Abbruch wird in der Walk-Schleife geprüft; Ergebnis ist `cancelled`, kein Teilergebnis.

## Fortschritt

Keine Prozentanzeige (Gesamtzahl ist vor dem Scan unbekannt).

Angezeigt werden: Aktivität, Anzahl analysierter Elemente, aktueller Pfad, Status (`running` / `completed` / `cancelled` / `failed`).

## Große Tree-Views

In diesem Schritt: rekursive Darstellung **nur sichtbarer** (aufgeklappter) Kinder. Root ist aufgeklappt, tiefere Ebenen standardmäßig zugeklappt.

Spätere Ausbaustufe ohne Modelländerung: sichtbare Knoten flach linearisieren und per Windowing nur den Viewport rendern. Dafür ist kein anderes IPC-Format nötig.

## Exportarchitektur

Formatierung, Serialisierung und Schreiben liegen im Rust-Backend (`src-tauri/src/export`). Das Frontend wählt Format und Zielpfad; es transportiert nicht das vollständige Exportartefakt.

Exportiert wird ausschließlich ein flüchtiger Backend-Snapshot des letzten erfolgreichen `ScanResult` (gleiche `scanId`). Kein erneutes Einlesen des Dateisystems.

| Format | Inhalt |
| --- | --- |
| TXT | Unicode-Baum, Root mit `[Root]`, Ordner mit `/`, UTF-8 ohne BOM, LF |
| JSON | `exportVersion: 1`, Hierarchie mit `children` (auch `[]` bei Dateien), portable `/`-Pfade, UTF-8 ohne BOM, Pretty-Print |
| CSV | Flache Liste, UTF-8 mit BOM, LF, RFC-4180-Quoting |

Pfade im Artefakt sind portabel (Root-Name + Relativpfad, Separator `/`), keine absoluten lokalen Pfade. Warnungen sind im JSON enthalten; TXT/CSV listen Knoten ohne Warning-Block.

Ausgabewege: Zwischenablage (`copy_export`) oder Datei (`save_export` über Temp-Datei/Replace).

## Hidden-Dateien (plattformspezifisch)

Nicht auf einzelne Namen wie `.git` / `.DS_Store` beschränkt:

- **alle Plattformen:** Namen mit führendem `.`
- **Windows:** `FILE_ATTRIBUTE_HIDDEN`
- **macOS:** Finder-Flag `UF_HIDDEN`

## Performance-Leitplanken

- Keine FS-Operationen im UI-Thread
- `DirEntry::file_type` zuerst; volles `metadata()` nur bei Bedarf (Hidden-Attribute oder aktivierte Metadaten)
- Keine zusätzlichen Kopien des Baums über die Serialisierung zum Frontend hinaus
- Extension-Filter verwirft Dateien während des Walks (Ordner nicht)
- Symbolische Verknüpfungen werden nicht gefolgt (Zyklen, unerwartete Graphen)

## Nächste Ausbaustufen (nicht dieser Schritt)

- Drag-and-Drop eines Ordners
- Windowing für sehr große, stark aufgeklappte Bäume
- Parallele Traversierung, falls Messungen das Sequential-Walk-Limit zeigen
