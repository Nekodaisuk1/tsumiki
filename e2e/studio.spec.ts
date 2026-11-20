import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import * as THREE from "three";
import { catalogPart } from "../src/structure/catalog";
import { createDesign } from "../src/structure/design";
import {
  appendMember,
  createDrawingDesign,
  createSeedDesign,
  insertMaleAtHole,
} from "../src/structure/editor";
import { addTemplate } from "../src/structure/templates";

async function showTab(page: import("@playwright/test").Page, name: "モデリング" | "シミュレーション") {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}
async function props(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("tab", { name: `${name}のプロパティ` }).click();
  await expect(page.getByRole("tab", { name: `${name}のプロパティ` })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "legacy.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createDesign())),
  });
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#comparison tr")).toHaveCount(3);
}
test("3D scene, force and base excitation, playback, and design editing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator("#viewport canvas")).toBeVisible();
  await expect(page.locator("#comparison")).toBeHidden();
  await showTab(page, "シミュレーション");
  await expect(page.locator("#comparison")).toBeVisible();
  await expect(page.locator("#insert-male")).toBeHidden();
  await page.getByLabel("応答の表示").selectOption("base");
  await expect(page.locator("#history polyline")).toHaveCount(3);
  await page.getByRole("button", { name: "▶ 再生", exact: true }).click();
  await expect.poll(async () => Number(await page.locator("#time").inputValue())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Ⅱ 停止", exact: true }).click();
  const beforeDirection = await page.locator("#comparison").textContent();
  await page.getByLabel("作用方向").selectOption("z");
  await expect(page.locator("#response")).toHaveClass(/stale/);
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#response")).not.toHaveClass(/stale/);
  await expect(page.locator("#comparison tr")).toHaveCount(3);
  await expect(page.locator("#comparison")).not.toHaveText(beforeDirection ?? "");
  await expect(page.locator("#comparison tr").nth(2)).toContainText("%）");
  await page.getByRole("tab", { name: "部材端内力" }).click();
  await page.locator("#member-results tr", { hasText: "m3" }).first().click();
  await expect(page.locator("#selection-summary")).toContainText("部材 m3");
  await expect(page.locator("#member-results tr.is-selected")).toContainText("m3");
  await page.keyboard.press("1");
  await expect(page.getByRole("tab", { name: "モデリング" })).toHaveAttribute("aria-selected", "true");
  await props(page, "節点");
  await page.getByLabel("節点（3D図でも選択可）").selectOption("n6");
  await page.getByLabel("X", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "節点を更新" }).click();
  await expect(page.locator("#status")).toContainText("計算完了");
  await page.getByRole("button", { name: "丸材を配置" }).click();
  await expect(page.locator("#counts")).toContainText("1丸材");
  await page.screenshot({ path: "test-results/studio-model.png" });
  await page.keyboard.press("2");
  await expect(page.locator("#status")).toContainText("計算完了");
  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Ⅱ 停止", exact: true })).toBeVisible();
  await page.keyboard.press(" ");
  await page.screenshot({ path: "test-results/studio-desktop.png" });
  expect(errors).toEqual([]);
});
test("dedicated format round trip preserves geometry, loads and numerical results", async ({ page }) => {
  await ready(page);
  await props(page, "設計");
  await page.getByLabel("設計名", { exact: true }).fill("再現性の確認");
  await page.getByLabel("設計名", { exact: true }).press("Tab");
  await showTab(page, "シミュレーション");
  await page.getByRole("button", { name: "3条件を再計算" }).click();
  const before = await page.locator("#comparison").textContent();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ 設計を保存", exact: true }).click();
  const file = await promise;
  expect(file.suggestedFilename()).toBe("design.tsumiki.json");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  const data = JSON.parse(buffer.toString());
  expect(data.format).toBe("tsumiki-design");
  expect(data.nodes).toHaveLength(8);
  expect(data.ropes).toHaveLength(2);
  await page.getByLabel("静的・加振の外力振幅").fill("0.2");
  await page.getByLabel("静的・加振の外力振幅").press("Tab");
  await page
    .locator("#file")
    .setInputFiles({ name: "design.tsumiki.json", mimeType: "application/json", buffer });
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#comparison")).toHaveText(before ?? "");
  await expect(page.getByLabel("静的・加振の外力振幅")).toHaveValue("0.08");
  await page
    .locator("#file")
    .setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole("alert")).toContainText("現在の設計は保持");
  await showTab(page, "モデリング");
  await expect(page.getByLabel("設計名", { exact: true })).toHaveValue("再現性の確認");
});
test("desktop and mobile layout and accessibility", async ({ page }) => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["モデリング", "シミュレーション"] as const) {
      await showTab(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(result.violations).toEqual([]);
    }
  }
  await page.screenshot({ path: "test-results/studio-mobile.png", fullPage: true });
});

test("schema, sample, report and rope topology editing", async ({ page, request }) => {
  const schema = await request.get("/schemas/tsumiki-design-v5.schema.json");
  expect(schema.ok()).toBe(true);
  expect((await schema.json()).properties.version.const).toBe(5);
  const sample = await request.get("/examples/box-frame.tsumiki.json");
  expect(sample.ok()).toBe(true);
  await ready(page);
  await page.locator("#file").setInputFiles({
    name: "sample.tsumiki.json",
    mimeType: "application/json",
    buffer: await sample.body(),
  });
  await expect(page.locator("#status")).toContainText("計算完了");
  await showTab(page, "シミュレーション");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ 解析記録", exact: true }).click();
  const report = await downloadPromise;
  expect(report.suggestedFilename()).toBe("analysis.tsumiki-report.json");
  await showTab(page, "モデリング");
  await props(page, "ロープ");
  await page.getByRole("button", { name: "前面ロープだけ残す" }).click();
  await expect(page.locator("#counts")).toContainText("1ロープ");
  await page.locator("#route-d").selectOption("n5");
  await page.getByRole("button", { name: "経路更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("同じ雄材");
  await expect(page.locator("#counts")).toContainText("1ロープ");
  await page.getByRole("button", { name: "全ロープを外す" }).click();
  await showTab(page, "シミュレーション");
  await page.getByRole("button", { name: "3条件を再計算" }).click();
  await expect(page.locator("#status")).toContainText("計算完了");
  const rows = await page.locator("#comparison tr").allTextContents();
  const values = (row: string, name: string) => row.replace(name, "").replace(/（[^）]*）/g, "");
  expect(values(rows[0], "ロープなし")).toBe(values(rows[1], "たるみあり"));
  expect(values(rows[1], "たるみあり")).toBe(values(rows[2], "張力あり"));
  expect(rows[2]).toContain("（±0%）");
});

test("editor tools add, undo, redo, connect bays, fit gap spacers and recover a draft", async ({ page }) => {
  await ready(page);
  await page.getByLabel("差し込む雌材", { exact: true }).selectOption("m4");
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("10節点 / 13部材");
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("8節点 / 12部材");
  await page.getByRole("button", { name: "↷ やり直す", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("10節点 / 13部材");
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
  await props(page, "枠");
  await page.getByRole("button", { name: "奥に1区画つなぐ", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("12節点 / 20部材");
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
  await props(page, "節点");
  await page.getByLabel("節点（3D図でも選択可）").selectOption("n0");
  await page.getByRole("button", { name: "丸材を配置", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("1丸材");
  await expect(page.locator("#ring-member")).toHaveValue("m0");
  await expect(page.locator("#ring-slot")).toHaveValue("2");
  await page.getByLabel("はめる段", { exact: true }).fill("0");
  await page.getByRole("button", { name: "位置を更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("雌材の段");
  await expect(page.locator("#counts")).toContainText("1丸材");
  await page.reload();
  await expect(page.locator("#counts")).toContainText("2節点 / 1部材");
  await page.getByRole("button", { name: "下書きを復元", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("1丸材");
  await props(page, "節点");
  await page.getByLabel("節点（3D図でも選択可）").selectOption("n6");
  await page.getByRole("button", { name: "+X", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#nx")).toHaveValue("1.4");
  await page.getByRole("button", { name: "移動", exact: true }).click();
  await expect(page.getByRole("tab", { name: "モデリング" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#move-tool")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/editor-tools.png", fullPage: true });
});

test("directly selects a board and rejects a colliding node gizmo drag", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const canvas = page.locator("#viewport canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  const camera = new THREE.PerspectiveCamera(38, box.width / box.height, 0.01, 100);
  camera.position.set(0.7, 0.7, 5.5);
  camera.lookAt(0.7, 0.6, 0.5);
  camera.updateMatrixWorld();
  const project = (point: THREE.Vector3) => {
    const p = point.project(camera);
    return { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 };
  };
  const board = project(new THREE.Vector3(0.7, 1.2, 1));
  await page.mouse.click(board.x, board.y);
  await expect(page.locator("#selection-summary")).toContainText("m3");
  await page.getByRole("button", { name: "移動", exact: true }).click();
  const node = project(new THREE.Vector3(1.4, 1.2, 1));
  // With a member selected the gizmo moves the member; pick its end node (hidden behind the board) to drag it alone.
  const end = createDesign().nodes.find((n) => n.position.join() === [1.4, 1.2, 1].join());
  if (!end) throw new Error("Missing end node");
  await props(page, "節点");
  await page.locator("#node").selectOption(end.id);
  await expect(page.locator("#move-summary")).toHaveText(new RegExp(`^節点 ${end.id} · `));
  await page.mouse.move(node.x, node.y - 28);
  await page.mouse.down();
  await page.mouse.move(node.x, node.y - 78, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#ny")).toHaveValue("1.2");
  await expect(page.locator("#nx")).toHaveValue("1.4");
  await expect(page.locator("#nz")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "↶ 元に戻す", exact: true })).toBeEnabled();
});

test("female addition from a selected male stacks on the next free layer and preserves rope space", async ({
  page,
}) => {
  await ready(page);
  await props(page, "部材");
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await props(page, "追加");
  await page.getByRole("button", { name: "▣ 雌材", exact: true }).click();
  await expect(page.locator("#female-anchor")).toContainText("雄材 m3 の終点側");
  await expect(page.getByRole("button", { name: "+X 右へ" })).toBeDisabled();
  await page.getByRole("button", { name: "+Y 上へ" }).click();
  await page.locator("#quick-length").fill("1");
  await expect(page.locator("#female-preview-status")).toContainText("2段目");
  await page.getByRole("button", { name: "③ 雌材を追加", exact: true }).click();
  await expect(page.locator("#member-layer")).toHaveValue("2");
  await expect(page.locator("#counts")).toContainText("9節点 / 13部材");
  await props(page, "部材");
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await props(page, "追加");
  await page.getByRole("button", { name: "+Z 奥へ" }).click();
  await page.getByRole("button", { name: "③ 雌材を追加", exact: true }).click();
  await expect(page.locator("#member-layer")).toHaveValue("3");
  await props(page, "部材");
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await props(page, "追加");
  await page.getByRole("button", { name: "−Y 下へ" }).click();
  await page.locator("#quick-length").fill("0.7");
  await expect(page.locator("#female-preview-status")).toContainText("ロープ用");
  await expect(page.getByRole("button", { name: "③ 雌材を追加", exact: true })).toBeDisabled();
  await expect(page.locator("#counts")).toContainText("10節点 / 14部材");
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ 設計を保存", exact: true }).click();
  const download = await promise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const saved = JSON.parse(Buffer.concat(chunks).toString());
  expect(saved.version).toBe(5);
  expect(saved.geometry.tenonLength / saved.geometry.thickness).toBeCloseTo(5);
});

test("hole selection inserts a perpendicular male with a real structural connection", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#quick-direction")).toBeHidden();
  await page.getByLabel("差し込む雌材", { exact: true }).selectOption("m4");
  await expect(page.locator("#hole-number")).toHaveValue("3");
  await expect(page.locator("#male-preview-status")).toContainText("垂直にスナップ");
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("10節点 / 13部材");
  await expect(page.locator("#counts")).toContainText("1穴接続");
  await expect(page.locator("#status")).toContainText("構造接続を保存しました · 計算完了");
  await page.getByLabel("差し込む雌材", { exact: true }).selectOption("m4");
  await expect(page.locator('#hole-number option[value="3"]')).toBeDisabled();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ 設計を保存", exact: true }).click();
  const file = await promise;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  const buffer = Buffer.concat(chunks);
  const data = JSON.parse(buffer.toString());
  expect(data.connections).toHaveLength(1);
  await page
    .locator("#file")
    .setInputFiles({ name: "saved.tsumiki.json", mimeType: "application/json", buffer });
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#counts")).toContainText("1穴接続");
});
test("rope workflow requires a frame and an exclusive winding male", async ({ page }) => {
  await ready(page);
  await props(page, "ロープ");
  await page.getByRole("button", { name: "全ロープを外す", exact: true }).click();
  await page.getByRole("button", { name: "ロープを張る", exact: true }).click();
  await expect(page.locator("#confirm-rope")).toBeDisabled();
  const frame = await page.locator("#rope-frame option").nth(1).getAttribute("value");
  if (!frame) throw new Error("Missing frame");
  await page.getByLabel("対象の構造部分", { exact: true }).selectOption(frame);
  await expect(page.locator("#confirm-rope")).toBeDisabled();
  await page.getByLabel("巻き取り用の雄材（他のロープと共用不可）", { exact: true }).selectOption("m0");
  await page.getByRole("button", { name: "③ ロープを張る", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("1ロープ");
  await expect(page.locator("#status")).toContainText("最外側");
  await page.getByRole("button", { name: "③ ロープを張る", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("1ロープ");
  await page.screenshot({ path: "test-results/hole-and-rope-workbench.png", fullPage: true });
});

test("selects a visible hole and a rope frame directly on the 3D scene", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.getByRole("button", { name: "① 図の穴を選ぶ", exact: true }).click();
  await page.getByRole("button", { name: "側面", exact: true }).click();
  const canvas = page.locator("#viewport canvas");
  await canvas.scrollIntoViewIfNeeded();
  let box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  const camera = new THREE.PerspectiveCamera(38, box.width / box.height, 0.01, 100);
  camera.position.set(5.7, 0.7, 0.5);
  camera.lookAt(0.7, 0.6, 0.5);
  camera.updateMatrixWorld();
  const point = new THREE.Vector3(1.4 + 0.045 / 2, 0.6, 0).project(camera);
  await page.mouse.click(box.x + ((point.x + 1) * box.width) / 2, box.y + ((1 - point.y) * box.height) / 2);
  await expect(page.locator("#hole-female")).toHaveValue("m5");
  await expect(page.locator("#hole-number")).toHaveValue("3");
  await expect(page.locator("#insert-male")).toBeEnabled();
  await page.getByRole("button", { name: "ロープを張る", exact: true }).click();
  await page.getByRole("button", { name: "正面", exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  camera.position.set(0.7, 0.7, 5.5);
  camera.lookAt(0.7, 0.6, 0.5);
  camera.updateMatrixWorld();
  const center = new THREE.Vector3(0.7, 0.6, 1).project(camera);
  await page.mouse.click(box.x + ((center.x + 1) * box.width) / 2, box.y + ((1 - center.y) * box.height) / 2);
  await expect(page.locator("#rope-frame")).toHaveValue("frame-n2-n3-n6-n7");
  await page.getByLabel("巻き取り用の雄材（他のロープと共用不可）", { exact: true }).selectOption("m3");
  await page.getByRole("button", { name: "③ ロープを張る", exact: true }).click();
  await expect(page.locator("#status")).toContainText("雄材 m3 を専用");
  await expect(page.locator("#counts")).toContainText("2ロープ");
  await page.screenshot({ path: "test-results/snapped-hole-editor.png", fullPage: true });
});
test("joint clearance and rope wrap assumptions change the comparison and are reported", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await showTab(page, "シミュレーション");
  const staticCell = (row: number) => page.locator(`#comparison tr:nth-child(${row}) td:nth-child(2)`);
  await expect(page.locator("#joint-results tr")).toHaveCount(16);
  await expect(page.locator("#joint-results")).toContainText("着座");
  await expect(page.locator("#diagnostics")).toContainText("掛け点の仮定の幅");
  const lockedTaut = Number.parseFloat((await staticCell(3).textContent()) ?? "");
  const none = Number.parseFloat((await staticCell(1).textContent()) ?? "");
  expect(lockedTaut).toBeLessThan(none / 20);
  await props(page, "接合");
  await page.getByLabel("ロープの掛け点（C・B）").selectOption("sliding");
  await page.getByRole("button", { name: "3条件を再計算" }).click();
  await expect(page.locator("#status")).toContainText("計算完了");
  expect(Number.parseFloat((await staticCell(3).textContent()) ?? "")).toBeGreaterThan(lockedTaut * 10);
  await page.getByLabel("接合のモデル").selectOption("rigid-approximation");
  await page.getByRole("button", { name: "3条件を再計算" }).click();
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#joint-results tr")).toHaveCount(0);
  await expect(page.locator("#joint-clearance")).toContainText("剛接合");
  await page.screenshot({ path: "test-results/joint-clearance.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("builds a structure from scratch: new board, male, female, then analysis", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "＋ 新規", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("2節点 / 1部材");
  await expect(page.locator("#status")).toContainText("まだ解析できません");
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("#male-preview-status")).toContainText("垂直にスナップ");
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材 / 0ロープ / 0丸材 / 1穴接続");
  await page.getByRole("button", { name: "▣ 雌材", exact: true }).click();
  await expect(page.locator("#female-anchor")).toContainText("雄材 m1 の終点側");
  await expect(page.getByRole("button", { name: "+Z 奥へ" })).toBeDisabled();
  await page.getByRole("button", { name: "+X 右へ" }).click();
  await expect(page.locator("#female-preview-status")).toContainText("先端は新しい節点");
  await page.getByRole("button", { name: "③ 雌材を追加", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("5節点 / 3部材 / 0ロープ / 0丸材 / 2穴接続");
  await expect(page.getByRole("alert")).toBeHidden();
  // Supports follow the floor and the load moves to a free node, so the analysis runs without setup.
  await showTab(page, "シミュレーション");
  await expect(page.getByLabel("荷重点", { exact: true })).not.toHaveValue("n1");
  await expect(page.locator("#status")).toContainText("計算完了");
  await expect(page.locator("#comparison tr")).toHaveCount(3);
  await page.screenshot({ path: "test-results/from-scratch.png" });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  expect(errors).toEqual([]);
});

test("structure templates: triangle from one male, square between two parallel males", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.locator("#file").setInputFiles({
    name: "legacy-seed.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createSeedDesign())),
  });
  await page.locator("#hole-female").selectOption("m0");
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  await page.keyboard.press("t");
  await expect(page.locator("#template-tools")).toBeVisible();
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await expect(page.locator("#template-males")).toContainText("雄材 m1");
  await expect(page.getByRole("button", { name: "+Z 奥へ広げる" })).toBeDisabled();
  await page.getByRole("button", { name: "△ 三角形" }).click();
  await page.getByRole("button", { name: "+X 右へ広げる" }).click();
  await expect(page.locator("#template-status")).toContainText("雄材2本・雌材6枚");
  await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("8節点 / 10部材");
  await expect(page.getByRole("alert")).toBeHidden();
  await showTab(page, "シミュレーション");
  await page.getByLabel("荷重点", { exact: true }).selectOption("n3");
  await expect(page.locator("#status")).toContainText("計算完了");
  await page.screenshot({ path: "test-results/template-triangle.png" });

  await ready(page);
  await expect(page.locator("#counts")).toContainText("8節点 / 12部材");
  await page.getByRole("button", { name: "テンプレートを追加" }).click();
  await page.locator('#outliner .outliner-item[data-id="m0"]').click();
  await page.locator('#outliner .outliner-item[data-id="m2"]').click();
  await expect(page.locator("#template-males")).toContainText("雄材 m0・m2");
  await expect(page.locator("#template-one")).toBeHidden();
  await expect(page.locator("#template-status")).toContainText("雄材0本・雌材2枚");
  await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("8節点 / 14部材");
  expect(errors).toEqual([]);
});

test("moves and rotates the whole structure, swaps stacking order and deletes any member", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const legacy = createDesign();
  const n0 = legacy.nodes[0];
  await page.locator("#viewport canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await expect(page.locator("#page-transform")).toBeVisible();
  await page.getByRole("button", { name: "構造全体（A）" }).click();
  await expect(page.locator("#move-summary")).toContainText(`部材${legacy.members.length}`);
  await page.locator("#move-dx").fill("0.5");
  await page.getByRole("button", { name: "移動する" }).click();
  await expect(page.locator("#status")).toContainText("構造全体を移動しました");
  await page.getByRole("button", { name: "回転する" }).click();
  await expect(page.locator("#status")).toContainText("構造全体を回転しました");
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
  await props(page, "節点");
  await page.locator("#node").selectOption(n0.id);
  await expect(page.locator("#nx")).toHaveValue(String(n0.position[0] + 0.5));

  // Stacking order: the inner board of a stacked pair goes one seat outward.
  const inner = legacy.members.find(
    (m) =>
      m.kind === "female" &&
      m.layer === 0 &&
      legacy.members.some(
        (o) =>
          o.kind === "female" && o.layer === 1 && [o.start, o.end].some((n) => n === m.start || n === m.end),
      ),
  );
  if (!inner) throw new Error("No stacked boards");
  await props(page, "部材");
  await page.locator("#member").selectOption(inner.id);
  await expect(page.getByRole("button", { name: "▼ 内側の段へ" })).toBeDisabled();
  await page.getByRole("button", { name: "▲ 外側の段へ" }).click();
  await expect(page.locator("#status")).toContainText("外側の段へ");
  await expect(page.locator("#member-layer")).toHaveValue("1");

  // Any placed member can be deleted, including the first one.
  const first = legacy.members[0].id;
  await page.locator("#member").selectOption(first);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.locator("#counts")).toContainText(`${legacy.members.length - 1}部材`);
  await expect(page.getByRole("alert")).toBeHidden();
  expect(errors).toEqual([]);
});

test("deletes the selection from the keyboard or the view header and always lists the shortcuts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const legacy = createDesign();
  const shortcuts = page.locator("#shortcuts");
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText("X / Del削除");
  await expect(shortcuts).toContainText("G移動・回転");

  // Mac's delete key arrives as Backspace.
  await page.locator(`#outliner .outliner-item[data-id="${legacy.members[0].id}"]`).click();
  await page.keyboard.press("Backspace");
  await expect(page.locator("#counts")).toContainText(`${legacy.members.length - 1}部材`);
  await page.locator(`#outliner .outliner-item[data-id="${legacy.members[1].id}"]`).click();
  await page.getByRole("button", { name: "🗑 削除" }).click();
  await expect(page.locator("#counts")).toContainText(`${legacy.members.length - 2}部材`);
  await expect(page.getByRole("alert")).toBeHidden();

  // The list follows the active tool and screen, and stays after a tool message replaces the status hint.
  await page.locator("#viewport canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await expect(shortcuts).toContainText("R回転");
  await expect(shortcuts).toContainText("A構造全体");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toContainText("I穴に差し込む");
  await page.keyboard.press("2");
  await expect(shortcuts).toContainText("Space再生・停止");
  expect(errors).toEqual([]);
});

test("chains templates on shared males and closes a ring of squares", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "＋ 新規", exact: true }).click();
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  await page.keyboard.press("t");
  // Each square adds one male (m2, m5, m8) and two boards.
  for (const [direction, from] of [
    ["+X 右へ広げる", "m1"],
    ["+Y 上へ広げる", "m2"],
    ["−X 左へ広げる", "m5"],
  ] as const) {
    await page.getByRole("button", { name: "雄材の選択をやり直す" }).click();
    await page.locator(`#outliner .outliner-item[data-id="${from}"]`).click();
    await page.getByRole("button", { name: direction }).click();
    await expect(page.locator("#template-status")).toContainText("雄材1本・雌材2枚");
    await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
    await expect(page.getByRole("alert")).toBeHidden();
  }
  await expect(page.locator("#counts")).toContainText("10節点 / 11部材");
  // Close the ring between the last and the first male.
  await page.getByRole("button", { name: "雄材の選択をやり直す" }).click();
  await page.locator('#outliner .outliner-item[data-id="m8"]').click();
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await expect(page.locator("#template-status")).toContainText("雄材0本・雌材2枚");
  await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("10節点 / 13部材");
  await expect(page.getByRole("alert")).toBeHidden();
  // Repeating a square that is already there is refused with a clear reason.
  await page.getByRole("button", { name: "雄材の選択をやり直す" }).click();
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await page.getByRole("button", { name: "+X 右へ広げる" }).click();
  await expect(page.locator("#template-status")).toContainText("既に同じ形");
  await expect(page.getByRole("button", { name: "③ テンプレートを追加", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/template-ring.png" });
  expect(errors).toEqual([]);
});

test("each tool lists and handles its own shortcuts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const shortcuts = page.locator("#shortcuts");
  // A new design starts in hole picking.
  await page.getByRole("button", { name: "＋ 新規", exact: true }).click();
  await expect(shortcuts).toContainText("F差し込み側を反転");
  await expect(shortcuts).toContainText("Enter雄材を差し込む");
  await expect(shortcuts).not.toContainText("Shift+A");
  await page.locator("#viewport canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("f");
  await expect(page.locator("#male-side")).toHaveValue("-1");
  await page.keyboard.press("f");
  await expect(page.locator("#male-side")).toHaveValue("1");
  await page.keyboard.press("Enter");
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");

  await page.keyboard.press("t");
  await expect(shortcuts).toContainText("S四角形 ⇄ 三角形");
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "△ 三角形" })).toHaveAttribute("aria-pressed", "true");
  const side = page.locator('.side-button[aria-pressed="true"]');
  const before = await side.getAttribute("data-side");
  await page.keyboard.press("f");
  await expect(side).not.toHaveAttribute("data-side", before ?? "");
  await expect(page.locator("#template-add")).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page.locator("#status")).toContainText("三角形のテンプレートを追加しました");

  await page.keyboard.press("Shift+A");
  await expect(shortcuts).toContainText("C2つの節点をつなぐ");
  await expect(shortcuts).toContainText("Enter雌材を追加");
  await page.keyboard.press("c");
  await expect(shortcuts).toContainText("クリックつなぐ先の節点");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toContainText("Enter雌材を追加");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toContainText("G移動・回転");
  await expect(page.getByRole("button", { name: "⊣ 雄材 ⊢" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("r");
  await expect(shortcuts).toContainText("クリックロープを張る枠");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toContainText("G移動・回転");
  expect(errors).toEqual([]);
});

test("a new design starts from an upright board and K switches square and round female ends", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "＋ 新規", exact: true }).click();
  await props(page, "部材");
  await page.locator("#member").selectOption("m0");
  await expect(page.locator("#member-roll")).toHaveValue("0");
  await props(page, "追加");
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  await page.keyboard.press("Shift+A");
  const shortcuts = page.locator("#shortcuts");
  await expect(shortcuts).toContainText("K雌材の端 角 ⇄ 丸");
  const catalog = page.locator("#female-catalog");
  await expect(catalog).toHaveValue(/-square$/);
  await page.keyboard.press("k");
  await expect(catalog).toHaveValue(/-round$/);
  await expect(page.locator("#tool-hint")).toContainText("丸");
  await page.keyboard.press("k");
  await expect(catalog).toHaveValue(/-square$/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await expect(shortcuts).toContainText("K雌材の端 角 ⇄ 丸");
  await page.keyboard.press("k");
  await expect(catalog).toHaveValue(/-round$/);
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await page.getByRole("button", { name: "+X 右へ広げる" }).click();
  await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("#counts")).toContainText("6節点 / 5部材");
  expect(errors).toEqual([]);
});

/** Four males on the corners of a 450 × 600 rectangle; its diagonal is exactly the 750 board. */
function braceRing() {
  const d = createDrawingDesign("female-450-square");
  const { memberId } = insertMaleAtHole(d, "m0", 0, catalogPart("male-600").span, 1);
  const male = (created: string[]) =>
    created.find((c) => d.members.find((m) => m.id === c)?.kind === "male") ?? "";
  const a = catalogPart("female-450-square").span;
  const b = catalogPart("female-600-square").span;
  const second = male(
    addTemplate(d, { shape: "square", males: [memberId], direction: "x", size: a }).created,
  );
  const third = male(addTemplate(d, { shape: "square", males: [second], direction: "y", size: b }).created);
  const fourth = male(addTemplate(d, { shape: "square", males: [third], direction: "-x", size: a }).created);
  addTemplate(d, { shape: "square", males: [fourth, memberId] });
  const corner = d.members.find((m) => m.id === memberId)?.end ?? "";
  return { d, corner };
}

test("adds a diagonal brace from the candidates, tilts boards and resizes a board by catalog steps", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const { d, corner } = braceRing();
  await page.locator("#file").setInputFiles({
    name: "brace.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  const members = d.members.length;
  await expect(page.locator("#counts")).toContainText(`${d.nodes.length}節点 / ${members}部材`);
  await props(page, "節点");
  await page.locator("#node").selectOption(corner);
  await props(page, "追加");
  await page.getByRole("button", { name: "▣ 雌材", exact: true }).click();
  const brace = page.locator(".brace-target", { hasText: "筋交い" });
  await expect(brace.first()).toContainText("750♀角");
  await brace.first().click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("#counts")).toContainText(`${members + 1}部材`);
  await expect(page.locator("#status")).toContainText("に張りました");
  await page.screenshot({ path: "test-results/brace.png" });

  // Q / E tilt the board about the tenon.
  await props(page, "節点");
  await page.locator("#node").selectOption(corner);
  await props(page, "追加");
  await page.keyboard.press("e");
  await expect(page.locator("#female-tilt")).toHaveValue("15");
  await page.keyboard.press("q");
  await page.keyboard.press("q");
  await expect(page.locator("#female-tilt")).toHaveValue("-15");
  await expect(page.locator("#shortcuts")).toContainText("Q / E");

  // A selected female lists and handles the catalog-step keys.
  await page.keyboard.press("Escape");
  await props(page, "部材");
  await page.locator("#member").selectOption("m0");
  await expect(page.locator("#shortcuts")).toContainText("[ / ]1規格 短く / 長く");
  await page.locator("#member-dimensions").click();
  await page.keyboard.press("]");
  await expect(page.locator("#status")).toContainText("600♀角");
  await page.keyboard.press("[");
  await expect(page.locator("#status")).toContainText("450♀角");
  await page.getByRole("button", { name: "◀ 1規格短く" }).click();
  await expect(page.locator("#status")).toContainText("300♀角");
  await expect(page.locator("#shortcuts")).toContainText("K端の形 角 ⇄ 丸");
  await page.keyboard.press("k");
  await expect(page.locator("#status")).toContainText("300♀丸");
  await page.getByRole("button", { name: "角 ⇄ 丸" }).click();
  await expect(page.locator("#status")).toContainText("300♀角");
  await expect(page.getByRole("alert")).toBeHidden();
  expect(errors).toEqual([]);
});

test("G turns a board on a tenon about that tenon and stops before a collision", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const d = createDrawingDesign();
  const { nodeId: tip } = insertMaleAtHole(d, "m0", 2, catalogPart("male-600").span, 1);
  const { memberId: board } = appendMember(
    d,
    tip,
    "female",
    [0, 1, 0],
    catalogPart("female-1200-square").span,
    "female-1200-square",
  );
  insertMaleAtHole(d, "m0", 5, catalogPart("male-600").span, 1);
  await page.locator("#file").setInputFiles({
    name: "hinge.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  await expect(page.locator("#counts")).toContainText(`${d.members.length}部材`);
  await props(page, "部材");
  await page.locator("#member").selectOption(board);
  await page.keyboard.press("g");
  await expect(page.locator("#move-constraint-status")).toContainText("角棒の軸まわりにだけ回します");
  await expect(page.locator("#shortcuts")).toContainText("C接続を保つ ⇄ 自由");
  await expect(page.locator("#apply-move")).toBeDisabled();
  await page.screenshot({ path: "test-results/hinge-gizmo.png" });
  // Drag the ring far toward the second male (+X): the gizmo stops before the board hits it.
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const canvas = page.locator("#viewport canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas");
  const bounds = new THREE.Box3();
  for (const n of d.nodes) bounds.expandByPoint(new THREE.Vector3(...n.position));
  bounds.expandByScalar(d.geometry.tenonLength);
  const center = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, box.width / box.height, 0.01, 100);
  camera.position.copy(center).add(new THREE.Vector3(0, 0.1, 5));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const pivot = d.nodes.find((n) => n.id === tip)?.position ?? [0, 0, 0];
  const p = new THREE.Vector3(...pivot).project(camera);
  const at = { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 };
  const radius = 0.11875 * box.height;
  // One drag turns about 45°; the second male blocks the board at about 76°, so the third drag stops short.
  const turns: number[] = [];
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(at.x, at.y - radius);
    await page.mouse.down();
    await page.mouse.move(at.x - 700, at.y - radius, { steps: 30 });
    await page.mouse.up();
    await expect(page.getByRole("alert")).toBeHidden();
    const text = (await page.locator("#status").textContent()) ?? "";
    const turned = /角棒まわりに(-?[\d.]+)°/.exec(text);
    if (turned) turns.push(Number(turned[1]));
  }
  // The first drag turns freely (snapped to 15°), the second stops off the snap grid short of the male,
  // the third cannot turn any further.
  expect(turns[0]).toBe(-45);
  expect(Math.abs(turns[1])).toBeLessThan(45);
  expect(Math.abs(turns[1]) % 15).not.toBe(0);
  expect(turns).toHaveLength(3);
  expect(turns[2]).toBe(turns[1]);
  await page.screenshot({ path: "test-results/hinge-dragged.png" });
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
  // One way is open, the other runs into the second male.
  const notes: string[] = [];
  for (const angle of ["90", "-180"]) {
    await page.locator("#rotate-angle").fill(angle);
    await page.getByRole("button", { name: "回転する" }).click();
    await expect(page.locator("#status")).toContainText("角棒まわりに");
    notes.push((await page.locator("#status").textContent()) ?? "");
  }
  expect(notes.some((n) => n.includes("干渉の手前で止めました"))).toBe(true);
  await expect(page.getByRole("alert")).toBeHidden();
  await page.keyboard.press("c");
  await expect(page.locator("#move-constraint")).toHaveText("✥ 自由に動かす");
  await expect(page.locator("#apply-move")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("steps the board size of square and triangle templates by drawing sizes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "＋ 新規", exact: true }).click();
  await page.getByRole("button", { name: "③ 雄材を差し込む", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  await page.keyboard.press("t");
  await page.locator('#outliner .outliner-item[data-id="m1"]').click();
  await page.getByRole("button", { name: "+X 右へ広げる" }).click();
  const part = page.locator("#template-part");
  await expect(part).toContainText("1200♀角");
  await expect(page.locator("#shortcuts")).toContainText("[ / ]雌材 1規格 短く / 長く");
  await page.keyboard.press("]");
  await expect(part).toContainText("1500♀角");
  await expect(page.locator("#template-size")).toHaveValue(String(catalogPart("female-1500-square").span));
  // 1500 puts the second male on hole 7 of the base board.
  await expect(page.locator("#template-status")).toContainText("雄材1本・雌材2枚");
  await page.getByRole("button", { name: "◀ 1規格短く" }).click();
  await page.keyboard.press("[");
  await expect(part).toContainText("1050♀角");
  // 1050 would put it between holes of the base board, which the preview reports.
  await expect(page.locator("#template-status")).toContainText("干渉");
  await page.keyboard.press("]");
  await expect(part).toContainText("1200♀角");
  await page.keyboard.press("s");
  await expect(page.locator("#template-status")).toContainText("雄材2本・雌材6枚");
  await page.getByRole("button", { name: "③ テンプレートを追加", exact: true }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("#counts")).toContainText("10部材");
  expect(errors).toEqual([]);
});
