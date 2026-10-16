# Compare paint analysis

`analysis-baseline/` is an immutable benchmark fixture. It preserves the complete paint module and matching registries from before the scalar-loop optimization. It is not imported by the app or unit suite. Do not update it when production behavior changes.

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

The script builds isolated baseline and current apps. It owns preview ports 4165 and 4166 and closes them after the run. It compares the first real Finish in five interleaved fresh-context pairs. It also checks the actual strokes, criteria, matching PNGs, and fixed readiness budgets. No shared source or `dist/` file changes.

These scripts measure specific scenarios. Do not infer real-phone behavior, display latency, frame rate, or a whole-game speedup from one numeric function or a software-renderer result. Read the output's method, errors, host load, spread, and profile evidence before using its numbers.
