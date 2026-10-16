#!/usr/bin/env python3
"""Prepare Albert Park's own OSM, Vicmap and registered Planet SkySat sources."""

from bisect import bisect_right
import importlib.util
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/albert-park-source"
PREPARED = ROOT / ".track-model-build/albert-park-prepared"
BOUNDS = {"minX": 320480, "minY": 5808270, "maxX": 322380, "maxY": 5810430}
CRS = "EPSG:7855"
STEP = 5
WIDTH, HEIGHT = 381, 433
spec = importlib.util.spec_from_file_location("albert_metric", Path(__file__).with_name("prepare-austin-model.py"))
metric = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metric)
cumulative, sample, nearest = metric.cumulative, metric.sample, metric.nearest


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def current_corridor_mask():
    polygon = json.loads((ROOT / "docs/track-model-albert-park-current-corridor.json").read_text())
    if polygon["crs"] != CRS:
        raise ValueError("Current race corridor must use GDA2020/MGA55 metres")
    origin = np.array([BOUNDS["minX"], BOUNDS["minY"]])
    scale = 2  # Half-metre raster used only to locate road edges.
    mask = np.zeros((4321, 3801), np.uint8)
    pixel = lambda points: np.round((points-origin)*scale).astype(np.int32)
    cv2.fillPoly(mask, [pixel(np.array(polygon["outer"]))], 255)
    for hole in polygon["holes"]:
        cv2.fillPoly(mask, [pixel(np.array(hole))], 0)
    area = np.count_nonzero(mask)/scale**2
    if not 50_000 < area < 85_000:
        raise ValueError(f"Current race corridor area is invalid: {area:.1f} m²")
    return polygon, mask, pixel, area


def current_raceway(guide, control_line, straight_tangent):
    """Use the current race corridor, not public-road junction offsets."""
    polygon, mask, pixel, area = current_corridor_mask()
    distances = cumulative(guide)
    steps = np.arange(0, distances[-1], 2)
    samples = np.array([sample(guide, distances, d) for d in steps])
    result = np.full_like(samples, np.nan)
    offsets = np.arange(-32, 32.01, .25)
    for i, point in enumerate(samples):
        tangent = samples[(i+3)%len(samples)]-samples[(i-3)%len(samples)]
        tangent /= np.linalg.norm(tangent)
        normal = np.array([-tangent[1], tangent[0]])
        probes = pixel(point+offsets[:, None]*normal)
        active = np.flatnonzero(mask[probes[:, 1], probes[:, 0]])
        if not len(active): continue
        groups = np.split(active, np.flatnonzero(np.diff(active)>1)+1)
        group = min(groups, key=lambda g: abs(np.mean(offsets[g])))
        width = offsets[group[-1]]-offsets[group[0]]
        offset = (offsets[group[-1]]+offsets[group[0]])/2
        if 7 <= width <= 30 and abs(offset) < 22:
            result[i] = point+offset*normal
    valid = np.isfinite(result[:, 0])
    missing = int(np.count_nonzero(~valid))
    if missing > 20:
        raise ValueError(f"Too many unmatched current-road cross sections: {missing}")
    for axis in (0, 1):
        result[:, axis] = np.interp(steps, steps[valid], result[valid, axis], period=distances[-1])
    # Two metres of smoothing removes raster stair steps while retaining
    # the rebuilt corner radii. No global scale or forced lap-length fitting.
    padding = 12
    result = cv2.GaussianBlur(np.r_[result[-padding:], result, result[:padding]].reshape(1, -1, 2),
                              (15, 1), 1).reshape(-1, 2)[padding:-padding]
    result = np.r_[result, result[:1]].tolist()
    # The main straight has not been rerouted. The visitor map's registration
    # displaces it into the surveyed pit frontage. Anchor this unchanged road
    # to the OSM control line and native straight direction instead of taking
    # the midpoint of shared race/pit asphalt. Keep the rebuilt turns below.
    control_line = np.array(control_line)
    axis = np.array(straight_tangent)
    axis /= np.linalg.norm(axis)
    straight = [(control_line+axis*d).tolist() for d in (80, 240)]
    ds = cumulative(result)
    control = nearest(result, ds, control_line)[1]
    start = (control-430) % ds[-1]
    a = np.array(sample(result, ds, start))
    incoming = np.array(sample(result, ds, start+3))-sample(result, ds, start-3)
    finish = (control+430) % ds[-1]
    e = np.array(sample(result, ds, finish))
    outgoing = np.array(sample(result, ds, finish+3))-sample(result, ds, finish-3)
    index = bisect_right(ds, start)
    result = [a.tolist()] + result[index:-1] + result[:index] + [a.tolist()]
    ds = cumulative(result)
    end = nearest(result, ds, e)[1]
    if not 850 < end < 870:
        raise ValueError("Native main-straight registration no longer matches the corridor")
    first, last = [control_line+axis*d for d in (-350, 330)]
    def transition(first, last, t1, t2):
        handle = math.dist(first, last)*.4
        b = first+t1/np.linalg.norm(t1)*handle
        c = last-t2/np.linalg.norm(t2)*handle
        return [((1-t)**3*first+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*last).tolist()
                for t in np.linspace(0, 1, 41)]
    native_straight = [(first+(last-first)*t).tolist() for t in np.linspace(0, 1, 341)]
    result = transition(a, first, incoming, axis)[:-1]+native_straight+transition(last, e, axis, outgoing)[1:]+result[bisect_right(ds, end):]
    # At T6 the old guide cuts across the rebuilt corner, so its normal
    # may select the opposite arm. Join the confirmed approach and exit with
    # tangent-continuous cubic curves instead of retaining a short reversal.
    for apex,before,after in (([321187,5810214],20,30),):
        ds=cumulative(result); center=nearest(result,ds,apex)[1]
        start,end=center-before,center+after
        a,m,e=[np.array(sample(result,ds,t)) for t in (start,center,end)]
        incoming=np.array(sample(result,ds,start+4))-sample(result,ds,start-4)
        outgoing=np.array(sample(result,ds,end+4))-sample(result,ds,end-4)
        middle=e-a
        curve=[]
        for first,last,t1,t2 in ((a,m,incoming,middle),(m,e,middle,outgoing)):
            control=math.dist(first,last)*.4
            b=first+t1/np.linalg.norm(t1)*control
            c=last-t2/np.linalg.norm(t2)*control
            curve.extend([((1-t)**3*first+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*last).tolist()
                          for t in np.linspace(0,1,21) if not (curve and t==0)])
        result=result[:bisect_right(ds,start)]+curve+result[bisect_right(ds,end):]
    return result, {"source": "organizer current Race Track outer boundary and inner holes; FIA 2026 14-turn configuration",
        "polygonId": polygon["polygonId"], "corridorAreaSquareMeters": float(area),
        "unmatchedCrossSectionsInterpolated": missing, "globalScaleApplied": 1,
        "reviewedMainStraightControls": straight,
        "mainStraightReference": "unchanged native OSM straight and control node 9123374386; visitor-map registration rejected where it conflicts with permanent pit-building footprints",
        "method": "OSM topology guide; 0.5 m current corridor mask; native unchanged main straight; separate native pit axis; 2 m smoothing; tangent-continuous reconstruction of ambiguous T6"}


def reconstruct_south(line, raw, refs):
    """Replace the displaced visitor-map T11–T14 section as one native axis."""
    reference = json.loads((ROOT / "docs/track-model-albert-park-south-reference.json").read_text())
    entry, corner, control = [refs.index(reference[key]) for key in ("entryNodeId", "cornerNodeId", "controlNodeId")]
    approach = refs.index(reference["turn11StraightApproachNodeId"])
    raw = np.array(raw)
    vertex = raw[corner]
    incoming, outgoing = vertex-raw[approach], raw[corner+1]-vertex
    incoming /= np.linalg.norm(incoming); outgoing /= np.linalg.norm(outgoing)
    angle = math.acos(float(incoming @ outgoing))
    radius = reference["turn11CentreRadiusMeters"]
    cut = radius*math.tan(angle/2)
    first = vertex-incoming*cut
    centre = first+np.array([incoming[1], -incoming[0]])*radius
    start_angle = math.atan2(*(first-centre)[::-1])
    arc = np.array([centre+radius*np.array([math.cos(t), math.sin(t)])
                    for t in np.linspace(start_angle, start_angle-angle, 25)])
    # T11 was tightened, not replaced by the broad public-road shortcut in the
    # 2018 photo. T12 and T14 retain the native permanent-road geometry.
    southern = np.r_[raw[entry:approach+1], arc, raw[corner+1:control+1]].tolist()
    ds = cumulative(southern)
    points = np.array([sample(southern, ds, d) for d in np.arange(0, ds[-1], 2)])
    points = cv2.GaussianBlur(np.pad(points, ((12, 12), (0, 0)), mode="edge").reshape(1, -1, 2),
                              (15, 1), 1).reshape(-1, 2)[12:-12]
    apex_index = refs.index(reference["turn13ApexNodeId"])
    apex = raw[apex_index]
    outward = apex-(raw[apex_index-4]+raw[apex_index+4])/2
    outward /= np.linalg.norm(outward)
    ds = cumulative(points.tolist())
    apex_distance = nearest(points.tolist(), ds, apex)[1]
    blend = np.clip(1-abs(np.array(ds)-apex_distance)/35, 0, 1)
    blend = blend**2*(3-2*blend)
    points += blend[:, None]*outward*reference["turn13CentreShiftMeters"]
    # The final source segments already lie on the native main straight. No
    # lateral T14-to-straight blend is retained from the visitor-map axis.
    points = np.r_[points, raw[control:control+1]]
    ds = cumulative(line)
    start = nearest(line, ds, points[0])[1]-100
    first = np.array(sample(line, ds, start))
    tangent = np.array(sample(line, ds, start+3))-sample(line, ds, start-3)
    tangent /= np.linalg.norm(tangent)
    outgoing = points[3]-points[0]; outgoing /= np.linalg.norm(outgoing)
    handle = math.dist(first, points[0])*.4
    bridge = [((1-t)**3*first+3*(1-t)**2*t*(first+tangent*handle)
               +3*(1-t)*t*t*(points[0]-outgoing*handle)+t**3*points[0]).tolist()
              for t in np.linspace(0, 1, 51)]
    result = line[:bisect_right(ds, start)]+bridge+points[1:].tolist()
    result[-1] = result[0]
    return result, {"referenceFile": "docs/track-model-albert-park-south-reference.json",
        "sourceNodeIds": refs[entry:control+1], "turn11CentreRadiusMeters": radius,
        "turn13CentreShiftMeters": reference["turn13CentreShiftMeters"],
        "turn14Exit": "continuous native road curve into the unchanged main straight; displaced visitor-map transition removed",
        "method": "native southern section, tightened tangent-continuous T11 fillet, local T13 widening estimate; no global scale"}


def current_pit_lane(guide, line):
    """Keep the native pit frontage and join it to the current race axis."""
    # The longest OSM segment identifies the pit frontage. The following
    # exit points are only a merge reference, not additional road bends.
    frontage = max(range(len(guide)-1), key=lambda i: math.dist(guide[i], guide[i+1]))
    if not 400 < math.dist(guide[frontage], guide[frontage+1]) < 550:
        raise ValueError("OSM pit frontage topology changed")
    body = guide[:frontage+2]
    body_distances, race_distances = cumulative(body), cumulative(line)
    steps = np.arange(0, body_distances[-1], 2)
    points = np.array([sample(body, body_distances, d) for d in steps])
    points = cv2.GaussianBlur(np.pad(points, ((6, 6), (0, 0)), mode="edge").reshape(1, -1, 2),
                             (9, 1), 1.5).reshape(-1, 2)[6:-6].tolist()
    def unit(a, b):
        v = np.array(b)-a
        return v/np.linalg.norm(v)
    def bezier(a, b, c, e):
        return [((1-t)**3*np.array(a)+3*(1-t)**2*t*np.array(b)+3*(1-t)*t*t*np.array(c)+t**3*np.array(e)).tolist()
                for t in np.linspace(0, 1, 41)]
    entry = nearest(line, race_distances, guide[0])[1]-35
    a = sample(line, race_distances, entry)
    b = np.array(a)+unit(sample(line, race_distances, entry-3), sample(line, race_distances, entry+3))*25
    c = np.array(points[0])-unit(points[0], points[3])*20
    entry_curve = bezier(a, b, c, points[0])
    # Match both endpoint tangents and merge ahead in the direction of travel;
    # never carry the legacy tail across the race axis and then double back.
    exit = nearest(line, race_distances, guide[-1])[1]+35
    e = sample(line, race_distances, exit)
    handle = math.dist(points[-1], e)/3
    b = np.array(points[-1])+unit(points[-4], points[-1])*handle
    c = np.array(e)-unit(sample(line, race_distances, exit-3), sample(line, race_distances, exit+3))*handle
    return entry_curve[:-1]+points+bezier(points[-1], b, c, e)[1:], {
        "source": "native OSM way 28119448 frontage checked against permanent pit-building footprints; tangent-continuous exit to native main straight",
        "nativeFrontageSamples": len(points), "legacyExitReplaced": True,
        "mergeReferenceWorld": guide[-1], "mergeDistanceMeters": exit,
    }


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = root.findall("node")
    x, y = transform("EPSG:4326", CRS, [float(n.get("lon")) for n in nodes], [float(n.get("lat")) for n in nodes])
    positions = {n.get("id"): [a, b] for n, a, b in zip(nodes, x, y)}
    ways = {}
    for w in root.findall("way"):
        refs = [n.get("ref") for n in w.findall("nd")]
        if not all(r in positions for r in refs):
            continue
        ways[int(w.get("id"))] = {"id": int(w.get("id")), "refs": refs,
            "tags": {t.get("k"): t.get("v") for t in w.findall("tag")}, "world": [positions[r] for r in refs]}
    relation = next(r for r in root.findall("relation") if r.get("id") == "280443")
    pool = {int(m.get("ref")): ways[int(m.get("ref"))]["refs"] for m in relation.findall("member")
            if m.get("type") == "way" and m.get("role") != "pit_lane"}
    first, refs = next(iter(pool.items()))
    refs = refs[:]
    order = [first]
    del pool[first]
    while pool:
        matches = [(k, v) for k, v in pool.items() if v[0] == refs[-1]] + [(k, v[::-1]) for k, v in pool.items() if v[-1] == refs[-1]]
        if len(matches) != 1:
            raise ValueError("Albert Park circuit relation is disconnected or ambiguous")
        k, following = matches[0]
        refs.extend(following[1:]); order.append(k); del pool[k]
    if refs[-1] != refs[0]:
        raise ValueError("Albert Park source loop is open")
    raw = [positions[r] for r in refs]
    # One bounded corner-cut pass removes coarse polyline kinks; retain the
    # original dimensions and do not rescale the loop to force FIA lap length.
    line = []
    for a, b in zip(raw, raw[1:]):
        cut = min(.25, 4 / max(math.dist(a, b), 1e-9))
        line.extend([[a[j] * (1-cut) + b[j] * cut for j in (0, 1)],
                     [a[j] * cut + b[j] * (1-cut) for j in (0, 1)]])
    line.append(line[0])
    control_index = refs.index("9123374386")
    straight_tangent = np.array(raw[control_index+1])-raw[control_index-1]
    line, current_layout = current_raceway(line, positions["9123374386"], straight_tangent)
    d = cumulative(line)
    gap, offset = nearest(line, d, positions["9123374386"])
    if gap > 20:
        raise ValueError(f"Mapped control line drifted {gap:.2f} m")
    current_layout["controlLineProjectionMeters"] = gap
    start = sample(line, d, offset); i = bisect_right(d, offset)
    line = [start] + line[i:-1] + line[:i] + [start]
    line, current_layout["southernReconstruction"] = reconstruct_south(line, raw, refs)
    d = cumulative(line)
    if abs(d[-1] - 5278) / 5278 >= .005:
        raise ValueError(f"Albert Park geometry {d[-1]:.3f} m exceeds the FIA 0.5% tolerance")
    pit = ways[28119448]["world"][:]
    # Orient the service lane from T14 to T1 and join both source branches.
    if nearest(line, d, pit[0])[1] < nearest(line, d, pit[-1])[1]:
        pit.reverse()
    pit, current_layout["pitLaneReconstruction"] = current_pit_lane(pit, line)
    # Current F1 telemetry supplies corner identities; align its north-up metric
    # shape to the independent OSM road by rigid ICP, then project onto the loop.
    mv = json.loads((SOURCE / "multiviewer-2026.json").read_text())
    telemetry = np.array(list(zip(mv["x"], mv["y"])), np.float64) / 10
    cloud = telemetry[::max(1, len(telemetry)//250)]
    rotation = np.eye(2); translation = np.array(start) - telemetry[0]
    for _ in range(20):
        aligned = cloud @ rotation + translation
        target = np.array([sample(line, d, nearest(line, d, p)[1]) for p in aligned])
        a, b = cloud-cloud.mean(0), target-target.mean(0)
        u, _, vt = np.linalg.svd(a.T @ b)
        rotation = u @ vt
        if np.linalg.det(rotation) < 0: raise ValueError("Telemetry alignment reflected the circuit")
        translation = target.mean(0)-cloud.mean(0) @ rotation
    turns = []
    for corner in mv["corners"]:
        p = np.array([corner["trackPosition"]["x"], corner["trackPosition"]["y"]]) / 10 @ rotation + translation
        gap, offset = nearest(line, d, p)
        if gap > 35: raise ValueError(f"Turn {corner['number']} differs from OSM by {gap:.2f} m")
        turns.append({"number": corner["number"], "distanceMeters": offset, "referenceGapMeters": gap})
    if [t["number"] for t in turns] != list(range(1, 15)) or any(a["distanceMeters"] >= b["distanceMeters"] for a, b in zip(turns, turns[1:])):
        raise ValueError("Albert Park corner order is invalid")
    trees = [positions[n.get("id")] for n in nodes if any(t.get("k")=="natural" and t.get("v")=="tree" for t in n.findall("tag"))]
    return ways, line, pit, turns, order, trees, current_layout


def inside(p):
    return BOUNDS["minX"] <= p[0] <= BOUNDS["maxX"] and BOUNDS["minY"] <= p[1] <= BOUNDS["maxY"]


def contour_terrain():
    # Vicmap 1 m metropolitan contours / spot heights are not a LiDAR raster.
    # Reconstruct a TIN explicitly and resample at 5 m; retain the AHD datum.
    points = {}
    for f in json.loads((SOURCE / "vicmap-contours.json").read_text())["features"]:
        z = float(f["attributes"]["altitude"])
        for path in f["geometry"]["paths"]:
            for a, b in zip(path, path[1:]):
                n = max(1, math.ceil(math.dist(a[:2], b[:2])/15))
                for k in range(n):
                    p = [a[j]+(b[j]-a[j])*k/n for j in (0, 1)]
                    if BOUNDS["minX"]-50 < p[0] < BOUNDS["maxX"]+50 and BOUNDS["minY"]-50 < p[1] < BOUNDS["maxY"]+50:
                        points[(round(p[0]-BOUNDS["minX"]+60, 2), round(p[1]-BOUNDS["minY"]+60, 2))] = z
    for f in json.loads((SOURCE / "vicmap-points.json").read_text())["features"]:
        p = f["geometry"]
        if inside([p["x"], p["y"]]): points[(round(p["x"]-BOUNDS["minX"]+60, 2),round(p["y"]-BOUNDS["minY"]+60, 2))] = float(f["attributes"]["altitude"])
    subdivision = cv2.Subdiv2D((0,0,2020,2280))
    vertices = np.array(list(points), np.float64)
    heights = np.array(list(points.values()))
    for p in vertices: subdivision.insert(tuple(p))
    grid = np.full((HEIGHT,WIDTH),np.nan,np.float32)
    for triangle in subdivision.getTriangleList().reshape(-1,3,2):
        indices = [int(np.argmin(np.sum((vertices-p)**2,axis=1))) for p in triangle]
        if any(np.linalg.norm(vertices[i]-p)>.02 for i,p in zip(indices,triangle)): continue
        world = triangle - 60
        columns = world[:,0]/STEP; rows=(2160-world[:,1])/STEP
        left,right=max(0,math.floor(min(columns))),min(WIDTH-1,math.ceil(max(columns)))
        top,bottom=max(0,math.floor(min(rows))),min(HEIGHT-1,math.ceil(max(rows)))
        if left>right or top>bottom: continue
        xx,yy=np.meshgrid(np.arange(left,right+1),np.arange(top,bottom+1))
        a,b,c=np.c_[columns,rows]
        determinant=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(determinant)<1e-9: continue
        u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/determinant
        v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/determinant
        active=(u>=-1e-5)&(v>=-1e-5)&(u+v<=1+1e-5)
        region=grid[top:bottom+1,left:right+1]
        region[active]=(u*heights[indices[0]]+v*heights[indices[1]]+(1-u-v)*heights[indices[2]])[active]
    missing=~np.isfinite(grid)
    # Small scene-edge gaps use nearest measured contour; record the count.
    for j,i in zip(*np.where(missing)):
        p=np.array([i*STEP+60,2160-j*STEP+60])
        grid[j,i]=heights[np.argmin(np.sum((vertices-p)**2,axis=1))]
    write(PREPARED/"source-raster-audit.json",{"contourTinSamples":len(points),"nearestFilledEdgeSamples":int(missing.sum()),"remainingNoDataSamples":0,"registrationRmsMeters":json.loads((ROOT/"docs/track-model-albert-park-skysat-registration.json").read_text())["rmsMeters"]})
    return grid


def raster_sample(grid,p):
    x=np.clip((p[0]-BOUNDS["minX"])/STEP,0,WIDTH-1.001); y=np.clip((BOUNDS["maxY"]-p[1])/STEP,0,HEIGHT-1.001)
    i,j=int(x),int(y); a,b=x-i,y-j
    return float(grid[j,i]*(1-a)*(1-b)+grid[j,i+1]*a*(1-b)+grid[j+1,i]*(1-a)*b+grid[j+1,i+1]*a*b)


def profile(line,grid,closed):
    d=cumulative(line); steps=np.linspace(0,d[-1],math.ceil(d[-1]/2)+1)
    values=np.array([raster_sample(grid,sample(line,d,t)) for t in steps])
    # The 1 m contour TIN is a ground estimate, not measured asphalt. A 64 m
    # filter suppresses contour interpolation breaks on the flat circuit,
    # including the compressed inside edge of the T14 curve.
    if closed:
        padded=np.r_[values[-101:-1],values,values[1:101]]
        smooth=cv2.GaussianBlur(padded.reshape(1,-1),(201,1),32).ravel()[100:-100]; smooth[-1]=smooth[0]
    else: smooth=cv2.GaussianBlur(values.reshape(1,-1),(201,1),32).ravel()
    return {"distanceMeters":steps.tolist(),"elevationMeters":smooth.tolist()}


def photo_residual_correction(registration):
    """Interpolate independent photo GCP residuals, never the rendered race axis."""
    h = np.array(registration["imageToLocalWorld"])
    origin = np.array(registration["worldOrigin"])
    world = np.array([g["world"] for g in registration["gcps"]])
    predicted = cv2.perspectiveTransform((world-origin)[None], np.linalg.inv(h))[0]
    actual = np.array([g["pixel"] for g in registration["gcps"]])
    perimeter = np.array(registration["residualWarp"]["perimeterPixels"])
    scale = registration["residualWarp"]["pixelScale"]
    points = np.r_[predicted, perimeter]/scale
    def radial(delta):
        squared = np.sum(delta**2, axis=-1)
        return squared*np.log(np.maximum(squared, 1e-20))/2
    affine = np.c_[np.ones(len(points)), points]
    kernel = radial(points[:, None]-points[None, :])
    weights = np.linalg.solve(np.block([[kernel, affine], [affine.T, np.zeros((3, 3))]]),
                               np.r_[actual-predicted, np.zeros_like(perimeter), np.zeros((3, 2))])
    def correction(pixels):
        probes = pixels/scale
        return np.c_[radial(probes[:, None]-points[None, :]), np.ones(len(probes)), probes] @ weights
    return correction


def aerial_texture():
    registration=json.loads((ROOT/"docs/track-model-albert-park-skysat-registration.json").read_text())
    h=np.array(registration["imageToLocalWorld"]); origin=np.array(registration["worldOrigin"])
    width,height=2560,2910
    world_to_output=np.array([[width/1900,0,(origin[0]-BOUNDS["minX"])*width/1900],
        [0,-height/2160,(BOUNDS["maxY"]-origin[1])*height/2160],[0,0,1]])
    source=cv2.imread(str(SOURCE/"skysat-2018.jpg"))
    correction = photo_residual_correction(registration)
    inverse = np.linalg.inv(world_to_output@h)
    map_x, map_y = np.empty((height, width), np.float32), np.empty((height, width), np.float32)
    for row in range(0, height, 64):
        xx, yy = np.meshgrid(np.arange(width), np.arange(row, min(row+64, height)))
        pixels = cv2.perspectiveTransform(np.c_[xx.ravel(), yy.ravel()].astype(float)[None], inverse)[0]
        pixels += correction(pixels)
        map_x[row:row+64] = pixels[:, 0].reshape(xx.shape)
        map_y[row:row+64] = pixels[:, 1].reshape(xx.shape)
    output = cv2.remap(source, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    # Preserve the independent photograph outside the actual road mesh. A
    # painted 18 m band previously concealed both displacement and extra bends.
    checks = registration["checkPoints"]
    predicted = cv2.perspectiveTransform((np.array([p["world"] for p in checks])-origin)[None], np.linalg.inv(h))[0]
    residual = np.linalg.norm(predicted+correction(predicted)-np.array([p["pixel"] for p in checks]), axis=1)
    audit_path = PREPARED/"source-raster-audit.json"
    audit = json.loads(audit_path.read_text())
    audit["photoRegistration"] = {"controlPoints": len(registration["gcps"]), "withheldCheckPoints": len(checks),
        "checkResidualPixels": residual.tolist(), "maximumCheckResidualPixels": float(max(residual)),
        "manualControlUncertaintyMeters": registration["manualControlUncertaintyMeters"],
        "roadBandOverpainted": False}
    if max(residual) > 6: raise ValueError(f"Southern photo check residual exceeds 6 px: {max(residual):.2f}")
    write(audit_path, audit)
    Image.fromarray(cv2.cvtColor(output,cv2.COLOR_BGR2RGB)).save(PREPARED/"albert-park-orthophoto.jpg",quality=82,subsampling=2)
    return Image.fromarray(cv2.cvtColor(output,cv2.COLOR_BGR2RGB))



def clip_stand(poly, line, pit):
    points=np.array(poly); origin=points.min(0)-3; upper=points.max(0)+3; scale=2
    mask=np.zeros((math.ceil((upper[1]-origin[1])*scale)+1,math.ceil((upper[0]-origin[0])*scale)+1),np.uint8)
    cv2.fillPoly(mask,[np.round((points-origin)*scale).astype(np.int32)],255)
    before=int(np.count_nonzero(mask))
    for path,width in ((line,8.5),(pit,5.5)):
        pixels=np.round((np.array(path)-origin)*scale).astype(np.int32)
        cv2.polylines(mask,[pixels],False,0,math.ceil(width*2*scale))
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not contours:raise ValueError("Stand reference entirely covers driving corridor")
    outline=max(contours,key=cv2.contourArea)
    result=cv2.approxPolyDP(outline,.25*scale,True).reshape(-1,2)/scale+origin
    return result.tolist(), {"sourceAreaSquareMeters":before/scale**2,"retainedAreaSquareMeters":float(cv2.contourArea(outline))/scale**2,"method":"source footprint clipped to measured OSM road/pit clearance; no stand translation"}

def main():
    PREPARED.mkdir(parents=True,exist_ok=True)
    ways,line,pit,turns,order,trees,current_layout=read_osm(); dc,dp=cumulative(line),cumulative(pit)
    source=contour_terrain(); aerial=aerial_texture()
    profiles=[profile(line,source,True),profile(pit,source,False)]
    # Both roads must share one elevation throughout their paved junctions,
    # not just at the two centreline endpoints. Independently filtered TIN
    # profiles otherwise form a ~0.3 m step inside the T14 pit-entry overlap.
    # Blend back to the pit's terrain estimate only outside the combined
    # road widths (6 + 4 m, with a 2 m sampling margin).
    pit_heights=[]
    for distance,height in zip(profiles[1]["distanceMeters"],profiles[1]["elevationMeters"]):
        point=sample(pit,dp,distance)
        gap,offset=nearest(line,dc,point)
        main_height=np.interp(offset,profiles[0]["distanceMeters"],profiles[0]["elevationMeters"])
        blend=float(np.clip((gap-12)/10,0,1))
        blend=blend*blend*(3-2*blend)
        pit_heights.append(float(main_height*(1-blend)+height*blend))
    profiles[1]["elevationMeters"]=pit_heights
    dtm=source.copy(); gap_grid=np.full_like(dtm,np.inf); lower_floor=np.full_like(dtm,np.inf)
    for path,pf in zip((line,pit),profiles):
        distances=cumulative(path)
        for offset in np.arange(0,distances[-1],3):
            p=sample(path,distances,offset); col,row=(p[0]-BOUNDS["minX"])/STEP,(BOUNDS["maxY"]-p[1])/STEP
            left,right=max(0,int(col)-7),min(WIDTH,int(col)+8); top,bottom=max(0,int(row)-7),min(HEIGHT,int(row)+8)
            xx,yy=np.meshgrid(np.arange(left,right),np.arange(top,bottom)); gap=np.hypot((xx-col)*STEP,(yy-row)*STEP)
            old=gap_grid[top:bottom,left:right]; active=(gap<old)&(gap<32)
            floor=np.interp(offset,pf["distanceMeters"],pf["elevationMeters"])-.22
            blend=np.clip((32-gap)/14,0,1); ground=dtm[top:bottom,left:right]
            ground[active]=(source[top:bottom,left:right]*(1-blend)+floor*blend)[active]; old[active]=gap[active]
            # Adjacent pit and main-straight corridors share ground. The lower
            # envelope supports both roads; nearest-only ownership could raise
            # a terrain triangle through the lower road at the T14 merge.
            inner=gap<18
            floors=lower_floor[top:bottom,left:right]
            floors[inner]=np.minimum(floors[inner],floor)
    dtm=np.minimum(dtm,lower_floor)
    dtm.astype("<f4").tofile(PREPARED/"albert-park-dtm.f32le")
    write(PREPARED/"albert-park-road-profiles.json",profiles)
    write(PREPARED/"raster-metadata.json",{"rasters":{"dtm":{"width":WIDTH,"height":HEIGHT,"mean":float(dtm.mean())}},
        "terrainSurface":{"source":"Vicmap metropolitan contours and spot heights, reconstructed 5 m TIN grid","coordinateReferenceSystem":CRS,"verticalDatum":"Australian Height Datum (AHD)","nodataSamples":0},
        "roadGrading":{"maximumTerrainAdjustmentMeters":float(np.max(np.abs(dtm-source))),"method":"local contour-TIN to road grading; 64 m profile smoothing"}})
    event=json.loads((ROOT/"docs/track-model-albert-park-event-layout.json").read_text())
    vectors=[{k:v for k,v in w.items() if k!="refs"} for w in ways.values() if len(w["world"])>=2 and all(inside(p) for p in w["world"])]
    for f in event["features"]:
        tags={"name":f["name"],"event_source":"organizer-rolling-map","covered":"yes" if f["covered"] else "no"}
        if "Grandstand" in f["name"]:
            tags["grandstand"]="yes"
            footprint,adjustment=clip_stand(f["world"],line,pit)
        else:
            footprint,adjustment=f["world"],None
        if "Grandstand" not in f["name"]: tags.update({"building":"event_hospitality","height":"7.2"})
        vectors.append({"id":f["id"],"world":footprint,"tags":tags,"clearanceAdjustment":adjustment})
    config={"schemaVersion":4,"modelId":"albert-park","model":{"bounds":BOUNDS,"center":{"x":321430,"y":5809350},
        "centerline":line,"pitCenterline":pit,"turns":turns,"trackWidthMeters":12,"startFinishDistanceMeters":0,"osmRacewayIds":order},
        "officialControlPoints":{"referenceYear":2026,"currentEventVerified":True,"officialLapMeters":5278,
            "sectorLengthsMeters":[1753,1413,2112],"sectorBoundaryDistancesMeters":[turns[5]["distanceMeters"]-120,turns[8]["distanceMeters"]-140],
            "sectorReference":"120 m before T6; 140 m before T9, FIA 2026 map",
            "speedTrapDistanceMeters":turns[0]["distanceMeters"]-120,"speedTrapReference":"120 m before T1",
            "pitBoxes":45,"numberedPitBoxes":41,"letteredPitBoxes":4,"raceStartDistanceMeters":40,"raceStartDistanceEstimated":True},
        "vectors":vectors,"surfaceReferences":event["surfaceReferences"],"trees":[p for p in trees if inside(p)],
        "currentLayoutReconstruction":current_layout,
        "sourceManifest":json.loads((ROOT/"docs/track-model-albert-park-source-manifest.json").read_text()),
        "limitations":["SkySat surface imagery was captured 22 March 2018, before the 2022 track changes. The modern layout combines the organizer corridor with native OSM main straight, pit frontage and reviewed T11–T14 axes. T11's 12 m centre radius and T13's 1 m centre shift are reconstructed estimates constrained by FIA 2022 changes and the FIA 2026 map. Independent photo GCPs refine the southern registration; manual uncertainty is approximately 3 m. The terrain photograph outside the road mesh is retained without an authored asphalt band; this is not a newer satellite survey.",
            "SkySat is manually registered with approximately 5 m RMS; roof UV alignment is approximate, not surveyed orthophotogrammetry.",
            "Vicmap 1 m contours and spot heights are interpolated into a 5 m grid; no direct LiDAR DTM or city LoD2 dataset was available.",
            "Temporary stand and hospitality footprints follow the organizer rolling visitor map retrieved 3 October 2026. The map may already contain changes for the next event; it is not a frozen 2026 event survey.",
            "Facade details, seating rows, canopy profiles, most building heights and the race-start offset are reconstructed estimates. No unverified motorhomes are added."]}
    write(ROOT/".track-model-build/albert-park.json",config)
    review=aerial.resize((950,1080)); draw=ImageDraw.Draw(review)
    def pixel(p):return ((p[0]-BOUNDS["minX"])/2,(BOUNDS["maxY"]-p[1])/2)
    draw.line([pixel(p) for p in line],fill="cyan",width=2)
    draw.line([pixel(p) for p in pit],fill="yellow",width=2)
    for turn in turns: draw.text(pixel(sample(line,dc,turn["distanceMeters"])),str(turn["number"]),fill="white",stroke_width=1,stroke_fill="black")
    for f in vectors:
        if f["tags"].get("grandstand")=="yes" or f["tags"].get("building")=="event_hospitality":draw.line([pixel(p) for p in f["world"]+[f["world"][0]]],fill="orange",width=1)
    review.save(PREPARED/"source-review.jpg",quality=93)
    print(json.dumps({"lapMeters":dc[-1],"pitMeters":dp[-1],"turns":turns,"vectors":len(vectors),"trees":len(config["trees"])}))


if __name__=="__main__":main()
