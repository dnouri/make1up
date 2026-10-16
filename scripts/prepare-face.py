"""Export the licensed Rain portrait and its independent makeup coordinates.

Run from the repository root with Blender 4.3 or later.
blender --background --factory-startup --disable-autoexec --threads 4 \
    --python-exit-code 1 --python scripts/prepare-face.py -- --render-dir tmp/art-probe/final

The downloaded source and notices must exist under tmp/asset-research, or at
--research-dir. Source files are never modified. No downloaded script executes.
"""
import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
PROJECTION = {"xMin": -0.15, "xMax": 0.15, "yMin": 0.15, "yMax": 0.445}
SOURCE_OFFSET = Vector((0, 0, -1.18))
MESH_ROLES = {
    "Face": "paintable head and neck",
    "Eye.L": "subject left eye, viewer right",
    "Eye.R": "subject right eye, viewer left",
    "EyeHighlights": "fixed stylized catchlights for the neutral gaze",
    "Brows": "separate fitted brows",
    "Lashes": "separate upper eyelid lashes",
    "Hair": "scalp and sculpted hair",
    "HairSweep": "front curl",
    "HairTail": "lowered ponytail",
    "HairTie": "lavender ponytail band",
    "Bust": "cropped shoulders, joined visually to the neck",
    "Top": "lavender portrait top",
}
SOURCE_MESHES = [
    ("head", "Face", "Skin", 1),
    ("eyes", "Eyes", "IrisSclera", 1),
    ("eyebrows", "Brows", "BrowHair", 1),
    ("eyelashes", "Lashes", "LashHair", 1),
    ("hair_main", "Hair", "EspressoHair", 1),
    ("hair_strand", "HairSweep", "EspressoHair", 1),
    ("hair_ponytail", "HairTail", "EspressoHair", 1),
    ("hairband", "HairTie", "LavenderFabric", 1),
    ("body_nomask", "Bust", "BustSkin", 1),
    ("top", "Top", "LavenderFabric", 1),
]
TEXTURES = [
    ("TEX-rain_body_diffuse.1003.png", "skin-base.png", 2048),
    ("TEX-rain_body_diffuse.1001.png", "bust-base.png", 512),
    ("TEX-rain_hair_diffuse.png", "hair-espresso.png", 1024),
    ("TEX-rain_eyes.png", "eyes-blue.png", 1024),
]


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-dir", type=Path, default=ROOT / "tmp/asset-research")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/face/v1")
    parser.add_argument("--render-dir", type=Path)
    parser.add_argument("--mask-size", type=int, default=1024)
    parser.add_argument("--samples", type=int, default=96)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.research_dir = args.research_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    if args.render_dir:
        args.render_dir = args.render_dir.resolve()
    if not 256 <= args.mask_size <= 2048:
        parser.error("--mask-size must be between 256 and 2048")
    return args


def material(name, color, roughness, image=None, coat=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Specular IOR Level"].default_value = 0.28
    shader.inputs["Coat Weight"].default_value = coat
    shader.inputs["Coat Roughness"].default_value = 0.16
    if image:
        texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(str(image), check_existing=True)
        texture.image.colorspace_settings.name = "sRGB"
        mat.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    return mat


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True
    while obj.data.color_attributes:
        obj.data.color_attributes.remove(obj.data.color_attributes[0])


def evaluated_copy(source, name, subdiv):
    # A source in an excluded collection otherwise returns an unevaluated mesh.
    if source.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(source)
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
    mesh.transform(Matrix.Translation(SOURCE_OFFSET) @ evaluated.matrix_world)
    mesh.name = name
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    while len(mesh.uv_layers) > 1:
        mesh.uv_layers.remove(mesh.uv_layers[-1])
    mesh.uv_layers[0].name = "BaseUV"
    return obj


def crop_bust(obj):
    for vertex in obj.data.vertices:
        excess = max(0, abs(vertex.co.x) - 0.105)
        vertex.co.z -= excess * 0.65
        vertex.co.x = math.copysign(abs(vertex.co.x) - excess * 0.22, vertex.co.x)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for point, normal in [((0, 0, 0), (0, 0, 1)), ((0.235, 0, 0), (-1, 0, 0)), ((-0.235, 0, 0), (1, 0, 0))]:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                              dist=1e-6, plane_co=point, plane_no=normal, clear_inner=True)
    bm.to_mesh(obj.data)
    bm.free()


def fit_neck(face, bust):
    def boundary_indices(obj, low, high):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        indices = [v.index for v in bm.verts if v.is_boundary and low < v.co.z < high and abs(v.co.x) < 0.08]
        bm.free()
        return indices

    face_ring = boundary_indices(face, 0.09, 0.13)
    bust_ring = boundary_indices(bust, 0.09, 0.14)
    assert len(face_ring) == len(bust_ring) == 96, "The source neck topology has changed."
    pairs = []
    for j in bust_ring:
        vertex = bust.data.vertices[j]
        i = min(face_ring, key=lambda i: (face.data.vertices[i].co - vertex.co).length)
        assert (face.data.vertices[i].co - vertex.co).length < 0.008
        vertex.co = face.data.vertices[i].co
        pairs.append((i, j))
    assert len({i for i, _ in pairs}) == 96
    face.data.update()
    bust.data.update()
    face_normals = [v.normal.copy() for v in face.data.vertices]
    bust_normals = [v.normal.copy() for v in bust.data.vertices]
    for i, j in pairs:
        normal = (face_normals[i] + bust_normals[j]).normalized()
        face_normals[i] = normal
        bust_normals[j] = normal
    face.data.normals_split_custom_set_from_vertices(face_normals)
    bust.data.normals_split_custom_set_from_vertices(bust_normals)
    return {"matchedVertices": 96, "maxPositionGapMeters": 0}


def split_eyes(eyes):
    result = []
    for suffix, side in [("L", 1), ("R", -1)]:
        obj = eyes.copy()
        obj.data = eyes.data.copy()
        obj.name = f"Eye.{suffix}"
        obj.data.name = obj.name
        bpy.context.scene.collection.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x * side < 0], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        result.append(obj)
    bpy.data.objects.remove(eyes, do_unlink=True)
    return result


def catchlights(eyes):
    mat = material("EyeCatchlight", (0.94, 0.97, 1), 0.3)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Color"].default_value = (0.65, 0.72, 0.82, 1)
    shader.inputs["Emission Strength"].default_value = 0.45
    objects = []
    for eye in eyes:
        center_x = (min(v.co.x for v in eye.data.vertices) + max(v.co.x for v in eye.data.vertices)) / 2
        for dx, z, radius in [(-0.0052, 0.300, 0.0018), (0.0040, 0.288, 0.0007)]:
            x = center_x + dx
            hit, point, _, _ = eye.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
            assert hit, "Catchlight did not hit the exported eye."
            point.y -= radius * 0.3
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=point)
            obj = bpy.context.object
            obj.scale.y = 0.28
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            assign_material(obj, mat)
            objects.append(obj)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = "EyeHighlights"
    obj.data.name = obj.name
    return obj


def image_from_top_array(path, pixels, data=False):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(path.stem, width=width, height=height, alpha=True)
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"
    image.pixels.foreach_set(np.flipud(pixels).astype(np.float32).ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def prepare_textures(source, output):
    for original, name, size in TEXTURES:
        image = bpy.data.images.load(str(source / original), check_existing=False)
        image.scale(size, size)
        image.filepath_raw = str(output / name)
        image.file_format = "PNG"
        image.save()
        bpy.data.images.remove(image)
    source_image = bpy.data.images.load(str(output / "eyes-blue.png"), check_existing=False)
    width, height = source_image.size
    pixels = np.asarray(source_image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    iris = (pixels[:, :, 2] > pixels[:, :, 0] * 1.25) & (pixels[:, :, 0] < 0.8)
    luminance = pixels[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722])
    for name, tint in [("eyes-hazel.png", (1.15, 0.69, 0.34)), ("eyes-olive.png", (0.68, 0.83, 0.48))]:
        variant = pixels.copy()
        variant[:, :, :3][iris] = np.clip(luminance[iris, None] * np.array(tint), 0, 1)
        image_from_top_array(output / name, np.flipud(variant))
    bpy.data.images.remove(source_image)


def paint_uv(face):
    mesh = face.data
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    uv = mesh.uv_layers.new(name="MakeupFrontUV")
    eligible = set()
    for polygon in mesh.polygons:
        point = polygon.center
        candidate = 0.16 < point.z < 0.44 and abs(point.x) < 0.125 and point.y < -0.02 and polygon.normal.y < -0.03
        visible = False
        if candidate:
            hit, _, _, _ = tree.ray_cast(Vector((point.x, -1, point.z)), Vector((0, 1, 0)))
            visible = hit is not None and abs(hit.y - point.y) < 0.00075
        if visible:
            eligible.add(polygon.index)
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = ((point.x + 0.15) / 0.30, (point.z - 0.15) / 0.295) if visible else (0, 1)
    mesh.uv_layers.active_index = 0
    mesh.uv_layers[0].active_render = True
    assert len(eligible) > 1000
    for polygon in mesh.polygons:
        if polygon.center.y > 0:
            assert all(tuple(uv.data[i].uv) == (0, 1) for i in polygon.loop_indices)
    return eligible


def masks(face, eligible, output, size):
    mesh = face.data
    mesh.calc_loop_triangles()
    coverage = np.zeros((size, size), dtype=np.float32)
    base_uv = np.zeros((size, size, 2), dtype=np.float32)
    paint = mesh.uv_layers[1].data
    base = mesh.uv_layers[0].data
    for triangle in mesh.loop_triangles:
        if triangle.polygon_index not in eligible:
            continue
        points = np.array([(paint[i].uv.x, 1 - paint[i].uv.y) for i in triangle.loops]) * (size - 1)
        lo = np.maximum(np.floor(points.min(axis=0)).astype(int), 0)
        hi = np.minimum(np.ceil(points.max(axis=0)).astype(int) + 1, size)
        x0, y0 = lo
        x1, y1 = hi
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        a, b, c = points
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denominator) < 1e-8:
            continue
        w0 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denominator
        w1 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denominator
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-5) & (w1 >= -1e-5) & (w2 >= -1e-5)
        coords = np.array([tuple(base[i].uv) for i in triangle.loops])
        interp = w0[:, :, None] * coords[0] + w1[:, :, None] * coords[1] + w2[:, :, None] * coords[2]
        coverage[y0:y1, x0:x1][inside] = 1
        base_uv[y0:y1, x0:x1][inside] = interp[inside]
    skin = bpy.data.images.load(str(output / "skin-base.png"), check_existing=False)
    width, height = skin.size
    pixels = np.asarray(skin.pixels[:], dtype=np.float32).reshape(height, width, 4)
    sx = np.clip((base_uv[:, :, 0] * (width - 1)).astype(int), 0, width - 1)
    sy = np.clip((base_uv[:, :, 1] * (height - 1)).astype(int), 0, height - 1)
    color = pixels[sy, sx, :3]
    u, v = base_uv[:, :, 0], base_uv[:, :, 1]
    lip_region = (u > 0.43) & (u < 0.57) & (v > 0.33) & (v < 0.42)
    lips = np.clip((color[:, :, 0] / np.maximum(color[:, :, 1], 0.001) - 1.38) / 0.13, 0, 1) * lip_region * coverage
    yy, xx = np.mgrid[0:size, 0:size]
    x = xx / (size - 1) * 0.30 - 0.15
    y = 0.445 - yy / (size - 1) * 0.295
    lips *= (y > 0.185) & (y < 0.229) & (np.abs(x) < 0.04)

    def ellipse(cx, cy, rx, ry):
        radius = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        return np.clip(1 - radius, 0, 1) ** 1.4 * coverage

    layers = {
        "paint-valid": coverage,
        "lips": lips,
        "cheek-left": ellipse(0.070, 0.252, 0.029, 0.025),
        "cheek-right": ellipse(-0.070, 0.252, 0.029, 0.025),
        "eyelid-left": ellipse(0.052, 0.314, 0.035, 0.016),
        "eyelid-right": ellipse(-0.052, 0.314, 0.035, 0.016),
    }
    mask_dir = output / "masks"
    mask_dir.mkdir(exist_ok=True)
    for name, layer in layers.items():
        layer[:3, :] = 0
        layer[-3:, :] = 0
        layer[:, :3] = 0
        layer[:, -3:] = 0
        rgba = np.ones((size, size, 4), dtype=np.float32)
        rgba[:, :, :3] = layer[:, :, None]
        image_from_top_array(mask_dir / f"{name}.png", rgba, data=True)
    blank = np.zeros((size, size, 4), dtype=np.float32)
    image_from_top_array(output / "makeup-blank.png", blank)
    assert np.count_nonzero(lips > 0.5) > 100
    return {name: int(np.count_nonzero(layer > 0.5)) for name, layer in layers.items()}


def landmarks(face):
    points = {
        "lipsCenter": (0, 0.209),
        "lipsLeftCorner": (0.029, 0.210),
        "lipsRightCorner": (-0.029, 0.210),
        "cheekLeft": (0.070, 0.252),
        "cheekRight": (-0.070, 0.252),
        "upperLidLeft": (0.052, 0.314),
        "upperLidRight": (-0.052, 0.314),
        "forehead": (0, 0.370),
        "noseTip": (0, 0.250),
    }
    result = {}
    for name, (x, y) in points.items():
        hit, point, _, _ = face.ray_cast(Vector((x, -1, y)), Vector((0, 1, 0)))
        assert hit, f"Landmark missed the head: {name}"
        result[name] = {"position": [round(point.x, 6), round(point.z, 6), round(-point.y, 6)],
                        "paintUV": [round((x + 0.15) / 0.30, 6), round((0.445 - y) / 0.295, 6)]}
    result["eyeLeftCenter"] = {"position": [0.0468, 0.2933, 0.0887], "approximate": True}
    result["eyeRightCenter"] = {"position": [-0.0468, 0.2933, 0.0887], "approximate": True}
    return result


def preserve_notices(research, output):
    notice_dir = output.parent / "licenses"
    notice_dir.mkdir(parents=True, exist_ok=True)
    for name in ["CC-BY-4.0.txt", "Rain-embedded-readme.txt"]:
        shutil.copyfile(research / "licenses" / name, notice_dir / name)
    provenance = json.loads((research / "provenance.json").read_text())
    source = next(asset for asset in provenance["assets"] if asset["path"] == "assets/rain-v33.zip")
    source["distribution"] = "Portrait derivative under public/face/v1. No AI-generated artwork."
    source["sourceLocalPath"] = "tmp/asset-research/assets/rain-v33.zip"
    source["sourceBlendLocalPath"] = "tmp/asset-research/assets/Rain v3.3/rain_v3.2.blend"
    source["modifications"] = [
        "Evaluated neutral head, eyes, brows, lashes, hair, body and top. Removed rig, drivers and unsupported shaders.",
        "Shifted head UV tile 1003 into 0..1 and resized original color textures. Kept freckles and lip color in the immutable base.",
        "Cropped and lowered the shoulder silhouette. Matched 96 neck seam positions and normals.",
        "Slimmed brows, lowered the ponytail, added small fixed eye catchlights, and chose lavender fabric.",
        "Added a front-visible secondary paint UV and semantic masks. Rear and hidden polygons use a reserved transparent texel.",
        "Converted to opaque glTF PBR materials. Omitted refractive cornea, teeth, tongue, facial rig and expressions.",
        "Made optional hazel and olive iris recolors. Exported GLB in meters with +Y up and +Z forward.",
    ]
    (output.parent / "provenance.json").write_text(json.dumps(source, indent=2) + "\n")
    (output.parent / "CREDITS.txt").write_text(
        "Rain Rig (CC) Blender Foundation | studio.blender.org\n"
        "Source: https://studio.blender.org/characters/rain/\n"
        "License: Creative Commons Attribution 4.0 International.\n"
        "https://creativecommons.org/licenses/by/4.0/\n\n"
        "This Make1Up portrait is a modified Rain asset, not AI-generated art.\n"
        "The export, material conversion, crop, fitted seam, brow and ponytail edits,\n"
        "catchlights, iris recolors, paint UV, and masks were prepared for Make1Up.\n"
        "See provenance.json for the exact source and changes.\n"
        "Blender Foundation does not endorse this project.\n"
        "Keep this credit, license link, and change notice with redistributions.\n"
    )


def inspect_glb(path):
    raw = path.read_bytes()
    assert raw[:4] == b"glTF"
    length, = struct.unpack_from("<I", raw, 12)
    document = json.loads(raw[20:20 + length])
    meshes = {}
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        name = node["name"]
        mesh = document["meshes"][node["mesh"]]
        assert len(mesh["primitives"]) == 1
        primitive = mesh["primitives"][0]
        positions = document["accessors"][primitive["attributes"]["POSITION"]]
        indices = document["accessors"][primitive["indices"]]
        meshes[name] = {"role": MESH_ROLES[name], "vertices": positions["count"], "triangles": indices["count"] // 3,
                        "bounds": {"min": positions["min"], "max": positions["max"]},
                        "attributes": list(primitive["attributes"]),
                        "material": document["materials"][primitive["material"]]["name"]}
    assert set(meshes) == set(MESH_ROLES)
    assert "TEXCOORD_1" in meshes["Face"]["attributes"]
    assert meshes["Eye.L"]["bounds"]["min"][0] > 0
    assert meshes["Eye.R"]["bounds"]["max"][0] < 0
    return {"file": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "triangles": sum(mesh["triangles"] for mesh in meshes.values()), "meshes": meshes,
            "bounds": {"min": [min(mesh["bounds"]["min"][i] for mesh in meshes.values()) for i in range(3)],
                       "max": [max(mesh["bounds"]["max"][i] for mesh in meshes.values()) for i in range(3)]},
            "extensions": document.get("extensionsUsed", [])}


def render_portrait(output, samples, angle=0):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 768
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("Cream studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.50, 0.46, 0.57, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    target = Vector((0, 0, 0.277))
    angle = math.radians(angle)
    bpy.ops.object.camera_add(location=(1.7 * math.sin(angle), -1.7 * math.cos(angle), 0.277))
    camera = bpy.context.object
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 0.54
    scene.camera = camera
    added = [camera]
    lights = [((-0.35, -0.50, 0.72), 10, 0.48, (1, 0.90, 0.81)),
              ((0.38, -0.30, 0.43), 5, 0.45, (0.82, 0.83, 1)),
              ((0.15, 0.28, 0.58), 3, 0.32, (1, 0.88, 0.78))]
    for position, energy, size, color in lights:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy = energy
        light.data.size = size
        light.data.color = color
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
        added.append(light)
    backdrop = material("Lavender paper", (0.56, 0.49, 0.64), 1)
    shader = backdrop.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Color"].default_value = (0.48, 0.40, 0.57, 1)
    shader.inputs["Emission Strength"].default_value = 0.8
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0.70, 0), rotation=(math.pi / 2, 0, 0))
    assign_material(bpy.context.object, backdrop)
    added.append(bpy.context.object)
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    for obj in added:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    args = arguments()
    source = args.research_dir / "assets/Rain v3.3/rain_v3.2.blend"
    required = [source, args.research_dir / "provenance.json", args.research_dir / "licenses/CC-BY-4.0.txt",
                args.research_dir / "licenses/Rain-embedded-readme.txt"]
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(f"Required licensed source is missing: {path}")
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
    bpy.context.scene.render.use_simplify = False
    prepare_textures(source.parent / "textures", output)
    mats = {
        "Skin": material("Skin", (1, 1, 1), 0.56, output / "skin-base.png"),
        "BustSkin": material("BustSkin", (1, 1, 1), 0.56, output / "bust-base.png"),
        "EspressoHair": material("EspressoHair", (1, 1, 1), 0.58, output / "hair-espresso.png", 0.03),
        "IrisSclera": material("IrisSclera", (1, 1, 1), 0.22, output / "eyes-blue.png", 0.35),
        "BrowHair": material("BrowHair", (0.023, 0.012, 0.009), 0.72),
        "LashHair": material("LashHair", (0.009, 0.006, 0.008), 0.55),
        "LavenderFabric": material("LavenderFabric", (0.29, 0.23, 0.36), 0.78),
    }
    objects = []
    for source_name, name, mat_name, subdiv in SOURCE_MESHES:
        obj = evaluated_copy(bpy.data.objects["GEO-rain-" + source_name], name, subdiv)
        assign_material(obj, mats[mat_name])
        if name == "Face":
            for uv in obj.data.uv_layers[0].data:
                uv.uv.x -= 2
        if name in ["Bust", "Top"]:
            crop_bust(obj)
        if name == "HairTail":
            turn = Matrix.Rotation(math.radians(-78), 4, "X")
            anchor = Vector((0, 0.095, 0.405))
            for vertex in obj.data.vertices:
                local = vertex.co - anchor
                local.y *= 0.82
                vertex.co = anchor + turn @ local
        if name == "Brows":
            points = np.array([tuple(v.co) for v in obj.data.vertices])
            for vertex in obj.data.vertices:
                near = points[np.abs(points[:, 0] - vertex.co.x) < 0.0025, 2]
                middle = (near.min() + near.max()) / 2
                vertex.co.z = middle + (vertex.co.z - middle) * 0.65
        objects.append(obj)
    face = next(obj for obj in objects if obj.name == "Face")
    bust = next(obj for obj in objects if obj.name == "Bust")
    seam = fit_neck(face, bust)
    eyes = next(obj for obj in objects if obj.name == "Eyes")
    objects.remove(eyes)
    eye_parts = split_eyes(eyes)
    objects.extend(eye_parts)
    objects.append(catchlights(eye_parts))
    for obj in list(bpy.data.objects):
        if obj not in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    eligible = paint_uv(face)
    mask_counts = masks(face, eligible, output, args.mask_size)
    points = landmarks(face)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = face
    path = output / "head.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_extras=False, export_texcoords=True, export_yup=True)
    actual = inspect_glb(path)
    preserve_notices(args.research_dir, output)
    contract = {
        "id": "rain-portrait-v1", "version": 1, "status": "browser integration candidate",
        "source": "Blender Studio Rain v3.3 download, rain_v3.2.blend",
        "license": "CC-BY-4.0", "credit": "Rain Rig (CC) Blender Foundation | studio.blender.org",
        "creditFile": "../CREDITS.txt", "provenanceFile": "../provenance.json", "aiGenerated": False,
        "units": "meters", "up": "+Y", "front": "+Z", "right": "+X is viewer right and subject left",
        "nodeTransforms": "Identity. Positions and bounds below are GLB coordinates, not Blender Z-up coordinates.",
        **actual,
        "camera": {"type": "orthographic", "position": [0, 0.277, 1.7], "target": [0, 0.277, 0],
                   "verticalSpan": 0.54, "recommendedYawDegrees": [-28, 28], "recommendedPitchDegrees": [-12, 12]},
        "paint": {
            "mesh": "Face", "baseAttribute": "uv / TEXCOORD_0", "paintAttribute": "uv1 / TEXCOORD_1",
            "blenderLayer": "MakeupFrontUV", "projection": PROJECTION,
            "formula": "u=(localX+0.15)/0.30; v=(0.445-localY)/0.295 on eligible polygons",
            "convention": "Exported GLB v increases downward. Three.js canvas textures must use flipY=false. Canvas pixel=(u*width,v*height).",
            "eligibility": "Only front-visible head polygons in the portrait area receive projected UVs. Rear, hidden and out-of-range polygons have constant exported UV (0,0).",
            "sentinel": [0, 0], "reservedBorderPixels": 3,
            "rearProtection": "Keep the paint texture border transparent. Multiply paint alpha by masks/paint-valid.png sampled with uv1. Never regenerate UVs from every vertex position without eligibility.",
            "layers": "Composite makeup after base color sampling. Never draw into skin-base.png or replace TEXCOORD_0.",
            "finish": "Use a separate roughness/finish blend for gloss. Base roughness is 0.56; color alone is not gloss.",
            "maskChannel": "red", "maskColorSpace": "NoColorSpace", "textureSize": args.mask_size,
            "masks": {name: f"masks/{name}.png" for name in mask_counts},
            "maskPixelsAboveHalf": mask_counts, "eligiblePolygons": len(eligible),
            "maskLimits": "Lip mask follows the source color border. Cheek and eyelid masks are soft portrait guides, not anatomical segmentation. There are no expression variants.",
        },
        "landmarks": points, "landmarkConvention": "Approximate neutral-pose guides. Left and right are the subject's sides.",
        "eyeMaterials": {"meshes": ["Eye.L", "Eye.R"], "material": "IrisSclera", "baseMap": "eyes-blue.png",
                         "roughness": 0.22, "clearcoat": 0.35, "opaque": True,
                         "note": "Iris, pupil and sclera share the original eye atlas. Refractive cornea is intentionally omitted. EyeHighlights are fixed neutral-gaze geometry."},
        "supportedVariants": {
            "geometry": ["neutral-rain-portrait"], "expressions": [],
            "eyes": [{"id": name, "texture": f"eyes-{name}.png"} for name in ["blue", "hazel", "olive"]],
            "hair": ["fitted-espresso-ponytail"], "skin": ["source-warm-complexion"],
            "note": "The iris recolors retain the pupil, sclera and iris fibers. No independent facial identities or tested skin-depth variants are supplied.",
        },
        "verification": {"neckSeam": seam, "glbStructure": "checked", "bothEyeBounds": "checked",
                         "rearPolygonsMappedToSentinel": "checked before export", "reimport": "checked below"},
        "limitations": [
            "Not a photorealistic face or a Facecard asset. This is a licensed stylized Rain derivative.",
            "No morph targets, blink, gaze controls, facial expressions, teeth or tongue are exported.",
            "Portrait framing is required. The cropped bust is open underneath and at the arm ends.",
            "The secondary paint UV is a frontal projection. Extreme profile painting and new expressions need new validation.",
            "Base skin includes authored freckles and natural lip color. Makeup removal restores this base.",
            "Mobile load time, memory, frame rate, browser lighting parity and touch painting are not verified by Blender renders.",
            "The GLB embeds base textures. External copies are provided for inspection and texture changes; do not load duplicate copies unnecessarily.",
        ],
        "rerun": "blender --background --factory-startup --disable-autoexec --threads 4 --python-exit-code 1 --python scripts/prepare-face.py -- --render-dir tmp/art-probe/final",
    }
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    loaded = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    assert set(loaded) == set(MESH_ROLES)
    assert len(loaded["Face"].data.uv_layers) == 2
    for name in ["Eye.L", "Eye.R"]:
        assert len(loaded[name].data.vertices) > 1000
        assert loaded[name].data.materials[0].node_tree.nodes.get("Principled BSDF")
    contract["verification"]["reimport"] = "Blender reimport passed for all 12 named meshes and both face UV sets"
    (output / "asset.json").write_text(json.dumps(contract, indent=2) + "\n")
    if args.render_dir:
        args.render_dir.mkdir(parents=True, exist_ok=True)
        render_portrait(args.render_dir / "reimport-front.png", args.samples)
        render_portrait(args.render_dir / "reimport-three-quarter.png", args.samples, 28)
    print(json.dumps({"asset": str(path), "bytes": actual["bytes"], "triangles": actual["triangles"],
                      "meshes": list(actual["meshes"]), "paintPolygons": len(eligible), "masks": mask_counts}))


if __name__ == "__main__":
    main()
