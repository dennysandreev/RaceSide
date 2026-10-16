#!/usr/bin/env python3
"""Build the real-scale COTA scene from pinned OSM, NAIP and USGS sources."""

from bisect import bisect_right
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("austin_mesh_tools", SCRIPTS / "build-zandvoort-digital-twin.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 241, 171
base.PIT_LANE_WIDTH_METERS = 8


def linear(color):
    return tuple(value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4 for value in color[:3]) + (color[3],)


class SourceColorMesh(base.MeshBuilder):
    def add_triangle(self, triangle, material_index=0, color=None):
        super().add_triangle(triangle, material_index, linear(color) if color is not None else None)


base.MeshBuilder = SourceColorMesh


def road_section(points, cumulative, distance, raster, datum, width, z_offset=.55, closed=True, banked=False):
    point = base.sample_polyline(points, cumulative, distance, closed=closed)
    tangent = base.sample_tangent(points, cumulative, distance, closed=closed)
    profile = raster.profiles[0 if closed else 1]
    d = distance % cumulative[-1] if closed else min(max(distance, 0), cumulative[-1])
    steps, values = profile["distanceMeters"], profile["elevationMeters"]
    i = min(max(bisect_right(steps, d)-1, 0), len(steps)-2)
    blend = (d-steps[i]) / max(steps[i+1]-steps[i], 1e-9)
    elevation = values[i]*(1-blend)+values[i+1]*blend
    return point, tangent, Vector((-tangent.y, tangent.x)), elevation-datum+z_offset, 0


base.road_cross_section = road_section


def beam(builder, a, b, radius=.13, color=(.52,.55,.55,1)):
    a, b = Vector(a), Vector(b)
    axis = b-a
    if axis.length < .01:
        return
    axis.normalize()
    u = axis.cross(Vector((0,0,1)))
    if u.length < .01:
        u = axis.cross(Vector((0,1,0)))
    u.normalize()
    v = axis.cross(u)
    ring = [u*radius, v*radius, -u*radius, -v*radius]
    for i in range(4):
        builder.add_quad([a+ring[i], b+ring[i], b+ring[(i+1)%4], a+ring[(i+1)%4]], color=color)


def aerial_uv(obj, center, bounds):
    uv = obj.data.uv_layers.new(name="NAIP22_AerialUV")
    width, height = bounds["maxX"]-bounds["minX"], bounds["maxY"]-bounds["minY"]
    for loop in obj.data.loops:
        p = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x+center["x"]-bounds["minX"])/width,
                                   (p.y+center["y"]-bounds["minY"])/height)


def terrain_mesh(config, raster, material, collection, prepared):
    """Refine shared terrain cells beside the two roads without changing scale."""
    refine=json.loads((prepared/"austin-terrain-refinement.json").read_text())
    bounds=config["model"]["bounds"]
    center=config["model"]["center"]
    builder=base.MeshBuilder()
    def xyz(x,y):
        return (x-1200,y-850,raster.sample(bounds["minX"]+x,bounds["minY"]+y))
    for row in range(170):
        for col in range(240):
            x,y=col*10,row*10
            if refine[row][col]:
                for dx,dy in ((0,0),(5,0),(0,5),(5,5)):
                    builder.add_quad([xyz(x+dx+a,y+dy+b) for a,b in ((0,0),(5,0),(5,5),(0,5))])
            else:
                ring=[(x,y)]
                if row>0 and refine[row-1][col]:ring.append((x+5,y))
                ring.append((x+10,y))
                if col<239 and refine[row][col+1]:ring.append((x+10,y+5))
                ring.append((x+10,y+10))
                if row<169 and refine[row+1][col]:ring.append((x+5,y+10))
                ring.append((x,y+10))
                if col>0 and refine[row][col-1]:ring.append((x,y+5))
                if len(ring)==4:
                    builder.add_quad([xyz(*p) for p in ring])
                else:
                    for a,b in zip(ring,ring[1:]+ring[:1]):
                        builder.add_triangle([xyz(x+5,y+5),xyz(*a),xyz(*b)])
    obj=builder.create_object("Austin_USGS_Terrain",[material],collection)
    aerial_uv(obj,center,bounds)
    for polygon in obj.data.polygons:polygon.use_smooth=True
    bvh=BVHTree.FromPolygons([v.co for v in obj.data.vertices],
                             [tuple(p.vertices) for p in obj.data.polygons])
    def rendered(x,y):
        hit,_,_,_=bvh.ray_cast(Vector((x-center["x"],y-center["y"],1000)),Vector((0,0,-1)))
        return hit.z if hit is not None else raster.sample(x,y)
    raster.sample_rendered_terrain=rendered
    return obj


class AustinScene:
    def __init__(self, config, raster, collections, materials, building_colors):
        self.config, self.raster, self.collections, self.m = config, raster, collections, materials
        self.building_colors = building_colors
        self.center = config["model"]["center"]
        self.line, self.pit = config["model"]["centerline"], config["model"]["pitCenterline"]
        self.cum, self.total = base.line_distance(self.line)
        self.pit_cum, self.pit_total = base.line_distance(self.pit)
        self.turns = config["model"]["turns"]
        self.track_samples = base.sample_line_points(self.line, self.cum, 3)
        self.pit_samples = base.sample_line_points(self.pit, self.pit_cum, 3, closed=False)
        self.corridors = [(self.track_samples, 8.4), (self.pit_samples, 4.5)]
        self.features = {feature["id"]: feature for feature in config["vectors"]}
        self.reserved = []

    def xy(self, point):
        return base.local_xy(point, self.center)

    def ground(self, point):
        return self.raster.sample(*point)

    def surface(self, distance, lateral=0, pit=False, lift=.55):
        line, cumulative, width = (self.pit, self.pit_cum, 8) if pit else (self.line, self.cum, 15)
        return base.road_surface_point(line, cumulative, distance, lateral, self.raster,
                                       self.center, 0, width, z_offset=lift, closed=not pit)

    def strip(self, builder, start, end, left, right, material=0, pit=False, lift=.66):
        builder.add_quad([self.surface(d, offset, pit, lift) for d, offset in
                          ((start,left),(end,left),(end,right),(start,right))], material)

    def roadway(self):
        track, _, _, samples = base.create_ribbon(
            "Austin_Raceway", self.line, self.raster, self.center, 0, 15,
            self.m["asphalt"], self.collections["Circuit"], interval=2, z_offset=.55)
        track["source"] = "OSM Formula 1 centreline; 15 m width checked against NAIP 2022"
        edge = base.MeshBuilder()
        for d in range(0, math.ceil(self.total), 3):
            for side in (-1,1):
                self.strip(edge, d, min(d+3,self.total), side*7.17, side*7.36, lift=.66)
        edge.create_object("Austin_Edge_Paint", [self.m["white"]], self.collections["Circuit"])
        curbs = base.MeshBuilder()
        count = 0
        for turn in self.turns:
            d = turn["distanceMeters"]
            before = base.sample_tangent(self.line, self.cum, d-15)
            after = base.sample_tangent(self.line, self.cum, d+15)
            side = 1 if before.x*after.y-before.y*after.x > 0 else -1
            span = 18 if turn["number"] in (3,4,5,6,7,8,9,13,14,15) else 26
            for i in range(math.ceil(2*span/3)):
                start = d-span+i*3
                end = min(start+3, d+span)
                self.strip(curbs, start, end, side*7.5, side*8.28, material=i%2, lift=.69)
                count += 1
        curbs.create_object("Austin_Source_Aligned_Kerbs", [self.m["red"],self.m["white"]], self.collections["Circuit"])
        return samples, {"sections": count, "widthMeters": .78, "placement": "inner corner ranges checked on NAIP"}

    def pit_lane(self):
        pit, _, _, samples = base.create_ribbon(
            "Austin_Pit_Lane", self.pit, self.raster, self.center, 0, 8,
            self.m["asphalt"], self.collections["Circuit"], interval=2,
            closed=False, taper_meters=28, minimum_start_width=4,
            minimum_end_width=4, z_offset=.50)
        pit["source"] = "OSM way 514836373, FIA 2025 pit drawing"
        garage = self.features[376713391]["world"][:-1]
        edges = sorted(zip(garage, garage[1:]+garage[:1]), key=lambda pair: math.dist(*pair), reverse=True)
        front = min(edges[:2], key=lambda edge: sum(base.distance_to_polyline(p, self.pit) for p in edge))
        first, last = sorted(base.nearest_distance(self.pit, self.pit_cum, p) for p in front)
        first += 3
        last -= 3
        if last-first < 180:
            raise ValueError("Austin mapped garage frontage is too short")
        midpoint = base.sample_polyline(self.pit, self.pit_cum, (first+last)/2, closed=False)
        tangent = base.sample_tangent(self.pit, self.pit_cum, (first+last)/2, closed=False)
        normal = Vector((-tangent.y,tangent.x))
        garage_center = Vector(tuple(sum(p[a] for p in garage)/len(garage) for a in (0,1)))
        side = 1 if (garage_center-Vector(midpoint)).dot(normal)>0 else -1
        marks = base.MeshBuilder()
        for i in range(35):
            d = first+(last-first)*i/34
            self.strip(marks, d, d+.16, side*1.5, side*3.88, pit=True, lift=.64)
        for d in range(math.ceil(first), math.floor(last), 3):
            self.strip(marks, d, d+2, side*1.25, side*1.40, pit=True, lift=.63)
        marks.create_object("Austin_Fast_Lane_34_Boxes", [self.m["white"]], self.collections["Circuit"])
        wall, quality = base.create_pit_wall(self.pit, self.line, self.raster, self.center, 0,
            [self.m["concrete"], self.m["fence"]], self.collections["Circuit"],
            start_ratio=first/self.pit_total, end_ratio=last/self.pit_total,
            wall_height=1.05, fence_height=1.15)
        wall.name = "Austin_Pit_Wall"
        return {"lengthMeters": self.pit_total, "laneWidthMeters": 8, "pitBoxes": 34,
                "garageFrontageDistanceMeters": [first,last], "fastLaneSeparator": True,
                "pitWall": quality, "entryGapMeters": base.distance_to_polyline(self.pit[0],self.line),
                "exitGapMeters": base.distance_to_polyline(self.pit[-1],self.line),
                "surfaceClearance": base.measure_ribbon_terrain_clearance(samples,self.raster,0)}

    def grandstands(self):
        builder = base.MeshBuilder()
        details = []
        for feature in self.features.values():
            if feature["tags"].get("building") != "grandstand":
                continue
            polygon = feature["world"][:-1]
            if len(polygon) < 3 or base.polygon_intersects_corridors(polygon, self.corridors):
                raise ValueError(f"Mapped Austin grandstand {feature['id']} intersects a driving corridor")
            self.reserved.append(polygon)
            edges = sorted(zip(polygon,polygon[1:]+polygon[:1]),key=lambda edge:math.dist(*edge),reverse=True)
            a,b = Vector(edges[0][0]),Vector(edges[0][1])
            axis = (b-a).normalized()
            normal = Vector((-axis.y,axis.x))
            projections = [(Vector(point).dot(axis),Vector(point).dot(normal)) for point in polygon]
            along = [point[0] for point in projections]
            across = [point[1] for point in projections]
            lo,hi = min(along),max(along)
            front,rear = min(across),max(across)
            # Rows climb away from the track; concrete supports reach the real DTM.
            side_a = axis*((lo+hi)/2)+normal*front
            side_b = axis*((lo+hi)/2)+normal*rear
            if base.distance_to_polyline(side_a,self.line) > base.distance_to_polyline(side_b,self.line):
                front,rear = rear,front
            if feature["id"] == 460658889:
                detail = self.main_grandstand(builder, axis, normal, lo, hi, front, rear)
                details.append({"osmWayId": feature["id"], "name": "Main Grandstand",
                                "footprintSource": "OSM, aligned with NAIP 2022", **detail})
                continue
            ground = max(self.ground(point) for point in polygon)
            depth = abs(rear-front)
            rows = max(5,min(15,round(depth/2)))
            row_width = depth/rows
            for row in range(rows):
                near = front+(rear-front)*row/rows
                far = front+(rear-front)*(row+1)/rows
                z = ground+1.2+row*.58
                seat = (.69,.71,.72,1) if row%3 else (.52,.54,.56,1)
                builder.add_quad([(*self.xy(axis*x+normal*y),z) for x,y in
                    ((lo+.6,near),(hi-.6,near),(hi-.6,far),(lo+.6,far))],color=seat)
                beam(builder,(*self.xy(axis*(lo+.6)+normal*far),z-.35),
                             (*self.xy(axis*(hi-.6)+normal*far),z-.35),.11,(.35,.38,.39,1))
            for x in [lo+2+i*12 for i in range(max(1,int((hi-lo-4)/12)+1))]:
                for y in (front+row_width/2,rear-row_width/2):
                    q=axis*x+normal*y
                    beam(builder,(*self.xy(q),self.ground(q)),
                                 (*self.xy(q),ground+1.2+(rows-1)*.58),.22,(.40,.43,.44,1))
            details.append({"osmWayId": feature["id"], "name": feature["tags"].get("name"),
                            "lengthMeters": hi-lo, "depthMeters": depth, "rows": rows,
                            "footprintSource": "OSM, aligned with NAIP 2022"})
        stand = builder.create_object("Austin_Mapped_Grandstands", [self.m["vertex"]], self.collections["Grandstands"], vertex_colors=True)
        if stand.data.validate(clean_customdata=False):
            raise ValueError("Austin grandstand mesh contains invalid or duplicate faces")
        return {"sections": sum(item["rows"] for item in details), "footprints": details,
                "minimumTrackClearanceMeters": min(base.minimum_polygon_track_clearance(poly,self.track_samples,7.5) for poly in self.reserved)}

    def main_grandstand(self, builder, axis, normal, lo, hi, front, rear):
        """OSM 311 m footprint: open end risers and the measured ~150 m central canopy."""
        length, depth = hi-lo, abs(rear-front)
        covered_lo, covered_hi = lo+length*.20, lo+length*.69
        count = math.ceil(length/7.5)
        columns = [lo+length*i/count for i in range(count+1)]
        def world(x, across):
            return axis*x+normal*(front+(rear-front)*across)
        def vertex(x, across, height):
            return (*self.xy(world(x, across)), height)
        def earth(x, across):
            return self.ground(world(x, across))
        supports = 0
        for left, right in zip(columns, columns[1:]):
            covered = covered_lo <= (left+right)/2 <= covered_hi
            lower_depth, lower_rows = (.58, 10) if covered else (1, 16)
            for row in range(lower_rows):
                near, far = lower_depth*row/lower_rows, lower_depth*(row+1)/lower_rows
                z_left = earth(left,near)+.45+row*.24
                z_right = earth(right,near)+.45+row*.24
                builder.add_quad([vertex(left,near,z_left),vertex(right,near,z_right),
                                  vertex(right,far,z_right),vertex(left,far,z_left)],
                                 color=(.57,.59,.58,1) if row%3 else (.42,.45,.46,1))
            if covered:
                for row in range(8):
                    near, far = .58+.30*row/8, .58+.30*(row+1)/8
                    z_left = earth(left,near)+8.4+row*.28
                    z_right = earth(right,near)+8.4+row*.28
                    builder.add_quad([vertex(left,near,z_left),vertex(right,near,z_right),
                                      vertex(right,far,z_right),vertex(left,far,z_left)],
                                     color=(.50,.53,.55,1) if row%2 else (.67,.69,.68,1))
                # The middle concourse and enclosed suites make the covered
                # section a three-level building rather than a floating roof.
                builder.add_quad([vertex(left,.56,earth(left,.56)+6.7),
                                  vertex(right,.56,earth(right,.56)+6.7),
                                  vertex(right,.96,earth(right,.96)+6.7),
                                  vertex(left,.96,earth(left,.96)+6.7)],color=(.40,.43,.43,1))
                for bottom, top, color in ((6.7,7.15,(.33,.37,.38,1)),
                                           (7.15,10.8,(.17,.24,.26,1)),
                                           (10.8,11.25,(.65,.67,.65,1))):
                    builder.add_quad([vertex(left,.93,earth(left,.93)+bottom),
                                      vertex(right,.93,earth(right,.93)+bottom),
                                      vertex(right,.93,earth(right,.93)+top),
                                      vertex(left,.93,earth(left,.93)+top)],color=color)
        for x in columns:
            covered = covered_lo <= x <= covered_hi
            for across, rise in ((.25,1.5),(.58,9.0) if covered else (.60,3.2),(1,11.3) if covered else (1,5.0)):
                foot = earth(x,across)
                beam(builder,vertex(x,across,foot),vertex(x,across,foot+rise),
                     .20,(.40,.44,.45,1))
                supports += 1
            lower_back = .58 if covered else 1
            beam(builder,vertex(x,0,earth(x,0)),
                 vertex(x,lower_back,earth(x,lower_back)+(2.7 if covered else 4.1)),
                 .13,(.40,.44,.45,1))
        # The 500 ft central structure is supported at the rear; its 50 ft
        # cantilever carries a shallow PTFE-like membrane, not a solid slab.
        canopy_bays = 15
        canopy_nodes = [covered_lo+(covered_hi-covered_lo)*i/canopy_bays for i in range(canopy_bays+1)]
        def roof_height(x, across):
            return earth(x,1)+(14.2 if across==0 else 16.2 if across==.5 else 14.8)
        for left,right in zip(canopy_nodes,canopy_nodes[1:]):
            for near,far in ((0,.5),(.5,1)):
                builder.add_quad([vertex(left,near,roof_height(left,near)),
                                  vertex(right,near,roof_height(right,near)),
                                  vertex(right,far,roof_height(right,far)),
                                  vertex(left,far,roof_height(left,far))],color=(.83,.84,.81,1))
        for x in canopy_nodes:
            ground = earth(x,1)
            beam(builder,vertex(x,1,ground),vertex(x,1,roof_height(x,1)),.28,(.74,.77,.76,1))
            beam(builder,vertex(x,1,roof_height(x,1)),vertex(x,.5,roof_height(x,.5)),.18,(.74,.77,.76,1))
            beam(builder,vertex(x,.5,roof_height(x,.5)),vertex(x,0,roof_height(x,0)),.18,(.74,.77,.76,1))
            beam(builder,vertex(x,1,ground+8),vertex(x,.5,roof_height(x,.5)),.16,(.48,.52,.53,1))
            supports += 1
        for x in (covered_lo+18,covered_hi-18):
            beam(builder,vertex(x,1,earth(x,1)),vertex(x,1,roof_height(x,1)),.20,(.72,.025,.018,1))
        return {"lengthMeters":length,"depthMeters":depth,"rows":18,
                "endLowerRows":16,"coveredLengthMeters":covered_hi-covered_lo,
                "canopyBays":canopy_bays,"groundAnchoredSupports":supports,
                "supportGroundGapMeters":0,
                "reference":"Miró Rivera Main Grandstand section; AISC 2013 steel canopy"}

    def amphitheater_bleachers(self):
        """Raise the five mapped Grand Plaza seating terraces above the aerial."""
        builder = base.MeshBuilder()
        stage = self.features[847781223]["world"][:-1]
        stage_center = Vector(tuple(sum(point[i] for point in stage)/len(stage) for i in (0,1)))
        details = []
        for feature in self.features.values():
            if feature["tags"].get("leisure") != "bleachers":
                continue
            polygon = feature["world"][:-1]
            # OSM also traces lower seating inside the already modeled Main Grandstand.
            if any(base.polygons_overlap(polygon, reserved) for reserved in self.reserved):
                continue
            if base.polygon_intersects_corridors(polygon, self.corridors):
                raise ValueError(f"Austin bleachers {feature['id']} intersect a driving corridor")
            edges = sorted(zip(polygon, polygon[1:]+polygon[:1]),
                           key=lambda edge: math.dist(*edge), reverse=True)
            direction = (Vector(edges[0][1])-Vector(edges[0][0])).normalized()
            normal = Vector((-direction.y,direction.x))
            projected = [(Vector(point).dot(direction),Vector(point).dot(normal)) for point in polygon]
            front,rear = min(point[1] for point in projected),max(point[1] for point in projected)
            front_center = direction*(sum(point[0] for point in projected)/len(projected))+normal*front
            rear_center = direction*(sum(point[0] for point in projected)/len(projected))+normal*rear
            if (front_center-stage_center).length > (rear_center-stage_center).length:
                front,rear = rear,front
            rows = max(5,min(13,round(abs(rear-front)/1.45)))
            def section(across):
                crossings = []
                for a,b in zip(projected,projected[1:]+projected[:1]):
                    if (a[1] <= across < b[1]) or (b[1] <= across < a[1]):
                        t = (across-a[1])/(b[1]-a[1])
                        crossings.append(a[0]+(b[0]-a[0])*t)
                crossings.sort()
                intervals = [(crossings[i],crossings[i+1]) for i in range(0,len(crossings)-1,2)]
                return max(intervals,key=lambda pair:pair[1]-pair[0]) if intervals else None
            rendered = 0
            for row in range(rows):
                near = front+(rear-front)*(row+.04)/rows
                far = front+(rear-front)*(row+.96)/rows
                near_span,far_span = section(near),section(far)
                if not near_span or not far_span or min(near_span[1]-near_span[0],far_span[1]-far_span[0]) < 2:
                    continue
                xy = [direction*x+normal*y for x,y in
                      ((near_span[0],near),(near_span[1],near),(far_span[1],far),(far_span[0],far))]
                earth = [self.ground(point) for point in xy]
                top = [(*self.xy(point),z+.38+row*.18) for point,z in zip(xy,earth)]
                foot = [(*self.xy(point),z+.03) for point,z in zip(xy,earth)]
                seat = (.55,.57,.55,1) if row%3 else (.39,.42,.42,1)
                builder.add_quad(top,color=seat)
                builder.add_quad((foot[0],foot[1],top[1],top[0]),color=(.42,.44,.43,1))
                builder.add_quad((foot[0],foot[3],top[3],top[0]),color=(.44,.46,.45,1))
                builder.add_quad((foot[2],foot[1],top[1],top[2]),color=(.44,.46,.45,1))
                rendered += 1
            if rendered == 0:
                raise ValueError(f"Austin bleachers {feature['id']} have no valid seating rows")
            self.reserved.append(polygon)
            details.append({"osmWayId":feature["id"],"rows":rendered,"groundAnchored":True})
        obj = builder.create_object("Austin_Grand_Plaza_Bleachers",[self.m["vertex"]],
                                    self.collections["Grandstands"],vertex_colors=True)
        if obj.data.validate(clean_customdata=False):
            raise ValueError("Austin Grand Plaza bleacher mesh contains invalid faces")
        obj["source"] = "OSM leisure=bleachers footprints; NAIP 2022; Miró Rivera amphitheater"
        return {"footprints":details,"sections":sum(item["rows"] for item in details)}

    def buildings(self):
        walls, roofs, details, excluded = base.MeshBuilder(), base.MeshBuilder(), [], []
        venue = self.config["venueOutline"]
        bounds = self.config["model"]["bounds"]
        for feature in self.features.values():
            tags = feature["tags"]
            if "building" not in tags or tags["building"] == "grandstand":
                continue
            polygon = feature["world"]
            if len(polygon) < 4 or polygon[0] != polygon[-1]:
                continue
            points = polygon[:-1]
            center = [sum(p[a] for p in points)/len(points) for a in (0,1)]
            if not base.point_in_polygon(center,venue):
                continue
            if base.polygon_intersects_corridors(points,self.corridors) or any(base.polygons_overlap(points,other) for other in self.reserved):
                excluded.append({"osmWayId":feature["id"],"reason":"circuit, pit or mapped stand corridor"})
                continue
            height = float(tags.get("height",15 if feature["id"]==376713391 else 10 if feature["id"]==847781223 else 5.5))
            if feature["id"] == 847781224:
                self.tower(points, walls)
                details.append({"osmWayId":feature["id"],"heightMeters":76.5,"heightSource":"OSM and COTA official tower specification"})
                continue
            ground = min(self.ground(point) for point in points)-.15
            base_ring = [(*self.xy(point),ground) for point in points]
            roof_ring = [(x,y,z+height) for x,y,z in base_ring]
            roof_color = self.building_colors.get(str(feature["id"]))
            if roof_color is None:
                raise ValueError(f"Austin building {feature['id']} lacks a NAIP roof sample")
            brightness = sum(roof_color)/3
            tone = min(.68, max(.30, .72*brightness))
            facade = tuple(tone*scale + .12*(channel-brightness)
                           for scale, channel in zip((1.04,.99,.94), roof_color)) + (1,)
            if feature["id"]==376713391:
                # COTA describes limestone team-building facades and red pit accents.
                facade = (.64,.59,.50,1)
            for i in range(len(points)):
                j=(i+1)%len(points)
                walls.add_quad([base_ring[i],base_ring[j],roof_ring[j],roof_ring[i]],color=facade)
                edge=Vector(base_ring[j])-Vector(base_ring[i])
                if edge.length > 6:
                    middle=(Vector(base_ring[i])+Vector(base_ring[j]))/2
                    beam(walls,(middle.x,middle.y,ground+height-.35),
                               (middle.x,middle.y,ground+height+.2),.15,(.38,.42,.43,1))
                if edge.length > 3:
                    beam(walls,roof_ring[i],roof_ring[j],.10,
                         tuple(max(.12,channel*.68) for channel in facade[:3])+(1,))
            for triangle in base.resolved_tessellation([[Vector(p) for p in roof_ring]]):
                roofs.add_triangle(triangle)
            if feature["id"]==376713391:
                longest = max(zip(points,points[1:]+points[:1]),key=lambda edge:math.dist(*edge))
                a,b = Vector(longest[0]),Vector(longest[1])
                direction=(b-a).normalized()
                length=(b-a).length
                for i in range(34):
                    p=a+direction*(i+.5)*length/34
                    x,y=self.xy(p)
                    walls.add_box((x,y,ground+2.6),(length/34-.35,.20,4.7),color=(.08,.12,.13,1),rotation=math.atan2(direction.y,direction.x))
                for floor in (8.8,12.2):
                    for i in range(34):
                        p=a+direction*(i+.5)*length/34
                        x,y=self.xy(p)
                        walls.add_box((x,y,ground+floor),(length/34-.25,.16,2.6),color=(.13,.24,.27,1),rotation=math.atan2(direction.y,direction.x))
                    beam(walls,(*self.xy(a),ground+floor-1.5),
                               (*self.xy(b),ground+floor-1.5),.13,(.72,.035,.025,1))
            elif feature["id"]==847781223:
                # The architect's red steel canopy fans over this mapped stage toward the tower.
                tower_points=self.features[847781224]["world"][:-1]
                tower_center=Vector(tuple(sum(point[axis] for point in tower_points)/len(tower_points)
                                          for axis in (0,1)))
                tower_ground=self.ground(tower_center)
                for point in points[:7]:
                    start=Vector(point)
                    middle=start.lerp(tower_center,.57)
                    beam(walls,(*self.xy(start),ground+height+.45),
                               (*self.xy(middle),ground+height+3.2),.18,(.72,.018,.012,1))
                    beam(walls,(*self.xy(middle),ground+height+3.2),
                               (*self.xy(tower_center),tower_ground+17),.18,(.72,.018,.012,1))
            details.append({"osmWayId":feature["id"],"name":tags.get("name"),
                            "heightMeters":height,"heightSource":"OSM" if tags.get("height") else "estimated from aerial reference",
                            "roofColorNaip":roof_color,"facadeColorEstimate":list(facade[:3])})
        walls.create_object("Austin_Current_Buildings",[self.m["vertex"]],self.collections["Buildings"],vertex_colors=True)
        roof = roofs.create_object("Austin_NAIP_Building_Roofs",[self.m["terrain"]],self.collections["Buildings"])
        aerial_uv(roof,self.center,bounds)
        return {"count":len(details),"rendered":details,"excluded":excluded,
                "roofTexture":"NAIP 2022 projected in EPSG:32614",
                "facadeMethod":"individual NAIP 2022 footprint-median roof colors, desaturated and darkened; estimated facade finish"}

    def tower(self, polygon, builder):
        center=Vector(tuple(sum(p[a] for p in polygon)/len(polygon) for a in (0,1)))
        ground=self.ground(center)
        x,y=self.xy(center)
        builder.add_cylinder((x,y,ground),4.2,69.5,sides=10,color=(.72,.75,.73,1))
        builder.add_cylinder((x,y,ground+68),8.5,3.6,sides=16,color=(.26,.33,.34,1))
        builder.add_cylinder((x,y,ground+71.6),9.2,1.2,sides=16,color=(.79,.81,.78,1))
        # Eighteen red steel tubes form the recognizable veil above the Grand Plaza.
        for i in range(18):
            angle=math.radians(-68+i*7.2)
            bottom=(x+math.cos(angle)*11,y+math.sin(angle)*11,ground)
            top=(x+math.cos(angle)*8,y+math.sin(angle)*8,ground+76.5)
            beam(builder,bottom,top,.27,(.72,.018,.012,1))
            beam(builder,top,(x,y,ground+74.8),.11,(.72,.018,.012,1))

    def infrastructure(self):
        fences=base.MeshBuilder()
        bridge=base.MeshBuilder()
        barrier_count=0
        bridge_count=0
        fence_posts=set()
        gate_count=0
        bridge_supports=0
        for feature in self.features.values():
            tags=feature["tags"]
            points=feature["world"]
            if tags.get("barrier") in ("guard_rail","fence","wall","retaining_wall"):
                height = 2.4 if tags["barrier"]=="fence" else .85
                for a,b in zip(points,points[1:]):
                    for point in (a,b):
                        if base.distance_to_polyline(point,self.line)<7.4 or base.distance_to_polyline(point,self.pit)<4.2:
                            break
                    else:
                        za,zb=self.ground(a),self.ground(b)
                        beam(fences,(*self.xy(a),za+height),(*self.xy(b),zb+height),.10,(.48,.50,.49,1))
                        if height>1:
                            beam(fences,(*self.xy(a),za+.20),(*self.xy(b),zb+.20),.07,(.46,.49,.48,1))
                        for point,ground in ((a,za),(b,zb)):
                            key=tuple(round(value,2) for value in point)
                            if key not in fence_posts:
                                beam(fences,(*self.xy(point),ground),(*self.xy(point),ground+height),
                                     .09,(.39,.42,.42,1))
                                fence_posts.add(key)
                        barrier_count += 1
            if tags.get("barrier")=="gate" and len(points)>=2:
                if all(base.distance_to_polyline(point,self.line)>8.4 and
                       base.distance_to_polyline(point,self.pit)>4.5 for point in points):
                    for point in points:
                        ground=self.ground(point)
                        beam(fences,(*self.xy(point),ground),(*self.xy(point),ground+1.65),
                             .12,(.34,.37,.37,1))
                    for a,b in zip(points,points[1:]):
                        for height in (.72,1.45):
                            beam(fences,(*self.xy(a),self.ground(a)+height),
                                 (*self.xy(b),self.ground(b)+height),.07,(.44,.47,.46,1))
                    gate_count += 1
            if tags.get("bridge")=="yes" and tags.get("highway")=="footway":
                rail_color = ((.70,.04,.025,1) if feature["id"]==191582144 else
                              (.035,.26,.56,1) if feature["id"]==191582102 else
                              (.63,.67,.66,1))
                deck=max(self.ground(point) for point in points)
                for a,b in zip(points,points[1:]):
                    midpoint=[(a[0]+b[0])/2,(a[1]+b[1])/2]
                    nearby=min(self.track_samples,key=lambda p:math.dist(p,midpoint))
                    deck=max(deck,self.ground(nearby)+6.5)
                for segment_index,(a,b) in enumerate(zip(points,points[1:])):
                    direction=(Vector(b)-Vector(a)).normalized()
                    normal=Vector((-direction.y,direction.x))
                    bottom=[(*self.xy(Vector(p)+normal*side*1.5),deck-.4) for p,side in ((a,-1),(b,-1),(b,1),(a,1))]
                    top=[(x,y,z+.4) for x,y,z in bottom]
                    bridge.add_volume(bottom,top,color=(.57,.59,.56,1))
                    for side in (-1,1):
                        aa=Vector(a)+normal*side*1.5
                        bb=Vector(b)+normal*side*1.5
                        for height in (.85,1.6):
                            beam(bridge,(*self.xy(aa),deck+height),(*self.xy(bb),deck+height),
                                 .08,rail_color)
                        for fraction in ((0,.25,.5,.75,1) if segment_index==0 else (.25,.5,.75,1)):
                            post=aa.lerp(bb,fraction)
                            beam(bridge,(*self.xy(post),deck+.4),
                                 (*self.xy(post),deck+1.6),.07,rail_color)
                    bridge_count += 1
                for endpoint in (points[0],points[-1]):
                    direction=(Vector(points[-1])-Vector(points[0])).normalized()
                    normal=Vector((-direction.y,direction.x))
                    for side in (-1,1):
                        foot=Vector(endpoint)+normal*side*1.35
                        beam(bridge,(*self.xy(foot),self.ground(foot)),
                             (*self.xy(foot),deck-.4),.24,rail_color)
                        bridge_supports += 1
        fences.create_object("Austin_Mapped_Safety_Barriers",[self.m["vertex"]],self.collections["Infrastructure"],vertex_colors=True)
        bridge_object=bridge.create_object("Austin_Mapped_Pedestrian_Bridges",[self.m["vertex"]],self.collections["Infrastructure"],vertex_colors=True)
        if bridge_object.data.validate(clean_customdata=False):
            raise ValueError("Austin pedestrian bridge mesh contains invalid or duplicate faces")
        return {"mappedBarrierSegments":barrier_count,"mappedBarrierPosts":len(fence_posts),
                "mappedGateWays":gate_count,"mappedFootbridgeSegments":bridge_count,
                "mappedFootbridgeSupports":bridge_supports,
                "footbridgeColors":{"Turn3":"red","SupportPaddock":"blue"}}

    def annotations(self):
        control=self.config["officialControlPoints"]
        collection=self.collections["Annotations"]
        for turn in self.turns:
            base.anchor_at(f"Turn_{turn['number']:02d}",turn["distanceMeters"],self.line,self.cum,self.total,
                           self.raster,self.center,0,collection,side=turn["anchorSide"],offset=22,height=6)
        base.anchor_at("SpeedTrap",control["speedTrapDistanceMeters"],self.line,self.cum,self.total,
                       self.raster,self.center,0,collection,side=-1,offset=24,height=6)
        base.anchor_at("RaceStart",0,self.line,self.cum,self.total,self.raster,self.center,0,collection,offset=20,height=6)
        marks=base.MeshBuilder()
        for i,distance in enumerate((0,*control["sectorBoundaryDistancesMeters"])):
            base.anchor_at("StartFinish" if i==0 else f"SectorBoundary_{i+1:02d}",distance,
                           self.line,self.cum,self.total,self.raster,self.center,0,collection,
                           side=1 if i!=2 else -1,offset=27,height=7)
            self.strip(marks,distance-3,distance+3,-8.5,8.5,material=i+3,lift=.74)
            if i:
                self.strip(marks,distance-.55,distance+.55,-7.5,7.5,material=i,lift=.78)
        for i in range(15):
            for j in (0,1):
                self.strip(marks,-.75+j*.75,j*.75,-7.5+i,-6.5+i,material=6+(i+j)%2,lift=.82)
        marks.create_object("Austin_Sector_Boundaries_And_Finish",
            self.m["sectors"]+self.m["halos"]+[self.m["white"],self.m["black"]],collection)
        gantry=base.MeshBuilder()
        point=Vector(base.sample_polyline(self.line,self.cum,0))
        tangent=base.sample_tangent(self.line,self.cum,0)
        normal=Vector((-tangent.y,tangent.x))
        z=self.surface(0)[2]
        for side in (-1,1):
            p=point+normal*side*9
            beam(gantry,(*self.xy(p),z),(*self.xy(p),z+7),.24,(.78,.80,.78,1))
        beam(gantry,(*self.xy(point-normal*9),z+7),(*self.xy(point+normal*9),z+7),.3,(.35,.38,.39,1))
        crossbar_rotation=math.atan2(normal.y,normal.x)
        for offset in (-4,-2,0,2,4):
            center=point+normal*offset
            front=center-tangent*.19
            gantry.add_box((*self.xy(center),z+6.22),(.72,.30,1.02),
                           color=(.06,.08,.08,1),rotation=crossbar_rotation)
            gantry.add_box((*self.xy(front),z+6.18),(.47,.08,.20),
                           color=(.78,.035,.025,1),rotation=crossbar_rotation)
        gantry.create_object("Austin_Start_Gantry",[self.m["vertex"]],collection,vertex_colors=True)
        return base.create_extrema_anchors(self.line,self.cum,self.total,self.raster,self.center,0,collection)


def export(path):
    from io_scene_gltf2.io.exp import meshopt
    original=meshopt.MeshoptEncoder.encode_attribute
    def precise(name,data,stride,settings):
        bits=meshopt.EXP_FILTER_BITS
        try:
            if name=="POSITION":meshopt.EXP_FILTER_BITS=18
            elif name.startswith("COLOR_"):
                meshopt.EXP_FILTER_BITS=8
                return original("POSITION",data,stride,settings)
            elif name.startswith("TEXCOORD_"):
                meshopt.EXP_FILTER_BITS=16
                return original("POSITION",data,stride,settings)
            elif name=="NORMAL":meshopt.EXP_FILTER_BITS=9
            return original(name,data,stride,settings)
        finally:meshopt.EXP_FILTER_BITS=bits
    meshopt.MeshoptEncoder.encode_attribute=staticmethod(precise)
    try:base.export_glb(path)
    finally:meshopt.MeshoptEncoder.encode_attribute=staticmethod(original)


def main():
    args=base.parse_args()
    config=json.loads(Path(args.input).read_text())
    prepared=Path(args.prepared)
    raster_meta=json.loads((prepared/"raster-metadata.json").read_text())
    raster=base.HeightRaster(prepared/"austin-dtm.f32le",raster_meta["rasters"]["dtm"],config["model"]["bounds"])
    raster.profiles=json.loads((prepared/"austin-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collections=base.create_collections()
    scene=bpy.context.scene
    scene.unit_settings.system="METRIC"
    scene.unit_settings.scale_length=1
    scene.unit_settings.length_unit="METERS"
    scene["coordinate_reference_system"]="EPSG:32614"
    scene["vertical_datum"]="NAVD88"
    scene["real_world_scale"]="1 unit = 1 metre; no vertical exaggeration"
    scene.render.engine="BLENDER_EEVEE"
    scene.render.resolution_x=1600
    scene.render.resolution_y=1100
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="WEBP"
    scene.render.image_settings.color_mode="RGBA"
    scene.render.image_settings.quality=90
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.world=bpy.data.worlds.new("Austin_World")
    scene.world.color=(.10,.12,.14)
    material={
        "terrain":base.create_aerial_material(prepared/"austin-orthophoto.jpg"),
        "asphalt":base.create_material("Austin_Asphalt",linear((.25,.26,.27,1)),.95),
        "white":base.create_material("Austin_White",linear((.88,.89,.86,1)),.85),
        "black":base.create_material("Austin_Black",linear((.04,.05,.06,1)),.9),
        "red":base.create_material("Austin_Curb_Red",linear((.66,.03,.025,1)),.85),
        "concrete":base.create_material("Austin_Concrete",linear((.57,.59,.57,1)),.9),
        "fence":base.create_material("Austin_Pit_Fence",(.26,.31,.30,.42)),
        "vertex":base.create_material("Austin_Source_Coloured_Structures",(1,1,1,1),.86,use_vertex_color=True),
    }
    material["terrain"].name="Austin_NAIP_2022_Orthophoto"
    colors=[(.78,.025,.017,1),(.99,.40,.02,1),(.015,.51,.68,1)]
    material["sectors"]=[base.create_material(f"Austin_Sector_{i+1}",c,.7) for i,c in enumerate(colors)]
    material["halos"]=[base.create_material(f"Austin_Sector_{i+1}_Glow",(*c[:3],.30),.5,emission_strength=1.5) for i,c in enumerate(colors)]
    terrain=terrain_mesh(config,raster,material["terrain"],collections["Terrain"],prepared)
    terrain.name="Austin_USGS_Terrain"
    terrain["source"]="USGS 3DEP bare-earth DTM + Texas GIO/USDA NAIP 2022"
    building_colors=json.loads((prepared/"austin-building-colors.json").read_text())
    model=AustinScene(config,raster,collections,material,building_colors)
    samples,curbs=model.roadway()
    pit=model.pit_lane()
    stands=model.grandstands()
    bleachers=model.amphitheater_bleachers()
    buildings=model.buildings()
    infrastructure=model.infrastructure()
    low,high=model.annotations()
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Austin terrain intersects driving surfaces: {clearance}; {pit['surfaceClearance']}")
    base.add_lighting(collections["Terrain"])
    camera_data=bpy.data.cameras.new("AustinPreview")
    camera_data.type="ORTHO"
    camera_data.ortho_scale=2700
    camera_data.clip_end=10000
    camera=bpy.data.objects.new("AustinPreview",camera_data)
    collections["Terrain"].objects.link(camera)
    camera.location=(0,-900,2900)
    base.look_at(camera,(0,0,168))
    scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve())
    bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source=="FILE":image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera,do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    export(Path(args.glb).resolve())
    elevation_profile=[]
    for i in range(181):
        d=model.total*i/180
        elevation_profile.append({"distanceMeters":round(d,3),"elevationMeters":round(model.surface(d)[2]-.55,3)})
    metadata={"schemaVersion":4,"modelId":"austin","generatedWith":f"Blender {bpy.app.version_string}",
              "coordinateReferenceSystem":"EPSG:32614","verticalDatum":"NAVD88 orthometric metres",
              "verticalExaggeration":1,"realWorldScale":"1 unit = 1 metre; no vertical exaggeration",
              "boundsMeters":{"width":2400,"depth":1700},"originMeters":config["model"]["center"],
              "lapLength":{"geometryMeters":model.total,"officialFiaMeters":5513,
                           "relativeErrorPercent":abs(model.total-5513)/5513*100},
              "finishDistanceMeters":0,"sectorBoundaryDistancesMeters":config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
              "elevationProfile":elevation_profile,"elevationsMeters":{"low":low[0],"high":high[0]},
              "baseElevationMeters":0,
              "objects":{"turnAnchors":20,"pitGarageBoxes":34,"grandstandFootprints":len(stands["footprints"]),
                         "grandstandSections":stands["sections"],"amphitheaterBleacherFootprints":len(bleachers["footprints"]),
                         "amphitheaterBleacherRows":bleachers["sections"],"startLightPods":5,
                         "buildingsTotal":buildings["count"],
                         "raceMotorhomes":0,**infrastructure},
              "layoutQuality":{"surfaceClearance":clearance,"pitLane":pit,"grandstands":stands,
                               "amphitheaterBleachers":bleachers,"buildings":buildings,
                               "curbs":curbs,"terrainSurface":raster_meta["terrainSurface"],
                               "roadGrading":raster_meta["roadGrading"]},
              "sourceManifest":config["sourceManifest"],"controlPointReference":config["officialControlPoints"],
              "limitations":config["limitations"],"publicationStatus":"review-required"}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2)+"\n")
    print(json.dumps({"lapLength":metadata["lapLength"],"objects":metadata["objects"],"surfaceClearance":clearance}))


if __name__=="__main__":
    main()
