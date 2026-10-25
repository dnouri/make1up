import { describe, expect, it } from "vitest";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import type { Intersection } from "three";
import { indexPortrait } from "../src/picking";

const stockRaycast = Mesh.prototype.raycast;

function morphGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    -1.9, -0.4, 0, -1.1, -0.4, 0, -1.5, 0.4, 0,
    1.1, -0.4, 0, 1.9, -0.4, 0, 1.5, 0.4, 0,
  ], 3));
  geometry.setAttribute("uv1", new Float32BufferAttribute([
    0.1, 0.2, 0.4, 0.2, 0.25, 0.8, 0.6, 0.2, 0.9, 0.2, 0.75, 0.8,
  ], 2));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new Float32BufferAttribute([
    -3, 0.2, 0.35, -3, 0.2, 0.35, -3, 0.2, 0.35,
    3, 0.2, 0.35, 3, 0.2, 0.35, 3, 0.2, 0.35,
  ], 3)];
  return geometry;
}

function cast(meshes: Mesh[], ray: Raycaster, stock = false): Intersection[] {
  for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
  if (!stock) return ray.intersectObjects(meshes, false);
  const hits: Intersection[] = [];
  for (const mesh of meshes) stockRaycast.call(mesh, ray, hits);
  return hits.sort((a, b) => a.distance - b.distance);
}

function compare(meshes: Mesh[], ray: Raycaster): Intersection[] {
  const actual = cast(meshes, ray);
  const expected = cast(meshes, ray, true);
  expect(actual.map((hit) => [hit.object.id, hit.faceIndex])).toEqual(expected.map((hit) => [hit.object.id, hit.faceIndex]));
  for (const [index, hit] of actual.entries()) {
    expect(hit.point.distanceTo(expected[index]!.point)).toBeLessThan(1e-12);
    expect(Math.abs(hit.distance - expected[index]!.distance)).toBeLessThan(1e-12);
    expect(hit.uv1!.distanceTo(expected[index]!.uv1!)).toBeLessThan(1e-12);
  }
  return actual;
}

function rayAt(x: number, y = 0): Raycaster {
  return new Raycaster(new Vector3(x, y, 3), new Vector3(0, 0, -1));
}

describe("per-instance morph picking", () => {
  it("refits moved positions and UV1, misses old positions, and picks the reflected face", () => {
    const geometry = morphGeometry();
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const release = indexPortrait([mesh]);
    try {
      for (const weight of [0, 0.25, 0.7, 1, 0.5, 1, 0]) {
        mesh.morphTargetInfluences![0] = weight;
        release.refit();
        const hit = compare([mesh], rayAt(1.5 + 3 * weight, 0.2 * weight))[0]!;
        expect(hit).toBeDefined();
        expect(hit.uv1!.x).toBeCloseTo(0.75, 7);
        expect(hit.uv1!.y).toBeCloseTo(0.5, 7);
        const mirrored = mesh.worldToLocal(hit.point.clone());
        mirrored.x *= -1;
        mesh.localToWorld(mirrored);
        const reflected = compare([mesh], rayAt(mirrored.x, mirrored.y))[0]!;
        expect(reflected.uv1!.x).toBeCloseTo(0.25, 7);
        expect(reflected.uv1!.y).toBeCloseTo(0.5, 7);
        expect(geometry.boundingSphere!.containsPoint(mesh.worldToLocal(hit.point.clone()))).toBe(true);
        if (weight === 1) expect(compare([mesh], rayAt(1.5))).toEqual([]);
      }
      expect(Object.hasOwn(geometry, "boundsTree")).toBe(false);
    } finally { release(); geometry.dispose(); mesh.material.dispose(); }
  });

  it("keeps shared geometry poses independent and restores ownership on repeated disposal", () => {
    const geometry = morphGeometry();
    const index = geometry.index;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const box = geometry.boundingBox;
    const sphere = geometry.boundingSphere;
    const first = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const second = new Mesh(geometry, first.material);
    first.morphTargetInfluences![0] = 1;
    second.morphTargetInfluences![0] = 0;
    second.position.y = 1.5;
    const release = indexPortrait([first, second, first]);
    const bounds = geometry.boundingSphere;
    expect(geometry.index).toBe(index);
    expect(compare([first, second], rayAt(4.5, 0.2))[0]!.object).toBe(first);
    expect(compare([first, second], rayAt(1.5, 1.5))[0]!.object).toBe(second);
    expect(compare([first], rayAt(1.5))).toEqual([]);
    expect(compare([second], rayAt(4.5, 1.7))).toEqual([]);
    for (let repeat = 0; repeat < 4; repeat++) {
      first.morphTargetInfluences![0] = repeat % 2;
      second.morphTargetInfluences![0] = 1 - repeat % 2;
      release.refit();
      expect(compare([first], rayAt(1.5 + 3 * first.morphTargetInfluences![0]!, 0.2 * first.morphTargetInfluences![0]!))).toHaveLength(1);
      expect(compare([second], rayAt(1.5 + 3 * second.morphTargetInfluences![0]!, 1.5 + 0.2 * second.morphTargetInfluences![0]!))).toHaveLength(1);
    }
    release();
    release();
    release.refit();
    expect(first.raycast).toBe(stockRaycast);
    expect(second.raycast).toBe(stockRaycast);
    expect(Object.hasOwn(first, "raycast")).toBe(false);
    expect(geometry.boundingBox).toBe(box);
    expect(geometry.boundingSphere).toBe(sphere);
    expect(geometry.boundingSphere).not.toBe(bounds);
    expect(Object.hasOwn(geometry, "boundsTree")).toBe(false);
    expect(geometry.index).toBe(index);
    geometry.dispose();
    first.material.dispose();
  });
});
