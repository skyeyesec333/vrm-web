# Pipeline notes: sizes, hosting, checks

## Where a VRoid export's weight goes (a real character, 15.3 MB)

| Part | As exported | Packed | Why it can go |
|---|---|---|---|
| Face shapes (57, with normals) | ~5.9 MB | ~0.7 MB (14, positions only) | expressions name ~14; a flat-lit or cel face never reads shape normals |
| Normal maps | ~3 MB (body alone 2.9) | ~0 (flat 8 px) | the cel shader reads colour maps only |
| Thumbnail | ~1.8 MB | 0 | never shown on a site |
| Colour maps (PNG) | ~1.9 MB | ~0.3 MB (WebP) | lossless-looking WebP at q90, alpha exact |
| Geometry, skin, bones | ~2.5 MB | unchanged | |
| **File** | **15.3 MB** | **3.6 MB**, **1.5 MB gzipped** | |

Keep the normal maps (`--keep-normal-maps`) if the shader uses them (lit MToon with normal textures, PBR). Keep the thumbnail if the file is also distributed as an avatar.

## Hosting

- Serve `character.vrmz` (fetched) and `character.vrm` (fallback) side by side. Both are `application/octet-stream`; a long cache (`Cache-Control: public, max-age=31536000, immutable`) is right if the file name changes when the model does.
- Don't also set `Content-Encoding: gzip` on the `.vrmz`: the browser would inflate it, and the loader handles that, but the download is the same size and caches may store it twice.
- `.take` files compress only ~10-15% further; leave them raw.
- Lazy-load: fetch the model only when the character is about to be shown (a scroll position, a click). 1.5 MB on a phone over 4G is about a second.

## Checks after packing

1. The printed sizes are in the expected range.
2. Load it: face front and side, a blink (`blink` 1), open mouth (`aa` 1), the back of the hair, a dance frame. A missing face shape shows as an expression that does nothing.
3. If you used `--meta-restrict` / `--meta-authors`, the printed meta line says what you meant.
4. `take_info.py` on every take: frames, fps and size add up; no extra header keys (served files should not name their source).

## Scale

A VRM is in metres. Scale the scene root (`vrm.scene.scale.setScalar(k)`) to fit the site, and measure height from the head bone (it sits at about 7/8 of standing height) rather than the bounding box, which hair and accessories inflate.

## Rotations

`VRMUtils.rotateVRM0(vrm)` turns a VRM 0.x model to face +z like 1.0. Takes and retargeted clips assume the VRM 1.0 convention (the figure faces +z, its left is +x).
