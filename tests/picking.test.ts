import { describe, expect, it } from "vitest";
import {
  BackSide, BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group,
  Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster, Vector2, Vector3,
} from "three";
import type { Intersection } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshBVH } from "three-mesh-bvh";
import headUrl from "../public/face/v2/head.glb?url&inline";
import maskUrl from "../public/face/v2/masks/paint-valid.png?url&inline";
import { captureStroke, defaultBrush } from "../src/look";
import { avatarChoices } from "../src/avatar";
import type { UV } from "../src/look";
import { indexPortrait } from "../src/picking";

const stockRaycast = Mesh.prototype.raycast;

function triangles(count = 1, indexed = true): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const uv1: number[] = [];
  for (let index = 0; index < count; index += 1) {
    positions.push(-1, -1, 0, 1, -1, 0, 0, 1, 0);
    uv1.push(index / 8, 0.5, index / 8, 0.5, index / 8, 0.5);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv1", new Float32BufferAttribute(uv1, 2));
  if (indexed) geometry.setIndex(Array.from({ length: count * 3 }, (_, index) => index));
  return geometry;
}

function cast(meshes: Mesh[], raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1))): Intersection[] {
  for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
  return raycaster.intersectObjects(meshes, false);
}

function stock(meshes: Mesh[], raycaster: Raycaster): Intersection[] {
  const hits: Intersection[] = [];
  for (const mesh of meshes) stockRaycast.call(mesh, raycaster, hits);
  return hits.sort((a, b) => a.distance - b.distance);
}

function expectHits(actual: Intersection[], expected: Intersection[]): void {
  expect(actual.map((hit) => [hit.object, hit.faceIndex, hit.face?.materialIndex]))
    .toEqual(expected.map((hit) => [hit.object, hit.faceIndex, hit.face?.materialIndex]));
  for (const [index, hit] of actual.entries()) {
    const reference = expected[index]!;
    expect(Math.abs(hit.distance - reference.distance)).toBeLessThan(1e-12);
    expect(hit.point.distanceTo(reference.point)).toBeLessThan(1e-12);
    expect(hit.uv1 === undefined).toBe(reference.uv1 === undefined);
    if (hit.uv1 !== undefined && reference.uv1 !== undefined) {
      expect(hit.uv1.distanceTo(reference.uv1)).toBeLessThan(1e-12);
    }
  }
}

describe("local portrait picking", () => {
  it("owns one indirect tree per geometry and restores methods, trees, and index ownership twice", () => {
    const geometry = triangles();
    const index = geometry.index;
    const bytes = index!.array.slice();
    const previousTree = new MeshBVH(geometry, { indirect: true });
    geometry.boundsTree = previousTree;
    const first = new Mesh(geometry, new MeshBasicMaterial());
    const second = new Mesh(geometry, first.material);
    second.position.z = -0.5;
    const original = function () { throw new Error("The original per-mesh raycast must not run while indexed."); };
    first.raycast = original;
    const plainGeometry = triangles(1, false);
    const plain = new Mesh(plainGeometry, first.material);
    plain.position.z = -1;
    const unrelated = new Mesh(triangles(), first.material);
    const release = indexPortrait([first, second, plain, first]);
    try {
      expect(geometry.boundsTree).toBeInstanceOf(MeshBVH);
      expect(geometry.boundsTree).not.toBe(previousTree);
      expect(geometry.boundsTree!.indirect).toBe(true);
      expect(geometry.index).toBe(index);
      expect(geometry.index!.array).toEqual(bytes);
      expect(Mesh.prototype.raycast).toBe(stockRaycast);
      expect(unrelated.raycast).toBe(stockRaycast);
      const hits = cast([first, second, plain]);
      expect(hits.map((hit) => [hit.distance, hit.faceIndex, hit.uv1?.toArray()]))
        .toEqual([[2, 0, [0, 0.5]], [2.5, 0, [0, 0.5]], [3, 0, [0, 0.5]]]);
    } finally {
      release();
      release();
    }
    expect(first.raycast).toBe(original);
    expect(Object.hasOwn(first, "raycast")).toBe(true);
    expect(second.raycast).toBe(stockRaycast);
    expect(Object.hasOwn(second, "raycast")).toBe(false);
    expect(geometry.boundsTree).toBe(previousTree);
    expect(geometry.index).toBe(index);
    expect(geometry.index!.array).toEqual(bytes);
    expect(plainGeometry.index).toBeNull();
    expect(Object.hasOwn(plainGeometry, "boundsTree")).toBe(false);
    expect(cast([second, plain]).map((hit) => hit.distance)).toEqual([2.5, 3]);
  });

  it("keeps shared-edge triangle order, object ties, and the nearer occluder", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([
      -1, -1, 0, 1, -1, 0, 1, 1, 0,
      -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));
    geometry.setAttribute("uv1", new Float32BufferAttribute([
      0.25, 0.25, 0.25, 0.25, 0.25, 0.25,
      0.75, 0.75, 0.75, 0.75, 0.75, 0.75,
    ], 2));
    const face = new Mesh(geometry, new MeshBasicMaterial());
    face.name = "Face";
    const tied = new Mesh(geometry, face.material);
    tied.name = "Tied";
    const occluder = new Mesh(triangles(), face.material);
    occluder.name = "Eye";
    occluder.position.z = 0.5;
    const raycaster = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
    for (const mesh of [face, tied, occluder]) mesh.updateMatrixWorld();
    const expected = stock([occluder, tied, face], raycaster);
    const release = indexPortrait([face, tied, occluder]);
    try {
      const hits = cast([occluder, tied, face], raycaster);
      expectHits(hits, expected);
      expect(hits.map((hit) => [hit.object.name, hit.faceIndex])).toEqual([
        ["Eye", 0], ["Tied", 0], ["Tied", 1], ["Face", 0], ["Face", 1],
      ]);
      expect(cast([face, tied], raycaster)[0]?.uv1?.toArray()).toEqual([0.25, 0.25]);
      expect(cast([tied, face], raycaster)[0]?.object).toBe(tied);
    } finally { release(); }
  });

  it.each([true, false])("keeps sides, overlapping group order, group gaps, and draw range with indexed=%s", (indexed) => {
    const geometry = triangles(5, indexed);
    geometry.addGroup(6, 6, 1);
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(3, 6, 0);
    geometry.addGroup(9, 3, 2);
    geometry.setDrawRange(3, 12);
    const groups = geometry.groups;
    const grouped = new Mesh(geometry, [
      new MeshBasicMaterial({ side: FrontSide }), new MeshBasicMaterial({ side: DoubleSide }),
      new MeshBasicMaterial({ side: BackSide }),
    ]);
    const single = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    grouped.updateMatrixWorld();
    single.updateMatrixWorld();
    const front = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
    const back = new Raycaster(new Vector3(0, 0, -2), new Vector3(0, 0, 1));
    const expected = [stock([grouped], front), stock([grouped], back), stock([single], front)];
    const release = indexPortrait([grouped, single]);
    try {
      const hits = [cast([grouped], front), cast([grouped], back), cast([single], front)];
      hits.forEach((result, index) => expectHits(result, expected[index]!));
      expect(hits.map((result) => result.map((hit) => hit.faceIndex)))
        .toEqual([[2, 3, 1, 1, 2], [2, 3, 3], [1, 2, 3, 4]]);
      expect(geometry.groups).toBe(groups);
      expect(geometry.drawRange).toEqual({ start: 3, count: 12 });
    } finally { release(); }
    expect(geometry.index === null).toBe(!indexed);
  });

  it("keeps world transforms and near/far clipping", () => {
    const mesh = new Mesh(triangles(), new MeshBasicMaterial({ side: DoubleSide }));
    mesh.scale.set(1.7, 0.8, 2.3);
    mesh.rotation.set(0.1, 0.2, 0, "YXZ");
    mesh.position.set(0, 0, 0.25);
    mesh.updateMatrixWorld();
    const rays = [
      new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1), 1, 2),
      new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1), 0, 1.7),
      new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1), 1.8, 3),
    ];
    const expected = rays.map((ray) => stock([mesh], ray));
    const release = indexPortrait([mesh]);
    try {
      rays.forEach((ray, index) => expectHits(cast([mesh], ray), expected[index]!));
      expect(cast([mesh], rays[0]!)[0]?.distance).toBeCloseTo(1.75, 12);
      expect(cast([mesh], rays[1]!)).toEqual([]);
      expect(cast([mesh], rays[2]!)).toEqual([]);
    } finally { release(); }
  });

  it("rolls back a tree build failure and can set up the same valid mesh afterwards", () => {
    const geometry = triangles(1, false);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const invalid = new Mesh(new BufferGeometry(), mesh.material);
    expect(() => indexPortrait([mesh, invalid])).toThrow();
    expect(mesh.raycast).toBe(stockRaycast);
    expect(Object.hasOwn(mesh, "raycast")).toBe(false);
    expect(Object.hasOwn(geometry, "boundsTree")).toBe(false);
    expect(geometry.index).toBeNull();
    const release = indexPortrait([mesh]);
    try { expect(cast([mesh])[0]?.distance).toBe(2); }
    finally { release(); }
  });

  it("rolls back earlier mesh overrides when a later override cannot be installed", () => {
    const geometry = triangles();
    const index = geometry.index;
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const locked = new Mesh(geometry, mesh.material);
    Object.defineProperty(locked, "raycast", { value: stockRaycast, writable: false, configurable: true });
    expect(() => indexPortrait([mesh, locked])).toThrow();
    expect(Object.hasOwn(mesh, "raycast")).toBe(false);
    expect(mesh.raycast).toBe(stockRaycast);
    expect(locked.raycast).toBe(stockRaycast);
    expect(Object.hasOwn(geometry, "boundsTree")).toBe(false);
    expect(geometry.index).toBe(index);
    expect(cast([mesh])[0]?.distance).toBe(2);
  });
});

async function paintMask(): Promise<Uint8Array> {
  const bytes = new Uint8Array(await (await fetch(maskUrl)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  expect([view.getUint32(16), view.getUint32(20), bytes[24], bytes[25], bytes[28]])
    .toEqual([1024, 1024, 8, 6, 0]);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream("deflate"));
  const filtered = new Uint8Array(await new Response(stream).arrayBuffer());
  const pixels = new Uint8Array(1024 * 1024 * 4);
  const stride = 1024 * 4;
  for (let y = 0; y < 1024; y += 1) {
    const filter = filtered[y * (stride + 1)]!;
    if (filter > 4) throw new Error("Unsupported PNG filter.");
    for (let x = 0; x < stride; x += 1) {
      const offset = y * stride + x;
      const left = x >= 4 ? pixels[offset - 4]! : 0;
      const above = y > 0 ? pixels[offset - stride]! : 0;
      const diagonal = x >= 4 && y > 0 ? pixels[offset - stride - 4]! : 0;
      const prediction = left + above - diagonal;
      const distances = [Math.abs(prediction - left), Math.abs(prediction - above), Math.abs(prediction - diagonal)];
      const paeth = distances[0]! <= distances[1]! && distances[0]! <= distances[2]!
        ? left : distances[1]! <= distances[2]! ? above : diagonal;
      const correction = [0, left, above, Math.floor((left + above) / 2), paeth][filter]!;
      pixels[offset] = filtered[y * (stride + 1) + 1 + x]! + correction;
    }
  }
  return Uint8Array.from({ length: 1024 * 1024 }, (_, index) => pixels[index * 4]!);
}

function accepted(hit: Intersection | undefined, face: Mesh, mask: Uint8Array): UV | null {
  if (hit?.object !== face || hit.uv1 === undefined) return null;
  const { x: u, y: v } = hit.uv1;
  if (u <= 3 / 1024 || v <= 3 / 1024 || u >= 1 - 3 / 1024 || v >= 1 - 3 / 1024) return null;
  return mask[Math.floor(v * 1024) * 1024 + Math.floor(u * 1024)]! > 0 ? [u, v] : null;
}

function capturedPaths(samples: readonly (readonly [UV | null, UV | null])[]): readonly (readonly UV[])[] {
  const paths: UV[][] = [];
  const active: [number | null, number | null] = [null, null];
  for (const sample of samples) {
    for (const channel of [0, 1] as const) {
      const point = sample[channel];
      if (point === null) { active[channel] = null; continue; }
      let pathIndex = active[channel];
      if (pathIndex === null) {
        if (paths.length >= 8) continue;
        pathIndex = paths.length;
        paths.push([]);
        active[channel] = pathIndex;
      }
      const path = paths[pathIndex]!;
      const previous = path.at(-1);
      if (previous === undefined || Math.hypot(previous[0] - point[0], previous[1] - point[1]) >= 0.0007) path.push(point);
    }
  }
  if (paths.length === 0) return [];
  const stroke = captureStroke("picking", { ...defaultBrush(), mirror: true }, paths);
  if (!stroke.ok) throw new Error(stroke.error);
  return stroke.value.paths;
}

it("matches head.glb hits, occlusion, UV1, mirrors, and captured paths across the supported portrait views", async () => {
  const loader = new GLTFLoader();
  loader.register((parser) => ({
    name: "picking-test-materials",
    async loadMaterial(index) {
      return new MeshBasicMaterial({ side: parser.json.materials[index].doubleSided === true ? DoubleSide : FrontSide });
    },
  }));
  const gltf = await loader.parseAsync(await (await fetch(headUrl)).arrayBuffer(), "");
  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.name = typeof object.userData.name === "string" ? object.userData.name : object.name;
    meshes.push(object);
  });
  expect(meshes.map((mesh) => mesh.name)).toEqual(expect.arrayContaining(["Face", "Lashes", "HairBun", "BunBand"]));
  expect(meshes.every((mesh) => mesh.geometry.groups.length === 0)).toBe(true);
  const face = meshes.find((mesh) => mesh.name === "Face")!;
  const indexReferences = meshes.map((mesh) => mesh.geometry.index);
  const indexBytes = indexReferences.map((index) => index!.array.slice());
  const mask = await paintMask();
  expect(mask.filter((value) => value > 127)).toHaveLength(564646);
  const pivot = new Group();
  pivot.position.y = 0.277;
  const offset = new Group();
  offset.position.y = -0.277;
  pivot.add(offset);
  offset.add(gltf.scene);
  const camera = new OrthographicCamera(-0.2, 0.2, 0.25, -0.25, 0.1, 4);
  const frames = [
    { y: 0.282, span: 0.5, width: 0.32 }, { y: 0.312, span: 0.215, width: 0.2 },
    { y: 0.219, span: 0.155, width: 0.14 },
  ];
  const landmarks = [
    [0, 0.209, 0.153776], [0.029, 0.21, 0.136708], [-0.029, 0.21, 0.136706],
    [0.07, 0.252, 0.124605], [-0.07, 0.252, 0.124605],
    [0.052, 0.314, 0.133989], [-0.052, 0.314, 0.133989],
    [0, 0.37, 0.14746], [0, 0.25, 0.17173],
    [0.0468, 0.2933, 0.124], [-0.0468, 0.2933, 0.124],
    [-0.1, 0.35, 0.13], [0.1, 0.35, 0.13], [0, 0.44, 0.06], [0, 0.15, 0.05],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  const position = face.geometry.getAttribute("position");
  const uv1 = face.geometry.getAttribute("uv1");
  for (let triangle = 0; triangle < face.geometry.index!.count; triangle += 3000) {
    const a = face.geometry.index!.getX(triangle);
    const b = face.geometry.index!.getX(triangle + 1);
    if (uv1.getX(a) === 0) continue;
    landmarks.push(new Vector3().fromBufferAttribute(position, a));
    landmarks.push(new Vector3().fromBufferAttribute(position, a).lerp(new Vector3().fromBufferAttribute(position, b), 0.5));
    if (landmarks.length >= 21) break;
  }
  const raycaster = new Raycaster();
  const seen = new Set<string>();
  let acceptedCount = 0;
  let mirrorCount = 0;
  let viewCount = 0;
  let rayCount = 0;
  for (const mesh of meshes) mesh.raycast = () => { throw new Error("The per-mesh stock raycast was not replaced."); };
  const release = indexPortrait(meshes);
  try {
    for (const mesh of meshes.filter((mesh) => mesh.morphTargetInfluences === undefined)) {
      expect(mesh.geometry.boundsTree).toBeInstanceOf(MeshBVH);
      expect(mesh.geometry.boundsTree!.indirect).toBe(true);
    }
    for (const [frameIndex, frame] of frames.entries()) {
      for (const yaw of [-28, 0, 28]) {
        for (const pitch of [-12, 0, 12]) {
          for (const zoom of [1, 1.7]) {
            for (const style of Object.values(avatarChoices.hairStyle)) {
              const aspect = [0.55, 0.8, 1.4][(viewCount + Math.floor(viewCount / 3)) % 3]!;
              const span = Math.max(frame.span, frame.width / aspect) / zoom;
              camera.left = -span * aspect / 2;
              camera.right = span * aspect / 2;
              camera.top = span / 2;
              camera.bottom = -span / 2;
              const y = frameIndex === 0 ? Math.max(frame.y, span / 2 + 0.032) : frame.y;
              camera.position.set(0, y, 1.7);
              camera.lookAt(0, y, 0);
              camera.updateProjectionMatrix();
              camera.updateMatrixWorld();
              pivot.position.y = 0.277 + (viewCount % 3 - 1) * 0.0012;
              pivot.rotation.set(pitch * Math.PI / 180, yaw * Math.PI / 180, 0, "YXZ");
              for (const mesh of meshes) {
                if (["Hair", "HairSweep", "HairTail", "HairTie", "HairBun", "BunBand"].includes(mesh.name)) {
                  mesh.visible = (style.components as readonly string[]).includes(mesh.name);
                }
                mesh.morphTargetInfluences?.fill(0);
                if (mesh.morphTargetInfluences !== undefined && viewCount % 2 === 1) {
                  mesh.morphTargetInfluences[viewCount % mesh.morphTargetInfluences.length] = 1;
                }
              }
              release.refit();
              pivot.updateWorldMatrix(true, true);
              const visible = meshes.filter((mesh) => {
                for (let object: typeof mesh.parent = mesh; object !== null; object = object.parent) {
                  if (!object.visible) return false;
                }
                return true;
              });
              const pointers = landmarks.map((point) => face.localToWorld(point.clone()).project(camera))
                .filter((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)
                .map((point) => new Vector2(point.x, point.y));
              for (const x of [-0.98, 0, 0.98]) {
                for (const y of [-0.98, 0, 0.98]) pointers.push(new Vector2(x, y));
              }
              const baselineSamples: [UV | null, UV | null][] = [];
              const indexedSamples: [UV | null, UV | null][] = [];
              for (const pointer of pointers) {
                raycaster.setFromCamera(pointer, camera);
                const baseline = stock(visible, raycaster);
                const indexed = raycaster.intersectObjects(visible, false);
                expectHits(indexed, baseline);
                const before = accepted(baseline[0], face, mask);
                const after = accepted(indexed[0], face, mask);
                let baselineMirror: Intersection[] = [];
                let indexedMirror: Intersection[] = [];
                if (baseline[0] !== undefined) seen.add(baseline[0].object.name);
                function mirrorPointer(hit: Intersection): Vector2 | null {
                  const reflected = face.worldToLocal(hit.point.clone());
                  reflected.x *= -1;
                  face.localToWorld(reflected).project(camera);
                  return Math.abs(reflected.x) > 1 || Math.abs(reflected.y) > 1 ? null : new Vector2(reflected.x, reflected.y);
                }
                if (before !== null) {
                  acceptedCount += 1;
                  const pointer = mirrorPointer(baseline[0]!);
                  if (pointer !== null) {
                    raycaster.setFromCamera(pointer, camera);
                    baselineMirror = stock(visible, raycaster);
                  }
                }
                if (after !== null) {
                  const pointer = mirrorPointer(indexed[0]!);
                  if (pointer !== null) {
                    raycaster.setFromCamera(pointer, camera);
                    indexedMirror = raycaster.intersectObjects(visible, false);
                  }
                }
                expectHits(indexedMirror, baselineMirror);
                const beforeMirror = accepted(baselineMirror[0], face, mask);
                const afterMirror = accepted(indexedMirror[0], face, mask);
                if (beforeMirror !== null) mirrorCount += 1;
                baselineSamples.push([before, beforeMirror]);
                indexedSamples.push([after, afterMirror]);
                rayCount += 1;
              }
              expect(capturedPaths(indexedSamples)).toEqual(capturedPaths(baselineSamples));
              viewCount += 1;
            }
          }
        }
      }
    }
    expect(viewCount).toBe(108);
    expect(rayCount).toBeGreaterThan(1500);
    expect(acceptedCount).toBeGreaterThan(500);
    expect(mirrorCount).toBeGreaterThan(250);
    expect([...seen]).toEqual(expect.arrayContaining(["Face", "Hair", "HairSweep", "Eye.L", "Eye.R", "Lashes", "Brows"]));
    meshes.forEach((mesh, index) => {
      expect(mesh.geometry.index).toBe(indexReferences[index]);
      expect(mesh.geometry.index!.array).toEqual(indexBytes[index]);
    });
    console.log(JSON.stringify({ asset: "head.glb", views: viewCount, rays: rayCount, accepted: acceptedCount, mirrored: mirrorCount, nearestObjects: [...seen].sort() }));
  } finally {
    release();
    release();
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
  }
}, 60_000);
