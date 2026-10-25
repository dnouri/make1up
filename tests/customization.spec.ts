import { expect, test } from "@playwright/test";
import type { JSHandle, Locator, Page } from "@playwright/test";

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(runtimeErrors.get(page)).toEqual([]));

async function open(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

async function customize(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Customize portrait", exact: true }).click();
  await expect(page.locator("#studio")).toHaveAttribute("data-workspace", "customize");
  await expect(page.getByRole("heading", { name: "Customize portrait", exact: true })).toBeFocused();
}

function choice(page: Page, group: string, name: string): Locator {
  return page.getByRole("group", { name: group, exact: true }).getByRole("radio", { name, exact: true });
}

async function frame(page: Page): Promise<JSHandle<Uint8Array>> {
  return page.evaluateHandle(() => new Promise<Uint8Array>((resolve, reject) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#portrait-canvas")!;
    canvas.dispatchEvent(new Event("pointerleave"));
    requestAnimationFrame(() => {
      const gl = canvas.getContext("webgl2");
      if (gl === null) { reject(new Error("The live WebGL context is unavailable.")); return; }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (!pixels.some((byte) => byte !== 0)) { reject(new Error("The live portrait was not rendered.")); return; }
      resolve(pixels);
    });
  }));
}

async function changedPixels(page: Page, first: JSHandle<Uint8Array>, second: JSHandle<Uint8Array>): Promise<number> {
  return page.evaluate(([a, b]) => {
    if (a.length !== b.length) throw new Error("The portrait dimensions changed.");
    let count = 0;
    for (let offset = 0; offset < a.length; offset += 4) {
      if ([0, 1, 2].some((channel) => Math.abs(a[offset + channel]! - b[offset + channel]!) >= 3)) count++;
    }
    return count;
  }, [first, second] as const);
}

async function turn(page: Page): Promise<void> {
  const canvas = page.locator("#portrait-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.55;
  const y = bounds.y + bounds.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 32, y + 14, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(2, 2);
}

async function unobstructed(target: Locator): Promise<void> {
  await expect(target).toBeInViewport({ ratio: 1 });
  expect(await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return bounds.width >= 44 && bounds.height >= 44 && hit !== null && element.contains(hit);
  }), "The control has an unobstructed target of at least 44 px").toBe(true);
}

const viewports = [
  { name: "desktop", project: "desktop", width: 1440, height: 1000 },
  { name: "compact desktop", project: "desktop", width: 1280, height: 720 },
  { name: "portrait phone", project: "phone", width: 390, height: 844 },
  { name: "small portrait phone", project: "phone", width: 320, height: 568 },
  { name: "landscape phone", project: "landscape", width: 844, height: 390 },
] as const;

for (const viewport of viewports) test(`the same canvas stays fully visible while controls scroll at ${viewport.width} by ${viewport.height}`, async ({ page }, info) => {
  test.skip(info.project.name !== viewport.project, "Each required viewport runs in its matching input context.");
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await open(page);
  const canvas = await page.evaluateHandle(() => document.querySelector<HTMLCanvasElement>("#portrait-canvas")!);
  const gl = await canvas.evaluateHandle((element) => element.getContext("webgl2"));
  const parent = await page.locator("#portrait-stage").evaluateHandle((element) => element.parentElement);
  await customize(page);
  await expect(page.getByRole("group")).toHaveCount(8);
  await expect(page.locator(".appearance-section, #appearance-fields select")).toHaveCount(0);
  await expect(page.locator("#app canvas")).toHaveCount(1);
  const measure = () => page.evaluate(() => ({
    scrollY, scrollX, bodyScroll: document.body.scrollTop,
    stage: document.querySelector("#portrait-stage")!.getBoundingClientRect().toJSON(),
    viewbar: document.querySelector(".view-bar")!.getBoundingClientRect().toJSON(),
    controlsScroll: document.querySelector("#customization-controls")!.scrollTop,
    workScroll: document.querySelector(".work-area")!.scrollTop,
    studioScroll: document.querySelector("#studio")!.scrollTop,
  }));
  const initial = await measure();
  await page.screenshot({ path: info.outputPath(`${viewport.width}x${viewport.height}-customize-top.png`) });
  const bun = choice(page, "Hairstyle", "Crown bun");
  await bun.check();
  await expect(page.locator("#customization-undo")).toBeEnabled();
  const panel = (await page.locator("#customization-controls").boundingBox())!;
  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect.poll(async () => (await measure()).controlsScroll).toBeGreaterThan(0);
  const after = await measure();
  expect(after.stage).toEqual(initial.stage);
  expect(after.viewbar).toEqual(initial.viewbar);
  expect([after.scrollY, after.scrollX, after.bodyScroll, after.workScroll, after.studioScroll]).toEqual([initial.scrollY, initial.scrollX, initial.bodyScroll, 0, 0]);
  for (const target of [page.locator("#portrait-stage"), page.locator(".view-bar"), page.locator("#customization-controls"), page.locator("#customization-footer")]) await expect(target).toBeInViewport({ ratio: 1 });
  for (const selector of [".site-header", ".site-footer", ".tool-rail", ".cosmetics-panel", ".brief-bar", ".stage-top-controls", ".framing-controls", "#before-button", "#finish-bar", ".cover-type", ".cover-footer", ".stage-side-note", "#toast"]) await expect(page.locator(selector)).toBeHidden();
  for (const target of [bun.locator(".."), choice(page, "Hairstyle", "Ponytail").locator(".."), page.locator("#zoom-in"), page.locator("#zoom-out"), page.locator("#stage-credits"), page.locator("#customization-undo"), page.locator("#customization-redo"), page.locator("#customization-done")]) await unobstructed(target);
  expect(await page.evaluate(() => {
    const footer = document.querySelector("#customization-footer")!.getBoundingClientRect();
    const stage = document.querySelector("#portrait-stage")!.getBoundingClientRect();
    const views = document.querySelector(".view-bar")!.getBoundingClientRect();
    const panel = document.querySelector("#customization-controls")!.getBoundingClientRect();
    return document.documentElement.scrollWidth <= innerWidth
      && document.documentElement.scrollHeight === innerHeight
      && Math.max(stage.bottom, views.bottom, panel.bottom) <= footer.top;
  }), "No document scroll, horizontal overflow, or footer overlap").toBe(true);
  const retained = () => page.evaluate(({ canvas, gl, parent }) => canvas === document.querySelector("#portrait-canvas")
    && gl !== null && canvas.getContext("webgl2") === gl && !gl.isContextLost()
    && document.querySelector("#portrait-stage")!.parentElement === parent, { canvas, gl, parent });
  expect(await retained(), "Entry retains the canvas, context, and stage parent").toBe(true);
  await page.screenshot({ path: info.outputPath(`${viewport.width}x${viewport.height}-customize-scrolled.png`) });
  await info.attach("layout-measurements", { body: JSON.stringify({ viewport, initial, after }, null, 2), contentType: "application/json" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#customize-button")).toBeFocused();
  expect(await retained(), "Done retains the canvas, context, and stage parent").toBe(true);
  await page.locator("#appearance-hairStyle-bun").evaluate((element) => element.focus());
  await expect(page.locator("#customize-button")).toBeFocused();
});

test("a bun changes live portrait pixels and shares one Undo and Redo history", async ({ page }, info) => {
  await open(page);
  await customize(page);
  await expect(page.locator("#customization-undo")).toBeDisabled();
  const original = await frame(page);
  await choice(page, "Hairstyle", "Crown bun").check();
  const bun = await frame(page);
  expect(await changedPixels(page, original, bun), "The actual live hairstyle changes").toBeGreaterThan(50);
  await page.locator("#customization-undo").click();
  await expect(choice(page, "Hairstyle", "Ponytail")).toBeChecked();
  expect(await changedPixels(page, original, await frame(page))).toBe(0);
  await expect(page.locator("#customization-undo")).toBeDisabled();
  await page.locator("#customization-redo").click();
  await expect(choice(page, "Hairstyle", "Crown bun")).toBeChecked();
  expect(await changedPixels(page, bun, await frame(page))).toBe(0);
  await expect(page.locator("#studio")).toHaveAttribute("data-workspace", "customize");
  await page.screenshot({ path: info.outputPath("bun-redone-in-workspace.png") });
});

test("Done and Escape restore focus, page scroll, brush, framing, turn, pitch, and zoom", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "Liner", exact: true }).click();
  await page.getByRole("button", { name: "Mirror on", exact: true }).click();
  await page.getByRole("button", { name: "Eyes", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Turn", exact: true }).click();
  await page.screenshot({ path: info.outputPath("makeup-view-before-turn.png") });
  await turn(page);
  const original = await frame(page);
  await page.getByRole("button", { name: "Before / after", exact: true }).click();
  expect(await changedPixels(page, original, await frame(page)), "Read-only before view does not reset the camera").toBe(0);
  for (const exit of ["Done", "Escape"]) {
    await page.evaluate(() => scrollTo(0, Math.min(100, document.documentElement.scrollHeight - innerHeight)));
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await customize(page);
    await expect(page.locator("#portrait-stage")).toHaveAttribute("data-framing", "face");
    await expect(page.locator("#customization-undo")).toBeDisabled();
    await page.keyboard.press("3");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`customize-before-${exit.toLowerCase()}-turn.png`) });
    await turn(page);
    await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
    await expect(page.locator("#customization-undo")).toBeDisabled();
    if (exit === "Done") await page.getByRole("button", { name: "Done", exact: true }).click();
    else {
      await choice(page, "Face shape", "Balanced").focus();
      await page.keyboard.press("Escape");
    }
    await expect(page.locator("#customize-button")).toBeFocused();
    await expect(page.locator("#studio")).toHaveAttribute("data-workspace", "makeup");
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
    await expect(page.getByRole("button", { name: "Eyes", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Turn", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Mirror off", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#before-badge")).toBeHidden();
    await expect(page.locator("#active-tool")).toHaveText("Liner");
    await expect(page.locator("#brush-size")).toHaveValue("0.006");
    expect(await changedPixels(page, original, await frame(page)), "The previous makeup camera is restored exactly").toBe(0);
  }
});

test("native radio keys work, hidden controls cannot take focus, and history shortcuts still work", async ({ page }) => {
  await open(page);
  await customize(page);
  await page.locator("#brush-size").evaluate((element) => element.focus());
  await expect(page.locator("#customization-heading")).toBeFocused();
  await choice(page, "Face shape", "Balanced").focus();
  await page.keyboard.press("ArrowRight");
  await expect(choice(page, "Face shape", "Soft")).toBeChecked();
  await expect(choice(page, "Face shape", "Soft")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(choice(page, "Face shape", "Angular")).toBeChecked();
  await page.locator("#portrait-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect(choice(page, "Face shape", "Soft")).toBeChecked();
  await page.keyboard.press("Control+Shift+z");
  await expect(choice(page, "Face shape", "Angular")).toBeChecked();
  await page.locator("#customization-heading").focus();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => {
      const active = document.activeElement;
      return active === document.body || (active instanceof HTMLElement && active.closest("#studio") !== null && active.closest("[hidden]") === null && active.getClientRects().length > 0);
    }), "Tab reaches only the visible workspace").toBe(true);
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#active-tool")).toHaveText("Blush");
  await expect(page.locator("#undo-button")).toBeEnabled();
});

test("appearance loading and retry stay inside the workspace without losing makeup", async ({ page }, info) => {
  let attempts = 0;
  let fail: (() => Promise<void>) | undefined;
  await page.route("**/face/v2/maps/hair-blonde.png", (route) => {
    attempts++;
    if (attempts === 1) fail = () => route.abort();
    else void route.continue();
  });
  await open(page);
  await page.getByRole("button", { name: "Lipstick", exact: true }).click();
  await page.getByRole("button", { name: "Guided apply", exact: true }).click();
  await customize(page);
  await choice(page, "Hair color", "Light blonde").check();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#appearance-status")).toContainText("Updating your portrait");
  await expect(page.locator("#appearance-status")).toBeVisible();
  await expect(choice(page, "Hair color", "Espresso")).toBeEnabled();
  await expect(page.locator("#customization-done")).toBeEnabled();
  await expect(page.locator("#customization-undo")).toBeEnabled();
  await expect(page.locator("#toast")).toBeHidden();
  await page.screenshot({ path: info.outputPath("workspace-map-loading.png") });
  await expect.poll(() => fail !== undefined).toBe(true);
  await fail!();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#appearance-status")).toContainText("Try again");
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await unobstructed(retry);
  await page.screenshot({ path: info.outputPath("workspace-map-error.png") });
  await retry.click();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  expect(attempts).toBe(2);
  await expect(choice(page, "Hair color", "Light blonde")).toBeChecked();
  await expect(page.locator("#appearance-status")).toContainText("Portrait ready");
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#active-tool")).toHaveText("Lipstick");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await customize(page);
  await expect(choice(page, "Hair color", "Espresso")).toBeChecked();
});

test("customization can open while the original portrait is loading", async ({ page }) => {
  let release: (() => Promise<void>) | undefined;
  await page.route("**/face/v2/head.glb", (route) => { release = () => route.continue(); });
  await page.goto("./");
  await customize(page);
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#stage-message")).toBeVisible();
  await expect(page.locator("#appearance-status")).toContainText("Updating your portrait");
  await choice(page, "Hairstyle", "Crown bun").check();
  await expect.poll(() => release !== undefined).toBe(true);
  await release!();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(choice(page, "Hairstyle", "Crown bun")).toBeChecked();
  await expect(choice(page, "Hairstyle", "Crown bun")).toBeFocused();
});

test("the challenge timer continues in customization and expiry shows the normal locked result", async ({ page }, info) => {
  await open(page);
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await page.getByRole("button", { name: "Change brief", exact: true }).click();
  await page.getByRole("combobox", { name: "Optional timer", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Apply brief", exact: true }).click();
  await customize(page);
  await expect(page.locator("#customization-clock")).toHaveText("3:00 remaining");
  await choice(page, "Hairstyle", "Crown bun").check();
  await page.clock.fastForward(61_000);
  await expect(page.locator("#customization-clock")).toHaveText("1:59 remaining");
  await expect(page.locator("#studio")).toHaveAttribute("data-workspace", "customize");
  await page.clock.fastForward(121_000);
  await page.clock.fastForward(1000);
  await expect(page.locator("#studio")).toHaveAttribute("data-workspace", "makeup");
  await expect(page.locator("#result-panel")).toBeVisible();
  await expect(page.locator("#result-heading")).toBeFocused();
  await expect(page.locator("#customization-controls")).toBeHidden();
  await expect(page.locator("#customize-button")).toBeDisabled();
  await expect(page.locator("#before-badge")).toBeHidden();
  await expect(page.getByTestId("brief-score")).toBeVisible();
  await page.screenshot({ path: info.outputPath("workspace-timer-expired.png") });
});
