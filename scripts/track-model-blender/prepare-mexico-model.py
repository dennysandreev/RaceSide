#!/usr/bin/env python3
"""Prepare Mexico's pinned OSM geometry, licensed aerial colors and measured DTM.

Build-only dependencies reuse the existing rasterio/numpy/OpenCV/Pillow runtime.
No source data from another circuit is used. EPSG:32614 scene units are metres.
"""

from bisect import bisect_right
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from statistics import median
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter
import rasterio
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/mexico-source"
PREPARED = ROOT / ".track-model-build/mexico-prepared"
BOUNDS = {"minX": 489700, "minY": 2144630, "maxX": 491400, "maxY": 2145910}
MAIN_WAYS = [772755821, 1313598528, 772754605, 772754608, 1128592398,
             1128592396, 772755824, 823823141, 823823140]
PIT_WAYS = [638504647, 772763791]
FINISH_NODE = 5070396402
RACE_START_NODE = 13826403209
OFFICIAL_LENGTH = 4304
SOURCE_RESOLUTION_METERS = 30
PROFILE_SIGMA_NATIVE_CELLS = 3
PROFILE_SIGMA_METERS = SOURCE_RESOLUTION_METERS * PROFILE_SIGMA_NATIVE_CELLS
PROFILE_SUPPORT_SIGMAS = 3
# Cover a rendered 8.5 x 10.67 m terrain cell beyond the road edge before
# blending back to the source. This does not raise the road itself.
FULL_GRADE_HALF_WIDTH_METERS = 16
GRADE_BLEND_OUTER_HALF_WIDTH_METERS = 32
STADIUM_FLAT_PADDING_METERS = 24
STADIUM_BLEND_OUTER_METERS = 180
# Apex vertices reviewed against FIA 2025 page 2 and the 2026 promoter layout.
TURN_VERTICES = [38, 45, 53, 74, 81, 94, 110, 124, 142, 152, 162, 173, 181, 189, 195, 201, 9]

# Reuse metric projection and polyline mathematics, never Austin geometry.
spec = importlib.util.spec_from_file_location("track_metric_tools", Path(__file__).with_name("prepare-austin-model.py"))
metric = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metric)
utm14, cumulative, sample, nearest = metric.utm14, metric.cumulative, metric.sample, metric.nearest


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def in_bounds(point):
    return BOUNDS["minX"] <= point[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= point[1] <= BOUNDS["maxY"]


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = {n.get("id"): utm14(float(n.get("lat")), float(n.get("lon"))) for n in root.findall("node")}
    features = {}
    trees = []
    for way in root.findall("way"):
        refs = [n.get("ref") for n in way.findall("nd")]
        if not all(ref in nodes for ref in refs):
            continue
        features[int(way.get("id"))] = {
            "id": int(way.get("id")),
            "tags": {t.get("k"): t.get("v") for t in way.findall("tag")},
            "world": [nodes[ref] for ref in refs],
        }
    for node in root.findall("node"):
        tags = {t.get("k"): t.get("v") for t in node.findall("tag")}
        if tags.get("natural") == "tree" and in_bounds(nodes[node.get("id")]):
            trees.append(nodes[node.get("id")])
    return nodes, features, trees


def join_ways(features, way_ids, closed):
    line = []
    for ident in way_ids:
        points = features[ident]["world"]
        if line and math.dist(line[-1], points[0]) > .05:
            raise ValueError(f"Disconnected Mexico raceway at OSM way {ident}")
        line.extend(points if not line else points[1:])
    if closed and math.dist(line[0], line[-1]) > .05:
        raise ValueError("Mexico source centerline is not closed")
    return line


def registered_aerial(line):
    registration = json.loads((ROOT / "docs/track-model-mexico-skysat-registration.json").read_text())
    for name, expected in registration.get("pinnedInputSha256", {}).items():
        if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Reviewed Mexico registration input changed: {name}")
    source = cv2.imread(str(SOURCE / registration["sourceImage"]))
    if source is None:
        raise FileNotFoundError(registration["sourceImage"])
    ref = registration["referenceBounds"]
    spacing = registration["referencePixelGridSpacingMeters"]
    matrix = np.asarray(registration["sourcePixelToReferencePixelAffine"], dtype=np.float64)
    # Output uses the reference grid spacing, but its own fully covered extent.
    matrix[0, 2] += (ref["minX"] - BOUNDS["minX"]) / spacing
    matrix[1, 2] += (BOUNDS["maxY"] - ref["maxY"]) / spacing
    width = round((BOUNDS["maxX"] - BOUNDS["minX"]) / spacing)
    height = round((BOUNDS["maxY"] - BOUNDS["minY"]) / spacing)
    output = cv2.warpAffine(source, matrix, (width, height), flags=cv2.INTER_CUBIC)
    mask = cv2.warpAffine(np.full(source.shape[:2], 255, dtype=np.uint8), matrix,
                         (width, height), flags=cv2.INTER_NEAREST)
    if np.any(mask == 0):
        raise ValueError("Mexico scene extent exceeds the licensed image")
    cv2.imwrite(str(PREPARED / "mexico-orthophoto.jpg"), output, [cv2.IMWRITE_JPEG_QUALITY, 85])
    # Explicit georeferencing is retained independently of Blender's UVs.
    with rasterio.open(PREPARED / "mexico-orthophoto.tif", "w", driver="GTiff", count=3,
                       width=width, height=height, dtype="uint8", crs="EPSG:32614",
                       transform=rasterio.transform.from_bounds(*[BOUNDS[k] for k in ("minX", "minY", "maxX", "maxY")],
                                                               width, height), compress="deflate") as dest:
        dest.write(np.moveaxis(output[:, :, ::-1], 2, 0))
    return Image.fromarray(output[:, :, ::-1]), registration


def roof_color(aerial, polygon):
    width, height = aerial.size
    pixels = [((p[0] - BOUNDS["minX"]) / (BOUNDS["maxX"] - BOUNDS["minX"]) * width,
               (BOUNDS["maxY"] - p[1]) / (BOUNDS["maxY"] - BOUNDS["minY"]) * height) for p in polygon]
    left, top = max(0, int(min(p[0] for p in pixels)) - 2), max(0, int(min(p[1] for p in pixels)) - 2)
    right, bottom = min(width, math.ceil(max(p[0] for p in pixels)) + 3), min(height, math.ceil(max(p[1] for p in pixels)) + 3)
    mask = Image.new("L", (right - left, bottom - top))
    ImageDraw.Draw(mask).polygon([(x - left, y - top) for x, y in pixels], fill=255)
    interior = mask.filter(ImageFilter.MinFilter(5)) if min(mask.size) >= 5 else mask
    if not interior.getbbox():
        interior = mask
    samples = [color for color, included in zip(aerial.crop((left, top, right, bottom)).getdata(), interior.getdata()) if included]
    if not samples:
        raise ValueError("Mapped Mexico roof has no registered source pixels")
    return [round(median(channel) / 255, 4) for channel in zip(*samples)]


def css_color(value):
    try:
        return [round(channel / 255, 4) for channel in ImageColor.getrgb(value)]
    except (ValueError, TypeError):
        return None


def event_infrastructure():
    """Reviewed event-map objects corroborated by permanent/aerial positions.

    Pixel rings are hand-traced observable bleacher footprints in the private
    registration reference; that reference is never exported as a texture.
    Rows and construction dimensions remain estimates, not surveyed values.
    """
    stands = []
    for name, pixels, rows in [
        ("T1 exterior norte — Gradas 3/3A", [[1793, 336], [1993, 378], [1988, 402], [1789, 360]], 21),
        ("T1 exterior este — Gradas 4/5", [[1990, 402], [2017, 415], [1996, 508], [1970, 491]], 21),
    ]:
        stands.append({"id": "event-2026-" + str(len(stands) + 1), "name": name,
                       "world": [[489700 + p[0] / 1.2, 2145950 - p[1] / 1.2] for p in pixels],
                       "tags": {"building": "grandstand", "temporary": "yes"},
                       "seatColor": [.35, .38, .38], "roofColor": [.9, .9, .87],
                       "coveredRearFraction": 0, "rows": rows,
                       "footprintSource": "2026 official promoter layout; bleacher boundaries traced in geographic private aerial reference",
                       "accuracy": "hand-traced reference footprint; event naming, row count, height and individual seat color approximate"})
    # Current-ticket-page 2025 photograph confirms the stadium surface colors.
    # Road ribbons render above these source-observed event surfaces.
    surfaces = [
        {"id": "stadium-green-runoff", "name": "Stadium painted green apron",
         "world": [[489905, 2145710], [490010, 2145710], [490004, 2145684], [489981, 2145684],
                   [489965, 2145658], [489941, 2145658], [489916, 2145672], [489899, 2145675]],
         "color": [132 / 255, 176 / 255, 132 / 255], "colorSource": "official-stadium-south-2025-photo.jpg ROI [645,351,705,372] median"},
        {"id": "stadium-blue-runoff", "name": "Stadium painted blue apron",
         "world": [[489900, 2145650], [489943, 2145650], [489963, 2145660], [489981, 2145683],
                   [490009, 2145685], [490002, 2145590], [489894, 2145617]],
         "color": [78 / 255, 115 / 255, 177 / 255], "colorSource": "official-stadium-south-2025-photo.jpg ROI [830,365,875,401] median"},
    ]
    return stands, surfaces


def prepare_dtm():
    width = round((BOUNDS["maxX"] - BOUNDS["minX"]) / 4) + 1
    height = round((BOUNDS["maxY"] - BOUNDS["minY"]) / 4) + 1
    xs, ys = np.meshgrid(np.linspace(BOUNDS["minX"], BOUNDS["maxX"], width),
                         np.linspace(BOUNDS["maxY"], BOUNDS["minY"], height))
    with rasterio.open(SOURCE / "gedtm30-native.tif") as source:
        lon, lat = transform("EPSG:32614", source.crs, xs.ravel(), ys.ravel())
        grid = source.read(1).astype(np.float32)
        if source.nodata is not None and np.any(grid == source.nodata):
            raise ValueError("Mexico DTM includes unhandled no-data")
        grid = grid * source.scales[0] + source.offsets[0]
        cols = (np.asarray(lon) - source.transform.c) / source.transform.a - .5
        rows = (np.asarray(lat) - source.transform.f) / source.transform.e - .5
        if cols.min() < 0 or rows.min() < 0 or cols.max() > grid.shape[1] - 1 or rows.max() > grid.shape[0] - 1:
            raise ValueError("Mexico DTM extent does not cover the scene")
        values = cv2.remap(grid, cols.reshape(height, width).astype(np.float32), rows.reshape(height, width).astype(np.float32),
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    if not np.isfinite(values).all() or values.min() < 2000 or values.max() > 2400:
        raise ValueError("Invalid Mexico DTM elevations")
    values.astype("<f4").tofile(PREPARED / "mexico-source-dtm.f32le")
    return values, width, height


def raster_sample(values, point):
    height, width = values.shape
    x = max(0, min(width - 1.001, (point[0] - BOUNDS["minX"]) / (BOUNDS["maxX"] - BOUNDS["minX"]) * (width - 1)))
    y = max(0, min(height - 1.001, (BOUNDS["maxY"] - point[1]) / (BOUNDS["maxY"] - BOUNDS["minY"]) * (height - 1)))
    ix, iy, tx, ty = int(x), int(y), x - int(x), y - int(y)
    return float(values[iy, ix] * (1 - tx) * (1 - ty) + values[iy, ix + 1] * tx * (1 - ty)
                 + values[iy + 1, ix] * (1 - tx) * ty + values[iy + 1, ix + 1] * tx * ty)


def profile(line, values, closed):
    distances = cumulative(line)
    count = math.ceil(distances[-1])
    steps = [distances[-1] * i / count for i in range(count + 1)]
    measured = [raster_sample(values, sample(line, distances, d)) for d in steps]
    # GEDTM30 is a coarse bare-earth reconstruction, not a road survey.
    # Three native cells suppress unresolved surface noise while retaining
    # broad elevation trends. Normalized weights preserve absolute elevations
    # and the closed-lap mean; neither amplitudes nor grades are rescaled.
    step = distances[-1] / count
    radius = math.ceil(PROFILE_SUPPORT_SIGMAS * PROFILE_SIGMA_METERS / step)
    offsets = np.arange(-radius, radius + 1) * step
    weights = np.exp(-.5 * (offsets / PROFILE_SIGMA_METERS) ** 2)
    weights /= weights.sum()
    series = np.asarray(measured[:-1] if closed else measured, dtype=np.float64)
    padded = np.pad(series, radius, mode="wrap" if closed else "edge")
    smooth = np.convolve(padded, weights, mode="valid").tolist()
    if closed:
        smooth.append(smooth[0])
    return {"distanceMeters": steps, "elevationMeters": smooth, "stepMeters": step,
            "smoothing": {"method": "normalized Gaussian", "sigmaMeters": PROFILE_SIGMA_METERS,
                          "sigmaNativeCells": PROFILE_SIGMA_NATIVE_CELLS,
                          "sourceResolutionMeters": SOURCE_RESOLUTION_METERS,
                          "supportRadiusMeters": radius * step,
                          "closedBoundary": "periodic" if closed else "edge padding",
                          "heightScale": 1}}


def profile_statistics(profile_data):
    distances = np.asarray(profile_data["distanceMeters"], dtype=np.float64)
    heights = np.asarray(profile_data["elevationMeters"], dtype=np.float64)
    grades = np.diff(heights) / np.diff(distances)
    periodic = profile_data["smoothing"]["closedBoundary"] == "periodic"
    sequence = np.append(grades, grades[0]) if periodic else grades
    return {"minimumMeters": float(heights.min()), "maximumMeters": float(heights.max()),
            "meanMeters": float(np.mean(heights[:-1] if periodic else heights)),
            "rangeMeters": float(np.ptp(heights)),
            "maximumLongitudinalGradePercent": float(np.max(np.abs(grades)) * 100),
            "maximumGradeChangePercentagePointsPerMeter": float(np.max(np.abs(np.diff(sequence)))
                                                                 / profile_data["stepMeters"] * 100),
            "slopeReversals": int(np.count_nonzero(np.diff(np.sign(sequence)))),
            "totalAbsoluteVerticalTravelMeters": float(np.sum(np.abs(np.diff(heights))))}


def profile_sample(profile_data, distance):
    steps, elevations = profile_data["distanceMeters"], profile_data["elevationMeters"]
    i = min(max(0, bisect_right(steps, distance) - 1), len(steps) - 2)
    t = (distance - steps[i]) / (steps[i + 1] - steps[i])
    return elevations[i] * (1 - t) + elevations[i + 1] * t


def stadium_weight(point, grading):
    origin = grading["outlineMeters"][0]
    ring = np.asarray([[x - origin[0], y - origin[1]] for x, y in grading["outlineMeters"]], dtype=np.float32)
    signed = cv2.pointPolygonTest(ring, (float(point[0] - origin[0]), float(point[1] - origin[1])), True)
    t = np.clip((grading["blendOuterMeters"] + signed)
                / (grading["blendOuterMeters"] - grading["flatPaddingMeters"]), 0, 1)
    return float(t ** 3 * (t * (t * 6 - 15) + 10))


def level_stadium(reference, line, main_profile, values):
    """One local apron datum, with smooth road/terrain approaches outside it."""
    points = [p for bank in reference["seatingBanks"] for p in bank["outlineMeters"]]
    points.extend(p for surface in reference["eventSurfaces"] for p in surface["world"])
    origin = points[0]
    local = np.asarray([[x - origin[0], y - origin[1]] for x, y in points], dtype=np.float32)
    outline = [[float(p[0]) + origin[0], float(p[1]) + origin[1]] for p in cv2.convexHull(local)[:, 0]]
    grading = {"outlineMeters": outline, "flatPaddingMeters": STADIUM_FLAT_PADDING_METERS,
               "blendOuterMeters": STADIUM_BLEND_OUTER_METERS,
               "method": "level stadium platform; quintic blend only outside the stadium perimeter",
               "datumSource": "weighted mean of the smoothed native road profile within the local grading envelope",
               "visualReconstruction": True, "paintLiftMeters": .20}
    distances = cumulative(line)
    weights = np.asarray([stadium_weight(sample(line, distances, d), grading)
                          for d in main_profile["distanceMeters"][:-1]])
    elevations = np.asarray(main_profile["elevationMeters"][:-1])
    datum = float(np.sum(weights * elevations) / weights.sum())
    grading["elevationMeters"] = datum
    grading["sourceProfileMeanMeters"] = float(elevations.mean())
    leveled = elevations * (1 - weights) + datum * weights
    main_profile["elevationMeters"] = [*leveled.tolist(), float(leveled[0])]
    grading["resultProfileMeanMeters"] = float(leveled.mean())
    result = values.copy()
    left = max(0, math.floor((min(p[0] for p in outline) - STADIUM_BLEND_OUTER_METERS - BOUNDS["minX"]) / 4))
    right = min(values.shape[1] - 1, math.ceil((max(p[0] for p in outline) + STADIUM_BLEND_OUTER_METERS - BOUNDS["minX"]) / 4))
    top = max(0, math.floor((BOUNDS["maxY"] - max(p[1] for p in outline) - STADIUM_BLEND_OUTER_METERS) / 4))
    bottom = min(values.shape[0] - 1, math.ceil((BOUNDS["maxY"] - min(p[1] for p in outline) + STADIUM_BLEND_OUTER_METERS) / 4))
    for row in range(top, bottom + 1):
        for col in range(left, right + 1):
            weight = stadium_weight((BOUNDS["minX"] + col * 4, BOUNDS["maxY"] - row * 4), grading)
            result[row, col] = values[row, col] * (1 - weight) + datum * weight
    return result, grading


def grade_terrain(values, paths, profiles):
    height, width = values.shape
    separation = np.full(values.shape, np.inf, dtype=np.float32)
    grades = np.zeros(values.shape, dtype=np.float32)
    for path, elevations in zip(paths, profiles):
        distances = cumulative(path)
        count = math.ceil(distances[-1] / 4)
        for i in range(count):
            da, db = distances[-1] * i / count, distances[-1] * (i + 1) / count
            a, b = sample(path, distances, da), sample(path, distances, db)
            dx, dy = b[0] - a[0], b[1] - a[1]
            length2 = max(dx * dx + dy * dy, 1e-9)
            outer = GRADE_BLEND_OUTER_HALF_WIDTH_METERS
            left = max(0, int((min(a[0], b[0]) - outer - BOUNDS["minX"]) / 4))
            right = min(width - 1, int((max(a[0], b[0]) + outer - BOUNDS["minX"]) / 4) + 1)
            top = max(0, int((BOUNDS["maxY"] - max(a[1], b[1]) - outer) / 4))
            bottom = min(height - 1, int((BOUNDS["maxY"] - min(a[1], b[1]) + outer) / 4) + 1)
            for row in range(top, bottom + 1):
                y = BOUNDS["maxY"] - row * 4
                for col in range(left, right + 1):
                    x = BOUNDS["minX"] + col * 4
                    t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2))
                    gap = math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
                    if gap < separation[row, col]:
                        separation[row, col] = gap
                        grades[row, col] = profile_sample(elevations, da + t * (db - da))
    weight = np.clip((GRADE_BLEND_OUTER_HALF_WIDTH_METERS - separation)
                     / (GRADE_BLEND_OUTER_HALF_WIDTH_METERS - FULL_GRADE_HALF_WIDTH_METERS), 0, 1)
    weight = weight * weight * (3 - 2 * weight)
    target = values * (1 - weight) + grades * weight
    target.astype("<f4").tofile(PREPARED / "mexico-dtm.f32le")
    return target, separation


def prepare():
    PREPARED.mkdir(parents=True, exist_ok=True)
    manifest_path = SOURCE / "source-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for item in manifest["sources"]:
        source_file = SOURCE / item["file"]
        if hashlib.sha256(source_file.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Pinned Mexico source changed: {item['file']}")
    pinned_derived = {item["file"]: item for item in manifest.get("derivedResources", [])}
    for item in pinned_derived.values():
        data = (ROOT / item["file"]).read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError(f"Pinned Mexico derived reference changed: {item['file']}")
    nodes, features, trees = read_osm()
    original = join_ways(features, MAIN_WAYS, True)
    original_distances = cumulative(original)
    total = original_distances[-1]
    if abs(total - OFFICIAL_LENGTH) / OFFICIAL_LENGTH > .005:
        raise ValueError(f"Mexico length {total:.3f} differs from FIA by over 0.5%")
    finish_gap, finish_offset = nearest(original, original_distances, nodes[str(FINISH_NODE)])
    finish = sample(original, original_distances, finish_offset)
    split = bisect_right(original_distances, finish_offset)
    line = [finish, *original[split:-1], *original[:split], finish]
    # Avoid a zero-length duplicate if the control line is already an OSM vertex.
    line = [p for i, p in enumerate(line) if i == 0 or math.dist(p, line[i - 1]) > 1e-6]
    distances = cumulative(line)
    turns = [{"number": i + 1, "distanceMeters": (original_distances[v] - finish_offset) % total,
              "sourceVertex": v, "sourceCoordinate": original[v],
              "anchorSide": -1 if i + 1 in (2, 4, 7, 9, 11, 13, 15) else 1} for i, v in enumerate(TURN_VERTICES)]
    if any(a["distanceMeters"] >= b["distanceMeters"] for a, b in zip(turns, turns[1:])):
        raise ValueError("Mexico turn numbering is out of driving order")
    pit = join_ways(features, PIT_WAYS, False)
    pit_distances = cumulative(pit)
    pit_gaps = [nearest(line, distances, point)[0] for point in (pit[0], pit[-1])]
    if max(pit_gaps) > .05:
        raise ValueError(f"Mexico pit ends do not meet the raceway: {pit_gaps}")
    aerial, registration = registered_aerial(line)
    raw, width, height = prepare_dtm()
    profiles = [profile(path, raw, closed) for path, closed in ((line, True), (pit, False))]
    stadium_reference = json.loads((ROOT / "docs/track-model-mexico-stadium-reference.json").read_text())
    platform_terrain, stadium_grading = level_stadium(stadium_reference, line, profiles[0], raw)
    # Closely parallel roads share their ground elevation. Native 30 m cells
    # cannot resolve an independent pit profile beside a large garage roof.
    # Blend only where the geographic separation is less than 40 m; no main
    # elevations are rescaled, and the assumption is recorded below.
    for i, distance in enumerate(profiles[1]["distanceMeters"]):
        point = sample(pit, pit_distances, distance)
        gap, main_distance = nearest(line, distances, point)
        blend = max(0, min(1, (40 - gap) / 10))
        blend = blend * blend * (3 - 2 * blend)
        target = profile_sample(profiles[0], main_distance)
        profiles[1]["elevationMeters"][i] = profiles[1]["elevationMeters"][i] * (1 - blend) + target * blend
    # Pit junctions share exactly the main driving profile, with a 20 m transition.
    for endpoint, point in ((0, pit[0]), (-1, pit[-1])):
        d = nearest(line, distances, point)[1]
        difference = profile_sample(profiles[0], d) - profiles[1]["elevationMeters"][endpoint]
        for i, distance in enumerate(profiles[1]["distanceMeters"]):
            edge_distance = distance if endpoint == 0 else pit_distances[-1] - distance
            if edge_distance <= 20:
                profiles[1]["elevationMeters"][i] += difference * (1 - edge_distance / 20)
    graded, separation = grade_terrain(platform_terrain, (line, pit), profiles)
    write_json(PREPARED / "mexico-road-profiles.json", profiles)
    vectors = [f for f in features.values() if f["world"] and all(in_bounds(p) for p in f["world"])]
    for feature in vectors:
        if feature["tags"].get("building") and len(feature["world"]) >= 4:
            feature["roofColor"] = roof_color(aerial, feature["world"])
            feature["roofColorSource"] = "registered Planet SkySat 2018-06-04 footprint median"
            facade = css_color(feature["tags"].get("building:colour"))
            if facade:
                feature["facadeColor"] = facade
                feature["facadeColorSource"] = "current OSM building:colour"
    grandstands = []
    color_audit = json.loads((ROOT / "docs/track-model-mexico-building-colours.json").read_text())
    photographic_colors = {item["id"]: [round(c / 255, 4) for c in item["sampledSrgb"]] for item in color_audit["sources"]}
    # The roof was completed in 2019; the 2018 construction image cannot
    # supply its current white PTFE material color.
    features[828705077]["roofColor"] = [.92, .92, .90]
    features[828705077]["roofColorSource"] = "current OSM parent stadium roof:colour=white; official architect and 2026 promoter references"
    # This sports hall has an OSM grandstand tag but is a closed roofed gym.
    if 999253131 in features:
        features[999253131]["tags"] = {**features[999253131]["tags"], "building": "sports_hall"}
    # The permanent T4-T6 bleachers are mapped as a generic building.
    if 1309442839 in features:
        features[1309442839]["tags"] = {**features[1309442839]["tags"], "building": "grandstand"}
    for f in vectors:
        if f["tags"].get("building") == "grandstand":
            f = dict(f)
            f["seatColor"] = f["roofColor"]
            f["name"] = f["tags"].get("name", f"Mapped grandstand {f['id']}")
            if f["id"] in (377679562, 1315400018):
                f["name"] = "Estadio Norte — Grada 15" if f["id"] == 377679562 else "Estadio Sur — Grada 14"
                f["seatColor"] = [.56, .58, .59]
                f["roofColor"] = photographic_colors["stadiumRoofSouth"]
                f["roofColorSource"] = "official 2025 event photograph reviewed roof-body ROI; current ticket page"
                f["coveredRearFraction"] = .65
                f["rows"] = 36
            elif f["id"] in (736211980, 377679571, 377679572):
                f["name"] = "Main Grandstand — Gradas 1/2"
                f["seatColor"] = [.44, .46, .44]
                f["roofColor"] = photographic_colors["mainCanopy"]
                f["roofColorSource"] = "official main grandstand balcony photograph reviewed fabric canopy ROI"
                f["coveredRearFraction"] = .95
            elif 490900 < min(p[0] for p in f["world"]) < 491200 and max(p[1] for p in f["world"]) > 2145330:
                # The 2019 baseball-stadium terraces cannot use 2018 construction colors.
                f["seatColor"] = [.49, .52, .51]
                f["roofColor"] = [.92, .92, .90]
                f["roofColorSource"] = "current OSM stadium roof:colour=white; private current-footprint comparison"
                # The separately mapped Tridente roof supersedes this generic
                # curved canopy, which would otherwise duplicate the roof.
                f["coveredRearFraction"] = 0
            if f["id"] == 1309442839:
                f["name"] = "Grada 6 — T4/T5"
                f["seatColor"] = [.62, .64, .63]
                f["roofColor"] = [.89, .89, .86]
                f["coveredRearFraction"] = .85
            grandstands.append(f)
    event_stands, surfaces = event_infrastructure()
    grandstands.extend(event_stands)
    field_color = next(sample for sample in color_audit["sources"] if sample["id"] == "baseballField")
    surfaces.append({"id": "baseball-field-828705073", "osmWayId": 828705073,
                     "name": "El Diamante de Fuego — artificial turf",
                     "world": features[828705073]["world"],
                     "color": photographic_colors["baseballField"],
                     "colorSource": field_color["file"] + " reviewed artificial-turf ROI median",
                     "colorSourceSha256": field_color["sha256"],
                     "accuracy": "current OSM pitch footprint; photographic color, not calibrated reflectance"})
    frontage = [nearest(pit, pit_distances, p)[1] for p in features[377679570]["world"]]
    raster_metadata = {
        "bounds": BOUNDS, "verticalDatum": "EGM2008 EPSG:3855", "verticalExaggeration": 1,
        "stadiumGrading": stadium_grading,
        "rasters": {"dtm": {"width": width, "height": height, "minimum": float(graded.min()),
                               "maximum": float(graded.max()), "mean": float(graded.mean()),
                               "sourceResolutionMeters": SOURCE_RESOLUTION_METERS, "sampleStepMeters": 4}},
        "roadGrading": {"reference": "GEDTM30 native elevations; normalized Gaussian sigma 90 m (three native cells), absolute mean preserved; no height scaling or grade clipping",
                        "smoothing": profiles[0]["smoothing"],
                        "mainProfile": profile_statistics(profiles[0]),
                        "pitProfile": profile_statistics(profiles[1]),
                        "visualReconstruction": True,
                        "fullGradeHalfWidthMeters": FULL_GRADE_HALF_WIDTH_METERS,
                        "blendOuterHalfWidthMeters": GRADE_BLEND_OUTER_HALF_WIDTH_METERS,
                        "gradedRasterSamples": int(np.sum(separation < GRADE_BLEND_OUTER_HALF_WIDTH_METERS))},
        "terrainSurface": {"style": "licensed registered satellite", "source": "Planet SkySat 2018-06-04",
                           "sourceDate": "2018-06-04", "textureWidth": aerial.width, "textureHeight": aerial.height,
                           "resolutionMeters": registration["referencePixelGridSpacingMeters"],
                           "registrationRmsMeters": registration["inlierRmsMeters"],
                           "registrationInliers": registration["inlierCount"],
                           "licence": "CC BY-SA 4.0", "attribution": "© 2018 Planet Labs, Inc. / SkySat",
                           "allOutputPixelsCovered": True},
    }
    write_json(PREPARED / "raster-metadata.json", raster_metadata)
    derived_sources = []
    for path, role, license_name in [
        (ROOT / "docs/track-model-mexico-skysat-registration.json", "reviewed pinned affine georegistration", "RaceSide generated audit"),
        (ROOT / "docs/track-model-mexico-building-colours.json", "reviewed photographic material-color samples", "RaceSide generated audit; photographs reference only"),
        (PREPARED / "mexico-orthophoto.jpg", "registered licensed ground/roof texture", "CC BY-SA 4.0"),
        (PREPARED / "mexico-dtm.f32le", "DTM with smoothed driving corridors", "CC BY 4.0"),
    ]:
        data = path.read_bytes()
        derived_sources.append({"file": str(path.relative_to(ROOT)), "role": role, "license": license_name,
                                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                "bbox": BOUNDS, "crs": "EPSG:32614"})
    # Preserve independently reviewed geometric references from the lock, and
    # refresh only the resources generated by this preparation pass.
    pinned_derived.update({item["file"]: item for item in derived_sources})
    manifest["derivedResources"] = list(pinned_derived.values())
    config = {
        "schemaVersion": 4, "generatorVersion": "1.0.0", "sourceDirectory": str(SOURCE),
        "sourceManifest": manifest, "vectors": vectors,
        "mappedTrees": trees, "grandstands": grandstands, "surfacePolygons": surfaces,
        "stadiumGrading": stadium_grading,
        "baseballStadiumRoof": {"osmWayId": 828705077, "parentStadiumWayId": 827822088,
                                "overallHeightMeters": 35,
                                "heightSource": "official Diablos Rojos museum SALA-2.pdf page 7",
                                "heightSourceUrl": "https://museodiablos.com.mx/wp-content/uploads/2025/08/SALA-2.pdf",
                                "heightSourceInterpretation": "35 m canopy reference height; museum does not distinguish peak and eave; used as overall visual reference",
                                "profileAccuracy": "current mapped footprint; folded roof profile and peak/eave allocation approximate"},
        "verticalDatum": "EGM2008 EPSG:3855", "terrainSource": "GEDTM30 v1.1 bare-earth DTM, native approximately 30 m",
        "model": {"id": "mexico", "name": "Autódromo Hermanos Rodríguez", "bounds": BOUNDS,
                  "center": {"x": 490550, "y": 2145270}, "lapLengthMeters": OFFICIAL_LENGTH,
                  "centerline": line, "pitCenterline": pit, "mainCircuitWayIds": MAIN_WAYS,
                  "pitLaneWayIds": PIT_WAYS, "pitBoxes": 33, "trackWidthMeters": 12, "pitLaneWidthMeters": 8,
                  "pitFrontageDistancesMeters": [min(frontage), max(frontage)], "pitGarageSide": -1,
                  "turns": turns, "sourceStartFinishOffsetMeters": finish_offset,
                  "raceStartDistanceMeters": nearest(line, distances, nodes[str(RACE_START_NODE)])[1]},
        "officialControlPoints": {"referenceYear": 2025, "currentEventVerified": False,
                                  "document": "FIA Mexico City GP 2025, Document 3 V2, circuit/pit maps",
                                  "sectorBoundaryDistancesMeters": [turns[3]["distanceMeters"] - 136,
                                                                      turns[11]["distanceMeters"] - 242],
                                  "speedTrapDistanceMeters": turns[0]["distanceMeters"] - 234,
                                  "pitBoxes": 33, "finishNodeId": FINISH_NODE,
                                  "finishPlacementMethod": "current OSM F1 relation finish node on main raceway, reviewed against FIA map",
                                  "finishGapMeters": finish_gap, "pitEndpointGapMeters": pit_gaps},
        "limitations": [
            "FIA 2026 Mexico event notes are not available before the late-October event; 2025 controls and 33 garage places remain provisional for 2026.",
            "Licensed ground imagery is Planet SkySat from 2018-06-04, not current orthophotography. Current OSM and 2026 promoter map control modeled infrastructure.",
            "GEDTM30 is a machine-learning bare-earth reconstruction with approximately 30 m native cells, not a road engineering survey. Elevation amplitudes are not rescaled.",
            "Terrain driving corridors blend to a smoothed source road profile to prevent surface breakthroughs; this is a visual reconstruction.",
            "Road elevations use a normalized Gaussian sigma of 90 m (three native GEDTM30 cells), with approximately 270 m support on each side, to suppress unresolved short DEM oscillations. This preserves the closed-lap absolute mean and broad elevation trends without height scaling or grade clipping. The road is not a surveyed elevation profile; smoothing reduces source extrema, and the 16 m full-grade / 32 m outer-blend corridor keeps the coarse rendered terrain below it.",
            "Historical official F1 notes give approximately 2.8 m total circuit elevation change, but this is not a 2026 survey and is not used to rescale the source. Recent team notes describe real pavement bumps; a native 30 m global DTM cannot locate or measure those surface irregularities, which are not invented in this model.",
            "Closely parallel pit/main roads share the main source elevation profile within 30 m, blending out to 40 m; native 30 m DTM cannot resolve their independent crossfall.",
            "OSM footprint positions are current; untagged heights use a disclosed two-storey estimate. No national LoD2 roof or facade survey was available.",
            "The main grandstand canopy colors come from current-ticket-page photographs; photographed RGB is not calibrated reflectance. Its canopy height, rear coverage and row geometry remain estimates.",
            "The GNP stadium uses a pinned hand-traced 2024 author-plan reference registered to three geographic controls, not a surveyed construction model. The architect interview publishes 58 roof trusses and a 24 m cantilever. The modeled 12 lower and 32 upper seating rows are approximate plan readings; risers, seat spacing, rear roof projection, structural sections and approximately 31.5 m roof level are visual estimates, not confirmed height or engineering surveys. Daylight photographs guide roof and steel colors without calibrated reflectance.",
            "Two temporary T1 bleacher footprints are corroborated by the official 2026 promoter map and hand-traced aerial boundaries; dimensions/rows are estimates. Event stands without corroborated metric footprints are omitted.",
            "The east T12–T13 stadium Paddock Club frontage is traced from the registered author plan and corroborated by official 2025 event photographs. Its two balcony levels, light canopy, seats, steel frames and north returning concourse are visual reconstructions; exact deck heights and connection dimensions are not measured construction data.",
            "Stadium blue/green paint follows the current-ticket-page 2025 event photograph; its apron boundaries are reconstructed manually, not an exact surveyed paint mask.",
            "The stadium apron and stands share a reconstructed level platform, using a weighted mean of the local smoothed road elevations. Road and terrain approach it through a smooth outer transition, without changing the closed-lap mean or scaling heights. The platform datum and flatness are visual reconstruction constraints, not surveyed levels.",
            "The 2019 baseball stadium uses its current OSM Tridente roof and pitch footprints, white PTFE material and source-reviewed artificial-turf color instead of 2018 construction colors. The official museum gives a 35 m canopy reference height without distinguishing peak/eave; this is used as the overall visual height, and the uncorroborated OSM roof:height=60 is rejected. Folded roof profile and structural details are approximate, not a surveyed roof model; field RGB from a photograph under stadium lighting is not calibrated daylight reflectance.",
            "Image-registration RMS is an internal fit residual, not independently surveyed absolute accuracy.",
            "Small tents, containers, service vehicles and spectators are omitted. Unverified motorhomes are not invented.",
        ],
    }
    write_json(ROOT / ".track-model-build/mexico.json", config)
    write_json(PREPARED / "geometry-audit.json", {
        "lengthMeters": total, "officialLengthMeters": OFFICIAL_LENGTH,
        "errorPercent": abs(total - OFFICIAL_LENGTH) / OFFICIAL_LENGTH * 100,
        "closed": math.dist(line[0], line[-1]) < .05, "finishGapMeters": finish_gap,
        "turnDistancesMeters": [t["distanceMeters"] for t in turns], "pitGapsMeters": pit_gaps,
        "roadElevationRangeMeters": [min(profiles[0]["elevationMeters"]), max(profiles[0]["elevationMeters"])],
        "mappedFeatures": len(vectors), "mappedTrees": len(trees), "grandstands": len(grandstands),
    })
    print(json.dumps({"lengthMeters": total, "errorPercent": abs(total - OFFICIAL_LENGTH) / OFFICIAL_LENGTH * 100,
                      "turns": len(turns), "pitGapsMeters": pit_gaps, "features": len(vectors),
                      "grandstands": len(grandstands), "dtmRangeMeters": [float(graded.min()), float(graded.max())]}))


if __name__ == "__main__":
    prepare()
