import { Box3, Sphere } from "three";
import type { BufferGeometry, Intersection, Mesh, Raycaster } from "three";
import { acceleratedRaycast, MeshBVH, SkinnedMeshBVH } from "three-mesh-bvh";
import type { BVHOptions } from "three-mesh-bvh";

// The implementation accepts Mesh.getVertexPosition, including morph-only meshes. Its declaration requires SkinnedMesh.
const MorphMeshBVH = SkinnedMeshBVH as unknown as new (mesh: Mesh, options?: BVHOptions) => SkinnedMeshBVH;
export type PortraitPicking = (() => void) & { refit(): void };

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

export function indexPortrait(meshes: readonly Mesh[]): PortraitPicking {
  const restorers: (() => void)[] = [];
  const dynamic = new Map<Mesh, SkinnedMeshBVH>();
  const dynamicBounds = new Map<BufferGeometry, Box3>();
  const unique = [...new Set(meshes)];
  const moving = unique.filter((mesh) => (mesh.geometry.morphAttributes.position?.length ?? 0) > 0);
  const staticMeshes = unique.filter((mesh) => !moving.includes(mesh));
  function refit(): void {
    if (restorers.length === 0) return;
    for (const bounds of dynamicBounds.values()) bounds.makeEmpty();
    for (const [mesh, tree] of dynamic) {
      tree.refit();
      dynamicBounds.get(mesh.geometry)!.union(tree.getBoundingBox(new Box3()));
    }
    for (const [geometry, bounds] of dynamicBounds) {
      geometry.boundingBox = bounds.clone();
      geometry.boundingSphere = bounds.getBoundingSphere(new Sphere());
    }
  }
  function release(): void {
    let restore: (() => void) | undefined;
    while ((restore = restorers.pop()) !== undefined) restore();
    dynamic.clear();
    dynamicBounds.clear();
  }
  try {
    for (const geometry of new Set(staticMeshes.map((mesh) => mesh.geometry))) {
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
    for (const mesh of moving) {
      const geometry = mesh.geometry;
      if (Array.isArray(mesh.material) || geometry.groups.length !== 0 || geometry.drawRange.start !== 0
        || geometry.drawRange.count < (geometry.index?.count ?? geometry.getAttribute("position").count)) {
        throw new Error("Morph picking requires one material and the complete mesh draw range.");
      }
      if (!dynamicBounds.has(geometry)) {
        const originalBox = geometry.boundingBox;
        const originalSphere = geometry.boundingSphere;
        const originalIndex = geometry.index;
        dynamicBounds.set(geometry, new Box3());
        restorers.push(() => {
          geometry.boundingBox = originalBox;
          geometry.boundingSphere = originalSphere;
          if (geometry.index !== originalIndex) geometry.setIndex(originalIndex);
        });
      }
      dynamic.set(mesh, new MorphMeshBVH(mesh, { indirect: true, setBoundingBox: false }));
    }
    for (const mesh of unique) {
      const originalRaycast = Object.getOwnPropertyDescriptor(mesh, "raycast");
      restorers.push(() => {
        dynamic.delete(mesh);
        if (originalRaycast === undefined) Reflect.deleteProperty(mesh, "raycast");
        else Object.defineProperty(mesh, "raycast", originalRaycast);
      });
      const tree = dynamic.get(mesh);
      mesh.raycast = tree === undefined ? portraitRaycast : function (this: Mesh, raycaster, intersects) {
        const hits: Intersection[] = [];
        tree.raycastObject3D(this, raycaster, hits);
        for (const hit of hits) {
          for (const attribute of ["uv", "uv1", "normal"] as const) {
            if (hit[attribute] == null) delete hit[attribute];
          }
        }
        hits.sort((a, b) => a.faceIndex! - b.faceIndex!);
        intersects.push(...hits);
      };
    }
    refit();
    return Object.assign(release, { refit });
  } catch (error) {
    release();
    throw error;
  }
}
