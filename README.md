# vrm-web

Puts a VRoid anime-style 3D character on a website, small enough to load fast, dancing in time to a song.

It was built for a website where a VRoid character performs a three-minute song from start to finish.

## Good for

- Shrinking a VRoid / VRM model from about 15 MB to about 1.5 MB with no visible loss
- Making a character dance to music and stay on the beat when the song is paused or skipped
- Using motion-capture or Mixamo animations on a VRM character
- Checking whether dance motion you bought may be used on a commercial site

## Install

In Claude Code, run:

```
/plugin marketplace add skyeyesec333/vrm-web
/plugin install vrm-web@vrm-web
```

Or copy the skill into your own skills folder:

```sh
git clone https://github.com/skyeyesec333/vrm-web
cp -r vrm-web/skills/vrm-web ~/.claude/skills/
```

You can also copy it into one project's `.claude/skills/` folder instead.

## Try asking Claude

In a project with a VRM model:

- "Get this VRoid model onto the site and make it as small as you can"
- "Make her dance to this song with these mocap takes"
- "Her hair flies everywhere when I seek the song"
- "Can we use these dance takes on our studio site?"

Or call it directly: `/vrm-web` (as a plugin: `/vrm-web:vrm-web`).

## You'll need

- [Claude Code](https://claude.com/claude-code)
- Python 3.8+ with Pillow built with WebP (for packing)
- [Blender](https://www.blender.org) 4.x or 5.x (only for converting FBX motion capture)
- In the site: three.js r160+ and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) 3.x

## How it works

```
VRoid export → pack (15 MB → 1.5 MB served) → load gzipped → mocap takes → a dance locked to the song → cel light
```

1. **Packs the VRM** (`vrm_pack.py`). It keeps the shape, skin, bones, hair springs, materials and expressions. It drops what you can't see: unused face shapes, every shape's normals, normal maps when the shader reads colour only (they become flat), the preview thumbnail and the exporter's name. Colour maps become WebP with exact transparency. It writes a gzipped `.vrmz` too, and can set restrictive VRM permissions for an original character.
2. **Loads it gzipped** (`vrmz-loader.js`). The browser unpacks it as it arrives, since hosts like Cloudflare don't compress model files. Older browsers get the plain `.vrm`.
3. **Converts motion capture** (`fbx_to_take.py`, in Blender). A T-pose FBX becomes a compact `.take` file that plays on any VRM (`take-clip.js`). `take_info.py` checks the files. Mixamo animations are retargeted in the browser (`mixamo-retarget.js`).
4. **Dances to the song** (`song-dance.js`). The pose comes from the song's playback time, so it stays on the beat through pauses and skips. Clips fit whole bars of music and blend smoothly into each other.
5. **Brings the face and hair to life** (`character.js`): uneven blinks, a singing mouth, a soft smile between lines, and hair springs reset whenever the song jumps.
6. **Lights it** (`cel-material.js`, optional). A cartoon-style shader with its own key light, so the scene's lamps and glow don't wash the character out.
7. **Checks the motion's licence** with you before a commercial site uses it. This covers non-commercial tiers, credit lines and choreography rights. It is not legal advice.

By hand, with paths relative to the cloned repo:

```sh
python3 skills/vrm-web/scripts/vrm_pack.py character.vrm public/models/character.vrm --meta-restrict
blender -b --factory-startup --python skills/vrm-web/scripts/fbx_to_take.py -- take.fbx public/motion/move-a.take
python3 skills/vrm-web/scripts/take_info.py public/motion/*.take
```

Then copy `skills/vrm-web/scripts/web/*.js` into your project and follow `SKILL.md`.

## Licence

MIT. See [LICENSE](LICENSE). Motion data, models and music you use keep their own licences: see `skills/vrm-web/references/motion-licences.md`.
