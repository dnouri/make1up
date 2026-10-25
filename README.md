# Play and verify MAKE1UP

MAKE1UP is a local-first Three.js makeup game. Paint a 3D portrait, complete a brief, and export a cover. The game runs in the browser after its local files load. It has no account, backend, paid generation call, or simulated human opponent.

Play [MAKE1UP on GitHub Pages](https://dnouri.github.io/make1up/).

## Start the studio

Use Node.js 22.12 or later. This project was tested with Node.js 24.9.0.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/make1up/`. Choose a tool and color, then drag on the face. Use **Eyes** or **Lips** for close work. Every tool works anywhere on paintable face skin except **Lipstick**, which stays inside the lip mask. The eyeballs, hair, and rear of the head are not paintable.

Select **Blend existing makeup** to soften painted edges. **Strength** controls the effect. Repeated passes build softening within one gesture. Blend adds no color and does not drag pigment in the stroke direction.

Select **Turn** to rotate without painting. **Undo** and **Redo** operate on complete gestures. **Guided apply** makes one real, undoable stroke from the portrait's landmarks.

Select **Finish look** to lock the portrait and see its solo brief match. Use **Change brief** for another theme, an optional timer, or score-free practice.

## Customize the portrait

Select **Customize portrait** beside **Change brief**. The same live portrait stays visible while you scroll the choices. Desktop and short landscape layouts place the controls beside it. Portrait phone layouts place the controls below it.

The workspace has these choices:

- Face shapes are Balanced, Soft, and Angular.
- Nose shapes are Balanced, Broad, and Rounded tip.
- Mouth shapes are Balanced, Full, and Wide.
- Eye shapes are Balanced and Round.
- The five complexions are Fair, Warm, Tan, Brown, and Deep.
- The four hair colors are Espresso, Chestnut, Plum, and Light blonde.
- The three iris colors are Blue, Hazel, and Olive.
- Hairstyles are Ponytail and Crown bun.

Each changed choice is one undoable edit. Your makeup stays in place. Drag to turn the portrait or use the zoom buttons while you choose. Select **Done** or press Escape to restore your makeup framing, turn, zoom, and document scroll. Focus returns to **Customize portrait**. An optional round timer continues in this workspace.

## Keep or share a look

- Select **Save look** to store the strokes, appearance, and thumbnail in this browser. The local lookbook holds eight looks. Clearing browser data removes them.
- Select **Download PNG** for a 1080 by 1350 portrait cover with the required asset credit.
- Select **Share** for a private remix link. The URL fragment contains the editable look. Nothing is uploaded. A very detailed look can exceed the link limit.

The v2 lookbook starts fresh under `make1up.lookbook.v2`. Old v1 storage is not read or imported, and its bytes remain untouched. Older look documents and remix links are unsupported.

A localhost link works only on the computer that serves it. Use [the published studio](https://dnouri.github.io/make1up/) to create remix links for other devices.

## Run the checks

Install the browser once.

```sh
npx playwright install chromium
npm run verify
```

The command runs unit tests, strict TypeScript, v2 asset checks, and production Chromium workflows. The asset checks use the generated v2 files. Only regeneration needs the licensed source `.blend` described in [the asset handoff](public/face/HANDOFF.md). Playwright builds the app and owns preview port 4173. Keep that port free. Its projects cover desktop, portrait phone, and landscape phone layouts. The customization checks cover five viewport sizes. They include native browser touch input, exact PNG comparisons, storage failures, invalid links, optional timers, and WebGL failure views.

Run the production build separately.

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4173/make1up/`. Vite reports a large graphics chunk. It loads separately from the initial interface.

## Publish to GitHub Pages

Push to `main` to run [the Pages workflow](.github/workflows/pages.yml). The workflow installs the locked dependencies and runs the full verification suite. It publishes only the checked `dist/` directory. GitHub Pages must use **GitHub Actions** as its build source.

The production base path is `/make1up/` in `vite.config.ts`. Runtime portrait assets and credit links use that base path too.

Check the published game without starting a local server.

```sh
PLAYWRIGHT_BASE_URL=https://dnouri.github.io/make1up/ npm run verify:browser -- tests/pages.spec.ts
```

This check loads the portrait and fonts, opens the credit files, paints and finishes a look, reloads a remix link, and downloads a real PNG. It runs on the desktop and both phone layouts. The browser uses temporary storage, not your saved lookbook.

## Rebuild the portrait

Read [the v2 asset handoff](public/face/HANDOFF.md) before changing geometry or UVs. `art/avatar-v2.json` defines the choices and authoring recipes. `art/neutral/` contains authoring inputs, not a runtime asset. Generation needs Blender with NumPy and Pillow, plus the exact licensed Rain archive and `.blend` recorded in `public/face/v2/provenance.json`. Normal installation and play do not need Blender or those source downloads.

Generate the runtime files into `public/face/v2/` from the repository root.

```sh
blender --background --factory-startup --disable-autoexec --threads 4 \
	--python-exit-code 1 --python scripts/prepare-avatar.py -- \
	--output-dir public/face/v2
npm run verify:assets
```

The asset command runs `node scripts/verify-assets.mjs public/face/v2 --geometry-only`. It checks the actual GLB, all 54 shape combinations, fitted lashes, bun components, frozen paint UVs, masks, authored map detail, and notices. This preflight does not approve the artwork or establish a device performance budget. The handoff also gives the separate render-proof commands.

## Check analysis and brush response

The [analysis benchmark guide](benchmarks/README.md) separates correctness self-checks from timing and profiling. The frozen and current analyzers receive the same paint fields. The scripts do not compare the intentionally different old and current paint-placement policies. Pure analysis and the first production-browser Finish have separate measurement commands.

The [brush-response check](benchmarks/interaction.md) measures native pointer handlers, actual rendered-frame work, and brush release in a production browser. It verifies localized paint changes and records runtime errors. Neither check proves physical-phone frame rates.

## Inspect the evidence

- [The work plan](docs/work-plan.md) records the phased run and its exit predicate.
- [The architecture](docs/architecture.md) explains state, paint, persistence, and renderer ownership.
- [The public reference study](docs/research/game-reference.md) separates inspected gameplay evidence from reports and inferences.
- [The face pipeline](docs/research/face-pipeline.md) compares AI and shared-topology options, terms, and privacy limits.
- [The skill selection](docs/research/skills.md) records the six licensed project skills under `.agents/skills/`.
- [The initial review](docs/quality-review.md) and [the refinement review](docs/quality-final.md) record the original quality rubric and actual defects.
- [The verification record](docs/verification.md) gives the final check status, counts, and limits.
- [The decision log](docs/decisions.tsv) records choices and verification evidence.
- [The next phases](docs/roadmap.md) define the remaining product work.

Generated browser evidence and local HTML reports live under `tmp/`. They are not required to build the game and are not tracked in Git.

## Respect the limits

This version uses one licensed, modified Rain sculpt with bounded face, nose, mouth, and eye morphs. Its five complexion maps and four hair maps are offline recolors of the source artwork, not newly photographed skins. Ponytail and Crown bun use different fitted component sets. There are no facial expressions or AI-generated faces. Read [the third-party notices](THIRD_PARTY_NOTICES.md).

The brief match measures final paint coverage, palette, and finish. It does not rank beauty, skin tone, or identity. There are no human votes.

The game does not yet have multiplayer, a public gallery, progression, imported photos, or live AI generation. Browser emulation does not prove performance on a physical phone. The local rubric does not establish that this game is better than every competing game or that it will spread through sharing.
