---
name: vrm-web
description: Take a VRoid / VRM character to a light, good-looking, dancing character on a website with three.js and three-vrm. Packs the VRM (15 MB to about 1.5 MB gzipped with no visible loss), loads it gzipped, converts mocap FBX takes into compact clips any VRM plays, retargets Mixamo clips, drives a dance from a song's playback time, gives the face blinks and singing, and swaps MToon for a cel shader with its own key light. Use when the user has a VRM or VRoid model for a site, mentions three-vrm, MToon burning out, a character dancing to a song, mocap or Mixamo animations on a VRM, hair springs flailing, or a VRM that is too big to ship; also to check the licence of motion data before a commercial site uses it.
---

# VRM on the web: pack, load, animate, light

From a VRoid Studio export to a character that dances in time with a song on a production site. The numbers below are from a real VRoid character: 15.3 MB as exported, 3.6 MB packed, 1.5 MB as served.

```
1. pack      scripts/vrm_pack.py in.vrm out.vrm        -> out.vrm + out.vrmz (gzipped)
2. load      web/vrmz-loader.js  PackedVRMLoader      -> inflates as it arrives; plain .vrm for old browsers
3. set up    web/character.js    setupCharacter       -> clean-ups, sagging springs removed, face, spring resets
4. motion    scripts/fbx_to_take.py (Blender) -> .take -> web/take-clip.js
             or web/mixamo-retarget.js for Mixamo-named glTF clips
5. dance     web/song-dance.js   createSongDance      -> pose from the song's time, hand-offs, blends
6. light     web/cel-material.js applyCel             -> three hard bands, its own key light (optional)
7. licence   references/motion-licences.md            -> before a commercial site uses any motion data
```

`S` below is this skill's `scripts/` folder: `S="${CLAUDE_SKILL_DIR}/scripts"` (for a plugin or a copied skill alike). Copy the files in `$S/web/` into the user's project (they import `three`; the loader also uses `three/examples/jsm/loaders/GLTFLoader.js`); don't import them from the skill folder.

## 1. Pack the VRM

```sh
python3 "$S/vrm_pack.py" character.vrm public/models/character.vrm [--meta-restrict] [--meta-authors "Name"]
```

What goes, and why it is safe ([references/pipeline.md](references/pipeline.md) has the numbers):
- **face shapes no expression uses** (VRoid exports ~57; expressions name ~14) and **every shape's normals**. Often the largest saving.
- **normal maps** become flat 8 px maps. Only when the shader reads colour maps (the cel shader here, or flat-lit MToon). If the user keeps lit MToon or PBR with normal maps, pass `--keep-normal-maps`.
- **the thumbnail** (often ~2 MB).
- **colour maps** re-saved as WebP when smaller, alpha exact.
- **the exporter's name** (`asset.generator`). The VRM meta (authors, licence, permissions) is printed and kept; `--meta-restrict` sets the restrictive permissions an original character usually wants (only the author may use it, no redistribution or modification). **Ask the user** before changing authors or permissions; it is their character.

It writes `<out>z`, the gzipped copy the site serves. **Never decimate a VRoid face** (it creases), and don't repaint skin.

Check: the printed sizes; then load it (step 2) and look at the face, blink and open mouth, the hair, and the back.

## 2. Load it gzipped

Hosts like Cloudflare compress by content type and leave model files uncompressed, so the `.vrmz` is gzipped once at build time and inflated in the browser. Put both files in the site; `PackedVRMLoader` falls back to the `.vrm` when `DecompressionStream` is missing, and accepts the file already inflated if a dev server sent it with `Content-Encoding: gzip`.

```js
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { PackedVRMLoader } from "./vrmz-loader.js";
const gltf = await new PackedVRMLoader().register((p) => new VRMLoaderPlugin(p)).loadAsync("/models/character.vrmz");
const vrm = gltf.userData.vrm;
```

## 3. Set it up (once), then update it (every frame)

```js
import { setupCharacter } from "./character.js";
const ch = setupCharacter(vrm, { VRMUtils, bpm: 120, downbeat: 0.48 });
const retarget = makeRetargeter(vrm);   // only if using Mixamo clips: NOW, while the model is still at rest
...
ch.update(dt, { songTime: audio.currentTime, playing: !audio.paused, singing: lineLevel });   // after the dance
```

- **Bust springs are deleted** (`dropSprings`, default `/bust/i`): under dancing they sag to one side and stay.
- **Hair springs are reset on every jump** (a seek, play or stop): otherwise the hair flies across the face.
- **The face:** uneven blinks, `aa` shaped on the half-beats while `singing` > 0, `relaxed` between lines. Keep the mouth shut where the vocal is an ad-lib over the track, or before the first verse: drive `singing` from real lyric-line times.

## 4. Motion

**Mocap FBX (T-pose rest) → `.take`**, offline, in Blender:

```sh
blender -b --factory-startup --python "$S/fbx_to_take.py" -- take.fbx public/motion/move-a.take [--start 2.4] [--end 20]
python3 "$S/take_info.py" public/motion/*.take        # checks each file; exits 1 on a bad one
```

A `.take` holds rotations for normalised VRM bones, so it plays on any VRM with no per-model work (`takeClip(buffer, vrm, name)` in the browser). It finds the first real movement and starts half a second before it; that is the first gesture, not always where the dance starts, so pass `--start` when it matters. Names no source file. Two bone-naming schemes are recognised; for another rig, add its names to a map in the script.

**Mixamo-named glTF clips:** `makeRetargeter(vrm)` right after loading, then `retarget(gltf)` returns clips. The spine, neck and head take no rest correction (it pitches the chest and neck), limbs do.

## 5. Dance to the song

```js
const dance = createSongDance(vrm.scene, { bpm, downbeat, clips: { a, b }, choreo: [[4, "a", { bars: 8 }], [12, "b", { bars: 8 }]] });
dance.update(audio.currentTime, !audio.paused, dt);   // before ch.update
```

- **The song is the clock.** The pose comes from the audio's playback time alone, never frame time, so the moves stay on the beat through pauses, seeks and slow frames. Measure `bpm` and the first downbeat from the track (onset autocorrelation, or tap along and fit), don't guess.
- **`bars`** plays a clip over exactly that many bars (a few percent of stretch). Choose cuts that already fit.
- **Hand-offs** start each new clip where its pose is nearest the outgoing one (`dance.state.handoffs` lists them, with degrees apart); `from` overrides by hand.
- **Blends are 1.2 s across the bar line.** The outgoing clip **holds its last frame** instead of wrapping.
- **The dance owns the head and neck.** A look-at-camera overlay flattens choreography into a stare: only add it when idle.
- Never reset a mixer-driven bone and expect the mixer to rewrite it: the mixer only writes values that changed. Layer idles on top of what it wrote.

## 6. Light: a cel shader with its own key light (optional)

MToon is lit by the scene's lights; a scene built for atmosphere (many lamps, bloom, high exposure) burns it out and speckles its bands. `applyCel(vrm.scene, { gain })` replaces each material with three hard bands under one key light the shader owns, plus a cool rim; call `updateCel(cel, camera)` each frame. Keep `gain` under the bloom threshold. It drops MToon's outlines: add an inverted-hull pass if the look needs ink lines. If the scene is plain and MToon looks right, skip this step.

## 7. Motion licences: before a commercial site goes live

Read [references/motion-licences.md](references/motion-licences.md) with the user for every source of motion. A portfolio or site that sells work is **commercial promotion**. Common traps: a "standard" or free tier that is non-commercial only; a required disclosure line; files served in a form "from which the original can be extracted"; the choreography of a real song needing its own rights. Say what the terms appear to say and that **it is the user's decision, not legal advice**.

## Downloads

Downloading anything (Blender, a mocap pack, a model, Python packages) needs the user's yes first: say the file, where from, and its size.

## Files

- `scripts/vrm_pack.py` (Python 3 + Pillow with WebP), `scripts/fbx_to_take.py` (Blender 4/5), `scripts/take_info.py` (standard library).
- `scripts/web/`: `vrmz-loader.js`, `take-clip.js`, `mixamo-retarget.js`, `song-dance.js`, `character.js`, `cel-material.js` (ES modules for three r160+ and @pixiv/three-vrm 3.x).
- `references/pipeline.md` (sizes, hosting, checks), `references/motion-licences.md`.
