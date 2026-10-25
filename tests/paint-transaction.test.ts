import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendStroke, captureStroke, defaultBrush, encodeLook, limits, newLook, tools, withIdentity } from "../src/look";
import type { Brush, Look, Result, Stroke, ToolId, UV } from "../src/look";
import { analyzePaint, beginStroke, composePaint, createPaintMasks, paintStroke } from "../src/paint";
import type { ChangedPaint, FinishedPaint, PaintField, PaintMasks } from "../src/paint";
import { paintStroke as baselinePaint } from "../benchmarks/analysis-baseline/paint";
import { mountPortrait } from "../src/portrait";
import type { Portrait } from "../src/portrait";
import { createSession, presentSession, step } from "../src/session";
import type { Action, Session } from "../src/session";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function allMasks(size = 16): PaintMasks {
  const all = new Uint8Array(size * size).fill(255);
  return value(createPaintMasks({ size, valid: all, lips: all, cheeks: all, lids: all }));
}

function softMasks(size: number): PaintMasks {
  const levels = [0, 16, 64, 128, 192, 255];
  const channel = (salt: number) => Uint8Array.from({ length: size * size }, (_, index) =>
    levels[(index * salt + Math.floor(index / size)) % levels.length] ?? 0);
  return value(createPaintMasks({ size, valid: channel(1), lips: channel(3), cheeks: channel(5), lids: channel(7) }));
}

function mark(id: string, tool: ToolId = "liner", changes: Partial<Brush> = {}, paths: readonly (readonly UV[])[] = [[[0.5, 0.5]]]): Stroke {
  const stroke = value(captureStroke(id, {
    ...defaultBrush(tool), radius: 0.08, opacity: 1, softness: 0, ...changes,
  }, paths));
  return stroke;
}

function frozenPaint(base: PaintField, stroke: Stroke, masks: PaintMasks): PaintField {
  return stroke.algorithm === "soften-v1" ? paintStroke(base, stroke, masks)
    : baselinePaint(base, stroke, { ...masks, cheeks: new Uint8Array(masks.valid.length).fill(255), lids: new Uint8Array(masks.valid.length).fill(255) });
}

function frozenCompose(strokes: readonly Stroke[], masks: PaintMasks): PaintField {
  return strokes.reduce<PaintField>((field, stroke) => frozenPaint(field, stroke, masks), {
    size: masks.size, rgba: new Uint8ClampedArray(masks.size * masks.size * 4), finish: new Uint8Array(masks.size * masks.size),
  });
}

function pixel(field: PaintField, x: number, y: number): number[] {
  return Array.from(field.rgba.slice((y * field.size + x) * 4, (y * field.size + x) * 4 + 4));
}

function fieldsDiffer(a: PaintField, b: PaintField): boolean {
  return a.rgba.some((byte, index) => byte !== b.rgba[index])
    || a.finish.some((byte, index) => byte !== b.finish[index]);
}

function expectField(actual: PaintField, expected: PaintField): void {
  expect(actual.size).toBe(expected.size);
  expect(actual.rgba.length).toBe(expected.rgba.length);
  expect(actual.finish.length).toBe(expected.finish.length);
  expect(actual.rgba.findIndex((byte, index) => byte !== expected.rgba[index])).toBe(-1);
  expect(actual.finish.findIndex((byte, index) => byte !== expected.finish[index])).toBe(-1);
}

function changed(result: FinishedPaint): ChangedPaint {
  expect(result.kind).toBe("changed");
  if (result.kind !== "changed") throw new Error("Expected an effective stroke.");
  return result;
}

function seedField(size: number): PaintField {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const finish = new Uint8Array(size * size);
  for (let index = 0; index < finish.length; index += 1) {
    rgba.set([index * 73 % 256, index * 31 % 256, index * 17 % 256, index * 43 % 256], index * 4);
    finish[index] = index * 97 % 256;
  }
  return Object.freeze({ size, rgba, finish });
}

function expectFinished(result: FinishedPaint, base: PaintField, stroke: Stroke, expected: PaintField): void {
  const effective = fieldsDiffer(expected, base);
  expect(result.kind).toBe(effective ? "changed" : "unchanged");
  expect(result.stroke).toBe(stroke);
  if (result.kind === "changed") {
    expect(result.base).toBe(base);
    expectField(result.field, expected);
  } else {
    expect("field" in result).toBe(false);
  }
}

const mirroredSnapshots: readonly (readonly (readonly UV[])[])[] = [
  [[[0.249999, 0.34]]],
  [[[0.249999, 0.34]], [[0.750001, 0.34]]],
  [[[0.249999, 0.34], [0.27, 0.42]], [[0.750001, 0.34], [0.73, 0.42]]],
  [[[0.249999, 0.34], [0.27, 0.42]], [[0.750001, 0.34], [0.73, 0.42], [0.69, 0.5]], [[0.18, 0.62]]],
  [[[0.249999, 0.34], [0.27, 0.42]], [[0.750001, 0.34], [0.73, 0.42], [0.69, 0.5]], [[0.18, 0.62], [0.2, 0.64]], [[0.82, 0.62]]],
  [[[0.249999, 0.34], [0.27, 0.42], [0.27, 0.42]], [[0.750001, 0.34], [0.73, 0.42], [0.69, 0.5]], [[0.18, 0.62], [0.2, 0.64]], [[0.82, 0.62], [0.8, 0.64]]],
];

const toolIds = Object.keys(tools) as ToolId[];

describe("incremental paint transaction", () => {
  it.each(toolIds)("matches every frozen prefix and all update partitions for %s", (tool) => {
    const input = softMasks(48);
    const base = seedField(input.size);
    const before = { size: base.size, rgba: base.rgba.slice(), finish: base.finish.slice() };
    const maskBefore = [input.valid.slice(), input.lips.slice(), input.cheeks.slice(), input.lids.slice()];
    const snapshots = mirroredSnapshots.map((paths) => mark("mirror", tool, {
      radius: 0.073, opacity: 0.63, softness: 0.71, finish: 0.37,
    }, paths));
    const expected = snapshots.map((stroke) => frozenPaint(base, stroke, input));
    const final = snapshots.at(-1)!;
    for (let partition = 0; partition < 2 ** snapshots.length; partition += 1) {
      const transaction = beginStroke(base, input);
      let displayed = base;
      let previousExpected = base;
      for (const [index, snapshot] of snapshots.entries()) {
        if ((partition & 2 ** index) === 0) continue;
        const preview = transaction.update(snapshot);
        expect(preview !== null).toBe(fieldsDiffer(expected[index]!, previousExpected));
        if (preview !== null) {
          if (displayed !== base) expect(preview === displayed).toBe(true);
          displayed = preview;
        }
        previousExpected = expected[index]!;
        expectField(displayed, expected[index]!);
        expect(transaction.update(mark("mirror", tool, snapshot.brush, snapshot.paths))).toBeNull();
        expectField(displayed, expected[index]!);
      }
      expectFinished(transaction.finish(final), base, final, expected.at(-1)!);
    }
    expectField(paintStroke(base, final, input), expected.at(-1)!);
    expectField(composePaint(snapshots, input), frozenCompose(snapshots, input));
    expectField(base, before);
    expect([input.valid, input.lips, input.cheeks, input.lids]).toEqual(maskBefore);
  });

  it.each(toolIds)("keeps frozen arithmetic at hard, soft, small, and quantized boundaries for %s", (tool) => {
    const input = softMasks(32);
    const base = seedField(32);
    const paths: UV[][] = [[], [[1, 1]]];
    for (const radius of [limits.radiusMin, 0.028, limits.radiusMax]) {
      for (const softness of [0, 0.5, 1]) {
        for (const opacity of [0, 0.01, 0.5, 1]) {
          const transaction = beginStroke(base, input);
          let displayed = base;
          let previousExpected = base;
          paths[0] = [];
          for (const point of [[0, 0], [3 / 32, 3 / 32], [(16.5 - 0.0001) / 32, 0.5], [(16.5 + 0.0001) / 32, 0.5], [1, 1]] as const) {
            paths[0]!.push(point);
            const snapshot = mark("boundary", tool, { radius, softness, opacity }, paths);
            const expected = frozenPaint(base, snapshot, input);
            const preview = transaction.update(snapshot);
            expect(preview !== null).toBe(fieldsDiffer(expected, previousExpected));
            if (preview !== null) displayed = preview;
            previousExpected = expected;
            expectField(displayed, expected);
            if (point[0] === 1) expectFinished(transaction.finish(snapshot), base, snapshot, expected);
          }
        }
      }
    }
  });

  it("retains the literal source-over pigment and finish bytes", () => {
    const input = allMasks();
    const base = frozenCompose([mark("matte", "liner", { color: "#cc5075", finish: 0 })], input);
    const top = mark("gloss", "liner", { color: "#a764cb", opacity: 0.5, finish: 1 });
    const result = changed(beginStroke(base, input).finish(top));
    expect(pixel(result.field, 7, 7)).toEqual([186, 90, 160, 255]);
    expect(result.field.finish[7 * 16 + 7]).toBe(128);
    expect(pixel(base, 7, 7)).toEqual([204, 80, 117, 255]);
    expect(base.finish[7 * 16 + 7]).toBe(0);
  });

  it("retains literal soft-mask multiplication, border, and capture quantization", () => {
    const valid = new Uint8Array(256);
    const lips = new Uint8Array(256);
    valid[7 * 16 + 7] = 128;
    lips[7 * 16 + 7] = 64;
    const input = value(createPaintMasks({ size: 16, valid, lips, cheeks: lips, lids: lips }));
    const stroke = mark("soft", "lipstick");
    const result = changed(beginStroke(frozenCompose([], input), input).finish(stroke));
    expect(pixel(result.field, 7, 7)).toEqual([204, 80, 117, 32]);
    expect(pixel(result.field, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(stroke.paths).toEqual([[[32768 / 65535, 32768 / 65535]]]);
  });

  it("does not bridge mirrored gaps and interpolates lines but not stamps", () => {
    const input = allMasks(64);
    const base = frozenCompose([], input);
    const paths: UV[][] = [[[0.25, 0.5]], [[0.75, 0.5]]];
    const line = beginStroke(base, input);
    line.update(mark("line", "liner", { radius: 0.02 }, paths));
    paths[0]!.push([0.25, 0.55]);
    paths.push([[0.25, 0.75]]);
    const final = mark("line", "liner", { radius: 0.02 }, paths);
    const field = changed(line.finish(final)).field;
    expectField(field, frozenPaint(base, final, input));
    expect(pixel(field, 15, 31)).toEqual([23, 20, 36, 255]);
    expect(pixel(field, 47, 31)).toEqual([23, 20, 36, 255]);
    expect(pixel(field, 31, 31)).toEqual([0, 0, 0, 0]);
    expect(pixel(field, 15, 41)).toEqual([0, 0, 0, 0]);
    const connected: UV[][] = [[[0.25, 0.5], [0.75, 0.5]]];
    const drawn = changed(beginStroke(base, input).finish(mark("draw", "liner", { radius: 0.02 }, connected))).field;
    const stamped = changed(beginStroke(base, input).finish(mark("stamp", "sparkle", {}, connected))).field;
    expect(pixel(drawn, 31, 31)).toEqual([23, 20, 36, 255]);
    expect(pixel(stamped, 31, 31)).toEqual([0, 0, 0, 0]);
    expect(pixel(stamped, 15, 31)).toEqual([242, 233, 223, 255]);
  });

  it("drains final unrendered segments into the same borrowed output", () => {
    const input = allMasks(32);
    const base = frozenCompose([], input);
    const transaction = beginStroke(base, input);
    const preview = transaction.update(mark("drain", "liner", { radius: 0.04 }, [[[0.25, 0.5]]]))!;
    expect(pixel(preview, 23, 15)).toEqual([0, 0, 0, 0]);
    const final = mark("drain", "liner", { radius: 0.04 }, [[[0.25, 0.5], [0.75, 0.5]]]);
    const result = changed(transaction.finish(final));
    expect(result.field).toBe(preview);
    expect(pixel(result.field, 23, 15)).toEqual([23, 20, 36, 255]);
    expectField(result.field, frozenPaint(base, final, input));
    expect(transaction.finish(final)).toBe(result);
    expect(() => transaction.update(final)).toThrow();
    expect(() => transaction.finish(mark("other"))).toThrow();
    expect(pixel(result.field, 23, 15)).toEqual([23, 20, 36, 255]);
  });

  it("replaces shorter, edited, reordered, and different-brush snapshots from the base", () => {
    const input = allMasks(32);
    const base = seedField(32);
    const transaction = beginStroke(base, input);
    const snapshots = [
      mark("replace", "liner", {}, [[[0.25, 0.5], [0.75, 0.5]], [[0.5, 0.25]]]),
      mark("replace", "liner", {}, [[[0.25, 0.5]], [[0.5, 0.25]]]),
      mark("replace", "liner", {}, [[[0.3, 0.5]], [[0.5, 0.25]]]),
      mark("replace", "liner", {}, [[[0.5, 0.25]], [[0.3, 0.5]]]),
      ...([
        { color: "#cc5075" }, { radius: 0.04 }, { opacity: 0.37 }, { softness: 0.7 }, { finish: 1 },
      ] as const).map((brush) => mark("replace", "liner", brush, [[[0.5, 0.25]], [[0.3, 0.5]]])),
      mark("replace", "erase", { opacity: 0.37 }, [[[0.5, 0.25]], [[0.3, 0.5]]]),
      mark("new-id", "blend", { softness: 0.7 }, [[[0.5, 0.25]], [[0.3, 0.5]]]),
    ];
    let output: PaintField | null = null;
    for (const snapshot of snapshots) {
      const preview = transaction.update(snapshot)!;
      if (output !== null) expect(preview).toBe(output);
      output = preview;
      expectField(preview, frozenPaint(base, snapshot, input));
    }
    expectFinished(transaction.finish(snapshots.at(-1)!), base, snapshots.at(-1)!, frozenPaint(base, snapshots.at(-1)!, input));
  });

  it("publishes a replacement that restores no-effect bytes and clears the effect count", () => {
    const input = allMasks();
    const base = frozenCompose([], input);
    const transaction = beginStroke(base, input);
    const preview = transaction.update(mark("replace"))!;
    expect(pixel(preview, 7, 7)).toEqual([23, 20, 36, 255]);
    const invisible = mark("replace", "liner", { opacity: 0 });
    const restored = transaction.update(invisible);
    expect(restored).toBe(preview);
    expectField(restored!, base);
    expect(pixel(restored!, 7, 7)).toEqual([0, 0, 0, 0]);
    expect(transaction.update(invisible)).toBeNull();
    expect(transaction.finish(invisible)).toEqual({ kind: "unchanged", stroke: invisible });
    expectField(base, frozenCompose([], input));
  });

  it("finishes a replacement with no effect even when its last preview changed paint", () => {
    const input = allMasks();
    const base = frozenCompose([], input);
    const transaction = beginStroke(base, input);
    const preview = transaction.update(mark("final"))!;
    expect(pixel(preview, 7, 7)).toEqual([23, 20, 36, 255]);
    const final = mark("final", "erase");
    expect(transaction.finish(final)).toEqual({ kind: "unchanged", stroke: final });
    expect(pixel(preview, 7, 7)).toEqual([0, 0, 0, 0]);
    expectField(base, frozenCompose([], input));
  });

  it("counts finish-only effects and exact spatial changes rather than analysis totals", () => {
    const input = allMasks();
    const matte = frozenCompose([mark("matte", "lipstick", { finish: 0 })], input);
    const gloss = mark("gloss", "lipstick", { finish: 1 });
    const field = changed(beginStroke(matte, input).finish(gloss)).field;
    expect(field.rgba).toEqual(matte.rgba);
    expect(field.finish[7 * 16 + 7]).toBe(255);
    expect(matte.finish[7 * 16 + 7]).toBe(0);
    const checker = { size: 16, rgba: new Uint8ClampedArray(1024), finish: new Uint8Array(256) };
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) checker.rgba.set([23, 20, 36, (x + y) % 2 === 0 ? 4 : 252], (y * 16 + x) * 4);
    }
    const redistributed = changed(beginStroke(checker, input).finish(mark("redistribute", "blend"))).field;
    expect(fieldsDiffer(redistributed, checker)).toBe(true);
    expect(pixel(redistributed, 7, 7)[3]).toBeGreaterThan(4);
    expect(pixel(redistributed, 8, 7)[3]).toBeLessThan(252);
  });

  it("rejects blank corrections, zero opacity, masked paint, and saturated repaint", () => {
    const all = allMasks();
    const zero = new Uint8Array(256);
    const regional = value(createPaintMasks({ ...all, lips: zero, cheeks: zero, lids: zero }));
    const base = frozenCompose([], all);
    for (const stroke of [mark("erase", "erase"), mark("blend", "blend"), mark("zero", "liner", { opacity: 0 }), mark("masked", "lipstick")]) {
      expect(beginStroke(base, regional).finish(stroke)).toEqual({ kind: "unchanged", stroke });
    }
    const paint = mark("paint", "liner");
    const painted = changed(beginStroke(base, all).finish(paint)).field;
    expect(pixel(painted, 7, 7)).toEqual([23, 20, 36, 255]);
    expect(beginStroke(painted, all).finish(paint)).toEqual({ kind: "unchanged", stroke: paint });
  });

  it("keeps inputs, finished fields, and independent one-shot results separately owned", () => {
    const input = allMasks();
    const base = seedField(16);
    const before = { size: 16, rgba: base.rgba.slice(), finish: base.finish.slice() };
    const maskBefore = [input.valid.slice(), input.lips.slice(), input.cheeks.slice(), input.lids.slice()];
    const stroke = mark("owned", "blend");
    const json = encodeLook(value(appendStroke(newLook(), stroke)));
    const first = changed(beginStroke(base, input).finish(stroke)).field;
    const second = changed(beginStroke(base, input).finish(stroke)).field;
    const oneShot = paintStroke(base, stroke, input);
    const replay = composePaint([stroke], input);
    const expected = frozenPaint(base, stroke, input);
    expectField(first, expected);
    expectField(second, expected);
    first.rgba.fill(0);
    first.finish.fill(0);
    oneShot.rgba.fill(0);
    replay.finish.fill(255);
    expectField(second, expected);
    expectField(base, before);
    expect([input.valid, input.lips, input.cheeks, input.lids]).toEqual(maskBefore);
    expect(encodeLook(value(appendStroke(newLook(), stroke)))).toBe(json);
    expect(pixel(changed(beginStroke(frozenCompose([], input), input).finish(mark("literal"))).field, 7, 7)).toEqual([23, 20, 36, 255]);
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

class TestCanvas extends EventTarget {
  style = { cursor: "", touchAction: "" };
  captured = new Set<number>();
  width = 1000;
  getBoundingClientRect() { return { left: 0, top: 0, right: this.width, bottom: 1000, width: this.width, height: 1000 }; }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  setPointerCapture(id: number) { this.captured.add(id); }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
    this.pointer("lostpointercapture", 0, 0, { pointerId: id });
  }
  pointer(type: string, x = 250, y = 500, extra: object = {}) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, button: 0, isPrimary: true, pointerType: "mouse", clientX: x, clientY: y, ...extra,
    }));
  }
}

function displayedField(): PaintField {
  const [pigment, finish] = graphics.textures;
  const rgba = pigment!.image.data as Uint8Array;
  return {
    size: 1024,
    rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    finish: finish!.image.data as Uint8Array,
  };
}

describe("portrait transaction admission without a browser", () => {
  let frame: FrameRequestCallback | null;
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget;
  let portraits: Portrait[];
  let input: PaintMasks;

  beforeEach(() => {
    frame = null;
    portraits = [];
    graphics.textures.length = 0;
    input = allMasks(1024);
    const pixels = new Uint8ClampedArray(1024 * 1024 * 4).fill(255);
    documentTarget = Object.assign(new EventTarget(), {
      hidden: false,
      createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }),
    });
    windowTarget = new EventTarget();
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: true }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("fetch", async () => ({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1024, height: 1024, close() {} }));
  });

  afterEach(() => {
    for (const portrait of portraits) portrait.dispose();
    vi.unstubAllGlobals();
  });

  function tick(): void {
    const callback = frame;
    if (callback === null) throw new Error("No pending animation frame.");
    callback(16);
  }

  async function studio(look: Look = newLook()) {
    const canvas = new TestCanvas();
    const errors: string[] = [];
    const offers: Stroke[] = [];
    let session: Session = step(createSession(look), {
      type: "brush", brush: { ...defaultBrush("liner"), radius: 0.01, softness: 0, opacity: 0.5 },
    });
    let onOffer = (stroke: Stroke) => dispatch({ type: "stroke", stroke });
    const portrait = await mountPortrait(canvas as unknown as HTMLCanvasElement, (stroke) => {
      offers.push(stroke);
      onOffer(stroke);
    }, (message) => {
      errors.push(message);
      dispatch({ type: "inputRejected", message });
    });
    portraits.push(portrait);
    function dispatch(action: Action): void {
      session = step(session, action);
      portrait.present(presentSession(session));
    }
    portrait.present(presentSession(session));
    return {
      canvas, portrait, errors, offers, dispatch,
      get session() { return session; },
      onOffer(callback: (stroke: Stroke) => void) { onOffer = callback; },
    };
  }

  it("adopts the preview once, drains pointer-up without RAF, and preserves Undo and Redo bytes", async () => {
    const app = await studio();
    app.canvas.pointer("pointerdown");
    tick();
    const previewBuffer = displayedField().rgba.buffer;
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    app.canvas.pointer("pointermove", 500, 500);
    app.canvas.pointer("pointerup", 750, 500);
    expect(app.offers).toHaveLength(1);
    const final = app.offers[0]!;
    expect(final.paths).toEqual([[[16384 / 65535, 32768 / 65535], [32768 / 65535, 32768 / 65535], [49151 / 65535, 32768 / 65535]]]);
    expect(displayedField().rgba.buffer === previewBuffer).toBe(true);
    const expected = frozenCompose([final], input);
    expectField(displayedField(), expected);
    expect(pixel(displayedField(), 767, 511)).toEqual([23, 20, 36, 128]);
    expect(app.canvas.hasPointerCapture(1)).toBe(false);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expect(app.session.history.current.strokes).toEqual([final]);
    expect(app.session.history.past).toHaveLength(1);
    app.portrait.present(presentSession(app.session));
    expectField(displayedField(), expected);
    app.dispatch({ type: "undo" });
    expect(pixel(displayedField(), 255, 511)).toEqual([0, 0, 0, 0]);
    app.dispatch({ type: "redo" });
    expectField(displayedField(), expected);
  });

  it("commits a gesture that finishes before its first animation frame", async () => {
    const app = await studio();
    app.canvas.pointer("pointerdown");
    app.canvas.pointer("pointerup", 750, 500);
    expect(app.offers).toHaveLength(1);
    expectField(displayedField(), frozenCompose(app.offers, input));
    expect(pixel(displayedField(), 511, 511)).toEqual([23, 20, 36, 128]);
    expect(app.portrait.analyze()).toEqual(analyzePaint(frozenCompose(app.offers, input), input));
  });

  it("keeps Guided apply admission, no-effect notices, and the redo branch", async () => {
    const app = await studio();
    const paint = mark("guided", "lipstick", { radius: 0.01 });
    expect(app.portrait.applyStroke(paint)).toBe(true);
    expect(pixel(displayedField(), 511, 511)).toEqual([204, 80, 117, 255]);
    expect(app.portrait.applyStroke(mark("saturated", "lipstick", paint.brush))).toBe(false);
    expect(app.errors.at(-1)).toBe("Lipstick changed no makeup on the lips.");
    app.dispatch({ type: "undo" });
    expect(app.portrait.applyStroke(mark("empty", "blend"))).toBe(false);
    expect(app.errors.at(-1)).toBe("Blend existing makeup changed no makeup on the paintable face.");
    expect(app.offers).toEqual([paint]);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expect(app.session.history.future).toHaveLength(1);
    app.dispatch({ type: "redo" });
    expectField(displayedField(), frozenCompose([paint], input));
  });

  it("uses the current tool region in no-effect notices", async () => {
    const app = await studio();
    expect(app.portrait.applyStroke(mark("invisible", "blush", { opacity: 0 }))).toBe(false);
    expect(app.errors.at(-1)).toBe("Blush changed no makeup on the paintable face.");
    expect(presentSession(app.session).look.version).toBe(2);
    expect(app.offers).toEqual([]);
  });

  it("Guided apply replaces a pointer draft instead of adopting its unrelated coverage", async () => {
    const app = await studio();
    app.canvas.pointer("pointerdown");
    tick();
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    const guided = mark("guided", "lipstick", { radius: 0.01 });
    expect(app.portrait.applyStroke(guided)).toBe(true);
    expect(pixel(displayedField(), 255, 511)).toEqual([0, 0, 0, 0]);
    expect(pixel(displayedField(), 511, 511)).toEqual([204, 80, 117, 255]);
    expectField(displayedField(), frozenCompose([guided], input));
    app.canvas.pointer("pointerup", 750, 500);
    expect(app.offers).toEqual([guided]);
  });

  it("zero-opacity pointer and Guided apply restore the base and preserve Redo", async () => {
    const app = await studio();
    const paint = mark("visible", "lipstick", { radius: 0.01 });
    expect(app.portrait.applyStroke(paint)).toBe(true);
    app.dispatch({ type: "undo" });
    app.dispatch({ type: "brush", brush: { ...defaultBrush("liner"), opacity: 0 } });
    app.canvas.pointer("pointerdown");
    app.canvas.pointer("pointerup", 750, 500);
    expect(app.errors.at(-1)).toBe("Liner changed no makeup on the paintable face.");
    app.dispatch({ type: "brush", brush: { ...defaultBrush("liner"), radius: 0.01, softness: 0, opacity: 0.5 } });
    app.canvas.pointer("pointerdown");
    tick();
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    expect(app.portrait.applyStroke(mark("invisible", "lipstick", { opacity: 0 }))).toBe(false);
    expect(app.errors.at(-1)).toBe("Lipstick changed no makeup on the lips.");
    app.canvas.pointer("pointerup", 750, 500);
    expectField(displayedField(), frozenCompose([], input));
    expect(app.offers).toEqual([paint]);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expect(app.session.history.future).toHaveLength(1);
    app.dispatch({ type: "redo" });
    expectField(displayedField(), frozenCompose([paint], input));
    expect(pixel(displayedField(), 511, 511)).toEqual([204, 80, 117, 255]);
  });

  it("does not retain a rejected candidate for a later presentation", async () => {
    const app = await studio();
    app.onOffer(() => {});
    app.canvas.pointer("pointerdown");
    tick();
    const previewBuffer = displayedField().rgba.buffer;
    app.canvas.pointer("pointerup");
    expect(pixel(displayedField(), 255, 511)).toEqual([0, 0, 0, 0]);
    expect(app.portrait.analyze().alphaMass).toBe(0);
    app.dispatch({ type: "stroke", stroke: app.offers[0]! });
    expect(displayedField().rgba.buffer === previewBuffer).toBe(false);
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    expectField(displayedField(), frozenCompose(app.offers, input));
  });

  it("does not adopt a same-ID different Stroke or a changed prefix", async () => {
    const first = mark("first", "liner", { radius: 0.01 }, [[[0.4, 0.5]]]);
    const app = await studio(value(appendStroke(newLook(), first)));
    app.onOffer((offered) => {
      const other = mark(offered.id, "liner", { ...offered.brush, color: "#cc5075" }, offered.paths);
      app.dispatch({ type: "stroke", stroke: other });
    });
    app.canvas.pointer("pointerdown");
    tick();
    const buffer = displayedField().rgba.buffer;
    app.canvas.pointer("pointerup");
    expect(displayedField().rgba.buffer === buffer).toBe(false);
    expect(pixel(displayedField(), 255, 511)).toEqual([204, 80, 117, 128]);
    const changedFirst = mark("first", "liner", { ...first.brush, color: "#a764cb" }, first.paths);
    app.onOffer((offered) => {
      const current = presentSession(app.session).look;
      const replaced = Object.freeze({ ...current, strokes: Object.freeze([changedFirst, ...current.strokes.slice(1)]) });
      app.dispatch({ type: "load", look: value(appendStroke(replaced, offered)) });
    });
    app.canvas.pointer("pointerdown", 650, 500);
    tick();
    const nextBuffer = displayedField().rgba.buffer;
    app.canvas.pointer("pointerup", 650, 500);
    expect(displayedField().rgba.buffer === nextBuffer).toBe(false);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expectField(displayedField(), frozenCompose(app.session.history.current.strokes, input));
    expect(pixel(displayedField(), 409, 511)).toEqual([167, 100, 203, 255]);
  });

  it.each(["look", "field", "suffix"] as const)("rejects a candidate when its %s no longer matches exactly", async (mismatch) => {
    const app = await studio();
    const before = presentSession(app.session);
    app.onOffer((offered) => {
      if (mismatch === "look") {
        app.dispatch({ type: "identity", identity: { ...before.look.identity, eyes: "hazel" } });
        app.dispatch({ type: "stroke", stroke: offered });
      } else if (mismatch === "field") {
        app.portrait.present({ ...before, look: value(appendStroke(before.look, mark("temporary"))) });
        app.portrait.present(before);
        app.dispatch({ type: "stroke", stroke: offered });
      } else {
        const extra = mark("extra", "liner", { radius: 0.01 }, [[[0.6, 0.5]]]);
        app.dispatch({ type: "load", look: value(appendStroke(value(appendStroke(before.look, extra)), offered)) });
      }
    });
    app.canvas.pointer("pointerdown");
    tick();
    const buffer = displayedField().rgba.buffer;
    app.canvas.pointer("pointerup");
    expect(displayedField().rgba.buffer === buffer).toBe(false);
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expectField(displayedField(), frozenCompose(app.session.history.current.strokes, input));
  });

  it("rejects reducer duplicate and document-limit edits without changing committed paint", async () => {
    const existing = mark("duplicate", "liner", { radius: 0.01 }, [[[0.4, 0.5]]]);
    const app = await studio(value(appendStroke(newLook(), existing)));
    const recolor = mark("duplicate", "liner", { color: "#cc5075", radius: 0.01 });
    expect(app.portrait.applyStroke(recolor)).toBe(false);
    expectField(displayedField(), frozenCompose([existing], input));
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expect(app.session.history.current.strokes).toEqual([existing]);
    expect(app.session.notice).toBe("That gesture was already applied.");
    let full: Look = newLook();
    for (let index = 0; index < limits.strokes; index += 1) full = value(appendStroke(full, mark(`limit-${index}`, "liner", { opacity: 0 })));
    app.dispatch({ type: "load", look: full });
    expect(app.portrait.applyStroke(mark("too-many"))).toBe(false);
    expect(app.portrait.analyze().alphaMass).toBe(0);
    expect(pixel(displayedField(), 511, 511)).toEqual([0, 0, 0, 0]);
    if (app.session.phase !== "editing") throw new Error("Expected editing.");
    expect(app.session.history.current).toBe(full);
    expect(app.session.notice).toBe("This look has reached its gesture limit. Clear some makeup or start a new look.");
  });

  it("clears the synchronous offer after a callback throws", async () => {
    const app = await studio();
    const offered = mark("throws", "liner", { opacity: 0.5, radius: 0.01 });
    app.canvas.pointer("pointerdown", 500, 500);
    tick();
    const previewBuffer = displayedField().rgba.buffer;
    app.onOffer(() => { throw new Error("reducer failed"); });
    expect(() => app.portrait.applyStroke(offered)).toThrow("reducer failed");
    expect(app.portrait.analyze().alphaMass).toBe(0);
    app.dispatch({ type: "stroke", stroke: offered });
    expect(displayedField().rgba.buffer === previewBuffer).toBe(false);
    expect(pixel(displayedField(), 511, 511)).toEqual([23, 20, 36, 128]);
    expectField(displayedField(), frozenCompose([offered], input));
  });

  it.each(["pointercancel", "lostpointercapture", "tool", "frame", "readonly", "navigation", "look", "resize", "zoom", "blur", "hidden", "context", "dispose"] as const)("discards a draft on %s and never emits it", async (reason) => {
    const app = await studio();
    const before = presentSession(app.session);
    app.canvas.pointer("pointerdown");
    tick();
    expect(pixel(displayedField(), 255, 511)).toEqual([23, 20, 36, 128]);
    expect(app.portrait.analyze().alphaMass).toBe(0);
    if (reason === "pointercancel" || reason === "lostpointercapture") app.canvas.pointer(reason);
    else if (reason === "tool") app.dispatch({ type: "brush", brush: defaultBrush("lipstick") });
    else if (reason === "frame") app.dispatch({ type: "frame", framing: "eyes" });
    else if (reason === "readonly") app.portrait.present({ ...before, readonly: true });
    else if (reason === "navigation") app.dispatch({ type: "navigate", navigation: "turn" });
    else if (reason === "look") app.dispatch({ type: "load", look: withIdentity(before.look, { ...before.look.identity, eyes: "hazel" }) });
    else if (reason === "resize") { app.canvas.width = 1100; windowTarget.dispatchEvent(new Event("resize")); }
    else if (reason === "zoom") app.portrait.zoom("in");
    else if (reason === "blur") windowTarget.dispatchEvent(new Event("blur"));
    else if (reason === "hidden") { documentTarget.hidden = true; documentTarget.dispatchEvent(new Event("visibilitychange")); }
    else if (reason === "context") app.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    else app.portrait.dispose();
    app.canvas.pointer("pointerup", 750, 500);
    expectField(displayedField(), frozenCompose([], input));
    expect(app.canvas.hasPointerCapture(1)).toBe(false);
    expect(app.offers).toEqual([]);
    if (reason === "look") await vi.waitFor(() => expect(app.portrait.availability.kind).toBe("ready"));
    if (reason === "context" || reason === "dispose") expect(() => app.portrait.analyze()).toThrow();
    else expect(app.portrait.analyze().alphaMass).toBe(0);
    if (["readonly", "navigation", "context", "dispose"].includes(reason)) {
      expect(app.portrait.applyStroke(mark("blocked"))).toBe(false);
      expect(pixel(displayedField(), 511, 511)).toEqual([0, 0, 0, 0]);
    }
  });
});
