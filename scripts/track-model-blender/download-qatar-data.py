#!/usr/bin/env python3
"""Cache Lusail's source snapshot; refresh only with an explicit --pin."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/qatar-source"
LOCK = ROOT / "docs/track-model-qatar-source-manifest.json"
BBOX = [51.443, 25.477, 51.462, 25.503]


def initial_sources():
    entries = [
        ("osm.xml", "https://www.openstreetmap.org/api/0.6/map?bbox=51.443,25.477,51.462,25.503", "current raceway, buildings, landscaping, service roads and barriers", "ODbL 1.0", "EPSG:4326", "OSM vector snapshot", "2026-10-05"),
        ("fia-2025-maps.pdf", "https://www.fia.com/system/files/decision-document/2025_qatar_grand_prix_-_event_notes_-_circuit_map._pit_lane_drawing_emergency_exits_map_ers_battery_containment_area_red_zones_map.pdf", "latest available FIA control points and 50 garage positions; reference only", "FIA/FOWC copyright; reference only", "diagram", "official vector map", "2025-11-27"),
        ("event-2026-map.webp", "https://www.lcsc.qa/sites/default/files/styles/avif_webp/public/2026-08/eventmap.png.webp?itok=SrVi--zB", "current promoter grandstand and hospitality locations; reference only", "Lusail International Circuit copyright; reference only", "diagram", "2050 x 1368 event map", "2026-08"),
        ("architect-pit.jpg", "https://cdn.prod.website-files.com/697e040e00eff1ea73b85774/6a3563aac783af210480ecba_Lusail-International-Circuit1.jpg", "post-2023 pit architecture and material colour reference", "Focus Design Partners / Lusail International Circuit copyright; reference only", "photograph", "architect photograph", "post-2023; exact capture date unknown"),
        ("main-grandstand.webp", "https://www.lcsc.qa/sites/default/files/styles/race_ticket_listing/public/2025-11/Grandstand%20main%20image_1.JPG.webp?itok=DNXEhYLn", "pit facade, grandstand canopy, run-off pattern and floodlights; reference only", "Lusail International Circuit copyright; reference only", "photograph", "8192 x 5464 photograph", "2025-11 publication; capture date unknown"),
    ]
    result = [dict(file=f, url=u, role=r, license=l, attribution=l, crs=c,
                   resolution=s, acquisitionDate=d, bbox=BBOX, verticalDatum=None,
                   redistributed=False) for f, u, r, l, c, s, d in entries]
    result.extend([
        dict(file="sentinel-20260930.tif", url="https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/39/R/WJ/2026/9/S2C_39RWJ_20260930_0_L2A/TCI.tif",
             role="licensed current true-colour ground image; coarse detail complemented by mapped OSM surfaces",
             license="Copernicus Sentinel data: free, full and open use", licenseUrl="https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice",
             attribution="Contains modified Copernicus Sentinel data (2026), processed by ESA; COG hosted by Element 84",
             crs="EPSG:32639", verticalDatum=None, resolution="native 10 m RGB", acquisitionDate="2026-09-30",
             bbox=BBOX, cropBounds=BBOX, downloadMethod="native-rgb-cog-window", redistributed=True),
        dict(file="gedtm30-native.tif", url="https://s3.opengeohub.org/global/edtm/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif",
             role="bare-earth terrain estimate; native unresampled COG crop",
             license="CC BY 4.0", licenseUrl="https://creativecommons.org/licenses/by/4.0/",
             attribution="OpenGeoHub / Ho et al. (2025), GEDTM30; cropped for RaceSide",
             crs="EPSG:4326", verticalDatum="EGM2008 orthometric metres (EPSG:3855)",
             resolution="1 arc-second / approximately 30 m", acquisitionDate="2006-2015 composite; v20250611",
             bbox=BBOX, cropBounds=BBOX, downloadMethod="native-cog-window", redistributed=True),
    ])
    return result


def crop(path, entry):
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="60"):
        with rasterio.open(entry["url"]) as source:
            bounds = transform_bounds("EPSG:4326", source.crs, *entry["cropBounds"])
            window = from_bounds(*bounds, source.transform).round_offsets().round_lengths()
            data = source.read(window=window)
            profile = source.profile.copy()
            profile.update(width=data.shape[2], height=data.shape[1],
                           transform=source.window_transform(window), tiled=False, compress="deflate")
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)
            with rasterio.open(path, "w", **profile) as output:
                output.write(data)
                output.scales, output.offsets = source.scales, source.offsets


def acquire(offline=False, pin=False):
    SOURCE.mkdir(parents=True, exist_ok=True)
    if not LOCK.exists() and not pin:
        raise FileNotFoundError("First reviewed Qatar snapshot requires --pin")
    entries = initial_sources() if pin else json.loads(LOCK.read_text())["sources"]

    def fetch(entry):
        path = SOURCE / entry["file"]
        if not path.exists():
            if offline:
                raise FileNotFoundError(f"Missing pinned Qatar source: {path}")
            temporary = path.with_suffix(path.suffix + ".download")
            if entry.get("downloadMethod"):
                crop(temporary, entry)
            else:
                request = urllib.request.Request(entry["url"], headers={"User-Agent": "RaceSide geographic model builder/1.0"})
                with urllib.request.urlopen(request, timeout=90) as response:
                    temporary.write_bytes(response.read())
            temporary.replace(path)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if "sha256" in entry and (entry["sha256"] != digest or entry["bytes"] != len(data)):
            raise ValueError(f"Pinned Qatar source changed: {path}")
        return {**entry, "sha256": digest, "bytes": len(data),
                "retrievedAt": entry.get("retrievedAt", date.today().isoformat())}

    with ThreadPoolExecutor(max_workers=4) as pool:
        sources = list(pool.map(fetch, entries))
    manifest = dict(schemaVersion=1, modelId="qatar", bbox=BBOX,
                    coordinateReferenceSystem="EPSG:32639", sources=sources)
    encoded = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if pin:
        LOCK.write_text(encoded)
    (SOURCE / "source-manifest.json").write_text(encoded)
    print(f"Qatar: verified {len(sources)} pinned sources", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--pin", action="store_true")
    args = parser.parse_args()
    acquire(args.offline, args.pin)
