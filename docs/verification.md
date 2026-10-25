# V2 verification record

This record covers the v2-only solo game and the customization workspace delivered in `057620a`. It does not establish social-game parity, human usability, or physical-device performance.

## Completed implementation checks

The full workspace handoff is `tmp/avatar-customization/workspace/handoff.md`. It records these completed checks:

| Check | Result | Evidence |
| --- | --- | --- |
| Unit behavior | 198 tests passed in 10 files. | `npm test`, `tmp/avatar-customization/workspace/unit-full.log`. |
| Strict TypeScript | Passed. | `npm run typecheck`, `tmp/avatar-customization/workspace/typecheck.log`. |
| V2 asset preflight | Passed. The invocation checks geometry, maps, paint UVs, masks, and notices without render approval. | `npm run verify:assets`, `tmp/avatar-customization/workspace/assets.log`. |
| Production Chromium matrix | 131 checks passed, 13 intentional skips, no failures, and no flaky checks. | `npm run verify:browser`, `tmp/avatar-customization/workspace/browser-matrix.log`, `tmp/app-implementation/browser-results.json`. |
| Whitespace | Passed. | `git diff --check`, recorded in the workspace handoff. |

`npm run verify` runs unit tests, strict TypeScript, the public v2 preflight, and the production browser matrix in that order. The public asset checker uses the generated files and does not need the Blender source download. Only regeneration needs that source. The [asset handoff](../public/face/HANDOFF.md) gives the paths and generation commands.

Playwright builds the production app and runs Chromium with software WebGL. Its standard projects use 1440 by 1000, 390 by 844, and 844 by 390 CSS pixels. The dedicated customization suite adds compact desktop and small portrait-phone sizes. Intentional skips avoid duplicate viewport runs in the wrong input project and exclude phone-only workflows from desktop. No retry policy hides failures.

## Visible customization at five sizes

Production measurements were taken after scrolling to the last hairstyle choice. The stage and view controls remained fully visible and did not move while the choices scrolled. Document scroll stayed at 0, with no horizontal overflow or footer overlap. Visible choices, history, Done, zoom, retry, and credit targets were unobstructed and at least 44 px.

| Viewport in CSS pixels | Stage top to bottom | Stage height | View controls bottom | Footer top |
| --- | --- | --- | --- | --- |
| 1440 by 1000 | 72 to 884 | 812 | 928 | 944 |
| 1280 by 720 | 72 to 604 | 532 | 648 | 664 |
| 390 by 844 | 56 to 358.47 | 302.47 | 402.47 | 788 |
| 320 by 568 | 56 to 242.55 | 186.55 | 286.55 | 512 |
| 844 by 390 | 56 to 290 | 234 | 334 | 342 |

At 390 by 844, the old collapsed panel left the portrait at 0% visibility when the hair-color controls were visible. The stage was above the viewport, with top -602.97 and bottom -284.97 at document scroll 907. The new workspace retained 100% portrait visibility while the controls scrolled. This is layout evidence, not a rendering-speed result.

The measurements are in `tmp/avatar-customization/workspace/production-layouts.json`. The before image is `tmp/avatar-customization/workspace/baseline-phone-scrolled.png`. The passing production screenshots inspected for the implementation are:

- `tmp/avatar-customization/workspace/production-1440x1000-customize-scrolled.png`.
- `tmp/avatar-customization/workspace/production-1280x720-customize-scrolled.png`.
- `tmp/avatar-customization/workspace/production-390x844-customize-scrolled.png`.
- `tmp/avatar-customization/workspace/production-320x568-customize-scrolled.png`.
- `tmp/avatar-customization/workspace/production-844x390-customize-scrolled.png`.

The 320 by 568 result covers customization. The normal makeup workspace still has its existing 300 px minimum stage and fixed phone docks. Its return probe found stage overlap with the correction dock. That smaller editing layout was not redesigned. Existing 390 px and landscape correction checks pass after returning from customization.

## Behavior and failure coverage

The current tests cover these contracts:

- One canonical v2 identity and document, the fresh v2 storage key, and rejection of older or malformed documents.
- The full-face tool rule, lipstick masking, gesture transactions, no-effect rejection, blend behavior, exact undo and redo, and assessment of final paint.
- Shared-topology shape changes, per-instance morph picking, visible-object occlusion, selected color maps, and ponytail or crown-bun components.
- Stale appearance requests, loading failures, retry, capture restoration, and readiness guards on paint and Finish.
- The same canvas and WebGL context across workspaces, native radio keyboard behavior, focus and scroll containment, camera restoration, and visible pixel changes.
- Challenge, practice, timed expiry, local save and reopen, invalid links, quota failure, PNG parity, WebGL failure views, and phone correction after a workspace round trip.

Ready-appearance timer expiry exits customization and preserves normal result focus. When the requested appearance is pending or failed, the existing Finish guard delays submission until readiness. The workspace change did not alter that boundary.

The first dedicated workspace run found a test-only hidden-radio locator error. The corrected test addresses the hidden DOM input directly to check focus rejection. Strict TypeScript also caught an overly broad element-handle type in the new test. Both repairs preceded the passing runs. The failures remain recorded in the workspace handoff.

## Asset and analysis correctness

`scripts/verify-assets.mjs` checks `public/face/v2/` against the registry and `art/neutral/` authoring inputs. It checks all 54 shape combinations, locked topology and UVs, combined deformation bounds, triangle area and orientation, fitted lashes, closed-mouth samples, bun closure, map detail, neck matching, and distributed notices. The routine public invocation uses `--geometry-only`. Human art approval and exhaustive self-intersection checking are separate checks.

The implementation also recorded a passing analysis self-check with a 512 MB Node heap cap. Four shared paint-field fixtures produced matching analysis outputs and unchanged input bytes. The receipt is `tmp/avatar-customization/analysis-fixture-probe-3.log`, with the heap limit recorded in `tmp/avatar-customization/decisions.tsv`.

The analysis assertion repair uses byte-wise comparison for large paint fields. Both analyzers receive the same frozen-painter stroke field instead of comparing painters whose placement policies intentionally differ. This proves analysis correctness, not equivalent old and new paint placement. `node scripts/bench-analysis.mjs --self-check` performs no timing or profiling. The [benchmark guide](../benchmarks/README.md) describes the fixture and separate measurement commands.

A correctness-only production-browser probe loaded the v2 entry and asset contract, performed real work, and reported zero application errors in desktop and emulated-phone contexts. Its scope is recorded in `tmp/avatar-customization/measure-v2-probe-claim.md`. Results are in `tmp/avatar-customization/measure-v2-probe/probe-summary.json`.

Neither the heap-capped self-check nor that browser probe establishes a performance verdict. No speedup, regression, frame rate, device budget, or physical display-latency claim follows. Earlier timing datasets remain historical and are not evidence for the current v2 asset or workspace.

## Open checks and evidence limits

The following checks remain open:

- Two first-time players have not completed the two-minute editing task without spoken help.
- Physical Android phones, iPhones, Safari, Firefox, hardware graphics, thermal behavior, and browser-chrome viewport changes need testing.
- A person has not completed a screen-reader workflow. Automated labels, focus, and native keyboard checks do not replace that test.
- The normal makeup layout at 320 by 568 needs a separate review and repair.
- Further human art review is needed for combined shapes, lash fit, complexion and hair extremes, natural lips, neck seams, and both hairstyles.
- Worst-case documents, long sessions, and simultaneous cross-tab storage writes have not been stress-tested. Sequential multi-tab saves do not establish atomic writes.
- Remix links work between browser contexts. Two people have not tested the flow on an approved deployed origin.
- There is no multiplayer, human voting, public gallery, progression, or moderation service. Retention, reference-game parity, market leadership, and viral growth are not established.

The portrait is a modified CC-BY Rain derivative, not AI-generated artwork. Its color maps are offline recolors, not newly photographed skins. The [third-party notices](../THIRD_PARTY_NOTICES.md) identify the source and licenses. Historical research and quality reviews retain the claims and limits of their original runs. The [roadmap](roadmap.md) separates the remaining work from completed v2 behavior.
