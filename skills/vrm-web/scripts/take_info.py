#!/usr/bin/env python3
"""Check and describe .take files (from fbx_to_take.py): header, length, bones, and that the data adds up.

    python3 take_info.py <file.take> [...]

Exits 1 if any file is malformed. Standard library only.
"""
import json, struct, sys, os

VRM_BONES = {
    "hips", "spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye", "jaw",
    *[f"{s}{b}" for s in ("left", "right") for b in (
        "Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "Toes",
        "ThumbMetacarpal", "ThumbProximal", "ThumbDistal",
        *[f"{f}{p}" for f in ("Index", "Middle", "Ring", "Little") for p in ("Proximal", "Intermediate", "Distal")])]}


def check(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        b = f.read()
    if size < 8:
        return "too short"
    n = struct.unpack("<I", b[:4])[0]
    if n % 4 or n > 1_000_000 or 4 + n > size:
        return f"bad header length {n}"
    try:
        h = json.loads(b[4:4 + n])
    except (ValueError, RecursionError):
        return "header is not JSON"
    if not isinstance(h, dict):
        return "header is not a JSON object"
    fps, frames, bones = h.get("fps"), h.get("frames"), h.get("bones")
    if not (isinstance(fps, int) and 1 <= fps <= 240 and isinstance(frames, int) and frames >= 2 and isinstance(bones, list) and bones):
        return f"bad header {str(h)[:200]}"
    if not all(isinstance(x, str) for x in bones):
        return "bone names must all be strings"
    if len(set(bones)) != len(bones):
        return "a bone is listed twice"
    unknown = [x for x in bones if x not in VRM_BONES]
    if unknown:
        return f"not VRM humanoid bone names: {unknown[:5]}"
    if "hips" not in bones:
        return "no hips track"
    want = 4 + n + frames * len(bones) * 16 + frames * 12
    if size != want:
        return f"size {size} != {want} expected from the header"
    extra = set(h) - {"fps", "frames", "bones"}
    note = f"; extra header keys {sorted(extra)} (served publicly: keep source names out)" if extra else ""
    print(f"{path}: {frames} frames at {fps} fps = {(frames - 1) / fps:.2f} s, {len(bones)} bones, {size // 1000} KB{note}")
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    bad = 0
    for p in sys.argv[1:]:
        err = check(p) if os.path.isfile(p) else "not found"
        if err:
            print(f"{p}: BAD {err}", file=sys.stderr); bad += 1
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
