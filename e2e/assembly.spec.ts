import { expect, test } from "@playwright/test";

test("analyzes, numbers, plays and downloads the assembly video", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#assembly-open").click();
  await expect(page.locator("#assembly-status")).toContainText("1部材の組立順が見つかりました");
  await expect(page.locator("#assembly-steps li")).toHaveCount(1);
  await expect(page.locator("#assembly-caption")).toContainText("1. m0");
  await page.locator("#assembly-play").click();
  await expect.poll(async () => Number(await page.locator("#assembly-time").inputValue())).toBeGreaterThan(0);
  await page.locator("#assembly-overview").click();
  await expect(page.locator("#assembly-time")).toHaveValue("1");
  await page.screenshot({ path: "/tmp/tsumiki-assembly-overview.png" });
  const pending = page.waitForEvent("download");
  await page.locator("#assembly-video").click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("assembly.webm");
  const stream = await download.createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks);
  expect(data.length).toBeGreaterThan(10000);
  expect(data.readUInt32BE(0)).toBe(0x1a45dfa3);
  const dimensions = await page.evaluate(async (base64) => {
    const video = document.createElement("video");
    video.src = `data:video/webm;base64,${base64}`;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Invalid video"));
    });
    video.currentTime = 0.8;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Missing canvas");
    ctx.drawImage(video, 0, 0);
    const pixels = ctx.getImageData(0, 60, canvas.width, 550).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
          Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
        30
      )
        colored++;
    return { width: video.videoWidth, height: video.videoHeight, colored };
  }, data.toString("base64"));
  expect(dimensions.width).toBe(1280);
  expect(dimensions.height).toBe(720);
  expect(dimensions.colored).toBeGreaterThan(100);
  const jsonDownload = page.waitForEvent("download");
  await page.locator("#assembly-json").click();
  expect((await jsonDownload).suggestedFilename()).toBe("assembly-steps.json");
  await page.locator("#assembly-close").click();
  await expect(page.locator(".assembly-dialog")).not.toBeVisible();
  await page.locator("#assembly-open").click();
  await expect(page.locator("#assembly-status")).toContainText("1部材");
  await page.locator("#assembly-close").click();
  expect(errors).toEqual([]);
});

test("completes the bridge and shows held members in the assembly view", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator("#file").setInputFiles("tests/fixtures/assembly-bridge.json");
  await page.locator("#assembly-open").click();
  await expect(page.locator("#assembly-status")).toContainText("45部材の組立順が見つかりました", {
    timeout: 30000,
  });
  await expect(page.locator("#assembly-steps li")).toHaveCount(45);
  const pending = page.waitForEvent("download");
  await page.locator("#assembly-json").click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const { plan } = JSON.parse(Buffer.concat(chunks).toString());
  const heldIndex = plan.steps.findIndex((step: { temporarySupport?: boolean }) => step.temporarySupport);
  expect(heldIndex).toBeGreaterThanOrEqual(0);
  await page.locator("#assembly-steps li button").nth(heldIndex).click();
  await expect(page.locator("#assembly-caption")).toContainText(
    `${heldIndex + 1}. ${plan.steps[heldIndex].id}`,
  );
  await expect(page.locator("#assembly-support")).toContainText(plan.steps[heldIndex].id);
  await expect(page.locator("#assembly-support")).toContainText("仮支えを継続");
  await page.screenshot({ path: "/tmp/tsumiki-assembly-bridge-held.png" });
  await page.locator("#assembly-overview").click();
  await expect(page.locator("#assembly-support")).toContainText("仮支え対象なし");
  await page.screenshot({ path: "/tmp/tsumiki-assembly-bridge-complete.png" });
  const video = page.waitForEvent("download", { timeout: 90000 });
  await page.locator("#assembly-video").click();
  const download = await video;
  expect(download.suggestedFilename()).toBe("assembly.webm");
  await download.saveAs("/tmp/tsumiki-assembly-bridge.webm");
  await expect(page.locator("#assembly-time")).toHaveValue("45");
  expect(errors).toEqual([]);
});

test("edits, validates, saves and restores a manual order in the third workspace", async ({ page }) => {
  const { createDrawingDesign, insertMaleAtHole, appendMember } = await import("../src/structure/editor");
  const { catalogPart } = await import("../src/structure/catalog");
  const design = createDrawingDesign();
  const male = insertMaleAtHole(design, "m0", 4, catalogPart("male-1200").span, 1);
  const part = catalogPart("female-1200-round");
  appendMember(design, male.nodeId, "female", [1, 0, 0], part.span, part.id);
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "manual.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(design)),
  });
  await page.getByRole("tab", { name: "組立手順" }).click();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(page.locator("#assembly-open")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#assembly-status")).toContainText("3部材の組立順");
  await page.locator("#assembly-copy").click();
  await expect(page.locator("#assembly-manual-list li")).toHaveCount(3);
  const original = await page.locator("#assembly-order-input").inputValue();
  const download = page.waitForEvent("download");
  await page.locator("#assembly-manual-save").click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const saved = Buffer.concat(chunks);
  await page.locator("#assembly-manual-list input").nth(2).fill("2");
  await page.locator("#assembly-validate").click();
  await expect(page.locator("#assembly-notes")).toContainText("両端");
  await expect(page.locator("#assembly-steps li")).toHaveCount(2);
  await page
    .locator("#assembly-order-file")
    .setInputFiles({ name: "steps.json", mimeType: "application/json", buffer: saved });
  await expect(page.locator("#assembly-order-input")).toHaveValue(original);
  await page.locator("#assembly-validate").click();
  await expect(page.locator("#assembly-status")).toContainText("3部材の組立順");
  await page.getByRole("tab", { name: "シミュレーション" }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator(".assembly-window")).not.toBeVisible();
  await page.getByRole("tab", { name: "組立手順" }).click();
  await expect(page.locator("#assembly-order-input")).toHaveValue(original);
  await page.locator("#assembly-order-input").fill("m0,m0");
  await page.locator("#assembly-apply").click();
  await expect(page.locator("#assembly-manual-status")).toContainText("重複");
  await page.locator("#assembly-order-input").fill(original);
  await page.locator("#assembly-apply").click();
  await page.locator("#assembly-validate").click();
  await expect(page.locator("#assembly-status")).toContainText("3部材の組立順");
  await page.screenshot({ path: "/tmp/tsumiki-assembly-manual.png" });
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const audit = await new AxeBuilder({ page }).include(".assembly-window").analyze();
  expect(audit.violations).toEqual([]);
});
