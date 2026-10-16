import { palette, themes, tools } from "./look";
import type { Criterion, PaletteId, Region, Result, Stroke, StrokePath, Theme, ThemeId } from "./look";

export type PaintMasks = Readonly<{
  size: number;
  valid: Uint8Array;
  lips: Uint8Array;
  cheeks: Uint8Array;
  lids: Uint8Array;
}>;
export type PaintField = Readonly<{
  size: number;
  rgba: Uint8ClampedArray;
  finish: Uint8Array;
}>;
export type ChangedPaint = Readonly<{
  kind: "changed";
  stroke: Stroke;
  base: PaintField;
  field: PaintField;
}>;
export type FinishedPaint = ChangedPaint | Readonly<{ kind: "unchanged"; stroke: Stroke }>;
export interface StrokeTransaction {
  /** The preview is borrowed until finish transfers its ownership. */
  update(stroke: Stroke): PaintField | null;
  finish(stroke: Stroke): FinishedPaint;
}
export type PaintAnalysis = Readonly<{
  alphaMass: number;
  coverage: Readonly<Record<Region, number>>;
  paletteMass: Readonly<Record<PaletteId | "other", number>>;
  glossShare: number;
}>;
export type CriterionEvidence = Readonly<{
  id: string;
  label: string;
  measured: number;
  target: string;
  earned: number;
  possible: number;
  reason: string;
}>;
export type Critique = Readonly<{
  label: "Solo brief match";
  theme: ThemeId;
  rulesVersion: 1;
  total: number;
  outOf: 100;
  evidence: readonly CriterionEvidence[];
}>;

const border = 3;
const paletteColors = Object.keys(palette)
  .filter((id): id is PaletteId => Object.hasOwn(palette, id))
  .map((id) => ({ id, rgb: colorBytes(palette[id].color) }));

export function createPaintMasks(input: PaintMasks): Result<PaintMasks> {
  const { size } = input;
  if (!Number.isInteger(size) || size < 16 || size > 1024) {
    return { ok: false, error: "Paint masks need an integer size between 16 and 1024." };
  }
  for (const mask of [input.valid, input.lips, input.cheeks, input.lids]) {
    if (!(mask instanceof Uint8Array) || mask.length !== size * size) {
      return { ok: false, error: "Every paint mask must have exactly size squared samples." };
    }
  }
  return { ok: true, value: Object.freeze({
    size, valid: input.valid.slice(), lips: input.lips.slice(),
    cheeks: input.cheeks.slice(), lids: input.lids.slice(),
  }) };
}

function colorBytes(color: string): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function blankField(size: number): PaintField {
  return Object.freeze({
    size,
    rgba: new Uint8ClampedArray(size * size * 4),
    finish: new Uint8Array(size * size),
  });
}

function copyField(field: PaintField): PaintField {
  return Object.freeze({ size: field.size, rgba: field.rgba.slice(), finish: field.finish.slice() });
}

type Bounds = { left: number; top: number; right: number; bottom: number };
type PaintEffect = { changed: boolean; differentPixels: number };
type SoftenScratch = {
  kind: "soften";
  pixels: Uint32Array;
  remaining: number[];
  support: number;
  spacing: number;
  horizontal: Float64Array;
  sums: Float64Array;
  row: Float64Array;
};
type RasterScratch = { kind: "coverage"; pixels: Uint8Array } | SoftenScratch;
type StrokeScratch = PaintEffect & {
  output: PaintField;
  raster: RasterScratch;
  previous: Stroke | null;
};
type TransactionState = { kind: "unstarted" }
  | { kind: "open"; scratch: StrokeScratch }
  | { kind: "finished"; result: FinishedPaint };

function emptyBounds(size: number): Bounds {
  return { left: size, top: size, right: -1, bottom: -1 };
}

function inStar(x: number, y: number): boolean {
  let inside = false;
  let previousX = 0;
  let previousY = -1;
  for (let corner = 1; corner <= 10; corner += 1) {
    const angle = -Math.PI / 2 + corner * Math.PI / 5;
    const radius = corner % 2 === 0 ? 1 : 0.42;
    const nextX = Math.cos(angle) * radius;
    const nextY = Math.sin(angle) * radius;
    if ((previousY > y) !== (nextY > y)
      && x < (nextX - previousX) * (y - previousY) / (nextY - previousY) + previousX) {
      inside = !inside;
    }
    previousX = nextX;
    previousY = nextY;
  }
  return inside;
}

function drawTip(
  coverage: Uint8Array | Uint32Array,
  bounds: Bounds,
  stroke: Stroke,
  masks: PaintMasks,
  u: number,
  v: number,
): void {
  const { size } = masks;
  const tool = tools[stroke.brush.tool];
  const radius = stroke.brush.radius * size;
  const centerX = u * size;
  const centerY = v * size;
  const left = Math.max(border, Math.floor(centerX - radius));
  const right = Math.min(size - border - 1, Math.ceil(centerX + radius));
  const top = Math.max(border, Math.floor(centerY - radius));
  const bottom = Math.min(size - border - 1, Math.ceil(centerY + radius));
  const hardRadius = 1 - stroke.brush.softness;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = (x + 0.5 - centerX) / radius;
      const dy = (y + 0.5 - centerY) / radius;
      const distance = Math.hypot(dx, dy);
      let strength: number;
      if (tool.tip === "star") {
        strength = inStar(dx, dy) ? 1 : 0;
      } else {
        strength = distance > 1 ? 0 : distance <= hardRadius ? 1 : (1 - distance) / (1 - hardRadius);
      }
      if (strength <= 0) continue;
      const index = y * size + x;
      const valid = (masks.valid[index] ?? 0) / 255;
      const region = tool.region === "valid" ? 1 : (masks[tool.region][index] ?? 0) / 255;
      const amount = Math.round(strength * valid * region * 255);
      if (stroke.algorithm === "soften-v1") {
        if (amount === 0) continue;
        coverage[index] = (coverage[index] ?? 0) + amount;
      } else {
        if (amount <= (coverage[index] ?? 0)) continue;
        coverage[index] = amount;
      }
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
}

function rasterPath(
  pixels: Uint8Array,
  bounds: Bounds,
  stroke: Stroke,
  masks: PaintMasks,
  path: StrokePath,
  start: number,
): void {
  const spacing = Math.max(0.75, stroke.brush.radius * masks.size * 0.35);
  if (start === 0) drawTip(pixels, bounds, stroke, masks, path[0][0], path[0][1]);
  for (let index = Math.max(1, start); index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const point = path[index]!;
    if (tools[stroke.brush.tool].placement === "stamp") {
      drawTip(pixels, bounds, stroke, masks, point[0], point[1]);
    } else {
      const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]) * masks.size;
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        drawTip(pixels, bounds, stroke, masks,
          previous[0] + (point[0] - previous[0]) * t,
          previous[1] + (point[1] - previous[1]) * t);
      }
    }
  }
}

function strokeCoverage(stroke: Stroke, masks: PaintMasks): Readonly<{ pixels: Uint8Array; bounds: Bounds }> {
  const pixels = new Uint8Array(masks.size * masks.size);
  const bounds = emptyBounds(masks.size);
  for (const path of stroke.paths) rasterPath(pixels, bounds, stroke, masks, path, 0);
  return { pixels, bounds };
}

function writePixel(
  field: PaintField,
  index: number,
  alpha: number,
  redPremultiplied: number,
  greenPremultiplied: number,
  bluePremultiplied: number,
  finishPremultiplied: number,
): void {
  const offset = index * 4;
  const alphaByte = Math.round(alpha * 255);
  field.rgba[offset + 3] = alphaByte;
  if (alphaByte === 0) {
    field.rgba[offset] = 0;
    field.rgba[offset + 1] = 0;
    field.rgba[offset + 2] = 0;
    field.finish[index] = 0;
    return;
  }
  field.rgba[offset] = redPremultiplied / alpha;
  field.rgba[offset + 1] = greenPremultiplied / alpha;
  field.rgba[offset + 2] = bluePremultiplied / alpha;
  field.finish[index] = Math.round(finishPremultiplied / alpha);
}

function blendPixel(field: PaintField, source: PaintField, index: number, strength: number, radius: number): void {
  const x = index % field.size;
  const y = Math.floor(index / field.size);
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let finish = 0;
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const sampleX = x + column * radius;
      const sampleY = y + row * radius;
      if (sampleX < 0 || sampleX >= field.size || sampleY < 0 || sampleY >= field.size) continue;
      const weight = (row === 0 ? 2 : 1) * (column === 0 ? 2 : 1) / 16;
      const sample = sampleY * field.size + sampleX;
      const offset = sample * 4;
      const mass = (source.rgba[offset + 3] ?? 0) / 255 * weight;
      alpha += mass;
      red += (source.rgba[offset] ?? 0) * mass;
      green += (source.rgba[offset + 1] ?? 0) * mass;
      blue += (source.rgba[offset + 2] ?? 0) * mass;
      finish += (source.finish[sample] ?? 0) * mass;
    }
  }
  const offset = index * 4;
  const remaining = (source.rgba[offset + 3] ?? 0) / 255 * (1 - strength);
  writePixel(field, index,
    alpha * strength + remaining,
    red * strength + (source.rgba[offset] ?? 0) * remaining,
    green * strength + (source.rgba[offset + 1] ?? 0) * remaining,
    blue * strength + (source.rgba[offset + 2] ?? 0) * remaining,
    finish * strength + (source.finish[index] ?? 0) * remaining);
}

function pixelDiffers(field: PaintField, source: PaintField, index: number): boolean {
  const offset = index * 4;
  return field.rgba[offset] !== source.rgba[offset]
    || field.rgba[offset + 1] !== source.rgba[offset + 1]
    || field.rgba[offset + 2] !== source.rgba[offset + 2]
    || field.rgba[offset + 3] !== source.rgba[offset + 3]
    || field.finish[index] !== source.finish[index];
}

function composite(
  field: PaintField,
  source: PaintField,
  stroke: Stroke,
  pixels: Uint8Array,
  bounds: Bounds,
  effect?: PaintEffect,
): void {
  const operation = tools[stroke.brush.tool].operation;
  const [red, green, blue] = colorBytes(stroke.brush.color);
  const blurRadius = Math.max(1, Math.min(8, Math.round(stroke.brush.radius * field.size * 0.18)));
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      const index = y * field.size + x;
      const strength = (pixels[index] ?? 0) / 255 * stroke.brush.opacity;
      if (strength === 0) continue;
      const offset = index * 4;
      const beforeRed = field.rgba[offset];
      const beforeGreen = field.rgba[offset + 1];
      const beforeBlue = field.rgba[offset + 2];
      const beforeAlpha = field.rgba[offset + 3];
      const beforeFinish = field.finish[index];
      const differentBefore = effect !== undefined && pixelDiffers(field, source, index);
      if (operation === "blend") {
        blendPixel(field, source, index, strength, blurRadius);
      } else {
        const oldAlpha = (source.rgba[offset + 3] ?? 0) / 255;
        const remaining = oldAlpha * (1 - strength);
        if (operation === "erase") {
          writePixel(field, index, remaining,
            (source.rgba[offset] ?? 0) * remaining,
            (source.rgba[offset + 1] ?? 0) * remaining,
            (source.rgba[offset + 2] ?? 0) * remaining,
            (source.finish[index] ?? 0) * remaining);
        } else {
          writePixel(field, index, strength + remaining,
            red * strength + (source.rgba[offset] ?? 0) * remaining,
            green * strength + (source.rgba[offset + 1] ?? 0) * remaining,
            blue * strength + (source.rgba[offset + 2] ?? 0) * remaining,
            stroke.brush.finish * 255 * strength + (source.finish[index] ?? 0) * remaining);
        }
      }
      if (effect !== undefined && (beforeRed !== field.rgba[offset]
        || beforeGreen !== field.rgba[offset + 1] || beforeBlue !== field.rgba[offset + 2]
        || beforeAlpha !== field.rgba[offset + 3] || beforeFinish !== field.finish[index])) {
        effect.changed = true;
        effect.differentPixels += Number(pixelDiffers(field, source, index)) - Number(differentBefore);
      }
    }
  }
}

function createSoftenScratch(stroke: Stroke, size: number): SoftenScratch {
  const radius = stroke.brush.radius * size;
  const support = Math.max(1, Math.round(radius * 0.22));
  const width = Math.ceil(radius * 2) + 2;
  return {
    kind: "soften", pixels: new Uint32Array(size * size), remaining: [], support,
    spacing: Math.max(0.75, radius * 0.35),
    horizontal: new Float64Array(width * (width + support * 2) * 6),
    sums: new Float64Array(width * 6), row: new Float64Array(6),
  };
}

function createRasterScratch(stroke: Stroke, size: number): RasterScratch {
  return stroke.algorithm === "soften-v1" ? createSoftenScratch(stroke, size)
    : { kind: "coverage", pixels: new Uint8Array(size * size) };
}

function addFilterSample(
  sum: Float64Array, source: PaintField, masks: PaintMasks, x: number, y: number, sign: number,
): void {
  const { size } = source;
  if (x < border || x >= size - border || y < border || y >= size - border) return;
  const index = y * size + x;
  if (masks.valid[index] === 0) return;
  const offset = index * 4;
  const alpha = source.rgba[offset + 3]! * sign;
  sum[0] = sum[0]! + sign;
  sum[1] = sum[1]! + alpha;
  sum[2] = sum[2]! + source.rgba[offset]! * alpha;
  sum[3] = sum[3]! + source.rgba[offset + 1]! * alpha;
  sum[4] = sum[4]! + source.rgba[offset + 2]! * alpha;
  sum[5] = sum[5]! + source.finish[index]! * alpha;
}

function compositeSoften(
  field: PaintField, source: PaintField, stroke: Stroke, masks: PaintMasks,
  bounds: Bounds, scratch: SoftenScratch, effect?: PaintEffect,
): void {
  if (bounds.right < bounds.left || stroke.brush.opacity === 0) return;
  const { support, horizontal, sums, row } = scratch;
  const width = bounds.right - bounds.left + 1;
  const stride = width * 6;
  const height = bounds.bottom - bounds.top + 1;
  const sampleTop = bounds.top - support;
  for (let y = sampleTop; y <= bounds.bottom + support; y += 1) {
    row.fill(0);
    for (let x = bounds.left - support; x <= bounds.left + support; x += 1) {
      addFilterSample(row, source, masks, x, y, 1);
    }
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      horizontal.set(row, (y - sampleTop) * stride + (x - bounds.left) * 6);
      addFilterSample(row, source, masks, x - support, y, -1);
      addFilterSample(row, source, masks, x + support + 1, y, 1);
    }
  }
  sums.fill(0, 0, stride);
  for (let y = 0; y <= support * 2; y += 1) {
    for (let channel = 0; channel < stride; channel += 1) {
      sums[channel] = sums[channel]! + horizontal[y * stride + channel]!;
    }
  }
  const travelScale = scratch.spacing / (stroke.brush.radius * field.size);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (bounds.top + y) * field.size + bounds.left + x;
      const dose = scratch.pixels[index]!;
      const channel = x * 6;
      const count = sums[channel]!;
      if (dose === 0 || count === 0) continue;
      const strength = -Math.expm1(-stroke.brush.opacity * (dose / 255) * travelScale);
      const offset = index * 4;
      const beforeRed = field.rgba[offset];
      const beforeGreen = field.rgba[offset + 1];
      const beforeBlue = field.rgba[offset + 2];
      const beforeAlpha = field.rgba[offset + 3];
      const beforeFinish = field.finish[index];
      const differentBefore = effect !== undefined && pixelDiffers(field, source, index);
      const remaining = source.rgba[offset + 3]! / 255 * (1 - strength);
      const weight = strength / (count * 255);
      writePixel(field, index,
        sums[channel + 1]! * weight + remaining,
        sums[channel + 2]! * weight + source.rgba[offset]! * remaining,
        sums[channel + 3]! * weight + source.rgba[offset + 1]! * remaining,
        sums[channel + 4]! * weight + source.rgba[offset + 2]! * remaining,
        sums[channel + 5]! * weight + source.finish[index]! * remaining);
      if (effect !== undefined && (beforeRed !== field.rgba[offset]
        || beforeGreen !== field.rgba[offset + 1] || beforeBlue !== field.rgba[offset + 2]
        || beforeAlpha !== field.rgba[offset + 3] || beforeFinish !== field.finish[index])) {
        effect.changed = true;
        effect.differentPixels += Number(pixelDiffers(field, source, index)) - Number(differentBefore);
      }
    }
    if (y + 1 < height) {
      for (let channel = 0; channel < stride; channel += 1) {
        sums[channel] = sums[channel]! - horizontal[y * stride + channel]!
          + horizontal[(y + support * 2 + 1) * stride + channel]!;
      }
    }
  }
}

function rasterSoften(
  field: PaintField, source: PaintField, stroke: Stroke, masks: PaintMasks,
  path: StrokePath, start: number, pathIndex: number, scratch: SoftenScratch, effect?: PaintEffect,
): void {
  function dab(u: number, v: number): void {
    const bounds = emptyBounds(masks.size);
    drawTip(scratch.pixels, bounds, stroke, masks, u, v);
    compositeSoften(field, source, stroke, masks, bounds, scratch, effect);
  }
  let remaining = scratch.remaining[pathIndex] ?? scratch.spacing;
  if (start === 0) dab(path[0][0], path[0][1]);
  for (let index = Math.max(1, start); index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const point = path[index]!;
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]) * masks.size;
    if (distance === 0) continue;
    let travelled = remaining;
    while (travelled <= distance) {
      const t = travelled / distance;
      dab(previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t);
      travelled += scratch.spacing;
    }
    remaining = travelled - distance;
  }
  scratch.remaining[pathIndex] = remaining;
}

function softenStroke(field: PaintField, source: PaintField, stroke: Stroke, masks: PaintMasks): void {
  const scratch = createSoftenScratch(stroke, masks.size);
  for (const [index, path] of stroke.paths.entries()) rasterSoften(field, source, stroke, masks, path, 0, index, scratch);
}

function extendsStroke(previous: Stroke, next: Stroke): boolean {
  const a = previous.brush;
  const b = next.brush;
  return previous.id === next.id && previous.algorithm === next.algorithm && a.tool === b.tool && a.color === b.color
    && a.radius === b.radius && a.opacity === b.opacity && a.softness === b.softness && a.finish === b.finish
    && previous.paths.length <= next.paths.length
    && previous.paths.every((path, index) => {
      const nextPath = next.paths[index]!;
      return path.length <= nextPath.length && path.every((point, pointIndex) => {
        const nextPoint = nextPath[pointIndex]!;
        return point[0] === nextPoint[0] && point[1] === nextPoint[1];
      });
    });
}

export function beginStroke(base: PaintField, masks: PaintMasks): StrokeTransaction {
  let state: TransactionState = { kind: "unstarted" };

  function update(stroke: Stroke): PaintField | null {
    if (state.kind === "finished") throw new Error("This paint transaction is already finished.");
    if (state.kind === "unstarted") {
      state = { kind: "open", scratch: {
        output: copyField(base), raster: createRasterScratch(stroke, masks.size),
        previous: null, changed: false, differentPixels: 0,
      } };
    }
    const scratch = state.scratch;
    const replacement = scratch.previous !== null && !extendsStroke(scratch.previous, stroke);
    if (replacement) {
      scratch.output.rgba.set(base.rgba);
      scratch.output.finish.set(base.finish);
      scratch.raster = createRasterScratch(stroke, masks.size);
      scratch.previous = null;
      scratch.differentPixels = 0;
    }
    scratch.changed = replacement;
    for (const [index, path] of stroke.paths.entries()) {
      const start = scratch.previous?.paths[index]?.length ?? 0;
      if (start === path.length) continue;
      if (scratch.raster.kind === "soften") {
        rasterSoften(scratch.output, base, stroke, masks, path, start, index, scratch.raster, scratch);
      } else {
        const bounds = emptyBounds(masks.size);
        rasterPath(scratch.raster.pixels, bounds, stroke, masks, path, start);
        composite(scratch.output, base, stroke, scratch.raster.pixels, bounds, scratch);
      }
    }
    scratch.previous = stroke;
    return scratch.changed ? scratch.output : null;
  }

  function finish(stroke: Stroke): FinishedPaint {
    if (state.kind === "finished") {
      if (state.result.stroke !== stroke) throw new Error("This paint transaction finished with another stroke.");
      return state.result;
    }
    update(stroke);
    if (state.kind !== "open") throw new Error("The paint transaction did not open.");
    const result: FinishedPaint = state.scratch.differentPixels === 0
      ? Object.freeze({ kind: "unchanged", stroke })
      : Object.freeze({ kind: "changed", stroke, base, field: state.scratch.output });
    state = { kind: "finished", result };
    return result;
  }

  return Object.freeze({ update, finish });
}

export function composePaint(strokes: readonly Stroke[], masks: PaintMasks): PaintField {
  const field = blankField(masks.size);
  for (const stroke of strokes) {
    if (stroke.algorithm === "soften-v1") {
      softenStroke(field, copyField(field), stroke, masks);
      continue;
    }
    const { pixels, bounds } = strokeCoverage(stroke, masks);
    const source = tools[stroke.brush.tool].operation === "blend" ? copyField(field) : field;
    composite(field, source, stroke, pixels, bounds);
  }
  return field;
}

export function paintStroke(field: PaintField, stroke: Stroke, masks: PaintMasks): PaintField {
  const next = copyField(field);
  if (stroke.algorithm === "soften-v1") {
    softenStroke(next, field, stroke, masks);
    return next;
  }
  const { pixels, bounds } = strokeCoverage(stroke, masks);
  composite(next, field, stroke, pixels, bounds);
  return next;
}

export function strokeChanges(field: PaintField, stroke: Stroke, masks: PaintMasks): boolean {
  return beginStroke(field, masks).finish(stroke).kind === "changed";
}

export function analyzePaint(field: PaintField, masks: PaintMasks): PaintAnalysis {
  const { size, valid: validMask, lips: lipMask, cheeks: cheekMask, lids: lidMask } = masks;
  const { rgba, finish } = field;
  let validArea = 0;
  let lipArea = 0;
  let cheekArea = 0;
  let lidArea = 0;
  let validCovered = 0;
  let lipCovered = 0;
  let cheekCovered = 0;
  let lidCovered = 0;
  const masses = { rose: 0, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 };
  let alphaMass = 0;
  let glossMass = 0;
  for (let y = border; y < size - border; y += 1) {
    for (let x = border; x < size - border; x += 1) {
      const index = y * size + x;
      const valid = (validMask[index] ?? 0) / 255;
      if (valid === 0) continue;
      const lip = valid * ((lipMask[index] ?? 0) / 255);
      const cheek = valid * ((cheekMask[index] ?? 0) / 255);
      const lid = valid * ((lidMask[index] ?? 0) / 255);
      validArea += valid;
      lipArea += lip;
      cheekArea += cheek;
      lidArea += lid;
      const offset = index * 4;
      const alpha = (rgba[offset + 3] ?? 0) / 255;
      if (alpha === 0) continue;
      validCovered += valid * alpha;
      lipCovered += lip * alpha;
      cheekCovered += cheek * alpha;
      lidCovered += lid * alpha;
      const mass = valid * alpha;
      alphaMass += mass;
      glossMass += mass * (finish[index] ?? 0) / 255;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      let closest: PaletteId | "other" = "other";
      let closestDistance = 96 * 96;
      for (const candidate of paletteColors) {
        const distance = (candidate.rgb[0] - red) ** 2
          + (candidate.rgb[1] - green) ** 2
          + (candidate.rgb[2] - blue) ** 2;
        if (distance < closestDistance) {
          closest = candidate.id;
          closestDistance = distance;
        }
      }
      masses[closest] += mass;
    }
  }
  return Object.freeze({
    alphaMass,
    coverage: Object.freeze({
      valid: validArea === 0 ? 0 : validCovered / validArea,
      lips: lipArea === 0 ? 0 : lipCovered / lipArea,
      cheeks: cheekArea === 0 ? 0 : cheekCovered / cheekArea,
      lids: lidArea === 0 ? 0 : lidCovered / lidArea,
    }),
    paletteMass: Object.freeze({
      rose: alphaMass === 0 ? 0 : masses.rose / alphaMass,
      orchid: alphaMass === 0 ? 0 : masses.orchid / alphaMass,
      plum: alphaMass === 0 ? 0 : masses.plum / alphaMass,
      ink: alphaMass === 0 ? 0 : masses.ink / alphaMass,
      gold: alphaMass === 0 ? 0 : masses.gold / alphaMass,
      pearl: alphaMass === 0 ? 0 : masses.pearl / alphaMass,
      coral: alphaMass === 0 ? 0 : masses.coral / alphaMass,
      other: alphaMass === 0 ? 0 : masses.other / alphaMass,
    }),
    glossShare: alphaMass === 0 ? 0 : glossMass / alphaMass,
  });
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function criterionEvidence(
  rule: Criterion,
  analysis: PaintAnalysis,
  enoughPaint: boolean,
  minimumCoverage: number,
): CriterionEvidence {
  let measured: number;
  let target: string;
  let passes: boolean;
  switch (rule.kind) {
    case "coverage":
      measured = analysis.coverage[rule.region];
      target = `${percentage(rule.range[0])} to ${percentage(rule.range[1])} ${rule.region} coverage`;
      passes = measured >= rule.range[0] && measured <= rule.range[1];
      break;
    case "palette":
      measured = rule.colors.reduce((sum, color) => sum + analysis.paletteMass[color], 0);
      target = `At least ${percentage(rule.minimum)} ${rule.colors.join(", ")} pigment mass`;
      passes = measured >= rule.minimum;
      break;
    case "finish":
      measured = analysis.glossShare;
      target = `${percentage(rule.range[0])} to ${percentage(rule.range[1])} gloss share`;
      passes = measured >= rule.range[0] && measured <= rule.range[1];
      break;
  }
  const earned = enoughPaint && passes ? rule.points : 0;
  return Object.freeze({
    id: rule.id, label: rule.label, measured, target, earned, possible: rule.points,
    reason: !enoughPaint
      ? `Not enough visible makeup. The brief requires paint on at least ${minimumCoverage * 100}% of the paintable face.`
      : `${percentage(measured)} measured. ${earned > 0 ? "Meets" : "Does not meet"} the published target.`,
  });
}

export function assess(themeId: ThemeId, analysis: PaintAnalysis): Critique {
  const theme: Theme = themes[themeId];
  const enoughPaint = analysis.alphaMass > 0 && analysis.coverage.valid >= theme.minimumCoverage;
  const evidence = Object.freeze(theme.rules.map((rule) =>
    criterionEvidence(rule, analysis, enoughPaint, theme.minimumCoverage)));
  return Object.freeze({
    label: "Solo brief match", theme: themeId, rulesVersion: 1,
    total: evidence.reduce((sum, item) => sum + item.earned, 0), outOf: 100, evidence,
  });
}
