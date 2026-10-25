import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const root = path.resolve(import.meta.dirname, '..');
const proofRoot = path.join(root, 'tmp/avatar-customization/asset-proof');
const publicRoot = path.join(root, 'public/face/v2');
const neutralRoot = path.join(root, 'art/neutral');
const arguments_ = process.argv.slice(2);
assert(arguments_.every(arg => !arg.startsWith('--') || arg === '--geometry-only'), 'Unknown checker option.');
const geometryOnly = arguments_.includes('--geometry-only');
const directory = path.resolve(arguments_.find(arg => !arg.startsWith('--')) ?? proofRoot);
assert(directory === publicRoot || directory === proofRoot || directory.startsWith(`${proofRoot}/`),
  'Use public/face/v2 or a temporary proof directory.');
assert(directory !== publicRoot || geometryOnly, 'Production assets have no render evidence. Use --geometry-only.');
const registryPath = path.join(root, 'art/avatar-v2.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'asset.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const features = ['face', 'nose', 'mouth', 'eyeShape'];
const constraints = registry.authoring.constraints;

function glb(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const size = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + size));
  const binary = bytes.subarray(28 + size);
  function accessor(index) {
    const entry = document.accessors[index];
    assert(!entry.sparse, 'This proof packs dense deterministic accessors.');
    const view = document.bufferViews[entry.bufferView];
    const [method, width] = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2] }[entry.componentType];
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[entry.type];
    const stride = view.byteStride ?? width * count;
    const offset = (view.byteOffset ?? 0) + (entry.byteOffset ?? 0);
    const result = new Float64Array(entry.count * count);
    for (let i = 0; i < entry.count; i += 1) {
      for (let j = 0; j < count; j += 1) result[i * count + j] = binary[method](offset + stride * i + width * j);
    }
    return result;
  }
  const meshes = Object.fromEntries(document.meshes.map(mesh => {
    assert.equal(mesh.primitives.length, 1, `${mesh.name} must remain a single full-draw-range primitive.`);
    const p = mesh.primitives[0];
    assert.equal(p.mode ?? 4, 4);
    return [mesh.name, { primitive: p, positions: accessor(p.attributes.POSITION), indices: accessor(p.indices),
      targets: Object.fromEntries((mesh.extras?.targetNames ?? []).map((name, i) => [name, {
        positions: accessor(p.targets[i].POSITION), normals: accessor(p.targets[i].NORMAL),
      }])), vertexCount: document.accessors[p.attributes.POSITION].count }];
  }));
  return { document, binary, accessor, bytes, meshes };
}

function png(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, `${file} must have eight-bit channels.`);
  assert([2, 6].includes(bytes[25]), `${file} must be RGB or RGBA.`);
  assert.deepEqual([...bytes.subarray(26, 29)], [0, 0, 0], `${file} must be noninterlaced.`);
  const channels = bytes[25] === 6 ? 4 : 3;
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  assert.equal(raw.length, height * (stride + 1));
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4);
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const a = x < channels ? 0 : pixels[index - channels];
      const b = y === 0 ? 0 : pixels[index - stride];
      const c = y === 0 || x < channels ? 0 : pixels[index - stride - channels];
      let predictor = 0;
      if (filter === 1) predictor = a;
      if (filter === 2) predictor = b;
      if (filter === 3) predictor = Math.floor((a + b) / 2);
      if (filter === 4) {
        const p = a + b - c;
        const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
        predictor = da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      pixels[index] = raw[y * (stride + 1) + x + 1] + predictor;
    }
  }
  if (channels === 4) return { width, height, pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, pixels: rgba };
}

function isPinned(x, y, z) {
  return y <= constraints.neckYMax || y >= constraints.hairlineYMin || Math.abs(x) >= constraints.earAbsXMin || z <= constraints.rearZMax;
}

function tree(positions, indices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(indices), 1));
  return new MeshBVH(geometry, { targetLeafSize: 8 });
}

function crossAt(p, indices, i) {
  const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function combinations(groups) {
  return groups.reduce((rows, [group, entries]) => rows.flatMap(row => Object.keys(entries).map(value => ({ ...row, [group]: value }))), [{}]);
}

const neutral = glb(path.join(root, registry.source.neutral));
const v2 = glb(path.join(directory, 'head.glb'));
assert.equal(manifest.registrySha256, fileHash(registryPath));
assert.equal(manifest.generatorSha256, fileHash(path.join(root, 'scripts/prepare-avatar.py')));
assert.equal(manifest.sourceBlendSha256, fileHash(path.join(root, registry.source.blend)));
assert.equal(manifest.glb.sha256, hash(v2.bytes));
assert.equal(manifest.glb.bytes, v2.bytes.length);
assert.equal(manifest.glb.preservedNeutralBinaryPrefixBytes, neutral.binary.length);
assert.deepEqual(v2.binary.subarray(0, neutral.binary.length), neutral.binary, 'Every neutral GLB binary byte must be retained.');
for (const field of ['materials', 'images', 'textures', 'samplers']) assert.deepEqual(v2.document[field], neutral.document[field], `Neutral ${field} changed.`);
assert.deepEqual(v2.document.accessors.slice(0, neutral.document.accessors.length), neutral.document.accessors);
assert.deepEqual(v2.document.bufferViews.slice(0, neutral.document.bufferViews.length), neutral.document.bufferViews);
for (const node of neutral.document.nodes) assert.deepEqual(v2.document.nodes.find(n => n.name === node.name), node);
for (const [name, original] of Object.entries(neutral.meshes)) {
  const { targets, ...primitive } = v2.meshes[name].primitive;
  assert.deepEqual(primitive, original.primitive, `${name} neutral attributes or indices changed.`);
  assert.deepEqual(v2.meshes[name].positions, original.positions);
}
const neutralFiles = fs.readdirSync(neutralRoot, { recursive: true }).filter(file => fs.statSync(path.join(neutralRoot, file)).isFile());
const neutralInputs = Object.fromEntries(neutralFiles.map(file => [path.join('art/neutral', file), fileHash(path.join(neutralRoot, file))]));
assert.deepEqual(manifest.neutralAuthoringInputs, neutralInputs, 'Neutral authoring inputs changed.');
const contract = JSON.parse(fs.readFileSync(path.join(neutralRoot, 'asset.json'), 'utf8'));
assert.equal(hash(neutral.bytes), contract.sha256);
assert.equal(manifest.paintAtlas.id, registry.paintAtlas);
assert.equal(manifest.paintAtlas.directory, '.');
assert.equal(manifest.paintAtlas.publicPath, '/face/v2/');
assert.equal(manifest.id, registry.asset);
assert(!JSON.stringify(manifest).includes('/face/v1/'), 'The runtime manifest must not refer to an old asset directory.');
assert(fs.readFileSync(path.join(directory, manifest.creditFile), 'utf8').includes(registry.source.credit));
assert(fs.readFileSync(path.join(directory, manifest.creditFile), 'utf8').includes('https://creativecommons.org/licenses/by/4.0/'));
assert.equal(JSON.parse(fs.readFileSync(path.join(directory, manifest.provenanceFile), 'utf8')).sourceBlendSha256, manifest.sourceBlendSha256);
for (const file of ['CC-BY-4.0.txt', 'Rain-embedded-readme.txt']) {
  assert.equal(fileHash(path.join(directory, 'licenses', file)), fileHash(path.join(neutralRoot, 'licenses', file)));
}
assert.deepEqual(manifest.paintAtlas.paint, contract.paint);
assert.deepEqual(manifest.paintAtlas.landmarks, contract.landmarks);
assert.deepEqual(Object.keys(manifest.paintAtlas.files).sort(), ['makeup-blank.png', ...Object.values(contract.paint.masks)].sort());
for (const [file, expected] of Object.entries(manifest.paintAtlas.files)) {
  assert.equal(fileHash(path.join(neutralRoot, file)), expected);
  assert.equal(fileHash(path.join(directory, file)), expected);
  const image = png(path.join(directory, file));
  assert.equal(image.width, contract.paint.textureSize);
  assert.equal(image.height, contract.paint.textureSize);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x < 3 || y < 3 || x >= image.width - 3 || y >= image.height - 3) {
        const index = (y * image.width + x) * 4;
        assert.equal(image.pixels[index + (file.endsWith('makeup-blank.png') ? 3 : 0)], 0, `${file} reserved border changed.`);
      }
    }
  }
}

for (const [name, mesh] of Object.entries(v2.meshes)) {
  assert(mesh.positions.every(Number.isFinite), `Nonfinite neutral positions in ${name}.`);
  assert(mesh.indices.every(index => Number.isInteger(index) && index >= 0 && index < mesh.vertexCount), `Invalid indices in ${name}.`);
  assert(v2.accessor(mesh.primitive.attributes.NORMAL).every(Number.isFinite));
  assert(v2.accessor(mesh.primitive.attributes.TEXCOORD_0).every(Number.isFinite));
}
const face = v2.meshes.Face;
const paint = v2.accessor(face.primitive.attributes.TEXCOORD_1);
let projected = 0, excluded = 0;
for (let i = 0; i < face.vertexCount; i += 1) {
  const [x, y, z] = face.positions.subarray(i * 3, i * 3 + 3);
  const u = paint[i * 2], v = paint[i * 2 + 1];
  assert([x, y, z, u, v].every(Number.isFinite));
  if (u === 0 && v === 0) excluded += 1;
  else {
    projected += 1;
    assert(Math.abs(u - (x + .15) / .30) < 2e-6);
    assert(Math.abs(v - (.445 - y) / .295) < 2e-6);
  }
  if (z < 0) assert(u === 0 && v === 0);
}
for (let i = 0; i < face.indices.length; i += 3) {
  const eligibility = Array.from(face.indices.subarray(i, i + 3), n => paint[n * 2] === 0 && paint[n * 2 + 1] === 0);
  assert(eligibility.every(Boolean) || eligibility.every(value => !value), 'Paint eligibility mixed within a triangle.');
}
assert(projected > 5000 && excluded > 5000);
assert.equal(Object.keys(registry.authoring.targets).length, 7);
const targetStats = {};
for (const [name, recipe] of Object.entries(registry.authoring.targets)) {
  targetStats[name] = {};
  for (const meshName of recipe.meshes) {
    const mesh = v2.meshes[meshName];
    const target = mesh.targets[name];
    assert(target, `Missing ${meshName}/${name}.`);
    assert.equal(target.positions.length, mesh.positions.length);
    assert.equal(target.normals.length, mesh.positions.length);
    assert(target.positions.every(Number.isFinite) && target.normals.every(Number.isFinite));
    const welded = new Map();
    let moved = 0, maximum = 0, pinnedCount = 0;
    for (let i = 0; i < mesh.vertexCount; i += 1) {
      const p = mesh.positions.subarray(i * 3, i * 3 + 3);
      const d = target.positions.subarray(i * 3, i * 3 + 3);
      const distance = Math.hypot(...d);
      if (distance > 0) moved += 1;
      maximum = Math.max(maximum, distance);
      if (isPinned(...p)) {
        pinnedCount += 1;
        assert(distance === 0, `${meshName}/${name} moved a pinned vertex.`);
        assert(target.normals.subarray(i * 3, i * 3 + 3).every(v => v === 0));
      }
      const key = Array.from(p, v => v.toFixed(7)).join(',');
      if (welded.has(key)) assert(d.every((v, axis) => Math.abs(v - welded.get(key)[axis]) < 1e-7), 'Split vertices separated under a morph.');
      else welded.set(key, d);
    }
    assert(moved > 100 && maximum > .0005 && maximum < constraints.maxCombinedDisplacement);
    targetStats[name][meshName] = { movedVertices: moved, maximumDisplacementMeters: maximum, pinnedVertices: pinnedCount };
  }
}
for (const group of features) {
  for (const choice of Object.values(registry.choices[group])) {
    for (const [target, weight] of Object.entries(choice.morphs)) {
      assert(registry.authoring.targets[target]);
      assert.equal(weight, 1, 'Only reviewed categorical full targets are allowed.');
    }
  }
}
for (const style of Object.values(registry.choices.hairStyle)) for (const component of style.components) assert(v2.meshes[component]);
assert(registry.choices.hairStyle.ponytail.components.includes('HairTail'));
assert(!registry.choices.hairStyle.bun.components.includes('HairTail'));
assert(registry.choices.hairStyle.bun.components.includes('HairBun'));
assert(v2.meshes.HairBun.vertexCount > 1000);
assert(!neutral.meshes.HairBun);

const lashTopology = [];
for (const weight of [0, 1]) {
  const mesh = v2.meshes.Lashes;
  const posed = mesh.positions.map((value, i) => value + weight * mesh.targets['eyes-round'].positions[i]);
  let areaRatio = Infinity, normalDot = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = crossAt(mesh.positions, mesh.indices, i), b = crossAt(posed, mesh.indices, i);
    const aa = Math.hypot(...a), bb = Math.hypot(...b);
    if (aa < 1e-14) continue;
    areaRatio = Math.min(areaRatio, bb / aa);
    normalDot = Math.min(normalDot, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (aa * bb));
  }
  assert(areaRatio >= constraints.minTriangleAreaRatio && normalDot >= constraints.minTriangleNormalDot, 'Lash deformation folded a triangle.');
  lashTopology.push({ weight, minimumTriangleAreaRatio: areaRatio, minimumTriangleNormalDot: normalDot });
}
const componentClosure = {};
for (const name of ['HairBun', 'BunBand']) {
  const mesh = v2.meshes[name];
  const edges = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const left = mesh.indices[i + a], right = mesh.indices[i + b];
      const key = left < right ? `${left},${right}` : `${right},${left}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert([...edges.values()].every(count => count === 2), `${name} has a nonmanifold or open edge.`);
  componentClosure[name] = { closed: true, edges: edges.size, triangles: mesh.indices.length / 3 };
}
const baselineTree = tree(face.positions, face.indices);
const roots = [];
const lash = v2.meshes.Lashes;
for (let i = 0; i < lash.vertexCount; i += 1) {
  const p = new Vector3().fromArray(lash.positions, i * 3);
  const distance = baselineTree.closestPointToPoint(p).distance;
  if (distance < .0008) roots.push({ index: i, baseline: distance });
}
assert(roots.length > 30, 'Not enough lash-root samples for fitted attachment checks.');
const mouthRays = [];
for (let x = -.020; x <= .0201; x += .004) {
  for (const y of [.208, .2095, .211]) {
    const ray = new Ray(new Vector3(x, y, .5), new Vector3(0, 0, -1));
    const hit = baselineTree.raycastFirst(ray, DoubleSide);
    assert(hit && hit.point.z > .12);
    mouthRays.push({ ray, baseline: hit.point.z });
  }
}
const matrix = [];
let minimumAreaRatio = Infinity, minimumNormalDot = Infinity, maximumCombinedDisplacement = 0, maximumLashRootGap = 0;
for (const identity of combinations(features.map(group => [group, registry.choices[group]]))) {
  const weights = Object.assign({}, ...features.map(group => registry.choices[group][identity[group]].morphs));
  const posed = Float64Array.from(face.positions);
  for (const name of Object.keys(weights)) {
    const delta = face.targets[name].positions;
    for (let i = 0; i < posed.length; i += 1) posed[i] += delta[i];
  }
  let maximum = 0, minimumRatio = Infinity, minimumDot = Infinity;
  for (let i = 0; i < posed.length; i += 3) maximum = Math.max(maximum, Math.hypot(posed[i] - face.positions[i], posed[i + 1] - face.positions[i + 1], posed[i + 2] - face.positions[i + 2]));
  assert(maximum <= constraints.maxCombinedDisplacement);
  for (let i = 0; i < face.indices.length; i += 3) {
    const a = crossAt(face.positions, face.indices, i), b = crossAt(posed, face.indices, i);
    const aa = Math.hypot(...a), bb = Math.hypot(...b);
    if (aa < 1e-14) continue;
    const ratio = bb / aa;
    const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (aa * bb);
    assert(ratio >= constraints.minTriangleAreaRatio, `Degenerate triangle in ${JSON.stringify(identity)}.`);
    assert(dot >= constraints.minTriangleNormalDot, `Folded triangle in ${JSON.stringify(identity)}. Dot ${dot}.`);
    minimumRatio = Math.min(minimumRatio, ratio);
    minimumDot = Math.min(minimumDot, dot);
  }
  const posedTree = tree(posed, face.indices);
  let lashGap = 0;
  for (const root of roots) {
    const p = new Vector3().fromArray(lash.positions, root.index * 3);
    if (weights['eyes-round']) p.add(new Vector3().fromArray(lash.targets['eyes-round'].positions, root.index * 3));
    const gap = posedTree.closestPointToPoint(p).distance;
    lashGap = Math.max(lashGap, gap);
    assert(gap <= root.baseline + .0008, `Lash root detached under ${JSON.stringify(identity)}. Gap ${gap}.`);
  }
  let maximumMouthDepthChange = 0;
  for (const { ray, baseline } of mouthRays) {
    const hit = posedTree.raycastFirst(ray, DoubleSide);
    assert(hit && hit.point.z > .12 && Math.abs(hit.point.z - baseline) < .006, `Mouth opening or excessive depth change under ${JSON.stringify(identity)}.`);
    maximumMouthDepthChange = Math.max(maximumMouthDepthChange, Math.abs(hit.point.z - baseline));
  }
  maximumCombinedDisplacement = Math.max(maximumCombinedDisplacement, maximum);
  maximumLashRootGap = Math.max(maximumLashRootGap, lashGap);
  minimumAreaRatio = Math.min(minimumAreaRatio, minimumRatio);
  minimumNormalDot = Math.min(minimumNormalDot, minimumDot);
  matrix.push({ identity, maximumDisplacementMeters: maximum, minimumTriangleAreaRatio: minimumRatio,
    minimumTriangleNormalDot: minimumDot, maximumLashRootGapMeters: lashGap, maximumMouthDepthChangeMeters: maximumMouthDepthChange });
  posedTree.geometry.dispose();
}
assert.equal(matrix.length, 54);

const mapStats = {};
for (const [file, expected] of Object.entries(manifest.maps)) {
  const filename = path.join(directory, file);
  assert.equal(fileHash(filename), expected.sha256, `${file} map pixels changed.`);
  assert.equal(fs.statSync(filename).size, expected.bytes);
  const image = png(filename);
  assert.deepEqual([image.width, image.height], expected.size);
  mapStats[file] = { bytes: expected.bytes, width: image.width, height: image.height };
}
for (const choice of Object.values(registry.choices.complexion)) assert(mapStats[choice.faceMap] && mapStats[choice.bustMap]);
for (const choice of Object.values(registry.choices.hairColor)) assert(mapStats[choice.map]);
for (const choice of Object.values(registry.choices.eyes)) assert(mapStats[choice.map]);
assert.equal(fileHash(path.join(directory, registry.choices.complexion.warm.faceMap)), fileHash(path.join(root, registry.authoring.skin.sourceFace)));
assert.equal(fileHash(path.join(directory, registry.choices.complexion.warm.bustMap)), fileHash(path.join(root, registry.authoring.skin.sourceBust)));
assert.equal(fileHash(path.join(directory, registry.choices.hairColor.espresso.map)), fileHash(path.join(root, registry.authoring.hair.source)));

function linear(value) {
  value /= 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}
function luminance(image, x, y) {
  const i = (y * image.width + x) * 4;
  return linear(image.pixels[i]) * .2126 + linear(image.pixels[i + 1]) * .7152 + linear(image.pixels[i + 2]) * .0722;
}
function correlation(a, b) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a), mb = mean(b);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return dot / Math.sqrt(aa * bb);
}
function patch(image, bounds) {
  const values = [], detail = [];
  for (let y = Math.round(bounds[1] * image.height); y < bounds[3] * image.height; y += 2) {
    for (let x = Math.round(bounds[0] * image.width); x < bounds[2] * image.width; x += 2) {
      const value = luminance(image, x, y);
      values.push(value);
      detail.push(value - (luminance(image, x - 3, y) + luminance(image, x + 3, y) + luminance(image, x, y - 3) + luminance(image, x, y + 3)) / 4);
    }
  }
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { mean, relativeContrast: deviation / mean, values, detail };
}
const sourceSkin = png(path.join(root, registry.authoring.skin.sourceFace));
const sourceFreckles = patch(sourceSkin, [.43, .49, .57, .58]);
const sourceFreckleMean = sourceFreckles.mean;
patch(sourceSkin, [.475, .615, .525, .640]);
assert.equal(sourceFreckles.mean, sourceFreckleMean, 'A later texture patch changed an earlier result.');
const sourceHair = patch(png(path.join(root, registry.authoring.hair.source)), [.32, .06, .76, .28]);
const textureQuality = { complexions: {}, hairColors: {} };
for (const [name, choice] of Object.entries(registry.choices.complexion)) {
  const image = png(path.join(directory, choice.faceMap));
  const freckles = patch(image, [.43, .49, .57, .58]);
  const lips = patch(image, [.475, .615, .525, .640]);
  const detailCorrelation = correlation(sourceFreckles.detail, freckles.detail);
  assert(detailCorrelation > .65, `${name} lost source freckle detail.`);
  assert(lips.mean < freckles.mean && lips.mean > freckles.mean * .20, `${name} lost natural lip contrast. Lip ${lips.mean}, skin ${freckles.mean}.`);
  textureQuality.complexions[name] = { facePatchLinearLuminance: freckles.mean,
    freckleHighFrequencyCorrelation: detailCorrelation, relativePatchContrast: freckles.relativeContrast, lipToSkinLuminance: lips.mean / freckles.mean };
}
const depths = ['fair', 'warm', 'tan', 'brown', 'deep'].map(name => textureQuality.complexions[name].facePatchLinearLuminance);
for (let i = 1; i < depths.length; i += 1) assert(depths[i] < depths[i - 1], 'Complexion depths must be visibly ordered.');
for (const [name, choice] of Object.entries(registry.choices.hairColor)) {
  const strand = patch(png(path.join(directory, choice.map)), [.32, .06, .76, .28]);
  const detailCorrelation = correlation(sourceHair.detail, strand.detail);
  assert(detailCorrelation > .70 && strand.relativeContrast > .10, `${name} lost strand contrast.`);
  textureQuality.hairColors[name] = { patchLinearLuminance: strand.mean, relativeStrandContrast: strand.relativeContrast, sourceDetailCorrelation: detailCorrelation };
}
assert(textureQuality.hairColors.blonde.patchLinearLuminance > .15);
assert(textureQuality.hairColors.blonde.patchLinearLuminance > textureQuality.hairColors.espresso.patchLinearLuminance * 5);
const faceUv = v2.accessor(face.primitive.attributes.TEXCOORD_0);
const bust = v2.meshes.Bust;
const bustUv = v2.accessor(bust.primitive.attributes.TEXCOORD_0);
const positionKey = (positions, i) => Array.from(positions.subarray(i * 3, i * 3 + 3), value => value.toFixed(7)).join(',');
const bustPositions = new Map(Array.from({ length: bust.vertexCount }, (_, i) => [positionKey(bust.positions, i), i]));
const seam = new Map();
for (let i = 0; i < face.vertexCount; i += 1) {
  const key = positionKey(face.positions, i);
  if (face.positions[i * 3 + 1] < .14 && bustPositions.has(key)) seam.set(key, [i, bustPositions.get(key)]);
}
assert.equal(seam.size, 96, 'The exact fitted neck seam changed.');
const neckMatch = {};
function uvLuminance(image, uv, index) {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(uv[index * 2] * (image.width - 1))));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(uv[index * 2 + 1] * (image.height - 1))));
  return luminance(image, x, y);
}
for (const [name, choice] of Object.entries(registry.choices.complexion)) {
  const f = png(path.join(directory, choice.faceMap)), b = png(path.join(directory, choice.bustMap));
  const gaps = [...seam.values()].map(([fi, bi]) => {
    const a = uvLuminance(f, faceUv, fi), z = uvLuminance(b, bustUv, bi);
    return Math.abs(a - z) / ((a + z) / 2);
  });
  const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const maximum = Math.max(...gaps);
  assert(mean < .04 && maximum < .10, `${name} Face/Bust neck maps do not match.`);
  neckMatch[name] = { sampledSeamPositions: seam.size, meanRelativeLuminanceGap: mean, maximumRelativeLuminanceGap: maximum };
}
const triangles = Object.values(v2.meshes).reduce((total, mesh) => total + mesh.indices.length / 3, 0);
assert.equal(triangles, manifest.triangles);
const correspondence = JSON.parse(fs.readFileSync(path.join(directory, 'source-correspondence.json'), 'utf8'));
assert.equal(correspondence.matchedSplitVertices, face.vertexCount);
assert(correspondence.maximumPositionErrorMeters < 1e-7);
const renderFile = path.join(directory, 'render-index.json');
let renderSummary = 'Explicit geometry-only preflight. Render evidence has not been checked in this invocation.';
if (!geometryOnly) {
  assert(fs.existsSync(renderFile), 'Missing render evidence. Run the generator with --render or explicitly request --geometry-only.');
  const evidence = JSON.parse(fs.readFileSync(renderFile, 'utf8'));
  assert.equal(evidence.glbSha256, manifest.glb.sha256, 'Render evidence is stale.');
  assert.equal(evidence.registrySha256, manifest.registrySha256, 'Render registry is stale.');
  for (const record of evidence.renders) {
    assert(fs.statSync(path.join(directory, record.file)).size > 1000);
    assert.equal(fileHash(path.join(directory, record.file)), record.sha256, `Changed rendered evidence at ${record.file}.`);
  }
  for (const view of ['front', 'three-quarter']) {
    for (const mode of ['color', 'clay']) {
      for (const group of features) {
        for (const choice of Object.keys(registry.choices[group])) {
          assert(evidence.renders.some(r => r.view === view && r.mode === mode && r.identity[group] === choice));
        }
      }
    }
  }
  assert.equal(evidence.renders.filter(r => r.category === 'matrix').length, 54);
  for (const group of ['complexion', 'hairColor', 'hairStyle', 'eyes']) {
    for (const choice of Object.keys(registry.choices[group])) {
      for (const view of ['front', 'three-quarter']) assert(evidence.renders.some(r => r.category === group && r.view === view && r.identity[group] === choice));
    }
  }
  renderSummary = { images: evidence.renders.length, freshGlbImport: true, everyChoiceAtBothViews: true, all54ClayPoses: true };
}
const report = { status: 'pass', nodeVersion: process.versions.node, nodeFlags: process.execArgv,
  glbBytes: v2.bytes.length, glbSha256: hash(v2.bytes), triangles,
  meshCount: Object.keys(v2.meshes).length, faceVertices: face.vertexCount,
  neutralBinaryPrefixUnchanged: true, allNeutralAccessorsAndMaterialsUnchanged: true,
  neutralAuthoringInputsUnchanged: Object.keys(manifest.neutralAuthoringInputs).length, frozenPaintAtlasUnchanged: true,
  projectedVertices: projected, excludedVertices: excluded, sourceCorrespondence: correspondence,
  targets: targetStats, supportedShapeCombinations: matrix.length,
  minimumTriangleAreaRatio: minimumAreaRatio, minimumTriangleNormalDot: minimumNormalDot,
  maximumCombinedDisplacementMeters: maximumCombinedDisplacement,
  lashRootSamplesPerPose: roots.length, maximumLashRootGapMeters: maximumLashRootGap,
  closedMouthRaySamplesPerPose: mouthRays.length, lashTopology, componentClosure, textureQuality, neckMatch, maps: mapStats, renders: renderSummary,
  limits: 'Conservative local geometry, attachment, and mouth-ray checks. This is not an exhaustive self-intersection proof. Human art approval and real browser/device behavior remain separate gates.' };
const reportDirectory = directory === publicRoot ? path.join(root, 'tmp/avatar-customization/public-v2-verification') : directory;
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, 'geometry-matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
fs.writeFileSync(path.join(reportDirectory, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
