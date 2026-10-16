#!/usr/bin/env python3
"""Prepare Interlagos in native SIRGAS/UTM metres from locked PMSP sources."""

from array import array
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import laspy
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/interlagos-source"
PREPARED = ROOT / ".track-model-build/interlagos-prepared"
SETTINGS = json.loads((ROOT / "docs/track-model-interlagos-config.json").read_text())
BOUNDS = SETTINGS["bounds"]
spec = importlib.util.spec_from_file_location("road_preparation", Path(__file__).with_name("prepare-austin-model.py"))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
helpers.BOUNDS = BOUNDS


def project(lat, lon):
    # The established WGS84 UTM implementation, with zone 23 and southern
    # false northing. WGS84/GRS80 differs below the source's decimetre precision.
    x, y = helpers.utm14(lat, lon - 54)
    return [x, y + 10_000_000]


def closed_from_finish(line, point):
    cum = helpers.cumulative(line)
    gap, distance = helpers.nearest(line, cum, point)
    if gap > 2:
        raise ValueError(f"Mapped finish is {gap:.2f} m from the circuit")
    start = helpers.sample(line, cum, distance)
    index = next(i for i, d in enumerate(cum) if d > distance)
    return [start] + line[index:-1] + line[:index] + [start]


def correct_turn10(features):
    path = ROOT / "docs/track-model-interlagos-t10-corridor.json"
    correction = json.loads(path.read_text())
    if hashlib.sha256((SOURCE/correction["sourceFile"]).read_bytes()).hexdigest() != correction["sourceSha256"]:
        raise ValueError("T10 edge trace does not match the locked orthophoto")
    feature = features[correction["wayId"]]
    original = feature["world"]
    distances = helpers.cumulative(original)
    stations = correction["stations"]
    indices = [station["sourceNodeIndex"] for station in stations]
    if indices != sorted(set(indices)) or indices[0] != 0 or indices[-1] != len(original)-1:
        raise ValueError("T10 edge stations must span its unchanged OSM endpoints")
    centres = [[(a+b)/2 for a, b in zip(station["innerEdgeWorld"], station["outerEdgeWorld"])] for station in stations]
    offsets = np.array(centres) - np.array([original[i] for i in indices])
    offsets[0] = offsets[-1] = 0
    station_distances = [distances[i] for i in indices]
    corrected = np.array(original) + np.column_stack([
        np.interp(distances, station_distances, offsets[:, axis]) for axis in (0, 1)
    ])
    feature["world"] = corrected.tolist()
    widths = [math.dist(station["innerEdgeWorld"], station["outerEdgeWorld"]) for station in stations]
    return {"reference": "docs/track-model-interlagos-t10-corridor.json",
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "source": correction, "world": [feature["world"][i] for i in indices],
            "widthMeters": widths,
            "apexWorld": feature["world"][correction["turnAnchorSourceNodeIndex"]],
            "maximumCentreShiftMeters": float(np.linalg.norm(offsets, axis=1).max())}


def read_geometry():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = {int(n.get("id")): project(float(n.get("lat")), float(n.get("lon"))) for n in root.findall("node")}
    features = {}
    for way in root.findall("way"):
        refs = [int(n.get("ref")) for n in way.findall("nd")]
        if not all(ref in nodes for ref in refs):
            continue
        features[int(way.get("id"))] = {"id": int(way.get("id")), "world": [nodes[ref] for ref in refs],
                                      "tags": {t.get("k"): t.get("v") for t in way.findall("tag")}}
    correction = correct_turn10(features)
    relation = next(r for r in root.findall("relation") if int(r.get("id")) == SETTINGS["circuitRelationId"])
    way_ids = [int(m.get("ref")) for m in relation.findall("member") if m.get("type") == "way" and not m.get("role")]
    line = []
    for identifier in way_ids:
        points = features[identifier]["world"]
        if line and math.dist(line[-1], points[0]) > .05:
            raise ValueError(f"Circuit relation is disconnected at way {identifier}")
        line.extend(points if not line else points[1:])
    if math.dist(line[0], line[-1]) > .05:
        raise ValueError("Circuit relation is not closed")
    line = closed_from_finish(line, nodes[SETTINGS["finishNodeId"]])
    cum = helpers.cumulative(line)
    if abs(cum[-1] - SETTINGS["officialLengthMeters"]) / SETTINGS["officialLengthMeters"] > .005:
        raise ValueError(f"Interlagos centreline length outside tolerance: {cum[-1]}")
    turns = []
    for identifier in way_ids:
        feature = features[identifier]
        number = feature["tags"].get("raceway:corner_number")
        if not number:
            continue
        points = feature["world"]
        # Pick the mapped apex rather than a screen coordinate. The sharpest
        # change in the interior of a named corner way is its geographic apex.
        candidates = []
        for a, b, c in zip(points, points[1:], points[2:]):
            u, v = np.subtract(b, a), np.subtract(c, b)
            angle = math.acos(max(-1, min(1, float(np.dot(u, v)) / max(np.linalg.norm(u)*np.linalg.norm(v), 1e-9))))
            candidates.append((angle, b))
        apex = max(candidates, key=lambda item: item[0])[1] if candidates else points[len(points)//2]
        if identifier == correction["source"]["wayId"]:
            apex = correction["apexWorld"]
        turns.append({"number": int(number), "distanceMeters": helpers.nearest(line, cum, apex)[1], "sourceWayId": identifier})
    turns.sort(key=lambda item: item["number"])
    if [t["number"] for t in turns] != list(range(1, 16)) or any(a["distanceMeters"] >= b["distanceMeters"] for a, b in zip(turns, turns[1:])):
        raise ValueError(f"Invalid Interlagos corner sequence: {turns}")
    pit = features[SETTINGS["pitWayId"]]["world"]
    # Both geographic branches terminate exactly on the racing centreline.
    for index in (0, -1):
        gap, distance = helpers.nearest(line, cum, pit[index])
        if gap > 20:
            raise ValueError(f"Disconnected pit endpoint: {gap}")
        pit[index] = helpers.sample(line, cum, distance)
    controls = {**SETTINGS["officialControlPoints"],
                "sectorBoundaryDistancesMeters": [turns[3]["distanceMeters"]-168, turns[11]["distanceMeters"]-85],
                "speedTrapDistanceMeters": turns[0]["distanceMeters"]-90,
                "raceStartDistanceMeters": helpers.nearest(line, cum, nodes[SETTINGS["raceStartNodeId"]])[1]}
    vectors = [f for f in features.values() if any(BOUNDS["minX"] <= p[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= p[1] <= BOUNDS["maxY"] for p in f["world"])
               and any(key in f["tags"] for key in ("building", "barrier", "natural", "landuse", "man_made", "highway"))]
    for f in vectors:
        if f["tags"].get("building") == "grandstand":
            f["tags"]["grandstand"] = "yes"
    correction["widthProfile"] = [{"distanceMeters": 0, "widthMeters": SETTINGS["trackWidthMeters"]}] + [
        {"distanceMeters": helpers.nearest(line, cum, point)[1], "widthMeters": width}
        for point, width in zip(correction["world"], correction["widthMeters"])
    ] + [{"distanceMeters": cum[-1], "widthMeters": SETTINGS["trackWidthMeters"]}]
    return line, pit, turns, controls, vectors, correction


def filled(values):
    """Interpolate only no-data cells from adjacent measured ground cells."""
    values = values.copy()
    original_missing = int(np.isnan(values).sum())
    for _ in range(350):
        missing = np.isnan(values)
        if not missing.any():
            return values, original_missing
        padded = np.pad(values, 1, constant_values=np.nan)
        neighbors = np.stack([padded[1:-1, :-2], padded[1:-1, 2:], padded[:-2, 1:-1], padded[2:, 1:-1]])
        counts = np.isfinite(neighbors).sum(axis=0)
        update = missing & (counts > 0)
        values[update] = np.nansum(neighbors, axis=0)[update] / counts[update]
    raise ValueError("LiDAR coverage has an unresolved no-data area")


def prepare():
    PREPARED.mkdir(parents=True, exist_ok=True)
    line, pit, turns, controls, vectors, correction = read_geometry()
    width = (BOUNDS["maxX"]-BOUNDS["minX"])//4+1
    height = (BOUNDS["maxY"]-BOUNDS["minY"])//4+1
    sums, counts = np.zeros(width*height), np.zeros(width*height, dtype=np.int64)
    dsm, vegetation = np.full(width*height, np.nan), np.full(width*height, np.nan)
    ground_points = 0
    for path in sorted(SOURCE.glob("MDS_color_*.laz")):
        cloud = laspy.read(path)
        x, y, z = np.asarray(cloud.x), np.asarray(cloud.y), np.asarray(cloud.z)
        valid = (x >= BOUNDS["minX"]) & (x <= BOUNDS["maxX"]) & (y >= BOUNDS["minY"]) & (y <= BOUNDS["maxY"])
        x, y, z, classification = x[valid], y[valid], z[valid], np.asarray(cloud.classification)[valid]
        indices = np.rint((BOUNDS["maxY"]-y)/4).astype(int)*width+np.rint((x-BOUNDS["minX"])/4).astype(int)
        ground = classification == 2
        np.add.at(sums, indices[ground], z[ground]); np.add.at(counts, indices[ground], 1)
        ground_points += int(ground.sum())
        for target, code in ((dsm, 6), (vegetation, 5)):
            selected = classification == code
            np.fmax.at(target, indices[selected], z[selected])
    values = np.divide(sums, counts, out=np.full(width*height, np.nan), where=counts > 0).reshape(height, width)
    values, missing = filled(values)
    raw = array("f", values.astype("<f4").flatten())
    profiles = [helpers.profile(path, raw, width, height, closed) for path, closed in ((line, True), (pit, False))]
    # Keep the two branches at exactly the same elevation at their joins.
    main = profiles[0]
    for endpoint, sign in ((0, 1), (-1, -1)):
        offset = helpers.nearest(line, helpers.cumulative(line), pit[endpoint])[1]
        elevation = float(np.interp(offset, main["distanceMeters"], main["elevationMeters"]))
        difference = elevation-profiles[1]["elevationMeters"][endpoint]
        n = min(35, len(profiles[1]["elevationMeters"]))
        for j in range(n):
            i = j if sign == 1 else -1-j
            profiles[1]["elevationMeters"][i] += difference*(1-j/n)
    graded, _ = helpers.grade_terrain(raw, width, height, [line, pit], profiles)
    # At close parallel branches the nearest-centreline terrain grade can be
    # higher than the adjacent road. Cap the ground beneath both ribbons;
    # retain the measured longitudinal road heights and original outside land.
    before_cap = np.array(graded)
    width_profile = correction["widthProfile"]
    for path, profile, half_width in zip([line, pit], profiles, [6, 4]):
        distances = helpers.cumulative(path)
        for d in np.arange(0, distances[-1]+1, 3):
            point = helpers.sample(path, distances, min(d, distances[-1]))
            if path is line:
                half_width = float(np.interp(d, [s["distanceMeters"] for s in width_profile], [s["widthMeters"] for s in width_profile]))/2
            elevation = float(np.interp(d, profile["distanceMeters"], profile["elevationMeters"]))
            col = round((point[0]-BOUNDS["minX"])/4)
            row = round((BOUNDS["maxY"]-point[1])/4)
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    r, c = row+dy, col+dx
                    if not (0 <= r < height and 0 <= c < width):
                        continue
                    x, y = BOUNDS["minX"]+c*4, BOUNDS["maxY"]-r*4
                    if math.hypot(x-point[0], y-point[1]) <= half_width+4:
                        index = r*width+c
                        graded[index] = min(graded[index], elevation-.18)
    with (PREPARED/"interlagos-dtm.f32le").open("wb") as handle:
        graded.tofile(handle)
    (PREPARED/"interlagos-road-profiles.json").write_text(json.dumps(profiles))
    aerial = Image.open(SOURCE/"orthophoto-2020.jpg").convert("RGB")
    old = SETTINGS["sourceOrthoBounds"]
    crop = ((BOUNDS["minX"]-old["minX"])/(old["maxX"]-old["minX"])*aerial.width,
            (old["maxY"]-BOUNDS["maxY"])/(old["maxY"]-old["minY"])*aerial.height,
            (BOUNDS["maxX"]-old["minX"])/(old["maxX"]-old["minX"])*aerial.width,
            (old["maxY"]-BOUNDS["minY"])/(old["maxY"]-old["minY"])*aerial.height)
    aerial = aerial.crop(tuple(round(v) for v in crop))
    aerial.save(PREPARED/"interlagos-orthophoto.jpg", quality=90)
    buildings, excluded = [], []
    for feature in json.loads((SOURCE/"buildings.json").read_text())["features"]:
        if feature["geometry"]["type"] != "Polygon":
            continue
        polygon = feature["geometry"]["coordinates"][0]
        if not all(BOUNDS["minX"]+2 < p[0] < BOUNDS["maxX"]-2 and BOUNDS["minY"]+2 < p[1] < BOUNDS["maxY"]-2 for p in polygon):
            continue
        mask = Image.new("L", (width, height))
        ImageDraw.Draw(mask).polygon([((p[0]-BOUNDS["minX"])/4, (BOUNDS["maxY"]-p[1])/4) for p in polygon], fill=255)
        inside = np.asarray(mask).flatten() > 0
        roof_samples = dsm[inside & np.isfinite(dsm)]
        identifier = feature["properties"]["cd_identificador"]
        if len(roof_samples) < 2:
            excluded.append({"id": identifier, "reason": "no LiDAR building support for historical cadastral footprint"})
            continue
        ground = float(np.median(values.flatten()[inside]))
        roof = float(np.percentile(roof_samples, 70))
        if roof-ground < 2:
            excluded.append({"id": identifier, "reason": "LiDAR roof does not stand above ground"})
            continue
        color = helpers.building_roof_color(aerial, polygon)
        if color[1] > color[0]*1.28 and color[1] > color[2]*1.28:
            excluded.append({"id": identifier, "reason": "2020 orthophoto shows vegetation instead of an active roof"})
            continue
        buildings.append({"id": identifier, "world": polygon, "roofElevationMeters": roof,
                          "heightMeters": roof-ground, "roofColor": color,
                          "source": "PMSP cadastral footprint + class-6 LiDAR 2017 + ortho 2020"})
    trees = []
    for row in range(2, height-2, 4):
        for col in range(2, width-2, 4):
            z = vegetation.reshape(height, width)[row, col]
            if np.isfinite(z) and z-values[row, col] > 4:
                trees.append({"world": [BOUNDS["minX"]+col*4, BOUNDS["maxY"]-row*4],
                              "heightMeters": min(25, float(z-values[row, col]))})
    center = {"x": (BOUNDS["minX"]+BOUNDS["maxX"])/2, "y": (BOUNDS["minY"]+BOUNDS["maxY"])/2}
    config = {"model": {"bounds": BOUNDS, "center": center, "centerline": line, "pitCenterline": pit, "turns": turns},
              "settings": SETTINGS, "officialControlPoints": controls, "vectors": vectors,
              "buildings": buildings, "excludedBuildings": excluded, "trees": trees,
              "sourceManifest": json.loads((ROOT/"docs/track-model-interlagos-source-manifest.json").read_text()),
              "roadCorridor": correction,
              "limitations": SETTINGS["limitations"]}
    (ROOT/".track-model-build/interlagos.json").write_text(json.dumps(config, ensure_ascii=False))
    raster_meta = {"rasters": {"dtm": {"width": width, "height": height, "mean": float(values.mean())}},
                   "terrainSurface": {"groundPoints": ground_points, "gridResolutionMeters": 4, "interpolatedNoDataCells": missing,
                                      "remainingNoDataCells": 0, "colorSource": "GeoSampa 2020 RGB orthophoto"},
                   "roadGrading": {"method": "8 m Gaussian profile, terrain capped under both close road branches, no vertical exaggeration",
                                   "maximumCorridorCapMeters": float(np.max(before_cap-np.array(graded)))}}
    (PREPARED/"raster-metadata.json").write_text(json.dumps(raster_meta, indent=2))
    print(json.dumps({"length": helpers.cumulative(line)[-1], "turns": turns, "buildings": len(buildings), "trees": len(trees), "raster": raster_meta}))


if __name__ == "__main__":
    prepare()
