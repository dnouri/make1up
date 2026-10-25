# Third-party notices

## Rain portrait

`public/face/v2/` contains the modified Rain character portrait used by the game.

Rain Rig (CC) Blender Foundation | studio.blender.org.

- Source is <https://studio.blender.org/characters/rain/>.
- License is Creative Commons Attribution 4.0 International, <https://creativecommons.org/licenses/by/4.0/>.
- Local license and source notices are under `public/face/v2/licenses/`.
- `public/face/v2/CREDITS.txt` contains the distributed credit.
- `public/face/v2/provenance.json` identifies the exact source download, hash, and modifications.
- `public/face/v2/asset.json` records generated file hashes, morph targets, maps, and the paint contract.
- Changes include the neutral portrait export, material conversion, crop, fitted neck seam, brows, ponytail, fixed catchlights, iris recolors, second paint UVs, and masks.
- V2 adds bounded face, nose, mouth, and eye morphs, fitted lash deformation, a separate crown-bun mesh and fabric band, and offline complexion and hair recolors. The recolors are not newly photographed skins.

`art/neutral/` holds the licensed neutral authoring inputs used to reproduce v2. The app does not load them.

The app's credit dialog and exported covers retain the credit and license information. Blender Foundation does not endorse this game. The portrait is not AI-generated.

## Typefaces

Bodoni Moda is by indestructible type*. DM Sans is by Colophon Foundry and its contributors. The local WOFF2 files use the SIL Open Font License 1.1.

`public/fonts/` contains both license texts and the exact source notes. The app does not request fonts from a third-party server at runtime.

## Three.js

Three.js is copyright its authors and uses the MIT license. The browser code uses Three.js, GLTFLoader, and RoomEnvironment. Its license is distributed at `public/licenses/three-MIT.txt`. Package versions are locked in `package-lock.json`.

## Project skills

The six copied skill directories under `.agents/skills/` retain their original MIT licenses and `UPSTREAM.md` attribution records. They come from pinned revisions of Allan Alton's Three.js skills and Majid Manzarpour's Three.js Game Skills. The [selection record](docs/research/skills.md) lists exact revisions, included files, other options, and API cautions.

## Research references

Facecard, Dress to Impress, Makeup Mania, and their public images and videos were used as references. No license to redistribute their game assets was established. Research captures remain local under `tmp/reference/` and are not runtime assets. No restricted Roblox source or asset package was recovered or included.
