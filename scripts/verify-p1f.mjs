// P1-F1/F2 static rebranding contracts. Not imported by the app.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const app = read("src/App.tsx");
const css = read("src/App.css");
const drop = read("src/scan/dropPaths.ts");
const html = read("index.html");
const tauri = read("src-tauri/tauri.conf.json");
const cargo = read("src-tauri/Cargo.toml");
const mainRs = read("src-tauri/src/main.rs");
const pkg = read("package.json");
const prefs = read("src/ui/workbenchPrefs.ts");
const persist = read("src-tauri/src/export/persist.rs");
const identity = read(".cursor/rules/project-identity.mdc");
const iconConf = JSON.parse(tauri).bundle.icon;

assert(app.includes("<h1>DottyFM</h1>"), "A: App.tsx shows DottyFM");
assert(!app.includes("<h1>KONDOS</h1>"), "B: old h1 KONDOS gone");
assert(drop.includes("auf DottyFM."), "C: drop texts use DottyFM");
assert(!drop.includes("auf KONDOS"), "C: drop texts no KONDOS");
assert(html.includes("<title>DottyFM</title>"), "D: html title");
assert(html.includes('href="/tauri.svg"'), "favicon still tauri.svg");
assert(tauri.includes('"productName": "DottyFM"'), "E: productName");
assert(tauri.includes('"title": "DottyFM"'), "F: window title");
assert(tauri.includes('"identifier": "com.kondos.app"'), "G: identifier unchanged");
assert(cargo.includes('name = "kondos"'), "H: Cargo package remains kondos");
assert(cargo.includes('name = "kondos_lib"'), "I: kondos_lib remains");
assert(mainRs.includes("kondos_lib::run()"), "I: main uses kondos_lib");
assert(JSON.parse(pkg).name === "dottyfm", "J: npm package");
assert(prefs.includes('WORKBENCH_PREFS_KEY = "dottyfm.workbench-prefs.v1"'), "K: new prefs key");
assert(prefs.includes('LEGACY_WORKBENCH_PREFS_KEY = "kondos.workbench-prefs.v1"'), "L: legacy prefs key");
assert(prefs.includes("LEGACY_WORKBENCH_PREFS_KEY"), "L: migration still references legacy");
assert(existsSync(join(root, "src/assets/dottyfm-logo.png")), "M: logo file exists");
assert(app.includes('import dottyFmLogo from "./assets/dottyfm-logo.png"'), "M: logo import");
assert(app.includes("className=\"dottyfm-logo\""), "N: logo in header");
assert(app.includes('alt=""'), "O: decorative alt");
assert(app.includes('aria-hidden="true"'), "P: aria-hidden");
assert(css.includes(".dottyfm-logo"), "Q: logo CSS");
assert(css.includes("height: 76px"), "Q: logo height");
assert(css.includes("height: 48px"), "Q: compact logo height");
assert(persist.includes(".dottyfm-export-"), "R: export temp prefix");
assert(!persist.includes(".kondos-export-"), "R: old export prefix gone");
assert(
  JSON.stringify(iconConf) ===
    JSON.stringify([
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico",
    ]),
  "S: Tauri iconset unchanged",
);
assert(identity.includes("DottyFM"), "identity rule names DottyFM");
assert(identity.includes("com.kondos.app"), "identity rule keeps identifier");

console.log("p1-f checks passed");
