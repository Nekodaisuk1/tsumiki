import { layerColors } from "./color-palette";
import { applyAppearance, type Preferences, readPreferences, savePreferences } from "./preferences";
import { createSeedDesign } from "./structure/editor";
import { Viewport } from "./structure/viewport";

const keys = [
  "theme",
  "largeText",
  "palette",
  "color",
  "surface",
  "boldSelection",
  "layerLabels",
  "reducedMotion",
] as const;

export function setupVisualSettings(root: HTMLElement, report: (error: unknown) => void) {
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "文字・色・線の見やすさ設定";
  root.querySelector(".search")?.before(open);
  const dialog = document.createElement("dialog");
  dialog.className = "visual-settings";
  dialog.setAttribute("aria-labelledby", "visual-title");
  dialog.innerHTML = `<h2 id="visual-title">文字・色・線の見やすさ設定</h2>
    <p>見やすい表示を選んでください。診断ではありません。保存するまで編集画面の設定は変わりません。</p>
    <p id="visual-progress" role="status"></p>
    <div class="visual-layout"><div>
    <fieldset data-step="0"><legend>1. 背景と文字</legend>
      <label>背景<select data-key="theme"><option value="dark">ダーク</option><option value="light">ライト</option><option value="system">OSに合わせる</option></select></label>
      <label><input type="checkbox" data-key="largeText">文字を大きくする</label>
      <label><input type="checkbox" data-key="reducedMotion">動きを減らす</label>
      <p>この文字の大きさ・背景のまぶしさを確認してください。</p>
    </fieldset>
    <fieldset data-step="1" hidden><legend>2. 部材の色分け</legend>
      <label>配色<select data-key="palette"><option value="standard">標準</option><option value="okabe-ito">色覚サポート（Okabe–Ito）</option></select></label>
      <label>色分け<select data-key="color"><option value="material">材の色</option><option value="layer">段ごとの色</option></select></label>
      <label>表面<select data-key="surface"><option value="plain">木目なし</option><option value="wood">木目あり（材の色で表示中のみ）</option></select></label>
      <button type="button" id="visual-unsure">色だけでは区別しにくい・違いが分からない</button>
      <p>段ごとの色を比較できます。色が区別しにくい場合は段番号を表示します。</p>
    </fieldset>
    <fieldset data-step="2" hidden><legend>3. 線と段番号</legend>
      <label><input type="checkbox" data-key="boldSelection">選択中の線を太くする</label>
      <label><input type="checkbox" data-key="layerLabels">部材に段番号を表示</label>
      <p>一番下の部材が選択中です。輪郭と、各部材の段番号を確認してください。プレビューはドラッグで回転できます。</p>
    </fieldset>
    </div><div><div id="visual-preview" aria-label="表示設定の3Dプレビュー"></div><div id="visual-legend"></div></div></div>
    <p id="visual-error" role="alert"></p>
    <div class="visual-actions"><button type="button" id="visual-cancel">キャンセル</button><button type="button" id="visual-back">戻る</button><button type="button" id="visual-next">次へ</button><button type="button" id="visual-save" hidden>保存して終了</button></div>`;
  root.append(dialog);
  const find = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector) as T;
  const controls = dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]");
  let draft: Preferences;
  let step = 0;
  let viewport: Viewport | undefined;
  const design = createSeedDesign();
  const member = design.members[0];
  design.nodes = [];
  design.members = [];
  for (let layer = 0; layer < 4; layer++) {
    design.nodes.push(
      { id: `a${layer}`, position: [0, layer * 0.3, 0], fixed: false },
      { id: `b${layer}`, position: [1.4, layer * 0.3, 0], fixed: false },
    );
    design.members.push({ ...member, id: `m${layer}`, start: `a${layer}`, end: `b${layer}`, layer });
  }
  function render() {
    applyAppearance(draft);
    for (const control of controls) {
      const key = control.dataset.key as (typeof keys)[number];
      if (control instanceof HTMLInputElement) control.checked = Boolean(draft[key]);
      else control.value = String(draft[key]);
    }
    viewport?.setColorMode(draft.color as "material" | "layer");
    viewport?.applyPreferences({ ...draft, nodes: false });
    viewport?.show(design, null, 1, "member:m0");
    find("#visual-legend").innerHTML = layerColors(draft.palette)
      .map(
        (color, index) =>
          `<span><i style="background:#${color.toString(16).padStart(6, "0")}"></i>${index + 1}段</span>`,
      )
      .join("");
    find("#visual-legend").hidden = draft.color !== "layer";
  }
  function showStep() {
    for (const field of dialog.querySelectorAll<HTMLElement>("[data-step]"))
      field.hidden = Number(field.dataset.step) !== step;
    find<HTMLButtonElement>("#visual-back").disabled = step === 0;
    find("#visual-next").hidden = step === 2;
    find("#visual-save").hidden = step !== 2;
    find("#visual-progress").textContent = `${step + 1} / 3`;
    find<HTMLElement>(`[data-step="${step}"] input, [data-step="${step}"] select`).focus();
  }
  open.onclick = () => {
    try {
      draft = readPreferences();
      step = 0;
      find("#visual-error").textContent = "";
      dialog.showModal();
      viewport ??= new Viewport(find("#visual-preview"));
      render();
      viewport.fit();
      showStep();
    } catch (error) {
      dialog.close();
      report(error);
    }
  };
  for (const control of controls)
    control.onchange = () => {
      Object.assign(draft, {
        [control.dataset.key as string]:
          control instanceof HTMLInputElement ? control.checked : control.value,
      });
      render();
    };
  find("#visual-unsure").onclick = () => {
    draft.layerLabels = true;
    render();
    step = 2;
    showStep();
  };
  find("#visual-next").onclick = () => {
    step++;
    showStep();
  };
  find("#visual-back").onclick = () => {
    step--;
    showStep();
  };
  find("#visual-cancel").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    try {
      applyAppearance(readPreferences());
    } catch (error) {
      report(error);
    }
    open.focus();
  });
  find("#visual-save").onclick = () => {
    try {
      savePreferences(Object.fromEntries(keys.map((key) => [key, draft[key]])));
      dialog.close();
    } catch (error) {
      find("#visual-error").textContent = `設定を保存できません: ${String(error)}`;
    }
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (dialog.open) render();
  });
}
