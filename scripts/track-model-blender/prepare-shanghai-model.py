#!/usr/bin/env python3
"""Prepare Shanghai's own pinned vectors, registered imagery and native DTM."""
from bisect import bisect_right
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/shanghai-source"
PREPARED = ROOT / ".track-model-build/shanghai-prepared"
CRS = "EPSG:32651"
BOUNDS = {"minX": 329880, "minY": 3467930, "maxX": 331620, "maxY": 3469550}
TURN_VERTICES = [12, 33, 53, 68, 75, 84, 111, 135, 148, 160, 175, 190, 212, 235, 245, 252]

spec = importlib.util.spec_from_file_location("shanghai_metric", Path(__file__).with_name("prepare-austin-model.py"))
metric = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metric)
cumulative, sample, nearest = metric.cumulative, metric.sample, metric.nearest


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def project(points):
    xs, ys = transform("EPSG:4326", CRS, [p[0] for p in points], [p[1] for p in points])
    return [list(p) for p in zip(xs, ys)]


def read_osm():
    root = ET.parse(SOURCE / "osm.xml").getroot()
    nodes = root.findall("node")
    positions = dict(zip([n.get("id") for n in nodes], project([[float(n.get("lon")), float(n.get("lat"))] for n in nodes])))
    ways = {}
    for w in root.findall("way"):
        refs = [n.get("ref") for n in w.findall("nd")]
        if not all(ref in positions for ref in refs):
            continue
        ways[int(w.get("id"))] = {"id": int(w.get("id")), "refs": refs,
            "tags": {t.get("k"): t.get("v") for t in w.findall("tag")}, "world": [positions[ref] for ref in refs]}
    source_line = ways[156328670]["world"]
    if ways[156328670]["refs"][0] != ways[156328670]["refs"][-1]:
        raise ValueError("Shanghai OSM circuit is not closed")
    # The relation's tagged start is the reviewed control-line position.
    start = ways[156328670]["refs"].index("1686043686")
    line = source_line[start:-1] + source_line[:start+1]
    dist = cumulative(line)
    if abs(dist[-1]-5451)/5451 > .005:
        raise ValueError("Shanghai source exceeds 0.5% FIA lap-length tolerance")
    turns = [{"number": n, "distanceMeters": nearest(line, dist, source_line[i])[1],
              "sourceVertex": i, "sourceWayId": 156328670} for n,i in enumerate(TURN_VERTICES, 1)]
    pit = ways[107371147]["world"] + ways[107371138]["world"][1:]
    if math.dist(ways[107371147]["world"][-1], ways[107371138]["world"][0]) > .01:
        raise ValueError("Shanghai pit ways are disconnected")
    pit[0] = sample(line, dist, nearest(line, dist, pit[0])[1])
    pit[-1] = sample(line, dist, nearest(line, dist, pit[-1])[1])
    trees = [positions[n.get("id")] for n in nodes if any(t.get("k") == "natural" and t.get("v") == "tree" for t in n.findall("tag"))]
    return ways, source_line, line, pit, turns, trees


class ImageRegistration:
    """Metric-to-image TPS with an affine tail and a numerical inverse."""
    def __init__(self, registration, source_line):
        self.origin = np.asarray(registration["originMeters"])
        controls = registration["groundControlPoints"]
        self.world = np.asarray([source_line[p["vertex"]] for p in controls])
        self.pixels = np.asarray([p["pixel"] for p in controls])
        self.normalized = (self.world-self.origin)/1000
        affine = np.c_[np.ones(len(self.world)), self.normalized]
        kernel = self.radial(self.normalized[:,None]-self.normalized[None,:])
        system = np.block([[kernel+np.eye(len(kernel))*registration["regularization"], affine],
                           [affine.T, np.zeros((3,3))]])
        self.coefficients = np.linalg.solve(system, np.r_[self.pixels, np.zeros((3,2))])
        self.affine = np.linalg.lstsq(np.c_[self.world-self.origin,np.ones(len(self.world))],self.pixels,rcond=None)[0]

    @staticmethod
    def radial(difference):
        squared = np.sum(difference*difference,axis=-1)
        return squared*np.log(np.maximum(squared,1e-20))

    def forward(self, world):
        points = (np.asarray(world)-self.origin)/1000
        return (np.c_[np.ones(len(points)),points] @ self.coefficients[len(self.world):]
                + self.radial(points[:,None]-self.normalized[None,:]) @ self.coefficients[:len(self.world)])

    def jacobian(self, world):
        points = np.asarray(world)
        value = self.forward(points)
        return np.stack([(self.forward(points+[1,0])-value),
                         (self.forward(points+[0,1])-value)],axis=-1)

    def inverse(self, pixel):
        point = self.origin + np.linalg.solve(self.affine[:2].T,np.asarray(pixel)-self.affine[2])
        for _ in range(12):
            residual = self.forward([point])[0]-pixel
            if np.linalg.norm(residual)<1e-6:
                return point
            point -= np.linalg.solve(self.jacobian([point])[0],residual)
        raise ValueError("Shanghai roof control cannot be inverted")


def registered_aerial(source_line):
    # Ground and roof controls are separate: an OSM pavilion offset must not
    # distort the correctly registered adjacent road, pond and footbridges.
    registration_path = ROOT / "docs/track-model-shanghai-skysat-registration.json"
    registration = json.loads(registration_path.read_text())
    mapping = ImageRegistration(registration,source_line)
    residual = np.linalg.norm(mapping.forward(mapping.world)-mapping.pixels,axis=1)
    checkpoints = registration["independentCheckPoints"]
    check_world = np.asarray([source_line[p["vertex"]] for p in checkpoints])
    check_residual = np.linalg.norm(mapping.forward(check_world)-[p["pixel"] for p in checkpoints],axis=1)
    if check_residual.max()>8 or np.sqrt(np.mean(check_residual**2))>6:
        raise ValueError("Shanghai image fails independent road registration checks")
    width, height = 3072, 2860
    xs, ys = np.meshgrid(np.linspace(BOUNDS["minX"], BOUNDS["maxX"], width),
                         np.linspace(BOUNDS["maxY"], BOUNDS["minY"], height))
    coords = np.empty((height,width,2),dtype=np.float32)
    for row in range(0,height,32):
        points = np.stack((xs[row:row+32],ys[row:row+32]),axis=-1)
        coords[row:row+32] = mapping.forward(points.reshape(-1,2)).reshape(points.shape)
    probe = np.stack((xs[::64,::64],ys[::64,::64]),axis=-1).reshape(-1,2)
    determinants = np.linalg.det(mapping.jacobian(probe))
    if determinants.max()>=-.5 or determinants.min()<=-3:
        raise ValueError("Shanghai registration folds or excessively stretches the image")
    source = cv2.imread(str(SOURCE / "skysat-2018.jpg"))
    if coords[:,:,0].min()<0 or coords[:,:,1].min()<0 or coords[:,:,0].max()>=source.shape[1] or coords[:,:,1].max()>=source.shape[0]:
        raise ValueError("Shanghai source image does not cover the scene")
    output = cv2.remap(source, coords[:,:,0].astype(np.float32), coords[:,:,1].astype(np.float32), cv2.INTER_CUBIC)
    image = Image.fromarray(output[:,:,::-1])
    image.save(PREPARED / "shanghai-orthophoto.jpg", quality=88)
    audit = {**registration, "affineTailMatrix": mapping.affine.tolist(), "tpsCoefficients":mapping.coefficients.tolist(),
             "residualPixels": residual.tolist(),
             "rmsResidualPixels": float(np.sqrt(np.mean(residual**2))),
             "maximumResidualPixels": float(residual.max()), "outputPixels": [width,height],
             "independentResidualPixels":check_residual.tolist(),
             "independentRmsResidualPixels":float(np.sqrt(np.mean(check_residual**2))),
             "independentMaximumResidualPixels":float(check_residual.max()),
             "jacobianDeterminantRange": [float(determinants.min()),float(determinants.max())],
             "registrationSha256":hashlib.sha256(registration_path.read_bytes()).hexdigest(),
             "sourceSha256": hashlib.sha256((SOURCE / "skysat-2018.jpg").read_bytes()).hexdigest()}
    write(PREPARED / "raster-registration-audit.json", audit)
    return image, audit, mapping


def terrain(paths):
    width, height = 436, 406
    xs, ys = np.meshgrid(np.linspace(BOUNDS["minX"], BOUNDS["maxX"], width),
                         np.linspace(BOUNDS["maxY"], BOUNDS["minY"], height))
    with rasterio.open(SOURCE / "gedtm30-native.tif") as source:
        lon, lat = transform(CRS, source.crs, xs.ravel(), ys.ravel())
        grid = source.read(1).astype(np.float32)*source.scales[0]+source.offsets[0]
        col, row = (~source.transform)*(np.asarray(lon),np.asarray(lat))
        values = cv2.remap(grid, (col-.5).reshape(xs.shape).astype(np.float32),
                           (row-.5).reshape(xs.shape).astype(np.float32), cv2.INTER_LINEAR)
    if not np.isfinite(values).all() or values.min() < -5 or values.max() > 60:
        raise ValueError("Invalid Shanghai native DTM window")
    def at(point):
        col = (point[0]-BOUNDS["minX"])/4
        row = (BOUNDS["maxY"]-point[1])/4
        return float(cv2.remap(values,np.float32([[col]]),np.float32([[row]]),cv2.INTER_LINEAR)[0,0])
    profiles = []
    for i,path in enumerate(paths):
        distances = cumulative(path)
        steps = np.linspace(0,distances[-1],math.ceil(distances[-1]/2)+1)
        raw = np.array([at(sample(path,distances,float(d))) for d in steps],dtype=np.float32)
        if i == 0:
            padded = np.r_[raw[-151:-1],raw,raw[1:151]]
            smooth = cv2.GaussianBlur(padded.reshape(1,-1),(301,1),45).ravel()[150:-150]
            smooth[-1] = smooth[0]
        else:
            smooth = cv2.GaussianBlur(raw.reshape(1,-1),(301,1),45).ravel()
        profiles.append({"distanceMeters": steps.tolist(), "elevationMeters": smooth.tolist()})
    main_dist = cumulative(paths[0])
    # Parallel pit and main-straight profiles share the same graded platform.
    # Independently smoothing a 30 m DTM across these adjacent paths creates
    # a false embankment between them and can raise terrain through the road.
    pit_profile = profiles[1]
    for i,d in enumerate(pit_profile["distanceMeters"]):
        gap,offset = nearest(paths[0],main_dist,sample(paths[1],cumulative(paths[1]),d))
        weight = float(np.clip((35-gap)/15,0,1))
        target = float(np.interp(offset,profiles[0]["distanceMeters"],profiles[0]["elevationMeters"]))
        pit_profile["elevationMeters"][i] = pit_profile["elevationMeters"][i]*(1-weight)+target*weight
    for endpoint in [0,-1]:
        offset = nearest(paths[0],main_dist,paths[1][endpoint])[1]
        target = np.interp(offset,profiles[0]["distanceMeters"],profiles[0]["elevationMeters"])
        p = profiles[1]
        distances = np.asarray(p["distanceMeters"])
        weight = np.clip(1-(distances if endpoint == 0 else distances[-1]-distances)/60,0,1)
        p["elevationMeters"] = (np.asarray(p["elevationMeters"])*(1-weight)+target*weight).tolist()
    graded, separation = values.copy(), np.full(values.shape,np.inf,dtype=np.float32)
    for path,profile in zip(paths,profiles):
        distances = cumulative(path)
        for d in np.arange(0,distances[-1]+.001,2):
            point = sample(path,distances,float(d))
            col,row = (point[0]-BOUNDS["minX"])/4,(BOUNDS["maxY"]-point[1])/4
            left,right = max(0,int(col)-9),min(width,int(col)+10)
            top,bottom = max(0,int(row)-9),min(height,int(row)+10)
            xx,yy = np.meshgrid(np.arange(left,right),np.arange(top,bottom))
            gap = np.hypot((xx-col)*4,(yy-row)*4)
            region = separation[top:bottom,left:right]
            active = gap < region
            weight = np.clip((34-gap)/17,0,1)
            weight = weight*weight*(3-2*weight)
            elevation = np.interp(d,profile["distanceMeters"],profile["elevationMeters"])-.20
            target = values[top:bottom,left:right]*(1-weight)+elevation*weight
            graded[top:bottom,left:right][active] = target[active]
            region[active] = gap[active]
    graded.astype("<f4").tofile(PREPARED / "shanghai-dtm.f32le")
    write(PREPARED / "shanghai-road-profiles.json",profiles)
    metadata = {"rasters":{"dtm":{"width":width,"height":height,"mean":float(graded.mean())}},
        "terrainSurface":{"source":"GEDTM30 native bare-earth estimate, 30 m", "coordinateReferenceSystem":CRS,
                          "verticalDatum":"EGM2008 orthometric metres (EPSG:3855)","nodataSamples":0},
        "roadGrading":{"maximumTerrainAdjustmentMeters":float(np.max(np.abs(graded-values))),
                       "method":"90 m Gaussian road-profile smoothing; shared main-straight/pit platform and local terrain grading; no height exaggeration"}}
    write(PREPARED / "raster-metadata.json",metadata)
    return metadata


def main():
    PREPARED.mkdir(parents=True,exist_ok=True)
    ways,source_line,line,pit,turns,trees = read_osm()
    image,registration,mapping = registered_aerial(source_line)
    corrected=[]
    for control in registration["buildingCorrections"]:
        feature=ways[control["wayId"]]
        original=np.asarray(feature["world"])
        center=original[:-1].mean(axis=0)
        target=mapping.inverse(control["roofCenterPixel"])
        translation=target-center
        feature["sourceWorld"]=feature["world"]
        feature["world"]=(original+translation).tolist()
        feature["registrationCorrectionMeters"]=translation.tolist()
        corrected.append({**control,"translationMeters":translation.tolist(),
            "beforeResidualPixels":float(np.linalg.norm(mapping.forward([center])[0]-control["roofCenterPixel"])),
            "afterResidualPixels":float(np.linalg.norm(mapping.forward([target])[0]-control["roofCenterPixel"]))})
    registration["buildingCorrections"]=corrected
    roof_corrections=[]
    for control in registration["roofFootprintCorrections"]:
        feature=ways[control["wayId"]]
        feature["sourceWorld"]=feature["world"]
        feature["world"]=[mapping.inverse(pixel).tolist() for pixel in control["roofFootprintPixels"]]
        feature["footprintMethod"]=control["method"]
        roof_corrections.append({**control,"maximumReprojectionResidualPixels":max(
            float(np.linalg.norm(mapping.forward([point])[0]-pixel))
            for point,pixel in zip(feature["world"],control["roofFootprintPixels"]))})
    registration["roofFootprintCorrections"]=roof_corrections
    write(PREPARED / "raster-registration-audit.json",registration)
    terrain([line,pit])
    def inside(p):
        return BOUNDS["minX"]<=p[0]<=BOUNDS["maxX"] and BOUNDS["minY"]<=p[1]<=BOUNDS["maxY"]
    vectors = [{k:v for k,v in f.items() if k!="refs"} for f in ways.values() if all(inside(p) for p in f["world"])]
    # Separate the terrace from the two bridge arms of the combined OSM roof.
    main_roof = ways[107371135]["world"]
    terrace = [main_roof[i] for i in [2,3,12,14,2]]
    for f in vectors:
        if f["tags"].get("building")=="grandstand":
            f["tags"]["grandstand"]="yes"
        if f["id"]==107371135:
            f["combinedRoofWorld"]=f["world"]
            f["world"]=terrace
            f["tags"]["name"]="A"
    config={"schemaVersion":4,"modelId":"shanghai","model":{"bounds":BOUNDS,
        "center":{"x":330750,"y":3468740},"centerline":line,"pitCenterline":pit,"turns":turns,
        "trackWidthMeters":13,"startFinishDistanceMeters":0,"osmRacewayIds":[156328670]},
        "officialControlPoints":{"referenceYear":2026,"currentEventVerified":True,"officialLapMeters":5451,
            "sectorLengthsMeters":[1430,1569,2452],"sectorBoundaryDistancesMeters":[1430,2999],
            "sectorReference":"150 m before T6; 145 m before T11; FIA v4 11.03.26",
            "speedTrapDistanceMeters":turns[13]["distanceMeters"]-240,"speedTrapReference":"240 m before T14",
            "pitBoxes":33,"fiaGarages":3,"raceStartDistanceMeters":130},
        "vectors":vectors,"trees":[p for p in trees if inside(p)],
        "sourceManifest":json.loads((SOURCE / "source-manifest.json").read_text()),"rasterRegistration":registration,
        "limitations":["Ground image is licensed Planet SkySat 7 April 2018, not an event-date 2026 orthophoto. Permanent features checked against FIA/Juss 2026; advertising is historical.",
            "JPEG ground registration uses reviewed spline controls and independent checkpoints; pavilion offsets in OSM are corrected against observed roofs. This is a visual reconstruction, not an orthorectified engineering survey.",
            "GEDTM30 is a 30 m bare-earth estimate. Road profile is smoothed and terrain graded locally; camber and engineering elevations are not surveyed.",
            "No openly published national LoD2/DSM registry was found for this venue. OSM heights/footprints and architect/FIA photos supply reconstructed roof shapes and facade detail.",
            "E uses observed permanent terrace sections corroborated by the 2026 promoter map; the exact upgraded 2026 seat/temporary hospitality survey is unavailable.",
            "Unverified 2026 parked trucks, small tents and mobile team motorhomes are omitted; Shanghai's mapped permanent over-water hospitality pavilions are included."]}
    write(ROOT / ".track-model-build/shanghai.json",config)
    review=image.resize((1540,1434))
    draw=ImageDraw.Draw(review)
    def pixel(p):
        return ((p[0]-BOUNDS["minX"])/1740*1540,(BOUNDS["maxY"]-p[1])/1620*1434)
    draw.line([pixel(p)for p in line],fill="cyan",width=2)
    for f in vectors:
        if f["tags"].get("building"):
            draw.line([pixel(p)for p in f["world"]],fill="yellow",width=1)
    review.save(PREPARED / "source-review.jpg",quality=94)
    print(json.dumps({"lapMeters":cumulative(line)[-1],"vectors":len(vectors),"registrationRmsPixels":registration["rmsResidualPixels"]}))


if __name__=="__main__":
    main()
