"""Build the Rain v2 distribution or its temporary artwork proof.

blender --background --factory-startup --disable-autoexec --threads 4 \
    --python-exit-code 1 --python scripts/prepare-avatar.py -- --render
"""
import argparse
import hashlib
import itertools
import json
import math
import shutil
import struct
import sys
import zipfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tmp/avatar-customization/asset-proof"
PUBLIC = ROOT / "public/face/v2"
NEUTRAL = ROOT / "art/neutral"
FEATURES = ("face", "nose", "mouth", "eyeShape")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=ROOT / "art/avatar-v2.json")
    parser.add_argument("--output-dir", type=Path, default=PROOF)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--resolution", type=int, default=480)
    parser.add_argument("--quick", action="store_true", help="Render only the first inspection sheet.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.output_dir = args.output_dir.resolve()
    if args.output_dir != PUBLIC and not args.output_dir.is_relative_to(PROOF):
        parser.error("Generated assets must stay under tmp/avatar-customization/asset-proof or exactly public/face/v2.")
    if args.output_dir == PUBLIC and (args.render or args.render_only):
        parser.error("Production generation cannot write renders. Use the proof directory for render evidence.")
    if not 1 <= args.samples <= 256 or not 200 <= args.resolution <= 2048:
        parser.error("Use 1 to 256 samples and a width of 200 to 2048 pixels.")
    return args


class Glb:
    def __init__(self, path):
        raw = path.read_bytes()
        assert raw[:4] == b"glTF" and struct.unpack_from("<I", raw, 8)[0] == len(raw)
        size = struct.unpack_from("<I", raw, 12)[0]
        self.document = json.loads(raw[20:20 + size])
        offset = 28 + size
        self.binary = bytearray(raw[offset:offset + struct.unpack_from("<I", raw, offset - 8)[0]])

    def primitive(self, name):
        return next(m for m in self.document["meshes"] if m["name"] == name)["primitives"][0]

    def accessor(self, index):
        entry = self.document["accessors"][index]
        assert "sparse" not in entry
        view = self.document["bufferViews"][entry["bufferView"]]
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[entry["type"]]
        dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2"}[entry["componentType"]]
        offset = view.get("byteOffset", 0) + entry.get("byteOffset", 0)
        stride = view.get("byteStride", np.dtype(dtype).itemsize * width)
        return np.ndarray((entry["count"], width), dtype=dtype, buffer=self.binary,
                          offset=offset, strides=(stride, np.dtype(dtype).itemsize)).copy()

    def append(self, data):
        self.binary.extend(b"\0" * (-len(self.binary) % 4))
        index = len(self.document["bufferViews"])
        self.document["bufferViews"].append({"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)})
        self.binary.extend(data)
        return index

    def add_accessor(self, values, target=None):
        values = np.asarray(values)
        is_index = values.dtype.kind == "u"
        values = values.astype("<u4" if is_index else "<f4")
        if values.ndim == 1:
            values = values[:, None]
        view = self.append(values.tobytes())
        if target:
            self.document["bufferViews"][view]["target"] = target
        entry = {"bufferView": view, "componentType": 5125 if is_index else 5126,
                 "count": len(values), "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}[values.shape[1]],
                 "min": values.min(axis=0).tolist(), "max": values.max(axis=0).tolist()}
        self.document["accessors"].append(entry)
        return len(self.document["accessors"]) - 1

    def save(self, path):
        self.binary.extend(b"\0" * (-len(self.binary) % 4))
        self.document["buffers"][0]["byteLength"] = len(self.binary)
        text = json.dumps(self.document, separators=(",", ":")).encode()
        text += b" " * (-len(text) % 4)
        raw = struct.pack("<4sII", b"glTF", 2, 28 + len(text) + len(self.binary))
        raw += struct.pack("<I4s", len(text), b"JSON") + text
        raw += struct.pack("<I4s", len(self.binary), b"BIN\0") + self.binary
        temporary = path.with_suffix(".glb.part")
        temporary.write_bytes(raw)
        temporary.replace(path)


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def support(points, center, radius):
    distance = np.linalg.norm((points - center) / radius, axis=1)
    return smoothstep(1 - distance)


def pinned(points, constraints):
    return ((points[:, 1] <= constraints["neckYMax"]) |
            (points[:, 1] >= constraints["hairlineYMin"]) |
            (np.abs(points[:, 0]) >= constraints["earAbsXMin"]) |
            (points[:, 2] <= constraints["rearZMax"]))


def evaluated_copy(source, name, subdiv):
    source.hide_viewport = False
    source.hide_set(False)
    source.hide_render = False
    if source.animation_data:
        for driver in source.animation_data.drivers:
            if driver.data_path.startswith("modifiers"):
                driver.mute = True
    for modifier in source.modifiers:
        if modifier.type == "SUBSURF":
            modifier.show_viewport = True
            modifier.levels = subdiv
            modifier.render_levels = subdiv
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(graph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=graph)
    if not mesh.vertices or not mesh.uv_layers:
        raise RuntimeError(f"Source evaluation produced an empty mesh or no UVs for {name}")
    mesh.transform(Matrix.Translation(Vector((0, 0, -1.18))) @ evaluated.matrix_world)
    mesh.name = name
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    while len(mesh.uv_layers) > 1:
        mesh.uv_layers.remove(mesh.uv_layers[-1])
    mesh.uv_layers[0].name = "BaseUV"
    return obj


def source_lips(registry, locked):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / registry["source"]["blend"]), use_scripts=False)
    bpy.context.scene.render.use_simplify = False
    source = bpy.data.objects["GEO-rain-head"]
    neutral = evaluated_copy(source, "CorrespondenceNeutral", 1)

    def points(obj):
        return np.array([(v.co.x, v.co.z, -v.co.y) for v in obj.data.vertices])

    baseline = points(neutral)
    primitive = locked.primitive("Face")
    positions = locked.accessor(primitive["attributes"]["POSITION"])
    uvs = locked.accessor(primitive["attributes"]["TEXCOORD_0"])
    buckets = {}
    for index, p in enumerate(baseline):
        buckets.setdefault(tuple(np.round(p, 7)), []).append(index)
    loop_uvs = {}
    uv = neutral.data.uv_layers[0]
    for loop in neutral.data.loops:
        value = uv.data[loop.index].uv
        loop_uvs.setdefault(loop.vertex_index, []).append((value.x - 2, 1 - value.y))
    mapping = []
    errors = []
    for p, uv in zip(positions, uvs):
        candidates = buckets.get(tuple(np.round(p.astype(float), 7)), [])
        candidates = [i for i in candidates if np.max(np.abs(baseline[i] - p)) < 1e-7 and
                      any(np.max(np.abs(np.array(value) - uv)) < 2e-6 for value in loop_uvs[i])]
        assert candidates, f"No exact source position/UV correspondence for {p}, {uv}."
        mapping.append(candidates)
        errors.append(max(np.linalg.norm(baseline[i] - p) for i in candidates))
    keys = source.data.shape_keys
    baseline_keys = {k.name: k.value for k in keys.key_blocks}
    if keys.animation_data:
        for driver in keys.animation_data.drivers:
            driver.mute = True
    targets = {}
    for name, target in registry["authoring"]["targets"].items():
        if target["method"] != "sourceKeys":
            continue
        for key in keys.key_blocks:
            key.value = baseline_keys[key.name] + target["keys"].get(key.name, 0)
        source.data.update()
        obj = evaluated_copy(source, name, 1)
        assert len(obj.data.vertices) == len(neutral.data.vertices)
        assert len(obj.data.loops) == len(neutral.data.loops)
        assert all(a.vertex_index == b.vertex_index for a, b in zip(obj.data.loops, neutral.data.loops))
        delta = points(obj) - baseline
        transferred = np.array([delta[indices[0]] for indices in mapping])
        assert all(np.max(np.abs(delta[indices] - delta[indices[0]])) < 1e-7 for indices in mapping)
        radius = np.linalg.norm((positions - target["supportCenter"]) / target["supportRadius"], axis=1)
        transferred *= smoothstep((1 - radius) / 0.25)[:, None]
        targets[name] = transferred
    evidence = {"method": "Exact rounded position buckets plus per-loop base UV agreement. No nearest-neighbor fallback.",
                "evaluatedSourceVertices": len(baseline), "lockedSplitVertices": len(positions),
                "matchedSplitVertices": len(mapping), "maximumPositionErrorMeters": max(errors),
                "maximumUvTolerance": 2e-6, "sourceLoopOrderUnchangedForTargets": True,
                "mappingSha256": hashlib.sha256(np.asarray([x[0] for x in mapping], dtype="<u4").tobytes()).hexdigest(),
                "preservedNonzeroSourceKeys": {k: v for k, v in baseline_keys.items() if v != 0},
                "sourceKeyRecipes": {name: registry["authoring"]["targets"][name]["keys"] for name in targets}}
    return targets, evidence


def field_delta(points, target):
    method = target["method"]
    delta = np.zeros_like(points, dtype=float)
    side = np.where(points[:, 0] < 0, -1, 1)
    symmetric = points.copy()
    symmetric[:, 0] = np.abs(symmetric[:, 0])
    if method == "symmetricFields":
        for field in target["fields"]:
            displacement = support(symmetric, field["center"], field["radius"])[:, None] * field["shift"]
            displacement[:, 0] *= side * smoothstep(np.abs(points[:, 0]) / 0.006)
            delta += displacement
    elif method == "eyeAperture":
        center = np.asarray(target["eyeCenter"])
        weight = support(symmetric, target["supportCenter"], target["supportRadius"])
        dy = target["apertureMeters"] * np.tanh((points[:, 1] - center[1]) / target["transitionMeters"]) * weight
        old = symmetric - center
        radius_squared = (old * old).sum(axis=1)
        new_z_squared = radius_squared - old[:, 0] ** 2 - (old[:, 1] + dy) ** 2
        active = (weight > 0) & (old[:, 2] > 0) & (new_z_squared > 0)
        delta[active, 1] = dy[active]
        delta[active, 2] = np.sqrt(new_z_squared[active]) - old[active, 2]
    else:
        raise ValueError(f"Unknown field method {method}")
    return delta


def normal_deltas(points, triangles, delta):
    _, weld = np.unique(np.round(points, 7), axis=0, return_inverse=True)

    def normals(p):
        a, b, c = (p[triangles[:, i]] for i in range(3))
        cross = np.cross(b - a, c - a)
        sums = np.zeros((weld.max() + 1, 3))
        for i in range(3):
            np.add.at(sums, weld[triangles[:, i]], cross)
        n = sums[weld]
        return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-20)

    result = normals(points + delta) - normals(points)
    result[np.linalg.norm(result, axis=1) < 1e-7] = 0
    return result


def add_targets(glb, registry, source_targets):
    result = {}
    constraints = registry["authoring"]["constraints"]
    for mesh in glb.document["meshes"]:
        name = mesh["name"]
        recipes = [(key, value) for key, value in registry["authoring"]["targets"].items() if name in value["meshes"]]
        if not recipes:
            continue
        primitive = mesh["primitives"][0]
        p = glb.accessor(primitive["attributes"]["POSITION"])
        triangles = glb.accessor(primitive["indices"]).reshape(-1, 3)
        mesh["extras"] = {"targetNames": [key for key, _ in recipes]}
        mesh["weights"] = [0] * len(recipes)
        primitive["targets"] = []
        for key, recipe in recipes:
            d = source_targets[key].copy() if recipe["method"] == "sourceKeys" else field_delta(p, recipe)
            if name == "Face":
                d *= smoothstep((p[:, 1] - constraints["neckYMax"]) / 0.015)[:, None]
                d *= smoothstep((constraints["earAbsXMin"] - np.abs(p[:, 0])) / 0.010)[:, None]
                d *= smoothstep((p[:, 2] - constraints["rearZMax"]) / 0.025)[:, None]
                d *= smoothstep((constraints["hairlineYMin"] - p[:, 1]) / 0.015)[:, None]
                d[pinned(p, constraints)] = 0
            d[np.linalg.norm(d, axis=1) < 1e-8] = 0
            n = normal_deltas(p, triangles, d)
            n[pinned(p, constraints)] = 0
            primitive["targets"].append({"POSITION": glb.add_accessor(d, 34962), "NORMAL": glb.add_accessor(n, 34962)})
            result.setdefault(key, {})[name] = {"vertices": len(p), "movedVertices": int(np.count_nonzero(np.linalg.norm(d, axis=1))),
                                              "maxDisplacementMeters": float(np.linalg.norm(d, axis=1).max())}
    return result


def append_mesh(glb, name, points, triangles, uv, material_index):
    normals = np.zeros_like(points, dtype=float)
    cross = np.cross(points[triangles[:, 1]] - points[triangles[:, 0]], points[triangles[:, 2]] - points[triangles[:, 0]])
    for i in range(3):
        np.add.at(normals, triangles[:, i], cross)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-20)
    primitive = {"attributes": {"POSITION": glb.add_accessor(points, 34962),
                                 "NORMAL": glb.add_accessor(normals, 34962),
                                 "TEXCOORD_0": glb.add_accessor(uv, 34962)},
                 "indices": glb.add_accessor(triangles.astype("<u4").ravel(), 34963), "material": material_index, "mode": 4}
    mesh_index = len(glb.document["meshes"])
    glb.document["meshes"].append({"name": name, "primitives": [primitive]})
    node_index = len(glb.document["nodes"])
    glb.document["nodes"].append({"name": name, "mesh": mesh_index})
    glb.document["scenes"][glb.document.get("scene", 0)]["nodes"].append(node_index)


def bun_mesh(glb, registry):
    recipe = registry["authoring"]["hair"]["bun"]
    center, radius = np.array(recipe["center"]), np.array(recipe["radius"])
    segments, rings = recipe["segments"], recipe["rings"]
    vertices, uv, triangles = [], [], []
    for j in range(rings + 1):
        latitude = math.pi * (j + 0.25) / (rings + 0.5)
        for i in range(segments):
            phi = 2 * math.pi * i / segments
            ridge = recipe["ridgeDepth"] * math.sin(latitude) ** 1.3 * math.sin(recipe["ridgeCount"] * phi + 3.8 * latitude)
            local_radius = radius + ridge
            unit = np.array([math.sin(latitude) * math.cos(phi), math.cos(latitude), math.sin(latitude) * math.sin(phi)])
            point = center + local_radius * unit
            point[1] -= recipe["centerDimple"] * math.exp(-math.sin(latitude) ** 2 / 0.08) * max(0, math.cos(latitude))
            vertices.append(point)
            lo, hi = np.array(recipe["uvMin"]), np.array(recipe["uvMax"])
            uv.append(lo + (hi - lo) * np.array([latitude / math.pi, ((phi + math.pi / 2) / (2 * math.pi)) % 1]))
    for j in range(rings):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            c, d = a + segments, b + segments
            triangles.extend([(a, b, c), (b, d, c)])
    for j, ring in [(0, 0), (rings, rings)]:
        pole = len(vertices)
        point = center + [0, radius[1] if j == 0 else -radius[1], 0]
        if j == 0:
            point[1] -= recipe["centerDimple"]
        vertices.append(point)
        uv.append((np.array(recipe["uvMin"]) + recipe["uvMax"]) / 2)
        for i in range(segments):
            a, b = ring * segments + i, ring * segments + (i + 1) % segments
            triangles.append((pole, b, a) if j == 0 else (pole, a, b))
    vertices, triangles = np.array(vertices), np.array(triangles)
    cross = np.cross(vertices[triangles[:, 1]] - vertices[triangles[:, 0]], vertices[triangles[:, 2]] - vertices[triangles[:, 0]])
    if np.median(np.sum(cross * (vertices[triangles[:, 0]] - center), axis=1)) < 0:
        triangles = triangles[:, [0, 2, 1]]
    append_mesh(glb, "HairBun", vertices, triangles, np.array(uv), glb.primitive("Hair")["material"])
    center = np.array(recipe["bandCenter"])
    vertices, uv, triangles = [], [], []
    for i in range(96):
        angle = i / 96 * 2 * math.pi
        for j in range(12):
            around = j / 12 * 2 * math.pi
            r = recipe["bandRadius"] + recipe["bandTubeRadius"] * math.cos(around)
            vertices.append(center + [r * math.cos(angle), recipe["bandTubeRadius"] * math.sin(around), r * math.sin(angle)])
            uv.append([i / 96, j / 12])
    for i in range(96):
        for j in range(12):
            a, b = i * 12 + j, ((i + 1) % 96) * 12 + j
            c, d = i * 12 + (j + 1) % 12, ((i + 1) % 96) * 12 + (j + 1) % 12
            triangles.extend([(a, c, b), (b, c, d)])
    append_mesh(glb, "BunBand", np.array(vertices), np.array(triangles), np.array(uv), glb.primitive("HairTie")["material"])


def srgb_to_linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)


def load_pixels(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=float) / 255


def save_pixels(path, rgb, alpha):
    pixels = np.dstack((linear_to_srgb(rgb), alpha))
    Image.fromarray(np.round(np.clip(pixels, 0, 1) * 255).astype("uint8")).save(path, compress_level=9)


def low_frequency(rgb, alpha, radius):
    valid = (alpha > 0).astype(float)

    def blur(values):
        image = Image.fromarray(np.round(np.clip(values, 0, 1) * 255).astype("uint8"))
        return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255

    weight = np.maximum(blur(valid), 1e-3)
    return np.stack([blur(rgb[:, :, i] * valid) / weight for i in range(3)], axis=-1)


def texture_maps(registry, output):
    (output / "maps").mkdir(exist_ok=True)
    skin = registry["authoring"]["skin"]
    reference = np.array(skin["referenceLinear"])
    weights = np.array([0.2126, 0.7152, 0.0722])
    ref_lum = reference @ weights
    reference_chroma = reference / ref_lum
    for part, source_key, map_key in [("face", "sourceFace", "faceMap"), ("bust", "sourceBust", "bustMap")]:
        source = ROOT / skin[source_key]
        rgba = load_pixels(source)
        rgb = srgb_to_linear(rgba[:, :, :3])
        lum = rgb @ weights
        valid = lum > 0.001
        low = low_frequency(rgb, rgba[:, :, 3] * valid, 24 if part == "face" else 6)
        low_lum = np.maximum(low @ weights, 0.005)
        detail = np.clip(lum / low_lum, 0.35, 1.8) ** skin["detailRatioPower"]
        broad = np.clip(low_lum / ref_lum, 0.25, 2) ** 0.35
        chroma = rgb / np.maximum(lum[:, :, None], 0.001)
        chroma_adjust = np.clip(chroma / reference_chroma, 0.5, 1.8) ** skin["localChromaStrength"]
        height, width = lum.shape
        yy, xx = np.mgrid[0:height, 0:width]
        uv = np.stack((xx / (width - 1), 1 - yy / (height - 1)), axis=-1)
        lip_distance = np.linalg.norm((uv - skin["lipUvCenter"]) / skin["lipUvRadius"], axis=-1)
        lip = smoothstep(1 - lip_distance) * smoothstep((rgb[:, :, 0] / np.maximum(rgb[:, :, 1], 0.001) - 1.6) / 0.9)
        if part == "bust":
            lip *= 0
        for name, choice in registry["choices"]["complexion"].items():
            path = output / choice[map_key]
            recipe = choice["recipe"]
            if recipe.get("copySource"):
                shutil.copyfile(source, path)
                continue
            mapped = np.array(recipe["skinLinear"]) * broad[:, :, None] * detail[:, :, None] * chroma_adjust
            local_lip_detail = np.clip(lum / 0.11, 0.5, 1.5) ** 0.5
            lip_color = np.array(recipe["lipLinear"]) * local_lip_detail[:, :, None]
            mapped = mapped * (1 - lip[:, :, None]) + lip_color * lip[:, :, None]
            mapped[~valid] = 0
            save_pixels(path, mapped, rgba[:, :, 3])
    hair = registry["authoring"]["hair"]
    source = ROOT / hair["source"]
    rgba = load_pixels(source)
    rgb = srgb_to_linear(rgba[:, :, :3])
    lum = rgb @ weights
    valid = (rgba[:, :, 3] > 0) & (lum > 0.0001)
    lo, hi = np.percentile(lum[valid], hair["luminancePercentiles"])
    normalized = np.clip((lum - lo) / (hi - lo), 0, 1)
    for name, choice in registry["choices"]["hairColor"].items():
        recipe = choice["recipe"]
        path = output / choice["map"]
        if recipe.get("copySource"):
            shutil.copyfile(source, path)
            continue
        factor = normalized ** recipe["gamma"]
        result = np.array(recipe["shadowLinear"]) + factor[:, :, None] * (np.array(recipe["lightLinear"]) - recipe["shadowLinear"])
        result[~valid] = 0
        save_pixels(path, result, rgba[:, :, 3])
    for choice in registry["choices"]["eyes"].values():
        shutil.copyfile(ROOT / choice["source"], output / choice["map"])
    if output != PUBLIC:
        texture_sheets(registry, output)
    return {str(path.relative_to(output)): {"bytes": path.stat().st_size, "sha256": sha(path),
                                           "size": list(Image.open(path).size)} for path in sorted((output / "maps").glob("*.png"))}


def texture_sheets(registry, output):
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    for group, filename, crops in [
        ("complexion", "contact-skin-map-details.png", [(0.43, 0.49, 0.57, 0.58), (0.44, 0.58, 0.56, 0.67)]),
        ("hairColor", "contact-hair-map-details.png", [(0.32, 0.06, 0.76, 0.28)]),
    ]:
        choices = registry["choices"][group]
        sheet = Image.new("RGB", (len(choices) * 300, 38 + len(crops) * 220), "#e9e5e2")
        draw = ImageDraw.Draw(sheet)
        for i, (name, choice) in enumerate(choices.items()):
            draw.text((i * 300 + 10, 7), choice["label"], fill="#24212a", font=font)
            image = Image.open(output / choice["faceMap" if group == "complexion" else "map"]).convert("RGB")
            for j, crop in enumerate(crops):
                region = image.crop(tuple(round(v * (image.width if k % 2 == 0 else image.height)) for k, v in enumerate(crop)))
                sheet.paste(region.resize((300, 220), Image.Resampling.LANCZOS), (i * 300, 38 + j * 220))
        sheet.save(output / filename)


def neutral_files():
    return {str(p.relative_to(ROOT)): sha(p) for p in sorted(NEUTRAL.rglob("*")) if p.is_file()}


def atlas_contract(output, registry):
    contract = json.loads((NEUTRAL / "asset.json").read_text())
    files = ["makeup-blank.png", *contract["paint"]["masks"].values()]
    for file in files:
        destination = output / file
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(NEUTRAL / file, destination)
    return {"id": registry["paintAtlas"], "directory": ".", "publicPath": "/face/v2/",
            "paint": contract["paint"], "landmarks": contract["landmarks"],
            "files": {file: sha(output / file) for file in files}}


def build(args, registry):
    output = args.output_dir
    original = neutral_files()
    archive = ROOT / registry["source"]["archive"]
    assert sha(archive) == registry["source"]["archiveSha256"], "The licensed source archive checksum changed."
    blend = ROOT / registry["source"]["blend"]
    with zipfile.ZipFile(archive) as source_zip:
        archived_blend = hashlib.sha256(source_zip.read("Rain v3.3/rain_v3.2.blend")).hexdigest()
    assert sha(blend) == archived_blend, "The unpacked .blend differs from the licensed archive."
    glb = Glb(ROOT / registry["source"]["neutral"])
    original_binary_bytes = len(glb.binary)
    source_targets, correspondence = source_lips(registry, glb)
    dump(output / "source-correspondence.json", correspondence)
    targets = add_targets(glb, registry, source_targets)
    bun_mesh(glb, registry)
    glb.document.setdefault("asset", {}).setdefault("extras", {}).update({"registry": "art/avatar-v2.json", "paintAtlas": registry["paintAtlas"]})
    glb.save(output / "head.glb")
    maps = texture_maps(registry, output)
    meshes = {}
    for mesh in glb.document["meshes"]:
        p = mesh["primitives"][0]
        meshes[mesh["name"]] = {"vertices": glb.document["accessors"][p["attributes"]["POSITION"]]["count"],
                                "triangles": glb.document["accessors"][p["indices"]]["count"] // 3,
                                "targets": mesh.get("extras", {}).get("targetNames", [])}
    manifest = {"id": registry["asset"], "status": "generated runtime asset" if output == PUBLIC else "temporary asset proof, not a released revision",
                "registrySha256": sha(args.registry), "glb": {"file": "head.glb", "sha256": sha(output / "head.glb"),
                "bytes": (output / "head.glb").stat().st_size, "preservedNeutralBinaryPrefixBytes": original_binary_bytes},
                "source": registry["source"], "sourceBlendSha256": archived_blend,
                "generatorSha256": sha(Path(__file__)),
                "paintAtlas": atlas_contract(output, registry), "meshes": meshes,
                "triangles": sum(m["triangles"] for m in meshes.values()), "targets": targets, "maps": maps,
                "neutralAuthoringInputs": original, "changes": ["Locked neutral GLB bytes and materials retained.",
                "Added bounded position and normal morph targets, with a fitted lash aperture target.",
                "Added a separate ridged crown-bun mesh and fabric band.",
                "Added offline authored complexion and hair recolors. These are not newly photographed skins."],
                "limits": ["Browser picking, paint replay, GPU memory, and device performance require runtime verification."]}
    provenance = json.loads((NEUTRAL / "provenance.json").read_text())
    provenance["distribution"] = ("Rain v2 portrait derivative under public/face/v2. No AI-generated artwork."
                                  if output == PUBLIC else "Temporary Rain v2 avatar proof under tmp/avatar-customization/asset-proof.")
    provenance["sourceBlendSha256"] = archived_blend
    provenance["modifications"] += manifest["changes"][1:]
    dump(output / "provenance.json", provenance)
    (output / "CREDITS.txt").write_text(
        registry["source"]["credit"] + "\n"
        "Source: https://studio.blender.org/characters/rain/\n"
        "License: https://creativecommons.org/licenses/by/4.0/\n\n"
        "This is a modified Rain portrait. No AI-generated artwork.\n"
        "The neutral portrait changes remain. V2 adds bounded face and lash morphs,\n"
        "a fitted crown bun, and offline skin and hair recolors.\n"
        "The recolors are not newly photographed skins.\n"
        "Blender Foundation does not endorse this project.\n"
        "See provenance.json and asset.json for the source and changes.\n"
    )
    (output / "licenses").mkdir(exist_ok=True)
    for path in (NEUTRAL / "licenses").iterdir():
        if path.is_file():
            shutil.copyfile(path, output / "licenses" / path.name)
    manifest["creditFile"] = "CREDITS.txt"
    manifest["provenanceFile"] = "provenance.json"
    dump(output / "asset.json", manifest)
    assert neutral_files() == original, "Generation changed the neutral authoring inputs."
    return manifest


def configure_render(args):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.cycles.seed = 17
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = int(args.resolution * 1.25)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("Avatar proof studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.45, 0.45, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    target = Vector((0, 0, 0.279))
    for position, energy, size, color in [((-0.35, -0.50, 0.72), 10, 0.48, (1, 0.94, 0.88)),
                                          ((0.38, -0.30, 0.43), 5, 0.45, (0.89, 0.92, 1)),
                                          ((0.15, 0.28, 0.58), 2, 0.32, (1, 0.94, 0.90))]:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy, light.data.size, light.data.color = energy, size, color
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.camera_add(location=(0, -1.7, 0.279))
    scene.camera = bpy.context.object
    scene.camera.data.type = "ORTHO"
    scene.camera.data.ortho_scale = 0.54
    return scene.camera


def render_cases(registry):
    cases = [{"id": "neutral", "label": "Balanced neutral", "identity": {}}]
    for group in FEATURES:
        for choice, entry in registry["choices"][group].items():
            if choice == registry["defaults"][group]:
                continue
            cases.append({"id": f"{group}-{choice}", "label": f"{group} / {entry['label']}", "identity": {group: choice}})
    cases += [
        {"id": "extreme-soft", "label": "Soft / broad / full / round", "identity": {"face": "soft", "nose": "broad", "mouth": "full", "eyeShape": "round"}},
        {"id": "extreme-angular", "label": "Angular / rounded / wide / round", "identity": {"face": "angular", "nose": "rounded", "mouth": "wide", "eyeShape": "round"}},
    ]
    return cases


def set_map(material, path):
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    texture = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
    if texture is None:
        texture = nodes.new("ShaderNodeTexImage")
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    texture.image = bpy.data.images.load(str(path), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"


def sheets(output, records, title, filename, columns=5, width=280):
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    font = ImageFont.truetype(font_path, 15)
    title_font = ImageFont.truetype(font_path, 21)
    thumb_height = round(width * 1.25)
    rows = math.ceil(len(records) / columns)
    sheet = Image.new("RGB", (columns * width, 70 + rows * (thumb_height + 44)), "#e9e5e2")
    draw = ImageDraw.Draw(sheet)
    while draw.textlength(title, font=title_font) > sheet.width - 32:
        title_font = ImageFont.truetype(font_path, title_font.size - 1)
    draw.text((16, 12), title, fill="#24212a", font=title_font)
    draw.text((16, 42), "Fresh GLB import. Fixed light and camera.", fill="#4a4650", font=font)
    for index, record in enumerate(records):
        x, y = (index % columns) * width, 70 + (index // columns) * (thumb_height + 44)
        image = Image.open(output / record["file"]).convert("RGB")
        image = image.resize((width, thumb_height), Image.Resampling.LANCZOS)
        sheet.paste(image, (x, y))
        label_font = font
        while draw.textlength(record["label"], font=label_font) > width - 14:
            label_font = ImageFont.truetype(font_path, label_font.size - 1)
        draw.text((x + 7, y + thumb_height + 4), record["label"], fill="#24212a", font=label_font)
        draw.text((x + 7, y + thumb_height + 23), record["view"] + " / " + record["mode"], fill="#625b6a", font=font)
    sheet.save(output / filename)


def render_proof(args, registry):
    output = args.output_dir
    render_dir = output / "renders"
    render_dir.mkdir(exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(output / "head.glb"), import_shading="NORMALS", merge_vertices=False)
    meshes = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    assert "HairBun" in meshes and "BunBand" in meshes
    face = meshes["Face"]
    assert len(face.data.uv_layers) == 2
    assert set(face.data.shape_keys.key_blocks.keys()) == {"Basis", *registry["authoring"]["targets"]}
    camera = configure_render(args)
    materials = {name: list(obj.data.materials) for name, obj in meshes.items()}
    clay = bpy.data.materials.new("Neutral clay geometry inspection")
    clay.use_nodes = True
    shader = clay.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.38, 0.38, 0.38, 1)
    shader.inputs["Roughness"].default_value = 0.78
    eye_clay = clay.copy()
    eye_clay.name = "Eyeball clay"
    eye_clay.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.64, 0.64, 0.64, 1)
    silhouette = bpy.data.materials.new("Silhouette")
    silhouette.use_nodes = True
    silhouette.node_tree.nodes.clear()
    shader = silhouette.node_tree.nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = (0, 0, 0, 1)
    output_node = silhouette.node_tree.nodes.new("ShaderNodeOutputMaterial")
    silhouette.node_tree.links.new(shader.outputs["Emission"], output_node.inputs["Surface"])
    records = []

    def render(case, view, mode, category):
        identity = {**registry["defaults"], **case["identity"]}
        pose = {}
        for group in FEATURES:
            pose.update(registry["choices"][group][identity[group]]["morphs"])
        for name, obj in meshes.items():
            if obj.data.shape_keys:
                for key in list(obj.data.shape_keys.key_blocks)[1:]:
                    key.value = pose.get(key.name, 0)
            obj.data.materials.clear()
            for mat in materials[name]:
                obj.data.materials.append(mat)
        all_hair = {component for choice in registry["choices"]["hairStyle"].values() for component in choice["components"]}
        active_hair = registry["choices"]["hairStyle"][identity["hairStyle"]]["components"]
        for name in all_hair:
            meshes[name].hide_render = name not in active_hair
        complexion = registry["choices"]["complexion"][identity["complexion"]]
        set_map(materials["Face"][0], output / complexion["faceMap"])
        set_map(materials["Bust"][0], output / complexion["bustMap"])
        hair = registry["choices"]["hairColor"][identity["hairColor"]]
        set_map(materials["Hair"][0], output / hair["map"])
        materials["Brows"][0].node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*hair["browLinear"], 1)
        set_map(materials["Eye.L"][0], output / registry["choices"]["eyes"][identity["eyes"]]["map"])
        if mode != "color":
            for name, obj in meshes.items():
                if mode == "silhouette" or name not in ["EyeHighlights", "Brows", "Lashes"]:
                    obj.data.materials.clear()
                    obj.data.materials.append(silhouette if mode == "silhouette" else eye_clay if name.startswith("Eye.") else clay)
        angle = math.radians(28 if view == "three-quarter" else 0)
        target_y = 0.270 if category == "anatomy" else 0.279
        camera.data.ortho_scale = 0.31 if category == "anatomy" else 0.54
        camera.location = (1.7 * math.sin(angle), -1.7 * math.cos(angle), target_y)
        camera.rotation_euler = (Vector((0, 0, target_y)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        file = f"renders/{category}-{case['id']}-{view}-{mode}.png"
        bpy.context.scene.render.filepath = str(output / file)
        bpy.ops.render.render(write_still=True)
        records.append({"file": file, "sha256": sha(output / file), "label": case["label"], "view": view, "mode": mode, "category": category, "identity": identity})

    cases = render_cases(registry)
    if args.quick:
        cases = [cases[0], cases[-2], cases[-1], {"id": "bun-blonde", "label": "Fair / blonde / crown bun", "identity": {"complexion": "fair", "hairColor": "blonde", "hairStyle": "bun"}},
                 {"id": "deep-bun", "label": "Deep / espresso / crown bun", "identity": {"complexion": "deep", "hairStyle": "bun"}}]
    for mode in (["color"] if args.quick else ["color", "clay"]):
        for view in ["front", "three-quarter"]:
            start = len(records)
            for case in cases:
                render(case, view, mode, "features")
            sheets(output, records[start:], f"Rain v2 / individual shapes and extremes / {mode} / {view}", f"contact-features-{view}-{mode}.png")
    if not args.quick:
        start = len(records)
        palette_extremes = [
            {"id": "fair-blonde-bun", "label": "Fair / blonde bun / angular / round", "identity": {"face": "angular", "nose": "rounded", "mouth": "wide", "eyeShape": "round", "complexion": "fair", "hairColor": "blonde", "hairStyle": "bun"}},
            {"id": "deep-plum-bun", "label": "Deep / plum bun / soft / broad", "identity": {"face": "soft", "nose": "broad", "mouth": "full", "eyeShape": "round", "complexion": "deep", "hairColor": "plum", "hairStyle": "bun"}},
        ]
        for view in ["front", "three-quarter"]:
            for case in palette_extremes:
                render(case, view, "color", "palette-extremes")
        sheets(output, records[start:], "Rain v2 / shape, skin, and bun extremes", "contact-palette-extremes.png", columns=2)
        for view in ["front", "three-quarter"]:
            start = len(records)
            for case in cases:
                render(case, view, "clay", "anatomy")
            sheets(output, records[start:], f"Rain v2 / close geometry inspection / {view}", f"contact-anatomy-{view}.png")
        for group in ["complexion", "hairColor", "hairStyle", "eyes"]:
            group_records = []
            for view in ["front", "three-quarter"]:
                for choice, entry in registry["choices"][group].items():
                    case = {"id": f"{group}-{choice}", "label": f"{group} / {entry['label']}", "identity": {group: choice}}
                    render(case, view, "color", group)
                    group_records.append(records[-1])
            sheets(output, group_records, f"Rain v2 / {group} / front and 28 degree views", f"contact-{group}.png", columns=len(registry["choices"][group]))
        silhouette_cases = [cases[0], cases[1], cases[2], {"id": "bun", "label": "Crown bun silhouette", "identity": {"hairStyle": "bun"}}]
        start = len(records)
        for view in ["front", "three-quarter"]:
            for case in silhouette_cases:
                render(case, view, "silhouette", "silhouette")
        sheets(output, records[start:], "Rain v2 / silhouette / shape and hairstyle", "contact-silhouettes.png", columns=4)
        combinations = list(itertools.product(*(registry["choices"][group] for group in FEATURES)))
        start = len(records)
        for index, values in enumerate(combinations):
            identity = dict(zip(FEATURES, values))
            render({"id": f"combination-{index:02}", "label": "/".join(values), "identity": identity}, "front", "clay", "matrix")
        sheets(output, records[start:], "Rain v2 / all 54 supported combinations / clay", "contact-all-combinations.png", columns=9, width=200)
    dump(output / ("quick-render-index.json" if args.quick else "render-index.json"), {
        "glbSha256": sha(output / "head.glb"), "registrySha256": sha(args.registry),
        "reimportedMeshCount": len(meshes), "faceUvLayers": len(face.data.uv_layers),
        "source": "Fresh Blender GLB import with imported position and normal morphs. No source .blend geometry used for renders.",
        "samples": args.samples, "resolution": [args.resolution, int(args.resolution * 1.25)], "renders": records})


def main():
    args = arguments()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    registry = json.loads(args.registry.read_text())
    if not args.render_only:
        manifest = build(args, registry)
        print(json.dumps({"glb": manifest["glb"], "triangles": manifest["triangles"], "targets": manifest["targets"]}))
    if args.render or args.render_only:
        render_proof(args, registry)


if __name__ == "__main__":
    main()
