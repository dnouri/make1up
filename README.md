# Play and verify MAKE1UP

MAKE1UP is a local-first Three.js makeup game. Paint a 3D portrait, complete a brief, and export a cover. The game runs in the browser after its local files load. It has no account, backend, paid generation call, or simulated human opponent.

Play [MAKE1UP on GitHub Pages](https://dnouri.github.io/make1up/).

## Start the studio

Use Node.js 22.12 or later. This project was tested with Node.js 24.9.0.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/make1up/`. Choose a tool and color, then drag on the face. Use **Eyes** or **Lips** for close work. **Liner** can paint anywhere on the paintable face. Blush, eyeshadow, and lipstick have safe area masks.

Select **Turn** to rotate without painting. **Undo** and **Redo** operate on complete gestures. **Guided apply** makes one real, undoable stroke from the portrait's landmarks.

Select **Finish look** to lock the portrait and see its solo brief match. Use **Change brief** for another theme, an optional timer, or score-free practice.

## Keep or share a look

- Select **Save look** to store the strokes, appearance, and thumbnail in this browser. The local lookbook holds eight looks. Clearing browser data removes them.
- Select **Download PNG** for a 1080 by 1350 portrait cover with the required asset credit.
- Select **Share** for a private remix link. The URL fragment contains the editable look. Nothing is uploaded. A very detailed look can exceed the link limit.

A localhost link works only on the computer that serves it. Use [the published studio](https://dnouri.github.io/make1up/) to create remix links for other devices.

## Run the checks

Install the browser once.

```sh
npx playwright install chromium
npm run verify
```

The command runs unit tests, strict TypeScript, asset checks, and production Chromium workflows. Playwright builds the app and owns preview port 4173. Keep that port free. Its projects cover desktop, portrait phone, and landscape phone layouts. They include real native touch input, exact PNG comparisons, storage failures, invalid links, optional timers, and WebGL failure views.

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

Read [the asset handoff](public/face/HANDOFF.md) before changing geometry or UVs. The optional Blender exporter needs the licensed source files described in [the face pipeline](docs/research/face-pipeline.md). Normal installation and play do not need Blender or those source downloads.

```sh
npm run verify:assets
```

This check verifies the distributed GLB, second paint UVs, rear-face protection, mesh counts, eye bounds, mask dimensions, and license files. It does not prove device performance.

## Repeat the performance comparison

The [benchmark guide](benchmarks/README.md) uses a preserved source baseline and exact-output checks. Its scripts measure pure paint analysis and the first real production-browser Finish separately. They do not change the app or require a paid service.

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

This version has one licensed, modified Rain sculpt with iris maps, complexion tints, and fitted hair visibility choices. It does not have multiple sculpted identities or AI-generated faces. Read [the third-party notices](THIRD_PARTY_NOTICES.md).

The brief match measures final paint coverage, palette, and finish. It does not rank beauty, skin tone, or identity. There are no human votes.

The game does not yet have multiplayer, a public gallery, progression, imported photos, or live AI generation. Browser emulation does not prove performance on a physical phone. The local rubric does not establish that this game is better than every competing game or that it will spread through sharing.
