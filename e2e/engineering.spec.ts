import { expect, test } from "@playwright/test";
import { createDrawingDesign } from "../src/structure/editor";

test("calculates SI timber response, exports reproducible inputs, and invalidates changed loads", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const d = createDrawingDesign("male-1200");
  const l = d.nodes[1].position[0] - d.nodes[0].position[0];
  d.nodes[0].position = [0, 0, 0];
  d.nodes[1].position = [0, l, 0];
  await page.locator("#file").setInputFiles({
    name: "column.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  await page.getByRole("tab", { name: "シミュレーション" }).click();
  await page.getByRole("tab", { name: "荷重のプロパティ" }).click();
  await page.locator("#timber-support").selectOption("fixed");
  await page.locator("#timber-force").fill("-100");
  await page.locator("#timber-axis").selectOption("x");
  await page.locator("#timber-run").click();
  await expect(page.locator("#timber-output")).toContainText("最大変位");
  await expect(page.locator("#timber-output tbody tr")).toHaveCount(1);
  await expect(page.locator("#timber-show")).toBeChecked();
  await expect(page.locator("#viewer-title")).toContainText("実寸");
  await expect(page.locator("#play")).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.locator("#timber-report").click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString());
  expect(report.settings.forceN).toBe(-100);
  expect(report.design.version).toBe(6);
  expect(report.maxDisplacementMm).toBeGreaterThan(0);
  expect(report.totalMassKg).toBeGreaterThan(0);
  await expect(page.locator("#timber-total-weight")).toContainText(`${report.totalMassKg.toFixed(2)} kg`);
  await page.screenshot({ path: "test-results/timber-analysis.png" });
  await page.locator("#timber-force").fill("-200");
  await page.locator("#timber-force").press("Tab");
  await expect(page.locator("#timber-report")).toBeDisabled();
  await expect(page.locator("#timber-show")).not.toBeChecked();
  await page.locator("#timber-run").click();
  await expect(page.locator("#timber-output")).toContainText("-200 N");
  expect(errors).toEqual([]);
});

test("defaults to self-weight on a frictional floor without manually freeing nodes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "シミュレーション" }).click();
  await page.getByRole("tab", { name: "荷重のプロパティ" }).click();
  await expect(page.locator("#timber-support")).toHaveValue("floor");
  await expect(page.locator("#timber-force")).toHaveValue("0");
  await page.locator("#timber-run").click();
  await expect(page.locator("#timber-output")).toContainText("固定なし・接点");
  await expect(page.locator("#timber-output")).toContainText("地面の垂直反力");
  await page.locator("#timber-friction").fill("0");
  await page.locator("#timber-axis").selectOption("x");
  await page.locator("#timber-force").fill("100");
  await page.locator("#timber-run").click();
  await expect(page.locator("#timber-output")).toContainText("静止状態を求められません");
  await expect(page.locator("#timber-show")).not.toBeChecked();
});
