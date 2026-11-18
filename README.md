# vrm-web

A Claude Code skill that takes a **VRoid / VRM character** to a light, good-looking, dancing character on a website with three.js and [three-vrm](https://github.com/pixiv/three-vrm):

```
VRoid export → pack (15 MB → 1.5 MB served) → load gzipped → mocap takes → a dance locked to the song → cel light
```

It was built for a production site where a VRoid character performs a three-minute song start to finish in a three.js scene, and it carries the lessons from that: what in a VRM can go without visible loss, why the hair flails after a seek, why a dance must take its time from the audio, and why MToon burns out under a moody scene's lights.

## What the skill does

1. **Packs the VRM** (`vrm_pack.py`): keeps geometry, skin, bones, springs, materials and expressions; drops unused face shapes and every shape's normals, flat normal maps (when the shader reads colour only), the thumbnail, the exporter's name; WebP colour maps with exact alpha; writes a gzipped `.vrmz`. Optional restrictive VRM permissions for an original character.
2. **Loads it gzipped** (`vrmz-loader.js`): inflated in the browser with `DecompressionStream` (hosts like Cloudflare don't compress model files), the plain `.vrm` for older browsers.
3. **Converts mocap** (`fbx_to_take.py`, in Blender): a T-pose FBX becomes a compact `.take` of rotations for normalised VRM bones that plays on any VRM (`take-clip.js`); `take_info.py` checks the files. Mixamo-named glTF clips retarget in the browser (`mixamo-retarget.js`).
4. **Dances to the song** (`song-dance.js`): the pose comes from the audio's playback time, so it stays on the beat through pauses and seeks; clips fit whole bars, hand-offs start at the nearest pose, 1.2 s blends, and an outgoing clip holds its last frame.
5. **Brings the face and springs to life** (`character.js`): uneven blinks, a singing mouth on the half-beats, a soft smile between lines, sagging chest springs removed, hair springs reset on every jump.
6. **Lights it** (`cel-material.js`, optional): three hard bands under a key light the shader owns, so a scene's lamps and bloom don't burn it out.
7. **Checks the motion's licence** with you before a commercial site uses it (non-commercial tiers, disclosure lines, choreography rights). Not legal advice.

## Install

**As a Claude Code plugin** (from inside Claude Code):

```
/plugin marketplace add skyeyesec333/vrm-web
/plugin install vrm-web@vrm-web
```

**Or as a plain skill:**

```sh
git clone https://github.com/skyeyesec333/vrm-web
cp -r vrm-web/skills/vrm-web ~/.claude/skills/
```

(or into a project's `.claude/skills/` to keep it to that project).

## Use

Just ask, in a project with a VRM:

- "Get this VRoid model onto the site and make it as small as you can"
- "Make her dance to this song with these mocap takes"
- "Her hair flies everywhere when I seek the song"
- "Can we use these dance takes on our studio site?"

or call it directly: `/vrm-web` (as a plugin: `/vrm-web:vrm-web`).

By hand:

```sh
python3 skills/vrm-web/scripts/vrm_pack.py character.vrm public/models/character.vrm --meta-restrict
blender -b --factory-startup --python skills/vrm-web/scripts/fbx_to_take.py -- take.fbx public/motion/move-a.take
python3 skills/vrm-web/scripts/take_info.py public/motion/*.take
```

then copy `skills/vrm-web/scripts/web/*.js` into your project and follow `SKILL.md`.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Python 3.8+ with Pillow built with WebP (for packing)
- [Blender](https://www.blender.org) 4.x or 5.x (only for converting FBX mocap)
- In the site: three.js r160+ and @pixiv/three-vrm 3.x

## Licence

MIT. See [LICENSE](LICENSE). Motion data, models and music you use keep their own licences: see `skills/vrm-web/references/motion-licences.md`.
