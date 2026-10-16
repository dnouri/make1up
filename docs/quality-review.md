# Independent gameplay and visual review

Review date is 2026-10-16 UTC. The serving model was `openai-codex/gpt-6.1-sol`, as recorded by this child session's environment.

## Overview

**The painting evidence is good. The full acceptance gate is not met.** This is a working solo makeup editor, not a preset selector. Direct mouse and emulated touch strokes, correction, saving, PNG export, and private remix import worked. The reviewer-assigned rubric result is **72.5 of 100**, below the required 80.

The worst proven editing issue is an invisible stroke that still consumes a gesture and an Undo step. Phone layout and decorative text also interfere with the editing and reveal tasks. No destructive Undo, persistent crash, or failed Finish action was reproduced.

This review does not establish parity with Facecard's identities, catalog, multiplayer, or community. It does not claim real-phone parity, a first-time human usability test, or a player-retention result.

## Method and limits

- The tested artifact was the production preview at `http://127.0.0.1:4175`. Its script was `assets/index-BbTj0brA.js`. The script identifier remained unchanged at the final check.
- The desktop browser used a 1440 by 1000 CSS-pixel viewport. The phone context used Android device emulation with touch and a device pixel ratio of three. Both 390 by 844 and 844 by 390 CSS pixels were tested.
- The named browsers were `visualjudge` and `visualjudge-phone`. Both started with isolated, empty local storage. Both are closed. Temporary independent contexts used for sharing and reproduction are also closed.
- The actual reference images were opened and inspected. They were `tmp/reference/facecard-promo-1.webp` and `tmp/reference/facecard-pixiiuwu-frame-0083.png`. The rubric came from [game-reference.md](research/game-reference.md).
- Screenshots and downloaded PNGs were inspected. Counters and button labels alone were not accepted as proof of paint, correction, or export.
- This reviewer changed no application source, server, or dependency. This review did not run the Roblox client or test two independent people.

The [environment record](../tmp/verification/visual-review/environment.txt) identifies the model and bundle. The [browser close check](../tmp/verification/visual-review/browser-close-check.log) records cleanup.

throughput checkpoint: n/a, read-only investigation.

## Verified behavior and actual comparisons

These are before-and-after interactions within this build. They are not comparisons with an earlier implementation.

| Task | Observed result and evidence |
| --- | --- |
| Direct blush and mirror | A mouse drag painted both cheeks with Mirror on. A second drag with Mirror off changed only one cheek. Compare [initial](../tmp/verification/visual-review/01-desktop-initial.png), [mirrored stroke](../tmp/verification/visual-review/02-direct-blush-mirror-on.png), and [asymmetric stroke](../tmp/verification/visual-review/04-blush-mirror-off.png). |
| Before and after | Before mode removed the applied blush from view and disabled painting. The original work returned after leaving Before mode. The [Before screenshot](../tmp/verification/visual-review/03-before-view.png) differs visibly from the painted portrait. |
| Precision eyes and history | A freehand angular liner stroke followed the mouse in Eyes view. Undo removed that stroke while keeping the blush. Redo restored it. Compare [before](../tmp/verification/visual-review/05-eyes-liner-before.png), [stroke](../tmp/verification/visual-review/06-direct-liner.png), [Undo](../tmp/verification/visual-review/07-liner-undo.png), and [Redo](../tmp/verification/visual-review/08-liner-redo.png). |
| Blend and erase | Erase removed the drawn wing without removing the base eye or cheek paint. Undo restored the wing. A larger Blend brush then softened the existing black line. Compare [erase](../tmp/verification/visual-review/14-liner-erased.png), [restoration](../tmp/verification/visual-review/15-erase-undo.png), [blend](../tmp/verification/visual-review/17-large-blend.png), [blend Undo](../tmp/verification/visual-review/18-large-blend-undo.png), and [blend Redo](../tmp/verification/visual-review/19-large-blend-redo.png). |
| Precision lips | Direct mouse strokes made plum upper and lower lips in Lips view. The resulting lip color and gloss are visible. Compare [before](../tmp/verification/visual-review/20-lips-before.png) and [painted lips](../tmp/verification/visual-review/21-direct-plum-lips.png). |
| Turn and styling | A drag in Turn changed the viewing angle without adding a paint gesture. Olive irises, Deep tint, plum hair tint, and the tucked front curl produced visible changes. See [turn](../tmp/verification/visual-review/23-turned-portrait.png), [styling choices](../tmp/verification/visual-review/24-styling-options.png), and [changed portrait](../tmp/verification/visual-review/25-deep-styled-look.png). |
| Direct accent | A direct click placed two gold five-point stamps with Mirror on. The PNG contains those stamps. Compare [before](../tmp/verification/visual-review/80-accent-before.png), [stamps](../tmp/verification/visual-review/81-direct-sparkle.png), and [export](../tmp/verification/visual-review/82-sparkle-export.png). |
| Three consecutive briefs | Orchid hour, Graphic night, and Rose editorial finished without a reload between those rounds. Next brief cleared the previous makeup for the next round. The results were 70, 85, and 100. See [first result](../tmp/verification/visual-review/36-same-makeup-light-skin-score.png), [second result](../tmp/verification/visual-review/38-round-2-result.png), [third result](../tmp/verification/visual-review/39-round-3-result.png), and the [round log](../tmp/verification/visual-review/three-rounds.log). The later two rounds used Guided apply. The first used direct painting. |
| Timer and practice | The three-minute timer expired under an advanced browser clock. The visible cheek and lip paint remained, and editing locked. The five-minute selection displayed its stated duration. Practice remained editable after six simulated minutes and finished without a score. See [timer expiry](../tmp/verification/visual-review/65-timer-expired.png), [practice result](../tmp/verification/visual-review/67-practice-finished.png), and [mode check](../tmp/verification/visual-review/session-modes-check.log). This was not a real-time stopwatch test. |
| Save and reopen | A saved thumbnail survived reload. Reopening restored the painted look and appearance. The restored PNG was byte-identical to the original PNG. See [lookbook](../tmp/verification/visual-review/30-saved-lookbook.png), [restored editor](../tmp/verification/visual-review/31-restored-look.png), and [matching hashes](../tmp/verification/visual-review/export-sha256.txt). |
| Export and private sharing | The inspected [1080 by 1350 PNG](../tmp/verification/visual-review/28-original-export.png) matched the finished makeup and styling. Copy link copied the generated URL. Import in an independent context with empty storage restored the look and produced another byte-identical PNG. See [share dialog](../tmp/verification/visual-review/29-share-dialog.png), [fresh-context import](../tmp/verification/visual-review/33-private-remix-fresh-context.png), and [import check](../tmp/verification/visual-review/private-remix-check.log). This was same-machine automation, not two people or a public sharing service. |
| Damaged link | A damaged compressed link produced an explicit message and preserved the current look. See [recovery screenshot](../tmp/verification/visual-review/79-invalid-remix-recovery.png) and [check](../tmp/verification/visual-review/invalid-share-check.log). |
| Phone touch | Native browser touch events painted the cheeks, mirrored liner, and lips. Painting did not scroll the page. Undo and Redo restored visible cheek paint. Touch Turn changed the angle without adding a gesture. See [touch paint](../tmp/verification/visual-review/41-phone-direct-touch.png), [Undo](../tmp/verification/visual-review/43-phone-undo.png), [Redo](../tmp/verification/visual-review/44-phone-redo.png), [liner](../tmp/verification/visual-review/46-phone-direct-liner.png), [lips](../tmp/verification/visual-review/48-phone-direct-lips.png), and [Turn](../tmp/verification/visual-review/49-phone-native-turn.png). |
| Landscape touch | At 844 by 390, a touch stroke placed an asymmetric forehead line. Erase removed it, Undo restored it, and Redo removed it again. Native touch Blend softened the restored line. Eyes and Lips views worked. The settings panel scrolled independently while keeping the portrait visible. See [line](../tmp/verification/visual-review/54-landscape-unrestricted-liner.png), [erase](../tmp/verification/visual-review/55-landscape-native-erase.png), [Undo](../tmp/verification/visual-review/56-landscape-undo.png), [Redo](../tmp/verification/visual-review/57-landscape-redo.png), [Blend](../tmp/verification/visual-review/58-landscape-native-blend.png), [Lips](../tmp/verification/visual-review/59-landscape-lips.png), and [finished result](../tmp/verification/visual-review/60-landscape-finished.png). The [downloaded portrait](../tmp/verification/visual-review/61-touch-look-export.png) retained the actual marks. |
| Keyboard and clear | Keyboard tool selection and Enter on Finish worked. Clear required confirmation. Escape cancelled Clear without losing the painted look. See [confirmation](../tmp/verification/visual-review/69-clear-confirmation.png) and [keyboard check](../tmp/verification/visual-review/keyboard-baseline-check.log). This was not a complete keyboard-accessibility audit. |

## All proven defects and usability findings

No item below is a claim that a first-time human failed. Severity reflects the observed effect on editing, not a measured failure rate.

### D1. Invisible edits still enter history

This is the worst proven editing issue. The area restriction can be intentional. Recording an edit that changes nothing is the defect.

Reproduction steps use the desktop viewport.

1. Start a fresh portrait and keep Blush selected.
2. Select Eyes view and Ink color.
3. Set Opacity to 100 percent and Softness to zero.
4. Drag across the forehead, from approximately 590,446 to 678,446.
5. Observe no painted mark, but a change from zero to one gesture and an enabled Undo control.
6. Paint a cheek with the same tool. That produces a visible mark.
7. Undo the cheek. A second Undo is still needed to remove the invisible history entry.

The exports before and after the forehead stroke are byte-identical. The positive cheek control rules out a disconnected brush. See [before](../tmp/verification/visual-review/proof-noop-before.png), [invisible edit](../tmp/verification/visual-review/proof-noop-after.png), [positive control](../tmp/verification/visual-review/proof-noop-positive-control.png), [hashes](../tmp/verification/visual-review/noop-export-sha256.txt), and [independent reproduction](../tmp/verification/visual-review/noop-independent-repro.log).

The rerunnable probe is [reproduce-noop.js](../tmp/verification/visual-review/reproduce-noop.js). Erasing the untouched base eye also added a gesture without changing its export. That is another instance of the same no-effect history problem, not a second unrelated defect.

### D2. Phone correction requires leaving the main workspace

At 390 by 844, Undo, Redo, and the brush settings are below the first viewport. Paint a cheek, then scroll to Undo. The top of the portrait and the first tool buttons leave view. Repeated painting and correction require page movement rather than one stable workspace.

See the [initial workspace](../tmp/verification/visual-review/40-phone-initial.png), [Undo location](../tmp/verification/visual-review/42-phone-undo-location.png), and [bounds record](../tmp/verification/visual-review/phone-direct-check.log). This is friction, not an unreachable control. Landscape's independently scrolling settings panel worked better.

### D3. Decorative text covers the face during precision work

Select Eyes at 390 by 844. The large "Orchid hour" text covers part of the forehead and left brow. The longer "Rose editorial" text also overlaps the brow area on desktop. The same screen already shows the brief outside the canvas.

See [phone Eyes](../tmp/verification/visual-review/45-phone-eyes.png) and [desktop Rose Eyes](../tmp/verification/visual-review/70-masked-blush-before.png). This is visual obstruction. It is not evidence that pointer events are blocked. The exported portrait does not have this obstruction.

### D4. Phone Finish scrolls the finished portrait away

Finish a painted look at 390 by 844. The viewport moves to the score panel. Only a strip of the portrait remains at the top. The final artwork cannot be inspected beside its critique.

See the [immediate finished viewport](../tmp/verification/visual-review/50-phone-finish.png) and [full-page result](../tmp/verification/visual-review/51-phone-finish-full.png). The full-page image proves that the portrait still exists. This is a weak reveal, not lost paint.

### D5. Phone tool names disappear

At 390 by 844, the tools are icons without visible names. Selecting Liner changes the highlight, but does not show the word "Liner" in the workspace. The help names tools, while the phone must identify them by icon.

See [selected Liner](../tmp/verification/visual-review/45-phone-eyes.png). Accessible names exist in the browser snapshot. This finding concerns visible touch discoverability, not missing accessible labels or a proven human error.

## Reference comparison and scope gaps

The [comparison sheet](../tmp/verification/visual-review/reference-comparison.png) contains the actual requested reference images and current portrait exports. It is a resized review aid, not a pixel-parity test.

The reference promotion shows fine lashes, varied hair detail, shaped brows, strong facial highlights, and glossy lips. The current product has a coherent cartoon portrait, readable makeup, and consistent editorial typography. Its large eyes and heavy default upper-eye outline give it a different character. It does not reach the same range of glam finishes shown in the promotion. This is a visual judgment, not a claim that the promotional image proves the reference editor's behavior.

The inspected reference editor frame exposes strength, softness, stabilizer, layers, and distinct lip tools. The current product's direct painting is real, but its creative range is narrower.

- Blush cannot place color on the forehead in the tested build. The help also states region restrictions for Eyeshadow and Lipstick. Only the blush rejection was isolated with an export comparison.
- Liner is an important exception. It successfully painted an arbitrary forehead shape. The product is therefore not restricted to guided presets. An explicit free-paint option would make this ability easier to find.
- No layer or stabilizer control was offered in the tested editor. The exact equivalent out-of-region stroke was not tested in Facecard, so its acceptance is unknown.
- The base heavy upper-eye outline remains after Clear and Erase. See [the erased base](../tmp/verification/visual-review/76-baseline-liner-not-erasable.png). The absence of a bare-eye or lash-style choice limits delicate looks.
- The styling panel explicitly describes one Rain portrait, one sculpt, and a neutral expression. Tints and a tucked curl worked. They are not a catalog of different face identities, hair silhouettes, or lashes. See [the styling panel](../tmp/verification/visual-review/24-styling-options.png).

The editor provides practical replay paths. Next brief, Remix this look, clean replay, optional timers, practice, the local lookbook, and private remix links all give a reason to make another look. Three selectable briefs were present. No collection progression, unlock path, public gallery, human vote, or live-opponent flow was offered in the tested UI. Longer-term replay appeal is therefore an inference, not an established retention result. A Rose editorial result reached 100 with two guided applications, so score completion alone offers little continued challenge.

## Rubric grades

Scores are reviewer judgments on the rubric in `docs/research/game-reference.md`. Weighted points equal the category weight multiplied by its score and divided by four.

| Category | Weight | Score | Weighted points | Evidence and limit |
| --- | ---: | ---: | ---: | --- |
| Makeup UX | 25 | 3 | 18.75 | Mouse and native emulated touch made real strokes. Blend, erase, mirror, views, and history changed the actual images. D1 prevents full credit for reliable correction. |
| Customization | 15 | 2 | 7.50 | Colors, iris maps, complexion and hair tints, a tucked curl, and stamps made visibly different results. Save and import preserved them. One sculpt and a narrow hair and lash range limit the outcome. |
| Challenge loop | 15 | 4 | 15.00 | Three consecutive briefs finished and replayed without reload. The brief stayed visible. Timed expiry preserved the paint. Practice finished without a score. Timer expiry used a controlled browser clock. |
| Judging fairness | 10 | 3 | 7.50 | The same saved or imported submission returned 70. Changing Deep tint to Source warm retained 70. The four numeric criteria explain the sum. See [published result criteria](../tmp/verification/visual-review/27-round-1-rules.png), [repeat check](../tmp/verification/visual-review/private-remix-check.log), and [tint check](../tmp/verification/visual-review/skin-score-check.log). Coverage percentages came from the app and were not independently recomputed. No human-voting fairness is credited. |
| Social and share | 10 | 3 | 7.50 | Local save, matching PNG export, copied remix URL, independent-context import, and damaged-link recovery worked. Local limits are explicit. This is the rubric's solo maximum, not multiplayer credit. |
| Onboarding and mobile | 10 | 2 | 5.00 | The core task finished with emulated touch in both required sizes, with no horizontal overflow in those layouts. D2 through D5 remain. The required two first-time human tasks were not performed. |
| Aesthetic quality | 15 | 3 | 11.25 | The face, makeup, selected states, typography, and export are coherent. The tested front and three-quarter views did not show a gross hair intersection or broken paint seam. Decorative text obstructs precision work, and the one portrait cannot produce the reference's range of finishes. This is one independent reviewer, not the rubric's two-reviewer maximum test. |
| Total | 100 | | 72.50 | The 80-point gate is not met. Every category is at least two. Makeup UX and aesthetic quality are each three. |

## Three highest-value refinements for the next loop

1. **Stop invisible history entries and clarify region limits.** Do not record a stroke when it changes no makeup. Show a blocked-area cursor or short feedback for a rejected stroke. Make an unrestricted brush discoverable, while keeping safe region masks optional. This directly repairs D1 and supports free creative work. Re-run the saved probe. The forehead attempt must leave both the portrait and history unchanged, while the cheek control must still paint.
2. **Keep phone correction and the finished art visible.** Put Undo, Redo, the active tool name, and a brush-size control near the phone canvas. Do not scroll the finished portrait away without keeping a useful portrait preview beside the result. This addresses D2, D4, and D5. Verify the paint, Undo, view, and Finish sequence again at 390 by 844 and 844 by 390 without automated scrolling to hidden controls.
3. **Remove canvas decoration during precision painting.** Hide the large issue title and editorial captions in Eyes and Lips views. Retain them in the reveal or export if desired. This addresses D3 without changing the portrait model. The acceptance screenshot must show the complete editable brow, lid, cheek, and lip regions without text over them.

After these changes, more fitted lash and hair choices and more authored briefs would address the separate customization and replay limits. Fake opponents would not repair those limits.

## Remaining checks

- Run the two first-time human tasks from the rubric. Test real phones separately. Browser touch emulation does not prove finger accuracy, browser chrome behavior, GPU support, or thermal stability.
- Add independent coverage-boundary checks before assigning full judging-fairness credit.
- Test actual cross-device link delivery on a deployed origin before claiming remote sharing. A `127.0.0.1` preview link is not a public address.
- One fresh-context export probe exceeded the automation tool's default download wait. The repeated probe with a larger wait completed and preserved the evidence. No persistent export failure or cause was established. This is an unresolved test-time observation, not a measured product latency claim.
- The recorded console error queries returned zero errors for their captured periods. This is not a long-session stability or performance assessment.

Prove It Works shaped the evidence method. It required real screenshots, downloaded image inspection, and byte comparisons instead of trusting labels. Experience First shaped the priorities. It placed uninterrupted painting and a readable finished portrait ahead of adding a larger menu.
