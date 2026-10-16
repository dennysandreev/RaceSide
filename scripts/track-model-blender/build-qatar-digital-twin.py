#!/usr/bin/env python3
"""Build the current Lusail venue in real UTM metres with embedded textures."""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("qatar_mesh_helpers", SCRIPTS / "build-suzuka-digital-twin.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
base, tools = helpers.base, helpers.tools
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 167, 185
base.PIT_LANE_WIDTH_METERS = 8
tools.COPYRIGHT = ("RaceSide Lusail model. Contains modified Copernicus Sentinel data (2026), processed by ESA; "
    "© OpenStreetMap contributors, ODbL 1.0; OpenGeoHub / Ho et al. (2025), GEDTM30, CC BY 4.0. "
    "Architecture reconstructed from OSM and LIC / Focus Design Partners photographs. "
    "FIA 2025 documents and LIC event images are references only, not embedded.")
original_tangent = base.sample_tangent


def qatar_tangent(points, cumulative, distance, delta=10, closed=True):
    return original_tangent(points, cumulative, distance, delta, closed)


base.sample_tangent = qatar_tangent


def artwork_texture():
    """Authored repeat of the blue/aqua chevrons visible in LIC photographs."""
    size = 128
    image = bpy.data.images.new("Qatar_Blue_Aqua_Runoff_Chevrons", width=size, height=size)
    pixels = []
    for y in range(size):
        for x in range(size):
            stripe = ((x+y//2)//32+y//32) % 2
            color = (.25, .30, .62) if stripe else (.51, .82, .83)
            pixels.extend((*color, 1))
    image.pixels[:] = pixels
    image.pack()
    return image


class QatarScene(helpers.SuzukaScene):
    def __init__(self, *args):
        super().__init__(*args)
        self.corridors = [(base.sample_line_points(self.line, self.cum, 2), 6.2),
                          (base.sample_line_points(self.pit, self.pc, 2, closed=False), 4.2)]
        self.reserved = [f["world"] for f in self.features if f["tags"].get("grandstand") == "yes"]

    def surface(self, d, offset=0, pit=False, lift=.45):
        line, cum, width = (self.pit, self.pc, 8) if pit else (self.line, self.cum, 12)
        return base.road_surface_point(line, cum, d, offset, self.raster, self.center, 0,
                                       width, z_offset=lift, closed=not pit)

    def terrain(self):
        super().terrain()
        obj = bpy.data.objects.get("Suzuka_Terrain")
        obj.name, obj.data.name = "Qatar_Terrain", "Qatar_Terrain_Mesh"
        obj["source"] = "Copernicus Sentinel-2C 2026-09-30 + current OSM materials + GEDTM30 EGM2008"

    def road(self):
        obj, _, _, samples = base.create_ribbon("Qatar_Raceway", self.line, self.raster,
            self.center, 0, 12, self.m["asphalt"], self.c["Circuit"], interval=2, z_offset=.45)
        obj["source"] = "OSM ways 152483595 / 1553605580; FIA 5419 m, clockwise"
        for d in range(0, math.ceil(self.total), 2):
            for side in (-1, 1):
                self.strip(self.paint, d, min(d+2, self.total), side*5.68, side*5.85)
        kerbs = base.MeshBuilder()
        ranges = []
        for turn in self.config["model"]["turns"]:
            d = turn["distanceMeters"]
            a, b = base.sample_tangent(self.line, self.cum, d-20), base.sample_tangent(self.line, self.cum, d+20)
            side = 1 if a.x*b.y-a.y*b.x > 0 else -1
            span = 58 if turn["number"] in (1, 2, 4, 6, 7, 10, 14, 16) else 35
            ranges.append(dict(turn=turn["number"], startMeters=d-span, endMeters=d+span,
                               side=side, geometryEstimated=True))
            for i in range(math.ceil(span)):
                first = d-span+i*2
                self.strip(kerbs, first, min(first+2, d+span), side*6, side*7.05, i % 2, lift=.62)
        kerbs.create_object("Qatar_Red_White_Kerbs", [self.m["red"], self.m["white"]], self.c["Circuit"])
        # Source-visible decorative apron along the spectator side of the main
        # straight. It never covers the racing asphalt or becomes a centre line.
        runoff = base.MeshBuilder()
        for first, last in [(0, self.config["model"]["turns"][0]["distanceMeters"]-115), (self.total-480, self.total)]:
            for d in range(math.ceil(first), math.floor(last), 2):
                self.strip(runoff, d, min(d+2, last), 6.1, 10.5, lift=.41)
        obj = runoff.create_object("Qatar_Main_Straight_Painted_Apron", [self.m["runoff"]], self.c["Circuit"])
        tools.uv_surface(obj, 3.5)
        return samples, ranges

    def pit_lane(self):
        _, _, _, samples = base.create_ribbon("Qatar_Pit_Lane", self.pit, self.raster, self.center, 0,
            8, self.m["asphalt"], self.c["Circuit"], interval=2, closed=False,
            taper_meters=25, minimum_start_width=4, minimum_end_width=4, z_offset=.45)
        building = next(f for f in self.features if f["id"] == 152483597)
        first, last = sorted([helpers.nearest_distance(self.pit, self.pc, p) for p in
                              (building["world"][1], building["world"][6])])
        wall, quality = base.create_pit_wall(self.pit, self.line, self.raster, self.center, 0,
            [self.m["maroon"], self.m["fence"]], self.c["Circuit"],
            start_ratio=(first-25)/self.pt, end_ratio=(last+25)/self.pt,
            wall_height=1.10, fence_height=2.20)
        wall.name, wall.data.name = "Qatar_Pit_Wall", "Qatar_Pit_Wall_Mesh"
        bays = 50
        for i in range(bays+1):
            d = first+(last-first)*i/bays
            self.strip(self.paint, d, d+.16, -3.8, -.8, pit=True, lift=.61)
        for d in range(math.ceil(first), math.floor(last), 3):
            self.strip(self.paint, d, min(d+1.8, last), -.95, -1.10, pit=True, lift=.61)
        apron = base.MeshBuilder()
        for d in range(math.ceil(first), math.floor(last), 2):
            self.strip(apron, d, min(d+2, last), -4, -12, pit=True, lift=.45)
        apron.create_object("Qatar_Garage_Apron", [self.m["asphalt"]], self.c["Circuit"])
        return dict(pitGarageBoxes=bays, frontageDistancesMeters=[first, last], wall=quality,
                    fastLaneSeparator=True, taperProfile="smoothstep",
                    entryGapMeters=base.distance_to_polyline(self.pit[0], self.line),
                    exitGapMeters=base.distance_to_polyline(self.pit[-1], self.line),
                    surfaceClearance=base.measure_ribbon_terrain_clearance(samples, self.raster, 0))

    def buildings(self):
        walls, roofs, details = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], []
        hospitality = {1316027517, 1316027518, 1316027519, 1316027520}
        for f in self.features:
            tags = f["tags"]
            if not tags.get("building") or tags.get("grandstand") == "yes":
                continue
            polygon = f["world"][:-1] if f["world"][0] == f["world"][-1] else f["world"]
            if len(polygon) < 3:
                continue
            if base.polygon_intersects_corridors(polygon, self.corridors) or any(base.polygons_overlap(polygon, r) for r in self.reserved):
                excluded.append(dict(id=f["id"], reason="track, pit or reserved grandstand overlap"))
                continue
            pit, pavilion = f["id"] == 152483597, f["id"] in hospitality
            carport = tags.get("building") == "carport"
            height = 12.8 if pit else 9.2 if pavilion else 3 if carport else 5.2
            if f["id"] == 1316236404:
                height = 14.5  # VVIP tree-canopy building at T1; photographic estimate.
            low = max(self.ground(p) for p in polygon)
            color = (.82, .78, .66, 1)
            if pit:
                color = (.20, .23, .24, 1)
            elif pavilion:
                color = (.86, .83, .74, 1)
            elif carport:
                color = (.74, .72, .64, 1)
            for a, b in zip(polygon, polygon[1:]+polygon[:1]):
                if carport:
                    for p in (a, b):
                        tools.beam(details, (*self.xy(p), self.ground(p)), (*self.xy(p), low+height), .12, (.65, .65, .61, 1))
                else:
                    walls.add_quad([(*self.xy(a), self.ground(a)), (*self.xy(b), self.ground(b)),
                                    (*self.xy(b), low+height), (*self.xy(a), low+height)], color=color)
                if pit or pavilion:
                    axis = Vector(b)-Vector(a)
                    length = axis.length
                    if length < .3:
                        continue
                    axis.normalize()
                    for z in ([4.3, 8.5, 12.8] if pit else [4.4, 9.2]):
                        tools.beam(details, (*self.xy(a), low+z), (*self.xy(b), low+z), .23, (.89, .88, .80, 1))
                    for j in range(math.ceil(length/7)):
                        p = Vector(a)+axis*(length*j/max(1, math.ceil(length/7)))
                        tools.beam(details, (*self.xy(p), low+4.3), (*self.xy(p), low+height), .15, (.88, .86, .76, 1))
            roof_color = (.79, .76, .65, 1) if not pit else (.87, .85, .77, 1)
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p), low+height+.08)) for p in polygon]]):
                if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z < 0:
                    triangle = list(reversed(triangle))
                roofs.add_triangle(triangle, color=roof_color)
            if pit:
                # Fifty physical garage doors, mullions and display fascia lie
                # on the observed long pit-facing edge of the mapped footprint.
                a, b = Vector(polygon[5]), Vector(polygon[6])
                axis = (b-a).normalized()
                normal = Vector((-axis.y, axis.x))
                axis_length = (b-a).length
                for i in range(50):
                    center = a+(b-a)*(i+.5)/50-normal*.12
                    along = axis*axis_length/50*.43
                    for lower, upper, c in [(0, 3.65, (.12, .14, .15, 1)), (3.7, 4.1, (.62, .64, .61, 1))]:
                        details.add_quad([(*self.xy(center-along), low+lower), (*self.xy(center+along), low+lower),
                                          (*self.xy(center+along), low+upper), (*self.xy(center-along), low+upper)], color=c)
                # Roof terraces/gardens alternate with the light canopy bands.
                for i in range(12):
                    p = a+(b-a)*(i+.5)/12+normal*11
                    details.add_box((*self.xy(p), low+height+.18), (20, 5, .28),
                                    rotation=math.atan2(axis.y, axis.x), color=(.38, .45, .24, 1))
            rendered.append(dict(osmWayId=f["id"], heightMeters=height, footprint=polygon,
                heightMethod="LIC / architect photograph estimate; no public LoD2 or DSM",
                facadeColor=color[:3], roofColor=roof_color[:3], teamHospitality=pavilion))
        walls.create_object("Qatar_Buildings", [self.m["facade"]], self.c["Buildings"], vertex_colors=True)
        roofs.create_object("Qatar_Building_Roofs", [self.m["vertex"]], self.c["Buildings"], vertex_colors=True)
        details.create_object("Qatar_Pit_Architecture", [self.m["vertex"]], self.c["Buildings"], vertex_colors=True)
        return dict(count=len(rendered), rendered=rendered, excluded=excluded,
                    lod2Available=False, remainingDrivingCorridorConflicts=0,
                    permanentTeamHospitality=sum(item["teamHospitality"] for item in rendered))

    def grandstands(self):
        structure, seats, roofs = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], []
        for f in self.features:
            if f["tags"].get("grandstand") != "yes":
                continue
            polygon = f["world"][:-1]
            if base.polygon_intersects_corridors(polygon, self.corridors):
                excluded.append(dict(id=f["id"], reason="stand intersects driving corridor"))
                continue
            edge = max(zip(polygon, polygon[1:]+polygon[:1]), key=lambda pair: math.dist(*pair))
            axis = (Vector(edge[1])-Vector(edge[0])).normalized()
            normal = Vector((-axis.y, axis.x))
            uv = [(Vector(p).dot(axis), Vector(p).dot(normal)) for p in polygon]
            lo, hi = min(u for u, v in uv), max(u for u, v in uv)
            front, rear = min(v for u, v in uv), max(v for u, v in uv)
            if base.distance_to_polyline(axis*((lo+hi)/2)+normal*front, self.line) > base.distance_to_polyline(axis*((lo+hi)/2)+normal*rear, self.line):
                front, rear = rear, front
            covered = f["tags"].get("covered") == "True"
            sections = max(1, math.ceil((hi-lo)/10))
            count = row_count = 0
            for section in range(sections):
                left, right = lo+(hi-lo)*section/sections+.1, lo+(hi-lo)*(section+1)/sections-.1
                middle = (left+right)/2
                for lower, upper in tools.polygon_scanline_spans(uv, middle):
                    near, far = (lower, upper) if front < rear else (upper, lower)
                    rows = max(2, min(30, round(abs(far-near)/.82)))
                    ground = max(self.ground(axis*u+normal*v) for u, v in [(left, near), (right, far)])
                    rise = .45
                    floor = ground+.55
                    for row in range(rows):
                        a = near+(far-near)*row/rows
                        b = near+(far-near)*(row+1)/rows
                        corners = [axis*u+normal*v for u, v in [(left, a), (right, a), (right, b), (left, b)]]
                        if not all(base.point_in_polygon(p, polygon) or base.distance_point_polygon(p, polygon) < .3 for p in corners):
                            continue
                        z = max(floor+row*rise, max(self.ground(p) for p in corners)+.18)
                        structure.add_quad([(*self.xy(p), z) for p in corners], color=(.67, .67, .63, 1))
                        structure.add_quad([(*self.xy(corners[0]), z-rise), (*self.xy(corners[1]), z-rise),
                                            (*self.xy(corners[1]), z), (*self.xy(corners[0]), z)], color=(.62, .63, .60, 1))
                        p, q = axis*left+normal*((a+b)/2), axis*right+normal*((a+b)/2)
                        # Cool gray seats, white canopy and galvanized framing
                        # are reconstructed from LIC's current seating photos.
                        color = (.57, .64, .68, 1) if (section+row//6) % 3 else (.70, .73, .73, 1)
                        fore = normal*.2
                        corners = [p-fore, q-fore, q+fore, p+fore]
                        seats.add_quad([(*self.xy(p), z+.13) for p in corners], color=color)
                        seats.add_quad([(*self.xy(p), zz) for p, zz in [(corners[2], z+.13), (corners[3], z+.13),
                            (corners[3], z+.47), (corners[2], z+.47)]], color=color)
                        row_count += 1
                        count += max(1, round((right-left)/.52))
                    for u in (left+.3, right-.3):
                        p, q = axis*u+normal*far, axis*u+normal*near
                        z = floor+rows*rise
                        tools.beam(structure, (*self.xy(p), self.ground(p)), (*self.xy(p), z), .13, (.59, .61, .61, 1))
                        tools.beam(structure, (*self.xy(q), self.ground(q)), (*self.xy(p), z), .10, (.53, .55, .55, 1))
                    if covered:
                        level = floor+rows*rise+4.2
                        points = [axis*u+normal*v for u, v in [(left, near), (right, near), (right, far), (left, far)]]
                        roofs.add_quad([(*self.xy(p), level+(1 if index < 2 else 0)) for index, p in enumerate(points)], color=(.87, .85, .77, 1))
                        for u in (left+.4, right-.4):
                            p, q = axis*u+normal*far, axis*u+normal*near
                            tools.beam(structure, (*self.xy(p), self.ground(p)), (*self.xy(p), level), .18, (.84, .84, .79, 1))
                            tools.beam(structure, (*self.xy(p), level), (*self.xy(q), level+1), .16, (.76, .78, .75, 1))
            rendered.append(dict(id=f["id"], name=f["tags"]["name"], footprint=polygon,
                rowsBuilt=row_count, seatsBuilt=count, covered=covered, geometryEstimated=True,
                minimumTrackClearanceMeters=base.minimum_polygon_track_clearance(polygon, self.corridors[0][0], 6)))
        structure.create_object("Qatar_Grandstands", [self.m["vertex"]], self.c["Grandstands"], vertex_colors=True)
        seats.create_object("Qatar_Seat_Rows", [self.m["seats"]], self.c["Grandstands"], vertex_colors=True)
        roofs.create_object("Qatar_Main_Grandstand_Canopy", [self.m["vertex"]], self.c["Grandstands"], vertex_colors=True)
        return dict(count=len(rendered), rendered=rendered, excluded=excluded,
                    seatColorMethod="LIC current photos; simplified cool gray seating, cream canopy, galvanized steel")

    def infrastructure(self):
        walls, fences, masts = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        panels = 0
        for f in self.features:
            kind = f["tags"].get("barrier")
            if kind not in ("wall", "fence", "guard_rail"):
                continue
            for a, b in zip(f["world"], f["world"][1:]):
                sections = max(1, math.ceil(math.dist(a, b)/12))
                for i in range(sections):
                    p = Vector(a)+(Vector(b)-Vector(a))*i/sections
                    q = Vector(a)+(Vector(b)-Vector(a))*(i+1)/sections
                    if any(base.distance_to_polyline(probe, line) < width+.3 for probe in (p, q, (p+q)/2) for line, width in self.corridors):
                        continue
                    za, zb = self.ground(p), self.ground(q)
                    color = (.62, .16, .28, 1) if base.distance_to_polyline(p, self.line) < 60 else (.74, .73, .67, 1)
                    walls.add_quad([(*self.xy(p), za), (*self.xy(q), zb), (*self.xy(q), zb+1.05), (*self.xy(p), za+1.05)], color=color)
                    if kind == "fence" or base.distance_to_polyline(p, self.line) < 60:
                        fences.add_quad([(*self.xy(p), za+1.05), (*self.xy(q), zb+1.05),
                                         (*self.xy(q), zb+3), (*self.xy(p), za+3)])
                        tools.beam(walls, (*self.xy(p), za), (*self.xy(p), za+3), .07, (.64, .66, .64, 1))
                    panels += 1
        walls.create_object("Qatar_Safety_Barriers", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        fences.create_object("Qatar_Catch_Fences", [self.m["fence"]], self.c["Infrastructure"])
        # No OSM lamp nodes were available. Positions are tied to the reviewed
        # safety-wall corridor, with a documented photographic spacing estimate.
        count = 0
        for d in range(0, math.floor(self.total), 65):
            for side in (-1, 1):
                p = base.sample_polyline(self.line, self.cum, d)
                tangent = base.sample_tangent(self.line, self.cum, d)
                normal = Vector((-tangent.y, tangent.x))
                world = Vector(p)+normal*side*23
                if any(base.distance_to_polyline(world, line) < width+10 for line, width in self.corridors):
                    continue
                if any(base.point_in_polygon(world, f["world"]) for f in self.features if f["tags"].get("building") or f["tags"].get("grandstand")):
                    continue
                x, y = self.xy(world)
                z = self.ground(world)
                masts.add_cylinder((x, y, z), .18, 13, sides=5, color=(.76, .76, .71, 1))
                axis = Vector((tangent.x, tangent.y, 0))
                hub = Vector((x, y, z+13))
                tools.beam(masts, hub-axis*1.8, hub+axis*1.8, .13, (.68, .69, .66, 1))
                for i in range(4):
                    light = hub+axis*(i-1.5)*.85
                    masts.add_box(light, (.60, .40, .65), color=(.91, .92, .86, 1), rotation=math.atan2(tangent.y, tangent.x))
                count += 1
        masts.create_object("Qatar_Floodlight_Masts", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        return dict(mappedBarrierPanels=panels, floodlightMasts=count,
                    floodlightPlacementMethod="photographic reconstruction at nominal 65 m spacing along safety corridor; not individually surveyed")

    def vegetation(self):
        mesh = base.MeshBuilder()
        count = 0
        for p in self.config["trees"]:
            if any(base.distance_to_polyline(p, line) < half+5 for line, half in self.corridors):
                continue
            if any(base.point_in_polygon(p, poly) for poly in self.reserved):
                continue
            x, y = self.xy(p)
            z = self.ground(p)
            mesh.add_cylinder((x, y, z), .17, 3.6, sides=4, color=(.47, .38, .23, 1))
            # Drought-tolerant planted trees: compact canopies, no invented woods.
            for i in range(5):
                a, b = i*math.tau/5, (i+1)*math.tau/5
                mesh.add_triangle([(x+math.cos(a)*2.2, y+math.sin(a)*2.2, z+3.8),
                                   (x+math.cos(b)*2.2, y+math.sin(b)*2.2, z+3.8),
                                   (x, y, z+6)], color=(.29, .39, .18, 1))
                mesh.add_triangle([(x+math.cos(b)*2.2, y+math.sin(b)*2.2, z+3.8),
                                   (x+math.cos(a)*2.2, y+math.sin(a)*2.2, z+3.8),
                                   (x, y, z+2.5)], color=(.25, .34, .16, 1))
            count += 1
        mesh.create_object("Qatar_Mapped_Trees", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        return dict(trees=count, vegetationMethod="OSM individual planted trees; simplified source-informed canopy dimensions")

    def annotations(self):
        # Build the shared labels/sector geometry, then replace the narrow
        # reference-track gantry with supports beyond both Lusail road ribbons.
        result = super().annotations()
        old = bpy.data.objects.get("Suzuka_Pit_And_Gantry_Details")
        bpy.data.objects.remove(old, do_unlink=True)
        gantry = base.MeshBuilder()
        d = self.config["officialControlPoints"]["raceStartDistanceMeters"]
        offsets = []
        for side in (-1, 1):
            offset = side*8
            for _ in range(15):
                local = self.surface(d, offset)
                world = (local[0]+self.center["x"], local[1]+self.center["y"])
                if all(base.distance_to_polyline(world, line) > width+1 for line, width in self.corridors):
                    break
                offset += side*2
            offsets.append(offset)
            p = self.surface(d, offset)
            gantry.add_cylinder(p, .25, 6.5, sides=6, color=(.50, .52, .50, 1))
        a, b = (self.surface(d, offset) for offset in offsets)
        tools.beam(gantry, Vector(a)+Vector((0, 0, 6.3)), Vector(b)+Vector((0, 0, 6.3)), .25, (.56, .57, .54, 1))
        for i in range(5):
            p = self.surface(d, (i-2)*1.25)
            gantry.add_box((p[0], p[1], p[2]+5.9), (.42, .42, .56), color=(.06, .06, .06, 1))
        gantry.create_object("Qatar_Pit_And_Gantry_Details", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        for obj in bpy.data.objects:
            if obj.name.startswith("Suzuka_"):
                obj.name = obj.name.replace("Suzuka_", "Qatar_")
                if obj.type == "MESH":
                    obj.data.name = obj.data.name.replace("Suzuka_", "Qatar_")
        return result


def main():
    args = base.parse_args()
    config = json.loads(Path(args.input).read_text())
    prepared = Path(args.prepared)
    raster_meta = json.loads((prepared/"raster-metadata.json").read_text())
    raster = base.HeightRaster(prepared/"qatar-dtm.f32le", raster_meta["rasters"]["dtm"], config["model"]["bounds"])
    raster.profiles = json.loads((prepared/"qatar-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collections = base.create_collections()
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1
    scene["coordinate_reference_system"] = "EPSG:32639"
    scene["vertical_datum"] = "EGM2008 orthometric metres (EPSG:3855), GEDTM30 estimate"
    scene["real_world_scale"] = "1 unit = 1 metre; no vertical exaggeration"
    grain = helpers.texture("Qatar_Mineral_Surface")
    facade = helpers.texture("Qatar_Facade_Window_Detail", "facade")
    materials = dict(
        terrain=base.create_aerial_material(prepared/"qatar-ground.jpg"),
        asphalt=tools.textured_material("Qatar_Asphalt", (.29, .29, .28, 1), grain),
        white=tools.textured_material("Qatar_White_Paint", (.91, .91, .85, 1), grain),
        red=tools.textured_material("Qatar_Red_Kerbs", (.78, .13, .15, 1), grain),
        black=tools.textured_material("Qatar_Checker_Black", (.035, .035, .035, 1), grain),
        concrete=tools.textured_material("Qatar_Pit_Concrete", (.71, .70, .65, 1), grain),
        maroon=tools.textured_material("Qatar_Maroon_Pit_Wall", (.55, .13, .26, 1), grain),
        vertex=tools.textured_material("Qatar_Source_Colored_Objects", (1, 1, 1, 1), grain, vertex=True),
        facade=tools.textured_material("Qatar_Textured_Facades", (1, 1, 1, 1), facade, vertex=True),
        fence=helpers.fence_material(),
        runoff=tools.textured_material("Qatar_Blue_Aqua_Painted_Runoff", (1, 1, 1, 1), artwork_texture()))
    materials["terrain"].name = "Qatar_Sentinel_OSM_Ground"
    materials["fence"].name = "Qatar_Chain_Link_Fence"
    materials["seats"] = tools.seating_material()
    materials["seats"].name = "Qatar_Gray_Seat_Rows"
    for img in bpy.data.images:
        img.name = img.name.replace("Suzuka_", "Qatar_").replace("Mexico_", "Qatar_")
    aerial = next(n.image for n in materials["terrain"].node_tree.nodes if n.type == "TEX_IMAGE")
    materials["sectors"], materials["halos"] = [], []
    for i, color in enumerate([(.80, .02, .015, 1), (.97, .43, .02, 1), (.02, .56, .72, 1)]):
        materials["sectors"].append(base.create_material(f"Qatar_Sector_{i+1}", tools.linear(color), .8))
        materials["halos"].append(base.create_material(f"Qatar_Sector_{i+1}_Glow", (*tools.linear(color)[:3], .30), .5, emission_strength=1.3))
    model = QatarScene(config, raster, collections, materials, aerial)
    model.terrain()
    samples, curbs = model.road()
    pit = model.pit_lane()
    clearance = base.measure_ribbon_terrain_clearance(samples, raster, 0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Qatar driving surfaces intersect terrain: {clearance}, {pit['surfaceClearance']}")
    print("Qatar terrain, asphalt, kerbs and pit built", flush=True)
    stands, buildings = model.grandstands(), model.buildings()
    infrastructure, vegetation = model.infrastructure(), model.vegetation()
    profile, low, high = model.annotations()
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            tools.uv_surface(obj, 2)
    print("Qatar textured physical scene built", flush=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = "WEBP", "RGBA"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform, scene.view_settings.look = "Standard", "None"
    scene.world = bpy.data.worlds.new("Qatar_World")
    scene.world.color = (.10, .12, .13)
    base.add_lighting(collections["Terrain"])
    camera_data = bpy.data.cameras.new("QatarPreview")
    camera_data.type, camera_data.ortho_scale, camera_data.clip_end = "ORTHO", 2200, 10000
    camera = bpy.data.objects.new("QatarPreview", camera_data)
    collections["Terrain"].objects.link(camera)
    camera.location = (0, -800, 2700)
    base.look_at(camera, (0, 0, 12))
    scene.camera = camera
    scene.render.filepath = str(Path(args.preview).resolve())
    bpy.ops.render.render(write_still=True)
    for img in bpy.data.images:
        if img.source == "FILE":
            img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    tools.export(Path(args.glb).resolve())
    metadata = dict(schemaVersion=4, modelId="qatar", generatedWith=f"Blender {bpy.app.version_string}",
        coordinateReferenceSystem="EPSG:32639", verticalDatum="EGM2008 orthometric metres (EPSG:3855), GEDTM30 estimate",
        verticalExaggeration=1, realWorldScale="1 unit = 1 metre; no vertical exaggeration",
        originMeters=config["model"]["center"], boundsMeters=dict(width=1660, depth=1840),
        lapLength=dict(geometryMeters=model.total, officialFiaMeters=5419, relativeErrorPercent=abs(model.total-5419)/5419*100),
        elevationProfile=profile, elevationsMeters=dict(low=low["elevationMeters"], high=high["elevationMeters"]),
        finishDistanceMeters=0, raceStartDistanceMeters=config["officialControlPoints"]["raceStartDistanceMeters"], baseElevationMeters=0,
        sectorBoundaryDistancesMeters=config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        objects=dict(turnAnchors=16, pitGarageBoxes=50, buildingsTotal=buildings["count"],
            grandstandFootprints=stands["count"], raceMotorhomes=0,
            permanentTeamHospitality=buildings["permanentTeamHospitality"], **infrastructure, **vegetation),
        layoutQuality=dict(surfaceClearance=clearance, pitLane=pit, grandstands=stands, buildings=buildings,
            curbs=curbs, terrainSurface=raster_meta["terrainSurface"], roadGrading=raster_meta["roadGrading"]),
        materials=dict(physicalObjectsTextured=True, colorSpace="sRGB source colours converted once to linear vertex colours",
            facadeMethod="LIC / architect photo colours with authored repeating window detail; not facade photogrammetry",
            roofMethod="source-informed cream and light sand colours with embedded mineral texture",
            paintedRunoffMethod="LIC photograph blue/aqua geometric apron; simplified authored repeat"),
        controlPointReference=config["officialControlPoints"], sourceManifest=config["sourceManifest"],
        limitations=config["limitations"], publicationStatus="review-required")
    Path(args.metadata).write_text(json.dumps(metadata, indent=2, ensure_ascii=False)+"\n")
    print(json.dumps(dict(lapLength=metadata["lapLength"], clearance=clearance, objects=metadata["objects"])), flush=True)


if __name__ == "__main__":
    main()
