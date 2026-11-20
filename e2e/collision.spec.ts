import { expect, test } from "@playwright/test";
import { createDesign } from "../src/structure/design";

test("rejects colliding edits and imports without changing the current design", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "legacy.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createDesign())),
  });
  await expect(page.locator("#counts")).toContainText("8節点 / 12部材");
  await page.getByRole("tab", { name: "節点のプロパティ" }).click();
  await page.locator("#node").selectOption("n6");
  await page.getByRole("button", { name: "+X", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#nx")).toHaveValue("1.4");
  const d = createDesign();
  d.members[8].layer = 0;
  await page.locator("#file").setInputFiles({
    name: "collision.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  await expect(page.getByRole("alert")).toContainText("干渉");
  await expect(page.locator("#counts")).toContainText("8節点 / 12部材");
});

test("previews a valid hole insertion and disables a colliding insertion", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "legacy.tsumiki.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createDesign())),
  });
  await page.locator("#hole-female").selectOption("m4");
  await expect(page.locator("#insert-male")).toBeEnabled();
  await page.locator("#male-side").selectOption("-1");
  await page.locator("#male-length").fill("2");
  await page.locator("#male-length").dispatchEvent("change");
  await expect(page.locator("#insert-male")).toBeDisabled();
  await expect(page.locator("#male-preview-status")).toContainText("干渉");
  await page.locator("#male-side").selectOption("1");
  await expect(page.locator("#insert-male")).toBeEnabled();
  await page.locator("#insert-male").click();
  await expect(page.locator("#counts")).toContainText("10節点 / 13部材");
});
