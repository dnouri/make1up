# The Rain v2 portrait asset

`public/face/v2/` is the runtime portrait distribution. `asset.json` records its file hashes, meshes, morph targets, paint contract, and map dimensions. `art/avatar-v2.json` defines the choices and authoring recipes. `art/neutral/` contains locked authoring inputs. The app does not load that directory.

## Distributed files

The distribution contains these files:

| File | Content |
| --- | --- |
| `head.glb` | The portrait geometry, embedded neutral color maps, position and normal morphs, and both hairstyle component sets. |
| `maps/skin-{fair,warm,tan,brown,deep}.png` | Five 2048 by 2048 face color maps. |
| `maps/bust-{fair,warm,tan,brown,deep}.png` | Five matching 512 by 512 bust color maps. |
| `maps/hair-{espresso,chestnut,plum,blonde}.png` | Four 1024 by 1024 hair color maps. |
| `maps/eyes-{blue,hazel,olive}.png` | Three 1024 by 1024 iris color maps. |
| `makeup-blank.png` and `masks/` | The blank paint image and six 1024 by 1024 masks. |
| `source-correspondence.json` | The exact source-position and base-UV correspondence used for the full-mouth target. |
| `CREDITS.txt`, `provenance.json`, and `licenses/` | Required credit, source hashes, modification records, and license texts. |

The GLB is 10,562,028 bytes. It stores 14 meshes and 130,014 triangles across both hairstyle sets. These file totals are not an active-scene triangle count or a measured device budget.

## Shape and component contract

The head uses meters, with +Y up and +Z forward. Neutral attributes, indices, node transforms, materials, base UVs, and paint UVs remain locked to `art/neutral/head.glb`. Morph targets add position and normal deltas without changing that topology.

The `Face` mesh has seven named targets:

- `face-soft` and `face-angular` change the face shape.
- `nose-broad` and `nose-rounded` change the nose shape.
- `mouth-full` and `mouth-wide` change the mouth shape.
- `eyes-round` changes the eye aperture.

Balanced choices use zero weights. Each other categorical choice applies its named target at weight 1. The registry defines 54 face, nose, mouth, and eye-shape combinations. The generator pins the neck, hairline, ears, and rear of the face. The full-mouth target transfers the source lip shape keys through exact position and UV correspondence.

`Lashes` has its own fitted `eyes-round` target. The renderer applies the face and lash targets together. `Brows`, `Eye.L`, `Eye.R`, and `EyeHighlights` remain separate meshes. The opaque textured eyes omit the source refractive cornea. Fixed catchlights do not provide tested gaze or blink animation. There are no expression presets.

Hairstyle visibility follows the registry's complete component sets:

| Choice | Visible components |
| --- | --- |
| Ponytail | `Hair`, `HairSweep`, `HairTail`, `HairTie`. |
| Crown bun | `Hair`, `HairSweep`, `HairBun`, `BunBand`. |

`HairBun` is a separate ridged crown mesh. `BunBand` is its fitted fabric band. Selecting the bun hides the ponytail and its tie. It does not reshape the ponytail into a bun.

The current renderer limits turning to 28 degrees horizontally and 12 degrees vertically. Views outside that range need separate art and picking checks. The cropped bust has an open underside and cropped arm ends that remain outside the supported framing.

## Paint coordinates and masks

`Face` samples its immutable base color through `uv`, which is `TEXCOORD_0`. Makeup uses `uv1`, which is `TEXCOORD_1`. The frozen atlas identifier is `rain-front-v1`. That identifier names the paint coordinates, not a runtime portrait revision.

The atlas uses a top-left image convention. A hit maps to canvas pixels with `x=u*width` and `y=v*height`. Its authored frontal projection is `u=(localX+0.15)/0.30` and `v=(0.445-localY)/0.295` on eligible polygons only. Those coordinates stay fixed when the mesh morphs. They are not recalculated from the posed vertex positions.

Rear, hidden, and out-of-range polygons use the reserved UV `[0,0]`. Every paint image retains a transparent three-pixel border. The red channel of `masks/paint-valid.png` limits all tools to paintable face skin.

The tool registry in `src/look.ts` has one region per tool. Lipstick uses `masks/lips.png`. Blush, eyeshadow, liner, sparkle stamp, erase, and blend use the valid-face mask. Cheek and eyelid masks remain scoring guides, not restrictions on blush or eyeshadow. Guided apply uses the manifest's paint-UV landmarks.

Pigment textures use `flipY=false` and `SRGBColorSpace`. Masks and the finish texture use `flipY=false` and `NoColorSpace`. The material composites pigment after it samples the base map. A separate finish channel changes roughness. Removal clears makeup without changing freckles, natural lip color, or the selected complexion map.

## Morph-aware picking

`src/picking.ts` builds a per-instance `SkinnedMeshBVH` for meshes with position morphs. The renderer refits those trees after each complete face and lash pose change. Other meshes use static geometry indexes. Picking does not change global Three.js prototypes or triangle order.

The renderer raycasts all visible portrait meshes. A brush hit is valid only when the nearest hit is `Face`, its interpolated second UV avoids the reserved border, and the valid-face mask permits paint. Eyes, lashes, and visible hair can therefore block a brush. Mirror painting reflects the hit in local X and raycasts again rather than assuming that UV coordinates are symmetric.

## Authored color maps

Complexion maps preserve source detail and natural lip contrast through offline color recipes. Matching bust maps retain the fitted neck seam. Hair maps preserve strand contrast, and the registry supplies a matching brow color. These maps are recolors of the Rain artwork, not newly photographed skins or AI-generated artwork.

`src/appearance.ts` reuses embedded maps for the default Warm complexion, Espresso hair, and Blue irises. It loads other selected maps on demand. External color maps use `flipY=false` and `SRGBColorSpace`. The renderer rejects stale requests and blocks paint, analysis, and export while the requested appearance is loading or unavailable.

## Required credit

The required credit is `Rain Rig (CC) Blender Foundation | studio.blender.org`.

The app's asset credits and exported covers retain that credit, identify the portrait as modified, and give the Creative Commons Attribution 4.0 license at <https://creativecommons.org/licenses/by/4.0/>. The source page is <https://studio.blender.org/characters/rain/>. Blender Foundation does not endorse the game.

`v2/CREDITS.txt`, `v2/provenance.json`, and `v2/licenses/` belong with the distributed asset. The notices record the bounded morphs, fitted lashes, separate bun, and offline recolors alongside the neutral portrait modifications.

## Reproduce the distribution

Generation requires Blender with NumPy and Pillow available to its Python interpreter. The checked-in inputs are `art/avatar-v2.json` and `art/neutral/`. The licensed source files must also exist at these recorded paths:

- `tmp/asset-research/assets/rain-v33.zip`.
- `tmp/asset-research/assets/Rain v3.3/rain_v3.2.blend`.

`v2/provenance.json` records the download URL and archive hash. The generator checks that hash and verifies the unpacked `.blend` against the ZIP member. It opens the source with scripts disabled and does not save it. The public preflight uses the generated files and does not need these source downloads.

Run generation and the distribution preflight from the repository root.

```sh
blender --background --factory-startup --disable-autoexec --threads 4 \
	--python-exit-code 1 --python scripts/prepare-avatar.py -- \
	--output-dir public/face/v2
node scripts/verify-assets.mjs public/face/v2 --geometry-only
```

`npm run verify:assets` runs the same preflight. Generation is self-contained in `scripts/prepare-avatar.py`. It retains the neutral binary data, adds the targets and bun, writes the maps and notices, and records input and output hashes. It verifies that the neutral inputs remain unchanged.

The public directory contains runtime files only. The generator rejects render output there and rejects output paths outside the allowed public or proof directories.

Generate a separate proof with fresh GLB-import renders.

```sh
blender --background --factory-startup --disable-autoexec --threads 4 \
	--python-exit-code 1 --python scripts/prepare-avatar.py -- --render
node scripts/verify-assets.mjs tmp/avatar-customization/asset-proof
```

Proof contact sheets also need DejaVu Sans at `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`. The full proof includes each choice in front and three-quarter views, color and clay views, and all 54 shape combinations in clay.

The checker verifies hashes, locked topology and UVs, masks, combined morph bounds, triangle area and orientation, lash attachment, closed-mouth samples, bun closure, map detail, and neck color matching. Without `--geometry-only`, it also checks the render index and image hashes. Those checks are conservative local tests, not an exhaustive self-intersection proof or human art approval.

## Runtime release checks

Release checks cover these behaviors:

- Asymmetric cheek paint stays on the same skin when the face morphs or turns.
- Lipstick follows the frozen lip mask without reaching teeth, eyes, or other skin.
- Removing makeup reveals the selected base maps unchanged.
- Rear and hidden polygons remain unpainted.
- Visible eyes, lashes, and hair block brush hits after shape and hairstyle changes.
- Loading failures, retry, undo, redo, saved looks, and capture restore the correct live appearance.
- PNG exports use the selected identity and retain the credit.

Physical lower-end phone load, GPU memory, brush response, thermal behavior, and export remain separate device checks. Automated geometry and Chromium checks do not establish those results.
