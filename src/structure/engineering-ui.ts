import type { Design } from "./design";
import { analyzeTimber, type EngineeringResult, TIMBER_SOURCE } from "./engineering";

export function mountEngineering(host: HTMLElement, getDesign: () => Design, redraw: () => void) {
  const section = document.createElement("section");
  section.innerHTML = `<h3>木材の実寸・静的解析</h3>
  <p class="hint">図面規格専用。全ての接合を剛接合と仮定した部材の参考計算です。</p>
  <label>木材プリセット<select id="timber-preset"><option>C16</option><option selected>C24</option></select></label>
  <label>荷重点<select id="timber-node"></select></label>
  <label>荷重方向<select id="timber-axis"><option value="y">Y（上下）</option><option value="x">X</option><option value="z">Z</option></select></label>
  <label>集中荷重（N・下向きは負）<input id="timber-force" type="number" min="-100000" max="100000" step="10" value="-100"></label>
  <p class="hint">100 Nは約10.2 kgの重さに相当。荷重点は自由節点を選択してください。</p>
  <label><input id="timber-weight" type="checkbox" checked> 自重を含める</label>
  <button id="timber-run" type="button">応力・たわみを計算</button>
  <label><input id="timber-show" type="checkbox"> 実寸解析の色・変形曲線を表示</label>
  <p class="hint">青→赤：公称垂直応力 小→大（部材間の相対値）。白線は変形曲線。表示倍率は下のスライダーで調整できます。</p>
  <div id="timber-output" role="status">未計算</div>
  <button id="timber-report" type="button" disabled>↓ 実寸解析記録（設計・条件付き）</button>
  <p class="hint">条件は通常の設計保存には含まれません。解析記録に設計・条件・結果を保存します。</p>
  <a href="${TIMBER_SOURCE}" target="_blank" rel="noreferrer">プリセット出典：Swedish Wood 表3.3（2016）</a><hr>`;
  host.prepend(section);
  const get = <T extends HTMLElement>(id: string) => section.querySelector<T>(`#timber-${id}`) as T;
  const select = (id: string) => get<HTMLSelectElement>(id);
  const input = (id: string) => get<HTMLInputElement>(id);
  let result: EngineeringResult | null = null;
  let snapshot = "";
  let analyzedDesign: Design | null = null;
  const signature = (d: Design) => JSON.stringify({ ...d, view: undefined });
  function clear(message: string) {
    result = null;
    input("show").checked = false;
    get<HTMLButtonElement>("report").disabled = true;
    get("output").textContent = message;
  }
  function current(design: Design) {
    const old = select("node").value;
    const nodes = design.nodes.filter((n) => !n.fixed);
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
  for (const id of ["preset", "node", "axis", "force", "weight"])
    get(id).addEventListener("change", () => {
      clear("条件が変わりました。再計算してください。");
      redraw();
    });
  input("show").addEventListener("change", redraw);
  get("run").addEventListener("click", () => {
    try {
      const design = getDesign();
      result = analyzeTimber(design, {
        preset: select("preset").value as "C16" | "C24",
        node: select("node").value,
        direction: select("axis").value as "x" | "y" | "z",
        forceN: input("force").valueAsNumber,
        selfWeight: input("weight").checked,
      });
      snapshot = signature(design);
      analyzedDesign = structuredClone(design);
      input("show").checked = true;
      const output = get("output");
      output.replaceChildren();
      const summary = document.createElement("p");
      summary.textContent = `最大変位 ${result.maxDisplacementMm.toFixed(3)} mm ／ ${result.settings.preset} ／ ${result.settings.forceN} N`;
      output.append(summary);
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
    } catch (e) {
      clear(e instanceof Error ? e.message : String(e));
    }
    redraw();
  });
  get("report").addEventListener("click", () => {
    current(getDesign());
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "tsumiki-timber-report",
            version: 1,
            units: { force: "N", length: "m", stress: "MPa", displayDisplacement: "mm" },
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
