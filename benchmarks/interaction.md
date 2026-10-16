# Check brush responsiveness

Use `scripts/bench-interaction.mjs` to check paint input in a local production browser. It uses the installed Playwright Chromium. No additional package is needed.

The [2026-10-16 result](interaction-results/2026-10-16.json) preserves the five-pair measurements. The [brush-response explanation](../docs/brush-response.md) records the changes and unresolved submission regressions.

## Capture one build

Build the app with source maps for a separate CPU profile.

```sh
npm run build -- --sourcemap
npm run preview
```

Keep the preview running. In another terminal, capture one diagnostic run.

```sh
INTERACTION_URL=http://127.0.0.1:4173/make1up/ \
INTERACTION_DIST=dist \
INTERACTION_OUT=tmp/interaction-probe \
INTERACTION_PROFILE=1 \
node scripts/bench-interaction.mjs
```

Use a new output directory for each invocation. `INTERACTION_DIST` checks served HTML and JavaScript bytes against the expected production build. A development server fails this check.

The output includes `summary.json`, a build and machine manifest, raw trial JSON, and before-and-after images. The optional profiles are separate trials. Their source-mapped hotspots are not included in timing summaries.

## Compare two builds

Preserve each production directory before the next build. Serve the directories on different local preview ports. Do not rebuild or replace either directory during a comparison.

Run one baseline trial and one candidate trial in that order. Repeat that pair at least five times. Set `INTERACTION_URL`, `INTERACTION_DIST`, `INTERACTION_LABEL`, and a unique `INTERACTION_OUT` for each invocation. Do not run two browsers or a functional browser suite concurrently with these trials.

Compare the median and range of the five trial medians. Inspect the release-handler times separately. Read the independent CPU profiles to identify the remaining limit. Check each trial's errors, trusted input counts, history count, and localized pixel changes before you accept a timing.

## Read the limits

Each trial performs 72 trusted mouse moves on mirrored cheeks with Blush, Liner, or Blend. Blend starts from an actual Ink stripe. The script waits for a real preview before release. Screenshots and pixel comparisons occur outside the timed interval.

`frameWorkMs` measures animation-callback CPU and driver submission time on frames that submit portrait draws. It is not GPU completion time, display latency, or FPS. The callback includes useful cursor-only frames when an unchanged paint region needs no texture upload.

The browser uses SwiftShader, a software renderer. Native input commands can wait for software rendering and automation. Read `automationWallMs` and delivered event intervals before you interpret total gesture time. Do not infer hardware FPS or physical-phone performance from these measurements.

`INTERACTION_PHONE=1` changes the viewport to a portrait phone layout but still uses trusted mouse input. The functional Playwright suite separately checks native touch input. Neither method replaces a physical-device performance check.

A Blend algorithm change intentionally changes its final image. Treat that comparison as a changed workload. Blush and Liner remain behavior-preserving controls. Legacy paint parity is checked against the frozen source fixture in the unit suite.
