// Drag-to-resize boundaries between the workbench panes (3D view | sidebar, outliner | properties,
// 3D view | timeline). Sizes are stored as CSS custom properties and persisted per browser.

export const LAYOUT_KEY = "tsumiki-layout-v1";
export const PANES = ["side", "outliner", "time"] as const;
export type PaneKey = (typeof PANES)[number];
export type LayoutSizes = Partial<Record<PaneKey, number>>;

/** Smallest space the 3D view keeps next to and above the resizable panes, in CSS pixels. */
export const MIN_VIEW_WIDTH = 320;
export const MIN_VIEW_HEIGHT = 160;
const STEP = 16;
const LARGE_STEP = 64;

/** Keeps a pane size inside [min, max]; when the room is smaller than min, min wins so the pane stays usable. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(value, Math.max(min, max))));
}

/** Reads stored sizes, keeping only finite positive numbers for known panes. */
export function parseLayout(raw: string | null): LayoutSizes {
  if (raw === null) return {};
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("layout must be an object");
  }
  const sizes: LayoutSizes = {};
  for (const key of PANES) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[key] = value;
  }
  return sizes;
}

interface Pane {
  key: PaneKey;
  axis: "x" | "y";
  /** +1 when moving the boundary right/down grows the pane, -1 when it shrinks it. */
  grow: 1 | -1;
  host: HTMLElement;
  cssVar: string;
  /** Element whose rendered size is the pane size. */
  measured: HTMLElement;
  label: string;
  min: number;
  max: () => number;
}

function loadSizes(): LayoutSizes {
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch (error) {
    console.warn("Discarding unreadable pane layout", error);
    localStorage.removeItem(LAYOUT_KEY);
    return {};
  }
}

export function mountSplitters(options: {
  workspace: HTMLElement;
  sidebar: HTMLElement;
  outliner: HTMLElement;
  timeline: HTMLElement;
}): void {
  const { workspace, sidebar, outliner, timeline } = options;
  const toolbarWidth = () => workspace.querySelector<HTMLElement>(".toolbar")?.offsetWidth ?? 0;
  // Grid gaps between the three columns / the two rows also take room from the view.
  const gap = (property: "columnGap" | "rowGap") =>
    Number.parseFloat(getComputedStyle(workspace)[property]) || 0;
  const panes: Pane[] = [
    {
      key: "side",
      axis: "x",
      grow: -1,
      host: workspace,
      cssVar: "--side-width",
      measured: sidebar,
      label: "サイドバーの幅",
      min: 240,
      max: () => workspace.clientWidth - toolbarWidth() - 2 * gap("columnGap") - MIN_VIEW_WIDTH,
    },
    {
      key: "outliner",
      axis: "y",
      grow: 1,
      host: sidebar,
      cssVar: "--outliner-height",
      measured: outliner,
      label: "アウトライナーの高さ",
      min: 60,
      max: () => sidebar.clientHeight - 140,
    },
    {
      key: "time",
      axis: "y",
      grow: -1,
      host: workspace,
      cssVar: "--time-height",
      measured: timeline,
      label: "タイムラインの高さ",
      min: 120,
      max: () => workspace.clientHeight - gap("rowGap") - MIN_VIEW_HEIGHT,
    },
  ];
  const sizes = loadSizes();
  const stacked = matchMedia("(max-width: 900px)");
  const save = () => localStorage.setItem(LAYOUT_KEY, JSON.stringify(sizes));
  const measure = (pane: Pane) => {
    const box = pane.measured.getBoundingClientRect();
    return pane.axis === "x" ? box.width : box.height;
  };
  const handles = new Map<PaneKey, HTMLElement>();

  const syncAria = (pane: Pane) => {
    const handle = handles.get(pane.key);
    if (!handle) return;
    const now = Math.round(measure(pane));
    handle.setAttribute("aria-valuemin", String(pane.min));
    handle.setAttribute("aria-valuemax", String(Math.max(pane.min, Math.round(pane.max()))));
    handle.setAttribute("aria-valuenow", String(now));
  };
  const apply = (pane: Pane) => {
    const stored = sizes[pane.key];
    if (stored === undefined || stacked.matches) {
      pane.host.style.removeProperty(pane.cssVar);
    } else {
      pane.host.style.setProperty(pane.cssVar, `${clampSize(stored, pane.min, pane.max())}px`);
    }
  };
  const applyAll = () => {
    for (const pane of panes) apply(pane);
    for (const pane of panes) syncAria(pane);
  };
  const resize = (pane: Pane, size: number) => {
    sizes[pane.key] = clampSize(size, pane.min, pane.max());
    apply(pane);
    syncAria(pane);
  };

  for (const pane of panes) {
    const handle = document.createElement("div");
    handle.className = `splitter splitter-${pane.axis}`;
    handle.dataset.pane = pane.key;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    // A vertical separator divides side-by-side panes (resized along x).
    handle.setAttribute("aria-orientation", pane.axis === "x" ? "vertical" : "horizontal");
    handle.setAttribute("aria-label", pane.label);
    handle.title = `${pane.label}：ドラッグで変更、ダブルクリックで既定に戻す`;
    handles.set(pane.key, handle);
    (pane.key === "outliner" ? outliner : pane.key === "side" ? sidebar : timeline).append(handle);

    let start: { pointer: number; size: number } | undefined;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      start = { pointer: pane.axis === "x" ? event.clientX : event.clientY, size: measure(pane) };
      document.body.dataset.resizing = pane.axis;
      handle.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!start) return;
      const delta = (pane.axis === "x" ? event.clientX : event.clientY) - start.pointer;
      resize(pane, start.size + pane.grow * delta);
    });
    const finish = (event: PointerEvent) => {
      if (!start) return;
      start = undefined;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      delete document.body.dataset.resizing;
      handle.classList.remove("is-dragging");
      save();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", () => {
      delete sizes[pane.key];
      save();
      apply(pane);
      syncAria(pane);
    });
    handle.addEventListener("keydown", (event) => {
      const keys = pane.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      const direction = keys.indexOf(event.key);
      if (direction < 0) return;
      event.preventDefault();
      // Keys move the boundary itself; convert that to growth of the pane.
      const delta = (direction === 0 ? -1 : 1) * (event.shiftKey ? LARGE_STEP : STEP);
      resize(pane, measure(pane) + pane.grow * delta);
      save();
    });
  }

  applyAll();
  // Panes appear/disappear with the mode (the timeline only in simulation) and the window size changes the room.
  new ResizeObserver(applyAll).observe(workspace);
  new MutationObserver(applyAll).observe(workspace, {
    attributes: true,
    attributeFilter: ["data-mode", "hidden"],
  });
  stacked.addEventListener("change", applyAll);
}
