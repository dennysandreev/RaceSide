"""Monza-specific architecture and landscape, in metres in the shared UTM frame.

Footprints are pinned OSM. Heights, facade divisions and vegetation are visual
reconstructions, not survey data. Never modify the GP centreline here.
"""

import math
import random

import bpy
from mathutils import Vector


PIT_ID = 34404652
HOSPITALITY_ID = 194458105
PODIUM_ID = 219396377
LANDMARK_IDS = {PIT_ID, HOSPITALITY_ID, PODIUM_ID, 193647797, 193647798}
COVERED_STANDS = {193647796, 193647795, 34404645, 231026020}
CONCRETE = (0.57, 0.58, 0.55, 1)
IVORY = (0.82, 0.82, 0.77, 1)
STEEL = (0.28, 0.31, 0.30, 1)
GLASS = (0.095, 0.23, 0.25, 1)
ROOF = (0.69, 0.71, 0.68, 1)


def smoothstep(value):
    value = max(0, min(1, value))
    return value * value * value * (value * (value * 6 - 15) + 10)


def smooth_alignment(base, points, radius=12, spacing=2):
    """Filter by metres, not OSM vertex count; keep the two joining anchors."""
    # mathutils stores float32. UTM northings around 5,050,000 m have a
    # half-metre ULP: subtract the datum BEFORE creating any Vector.
    origin = points[0]
    points = [(p[0]-origin[0],p[1]-origin[1]) for p in points]
    cumulative, length = base.line_distance(points)
    count = math.ceil(length / spacing)
    samples = [Vector(base.sample_polyline(points, cumulative, length*i/count, closed=False))
               for i in range(count+1)]
    window = math.ceil(radius / spacing)
    result = []
    for i, point in enumerate(samples):
        neighbours = [(samples[j], math.exp(-2*((j-i)/window)**2))
                      for j in range(max(0,i-window), min(count,i+window)+1)]
        average = sum((p*w for p,w in neighbours), Vector((0,0))) / sum(w for _,w in neighbours)
        blend = smoothstep(min(i,count-i)/window)
        local = point.lerp(average,blend)
        result.append((local.x+origin[0],local.y+origin[1]))
    return result


def profile_height(knots, x):
    """Shape-preserving cubic through measured sections; no overshoot at crests."""
    x = max(knots[0][0], min(knots[-1][0], x))
    widths = [b[0]-a[0] for a,b in zip(knots,knots[1:])]
    slopes = [(b[1]-a[1])/w for a,b,w in zip(knots,knots[1:],widths)]
    derivatives = [slopes[0]]
    for i in range(1,len(knots)-1):
        a,b = slopes[i-1],slopes[i]
        w1,w2 = 2*widths[i]+widths[i-1],widths[i]+2*widths[i-1]
        derivatives.append((w1+w2)/(w1/a+w2/b) if a*b>0 else 0)
    derivatives.append(slopes[-1])
    i = next((i for i in range(len(widths)) if x<=knots[i+1][0]),len(widths)-1)
    t = (x-knots[i][0])/widths[i]
    return ((2*t**3-3*t*t+1)*knots[i][1]+(t**3-2*t*t+t)*widths[i]*derivatives[i]
            +(-2*t**3+3*t*t)*knots[i+1][1]+(t**3-t*t)*widths[i]*derivatives[i+1])


def visible_interval(start, end, clearance):
    """Clip a short painted segment at a carriageway junction."""
    first, last = clearance(start), clearance(end)
    if first <= 0 and last <= 0:
        return None
    if first > 0 and last > 0:
        return start, end
    low, high = start, end
    for _ in range(18):
        middle = (low+high)/2
        if (clearance(middle)>0) == (first>0):
            low = middle
        else:
            high = middle
    cut = (low+high)/2
    return (start,cut) if first>0 else (cut,end)


def feature_ring(feature, project):
    ring = [project(p["lat"], p["lon"]) for p in feature.get("geometry", [])]
    return ring[:-1] if ring and ring[0] == ring[-1] else ring


def frame_for_ring(ring, road):
    """Rectangular frame on the footprint's longest edge, front facing the road."""
    a, b = max(zip(ring, ring[1:] + ring[:1]), key=lambda pair: math.dist(*pair))
    t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
    n = Vector((-t.y, t.x))
    mid = Vector((sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)))
    nearest = min(road, key=lambda p: math.dist(p, mid))
    if (Vector(nearest) - mid).dot(n) > 0:
        t, n = -t, -n
    u = [(Vector(p) - mid).dot(t) for p in ring]
    v = [(Vector(p) - mid).dot(n) for p in ring]
    origin = mid + t * ((min(u) + max(u)) / 2) + n * min(v)
    return origin, t, n, max(u) - min(u), max(v) - min(v)


class Venue:
    def __init__(self, base, project, dtm, center, elevation, road, pit, buildings):
        self.base, self.project, self.dtm = base, project, dtm
        self.center, self.elevation = center, elevation
        self.road, self.pit = road, smooth_alignment(base, pit, radius=6)
        self.features = {e["id"]: e for e in buildings["elements"]}
        self.rings = {i: feature_ring(e, project) for i, e in self.features.items() if e.get("geometry")}
        self.exclusions = []
        self.facade_insets = {}

    def ground(self, point):
        return self.dtm.sample_rendered_terrain(*point) - self.elevation

    def local(self, point, height=0):
        return (point[0] - self.center["x"], point[1] - self.center["y"], self.ground(point) + height)

    def frame(self, identifier, road=None):
        frame = frame_for_ring(self.rings[identifier], road or self.road)
        if identifier not in LANDMARK_IDS or identifier == PODIUM_ID:
            return frame
        origin, t, n, length, depth = frame
        # A rectangular facade envelope can protrude beyond a non-rectangular
        # OSM footprint. Inset its front within the footprint, leaving the
        # existing 12 m pit ribbon and the GP geometry unchanged.
        inset = 0
        while inset < min(depth / 3, 8):
            front = [tuple(origin + t * (-length/2 + length*i/100) + n*inset) for i in range(101)]
            if all(self.base.distance_to_polyline(p, self.pit) > 7.2
                   and self.base.distance_to_polyline(p, self.road) > 7.2 for p in front):
                break
            inset += .25
        self.facade_insets[str(identifier)] = inset
        return origin+n*inset, t, n, length, depth-inset

    def box(self, builder, frame, along, depth, height, size, color=CONCRETE, material=0, floor=None):
        origin, t, n, _, _ = frame
        p = origin + t * along + n * depth
        z = self.ground(origin) if floor is None else floor
        builder.add_box((p.x - self.center["x"], p.y - self.center["y"], z + height), size,
                        material_index=material, color=color, rotation=math.atan2(t.y, t.x))

    def beam(self, builder, first, second, width, color=STEEL):
        a, b = Vector(first), Vector(second)
        direction = (b - a).normalized()
        cross = direction.cross(Vector((0, 0, 1)))
        if cross.length < .01:
            cross = direction.cross(Vector((0, 1, 0)))
        u = cross.normalized() * width / 2
        v = direction.cross(u).normalized() * width / 2
        rings = [[tuple(p + u * x + v * y) for x, y in [(-1, -1), (1, -1), (1, 1), (-1, 1)]] for p in [a, b]]
        builder.add_volume(*rings, color=color)

    def frame_point(self, frame, along, depth, height, floor=None):
        origin, t, n, _, _ = frame
        p = origin + along * t + depth * n
        return (p.x - self.center["x"], p.y - self.center["y"],
                (self.ground(origin) if floor is None else floor) + height)

    def pit_lane(self, surface, materials, collection, infrastructure):
        """Monza entry, fast lane and garage apron, rather than a uniform ribbon.

        OSM supplies the entry/exit and fast-lane alignment. The garage frontage
        bounds the working apron; the FIA drawing supplies the ten team boxes.
        All joining surfaces use the GP height field, including the merge ends.
        """
        road, paint, wall = (self.base.MeshBuilder() for _ in range(3))
        cumulative, total = self.base.line_distance(self.pit)
        frame = self.frame(PIT_ID, self.pit)
        origin, tangent, inward, length, _ = frame
        front = [origin + tangent * x for x in [-length/2, length/2]]

        def nearest_distance(point):
            best = (math.inf, 0)
            for i, (a, b) in enumerate(zip(self.pit, self.pit[1:])):
                a, b = Vector(a), Vector(b)
                blend = max(0, min(1, (Vector(point)-a).dot(b-a)/(b-a).length_squared))
                gap = (Vector(point)-a-blend*(b-a)).length
                if gap < best[0]:
                    best = (gap, cumulative[i]+blend*(cumulative[i+1]-cumulative[i]))
            return best[1]

        garage_start, garage_end = sorted(nearest_distance(p) for p in front)

        def section(distance):
            p = Vector(self.base.sample_polyline(self.pit, cumulative, distance, closed=False))
            t = self.base.sample_tangent(self.pit, cumulative, distance, closed=False)
            n = Vector((-t.y, t.x))  # West: GP side. East: garages.
            apron = max(0, min(1, (distance-garage_start+35)/35, (garage_end+25-distance)/25))
            apron = apron*apron*(3-2*apron)
            left = 2.5 + 2*apron
            right = 2.5 + 4.8*apron
            # The narrowing beside the hospitality building is a real feature
            # of the pit exit; it is not part of the wide garage working lane.
            return p, n, left, right

        def point(distance, offset, lift=0):
            p, n, _, _ = section(distance)
            xy = p+n*offset
            # One continuous height field across entry, GP and exit. Sampling
            # each lateral vertex also avoids a vertical seam at the joins.
            height = surface.sample(*xy)-self.elevation+self.base.TRACK_SURFACE_Z_OFFSET+.015
            return (*self.base.local_xy(xy, self.center), height+lift)

        def stripe(start, end, first_offset, second_offset, width=.15):
            def offset_at(d):
                return first_offset+(second_offset-first_offset)*(d-start)/(end-start)
            def outside_gp(d):
                p,n,_,_ = section(d)
                return self.base.distance_to_polyline(p+n*offset_at(d),self.road)-6.02
            interval = visible_interval(start,end,outside_gp)
            if interval is None:
                return
            a,b = interval
            paint.add_quad([point(d, offset+edge, .055) for d, offset, edge in
                            [(a,offset_at(a),-width/2),(b,offset_at(b),-width/2),
                             (b,offset_at(b),width/2),(a,offset_at(a),width/2)]])

        samples, wall_panels = [], 0
        count = math.ceil(total/2)
        for i in range(count+1):
            d = total*i/count
            p, n, left, right = section(d)
            samples.append((d, p, n, left, right))
        for a, b in zip(samples, samples[1:]):
            da, pa, na, la, ra = a
            db, pb, nb, lb, rb = b
            # Subdivide the apron across its width so the GP merge is flush.
            for j in range(6):
                aa, ab = -ra+(la+ra)*j/6, -ra+(la+ra)*(j+1)/6
                ba, bb = -rb+(lb+rb)*j/6, -rb+(lb+rb)*(j+1)/6
                road.add_quad([point(da, aa), point(db, ba), point(db, bb), point(da, ab)])
            if 12 < da < total-12:
                stripe(da, db, -ra+.2, -rb+.2)
                stripe(da, db, la-.2, lb-.2)
            if garage_start-10 <= da <= garage_end+10:
                stripe(da, db, .45, .45)
            # Construct only the wall between separated carriageways. The old
            # ratio-based wall continued through the entry and exit merges.
            wall_a, wall_b = pa+na*(la+.45), pb+nb*(lb+.45)
            if (130 < da < garage_end+95 and
                    min(self.base.distance_to_polyline(p, self.road) for p in [wall_a, wall_b]) > 7):
                bottom = [point(d, lateral, -.15) for d, lateral in
                          [(da, la+.3), (db, lb+.3), (db, lb+.6), (da, la+.6)]]
                top = [(x,y,z+1.2) for x,y,z in bottom]
                wall.add_volume(bottom, top, color=IVORY)
                # Open catch-fence posts and wires, rather than an opaque wall.
                post = point(da, la+.45, 1.05)
                self.beam(wall, post, tuple(Vector(post)+Vector((0,0,1.8))), .07, STEEL)
                for h in [1.25, 1.85, 2.45, 2.85]:
                    wall.add_quad([point(d,lateral,height) for d,lateral,height in
                                   [(da,la+.45,h-.015),(db,lb+.45,h-.015),
                                    (db,lb+.45,h+.015),(da,la+.45,h+.015)]],color=STEEL)
                wall_panels += 1
        # Ten working positions aligned to the actual garage block. The sixty
        # roller doors are not sixty independent F1 pit-stop boxes.
        for i in range(11):
            d = garage_start+(garage_end-garage_start)*i/10
            paint.add_quad([point(s, offset, .055) for s, offset in
                            [(d-.075,-7.1),(d+.075,-7.1),(d+.075,.45),(d-.075,.45)]])
        road_obj = road.create_object("FIA_Pit_Lane", [materials["asphalt"]], collection)
        paint.create_object("Monza_Pit_Fast_Lane_And_10_Working_Boxes", [materials["white"]], collection)
        wall.create_object("FIA_Pit_Wall_Concrete_And_Fence", [materials["pit_wall"]], infrastructure, vertex_colors=True)
        road_obj["source"] = "OSM pit alignment; mapped garage apron; FIA 2025 pit-lane drawing"
        return {"lengthMeters": round(total,3), "widthMeters": 11.8, "entryMinimumWidthMeters": 5,
                "exitMinimumWidthMeters": 5, "entryGapMeters": round(self.base.distance_to_polyline(self.pit[0],self.road),3),
                "exitGapMeters": round(self.base.distance_to_polyline(self.pit[-1],self.road),3),
                "fastLaneSeparator": True, "pitBoxes": 60, "workingPositions": 10,
                "garageApronStartMeters": round(garage_start,3), "garageApronEndMeters": round(garage_end,3),
                "variableWidth": True, "sharedGpHeightField": True,
                "pitWall": {"panels": wall_panels, "wallHeightMeters": 1.2, "fenceHeightMeters": 2.85, "minimumGpCentrelineSeparationMeters": 7}}

    def grandstands(self, materials, collection):
        builder = self.base.MeshBuilder()
        accepted, rejected = [], []
        for identifier, feature in self.features.items():
            if feature.get("tags", {}).get("building") != "grandstand":
                continue
            ring = self.rings[identifier]
            if min(self.base.distance_to_polyline(p, self.road) for p in ring) > 140:
                continue
            if self.base.polygon_intersects_corridors(ring, [(self.road, 7), (self.pit, 6.5)]):
                rejected.append(identifier)
                continue
            frame = self.frame(identifier)
            origin, t, n, length, depth = frame
            floor = max(self.ground(p) for p in ring) + .3
            rows = max(5, min(26, int((depth - 1.2) / .82)))
            pitch = (depth - 1.2) / rows
            rise = .38
            blocks = max(1, math.ceil(length / 20))
            block_length = length / blocks
            covered = identifier in COVERED_STANDS
            for row in range(rows):
                d, h = .8 + (row + .5) * pitch, .8 + row * rise
                self.box(builder, frame, 0, d, h - .12, (length, pitch, .24), CONCRETE, floor=floor)
                for block in range(blocks):
                    x = -length / 2 + (block + .5) * block_length
                    seat_color = (.43, .035, .025, 1) if identifier % 3 else (.16, .24, .20, 1)
                    half = (block_length - 1.3) / 2
                    builder.add_quad([self.frame_point(frame, xx, dd, h + .2, floor)
                                      for xx, dd in [(x-half,d-.2),(x+half,d-.2),(x+half,d+.2),(x-half,d+.2)]],
                                     material_index=1, color=seat_color)
                    builder.add_quad([self.frame_point(frame, xx, d+.22, hh, floor)
                                      for xx, hh in [(x-half,h+.2),(x+half,h+.2),(x+half,h+.57),(x-half,h+.57)]],
                                     material_index=1, color=seat_color)
            top = .8 + (rows - 1) * rise
            # Rear columns, diagonal bracing and railing are separate solid members.
            supports = max(2, math.ceil(length / 9))
            for i in range(supports + 1):
                x = -length / 2 + i * length / supports
                self.box(builder, frame, x, depth - .6, top / 2, (.23, .23, top), STEEL, floor=floor)
                self.beam(builder, self.frame_point(frame, x, 1, .2, floor),
                          self.frame_point(frame, x, depth - .6, top, floor), .18)
                self.box(builder, frame, x, depth - .2, top + .65, (.08, .08, 1.3), STEEL, floor=floor)
            for h in [top + .4, top + 1.2]:
                self.box(builder, frame, 0, depth - .2, h, (length, .08, .08), STEEL, floor=floor)
            # Covered concrete grandstands have a cantilever, not a roof on every stand.
            if covered:
                for i in range(supports + 1):
                    x = -length / 2 + i * length / supports
                    self.box(builder, frame, x, depth - .8, (top + 4) / 2,
                             (.45, .45, top + 4), CONCRETE, floor=floor)
                    self.beam(builder, self.frame_point(frame, x, depth - .8, top + 3.8, floor),
                              self.frame_point(frame, x, -.8, top + 4.7, floor), .36, ROOF)
                self.box(builder, frame, 0, depth / 2, top + 4.8,
                         (length + 2, depth + 3, .32), ROOF, floor=floor)
                for x in range(-int(length / 2), int(length / 2), 4):
                    self.box(builder, frame, x, depth / 2, top + 5, (.12, depth + 3, .12), IVORY, floor=floor)
            accepted.append({"osmWayId": identifier, "name": feature.get("tags", {}).get("name", "Grandstand"),
                             "lengthMeters": round(length, 2), "depthMeters": round(depth, 2),
                             "rows": rows, "covered": covered})
            self.exclusions.append(ring)
        obj = builder.create_object("Monza_Current_OSM_Official_Map_Grandstands", materials, collection, vertex_colors=True)
        obj["source"] = "Pinned OSM building footprints, promoter 2026 map; reconstructed tiers, supports and roofs"
        return obj, len(accepted), {"footprints": accepted, "renderedSections": len(accepted),
                                   "rejectedTrackConflicts": rejected, "remainingTrackConflicts": 0,
                                   "placement": "individual mapped footprints, never continuous track-offset strips"}

    def architecture(self, material, collection):
        builder = self.base.MeshBuilder()
        frame = self.frame(PIT_ID, self.pit)
        _, _, _, length, depth = frame
        floor = max(self.ground(p) for p in self.rings[PIT_ID]) + .65
        self.box(builder, frame, 0, depth / 2, 2.75, (length, depth, 5.5), IVORY, floor=floor)
        bays = 60
        bay = length / bays
        for i in range(bays):
            x = -length / 2 + (i + .5) * bay
            # Recessed roller doors, lintels and concrete piers on both facades.
            for face in [-.035, depth + .035]:
                self.box(builder, frame, x, face, 2.2, (bay - .32, .09, 3.9), (.105, .12, .12, 1), floor=floor)
                for h in [.9, 1.6, 2.3, 3.0, 3.7]:
                    self.box(builder, frame, x, face + (-.055 if face < 0 else .055), h,
                             (bay - .38, .025, .04), (.25, .27, .26, 1), floor=floor)
            self.box(builder, frame, x, -.18, 4.65, (bay - .1, .22, .55), (.27, .30, .28, 1), floor=floor)
        self.box(builder, frame, 0, depth / 2, 5.65, (length + 1, depth + 2, .3), ROOF, floor=floor)
        # Long glazed Paddock Club gallery with the temporary gabled roof modules.
        modules = max(1, round(length / 12))
        span = length / modules
        for i in range(modules):
            x = -length / 2 + (i + .5) * span
            for face in [1.0, depth - 1]:
                self.box(builder, frame, x, face, 7.6, (span - .25, .10, 3.5), GLASS, floor=floor)
                self.box(builder, frame, x - span / 2, face, 7.6, (.13, .15, 3.8), IVORY, floor=floor)
                self.box(builder, frame, x, face, 7.5, (span, .14, .12), IVORY, floor=floor)
            a = self.frame_point(frame, x - span / 2, .4, 9.55, floor)
            b = self.frame_point(frame, x + span / 2, .4, 9.55, floor)
            c = self.frame_point(frame, x + span / 2, depth / 2, 12.0, floor)
            d = self.frame_point(frame, x - span / 2, depth / 2, 12.0, floor)
            e = self.frame_point(frame, x + span / 2, depth - .4, 9.55, floor)
            f = self.frame_point(frame, x - span / 2, depth - .4, 9.55, floor)
            builder.add_quad((a, b, c, d), color=IVORY)
            builder.add_quad((d, c, e, f), color=ROOF)
            builder.add_triangle((a, d, f), color=IVORY)
            builder.add_triangle((b, e, c), color=IVORY)
            self.beam(builder, d, c, .10, STEEL)
        self.exclusions.append(self.rings[PIT_ID])
        # Separate three-storey hospitality building north of the garage block.
        self.add_facade_building(builder, HOSPITALITY_ID, 11.3, 3, IVORY)
        self.add_facade_building(builder, 193647797, 5.0, 1, (.57, .40, .27, 1), pitched=True)
        self.add_facade_building(builder, 193647798, 8.0, 2, (.67, .64, .55, 1), pitched=True)
        # The circular podium is elevated on its mapped footprint, with a link
        # to the garage. It must never be extruded from the road as a solid wall.
        ring = self.rings[PODIUM_ID]
        middle = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
        z = self.ground(middle)
        self.base.add_polygon_prism(builder, [ring], self.center, z + 6.1, z + 7,
                                   roof_color=CONCRETE, wall_color=(.15, .26, .16, 1))
        for a, b in zip(ring, ring[1:] + ring[:1]):
            self.beam(builder, (*self.base.local_xy(a, self.center), z + 8),
                      (*self.base.local_xy(b, self.center), z + 8), .075)
        near = min(self.rings[PIT_ID], key=lambda p: math.dist(p, middle))
        # Bridge spans between podium and front of the pit building at 6 m clearance.
        p = Vector(middle); q = Vector(near)
        direction = (q - p).normalized(); cross = Vector((-direction.y, direction.x)) * 1.7
        footprint = [tuple(p + cross), tuple(q + cross), tuple(q - cross), tuple(p - cross)]
        self.base.add_polygon_prism(builder, [footprint], self.center, z + 6.1, z + 6.65,
                                   roof_color=CONCRETE, wall_color=CONCRETE)
        # Both photographed timing/hospitality towers. Dimensions reconstructed.
        for lat, lon in [(45.61556, 9.28039), (45.62375, 9.28128)]:
            point = self.project(lat, lon)
            tower_frame = (Vector(point), Vector((0, 1)), Vector((-1, 0)), 7.5, 6.0)
            for x in [-2.4, 2.4]:
                self.box(builder, tower_frame, x, 3, 3.3, (.65, .65, 6.6), CONCRETE)
            self.box(builder, tower_frame, 0, 3, 12.1, (7.5, 6, 11.2), GLASS)
            for h in [6.5, 10, 13.5, 17, 18]:
                self.box(builder, tower_frame, 0, 3, h, (7.8, 6.25, .23), ROOF)
            for x in [-3.75, -2.5, -1.25, 0, 1.25, 2.5, 3.75]:
                for d in [-.06, 6.06]:
                    self.box(builder, tower_frame, x, d, 12.1, (.11, .12, 11.2), IVORY)
            self.beam(builder, self.frame_point(tower_frame, 4.5, 20, .1),
                      self.frame_point(tower_frame, 4.5, 3, 6.7), .45, CONCRETE)
        obj = builder.create_object("Monza_2026_60_Garage_Pit_Complex_Grandstand", [material], collection, vertex_colors=True)
        obj["source"] = "OSM Palazzina Box, Hospitality Building and Podio; official Monza hospitality photographs"
        return obj, {"garageBoxes": bays, "osmWayId": PIT_ID, "lengthMeters": round(length, 2),
                     "depthMeters": round(depth, 2), "hospitalityOsmWayId": HOSPITALITY_ID,
                     "podiumOsmWayId": PODIUM_ID, "photographicReconstruction": True,
                     "estimatedHeights": True, "timingTowers": 2,
                     "facadeEnvelopeInsetsMeters": dict(self.facade_insets)}

    def add_facade_building(self, builder, identifier, height, floors, color, pitched=False):
        frame = self.frame(identifier)
        origin, t, n, length, depth = frame
        ground = max(self.ground(p) for p in self.rings[identifier]) + .2
        self.box(builder, frame, 0, depth / 2, height / 2, (length, depth, height), color, floor=ground)
        bays = max(2, int(length / 4))
        for level in range(floors):
            for bay in range(bays):
                x = -length / 2 + (bay + .5) * length / bays
                for face in [-.06, depth + .06]:
                    self.box(builder, frame, x, face, 1.6 + level * height / floors,
                             (length / bays - .32, .14, height / floors - .9), GLASS, floor=ground)
            self.box(builder, frame, 0, -.3, (level + 1) * height / floors,
                     (length + .4, .7, .25), IVORY, floor=ground)
        if pitched:
            for sign in [-1, 1]:
                points = [self.frame_point(frame, x, d, h, ground) for x, d, h in
                          [(-length/2, depth/2 + sign*depth/2, height), (length/2, depth/2 + sign*depth/2, height),
                           (length/2, depth/2, height+2.8), (-length/2, depth/2, height+2.8)]]
                builder.add_quad(points, color=(.42, .24, .14, 1))
        else:
            self.box(builder, frame, 0, depth/2, height+.2, (length+1.5, depth+1.5, .4), ROOF, floor=ground)
            for x in [-length*.35, 0, length*.35]:
                self.box(builder, frame, x, depth*.65, height+1, (3.5, 2.8, 1.4), STEEL, floor=ground)
        self.exclusions.append(self.rings[identifier])

    def historic_oval(self, raceways, materials, collection):
        """1954 section, grounded inner apron and open reinforced-concrete frames.

        The archived north/south sections give the five 12%-80% bands and a
        6.20 m crest above the 12 m bank's toe. Local metres are essential:
        float32 UTM vectors made the previous normals zigzag by metres.
        Terrain and bridge tie-ins remain a reconstruction, not a laser survey.
        """
        surface, structure, portals = (self.base.MeshBuilder() for _ in range(3))
        identifiers = [1313097098, 19982933, 725687995, 725687994, 34404729,
                       34404730, 231256008, 231256009, 34404638, 19983025,
                       1313098146, 1313098145]
        features = {e['id']: e for e in raceways['elements']}
        points, bridges = [], []
        for identifier in identifiers:
            line = [self.project(p['lat'],p['lon']) for p in features[identifier]['geometry']]
            if points and math.dist(points[-1],line[-1]) < math.dist(points[-1],line[0]):
                line.reverse()
            points.extend(line if not points else line[1:])
            if features[identifier].get('tags',{}).get('bridge') == 'yes':
                bridges.append((line[0],line[-1]))
        points = smooth_alignment(self.base,points,radius=40)
        world_points = points
        points = [(p[0]-self.center['x'],p[1]-self.center['y']) for p in points]
        bridges = [[(p[0]-self.center['x'],p[1]-self.center['y']) for p in ends] for ends in bridges]
        def world(p):
            return p[0]+self.center['x'],p[1]+self.center['y']
        cumulative,total = self.base.line_distance(points)
        bridge_ranges = []
        for a,b in bridges:
            bridge_ranges.append(tuple(cumulative[min(range(len(points)),key=lambda i:math.dist(points[i],p))] for p in [a,b]))
        # The four transition sections are about 265 m in the historic plan.
        # The modern spectator approach is kept flat until it leaves the stands.
        bowls = [(300,1260),(2340,3370)]
        section = [(0,0),(1.75,.21),(3.70,.77),(5.95,1.81),(8.65,3.51),(12,6.20)]
        across_samples = [-5,0,1.75,2.725,3.70,4.825,5.95,7.30,8.65,10.325,12]
        bank_heights = [profile_height(section,max(0,x)) for x in across_samples]
        shell = .16
        count = math.ceil(total/4)
        step = total/count
        centres = [Vector(self.base.sample_polyline(points,cumulative,i*step,closed=False)) for i in range(count+1)]
        normals = []
        for i in range(count+1):
            tangent = (centres[min(count,i+1)]-centres[max(0,i-1)]).normalized()
            normals.append(Vector((-tangent.y,tangent.x)))
        raw_ground = [self.ground(world(p-normal*6)) for p,normal in zip(centres,normals)]
        floor = []
        for i in range(count+1):
            neighbours = [(raw_ground[j],math.exp(-2*((j-i)/22)**2))
                          for j in range(max(0,i-22),min(count,i+22)+1)]
            floor.append(sum(z*w for z,w in neighbours)/sum(w for _,w in neighbours)+.3)
        # Only the mapped crossings need extra clearance. A continuous cubic
        # grade joins their levels to the grounded bank, instead of hoisting
        # every metre of both bowls to the highest bridge's elevation.
        grade = [(i*step,floor[i]) for i in range(0,count+1,25)]
        grade.append((total,floor[-1]))
        for group in [bridge_ranges[:2],bridge_ranges[2:]]:
            if not group:
                continue
            a,b = max(0,group[0][0]-210),min(total,group[-1][1]+210)
            grade = [(d,z) for d,z in grade if not a<d<b]
            grade.extend([(a,floor[round(a/step)]),(b,floor[round(b/step)])])
            for start,end in group:
                # First north crossing is a service road; the second carries
                # the modern GP. Join them with one grade, without a saddle.
                clearance = 6.2 if 850<(start+end)/2<1500 else 3.7
                level = max(self.surface.sample(*world(self.base.sample_polyline(points,cumulative,d,closed=False)))
                            -self.elevation+self.base.TRACK_SURFACE_Z_OFFSET+clearance for d in [start,end])
                grade.extend([(start-10,level),(end+10,level)])
        grade = sorted(dict(grade).items())
        samples, uv_points, supports = [], {}, 0
        for i,p in enumerate(centres):
            distance = i*step
            tangent = (centres[min(count,i+1)]-centres[max(0,i-1)]).normalized()
            # Clockwise oval: the left side is always the outside, including
            # the long east straight. A global-centroid test can flip normals.
            normal = normals[i]
            banking, height = 0, profile_height(grade,distance)
            for start,end in bowls:
                if start<=distance<=end:
                    banking = smoothstep((distance-start)/265)*smoothstep((end-distance)/265)
            clear = min(self.base.distance_to_polyline(world(p+normal*x),self.road) for x in [-11,-6,0,6]) > 7
            on_bridge = any(a-8 <= distance <= b+8 for a,b in bridge_ranges)
            if not banking and not clear:
                height = self.surface.sample(*world(p))-self.elevation+self.base.TRACK_SURFACE_Z_OFFSET-.05
            strip = []
            for across,rise in zip(across_samples,bank_heights):
                # The historical 5 m apron tapers into the modern approaches.
                offset = -6+across*(banking if across<0 else 1)
                xy = p+normal*offset
                vertex = (xy.x,xy.y,height+rise*banking)
                strip.append(vertex)
                uv_points[tuple(round(v,5) for v in vertex)] = (across/12,distance/24)
            samples.append((strip,banking,clear,on_bridge))
            if i%3 == 0 and banking>.08 and clear and not on_bridge:
                # Open frames from the archived section: a curved cross-beam
                # supported by three tapered legs, not solid triangular walls.
                offset = Vector((tangent.x,tangent.y,0))*.24
                for j in range(1,len(strip)-1):
                    inner,outer=Vector(strip[j]),Vector(strip[j+1])
                    frame_section=[inner-Vector((0,0,shell+.44)),outer-Vector((0,0,shell+.44)),
                                   outer-Vector((0,0,shell+.02)),inner-Vector((0,0,shell+.02))]
                    front,back=[tuple(v-offset) for v in frame_section],[tuple(v+offset) for v in frame_section]
                    structure.add_quad(front,color=CONCRETE)
                    structure.add_quad(back,color=CONCRETE)
                    for edge in [0]+([3] if j==1 else [])+([1] if j==len(strip)-2 else []):
                        following=(edge+1)%4
                        structure.add_quad([front[edge],front[following],back[following],back[edge]],color=CONCRETE)
                for across in [4.65,7.50,11.60]:
                    xy=p+normal*(across-6)
                    top=height+profile_height(section,across)*banking-shell-.15
                    bottom=self.ground(world(xy))-.15
                    if top-bottom<.5:
                        continue
                    rings=[]
                    for z,shift,width in [(bottom,.25,.52),(top,0,.42)]:
                        rings.append([(xy.x+normal.x*(shift+x*width)+tangent.x*y*.24,
                                       xy.y+normal.y*(shift+x*width)+tangent.y*y*.24,z)
                                      for x,y in [(-.5,-1),(.5,-1),(.5,1),(-.5,1)]])
                    structure.add_volume(*rings,color=(.43,.44,.40,1))
                supports += 1
        for i,(first,second) in enumerate(zip(samples,samples[1:])):
            a,bank_a,clear_a,bridge_a = first
            b,bank_b,clear_b,bridge_b = second
            if not (clear_a and clear_b) and not (bridge_a and bridge_b):
                continue
            concrete = max(bank_a,bank_b)>.001
            for j in range(len(a)-1):
                surface.add_quad([a[j],b[j],b[j+1],a[j+1]],material_index=0 if concrete else 1)
            if not concrete:
                continue
            lower_a,lower_b = [[(x,y,z-shell) for x,y,z in strip] for strip in [a,b]]
            for j in range(len(a)-1):
                structure.add_quad([lower_a[j],lower_a[j+1],lower_b[j+1],lower_b[j]],color=(.30,.31,.27,1))
            for edge in [0,-1]:
                structure.add_quad([a[edge],b[edge],lower_b[edge],lower_a[edge]],color=CONCRETE)
            # A weathered metal crest rail follows the actual bowl continuously.
            for h in [.45,.82]:
                structure.add_quad([tuple(Vector(v)+Vector((0,0,height))) for v,height in
                                    [(a[-1],h-.055),(b[-1],h-.055),(b[-1],h+.055),(a[-1],h+.055)]],color=(.20,.21,.18,1))
            if i%2==0:
                self.beam(structure,a[-1],tuple(Vector(a[-1])+Vector((0,0,.95))),.11,CONCRETE)
        # Proper portal abutments and longitudinal deck girders. No support is
        # placed on the GP; the full opening remains at least 4.5 m high.
        for start,end in bridge_ranges:
            a=max(0,round((start-3)/step)); b=min(count,round((end+3)/step))
            for index in [a,b]:
                strip=samples[index][0]
                p=centres[index]
                tangent=(centres[index+1]-centres[index-1]).normalized()
                delta=Vector((tangent.x,tangent.y,0))*.7
                for j in range(len(strip)-1):
                    v,w=Vector(strip[j]),Vector(strip[j+1])
                    xy=world(((v.x+w.x)/2,(v.y+w.y)/2))
                    z=self.ground(xy)-.4
                    portal_section=[Vector((v.x,v.y,z)),Vector((w.x,w.y,z)),w-Vector((0,0,.35)),v-Vector((0,0,.35))]
                    if min(self.base.distance_to_polyline((q.x+self.center['x'],q.y+self.center['y']),self.road) for q in [v,w])>8:
                        portals.add_volume([tuple(q-delta) for q in portal_section],[tuple(q+delta) for q in portal_section])
            for index in range(a,b):
                for j in [0,3,6,len(samples[index][0])-1]:
                    first=Vector(samples[index][0][j])-Vector((0,0,.6))
                    second=Vector(samples[index+1][0][j])-Vector((0,0,.6))
                    self.beam(structure,first,second,.55,(.34,.35,.31,1))
        obj=surface.create_object('Monza_Historic_Banked_Oval',[materials['concrete'],materials['asphalt']],collection)
        uv=obj.data.uv_layers.new(name='OvalDistanceUV')
        for polygon in obj.data.polygons:
            polygon.use_smooth=True
            for index in polygon.loop_indices:
                v=surface.vertices[obj.data.loops[index].vertex_index]
                uv.data[index].uv=uv_points[tuple(round(c,5) for c in v)]
        structure.create_object('Monza_Historic_Banked_Oval_Structure',[materials['pit_wall']],collection,vertex_colors=True)
        portals.create_object('Monza_Historic_Banked_Oval_Portals',[materials['aged_structure']],collection)
        obj['source']='Local-metre OSM alignment; 1954 archived cross-section and open frames; reconstructed terrain/bridge grades'
        review=[{'distance':round(i*step,3),'inner':list(s[0][1]),'outer':list(s[0][-1]),'bank':s[1],
                 'ground':raw_ground[i]} for i,s in enumerate(samples)]
        return obj,[world_points],{'osmWayIds':identifiers,'mappedLengthMeters':round(total,2),
                            'supportRibs':supports,'mappedBridges':len(bridges),'bankTransitionMeters':265,
                            'continuousAlignment':True,'bridgeOnlyElevation':True,'continuousBowlDatum':False,
                            'flatNorthApproachMeters':300,'crossSectionReconstructed':False,
                            'crossSectionSource':'MonzaSport / Politecnico di Milano 2002, archived 1954 sections, pages 9-10',
                            'sectionStationsMeters':section,'apronWidthMeters':5,'shellThicknessMeters':shell,
                            'bridgeGradesReconstructed':True,'frameDimensionsReconstructed':True,
                            'localCoordinateCalculations':True,'profile':review}

    def paddock(self, material, collection):
        """Temporary hospitality modules along the mapped rear of Palazzina Box.

        This is a plausible event configuration, not a surveyed team allocation.
        Keep an open service lane between garages and the hospitality frontage.
        """
        builder = self.base.MeshBuilder()
        frame = self.frame(PIT_ID, self.pit)
        origin, t, n, length, depth = frame
        count, rejected = 0, 0
        footprints = []
        colors = [(.18,.23,.29,1), (.58,.07,.055,1), (.63,.65,.63,1),
                  (.06,.24,.19,1), (.15,.16,.17,1), (.74,.36,.08,1)]
        for i in range(11):
            x = -length / 2 + (i + .5) * length / 11
            d = depth + 51
            ring = [tuple(origin + t * (x + u) + n * (d + v))
                    for u,v in [(-7,-10),(7,-10),(7,10),(-7,10)]]
            if self.base.polygon_intersects_corridors(ring, [(self.road, 9), (self.pit, 8)]):
                rejected += 1
                continue
            floor = max(self.ground(p) for p in ring) + .15
            color = colors[i % len(colors)]
            self.box(builder, frame, x, d, .2, (15,22,.4), CONCRETE, floor=floor)
            self.box(builder, frame, x, d, 3.5, (14,20,6.6), color, floor=floor)
            for level in [1.9,5.0]:
                self.box(builder, frame, x, d-10.08, level, (13.4,.12,2.5), GLASS, floor=floor)
                for column in range(6):
                    self.box(builder, frame, x-6.5+column*2.6, d-10.2, level,
                             (.12,.15,2.6), IVORY, floor=floor)
            for h in [3.4,6.8]:
                self.box(builder, frame, x, d-10.3, h, (14.6,1.1,.22), IVORY, floor=floor)
            self.box(builder, frame, x, d, 6.9, (14.5,20.5,.3), ROOF, floor=floor)
            self.box(builder, frame, x+3, d+4, 7.4, (3.0,4,.8), STEEL, floor=floor)
            # Side access stair and a compact canopy over the entrance.
            for step in range(8):
                self.box(builder, frame, x-6.2, d-11-step*.3, .18+step*.16,
                         (1.4,.32,.2), CONCRETE, floor=floor)
            self.box(builder, frame, x, d-11.5, 3.3, (6,3,.16), IVORY, floor=floor)
            footprints.append(ring)
            count += 1
        obj = builder.create_object("Monza_2026_Race_Motorhomes", [material], collection, vertex_colors=True)
        obj["source"] = "Reconstructed temporary hospitality modules in the paddock; positions and liveries are illustrative"
        self.exclusions.extend(footprints)
        return obj, count, {"configuredObjects": 11, "renderedObjects": count,
                            "rejectedTrackConflicts": rejected, "remainingTrackConflicts": 0,
                            "behindPitComplex": True, "inferredEventLayout": True}

    def forest(self, prepared, material, collection, historic_lines):
        """Populate only wooded aerial pixels; avoid roads, lawns and footprints.

        Individual positions/heights are inferred, not mapped tree surveys.
        The fixed seed makes exclusions and geometry reproducible.
        """
        image = bpy.data.images.load(str(prepared / "monza-orthophoto-2012.jpg"), check_existing=True)
        pixels = list(image.pixels)
        width, height = image.size
        bounds = self.dtm.bounds
        rng = random.Random(20261021)
        builder = self.base.MeshBuilder()
        # Icosphere vertices and triangles supply rounded, asymmetric broadleaf crowns.
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
        bm.verts.ensure_lookup_table()
        sphere = [tuple(v.co) for v in bm.verts]
        indices = {v: i for i, v in enumerate(bm.verts)}
        faces = [[indices[v] for v in face.verts] for face in bm.faces]
        bm.free()
        count = 0
        occupied = set()
        ring_bounds = [(min(p[0] for p in r), min(p[1] for p in r), max(p[0] for p in r), max(p[1] for p in r), r)
                       for r in [*self.rings.values(), *self.exclusions] if len(r) >= 3]
        for _ in range(17000):
            if count >= 1920:
                break
            p = (rng.uniform(521650, 523300), rng.uniform(5050650, 5053150))
            separation = self.base.distance_to_polyline(p, self.road)
            if separation > 210 and not self.base.point_in_polygon(p, self.road):
                continue
            if separation < 24 or self.base.distance_to_polyline(p, self.pit) < 24:
                continue
            if any(self.base.distance_to_polyline(p, line) < 20 for line in historic_lines):
                continue
            if any(a-7 < p[0] < c+7 and b-7 < p[1] < d+7 and self.base.distance_point_polygon(p, ring) < 7
                   for a,b,c,d,ring in ring_bounds):
                continue
            px = int((p[0]-bounds["minX"])/(bounds["maxX"]-bounds["minX"])*(width-1))
            py = int((p[1]-bounds["minY"])/(bounds["maxY"]-bounds["minY"])*(height-1))
            r,g,b = pixels[(py*width+px)*4:(py*width+px)*4+3]
            # Reject roads, bright lawns and brown fields in the source image.
            if not (g > r*1.04 and g > b*.88 and .10 < g < .34 and r < .27):
                continue
            cell = (int(p[0]/9), int(p[1]/9))
            if cell in occupied:
                continue
            occupied.add(cell)
            tree_height = rng.uniform(12, 22)
            radius = rng.uniform(5.5, 9.2)
            lx,ly,gz = self.local(p)
            builder.add_cylinder((lx,ly,gz), .24, tree_height*.55, sides=5, color=(.17,.12,.075,1))
            for lobe in range(2 if separation < 70 else 1):
                offx, offy = rng.uniform(-1.7,1.7), rng.uniform(-1.7,1.7)
                shade = rng.uniform(.78,1.2)
                color = (.085*shade, .19*shade, .065*shade,1)
                vertices = [(lx+offx+x*radius, ly+offy+y*radius*.88,
                             gz+tree_height*.68+z*tree_height*.32+lobe*.9) for x,y,z in sphere]
                for face in faces:
                    builder.add_triangle(tuple(vertices[i] for i in face), color=color)
            count += 1
        obj = builder.create_object("Monza_Park_Broadleaf_Canopy", [material], collection, vertex_colors=True)
        # MeshBuilder emits independent triangle vertices. Weld them before
        # smooth shading so crowns have continuous normals instead of facets.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.001)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj["source"] = "Deterministic canopy reconstruction within wooded PCN 2012 pixels; heights and individual tree locations inferred"
        return obj, count, {"trees": count, "source": "PCN 2012 wooded-pixel mask", "inferredPositions": True,
                            "seed": 20261021, "minimumRoadCentreClearanceMeters": 24}

    def barriers(self, data, material, collection):
        builder = self.base.MeshBuilder()
        segments = 0
        for feature in data["elements"]:
            points = feature_ring(feature, self.project)
            kind = feature.get("tags", {}).get("barrier")
            if len(points) < 2 or min(self.base.distance_to_polyline(p, self.road) for p in points) > 100:
                continue
            for a,b in zip(points, points[1:]):
                length = math.dist(a,b)
                if length < .3:
                    continue
                for i in range(max(1, math.ceil(length/8))):
                    t0, t1 = i/max(1, math.ceil(length/8)), (i+1)/max(1, math.ceil(length/8))
                    p = tuple(a[j]+(b[j]-a[j])*t0 for j in range(2))
                    q = tuple(a[j]+(b[j]-a[j])*t1 for j in range(2))
                    if min(self.base.distance_to_polyline(p,self.road),self.base.distance_to_polyline(q,self.road)) < 7.5:
                        continue
                    if min(self.base.distance_to_polyline(p,self.pit),self.base.distance_to_polyline(q,self.pit)) < 7.5:
                        continue
                    if kind in ("wall", "retaining_wall"):
                        self.beam(builder, self.local(p,.5), self.local(q,.5), .75, CONCRETE)
                    else:
                        for h in [.45,.75,1.05]:
                            builder.add_quad((self.local(p,h-.11),self.local(q,h-.11),
                                              self.local(q,h+.11),self.local(p,h+.11)), color=(.43,.46,.44,1))
                        self.beam(builder, self.local(p), self.local(p,2.7), .11)
                        for h in [1.45,2.05,2.65]:
                            builder.add_quad((self.local(p,h-.018),self.local(q,h-.018),
                                              self.local(q,h+.018),self.local(p,h+.018)), color=STEEL)
                    segments += 1
        obj = builder.create_object("Monza_OSM_Safety_Fences_And_Walls", [material], collection, vertex_colors=True)
        return obj, segments


def export_precise_glb(base, path):
    """Use the existing Madring export pattern to keep paint and thin railings."""
    from io_scene_gltf2.io.exp import meshopt
    original = meshopt.MeshoptEncoder.encode_attribute

    def precise(name, data, stride, settings):
        previous = meshopt.EXP_FILTER_BITS
        try:
            if name == "POSITION":
                meshopt.EXP_FILTER_BITS = 18
            return original(name, data, stride, settings)
        finally:
            meshopt.EXP_FILTER_BITS = previous

    meshopt.MeshoptEncoder.encode_attribute = staticmethod(precise)
    try:
        base.export_glb(path)
    finally:
        meshopt.MeshoptEncoder.encode_attribute = staticmethod(original)


def texture_surfaces(prepared, materials):
    for key, scale in [("asphalt", 12), ("gravel", 8), ("concrete", 12), ("aged_structure", 8)]:
        material = materials[key]
        texture = material.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(str(prepared / f"monza-{key}.jpg"), check_existing=True)
        material.node_tree.links.new(texture.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
        if key == "concrete":
            normal = material.node_tree.nodes.new("ShaderNodeTexImage")
            normal.image = bpy.data.images.load(str(prepared / "monza-concrete-normal.jpg"), check_existing=True)
            normal.image.colorspace_settings.name = "Non-Color"
            mapping = material.node_tree.nodes.new("ShaderNodeNormalMap")
            mapping.inputs["Strength"].default_value = .6
            material.node_tree.links.new(normal.outputs["Color"],mapping.inputs["Color"])
            material.node_tree.links.new(mapping.outputs["Normal"],material.node_tree.nodes["Principled BSDF"].inputs["Normal"])
        for obj in bpy.data.objects:
            if obj.type != "MESH" or material.name not in obj.data.materials:
                continue
            if obj.name == "Monza_Historic_Banked_Oval":
                continue  # Physical distance UVs follow the curve, with no stretching.
            uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name="SurfaceUV")
            for polygon in obj.data.polygons:
                for index in polygon.loop_indices:
                    p = obj.data.vertices[obj.data.loops[index].vertex_index].co
                    if key == "aged_structure" and abs(polygon.normal.z)<.65:
                        uv.data[index].uv = ((p.y if abs(polygon.normal.x)>abs(polygon.normal.y) else p.x)/scale,p.z/scale)
                    else:
                        uv.data[index].uv = (p.x / scale, p.y / scale)
