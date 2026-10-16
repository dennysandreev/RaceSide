#!/usr/bin/env python3
"""Build a textured Yas Marina reconstruction from its own locked metric data."""
from bisect import bisect_right
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("textured_circuit_helpers", SCRIPTS / "build-suzuka-digital-twin.py")
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
base, tools = shared.base, shared.tools
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 141, 193
base.PIT_LANE_WIDTH_METERS = 8
base.TRACK_SURFACE_Z_OFFSET = .45
tools.COPYRIGHT = ("© 2026 RaceSide. Yas Marina model and preview: CC BY-SA 4.0, "
    "https://creativecommons.org/licenses/by-sa/4.0/. Contains modified Copernicus Sentinel data (2026), "
    "acquired 4 October 2026, processed by ESA; native georeferencing, cropped and colour-sampled. "
    "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice. "
    "© OpenStreetMap contributors, ODbL 1.0. GEDTM30: OpenGeoHub / Ho et al. (2025), CC BY 4.0. "
    "Authored water albedo: RaceSide, imagegen; colour reference Planet Labs, Inc., Yas Marina SkySat 12 October 2018, CC BY-SA 4.0, "
    "https://commons.wikimedia.org/wiki/File:Yas_Marina_Circuit,_October_12,_2018_SkySat.jpg. No historical geography embedded. "
    "FIA 2025 and sbp engineering records used as references, not embedded. Site software is separately licensed.")
original_tangent = base.sample_tangent


def tangent(points, cumulative, distance, delta=.5, closed=True):
    return original_tangent(points, cumulative, distance, delta=delta, closed=closed)


base.sample_tangent = tangent


class YasMarinaScene(shared.SuzukaScene):
    def __init__(self, *args):
        super().__init__(*args)
        self.corridors = [(base.sample_line_points(self.line, self.cum, 2), 6.15),
                          (base.sample_line_points(self.pit, self.pc, 2, closed=False), 4.15)]
        self.tunnel = self.config["tunnel"]["distanceRangeMeters"]
        self.stands = [f for f in self.features if f["tags"].get("grandstand") == "yes"
                       and f["id"] != 168411369]
        self.reserved = [f["world"] for f in self.stands]

    def terrain(self):
        super().terrain()
        obj = bpy.data.objects["Suzuka_Terrain"]
        lo, hi = self.tunnel
        portals = [base.sample_polyline(self.pit,self.pc,d,closed=False) for d in (lo,hi)]
        # Carve the exposed ramps in the delivery mesh, rather than only in the
        # sampled DTM. Keep the land and main road above the covered tunnel.
        for vertex in obj.data.vertices:
            world = (vertex.co.x+self.center["x"], vertex.co.y+self.center["y"])
            if min(math.dist(world,p) for p in portals) > 145:
                continue
            d = shared.nearest_distance(self.pit, self.pc, world)
            p = base.sample_polyline(self.pit, self.pc, d, closed=False)
            if math.dist(world,p) < 20 and (lo-115 < d < lo-2 or hi+2 < d < hi+115):
                vertex.co.z = min(vertex.co.z, self.surface(d, pit=True)[2]-.9)
        obj.data.update()
        bvh = BVHTree.FromPolygons([v.co for v in obj.data.vertices], [tuple(p.vertices) for p in obj.data.polygons])
        def height(x,y):
            hit,*_ = bvh.ray_cast(Vector((x-self.center["x"],y-self.center["y"],1000)),Vector((0,0,-1)))
            return hit.z if hit is not None else self.raster.sample(x,y)
        self.raster.sample_rendered_terrain = height

    def runoffs(self):
        source = json.loads((SCRIPTS.parents[1] / ".track-model-build/yas-marina-source/painted-runoffs.json").read_text())
        builder, regions = base.MeshBuilder(), []
        terrain = bpy.data.objects["Suzuka_Terrain"].data
        terrain.calc_loop_triangles()
        triangles = [tuple(terrain.vertices[i].co.copy() for i in face.vertices) for face in terrain.loop_triangles]

        def bounds(points):
            return (min(p.x for p in points),max(p.x for p in points),
                    min(p.y for p in points),max(p.y for p in points))

        def cross(a,b):
            return a.x*b.y-a.y*b.x

        def clip(points, boundary):
            # Convex clipping interpolates the original terrain heights exactly.
            if cross(boundary[1]-boundary[0],boundary[2]-boundary[0]) < 0:
                boundary = list(reversed(boundary))
            for a,b in zip(boundary,boundary[1:]+boundary[:1]):
                output = []
                for p,q in zip(points,points[1:]+points[:1]):
                    u,v = cross(b-a,p-a),cross(b-a,q-a)
                    if u >= -.000001:
                        output.append(p)
                    if (u >= 0) != (v >= 0):
                        output.append(p.lerp(q,u/(u-v)))
                points = output
                if len(points) < 3:
                    return []
            return points

        indexed = [(t,bounds(t)) for t in triangles]
        for region in source.get("pavedUnderlays",[])+source["regions"]:
            rings = [[Vector((*self.xy(p),0)) for p in ring] for ring in region["rings"]]
            outline = list(base.resolved_tessellation(rings))
            x0,x1,y0,y1 = bounds(rings[0])
            nearby = [t for t,(a,b,c,d) in indexed if b >= x0 and a <= x1 and d >= y0 and c <= y1]
            first = len(builder.faces)
            for apron in outline:
                a,b,c,d = bounds(apron)
                for floor in nearby:
                    e,f,g,h = bounds(floor)
                    if f < a or e > b or h < c or g > d:
                        continue
                    patch = clip(list(floor),list(apron))
                    if len(patch) < 3:
                        continue
                    pieces = [(patch,region.get("color",source["paintSrgb"]))]
                    # The outer T9 bowl has darker painted checker squares.
                    # Small clipped cells preserve the source apron boundary.
                    if region["style"] == "checker" and max(p.x for p in patch)+self.center["x"] > 257630:
                        pieces = []
                        size = source["checkerSizeMeters"]
                        px0,px1,py0,py1 = bounds(patch)
                        for ix in range(math.floor(px0/size),math.floor(px1/size)+1):
                            for iy in range(math.floor(py0/size),math.floor(py1/size)+1):
                                x,y = ix*size,iy*size
                                cell = clip(patch,[Vector((x,y,0)),Vector((x+size,y,0)),Vector((x+size,y+size,0)),Vector((x,y+size,0))])
                                color = source["checkerSrgb"] if (ix+iy)%2 else source["paintSrgb"]
                                pieces.append((cell,color))
                    for piece,color in pieces:
                        for i in range(1,len(piece)-1):
                            face = [piece[0],piece[i],piece[i+1]]
                            if abs(cross(face[1]-face[0],face[2]-face[0])) > .00001:
                                lift = region.get("terrainOffsetMeters",.10)
                                builder.add_triangle([(p.x,p.y,p.z+lift) for p in face],color=color)
            regions.append({"name":region["name"],"panels":len(builder.faces)-first,
                "method":"native reference boundary clipped to the delivered terrain; matte textured painted asphalt"})
        builder.create_object("YasMarina_Current_Turquoise_Runoffs",[self.m["runoff"]],self.c["Circuit"],vertex_colors=True)
        return {"reference":source["reference"],"regions":regions,"terrainOffsetMeters":.10}

    def pit_lane(self):
        _, _, _, samples = base.create_ribbon("YasMarina_Pit_Lane", self.pit, self.raster, self.center, 0, 8,
            self.m["asphalt"], self.c["Circuit"], interval=1, closed=False, taper_meters=30,
            minimum_start_width=4, minimum_end_width=4, z_offset=.45)
        pit_building = next(f for f in self.features if f["id"] == 133907082)
        frontage = sorted(shared.nearest_distance(self.pit, self.pc, p) for p in pit_building["world"])
        first, last = frontage[0]+8, frontage[-1]-8
        for i in range(41):
            d = first+(last-first)*i/40
            self.strip(self.paint, d, d+.16, -3.8, -1.2, pit=True, lift=.62)
        for d in range(math.ceil(first), math.floor(last), 3):
            self.strip(self.paint, d, min(d+2, last), -1.3, -1.45, pit=True, lift=.62)
        wall, wall_quality = base.create_pit_wall(self.pit, self.line, self.raster, self.center, 0,
            [self.m["concrete"], self.m["fence"]], self.c["Circuit"],
            start_ratio=first/self.pt, end_ratio=last/self.pt, wall_height=1.05, fence_height=1.7)
        wall.name, wall.data.name = "YasMarina_Pit_Wall", "YasMarina_Pit_Wall_Mesh"
        for i in range(40):
            d = first+(last-first)*(i+.5)/40
            p = self.surface(d, -9.1, True)
            direction = tangent(self.pit, self.pc, d, closed=False)
            along = Vector((direction.x, direction.y, 0))*(last-first)/40*.45
            # Dark garage openings and pale concrete lintels, without invented team logos.
            for lower, upper, color in [(0, 3.2, (.15, .19, .20, 1)), (3.2, 4.1, (.85, .84, .80, 1))]:
                self.props.add_quad([Vector(p)-along+Vector((0, 0, lower)), Vector(p)+along+Vector((0, 0, lower)),
                    Vector(p)+along+Vector((0, 0, upper)), Vector(p)-along+Vector((0, 0, upper))], color=color)
        lo, hi = (self.tunnel[0]-12, self.tunnel[1]+12)
        shell = base.MeshBuilder()
        for d in range(math.floor(lo), math.ceil(hi), 2):
            end = min(d+2, hi)
            for side in (-1, 1):
                a, b = self.surface(d, side*4.12, True), self.surface(end, side*4.12, True)
                shell.add_quad([a, b, (b[0], b[1], b[2]+4.8), (a[0], a[1], a[2]+4.8)])
            a, b, c, e = [self.surface(dd, offset, True) for dd, offset in ((d,-4.12),(end,-4.12),(end,4.12),(d,4.12))]
            shell.add_quad([(p[0], p[1], p[2]+4.8) for p in (a,b,c,e)])
        shell.create_object("YasMarina_Pit_Exit_Tunnel", [self.m["concrete"]], self.c["Infrastructure"])
        portions = [[s for s in samples if s[0] < lo], [s for s in samples if s[0] > hi]]
        clearances = [base.measure_ribbon_terrain_clearance(part,self.raster,0) for part in portions]
        return {"pitGarageBoxes": 40, "frontageDistancesMeters": [first,last], "wall": wall_quality,
            "entryGapMeters": base.distance_to_polyline(self.pit[0], self.line),
            "exitGapMeters": base.distance_to_polyline(self.pit[-1], self.line),
            "surfaceClearance": {"terrainBreakthroughSamples":sum(c["terrainBreakthroughSamples"] for c in clearances),
                "minimumTrackTerrainClearanceMeters":min(c["minimumTrackTerrainClearanceMeters"] for c in clearances)},
            "undergroundSourceWayId": 176695255, "tunnelHeadroomMeters": 4.8,
            "coveredDistanceRangeMeters": [lo,hi],
            "axis": [{"distanceMeters":d,"x":p[0]-self.center["x"],"z":-(p[1]-self.center["y"])} for d,p in zip(self.pc,self.pit)],
            "tunnelMethod": "OSM tagged underground path; depth/headroom reconstructed from photos"}

    def north_seating_band(self, feature, structure, seats, seat_uvs):
        """Follow both mapped edges of the bowl instead of clipping straight rows."""
        upper = next(f for f in self.stands if f["id"] == 1455866679)
        lower = [f for f in self.stands if 1455866668 <= f["id"] <= 1455866678]
        upper_polygon = upper["world"][:-1]
        lower_vertices = {tuple(p) for f in lower for p in f["world"][:-1]}

        def boundary_paths(polygon, flags):
            starts = [i for i, flag in enumerate(flags) if flag and not flags[i-1]]
            if len(starts) != 1:
                raise ValueError(f"North seating boundary is not one continuous path: {feature['id']}")
            start = starts[0]
            ordered = polygon[start:]+polygon[:start]
            ordered_flags = flags[start:]+flags[:start]
            split = next(i for i, flag in enumerate(ordered_flags) if not flag)
            return ordered[:split], list(reversed(ordered[split:]))

        upper_front, upper_rear = boundary_paths(upper_polygon, [tuple(p) in lower_vertices for p in upper_polygon])
        # OSM has intermediate nodes on the two short end cuts. They are not
        # corners of the rear edge, so retain the full seating width there.
        for first in (True, False):
            while len(upper_rear) > 2:
                end, following = (0,1) if first else (-1,-2)
                if base.distance_to_polyline(upper_rear[end], [upper_front[end],upper_rear[following]]) > .05:
                    break
                upper_rear.pop(end)
        polygon = feature["world"][:-1]
        is_upper = feature["id"] == upper["id"]
        if is_upper:
            front, rear = upper_front, upper_rear
            rows, bottom_height, top_height = 18, 7.6, 17.8
        else:
            rear, front = boundary_paths(polygon, [base.distance_to_polyline(p,upper_front) < .05 for p in polygon])
            rows, bottom_height, top_height = 16, .6, 6.5
        u, v = Vector(front[1])-Vector(front[0]), Vector(rear[0])-Vector(front[0])
        if u.x*v.y-u.y*v.x < 0:
            front, rear = list(reversed(front)), list(reversed(rear))
        front_distances, front_length = base.line_distance(front)
        rear_distances, rear_length = base.line_distance(rear)
        # Include every source corner on both edges. Adjacent cells share the
        # same vertices; interpolation covers the complete curved footprint.
        # Both boundaries are piecewise linear. Their source corners suffice;
        # uniform subdivisions only duplicate coplanar seating/terrace panels.
        stations = sorted({d/front_length for d in front_distances} |
                          {d/rear_length for d in rear_distances})
        stations = [s for i,s in enumerate(stations) if i == 0 or s-stations[i-1] > .000001]
        datum = max(self.ground(p) for p in upper_polygon)
        row_count, seat_count = 0, 0
        for a,b in zip(stations,stations[1:]):
            f0,f1 = [Vector(base.sample_polyline(front,front_distances,s*front_length,closed=False)) for s in (a,b)]
            r0,r1 = [Vector(base.sample_polyline(rear,rear_distances,s*rear_length,closed=False)) for s in (a,b)]
            for row in range(rows):
                u,v = row/rows,(row+1)/rows
                p,q = f0.lerp(r0,u),f1.lerp(r1,u)
                s,t = f0.lerp(r0,v),f1.lerp(r1,v)
                ring = [p,q,t,s]
                if base.polygon_intersects_corridors(ring,self.corridors):
                    raise ValueError(f"North seating crosses the driving corridor: {feature['id']}")
                z = datum+bottom_height+(top_height-bottom_height)*u
                rise = (top_height-bottom_height)/rows
                structure.add_quad([(*self.xy(point),z) for point in ring],color=(.57,.59,.58,1))
                structure.add_quad([(*self.xy(p),z-rise),(*self.xy(q),z-rise),
                                    (*self.xy(q),z),(*self.xy(p),z)],color=(.50,.53,.53,1))
                for is_end,start,finish in ((a == 0 and f0.y < 2709240,p,s),
                                            (b == 1 and f1.y < 2709240,q,t)):
                    if is_end:
                        structure.add_quad([(*self.xy(start),self.ground(start)),(*self.xy(finish),self.ground(finish)),
                                            (*self.xy(finish),z),(*self.xy(start),z)],color=(.69,.71,.70,1))
                # Repeat the existing individual seat texture continuously along
                # the row. Grey terraces remain visible between blue seat shells.
                width0,width1 = (r0-f0).length,(r1-f1).length
                middle = (u+v)/2
                c0,c1 = f0.lerp(r0,middle-.2/width0),f1.lerp(r1,middle-.2/width1)
                c2,c3 = f1.lerp(r1,middle+.2/width1),f0.lerp(r0,middle+.2/width0)
                color = (.10,.47,.61,1) if row % 8 < 6 else (.16,.36,.46,1)
                seats.add_quad([(*self.xy(point),z+.13) for point in (c0,c1,c2,c3)],color=color)
                seats.add_quad([(*self.xy(point),height) for point,height in
                    ((c2,z+.13),(c3,z+.13),(c3,z+.48),(c2,z+.48))],color=color)
                first,last = a*front_length/.6,b*front_length/.6
                seat_uvs += [(first,0),(last,0),(last,1),(first,0),(last,1),(first,1)]*2
                row_count += 1
                seat_count += (q-p).length/.6
            # Close the outer riser down to the ground, with a pale concrete rear.
            height = datum+top_height-(top_height-bottom_height)/rows
            structure.add_quad([(*self.xy(r1),self.ground(r1)),(*self.xy(r0),self.ground(r0)),
                                (*self.xy(r0),height),(*self.xy(r1),height)],color=(.69,.71,.70,1))
        return {"osmWayId":feature["id"],"name":"North Grandstand upper tier" if is_upper else "North Grandstand lower tier",
                "footprint":polygon,"rowsBuilt":row_count,"seatsBuilt":round(seat_count),
                "heightMeters":float(feature["tags"]["height"]),"seatingRows":rows,
                "terraceHeightRangeMeters":[bottom_height,top_height],
                "geometryMethod":"continuous rows interpolated between both mapped bowl boundaries"}

    def grandstands(self):
        structure, seat_rows, roofs = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        seat_uvs, rendered, excluded = [], [], []
        for f in self.stands:
            if 1455866668 <= f["id"] <= 1455866679:
                rendered.append(self.north_seating_band(f,structure,seat_rows,seat_uvs))
                continue
            polygon = f["world"][:-1] if f["world"][0] == f["world"][-1] else f["world"]
            edges = sorted(zip(polygon, polygon[1:]+polygon[:1]), key=lambda pair: math.dist(*pair), reverse=True)
            direction = (Vector(edges[0][1])-Vector(edges[0][0])).normalized()
            normal = Vector((-direction.y, direction.x))
            coords = [(Vector(p).dot(direction), Vector(p).dot(normal)) for p in polygon]
            left, right = min(p[0] for p in coords), max(p[0] for p in coords)
            near, far = min(p[1] for p in coords), max(p[1] for p in coords)
            if base.distance_to_polyline(direction*((left+right)/2)+normal*near, self.line) > base.distance_to_polyline(direction*((left+right)/2)+normal*far, self.line):
                near, far = far, near
            sections = max(1, math.ceil((right-left)/12))
            top_height = float(f["tags"].get("height", 13))
            seat_count, row_count, omitted = 0, 0, 0
            for section in range(sections):
                a, b = left+(right-left)*section/sections+.12, left+(right-left)*(section+1)/sections-.12
                for low, high in tools.polygon_scanline_spans(coords, (a+b)/2):
                    front, rear = (low,high) if near < far else (high,low)
                    rows = max(3, min(32, round(abs(rear-front)/.85)))
                    ground = self.ground(direction*((a+b)/2)+normal*front)
                    for row in range(rows):
                        u, v = front+(rear-front)*row/rows, front+(rear-front)*(row+1)/rows
                        ring = [direction*x+normal*y for x,y in ((a,u),(b,u),(b,v),(a,v))]
                        if not all(base.point_in_polygon(p, polygon) or base.distance_point_polygon(p,polygon)<.1 for p in ring):
                            continue
                        if base.polygon_intersects_corridors(ring, self.corridors):
                            omitted += 1
                            continue
                        z = max(ground+.6+(top_height-.6)*row/rows, max(self.ground(p) for p in ring)+.25)
                        structure.add_quad([(*self.xy(p), z) for p in ring], color=(.57,.59,.58,1))
                        structure.add_quad([(*self.xy(ring[0]),z-.38),(*self.xy(ring[1]),z-.38),
                                            (*self.xy(ring[1]),z),(*self.xy(ring[0]),z)], color=(.50,.53,.53,1))
                        # Permanent blue seats, corroborated by promoter/venue photographs.
                        color = (.10,.47,.61,1) if row % 8 < 6 else (.16,.36,.46,1)
                        p, q = direction*a+normal*((u+v)/2), direction*b+normal*((u+v)/2)
                        corners = [p-normal*.2,q-normal*.2,q+normal*.2,p+normal*.2]
                        seat_rows.add_quad([(*self.xy(p),z+.13) for p in corners], color=color)
                        seat_rows.add_quad([(*self.xy(p),zz) for p,zz in
                            ((corners[2],z+.13),(corners[3],z+.13),(corners[3],z+.48),(corners[2],z+.48))], color=color)
                        count = max(2, round((b-a)/.6))
                        seat_count += count
                        row_count += 1
                        seat_uvs += [(0,0),(count,0),(count,1),(0,0),(count,1),(0,1)]*2
                    for x in (a+.3,b-.3):
                        for y in (front+.1*(rear-front),rear):
                            p = direction*x+normal*y
                            low_z = self.ground(p)
                            high_z = ground+.6+(top_height-.6)*abs((y-front)/(rear-front))
                            if high_z > low_z:
                                structure.add_box((*self.xy(p),(low_z+high_z)/2),(.4,.4,high_z-low_z),color=(.69,.71,.70,1))
                    if f["tags"].get("name"):
                        # Repeated white tensile roof bays follow the actual footprint.
                        corners = [direction*x+normal*y for x,y in ((a,front),(b,front),(b,rear),(a,rear))]
                        if all(base.point_in_polygon(p,polygon) or base.distance_point_polygon(p,polygon)<.2 for p in corners):
                            height = ground+top_height+3
                            ridge = direction*((a+b)/2)+normal*((front+rear)/2)
                            apex = (*self.xy(ridge), height+3.4)
                            for p,q in zip(corners,corners[1:]+corners[:1]):
                                roofs.add_triangle([(*self.xy(p),height),(*self.xy(q),height),apex],color=(.92,.91,.86,1))
                            for p in (corners[0],corners[2]):
                                tools.beam(structure,(*self.xy(p),self.ground(p)),(*self.xy(p),height),.16,(.77,.80,.78,1))
            if omitted:
                excluded.append({"osmWayId":f["id"],"clippedRowSections":omitted,"reason":"current driving corridor clearance"})
            rendered.append({"osmWayId":f["id"],"name":f["tags"].get("name","North Grandstand section"),
                "footprint":polygon,"rowsBuilt":row_count,"seatsBuilt":seat_count,"heightMeters":top_height})
        for f in self.features:
            if f["tags"].get("building:part") != "roof" or f["tags"].get("roof:shape") != "pyramidal":
                continue
            polygon = f["world"][:-1]
            center = [sum(p[k] for p in polygon)/len(polygon) for k in (0,1)]
            upper = next(f for f in self.stands if f["id"] == 1455866679)
            ground = max(self.ground(p) for p in upper["world"][:-1])
            bottom, top = ground+float(f["tags"].get("min_height",20)), ground+float(f["tags"].get("height",27))
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                roofs.add_triangle([(*self.xy(a),bottom),(*self.xy(b),bottom),(*self.xy(center),top)],color=(.92,.91,.87,1))
            for p in polygon[::2]:
                tools.beam(structure,(*self.xy(p),ground),(*self.xy(p),bottom),.18,(.73,.76,.75,1))
        structure.create_object("YasMarina_Grandstand_Structures",[self.m["vertex"]],self.c["Grandstands"],vertex_colors=True)
        seats = seat_rows.create_object("YasMarina_Textured_Blue_Seats",[self.m["seats"]],self.c["Grandstands"],vertex_colors=True)
        uv = seats.data.uv_layers.new(name="SeatShellUV")
        for loop, coordinate in zip(seats.data.loops,seat_uvs):
            uv.data[loop.index].uv = coordinate
        roofs.create_object("YasMarina_White_Membrane_Canopies",[self.m["metal"]],self.c["Grandstands"],vertex_colors=True)
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,
                "seatColorMethod":"blue permanent seats; source/promoter photographic reconstruction",
                "roofMethod":"mapped North pyramidal roof parts; footprint-constrained white membrane bays elsewhere"}

    def buildings(self):
        walls, roofs, membrane = base.MeshBuilder(), base.MeshBuilder(), base.MeshBuilder()
        rendered, excluded = [], []
        hotel_ids = {520940413,521551278,1228229328,1387292013,1387292014,1489661819}
        hotel_polygons = [f["world"] for f in self.features if f["id"] in hotel_ids]
        for f in self.features:
            tags = f["tags"]
            if not tags.get("building") or tags.get("grandstand") == "yes":
                continue
            polygon = f["world"][:-1] if f["world"][0] == f["world"][-1] else f["world"]
            if len(polygon)<3:
                continue
            if base.polygon_intersects_corridors(polygon,self.corridors) or any(base.polygons_overlap(polygon,p) for p in self.reserved+hotel_polygons):
                excluded.append({"osmWayId":f["id"],"reason":"track, pit, stand or independently modelled hotel footprint"})
                continue
            pit = f["id"] == 133907082
            try:
                height = float(tags.get("height",float(tags.get("building:levels",2))*3.1))
            except ValueError:
                height = 6.2
            if pit:
                height = 12
            ground = max(self.ground(p) for p in polygon)
            roof_color = self.source_color(base.polygon_center([polygon]))
            facade = (.81,.81,.76,1) if pit or height<10 else (.58,.61,.61,1)
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                walls.add_quad([(*self.xy(a),self.ground(a)),(*self.xy(b),self.ground(b)),
                    (*self.xy(b),ground+height),(*self.xy(a),ground+height)],color=facade)
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p),ground+height)) for p in polygon]]):
                if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:
                    triangle = list(reversed(triangle))
                roofs.add_triangle(triangle)
            if pit:
                edge = max(zip(polygon,polygon[1:]+polygon[:1]),key=lambda pair:math.dist(*pair))
                direction = (Vector(edge[1])-Vector(edge[0])).normalized()
                normal = Vector((-direction.y,direction.x))
                coords = [(Vector(p).dot(direction),Vector(p).dot(normal)) for p in polygon]
                lo,hi = min(p[0] for p in coords),max(p[0] for p in coords)
                for i in range(40):
                    a,b = lo+(hi-lo)*i/40,lo+(hi-lo)*(i+1)/40
                    for low,high in tools.polygon_scanline_spans(coords,(a+b)/2):
                        ring = [direction*x+normal*y for x,y in ((a,low),(b,low),(b,high),(a,high))]
                        apex = direction*((a+b)/2)+normal*((low+high)/2)
                        for p,q in zip(ring,ring[1:]+ring[:1]):
                            membrane.add_triangle([(*self.xy(p),ground+height+.05),(*self.xy(q),ground+height+.05),
                                (*self.xy(apex),ground+height+2.8)],color=(.93,.92,.87,1))
            rendered.append({"osmWayId":f["id"],"name":tags.get("name","Main pit building" if pit else None),
                "footprint":polygon,"heightMeters":height,"heightMethod":"OSM height/levels, documented 6.2 m fallback; pit photo reconstruction",
                "roofColor":roof_color[:3]})
        walls.create_object("YasMarina_Permanent_Buildings",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        roof = roofs.create_object("YasMarina_Source_Roofs",[self.m["terrain"]],self.c["Infrastructure"])
        tools.aerial_uv(roof,self.center,self.config["model"]["bounds"])
        membrane.create_object("YasMarina_Pit_Roof_Bays",[self.m["metal"]],self.c["Infrastructure"],vertex_colors=True)
        return {"count":len(rendered),"rendered":rendered,"excluded":excluded,
                "remainingDrivingCorridorConflicts":0,"lod2Available":False,"sourceToRenderCentroidDriftMeters":0}

    def hotel(self):
        envelope, frame, walls = base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        wings = []
        for ident in (1228229328,520940413):
            feature = next(f for f in self.features if f["id"] == ident)
            polygon = [Vector(p) for p in feature["world"][:-1]]
            center = sum(polygon,Vector((0,0)))/len(polygon)
            edge = max(zip(polygon,polygon[1:]+polygon[:1]),key=lambda pair:(pair[1]-pair[0]).length)
            direction = (edge[1]-edge[0]).normalized()
            normal = Vector((-direction.y,direction.x))
            half_length = max(abs((p-center).dot(direction)) for p in polygon)
            half_width = max(abs((p-center).dot(normal)) for p in polygon)
            ground = self.ground(center)
            # Two rounded, footprint-bound volumes. The grid shell is reconstructed
            # as an envelope, not a surveyed CAD surface or a solid roof box.
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                walls.add_quad([(*self.xy(a),ground),(*self.xy(b),ground),
                    (*self.xy(b),ground+19),(*self.xy(a),ground+19)],color=(.62,.72,.76,1))
            def shell(u,v):
                # Round the ends as well as the cross-section. A rectangular
                # barrel vault loses the defining flowing hotel silhouette.
                outline = max(0,1-u**4)**.25
                p = center+direction*(u*half_length*1.015)+normal*(v*half_width*1.025*outline)
                z = ground+15+20*math.sqrt(max(0,1-u*u))*math.sqrt(max(0,1-v*v))
                return Vector((*self.xy(p),z))
            for i in range(48):
                u0,u1 = -.999+1.998*i/48,-.999+1.998*(i+1)/48
                for j in range(20):
                    v0,v1 = -1+2*j/20,-1+2*(j+1)/20
                    points = [shell(u,v) for u,v in ((u0,v0),(u1,v0),(u1,v1),(u0,v1))]
                    envelope.add_quad(points,color=(.84,.89,.89,1))
                    tools.beam(frame,points[0],points[2],.095,(.61,.67,.69,1))
                    tools.beam(frame,points[1],points[3],.095,(.61,.67,.69,1))
            wings.append({"osmWayId":ident,"footprint":[list(p) for p in polygon],
                "shellMaximumHeightMeters":35,"planExtentMeters":[half_length*2,half_width*2]})
        bridge = next(f for f in self.features if f["id"] == 1387292013)
        polygon = bridge["world"][:-1]
        ground = max(self.ground(p) for p in polygon)
        base.add_polygon_prism(walls,[polygon],self.center,ground+9,ground+16,
                               roof_color=(.35,.44,.49,1),wall_color=(.35,.44,.49,1))
        walls.create_object("YasMarina_W_Hotel_Wings_And_Link",[self.m["facade"]],self.c["Infrastructure"],vertex_colors=True)
        envelope.create_object("YasMarina_W_Hotel_Glass_Gridshell",[self.m["glass"]],self.c["Infrastructure"],vertex_colors=True)
        frame.create_object("YasMarina_W_Hotel_Diamond_Frame",[self.m["metal"]],self.c["Infrastructure"],vertex_colors=True)
        return {"wings":wings,"bridgeWayId":1387292013,"engineerReference":"sbp: maximum gridshell 217 × 44 × 35 m",
                "method":"OSM footprints and architect/engineer daytime references; envelope and lattice are reconstructed"}

    def infrastructure(self):
        props, fences = base.MeshBuilder(),base.MeshBuilder()
        barriers, piers = 0,0
        for f in self.features:
            kind = f["tags"].get("barrier")
            pier = f["tags"].get("man_made") == "pier"
            if not kind and not pier:
                continue
            for a,b in zip(f["world"],f["world"][1:]):
                delta = Vector(b)-Vector(a)
                if delta.length < .1:
                    continue
                count = max(1,math.ceil(delta.length/6))
                for i in range(count):
                    p,q = Vector(a)+delta*i/count,Vector(a)+delta*(i+1)/count
                    if any(base.distance_to_polyline(point,path)<width+.4 for point in (p,q,(p+q)/2) for path,width in self.corridors):
                        continue
                    za,zb = self.ground(p),self.ground(q)
                    if pier:
                        normal = Vector((-delta.y,delta.x)).normalized()*1.1
                        props.add_quad([(*self.xy(point),max(za,zb)+.8) for point in (p-normal,q-normal,q+normal,p+normal)],color=(.69,.65,.57,1))
                        piers += 1
                    elif kind == "fence":
                        fences.add_quad([(*self.xy(p),za),(*self.xy(q),zb),(*self.xy(q),zb+2.7),(*self.xy(p),za+2.7)])
                        tools.beam(props,(*self.xy(p),za),(*self.xy(p),za+2.7),.07,(.63,.67,.67,1))
                        barriers += 1
                    else:
                        for z in (.4,.8,1.1):
                            tools.beam(props,(*self.xy(p),za+z),(*self.xy(q),zb+z),.10,(.68,.69,.68,1))
                        barriers += 1
        props.create_object("YasMarina_Mapped_Barriers_And_Marina_Piers",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        fences.create_object("YasMarina_Catch_Fences",[self.m["fence"]],self.c["Infrastructure"])
        return {"mappedBarrierPanels":barriers,"marinaPierSegments":piers}

    def vegetation_and_lights(self):
        palms, lamps = base.MeshBuilder(),base.MeshBuilder()
        tree_count, light_count = 0,0
        for index,p in enumerate(self.config["trees"]):
            if any(base.distance_to_polyline(p,path)<half+5 for path,half in self.corridors):
                continue
            if any(base.point_in_polygon(p,poly) for poly in self.reserved):
                continue
            x,y = self.xy(p)
            z,height = self.ground(p),6.5+(index%5)*.5
            palms.add_cylinder((x,y,z),.2,height,sides=5,color=(.44,.36,.24,1))
            for leaf in range(8):
                angle = leaf*math.tau/8+index*.17
                direction = Vector((math.cos(angle),math.sin(angle),0))
                normal = Vector((-direction.y,direction.x,0))*.35
                center = Vector((x,y,z+height))
                mid = center+direction*1.9+Vector((0,0,.6))
                tip = center+direction*3.4-Vector((0,0,.8))
                color = (.26,.37,.18,1) if leaf%2 else (.32,.42,.22,1)
                palms.add_quad([center,mid-normal,tip,mid+normal],color=color)
            tree_count += 1
        for light in self.config["lights"]:
            p = light["world"]
            if any(base.distance_to_polyline(p,path)<half+1 for path,half in self.corridors):
                continue
            x,y = self.xy(p)
            z = self.ground(p)
            lamps.add_cylinder((x,y,z),.16,12,sides=6,color=(.62,.65,.65,1))
            tools.beam(lamps,(x,y,z+11.6),(x+1.8,y,z+12),.1,(.62,.65,.65,1))
            lamps.add_box((x+1.8,y,z+11.9),(.9,.55,.3),color=(.82,.83,.80,1))
            light_count += 1
        palms.create_object("YasMarina_Vegetation",[self.m["vertex"]],self.c["Infrastructure"],vertex_colors=True)
        lamps.create_object("YasMarina_Mapped_Light_Masts",[self.m["metal"]],self.c["Infrastructure"],vertex_colors=True)
        return {"trees":tree_count,"lightMasts":light_count,"method":"OSM individual tree/street-lamp coordinates; palm and luminaire dimensions photo reconstruction"}


def bake_water_ground(prepared):
    """Bake the geographic water blend so glTF needs one ordinary base texture."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.margin = 0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure, scene.view_settings.gamma = 0, 1
    mesh = bpy.data.meshes.new("WaterBakePlane")
    mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)], [], [(0,1,2,3)])
    uv = mesh.uv_layers.new()
    for loop, coordinate in zip(mesh.loops, [(0,0),(1,0),(1,1),(0,1)]):
        uv.data[loop.index].uv = coordinate
    plane = bpy.data.objects.new("WaterBakePlane", mesh)
    scene.collection.objects.link(plane)
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    material = bpy.data.materials.new("WaterBakeMaterial")
    material.use_nodes = True
    plane.data.materials.append(material)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    loaded = []
    def texture(path, color_space):
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = color_space
        loaded.append(image)
        node = nodes.new("ShaderNodeTexImage")
        node.image, node.interpolation, node.extension = image, "Linear", "EXTEND"
        return node
    ground = texture(prepared/"yas-marina-orthophoto.jpg", "sRGB")
    water = texture(prepared.parent/"yas-marina-source/water-albedo.png", "sRGB")
    mask = texture(prepared/"yas-marina-water-mask.png", "Non-Color")
    mix = nodes.new("ShaderNodeMixRGB")
    links.new(mask.outputs["Color"], mix.inputs[0])
    links.new(ground.outputs["Color"], mix.inputs[1])
    links.new(water.outputs["Color"], mix.inputs[2])
    emission, output = nodes.new("ShaderNodeEmission"), nodes.new("ShaderNodeOutputMaterial")
    links.new(mix.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs[0], output.inputs["Surface"])
    baked = bpy.data.images.new("YasMarina_Current_Ground_With_Teal_Water", width=2048, height=2801, alpha=False)
    target = nodes.new("ShaderNodeTexImage")
    target.image = baked
    nodes.active = target
    bpy.ops.object.bake(type="EMIT")
    path = prepared/"yas-marina-water-ground.jpg"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 88
    baked.save_render(str(path), scene=scene)
    bpy.data.objects.remove(plane, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(material)
    for image in [*loaded, baked]:
        bpy.data.images.remove(image)
    print("Baked geographic teal water without changing current land/road coordinates", flush=True)
    return path


def main():
    args = base.parse_args()
    config = json.loads(Path(args.input).read_text())
    prepared = Path(args.prepared)
    raster_meta = json.loads((prepared/"raster-metadata.json").read_text())
    raster = base.HeightRaster(prepared/"yas-marina-dtm.f32le",raster_meta["rasters"]["dtm"],config["model"]["bounds"])
    raster.profiles = json.loads((prepared/"yas-marina-road-profiles.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collections = base.create_collections()
    scene = bpy.context.scene
    scene.unit_settings.system,scene.unit_settings.scale_length = "METRIC",1
    scene["coordinate_reference_system"] = "EPSG:32640"
    scene["real_world_scale"] = "1 unit = 1 metre; no vertical exaggeration"
    grain,facade,metal = shared.texture("YasMarina_Mineral_Surface"),shared.texture("YasMarina_Facade_Detail","facade"),shared.texture("YasMarina_Membrane_Seams","metal")
    ground_path = bake_water_ground(prepared)
    materials = {"terrain":base.create_aerial_material(ground_path),
        "asphalt":tools.textured_material("YasMarina_Asphalt",(.25,.27,.28,1),grain),
        "runoff":tools.textured_material("YasMarina_Turquoise_Runoff",(1,1,1,1),grain,vertex=True),
        "white":tools.textured_material("YasMarina_White_Paint",(.94,.94,.90,1),grain),
        "red":tools.textured_material("YasMarina_Red_Kerbs",(.77,.045,.04,1),grain),
        "black":tools.textured_material("YasMarina_Checker_Black",(.045,.055,.055,1),grain),
        "concrete":tools.textured_material("YasMarina_Pit_Concrete",(.65,.66,.63,1),grain),
        "vertex":tools.textured_material("YasMarina_Source_Colored_Objects",(1,1,1,1),grain,vertex=True),
        "facade":tools.textured_material("YasMarina_Textured_Facades",(1,1,1,1),facade,vertex=True),
        "metal":tools.textured_material("YasMarina_White_Membrane_And_Steel",(1,1,1,1),metal,vertex=True),
        "glass":tools.textured_material("YasMarina_Textured_Gridshell_Glass",(1,1,1,1),metal,vertex=True,roughness=.35),
        "fence":shared.fence_material(),"seats":tools.seating_material(),"sectors":[],"halos":[]}
    materials["terrain"].name = "YasMarina_Copernicus_2026_Georeferenced_Ground"
    materials["fence"].name = "YasMarina_Chain_Link_Fence"
    materials["seats"].name = "YasMarina_Blue_Seat_Shells"
    for i,color in enumerate([(.80,.02,.015,1),(.97,.43,.02,1),(.02,.56,.72,1)]):
        materials["sectors"].append(base.create_material(f"YasMarina_Sector_{i+1}",tools.linear(color),.8))
        materials["halos"].append(base.create_material(f"YasMarina_Sector_{i+1}_Glow",(*tools.linear(color)[:3],.30),.5,emission_strength=1.3))
    aerial = next(n.image for n in materials["terrain"].node_tree.nodes if n.type == "TEX_IMAGE")
    model = YasMarinaScene(config,raster,collections,materials,aerial)
    model.terrain()
    samples,curbs = model.road()
    bpy.data.objects["Suzuka_Raceway"]["source"] = "Current Yas Marina OSM axis; FIA 2025 5281 m / 16-turn layout; GEDTM30 profile"
    runoffs = model.runoffs()
    pit = model.pit_lane()
    clearance = base.measure_ribbon_terrain_clearance(samples,raster,0)
    print("Yas Marina road and tunnel built",flush=True)
    stands,buildings,hotel = model.grandstands(),model.buildings(),model.hotel()
    infrastructure = model.infrastructure()
    vegetation = model.vegetation_and_lights()
    profile,low,high = model.annotations()
    for obj in bpy.data.objects:
        obj.name = obj.name.replace("Suzuka_","YasMarina_")
        if obj.type == "MESH":
            obj.data.name = obj.name+"_Mesh"
            tools.uv_surface(obj,2)
    for image in bpy.data.images:
        image.name = image.name.replace("Suzuka_","YasMarina_").replace("Mexico_","YasMarina_")
    print("Yas Marina textured structures built",flush=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x,scene.render.resolution_y = 1500,1600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format,scene.render.image_settings.color_mode = "WEBP","RGBA"
    scene.render.image_settings.quality = 93
    scene.view_settings.view_transform,scene.view_settings.look = "Standard","None"
    scene.world = bpy.data.worlds.new("YasMarina_World")
    scene.world.color = (.12,.13,.14)
    base.add_lighting(collections["Terrain"])
    camera_data = bpy.data.cameras.new("YasMarinaPreview")
    camera_data.type,camera_data.ortho_scale,camera_data.clip_end = "ORTHO",2200,10000
    camera = bpy.data.objects.new("YasMarinaPreview",camera_data)
    collections["Terrain"].objects.link(camera)
    camera.location = (0,-650,2800)
    base.look_at(camera,(0,0,8))
    scene.camera,scene.render.filepath = camera,str(Path(args.preview).resolve())
    bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source == "FILE":
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix(".blend").resolve()))
    bpy.data.objects.remove(camera,do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    tools.export(Path(args.glb).resolve())
    metadata = {"schemaVersion":4,"modelId":"yas-marina","generatedWith":f"Blender {bpy.app.version_string}",
        "coordinateReferenceSystem":"EPSG:32640","verticalDatum":"EGM2008 orthometric metres",
        "verticalExaggeration":1,"realWorldScale":"1 unit = 1 metre; no vertical exaggeration",
        "originMeters":config["model"]["center"],"boundsMeters":{"width":1400,"depth":1915},
        "lapLength":{"geometryMeters":model.total,"officialFiaMeters":5281,"relativeErrorPercent":abs(model.total-5281)/5281*100},
        "elevationProfile":profile,"elevationsMeters":{"low":low["elevationMeters"],"high":high["elevationMeters"]},
        "finishDistanceMeters":0,"raceStartDistanceMeters":130,"baseElevationMeters":0,
        "sectorBoundaryDistancesMeters":config["officialControlPoints"]["sectorBoundaryDistancesMeters"],
        "objects":{"turnAnchors":16,"pitGarageBoxes":40,"buildingsTotal":buildings["count"],
            "grandstandFootprints":stands["count"],"raceMotorhomes":0,"hotelWings":2,**infrastructure,**vegetation},
        "layoutQuality":{"surfaceClearance":clearance,"pitLane":pit,"grandstands":stands,
            "buildings":buildings,"hotel":hotel,"curbs":curbs,"currentRunoffs":runoffs,"terrainSurface":raster_meta["terrainSurface"],
            "roadGrading":raster_meta["roadGrading"],"sourceRasterAudit":json.loads((prepared/"raster-registration-audit.json").read_text())},
        "materials":{"physicalObjectsTextured":True,"colorSpace":"source sRGB converted once to linear vertex colors",
            "waterMethod":"authored teal albedo and ripples, current OSM coast/pier mask, 1.4 m feather; Blender emission bake; historical colour reference only",
            "facadeMethod":"photo-based colors with authored surface/window detail; no facade photogrammetry",
            "roofMethod":"mapped roof parts, white tensile reconstruction and embedded licensed source projection"},
        "controlPointReference":config["officialControlPoints"],"sourceManifest":config["sourceManifest"],
        "limitations":config["limitations"],"publicationStatus":"review-required"}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"lapLength":metadata["lapLength"],"objects":metadata["objects"],"clearance":clearance}))


if __name__ == "__main__":
    main()
