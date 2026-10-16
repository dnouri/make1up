# Phase 1 core contract

This document records the original phase 1 handoff. The app and portrait now exist. The current Portrait API also has `applyStroke(stroke: Stroke): boolean`. Both direct painting and Guided apply use this admission command. It emits a completed gesture only when exact pigment or finish bytes change, and returns true only when the reducer records that gesture. See `docs/architecture.md` and the current source for the refined contract.

The verification status below is historical phase 1 evidence, not the final test count.

## Verification status

VERIFIED on 2026-10-16 with Node 24.9.0 and npm 11.6.0.

- `npm install` completes and writes `package-lock.json`.
- `npm test` passes 39 tests in two files.
- `npm run typecheck` passes for the current core, tests, and Vite configuration.
- `npm audit` reports zero known vulnerabilities.

NOT VERIFIED. A production app build, actual portrait rendering, pointer input, mobile behavior, and PNG capture still need the next wave. The core tests use explicit synthetic masks. They do not prove the supplied PNG masks or the real Three.js material.

`npm run verify` runs the unit tests and type checker, then fails with an explicit pending-browser message. Replace `verify:browser` with the real Playwright workflow when it exists. `@playwright/test` is installed. `npm run build` already means `tsc --noEmit && vite build`. The app entry point is not present in this phase. `npm run dev` binds only `127.0.0.1:5173` and refuses a different port.

## Document and input boundaries

`src/look.ts` exports the following types.

```ts
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export type HexColor = `#${string}`;
export type UV = readonly [u: number, v: number];
export type StrokePath = readonly [UV, ...UV[]];
export type StrokeBrush = Omit<Brush, "mirror">;
export type Brush = Readonly<{
  tool: ToolId;
  color: HexColor;
  radius: number;
  opacity: number;
  softness: number;
  finish: number;
  mirror: boolean;
}>;
export type Stroke = Readonly<{
  id: string;
  brush: StrokeBrush;
  paths: readonly [StrokePath, ...StrokePath[]];
}>;
export type Identity = Readonly<{
  geometry: keyof typeof catalog.geometry;
  eyes: keyof typeof catalog.eyes;
  complexion: keyof typeof catalog.complexions;
  hairColor: keyof typeof catalog.hairColors;
  hairStyle: keyof typeof catalog.hairStyles;
}>;
export type Look = Readonly<{
  version: 1;
  asset: "rain-portrait-v1";
  identity: Identity;
  strokes: readonly Stroke[];
}>;
```

The public functions have these signatures.

```ts
newLook(identity?: Identity): Look;
defaultBrush(tool?: ToolId): Brush;
identityFromInput(raw: unknown): Result<Identity>;
brushFromInput(raw: unknown): Result<Brush>;
captureStroke(id: unknown, rawBrush: unknown, rawPaths: unknown): Result<Stroke>;
appendStroke(look: Look, stroke: Stroke): Result<Look>;
withIdentity(look: Look, identity: Identity): Look;
clearMakeup(look: Look): Look;
decodeLook(raw: unknown): Result<Look>;
decodeLookJSON(json: string): Result<Look>;
encodeLook(look: Look): string;
lookFingerprint(look: Look): string;
```

Use `decodeLookJSON` for every persisted JSON string, including decoded share content. It checks UTF-8 bytes before parsing. `decodeLook` validates an already parsed, size-bounded object. Never cast stored data to `Look`.

`captureStroke` is the pointer-input boundary. It copies settings and paths, quantizes UVs to 16-bit fractions, and freezes its result recursively. Mirror is a current interaction preference, not a persisted brush operation. The portrait supplies independent original and reflected paths. It must not connect these paths across the face. A missed hit also ends a path.

The limits are one million JSON bytes, 160 completed gestures, eight paths per gesture, 512 points per gesture, and 8,192 points per look. Stroke IDs use one to 64 ASCII letters, digits, underscores, or hyphens. Radius is a normalized UV radius between 0.003 and 0.08. Opacity, softness, and finish are finite values between zero and one. Colors are six-digit hex RGB. Capture and decode reject invalid values rather than clamp them.

`encodeLook` orders fields consistently. `lookFingerprint` hashes that canonical JSON with 64-bit FNV-1a and returns a `rain-v1-` key. It identifies document content for local saves and tests. It is not a security hash, signature, or proof of unique visual output. Gesture IDs are part of document content.

## Registries and actual appearance options

The literal `tools`, `regions`, `palette`, `catalog`, and `themes` objects are authoritative. `ToolId`, `Region`, `PaletteId`, and `ThemeId` derive from their keys. The UI must read these objects rather than create a second list.

Tools are `blush`, `shadow`, `lipstick`, `liner`, `sparkle`, `erase`, and `blend`. Each definition owns its label, operation, region, tip, placement mode, and defaults. Old strokes retain their captured settings when the current brush changes. Sparkle makes hard-edged five-point stamps at captured points. Its softness value has no effect. Continuous tools interpolate within each path. One gesture uses maximum tip coverage before compositing, so repeated points in that gesture do not add opacity.

There is one neutral Rain geometry. The supplied eye maps are blue, hazel, and olive. There are no morph targets, expressions, alternate sculpts, or generated identities.

The source complexion, espresso hair, and fitted ponytail are marked `asset-supported`. Candidate complexion tints, hair color tints, and hair visibility variants are marked `needs-browser-check`. These candidates are typed and persistable, but they are not verified UI choices. The next wave must inspect them under the same light before it exposes them. Complexion and hair values multiply the existing maps. They do not claim a new skin texture, hair mesh, or face geometry. Apply a complexion tint consistently to Face and Bust. Do not alter authored freckles or bake makeup into the skin.

Each hair style names actual GLB meshes to show. All other hair meshes in that set are hidden. The `short` key means that the tail is hidden. It does not name a new haircut asset. Keep brows and lashes separate from these hair visibility choices.

## Paint field and analysis

`src/paint.ts` has no DOM or Three.js imports. It exports these types and functions.

```ts
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

createPaintMasks(input: PaintMasks): Result<PaintMasks>;
composePaint(strokes: readonly Stroke[], masks: PaintMasks): PaintField;
paintStroke(field: PaintField, stroke: Stroke, masks: PaintMasks): PaintField;
analyzePaint(field: PaintField, masks: PaintMasks): PaintAnalysis;
assess(themeId: ThemeId, analysis: PaintAnalysis): Critique;
```

`createPaintMasks` accepts a square size from 16 to 1024 and copies exactly `size * size` samples per mask. Use the native 1024 size for the asset. Sample PNG red channels without color conversion. Combine the two cheek masks with per-pixel maximum into `cheeks`. Combine the two lid masks the same way into `lids`.

`composePaint` replays the immutable stroke list. `paintStroke` returns a new field after one completed or draft gesture and uses the same kernel. It does not mutate its input field. The renderer can cache the committed prefix and apply a draft with this function. It must recompose after undo, erase of a prior history branch, clear, or a different loaded document. No per-history-item pixel buffers are required.

The field has straight-alpha sRGB pigment bytes and a separate straight finish byte per pixel. Upload pigment with `SRGBColorSpace` and finish with `NoColorSpace`. Both textures use `flipY=false`. Finish zero means matte. Finish 255 means maximum gloss. Use alpha to interpolate the base material's roughness toward the desired painted finish. A bright color alone is not gloss.

Valid and regional mask strengths multiply tip coverage. The outer three pixels remain transparent even if the supplied masks are nonzero there. Erase decreases makeup alpha and removes finish with the paint. It never reads or paints a skin color. Blend uses a nine-tap weighted blur of premultiplied existing pigment, alpha, and finish. Its sample offset is 18% of brush radius in pixels, rounded and limited to one through eight pixels. Blend cannot add pigment to a blank field.

Paint buffers and sampled mask buffers belong to their consumer. Their object properties are readonly, but JavaScript typed arrays cannot be frozen. Do not mutate these buffers or reuse them as scratch memory.

Analysis reads only the final field and masks. Coverage is alpha mass divided by mask area for each semantic region. Soft semantic masks weight both area and mass. `alphaMass` is equivalent opaque-pixel mass weighted by the valid mask. Palette shares divide valid-weighted alpha mass among the nearest registered RGB colors. RGB Euclidean distance must be less than 96. Other colors go into `other`. Gloss share is alpha-weighted finish divided by 255. An empty region or field produces zero, never NaN.

`Critique` contains `label`, `theme`, `rulesVersion`, `total`, `outOf`, and per-rule `evidence`. Each evidence entry has `id`, `label`, `measured`, `target`, `earned`, `possible`, and `reason`. The label is `Solo brief match`. It is not a beauty score or human vote.

The three themes publish all rule ranges, palette IDs, and points in `themes`. Rules award their listed points only when the final measure meets the target. Every theme requires at least 0.5% valid-face alpha coverage before any rule can earn points. A blank or fully erased field scores zero, including the matte-finish rule. There is no identity input to `assess`. The public reference baseline is [the reference rubric](research/game-reference.md).

## Session and submission

`src/session.ts` exports these principal types.

```ts
export type Mode =
  | Readonly<{ kind: "practice" }>
  | Readonly<{ kind: "challenge"; theme: ThemeId; deadline: number | null }>;
export type Framing = "face" | "eyes" | "lips";
export type Navigation = "paint" | "turn";
export type History = Readonly<{
  past: readonly Look[];
  current: Look;
  future: readonly Look[];
}>;
export type Submission = Readonly<{
  id: string;
  look: Look;
  outcome:
    | Readonly<{ kind: "practice" }>
    | Readonly<{ kind: "challenge"; critique: Critique }>;
}>;
export type Session = EditingSession
  | Readonly<{ phase: "reveal"; submission: Submission }>
  | Readonly<{ phase: "result"; submission: Submission }>;
```

`EditingSession` has `phase: "editing"`, `mode`, `history`, `brush`, `navigation`, `framing`, and `notice`. The public functions are `createSession(look?, mode?): EditingSession`, `step(session, action): Session`, and `presentSession(session): PortraitPresentation`.

Actions are `start`, `stroke`, `identity`, `load`, `brush`, `navigate`, `frame`, `undo`, `redo`, `clearConfirmed`, `dismissNotice`, `inputRejected`, `finish`, and `revealComplete`. The exact payload union is exported as `Action`. An accepted gesture, identity change, load, or clear is one undo transaction. Both history directions are bounded to 50 snapshots. A new edit drops the redo branch. Clear retains appearance choices and is undoable. Brush and camera controls do not add history items. A duplicate stroke ID produces a notice instead of a second edit.

`finish` has `{ type: "finish", id: string, analysis: PaintAnalysis }`. The reducer selects the active challenge theme and calls `assess`. The app does not supply a mutable score or a second copy of the look. Practice creates an outcome without a score. The submission references the frozen current document. Later finish or edit actions in reveal and result do nothing. `revealComplete` changes reveal to result only when its ID matches the submission. `start` creates a new editing session from any phase.

Practice has no clock. A challenge can store an absolute deadline or `null`. The reducer does not read wall time or run timers. The app owns one cancellable timer and dispatches the same finish action when it expires. Cancel old timers on `start`. The app must not claim an automatic clock until that path is browser-tested.

## Frozen portrait interface for the next wave

The portrait owner implements this exact interface in `src/portrait.ts`. These declarations below are a contract, not an existing implementation.

```ts
import type { Look, Stroke } from "./look";
import type { PaintAnalysis } from "./paint";
import type { PortraitPresentation } from "./session";

export interface Portrait {
  present(presentation: PortraitPresentation): void;
  analyze(): PaintAnalysis;
  capture(look: Look): Promise<Blob>;
  zoom(direction: "in" | "out"): void;
  dispose(): void;
}

export function mountPortrait(
  canvas: HTMLCanvasElement,
  onStroke: (stroke: Stroke) => void,
  onError: (message: string) => void,
): Promise<Portrait>;
```

`PortraitPresentation` is already exported by `src/session.ts`. It is `{ look, brush, navigation, framing, readonly }`, all readonly. `presentSession` projects this object without exposing undo stacks. Reveal and result present the submitted look with painting disabled and face framing.

The portrait owns one render loop, loading, textures, masks, raycasts, brush preview, camera, draft lifecycle, and capture. The app never coordinates these internals. `mountPortrait` rejects on a fatal mount failure. `onError` reports recoverable input or render errors. `dispose` is safe to call twice.

`present` adopts the supplied snapshot synchronously. Its logical committed field must be current before `analyze` can return. `analyze` excludes any uncommitted pointer draft. A manual finish or timer expiry therefore preserves all completed gestures and discards an unfinished gesture. `present` cancels a draft if painting becomes readonly, the document changes, or navigation or framing invalidates the gesture. A brush change cannot rewrite that gesture's captured settings.

`onStroke` emits exactly one validated `Stroke` per completed gesture. Pointer cancellation emits no stroke. Use `captureStroke` and report any rejection. Mirror uses a local-X reflection and another raycast, not a global UV reflection. Accept only a nearest visible hit on `Face`. Use the interpolated `uv1` attribute. Keep the portrait still during painting.

`capture` uses the requested frozen look and the same materials, masks, light, and compositing code as the editor. It returns an `image/png` Blob. It restores the live presentation internally even on failure. The app only downloads or saves the Blob. Capture must not mutate Session, add a stroke, or leak a second render loop.

The UV origin is top left. Set paint and mask textures to `flipY=false`. Follow [the face asset handoff](../public/face/HANDOFF.md) for color spaces, exact mesh names, framing, supported view angles, credits, and the reserved border.

## App use example

The following code belongs to the future app, not to the core.

```ts
import { newLook } from "./look";
import { createSession, presentSession, step } from "./session";
import type { Action, Session } from "./session";
import { mountPortrait } from "./portrait";
import type { Portrait } from "./portrait";

let session: Session = createSession(newLook(), {
  kind: "challenge", theme: "orchid-hour", deadline: null,
});
let portrait: Portrait | null = null;
portrait = await mountPortrait(
  canvas,
  (stroke) => dispatch({ type: "stroke", stroke }),
  (message) => dispatch({ type: "inputRejected", message }),
);

function dispatch(action: Action): void {
  session = step(session, action);
  portrait?.present(presentSession(session));
  renderControls(session);
}

portrait.present(presentSession(session));

function finish(): void {
  if (portrait === null) return;
  dispatch({
    type: "finish", id: crypto.randomUUID(), analysis: portrait.analyze(),
  });
}

function endReveal(submissionId: string): void {
  dispatch({ type: "revealComplete", id: submissionId });
}
```

The app must catch mount, capture, and storage failures. It must preserve the current look on a failed save. A reveal completion callback retains the submitted ID so a later stale callback cannot advance a different round.

## Work ownership and remaining checks

The throughput checkpoint is fixed for the next wave.

- Blocking first steps are the exported contract, passing core tests, and strict type checking. They are complete.
- Independent workstreams can now own the portrait module and the app files separately.
- Shared mutable state has one app owner. The portrait consumes snapshots and emits completed gestures. Neither owner writes the other's state.
- The smallest safe decomposition is one portrait owner and one app owner, followed by one integration owner.

The core owner wrote only `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, the three core modules, the two unit-test files, and this handoff. No app, CSS, index, renderer, asset, or source research file changed.

The portrait owner writes `src/portrait.ts`. The app owner writes `src/app.ts`, `src/style.css`, `src/lookbook.ts`, `index.html`, browser tests, and browser-verification configuration. Package script changes serialize through the integration owner. Core changes remain with the coordinator or a newly assigned core owner.

Remaining checks include real-mask composition, cheek-only rotation, lip borders, removal to the authored skin, undo and restored documents, missing assets, pointer cancellation, export parity, appearance candidate inspection, and phone layouts. CPU replay is bounded, but interactive latency, GPU cost, memory, and real-phone behavior are not measured. No performance or reference-rubric score is claimed in this handoff.

Model the Domain shaped the registries and phase union. Boundary Discipline placed validation in the decoders and pointer capture gate. Type System Discipline made paths nonempty and separated practice outcomes from scored submissions. Make Operations Idempotent made duplicate finish and stale reveal actions no-ops. Test Behavior, Not Implementation shaped the literal field and transaction tests. Prove It Works limited verified claims to commands actually run.
