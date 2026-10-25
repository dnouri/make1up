# The v2 document and portrait

MAKE1UP separates a saved makeup look from the session that edits it and the renderer that displays it. The saved value contains identity choices and completed UV strokes. Camera movement, brush controls, loading state, and workspace navigation do not belong in that document.

V2 is the only playable portrait and look format. The operator chose a fresh v2 lookbook without backward compatibility or imports of older looks.

## One immutable look shape

`Look` is the single persisted document shape in `src/look.ts`.

```ts
type Look = Readonly<{
	version: 2;
	asset: "rain-portrait-v2";
	identity: AvatarIdentity;
	strokes: readonly Stroke[];
}>;
```

`AvatarIdentity` is a flat record with eight fields. They are `face`, `nose`, `mouth`, `eyeShape`, `complexion`, `eyes`, `hairColor`, and `hairStyle`. There is no identity-kind discriminator. `newLook()` always creates this document with the registry's default identity and no strokes.

`art/avatar-v2.json` owns the choice IDs, labels, semantic morph names, color-map paths, authoring recipes, and hairstyle component sets. `src/avatar.ts` derives the identity type, catalogs, labels, and input validator from that registry. The generator reads the same registry, so controls and assets use the same names.

The decoder validates exact document, identity, stroke, and brush fields at the input boundary. It rejects other document versions, other asset IDs, unknown choices, extra fields, and values beyond the document limits. Canonical encoding gives each look a stable fingerprint.

Each gesture stores its own brush settings and quantized UV paths. Changing the current brush does not change completed paint. Identity edits replace the identity without changing those paths. Clear removes makeup strokes, not identity choices.

## Session owns edits and submission

`src/session.ts` has one pure reducer, `step`. `src/app.ts` owns the sole Session variable and dispatches actions through that reducer.

Editing owns a bounded history of immutable looks, the current brush, mode, framing, navigation, and workspace. An effective gesture, a changed identity choice, a loaded look, or a clear operation is one edit. No-op edits do not add history. Undo and redo restore whole looks.

The phase union separates editing, reveal, and result. Finish creates an immutable submission with its look and practice or challenge outcome. Repeated Finish actions and stale reveal-completion events cannot resubmit it. Practice has no deadline or score. Challenge mode has an optional deadline.

`presentSession` derives the renderer's presentation. The `customize` workspace projects a read-only, full-face turn view without overwriting the makeup brush, framing, or navigation. The reducer blocks paint and makeup-view changes there. Identity edits and history remain available. A locked result always projects the makeup workspace.

## One region rule for every tool

The literal Tool registry in `src/look.ts` defines labels, operations, tips, placement, defaults, and one region per tool. The UI and painter read that registry.

Lipstick uses `lips`. Blush, eyeshadow, liner, sparkle stamp, erase, and blend use `valid`, which means all paintable face skin. There is no per-stroke placement policy. The same rule applies to every accepted stroke.

Cheek and eyelid masks remain available to paint analysis. They do not restrict freehand blush or eyeshadow. Guided apply uses the asset's UV landmarks and sends a real stroke through the same admission path as direct input.

## Paint owns pixels and assessment

`src/paint.ts` owns raster compositing, gesture transactions, and analysis. It accepts explicit masks and has no dependency on Three.js or the DOM. Base skin maps and makeup remain separate.

A gesture transaction owns mutable preview buffers and an unchanged committed base. It rasterizes appended captured segments and retains quantized coverage between frames. Extra preview frames cannot increase pigment or erase opacity. On release, it drains the final samples and compares the candidate's RGBA and finish bytes with the base. An unchanged candidate does not become an edit.

Blend capture selects `algorithm: "soften-v1"`, the current blend algorithm identifier. The algorithm softens existing premultiplied color, alpha, and finish through a local box filter. Fixed-distance brush samples accumulate influence within the gesture. Blend adds no pigment and does not move pigment in the travel direction.

`src/portrait.ts` offers effective strokes through `onStroke`. The Session reducer remains the only history writer. The renderer's `present` method remains the only committed-field writer. It adopts a computed candidate only for the exact accepted one-stroke append on the same base. Canceled gestures and rejected edits leave committed paint unchanged.

Analysis reads the final composited paint field. The renderer caches that analysis until committed paint changes. `assess` applies the published theme rules to coverage, palette, and finish. Identity choices, names, payment, random values, and pretend human votes do not affect the solo brief match. Erased paint cannot retain points.

## One v2 rig and render loop

`src/portrait.ts` loads `public/face/v2/head.glb` and its masks through Vite's base URL. It owns one WebGL renderer, scene, render loop, orthographic camera, paint textures, gestures, and resource cleanup. `art/neutral/` is an authoring input directory, not a runtime asset.

The renderer applies shape choices by semantic target name. It resets and applies all face and fitted-lash weights before it refits picking. Hairstyle choices select the registry's complete ponytail or crown-bun component set. Appearance maps replace base color textures without changing the paint field.

The [asset handoff](../public/face/HANDOFF.md) and `public/face/v2/asset.json` define the geometry and paint contract. `Face` retains its base UVs and frozen second UV atlas. Only approved front-visible polygons have paint coordinates. Rear and hidden polygons use a reserved transparent texel. Morphs move geometry while those UVs remain fixed.

### Dynamic picking follows the displayed shape

`src/picking.ts` installs local indexes without patching global Three.js prototypes. Static meshes use geometry-level `MeshBVH` indexes. Meshes with position morphs use per-instance `SkinnedMeshBVH` indexes, which read posed vertex positions. Per-instance trees keep two meshes with different morph weights from sharing the wrong pose.

Every complete identity pose refits the dynamic trees and updates their bounds. Picking preserves triangle order, interpolated second UVs, and stock raycast tie order. Cleanup restores the mesh methods and geometry state.

The renderer raycasts every visible portrait mesh and accepts a brush only when the nearest hit is `Face`. Its second UV must avoid the reserved border and pass the valid-face mask. Eyes, lashes, and hair therefore block paint. Mirror input reflects the local hit in X and raycasts again. It does not assume a symmetric atlas. The head stays still during a paint gesture, and Turn is explicit navigation.

### Appearance availability is separate from the look

`src/appearance.ts` manages borrowed color maps. It reuses embedded default maps and loads only selected external face, bust, hair, and iris maps. A reference-counted cache evicts unused entries above a six-entry target. Maps still in use remain retained.

The portrait reports `ready`, `loading`, or `error`. A request is accepted only if it is still the current request. Late completion cannot overwrite a newer identity. The last ready appearance can remain visible while another selection loads, but paint, analysis, and capture require readiness. Retry requests the selected identity again without changing the document.

The app also guards Finish with readiness. A challenge timer continues in customization. A ready appearance can finish on expiry and exit to the locked result. Pending or failed appearance loading delays submission until readiness.

### Capture restores the latest live portrait

The app serializes capture jobs. Each capture borrows the requested identity's maps and waits for them before drawing. Once resources are ready, capture synchronously applies that identity and its paint to the same renderer, frames the cover, and copies the rendered canvas.

A `finally` block restores the latest live identity and maps, displayed paint, camera, portrait transform, cursors, render size, and pixel ratio. Restoration also runs when drawing fails. PNG encoding happens after the live renderer is restored, and the borrowed maps are released when the capture job ends. App job tokens and document revisions keep stale asynchronous results from replacing newer UI state.

## The same-canvas customization workspace

`src/app.ts` and `src/style.css` own the full-viewport workspace. Registry-generated native fieldsets and radio choices expose all eight identity fields. The existing canvas remains in the same stage parent with the same WebGL context. No second preview or renderer exists.

Desktop and short landscape layouts place the preview beside independently scrolling controls. Portrait phone layouts reserve the preview above the controls. The header and footer remain visible. Paint controls are hidden. Turn, zoom, credit, loading, retry, Undo, Redo, and Done remain available.

Workspace navigation is editing view state, not a look edit. The portrait stores separate framing, yaw, pitch, and zoom for makeup and customization. Entering customization does not reset the saved makeup view. Done and Escape restore document scroll and focus **Customize portrait**. Hidden regions cannot receive focus, and numeric makeup shortcuts do not run in customization.

## V2-only persistence and sharing

`src/lookbook.ts` reads and writes only `make1up.lookbook.v2`. That lookbook starts empty. The app does not read, copy, or clear `make1up.lookbook.v1`. Older look documents are unsupported.

The lookbook holds at most eight validated entries with thumbnails and content fingerprints. Save and share operations use the same canonical v2 look encoder. Storage failures leave the current look unchanged. Share fragments contain bounded raw or compressed JSON, and decompression has an explicit size limit. Container version markers describe storage or transport only. Every enclosed look must pass the v2 decoder.

Sequential multi-tab saves and refresh checks do not establish atomic simultaneous writes. The app has no backend, account, service key, imported photo, runtime AI call, public gallery, or online voting service.

## Verification boundaries

Domain and paint tests cover the document, history, tool rule, transactions, scoring, appearance requests, and morph-aware picking. Asset checks verify the generated v2 files against the locked neutral authoring inputs. Production Chromium workflows exercise actual pixels, touch input, customization, failure states, saved looks, sharing, and PNG restoration.

The [verification record](verification.md) gives the current counts and the five customization viewport results. Geometry checks are not human art approval. Software WebGL and emulated phones do not establish physical-phone performance, Safari behavior, Firefox behavior, or human screen-reader usability.
