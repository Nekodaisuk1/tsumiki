import { expect, test } from "@playwright/test";
import { createDrawingDesign } from "../src/structure/editor";

test("explores beam stations, load stages and local hole/tenon FEM", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  const d = createDrawingDesign("male-1200");
  d.nodes[0].fixed = true;
  d.nodes[1].fixed = false;
  const length = d.nodes[1].position[0] - d.nodes[0].position[0];
  d.nodes[0].position = [0, 0, 0];
  d.nodes[1].position = [0, length, 0];
  await page.locator("#file").setInputFiles({
    name: "cantilever.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  await page.getByRole("tab", { name: "シミュレーション" }).click();
  await page.getByRole("tab", { name: "荷重のプロパティ" }).click();
  await page.locator("#timber-support").selectOption("fixed");
  await page.locator("#timber-axis").selectOption("x");
  await page.locator("#timber-force").fill("-100");
  await page.locator("#timber-weight").uncheck();
  await page.locator("#timber-run").click();
  await expect(page.locator("#stress-diagrams svg")).toHaveCount(4);
  await page.locator("#stress-position").fill("0");
  await expect(page.locator("#stress-value")).toContainText("位置 0.0 mm");
  const root = await page.locator("#stress-value").textContent();
  await page.locator("#stress-position").fill("1000");
  await expect(page.locator("#stress-value")).not.toHaveText(root ?? "");
  await expect(page.locator("#stress-value")).toContainText("最大 |σ| 0.000 MPa");
  await page.locator("#timber-ramp").fill("50");
  await expect(page.locator("#timber-ramp-status")).toContainText("50%：-50.0 N");
  await page.locator("#timber-ramp-play").click();
  await expect(page.locator("#timber-ramp-status")).toContainText("100%：-100.0 N", { timeout: 20000 });
  await page.locator("#stress-position").fill("0");
  await page.screenshot({ path: "/tmp/tsumiki-stress-distribution.png" });
  await page.locator("#stress-local").click();
  await expect(page.locator(".local-fem-dialog")).toBeVisible();
  await expect(page.locator("#local-kind")).toHaveValue("tenon");
  await page.locator("#local-run").click();
  await expect(page.locator("#local-result")).toContainText("要素");
  await page.locator("#local-kind").selectOption("hole");
  await expect(page.locator("#local-save")).toBeDisabled();
  await page.locator("#local-run").click();
  await expect(page.locator("#local-result")).toContainText("反力");
  await page.screenshot({ path: "/tmp/tsumiki-local-hole.png" });
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const audit = await new AxeBuilder({ page }).include(".local-fem-dialog").analyze();
  expect(audit.violations).toEqual([]);
  await page.locator("#local-mode").selectOption("pin");
  await page.locator("#local-run").click();
  await expect(page.locator("#local-result")).toContainText("要素");
  const downloading = page.waitForEvent("download");
  await page.locator("#local-save").click();
  const download = await downloading;
  const stream = await download.createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString());
  expect(report.applied[1]).toBeGreaterThan(0);
  expect(report.freeResidual).toBeLessThan(0.001);
  expect(report.settings.mode).toBe("pin");
  await page.locator("#local-close").click();
  await page.locator("#timber-force").fill("-200");
  await page.locator("#timber-force").press("Tab");
  await expect(page.locator("#timber-distribution")).toBeHidden();
  await expect(page.locator("#timber-ramp-play")).toBeDisabled();
  expect(errors).toEqual([]);
});
