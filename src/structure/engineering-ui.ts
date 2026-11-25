import type { Design } from "./design";
import {
  analyzeTimber,
  type EngineeringResult,
  type EngineeringSettings,
  TIMBER_SOURCE,
} from "./engineering";
import { mountStress } from "./stress-ui";

export function mountEngineering(host: HTMLElement, getDesign: () => Design, redraw: () => void) {
  const section = document.createElement("section");
  section.innerHTML = `<h3>木材の実寸・静的解析</h3>
  <p class="hint">図面規格専用。全ての接合を剛接合と仮定した部材の参考計算です。</p>
  <label>支え方<select id="timber-support"><option value="floor">地面との接触・摩擦（固定なし）</option><option value="fixed">指定節点を固定（比較用）</option></select></label>
  <label>地面の摩擦係数 μ（仮定）<input id="timber-friction" type="number" min="0" max="2" step="0.05" value="0.5"></label>
  <p class="hint">初期条件は自重のみ。地面は構造の最下点に置きます。浮いた接点には反力がなく、摩擦は μ×垂直反力までです。部材同士の接合は剛接合を仮定します。</p>
  <label>木材プリセット<select id="timber-preset"><option>C16</option><option selected>C24</option></select></label>
  <label>荷重点<select id="timber-node"></select></label>
  <label>荷重方向<select id="timber-axis"><option value="y">Y（上下）</option><option value="x">X</option><option value="z">Z</option></select></label>
  <label>集中荷重（N・下向きは負）<input id="timber-force" type="number" min="-100000" max="100000" step="10" value="0"></label>
  <p class="hint">100 Nは約10.2 kgの重さに相当。固定支持で比較するときは自由節点を選択してください。</p>
  <label><input id="timber-weight" type="checkbox" checked> 自重を含める</label>
  <button id="timber-run" type="button">応力・たわみを計算</button>
  <label><input id="timber-show" type="checkbox"> 実寸解析の色・変形曲線を表示</label>
  <p class="hint">青→赤：各位置の公称垂直応力 小→大。穴・凸部の形状を描画していても、全体解析の色は無欠損梁の値です。白線は変形曲線。表示倍率は下のスライダーで調整できます。</p>
  <label>集中荷重倍率（自重は一定）<input id="timber-ramp" type="range" min="0" max="100" step="10" value="100" disabled></label><button id="timber-ramp-play" type="button" disabled>荷重変化を再生</button><p id="timber-ramp-status" class="hint">0〜100%を各段階で再計算する準静的な再生です。動的解析・実時間ではありません。</p>
  <div id="timber-output" role="status">未計算</div>
  <button id="timber-report" type="button" disabled>↓ 実寸解析記録（設計・条件付き）</button>
  <p class="hint">条件は通常の設計保存には含まれません。解析記録に設計・条件・結果を保存します。</p>
  <a href="${TIMBER_SOURCE}" target="_blank" rel="noreferrer">プリセット出典：Swedish Wood 表3.3（2016）</a><hr>`;
  host.prepend(section);
  const get = <T extends HTMLElement>(id: string) => section.querySelector<T>(`#timber-${id}`) as T;
  const select = (id: string) => get<HTMLSelectElement>(id);
  const input = (id: string) => get<HTMLInputElement>(id);
  const detailHost = document.createElement("div");
  get("output").before(detailHost);
  const details = mountStress(detailHost);
  let result: EngineeringResult | null = null;
  let baseSettings: EngineeringSettings | undefined,
    referenceStress = 0;
  let rampWorker: Worker | undefined,
    rampTimer = 0,
    rampPlaying = false;
  function stopRamp() {
    rampWorker?.terminate();
    rampWorker = undefined;
    clearTimeout(rampTimer);
    rampPlaying = false;
    get("ramp-play").textContent = "荷重変化を再生";
  }
  let snapshot = "";
  let analyzedDesign: Design | null = null;
  const signature = (d: Design) => JSON.stringify({ ...d, view: undefined });
  function clear(message: string) {
    stopRamp();
    details.clear();
    baseSettings = undefined;
    input("ramp").disabled = true;
    get<HTMLButtonElement>("ramp-play").disabled = true;
    result = null;
    input("show").checked = false;
    get<HTMLButtonElement>("report").disabled = true;
    get("output").textContent = message;
  }
  function current(design: Design) {
    const old = select("node").value;
    const nodes = design.nodes.filter((n) => select("support").value === "floor" || !n.fixed);
    input("friction").disabled = select("support").value !== "floor";
    const ids = nodes.map((n) => n.id);
    if (JSON.stringify(Array.from(select("node").options).map((o) => o.value)) !== JSON.stringify(ids)) {
      select("node").replaceChildren(...ids.map((id) => new Option(id, id)));
      if (ids.includes(old)) select("node").value = old;
    }
    get<HTMLButtonElement>("run").disabled = design.version !== 6 || nodes.length === 0;
    if (!result && design.version !== 6) get("output").textContent = "図面規格の設計（v6）を開いてください。";
    else if (!result && nodes.length === 0)
      get("output").textContent =
        "自由節点がありません。部材を追加するか、節点ページで自動支持を解除して実際の支持を設定してください。";
    if (result && snapshot !== signature(design))
      clear("設計・支持・条件が変わりました。再計算してください。");
    return input("show").checked ? result : null;
  }
  for (const id of ["preset", "node", "axis", "force", "weight", "support", "friction"])
    get(id).addEventListener("change", () => {
      clear("条件が変わりました。再計算してください。");
      redraw();
    });
  input("show").addEventListener("change", () => {
    if (!input("show").checked) stopRamp();
    redraw();
  });
  get("run").addEventListener("click", () => {
    try {
      stopRamp();
      const design = getDesign();
      result = analyzeTimber(design, {
        preset: select("preset").value as "C16" | "C24",
        node: select("node").value,
        direction: select("axis").value as "x" | "y" | "z",
        forceN: input("force").valueAsNumber,
        selfWeight: input("weight").checked,
        support: select("support").value as "floor" | "fixed",
        friction: input("friction").valueAsNumber,
      });
      baseSettings = { ...result.settings };
      referenceStress = result.stressScaleMPa;
      input("ramp").value = "100";
      input("ramp").disabled = false;
      get<HTMLButtonElement>("ramp-play").disabled = false;
      publish(design);
    } catch (e) {
      clear(e instanceof Error ? e.message : String(e));
    }
    redraw();
  });
  function publish(design: Design) {
    if (!result) return;
    snapshot = signature(design);
    analyzedDesign = structuredClone(design);
    input("show").checked = true;
    const output = get("output");
    output.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `最大変位 ${result.maxDisplacementMm.toFixed(3)} mm ／ ${result.settings.preset} ／ ${result.settings.forceN} N`;
    const weight = document.createElement("p");
    weight.id = "timber-total-weight";
    weight.textContent = `構造の総重量（解析モデルの概算）：${result.totalMassKg.toFixed(2)} kg ／ 自重 ${result.totalWeightN.toFixed(1)} N`;
    const weightNote = document.createElement("p");
    weightNote.className = "hint";
    weightNote.textContent =
      "選択した木材密度×断面積×解析区間の長さで算出。穴の減量、凸部・端の張り出し・丸材・ロープの重量は未反映です。";
    output.append(weight, weightNote, summary);
    if (result.ground) {
      const contact = document.createElement("p");
      const active = result.ground.contacts.filter((c) => c.force[1] > 1e-6);
      const total = active.reduce((sum, c) => sum + c.force[1], 0);
      contact.textContent = `固定なし・接点 ${active.length}箇所 ／ 地面の垂直反力 ${total.toFixed(2)} N ／ μ=${result.settings.friction}`;
      output.append(contact);
    }
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>部材</th><th>公称垂直応力 MPa</th><th>最大変位 mm</th><th>基準強度比※</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const m of result.members) {
      const row = document.createElement("tr");
      for (const value of [
        m.id,
        m.normalMPa.toFixed(3),
        m.displacementMm.toFixed(3),
        m.referenceRatio.toFixed(3),
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        row.append(td);
      }
      body.append(row);
    }
    table.append(body);
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.append(table);
    output.append(scroll);
    for (const note of [
      "※軸応力/引張または圧縮の特性強度＋曲げ応力/曲げ特性強度。許容応力度・安全率ではありません。せん断・ねじり強度は判定していません。",
      ...result.warnings,
    ]) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = note;
      output.append(p);
    }
    get<HTMLButtonElement>("report").disabled = false;
    details.update(result, design);
  }
  function ramp(percent: number) {
    if (!baseSettings || !analyzedDesign) return;
    rampWorker?.terminate();
    const active = new Worker(new URL("./engineering-worker.ts", import.meta.url), { type: "module" });
    rampWorker = active;
    get("ramp-status").textContent = `${percent}%の静的釣り合いを再計算中（自重一定）…`;
    active.onerror = (e) => {
      if (rampWorker !== active) return;
      clear(`荷重再生エラー：${e.message}`);
      redraw();
    };
    active.onmessage = (e: MessageEvent<{ result?: EngineeringResult; error?: string }>) => {
      if (rampWorker !== active) return;
      active.terminate();
      rampWorker = undefined;
      if (!e.data.result || !analyzedDesign) {
        clear(e.data.error ?? "荷重段階の計算に失敗しました");
        redraw();
        return;
      }
      result = { ...e.data.result, stressScaleMPa: referenceStress };
      input("ramp").value = String(percent);
      publish(analyzedDesign);
      get("ramp-status").textContent =
        `集中荷重 ${percent}%：${result.settings.forceN.toFixed(1)} N ／ 自重一定 ／ 準静的（実時間ではない）`;
      redraw();
      if (rampPlaying && percent < 100 && section.getClientRects().length)
        rampTimer = window.setTimeout(() => ramp(percent + 10), 150);
      else stopRamp();
    };
    active.postMessage({
      design: analyzedDesign,
      settings: { ...baseSettings, forceN: (baseSettings.forceN * percent) / 100 },
    });
  }
  input("ramp").oninput = () => {
    stopRamp();
    ramp(input("ramp").valueAsNumber);
  };
  get("ramp-play").onclick = () => {
    if (rampPlaying) {
      stopRamp();
      return;
    }
    stopRamp();
    rampPlaying = true;
    get("ramp-play").textContent = "荷重再生を停止";
    ramp(0);
  };
  get("report").addEventListener("click", () => {
    current(getDesign());
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "tsumiki-timber-report",
            version: 1,
            units: { mass: "kg", force: "N", length: "m", stress: "MPa", displayDisplacement: "mm" },
            source: TIMBER_SOURCE,
            design: analyzedDesign,
            ...result,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "timber-analysis.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  return { current };
}
