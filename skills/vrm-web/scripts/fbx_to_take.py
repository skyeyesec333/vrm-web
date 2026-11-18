"""Convert a mocap FBX (T-pose rest) into a compact .take file a VRM plays directly in three.js.

    blender -b --factory-startup --python fbx_to_take.py -- <in.fbx> <out.take> [--fps 30] [--start S] [--end S]

The take holds, per frame, a rotation for each of the VRM's normalised humanoid bones, plus the hips' travel.
Normalised VRM bones are unrotated at rest (arms straight out, legs straight down), so the file plays on any VRM
with no per-model work: take-clip.js turns it into a three.js AnimationClip in the browser.

Per frame and bone: the bone's turn away from its own rest, in world space (D), times a rest correction C that
swings the VRM's rest limb (arms exactly sideways, legs exactly down) onto the take's rest limb; the bone's local
rotation is then (Dp Cp)^-1 (D C) with p its mapped parent. The spine, neck and head take NO correction: their
joints sit at different heights in different rigs, and "correcting" for that pitches the chest and neck at every
frame. The hips also carry their travel, in units of the take's own hip height (so it scales to any figure).

Bone names: two common mocap schemes are recognised, "Upper_Arm_L / Index_Proximal_R" style and Mixamo style
("LeftArm / RightHandIndex1", with or without a "mixamorig:" prefix). Others: add a map below.

File format (little-endian): uint32 header length, JSON header {fps, frames, bones[]} padded to 4 bytes,
float32 quaternions [frame][bone][x y z w], then float32 hips travel [frame][x y z]; glTF axes (y up, +z forward).
The header holds no source file name: these files are served publicly.

--start: cut the take to begin at this second (default: half a second before the first real movement, found
automatically; it finds the first gesture, which is not always where the dance starts). --end: stop here.
"""
import bpy, sys, json, struct, math, os
import numpy as np
from mathutils import Quaternion, Vector


def die(msg):
    print(f"fbx_to_take: {msg}", file=sys.stderr)
    sys.exit(1)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2 or argv[0] in ("-h", "--help"):
    print(__doc__); sys.exit(0 if argv[:1] in (["-h"], ["--help"]) else 1)
SRC, OUT = argv[0], argv[1]
opts = {"--fps": "30", "--start": None, "--end": None}
rest_args = argv[2:]
while rest_args:
    k = rest_args.pop(0)
    if k not in opts or not rest_args:
        die(f"unknown option or missing value: {k}")
    opts[k] = rest_args.pop(0)
try:
    FPS = int(opts["--fps"])
    START = float(opts["--start"]) if opts["--start"] is not None else None
    END = float(opts["--end"]) if opts["--end"] is not None else None
except ValueError:
    die("--fps must be a whole number and --start/--end numbers of seconds")
if not 1 <= FPS <= 240: die("--fps must be 1-240")
if START is not None and START < 0: die("--start must be >= 0")
if END is not None and (END <= 0 or (START is not None and END <= START)): die("--end must be after --start")
if not os.path.isfile(SRC): die(f"not found: {SRC}")
if not OUT.endswith(".take"): die("name the output *.take")
if os.path.exists(OUT) and os.path.samefile(SRC, OUT): die("the output would overwrite the input")

# ---- bone maps: source name -> VRM humanoid bone
MAP_A = {"Hips": "hips", "Spine": "spine", "Spine1": "chest", "Chest": "upperChest", "Neck": "neck", "Head": "head"}
for S, s in (("L", "left"), ("R", "right")):
    MAP_A.update({f"Shoulder_{S}": f"{s}Shoulder", f"Upper_Arm_{S}": f"{s}UpperArm", f"Lower_Arm_{S}": f"{s}LowerArm",
                  f"Hand_{S}": f"{s}Hand", f"Upper_Leg_{S}": f"{s}UpperLeg", f"Lower_Leg_{S}": f"{s}LowerLeg",
                  f"Foot_{S}": f"{s}Foot", f"Toes_{S}": f"{s}Toes"})
    for f in ("Index", "Middle", "Ring", "Little"):
        for part in ("Proximal", "Intermediate", "Distal"):
            MAP_A[f"{f}_{part}_{S}"] = f"{s}{f}{part}"
    for x, y in (("Proximal", "Metacarpal"), ("Intermediate", "Proximal"), ("Distal", "Distal")):
        MAP_A[f"Thumb_{x}_{S}"] = f"{s}Thumb{y}"

MAP_B = {"Hips": "hips", "Spine": "spine", "Spine1": "chest", "Spine2": "upperChest", "Neck": "neck", "Head": "head"}
for S, s in (("Left", "left"), ("Right", "right")):
    MAP_B.update({f"{S}Shoulder": f"{s}Shoulder", f"{S}Arm": f"{s}UpperArm", f"{S}ForeArm": f"{s}LowerArm",
                  f"{S}Hand": f"{s}Hand", f"{S}UpLeg": f"{s}UpperLeg", f"{S}Leg": f"{s}LowerLeg",
                  f"{S}Foot": f"{s}Foot", f"{S}ToeBase": f"{s}Toes"})
    for f, v in (("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Little")):
        for i, part in enumerate(("Proximal", "Intermediate", "Distal")):
            MAP_B[f"{S}Hand{f}{i + 1}"] = f"{s}{v}{part}"
    for i, part in enumerate(("Metacarpal", "Proximal", "Distal")):
        MAP_B[f"{S}HandThumb{i + 1}"] = f"{s}Thumb{part}"

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.fbx(filepath=SRC, automatic_bone_orientation=False)
except RuntimeError as e:
    die(f"could not import {SRC}: {e}")
sc = bpy.context.scene
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is None or not arm.animation_data or not arm.animation_data.action:
    die("no animated armature in the FBX")
short = lambda n: n.split(":")[-1]
names = {short(b.name) for b in arm.data.bones}
MAP = MAP_B if "LeftArm" in names else MAP_A
need = ["Hips", "LeftArm", "RightArm", "LeftUpLeg", "RightUpLeg"] if MAP is MAP_B else ["Hips", "Upper_Arm_L", "Upper_Arm_R", "Upper_Leg_L", "Upper_Leg_R"]
missing = [n for n in need if n not in names]
if missing: die(f"bone names not recognised (missing {missing}); add the rig's names to a map in this script")
NAME = {b.name: MAP[short(b.name)] for b in arm.data.bones if short(b.name) in MAP}
SRCB = {v: k for k, v in NAME.items()}

act = arm.animation_data.action; f0, f1 = act.frame_range; src_fps = sc.render.fps / sc.render.fps_base
mw = arm.matrix_world
bones = [b for b in arm.data.bones if b.name in NAME]   # parents before children, as Blender lists them
rest = {b.name: (mw @ b.matrix_local).to_quaternion() for b in bones}
head = lambda vrm_name: mw @ arm.data.bones[SRCB[vrm_name]].head_local
# C: the VRM's rest limb direction (Blender axes: x the figure's left, z up) onto the take's rest limb
C = {}
for s_, sx in (("left", 1), ("right", -1)):
    for n, c in ((f"{s_}Shoulder", f"{s_}UpperArm"), (f"{s_}UpperArm", f"{s_}LowerArm"), (f"{s_}LowerArm", f"{s_}Hand"), (f"{s_}Hand", f"{s_}MiddleProximal")):
        if n in SRCB and c in SRCB:
            C[SRCB[n]] = Vector((sx, 0, 0)).rotation_difference((head(c) - head(n)).normalized())
    for n, c in ((f"{s_}UpperLeg", f"{s_}LowerLeg"), (f"{s_}LowerLeg", f"{s_}Foot")):
        if n in SRCB and c in SRCB:
            C[SRCB[n]] = Vector((0, 0, -1)).rotation_difference((head(c) - head(n)).normalized())
NO_CORRECTION = {"hips", "spine", "chest", "upperChest", "neck", "head"}


def corr(b):
    """a bone with no limb of its own to measure (fingers, toes) takes its nearest limb parent's correction"""
    while b is not None:
        if b.name in C: return C[b.name]
        if NAME.get(b.name) in NO_CORRECTION: return Quaternion()
        b = b.parent
    return Quaternion()


Cb = {b.name: corr(b) for b in bones}
for n in ("leftUpperArm", "leftUpperLeg"):
    if n in SRCB: print(f"[take] rest correction {n}: {math.degrees(Cb[SRCB[n]].angle):.1f} deg")


def mapped_parent(b):
    p = b.parent
    while p is not None and p.name not in NAME: p = p.parent
    return p


hip_rest = head("hips"); hip_h = hip_rest.z
if hip_h <= 1e-6: die("the hips rest at or below the ground: is the take's rest pose standing?")
N = int(round((f1 - f0) / src_fps * FPS)) + 1
if N < 2: die("the take has fewer than two frames")
Q = np.zeros((N, len(bones), 4), np.float32); T = np.zeros((N, 3), np.float32)
gl = lambda q: (q.x, q.z, -q.y, q.w)   # Blender world -> glTF, as x y z w
hips_pb = arm.pose.bones[SRCB["hips"]]
for i in range(N):
    fr = f0 + i * src_fps / FPS; sc.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
    W = {}
    for k, b in enumerate(bones):
        D = (mw @ arm.pose.bones[b.name].matrix).to_quaternion() @ rest[b.name].inverted()
        w = D @ Cb[b.name]; W[b.name] = w
        p = mapped_parent(b); q = (W[p.name].inverted() @ w) if p is not None else w
        Q[i, k] = gl(q)
        if i and float(np.dot(Q[i, k], Q[i - 1, k])) < 0: Q[i, k] = -Q[i, k]   # keep quaternions on one side: no flips in blends
    d = (mw @ hips_pb.head) - hip_rest
    T[i] = (d.x / hip_h, d.z / hip_h, -d.y / hip_h)

# where to cut in: half a second before the first real movement (one second in is the reference: frame 0 can be a T-pose)
big = [k for k, b in enumerate(bones) if NAME[b.name].endswith(("UpperArm", "UpperLeg", "LowerLeg")) or NAME[b.name] in ("spine", "chest")]
start = 0
if START is not None:
    start = min(N - 2, int(START * FPS))
elif N > 2 * FPS and big:
    ref = Q[FPS]
    moved = np.array([max(2 * math.acos(min(1.0, abs(float(np.dot(Q[i, k], ref[k]))))) for k in big) for i in range(N)])
    if (moved[FPS:] > 0.5).any():
        onset = FPS + int(np.argmax(moved[FPS:] > 0.5)); start = max(0, onset - FPS // 2)
        print(f"[take] first movement at {onset / FPS:.2f} s")
end = min(N, int(END * FPS)) if END is not None else N
if end - start < 2: die("nothing left between --start and --end")
Q, T, N = Q[start:end], T[start:end], end - start
header = json.dumps({"fps": FPS, "frames": N, "bones": [NAME[b.name] for b in bones]}).encode()
header += b" " * ((4 - len(header) % 4) % 4)
with open(OUT, "wb") as f:
    f.write(struct.pack("<I", len(header))); f.write(header); f.write(Q.tobytes()); f.write(T.tobytes())
print(f"[take] wrote {OUT}: from {start / FPS:.2f} s, {N} frames at {FPS} fps = {(N - 1) / FPS:.2f} s, {len(bones)} bones, "
      f"{os.path.getsize(OUT) // 1000} KB; hips travel x {T[:, 0].min():.2f}..{T[:, 0].max():.2f} z {T[:, 2].min():.2f}..{T[:, 2].max():.2f} hip heights")
