import type { Intersection, Mesh, Raycaster } from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";

function portraitRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  const hits: Intersection[] = [];
  acceleratedRaycast.call(this, raycaster, hits);
  if (Array.isArray(this.material)) {
    const groupOrder = new Map<Intersection, number>();
    const nextGroup = new Map<number, number>();
    for (const hit of hits) {
      const triangle = hit.faceIndex!;
      const groupIndex = this.geometry.groups.findIndex((group, index) => index >= (nextGroup.get(triangle) ?? 0)
        && group.materialIndex === hit.face!.materialIndex
        && triangle * 3 >= group.start && triangle * 3 < group.start + group.count);
      groupOrder.set(hit, groupIndex);
      nextGroup.set(triangle, groupIndex + 1);
    }
    hits.sort((a, b) => groupOrder.get(a)! - groupOrder.get(b)! || a.faceIndex! - b.faceIndex!);
  } else {
    hits.sort((a, b) => a.faceIndex! - b.faceIndex!);
  }
  // Raycaster's stable distance sort must receive the same tie order as Mesh.raycast.
  for (const hit of hits) intersects.push(hit);
}

export function indexPortrait(meshes: readonly Mesh[]): () => void {
  const restorers: (() => void)[] = [];
  function release(): void {
    let restore: (() => void) | undefined;
    while ((restore = restorers.pop()) !== undefined) restore();
  }
  try {
    for (const geometry of new Set(meshes.map((mesh) => mesh.geometry))) {
      const originalTree = Object.getOwnPropertyDescriptor(geometry, "boundsTree");
      const originalIndex = geometry.index;
      restorers.push(() => {
        if (originalTree === undefined) Reflect.deleteProperty(geometry, "boundsTree");
        else Object.defineProperty(geometry, "boundsTree", originalTree);
        if (geometry.index !== originalIndex) geometry.setIndex(originalIndex);
      });
      // Single-material meshes ignore groups, including gaps, even on shared geometry.
      const groups = geometry.groups;
      geometry.groups = [];
      try {
        geometry.boundsTree = new MeshBVH(geometry, { indirect: true, setBoundingBox: false });
      } finally {
        geometry.groups = groups;
      }
    }
    for (const mesh of new Set(meshes)) {
      const originalRaycast = Object.getOwnPropertyDescriptor(mesh, "raycast");
      restorers.push(() => {
        if (originalRaycast === undefined) Reflect.deleteProperty(mesh, "raycast");
        else Object.defineProperty(mesh, "raycast", originalRaycast);
      });
      mesh.raycast = portraitRaycast;
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
