/* A dance locked to a song: the pose comes from the song's playback time alone.

     const dance = createSongDance(vrm.scene, {
       bpm: 120, downbeat: 0.48,                     // the first downbeat, in seconds (measure it from the track)
       clips: { a: clipA, b: clipB, out: clipOut },  // AnimationClips (take-clip.js / mixamo-retarget.js)
       choreo: [                                     // [bar it starts on, clip, options]; bars count from the downbeat
         [4, "a", { bars: 8 }],                      // played over exactly 8 bars (a few percent of stretch)
         [12, "b", { bars: 8 }],
         [20, "out", { bars: 4, from: 1.2 }],        // from: start this far into the clip (set by hand)
       ],
     });
     // every frame, with the audio element's time (never frame time):
     dance.update(audio.currentTime, !audio.paused);

   Why the song is the clock: frame time drifts from the audio through pauses, seeks, slow frames and tab switches.
   Taking the pose from the playback time keeps every move on its beat whatever happens.

   Hand-offs: each new clip starts at the moment in its first seconds whose pose is nearest the one being left (the
   big bones, hips weighted most), unless `from` is given. Blends straddle the bar line (0.45 s before, 0.75 after:
   1.2 s in all, long enough to read as a move rather than a cut). An outgoing clip holds its last frame while it
   blends out; wrapping to its first frame there would mix three poses at every change.

   Not playing: every weight eases to 0 and the mixer lets go, so the figure is back in whatever pose you give it
   (a stance, an idle). The mixer remembers the pose each bone had when an action first played: load the clips while
   the figure is at rest, or it blends back to a pose that is not rest. */
import * as THREE from "three";

const FADE_BEFORE = 0.45, FADE_AFTER = 0.75;
const BIG = [["hips", 3], ["spine", 1], ["chest", 1], ["UpperArm", 1.5], ["LowerArm", 1], ["UpperLeg", 1.5], ["LowerLeg", 1]];

export function createSongDance(root, { bpm, downbeat = 0, clips, choreo, search = 3.5 } = {}) {
  if (!(bpm > 20 && bpm < 400)) throw new Error("song-dance: bpm must be between 20 and 400");
  if (!Number.isFinite(downbeat) || downbeat < 0) throw new Error("song-dance: downbeat must be a time in seconds");
  const BAR = (60 / bpm) * 4, barTime = (bar) => downbeat + bar * BAR;
  const mixer = new THREE.AnimationMixer(root);
  const moves = new Map();
  for (const [name, clip] of Object.entries(clips || {})) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity); action.setEffectiveWeight(0); action.play();
    moves.set(name, { action, clip, duration: clip.duration });
  }
  const runs = [];
  for (const [bar, name, opt = {}] of choreo || []) {
    const m = moves.get(name);
    if (!m) throw new Error(`song-dance: no clip named "${name}"`);
    if (!(Number.isFinite(bar) && bar >= 0)) throw new Error(`song-dance: bad bar ${bar}`);
    runs.push({ at: barTime(bar), bar, name, opt, from: opt.from ?? 0, rate: 1, loop: m.duration });
  }
  runs.sort((a, b) => a.at - b.at);

  /* pose sampling, for the hand-offs */
  const poseAt = (m, time) => {
    const out = [];
    for (const tr of m.clip.tracks) {
      if (!tr.name.endsWith(".quaternion")) continue;
      const big = BIG.find(([k]) => tr.name.includes(k) && !/Thumb|Index|Middle|Ring|Little|Hand|Foot|Toe|Shoulder/.test(tr.name));
      if (!big) continue;
      const T = tr.times, n = T.length; let i = 1; while (i < n - 1 && T[i] < time) i++;
      const a = new THREE.Quaternion().fromArray(tr.values, (i - 1) * 4), b = new THREE.Quaternion().fromArray(tr.values, i * 4);
      out.push([tr.name, a.slerp(b, THREE.MathUtils.clamp((time - T[i - 1]) / (T[i] - T[i - 1] || 1), 0, 1)), big[1]]);
    }
    return out;
  };
  const apart = (A, B) => {
    const m = new Map(B.map(([n, q]) => [n, q])); let d = 0, w = 0;
    for (const [n, q, k] of A) { const o = m.get(n); if (!o) continue; d += k * 2 * Math.acos(Math.min(1, Math.abs(q.dot(o)))); w += k; }
    return w ? (d / w) * 57.2958 : 0;
  };
  const handoffs = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i], next = runs[i + 1], m = moves.get(r.name), span = next ? next.at - r.at : null;
    if (i > 0 && r.opt.from == null) {
      const p = runs[i - 1], mp = moves.get(p.name);
      const leaving = poseAt(mp, Math.min(p.from + p.loop - 1e-3, mp.duration - 1e-3));
      const room = Math.min(m.duration * 0.25, search);
      let best = [apart(leaving, poseAt(m, 0)), 0]; const first = best[0];
      for (let o = 0.1; o <= room; o += 0.1) { const d = apart(leaving, poseAt(m, o)); if (d < best[0] - 0.5) best = [d, o]; }
      r.from = best[1];
      handoffs.push(`bar ${r.bar} ${p.name} > ${r.name}: ${first.toFixed(0)} deg apart at its start, ${best[0].toFixed(0)} from ${best[1].toFixed(1)} s in`);
    }
    r.loop = Math.max(1e-3, m.duration - r.from);
    /* bars: play what is left of the clip over exactly that many bars */
    if (r.opt.bars > 0) r.rate = r.loop / (r.opt.bars * BAR);
    else if (span) r.rate = 1;
    r.span = span;
  }

  const state = { dance: 0, run: -1, weights: {}, handoffs };
  const place = (r, t) => {
    const tau = t - r.at;
    if (tau < 0) return Math.max(0, r.from + tau * r.rate);             /* blending in before its bar line */
    const u = tau * r.rate;
    const inside = r.span != null && tau < r.span - 1e-3;
    return r.from + (inside ? u % r.loop : Math.min(u, r.loop - 1e-3));  /* past its section: hold the last frame */
  };
  function update(t, playing, dt = 1 / 60) {
    if (!Number.isFinite(t)) return;
    const on = playing && runs.length && t >= runs[0].at - FADE_BEFORE;
    state.dance += ((on ? 1 : 0) - state.dance) * (1 - Math.exp(-(on ? 5 : 3) * Math.min(dt, 0.1)));
    if (state.dance < 1e-3) state.dance = 0;
    let i = 0;
    const fb = (r) => r.opt.fade?.[0] ?? FADE_BEFORE, fa = (r) => r.opt.fade?.[1] ?? FADE_AFTER;
    while (i + 1 < runs.length && t >= runs[i + 1].at - fb(runs[i + 1])) i++;
    const cur = runs[i], prev = runs[i - 1];
    const wIn = prev ? THREE.MathUtils.smoothstep(t, cur.at - fb(cur), cur.at + fa(cur)) : 1;
    for (const [name, m] of moves) {
      let w = 0, r = null;
      if (cur && name === cur.name) { w = wIn; r = cur; }
      else if (prev && name === prev.name) { w = 1 - wIn; r = prev; }
      m.action.setEffectiveWeight(w * state.dance);
      state.weights[name] = w * state.dance;
      if (w > 0 && r) m.action.time = Math.min(place(r, t), m.duration - 1e-3);
    }
    mixer.update(0);   /* time is set directly above: the mixer only applies it */
    state.run = i;
  }
  return { update, state, mixer, barTime };
}
