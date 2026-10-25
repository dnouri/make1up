import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

type Point = readonly [number, number];
const runtimeErrors = new WeakMap<Page, string[]>();
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), "No unhandled application errors").toEqual([]);
});

async function openStudio(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
}

async function png(page: Page, info: TestInfo, name: string): Promise<Uint8Array> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const download = await pending;
  await download.saveAs(info.outputPath(`${name}.png`));
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("The exported portrait PNG is unavailable.");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(Uint8Array.from(chunk));
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([1080, 1350]);
  return bytes;
}

function samePNG(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function rgbDifference(page: Page, before: string, after: string): Promise<number> {
  return page.evaluate(async ({ before, after }) => {
    const read = async (encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("The PNG comparison canvas is unavailable.");
      context.drawImage(bitmap, 0, 0); bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [a, b] = await Promise.all([read(before), read(after)]);
    let difference = 0;
    for (let offset = 0; offset < a.length; offset += 4) {
      for (let channel = 0; channel < 3; channel += 1) difference += Math.abs(a[offset + channel]! - b[offset + channel]!);
    }
    return difference;
  }, { before, after });
}

async function stroke(page: Page, info: TestInfo, from: Point, to: Point, passes = 1): Promise<void> {
  const canvas = page.locator("#portrait-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("The portrait canvas is missing.");
  const span = Math.max(0.5, 0.32 / (bounds.width / bounds.height));
  const cameraY = Math.max(0.282, span / 2 + 0.032);
  const project = ([x, y]: Point) => ({
    x: bounds.x + bounds.width / 2 + x / span * bounds.height,
    y: bounds.y + bounds.height / 2 - (y - cameraY) / span * bounds.height,
  });
  const start = project(from);
  const end = project(to);
  if (info.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const contact = { ...start, radiusX: 3, radiusY: 3, force: 1, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact] });
      for (let pass = 0; pass < passes; pass += 1) {
        const a = pass % 2 === 0 ? start : end;
        const b = pass % 2 === 0 ? end : start;
        for (let step = 1; step <= 6; step += 1) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
            ...contact, x: a.x + (b.x - a.x) * step / 6, y: a.y + (b.y - a.y) * step / 6,
          }] });
        }
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let pass = 0; pass < passes; pass += 1) {
      const target = pass % 2 === 0 ? end : start;
      await page.mouse.move(target.x, target.y, { steps: 6 });
    }
    await page.mouse.up();
    await page.mouse.move(2, 2);
  }
}

async function selectBlend(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Blend existing makeup", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Strength", exact: true })).toHaveValue("0.7");
  await expect(page.locator("#brush-opacity-value")).toHaveText("70%");
  await expect(page.getByRole("slider", { name: "Opacity", exact: true })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Brush size", exact: true })).toHaveValue("0.04");
  await expect(page.getByRole("button", { name: "Ink color", exact: true })).toBeDisabled();
  await expect(page.locator("[data-color]:enabled")).toHaveCount(0);
  await expect(page.getByLabel("Custom makeup color", { exact: true })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Gloss", exact: true })).toBeDisabled();
  await expect(page.locator("#tool-description")).toHaveText("Soften existing makeup edges. More passes build the effect. No added color.");
  await expect(page.locator("#canvas-help")).toHaveText("Blend existing makeup. Anywhere on the paintable face. Move over existing makeup to soften its edges. More passes increase the effect.");
}

const stripe = { from: [0.065, 0.252] as Point, to: [0.08, 0.252] as Point };

test("four passes in one native Blend gesture soften an Ink stripe more than one, with exact history and shared replay", async ({ page }, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Liner", exact: true }).click();
  await page.getByRole("button", { name: "Ink color", exact: true }).click();
  await stroke(page, info, stripe.from, stripe.to);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  const baseline = await png(page, info, "ink-baseline");
  await selectBlend(page);
  await stroke(page, info, stripe.from, stripe.to);
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  const once = await png(page, info, "one-pass");
  expect(samePNG(once, baseline), "One pass changes the actual export").toBe(false);
  const oneDifference = await rgbDifference(page, base64(baseline), base64(once));
  expect(oneDifference).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(samePNG(await png(page, info, "one-pass-undone"), baseline), "Undo restores every baseline PNG byte").toBe(true);

  await stroke(page, info, stripe.from, stripe.to, 4);
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  const four = await png(page, info, "four-passes");
  expect(samePNG(four, once), "Repeated travel changes exported pixels within one gesture").toBe(false);
  const fourDifference = await rgbDifference(page, base64(baseline), base64(four));
  expect(fourDifference, "Four passes have more total RGB effect than one pass").toBeGreaterThan(oneDifference);
  await info.attach("pass-effect", { body: JSON.stringify({ oneDifference, fourDifference }), contentType: "application/json" });
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(samePNG(await png(page, info, "four-passes-undone"), baseline)).toBe(true);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  expect(samePNG(await png(page, info, "four-passes-redone"), four), "Redo restores every blended PNG byte").toBe(true);

  await page.getByRole("button", { name: "Share look", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Made to be remixed." })).toBeVisible();
  const url = await page.getByLabel("Private remix link", { exact: true }).inputValue();
  const match = /^#make1up=v1\.([dj])\.([A-Za-z0-9_-]+)$/.exec(new URL(url).hash);
  if (match === null) throw new Error("The Blend share link has an unsupported envelope.");
  const encoded = match[2]!.replace(/-/g, "+").replace(/_/g, "/");
  const payload = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
  const text = match[1] === "d"
    ? await page.evaluate(async (compressed) => {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
      return await new Response(stream).text();
    }, payload)
    : new TextDecoder().decode(payload);
  const document: { version: number; strokes: { brush: { tool: string }; policy: string; algorithm?: string }[] } = JSON.parse(text);
  expect(document.version).toBe(3);
  expect(document.strokes.map((item) => [item.brush.tool, item.policy, item.algorithm ?? null])).toEqual([
    ["liner", "face-v2", null], ["blend", "face-v2", "soften-v1"],
  ]);
  await page.goto(url);
  await expect(page.locator("#app-status")).toHaveText("Shared look opened. These are the original UV strokes, ready for your remix.");
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  expect(samePNG(await png(page, info, "shared-blend"), four)).toBe(true);
  await page.reload();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  expect(samePNG(await png(page, info, "reloaded-blend"), four), "Reload replays the tagged document byte exactly").toBe(true);
});

for (const fixture of [
  { name: "broad blush", tool: "Blush", radius: "0.045" },
  { name: "narrow liner", tool: "Liner", radius: "0.006" },
]) {
  test(`Strength 0.2, default 0.7, and 1 give different effects on ${fixture.name} with the same Blend radius`, async ({ page }, info) => {
    await openStudio(page);
    await page.getByRole("button", { name: fixture.tool, exact: true }).click();
    await page.getByRole("button", { name: "Ink color", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Brush size", exact: true })).toHaveValue(fixture.radius);
    await stroke(page, info, stripe.from, stripe.to);
    await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
    const baseline = await png(page, info, "strength-baseline");
    const results: { bytes: Uint8Array; difference: number }[] = [];
    for (const strength of ["0.2", "0.7", "1"]) {
      await selectBlend(page);
      const slider = page.getByRole("slider", { name: "Strength", exact: true });
      if (strength === "0.2") {
        await slider.focus();
        await page.keyboard.press("Home");
        for (let step = 0; step < 20; step += 1) await page.keyboard.press("ArrowRight");
      } else if (strength === "1") {
        await slider.focus();
        await page.keyboard.press("End");
      }
      await expect(slider).toHaveValue(strength);
      await stroke(page, info, [0.07, 0.238], [0.07, 0.267]);
      await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
      const bytes = await png(page, info, `strength-${strength}`);
      expect(samePNG(bytes, baseline), `Strength ${strength} changes existing ${fixture.name}`).toBe(false);
      results.push({ bytes, difference: await rgbDifference(page, base64(baseline), base64(bytes)) });
      await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
      await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
      expect(samePNG(await png(page, info, `strength-${strength}-undone`), baseline)).toBe(true);
    }
    expect(samePNG(results[1]!.bytes, results[0]!.bytes)).toBe(false);
    expect(samePNG(results[2]!.bytes, results[1]!.bytes)).toBe(false);
    expect(results[0]!.difference).toBeGreaterThan(0);
    expect(results[1]!.difference).toBeGreaterThan(results[0]!.difference);
    expect(results[2]!.difference).toBeGreaterThan(results[1]!.difference);
    await info.attach("strength-effect", {
      body: JSON.stringify(results.map(({ difference }) => difference)), contentType: "application/json",
    });
  });
}
