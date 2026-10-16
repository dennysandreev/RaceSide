#!/usr/bin/env python3
"""Verify the reviewed Mexico source snapshot and fetch only missing files.

The source lock is committed separately from the build cache. Upstream changes
never update that lock implicitly. The GEDTM source is a native, unresampled
window from a public Cloud Optimized GeoTIFF; rasterio is needed only when this
one cached window is missing, not by the website or by an offline verification.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "docs/track-model-mexico-source-manifest.json"
SOURCE = ROOT / ".track-model-build/mexico-source"


def verify(path, entry):
    data = path.read_bytes()
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError(f"Mexico source checksum mismatch: {entry['file']}")


def crop_terrain(path, entry):
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      GDAL_HTTP_TIMEOUT="60",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(entry["url"]) as source:
            window = from_bounds(*entry["cropBounds"], source.transform)
            window = window.round_offsets().round_lengths()
            data = source.read(1, window=window)
            profile = source.profile.copy()
            profile.update(width=data.shape[1], height=data.shape[0],
                           transform=source.window_transform(window),
                           tiled=False, compress="deflate")
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)
            with rasterio.open(path, "w", **profile) as destination:
                destination.write(data, 1)
                destination.scales = source.scales
                destination.offsets = source.offsets


def download(offline=False, source_directory=SOURCE):
    manifest = json.loads(LOCK.read_text())
    source_directory = Path(source_directory)
    source_directory.mkdir(parents=True, exist_ok=True)

    def fetch(entry):
        path = source_directory / entry["file"]
        if path.exists():
            verify(path, entry)
            return
        if offline:
            raise FileNotFoundError(f"Missing pinned Mexico source: {path}")
        temporary = path.with_suffix(path.suffix + ".download")
        try:
            if entry.get("downloadMethod") == "native-cog-window":
                crop_terrain(temporary, entry)
            else:
                request = urllib.request.Request(
                    entry["url"],
                    headers={"User-Agent": "RaceSide geographic asset builder/1.0"},
                )
                with urllib.request.urlopen(request, timeout=180) as response:
                    temporary.write_bytes(response.read())
            verify(temporary, entry)
            temporary.replace(path)
        finally:
            if temporary.exists():
                temporary.unlink()

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, manifest["sources"]))
    (source_directory / "source-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"Mexico: verified {len(manifest['sources'])} pinned sources")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--source", type=Path, default=SOURCE)
    arguments = parser.parse_args()
    download(arguments.offline, arguments.source)
