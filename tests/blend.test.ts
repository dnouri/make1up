import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendStroke, captureStroke, clearMakeup, decodeLook, decodeLookJSON, defaultBrush,
  encodeLook, lookFingerprint, newLook,
} from "../src/look";
import type { Brush, Look, Result, Stroke, UV } from "../src/look";
import { decodeShare, encodeShare, readLookbook, saveLook } from "../src/lookbook";
import type { StoragePort } from "../src/lookbook";
import { beginStroke, composePaint, createPaintMasks, paintStroke, strokeChanges } from "../src/paint";
import type { FinishedPaint, PaintField, PaintMasks } from "../src/paint";
import { createSession, presentSession, step } from "../src/session";
import type { Action, Session } from "../src/session";
import { mountPortrait } from "../src/portrait";
import type { Portrait } from "../src/portrait";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function masks(size = 16): PaintMasks {
  const all = new Uint8Array(size * size).fill(255);
  return value(createPaintMasks({ size, valid: all, lips: all, cheeks: all, lids: all }));
}

function blend(paths: readonly (readonly UV[])[] = [[[0.5, 0.5]]], changes: Partial<Brush> = {}, id = "soften"): Stroke {
  return value(captureStroke(id, {
    ...defaultBrush("blend"), radius: 0.08, opacity: 0.5, softness: 0, color: "#00ff00", finish: 1, ...changes,
  }, paths));
}

function dot(id = "dot"): Stroke {
  return value(captureStroke(id, {
    ...defaultBrush("liner"), radius: 0.04, color: "#cc5075", opacity: 1, softness: 0, finish: 0.4,
  }, [[[7.5 / 16, 7.5 / 16]]]));
}

function pixel(field: PaintField, x: number, y: number): number[] {
  const index = y * field.size + x;
  return [...field.rgba.slice(index * 4, index * 4 + 4), field.finish[index]!];
}

function changed(result: FinishedPaint): PaintField {
  expect(result.kind).toBe("changed");
  if (result.kind !== "changed") throw new Error("Expected changed paint.");
  return result.field;
}

function blank(size: number): PaintField {
  return { size, rgba: new Uint8ClampedArray(size * size * 4), finish: new Uint8Array(size * size) };
}

function put(field: PaintField, x: number, y: number, rgba: readonly number[], finish = 0): void {
  field.rgba.set(rgba, (y * field.size + x) * 4);
  field.finish[y * field.size + x] = finish;
}

const mounted: Portrait[] = [];
afterEach(() => {
  for (const portrait of mounted) portrait.dispose();
  mounted.length = 0;
  vi.unstubAllGlobals();
});

describe("explicit Blend instructions", () => {
  it("captures the current Blend tag and round trips it without a document upgrade", () => {
    const stroke = blend();
    expect(stroke).toEqual({
      id: "soften", algorithm: "soften-v1",
      brush: { tool: "blend", color: "#00ff00", radius: 0.08, opacity: 0.5, softness: 0, finish: 1 },
      paths: [[[32768 / 65535, 32768 / 65535]]],
    });
    expect(Object.isFrozen(stroke)).toBe(true);
    const next = value(appendStroke(newLook(), stroke));
    expect(value(decodeLookJSON(encodeLook(next)))).toEqual(next);
    expect(clearMakeup(next).version).toBe(2);
    expect(appendStroke(next, stroke).ok).toBe(false);
  });

  it.each([null, "unknown", "soften-v2", 1, {}])("rejects unsupported stored algorithm %j", (algorithm) => {
    const expected = { ok: false, error: "Unknown stroke algorithm or incompatible makeup tool." };
    expect(decodeLook({ ...newLook(), version: 2, strokes: [{ ...value(captureStroke("bad", defaultBrush("blend"), [[[0.2, 0.4]]])), algorithm }] })).toEqual(expected);
    expect(blend().algorithm).toBe("soften-v1");
  });

  it("rejects missing Blend tags and tags on other tools", () => {
    for (const tool of ["liner", "erase", "lipstick"] as const) {
      const { mirror: _mirror, ...brush } = defaultBrush(tool);
      expect(decodeLook({ ...newLook(), strokes: [{ ...dot(), brush, algorithm: "soften-v1" }] }).ok).toBe(false);
    }
    const { algorithm: _algorithm, ...untagged } = blend();
    expect(decodeLook({ ...newLook(), strokes: [untagged] }).ok).toBe(false);
    expect(value(decodeLook({ ...newLook(), strokes: [dot(), blend()] })).strokes.map((stroke) => stroke.algorithm)).toEqual([undefined, "soften-v1"]);
  });
});

describe("dense fixed-source softening", () => {
  it("filters a dot into adjacent blank samples with literal alpha and finish bytes", () => {
    const input = masks();
    const base = composePaint([dot()], input);
    const field = changed(beginStroke(base, input).finish(blend()));
    expect(pixel(base, 7, 7)).toEqual([204, 80, 117, 255, 102]);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 197, 102]);
    expect(pixel(field, 8, 7)).toEqual([204, 80, 117, 7, 102]);
    expect(pixel(field, 8, 8)).toEqual([204, 80, 117, 7, 102]);
    expect(pixel(field, 6, 7)).toEqual([0, 0, 0, 0, 0]);
    expect(paintStroke(base, blend(), input)).toEqual(field);
    expect(composePaint([dot(), blend()], input)).toEqual(field);
  });

  it("uses contiguous support for a broad brush instead of detached offset copies", () => {
    const input = masks(128);
    const base = blank(128);
    put(base, 64, 64, [204, 80, 117, 255], 102);
    const field = paintStroke(base, blend([[[64.5 / 128, 64.5 / 128]]]), input);
    expect(Array.from({ length: 7 }, (_, offset) => pixel(field, 61 + offset, 64)[3])).toEqual([0, 2, 2, 216, 2, 2, 0]);
    expect(pixel(field, 62, 62)).toEqual([204, 80, 117, 2, 102]);
    expect(pixel(field, 60, 64)).toEqual([0, 0, 0, 0, 0]);
  });

  it("scales the contiguous filter with brush radius", () => {
    const input = masks(256);
    const base = blank(256);
    for (let y = 3; y < 253; y += 1) for (let x = 3; x <= 127; x += 1) put(base, x, y, [204, 80, 117, 255], 102);
    const field = paintStroke(base, blend([[[128.5 / 256, 128.5 / 256]]]), input);
    expect(Array.from({ length: 13 }, (_, offset) => pixel(field, 122 + offset, 128)[3])).toEqual([
      255, 251, 248, 244, 240, 236, 19, 15, 11, 7, 4, 0, 0,
    ]);
    expect(pixel(field, 132, 128)).toEqual([204, 80, 117, 4, 102]);
    const small = paintStroke(base, blend([[[128.5 / 256, 128.5 / 256]]], { radius: 0.04 }), input);
    expect(pixel(small, 132, 128)).toEqual([0, 0, 0, 0, 0]);
  });

  it.each([[0.2, 230, 3], [0.7, 179, 10], [1, 154, 13]])("uses strength %s for an initial dab", (opacity, center, edge) => {
    const input = masks();
    const base = composePaint([dot()], input);
    const field = paintStroke(base, blend(undefined, { opacity }), input);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, center, 102]);
    expect(pixel(field, 8, 7)).toEqual([204, 80, 117, edge, 102]);
  });

  it("saturates toward one fixed target rather than diffusing the last dab", () => {
    const input = masks();
    const base = composePaint([dot()], input);
    const path: UV[] = Array.from({ length: 100 }, (_, index) => [index % 2 === 0 ? 0.4 : 0.6, 0.5]);
    const field = paintStroke(base, blend([path]), input);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 28, 102]);
    expect(pixel(field, 8, 7)).toEqual([204, 80, 117, 28, 102]);
    expect(pixel(field, 9, 7)).toEqual([0, 0, 0, 0, 0]);
    expect(pixel(base, 7, 7)).toEqual([204, 80, 117, 255, 102]);
  });

  it("mixes premultiplied pigment and finish without assigning the selected color or gloss", () => {
    const input = masks();
    const base = blank(16);
    put(base, 7, 7, [255, 0, 0, 255], 0);
    put(base, 8, 7, [0, 0, 255, 128], 255);
    const field = paintStroke(base, blend(), input);
    expect(pixel(field, 7, 7)).toEqual([250, 0, 5, 201, 5]);
    expect(pixel(field, 8, 7)).toEqual([17, 0, 238, 106, 238]);
    expect(pixel(field, 7, 8)).toEqual([170, 0, 85, 11, 85]);
    expect(paintStroke(base, blend(undefined, { color: "#ff00ff", finish: 0 }), input)).toEqual(field);
    expect(pixel(base, 8, 7)).toEqual([0, 0, 255, 128, 255]);
  });

  it("excludes invalid and border samples but keeps valid blank skin and soft write masks", () => {
    const valid = new Uint8Array(256);
    valid[3 * 16 + 3] = 255;
    valid[3 * 16 + 4] = 128;
    valid[3 * 16 + 2] = 255;
    const input = value(createPaintMasks({ ...masks(), valid }));
    const base = blank(16);
    put(base, 3, 3, [200, 40, 80, 255], 150);
    put(base, 2, 3, [1, 2, 3, 255], 255);
    put(base, 3, 4, [0, 255, 0, 255], 255);
    const field = paintStroke(base, blend([[[4 / 16, 3.5 / 16]]]), input);
    expect(pixel(field, 3, 3)).toEqual([200, 40, 80, 223, 150]);
    expect(pixel(field, 4, 3)).toEqual([200, 40, 80, 17, 150]);
    expect(pixel(field, 2, 3)).toEqual([1, 2, 3, 255, 255]);
    expect(pixel(field, 3, 4)).toEqual([0, 255, 0, 255, 255]);
    expect(pixel(field, 5, 3)).toEqual([0, 0, 0, 0, 0]);
    put(base, 4, 3, [200, 40, 80, 255], 150);
    expect(beginStroke(base, input).finish(blend([[[4 / 16, 3.5 / 16]]])).kind).toBe("unchanged");
  });

  it("leaves blank and zero-strength fields unchanged but admits exact finish-only changes", () => {
    const input = masks();
    const empty = composePaint([], input);
    expect(beginStroke(empty, input).finish(blend()).kind).toBe("unchanged");
    expect(paintStroke(empty, blend(), input)).toEqual(empty);
    const base = composePaint([dot()], input);
    expect(beginStroke(base, input).finish(blend(undefined, { opacity: 0 })).kind).toBe("unchanged");
    expect(paintStroke(base, blend(undefined, { opacity: 0 }), input)).toEqual(base);
    const opaque = blank(16);
    for (let y = 3; y < 13; y += 1) for (let x = 3; x < 13; x += 1) put(opaque, x, y, [204, 80, 117, 255]);
    opaque.finish[7 * 16 + 7] = 255;
    const field = changed(beginStroke(opaque, input).finish(blend()));
    expect(field.rgba).toEqual(opaque.rgba);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 255, 197]);
    expect(pixel(field, 8, 7)).toEqual([204, 80, 117, 255, 7]);
    expect(strokeChanges(base, blend(), input)).toBe(true);
  });

  it("builds more effect through travel at intermediate strength, not while stationary", () => {
    const input = masks();
    const base = composePaint([dot()], input);
    const transaction = beginStroke(base, input);
    const initial = blend();
    const preview = transaction.update(initial)!;
    expect(pixel(preview, 7, 7)).toEqual([204, 80, 117, 197, 102]);
    const duplicate = blend([[[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]]);
    expect(transaction.update(duplicate)).toBeNull();
    expect(pixel(preview, 7, 7)).toEqual([204, 80, 117, 197, 102]);
    const path: UV[] = [[0.5, 0.5], [0.55, 0.5], [0.5, 0.5], [0.55, 0.5], [0.5, 0.5]];
    const onePass = paintStroke(base, blend([path.slice(0, 2)]), input);
    const repeated = paintStroke(base, blend([path]), input);
    expect(pixel(onePass, 7, 7)).toEqual([204, 80, 117, 197, 102]);
    expect(pixel(repeated, 7, 7)).toEqual([204, 80, 117, 99, 102]);
    expect(pixel(repeated, 7, 7)[3]!).toBeLessThan(pixel(onePass, 7, 7)[3]!);
    expect(pixel(base, 7, 7)).toEqual([204, 80, 117, 255, 102]);
  });

  it("carries distance across short segments with no endpoint or frame dabs", () => {
    const input = masks();
    const base = composePaint([dot()], input);
    const transaction = beginStroke(base, input);
    const preview = transaction.update(blend())!;
    const short = blend([[[0.5, 0.5], [0.51, 0.5]]]);
    expect(transaction.update(short)).toBeNull();
    expect(pixel(changed(transaction.finish(short)), 7, 7)).toEqual([204, 80, 117, 197, 102]);
    const path: UV[] = [[0.5, 0.5], [0.51, 0.5], [0.52, 0.5], [0.53, 0.5], [0.54, 0.5], [0.55, 0.5]];
    const split = paintStroke(base, blend([path]), input);
    const direct = paintStroke(base, blend([[[0.5, 0.5], [0.55, 0.5]]]), input);
    expect(split).toEqual(direct);
    expect(pixel(split, 8, 7)).toEqual([204, 80, 117, 13, 102]);
    expect(preview).toBe(changed(transaction.finish(short)));
  });

  it("is deterministic across every frame partition and overlapping path arrival order", () => {
    const input = masks();
    const base = composePaint([dot()], input);
    const left: UV[] = [[0.5, 0.5], [0.51, 0.5], [0.55, 0.5], [0.5, 0.5]];
    const right: UV[] = [[0.5, 0.5], [0.49, 0.5], [0.45, 0.5], [0.5, 0.5]];
    const snapshots = [
      blend([left.slice(0, 1)]), blend([left.slice(0, 2), right.slice(0, 1)]),
      blend([left.slice(0, 2), right.slice(0, 3)]), blend([left, right.slice(0, 3)]), blend([left, right]),
    ];
    const expected = paintStroke(base, snapshots.at(-1)!, input);
    expect(pixel(expected, 7, 7)).toEqual([204, 80, 117, 81, 102]);
    for (let partition = 0; partition < 2 ** snapshots.length; partition += 1) {
      const transaction = beginStroke(base, input);
      for (const [index, snapshot] of snapshots.entries()) {
        if ((partition & 2 ** index) === 0) continue;
        const preview = transaction.update(snapshot);
        if (preview !== null) expect(preview).toEqual(paintStroke(base, snapshot, input));
        expect(transaction.update(snapshot)).toBeNull();
      }
      expect(changed(transaction.finish(snapshots.at(-1)!))).toEqual(expected);
    }
    const otherOrder = beginStroke(base, input);
    otherOrder.update(blend([right]));
    otherOrder.update(blend([right, left.slice(0, 2)]));
    expect(changed(otherOrder.finish(blend([right, left])))).toEqual(expected);
    expect(composePaint([dot(), blend([left, right])], input)).toEqual(expected);
  });

  it("does not connect separate paths across a missed hit", () => {
    const input = masks(64);
    const base = blank(64);
    for (const x of [16, 32, 48]) put(base, x, 32, [204, 80, 117, 255], 102);
    const field = paintStroke(base, blend([[[16.5 / 64, 32.5 / 64]], [[48.5 / 64, 32.5 / 64]]], { radius: 0.04 }), input);
    expect(pixel(field, 16, 32)).toEqual([204, 80, 117, 219, 102]);
    expect(pixel(field, 48, 32)).toEqual([204, 80, 117, 219, 102]);
    expect(pixel(field, 32, 32)).toEqual([204, 80, 117, 255, 102]);
    expect(pixel(field, 31, 32)).toEqual([0, 0, 0, 0, 0]);
  });

  it("discards preview ownership without touching committed pixels and restores exact Undo bytes", () => {
    const input = masks();
    const old = value(decodeLook({ ...newLook(), strokes: [dot()] }));
    const base = composePaint(old.strokes, input);
    const before = { size: base.size, rgba: base.rgba.slice(), finish: base.finish.slice() };
    const discarded = beginStroke(base, input);
    const preview = discarded.update(blend())!;
    expect(pixel(preview, 7, 7)).toEqual([204, 80, 117, 197, 102]);
    expect(base).toEqual(before);
    const accepted = beginStroke(base, input).finish(blend());
    expect(pixel(changed(accepted), 7, 7)).toEqual([204, 80, 117, 197, 102]);
    let session = step(createSession(old), { type: "stroke", stroke: accepted.stroke });
    expect(presentSession(session).look.version).toBe(2);
    session = step(session, { type: "undo" });
    expect(presentSession(session).look.version).toBe(2);
    expect(composePaint(presentSession(session).look.strokes, input)).toEqual(before);
    session = step(session, { type: "redo" });
    expect(composePaint(presentSession(session).look.strokes, input)).toEqual(changed(accepted));
    expect(base).toEqual(before);
  });
});

class MemoryStorage implements StoragePort {
  raw: string | null = null;
  getItem(): string | null { return this.raw; }
  setItem(_key: string, raw: string): void { this.raw = raw; }
}

const thumbnail = "data:image/png;base64,iVBORw0KGgo=";

describe("current Blend persistence", () => {
  it("saves and restores the actual softening instructions", () => {
    const storage = new MemoryStorage();
    const look = value(appendStroke(value(appendStroke(newLook(), dot())), blend()));
    value(saveLook(storage, { look, title: "Softened", savedAt: 2, thumbnail }));
    expect(value(readLookbook(storage))[0]!.look).toEqual(look);
    expect(pixel(composePaint(value(readLookbook(storage))[0]!.look.strokes, masks()), 7, 7)).toEqual([204, 80, 117, 197, 102]);
  });

  it.each(["compressed", "plain"])("round trips old and new instructions through %s share links", async (format) => {
    if (format === "plain") vi.stubGlobal("CompressionStream", undefined);
    const seeded = value(appendStroke(newLook(), dot()));
    const mixed = value(appendStroke(seeded, blend()));
    for (const look of [mixed]) {
      const fragment = value(await encodeShare(look));
      expect(fragment.slice(0, 14)).toBe(format === "plain" ? "#make1up=v1.j." : "#make1up=v1.d.");
      const decoded: Look = value(await decodeShare(fragment));
      expect(encodeLook(decoded)).toBe(encodeLook(look));
      expect(lookFingerprint(decoded)).toBe(lookFingerprint(look));
      expect(pixel(composePaint(decoded.strokes, masks()), 7, 7)).toEqual([204, 80, 117, 197, 102]);
    }
  });
});

const graphics = vi.hoisted(() => ({ textures: [] as import("three").DataTexture[] }));
vi.mock("../src/picking", () => ({ indexPortrait: () => Object.assign(() => {}, { refit() {} }) }));
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  return {
    ...three,
    DataTexture: class extends three.DataTexture {
      constructor(...args: ConstructorParameters<typeof three.DataTexture>) {
        super(...args);
        graphics.textures.push(this);
      }
    },
    TextureLoader: class { async loadAsync() { return new three.Texture(); } },
    PMREMGenerator: class {
      fromScene() { return { texture: new three.Texture(), dispose() {} }; }
      dispose() {}
    },
    WebGLRenderer: class {
      capabilities = { getMaxAnisotropy: () => 1 };
      extensions = { has: () => false };
      ratio = 1;
      setClearColor() {}
      setPixelRatio(ratio: number) { this.ratio = ratio; }
      getPixelRatio() { return this.ratio; }
      setSize() {}
      compile() {}
      render() {}
      dispose() {}
    },
    Raycaster: class {
      uv = new three.Vector2();
      setFromCamera(pointer: import("three").Vector2) { this.uv.set((pointer.x + 1) / 2, (1 - pointer.y) / 2); }
      intersectObjects(meshes: import("three").Mesh[], _recursive: boolean, hits: import("three").Intersection[]) {
        const face = meshes.find((mesh) => mesh.name === "Face");
        if (face !== undefined) hits.push({ object: face, uv1: this.uv.clone(), point: new three.Vector3(), distance: 1 });
        return hits;
      }
    },
  };
});
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const three = await import("three");
  return { GLTFLoader: class {
    async loadAsync() {
      const scene = new three.Group();
      for (const name of ["Face", "Bust", "Eye.L", "Eye.R", "Hair", "HairSweep", "HairTail", "HairTie", "HairBun", "BunBand", "Brows", "Lashes"]) {
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("uv1", new three.Float32BufferAttribute([0, 0], 2));
        const mesh = new three.Mesh(geometry, new three.MeshStandardMaterial({ map: new three.Texture() }));
        mesh.name = name;
        scene.add(mesh);
      }
      return { scene };
    }
  } };
});
vi.mock("three/addons/environments/RoomEnvironment.js", async () => {
  const { Group } = await import("three");
  return { RoomEnvironment: class extends Group { dispose() {} } };
});

class PointerCanvas extends EventTarget {
  style = { cursor: "", touchAction: "" };
  captured = new Set<number>();
  getBoundingClientRect() { return { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }; }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  setPointerCapture(id: number) { this.captured.add(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  pointer(type: string, x = 500) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, button: 0, isPrimary: true, pointerType: "mouse", clientX: x, clientY: 500,
    }));
  }
}

function displayed(): PaintField {
  const [pigment, finish] = graphics.textures;
  const rgba = pigment!.image.data as Uint8Array;
  return { size: 1024, rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), finish: finish!.image.data as Uint8Array };
}

function expectPixels(actual: PaintField, expected: PaintField): void {
  expect(actual.size).toBe(expected.size);
  expect(actual.rgba.findIndex((byte, index) => byte !== expected.rgba[index])).toBe(-1);
  expect(actual.finish.findIndex((byte, index) => byte !== expected.finish[index])).toBe(-1);
}

describe("tagged pointer Blend without a browser", () => {
  let frame: FrameRequestCallback | null;
  beforeEach(() => {
    frame = null;
    graphics.textures.length = 0;
    const pixels = new Uint8ClampedArray(1024 * 1024 * 4).fill(255);
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      hidden: false,
      createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }),
    }));
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: true }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("fetch", async () => ({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1024, height: 1024, close() {} }));
  });

  function tick(): void {
    if (frame === null) throw new Error("No pending frame.");
    frame(16);
  }

  it("uses the same tag in preview and finish, cancels exactly, adopts the candidate, and restores Undo", async () => {
    const input = masks(1024);
    const seed = value(captureStroke("seed", {
      ...defaultBrush("liner"), radius: 0.003, color: "#cc5075", softness: 0, opacity: 1, finish: 0.4,
    }, [[[0.5, 0.5]]]));
    const old = value(decodeLook({ ...newLook(), strokes: [seed] }));
    const base = composePaint(old.strokes, input);
    const brush = defaultBrush("blend");
    let session: Session = step(createSession(old), { type: "brush", brush });
    const offers: Stroke[] = [];
    const errors: string[] = [];
    const canvas = new PointerCanvas();
    const portrait = await mountPortrait(canvas as unknown as HTMLCanvasElement, (stroke) => {
      offers.push(stroke);
      dispatch({ type: "stroke", stroke });
    }, (error) => errors.push(error));
    mounted.push(portrait);
    function dispatch(action: Action): void {
      session = step(session, action);
      portrait.present(presentSession(session));
    }
    portrait.present(presentSession(session));
    canvas.pointer("pointerdown");
    tick();
    const expectedPreview = paintStroke(base, value(captureStroke("expected", brush, [[[0.5, 0.5]]])), input);
    expectPixels(displayed(), expectedPreview);
    expect(pixel(displayed(), 511, 511)[3]!).toBeLessThan(255);
    canvas.pointer("pointercancel");
    expectPixels(displayed(), base);
    expect(offers).toEqual([]);
    canvas.pointer("pointerdown");
    tick();
    const previewBuffer = displayed().rgba.buffer;
    canvas.pointer("pointermove", 510);
    canvas.pointer("pointerup", 510);
    expect(offers.map((stroke) => stroke.algorithm)).toEqual(["soften-v1"]);
    expect(presentSession(session).look.version).toBe(2);
    expect(displayed().rgba.buffer).toBe(previewBuffer);
    const final = composePaint([seed, offers[0]!], input);
    expectPixels(displayed(), final);
    dispatch({ type: "undo" });
    expectPixels(displayed(), base);
    expect(presentSession(session).look.version).toBe(2);
    dispatch({ type: "brush", brush: { ...brush, opacity: 0 } });
    canvas.pointer("pointerdown");
    canvas.pointer("pointerup", 510);
    expect(offers).toHaveLength(1);
    expect(errors).toEqual(["Blend existing makeup changed no makeup on the paintable face."]);
    expectPixels(displayed(), base);
    dispatch({ type: "redo" });
    expectPixels(displayed(), final);
    expect(presentSession(session).look.strokes.at(-1)!.algorithm).toBe("soften-v1");
  });
});
