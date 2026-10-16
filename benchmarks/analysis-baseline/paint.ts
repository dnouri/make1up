import { palette, themes, tools } from "./look";
import type { Criterion, PaletteId, Region, Result, Stroke, Theme, ThemeId } from "./look";

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

type Bounds = { left: number; top: number; right: number; bottom: number };

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
  coverage: Uint8Array,
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
  bounds.left = Math.min(bounds.left, left);
  bounds.right = Math.max(bounds.right, right);
  bounds.top = Math.min(bounds.top, top);
  bounds.bottom = Math.max(bounds.bottom, bottom);
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
      coverage[index] = Math.max(coverage[index] ?? 0, amount);
    }
  }
}

function strokeCoverage(stroke: Stroke, masks: PaintMasks): Readonly<{ pixels: Uint8Array; bounds: Bounds }> {
  const pixels = new Uint8Array(masks.size * masks.size);
  const bounds = { left: masks.size, top: masks.size, right: -1, bottom: -1 };
  const spacing = Math.max(0.75, stroke.brush.radius * masks.size * 0.35);
  for (const path of stroke.paths) {
    const first = path[0];
    drawTip(pixels, bounds, stroke, masks, first[0], first[1]);
    let previous = first;
    for (const point of path.slice(1)) {
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
      previous = point;
    }
  }
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

function applyStroke(field: PaintField, stroke: Stroke, masks: PaintMasks): void {
  const { pixels, bounds } = strokeCoverage(stroke, masks);
  const operation = tools[stroke.brush.tool].operation;
  const [red, green, blue] = colorBytes(stroke.brush.color);
  const source = operation === "blend"
    ? { size: field.size, rgba: field.rgba.slice(), finish: field.finish.slice() }
    : field;
  const blurRadius = Math.max(1, Math.min(8, Math.round(stroke.brush.radius * field.size * 0.18)));
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      const index = y * field.size + x;
      const strength = (pixels[index] ?? 0) / 255 * stroke.brush.opacity;
      if (strength === 0) continue;
      if (operation === "blend") {
        blendPixel(field, source, index, strength, blurRadius);
        continue;
      }
      const offset = index * 4;
      const oldAlpha = (field.rgba[offset + 3] ?? 0) / 255;
      if (operation === "erase") {
        const remaining = oldAlpha * (1 - strength);
        writePixel(field, index, remaining,
          (field.rgba[offset] ?? 0) * remaining,
          (field.rgba[offset + 1] ?? 0) * remaining,
          (field.rgba[offset + 2] ?? 0) * remaining,
          (field.finish[index] ?? 0) * remaining);
      } else {
        const remaining = oldAlpha * (1 - strength);
        writePixel(field, index, strength + remaining,
          red * strength + (field.rgba[offset] ?? 0) * remaining,
          green * strength + (field.rgba[offset + 1] ?? 0) * remaining,
          blue * strength + (field.rgba[offset + 2] ?? 0) * remaining,
          stroke.brush.finish * 255 * strength + (field.finish[index] ?? 0) * remaining);
      }
    }
  }
}

export function composePaint(strokes: readonly Stroke[], masks: PaintMasks): PaintField {
  const field = blankField(masks.size);
  for (const stroke of strokes) applyStroke(field, stroke, masks);
  return field;
}

export function paintStroke(field: PaintField, stroke: Stroke, masks: PaintMasks): PaintField {
  const next = Object.freeze({ size: field.size, rgba: field.rgba.slice(), finish: field.finish.slice() });
  applyStroke(next, stroke, masks);
  return next;
}

export function strokeChanges(field: PaintField, stroke: Stroke, masks: PaintMasks): boolean {
  const candidate = paintStroke(field, stroke, masks);
  for (let index = 0; index < field.rgba.length; index += 1) {
    if (candidate.rgba[index] !== field.rgba[index]) return true;
  }
  for (let index = 0; index < field.finish.length; index += 1) {
    if (candidate.finish[index] !== field.finish[index]) return true;
  }
  return false;
}

export function analyzePaint(field: PaintField, masks: PaintMasks): PaintAnalysis {
  const areas = { valid: 0, lips: 0, cheeks: 0, lids: 0 };
  const covered = { valid: 0, lips: 0, cheeks: 0, lids: 0 };
  const masses = { rose: 0, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 };
  let alphaMass = 0;
  let glossMass = 0;
  for (let y = border; y < masks.size - border; y += 1) {
    for (let x = border; x < masks.size - border; x += 1) {
      const index = y * masks.size + x;
      const valid = (masks.valid[index] ?? 0) / 255;
      const alpha = (field.rgba[index * 4 + 3] ?? 0) / 255;
      for (const region of ["valid", "lips", "cheeks", "lids"] as const) {
        const weight = valid * (region === "valid" ? 1 : (masks[region][index] ?? 0) / 255);
        areas[region] += weight;
        covered[region] += weight * alpha;
      }
      const mass = valid * alpha;
      if (mass === 0) continue;
      alphaMass += mass;
      glossMass += mass * (field.finish[index] ?? 0) / 255;
      let closest: PaletteId | "other" = "other";
      let closestDistance = 96 * 96;
      for (const candidate of paletteColors) {
        const distance = (candidate.rgb[0] - (field.rgba[index * 4] ?? 0)) ** 2
          + (candidate.rgb[1] - (field.rgba[index * 4 + 1] ?? 0)) ** 2
          + (candidate.rgb[2] - (field.rgba[index * 4 + 2] ?? 0)) ** 2;
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
      valid: areas.valid === 0 ? 0 : covered.valid / areas.valid,
      lips: areas.lips === 0 ? 0 : covered.lips / areas.lips,
      cheeks: areas.cheeks === 0 ? 0 : covered.cheeks / areas.cheeks,
      lids: areas.lids === 0 ? 0 : covered.lids / areas.lids,
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
