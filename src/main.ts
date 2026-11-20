import { catalogPart, HITOTO_PARTS, memberPart } from "./structure/catalog";
import { validateMemberCollisions } from "./structure/collision";
import {
  createDesign,
  type Design,
  type Member,
  parseDesign,
  serializeDesign,
  type Vec3,
  validateDesign,
} from "./structure/design";
import {
  AXIS_DIRECTIONS,
  type AxisDirection,
  appendMember,
  boardRoll,
  braceTargets,
  connectBoard,
  connectThreadedMales,
  createDrawingDesign,
  DesignHistory,
  extendBay,
  femaleDirections,
  insertMaleAtHole,
  nextFemaleSize,
  placeBoard,
  removeMember,
  resizeBoard,
  resizeEnds,
  shiftLayer,
  toggleBoardEnd,
} from "./structure/editor";
import { mountEngineering } from "./structure/engineering-ui";
import { freeRingSlot } from "./structure/geometry";
import { holeOccupied, insertionPreview } from "./structure/holes";
import { detectRopeFrames, ropeOnFrame, routeForWinder, windingUnavailable } from "./structure/rope";
import { type Excitation, type RopeMode, simulate, solveStatic } from "./structure/solver";
import { autoSupports } from "./structure/supports";
import { addTemplate, apexDirection, type TemplateShape, templateDirections } from "./structure/templates";
import {
  alignHoles,
  HingeSweep,
  type HoleRef,
  jointConstraint,
  type MoveTarget,
  mirrorEdit,
  mirrorParts,
  mirrorPlane,
  moveParts,
  pivotOf,
  rotate3,
  targetParts,
} from "./structure/transform";
import { type TransformSpec, Viewport } from "./structure/viewport";
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
let design = createDrawingDesign();
let selected = "n0";
let selectedMember = "m0";
let selectedRing = "";
let selectionType: "node" | "member" | "ring" = "node";
let connectStart: string | null = null;
/** "selection" moves what is selected (a node, or a member on its own). */
let moveScope: "selection" | "group" | "all" = "selection";
let moveMode: "translate" | "rotate" = "translate";
/** Keep joints to males: a part on one shaft only turns about it, within the range that does not collide. */
let keepJoints = true;
let hingeCache: { design: Design; key: string; sweep: HingeSweep } | null = null;
let choosingHole = false;
/** Laying holes over each other: picking holes on the 3D view, the first one stays. */
let aligning = false;
let alignList: HoleRef[] = [];
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
let engineeringPanel: ReturnType<typeof mountEngineering> | undefined;
let pendingCalculation = 0;
// What the last edit did; kept in the status line after the automatic recompute.
let actionNote = "";

el("app").innerHTML = `
<header class="topbar"><a class="brand" href="/">▰ tsumiki</a><div class="mode-tabs" role="tablist" aria-label="作業画面"><button id="tab-model" role="tab" type="button" aria-selected="true" aria-controls="properties"><kbd>1</kbd> モデリング</button><button id="tab-sim" role="tab" type="button" aria-selected="false" aria-controls="properties" tabindex="-1"><kbd>2</kbd> シミュレーション</button></div><div class="file-actions"><button id="new-design" type="button" title="床に雌材を1枚置いた状態から始めます（元に戻せます）">＋ 新規</button><button id="recover" type="button" disabled>下書きを復元</button><button id="import" type="button">設計を読み込む</button><button id="export" class="primary" type="button">↓ 設計を保存</button><input id="file" type="file" accept=".json,.tsumiki.json" hidden></div></header>
<main class="workspace" id="workspace" data-mode="model">
<nav class="toolbar" aria-label="ツール"><button id="tool-select" type="button" class="tool" aria-pressed="false" aria-label="選択" title="選択（Esc）"><span aria-hidden="true">⬚</span></button><span class="model-only tool-set"><button id="move-tool" type="button" class="tool" aria-pressed="false" aria-label="移動" title="移動（G）"><span aria-hidden="true">✥</span></button><button id="tool-hole" type="button" class="tool" aria-pressed="false" aria-label="穴に雄材を差し込む" title="穴に雄材を差し込む（I）"><span aria-hidden="true">⊕</span></button><button id="tool-female" type="button" class="tool" aria-pressed="false" aria-label="雌材を追加" title="雌材を追加（Shift+A）"><span aria-hidden="true">▣</span></button><button id="tool-template" type="button" class="tool" aria-pressed="false" aria-label="テンプレートを追加" title="テンプレートを追加（T）"><span aria-hidden="true">◫</span></button><button id="rope-tool" type="button" class="tool" aria-pressed="false" aria-label="ロープを張る" title="ロープを張る（R）"><span aria-hidden="true">⟋</span></button></span></nav>
<section class="viewer" aria-label="3Dビュー"><div class="view-header"><div class="view-group" role="group" aria-label="視点"><button id="fit" type="button" title="全体（Home）">全体</button><button id="front" type="button" title="正面（テンキー1）">正面</button><button id="side" type="button" title="側面（テンキー3）">側面</button><button id="top" type="button" title="上面（テンキー7）">上面</button></div><label class="check"><input id="nodes-visible" type="checkbox" checked>節点</label><label class="model-only snap-field">移動刻み<select id="snap"><option value="0">自由</option><option value="0.01">0.01</option><option value="0.05">0.05</option><option value="0.1" selected>0.1</option><option value="0.25">0.25</option></select></label><span class="spacer"></span><button id="mirror-mode" class="model-only" type="button" aria-pressed="false" title="ミラーモード：以降の編集を中心の雄材の反対側にも反映（M）">⇋ ミラー</button><button id="delete-selection" class="model-only danger" type="button" title="選択中の部材・節点・丸材を削除（X / Delete / Backspace）">🗑 削除</button><button id="undo" type="button" disabled title="元に戻す（Ctrl+Z）">↶ 元に戻す</button><button id="redo" type="button" disabled title="やり直す（Ctrl+Shift+Z）">↷ やり直す</button></div><div class="viewport-wrap"><div id="viewport"></div><div class="view-overlay"><span id="viewer-title">設計</span><span id="selection-summary">節点 n6</span></div><div id="shortcuts" class="shortcuts" aria-label="主なショートカット"></div><div class="axis-legend">X 赤 / Y 上・緑 / Z 青</div><div class="legend model-only"><span class="male">● 雄材</span><span class="female">● 雌材</span><span class="rope">● ロープ</span><span><span id="tenon-dimensions">凸部165mm・板厚30mm</span></span></div><div class="legend sim-only"><span id="deformation-legend">薄線：変形前</span><span>変形は表示倍率で拡大</span></div><div id="error" role="alert" class="error" hidden></div></div></section>
<aside class="sidebar"><section class="outliner" aria-label="アウトライナー"><h2>アウトライナー</h2><div id="outliner" class="outliner-tree"></div></section><section class="properties" id="properties" aria-label="プロパティ"><div class="prop-tabs" role="tablist" aria-orientation="vertical" aria-label="プロパティ"><button type="button" class="prop-tab" data-page="add" data-for="model" role="tab" aria-label="追加のプロパティ" title="追加">＋</button><button type="button" class="prop-tab" data-page="transform" data-for="model" role="tab" aria-label="配置のプロパティ" title="配置（移動・回転）">✥</button><button type="button" class="prop-tab" data-page="node" data-for="model" role="tab" aria-label="節点のプロパティ" title="節点">●</button><button type="button" class="prop-tab" data-page="member" data-for="model" role="tab" aria-label="部材のプロパティ" title="部材">▭</button><button type="button" class="prop-tab" data-page="ring" data-for="model" role="tab" aria-label="丸材のプロパティ" title="丸材">◎</button><button type="button" class="prop-tab" data-page="rope" data-for="model" role="tab" aria-label="ロープのプロパティ" title="ロープ">⟋</button><button type="button" class="prop-tab" data-page="frame" data-for="model" role="tab" aria-label="枠のプロパティ" title="枠">▦</button><button type="button" class="prop-tab" data-page="design" data-for="model" role="tab" aria-label="設計のプロパティ" title="設計">✎</button><button type="button" class="prop-tab" data-page="load" data-for="sim" role="tab" aria-label="荷重のプロパティ" title="荷重">↧</button><button type="button" class="prop-tab" data-page="shake" data-for="sim" role="tab" aria-label="揺れのプロパティ" title="揺れ">∿</button><button type="button" class="prop-tab" data-page="joint" data-for="sim" role="tab" aria-label="接合のプロパティ" title="接合">⊞</button><button type="button" class="prop-tab" data-page="material" data-for="sim" role="tab" aria-label="材料のプロパティ" title="材料">◇</button><button type="button" class="prop-tab" data-page="info" data-for="sim" role="tab" aria-label="前提のプロパティ" title="前提">ⓘ</button></div><div class="prop-pages"><section class="prop-page" id="page-add" data-page="add" data-for="model" role="tabpanel" aria-label="追加"><h2>追加</h2><div class="catalog"><p id="drawing-info" class="hint"></p><label for="drawing-start">図面から新規作成する部材</label><select id="drawing-start"></select><p class="hint">上の「＋ 新規」で選択した図面部材から始めます。</p><div id="drawing-settings"><label>凸部の角丸R（mm・仮定）<input id="tenon-radius" type="number" min="0" max="15" step="0.1" value="6.3"></label><button id="apply-tenon-radius" type="button">凸部の丸みを更新</button><p class="hint">30mm角の角丸断面は確認済み。R6.3mmは仮定値です。雌材の面取り6.3Rは未再現。力・時間は未校正です。</p></div><p class="hint">追加する部材を選んでください。雄材は雌材の穴に差し込み、雌材は雄材の角棒（節点）から伸ばします。</p><div class="button-row"><button id="palette-male" type="button" aria-pressed="true">⊣ 雄材 ⊢</button><button id="palette-female" type="button" aria-pressed="false">▣ 雌材</button><button id="palette-template" type="button" aria-pressed="false">◫ テンプレート</button></div><div id="female-add-tools" hidden><label id="female-catalog-label" for="female-catalog">雌材の図面規格（全長mm）</label><select id="female-catalog"></select><p class="hint">① 起点の節点（緑）を図でクリック → ② 向きを選ぶ → ③ 追加。半透明の板が配置プレビューです。</p><p id="female-anchor" class="anchor-line"></p><div class="direction-pad" role="group" aria-label="追加する向き"><button type="button" class="dir-button" data-dir="-x" aria-pressed="false" aria-label="−X 左へ"><span>−X 左</span><small></small></button><button type="button" class="dir-button" data-dir="x" aria-pressed="false" aria-label="+X 右へ"><span>+X 右</span><small></small></button><button type="button" class="dir-button" data-dir="-y" aria-pressed="false" aria-label="−Y 下へ"><span>−Y 下</span><small></small></button><button type="button" class="dir-button" data-dir="y" aria-pressed="false" aria-label="+Y 上へ"><span>+Y 上</span><small></small></button><button type="button" class="dir-button" data-dir="-z" aria-pressed="false" aria-label="−Z 手前へ"><span>−Z 手前</span><small></small></button><button type="button" class="dir-button" data-dir="z" aria-pressed="false" aria-label="+Z 奥へ"><span>+Z 奥</span><small></small></button></div><label for="female-tilt">傾き °（角棒まわり。斜めに出す筋交い用）</label><input id="female-tilt" type="number" min="-180" max="180" step="15" value="0"><label for="quick-length">長さ比（先に節点があれば自動で合わせます）</label><input id="quick-length" type="number" min="0.2" max="4" step="0.1" value="1"><p id="female-preview-status" class="hint"></p><button id="quick-add" class="primary" type="button" disabled>③ 雌材を追加</button><button id="connect-nodes" type="button" aria-pressed="false">2つの節点をクリックしてつなぐ</button><h3>筋交い・つなげる節点</h3><p class="hint">起点から規格の長さでちょうど届く節点です。押すとその節点まで雌材を張ります（交差する板は別の段に入ります）。</p><div id="brace-targets" class="brace-targets"></div></div><div id="template-tools" hidden><p class="hint">① 起点の雄材を図かアウトライナーでクリック（平行な2本目もクリックすると、その2本を結びます）→ ② 形・向き・大きさ → ③ 追加。半透明が配置プレビューです。</p><p id="template-males" class="anchor-line"></p><button id="template-clear" type="button">雄材の選択をやり直す</button><div class="button-row" role="group" aria-label="形"><button type="button" class="shape-button" data-shape="square" aria-pressed="true">□ 四角形</button><button type="button" class="shape-button" data-shape="triangle" aria-pressed="false">△ 三角形</button></div><div id="template-one"><h3>2本目の雄材の位置</h3><div class="direction-pad" role="group" aria-label="広げる向き"><button type="button" class="template-dir" data-dir="-x" aria-pressed="false" aria-label="−X 左へ広げる">−X 左</button><button type="button" class="template-dir" data-dir="x" aria-pressed="false" aria-label="+X 右へ広げる">+X 右</button><button type="button" class="template-dir" data-dir="-y" aria-pressed="false" aria-label="−Y 下へ広げる">−Y 下</button><button type="button" class="template-dir" data-dir="y" aria-pressed="false" aria-label="+Y 上へ広げる">+Y 上</button><button type="button" class="template-dir" data-dir="-z" aria-pressed="false" aria-label="−Z 手前へ広げる">−Z 手前</button><button type="button" class="template-dir" data-dir="z" aria-pressed="false" aria-label="+Z 奥へ広げる">+Z 奥</button></div><label for="template-size">大きさの比（雄材どうしの間隔）</label><input id="template-size" type="number" min="0.2" max="4" step="0.1" value="1"><p id="template-part" class="hint"></p><div class="button-row" role="group" aria-label="雌材の長さ"><button id="template-shorter" type="button" title="雌材を1規格短く（[）">◀ 1規格短く</button><button id="template-longer" type="button" title="雌材を1規格長く（]）">1規格長く ▶</button></div></div><div id="template-side" hidden><h3>三角形の頂点の側</h3><div class="button-row" role="group" aria-label="頂点の側"><button type="button" class="side-button" data-side="1" aria-pressed="true"></button><button type="button" class="side-button" data-side="-1" aria-pressed="false"></button></div><p class="hint">三角形の板は角棒の軸まわりに回って付きます。穴の実寸が未確定のため回転の上限は検査せず、解析では組んだ角度を中心に通常と同じ遊びがあると仮定します。</p></div><p id="template-status" class="hint"></p><button id="template-add" class="primary" type="button" disabled>③ テンプレートを追加</button></div><div id="male-add-tools"><label id="male-catalog-label" for="male-catalog">雄材の図面規格（凸部込み全長mm）</label><select id="male-catalog"></select><p class="hint">① 雌材の穴を選ぶ → ② 長さ・差し込み側 → ③ 差し込む。垂直方向と座標は自動です。</p><button id="pick-hole" type="button" aria-pressed="false">① 図の穴を選ぶ</button><label for="hole-female">差し込む雌材</label><select id="hole-female"></select><label for="hole-number">差し込む穴</label><select id="hole-number"></select><div class="double"><label>雄材の長さ比<input id="male-length" type="number" min="0.2" max="4" step="0.1" value="1.4"></label><label>差し込み側<select id="male-side"><option value="1">表側へ</option><option value="-1">裏側へ</option></select></label></div><p id="male-preview-status" class="hint">空いている穴を選択してください。</p><button id="insert-male" type="button" class="primary" disabled>③ 雄材を差し込む</button></div></div></section><section class="prop-page" id="page-transform" data-page="transform" data-for="model" role="tabpanel" aria-label="配置" hidden><h2>配置（移動・回転）</h2><h3>動かす対象</h3><div class="button-row" role="group" aria-label="動かす対象"><button type="button" class="scope-button" data-scope="selection" aria-pressed="true">選択中</button><button type="button" class="scope-button" data-scope="group" aria-pressed="false">つながり</button><button type="button" class="scope-button" data-scope="all" aria-pressed="false">構造全体（A）</button></div><p id="move-summary" class="anchor-line"></p><button type="button" id="move-constraint" aria-pressed="true" title="雄材とつながっている部分は、その軸まわりに干渉しない範囲だけ回します（C）">⛓ 接続を保って動かす（自動）</button><p id="move-constraint-status" class="hint"></p><h3>操作</h3><div class="button-row" role="group" aria-label="操作"><button type="button" class="mode-button" data-mode="translate" aria-pressed="true">✥ 移動（G）</button><button type="button" class="mode-button" data-mode="rotate" aria-pressed="false">⟳ 回転（R）</button></div><label for="rotation-snap">回転の刻み</label><select id="rotation-snap"><option value="0">自由</option><option value="5">5°</option><option value="15" selected>15°</option><option value="45">45°</option><option value="90">90°</option></select><h3>数値で動かす</h3><div class="triple"><label>ΔX<input id="move-dx" type="number" step="0.01" value="0"></label><label>ΔY<input id="move-dy" type="number" step="0.01" value="0"></label><label>ΔZ<input id="move-dz" type="number" step="0.01" value="0"></label></div><button id="apply-move" type="button">移動する</button><div class="double"><label>回転軸<select id="rotate-axis"><option value="x">X軸</option><option value="y" selected>Y軸（鉛直）</option><option value="z">Z軸</option></select></label><label>角度 °<input id="rotate-angle" type="number" step="1" value="90"></label></div><button id="apply-rotate" type="button">回転する</button><h3>ミラー（左右対称）</h3><label for="mirror-center">中心の雄材（Shift+M で選択中の雄材に）</label><select id="mirror-center"></select><div class="button-row"><button id="mirror-selection" type="button">選択中を1回ミラー</button><button id="mirror-all" type="button">全体を左右対称に</button></div><p id="mirror-status" class="hint"></p><h3>穴を重ねる</h3><p class="hint">1つ目に選んだ穴（青）に、2つ目以降の穴（橙）が重なるよう、その雌材を載っている角棒まわりに回します。重なった穴には雄材を差し込めます。</p><button id="align-pick" type="button" aria-pressed="false">◎ 穴を選ぶ（O）</button><p id="align-list" class="anchor-line"></p><div class="button-row"><button id="align-apply" type="button" class="primary" disabled>重ねる（Enter）</button><button id="align-clear" type="button">選び直す</button></div><p class="hint">回転は対象の中心まわり。部材を単独で動かすと、共有していた節点から切り離します。端が他の節点に近づくと吸着し、そこで再びつながります。雄材は通った穴に自動で接続し直します。長さ・板の向きは保たれます。</p></section><section class="prop-page" id="page-node" data-page="node" data-for="model" role="tabpanel" aria-label="節点と支持" hidden><h2>節点と支持</h2><label for="node">節点（3D図でも選択可）</label><select id="node"></select><div class="triple"><label>X<input id="nx" type="number" step="0.1"></label><label>Y<input id="ny" type="number" step="0.1"></label><label>Z<input id="nz" type="number" step="0.1"></label></div><label class="check"><input id="auto-supports" type="checkbox" checked>支持を自動で決める（床に接する部材の下端を固定）</label><label class="check"><input id="fixed" type="checkbox">全6自由度を固定</label><button id="apply-node" type="button">節点を更新</button><div class="nudge"><button data-axis="x" data-delta="-1" type="button">−X</button><button data-axis="x" data-delta="1" type="button">+X</button><button data-axis="y" data-delta="-1" type="button">−Y</button><button data-axis="y" data-delta="1" type="button">+Y</button><button data-axis="z" data-delta="-1" type="button">−Z</button><button data-axis="z" data-delta="1" type="button">+Z</button></div><button id="delete-node" type="button">節点と接続を削除</button><div class="button-row"><button id="add-node" type="button">節点を追加</button><button id="add-ring" type="button">丸材を配置</button></div><p class="hint">丸材は雄材の角棒にはめて空き段を埋めます。接触・剛性・質量への寄与は未解析です。</p></section><section class="prop-page" id="page-member" data-page="member" data-for="model" role="tabpanel" aria-label="部材・形状" hidden><h2>部材・形状</h2><p id="member-dimensions" class="hint"></p><label for="member">部材</label><select id="member"></select><label for="kind">種類</label><select id="kind"><option value="male">雄材</option><option value="female">雌材</option></select><div class="double"><label>始点<select id="start"></select></label><label>終点<select id="end"></select></label></div><div class="triple"><label>板の回転 °<input id="member-roll" type="number" min="-180" max="180" step="90" value="0"></label><label>雌材の段<input id="member-layer" type="number" min="0" max="3" step="1" value="0"></label><label>雌材の穴数<input id="member-holes" type="number" min="2" max="32" step="1" value="7"></label></div><p class="hint">雄材・雌材の実体が重なる配置は拒否します（穴内の差し込み・面接触は許容）。段は角棒上の重ね位置。追加は空いている内側の段から。0〜3段が部材用、先端の1枚分はロープ用です。</p><div class="button-row" role="group" aria-label="重ね順"><button id="layer-out" type="button" title="1段外側へ（隣の板と入れ替え）">▲ 外側の段へ</button><button id="layer-in" type="button" title="1段内側へ（隣の板と入れ替え）">▼ 内側の段へ</button></div><p id="layer-status" class="hint"></p><div class="button-row" role="group" aria-label="規格の伸縮"><button id="board-shorter" type="button" title="1規格短く（[ / Shift+[ で反対の端）">◀ 1規格短く</button><button id="board-longer" type="button" title="1規格長く（] / Shift+] で反対の端）">1規格長く ▶</button><button id="board-end" type="button" title="端の形を 角 ⇄ 丸 に切り替え（K）">角 ⇄ 丸</button></div><p id="board-resize-ends" class="anchor-line"></p><button id="board-flip-end" type="button" title="伸縮で動かす端を反対にする（Shift+[ / ] は1回だけ反対の端）">⇄ 動かす端を入れ替え</button><button id="focus-member" type="button">この部材に寄る</button><div class="button-row"><button id="apply-member" type="button">更新</button><button id="add-member" type="button">追加</button><button id="delete-member" type="button">削除</button></div></section><section class="prop-page" id="page-ring" data-page="ring" data-for="model" role="tabpanel" aria-label="丸材・空き段" hidden><h2>丸材・空き段</h2><label for="ring-id">配置済みの丸材</label><select id="ring-id"></select><label for="ring-member">はめる雄材</label><select id="ring-member"></select><div class="double"><label>差し込み側<select id="ring-end"><option value="start">始点側</option><option value="end">終点側</option></select></label><label>はめる段<input id="ring-slot" type="number" min="0" max="3" step="1" value="1"></label></div><div class="button-row"><button id="ring-auto" type="button">空き段にはめる</button><button id="ring-apply" type="button">位置を更新</button><button id="ring-delete" type="button">外す</button></div><p class="hint">雄材の左右の角棒に沿って配置。雌材と同じ段・角棒の外・丸材同士の重複は拒否します。</p></section><section class="prop-page" id="page-rope" data-page="rope" data-for="model" role="tabpanel" aria-label="ロープ" hidden><h2>ロープ</h2><div id="rope-workflow" class="rope-workflow" hidden><h3>ロープを張る</h3><p class="hint">① 対応する四辺の枠を選ぶ → ② 巻き取り専用の雄材を選ぶ → ③ 張る。ロープは凸部の最外側に掛かります。</p><button id="pick-frame" type="button">① 図で枠を選ぶ</button><label for="rope-frame">対象の構造部分</label><select id="rope-frame"></select><label for="rope-winder">巻き取り用の雄材（他のロープと共用不可）</label><select id="rope-winder"></select><p id="rope-workflow-status" class="hint"></p><div class="button-row"><button id="confirm-rope" type="button" class="primary" disabled>③ ロープを張る</button><button id="cancel-rope" type="button">閉じる</button></div></div><h3>経路の編集</h3><label for="rope-id">編集するロープ</label><select id="rope-id"></select><div class="double"><label>A・開始<select id="route-a"></select></label><label>C・対角<select id="route-c"></select></label><label>B・隣<select id="route-b"></select></label><label>D・終端<select id="route-d"></select></label></div><div class="button-row"><button id="apply-rope" type="button">経路更新</button><button id="add-rope" type="button">経路追加</button><button id="delete-rope" type="button">削除</button></div><div class="button-row"><button id="rope-front" type="button">前面ロープだけ残す</button><button id="rope-remove" type="button">全ロープを外す</button></div><p class="hint">各面 A→C→B→D。経路・巻き取り雄材は保存ファイルにも記録します。復元は枠の作り直しかファイル読込で行えます。</p></section><section class="prop-page" id="page-frame" data-page="frame" data-for="model" role="tabpanel" aria-label="枠の構成" hidden><h2>枠の構成</h2><div class="triple"><label>幅の比<input id="width" type="number" min="0.4" max="4" step="0.1" value="1.4"></label><label>奥行の比<input id="depth" type="number" min="0.4" max="4" step="0.1" value="1"></label><label>高さの比<input id="height" type="number" min="0.4" max="4" step="0.1" value="1.2"></label></div><button id="extend-bay" type="button">奥に1区画つなぐ</button><button id="generate" type="button">比率から立体枠を作り直す</button><p class="hint">作り直すと形状・接合・ロープ・解析条件を初期化します。名称とメモは保持します。</p></section><section class="prop-page" id="page-design" data-page="design" data-for="model" role="tabpanel" aria-label="設計" hidden><h2>設計</h2><label for="name">設計名</label><input id="name" maxlength="200"><label for="notes">設計メモ</label><textarea id="notes" rows="3"></textarea><p class="hint">保存形式：.tsumiki.json v5<br>位置・部材・支持・ロープ・材料・解析条件を一緒に保存。</p></section><section class="prop-page" id="page-load" data-page="load" data-for="sim" role="tabpanel" aria-label="荷重"><h2>荷重</h2><label for="load-node">荷重点</label><select id="load-node"></select><label for="direction">作用方向</label><select id="direction"><option value="x">X方向</option><option value="y">Y方向</option><option value="z">Z方向</option></select><label for="force">静的・加振の外力振幅</label><input id="force" type="number" min="-2" max="2" step="0.02"><label for="torque">同軸の外力モーメント</label><input id="torque" type="number" min="-2" max="2" step="0.01"><label for="gravity">自重用の重力係数</label><input id="gravity" type="number" min="0" max="2" step="0.01"></section><section class="prop-page" id="page-shake" data-page="shake" data-for="sim" role="tabpanel" aria-label="揺れ・加振" hidden><h2>揺れ・加振</h2><label for="base-acceleration">床の加速度振幅</label><input id="base-acceleration" type="number" min="0" max="2" step="0.01"><label for="frequency">加振周波数</label><input id="frequency" type="number" min="0.05" max="5" step="0.05"><label for="duration">計算時間</label><input id="duration" type="number" min="1" max="12" step="1"><label for="excitation-stop">加振を止める時刻</label><input id="excitation-stop" type="number" min="0.1" max="12" step="0.1"><label for="damping">相対減衰パラメータ</label><input id="damping" type="number" min="0.001" max="0.3" step="0.01"></section><section class="prop-page" id="page-joint" data-page="joint" data-for="sim" role="tabpanel" aria-label="接合とロープの掛かり" hidden><h2>接合とロープの掛かり</h2><label for="joint-model">接合のモデル</label><select id="joint-model"><option value="clearance-contact">穴と角棒の遊び・接触</option><option value="rigid-approximation">剛接合（遊びなし・比較用）</option></select><label for="rope-wrap">ロープの掛け点（C・B）</label><select id="rope-wrap"><option value="locked">滑らない（巻き取り後に固着）</option><option value="sliding">滑る（摩擦なし・張力一様）</option></select><div class="double"><label>接触時の剛性<input id="joint-contact" type="number" min="0.001" max="10000000" step="any"></label><label>隙間内の抵抗<input id="joint-open" type="number" min="0.000001" max="10000000" step="any"></label></div><p id="joint-clearance" class="hint"></p><p class="hint">実物の掛け点の摩擦は「滑る」と「滑らない」の間にあります。両方で比べて結果の幅を確認してください。摩擦による接合の固着、遊びの実寸は未確定です。</p></section><section class="prop-page" id="page-material" data-page="material" data-for="sim" role="tabpanel" aria-label="ロープ・材料の仮パラメータ" hidden><h2>ロープ・材料の仮パラメータ</h2><label for="prestrain">巻き取り後の張力ひずみ（全ロープ）</label><input id="prestrain" type="number" min="0" max="0.02" step="0.001"><label for="rope-k">相対ロープ軸剛性</label><input id="rope-k" type="number" min="0.01" max="100000" step="10"><label for="slack">たるみの比率</label><input id="slack" type="number" min="0" max="0.2" step="0.005"><div id="material-inputs"></div><button id="apply-material" type="button">材料・ロープを更新</button></section><section class="prop-page" id="page-info" data-page="info" data-for="sim" role="tabpanel" aria-label="計算の前提" hidden><h2>計算の前提</h2><div class="assumptions"><h3>この計算が扱うもの</h3><p>3D弾性梁・6自由度 / 穴と角棒の隙間・接触（摩擦なし） / 引張専用ロープ（掛け点で滑る・滑らないの両極端） / 巻き取り後の張力 / 集中質量 / 静的釣り合い / 平衡点まわりの線形振動</p><h3>まだ扱わないもの</h3><p>丸材・ロープの一般干渉、移動途中・変形後の衝突、接合・掛け点の摩擦の中間値、揺れの途中での接触の開閉、床との浮き上がり、座屈、大変形、破壊。丸材は表示のみ。</p><p>補強が常に有利とは仮定しません。共振により揺れが増す場合も、そのまま表示します。</p></div><a class="format-link" href="/schemas/tsumiki-design-v5.schema.json" target="_blank" rel="noreferrer">専用形式のJSON Schema ↗</a></section></div></section></aside>
<section class="timeline sim-only" id="response" aria-label="タイムラインと結果"><div class="timeline-bar"><div class="play-row"><button id="play" type="button">▶ 再生</button><label class="timeline">時刻<input id="time" type="range" min="0" max="1" value="0" step="1"></label><output id="time-value">静的</output></div><div class="timeline-fields"><label>表示ケース<select id="display-mode"><option value="taut">張力あり</option><option value="slack">たるみあり</option><option value="none">ロープなし</option></select></label><label>応答の表示<select id="display-response"><option value="static">静的荷重</option><option value="force">人による外力加振</option><option value="base">床・地面の加振</option></select></label><label class="scale-label">変形の表示倍率 <output id="scale-value"></output><input id="scale" type="range" min="1" max="100" step="1" value="15"></label></div><button id="calculate" class="primary" type="button">3条件を再計算</button><button id="report" type="button">↓ 解析記録</button></div><div class="timeline-body"><div class="chart-area" tabindex="0" role="region" aria-label="時系列と診断"><svg id="history" viewBox="0 0 720 180" role="img" aria-label="選択した加振に対する荷重点の相対変位時系列"></svg><div id="diagnostics" class="diagnostics"></div></div><div class="results-area"><div class="result-tabs" role="tablist" aria-label="結果"><button type="button" class="result-tab" role="tab" data-result="compare" aria-selected="true">ロープ条件の比較</button><button type="button" class="result-tab" role="tab" data-result="joints" aria-selected="false">接合の遊び</button><button type="button" class="result-tab" role="tab" data-result="members" aria-selected="false">部材端内力</button></div><div class="result-page" data-result="compare" tabindex="0" role="region" aria-label="ロープ条件の比較の表"><div class="table-scroll"><table><thead><tr><th>ロープ条件</th><th>静的最大変位</th><th>外力加振の最大変位</th><th>床加振の最大変位</th></tr></thead><tbody id="comparison"></tbody></table></div><p class="hint">静的変位は初期張力による変位を差し引いた荷重応答。動的変位は自重・初期張力の平衡点からの相対変位です。値は全節点の並進変位ノルムの最大。（ ）はロープなしに対する増減。</p></div><div class="result-page" data-result="joints" tabindex="0" role="region" aria-label="接合の遊びの表" hidden><h3 class="internal-heading">静的荷重時の接合の遊び（選択ロープ条件）</h3><p class="hint">使用率は穴と角棒の隙間に対する相対移動。100%以上は壁に接触（着座）。巻き取り直後→荷重時の順に表示します。行をクリックで部材を選択。</p><div class="table-scroll"><table><thead><tr><th>接合（雌材@節点）</th><th>巻き取り直後</th><th>荷重時</th><th>最大接触力</th></tr></thead><tbody id="joint-results"></tbody></table></div></div><div class="result-page" data-result="members" tabindex="0" role="region" aria-label="部材端内力の表" hidden><h3 class="internal-heading">静的荷重時の部材端内力（選択ロープ条件）</h3><p class="hint">動的な内力・接合反力の時系列表示は未実装です。行をクリックで部材を選択。</p><div class="table-scroll"><table><thead><tr><th>部材</th><th>軸力（端部）</th><th>ねじり（端部）</th><th>曲げ合成（端部）</th></tr></thead><tbody id="member-results"></tbody></table></div></div></div></div></section>
</main>
<footer class="statusbar"><div id="status" role="status" class="status">設計を準備中</div><span id="tool-hint" class="tool-hint"></span><span id="counts" class="counts"></span><span id="draft-status" class="draft">編集中の設計は、このブラウザにも下書き保存します。</span><span id="analysis-units" class="assume" title="図面規格は1座標単位=1000mm。材料・荷重・時間は未校正です。">形状は図面寸法／力・時間は相対値</span><a href="/rope.html">2Dの旧試作</a></footer>`;

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
  input("auto-supports").checked = supportsAuto;
  input("fixed").disabled = supportsAuto && design.version === 6;
  input("fixed").title = input("fixed").disabled
    ? "支持は自動で決めています。手で決めるには上のチェックを外してください"
    : "";
  draw();
}
/**
 * What moving a board one seat would do, tried on a copy: the boards that swap with it, or why it cannot
 * (no seat there, or a board crossing in the same plane would end up in the same seat).
 */
function layerShiftPreview(m: Design["members"][number], delta: 1 | -1) {
  if (m.kind !== "female") return { ok: false, text: "雌材だけ段を変えられます" };
  const to = m.layer + delta;
  if (to < 0) return { ok: false, text: "これより内側の段はありません" };
  if (to > 3) return { ok: false, text: "これより外側（4段目）はロープ用です" };
  const draft = structuredClone(design);
  let moved: string[] = [];
  try {
    moved = shiftLayer(draft, m.id, delta);
    validateMemberCollisions(draft, new Set(moved));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const clash = /部材 (\S+) と (\S+) が干渉/.exec(message);
    return {
      ok: false,
      text: clash
        ? `${m.layer}段目と${to}段目を入れ替えると ${clash[1]} と ${clash[2]} が重なります（角棒を共有せずに交差する板は一緒に動かないため）`
        : message,
    };
  }
  const others = moved.filter((id) => id !== m.id);
  return {
    ok: true,
    text: `${m.layer}段目 ⇄ ${to}段目${others.length ? `（同じ角棒でつながる ${others.join("・")} も入れ替え）` : ""}`,
  };
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
  const lines: string[] = [];
  for (const [button, delta, name] of [
    ["layer-out", 1, "▲ 外側"],
    ["layer-in", -1, "▼ 内側"],
  ] as const) {
    const shift = layerShiftPreview(m, delta);
    el<HTMLButtonElement>(button).disabled = !shift.ok;
    el(button).title = shift.text;
    if (m.kind === "female") lines.push(`${name}：${shift.text}`);
  }
  el("layer-status").textContent = lines.join("\n");
  const part = memberPart(m);
  el("member-dimensions").textContent = part
    ? `${part.label} / 全長 ${part.totalMm} × 幅105 × 厚30 mm / ${part.kind === "male" ? "凸部165mm×両端・30mm角" : `丸穴φ39mm・${part.holes.length}穴`} / PDF ${part.page}ページ`
    : "旧仮定モデル（実寸未対応）";
  selectedMember = m.id;
  if (focus) selected = m.end;
  if (focus) {
    selectionType = "member";
    if (!femaleMode() && !moving()) showProps("member");
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
function syncDrawingTools() {
  const drawing = design.version === 6;
  if (!select("drawing-start").options.length) {
    select("drawing-start").replaceChildren(
      ...HITOTO_PARTS.map((p) => new Option(`${p.label} · ${p.totalMm}mm`, p.id)),
    );
    select("drawing-start").value = "female-2400-square";
    for (const kind of ["male", "female"] as const) {
      select(`${kind}-catalog`).replaceChildren(
        ...HITOTO_PARTS.filter((p) => p.kind === kind).map(
          (p) => new Option(`${p.label} · ${p.totalMm}mm`, p.id),
        ),
      );
      select(`${kind}-catalog`).value = kind === "male" ? "male-1200" : "female-1200-square";
    }
  }
  el("drawing-info").textContent = drawing
    ? "図面規格：板幅105mm・厚30mm・丸穴φ39mm。座標1=1000mm。規格の長さ・穴数を保持します。"
    : "旧仮定モデル：寸法・角穴は旧データのまま保持しています。図面規格は「＋ 新規」から開始できます。";
  el("drawing-settings").hidden = !drawing;
  el("tenon-dimensions").textContent = drawing
    ? "凸部165mm・板厚30mm（組立4段・残り45mm）"
    : "凸部：板厚×5（部材4＋ロープ1）";
  input("tenon-radius").value = String((design.geometry.tenonCornerRadius ?? 0) * 1000);
  for (const kind of ["male", "female"] as const) {
    select(`${kind}-catalog`).hidden = !drawing;
    el(`${kind}-catalog-label`).hidden = !drawing;
    const field = input(kind === "male" ? "male-length" : "quick-length");
    field.readOnly = drawing;
    const label =
      kind === "male" ? field.closest("label") : document.querySelector('label[for="quick-length"]');
    if (label?.firstChild?.nodeType === Node.TEXT_NODE)
      label.firstChild.textContent = drawing
        ? kind === "male"
          ? "本体長（1000mm単位）"
          : "両端の穴中心間距離（1000mm単位）"
        : kind === "male"
          ? "雄材の長さ比"
          : "長さ比（先に節点があれば自動で合わせます）";
    field.min = drawing ? "0.001" : "0.2";
    if (drawing) field.value = String(catalogPart(select(`${kind}-catalog`).value).span);
  }
  input("member-holes").readOnly = drawing;
  el<HTMLButtonElement>("generate").disabled = drawing;
  el<HTMLButtonElement>("extend-bay").disabled = drawing;
  el("generate").title = drawing
    ? "図面規格は部材を選んで組み立てます。任意比率の枠は旧仮定モデル専用です"
    : "";
  input("template-size").readOnly = drawing;
  if (drawing) input("template-size").value = String(catalogPart(select("female-catalog").value).span);
  select("kind").disabled = drawing;
  const contact = select("joint-model").querySelector<HTMLOptionElement>('option[value="clearance-contact"]');
  if (contact) contact.disabled = drawing;
  const schema = document.querySelector<HTMLAnchorElement>(".format-link");
  if (schema) schema.href = `/schemas/tsumiki-design-v${design.version}.schema.json`;
}
function sync() {
  syncDrawingTools();
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
      : design.version === 6
        ? "丸穴・角丸凸部の接触則は未校正のため、剛接合での参考比較です。材料・断面剛性・荷重・時間は従来の仮定値です。"
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
  renderOutliner();
  el("counts").textContent =
    `${design.nodes.length}節点 / ${design.members.length}部材 / ${design.ropes.length}ロープ / ${design.rings.length}丸材 / ${design.connections.length}穴接続`;
}
/** Whether supports follow the floor contact automatically (drawing designs); off once set by hand. */
let supportsAuto = true;
/** Applies automatic supports to a design about to be shown, when they are on. */
function prepare(d: Design) {
  connectThreadedMales(d);
  if (supportsAuto) autoSupports(d);
  return d;
}
// The starting design gets its supports too, so the first analysis can run without setup.
design = parseDesign(serializeDesign(prepare(design)));
/** Mirror modelling: every edit is repeated on the other side of the centre male while this is on. */
let mirrorMode = false;
function update(action: (draft: Design) => void) {
  const draft = structuredClone(design);
  action(draft);
  if (mirrorMode) {
    const centre = mirrorCentre();
    if (draft.members.some((m) => m.id === centre)) {
      const plane = mirrorPlane(draft, centre);
      let mirrored: ReturnType<typeof mirrorEdit>;
      try {
        mirrored = mirrorEdit(design, draft, plane);
      } catch (e) {
        throw new Error(`ミラー側に反映できません：${e instanceof Error ? e.message : String(e)}`);
      }
      if (mirrored.onPlane.length)
        actionNote = `${actionNote ? `${actionNote}。` : ""}部材 ${mirrored.onPlane.join("・")} は雄材 ${centre} の中央の面の上にあるので反対側には作りません`;
    } else {
      // The centre male itself went away; there is nothing left to mirror about.
      mirrorMode = false;
      actionNote = `${actionNote ? `${actionNote}。` : ""}中心の雄材がなくなったためミラーモードを解除しました`;
    }
  }
  prepare(draft);
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
  const engineering = engineeringPanel?.current(design);
  viewport?.setEngineering(tab === "sim" ? (engineering ?? null) : null);
  const physicalActive = !!engineering && tab === "sim";
  el("viewer-title").textContent =
    tab === "model" ? "設計" : physicalActive ? "実寸・静的解析（N / mm / MPa）" : "解析結果";
  const timelineBody = el("response").querySelector<HTMLElement>(".timeline-body");
  if (timelineBody) timelineBody.style.display = physicalActive ? "none" : "";
  for (const id of ["play", "report", "calculate"]) (el(id) as HTMLButtonElement).disabled = physicalActive;
  select("display-response").disabled = physicalActive;
  select("display-mode").disabled = physicalActive;
  el("deformation-legend").textContent = physicalActive
    ? "白線：計算した変形曲線／色：公称応力の相対値"
    : "薄線：変形前";
  el("analysis-units").textContent = physicalActive
    ? "実寸参考解析：N・mm・MPa／剛接合を仮定"
    : "形状は図面寸法／力・時間は相対値";
  el("analysis-units").title = physicalActive
    ? "木材プリセット・無欠損断面による線形静的解析。安全判定ではありません。"
    : "図面規格は1座標単位=1000mm。比較解析の材料・荷重・時間は未校正です。";
  if (physicalActive) stop();
  const mode = select("display-mode").value as RopeMode;
  const response = select("display-response").value;
  const result = results.get(mode);
  let u: number[] | null = null;
  if (result && !stale && tab === "sim" && !engineering) {
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
  viewport?.setHoleMarks(tab === "model" ? alignList : []);
  viewport?.setHoleSelection(
    (choosingHole || aligning) && tab === "model",
    tab === "model" && select("hole-female").value && select("hole-number").value !== ""
      ? { female: select("hole-female").value, hole: Number(select("hole-number").value) }
      : null,
    tab === "model" ? malePreview : null,
  );
  viewport?.setFrameSelection(choosingFrame, chosenFrame);
  viewport?.setTools(tab === "model", moveSpec());
  refreshFemalePreview();
  refreshTemplatePreview();
  viewport?.setGhosts(femalePreview ? [femalePreview.member] : (templatePreview?.created ?? []));
  viewport?.setMarked(templateMode() ? templateMales : []);
  syncResizeHint();
  viewport?.setAnchorChoices(
    femaleMode() ? design.members.filter((m) => m.kind === "male").flatMap((m) => [m.start, m.end]) : [],
  );
  viewport?.show(
    femalePreview?.design ?? templatePreview?.design ?? design,
    u,
    design.view.deformationScale,
    selectedTag,
    mode,
    input("nodes-visible").checked,
  );
  el("selection-summary").textContent =
    selectionType === "node"
      ? `節点 ${selected}`
      : selectionType === "member"
        ? `部材 ${selectedMember}`
        : `丸材 ${selectedRing}`;
  syncHistory();
  markOutliner();
  updateToolbar();
  syncMoveTool();
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
  let svg = '<line x1="45" y1="85" x2="700" y2="85" stroke="#5a5a5a"/>';
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
    el("status").classList.remove("warn");
    actionNote = "";
    draw();
  } catch (e) {
    stale = false;
    el("response").classList.remove("stale");
    results.clear();
    el("comparison").replaceChildren();
    el("member-results").replaceChildren();
    el("joint-results").replaceChildren();
    el("history").replaceChildren();
    // An unfinished structure is a normal state while modelling, so report it softly instead of as an alert.
    const reason = e instanceof Error ? e.message : String(e);
    el("diagnostics").textContent = `まだ解析できません：${reason}`;
    el("status").textContent = `${actionNote ? `${actionNote} · ` : ""}まだ解析できません：${reason}`;
    el("status").classList.add("warn");
    actionNote = "";
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
    const restored = parseDesign(serializeDesign(prepare(parseDesign(text))));
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
input("auto-supports").addEventListener("change", () => {
  supportsAuto = input("auto-supports").checked;
  // Turning it on applies the floor contact now; turning it off keeps the current supports to edit by hand.
  actionNote = supportsAuto ? "支持を床に接する部材から自動で決めました" : "支持を手で決めるようにしました";
  guard(() => update(() => undefined));
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
          removeMember(d, d.members[index].id);
          return;
        }
        const kind = select("kind").value as "male" | "female";
        if (action === "add" && kind === "male")
          throw new Error("雄材は穴を選ぶ操作から追加してください。方向・座標は自動で決まります");
        const layer = Number(input("member-layer").value);
        const member = {
          id: action === "add" ? id("m") : select("member").value,
          kind: select("kind").value as "male" | "female",
          start: select("start").value,
          end: select("end").value,
          material: action === "update" && index >= 0 ? d.members[index].material : d.materials[0].id,
          roll: Number(input("member-roll").value),
          layer,
          holeCount: Number(input("member-holes").value),
          ...(d.version === 6
            ? { catalogId: action === "update" ? d.members[index].catalogId : select("female-catalog").value }
            : {}),
        };
        if (action === "add" && kind === "female") placeBoard(d, member);
        else if (action === "add") d.members.push(member);
        else if (index >= 0) d.members[index] = member;
      }),
    ),
  );
for (const [button, delta] of [
  ["layer-out", 1],
  ["layer-in", -1],
] as const)
  el(button).addEventListener("click", () =>
    guard(() => {
      const member = select("member").value;
      let swapped: string[] = [];
      update((d) => {
        swapped = shiftLayer(d, member, delta);
      });
      actionNote = `雌材 ${member} を${delta > 0 ? "外側" : "内側"}の段へ（${swapped.length}枚の段を入れ替え）`;
      el("status").textContent = `${actionNote}。再計算しています…`;
      selectionType = "member";
      viewport?.pulse(swapped);
      draw();
    }),
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
    const restored = parseDesign(serializeDesign(prepare(parseDesign(saved))));
    history.push(design, restored);
    design = restored;
    markDirty();
    sync();
    viewport?.fit();
    calculate();
  }),
);
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
const defaultHints = {
  model:
    "クリックで選択 · ドラッグで回転 · G 移動 · I 穴に差し込む · Shift+A 雌材 · T テンプレート · R ロープ · X 削除 · Home 全体 · テンキー1/3/7 視点 · 2 シミュレーション",
  sim: "Space 再生・停止 · クリックで部材を選択 · Home 全体 · テンキー1/3/7 視点 · 1 モデリング",
} as const;
const lastPage: Record<"model" | "sim", string> = { model: "add", sim: "load" };
/** Show a properties page. Pages that belong to the other screen are ignored. */
function showProps(page: string) {
  const target = document.getElementById(`page-${page}`);
  if (!target || target.dataset.for !== tab) return;
  lastPage[tab] = page;
  for (const section of document.querySelectorAll<HTMLElement>(".prop-page"))
    section.hidden = section.dataset.page !== page;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".prop-tab")) {
    const active = button.dataset.page === page;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".prop-tab"))
  button.addEventListener("click", () => showProps(button.dataset.page ?? ""));
el("properties")
  .querySelector(".prop-tabs")
  ?.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "ArrowDown" && key !== "ArrowUp") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>(`.prop-tab[data-for="${tab}"]`)];
    const index = tabs.findIndex((t) => t.dataset.page === lastPage[tab]);
    const next = tabs[(index + (key === "ArrowDown" ? 1 : tabs.length - 1)) % tabs.length];
    showProps(next.dataset.page ?? "");
    next.focus();
  });
for (const button of document.querySelectorAll<HTMLButtonElement>(".result-tab"))
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>(".result-tab"))
      other.setAttribute("aria-selected", String(other === button));
    for (const section of document.querySelectorAll<HTMLElement>(".result-page"))
      section.hidden = section.dataset.result !== button.dataset.result;
  });
function cancelTools(message = "") {
  choosingHole = false;
  aligning = false;
  alignList = [];
  choosingFrame = false;
  connectStart = null;
  el("pick-hole").setAttribute("aria-pressed", "false");
  el("connect-nodes").setAttribute("aria-pressed", "false");
  el("move-tool").setAttribute("aria-pressed", "false");
  el("tool-hint").textContent = message || defaultHints[tab];
  draw();
}
/** The tool the keyboard and the shortcut list currently act for. */
type ToolState =
  | "sim"
  | "move"
  | "rope"
  | "connect"
  | "template"
  | "female"
  | "hole"
  | "align"
  | "board"
  | "select";
function toolState(): ToolState {
  if (tab === "sim") return "sim";
  if (moving()) return "move";
  if (!el("rope-workflow").hidden && lastPage.model === "rope") return "rope";
  if (connectStart) return "connect";
  if (lastPage.model === "add" && palette === "template") return "template";
  if (lastPage.model === "add" && palette === "female") return "female";
  if (choosingHole) return "hole";
  if (aligning) return "align";
  if (selectionType === "member" && design.members.find((m) => m.id === selectedMember)?.kind === "female")
    return "board";
  return "select";
}
/** Button Enter presses in each tool. */
const confirmButton: Partial<Record<ToolState, string>> = {
  hole: "insert-male",
  female: "quick-add",
  template: "template-add",
  rope: "confirm-rope",
  align: "align-apply",
};
const shortcutSets: Record<ToolState, [string, string][]> = {
  sim: [
    ["Space", "再生・停止"],
    ["Home", "全体"],
    ["テンキー1/3/7", "視点"],
    ["Ctrl+Z", "元に戻す"],
    ["1", "モデリング"],
  ],
  move: [
    ["G", "移動"],
    ["R", "回転"],
    ["A", "構造全体 ⇄ 選択中"],
    ["C", "接続を保つ ⇄ 自由"],
    ["M", "ミラーモード ON / OFF"],
    ["X / Del", "削除"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "移動をやめる"],
  ],
  hole: [
    ["クリック", "穴を選ぶ"],
    ["F", "差し込み側を反転"],
    ["Enter", "雄材を差し込む"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "やめる"],
  ],
  female: [
    ["クリック", "起点の節点"],
    ["C", "2つの節点をつなぐ（筋交い）"],
    ["Q / E", "傾き −15° / +15°"],
    ["[ / ]", "雌材 1規格 短く / 長く"],
    ["K", "雌材の端 角 ⇄ 丸"],
    ["Enter", "雌材を追加"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "やめる"],
  ],
  connect: [
    ["クリック", "つなぐ先の節点"],
    ["Esc", "つなぐのをやめる"],
  ],
  template: [
    ["クリック", "起点の雄材（2本目で結ぶ）"],
    ["S", "四角形 ⇄ 三角形"],
    ["F", "三角形の頂点の側を反転"],
    ["[ / ]", "雌材 1規格 短く / 長く"],
    ["K", "雌材の端 角 ⇄ 丸"],
    ["Enter", "テンプレートを追加"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "やめる"],
  ],
  rope: [
    ["クリック", "ロープを張る枠"],
    ["Enter", "ロープを張る"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "閉じる"],
  ],
  align: [
    ["クリック", "穴を選ぶ（1つ目が基準）"],
    ["Enter", "穴を重ねる"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "やめる"],
  ],
  board: [
    ["クリック", "選択"],
    ["[ / ]", "1規格 短く / 長く（橙の矢印の端）"],
    ["Shift+[ / ]", "反対の端を伸縮"],
    ["M", "ミラーモード ON / OFF"],
    ["K", "端の形 角 ⇄ 丸"],
    ["G", "移動・回転"],
    ["X / Del", "削除"],
    ["Ctrl+Z", "元に戻す"],
    ["Esc", "解除"],
  ],
  select: [
    ["クリック", "選択"],
    ["G", "移動・回転"],
    ["I", "穴に差し込む"],
    ["Shift+A", "雌材"],
    ["T", "テンプレート"],
    ["R", "ロープ"],
    ["M / Shift+M", "ミラーモード / 中心の雄材にする"],
    ["O", "穴を重ねる"],
    ["X / Del", "削除"],
    ["Ctrl+Z", "元に戻す"],
    ["Home", "全体"],
    ["Esc", "解除"],
  ],
};
/** Main shortcuts for the current screen and tool, always shown at the bottom left of the view. */
function renderShortcuts() {
  const state = toolState();
  const box = el("shortcuts");
  if (box.dataset.state === state) return;
  box.dataset.state = state;
  box.replaceChildren(
    ...shortcutSets[state].map(([key, label]) => {
      const row = document.createElement("span");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      row.append(kbd, label);
      return row;
    }),
  );
}
/** Whether focus last moved with Tab rather than a pointer, so Enter should stay with the focused button. */
let focusFromKeyboard = false;
document.addEventListener("pointerdown", () => {
  focusFromKeyboard = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") focusFromKeyboard = true;
});
/** Resizing moves the other end of the selected board when set (kept until another board is selected). */
let resizeFlip = { member: "", flip: false };
const flipFor = (member: string) => resizeFlip.member === member && resizeFlip.flip;
/** The ends of the selected board that resizing moves and keeps, for the panel and the 3D view. */
function resizeTarget() {
  const board = design.members.find((m) => m.id === selectedMember);
  if (selectionType !== "member" || board?.kind !== "female" || design.version !== 6) return null;
  return resizeEnds(design, board.id, flipFor(board.id));
}
function syncResizeHint() {
  const ends = resizeTarget();
  el("board-resize-ends").hidden = !ends;
  el("board-flip-end").hidden = !ends;
  viewport?.setResizeHint(tab === "model" && ends ? { moving: ends.node, fixed: ends.fixed } : null);
  if (!ends) return;
  const at = (id: string) => design.nodes.find((n) => n.id === id)?.position ?? [0, 0, 0];
  const side = axisName(at(ends.node).map((v, i) => v - at(ends.fixed)[i]));
  el("board-resize-ends").textContent =
    `[ / ] で ${side}側の端 ${ends.node} が伸び縮みします（橙の矢印）。${ends.fixed} は固定（青）。`;
}
el("board-flip-end").addEventListener("click", () => {
  resizeFlip = { member: selectedMember, flip: !flipFor(selectedMember) };
  draw();
});
/** Shortens (−1) or extends (+1) the selected female by one drawing size; `flip` moves the other end once. */
function resizeSelectedBoard(step: 1 | -1, flip = false) {
  guard(() => {
    let label = "";
    const other = flipFor(selectedMember) !== flip;
    update((d) => {
      label = resizeBoard(d, selectedMember, step, other).label;
    });
    actionNote = `雌材 ${selectedMember} を ${label} にしました`;
    sync();
    draw();
    viewport?.pulse([selectedMember]);
  });
}
/**
 * Steps the size of new boards: the next drawing size of the same end shape, or 0.1 of the size ratio in
 * legacy designs. Used by the template and female tools.
 */
function stepNewBoardSize(step: 1 | -1) {
  guard(() => {
    if (palette === "template" && templateMales.length >= 2)
      throw new Error("2本の雄材を結ぶときは、雄材どうしの間隔で雌材の長さが決まります");
    if (design.version !== 6) {
      const field = input(palette === "template" ? "template-size" : "quick-length");
      const next = Math.round((Number(field.value) + step * 0.1) * 10) / 10;
      if (next < 0.2 || next > 4) throw new Error("大きさの比は0.2〜4です");
      field.value = String(next);
      draw();
      return;
    }
    const catalog = select("female-catalog");
    const part = nextFemaleSize(catalog.value, step);
    catalog.value = part.id;
    catalog.dispatchEvent(new Event("change"));
    el("tool-hint").textContent = `雌材を${part.label}にしました`;
  });
}
el("template-shorter").addEventListener("click", () => stepNewBoardSize(-1));
el("template-longer").addEventListener("click", () => stepNewBoardSize(1));
/** Switches the selected female between its square and round end. */
function toggleSelectedBoardEnd() {
  guard(() => {
    let label = "";
    update((d) => {
      label = toggleBoardEnd(d, selectedMember).label;
    });
    actionNote = `雌材 ${selectedMember} を ${label} にしました`;
    sync();
    draw();
    viewport?.pulse([selectedMember]);
  });
}
el("board-end").addEventListener("click", toggleSelectedBoardEnd);
el("board-shorter").addEventListener("click", () => resizeSelectedBoard(-1));
el("board-longer").addEventListener("click", () => resizeSelectedBoard(1));
/** Keys that only mean something inside the current tool. Returns true when the key was handled. */
function toolKey(event: KeyboardEvent): boolean {
  const state = toolState();
  const key = event.key.toLowerCase();
  const confirm = confirmButton[state];
  // Enter on a button reached with Tab keeps activating that button; after a click it confirms the tool.
  const focusedButton = event.target instanceof HTMLButtonElement && focusFromKeyboard;
  if (event.key === "Enter" && confirm && !focusedButton) {
    event.preventDefault();
    const button = el<HTMLButtonElement>(confirm);
    if (button.disabled) el("tool-hint").textContent = "まだ追加できません。パネルの説明を確認してください";
    else button.click();
    return true;
  }
  if (state === "board" && "[]{}".includes(event.key) && event.key.length === 1) {
    event.preventDefault();
    resizeSelectedBoard("]}".includes(event.key) ? 1 : -1, event.shiftKey);
    return true;
  }
  if (event.shiftKey) return false;
  if (state === "board" && key === "k") {
    toggleSelectedBoardEnd();
    return true;
  }
  if ((state === "template" || state === "female") && (event.key === "[" || event.key === "]")) {
    event.preventDefault();
    stepNewBoardSize(event.key === "]" ? 1 : -1);
    return true;
  }
  if (state === "female" && (key === "q" || key === "e")) {
    const tilt = input("female-tilt");
    const next = Number(tilt.value) + (key === "e" ? 15 : -15);
    tilt.value = String(((((next + 180) % 360) + 360) % 360) - 180);
    draw();
    return true;
  }
  if (state === "hole" && key === "f") {
    const side = select("male-side");
    side.value = side.value === "1" ? "-1" : "1";
    side.dispatchEvent(new Event("change"));
    return true;
  }
  if (state === "female" && key === "c") {
    el("connect-nodes").click();
    draw();
    return true;
  }
  if ((state === "female" || state === "template") && key === "k") {
    toggleFemaleEnd();
    return true;
  }
  if (state === "template" && key === "s") {
    document.querySelector<HTMLButtonElement>('.shape-button[aria-pressed="false"]')?.click();
    return true;
  }
  if (state === "template" && key === "f" && templateShape === "triangle") {
    document.querySelector<HTMLButtonElement>('.side-button[aria-pressed="false"]')?.click();
    return true;
  }
  return false;
}
function updateToolbar() {
  const moving = el("move-tool").getAttribute("aria-pressed") === "true";
  renderShortcuts();
  const roping = !el("rope-workflow").hidden && lastPage.model === "rope";
  el("tool-hole").setAttribute("aria-pressed", String(choosingHole));
  el("tool-female").setAttribute("aria-pressed", String(palette === "female" && lastPage.model === "add"));
  el("tool-template").setAttribute(
    "aria-pressed",
    String(palette === "template" && lastPage.model === "add"),
  );
  el("rope-tool").setAttribute("aria-pressed", String(roping));
  el("tool-select").setAttribute(
    "aria-pressed",
    String(!moving && !choosingHole && !roping && !(palette !== "male" && lastPage.model === "add")),
  );
}
function outlinerItem(kind: string, id: string, label: string) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "outliner-item";
  item.dataset.kind = kind;
  item.dataset.id = id;
  item.textContent = label;
  return item;
}
function renderOutliner() {
  const groups: [string, HTMLButtonElement[]][] = [
    [
      "雄材",
      design.members
        .filter((m) => m.kind === "male")
        .map((m) => outlinerItem("member", m.id, `${m.id}  ${m.start}→${m.end}`)),
    ],
    [
      "雌材",
      design.members
        .filter((m) => m.kind === "female")
        .map((m) => outlinerItem("member", m.id, `${m.id}  ${m.holeCount}穴 · ${m.layer}段`)),
    ],
    ["ロープ", design.ropes.map((r) => outlinerItem("rope", r.id, `${r.id}  巻き取り ${r.windingMember}`))],
    ["丸材", design.rings.map((r) => outlinerItem("ring", r.id, `${r.id}  ${r.member} · ${r.slot}段`))],
    ["節点", design.nodes.map((n) => outlinerItem("node", n.id, `${n.id}${n.fixed ? "  固定" : ""}`))],
  ];
  el("outliner").replaceChildren(
    ...groups
      .filter(([, items]) => items.length)
      .map(([title, items]) => {
        const group = document.createElement("details");
        group.open = title !== "節点";
        const summary = document.createElement("summary");
        summary.textContent = `${title}（${items.length}）`;
        group.append(summary, ...items);
        return group;
      }),
  );
  markOutliner();
}
function markOutliner() {
  const current =
    selectionType === "member"
      ? `member:${selectedMember}`
      : selectionType === "ring"
        ? `ring:${selectedRing}`
        : `node:${selected}`;
  for (const item of el("outliner").querySelectorAll<HTMLElement>(".outliner-item"))
    item.classList.toggle("is-selected", `${item.dataset.kind}:${item.dataset.id}` === current);
}
el("outliner").addEventListener("click", (event) => {
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".outliner-item") : null;
  const id = item?.dataset.id;
  if (!item || !id) return;
  if (item.dataset.kind === "member" && templateMode()) {
    pickTemplateMale(id);
  } else if (item.dataset.kind === "member") {
    select("member").value = id;
    syncMember(true);
  } else if (item.dataset.kind === "node") {
    selected = id;
    selectionType = "node";
    syncNode();
    showProps("node");
  } else if (item.dataset.kind === "ring") {
    viewport?.onRingSelect(id);
  } else if (item.dataset.kind === "rope") {
    select("rope-id").value = id;
    syncRope();
    showProps("rope");
  }
  markOutliner();
});
el("outliner").addEventListener("mouseover", (event) => {
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".outliner-item") : null;
  viewport?.setHover(item?.dataset.kind === "member" ? (item.dataset.id ?? "") : "");
});
el("outliner").addEventListener("mouseleave", () => viewport?.setHover(""));
el("tool-select").addEventListener("click", () => {
  el("rope-workflow").hidden = true;
  cancelTools();
});
el("tool-hole").addEventListener("click", () => {
  setTab("model");
  showProps("add");
  el("pick-hole").click();
});
el("tool-template").addEventListener("click", () => {
  setTab("model");
  showProps("add");
  el("palette-template").click();
});
el("tool-female").addEventListener("click", () => {
  setTab("model");
  showProps("add");
  el("palette-female").click();
});
el("delete-selection").addEventListener("click", () => deleteSelection());
function deleteSelection() {
  if (tab !== "model") return;
  if (selectionType === "member") el("delete-member").click();
  else if (selectionType === "ring") el("ring-delete").click();
  else el("delete-node").click();
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
    el("move-tool").setAttribute("aria-pressed", "false");
    // Show results immediately instead of waiting for the debounce.
    if (pendingCalculation) calculate();
  }
  showProps(lastPage[next]);
  el("viewer-title").textContent = next === "model" ? "設計" : "解析結果";
  el("tool-hint").textContent = defaultHints[next];
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
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    if (history.canRedo) restoreHistory("redo");
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // Numpad keys move the camera like Blender; the digit row switches screens.
  const views: Record<string, () => void> = {
    Numpad1: () => viewport?.viewFront(),
    Numpad3: () => viewport?.viewSide(),
    Numpad7: () => viewport?.viewTop(),
    Home: () => viewport?.fit(),
    NumpadDecimal: () => viewport?.focusMember(selectedMember),
  };
  const view = views[event.code];
  if (view) {
    event.preventDefault();
    view();
    return;
  }
  if (event.code === "Digit1") setTab("model");
  else if (event.code === "Digit2") setTab("sim");
  else if (event.key === " " && tab === "sim" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    el("play").click();
  } else if (tab === "model" && toolKey(event)) {
    // Handled by the active tool.
  } else if (tab === "model") {
    const key = event.key.toLowerCase();
    if ((key === "g" || key === "r") && moving()) {
      moveMode = key === "g" ? "translate" : "rotate";
      showProps("transform");
      draw();
    } else if (key === "m" && event.shiftKey) {
      const male = design.members.find((m) => m.id === selectedMember && m.kind === "male");
      if (selectionType !== "member" || !male)
        el("tool-hint").textContent = "中心にする雄材を選んでから Shift+M を押してください";
      else {
        mirrorCenter = male.id;
        el("tool-hint").textContent = `雄材 ${male.id} をミラーの中心にしました`;
        draw();
      }
    } else if (key === "o") {
      setAligning(!aligning);
    } else if (key === "m") {
      setMirrorMode(!mirrorMode);
    } else if (key === "c" && !event.shiftKey && moving()) {
      el("move-constraint").click();
    } else if (key === "a" && !event.shiftKey && moving()) {
      moveScope = moveScope === "all" ? "selection" : "all";
      draw();
    } else if (key === "g") el("move-tool").click();
    else if (key === "i") el("tool-hole").click();
    else if (key === "a" && event.shiftKey) el("tool-female").click();
    else if (key === "r") el("rope-tool").click();
    else if (key === "t") el("tool-template").click();
    else if (key === "x" || event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    }
  }
  if (event.key === "Escape") {
    // Esc steps back once: from connecting nodes to the female tool, from any tool to selection.
    if (connectStart) {
      el("connect-nodes").click();
      draw();
      return;
    }
    el("rope-workflow").hidden = true;
    if (palette !== "male") el("palette-male").click();
    cancelTools("選択操作を解除しました");
  }
});
let palette: "male" | "female" | "template" = "male";
function paletteKind(): "male" | "female" {
  return palette === "female" ? "female" : "male";
}
function nextMemberId(d: Design) {
  let n = 0;
  while ([...d.members, ...d.nodes, ...d.rings, ...d.ropes, ...d.materials].some((m) => m.id === `m${n}`))
    n++;
  return `m${n}`;
}
for (const kind of ["male", "female", "template"] as const)
  el(`palette-${kind}`).addEventListener("click", () => {
    palette = kind;
    for (const k of ["male", "female", "template"])
      el(`palette-${k}`).setAttribute("aria-pressed", String(k === kind));
    el("male-add-tools").hidden = kind !== "male";
    el("female-add-tools").hidden = kind !== "female";
    el("template-tools").hidden = kind !== "template";
    if (kind === "template") {
      choosingHole = false;
      malePreview = null;
      const picked = design.members.find((m) => m.id === selectedMember && m.kind === "male");
      templateMales = selectionType === "member" && picked ? [picked.id] : [];
      el("tool-hint").textContent =
        "起点の雄材をクリックしてください。平行な2本目もクリックすると、その2本を結びます";
    }
    connectStart = null;
    el("connect-nodes").setAttribute("aria-pressed", "false");
    if (kind === "female") {
      choosingHole = false;
      malePreview = null;
      selectionType = "node";
      el("tool-hint").textContent = "緑の節点（雄材の角棒）をクリックして起点を選び、向きを選んでください";
    } else refreshMalePreview();
    draw();
  });
let femaleDirection: AxisDirection = "y";
let femaleChoice = "";
let femalePreview: { design: Design; member: string } | null = null;
const femaleMode = () => tab === "model" && palette === "female" && lastPage.model === "add";
/** Direction of the new board: the picked axis turned by the tilt about the shaft of the male at the anchor. */
function femaleVector(d: Design, anchor: string): Vec3 {
  const base: Vec3 = [...AXIS_DIRECTIONS[femaleDirection]];
  const tilt = Number(input("female-tilt").value);
  if (!Number.isFinite(tilt)) throw new Error("傾きは数値で入力してください");
  if (Math.abs(tilt) < 1e-9) return base;
  const host = d.members.find((m) => m.kind === "male" && (m.start === anchor || m.end === anchor));
  const a = d.nodes.find((n) => n.id === host?.start)?.position;
  const b = d.nodes.find((n) => n.id === host?.end)?.position;
  if (!a || !b) throw new Error("傾けるには雄材の角棒の節点を起点に選んでください");
  return rotate3(base, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tilt);
}
/** Brace candidates are costly (a collision check each), so they are kept until the design or inputs change. */
let braceCache: { design: Design; key: string; targets: ReturnType<typeof braceTargets> } | null = null;
function renderBraceTargets(anchor: string | undefined) {
  const box = el("brace-targets");
  const preferred = design.version === 6 ? select("female-catalog").value : undefined;
  const key = `${anchor}:${preferred}`;
  if (!anchor) {
    braceCache = null;
    box.replaceChildren(
      Object.assign(document.createElement("p"), {
        className: "hint",
        textContent: "起点の節点を選ぶと表示します。",
      }),
    );
    return;
  }
  if (braceCache?.design === design && braceCache.key === key) return;
  const targets = braceTargets(design, anchor, preferred);
  braceCache = { design, key, targets };
  if (!targets.length) {
    box.replaceChildren(
      Object.assign(document.createElement("p"), {
        className: "hint",
        textContent: "規格の長さでちょうど届く節点がありません。傾きを付けて先端を新しい節点にできます。",
      }),
    );
    return;
  }
  box.replaceChildren(
    ...targets.map((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "brace-target";
      b.dataset.node = t.node;
      b.textContent = `${t.diagonal ? "╱ 筋交い" : "─"} → ${t.node}${t.label ? `（${t.label}）` : `（長さ ${t.length}）`}`;
      b.addEventListener("click", () => addBoardBetween(anchor, t.node));
      return b;
    }),
  );
}
/** Adds a board straight between two nodes (a brace when they are diagonal) and selects it. */
function addBoardBetween(start: string, end: string) {
  guard(() => {
    let member = "";
    update((d) => {
      member = connectBoard(d, start, end, d.version === 6 ? select("female-catalog").value : undefined);
    });
    selectedMember = member;
    actionNote = `雌材 ${member} を ${start}–${end} に張りました`;
    sync();
    draw();
    viewport?.pulse([member]);
  });
}
/** Recompute the translucent female preview from the anchor node, direction and length. */
function refreshFemalePreview() {
  femalePreview = null;
  const button = el<HTMLButtonElement>("quick-add");
  button.disabled = true;
  if (!femaleMode()) return;
  const anchor = design.nodes.find((n) => n.id === selected);
  const host = design.members.find((m) => m.kind === "male" && (m.start === selected || m.end === selected));
  el("female-anchor").textContent = anchor
    ? `起点：${anchor.id}${host ? `（雄材 ${host.id} の${host.start === anchor.id ? "始点" : "終点"}側の角棒）` : "（雄材の角棒ではありません）"}`
    : "起点：未選択";
  renderBraceTargets(anchor?.id);
  const options = anchor ? femaleDirections(design, anchor.id) : [];
  const current = options.find((o) => o.direction === femaleDirection);
  if (current?.blocked) {
    const fallback = options.find((o) => !o.blocked && o.target) ?? options.find((o) => !o.blocked);
    if (fallback) femaleDirection = fallback.direction;
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(".dir-button")) {
    const option = options.find((o) => o.direction === b.dataset.dir);
    b.disabled = !option || !!option.blocked;
    b.title =
      option?.blocked ??
      (option?.target ? `${option.target.node} までつなぐ（長さ ${option.target.length}）` : "");
    b.setAttribute("aria-pressed", String(b.dataset.dir === femaleDirection && !b.disabled));
    const note = b.querySelector("small");
    if (note) note.textContent = option?.target ? `→ ${option.target.node}` : "";
  }
  const chosen = options.find((o) => o.direction === femaleDirection);
  // Snap the length once per anchor/direction choice so manual edits are kept afterwards.
  const choice = `${selected}:${femaleDirection}`;
  if (choice !== femaleChoice) {
    femaleChoice = choice;
    if (chosen?.target && design.version !== 6) input("quick-length").value = String(chosen.target.length);
  }
  if (!anchor || !chosen || chosen.blocked) {
    el("female-preview-status").textContent = anchor
      ? "この節点から伸ばせる向きがありません。"
      : "図で起点の節点をクリックしてください。";
    return;
  }
  try {
    const draft = structuredClone(design);
    const result = appendMember(
      draft,
      anchor.id,
      "female",
      femaleVector(design, anchor.id),
      Number(input("quick-length").value),
      design.version === 6 ? select("female-catalog").value : undefined,
    );
    const valid = parseDesign(serializeDesign(draft));
    const member = valid.members.find((m) => m.id === result.memberId);
    femalePreview = { design: valid, member: result.memberId };
    button.disabled = false;
    const reached = design.nodes.some((n) => n.id === result.nodeId);
    el("female-preview-status").textContent =
      `${member?.layer ?? 0}段目に重ねます。${reached ? `${result.nodeId} とつなぎます。` : "先端は新しい節点になります。"}`;
  } catch (e) {
    el("female-preview-status").textContent = e instanceof Error ? e.message : String(e);
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".dir-button"))
  b.addEventListener("click", () => {
    femaleDirection = b.dataset.dir as AxisDirection;
    draw();
  });
input("quick-length").addEventListener("input", draw);
input("female-tilt").addEventListener("input", draw);
let templateMales: string[] = [];
let templateShape: TemplateShape = "square";
let templateDirection: AxisDirection | null = null;
let templateSide: 1 | -1 = 1;
let templatePreview: { design: Design; created: string[] } | null = null;
const templateMode = () => tab === "model" && palette === "template" && lastPage.model === "add";
const axisName = (v: number[]) => {
  const names = [
    ["+X 右", "−X 左"],
    ["+Y 上", "−Y 下"],
    ["+Z 奥", "−Z 手前"],
  ];
  const axis = [0, 1, 2].reduce((best, i) => (Math.abs(v[i]) > Math.abs(v[best]) ? i : best), 0);
  return names[axis][v[axis] >= 0 ? 0 : 1];
};
function pickTemplateMale(id: string) {
  const member = design.members.find((m) => m.id === id);
  if (member?.kind !== "male") {
    el("tool-hint").textContent = "テンプレートの起点には雄材を選んでください";
    return;
  }
  // Clicking a picked male releases it only when two are picked, so re-clicking the sole base is harmless.
  if (!templateMales.includes(id)) templateMales = [...templateMales, id].slice(-2);
  else if (templateMales.length > 1) templateMales = templateMales.filter((m) => m !== id);
  draw();
}
/** Recompute the translucent template preview from the picked males, shape, direction and size. */
/** End shape of the template's boards: the one picked in the female catalog (drawing designs only). */
function templateFemaleEnd() {
  return design.version === 6 ? catalogPart(select("female-catalog").value).end : undefined;
}
/** Switches the female catalog between the square (角) and round (丸) end of the same size. */
function toggleFemaleEnd() {
  if (design.version !== 6) {
    el("tool-hint").textContent = "角・丸の切り替えは図面規格の設計で使えます";
    return;
  }
  const catalog = select("female-catalog");
  const next = catalog.value.includes("-square")
    ? catalog.value.replace("-square", "-round")
    : catalog.value.replace("-round", "-square");
  catalogPart(next);
  catalog.value = next;
  catalog.dispatchEvent(new Event("change"));
  el("tool-hint").textContent = `雌材を${catalogPart(next).label}に切り替えました`;
}
function refreshTemplatePreview() {
  templatePreview = null;
  const button = el<HTMLButtonElement>("template-add");
  button.disabled = true;
  if (!templateMode()) return;
  templateMales = templateMales.filter((id) => design.members.some((m) => m.id === id && m.kind === "male"));
  el("template-males").textContent = templateMales.length
    ? `起点：雄材 ${templateMales.join("・")}${templateMales.length === 1 ? "（平行な2本目もクリックできます）" : ""}`
    : "起点：未選択（雄材をクリック）";
  for (const b of document.querySelectorAll<HTMLButtonElement>(".shape-button"))
    b.setAttribute("aria-pressed", String(b.dataset.shape === templateShape));
  const one = templateMales.length === 1;
  el("template-one").hidden = !one;
  const part = design.version === 6 ? catalogPart(select("female-catalog").value) : undefined;
  el("template-part").textContent = part
    ? `雌材：${part.label}（穴中心間 ${Math.round(part.span * 10000) / 10}mm）`
    : "";
  el("template-side").hidden = templateShape !== "triangle" || templateMales.length === 0;
  const allowed = one ? templateDirections(design, templateMales[0]) : [];
  if (one && (!templateDirection || !allowed.includes(templateDirection)))
    templateDirection = allowed.includes("y") ? "y" : (allowed[0] ?? null);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".template-dir")) {
    const ok = allowed.includes(b.dataset.dir as AxisDirection);
    b.disabled = !ok;
    b.title = ok ? "" : "雄材と同じ向きには広げられません";
    b.setAttribute("aria-pressed", String(ok && b.dataset.dir === templateDirection));
  }
  if (templateMales.length === 0) {
    el("template-status").textContent = "図かアウトライナーで雄材をクリックしてください。";
    return;
  }
  const request = {
    shape: templateShape,
    males: templateMales,
    direction: templateDirection ?? undefined,
    size: Number(input("template-size").value),
    side: templateSide,
    femaleEnd: templateFemaleEnd(),
  };
  try {
    if (templateShape === "triangle") {
      const apex = apexDirection(design, request);
      for (const b of document.querySelectorAll<HTMLButtonElement>(".side-button")) {
        const side = Number(b.dataset.side) as 1 | -1;
        b.textContent = `${axisName(apex.map((v) => v * side))}側`;
        b.setAttribute("aria-pressed", String(side === templateSide));
      }
    }
    const draft = structuredClone(design);
    const { created } = addTemplate(draft, request);
    templatePreview = { design: parseDesign(serializeDesign(draft)), created };
    button.disabled = false;
    const males = created.filter(
      (id) => templatePreview?.design.members.find((m) => m.id === id)?.kind === "male",
    );
    el("template-status").textContent =
      `雄材${males.length}本・雌材${created.length - males.length}枚を追加します。`;
  } catch (e) {
    el("template-status").textContent = e instanceof Error ? e.message : String(e);
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".shape-button"))
  b.addEventListener("click", () => {
    templateShape = b.dataset.shape as TemplateShape;
    draw();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>(".template-dir"))
  b.addEventListener("click", () => {
    templateDirection = b.dataset.dir as AxisDirection;
    draw();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>(".side-button"))
  b.addEventListener("click", () => {
    templateSide = Number(b.dataset.side) as 1 | -1;
    draw();
  });
input("template-size").addEventListener("input", draw);
el("template-clear").addEventListener("click", () => {
  templateMales = [];
  draw();
});
el("template-add").addEventListener("click", () =>
  guard(() => {
    if (!templatePreview) throw new Error("テンプレートの条件を確認してください");
    const created = templatePreview.created;
    const request = {
      shape: templateShape,
      males: templateMales,
      direction: templateDirection ?? undefined,
      size: Number(input("template-size").value),
      side: templateSide,
      femaleEnd: templateFemaleEnd(),
    };
    update((d) => {
      addTemplate(d, request);
    });
    actionNote = `${templateShape === "triangle" ? "三角形" : "四角形"}のテンプレートを追加しました`;
    templateMales = [];
    sync();
    draw();
    viewport?.fitIfOutside(
      design.members.filter((m) => created.includes(m.id)).flatMap((m) => [m.start, m.end]),
    );
    viewport?.pulse(created);
  }),
);
el("quick-add").addEventListener("click", () =>
  guard(() => {
    let target = selected;
    let member = selectedMember;
    update((d) => {
      const result = appendMember(
        d,
        selected,
        "female",
        femaleVector(d, selected),
        Number(input("quick-length").value),
        d.version === 6 ? select("female-catalog").value : undefined,
      );
      target = result.nodeId;
      member = result.memberId;
    });
    selected = target;
    selectedMember = member;
    selectionType = "node";
    actionNote = `雌材 ${member} を追加しました`;
    sync();
    draw();
    viewport?.fitIfOutside([target]);
    viewport?.pulse([member]);
  }),
);
el("new-design").addEventListener("click", () =>
  guard(() => {
    const next = parseDesign(serializeDesign(prepare(createDrawingDesign(select("drawing-start").value))));
    history.push(design, next);
    design = next;
    persistDraft();
    selected = "n0";
    selectedMember = "m0";
    selectionType = "member";
    setTab("model");
    showProps("add");
    el("palette-male").click();
    actionNote = "新規作成：床に雌材を1枚置きました。穴を選んで雄材を差し込んでください";
    markDirty();
    sync();
    select("hole-female").value = "m0";
    syncHoleNumbers();
    refreshMalePreview();
    choosingHole = true;
    el("pick-hole").setAttribute("aria-pressed", "true");
    viewport?.fit();
    draw();
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
            (node.position[axis] + Number(button.dataset.delta) * (Number(select("snap").value) || 0.01)) *
              1e6,
          ) / 1e6;
        selectionType = "node";
      }),
    ),
  );
function moving() {
  return tab === "model" && el("move-tool").getAttribute("aria-pressed") === "true";
}
/** The target the move tool acts on, from the scope buttons and the current selection. */
function moveTarget(): { target: MoveTarget; id: string } | null {
  if (moveScope === "all") return design.members.length ? { target: "all", id: "" } : null;
  const member =
    selectionType === "member"
      ? selectedMember
      : (design.members.find((m) => m.start === selected || m.end === selected)?.id ?? "");
  if (moveScope === "group") return member ? { target: "group", id: member } : null;
  if (selectionType === "node")
    return design.nodes.some((n) => n.id === selected) ? { target: "node", id: selected } : null;
  if (selectionType === "member") return { target: "member", id: selectedMember };
  return null;
}
/** How the joints restrict the current move target (always free when joints are not kept). */
function moveConstraint() {
  const chosen = moveTarget();
  if (!chosen || !keepJoints) return { kind: "free" as const };
  const constraint = jointConstraint(design, chosen.target, chosen.id);
  if (constraint.kind !== "hinge") return constraint;
  const key = `${chosen.target}:${chosen.id}`;
  if (hingeCache?.design !== design || hingeCache.key !== key)
    hingeCache = { design, key, sweep: new HingeSweep(design, chosen.target, chosen.id, constraint.hinge) };
  return { ...constraint, sweep: hingeCache.sweep };
}
function moveSpec(): TransformSpec | null {
  if (!moving() || choosingHole || choosingFrame || femalePreview || templatePreview) return null;
  const chosen = moveTarget();
  if (!chosen) return null;
  const constraint = moveConstraint();
  if (constraint.kind === "locked") return null;
  if (constraint.kind === "hinge") {
    const parts = targetParts(design, chosen.target, chosen.id);
    return {
      mode: "rotate",
      pivot: constraint.hinge.pivot,
      nodes: parts.nodes,
      members: parts.members,
      all: false,
      snap: 0,
      rotationSnap: Number(select("rotation-snap").value),
      hinge: { axis: constraint.hinge.axis, limit: (angle) => constraint.sweep.limit(angle) },
    };
  }
  const parts = targetParts(design, chosen.target, chosen.id);
  if (!parts.nodes.length) return null;
  return {
    mode: chosen.target === "node" ? "translate" : moveMode,
    pivot: pivotOf(design, parts.nodes),
    nodes: parts.nodes,
    members: parts.members,
    all: chosen.target === "all",
    snap: Number(select("snap").value),
    rotationSnap: Number(select("rotation-snap").value),
  };
}
/** The male the mirror plane runs through; chosen by hand or the one closest to the middle of the structure. */
let mirrorCenter = "";
function mirrorCentre(): string {
  const males = design.members.filter((m) => m.kind === "male");
  if (males.some((m) => m.id === mirrorCenter)) return mirrorCenter;
  const middle = pivotOf(
    design,
    design.nodes.map((n) => n.id),
  );
  const distance = (m: (typeof males)[number]) => {
    const a = design.nodes.find((n) => n.id === m.start)?.position ?? middle;
    const b = design.nodes.find((n) => n.id === m.end)?.position ?? middle;
    const axis = b.map((v, i) => v - a[i]);
    const length = Math.hypot(...axis) || 1;
    const offset = middle.map((v, i) => v - a[i]);
    const along = offset.reduce((sum, v, i) => sum + (v * axis[i]) / length, 0);
    return Math.hypot(...offset.map((v, i) => v - (along * axis[i]) / length));
  };
  return [...males].sort((x, y) => distance(x) - distance(y))[0]?.id ?? "";
}
function syncMirror() {
  const centre = mirrorCentre();
  const field = select("mirror-center");
  const males = design.members.filter((m) => m.kind === "male").map((m) => m.id);
  if ([...field.options].map((o) => o.value).join() !== males.join())
    field.replaceChildren(...males.map((id) => new Option(`雄材 ${id}`, id)));
  field.value = centre;
  const ready = !!centre;
  el<HTMLButtonElement>("mirror-selection").disabled = !ready;
  el<HTMLButtonElement>("mirror-all").disabled = !ready;
  el("mirror-status").textContent = ready
    ? `雄材 ${centre} の両端の凸部の真ん中で、軸に垂直な面に対して反転します（一方の凸部側の部材をもう一方の凸部側へ）。反対側に既にある部材は作りません。ロープ・丸材は写しません。`
    : "雄材を置くとミラーできます。";
}
/** Mirrors the move target (or everything) across the plane through the centre male. */
function mirror(all: boolean) {
  guard(() => {
    const centre = mirrorCentre();
    const chosen = all ? { target: "all" as const, id: "" } : moveTarget();
    if (!chosen || chosen.target === "node") throw new Error("ミラーする部材を選んでください");
    const members = targetParts(design, chosen.target, chosen.id).members.filter((id) => id !== centre);
    if (!members.length) throw new Error("中心の雄材以外の部材を選んでください");
    let created: string[] = [];
    actionNote = "";
    update((d) => {
      created = mirrorParts(d, members, mirrorPlane(d, centre));
    });
    actionNote = `${created.length}本の部材を雄材 ${centre} で反転して追加しました`;
    sync();
    draw();
    viewport?.pulse(created);
  });
}
el("mirror-selection").addEventListener("click", () => mirror(false));
function pickAlignHole(hole: HoleRef) {
  const at = alignList.findIndex((h) => h.female === hole.female && h.hole === hole.hole);
  alignList = at >= 0 ? alignList.filter((_, i) => i !== at) : [...alignList, hole];
  draw();
}
function setAligning(on: boolean) {
  aligning = on;
  if (on) {
    choosingHole = false;
    showProps("transform");
    el("tool-hint").textContent = "重ねる穴を図でクリック（1つ目が基準）· Enter で重ねる · Esc でやめる";
  } else {
    alignList = [];
    el("tool-hint").textContent = defaultHints.model;
  }
  draw();
}
/**
 * Sets the insertion side to the one whose shaft passes through more holes there (e.g. through boards
 * stacked on both tenons of where the male will stand). Keeps the current side on a tie.
 */
function preferInsertionSide(female: string, hole: number) {
  const reach = (side: 1 | -1) => {
    try {
      return insertionPreview(design, female, hole, Number(input("male-length").value), side).connections
        .length;
    } catch (e) {
      // A side that cannot take a male at all simply reaches no holes.
      if (e instanceof Error) return 0;
      throw e;
    }
  };
  const [front, back] = [reach(1), reach(-1)];
  if (front !== back) select("male-side").value = back > front ? "-1" : "1";
}
/** Turns the boards of the picked holes so they lie over the first, previewed on a copy first. */
function alignPreview() {
  if (alignList.length < 2) return { lines: [] as string[], ok: false };
  try {
    const turns = alignHoles(structuredClone(design), alignList);
    return {
      lines: turns.map((t) => `${t.female} を ${Math.round(t.angle * 10) / 10}° 回す`),
      ok: true,
    };
  } catch (e) {
    return { lines: [e instanceof Error ? e.message : String(e)], ok: false };
  }
}
function syncAlign() {
  el("align-pick").setAttribute("aria-pressed", String(aligning));
  const [target] = alignList;
  const preview = alignPreview();
  el("align-list").textContent = target
    ? [`基準：${target.female} の穴${target.hole + 1}`, ...preview.lines].join(" / ")
    : aligning
      ? "1つ目の穴（基準）をクリックしてください"
      : "";
  el<HTMLButtonElement>("align-apply").disabled = !preview.ok;
}
el("align-pick").addEventListener("click", () => setAligning(!aligning));
el("align-clear").addEventListener("click", () => {
  alignList = [];
  draw();
});
el("align-apply").addEventListener("click", () =>
  guard(() => {
    const [target, ...rest] = alignList;
    if (!target || !rest.length) throw new Error("穴を2つ以上選んでください");
    let turned: string[] = [];
    update((d) => {
      turned = alignHoles(d, alignList).map((t) => t.female);
    });
    actionNote = `雌材 ${turned.join("・")} を回して穴を重ねました。I で雄材を差し込めます`;
    // Ready to insert a male through the holes that now coincide.
    select("hole-female").value = target.female;
    syncHoleNumbers(target.hole);
    preferInsertionSide(target.female, target.hole);
    setAligning(false);
    sync();
    draw();
  }),
);
function setMirrorMode(on: boolean) {
  if (on && !mirrorCentre()) {
    el("tool-hint").textContent = "ミラーモードには中心にする雄材が必要です";
    return;
  }
  mirrorMode = on;
  el("tool-hint").textContent = on
    ? `ミラーモード ON：雄材 ${mirrorCentre()} の両端の凸部が対称になるよう、以降の追加・移動・削除を反対の凸部側にも反映します`
    : "ミラーモードを解除しました";
  draw();
}
el("mirror-mode").addEventListener("click", () => setMirrorMode(!mirrorMode));
el("mirror-all").addEventListener("click", () => mirror(true));
select("mirror-center").addEventListener("change", () => {
  mirrorCenter = select("mirror-center").value;
  draw();
});
function targetName(target: MoveTarget) {
  return {
    node: "節点",
    member: "部材（単独）",
    group: "つながった部分",
    all: "構造全体",
  }[target];
}
function syncMoveTool() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".scope-button"))
    button.setAttribute("aria-pressed", String(button.dataset.scope === moveScope));
  for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-button"))
    button.setAttribute("aria-pressed", String(button.dataset.mode === moveMode));
  const chosen = moveTarget();
  const parts = chosen ? targetParts(design, chosen.target, chosen.id) : null;
  el("move-summary").textContent =
    chosen && parts
      ? `${targetName(chosen.target)}${chosen.id ? ` ${chosen.id}` : ""} · 部材${parts.members.length} · 節点${parts.nodes.length}`
      : "対象を図かアウトライナーで選んでください";
  syncMirror();
  syncAlign();
  el("mirror-mode").setAttribute("aria-pressed", String(mirrorMode));
  el("mirror-mode").textContent = mirrorMode ? `⇋ ミラー ON（${mirrorCentre()}）` : "⇋ ミラー";
  const constraint = moveConstraint();
  // On a hinge only turning is possible; show the operation that actually happens.
  for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-button")) {
    const mode = constraint.kind === "hinge" ? "rotate" : moveMode;
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    button.disabled =
      constraint.kind === "locked" || (constraint.kind === "hinge" && button.dataset.mode === "translate");
  }
  el("move-constraint").setAttribute("aria-pressed", String(keepJoints));
  el("move-constraint").textContent = keepJoints ? "⛓ 接続を保って動かす（自動）" : "✥ 自由に動かす";
  el("move-constraint-status").textContent =
    constraint.kind === "hinge"
      ? `雄材とつながっているため、その角棒の軸まわりにだけ回します（接続${constraint.joints}か所）。干渉する手前で止まります。`
      : constraint.kind === "locked"
        ? `別々の軸の雄材${constraint.joints}か所に固定されているため動かせません。C で自由に動かせます（接続は外れます）。`
        : keepJoints
          ? "雄材とはつながっていないので自由に動かせます。"
          : "接続を気にせず動かします。離れた接続は外れます。";
  el<HTMLButtonElement>("apply-rotate").disabled =
    !chosen || chosen.target === "node" || constraint.kind === "locked";
  el<HTMLButtonElement>("apply-move").disabled = constraint.kind !== "free";
  if (moving())
    el("tool-hint").textContent =
      constraint.kind === "hinge"
        ? "輪をドラッグして角棒まわりに回転（干渉の手前で停止）· C 自由 · Esc 終了"
        : constraint.kind === "locked"
          ? "固定されています · C で自由に動かす · Esc 終了"
          : moveMode === "rotate"
            ? "色付きの輪をドラッグして回転 · G 移動 · A 全体 · Esc 終了"
            : "矢印をドラッグして移動（近くの節点に吸着）· R 回転 · A 全体 · Esc 終了";
}
function applyMotion(motion: {
  translate: [number, number, number];
  axis: [number, number, number];
  angle: number;
}) {
  const chosen = moveTarget();
  if (!chosen) throw new Error("動かす対象を選んでください");
  const parts = targetParts(design, chosen.target, chosen.id);
  let pivot = pivotOf(design, parts.nodes);
  let result: ReturnType<typeof moveParts> = { nodes: [], droppedRopes: [] };
  actionNote = `${targetName(chosen.target)}を${Math.abs(motion.angle) > 1e-9 ? "回転" : "移動"}しました`;
  const constraint = moveConstraint();
  if (constraint.kind === "locked")
    throw new Error("雄材に固定されているため動かせません。C で自由に動かせます");
  if (constraint.kind === "hinge") {
    if (Math.hypot(...motion.translate) > 1e-9)
      throw new Error("雄材とつながった部分は角棒の軸まわりにだけ回せます");
    // Numeric angles come with their own axis; on a hinge the shaft decides the axis and the sweep the range.
    const along = Math.sign(motion.axis.reduce((sum, v, i) => sum + v * constraint.hinge.axis[i], 0)) || 1;
    const wanted = motion.angle * along;
    const angle = constraint.sweep.limit(wanted);
    if (Math.abs(angle) < 1e-9) throw new Error("この向きには干渉するため回せません");
    motion = { ...motion, axis: constraint.hinge.axis, angle };
    pivot = constraint.hinge.pivot;
    actionNote = `${targetName(chosen.target)}を角棒まわりに${Math.round(angle * 10) / 10}°回転しました${Math.abs(angle - wanted) > 1e-6 ? "（干渉の手前で止めました）" : ""}`;
  }
  try {
    update((d) => {
      result = moveParts(d, chosen.target, chosen.id, { ...motion, pivot });
    });
  } catch (e) {
    actionNote = "";
    throw e;
  }
  if (chosen.target === "node" && result.nodes[0]) selected = result.nodes[0];
  if (result.droppedRopes.length) {
    actionNote += `（ロープ${result.droppedRopes.length}本を外しました）`;
    el("status").textContent = `${actionNote}。再計算しています…`;
  }
  viewport?.pulse(parts.members);
}
el("move-tool").addEventListener("click", () => {
  const on = el("move-tool").getAttribute("aria-pressed") !== "true";
  el("move-tool").setAttribute("aria-pressed", String(on));
  if (on) {
    choosingHole = false;
    showProps("transform");
  } else el("tool-hint").textContent = defaultHints.model;
  draw();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(".scope-button"))
  button.addEventListener("click", () => {
    moveScope = button.dataset.scope as typeof moveScope;
    draw();
  });
for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-button"))
  button.addEventListener("click", () => {
    moveMode = button.dataset.mode as typeof moveMode;
    draw();
  });
select("rotation-snap").addEventListener("change", draw);
el("move-constraint").addEventListener("click", () => {
  keepJoints = !keepJoints;
  draw();
});
el("apply-move").addEventListener("click", () =>
  guard(() =>
    applyMotion({
      translate: [
        Number(input("move-dx").value),
        Number(input("move-dy").value),
        Number(input("move-dz").value),
      ],
      axis: [0, 1, 0],
      angle: 0,
    }),
  ),
);
el("apply-rotate").addEventListener("click", () =>
  guard(() => {
    const axis = select("rotate-axis").value;
    applyMotion({
      translate: [0, 0, 0],
      axis: [axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0],
      angle: Number(input("rotate-angle").value),
    });
  }),
);
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
  showProps("ring");
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
for (const kind of ["male", "female"] as const)
  select(`${kind}-catalog`).addEventListener("change", () => {
    syncDrawingTools();
    refreshMalePreview();
    draw();
  });
el("apply-tenon-radius").addEventListener("click", () =>
  guard(() =>
    update((d) => {
      if (d.version !== 6) throw new Error("図面規格の設計で変更してください");
      d.geometry.tenonCornerRadius = Number(input("tenon-radius").value) / 1000;
    }),
  ),
);
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
  showProps("add");
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
    viewport?.fitIfOutside(design.members.filter((m) => m.id === member).flatMap((m) => [m.start, m.end]));
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
  setTab("model");
  showProps("rope");
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
  viewport.onTransform = (motion) =>
    guard(() => {
      try {
        applyMotion(motion);
      } finally {
        draw();
      }
    });
  viewport.onHoleSelect = (female, hole) => {
    if (aligning) {
      pickAlignHole({ female, hole });
      return;
    }
    select("hole-female").value = female;
    syncHoleNumbers(hole);
    preferInsertionSide(female, hole);
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
    if (templateMode()) {
      pickTemplateMale(id);
      return;
    }
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
    showProps("ring");
    draw();
  };
  viewport.onSelect = (id) => {
    selected = id;
    selectionType = "node";
    if (!femaleMode() && !moving()) showProps("node");
    if (connectStart) {
      const start = connectStart;
      connectStart = null;
      el("connect-nodes").setAttribute("aria-pressed", "false");
      if (paletteKind() === "female") addBoardBetween(start, id);
      else
        guard(() =>
          update((d) => {
            if (start === id) throw new Error("異なる2節点を選んでください");
            const a = d.nodes.find((n) => n.id === start);
            const b = d.nodes.find((n) => n.id === id);
            if (!a || !b) throw new Error("節点がありません");
            const length = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
            const member: Member = {
              id: nextMemberId(d),
              kind: paletteKind(),
              start,
              end: id,
              material: d.materials[0].id,
              roll: paletteKind() === "female" ? boardRoll(d, start, id) : 0,
              layer: 0,
              holeCount: Math.max(2, Math.min(7, Math.floor(length / (d.geometry.holeSize * 1.5)) + 1)),
            };
            if (member.kind === "female") placeBoard(d, member);
            else d.members.push(member);
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
showProps("add");
el("tool-hint").textContent = defaultHints.model;
viewport?.fit();
requestAnimationFrame(() => calculate());

engineeringPanel = mountEngineering(el("page-load"), () => design, draw);
draw();
