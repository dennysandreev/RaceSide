#!/usr/bin/env python3
"""Build AlbertPark from its own pinned Planet/Vicmap/OSM/FIA sources, with embedded textures on all physical meshes."""

from bisect import bisect_right
import importlib.util
import json
import math
from pathlib import Path
import random

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
# Reuse the established mesh, material, UV and Meshopt helpers. No Mexico data.
spec = importlib.util.spec_from_file_location("albert_park_mesh_tools", SCRIPTS / "build-mexico-digital-twin.py")
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)
base = tools.base
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 128, 145
base.PIT_LANE_WIDTH_METERS = 8
tools.COPYRIGHT = ("RaceSide Albert Park model and preview: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/. "
    "Contains modified Planet Labs Inc. SkySat imagery acquired 22 March 2018, georegistered, cropped, sampled and rendered. "
    "https://commons.wikimedia.org/wiki/File:Melbourne_Grand_Prix_Circuit,_March_22,_2018_SkySat.jpg. "
    "Geographic data © OpenStreetMap contributors, ODbL 1.0. Vicmap elevation © State of Victoria, CC BY 4.0. "
    "FIA and Australian Grand Prix organizer maps: reference only. Site software is separately licensed.")


def road_section(points, cumulative, distance, raster, datum, width, z_offset=.45, closed=True, banked=False):
    point = base.sample_polyline(points, cumulative, distance, closed=closed)
    tangent = base.sample_tangent(points, cumulative, distance, closed=closed)
    profile = raster.profiles[0 if closed else 1]
    d = distance % cumulative[-1] if closed else min(max(distance, 0), cumulative[-1])
    steps, values = profile["distanceMeters"], profile["elevationMeters"]
    i = min(max(bisect_right(steps,d)-1,0),len(steps)-2)
    t = (d-steps[i])/max(steps[i+1]-steps[i],1e-9)
    return point, tangent, Vector((-tangent.y,tangent.x)), values[i]*(1-t)+values[i+1]*t-datum+z_offset, 0


base.road_cross_section = road_section


def nearest_distance(line, cum, point):
    best = (math.inf,0)
    for i,(a,b) in enumerate(zip(line,line[1:])):
        dx,dy=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/max(dx*dx+dy*dy,1e-9)))
        gap=math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)
        if gap<best[0]:best=(gap,cum[i]+t*(cum[i+1]-cum[i]))
    return best[1]


def texture(name, kind="grain"):
    rng = random.Random(1962)
    size=128
    image=bpy.data.images.new(name,width=size,height=size)
    pixels=[]
    for y in range(size):
        for x in range(size):
            value=.90+rng.random()*.10
            if kind=="facade":
                if 8<x%32<28 and 20<y%64<46:value=.30+rng.random()*.08
                elif x%32<2 or y%64<2:value=.70
            elif kind=="metal" and y%16<2:value=.78
            pixels.extend((value,value,value,1))
    image.colorspace_settings.name="sRGB"
    image.pixels[:]=pixels
    image.pack()
    return image


def fence_material():
    image=bpy.data.images.new("AlbertPark_Chain_Link_RGBA",width=128,height=128,alpha=True)
    pixels=[]
    for y in range(128):
        for x in range(128):
            wire=(x+y)%16<2 or (x-y)%16<2
            pixels.extend((.58,.60,.59,.88 if wire else 0))
    image.pixels[:]=pixels;image.update();image.pack()
    material=base.create_material("AlbertPark_Chain_Link_Fence",(1,1,1,1),.86)
    node=material.node_tree.nodes.new("ShaderNodeTexImage");node.image=image
    bsdf=material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(node.outputs["Color"],bsdf.inputs["Base Color"])
    material.node_tree.links.new(node.outputs["Alpha"],bsdf.inputs["Alpha"])
    material.surface_render_method="DITHERED";material.use_transparency_overlap=False
    return material


def export_precise_heights(path):
    # Component exponents retain millimetre height precision even when X/Z
    # span kilometres. Shared exponents rounded low-relief road Y to 8 mm,
    # producing a false steep grade on a narrow inside-corner triangle.
    from io_scene_gltf2.io.exp import meshopt
    original=meshopt.MeshoptEncoder.encode_attribute
    def independent(name,data,stride,settings):
        mode=meshopt.ENCODE_EXP_SHARED_VECTOR
        try:
            if name=="POSITION":
                meshopt.ENCODE_EXP_SHARED_VECTOR=meshopt.ENCODE_EXP_SHARED_COMPONENT
            return original(name,data,stride,settings)
        finally:
            meshopt.ENCODE_EXP_SHARED_VECTOR=mode
    meshopt.MeshoptEncoder.encode_attribute=staticmethod(independent)
    try:
        tools.export(path)
    finally:
        meshopt.MeshoptEncoder.encode_attribute=staticmethod(original)


class AlbertParkScene:
    def __init__(self, config, raster, collections, materials, aerial):
        self.config,self.raster,self.c,self.m=config,raster,collections,materials
        self.aerial=aerial
        self.center=config["model"]["center"]
        self.line,self.pit=config["model"]["centerline"],config["model"]["pitCenterline"]
        self.cum,self.total=base.line_distance(self.line)
        self.pc,self.pt=base.line_distance(self.pit)
        self.features=config["vectors"]
        self.corridors=[(base.sample_line_points(self.line,self.cum,3),7),
                        (base.sample_line_points(self.pit,self.pc,3,closed=False),4.5)]
        self.reserved=[f["world"] for f in self.features if f["tags"].get("grandstand")=="yes"]
        self.paint=base.MeshBuilder()
        self.props=base.MeshBuilder()

    def xy(self,p):return base.local_xy(p,self.center)

    def ground(self,p):return self.raster.sample(*p)

    def source_color(self,p):
        bounds=self.config["model"]["bounds"]
        x=(p[0]-bounds["minX"])/(bounds["maxX"]-bounds["minX"])
        y=(p[1]-bounds["minY"])/(bounds["maxY"]-bounds["minY"])
        ix=max(0,min(self.aerial.size[0]-1,round(x*(self.aerial.size[0]-1))))
        iy=max(0,min(self.aerial.size[1]-1,round(y*(self.aerial.size[1]-1))))
        i=(iy*self.aerial.size[0]+ix)*4
        # Byte-image pixels are sRGB values. SourceMesh performs the single
        # required sRGB-to-linear conversion for vertex colors.
        return tuple(max(.02,min(.96,v)) for v in self.aerial.pixels[i:i+3])+(1,)

    def surface(self,d,offset=0,pit=False,lift=.45):
        line,cum,width=(self.pit,self.pc,8) if pit else (self.line,self.cum,12)
        return base.road_surface_point(line,cum,d,offset,self.raster,self.center,0,width,
                                       z_offset=lift,closed=not pit)

    def strip(self,builder,start,end,left,right,material=0,pit=False,lift=.62):
        builder.add_quad([self.surface(d,o,pit,lift) for d,o in
                          ((start,left),(end,left),(end,right),(start,right))],material)

    def terrain(self):
        bounds=self.config["model"]["bounds"]
        obj=base.add_terrain(bounds,self.center,self.raster,0,self.m["terrain"],self.c["Terrain"])
        obj.name="AlbertPark_Terrain"
        obj.data.name="AlbertPark_Terrain_Mesh"
        bvh=BVHTree.FromPolygons([v.co for v in obj.data.vertices],[tuple(p.vertices)for p in obj.data.polygons])
        def height(x,y):
            hit,*_=bvh.ray_cast(Vector((x-self.center["x"],y-self.center["y"],1000)),Vector((0,0,-1)))
            return hit.z if hit is not None else self.raster.sample(x,y)
        self.raster.sample_rendered_terrain=height

    def road(self):
        obj,_,_,samples=base.create_ribbon("AlbertPark_Raceway",self.line,self.raster,self.center,0,12,
            self.m["asphalt"],self.c["Circuit"],interval=2,z_offset=.45)
        # The shared helper samples the closing end 1 µm before the control
        # line. Close the physical seam exactly so paint at distance zero has
        # road support even when the source tail and head tangents differ.
        for side in range(2):obj.data.vertices[-2+side].co=obj.data.vertices[side].co
        obj.data.update()
        obj["source"]="Organizer corridor and reviewed native T11–T14 axes; FIA 2026; no rescaling; Vicmap contour-TIN road profile"
        for first,second in zip(samples,samples[1:]):
            for side in (-1,1):self.strip(self.paint,first[0],second[0],side*5.40,side*5.58,lift=.65)
        kerbs=base.MeshBuilder()
        curb_ranges=[]
        for turn in self.config["model"]["turns"]:
            d=turn["distanceMeters"]
            a,b=base.sample_tangent(self.line,self.cum,d-18),base.sample_tangent(self.line,self.cum,d+18)
            side=1 if a.x*b.y-a.y*b.x>0 else -1
            span=42 if turn["number"] in (1,2,7,13,14,15) else 25
            curb_ranges.append({"turn":turn["number"],"startMeters":d-span,"endMeters":d+span,"side":side})
            for i in range(math.ceil(span*2/2)):
                start=d-span+i*2
                self.strip(kerbs,start,min(start+2,d+span),side*6,side*6.95,i%2,lift=.60)
        kerbs.create_object("AlbertPark_Kerbs",[self.m["red"],self.m["yellow"]],self.c["Circuit"])
        # FIA 2026 competition notes: T6 exit gravel strip and T10 left apron
        # were replaced with turf. Widths are reconstructed, not surveyed.
        turf=base.MeshBuilder()
        for number,span in ((6,78),(10,65)):
            start=self.config["model"]["turns"][number-1]["distanceMeters"]+12
            for distance in range(math.floor(start),math.floor(start+span),2):
                turf.add_quad([self.surface(d,o,lift=.57) for d,o in
                    ((distance,7),(distance+2,7),(distance+2,9.5),(distance,9.5))],color=(.22,.36,.13,1))
        turf.create_object("AlbertPark_2026_Turf_Strips",[self.m["vertex"]],self.c["Circuit"],vertex_colors=True)
        return samples,curb_ranges

    def pit_lane(self):
        _,_,_,samples=base.create_ribbon("AlbertPark_Pit_Lane",self.pit,self.raster,self.center,0,8,
            self.m["asphalt"],self.c["Circuit"],interval=2,closed=False,taper_meters=35,
            minimum_start_width=3,minimum_end_width=3,z_offset=.45)
        buildings=[f for f in self.features if "Pit Building" in f["tags"].get("addr:unit","")]
        distances=[nearest_distance(self.pit,self.pc,p) for f in buildings for p in f["world"]]
        first,last=min(distances)+3,max(distances)-3
        for i in range(45):
            d=first+(last-first)*i/44
            self.strip(self.paint,d,d+.16,-3.8,-1.1,pit=True,lift=.59)
        for d in range(math.ceil(first),math.floor(last),3):
            self.strip(self.paint,d,min(d+2,last),-1.2,-1.36,pit=True,lift=.59)
        wall,quality=base.create_pit_wall(self.pit,self.line,self.raster,self.center,0,
            [self.m["concrete"],self.m["fence"]],self.c["Circuit"],start_ratio=(first-10)/self.pt,
            end_ratio=(last+15)/self.pt,wall_height=.9,fence_height=2.05)
        wall.name="AlbertPark_Pit_Wall";wall.data.name="AlbertPark_Pit_Wall_Mesh"
        wall["source"]="FIA 2026 pit drawing; OSM pit geometry; structural height estimated"
        # 41 numbered + A-D lettered positions, including FIA/FOM and gaps.
        teams=[(.90,.43,.04,1),(.03,.35,.34,1),(.035,.10,.22,1),(.72,.025,.03,1),
               (.07,.21,.64,1),(.15,.28,.64,1),(.03,.28,.20,1),(.80,.81,.78,1),
               (.62,.04,.06,1),(.05,.19,.31,1),(.12,.12,.12,1)]
        team_ranges=[(4,7),(8,12),(12,15),(15,18),(19,22),(22,25),(25,29),(29,32),(32,34),(34,37),(38,41)]
        for i in range(45):
            d=first+(last-first)*(i+.5)/45;p=self.surface(d,-7.5,True)
            tangent=base.sample_tangent(self.pit,self.pc,d,closed=False)
            along=Vector((tangent.x,tangent.y,0))*(last-first)/45*.46
            team=next((teams[j]for j,(a,b)in enumerate(team_ranges)if a<=i<b),(.72,.73,.72,1))
            for lower,upper,color in [(0,3.1,(.20,.21,.21,1)),(3.1,3.7,team)]:
                self.props.add_quad([Vector(p)-along+Vector((0,0,lower)),Vector(p)+along+Vector((0,0,lower)),
                    Vector(p)+along+Vector((0,0,upper)),Vector(p)-along+Vector((0,0,upper))],color=color)
        return {"pitGarageBoxes":45,"numberedBoxes":41,"letteredBoxes":4,"frontageDistancesMeters":[first,last],
                "wall":quality,"entryGapMeters":base.distance_to_polyline(self.pit[0],self.line),
                "exitGapMeters":base.distance_to_polyline(self.pit[-1],self.line),
                "surfaceClearance":base.measure_ribbon_terrain_clearance(samples,self.raster,0)}

    def grandstands(self):
        builder,roofs=base.MeshBuilder(),base.MeshBuilder()
        seat_rows,seat_uvs=base.MeshBuilder(),[]
        rendered,excluded=[],[]
        for f in self.features:
            if f["tags"].get("grandstand")!="yes":continue
            polygon=f["world"][:-1] if f["world"][0]==f["world"][-1] else f["world"]
            if any(base.minimum_polygon_track_clearance(polygon,path,width)<.2 for path,width in self.corridors):
                excluded.append({"id":f["id"],"reason":"mapped stand intersects track/pit corridor"})
                continue
            edges=sorted(zip(polygon,polygon[1:]+polygon[:1]),key=lambda ab:math.dist(*ab),reverse=True)
            axis=(Vector(edges[0][1])-Vector(edges[0][0])).normalized()
            normal=Vector((-axis.y,axis.x))
            uv=[(Vector(p).dot(axis),Vector(p).dot(normal))for p in polygon]
            lo,hi=min(u for u,v in uv),max(u for u,v in uv)
            front,rear=min(v for u,v in uv),max(v for u,v in uv)
            if base.distance_to_polyline(axis*((lo+hi)/2)+normal*front,self.line)>base.distance_to_polyline(axis*((lo+hi)/2)+normal*rear,self.line):front,rear=rear,front
            depth=abs(front-rear)
            main=f["tags"].get("covered")=="yes"
            rows=min(30,max(4,round(depth/.85)))
            sections=max(1,math.ceil((hi-lo)/12))
            count,seats=0,0
            for section in range(sections):
                left,right=lo+(hi-lo)*section/sections+.10,lo+(hi-lo)*(section+1)/sections-.10
                middle=(left+right)/2
                local_polygon=uv
                for lower,upper in tools.polygon_scanline_spans(local_polygon,middle):
                    near,far=(lower,upper) if front<rear else (upper,lower)
                    local_rows=max(3,min(rows,round(abs(far-near)/.85)))
                    frontpoint=axis*middle+normal*near
                    ground=self.ground(frontpoint)
                    base_height=1.8 if main else .5
                    for row in range(local_rows):
                        a=near+(far-near)*row/local_rows
                        b=near+(far-near)*(row+1)/local_rows
                        ring=[axis*u+normal*v for u,v in ((left,a),(right,a),(right,b),(left,b))]
                        if not all(base.point_in_polygon(p,polygon) or base.distance_point_polygon(p,polygon)<.12 for p in ring):continue
                        z=max(ground+base_height+row*.43,max(self.ground(p)for p in ring)+.2)
                        color=(.21,.38,.61,1)
                        structural=(.60,.62,.61,1)
                        builder.add_quad([(*self.xy(p),z)for p in ring],color=structural)
                        builder.add_quad([(*self.xy(ring[0]),z-.43),(*self.xy(ring[1]),z-.43),
                                          (*self.xy(ring[1]),z),(*self.xy(ring[0]),z)],color=structural)
                        # Seating follows sampled row colors. Covered V2 seats use
                        # the pale blue/gray permanent seats visible in official photos.
                        if main:color=(.20,.34,.54,1)
                        n=max(2,round((right-left)/.68))
                        p=axis*left+normal*((a+b)/2)
                        q=axis*right+normal*((a+b)/2)
                        fore=normal*.19
                        corners=[p-fore,q-fore,q+fore,p+fore]
                        seat_rows.add_quad([(*self.xy(v),z+.13)for v in corners],color=color)
                        seat_rows.add_quad([(*self.xy(v),zz)for v,zz in
                                          ((corners[2],z+.13),(corners[3],z+.13),(corners[3],z+.50),(corners[2],z+.50))],color=color)
                        for _ in range(2):
                            seat_uvs.extend(((0,0),(n,0),(n,1),(0,0),(n,1),(0,1)))
                        seats+=n
                        count+=1
                    for u in (left+.3,right-.3):
                        for v in (near+.15*(far-near),far):
                            p=axis*u+normal*v
                            high=ground+base_height+(local_rows*.43)*(v-near)/max(abs(far-near),.1)*(1 if far>near else -1)
                            low=self.ground(p)
                            if high>low:builder.add_box((*self.xy(p),(low+high)/2),(.35,.35,high-low),color=(.52,.55,.54,1))
                    if main:
                        for band in range(4):
                            a=near+(far-near)*band/4
                            b=near+(far-near)*(band+1)/4
                            points=[axis*u+normal*v for u,v in ((left,a),(right,a),(right,b),(left,b))]
                            height=ground+base_height+local_rows*.43+3.5
                            if not all(base.point_in_polygon(p,polygon) or base.distance_point_polygon(p,polygon)<.12 for p in points):continue
                            roofs.add_quad([(*self.xy(p),height+(.4 if band in (1,2)else 0))for p in points])
                        for v in (far,near):
                            p=axis*middle+normal*v
                            tools.beam(builder,(*self.xy(p),ground+base_height),(*self.xy(p),height),.17,(.65,.66,.64,1))
            rendered.append({"osmWayId":f["id"],"name":f["tags"].get("name"),"footprint":polygon,
                "rowsBuilt":count,"seatsBuilt":seats,"covered":main,
                "clearanceAdjustment":f.get("clearanceAdjustment"),
                "minimumTrackClearanceMeters":base.minimum_polygon_track_clearance(polygon,self.corridors[0][0],6)})
        builder.create_object("AlbertPark_Grandstands",[self.m["vertex"]],self.c["Grandstands"],vertex_colors=True)
        seats=seat_rows.create_object("AlbertPark_Textured_Seat_Rows",[self.m["seats"]],self.c["Grandstands"],vertex_colors=True)
        uv=seats.data.uv_layers.new(name="SeatShellUV")
        for loop,coordinate in zip(seats.data.loops,seat_uvs):uv.data[loop.index].uv=coordinate
        roof=roofs.create_object("AlbertPark_Main_Grandstand_Roof",[self.m["canopy"]],self.c["Grandstands"])
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,
                "seatColorMethod":"blue plastic shells and galvanized frames, FIA 2026 pit photos; neutral canvas canopy; approximate row layout"}

    def buildings(self):
        walls,roofs=base.MeshBuilder(),base.MeshBuilder()
        rendered,excluded=[],[]
        for f in self.features:
            tags=f["tags"]
            if not tags.get("building") or tags.get("grandstand")=="yes":continue
            polygon=f["world"][:-1] if f["world"][0]==f["world"][-1] else f["world"]
            if len(polygon)<3:continue
            if base.polygon_intersects_corridors(polygon,self.corridors) or any(base.polygons_overlap(polygon,r)for r in self.reserved):
                excluded.append({"id":f["id"],"reason":"track, pit or reserved grandstand overlap"})
                continue
            pit="Pit Building" in tags.get("addr:unit","")
            try:height=float(tags.get("height",float(tags.get("building:levels",2))*3.1))
            except ValueError:height=6.2
            if pit:height=6.2
            low=max(self.ground(p)for p in polygon)
            color=self.source_color(polygon[0])
            facade=(.78,.78,.75,1) if pit or tags.get("building")=="event_hospitality" else tuple(max(.18,min(.84,v*.78+.12))for v in color[:3])+(1,)
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                walls.add_quad([(*self.xy(a),self.ground(a)),(*self.xy(b),self.ground(b)),
                                (*self.xy(b),low+height),(*self.xy(a),low+height)],color=facade)
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p),low+height))for p in polygon]]):
                if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:triangle=list(reversed(triangle))
                roofs.add_triangle(triangle,material_index=1 if tags.get("building")=="event_hospitality" else 0)
            rendered.append({"osmWayId":f["id"],"name":tags.get("name"),"heightMeters":height,
                "heightMethod":"official-photo reconstruction" if pit else "OSM height/levels; 6.2 m fallback",
                "footprint":polygon,"facadeColor":facade[:3]})
        walls.create_object("AlbertPark_Buildings",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        obj=roofs.create_object("AlbertPark_Source_Roofs",[self.m["terrain"],self.m["canopy"]],self.c["Infrastructure"])
        tools.aerial_uv(obj,self.center,self.config["model"]["bounds"])
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,
                "remainingDrivingCorridorConflicts":0,"lod2Available":False}

    def infrastructure(self):
        barrier,fences=base.MeshBuilder(),base.MeshBuilder()
        count=0
        for f in self.features:
            kind=f["tags"].get("barrier")
            if kind not in ("fence","wall","guard_rail","retaining_wall"):continue
            for a,b in zip(f["world"],f["world"][1:]):
                length=math.dist(a,b)
                segments=max(1,math.ceil(length/5))
                for i in range(segments):
                    p=[a[axis]+(b[axis]-a[axis])*i/segments for axis in (0,1)]
                    q=[a[axis]+(b[axis]-a[axis])*(i+1)/segments for axis in (0,1)]
                    probes=[p,q,[(p[axis]+q[axis])/2 for axis in (0,1)]]
                    if any(base.distance_to_polyline(probe,path)<width+.25 for probe in probes for path,width in self.corridors):continue
                    za,zb=self.ground(p),self.ground(q)
                    near=base.distance_to_polyline(p,self.line)<90
                    height=2.7 if near and kind=="fence" else 1.25
                    if kind=="fence":
                        fences.add_quad([(*self.xy(p),za),(*self.xy(q),zb),(*self.xy(q),zb+height),(*self.xy(p),za+height)])
                        tools.beam(barrier,(*self.xy(p),za),(*self.xy(p),za+height),.06,(.45,.48,.46,1))
                    else:
                        for dz in (.4,.75,1.1):
                            barrier.add_quad([(*self.xy(p),za+dz-.08),(*self.xy(q),zb+dz-.08),
                                              (*self.xy(q),zb+dz+.08),(*self.xy(p),za+dz+.08)],color=(.65,.65,.62,1))
                    count+=1
        barrier.create_object("AlbertPark_Guardrails",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        fences.create_object("AlbertPark_Catch_Fences",[self.m["fence"]],self.c["Infrastructure"])
        # Albert Park uses temporary concrete barriers and debris fences.
        # Gravel footprints push the barrier out to the actual runoff edge.
        gravel=[f["world"]for f in self.config["surfaceReferences"]if f["kind"]=="Gravel Traps"]
        temporary,mesh_fence=base.MeshBuilder(),base.MeshBuilder()
        panel_count=0
        for d in range(0,math.floor(self.total),8):
            for side in (-1,1):
                a,b=self.surface(d,side*8.5),self.surface(min(d+8,self.total),side*8.5)
                probes=[(a[0]+(b[0]-a[0])*t+self.center["x"],a[1]+(b[1]-a[1])*t+self.center["y"])for t in (0,.25,.5,.75,1)]
                if any(base.point_in_polygon(p,poly)for p in probes for poly in gravel):continue
                if any(base.distance_to_polyline(p,self.pit)<5 for p in probes):continue
                if any(base.point_in_polygon(p,poly)for p in probes for poly in self.reserved):continue
                if any(base.distance_to_polyline(p,self.line)<7.5 for p in probes):continue
                za,zb=self.ground(probes[0]),self.ground(probes[-1])
                aa,bb=Vector((a[0],a[1],za)),Vector((b[0],b[1],zb))
                normal=Vector((-(bb-aa).y,(bb-aa).x,0)).normalized()*.18
                temporary.add_volume([aa-normal,bb-normal,bb+normal,aa+normal],
                    [p+Vector((0,0,1.0))for p in (aa-normal,bb-normal,bb+normal,aa+normal)],color=(.71,.72,.69,1))
                mesh_fence.add_quad([aa+Vector((0,0,1)),bb+Vector((0,0,1)),bb+Vector((0,0,3.4)),aa+Vector((0,0,3.4))])
                tools.beam(temporary,aa+Vector((0,0,1)),aa+Vector((0,0,3.4)),.045,(.45,.47,.45,1))
                panel_count+=1
        temporary.create_object("AlbertPark_Event_Barriers",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        mesh_fence.create_object("AlbertPark_Event_Catch_Fences",[self.m["fence"]],self.c["Infrastructure"])
        return {"mappedBarrierPanels":count,"eventBarrierPanels":panel_count,"eventBarrierPlacementEstimated":True}

    def runoff(self):
        builder=base.MeshBuilder();count=0
        for f in self.config["surfaceReferences"]:
            if f["kind"]!="Gravel Traps":continue
            poly=f["world"]
            if poly[0]==poly[-1]:poly=poly[:-1]
            for tri in base.resolved_tessellation([[Vector((*self.xy(p),self.ground(p)+.12))for p in poly]]):
                if (tri[1]-tri[0]).cross(tri[2]-tri[0]).z<0:tri=list(reversed(tri))
                builder.add_triangle(tri)
            count+=1
        builder.create_object("AlbertPark_Gravel_Runoff",[self.m["gravel"]],self.c["Circuit"])
        # Only organizer-mapped bridge footprints crossing the raceway are used.
        bridge=base.MeshBuilder();bridges=[]
        for f in self.config["surfaceReferences"]:
            if f["kind"]!="Bridges":continue
            poly=f["world"]
            if len(poly)<3 or not base.polygon_intersects_corridors(poly,self.corridors[:1]):continue
            if any(base.polygons_overlap(poly,p)for p in bridges):continue
            edges=sorted(zip(poly,poly[1:]+poly[:1]),key=lambda ab:math.dist(*ab),reverse=True)
            if not edges or math.dist(*edges[0])<18:continue
            height=max(self.ground(p)for p in poly)+6.2
            for tri in base.resolved_tessellation([[Vector((*self.xy(p),height))for p in poly]]):
                if (tri[1]-tri[0]).cross(tri[2]-tri[0]).z<0:tri=list(reversed(tri))
                bridge.add_triangle(tri,color=(.65,.66,.63,1))
            for a,b in zip(poly,poly[1:]+poly[:1]):
                tools.beam(bridge,(*self.xy(a),height+1.0),(*self.xy(b),height+1.0),.08,(.48,.50,.48,1))
            for p in (edges[0][0],edges[0][1]):
                if base.distance_to_polyline(p,self.line)<9:continue
                ground=self.ground(p);bridge.add_box((*self.xy(p),(height+ground)/2),(.5,.5,height-ground),color=(.60,.62,.60,1))
            bridges.append(poly)
        bridge.create_object("AlbertPark_Pedestrian_Bridges",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        return {"gravelTrapFootprints":count,"pedestrianBridgeFootprints":len(bridges),"bridgeHeightEstimated":True}

    def vegetation(self):
        b=base.MeshBuilder();rng=random.Random(1962);points=self.config["trees"][:]
        count=0
        for p in points:
            if any(base.distance_to_polyline(p,path)<half+8 for path,half in self.corridors):continue
            if any(base.point_in_polygon(p,poly)for poly in self.reserved):continue
            if any(f["tags"].get("building") and base.point_in_polygon(p,f["world"])for f in self.features):continue
            color=self.source_color(p)
            color=(max(.10,min(.32,color[0])),max(.19,min(.46,color[1])),max(.08,min(.27,color[2])),1)
            x,y=self.xy(p);z=self.ground(p)
            height=rng.uniform(5,10);radius=rng.uniform(3,5)
            b.add_cylinder((x,y,z),.24,height*.58,sides=3,color=(.28,.23,.17,1))
            ring=[(x+math.cos(i*math.tau/4)*radius,y+math.sin(i*math.tau/4)*radius,z+height*.64)for i in range(4)]
            for i in range(4):
                j=(i+1)%4
                b.add_triangle([ring[i],ring[j],(x,y,z+height)],color=color)
                b.add_triangle([ring[j],ring[i],(x,y,z+height*.28)],color=color)
            count+=1
        b.create_object("AlbertPark_Vegetation",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        return {"trees":count,"method":"OSM individual tree points; SkySat canopy color samples; canopy height and geometry estimated"}

    def annotations(self):
        collection=self.c["Annotations"]
        for turn in self.config["model"]["turns"]:
            d=turn["distanceMeters"]
            a,b=base.sample_tangent(self.line,self.cum,d-12),base.sample_tangent(self.line,self.cum,d+12)
            side=-1 if a.x*b.y-a.y*b.x>0 else 1
            anchor=base.anchor_at(f"Turn_{turn['number']:02d}",d,self.line,self.cum,self.total,self.raster,self.center,0,collection,side=side,offset=18,height=6)
            anchor.location.z=self.surface(d)[2]+6
        core,glow,finish=base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        controls=self.config["officialControlPoints"]
        for i,d in enumerate([0]+controls["sectorBoundaryDistancesMeters"]):
            for obj,span,lift in [(glow,3.8,.72),(core,.65,.78)]:self.strip(obj,d-span,d+span,-7,7,i,lift=lift)
            name="StartFinish" if i==0 else f"SectorBoundary_{i+1:02d}"
            anchor=base.anchor_at(name,d,self.line,self.cum,self.total,self.raster,self.center,0,collection,side=-1,offset=18,height=6)
            anchor.location.z=self.surface(d)[2]+6
        for i in range(12):
            for row in range(2):self.strip(finish,-.8+row*.8,row*.8,-6+i,-5+i,(i+row)%2,lift=.83)
        core.create_object("AlbertPark_Sector_Core",self.m["sectors"],collection)
        glow.create_object("AlbertPark_Sector_Glow",self.m["halos"],collection)
        finish.create_object("AlbertPark_Start_Finish",[self.m["white"],self.m["black"]],collection)
        for name,d in [("SpeedTrap",controls["speedTrapDistanceMeters"]),("RaceStart",controls["raceStartDistanceMeters"])]:
            anchor=base.anchor_at(name,d,self.line,self.cum,self.total,self.raster,self.center,0,collection,side=1,offset=15,height=6)
            anchor.location.z=self.surface(d)[2]+6
        # Start-light structure at the physically separate race-start line.
        gantry_d=controls["raceStartDistanceMeters"]
        supports=[]
        for side in (-1,1):
            offset=8
            while offset<30:
                p=self.surface(gantry_d,side*offset)
                world=(p[0]+self.center["x"],p[1]+self.center["y"])
                if all(base.distance_to_polyline(world,path)>half+.5 for path,half in self.corridors):break
                offset+=.5
            if offset>=30:raise ValueError("Start gantry support has no clear footprint")
            supports.append(p)
            self.props.add_cylinder(p,.25,6.5,sides=6,color=(.50,.52,.50,1))
        a,b=supports
        tools.beam(self.props,Vector(a)+Vector((0,0,6.3)),Vector(b)+Vector((0,0,6.3)),.25,(.56,.57,.54,1))
        for i in range(5):
            p=self.surface(gantry_d,(i-2)*1.25)
            self.props.add_box((p[0],p[1],p[2]+5.9),(.42,.42,.56),color=(.06,.06,.06,1))
        # At the main/pit merge, drape markings over the highest actual road
        # triangles, rather than assuming the source centreline profile owns XY.
        road_objects=[bpy.data.objects[name]for name in ("AlbertPark_Raceway","AlbertPark_Pit_Lane")]
        vertices=[];faces=[]
        for obj in road_objects:
            offset=len(vertices);vertices.extend(v.co for v in obj.data.vertices)
            faces.extend(tuple(offset+i for i in p.vertices)for p in obj.data.polygons)
        support=BVHTree.FromPolygons(vertices,faces)
        for i,(x,y,z)in enumerate(self.paint.vertices):
            hit,*_=support.ray_cast(Vector((x,y,1000)),Vector((0,0,-1)))
            if hit is None:raise ValueError(f"Paint vertex has no driving-surface support: {x}, {y}")
            self.paint.vertices[i]=(x,y,hit.z+.20)
        self.paint.create_object("AlbertPark_Edge_And_Pit_Markings",[self.m["white"]],self.c["Circuit"])
        self.props.create_object("AlbertPark_Pit_And_Gantry_Details",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        profile=[{"distanceMeters":self.total*i/180,"elevationMeters":self.surface(self.total*i/180)[2]-.45}for i in range(181)]
        low,high=min(profile,key=lambda p:p["elevationMeters"]),max(profile,key=lambda p:p["elevationMeters"])
        for name,p in [("LowPoint",low),("HighPoint",high)]:
            anchor=base.anchor_at(name,p["distanceMeters"],self.line,self.cum,self.total,self.raster,self.center,0,collection,offset=0,height=7)
            anchor.location.z=p["elevationMeters"]+7
            anchor["elevation_datum_m"]=p["elevationMeters"]
        return profile,low,high


def main():
    args=base.parse_args();config=json.loads(Path(args.input).read_text());prepared=Path(args.prepared)
    raster_meta=json.loads((prepared/"raster-metadata.json").read_text())
    raster=base.HeightRaster(prepared/"albert-park-dtm.f32le",raster_meta["rasters"]["dtm"],config["model"]["bounds"])
    raster.profiles=json.loads((prepared/"albert-park-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    c=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=1
    scene["coordinate_reference_system"]="EPSG:7855";scene["vertical_datum"]="Australian Height Datum (AHD)"
    scene["real_world_scale"]="1 unit = 1 metre; no vertical exaggeration"
    grain=texture("AlbertPark_Mineral_Surface");facade=texture("AlbertPark_Facade_Detail","facade")
    m={"terrain":base.create_aerial_material(prepared/"albert-park-orthophoto.jpg"),
       "asphalt":tools.textured_material("AlbertPark_Asphalt",(.31,.32,.32,1),grain),
       "white":tools.textured_material("AlbertPark_White_Paint",(.91,.92,.88,1),grain),
       "red":tools.textured_material("AlbertPark_Green_Kerbs",(.075,.38,.19,1),grain),
       "yellow":tools.textured_material("AlbertPark_Gold_Kerbs",(.94,.77,.10,1),grain),
       "canopy":tools.textured_material("AlbertPark_Canvas_Canopies",(.84,.85,.82,1),grain),
       "gravel":tools.textured_material("AlbertPark_Sand_Gravel",(.67,.60,.47,1),grain),
       "black":tools.textured_material("AlbertPark_Checker_Black",(.05,.05,.05,1),grain),
       "concrete":tools.textured_material("AlbertPark_Pit_Concrete",(.62,.64,.61,1),grain),
       "vertex":tools.textured_material("AlbertPark_Source_Colored_Physical_Objects",(1,1,1,1),grain,vertex=True),
       "facade":tools.textured_material("AlbertPark_Textured_Facades",(1,1,1,1),facade,vertex=True),
       "fence":fence_material()}
    m["seats"]=tools.seating_material();m["seats"].name="AlbertPark_Colored_Seat_Rows"
    m["terrain"].name="AlbertPark_Planet_SkySat_2018";m["fence"].name="AlbertPark_Chain_Link_Fence"
    for img in bpy.data.images:
        if img.name=="Mexico_Chain_Link":img.name="AlbertPark_Chain_Link"
        if img.name=="Mexico_Repeating_Shell_Seat":img.name="AlbertPark_Repeating_Shell_Seat"
    aerial=next(n.image for n in m["terrain"].node_tree.nodes if n.type=="TEX_IMAGE")
    m["sectors"]=[];m["halos"]=[]
    for i,color in enumerate([(.80,.02,.015,1),(.97,.43,.02,1),(.02,.56,.72,1)]):
        m["sectors"].append(base.create_material(f"AlbertPark_Sector_{i+1}",tools.linear(color),.8))
        m["halos"].append(base.create_material(f"AlbertPark_Sector_{i+1}_Glow",(*tools.linear(color)[:3],.30),.5,emission_strength=1.3))
    model=AlbertParkScene(config,raster,c,m,aerial)
    model.terrain();samples,curbs=model.road();pit=model.pit_lane()
    print("AlbertPark terrain, track and pit built",flush=True)
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        failures=[]
        for distance,x,y,z,tangent,normal,bank,width in samples:
            for side in (-1,0,1):
                px,py=x+normal.x*side*width/2,y+normal.y*side*width/2
                floor=raster.sample_rendered_terrain(px,py)
                if z-floor<.15:failures.append({"distance":distance,"world":[px,py],"road":z,"terrain":floor})
        raise ValueError(f"AlbertPark driving surfaces intersect terrain: {clearance}, {pit['surfaceClearance']}; {failures[:10]}")
    stands=model.grandstands();buildings=model.buildings()
    print("AlbertPark mapped stands and buildings built",flush=True)
    infrastructure=model.infrastructure();runoff=model.runoff();vegetation=model.vegetation()
    profile,low,high=model.annotations()
    for obj in bpy.data.objects:
        if obj.type=="MESH":
            obj.data.validate(verbose=False,clean_customdata=False)
            tools.uv_surface(obj,2)
    print("AlbertPark textured physical scene built",flush=True)
    scene.render.engine="BLENDER_EEVEE";scene.render.resolution_x=1400;scene.render.resolution_y=1600
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format="WEBP"
    scene.render.image_settings.color_mode="RGBA";scene.render.image_settings.quality=92
    scene.view_settings.view_transform="Standard";scene.view_settings.look="None"
    scene.world=bpy.data.worlds.new("AlbertPark_World");scene.world.color=(.10,.12,.13)
    base.add_lighting(c["Terrain"])
    camera_data=bpy.data.cameras.new("AlbertParkPreview");camera_data.type="ORTHO";camera_data.ortho_scale=2650
    camera_data.clip_end=10000;camera=bpy.data.objects.new("AlbertParkPreview",camera_data)
    c["Terrain"].objects.link(camera);camera.location=(0,-750,2700);base.look_at(camera,(0,0,35));scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    for img in bpy.data.images:
        if img.source=="FILE":img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(camera_data)
    export_precise_heights(Path(args.glb).resolve())
    metadata={"schemaVersion":4,"modelId":"albert-park","generatedWith":f"Blender {bpy.app.version_string}",
        "coordinateReferenceSystem":"EPSG:7855","verticalDatum":"Australian Height Datum (AHD)",
        "verticalExaggeration":1,"elevationApproximate":True,"assetLicense":"CC BY-SA 4.0","realWorldScale":"1 unit = 1 metre; no vertical exaggeration",
        "originMeters":config["model"]["center"],"boundsMeters":{"width":1900,"depth":2160},
        "lapLength":{"geometryMeters":model.total,"officialFiaMeters":5278,"relativeErrorPercent":abs(model.total-5278)/5278*100},
        "elevationProfile":profile,"elevationsMeters":{"low":low["elevationMeters"],"high":high["elevationMeters"]},
        "finishDistanceMeters":0,"raceStartDistanceMeters":config["officialControlPoints"]["raceStartDistanceMeters"],"baseElevationMeters":0,
        "sectorBoundaryDistancesMeters":config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        "objects":{"turnAnchors":14,"pitGarageBoxes":45,"buildingsTotal":buildings["count"],
                   "grandstandFootprints":stands["count"],"raceMotorhomes":0,**infrastructure,**runoff,**vegetation},
        "layoutQuality":{"surfaceClearance":clearance,"pitLane":pit,"grandstands":stands,"buildings":buildings,
                         "runoff":runoff,"curbs":curbs,"terrainSurface":raster_meta["terrainSurface"],
                         "roadGrading":raster_meta["roadGrading"],
                         "sourceRasterAudit":json.loads((prepared/"source-raster-audit.json").read_text())},
        "materials":{"physicalObjectsTextured":True,"roofMethod":"embedded registered Planet SkySat 2018 UV projection on permanent roofs; authored canvas for new event canopies",
                     "colorSpace":"SkySat byte-image sRGB samples converted once to linear vertex colors",
                     "facadeMethod":"source-derived color with neutral authored window/mullion detail; no facade photogrammetry"},
        "currentLayoutReconstruction":config["currentLayoutReconstruction"],
        "controlPointReference":config["officialControlPoints"],"sourceManifest":config["sourceManifest"],
        "limitations":config["limitations"],"publicationStatus":"local-validation-pending"}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"lapLength":metadata["lapLength"],"clearance":clearance,"objects":metadata["objects"]}))


if __name__=="__main__":main()
