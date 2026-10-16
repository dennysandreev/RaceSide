#!/usr/bin/env python3
"""Render source-aligned control zones from the saved Las Vegas Blender scene."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

spec=importlib.util.spec_from_file_location("las-vegas",Path(__file__).with_name("build-las-vegas-digital-twin.py"))
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
parser=argparse.ArgumentParser()
parser.add_argument("--blend",default=".track-model-build/las-vegas.blend")
parser.add_argument("--input",default=".track-model-build/las-vegas.json")
parser.add_argument("--output",default="docs/track-model-las-vegas-review")
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
views=[("overview",Vector((0,0,635)),Vector((1600,-2200,2200)),3500),
       ("pit",feature_center(1198427833,645),Vector((380,-500,500)),650),
       ("sphere",feature_center(976405284,660),Vector((500,-400,400)),850),
       ("strip",Vector((-500,0,660)),Vector((-700,-1200,1100)),2300),
       ("facades",feature_center(27727145,690),Vector((220,-180,140)),330),
       ("guitar-tower",feature_center(1468774558,700),Vector((260,-180,180)),380),
       ("top",Vector((0,0,635)),Vector((0,0,3000)),4400)]
for name,index,scale in [("turn-1",0,500),("sphere-chicane",6,550),("strip-chicane",13,650),("turn-17",16,530)]:
    point=model.base.sample_polyline(line,cumulative,config["model"]["turns"][index]["distanceMeters"])
    target=Vector((*model.base.local_xy(point,config["model"]["center"]),635))
    views.append((name,target,Vector((220,-280,400)),scale))
if args.corners:
    views=[]
    road=bpy.data.objects['LasVegas_Raceway']
    for turn in config['model']['turns']:
        point=model.base.sample_polyline(line,cumulative,turn['distanceMeters'])
        x,y=model.base.local_xy(point,config['model']['center'])
        nearest=min(road.data.vertices,key=lambda v:(v.co.x-x)**2+(v.co.y-y)**2)
        views.append((f"apex-{turn['number']:02d}",Vector((x,y,nearest.co.z)),Vector((0,0,160)),120))
for name,target,offset,scale in views:
    if args.only and name not in args.only.split(","):continue
    camera.data.ortho_scale=scale;camera.location=target+offset
    model.base.look_at(camera,target)
    scene.render.filepath=str((output/f"{name}.webp").resolve())
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Las Vegas control zone: {name}",flush=True)
