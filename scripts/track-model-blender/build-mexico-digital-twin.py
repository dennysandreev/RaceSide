#!/usr/bin/env python3
"""Build Hermanos Rodríguez in real UTM metres from its own pinned sources."""

from bisect import bisect_right
from array import array
import importlib.util
import json
import math
from pathlib import Path
import random

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
COPYRIGHT = ("© 2026 RaceSide. Mexico 3D model and preview: CC BY-SA 4.0, "
             "https://creativecommons.org/licenses/by-sa/4.0/. Contains modified Planet Labs, Inc. "
             "SkySat imagery, acquired 4 June 2018; cropped, georegistered, colour-sampled and rendered. "
             "Source: https://commons.wikimedia.org/wiki/File:Autódromo_Hermanos_Rodríguez,_June_4,_2018_SkySat.jpg. "
             "Geographic data © OpenStreetMap contributors, ODbL 1.0. Terrain: OpenGeoHub / Ho et al. (2025), "
             "GEDTM30, CC BY 4.0. This notice applies to the model and preview; site software is separately licensed.")
spec = importlib.util.spec_from_file_location("mexico_mesh_tools", SCRIPTS / "build-zandvoort-digital-twin.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PIT_LANE_WIDTH_METERS = 8
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 201, 121


def linear(color):
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in color[:3]) + (color[3],)


class SourceMesh(base.MeshBuilder):
    def add_triangle(self, triangle, material_index=0, color=None):
        super().add_triangle(triangle, material_index, linear(color) if color is not None else None)

    def create_object(self, name, materials, collection, vertex_colors=False):
        obj = super().create_object(name, materials, collection, vertex_colors=vertex_colors)
        attribute = obj.data.color_attributes.get("SurfaceColor")
        if attribute is not None:
            colors = array("f", [0]) * (len(attribute.data) * 4)
            attribute.data.foreach_get("color", colors)
            obj.data.color_attributes.remove(attribute)
            attribute = obj.data.color_attributes.new(name="SurfaceColor", type="FLOAT_COLOR", domain="CORNER")
            attribute.data.foreach_set("color", colors)
        return obj


base.MeshBuilder = SourceMesh


def road_section(points, cumulative, distance, raster, datum, width, z_offset=.45, closed=True, banked=False):
    point = base.sample_polyline(points, cumulative, distance, closed=closed)
    tangent = base.sample_tangent(points, cumulative, distance, closed=closed)
    profile = raster.profiles[0 if closed else 1]
    d = distance % cumulative[-1] if closed else min(max(distance, 0), cumulative[-1])
    steps, values = profile["distanceMeters"], profile["elevationMeters"]
    i = min(max(bisect_right(steps, d) - 1, 0), len(steps) - 2)
    t = (d - steps[i]) / max(steps[i + 1] - steps[i], 1e-9)
    elevation = values[i] * (1 - t) + values[i + 1] * t
    return point, tangent, Vector((-tangent.y, tangent.x)), elevation - datum + z_offset, 0


base.road_cross_section = road_section


def surface_texture(name, facade=False):
    """Small repeatable surface detail, tinted by independently sourced colors."""
    rng = random.Random(1947 if facade else 1962)
    size = 128
    image = bpy.data.images.new(name, width=size, height=size)
    pixels = []
    for y in range(size):
        for x in range(size):
            value = .84 + rng.random() * .16
            if facade:
                # Neutral glazing and mullions; facade layout is an approximation.
                if 12 < x % 32 < 27 and 35 < y % 64 < 56:
                    value = .28 + rng.random() * .08
                elif x % 32 == 0 or y % 64 == 0:
                    value = .67
            pixels.extend((value, value, value, 1))
    image.colorspace_settings.name = "sRGB"
    image.pixels[:] = pixels
    image.update()
    image.pack()
    return image


def seating_material():
    """One shell-seat tile for distant stands; actual bowl seats stay meshes."""
    image = bpy.data.images.new("Mexico_Repeating_Shell_Seat", width=64, height=64)
    pixels = []
    for y in range(64):
        for x in range(64):
            u, v = (x + .5) / 64, (y + .5) / 64
            # Rounded shell edges and a lighter central moulded seat surface.
            inside = abs(u - .5) < .40 - .12 * ((v - .5) / .5) ** 4 and .10 < v < .91
            shade = .80 + .15 * math.cos((u - .5) * math.pi) if inside else .48
            pixels.extend((shade, shade, shade, 1))
    image.pixels[:] = pixels
    image.pack()
    material = textured_material("Mexico_Colored_Seat_Rows", (1, 1, 1, 1), image, vertex=True)
    return material


def fence_material():
    image = bpy.data.images.new("Mexico_Chain_Link", width=128, height=128)
    pixels = []
    for y in range(128):
        for x in range(128):
            wire = (x + y) % 16 < 2 or (x - y) % 16 < 2
            pixels.extend((.58, .60, .59, .88 if wire else 0))
    image.pixels[:] = pixels
    image.pack()
    material = textured_material("Mexico_Safety_Fence", (1, 1, 1, 1), image)
    nodes = material.node_tree.nodes
    material.node_tree.links.new(next(n for n in nodes if n.type == "TEX_IMAGE").outputs["Alpha"],
                                nodes.get("Principled BSDF").inputs["Alpha"])
    material.surface_render_method = "DITHERED"
    material.use_transparency_overlap = False
    return material


def textured_material(name, color, image, vertex=False, roughness=.86):
    mat = base.create_material(name, linear(color), roughness, use_vertex_color=vertex)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "REPEAT"
    principled = nodes.get("Principled BSDF")
    # Blender 5.2's glTF exporter recognizes the current Mix color node.
    multiply = nodes.new("ShaderNodeMix")
    multiply.data_type = "RGBA"
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    multiply.inputs[7].default_value = linear(color)
    links.new(texture.outputs["Color"], multiply.inputs[6])
    if vertex:
        links.new(next(node for node in nodes if node.type == "VERTEX_COLOR").outputs["Color"], multiply.inputs[7])
    links.new(multiply.outputs[2], principled.inputs["Base Color"])
    return mat


def uv_surface(obj, scale=4):
    if obj.data.uv_layers:
        return
    uv = obj.data.uv_layers.new(name="PhysicalSurfaceUV")
    for face in obj.data.polygons:
        axis = max(range(3), key=lambda i: abs(face.normal[i]))
        dimensions = [i for i in range(3) if i != axis]
        for loop_index in face.loop_indices:
            point = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (point[dimensions[0]] / scale, point[dimensions[1]] / scale)


def aerial_uv(obj, center, bounds):
    uv = obj.data.uv_layers.new(name="SourceAerialUV")
    for loop in obj.data.loops:
        p = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x + center["x"] - bounds["minX"]) / (bounds["maxX"] - bounds["minX"]),
                                   (p.y + center["y"] - bounds["minY"]) / (bounds["maxY"] - bounds["minY"]))


def beam(builder, a, b, radius=.12, color=(.20, .23, .24, 1), sides=4):
    a, b = Vector(a), Vector(b)
    axis = b - a
    if axis.length < .01:
        return
    axis.normalize()
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < .01:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u)
    ring = [(u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides)) * radius for i in range(sides)]
    for i in range(sides):
        builder.add_quad([a + ring[i], b + ring[i], b + ring[(i + 1) % sides], a + ring[(i + 1) % sides]], color=color)


def polygon_scanline_spans(polygon, along):
    """Return actual normal spans at one along-axis section of a concave ring."""
    crossings = []
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[0] <= along < b[0]) or (b[0] <= along < a[0]):
            t = (along - a[0]) / (b[0] - a[0])
            crossings.append(a[1] + t * (b[1] - a[1]))
    crossings.sort()
    return list(zip(crossings[::2], crossings[1::2]))


def clip_to_triangle(polygon, triangle):
    """Clip a convex canopy panel to one source-footprint triangle."""
    result = list(polygon)
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(triangle, triangle[1:] + triangle[:1]))
    sign = 1 if area > 0 else -1
    for a, b in zip(triangle, triangle[1:] + triangle[:1]):
        if not result:
            break
        def signed_distance(p):
            return sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
        clipped = []
        for start, end in zip(result, result[1:] + result[:1]):
            first, last = signed_distance(start), signed_distance(end)
            if first >= -1e-7:
                clipped.append(start)
            if (first >= 0) != (last >= 0):
                t = first / (first - last)
                clipped.append((start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])))
        result = clipped
    return result


class MexicoScene:
    def __init__(self, config, raster, collections, materials):
        self.config, self.raster, self.c, self.m = config, raster, collections, materials
        self.center = config["model"]["center"]
        self.line, self.pit = config["model"]["centerline"], config["model"]["pitCenterline"]
        self.cum, self.total = base.line_distance(self.line)
        self.pc, self.pt = base.line_distance(self.pit)
        self.width = config["model"].get("trackWidthMeters", 12)
        self.turns = config["model"]["turns"]
        self.features = config["vectors"]
        self.corridors = [(base.sample_line_points(self.line, self.cum, 3), self.width / 2 + 1),
                          (base.sample_line_points(self.pit, self.pc, 3, closed=False), 4.5)]
        self.reserved = []

    def xy(self, point):
        return base.local_xy(point, self.center)

    def ground(self, point):
        return self.raster.sample(*point)

    def surface(self, d, offset=0, pit=False, lift=.45):
        line, cum, width = (self.pit, self.pc, 8) if pit else (self.line, self.cum, self.width)
        return base.road_surface_point(line, cum, d, offset, self.raster, self.center, 0, width,
                                       z_offset=lift, closed=not pit)

    def strip(self, builder, start, end, left, right, material=0, pit=False, lift=.57):
        builder.add_quad([self.surface(d, offset, pit, lift) for d, offset in
                          ((start, left), (end, left), (end, right), (start, right))], material)

    def roadway(self):
        road, _, _, samples = base.create_ribbon("Mexico_Raceway", self.line, self.raster, self.center, 0,
            self.width, self.m["asphalt"], self.c["Circuit"], interval=2, z_offset=.45)
        road["source"] = "Current OSM Grand Prix loop, checked against FIA 2025"
        edge = base.MeshBuilder()
        half = self.width / 2
        for d in range(0, math.ceil(self.total), 2):
            for side in (-1, 1):
                self.strip(edge, d, min(d + 2, self.total), side * (half - .35), side * (half - .18))
        edge.create_object("Mexico_Edge_Paint", [self.m["white"]], self.c["Circuit"])
        curbs = base.MeshBuilder()
        count = 0
        for turn in self.turns:
            d = turn["distanceMeters"]
            a, b = base.sample_tangent(self.line, self.cum, d - 12), base.sample_tangent(self.line, self.cum, d + 12)
            side = 1 if a.x * b.y - a.y * b.x > 0 else -1
            span = 14 if 7 <= turn["number"] <= 15 else 24
            for i in range(math.ceil(span * 2 / 2)):
                start = d - span + i * 2
                self.strip(curbs, start, min(start + 2, d + span), side * half, side * (half + .85), i % 2, lift=.61)
                count += 1
        curbs.create_object("Mexico_Kerbs", [self.m["red"], self.m["white"]], self.c["Circuit"])
        return samples, {"sections": count, "widthMeters": .85, "placement": "inner apex intervals; exact kerb extents approximate"}

    def pit_lane(self):
        _, _, _, samples = base.create_ribbon("Mexico_Pit_Lane", self.pit, self.raster, self.center, 0, 8,
            self.m["asphalt"], self.c["Circuit"], interval=2, closed=False, taper_meters=25,
            minimum_start_width=4, minimum_end_width=4, z_offset=.45)
        frontage = self.config["model"].get("pitFrontageDistancesMeters", [self.pt * .2, self.pt * .78])
        first, last = frontage
        boxes = self.config["model"]["pitBoxes"]
        marks = base.MeshBuilder()
        side = self.config["model"].get("pitGarageSide", 1)
        for i in range(boxes + 1):
            d = first + (last - first) * i / boxes
            self.strip(marks, d, d + .16, side * 1.3, side * 3.85, pit=True, lift=.59)
        for d in range(math.ceil(first), math.floor(last), 3):
            self.strip(marks, d, d + 2, side * 1.2, side * 1.35, pit=True, lift=.59)
        marks.create_object(f"Mexico_Fast_Lane_{boxes}_Boxes", [self.m["white"]], self.c["Circuit"])
        wall, quality = base.create_pit_wall(self.pit, self.line, self.raster, self.center, 0,
            [self.m["concrete"], self.m["fence"]], self.c["Circuit"],
            start_ratio=first / self.pt, end_ratio=last / self.pt, wall_height=1.05, fence_height=1.15)
        wall.name, wall.data.name = "Mexico_Pit_Wall", "Mexico_Pit_Wall_Mesh"
        return {"lengthMeters": self.pt, "laneWidthMeters": 8, "pitBoxes": boxes,
                "garageFrontageDistanceMeters": frontage, "fastLaneSeparator": True, "pitWall": quality,
                "entryGapMeters": base.distance_to_polyline(self.pit[0], self.line),
                "exitGapMeters": base.distance_to_polyline(self.pit[-1], self.line),
                "surfaceClearance": base.measure_ribbon_terrain_clearance(samples, self.raster, 0)}

    def grandstands(self):
        builder = base.MeshBuilder()
        seat_rows, seat_uvs = base.MeshBuilder(), []
        details, excluded = [], []
        features = self.config.get("grandstands", [f for f in self.features if f["tags"].get("building") == "grandstand"])
        for feature in features:
            if feature["id"] in (377679562, 1315400018):
                # The renovated stadium has two curved seating banks under one
                # continuous horseshoe canopy, reconstructed separately below.
                continue
            polygon = feature["world"]
            if polygon[0] == polygon[-1]:
                polygon = polygon[:-1]
            if len(polygon) < 3:
                continue
            if base.polygon_intersects_corridors(polygon, self.corridors):
                excluded.append({"id": feature["id"], "reason": "enclosed stand footprint intersects driving corridor"})
                continue
            self.reserved.append(polygon)
            edges = sorted(zip(polygon, polygon[1:] + polygon[:1]), key=lambda ab: math.dist(*ab), reverse=True)
            a, b = Vector(edges[0][0]), Vector(edges[0][1])
            axis = (b - a).normalized()
            normal = Vector((-axis.y, axis.x))
            along, across = zip(*[(Vector(p).dot(axis), Vector(p).dot(normal)) for p in polygon])
            lo, hi = min(along), max(along)
            front, rear = min(across), max(across)
            if base.distance_to_polyline(axis * ((lo + hi) / 2) + normal * front, self.line) > base.distance_to_polyline(axis * ((lo + hi) / 2) + normal * rear, self.line):
                front, rear = rear, front
            depth = abs(rear - front)
            rows = feature.get("rows", min(48, max(5, round(depth / .95))))
            # Sections follow the source polygon and stop outside curved corners.
            sections = max(1, math.ceil((hi - lo) / 12))
            seat_color = tuple(feature.get("seatColor", [.24, .33, .46])) + (1,)
            count = 0
            for section in range(sections):
                left, right = lo + (hi - lo) * section / sections + .1, lo + (hi - lo) * (section + 1) / sections - .1
                for row in range(rows):
                    f, r = front + (rear - front) * row / rows, front + (rear - front) * (row + 1) / rows
                    ring = [axis * u + normal * v for u, v in ((left, f), (right, f), (right, r), (left, r))]
                    if not all(base.point_in_polygon(p, polygon) or base.distance_point_polygon(p, polygon) < .12 for p in ring):
                        continue
                    ground = max(self.ground(p) for p in ring)
                    top = ground + .8 + row * .42
                    bottom = [(*self.xy(p), self.ground(p)) for p in ring]
                    builder.add_volume(bottom, [(*self.xy(p), top) for p in ring], color=(.55, .56, .54, 1))
                    # Individual rows and seats preserve colored, open stadium terraces.
                    seats = max(2, int((right - left) / .60))
                    p = axis * left + normal * ((f + r) / 2)
                    q = axis * right + normal * ((f + r) / 2)
                    fore = normal * .20
                    ring = [p - fore, q - fore, q + fore, p + fore]
                    # Distant non-stadium rows use repeating shell-seat textures,
                    # reserving individual geometry for the stadium close view.
                    seat_rows.add_quad([(*self.xy(v), top + .14) for v in ring], color=seat_color)
                    seat_rows.add_quad([(*self.xy(v), z) for v, z in
                        ((ring[2], top + .14), (ring[3], top + .14),
                         (ring[3], top + .52), (ring[2], top + .52))], color=seat_color)
                    for _ in range(2):
                        seat_uvs.extend(((0, 0), (seats, 0), (seats, 1), (0, 0), (seats, 1), (0, 1)))
                    count += 1
            canopy_panels = 0
            fraction = feature.get("coveredRearFraction", 0)
            if fraction:
                roof_color = tuple(feature.get("roofColor", [.52, .25, .12])) + (1,)
                local_polygon = [(Vector(p).dot(axis), Vector(p).dot(normal)) for p in polygon]
                source_triangles = [[(v.x, v.y) for v in triangle] for triangle in
                                    base.resolved_tessellation([[Vector((u, v, 0)) for u, v in local_polygon]])]
                for section in range(sections):
                    left, right = lo + (hi - lo) * section / sections, lo + (hi - lo) * (section + 1) / sections
                    middle = (left + right) / 2
                    # Curved and L-shaped stands can have several independent
                    # spans. Follow each span, then clip every panel to the
                    # source triangles so no roof fills an empty bbox corner.
                    for low, upper in polygon_scanline_spans(local_polygon, middle):
                        local_front, local_rear = (low, upper) if front < rear else (upper, low)
                        roof_front = local_rear + (local_front - local_rear) * fraction
                        center = axis * middle + normal * local_rear
                        high = self.ground(center) + rows * .42 + 4.3
                        for segment in range(4):
                            start = roof_front + (local_rear - roof_front) * segment / 4
                            end = roof_front + (local_rear - roof_front) * (segment + 1) / 4
                            panel = [(left, start), (right, start), (right, end), (left, end)]
                            for source_triangle in source_triangles:
                                clipped = clip_to_triangle(panel, source_triangle)
                                for i in range(1, len(clipped) - 1):
                                    roof = []
                                    for u, v in (clipped[0], clipped[i], clipped[i + 1]):
                                        t = (v - roof_front) / (local_rear - roof_front)
                                        p = axis * u + normal * v
                                        roof.append((*self.xy(p), high + (t - .5) ** 2 * 2.4))
                                    if (Vector(roof[1]) - Vector(roof[0])).cross(Vector(roof[2]) - Vector(roof[0])).z < 0:
                                        roof.reverse()
                                    builder.add_triangle(roof, color=roof_color)
                                    builder.add_triangle(list(reversed([(x, y, z - .12) for x, y, z in roof])), color=roof_color)
                                    canopy_panels += 1
                        for u in (left + .3, right - .3):
                            for support_low, support_high in polygon_scanline_spans(local_polygon, u):
                                if support_low - .1 <= (low + upper) / 2 <= support_high + .1:
                                    support_front, support_rear = (support_low, support_high) if front < rear else (support_high, support_low)
                                    support_front = support_rear + (support_front - support_rear) * fraction
                                    back, edge = axis * u + normal * support_rear, axis * u + normal * support_front
                                    beam(builder, (*self.xy(back), self.ground(back)), (*self.xy(back), high + .6), .17)
                                    beam(builder, (*self.xy(back), high + .6), (*self.xy(edge), high + .6), .12)
                                    beam(builder, (*self.xy(back), high - 1.8), (*self.xy(edge), high + .6), .10)
                                    break
            details.append({"osmWayId": feature["id"], "name": feature.get("name", feature.get("tags", {}).get("name", "Grandstand")),
                            "rows": rows, "sections": count, "seatColor": list(seat_color[:3]),
                            "groundAnchored": True, "footprint": polygon, "canopyPanels": canopy_panels,
                            "coveredRearFraction": fraction})
        builder.create_object("Mexico_Grandstands", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        seats_object = seat_rows.create_object("Mexico_Grandstand_Seat_Rows", [self.m["seats"]], self.c["Infrastructure"], vertex_colors=True)
        uv = seats_object.data.uv_layers.new(name="IndividualSeatTileUV")
        for loop, value in zip(uv.data, seat_uvs):
            loop.uv = value
        return {"footprints": details, "sections": sum(d["sections"] for d in details), "excluded": excluded,
                "supportGroundGapMeters": 0, "colorMethod": "source aerial samples; individual seat shape approximate"}

    def stadium(self):
        """Sweep the author-plan terraces and curved cantilever roof in metres."""
        reference = self.config["stadiumReference"]
        section, roof = reference["seatingSection"], reference["roof"]
        terraces, structure, canopy = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        front_walls = base.MeshBuilder()
        seat_faces = []
        concrete = tuple(section["concreteColor"]) + (1,)
        seat_color = tuple(section["seatColor"]) + (1,)
        steel = tuple(roof["steelColor"]) + (1,)
        # A level structural deck is supported on the actual ground. Following
        # every DEM cell with the seats would introduce fictitious bowl waves.
        floor = self.config["stadiumGrading"]["elevationMeters"] + .08
        lower_top = section["frontHeightMeters"] + section["lowerRows"] * section["lowerRiseMeters"]
        bank_details = []
        for bank in reference["seatingBanks"]:
            self.reserved.append(bank["outlineMeters"])
            # Paired radial stations keep the rounded corner at every row;
            # cutting complete rectangular cells from a polygon loses it.
            stations = []
            fronts, rears = bank["frontPathMeters"], bank["rearPathMeters"]
            for i in range(len(fronts) - 1):
                pieces = max(1, math.ceil(max(math.dist(fronts[i], fronts[i + 1]), math.dist(rears[i], rears[i + 1])) / 2.5))
                for j in range(pieces):
                    t = j / pieces
                    stations.append((Vector(fronts[i]).lerp(Vector(fronts[i + 1]), t),
                                     Vector(rears[i]).lerp(Vector(rears[i + 1]), t)))
            stations.append((Vector(fronts[-1]), Vector(rears[-1])))
            def row_line(fraction):
                return [front.lerp(rear, fraction) for front, rear in stations]
            seats = 0
            for rows, start, end, height, rise in (
                (section["lowerRows"], 0, section["lowerDepthFraction"], section["frontHeightMeters"], section["lowerRiseMeters"]),
                (section["upperRows"], section["concourseRearFraction"], 1, lower_top, section["upperRiseMeters"]),
            ):
                for row in range(rows):
                    first = row_line(start + (end - start) * row / rows)
                    last = row_line(start + (end - start) * (row + 1) / rows)
                    top, below = floor + height + (row + 1) * rise, floor + height + row * rise
                    for a, b, c, d in zip(first, first[1:], last[1:], last):
                        terraces.add_quad([(*self.xy(p), top) for p in (a, b, c, d)], color=concrete)
                        terraces.add_quad([(*self.xy(a), below), (*self.xy(b), below),
                                           (*self.xy(b), top), (*self.xy(a), top)], color=concrete)
                    centers = [a.lerp(b, .5) for a, b in zip(first, last)]
                    cumulative, total = base.line_distance(centers)
                    count = max(1, int(total / section["seatPitchMeters"]))
                    for index in range(count):
                        distance = total * (index + .5) / count
                        # Clear radial stair aisles across both seating banks.
                        if min(distance % section["aisleSpacingMeters"], section["aisleSpacingMeters"] - distance % section["aisleSpacingMeters"]) < section["aisleWidthMeters"] / 2:
                            continue
                        p = Vector(base.sample_polyline(centers, cumulative, distance, closed=False))
                        tangent = base.sample_tangent(centers, cumulative, distance, delta=.4, closed=False)
                        segment = min(max(bisect_right(cumulative, distance) - 1, 0), len(stations) - 2)
                        backward = (stations[segment][1] - stations[segment][0]).normalized()
                        side, fore = tangent * .22, backward * .18
                        points = [p - side - fore, p + side - fore, p + side + fore, p - side + fore]
                        seat_faces.extend(range(len(terraces.faces), len(terraces.faces) + 4))
                        terraces.add_quad([(*self.xy(q), top + .13) for q in points], color=seat_color)
                        terraces.add_quad([(*self.xy(q), z) for q, z in
                            ((points[2], top + .13), (points[3], top + .13),
                             (points[3], top + .49), (points[2], top + .49))], color=seat_color)
                        seats += 1
                # Thin sloping underside, leaving the steel framing open below.
                first, last = row_line(start), row_line(end)
                for a, b, c, d in zip(first, first[1:], last[1:], last):
                    terraces.add_quad([(*self.xy(a), floor + height - .25), (*self.xy(d), floor + height + rows * rise - .25),
                                       (*self.xy(c), floor + height + rows * rise - .25), (*self.xy(b), floor + height - .25)], color=concrete)
            # Wide level concourse divides the small lower and steep upper banks.
            front, rear = row_line(section["lowerDepthFraction"]), row_line(section["concourseRearFraction"])
            for a, b, c, d in zip(front, front[1:], rear[1:], rear):
                terraces.add_quad([(*self.xy(p), floor + lower_top) for p in (a, b, c, d)], color=(.46, .48, .48, 1))
            # Hospitality facade beneath the lower terrace; no towering solid
            # wall under the entire upper bank as in the former block extrusion.
            for a, b in zip(row_line(0), row_line(0)[1:]):
                front_walls.add_quad([(*self.xy(a), self.ground(a)), (*self.xy(b), self.ground(b)),
                                   (*self.xy(b), floor + section["frontHeightMeters"]),
                                   (*self.xy(a), floor + section["frontHeightMeters"])], color=concrete)
            for i, (front, rear) in enumerate(stations):
                if i % 6 and i not in (0, len(stations) - 1):
                    continue
                upper_front = front.lerp(rear, section["concourseRearFraction"])
                foot = (*self.xy(rear), self.ground(rear))
                high = (*self.xy(rear), floor + lower_top + section["upperRows"] * section["upperRiseMeters"] - .25)
                beam(structure, foot, high, .22, steel)
                beam(structure, (*self.xy(upper_front), floor + lower_top - .25), high, .14, steel)
                beam(structure, (*self.xy(upper_front), self.ground(upper_front)), (*self.xy(upper_front), floor + lower_top), .15, steel)
                beam(structure, (*self.xy(rear), floor + 2), (*self.xy(upper_front), floor + lower_top), .10, steel)
            bank_details.append({"osmWayId": bank["osmWayId"], "name": bank["name"], "footprint": bank["outlineMeters"],
                "rows": section["lowerRows"] + section["upperRows"], "lowerRows": section["lowerRows"], "upperRows": section["upperRows"],
                "sections": len(stations) - 1, "individualSeats": seats, "seatColor": list(seat_color[:3]), "groundAnchored": True})
        terraces_object = terraces.create_object("Mexico_Stadium_Grandstands", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        front_walls.create_object("Mexico_Stadium_Front_Walls", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        for i in seat_faces:
            terraces_object.data.polygons[i].use_smooth = True
        # One coherent microtexture projection shares the pan/back joint and
        # keeps rounded chair normals while retaining flat concrete stair faces.
        uv = terraces_object.data.uv_layers.new(name="StadiumSurfaceUV")
        for loop in terraces_object.data.loops:
            p = terraces_object.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (p.x / 2, p.y / 2)
        # Fifty-eight deep C-shaped trusses support one continuous membrane,
        # including the span above the western track passage.
        support, inward = roof["supportPathMeters"], roof["inwardVectors"]
        cumulative, total = base.line_distance(support)
        def frame(distance):
            point = Vector(base.sample_polyline(support, cumulative, distance, closed=False))
            i = min(max(bisect_right(cumulative, distance) - 1, 0), len(support) - 2)
            t = (distance - cumulative[i]) / max(cumulative[i + 1] - cumulative[i], 1e-9)
            normal = Vector(inward[i]).lerp(Vector(inward[i + 1]), t).normalized()
            return point, normal
        def vertex(distance, offset, height):
            point, normal = frame(distance)
            return (*self.xy(point + normal * offset), floor + height)
        truss_distances = [total * i / (roof["trusses"] - 1) for i in range(roof["trusses"])]
        for distance in truss_distances:
            top = [vertex(distance, offset, height) for offset, height in zip(roof["sectionOffsetsMeters"], roof["upperChordHeightsMeters"])]
            bottom = [vertex(distance, offset, height) for offset, height in zip(roof["sectionOffsetsMeters"], roof["lowerChordHeightsMeters"])]
            for i in range(len(top) - 1):
                beam(structure, top[i], top[i + 1], .22, steel, sides=8)
                beam(structure, bottom[i], bottom[i + 1], .19, steel, sides=8)
                beam(structure, bottom[i], top[i + 1], .12, steel)
                beam(structure, top[i], bottom[i], .12, steel)
            point, _ = frame(distance)
            if base.distance_to_polyline(point, self.line) > self.width / 2 + .65:
                # The west passage carries the circuit below the continuous
                # roof. Its spanning trusses have no column in the roadway.
                beam(structure, (*self.xy(point), self.ground(point)), bottom[0], .30, concrete)
        profile = [(-roof["rearProjectionMeters"], 26.8), (-5, 31), (0, 31.7), (8, 32), (16, 31.9), (24, 31.5)]
        roof_color = tuple(roof["topColor"]) + (1,)
        for first, last in zip(truss_distances, truss_distances[1:]):
            for along in range(4):
                a, b = first + (last - first) * along / 4, first + (last - first) * (along + 1) / 4
                bulge_a, bulge_b = .5 * math.sin(math.pi * along / 4), .5 * math.sin(math.pi * (along + 1) / 4)
                for (offset_a, height_a), (offset_b, height_b) in zip(profile, profile[1:]):
                    quad = [vertex(a, offset_a, height_a + bulge_a), vertex(b, offset_a, height_a + bulge_b),
                            vertex(b, offset_b, height_b + bulge_b), vertex(a, offset_b, height_b + bulge_a)]
                    canopy.add_quad(quad, color=roof_color)
                    canopy.add_quad(list(reversed([(x, y, z - .10) for x, y, z in quad])), color=roof_color)
            for offset, height in profile:
                beam(structure, vertex(first, offset, height - .15), vertex(last, offset, height - .15), .09, steel)
        canopy.create_object("Mexico_Stadium_Canopy", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        structure.create_object("Mexico_Stadium_Trusses", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        hospitality = self.stadium_east_hospitality(floor)
        return {"sourceUrl": reference["sourceUrl"], "sourceFiles": reference["sourceFiles"], "registration": reference["registration"],
            "seatingBanks": bank_details, "seatingSection": section, "roof": roof, "floorElevationMeters": floor,
            "eastHospitality": hospitality,
            "continuousCanopyOverWesternPassage": True, "seatingHeightMeters": lower_top + section["upperRows"] * section["upperRiseMeters"],
            "precision": "author-plan proportions and mapped geographic controls; unresolved vertical construction dimensions remain visual estimates"}

    def stadium_east_hospitality(self, floor):
        """Two occupied event balconies on the east frontage, with a north return."""
        reference = self.config["stadiumReference"]["eastHospitality"]
        builder = base.MeshBuilder()
        colors = {key: tuple(value) + (1,) for key, value in reference["palette"].items()}
        fronts, rears = reference["frontPathMeters"], reference["rearPathMeters"]
        length = math.dist(*fronts)
        sections = math.ceil(length / 10)
        def point(t, depth, height):
            front = Vector(fronts[0]).lerp(Vector(fronts[1]), t)
            rear = Vector(rears[0]).lerp(Vector(rears[1]), t)
            return (*self.xy(front.lerp(rear, depth)), floor + height)
        def panel(a, b, near, far, height, color):
            builder.add_quad([point(a, near, height), point(b, near, height),
                              point(b, far, height), point(a, far, height)], color=color)
        self.reserved.append(reference["outlineMeters"])
        seats = 0
        for height in reference["deckHeightsMeters"]:
            # Rear lounge and three shallow viewing rows: this is the small
            # event hospitality wing, whose occupied balconies face west.
            panel(0, 1, 0, 1, height - .15, colors["deck"])
            panel(0, 1, 0, .2, height, colors["deck"])
            panel(0, 1, .52, 1, height + .75, colors["deck"])
            for row in range(reference["rowsPerDeck"]):
                near, far = .2 + row * .32 / 3, .2 + (row + 1) * .32 / 3
                top, below = height + (row + 1) * .25, height + row * .25
                panel(0, 1, near, far, top, colors["deck"])
                builder.add_quad([point(0, near, below), point(1, near, below),
                                  point(1, near, top), point(0, near, top)], color=colors["deck"])
                count = int(length / reference["seatPitchMeters"])
                for index in range(count):
                    t = (index + .5) / count
                    if min(t * sections % 1, 1 - t * sections % 1) < .055:
                        continue
                    half = .30 / length
                    panel(t - half, t + half, near + .025, near + .06, top + .16, colors["seats"])
                    builder.add_quad([point(t - half, near + .06, top + .16), point(t + half, near + .06, top + .16),
                                      point(t + half, near + .06, top + .58), point(t - half, near + .06, top + .58)], color=colors["seats"])
                    seats += 1
            # Thin event fascia below each balcony, with the source red trim.
            builder.add_quad([point(0, 0, height - 1.1), point(1, 0, height - 1.1),
                              point(1, 0, height - .1), point(0, 0, height - .1)], color=colors["banner"])
            for i in range(sections):
                a, b = (i + .20) / sections, (i + .65) / sections
                builder.add_quad([point(a, -.001, height - .8), point(b, -.001, height - .8),
                                  point(b + .01, -.001, height - .6), point(a + .01, -.001, height - .6)], color=colors["accent"])
            for rail in (.35, .75, 1.1):
                beam(builder, point(0, 0, height + rail), point(1, 0, height + rail), .035, colors["steel"])
        # White shallow folded fabric roof, with an opening at the central
        # service tower visible in the official stadium photographs.
        roof = reference["roofHeightMeters"]
        for a, b in ((0, .47), (.53, 1)):
            for near, far, first_height, last_height in ((0, .5, roof, roof + .3), (.5, 1, roof + .3, roof)):
                builder.add_quad([point(a, near, first_height), point(b, near, first_height),
                                  point(b, far, last_height), point(a, far, last_height)], color=colors["canopy"])
        for i in range(sections + 1):
            t = i / sections
            for depth in (0, 1):
                beam(builder, point(t, depth, .1), point(t, depth, roof), .09, colors["steel"])
            beam(builder, point(t, 0, roof), point(t, 1, roof + .3), .07, colors["steel"])
            for height in reference["deckHeightsMeters"]:
                beam(builder, point(t, 0, height), point(t, 1, height), .09, colors["steel"])
                beam(builder, point(t, 0, height), point(t, 0, height + 1.1), .035, colors["steel"])
            if i < sections:
                beam(builder, point(t, 1, .2), point((i + 1) / sections, 1, roof), .045, colors["steel"])
        connection = reference["northConnection"]
        a, b = connection["bankEdgeMeters"]
        c, d = connection["hospitalityEdgeMeters"]
        self.reserved.append([a, c, d, b])
        # Exactly share the main lower-bank concourse edge and the north
        # hospitality deck. A separate floating block would leave a visible slit.
        height = connection["heightMeters"]
        builder.add_quad([(*self.xy(p), floor + height) for p in (a, c, d, b)], color=colors["deck"])
        for first, last in ((a, c), (b, d)):
            beam(builder, (*self.xy(first), floor + height - .25),
                 (*self.xy(last), floor + height - .25), .10, colors["steel"])
            for fraction in (.33, .66):
                p = Vector(first).lerp(Vector(last), fraction)
                beam(builder, (*self.xy(p), self.ground(p)), (*self.xy(p), floor + height - .25), .10, colors["steel"])
            for rail in (.4, 1.1):
                beam(builder, (*self.xy(first), floor + height + rail),
                     (*self.xy(last), floor + height + rail), .04, colors["steel"])
            count = math.ceil(math.dist(first, last) / 3)
            for i in range(count + 1):
                p = Vector(first).lerp(Vector(last), i / count)
                beam(builder, (*self.xy(p), floor + height), (*self.xy(p), floor + height + 1.1), .035, colors["steel"])
        obj = builder.create_object("Mexico_Stadium_East_Hospitality", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        uv_surface(obj, scale=2)
        return {**reference, "individualSeats": seats, "sections": sections,
                "floorElevationMeters": floor, "northConnectionHeightGapMeters": 0}

    def verified_surfaces(self):
        builder = base.MeshBuilder()
        count = 0
        bounds = self.raster.bounds
        step_x = (bounds["maxX"] - bounds["minX"]) / (base.TERRAIN_COLUMNS - 1)
        step_y = (bounds["maxY"] - bounds["minY"]) / (base.TERRAIN_ROWS - 1)
        origin = self.xy((bounds["minX"], bounds["minY"]))
        features = self.config.get("surfacePolygons", [])
        for feature in features:
            ring = feature["world"]
            if ring[0] == ring[-1]:
                ring = ring[:-1]
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p), 0)) for p in ring]]):
                footprint = [(p.x, p.y) for p in triangle]
                first_col = max(0, math.floor((min(p[0] for p in footprint) - origin[0]) / step_x))
                last_col = min(base.TERRAIN_COLUMNS - 2, math.floor((max(p[0] for p in footprint) - origin[0]) / step_x))
                first_row = max(0, math.floor((min(p[1] for p in footprint) - origin[1]) / step_y))
                last_row = min(base.TERRAIN_ROWS - 2, math.floor((max(p[1] for p in footprint) - origin[1]) / step_y))
                # Preserve the mapped perimeter while following each rendered
                # terrain triangle. A plane through perimeter heights alone
                # allows interior terrain to pierce a large playing field.
                for row in range(first_row, last_row + 1):
                    for col in range(first_col, last_col + 1):
                        x, y = origin[0] + col * step_x, origin[1] + row * step_y
                        a, b, c, d = (x, y), (x + step_x, y), (x + step_x, y + step_y), (x, y + step_y)
                        for terrain_triangle in ((a, b, c), (a, c, d)):
                            clipped = clip_to_triangle(footprint, list(terrain_triangle))
                            for i in range(1, len(clipped) - 1):
                                points = [(px, py, self.raster.sample_rendered_terrain(
                                    px + self.center["x"], py + self.center["y"]) + feature.get("offsetMeters", .12)
                                    + (self.config["stadiumGrading"]["paintLiftMeters"] if str(feature["id"]).startswith("stadium-") else 0))
                                    for px, py in (clipped[0], clipped[i], clipped[i + 1])]
                                if (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0])).z < 0:
                                    points.reverse()
                                builder.add_triangle(points, color=tuple(feature["color"]) + (1,))
                                count += 1
        if count:
            builder.create_object("Mexico_Verified_Event_Surfaces", [self.m["vertex"]], self.c["Circuit"], vertex_colors=True)
        return {"polygons": len(self.config.get("surfacePolygons", [])), "triangles": count,
                "terrainSupport": "mapped polygons clipped to rendered terrain triangles; stadium paint uses the level platform with 0.32/0.35 m offsets, other surfaces 0.12 m"}

    def stadium_markings(self):
        """Own lettering meshes; no copyrighted event photos used as textures."""
        builder = base.MeshBuilder()
        roof_mesh = bpy.data.objects["Mexico_Stadium_Canopy"].data
        roof_triangles = []
        for face in roof_mesh.polygons:
            points = [roof_mesh.vertices[i].co for i in face.vertices]
            if (points[1] - points[0]).cross(points[2] - points[0]).z > 0:
                roof_triangles.append(points)
        def lettering(text, origin, width, angle, color, on_roof=False):
            data = bpy.data.curves.new("Mexico_Temporary_Lettering", type="FONT")
            data.body, data.resolution_u = text, 3
            obj = bpy.data.objects.new("Mexico_Temporary_Lettering", data)
            self.c["Infrastructure"].objects.link(obj)
            bpy.context.view_layer.update()
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            low = min(v.co.x for v in mesh.vertices)
            scale = width / max(max(v.co.x for v in mesh.vertices) - low, .01)
            axis = Vector((math.cos(angle), math.sin(angle)))
            normal = Vector((-axis.y, axis.x))
            origin = Vector(origin)
            for triangle in mesh.loop_triangles:
                world = [origin + axis * ((mesh.vertices[i].co.x - low) * scale) + normal * (mesh.vertices[i].co.y * scale) for i in triangle.vertices]
                local = [self.xy(p) for p in world]
                if not on_roof:
                    if any(base.distance_to_polyline(p, self.line) < self.width / 2 + .5 for p in world):
                        continue
                    points = [(*p, self.raster.sample_rendered_terrain(p[0] + self.center["x"], p[1] + self.center["y"]) + .40) for p in local]
                    if (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0])).z < 0:
                        points.reverse()
                    builder.add_triangle(points, color=tuple(color) + (1,))
                    continue
                # Clip the lettering to every actual membrane face, so broad
                # glyphs follow its scallops without floating or disappearing.
                x0, x1 = min(p[0] for p in local), max(p[0] for p in local)
                y0, y1 = min(p[1] for p in local), max(p[1] for p in local)
                for face in roof_triangles:
                    if max(p.x for p in face) < x0 or min(p.x for p in face) > x1 or max(p.y for p in face) < y0 or min(p.y for p in face) > y1:
                        continue
                    clipped = clip_to_triangle(local, [(p.x, p.y) for p in face])
                    a, b, c = face
                    cross = (b - a).cross(c - a)
                    for i in range(1, len(clipped) - 1):
                        points = [(x, y, a.z - (cross.x * (x - a.x) + cross.y * (y - a.y)) / cross.z + .04)
                                  for x, y in (clipped[0], clipped[i], clipped[i + 1])]
                        if (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0])).z < 0:
                            points.reverse()
                        builder.add_triangle(points, color=tuple(color) + (1,))
            evaluated.to_mesh_clear()
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.curves.remove(data)
        for marking in self.config["stadiumReference"]["paintedMarkings"]:
            lettering(marking["text"], marking["originMeters"], marking["widthMeters"], marking["rotationRadians"], marking["color"])
        for origin, angle in (([489916, 2145740], .006), ([489904, 2145583], -.25)):
            lettering("Vivir es increíble", origin, 88, angle, (.94, .93, .86), on_roof=True)
        center = Vector((489963, 2145709))
        ring = [center + Vector((math.cos(math.pi / 2 + i * math.pi / 5), math.sin(math.pi / 2 + i * math.pi / 5))) * (4 if i % 2 == 0 else 1.65) for i in range(10)]
        for triangle in base.resolved_tessellation([[Vector((*self.xy(p), 0)) for p in ring]]):
            builder.add_triangle([(p.x, p.y, self.raster.sample_rendered_terrain(p.x + self.center["x"], p.y + self.center["y"]) + .40) for p in triangle], color=(.78, .04, .07, 1))
        builder.create_object("Mexico_Stadium_Painted_Markings", [self.m["vertex"]], self.c["Circuit"], vertex_colors=True)
        return {"triangles": len(builder.faces), "method": "own lettering and star meshes draped onto the terrain/membrane faces; glyphs use Blender Bfont",
                "accuracy": self.config["stadiumReference"]["markingAccuracy"]}

    def baseball_stadium_roof(self):
        source = self.config["baseballStadiumRoof"]
        feature = next(f for f in self.features if f["id"] == source["osmWayId"])
        polygon = feature["world"][:-1]
        builder = base.MeshBuilder()
        # The mapped trident has a long entrance stem and stepped lateral bays.
        # Architect sections show a shallow rising profile with transverse folds;
        # their exact construction heights are unavailable, so only the reported
        # 35 m overall height and the actual footprint are source constrained.
        rear = Vector(self.xy(polygon[9]))
        crown = Vector(self.xy(polygon[18]))
        axis = (crown - rear).normalized()
        normal = Vector((-axis.y, axis.x))
        local = [(Vector(self.xy(p)) - rear) for p in polygon]
        ring = [(p.dot(axis), p.dot(normal)) for p in local]
        along, across = zip(*ring)
        triangles = [[(v.x, v.y) for v in triangle] for triangle in
                     base.resolved_tessellation([[Vector((u, v, 0)) for u, v in ring]])]
        datum = min(self.ground(p) for p in polygon)
        overall = source["overallHeightMeters"]
        color = tuple(feature["roofColor"]) + (1,)
        def roof_point(u, v):
            p = rear + axis * u + normal * v
            rise = min(1, max(0, u / (crown - rear).length))
            fold = abs((v + 10) % 20 - 10) / 10
            return p.x, p.y, datum + overall - 7 * (1 - rise) - 2 * fold
        panels = 0
        for band in range(math.floor(min(across) / 10), math.ceil(max(across) / 10)):
            panel = [(min(along), band * 10), (max(along), band * 10),
                     (max(along), (band + 1) * 10), (min(along), (band + 1) * 10)]
            for triangle in triangles:
                clipped = clip_to_triangle(panel, triangle)
                for i in range(1, len(clipped) - 1):
                    roof = [roof_point(*p) for p in (clipped[0], clipped[i], clipped[i + 1])]
                    if (Vector(roof[1]) - Vector(roof[0])).cross(Vector(roof[2]) - Vector(roof[0])).z < 0:
                        roof.reverse()
                    builder.add_triangle(roof, color=color)
                    builder.add_triangle(list(reversed([(x, y, z - .15) for x, y, z in roof])), color=color)
                    panels += 1
        builder.create_object("Mexico_Baseball_Stadium_Roof", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        # Supports follow the rear edges of the mapped wing, within its footprint.
        supports = base.MeshBuilder()
        count = 0
        for across_position in range(math.ceil(min(across) / 20) * 20, math.floor(max(across) / 20) * 20 + 1, 20):
            for low, high in polygon_scanline_spans([(v, u) for u, v in ring], across_position):
                u = low + min(6, (high - low) / 3)
                x, y, top = roof_point(u, across_position)
                world = (x + self.center["x"], y + self.center["y"])
                ground = self.ground(world)
                fork = (x, y, ground + (top - ground) * .7)
                beam(supports, (x, y, ground), fork, .35)
                for side in (-1, 1):
                    beam(supports, fork, roof_point(u + 3, across_position + side * 3), .22)
                count += 1
        supports.create_object("Mexico_Baseball_Stadium_Roof_Supports", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        return {**source, "panels": panels, "supportFrames": count, "groundDatumMeters": datum,
                "footprint": polygon, "material": "white PTFE membrane with own neutral texture; no historical aerial pixels",
                "foldProfileApproximate": True, "heightRangeAboveDatumMeters": [overall - 9, overall]}

    def buildings(self):
        walls, roofs = base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], []
        for feature in self.features:
            tags, polygon = feature["tags"], feature["world"]
            if not tags.get("building") or tags["building"] in ("grandstand", "stadium", "roof") or len(polygon) < 4:
                continue
            if base.polygon_intersects_corridors(polygon, self.corridors) or any(base.polygons_overlap(polygon, p) for p in self.reserved):
                excluded.append({"id": feature["id"], "reason": "driving corridor or reserved grandstand"})
                continue
            ground = min(self.ground(p) for p in polygon)
            try:
                height = float(tags.get("height", "").replace(" m", ""))
            except ValueError:
                height = float(tags.get("building:levels", 2)) * 3.2
            height = min(40, max(2.5, height))
            color = tuple(feature.get("roofColor", [.58, .59, .58]))
            facade = tuple(feature.get("facadeColor", [min(.83, c * .8 + .12) for c in color])) + (1,)
            ring = polygon[:-1] if polygon[0] == polygon[-1] else polygon
            # Walls and roofs retain independent textures. No invented roof type.
            for a, b in zip(ring, ring[1:] + ring[:1]):
                walls.add_quad([(*self.xy(p), z) for p, z in ((a, ground), (b, ground), (b, ground + height), (a, ground + height))], color=facade)
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p), ground + height)) for p in ring]]):
                triangle = [tuple(p) for p in triangle]
                if (Vector(triangle[1]) - Vector(triangle[0])).cross(Vector(triangle[2]) - Vector(triangle[0])).z < 0:
                    triangle.reverse()
                roofs.add_triangle(triangle)
            rendered.append({"osmWayId": feature["id"], "heightMeters": height, "heightMethod": "OSM height/levels, 2 storey fallback",
                             "roofColor": list(color), "facadeColorEstimate": list(facade[:3])})
        walls.create_object("Mexico_Buildings", [self.m["facade"]], self.c["Infrastructure"], vertex_colors=True)
        roof_obj = roofs.create_object("Mexico_Source_Roofs", [self.m["terrain"]], self.c["Infrastructure"])
        aerial_uv(roof_obj, self.center, self.config["model"]["bounds"])
        return {"count": len(rendered), "rendered": rendered, "excluded": excluded,
                "facadeMethod": "sampled roof palette; neutral estimated facade textures, no facade photogrammetry"}

    def infrastructure(self):
        builder = base.MeshBuilder()
        count = 0
        for f in self.features:
            if f["tags"].get("barrier") not in ("wall", "fence", "guard_rail", "retaining_wall"):
                continue
            height = 2.5 if f["tags"]["barrier"] == "fence" else .8
            for a, b in zip(f["world"], f["world"][1:]):
                if any(base.distance_to_polyline(p, self.line) < self.width / 2 + .3 or base.distance_to_polyline(p, self.pit) < 4.3 for p in (a, b)):
                    continue
                axis = (Vector(b) - Vector(a)).normalized()
                normal = Vector((-axis.y, axis.x)) * .08
                ring = [Vector(a) - normal, Vector(b) - normal, Vector(b) + normal, Vector(a) + normal]
                bottom = [(*self.xy(p), self.ground(p)) for p in ring]
                builder.add_volume(bottom, [(x, y, z + height) for x, y, z in bottom], color=(.49, .51, .49, 1))
                count += 1
        builder.create_object("Mexico_Infrastructure", [self.m["vertex"]], self.c["Infrastructure"], vertex_colors=True)
        return {"mappedBarrierSegments": count}

    def annotations(self):
        collection, controls = self.c["Annotations"], self.config["officialControlPoints"]
        for t in self.turns:
            base.anchor_at(f"Turn_{t['number']:02d}", t["distanceMeters"], self.line, self.cum, self.total,
                self.raster, self.center, 0, collection, side=t.get("anchorSide", 1), offset=17, height=6)
        race_start = self.config["model"]["raceStartDistanceMeters"]
        for name, distance in (("SpeedTrap", controls["speedTrapDistanceMeters"]), ("RaceStart", race_start)):
            base.anchor_at(name, distance, self.line, self.cum, self.total, self.raster, self.center, 0,
                collection, side=-1, offset=22, height=6)
        marks = base.MeshBuilder()
        half = self.width / 2
        for i, d in enumerate((0, *controls["sectorBoundaryDistancesMeters"])):
            base.anchor_at("StartFinish" if i == 0 else f"SectorBoundary_{i + 1:02d}", d, self.line, self.cum,
                self.total, self.raster, self.center, 0, collection, offset=25, height=7)
            self.strip(marks, d - 3, d + 3, -half - .5, half + .5, i + 3, lift=.64)
            if i:
                self.strip(marks, d - .55, d + .55, -half, half, i, lift=.68)
        for i in range(int(self.width)):
            for j in (0, 1):
                self.strip(marks, -.7 + j * .7, j * .7, -half + i, -half + i + 1, 6 + (i + j) % 2, lift=.71)
        marks.create_object("Mexico_Sector_Boundaries_And_Finish", self.m["sectors"] + self.m["halos"] +
                            [self.m["white"], self.m["black"]], collection)
        gantry = base.create_start_gantry(race_start, self.line, self.cum, self.raster, self.center, 0,
                                          [self.m["steel"], self.m["red"]], collection)
        gantry.name, gantry.data.name = "Mexico_Start_Gantry", "Mexico_Start_Gantry_Mesh"
        samples = [(self.surface(self.total * i / 600)[2] - .45, self.total * i / 600) for i in range(600)]
        low, high = min(samples), max(samples)
        for name, sample in (("LowPoint", low), ("HighPoint", high)):
            elevation, distance = sample
            obj = bpy.data.objects.new(name, None)
            x, y = base.sample_polyline(self.line, self.cum, distance)
            obj.location = (*self.xy((x, y)), elevation + 7)
            obj["distance_m"], obj["elevation_datum_m"] = distance, elevation
            collection.objects.link(obj)
        return low, high


def export(path):
    # Preserve centimetre clearance in metre coordinates after meshopt filtering.
    from io_scene_gltf2.io.exp import meshopt
    original = meshopt.MeshoptEncoder.encode_attribute
    def precise(name, data, stride, settings):
        bits = meshopt.EXP_FILTER_BITS
        mode = meshopt.ENCODE_EXP_SHARED_VECTOR
        try:
            if name == "POSITION":
                meshopt.EXP_FILTER_BITS = 18
            elif name == "NORMAL":
                meshopt.EXP_FILTER_BITS = 9
            elif name.startswith("COLOR_"):
                meshopt.EXP_FILTER_BITS = 8
                return original("POSITION", data, stride, settings)
            elif name.startswith("TEXCOORD_"):
                meshopt.EXP_FILTER_BITS = 16
                # UV axes have different ranges (local XY vs world altitude).
                # Independent exponents retain texture precision and compress
                # repeated seat surfaces without removing their geometry.
                meshopt.ENCODE_EXP_SHARED_VECTOR = meshopt.ENCODE_EXP_SHARED_COMPONENT
                return original("POSITION", data, stride, settings)
            return original(name, data, stride, settings)
        finally:
            meshopt.EXP_FILTER_BITS = bits
            meshopt.ENCODE_EXP_SHARED_VECTOR = mode
    meshopt.MeshoptEncoder.encode_attribute = staticmethod(precise)
    try:
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_apply=True,
            export_yup=True, export_cameras=False, export_lights=False, export_animations=False,
            export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
            export_all_vertex_colors=False,
            export_meshopt_compression_enable=True, export_meshopt_extension="EXT_meshopt_compression",
            export_copyright=COPYRIGHT)
    finally:
        meshopt.MeshoptEncoder.encode_attribute = staticmethod(original)


def main():
    args = base.parse_args()
    config = json.loads(Path(args.input).read_text())
    reference_path = SCRIPTS.parent.parent / "docs" / "track-model-mexico-stadium-reference.json"
    config["stadiumReference"] = json.loads(reference_path.read_text())
    config["surfacePolygons"] = [f for f in config.get("surfacePolygons", []) if not str(f["id"]).startswith("stadium-")]
    config["surfacePolygons"].extend(config["stadiumReference"]["eventSurfaces"])
    prepared = Path(args.prepared)
    meta = json.loads((prepared / "raster-metadata.json").read_text())
    raster = base.HeightRaster(prepared / "mexico-dtm.f32le", meta["rasters"]["dtm"], config["model"]["bounds"])
    raster.profiles = json.loads((prepared / "mexico-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1
    scene.unit_settings.length_unit = "METERS"
    scene["coordinate_reference_system"] = "EPSG:32614"
    scene["real_world_scale"] = "1 unit = 1 metre; no vertical exaggeration"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("Mexico_World")
    scene.world.color = (.15, .15, .15)
    collections = base.create_collections()
    grain = surface_texture("Mexico_Physical_Surface_Detail")
    facade = surface_texture("Mexico_Facade_Glazing_Detail", facade=True)
    materials = {"terrain": base.create_aerial_material(prepared / "mexico-orthophoto.jpg")}
    materials["terrain"].name = "Mexico_Planet_SkySat_2018_Source_Color"
    for key, color in {"asphalt": (.28, .29, .29, 1), "white": (.93, .92, .88, 1),
                       "black": (.045, .05, .05, 1), "red": (.69, .04, .035, 1),
                       "concrete": (.61, .60, .57, 1), "steel": (.43, .46, .46, 1)}.items():
        materials[key] = textured_material(f"Mexico_{key.title()}", color, grain)
    materials["vertex"] = textured_material("Mexico_Source_Colored_Structures", (1, 1, 1, 1), grain, vertex=True)
    materials["facade"] = textured_material("Mexico_Source_Colored_Facades", (1, 1, 1, 1), facade, vertex=True)
    materials["fence"] = fence_material()
    materials["seats"] = seating_material()
    colors = [( .86, .02, .01, 1), (.98, .48, .03, 1), (.02, .60, .78, 1)]
    materials["sectors"] = [base.create_material(f"Mexico_Sector_{i + 1}", c) for i, c in enumerate(colors)]
    materials["halos"] = [base.create_material(f"Mexico_Sector_{i + 1}_Glow", (*c[:3], .3), emission_strength=1.5) for i, c in enumerate(colors)]
    terrain = base.add_terrain(config["model"]["bounds"], config["model"]["center"], raster, 0, materials["terrain"], collections["Terrain"])
    terrain.name, terrain.data.name = "Mexico_Terrain", "Mexico_Terrain_Mesh"
    terrain["source"] = config.get("terrainSource", "Measured DEM; see source manifest")
    model = MexicoScene(config, raster, collections, materials)
    samples, curbs = model.roadway()
    pit = model.pit_lane()
    stands = model.grandstands()
    stadium = model.stadium()
    stands["footprints"].extend(stadium["seatingBanks"])
    stands["footprints"].append({"name": stadium["eastHospitality"]["name"],
        "footprint": stadium["eastHospitality"]["outlineMeters"], "groundAnchored": True,
        "rows": 6, "sections": stadium["eastHospitality"]["sections"],
        "individualSeats": stadium["eastHospitality"]["individualSeats"]})
    stands["sections"] += sum(bank["sections"] for bank in stadium["seatingBanks"])
    stands["sections"] += stadium["eastHospitality"]["sections"]
    surfaces = model.verified_surfaces()
    stadium["paintedMarkings"] = model.stadium_markings()
    baseball_roof = model.baseball_stadium_roof()
    buildings = model.buildings()
    infrastructure = model.infrastructure()
    low, high = model.annotations()
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            # Adjacent mapped walls can share identical faces. Keep the editable
            # scene as clean as the glTF export, preserving UV and color layers.
            obj.data.validate(clean_customdata=False)
            uv_surface(obj, 4 if "Buildings" in obj.name else 2)
    clearance = base.measure_ribbon_terrain_clearance(samples, raster, 0)
    if clearance["terrainBreakthroughSamples"] or pit["surfaceClearance"]["terrainBreakthroughSamples"]:
        raise ValueError(f"Mexico terrain penetrates asphalt: {clearance}; {pit['surfaceClearance']}")
    base.add_lighting(collections["Terrain"])
    bounds = config["model"]["bounds"]
    width, depth = bounds["maxX"] - bounds["minX"], bounds["maxY"] - bounds["minY"]
    camera_data = bpy.data.cameras.new("MexicoPreview")
    camera_data.type, camera_data.ortho_scale, camera_data.clip_end = "ORTHO", max(width, depth * 1.6) * 1.08, 20000
    camera = bpy.data.objects.new("MexicoPreview", camera_data)
    collections["Terrain"].objects.link(camera)
    target_height = (low[0] + high[0]) / 2
    camera.location = (0, -depth * .32, target_height + 4000)
    base.look_at(camera, (0, 0, target_height))
    scene.camera, scene.render.filepath = camera, str(Path(args.preview).resolve())
    bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source == "FILE":
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    export(Path(args.glb).resolve())
    profile = [{"distanceMeters": round(model.total * i / 180, 3),
                "elevationMeters": round(model.surface(model.total * i / 180)[2] - .45, 3)} for i in range(181)]
    metadata = {"schemaVersion": 4, "modelId": "mexico", "generatedWith": f"Blender {bpy.app.version_string}",
        "coordinateReferenceSystem": "EPSG:32614", "verticalDatum": config.get("verticalDatum", "EGM96 orthometric metres"),
        "verticalExaggeration": 1, "realWorldScale": "1 unit = 1 metre; no vertical exaggeration",
        "boundsMeters": {"width": width, "depth": depth}, "originMeters": config["model"]["center"],
        "roadCenterlineMeters": config["model"]["centerline"],
        "lapLength": {"geometryMeters": model.total, "officialFiaMeters": 4304, "relativeErrorPercent": abs(model.total - 4304) / 4304 * 100},
        "finishDistanceMeters": 0, "raceStartDistanceMeters": config["model"]["raceStartDistanceMeters"],
        "sectorBoundaryDistancesMeters": config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        "elevationProfile": profile, "elevationsMeters": {"low": low[0], "high": high[0]}, "baseElevationMeters": 0,
        "objects": {"turnAnchors": 17, "pitGarageBoxes": pit["pitBoxes"], "buildingsTotal": buildings["count"],
                    "grandstandFootprints": len(stands["footprints"]), "grandstandSections": stands["sections"],
                    "raceMotorhomes": 0, "startLightPods": 5, **infrastructure},
        "layoutQuality": {"surfaceClearance": clearance, "pitLane": pit, "grandstands": stands,
                          "buildings": buildings, "curbs": curbs, "terrainSurface": meta.get("terrainSurface", {}),
                          "roadGrading": meta.get("roadGrading", {})},
        "elevationApproximate": True,
        "assetLicense": {"name": "CC BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0/", "notice": COPYRIGHT},
        "textureMethod": "embedded registered satellite terrain/roofs; neutral repeating microtextures tinted with source colors; facade glazing approximate",
        "sourceManifest": config["sourceManifest"], "controlPointReference": config["officialControlPoints"],
        "limitations": config["limitations"], "publicationStatus": "review-required"}
    metadata["layoutQuality"]["verifiedEventSurfaces"] = surfaces
    metadata["layoutQuality"]["stadiumReference"] = stadium
    metadata["layoutQuality"]["stadiumGrading"] = meta["stadiumGrading"]
    metadata["layoutQuality"]["baseballStadiumRoof"] = baseball_roof
    Path(args.metadata).write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"lapLength": metadata["lapLength"], "objects": metadata["objects"], "surfaceClearance": clearance}))


if __name__ == "__main__":
    main()
