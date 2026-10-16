# Brush response and existing-makeup Blend

The 2026-10-16 change removes repeated work from paint gestures and makes repeated Blend passes useful. It preserves legacy paint output and saved version 1 documents.

## Measured CPU improvement

Five alternating production-browser pairs compared revision `e8b4423` with the changed painter. Every tool trial delivered 72 trusted pointer moves to mirrored cheeks. All 30 trials verified a real accepted edit, localized pixel changes, and no runtime or network errors.

The table gives the median of five trial medians. Ranges are in the [recorded results](../benchmarks/interaction-results/2026-10-16.json), along with all five values, bundle hashes, and output-image hashes.

| Metric | Before | After |
| --- | ---: | ---: |
| Blush frame CPU and driver-submission work | 68.60 ms | 2.75 ms |
| Blush pointer-move handler | 20.50 ms | 0.30 ms |
| Blush release handler | 283.60 ms | 2.20 ms |
| Liner frame CPU and driver-submission work | 16.10 ms | 1.30 ms |
| Blend frame CPU and driver-submission work | 66.85 ms | 6.75 ms |

Blush frame work fell by 96 percent. Blush and Liner produced byte-identical final PNGs in every pair. Blend intentionally has a different result, so its measurement compares changed workloads.

Independent CPU profiles identified repeated whole-draft rasterization, full-field copies, and triangle intersection work. The new transaction rasterizes only appended captured segments. Presentation adopts the already-computed candidate after reducer acceptance. Local static geometry indexes avoid the linear triangle scans while retaining occlusion and second-UV checks.

## Submission regressions and measurement limits

These are software-rendered Chromium measurements, not hardware FPS, GPU completion time, physical display latency, or physical-phone performance. Native input commands wait on the browser and automation. Do not treat total automated gesture time as human input latency.

Some submission observations got slower. Their observed ranges do not overlap, so these results are not dismissed as noise.

| Submission metric | Before median and range | After median and range |
| --- | --- | --- |
| Liner release to committed-frame submission | 137.80 ms, 134.70 to 144.40 | 178.90 ms, 154.00 to 190.10 |
| Blend release to committed-frame submission | 238.40 ms, 233.20 to 251.70 | 335.00 ms, 308.80 to 367.70 |
| Blend first-draft submission | 32.90 ms, 32.30 to 34.70 | 39.70 ms, 35.40 to 44.60 |

The experiment does not isolate the remaining delivery cost. Software graphics and automation are possible limits, not a physical-display diagnosis. These regressions remain open observations. The geometry dependency also increases the portrait bundle's download size.

## Blend behavior and save compatibility

The legacy Blend applied one sparse nine-tap blur per gesture at maximum coverage. A controlled browser check delivered 13 points per mirrored path for one pass and 85 for four passes. The final images were identical.

New Blend strokes use a contiguous local filter of existing premultiplied color, alpha, and finish. Travel accumulates integer influence at fixed distance intervals. Strength controls interpolation toward the fixed filtered result. Repeated passes now increase softening. Holding still adds nothing. This is edge softening, not directional smudging or progressive pigment diffusion.

New instructions carry `algorithm: "soften-v1"`. The first accepted tagged stroke promotes the document to version 2. Untagged version 1 instructions retain their exact old behavior, canonical JSON, and fingerprints. Old clients reject version 2 instead of silently rendering it with the legacy Blend.

## Verification

The local verification run passed 153 unit tests, strict TypeScript, asset checks, and 69 production-browser tests. Three desktop-project cases skip intentionally because they test phone controls or native touch. New browser cases check one versus four passes, Strength at 0.2, 0.7, and 1, exact Undo and Redo, and shared version 2 replay on desktop and both phone layouts.

The actual portrait's indexed raycasts matched stock hits, occluders, UV1 values, and captured paths across 162 views and 3,587 primary rays. Frozen source fixtures check all legacy tools and incremental update partitions.

The [brush-response check](../benchmarks/interaction.md) describes the rerunnable measurement. The analysis benchmark's source self-check and a real calibration pair also passed after its isolated-source construction was updated for the current painter API.

Release verification and the deployment result belong to the release PR and GitHub Pages workflow. Hardware-GPU and physical-phone performance still require device measurements.
