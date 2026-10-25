#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:4175/');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(baseURL.hostname), 'Use a local preview only.');
const output = path.resolve(root, process.env.PERF_OUT_DIR ?? 'tmp/verification/performance');
const probe = process.argv.includes('--probe');
const pairs = probe ? 1 : 5;
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const variants = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false, readinessBudgetMs: 10_000 },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, readinessBudgetMs: 20_000 },
];
const key = 'make1up.local.performance.readonly';
await fs.mkdir(output, { recursive: true });
const json = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
function machine() {
  const command = (program, argv) => execFileSync(program, argv, { encoding: 'utf8' }).trim();
  return {
    at: new Date().toISOString(), uptime: command('uptime', []), cores: Number(command('nproc', [])),
    topProcesses: command('ps', ['-eo', 'pid,ppid,pcpu,pmem,comm,args', '--sort=-pcpu']).split('\n').slice(0, 19),
  };
}

function instrument({ storageKey, verifyPixels }) {
  const state = {
    verifyPixels, readyAt: null, readyMarkerAt: null, paintedPixelsAt: null,
    resultAt: null, gestureAt: null, events: [], frames: [], longTasks: [], eventTiming: [],
    initialDraws: { calls: 0, triangles: 0, lastAt: null }, uploads: [], checks: {}, readbacks: [],
    pointerActive: false, sample: null,
  };
  Object.defineProperty(document, Symbol.for(storageKey), { value: state });
  let gl = null;
  let activeFrame = null;
  let previousFrame = null;
  let baseline = null;
  const bindings = new WeakMap();
  const nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const measured = (this instanceof HTMLCanvasElement && this.id === 'portrait-canvas' && /^pointer(down|move|up|cancel)$/.test(type))
      || (this instanceof HTMLElement && this.id === 'finish-button' && type === 'click');
    if (!measured || typeof listener !== 'function') return nativeAdd.call(this, type, listener, options);
    const target = this;
    return nativeAdd.call(this, type, function (event) {
      const item = { type, target: target.id, pointerType: event.pointerType ?? null, trusted: event.isTrusted,
        timestamp: event.timeStamp, start: performance.now(), gestureBefore: document.querySelector('#gesture-count')?.textContent };
      if (type === 'pointerdown') state.pointerActive = true;
      try { return listener.call(this, event); }
      finally {
        item.end = performance.now();
        item.duration = item.end - item.start;
        item.gestureAfter = document.querySelector('#gesture-count')?.textContent;
        state.events.push(item);
        if (type === 'pointerup' || type === 'pointercancel') state.pointerActive = false;
      }
    }, options);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...argv) {
    const context = getContext.apply(this, argv);
    if (this.id === 'portrait-canvas' && /^webgl/.test(argv[0]) && context) {
      gl = context;
      bindings.set(gl, null);
    }
    return context;
  };
  for (const constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!constructor) continue;
    const proto = constructor.prototype;
    const bind = proto.bindFramebuffer;
    proto.bindFramebuffer = function (target, framebuffer) {
      const value = bind.call(this, target, framebuffer);
      if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) bindings.set(this, framebuffer);
      return value;
    };
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const native = proto[method];
      if (!native) continue;
      proto[method] = function (...argv) {
        const value = native.apply(this, argv);
        if (this === gl && bindings.get(this) === null) {
          const count = method.startsWith('drawArrays') ? argv[2] : argv[1];
          const instances = method.endsWith('Instanced') ? argv[method.startsWith('drawArrays') ? 3 : 4] : 1;
          const triangles = argv[0] === this.TRIANGLES ? count / 3 * instances
            : (argv[0] === this.TRIANGLE_STRIP || argv[0] === this.TRIANGLE_FAN) ? Math.max(0, count - 2) * instances : 0;
          const record = activeFrame ?? state.initialDraws;
          record.calls++;
          record.triangles += triangles;
          record.lastAt = performance.now();
        }
        return value;
      };
    }
    for (const method of ['texImage2D', 'texSubImage2D']) {
      const native = proto[method];
      proto[method] = function (...argv) {
        const start = performance.now();
        const value = native.apply(this, argv);
        const width = argv[method === 'texImage2D' ? 3 : 4];
        const height = argv[method === 'texImage2D' ? 4 : 5];
        if (this === gl && width === 1024 && height === 1024 && ArrayBuffer.isView(argv[8])) {
          const item = { method, width, height, bytes: argv[8].byteLength, start, end: performance.now() };
          state.uploads.push(item);
          if (activeFrame) activeFrame.uploadBytes += item.bytes;
        }
        return value;
      };
    }
  }
  function readback(name) {
    const start = performance.now();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const pixelsAt = performance.now();
    if (name === 'baseline') state.readyAt = pixelsAt;
    else state.paintedPixelsAt = pixelsAt;
    let opaque = 0;
    let changed = 0;
    let left = 0;
    let right = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 128) {
        opaque++;
        if (i % 128 === 0) colors.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`);
      }
      if (name !== 'baseline' && baseline && baseline.length === pixels.length
        && Math.max(Math.abs(pixels[i] - baseline[i]), Math.abs(pixels[i + 1] - baseline[i + 1]), Math.abs(pixels[i + 2] - baseline[i + 2])) >= 3) {
        changed++;
        const x = i / 4 % width;
        const y = Math.floor(i / 4 / width);
        if (x < width / 2) left++; else right++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (name === 'baseline') baseline = pixels;
    state.checks[name] = { width, height, opaquePixels: opaque, sampledColorBuckets: colors.size,
      changedPixels: changed, leftChangedPixels: left, rightChangedPixels: right,
      changedBoundsBottomOrigin: changed ? { minX, maxX, minY, maxY } : null };
    state.readbacks.push({ name, start, pixelsAt, end: performance.now() });
    state.sample = null;
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(window, function (timestamp) {
      const start = performance.now();
      if (previousFrame && previousFrame.nextOpportunityAt == null) previousFrame.nextOpportunityAt = start;
      const frame = { start, calls: 0, triangles: 0, uploadBytes: 0, lastAt: null,
        phase: document.querySelector('#portrait-stage')?.dataset.phase ?? null, pointerActive: state.pointerActive };
      activeFrame = frame;
      try { return callback(timestamp); }
      finally {
        frame.end = performance.now();
        activeFrame = null;
        if (frame.calls) {
          state.frames.push(frame);
          previousFrame = frame;
          const sample = state.sample;
          if (sample === 'baseline' || (sample === 'painted' && !state.pointerActive && document.querySelector('#gesture-count')?.textContent === '1 gesture')) readback(sample);
        }
      }
    });
  };
  new MutationObserver(() => {
    if (state.readyMarkerAt === null && document.querySelector('#portrait-stage')?.dataset.state === 'ready') {
      state.readyMarkerAt = performance.now();
      if (verifyPixels) readback('baseline');
      else {
        state.readyAt = state.readyMarkerAt;
        state.checks.baseline = { skippedForIndependentProfile: true };
      }
    }
    if (state.gestureAt === null && document.querySelector('#gesture-count')?.textContent === '1 gesture') state.gestureAt = performance.now();
    const panel = document.querySelector('#result-panel');
    if (state.resultAt === null && panel && !panel.hidden) state.resultAt = performance.now();
  }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
  for (const [type, target] of [['longtask', state.longTasks], ['event', state.eventTiming]]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    new PerformanceObserver((list) => {
      for (const item of list.getEntries()) target.push(item.toJSON());
    }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
  }
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) } : null;
}
function metrics(raw) {
  const down = raw.events.find((event) => event.type === 'pointerdown');
  const up = raw.events.find((event) => event.type === 'pointerup');
  const click = raw.events.find((event) => event.target === 'finish-button');
  const firstDraft = down && raw.frames.find((frame) => frame.start >= down.end && frame.uploadBytes > 0);
  const commit = up && raw.frames.find((frame) => frame.start >= up.end);
  const result = click && raw.frames.find((frame) => frame.start >= click.end && frame.phase === 'result');
  const overlapsReadback = (task) => raw.readbacks.some((check) => task.startTime < check.end && task.startTime + task.duration > check.start);
  const inRange = (from, to) => raw.longTasks.filter((task) => task.startTime + task.duration > from && task.startTime < to && !overlapsReadback(task));
  return {
    readyMarkerMs: raw.readyMarkerAt,
    readinessMs: raw.readyAt,
    pointerDownHandlerMs: down?.duration ?? null,
    pointerMoveHandlerMs: distribution(raw.events.filter((event) => event.type === 'pointermove').map((event) => event.duration)),
    pointerUpAdmissionAndReplayHandlerMs: up?.duration ?? null,
    firstInputToDraftRenderSubmissionMs: firstDraft && firstDraft.lastAt - down.start,
    pointerUpToCommitRenderSubmissionMs: commit && commit.lastAt - up.start,
    pointerUpToCommittedPixelsAvailableMs: up && raw.paintedPixelsAt !== null ? raw.paintedPixelsAt - up.start : null,
    strokeInputToCommitRenderSubmissionMs: commit && commit.lastAt - down.start,
    finishHandlerMs: click?.duration ?? null,
    finishInputToResultRenderSubmissionMs: result && result.lastAt - click.start,
    finishInputToNextFrameOpportunityMs: result?.nextOpportunityAt == null ? null : result.nextOpportunityAt - click.start,
    inputLongTasks: down && result ? inRange(down.start, result.nextOpportunityAt ?? result.end).map(({ startTime, duration }) => ({ startTime, duration })) : [],
    actualRenderedFramesDuringStroke: down && commit ? raw.frames.filter((frame) => frame.start >= down.start && frame.start <= commit.start).length : 0,
    actualDraftRenderedFrames: down && up ? raw.frames.filter((frame) => frame.start >= down.start && frame.start < up.start && frame.uploadBytes > 0).length : 0,
    readinessLongTasks: inRange(0, raw.readyAt ?? 0).map(({ startTime, duration }) => ({ startTime, duration })),
    verificationOverlappingLongTasks: raw.longTasks.filter(overlapsReadback).map(({ startTime, duration }) => ({ startTime, duration })),
  };
}

const startMachine = machine();
await json('environment-before.json', startMachine);
const html = await (await fetch(baseURL)).text();
const entry = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
assert(entry, 'The target must serve a production entry bundle.');
const localHTML = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
const localEntry = localHTML.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
assert.equal(entry, process.env.PERF_EXPECT_ENTRY ?? localEntry, 'The preview must match the local production build.');
const servedEntry = new Uint8Array(await (await fetch(new URL(entry, baseURL))).arrayBuffer());
const distEntry = entry.replace(/^\/make1up\//, '').replace(/^\//, '');
const localEntryBytes = await fs.readFile(path.join(root, 'dist', distEntry));
assert.equal(createHash('sha256').update(servedEntry).digest('hex'), createHash('sha256').update(localEntryBytes).digest('hex'), 'The preview entry bytes must match dist.');
const contract = JSON.parse(await fs.readFile(path.join(root, 'dist/face/v2/asset.json'), 'utf8'));
const glb = await fs.readFile(path.join(root, 'dist/face/v2/head.glb'));
assert.equal(createHash('sha256').update(glb).digest('hex'), contract.glb.sha256);
const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const structuralTriangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((count, primitive) =>
  count + gltf.accessors[primitive.indices].count / 3, 0), 0);
assert.equal(structuralTriangles, contract.triangles);
const browser = await chromium.launch({ args });
const browserCDP = await browser.newBrowserCDPSession();
const browserVersion = await browserCDP.send('Browser.getVersion');
const gpu = await browserCDP.send('SystemInfo.getInfo');
const manifest = {
  startedAt: new Date().toISOString(), baseURL: baseURL.href, entry, probe, pairsPerVariant: pairs,
  browserVersion, launchArgs: args, gpu: gpu.gpu, variants, deviceScaleFactor: 1,
  buildAsset: { glbBytes: glb.length, glbSha256: contract.glb.sha256, structuralTriangles, paintTextureSize: contract.paintAtlas.paint.textureSize },
  measurement: 'Budgeted readiness is navigation start to nonblank portrait pixels read after the compiled real render; this conservative upper bound includes the GPU readback/copy barrier, but excludes pixel analysis. The earlier DOM marker is separate. Input-to-pixels timing also includes a readback barrier; CPU render submission and next-frame opportunity are not physical display latency. Wrappers and Playwright/CDP automation add overhead. Long tasks overlapping verification readbacks are separated. No idle-RAF FPS is reported. The independent warm profile disables verification readbacks and is not a reported timing sample.',
  cache: 'New storage/context and Network.setCacheDisabled(true) for reported runs; browser/GPU process, shader cache, OS file cache, and server remain shared. This is not a cold-machine measurement.',
  noise: 'Unrelated browsers and the root functional suite on 4173 run concurrently. No unrelated process is stopped.',
};
await json('manifest.json', manifest);

async function setup(variant, cold = true) {
  const context = await browser.newContext({ viewport: variant.viewport, isMobile: variant.isMobile, hasTouch: variant.hasTouch,
    deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', acceptDownloads: true, serviceWorkers: 'block' });
  const errors = { page: [], console: [], network: [], http: [], externalBlocked: [] };
  await context.route((url) => ['http:', 'https:'].includes(url.protocol) && url.origin !== baseURL.origin, async (route) => {
    errors.externalBlocked.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await context.addInitScript(instrument, { storageKey: key, verifyPixels: cold });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (error) => errors.page.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.console.push(message.text()); });
  page.on('requestfailed', (request) => errors.network.push({ url: request.url(), reason: request.failure()?.errorText }));
  page.on('response', (response) => { if (!response.ok()) errors.http.push({ url: response.url(), status: response.status() }); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: cold });
  const network = { requests: [], completed: [] };
  cdp.on('Network.requestWillBeSent', ({ requestId, request, type }) => network.requests.push({ requestId, url: request.url, type }));
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => network.completed.push({ requestId, encodedDataLength }));
  return { context, page, cdp, errors, network };
}
async function ready(page, reload = false) {
  if (reload) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  else await page.goto(baseURL.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction((storageKey) => document[Symbol.for(storageKey)]?.checks.baseline, key, { timeout: 45_000 });
  assert.equal(await page.locator('#portrait-stage').getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('#gesture-count').textContent(), '0 gestures');
}
async function inputAndFinish(session) {
  const { page, cdp } = session;
  await page.locator('#portrait-canvas').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#portrait-canvas').boundingBox();
  assert(bounds && bounds.width > 0 && bounds.height > 0, 'The portrait must have real dimensions.');
  const span = Math.max(0.5, 0.32 / (bounds.width / bounds.height));
  const cameraY = Math.max(0.282, span / 2 + 0.032);
  const point = { x: bounds.x + bounds.width / 2 + 0.065 / span * bounds.height,
    y: bounds.y + bounds.height / 2 - (0.252 - cameraY) / span * bounds.height };
  const distance = 0.015 / span * bounds.height;
  await page.evaluate((storageKey) => {
    const state = document[Symbol.for(storageKey)];
    state.sample = state.verifyPixels ? 'painted' : null;
  }, key);
  const automationStart = performance.now();
  if (session.variant.hasTouch) {
    const contact = { ...point, radiusX: 3, radiusY: 3, force: 1, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact] });
    for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...contact, x: point.x + distance * step / 6 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + distance, point.y, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(2, 2);
  }
  const automatedInputWallMs = performance.now() - automationStart;
  await page.waitForFunction((storageKey) => {
    const state = document[Symbol.for(storageKey)];
    if (state?.verifyPixels) return state.checks.painted;
    const up = state?.events.find((event) => event.type === 'pointerup');
    return up && state.frames.some((frame) => frame.start >= up.end && frame.nextOpportunityAt != null);
  }, key);
  assert.equal(await page.locator('#gesture-count').textContent(), '1 gesture', 'The real gesture must be committed.');
  assert(await page.getByRole('button', { name: 'Undo last edit', exact: true }).isEnabled(), 'The real gesture must be undoable.');
  await page.getByRole('button', { name: 'Finish look', exact: true }).click();
  await page.waitForFunction((storageKey) => {
    const state = document[Symbol.for(storageKey)];
    return state?.resultAt !== null && state?.frames.some((frame) => frame.phase === 'result' && frame.nextOpportunityAt != null);
  }, key);
  assert(await page.locator('#result-panel').isVisible());
  assert.equal(await page.locator('#result-evidence summary').count(), 4);
  return { bounds, point, distance, automatedInputWallMs };
}
async function snapshot(session) {
  const raw = await session.page.evaluate((storageKey) => {
    const state = document[Symbol.for(storageKey)];
    const canvas = document.querySelector('#portrait-canvas');
    const bounds = canvas.getBoundingClientRect();
    return { ...state, cssCanvas: { width: bounds.width, height: bounds.height },
      canvas: { width: canvas.width, height: canvas.height }, dpr: devicePixelRatio,
      navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
      resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
      gestures: document.querySelector('#gesture-count').textContent,
      result: { phase: document.querySelector('#portrait-stage').dataset.phase,
        score: document.querySelector('[data-testid="brief-score"]')?.textContent,
        evidence: [...document.querySelectorAll('#result-evidence details')].map((element) => element.textContent) },
    };
  }, key);
  const timings = [...raw.navigation, ...raw.resources];
  return { raw, metrics: metrics(raw), resources: {
    count: timings.length, encodedBodyBytes: timings.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
    decodedBodyBytes: timings.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    transferBytes: timings.reduce((sum, entry) => sum + entry.transferSize, 0),
    cdpRequestCount: session.network.requests.length,
    httpRequestCount: session.network.requests.filter((request) => /^https?:/.test(request.url)).length,
    blobRequestCount: session.network.requests.filter((request) => request.url.startsWith('blob:')).length,
    cdpEncodedTransferBytes: session.network.completed.reduce((sum, entry) => sum + entry.encodedDataLength, 0),
    cacheZeroTransferEntries: timings.filter((entry) => entry.transferSize === 0).map((entry) => entry.name),
  }, network: session.network, errors: session.errors };
}
async function exportEvidence(page) {
  await page.screenshot({ path: path.join(output, 'final-desktop-portrait.png'), fullPage: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const download = await pending;
  const exportPath = path.join(output, 'final-export.png');
  await download.saveAs(exportPath);
  const bytes = await fs.readFile(exportPath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1080, 1350]);
  const content = await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
    const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0); image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let opaque = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 255) opaque++;
      if (offset % 128 === 0) colors.add(`${pixels[offset] >> 3},${pixels[offset + 1] >> 3},${pixels[offset + 2] >> 3}`);
    }
    return { width: canvas.width, height: canvas.height, opaquePixels: opaque, sampledColorBuckets: colors.size };
  }, bytes.toString('base64'));
  assert(content.sampledColorBuckets > 100 && content.opaquePixels === 1080 * 1350);
  return { suggestedFilename: download.suggestedFilename(), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), content };
}
async function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, { ...node, selfUs: 0 }]));
  for (let index = 0; index < (profile.samples?.length ?? 0); index++) nodes.get(profile.samples[index]).selfUs += profile.timeDeltas[index];
  const totalUs = profile.timeDeltas.reduce((sum, value) => sum + value, 0);
  const sources = new Map();
  return { totalMs: totalUs / 1000, sampleCount: profile.samples.length, topSelf: await Promise.all([...nodes.values()]
    .sort((a, b) => b.selfUs - a.selfUs).slice(0, 30).map(async (node) => {
      const frame = node.callFrame;
      let snippet = null;
      if (frame.url.startsWith(baseURL.origin + '/assets/')) {
        const local = path.join(root, 'dist', new URL(frame.url).pathname);
        if (!sources.has(local)) sources.set(local, (await fs.readFile(local, 'utf8')).split('\n'));
        const line = sources.get(local)[frame.lineNumber] ?? '';
        snippet = line.slice(Math.max(0, frame.columnNumber - 100), frame.columnNumber + 300);
      }
      return { function: frame.functionName || '(anonymous)', url: frame.url, line: frame.lineNumber + 1, column: frame.columnNumber + 1,
        selfMs: node.selfUs / 1000, selfPercent: node.selfUs / totalUs * 100, snippet };
    })) };
}

const runs = [];
try {
  for (let pair = 1; pair <= pairs; pair++) {
    for (const variant of variants) {
      console.log(`Starting ${variant.name} ${pair}/${pairs}`);
      const session = await setup(variant);
      session.variant = variant;
      const run = { variant: variant.name, pair, ordinal: runs.length + 1, startedAt: new Date().toISOString(), host: machine() };
      try {
        await ready(session.page);
        run.input = await inputAndFinish(session);
        Object.assign(run, await snapshot(session));
        const checks = run.raw.checks;
        assert(run.raw.initialDraws.calls > 0 && run.raw.initialDraws.triangles > 0, 'Readiness must follow actual default-framebuffer rendering.');
        assert(checks.baseline.opaquePixels > 1000 && checks.baseline.sampledColorBuckets > 100, 'The real baseline must not be blank.');
        assert(checks.painted.changedPixels > 100 && checks.painted.leftChangedPixels > 30 && checks.painted.rightChangedPixels > 30, 'Both real mirrored cheeks must change pixels.');
        assert(checks.painted.changedPixels < checks.baseline.opaquePixels * 0.15
          && checks.painted.changedBoundsBottomOrigin.minY > checks.painted.height * 0.3
          && checks.painted.changedBoundsBottomOrigin.maxY < checks.painted.height * 0.6,
        'The changed pixels must be localized to the cheeks, not a whole-scene change.');
        assert(run.raw.events.filter((event) => event.type === 'pointerdown').every((event) => event.trusted), 'Use actual browser input.');
        assert.equal(Object.values(session.errors).flat().length, 0, 'No runtime or network errors are allowed.');
        run.readinessBudgetMs = variant.readinessBudgetMs;
        run.readinessBudgetMet = run.metrics.readinessMs <= variant.readinessBudgetMs;
        run.workVerified = true;
        if (!probe && pair === pairs && variant.name === 'desktop') run.export = await exportEvidence(session.page);
      } catch (error) {
        run.failure = { message: error.message, stack: error.stack };
        try { Object.assign(run, await snapshot(session)); } catch {}
      } finally {
        await session.context.close();
      }
      runs.push(run);
      await json(`${probe ? 'probe-' : ''}run-${String(run.ordinal).padStart(2, '0')}-${variant.name}.json`, run);
      console.log(JSON.stringify({ variant: run.variant, pair, readyMs: run.metrics?.readinessMs,
        readinessBudgetMet: run.readinessBudgetMet, failure: run.failure?.message,
        strokeMs: run.metrics?.strokeInputToCommitRenderSubmissionMs, finishMs: run.metrics?.finishInputToResultRenderSubmissionMs }));
    }
  }
  if (!probe) {
    console.log('Starting separate unreported warm profile');
    const session = await setup(variants[0], false);
    session.variant = variants[0];
    try {
      await ready(session.page);
      await session.cdp.send('Profiler.enable');
      await session.cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      const cpuBefore = await browserCDP.send('SystemInfo.getProcessInfo');
      const hostBefore = machine();
      const profileStart = performance.now();
      await session.cdp.send('Profiler.start');
      await ready(session.page, true);
      const input = await inputAndFinish(session);
      const { profile } = await session.cdp.send('Profiler.stop');
      const wallMs = performance.now() - profileStart;
      const cpuAfter = await browserCDP.send('SystemInfo.getProcessInfo');
      const profileRun = await snapshot(session);
      const cpu = cpuAfter.processInfo.map((item) => ({ type: item.type, id: item.id,
        cpuSeconds: item.cpuTime - (cpuBefore.processInfo.find((before) => before.id === item.id)?.cpuTime ?? item.cpuTime) }));
      await json('warm-profile.cpuprofile', profile);
      await json('warm-profile-summary.json', { unreportedWarmRun: true, wallMs, input,
        cpu, hostBefore, hostAfter: machine(), summary: await profileSummary(profile), work: profileRun });
    } catch (error) {
      await json('warm-profile-failure.json', { message: error.message, stack: error.stack });
    } finally { await session.context.close(); }
  }
} finally {
  await browser.close();
  await json('environment-after.json', machine());
}
const byVariant = variants.map((variant) => {
  const selected = runs.filter((run) => run.variant === variant.name);
  const fields = ['readyMarkerMs', 'readinessMs', 'pointerDownHandlerMs', 'pointerUpAdmissionAndReplayHandlerMs', 'firstInputToDraftRenderSubmissionMs',
    'pointerUpToCommitRenderSubmissionMs', 'pointerUpToCommittedPixelsAvailableMs', 'strokeInputToCommitRenderSubmissionMs',
    'finishHandlerMs', 'finishInputToResultRenderSubmissionMs', 'finishInputToNextFrameOpportunityMs',
    'actualRenderedFramesDuringStroke', 'actualDraftRenderedFrames'];
  return { variant: variant.name, runs: selected.length, errors: selected.filter((run) => run.failure).length,
    workVerified: selected.filter((run) => run.workVerified).length, readinessBudgetMs: variant.readinessBudgetMs,
    readinessBudgetFailures: selected.filter((run) => !run.readinessBudgetMet).length,
    metrics: Object.fromEntries(fields.map((field) => [field, distribution(selected.map((run) => run.metrics?.[field]))])),
    resources: Object.fromEntries(['count', 'encodedBodyBytes', 'decodedBodyBytes', 'transferBytes', 'httpRequestCount', 'blobRequestCount', 'cdpRequestCount', 'cdpEncodedTransferBytes']
      .map((field) => [field, distribution(selected.map((run) => run.resources?.[field]))])) };
});
await json(probe ? 'probe-summary.json' : 'summary.json', { probe, totalRuns: runs.length, byVariant,
  note: 'This script supplies measurements, not the final performance gate decision. Readiness and committed-pixels times intentionally include their readback barrier/copy, but exclude pixel analysis. CPU handler/render timings exclude readbacks. Warm profile and PNG export are separate from reported timings.' });
console.log(JSON.stringify(byVariant, null, 2));
if (runs.some((run) => run.failure)) process.exitCode = 1;
