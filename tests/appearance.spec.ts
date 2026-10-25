import { expect, test } from "@playwright/test";
import type { Page, Route, TestInfo } from "@playwright/test";
import { avatarCatalog, shapeFields } from "../src/avatar";

type Image = { base64: string; skin: number; hair: number };
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(runtimeErrors.get(page)).toEqual([]));

async function open(page: Page) {
  await page.goto("./");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.locator(".appearance-section > summary").click();
}

async function select(page: Page, field: string, id: string) {
  await page.locator(`#appearance-${field}`).selectOption(id);
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
}

async function png(page: Page, info: TestInfo, name: string): Promise<Image> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const image = await download;
  await image.saveAs(info.outputPath(`${name}.png`));
  const stream = await image.createReadStream();
  if (stream === null) throw new Error("The actual exported image is unavailable.");
  let binary = "";
  for await (const chunk of stream) for (const byte of chunk) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const metrics = await page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Pixel readback is unavailable.");
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    function luminance(left: number, top: number, right: number, bottom: number) {
      let sum = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const offset = (y * canvas.width + x) * 4;
        sum += data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
      }
      return sum / ((right - left) * (bottom - top));
    }
    return { skin: luminance(630, 740, 670, 780), hair: luminance(520, 260, 560, 310) };
  }, base64);
  return { base64, ...metrics };
}

async function difference(page: Page, before: Image, after: Image, area = [240, 180, 840, 1020]) {
  return page.evaluate(async ({ a, b, area }) => {
    const read = async (value: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${value}`)).blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("Pixel readback is unavailable.");
      context.drawImage(bitmap, 0, 0); bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const [first, second] = await Promise.all([read(a), read(b)]);
    let changed = 0;
    for (let y = area[1]!; y < area[3]!; y++) for (let x = area[0]!; x < area[2]!; x++) {
      const offset = (y * first.width + x) * 4;
      if ([0, 1, 2].some((channel) => Math.abs(first.data[offset + channel]! - second.data[offset + channel]!) >= 3)) changed++;
    }
    return changed;
  }, { a: before.base64, b: after.base64, area });
}

async function livePixels(page: Page) {
  return page.evaluate(() => new Promise<{ width: number; height: number; digest: string }>((resolve, reject) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#portrait-canvas")!;
    canvas.dispatchEvent(new Event("pointerleave"));
    requestAnimationFrame(() => {
      const context = canvas.getContext("webgl2");
      if (context === null) { reject(new Error("The current WebGL context is unavailable.")); return; }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      if (!pixels.some((byte) => byte !== 0)) { reject(new Error("The live portrait pixels were not rendered.")); return; }
      void crypto.subtle.digest("SHA-256", pixels).then((hash) => resolve({
        width: canvas.width, height: canvas.height,
        digest: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      }), reject);
    });
  }));
}

async function guided(page: Page, tool: string, color: string) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await page.getByRole("button", { name: `${color} color`, exact: true }).click();
  await page.getByRole("button", { name: "Guided apply", exact: true }).click();
}

test("all complexions change actual exported face pixels without preloading the complexion catalog", async ({ page }, info) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/face/v2/maps/")) requests.push(request.url()); });
  await open(page);
  expect(requests).toEqual([]);
  const images: Record<string, Image> = {};
  for (const id of Object.keys(avatarCatalog.complexion)) {
    await select(page, "complexion", id);
    images[id] = await png(page, info, `complexion-${id}`);
    for (const [previous, image] of Object.entries(images)) {
      if (previous !== id) expect(await difference(page, image, images[id]!, [300, 450, 780, 980]), `${previous} and ${id} have different rendered skin`).toBeGreaterThan(10_000);
    }
  }
  expect(images.fair!.skin - images.deep!.skin, "The fair and deep maps have visibly different luminance").toBeGreaterThan(40);
  expect(requests.some((url) => url.includes("skin-warm") || url.includes("bust-warm")), "Warm reuses the embedded neutral maps").toBe(false);
  await info.attach("complexion-pixel-evidence", { body: JSON.stringify(Object.fromEntries(Object.entries(images).map(([id, image]) => [id, image.skin]))), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("complexion-controls.png"), fullPage: true });
});

test("every hair color changes exported pixels and blonde is light", async ({ page }, info) => {
  test.setTimeout(120_000);
  await open(page);
  const images: Record<string, Image> = {};
  for (const id of Object.keys(avatarCatalog.hairColor)) {
    await select(page, "hairColor", id);
    images[id] = await png(page, info, `hair-${id}`);
    for (const [previous, image] of Object.entries(images)) {
      if (previous !== id) expect(await difference(page, image, images[id]!, [300, 180, 780, 450])).toBeGreaterThan(1_000);
    }
  }
  expect(images.blonde!.hair - images.espresso!.hair, "Authored blonde is lighter than espresso, not a dark multiplication").toBeGreaterThan(45);
  await info.attach("hair-pixel-evidence", { body: JSON.stringify(Object.fromEntries(Object.entries(images).map(([id, image]) => [id, image.hair]))), contentType: "application/json" });
  const ponytail = images.blonde!;
  await select(page, "hairStyle", "bun");
  const bun = await png(page, info, "blonde-crown-bun");
  expect(await difference(page, ponytail, bun)).toBeGreaterThan(1_000);
  await page.locator("#portrait-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("blonde-bun-studio.png") });
  await select(page, "hairStyle", "ponytail");
  expect(await difference(page, ponytail, await png(page, info, "blonde-ponytail-restored"))).toBe(0);
});

for (const field of shapeFields) test(`every ${field} choice changes the rendered face and resetting restores neutral pixels`, async ({ page }, info) => {
  test.setTimeout(120_000);
  await open(page);
  const neutral = await png(page, info, `${field}-neutral`);
  const images: Image[] = [];
  for (const id of Object.keys(avatarCatalog[field])) {
    await select(page, field, id);
    const image = await png(page, info, `${field}-${id}`);
    if (id === "balanced") expect(await difference(page, neutral, image)).toBe(0);
    else expect(await difference(page, neutral, image, [270, 400, 810, 1020]), `${field} ${id} visibly deforms the face`).toBeGreaterThan(100);
    for (const previous of images) expect(await difference(page, previous, image)).toBeGreaterThan(100);
    images.push(image);
  }
  await select(page, field, "balanced");
  expect(await difference(page, neutral, await png(page, info, `${field}-reset`))).toBe(0);
});

test("lipstick and native mirrored painting stay attached after the complete face pose changes", async ({ page }, info) => {
  test.setTimeout(120_000);
  await open(page);
  await guided(page, "Lipstick", "Plum");
  for (const [field, id] of [["face", "angular"], ["nose", "broad"], ["mouth", "wide"], ["eyeShape", "round"]]) await select(page, field!, id!);
  const painted = await png(page, info, "morphed-lipstick");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Clear makeup", exact: true }).click();
  const bare = await png(page, info, "morphed-bare");
  expect(await difference(page, bare, painted, [420, 820, 660, 940]), "Lipstick follows the changed mouth").toBeGreaterThan(2_000);
  expect(await difference(page, bare, painted, [0, 150, 200, 1200]), "The paint does not escape into the background").toBe(0);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  expect(await difference(page, painted, await png(page, info, "morphed-lipstick-undo-clear"))).toBe(0);
  await page.getByRole("button", { name: "Liner", exact: true }).click();
  const canvas = page.locator("#portrait-canvas");
  await canvas.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const bounds = (await canvas.boundingBox())!;
  const span = Math.max(0.5, 0.32 / (bounds.width / bounds.height));
  const cameraY = Math.max(0.282, span / 2 + 0.032);
  const x = bounds.x + bounds.width / 2 + 0.065 / span * bounds.height;
  const y = bounds.y + bounds.height / 2 - (0.252 - cameraY) / span * bounds.height;
  if (info.project.use.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.click(x, y);
    await page.mouse.move(2, 2);
  }
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  const marked = await png(page, info, "morphed-native-mirrored-paint");
  expect(await difference(page, painted, marked, [300, 650, 780, 820])).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  expect(await difference(page, painted, await png(page, info, "morphed-native-undone"))).toBe(0);
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click();
  expect(await difference(page, marked, await png(page, info, "morphed-native-redone"))).toBe(0);
  await page.getByRole("button", { name: "Lips", exact: true }).click();
  await page.screenshot({ path: info.outputPath("morphed-lipstick-close-up.png") });
});

test("every iris choice uses its authored map in the exported eyes", async ({ page }, info) => {
  await open(page);
  const images: Image[] = [];
  for (const id of Object.keys(avatarCatalog.eyes)) {
    await select(page, "eyes", id);
    const image = await png(page, info, `iris-${id}`);
    for (const previous of images) expect(await difference(page, previous, image, [350, 550, 730, 720])).toBeGreaterThan(1_000);
    images.push(image);
  }
});

test("an in-flight capture preserves the newest live appearance, paint, and picking view", async ({ page }, info) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (first && this.width === 1080 && this.height === 1350) {
        first = false;
        Reflect.set(window, "releasePortraitCapture", () => encode.call(this, callback, type, quality));
      } else encode.call(this, callback, type, quality);
    };
  });
  await open(page);
  await guided(page, "Lipstick", "Plum");
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await page.waitForFunction(() => typeof Reflect.get(window, "releasePortraitCapture") === "function");
  await select(page, "mouth", "wide");
  await select(page, "eyeShape", "round");
  await select(page, "hairColor", "blonde");
  await select(page, "hairStyle", "bun");
  const canvas = page.locator("#portrait-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({ path: info.outputPath("live-appearance-during-capture.png") });
  const before = await livePixels(page);
  await page.evaluate(() => Reflect.get(window, "releasePortraitCapture")());
  await expect(page.locator("#app-status")).toHaveText("The look changed before saving finished. Nothing was replaced. Save again to keep the latest look.");
  await canvas.screenshot({ path: info.outputPath("live-appearance-after-capture.png") });
  expect(await livePixels(page)).toEqual(before);
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await expect(page.locator("#saved-count")).toHaveText("0");
  await expect(page.locator("#appearance-hairColor")).toHaveValue("blonde");
  await expect(page.locator("#appearance-hairStyle")).toHaveValue("bun");
  await png(page, info, "live-appearance-after-rejected-save");
});

test("late textures and Undo cannot overwrite the current appearance or admit pending paint", async ({ page }, info) => {
  test.setTimeout(120_000);
  const pending = new Map<string, Route>();
  await page.route("**/face/v2/maps/*", (route) => { pending.set(route.request().url().split("/").at(-1)!, route); });
  await page.addInitScript(() => localStorage.setItem("make1up.lookbook.v1", "untouched old bytes"));
  await open(page);
  await page.locator("#appearance-complexion").selectOption("fair");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "loading");
  for (const selector of ["#finish-button", "#save-button", "#share-button", "#download-button", "#guided-button"]) await expect(page.locator(selector)).toBeDisabled();
  await page.locator("#portrait-canvas").dispatchEvent("pointerdown", { button: 0, pointerId: 1, isPrimary: true, clientX: 200, clientY: 300 });
  await page.locator("#portrait-canvas").dispatchEvent("pointerup", { button: 0, pointerId: 1, isPrimary: true, clientX: 200, clientY: 300 });
  await expect(page.locator("#gesture-count")).toHaveText("0 gestures");
  await page.locator("#appearance-complexion").selectOption("deep");
  for (const file of ["skin-deep.png", "bust-deep.png"]) {
    await expect.poll(() => pending.has(file)).toBe(true);
    await pending.get(file)!.continue(); pending.delete(file);
  }
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  const deep = await png(page, info, "delayed-current-deep");
  for (const file of ["skin-fair.png", "bust-fair.png"]) {
    await expect.poll(() => pending.has(file)).toBe(true);
    await pending.get(file)!.continue(); pending.delete(file);
  }
  await page.waitForLoadState("networkidle");
  expect(await difference(page, deep, await png(page, info, "delayed-fair-ignored"))).toBe(0);
  await page.locator("#appearance-hairColor").selectOption("blonde");
  await expect.poll(() => pending.has("hair-blonde.png")).toBe(true);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await expect(page.locator("#appearance-hairColor")).toHaveValue("espresso");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  await pending.get("hair-blonde.png")!.continue(); pending.delete("hair-blonde.png");
  await page.waitForLoadState("networkidle");
  expect(await difference(page, deep, await png(page, info, "delayed-undo-kept"))).toBe(0);
  await page.getByRole("button", { name: "Save look", exact: true }).click();
  await expect(page.locator("#saved-count")).toHaveText("1");
  expect(await page.evaluate(() => localStorage.getItem("make1up.lookbook.v1"))).toBe("untouched old bytes");
  expect(await page.evaluate(() => localStorage.getItem("make1up.lookbook.v2"))).not.toBeNull();
});

test("a failed color map is retryable without reloading or losing the look", async ({ page }, info) => {
  let attempts = 0;
  await page.route("**/face/v2/maps/hair-chestnut.png", (route) => ++attempts === 1 ? route.abort() : route.continue());
  await open(page);
  await guided(page, "Lipstick", "Plum");
  const original = await png(page, info, "before-color-retry");
  await page.locator("#appearance-hairColor").selectOption("chestnut");
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#finish-button")).toBeDisabled();
  await expect(page.locator("#gesture-count")).toHaveText("1 gesture");
  await page.screenshot({ path: info.outputPath("color-load-error.png") });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  expect(attempts).toBe(2);
  await expect(page.locator("#appearance-hairColor")).toHaveValue("chestnut");
  const retried = await png(page, info, "after-color-retry");
  expect(await difference(page, original, retried, [300, 180, 780, 450])).toBeGreaterThan(1_000);
  expect(await difference(page, original, retried, [420, 820, 660, 940]), "Retry does not alter the existing lip paint").toBe(0);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  expect(await difference(page, original, await png(page, info, "color-retry-undone"))).toBe(0);
});
