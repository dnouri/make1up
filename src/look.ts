import { avatarFromInput, defaultIdentity, identityFromInput, upgradeIdentity } from "./avatar";
import type { AvatarIdentity, ClassicIdentity, PortraitIdentity } from "./avatar";
export { catalog, defaultIdentity, identityFromInput } from "./avatar";

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export const limits = Object.freeze({
  jsonBytes: 1_000_000,
  strokes: 160,
  pathsPerStroke: 8,
  pointsPerStroke: 512,
  pointsPerLook: 8_192,
  history: 50,
  radiusMin: 0.003,
  radiusMax: 0.08,
});

export const palette = {
  rose: { label: "Rose", color: "#cc5075" },
  orchid: { label: "Orchid", color: "#a764cb" },
  plum: { label: "Plum", color: "#51284e" },
  ink: { label: "Ink", color: "#171424" },
  gold: { label: "Gold", color: "#e5b85d" },
  pearl: { label: "Pearl", color: "#f2e9df" },
  coral: { label: "Coral", color: "#db7661" },
} as const;
export type PaletteId = keyof typeof palette;
export type HexColor = `#${string}`;

export const regions = {
  valid: { label: "Paintable face" },
  lips: { label: "Lips" },
  cheeks: { label: "Cheeks" },
  lids: { label: "Upper lids" },
} as const;
export type Region = keyof typeof regions;

export type PaintPolicy = "regional-v1" | "face-v2";
export const currentPaintPolicy: PaintPolicy = "face-v2";

type ToolDefinition = Readonly<{
  label: string;
  operation: "pigment" | "erase" | "blend";
  region: Readonly<Record<PaintPolicy, Region>>;
  tip: "round" | "star";
  placement: "continuous" | "stamp";
  defaults: Readonly<{
    color: HexColor; radius: number; opacity: number; softness: number; finish: number;
  }>;
}>;

export const tools = {
  blush: {
    label: "Blush", operation: "pigment", region: { "regional-v1": "cheeks", "face-v2": "valid" }, tip: "round", placement: "continuous",
    defaults: { color: palette.rose.color, radius: 0.045, opacity: 0.55, softness: 0.85, finish: 0 },
  },
  shadow: {
    label: "Eyeshadow", operation: "pigment", region: { "regional-v1": "lids", "face-v2": "valid" }, tip: "round", placement: "continuous",
    defaults: { color: palette.orchid.color, radius: 0.028, opacity: 0.8, softness: 0.65, finish: 0.1 },
  },
  lipstick: {
    label: "Lipstick", operation: "pigment", region: { "regional-v1": "lips", "face-v2": "lips" }, tip: "round", placement: "continuous",
    defaults: { color: palette.rose.color, radius: 0.055, opacity: 0.95, softness: 0.3, finish: 0.8 },
  },
  liner: {
    label: "Liner", operation: "pigment", region: { "regional-v1": "valid", "face-v2": "valid" }, tip: "round", placement: "continuous",
    defaults: { color: palette.ink.color, radius: 0.006, opacity: 1, softness: 0.1, finish: 0 },
  },
  sparkle: {
    label: "Sparkle stamp", operation: "pigment", region: { "regional-v1": "valid", "face-v2": "valid" }, tip: "star", placement: "stamp",
    defaults: { color: palette.pearl.color, radius: 0.018, opacity: 1, softness: 0, finish: 1 },
  },
  erase: {
    label: "Erase makeup", operation: "erase", region: { "regional-v1": "valid", "face-v2": "valid" }, tip: "round", placement: "continuous",
    defaults: { color: palette.pearl.color, radius: 0.04, opacity: 1, softness: 0.4, finish: 0 },
  },
  blend: {
    label: "Blend existing makeup", operation: "blend", region: { "regional-v1": "valid", "face-v2": "valid" }, tip: "round", placement: "continuous",
    defaults: { color: palette.pearl.color, radius: 0.04, opacity: 0.7, softness: 0.65, finish: 0 },
  },
} as const satisfies Record<string, ToolDefinition>;
export type ToolId = keyof typeof tools;

export function toolRegion(tool: ToolId, policy: PaintPolicy): Region {
  return tools[tool].region[policy];
}

export type Brush = Readonly<{
  tool: ToolId;
  color: HexColor;
  radius: number;
  opacity: number;
  softness: number;
  finish: number;
  mirror: boolean;
}>;
export type StrokeBrush = Omit<Brush, "mirror">;
export type UV = readonly [u: number, v: number];
export type StrokePath = readonly [UV, ...UV[]];
export type Stroke = Readonly<{
  id: string;
  policy: PaintPolicy;
  paths: readonly [StrokePath, ...StrokePath[]];
}> & (
  | Readonly<{ brush: StrokeBrush; algorithm?: never }>
  | Readonly<{ brush: StrokeBrush & { tool: "blend" }; algorithm: "soften-v1" }>
);
export type Look =
  | Readonly<{ version: 1 | 2; asset: "rain-portrait-v1"; identity: ClassicIdentity; strokes: readonly Stroke[] }>
  | Readonly<{ version: 3; asset: "rain-portrait-v1"; identity: ClassicIdentity; strokes: readonly Stroke[] }>
  | Readonly<{ version: 3; asset: "rain-portrait-v2"; identity: AvatarIdentity; strokes: readonly Stroke[] }>;
export type ClassicLook = Extract<Look, { asset: "rain-portrait-v1" }>;
export type CustomLook = Extract<Look, { asset: "rain-portrait-v2" }>;

export type Criterion = Readonly<{ id: string; label: string; points: number }> & (
  | Readonly<{ kind: "coverage"; region: Region; range: readonly [number, number] }>
  | Readonly<{ kind: "palette"; colors: readonly PaletteId[]; minimum: number }>
  | Readonly<{ kind: "finish"; range: readonly [number, number] }>
);
export type Theme = Readonly<{
  title: string;
  brief: string;
  minimumCoverage: number;
  rules: readonly Criterion[];
}>;
export const themes = {
  "orchid-hour": {
    title: "Orchid hour",
    brief: "Orchid or plum lids, a defined lip, and a restrained sheen.",
    minimumCoverage: 0.005,
    rules: [
      { id: "lids", label: "Color on the lids", points: 30, kind: "coverage", region: "lids", range: [0.2, 0.9] },
      { id: "lips", label: "A defined lip", points: 20, kind: "coverage", region: "lips", range: [0.2, 0.95] },
      { id: "palette", label: "Orchid palette", points: 35, kind: "palette", colors: ["orchid", "plum", "pearl"], minimum: 0.55 },
      { id: "finish", label: "Restrained sheen", points: 15, kind: "finish", range: [0.1, 0.65] },
    ],
  },
  "graphic-night": {
    title: "Graphic night",
    brief: "Ink and pearl contrast, focused eye marks, and mostly matte paint.",
    minimumCoverage: 0.005,
    rules: [
      { id: "lids", label: "Eye definition", points: 35, kind: "coverage", region: "lids", range: [0.15, 0.8] },
      { id: "palette", label: "Ink and pearl palette", points: 35, kind: "palette", colors: ["ink", "pearl"], minimum: 0.65 },
      { id: "placement", label: "Focused placement", points: 15, kind: "coverage", region: "valid", range: [0.01, 0.2] },
      { id: "finish", label: "Mostly matte", points: 15, kind: "finish", range: [0, 0.4] },
    ],
  },
  "rose-editorial": {
    title: "Rose editorial",
    brief: "Rose or coral cheeks, a colored lip, and a satin or glossy finish.",
    minimumCoverage: 0.005,
    rules: [
      { id: "cheeks", label: "Soft cheek color", points: 30, kind: "coverage", region: "cheeks", range: [0.15, 0.85] },
      { id: "lips", label: "Colored lips", points: 25, kind: "coverage", region: "lips", range: [0.25, 0.95] },
      { id: "palette", label: "Rose palette", points: 30, kind: "palette", colors: ["rose", "coral", "pearl"], minimum: 0.6 },
      { id: "finish", label: "Satin or gloss", points: 15, kind: "finish", range: [0.2, 0.9] },
    ],
  },
} as const satisfies Record<string, Theme>;
export type ThemeId = keyof typeof themes;

function failure(error: string): Result<never> {
  return { ok: false, error };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyOf<T extends object>(object: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.hasOwn(object, key);
}

function finiteIn(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
}

function readColor(value: unknown): HexColor | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return `#${value.slice(1).toLowerCase()}`;
}

export function defaultBrush(tool: ToolId = "blush"): Brush {
  return Object.freeze({ tool, ...tools[tool].defaults, mirror: false });
}

function readStrokeBrush(raw: unknown): Result<StrokeBrush> {
  if (!record(raw) || !keyOf(tools, raw.tool)) return failure("Unknown makeup tool.");
  const color = readColor(raw.color);
  if (color === null
    || !finiteIn(raw.radius, limits.radiusMin, limits.radiusMax)
    || !finiteIn(raw.opacity, 0, 1)
    || !finiteIn(raw.softness, 0, 1)
    || !finiteIn(raw.finish, 0, 1)) {
    return failure("Brush color or settings are outside their allowed range.");
  }
  return { ok: true, value: Object.freeze({
    tool: raw.tool, color, radius: raw.radius, opacity: raw.opacity,
    softness: raw.softness, finish: raw.finish,
  }) };
}

export function brushFromInput(raw: unknown): Result<Brush> {
  const brush = readStrokeBrush(raw);
  if (!brush.ok) return brush;
  if (!record(raw) || typeof raw.mirror !== "boolean") return failure("Mirror must be a boolean.");
  return { ok: true, value: Object.freeze({ ...brush.value, mirror: raw.mirror }) };
}

function readPaths(raw: unknown): Result<readonly [StrokePath, ...StrokePath[]]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > limits.pathsPerStroke) {
    return failure("A gesture needs one to eight separate paths.");
  }
  const paths: StrokePath[] = [];
  let count = 0;
  for (const path of raw) {
    if (!Array.isArray(path) || path.length === 0) return failure("A stroke path cannot be empty.");
    count += path.length;
    if (count > limits.pointsPerStroke) return failure("This gesture has too many points.");
    const points: UV[] = [];
    for (const point of path) {
      if (!Array.isArray(point) || point.length !== 2
        || !finiteIn(point[0], 0, 1) || !finiteIn(point[1], 0, 1)) {
        return failure("Paint coordinates must be finite UV pairs between zero and one.");
      }
      points.push(Object.freeze([
        Math.round(point[0] * 65535) / 65535,
        Math.round(point[1] * 65535) / 65535,
      ]));
    }
    const [first, ...rest] = points;
    if (first === undefined) return failure("A stroke path cannot be empty.");
    paths.push(Object.freeze([first, ...rest]));
  }
  const [first, ...rest] = paths;
  if (first === undefined) return failure("A gesture needs a path.");
  return { ok: true, value: Object.freeze([first, ...rest]) };
}

function readStoredStroke(id: unknown, rawBrush: unknown, rawPaths: unknown, policy: PaintPolicy, rawAlgorithm: unknown): Result<Stroke> {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return failure("A stroke ID must have one to 64 letters, digits, underscores, or hyphens.");
  }
  const brush = readStrokeBrush(rawBrush);
  if (!brush.ok) return brush;
  if (rawAlgorithm !== undefined && (rawAlgorithm !== "soften-v1" || brush.value.tool !== "blend")) {
    return failure("Unknown stroke algorithm or incompatible makeup tool.");
  }
  const paths = readPaths(rawPaths);
  if (!paths.ok) return paths;
  if (rawAlgorithm === "soften-v1") {
    return { ok: true, value: Object.freeze({
      id, policy, brush: Object.freeze({ ...brush.value, tool: "blend" as const }),
      paths: paths.value, algorithm: rawAlgorithm,
    }) };
  }
  return { ok: true, value: Object.freeze({ id, policy, brush: brush.value, paths: paths.value }) };
}

export function captureStroke(id: unknown, rawBrush: unknown, rawPaths: unknown): Result<Stroke> {
  const algorithm = record(rawBrush) && rawBrush.tool === "blend" ? "soften-v1" : undefined;
  return readStoredStroke(id, rawBrush, rawPaths, currentPaintPolicy, algorithm);
}

export function newLook(): ClassicLook;
export function newLook(identity: ClassicIdentity): ClassicLook;
export function newLook(identity: AvatarIdentity): CustomLook;
export function newLook(identity: PortraitIdentity): Look;
export function newLook(identity: PortraitIdentity = defaultIdentity): Look {
  const strokes = Object.freeze([]);
  return identity.kind === "classic"
    ? Object.freeze({ version: 1, asset: "rain-portrait-v1", identity: Object.freeze({ ...identity }), strokes })
    : Object.freeze({ version: 3, asset: "rain-portrait-v2", identity: Object.freeze({ ...identity }), strokes });
}

function pointCount(stroke: Stroke): number {
  return stroke.paths.reduce((sum, path) => sum + path.length, 0);
}

export function appendStroke(look: Look, stroke: Stroke): Result<Look> {
  if (look.strokes.some((item) => item.id === stroke.id)) return failure("That gesture was already applied.");
  if (look.strokes.length >= limits.strokes) return failure("This look has reached its gesture limit. Clear some makeup or start a new look.");
  if (look.strokes.reduce((sum, item) => sum + pointCount(item), pointCount(stroke)) > limits.pointsPerLook) {
    return failure("This look has reached its paint point limit.");
  }
  return { ok: true, value: Object.freeze({
    ...look, version: 3,
    strokes: Object.freeze([...look.strokes, stroke]),
  }) };
}

export function withIdentity(look: Look, identity: PortraitIdentity): Look {
  if (identity.kind === look.identity.kind
    && Object.entries(identity).every(([key, value]) => Reflect.get(look.identity, key) === value)) return look;
  return identity.kind === "classic"
    ? Object.freeze({ version: 3, asset: "rain-portrait-v1", identity: Object.freeze({ ...identity }), strokes: look.strokes })
    : Object.freeze({ version: 3, asset: "rain-portrait-v2", identity: Object.freeze({ ...identity }), strokes: look.strokes });
}

export function upgradePortrait(look: Look): Look {
  return look.identity.kind === "custom" ? look : withIdentity(look, upgradeIdentity(look.identity));
}

export function clearMakeup(look: Look): Look {
  return look.strokes.length === 0 ? look : Object.freeze({ ...look, version: 3, strokes: Object.freeze([]) });
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(raw).length === keys.length && keys.every((key) => Object.hasOwn(raw, key));
}

export function decodeLook(raw: unknown): Result<Look> {
  if (!record(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== 3)
    || (raw.asset !== "rain-portrait-v1" && (raw.version !== 3 || raw.asset !== "rain-portrait-v2"))) {
    return failure("This look has an unknown version or portrait asset.");
  }
  if (raw.version === 3 && (!exactKeys(raw, ["version", "asset", "identity", "strokes"])
    || !record(raw.identity)
    || !exactKeys(raw.identity, raw.asset === "rain-portrait-v1"
      ? ["kind", "geometry", "eyes", "complexion", "hairColor", "hairStyle"]
      : ["kind", "face", "nose", "mouth", "eyeShape", "complexion", "eyes", "hairColor", "hairStyle"])
    || raw.identity.kind !== (raw.asset === "rain-portrait-v1" ? "classic" : "custom"))) {
    return failure("The saved look has unsupported or missing document fields.");
  }
  const identity = raw.asset === "rain-portrait-v1" ? identityFromInput(raw.identity) : avatarFromInput(raw.identity);
  if (!identity.ok) return identity;
  if (!Array.isArray(raw.strokes) || raw.strokes.length > limits.strokes) {
    return failure("The saved look has too many gestures or no gesture list.");
  }
  const strokes: Stroke[] = [];
  const ids = new Set<string>();
  let points = 0;
  for (const item of raw.strokes) {
    if (!record(item)) return failure("A saved gesture is not an object.");
    if (raw.version === 1 && item.algorithm !== undefined) return failure("Tagged strokes require look version 2.");
    if (raw.version === 3 && (!exactKeys(item, item.algorithm === undefined
      ? ["id", "policy", "brush", "paths"] : ["id", "policy", "brush", "paths", "algorithm"])
      || !record(item.brush) || !exactKeys(item.brush, ["tool", "color", "radius", "opacity", "softness", "finish"]))) {
      return failure("A saved gesture has unsupported or missing fields.");
    }
    if (raw.version === 3 && item.policy !== "regional-v1" && item.policy !== "face-v2") {
      return failure("Unknown stroke paint policy.");
    }
    const policy = raw.version === 3 && item.policy === "face-v2" ? "face-v2" : "regional-v1";
    const stroke = readStoredStroke(item.id, item.brush, item.paths, policy, item.algorithm);
    if (!stroke.ok) return stroke;
    if (ids.has(stroke.value.id)) return failure("A saved look repeats a gesture ID.");
    ids.add(stroke.value.id);
    points += pointCount(stroke.value);
    if (points > limits.pointsPerLook) return failure("The saved look has too many paint points.");
    strokes.push(stroke.value);
  }
  const frozenStrokes = Object.freeze(strokes);
  return identity.value.kind === "classic"
    ? { ok: true, value: Object.freeze({ version: raw.version, asset: "rain-portrait-v1", identity: identity.value, strokes: frozenStrokes }) }
    : { ok: true, value: Object.freeze({ version: 3, asset: "rain-portrait-v2", identity: identity.value, strokes: frozenStrokes }) };
}

export function decodeLookJSON(json: string): Result<Look> {
  if (json.length > limits.jsonBytes || new TextEncoder().encode(json).length > limits.jsonBytes) {
    return failure("The saved look exceeds the one megabyte limit.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return failure("The saved look is not valid JSON.");
  }
  return decodeLook(raw);
}

function strokeDocument(stroke: Stroke, current: boolean) {
  return {
    id: stroke.id,
    ...(current ? { policy: stroke.policy } : {}),
    brush: {
      tool: stroke.brush.tool, color: stroke.brush.color,
      radius: stroke.brush.radius, opacity: stroke.brush.opacity,
      softness: stroke.brush.softness, finish: stroke.brush.finish,
    },
    paths: stroke.paths,
    ...(stroke.algorithm === undefined ? {} : { algorithm: stroke.algorithm }),
  };
}

export function encodeLook(look: Look): string {
  return JSON.stringify({
    version: look.version,
    asset: look.asset,
    identity: look.identity.kind === "classic" ? {
      ...(look.version === 3 ? { kind: look.identity.kind } : {}),
      geometry: look.identity.geometry, eyes: look.identity.eyes,
      complexion: look.identity.complexion, hairColor: look.identity.hairColor,
      hairStyle: look.identity.hairStyle,
    } : {
      kind: look.identity.kind, face: look.identity.face, nose: look.identity.nose,
      mouth: look.identity.mouth, eyeShape: look.identity.eyeShape,
      complexion: look.identity.complexion, eyes: look.identity.eyes,
      hairColor: look.identity.hairColor, hairStyle: look.identity.hairStyle,
    },
    strokes: look.strokes.map((stroke) => strokeDocument(stroke, look.version === 3)),
  });
}

export function lookFingerprint(look: Look): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(encodeLook(look))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `rain-v${look.version}-${hash.toString(16).padStart(16, "0")}`;
}
