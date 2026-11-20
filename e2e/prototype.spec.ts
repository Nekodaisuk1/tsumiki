import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("orthogonal joints are the default without invented clearance or free motion", async ({ page }) => {
  await page.goto("/rope.html");
  await expect(page.locator("#angle-value")).toHaveText("90.0°");
  await expect(page.locator("#angle")).toBeDisabled();
  await expect(page.locator("#run")).toBeDisabled();
  await page.locator("#winding").fill("0.3");
  await expect(page.locator("#angle-value")).toHaveText("90.0°");
  await expect(page.locator("#tension")).toHaveText("2.400");
  await expect(page.locator("#joint-note")).toContainText("遊びの量は未確定");
});

test("conditions, relaxation, force visibility, reset and rectangular comparison", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/rope.html");
  await expect(page.getByRole("heading", { name: "ロープで、枠はどう動く？" })).toBeVisible();
  await page.getByLabel("接合の扱い").selectOption("free");
  await expect(page.locator("#angle-value")).toHaveText("65.0°");
  await expect(page.locator(".force-arrow")).toHaveCount(4);
  await page.getByLabel("力の向き").uncheck();
  await expect(page.locator(".force-arrow")).toHaveCount(0);
  await page.getByLabel("力の向き").check();
  await page.getByRole("button", { name: "動きを試す" }).click();
  await expect.poll(async () => Number(await page.locator("#angle").inputValue())).toBeLessThan(64);
  await page.getByRole("button", { name: "停止する" }).click();
  await page.getByRole("button", { name: "初期化" }).click();
  await expect(page.locator("#angle")).toHaveValue("65");
  await page.getByRole("button", { name: "90°に配置して比較" }).click();
  await expect(page.locator("#angle-value")).toHaveText("90.0°");
  await expect(page.locator("#mode-status")).toContainText("巻き取りによる整形の結果ではありません");
  await page.locator("#winding").fill("0");
  await expect(page.locator("#tension")).toHaveText("0.000");
  await expect(page.locator("#rope-state")).toHaveText("たるみ / 無張力");
  await page.getByRole("button", { name: "初期化" }).click();
  await page.screenshot({ path: "test-results/prototype-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("observation persists and exports reproducible conditions", async ({ page }) => {
  await page.goto("/rope.html");
  await page.getByLabel("観察メモ").fill("実物では突出部の裏側を通る。");
  await page.reload();
  await expect(page.getByLabel("観察メモ")).toHaveValue("実物では突出部の裏側を通る。");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "実験記録を保存" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tsumiki-rope-.*\.md$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain("rope-routing-v2");
  expect(text).toContain('"jointMode": "orthogonal"');
  expect(text).toContain('"baseline"');
  expect(text).toContain("実物では突出部の裏側を通る。");
});

test("desktop and mobile have no overflow or automated WCAG A/AA violations", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/rope.html");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  }
  await page.screenshot({ path: "test-results/prototype-mobile.png", fullPage: true });
});
