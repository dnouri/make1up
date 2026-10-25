import type { Texture } from "three";
import { avatarChoices, defaultIdentity } from "./avatar";
import type { AvatarIdentity } from "./avatar";

export type AppearanceMaps = Readonly<{ face: Texture; bust: Texture; hair: Texture; eyes: Texture }>;
export type AppearanceRequest = Readonly<{
  maps: AppearanceMaps | null;
  ready: Promise<AppearanceMaps>;
  release(): void;
}>;

type Entry = { ready: Promise<Texture>; texture: Texture | null; users: number };

export function appearanceMaps(
  embedded: AppearanceMaps,
  load: (path: string) => Promise<Texture>,
  maximum = 6,
): { request(identity: AvatarIdentity): AppearanceRequest; dispose(): void } {
  const cache = new Map<string, Entry>();
  let disposed = false;

  function trim(): void {
    for (const [path, entry] of cache) {
      if (entry.users === 0 && (cache.size > maximum || entry.texture === null)) {
        cache.delete(path);
        entry.texture?.dispose();
      }
    }
  }

  function borrow(path: string): Entry {
    const existing = cache.get(path);
    if (existing !== undefined) {
      existing.users++;
      cache.delete(path);
      cache.set(path, existing);
      return existing;
    }
    const entry: Entry = {
      texture: null, users: 1,
      ready: load(path).then((texture) => {
        if (disposed || cache.get(path) !== entry) {
          texture.dispose();
        } else {
          entry.texture = texture;
          trim();
        }
        return texture;
      }, (error: unknown) => {
        if (cache.get(path) === entry) cache.delete(path);
        throw error;
      }),
    };
    cache.set(path, entry);
    trim();
    return entry;
  }

  return {
    request(identity) {
      if (disposed) throw new Error("The portrait appearance loader is closed.");
      const skin = avatarChoices.complexion[identity.complexion];
      const selected = {
        face: identity.complexion === defaultIdentity.complexion ? embedded.face : skin.faceMap,
        bust: identity.complexion === defaultIdentity.complexion ? embedded.bust : skin.bustMap,
        hair: identity.hairColor === defaultIdentity.hairColor ? embedded.hair : avatarChoices.hairColor[identity.hairColor].map,
        eyes: identity.eyes === defaultIdentity.eyes ? embedded.eyes : avatarChoices.eyes[identity.eyes].map,
      };
      const entries = new Map<string, Entry>();
      const values = Object.values(selected).map((value) => {
        if (typeof value !== "string") return value;
        let entry = entries.get(value);
        if (entry === undefined) {
          entry = borrow(value);
          entries.set(value, entry);
        }
        return entry;
      });
      function resolved(): AppearanceMaps | null {
        const textures = values.map((value) => "users" in value ? value.texture : value);
        const [face, bust, hair, eyes] = textures;
        return face == null || bust == null || hair == null || eyes == null ? null : { face, bust, hair, eyes };
      }
      let released = false;
      return {
        maps: resolved(),
        ready: Promise.all([...entries.values()].map((entry) => entry.ready)).then(() => {
          const maps = resolved();
          if (released || disposed || maps === null) throw new Error("Portrait appearance loading stopped.");
          return maps;
        }),
        release() {
          if (released) return;
          released = true;
          for (const entry of entries.values()) entry.users--;
          trim();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of cache.values()) entry.texture?.dispose();
      cache.clear();
    },
  };
}
