import { decodeLookJSON, encodeLook, limits, lookFingerprint } from "./look";
import type { Look, Result } from "./look";

export const lookbookKey = "make1up.lookbook.v1";
export const lookbookLimits = Object.freeze({
  entries: 8,
  storageBytes: 2_000_000,
  thumbnailCharacters: 160_000,
  shareCharacters: 20_000,
  expandedBytes: limits.jsonBytes,
});

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SavedLook = Readonly<{
  id: string;
  title: string;
  savedAt: number;
  thumbnail: string;
  look: Look;
}>;

export type SaveInput = Readonly<{
  look: Look;
  title: string;
  thumbnail: string;
  savedAt: number;
}>;

export type SaveReceipt = Readonly<{
  entry: SavedLook;
  entries: readonly SavedLook[];
  alreadySaved: boolean;
}>;

function failure(error: string): Result<never> {
  return { ok: false, error };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validThumbnail(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= lookbookLimits.thumbnailCharacters
    && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 60;
}

function validDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

export function readLookbook(storage: StoragePort): Result<readonly SavedLook[]> {
  let raw: string | null;
  try {
    raw = storage.getItem(lookbookKey);
  } catch {
    return failure("This browser blocks local storage. Your current look is safe. Use PNG download instead.");
  }
  if (raw === null) return { ok: true, value: [] };
  if (raw.length > lookbookLimits.storageBytes || new TextEncoder().encode(raw).length > lookbookLimits.storageBytes) {
    return failure("The local lookbook is too large to open safely. Your current look is unchanged.");
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return failure("The local lookbook is damaged. Nothing was replaced. Download your current look as a PNG.");
  }
  if (!object(document) || document.version !== 1 || !Array.isArray(document.entries)
    || document.entries.length > lookbookLimits.entries) {
    return failure("The local lookbook has an unsupported format. Nothing was replaced.");
  }
  const entries: SavedLook[] = [];
  const ids = new Set<string>();
  for (const rawEntry of document.entries) {
    if (!object(rawEntry) || !validTitle(rawEntry.title) || !validDate(rawEntry.savedAt)
      || !validThumbnail(rawEntry.thumbnail) || typeof rawEntry.json !== "string" || typeof rawEntry.id !== "string") {
      return failure("A saved look is damaged. Nothing was replaced. Your current look is safe.");
    }
    const decoded = decodeLookJSON(rawEntry.json);
    if (!decoded.ok) return failure(`A saved look could not be opened. ${decoded.error}`);
    if (rawEntry.id !== lookFingerprint(decoded.value) || ids.has(rawEntry.id)) {
      return failure("A saved look has a damaged content ID. Nothing was replaced.");
    }
    ids.add(rawEntry.id);
    entries.push(Object.freeze({
      id: rawEntry.id, title: rawEntry.title, savedAt: rawEntry.savedAt,
      thumbnail: rawEntry.thumbnail, look: decoded.value,
    }));
  }
  return { ok: true, value: Object.freeze(entries) };
}

function writeLookbook(storage: StoragePort, entries: readonly SavedLook[]): Result<readonly SavedLook[]> {
  const raw = JSON.stringify({
    version: 1,
    entries: entries.map((entry) => ({
      id: entry.id, title: entry.title, savedAt: entry.savedAt,
      thumbnail: entry.thumbnail, json: encodeLook(entry.look),
    })),
  });
  if (new TextEncoder().encode(raw).length > lookbookLimits.storageBytes) {
    return failure("The local lookbook is full. Remove a saved look or download a PNG. Nothing was replaced.");
  }
  try {
    storage.setItem(lookbookKey, raw);
  } catch {
    return failure("This browser could not save the look. Storage may be full or blocked. Your current look is safe. Download a PNG instead.");
  }
  return { ok: true, value: Object.freeze([...entries]) };
}

export function saveLook(storage: StoragePort, input: SaveInput): Result<SaveReceipt> {
  if (!validTitle(input.title) || !validDate(input.savedAt) || !validThumbnail(input.thumbnail)) {
    return failure("The title or thumbnail could not be saved. Your current look is unchanged.");
  }
  const existing = readLookbook(storage);
  if (!existing.ok) return existing;
  const id = lookFingerprint(input.look);
  const same = existing.value.find((entry) => entry.id === id);
  if (same !== undefined) {
    if (encodeLook(same.look) !== encodeLook(input.look)) return failure("The local content ID conflicts. Download a PNG instead.");
    return { ok: true, value: { entry: same, entries: existing.value, alreadySaved: true } };
  }
  if (existing.value.length >= lookbookLimits.entries) {
    return failure("Your lookbook has eight looks. Remove one before saving another. Your current look is safe.");
  }
  const entry: SavedLook = Object.freeze({ ...input, id, title: input.title.trim() });
  const written = writeLookbook(storage, [entry, ...existing.value]);
  return written.ok
    ? { ok: true, value: { entry, entries: written.value, alreadySaved: false } }
    : written;
}

export function removeSavedLook(storage: StoragePort, id: string): Result<readonly SavedLook[]> {
  const existing = readLookbook(storage);
  if (!existing.ok) return existing;
  return writeLookbook(storage, existing.value.filter((entry) => entry.id !== id));
}

function toBase64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64URL(value: string): Result<Uint8Array> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return failure("The share link is not valid.");
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return { ok: true, value: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
  } catch {
    return failure("The share link is not valid.");
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Result<Uint8Array>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        return failure("The share link expands beyond the safe size limit. The current look is unchanged.");
      }
      chunks.push(next.value);
    }
  } catch {
    return failure("The compressed share link is damaged. The current look is unchanged.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, value: bytes };
}

export async function encodeShare(look: Look): Promise<Result<string>> {
  const json = encodeLook(look);
  let bytes = new TextEncoder().encode(json);
  let format = "j";
  if (typeof CompressionStream !== "undefined") {
    try {
      const compressed = await readBounded(
        new Blob([json]).stream().pipeThrough(new CompressionStream("deflate")),
        lookbookLimits.expandedBytes,
      );
      if (!compressed.ok) return compressed;
      bytes = Uint8Array.from(compressed.value);
      format = "d";
    } catch {
      return failure("This browser could not create a share link. Download a PNG instead.");
    }
  }
  const fragment = `#make1up=v1.${format}.${toBase64URL(bytes)}`;
  if (fragment.length > lookbookLimits.shareCharacters) {
    return failure("This look is too detailed for a share link. Download a PNG instead.");
  }
  return { ok: true, value: fragment };
}

export async function decodeShare(fragment: string): Promise<Result<Look>> {
  if (fragment.length > lookbookLimits.shareCharacters) return failure("The share link exceeds the safe size limit.");
  const match = /^#make1up=v1\.([dj])\.([A-Za-z0-9_-]+)$/.exec(fragment);
  if (match === null || match[2] === undefined) return failure("This is not a supported MAKE1UP share link.");
  const decoded = fromBase64URL(match[2]);
  if (!decoded.ok) return decoded;
  let bytes = decoded.value;
  if (match[1] === "d") {
    if (typeof DecompressionStream === "undefined") {
      return failure("This browser cannot open compressed looks. Try a current browser or ask for a PNG.");
    }
    try {
      const input = new Blob([Uint8Array.from(bytes)]).stream();
      const expanded = await readBounded(input.pipeThrough(new DecompressionStream("deflate")), lookbookLimits.expandedBytes);
      if (!expanded.ok) return expanded;
      bytes = expanded.value;
    } catch {
      return failure("The compressed share link is damaged. The current look is unchanged.");
    }
  }
  if (bytes.length > lookbookLimits.expandedBytes) return failure("The share link expands beyond the safe size limit.");
  try {
    return decodeLookJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failure("The share link does not contain valid text.");
  }
}
