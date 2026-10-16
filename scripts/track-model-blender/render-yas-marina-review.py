#!/usr/bin/env python3
"""Render source-aligned control zones from the saved Yas Marina Blender scene."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

spec=importlib.util.spec_from_file_location("yas-marina",Path(__file__).with_name("build-yas-marina-digital-twin.py"))
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
parser=argparse.ArgumentParser()
parser.add_argument("--blend",default=".track-model-build/yas-marina.blend")
parser.add_argument("--input",default=".track-model-build/yas-marina.json")
parser.add_argument("--output",default="docs/track-model-yas-marina-review")
parser.add_argument("--only",help="Comma-separated control view names")
parser.add_argument("--corners",action="store_true",help="Render all 17 apexes from above")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
config=json.loads(Path(args.input).read_text())
bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
scene=bpy.context.scene
scene.render.resolution_x,scene.render.resolution_y=1200,800
scene.render.image_settings.file_format="WEBP";scene.render.image_settings.quality=90
camera=scene.camera;camera.data.type="ORTHO";camera.data.clip_end=10000
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)

def feature_center(identifier,height):
    polygon=next(f for f in config["vectors"] if f["id"]==identifier)["world"][:-1]
    return Vector((sum(p[0] for p in polygon)/len(polygon)-config["model"]["center"]["x"],
                   sum(p[1] for p in polygon)/len(polygon)-config["model"]["center"]["y"],height))

line=config["model"]["centerline"]
cumulative,total=model.base.line_distance(line)
views=[("overview",Vector((0,0,8)),Vector((1200,-1700,2400)),2700),
       ("pit",feature_center(133907082,8),Vector((260,-340,330)),620),
       ("hotel",feature_center(1228229328,16),Vector((180,-230,190)),400),
       ("top",Vector((0,0,8)),Vector((0,0,3000)),3100)]
views.append(("north-grandstand-front",Vector((62,842.5,13)),Vector((-20,-300,170)),290))
for name,number,scale in [("turn-1",1,320),("north-grandstand",5,420),("west-grandstand",6,330),("south-grandstand",9,400),("marina-grandstand",12,360),("turn-16",16,330)]:
    point=model.base.sample_polyline(line,cumulative,config["model"]["turns"][number-1]["distanceMeters"])
    target=Vector((*model.base.local_xy(point,config["model"]["center"]),8))
    views.append((name,target,Vector((150,-220,280)),scale))
for name,target,offset,scale in views:
    if args.only and name not in args.only.split(","):continue
    camera.data.ortho_scale=scale;camera.location=target+offset
    model.base.look_at(camera,target)
    scene.render.filepath=str((output/f"{name}.webp").resolve())
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Yas Marina control zone: {name}",flush=True)
