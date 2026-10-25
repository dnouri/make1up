import { describe, expect, it } from "vitest";
import registry from "../art/avatar-v2.json";
import { avatarCatalog, avatarFields, defaultIdentity, identityFromInput } from "../src/avatar";
import {
  appendStroke, captureStroke, clearMakeup, decodeLook, decodeLookJSON, defaultBrush,
  encodeLook, lookFingerprint, newLook, toolRegion, tools, withIdentity,
} from "../src/look";
import type { Result, Stroke, ToolId } from "../src/look";
import { composePaint, createPaintMasks, analyzePaint, assess, strokeChanges } from "../src/paint";
import { decodeShare, encodeShare, lookbookKey, readLookbook, removeSavedLook, saveLook } from "../src/lookbook";
import type { StoragePort } from "../src/lookbook";
import { createSession, presentSession, step } from "../src/session";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function mark(id = "paint", tool: ToolId = "blush"): Stroke {
  return value(captureStroke(id, { ...defaultBrush(tool), radius: 0.06, opacity: 1, softness: 0 }, [[[0.5, 0.27]]]));
}

class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  getItem(key: string) { this.reads.push(key); return this.data.get(key) ?? null; }
  setItem(key: string, raw: string) { this.writes.push(key); this.data.set(key, raw); }
}
const thumbnail = "data:image/png;base64,iVBORw0KGgo=";

it("starts every fresh document with the neutral registry identity", () => {
  expect(newLook()).toEqual({ version: 2, asset: "rain-portrait-v2", identity: registry.defaults, strokes: [] });
  expect(Object.isFrozen(defaultIdentity)).toBe(true);
  const changed = withIdentity(newLook(), { ...defaultIdentity, mouth: "full" });
  expect(newLook().identity.mouth).toBe("balanced");
  expect(changed.identity.mouth).toBe("full");
});

describe("each approved identity choice", () => {
  for (const field of avatarFields) for (const id of Object.keys(avatarCatalog[field])) {
    it(`validates, saves, restores, and shares ${field} ${id}`, async () => {
      const identity = value(identityFromInput({ ...defaultIdentity, [field]: id }));
      expect(identity[field]).toBe(id);
      const look = withIdentity(value(appendStroke(newLook(), mark())), identity);
      expect(value(decodeLookJSON(encodeLook(look)))).toEqual(look);
      expect(value(await decodeShare(value(await encodeShare(look))))).toEqual(look);
      const storage = new MemoryStorage();
      value(saveLook(storage, { look, title: "Portrait", thumbnail, savedAt: 1 }));
      expect(value(readLookbook(storage))[0]!.look).toEqual(look);
      expect(lookFingerprint(value(readLookbook(storage))[0]!.look)).toBe(lookFingerprint(look));
    });
  }
});

it("rejects missing or unknown identity fields and recipes", () => {
  for (const field of avatarFields) {
    const raw: Record<string, unknown> = { ...defaultIdentity };
    delete raw[field];
    expect(identityFromInput(raw).ok).toBe(false);
    for (const invalid of ["unknown", null, 1, {}, ["balanced"]]) {
      expect(identityFromInput({ ...defaultIdentity, [field]: invalid }).ok).toBe(false);
    }
  }
  for (const extra of [{ kind: "custom" }, { morphs: {} }, { geometry: "neutral-rain" }]) {
    expect(identityFromInput({ ...defaultIdentity, ...extra }).ok).toBe(false);
  }
});

it("accepts only the exact current document and stroke fields", () => {
  const look = value(appendStroke(newLook(), mark()));
  for (const version of [0, 1, 3, 99, "2"]) expect(decodeLook({ ...look, version }).ok).toBe(false);
  for (const asset of ["rain-portrait-v1", "unknown", null]) expect(decodeLook({ ...look, asset }).ok).toBe(false);
  for (const raw of [
    { ...look, extra: true }, { ...look, strokes: null }, { ...look, identity: null },
    { ...look, strokes: [{ ...mark(), policy: "face-v2" }] },
    { ...look, strokes: [{ ...mark(), extra: "cannot discard" }] },
    { ...look, strokes: [{ ...mark(), brush: { ...mark().brush, mirror: true } }] },
    { ...look, strokes: [{ ...mark(), algorithm: "soften-v1" }] },
    { ...look, strokes: [{ ...mark("blend", "blend"), algorithm: undefined }] },
  ]) expect(decodeLook(raw).ok).toBe(false);
});

it("keeps no-op edits out of history and restores identity and paint together", () => {
  const look = value(appendStroke(newLook(), mark()));
  expect(withIdentity(look, { ...look.identity })).toBe(look);
  expect(clearMakeup(newLook()).strokes).toEqual([]);
  const session = createSession(look);
  expect(step(session, { type: "identity", identity: { ...look.identity } })).toBe(session);
  const edited = step(session, { type: "identity", identity: { ...look.identity, hairStyle: "bun", face: "soft" } });
  expect(presentSession(edited).look.strokes).toBe(look.strokes);
  expect(presentSession(step(edited, { type: "undo" })).look).toBe(look);
  expect(presentSession(step(step(edited, { type: "undo" }), { type: "redo" })).look).toEqual(presentSession(edited).look);
});

it("ignores the old storage key without reading, migrating, or clearing it", () => {
  const storage = new MemoryStorage();
  storage.data.set("make1up.lookbook.v1", "old bytes, deliberately not a supported book");
  expect(value(readLookbook(storage))).toEqual([]);
  const saved = value(saveLook(storage, { look: newLook(), title: "Fresh", thumbnail, savedAt: 1 }));
  expect(value(readLookbook(storage))).toHaveLength(1);
  value(removeSavedLook(storage, saved.entry.id));
  expect(storage.data.get("make1up.lookbook.v1")).toBe("old bytes, deliberately not a supported book");
  expect(new Set([...storage.reads, ...storage.writes])).toEqual(new Set(["make1up.lookbook.v2"]));
  expect(lookbookKey).toBe("make1up.lookbook.v2");
});

it("paints the face except lipstick and scores independently of appearance", () => {
  const size = 64;
  const all = new Uint8Array(size * size).fill(255);
  const zero = new Uint8Array(size * size);
  const masks = value(createPaintMasks({ size, valid: all, lips: zero, cheeks: zero, lids: zero }));
  const base = composePaint([mark("base", "liner")], masks);
  for (const tool of Object.keys(tools) as ToolId[]) {
    expect(toolRegion(tool)).toBe(tool === "lipstick" ? "lips" : "valid");
    const field = tool === "erase" || tool === "blend" ? base : composePaint([], masks);
    expect(strokeChanges(field, mark(tool, tool), masks)).toBe(tool !== "lipstick");
  }
  const look = value(appendStroke(newLook(), mark()));
  const changed = withIdentity(look, { ...defaultIdentity, face: "angular", nose: "broad", mouth: "full", eyeShape: "round", complexion: "deep", hairColor: "blonde", hairStyle: "bun" });
  expect(assess("rose-editorial", analyzePaint(composePaint(changed.strokes, masks), masks)))
    .toEqual(assess("rose-editorial", analyzePaint(composePaint(look.strokes, masks), masks)));
});
