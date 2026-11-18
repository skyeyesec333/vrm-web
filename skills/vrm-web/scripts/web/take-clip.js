/* A .take file (fbx_to_take.py) as a three.js AnimationClip for a VRM's normalised humanoid bones.

     const buf = await (await fetch("/motion/move-a.take")).arrayBuffer();
     const clip = takeClip(buf, vrm, "move-a");
     const action = new THREE.AnimationMixer(vrm.scene).clipAction(clip);

   Rotations are already worked out for normalised bones (unrotated at rest), so nothing about the model is needed
   but its hips height: the hips' travel is stored in hip heights and scaled to this figure here.
   The file is checked before it is read: a wrong or truncated file throws instead of producing a broken clip.
   VRM 0.x models: three-vrm's normalised bones on a 0.x model face the other way (-z), so the rotations' x and z
   and the hips' x and z travel are negated, as three-vrm's own Mixamo example does (metaVersion "0"). */
import * as THREE from "three";

export function readTake(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) throw new Error("take: not a take file");
  const n = new DataView(buffer).getUint32(0, true);
  if (n % 4 || n > 1_000_000 || 4 + n > buffer.byteLength) throw new Error("take: bad header length");
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, n)));
  if (!head || typeof head !== "object" || Array.isArray(head)) throw new Error("take: header is not an object");
  const { fps, frames: F, bones } = head;
  if (!Number.isInteger(fps) || fps < 1 || fps > 240 || !Number.isInteger(F) || F < 2 || !Array.isArray(bones) || !bones.length
      || !bones.every((b) => typeof b === "string"))
    throw new Error("take: bad header");
  const B = bones.length, want = 4 + n + F * B * 16 + F * 12;
  if (buffer.byteLength !== want) throw new Error(`take: ${buffer.byteLength} bytes, header says ${want}`);
  return { fps, frames: F, bones, q: new Float32Array(buffer, 4 + n, F * B * 4), t: new Float32Array(buffer, 4 + n + F * B * 16, F * 3) };
}

export function takeClip(buffer, vrm, name = "take") {
  const { fps, frames: F, bones, q, t } = readTake(buffer);
  const v0 = vrm.meta?.metaVersion === "0", sx = v0 ? -1 : 1;         /* VRM 0.x: negate x and z (see above) */
  const B = bones.length, times = Float32Array.from({ length: F }, (_, i) => i / fps), tracks = [];
  bones.forEach((bone, k) => {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    if (!node) return;                                   /* a bone this model lacks (e.g. upperChest): skipped */
    const v = new Float32Array(F * 4);
    for (let i = 0; i < F; i++) {
      const o = (i * B + k) * 4;
      v[i * 4] = sx * q[o]; v[i * 4 + 1] = q[o + 1]; v[i * 4 + 2] = sx * q[o + 2]; v[i * 4 + 3] = q[o + 3];
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, v));
  });
  const hips = vrm.humanoid.getNormalizedBoneNode("hips");
  if (hips) {
    const h = hips.position.y, p = new Float32Array(F * 3);
    for (let i = 0; i < F; i++) {
      p[i * 3] = hips.position.x + sx * t[i * 3] * h;
      p[i * 3 + 1] = hips.position.y + t[i * 3 + 1] * h;
      p[i * 3 + 2] = hips.position.z + sx * t[i * 3 + 2] * h;
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, p));
  }
  return new THREE.AnimationClip(name, (F - 1) / fps, tracks);
}
