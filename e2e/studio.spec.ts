import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import * as THREE from "three";

async function showTab(page: import("@playwright/test").Page, name: "モデリング" | "シミュレーション") {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
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
  await page.locator("#member-results tr", { hasText: "m3" }).first().click();
  await expect(page.locator("#selection-summary")).toContainText("部材 m3");
  await expect(page.locator("#member-results tr.is-selected")).toContainText("m3");
  await page.keyboard.press("1");
  await expect(page.getByRole("tab", { name: "モデリング" })).toHaveAttribute("aria-selected", "true");
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
  await page.getByText("ロープ経路", { exact: true }).click();
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
  await page.getByText("枠の構成", { exact: true }).click();
  await page.getByRole("button", { name: "奥に1区画つなぐ", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("12節点 / 20部材");
  await page.getByRole("button", { name: "↶ 元に戻す", exact: true }).click();
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
  await expect(page.locator("#status")).toContainText("計算完了");
  await page.getByRole("button", { name: "下書きを復元", exact: true }).click();
  await expect(page.locator("#counts")).toContainText("1丸材");
  await page.getByLabel("節点（3D図でも選択可）").selectOption("n6");
  await page.getByRole("button", { name: "+X", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#nx")).toHaveValue("1.4");
  await page.getByRole("button", { name: "↔ 移動", exact: true }).click();
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
  await page.getByRole("button", { name: "↔ 移動", exact: true }).click();
  const node = project(new THREE.Vector3(1.4, 1.2, 1));
  await page.mouse.move(node.x, node.y - 28);
  await page.mouse.down();
  await page.mouse.move(node.x, node.y - 78, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#ny")).toHaveValue("1.2");
  await expect(page.locator("#nx")).toHaveValue("1.4");
  await expect(page.locator("#nz")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "↶ 元に戻す", exact: true })).toBeDisabled();
});

test("female addition from a selected male stacks outside and preserves rope space", async ({ page }) => {
  await ready(page);
  await page.getByText("選択した部材・形状", { exact: true }).click();
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await page.getByRole("button", { name: "▣ 雌材", exact: true }).click();
  await page.getByLabel("追加する長さ比", { exact: true }).fill("1");
  await page.getByRole("button", { name: "選択節点から部材を追加", exact: true }).click();
  await expect(page.locator("#member-layer")).toHaveValue("2");
  await expect(page.locator("#counts")).toContainText("9節点 / 13部材");
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await page.getByLabel("追加方向", { exact: true }).selectOption("z");
  await page.getByRole("button", { name: "選択節点から部材を追加", exact: true }).click();
  await expect(page.locator("#member-layer")).toHaveValue("3");
  await page.getByLabel("部材", { exact: true }).selectOption("m3");
  await page.getByLabel("追加方向", { exact: true }).selectOption("-y");
  await page.getByLabel("追加する長さ比", { exact: true }).fill("0.7");
  await page.getByRole("button", { name: "選択節点から部材を追加", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ロープ用");
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
  await page.getByText("ロープ経路", { exact: true }).click();
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
