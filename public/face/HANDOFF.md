# Load the Rain portrait

Use `v1/head.glb` as a static portrait. Read `v1/asset.json` for the exact bounds, mesh names, materials, paint coordinates, and limits.

## Keep the required credit

Display `Rain Rig (CC) Blender Foundation | studio.blender.org` in the app's asset credits. Link to `https://creativecommons.org/licenses/by/4.0/` and identify the portrait as modified.

Keep `CREDITS.txt`, `provenance.json`, and `licenses/` with the distributed asset. Do not describe this art as AI-generated or photorealistic.

## Frame the head

1. Load `/face/v1/head.glb` with `GLTFLoader`.
2. Keep its meter scale and its node transforms.
3. Use `+Y` as up and `+Z` as front.
4. Aim the camera at `[0, 0.277, 0]`.
5. Start an orthographic camera at `[0, 0.277, 1.7]` with a vertical span of `0.54` meters.
6. Limit portrait rotation to about 28 degrees horizontally and 12 degrees vertically until you test other views.
7. Use broad neutral light with a weak lavender fill. Avoid a strong top rim light, which makes the sculpted hair too shiny.

Keep the lower edge of the cropped bust outside the image. Do not show the open underside or the cropped arm ends.

## Keep makeup separate from skin

1. Find the mesh named `Face`.
2. Keep its existing `Skin` material map on `uv`, which is `TEXCOORD_0`.
3. Read the paint coordinates from `uv1`, which is `TEXCOORD_1`.
4. Create a transparent paint canvas with a separate undo history.
5. Set the paint texture's `flipY` to `false` and its color space to `SRGBColorSpace`.
6. Load the masks with `flipY=false` and `NoColorSpace`.
7. Multiply the paint alpha by the red channel of `masks/paint-valid.png`.
8. Blend the paint color over the material's sampled base color. Do not draw into `skin-base.png`.
9. Use a separate roughness blend for gloss. Do not simulate gloss only with a brighter lip color.
10. Clear the paint canvas to remove makeup. Do not replace or recolor the base skin during removal.

The exported paint UV uses a top-left image convention. Map a UV hit to canvas pixels with `x=u*width` and `y=v*height`. The equivalent frontal formula is `u=(localX+0.15)/0.30` and `v=(0.445-localY)/0.295`.

Do not regenerate that projection for every vertex. Only approved front-visible polygons have projected coordinates. Other polygons use the reserved UV `[0,0]`. Keep the three-pixel texture border transparent.

Raycast all visible portrait meshes. Accept a brush hit only when the nearest visible hit is `Face` and its paint UV is not `[0,0]`. This prevents paint through the eyes or hair. Use the interpolated second UV attribute, not the first UV hit.

Use `masks/lips.png` for lipstick. Use the separate cheek and eyelid masks for soft regional tools. Treat those soft masks as guides, not complete anatomical segmentation.

## Change the eye color

1. Find `Eye.L` and `Eye.R`.
2. Keep the opaque `IrisSclera` material.
3. Load `eyes-blue.png`, `eyes-hazel.png`, or `eyes-olive.png` as its color map.
4. Set an external eye map's `flipY` to `false` and its color space to `SRGBColorSpace`.
5. Keep roughness near `0.22` and clearcoat near `0.35`.

Do not add an opaque cornea over the eyes. The export deliberately uses the textured eye meshes without the source refractive cornea.

Keep `EyeHighlights` attached to the portrait. Remove or refit those fixed catchlights if you later add eye movement. This asset has no tested gaze or blink animation.

## Verify browser integration

Check the following conditions before release:

- Compare the browser's front and rotated views with `tmp/art-probe/evidence/rain-same-light.png` and `paint-three-quarter.png`.
- Paint one cheek only. Rotate the head and confirm that the mark stays on that cheek.
- Paint the lips. Confirm that no color reaches the teeth area, eyes, or skin outside the intended border.
- Clear all makeup. Confirm that the source freckles and natural lip color return unchanged.
- Fill the paint canvas except its reserved border. Inspect the rear head and confirm that it remains unpainted.
- Test mouse and touch painting, pointer cancellation, undo, resize, and restored saved looks.
- Check load time, GPU memory, and frame rate on a real lower-end phone. The asset has 111,070 triangles and a 4.79 MB uncompressed GLB. It is not a measured mobile budget.

Do not expose identity or expression presets that the asset does not contain. The supported geometry is one neutral Rain portrait. The only supplied appearance variants are the iris recolors.

## Repeat the export

Keep the source files and license records under `tmp/asset-research/`. The source paths and ZIP hash are in `provenance.json`.

Run the export from the repository root:

```sh
blender --background --factory-startup --disable-autoexec --threads 4 \
	--python-exit-code 1 --python scripts/prepare-face.py -- \
	--render-dir tmp/art-probe/final
```

Run the separate artifact check:

```sh
node tmp/art-probe/verify-glb.mjs
```

Use `--research-dir` if the licensed source folder is elsewhere. Do not enable the source file's embedded scripts. The exporter needs Blender's built-in Python and NumPy, not external generation services.
