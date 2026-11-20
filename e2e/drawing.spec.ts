import { expect, test } from "@playwright/test";

test("uses drawing dimensions, inserts catalog members, and preserves the profile in a file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("#drawing-info")).toContainText("105mm");
  await expect(page.locator("#counts")).toContainText("2節点 / 1部材");
  await page.locator("#hole-female").selectOption("m0");
  await page.locator("#male-catalog").selectOption("male-2400");
  await expect(page.locator("#male-length")).toHaveValue("2.07");
  await expect(page.locator("#insert-male")).toBeEnabled();
  await page.locator("#insert-male").click();
  await expect(page.locator("#counts")).toContainText("4節点 / 2部材");
  await page.locator("#palette-female").click();
  await page.locator("#female-catalog").selectOption("female-1200-round");
  await page.locator('.dir-button[data-dir="x"]').click();
  await expect(page.locator("#quick-add")).toBeEnabled();
  await page.locator("#quick-add").click();
  await expect(page.locator("#counts")).toContainText("5節点 / 3部材");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  const data = JSON.parse(buffer.toString());
  expect(data.version).toBe(6);
  expect(data.geometry.holeSize).toBe(0.039);
  expect(data.geometry.tenonLength).toBe(0.165);
  expect(data.members[2].catalogId).toBe("female-1200-round");
  await page
    .locator("#file")
    .setInputFiles({ name: "drawing.tsumiki.json", mimeType: "application/json", buffer });
  await expect(page.locator("#counts")).toContainText("5節点 / 3部材");
  await page.locator("#fit").click();
  await page.screenshot({ path: "test-results/hitoto-assembly.png" });
  expect(errors).toEqual([]);
});

test("shows the rounded-end drawing and rejects an undersized corner radius at insertion", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#drawing-start").selectOption("female-2400-round");
  await page.locator("#new-design").click();
  await page.locator("#top").click();
  await page.locator("#nodes-visible").uncheck();
  await page.screenshot({ path: "test-results/hitoto-round-board.png" });
  await page.locator("#tenon-radius").fill("0");
  await page.locator("#apply-tenon-radius").click();
  await expect(page.locator("#insert-male")).toBeDisabled();
  await expect(page.locator("#male-preview-status")).toContainText("丸穴");
  await page.locator("#tenon-radius").fill("6.3");
  await page.locator("#apply-tenon-radius").click();
  await expect(page.locator("#insert-male")).toBeEnabled();
});
