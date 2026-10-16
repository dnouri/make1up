# Verification record

Checked on 2026-10-16. This record describes the local solo game, not a deployed social service.

## Final product checks

`npm run verify` completed successfully. The full receipt is `tmp/verification/release-final.log`.

| Check | Result | Evidence |
| --- | --- | --- |
| Unit behavior | 67 passed in three files. | `tests/domain.test.ts`, `tests/paint.test.ts`, `tests/lookbook.test.ts`. |
| Strict TypeScript | Passed. | `npm run typecheck`. |
| Licensed asset contract | Passed for the actual GLB, second UVs, rear protection, eyes, masks, and notices. | `scripts/verify-assets.mjs`, `tmp/verification/assets.json`. |
| Production browser | 57 passed. Three desktop-only cases intentionally skip because the phone projects run their touch and quick-control checks. No retries. | `playwright.config.ts`, `tests/browser.spec.ts`, `tests/no-effect.spec.ts`. |
| Root browser inspection | Three real gestures, a 100/100 Orchid brief match, actual PNG download, no horizontal overflow, and no recorded console errors. | `tmp/verification/root-final.json`, `root-final-result.png`, `root-final-cover.png`, `root-console-check.log`. |
| Final production modules | `index-CKuIyMEO.js`, `portrait-CUpEp3H1.js`, `index-C_qjDYyJ.css`. | `dist/assets/`, `tmp/verification/final-source-sha256.txt`. |

The browser projects use Chromium with software WebGL at 1440 by 1000, 390 by 844, and 844 by 390 CSS pixels. Native mouse and browser touch events drive real drawing. Those checks are not physical-phone tests.

The scenarios cover drawing, correction, exact undo and redo, no-effect rejection, full-lip default application, three rounds, timed expiry, score-free practice, local save and reopen, PNG parity, private remix loading, stale asynchronous work, corrupt storage, quota failures, font failures, offline use after initial load, missing assets, and disabled WebGL.

Vite still reports a graphics chunk above its default warning threshold. The renderer loads separately from the initial interface. No bundle-size warning was suppressed.

## Iterations and retained failures

The initial independent visual review scored 72.5 of 100. It found invisible history entries, off-screen phone correction controls, precision text obstruction, a weak phone reveal, and missing visible tool names. Root reproduced the invisible stroke in the real browser.

The second independent review verified all five repairs and scored 81.25 under the same rubric. It did not credit multiplayer or broader identities. That review predates the last bounded changes to analysis speed, landscape text, and default lipstick. No new numerical visual grade was invented for those changes. See [the initial review](quality-review.md) and [the re-evaluation](quality-final.md).

The broad run in `tmp/verification/final-gate.log` failed its whole-test deadline. Trace inspection showed accumulated screenshot work. It did not show wrong paint or an export deadlock. The combined correction test was split into independent cases. The original 60-second limit, no-retry rule, actual PNG comparisons, and positive controls remain. The final complete run passes.

Root's final exported portrait exposed a narrow lipstick band despite its high brief match. Actual UI prototypes compared four brush sizes. The chosen 5.5 percent default covers the upper and lower lips without painting outside the mask. Old 2.5 percent stroke documents still reproduce their original PNG exactly. Evidence is under `tmp/refinement/lip-default/` and `tmp/verification/lip-study/`.

A cold-export font race was fixed with explicit font requests before cover drawing. Font failure still permits a fallback export. The final browser suite does not preload the export font as a test-only workaround.

## Performance evidence

The first software-renderer characterization missed the fixed ten-second desktop readback-inclusive readiness bound once. Heavy host contention was recorded. That failure remains in `tmp/verification/performance/README.md`.

A separate controlled production comparison used five interleaved fresh-context pairs. Both builds made the same two explicit strokes and returned identical criteria and PNGs. The median first Finish handler changed from 489.7 ms to 75.2 ms. Baseline range was 480.0 to 507.1 ms. Current range was 65.4 to 101.5 ms. A separate weighted CPU profile identifies the numeric analysis scan as the remaining named Finish cost.

The later absolute-readiness set used five current samples per layout. Desktop median was 4.126 seconds, with a 4.074 to 4.158 range. Emulated phone median was 3.937 seconds, with a 3.872 to 3.992 range. Both met the unchanged ten-second and twenty-second bounds in that condition. The shared browser and shader cache and host load are explicit. This does not erase the earlier miss or prove that analysis improved startup.

These are software-renderer measurements. Render submission is not physical display latency. No frame-rate, hardware-GPU, or physical-phone claim follows. The exact scenario, errors, work counts, source hashes, limiter, and exclusions are in `tmp/verification/performance-final/README.md`. The later lipstick default does not change that benchmark's explicitly chosen four-percent lip brush. The benchmark's policy and fixed-scenario checks retain exact results after that default change.

`benchmarks/analysis-baseline/` preserves the real old source with a hash manifest. The repeatable scripts are described in [the benchmark guide](../benchmarks/README.md). The portable baseline rerun passed at `tmp/verification/portable-baseline-check.json`.

## Reference and asset limits

Public Facecard metadata disallowed copying. The limited source search found no authorized public release. Public gameplay frames, captions, and official descriptions supplied the rubric. No restricted source or proprietary runtime asset was extracted. See [the public reference study](research/game-reference.md).

The game uses a modified CC-BY Rain portrait. It is not an AI-generated face. AI generation and shared-topology workflows were researched but not compared by generating faces. License, hardware, cost, privacy, and geographic restrictions remain explicit in [the face pipeline](research/face-pipeline.md).

Six pinned MIT Three.js skills are included under `.agents/skills/`. Their licenses, source revisions, integrity check, and API cautions are in [the skill selection](research/skills.md).

## Open checks

- Two first-time people have not performed the two-minute task.
- Physical phones, Safari, Firefox, hardware graphics, and a person's screen-reader workflow remain untested.
- Worst-case documents, long sessions, and truly simultaneous cross-tab storage writes have not been stress-tested.
- Multi-tab sequential saves and badge refresh pass. A synchronous read-modify-write does not prove cross-agent atomicity. No stronger storage guarantee is claimed.
- There is one sculpt and limited hair and lash variation. No live opponents, public gallery, progression, moderation, or real human voting exists.
- Local remix links are tested between browser contexts, not between two people on a deployed origin.
- Market leadership, retention, reference-game parity, and viral growth are not established.

These limits are product and evidence gaps, not hidden test passes. [The roadmap](roadmap.md) separates their next phases from the playable first version.

## Independent trail and source reviews

The cross-family trail reviewer ran on `zai/glm-5.3`. It checked every then-existing decision row against this run's transcript and resolved all primary evidence files. It confirmed the final test counts, current bundles, preserved old portrait, honest reference limits, and separate performance datasets. Its report is `tmp/verification/trail-review.md`.

The review requested a closing font-verification row and a durable root console receipt. Both are now present. The first console extraction matched its own active command and failed. The append-only trail explicitly supersedes its premature receipt row with the successful extraction. The landscape polish and limited multi-tab evidence are also explicit in the trail.

The final source and comment review ran on `zai/glm-5.3-flash` and reported no necessary source fixes or suppressions. See `tmp/verification/source-final-review.md`. Whitespace checks pass for authored files. Original third-party license bytes remain unchanged, including their upstream line endings and whitespace.
