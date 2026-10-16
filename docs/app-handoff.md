# First MAKE1UP application handoff

This document preserves the first application owner's handoff. Root integration and later refinements are complete. The current counts and API are in `docs/verification.md` and `docs/architecture.md`. The pending package-script action below was completed before the final verification run.

## Status

VERIFIED on 2026-10-16 against the real `src/portrait.ts`. No renderer substitute was created.

- `npm run typecheck` passes.
- `npm test` passes 52 tests. Thirteen tests cover the new lookbook and share module.
- `npx playwright test` passes 29 browser scenarios. One desktop-only touch-cancellation case is intentionally skipped. The phone and landscape projects run that case with native Chromium touch input.
- Each Playwright run builds the production app, then starts Vite preview on `127.0.0.1:4173`.
- After the final compact-desktop sticky-finish change, the six direct-drawing and three-round scenarios pass again across all three layouts.
- After unique saved-card action labels were added, the three persistence, PNG, and share scenarios pass again.

The browser projects use 1440 by 1000, 390 by 844, and 844 by 390 viewports. The desktop test also checks that Finish look remains fully visible at 1280 by 720. Chromium uses software WebGL in this environment. These are browser-emulation checks, not real-phone performance evidence.

## Files

- `index.html` owns the entry point, local font preloads, metadata, and favicon.
- `src/app.ts` owns the studio, dialogs, one Session variable, clocks, and asynchronous action tokens.
- `src/style.css` owns the ivory, plum, orchid, and lavender editorial layout. Desktop has three columns. Portrait phone puts swatches above the portrait and keeps Finish look at the bottom. Landscape puts Finish look in the header and lets the cosmetics panel scroll.
- `src/lookbook.ts` owns bounded local storage and private URL fragments.
- `tests/lookbook.test.ts` owns persistence and share behavior tests.
- `tests/browser.spec.ts` and `playwright.config.ts` own the production-browser workflow.
- `public/fonts/` contains local Bodoni Moda and DM Sans WOFF2 files, their OFL licenses, and source notes.
- `public/favicon.svg` contains the original four-point motif.

No core, portrait, package, shared configuration, or face-asset files were changed by this owner.

## Studio behavior

The app starts with an editable blank Rain portrait and the Orchid hour brief. Mirror is on. Every tool label comes from `tools`. Palette labels and colors come from `palette`. The tools include real erase and blend operations through the core and portrait.

The app includes brush size, opacity, softness, gloss, swatches, native custom color, undo, redo, confirmed clear, framing, zoom, and separate Paint and Turn controls. Before view is read-only. Finish restores the real look before analysis, so a comparison view cannot submit an empty field.

Guided apply creates a real captured stroke. It reads the asset's UV landmarks from `/face/v1/asset.json`. Blush and shadow use explicit paired left and right landmarks when Mirror is on. Lipstick follows the three supplied lip landmarks. The button is not a freehand simulation. Browser tests also draw directly with the mouse and native touch events.

Challenge has no timer by default. Three-minute and five-minute choices are explicit. Practice has no timer and no score. Changing the brief retains the actual look and starts a new Session. That core action resets undo history and the current brush. The app does not imply that earlier history survives a new round.

Finish locks the submission. Reveal respects reduced motion. The result displays the core's deterministic solo brief match, all four rule totals, and expandable measurement reasons. Practice displays no score. Next brief, replay with clean skin, and remix use real Session transitions.

## Appearance inspection

Every exposed option was inspected under the same actual renderer light before it was enabled. The options are three iris maps, four complexion tints, three hair color tints, and three fitted hair visibility choices. Tints multiply the original maps. They are not new skin textures, sculpts, or identities.

`tmp/app-implementation/appearance-contact-sheet.png` compares all options. `tmp/app-implementation/hair-side-contact-sheet.png` shows the fitted ponytail and Tail hidden at the supported side angle. Tail hidden really removes the tail. Front curl tucked really removes the fitted front curl. UI labels come from the catalog and do not claim a new haircut asset.

## Persistence and sharing

Local storage uses `make1up.lookbook.v1`. The book accepts eight entries and at most two million UTF-8 bytes. Each PNG thumbnail is capped at 160,000 characters. Saved JSON passes through `decodeLookJSON`. Content IDs come from `lookFingerprint`, with canonical JSON comparison before the duplicate-save shortcut.

An identical save retains the original entry and timestamp. A full, blocked, or corrupt book gives an explanation without replacing its data or the current look. There is no silent eviction. Saved looks have an actual portrait preview and restore their appearance and UV strokes after reload.

Share fragments use `#make1up=v1.d.` with CompressionStream, or a bounded plain fallback when compression is unavailable. Incoming hashes have a 20,000-character cap. Streaming decompression stops at one million expanded bytes. Decoded text passes through the core gate. Stored titles and messages are assigned with textContent, not parsed as HTML. No account, service key, upload, or remote gallery exists.

Capture operations are serialized. Save, share, and download use request tokens and the current document revision. An older asynchronous save cannot replace a newer edit. Share loads also have request and revision guards.

PNG download uses `portrait.capture` and adds a local editorial title and the Rain attribution. It keeps the portrait's actual materials and makeup. The output includes the source credit, modification notice, and CC BY 4.0 URL. A persistent stage credit button and the footer open the full credit dialog. The dialog explicitly states that this is a licensed Rain derivative, not AI-generated art.

## Browser evidence

The full-run result is `tmp/app-implementation/browser-results.json`. Screenshots and real PNG downloads are in `tmp/app-implementation/playwright/`. The focused layout rerun is in `tmp/app-implementation/final-smoke/`. The final save, restore, and share rerun is in `tmp/app-implementation/persistence-label-check/`.

The scenarios verify the following behavior.

- Direct mouse or native touch drawing, one transaction per gesture, undo, redo, keyboard tool selection, confirmed clear, Paint and Turn separation, and keyboard skip-link focus.
- Three complete rounds, the literal 100 out of 100 Orchid guided result, immutable finished paint, before-view finish, and next brief or remix.
- Save, duplicate save, reload, actual restore, and private share loading. Original and restored PNG downloads have identical bytes. Their signatures and 1080 by 1350 dimensions are checked.
- Optional three-minute expiry and five-minute selection through the browser clock. Switching to practice cancels the older deadline and produces a score-free result.
- Native touch cancellation, an older delayed capture, corrupt local storage, quota failure, font failure, and complete play plus PNG download while offline after initial load.
- Missing portrait files and a real Chromium process launched with WebGL disabled. Both show a readable recovery view. The asset credit remains reachable.

The final manual compact-desktop screenshot is `tmp/app-implementation/compact-desktop.png`. The automated compact check is also in the final-smoke desktop directory.

## Integration owner action

`package.json` still has the phase-1 placeholder for `verify:browser`. Replace that script with `playwright test`. This owner did not edit package scripts. The current Vitest configuration already includes only `tests/**/*.test.ts`, so the Playwright file is not collected as a unit test.

Playwright owns the production preview server. Port 4173 must be free. `reuseExistingServer` is false so an old development server cannot silently satisfy the gate. Browser installation was required once and was completed with `npx playwright install chromium`.

Vite emits its large-chunk warning for the portrait dependency chunk. The app imports the portrait dynamically, so the readable loading view is available before the graphics module loads. No load-time, FPS, memory, or hardware budget claim is made here.

## Remaining checks

NOT VERIFIED. Safari, Firefox, real lower-end phones, hardware GPU performance, screen-reader use by a person, graphics-context-loss recovery, and clipboard permissions across browsers. Clipboard success and its keyboard-copy fallback exist, but the automated suite verifies the share URL rather than OS clipboard behavior.

Model the Domain kept Session as the only game writer and separated saved look documents from asynchronous action state. Boundary Discipline placed untrusted local and URL data behind bounded decoders. Test Behavior, Not Implementation shaped the literal restored UV values, PNG headers, byte-identical restore, and visible failure tests. Prove It Works kept browser claims tied to the actual portrait, production preview, and inspected screenshots.
