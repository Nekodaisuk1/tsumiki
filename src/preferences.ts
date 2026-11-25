export const SETTINGS_KEY = "tsumiki-preferences-v1";
export const DRAFT_KEY = "tsumiki-design-draft-v2";
export const DRAFT_TIME_KEY = "tsumiki-draft-time";
export const defaults = {
  theme: "dark",
  largeText: false,
  palette: "standard",
  boldSelection: false,
  layerLabels: false,
  surface: "plain",
  color: "material",
  nodes: true,
  grid: true,
  axes: true,
  rotateSpeed: 1,
  panSpeed: 1,
  zoomSpeed: 1,
  inertia: true,
  cursorZoom: false,
  snap: "0.1",
  rotationSnap: "15",
  quality: "standard",
  guides: true,
  hover: true,
  reducedMotion: false,
  autosave: true,
  recoveryPrompt: true,
  undoLimit: 80,
  assemblySpeed: "1.5",
};
export type Preferences = typeof defaults;
export const choices: Partial<Record<keyof Preferences, readonly (string | number)[]>> = {
  palette: ["standard", "okabe-ito"],
  theme: ["dark", "light", "system"],
  surface: ["plain", "wood"],
  color: ["material", "layer"],
  snap: ["0", "0.01", "0.05", "0.1", "0.25"],
  rotationSnap: ["0", "5", "15", "45", "90"],
  quality: ["low", "standard", "high"],
  undoLimit: [20, 80, 200],
  assemblySpeed: ["1.5", "3", "5"],
};
export function parsePreferences(raw: string): Preferences {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("設定形式が不正です");
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Preferences)[]) {
    if (!(key in data)) continue;
    const value = (data as Record<string, unknown>)[key];
    if (
      typeof value !== typeof defaults[key] ||
      (choices[key] && !choices[key]?.includes(value as string | number))
    )
      throw new Error(`設定値が不正です: ${key}`);
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value <= 0 || (key !== "undoLimit" && value > 3))
    )
      throw new Error(`設定値が範囲外です: ${key}`);
    Object.assign(result, { [key]: value });
  }
  return result;
}
export function readPreferences(): Preferences {
  const raw = localStorage.getItem(SETTINGS_KEY);
  return raw === null ? { ...defaults } : parsePreferences(raw);
}
export function savePreferences(patch: Partial<Preferences>) {
  const next = parsePreferences(JSON.stringify({ ...readPreferences(), ...patch }));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("preferences-change"));
}
export function resetPreferences() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
  window.dispatchEvent(new Event("preferences-change"));
}
export function watchPreferences(apply: (settings: Preferences) => void, onError: (error: unknown) => void) {
  const update = () => {
    try {
      apply(readPreferences());
    } catch (error) {
      onError(error);
    }
  };
  const storage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === null) update();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("preferences-change", update);
  update();
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("preferences-change", update);
  };
}
export function applyAppearance(settings: Preferences) {
  document.documentElement.dataset.palette = settings.palette;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.largeText = String(settings.largeText);
  document.documentElement.dataset.guides = String(settings.guides);
  document.documentElement.dataset.hover = String(settings.hover);
  document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
}
