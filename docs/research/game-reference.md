# Public game references and acceptance rubric

Research date is 2026-10-16 UTC. This is a reference and design assessment for an original browser Three.js game. It is not a claim that the new game matches the complete Roblox service.

## Overview

**PASS.** The reference is an actual public Roblox experience. Its official page names makeup brushes, voting, freeplay, hair, lashes, and rhinestones. [S1] Public gameplay evidence includes five inspected video frames and the complete automatic English captions of two player videos. [S3] [S4]

**ISSUES.** This investigation did not play the Roblox client. Desktop video samples do not prove brush responsiveness, mobile usability, save reliability, vote integrity, or server behavior. The Dress to Impress screenshots are from a dated 2024 article, not its current client. [S3] [S7]

**BLOCKED.** Facecard's public game metadata says `copyingAllowed: false`. No developer-authorized source repository appeared in the narrow public searches below. That is not proof that no private or differently named repository exists. Server source was not available. [S2] [S10] [S12]

The practical target is a polished original makeup studio with a complete challenge, reveal, critique, and replay loop. Brush control and the finished portrait matter more than a large menu. Real multiplayer parity remains a separate requirement if the implementation has no real multiplayer.

throughput checkpoint: n/a, read-only investigation.

## Key concepts

The evidence labels prevent descriptions from becoming invented observations.

- **Observed** means a frame, screenshot, page text, or public response was inspected. A visible button proves its label, not that its action works.
- **Reported** means a creator, player, or guide describes behavior. Automatic captions can contain errors.
- **Inferred** means a conclusion drawn from evidence. It is not a measured property of the game.
- **Proposed** means an original-game requirement. It is not a reference-game fact.

No video was watched end to end. The Facecard video by pixiiuwu was sampled in the normal YouTube player. Its complete captions and Lalish's complete captions were read. Titles and descriptions alone do not support the inventory.

## Where the evidence lives

All paths below are relative to the project root. All external sources were accessed on 2026-10-16 UTC. The linked destinations returned the stated content in a browser or public HTTP response. Search snippets alone are not verified gameplay evidence.

A final anonymous HTTP link check finished at 00:50 UTC. Nine cited links returned HTTP 200. IGN, Pro Game Guides, and Roblox Support returned HTTP 403 to that client. All three had already returned readable content through the configured research browser. These access limits are recorded in `tmp/reference/link-check.tsv`.

| ID | Exact source | Date and verification | Local evidence |
| --- | --- | --- | --- |
| S1 | [Official Facecard Roblox page][S1] | The rendered page identifies the game and its developer group. | `tmp/reference/facecard-roblox-page.md` and `facecard-promo-1.webp`, `facecard-promo-2.webp`. |
| S2 | [Roblox public game metadata][S2] | HTTP 200. Universe `10769516701`, root place `72293101527469`, creator group `672339572`. Created 2026-10-05. Updated 2026-10-15. The response says copying is not allowed. | `tmp/reference/facecard-universe.json`, `facecard-universe-verified.json`, and `facecard-universe.headers`. |
| S3 | [pixiiuwu, I Gave Myself The ULTIMATE MAKEUP MAKEOVER on ROBLOX!!][S3] | Public YouTube page and captions verified. Uploaded 2026-10-13. Duration 15:47. Inspected frames are listed below. | `tmp/reference/facecard-youtube-metadata.json`, `facecard-pixiiuwu.en-orig.vtt`, `facecard-pixiiuwu-transcript.txt`, and the five frame files. |
| S4 | [Lalish, My Roblox makeup skills are still TRASH][S4] | Public YouTube metadata and captions verified. Uploaded 2026-10-11. Duration 10:46. Transcript only. No frames inspected. | `tmp/reference/facecard-lalish.en-orig.vtt`, `facecard-lalish-transcript.txt`, and `facecard-lalish-metadata-and-caption-fetch.txt`. |
| S5 | [Official Dress to Impress Roblox page][S5] | Rendered description names outfits, competition with friends, voting, and runway poses. | `tmp/reference/dti-roblox-page.md`. |
| S6 | [IGN, Dress To Impress Guide][S6] | Rendered guide read. It describes outfit creation, runway votes, and paid VIP access. Publication date was not confirmed in the extracted page. | `tmp/reference/dti-ign.md`. |
| S7 | [Ana Diaz, Polygon, Dress to Impress hard to win, but it's actually peak digital fashion][S7] | Published 2024-07-25, 10:50 AM EDT. Article and two attributed screenshots read. This is a player's opinion, not an audit of voting. | `tmp/reference/dti-polygon.md`, `dti-polygon-podium.webp`, and `dti-polygon-runway.webp`. |
| S8 | [Official Makeup Mania Roblox page][S8] | Rendered description names makeup creation, styling, themed rounds, voting, and rewards. Its claim to be the first freehand Roblox makeup game was not independently verified. | `tmp/reference/makeup-mania-roblox-page.md`. |
| S9 | [Pro Game Guides, Complete Makeup Mania Beginner's Guide][S9] | Guide and two credited screenshots read. Publication date was not confirmed. Its instructions and screenshots do not agree on every menu detail. | `tmp/reference/makeup-mania-pgg-guide.md`, `makeup-mania-pgg-gameplay.jpg`, and `makeup-mania-pgg-brushes.jpg`. |
| S10 | [Roblox Creator Hub, ServerScriptService][S10] | Rendered documentation explicitly says that its contents never replicate to player clients. | `tmp/reference/roblox-server-script-service.md`. |
| S11 | [Roblox Support, How to Copy an Experience][S11] | Rendered support article read. It requires the About-tab notice that source can be copied for its copy-template workflow. | `tmp/reference/roblox-copy-experience.md`. |
| S12 | [Public GitHub repository search][S12] | HTTP 200. The exact quoted-name query returned zero repositories and `incomplete_results: false`. This is only one search query. | `tmp/reference/github-source-search.json` and `github-source-search.headers`. |

### Facecard frames actually inspected

These files are research evidence, not licensed game assets. The video includes the player's webcam overlay. It obscures part of the left menu.

| Time in S3 | File under `tmp/reference/` | Direct observation |
| --- | --- | --- |
| 01:23, requested seek target | `facecard-pixiiuwu-frame-0083.png` | Lip Liner is selected. Size, strength, softness, stabilizer, color tabs, history buttons, mirror, view shortcuts, freeplay, Lookbook, and Done are visible. The brief is Black and White. |
| 02:20, requested seek target | `facecard-pixiiuwu-frame-0140.png` | Black and white paint covers the lips. The active tool says it works on existing paint and needs no color. The brush cursor is visible. |
| 04:41.932, captured player time | `facecard-pixiiuwu-voting-observed.png` | A portrait card displays Look 2 of 6. Five star positions are visible. Four are selected. The text says to tap to change. A four-second countdown and Report are visible. |
| 05:05.000, captured player time | `facecard-pixiiuwu-frame-0305.png` | Results show a large winner, two smaller placements, star values, reward amounts, a personal placement banner, and confetti. The star aggregation formula is not shown. |
| 05:19.000, captured player time | `facecard-pixiiuwu-frame-0319.png` | A 3D salon lobby has a next-round countdown, avatars, a Shop button, a Lookbook button, and a Freeplay button. |

The first capture command sought each of its first two targets, waited for the paused player to be within 0.2 seconds, then took the screenshot. Its later seek failed, so it did not return its final state list. The later voting and results commands recorded player times in `facecard-voting-capture.txt` and `facecard-results-capture.txt`.

The two official promotional images were also inspected. They show a plain head beside a completed portrait with styled hair, lashes, shaped brows, and glossy lips. They establish the advertised visual result, not actual editing behavior. [S1]

## How the reference game works

### Observed and reported inventory

| Area | Evidence-backed inventory | Boundary or inference |
| --- | --- | --- |
| Makeup canvas | Observed. The face fills the center of the editor. Lip paint changes are visible between sampled frames. Reported. The player paints foundation, liner, lipstick, contour, concealer, blush, and eyeshadow. [S3, 00:45 to 04:20] | Inferred. Direct painting and blending are central, rather than only selecting a finished face preset. This investigation did not test stroke latency or texture resolution. |
| Brush controls | Observed. Size, strength, softness, and a stabilizer are visible at 01:23. Reported. The player says the stabilizer smooths brush movement at 01:23 to 01:38. [S3] | The exact smoothing algorithm and parameter ranges are unknown. |
| Correction and precision | Observed. Undo, Redo, Clear, Mirror On, and Face, Eyes, and Lips view shortcuts are visible. [S3, 01:23] | Those labels are not proof of correct undo grouping, mirrored stroke behavior, or camera behavior. |
| Blending | Observed. The 02:20 frame shows an existing-paint tool. Reported. At 02:12 to 02:29 and 11:44 to 11:58, the player uses the blender and describes adjustable blending. [S3] | Do not assume a blur kernel, layer model, or performance from the video. |
| Colors and layers | Observed. Colour, Layers, and Skin tabs are visible. Classic, Skin, Neon, Chrome, and Custom choices are visible. Reported. The player adds a new layer at 13:23 to 13:29. [S3] | Layer count, reordering, compositing, and which colors cost money are unverified. Small crown icons do not establish an entire purchase rule. |
| Facial options | Observed. Makeup, Sculpt, and Style tabs are visible. The Sculpt tab has a lock symbol in the sample. Reported. The player chooses eye options at 02:32 to 02:38 and 05:35 to 05:45. [S3] | No claim that every sculpt operation is free or that it changes mesh geometry. |
| Finishing choices | Creator-reported. Hair, lashes, and rhinestones appear in the official description. Player-reported. The video chooses lashes and hair at 03:49 to 04:05, moves hair at 05:46 to 05:56, and uses shape stamps at 08:55 to 09:15. [S1] [S3] | The exact catalog size, placement limits, and entitlement rules are unknown. |
| Challenge brief | Observed. Black and White has a one-line rule allowing black, white, and intermediate greys. Reported. Later briefs include Lower Lash Drama and Graphic Liner. [S3, 05:32 and 10:53] | Inferred. A short instruction helps the player judge relevance, not only imitate a title. |
| Round duration | Reported. The introduction says ten minutes at 00:12 to 00:16. The player joins mid-round at 00:41 and adds time at 02:40 to 02:45. [S3] | This is edited footage. Ten minutes was not independently timed. The conditions, cost, and fairness of added time are unknown. |
| Reveal and voting | Observed. The portrait-card vote screen has five star positions, a selected rating, and a countdown. [S3, 04:41.932] | No evidence of bot detection, anti-collusion, self-vote rules, default votes, or vote weighting. A star interface is not evidence of fairness. |
| Results and progression | Observed. Winner and placement cards show stars and rewards. Reported. At 15:13 to 15:19 the player describes a rank-up with brows and lashes. [S3] | The result screen does not reveal the reward formula. The unlock report is not an audited progression table. |
| Freeplay | Creator-reported and visible. The official description offers freeplay as an alternative to competition. Freeplay buttons appear in the editor and lobby. The player praises it at 10:44 to 10:53. [S1] [S3] | No freeplay session was operated. Timer behavior, switching behavior, and save retention are unknown. |
| Saved looks | Observed. A Lookbook button appears in the editor and lobby. [S3] | A working save, load, export, share link, or gallery cannot be inferred from that button. |
| Social setting | Observed. The sampled 3D salon lobby has avatars. Creator-reported. Players vote on makeup looks. The public API lists a maximum of ten players. [S1] [S2] [S3, 05:19] | No invitation flow, chat moderation, cross-device session, or public sharing flow was tested. |
| Onboarding difficulty | Player-reported. Lalish repeatedly runs short of time, calls the round stressful, and misunderstands a brow-focused brief until the reveal. [S4, 01:08, 04:09 to 04:21, and 04:34 to 05:08] | One player's difficulty does not establish a general failure rate. It does identify tasks worth testing with beginners. |
| Mobile and reliability | Unknown. The samples are desktop videos. A player reports a laggy lobby at 05:21 to 05:29. [S3] | This is not a frame-rate measurement. Touch accuracy, small-screen layout, device support, and current server reliability remain unverified. |
| Visual character | Observed. The editor uses a shaded 3D head, bright facial highlights, a purple background, pink and cyan controls, rounded bordered panels, and portrait cards. The lobby has a salon setting. [S1] [S3] | Inferred. Strong face rendering, clear feedback, and the reveal carry more value than duplicating this exact palette or layout. |

### Similar-game comparisons

| Reference | What the source actually supports | Useful original-game lesson |
| --- | --- | --- |
| Dress to Impress | The official page describes outfit creation, friend competition, votes, and runway poses. IGN describes the runway vote loop and paid VIP access. Polygon's screenshots show a runway vote countdown and a three-place podium. [S5] [S6] [S7] | Proposed. Make creation lead to a distinct presentation moment and a readable result. Do not reduce the whole game to an editor. |
| Dress to Impress judging | Ana Diaz describes preferring her own creative looks despite not winning. Her article explicitly discusses different tastes. [S7] | Inferred. Popular preference and artistic quality are different. The article does not prove rigging or justify a claim that a deterministic scorer knows beauty. |
| Makeup Mania | Its official page describes themed makeup rounds, votes, and rewards. The inspected guide screenshots show a central head, layer controls, size and strength controls, stabilizer, mirror, Blender, Undo, Redo, Clear, Freeplay, Lookbook, Lighting, and Submit look. [S8] [S9] | Proposed. Preserve direct creative control, recovery from mistakes, and a way to inspect the completed face. A preset-only face selector is a weaker target for this brief. |
| Makeup Mania source caution | The guide text directs the player through Catalog and Face Accessories for lashes. Its screenshots visibly have a Lashes control and a Hair & Lashes control. [S9] | Treat the menu instructions as lower-confidence. Do not reproduce them as verified navigation. |

## Public source and access limits

The verified Facecard universe and place IDs prevent confusion with same-name games. The public metadata explicitly returns `copyingAllowed: false`. The official copy workflow requires the source-copy notice on the About page. [S2] [S11]

The quoted-name public GitHub search returned zero repositories. A Bing search for `"Facecard" "Makeup Showdown" source github uncopylocked` found game listings and social posts, not a developer-authorized source release. The raw discovery results are in `tmp/reference/search-facecard-source.md`. These limited searches do not establish that a source release cannot exist. [S12]

One anonymous place-metadata request to `https://develop.roblox.com/v2/places/72293101527469` returned HTTP 401 and the message `Authentication token is missing`. The response is in `facecard-place-public.json` and its headers file. No credentials were requested, reused, or added to that request.

Public screenshots, textures visible during play, or replicated client objects are not a full place or server source. Roblox states that `ServerScriptService` never replicates its contents to clients. This investigation did not extract client packages, use an executor, inspect leaked place files, or attempt to recover server scripts. [S10]

A public video segment download returned HTTP 403. The attempt stopped. Ordinary YouTube playback subsequently worked for the five sampled frames. Farther seeks sometimes reset the player or timed out. No missing frame or continuous-video observation is claimed. The failed capture logs are retained. The attempted `.mp4` download did not produce a playable video.

TikTok extraction returned the caption and unrelated recommended posts, not usable gameplay frames. The Fandom makeup page extraction stopped at navigation and an age prompt. Neither supports the feature inventory. Google often returned opaque redirect links. Those unresolved links are discovery notes, not citations.

The evidence files are for local reference review. No asset license or right to reuse proprietary artwork was established. Original meshes, textures, sounds, names, text, and interface art are required for the game. No proprietary code or runtime asset was copied.

## Practical original-game target

This section is proposed product scope, not observed reference behavior.

1. Build an original 3D portrait studio. A readable face, attractive eyes, believable lashes, and controlled lighting must make the user's makeup visible at the final portrait scale.
2. Make direct makeup application the core action. Include color, brush size, softness or opacity, mirror, blend, undo, and redo. Tools must create visibly different marks. Stamps can help beginners without replacing painting.
3. Add a bounded set of original hair, lash, skin-tone, and accent choices. A few well-fitted choices are better than many intersecting meshes. Skin tone is customization, not a beauty score.
4. Offer practice without a timer. Preserve the current look when the player inspects the result. Warn before a destructive reset.
5. Make one full challenge loop work. Show an original brief, an optional timer, a deliberate finish action, a clean reveal, an understandable critique, and immediate replay or practice.
6. Explain judging. A solo critique must identify itself as computer-generated or rule-based. It must state the actual criteria and the reason for each result. Do not present scripted portraits, random scores, or bots as real players.
7. Save and reopen looks. Export a portrait file that visibly matches the editor. If live sharing is absent, say so. Do not use a decorative Share button as evidence of social play.
8. Make a first successful look possible on a phone. Keep painting separate from camera movement. Test touch targets, pointer capture, scrolling, rotation, and tool selection on the actual layout.

A first release can compete on the quality of makeup creation and presentation without copying a Roblox lobby. It cannot claim equivalent social play or player scale without real cross-device participation.

## Gradeable rubric

This is a proposed acceptance rubric. No grade has been assigned to unbuilt code or to the reference games. Each category receives an integer score from zero to four. Its weighted points are `weight × score / 4`. Intermediate scores one and three mean partial completion between the stated anchors. Record a screenshot, test result, or short observation for every awarded score.

| Category | Weight | Score 0 | Score 2 | Score 4 and verification |
| --- | --- | --- | --- | --- |
| Makeup UX | 25 | Makeup controls are decorative or cannot reliably change the face. | Painting works. At least color and size work. Correction or precision is awkward. | Brush, blend, mirror, softness or opacity, undo, and redo work with mouse and touch. A tester draws a precise liner stroke, blends a cheek, reverses both edits, and restores them without damaging unrelated work. Paint stays on the intended face area. |
| Customization | 15 | Every result is effectively the same preset. | Multiple makeup colors and some appearance options work. Fit or variation is limited. | A tester makes three recognizably different original looks using skin tones, painted makeup, hair or lashes, and accents. Options remain well-fitted in supported views. Save and reopen preserve the choices. Dark and light skin tones both retain readable makeup. |
| Challenge loop | 15 | There is no complete playable round. | Brief, timer or finish action, and result work once. Replay is incomplete or the result is abrupt. | A tester completes three consecutive rounds, changes the brief or mode, sees a reveal and result, and replays without reload. The brief stays visible. Timer end and manual finish preserve the final look. Practice has no hidden timer. |
| Judging fairness | 10 | Scores are unexplained, random, or falsely described as human votes. | The judging mode and some criteria are stated. Results are plausible but hard to audit. | Repeating the same submission gives the stated result under the published rules. Names, skin-tone identity, and payment status do not alter a fixed makeup assessment. Critique names visible evidence. A human-vote mode documents self-votes, missing votes, ties, and duplicate-vote rules, then tests them with independent clients. |
| Social and share | 10 | Sharing or opponents are only visual decoration. | A working local portrait export or gallery exists. Its local limits are explicit. | Two independent people can use the advertised social flow, share or compare looks, and recover from a failed submission. If multiplayer is advertised, two independent browser sessions must participate in the same round. A solo app with working export and local comparison can earn three, not full multiplayer credit. |
| Onboarding and mobile | 10 | The first action is unclear or touch cannot complete the core task. | A beginner completes a look on desktop. Small-screen controls need work. | Two first-time testers each choose a tool, apply makeup, undo, change the view, and finish within two minutes without spoken help. Run the same task at 390 by 844 and 844 by 390 CSS pixels. No clipped required control, accidental page drag, or lost stroke is allowed. Keyboard users can select tools and finish. |
| Aesthetic quality | 15 | The face is unreadable or the result looks unfinished. | The head, makeup, and menus are coherent. Some lighting, fit, or hierarchy defects remain. | Inspect the editor and exported portrait at desktop and phone sizes. Eyes, lips, makeup edges, hair fit, type, spacing, selection states, and reveal transitions remain clear. No mesh intersections or visibly broken paint mapping appear in supported views. Two reviewers compare completed portraits with the cited reference images, not only the menus. |

### Proposed acceptance gates

- Reach at least 80 of 100 weighted points. Makeup UX and aesthetic quality must each score at least three. No category may score below two.
- Complete the real mouse and touch editing task. A screenshot of a plausible finished face cannot replace this test.
- Complete three rounds without a reload or loss of the final look.
- Reopen one saved look and export one matching portrait.
- Do not claim human opponents, a public gallery, online voting, or multiplayer until independent sessions verify those claims.
- Treat a persistent crash, destructive undo, nonfunctional finish, copied asset without permission, or fabricated evidence as a release blocker regardless of the total.

An 80-point result would support a limited, evidence-backed quality claim under this rubric. It would not prove equal retention, content breadth, mobile support, safety, or community scale to a live Roblox game.

## Decision basis

Experience First shaped the proposed scope. It puts responsive makeup creation and an attractive finished portrait ahead of a large item catalog. Prove It Works shaped the evidence and rubric. Visible labels, player reports, tested behavior, and unavailable source remain separate.

[S1]: https://www.roblox.com/games/72293101527469
[S2]: https://games.roblox.com/v1/games?universeIds=10769516701
[S3]: https://www.youtube.com/watch?v=wRFK-QXIfag
[S4]: https://www.youtube.com/watch?v=IJc-2pbsT64
[S5]: https://www.roblox.com/games/15101393044/Dress-To-Impress
[S6]: https://www.ign.com/wikis/dress-to-impress
[S7]: https://www.polygon.com/24205592/dress-to-impress-roblox/
[S8]: https://www.roblox.com/games/117935850321807/Makeup-Mania-BETA
[S9]: https://progameguides.com/roblox/complete-makeup-mania-beginners-guide/
[S10]: https://create.roblox.com/docs/reference/engine/classes/ServerScriptService
[S11]: https://en.help.roblox.com/hc/en-us/articles/203313900-How-to-Copy-an-Experience
[S12]: https://api.github.com/search/repositories?q=%22Facecard%22+%22Makeup+Showdown%22&per_page=10
