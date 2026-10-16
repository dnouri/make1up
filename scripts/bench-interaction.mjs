#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const dataShape = { trial: '{kind, tool, trial, input, raw, verification, errors, metrics?}',
  raw: '{start, upStart, upEnd, end, events[], frames[], uploads[], draws, canvasDraws}',
  frame: '{start, end, workMs, intervalMs, draws, canvasDraws, uploadBytes, firstUploadAt, lastSubmitAt}',
  summary: 'Verified timing trials only. Distributions contain count, mean, median, p95, min, max, range.' };
console.log(JSON.stringify({ dataShape }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.INTERACTION_URL ?? 'http://127.0.0.1:4180/make1up/');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a local production preview.');
const out = path.resolve(root, process.env.INTERACTION_OUT ?? 'tmp/performance-blend/probe');
const runs = Number(process.env.INTERACTION_RUNS ?? 1);
assert(Number.isSafeInteger(runs) && runs > 0, 'INTERACTION_RUNS must be a positive integer.');
const profileEnabled = process.env.INTERACTION_PROFILE === '1';
const phone = process.env.INTERACTION_PHONE === '1';
const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const tools = ['blush', 'liner', 'blend'];
const worldPoints = Array.from({ length: 73 }, (_, i) => ({ x: 0.05 + 0.04 * (Math.floor(i / 12) % 2 ? 1 - i % 12 / 12 : i % 12 / 12), y: 0.252 }));
await fs.mkdir(out, { recursive: true });
const json = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function machine() {
  const command = (name, argv = []) => execFileSync(name, argv, { encoding: 'utf8' }).trim();
  return { at: new Date().toISOString(), uptime: command('uptime'), nproc: Number(command('nproc')),
    ps: command('ps', ['-eo', 'pid,ppid,pcpu,pmem,comm,args', '--sort=-pcpu']).split('\n').slice(0, 20) };
}
function distribution(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const quantile = (p) => { const i = (a.length - 1) * p; return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1); };
  return a.length ? { count: a.length, mean: a.reduce((sum, x) => sum + x, 0) / a.length, median: quantile(0.5),
    p95: quantile(0.95), min: a[0], max: a.at(-1), range: [a[0], a.at(-1)] } : null;
}
function instrument() {
  const state = window.__interactionBench = { armed: false, active: null, raw: null, gl: null };
  const listeners = new WeakMap();
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  function listenerFor(target, type, listener, options, create) {
    if (!(target instanceof HTMLCanvasElement) || target.id !== 'portrait-canvas' || !/^pointer(down|move|up|cancel)$/.test(type)
      || !listener || !['function', 'object'].includes(typeof listener)) return listener;
    let byListener = listeners.get(target);
    if (!byListener && create) listeners.set(target, byListener = new WeakMap());
    let entries = byListener?.get(listener);
    if (!entries && create) byListener.set(listener, entries = new Map());
    const key = `${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`;
    if (!entries?.has(key) && create) entries.set(key, function (event) {
      if (type === 'pointerdown' && state.armed) {
        state.raw = state.active = { start: null, upStart: null, upEnd: null, end: null, events: [], frames: [], uploads: [], draws: 0, canvasDraws: 0 };
        state.armed = false;
      }
      const raw = state.active;
      const item = raw && { type, trusted: event.isTrusted, timestamp: event.timeStamp, x: event.clientX, y: event.clientY,
        buttons: event.buttons, pointerType: event.pointerType, start: performance.now() };
      if (item && raw.start === null) raw.start = item.start;
      if (item && type === 'pointerup') raw.upStart = item.start;
      try { return typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event); }
      finally {
        if (item) { item.end = performance.now(); item.workMs = item.end - item.start; raw.events.push(item);
          if (type === 'pointerup') raw.upEnd = item.end; }
      }
    });
    return entries?.get(key) ?? listener;
  }
  EventTarget.prototype.addEventListener = function (type, listener, options) { return add.call(this, type, listenerFor(this, type, listener, options, true), options); };
  EventTarget.prototype.removeEventListener = function (type, listener, options) { return remove.call(this, type, listenerFor(this, type, listener, options, false), options); };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...argv) {
    const gl = getContext.apply(this, argv);
    if (this.id === 'portrait-canvas' && /^webgl/.test(argv[0]) && gl) state.gl = gl;
    return gl;
  };
  let frame = null, framebuffer = null;
  for (const constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!constructor) continue;
    const proto = constructor.prototype;
    for (const method of ['bindFramebuffer', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'texImage2D', 'texSubImage2D']) {
      if (!Object.hasOwn(proto, method)) continue;
      const native = proto[method];
      proto[method] = function (...argv) {
        const raw = this === state.gl && state.active;
        const start = raw && method.startsWith('tex') ? performance.now() : null;
        const result = native.apply(this, argv);
        if (this === state.gl && method === 'bindFramebuffer' && (argv[0] === this.FRAMEBUFFER || argv[0] === this.DRAW_FRAMEBUFFER)) framebuffer = argv[1];
        if (raw && method.startsWith('draw')) {
          raw.draws++; if (frame) frame.draws++;
          if (framebuffer === null) { raw.canvasDraws++; if (frame) { frame.canvasDraws++; frame.lastSubmitAt = performance.now(); } }
        }
        if (raw && method.startsWith('tex') && ArrayBuffer.isView(argv[8])) {
          const width = argv[method === 'texImage2D' ? 3 : 4], height = argv[method === 'texImage2D' ? 4 : 5];
          const components = argv[6] === this.RGBA ? 4 : argv[6] === this.RGB ? 3 : argv[6] === this.RG ? 2 : 1;
          const elementBytes = argv[8].BYTES_PER_ELEMENT ?? 1;
          const bytes = Math.min(argv[8].byteLength - (argv[9] ?? 0) * elementBytes, width * height * components * elementBytes);
          raw.uploads.push({ method, start, end: performance.now(), width, height, bytes });
          if (frame) { frame.uploadBytes += bytes; frame.firstUploadAt ??= start; }
        }
        return result;
      };
    }
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    if (typeof callback !== 'function') return raf.call(this, callback);
    return raf.call(this, function (timestamp) {
      const raw = state.active;
      if (!raw) return callback.call(this, timestamp);
      const previous = frame;
      const item = { timestamp, start: performance.now(), draws: 0, canvasDraws: 0, uploadBytes: 0, firstUploadAt: null, lastSubmitAt: null };
      item.intervalMs = raw.frames.length ? item.start - raw.frames.at(-1).start : null;
      frame = item;
      try { return callback.call(this, timestamp); }
      finally {
        item.end = performance.now(); item.workMs = item.end - item.start; raw.frames.push(item); frame = previous;
        if (raw.upEnd !== null && item.start >= raw.upEnd && item.canvasDraws) { raw.end = item.end; state.active = null; }
      }
    });
  };
}
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
function frameFor(bounds) {
  assert(bounds?.width > 0 && bounds.height > 0, 'Canvas must have real dimensions.');
  const span = Math.max(0.5, 0.32 / (bounds.width / bounds.height)), cameraY = Math.max(0.282, span / 2 + 0.032);
  return { bounds, span, cameraY, project: (p) => ({ x: bounds.x + bounds.width / 2 + p.x / span * bounds.height,
    y: bounds.y + bounds.height / 2 - (p.y - cameraY) / span * bounds.height }) };
}
async function stroke(page, points, paced) {
  const commands = [], start = performance.now();
  let sent = start;
  await page.mouse.down();
  for (const [i, point] of points.slice(1).entries()) {
    if (paced) await delay(Math.max(0, 16 - (performance.now() - sent)));
    sent = performance.now();
    const command = { index: i + 1, ...point, sentMs: sent - start };
    await page.mouse.move(point.x, point.y);
    commands.push({ ...command, returnedMs: performance.now() - start });
  }
  if (paced) await page.waitForFunction(() => {
    const raw = window.__interactionBench.raw, lastMove = raw.events.filter((event) => event.type === 'pointermove').at(-1);
    return lastMove && raw.frames.some((f) => f.start >= lastMove.end && f.canvasDraws > 0)
      && raw.frames.some((f) => f.uploadBytes > 0 && f.canvasDraws > 0);
  }, undefined, { polling: 20 });
  await page.mouse.up();
  return { intendedIntervalMs: paced ? 16 : null, worldPoints: paced ? worldPoints : [{ x: 0.05, y: 0.252 }, { x: 0.09, y: 0.252 }],
    screenPoints: points, commands, automationWallMs: performance.now() - start, pendingPreviewRequiredBeforeRelease: paced };
}
async function pixelDifference(page, before, after, span, cameraY) {
  return page.evaluate(async ({ images, span, cameraY }) => {
    const decoded = await Promise.all(images.map(async (base64) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (x) => x.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }));
    const [a, b] = decoded;
    if (a.width !== b.width || a.height !== b.height) throw new Error('Canvas dimensions changed.');
    let changed = 0, leftCheek = 0, rightCheek = 0;
    const bounds = { minX: a.width, minY: a.height, maxX: -1, maxY: -1 };
    for (let i = 0; i < a.pixels.length; i += 4) {
      if (Math.max(Math.abs(a.pixels[i] - b.pixels[i]), Math.abs(a.pixels[i + 1] - b.pixels[i + 1]), Math.abs(a.pixels[i + 2] - b.pixels[i + 2])) < 3) continue;
      const x = i / 4 % a.width, y = Math.floor(i / 4 / a.width);
      const worldX = (x / a.width - 0.5) * span * a.width / a.height, worldY = cameraY - (y / a.height - 0.5) * span;
      changed++; bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
      if (Math.abs(worldX) >= 0.01 && Math.abs(worldX) <= 0.14 && worldY >= 0.19 && worldY <= 0.31) { if (worldX < 0) leftCheek++; else rightCheek++; }
    }
    return { width: a.width, height: a.height, threshold: 3, changed, leftCheek, rightCheek, bounds };
  }, { images: [before.toString('base64'), after.toString('base64')], span, cameraY });
}
function metrics(raw) {
  const rendered = raw.frames.filter((f) => f.canvasDraws), up = raw.events.find((e) => e.type === 'pointerup');
  const draft = rendered.find((f) => f.uploadBytes > 0 && f.start < up.start), commit = rendered.find((f) => f.start >= up.end);
  return { regionMs: raw.end - raw.start, frameWorkMs: distribution(rendered.map((f) => f.workMs)),
    rafCallbackWorkMs: distribution(raw.frames.map((f) => f.workMs)), rafCallbackIntervalMs: distribution(raw.frames.map((f) => f.intervalMs)),
    submittedFrameIntervalMs: distribution(rendered.slice(1).map((f, i) => f.lastSubmitAt - rendered[i].lastSubmitAt)),
    pointerMoveHandlerMs: distribution(raw.events.filter((e) => e.type === 'pointermove').map((e) => e.workMs)),
    deliveredMoveIntervalMs: distribution(raw.events.filter((e) => e.type === 'pointermove').map((e, i, a) => i ? e.start - a[i - 1].start : null)),
    releaseHandlerMs: up.workMs, firstInputToDraftSubmitMs: draft.lastSubmitAt - raw.start,
    firstDraftUploadToSubmitMs: draft.lastSubmitAt - draft.firstUploadAt, releaseToCommitSubmitMs: commit.lastSubmitAt - up.start,
    renderedFrames: rendered.length, draws: raw.draws, uploadBytes: raw.uploads.reduce((sum, x) => sum + x.bytes, 0),
    trustedEvents: Object.fromEntries(['pointerdown', 'pointermove', 'pointerup'].map((type) => [type, raw.events.filter((e) => e.type === type && e.trusted).length])) };
}
const mapCache = new Map();
async function profileSummary(profile) {
  const times = new Map();
  for (let i = 0; i < profile.samples.length; i++) times.set(profile.samples[i], (times.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i]);
  const totalUs = profile.timeDeltas.reduce((sum, x) => sum + x, 0);
  const hotspots = await Promise.all(profile.nodes.filter((n) => times.has(n.id)).sort((a, b) => times.get(b.id) - times.get(a.id)).slice(0, 30).map(async (node) => {
    const f = node.callFrame;
    if (f.url.startsWith(url.origin + '/') && !mapCache.has(f.url)) mapCache.set(f.url, (async () => {
      try {
        const response = await fetch(f.url), text = await response.text();
        const reference = text.match(/[#@]\s*sourceMappingURL=([^\s*]+)/)?.[1] ?? response.headers.get('sourcemap') ?? `${f.url}.map`;
        const mapURL = new URL(reference, f.url), mapResponse = await fetch(mapURL);
        if (mapResponse.ok) return new TraceMap(await mapResponse.json(), mapURL.protocol === 'data:' ? f.url : mapURL.href);
      } catch {}
      return null;
    })());
    const map = await mapCache.get(f.url);
    return { function: f.functionName || '(anonymous)', selfMs: times.get(node.id) / 1000, selfPercent: times.get(node.id) / totalUs * 100,
      generated: { sourcePath: f.url, line: f.lineNumber + 1, column: f.columnNumber },
      original: map && f.lineNumber >= 0 ? originalPositionFor(map, { line: f.lineNumber + 1, column: f.columnNumber }) : null };
  }));
  return { sampleCount: profile.samples.length, sampledMs: totalUs / 1000,
    sourceMaps: await Promise.all([...mapCache].map(async ([sourcePath, map]) => ({ sourcePath, available: Boolean(await map) }))), hotspots };
}
const beforeMachine = machine();
const htmlResponse = await fetch(url); assert(htmlResponse.ok, 'Production HTML must load.');
const html = await htmlResponse.text(), entryPath = html.match(/<script\b[^>]*\bsrc=["']([^"']*\/assets\/[^"']+\.js)["']/)?.[1];
assert(entryPath && !html.includes('/@vite/client'), 'The target must serve a production asset entry, not Vite development.');
const entryURL = new URL(entryPath, url), entryResponse = await fetch(entryURL);
assert(entryResponse.ok, 'Production entry must load.');
const verifiedBuild = [];
if (process.env.INTERACTION_DIST) {
  const directory = path.resolve(root, process.env.INTERACTION_DIST);
  assert.equal(html, await fs.readFile(path.join(directory, 'index.html'), 'utf8'), 'Served HTML must match the expected build.');
  for (const name of (await fs.readdir(path.join(directory, 'assets'))).filter((name) => name.endsWith('.js'))) {
    const local = await fs.readFile(path.join(directory, 'assets', name));
    const sourcePath = new URL(`assets/${name}`, url).href;
    const response = await fetch(sourcePath);
    assert(response.ok, 'Every expected production bundle must load.');
    const servedHash = sha256(Buffer.from(await response.arrayBuffer()));
    assert.equal(servedHash, sha256(local), `Served bundle must match ${name}.`);
    verifiedBuild.push({ sourcePath, sha256: servedHash, bytes: local.length });
  }
}
const manifest = { dataShape, startedAt: new Date().toISOString(), label: process.env.INTERACTION_LABEL ?? 'unlabelled', url: url.href,
  runsPerTool: runs, tools, variant: phone ? 'phone-layout-mouse' : 'desktop', viewport, deviceScaleFactor: 1,
  entry: { sourcePath: entryURL.href, sha256: sha256(Buffer.from(await entryResponse.arrayBuffer())) }, verifiedBuild,
  sources: await Promise.all(['scripts/bench-interaction.mjs', 'src/portrait.ts', 'src/paint.ts'].map(async (sourcePath) => ({ sourcePath, sha256: sha256(await fs.readFile(path.join(root, sourcePath))) }))),
  before: beforeMachine, headless: true, launchArgs: args,
  units: 'Times are milliseconds. Browser timestamps and Node command offsets have separate origins. Screen points are CSS pixels; world points use portrait model coordinates. Source lines are 1-based and columns are 0-based.',
  scope: 'Pointerdown listener entry through first committed default-framebuffer RAF callback return. Setup, screenshots, pixel decoding and export are excluded. No export is invoked. Native mouse commands are awaited and spaced at least 16 ms apart when the consumer keeps up; slow consumers are not given catch-up bursts. Arrays record only this gesture region.',
  interpretation: 'Frame work is measured RAF callback CPU/driver submission time on frames with actual portrait draws, not GPU completion, display latency or FPS. Typed 2D upload bytes describe payloads, not GPU allocation. Wrappers and automation add overhead. Browser/GPU process, shaders and OS caches are shared; each tool gets a fresh context with HTTP cache disabled. Local source hashes do not prove that a served bundle was built from them.',
  caveat: 'SwiftShader is a software renderer. Its CPU and submission costs do not predict hardware-GPU performance. One run is a probe, not a comparison verdict. For A/B, alternate labelled invocations with at least five trials per side and compare trial ranges. Optional profiles are independent and excluded from timing summaries.' };
const browser = await chromium.launch({ headless: true, args });
const browserCDP = await browser.newBrowserCDPSession();
manifest.browserVersion = await browserCDP.send('Browser.getVersion'); manifest.graphics = (await browserCDP.send('SystemInfo.getInfo')).gpu;
await json('manifest.json', manifest);
const records = [];
try {
  for (const kind of ['timing', ...(profileEnabled ? ['profile'] : [])]) for (let trial = 1; trial <= (kind === 'timing' ? runs : 1); trial++) for (const tool of tools) {
    const name = `${kind}-${tool}-${trial}`, record = { kind, tool, trial, label: manifest.label, errors: { page: [], console: [], network: [], http: [] } };
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
    await context.addInitScript(instrument);
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', (e) => record.errors.page.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') record.errors.console.push(m.text()); });
    page.on('requestfailed', (r) => record.errors.network.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('response', (r) => { if (!r.ok()) record.errors.http.push({ url: r.url(), status: r.status() }); });
    try {
      const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.goto(url.href, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#portrait-stage')?.dataset.state === 'ready', undefined, { polling: 50 });
      assert.equal(await page.locator('#gesture-count').textContent(), '0 gestures');
      assert.equal(await page.locator('#mirror-button').getAttribute('aria-pressed'), 'true');
      assert(await page.evaluate((entry) => [...document.scripts].some((s) => s.src === entry), entryURL.href), 'Page must use the recorded production entry.');
      await page.getByRole('button', { name: 'Face', exact: true }).click();
      const canvas = page.locator('#portrait-canvas');
      if (tool === 'blend') {
        await page.getByRole('button', { name: 'Liner', exact: true }).click(); await page.getByRole('button', { name: 'Ink color', exact: true }).click();
        for (const [label, key] of [['Opacity', 'End'], ['Softness', 'Home']]) { await page.getByRole('slider', { name: label, exact: true }).focus(); await page.keyboard.press(key); }
      } else await page.locator(`[data-tool="${tool}"]`).click();
      await canvas.scrollIntoViewIfNeeded();
      let view = frameFor(await canvas.boundingBox());
      if (tool === 'blend') {
        const stripe = Array.from({ length: 9 }, (_, i) => view.project({ x: 0.05 + i * 0.005, y: 0.252 }));
        await page.mouse.move(stripe[0].x, stripe[0].y); record.setupStripe = await stroke(page, stripe, false);
        await page.waitForFunction(() => document.querySelector('#gesture-count')?.textContent === '1 gesture', undefined, { polling: 20 });
        await page.locator('[data-tool="blend"]').click(); await canvas.scrollIntoViewIfNeeded();
      }
      const historyBefore = tool === 'blend' ? 1 : 0;
      await page.mouse.move(0, 0); await settle(page); const before = await canvas.screenshot();
      if (kind === 'timing' && trial === 1) await fs.writeFile(path.join(out, `${tool}-before.png`), before);
      view = frameFor(await canvas.boundingBox());
      const points = worldPoints.map(view.project); record.canvas = { bounds: view.bounds, span: view.span, cameraY: view.cameraY };
      await page.mouse.move(points[0].x, points[0].y); await settle(page);
      await page.evaluate(() => { window.__interactionBench.armed = true; });
      if (kind === 'profile') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
      try {
        record.input = await stroke(page, points, true);
        await page.waitForFunction(() => { const raw = window.__interactionBench.raw; return raw && raw.end !== null && !window.__interactionBench.active; }, undefined, { polling: 20 });
      } finally {
        if (kind === 'profile') { const { profile } = await cdp.send('Profiler.stop'); await json(`${name}.cpuprofile`, profile); record.profile = await profileSummary(profile); await json(`${name}-hotspots.json`, record.profile); }
      }
      record.raw = await page.evaluate(() => window.__interactionBench.raw);
      assert.equal(await page.locator('#gesture-count').textContent(), `${historyBefore + 1} gesture${historyBefore ? 's' : ''}`, 'Exactly one accepted history item must be added.');
      assert(await page.getByRole('button', { name: 'Undo last edit', exact: true }).isEnabled());
      const trustedEvents = Object.fromEntries(['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].map((type) => [type, record.raw.events.filter((e) => e.type === type && e.trusted).length]));
      assert(record.raw.events.every((e) => e.trusted) && trustedEvents.pointerdown === 1 && trustedEvents.pointerup === 1 && trustedEvents.pointermove >= 60 && trustedEvents.pointercancel === 0, 'One complete native gesture with at least 60 trusted moves must be delivered.');
      await page.mouse.move(0, 0); await settle(page); const after = await canvas.screenshot();
      if (kind === 'timing' && trial === 1) await fs.writeFile(path.join(out, `${tool}-after.png`), after);
      const pixels = await pixelDifference(page, before, after, view.span, view.cameraY);
      record.verification = { historyBefore, historyAfter: historyBefore + 1, acceptedHistoryItems: 1, undoEnabled: true, trustedEvents, pixels };
      assert(pixels.leftCheek > 5 && pixels.rightCheek > 5 && pixels.changed < pixels.width * pixels.height * 0.15, 'Visible changes must be local to both mirrored cheeks.');
      assert.equal(Object.values(record.errors).flat().length, 0, 'No page, console, network or HTTP errors are allowed.');
      record.verified = true; if (kind === 'timing') record.metrics = metrics(record.raw);
    } catch (e) { record.failure = { message: e.message, stack: e.stack }; record.raw ??= await page.evaluate(() => window.__interactionBench?.raw).catch(() => null); }
    finally { await context.close(); }
    if (Object.values(record.errors).flat().length && !record.failure) { record.verified = false; record.failure = { message: 'Runtime or network errors occurred.' }; }
    records.push(record); await json(`${name}.json`, record);
    console.log(JSON.stringify({ kind, tool, trial, verified: record.verified ?? false, failure: record.failure?.message, metrics: record.metrics }));
  }
} finally { await browser.close(); manifest.after = machine(); await json('manifest.json', manifest); }
const summary = { dataShape, label: manifest.label, verdict: 'Measurements only. No speedup or limiter claim is established by this script.',
  requestedTrialsPerTool: runs, profileTrialsExcluded: records.filter((r) => r.kind === 'profile').length,
  byTool: tools.map((tool) => {
    const all = records.filter((r) => r.kind === 'timing' && r.tool === tool), ok = all.filter((r) => r.verified && !r.failure);
    return { tool, trials: all.length, verifiedTrials: ok.length, failedTrials: all.length - ok.length,
      frameWorkMs: distribution(ok.flatMap((r) => r.raw.frames.filter((f) => f.canvasDraws).map((f) => f.workMs))),
      trialMetrics: Object.fromEntries(['mean', 'median', 'p95', 'max'].map((field) => [`frameWork${field[0].toUpperCase() + field.slice(1)}Ms`, distribution(ok.map((r) => r.metrics.frameWorkMs[field]))])),
      releaseHandlerMs: distribution(ok.map((r) => r.metrics.releaseHandlerMs)), firstInputToDraftSubmitMs: distribution(ok.map((r) => r.metrics.firstInputToDraftSubmitMs)) };
  }) };
await json('summary.json', summary); console.log(JSON.stringify(summary, null, 2));
if (records.some((r) => r.failure)) process.exitCode = 1;
