# Independent final gameplay and visual review

Review date is 2026-10-16 UTC. The actual serving model was `openai-codex/gpt-6.1-sol`, as recorded in this child session's environment.

## Overview

**ISSUES. D1 through D5 are resolved in the tested production build.** The revised editor supports direct painting and correction without leaving the main phone workspace. Its finished phone portrait and score are visible together. The first cold PNG export also uses the correct title font.

The original rubric now gives **81.25 of 100**. This clears its numerical threshold. It does not establish reference-game parity or a world-best result. Customization remains narrow, and the finished portrait has a different visual character from Facecard. A newly documented, minor text collision remains in the short landscape cover.

No persistent crash, destructive Undo, or nonfunctional Finish was reproduced. This review does **not** clear the complete release gate. The concurrent root test log contains one unresolved test timeout. Two first-time humans and physical phones were not tested.

throughput checkpoint: n/a, read-only investigation.

## Artifact and method

The preview was `http://127.0.0.1:4175/`. These exact production modules loaded in the browser and retained their SHA-256 values at the final artifact check.

| Module | SHA-256 |
| --- | --- |
| `assets/index-CJKjoIg8.js` | `1b57f514c1f9999130be98c0ed31f51367113fa6b0d056404c3f1a35f9b1b67f` |
| `assets/portrait-8xlhgHbs.js` | `81f898894faa30f011b979380dd3fde2178d69e3e94f6b9befb31fa63a33b723` |

The [environment record](../tmp/verification/final-visual/environment.txt) and [closing artifact check](../tmp/verification/final-visual/final-artifact-check.txt) also identify the stylesheet. Desktop used 1440 by 1000 CSS pixels. Touch emulation used 390 by 844 and 844 by 390 CSS pixels. Touch strokes came from Chromium's native touch input, not synthetic application callbacks. The browser recorded trusted pointer events with `pointerType` equal to `touch`.

The named sessions were `final-visual` and `final-visual-phone`. They had isolated storage. Both are [closed](../tmp/verification/final-visual/browser-close.log). The temporary cold-export context is also closed. No application source, build, server, dependency, or other reviewer's session was changed.

This review used the exact [original rubric](research/game-reference.md), the [baseline review](quality-review.md), and the [no-effect handoff](../tmp/refinement/no-effect/handoff.md). I inspected actual screenshots and downloaded PNGs. The baseline supplies retained breadth evidence where this focused re-evaluation did not repeat every case. The root's concurrent broad tests are separate evidence, not this reviewer's visual judgment.

## D1 through D5 retest

| Original defect | Final result and direct evidence |
| --- | --- |
| D1. Invisible edits enter history. | **Resolved.** With Blush, Ink, 100 percent opacity, zero softness, and Eyes view, the original drag from 590,446 to 678,446 left zero gestures and disabled Undo. Its PNG was byte-identical to the initial PNG. The same brush visibly painted the cheeks from 785,710 to 807,727 as one gesture. Undo restored the initial PNG. Another rejected forehead attempt preserved Redo, which restored the exact painted PNG. See [rejection](../tmp/verification/final-visual/04-d1-no-effect.png), [positive cheek control](../tmp/verification/final-visual/06-d1-positive-cheek.png), [preserved Redo](../tmp/verification/final-visual/10-d1-no-effect-preserves-redo.png), and [PNG hashes](../tmp/verification/final-visual/d1-export-sha256.txt). The rejected stroke also gives explicit feedback. |
| D2. Phone correction requires leaving the workspace. | **Resolved at 390 by 844.** Undo, Redo, Clear, Quick brush size, the active tool, and its region hint are visible beside the portrait. A native touch tap changed Liner size from 0.6 to 1.0 percent. Painting, Undo, Redo, and view selection kept page scroll at zero. See the [initial workspace](../tmp/verification/final-visual/20-phone-initial.png), [selected Liner and size](../tmp/verification/final-visual/22-phone-liner-controls.png), and [control bounds](../tmp/verification/final-visual/phone-controls.log). |
| D3. Decorative text covers precision work. | **Resolved.** Eyes and Lips remove the cover title, footer, and side note while the brief remains outside the canvas. Inspect [desktop Eyes](../tmp/verification/final-visual/04-d1-no-effect.png), [desktop Lips](../tmp/verification/final-visual/13-desktop-lips.png), [phone Eyes](../tmp/verification/final-visual/21-phone-eyes.png), [phone Lips](../tmp/verification/final-visual/27-phone-lips-before.png), and [landscape Lips](../tmp/verification/final-visual/50-landscape-lips.png). These are actual rendered images, not checks of hidden labels alone. |
| D4. Phone Finish scrolls the art away. | **Resolved.** Immediately after a native-touch look finished, the full portrait and its 100-point brief-match score were visible together. The portrait occupied approximately y12 to y375. The score occupied y603 to y678. The correction and Finish docks were hidden. See the [immediate result](../tmp/verification/final-visual/35-phone-immediate-finish.png) and [bounds and input record](../tmp/verification/final-visual/phone-paint-finish.log). The result is a brief match, not a beauty assessment. |
| D5. The phone gives no visible active tool name. | **Resolved.** The compact correction area names Liner and says "Anywhere on the paintable face." Selecting Lipstick changes both the name and hint to "Lips only." See [Liner](../tmp/verification/final-visual/22-phone-liner-controls.png) and [Lipstick](../tmp/verification/final-visual/27-phone-lips-before.png). Unselected rail tools still use icons. First-time human recognition remains untested. |

The desktop D1 command exceeded the automation client's 180-second wait after it had saved all requested images. The [separate final-state query](../tmp/verification/final-visual/desktop-d1-current.log), inspected screenshots, and downloaded hashes establish the result. This was not recorded as a successful command transcript.

## Actual editing, rotation, and export

### Native touch and correction

A touch drag made a freehand liner wing in Eyes view. Mirror produced the other wing. Undo removed the new wings, and Redo restored them. The [painted image](../tmp/verification/final-visual/24-phone-native-liner.png), [Undo image](../tmp/verification/final-visual/25-phone-liner-undo.png), and [touch-event log](../tmp/verification/final-visual/phone-native-liner.log) agree.

Further native strokes painted plum lips, rose cheeks, and orchid lids. Five gestures produced the [finished editor look](../tmp/verification/final-visual/34-phone-before-finish.png). No Guided apply was used for that look. The [1080 by 1350 exported PNG](../tmp/verification/final-visual/36-phone-final-export.png) retains the actual wing shapes, lid color, cheek placement, and glossy lip paint.

A separate correction sequence added liner over existing work, painted a cheek, and blended it. Undo reversed the blend, cheek, and liner in sequence. Redo restored all three without removing the earlier forehead work. See [painted cheeks](../tmp/verification/final-visual/72-cheek-history-painted.png), [blend detail](../tmp/verification/final-visual/79-cheek-blend-detail.png), [cheek Undo with liner retained](../tmp/verification/final-visual/76-cheek-history-cheek-undo.png), and [restored work](../tmp/verification/final-visual/78-cheek-history-all-restored.png).

The [history log](../tmp/verification/final-visual/phone-cheek-history.log) records the sequence. Exact comparisons of the cropped portrait returned zero changed pixels for blend Undo, cheek Undo, and full Redo restoration. See the [pixel comparisons](../tmp/verification/final-visual/cheek-history-pixel-comparisons.txt). These comparisons used reduced motion because the normal live portrait floats slightly. The earlier motion-on images remain in `tmp/verification/final-visual/motion-on/`. The live-image comparisons do not replace the independent canonical PNG checks for D1.

### Landscape controls

At 844 by 390, all seven tools, view controls, Mirror, Quick brush size, correction buttons, and Finish were inside the viewport. Their centers were unobstructed. The page had no horizontal overflow. See the [rendered workspace](../tmp/verification/final-visual/41-landscape-eyes-liner.png) and [bounds record](../tmp/verification/final-visual/landscape-controls.log).

Native touch drew an asymmetric forehead line. Undo removed it and Redo restored it. Native Blend softened it, and its own Undo and Redo worked. Inspect [line](../tmp/verification/final-visual/43-landscape-native-liner.png), [blend](../tmp/verification/final-visual/47-landscape-native-blend.png), and [blend Undo](../tmp/verification/final-visual/48-landscape-blend-undo.png). The [finished landscape view](../tmp/verification/final-visual/51-landscape-finish.png) also shows both artwork and score. Its zero score is consistent with a forehead-only experiment, not an export failure.

### First-export font stability

A fresh mobile context began with the italic Bodoni Moda face unloaded. I delayed its font response during the first export. No manual font preload ran in the probe. The export requested the italic font and completed after that response. Both exports contained the same cheek paint and were byte-identical.

Inspect the [painted editor](../tmp/verification/final-visual/61-cold-export-painted.png), [first PNG](../tmp/verification/final-visual/62-cold-first-export.png), and [second PNG](../tmp/verification/final-visual/63-cold-second-export.png). The [font request order](../tmp/verification/final-visual/cold-export-fonts.log) and [SHA-256 values](../tmp/verification/final-visual/cold-export-sha256.txt) support the result. This is a correctness check, not a performance measurement.

## Independent reference comparison

I opened the actual `tmp/reference/facecard-promo-1.webp` and `tmp/reference/facecard-pixiiuwu-frame-0083.png`, then compared them with the current exported portrait. The [comparison sheet](../tmp/verification/final-visual/reference-comparison.png) preserves those exact inputs at reduced sizes.

The current portrait has readable eyes, distinct makeup, consistent lighting, and a clean export frame. Its bright irises, large cartoon eyes, thick default upper-eye outline, and compact hair shape are coherent. They do not reproduce the promotion's fine lashes, delicate brow shape, varied hair detail, or glossy glam finish. This is a visual judgment about the inspected images. The promotion does not prove the reference editor's behavior.

The current tool set supports real freehand work. It remains narrower than the sampled reference editor's layers, stabilizer, and separate lip controls. Those missing options do not invalidate the current brush test. They do limit creative range. The fixed portrait, default eye outline, and limited fitted hair and lash choices still restrict recognizably different looks.

## Remaining findings and release status

### F1. Short landscape cover text collides

At 844 by 390 in Face view, the italic "hour." title overlaps the "own muse." footer. Both the [initial cover](../tmp/verification/final-visual/40-landscape-initial.png) and [finished cover](../tmp/verification/final-visual/51-landscape-finish.png) show the collision. This is a minor presentation defect. It is newly documented here, not a proven regression from the baseline. Eyes and Lips remain clear, and the PNG export does not contain this collision.

### The broad automated gate is not yet cleared

The [concurrent root log](../tmp/verification/final-gate.log), as read during this review, records 47 passed tests, three skips, and one failure. The failure is a 60-second whole-test timeout while waiting for a desktop PNG download in the correction test. No assertion established wrong paint or history. This reviewer did not rerun that exact case or establish its cause. The root must resolve that result before claiming a clean automated release gate.

No runtime release blocker was reproduced by this independent review. A minor cover-text collision, narrow customization, and the missing human and device checks remain. The inspected console-error query returned zero errors for the captured phone session. That is not a long-session stability guarantee.

## Grades under the original rubric

Scores are integers from zero to four. Weighted points equal `weight × score / 4`. The grade changes below follow observed defect resolution, not an 80-point target.

| Category | Weight | Final score | Weighted points | Evidence and limit |
| --- | ---: | ---: | ---: | --- |
| Makeup UX | 25 | 4 | 25.00 | The final D1 rejection preserves exact paint and history. Mouse controls and native touch support real strokes. The liner, cheek Blend, Undo, and Redo sequence preserves unrelated work. Mirror and safe region limits work. This is browser touch emulation, not a physical-phone guarantee. The baseline supplies the earlier mouse Blend and precision checks. |
| Customization | 15 | 2 | 7.50 | Final painted colors differ visibly. Retained baseline and concurrent save tests cover tints, irises, curl choices, stamps, and restoration. One sculpt and a narrow hair and lash range still limit variation. No increase is justified. |
| Challenge loop | 15 | 4 | 15.00 | The final native-touch look finishes intact. The concurrent root tests pass three consecutive rounds and timed and practice behavior at all three sizes. The baseline independently recorded those flows. Timer expiry uses a controlled clock. |
| Judging fairness | 10 | 3 | 7.50 | The solo brief match identifies itself and publishes criteria. The baseline's repeat and skin-tint checks support consistency. Coverage boundaries were not independently recomputed in this re-evaluation. No human-vote fairness is credited. |
| Social and share | 10 | 3 | 7.50 | The final PNG matches visible makeup. Retained baseline evidence and current broad tests cover local save, restoration, private remix import, and failure recovery. This remains the rubric's solo maximum. No two-person or deployed cross-device flow was tested. |
| Onboarding and mobile | 10 | 3 | 7.50 | D2 through D5 are resolved. The editing task and Finish work with native browser touch at both required sizes. Required controls remain visible. The two first-time human tasks and physical-phone checks were not performed, so four is not justified. |
| Aesthetic quality | 15 | 3 | 11.25 | The actual final export and editor are coherent, with readable eyes, lips, paint, and selection states. Precision text obstruction is gone. F1, the heavy fixed eye outline, and limited glam variation remain. This independent comparison does not establish reference parity. |
| Total | 100 | | **81.25** | The numerical 80-point threshold is met. All categories are at least two. Makeup UX and aesthetic quality are at least three. The unresolved broad test result prevents a clean release-gate claim. |

The score rose from 72.5 because Makeup UX moved from three to four after D1 and correction verification. Onboarding and mobile moved from two to three after the workspace and reveal fixes. No other category increased.

## Evidence limits and next decisions

- Run the two first-time human tasks before claiming beginner usability. No two-minute completion claim is supported here.
- Test physical phones before claiming mobile-device parity. Emulation does not establish finger accuracy, browser chrome behavior, GPU support, or thermal stability.
- Resolve the root's desktop correction-test timeout. Do not describe the current broad log as fully green.
- Remove the short landscape cover-text collision in a later polish pass. It does not block painting or export in these checks.
- Retain explicit solo and local-sharing limits. No live opponents, public gallery, human voting, or multiplayer were verified.

Prove It Works shaped the method. It required actual production gestures, inspected PNGs, and exact history comparisons. Experience First shaped the judgment. It favored uninterrupted editing and a readable reveal over menu breadth. Explain the Number kept the 81.25-point rubric result separate from beginner success, device support, and reference-game parity.
