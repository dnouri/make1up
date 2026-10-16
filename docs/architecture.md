# The Make1Up document and portrait

## Decision

Candidate A is the base. Its immutable Look, single Session writer, phase union, and derived renderer state are easier to verify than an event log for every identity and layer operation. The independent cross-judge scored A 19 and B 15 out of 20 in `tmp/design/judgment.md`. The judge ran on `zai/glm-5.3` after the configured Kimi candidate failed before work began.

Graft B's stable look fingerprint and bounded URL sharing. Do not add its full event-log projection or skin-dependent judging. Drop A's unsupported negative-type-check claim rather than reuse it as evidence.

The art probe changed the asset choice. `tmp/art-probe/evidence/comparison.png` shows both actual exports under the same conditions. Rain has the stronger eyes, hair, and skin detail. Use the modified CC-BY Rain portrait in `public/face/v1/`. Keep its credit, license, and change notices. Its higher triangle count requires a browser check. The source is not AI-generated. One neutral sculpt is supported. Do not invent identity morphs or expressions.

## Core shape

A versioned Look owns appearance choices and an ordered list of completed UV strokes. Each gesture is one transaction. Brush settings belong to the stroke, so changing the current brush cannot alter old paint. Paint and base skin remain separate.

One pure reducer changes Session. Editing owns bounded undo and redo histories. Reveal and result own an immutable submission. Repeated finish and stale reveal events do not resubmit. Practice has no deadline. Challenge mode can have a clearly labeled optional clock. Use framing actions to change face, eyes, or lips views. Renderer zoom only adjusts within that framing.

A literal Tool registry defines labels, pigment behavior, region masks, and defaults. UI and painter read it. The implemented tools are blush, eyeshadow, lipstick, liner, sparkle stamp, erase, and blend. A safe whole-region application can help beginners, but it must be labeled an application action rather than a freehand stroke.

Critique measures final composited makeup, not identity, name, payment, random numbers, or pretend human votes. Its published rules and deterministic assessment accept paint analysis only. Erased paint cannot still earn points. Label the result a solo brief match, not a beauty score.

## Boundaries

- `src/look.ts` owns domain types, catalogs, tool and theme registries, input decoding, and pure look operations.
- `src/session.ts` owns phase and history transitions.
- `src/paint.ts` owns raster compositing, gesture transactions, and paint analysis. It accepts semantic masks explicitly and never imports Three.js or DOM. A transaction owns mutable preview buffers. It rasterizes only appended captured segments and composites from its unchanged base. Finishing transfers the candidate only when pigment or finish bytes differ.
- `src/portrait.ts` owns Three.js, mask loading, projection, previews, one render loop, camera, texture caches, and PNG capture. It consumes Look snapshots and admits new strokes through `applyStroke`. Direct and Guided input use the same exact-byte effect check. Only an effective gesture reaches `onStroke`. The reducer remains the sole history writer, and `present` remains the sole committed-field writer.
- `src/picking.ts` installs local spatial indexes on the static portrait meshes. It preserves triangle order, second UV coordinates, and stock raycast tie order. Cleanup restores the original mesh methods and geometry state. It does not patch global Three.js prototypes.
- `src/lookbook.ts` owns local persistence and bounded share encoding. It validates decoded data through the domain gate. Failed saves preserve the current look.
- `src/app.ts` and `src/style.css` own the visible game. The app is the sole Session variable owner.
- `tests/` and `scripts/` own repeatable behavioral and actual-browser checks.

Use Vite and strict TypeScript without a UI framework. Dependencies must earn their place. No backend, account, service key, photo upload, or runtime AI call is needed.

## Asset and paint contract

Follow `public/face/HANDOFF.md` and `public/face/v1/asset.json`. The head faces +Z and uses meters with +Y up. Keep source base UVs. Paint the Face mesh through its second UV attribute, `uv1`. The second atlas is a front-only, top-left projection with a reserved transparent border. Use `flipY=false` and the provided valid, lip, cheek, and eyelid masks.

Use the local geometry indexes to raycast all visible portrait meshes and reject a brush if the nearest visible object is not Face. Interpolate the second UV channel. Mirror by reflecting the local hit in X and recasting, rather than assuming all future atlases are symmetric. Keep the head still during a paint gesture. Turn mode is explicit. Limit supported views to the asset's tested range.

Appearance choices can include tested complexion tints, iris maps, hair colors, fitted hair visibility styles, and lashes. They are not independent sculpted faces. Test every exposed option under the same light. The editor and export use the same portrait and paint code.

## Gesture and saved-paint compatibility

A draft retains its quantized coverage between frames. Pigment and erase use maximum coverage within one gesture, so extra preview frames cannot increase opacity. On release, the portrait drains the final samples and offers the computed candidate to the reducer. `present` adopts it only for the exact accepted one-stroke append on the same base. Rejected edits and canceled gestures leave committed pixels unchanged.

New Blend strokes carry `algorithm: "soften-v1"`. They use a contiguous local box filter of existing premultiplied color, alpha, and finish. Brush travel accumulates integer influence at fixed distance intervals. Strength controls interpolation toward that fixed filtered result. The effect is independent of frame cadence and does not move pigment directionally. The local filter excludes invalid atlas samples but includes valid blank skin.

Untagged strokes retain their original paint behavior, including the old nine-tap Blend. Their version 1 JSON and fingerprints do not change. The first accepted tagged Blend promotes its document to version 2. Old clients reject that version instead of silently changing its appearance. The existing lookbook and share containers can hold both document versions.

## Verification order

1. Build domain tests, a production build command, and a rerunnable browser check before broad UI work.
2. Load the actual portrait. Paint an asymmetric cheek and the lips. Verify rotation, removal, undo, and PNG output. Inspect the real screenshot before expanding content.
3. Complete challenge, practice, reveal, replay, local save, reopen, and share or PNG export.
4. Run desktop, portrait phone, and landscape phone workflows. Check keyboard controls, pointer cancellation, corrupt saves, missing assets, and storage failure.
5. Compare actual portraits against the public references. Record honest rubric scores and gaps. Real-device phone performance and first-time human usability cannot be inferred from desktop automation.

## Throughput checkpoint

- **Blocking first steps.** The domain owner fixes exported types and tests before app and renderer writers separate.
- **Independent workstreams.** After that gate, renderer owns `src/portrait.ts` only. Application owner owns the DOM, styles, persistence, and browser tests. The domain owner remains the only writer of domain modules until its handoff.
- **Shared mutable state.** One app state owner. One renderer loop. Separate worker files. Root integration happens only after each foreground wave returns.
- **Smallest safe decomposition.** One app owner integrates the loop. A portrait specialist owns the hardest graphics module. Independent review judges both against actual evidence.

## Deferred product scope

Online multiplayer, public voting, moderation, public gallery, large catalogs, sculpted facial identities, expressions, and live AI generation are not part of this first run. They require separate design and tests. A good local studio is not evidence of social-game parity or virality.
