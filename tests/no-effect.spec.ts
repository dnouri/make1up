import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

const runtimeErrors = new WeakMap<Page, string[]>();

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
  await download.saveAs(info.outputPath(name));
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("The portrait PNG was not downloaded.");
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

async function draw(
  page: Page,
  info: TestInfo,
  name: string,
  framing: "face" | "eyes",
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  const canvas = page.locator("#portrait-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("The portrait canvas is missing.");
  const frame = framing === "face" ? { y: 0.282, span: 0.5, width: 0.32 } : { y: 0.312, span: 0.215, width: 0.2 };
  const span = Math.max(frame.span, frame.width / (bounds.width / bounds.height));
  const cameraY = framing === "face" ? Math.max(frame.y, span / 2 + 0.032) : frame.y;
  const project = ([x, y]: readonly [number, number]) => ({
    x: bounds.x + bounds.width / 2 + x / span * bounds.height,
    y: bounds.y + bounds.height / 2 - (y - cameraY) / span * bounds.height,
  });
  const start = project(from);
  const end = project(to);
  await page.screenshot({ path: info.outputPath(`${name}-before.png`) });
  if (info.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const contact = { ...start, radiusX: 3, radiusY: 3, force: 1, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact] });
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
          ...contact, x: start.x + (end.x - start.x) * step / 6, y: start.y + (end.y - start.y) * step / 6,
        }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(2, 2);
  }
  await page.screenshot({ path: info.outputPath(`${name}-after.png`) });
}

async function rangeEnd(page: Page, name: string, end: "Home" | "End"): Promise<void> {
  await page.getByRole("slider", { name, exact: true }).focus();
  await page.keyboard.press(end);
}

async function expectNoHistory(page: Page): Promise<void> {
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled();
}

test("forehead lipstick in Eyes changes neither PNG nor history, while the same brush paints lips", async ({ page }, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Lipstick", exact: true }).click();
  await page.getByRole("button", { name: "Eyes", exact: true }).click();
  await page.getByRole("button", { name: "Ink color", exact: true }).click();
  await rangeEnd(page, "Opacity", "End");
  await rangeEnd(page, "Softness", "Home");
  const before = await png(page, info, "bare-before.png");
  await draw(page, info, "forehead-lipstick", "eyes", [-0.018, 0.365], [0.019, 0.365]);
  await expect(page.locator("#app-status")).toHaveText("Lipstick changed no makeup on the lips.");
  const after = await png(page, info, "forehead-after.png");
  expect(samePNG(after, before), "Forehead lipstick leaves every exported PNG byte unchanged").toBe(true);
  await expectNoHistory(page);

  await page.getByRole("button", { name: "Face", exact: true }).click();
  await draw(page, info, "positive-lips", "face", [-0.018, 0.211], [0.019, 0.211]);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  const painted = await png(page, info, "lips-painted.png");
  expect(samePNG(painted, before), "The same brush visibly paints lips").toBe(false);
});

test("forehead lipstick after Undo preserves the bare PNG and Redo restores the exact cheek paint", async ({ page }, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Ink color", exact: true }).click();
  await rangeEnd(page, "Opacity", "End");
  await rangeEnd(page, "Softness", "Home");
  const before = await png(page, info, "bare-before.png");
  await draw(page, info, "positive-cheek", "face", [0.065, 0.252], [0.08, 0.252]);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  const painted = await png(page, info, "cheek-painted.png");
  expect(samePNG(painted, before), "The positive control visibly paints cheeks").toBe(false);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expectNoHistory(page);
  await expect(page.getByRole("button", { name: "Redo last edit", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Lipstick", exact: true }).click();
  await page.getByRole("button", { name: "Eyes", exact: true }).click();
  await draw(page, info, "forehead-after-undo", "eyes", [-0.018, 0.365], [0.019, 0.365]);
  await expectNoHistory(page);
  await expect(page.getByRole("button", { name: "Redo last edit", exact: true })).toBeEnabled();
  expect(samePNG(await png(page, info, "bare-after-noop.png"), before), "Undo and the rejected stroke restore every bare PNG byte").toBe(true);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(samePNG(await png(page, info, "cheek-redo.png"), painted), "Redo restores every painted PNG byte").toBe(true);
});

for (const tool of ["Blush", "Eyeshadow"]) {
  test(`${tool} paints the forehead with exact Undo and Redo export bytes`, async ({ page }, info) => {
    await openStudio(page);
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.getByRole("button", { name: "Eyes", exact: true }).click();
    await page.getByRole("button", { name: "Ink color", exact: true }).click();
    await rangeEnd(page, "Opacity", "End");
    await rangeEnd(page, "Softness", "Home");
    await expect(page.locator("#allowed-region")).toHaveText("Anywhere on the paintable face");
    const before = await png(page, info, "full-face-before.png");
    await draw(page, info, "forehead-color", "eyes", [-0.018, 0.365], [0.019, 0.365]);
    await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
    const painted = await png(page, info, "full-face-painted.png");
    expect(samePNG(painted, before), `${tool} visibly paints outside its historical region`).toBe(false);
    await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
    await expectNoHistory(page);
    expect(samePNG(await png(page, info, "full-face-undone.png"), before)).toBe(true);
    await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
    await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
    expect(samePNG(await png(page, info, "full-face-redone.png"), painted)).toBe(true);
  });
}

test("zero-opacity pointer and Guided apply add no history or success, then one guided gesture undoes and redoes", async ({ page }, info) => {
  await openStudio(page);
  const before = await png(page, info, "opacity-bare.png");
  await rangeEnd(page, "Opacity", "Home");
  await draw(page, info, "zero-opacity-cheek", "face", [0.065, 0.252], [0.08, 0.252]);
  await expectNoHistory(page);
  await page.getByRole("button", { name: "Guided apply", exact: true }).click();
  await expectNoHistory(page);
  await expect(page.locator("#app-status")).toContainText("changed no makeup");
  await expect(page.locator("#app-status")).not.toContainText("applied as one undoable gesture");
  expect(samePNG(await png(page, info, "opacity-noop.png"), before)).toBe(true);

  await rangeEnd(page, "Opacity", "End");
  await page.getByRole("button", { name: "Guided apply", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  const painted = await png(page, info, "guided-visible.png");
  expect(samePNG(painted, before)).toBe(false);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expectNoHistory(page);
  expect(samePNG(await png(page, info, "guided-undone.png"), before)).toBe(true);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(samePNG(await png(page, info, "guided-redone.png"), painted)).toBe(true);
});

for (const [name, tool] of [["erase", "Erase makeup"], ["blend", "Blend existing makeup"]] as const) {
  test(`${tool} on bare skin changes neither PNG nor history, while correction over paint does`, async ({ page }, info) => {
    await openStudio(page);
    const before = await png(page, info, "correction-bare.png");
    await page.getByRole("button", { name: tool, exact: true }).click();
    await draw(page, info, `bare-${name}`, "face", [0.065, 0.252], [0.08, 0.252]);
    await expectNoHistory(page);
    expect(samePNG(await png(page, info, `${name}-no-effect.png`), before), "Bare-skin correction leaves every PNG byte unchanged").toBe(true);

    await page.getByRole("button", { name: "Liner", exact: true }).click();
    await draw(page, info, "liner-control", "face", [0.065, 0.252], [0.08, 0.252]);
    await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
    const painted = await png(page, info, "before-correction.png");
    expect(samePNG(painted, before), "A narrow Liner stroke gives correction a visible paint edge").toBe(false);
    await page.getByRole("button", { name: tool, exact: true }).click();
    await draw(page, info, `${name}-control`, "face", [0.065, 0.252], [0.08, 0.252]);
    await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
    expect(samePNG(await png(page, info, "corrected.png"), painted), "The same correction tool visibly changes existing paint").toBe(false);
  });
}
