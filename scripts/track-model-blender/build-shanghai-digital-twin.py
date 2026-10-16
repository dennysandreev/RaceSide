#!/usr/bin/env python3
"""Build Shanghai in UTM 51N metres from its own immutable source snapshot."""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("shanghai_mesh_helpers", SCRIPTS / "build-suzuka-digital-twin.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
base, tools = helpers.base, helpers.tools
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 201, 187
base.PIT_LANE_WIDTH_METERS = 8
tools.COPYRIGHT = ("RaceSide Shanghai model and preview: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/. "
    "Contains georegistered, cropped and rendered Planet Labs, Inc. SkySat imagery, 7 April 2018: "
    "https://commons.wikimedia.org/wiki/File:Shanghai_International_Circuit,_April_7,_2018_SkySat.jpg. "
    "Geographic data © OpenStreetMap contributors, ODbL 1.0. Terrain OpenGeoHub / Ho et al. (2025), GEDTM30, CC BY 4.0. "
    "Architecture reconstructed from OSM and Tilke/FIA references. Website software is separately licensed.")

# A short tangent stencil folds the inside edge at sparse OSM corner nodes.
# Smooth only the cross-section direction; retain the measured centreline.
source_tangent = base.sample_tangent
def shanghai_tangent(points, cumulative, distance, delta=12.0, closed=True):
    return source_tangent(points, cumulative, distance, delta=delta, closed=closed)
base.sample_tangent = shanghai_tangent


class ShanghaiScene(helpers.SuzukaScene):
    def __init__(self, *args):
        super().__init__(*args)
        self.corridors = [(base.sample_line_points(self.line,self.cum,2),7),
                          (base.sample_line_points(self.pit,self.pc,2,closed=False),4.4)]

    def surface(self,d,offset=0,pit=False,lift=.45):
        line,cum,width = (self.pit,self.pc,8) if pit else (self.line,self.cum,13)
        return base.road_surface_point(line,cum,d,offset,self.raster,self.center,0,width,z_offset=lift,closed=not pit)

    def road(self):
        obj,_,_,samples = base.create_ribbon("Shanghai_Raceway",self.line,self.raster,self.center,0,13,
            self.m["asphalt"],self.c["Circuit"],interval=2,z_offset=.45)
        obj["source"] = "OSM relation 2094941, way 156328670; FIA 2026 5451 m"
        for d in range(0,math.ceil(self.total),2):
            for side in (-1,1):
                self.strip(self.paint,d,min(d+2,self.total),side*6.18,side*6.36)
        kerbs = base.MeshBuilder()
        ranges = []
        for turn in self.config["model"]["turns"]:
            d = turn["distanceMeters"]
            a,b = base.sample_tangent(self.line,self.cum,d-18),base.sample_tangent(self.line,self.cum,d+18)
            side = 1 if a.x*b.y-a.y*b.x>0 else -1
            span = 48 if turn["number"] in (1,2,7,8,13,14) else 24
            ranges.append({"turn":turn["number"],"startMeters":d-span,"endMeters":d+span,"side":side,
                           "placementMethod":"source-reviewed apex intervals; exact survey unavailable"})
            for i in range(math.ceil(span)):
                start=d-span+i*2
                self.strip(kerbs,start,min(start+2,d+span),side*6.5,side*7.5,i%2,lift=.60)
        kerbs.create_object("Shanghai_Kerbs",[self.m["red"],self.m["white"]],self.c["Circuit"])
        return samples,ranges

    def pit_lane(self):
        _,_,_,samples = base.create_ribbon("Shanghai_Pit_Lane",self.pit,self.raster,self.center,0,8,
            self.m["asphalt"],self.c["Circuit"],interval=2,closed=False,taper_meters=24,
            minimum_start_width=4,minimum_end_width=4,z_offset=.45)
        building = next(f for f in self.features if f["id"]==156328694)
        projected = [helpers.nearest_distance(self.pit,self.pc,p) for p in building["world"]]
        first,last = min(projected)+3,max(projected)-3
        bays = 36 # 33 numbered team/FOM garages + FIA A/B/C, current FIA drawing.
        team_colors = [( .06,.06,.065,1),(.025,.14,.34,1),(.56,.015,.025,1),(.77,.77,.73,1),
            (.015,.25,.18,1),(.10,.24,.72,1),(.025,.15,.58,1),(.68,.015,.025,1),
            (.04,.09,.20,1),(.025,.22,.24,1),(.94,.40,.015,1),(.65,.65,.63,1)]
        for i in range(bays+1):
            d = first+(last-first)*i/bays
            self.strip(self.paint,d,d+.15,-3.8,-.5,pit=True,lift=.59)
        for d in range(math.ceil(first),math.floor(last),3):
            self.strip(self.paint,d,min(d+2,last),-.65,-.81,pit=True,lift=.59)
        wall,quality = base.create_pit_wall(self.pit,self.line,self.raster,self.center,0,
            [self.m["concrete"],self.m["fence"]],self.c["Circuit"],start_ratio=(first-15)/self.pt,
            end_ratio=(last+15)/self.pt,wall_height=1.15,fence_height=2.05)
        wall.name="Shanghai_Pit_Wall";wall.data.name="Shanghai_Pit_Wall_Mesh"
        for i in range(bays):
            d = first+(last-first)*(i+.5)/bays
            p = self.surface(d,-9.2,True)
            tangent = base.sample_tangent(self.pit,self.pc,d,closed=False)
            along = Vector((tangent.x,tangent.y,0))*(last-first)/bays*.47
            for lower,upper,color in [(0,3.6,(.20,.22,.23,1)),(3.6,4.25,team_colors[min(11,i//3)])]:
                self.props.add_quad([Vector(p)-along+Vector((0,0,lower)),Vector(p)+along+Vector((0,0,lower)),
                    Vector(p)+along+Vector((0,0,upper)),Vector(p)-along+Vector((0,0,upper))],color=color)
        return {"pitGarageBoxes":33,"fiaGarageBays":3,"frontageDistancesMeters":[first,last],"wall":quality,
                "entryGapMeters":base.distance_to_polyline(self.pit[0],self.line),
                "exitGapMeters":base.distance_to_polyline(self.pit[-1],self.line),
                "surfaceClearance":base.measure_ribbon_terrain_clearance(samples,self.raster,0)}

    def grandstands(self):
        structure,seats,roof = base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        seat_uvs=[];rendered=[];excluded=[];canopies=0
        for f in self.features:
            if f["tags"].get("grandstand")!="yes":
                continue
            polygon=f["world"][:-1]
            if base.polygon_intersects_corridors(polygon,self.corridors):
                excluded.append({"id":f["id"],"reason":"mapped terrace intersects track/pit corridor"})
                continue
            main=f["id"]==107371135
            lotus=f["id"] in (1372223261,1372223262)
            edge=max(zip(polygon,polygon[1:]+polygon[:1]),key=lambda ab:math.dist(*ab))
            axis=(Vector(edge[1])-Vector(edge[0])).normalized()
            if lotus:
                cx=sum(p[0]for p in polygon)/len(polygon);cy=sum(p[1]for p in polygon)/len(polygon)
                xx=sum((p[0]-cx)**2 for p in polygon);yy=sum((p[1]-cy)**2 for p in polygon)
                xy=sum((p[0]-cx)*(p[1]-cy)for p in polygon)
                angle=.5*math.atan2(2*xy,xx-yy)
                axis=Vector((math.cos(angle),math.sin(angle)))
            normal=Vector((-axis.y,axis.x))
            ring=[(Vector(p).dot(axis),Vector(p).dot(normal)) for p in polygon]
            lo,hi=min(u for u,v in ring),max(u for u,v in ring)
            front,rear=min(v for u,v in ring),max(v for u,v in ring)
            if base.distance_to_polyline(axis*((lo+hi)/2)+normal*front,self.line)>base.distance_to_polyline(axis*((lo+hi)/2)+normal*rear,self.line):
                front,rear=rear,front
            sections=max(1,math.ceil((hi-lo)/10))
            built_rows=seat_count=0
            for section in range(sections):
                left,right=lo+(hi-lo)*section/sections+.12,lo+(hi-lo)*(section+1)/sections-.12
                middle=(left+right)/2
                for lower,upper in tools.polygon_scanline_spans(ring,middle):
                    near,far=(lower,upper) if front<rear else (upper,lower)
                    rows=max(3,min(36,round(abs(far-near)/.9)))
                    ground=max(self.ground(axis*u+normal*v)for u,v in [(left,near),(right,far)])
                    floor=ground+(2.4 if main else .7)
                    rise=.60 if main else .43
                    for row in range(rows):
                        a=near+(far-near)*row/rows;b=near+(far-near)*(row+1)/rows
                        points=[axis*u+normal*v for u,v in [(left,a),(right,a),(right,b),(left,b)]]
                        if not all(base.point_in_polygon(p,polygon) or base.distance_point_polygon(p,polygon)<.2 for p in points):
                            continue
                        z=max(floor+row*rise,max(self.ground(p) for p in points)+.18)
                        structure.add_quad([(*self.xy(p),z)for p in points],color=(.63,.64,.62,1))
                        structure.add_quad([(*self.xy(points[0]),z-rise),(*self.xy(points[1]),z-rise),
                                            (*self.xy(points[1]),z),(*self.xy(points[0]),z)],color=(.57,.58,.56,1))
                        # Red/gold/white main seats in the architect and FIA pit photographs.
                        palette=[(.78,.045,.035,1),(.88,.61,.065,1),(.85,.86,.80,1)] if main else [(.74,.06,.05,1),(.80,.62,.20,1),(.77,.79,.75,1)]
                        color=palette[(row//4+section//3)%3]
                        p=axis*left+normal*((a+b)/2);q=axis*right+normal*((a+b)/2)
                        fore=normal*.21;corners=[p-fore,q-fore,q+fore,p+fore]
                        seats.add_quad([(*self.xy(p),z+.15)for p in corners],color=color)
                        seats.add_quad([(*self.xy(p),zz) for p,zz in [(corners[2],z+.15),(corners[3],z+.15),
                            (corners[3],z+.51),(corners[2],z+.51)]],color=color)
                        n=max(1,round((right-left)/.53))
                        for _ in range(2):seat_uvs.extend([(0,0),(n,0),(n,1),(0,0),(n,1),(0,1)])
                        built_rows+=1;seat_count+=n
                    # Grounded crossframes and rear bracing support every terrace block.
                    for u in (left+.3,right-.3):
                        p=axis*u+normal*far;q=axis*u+normal*near
                        z=floor+rows*rise
                        tools.beam(structure,(*self.xy(p),self.ground(p)),(*self.xy(p),z),.18,(.54,.56,.55,1))
                        tools.beam(structure,(*self.xy(q),self.ground(q)),(*self.xy(p),z),.13,(.50,.52,.51,1))
                    if lotus and section%2==0:
                        midpoint=axis*middle+normal*((near+far)/2)
                        x,y=self.xy(midpoint);h=max(self.ground(p)for p in polygon)+24
                        root=(x,y,h-1.8)
                        tools.beam(structure,(x,y,ground),root,.38,(.67,.69,.66,1));canopies+=1
            if lotus:
                # The observed scalloped canopy boundary is independent of the
                # terrace seating. Keep every roof vertex inside that boundary.
                level=max(self.ground(p)for p in polygon)+24
                points=[]
                for p in polygon:
                    distance=Vector(p).dot(axis)-lo
                    points.append(Vector((*self.xy(p),level+.75*math.cos(distance*math.tau/20))))
                for triangle in base.resolved_tessellation([points]):
                    if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:triangle=list(reversed(triangle))
                    roof.add_triangle(triangle)
            rendered.append({"osmWayId":f["id"],"name":f["tags"].get("name:en",f["tags"].get("name","E terrace")),
                "footprint":polygon,"rowsBuilt":built_rows,"seatsBuilt":seat_count,
                "minimumTrackClearanceMeters":base.minimum_polygon_track_clearance(polygon,self.corridors[0][0],6.5),
                "dimensionsEstimated":True})
        structure.create_object("Shanghai_Grandstands",[self.m["vertex"]],self.c["Grandstands"],vertex_colors=True)
        obj=seats.create_object("Shanghai_Textured_Seat_Rows",[self.m["seats"]],self.c["Grandstands"],vertex_colors=True)
        uv=obj.data.uv_layers.new(name="SeatShellUV")
        for loop,p in zip(obj.data.loops,seat_uvs):uv.data[loop.index].uv=p
        roof_object=roof.create_object("Shanghai_Lotus_Canopies",[self.m["terrain"]],self.c["Grandstands"])
        tools.aerial_uv(roof_object,self.center,self.config["model"]["bounds"])
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,"lotusCanopies":canopies,
                "seatColorMethod":"Tilke/FIA source photographs; red/gold/white permanent seating, simplified row pattern"}

    def buildings(self):
        walls,roofs,frames=base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        rendered=[];excluded=[];pavilions=0
        for f in self.features:
            tags=f["tags"]
            if not tags.get("building") or tags.get("grandstand")=="yes":continue
            poly=f["world"][:-1] if f["world"][0]==f["world"][-1] else f["world"]
            if len(poly)<3:continue
            if base.polygon_intersects_corridors(poly,self.corridors) or any(base.polygons_overlap(poly,p) for p in self.reserved):
                excluded.append({"id":f["id"],"reason":"driving corridor or reserved grandstand"});continue
            pit=f["id"]==156328694
            pavilion=f["id"] in {c["wayId"] for c in self.config["rasterRegistration"]["buildingCorrections"]}
            try:height=float(tags.get("height",float(tags.get("building:levels",1))*3.4))
            except ValueError:height=3.4
            low=max(self.ground(p)for p in poly);floor=low+(.8 if pavilion else 0)
            height=16 if pit else height
            facade=(.17,.34,.35,1) if pavilion else (.75,.76,.72,1) if pit else (.59,.61,.58,1)
            for a,b in zip(poly,poly[1:]+poly[:1]):
                walls.add_quad([(*self.xy(a),floor),(*self.xy(b),floor),(*self.xy(b),floor+height),(*self.xy(a),floor+height)],color=facade)
                if pavilion or pit:
                    for dz in [.25,height*.45,height*.80]:
                        tools.beam(frames,(*self.xy(a),floor+dz),(*self.xy(b),floor+dz),.045,(.73,.75,.72,1))
            # Pavilions have individual metal hipped roofs, not cuboid tops.
            cx=sum(p[0]for p in poly)/len(poly);cy=sum(p[1]for p in poly)/len(poly)
            peak=(*self.xy((cx,cy)),floor+height+(1.25 if pavilion else .6))
            roof_color=(.70,.73,.77,1) if pavilion else (.79,.80,.76,1) if pit else self.source_color((cx,cy))
            for a,b in zip(poly,poly[1:]+poly[:1]):
                roofs.add_triangle([(*self.xy(a),floor+height),(*self.xy(b),floor+height),peak],color=roof_color)
            if pavilion:
                pavilions+=1
                for p in poly:
                    tools.beam(frames,(*self.xy(p),self.ground(p)-.25),(*self.xy(p),floor+.2),.20,(.48,.50,.48,1))
            rendered.append({"osmWayId":f["id"],"name":tags.get("name:en",tags.get("name")),"heightMeters":height,
                "heightMethod":"OSM height/levels; 3.4 m reconstruction fallback", "footprint":poly,
                "pavilion":pavilion,"facadeColor":facade[:3]})
        walls.create_object("Shanghai_Buildings",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        roof_object=roofs.create_object("Shanghai_Source_Roofs",[self.m["terrain"]],self.c["Infrastructure"])
        tools.aerial_uv(roof_object,self.center,self.config["model"]["bounds"])
        frames.create_object("Shanghai_Pavilion_Frames",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,"overWaterPavilions":pavilions,
                "remainingDrivingCorridorConflicts":0,"lod2Available":False}

    def main_complex(self):
        f=next(f for f in self.features if f["id"]==107371135)
        polygon=f["combinedRoofWorld"][:-1]
        roof,structure=base.MeshBuilder(),base.MeshBuilder()
        level=max(self.ground(p)for p in polygon)+35
        # The U-shaped source footprint reserves the open middle of the straight.
        for triangle in base.resolved_tessellation([[Vector((*self.xy(p),level))for p in polygon]]):
            if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:triangle=list(reversed(triangle))
            roof.add_triangle(triangle,color=(.89,.90,.86,1))
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            roof.add_quad([(*self.xy(a),level-.65),(*self.xy(b),level-.65),(*self.xy(b),level),(*self.xy(a),level)],color=(.76,.78,.75,1))
        # Two observed bridge arms, each with a glazed elliptic media lounge.
        bridges=[]
        for indices in [(14,19),(6,11)]:
            p,q=[polygon[i] for i in indices]
            midpoint=Vector(((p[0]+q[0])/2,(p[1]+q[1])/2))
            near=helpers.nearest_distance(self.line,self.cum,midpoint)
            tangent=base.sample_tangent(self.line,self.cum,near)
            axis=Vector((tangent.x,tangent.y));normal=Vector((-axis.y,axis.x))
            center=Vector(base.sample_polyline(self.line,self.cum,near))
            z=self.surface(near)[2]+15
            outline=[center+axis*(math.cos(i*math.tau/32)*12)+normal*(math.sin(i*math.tau/32)*65)for i in range(32)]
            for a,b in zip(outline,outline[1:]+outline[:1]):
                structure.add_quad([(*self.xy(a),z),(*self.xy(b),z),(*self.xy(b),z+6),(*self.xy(a),z+6)],color=(.19,.38,.39,1))
                for dz in [1,3,5]:tools.beam(self.props,(*self.xy(a),z+dz),(*self.xy(b),z+dz),.035,(.75,.77,.73,1))
                roof.add_triangle([(*self.xy(a),z+6),(*self.xy(b),z+6),(*self.xy(center),z+6.5)],color=(.86,.87,.84,1))
            bridges.append({"distanceMeters":near,"roadToSoffitClearanceMeters":15,"heightEstimated":True})
            for side in [-1,1]:
                foot=center+normal*side*56
                tools.beam(self.props,(*self.xy(foot),self.ground(foot)),(*self.xy(foot),level),.6,(.68,.70,.67,1))
        # Red and gold lantern cylinders are observed on the main roof.
        terrace=f["world"][:-1]
        west=Vector(terrace[0]);east=Vector(terrace[1]);rearwest=Vector(terrace[-1]);reareast=Vector(terrace[-2])
        for i in range(10):
            t=(i+.5)/10;front=west*(1-t)+east*t;rear=rearwest*(1-t)+reareast*t
            p=front*.4+rear*.6;x,y=self.xy(p)
            self.props.add_cylinder((x,y,level-2.6),2.6,3.2,sides=12,color=(.77,.06,.04,1) if i%2==0 else (.84,.57,.08,1))
        roof_object=roof.create_object("Shanghai_Main_Grandstand_Roof",[self.m["terrain"]],self.c["Grandstands"])
        tools.aerial_uv(roof_object,self.center,self.config["model"]["bounds"])
        structure.create_object("Shanghai_Media_Bridges",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        return {"sourceOsmWayId":107371135,"roofHeightMeters":35,"heightMethod":"OSM height; reconstructed section",
                "bridges":bridges,"lanterns":10,"roofProfileEstimated":True}

    def infrastructure(self):
        steel,fences=base.MeshBuilder(),base.MeshBuilder();panels=0
        for f in self.features:
            kind=f["tags"].get("barrier")
            if kind not in ("fence","wall","guard_rail","retaining_wall"):continue
            for a,b in zip(f["world"],f["world"][1:]):
                count=max(1,math.ceil(math.dist(a,b)/5))
                for i in range(count):
                    p=[a[k]+(b[k]-a[k])*i/count for k in [0,1]];q=[a[k]+(b[k]-a[k])*(i+1)/count for k in [0,1]]
                    if any(base.distance_to_polyline(probe,path)<width+.3 for probe in [p,q] for path,width in self.corridors):continue
                    za,zb=self.ground(p),self.ground(q)
                    if kind=="fence":
                        fences.add_quad([(*self.xy(p),za),(*self.xy(q),zb),(*self.xy(q),zb+2.6),(*self.xy(p),za+2.6)])
                        tools.beam(steel,(*self.xy(p),za),(*self.xy(p),za+2.6),.07,(.55,.58,.55,1))
                    else:
                        for dz in [.4,.75,1.1]:
                            steel.add_quad([(*self.xy(p),za+dz-.08),(*self.xy(q),zb+dz-.08),(*self.xy(q),zb+dz+.08),(*self.xy(p),za+dz+.08)],color=(.69,.70,.66,1))
                    panels+=1
        steel.create_object("Shanghai_Guardrails",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        fences.create_object("Shanghai_Catch_Fences",[self.m["fence"]],self.c["Infrastructure"])
        return {"mappedBarrierPanels":panels}


def export_asset(path):
    """Keep sub-millimetre height precision even on tight hairpin triangles."""
    from io_scene_gltf2.io.exp import meshopt
    original=meshopt.MeshoptEncoder.encode_attribute
    def precise(name,data,stride,settings):
        bits,mode=meshopt.EXP_FILTER_BITS,meshopt.ENCODE_EXP_SHARED_VECTOR
        try:
            if name=="POSITION":meshopt.EXP_FILTER_BITS=22
            elif name=="NORMAL":meshopt.EXP_FILTER_BITS=9
            elif name.startswith("COLOR_"):
                meshopt.EXP_FILTER_BITS=8
                return original("POSITION",data,stride,settings)
            elif name.startswith("TEXCOORD_"):
                meshopt.EXP_FILTER_BITS=16
                meshopt.ENCODE_EXP_SHARED_VECTOR=meshopt.ENCODE_EXP_SHARED_COMPONENT
                return original("POSITION",data,stride,settings)
            return original(name,data,stride,settings)
        finally:
            meshopt.EXP_FILTER_BITS=bits;meshopt.ENCODE_EXP_SHARED_VECTOR=mode
    meshopt.MeshoptEncoder.encode_attribute=staticmethod(precise)
    try:
        bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",export_apply=True,
            export_yup=True,export_cameras=False,export_lights=False,export_animations=False,
            export_extras=True,export_materials="EXPORT",export_image_format="AUTO",export_all_vertex_colors=False,
            export_meshopt_compression_enable=True,export_meshopt_extension="EXT_meshopt_compression",
            export_copyright=tools.COPYRIGHT)
    finally:
        meshopt.MeshoptEncoder.encode_attribute=staticmethod(original)


def main():
    args=base.parse_args();config=json.loads(Path(args.input).read_text());prepared=Path(args.prepared)
    raster_meta=json.loads((prepared / "raster-metadata.json").read_text())
    raster=base.HeightRaster(prepared / "shanghai-dtm.f32le",raster_meta["rasters"]["dtm"],config["model"]["bounds"])
    raster.profiles=json.loads((prepared / "shanghai-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    c=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=1
    scene["coordinate_reference_system"]="EPSG:32651"
    scene["real_world_scale"]="1 unit = 1 metre; no vertical exaggeration"
    grain=helpers.texture("Shanghai_Mineral_Surface");facade=helpers.texture("Shanghai_Facade_Detail","facade")
    metal=helpers.texture("Shanghai_Metal_Roof_Seams","metal")
    m={"terrain":base.create_aerial_material(prepared / "shanghai-orthophoto.jpg"),
       "asphalt":tools.textured_material("Shanghai_Asphalt",(.32,.32,.31,1),grain),
       "white":tools.textured_material("Shanghai_White_Paint",(.91,.92,.88,1),grain),
       "red":tools.textured_material("Shanghai_Red_Kerbs",(.77,.045,.035,1),grain),
       "black":tools.textured_material("Shanghai_Checker_Black",(.05,.05,.05,1),grain),
       "concrete":tools.textured_material("Shanghai_Pit_Concrete",(.65,.66,.62,1),grain),
       "vertex":tools.textured_material("Shanghai_Source_Colored_Objects",(1,1,1,1),grain,vertex=True),
       "facade":tools.textured_material("Shanghai_Textured_Facades",(1,1,1,1),facade,vertex=True),
       "metal":tools.textured_material("Shanghai_Textured_Metal_Roofs",(1,1,1,1),metal,vertex=True),
       "fence":helpers.fence_material(),"seats":tools.seating_material(),"sectors":[],"halos":[]}
    m["terrain"].name="Shanghai_Planet_Registered_Ground";m["fence"].name="Shanghai_Chain_Link_Fence";m["seats"].name="Shanghai_Colored_Seat_Rows"
    for i,color in enumerate([(.80,.02,.015,1),(.97,.43,.02,1),(.02,.56,.72,1)]):
        m["sectors"].append(base.create_material(f"Shanghai_Sector_{i+1}",tools.linear(color),.8))
        m["halos"].append(base.create_material(f"Shanghai_Sector_{i+1}_Glow",(*tools.linear(color)[:3],.30),.5,emission_strength=1.3))
    aerial=next(n.image for n in m["terrain"].node_tree.nodes if n.type=="TEX_IMAGE")
    model=ShanghaiScene(config,raster,c,m,aerial)
    model.terrain();samples,curbs=model.road();pit=model.pit_lane()
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Shanghai road intersects terrain: {clearance}; pit: {pit['surfaceClearance']}")
    stands=model.grandstands();buildings=model.buildings();complex_data=model.main_complex()
    infrastructure=model.infrastructure();vegetation=model.vegetation();profile,low,high=model.annotations()
    for obj in bpy.data.objects:
        obj.name=obj.name.replace("Suzuka_","Shanghai_")
        if obj.type=="MESH":
            obj.data.name=obj.data.name.replace("Suzuka_","Shanghai_")
            tools.uv_surface(obj,2)
    for img in bpy.data.images:img.name=img.name.replace("Suzuka_","Shanghai_").replace("Mexico_","Shanghai_")
    scene.render.engine="BLENDER_EEVEE";scene.render.resolution_x=1600;scene.render.resolution_y=1300
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format="WEBP"
    scene.render.image_settings.color_mode="RGBA";scene.render.image_settings.quality=93
    scene.view_settings.view_transform="Standard";scene.view_settings.look="None"
    scene.world=bpy.data.worlds.new("Shanghai_World");scene.world.color=(.10,.12,.13)
    base.add_lighting(c["Terrain"])
    camera_data=bpy.data.cameras.new("ShanghaiPreview");camera_data.type="ORTHO";camera_data.ortho_scale=2100;camera_data.clip_end=10000
    camera=bpy.data.objects.new("ShanghaiPreview",camera_data);c["Terrain"].objects.link(camera)
    camera.location=(0,-600,2300);base.look_at(camera,(0,0,12));scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    for img in bpy.data.images:
        if img.source=="FILE":img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(camera_data)
    export_asset(Path(args.glb).resolve())
    metadata={"schemaVersion":4,"modelId":"shanghai","generatedWith":f"Blender {bpy.app.version_string}",
        "coordinateReferenceSystem":"EPSG:32651","verticalDatum":"EGM2008 orthometric metres (EPSG:3855)",
        "verticalExaggeration":1,"realWorldScale":"1 unit = 1 metre; no vertical exaggeration",
        "originMeters":config["model"]["center"],"boundsMeters":{"width":1740,"depth":1620},
        "lapLength":{"geometryMeters":model.total,"officialFiaMeters":5451,"relativeErrorPercent":abs(model.total-5451)/5451*100},
        "elevationApproximate":True,"elevationProfile":profile,"elevationsMeters":{"low":low["elevationMeters"],"high":high["elevationMeters"]},
        "finishDistanceMeters":0,"raceStartDistanceMeters":130,"baseElevationMeters":0,
        "sectorBoundaryDistancesMeters":config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        "objects":{"turnAnchors":16,"pitGarageBoxes":33,"fiaGarageBays":3,"buildingsTotal":buildings["count"],
            "grandstandFootprints":stands["count"],"overWaterPavilions":buildings["overWaterPavilions"],"raceMotorhomes":0,
            "mainComplex":complex_data,**infrastructure,**vegetation},
        "layoutQuality":{"surfaceClearance":clearance,"pitLane":pit,"grandstands":stands,"buildings":buildings,
            "curbs":curbs,"terrainSurface":raster_meta["terrainSurface"],"roadGrading":raster_meta["roadGrading"]},
        "materials":{"physicalObjectsTextured":True,"roofMethod":"embedded registered SkySat roof imagery with metric UV projection on pit, pavilion, building, main-grandstand and lotus-canopy roofs",
            "colorSpace":"source sRGB converted once to linear vertex colors","facadeMethod":"source glass/concrete colors and authored mullion texture; no facade photogrammetry"},
        "controlPointReference":config["officialControlPoints"],"sourceManifest":config["sourceManifest"],
        "rasterRegistration":config["rasterRegistration"],"assetLicense":"CC BY-SA 4.0",
        "limitations":config["limitations"],"publicationStatus":"review-required"}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"lapLength":metadata["lapLength"],"objects":metadata["objects"],"clearance":clearance}),flush=True)


if __name__=="__main__":main()
