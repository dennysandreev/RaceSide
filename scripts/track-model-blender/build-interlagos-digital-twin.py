#!/usr/bin/env python3
"""Build textured Interlagos from its own locked PMSP/OSM/FIA sources."""

import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("textured_track_tools", SCRIPTS/"build-suzuka-digital-twin.py")
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
tools, base = shared.tools, shared.base
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 301, 376
base.PIT_LANE_WIDTH_METERS = 8
tools.COPYRIGHT = "RaceSide Interlagos model; PMSP/GeoSampa CC BY-SA 4.0; PMSP LiDAR GPL-3.0; OpenStreetMap ODbL; FIA/GP Sao Paulo reference only"


class InterlagosScene(shared.SuzukaScene):
    """Reuse shared surface/annotation tools; all geometry is Interlagos data."""

    def road_width(self, distance):
        profile = self.config["roadCorridor"]["widthProfile"]
        distance %= self.total
        for first, second in zip(profile, profile[1:]):
            if distance <= second["distanceMeters"]:
                blend = (distance-first["distanceMeters"])/(second["distanceMeters"]-first["distanceMeters"])
                return first["widthMeters"]+(second["widthMeters"]-first["widthMeters"])*blend
        return 12

    def surface(self, d, offset=0, pit=False, lift=.45):
        if pit:
            return super().surface(d, offset, pit=True, lift=lift)
        return base.road_surface_point(self.line, self.cum, d, offset, self.raster, self.center,
                                       0, self.road_width(d), z_offset=lift)

    def terrain(self):
        # Preserve the 4 m survey grid along roads. Away from driving surfaces,
        # use 16 m patches with matching 4 m boundary vertices to avoid cracks.
        bounds = self.config["model"]["bounds"]
        columns, rows = 300, 375
        vertices, faces, lookup = [], [], {}
        road_cells = set()
        for path, cumulative in ((self.line, self.cum), (self.pit, self.pc)):
            for p in base.sample_line_points(path, cumulative, 3, closed=path is self.line):
                road_cells.add((math.floor((p[0]-bounds["minX"])/16),
                                math.floor((p[1]-bounds["minY"])/16)))

        def vertex(col, row):
            key = (col, row)
            if key not in lookup:
                p = (bounds["minX"]+col*4, bounds["minY"]+row*4)
                lookup[key] = len(vertices)
                vertices.append((*self.xy(p), self.ground(p)))
            return lookup[key]

        fine, coarse = 0, 0
        for row in range(0, rows, 4):
            for col in range(0, columns, 4):
                right, top = min(col+4, columns), min(row+4, rows)
                near = any((col//4+dx, row//4+dy) in road_cells
                           for dx in range(-2, 3) for dy in range(-2, 3))
                if near:
                    fine += 1
                    for y in range(row, top):
                        for x in range(col, right):
                            faces.append(tuple(vertex(*p) for p in ((x, y), (x+1, y), (x+1, y+1), (x, y+1))))
                else:
                    coarse += 1
                    boundary = ([(x, row) for x in range(col, right)] +
                                [(right, y) for y in range(row, top)] +
                                [(x, top) for x in range(right, col, -1)] +
                                [(col, y) for y in range(top, row, -1)])
                    center = vertex((col+right)/2, (row+top)/2)
                    for a, b in zip(boundary, boundary[1:]+boundary[:1]):
                        faces.append((vertex(*a), vertex(*b), center))
        mesh = bpy.data.meshes.new("Interlagos_Terrain_Mesh")
        mesh.from_pydata(vertices, [], faces); mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        obj = bpy.data.objects.new("Interlagos_Terrain", mesh)
        self.c["Terrain"].objects.link(obj); mesh.materials.append(self.m["terrain"])
        tools.aerial_uv(obj, self.center, bounds)
        bvh = BVHTree.FromPolygons([v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons])

        def height(x, y):
            hit, *_ = bvh.ray_cast(Vector((x-self.center["x"], y-self.center["y"], 1000)), Vector((0, 0, -1)))
            return hit.z if hit is not None else self.ground((x, y))
        self.raster.sample_rendered_terrain = height
        self.terrain_lod = {"roadGridMeters": 4, "contextPatchMeters": 16,
                            "finePatches": fine, "coarsePatches": coarse, "stitchedBoundaries": True}

    def road(self):
        obj, _, _, samples = base.create_ribbon("Interlagos_Raceway", self.line, self.raster, self.center, 0, 12,
            self.m["asphalt"], self.c["Circuit"], interval=2, z_offset=.45)
        # Retain the shared mesh topology, with the surveyed-image width at T10.
        for i, sample in enumerate(samples):
            d = sample[0]
            width = self.road_width(d)
            point, tangent, normal, height, bank = base.road_cross_section(
                self.line, self.cum, d, self.raster, 0, width, z_offset=.45)
            for side, index in ((1, i*2), (-1, i*2+1)):
                obj.data.vertices[index].co = (*self.xy((point[0]+side*normal.x*width/2,
                                                       point[1]+side*normal.y*width/2)), height)
            samples[i] = (d, *point, height, tangent, normal, bank, width)
        obj.data.update()
        obj["source"] = "OSM relation 6781071; T10 centre and local width corrected from paired GeoSampa 2020 asphalt edges"
        for d in range(0, math.ceil(self.total), 2):
            for side in (-1, 1):
                end = min(d+2, self.total)
                self.paint.add_quad([self.surface(distance, side*(self.road_width(distance)/2-inset), lift=.62)
                                     for distance, inset in ((d, .34), (end, .34), (end, .16), (d, .16))])
        kerbs, ranges = base.MeshBuilder(), []
        for turn in self.config["model"]["turns"]:
            d = turn["distanceMeters"]
            a, b = base.sample_tangent(self.line, self.cum, d-18), base.sample_tangent(self.line, self.cum, d+18)
            side = 1 if a.x*b.y-a.y*b.x > 0 else -1
            span = 40 if turn["number"] in (1, 3, 4, 6, 11, 12) else 25
            ranges.append({"turn": turn["number"], "startMeters": d-span, "endMeters": d+span, "side": side})
            for i in range(math.ceil(span*2/2)):
                start = d-span+i*2
                end = min(start+2, d+span)
                kerbs.add_quad([self.surface(distance, side*(self.road_width(distance)/2+outside), lift=.61)
                                for distance, outside in ((start, 0), (end, 0), (end, .95), (start, .95))], i%3)
        kerbs.create_object("Interlagos_Kerbs", [self.m["green"], self.m["yellow"], self.m["white"]], self.c["Circuit"])
        return samples, ranges

    def pit_lane(self):
        _, _, _, samples = base.create_ribbon("Interlagos_Pit_Lane", self.pit, self.raster, self.center, 0, 8,
            self.m["asphalt"], self.c["Circuit"], interval=2, closed=False, taper_meters=30,
            minimum_start_width=4, minimum_end_width=4, z_offset=.45)
        pavilion = next(f for f in self.features if f["id"] == 33779114)
        polygon = pavilion["world"][:-1]
        edges = sorted(zip(polygon, polygon[1:]+polygon[:1]), key=lambda pair: math.dist(*pair), reverse=True)
        front = min(edges[:2], key=lambda pair: sum(base.distance_to_polyline(p, self.pit) for p in pair))
        first, last = sorted(shared.nearest_distance(self.pit, self.pc, p) for p in front)
        first += 3; last -= 3
        middle = (first+last)/2
        tangent = base.sample_tangent(self.pit, self.pc, middle, closed=False)
        normal = Vector((-tangent.y, tangent.x))
        midpoint = Vector(base.sample_polyline(self.pit, self.pc, middle, closed=False))
        building_center = Vector(tuple(sum(p[i] for p in polygon)/len(polygon) for i in (0, 1)))
        side = 1 if (building_center-midpoint).dot(normal) > 0 else -1
        for i in range(25):
            d = first+(last-first)*i/24
            self.strip(self.paint, d, d+.16, side*1.25, side*3.85, pit=True, lift=.62)
        for d in range(math.ceil(first), math.floor(last), 3):
            self.strip(self.paint, d, min(d+2, last), side*1.15, side*1.3, pit=True, lift=.62)
        wall, quality = base.create_pit_wall(self.pit, self.line, self.raster, self.center, 0,
            [self.m["green"], self.m["fence"]], self.c["Circuit"], start_ratio=first/self.pt,
            end_ratio=last/self.pt, wall_height=.9, fence_height=2.0)
        wall.name = "Interlagos_Pit_Wall"; wall.data.name = wall.name+"_Mesh"
        return {"pitGarageBoxes": 24, "laneWidthMeters": 8, "fastLaneSeparator": True,
                "frontageDistancesMeters": [first, last], "wall": quality,
                "entryGapMeters": base.distance_to_polyline(self.pit[0], self.line),
                "exitGapMeters": base.distance_to_polyline(self.pit[-1], self.line),
                "surfaceClearance": base.measure_ribbon_terrain_clearance(samples, self.raster, 0)}

    def grandstands(self):
        concrete, roofs, seats = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], []
        seat_uvs = []
        for f in self.features:
            if f["tags"].get("grandstand") != "yes":
                continue
            polygon = f["world"][:-1]
            if base.polygon_intersects_corridors(polygon, self.corridors):
                excluded.append({"id": f["id"], "reason": "driving corridor overlap"}); continue
            edges = sorted(zip(polygon, polygon[1:]+polygon[:1]), key=lambda pair: math.dist(*pair), reverse=True)
            axis = (Vector(edges[0][1])-Vector(edges[0][0])).normalized()
            normal = Vector((-axis.y, axis.x))
            uv = [(Vector(p).dot(axis), Vector(p).dot(normal)) for p in polygon]
            lo, hi = min(u for u, v in uv), max(u for u, v in uv)
            front, rear = min(v for u, v in uv), max(v for u, v in uv)
            if base.distance_to_polyline(axis*((lo+hi)/2)+normal*front, self.line) > base.distance_to_polyline(axis*((lo+hi)/2)+normal*rear, self.line):
                front, rear = rear, front
            sections = max(1, math.ceil((hi-lo)/10)); rows = max(6, round(abs(front-rear)/.82))
            count = 0
            for section in range(sections):
                left, right = lo+(hi-lo)*section/sections+.08, lo+(hi-lo)*(section+1)/sections-.08
                middle = (left+right)/2
                for lower, upper in tools.polygon_scanline_spans(uv, middle):
                    near, far = (lower, upper) if front < rear else (upper, lower)
                    nrows = max(3, round(abs(far-near)/.82))
                    ground = self.ground(axis*middle+normal*near)
                    for row in range(nrows):
                        a, b = near+(far-near)*row/nrows, near+(far-near)*(row+1)/nrows
                        ring = [axis*u+normal*v for u, v in ((left, a), (right, a), (right, b), (left, b))]
                        if not all(base.distance_point_polygon(p, polygon) < .1 or base.point_in_polygon(p, polygon) for p in ring):
                            continue
                        z = max(ground+.7+row*.43, max(self.ground(p) for p in ring)+.15)
                        concrete.add_quad([(*self.xy(p), z) for p in ring], color=(.60, .59, .56, 1))
                        concrete.add_quad([(*self.xy(ring[0]), z-.43), (*self.xy(ring[1]), z-.43),
                                           (*self.xy(ring[1]), z), (*self.xy(ring[0]), z)], color=(.60, .59, .56, 1))
                        p, q = axis*left+normal*((a+b)/2), axis*right+normal*((a+b)/2)
                        corners = [p-normal*.19, q-normal*.19, q+normal*.19, p+normal*.19]
                        seats.add_quad([(*self.xy(v), z+.15) for v in corners], color=(.055, .30, .55, 1))
                        seats.add_quad([(*self.xy(v), zz) for v, zz in
                            ((corners[2], z+.15), (corners[3], z+.15), (corners[3], z+.52), (corners[2], z+.52))], color=(.055, .30, .55, 1))
                        n = max(2, round((right-left)/.6))
                        for _ in range(2):
                            seat_uvs.extend(((0, 0), (n, 0), (n, 1), (0, 0), (n, 1), (0, 1)))
                        count += 1
                    top = ground+.7+nrows*.43+3.5
                    ring = [axis*u+normal*v for u, v in ((left, near), (right, near), (right, far), (left, far))]
                    roofs.add_quad([(*self.xy(p), top) for p in ring])
                    for u in (left+.25, right-.25):
                        p = axis*u+normal*far; low = self.ground(p)
                        tools.beam(concrete, (*self.xy(p), low), (*self.xy(p), top), .12, (.40, .39, .36, 1))
                        a, b = axis*u+normal*near, axis*u+normal*far
                        tools.beam(concrete, (*self.xy(a), top-.3), (*self.xy(b), top-.3), .11, (.40, .39, .36, 1))
            rendered.append({"osmWayId": f["id"], "name": f["tags"].get("name", "Permanent main-straight stand"),
                             "footprint": polygon, "rowsBuilt": count, "rowsPerSection": rows,
                             "groundAnchored": True, "covered": True,
                             "minimumTrackClearanceMeters": base.minimum_polygon_track_clearance(polygon, self.corridors[0][0], 6)})
        concrete.create_object("Interlagos_Grandstands", [self.m["vertex"]], self.c["Grandstands"], vertex_colors=True)
        obj = seats.create_object("Interlagos_Textured_Seat_Rows", [self.m["seats"]], self.c["Grandstands"], vertex_colors=True)
        uv_layer = obj.data.uv_layers.new(name="SeatShellUV")
        for loop, coordinate in zip(obj.data.loops, seat_uvs):
            uv_layer.data[loop.index].uv = coordinate
        roof = roofs.create_object("Interlagos_Main_Grandstand_Roof", [self.m["terrain"]], self.c["Grandstands"])
        tools.aerial_uv(roof, self.center, self.config["model"]["bounds"])
        return {"count": len(rendered), "sections": sum(f["rowsBuilt"] for f in rendered), "rendered": rendered,
                "excluded": excluded, "seatColorMethod": "blue shell seats and gray/rust steel from official organizer main-straight photograph"}

    def buildings(self):
        walls, roofs = base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], self.config["excludedBuildings"][:]
        # Use current OSM polygons for the major paddock structures absent in
        # the older cadastral layer. Never create a second overlapping shell.
        paddock = [f for f in self.features if f["id"] in (33779114, 138433083, 1484734010, 1262374301)]
        reserved = [f["world"] for f in paddock]+self.reserved
        candidates = self.config["buildings"][:]
        for f in paddock:
            candidates.append({"id": f["id"], "world": f["world"], "heightMeters": 9 if f["id"] == 33779114 else 6,
                               "roofColor": list(self.source_color(f["world"][0])[:3]), "source": "current OSM footprint; photographed structure height estimate"})
        for f in candidates:
            polygon = f["world"][:-1]
            current = f["id"] in [p["id"] for p in paddock]
            conflict = base.polygon_intersects_corridors(polygon, self.corridors)
            if f["id"] == 33779114:
                # The shared broad-phase includes an extra 2.1 m margin.
                # The real pit facade is only ~1 m outside the pit ribbon;
                # measure its actual polygon clearance without moving it.
                conflict = any(base.minimum_polygon_track_clearance(polygon, path, half) < .25
                               for path, half in self.corridors)
            overlap = any(base.polygons_overlap(polygon, p) for p in (self.reserved if current else reserved))
            if conflict or overlap:
                excluded.append({"id": f["id"], "reason": "track/pit corridor or reserved current structure overlap"}); continue
            low = max(self.ground(p) for p in polygon)
            top = max(low+2, f.get("roofElevationMeters", low+f["heightMeters"]))
            color = tuple(f["roofColor"])+(1,)
            facade = (.79, .78, .73, 1) if current else tuple(min(.84, max(.16, channel*.78+.08)) for channel in color[:3])+(1,)
            for a, b in zip(polygon, polygon[1:]+polygon[:1]):
                walls.add_quad([(*self.xy(a), self.ground(a)), (*self.xy(b), self.ground(b)),
                                (*self.xy(b), top), (*self.xy(a), top)], color=facade)
            if f["id"] == 33779114:
                # The real pit roof consists of repeated white tensile bays.
                # Keep its irregular geographic footprint; the profile is
                # reconstructed from the organizer photograph, not a flat box.
                axis = (Vector(polygon[3])-Vector(polygon[2])).normalized()
                normal = Vector((-axis.y, axis.x))
                coords = [(Vector(p).dot(axis), Vector(p).dot(normal)) for p in polygon]
                lo, hi = min(u for u, v in coords), max(u for u, v in coords)
                for bay in range(24):
                    a, b = lo+(hi-lo)*bay/24, lo+(hi-lo)*(bay+1)/24
                    mid = (a+b)/2
                    for near, far in tools.polygon_scanline_spans(coords, mid):
                        front = [axis*a+normal*near, axis*b+normal*near]
                        back = [axis*b+normal*far, axis*a+normal*far]
                        apex = axis*mid+normal*((near+far)/2)
                        ring = front+back
                        for first, last in zip(ring, ring[1:]+ring[:1]):
                            roofs.add_triangle([(*self.xy(first), top), (*self.xy(last), top), (*self.xy(apex), top+2.3)])
                        tools.beam(walls, (*self.xy(apex), top-1), (*self.xy(apex), top+3.4), .11, (.86, .85, .81, 1))
            else:
                for triangle in base.resolved_tessellation([[Vector((*self.xy(p), top)) for p in polygon]]):
                    if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z < 0:
                        triangle = list(reversed(triangle))
                    roofs.add_triangle(triangle)
            rendered.append({"id": f["id"], "footprint": polygon, "heightMeters": top-low,
                             "roofColor": color[:3], "facadeColorEstimate": facade[:3], "source": f["source"]})
        walls.create_object("Interlagos_Buildings", [self.m["facade"]], self.c["Infrastructure"], vertex_colors=True)
        obj = roofs.create_object("Interlagos_Source_Roofs", [self.m["terrain"]], self.c["Infrastructure"])
        tools.aerial_uv(obj, self.center, self.config["model"]["bounds"])
        return {"count": len(rendered), "rendered": rendered, "excluded": excluded, "lod2Available": False,
                "remainingDrivingCorridorConflicts": 0, "pitPavilionWayId": 33779114, "pitRoofMembraneBays": 24}

    def infrastructure(self):
        barriers, fences = base.MeshBuilder(), base.MeshBuilder(); panels = 0
        for f in self.features:
            kind = f["tags"].get("barrier")
            if kind not in ("wall", "fence", "guard_rail", "retaining_wall"):
                continue
            for a, b in zip(f["world"], f["world"][1:]):
                segments = max(1, math.ceil(math.dist(a, b)/5))
                for i in range(segments):
                    p = [a[j]+(b[j]-a[j])*i/segments for j in (0, 1)]
                    q = [a[j]+(b[j]-a[j])*(i+1)/segments for j in (0, 1)]
                    if not all(self.config["model"]["bounds"]["minX"] <= v[0] <= self.config["model"]["bounds"]["maxX"] and self.config["model"]["bounds"]["minY"] <= v[1] <= self.config["model"]["bounds"]["maxY"] for v in (p, q)):
                        continue
                    if any(base.distance_to_polyline(v, path) < half+1 for v in (p, q, [(p[j]+q[j])/2 for j in (0, 1)]) for path, half in self.corridors):
                        continue
                    za, zb = self.ground(p), self.ground(q)
                    if kind == "fence":
                        fences.add_quad([(*self.xy(p), za), (*self.xy(q), zb), (*self.xy(q), zb+2.7), (*self.xy(p), za+2.7)])
                        tools.beam(barriers, (*self.xy(p), za), (*self.xy(p), za+2.7), .06, (.38, .39, .36, 1))
                    else:
                        for dz in (.45, .8, 1.15):
                            barriers.add_quad([(*self.xy(p), za+dz-.09), (*self.xy(q), zb+dz-.09),
                                               (*self.xy(q), zb+dz+.09), (*self.xy(p), za+dz+.09)], color=(.60, .61, .59, 1))
                    panels += 1
        barriers.create_object("Interlagos_Guardrails", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        fences.create_object("Interlagos_Catch_Fences", [self.m["fence"]], self.c["Infrastructure"])
        return {"mappedBarrierPanels": panels}

    def vegetation(self):
        builder = base.MeshBuilder(); count = 0
        reserved = self.reserved+[f["world"] for f in self.config["buildings"]]
        for tree in self.config["trees"]:
            p = tree["world"]
            if any(base.distance_to_polyline(p, path) < half+6 for path, half in self.corridors):
                continue
            if any(base.point_in_polygon(p, polygon) for polygon in reserved):
                continue
            color = self.source_color(p)
            if not color[1] > color[0]*1.05:
                continue
            x, y = self.xy(p); z = self.ground(p); h = tree["heightMeters"]; radius = min(5, h*.35)
            builder.add_cylinder((x, y, z), .22, h*.58, sides=3, color=(.30, .25, .18, 1))
            lower = [(x+math.cos(i*math.tau/5)*radius, y+math.sin(i*math.tau/5)*radius, z+h*.35) for i in range(5)]
            upper = [(x+math.cos(i*math.tau/5)*radius*.86, y+math.sin(i*math.tau/5)*radius*.86, z+h*.70) for i in range(5)]
            for i in range(5):
                j = (i+1)%5
                builder.add_quad([lower[i], lower[j], upper[j], upper[i]], color=color)
                builder.add_triangle([upper[i], upper[j], (x, y, z+h)], color=color)
            count += 1
        builder.create_object("Interlagos_Vegetation", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        return {"trees": count, "method": "PMSP class-5 LiDAR locations/heights, verified green 2020 aerial pixels, estimated crown shape"}


def main():
    args = base.parse_args(); prepared = Path(args.prepared)
    config = json.loads(Path(args.input).read_text())
    raster_meta = json.loads((prepared/"raster-metadata.json").read_text())
    raster = base.HeightRaster(prepared/"interlagos-dtm.f32le", raster_meta["rasters"]["dtm"], config["model"]["bounds"])
    raster.profiles = json.loads((prepared/"interlagos-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    c = base.create_collections(); scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"; scene.unit_settings.scale_length = 1
    scene["coordinate_reference_system"] = "EPSG:31983"
    scene["vertical_datum"] = "PMSP 2017 source heights; absolute datum uncertainty documented"
    scene["real_world_scale"] = "1 unit = 1 metre; no vertical exaggeration"
    grain = shared.texture("Interlagos_Mineral_Surface")
    facade = shared.texture("Interlagos_Facade_Detail", "facade")
    m = {"terrain": base.create_aerial_material(prepared/"interlagos-orthophoto.jpg"),
         "asphalt": tools.textured_material("Interlagos_Asphalt", (.32, .33, .32, 1), grain),
         "white": tools.textured_material("Interlagos_White_Paint", (.91, .90, .86, 1), grain),
         "black": tools.textured_material("Interlagos_Checker_Black", (.04, .04, .035, 1), grain),
         "green": tools.textured_material("Interlagos_Green_Paint", (.02, .48, .18, 1), grain),
         "yellow": tools.textured_material("Interlagos_Yellow_Kerbs", (.98, .79, .025, 1), grain),
         "vertex": tools.textured_material("Interlagos_Source_Colored_Objects", (1, 1, 1, 1), grain, vertex=True),
         "facade": tools.textured_material("Interlagos_Textured_Facades", (1, 1, 1, 1), facade, vertex=True),
         "fence": shared.fence_material(), "seats": tools.seating_material()}
    m["terrain"].name = "Interlagos_GeoSampa_2020_Orthophoto"
    m["fence"].name = "Interlagos_Chain_Link_Fence"; m["seats"].name = "Interlagos_Blue_Shell_Seats"
    m["sectors"], m["halos"] = [], []
    for i, color in enumerate([(.8, .02, .015, 1), (.97, .43, .02, 1), (.02, .56, .72, 1)]):
        m["sectors"].append(base.create_material(f"Interlagos_Sector_{i+1}", tools.linear(color), .8))
        m["halos"].append(base.create_material(f"Interlagos_Sector_{i+1}_Glow", (*tools.linear(color)[:3], .30), .5, emission_strength=1.3))
    aerial = next(n.image for n in m["terrain"].node_tree.nodes if n.type == "TEX_IMAGE")
    model = InterlagosScene(config, raster, c, m, aerial)
    model.terrain(); samples, curbs = model.road(); pit = model.pit_lane()
    clearance = base.measure_ribbon_terrain_clearance(samples, raster, 0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Interlagos terrain intersects roads: {clearance}, {pit['surfaceClearance']}")
    stands = model.grandstands(); buildings = model.buildings()
    infrastructure = model.infrastructure(); vegetation = model.vegetation()
    profile, low, high = model.annotations()
    for obj in bpy.data.objects:
        if obj.name.startswith("Suzuka_"):
            obj.name = obj.name.replace("Suzuka_", "Interlagos_")
        if obj.type == "MESH":
            obj.data.name = obj.name+"_Mesh"; tools.uv_surface(obj, 2)
    for image in bpy.data.images:
        image.name = image.name.replace("Suzuka_", "Interlagos_").replace("Mexico_", "Interlagos_")
    print("Interlagos textured scene built", flush=True)
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 1600; scene.render.resolution_y = 1400
    scene.render.resolution_percentage = 100; scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"; scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
    scene.world = bpy.data.worlds.new("Interlagos_World"); scene.world.color = (.10, .12, .13)
    base.add_lighting(c["Terrain"])
    data = bpy.data.cameras.new("InterlagosPreview"); data.type = "ORTHO"; data.ortho_scale = 1800; data.clip_end = 10000
    camera = bpy.data.objects.new("InterlagosPreview", data); c["Terrain"].objects.link(camera)
    camera.location = (0, -600, 2600); base.look_at(camera, (0, 0, 760)); scene.camera = camera
    scene.render.filepath = str(Path(args.preview).resolve()); bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source == "FILE":
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera, do_unlink=True); bpy.data.cameras.remove(data)
    tools.export(Path(args.glb).resolve())
    metadata = {"schemaVersion": 4, "modelId": "interlagos", "generatedWith": f"Blender {bpy.app.version_string}",
                "coordinateReferenceSystem": "EPSG:31983", "verticalDatum": "PMSP 2017 source heights; EPT datum unknown; SIRGAS 2000 ellipsoid in OpenTopography metadata",
                "verticalExaggeration": 1, "realWorldScale": "1 unit = 1 metre; no vertical exaggeration",
                "originMeters": config["model"]["center"], "boundsMeters": {"width": 1200, "depth": 1500},
                "lapLength": {"geometryMeters": model.total, "officialFiaMeters": 4309, "relativeErrorPercent": abs(model.total-4309)/4309*100},
                "elevationProfile": profile, "elevationsMeters": {"low": low["elevationMeters"], "high": high["elevationMeters"]},
                "finishDistanceMeters": 0, "raceStartDistanceMeters": config["officialControlPoints"]["raceStartDistanceMeters"], "baseElevationMeters": 0,
                "sectorBoundaryDistancesMeters": config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
                "objects": {"turnAnchors": 15, "pitGarageBoxes": 24, "buildingsTotal": buildings["count"], "grandstandFootprints": stands["count"],
                            "grandstandSections": stands["sections"], "raceMotorhomes": 0, **infrastructure, **vegetation},
                "layoutQuality": {"surfaceClearance": clearance, "pitLane": pit, "grandstands": stands, "buildings": buildings,
                                  "curbs": curbs, "terrainSurface": raster_meta["terrainSurface"],
                                  "roadCorridor": config["roadCorridor"],
                                  "terrainLod": model.terrain_lod, "roadGrading": raster_meta["roadGrading"]},
                "materials": {"physicalObjectsTextured": True, "roofMethod": "embedded GeoSampa 2020 aerial UV projection",
                              "facadeMethod": "aerial-derived estimated facade colors; authored neutral detail texture; photographed pit structure",
                              "colorSpace": "sRGB imagery converted once to linear vertex colors", "curbColors": ["green", "yellow", "white"]},
                "controlPointReference": config["officialControlPoints"], "sourceManifest": config["sourceManifest"],
                "limitations": config["limitations"], "publicationStatus": "review-required"}
    Path(args.metadata).write_text(json.dumps(metadata, indent=2, ensure_ascii=False)+"\n")
    print(json.dumps({"lapLength": metadata["lapLength"], "clearance": clearance, "objects": metadata["objects"]}), flush=True)


if __name__ == "__main__":
    main()
