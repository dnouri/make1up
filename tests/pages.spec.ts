import { expect, test } from "@playwright/test";

test("the published studio loads its assets, credits, remix, and PNG under its site path", async ({ page, baseURL }, info) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  const site = new URL(baseURL!);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin === site.origin && !url.pathname.startsWith(site.pathname)) {
      errors.push(`Asset outside the site path: ${url.pathname}`);
    }
  });

  const response = await page.goto("./");
  expect(response?.status()).toBe(200);
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "MAKE1UP", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('600 20px "Bodoni Moda"'))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('400 14px "DM Sans"'))).toBe(true);
  await page.screenshot({ path: info.outputPath("published-studio.png"), fullPage: true });

  await page.getByRole("button", { name: "Portrait asset credit", exact: true }).click();
  await expect(page.locator("#credits-dialog")).toBeVisible();
  for (const name of ["Full portrait credit", "Bodoni Moda license", "DM Sans license"]) {
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    const url = new URL(href!, page.url());
    expect(url.pathname.startsWith(site.pathname)).toBe(true);
    const credit = await page.request.get(url.href);
    expect(credit.status()).toBe(200);
    expect(await credit.text()).toContain(name === "Full portrait credit" ? "Blender" : "FONT LICENSE");
  }
  await page.getByRole("button", { name: "Close credits", exact: true }).click();
  await expect(page.locator("#credits-dialog")).toBeHidden();

  for (const [tool, color] of [["Eyeshadow", "Orchid"], ["Lipstick", "Plum"]] as const) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.getByRole("button", { name: `${color} color`, exact: true }).click();
    await page.getByRole("button", { name: "Guided apply", exact: true }).click();
  }
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await page.getByRole("button", { name: "Share look", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Made to be remixed." })).toBeVisible();
  const remix = new URL(await page.getByLabel("Private remix link", { exact: true }).inputValue());
  expect(remix.pathname).toBe(site.pathname);
  expect(remix.origin).toBe(site.origin);
  expect(remix.hash).toMatch(/^#make1up=v1\.[dj]\./);
  await page.goto(remix.href);
  await page.reload();
  await expect(page.locator("#portrait-stage")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#gesture-count")).toHaveText("2 gestures");
  await page.getByRole("button", { name: "Finish look", exact: true }).click();
  await expect(page.getByTestId("brief-score")).toHaveText("100 / 100");
  await page.screenshot({ path: info.outputPath("published-finished-look.png"), fullPage: true });

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const download = await pending;
  await download.saveAs(info.outputPath("published-cover.png"));
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("The published portrait PNG is unavailable.");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(Uint8Array.from(chunk));
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([1080, 1350]);
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
