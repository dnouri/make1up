import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const directory = 'public/face/v1';
const bytes = fs.readFileSync(`${directory}/head.glb`);
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binaryStart = 20 + jsonLength + 8;
const contract = JSON.parse(fs.readFileSync(`${directory}/asset.json`, 'utf8'));
const dimensions = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
const readers = {5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2]};
function accessor(index) {
  const entry = document.accessors[index];
  const view = document.bufferViews[entry.bufferView];
  const [method, width] = readers[entry.componentType];
  const count = dimensions[entry.type];
  const stride = view.byteStride ?? width * count;
  const offset = binaryStart + (view.byteOffset ?? 0) + (entry.byteOffset ?? 0);
  return Array.from({length: entry.count}, (_, i) => Array.from({length: count}, (_, j) => bytes[method](offset + stride * i + width * j)));
}

const face = document.meshes.find(mesh => mesh.name === 'Face').primitives[0];
const positions = accessor(face.attributes.POSITION);
const paint = accessor(face.attributes.TEXCOORD_1);
const indices = accessor(face.indices).flat();
assert.equal(positions.length, paint.length);
let projected = 0;
let excluded = 0;
for (let i = 0; i < positions.length; i += 1) {
  const [x, y, z] = positions[i];
  const [u, v] = paint[i];
  assert([x, y, z, u, v].every(Number.isFinite));
  if (u === 0 && v === 0) {
    excluded += 1;
  } else {
    projected += 1;
    assert(Math.abs(u - (x + .15) / .30) < 2e-6);
    assert(Math.abs(v - (.445 - y) / .295) < 2e-6);
    assert(z > 0, `Projected vertices must be on the front of the head, got ${z}.`);
    assert(u > .05 && u < .95 && v > .005 && v < .995);
  }
  if (z < 0) assert.deepEqual([u, v], [0, 0], 'Rear vertices must use the transparent sentinel.');
}
for (let i = 0; i < indices.length; i += 3) {
  const sentinel = indices.slice(i, i + 3).map(index => paint[index][0] === 0 && paint[index][1] === 0);
  assert(sentinel.every(Boolean) || sentinel.every(value => !value), 'A triangle must not blend a paint UV with the sentinel.');
}
assert(projected > 5000 && excluded > 5000);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), contract.sha256);
for (const [name, sign] of [['Eye.L', 1], ['Eye.R', -1]]) {
  const mesh = document.meshes.find(mesh => mesh.name === name);
  assert(mesh);
  const primitive = mesh.primitives[0];
  const eye = accessor(primitive.attributes.POSITION);
  assert(eye.every(([x, y, z]) => x * sign > 0 && y > .25 && y < .34 && z > .05 && z < .14));
  const material = document.materials[primitive.material];
  assert(material.pbrMetallicRoughness.baseColorTexture);
  assert.notEqual(material.alphaMode, 'BLEND');
}
let triangles = 0;
for (const [name, expected] of Object.entries(contract.meshes)) {
  const mesh = document.meshes.find(mesh => mesh.name === name);
  assert(mesh, `Missing mesh ${name}.`);
  const primitive = mesh.primitives[0];
  const count = document.accessors[primitive.indices].count / 3;
  assert.equal(count, expected.triangles, `Changed geometry for ${name}.`);
  triangles += count;
}
assert.equal(triangles, contract.triangles);
const pngFiles = [
  ...Object.values(contract.paint.masks),
  ...contract.supportedVariants.eyes.map(eye => eye.texture),
];
for (const name of pngFiles) {
  const png = fs.readFileSync(`${directory}/${name}`);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  if (name.startsWith('masks/')) {
    assert.equal(png.readUInt32BE(16), contract.paint.textureSize);
    assert.equal(png.readUInt32BE(20), contract.paint.textureSize);
  }
}
assert(fs.readFileSync('public/face/CREDITS.txt', 'utf8').includes(contract.credit));
for (const file of [
  'public/face/licenses/CC-BY-4.0.txt', 'public/face/provenance.json',
  'public/fonts/Bodoni-Moda-OFL.txt', 'public/fonts/DM-Sans-OFL.txt',
]) assert(fs.statSync(file).size > 100, `Missing license or provenance ${file}.`);
const report = {
  status: 'pass',
  sha256: contract.sha256,
  exportedVerticesWithPaintUv: projected,
  excludedVerticesAtTransparentSentinel: excluded,
  allTrianglesHaveUniformEligibility: true,
  actualGlbProjectionMatchesContract: true,
  rearVerticesCannotDuplicateFrontPaint: true,
  bothEyesHaveValidBoundsAndOpaqueTexturedMaterials: true,
  triangles: contract.triangles,
  bytes: bytes.length,
  limits: 'Structural check only. Blender renders are separate. Browser and device behavior remain acceptance gates.',
};
fs.mkdirSync('tmp/verification', { recursive: true });
fs.writeFileSync('tmp/verification/assets.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
