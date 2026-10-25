#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { build, preview } from 'vite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === script;
const { values: options } = parseArgs({ args: isMain ? process.argv.slice(2) : [], options: {
  baseline: { type: 'string', default: 'benchmarks/analysis-baseline/paint.ts' },
  out: { type: 'string', default: 'tmp/verification/performance-final/measured' },
  probe: { type: 'boolean', default: false },
  'skip-readiness': { type: 'boolean', default: false },
  'self-check': { type: 'boolean', default: false },
  serve: { type: 'string' },
  port: { type: 'string' },
  help: { type: 'boolean' },
} });
const output = path.resolve(root, options.out);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const command = (program, argv = []) => execFileSync(program, argv, { encoding: 'utf8' }).trim();
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const flags = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const key = 'make1up.disposable.analysis-browser-bench';
const variants = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false, budgetMs: 10_000 },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, budgetMs: 20_000 },
];
const sides = [
  { name: 'baseline', port: 4165 },
  { name: 'current', port: 4166 },
];

function machine() {
  return {
    at: new Date().toISOString(), uptime: command('uptime'), cores: Number(command('nproc')),
    processes: command('ps', ['-eo', 'pid,ppid,pcpu,pmem,stat,comm,args', '--sort=-pcpu']).split('\n').slice(0, 26),
  };
}

async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(path.join(directory, entry.name), name));
    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(directory, entry.name));
      result[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  return result;
}

async function exists(filename) {
  try { await fs.access(filename); return true; } catch { return false; }
}

function statistics(values) {
  assert(values.every(Number.isFinite), 'A timing endpoint is missing.');
  const sorted = values.toSorted((a, b) => a - b);
  return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
}

function instrument({ storageKey, verifyPixels }) {
  const state = { verifyPixels, readyMarkerAt: null, readyAt: null, events: [], frames: [], readbacks: [],
    checks: {}, initialDraws: 0, paintedTarget: null, resultAt: null, longTasks: [] };
  Object.defineProperty(document, Symbol.for(storageKey), { value: state });
  let gl = null;
  let frame = null;
  let previous = null;
  let baseline = null;
  const bindings = new WeakMap();
  const nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, settings) {
    const measured = this instanceof HTMLElement && ['finish-button', 'guided-button'].includes(this.id) && type === 'click';
    if (!measured || typeof listener !== 'function') return nativeAdd.call(this, type, listener, settings);
    const id = this.id;
    return nativeAdd.call(this, type, function (event) {
      const item = { target: id, trusted: event.isTrusted, inputAt: event.timeStamp, start: performance.now(),
        gesturesBefore: document.querySelector('#gesture-count')?.textContent };
      try { return listener.call(this, event); }
      finally {
        item.end = performance.now();
        item.duration = item.end - item.start;
        item.gesturesAfter = document.querySelector('#gesture-count')?.textContent;
        state.events.push(item);
      }
    }, settings);
  };
  const nativeContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = nativeContext.apply(this, args);
    if (this.id === 'portrait-canvas' && /^webgl/.test(args[0]) && context) {
      gl = context;
      bindings.set(gl, null);
    }
    return context;
  };
  for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Constructor) continue;
    const prototype = Constructor.prototype;
    const nativeBind = prototype.bindFramebuffer;
    prototype.bindFramebuffer = function (target, framebuffer) {
      const result = nativeBind.call(this, target, framebuffer);
      if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) bindings.set(this, framebuffer);
      return result;
    };
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const nativeDraw = prototype[method];
      if (!nativeDraw) continue;
      prototype[method] = function (...args) {
        const result = nativeDraw.apply(this, args);
        if (this === gl && bindings.get(this) === null) {
          if (frame) { frame.draws++; frame.lastDrawAt = performance.now(); }
          else state.initialDraws++;
        }
        return result;
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
    let opaque = 0;
    let changed = 0;
    let left = 0;
    let right = 0;
    const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 128) {
        opaque++;
        if (offset % 128 === 0) colors.add(`${pixels[offset] >> 3},${pixels[offset + 1] >> 3},${pixels[offset + 2] >> 3}`);
      }
      if (name === 'painted' && baseline?.length === pixels.length && Math.max(
        Math.abs(pixels[offset] - baseline[offset]), Math.abs(pixels[offset + 1] - baseline[offset + 1]),
        Math.abs(pixels[offset + 2] - baseline[offset + 2])) >= 3) {
        changed++;
        if (offset / 4 % width < width / 2) left++; else right++;
      }
    }
    if (name === 'baseline') baseline = pixels;
    state.checks[name] = { width, height, opaquePixels: opaque, sampledColorBuckets: colors.size,
      changedPixels: changed, leftChangedPixels: left, rightChangedPixels: right };
    state.readbacks.push({ name, start, pixelsAt, end: performance.now() });
  }
  const nativeRAF = requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return nativeRAF.call(window, function (timestamp) {
      const start = performance.now();
      if (previous && previous.nextOpportunityAt === null) previous.nextOpportunityAt = start;
      const item = { start, phase: document.querySelector('#portrait-stage')?.dataset.phase,
        draws: 0, lastDrawAt: null, nextOpportunityAt: null };
      frame = item;
      try { return callback(timestamp); }
      finally {
        item.end = performance.now();
        frame = null;
        if (item.draws) {
          state.frames.push(item);
          previous = item;
          if (state.paintedTarget && document.querySelector('#gesture-count')?.textContent === state.paintedTarget) {
            if (verifyPixels) readback('painted');
            state.paintedTarget = null;
          }
        }
      }
    });
  };
  new MutationObserver(() => {
    if (state.readyMarkerAt === null && document.querySelector('#portrait-stage')?.dataset.state === 'ready') {
      state.readyMarkerAt = performance.now();
      if (verifyPixels) readback('baseline');
      else state.checks.baseline = { disabledForIndependentProfile: true };
    }
    if (state.resultAt === null && document.querySelector('#portrait-stage')?.dataset.phase === 'result') {
      state.resultAt = performance.now();
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map((entry) => entry.toJSON())))
      .observe({ type: 'longtask', buffered: true });
  }
}

async function paintPolicy(source) {
  const file = ts.createSourceFile('look.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, 'The look policy must parse as TypeScript.');
  const object = (node) => {
    while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
    assert(ts.isObjectLiteralExpression(node), 'The tool registry and its defaults must be object literals.');
    return node;
  };
  const properties = (node) => object(node).properties.map((property) => {
    assert(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name), 'Expected explicit registry properties.');
    return property;
  });
  const registryNames = ['palette', 'regions', 'tools', 'themes'];
  const statements = file.statements.filter(ts.isVariableStatement).flatMap((statement) => {
    const declarations = [...statement.declarationList.declarations]
      .filter((item) => ts.isIdentifier(item.name) && registryNames.includes(item.name.text));
    return declarations.length ? [ts.factory.updateVariableStatement(statement, statement.modifiers,
      ts.factory.updateVariableDeclarationList(statement.declarationList, declarations))] : [];
  });
  const declarations = statements.flatMap((statement) => [...statement.declarationList.declarations]);
  assert.deepEqual(declarations.map((item) => item.name.text).toSorted(), registryNames.toSorted(),
    'Each paint policy registry must be declared exactly once.');
  const declaration = declarations.find((item) => item.name.text === 'tools');
  assert(declaration?.initializer, 'The exported tool registry is required.');
  const approvedRegions = { blush: 'valid', shadow: 'valid', lipstick: 'lips', liner: 'valid', sparkle: 'valid', erase: 'valid', blend: 'valid' };
  const ignoredValues = new Set();
  for (const tool of properties(declaration.initializer)) {
    const fields = properties(tool.initializer);
    const region = fields.find((property) => property.name.text === 'region');
    assert(region && Object.hasOwn(approvedRegions, tool.name.text) && ts.isStringLiteral(region.initializer),
      'Every tool needs one approved paint region.');
    assert.equal(region.initializer.text, approvedRegions[tool.name.text], 'The approved paint region must match.');
    const defaults = fields.find((property) => property.name.text === 'defaults');
    assert(defaults, `Missing defaults for ${tool.name.text}.`);
    const settings = properties(defaults.initializer);
    assert.deepEqual(settings.map((property) => property.name.text).toSorted(), ['color', 'finish', 'opacity', 'radius', 'softness']);
    for (const setting of settings) {
      const value = setting.initializer;
      const paletteColor = ts.isPropertyAccessExpression(value) && value.name.text === 'color'
        && ts.isPropertyAccessExpression(value.expression) && ts.isIdentifier(value.expression.expression)
        && value.expression.expression.text === 'palette';
      assert(setting.name.text === 'color' ? ts.isStringLiteral(value) || paletteColor : ts.isNumericLiteral(value),
        'Only literal interaction defaults or palette color references can be excluded from policy.');
      ignoredValues.add(value);
    }
  }
  const transformed = ts.transform(ts.factory.updateSourceFile(file, statements), [(context) => {
    const visit = (node) => ignoredValues.has(node) ? ts.factory.createNull()
      : ts.visitEachChild(node, visit, context);
    return (node) => ts.visitNode(node, visit);
  }]);
  const structure = ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]);
  transformed.dispose();
  const compiled = ts.transpileModule(structure, { fileName: 'look.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.equal(compiled.diagnostics?.length, 0, 'The look policy must transpile.');
  const exported = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
  const data = Object.fromEntries(registryNames.map((name) => {
    assert(Object.hasOwn(exported, name), `The ${name} policy registry must be exported.`);
    return [name, exported[name]];
  }));
  data.tools = Object.fromEntries(Object.entries(data.tools).map(([name, { defaults: _defaults, ...policy }]) => [name, policy]));
  return { data, structure };
}

export async function assertPaintPolicy(original, current) {
  assert.deepEqual(await paintPolicy(original), await paintPolicy(current),
    'The approved paint registry must match except tool interaction defaults.');
}

function analyzePaintSegments(source) {
  const file = ts.createSourceFile('paint.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, 'The paint source must parse as TypeScript.');
  const functions = file.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'analyzePaint');
  assert.equal(functions.length, 1, 'Exactly one analyzePaint function is required.');
  const analyzer = functions[0];
  assert(analyzer.body && analyzer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    'The complete exported analyzePaint function is required.');
  const start = analyzer.getStart(file);
  const end = analyzer.getEnd();
  return { before: source.slice(0, start), analyzePaint: source.slice(start, end), after: source.slice(end) };
}

export function graftAnalyzePaint(original, current) {
  const frozen = analyzePaintSegments(original);
  const optimized = analyzePaintSegments(current);
  assert.notEqual(frozen.analyzePaint, optimized.analyzePaint, 'The saved baseline must not be the optimized analyzer.');
  const baseline = optimized.before + frozen.analyzePaint + optimized.after;
  const grafted = analyzePaintSegments(baseline);
  assert.equal(grafted.before, optimized.before, 'Isolated code before analyzePaint differs.');
  assert.equal(grafted.after, optimized.after, 'Isolated code after analyzePaint differs.');
  assert.equal(grafted.analyzePaint, frozen.analyzePaint, 'The isolated baseline must use the frozen analyzer unchanged.');
  return baseline;
}

async function comparisonSources(baselinePath) {
  const savedLook = path.join(path.dirname(baselinePath), 'look.ts');
  if (!await exists(baselinePath) || !await exists(savedLook)) {
    throw new Error(`Missing saved baseline at ${baselinePath}, or its sibling look.ts. Supply --baseline PATH/paint.ts with the preserved original modules. The current analyzer is never used as a fallback.`);
  }
  const original = await fs.readFile(baselinePath, 'utf8');
  const current = await fs.readFile(path.join(root, 'src/paint.ts'), 'utf8');
  const look = await fs.readFile(savedLook, 'utf8');
  const currentLook = await fs.readFile(path.join(root, 'src/look.ts'), 'utf8');
  const savedManifest = path.join(path.dirname(baselinePath), 'manifest.json');
  const baselineHashes = { 'paint.ts': sha256(original), 'look.ts': sha256(look) };
  if (await exists(savedManifest)) assert.deepEqual(baselineHashes, JSON.parse(await fs.readFile(savedManifest, 'utf8')).sources);
  await paintPolicy(currentLook);
  const baselinePaint = graftAnalyzePaint(original, current);
  return { original, current, look, currentLook, baselineHashes, baselinePaint };
}

async function selfCheck() {
  const { original, current, currentLook, baselinePaint } = await comparisonSources(path.resolve(root, options.baseline));
  assert.equal(graftAnalyzePaint(
    'export function analyzePaint() { return 1; }\nfunction oldPainter() {}\n',
    'export function beginStroke() {}\nexport function analyzePaint() { return 2; }\nfunction currentPainter() {}\n'),
  'export function beginStroke() {}\nexport function analyzePaint() { return 1; }\nfunction currentPainter() {}\n');
  assert.equal(analyzePaintSegments(baselinePaint).analyzePaint, analyzePaintSegments(original).analyzePaint);
  assert.equal(baselinePaint.includes('export function beginStroke('), true, 'The graft must retain the current paint API.');
  assert.throws(() => graftAnalyzePaint(current, current), /The saved baseline must not be the optimized analyzer/);
  assert.throws(() => graftAnalyzePaint('export function missing() {}', current), /Exactly one analyzePaint function is required/);
  await assertPaintPolicy(currentLook, currentLook.replace('radius: 0.045', 'radius: 0.05')
    + '\nexport const unrelatedDocumentSettings = { version: 2 };\n');
  const policyChanges = [
    ['color: "#cc5075"', 'color: "#000000"'],
    ['cheeks: { label: "Cheeks" }', 'cheeks: { label: "Changed cheeks" }'],
    ['minimumCoverage: 0.005', 'minimumCoverage: 0.01'],
    ['operation: "pigment", region:', 'operation: "erase", region:'],
    ['region: "valid"', 'region: "cheeks"'],
    ['region: "lips"', 'region: "valid"'],
    ['tip: "round", placement: "continuous"', 'tip: "star", placement: "continuous"'],
    ['tip: "round", placement: "continuous"', 'tip: "round", placement: "stamp"'],
  ];
  for (const [before, after] of policyChanges) {
    assert(currentLook.includes(before), `Missing self-check input ${before}.`);
    await assert.rejects(assertPaintPolicy(currentLook, currentLook.replace(before, after)), /The approved paint/);
  }
  console.log('Analysis source self-check passed. Frozen analysis hashes, analyzer graft, current API, and the single tool registry verified. Both isolated apps use the current v2 document and painter. No builds, browsers, or performance measurements.');
}

async function isolate(baselinePath) {
  const { current, currentLook, baselineHashes, baselinePaint } = await comparisonSources(baselinePath);
  assert(!await exists(output), `Refusing to overwrite ${output}. Choose a new --out directory.`);
  const allowed = path.join(root, 'tmp/verification/performance-final') + path.sep;
  assert(output.startsWith(allowed), `--out must be a new child of ${allowed}`);
  await fs.mkdir(output, { recursive: true });
  const sourceHashes = { src: await hashes(path.join(root, 'src')), public: await hashes(path.join(root, 'public')),
    art: await hashes(path.join(root, 'art')), index: sha256(await fs.readFile(path.join(root, 'index.html'))) };
  const sharedDist = await hashes(path.join(root, 'dist'));
  const log = [];
  for (const side of sides) {
    side.source = path.join(output, 'builds', side.name, 'source');
    side.dist = path.join(output, 'builds', side.name, 'dist');
    side.url = `http://127.0.0.1:${side.port}/`;
    await fs.mkdir(side.source, { recursive: true });
    await fs.cp(path.join(root, 'src'), path.join(side.source, 'src'), { recursive: true });
    await fs.cp(path.join(root, 'public'), path.join(side.source, 'public'), { recursive: true });
    await fs.cp(path.join(root, 'art'), path.join(side.source, 'art'), { recursive: true });
    await fs.copyFile(path.join(root, 'index.html'), path.join(side.source, 'index.html'));
    await fs.copyFile(path.join(root, 'package.json'), path.join(side.source, 'package.json'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(side.source, 'node_modules'), 'dir');
    if (side.name === 'baseline') await fs.writeFile(path.join(side.source, 'src/paint.ts'), baselinePaint);
    await build({ configFile: false, root: side.source, mode: 'production',
      build: { outDir: side.dist, emptyOutDir: true, sourcemap: 'hidden' },
      customLogger: { info: (message) => { log.push(message); }, warn: (message) => { log.push(message); },
        warnOnce: (message) => { log.push(message); }, error: (message) => { log.push(message); },
        clearScreen() {}, hasErrorLogged() { return false; }, hasWarned: false } });
    side.sources = await hashes(path.join(side.source, 'src'));
    side.bundles = await hashes(path.join(side.dist, 'assets'));
    const html = await fs.readFile(path.join(side.dist, 'index.html'), 'utf8');
    side.entry = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert(side.entry, 'A release entry is required.');
    side.assetHashes = await hashes(side.dist);
  }
  const otherSources = (side) => Object.fromEntries(Object.entries(side.sources).filter(([name]) => name !== 'paint.ts'));
  assert.deepEqual(otherSources(sides[0]), otherSources(sides[1]), 'All isolated sources outside paint.ts must be identical.');
  assert.equal(sides[1].sources['look.ts'].sha256, sha256(currentLook), 'The isolated look source must match the verified paint policy.');
  for (const side of sides) assert.equal(await fs.readFile(path.join(side.source, 'src/paint.ts'), 'utf8'),
    side.name === 'baseline' ? baselinePaint : current, 'The isolated paint source must match the verified analyzer graft.');
  const nonCode = (side) => Object.fromEntries(Object.entries(side.assetHashes).filter(([name]) => !name.endsWith('.js') && !name.endsWith('.map') && name !== 'index.html'));
  assert.deepEqual(nonCode(sides[0]), nonCode(sides[1]), 'The asset, font, and CSS outputs must be identical.');
  await fs.writeFile(path.join(output, 'build.log'), log.join('\n') + '\n');
  const result = { baselinePath, baselineHashes, isolatedBaselinePaintSha256: sha256(baselinePaint),
    baselineConstruction: 'Current paint.ts with only the unchanged frozen baseline analyzePaint function substituted.',
    currentPaintSha256: sha256(current), currentLookSha256: sha256(currentLook),
    scriptSha256: sha256(await fs.readFile(script)), sourceHashes, sharedDist, sides,
    verified: { onlyAnalyzePaintDiffers: true, paintPolicyIdenticalExceptToolDefaults: true,
      isolatedBuildLookSourcesIdentical: true, assetFontCssOutputsIdentical: true },
    build: { configFile: false, mode: 'production', minify: 'Vite production default', sourcemap: 'hidden',
      vite: JSON.parse(await fs.readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version } };
  await json('source-build-verification.json', result);
  return result;
}

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function startPreviews(owned) {
  try { command('tmux', ['list-sessions']); } catch { /* The first owned preview can create the tmux server. */ }
  for (const side of sides) {
    await freePort(side.port);
    const name = `make1up-perf-final-${side.name}-${process.pid}`;
    const log = `/tmp/pi-tmux-${name}.log`;
    const shell = `cd ${quote(root)} && exec ${quote(process.execPath)} ${quote(script)} --serve ${quote(side.source)} --port ${side.port} > ${quote(log)} 2>&1`;
    command('tmux', ['new-session', '-d', '-s', name, shell]);
    const item = { name, log, port: side.port, pid: Number(command('tmux', ['display-message', '-p', '-t', name, '#{pane_pid}'])) };
    owned.push(item);
    console.log(`Preview ${side.name}.\ntmux attach -t ${name}\ntmux capture-pane -p -J -t ${name} -S -200\ntail -f ${log}`);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(side.url);
        const text = await response.text();
        assert(response.ok && text.includes(side.entry));
        ready = true;
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert(ready, `Preview did not start. Read ${log}.`);
  }
}

async function setup(browser, side, variant, verifyPixels) {
  const context = await browser.newContext({ viewport: variant.viewport, isMobile: variant.isMobile, hasTouch: variant.hasTouch,
    deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', acceptDownloads: true, serviceWorkers: 'block' });
  const errors = { page: [], console: [], network: [], http: [], external: [] };
  await context.route((url) => ['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(side.url).origin, async (route) => {
    errors.external.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await context.addInitScript(instrument, { storageKey: key, verifyPixels });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (error) => errors.page.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.console.push(message.text()); });
  page.on('requestfailed', (request) => errors.network.push({ url: request.url(), reason: request.failure()?.errorText }));
  page.on('response', (response) => { if (!response.ok()) errors.http.push({ url: response.url(), status: response.status() }); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const network = [];
  cdp.on('Network.responseReceived', ({ response }) => network.push({ url: response.url, status: response.status,
    fromDiskCache: response.fromDiskCache, fromServiceWorker: response.fromServiceWorker }));
  return { context, page, cdp, errors, network, side, variant };
}

async function ready(session) {
  await session.page.goto(session.side.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await session.page.waitForFunction((storageKey) => document[Symbol.for(storageKey)]?.checks.baseline, key, { timeout: 60_000 });
  assert.equal(await session.page.locator('#portrait-stage').getAttribute('data-state'), 'ready');
  assert.equal(await session.page.locator('#gesture-count').textContent(), '0 gestures');
}

async function makeup(session) {
  const { page } = session;
  await page.locator('#brief-button').click();
  await page.locator('input[name="theme"][value="rose-editorial"]').check();
  await page.getByRole('button', { name: 'Apply brief', exact: true }).click();
  const settings = [
    { tool: 'blush', size: 0.06, opacity: 0.6, softness: 0.45, finish: 0.4 },
    { tool: 'lipstick', size: 0.04, opacity: 0.6, softness: 0.3, finish: 0.4 },
  ];
  for (let index = 0; index < settings.length; index++) {
    const brush = settings[index];
    await page.locator(`[data-tool="${brush.tool}"]`).click();
    for (const field of ['size', 'opacity', 'softness', 'finish']) {
      await page.locator(`#brush-${field}`).evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, brush[field]);
    }
    if (index === settings.length - 1) await page.evaluate((storageKey) => {
      document[Symbol.for(storageKey)].paintedTarget = '2 gestures';
    }, key);
    await page.locator('#guided-button').click();
    assert.equal(await page.locator('#gesture-count').textContent(), `${index + 1} ${index ? 'gestures' : 'gesture'}`);
  }
  await page.waitForFunction((storageKey) => document[Symbol.for(storageKey)]?.paintedTarget === null, key);
  assert(await page.locator('#undo-button').isEnabled(), 'Captured gestures must be undoable.');
  return settings;
}

async function finish(session, browserCDP) {
  await session.cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  const rendererBefore = (await session.cdp.send('Performance.getMetrics')).metrics;
  const cpuBefore = await browserCDP.send('SystemInfo.getProcessInfo');
  const runnerCPU = process.cpuUsage();
  const start = performance.now();
  await session.page.locator('#finish-button').click();
  await session.page.waitForFunction((storageKey) => document[Symbol.for(storageKey)]?.frames.some(
    (frame) => frame.phase === 'result' && frame.draws > 0 && frame.nextOpportunityAt !== null), key);
  const wallMs = performance.now() - start;
  const runner = process.cpuUsage(runnerCPU);
  const cpuAfter = await browserCDP.send('SystemInfo.getProcessInfo');
  const rendererAfter = (await session.cdp.send('Performance.getMetrics')).metrics;
  const rendererThreadMetricsMs = Object.fromEntries(['ThreadTime', 'TaskDuration', 'ScriptDuration'].map((name) => [name,
    ((rendererAfter.find((item) => item.name === name)?.value ?? 0) - (rendererBefore.find((item) => item.name === name)?.value ?? 0)) * 1000]));
  const processes = cpuAfter.processInfo.map((item) => ({ id: item.id, type: item.type,
    cpuMs: (item.cpuTime - (cpuBefore.processInfo.find((before) => before.id === item.id)?.cpuTime ?? item.cpuTime)) * 1000 }));
  return { surroundingAutomationWallMs: wallMs, runnerCPUMs: (runner.user + runner.system) / 1000, processes,
    rendererThreadMetricsMs, rendererMetricTimeDomain: 'threadTicks',
    scope: 'CPU observations surround Playwright click dispatch through observation of the next result-frame opportunity, plus the counter queries. They are not the exact handler CPU interval. Renderer ThreadTime is main-thread CPU. Process CPU includes other threads, and software-GPU CPU can run in parallel.' };
}

async function capturedLook(page) {
  await page.locator('#share-button').click();
  await page.waitForFunction(() => document.querySelector('#share-url')?.value.includes('#make1up='));
  const url = await page.locator('#share-url').inputValue();
  await page.getByRole('button', { name: 'Close share link', exact: true }).click();
  const match = /^#make1up=v1\.([dj])\.([A-Za-z0-9_-]+)$/.exec(new URL(url).hash);
  assert(match, 'The real application must serialize the captured makeup.');
  const bytes = Buffer.from(match[2], 'base64url');
  const look = JSON.parse((match[1] === 'd' ? inflateSync(bytes) : bytes).toString('utf8'));
  assert.equal(look.strokes.length, 2);
  const asset = JSON.parse(await fs.readFile(path.join(root, 'public/face/v2/asset.json'), 'utf8'));
  const guide = (name) => asset.paintAtlas.landmarks[name].paintUV;
  const quantize = (paths) => paths.map((points) => points.map((uv) => uv.map((value) => Math.round(value * 65535) / 65535)));
  const expected = {
    version: 2, asset: 'rain-portrait-v2',
    identity: JSON.parse(await fs.readFile(path.join(root, 'art/avatar-v2.json'), 'utf8')).defaults,
    strokes: [
      { brush: { tool: 'blush', color: '#cc5075', radius: 0.06, opacity: 0.6, softness: 0.45, finish: 0.4 },
        paths: quantize(['cheekLeft', 'cheekRight'].map((name) => {
          const [u, v] = guide(name);
          return [[u - 0.016, v], [u, v], [u + 0.016, v]];
        })) },
      { brush: { tool: 'lipstick', color: '#cc5075', radius: 0.04, opacity: 0.6, softness: 0.3, finish: 0.4 },
        paths: quantize([[guide('lipsRightCorner'), guide('lipsCenter'), guide('lipsLeftCorner')]]) },
    ],
  };
  assert.deepEqual(normalizeLook(look), expected, 'The actual application must capture the exact known makeup at the published landmarks.');
  return look;
}

async function snapshot(session) {
  const raw = await session.page.evaluate((storageKey) => ({ ...document[Symbol.for(storageKey)],
    gestures: document.querySelector('#gesture-count')?.textContent,
    result: { phase: document.querySelector('#portrait-stage')?.dataset.phase,
      score: document.querySelector('[data-testid="brief-score"]')?.textContent,
      evidence: [...document.querySelectorAll('#result-evidence details')].map((item) => item.textContent) },
    resources: [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].map((entry) => entry.toJSON()),
  }), key);
  const clicks = raw.events.filter((event) => event.target === 'finish-button');
  const click = clicks[0];
  const result = click && raw.frames.find((frame) => frame.phase === 'result' && frame.start >= click.end);
  const metrics = { readyMarkerMs: raw.readyMarkerAt, readinessMs: raw.readyAt };
  if (click) {
    assert.equal(clicks.length, 1, 'Only the first actual Finish may be measured.');
    assert(click.trusted && click.inputAt <= click.start && result?.lastDrawAt > click.end);
    assert(!raw.readbacks.some((read) => read.start < result.lastDrawAt && read.end > click.inputAt), 'Readback verification must not overlap Finish timing.');
    Object.assign(metrics, { finishHandlerMs: click.duration, finishInputToResultRenderSubmissionMs: result.lastDrawAt - click.inputAt,
      finishHandlerStartToResultRenderSubmissionMs: result.lastDrawAt - click.start,
      finishInputToNextFrameOpportunityMs: result.nextOpportunityAt - click.inputAt,
      inputDispatchToHandlerMs: click.start - click.inputAt });
  }
  return { raw, metrics, errors: session.errors, network: session.network,
    resources: { requests: raw.resources.length,
      encodedBodyBytes: raw.resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      zeroTransferEntries: raw.resources.filter((entry) => entry.transferSize === 0).map((entry) => entry.name) } };
}

async function preserveFailureDiagnostics(run, session) {
  try { Object.assign(run, await snapshot(session)); }
  catch (error) { run.diagnosticFailure = { message: error.message, stack: error.stack }; }
}

function verify(run, pixels = true) {
  assert.equal(Object.values(run.errors).flat().length, 0, 'Runtime, HTTP, network, and external-request errors must be zero.');
  assert(run.network.every((response) => response.status >= 200 && response.status < 300 && !response.fromDiskCache && !response.fromServiceWorker));
  if (pixels) {
    assert(run.raw.initialDraws > 0, 'Ready must follow a real default-framebuffer draw.');
    assert(run.raw.checks.baseline.opaquePixels > 1000 && run.raw.checks.baseline.sampledColorBuckets > 100, 'The real portrait is blank.');
    if (run.raw.events.some((event) => event.target === 'finish-button')) {
      const painted = run.raw.checks.painted;
      assert(painted.changedPixels > 100 && painted.leftChangedPixels > 30 && painted.rightChangedPixels > 30, 'Both cheeks must contain actual changed pixels.');
    }
  }
  if (run.raw.events.some((event) => event.target === 'finish-button')) {
    assert.equal(run.raw.gestures, '2 gestures');
    assert.equal(run.raw.result.phase, 'result');
    assert.equal(run.raw.result.score, '100 / 100');
    assert.equal(run.raw.result.evidence.length, 4);
    const gestures = run.raw.events.filter((event) => event.target === 'guided-button');
    assert.equal(gestures.length, 2);
    assert(gestures.every((event) => event.trusted && event.gesturesBefore !== event.gesturesAfter));
  }
}

async function pngEvidence(session, prefix) {
  const pending = session.page.waitForEvent('download');
  await session.page.locator('#download-button').click();
  const download = await pending;
  const filename = path.join(output, `${prefix}-export.png`);
  await download.saveAs(filename);
  const bytes = await fs.readFile(filename);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1080, 1350]);
  const content = await session.page.evaluate(async (base64) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0); image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 255) opaque++;
      if (offset % 128 === 0) colors.add(`${pixels[offset] >> 3},${pixels[offset + 1] >> 3},${pixels[offset + 2] >> 3}`);
    }
    return { opaquePixels: opaque, sampledColorBuckets: colors.size };
  }, bytes.toString('base64'));
  assert(content.opaquePixels === 1080 * 1350 && content.sampledColorBuckets > 100, 'The downloaded end-state PNG must contain the real portrait.');
  const stagePath = path.join(output, `${prefix}-stage.png`);
  await session.page.locator('#portrait-stage').screenshot({ path: stagePath });
  return { path: filename, bytes: bytes.length, sha256: sha256(bytes), width: 1080, height: 1350,
    content, stage: { path: stagePath, sha256: sha256(await fs.readFile(stagePath)) } };
}

function normalizeLook(look) {
  return { ...look, strokes: look.strokes.map(({ id: _id, ...stroke }) => stroke) };
}

async function profileEvidence(profile, side) {
  const maps = new Map();
  const nodes = new Map(profile.nodes.map((node) => [node.id, { ...node, selfSamples: 0, inclusiveSamples: 0 }]));
  for (const node of nodes.values()) for (const child of node.children ?? []) nodes.get(child).parent = node.id;
  for (const id of profile.samples ?? []) {
    nodes.get(id).selfSamples++;
    let node = nodes.get(id);
    while (node) { node.inclusiveSamples++; node = nodes.get(node.parent); }
  }
  const mapped = [];
  for (const node of nodes.values()) {
    const frame = node.callFrame;
    let original = null;
    let snippet = null;
    if (frame.url.startsWith(side.url + 'assets/')) {
      const filename = path.join(side.dist, new URL(frame.url).pathname);
      const mapPath = filename + '.map';
      if (!maps.has(mapPath)) maps.set(mapPath, new TraceMap(JSON.parse(await fs.readFile(mapPath, 'utf8'))));
      const map = maps.get(mapPath);
      original = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber });
      if (original.source) {
        const sourceIndex = map.sources.indexOf(original.source);
        const lines = map.sourcesContent[sourceIndex]?.split('\n');
        snippet = lines?.slice(Math.max(0, original.line - 2), original.line + 3).join('\n');
      }
    }
    mapped.push({ id: node.id, parent: node.parent, function: frame.functionName || '(anonymous)', url: frame.url,
      line: frame.lineNumber + 1, column: frame.columnNumber + 1, original, snippet,
      selfSamples: node.selfSamples, inclusiveSamples: node.inclusiveSamples });
  }
  return { excludedFromReportedTiming: true, samples: profile.samples?.length ?? 0,
    topSelf: mapped.toSorted((a, b) => b.selfSamples - a.selfSamples).slice(0, 30),
    application: mapped.filter((node) => node.original?.source?.includes('/source/src/')),
    mapHashes: Object.fromEntries(await Promise.all([...maps.keys()].map(async (name) => [name, sha256(await fs.readFile(name))]))) };
}

async function independentProfile(browser, browserCDP, pids) {
  const session = await setup(browser, sides[1], variants[0], false);
  const evidence = { excludedFromReportedTiming: true, verificationReadbacksDisabled: true, hostBefore: machine() };
  try {
    await session.cdp.send('Profiler.enable');
    await session.cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const setupCPU = await browserCDP.send('SystemInfo.getProcessInfo');
    await session.cdp.send('Profiler.start');
    await ready(session);
    evidence.settings = await makeup(session);
    const setupProfile = (await session.cdp.send('Profiler.stop')).profile;
    const setupAfter = await browserCDP.send('SystemInfo.getProcessInfo');
    await json('current-setup.cpuprofile', setupProfile);
    evidence.setup = await profileEvidence(setupProfile, sides[1]);
    evidence.setupProcessCPU = setupAfter.processInfo.map((item) => ({ type: item.type, id: item.id,
      cpuMs: (item.cpuTime - (setupCPU.processInfo.find((before) => before.id === item.id)?.cpuTime ?? item.cpuTime)) * 1000 }));
    await session.cdp.send('Profiler.start');
    evidence.finishProcessCPU = await finish(session, browserCDP);
    const finishProfile = (await session.cdp.send('Profiler.stop')).profile;
    await json('current-finish.cpuprofile', finishProfile);
    evidence.finish = await profileEvidence(finishProfile, sides[1]);
    evidence.look = await capturedLook(session.page);
    Object.assign(evidence, await snapshot(session));
    verify(evidence, false);
    assert.equal(evidence.raw.readbacks.length, 0, 'The independent profile must not contain verification readbacks.');
    evidence.workVerified = true;
  } finally {
    evidence.hostAfter = machine();
    evidence.processesBeforeClose = (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo;
    for (const item of evidence.processesBeforeClose) pids.set(item.id, item.type);
    await json('current-profile-evidence.json', evidence);
    await session.context.close();
  }
  return evidence;
}

async function cleanup(owned, browser, pids) {
  const result = { previews: [], browserProcesses: [], sharedDistUntouched: null };
  if (browser) await browser.close();
  for (const item of owned) {
    try { command('tmux', ['kill-session', '-t', item.name]); } catch { /* A failed preview can already have exited. */ }
    for (let attempt = 0; attempt < 50 && await exists(`/proc/${item.pid}`); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    const alive = await exists(`/proc/${item.pid}`);
    let portReleased = false;
    try { await freePort(item.port); portReleased = true; } catch {}
    result.previews.push({ ...item, alive, portReleased });
    if (await exists(item.log)) await fs.copyFile(item.log, path.join(output, `${item.name}.log`));
  }
  for (const [id, type] of pids) result.browserProcesses.push({ id, type, alive: await exists(`/proc/${id}`) });
  return result;
}

async function main() {
  if (options.help) {
    console.log('node scripts/bench-analysis-browser.mjs --baseline PATH/paint.ts --out tmp/verification/performance-final/NEW [--probe] [--skip-readiness]');
    console.log('Requires the complete preserved original paint.ts and sibling look.ts. A present baseline manifest is verified. Both apps use current source, with only the frozen analyzePaint substituted into the baseline app. Missing baselines fail.');
    console.log('--self-check verifies frozen hashes, analyzer grafting, and policy rejection without builds, previews, or browsers.');
    console.log('Builds isolated production apps under --out, starts owned tmux previews on 4165/4166, measures five fresh-context baseline/current Finish pairs, matches one exported PNG pair, profiles current separately, and collects five alternating current desktop/phone readiness pairs.');
    console.log('--probe collects one unreported calibration pair without profiles or readiness. Output must be new. Shared source, shared dist, and port 4175 are never written or stopped.');
    return;
  }
  if (options['self-check']) {
    await selfCheck();
    return;
  }
  if (options.serve) {
    await preview({ configFile: false, root: options.serve, build: { outDir: path.resolve(options.serve, '../dist') },
      preview: { host: '127.0.0.1', port: Number(options.port), strictPort: true } });
    return;
  }
  const source = await isolate(path.resolve(root, options.baseline));
  const owned = [];
  const pids = new Map();
  const finishRuns = [];
  const readinessRuns = [];
  let browser;
  let before;
  let after;
  let profile;
  let failure;
  try {
    await startPreviews(owned);
    before = machine();
    await json('environment-before.json', before);
    browser = await chromium.launch({ args: flags });
    const browserCDP = await browser.newBrowserCDPSession();
    const version = await browserCDP.send('Browser.getVersion');
    const gpu = await browserCDP.send('SystemInfo.getInfo');
    const rememberPids = async () => {
      for (const item of (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo) pids.set(item.id, item.type);
    };
    await json('manifest.json', { version, gpu: gpu.gpu, launchArgs: flags, variants, sides, probe: options.probe,
      scriptSha256: source.scriptSha256,
      claimUnderTest: 'The stateless analyzePaint change makes first real Finish faster with exactly the same captured makeup and result.',
      metric: 'Finish handler is the synchronous real click listener. Finish input to result render submission starts at the trusted click event timestamp and ends at the last real default-framebuffer draw return in the first result-phase frame. Both exclude all verification readbacks. This is CPU submission, not physical display latency.',
      readiness: 'Navigation start to return from a real framebuffer read after the compiled render. Includes readback/copy and excludes the following pixel-analysis loop. Fixed desktop 10 s and phone 20 s. Absolute current validity only.',
      cache: 'Fresh storage/context and disabled HTTP cache. Browser/GPU process, shader cache, OS page cache, and preview remain shared. Not a cold-machine measurement.',
      noise: 'Unrelated processes continue. No concurrent root full suite is scheduled. Interleaving reduces drift, not contention. No FPS, hardware GPU, or real-phone claim.',
      historicalDatasets: 'The original roughly 600 ms browser Finish and 509.9 ms warm Node analysis medians are separate datasets. Neither contributes a sample or an extrapolated speedup to this comparison.' });
    const pairs = options.probe ? 1 : 5;
    for (let pair = 1; pair <= pairs; pair++) {
      const paired = [];
      for (const side of sides) {
        console.log(`Finish ${pair}/${pairs} ${side.name}`);
        const session = await setup(browser, side, variants[0], true);
        const run = { pair, side: side.name, ordinal: finishRuns.length + 1, hostBefore: machine() };
        try {
          await ready(session);
          run.settings = await makeup(session);
          run.cpu = await finish(session, browserCDP);
          run.look = await capturedLook(session.page);
          Object.assign(run, await snapshot(session));
          verify(run);
          if (pair === 1) {
            run.png = await pngEvidence(session, side.name);
            Object.assign(run, await snapshot(session));
            verify(run);
          }
          run.workVerified = true;
          paired.push(run);
        } catch (error) {
          run.failure = { message: error.message, stack: error.stack };
          await preserveFailureDiagnostics(run, session);
          throw error;
        } finally {
          await rememberPids();
          run.hostAfter = machine();
          finishRuns.push(run);
          await json(`finish-${pair}-${side.name}.json`, run);
          await session.context.close();
        }
        console.log(JSON.stringify({ pair, side: side.name, handlerMs: run.metrics.finishHandlerMs,
          inputToResultSubmissionMs: run.metrics.finishInputToResultRenderSubmissionMs }));
      }
      assert.deepEqual(normalizeLook(paired[0].look), normalizeLook(paired[1].look), 'The captured makeup must be exactly equal, except gesture IDs.');
      assert.deepEqual(paired[0].raw.result, paired[1].raw.result, 'The score and every displayed criterion must be exactly equal.');
      assert.deepEqual(paired[0].raw.checks, paired[1].raw.checks, 'Initial and painted pixel evidence must match.');
      if (pair === 1) {
        assert.equal(paired[0].png.sha256, paired[1].png.sha256, 'The complete end-state PNGs must be byte-identical.');
        assert.equal(paired[0].png.stage.sha256, paired[1].png.stage.sha256, 'The final visible portrait stage PNGs must also be identical.');
        assert.deepEqual(await fs.readFile(paired[0].png.path), await fs.readFile(paired[1].png.path));
        await json('paired-correctness.json', { pair, sameCapturedMakeup: true, gestureIDsExcluded: true,
          sameFourCriteriaAndScore: true, score: paired[0].raw.result, sameEndStatePNG: true, png: paired.map((run) => run.png),
          actualPixels: paired[0].raw.checks, capturedLook: normalizeLook(paired[0].look) });
      }
    }
    if (!options.probe) {
      console.log('Separate current profiles. Excluded from timing samples.');
      profile = await independentProfile(browser, browserCDP, pids);
      await rememberPids();
      if (!options['skip-readiness']) for (let pair = 1; pair <= 5; pair++) for (const variant of variants) {
        console.log(`Readiness ${pair}/5 ${variant.name}`);
        const session = await setup(browser, sides[1], variant, true);
        const run = { pair, variant: variant.name, budgetMs: variant.budgetMs, hostBefore: machine() };
        try {
          await ready(session);
          Object.assign(run, await snapshot(session));
          verify(run);
          assert.equal(run.raw.events.length, 0, 'Readiness must exclude makeup and Finish analysis.');
          run.budgetMet = run.metrics.readinessMs <= variant.budgetMs;
          run.workVerified = true;
        } finally {
          await rememberPids();
          run.hostAfter = machine();
          readinessRuns.push(run);
          await json(`readiness-${pair}-${variant.name}.json`, run);
          await session.context.close();
        }
        console.log(JSON.stringify({ pair, variant: variant.name, readyMs: run.metrics.readinessMs, budgetMet: run.budgetMet }));
      }
    }
  } catch (error) {
    failure = { message: error.message, stack: error.stack };
    await json('failure.json', failure);
  } finally {
    after = machine();
    await json('environment-after.json', after);
    const cleaned = await cleanup(owned, browser, pids);
    cleaned.sourceUntouched = JSON.stringify(source.sourceHashes.src) === JSON.stringify(await hashes(path.join(root, 'src')));
    cleaned.publicUntouched = JSON.stringify(source.sourceHashes.public) === JSON.stringify(await hashes(path.join(root, 'public')));
    cleaned.artUntouched = JSON.stringify(source.sourceHashes.art) === JSON.stringify(await hashes(path.join(root, 'art')));
    cleaned.indexUntouched = source.sourceHashes.index === sha256(await fs.readFile(path.join(root, 'index.html')));
    cleaned.sharedDistUntouched = JSON.stringify(source.sharedDist) === JSON.stringify(await hashes(path.join(root, 'dist')));
    await json('cleanup.json', cleaned);
    assert(cleaned.sourceUntouched && cleaned.publicUntouched && cleaned.artUntouched && cleaned.indexUntouched && cleaned.sharedDistUntouched, 'Shared source, public, art, index, or dist changed during this run.');
    assert(cleaned.previews.every((item) => !item.alive && item.portReleased), 'An owned preview was not cleaned.');
    assert(cleaned.browserProcesses.every((item) => !item.alive), 'An owned browser process remains alive.');
  }
  const finishSummary = sides.map((side) => {
    const selected = finishRuns.filter((run) => run.side === side.name && run.workVerified);
    return { side: side.name, validRuns: selected.length,
      metrics: Object.fromEntries(['finishHandlerMs', 'finishInputToResultRenderSubmissionMs', 'finishInputToNextFrameOpportunityMs']
        .map((field) => [field, selected.length ? statistics(selected.map((run) => run.metrics[field])) : null])) };
  });
  const readinessSummary = variants.map((variant) => {
    const selected = readinessRuns.filter((run) => run.variant === variant.name && run.workVerified);
    return { variant: variant.name, validRuns: selected.length, budgetMs: variant.budgetMs,
      metrics: selected.length ? statistics(selected.map((run) => run.metrics.readinessMs)) : null,
      failures: selected.filter((run) => !run.budgetMet).length,
      verdict: selected.length !== 5 ? 'INCONCLUSIVE' : selected.every((run) => run.budgetMet) ? 'PASS' : 'FAIL',
      reason: selected.length !== 5 ? 'Five valid fresh-context samples were not collected.' : 'Absolute current readback-inclusive readiness against the original fixed budget. No causal comparison to historical contention.' };
  });
  const baseline = finishSummary[0].metrics.finishHandlerMs;
  const current = finishSummary[1].metrics.finishHandlerMs;
  const valid = !failure && !options.probe && finishSummary.every((side) => side.validRuns === 5) && profile?.workVerified;
  const baselineEndToEnd = finishSummary[0].metrics.finishInputToResultRenderSubmissionMs;
  const currentEndToEnd = finishSummary[1].metrics.finishInputToResultRenderSubmissionMs;
  const verdict = !valid ? 'inconclusive'
    : current.max < baseline.min && currentEndToEnd.max < baselineEndToEnd.min ? 'faster'
      : current.min > baseline.max && currentEndToEnd.min > baselineEndToEnd.max ? 'slower' : 'inconclusive';
  const summary = { probe: options.probe, verdict, finish: finishSummary, readiness: readinessSummary,
    readinessVerdict: readinessSummary.some((item) => item.verdict === 'FAIL') ? 'FAIL'
      : readinessSummary.every((item) => item.verdict === 'PASS') ? 'PASS' : 'INCONCLUSIVE',
    failure, hostBefore: before, hostAfter: after,
    rule: 'A difference is accepted only with five valid pairs, independent profile work, identical output, and nonoverlapping observed handler and end-to-end submission ranges. The profile must be reviewed to name the remaining limiter. Profiled timings and historical datasets are excluded.' };
  await json(options.probe ? 'probe-summary.json' : 'summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
  if (failure) throw new Error(failure.message);
}

if (isMain) main().catch((error) => {
  console.error(`Browser analysis benchmark failed. ${error.stack ?? error}`);
  process.exitCode = 1;
});
