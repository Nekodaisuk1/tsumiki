import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("splitter is not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}
const width = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().width);
const height = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().height);

test("pane boundaries resize by dragging and keyboard, persist, and reset", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const sidebar = page.locator("#sidebar");
  const outliner = page.locator("#outliner-pane");
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toBeVisible();

  const side = page.getByRole("separator", { name: "サイドバーの幅" });
  const before = await width(sidebar);
  const canvasBefore = await width(canvas);
  await drag(page, side, -160, 0);
  expect(await width(sidebar)).toBeCloseTo(before + 160, -1);
  // The 3D canvas follows the narrower view.
  await expect.poll(() => width(canvas)).toBeLessThan(canvasBefore - 100);

  // The view keeps a usable minimum however far the boundary is dragged.
  await drag(page, side, -2000, 0);
  expect(await width(page.locator(".viewer"))).toBeGreaterThanOrEqual(320);

  const outlinerSplit = page.getByRole("separator", { name: "アウトライナーの高さ" });
  const outlinerBefore = await height(outliner);
  await drag(page, outlinerSplit, 0, 120);
  expect(await height(outliner)).toBeCloseTo(outlinerBefore + 120, -1);

  await side.focus();
  const sideNow = await width(sidebar);
  await page.keyboard.press("ArrowRight");
  expect(await width(sidebar)).toBeCloseTo(sideNow - 16, 0);
  await expect(side).toHaveAttribute("aria-valuenow", String(Math.round(await width(sidebar))));

  await page.getByRole("tab", { name: "シミュレーション" }).click();
  const timeline = page.locator("#response");
  const time = page.getByRole("separator", { name: "タイムラインの高さ" });
  await expect(time).toBeVisible();
  const timeBefore = await height(timeline);
  await drag(page, time, 0, -100);
  expect(await height(timeline)).toBeCloseTo(timeBefore + 100, -1);
  // Narrow timeline content stays inside the pane.
  expect(await timeline.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);

  const stored = await page.evaluate(() => localStorage.getItem("tsumiki-layout-v1"));
  await page.reload();
  await expect(canvas).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tsumiki-layout-v1"))).toBe(stored);
  expect(await width(sidebar)).toBeCloseTo(sideNow - 16, 0);

  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);

  await side.dblclick();
  expect(await width(sidebar)).toBeCloseTo(340, 0);
});

test("narrow sidebar keeps property fields inside the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("#viewport canvas")).toBeVisible();
  await drag(page, page.getByRole("separator", { name: "サイドバーの幅" }), 400, 0);
  const sidebar = page.locator("#sidebar");
  expect(await width(sidebar)).toBeCloseTo(240, 0);
  const pages = page.locator(".prop-pages");
  expect(await pages.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/layout-narrow-sidebar.png" });
});
