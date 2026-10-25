import { describe, expect, it, vi } from "vitest";
import { Texture } from "three";
import { appearanceMaps } from "../src/appearance";
import { defaultIdentity } from "../src/avatar";

function embedded() {
  return { face: new Texture(), bust: new Texture(), hair: new Texture(), eyes: new Texture() };
}

it("uses embedded neutral maps without loading any external colors", async () => {
  const neutral = embedded();
  const load = vi.fn(async () => new Texture());
  const maps = appearanceMaps(neutral, load);
  const request = maps.request(defaultIdentity);
  expect(request.maps).toEqual(neutral);
  expect(await request.ready).toEqual(neutral);
  expect(load).not.toHaveBeenCalled();
  request.release();
  maps.dispose();
});

it("loads only the selected complexion, hair, and iris maps and shares active requests", async () => {
  const load = vi.fn(async (_path: string) => new Texture());
  const maps = appearanceMaps(embedded(), load);
  const identity = { ...defaultIdentity, complexion: "deep", hairColor: "blonde", eyes: "olive" } as const;
  const first = maps.request(identity);
  const second = maps.request(identity);
  const colors = await first.ready;
  expect(await second.ready).toEqual(colors);
  expect(load.mock.calls.map((call) => call[0])).toEqual([
    "maps/skin-deep.png", "maps/bust-deep.png", "maps/hair-blonde.png", "maps/eyes-olive.png",
  ]);
  first.release();
  first.release();
  const reused = maps.request(identity);
  expect(reused.maps).toEqual(colors);
  expect(await reused.ready).toEqual(colors);
  reused.release();
  second.release();
  maps.dispose();
});

describe("bounded external-map ownership", () => {
  it("evicts unused maps but never disposes a pinned live map", async () => {
    const loaded: Texture[] = [];
    const maps = appearanceMaps(embedded(), async () => {
      const texture = new Texture();
      vi.spyOn(texture, "dispose");
      loaded.push(texture);
      return texture;
    }, 2);
    const live = maps.request({ ...defaultIdentity, hairColor: "blonde" });
    const blonde = (await live.ready).hair;
    for (const eyes of ["hazel", "olive"] as const) {
      const request = maps.request({ ...defaultIdentity, eyes });
      await request.ready;
      request.release();
    }
    expect(loaded[1]!.dispose).toHaveBeenCalledOnce();
    expect(blonde.dispose).not.toHaveBeenCalled();
    expect(loaded[2]!.dispose).not.toHaveBeenCalled();
    live.release();
    maps.dispose();
    maps.dispose();
    for (const texture of loaded) expect(texture.dispose).toHaveBeenCalledOnce();
  });

  it("disposes abandoned pending resources when they arrive", async () => {
    let complete: (texture: Texture) => void = () => {};
    const maps = appearanceMaps(embedded(), () => new Promise((resolve) => { complete = resolve; }));
    const request = maps.request({ ...defaultIdentity, hairColor: "plum" });
    const rejected = expect(request.ready).rejects.toThrow();
    request.release();
    const texture = new Texture();
    vi.spyOn(texture, "dispose");
    complete(texture);
    await rejected;
    expect(texture.dispose).toHaveBeenCalledOnce();
    maps.dispose();
    expect(texture.dispose).toHaveBeenCalledOnce();
  });

  it("does not retain failed requests and retries the actual map", async () => {
    const texture = new Texture();
    const load = vi.fn<((path: string) => Promise<Texture>)>()
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(texture);
    const maps = appearanceMaps(embedded(), load);
    const first = maps.request({ ...defaultIdentity, hairColor: "chestnut" });
    await expect(first.ready).rejects.toThrow("offline");
    first.release();
    const retry = maps.request({ ...defaultIdentity, hairColor: "chestnut" });
    expect((await retry.ready).hair).toBe(texture);
    expect(load).toHaveBeenCalledTimes(2);
    retry.release();
    maps.dispose();
  });

  it("disposes in-flight results after the renderer closes", async () => {
    let complete: (texture: Texture) => void = () => {};
    const neutral = embedded();
    vi.spyOn(neutral.face, "dispose");
    const maps = appearanceMaps(neutral, () => new Promise((resolve) => { complete = resolve; }));
    const request = maps.request({ ...defaultIdentity, hairColor: "plum" });
    const rejected = expect(request.ready).rejects.toThrow();
    maps.dispose();
    const texture = new Texture();
    vi.spyOn(texture, "dispose");
    complete(texture);
    await rejected;
    request.release();
    expect(texture.dispose).toHaveBeenCalledOnce();
    expect(neutral.face.dispose).not.toHaveBeenCalled();
  });
});
