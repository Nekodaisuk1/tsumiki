import type { Design } from "./design";
import { TIMBER_PRESETS } from "./engineering";
import type { LocalResult, LocalSettings } from "./local-fem";
import { stressColor } from "./stress";

let open: ((design: Design, preset: keyof typeof TIMBER_PRESETS, member: string) => void) | undefined;
export function openLocalFem(design: Design, preset: keyof typeof TIMBER_PRESETS, member: string) {
  open ??= create();
  open(design, preset, member);
}
function create() {
  const dialog = document.createElement("dialog");
  dialog.className = "local-fem-dialog";
  dialog.setAttribute("aria-labelledby", "local-title");
  dialog.innerHTML = `<div class="assembly-header"><h2 id="local-title">局所FEM・比較用試験片</h2><button id="local-close" type="button">閉じる</button></div><p id="local-origin"></p><p>全体構造とは独立した2次元・平面応力の参考解析です。木目方向の剛性差を扱います。安全・割裂・破壊の判定ではありません。</p><div class="local-layout"><div><canvas id="local-canvas" width="900" height="560" aria-label="局所有限要素の応力分布"></canvas><p id="local-result" role="status">条件を設定して計算してください</p><label>表示成分<select id="local-component"><option value="sx">木目方向 σL</option><option value="sy">木目直交 σT</option><option value="shear">せん断 τLT</option></select></label><label>変形表示倍率<input id="local-scale" type="range" min="0" max="100" value="0"></label><button id="local-save" type="button" disabled>↓ 局所解析JSON</button></div><div class="local-controls">
 <label>試験片<select id="local-kind"><option value="hole">単一丸穴周辺</option><option value="tenon">雄材の凸部と付け根（2D投影）</option><option value="plain">無欠損板（比較用）</option></select></label>
 <label>載荷・支持<select id="local-mode"><option value="traction">右端に荷重・左端支持</option><option value="pin">丸穴の剛体ピン押込み・左右端固定</option></select></label>
 <label>軸力 [N]<input id="local-axial" type="number" value="1000" min="-100000" max="100000"></label><label>面内せん断力 [N]<input id="local-shear" type="number" value="0" min="-100000" max="100000"></label><label>面内曲げ [N·m]<input id="local-moment" type="number" value="0" min="-10000" max="10000"></label>
 <label>ピンの上向き移動 [mm]<input id="local-travel" type="number" value="0.6" min="0" max="2" step="0.1"></label><label>半径方向の隙間 [mm]<input id="local-gap" type="number" value="0.5" min="0" step="0.1"></label>
 <p class="hint">ピンは円形・剛体の比較モデルです。実物の角丸角棒とは異なります。摩擦なし・圧縮のみの接触ばね（代表深さ10mm）で計算し、接触力は結果として求めます。</p>
 <label>木目方向 E [MPa]<input id="local-E" type="number" min="1" step="100"></label><label>木目直交 E [MPa]（初期値E/30は仮定）<input id="local-Et" type="number" min="1" step="10"></label><label>せん断 G [MPa]<input id="local-G" type="number" min="1" step="10"></label><label>ポアソン比 νLT（仮定）<input id="local-nu" type="number" value="0.3" min="0" max="0.49" step="0.01"></label>
 <label>メッシュ<select id="local-refinement"><option value="1">粗</option><option value="2" selected>中</option><option value="3">細</option></select></label><button id="local-run" type="button">局所応力を計算</button>
 <p class="hint">穴は実寸径の単一穴を板幅×1.5以上の範囲で切り出した試験片。隣接穴・端部の丸み・他の材・3D接触は含みません。凸部の肩は鋭角のためピークはメッシュ依存です。板は左端x固定＋1点y固定、凸部は左端完全固定。入力荷重は全体解析から自動転送しません。</p>
 <a href="https://bleyerj.github.io/comet-fenicsx/tours/linear_problems/isotropic_orthotropic_elasticity/isotropic_orthotropic_elasticity.html" target="_blank" rel="noreferrer">計算式：直交異方性・平面応力</a>
 </div></div>`;
  document.body.append(dialog);
  const get = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#local-${id}`) as T;
  const number = (id: string) => get<HTMLInputElement>(id).valueAsNumber;
  let design: Design,
    preset: keyof typeof TIMBER_PRESETS,
    member: string,
    result: LocalResult | undefined,
    worker: Worker | undefined;
  let previous: LocalResult | undefined;
  const paint = () => {
    const canvas = get<HTMLCanvasElement>("canvas"),
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("FEM表示を初期化できません");
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, 900, 560);
    if (!result) return;
    const data = result;
    const component = get<HTMLSelectElement>("component").value as "sx" | "sy" | "shear",
      peak = result.stresses.reduce((v, s) => Math.max(v, Math.abs(s[component])), 0);
    const xs = result.mesh.points.map((p) => p[0]),
      ys = result.mesh.points.map((p) => p[1]),
      xmin = Math.min(...xs),
      xmax = Math.max(...xs),
      ymin = Math.min(...ys),
      ymax = Math.max(...ys),
      scale = Math.min(780 / (xmax - xmin), 420 / (ymax - ymin));
    const factor = number("scale"),
      point = (i: number) => [
        450 + (data.mesh.points[i][0] + data.displacement[2 * i] * factor - (xmin + xmax) / 2) * scale,
        290 - (data.mesh.points[i][1] + data.displacement[2 * i + 1] * factor - (ymin + ymax) / 2) * scale,
      ];
    result.mesh.triangles.forEach((tri, i) => {
      ctx.beginPath();
      tri.forEach((id, j) => {
        const p = point(id);
        if (j === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.closePath();
      ctx.fillStyle = stressColor(data.stresses[i][component], peak, true);
      ctx.fill();
      ctx.strokeStyle = "#0002";
      ctx.lineWidth = 0.4;
      ctx.stroke();
    });
    ctx.fillStyle = "white";
    ctx.font = "18px sans-serif";
    ctx.fillText(
      `${component} [MPa]   青 −${peak.toFixed(3)} / 赤 +${peak.toFixed(3)}    変形×${factor}`,
      20,
      26,
    );
    ctx.fillText("木目 L → / 直交 T ↑  （2D試験片・全体解析とは独立）", 20, 550);
  };
  const clear = () => {
    worker?.terminate();
    worker = undefined;
    previous = result ?? previous;
    result = undefined;
    get<HTMLButtonElement>("save").disabled = true;
    get("result").textContent = "条件が変わりました。再計算してください。";
    paint();
  };
  const sync = () => {
    const pin = get<HTMLSelectElement>("mode").value === "pin";
    for (const id of ["axial", "shear", "moment"]) get<HTMLInputElement>(id).disabled = pin;
    for (const id of ["travel", "gap"]) get<HTMLInputElement>(id).disabled = !pin;
  };
  for (const id of [
    "kind",
    "mode",
    "axial",
    "shear",
    "moment",
    "travel",
    "gap",
    "E",
    "Et",
    "G",
    "nu",
    "refinement",
  ])
    get(id).addEventListener("change", () => {
      if (get<HTMLSelectElement>("kind").value !== "hole") get<HTMLSelectElement>("mode").value = "traction";
      clear();
      sync();
    });
  get("component").onchange = paint;
  get("scale").oninput = paint;
  get("run").onclick = () => {
    clear();
    const g = design.geometry;
    const settings: LocalSettings = {
      kind: get<HTMLSelectElement>("kind").value as LocalSettings["kind"],
      mode: get<HTMLSelectElement>("mode").value as LocalSettings["mode"],
      width: g.boardWidth,
      thickness: g.thickness,
      holeDiameter: g.holeSize,
      tenonWidth: g.tenonSize,
      tenonLength: g.tenonLength,
      E: number("E") * 1e6,
      transverseE: number("Et") * 1e6,
      G: number("G") * 1e6,
      poisson: number("nu"),
      axialN: number("axial"),
      shearN: number("shear"),
      momentNm: number("moment"),
      refinement: Number(get<HTMLSelectElement>("refinement").value),
      pinTravel: number("travel") / 1000,
      clearance: number("gap") / 1000,
    };
    get("result").textContent = "局所FEMを計算中…（閉じると中止）";
    const active = new Worker(new URL("./local-worker.ts", import.meta.url), { type: "module" });
    worker = active;
    active.onerror = (e) => {
      if (worker !== active) return;
      get("result").textContent = `解析エラー：${e.message}`;
      active.terminate();
      worker = undefined;
    };
    active.onmessage = (e: MessageEvent<{ result?: LocalResult; error?: string }>) => {
      if (worker !== active) return;
      active.terminate();
      worker = undefined;
      if (!e.data.result) {
        get("result").textContent = e.data.error ?? "計算結果がありません";
        return;
      }
      result = e.data.result;
      let comparison = "";
      if (
        previous &&
        previous.settings.refinement !== result.settings.refinement &&
        JSON.stringify({ ...previous.settings, refinement: 0 }) ===
          JSON.stringify({ ...result.settings, refinement: 0 })
      )
        comparison = ` 前回メッシュとの差 ${(((result.peakMPa - previous.peakMPa) / Math.max(previous.peakMPa, 1e-12)) * 100).toFixed(1)}%（収束の保証ではありません）。`;
      get("result").textContent =
        `${result.mesh.triangles.length}要素 ／ 最大成分絶対値 ${result.peakMPa.toFixed(3)} MPa ／ 載荷 Fx=${result.applied[0].toFixed(2)}, Fy=${result.applied[1].toFixed(2)} N ／ 反力 Rx=${result.reaction[0].toFixed(2)}, Ry=${result.reaction[1].toFixed(2)} N ／ 平衡残差 ${result.freeResidual.toExponential(2)} N。${comparison}`;
      get<HTMLButtonElement>("save").disabled = false;
      paint();
    };
    active.postMessage(settings);
  };
  get("save").onclick = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "tsumiki-local-fem",
              version: 1,
              member,
              preset,
              assumptions:
                "Independent orthotropic plane-stress specimen. Circular rigid pin approximation. No 3D joint or failure verification.",
              ...result,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "local-fem.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const close = () => {
    worker?.terminate();
    worker = undefined;
    dialog.close();
  };
  get("close").onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return (d: Design, p: keyof typeof TIMBER_PRESETS, id: string) => {
    design = structuredClone(d);
    preset = p;
    member = id;
    previous = undefined;
    result = undefined;
    const wood = TIMBER_PRESETS[p];
    get<HTMLInputElement>("E").value = String(wood.E / 1e6);
    get<HTMLInputElement>("Et").value = String(wood.E / 30 / 1e6);
    get<HTMLInputElement>("G").value = String(wood.G / 1e6);
    get<HTMLSelectElement>("kind").value =
      d.members.find((m) => m.id === id)?.kind === "male" ? "tenon" : "hole";
    get<HTMLSelectElement>("mode").value = "traction";
    get("origin").textContent = `${id} の図面寸法を使用 ／ ${p}（木目直交Eとνは仮定）`;
    dialog.showModal();
    clear();
    sync();
  };
}
