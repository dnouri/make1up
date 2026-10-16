# A practical face pipeline for a browser makeup game

Verified on 2026-10-16. This is a pipeline recommendation, not a model quality benchmark. I checked public primary documentation, downloaded source assets without an account, inspected their mesh data in Blender, and rendered an extracted head. I did not call a generation API, install model weights, or upload a photograph.

## Recommendation

Use one approved head topology and UV layout. Make face variation with shape keys and separate skin, eye, brow, and hair choices. Use AI offline for concepts and optional texture drafts, not to generate an unrelated mesh whenever the player changes a face.

For the next run, start with Blender Studio's CC0 `Head - Stylized` collection. A head-only GLB is already available at `tmp/asset-research/assets/extracted-stylized-head.glb`. It has a shaped nose, lips, ears, neck, and two eye meshes. It is an untextured base, not a finished beauty-game character. Its 11,432 triangles are a practical starting size, but mobile performance has not been measured.

If broad automatic facial proportions matter more than that particular style, use MakeHuman through MPFB and its targets instead. Its core assets are CC0, and its targets move existing vertices rather than replace the mesh. The app does not need to include MPFB's GPL program code. [MPFB's license][mpfb-license] distinguishes code, assets, and output.

Blender Studio's Rain is a second real option. Its source already has a visually polished female character, separate eyes and brows, hair, skin textures, and facial shape keys. It is CC-BY 4.0. It needs more export work than the CC0 base because its head uses a UDIM texture tile and Blender-specific rig and shader behavior. It is not a drop-in browser asset. [Rain's official page][rain] permits reuse with attribution.

This is not a claim that a shared base is universally the best approach. Independent AI meshes are useful for visual concepts and static characters. A makeup game has a different constraint. The same brush, lip mask, expression, and saved makeup must continue to work on every supported face.

## Why the shared mesh matters

Topology means the mesh's vertices and their connections. UV coordinates map that mesh to a flat texture. Stable topology and UVs let one lip mask, one eyelid mask, and one brush system follow different face shapes.

A quad option or a low polygon count does not establish this contract. Two generated heads can both be quad meshes while their lips, vertex order, UV islands, and eyelids differ. None of the checked general-purpose generation documents promises one shared facial topology across independent generations.

Keep these invariants after the initial export:

- Every identity variant uses the same vertex order, index buffer, and UV coordinates.
- Shape keys change positions, not topology or UVs.
- Left and right makeup regions have separate usable UV space. Do not mirror their UVs if asymmetric makeup is allowed.
- Identity changes and expressions keep the eyes, eyelids, lips, brows, and hair attachments aligned.
- UV seams and texture borders do not cut across the visible lips or eyelids without a tested painting solution.

The downloaded CC0 head has noncollapsed UV coordinates on every face. I did not prove that its atlas has no overlap or test a makeup brush across its seams. Those are acceptance checks for the next run.

## Public AI options and their tradeoffs

The versions below are those found in the checked public documents. They are not assumed to be equally good at human faces.

| Option | What the official sources establish | Fit for this game |
| --- | --- | --- |
| Hunyuan3D 2.0 and 2.1 | Shape and texture are separate stages. Version 2.1 adds physically based rendering textures. The published requirements are 6 GB for 2.0 shape generation and 16 GB for its combined workflow. Version 2.1 lists 10 GB for shape, 21 GB for texture, and 29 GB combined. [2.0][hunyuan2], [2.1][hunyuan21]. | Useful technology for offline mesh and texture work, but not a default for an internationally distributed game. Both checked licenses exclude the EU, including Sweden, plus the UK and South Korea. The restriction includes use of outputs there. |
| Hunyuan3D-Omni and Buffalo 1.0 | Omni adds point cloud, voxel, skeleton, and bounding-box controls and lists 10 GB for generation. Buffalo's repository has a 2026-08-05 paper announcement. Its root contained a README and assets when checked, not an inference package. [Omni][hunyuan-omni], [Buffalo][hunyuan-buffalo]. | These are evidence that the family extends beyond 2.1. Control signals do not establish a reusable facial UV atlas. I did not verify Omni's model license, so it is not an approved substitute for 2.1. A paper announcement is not a usable local pipeline. |
| Microsoft TRELLIS and TRELLIS.2 | The original lists Linux and an NVIDIA GPU with at least 16 GB. TRELLIS.2 lists at least 24 GB and produces image-conditioned geometry with base color, roughness, metallic, and opacity. It also has a shape-conditioned texture pipeline. [TRELLIS][trellis], [TRELLIS.2][trellis2], [texture example][trellis2-texture]. | A credible open offline candidate for a later controlled test. Treat output as an art draft or bake its textures onto the approved head. The texture example starts with a PLY mesh and does not demonstrate preservation of a caller's UV atlas. Neither general generation path is a facial rigging solution. |
| Meshy | The checked API guide lists Meshy 7.1 for geometry and Meshy 7 for Retexture. Retexture accepts an existing mesh and has `enable_original_uv`, which defaults to `false`. It supports text, image, and multiview texture guidance, plus optional material maps. [API guide][meshy-docs], [Retexture][meshy-retexture]. | A practical hosted texture trial on the approved head. Explicitly enable the original UVs. Inspect the returned mesh, UVs, color maps, seams, and facial details before accepting it. Do not let a default unwrap invalidate the makeup masks. |
| Tripo | The official SDK supports text, image, and multiview generation, external mesh import, texture generation, low-poly processing, UV work, and rigging. The current texture documentation lists `v3.5-20260815`, reference-image guidance, and removal of baked lighting. [SDK][tripo-sdk], [texture API][tripo-texture]. | Useful for a hosted geometry or texture comparison. Its texture API does not document the same explicit original-UV switch as Meshy in the checked page. Verify preservation or bake to the approved atlas. Low-poly and body auto-rigging do not prove correct lip and eyelid loops. Use current V3 documentation rather than old V2 examples. |
| Hyper3D Rodin Gen-2.5 | It supports image or text generation, triangle or quad output, several detail levels, and GLB export. There is also texture generation for an uploaded model, with lighting removal and PBR options. [Generation][rodin-generation], [texture API][rodin-texture]. | A credible hosted comparison for visual quality. Quad output is not shared facial topology. The checked texture page does not promise preservation of a canonical face atlas across jobs. Preserve the approved mesh and transfer accepted appearance to it if necessary. |
| Shared base plus optional AI textures | MPFB targets are vertex displacements. Its makeup tools keep ink layers separate from the skin texture, including a face-focused UV layout. [Targets][mpfb-targets], [makeup tools][mpfb-makeup]. | Recommended for this game. Most shape and color changes need no AI inference. AI can supply reviewed skin detail, freckles, or a style reference while the game keeps stable geometry and paint layers. |

I did not generate the same face with these services. There is no measured winner for facial likeness, attractive styling, lip quality, or total cleanup time in this investigation.

## License, cost, and privacy are separate checks

License summaries below are engineering screening, not a legal opinion. Recheck the exact product, model version, account plan, and output terms before production.

| Option | License and cost evidence | Privacy consequence |
| --- | --- | --- |
| Hunyuan3D 2.0 and 2.1 | Both checked community licenses exclude the EU, UK, and South Korea. Their use restrictions expressly include outputs. They also have additional commercial conditions for organizations above the stated user threshold. [2.0 license][hunyuan2-license], [2.1 license][hunyuan21-license]. | Local inference would normally avoid an external photo upload, but that does not remove the geographic restriction. Do not route this project through a hosted copy to evade the license. |
| TRELLIS.2 | The model and main code are MIT. The repository identifies dependencies with separate licenses. There is no per-call fee for self-hosted weights, but suitable GPU time and setup are not free. [License][trellis2-license], [dependency notes][trellis2]. | Local generation can avoid sending inputs to a service. A hosted demo or rented endpoint has its own operator and data rules. The checked hardware is not browser hardware. |
| Meshy | The API uses prepaid credits. Retexture costs 10 credits for 2K or 4K and 15 for 8K in the checked table. These are API credits, not a claim about web-plan allowances. Paid users retain private ownership under the stated conditions. Free-plan outputs receive CC-BY 4.0, with attribution. [Pricing][meshy-pricing], [ownership][meshy-ownership]. | Meshy's 2026-08-27 help article says non-Enterprise customer data may be used in anonymized form for future training. It says Enterprise data is excluded. A paid individual plan is not the same as a no-training contract. [Data policy][meshy-privacy]. |
| Tripo | The checked API page prices one credit at USD 0.01. Standard or fast texturing costs 10 credits. HD costs 20 and 8K costs 30. The terms distinguish free users from paid users. Paid users generally receive broad output rights, subject to the agreement. Do not describe free outputs as CC0. [Pricing][tripo-pricing], [terms section 5.2][tripo-terms]. | The no-training sentence appears in the paid-user portion of section 5.2. Free users grant broad rights over inputs and outputs. Storage and access settings also matter. No confidential photo upload was tested. |
| Rodin | The generation and texture-only pages each list 0.5 credits for the base request, with surcharges for some options. The terms distinguish Rodin from ChatAvatar. Rodin's paragraph says it does not limit output use, subject to the agreements and other rights. ChatAvatar has different license terms. API access and plan prices are separate purchasing checks. [Generation][rodin-generation], [texturing][rodin-texture], [terms section 5][rodin-terms], [plans][rodin-pricing]. | The API-specific policy effective 2026-08-03 says active-system retention is seven days. It says API payloads and output are not training data or public assets. Legal retention, security metadata, service processing, and protected backups have exceptions. Do not generalize this to every website workflow. [API retention policy][rodin-retention]. |
| CC0 or CC-BY source head | No generation charge or account is needed for the downloaded assets. CC-BY needs attribution, a license link, and a change notice. Keep provenance even for CC0. Blender or MPFB program licenses do not automatically become the license of exported art. | A synthetic base head needs no personal photograph. A future real-person feature still needs consent, data handling rules, and deletion behavior. |

None of these vendors guarantees that every output is copyrightable, exclusive, or free of third-party rights. A generated celebrity-like face, copied hairstyle, or unlicensed reference image still needs review.

## Free assets verified without credentials

All paths in this section are under `tmp/asset-research/`. No asset was integrated into the app.

| Asset | What was actually obtained or checked | Practical limits |
| --- | --- | --- |
| Blender Studio Human Base Meshes v1.4.1 | Downloaded `assets/human-base-meshes-bundle-v1.4.1.zip`, 50,643,039 bytes. The official page and embedded README say CC0. The `Head - Stylized` collection explicitly records CC0 and Julien Kaspar as its author. Its head has 4,118 source vertices and 8,232 triangles. Each eye has 802 vertices and 1,600 triangles. All have UVs. [Official download listing][blender-demo]. | This is a modeling base. It has no authored materials, skin textures, hair, brows, or expression keys. An old embedded text block named `License` still refers to Rain under CC-BY. I preserved that text. The bundle README and selected collection metadata explicitly state CC0. Keep those records together. |
| Extracted CC0 stylized head | Exported `assets/extracted-stylized-head.glb`, about 275 kB. It contains the head and its two eyes, smooth normals, and the original UVs. I preserved world positions when removing the parent hierarchy and recentered the result. `assets/extracted-stylized-head-clay-check.png` is a render of the actual GLB after import. | The render is a plain material check, not finished artwork. The GLB has no authored materials or identity variation. The exporter splits vertices at UV seams, so its vertex accessor counts differ from Blender's source counts. Paint quality and mobile runtime remain untested. |
| Blender Studio Rain | Downloaded `assets/rain-v33.zip`, 67,579,177 bytes, without login. The ZIP contains `Rain v3.3/rain_v3.2.blend` and textures. I kept the original names. Its separate head has 6,395 vertices, 12,634 triangles before modifiers, and 25 shape-key entries including `Basis`, backups, and correctives. Separate eye, cornea, brow, lash, hair, teeth, and tongue meshes are present. The page and embedded README state CC-BY 4.0. [Official character page][rain]. | The head UVs occupy UDIM tile 1003, with U coordinates near 2 to 3. A head-only export can shift that tile to 0 to 1 and use the matching `1003` maps. A full-body export needs an atlas or bake. Blender drivers, lattice deformation, corrective smoothing, subdivision, and custom shaders need a deliberate browser conversion. Do not count every source key as a ready game expression. |
| MakeHuman and MPFB | Downloaded `assets/makehuman-base.obj`, 1,749,303 bytes. Its own header explicitly says CC0. MPFB's license covers bundled graphical assets under CC0. The official asset-pack index lists CC0 system eyes, teeth, natural female skins, and other packs. [License][mpfb-license], [asset packs][mpfb-assets]. | The OBJ is a full base with helper geometry, not a finished feminine head. I did not install MPFB or generate a dressed character. The checked system pack is about 281 MB and the natural female skin pack about 104 MB. They were not downloaded. Third-party community assets can have different licenses. |
| FLAME | The current license page distinguishes the older noncommercial models from `FLAME 2023 Open`, whose section allows commercial use under its stated attribution terms and additional content restrictions. The download page presented a sign-in form. [License][flame-license], [download page][flame-download]. | Do not repeat the outdated claim that every FLAME version is noncommercial. Do not assume the Open model includes unrestricted skin, eyes, or hair. It was not downloaded because this run used no credentials. It is not the immediate asset path here. |
| VRoid Studio | Its official guidelines allow many commercial uses of exported models and explicitly say its supplied content is not CC0. [Guidelines][vroid-guidelines]. | The same guidelines prohibit an app that generates or outputs models, avatars, or items made from deformed or combined VRoid meshes and textures without a separate license. That is a poor default for an extensible face-customization game. A fixed character in a game is a different case. No VRoid asset was downloaded. |

Rain's required credit from the source page is `Rain Rig (CC) Blender Foundation | studio.blender.org`. Add the [CC-BY 4.0 license link](https://creativecommons.org/licenses/by/4.0/) and a description of modifications. Full license texts and embedded notices are in `tmp/asset-research/licenses/`.

The official Blender listing currently links the base bundle through a `www.blender.org/download/demo/...` URL that returned an HTML page in this environment. The corresponding official download host returned the real ZIP. Its exact URL is recorded in `provenance.json`. Rain's first cached signed redirect expired. A fresh request to the official source endpoint returned the ZIP. Neither download required credentials.

## Variation must change more than skin color

The following is a recommended asset contract, not a claim that the source head already implements it.

| Part | Recommended representation | Check before accepting a variant |
| --- | --- | --- |
| Face shape | Curated morphs for jaw width, chin, cheeks, forehead, and overall proportions on one mesh. Use bounded combinations or tested presets. | A different silhouette remains visible without textures. The eyes and hair still fit. Avoid unconstrained random slider extremes. |
| Skin and undertone | Separate base-color detail, skin depth, warm or cool undertone, roughness, and optional freckles. Curate dark, medium, and light presets under the same neutral light. | Do not recolor one pale texture by multiplication and call it complete diversity. Preserve local lip and eyelid color. Avoid baked shadows and highlights. |
| Eyes | Separate eyeballs, iris and pupil appearance, sclera tone, and a modest corneal highlight. Move or scale eye attachments with identity morphs. | The iris is not painted on the eyelid. The lids touch the eyeball during blink and look changes. |
| Brows and lashes | Separate brows with shape, thickness, color, and position choices. Use simple geometry or controlled alpha cards. | Face paint can go under the brow without changing brow color. Avoid large transparent layers over one another on mobile. |
| Nose | Morph bridge height and width, tip, and nostril width. | The nose changes in profile, not just through texture shading. No nostril collapse occurs at a supported morph extreme. |
| Lips | Morph width, upper and lower volume, and cupid's bow. Keep an exact lip mask and a distinct mouth interior. | Lipstick follows the lip border on every preset and expression. It does not color teeth or the mouth cavity. |
| Hair | Swappable prebuilt meshes or hair cards attached to named scalp positions. Keep hair color separate. | Hair does not intersect the changed forehead, cheeks, or ears. A cap or simple solid style is preferable to thousands of strands for the first mobile version. |
| Makeup | Independent layers for foundation, blush, eye shadow, liner, lip color, glitter, and removal. Store color, opacity, finish, and brush strokes separately from bare skin. | Left and right painting can differ. Undo and removal do not damage the skin texture. Masks prevent paint from crossing onto eyes, mouth, and hair. |
| Expressions | A small curated set such as neutral, blink, slight smile, and a limited mouth opening. Export the needed morphs or baked bone animation. | Test expressions together with every supported identity preset. Expressions must not expose unpainted UV areas or stretch liner off the lid. |

Do not map an ethnicity label directly to one nose, eye shape, or skin preset. Use facial attributes and curated combinations. Give the player attractive options without treating one narrow face shape as the default definition of beauty.

## Offline preparation and browser work

### Prepare the library offline

Use Blender to select the source mesh, finish the neutral face, and lock the atlas. Define semantic masks for lips, eyelids, cheeks, brows, hairline, and excluded areas. Keep the mouth interior and eyes separate.

Create identity morphs and fit each accessory. A few art-directed presets are safer than hundreds of unchecked combinations. Export one common GLB with the required morph targets. If MPFB is the source, keep one topology and the same export settings for every preset. Do not switch proxies per face.

For optional AI texture work, render the approved head in neutral light with front and side views. Ask for a bare face without lipstick, liner, cast shadows, or specular highlights. Meshy's original-UV retexture path is a concrete hosted trial. TRELLIS.2 is a concrete local trial only on a suitable GPU. Keep a copy of the accepted bare-skin maps and the exact model, prompt, seed, and terms used.

Review AI textures on the actual mesh. Repair seams, duplicated brows, uneven pupils, unwanted makeup, and lighting baked into albedo. Do not let a texture model invent a different nose or lip outline over the existing geometry. Transfer acceptable detail to the approved atlas when the output does not preserve it.

Bake Blender-only material behavior to browser-supported maps. Build each level of detail offline. A decimator changes vertex correspondence, so each level needs compatible morph data and tested UVs rather than an assumption that source shape-key indices still apply.

### Keep interaction in the browser

The browser can load GLB, apply supported morph targets and skeletal animation, change skin and eye parameters, swap prepared hair, and composite makeup. A UV hit from the face can address a paint texture instead of placing a flat sticker in screen coordinates. That keeps paint attached when the head turns.

Store the identity as a base-mesh identifier, morph weights, skin and undertone choice, eye choice, brow choice, and hair choice. Store makeup layers separately. Version the base and UV layout so an asset update cannot silently misplace a saved look.

A texture brush can use a canvas or GPU render target with a separate undo history. Decide whether brushing is allowed across UV seams, then test that case. Blend color and lighting in the correct color spaces. Lip gloss needs a roughness or specular change, not only a brighter pink color.

Three.js has a GLTFLoader and optional compressed mesh and texture decoders. [Its official loader documentation][threejs-gltf] lists the supported extensions. This does not make a Blender material node graph executable in WebGL.

None of the checked Hunyuan3D, TRELLIS, Tripo, Rodin, or Meshy generation paths is documented as inference that runs entirely in the player's browser. Their web demos are not proof of client-only generation. Their documented generation work uses server hardware or native GPU software. A fully client-only game can still use their reviewed, precomputed assets.

Do not ship a paid service key in JavaScript. If live generation becomes a product requirement, add a controlled backend with a spending limit, authentication, moderation, consent, and a clear storage policy. It is not needed for the first makeup experience.

### Start with explicit mobile budgets

These are proposed starting limits, not measurements:

- Use the extracted 11,432-triangle head as the first baseline. Keep a complete bust with hair within roughly 30,000 to 60,000 triangles until device tests justify more.
- Start with a 2K skin atlas and smaller masks. Keep a lower-resolution option. Several 4K maps and large undo textures can consume substantial GPU memory.
- Keep material count and transparent hair layers low. Prefer a few shared material passes over a material for every makeup item.
- Limit pixel ratio on high-density phones. Add compressed static textures after correct rendering works. Keep editable paint targets in a format the brush can update.
- Check a real lower-end phone for initial load, brush response, head rotation, memory pressure, and context loss. A desktop render and triangle count do not prove mobile performance.

## Concrete next run

1. Load `tmp/asset-research/assets/extracted-stylized-head.glb` in the existing viewer. Assign a skin material and separate eye materials. Add iris and pupil appearance, eyebrows, and one simple hair style. Use a fixed neutral expression first.
2. Check the head from the front, profile, and three-quarter view. Approve its style before adding more identities. The downloaded Rain source is available if its more finished visual style is preferred and the extra conversion work is acceptable.
3. Verify the UV atlas for overlap and asymmetric painting. Make separate left and right lip, eyelid, and cheek masks. Prove that a brush stays attached during rotation and cannot paint the eyeballs or mouth cavity.
4. Create a small curated set of face morphs and several skin-depth and undertone presets. Test them with blink and smile. Keep all variants on the approved mesh and atlas.
5. Only then compare optional AI texturing on that same head. Meshy offers the clearest checked original-UV control. Compare its accepted output with a hand-authored or procedural bare skin. Include cleanup time in the choice. Do not pay for broad generation before that comparison.
6. Export the tested library and verify it on mobile. Add required attribution and asset version information before redistribution.

No one needs to provide a photograph or buy API credits to start steps 1 through 4.

## Immediate procedural fallback

Use the extracted CC0 mesh with procedural skin color and roughness. Add separate eye color, iris, pupil, brows, and a simple hair cap. Use UV masks or artist-selected mesh regions for lip color, eye shadow, and blush. Keep one neutral face until a few good morphs exist.

If even asset loading is blocked, a single carefully shaped procedural head can demonstrate the brush and makeup layers. It must be labeled a prototype. Random spheres for the nose and lips, or different skin colors on an unchanged blank head, do not establish an attractive varied face pipeline.

This fallback is not AI-generated. It is the honest way to prove the makeup interaction while the character artwork improves.

## Evidence and remaining checks

The local tool check found Blender 4.3.2, Node, npm, curl, Git, GitHub CLI, and uv. The graphics device is AMD Phoenix integrated graphics. No NVIDIA device or `nvidia-smi` was found. The documented CUDA workflows were not run. Blender successfully inspected both downloaded files and exported and imported the head GLB. Its CPU render worked after disabling denoising because this build has no OpenImageDenoise support.

The first extracted render exposed incorrect eye placement after recentering a parented mesh. The exporter now preserves world transforms before removing parents. The corrected GLB was reimported and visually checked. The repeatable structural check also rejects a misplaced hierarchy.

Research artifacts are in `tmp/asset-research/`:

- `provenance.json` records source pages, direct downloads, licenses, modifications, and source ZIP hashes.
- `licenses/` contains CC0, CC-BY 4.0, MPFB's asset scope, and the embedded source notices.
- `sources.tsv` and `source-verification.json` identify 35 checked source entries and their saved text hashes. Some raw scratch requests in `sources/` failed or redirected. Only the indexed verified entries support this document.
- `base-mesh-inspection.json` and `rain-inspection.json` record actual source geometry, UV bounds, materials, and shape keys.
- `verification.json` records hashes and GLB structure checks. `assets/extracted-stylized-head-clay-check.png` is the imported-GLB render. `assets/rain-official-preview.jpg` is the official character-page thumbnail, not a newly rendered result.

Run the artifact checks from the repository root:

```sh
node tmp/asset-research/verify_sources.mjs
node tmp/asset-research/verify_assets.mjs
```

The extraction and render are repeatable with the scripts in that directory:

```sh
blender --background --factory-startup --disable-autoexec \
	tmp/asset-research/assets/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend \
	--python tmp/asset-research/export_cc0_head.py -- \
	tmp/asset-research/assets/extracted-stylized-head.glb
blender --background --factory-startup --disable-autoexec --threads 4 \
	--python tmp/asset-research/render_head_check.py -- \
	tmp/asset-research/assets/extracted-stylized-head.glb \
	tmp/asset-research/assets/extracted-stylized-head-clay-check.png
```

Not verified in this run are browser appearance, paint-mask correctness, an AI face comparison, exported Rain expressions, complete UV overlap tests, and real-phone performance. Those are the next acceptance checks, not completed results.

[blender-demo]: https://www.blender.org/download/demo-files/
[rain]: https://studio.blender.org/characters/rain/
[mpfb-license]: https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md
[mpfb-assets]: https://static.makehumancommunity.org/assets/assetpacks/index.html
[mpfb-targets]: https://static.makehumancommunity.org/mpfb/docs/assets/concept_targets.html
[mpfb-makeup]: https://static.makehumancommunity.org/mpfb/docs/assets/makeup.html
[hunyuan2]: https://github.com/Tencent-Hunyuan/Hunyuan3D-2
[hunyuan21]: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
[hunyuan2-license]: https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE
[hunyuan21-license]: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE
[hunyuan-omni]: https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni
[hunyuan-buffalo]: https://github.com/Tencent-Hunyuan/Hunyuan3D-Buffalo1.0
[trellis]: https://github.com/microsoft/TRELLIS
[trellis2]: https://github.com/microsoft/TRELLIS.2
[trellis2-license]: https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE
[trellis2-texture]: https://github.com/microsoft/TRELLIS.2/blob/main/example_texturing.py
[meshy-docs]: https://docs.meshy.ai/llms-full.txt
[meshy-retexture]: https://docs.meshy.ai/api/retexture
[meshy-pricing]: https://docs.meshy.ai/api/pricing
[meshy-ownership]: https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models
[meshy-privacy]: https://help.meshy.ai/en/articles/15724182-is-meshy-safe-and-private-data-and-training-faq
[tripo-sdk]: https://github.com/VAST-AI-Research/tripo-python-sdk
[tripo-texture]: https://developers.tripo3d.ai/en/docs/models-texture
[tripo-pricing]: https://developers.tripo3d.ai/en/pricing
[tripo-terms]: https://developers.tripo3d.ai/en/terms
[rodin-generation]: https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5
[rodin-texture]: https://docs.hyper3d.ai/en/api-specification/generate-texture
[rodin-retention]: https://docs.hyper3d.ai/en/legal/data-retention-policy
[rodin-terms]: https://hyper3d.ai/legal/terms
[rodin-pricing]: https://hyper3d.ai/pricing?lang=en
[flame-license]: https://flame.is.tue.mpg.de/modellicense.html
[flame-download]: https://flame.is.tue.mpg.de/download.php
[vroid-guidelines]: https://vroid.com/en/studio/guidelines
[threejs-gltf]: https://threejs.org/docs/pages/GLTFLoader.html
