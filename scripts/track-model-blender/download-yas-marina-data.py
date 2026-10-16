#!/usr/bin/env python3
"""Acquire the reviewed Yas Marina snapshot, then verify its immutable lock."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/yas-marina-source"
LOCK = ROOT / "docs/track-model-yas-marina-source-manifest.json"
BBOX = [54.592, 24.461, 54.617, 24.491]


def initial_sources():
    entries = []
    for i, (south, north) in enumerate([(24.461, 24.471), (24.471, 24.481), (24.481, 24.491)]):
        entries.append((f"osm-part-{i}.xml",
            f"https://api.openstreetmap.org/api/0.6/map?bbox=54.592,{south},54.617,{north}",
            "current raceway, tunnel, buildings, grandstands and barriers",
            "ODbL 1.0; © OpenStreetMap contributors", "EPSG:4326", "vector snapshot", "2026-10-05"))
    entries += [
        ("fia-2025-map.pdf", "https://www.fia.com/system/files/decision-document/2025_yas_marina_event_-_circuit_map_-_yas_marina_2025.pdf",
         "FIA v4 F1 centreline, 16 turns, sectors, speed trap; reference only",
         "FIA/FOWC copyright; reference only, not embedded", "diagram", "vector circuit map", "2025-12-04"),
        ("fia-2025-media-kit.pdf", "https://api.fia.com/sites/default/files/media_kit-2025_abu_dhabi_gp.pdf",
         "promoter permanent grandstands, paddock, marina and event reference",
         "FIA/Ethara copyright; reference only, not embedded", "document", "official media kit", "2025-12"),
        ("hotel-engineer.html", "https://www.sbp.de/en/project/yas-hotel/",
         "structural engineer: hotel glass gridshell dimensions and daytime materials",
         "sbp copyright; reference only, not embedded", "document", "engineer project record", "2009"),
        ("promoter-2026.html", "https://www.yasmarinacircuit.com/en/home",
         "current promoter record; future 2026 event, no event-day survey available",
         "Ethara copyright; reference only, not embedded", "document", "official website", "2026-10-05"),
    ]
    sources = [{"file": f, "url": u, "role": r, "license": l, "attribution": l,
        "crs": c, "resolution": res, "acquisitionDate": date, "bbox": BBOX,
        "verticalDatum": None, "redistributed": False}
        for f, u, r, l, c, res, date in entries]
    sources.append({"file": "gedtm30-native.tif",
        "url": "https://s3.opengeohub.org/global/edtm/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif",
        "role": "native bare-earth height estimate; not surveyed track camber",
        "license": "CC BY 4.0", "attribution": "OpenGeoHub / Ho et al. (2025), GEDTM30; cropped for RaceSide",
        "crs": "EPSG:4326", "verticalDatum": "EGM2008 orthometric metres (EPSG:3855)",
        "resolution": "1 arc-second / approximately 30 m", "bbox": BBOX, "cropBounds": BBOX,
        "downloadMethod": "native-cog-window", "acquisitionDate": "2006–2015 composite; v20250611", "redistributed": True})
    sources.append({"file": "sentinel-20261004.tif",
        "url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/40/R/BN/2026/10/S2C_40RBN_20261004_0_L2A/TCI.tif",
        "role": "current true-colour ground image with native georeferencing; 10 m optical resolution",
        "license": "Copernicus Sentinel data: free, full and open use",
        "licenseUrl": "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice",
        "attribution": "Contains modified Copernicus Sentinel data (2026), processed by ESA; COG hosted by Element 84",
        "crs": "EPSG:32640", "resolution": "native 10 m RGB; no invented high-resolution detail",
        "acquisitionDate": "2026-10-04T07:02:46.125000Z", "bbox": BBOX, "cropBounds": BBOX,
        "verticalDatum": None, "downloadMethod": "native-rgb-cog-window", "redistributed": True})
    return sources


def acquire(offline=False, pin=False):
    SOURCE.mkdir(parents=True, exist_ok=True)
    if not LOCK.exists() and not pin:
        raise FileNotFoundError("First source review requires --pin")
    entries = json.loads(LOCK.read_text())["sources"] if LOCK.exists() else initial_sources()

    def fetch(entry):
        path = SOURCE / entry["file"]
        if entry.get("downloadMethod") == "project-file":
            shutil.copyfile(ROOT / entry["projectPath"], path)
        if not path.exists():
            if offline:
                raise FileNotFoundError(f"Missing pinned Yas Marina source: {path}")
            temporary = path.with_suffix(path.suffix + ".download")
            if entry.get("downloadMethod") == "native-rgb-cog-window":
                spec = importlib.util.spec_from_file_location("rgb_cog_download", Path(__file__).with_name("download-qatar-data.py"))
                helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(helper)
                helper.crop(temporary, entry)
            elif entry.get("downloadMethod") == "native-cog-window":
                spec = importlib.util.spec_from_file_location("cog_download", Path(__file__).with_name("download-mexico-data.py"))
                helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(helper)
                helper.crop_terrain(temporary, entry)
            else:
                request = urllib.request.Request(entry["url"], headers={"User-Agent": "RaceSide geographic asset builder/1.0"})
                with urllib.request.urlopen(request, timeout=120) as response:
                    temporary.write_bytes(response.read())
            temporary.replace(path)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if "sha256" in entry and (entry["sha256"] != digest or entry["bytes"] != len(data)):
            raise ValueError(f"Pinned source changed: {path}; explicit source review required")
        return {**entry, "sha256": digest, "bytes": len(data), "retrievedAt": entry.get("retrievedAt", "2026-10-05")}

    with ThreadPoolExecutor(max_workers=4) as pool:
        sources = list(pool.map(fetch, entries))
    manifest = {"schemaVersion": 1, "modelId": "yas-marina", "bbox": BBOX,
                "coordinateReferenceSystem": "EPSG:32640", "sources": sources}
    encoded = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if pin:
        LOCK.write_text(encoded)
    (SOURCE / "source-manifest.json").write_text(encoded)
    osm = ET.Element("osm", version="0.6")
    seen = set()
    for i in range(3):
        for element in ET.parse(SOURCE / f"osm-part-{i}.xml").getroot():
            key = element.tag, element.get("id")
            if key not in seen and element.tag in ("node", "way", "relation"):
                osm.append(element)
                seen.add(key)
    ET.ElementTree(osm).write(SOURCE / "osm.xml", encoding="utf-8", xml_declaration=True)
    print(f"Yas Marina: verified {len(sources)} pinned sources", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--pin", action="store_true")
    args = parser.parse_args()
    acquire(args.offline, args.pin)
