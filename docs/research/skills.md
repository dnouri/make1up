# Three.js skills for Make1Up

Research date is 2026-10-16. This selection supports the procedural makeup studio in [the work plan](../work-plan.md). It does not supply a face model, face anatomy, licensed cosmetics, or a finished rendering system.

## Selected scope

Six skills are copied into `.agents/skills/`. Five compact API guides cover geometry, materials, lighting, camera interaction, and animation. One specialist from the requested local checkout covers runtime faults, pointer input, lifecycle cleanup, and performance checks.

The source files are unmodified. Each skill directory includes its original MIT `LICENSE` and a project-written `UPSTREAM.md`. No installer, provider tool, scaffold, or downloaded script was executed. No source checkout or agent configuration changed. Agents can read the entry files by their project paths without relying on host-specific discovery.

This is the smallest set selected for this run. The separate core, performance, physics, shader, and generated-asset packs would duplicate guidance or add work outside the procedural studio. It is not a claim that every upstream example is current or correct.

## Public options and exact versions

GitHub repository metadata, commit records, and recursive trees were retrieved with `gh api`. Relevant files were fetched through the contents API at the recorded commits. The API responses and retrieved files are under `tmp/skill-research/`.

| Source | Pinned revision | Decision and tradeoff |
| --- | --- | --- |
| [Majid Manzarpour, Three.js Game Skills](https://github.com/majidmanzarpour/threejs-game-skills/tree/e5f301d548bb18c530afbece78cd25082f4cda9c) | `e5f301d548bb18c530afbece78cd25082f4cda9c` | Select only `threejs-debug-profiler`. Its ordered triage, pointer cancellation checks, and diagnostics suit this app. The full director, scaffold, generators, and graphics scorecard are larger than this skill task needs. MIT, copyright 2026 Majid Manzarpour. |
| [Allan Alton, Three.js skills](https://github.com/alton47/threejs-skills/tree/7b8e25638cff83a6be4926d8f05001022cc80ac3) | `7b8e25638cff83a6be4926d8f05001022cc80ac3` | Select five narrow guides and their two linked references. They make the required APIs easy to locate. Some API statements need the corrections below. MIT, copyright 2026 Allan Alton. The README's claim that these are official skills is not evidence of Three.js project endorsement. |
| [CloudAI-X, Three.js skills](https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823) | `b1c623076c661fc9b03dac19292e825a5d106823` | Its geometry and interaction guides include useful buffer attributes, canvas-relative coordinates, raycasting, and UV hits. The README says MIT, but the inspected tree has no license file or copyright notice. Do not vendor it for this run. Some examples also need repair, such as reassignment of `const` input flags and unfinished listener cleanup. |
| [Scott Sun, Three.js Awesome Graphics Agent Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills/tree/897aaa0a49f9346f342993e1eb74a30479f82614) | `897aaa0a49f9346f342993e1eb74a30479f82614` | Its procedural geometry, materials, animation, and visual validation entries require semantic measurements and diagnostic views. The geometry entry links a substantial mesh kit and several complete assemblies. Keep it as an option for a later geometry-quality pass rather than copy its large dependency set now. MIT, copyright 2026 Scott Sun. Some asset directories have separate third-party notices. |
| [Mint, Three.js Skills](https://github.com/mintdotgg/mint-threejs-skills/tree/de7af448ee6f90ab54c53b6a18d58581bbc56a90) | `de7af448ee6f90ab54c53b6a18d58581bbc56a90` | Its interaction entry has clear application-state ownership, semantic HTML controls, and pointer cancellation. It also points outside its own folder into a Mint-specific production workflow. Do not copy a broken standalone subset or add a provider workflow to this local procedural build. The repository includes an MIT license. |

The local source is `/home/daniel/co/threejs-game-skills`. Its origin is `git@github.com:majidmanzarpour/threejs-game-skills.git`. Its clean `HEAD` matches the GitHub commit above. I read its `AGENTS.md`, `README.md`, `LICENSE`, the graphics, gameplay, debug, and release entries, and the debug playbook. The installed debug files match GitHub's blobs, not only the checkout's file names.

## What the selected files teach

These are implementation references. The last column describes required app checks, not checks completed by this research task.

| Project entry | Relevant supporting files | What it teaches | How verification uses it |
| --- | --- | --- | --- |
| [threejs-geometry](../../.agents/skills/threejs-geometry/SKILL.md) | None required. | Indexed `BufferGeometry`, positions, normals, UVs, bounds, dynamic updates, and disposal. These APIs support a continuous parametric head rather than a pile of face-shaped spheres. They do not teach facial topology. | Inspect front, profile, and three-quarter head views. Check finite positions and normals, valid triangle indices, usable UVs, and bounds after shape changes. Confirm that light reveals no normal seam at the jaw or face center. |
| [threejs-materials](../../.agents/skills/threejs-materials/SKILL.md) | [MAPS.md](../../.agents/skills/threejs-materials/MAPS.md). | PBR color, roughness, metalness, texture coordinates, transparency, environment lighting, and disposal. These controls distinguish skin, matte powder, and glossy lips. | Capture the same face before and after each makeup edit under fixed light. Check that pigments stay on the intended region and that highlights do not erase the chosen color. Check texture counts after repeated undo and reset. |
| [threejs-lighting](../../.agents/skills/threejs-lighting/SKILL.md) | [SHADOWS.md](../../.agents/skills/threejs-lighting/SHADOWS.md). | Hemisphere, directional, spot, and area lighting, shadow-camera bounds, and curved-surface bias. | Inspect eye sockets, nose, lips, and jaw under neutral studio light. Check dark and light skin variants for clipped highlights, lost detail, shadow acne, and detached shadows. Avoid extra shadow lights unless the image needs them. |
| [threejs-camera](../../.agents/skills/threejs-camera/SKILL.md) | None required. | Camera framing, orbit limits, damping, and projection updates on resize. This is view interaction, not a face-painting implementation. | Test zoom, orbit, and reframe on narrow and wide canvases. Confirm that painting cannot also rotate the camera. Resize during an edit and confirm that the face and hit location still agree. |
| [threejs-animation](../../.agents/skills/threejs-animation/SKILL.md) | None required. | Delta-time mixer updates, keyframe tracks, morph targets, clip replay, and property ownership. No new animation dependency is required by this selection. | Inspect a short motion sequence rather than only a still image. Test idle motion, replay, pause, and reset. Verify reduced-motion behavior and confirm that paint remains attached while the head moves. |
| [threejs-debug-profiler](../../.agents/skills/threejs-debug-profiler/SKILL.md) | [debug-playbook.md](../../.agents/skills/threejs-debug-profiler/references/debug-playbook.md), [agents/openai.yaml](../../.agents/skills/threejs-debug-profiler/agents/openai.yaml). | One render-loop owner, canvas and drawing-buffer checks, pointer capture and cancellation, seconds-based timing, diagnostics, resource disposal, and bottleneck classification. | Check console and page errors, actual canvas pixels, mouse and touch cancellation, keyboard focus, orientation changes, and repeated reset. Record `renderer.info` after rendering in production preview. Fix a measured bottleneck, then repeat the same scenario. |

## Interaction and API limits

The selection does not contain an anatomical head generator, brush mask algorithm, or UV-paint undo model. Those remain application work. Skill installation is not evidence that these systems work.

For direct surface painting, the authoritative [Three.js r186 Raycaster source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/core/Raycaster.js) accepts normalized camera coordinates and describes UV hit results. The [Mesh intersection source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/objects/Mesh.js) interpolates those UVs only when the geometry has a UV attribute. Normalize pointer positions against the actual canvas rectangle, not the full window. Verify this with a scrolled page, a resized canvas, and a rotated face.

The unmodified Alton files contain these cautions. The app's installed Three.js version remains authoritative.

- `MAPS.md` says `alphaMap` uses the red channel. The inspected [r186 material source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/materials/MeshStandardMaterial.js) specifies green for RGB and RGBA textures.
- The material guide describes non-color texture defaults as `LinearSRGBColorSpace`. The inspected [r186 Texture source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/textures/Texture.js) defaults to `NoColorSpace`. Keep data maps untagged and mark actual color textures with the correct color space.
- The material and lighting guides mention `physicallyCorrectLights` and `useLegacyLights`. Neither name occurs in the inspected [r186 WebGLRenderer source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/src/renderers/WebGLRenderer.js). Do not copy those flags into the app.
- The camera guide describes a parent wrapper for `PointerLockControls`. The inspected [r186 control source](https://github.com/mrdoob/three.js/blob/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/examples/jsm/controls/PointerLockControls.js) receives the camera as its controlled object. Pointer lock is not part of the makeup studio's selected interaction.
- `SHADOWS.md` has a malformed table row for detached shadows. Its earlier bias section remains readable. Verify bias visually instead of copying a value without checking the face scale.

The debug playbook names optional generated-asset sibling skills. They are not file dependencies and are not installed. The procedural-only project scope takes precedence. The references do not authorize paid generation or asset uploads.

## Verification evidence

The repeatable integrity check is [verify-skills.mjs](../../tmp/skill-research/verify-skills.mjs). Run it from the project with `node tmp/skill-research/verify-skills.mjs`.

It checks entry frontmatter, all selected source files against pinned GitHub blob IDs, original licenses, attribution files, Markdown file links, and inline local support paths. It writes SHA-256 hashes and the checked links to `tmp/skill-research/verification.json`. The declared selection is [selection.json](../../tmp/skill-research/selection.json).

Integrity and local-link checks pass for six skills and sixteen upstream files, including the six original license copies. Browser behavior and API examples have not been exercised as a standalone skill evaluation. The main app owner must run the specific browser checks in the table before claiming a complete 3D makeup flow.

The Laziness Protocol shaped the limited selection rather than a full pack installation. Model the Domain shaped the explicit source-and-file manifest. Build the Lever and Prove It Works shaped the repeatable hash and link check. The upstream cautions stay in this note so that attribution remains exact and no third-party `SKILL.md` needs local edits.
