import { describe, expect, it } from "vitest";
import { appendStroke, captureStroke, defaultBrush, defaultIdentity, newLook, withIdentity } from "../src/look";
import type { Brush, Result, Stroke, ToolId, UV } from "../src/look";
import { analyzePaint, assess, composePaint, createPaintMasks, paintStroke, strokeChanges } from "../src/paint";
import type { PaintField, PaintMasks } from "../src/paint";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function masks(size = 16): PaintMasks {
  const valid = new Uint8Array(size * size).fill(255);
  const lips = new Uint8Array(size * size);
  const cheeks = new Uint8Array(size * size);
  const lids = new Uint8Array(size * size);
  for (let y = 7; y <= 8; y += 1) {
    for (let x = 7; x <= 8; x += 1) lips[y * size + x] = 255;
    for (let x = 4; x <= 5; x += 1) cheeks[y * size + x] = 255;
  }
  for (let y = 4; y <= 5; y += 1) {
    for (let x = 7; x <= 8; x += 1) lids[y * size + x] = 255;
  }
  return value(createPaintMasks({ size, valid, lips, cheeks, lids }));
}

function stroke(id: string, tool: ToolId, changes: Partial<Brush> = {}, point: UV = [0.5, 0.5]): Stroke {
  return value(captureStroke(id, {
    ...defaultBrush(tool), radius: 0.08, softness: 0, opacity: 1, ...changes,
  }, [[point]]));
}

function pixel(field: PaintField, x: number, y: number): number[] {
  return Array.from(field.rgba.slice((y * field.size + x) * 4, (y * field.size + x) * 4 + 4));
}

describe("final makeup field", () => {
  it("uses explicit masks, honors the reserved border, and leaves inputs unchanged", () => {
    const input = masks();
    const mark = stroke("lip", "lipstick", { finish: 1 });
    const field = composePaint([mark], input);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 255]);
    expect(pixel(field, 6, 7)).toEqual([0, 0, 0, 0]);
    expect(field.finish[7 * 16 + 7]).toBe(255);
    expect(analyzePaint(field, input)).toEqual({
      alphaMass: 4,
      coverage: { valid: 0.04, lips: 1, cheeks: 0, lids: 0 },
      paletteMass: { rose: 1, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 1,
    });
    const edge = composePaint([stroke("edge", "liner", {}, [0.1, 0.1])], input);
    expect(pixel(edge, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(input.valid[1 * 16 + 1]).toBe(255);
    expect(mark.paths).toEqual([[[32768 / 65535, 32768 / 65535]]]);
  });

  it("allows new blush and eyeshadow across the face but keeps lipstick on lips", () => {
    const input = masks();
    const fullBlush = composePaint([stroke("full", "blush")], input);
    expect(pixel(fullBlush, 7, 7)).toEqual([204, 80, 117, 255]);
    const fullShadow = composePaint([stroke("full", "shadow")], input);
    expect(pixel(fullShadow, 7, 7)).toEqual([167, 100, 203, 255]);
    const cheekShadow = composePaint([stroke("cheek", "shadow", {}, [5 / 16, 0.5])], input);
    expect(pixel(cheekShadow, 4, 7)).toEqual([167, 100, 203, 255]);
    const cheek = composePaint([stroke("cheek", "blush", {}, [5 / 16, 0.5])], input);
    expect(pixel(cheek, 4, 7)).toEqual([204, 80, 117, 255]);
    const lid = composePaint([stroke("lid", "shadow", {}, [0.5, 5 / 16])], input);
    expect(pixel(lid, 7, 4)).toEqual([167, 100, 203, 255]);
    const wrongLip = composePaint([stroke("wrong", "lipstick", {}, [5 / 16, 0.5])], input);
    expect(analyzePaint(wrongLip, input).alphaMass).toBe(0);
    const lined = composePaint([stroke("ink", "liner", {}, [5 / 16, 0.5])], input);
    expect(pixel(lined, 4, 7)).toEqual([23, 20, 36, 255]);
  });

  it("multiplies soft mask samples and rejects malformed mask arrays", () => {
    const valid = new Uint8Array(256);
    const lips = new Uint8Array(256);
    valid[7 * 16 + 7] = 128;
    lips[7 * 16 + 7] = 64;
    const input = value(createPaintMasks({ size: 16, valid, lips, cheeks: new Uint8Array(256), lids: new Uint8Array(256) }));
    valid.fill(0);
    const field = composePaint([stroke("soft", "lipstick")], input);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 32]);
    expect(createPaintMasks({ ...input, lips: new Uint8Array(255) })).toEqual({ ok: false, error: "Every paint mask must have exactly size squared samples." });
    expect(createPaintMasks({ ...input, size: 15 })).toEqual({ ok: false, error: "Paint masks need an integer size between 16 and 1024." });
  });

  it("composites pigment and independent finish with source-over alpha", () => {
    const input = masks();
    const first = composePaint([stroke("base", "liner", { color: "#cc5075", finish: 0 })], input);
    const next = paintStroke(first, stroke("top", "liner", { color: "#a764cb", opacity: 0.5, finish: 1 }), input);
    expect(pixel(next, 7, 7)).toEqual([186, 90, 160, 255]);
    expect(next.finish[7 * 16 + 7]).toBe(128);
    expect(pixel(first, 7, 7)).toEqual([204, 80, 117, 255]);
    expect(first.finish[7 * 16 + 7]).toBe(0);
  });

  it("erases only makeup and scores the erased final field as zero", () => {
    const input = masks();
    const paint = stroke("color", "lipstick");
    const erase = stroke("remove", "erase");
    const painted = composePaint([paint], input);
    expect(pixel(painted, 7, 7)).toEqual([204, 80, 117, 255]);
    const removed = composePaint([paint, erase], input);
    expect(pixel(removed, 7, 7)).toEqual([0, 0, 0, 0]);
    expect(removed.finish[7 * 16 + 7]).toBe(0);
    const final = analyzePaint(removed, input);
    expect(final).toEqual({
      alphaMass: 0,
      coverage: { valid: 0, lips: 0, cheeks: 0, lids: 0 },
      paletteMass: { rose: 0, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 0,
    });
    expect(assess("rose-editorial", final).total).toBe(0);
    expect(assess("graphic-night", final).total).toBe(0);
    expect(assess("orchid-hour", final).total).toBe(0);
    expect(assess("rose-editorial", analyzePaint(painted, input)).total).toBe(45);
  });

  it("replays untagged historical Blend without painting its saved color", () => {
    const input = masks();
    const dot = stroke("dot", "liner", { color: "#cc5075", radius: 0.04, finish: 0.4 }, [7.5 / 16, 7.5 / 16]);
    const initial = composePaint([dot], input);
    expect(pixel(initial, 7, 7)).toEqual([204, 80, 117, 255]);
    expect(pixel(initial, 8, 7)).toEqual([0, 0, 0, 0]);
    const blended = paintStroke(initial, stroke("blend", "blend", { color: "#00ff00", opacity: 0.5 }), input);
    expect(pixel(blended, 7, 7)).toEqual([204, 80, 117, 197]);
    expect(pixel(blended, 8, 7)).toEqual([204, 80, 117, 7]);
    expect(pixel(blended, 8, 8)).toEqual([204, 80, 117, 7]);
    expect(blended.finish[8 * 16 + 8]).toBe(102);
    const emptyBlend = composePaint([stroke("empty-blend", "blend")], input);
    expect(analyzePaint(emptyBlend, input).alphaMass).toBe(0);
  });

  it("does not connect independent mirrored paths across the face", () => {
    const input = masks(32);
    const mirrored = value(captureStroke("mirror", { ...defaultBrush("liner"), radius: 0.04, opacity: 1, softness: 0 }, [
      [[0.25, 0.5]], [[0.75, 0.5]],
    ]));
    const field = composePaint([mirrored], input);
    expect(pixel(field, 7, 15)).toEqual([23, 20, 36, 255]);
    expect(pixel(field, 23, 15)).toEqual([23, 20, 36, 255]);
    expect(pixel(field, 15, 15)).toEqual([0, 0, 0, 0]);
  });

  it("interpolates a continuous liner path but leaves separate sparkle stamps", () => {
    const input = masks(64);
    const brush = { ...defaultBrush("liner"), radius: 0.02, softness: 0, opacity: 1 };
    const line = value(captureStroke("line", brush, [[[0.25, 0.5], [0.75, 0.5]]]));
    const stamps = value(captureStroke("stamps", { ...brush, tool: "sparkle", radius: 0.08 }, [[[0.25, 0.5], [0.75, 0.5]]]));
    expect(pixel(composePaint([line], input), 31, 31)).toEqual([23, 20, 36, 255]);
    expect(pixel(composePaint([stamps], input), 31, 31)).toEqual([0, 0, 0, 0]);
    expect(pixel(composePaint([stamps], input), 15, 31)).toEqual([23, 20, 36, 255]);
  });

  it("does not increase opacity when one gesture repeats a sample", () => {
    const input = masks();
    const brush = { ...defaultBrush("liner"), radius: 0.08, softness: 0, opacity: 0.5 };
    const repeated = value(captureStroke("repeated", brush, [[[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]]));
    const field = composePaint([repeated], input);
    expect(pixel(field, 7, 7)).toEqual([23, 20, 36, 128]);
    const doubled = paintStroke(field, stroke("second-gesture", "liner", { opacity: 0.5 }), input);
    expect(pixel(doubled, 7, 7)).toEqual([23, 20, 36, 192]);
  });

  it("assigns unsupported custom hues to other rather than inventing palette mass", () => {
    const input = masks();
    const field = composePaint([stroke("green", "liner", { color: "#00ff00" })], input);
    expect(analyzePaint(field, input).paletteMass).toEqual({
      rose: 0, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 1,
    });
  });
});

describe("final field analysis", () => {
  it("weights soft regions, counts blank mask area, and ignores invalid or border paint", () => {
    const input = {
      size: 16, valid: new Uint8Array(256), lips: new Uint8Array(256),
      cheeks: new Uint8Array(256), lids: new Uint8Array(256),
    };
    const field = { size: 16, rgba: new Uint8ClampedArray(1024), finish: new Uint8Array(256) };
    const samples = [
      [3, 3, 255, 128, 0, 255, [204, 80, 117, 128], 64],
      [4, 3, 128, 255, 64, 0, [167, 100, 203, 64], 192],
      [5, 3, 64, 64, 255, 128, [0, 255, 0, 255], 255],
      [6, 3, 255, 255, 255, 255, [242, 233, 223, 0], 255],
      [7, 3, 0, 255, 255, 255, [81, 40, 78, 255], 255],
      [3, 2, 255, 255, 255, 255, [23, 20, 36, 255], 255],
    ] as const;
    for (const [x, y, valid, lips, cheeks, lids, rgba, finish] of samples) {
      const index = y * 16 + x;
      input.valid[index] = valid;
      input.lips[index] = lips;
      input.cheeks[index] = cheeks;
      input.lids[index] = lids;
      field.rgba.set(rgba, index * 4);
      field.finish[index] = finish;
    }
    expect(analyzePaint(field, value(createPaintMasks(input)))).toEqual({
      alphaMass: 0.8789234909650134,
      coverage: {
        valid: 0.31926708005139376, lips: 0.21333174604355618,
        cheeks: 0.20523394096908562, lids: 0.29536609713401135,
      },
      paletteMass: {
        rose: 0.5711086226203808, orchid: 0.1433370660694289, plum: 0, ink: 0,
        gold: 0, pearl: 0, coral: 0, other: 0.2855543113101904,
      },
      glossShare: 0.5368157565377775,
    });
  });

  it("retains the exact accumulated numbers on a dense fractional-alpha field", () => {
    const input = value(createPaintMasks({
      size: 16, valid: new Uint8Array(256).fill(255), lips: new Uint8Array(256).fill(128),
      cheeks: new Uint8Array(256).fill(64), lids: new Uint8Array(256).fill(192),
    }));
    const field = { size: 16, rgba: new Uint8ClampedArray(1024), finish: new Uint8Array(256).fill(192) };
    for (let index = 0; index < 256; index += 1) field.rgba.set([204, 80, 117, 128], index * 4);
    expect(analyzePaint(field, input)).toEqual({
      alphaMass: 50.19607843137243,
      coverage: {
        valid: 0.5019607843137243, lips: 0.5019607843137278,
        cheeks: 0.5019607843137278, lids: 0.5019607843137265,
      },
      paletteMass: { rose: 1, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 0.7529411764705903,
    });
  });

  it("uses a strict palette distance and the first registered color on a tie", () => {
    const valid = new Uint8Array(256);
    const field = { size: 16, rgba: new Uint8ClampedArray(1024), finish: new Uint8Array(256) };
    const colors = [[23, 115, 36], [23, 116, 36], [23, 117, 36], [52, 30, 57], [229, 184, 93]];
    for (const [offset, color] of colors.entries()) {
      const index = 3 * 16 + 3 + offset;
      valid[index] = 255;
      field.rgba.set([...color, 255], index * 4);
    }
    const input = value(createPaintMasks({
      size: 16, valid, lips: new Uint8Array(256), cheeks: new Uint8Array(256), lids: new Uint8Array(256),
    }));
    expect(analyzePaint(field, input)).toEqual({
      alphaMass: 5,
      coverage: { valid: 1, lips: 0, cheeks: 0, lids: 0 },
      paletteMass: { rose: 0, orchid: 0, plum: 0.2, ink: 0.2, gold: 0.2, pearl: 0, coral: 0, other: 0.4 },
      glossShare: 0,
    });
  });

  it("reads current field and mask bytes on each call without modifying them", () => {
    const valid = new Uint8Array(256);
    const index = 7 * 16 + 7;
    valid[index] = 255;
    valid[index + 1] = 255;
    const input = value(createPaintMasks({
      size: 16, valid, lips: valid, cheeks: new Uint8Array(256), lids: new Uint8Array(256),
    }));
    const field = { size: 16, rgba: new Uint8ClampedArray(1024), finish: new Uint8Array(256) };
    field.rgba.set([23, 20, 36, 255], index * 4);
    field.finish[index] = 255;
    const fieldBefore = { size: 16, rgba: field.rgba.slice(), finish: field.finish.slice() };
    const masksBefore = {
      size: 16, valid: input.valid.slice(), lips: input.lips.slice(),
      cheeks: input.cheeks.slice(), lids: input.lids.slice(),
    };
    const first = analyzePaint(field, input);
    expect(first).toEqual({
      alphaMass: 1,
      coverage: { valid: 0.5, lips: 0.5, cheeks: 0, lids: 0 },
      paletteMass: { rose: 0, orchid: 0, plum: 0, ink: 1, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 1,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.coverage)).toBe(true);
    expect(Object.isFrozen(first.paletteMass)).toBe(true);
    expect(field).toEqual(fieldBefore);
    expect(input).toEqual(masksBefore);
    field.finish[index] = 0;
    input.valid[index + 1] = 0;
    expect(analyzePaint(field, input)).toEqual({
      alphaMass: 1,
      coverage: { valid: 1, lips: 1, cheeks: 0, lids: 0 },
      paletteMass: { rose: 0, orchid: 0, plum: 0, ink: 1, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 0,
    });
    field.rgba[index * 4 + 3] = 0;
    expect(analyzePaint(field, input)).toEqual({
      alphaMass: 0,
      coverage: { valid: 0, lips: 0, cheeks: 0, lids: 0 },
      paletteMass: { rose: 0, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 },
      glossShare: 0,
    });
  });
});

describe("exact stroke effect", () => {
  it.each([
    ["zero-opacity blush", "blush", { opacity: 0 }],
    ["zero opacity pigment", "lipstick", { opacity: 0 }],
    ["erase on blank", "erase", {}],
    ["blend on blank", "blend", {}],
  ] as const)("rejects %s while a visible cheek stroke still changes paint", (_label, tool, brush) => {
    const input = masks();
    const blank = composePaint([], input);
    expect(strokeChanges(blank, stroke("no-effect", tool, brush), input)).toBe(false);
    expect(strokeChanges(blank, stroke("visible", "blush", {}, [5 / 16, 0.5]), input)).toBe(true);
  });

  it("rejects an identical saturated hard repaint, including a guided path", () => {
    const input = masks();
    const paint = stroke("paint", "lipstick", { finish: 0.8 });
    const field = composePaint([paint], input);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 255]);
    expect(strokeChanges(field, stroke("repeat", "lipstick", { finish: 0.8 }), input)).toBe(false);
    const guided = value(captureStroke("guided", paint.brush, [[[0.4375, 0.5], [0.5, 0.5], [0.5625, 0.5]]]));
    expect(strokeChanges(composePaint([guided], input), guided, input)).toBe(false);
  });

  it("accepts color changes even when coverage stays equal", () => {
    const input = masks();
    const field = composePaint([stroke("rose", "lipstick")], input);
    const plum = stroke("plum", "lipstick", { color: "#51284e" });
    expect(strokeChanges(field, plum, input)).toBe(true);
    const changed = paintStroke(field, plum, input);
    expect(pixel(changed, 7, 7)).toEqual([81, 40, 78, 255]);
    expect(analyzePaint(changed, input).coverage).toEqual(analyzePaint(field, input).coverage);
  });

  it("accepts spatial redistribution even when analysis summaries stay identical", () => {
    const all = new Uint8Array(256).fill(255);
    const input = value(createPaintMasks({ size: 16, valid: all, lips: all, cheeks: all, lids: all }));
    const rgba = new Uint8ClampedArray(256 * 4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        rgba.set([23, 20, 36, (x + y) % 2 === 0 ? 4 : 252], (y * 16 + x) * 4);
      }
    }
    const field = Object.freeze({ size: 16, rgba, finish: new Uint8Array(256) });
    const blend = stroke("redistribute", "blend");
    const changed = paintStroke(field, blend, input);
    expect(pixel(field, 7, 7)).toEqual([23, 20, 36, 4]);
    expect(pixel(field, 8, 7)).toEqual([23, 20, 36, 252]);
    expect(pixel(changed, 7, 7)[3]).toBeGreaterThan(4);
    expect(pixel(changed, 8, 7)[3]).toBeLessThan(252);
    expect(strokeChanges(field, blend, input)).toBe(true);
  });

  it("accepts finish-only changes when all RGBA bytes stay equal", () => {
    const input = masks();
    const matte = composePaint([stroke("matte", "lipstick", { finish: 0 })], input);
    const gloss = stroke("gloss", "lipstick", { finish: 1 });
    expect(strokeChanges(matte, gloss, input)).toBe(true);
    const changed = paintStroke(matte, gloss, input);
    expect(changed.rgba).toEqual(matte.rgba);
    expect(matte.finish[7 * 16 + 7]).toBe(0);
    expect(changed.finish[7 * 16 + 7]).toBe(255);
  });

  it("keeps repeated soft-edge buildup and correction over existing paint", () => {
    const input = masks();
    const soft = stroke("soft", "lipstick", { softness: 0.9, opacity: 1 });
    const field = composePaint([soft], input);
    expect(strokeChanges(field, soft, input)).toBe(true);
    expect(pixel(field, 7, 7)).toEqual([204, 80, 117, 127]);
    expect(pixel(paintStroke(field, soft, input), 7, 7)).toEqual([204, 80, 117, 191]);
    expect(strokeChanges(field, stroke("erase", "erase"), input)).toBe(true);
    expect(strokeChanges(field, stroke("blend", "blend"), input)).toBe(true);
  });

  it("leaves the field, masks, and submitted stroke unchanged", () => {
    const input = masks();
    const field = composePaint([stroke("base", "lipstick")], input);
    const mark = stroke("blend", "blend");
    const fieldBefore = { size: field.size, rgba: field.rgba.slice(), finish: field.finish.slice() };
    const masksBefore = {
      size: input.size, valid: input.valid.slice(), lips: input.lips.slice(),
      cheeks: input.cheeks.slice(), lids: input.lids.slice(),
    };
    const strokeBefore = JSON.stringify(mark);
    expect(strokeChanges(field, mark, input)).toBe(true);
    expect(field).toEqual(fieldBefore);
    expect(input).toEqual(masksBefore);
    expect(JSON.stringify(mark)).toBe(strokeBefore);
  });
});

describe("published solo briefs", () => {
  it("awards each brief from actual composited coverage, palette mass, and finish", () => {
    const input = masks();
    const rose = composePaint([
      stroke("cheek", "blush", { opacity: 0.5, finish: 0.4 }, [5 / 16, 0.5]),
      stroke("lip", "lipstick", { opacity: 0.5, finish: 0.4 }),
    ], input);
    const orchid = composePaint([
      stroke("eye", "shadow", { opacity: 0.5, finish: 0.3 }, [0.5, 5 / 16]),
      stroke("lip", "lipstick", { color: "#a764cb", opacity: 0.5, finish: 0.3 }),
    ], input);
    const graphic = composePaint([
      stroke("eye", "liner", { opacity: 0.5, finish: 0 }, [0.5, 5 / 16]),
    ], input);
    expect(assess("rose-editorial", analyzePaint(rose, input)).total).toBe(100);
    expect(assess("orchid-hour", analyzePaint(orchid, input)).total).toBe(100);
    expect(assess("graphic-night", analyzePaint(graphic, input))).toMatchObject({
      label: "Solo brief match", theme: "graphic-night", rulesVersion: 1, total: 100, outOf: 100,
      evidence: [
        { id: "lids", earned: 35, possible: 35, reason: "50% measured. Meets the published target." },
        { id: "palette", earned: 35, possible: 35 },
        { id: "placement", earned: 15, possible: 15 },
        { id: "finish", earned: 15, possible: 15 },
      ],
    });
  });

  it("never gives blank makeup matte-finish points", () => {
    const input = masks();
    const blank = analyzePaint(composePaint([], input), input);
    expect(assess("graphic-night", blank)).toMatchObject({
      total: 0,
      evidence: [
        { earned: 0 }, { earned: 0 }, { earned: 0 },
        { earned: 0, reason: "Not enough visible makeup. The brief requires paint on at least 0.5% of the paintable face." },
      ],
    });
    const mark = composePaint([stroke("visible", "liner", { opacity: 0.5 }, [0.5, 5 / 16])], input);
    expect(assess("graphic-night", analyzePaint(mark, input)).total).toBe(100);
  });

  it("ignores complexion, eyes, and hair for a fixed final makeup field", () => {
    const input = masks();
    const base = value(appendStroke(newLook(), stroke("lip", "lipstick")));
    const changed = withIdentity(base, { ...defaultIdentity, complexion: "deep", eyes: "olive", hairColor: "plum", hairStyle: "bun" });
    const first = assess("rose-editorial", analyzePaint(composePaint(base.strokes, input), input));
    const second = assess("rose-editorial", analyzePaint(composePaint(changed.strokes, input), input));
    expect(first.total).toBe(45);
    expect(second).toEqual(first);
  });
});
