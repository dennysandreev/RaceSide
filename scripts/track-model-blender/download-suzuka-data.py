#!/usr/bin/env python3
"""Acquire and verify Suzuka's immutable source snapshot. No live data in the UI."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/suzuka-source"
LOCK = ROOT / "docs/track-model-suzuka-source-manifest.json"
BBOX = [136.519, 34.836, 136.547, 34.851]
GSI_LICENSE = "Public Data License 1.0; Geospatial Information Authority of Japan"
GSI_ATTRIBUTION = "Contains modified GSI Japan tiles; https://maps.gsi.go.jp/development/ichiran.html"


def tile(lon, lat, zoom):
    n = 2 ** zoom
    return (int((lon + 180) / 360 * n),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def requests():
    entries = [
        ("osm.xml", "https://www.openstreetmap.org/api/0.6/map?bbox=136.510,34.830,136.557,34.858",
         "raceway, pit lane, building and bleacher footprints, barriers and vegetation", "ODbL 1.0", "EPSG:4326", "OSM vector", "2026-10-03"),
        ("fia-2026-japan-map.pdf", "https://www.fia.com/system/files/decision-document/2026_japanese_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_emergency_exits_map_battery_containment_area_and_red_zone.pdf",
         "2026 sporting controls, 5807 m, 18 turns, 55 garage positions; reference only", "FIA/FOWC copyright; reference only, not embedded", "diagram", "official vector map", "2026-03-26"),
        ("suzuka-2026-park-map.pdf", "https://www.suzukacircuit.jp/map_s/pdf/suzuka_mp_guide_en.pdf",
         "permanent park infrastructure and wheel; reference only", "Suzuka Circuit copyright; reference only, not embedded", "diagram", "official park map", "2026-03"),
        ("plateau-catalog.json", "https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets",
         "national LoD building availability audit: no Suzuka city 24207 dataset", "MLIT open-data catalogue", "catalogue", "dataset catalogue", "2026-10-03"),
        ("circuit-wheel.jpg", "https://www.suzukacircuit.jp/eng/park/attraction/circuit-wheel/images/mainimg_sp.jpg",
         "wheel colors and 50 m silhouette; visual reference only", "Suzuka Circuit copyright; reference only, not embedded", "photograph", "740 px photograph", "capture date unknown"),
        ("main-grandstand.jpg", "https://www.suzukacircuit.jp/eng/f1/ticket/images/seat/v2/img_v_01.jpg",
         "permanent main grandstand colors and roof shape; visual reference only", "Suzuka Circuit copyright; reference only, not embedded", "photograph", "official photograph", "capture date unknown"),
    ]
    for dataset, zoom, extension, role, resolution in [
        ("seamlessphoto", 18, "jpg", "orthophoto; ground and roof textures", "approx. 0.49 m/pixel at Suzuka; acquisition date not supplied by tile endpoint"),
        ("dem5a_png", 15, "png", "GSI bare-earth DTM; national 5 m DEM", "5 m source, approx. 3.9 m/pixel tile sampling"),
        ("dem_png", 14, "png", "GSI DEM10B; fill only DEM5A no-data pixels", "10 m source, approx. 7.8 m/pixel tile sampling"),
    ]:
        x0, y1 = tile(BBOX[0], BBOX[1], zoom)
        x1, y0 = tile(BBOX[2], BBOX[3], zoom)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                entries.append((f"{dataset}/{zoom}-{x}-{y}.{extension}",
                    f"https://cyberjapandata.gsi.go.jp/xyz/{dataset}/{zoom}/{x}/{y}.{extension}",
                    role, GSI_LICENSE, "EPSG:3857 tile grid", resolution, "latest GSI tile snapshot; capture date unknown"))
    return entries


def acquire(offline=False, pin=False):
    SOURCE.mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        manifest = json.loads(LOCK.read_text())
        expected = {entry["file"]: entry for entry in manifest["sources"]}
        entries = [(e["file"], e["url"], e["role"], e["license"], e["crs"], e["resolution"], e["date"])
                   for e in manifest["sources"]]
        if pin:
            entries.extend(entry for entry in requests() if entry[0] not in expected)
    else:
        if not pin:
            raise FileNotFoundError("Review and pin the initial source set with --pin")
        expected, entries = {}, requests()

    def fetch(entry):
        file, url, role, license, crs, resolution, date = entry
        path = SOURCE / file
        if not path.exists():
            if offline:
                raise FileNotFoundError(f"Missing pinned Suzuka source: {file}")
            for attempt in range(3):
                try:
                    request = urllib.request.Request(url, headers={"User-Agent": "RaceSide geographic asset builder/1.0"})
                    with urllib.request.urlopen(request, timeout=90) as response:
                        data = response.read()
                    path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = path.with_suffix(path.suffix + ".download")
                    temporary.write_bytes(data)
                    temporary.replace(path)
                    break
                except Exception as error:
                    if attempt == 2:
                        raise RuntimeError(f"Cannot download Suzuka source {file}: {url}") from error
                    time.sleep(1 + attempt)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if file in expected:
            e = expected[file]
            if digest != e["sha256"] or len(data) != e["bytes"]:
                raise ValueError(f"Suzuka pinned source changed: {file}")
            return e
        return {"file": file, "url": url, "role": role, "license": license, "date": date,
                "retrievedAt": "2026-10-03", "crs": crs, "bbox": BBOX,
                "verticalDatum": "GSI orthometric metres, Tokyo Peil" if file.startswith("dem") else None,
                "resolution": resolution, "bytes": len(data), "sha256": digest,
                "attribution": GSI_ATTRIBUTION if "gsi.go.jp" in url else license}

    with ThreadPoolExecutor(max_workers=6) as pool:
        sources = list(pool.map(fetch, entries))
    manifest = {"schemaVersion": 1, "modelId": "suzuka", "bbox": BBOX,
                "coordinateReferenceSystem": "EPSG:32653", "retrievedAt": "2026-10-03", "sources": sources}
    serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if pin or not LOCK.exists():
        LOCK.write_text(serialized)
    (SOURCE / "source-manifest.json").write_text(serialized)
    print(f"Suzuka: verified {len(sources)} pinned sources ({sum(e['bytes'] for e in sources):,} bytes)")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--pin", action="store_true")
    args = parser.parse_args()
    acquire(args.offline, args.pin)
