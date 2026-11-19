import { createDesign, type Design, parseDesign, serializeDesign, validateDesign } from "./structure/design";
import { appendMember, DesignHistory, extendBay, insertMaleAtHole } from "./structure/editor";
import { freeRingSlot } from "./structure/geometry";
import { holeOccupied, insertionPreview } from "./structure/holes";
import { detectRopeFrames, ropeOnFrame, routeForWinder, windingUnavailable } from "./structure/rope";
import { nextOuterLayer } from "./structure/seats";
import { type Excitation, type RopeMode, simulate, solveStatic } from "./structure/solver";
import { Viewport } from "./structure/viewport";
import "./workbench.css";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const modes: RopeMode[] = ["none", "slack", "taut"];
const names: Record<RopeMode, string> = { none: "ロープなし", slack: "たるみあり", taut: "張力あり" };
let design = createDesign();
let selected = "n6";
let selectedMember = "m0";
let selectedRing = "";
let selectionType: "node" | "member" | "ring" = "node";
let connectStart: string | null = null;
let choosingHole = false;
let choosingFrame = false;
let chosenFrame = "";
let malePreview: ReturnType<typeof insertionPreview> | null = null;
const history = new DesignHistory();
let viewport: Viewport | null = null;
let results: Map<
  RopeMode,
  {
    static: ReturnType<typeof solveStatic>;
    force: ReturnType<typeof simulate>;
    base: ReturnType<typeof simulate>;
  }
> = new Map();
let frame = 0;
let animation = 0;
let playing = false;
let tab: "model" | "sim" = "model";
// Results from the previous design stay visible (dimmed) until the debounced recompute lands.
let stale = false;
let pendingCalculation = 0;
let calculationError = false;
// What the last edit did; kept in the status line after the automatic recompute.
let actionNote = "";

el("app").innerHTML = `
<header><a class="brand" href="/">▰ tsumiki <span>STRUCTURE STUDIO</span></a><div class="mode-tabs" role="tablist" aria-label="作業画面"><button id="tab-model" role="tab" type="button" aria-selected="true" aria-controls="model-panel"><kbd>1</kbd> モデリング</button><button id="tab-sim" role="tab" type="button" aria-selected="false" aria-controls="sim-panel" tabindex="-1"><kbd>2</kbd> シミュレーション</button></div><div class="file-actions"><button id="recover" type="button" disabled>下書きを復元</button><button id="import" type="button">設計を読み込む</button><button id="export" class="primary" type="button">↓ 設計を保存</button><input id="file" type="file" accept=".json,.tsumiki.json" hidden></div></header>
<main><div class="status-line"><div id="status" role="status" class="status">設計を準備中</div><p id="draft-status" class="hint">編集中の設計は、このブラウザにも下書き保存します。</p></div><div id="error" role="alert" class="error" hidden></div>
<div class="workspace" id="workspace" data-mode="model"><aside class="panel controls model-only" id="model-panel" role="tabpanel" aria-labelledby="tab-model"><h2>部材とロープ</h2>
<div class="catalog"><p id="quick-anchor" class="hint" hidden>追加の起点：n6</p><p class="hint">クリックで種類を選び、節点から追加。部材そのものも図で選択できます。</p><div class="button-row"><button id="palette-male" type="button" aria-pressed="true">⊣ 雄材 ⊢</button><button id="palette-female" type="button" aria-pressed="false">▣ 雌材</button></div><div id="female-add-tools" hidden><label for="quick-direction">追加方向</label><select id="quick-direction"><option value="x">+X 横</option><option value="-x">−X 横</option><option value="y">+Y 上</option><option value="-y">−Y 下</option><option value="z">+Z 奥</option><option value="-z">−Z 手前</option></select><label for="quick-length">追加する長さ比</label><input id="quick-length" type="number" min="0.2" max="4" step="0.1" value="1"><button id="quick-add" class="primary" type="button">選択節点から部材を追加</button><button id="connect-nodes" type="button" aria-pressed="false">選択節点からクリックで接続</button></div><div id="male-add-tools"><p class="hint">① 雌材の穴を選ぶ → ② 長さ・差し込み側 → ③ 差し込む。垂直方向と座標は自動です。</p><button id="pick-hole" type="button" aria-pressed="false">① 図の穴を選ぶ</button><label for="hole-female">差し込む雌材</label><select id="hole-female"></select><label for="hole-number">差し込む穴</label><select id="hole-number"></select><div class="double"><label>雄材の長さ比<input id="male-length" type="number" min="0.2" max="4" step="0.1" value="1.4"></label><label>差し込み側<select id="male-side"><option value="1">表側へ</option><option value="-1">裏側へ</option></select></label></div><p id="male-preview-status" class="hint">空いている穴を選択してください。</p><button id="insert-male" type="button" class="primary" disabled>③ 雄材を差し込む</button></div><button id="rope-tool" type="button">ロープを張る</button></div>
<details><summary>枠の構成</summary><div class="triple"><label>幅の比<input id="width" type="number" min="0.4" max="4" step="0.1" value="1.4"></label><label>奥行の比<input id="depth" type="number" min="0.4" max="4" step="0.1" value="1"></label><label>高さの比<input id="height" type="number" min="0.4" max="4" step="0.1" value="1.2"></label></div><button id="extend-bay" type="button">奥に1区画つなぐ</button><button id="generate" type="button">比率から立体枠を作り直す</button><p class="hint">作り直すと形状・接合・ロープ・解析条件を初期化します。名称とメモは保持します。</p></details>
<details id="node-inspector" open><summary>選択した節点と支持</summary><label for="node">節点（3D図でも選択可）</label><select id="node"></select><div class="triple"><label>X<input id="nx" type="number" step="0.1"></label><label>Y<input id="ny" type="number" step="0.1"></label><label>Z<input id="nz" type="number" step="0.1"></label></div><label class="check"><input id="fixed" type="checkbox">全6自由度を固定</label><button id="apply-node" type="button">節点を更新</button><div class="nudge"><button data-axis="x" data-delta="-1" type="button">−X</button><button data-axis="x" data-delta="1" type="button">+X</button><button data-axis="y" data-delta="-1" type="button">−Y</button><button data-axis="y" data-delta="1" type="button">+Y</button><button data-axis="z" data-delta="-1" type="button">−Z</button><button data-axis="z" data-delta="1" type="button">+Z</button></div><button id="delete-node" type="button">節点と接続を削除</button><div class="button-row"><button id="add-node" type="button">節点を追加</button><button id="add-ring" type="button">丸材を配置</button></div><p class="hint">丸材は雄材の角棒にはめて空き段を埋めます。接触・剛性・質量への寄与は未解析です。</p></details>
<details id="member-inspector"><summary>選択した部材・形状</summary><label for="member">部材</label><select id="member"></select><label for="kind">種類</label><select id="kind"><option value="male">雄材</option><option value="female">雌材</option></select><div class="double"><label>始点<select id="start"></select></label><label>終点<select id="end"></select></label></div><div class="triple"><label>板の回転 °<input id="member-roll" type="number" min="-180" max="180" step="90" value="0"></label><label>雌材の段<input id="member-layer" type="number" min="0" max="3" step="1" value="0"></label><label>雌材の穴数<input id="member-holes" type="number" min="2" max="32" step="1" value="7"></label></div><p class="hint">雄材・雌材の実体が重なる配置は拒否します（穴内の差し込み・面接触は許容）。段は角棒上の重ね位置。追加は最外側。0〜3段が部材用、先端の1枚分はロープ用です。</p><button id="focus-member" type="button">この部材に寄る</button><div class="button-row"><button id="apply-member" type="button">更新</button><button id="add-member" type="button">追加</button><button id="delete-member" type="button">削除</button></div></details>
<details id="ring-inspector"><summary>丸材・空き段を埋める</summary><label for="ring-id">配置済みの丸材</label><select id="ring-id"></select><label for="ring-member">はめる雄材</label><select id="ring-member"></select><div class="double"><label>差し込み側<select id="ring-end"><option value="start">始点側</option><option value="end">終点側</option></select></label><label>はめる段<input id="ring-slot" type="number" min="0" max="3" step="1" value="1"></label></div><div class="button-row"><button id="ring-auto" type="button">空き段にはめる</button><button id="ring-apply" type="button">位置を更新</button><button id="ring-delete" type="button">外す</button></div><p class="hint">雄材の左右の角棒に沿って配置。雌材と同じ段・角棒の外・丸材同士の重複は拒否します。</p></details>
<details><summary>ロープ経路</summary><label for="rope-id">編集するロープ</label><select id="rope-id"></select><div class="double"><label>A・開始<select id="route-a"></select></label><label>C・対角<select id="route-c"></select></label><label>B・隣<select id="route-b"></select></label><label>D・終端<select id="route-d"></select></label></div><div class="button-row"><button id="apply-rope" type="button">経路更新</button><button id="add-rope" type="button">経路追加</button><button id="delete-rope" type="button">削除</button></div><div class="button-row"><button id="rope-front" type="button">前面ロープだけ残す</button><button id="rope-remove" type="button">全ロープを外す</button></div><p class="hint">各面 A→C→B→D。経路・巻き取り雄材は保存ファイルにも記録します。復元は枠の作り直しかファイル読込で行えます。</p></details>
<label for="name">設計名</label><input id="name" maxlength="200"><label for="notes">設計メモ</label><textarea id="notes" rows="3"></textarea><p class="hint">保存形式：.tsumiki.json v5<br>位置・部材・支持・ロープ・材料・解析条件を一緒に保存。</p>
</aside>
<aside class="panel analysis sim-only" id="sim-panel" role="tabpanel" aria-labelledby="tab-sim"><h2>荷重と揺れ</h2><label for="load-node">荷重点</label><select id="load-node"></select><label for="direction">作用方向</label><select id="direction"><option value="x">X方向</option><option value="y">Y方向</option><option value="z">Z方向</option></select><label for="force">静的・加振の外力振幅</label><input id="force" type="number" min="-2" max="2" step="0.02"><label for="torque">同軸の外力モーメント</label><input id="torque" type="number" min="-2" max="2" step="0.01"><label for="gravity">自重用の重力係数</label><input id="gravity" type="number" min="0" max="2" step="0.01"><hr><label for="base-acceleration">床の加速度振幅</label><input id="base-acceleration" type="number" min="0" max="2" step="0.01"><label for="frequency">加振周波数</label><input id="frequency" type="number" min="0.05" max="5" step="0.05"><label for="duration">計算時間</label><input id="duration" type="number" min="1" max="12" step="1"><label for="excitation-stop">加振を止める時刻</label><input id="excitation-stop" type="number" min="0.1" max="12" step="0.1"><label for="damping">相対減衰パラメータ</label><input id="damping" type="number" min="0.001" max="0.3" step="0.01"><h2 class="sub-heading">接合とロープの仮定</h2><details id="joint-settings" open><summary>接合の遊び・ロープの掛かり</summary><label for="joint-model">接合のモデル</label><select id="joint-model"><option value="clearance-contact">穴と角棒の遊び・接触</option><option value="rigid-approximation">剛接合（遊びなし・比較用）</option></select><label for="rope-wrap">ロープの掛け点（C・B）</label><select id="rope-wrap"><option value="locked">滑らない（巻き取り後に固着）</option><option value="sliding">滑る（摩擦なし・張力一様）</option></select><div class="double"><label>接触時の剛性<input id="joint-contact" type="number" min="0.001" max="10000000" step="any"></label><label>隙間内の抵抗<input id="joint-open" type="number" min="0.000001" max="10000000" step="any"></label></div><p id="joint-clearance" class="hint"></p><p class="hint">実物の掛け点の摩擦は「滑る」と「滑らない」の間にあります。両方で比べて結果の幅を確認してください。摩擦による接合の固着、遊びの実寸は未確定です。</p></details><details><summary>ロープ・材料の仮パラメータ</summary><label for="prestrain">巻き取り後の張力ひずみ（全ロープ）</label><input id="prestrain" type="number" min="0" max="0.02" step="0.001"><label for="rope-k">相対ロープ軸剛性</label><input id="rope-k" type="number" min="0.01" max="100000" step="10"><label for="slack">たるみの比率</label><input id="slack" type="number" min="0" max="0.2" step="0.005"><div id="material-inputs"></div><button id="apply-material" type="button">材料・ロープを更新</button></details><button id="calculate" class="primary" type="button">3条件を再計算</button><div class="assumptions"><h3>この計算が扱うもの</h3><p>3D弾性梁・6自由度 / 穴と角棒の隙間・接触（摩擦なし） / 引張専用ロープ（掛け点で滑る・滑らないの両極端） / 巻き取り後の張力 / 集中質量 / 静的釣り合い / 平衡点まわりの線形振動</p><h3>まだ扱わないもの</h3><p>丸材・ロープの一般干渉、移動途中・変形後の衝突、接合・掛け点の摩擦の中間値、揺れの途中での接触の開閉、床との浮き上がり、座屈、大変形、破壊。丸材は表示のみ。</p><p>補強が常に有利とは仮定しません。共振により揺れが増す場合も、そのまま表示します。</p></div><a class="format-link" href="/schemas/tsumiki-design-v5.schema.json" target="_blank" rel="noreferrer">専用形式のJSON Schema ↗</a></aside>
<section class="center"><div class="panel viewer"><div class="viewer-head"><h2 id="viewer-title">3D WORKSPACE</h2><div><button id="fit" type="button">全体</button><button id="top" type="button">上面</button><button id="front" type="button">正面</button><button id="side" type="button">側面</button></div></div><div class="editor-toolbar model-only"><span class="model-only tool-group"><button id="move-tool" type="button" aria-pressed="false">↔ 移動</button><label>移動刻み<select id="snap"><option value="0.05">0.05</option><option value="0.1" selected>0.1</option><option value="0.25">0.25</option></select></label></span><button id="undo" type="button" disabled>↶ 元に戻す</button><button id="redo" type="button" disabled>↷ やり直す</button><label class="check"><input id="nodes-visible" type="checkbox" checked>節点</label></div><div class="selection-bar"><button id="edit-selection" class="model-only" type="button">選択を編集</button><span id="selection-summary">節点 n6</span><span id="tool-hint">図をクリックして選択 / ドラッグで視点回転 / ホイールで拡大</span></div><div id="viewport"></div><div class="viewer-footer"><span id="counts"></span><span>X 赤 / Y 上・緑 / Z 青</span></div><div class="legend model-only"><span class="male">● 雄材</span><span class="female">● 雌材</span><span class="rope">● ロープ</span><span>薄線：変形前</span><span>凸部：板厚×5（部材4＋ロープ1）</span></div></div>
<section class="panel rope-workflow model-only" id="rope-workflow" hidden><h2>ロープを張る</h2><p class="hint">① 対応する四辺の枠を選ぶ → ② 巻き取り専用の雄材を選ぶ → ③ 張る。ロープは凸部の最外側に掛かります。</p><button id="pick-frame" type="button">① 図で枠を選ぶ</button><label for="rope-frame">対象の構造部分</label><select id="rope-frame"></select><label for="rope-winder">巻き取り用の雄材（他のロープと共用不可）</label><select id="rope-winder"></select><p id="rope-workflow-status" class="hint"></p><div class="button-row"><button id="confirm-rope" type="button" class="primary" disabled>③ ロープを張る</button><button id="cancel-rope" type="button">閉じる</button></div></section>
<div class="panel playback sim-only"><div class="double"><label>表示ケース<select id="display-mode"><option value="taut">張力あり</option><option value="slack">たるみあり</option><option value="none">ロープなし</option></select></label><label>応答の表示<select id="display-response"><option value="static">静的荷重</option><option value="force">人による外力加振</option><option value="base">床・地面の加振</option></select></label></div><div class="play-row"><button id="play" type="button">▶ 再生</button><label class="timeline">時刻<input id="time" type="range" min="0" max="1" value="0" step="1"></label><output id="time-value">静的</output></div><label for="scale">変形の表示倍率 <output id="scale-value"></output></label><input id="scale" type="range" min="1" max="100" step="1" value="15"><p class="hint playback-note">変形は見やすく拡大しています。初期張力を含む全変位を表示します。梁の描画は節点間の直線で、曲率の詳細表示ではありません。時刻は無次元です。</p></div>
</section>
<div class="panel response sim-only" id="response"><div class="section-head"><h2>ロープの条件を、同じ入力で比較</h2><button id="report" type="button">↓ 解析記録</button></div><div class="table-scroll"><table><thead><tr><th>ロープ条件</th><th>静的最大変位</th><th>外力加振の最大変位</th><th>床加振の最大変位</th></tr></thead><tbody id="comparison"></tbody></table></div><p class="hint">静的変位は初期張力による変位を差し引いた荷重応答。動的変位は自重・初期張力の平衡点からの相対変位です。値は全節点の並進変位ノルムの最大。（ ）はロープなしに対する増減。</p><svg id="history" viewBox="0 0 720 180" role="img" aria-label="選択した加振に対する荷重点の相対変位時系列"></svg><div id="diagnostics" class="diagnostics"></div><h3 class="internal-heading">静的荷重時の接合の遊び（選択ロープ条件）</h3><p class="hint">使用率は穴と角棒の隙間に対する相対移動。100%以上は壁に接触（着座）。巻き取り直後→荷重時の順に表示します。行をクリックで部材を選択。</p><div class="table-scroll"><table><thead><tr><th>接合（雌材@節点）</th><th>巻き取り直後</th><th>荷重時</th><th>最大接触力</th></tr></thead><tbody id="joint-results"></tbody></table></div><h3 class="internal-heading">静的荷重時の部材端内力（選択ロープ条件）</h3><p class="hint">動的な内力・接合反力の時系列表示は未実装です。行をクリックで部材を選択。</p><div class="table-scroll"><table><thead><tr><th>部材</th><th>軸力（端部）</th><th>ねじり（端部）</th><th>曲げ合成（端部）</th></tr></thead><tbody id="member-results"></tbody></table></div></div>
</div><footer>TSUMIKI / EXPLORATORY STRUCTURAL MODEL · 無次元の仮定モデル・部材寸法は保留中。寸法・材料は仮定値で、実物の強度・耐震性能を保証する解析ではありません。 · <a href="/rope.html">2Dの旧試作</a></footer></main>`;

function error(message: string) {
  el("error").hidden = false;
  el("error").textContent = message;
}
function clearError() {
  el("error").hidden = true;
  el("error").textContent = "";
}
function guard(action: () => void) {
  try {
    clearError();
    action();
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
  }
}
function stop() {
  playing = false;
  cancelAnimationFrame(animation);
  el("play").textContent = "▶ 再生";
}
function markDirty() {
  stop();
  stale = results.size > 0;
  el("response").classList.toggle("stale", stale);
  el("status").textContent = `${actionNote || "設計を変更しました"}。再計算しています…`;
  clearTimeout(pendingCalculation);
  pendingCalculation = window.setTimeout(() => {
    pendingCalculation = 0;
    calculate();
  }, 180);
  draw();
}
function ensureFresh() {
  if (stale || pendingCalculation || results.size === 0) calculate();
  if (results.size === 0) throw new Error("計算結果がありません。設計・支持・荷重条件を確認してください");
}
function options(target: HTMLSelectElement, values: { id: string; label?: string }[], value?: string) {
  target.replaceChildren(...values.map((v) => new Option(v.label ?? v.id, v.id)));
  if (value && values.some((v) => v.id === value)) target.value = value;
}
function syncNode() {
  const node = design.nodes.find((n) => n.id === selected);
  if (!node) return;
  select("node").value = selected;
  ["nx", "ny", "nz"].forEach((id, i) => {
    input(id).value = String(node.position[i]);
  });
  input("fixed").checked = node.fixed;
  draw();
}
function syncMember(focus = false) {
  const m = design.members.find((v) => v.id === select("member").value);
  if (!m) return;
  select("start").value = m.start;
  select("end").value = m.end;
  select("kind").value = m.kind;
  input("member-roll").value = String(m.roll);
  input("member-layer").value = String(m.layer);
  input("member-holes").value = String(m.holeCount);
  selectedMember = m.id;
  if (focus) selected = m.end;
  if (focus) {
    selectionType = "member";
    el<HTMLDetailsElement>("member-inspector").open = true;
    draw();
  }
}
function syncRope() {
  const rope = design.ropes.find((r) => r.id === select("rope-id").value);
  if (rope)
    ["route-a", "route-c", "route-b", "route-d"].forEach((id, i) => {
      select(id).value = rope.route[i];
    });
}
const fields = {
  force: "force",
  torque: "torque",
  gravity: "gravity",
  "base-acceleration": "baseAcceleration",
  frequency: "frequency",
  duration: "duration",
  damping: "damping",
  "excitation-stop": "excitationStop",
} as const;
function sync() {
  input("name").value = design.name;
  el<HTMLTextAreaElement>("notes").value = design.notes;
  syncHoleChoices();
  syncRopeWorkflow();
  const values = design.nodes.map((n) => ({ id: n.id, label: `${n.id}${n.fixed ? " · 固定" : ""}` }));
  for (const id of ["node", "start", "end", "load-node", "route-a", "route-c", "route-b", "route-d"])
    options(select(id), values, id === "load-node" ? design.analysis.loadNode : undefined);
  if (!design.nodes.some((n) => n.id === selected)) selected = design.nodes[0].id;
  if (!design.rings.some((r) => r.id === selectedRing)) {
    selectedRing = "";
    if (selectionType === "ring") selectionType = "node";
  }
  options(select("rope-id"), design.ropes);
  syncRope();
  options(
    select("member"),
    design.members.map((m) => ({
      id: m.id,
      label: `${m.kind === "male" ? "雄材" : "雌材"} ${m.id} · ${m.start}→${m.end}`,
    })),
    selectedMember,
  );
  options(
    select("ring-member"),
    design.members.filter((m) => m.kind === "male"),
    select("ring-member").value,
  );
  options(
    select("ring-id"),
    design.rings.map((r) => ({
      id: r.id,
      label: `${r.id} · ${r.member} ${r.end === "start" ? "始点" : "終点"} / ${r.slot}段`,
    })),
    selectedRing,
  );
  if (selectedRing) syncRing();
  syncNode();
  syncMember();
  syncHistory();
  select("direction").value = design.analysis.direction;
  for (const [id, key] of Object.entries(fields)) input(id).value = String(design.analysis[key]);
  input("scale").value = String(design.view.deformationScale);
  input("prestrain").value = String(design.ropes[0]?.prestrain ?? 0.002);
  input("rope-k").value = String(design.ropes[0]?.stiffness ?? 120);
  input("slack").value = String(design.ropes[0]?.slack ?? 0.025);
  select("joint-model").value = design.jointModel;
  select("rope-wrap").value = design.ropeWrap;
  input("joint-contact").value = String(design.joint.contactStiffness);
  input("joint-open").value = String(design.joint.openStiffness);
  const clearance = (design.geometry.holeSize - design.geometry.tenonSize) / 2;
  el("joint-clearance").textContent =
    design.jointModel === "clearance-contact"
      ? `片側の隙間 ${clearance.toPrecision(3)}（穴 ${design.geometry.holeSize} − 角棒 ${design.geometry.tenonSize}）/ 板厚 ${design.geometry.thickness}。形状の無次元仮定から計算します。`
      : "剛接合では隙間を計算に含めません。";
  const material = design.materials[0];
  el("material-inputs").replaceChildren();
  for (const key of ["E", "G", "A", "Iy", "Iz", "J", "density"] as const) {
    const label = document.createElement("label");
    label.textContent = `${material.id} / ${key}`;
    const field = document.createElement("input");
    field.type = "number";
    field.step = "any";
    field.id = `mat-${key}`;
    field.value = String(material[key]);
    label.append(field);
    el("material-inputs").append(label);
  }
  el("counts").textContent =
    `${design.nodes.length}節点 / ${design.members.length}部材 / ${design.ropes.length}ロープ / ${design.rings.length}丸材 / ${design.connections.length}穴接続`;
}
function update(action: (draft: Design) => void) {
  const draft = structuredClone(design);
  action(draft);
  const valid = parseDesign(serializeDesign(draft));
  history.push(design, valid);
  design = valid;
  persistDraft();
  markDirty();
  sync();
}
function id(prefix: string): string {
  let n = 0;
  const ids = new Set(
    [
      ...design.nodes,
      ...design.members,
      ...design.ropes,
      ...design.rings,
      ...design.materials,
      ...design.connections,
    ].map((v) => v.id),
  );
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
function draw() {
  const mode = select("display-mode").value as RopeMode;
  const response = select("display-response").value;
  const result = results.get(mode);
  let u: number[] | null = null;
  if (result && !stale && tab === "sim") {
    if (response === "static") u = result.static.displacement;
    else {
      const history = result[response as Excitation];
      frame = Math.min(frame, history.states.length - 1);
      u = history.states[frame].map((v, i) => v + history.initial[i]);
      input("time").max = String(history.times.length - 1);
      el("time-value").textContent = history.times[frame].toFixed(2);
    }
  }
  if (response === "static") el("time-value").textContent = "静的";
  input("time").value = String(frame);
  el("scale-value").textContent = `${design.view.deformationScale}倍`;
  const selectedTag =
    selectionType === "member"
      ? `member:${selectedMember}`
      : selectionType === "ring"
        ? `ring:${selectedRing}`
        : selected;
  viewport?.setHoleSelection(
    choosingHole && tab === "model",
    tab === "model" && select("hole-female").value && select("hole-number").value !== ""
      ? { female: select("hole-female").value, hole: Number(select("hole-number").value) }
      : null,
    tab === "model" ? malePreview : null,
  );
  viewport?.setFrameSelection(choosingFrame, chosenFrame);
  viewport?.setTools(
    tab === "model",
    el("move-tool").getAttribute("aria-pressed") === "true" && !choosingHole && !choosingFrame,
    Number(select("snap").value),
  );
  viewport?.show(design, u, design.view.deformationScale, selectedTag, mode, input("nodes-visible").checked);
  el("selection-summary").textContent =
    selectionType === "node"
      ? `節点 ${selected}`
      : selectionType === "member"
        ? `部材 ${selectedMember}`
        : `丸材 ${selectedRing}`;
  syncHistory();
  chart();
  details();
}
function chart() {
  const response = select("display-response").value;
  if (response === "static") {
    el("history").replaceChildren();
    return;
  }
  const histories = modes.map((m) => results.get(m)?.[response as Excitation]);
  if (histories.some((v) => !v)) return;
  const max = Math.max(1e-8, ...histories.flatMap((h) => (h ? h.values.map(Math.abs) : [])));
  let svg = '<line x1="45" y1="85" x2="700" y2="85" stroke="#aab9a5"/>';
  const colors = ["#7e8980", "#c5a263", "#c65432"];
  histories.forEach((h, i) => {
    if (!h) return;
    svg += `<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${h.values.map((v, j) => `${45 + (h.times[j] / design.analysis.duration) * 650},${85 - (v / max) * 62}`).join(" ")}"/>`;
  });
  svg += `<text x="5" y="18">${max.toExponential(2)}</text><text x="45" y="164">0</text><text x="625" y="164">${design.analysis.duration} · 相対時刻</text><text x="260" y="178">灰：なし / 黄：たるみ / 橙：張力あり · 荷重点の方向成分</text>`;
  el("history").innerHTML = svg;
}
function details() {
  const mode = select("display-mode").value as RopeMode;
  const result = results.get(mode);
  if (!result) return;
  const percent = (v: number) => `${(v * 100).toFixed(0)}%`;
  el("joint-results").replaceChildren(
    ...result.static.joints.map((joint, i) => {
      const initial = result.static.initialJoints[i];
      const row = document.createElement("tr");
      markMemberRow(row, joint.id.split("@")[0]);
      for (const value of [
        joint.id,
        `${percent(initial.utilization)}${initial.closed ? " 着座" : ""}`,
        `${percent(joint.utilization)}${joint.closed ? " 着座" : ""}`,
        joint.contactForce.toExponential(2),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
  el("member-results").replaceChildren(
    ...result.static.memberForces.map((m) => {
      const row = document.createElement("tr");
      markMemberRow(row, m.id);
      for (const value of [
        m.id,
        m.local[0].toExponential(3),
        m.local[3].toExponential(3),
        Math.hypot(m.local[4], m.local[5]).toExponential(3),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
}
function markMemberRow(row: HTMLTableRowElement, member: string) {
  row.dataset.member = member;
  row.classList.add("member-row");
  row.classList.toggle("is-selected", selectionType === "member" && member === selectedMember);
}
function relative(value: number, base: number | undefined) {
  const cell = document.createElement("td");
  cell.textContent = value.toExponential(3);
  if (base === undefined || !(base > 0)) return cell;
  const percent = Math.round((value / base - 1) * 100);
  const delta = document.createElement("span");
  delta.className = `delta ${percent < 0 ? "better" : percent > 0 ? "worse" : ""}`;
  delta.textContent = `（${percent < 0 ? "−" : percent > 0 ? "+" : "±"}${Math.abs(percent)}%）`;
  cell.append(delta);
  return cell;
}
function calculate() {
  stop();
  clearTimeout(pendingCalculation);
  pendingCalculation = 0;
  if (calculationError) {
    clearError();
    calculationError = false;
  }
  results.clear();
  try {
    const next = new Map<
      (typeof modes)[number],
      {
        static: ReturnType<typeof solveStatic>;
        force: ReturnType<typeof simulate>;
        base: ReturnType<typeof simulate>;
      }
    >();
    for (const mode of modes)
      next.set(mode, {
        static: solveStatic(design, mode),
        force: simulate(design, mode, "force"),
        base: simulate(design, mode, "base"),
      });
    results = next;
    const reference = results.get("none");
    el("comparison").replaceChildren(
      ...modes.map((mode) => {
        const r = results.get(mode);
        if (!r) throw new Error("Missing result");
        const base = mode === "none" ? undefined : reference;
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = names[mode];
        const force = relative(r.force.peak, base?.force.peak);
        if (r.force.cableSwitch || r.force.contactSwitch) force.firstChild?.after(" *");
        const floor = relative(r.base.peak, base?.base.peak);
        if (r.base.cableSwitch || r.base.contactSwitch) floor.firstChild?.after(" *");
        row.append(name, relative(r.static.maxDisplacement, base?.static.maxDisplacement), force, floor);
        return row;
      }),
    );
    const warnings: string[] = [];
    for (const [mode, r] of results) {
      if (r.force.cableSwitch || r.base.cableSwitch)
        warnings.push(
          `${names[mode]}：動的応答中に張り・たるみが切り替わる可能性。* の結果は接線固定の近似が成立しない参考値です。`,
        );
      if (r.force.contactSwitch || r.base.contactSwitch)
        warnings.push(
          `${names[mode]}：揺れの途中で接合の隙間が開閉します。* の結果は接触状態を固定した参考値で、がたつきの非線形応答ではありません。`,
        );
      if (r.static.maxTotalDisplacement > 0.05)
        warnings.push(`${names[mode]}：全変位が0.05を超えています。小変形の妥当性を確認してください。`);
    }
    const taut = results.get("taut");
    for (const note of taut?.static.notes ?? []) warnings.push(note);
    if (taut && design.jointModel === "clearance-contact" && design.ropes.length > 0) {
      const other = design.ropeWrap === "locked" ? "sliding" : "locked";
      const bound = solveStatic({ ...design, ropeWrap: other }, "taut").maxDisplacement;
      warnings.push(
        `掛け点の仮定の幅：張力ありの静的最大変位は「${design.ropeWrap === "locked" ? "滑らない" : "滑る"}」で ${taut.static.maxDisplacement.toExponential(3)}、「${other === "locked" ? "滑らない" : "滑る"}」で ${bound.toExponential(3)}。実物はこの間です。`,
      );
    }
    if (taut)
      warnings.push(
        `静的釣り合い残差 ${taut.static.residual.toExponential(2)} / ロープの最大張力 ${Math.max(0, ...taut.static.ropeTensions).toExponential(3)}（相対値）`,
      );
    el("diagnostics").textContent = warnings.join("\n");
    frame = 0;
    stale = false;
    el("response").classList.remove("stale");
    el("status").textContent =
      `${actionNote ? `${actionNote} · ` : ""}計算完了 · 静的荷重・外力加振・床加振を3条件で比較しました`;
    actionNote = "";
    draw();
  } catch (e) {
    stale = false;
    el("response").classList.remove("stale");
    calculationError = true;
    results.clear();
    el("comparison").replaceChildren();
    el("member-results").replaceChildren();
    el("joint-results").replaceChildren();
    el("history").replaceChildren();
    el("diagnostics").textContent = "";
    error(e instanceof Error ? e.message : String(e));
    el("status").textContent = "計算できませんでした。設計・支持・荷重条件を確認してください。";
    draw();
  }
}
function download(text: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
el("export").addEventListener("click", () =>
  guard(() => {
    download(serializeDesign(design), "design.tsumiki.json");
    el("status").textContent = "設計ファイルのダウンロードを開始しました";
  }),
);
el("import").addEventListener("click", () => input("file").click());
input("file").addEventListener("change", async () => {
  const file = input("file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error("設計ファイルは1 MB以下にしてください");
    const text = await file.text();
    const previousVersion = JSON.parse(text).version;
    const legacy = [1, 2, 3, 4].includes(previousVersion);
    const restored = parseDesign(text);
    history.push(design, restored);
    design = restored;
    persistDraft();
    selected = design.nodes[0].id;
    markDirty();
    sync();
    viewport?.fit();
    calculate();
    if (legacy)
      el("status").textContent +=
        ` · v${previousVersion}をv5へ移行しました。凸部は板厚5枚分、先端1枚分はロープ用です。旧形式の結果を再現するため接合は剛接合・掛け点は滑るのままです。配置と接合の設定を確認してください。`;
  } catch (e) {
    error(`読込に失敗しました。現在の設計は保持します。${e instanceof Error ? e.message : String(e)}`);
  } finally {
    input("file").value = "";
  }
});
el("name").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.name = input("name").value;
    }),
  ),
);
el("notes").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.notes = el<HTMLTextAreaElement>("notes").value;
    }),
  ),
);
el("generate").addEventListener("click", () =>
  guard(() => {
    const values = ["width", "depth", "height"].map((key) => Number(input(key).value));
    if (values.some((v) => !Number.isFinite(v) || v < 0.4 || v > 4))
      throw new Error("辺長比は0.4〜4にしてください");
    const next = createDesign(...(values as [number, number, number]));
    next.name = design.name;
    next.notes = design.notes;
    const valid = parseDesign(serializeDesign(next));
    history.push(design, valid);
    design = valid;
    persistDraft();
    selected = "n6";
    markDirty();
    sync();
    viewport?.fit();
    calculate();
  }),
);
select("node").addEventListener("change", () => {
  selected = select("node").value;
  selectionType = "node";
  syncNode();
});
el("apply-node").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      const n = d.nodes.find((v) => v.id === selected);
      if (!n) throw new Error("節点がありません");
      n.position = [Number(input("nx").value), Number(input("ny").value), Number(input("nz").value)];
      n.fixed = input("fixed").checked;
    }),
  ),
);
el("add-node").addEventListener("click", () =>
  guard(() => {
    const newId = id("n");
    update((d) => {
      d.nodes.push({ id: newId, position: [0, 1.5, 0], fixed: false });
    });
    selected = newId;
    syncNode();
  }),
);
el("delete-node").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      const removed = selected;
      d.nodes = d.nodes.filter((n) => n.id !== removed);
      d.members = d.members.filter((m) => m.start !== removed && m.end !== removed);
      const remaining = new Set(d.members.map((m) => m.id));
      d.ropes = d.ropes.filter((r) => !r.route.includes(removed) && remaining.has(r.windingMember));
      d.rings = d.rings.filter((r) => remaining.has(r.member));
      d.connections = d.connections.filter((c) => remaining.has(c.male) && remaining.has(c.female));
      if (d.analysis.loadNode === removed) {
        const replacement = d.nodes.find((n) => !n.fixed);
        if (!replacement) throw new Error("荷重点に使える自由節点が残りません");
        d.analysis.loadNode = replacement.id;
      }
    }),
  ),
);
select("rope-id").addEventListener("change", syncRope);
for (const [button, action] of [
  ["apply-rope", "update"],
  ["add-rope", "add"],
  ["delete-rope", "delete"],
] as const)
  el(button).addEventListener("click", () =>
    guard(() =>
      update((d) => {
        const index = d.ropes.findIndex((r) => r.id === select("rope-id").value);
        if (action === "delete") {
          if (index < 0) throw new Error("ロープがありません");
          d.ropes.splice(index, 1);
          return;
        }
        const route = ["route-a", "route-c", "route-b", "route-d"].map((id) => select(id).value) as [
          string,
          string,
          string,
          string,
        ];
        const winding = d.members.find(
          (m) =>
            m.kind === "male" && [m.start, m.end].sort().join(":") === [route[0], route[3]].sort().join(":"),
        );
        if (!winding) throw new Error("開始Aと終端Dは同じ雄材の両端にしてください");
        const rope = {
          id: action === "add" ? id("r") : select("rope-id").value,
          route,
          stiffness: Number(input("rope-k").value),
          prestrain: Number(input("prestrain").value),
          slack: Number(input("slack").value),
          windingMember: winding.id,
        };
        if (action === "add") d.ropes.push(rope);
        else if (index >= 0) d.ropes[index] = rope;
        else throw new Error("更新するロープを選んでください");
      }),
    ),
  );
el("add-ring").addEventListener("click", () =>
  guard(() => {
    const host = design.members.find(
      (m) =>
        m.kind === "male" &&
        (selectionType === "member" ? m.id === selectedMember : m.start === selected || m.end === selected),
    );
    if (!host) throw new Error("雄材または雄材につながる節点を選んでください");
    select("ring-member").value = host.id;
    select("ring-end").value = host.end === selected ? "end" : "start";
    addRing();
  }),
);
select("member").addEventListener("change", () => syncMember(true));
for (const [button, action] of [
  ["apply-member", "update"],
  ["add-member", "add"],
  ["delete-member", "delete"],
] as const)
  el(button).addEventListener("click", () =>
    guard(() =>
      update((d) => {
        const index = d.members.findIndex((m) => m.id === select("member").value);
        if (action === "delete") {
          if (index < 0) throw new Error("部材がありません");
          const removed = d.members[index];
          d.members.splice(index, 1);
          d.rings = d.rings.filter((r) => r.member !== removed.id);
          d.ropes = d.ropes.filter(
            (r) =>
              r.windingMember !== removed.id &&
              [r.route[1], r.route[2]].sort().join(":") !== [removed.start, removed.end].sort().join(":"),
          );
          return;
        }
        const kind = select("kind").value as "male" | "female";
        if (action === "add" && kind === "male")
          throw new Error("雄材は穴を選ぶ操作から追加してください。方向・座標は自動で決まります");
        const outer =
          action === "add" && kind === "female"
            ? nextOuterLayer(d, [select("start").value, select("end").value])
            : Number(input("member-layer").value);
        const member = {
          id: action === "add" ? id("m") : select("member").value,
          kind: select("kind").value as "male" | "female",
          start: select("start").value,
          end: select("end").value,
          material: action === "update" && index >= 0 ? d.members[index].material : d.materials[0].id,
          roll: Number(input("member-roll").value),
          layer: outer,
          holeCount: Number(input("member-holes").value),
        };
        if (action === "add") d.members.push(member);
        else if (index >= 0) d.members[index] = member;
      }),
    ),
  );
el("rope-front").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      d.ropes = d.ropes.slice(0, 1);
    }),
  ),
);
el("rope-remove").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      d.ropes = [];
    }),
  ),
);
el("apply-material").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      for (const rope of d.ropes) {
        rope.prestrain = Number(input("prestrain").value);
        rope.stiffness = Number(input("rope-k").value);
        rope.slack = Number(input("slack").value);
      }
      for (const key of ["E", "G", "A", "Iy", "Iz", "J", "density"] as const)
        d.materials[0][key] = Number(input(`mat-${key}`).value);
    }),
  ),
);
select("joint-model").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.jointModel = select("joint-model").value as Design["jointModel"];
    }),
  ),
);
select("rope-wrap").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.ropeWrap = select("rope-wrap").value as Design["ropeWrap"];
    }),
  ),
);
for (const [id, key] of [
  ["joint-contact", "contactStiffness"],
  ["joint-open", "openStiffness"],
] as const)
  input(id).addEventListener("change", () =>
    guard(() =>
      update((d) => {
        d.joint[key] = Number(input(id).value);
      }),
    ),
  );
for (const [id, key] of Object.entries(fields))
  input(id).addEventListener("change", () =>
    guard(() =>
      update((d) => {
        d.analysis[key] = Number(input(id).value);
      }),
    ),
  );
select("load-node").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.analysis.loadNode = select("load-node").value;
    }),
  ),
);
select("direction").addEventListener("change", () =>
  guard(() =>
    update((d) => {
      d.analysis.direction = select("direction").value as "x" | "y" | "z";
    }),
  ),
);
el("calculate").addEventListener("click", calculate);
for (const id of ["member-results", "joint-results"]) {
  const body = el(id);
  const rowMember = (event: Event) =>
    event.target instanceof Element ? event.target.closest<HTMLElement>("tr")?.dataset.member : undefined;
  body.addEventListener("mouseover", (event) => viewport?.setHover(rowMember(event) ?? ""));
  body.addEventListener("mouseleave", () => viewport?.setHover(""));
  body.addEventListener("click", (event) => {
    const member = rowMember(event);
    if (!member || !design.members.some((m) => m.id === member)) return;
    select("member").value = member;
    syncMember(true);
    viewport?.pulse([member]);
  });
}
for (const id of ["display-mode", "display-response"])
  select(id).addEventListener("change", () => {
    stop();
    frame = 0;
    draw();
  });
input("scale").addEventListener("input", () => {
  design.view.deformationScale = Number(input("scale").value);
  draw();
});
input("time").addEventListener("input", () => {
  stop();
  frame = Number(input("time").value);
  draw();
});
let last = 0;
function tick(time: number) {
  if (!playing) return;
  const r = results.get(select("display-mode").value as RopeMode);
  const response = select("display-response").value as Excitation;
  if (!r) {
    stop();
    return;
  }
  if (time - last > 33) {
    last = time;
    frame = (frame + Math.max(1, Math.round(1 / 30 / design.analysis.timeStep))) % r[response].states.length;
    draw();
  }
  animation = requestAnimationFrame(tick);
}
el("play").addEventListener("click", () =>
  guard(() => {
    if (playing) {
      stop();
      return;
    }
    ensureFresh();
    setTab("sim");
    if (select("display-response").value === "static") select("display-response").value = "force";
    playing = true;
    el("play").textContent = "Ⅱ 停止";
    animation = requestAnimationFrame(tick);
  }),
);
el("fit").addEventListener("click", () => viewport?.fit());
el("top").addEventListener("click", () => viewport?.viewTop());
el("report").addEventListener("click", () =>
  guard(() => {
    ensureFresh();
    const report = {
      format: "tsumiki-analysis-report",
      version: 1,
      design,
      results: modes.map((mode) => {
        const r = results.get(mode);
        if (!r) throw new Error("結果がありません");
        return {
          mode,
          static: r.static,
          force: {
            times: r.force.times,
            input: r.force.input,
            values: r.force.values,
            peak: r.force.peak,
            cableSwitch: r.force.cableSwitch,
            contactSwitch: r.force.contactSwitch,
          },
          base: {
            times: r.base.times,
            input: r.base.input,
            values: r.base.values,
            peak: r.base.peak,
            cableSwitch: r.base.cableSwitch,
            contactSwitch: r.base.contactSwitch,
          },
        };
      }),
    };
    download(JSON.stringify(report, null, 2), "analysis.tsumiki-report.json");
  }),
);
function persistDraft() {
  try {
    localStorage.setItem("tsumiki-design-draft-v2", serializeDesign(design));
    el<HTMLButtonElement>("recover").disabled = false;
    el("draft-status").textContent =
      "下書きをこのブラウザに保存済み。持ち運びには設計ファイルを保存してください。";
  } catch (e) {
    error(`下書きの保存に失敗しました。設計ファイルを保存してください。${String(e)}`);
  }
}
el("recover").addEventListener("click", () =>
  guard(() => {
    const saved = localStorage.getItem("tsumiki-design-draft-v2");
    if (!saved) throw new Error("下書きがありません");
    const restored = parseDesign(saved);
    history.push(design, restored);
    design = restored;
    markDirty();
    sync();
    viewport?.fit();
    calculate();
  }),
);
el("edit-selection").addEventListener("click", () => {
  setTab("model");
  const id =
    selectionType === "member"
      ? "member-inspector"
      : selectionType === "ring"
        ? "ring-inspector"
        : "node-inspector";
  const panel = el<HTMLDetailsElement>(id);
  panel.open = true;
  panel.scrollIntoView({ block: "center", behavior: "smooth" });
});
function syncHistory() {
  el<HTMLButtonElement>("undo").disabled = !history.canUndo;
  el<HTMLButtonElement>("redo").disabled = !history.canRedo;
}
function restoreHistory(kind: "undo" | "redo") {
  guard(() => {
    design = history[kind](design);
    persistDraft();
    markDirty();
    sync();
  });
}
function setTab(next: "model" | "sim") {
  if (tab === next) return;
  tab = next;
  el("workspace").dataset.mode = next;
  for (const [id, value] of [
    ["tab-model", "model"],
    ["tab-sim", "sim"],
  ] as const) {
    el(id).setAttribute("aria-selected", String(value === next));
    el(id).tabIndex = value === next ? 0 : -1;
  }
  stop();
  if (next === "sim") {
    choosingHole = false;
    choosingFrame = false;
    connectStart = null;
    el("pick-hole").setAttribute("aria-pressed", "false");
    el("connect-nodes").setAttribute("aria-pressed", "false");
    // Show results immediately instead of waiting for the debounce.
    if (pendingCalculation) calculate();
  }
  el("viewer-title").textContent = next === "model" ? "3D WORKSPACE · 設計" : "3D WORKSPACE · 解析結果";
  el("tool-hint").textContent =
    next === "model"
      ? "図をクリックして選択 / ドラッグで視点回転 / ホイールで拡大"
      : "変形は表示倍率で拡大 / Space で再生・停止 / 部材クリックで結果の行を強調";
  draw();
}
el("tab-model").addEventListener("click", () => setTab("model"));
el("tab-sim").addEventListener("click", () => setTab("sim"));
el("tab-model").parentElement?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  setTab(tab === "model" ? "sim" : "model");
  el(tab === "model" ? "tab-model" : "tab-sim").focus();
});
el("undo").addEventListener("click", () => restoreHistory("undo"));
el("redo").addEventListener("click", () => restoreHistory("redo"));
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey ? history.canRedo : history.canUndo) restoreHistory(event.shiftKey ? "redo" : "undo");
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    if (history.canRedo) restoreHistory("redo");
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === "1") setTab("model");
    if (event.key === "2") setTab("sim");
    if (event.key === " " && tab === "sim" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      el("play").click();
    }
  }
  if (event.key === "Escape") {
    choosingHole = false;
    choosingFrame = false;
    el("pick-hole").setAttribute("aria-pressed", "false");
    connectStart = null;
    el("connect-nodes").setAttribute("aria-pressed", "false");
    el("tool-hint").textContent = "選択操作を解除しました";
    draw();
  }
});
let palette: "male" | "female" = "male";
function paletteKind() {
  return palette;
}
function nextMemberId(d: Design) {
  let n = 0;
  while ([...d.members, ...d.nodes, ...d.rings, ...d.ropes, ...d.materials].some((m) => m.id === `m${n}`))
    n++;
  return `m${n}`;
}
for (const kind of ["male", "female"] as const)
  el(`palette-${kind}`).addEventListener("click", () => {
    palette = kind;
    for (const k of ["male", "female"]) el(`palette-${k}`).setAttribute("aria-pressed", String(k === kind));
    el("quick-anchor").hidden = kind !== "female";
    el("male-add-tools").hidden = kind !== "male";
    el("female-add-tools").hidden = kind !== "female";
    connectStart = null;
    el("connect-nodes").setAttribute("aria-pressed", "false");
    if (kind === "female") {
      choosingHole = false;
      malePreview = null;
    } else refreshMalePreview();
    draw();
    if (kind === "male" && !select("quick-direction").value.includes("x"))
      select("quick-direction").value = "x";
    if (kind === "female" && select("quick-direction").value === "x") select("quick-direction").value = "y";
  });
el("quick-add").addEventListener("click", () =>
  guard(() => {
    let target = selected;
    let member = selectedMember;
    update((d) => {
      const value = select("quick-direction").value;
      const axis = value.endsWith("x") ? 0 : value.endsWith("y") ? 1 : 2;
      const direction: [number, number, number] = [0, 0, 0];
      direction[axis] = value.startsWith("-") ? -1 : 1;
      const result = appendMember(d, selected, paletteKind(), direction, Number(input("quick-length").value));
      target = result.nodeId;
      member = result.memberId;
    });
    selected = target;
    selectedMember = member;
    selectionType = "member";
    sync();
    draw();
    viewport?.pulse([member]);
  }),
);
el("connect-nodes").addEventListener("click", () => {
  connectStart = connectStart ? null : selected;
  el("connect-nodes").setAttribute("aria-pressed", String(connectStart !== null));
  el("tool-hint").textContent = connectStart
    ? `${connectStart}から接続。次の節点を図でクリック / Escで解除`
    : "接続操作を解除しました";
});
el("extend-bay").addEventListener("click", () =>
  guard(() => {
    update((d) => extendBay(d, Number(input("depth").value)));
    viewport?.fit();
  }),
);
for (const button of document.querySelectorAll<HTMLButtonElement>(".nudge button"))
  button.addEventListener("click", () =>
    guard(() =>
      update((d) => {
        const node = d.nodes.find((n) => n.id === selected);
        if (!node) throw new Error("節点がありません");
        const axis = { x: 0, y: 1, z: 2 }[button.dataset.axis as "x" | "y" | "z"];
        node.position[axis] =
          Math.round(
            (node.position[axis] + Number(button.dataset.delta) * Number(select("snap").value)) * 1e6,
          ) / 1e6;
        selectionType = "node";
      }),
    ),
  );
el("move-tool").addEventListener("click", () => {
  const on = el("move-tool").getAttribute("aria-pressed") !== "true";
  el("move-tool").setAttribute("aria-pressed", String(on));
  selectionType = "node";
  el("tool-hint").textContent = on
    ? "色付き矢印をドラッグして節点を移動（刻みにスナップ）"
    : "ドラッグで視点回転 / 部材をクリックで選択";
  draw();
});
select("snap").addEventListener("change", draw);
input("nodes-visible").addEventListener("change", draw);
el("front").addEventListener("click", () => viewport?.viewFront());
el("side").addEventListener("click", () => viewport?.viewSide());
el("focus-member").addEventListener("click", () => viewport?.focusMember(select("member").value));
function syncRing() {
  const ring = design.rings.find((r) => r.id === select("ring-id").value);
  if (!ring) return;
  selectedRing = ring.id;
  select("ring-member").value = ring.member;
  select("ring-end").value = ring.end;
  input("ring-slot").value = String(ring.slot);
}
function addRing() {
  const member = select("ring-member").value;
  const end = select("ring-end").value as "start" | "end";
  const slot = freeRingSlot(design, member, end);
  const ringId = id("ring");
  update((d) => {
    d.rings.push({ id: ringId, member, end, slot, role: "spacer-unmodeled" });
  });
  selectedRing = ringId;
  selectionType = "ring";
  sync();
  el<HTMLDetailsElement>("ring-inspector").open = true;
  draw();
}
select("ring-id").addEventListener("change", () => {
  syncRing();
  selectionType = "ring";
  draw();
});
el("ring-auto").addEventListener("click", () => guard(addRing));
el("ring-apply").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      const ring = d.rings.find((r) => r.id === select("ring-id").value);
      if (!ring) throw new Error("丸材を選んでください");
      ring.member = select("ring-member").value;
      ring.end = select("ring-end").value as "start" | "end";
      ring.slot = Number(input("ring-slot").value);
    }),
  ),
);
el("ring-delete").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      d.rings = d.rings.filter((r) => r.id !== select("ring-id").value);
      selectedRing = "";
      selectionType = "node";
    }),
  ),
);
function syncHoleChoices() {
  const selectedFemale = select("hole-female").value;
  const selectedHole = select("hole-number").value;
  select("hole-female").replaceChildren(
    new Option("雌材を選ぶ、または図の穴をクリック", ""),
    ...design.members
      .filter((m) => m.kind === "female")
      .map((m) => new Option(`雌材 ${m.id}（${m.holeCount}穴）`, m.id)),
  );
  if (design.members.some((m) => m.id === selectedFemale)) select("hole-female").value = selectedFemale;
  syncHoleNumbers(selectedHole === "" ? undefined : Number(selectedHole));
  refreshMalePreview();
}
function syncHoleNumbers(preferred?: number) {
  const member = design.members.find((m) => m.id === select("hole-female").value && m.kind === "female");
  select("hole-number").replaceChildren();
  if (!member) return;
  for (let hole = 0; hole < member.holeCount; hole++) {
    const occupied = holeOccupied(design, member.id, hole);
    const option = new Option(`穴${hole + 1}${occupied ? " · 接続済み" : ""}`, String(hole));
    option.disabled = occupied;
    select("hole-number").append(option);
  }
  const candidate =
    preferred !== undefined && !holeOccupied(design, member.id, preferred)
      ? preferred
      : Array.from({ length: member.holeCount }, (_, i) => i)
          .filter((i) => !holeOccupied(design, member.id, i))
          .sort(
            (a, b) => Math.abs(a - (member.holeCount - 1) / 2) - Math.abs(b - (member.holeCount - 1) / 2),
          )[0];
  select("hole-number").value = candidate === undefined ? "" : String(candidate);
}
function refreshMalePreview() {
  malePreview = null;
  el<HTMLButtonElement>("insert-male").disabled = true;
  if (paletteKind() !== "male" || !select("hole-female").value || select("hole-number").value === "") {
    el("male-preview-status").textContent = "図の緑色の穴、または雌材と穴番号を選んでください。";
    return;
  }
  try {
    malePreview = insertionPreview(
      design,
      select("hole-female").value,
      Number(select("hole-number").value),
      Number(input("male-length").value),
      Number(select("male-side").value) as 1 | -1,
    );
    const candidate = structuredClone(design);
    insertMaleAtHole(
      candidate,
      select("hole-female").value,
      Number(select("hole-number").value),
      Number(input("male-length").value),
      Number(select("male-side").value) as 1 | -1,
    );
    validateDesign(candidate);
    el<HTMLButtonElement>("insert-male").disabled = false;
    el("male-preview-status").textContent =
      `垂直にスナップ。${malePreview.connections.length}枚の雌材をシャフトで接続します。緑の半透明が配置プレビューです。`;
  } catch (e) {
    malePreview = null;
    el("male-preview-status").textContent = e instanceof Error ? e.message : String(e);
  }
}
select("hole-female").addEventListener("change", () => {
  syncHoleNumbers();
  refreshMalePreview();
  draw();
});
for (const id of ["hole-number", "male-side"])
  select(id).addEventListener("change", () => {
    refreshMalePreview();
    draw();
  });
input("male-length").addEventListener("input", () => {
  refreshMalePreview();
  draw();
});
el("pick-hole").addEventListener("click", () => {
  el("rope-workflow").hidden = true;
  chosenFrame = "";
  palette = "male";
  el("male-add-tools").hidden = false;
  el("female-add-tools").hidden = true;
  el("palette-male").setAttribute("aria-pressed", "true");
  el("palette-female").setAttribute("aria-pressed", "false");
  choosingHole = !choosingHole;
  choosingFrame = false;
  el("pick-hole").setAttribute("aria-pressed", String(choosingHole));
  el("tool-hint").textContent = choosingHole
    ? "緑色の穴をクリック。雄材は雌材に垂直にスナップします。"
    : "穴の選択を終了しました";
  draw();
});
el("insert-male").addEventListener("click", () =>
  guard(() => {
    let member = "";
    let node = "";
    update((d) => {
      const result = insertMaleAtHole(
        d,
        select("hole-female").value,
        Number(select("hole-number").value),
        Number(input("male-length").value),
        Number(select("male-side").value) as 1 | -1,
      );
      member = result.memberId;
      node = result.nodeId;
    });
    selectedMember = member;
    selected = node;
    selectionType = "member";
    choosingHole = false;
    select("hole-female").value = "";
    select("hole-number").replaceChildren();
    malePreview = null;
    actionNote = "穴に垂直に差し込み、通過する雌材との構造接続を保存しました";
    sync();
    draw();
    viewport?.pulse([member, ...design.connections.filter((c) => c.male === member).map((c) => c.female)]);
  }),
);
function syncRopeWorkflow() {
  const frames = detectRopeFrames(design);
  select("rope-frame").replaceChildren(
    new Option("対応する枠を選んでください", ""),
    ...frames.map((f, i) => new Option(`枠${i + 1} · 雄材 ${f.males.join(" / ")}`, f.id)),
  );
  if (frames.some((f) => f.id === chosenFrame)) select("rope-frame").value = chosenFrame;
  else chosenFrame = "";
  const selected = frames.find((f) => f.id === chosenFrame);
  const previous = select("rope-winder").value;
  select("rope-winder").replaceChildren(new Option("巻き取り用の雄材を選ぶ", ""));
  el<HTMLButtonElement>("confirm-rope").disabled = true;
  if (!selected) {
    el("rope-workflow-status").textContent = frames.length
      ? "図の面または一覧で、雄材2本・雌材2本の枠を選んでください。"
      : "対応する平面の四辺枠がありません。";
    return;
  }
  const existing = ropeOnFrame(design, selected);
  for (const id of selected.males) {
    const reason = windingUnavailable(design, selected, id, existing?.id);
    const option = new Option(`雄材 ${id}${reason ? " · 使用不可" : ""}`, id);
    option.disabled = !!reason;
    select("rope-winder").append(option);
  }
  if ([...select("rope-winder").options].some((o) => o.value === previous && !o.disabled))
    select("rope-winder").value = previous;
  el("rope-workflow-status").textContent = existing
    ? `ロープ ${existing.id} が配置済み。巻き取り材を選んで更新できます。`
    : "巻き取り材はこのロープ専用になります。先端の最外側に掛けます。";
  el<HTMLButtonElement>("confirm-rope").disabled = !select("rope-winder").value;
}
function startRopeTool() {
  select("hole-female").value = "";
  select("hole-number").replaceChildren();
  refreshMalePreview();
  el("rope-workflow").hidden = false;
  choosingFrame = true;
  choosingHole = false;
  malePreview = null;
  syncRopeWorkflow();
  draw();
  el("tool-hint").textContent = "ロープを張る面をクリックし、巻き取りに使う雄材を選んでください。";
}
el("rope-tool").addEventListener("click", startRopeTool);
el("pick-frame").addEventListener("click", () => {
  choosingFrame = true;
  choosingHole = false;
  draw();
});
select("rope-frame").addEventListener("change", () => {
  chosenFrame = select("rope-frame").value;
  choosingFrame = false;
  syncRopeWorkflow();
  draw();
});
select("rope-winder").addEventListener("change", () => {
  el<HTMLButtonElement>("confirm-rope").disabled = !select("rope-winder").value;
});
el("confirm-rope").addEventListener("click", () =>
  guard(() => {
    const target = detectRopeFrames(design).find((f) => f.id === chosenFrame);
    if (!target) throw new Error("対象の枠を選んでください");
    const winding = select("rope-winder").value;
    const existing = ropeOnFrame(design, target);
    const reason = windingUnavailable(design, target, winding, existing?.id);
    if (reason) throw new Error(reason);
    update((d) => {
      const rope = existing ? d.ropes.find((r) => r.id === existing.id) : undefined;
      const route = routeForWinder(target, winding);
      if (rope) {
        rope.route = route;
        rope.windingMember = winding;
      } else {
        d.ropes.push({
          id: id("r"),
          route,
          windingMember: winding,
          stiffness: Number(input("rope-k").value),
          prestrain: Number(input("prestrain").value),
          slack: Number(input("slack").value),
        });
      }
    });
    choosingFrame = false;
    actionNote = `雄材 ${winding} を専用の巻き取り材として、ロープを最外側に張りました`;
    draw();
    viewport?.pulse([...target.males, ...target.females]);
  }),
);
el("cancel-rope").addEventListener("click", () => {
  el("rope-workflow").hidden = true;
  choosingFrame = false;
  chosenFrame = "";
  draw();
});
try {
  viewport = new Viewport(el("viewport"));
  viewport.onMoveNode = (id, position) =>
    guard(() => {
      selected = id;
      selectionType = "node";
      try {
        update((d) => {
          const node = d.nodes.find((n) => n.id === id);
          if (!node) throw new Error("節点がありません");
          node.position = position.map((v) => Math.round(v * 1e6) / 1e6) as [number, number, number];
        });
      } finally {
        draw();
      }
    });
  viewport.onHoleSelect = (female, hole) => {
    select("hole-female").value = female;
    syncHoleNumbers(hole);
    choosingHole = false;
    el("pick-hole").setAttribute("aria-pressed", "false");
    refreshMalePreview();
    draw();
  };
  viewport.onFrameSelect = (id) => {
    chosenFrame = id;
    choosingFrame = false;
    select("rope-frame").value = id;
    syncRopeWorkflow();
    draw();
  };
  viewport.onMemberSelect = (id) => {
    const member = design.members.find((m) => m.id === id);
    if (member?.kind === "female" && paletteKind() === "male") {
      select("hole-female").value = id;
      syncHoleNumbers();
      refreshMalePreview();
    }
    select("member").value = id;
    syncMember(true);
  };
  viewport.onRingSelect = (id) => {
    selectedRing = id;
    select("ring-id").value = id;
    syncRing();
    selectionType = "ring";
    el<HTMLDetailsElement>("ring-inspector").open = true;
    draw();
  };
  viewport.onSelect = (id) => {
    selected = id;
    selectionType = "node";
    if (connectStart) {
      const start = connectStart;
      connectStart = null;
      el("connect-nodes").setAttribute("aria-pressed", "false");
      guard(() =>
        update((d) => {
          if (start === id) throw new Error("異なる2節点を選んでください");
          const a = d.nodes.find((n) => n.id === start);
          const b = d.nodes.find((n) => n.id === id);
          if (!a || !b) throw new Error("節点がありません");
          const length = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
          d.members.push({
            id: nextMemberId(d),
            kind: paletteKind(),
            start,
            end: id,
            material: d.materials[0].id,
            roll: paletteKind() === "female" ? 90 : 0,
            layer: paletteKind() === "female" ? nextOuterLayer(d, [start, id]) : 0,
            holeCount: Math.max(2, Math.min(7, Math.floor(length / (d.geometry.holeSize * 1.5)) + 1)),
          });
        }),
      );
    }
    syncNode();
  };
} catch (e) {
  error(`3D表示を開始できません。WebGL対応ブラウザが必要です。${String(e)}`);
}
try {
  el<HTMLButtonElement>("recover").disabled = localStorage.getItem("tsumiki-design-draft-v2") === null;
} catch (e) {
  error(`下書きの確認に失敗しました: ${String(e)}`);
}
sync();
viewport?.fit();
requestAnimationFrame(() => calculate());
