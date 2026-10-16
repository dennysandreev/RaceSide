#!/usr/bin/env python3
"""Cache Shanghai's reviewed source snapshot; never silently refresh a lock."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/shanghai-source"
LOCK = ROOT / "docs/track-model-shanghai-source-manifest.json"
BBOX = [121.207, 31.326, 121.236, 31.353]


def initial_sources():
    sources = [
        ("osm.xml", "https://www.openstreetmap.org/api/0.6/map?bbox=121.207,31.326,121.236,31.353", "raceway, pit, permanent buildings, grandstands, water, barriers and vegetation", "ODbL 1.0", "EPSG:4326", "OSM vector snapshot", "2026-10-03"),
        ("skysat-2018.jpg", "https://upload.wikimedia.org/wikipedia/commons/0/07/Shanghai_International_Circuit%2C_April_7%2C_2018_SkySat.jpg", "licensed ground texture and permanent roof colors; historical capture", "CC BY-SA 4.0; Planet Labs, Inc.; georegistered and cropped", "image pixels; registered separately", "3454 x 2591 SkySat image", "2018-04-07"),
        ("fia-2026-map.pdf", "https://www.fia.com/system/files/decision-document/2026_chinese_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_emergency_exits_map_battery_containment_area_and_red_zone.pdf", "2026 sporting controls, pit garages and event layout; reference only", "FIA/FOWC copyright; reference only, not embedded", "diagram", "official vector map", "2026-03-12"),
        ("fia-2026-media-kit.pdf", "https://www.fia.com/sites/default/files/media_kit-formula_1_heineken_chinese_grand_prix_2026.pdf", "current permanent architecture and material reference", "FIA/Juss copyright; reference only, not embedded", "document", "official media kit", "2026-03"),
        ("event-2026-stands.png", "https://english.shanghai.gov.cn/cmsres/59/596077c5ef8441e09eb5239fd740b25b/29a1050812c99e3abd007407e8a1b81a.png", "2026 promoter grandstand locations including upgraded E", "Shanghai government/Juss copyright; reference only, not embedded", "diagram", "official event map", "2026-03-11"),
        ("tilke-main-complex.jpg", "https://www.tilkeandpartners.com/Images/shanghaicircuit/99.jpg", "architect's main grandstand, bridges, roofs and colors", "Tilke & Partners copyright; reference only, not embedded", "photograph", "architect photograph", "capture date unknown"),
    ]
    result = [{"file": f, "url": u, "role": r, "license": l, "crs": c, "resolution": s,
               "acquisitionDate": d, "bbox": BBOX, "verticalDatum": None,
               "attribution": l, "redistributed": f == "skysat-2018.jpg"} for f,u,r,l,c,s,d in sources]
    result.append({"file": "gedtm30-native.tif",
        "url": "https://s3.opengeohub.org/global/edtm/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif",
        "role": "bare-earth height estimate, native unresampled COG window",
        "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "OpenGeoHub / Ho et al. (2025), GEDTM30; cropped for RaceSide",
        "crs": "EPSG:4326", "verticalDatum": "EGM2008 orthometric metres (EPSG:3855)",
        "resolution": "1 arc-second / approximately 30 m native DTM", "bbox": BBOX,
        "cropBounds": BBOX, "downloadMethod": "native-cog-window", "redistributed": True,
        "acquisitionDate": "2006-2015 composite; v20250611"})
    return result


def acquire(offline=False, pin=False):
    SOURCE.mkdir(parents=True, exist_ok=True)
    if not LOCK.exists() and not pin:
        raise FileNotFoundError("First source review requires --pin")
    entries = json.loads(LOCK.read_text())["sources"] if LOCK.exists() else initial_sources()

    def fetch(entry):
        path = SOURCE / entry["file"]
        if not path.exists():
            if offline:
                raise FileNotFoundError(f"Missing pinned Shanghai source: {path}")
            temp = path.with_suffix(path.suffix + ".download")
            if entry.get("downloadMethod") == "native-cog-window":
                import importlib.util
                spec = importlib.util.spec_from_file_location("cog_download", Path(__file__).with_name("download-mexico-data.py"))
                helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(helper)
                helper.crop_terrain(temp, entry)
            else:
                request = urllib.request.Request(entry["url"], headers={"User-Agent": "RaceSide geographic model builder/1.0"})
                with urllib.request.urlopen(request, timeout=90) as response:
                    temp.write_bytes(response.read())
            temp.replace(path)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if "sha256" in entry and (entry["sha256"] != digest or entry["bytes"] != len(data)):
            raise ValueError(f"Pinned Shanghai source changed: {path}")
        return {**entry, "sha256": digest, "bytes": len(data), "retrievedAt": entry.get("retrievedAt", "2026-10-03")}

    with ThreadPoolExecutor(max_workers=4) as pool:
        sources = list(pool.map(fetch, entries))
    manifest = {"schemaVersion": 1, "modelId": "shanghai", "bbox": BBOX,
                "coordinateReferenceSystem": "EPSG:32651", "sources": sources}
    encoded = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if pin:
        LOCK.write_text(encoded)
    (SOURCE / "source-manifest.json").write_text(encoded)
    print(f"Shanghai: verified {len(sources)} pinned sources", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--pin", action="store_true")
    args = parser.parse_args()
    acquire(args.offline, args.pin)
