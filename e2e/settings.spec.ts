import { expect, test } from "@playwright/test";

test("independent settings window synchronizes, persists, searches and resets preferences", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const popup = page.waitForEvent("popup");
  await page.locator("#settings-open").click();
  const settings = await popup;
  settings.on("pageerror", (error) => errors.push(error.message));
  await expect(settings).toHaveTitle("設定 — tsumiki");
  await settings.locator("#setting-theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await settings.locator("#setting-snap").selectOption("0.25");
  await expect(page.locator("#snap")).toHaveValue("0.25");
  await page.locator("#surface-mode").selectOption("wood");
  await expect(settings.locator("#setting-surface")).toHaveValue("wood");
  await settings.locator("#setting-nodes").uncheck();
  await expect(page.locator("#nodes-visible")).not.toBeChecked();
  await settings.locator("#setting-quality").selectOption("low");
  await settings.locator("#setting-cursorZoom").check();
  await settings.locator("#setting-reducedMotion").check();
  await settings.locator("#setting-assemblySpeed").selectOption("5");
  await page.reload();
  await expect(page.locator("#snap")).toHaveValue("0.25");
  await expect(page.locator("#surface-mode")).toHaveValue("wood");
  await page.locator("#settings-open").click();
  expect(context.pages()).toHaveLength(2);
  await settings.locator("#search").fill("ズーム");
  await expect(settings.locator("main section:visible")).toHaveCount(1);
  await settings.locator("#search").fill("");
  await settings.screenshot({ path: "test-results/settings-window.png", fullPage: true });
  settings.on("dialog", (dialog) => dialog.accept());
  await settings.locator("#reset-all").click();
  await expect(page.locator("#snap")).toHaveValue("0.1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.locator("#close").click();
  await expect.poll(() => settings.isClosed()).toBe(true);
  expect(errors).toEqual([]);
});

test("draft controls preserve data when disabled and synchronize deletion", async ({ page }) => {
  await page.goto("/");
  await page.locator("#new-design").click();
  const original = await page.evaluate(() => localStorage.getItem("tsumiki-design-draft-v2"));
  expect(original).not.toBeNull();
  const pending = page.waitForEvent("popup");
  await page.locator("#settings-open").click();
  const settings = await pending;
  await settings.locator("#setting-autosave").uncheck();
  await expect(page.locator("#draft-status")).toContainText("OFF");
  await page.locator("#new-design").click();
  expect(await page.evaluate(() => localStorage.getItem("tsumiki-design-draft-v2"))).toBe(original);
  await page.reload();
  await expect(page.locator(".recovery-notice")).toBeVisible();
  settings.on("dialog", (dialog) => dialog.accept());
  await settings.getByRole("button", { name: "下書きを削除" }).click();
  await expect(page.locator("#recover")).toBeDisabled();
  await expect(settings.locator("#draft-info")).toContainText("ありません");
});

test("visual settings preview, cancel and save synchronize without changing the design", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const pending = page.waitForEvent("popup");
  await page.locator("#settings-open").click();
  const settings = await pending;
  settings.on("pageerror", (error) => errors.push(error.message));
  const open = settings.getByRole("button", { name: "文字・色・線の見やすさ設定", exact: true });
  await open.click();
  await settings.locator('[data-key="theme"]').selectOption("light");
  await expect(settings.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(settings.locator("html")).toHaveAttribute("data-theme", "dark");
  await open.click();
  await settings.locator('[data-key="largeText"]').check();
  await settings.getByRole("button", { name: "次へ", exact: true }).click();
  await settings.locator('[data-key="palette"]').selectOption("okabe-ito");
  await settings.locator('[data-key="color"]').selectOption("layer");
  await expect(settings.locator("#visual-legend")).toContainText("4段");
  await settings
    .getByRole("button", { name: "色だけでは区別しにくい・違いが分からない", exact: true })
    .click();
  await expect(settings.locator('[data-key="layerLabels"]')).toBeChecked();
  await settings.locator('[data-key="boldSelection"]').check();
  await expect(settings.locator("#visual-preview canvas")).toBeVisible();
  await settings.screenshot({ path: "test-results/visual-settings.png", fullPage: true });
  await settings.getByRole("button", { name: "保存して終了", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "okabe-ito");
  await expect(page.locator("html")).toHaveAttribute("data-large-text", "true");
  await expect(page.locator("#layer-legend")).toContainText("4段");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "okabe-ito");
  await open.click();
  await settings.keyboard.press("Escape");
  await expect(settings.locator("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});
