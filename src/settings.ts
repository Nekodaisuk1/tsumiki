import {
  applyAppearance,
  choices,
  DRAFT_KEY,
  DRAFT_TIME_KEY,
  defaults,
  type Preferences,
  resetPreferences,
  savePreferences,
  watchPreferences,
} from "./preferences";
import { setupVisualSettings } from "./visual-settings";
import "./workbench.css";
import "./settings.css";

const groups: [string, [keyof Preferences, string][]][] = [
  [
    "外観",
    [
      ["theme", "テーマ"],
      ["largeText", "文字を大きくする"],
      ["palette", "配色"],
      ["boldSelection", "選択中の線を太くする"],
      ["layerLabels", "部材に段番号を表示"],
    ],
  ],
  [
    "3D表示",
    [
      ["surface", "表面の表示"],
      ["color", "色分け"],
      ["nodes", "節点を表示"],
      ["grid", "グリッドを表示"],
      ["axes", "座標軸を表示"],
      ["quality", "描画品質"],
    ],
  ],
  [
    "カメラ",
    [
      ["rotateSpeed", "回転速度"],
      ["panSpeed", "平行移動速度"],
      ["zoomSpeed", "ズーム速度"],
      ["inertia", "操作の慣性"],
      ["cursorZoom", "カーソル位置へズーム"],
    ],
  ],
  [
    "編集",
    [
      ["snap", "移動刻み（座標単位）"],
      ["rotationSnap", "回転刻み（度）"],
      ["undoLimit", "元に戻す履歴数"],
    ],
  ],
  [
    "操作ガイド",
    [
      ["guides", "ショートカットガイドを表示"],
      ["hover", "部材のホバー説明を表示"],
      ["reducedMotion", "動きを減らす（点滅・慣性を抑制）"],
    ],
  ],
  [
    "保存・復元",
    [
      ["autosave", "編集ごとに下書きを自動保存"],
      ["recoveryPrompt", "起動時に下書きの復元を案内"],
    ],
  ],
  ["組立手順", [["assemblySpeed", "1手順の秒数"]]],
];
const names: Record<string, string> = {
  dark: "ダーク",
  light: "ライト",
  system: "OSに合わせる",
  plain: "通常（軽量）",
  wood: "木目",
  material: "材",
  layer: "段",
  low: "軽量",
  standard: "標準",
  "okabe-ito": "色覚サポート（Okabe–Ito）",
  high: "高品質",
};
const root = document.getElementById("settings") as HTMLElement;
root.innerHTML = `<header><h1>設定</h1><button id="close" type="button">閉じる</button></header><p>変更はすぐに反映され、このブラウザに保存されます。</p><label class="search">設定を検索<input id="search" type="search" placeholder="例：ズーム、下書き"></label><div class="settings-layout"><nav aria-label="設定カテゴリ"></nav><main></main></div><p id="empty" hidden>一致する設定はありません。</p><footer><button id="reset-all" type="button">すべて初期値に戻す</button><p id="settings-status" role="status"></p></footer>`;
const status = document.getElementById("settings-status") as HTMLElement;
const report = (error: unknown) => {
  status.textContent = `設定を保存・読込できません: ${String(error)}`;
  status.setAttribute("role", "alert");
};
const run = (action: () => void) => {
  try {
    action();
    status.setAttribute("role", "status");
    status.textContent = "設定を保存しました";
  } catch (error) {
    report(error);
  }
};
for (const [index, [title, fields]] of groups.entries()) {
  const link = document.createElement("a");
  link.href = `#category-${index}`;
  link.textContent = title;
  root.querySelector("nav")?.append(link);
  const section = document.createElement("section");
  section.id = `category-${index}`;
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  for (const [key, label] of fields) {
    const row = document.createElement("label");
    row.className = "setting-row";
    row.textContent = label;
    let control: HTMLInputElement | HTMLSelectElement;
    if (choices[key]) {
      control = document.createElement("select");
      for (const value of choices[key])
        control.add(
          new Option(names[String(value)] ?? (value === "0" ? "自由" : String(value)), String(value)),
        );
    } else {
      control = document.createElement("input");
      control.type = typeof defaults[key] === "boolean" ? "checkbox" : "range";
      if (control.type === "range") {
        control.min = "0.1";
        control.max = "3";
        control.step = "0.1";
      }
    }
    control.id = `setting-${key}`;
    control.addEventListener("change", () =>
      run(() => {
        const value =
          typeof defaults[key] === "boolean"
            ? (control as HTMLInputElement).checked
            : typeof defaults[key] === "number"
              ? Number(control.value)
              : control.value;
        savePreferences({ [key]: value });
      }),
    );
    row.append(control);
    section.append(row);
  }
  const reset = document.createElement("button");
  reset.textContent = "このカテゴリを初期化";
  reset.onclick = () =>
    run(() => savePreferences(Object.fromEntries(fields.map(([key]) => [key, defaults[key]]))));
  section.append(reset);
  if (title === "保存・復元") {
    const info = document.createElement("p");
    info.id = "draft-info";
    section.append(info);
    const remove = document.createElement("button");
    remove.textContent = "下書きを削除";
    remove.onclick = () => {
      if (confirm("このブラウザの下書きを削除しますか？ 開いている設計は変更されません。"))
        run(() => {
          localStorage.removeItem(DRAFT_KEY);
          localStorage.removeItem(DRAFT_TIME_KEY);
          updateDraft();
        });
    };
    section.append(remove);
    const note = document.createElement("p");
    note.textContent =
      "自動保存をOFFにしても既存の下書きは残ります。編集中の設計はファイルでも保存できます。";
    section.append(note);
  }
  root.querySelector("main")?.append(section);
}
function updateDraft() {
  try {
    const time = localStorage.getItem(DRAFT_TIME_KEY);
    const exists = localStorage.getItem(DRAFT_KEY) !== null;
    (document.getElementById("draft-info") as HTMLElement).textContent = exists
      ? `下書きあり・最終保存: ${time ? new Date(time).toLocaleString("ja-JP") : "日時未記録"}`
      : "保存された下書きはありません";
  } catch (error) {
    report(error);
  }
}
watchPreferences((settings) => {
  applyAppearance(settings);
  for (const key of Object.keys(defaults) as (keyof Preferences)[]) {
    const control = document.getElementById(`setting-${key}`) as HTMLInputElement;
    if (typeof settings[key] === "boolean") control.checked = settings[key] as boolean;
    else control.value = String(settings[key]);
  }
}, report);
updateDraft();
window.addEventListener("storage", updateDraft);
(document.getElementById("search") as HTMLInputElement).oninput = (event) => {
  const query = (event.target as HTMLInputElement).value.trim().toLowerCase();
  let count = 0;
  for (const section of root.querySelectorAll("main section")) {
    const visible = section.textContent?.toLowerCase().includes(query) ?? false;
    (section as HTMLElement).hidden = !visible;
    if (visible) count++;
  }
  (document.getElementById("empty") as HTMLElement).hidden = count > 0;
};
document.getElementById("reset-all")?.addEventListener("click", () => {
  if (confirm("すべての設定を初期値に戻しますか？ 設計と下書きは保持されます。"))
    run(() => resetPreferences());
});
document.getElementById("close")?.addEventListener("click", () => window.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("dialog[open]")) window.close();
});

setupVisualSettings(root, report);
