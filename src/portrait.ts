import {
  ACESFilmicToneMapping, Color, DataTexture, DirectionalLight, Group, HemisphereLight,
  LinearFilter, Mesh, MeshStandardMaterial, NoColorSpace, OrthographicCamera,
  PMREMGenerator, Raycaster, RedFormat, RGBAFormat, Scene, SRGBColorSpace, Texture,
  TextureLoader, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderer,
} from "three";
import type { BufferGeometry, Intersection, Material, WebGLRenderTarget } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { captureStroke, catalog, defaultBrush, limits, newLook, regions, toolRegion, tools } from "./look";
import type { Brush, Look, Stroke, UV } from "./look";
import type { PortraitIdentity } from "./avatar";
import { analyzePaint, beginStroke, composePaint, createPaintMasks, paintStroke } from "./paint";
import type { ChangedPaint, PaintAnalysis, PaintField, PaintMasks, StrokeTransaction } from "./paint";
import { indexPortrait } from "./picking";
import type { Framing, PortraitPresentation } from "./session";

export interface Portrait {
  applyStroke(stroke: Stroke): boolean;
  present(presentation: PortraitPresentation): void;
  analyze(): PaintAnalysis;
  capture(look: Look): Promise<Blob>;
  zoom(direction: "in" | "out"): void;
  dispose(): void;
}

type PaintGesture = {
  kind: "paint";
  pointerId: number;
  id: string;
  brush: Brush;
  paths: UV[][];
  activePaths: [number | null, number | null];
  points: number;
  dirty: boolean;
  paint: StrokeTransaction;
};
type PendingPaint = Readonly<{ before: Look; candidate: ChangedPaint }>;
type Gesture = { kind: "idle" }
  | PaintGesture
  | { kind: "turn"; pointerId: number; x: number; y: number };

const frames: Record<Framing, { y: number; span: number; width: number }> = {
  face: { y: 0.282, span: 0.5, width: 0.32 },
  eyes: { y: 0.312, span: 0.215, width: 0.2 },
  lips: { y: 0.219, span: 0.155, width: 0.14 },
};
const pivotHeight = 0.277;
const maxYaw = 28 * Math.PI / 180;
const maxPitch = 12 * Math.PI / 180;
const maskSize = 1024;

async function readMask(name: string): Promise<Uint8Array> {
  const response = await fetch(`${import.meta.env.BASE_URL}face/v1/masks/${name}.png`);
  if (!response.ok) throw new Error(`The portrait mask ${name} could not load.`);
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none",
  });
  try {
    if (bitmap.width !== maskSize || bitmap.height !== maskSize) {
      throw new Error(`The portrait mask ${name} has the wrong dimensions.`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = maskSize;
    canvas.height = maskSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("The browser could not read the portrait masks.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, maskSize, maskSize).data;
    return Uint8Array.from({ length: maskSize * maskSize }, (_, index) => pixels[index * 4] ?? 0);
  } finally {
    bitmap.close();
  }
}

async function loadMasks(): Promise<PaintMasks> {
  const [valid, lips, leftCheek, rightCheek, leftLid, rightLid] = await Promise.all([
    readMask("paint-valid"), readMask("lips"), readMask("cheek-left"),
    readMask("cheek-right"), readMask("eyelid-left"), readMask("eyelid-right"),
  ]);
  const cheeks = leftCheek.map((value, index) => Math.max(value, rightCheek[index] ?? 0));
  const lids = leftLid.map((value, index) => Math.max(value, rightLid[index] ?? 0));
  const masks = createPaintMasks({ size: maskSize, valid, lips, cheeks, lids });
  if (!masks.ok) throw new Error(masks.error);
  return masks.value;
}

function materialOf(mesh: Mesh): MeshStandardMaterial {
  if (!(mesh.material instanceof MeshStandardMaterial)) {
    throw new Error(`The portrait material for ${mesh.name} is not supported.`);
  }
  return mesh.material;
}

function paintTexture(data: Uint8Array, size: number, pigment: boolean): DataTexture {
  const texture = new DataTexture(data, size, size, pigment ? RGBAFormat : RedFormat, UnsignedByteType);
  texture.colorSpace = pigment ? SRGBColorSpace : NoColorSpace;
  texture.flipY = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function installPaintMaterial(
  material: MeshStandardMaterial,
  pigment: DataTexture,
  finish: DataTexture,
  cursor: Vector4,
  mirrorCursor: Vector4,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.makeupPigment = { value: pigment };
    shader.uniforms.makeupFinish = { value: finish };
    shader.uniforms.makeupCursor = { value: cursor };
    shader.uniforms.makeupMirrorCursor = { value: mirrorCursor };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `
      #include <common>
      #ifndef USE_UV1
        attribute vec2 uv1;
      #endif
      varying vec2 vMakeupUv;
    `).replace("#include <uv_vertex>", `
      #include <uv_vertex>
      vMakeupUv = uv1;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
      #include <common>
      uniform sampler2D makeupPigment;
      uniform sampler2D makeupFinish;
      uniform vec4 makeupCursor;
      uniform vec4 makeupMirrorCursor;
      varying vec2 vMakeupUv;
      float brushRing(vec4 cursor) {
        float distanceToEdge = abs(length(vMakeupUv - cursor.xy) - cursor.z);
        float edgeWidth = max(fwidth(distanceToEdge) * 1.2, 0.0007);
        return (1.0 - smoothstep(edgeWidth, edgeWidth * 2.0, distanceToEdge)) * cursor.w;
      }
    `).replace("#include <map_fragment>", `
      #include <map_fragment>
      vec4 makeup = texture2D(makeupPigment, vMakeupUv);
      diffuseColor.rgb = mix(diffuseColor.rgb, makeup.rgb, makeup.a);
      float ring = max(brushRing(makeupCursor), brushRing(makeupMirrorCursor));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.91, 0.84), ring * 0.85);
    `).replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      float paintedFinish = texture2D(makeupFinish, vMakeupUv).r;
      roughnessFactor = mix(roughnessFactor, mix(0.82, 0.18, paintedFinish), makeup.a);
    `);
  };
  material.customProgramCacheKey = () => "rain-makeup-uv1-v1";
  material.needsUpdate = true;
}

function sameBrush(a: Brush, b: Brush): boolean {
  return a.tool === b.tool && a.color === b.color && a.radius === b.radius
    && a.opacity === b.opacity && a.softness === b.softness
    && a.finish === b.finish && a.mirror === b.mirror;
}

export async function mountPortrait(
  canvas: HTMLCanvasElement,
  onStroke: (stroke: Stroke) => void,
  onError: (message: string) => void,
): Promise<Portrait> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-0.2, 0.2, 0.25, -0.25, 0.1, 4);
  const pivot = new Group();
  pivot.position.y = pivotHeight;
  const offset = new Group();
  offset.position.y = -pivotHeight;
  pivot.add(offset);
  scene.add(pivot);
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  const geometries = new Set<BufferGeometry>();
  const listeners = new AbortController();
  const originalStyle = { cursor: canvas.style.cursor, touchAction: canvas.style.touchAction };
  let environment: WebGLRenderTarget | null = null;
  let releasePicking: (() => void) | null = null;
  let observer: ResizeObserver | null = null;
  let animation = 0;
  let disposed = false;

  function releaseResources(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animation);
    listeners.abort();
    observer?.disconnect();
    canvas.style.cursor = originalStyle.cursor;
    canvas.style.touchAction = originalStyle.touchAction;
    const bitmaps = new Set<ImageBitmap>();
    for (const texture of textures) {
      if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
      texture.dispose();
    }
    for (const bitmap of bitmaps) bitmap.close();
    for (const material of materials) material.dispose();
    releasePicking?.();
    releasePicking = null;
    for (const geometry of geometries) geometry.dispose();
    environment?.dispose();
    scene.clear();
    renderer.dispose();
  }

  try {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}face/v1/head.glb`);
    offset.add(gltf.scene);
    const meshes = new Map<string, Mesh>();
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const name = typeof object.userData.name === "string" ? object.userData.name : object.name;
      meshes.set(name, object);
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof Texture) textures.add(value);
        }
      }
    });
    releasePicking = indexPortrait([...meshes.values()]);
    function requireMesh(name: string): Mesh {
      const mesh = meshes.get(name);
      if (mesh === undefined) throw new Error(`The portrait is missing ${name}.`);
      return mesh;
    }
    const face = requireMesh("Face");
    if (!face.geometry.hasAttribute("uv1")) throw new Error("The portrait has no makeup coordinates.");
    const skin = materialOf(face);
    const bustSkin = materialOf(requireMesh("Bust"));
    const eyeMaterials = new Set([materialOf(requireMesh("Eye.L")), materialOf(requireMesh("Eye.R"))]);
    const hairNames = ["Hair", "HairSweep", "HairTail", "HairTie"] as const;
    const hairMaterials = new Set(hairNames.filter((name) => name !== "HairTie")
      .map((name) => materialOf(requireMesh(name))));
    const sourceColors = new Map([...materials].filter((material) => material instanceof MeshStandardMaterial)
      .map((material) => [material, material.color.clone()]));
    const blueMap = materialOf(requireMesh("Eye.L")).map;
    if (blueMap === null) throw new Error("The portrait has no iris texture.");
    const textureLoader = new TextureLoader();
    async function loadEye(id: "hazel" | "olive"): Promise<Texture> {
      const texture = await textureLoader.loadAsync(`${import.meta.env.BASE_URL}${catalog.eyes[id].texture.slice(1)}`);
      if (disposed) {
        texture.dispose();
        throw new Error("Portrait loading stopped.");
      }
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      textures.add(texture);
      return texture;
    }
    const [masks, hazelMap, oliveMap] = await Promise.all([loadMasks(), loadEye("hazel"), loadEye("olive")]);
    const eyeMaps = { blue: blueMap, hazel: hazelMap, olive: oliveMap };
    for (const texture of textures) texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    function rebuildEnvironment(): void {
      const room = new RoomEnvironment();
      const pmrem = new PMREMGenerator(renderer);
      try {
        const next = pmrem.fromScene(room, 0.025);
        environment?.dispose();
        environment = next;
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.45;
      } finally {
        room.dispose();
        pmrem.dispose();
      }
    }
    rebuildEnvironment();
    const key = new DirectionalLight(0xffffff, 2.8);
    key.position.set(-0.6, 0.7, 1.4);
    const fill = new DirectionalLight(0xeeeaff, 1.1);
    fill.position.set(0.8, 0.35, 1);
    scene.add(key, fill, new HemisphereLight(0xffffff, 0xaca2b0, 0.45));
    for (const material of hairMaterials) material.roughness = 0.66;

    let presentation: PortraitPresentation = {
      look: newLook(), brush: defaultBrush(), navigation: "paint", framing: "face", readonly: false,
    };
    let committed = composePaint([], masks);
    let displayed = committed;
    const pigment = paintTexture(new Uint8Array(committed.rgba.buffer), masks.size, true);
    const finish = paintTexture(committed.finish, masks.size, false);
    textures.add(pigment);
    textures.add(finish);
    const cursor = new Vector4();
    const mirrorCursor = new Vector4();
    installPaintMaterial(skin, pigment, finish, cursor, mirrorCursor);
    let gesture: Gesture = { kind: "idle" };
    let pendingPaint: PendingPaint | null = null;
    let dirty = true;
    let contextLost = false;
    let hovered = false;
    let yaw = 0;
    let pitch = 0;
    let zoom = 1;
    let width = 1;
    let height = 1;
    let floatTime = 0;
    let previousTime = 0;
    let lastAnalysis: PaintAnalysis | null = null;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = matchMedia("(pointer: coarse)");
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const reflectedPoint = new Vector3();
    const visibleMeshes: Mesh[] = [];
    const hits: Intersection[] = [];

    function showField(field: PaintField): void {
      displayed = field;
      pigment.image.data = new Uint8Array(field.rgba.buffer, field.rgba.byteOffset, field.rgba.byteLength);
      finish.image.data = field.finish;
      pigment.needsUpdate = true;
      finish.needsUpdate = true;
      dirty = true;
    }

    function applyIdentity(identity: PortraitIdentity): void {
      if (identity.kind !== "classic") throw new Error("This studio cannot display the new portrait yet.");
      for (const material of [skin, bustSkin]) {
        material.color.copy(sourceColors.get(material) ?? new Color(0xffffff))
          .multiply(new Color(catalog.complexions[identity.complexion].tint));
      }
      for (const material of hairMaterials) {
        material.color.copy(sourceColors.get(material) ?? new Color(0xffffff))
          .multiply(new Color(catalog.hairColors[identity.hairColor].tint));
      }
      for (const material of eyeMaterials) material.map = eyeMaps[identity.eyes];
      const visible: readonly string[] = catalog.hairStyles[identity.hairStyle].visible;
      for (const name of hairNames) requireMesh(name).visible = visible.includes(name);
      dirty = true;
    }

    function frameCamera(framing: Framing, aspect: number, magnification: number): void {
      const frame = frames[framing];
      const span = Math.max(frame.span, frame.width / aspect) / magnification;
      camera.left = -span * aspect / 2;
      camera.right = span * aspect / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.zoom = 1;
      const y = framing === "face" ? Math.max(frame.y, span / 2 + 0.032) : frame.y;
      camera.position.set(0, y, 1.7);
      camera.lookAt(0, y, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      dirty = true;
    }

    function hideCursor(): void {
      cursor.w = 0;
      mirrorCursor.w = 0;
      dirty = true;
    }

    function refreshCursorStyle(): void {
      canvas.style.cursor = presentation.navigation === "turn"
        ? gesture.kind === "turn" ? "grabbing" : "grab"
        : presentation.readonly ? "default" : "crosshair";
    }

    function cancelGesture(): void {
      const previous = gesture;
      gesture = { kind: "idle" };
      if (previous.kind !== "idle" && canvas.hasPointerCapture(previous.pointerId)) {
        canvas.releasePointerCapture(previous.pointerId);
      }
      if (previous.kind === "paint") showField(committed);
      hideCursor();
      refreshCursorStyle();
    }

    function applyStroke(stroke: Stroke): boolean {
      if (disposed || contextLost || presentation.readonly || presentation.navigation !== "paint") return false;
      const paint = gesture.kind === "paint" ? gesture.paint : beginStroke(committed, masks);
      cancelGesture();
      const candidate = paint.finish(stroke);
      if (candidate.kind === "unchanged") {
        const tool = tools[stroke.brush.tool];
        onError(`${tool.label} changed no makeup on the ${regions[toolRegion(stroke.brush.tool, stroke.policy)].label.toLowerCase()}.`);
        return false;
      }
      const previousLook = presentation.look;
      pendingPaint = { before: previousLook, candidate };
      try {
        onStroke(stroke);
        return presentation.look !== previousLook && presentation.look.strokes.at(-1) === stroke;
      } finally {
        pendingPaint = null;
      }
    }

    function resize(): void {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(devicePixelRatio || 1, coarsePointer.matches ? 1.5 : 2);
      if (nextWidth === width && nextHeight === height && dpr === renderer.getPixelRatio()) return;
      cancelGesture();
      width = nextWidth;
      height = nextHeight;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      frameCamera(presentation.framing, width / height, zoom);
    }

    function nearestFace(): Intersection | null {
      pivot.updateWorldMatrix(true, true);
      visibleMeshes.length = 0;
      for (const mesh of meshes.values()) {
        let visible = true;
        for (let object: typeof mesh.parent = mesh; object !== null; object = object.parent) {
          if (!object.visible) { visible = false; break; }
        }
        if (visible) visibleMeshes.push(mesh);
      }
      hits.length = 0;
      raycaster.intersectObjects(visibleMeshes, false, hits);
      const hit = hits[0];
      if (hit === undefined || hit.object !== face || hit.uv1 === undefined) return null;
      const { x: u, y: v } = hit.uv1;
      if (u <= 3 / masks.size || v <= 3 / masks.size || u >= 1 - 3 / masks.size || v >= 1 - 3 / masks.size) return null;
      const index = Math.floor(v * masks.size) * masks.size + Math.floor(u * masks.size);
      return (masks.valid[index] ?? 0) > 0 ? hit : null;
    }

    function hitAt(event: PointerEvent): Intersection | null {
      const rect = canvas.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      raycaster.setFromCamera(pointer, camera);
      return nearestFace();
    }

    function mirrorHit(hit: Intersection): Intersection | null {
      reflectedPoint.copy(hit.point);
      face.worldToLocal(reflectedPoint);
      reflectedPoint.x *= -1;
      face.localToWorld(reflectedPoint);
      reflectedPoint.project(camera);
      if (Math.abs(reflectedPoint.x) > 1 || Math.abs(reflectedPoint.y) > 1) return null;
      pointer.set(reflectedPoint.x, reflectedPoint.y);
      raycaster.setFromCamera(pointer, camera);
      return nearestFace();
    }

    function updateCursor(hit: Intersection | null, reflected: Intersection | null, brush: Brush): void {
      const uv = hit?.uv1;
      const mirrored = reflected?.uv1;
      cursor.set(uv?.x ?? 0, uv?.y ?? 0, brush.radius, uv === undefined ? 0 : 1);
      mirrorCursor.set(mirrored?.x ?? 0, mirrored?.y ?? 0, brush.radius, mirrored === undefined ? 0 : 1);
      dirty = true;
    }

    function addPoint(draft: PaintGesture, hit: Intersection | null, channel: 0 | 1): void {
      const uv = hit?.uv1;
      if (uv === undefined) {
        draft.activePaths[channel] = null;
        return;
      }
      if (draft.points >= limits.pointsPerStroke) return;
      let pathIndex = draft.activePaths[channel];
      if (pathIndex === null) {
        if (draft.paths.length >= limits.pathsPerStroke) return;
        pathIndex = draft.paths.length;
        draft.paths.push([]);
        draft.activePaths[channel] = pathIndex;
      }
      const path = draft.paths[pathIndex];
      if (path === undefined) return;
      const previous = path.at(-1);
      if (previous !== undefined && Math.hypot(previous[0] - uv.x, previous[1] - uv.y) < 0.0007) return;
      path.push([uv.x, uv.y]);
      draft.points += 1;
      draft.dirty = true;
    }

    function sample(event: PointerEvent, draft: PaintGesture | null): void {
      const brush = draft?.brush ?? presentation.brush;
      const hit = hitAt(event);
      const reflected = brush.mirror && hit !== null ? mirrorHit(hit) : null;
      updateCursor(hit, reflected, brush);
      if (draft !== null) {
        addPoint(draft, hit, 0);
        if (brush.mirror) addPoint(draft, reflected, 1);
      }
    }

    function pointerDown(event: PointerEvent): void {
      if (disposed || contextLost || event.button !== 0 || !event.isPrimary || gesture.kind !== "idle") return;
      if (presentation.readonly && presentation.navigation === "paint") return;
      event.preventDefault();
      hovered = true;
      canvas.setPointerCapture(event.pointerId);
      if (presentation.navigation === "turn") {
        gesture = { kind: "turn", pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        hideCursor();
      } else {
        gesture = {
          kind: "paint", pointerId: event.pointerId, id: crypto.randomUUID(), brush: presentation.brush,
          paths: [], activePaths: [null, null], points: 0, dirty: false, paint: beginStroke(committed, masks),
        };
        sample(event, gesture);
      }
      refreshCursorStyle();
    }

    function pointerMove(event: PointerEvent): void {
      if (disposed || contextLost || (presentation.readonly && presentation.navigation === "paint")) return;
      hovered = true;
      if (gesture.kind !== "idle" && event.pointerId !== gesture.pointerId) return;
      if (gesture.kind === "turn") {
        event.preventDefault();
        yaw = Math.max(-maxYaw, Math.min(maxYaw, yaw + (event.clientX - gesture.x) * 0.005));
        pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch + (event.clientY - gesture.y) * 0.004));
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        pivot.rotation.set(pitch, yaw, 0, "YXZ");
        dirty = true;
      } else if (presentation.navigation === "paint") {
        const draft = gesture.kind === "paint" ? gesture : null;
        const events = draft === null ? [] : event.getCoalescedEvents?.() ?? [];
        if (events.length === 0) sample(event, draft);
        else {
          for (const point of events.slice(0, limits.pointsPerStroke)) {
            if (draft !== null && draft.points >= limits.pointsPerStroke) break;
            sample(point, draft);
          }
        }
      }
    }

    function pointerUp(event: PointerEvent): void {
      if (gesture.kind === "idle" || event.pointerId !== gesture.pointerId) return;
      const completed = gesture;
      if (completed.kind === "paint") sample(event, completed);
      if (event.pointerType !== "mouse") hovered = false;
      if (completed.kind !== "paint" || completed.points === 0) {
        cancelGesture();
        return;
      }
      const stroke = captureStroke(completed.id, completed.brush, completed.paths);
      if (stroke.ok) applyStroke(stroke.value);
      else {
        cancelGesture();
        onError(stroke.error);
      }
    }

    function pointerCancel(event: PointerEvent): void {
      if (gesture.kind !== "idle" && event.pointerId === gesture.pointerId) cancelGesture();
      hovered = false;
    }

    function present(next: PortraitPresentation): void {
      if (disposed) return;
      if (next.look.asset !== "rain-portrait-v1") throw new Error("This studio cannot display the new portrait yet.");
      const previous = presentation;
      if (next.look !== previous.look || next.readonly !== previous.readonly
        || next.navigation !== previous.navigation || next.framing !== previous.framing
        || !sameBrush(next.brush, previous.brush)) cancelGesture();
      if (next.look.strokes !== previous.look.strokes) {
        const prefix = previous.look.strokes.length <= next.look.strokes.length
          && previous.look.strokes.every((stroke, index) => stroke === next.look.strokes[index]);
        const candidate = pendingPaint?.candidate;
        const adopt = candidate !== undefined && pendingPaint?.before === previous.look
          && candidate.base === committed && prefix
          && next.look.strokes.length === previous.look.strokes.length + 1
          && next.look.strokes.at(-1) === candidate.stroke;
        committed = adopt ? candidate.field : prefix
          ? next.look.strokes.slice(previous.look.strokes.length).reduce((field, stroke) => paintStroke(field, stroke, masks), committed)
          : composePaint(next.look.strokes, masks);
        lastAnalysis = null;
        showField(committed);
      }
      presentation = next;
      if (next.look.identity !== previous.look.identity) applyIdentity(next.look.identity);
      if (next.framing !== previous.framing || next.readonly !== previous.readonly) {
        yaw = 0;
        pitch = 0;
        zoom = 1;
        pivot.rotation.set(0, 0, 0);
        frameCamera(next.framing, width / height, zoom);
      }
      if (next.readonly || next.navigation !== "paint") hideCursor();
      refreshCursorStyle();
      dirty = true;
    }

    async function capture(look: Look): Promise<Blob> {
      if (disposed || contextLost) throw new Error("The portrait is not available for export.");
      if (look.asset !== "rain-portrait-v1") throw new Error("This studio cannot display the new portrait yet.");
      const output = document.createElement("canvas");
      output.width = 1080;
      output.height = 1350;
      const context = output.getContext("2d");
      if (context === null) throw new Error("The browser could not create a portrait image.");
      const savedCamera = camera.clone();
      const savedPosition = pivot.position.clone();
      const savedRotation = pivot.rotation.clone();
      const savedCursor = cursor.clone();
      const savedMirrorCursor = mirrorCursor.clone();
      const savedField = displayed;
      const pixelRatio = renderer.getPixelRatio();
      const renderSize = renderer.getSize(new Vector2());
      try {
        applyIdentity(look.identity);
        showField(look.strokes === presentation.look.strokes ? committed : composePaint(look.strokes, masks));
        hideCursor();
        pivot.position.set(0, pivotHeight, 0);
        pivot.rotation.set(0, 0, 0);
        frameCamera("face", output.width / output.height, 1);
        renderer.setPixelRatio(1);
        renderer.setSize(output.width, output.height, false);
        renderer.render(scene, camera);
        const background = context.createLinearGradient(0, 0, output.width, output.height);
        background.addColorStop(0, "#f6eee6");
        background.addColorStop(1, "#e3deef");
        context.fillStyle = background;
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(canvas, 0, 0);
      } finally {
        applyIdentity(presentation.look.identity);
        showField(savedField);
        cursor.copy(savedCursor);
        mirrorCursor.copy(savedMirrorCursor);
        pivot.position.copy(savedPosition);
        pivot.rotation.copy(savedRotation);
        camera.copy(savedCamera);
        camera.updateMatrixWorld();
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(renderSize.x, renderSize.y, false);
        renderer.render(scene, camera);
        dirty = true;
      }
      return new Promise<Blob>((resolve, reject) => {
        output.toBlob((blob) => {
          if (blob === null) reject(new Error("The browser could not encode the portrait PNG."));
          else resolve(blob);
        }, "image/png");
      });
    }

    function tick(time: number): void {
      if (disposed) return;
      animation = requestAnimationFrame(tick);
      const delta = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
      previousTime = time;
      if (contextLost || document.hidden) return;
      try {
        if (gesture.kind === "paint" && gesture.dirty) {
          gesture.dirty = false;
          if (gesture.points > 0) {
            const draft = captureStroke(gesture.id, gesture.brush, gesture.paths);
            if (draft.ok) {
              const preview = gesture.paint.update(draft.value);
              if (preview !== null) showField(preview);
            }
          }
        }
        if (gesture.kind === "idle" && !hovered && !reducedMotion.matches) {
          floatTime += delta;
          pivot.position.y = pivotHeight + Math.sin(floatTime * 0.85) * 0.0012;
          dirty = true;
        }
        if (dirty) {
          renderer.render(scene, camera);
          dirty = false;
        }
      } catch {
        cancelGesture();
        contextLost = true;
        onError("The portrait could not draw. Reload the studio to try again.");
      }
    }

    canvas.style.touchAction = "none";
    const options = { signal: listeners.signal };
    canvas.addEventListener("pointerdown", pointerDown, options);
    canvas.addEventListener("pointermove", pointerMove, options);
    canvas.addEventListener("pointerup", pointerUp, options);
    canvas.addEventListener("pointercancel", pointerCancel, options);
    canvas.addEventListener("lostpointercapture", pointerCancel, options);
    canvas.addEventListener("pointerleave", () => { hovered = false; if (gesture.kind === "idle") hideCursor(); }, options);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), options);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      cancelGesture();
      onError("The graphics connection was interrupted. The current look is still safe.");
    }, options);
    canvas.addEventListener("webglcontextrestored", () => {
      try {
        rebuildEnvironment();
        showField(displayed);
        contextLost = false;
      } catch {
        onError("The portrait lighting could not recover. Reload the studio to try again.");
      }
    }, options);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelGesture(); }, options);
    window.addEventListener("blur", () => { hovered = false; cancelGesture(); }, options);
    window.addEventListener("resize", resize, options);
    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches && gesture.kind === "idle") pivot.position.y = pivotHeight;
      dirty = true;
    }, options);
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    applyIdentity(presentation.look.identity);
    resize();
    refreshCursorStyle();
    if (renderer.extensions.has("KHR_parallel_shader_compile")) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    renderer.render(scene, camera);
    animation = requestAnimationFrame(tick);

    return {
      applyStroke,
      present,
      analyze() {
        if (lastAnalysis === null) lastAnalysis = analyzePaint(committed, masks);
        return lastAnalysis;
      },
      capture,
      zoom(direction) {
        if (disposed) return;
        cancelGesture();
        zoom = Math.max(1, Math.min(1.7, zoom * (direction === "in" ? 1.13 : 1 / 1.13)));
        frameCamera(presentation.framing, width / height, zoom);
      },
      dispose() {
        if (disposed) return;
        cancelGesture();
        releaseResources();
      },
    };
  } catch (error) {
    releaseResources();
    throw error instanceof Error ? error : new Error("The portrait could not load.");
  }
}
