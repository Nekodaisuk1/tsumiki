import { expect, test } from "@playwright/test";

test("wood mode is opt-in and embeds shared PBR textures only in textured exports", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#surface-mode")).toHaveValue("plain");
  const readExport = async () => {
    const pending = page.waitForEvent("download");
    await page.locator("#export-glb").click();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    return JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  };
  expect((await readExport()).images).toBeUndefined();
  await page.locator("#surface-mode").selectOption("wood");
  const wood = await readExport();
  expect(wood.images).toHaveLength(3);
  expect(wood.images[0].bufferView).toBeDefined();
  expect(wood.materials[0].pbrMetallicRoughness.baseColorTexture).toBeDefined();
  expect(wood.materials[0].normalTexture).toBeDefined();
  expect(wood.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();
  await page.locator("#front").click();
  await page.locator("#viewport canvas").hover();
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/wood-mode.png" });
  await page.locator("#color-layer").click();
  await page.locator("#color-material").click();
  await page.locator("#surface-mode").selectOption("plain");
  expect((await readExport()).images).toBeUndefined();
  expect(errors).toEqual([]);
});
