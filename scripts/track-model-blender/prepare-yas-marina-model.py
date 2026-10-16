#!/usr/bin/env python3
"""Prepare Yas Marina in native UTM 40N metres; keep source and reconstruction distinct."""
import importlib.util
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
from scipy.ndimage import distance_transform_edt, gaussian_filter, gaussian_filter1d, label, map_coordinates
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/yas-marina-source"
PREPARED = ROOT / ".track-model-build/yas-marina-prepared"
BOUNDS = {"minX": 256530, "minY": 2707520, "maxX": 257930, "maxY": 2709435}
CRS = "EPSG:32640"
MAIN_IDS = [168477013, 1469184731, 1469184732, 188337196, 1255169703, 1255169704]
PIT_IDS = [176695254, 176695255, 176695253]
TURN_VERTICES = [57, 70, 88, 102, 122, 150, 160, 168, 202, 219, 226, 235, 245, 9, 25, 40]

spec = importlib.util.spec_from_file_location("metric_helpers", Path(__file__).with_name("prepare-austin-model.py"))
metric = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metric)
spec = importlib.util.spec_from_file_location("native_axis", Path(__file__).with_name("prepare-las-vegas-model.py"))
axis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(axis)


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    projection = Transformer.from_crs(4326, 32640, always_xy=True)
    nodes = {n.get("id"): list(projection.transform(float(n.get("lon")), float(n.get("lat"))))
             for n in root.findall("node")}
    ways = {}
    for w in root.findall("way"):
        refs = [n.get("ref") for n in w.findall("nd")]
        if all(ref in nodes for ref in refs):
            ways[int(w.get("id"))] = {"id": int(w.get("id")), "refs": refs,
                "world": [nodes[ref] for ref in refs],
                "tags": {t.get("k"): t.get("v") for t in w.findall("tag")}}
    trees = [nodes[n.get("id")] for n in root.findall("node")
             if any(t.get("k") == "natural" and t.get("v") == "tree" for t in n.findall("tag"))]
    lights = [{"osmNodeId": int(n.get("id")), "world": nodes[n.get("id")]}
              for n in root.findall("node") if any(t.get("k") == "highway" and t.get("v") == "street_lamp" for t in n.findall("tag"))]
    return ways, trees, lights


def assemble(ways, ids):
    line = []
    for ident in ids:
        segment = ways[ident]["world"]
        if line and math.dist(line[-1], segment[0]) > .001:
            raise ValueError(f"Disconnected Yas Marina source way: {ident}")
        line += segment[1:] if line else segment
    return line


def water_mask(ways, line, pit, width, height, native_rgb):
    """Classify connected coast regions using OSM's land-on-left convention."""
    scale = width / 1400
    pixel = lambda p: ((p[0]-BOUNDS["minX"])*scale, (BOUNDS["maxY"]-p[1])*height/1915)
    coast = Image.new("L", (width, height))
    draw = ImageDraw.Draw(coast)
    samples, directions, coast_ids = [], [], []
    for way in ways.values():
        if way["tags"].get("natural") != "coastline":
            continue
        coast_ids.append(way["id"])
        draw.line([pixel(p) for p in way["world"]], fill=255, width=3)
        for a, b in zip(way["world"], way["world"][1:]):
            a, b = np.array(a), np.array(b)
            delta = b-a
            for t in np.linspace(0, 1, max(2, math.ceil(np.linalg.norm(delta)/2))):
                samples.append(a+t*delta)
                directions.append(delta)
    if not samples:
        raise ValueError("Water restoration requires mapped coastlines")
    components, count = label(np.asarray(coast) == 0)
    distance = distance_transform_edt(components > 0)
    tree, directions = cKDTree(samples), np.asarray(directions)
    water = np.zeros((height, width), dtype=bool)
    regions = []
    for component in range(1, count+1):
        region = components == component
        row, col = np.unravel_index(np.argmax(distance*region), region.shape)
        world = np.array([BOUNDS["minX"]+(col+.5)/scale, BOUNDS["maxY"]-(row+.5)*1915/height])
        _, index = tree.query(world)
        delta, offset = directions[index], world-tree.data[index]
        is_water = bool(delta[0]*offset[1]-delta[1]*offset[0] < 0)
        water[region] = is_water
        regions.append({"pixels": int(region.sum()), "water": is_water})
    # Assign coastline raster pixels to their nearest classified region.
    indices = distance_transform_edt(components == 0, return_distances=False, return_indices=True)
    water[components == 0] = water[tuple(indices[:, components == 0])]
    mask = Image.fromarray(water.astype(np.uint8)*255)
    draw = ImageDraw.Draw(mask)
    for way in ways.values():
        if way["tags"].get("natural") == "water" and way["world"][0] == way["world"][-1]:
            draw.polygon([pixel(p) for p in way["world"]], fill=255)
    # The OSM coast chord (188205155) cuts through the Marina Wing platform.
    # Keep its connected pale quay from the CURRENT native image. Limit the
    # correction to the mapped wing neighbourhood; other shores remain intact.
    wing_id, search_meters, smoothing_meters, dry_threshold = 520940413, 22, 3, 90
    wing = Image.new("L", (width, height))
    ImageDraw.Draw(wing).polygon([pixel(p) for p in ways[wing_id]["world"]], fill=255)
    wing = np.asarray(wing) > 0
    distance_to_wing = distance_transform_edt(~wing, sampling=(1915/height, 1400/width))
    brightness = gaussian_filter(native_rgb.mean(axis=0),
        (smoothing_meters*height/1915, smoothing_meters*width/1400))
    dry_candidates = (brightness >= dry_threshold) & (distance_to_wing <= search_meters)
    dry_regions, _ = label(dry_candidates)
    connected_ids = np.unique(dry_regions[wing])
    dry_platform = np.isin(dry_regions, connected_ids[connected_ids > 0])
    original_water = np.asarray(mask) > 0
    corrected_pixels = original_water & dry_platform
    original_water[dry_platform] = False
    mask = Image.fromarray(original_water.astype(np.uint8)*255)
    quay_audit = {"osmWingId": wing_id, "coarseCoastWayId": 188205155,
        "source": "sentinel-20261004.tif native georeferenced RGB; connected dry platform beside Marina Wing",
        "searchRadiusMeters": search_meters, "smoothingMeters": smoothing_meters,
        "dryBrightnessThresholdSrgb": dry_threshold,
        "restoredDryAreaSquareMeters": float(corrected_pixels.sum()*1400/width*1915/height),
        "method": "local native-image dry region touching the mapped wing; no historical image geometry",
        "shoreAccuracy": "native 10 m optical resolution; not a surveyed coast"}
    protected = Image.new("L", (width, height))
    draw = ImageDraw.Draw(protected)
    for path, half in [(line, 9), (pit, 5.5)]:
        draw.line([pixel(p) for p in path], fill=255, width=math.ceil(half*2*scale), joint="curve")
    for way in ways.values():
        tags, points = way["tags"], way["world"]
        if tags.get("building") or tags.get("building:part") or tags.get("man_made") == "pier":
            if points[0] == points[-1]:
                draw.polygon([pixel(p) for p in points], fill=255)
            else:
                draw.line([pixel(p) for p in points], fill=255, width=math.ceil(4*scale))
    # Feather only inside water: no colour leaks onto land or piers.
    water = (np.asarray(mask) > 0) & (np.asarray(protected) == 0)
    feather_meters = 1.4
    alpha = np.clip(distance_transform_edt(water, sampling=(1915/height, 1400/width))/feather_meters, 0, 1)
    alpha = alpha*alpha*(3-2*alpha)
    Image.fromarray(np.rint(alpha*255).astype(np.uint8)).save(PREPARED / "yas-marina-water-mask.png")
    protected_max = float(alpha[np.asarray(protected) > 0].max())
    if protected_max != 0 or not .1 < water.mean() < .6:
        raise ValueError("Invalid water mask / protected geometry")
    return {"method": "current OSM directed coastlines and closed water polygons; land on left; geographic mask",
        "coastlineWayIds": coast_ids, "regions": regions, "coveragePercent": float(water.mean()*100),
        "hotelQuayCorrection": quay_audit,
        "featherMeters": feather_meters, "protectedRoadBuildingsPiersMaximumAlpha": protected_max,
        "material": "authored teal water texture, imagegen; earlier Planet SkySat colours as reference only",
        "historicalGeographyEmbedded": False}


def register_image(ways, line, pit):
    """Use the source geotransform, never fit a photograph to the road by eye."""
    width, height = 2048, 2801
    transform = from_bounds(BOUNDS["minX"], BOUNDS["minY"], BOUNDS["maxX"], BOUNDS["maxY"], width, height)
    rgb = np.zeros((3, height, width), dtype=np.uint8)
    with rasterio.open(SOURCE / "sentinel-20261004.tif") as source:
        if source.crs.to_string() != CRS or source.count != 3:
            raise ValueError("Unexpected native Yas Marina image CRS / channels")
        if not (source.bounds.left <= BOUNDS["minX"] and source.bounds.right >= BOUNDS["maxX"]
                and source.bounds.bottom <= BOUNDS["minY"] and source.bounds.top >= BOUNDS["maxY"]):
            raise ValueError("Current satellite crop does not cover the model bounds")
        audit = {"sourceFile": "sentinel-20261004.tif", "acquisitionDate": "2026-10-04",
            "method": "native GeoTIFF geotransform; same EPSG:32640 as OSM geometry; no manual affine fit",
            "coordinateReferenceSystem": CRS, "nativeResolutionMeters": [source.res[0], source.res[1]],
            "nativeTransform": list(source.transform)[:6], "sourceBounds": list(source.bounds),
            "nativePixels": [source.width, source.height], "outputPixels": [width, height],
            "outputTransform": list(transform)[:6], "outputBounds": BOUNDS,
            "manualTranslationMeters": [0, 0], "independentSurveyAvailable": False,
            "historicalImageEmbedded": False, "peripheralEdgePaddingPixels": 0}
        for channel in range(3):
            reproject(rasterio.band(source, channel+1), rgb[channel], src_transform=source.transform,
                src_crs=source.crs, dst_transform=transform, dst_crs=CRS, resampling=Resampling.bilinear)
    result = Image.fromarray(np.moveaxis(rgb, 0, 2))
    # Native 10 m imagery supplies measured macro colours. Current OSM garden
    # boundaries and service paths supply readable detail without old road pixels.
    draw = ImageDraw.Draw(result)
    def pixel(p):
        return ((p[0]-BOUNDS["minX"])/1400*width, (BOUNDS["maxY"]-p[1])/1915*height)
    polygons = paths = 0
    for feature in ways.values():
        tags, points = feature["tags"], feature["world"]
        if len(points) >= 4 and points[0] == points[-1] and (
                tags.get("landuse") in ("grass", "greenery", "meadow") or tags.get("leisure") == "garden"):
            draw.polygon([pixel(p) for p in points], fill=(67, 94, 65))
            polygons += 1
    for feature in ways.values():
        tags, points = feature["tags"], feature["world"]
        if tags.get("highway") in ("service", "footway", "path") and not tags.get("tunnel"):
            road_width = 3.5 if tags["highway"] == "service" else 1.6
            draw.line([pixel(p) for p in points], fill=(102, 103, 99),
                      width=max(1, round(road_width*width/1400)))
            paths += 1
    audit["mappedGroundDetail"] = {"gardenPolygons": polygons, "servicePaths": paths,
        "method": "current OSM geometry; authored daytime colours; path widths estimated"}
    audit["waterRestoration"] = water_mask(ways, line, pit, width, height, rgb)
    result.save(PREPARED / "yas-marina-orthophoto.jpg", quality=88)
    write(PREPARED / "raster-registration-audit.json", audit)
    return result


def terrain(line, pit, tunnel_range):
    width, height = 351, 480  # approximately 4 m grid; no vertical amplification
    xs, ys = np.meshgrid(np.linspace(BOUNDS["minX"], BOUNDS["maxX"], width),
                         np.linspace(BOUNDS["maxY"], BOUNDS["minY"], height))
    projection = Transformer.from_crs(CRS, 4326, always_xy=True)
    lon, lat = projection.transform(xs, ys)
    with rasterio.open(SOURCE / "gedtm30-native.tif") as source:
        grid = source.read(1).astype(float)*source.scales[0]+source.offsets[0]
        col, row = (~source.transform)*(lon, lat)
        values = map_coordinates(grid, [row-.5, col-.5], order=1, mode="nearest")
        if not np.isfinite(values).all() or values.min() < -10 or values.max() > 80:
            raise ValueError("Invalid Yas Marina DTM values")
    values = gaussian_filter(values, 3)
    def at(points):
        p = np.asarray(points)
        col = (p[:, 0]-BOUNDS["minX"])/(BOUNDS["maxX"]-BOUNDS["minX"])*(width-1)
        row = (BOUNDS["maxY"]-p[:, 1])/(BOUNDS["maxY"]-BOUNDS["minY"])*(height-1)
        return map_coordinates(values, [row, col], order=1, mode="nearest")
    profiles = []
    for i, path in enumerate([line, pit]):
        distances = metric.cumulative(path)
        steps = np.linspace(0, distances[-1], math.ceil(distances[-1]/2)+1)
        positions = np.array([metric.sample(path, distances, float(d)) for d in steps])
        raw = at(positions)
        smooth = gaussian_filter1d(raw, 25, mode="wrap" if i == 0 else "nearest")
        if i == 0:
            smooth[-1] = smooth[0]
        else:
            # Join both pit ends to the main surface; the tagged underground
            # section is a separately reconstructed 6 m descent, not DEM data.
            main = profiles[0]
            main_distances = metric.cumulative(line)
            nearby = [metric.nearest(line, main_distances, p) for p in positions]
            for k, (gap, d) in enumerate(nearby):
                weight = max(0,min(1,(30-gap)/20))
                weight = weight*weight*(3-2*weight)
                main_level = np.interp(d, main["distanceMeters"], main["elevationMeters"])
                smooth[k] = smooth[k]*(1-weight)+main_level*weight
            lo, hi = tunnel_range
            descent = np.minimum(np.clip((steps-(lo-100))/100, 0, 1), np.clip(((hi+100)-steps)/100, 0, 1))
            # C2 easing keeps the ramp transitions smooth.
            descent = descent**3*(10-15*descent+6*descent**2)
            smooth -= descent*6
        profiles.append({"distanceMeters": steps.tolist(), "elevationMeters": smooth.tolist(),
                         "stepMeters": float(steps[1])})
    points = np.array([metric.sample(line, metric.cumulative(line), d) for d in profiles[0]["distanceMeters"]])
    gap, nearest = cKDTree(points).query(np.c_[xs.ravel(), ys.ravel()])
    levels = np.array(profiles[0]["elevationMeters"])[nearest].reshape(xs.shape)
    weight = np.clip((32-gap.reshape(xs.shape))/14, 0, 1)
    graded = values*(1-weight)+(levels-.25)*weight
    # Pit frontage shares the main platform. Open access ramps are carved;
    # the covered tunnel retains the terrain / main circuit above it.
    pd = np.array(profiles[1]["distanceMeters"])
    pp = np.array([metric.sample(pit, metric.cumulative(pit), d) for d in pd])
    pit_gap, index = cKDTree(pp).query(np.c_[xs.ravel(), ys.ravel()])
    pit_d = pd[index].reshape(xs.shape)
    lo, hi = tunnel_range
    active = (pit_d < lo-2) | (pit_d > hi+2)
    pit_weight = np.clip((9-pit_gap.reshape(xs.shape))/3, 0, 1)*active
    pit_level = np.array(profiles[1]["elevationMeters"])[index].reshape(xs.shape)-.2
    graded = graded*(1-pit_weight)+pit_level*pit_weight
    graded.astype("<f4").tofile(PREPARED / "yas-marina-dtm.f32le")
    write(PREPARED / "yas-marina-road-profiles.json", profiles)
    write(PREPARED / "raster-metadata.json", {"rasters": {"dtm": {"width": width, "height": height,
        "mean": float(graded.mean())}}, "terrainSurface": {"source": "GEDTM30 30 m native bare-earth estimate",
        "coordinateReferenceSystem": CRS, "verticalDatum": "EGM2008", "nodataSamples": 0,
        "rawElevationRangeMeters": [float(values.min()), float(values.max())]},
        "roadGrading": {"maximumTerrainAdjustmentMeters": float(np.abs(values-graded).max()),
        "method": "50 m Gaussian road profile, shared frontage and local grading; tunnel depth reconstructed separately"}})


def main():
    PREPARED.mkdir(parents=True, exist_ok=True)
    ways, trees, lights = read_osm()
    source_line = assemble(ways, MAIN_IDS)
    if math.dist(source_line[0], source_line[-1]) > .001:
        raise ValueError("Yas Marina circuit is not closed")
    source_distances = metric.cumulative(source_line)
    # The FIA control line lies 28% along the straight from T16 to T1.
    finish = source_distances[40]+.28*(source_distances[57]-source_distances[40])
    finish_point = metric.sample(source_line, source_distances, finish)
    cut = int(np.searchsorted(source_distances, finish))
    loop = [finish_point]+source_line[cut:-1]+source_line[:cut]+[finish_point]
    line, _, _, rounding = axis.round_driving_axis(loop, True)
    # Keep a compact axis for Blender sampling, without changing its geometry.
    line = line[::4]+[line[-1]] if len(line) % 4 != 1 else line[::4]
    distances = metric.cumulative(line)
    if abs(distances[-1]-5281)/5281 > .005:
        raise ValueError("Yas Marina length exceeds FIA 0.5% tolerance")
    turns = [{"number": i+1, "distanceMeters": metric.nearest(line, distances, source_line[index])[1],
              "sourceVertex": index} for i, index in enumerate(TURN_VERTICES)]
    if any(a["distanceMeters"] >= b["distanceMeters"] for a, b in zip(turns, turns[1:])):
        raise ValueError("Turn numbering disagrees with FIA clockwise lap direction")
    pit_source = assemble(ways, PIT_IDS)
    pit_source[0] = metric.sample(line, distances, metric.nearest(line, distances, pit_source[0])[1])
    pit_source[-1] = metric.sample(line, distances, metric.nearest(line, distances, pit_source[-1])[1])
    pit, _, _, pit_rounding = axis.round_driving_axis(pit_source, False)
    pit = pit[::4]+[pit[-1]] if len(pit) % 4 != 1 else pit[::4]
    pc = metric.cumulative(pit)
    tunnel_range = [metric.nearest(pit, pc, ways[176695255]["world"][i])[1] for i in (0, -1)]
    image = register_image(ways, line, pit)
    terrain(line, pit, tunnel_range)
    def inside(p):
        return BOUNDS["minX"] <= p[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= p[1] <= BOUNDS["maxY"]
    vectors = []
    for feature in ways.values():
        if not all(inside(p) for p in feature["world"]):
            continue
        tags = feature["tags"]
        if tags.get("building") or tags.get("building:part") or tags.get("barrier") or tags.get("man_made") == "pier":
            feature = {k: v for k, v in feature.items() if k != "refs"}
            if "Grandstand" in tags.get("name", "") or tags.get("building:part") == "grandstand":
                feature["tags"] = {**tags, "grandstand": "yes"}
            vectors.append(feature)
    config = {"schemaVersion": 4, "modelId": "yas-marina", "model": {"bounds": BOUNDS,
        "center": {"x": (BOUNDS["minX"]+BOUNDS["maxX"])/2, "y": (BOUNDS["minY"]+BOUNDS["maxY"])/2},
        "centerline": line, "pitCenterline": pit, "turns": turns, "trackWidthMeters": 12,
        "osmRacewayIds": MAIN_IDS, "sourceAxisRounding": rounding, "pitAxisRounding": pit_rounding},
        "officialControlPoints": {"referenceYear": 2025, "currentEventVerified": False, "officialLapMeters": 5281,
        "sectorBoundaryDistancesMeters": [turns[4]["distanceMeters"]-205, turns[8]["distanceMeters"]-100],
        "sectorReference": "FIA v4 04.12.25: 205 m before T5, 100 m before T9",
        "speedTrapDistanceMeters": turns[5]["distanceMeters"]-150,
        "speedTrapReference": "FIA v4: 150 m before T6", "raceStartDistanceMeters": 130,
        "finishMethod": "FIA map-derived 28% of T16-to-T1 straight; not surveyed timing coordinates",
        "pitBoxes": 40, "pitBoxMethod": "permanent bay count reconstructed from source roof rhythm; event allocation unverified"},
        "tunnel": {"osmWayId": 176695255, "distanceRangeMeters": tunnel_range,
            "depthMeters": 6, "headroomMeters": 4.8, "heightMethod": "photo-based reconstruction; no engineering survey"},
        "vectors": vectors, "trees": [p for p in trees if inside(p)],
        "lights": [p for p in lights if inside(p["world"])],
        "sourceManifest": json.loads((SOURCE / "source-manifest.json").read_text()),
        "limitations": [
            "Current Copernicus Sentinel-2 imagery was acquired on 4 October 2026. Native optical resolution is 10 m; upsampling does not add photographic detail. Current OSM surface polygons and separate textured 3D meshes complement it.",
            "Imagery uses its native EPSG:32640 GeoTIFF geotransform, without a visual affine fit, manual translation or edge padding. Absolute source geolocation and OSM accuracy are not independently surveyed.",
            "Water colour and ripples are authored from the earlier licensed Planet SkySat colour reference, masked to current OSM shores and piers and baked in Blender; they are not satellite measurements from 2026. Historical road/land pixels are not embedded.",
            "GEDTM30 is a 30 m bare-earth estimate with smoothed road grading. Track camber, engineering levels and the tunnel depth are not surveyed.",
            "Painted runoff boundaries are reconstructed from native georeferenced February 2025 reference imagery with reported 8.47 m horizontal accuracy. Imagery pixels are not embedded. Paint colours and T9 checker rhythm are approximations; advertising is omitted.",
            "FIA 2025 v4 supplies sporting controls. The future 2026 Abu Dhabi GP event layout, temporary hospitality and team equipment are unverified.",
            "No open UAE national LoD2/DSM was found. Permanent OSM footprints and detailed building parts are used; complex roofs are reconstructed from engineer/promoter references.",
            "Unverified mobile motorhomes, parked vehicles, small tents, yachts and exact team advertising are omitted; permanent paddock villas, pit buildings and marina piers are included.",
            "The permanent pit bay count is reconstructed as 40; the exact 2026 garage allocation must be checked when FIA publishes the pit drawing."]}
    write(ROOT / ".track-model-build/yas-marina.json", config)
    review = image.resize((1024, 1400))
    draw = ImageDraw.Draw(review)
    pixel = lambda p: ((p[0]-BOUNDS["minX"])/1400*1024, (BOUNDS["maxY"]-p[1])/1915*1400)
    draw.line([pixel(p) for p in line], fill="cyan", width=2)
    for turn in turns:
        draw.text(pixel(metric.sample(line, distances, turn["distanceMeters"])), str(turn["number"]), fill="yellow")
    review.save(PREPARED / "source-review.jpg", quality=92)
    print(json.dumps({"lapMeters": distances[-1], "vectors": len(vectors), "tunnelRange": tunnel_range}))


if __name__ == "__main__":
    main()
