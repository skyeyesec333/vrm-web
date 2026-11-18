/* The per-character glue around three-vrm: tidy the model once, keep its springs sane, and give its face life.

     import { VRMUtils } from "@pixiv/three-vrm";
     const ch = setupCharacter(vrm, { VRMUtils });     // once, right after loading (before makeRetargeter)
     // every frame, after the dance has posed the bones:
     ch.update(dt, { songTime: audio.currentTime, playing: !audio.paused, singing: level0to1 });

   - removeUnnecessaryVertices / combineSkeletons: three-vrm's own clean-ups (fewer vertices, one skeleton).
   - springs matching `dropSprings` (default /bust/i) are deleted: VRoid's chest springs sag to one side under
     dancing and stay there; without them the chest keeps its modelled shape.
   - hair and skirt springs are reset whenever the pose jumps (a seek, play starting or stopping, a clip change in a
     held moment): left alone, they fling across the face for a second as they catch up.
   - the face: a blink every 2-5.5 s (shut in 60 ms, open in 120, sometimes two together), the mouth ("aa") opened
     by `singing` (0..1, e.g. 1 while a lyric line is sung, shaped on the half-beats if you pass bpm), and "relaxed"
     (a soft smile) between lines. Expression names are VRM 1.0 presets; a model without one just skips it. */

export function setupCharacter(vrm, { VRMUtils = null, dropSprings = /bust/i, jumpSeconds = 0.3, bpm = 0, downbeat = 0 } = {}) {
  if (VRMUtils) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    (VRMUtils.combineSkeletons || VRMUtils.removeUnnecessaryJoints)?.(vrm.scene);
  }
  const sb = vrm.springBoneManager;
  let dropped = 0;
  if (sb && dropSprings) for (const j of [...sb.joints]) if (dropSprings.test(j.bone.name)) { sb.deleteJoint(j); dropped++; }
  const face = { blinkAt: 1.5, blink: 0, open: 0, smile: 0.5, clock: 0 };
  const last = { t: null, playing: null };
  const beat = bpm > 0 ? 60 / bpm : 0;

  function update(dt, { songTime = null, playing = false, singing = 0 } = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    face.clock += dt;
    /* springs: reset on a jump in time or a change of play state, before the update that would swing them */
    const jumped = songTime != null && last.t != null && Math.abs(songTime - last.t - (last.playing ? dt : 0)) > jumpSeconds;
    if (jumped || (last.playing != null && playing !== last.playing)) { vrm.update(0); sb?.reset(); }
    last.t = songTime; last.playing = playing;
    /* blinks */
    if (face.clock > face.blinkAt + 0.2) face.blinkAt = face.clock + 2 + Math.random() * 3.5 - (Math.random() < 0.18 ? 1.75 + Math.random() * 3.3 : 0);
    const b = face.clock - face.blinkAt;
    face.blink = b < 0 ? 0 : b < 0.06 ? b / 0.06 : Math.max(0, 1 - (b - 0.06) / 0.12);
    /* mouth and smile */
    const s = Math.min(1, Math.max(0, +singing || 0));
    let open = 0, smile = 0.55;
    if (playing && s > 0) {
      const half = beat && songTime != null ? ((songTime - downbeat) / beat) * 2 : face.clock * 4;
      const syll = Math.pow(Math.abs(Math.sin(half * Math.PI)), 0.7) * (0.6 + 0.4 * Math.abs(Math.sin(half * 0.37 + 1.3)));
      open = s * (0.2 + 0.8 * syll); smile = 0.75 - 0.35 * s;
    }
    face.open += (open - face.open) * (1 - Math.exp(-28 * dt));
    face.smile += (smile - face.smile) * (1 - Math.exp(-6 * dt));
    const ex = vrm.expressionManager;
    if (ex) {
      ex.setValue("blink", face.blink);
      ex.setValue("aa", Math.min(1, face.open * 0.85));
      ex.setValue("relaxed", Math.max(0, face.smile - 0.4) * 0.6 * (1 - face.open));
    }
    vrm.update(dt);
  }
  return { update, face, droppedSprings: dropped };
}
