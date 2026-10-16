#!/usr/bin/env python3
"""Prepare Qatar from its own pinned OSM, Sentinel and GEDTM30 sources."""
from bisect import bisect_right
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, box

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/qatar-source"
PREPARED = ROOT / ".track-model-build/qatar-prepared"
SETTINGS = json.loads((ROOT / "docs/track-model-qatar-config.json").read_text())
BOUNDS = SETTINGS["bounds"]


def cumulative(line):
    result = [0.0]
    for a, b in zip(line, line[1:]):
        result.append(result[-1] + math.dist(a, b))
    return result


def sample(line, distances, offset):
    offset = max(0, min(offset, distances[-1]))
    i = min(max(1, bisect_right(distances, offset)), len(line)-1)
    t = (offset-distances[i-1])/max(distances[i]-distances[i-1], 1e-9)
    return [line[i-1][a]*(1-t)+line[i][a]*t for a in (0, 1)]


def assemble(features, ids):
    line = []
    for identifier in ids:
        points = features[identifier]["world"]
        if line and math.dist(line[-1], points[0]) > .05:
            raise ValueError(f"Qatar way {identifier} does not join its predecessor")
        line.extend(points if not line else points[1:])
    return line


def prepare():
    PREPARED.mkdir(parents=True, exist_ok=True)
    tree = ET.parse(SOURCE / "osm.xml").getroot()
    project = Transformer.from_crs("EPSG:4326", SETTINGS["crs"], always_xy=True)
    nodes = {int(n.get("id")): list(project.transform(float(n.get("lon")), float(n.get("lat")))) for n in tree.findall("node")}
    features = {}
    for way in tree.findall("way"):
        refs = [int(n.get("ref")) for n in way.findall("nd")]
        if all(ref in nodes for ref in refs):
            features[int(way.get("id"))] = dict(id=int(way.get("id")), world=[nodes[r] for r in refs],
                tags={t.get("k"): t.get("v") for t in way.findall("tag")})
    line = assemble(features, SETTINGS["mainWayIds"])
    if math.dist(line[0], line[-1]) > .01:
        raise ValueError("Lusail main line is not closed")
    curve = LineString(line)
    finish = nodes[SETTINGS["finishNodeId"]]
    distance = curve.project(Point(finish))
    old_cum = cumulative(line)
    start = sample(line, old_cum, distance)
    index = bisect_right(old_cum, distance)
    line = [start]+line[index:-1]+line[:index]+[start]
    line = [point for i, point in enumerate(line) if i == 0 or math.dist(point, line[i-1]) > .001]
    cum = cumulative(line)
    if abs(cum[-1]-SETTINGS["officialLengthMeters"])/SETTINGS["officialLengthMeters"] > .005:
        raise ValueError("Qatar centreline exceeds FIA length tolerance")
    curve = LineString(line)
    turns = [dict(number=i+1, distanceMeters=curve.project(Point(features[w]["world"][n])),
                  sourceWayId=w, sourceNodeIndex=n) for i, (w, n) in enumerate(SETTINGS["turnNodes"])]
    if [t["distanceMeters"] for t in turns] != sorted(t["distanceMeters"] for t in turns):
        raise ValueError("Qatar turn order is inconsistent with clockwise race direction")
    pit = assemble(features, SETTINGS["pitWayIds"])
    for end in (pit[0], pit[-1]):
        if curve.distance(Point(end)) > .05:
            raise ValueError("Pit entry/exit is disconnected")
    controls = dict(referenceYear=2025, currentEventVerified=False,
        reference="FIA Qatar circuit map V2, 27 November 2025; event map LIC August 2026",
        sectorBoundaryDistancesMeters=[turns[5]["distanceMeters"]-80, turns[11]["distanceMeters"]-75],
        speedTrapDistanceMeters=turns[0]["distanceMeters"]-205, raceStartDistanceMeters=225,
        raceStartMethod="estimated metric registration of the separate FIA race-start symbol; not a surveyed point",
        drsDetectionDistanceMeters=turns[14]["distanceMeters"]+40,
        drsActivationDistanceMeters=(turns[15]["distanceMeters"]+305) % cum[-1])
    stands = []
    for spec in SETTINGS["grandstands"]:
        feature = features[spec["id"]]
        feature["tags"] = {**feature["tags"], "grandstand": "yes", "name": spec["name"], "covered": str(spec["covered"])}
        stands.append(feature)
    for number, spec in enumerate(SETTINGS["reviewedEventStands"]):
        first = spec.get("startMeters", 0)
        last = spec.get("endMeters", 0)
        if spec.get("fromTurn"):
            apex = turns[spec["fromTurn"]-1]["distanceMeters"]
            first, last = apex+spec["startOffsetMeters"], apex+spec["endOffsetMeters"]
        def edge(d, offset):
            a, b = sample(line, cum, d-4), sample(line, cum, d+4)
            length = math.dist(a, b)
            normal = np.array([-(b[1]-a[1]), b[0]-a[0]])/length
            return (np.array(sample(line, cum, d))+normal*offset*spec["side"]).tolist()
        inner = spec["frontOffsetMeters"]
        stations = np.linspace(first, last, max(3, math.ceil((last-first)/12)))
        poly = [edge(d, inner) for d in stations]+[edge(d, inner+spec["depthMeters"]) for d in stations[::-1]]
        poly.append(poly[0])
        feature = dict(id=-100-number, world=poly,
            tags=dict(grandstand="yes", name=spec["name"], covered="False"), evidence=spec)
        features[feature["id"]] = feature
        stands.append(feature)

    # Ground stays a single image material: measured macro colour plus current
    # vector detail, avoiding coplanar surface meshes and z-fighting.
    width, height = 2048, 2270
    transform = from_bounds(BOUNDS["minX"], BOUNDS["minY"], BOUNDS["maxX"], BOUNDS["maxY"], width, height)
    rgb = np.zeros((3, height, width), dtype=np.uint8)
    with rasterio.open(SOURCE/"sentinel-20260930.tif") as source:
        for channel in range(3):
            reproject(rasterio.band(source, channel+1), rgb[channel], src_transform=source.transform,
                src_crs=source.crs, dst_transform=transform, dst_crs=SETTINGS["crs"], resampling=Resampling.bilinear)
    image = Image.fromarray(np.moveaxis(rgb, 0, 2))
    draw = ImageDraw.Draw(image)
    def px(p):
        return ((p[0]-BOUNDS["minX"])/(BOUNDS["maxX"]-BOUNDS["minX"])*width,
                (BOUNDS["maxY"]-p[1])/(BOUNDS["maxY"]-BOUNDS["minY"])*height)
    polygons = lines = 0
    for f in features.values():
        t, points = f["tags"], f["world"]
        if len(points) < 4 or points[0] != points[-1]:
            continue
        colour = None
        if t.get("natural") == "sand":
            colour = (210, 192, 154)
        elif t.get("landuse") in ("grass", "greenery") or t.get("leisure") == "garden":
            colour = (101, 118, 61) if t.get("landuse") == "greenery" else (90, 123, 67)
        if colour:
            draw.polygon([px(p) for p in points], fill=colour)
            polygons += 1
    # All mapped service/parking lanes retain their own geography. Racing
    # ribbons and kerbs are separate physical meshes over this ground image.
    metres_per_pixel = (BOUNDS["maxX"]-BOUNDS["minX"])/width
    for f in features.values():
        t = f["tags"]
        if t.get("highway") in ("service", "unclassified", "footway", "path", "raceway"):
            road_width = 3 if t.get("highway") in ("footway", "path") else 5
            if t.get("highway") == "raceway":
                road_width = 5 if t.get("sport") == "karting" else 12
            draw.line([px(p) for p in f["world"]], fill=(137, 134, 123), width=max(1, round(road_width/metres_per_pixel)), joint="curve")
            lines += 1
    # Retain source variation and add only subpixel mineral/paint grain. This
    # authored texture detail is documented, and is deterministic across builds.
    arr = np.asarray(image).astype(np.int16)
    noise = np.random.default_rng(20261005).integers(-4, 5, (height, width, 1), dtype=np.int16)
    image = Image.fromarray(np.clip(arr+noise, 0, 255).astype(np.uint8))
    image.save(PREPARED/"qatar-ground.jpg", quality=85)

    columns, rows = 167, 185
    dtm_transform = from_bounds(BOUNDS["minX"], BOUNDS["minY"], BOUNDS["maxX"], BOUNDS["maxY"], columns, rows)
    terrain = np.zeros((rows, columns), dtype=np.float32)
    with rasterio.open(SOURCE/"gedtm30-native.tif") as source:
        data = source.read(1).astype(np.float32)*source.scales[0]+source.offsets[0]
        reproject(data, terrain, src_transform=source.transform, src_crs=source.crs,
            dst_transform=dtm_transform, dst_crs=SETTINGS["crs"], resampling=Resampling.bilinear)
    if not np.isfinite(terrain).all() or np.min(terrain) <= 0:
        raise ValueError("Terrain crop contains invalid/no-data elevations")
    terrain = gaussian_filter(terrain, sigma=.9)
    terrain.astype("<f4").tofile(PREPARED/"qatar-dtm.f32le")
    def height_at(points):
        points = np.array(points)
        x = (points[:, 0]-BOUNDS["minX"])/(BOUNDS["maxX"]-BOUNDS["minX"])*(columns-1)
        y = (BOUNDS["maxY"]-points[:, 1])/(BOUNDS["maxY"]-BOUNDS["minY"])*(rows-1)
        return map_coordinates(terrain, [y, x], order=1, mode="nearest")
    profiles = []
    lift = .65
    for path, closed, half_width in [(line, True, 6), (pit, False, 4)]:
        distances = cumulative(path)
        stations = np.linspace(0, distances[-1], math.ceil(distances[-1]/2)+1)
        points = np.array([sample(path, distances, d) for d in stations])
        raw = height_at(points)
        # Smooth one cycle without counting the duplicated closing station.
        if closed:
            smoothed = gaussian_filter1d(raw[:-1], sigma=12, mode="wrap")
            profile = np.append(smoothed, smoothed[0])
        else:
            profile = gaussian_filter1d(raw, sigma=12, mode="nearest")
        profiles.append(dict(distanceMeters=stations.tolist(), elevationMeters=profile.tolist(), maximumSmoothingCorrectionMeters=float(np.max(abs(raw-profile)))))
    # Pit profile meets the main track's physical level exactly at both joins.
    pit_distances = profiles[1]["distanceMeters"]
    pit_heights = np.array(profiles[1]["elevationMeters"])
    for end, direction in [(0, 1), (-1, -1)]:
        d = curve.project(Point(pit[end]))
        target = np.interp(d, profiles[0]["distanceMeters"], profiles[0]["elevationMeters"])
        delta = target-pit_heights[end]
        weights = np.maximum(0, 1-(np.array(pit_distances) if direction==1 else pit_distances[-1]-np.array(pit_distances))/80)
        pit_heights += delta*weights**2
    profiles[1]["elevationMeters"] = pit_heights.tolist()
    # GEDTM30's historic ground estimate cannot describe a graded 12 m-wide
    # asphalt surface. Lower only intersecting terrain in the measured road
    # corridors; retain the source elevations everywhere else. A 20 m margin
    # covers the interpolation support of the 10 m terrain mesh at road edges.
    original_terrain = terrain.copy()
    xs, ys = np.meshgrid(np.linspace(BOUNDS["minX"], BOUNDS["maxX"], columns),
                         np.linspace(BOUNDS["maxY"], BOUNDS["minY"], rows))
    grid_points = np.column_stack([xs.ravel(), ys.ravel()])
    for path, profile, half_width in [(line, profiles[0], 6), (pit, profiles[1], 4)]:
        stations = profile["distanceMeters"]
        points = np.array([sample(path, cumulative(path), d) for d in stations])
        gap, indices = cKDTree(points).query(grid_points)
        target = np.array(profile["elevationMeters"])[indices]-.1
        influence = np.clip((half_width+30-gap)/10, 0, 1)
        current = terrain.ravel()
        terrain = (current-np.maximum(current-target, 0)*influence).reshape(rows, columns).astype(np.float32)
    terrain.astype("<f4").tofile(PREPARED/"qatar-dtm.f32le")
    for profile in profiles:
        profile["elevationMeters"] = [h+lift-.45 for h in profile["elevationMeters"]]
    (PREPARED/"qatar-road-profiles.json").write_text(json.dumps(profiles)+"\n")
    raster_metadata = dict(rasters=dict(dtm=dict(width=columns, height=rows, mean=float(terrain.mean()))),
        terrainSurface=dict(macroColorSource="Copernicus Sentinel-2C 2026-09-30 true colour, 10 m",
            detailSource="current OpenStreetMap ground geometry", currentGroundPolygons=polygons,
            currentGroundLines=lines, textureWidth=width, textureHeight=height,
            detailMethod="mapped material colours plus deterministic authored mineral grain; not high-resolution orthophoto"),
        roadGrading=dict(source="GEDTM30, EGM2008; 24 m profile smoothing", technicalLiftMeters=lift,
            method="lower intersecting historical terrain estimates inside road corridors only",
            maximumTerrainCorrectionMeters=float(np.max(original_terrain-terrain)),
            verticalExaggeration=1, terrainResolutionMeters=30))
    (PREPARED/"raster-metadata.json").write_text(json.dumps(raster_metadata, indent=2)+"\n")
    clip = box(BOUNDS["minX"], BOUNDS["minY"], BOUNDS["maxX"], BOUNDS["maxY"])
    active = []
    for feature in features.values():
        geometry = LineString(feature["world"])
        if not geometry.intersects(clip):
            continue
        # Ways crossing the crop may continue kilometres beyond the venue.
        # Preserve their native line inside the scene instead of exporting
        # unsupported walls far beyond the terrain tile.
        if feature["tags"].get("barrier") in ("wall", "fence", "guard_rail"):
            clipped = geometry.intersection(clip)
            parts = [clipped] if clipped.geom_type == "LineString" else list(getattr(clipped, "geoms", []))
            for part in parts:
                if part.geom_type == "LineString" and part.length > .05:
                    active.append({**feature, "world": [list(p) for p in part.coords]})
        else:
            active.append(feature)
    trees = []
    masts = []
    for node in tree.findall("node"):
        tags = {t.get("k"): t.get("v") for t in node.findall("tag")}
        position = nodes[int(node.get("id"))]
        if not clip.contains(Point(position)):
            continue
        if tags.get("natural") == "tree":
            trees.append(position)
        if tags.get("highway") == "street_lamp" or tags.get("man_made") == "mast":
            masts.append(position)
    config = dict(modelId="qatar", model=dict(center=dict(x=(BOUNDS["minX"]+BOUNDS["maxX"])/2, y=(BOUNDS["minY"]+BOUNDS["maxY"])/2),
        bounds=BOUNDS, centerline=line, pitCenterline=pit, turns=turns),
        vectors=active, trees=trees, masts=masts, settings=SETTINGS, officialControlPoints=controls,
        sourceManifest=json.loads((SOURCE/"source-manifest.json").read_text()), limitations=SETTINGS["limitations"])
    (ROOT/".track-model-build/qatar.json").write_text(json.dumps(config, indent=2, ensure_ascii=False)+"\n")
    print(json.dumps(dict(lengthMeters=cum[-1], turns=turns, controls=controls, lift=lift, features=len(active), trees=len(trees), masts=len(masts))), flush=True)


if __name__ == "__main__":
    prepare()
