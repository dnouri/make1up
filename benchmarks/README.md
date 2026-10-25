# Compare paint analysis

`analysis-baseline/` is an immutable benchmark fixture. It preserves the complete paint module and matching registries from before the scalar-loop optimization. The app does not import it. Paint transaction tests also use its painter as an independent oracle for unchanged behavior. Do not update the fixture when production behavior changes.

`analysis-baseline/manifest.json` pins both source hashes. Both comparison scripts verify that manifest and refuse to replace it.

## Check analysis without timing

Run the fixture self-check from the project root.

```sh
node scripts/bench-analysis.mjs --self-check
```

This command verifies the frozen source hashes, loads the v2 masks and guides, and gives both analyzers the same four paint-field fixtures. It requires exact analysis outputs, known scores, and unchanged input bytes. It does not time or profile the code.

The old and current paint-placement policies intentionally differ. The stroke fixture is composed once by the frozen painter and supplied to both analyzers. The check does not require current full-face blush or eyeshadow to reproduce the old region-limited paint. It validates analysis of identical fields, not parity between the two painters.

## Measure pure analysis

Run the timed pure-function comparison separately.

```sh
node scripts/bench-analysis.mjs --out tmp/analysis-comparison.json
```

Use a new output path for every run. The script uses 1024 by 1024 masks and shared paint fields. Five warmup pairs precede five timed baseline-then-current pairs per fixture. Every analysis output must match exactly. Fixture creation, paint composition, assertions, and assessment are outside the timed call.

## Compare production-browser Finish

Build the current app before running the browser comparison.

```sh
npm run build
node scripts/bench-analysis-browser.mjs \
	--out tmp/verification/performance-final/a-new-run
```

The script builds two isolated copies of the current app. The baseline copy substitutes only the frozen `analyzePaint` function from `analysis-baseline/paint.ts`. Both copies keep the current v2 document, painter, registry, and assets. Every isolated source byte outside `analyzePaint` must match. The policy check validates the current single tool registry and its approved regions. It allows interaction-default changes but rejects changed palette, theme, region, or tool behavior. It does not require the frozen registry's old placement policy.

The browser script owns preview ports 4165 and 4166 and closes them after the run. It compares the first real Finish in five interleaved fresh-context pairs. It also checks the actual strokes, criteria, matching PNGs, and fixed readiness budgets. No shared source or `dist/` file changes.

## Check browser source isolation

Run the source checks without app builds, previews, or browsers.

```sh
node scripts/bench-analysis-browser.mjs --self-check
```

This checks fixture hashes, analyzer substitution, retained current APIs, allowed default changes, and rejection of changes to the approved current paint policy.

These scripts measure specific scenarios. Do not infer real-phone behavior, display latency, frame rate, or a whole-game speedup from one numeric function or a software-renderer result. Read the output's method, errors, host load, spread, and profile evidence before using its numbers.
