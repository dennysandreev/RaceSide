#!/usr/bin/env python3
"""Render geographic control views from the saved, textured Interlagos scene."""
import importlib.util
import json
from pathlib import Path

import bpy
from mathutils import Vector

spec = importlib.util.spec_from_file_location("interlagos", Path(__file__).with_name("build-interlagos-digital-twin.py"))
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
config = json.loads(Path(".track-model-build/interlagos.json").read_text())
metadata = json.loads(Path("public/f1/tracks/3d/interlagos-metadata.json").read_text())
bpy.ops.wm.open_mainfile(filepath=str(Path(".track-model-build/interlagos.blend").resolve()))
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.quality = 90
camera = scene.camera
camera.data.type = "ORTHO"
camera.data.clip_end = 10000
output = Path("docs/track-model-interlagos-review")
output.mkdir(parents=True, exist_ok=True)
line = config["model"]["centerline"]
cumulative, total = model.base.line_distance(line)


def target(distance):
    p = model.base.sample_polyline(line, cumulative, distance)
    profile = metadata["elevationProfile"]
    height = min(profile, key=lambda sample: abs(sample["distanceMeters"]-distance))["elevationMeters"]
    return Vector((*model.base.local_xy(p, config["model"]["center"]), height))


views = [("top", Vector((0, 0, 760)), Vector((0, 0, 2200)), 2050),
         ("overview", Vector((0, 0, 760)), Vector((600, -1000, 1500)), 2000),
         ("pit", target(total-180), Vector((130, -170, 260)), 460),
         ("main-grandstands", target(total-150), Vector((-120, -100, 200)), 430)]
for name, index, scale in [("senna-s", 0, 320), ("descent", 3, 390),
                           ("infield", 8, 520), ("bico-de-pato", 9, 210), ("juncao", 11, 380)]:
    views.append((name, target(config["model"]["turns"][index]["distanceMeters"]), Vector((100, -140, 200)), scale))
for name, select in [("highest", max), ("lowest", min)]:
    sample = select(metadata["elevationProfile"], key=lambda point: point["elevationMeters"])
    views.append((name, target(sample["distanceMeters"]), Vector((100, -140, 180)), 360))
for name, point, offset, scale in views:
    camera.data.ortho_scale = scale
    camera.location = point+offset
    model.base.look_at(camera, point)
    scene.render.filepath = str((output/f"{name}.webp").resolve())
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Interlagos control view: {name}", flush=True)
