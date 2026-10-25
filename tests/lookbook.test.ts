import { afterEach, describe, expect, it, vi } from "vitest";
import { appendStroke, captureStroke, defaultBrush, newLook } from "../src/look";
import type { Look } from "../src/look";
import { decodeShare, encodeShare, readLookbook, removeSavedLook, saveLook } from "../src/lookbook";
import type { StoragePort } from "../src/lookbook";

const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

class MemoryStorage implements StoragePort {
  raw: string | null = null;
  blocked = false;
  getItem(): string | null { return this.raw; }
  setItem(_key: string, value: string): void {
    if (this.blocked) throw new Error("Quota exceeded");
    this.raw = value;
  }
}

function paintedLook(id = "first-cheek"): Look {
  const stroke = captureStroke(id, defaultBrush(), [[[0.25, 0.65], [0.28, 0.64]]]);
  if (!stroke.ok) throw new Error(stroke.error);
  const look = appendStroke(newLook(), stroke.value);
  if (!look.ok) throw new Error(look.error);
  return look.value;
}

function save(storage: StoragePort, look = paintedLook(), title = "My orchid look") {
  return saveLook(storage, { look, title, thumbnail, savedAt: 1_760_587_200_000 });
}

function plainFragment(json: string): string {
  const encoded = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of encoded) binary += String.fromCharCode(byte);
  return `#make1up=v1.j.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("local lookbook", () => {
  it("restores the actual brush and UV paths through a new storage reader", () => {
    const storage = new MemoryStorage();
    const saved = save(storage);
    expect(saved.ok && saved.value.alreadySaved).toBe(false);
    const reopened = new MemoryStorage();
    reopened.raw = storage.raw;
    const read = readLookbook(reopened);
    if (!read.ok) throw new Error(read.error);
    expect(read.value.map((entry) => ({ title: entry.title, savedAt: entry.savedAt, thumbnail: entry.thumbnail, look: entry.look }))).toEqual([{
      title: "My orchid look", savedAt: 1_760_587_200_000, thumbnail,
      look: {
        version: 2, asset: "rain-portrait-v2",
        identity: { face: "balanced", nose: "balanced", mouth: "balanced", eyeShape: "balanced", complexion: "warm", eyes: "blue", hairColor: "espresso", hairStyle: "ponytail" },
        strokes: [{
          id: "first-cheek",
          brush: { tool: "blush", color: "#cc5075", radius: 0.045, opacity: 0.55, softness: 0.85, finish: 0 },
          paths: [[[16384 / 65535, 42598 / 65535], [18350 / 65535, 41942 / 65535]]],
        }],
      },
    }]);
  });

  it("saving the same content twice keeps one original entry and timestamp", () => {
    const storage = new MemoryStorage();
    save(storage);
    const original = storage.raw;
    const duplicate = saveLook(storage, { look: paintedLook(), title: "A renamed duplicate", thumbnail, savedAt: 9 });
    if (!duplicate.ok) throw new Error(duplicate.error);
    expect({ duplicate: duplicate.value.alreadySaved, count: duplicate.value.entries.length, title: duplicate.value.entry.title }).toEqual({
      duplicate: true, count: 1, title: "My orchid look",
    });
    expect(storage.raw).toBe(original);
  });

  it("a blocked save keeps the previous lookbook available", () => {
    const storage = new MemoryStorage();
    save(storage);
    storage.blocked = true;
    expect(save(storage, paintedLook("second"))).toEqual({
      ok: false,
      error: "This browser could not save the look. Storage may be full or blocked. Your current look is safe. Download a PNG instead.",
    });
    const read = readLookbook(storage);
    expect(read.ok && read.value.map((entry) => entry.look.strokes[0]?.id)).toEqual(["first-cheek"]);
  });

  it("does not overwrite damaged local data when a new save is requested", () => {
    const storage = new MemoryStorage();
    storage.raw = "{broken";
    expect(save(storage)).toEqual({ ok: false, error: "The local lookbook is damaged. Nothing was replaced. Download your current look as a PNG." });
    expect(storage.raw).toBe("{broken");
    storage.raw = null;
    expect(save(storage).ok).toBe(true);
  });

  it("caps the book without silently removing older looks and can remove a chosen look", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 8; index++) expect(save(storage, paintedLook(`look-${index}`)).ok).toBe(true);
    expect(save(storage, paintedLook("look-9"))).toEqual({
      ok: false, error: "Your lookbook has eight looks. Remove one before saving another. Your current look is safe.",
    });
    const read = readLookbook(storage);
    if (!read.ok || read.value[0] === undefined) throw new Error("No saved entry");
    const removed = removeSavedLook(storage, read.value[0].id);
    expect(removed.ok && removed.value.map((entry) => entry.look.strokes[0]?.id)).toEqual([
      "look-6", "look-5", "look-4", "look-3", "look-2", "look-1", "look-0",
    ]);
    expect(save(storage, paintedLook("look-9")).ok).toBe(true);
  });

  it("rejects oversized storage before parsing and rejects forged document IDs", () => {
    const storage = new MemoryStorage();
    storage.raw = " ".repeat(2_000_001);
    expect(readLookbook(storage)).toEqual({ ok: false, error: "The local lookbook is too large to open safely. Your current look is unchanged." });
    storage.raw = null;
    save(storage);
    storage.raw = storage.raw!.replace(/rain-v2-[0-9a-f]{16}/, "rain-v2-0000000000000000");
    expect(readLookbook(storage)).toEqual({ ok: false, error: "A saved look has a damaged content ID. Nothing was replaced." });
  });

  it("does not accept an image URL or unsafe markup as a thumbnail", () => {
    const storage = new MemoryStorage();
    expect(saveLook(storage, { look: newLook(), title: "Example", thumbnail: "https://example.com/track.png", savedAt: 0 })).toEqual({
      ok: false, error: "The title or thumbnail could not be saved. Your current look is unchanged.",
    });
    expect(save(storage).ok).toBe(true);
  });
});

describe("private share fragments", () => {
  it("round trips real strokes through browser-compatible compression", async () => {
    const encoded = await encodeShare(paintedLook());
    if (!encoded.ok) throw new Error(encoded.error);
    expect(encoded.value.slice(0, 14)).toBe("#make1up=v1.d.");
    const decoded = await decodeShare(encoded.value);
    expect(decoded.ok && decoded.value.strokes.map((stroke) => ({ id: stroke.id, color: stroke.brush.color, points: stroke.paths[0] }))).toEqual([{
      id: "first-cheek", color: "#cc5075", points: [[16384 / 65535, 42598 / 65535], [18350 / 65535, 41942 / 65535]],
    }]);
  });

  it("uses a bounded uncompressed fallback when compression is unavailable", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const encoded = await encodeShare(newLook());
    if (!encoded.ok) throw new Error(encoded.error);
    expect(encoded.value.slice(0, 14)).toBe("#make1up=v1.j.");
    const decoded = await decodeShare(encoded.value);
    expect(decoded.ok && decoded.value).toEqual({
      version: 2, asset: "rain-portrait-v2",
      identity: { face: "balanced", nose: "balanced", mouth: "balanced", eyeShape: "balanced", complexion: "warm", eyes: "blue", hairColor: "espresso", hairStyle: "ponytail" },
      strokes: [],
    });
  });

  it("sends untrusted decoded JSON through the core validation gate", async () => {
    expect(await decodeShare(plainFragment('{"version":99}'))).toEqual({ ok: false, error: "This look has an unknown version or portrait asset." });
    expect(await decodeShare("#make1up=v1.d.eA")).toEqual({ ok: false, error: "The compressed share link is damaged. The current look is unchanged." });
    expect(await decodeShare("#unrelated")).toEqual({ ok: false, error: "This is not a supported MAKE1UP share link." });
  });

  it("stops a compression bomb at the expanded byte limit", async () => {
    const compressed = await new Response(new Blob([" ".repeat(1_000_001)]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(compressed)) binary += String.fromCharCode(byte);
    const fragment = `#make1up=v1.d.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    expect(await decodeShare(fragment)).toEqual({ ok: false, error: "The share link expands beyond the safe size limit. The current look is unchanged." });
  });

  it("rejects an overlong incoming link before decoding", async () => {
    expect(await decodeShare(`#make1up=v1.j.${"a".repeat(20_000)}`)).toEqual({ ok: false, error: "The share link exceeds the safe size limit." });
  });

  it("explains compressed-link support instead of replacing the look", async () => {
    const encoded = await encodeShare(newLook());
    if (!encoded.ok) throw new Error(encoded.error);
    vi.stubGlobal("DecompressionStream", undefined);
    expect(await decodeShare(encoded.value)).toEqual({ ok: false, error: "This browser cannot open compressed looks. Try a current browser or ask for a PNG." });
  });
});
