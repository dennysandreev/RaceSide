#!/usr/bin/env python3
"""Prepare georeferenced Circuit of The Americas data for Blender."""

from array import array
from bisect import bisect_right
import json
import math
from pathlib import Path
from statistics import median
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/austin-source"
PREPARED = ROOT / ".track-model-build/austin-prepared"
BOUNDS = {"minX": 630350, "minY": 3333600, "maxX": 632750, "maxY": 3335300}
MAIN_WAYS = [
    118258939, 118258950, 118258954, 118258956, 514758200,
    514820043, 514820041, 118258930, 118258958, 118258962,
    118258931, 118258929, 118258946, 118258935, 118258951,
    118258940, 118258942, 118258947, 118258943, 118258961,
    118258928, 514836010, 118258933, 118258937, 118258952,
    514836011, 118256423, 118258957, 118258959,
]
PIT_WAY = 514836373
OFFICIAL_LENGTH = 5513


def building_roof_color(aerial, polygon):
    """Sample roof pixels inside an OSM footprint, excluding its mixed edge pixels."""
    width, height = aerial.size
    pixels = [((point[0]-BOUNDS["minX"])/(BOUNDS["maxX"]-BOUNDS["minX"])*(width-1),
               (BOUNDS["maxY"]-point[1])/(BOUNDS["maxY"]-BOUNDS["minY"])*(height-1))
              for point in polygon]
    left = max(0, int(min(point[0] for point in pixels))-2)
    top = max(0, int(min(point[1] for point in pixels))-2)
    right = min(width, math.ceil(max(point[0] for point in pixels))+3)
    bottom = min(height, math.ceil(max(point[1] for point in pixels))+3)
    mask = Image.new("L", (right-left, bottom-top))
    ImageDraw.Draw(mask).polygon([(x-left, y-top) for x, y in pixels], fill=255)
    interior = mask.filter(ImageFilter.MinFilter(5)) if min(mask.size) >= 5 else mask
    if not interior.getbbox():
        interior = mask
    roof = aerial.crop((left, top, right, bottom))
    samples = [color for color, included in zip(roof.getdata(), interior.getdata()) if included]
    if not samples:
        raise ValueError("Mapped Austin building has no sampled roof pixels")
    return [round(median(channel)/255, 4) for channel in zip(*samples)]


def utm14(lat, lon):
    """WGS84 to EPSG:32614, with metre coordinates retained in scene data."""
    major = 6378137.0
    flattening = 1 / 298.257223563
    eccentricity = flattening * (2 - flattening)
    secondary = eccentricity / (1 - eccentricity)
    latitude = math.radians(lat)
    longitude = math.radians(lon + 99)
    sine, cosine = math.sin(latitude), math.cos(latitude)
    tangent = math.tan(latitude)
    n = major / math.sqrt(1 - eccentricity * sine * sine)
    t, c, a = tangent * tangent, secondary * cosine * cosine, cosine * longitude
    m = major * (
        (1 - eccentricity / 4 - 3 * eccentricity**2 / 64 - 5 * eccentricity**3 / 256) * latitude
        - (3 * eccentricity / 8 + 3 * eccentricity**2 / 32 + 45 * eccentricity**3 / 1024) * math.sin(2 * latitude)
        + (15 * eccentricity**2 / 256 + 45 * eccentricity**3 / 1024) * math.sin(4 * latitude)
        - 35 * eccentricity**3 / 3072 * math.sin(6 * latitude)
    )
    return [
        500000 + .9996 * n * (a + (1 - t + c) * a**3 / 6 + (5 - 18 * t + t*t + 72*c - 58*secondary) * a**5 / 120),
        .9996 * (m + n * tangent * (a*a / 2 + (5 - t + 9*c + 4*c*c) * a**4 / 24 + (61 - 58*t + t*t + 600*c - 330*secondary) * a**6 / 720)),
    ]


def cumulative(line):
    result = [0.0]
    for a, b in zip(line, line[1:]):
        result.append(result[-1] + math.dist(a, b))
    return result


def sample(line, distances, offset):
    offset = max(0, min(offset, distances[-1]))
    i = min(max(1, bisect_right(distances, offset)), len(line) - 1)
    blend = (offset - distances[i-1]) / max(distances[i] - distances[i-1], 1e-9)
    return [line[i-1][axis] * (1-blend) + line[i][axis] * blend for axis in (0, 1)]


def nearest(line, distances, point):
    best = (math.inf, 0.0)
    for i, (a, b) in enumerate(zip(line, line[1:])):
        dx, dy = b[0]-a[0], b[1]-a[1]
        t = max(0, min(1, ((point[0]-a[0])*dx + (point[1]-a[1])*dy) / max(dx*dx+dy*dy, 1e-9)))
        gap = math.hypot(point[0]-a[0]-t*dx, point[1]-a[1]-t*dy)
        if gap < best[0]:
            best = (gap, distances[i] + t * (distances[i+1]-distances[i]))
    return best


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = {node.get("id"): utm14(float(node.get("lat")), float(node.get("lon"))) for node in root.findall("node")}
    features = {}
    for way in root.findall("way"):
        tags = {tag.get("k"): tag.get("v") for tag in way.findall("tag")}
        features[int(way.get("id"))] = {
            "id": int(way.get("id")), "tags": tags,
            "world": [nodes[node.get("ref")] for node in way.findall("nd")],
        }
    trees = [nodes[node.get("id")] for node in root.findall("node")
             if any(tag.get("k") == "natural" and tag.get("v") == "tree" for tag in node.findall("tag"))]
    return features, trees


def raster_sample(values, width, height, point):
    x = max(0, min(width-1.001, (point[0]-BOUNDS["minX"])/(BOUNDS["maxX"]-BOUNDS["minX"])*(width-1)))
    y = max(0, min(height-1.001, (BOUNDS["maxY"]-point[1])/(BOUNDS["maxY"]-BOUNDS["minY"])*(height-1)))
    ix, iy = int(x), int(y)
    tx, ty = x-ix, y-iy
    return (values[iy*width+ix]*(1-tx)*(1-ty) + values[iy*width+ix+1]*tx*(1-ty)
            + values[(iy+1)*width+ix]*(1-tx)*ty + values[(iy+1)*width+ix+1]*tx*ty)


def profile(line, source, width, height, closed):
    distances = cumulative(line)
    count = math.ceil(distances[-1])
    steps = [distances[-1] * i/count for i in range(count+1)]
    measured = [raster_sample(source, width, height, sample(line, distances, d)) for d in steps]
    weights = [math.exp(-.5*(i/8)**2) for i in range(-24, 25)]
    divisor = sum(weights)
    smooth = []
    for i in range(count+1):
        smooth.append(sum(weights[j+24]*measured[(i+j) % count if closed else max(0, min(count, i+j))]
                          for j in range(-24, 25)) / divisor)
    if closed:
        smooth[-1] = smooth[0]
    return {"distanceMeters": steps, "elevationMeters": smooth, "stepMeters": distances[-1]/count}


def grade_terrain(source, width, height, paths, profiles):
    separation = array("f", [math.inf]) * (width*height)
    grades = array("f", [0]) * (width*height)
    for path, elevations in zip(paths, profiles):
        distances = cumulative(path)
        count = math.ceil(distances[-1]/4)
        for i in range(count):
            da, db = distances[-1]*i/count, distances[-1]*(i+1)/count
            a, b = sample(path, distances, da), sample(path, distances, db)
            dx, dy = b[0]-a[0], b[1]-a[1]
            length2 = max(dx*dx+dy*dy, 1e-9)
            left = max(0, int((min(a[0],b[0])-24-BOUNDS["minX"])/4))
            right = min(width-1, int((max(a[0],b[0])+24-BOUNDS["minX"])/4)+1)
            top = max(0, int((BOUNDS["maxY"]-max(a[1],b[1])-24)/4))
            bottom = min(height-1, int((BOUNDS["maxY"]-min(a[1],b[1])+24)/4)+1)
            for row in range(top, bottom+1):
                y = BOUNDS["maxY"] - row*4
                for col in range(left, right+1):
                    x = BOUNDS["minX"] + col*4
                    t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/length2))
                    gap = math.hypot(x-a[0]-t*dx, y-a[1]-t*dy)
                    index = row*width+col
                    if gap < separation[index]:
                        distance = da + t*(db-da)
                        j = min(int(distance/elevations["stepMeters"]), len(elevations["elevationMeters"])-2)
                        blend = (distance-elevations["distanceMeters"][j]) / (elevations["distanceMeters"][j+1]-elevations["distanceMeters"][j])
                        separation[index] = gap
                        grades[index] = elevations["elevationMeters"][j]*(1-blend) + elevations["elevationMeters"][j+1]*blend
    target = array("f", source)
    for i, gap in enumerate(separation):
        if gap < 24:
            weight = min(1, max(0, (24-gap)/14))
            weight = weight*weight*(3-2*weight)
            target[i] = source[i]*(1-weight)+grades[i]*weight
    return target, separation


def prepare():
    PREPARED.mkdir(parents=True, exist_ok=True)
    features, trees = read_osm()
    line = []
    for ident in MAIN_WAYS:
        points = features[ident]["world"]
        if line and math.dist(line[-1], points[0]) > .05:
            raise ValueError(f"Disconnected Austin main circuit at OSM way {ident}")
        line.extend(points if not line else points[1:])
    if math.dist(line[0], line[-1]) > .05:
        raise ValueError("Austin source centreline is not closed")
    source_length = cumulative(line)[-1]
    if abs(source_length-OFFICIAL_LENGTH)/OFFICIAL_LENGTH > .005:
        raise ValueError(f"Austin OSM length {source_length:.3f} differs from FIA by over 0.5%")

    # The official FIA control line is opposite the mapped pit-garage frontage.
    garage = features[376713391]["world"][:-1]
    garage_center = [sum(point[axis] for point in garage)/len(garage) for axis in (0, 1)]
    finish_gap, finish_offset = nearest(line, cumulative(line), garage_center)
    distances = cumulative(line)
    finish = sample(line, distances, finish_offset)
    split = bisect_right(distances, finish_offset)
    line = [finish, *line[split:-1], *line[:split], finish]
    distances = cumulative(line)
    turns = []
    for number in range(1, 21):
        segment = next(feature for feature in features.values()
                       if feature["tags"].get("highway") == "raceway" and feature["tags"].get("name") == f"Turn {number}")
        points = segment["world"]
        apex = sample(points, cumulative(points), cumulative(points)[-1]/2)
        _, offset = nearest(line, distances, apex)
        turns.append({"number": number, "distanceMeters": offset, "sourceWayId": segment["id"],
                      "anchorSide": -1 if number in (1, 3, 5, 7, 9, 11, 12, 15, 17, 19) else 1})
    if any(a["distanceMeters"] >= b["distanceMeters"] for a, b in zip(turns, turns[1:])):
        raise ValueError("Austin turn numbering is out of driving order")
    pit = features[PIT_WAY]["world"]
    pit_gaps = [nearest(line, distances, point)[0] for point in (pit[0], pit[-1])]
    if max(pit_gaps) > 25:
        raise ValueError(f"Austin pit entry/exit is too far from the raceway: {pit_gaps}")

    with Image.open(SOURCE / "usgs-dtm.tif") as source_image:
        if source_image.mode != "F" or source_image.size != (2400, 1700):
            raise ValueError("USGS Austin DEM format or extent changed")
        raw_image = source_image.resize((601, 426), Image.Resampling.BILINEAR)
        raw = array("f", raw_image.tobytes())
    if sys.byteorder != "little":
        raw.byteswap()
    if not all(math.isfinite(z) and 100 < z < 250 for z in raw):
        raise ValueError("USGS Austin DEM has invalid heights")
    raw.tofile((PREPARED / "austin-source-dtm.f32le").open("wb"))
    profiles = [profile(path, raw, 601, 426, closed) for path, closed in ((line, True), (pit, False))]
    graded, separation = grade_terrain(raw, 601, 426, (line, pit), profiles)
    graded.tofile((PREPARED / "austin-dtm.f32le").open("wb"))
    refinement = []
    for row in range(170):
        south = 170-row-1
        top = max(0, int(south*2.5)-1)
        bottom = min(425, math.ceil((south+1)*2.5)+1)
        cells = []
        for col in range(240):
            left = max(0, int(col*2.5)-1)
            right = min(600, math.ceil((col+1)*2.5)+1)
            cells.append(any(separation[y*601+x] < 24 for y in range(top,bottom+1)
                             for x in range(left,right+1)))
        refinement.append(cells)
    (PREPARED / "austin-terrain-refinement.json").write_text(json.dumps(refinement))
    (PREPARED / "austin-road-profiles.json").write_text(json.dumps(profiles))
    with Image.open(SOURCE / "ortho.jpg") as image:
        if image.size != (3900, 2763):
            raise ValueError("NAIP Austin ortho export size changed")
        aerial = image.convert("RGB")
        building_colors = {
            str(feature["id"]): building_roof_color(aerial, feature["world"][:-1])
            for feature in features.values()
            if "building" in feature["tags"] and feature["tags"]["building"] != "grandstand"
            and len(feature["world"]) >= 4
            and all(BOUNDS["minX"] <= point[0] <= BOUNDS["maxX"]
                    and BOUNDS["minY"] <= point[1] <= BOUNDS["maxY"] for point in feature["world"])
        }
        (PREPARED / "austin-building-colors.json").write_text(json.dumps(building_colors, separators=(",", ":")) + "\n")
        image.save(PREPARED / "austin-orthophoto.jpg", quality=85, subsampling=2)
    raster_metadata = {"rasters": {"dtm": {"width": 601, "height": 426,
                        "minimum": min(graded), "maximum": max(graded), "mean": sum(graded)/len(graded),
                        "sourceResolutionMeters": 1, "sampleStepMeters": 4}},
                       "roadGrading": {"reference": "USGS centreline, Gaussian sigma 8 m",
                                       "fullGradeHalfWidthMeters": 10, "blendOuterHalfWidthMeters": 24,
                                       "refinedCells": sum(sum(row) for row in refinement),
                                       "terrainGridMeters": [5,10]},
                       "terrainSurface": {"style": "orthophoto", "source": "Texas Geographic Information Office / USDA NAIP 2022",
                                          "textureWidth": 3900, "textureHeight": 2763, "resolutionMeters": 2400/3900}}
    (PREPARED / "raster-metadata.json").write_text(json.dumps(raster_metadata, indent=2) + "\n")
    in_bounds = lambda p: BOUNDS["minX"] <= p[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= p[1] <= BOUNDS["maxY"]
    vectors = [feature for feature in features.values() if feature["world"] and all(in_bounds(point) for point in feature["world"])]
    config = {"schemaVersion": 4, "generatorVersion": "1.0.0", "sourceDirectory": str(SOURCE),
              "sourceManifest": json.loads((SOURCE / "source-manifest.json").read_text()),
              "vectors": vectors, "venueOutline": features[113586692]["world"],
              "mappedTrees": [tree for tree in trees if in_bounds(tree)],
              "model": {"id": "austin", "bounds": BOUNDS,
                        "center": {"x": 631550, "y": 3334450},
                        "lapLengthMeters": OFFICIAL_LENGTH, "centerline": line,
                        "pitCenterline": pit, "mainCircuitWayIds": MAIN_WAYS, "pitLaneWayIds": [PIT_WAY],
                        "pitBoxes": 34, "trackWidthMeters": 15, "pitLaneWidthMeters": 8, "turns": turns,
                        "sourceStartFinishOffsetMeters": finish_offset},
              "officialControlPoints": {"referenceYear": 2025, "currentEventVerified": False,
                         "document": "FIA United States GP 2025 Document 4, circuit and pit lane maps",
                         "sectorBoundaryDistancesMeters": [turns[6]["distanceMeters"]-55, turns[12]["distanceMeters"]-65],
                         "speedTrapDistanceMeters": turns[11]["distanceMeters"]-180,
                         "pitBoxes": 34, "finishPlacementMethod": "nearest raceway point opposite OSM pit garage centroid",
                         "finishGarageSeparationMeters": finish_gap,
                         "pitEndpointGapMeters": pit_gaps},
              "limitations": [
                  "FIA 2026 event notes are not published before the October event; 2025 control and garage placement is provisional.",
                  "NAIP 2022 shows the permanent venue outside race week; temporary 2026 structures without geolocated evidence are omitted.",
                  "USGS 3DEP bare-earth DEM is resampled to 4 m, then the driving corridor is graded to the smoothed centreline profile; this is a visual reconstruction, not a road survey.",
                  "OSM building footprints are current; roofs use NAIP 2022 pixels, while roof forms, facade colors and heights without height tags are photographic estimates, not LoD2 survey.",
                  "Grand Plaza seating tiers, fence-post spacing, gate heights, bridge supports and start-light housings use mapped positions but estimated construction details.",
                  "FIA control line is estimated opposite mapped garages; no surveyed start/finish coordinate is available.",
                  "Small tents, containers, parked vehicles and spectators are omitted.",
              ]}
    (ROOT / ".track-model-build/austin.json").write_text(json.dumps(config, indent=2) + "\n")
    print(json.dumps({"lengthMeters": source_length, "errorPercent": abs(source_length-OFFICIAL_LENGTH)/OFFICIAL_LENGTH*100,
                      "turns": len(turns), "pitGapsMeters": pit_gaps, "finishOffsetMeters": finish_offset,
                      "dtmRangeMeters": [min(graded), max(graded)]}))


if __name__ == "__main__":
    prepare()
