import { analyze, MAX_ANGLE, MIN_ANGLE, MODEL_VERSION, type Point, relax, ropeLength } from "./model";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const root = element("app");
root.innerHTML = `
<header class="topbar"><a class="brand" href="/" aria-label="tsumiki ホーム"><span class="brand-mark">▰</span> tsumiki<span class="brand-sub">構造を、ひもとく。</span></a><span class="version">EXPERIMENT 004 / 006 <b>PROTOTYPE 01</b></span></header>
<main>
  <section class="intro"><div><p class="eyebrow">THE STRUCTURE WORKBENCH</p><h1>ロープで、枠はどう動く？</h1><p>掛け方を確かめ、巻き取りを試す。実物との違いを見つけるための実験室。</p></div><span class="model-badge"><i></i> 2D・仮説検証モデル</span></section>
  <div class="workspace">
    <aside class="panel controls" aria-labelledby="controls-heading"><div class="panel-heading"><span class="step">01</span><h2 id="controls-heading">実験の条件</h2></div>
      <div class="field"><label for="joint-mode">接合の扱い</label><select id="joint-mode"><option value="orthogonal">基本直交（既定）</option><option value="free">自由関節（旧仮定の比較）</option></select><p id="joint-note" class="hint">基本直交で表示。遊びの量は未確定のため、微小な動き・接触反力は未実装です。</p></div>
      <div class="field"><label for="angle">枠の角度 <output id="angle-value" for="angle"></output></label><input id="angle" type="range" min="25" max="155" value="90" step="0.1" disabled><div class="scale"><span>25°</span><span>90° · 長方形</span><span>155°</span></div></div>
      <div class="field"><label for="ratio">雌材 / 雄材の辺長比 <output id="ratio-value" for="ratio"></output></label><input id="ratio" type="range" min="0.6" max="2" value="1.45" step="0.05"><p class="hint">実寸は未設定。雄材の辺長を1とした比率です。</p></div>
      <div class="divider"></div>
      <div class="field"><label for="winding">ADの巻き取り量 <output id="winding-value" for="winding"></output></label><input id="winding" type="range" min="0" max="0.45" value="0.12" step="0.005"><p class="hint">自由長を短くする近似。回転数との換算は未確定。</p></div>
      <div class="field"><label for="stiffness">ロープの相対剛性 <output id="stiffness-value" for="stiffness"></output></label><input id="stiffness" type="range" min="1" max="20" value="8" step="1"></div>
      <div class="buttons"><button id="run" class="primary" type="button" disabled>遊びの解析は未実装</button><button id="reset" type="button">初期化</button></div>
      <button id="rectangle" class="text-button" type="button">90°に配置して比較</button>
      <p class="hint">角度・辺長比を変更すると、その形を基準にロープ自由長を設定し直します。</p>
      <div class="assumption"><span class="tiny-label">この試作で置く仮定</span><p>基本直交 / 遊びは未モデル化 / 剛体の材 / ロープは摩擦なし・均一張力。強度向上の定量評価は未実装。</p></div>
    </aside>
    <section class="panel stage" aria-labelledby="stage-heading"><div class="stage-toolbar"><h2 id="stage-heading">四部材の枠</h2><label class="toggle"><input id="forces" type="checkbox" checked> 力の向き</label></div>
      <div class="stage-note"><span class="dot"></span><span id="mode-status" role="status">基本直交の配置・ロープによる力のみ表示</span></div>
      <svg id="scene" viewBox="0 0 760 490" role="img" aria-labelledby="scene-title scene-description"><title id="scene-title">雄材2本と雌材2本の枠とロープ</title><desc id="scene-description">ロープはAからC、B、Dの順に通り、雄材ADで巻き取ります。矢印はロープが各接触点に及ぼす合力を表します。</desc><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#cbd3ca"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#24786b"/></marker></defs><rect width="760" height="490" fill="url(#grid)"/><g id="drawing"></g></svg>
      <div class="legend"><span><i class="swatch female"></i>雌材 × 2</span><span><i class="swatch male"></i>雄材 × 2</span><span><i class="swatch rope"></i>ロープ A → C → B → D</span><span><i class="swatch force"></i>接触点への合力</span></div>
      <div class="stage-footer"><span>↻ 巻き取り：雄材 AD</span><span>穴・突出部は模式表示 / 丸材は未使用</span></div>
    </section>
    <aside class="panel readings" aria-labelledby="readings-heading"><div class="panel-heading"><span class="step">02</span><h2 id="readings-heading">計算を観察する</h2></div>
      <div class="metric"><span>直角からのずれ</span><strong id="deviation"></strong></div><div class="metric"><span>ロープ経路長 / 雄材長</span><strong id="length"></strong></div><div class="metric"><span>相対張力 <small>実測単位なし</small></span><strong id="tension"></strong></div><div class="metric"><span>状態</span><strong class="state-reading" id="rope-state"></strong></div>
      <div class="trend"><span class="tiny-label">角度とロープ経路長</span><svg id="chart" viewBox="0 0 240 128" role="img" aria-label="理想的な平行四辺形では、ロープ経路長は90度で最大になります"></svg><p>グラフは自由関節と仮定した幾何の比較です。実物は基本直交で、ロープの役割は歪み是正と締め付けによる補強です。</p></div>
      <details><summary>計算モデルを見る</summary><p>L = |AC| + |CB| + |BD|<br>T = k max(0, L − L₀)<br>Q = −T ∂L/∂θ</p><p>既定は90°配置でロープの力のみ計算します。接合反力・遊びは未実装。自由関節の比較モードのみ1自由度の過減衰モデルを使います。N・N·mや実時間を表しません。25°〜155°で計算を停止します。</p></details>
    </aside>
  </div>
  <section class="findings panel" aria-labelledby="findings-heading"><div><p class="eyebrow">WHAT WE NEED TO LEARN</p><h2 id="findings-heading">実物との違いを、次の仕様へ。</h2><p>表示と実物を比べ、違うところを記録してください。</p></div><div class="question-grid"><article><span>01 / 接合</span><h3>遊びはどこまで動く？</h3><p>雄材は雌材にほぼ垂直。遊びの範囲、接触剛性、抜け止めを確認します。</p></article><article><span>02 / 接触</span><h3>ロープはどこに掛かる？</h3><p>突出部の表裏・掛け回し、対角線の交差部は未再現です。</p></article><article><span>03 / 巻き取り</span><h3>ADを回すと何が変わる？</h3><p>巻き付き形状、実際の軸、端の固定先と保持方法を確認します。</p></article></div>
    <div class="observation"><label for="note">観察メモ</label><textarea id="note" rows="3" placeholder="例：実物ではCの突出部の裏側にロープが回る。ADを回すと……"></textarea><div class="observation-actions"><span id="save-status" role="status">条件とメモをMarkdownで保存できます</span><button id="export" type="button">↓ 実験記録を保存</button></div></div>
  </section>
  <footer>寸法は保留中。これは機構の理解を進める試作です。木材の変形・応力・ねじりの解析は未実装です。</footer>
</main>`;

const jointMode = element<HTMLSelectElement>("joint-mode");
const angle = element<HTMLInputElement>("angle");
const ratio = element<HTMLInputElement>("ratio");
const winding = element<HTMLInputElement>("winding");
const stiffness = element<HTMLInputElement>("stiffness");
const forces = element<HTMLInputElement>("forces");
const note = element<HTMLTextAreaElement>("note");
const run = element<HTMLButtonElement>("run");
let baseline = ropeLength(90, 1.45);
let running = false;
let lastTime = 0;
let frameId = 0;
let steps = 0;

function parameters() {
  return {
    angle: Number(angle.value),
    ratio: Number(ratio.value),
    restLength: baseline - Number(winding.value),
    stiffness: Number(stiffness.value),
  };
}
function stop(message = "停止中・条件を変更できます") {
  running = false;
  cancelAnimationFrame(frameId);
  run.textContent = jointMode.value === "free" ? "▶ 動きを試す" : "遊びの解析は未実装";
  element("mode-status").textContent =
    jointMode.value === "free" ? message : "基本直交の配置・ロープによる力のみ表示（接合反力は未実装）";
}
function svgPoint(p: Point): Point {
  return { x: 380 + p.x * 188, y: 245 + p.y * 188 };
}
function line(a: Point, b: Point, css: string, extra = ""): string {
  return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${css}" ${extra}/>`;
}
function render() {
  const state = parameters();
  const result = analyze(state);
  const p = Object.fromEntries(
    Object.entries(result.points).map(([key, value]) => [key, svgPoint(value)]),
  ) as Record<"A" | "B" | "C" | "D", Point>;
  element("angle-value").textContent = `${state.angle.toFixed(1)}°`;
  element("ratio-value").textContent = state.ratio.toFixed(2);
  element("winding-value").textContent = Number(winding.value).toFixed(3);
  element("stiffness-value").textContent = stiffness.value;
  element("deviation").textContent = `${Math.abs(90 - state.angle).toFixed(1)}°`;
  element("length").textContent = result.length.toFixed(3);
  element("tension").textContent = result.tension.toFixed(3);
  element("rope-state").textContent = result.tension > 0.0001 ? "張っている" : "たるみ / 無張力";
  let drawing = line(p.A, p.B, "timber female-member") + line(p.D, p.C, "timber female-member");
  for (const [a, b] of [
    [p.A, p.D],
    [p.B, p.C],
  ]) {
    const dx = (b.x - a.x) * 0.13;
    const dy = (b.y - a.y) * 0.13;
    drawing += line({ x: a.x - dx, y: a.y - dy }, { x: b.x + dx, y: b.y + dy }, "tenon");
    drawing += line(a, b, "timber male-member");
  }
  for (const [a, b] of [
    [p.A, p.B],
    [p.D, p.C],
  ]) {
    for (let i = 1; i < 7; i++)
      drawing += `<circle cx="${a.x + ((b.x - a.x) * i) / 7}" cy="${a.y}" r="4" class="hole"/>`;
  }
  drawing += `<polyline points="${[p.A, p.C, p.B, p.D].map((v) => `${v.x},${v.y}`).join(" ")}" class="rope-path ${result.tension < 0.0001 ? "slack" : ""}"/>`;
  for (const key of ["A", "B", "C", "D"] as const) {
    const point = p[key];
    drawing += `<circle cx="${point.x}" cy="${point.y}" r="7" class="joint"/><text x="${point.x + (key === "A" || key === "D" ? -26 : 20)}" y="${point.y + (key === "A" || key === "B" ? -21 : 31)}" class="corner-label">${key}</text>`;
    if (forces.checked && result.tension > 0.0001) {
      const force = result.forces[key];
      const scale = 55 / Math.max(result.tension, 1);
      drawing += line(
        point,
        { x: point.x + force.x * scale, y: point.y + force.y * scale },
        "force-arrow",
        'marker-end="url(#arrow)"',
      );
    }
  }
  const middle = { x: (p.A.x + p.D.x) / 2, y: (p.A.y + p.D.y) / 2 };
  drawing += `<g transform="translate(${middle.x - 54},${middle.y})"><circle r="22" class="winder"/><text text-anchor="middle" dy="8" class="wind-icon">↻</text><text text-anchor="middle" y="43" class="wind-label">AD 巻き取り</text></g>`;
  element<HTMLElement>("drawing").innerHTML = drawing;
  const samples = Array.from({ length: 66 }, (_, i) => ({
    angle: 25 + i * 2,
    length: ropeLength(25 + i * 2, state.ratio),
  }));
  const low = Math.min(...samples.map((v) => v.length)) - 0.04;
  const high = ropeLength(90, state.ratio) + 0.04;
  const cx = (value: number) => 18 + ((value - 25) / 130) * 205;
  const cy = (value: number) => 96 - ((value - low) / (high - low)) * 76;
  element<HTMLElement>("chart").innerHTML =
    `<line x1="18" y1="100" x2="223" y2="100" stroke="#cbd3ca"/><line x1="${cx(90)}" y1="12" x2="${cx(90)}" y2="100" stroke="#cbd3ca" stroke-dasharray="3 4"/><polyline points="${samples.map((v) => `${cx(v.angle)},${cy(v.length)}`).join(" ")}" fill="none" stroke="#24786b" stroke-width="2.5"/><circle cx="${cx(state.angle)}" cy="${cy(result.length)}" r="5" fill="#c45b35"/><text x="18" y="119">25°</text><text x="112" y="119">90°</text><text x="203" y="119">155°</text>`;
}
function tick(time: number) {
  if (!running) return;
  if (time - lastTime >= 1000 / 30) {
    lastTime = time;
    const before = Number(angle.value);
    const next = relax(parameters(), 1 / 30);
    angle.value = next.toFixed(1);
    steps += 1;
    render();
    if (next <= MIN_ANGLE || next >= MAX_ANGLE) {
      stop("計算範囲の端に到達・実物の停止位置を表すものではありません");
      return;
    }
    if (Math.abs(next - before) < 0.045 || steps >= 900) {
      stop("このモデルでの変化が小さくなりました・安定性は未検証です");
      return;
    }
  }
  frameId = requestAnimationFrame(tick);
}
run.addEventListener("click", () => {
  if (jointMode.value !== "free") return;
  if (running) {
    stop();
    return;
  }
  running = true;
  lastTime = 0;
  steps = 0;
  run.textContent = "Ⅱ 停止する";
  element("mode-status").textContent = "単純モデルの動きを計算中（実時間ではありません）";
  frameId = requestAnimationFrame(tick);
});
jointMode.addEventListener("change", () => {
  const free = jointMode.value === "free";
  angle.disabled = !free;
  run.disabled = !free;
  angle.value = free ? "65" : "90";
  baseline = ropeLength(Number(angle.value), Number(ratio.value));
  element("joint-note").textContent = free
    ? "旧仮定の比較用。25°〜155°の回転は実物の接合遊びを表しません。"
    : "基本直交で表示。遊びの量は未確定のため、微小な動き・接触反力は未実装です。";
  stop("旧仮定の比較モード・実物の接合ではありません");
  render();
});
for (const control of [angle, ratio, winding, stiffness])
  control.addEventListener("input", () => {
    stop();
    if (control === angle || control === ratio)
      baseline = ropeLength(Number(angle.value), Number(ratio.value));
    render();
  });
forces.addEventListener("change", render);
element("reset").addEventListener("click", () => {
  stop("初期条件に戻しました");
  angle.value = jointMode.value === "free" ? "65" : "90";
  ratio.value = "1.45";
  winding.value = "0.12";
  stiffness.value = "8";
  baseline = ropeLength(Number(angle.value), 1.45);
  render();
});
element("rectangle").addEventListener("click", () => {
  stop("90°に配置しました・巻き取りによる整形の結果ではありません");
  angle.value = "90";
  baseline = ropeLength(90, Number(ratio.value));
  render();
});
try {
  note.value = localStorage.getItem("tsumiki-observation-v1") ?? "";
} catch (error) {
  element("save-status").textContent = `メモの復元に失敗しました: ${String(error)}`;
}
note.addEventListener("input", () => {
  try {
    localStorage.setItem("tsumiki-observation-v1", note.value);
    element("save-status").textContent = "メモをこのブラウザに保存しました";
  } catch (error) {
    element("save-status").textContent = `メモの保存に失敗しました: ${String(error)}`;
  }
});
element("export").addEventListener("click", () => {
  const state = parameters();
  const result = analyze(state);
  const record = {
    model: MODEL_VERSION,
    jointMode: jointMode.value,
    recordedAt: new Date().toISOString(),
    ...state,
    baseline,
    winding: Number(winding.value),
    length: result.length,
    tension: result.tension,
    torque: result.torque,
  };
  const text = `# Rope experiment record

## Conditions

${JSON.stringify(record, null, 2)}

## Assumptions

Joint mode: ${jointMode.value}. Orthogonal mode fixes the displayed configuration at 90 degrees; joint clearance and reactions are not modeled. Free mode is a historical diagnostic assumption, not the actual joint. Dimensionless rigid members; uniform elastic rope; route A-C-B-D; winding on AD approximated by rest-length reduction. No calibrated dynamics, stress or torsion analysis.

## Observation

${note.value || "No observation recorded."}
`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tsumiki-rope-${Date.now()}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  element("save-status").textContent = "実験条件と観察メモのダウンロードを開始しました";
});
render();
