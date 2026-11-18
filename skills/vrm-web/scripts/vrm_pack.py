#!/usr/bin/env python3
"""Pack a VRM (VRoid Studio export, VRM 1.0 or 0.x) for the web, and write a gzipped .vrmz beside it.

    python3 vrm_pack.py <in.vrm> <out.vrm> [options]

What it does, by default:
  - face shapes (morph targets): keeps only the ones an expression binds (blink, visemes, moods); drops every
    shape's normals (a cel or flat-lit face does not read them). This is often the biggest saving.
  - normal maps: replaced by flat 8 px maps (--keep-normal-maps to keep them; keep them if your shader is lit
    with normal maps, e.g. MToon with a normal texture or a standard PBR material).
  - the thumbnail image: dropped (1 px stand-in).
  - colour maps: re-saved as WebP when smaller, alpha kept exactly (exact=True keeps the colour under clear pixels,
    which cut-out edges and mip-maps sample).
  - the file's "asset.generator" / "copyright" (exporter and tool names): removed. The VRM meta block (author,
    licence, permissions) is kept as written; --meta-* options change it.
  - unused accessors and buffer views: dropped.
  - <out>.vrmz: the same bytes, gzipped (level 9, mtime 0, no file name: reproducible). Hosts such as Cloudflare
    compress by content type and leave model files (application/octet-stream) uncompressed.
Geometry, skin weights, bones, spring bones, colliders, materials and expressions are not touched.

Options:
  --keep-normal-maps        keep real normal maps
  --keep-thumbnail          keep the thumbnail image
  --webp-quality N          1-100, default 90
  --no-gzip                 do not write <out>z
  --meta-restrict           VRM 1.0 meta: only the author may use the avatar, no redistribution, no modification,
                            no commercial use by others (for an original character you do not license out)
  --meta-authors "A;B"      VRM 1.0 meta: replace the authors list (';'-separated)
  --dry-run                 report only, write nothing

Needs Python 3.8+ and Pillow with WebP (python3 -c "from PIL import features; print(features.check('webp'))").
"""
import argparse, gzip, io, json, os, struct, sys

try:
    from PIL import Image, features
except ImportError:
    sys.exit("vrm_pack: needs Pillow (pip install pillow)")

MAX_JSON = 64 * 1024 * 1024


def die(msg):
    sys.exit(f"vrm_pack: {msg}")


def read_glb(path):
    with open(path, "rb") as f:
        b = f.read()
    if len(b) < 28 or b[:4] != b"glTF":
        die(f"{path} is not a binary glTF/VRM file")
    version, total = struct.unpack("<II", b[4:12])
    if version != 2 or total != len(b):
        die(f"{path}: unexpected glTF version or length ({version}, {total} vs {len(b)})")
    n, kind = struct.unpack("<I4s", b[12:20])
    if kind != b"JSON" or n > MAX_JSON or 20 + n > len(b):
        die(f"{path}: bad JSON chunk")
    j = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    bin_ = b""
    if len(rest) >= 8:
        m, kind2 = struct.unpack("<I4s", rest[:8])
        if kind2 != b"BIN\0" or 8 + m > len(rest):
            die(f"{path}: bad BIN chunk")
        bin_ = rest[8:8 + m]
    return b, j, bin_


def write_glb(path, j, blob):
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    with open(path, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<I", len(js)) + b"JSON" + js)
        f.write(struct.pack("<I", len(blob)) + b"BIN\0" + bytes(blob))


def main():
    ap = argparse.ArgumentParser(description="Pack a VRM for the web (see the module docstring).")
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--keep-normal-maps", action="store_true")
    ap.add_argument("--keep-thumbnail", action="store_true")
    ap.add_argument("--webp-quality", type=int, default=90)
    ap.add_argument("--no-gzip", action="store_true")
    ap.add_argument("--meta-restrict", action="store_true")
    ap.add_argument("--meta-authors")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not 1 <= a.webp_quality <= 100:
        die("--webp-quality must be 1-100")
    if not features.check("webp"):
        die("this Pillow has no WebP support")
    if not os.path.isfile(a.src):
        die(f"not found: {a.src}")
    if os.path.exists(a.out) and os.path.samefile(a.src, a.out):
        die("the output would overwrite the input")
    if not a.out.lower().endswith(".vrm") and not a.no_gzip:
        die("name the output *.vrm (the gzipped copy is written as <out>z), or pass --no-gzip")

    raw, j, BIN = read_glb(a.src)
    bvs, accs = j.get("bufferViews", []), j.get("accessors", [])

    def view(i):
        o = bvs[i].get("byteOffset", 0)
        return BIN[o:o + bvs[i]["byteLength"]]

    ext = j.get("extensions", {})
    v1 = ext.get("VRMC_vrm")
    v0 = ext.get("VRM")
    if not v1 and not v0:
        die("no VRMC_vrm or VRM extension: is this a VRM?")
    print(f"[pack] {'VRM 1.0' if v1 else 'VRM 0.x'}, {len(raw) / 1e6:.2f} MB")

    # ---- what the file says about its tools: not for visitors
    asset = j.get("asset", {})
    gone = [k for k in ("generator", "copyright") if k in asset]
    j["asset"] = {"version": asset.get("version", "2.0")}
    if gone:
        print(f"[pack] removed asset.{', asset.'.join(gone)}")

    # ---- meta
    if v1:
        meta = v1.setdefault("meta", {})
        if a.meta_authors is not None:
            authors = [s.strip() for s in a.meta_authors.split(";") if s.strip()]
            if not authors:
                die("--meta-authors needs at least one name")
            meta["authors"] = authors
        if a.meta_restrict:
            meta.update({"avatarPermission": "onlyAuthor", "commercialUsage": "personalNonProfit",
                         "allowRedistribution": False, "modification": "prohibited",
                         "allowExcessivelyViolentUsage": False, "allowExcessivelySexualUsage": False,
                         "allowPoliticalOrReligiousUsage": False, "allowAntisocialOrHateUsage": False,
                         "creditNotation": "required"})
        print(f"[pack] meta: name={meta.get('name')!r}, authors={meta.get('authors')}, "
              f"avatarPermission={meta.get('avatarPermission')}, redistribution={meta.get('allowRedistribution')}, "
              f"modification={meta.get('modification')}")
    elif a.meta_restrict or a.meta_authors is not None:
        die("--meta-* options support VRM 1.0 only (export from VRoid Studio as VRM 1.0)")

    # ---- images
    images = j.get("images", [])
    textures = j.get("textures", [])
    tex_src = lambda t: textures[t["index"]].get("source")
    normal_imgs = {tex_src(m["normalTexture"]) for m in j.get("materials", []) if "normalTexture" in m}
    thumb = None
    if v1:
        thumb = v1.get("meta", {}).get("thumbnailImage")
        if thumb is not None and not a.keep_thumbnail:
            v1["meta"].pop("thumbnailImage")
    elif v0:
        t = v0.get("meta", {}).get("texture")
        thumb = textures[t].get("source") if isinstance(t, int) and 0 <= t < len(textures) else None
    new_data = {}

    def png(im):
        f = io.BytesIO(); im.save(f, "PNG", optimize=True); return f.getvalue()

    def webp(im):
        f = io.BytesIO(); im.save(f, "WEBP", quality=a.webp_quality, method=6, exact=True, alpha_quality=100)
        return f.getvalue()

    before = after = 0
    for i, im in enumerate(images):
        if "bufferView" not in im:
            continue
        data0 = view(im["bufferView"]); before += len(data0)
        note = ""
        if i == thumb and not a.keep_thumbnail:
            data, mime, note = png(Image.new("RGB", (1, 1))), "image/png", "thumbnail dropped"
        elif i in normal_imgs and not a.keep_normal_maps:
            data, mime, note = png(Image.new("RGB", (8, 8), (128, 128, 255))), "image/png", "normal map -> flat"
        else:
            img = Image.open(io.BytesIO(data0)); img.load()
            w = webp(img if img.mode in ("RGB", "RGBA") else img.convert("RGBA"))
            if len(w) < len(data0):
                data, mime, note = w, "image/webp", "webp"
            else:
                data, mime = data0, im.get("mimeType", "image/png")
        new_data[im["bufferView"]] = data; im["mimeType"] = mime; after += len(data)
        if note or len(data0) > 100_000:
            print(f"[pack] image {i:2} {str(im.get('name', ''))[:28]:28} {len(data0) // 1024:6} KB -> {len(data) // 1024:5} KB  {note}")
    # three.js GLTFLoader decodes a WebP image from its mimeType; current browsers need no glTF extension for it.
    print(f"[pack] images {before / 1e6:.2f} MB -> {after / 1e6:.2f} MB")

    # ---- face shapes: keep those an expression binds; drop their normals and tangents
    if v1:
        ex = v1.get("expressions", {})
        binds = [(bd["node"], bd["index"]) for e in list(ex.get("preset", {}).values()) + list(ex.get("custom", {}).values())
                 for bd in e.get("morphTargetBinds", [])]
        bind_refs = [bd for e in list(ex.get("preset", {}).values()) + list(ex.get("custom", {}).values())
                     for bd in e.get("morphTargetBinds", [])]
        mesh_of = lambda node: j["nodes"][node].get("mesh")
    else:
        groups = v0.get("blendShapeMaster", {}).get("blendShapeGroups", [])
        bind_refs = [bd for g in groups for bd in g.get("binds", [])]
        binds = [(bd["mesh"], bd["index"]) for bd in bind_refs]
        mesh_of = lambda m: m
    for mi, m in enumerate(j.get("meshes", [])):
        prims = m.get("primitives", [])
        if not prims or not prims[0].get("targets"):
            continue
        keep = sorted({idx for ref, idx in binds if mesh_of(ref) == mi})
        remap = {old: new for new, old in enumerate(keep)}
        total = len(prims[0]["targets"])
        for p in prims:
            p["targets"] = [{"POSITION": p["targets"][k]["POSITION"]} for k in keep if "POSITION" in p["targets"][k]]
            if len(p["targets"]) != len(keep):
                die(f"mesh {mi}: a kept face shape has no POSITION")
            if "targetNames" in p.get("extras", {}):
                p["extras"]["targetNames"] = [p["extras"]["targetNames"][k] for k in keep]
        if "targetNames" in m.get("extras", {}):
            m["extras"]["targetNames"] = [m["extras"]["targetNames"][k] for k in keep]
        if m.get("weights"):
            m["weights"] = [m["weights"][k] for k in keep]
        for bd in bind_refs:
            ref = bd["node"] if v1 else bd["mesh"]
            if mesh_of(ref) == mi:
                bd["index"] = remap[bd["index"]]
        print(f"[pack] mesh {mi} {str(m.get('name', ''))[:24]}: {total} face shapes -> {len(keep)}, normals dropped")

    # ---- keep only the accessors and buffer views still referenced
    used_acc = set()
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            used_acc.update(p["attributes"].values())
            if "indices" in p: used_acc.add(p["indices"])
            for t in p.get("targets", []): used_acc.update(t.values())
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: used_acc.add(s["inverseBindMatrices"])
    for an in j.get("animations", []):
        for s in an["samplers"]: used_acc.update((s["input"], s["output"]))
    for acc in [accs[i] for i in used_acc]:
        if "sparse" in acc:
            die("sparse accessors are not handled; export without sparse morph targets")
    amap = {old: new for new, old in enumerate(sorted(used_acc))}
    used_bv = {accs[x]["bufferView"] for x in used_acc if "bufferView" in accs[x]} | \
              {im["bufferView"] for im in images if "bufferView" in im}
    bmap = {old: new for new, old in enumerate(sorted(used_bv))}
    blob = bytearray(); views = []
    for old in sorted(used_bv):
        data = new_data.get(old, view(old))
        while len(blob) % 4: blob.append(0)
        v = {k: val for k, val in bvs[old].items() if k not in ("byteOffset", "byteLength", "buffer")}
        v.update(buffer=0, byteOffset=len(blob), byteLength=len(data)); views.append(v); blob += data
    while len(blob) % 4: blob.append(0)
    j["bufferViews"] = views
    j["accessors"] = [dict(accs[old], **({"bufferView": bmap[accs[old]["bufferView"]]} if "bufferView" in accs[old] else {}))
                      for old in sorted(used_acc)]
    for im in images:
        if "bufferView" in im: im["bufferView"] = bmap[im["bufferView"]]
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            p["attributes"] = {k: amap[x] for k, x in p["attributes"].items()}
            if "indices" in p: p["indices"] = amap[p["indices"]]
            if p.get("targets"): p["targets"] = [{k: amap[x] for k, x in t.items()} for t in p["targets"]]
    for s in j.get("skins", []):
        if "inverseBindMatrices" in s: s["inverseBindMatrices"] = amap[s["inverseBindMatrices"]]
    for an in j.get("animations", []):
        for s in an["samplers"]: s["input"], s["output"] = amap[s["input"]], amap[s["output"]]
    j["buffers"] = [{"byteLength": len(blob)}]

    size = 28 + len(json.dumps(j, separators=(",", ":"))) + len(blob)
    print(f"[pack] {len(raw) / 1e6:.2f} MB -> about {size / 1e6:.2f} MB")
    if a.dry_run:
        print("[pack] dry run: nothing written"); return
    write_glb(a.out, j, blob)
    print(f"[pack] wrote {a.out} ({os.path.getsize(a.out) / 1e6:.2f} MB)")
    if not a.no_gzip:
        with open(a.out, "rb") as f:
            packed = f.read()
        with open(a.out + "z", "wb") as f:
            with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0, filename="") as g:
                g.write(packed)
        print(f"[pack] wrote {a.out}z ({os.path.getsize(a.out + 'z') / 1e6:.2f} MB gzipped)")


if __name__ == "__main__":
    main()
