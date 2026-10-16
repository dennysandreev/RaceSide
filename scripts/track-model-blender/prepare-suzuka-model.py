#!/usr/bin/env python3
"""Reproject pinned GSI tiles and OSM Suzuka vectors into native UTM 53N metres."""

from bisect import bisect_right
import importlib.util
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import reproject, Resampling, transform

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/suzuka-source"
PREPARED = ROOT / ".track-model-build/suzuka-prepared"
BOUNDS = {"minX": 638940, "minY": 3856000, "maxX": 641360, "maxY": 3857540}
CRS = "EPSG:32653"
# Reuse only polyline maths, without importing any other circuit's geometry.
spec = importlib.util.spec_from_file_location("suzuka_metric", Path(__file__).with_name("prepare-austin-model.py"))
metric = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metric)
cumulative, sample, nearest = metric.cumulative, metric.sample, metric.nearest


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def project(lon, lat):
    x, y = transform("EPSG:4326", CRS, [lon], [lat])
    return [x[0], y[0]]


def raster_tiles(dataset, zoom, dem=False):
    files = list((SOURCE / dataset).glob(f"{zoom}-*"))
    indices = [tuple(map(int, p.stem.split("-")[1:])) for p in files]
    min_x, max_x = min(x for x, y in indices), max(x for x, y in indices)
    min_y, max_y = min(y for x, y in indices), max(y for x, y in indices)
    shape = ((max_y-min_y+1)*256, (max_x-min_x+1)*256)
    mosaic = np.full(shape, np.nan, dtype=np.float32) if dem else np.zeros((*shape, 3), dtype=np.uint8)
    for path, (x, y) in zip(files, indices):
        rgb = np.asarray(Image.open(path).convert("RGB"))
        if dem:
            code = rgb[:, :, 0].astype(np.int32)*65536 + rgb[:, :, 1].astype(np.int32)*256 + rgb[:, :, 2]
            value = np.where(code > 2**23, code-2**24, code).astype(np.float32)*.01
            value[code == 2**23] = np.nan
        else:
            value = rgb
        mosaic[(y-min_y)*256:(y-min_y+1)*256, (x-min_x)*256:(x-min_x+1)*256] = value
    half = math.pi*6378137
    tile_width = 2*half/(2**zoom)
    affine = from_origin(min_x*tile_width-half, half-min_y*tile_width, tile_width/256, tile_width/256)
    return mosaic, affine


def rasters():
    mosaic, affine = raster_tiles("seamlessphoto", 18)
    width, height = 4096, 2608
    output = np.zeros((height, width, 3), dtype=np.uint8)
    target = from_bounds(BOUNDS["minX"], BOUNDS["minY"], BOUNDS["maxX"], BOUNDS["maxY"], width, height)
    for band in range(3):
        reproject(mosaic[:, :, band], output[:, :, band], src_transform=affine, src_crs="EPSG:3857",
                  dst_transform=target, dst_crs=CRS, resampling=Resampling.bilinear)
    if np.any(np.max(output, axis=2) == 0):
        raise ValueError("Suzuka orthophoto does not cover the scene")
    Image.fromarray(output).resize((3072,1956),Image.Resampling.LANCZOS).save(PREPARED / "suzuka-orthophoto.jpg", quality=85, subsampling=2)
    source, affine = raster_tiles("dem5a_png", 15, dem=True)
    width, height = 485, 309
    target = from_origin(BOUNDS["minX"]-2.5, BOUNDS["maxY"]+2.5, 5, 5)
    values = np.full((height, width), np.nan, dtype=np.float32)
    reproject(source, values, src_transform=affine, src_crs="EPSG:3857", src_nodata=np.nan,
              dst_transform=target, dst_crs=CRS, dst_nodata=np.nan, resampling=Resampling.bilinear)
    missing = ~np.isfinite(values)
    if missing.any():
        fallback, affine = raster_tiles("dem_png", 14, dem=True)
        lower_resolution = np.full_like(values, np.nan)
        reproject(fallback, lower_resolution, src_transform=affine, src_crs="EPSG:3857", src_nodata=np.nan,
                  dst_transform=target, dst_crs=CRS, dst_nodata=np.nan, resampling=Resampling.bilinear)
        values[missing] = lower_resolution[missing]
    if not np.isfinite(values).all():
        raise ValueError("Both GSI DEM5A and DEM10B contain no-data in the Suzuka scene")
    write(PREPARED / "source-raster-audit.json", {"dem5aNoDataSamples":int(missing.sum()),
         "dem10bFilledSamples":int(missing.sum()), "remainingNoDataSamples":0})
    if values.min() < 0 or values.max() > 150:
        raise ValueError("Suzuka DTM elevations are invalid")
    values.astype("<f4").tofile(PREPARED / "suzuka-source-dtm.f32le")
    return output, values


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = root.findall("node")
    xs, ys = transform("EPSG:4326", CRS, [float(n.get("lon")) for n in nodes], [float(n.get("lat")) for n in nodes])
    positions = {n.get("id"): [x, y] for n, x, y in zip(nodes, xs, ys)}
    ways = {}
    for w in root.findall("way"):
        refs = [n.get("ref") for n in w.findall("nd")]
        if not all(ref in positions for ref in refs):
            continue
        ways[int(w.get("id"))] = {"id": int(w.get("id")), "refs": refs,
            "tags": {t.get("k"): t.get("v") for t in w.findall("tag")}, "world": [positions[ref] for ref in refs]}
    relation = next(r for r in root.findall("relation") if r.get("id") == "284570")
    pool = {int(m.get("ref")): ways[int(m.get("ref"))] for m in relation.findall("member") if m.get("role") != "pit_lane"}
    current = pool.pop(183391665)
    order, refs = [current["id"]], current["refs"][:]
    while pool:
        candidates = [w for w in pool.values() if w["refs"][0] == refs[-1]]
        if len(candidates) != 1:
            raise ValueError("Suzuka OSM circuit relation is disconnected or ambiguous")
        current = candidates[0]
        order.append(current["id"])
        refs.extend(current["refs"][1:])
        del pool[current["id"]]
    if refs[-1] != refs[0]:
        raise ValueError("Suzuka source loop is open")
    line = [positions[r] for r in refs]
    # Control line surveyed visually on GSI aerial, matching FIA 2026 main-straight placement.
    finish = project(136.538966, 34.844662)
    distances = cumulative(line)
    gap, offset = nearest(line, distances, finish)
    if gap > 4:
        raise ValueError(f"Suzuka reviewed control point drifted {gap:.2f} m")
    start = sample(line, distances, offset)
    index = bisect_right(distances, offset)
    line = [start] + line[index:-1] + line[:index] + [start]
    distances = cumulative(line)
    total = distances[-1]
    if abs(total-5807)/5807 >= .005:
        raise ValueError(f"Suzuka source length {total:.3f} m exceeds the FIA tolerance")
    turns = []
    for number in range(1, 19):
        selected = [ways[ident] for ident in order if ways[ident]["tags"].get("raceway:corner_number") == str(number)]
        path = selected[0]["world"][:]
        for way in selected[1:]:
            path.extend(way["world"][1:])
        turn_point = sample(path, cumulative(path), cumulative(path)[-1]/2)
        d = nearest(line, distances, turn_point)[1]
        turns.append({"number": number, "name": selected[0]["tags"].get("name:en", f"Turn {number}"),
                      "distanceMeters": d, "osmWayIds": [w["id"] for w in selected]})
    pit = ways[120917578]["world"][:]
    # The published OSM pit-entry starts on its branch. Connect it to the physical raceway.
    entry = nearest(line, distances, pit[0])[1]
    pit.insert(0, sample(line, distances, entry))
    trees = [positions[n.get("id")] for n in nodes if any(t.get("k")=="natural" and t.get("v")=="tree" for t in n.findall("tag"))]
    return ways, line, pit, turns, order, trees


def inside(point):
    return BOUNDS["minX"] <= point[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= point[1] <= BOUNDS["maxY"]


def raster_sample(values, point):
    x = np.clip((point[0]-BOUNDS["minX"])/5, 0, values.shape[1]-1.001)
    y = np.clip((BOUNDS["maxY"]-point[1])/5, 0, values.shape[0]-1.001)
    i, j = int(x), int(y)
    a, b = x-i, y-j
    return float(values[j,i]*(1-a)*(1-b)+values[j,i+1]*a*(1-b)+values[j+1,i]*(1-a)*b+values[j+1,i+1]*a*b)


def road_profile(line, values, closed):
    d = cumulative(line)
    n = math.ceil(d[-1]/2)
    steps = np.linspace(0, d[-1], n+1)
    measured = np.array([raster_sample(values, sample(line, d, offset)) for offset in steps])
    # Bare-earth drainage cuts are not road dips. A 32 m Gaussian profile
    # retains the broad surveyed hills without following tiny DTM channels.
    smooth = cv2.GaussianBlur(measured.reshape(1,-1), (101,1), 16).ravel()
    if closed:
        pad = np.r_[measured[-51:-1], measured, measured[1:51]]
        smooth = cv2.GaussianBlur(pad.reshape(1,-1), (101,1), 16).ravel()[50:-50]
        smooth[-1] = smooth[0]
    return {"distanceMeters": steps.tolist(), "elevationMeters": smooth.tolist()}


def main():
    PREPARED.mkdir(parents=True, exist_ok=True)
    aerial, source_dtm = rasters()
    ways, line, pit, turns, order, trees = read_osm()
    dc, dp = cumulative(line), cumulative(pit)
    profiles = [road_profile(line, source_dtm, True), road_profile(pit, source_dtm, False)]
    bridge = ways[175231434]["world"]
    upper_d = nearest(line, dc, sample(bridge, cumulative(bridge), cumulative(bridge)[-1]/2))[1]
    crossing = sample(line, dc, upper_d)
    lower_segment = ways[183391655]["world"]
    lower_d = nearest(line, dc, sample(lower_segment, cumulative(lower_segment), cumulative(lower_segment)[-1]/2))[1]
    # Use the closest point of the underpass branch to the mapped bridge midpoint.
    ldist = cumulative(lower_segment)
    local_d = nearest(lower_segment, ldist, crossing)[1]
    lower_d = nearest(line, dc, sample(lower_segment, ldist, local_d))[1]
    values = np.asarray(profiles[0]["elevationMeters"])
    steps = np.asarray(profiles[0]["distanceMeters"])
    high_source = float(np.interp(upper_d, steps, values))
    low = float(np.interp(lower_d, steps, values))
    # Bare-earth DTM measures ground beneath the deck. Reconstruct the upper
    # road from its surveyed approach heights, retaining the lower DTM profile.
    start, end = upper_d-110, upper_d+110
    y0, y1 = np.interp([start,end],steps,values)
    slope0 = (np.interp(start,steps,values)-np.interp(start-20,steps,values))/20
    slope1 = (np.interp(end+20,steps,values)-np.interp(end,steps,values))/20
    mask = (steps>=start)&(steps<=end)
    t = (steps[mask]-start)/(end-start)
    values[mask] = (2*t**3-3*t**2+1)*y0 + (t**3-2*t**2+t)*(end-start)*slope0 + (-2*t**3+3*t**2)*y1 + (t**3-t**2)*(end-start)*slope1
    high = float(np.interp(upper_d,steps,values))
    target = low
    profiles[0]["elevationMeters"] = values.tolist()
    for endpoint, distance in [(0, nearest(line, dc, pit[0])[1]), (-1, nearest(line, dc, pit[-1])[1])]:
        delta = np.interp(distance, steps, values)-profiles[1]["elevationMeters"][endpoint]
        psteps = np.array(profiles[1]["distanceMeters"])
        blend = np.maximum(0, 1-(psteps if endpoint==0 else dp[-1]-psteps)/50)
        profiles[1]["elevationMeters"] = (np.array(profiles[1]["elevationMeters"])+delta*blend).tolist()
    dtm = source_dtm.copy()
    nearest_gap = np.full(dtm.shape, np.inf)
    for path, profile, closed in [(line, profiles[0], True), (pit, profiles[1], False)]:
        distances = cumulative(path)
        for offset in np.arange(0, distances[-1], 3):
            if closed and abs(offset-upper_d)<18:
                continue
            point = sample(path, distances, offset)
            col, row = (point[0]-BOUNDS["minX"])/5, (BOUNDS["maxY"]-point[1])/5
            left, right = max(0,int(col)-6), min(dtm.shape[1],int(col)+7)
            top, bottom = max(0,int(row)-6), min(dtm.shape[0],int(row)+7)
            xx, yy = np.meshgrid(np.arange(left,right),np.arange(top,bottom))
            gap = np.hypot((xx-col)*5,(yy-row)*5)
            region = nearest_gap[top:bottom,left:right]
            active = (gap<region)&(gap<27)
            ground = dtm[top:bottom,left:right]
            elevation = np.interp(offset,profile["distanceMeters"],profile["elevationMeters"])-.20
            blend = np.clip((27-gap)/12,0,1)
            ground[active] = source_dtm[top:bottom,left:right][active]*(1-blend[active]) + elevation*blend[active]
            region[active] = gap[active]
    # The tunnel branch must own its full terrain corridor at the crossing,
    # including terrain vertices nearer the upper route in the XY projection.
    for offset in np.arange(lower_d-100,lower_d+100,2):
        point = sample(line,dc,offset)
        col,row = (point[0]-BOUNDS["minX"])/5,(BOUNDS["maxY"]-point[1])/5
        left,right = max(0,int(col)-5),min(dtm.shape[1],int(col)+6)
        top,bottom = max(0,int(row)-5),min(dtm.shape[0],int(row)+6)
        xx,yy = np.meshgrid(np.arange(left,right),np.arange(top,bottom))
        gap = np.hypot((xx-col)*5,(yy-row)*5)
        floor = np.interp(offset,steps,values)-.20
        region = dtm[top:bottom,left:right]
        blend = np.clip((25-gap)/10,0,1)
        region[:] = np.minimum(region,source_dtm[top:bottom,left:right]*(1-blend)+floor*blend)
    dtm.astype("<f4").tofile(PREPARED / "suzuka-dtm.f32le")
    write(PREPARED / "suzuka-road-profiles.json", profiles)
    raster_meta = {"rasters":{"dtm":{"width":485,"height":309,"mean":float(dtm.mean())}},
        "terrainSurface":{"source":"GSI DEM5A, 5 m bare-earth","coordinateReferenceSystem":CRS,
                          "verticalDatum":"GSI orthometric metres (Tokyo Peil)","nodataSamples":0},
        "roadGrading":{"maximumTerrainAdjustmentMeters":float(np.max(np.abs(dtm-source_dtm))),
                       "method":"local DTM-to-road grading; 32 m profile smoothing; upper bridge profile interpolated from approach heights"},
        "bridge":{"osmWayId":175231434,"upperDistanceMeters":upper_d,"lowerDistanceMeters":lower_d,
                  "upperSourceElevationMeters":high_source,"upperRoadElevationMeters":high,"lowerSourceElevationMeters":low,
                  "lowerRoadElevationMeters":target,"tunnelHeightEstimated":True}}
    write(PREPARED / "raster-metadata.json", raster_meta)
    config = {"schemaVersion":4,"modelId":"suzuka","model":{"bounds":BOUNDS,
        "center":{"x":640150,"y":3856770},"centerline":line,"pitCenterline":pit,"turns":turns,
        "trackWidthMeters":12,"startFinishDistanceMeters":0,"osmRacewayIds":order},
        "officialControlPoints":{"referenceYear":2026,"currentEventVerified":True,"officialLapMeters":5807,
            "sectorLengthsMeters":[2184,2526,1097],"sectorBoundaryDistancesMeters":[2184,4710],
            "sectorReference":"110 m before T8; 270 m before T15",
            "speedTrapDistanceMeters":turns[14]["distanceMeters"]+70,"speedTrapReference":"70 m after T15",
            "pitBoxes":55,"raceStartDistanceMeters":130},
        "vectors":[{k:v for k,v in w.items() if k!='refs'} for w in ways.values() if all(inside(p) for p in w["world"])],
        "trees":[p for p in trees if inside(p)],"bridge":raster_meta["bridge"],
        "sourceManifest":json.loads((SOURCE/"source-manifest.json").read_text()),
        "limitations":["GSI imagery acquisition date is not supplied by tile endpoint; 2026 event details use FIA 2026 maps.",
            "No published PLATEAU dataset for Suzuka 24207; building heights and some roof profiles reconstructed from OSM and official photographs.",
            "DTM has one height per XY; the lower tunnel road and structural deck depth are reconstructed with explicit clearance, not surveyed.",
            "No event-date aerial survey of team hospitality; permanent paddock blocks are mapped, unverified parked trucks and team motorhomes are omitted."]}
    write(ROOT/".track-model-build/suzuka.json", config)
    # Review-only overlay retains geographic orientation and identifiers.
    review = Image.fromarray(aerial).resize((1800,1146))
    draw = ImageDraw.Draw(review)
    def pixel(p):return ((p[0]-BOUNDS['minX'])/2420*1800,(BOUNDS['maxY']-p[1])/1540*1146)
    draw.line([pixel(p) for p in line],fill="#ff6464",width=2)
    for t in turns:
        x,y=pixel(sample(line,dc,t['distanceMeters']))
        draw.text((x+5,y-8),str(t['number']),fill="white",stroke_width=2,stroke_fill="black")
    for w in config['vectors']:
        if w['tags'].get('grandstand')=='yes' or w['tags'].get('name:en')=='Pit Building':
            draw.line([pixel(p) for p in w['world']],fill="cyan",width=2)
            draw.text(pixel(w['world'][0]),f"{w['id']} {w['tags'].get('name','')}",fill="cyan",stroke_width=1,stroke_fill="black")
    draw.ellipse((pixel(line[0])[0]-5,pixel(line[0])[1]-5,pixel(line[0])[0]+5,pixel(line[0])[1]+5),fill="yellow")
    review.save(PREPARED/"source-review.jpg",quality=94)
    print(json.dumps({"lapMeters":dc[-1],"relativeErrorPercent":abs(dc[-1]-5807)/5807*100,
                      "turns":turns,"bridge":config['bridge'],"vectors":len(config['vectors'])}))


if __name__ == "__main__":
    main()
