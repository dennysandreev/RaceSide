#!/usr/bin/env python3
"""Render source-aligned control zones from the saved Suzuka Blender scene."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

spec=importlib.util.spec_from_file_location("suzuka",Path(__file__).with_name("build-suzuka-digital-twin.py"))
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
parser=argparse.ArgumentParser()
parser.add_argument("--blend",default=".track-model-build/suzuka.blend")
parser.add_argument("--input",default=".track-model-build/suzuka.json")
parser.add_argument("--output",default="docs/track-model-suzuka-review")
parser.add_argument("--only",help="Comma-separated control view names")
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
crossing=model.base.sample_polyline(line,cumulative,config["bridge"]["upperDistanceMeters"])
bridge=Vector((*model.base.local_xy(crossing,config["model"]["center"]),45))
hairpin=model.base.sample_polyline(line,cumulative,config["model"]["turns"][10]["distanceMeters"])
hairpin=Vector((*model.base.local_xy(hairpin,config["model"]["center"]),45))
views=[("overview",Vector((0,0,40)),Vector((900,-1400,1800)),2800),
       ("pit",feature_center(184422099,35),Vector((-300,-380,350)),670),
       ("bridge",bridge,Vector((-120,-155,100)),180),
       ("hairpin",hairpin,Vector((150,-160,180)),470),
       ("wheel",feature_center(184107083,70),Vector((-85,-115,80)),135)]
views.append(("top",Vector((0,0,40)),Vector((0,0,2400)),2800))
for name,index,scale in [("turn-1",0,500),("dunlop",6,550),("spoon",12,550),("chicane",15,530)]:
    point=model.base.sample_polyline(line,cumulative,config["model"]["turns"][index]["distanceMeters"])
    target=Vector((*model.base.local_xy(point,config["model"]["center"]),45))
    views.append((name,target,Vector((130,-180,220)),scale))
metadata=json.loads(Path("public/f1/tracks/3d/suzuka-metadata.json").read_text())
for name,select in [("highest",max),("lowest",min)]:
    sample=select(metadata["elevationProfile"],key=lambda point:point["elevationMeters"])
    point=model.base.sample_polyline(line,cumulative,sample["distanceMeters"])
    target=Vector((*model.base.local_xy(point,config["model"]["center"]),sample["elevationMeters"]))
    views.append((name,target,Vector((100,-140,180)),420))
for name,target,offset,scale in views:
    if args.only and name not in args.only.split(","):continue
    camera.data.ortho_scale=scale;camera.location=target+offset
    model.base.look_at(camera,target)
    scene.render.filepath=str((output/f"{name}.webp").resolve())
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Suzuka control zone: {name}",flush=True)
