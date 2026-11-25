import type { Design } from "./design";
import type { EngineeringResult } from "./engineering";
import { memberStations, sectionStress, stressColor, stressEnvelope } from "./stress";
export function mountStress(host: HTMLElement) {
  const section = document.createElement("section");
  section.id = "timber-distribution";
  section.hidden = true;
  section.innerHTML = `<h3>材内の応力分布・断面</h3><label>表示する材<select id="stress-member"></select></label><label>切断位置（解析区間の始端→終端）<input id="stress-position" type="range" min="0" max="1000" value="500"></label><p id="stress-value"></p><canvas id="stress-section" width="520" height="230" aria-label="断面内の垂直応力。赤は引張、青は圧縮"></canvas><div id="stress-diagrams"></div><p class="hint">局所y＝板幅、z＝板厚。赤：引張、青：圧縮。無欠損の矩形断面。せん断分布は矩形梁の近似で、ねじりによるせん断・穴の縁の集中は含みません。材に沿う色帯は各位置の最大公称垂直応力、白線は変形です。</p><button id="stress-local" type="button">穴・凸部の局所FEMを開く</button>`;
  host.append(section);
  const select = section.querySelector<HTMLSelectElement>("select") as HTMLSelectElement;
  const range = section.querySelector<HTMLInputElement>("input") as HTMLInputElement;
  let result: EngineeringResult | undefined, design: Design | undefined;
  const render = () => {
    if (!result || !design) return;
    const stations = memberStations(result, select.value);
    if (!stations.length) return;
    const length = stations.at(-1)?.x ?? 0;
    const target = (length * range.valueAsNumber) / 1000;
    const selected = stations.reduce((best, v) =>
      Math.abs(v.x - target) < Math.abs(best.x - target) ? v : best,
    );
    const s = selected.sample,
      g = design.geometry,
      max = stressEnvelope(s, result.material, g.boardWidth, g.thickness);
    const center = sectionStress(s, result.material, g.boardWidth, g.thickness, 0, 0);
    const text = section.querySelector("#stress-value") as HTMLElement;
    text.textContent = `位置 ${(selected.x * 1000).toFixed(1)} mm ／ 最大 |σ| ${max.toFixed(3)} MPa ／ 中心 σ ${center.normalMPa.toFixed(3)} MPa ／ τy ${center.shearYMPa.toFixed(3)}・τz ${center.shearZMPa.toFixed(3)} MPa ／ ねじり ${s.torque.toFixed(3)} N·m`;
    const canvas = section.querySelector("canvas") as HTMLCanvasElement,
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("断面表示を初期化できません");
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, 520, 230);
    const w = 430,
      h = (w * g.thickness) / g.boardWidth,
      x0 = 45,
      y0 = 40;
    for (let i = 0; i < 60; i++)
      for (let j = 0; j < 20; j++) {
        const y = ((i + 0.5) / 60 - 0.5) * g.boardWidth,
          z = (0.5 - (j + 0.5) / 20) * g.thickness;
        ctx.fillStyle = stressColor(
          sectionStress(s, result.material, g.boardWidth, g.thickness, y, z).normalMPa,
          max,
          true,
        );
        ctx.fillRect(x0 + (i * w) / 60, y0 + (j * h) / 20, w / 60 + 1, h / 20 + 1);
      }
    ctx.fillStyle = "white";
    ctx.font = "16px sans-serif";
    ctx.fillText(`断面 σx [MPa]   −${max.toFixed(3)}（圧縮）〜 +${max.toFixed(3)}（引張）`, 20, 22);
    ctx.fillText(
      `y → 板幅 ${(g.boardWidth * 1000).toFixed(0)} mm / z ↑ 板厚 ${(g.thickness * 1000).toFixed(0)} mm`,
      35,
      210,
    );
    const chart = (title: string, series: { name: string; color: string; values: number[] }[]) => {
      const peak = Math.max(0, ...series.flatMap((s) => s.values.map(Math.abs)));
      const maximum = Math.max(1e-12, peak);
      const curves = series
        .map(
          (line) =>
            `<polyline fill="none" stroke="${line.color}" stroke-width="2" points="${line.values.map((v, i) => `${45 + (stations[i].x / Math.max(length, 1e-12)) * 440},${65 - (v / maximum) * 40}`).join(" ")}"/>`,
        )
        .join("");
      return `<svg viewBox="0 0 520 130" role="img" aria-label="${title}"><text x="10" y="16" fill="white" font-size="13">${title}（±${peak.toPrecision(3)}）</text><path d="M45 25V105H485M45 65H485" stroke="#777" fill="none"/>${curves}<path d="M${45 + (selected.x / Math.max(length, 1e-12)) * 440} 25V105" stroke="white" stroke-dasharray="3 3"/><text x="45" y="122" fill="white" font-size="12">0 mm</text><text x="380" y="122" fill="white" font-size="12">${(length * 1000).toFixed(0)} mm</text></svg>`;
    };
    (section.querySelector("#stress-diagrams") as HTMLElement).innerHTML = [
      chart("軸力 N [N]", [{ name: "N", color: "#eac861", values: stations.map((p) => p.sample.axial) }]),
      chart("曲げ My（橙）・Mz（水色）[N·m]", [
        { name: "My", color: "#ffaf70", values: stations.map((p) => p.sample.my) },
        { name: "Mz", color: "#70dfff", values: stations.map((p) => p.sample.mz) },
      ]),
      chart("せん断 Vy（橙）・Vz（水色）[N]", [
        { name: "Vy", color: "#ffaf70", values: stations.map((p) => p.sample.shearY) },
        { name: "Vz", color: "#70dfff", values: stations.map((p) => p.sample.shearZ) },
      ]),
      chart("変位の大きさ [mm]", [
        {
          name: "u",
          color: "white",
          values: stations.map((p) => Math.hypot(...p.sample.displacement) * 1000),
        },
      ]),
    ].join("");
  };
  select.onchange = render;
  range.oninput = render;
  (section.querySelector("button") as HTMLButtonElement).onclick = async () => {
    if (!result || !design) return;
    try {
      const { openLocalFem } = await import("./local-ui");
      openLocalFem(design, result.settings.preset, select.value);
    } catch (error) {
      (section.querySelector("#stress-value") as HTMLElement).textContent = String(error);
    }
  };
  return {
    clear() {
      result = undefined;
      section.hidden = true;
    },
    update(next: EngineeringResult, d: Design) {
      result = next;
      design = d;
      section.hidden = false;
      const old = select.value;
      const ids = d.members.map((m) => m.id);
      if (JSON.stringify([...select.options].map((o) => o.value)) !== JSON.stringify(ids)) {
        select.replaceChildren(...ids.map((id) => new Option(id, id)));
        if (ids.includes(old)) select.value = old;
      }
      render();
    },
  };
}
