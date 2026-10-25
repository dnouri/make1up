import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mesh, MeshStandardMaterial, Texture } from "three";
import { avatarChoices, defaultIdentity } from "../src/avatar";
import { appendStroke, captureStroke, defaultBrush, newLook, withIdentity } from "../src/look";
import type { Look } from "../src/look";
import { mountPortrait } from "../src/portrait";
import type { AppearanceAvailability, Portrait } from "../src/portrait";
import { createSession, presentSession, step } from "../src/session";
import type { Action, Session } from "../src/session";

const graphics = vi.hoisted(() => ({
  meshes: new Map<string, Mesh>(),
  pending: new Map<string, { resolve(texture: Texture): void; reject(error: Error): void }>(),
  renders: [] as { skin: string; hair: string; pose: number[]; bun: boolean }[],
  refits: [] as number[][],
  drawError: false,
}));

vi.mock("../src/picking", () => ({ indexPortrait: () => Object.assign(() => {}, {
  refit() { graphics.refits.push([...(graphics.meshes.get("Face")!.morphTargetInfluences ?? [])]); },
}) }));
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  return {
    ...three,
    TextureLoader: class {
      loadAsync(url: string) {
        return new Promise<Texture>((resolve, reject) => graphics.pending.set(url.split("/face/v2/")[1]!, { resolve, reject }));
      }
    },
    PMREMGenerator: class {
      fromScene() { return { texture: new three.Texture(), dispose() {} }; }
      dispose() {}
    },
    WebGLRenderer: class {
      capabilities = { getMaxAnisotropy: () => 1 };
      extensions = { has: () => false };
      ratio = 1;
      setClearColor() {}
      setPixelRatio(ratio: number) { this.ratio = ratio; }
      getPixelRatio() { return this.ratio; }
      getSize(target: import("three").Vector2) { return target.set(1000, 1000); }
      setSize() {}
      compile() {}
      render() {
        const face = graphics.meshes.get("Face")!;
        graphics.renders.push({
          skin: (face.material as MeshStandardMaterial).map!.name,
          hair: (graphics.meshes.get("Hair")!.material as MeshStandardMaterial).map!.name,
          pose: [...face.morphTargetInfluences!], bun: graphics.meshes.get("HairBun")!.visible,
        });
      }
      dispose() {}
    },
  };
});
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const three = await import("three");
  return { GLTFLoader: class {
    async loadAsync() {
      const scene = new three.Group();
      const names = ["Face", "Bust", "Brows", "Lashes", "Eye.L", "Eye.R", "Hair", "HairSweep", "HairTail", "HairTie", "HairBun", "BunBand"];
      for (const name of names) {
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("position", new three.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
        geometry.setAttribute("uv1", new three.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        const targets = name === "Face" ? ["mouth-wide", "face-angular", "eyes-round", "nose-rounded", "face-soft", "mouth-full", "nose-broad"]
          : name === "Lashes" ? ["eyes-round"] : [];
        geometry.morphAttributes.position = targets.map((target) => {
          const attribute = new three.Float32BufferAttribute(new Float32Array(9), 3);
          attribute.name = target;
          return attribute;
        });
        const map = new three.Texture();
        map.name = `embedded-${name}`;
        const material = new three.MeshStandardMaterial(["HairTie", "BunBand", "Brows", "Lashes"].includes(name) ? { color: 0x212121 } : { map });
        const mesh = new three.Mesh(geometry, material);
        mesh.name = name;
        graphics.meshes.set(name, mesh);
        scene.add(mesh);
      }
      return { scene };
    }
  } };
});
vi.mock("three/addons/environments/RoomEnvironment.js", async () => {
  const { Group } = await import("three");
  return { RoomEnvironment: class extends Group { dispose() {} } };
});

class Canvas extends EventTarget {
  style = { cursor: "", touchAction: "" };
  captures = new Set<number>();
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 }; }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  setPointerCapture(id: number) { this.captures.add(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  pointer(type: string) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, isPrimary: true, button: 0, clientX: 500, clientY: 500, pointerType: "mouse",
    }));
  }
}
const mounted: Portrait[] = [];

beforeEach(() => {
  graphics.meshes.clear();
  graphics.pending.clear();
  graphics.renders.length = 0;
  graphics.refits.length = 0;
  graphics.drawError = false;
  const pixels = new Uint8ClampedArray(1024 * 1024 * 4).fill(255);
  vi.stubGlobal("document", Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({
      toBlob: (callback: BlobCallback) => callback(new Blob(["PNG"], { type: "image/png" })),
      getContext: () => ({
        drawImage() { if (graphics.drawError) throw new Error("draw failed"); },
        getImageData: () => ({ data: pixels }),
        createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
      }),
    }),
  }));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: true }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", async () => ({ ok: true, blob: async () => new Blob() }));
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1024, height: 1024, close() {} }));
});
afterEach(() => {
  for (const portrait of mounted) portrait.dispose();
  mounted.length = 0;
  vi.unstubAllGlobals();
});

async function studio() {
  let session: Session = createSession();
  const canvas = new Canvas();
  const states: AppearanceAvailability[] = [];
  const portrait = await mountPortrait(canvas as unknown as HTMLCanvasElement, (stroke) => dispatch({ type: "stroke", stroke }), () => {}, (state) => states.push(state));
  mounted.push(portrait);
  function dispatch(action: Action) { session = step(session, action); portrait.present(presentSession(session)); }
  portrait.present(presentSession(session));
  return { portrait, canvas, states, dispatch, get look() { return presentSession(session).look; } };
}

async function complete(path: string) {
  const { Texture } = await import("three");
  const pending = graphics.pending.get(path);
  if (pending === undefined) throw new Error(`No request for ${path}`);
  graphics.pending.delete(path);
  const texture = new Texture();
  texture.name = path;
  vi.spyOn(texture, "dispose");
  pending.resolve(texture);
  return texture;
}

function influence(mesh: string, target: string): number {
  const object = graphics.meshes.get(mesh)!;
  return object.morphTargetInfluences![object.morphTargetDictionary![target]!]!;
}
function material(mesh: string): MeshStandardMaterial { return graphics.meshes.get(mesh)!.material as MeshStandardMaterial; }

it("applies semantic targets, fits lashes, selects hairstyle components, and resets the entire pose", async () => {
  const app = await studio();
  const fabric = material("BunBand").color.clone();
  const lashes = material("Lashes").color.clone();
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, face: "soft", nose: "broad", mouth: "full", eyeShape: "round", hairStyle: "bun" } });
  expect([influence("Face", "face-soft"), influence("Face", "nose-broad"), influence("Face", "mouth-full"), influence("Face", "eyes-round"), influence("Lashes", "eyes-round")]).toEqual([1, 1, 1, 1, 1]);
  expect(influence("Face", "face-angular")).toBe(0);
  expect([graphics.meshes.get("HairBun")!.visible, graphics.meshes.get("BunBand")!.visible, graphics.meshes.get("HairTail")!.visible, graphics.meshes.get("HairTie")!.visible]).toEqual([true, true, false, false]);
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, face: "angular", mouth: "wide" } });
  expect([influence("Face", "face-soft"), influence("Face", "nose-broad"), influence("Face", "mouth-full"), influence("Lashes", "eyes-round")]).toEqual([0, 0, 0, 0]);
  expect([influence("Face", "face-angular"), influence("Face", "mouth-wide")]).toEqual([1, 1]);
  expect(graphics.refits.at(-1)).toEqual(graphics.meshes.get("Face")!.morphTargetInfluences);
  expect(material("BunBand").color).toEqual(fabric);
  expect(material("Lashes").color).toEqual(lashes);
});

it("blocks pointer and guided painting, analysis, and export while selected resources are pending", async () => {
  const app = await studio();
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, complexion: "fair" } });
  expect(app.portrait.availability.kind).toBe("loading");
  const captured = captureStroke("paint", defaultBrush("lipstick"), [[[0.5, 0.5]]]);
  if (!captured.ok) throw new Error(captured.error);
  expect(app.portrait.applyStroke(captured.value)).toBe(false);
  expect(() => app.portrait.analyze()).toThrow();
  await expect(app.portrait.capture(app.look)).rejects.toThrow();
  app.canvas.pointer("pointerdown");
  app.canvas.pointer("pointerup");
  expect(app.canvas.captures.size).toBe(0);
  expect(app.look.strokes).toEqual([]);
  await complete("maps/skin-fair.png");
  expect(app.portrait.availability.kind).toBe("loading");
  await complete("maps/bust-fair.png");
  await vi.waitFor(() => expect(app.portrait.availability.kind).toBe("ready"));
  expect(app.portrait.applyStroke(captured.value)).toBe(true);
  expect(app.look.strokes).toHaveLength(1);
});

it("ignores late selections after a newer complexion and after Undo", async () => {
  const app = await studio();
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, complexion: "fair" } });
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, complexion: "deep" } });
  await complete("maps/skin-deep.png");
  await complete("maps/bust-deep.png");
  await vi.waitFor(() => expect(app.portrait.availability.kind).toBe("ready"));
  const discarded = [await complete("maps/skin-fair.png"), await complete("maps/bust-fair.png")];
  await vi.waitFor(() => expect(discarded[0]!.dispose).toHaveBeenCalledOnce());
  expect(material("Face").map!.name).toBe("maps/skin-deep.png");
  app.dispatch({ type: "identity", identity: { ...app.look.identity, hairColor: "blonde" } });
  app.dispatch({ type: "undo" });
  expect(app.portrait.availability.kind).toBe("ready");
  const blonde = await complete("maps/hair-blonde.png");
  await vi.waitFor(() => expect(blonde.dispose).toHaveBeenCalledOnce());
  expect(material("Hair").map!.name).toBe("embedded-Hair");
  expect(material("Face").map!.name).toBe("maps/skin-deep.png");
});

it("offers a fresh resource request after failure without changing the requested identity", async () => {
  const app = await studio();
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, hairColor: "blonde" } });
  graphics.pending.get("maps/hair-blonde.png")!.reject(new Error("offline"));
  graphics.pending.delete("maps/hair-blonde.png");
  await vi.waitFor(() => expect(app.portrait.availability.kind).toBe("error"));
  expect(material("Hair").map!.name).toBe("embedded-Hair");
  app.portrait.retryAppearance();
  expect(app.portrait.availability.kind).toBe("loading");
  await complete("maps/hair-blonde.png");
  await vi.waitFor(() => expect(app.portrait.availability.kind).toBe("ready"));
  expect(app.look.identity.hairColor).toBe("blonde");
  expect(material("Hair").map!.name).toBe("maps/hair-blonde.png");
  expect(material("Brows").color.toArray()).toEqual(avatarChoices.hairColor.blonde.browLinear);
});

it("resolves captured resources before scene mutation and restores the latest live pose and picking", async () => {
  const app = await studio();
  const captured = withIdentity(newLook(), { ...defaultIdentity, face: "angular", nose: "rounded", mouth: "full", eyeShape: "round", hairColor: "blonde" });
  const exportJob = app.portrait.capture(captured);
  expect(material("Hair").map!.name).toBe("embedded-Hair");
  app.dispatch({ type: "identity", identity: { ...defaultIdentity, face: "soft", hairStyle: "bun" } });
  await complete("maps/hair-blonde.png");
  expect((await exportJob).type).toBe("image/png");
  const [rendered, restored] = graphics.renders.slice(-2);
  expect(rendered!.hair).toBe("maps/hair-blonde.png");
  expect(rendered!.bun).toBe(false);
  expect(restored!.hair).toBe("embedded-Hair");
  expect(restored!.bun).toBe(true);
  expect(influence("Face", "face-soft")).toBe(1);
  expect(influence("Face", "face-angular")).toBe(0);
  expect(influence("Lashes", "eyes-round")).toBe(0);
  expect(graphics.refits.at(-1)).toEqual(restored!.pose);
  expect(app.portrait.availability.kind).toBe("ready");
  expect(graphics.pending.size).toBe(0);
});

it("restores live paint and picking even when image capture throws", async () => {
  const app = await studio();
  const stroke = captureStroke("lip", defaultBrush("lipstick"), [[[0.5, 0.5]]]);
  if (!stroke.ok) throw new Error(stroke.error);
  const painted = appendStroke(withIdentity(newLook(), { ...defaultIdentity, mouth: "wide" }), stroke.value);
  if (!painted.ok) throw new Error(painted.error);
  app.dispatch({ type: "load", look: painted.value });
  const before = app.portrait.analyze();
  graphics.drawError = true;
  const target: Look = withIdentity(newLook(), { ...defaultIdentity, face: "angular", eyeShape: "round" });
  await expect(app.portrait.capture(target)).rejects.toThrow("draw failed");
  expect(app.portrait.analyze()).toBe(before);
  expect(influence("Face", "mouth-wide")).toBe(1);
  expect(influence("Lashes", "eyes-round")).toBe(0);
  expect(graphics.refits.at(-1)).toEqual(graphics.meshes.get("Face")!.morphTargetInfluences);
  expect(graphics.pending.size).toBe(0);
});
