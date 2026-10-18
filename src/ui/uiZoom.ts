export const UI_ZOOM_DEFAULT = 100;
export const UI_ZOOM_MIN = 70;
export const UI_ZOOM_MAX = 130;
export const UI_ZOOM_STEP = 5;
export const UI_ZOOM_STORAGE_KEY = "dottyfm.ui-zoom.v1";

type ZoomStorage = Pick<Storage, "getItem" | "setItem">;

export function isUiZoom(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= UI_ZOOM_MIN
    && value <= UI_ZOOM_MAX
    && (value - UI_ZOOM_MIN) % UI_ZOOM_STEP === 0;
}

export function normalizeUiZoom(value: unknown): number {
  return isUiZoom(value) ? value : UI_ZOOM_DEFAULT;
}

export function stepUiZoom(current: number, direction: -1 | 1): number {
  const normalized = normalizeUiZoom(current);
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, normalized + direction * UI_ZOOM_STEP));
}

export function zoomDirectionForWheel(event: Pick<WheelEvent, "ctrlKey" | "deltaY">): -1 | 1 | null {
  if (!event.ctrlKey || event.deltaY === 0) {
    return null;
  }
  return event.deltaY < 0 ? 1 : -1;
}

export function isUiZoomResetShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "key">): boolean {
  return event.ctrlKey && event.key === "0";
}

export function readStoredUiZoom(storage: Pick<ZoomStorage, "getItem"> | null): number {
  if (storage === null) {
    return UI_ZOOM_DEFAULT;
  }
  try {
    return normalizeUiZoom(Number(storage.getItem(UI_ZOOM_STORAGE_KEY)));
  } catch {
    return UI_ZOOM_DEFAULT;
  }
}

export function persistUiZoom(storage: Pick<ZoomStorage, "setItem"> | null, zoom: number): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(UI_ZOOM_STORAGE_KEY, String(normalizeUiZoom(zoom)));
  } catch {
    // The zoom remains usable for this session when local storage is unavailable.
  }
}

export function applyUiZoom(documentElement: HTMLElement, zoom: number): void {
  const normalized = normalizeUiZoom(zoom);
  documentElement.style.zoom = normalized === UI_ZOOM_DEFAULT ? "" : `${normalized}%`;
}

export function getUiZoomStorage(): ZoomStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
