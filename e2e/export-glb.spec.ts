import { expect, test } from "@playwright/test";

test("downloads a metre-scale GLB with mesh geometry and no editor helpers", async ({ page }) => {
  await page.goto("/");
  const pending = page.waitForEvent("download");
  await page.locator("#export-glb").click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  await download.saveAs("test-results/blender-export.glb");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks);
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  expect(data.readUInt32LE(4)).toBe(2);
  expect(data.readUInt32LE(8)).toBe(data.length);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  expect(json.meshes).toHaveLength(1);
  expect(json.nodes.some((n: { name: string }) => n.name === "m0_female-2400-square")).toBe(true);
  expect(json.scenes[0].extras.units).toBe("metres");
  expect(json.cameras).toBeUndefined();
  await expect(page.locator("#status")).toContainText("GLBを書き出しました");
  await expect(page.locator("#export-glb")).toBeEnabled();
});
