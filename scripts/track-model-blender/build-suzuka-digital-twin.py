#!/usr/bin/env python3
"""Build Suzuka from its own pinned GSI/OSM/FIA sources, with textured physical meshes."""

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
spec = importlib.util.spec_from_file_location("suzuka_mesh_tools", SCRIPTS / "build-mexico-digital-twin.py")
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)
base = tools.base
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 243, 155
base.PIT_LANE_WIDTH_METERS = 8
tools.COPYRIGHT = "RaceSide Suzuka model; © OpenStreetMap contributors (ODbL); GSI Japan (Public Data License 1.0); FIA 2026 control-map reference"


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
    image=bpy.data.images.new("Suzuka_Chain_Link_RGBA",width=128,height=128,alpha=True)
    pixels=[]
    for y in range(128):
        for x in range(128):
            wire=(x+y)%16<2 or (x-y)%16<2
            pixels.extend((.58,.60,.59,.88 if wire else 0))
    image.pixels[:]=pixels;image.update();image.pack()
    material=base.create_material("Suzuka_Chain_Link_Fence",(1,1,1,1),.86)
    node=material.node_tree.nodes.new("ShaderNodeTexImage");node.image=image
    bsdf=material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(node.outputs["Color"],bsdf.inputs["Base Color"])
    material.node_tree.links.new(node.outputs["Alpha"],bsdf.inputs["Alpha"])
    material.surface_render_method="DITHERED";material.use_transparency_overlap=False
    return material


class SuzukaScene:
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
        obj.name="Suzuka_Terrain"
        obj.data.name="Suzuka_Terrain_Mesh"
        bvh=BVHTree.FromPolygons([v.co for v in obj.data.vertices],[tuple(p.vertices)for p in obj.data.polygons])
        def height(x,y):
            hit,*_=bvh.ray_cast(Vector((x-self.center["x"],y-self.center["y"],1000)),Vector((0,0,-1)))
            return hit.z if hit is not None else self.raster.sample(x,y)
        self.raster.sample_rendered_terrain=height

    def road(self):
        obj,_,_,samples=base.create_ribbon("Suzuka_Raceway",self.line,self.raster,self.center,0,12,
            self.m["asphalt"],self.c["Circuit"],interval=2,z_offset=.45)
        obj["source"]="OSM relation 284570; 5806.829 m; GSI DEM5A road profile"
        for d in range(0,math.ceil(self.total),2):
            for side in (-1,1):self.strip(self.paint,d,min(d+2,self.total),side*5.65,side*5.83)
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
        kerbs.create_object("Suzuka_Kerbs",[self.m["red"],self.m["white"]],self.c["Circuit"])
        return samples,curb_ranges

    def pit_lane(self):
        _,_,_,samples=base.create_ribbon("Suzuka_Pit_Lane",self.pit,self.raster,self.center,0,8,
            self.m["asphalt"],self.c["Circuit"],interval=2,closed=False,taper_meters=30,
            minimum_start_width=4,minimum_end_width=4,z_offset=.45)
        building=next(f for f in self.features if f["id"]==184422099)
        first=nearest_distance(self.pit,self.pc,building["world"][0])+4
        last=nearest_distance(self.pit,self.pc,building["world"][3])-4
        first,last=min(first,last),max(first,last)
        for i in range(56):
            d=first+(last-first)*i/55
            self.strip(self.paint,d,d+.16,-3.8,-1.1,pit=True,lift=.59)
        for d in range(math.ceil(first),math.floor(last),3):
            self.strip(self.paint,d,min(d+2,last),-1.2,-1.36,pit=True,lift=.59)
        wall,quality=base.create_pit_wall(self.pit,self.line,self.raster,self.center,0,
            [self.m["concrete"],self.m["fence"]],self.c["Circuit"],start_ratio=(first-20)/self.pt,
            end_ratio=(last+25)/self.pt,wall_height=.9,fence_height=2.05)
        wall.name="Suzuka_Pit_Wall"
        wall.data.name="Suzuka_Pit_Wall_Mesh"
        wall["source"]="FIA 2026 pit drawing and photographs; OSM pit-lane separation"
        # Real garage-front area, aligned to the existing building, with team bays.
        team_colors=[(.89,.42,.04,1),(.035,.20,.22,1),(.04,.09,.20,1),(.70,.02,.025,1),
                     (.07,.20,.65,1),(.08,.22,.62,1),(.015,.25,.20,1),(.75,.75,.72,1),
                     (.48,.015,.035,1),(.035,.12,.28,1),(.035,.04,.05,1)]
        for i in range(55):
            d=first+(last-first)*(i+.5)/55
            p=self.surface(d,-9.2,True)
            tangent=base.sample_tangent(self.pit,self.pc,d,closed=False)
            along=Vector((tangent.x,tangent.y,0))*(last-first)/55*.47
            for lower,upper,color in [(0,3.6,(.18,.19,.20,1)),(3.6,4.3,team_colors[max(0,min(10,(i-4)//4))])]:
                self.props.add_quad([Vector(p)-along+Vector((0,0,lower)),Vector(p)+along+Vector((0,0,lower)),
                    Vector(p)+along+Vector((0,0,upper)),Vector(p)-along+Vector((0,0,upper))],color=color)
        return {"pitGarageBoxes":55,"frontageDistancesMeters":[first,last],"wall":quality,
                "entryGapMeters":base.distance_to_polyline(self.pit[0],self.line),
                "exitGapMeters":base.distance_to_polyline(self.pit[-1],self.line),
                "surfaceClearance":base.measure_ribbon_terrain_clearance(samples,self.raster,0)}

    def grandstands(self):
        builder,roofs=base.MeshBuilder(),base.MeshBuilder()
        seat_rows,seat_uvs=base.MeshBuilder(),[]
        rendered,excluded=[],[]
        for f in self.features:
            if f["tags"].get("grandstand")!="yes":continue
            polygon=f["world"][:-1] if f["world"][0]==f["world"][-1] else f["world"]
            if base.polygon_intersects_corridors(polygon,self.corridors):
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
            main=f["tags"].get("name") in ("V2","VIP")
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
                    base_height=4.2 if main else .5
                    for row in range(local_rows):
                        a=near+(far-near)*row/local_rows
                        b=near+(far-near)*(row+1)/local_rows
                        ring=[axis*u+normal*v for u,v in ((left,a),(right,a),(right,b),(left,b))]
                        if not all(base.point_in_polygon(p,polygon) or base.distance_point_polygon(p,polygon)<.12 for p in ring):continue
                        z=max(ground+base_height+row*.43,max(self.ground(p)for p in ring)+.2)
                        color=self.source_color(axis*middle+normal*((a+b)/2))
                        structural=(.60,.62,.61,1)
                        builder.add_quad([(*self.xy(p),z)for p in ring],color=structural)
                        builder.add_quad([(*self.xy(ring[0]),z-.43),(*self.xy(ring[1]),z-.43),
                                          (*self.xy(ring[1]),z),(*self.xy(ring[0]),z)],color=structural)
                        # Seating follows sampled row colors. Covered V2 seats use
                        # the pale blue/gray permanent seats visible in official photos.
                        if main:color=(.43,.52,.62,1)
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
                            roofs.add_quad([(*self.xy(p),height+(.4 if band in (1,2)else 0))for p in points])
                        for v in (far,near):
                            p=axis*middle+normal*v
                            tools.beam(builder,(*self.xy(p),ground+base_height),(*self.xy(p),height),.17,(.65,.66,.64,1))
            rendered.append({"osmWayId":f["id"],"name":f["tags"].get("name"),"footprint":polygon,
                "rowsBuilt":count,"seatsBuilt":seats,"covered":main,
                "minimumTrackClearanceMeters":base.minimum_polygon_track_clearance(polygon,self.corridors[0][0],6)})
        builder.create_object("Suzuka_Grandstands",[self.m["vertex"]],self.c["Grandstands"],vertex_colors=True)
        seats=seat_rows.create_object("Suzuka_Textured_Seat_Rows",[self.m["seats"]],self.c["Grandstands"],vertex_colors=True)
        uv=seats.data.uv_layers.new(name="SeatShellUV")
        for loop,coordinate in zip(seats.data.loops,seat_uvs):uv.data[loop.index].uv=coordinate
        roof=roofs.create_object("Suzuka_Main_Grandstand_Roof",[self.m["terrain"]],self.c["Grandstands"])
        tools.aerial_uv(roof,self.center,self.config["model"]["bounds"])
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,
                "seatColorMethod":"GSI footprint samples; covered V2 permanent pale blue/gray seat reconstruction"}

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
            pit=f["id"]==184422099
            try:height=float(tags.get("height",float(tags.get("building:levels",2))*3.1))
            except ValueError:height=6.2
            if pit:height=10.2
            low=max(self.ground(p)for p in polygon)
            color=self.source_color(polygon[0])
            facade=(.77,.78,.76,1) if pit else tuple(max(.18,min(.84,v*.78+.12))for v in color[:3])+(1,)
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                walls.add_quad([(*self.xy(a),self.ground(a)),(*self.xy(b),self.ground(b)),
                                (*self.xy(b),low+height),(*self.xy(a),low+height)],color=facade)
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p),low+height))for p in polygon]]):
                if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:triangle=list(reversed(triangle))
                roofs.add_triangle(triangle)
            rendered.append({"osmWayId":f["id"],"name":tags.get("name"),"heightMeters":height,
                "heightMethod":"official-photo reconstruction" if pit else "OSM height/levels; 6.2 m fallback",
                "footprint":polygon,"facadeColor":facade[:3]})
        walls.create_object("Suzuka_Buildings",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        obj=roofs.create_object("Suzuka_Source_Roofs",[self.m["terrain"]],self.c["Infrastructure"])
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
        barrier.create_object("Suzuka_Guardrails",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        fences.create_object("Suzuka_Catch_Fences",[self.m["fence"]],self.c["Infrastructure"])
        # Only the OSM-mapped wheel is used; stand S carries an erroneous old wheel tag.
        wheel=next(f for f in self.features if f["id"]==184107083)
        polygon=wheel["world"][:-1]
        cx=sum(p[0]for p in polygon)/len(polygon)
        cy=sum(p[1]for p in polygon)/len(polygon)
        x,y=self.xy((cx,cy));ground=self.ground((cx,cy))
        axis=Vector((.61,-.793,0));normal=Vector((.793,.61,0))
        hub=Vector((x,y,ground+27));radius=22
        steel=(.84,.85,.82,1);red=(.76,.025,.04,1);glass=(.10,.17,.22,1)
        b=base.MeshBuilder()
        for side in (-1,1):
            for foot in (-1,1):
                a=Vector((x,y,ground))+axis*foot*12+normal*side*7
                tools.beam(b,a,hub+normal*side*2,.48,red)
        for ring_side in (-1,1):
            points=[hub+normal*ring_side*1.15+axis*(math.cos(i*math.tau/64)*radius)+Vector((0,0,math.sin(i*math.tau/64)*radius))for i in range(65)]
            for a,c in zip(points,points[1:]):tools.beam(b,a,c,.12,steel)
            for i in range(32):
                p=points[i*2]
                tools.beam(b,hub+normal*ring_side*1.15,p,.045,steel)
        for i in range(40):
            angle=i*math.tau/40
            p=hub+axis*(math.cos(angle)*radius)+Vector((0,0,math.sin(angle)*radius-1))
            b.add_box(p,(1.5,1.5,1.7),color=red)
            b.add_box(p+Vector((0,0,.15)),(1.52,1.52,.85),color=glass)
        b.add_box(hub+normal*1.4,(5.3,.4,5.3),color=red)
        b.create_object("Suzuka_Circuit_Wheel",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        return {"mappedBarrierPanels":count,"wheel":{"osmWayId":184107083,"heightMeters":50,
                  "gondolas":40,"gondolaCountEstimated":True,"colors":"white rim/spokes, red supports/capsules; official photograph"}}

    def bridge(self):
        data=self.config["bridge"]
        d=data["upperDistanceMeters"]
        start,end=d-20,d+20
        deck=base.MeshBuilder()
        for pos in range(math.floor(start),math.ceil(end),2):
            bottom=[self.surface(dd,offset,lift=-.50)for dd,offset in ((pos,-6.3),(pos+2,-6.3),(pos+2,6.3),(pos,6.3))]
            top=[self.surface(dd,offset,lift=.39)for dd,offset in ((pos,-6.3),(pos+2,-6.3),(pos+2,6.3),(pos,6.3))]
            deck.add_volume(bottom,top,color=(.47,.49,.47,1))
            for side in (-1,1):
                tools.beam(deck,self.surface(pos,side*6.25,lift=.62),self.surface(pos+2,side*6.25,lift=.62),.12,(.72,.72,.68,1))
        for pos in (start,end):
            for side in (-1,1):
                p=self.surface(pos,side*5.6,lift=-.52)
                low=self.ground((p[0]+self.center["x"],p[1]+self.center["y"]))
                if p[2]>low:deck.add_box((p[0],p[1],(p[2]+low)/2),(1.0,1.0,p[2]-low),color=(.52,.53,.51,1))
        deck.create_object("Suzuka_Crossover_Bridge",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        high=self.surface(d)[2]
        low=self.surface(data["lowerDistanceMeters"])[2]
        return {**data,"drivingSurfaceSeparationMeters":high-low,"deckThicknessMeters":.89,
                "minimumEstimatedRoadToSoffitClearanceMeters":high-low-.95}

    def vegetation(self):
        b=base.MeshBuilder();rng=random.Random(1962);points=self.config["trees"][:]
        for f in self.features:
            if f["tags"].get("natural")!="wood" and f["tags"].get("landuse")!="forest":continue
            poly=f["world"]
            if len(poly)<4:continue
            for x in range(math.ceil(min(p[0]for p in poly)/16)*16,math.floor(max(p[0]for p in poly)),16):
                for y in range(math.ceil(min(p[1]for p in poly)/16)*16,math.floor(max(p[1]for p in poly)),16):
                    p=(x+rng.uniform(-3,3),y+rng.uniform(-3,3))
                    if base.point_in_polygon(p,poly):points.append(p)
        count=0
        for p in points:
            if any(base.distance_to_polyline(p,path)<half+8 for path,half in self.corridors):continue
            if any(base.point_in_polygon(p,poly)for poly in self.reserved):continue
            color=self.source_color(p)
            x,y=self.xy(p);z=self.ground(p)
            height=rng.uniform(5,10);radius=rng.uniform(3,5)
            b.add_cylinder((x,y,z),.24,height*.58,sides=3,color=(.28,.23,.17,1))
            bottom=[(x+math.cos(i*math.tau/5)*radius,y+math.sin(i*math.tau/5)*radius,z+height*.44)for i in range(5)]
            middle=[(x+math.cos(i*math.tau/5)*radius*.92,y+math.sin(i*math.tau/5)*radius*.92,z+height*.72)for i in range(5)]
            for i in range(5):
                j=(i+1)%5
                b.add_quad([bottom[i],bottom[j],middle[j],middle[i]],color=color)
                b.add_triangle([middle[i],middle[j],(x,y,z+height)],color=color)
                b.add_triangle([bottom[j],bottom[i],(x,y,z+height*.22)],color=color)
            count+=1
        b.create_object("Suzuka_Vegetation",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        return {"trees":count,"method":"mapped individual trees and sampled canopies inside OSM forest polygons; canopy geometry estimated"}

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
        core.create_object("Suzuka_Sector_Core",self.m["sectors"],collection)
        glow.create_object("Suzuka_Sector_Glow",self.m["halos"],collection)
        finish.create_object("Suzuka_Start_Finish",[self.m["white"],self.m["black"]],collection)
        for name,d in [("SpeedTrap",controls["speedTrapDistanceMeters"]),("RaceStart",controls["raceStartDistanceMeters"])]:
            anchor=base.anchor_at(name,d,self.line,self.cum,self.total,self.raster,self.center,0,collection,side=1,offset=15,height=6)
            anchor.location.z=self.surface(d)[2]+6
        # Start-light structure at the physically separate race-start line.
        gantry_d=controls["raceStartDistanceMeters"]
        for side in (-1,1):
            p=self.surface(gantry_d,side*8)
            self.props.add_cylinder(p,.25,6.5,sides=6,color=(.50,.52,.50,1))
        a,b=self.surface(gantry_d,-8),self.surface(gantry_d,8)
        tools.beam(self.props,Vector(a)+Vector((0,0,6.3)),Vector(b)+Vector((0,0,6.3)),.25,(.56,.57,.54,1))
        for i in range(5):
            p=self.surface(gantry_d,(i-2)*1.25)
            self.props.add_box((p[0],p[1],p[2]+5.9),(.42,.42,.56),color=(.06,.06,.06,1))
        self.paint.create_object("Suzuka_Edge_And_Pit_Markings",[self.m["white"]],self.c["Circuit"])
        self.props.create_object("Suzuka_Pit_And_Gantry_Details",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
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
    raster=base.HeightRaster(prepared/"suzuka-dtm.f32le",raster_meta["rasters"]["dtm"],config["model"]["bounds"])
    raster.profiles=json.loads((prepared/"suzuka-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    c=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=1
    scene["coordinate_reference_system"]="EPSG:32653";scene["vertical_datum"]="GSI Tokyo Peil orthometric metres"
    scene["real_world_scale"]="1 unit = 1 metre; no vertical exaggeration"
    grain=texture("Suzuka_Mineral_Surface");facade=texture("Suzuka_Facade_Detail","facade")
    m={"terrain":base.create_aerial_material(prepared/"suzuka-orthophoto.jpg"),
       "asphalt":tools.textured_material("Suzuka_Asphalt",(.31,.32,.32,1),grain),
       "white":tools.textured_material("Suzuka_White_Paint",(.91,.92,.88,1),grain),
       "red":tools.textured_material("Suzuka_Red_Kerbs",(.74,.045,.05,1),grain),
       "black":tools.textured_material("Suzuka_Checker_Black",(.05,.05,.05,1),grain),
       "concrete":tools.textured_material("Suzuka_Pit_Concrete",(.62,.64,.61,1),grain),
       "vertex":tools.textured_material("Suzuka_Source_Colored_Physical_Objects",(1,1,1,1),grain,vertex=True),
       "facade":tools.textured_material("Suzuka_Textured_Facades",(1,1,1,1),facade,vertex=True),
       "fence":fence_material()}
    m["seats"]=tools.seating_material();m["seats"].name="Suzuka_Colored_Seat_Rows"
    m["terrain"].name="Suzuka_GSI_Orthophoto";m["fence"].name="Suzuka_Chain_Link_Fence"
    for img in bpy.data.images:
        if img.name=="Mexico_Chain_Link":img.name="Suzuka_Chain_Link"
        if img.name=="Mexico_Repeating_Shell_Seat":img.name="Suzuka_Repeating_Shell_Seat"
    aerial=next(n.image for n in m["terrain"].node_tree.nodes if n.type=="TEX_IMAGE")
    m["sectors"]=[];m["halos"]=[]
    for i,color in enumerate([(.80,.02,.015,1),(.97,.43,.02,1),(.02,.56,.72,1)]):
        m["sectors"].append(base.create_material(f"Suzuka_Sector_{i+1}",tools.linear(color),.8))
        m["halos"].append(base.create_material(f"Suzuka_Sector_{i+1}_Glow",(*tools.linear(color)[:3],.30),.5,emission_strength=1.3))
    model=SuzukaScene(config,raster,c,m,aerial)
    model.terrain();samples,curbs=model.road();pit=model.pit_lane()
    print("Suzuka terrain, track and pit built",flush=True)
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Suzuka driving surfaces intersect terrain: {clearance}, {pit['surfaceClearance']}")
    stands=model.grandstands();buildings=model.buildings()
    print("Suzuka mapped stands and buildings built",flush=True)
    infrastructure=model.infrastructure();bridge=model.bridge();vegetation=model.vegetation()
    profile,low,high=model.annotations()
    for obj in bpy.data.objects:
        if obj.type=="MESH":tools.uv_surface(obj,2)
    print("Suzuka textured physical scene built",flush=True)
    scene.render.engine="BLENDER_EEVEE";scene.render.resolution_x=1600;scene.render.resolution_y=1100
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format="WEBP"
    scene.render.image_settings.color_mode="RGBA";scene.render.image_settings.quality=92
    scene.view_settings.view_transform="Standard";scene.view_settings.look="None"
    scene.world=bpy.data.worlds.new("Suzuka_World");scene.world.color=(.10,.12,.13)
    base.add_lighting(c["Terrain"])
    camera_data=bpy.data.cameras.new("SuzukaPreview");camera_data.type="ORTHO";camera_data.ortho_scale=2650
    camera_data.clip_end=10000;camera=bpy.data.objects.new("SuzukaPreview",camera_data)
    c["Terrain"].objects.link(camera);camera.location=(0,-750,2700);base.look_at(camera,(0,0,35));scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    for img in bpy.data.images:
        if img.source=="FILE":img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(camera_data)
    tools.export(Path(args.glb).resolve())
    metadata={"schemaVersion":4,"modelId":"suzuka","generatedWith":f"Blender {bpy.app.version_string}",
        "coordinateReferenceSystem":"EPSG:32653","verticalDatum":"GSI orthometric metres, Tokyo Peil",
        "verticalExaggeration":1,"realWorldScale":"1 unit = 1 metre; no vertical exaggeration",
        "originMeters":config["model"]["center"],"boundsMeters":{"width":2420,"depth":1540},
        "lapLength":{"geometryMeters":model.total,"officialFiaMeters":5807,"relativeErrorPercent":abs(model.total-5807)/5807*100},
        "elevationProfile":profile,"elevationsMeters":{"low":low["elevationMeters"],"high":high["elevationMeters"]},
        "finishDistanceMeters":0,"raceStartDistanceMeters":130,"baseElevationMeters":0,
        "sectorBoundaryDistancesMeters":config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        "objects":{"turnAnchors":18,"pitGarageBoxes":55,"buildingsTotal":buildings["count"],
                   "grandstandFootprints":stands["count"],"raceMotorhomes":0,**infrastructure,**vegetation},
        "layoutQuality":{"surfaceClearance":clearance,"pitLane":pit,"grandstands":stands,"buildings":buildings,
                         "bridge":bridge,"curbs":curbs,"terrainSurface":raster_meta["terrainSurface"],
                         "roadGrading":raster_meta["roadGrading"],
                         "sourceRasterAudit":json.loads((prepared/"source-raster-audit.json").read_text())},
        "materials":{"physicalObjectsTextured":True,"roofMethod":"embedded GSI orthophoto UV projection",
                     "colorSpace":"GSI byte-image sRGB samples converted exactly once to linear vertex colors",
                     "facadeMethod":"source-derived color with neutral authored window/mullion detail; no facade photogrammetry"},
        "controlPointReference":config["officialControlPoints"],"sourceManifest":config["sourceManifest"],
        "limitations":config["limitations"],"publicationStatus":"review-required"}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"lapLength":metadata["lapLength"],"clearance":clearance,"objects":metadata["objects"]}))


if __name__=="__main__":main()
