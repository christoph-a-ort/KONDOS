import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts/ts-resolve-hook.mjs")).href);
const read = (file) => readFileSync(join(root, file), "utf8");

const {
  applyUiZoom,
  isUiZoomResetShortcut,
  normalizeUiZoom,
  persistUiZoom,
  readStoredUiZoom,
  stepUiZoom,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  zoomDirectionForWheel,
} = await import(pathToFileURL(join(root, "src/ui/uiZoom.ts")).href);

const assert = (value, label) => {
  if (!value) throw new Error(label);
};

assert(UI_ZOOM_MIN === 70 && UI_ZOOM_MAX === 130, "zoom boundaries");
assert(stepUiZoom(100, 1) === 105 && stepUiZoom(100, -1) === 95, "zoom step");
assert(stepUiZoom(130, 1) === 130 && stepUiZoom(70, -1) === 70, "zoom clamping");
assert(zoomDirectionForWheel({ ctrlKey: true, deltaY: -1 }) === 1, "Ctrl+wheel up");
assert(zoomDirectionForWheel({ ctrlKey: true, deltaY: 1 }) === -1, "Ctrl+wheel down");
assert(zoomDirectionForWheel({ ctrlKey: false, deltaY: -1 }) === null, "normal wheel remains scroll");
assert(isUiZoomResetShortcut({ ctrlKey: true, key: "0" }), "Ctrl+0 reset");
assert(!isUiZoomResetShortcut({ ctrlKey: false, key: "0" }), "plain zero has no zoom effect");

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
persistUiZoom(storage, 115);
assert(readStoredUiZoom(storage) === 115, "persisted zoom");
values.set("dottyfm.ui-zoom.v1", "117");
assert(readStoredUiZoom(storage) === UI_ZOOM_DEFAULT, "invalid stored zoom");
assert(normalizeUiZoom(67) === UI_ZOOM_DEFAULT, "invalid zoom normalization");

const element = { style: { zoom: "115%" } };
applyUiZoom(element, 85);
assert(element.style.zoom === "85%", "layout zoom application");
applyUiZoom(element, UI_ZOOM_DEFAULT);
assert(element.style.zoom === "", "default zoom removal");

const app = read("src/App.tsx");
const css = read("src/App.css");
const capability = read("src-tauri/capabilities/default.json");
const tauriConfig = read("src-tauri/tauri.conf.json");
assert(app.includes("zoomDirectionForWheel") && app.includes('addEventListener("wheel"'), "Ctrl+wheel app integration");
assert(app.includes("isUiZoomResetShortcut") && app.includes('addEventListener("keydown"'), "Ctrl+0 app integration");
assert(app.includes("ui-zoom-control"), "visible zoom control");
assert(app.includes(".setZoom(uiZoom / 100)"), "native Tauri webview zoom");
assert(capability.includes("core:webview:allow-set-webview-zoom"), "webview zoom capability");
assert(tauriConfig.includes('"zoomHotkeysEnabled": false'), "native zoom hotkeys disabled");
assert(!app.includes("transform: scale"), "no transform scaling");
assert(/\.app \{[^}]*height: 100%;[^}]*display: flex/s.test(css), "viewport app layout");
assert(!/\.main-workbench \{[^}]*height: calc\(100vh/s.test(css), "no competing workbench viewport height");

console.log("ui zoom checks passed");
