import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: options } = parseArgs({ options: {
  baseline: { type: 'string', default: 'benchmarks/analysis-baseline/paint.ts' },
  out: { type: 'string' },
  profile: { type: 'string' },
  help: { type: 'boolean' },
} });
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const resolve = (name) => path.resolve(root, name);
const rounds = 5;
const fixtureNames = ['native-strokes', 'native-blank', 'native-dense', 'all-valid-dense'];

function environment() {
  return {
    at: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model,
    uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(),
    cores: Number(execFileSync('nproc', { encoding: 'utf8' }).trim()),
    processes: execFileSync('ps', ['-eo', 'pid,ppid,pcpu,pmem,stat,comm,args', '--sort=-pcpu'], { encoding: 'utf8' })
      .trim().split('\n').slice(0, 26),
  };
}

function dataModule(source, filename) {
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
  }, fileName: filename, reportDiagnostics: true });
  assert.equal(output.diagnostics?.length, 0, `TypeScript transpilation failed for ${filename}`);
  return output.outputText;
}

async function loadPaint(filename, side) {
  const lookPath = path.join(path.dirname(filename), 'look.ts');
  const paintSource = fs.readFileSync(filename, 'utf8');
  const lookSource = fs.readFileSync(lookPath, 'utf8');
  const sourceUrl = (name) => `${pathToFileURL(name).href}?analysis-bench=${side}`;
  const moduleUrl = (source, name) => `data:text/javascript;analysis-bench=${side};base64,${Buffer.from(`${source}\n//# sourceURL=${sourceUrl(name)}\n`).toString('base64')}`;
  const lookUrl = moduleUrl(dataModule(lookSource, lookPath), lookPath);
  let paintJS = dataModule(paintSource, filename);
  assert.equal(paintJS.match(/from ["']\.\/look["']/g)?.length, 1, 'Expected one pure paint registry import.');
  paintJS = paintJS.replace(/from ["']\.\/look["']/, `from ${JSON.stringify(lookUrl)}`);
  return {
    paint: await import(moduleUrl(paintJS, filename)), look: await import(lookUrl),
    paths: { paint: filename, look: lookPath },
    hashes: { 'paint.ts': sha256(paintSource), 'look.ts': sha256(lookSource) },
  };
}

function readRedMask(filename) {
  const png = fs.readFileSync(filename);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const size = png.readUInt32BE(16);
  assert.equal(size, 1024);
  assert.equal(png.readUInt32BE(20), size);
  assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0], 'The fixture decoder requires noninterlaced RGBA8 PNGs.');
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = size * 4;
  assert.equal(raw.length, size * (stride + 1));
  const pixels = new Uint8Array(size * stride);
  for (let y = 0; y < size; y += 1) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4, `Unsupported PNG row filter ${filter}.`);
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const left = x < 4 ? 0 : pixels[index - 4];
      const up = y === 0 ? 0 : pixels[index - stride];
      const upperLeft = y === 0 || x < 4 ? 0 : pixels[index - stride - 4];
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      pixels[index] = raw[y * (stride + 1) + x + 1] + predictor;
    }
  }
  const red = new Uint8Array(size * size);
  for (let index = 0; index < red.length; index += 1) {
    assert.equal(pixels[index * 4 + 3], 255, 'Mask alpha must be opaque for raw red and browser canvas red to agree.');
    red[index] = pixels[index * 4];
  }
  return { red, pngSha256: sha256(png) };
}

function value(result) {
  assert(result.ok, result.error);
  return result.value;
}

function fixtures(baseline, head) {
  const assetPath = resolve('public/face/v1/asset.json');
  const assetBytes = fs.readFileSync(assetPath);
  const asset = JSON.parse(assetBytes);
  assert.equal(asset.paint.textureSize, 1024);
  const images = Object.fromEntries(Object.entries(asset.paint.masks).map(([name, file]) => [
    name, readRedMask(resolve(`public/face/v1/${file}`)),
  ]));
  const merge = (left, right) => images[left].red.map((byte, index) => Math.max(byte, images[right].red[index]));
  const masks = value(head.paint.createPaintMasks({
    size: 1024, valid: images['paint-valid'].red, lips: images.lips.red,
    cheeks: merge('cheek-left', 'cheek-right'), lids: merge('eyelid-left', 'eyelid-right'),
  }));
  assert.deepEqual(value(baseline.paint.createPaintMasks(masks)), masks);
  const guide = (key) => asset.landmarks[key].paintUV;
  const cheeks = ['cheekLeft', 'cheekRight'].map((key) => {
    const [u, v] = guide(key);
    return [[u - 0.016, v], [u, v], [u + 0.016, v]];
  });
  const strokeInputs = [
    ['bench-cheeks', { ...head.look.defaultBrush('blush'), radius: 0.06, opacity: 0.6, softness: 0.45, finish: 0.4 }, cheeks],
    ['bench-lips', { ...head.look.defaultBrush('lipstick'), radius: 0.04, opacity: 0.6, finish: 0.4 }, [[
      guide('lipsRightCorner'), guide('lipsCenter'), guide('lipsLeftCorner'),
    ]]],
  ];
  const strokes = strokeInputs.map((args) => value(head.look.captureStroke(...args)));
  assert.deepEqual(strokes, strokeInputs.map((args) => value(baseline.look.captureStroke(...args))));
  const strokeField = head.paint.composePaint(strokes, masks);
  assert.deepEqual(strokeField, baseline.paint.composePaint(strokes, masks));
  const blank = head.paint.composePaint([], masks);
  assert.deepEqual(blank, baseline.paint.composePaint([], masks));
  const colors = [[204, 80, 117], [167, 100, 203], [81, 40, 78], [23, 20, 36],
    [229, 184, 93], [242, 233, 223], [219, 118, 97], [0, 255, 0]];
  const dense = { size: 1024, rgba: new Uint8ClampedArray(1024 * 1024 * 4), finish: new Uint8Array(1024 * 1024) };
  const allValid = { size: 1024, valid: new Uint8Array(1024 * 1024).fill(255),
    lips: new Uint8Array(1024 * 1024), cheeks: new Uint8Array(1024 * 1024), lids: new Uint8Array(1024 * 1024) };
  for (let index = 0; index < dense.finish.length; index += 1) {
    dense.rgba.set([...colors[index % colors.length], (index * 17 + 37) % 255 + 1], index * 4);
    dense.finish[index] = index * 29 % 256;
    allValid.lips[index] = index * 13 % 256;
    allValid.cheeks[index] = (index * 17 + 128) % 256;
    allValid.lids[index] = (index * 23 + 64) % 256;
  }
  return {
    assetSha256: sha256(assetBytes), pngHashes: Object.fromEntries(Object.entries(images).map(([name, image]) => [name, image.pngSha256])),
    strokes,
    cases: [
      { name: 'native-strokes', field: strokeField, masks, score: 100 },
      { name: 'native-blank', field: blank, masks, score: 0 },
      { name: 'native-dense', field: dense, masks, score: 70 },
      { name: 'all-valid-dense', field: dense, masks: allValid, score: 70 },
    ],
  };
}

function inputEvidence({ field, masks }) {
  let nonzeroAlpha = 0;
  let validPaintedPixels = 0;
  for (let y = 3; y < masks.size - 3; y += 1) {
    for (let x = 3; x < masks.size - 3; x += 1) {
      const index = y * masks.size + x;
      if (field.rgba[index * 4 + 3] > 0) {
        nonzeroAlpha += 1;
        if (masks.valid[index] > 0) validPaintedPixels += 1;
      }
    }
  }
  return {
    size: masks.size, interiorPixels: (masks.size - 6) ** 2, nonzeroAlpha, validPaintedPixels,
    rgbaSha256: sha256(field.rgba), finishSha256: sha256(field.finish),
    maskHashes: Object.fromEntries(['valid', 'lips', 'cheeks', 'lids'].map((key) => [key, sha256(masks[key])])),
  };
}

function verify(output, fixture, module) {
  assert.deepEqual(output, fixture.expected, `${fixture.name} changed an exact analysis result.`);
  assert.equal(module.assess('rose-editorial', output).total, fixture.score, `${fixture.name} has the wrong known score.`);
  assert.equal(Object.isFrozen(output) && Object.isFrozen(output.coverage) && Object.isFrozen(output.paletteMass), true);
}

function measure(module, fixture) {
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const output = module.analyzePaint(fixture.field, fixture.masks);
  const wallMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  verify(output, fixture, module);
  return { wallMs, cpuMs: (cpu.user + cpu.system) / 1000, output, outputSha256: sha256(JSON.stringify(output)) };
}

function statistics(runs, key) {
  const values = runs.map((run) => run[key]).sort((a, b) => a - b);
  return { n: values.length, median: values[Math.floor(values.length / 2)], min: values[0], max: values.at(-1) };
}

async function main() {
  if (options.help) {
    console.log('Usage: node scripts/bench-analysis.mjs [--baseline PATH/paint.ts] [--out NEW.json] [--profile NEW.cpuprofile]');
    console.log('The baseline needs its original sibling look.ts. A sibling manifest.json, if present, verifies both source hashes.');
    console.log('Default baseline: benchmarks/analysis-baseline/paint.ts. No baseline is created or replaced.');
    console.log('Five warmup pairs precede five timed pairs per fixture. --profile instead collects a separate unreported CPU profile.');
    return;
  }
  const baselinePath = resolve(options.baseline);
  if (!fs.existsSync(baselinePath) || !fs.existsSync(path.join(path.dirname(baselinePath), 'look.ts'))) {
    throw new Error(`Missing baseline at ${baselinePath}, or its sibling look.ts. Supply --baseline PATH/paint.ts with the saved original sources. The benchmark does not substitute current production code.`);
  }
  for (const output of [options.out, options.profile].filter(Boolean)) {
    assert(!fs.existsSync(resolve(output)), `Refusing to overwrite ${output}. Choose a new output path.`);
    fs.mkdirSync(path.dirname(resolve(output)), { recursive: true });
  }
  const before = environment();
  const baseline = await loadPaint(baselinePath, 'baseline');
  const head = await loadPaint(resolve('src/paint.ts'), 'head');
  const manifestPath = path.join(path.dirname(baselinePath), 'manifest.json');
  if (fs.existsSync(manifestPath)) assert.deepEqual(baseline.hashes, JSON.parse(fs.readFileSync(manifestPath, 'utf8')).sources, 'Saved baseline source hash mismatch.');
  assert.deepEqual(head.look.palette, baseline.look.palette);
  const paintTools = (registry) => Object.fromEntries(Object.entries(registry)
    .map(([id, { defaults: _defaults, ...policy }]) => [id, policy]));
  assert.deepEqual(paintTools(head.look.tools), paintTools(baseline.look.tools));
  assert.deepEqual(head.look.themes, baseline.look.themes);
  const inputs = fixtures(baseline, head);
  assert.deepEqual(inputs.cases.map(({ name }) => name), fixtureNames);
  for (const fixture of inputs.cases) {
    fixture.evidence = inputEvidence(fixture);
    fixture.expected = baseline.paint.analyzePaint(fixture.field, fixture.masks);
    verify(fixture.expected, fixture, baseline.paint);
    verify(head.paint.analyzePaint(fixture.field, fixture.masks), fixture, head.paint);
    if (fixture.name === 'native-blank') assert.equal(fixture.expected.alphaMass, 0);
    else assert(fixture.expected.alphaMass > 0 && fixture.evidence.validPaintedPixels > 0, `${fixture.name} must perform visible-paint analysis.`);
  }
  for (let pair = 0; pair < rounds; pair += 1) {
    for (const fixture of inputs.cases) {
      verify(baseline.paint.analyzePaint(fixture.field, fixture.masks), fixture, baseline.paint);
      verify(head.paint.analyzePaint(fixture.field, fixture.masks), fixture, head.paint);
    }
  }
  const runs = inputs.cases.map(({ name }) => ({ name, pairs: [] }));
  if (options.profile) {
    const session = new Session();
    session.connect();
    try {
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', { interval: 1000 });
      await session.post('Profiler.start');
      const fixture = inputs.cases[0];
      for (let pair = 0; pair < 20; pair += 1) {
        verify(baseline.paint.analyzePaint(fixture.field, fixture.masks), fixture, baseline.paint);
        verify(head.paint.analyzePaint(fixture.field, fixture.masks), fixture, head.paint);
      }
      const { profile } = await session.post('Profiler.stop');
      fs.writeFileSync(resolve(options.profile), `${JSON.stringify(profile)}\n`, { flag: 'wx' });
    } finally {
      session.disconnect();
    }
  } else {
    for (let pair = 1; pair <= rounds; pair += 1) {
      for (let index = 0; index < inputs.cases.length; index += 1) {
        const fixture = inputs.cases[index];
        const a = measure(baseline.paint, fixture);
        const b = measure(head.paint, fixture);
        assert.deepEqual(a.output, b.output, `${fixture.name}, pair ${pair}`);
        runs[index].pairs.push({ pair, baseline: a, head: b });
      }
    }
  }
  for (const fixture of inputs.cases) assert.deepEqual(inputEvidence(fixture), fixture.evidence, `${fixture.name} mutated its input bytes.`);
  const report = {
    kind: options.profile ? 'unreported-warm-profile' : 'warm-pure-analysis-comparison', errors: 0,
    method: 'Same-process ES2022 TypeScript transpilation. Both sides read the same masks and field objects. Five AB warmup pairs in fixture order, then five AB timed pairs in the same order. Timing includes only the synchronous analyzePaint call. Assertions, fixture creation, composition, PNG decode, and assessment are outside timing. No browser, GPU, Finish, or cold-call speedup is measured.',
    warmupPairsPerFixture: rounds, timedPairsPerFixture: options.profile ? 0 : rounds,
    benchmarkSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    sources: { baseline: { paths: baseline.paths, sha256: baseline.hashes }, head: { paths: head.paths, sha256: head.hashes } },
    assetSha256: inputs.assetSha256, pngHashes: inputs.pngHashes, strokes: inputs.strokes,
    before, after: environment(),
    fixtures: inputs.cases.map((fixture, index) => ({
      name: fixture.name, input: fixture.evidence, expected: fixture.expected,
      expectedSha256: sha256(JSON.stringify(fixture.expected)), knownRoseEditorialScore: fixture.score,
      pairs: runs[index].pairs,
      summary: options.profile ? null : Object.fromEntries(['baseline', 'head'].map((side) => [side, {
        wallMs: statistics(runs[index].pairs.map((pair) => pair[side]), 'wallMs'),
        cpuMs: statistics(runs[index].pairs.map((pair) => pair[side]), 'cpuMs'),
      }])),
    })),
    profile: options.profile ?? null,
    remainingGate: 'Compare the real browser Finish handler on isolated baseline and head production builds in five interleaved pairs. The coordinator owns this gate. No end-to-end improvement or real-phone performance claim follows from this benchmark.',
  };
  if (options.out) fs.writeFileSync(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Paint analysis benchmark failed. ${error.stack ?? error}`);
  process.exitCode = 1;
});
