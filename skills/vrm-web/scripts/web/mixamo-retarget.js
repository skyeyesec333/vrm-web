/* Retarget glTF clips on a Mixamo-named skeleton (Mixamo downloads, many mocap and AI-motion exports) onto a VRM's
   normalised humanoid, in the browser. For FBX mocap, converting offline with fbx_to_take.py is lighter.

     const retarget = makeRetargeter(vrm);          // call right after loading, while the VRM is still at rest
     const clips = retarget(await new GLTFLoader().loadAsync("/motion/dance.glb"));

   Per bone and key: the rotation is a turn away from the source's own rest in its parent's rested frame, then
   corrected for the two rests differing: C swings the VRM's rest limb onto the source's rest limb, so
     local' = C_parent^-1 * (W_parent_rest * q * W_rest^-1) * C.
   Only limbs get C (arms rest 45 degrees down in many rigs against straight out on a VRM). The spine, neck and head
   take none: their joints sit at different heights in the two rigs, and "correcting" for that pitches the chest
   forward and the neck back at every frame. Fingers and toes take their limb parent's correction.
   The hips' travel is scaled by the ratio of hip heights. */
import * as THREE from "three";

export const MIXAMO_TO_VRM = {
  Hips: "hips", Spine: "spine", Spine1: "chest", Spine2: "upperChest", Neck: "neck", Head: "head",
  LeftShoulder: "leftShoulder", LeftArm: "leftUpperArm", LeftForeArm: "leftLowerArm", LeftHand: "leftHand",
  RightShoulder: "rightShoulder", RightArm: "rightUpperArm", RightForeArm: "rightLowerArm", RightHand: "rightHand",
  LeftUpLeg: "leftUpperLeg", LeftLeg: "leftLowerLeg", LeftFoot: "leftFoot", LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg", RightLeg: "rightLowerLeg", RightFoot: "rightFoot", RightToeBase: "rightToes",
};
for (const side of ["Left", "Right"]) {
  const s = side.toLowerCase();
  for (const [m, v] of [["Thumb", "Thumb"], ["Index", "Index"], ["Middle", "Middle"], ["Ring", "Ring"], ["Pinky", "Little"]]) {
    const parts = m === "Thumb" ? ["Metacarpal", "Proximal", "Distal"] : ["Proximal", "Intermediate", "Distal"];
    parts.forEach((p, i) => { MIXAMO_TO_VRM[`${side}Hand${m}${i + 1}`] = `${s}${v}${p}`; });
  }
}
/* the limb each bone points along, toward this child */
const CHILD = {};
for (const s of ["Left", "Right"]) Object.assign(CHILD, {
  [`${s}Shoulder`]: `${s}Arm`, [`${s}Arm`]: `${s}ForeArm`, [`${s}ForeArm`]: `${s}Hand`, [`${s}Hand`]: `${s}HandMiddle1`,
  [`${s}UpLeg`]: `${s}Leg`, [`${s}Leg`]: `${s}Foot`, [`${s}Foot`]: `${s}ToeBase`,
});
const short = (n) => n.replace(/^mixamorig\d*:?/, "");

/* Measures the VRM's rest (limb directions, hips height). Call it before anything poses the model: measured with a
   stance or an animation already applied, every correction is off by however far that pose moved the limb. */
export function makeRetargeter(vrm) {
  const tgt = (m) => vrm.humanoid.getNormalizedBoneNode(MIXAMO_TO_VRM[m]);
  vrm.scene.updateWorldMatrix(true, true);
  const inv = vrm.scene.matrixWorld.clone().invert();
  const local = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const restDir = new Map();
  for (const [m, c] of Object.entries(CHILD)) {
    const a = tgt(m), b = tgt(c);
    if (a && b) restDir.set(m, local(b).sub(local(a)).normalize());
  }
  const hips = tgt("Hips");
  if (!hips) throw new Error("retarget: the VRM has no hips bone");
  const hipsY = local(hips).y;
  return (gltf) => retargetClips(gltf, vrm, restDir, hipsY);
}

function retargetClips(gltf, vrm, restDir, hipsY) {
  const src = gltf.scene; src.updateWorldMatrix(true, true);
  const node = new Map(); src.traverse((o) => node.set(short(o.name), o));
  const hipsS = node.get("Hips");
  if (!hipsS) throw new Error("retarget: the clip's skeleton has no Hips bone (is it Mixamo-named?)");
  const tgt = (m) => vrm.humanoid.getNormalizedBoneNode(MIXAMO_TO_VRM[m]);
  const P = (o) => o.getWorldPosition(new THREE.Vector3());
  const C = new Map(), id = new THREE.Quaternion();
  for (const m of Object.keys(MIXAMO_TO_VRM)) {
    const c = CHILD[m], a = node.get(m), b = c && node.get(c), dt = restDir.get(m);
    if (a && b && dt) C.set(m, new THREE.Quaternion().setFromUnitVectors(dt, P(b).sub(P(a)).normalize()));
  }
  for (const m of Object.keys(MIXAMO_TO_VRM)) {
    if (C.has(m)) continue;
    let o = node.get(m), c = null;
    while (o && o.parent && !c) { o = o.parent; c = C.get(short(o.name)); }
    C.set(m, c || id);
  }
  const srcHipsY = P(hipsS).y;
  const k = srcHipsY > 1e-6 ? hipsY / srcHipsY : 1;
  const q = new THREE.Quaternion(), rest = new THREE.Quaternion(), prest = new THREE.Quaternion(), cp = new THREE.Quaternion();
  return gltf.animations.map((clip) => {
    const tracks = [];
    for (const t of clip.tracks) {
      const [raw, prop] = t.name.split(/\.(?=[^.]+$)/), m = short(raw), s = node.get(m), o = MIXAMO_TO_VRM[m] && tgt(m);
      if (!s || !o) continue;
      if (prop === "quaternion") {
        s.getWorldQuaternion(rest).invert(); s.parent.getWorldQuaternion(prest);
        cp.copy(C.get(short(s.parent.name)) || id).invert();
        const c = C.get(m) || id, v = t.values.slice();
        for (let i = 0; i < v.length; i += 4) {
          q.fromArray(v, i).premultiply(prest).multiply(rest).premultiply(cp).multiply(c).normalize();
          if (i && v[i - 4] * q.x + v[i - 3] * q.y + v[i - 2] * q.z + v[i - 1] * q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
          q.toArray(v, i);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, t.times, v));
      } else if (prop === "position" && m === "Hips") {
        const pw = s.parent.matrixWorld, p = new THREE.Vector3(), v = t.values.slice();
        for (let i = 0; i < v.length; i += 3) p.fromArray(v, i).applyMatrix4(pw).multiplyScalar(k).toArray(v, i);
        tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`, t.times, v));
      }
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}
