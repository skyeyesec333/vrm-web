/* A cel (toon) look for a VRM that carries its own key light.

   Why not MToon as it comes: MToon is lit by the scene's lights. A scene built for atmosphere (many lamps, bloom, a
   high exposure) burns its flat colours out and breaks its hard bands into speckles. This shader ignores the scene's
   lights: one key direction it owns (fixed in the world), three hard bands, a cool rim, and a gain to keep it under
   the bloom threshold. Skinning, morph targets (the face) and cut-out alpha work as on any three.js material.

     import { applyCel, updateCel, CEL_DEFAULTS } from "./cel-material.js";
     const cel = applyCel(vrm.scene, { gain: 0.8 });    // once; replaces each mesh's material, keeps its colour map
     // every frame:
     updateCel(cel, camera);

   Tune: cel.uniforms.uKeyWorld (direction), uLight / uMid / uShade (band colours), uRim / uRimAmt, uGain.
   Outlines: VRoid models carry MToon outline settings, which this drops; add an inverted-hull pass (a back-face
   copy pushed out along the normal) if the look needs ink lines. */
import * as THREE from "three";

export const CEL_DEFAULTS = {
  key: new THREE.Vector3(0.35, 0.75, 0.55),
  light: new THREE.Color(1.0, 0.97, 0.93),
  mid: new THREE.Color(0.84, 0.86, 0.93),
  shade: new THREE.Color(0.62, 0.66, 0.8),     /* the shadow band: a cool, lighter shade, not black */
  rim: new THREE.Color(0.55, 0.75, 1.0),
  rimAmt: 0.35,
  gain: 1.0,
};

const vertexShader = /* glsl */ `
#include <common>
#include <uv_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <uv_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = normalize(transformedNormal);
  vV = -mvPosition.xyz;
}`;

const fragmentShader = /* glsl */ `
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
uniform vec3 uKey;      /* key direction in view space (updateCel keeps it fixed in the world) */
uniform vec3 uLight, uMid, uShade, uRim, uColor;
uniform float uRimAmt, uGain, uCutoff;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 diffuseColor = vec4(uColor, 1.0);
  #include <map_fragment>
  if (diffuseColor.a < uCutoff) discard;
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float d = dot(n, normalize(uKey));
  vec3 band = d > 0.35 ? uLight : (d > -0.05 ? uMid : uShade);
  float rim = pow(1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0), 3.0) * uRimAmt;
  vec3 col = diffuseColor.rgb * band * uGain + uRim * rim * uGain;
  gl_FragColor = vec4(col, diffuseColor.a);
  #include <colorspace_fragment>
}`;

export function applyCel(root, opts = {}) {
  const o = { ...CEL_DEFAULTS, ...opts };
  const shared = {
    uKey: { value: o.key.clone().normalize() },
    uLight: { value: o.light.clone() }, uMid: { value: o.mid.clone() }, uShade: { value: o.shade.clone() },
    uRim: { value: o.rim.clone() }, uRimAmt: { value: o.rimAmt }, uGain: { value: o.gain },
  };
  const keyWorld = o.key.clone().normalize();
  const made = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const next = list.map((src) => {
      const map = src.map || src.uniforms?.map?.value || null;
      const color = src.color || src.uniforms?.litFactor?.value || new THREE.Color(1, 1, 1);
      const cutoff = src.alphaTest || src.uniforms?.alphaTest?.value || 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...shared, map: { value: map }, mapTransform: { value: new THREE.Matrix3() }, uColor: { value: color.clone() }, uCutoff: { value: cutoff } },
        vertexShader, fragmentShader,
        transparent: !!src.transparent, side: src.side ?? THREE.FrontSide, depthWrite: src.depthWrite ?? true,
      });
      if (map) { mat.map = map; mat.uniforms.mapTransform.value.copy(map.matrix); }   /* defines USE_MAP / USE_UV */
      mat.name = `${src.name || "mat"} (cel)`;
      made.push(mat);
      return mat;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
  return { uniforms: shared, keyWorld, materials: made };
}

/* keep the key light fixed in the world as the camera moves */
export function updateCel(cel, camera) {
  cel.uniforms.uKey.value.copy(cel.keyWorld).transformDirection(camera.matrixWorldInverse);
}
