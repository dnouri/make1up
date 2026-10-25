import { chromium, expect, test } from "@playwright/test";
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
  await expect(page.getByRole("heading", { name: "MAKE1UP", exact: true })).toBeVisible();
}

async function guidedApply(page: Page, tool: string, color: string): Promise<void> {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await page.getByRole("button", { name: `${color} color`, exact: true }).click();
  const apply = page.getByRole("button", { name: "Guided apply", exact: true });
  await apply.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await apply.click();
}

async function cheekPoint(page: Page, scroll = true): Promise<{ x: number; y: number; distance: number }> {
  const target = page.locator("#portrait-canvas");
  if (scroll) await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const bounds = await target.boundingBox();
  if (bounds === null) throw new Error("The actual portrait canvas is missing.");
  const span = Math.max(0.5, 0.32 / (bounds.width / bounds.height));
  const cameraY = Math.max(0.282, span / 2 + 0.032);
  return {
    x: bounds.x + bounds.width / 2 + (0.065 / span) * bounds.height,
    y: bounds.y + bounds.height / 2 - ((0.252 - cameraY) / span) * bounds.height,
    distance: (0.015 / span) * bounds.height,
  };
}

async function drawCheek(page: Page, info: TestInfo, cancel = false, scroll = true): Promise<void> {
  const point = await cheekPoint(page, scroll);
  await page.screenshot({ path: info.outputPath(cancel ? "before-pointer-cancel.png" : "before-direct-stroke.png") });
  if (info.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const contact = { x: point.x, y: point.y, radiusX: 3, radiusY: 3, force: 1, id: 1 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...contact, x: point.x + point.distance / 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...contact, x: point.x + point.distance }] });
    await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + point.distance, point.y, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(2, 2);
  }
}

async function downloadPNG(page: Page, info: TestInfo, name: string): Promise<Uint8Array> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^MAKE1UP-[a-z-]+-\d{2}\.png$/);
  const path = info.outputPath(name);
  await download.saveAs(path);
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("The downloaded PNG is unavailable.");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(Uint8Array.from(chunk));
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([1080, 1350]);
  return bytes;
}

async function chooseSession(page: Page, mode: "challenge" | "practice", duration: "0" | "3" | "5", theme?: string): Promise<void> {
  await page.getByRole("button", { name: /Change\s*brief/ }).click();
  if (theme !== undefined) await page.locator(`input[name="theme"][value="${theme}"]`).check();
  await page.getByRole("combobox", { name: "Your session", exact: true }).selectOption(mode);
  if (mode === "challenge") await page.getByRole("combobox", { name: "Optional timer", exact: true }).selectOption(duration);
  await page.getByRole("button", { name: "Apply brief", exact: true }).click();
}

test("a fresh face, real mouse or touch strokes, history, clear, and keyboard tools", async ({ page }, info) => {
  await openStudio(page);
  await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeInViewport({ ratio: 1 });
  if (info.project.name === "desktop") {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("compact-desktop-studio.png") });
    if (viewport !== null) await page.setViewportSize(viewport);
  }
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await expect(page.getByRole("button", { name: "Mirror on", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("initial-studio.png"), fullPage: true });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the portrait", exact: true })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to the portrait", exact: true })).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page.locator("#portrait-canvas")).toBeFocused();
  await drawCheek(page, info);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.locator("#portrait-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.keyboard.press("4");
  await expect(page.getByRole("button", { name: "Liner", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("7");
  await expect(page.getByRole("button", { name: "Blend existing makeup", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Start with clean skin?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Clear makeup", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.getByRole("button", { name: "Turn", exact: true }).click();
  await drawCheek(page, info);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.getByRole("button", { name: "Paint", exact: true }).click();
  await page.screenshot({ path: info.outputPath("direct-stroke-history.png"), fullPage: true });
});

test("phone correction stays beside the portrait through precision work and finishing", async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, "This is the phone editing continuity check.");
  await openStudio(page);
  await page.getByRole("button", { name: "Customize portrait", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const initialScroll = await page.evaluate(() => scrollY);
  expect(initialScroll).toBe(0);
  const quickSize = page.getByRole("slider", { name: "Quick brush size", exact: true });
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  const redo = page.getByRole("button", { name: "Redo last edit", exact: true });
  const assertWorkspace = async () => {
    for (const control of [quickSize, undo, redo, page.getByRole("button", { name: "Clear", exact: true }), page.locator("#quick-active-tool"), page.locator("#allowed-region"), page.locator(".view-bar"), page.locator("#portrait-stage"), page.getByRole("button", { name: "Finish look", exact: true })]) {
      await expect(control).toHaveCount(1);
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    for (const control of await page.locator('[data-tool], [data-navigation], [data-frame], #mirror-button, #before-button, #zoom-in, #zoom-out, #undo-button, #redo-button, #clear-button, #quick-brush-size, #finish-button').all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return target !== null && element.contains(target);
      }), "Every required editing control has an unobstructed touch target").toBe(true);
    }
    expect(await page.evaluate(() => {
      const stage = document.querySelector("#portrait-stage")!.getBoundingClientRect();
      const views = document.querySelector(".view-bar")!.getBoundingClientRect();
      const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return ["#correction-bar", "#finish-bar"].some((selector) => {
        const dock = document.querySelector(selector)!.getBoundingClientRect();
        return overlaps(stage, dock) || overlaps(views, dock);
      });
    }), "Neither dock covers the portrait or its view controls").toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.evaluate(() => scrollY), "Painting and correction do not move the page").toBe(initialScroll);
  };
  await assertWorkspace();
  await expect(page.locator("#quick-active-tool")).toHaveText("Blush");
  await expect(page.locator("#allowed-region")).toHaveText("Anywhere on the paintable face");
  await page.screenshot({ path: info.outputPath("continuity-initial.png") });
  await quickSize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("slider", { name: "Brush size", exact: true })).toHaveValue("0.046");
  await expect(page.locator("#quick-brush-size-value")).toHaveText("4.6%");
  await drawCheek(page, info, false, false);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await assertWorkspace();
  await undo.click();
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await assertWorkspace();
  await redo.click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await assertWorkspace();
  await page.getByRole("button", { name: "Liner", exact: true }).click();
  await expect(page.locator("#quick-active-tool")).toHaveText("Liner");
  await expect(page.locator("#allowed-region")).toHaveText("Anywhere on the paintable face");
  await expect(quickSize).toHaveValue("0.006");
  for (const framing of ["Eyes", "Lips"]) {
    await page.getByRole("button", { name: framing, exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await assertWorkspace();
    for (const decoration of [".cover-type", ".cover-footer", ".stage-side-note"]) await expect(page.locator(decoration)).toBeHidden();
    await page.screenshot({ path: info.outputPath(`continuity-${framing.toLowerCase()}.png`) });
  }
  await page.getByRole("button", { name: "Face", exact: true }).click();
  await assertWorkspace();
  await page.screenshot({ path: info.outputPath("continuity-correction.png") });
  await page.getByRole("button", { name: "Finish look", exact: true }).click();
  await expect(page.locator("#result-panel")).toBeVisible();
  await expect(page.locator("#portrait-stage")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("brief-score")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#correction-bar")).toBeHidden();
  await expect(page.locator("#finish-bar")).toBeHidden();
  expect(await page.getByTestId("brief-score").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return target !== null && element.contains(target);
  }), "The finished score is not behind a message or a dock").toBe(true);
  const stage = await page.locator("#portrait-stage").boundingBox();
  expect(stage?.height).toBeGreaterThanOrEqual(info.project.name === "phone" ? 300 : 180);
  await page.screenshot({ path: info.outputPath("continuity-finished-portrait-and-score.png") });
});

test("precision framing removes decorative type and keeps the brief outside the canvas", async ({ page }) => {
  await openStudio(page);
  for (const framing of ["Eyes", "Lips"]) {
    await page.getByRole("button", { name: framing, exact: true }).click();
    await expect(page.locator("#portrait-stage")).toHaveAttribute("data-framing", framing.toLowerCase());
    await expect(page.locator("#theme-title")).toBeVisible();
    for (const decoration of [".cover-type", ".cover-footer", ".stage-side-note"]) await expect(page.locator(decoration)).toBeHidden();
  }
});

test("both size controls follow the same active brush", async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, "The compact brush control is for phone layouts.");
  await openStudio(page);
  const quick = page.getByRole("slider", { name: "Quick brush size", exact: true });
  const full = page.getByRole("slider", { name: "Brush size", exact: true });
  await quick.focus();
  await page.keyboard.press("End");
  await expect(full).toHaveValue("0.08");
  await expect(page.locator("#brush-size-value")).toHaveText("8.0%");
  await full.focus();
  await page.keyboard.press("Home");
  await expect(quick).toHaveValue("0.003");
  await expect(page.locator("#quick-brush-size-value")).toHaveText("0.3%");
  await page.getByRole("button", { name: "Liner", exact: true }).click();
  await expect(full).toHaveValue("0.006");
  await expect(quick).toHaveValue("0.006");
  await expect(page.locator("#quick-brush-size-value")).toHaveText("0.6%");
});

test("default Guided lipstick paints the upper and lower lips as one undoable gesture", async ({ page }, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Lipstick", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Brush size", exact: true })).toHaveValue("0.055");
  await expect(page.locator("#brush-size-value")).toHaveText("5.5%");
  if (info.project.use.hasTouch) {
    await expect(page.getByRole("slider", { name: "Quick brush size", exact: true })).toHaveValue("0.055");
    await expect(page.locator("#quick-brush-size-value")).toHaveText("5.5%");
  }
  await page.getByRole("button", { name: "Plum color", exact: true }).click();
  const bare = await downloadPNG(page, info, "default-lip-bare.png");
  await page.getByRole("button", { name: "Guided apply", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  const painted = await downloadPNG(page, info, "default-lip-painted.png");
  const coverage = await page.evaluate(async ({ before, after }) => {
    const read = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("The PNG comparison canvas is unavailable.");
      context.drawImage(bitmap, 0, 0); bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const fromBytes = (data: number[]) => new Blob([Uint8Array.from(data)], { type: "image/png" });
    const [a, b, mask, asset] = await Promise.all([
      read(fromBytes(before)), read(fromBytes(after)),
      fetch("face/v2/masks/lips.png").then((response) => response.blob()).then(read),
      fetch("face/v2/asset.json").then((response) => response.json()),
    ]);
    const halves = { upper: { samples: 0, changed: 0 }, lower: { samples: 0, changed: 0 } };
    const projection = asset.paintAtlas.paint.projection;
    const split = asset.paintAtlas.landmarks.lipsCenter.paintUV[1];
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (mask.data[(y * mask.width + x) * 4]! < 128) continue;
        const u = (x + 0.5) / mask.width;
        const v = (y + 0.5) / mask.height;
        const localX = projection.xMin + u * (projection.xMax - projection.xMin);
        const localY = projection.yMax - v * (projection.yMax - projection.yMin);
        const px = Math.round(a.width / 2 + localX / 0.5 * a.height);
        const py = Math.round(a.height / 2 - (localY - 0.282) / 0.5 * a.height);
        const offset = (py * a.width + px) * 4;
        const half = v < split ? halves.upper : halves.lower;
        half.samples += 1;
        if ([0, 1, 2].some((channel) => Math.abs(a.data[offset + channel]! - b.data[offset + channel]!) >= 3)) half.changed += 1;
      }
    }
    return Object.fromEntries(Object.entries(halves).map(([name, half]) => [name, { ...half, fraction: half.changed / half.samples }]));
  }, { before: Array.from(bare), after: Array.from(painted) });
  await info.attach("actual-export-lip-coverage", { body: JSON.stringify(coverage, null, 2), contentType: "application/json" });
  for (const [half, evidence] of Object.entries(coverage)) {
    expect(evidence.samples, `The real mask contains ${half} lip samples`).toBeGreaterThan(100);
    expect(evidence.fraction, `Guided lipstick visibly colors the actual ${half} lip`).toBeGreaterThan(0.85);
  }
  await page.getByRole("button", { name: "Lips", exact: true }).click();
  await page.screenshot({ path: info.outputPath("default-lip-close-up.png") });
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  expect(await downloadPNG(page, info, "default-lip-undone.png")).toEqual(bare);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(await downloadPNG(page, info, "default-lip-redone.png")).toEqual(painted);
});

test("three complete solo rounds publish their match criteria and lock finished looks", async ({ page }, info) => {
  await openStudio(page);
  const rounds = [
    { title: "Orchid hour", eye: "Orchid", lip: "Plum" },
    { title: "Graphic night", eye: "Ink", lip: "Pearl" },
    { title: "Rose editorial", eye: "Rose", lip: "Coral" },
  ];
  for (const [index, round] of rounds.entries()) {
    await expect(page.locator("#theme-title")).toHaveText(round.title);
    await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
    if (index === 2) await guidedApply(page, "Blush", "Rose");
    else await guidedApply(page, "Eyeshadow", round.eye);
    await guidedApply(page, "Lipstick", round.lip);
    if (index === 1) {
      await page.getByRole("slider", { name: "Gloss", exact: true }).focus();
      await page.keyboard.press("Home");
      await page.getByRole("button", { name: "Guided apply", exact: true }).click();
    }
    const gestures = index === 1 ? "3 gestures" : "2 gestures";
    await expect(page.locator("#gesture-count")).toHaveText(gestures);
    if (index === 0) {
      await page.getByRole("button", { name: "Before / after", exact: true }).click();
      await expect(page.locator("#before-badge")).toBeVisible();
    }
    await page.getByRole("button", { name: "Finish look", exact: true }).click();
    await expect(page.locator("#result-panel")).toBeVisible();
    await expect(page.locator("#result-summary")).toContainText("Solo brief match");
    await expect(page.locator("#result-summary")).toContainText("not a beauty score");
    await expect(page.locator("#result-evidence summary")).toHaveCount(4);
    if (index === 0) {
      await expect(page.getByTestId("brief-score")).toHaveText("100 / 100");
      await drawCheek(page, info);
      await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
      await expect(page.getByTestId("brief-score")).toHaveText("100 / 100");
    }
    await expect(page.getByRole("button", { name: "Lipstick", exact: true, includeHidden: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`round-${index + 1}-result.png`), fullPage: true });
    if (index < 2) await page.getByRole("button", { name: "Next brief", exact: true }).click();
  }
  await page.getByRole("button", { name: "Remix this look", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeEnabled();
});

test("local save survives reload, restores paint, exports a real PNG, and opens a private remix", async ({ page }, info) => {
  await openStudio(page);
  await guidedApply(page, "Blush", "Coral");
  await drawCheek(page, info);
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await page.getByRole("button", { name: "Customize portrait", exact: true }).click();
  await page.getByRole("group", { name: "Iris color", exact: true }).getByRole("radio", { name: "Olive", exact: true }).check();
  await page.getByRole("group", { name: "Complexion", exact: true }).getByRole("radio", { name: "Deep", exact: true }).check();
  await page.getByRole("group", { name: "Hair color", exact: true }).getByRole("radio", { name: "Plum", exact: true }).check();
  await page.getByRole("group", { name: "Hairstyle", exact: true }).getByRole("radio", { name: "Crown bun", exact: true }).check();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const originalPNG = await downloadPNG(page, info, "original-look.png");
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#app-status")).toHaveText("Saved to your lookbook on this device.");
  await expect(page.locator("#saved-count")).toHaveText("1");
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#app-status")).toHaveText("This exact look is already in your lookbook.");
  await page.reload();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await page.getByRole("button", { name: "Open lookbook", exact: true }).click();
  await expect(page.locator(".saved-look")).toHaveCount(1);
  const preview = page.locator(".saved-look img");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(220);
  await page.screenshot({ path: info.outputPath("saved-lookbook.png"), fullPage: true });
  await page.getByRole("button", { name: "Open Orchid hour 01, saved look 1", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  const restoredPNG = await downloadPNG(page, info, "restored-look.png");
  expect(restoredPNG.length === originalPNG.length && restoredPNG.every((byte, index) => byte === originalPNG[index]), "Restored strokes and appearance produce the same actual portrait export").toBe(true);
  await page.getByRole("button", { name: "Share look", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Made to be remixed." })).toBeVisible();
  const url = await page.getByLabel("Private remix link", { exact: true }).inputValue();
  expect(new URL(url).hash).toMatch(/^#make1up=v1\.[dj]\./);
  await page.goto(url);
  await expect(page.getByRole("dialog", { name: "Made to be remixed." })).toBeHidden();
  await page.reload();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await guidedApply(page, "Lipstick", "Rose");
  await expect(page.locator("#gesture-count")).toHaveText("3 gestures");
  await page.evaluate(() => { location.hash = "make1up=v1.d.broken"; });
  await expect(page.locator("#app-status")).toContainText("share link");
  await expect(page.locator("#gesture-count")).toHaveText("3 gestures");
  await page.screenshot({ path: info.outputPath("shared-remix.png"), fullPage: true });
});

test("the local lookbook count refreshes when another tab changes saved looks", async ({ page, context }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#saved-count")).toHaveText("1");
  const other = await context.newPage();
  try {
    await other.goto("./");
    const saved = await other.evaluate(() => localStorage.getItem("make1up.lookbook.v2"));
    expect(saved).not.toBeNull();
    await page.getByRole("button", { name: "Open lookbook", exact: true }).click();
    await expect(page.locator(".saved-look")).toHaveCount(1);
    await other.evaluate(() => localStorage.removeItem("make1up.lookbook.v2"));
    await expect(page.locator("#saved-count")).toHaveText("0");
    await expect(page.locator("#lookbook-content")).toContainText("Your first cover belongs here.");
    await other.evaluate((value) => localStorage.setItem("make1up.lookbook.v2", value!), saved);
    await expect(page.locator("#saved-count")).toHaveText("1");
    await expect(page.locator(".saved-look")).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test("three and five minute choices are explicit, expiry locks, and practice has no timer or score", async ({ page }, info) => {
  await openStudio(page);
  await guidedApply(page, "Blush", "Rose");
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await chooseSession(page, "challenge", "3", "rose-editorial");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await expect(page.locator("#clock")).toHaveText("3:00 remaining");
  await page.clock.fastForward(181_000);
  await page.clock.fastForward(1000);
  await expect(page.locator("#result-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Blush", exact: true, includeHidden: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remix this look", exact: true }).click();
  await chooseSession(page, "challenge", "5");
  await expect(page.locator("#clock")).toHaveText("5:00 remaining");
  await chooseSession(page, "practice", "0");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await expect(page.locator("#clock")).toHaveText("No timer. No brief score.");
  await page.clock.fastForward(360_000);
  await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Finish look", exact: true }).click();
  await page.clock.fastForward(1000);
  await expect(page.locator("#result-panel")).toBeVisible();
  await expect(page.locator("#result-summary")).toHaveText("No clock. No score. Just a look you made. Save it to your lookbook, or keep experimenting.");
  await expect(page.getByTestId("brief-score")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("practice-result.png"), fullPage: true });
});

test("native touch cancellation records nothing and the next completed gesture works", async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, "Native touch is covered by the phone and landscape projects.");
  await openStudio(page);
  await drawCheek(page, info, true);
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await drawCheek(page, info);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.getByRole("button", { name: "Finish look", exact: true }).click();
  await expect(page.locator("#result-panel")).toBeVisible();
});

test("an older capture cannot save over a newer edit", async ({ page }) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (this.width === 1080 && this.height === 1350) {
        encode.call(this, (blob) => { window.setTimeout(() => callback(blob), 1500); }, type, quality);
      } else encode.call(this, callback, type, quality);
    };
  });
  await openStudio(page);
  await guidedApply(page, "Blush", "Rose");
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save look", exact: true })).toHaveAttribute("aria-busy", "true");
  await guidedApply(page, "Lipstick", "Plum");
  await expect(page.locator("#app-status")).toHaveText("The look changed before saving finished. Nothing was replaced. Save again to keep the latest look.");
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await expect(page.locator("#saved-count")).toHaveText("0");
  await page.getByRole("button", { name: "Open lookbook", exact: true }).click();
  await expect(page.locator("#lookbook-content")).toContainText("Your first cover belongs here.");
});

test("corrupt storage and quota failures explain the problem without losing makeup", async ({ page }, info) => {
  await page.addInitScript(() => { localStorage.setItem("make1up.lookbook.v2", "{broken"); });
  await openStudio(page);
  await page.getByRole("button", { name: "Open lookbook", exact: true }).click();
  await expect(page.locator("#lookbook-content")).toContainText("The local lookbook is damaged.");
  await page.keyboard.press("Escape");
  await guidedApply(page, "Lipstick", "Plum");
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#app-status")).toContainText("The local lookbook is damaged.");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  expect(await page.evaluate(() => localStorage.getItem("make1up.lookbook.v2"))).toBe("{broken");
  await page.evaluate(() => {
    localStorage.removeItem("make1up.lookbook.v2");
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "make1up.lookbook.v2") throw new DOMException("The quota was exceeded", "QuotaExceededError");
      write.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#app-status")).toContainText("Storage may be full or blocked.");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await downloadPNG(page, info, "storage-failure-fallback.png");
});

test("local font failure and an offline runtime still permit a complete look and PNG", async ({ page, baseURL }, info) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL!).origin) remoteRequests.push(request.url()); });
  await page.route("**/fonts/*.woff2", (route) => route.abort());
  await openStudio(page);
  expect(await page.evaluate(() => document.fonts.check('600 20px "Bodoni Moda"'))).toBe(false);
  await expect(page.getByRole("heading", { name: "MAKE1UP", exact: true })).toBeVisible();
  await page.context().setOffline(true);
  try {
    await drawCheek(page, info);
    await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
    await page.getByRole("button", { name: "Finish look", exact: true }).click();
    await expect(page.locator("#result-panel")).toBeVisible();
    await downloadPNG(page, info, "offline-look.png");
    expect(remoteRequests).toEqual([]);
    await page.screenshot({ path: info.outputPath("offline-font-fallback.png"), fullPage: true });
  } finally {
    await page.context().setOffline(false);
  }
});

test("a WebGL-disabled browser gives a support view and keeps the asset credit reachable", async ({ baseURL }, info) => {
  const browser = await chromium.launch({ args: ["--disable-webgl"] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      baseURL: baseURL ?? "http://127.0.0.1:4173",
      viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
      isMobile: Boolean(info.project.use.isMobile), hasTouch: Boolean(info.project.use.hasTouch),
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("./");
    await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "error", { timeout: 30_000 });
    await expect(page.locator("#stage-message-copy")).toHaveText("This browser could not start WebGL. Try a current browser with hardware acceleration enabled.");
    await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Portrait asset credit", exact: true }).click();
    await expect(page.locator("#credits-dialog")).toContainText("This is a modified, licensed Rain derivative. It is not AI-generated.");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("an unavailable portrait has a readable recovery view rather than a blank canvas", async ({ page }) => {
  await page.route("**/face/v2/head.glb", (route) => route.abort());
  await page.goto("./");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "The portrait could not open.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish look", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download PNG", exact: true })).toBeDisabled();
});
