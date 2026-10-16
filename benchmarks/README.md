# Compare paint analysis

`analysis-baseline/` is an immutable benchmark fixture. It preserves the complete paint module and matching registries from before the scalar-loop optimization. The app does not import it. Regression tests use it as an independent oracle for legacy paint bytes and document decoding. Do not update it when production behavior changes.

`analysis-baseline/manifest.json` pins both source hashes. Both comparison scripts verify that manifest and refuse to replace it.

Run the pure-function comparison from the project root.

```sh
node scripts/bench-analysis.mjs --out tmp/analysis-comparison.json
```

Use a new output path for every run. The script compares actual 1024 masks and composed paint fields. It alternates five timed samples per side after equal warmup. Every output must match exactly.

Run the production-browser comparison separately.

```sh
node scripts/bench-analysis-browser.mjs \
	--out tmp/verification/performance-final/a-new-run
```

The script builds two isolated copies of the current app. The baseline copy substitutes only the frozen `analyzePaint` function from `analysis-baseline/paint.ts`. Both copies keep the current stroke API and document format. Every isolated source byte outside `analyzePaint` must match. The policy check compares palette, themes, regions, and tool settings except interaction defaults. The pure-function comparison still uses the complete frozen painter.

The browser script owns preview ports 4165 and 4166 and closes them after the run. It compares the first real Finish in five interleaved fresh-context pairs. It also checks the actual strokes, criteria, matching PNGs, and fixed readiness budgets. No shared source or `dist/` file changes.

Run the source checks without app builds, previews, or browsers.

```sh
node scripts/bench-analysis-browser.mjs --self-check
```

This checks fixture hashes, the analyzer substitution, retained current APIs, allowed default changes, and rejection of changed paint policy.

These scripts measure specific scenarios. Do not infer real-phone behavior, display latency, frame rate, or a whole-game speedup from one numeric function or a software-renderer result. Read the output's method, errors, host load, spread, and profile evidence before using its numbers.
