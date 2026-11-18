/* Load a gzipped VRM (.vrmz from vrm_pack.py) and inflate it in the browser.
   Hosts such as Cloudflare Pages compress by content type, and a model file (application/octet-stream) is not on
   the list, so it is gzipped once at build time instead. DecompressionStream is in every current browser; older
   ones are sent the plain .vrm beside it.

     import { PackedVRMLoader } from "./vrmz-loader.js";
     const loader = new PackedVRMLoader();
     loader.register((parser) => new VRMLoaderPlugin(parser));          // from @pixiv/three-vrm
     const gltf = await loader.loadAsync("/models/character.vrmz");
     const vrm = gltf.userData.vrm;

   If the server (or a dev server) already sends the file with Content-Encoding: gzip, the browser has inflated it
   and the bytes start with "glTF": they are used as they are. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CAN_INFLATE = typeof DecompressionStream !== "undefined";
const isGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
const isGlb = (u8) => u8.length > 4 && u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46;   /* "glTF" */

export class PackedVRMLoader extends THREE.Loader {
  constructor(manager, { timeoutMs = 60000 } = {}) {
    super(manager);
    this.gltf = new GLTFLoader(manager);
    this.timeoutMs = timeoutMs;
  }
  register(fn) { this.gltf.register(fn); return this; }
  load(url, onLoad, onProgress, onError) {
    const plain = url.replace(/\.vrmz$/, ".vrm");
    if (!CAN_INFLATE) return this.gltf.load(plain, onLoad, onProgress, onError);
    const m = this.manager;
    m.itemStart(url);
    const fail = (e) => { m.itemError(url); m.itemEnd(url); onError ? onError(e) : console.error(e); };
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined;
    fetch(this.manager.resolveURL(url), { signal })
      .then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(async (buf) => {
        const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        if (isGlb(head)) return buf;                                    /* already inflated by the browser */
        if (!isGzip(head)) throw new Error(`${url}: neither gzip nor glTF`);
        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      })
      .then((buf) => this.gltf.parse(buf, "", (g) => { onLoad(g); m.itemEnd(url); }, fail))
      .catch(fail);
  }
}
