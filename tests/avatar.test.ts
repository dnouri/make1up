import { describe, expect, it } from "vitest";
import registry from "../art/avatar-v2.json";
import { avatarCatalog, avatarFromInput, defaultAvatarIdentity, defaultIdentity } from "../src/avatar";
import type { AvatarChoice, AvatarIdentity } from "../src/avatar";
import {
  appendStroke, captureStroke, clearMakeup, decodeLook, decodeLookJSON, defaultBrush,
  encodeLook, lookFingerprint, newLook, toolRegion, tools, upgradePortrait, withIdentity,
} from "../src/look";
import type { Look, Result, Stroke, ToolId } from "../src/look";
import { composePaint, createPaintMasks, analyzePaint, assess, beginStroke, paintStroke, strokeChanges } from "../src/paint";
import { decodeShare, encodeShare, lookbookKey, readLookbook, saveLook } from "../src/lookbook";
import type { StoragePort } from "../src/lookbook";
import { createSession, presentSession, step } from "../src/session";
import { composePaint as frozenCompose } from "../benchmarks/analysis-baseline/paint";
import { decodeLookJSON as frozenDecode } from "../benchmarks/analysis-baseline/look";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const legacyV1 = '{"version":1,"asset":"rain-portrait-v1","identity":{"geometry":"neutral-rain","eyes":"blue","complexion":"source","hairColor":"espresso","hairStyle":"ponytail"},"strokes":[{"id":"old-blend","brush":{"tool":"blend","color":"#00ff00","radius":0.08,"opacity":0.5,"softness":0,"finish":1},"paths":[[[0.2,0.4],[0.4,0.4]]]}]}';
const legacyV2 = '{"version":2,"asset":"rain-portrait-v1","identity":{"geometry":"neutral-rain","eyes":"hazel","complexion":"golden","hairColor":"chestnut","hairStyle":"tucked"},"strokes":[{"id":"legacy-cheek","brush":{"tool":"blush","color":"#a764cb","radius":0.06,"opacity":0.6,"softness":0.45,"finish":0.4},"paths":[[[0.7199969481956207,0.6500038147554742],[0.5000076295109483,0.26999313344014647]]]},{"id":"legacy-soften","brush":{"tool":"blend","color":"#f2e9df","radius":0.04,"opacity":0.7,"softness":0.65,"finish":0},"paths":[[[0.7199969481956207,0.6500038147554742]]],"algorithm":"soften-v1"}]}';
const fixtures = [
  { json: legacyV1, fingerprint: "rain-v1-c7ad34f3f000d6f6", version: 1 },
  { json: legacyV2, fingerprint: "rain-v2-7554389f693807bf", version: 2 },
] as const;

function mark(id = "new-cheek", tool: ToolId = "blush"): Stroke {
  return value(captureStroke(id, { ...defaultBrush(tool), radius: 0.06, opacity: 1, softness: 0 }, [[[0.72, 0.65], [0.5, 0.27]]]));
}

function masks() {
  const size = 64;
  const valid = new Uint8Array(size * size).fill(255);
  const cheeks = new Uint8Array(size * size);
  const lids = new Uint8Array(size * size);
  const lips = new Uint8Array(size * size);
  for (let y = 38; y < 46; y++) for (let x = 42; x < 50; x++) cheeks[y * size + x] = 255;
  for (let y = 28; y < 32; y++) for (let x = 38; x < 44; x++) lids[y * size + x] = 255;
  for (let y = 50; y < 54; y++) for (let x = 28; x < 36; x++) lips[y * size + x] = 255;
  return value(createPaintMasks({ size, valid, cheeks, lids, lips }));
}

class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, raw: string) { this.data.set(key, raw); }
}
const thumbnail = "data:image/png;base64,iVBORw0KGgo=";

function currentDocument(): Record<string, unknown> {
  return JSON.parse(encodeLook(value(appendStroke(newLook(defaultAvatarIdentity), mark()))));
}

describe("portrait identity registry", () => {
  it("projects each approved choice without exposing asset recipes", () => {
    expect(Object.keys(avatarCatalog)).toEqual(Object.keys(registry.choices));
    for (const field of Object.keys(avatarCatalog) as AvatarChoice[]) {
      expect(Object.keys(avatarCatalog[field])).toEqual(Object.keys(registry.choices[field]));
      for (const [id, entry] of Object.entries(avatarCatalog[field])) {
        const source = Reflect.get(registry.choices[field], id) as { label: string };
        expect(entry).toEqual({ label: source.label });
        const identity = value(avatarFromInput({ ...defaultAvatarIdentity, [field]: id }));
        expect(identity[field]).toBe(id);
        expect(Object.isFrozen(identity)).toBe(true);
        expect(Object.isFrozen(entry)).toBe(true);
      }
    }
    expect(defaultAvatarIdentity).toEqual({ kind: "custom", ...registry.defaults });
    expect(newLook()).toMatchObject({ version: 1, asset: "rain-portrait-v1", identity: { kind: "classic" } });
    expect(newLook(defaultAvatarIdentity)).toMatchObject({ version: 3, asset: "rain-portrait-v2", identity: defaultAvatarIdentity });
  });

  it("rejects missing fields, unapproved choices, recipes, and classic identities", () => {
    for (const field of Object.keys(avatarCatalog)) {
      const raw: Record<string, unknown> = { ...defaultAvatarIdentity };
      delete raw[field];
      expect(avatarFromInput(raw).ok).toBe(false);
      expect(avatarFromInput({ ...defaultAvatarIdentity, [field]: "unknown" }).ok).toBe(false);
    }
    expect(avatarFromInput({ ...defaultAvatarIdentity, morphs: { "nose-broad": 0.5 } }).ok).toBe(false);
    expect(avatarFromInput(defaultIdentity).ok).toBe(false);
  });

  it.each([
    ["source", "warm"], ["rose", "fair"], ["golden", "tan"], ["deep", "deep"],
  ] as const)("explicitly maps classic %s skin to %s and neutral shapes", (classic, custom) => {
    for (const hairStyle of ["ponytail", "tucked", "short"] as const) {
      const old = withIdentity(value(decodeLookJSON(legacyV2)), {
        ...defaultIdentity, complexion: classic, eyes: "olive", hairColor: "plum", hairStyle,
      });
      const next = upgradePortrait(old);
      expect(next).toMatchObject({ version: 3, asset: "rain-portrait-v2", identity: {
        kind: "custom", face: "balanced", nose: "balanced", mouth: "balanced", eyeShape: "balanced",
        complexion: custom, eyes: "olive", hairColor: "plum", hairStyle: "ponytail",
      } });
      expect(next.strokes).toBe(old.strokes);
      expect(upgradePortrait(next)).toBe(next);
    }
  });

  it("changes the identity and revision as one undoable edit", () => {
    const old = value(decodeLookJSON(legacyV2));
    const upgraded = upgradePortrait(old);
    let session = step(createSession(old), { type: "identity", identity: upgraded.identity });
    expect(presentSession(session).look).toEqual(upgraded);
    session = step(session, { type: "undo" });
    expect(presentSession(session).look).toBe(old);
    expect(lookFingerprint(presentSession(session).look)).toBe("rain-v2-7554389f693807bf");
    session = step(session, { type: "redo" });
    expect(presentSession(session).look).toEqual(upgraded);
  });

  it("makes mismatched identity and asset pairs fail TypeScript", () => {
    type Assignable<From, To> = From extends To ? true : false;
    type AssertFalse<Value extends false> = Value;
    type WrongClassic = Readonly<{ version: 3; asset: "rain-portrait-v1"; identity: AvatarIdentity; strokes: readonly Stroke[] }>;
    type WrongCustom = Readonly<{ version: 3; asset: "rain-portrait-v2"; identity: typeof defaultIdentity; strokes: readonly Stroke[] }>;
    type WrongVersion = Readonly<{ version: 2; asset: "rain-portrait-v2"; identity: AvatarIdentity; strokes: readonly Stroke[] }>;
    const wrongClassic: AssertFalse<Assignable<WrongClassic, Look>> = false;
    const wrongCustom: AssertFalse<Assignable<WrongCustom, Look>> = false;
    const wrongVersion: AssertFalse<Assignable<WrongVersion, Look>> = false;
    expect([wrongClassic, wrongCustom, wrongVersion]).toEqual([false, false, false]);
  });
});

describe("frozen legacy documents and current edits", () => {
  it.each(fixtures)("keeps document $version JSON and fingerprint exact through reading and no-ops", ({ json, fingerprint, version }) => {
    const look = value(decodeLookJSON(json));
    expect(look.version).toBe(version);
    expect(encodeLook(look)).toBe(json);
    expect(lookFingerprint(look)).toBe(fingerprint);
    expect(look.strokes.every((stroke) => stroke.policy === "regional-v1")).toBe(true);
    expect(withIdentity(look, { ...look.identity })).toBe(look);
    expect(appendStroke(look, { ...look.strokes[0]! })).toEqual({ ok: false, error: "That gesture was already applied." });
    const empty = value(decodeLook({ ...JSON.parse(json), strokes: [] }));
    expect(clearMakeup(empty)).toBe(empty);
    const captured = mark();
    expect(captured.policy).toBe("face-v2");
    expect(encodeLook(look)).toBe(json);
    expect(lookFingerprint(look)).toBe(fingerprint);
    const session = createSession(look);
    expect(step(session, { type: "identity", identity: { ...look.identity } })).toBe(session);
  });

  it.each(fixtures)("promotes document $version only on real append, clear, or identity edits", ({ json }) => {
    const old = value(decodeLookJSON(json));
    const appended = value(appendStroke(old, mark()));
    const cleared = clearMakeup(old);
    const identity = withIdentity(old, { ...defaultIdentity, eyes: "olive" });
    expect([appended.version, cleared.version, identity.version]).toEqual([3, 3, 3]);
    expect(appended.strokes.slice(0, old.strokes.length)).toEqual(old.strokes);
    expect(appended.strokes[0]).toBe(old.strokes[0]);
    expect(identity.strokes).toBe(old.strokes);
    expect(encodeLook(old)).toBe(json);
    const changed = mark(old.strokes[0]!.id);
    expect(appendStroke(old, changed).ok).toBe(false);
    expect(encodeLook(old)).toBe(json);
  });

  it("round trips mixed policies and both Blend algorithms under either asset", () => {
    const old = value(decodeLookJSON(legacyV1));
    const blended = value(appendStroke(old, mark("new-blend", "blend")));
    const mixed = value(appendStroke(blended, mark()));
    for (const look of [mixed, upgradePortrait(mixed)]) {
      const decoded = value(decodeLookJSON(encodeLook(look)));
      expect(decoded).toEqual(look);
      expect(decoded.strokes.map((stroke) => [stroke.policy, stroke.algorithm])).toEqual([
        ["regional-v1", undefined], ["face-v2", "soften-v1"], ["face-v2", undefined],
      ]);
      expect(frozenDecode(encodeLook(look)).ok).toBe(false);
    }
  });

  it.each([
    (raw: Record<string, unknown>) => ({ ...raw, asset: "rain-portrait-v1" }),
    (raw: Record<string, unknown>) => ({ ...raw, version: 2 }),
    (raw: Record<string, unknown>) => ({ ...raw, identity: defaultIdentity }),
    (raw: Record<string, unknown>) => ({ ...raw, asset: "rain-portrait-v99" }),
    (raw: Record<string, unknown>) => ({ ...raw, paintAtlas: "unknown" }),
    (raw: Record<string, unknown>) => ({ ...raw, identity: { ...defaultAvatarIdentity, geometry: "neutral-rain" } }),
    (raw: Record<string, unknown>) => ({ ...raw, identity: { ...defaultAvatarIdentity, face: "unapproved" } }),
    (raw: Record<string, unknown>) => ({ ...raw, identity: { ...defaultAvatarIdentity, kind: "classic" } }),
    (raw: Record<string, unknown>) => ({ ...raw, identity: { ...defaultAvatarIdentity, nose: undefined } }),
    (raw: Record<string, unknown>) => ({ ...raw, strokes: [{ ...mark(), policy: "future-v9" }] }),
    (raw: Record<string, unknown>) => ({ ...raw, strokes: [{ id: "missing-policy", brush: mark().brush, paths: mark().paths }] }),
    (raw: Record<string, unknown>) => ({ ...raw, strokes: [{ ...mark(), algorithm: "soften-v1" }] }),
    (raw: Record<string, unknown>) => ({ ...raw, strokes: [{ ...mark(), extra: "cannot-discard" }] }),
    (raw: Record<string, unknown>) => ({ ...raw, strokes: [{ ...mark(), brush: { ...mark().brush, mirror: true } }] }),
  ])("rejects malformed or mismatched document 3 case %# without dropping fields", (malform) => {
    expect(decodeLook(malform(currentDocument())).ok).toBe(false);
    expect(decodeLookJSON(encodeLook(newLook(defaultAvatarIdentity))).ok).toBe(true);
  });
});

describe("per-stroke paint policy", () => {
  it("keeps every old replay byte clipped after promotion while identical new paths paint the forehead", () => {
    const input = masks();
    const legacy = value(decodeLookJSON(legacyV2));
    const old = legacy.strokes[0]!;
    const frozen = frozenCompose([old], input);
    const promoted = withIdentity(legacy, { ...defaultIdentity, complexion: "deep" });
    const replay = composePaint([promoted.strokes[0]!], input);
    expect(replay).toEqual(frozen);
    const forehead = (17 * 64 + 32) * 4;
    expect([...replay.rgba.slice(forehead, forehead + 4)]).toEqual([0, 0, 0, 0]);
    const fresh = value(captureStroke("fresh", old.brush, old.paths));
    const painted = paintStroke(replay, fresh, input);
    expect(painted.rgba[forehead + 3]).toBeGreaterThan(0);
    const transaction = beginStroke(replay, input);
    expect(transaction.update(fresh)).toEqual(painted);
    const finished = transaction.finish(fresh);
    expect(finished.kind).toBe("changed");
    if (finished.kind === "changed") expect(finished.field).toEqual(painted);
    const mixed = value(appendStroke(promoted, fresh));
    expect(composePaint(mixed.strokes.slice(0, 1), input)).toEqual(frozen);
    expect(composePaint(value(decodeLookJSON(encodeLook(mixed))).strokes, input)).toEqual(composePaint(mixed.strokes, input));
  });

  it.each(Object.keys(tools) as ToolId[])("uses the intended hard region for %s under both policies", (tool) => {
    expect(toolRegion(tool, "regional-v1")).toBe(tool === "blush" ? "cheeks" : tool === "shadow" ? "lids" : tool === "lipstick" ? "lips" : "valid");
    expect(toolRegion(tool, "face-v2")).toBe(tool === "lipstick" ? "lips" : "valid");
    const input = masks();
    const stroke = value(captureStroke(`new-${tool}`, { ...defaultBrush(tool), radius: 0.06, softness: 0, opacity: 1 }, [[[0.5, 0.27]]]));
    const blank = composePaint([], input);
    const base = tool === "erase" || tool === "blend" ? composePaint([mark("base", "liner")], input) : blank;
    expect(strokeChanges(base, stroke, input)).toBe(tool !== "lipstick");
    if (tool === "lipstick") expect(paintStroke(base, stroke, input)).toEqual(base);
  });

  it("replaces transaction coverage when only policy changes in either direction", () => {
    const input = masks();
    const base = composePaint([], input);
    const face = mark("same");
    const regional: Stroke = Object.freeze({ ...face, policy: "regional-v1" });
    for (const [first, next] of [[face, regional], [regional, face]] as const) {
      const transaction = beginStroke(base, input);
      transaction.update(first);
      expect(transaction.update(next)).toEqual(paintStroke(base, next, input));
      const final = transaction.finish(next);
      expect(final.kind).toBe("changed");
      if (final.kind === "changed") expect(final.field).toEqual(composePaint([next], input));
    }
  });

  it("restores the bare field when a full-face transaction is replaced by a clipped regional stroke", () => {
    const input = masks();
    const base = composePaint([], input);
    const face = value(captureStroke("forehead", { ...defaultBrush("blush"), radius: 0.06 }, [[[0.5, 0.27]]]));
    const regional: Stroke = { ...face, policy: "regional-v1" };
    const transaction = beginStroke(base, input);
    expect(transaction.update(face)).not.toBeNull();
    expect(transaction.update(regional)).toEqual(base);
    expect(transaction.finish(regional)).toEqual({ kind: "unchanged", stroke: regional });
    const reverse = beginStroke(base, input);
    expect(reverse.update(regional)).toBeNull();
    const finished = reverse.finish(face);
    expect(finished.kind).toBe("changed");
    if (finished.kind === "changed") expect(finished.field).toEqual(composePaint([face], input));
  });

  it("scores the same makeup independently of classic and custom appearance", () => {
    const input = masks();
    const old = value(decodeLookJSON(legacyV2));
    const custom = upgradePortrait(old);
    const identity: AvatarIdentity = { ...defaultAvatarIdentity, face: "angular", nose: "broad", mouth: "wide", eyeShape: "round", complexion: "fair", hairColor: "blonde", hairStyle: "bun" };
    const changed = withIdentity(custom, identity);
    expect(analyzePaint(composePaint(old.strokes, input), input).alphaMass).toBeGreaterThan(0);
    const critiques = [old, custom, changed].map((look) => assess("rose-editorial", analyzePaint(composePaint(look.strokes, input), input)));
    expect(critiques[1]).toEqual(critiques[0]);
    expect(critiques[2]).toEqual(critiques[0]);
  });
});

describe("saved and shared versioned looks", () => {
  it("reads an original book without writing it, then saves mixed policies and custom identity without rewriting old entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(lookbookKey, JSON.stringify({ version: 1, entries: fixtures.map(({ json, fingerprint }, index) => ({
      id: fingerprint, title: `Legacy ${index}`, savedAt: index, thumbnail, json,
    })) }));
    const original = storage.getItem(lookbookKey);
    const old = value(readLookbook(storage));
    expect(storage.getItem(lookbookKey)).toBe(original);
    expect(old.map((entry) => encodeLook(entry.look))).toEqual(fixtures.map(({ json }) => json));
    const mixed = value(appendStroke(old[1]!.look, mark()));
    const custom = upgradePortrait(mixed);
    for (const [index, look] of [mixed, custom].entries()) {
      expect(value(saveLook(storage, { look, title: `Current ${index}`, thumbnail, savedAt: index + 2 })).alreadySaved).toBe(false);
    }
    const reopened = value(readLookbook(storage));
    expect(reopened.map((entry) => encodeLook(entry.look))).toEqual([encodeLook(custom), encodeLook(mixed), ...fixtures.map(({ json }) => json)]);
    expect(reopened.slice(2).map((entry) => entry.id)).toEqual(fixtures.map(({ fingerprint }) => fingerprint));
    expect(storage.data.size).toBe(1);
  });

  it.each(fixtures)("does not promote legacy document $version during save or share", async ({ json, fingerprint }) => {
    const old = value(decodeLookJSON(json));
    const storage = new MemoryStorage();
    expect(value(saveLook(storage, { look: old, title: "Original", thumbnail, savedAt: 1 })).entry.id).toBe(fingerprint);
    const shared = value(await decodeShare(value(await encodeShare(old))));
    expect(encodeLook(shared)).toBe(json);
    expect(lookFingerprint(shared)).toBe(fingerprint);
    expect(encodeLook(value(readLookbook(storage))[0]!.look)).toBe(json);
  });

  it("round trips every current identity choice and mixed policy through share compression", async () => {
    const identity: AvatarIdentity = value(avatarFromInput({ ...defaultAvatarIdentity, face: "soft", nose: "rounded", mouth: "full", eyeShape: "round", complexion: "brown", eyes: "hazel", hairColor: "blonde", hairStyle: "bun" }));
    const mixed = withIdentity(value(appendStroke(value(decodeLookJSON(legacyV2)), mark())), identity);
    const decoded = value(await decodeShare(value(await encodeShare(mixed))));
    expect(decoded).toEqual(mixed);
    expect(lookFingerprint(decoded)).toBe(lookFingerprint(mixed));
  });
});

