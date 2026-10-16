#!/usr/bin/env python3
"""Verify the pinned Austin sources, downloading only missing files."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "docs/track-model-austin-source-manifest.json"
SOURCE = ROOT / ".track-model-build/austin-source"


def verify(path, entry):
    data = path.read_bytes()
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError(f"Austin source checksum mismatch: {entry['file']}")


def download(offline=False):
    manifest = json.loads(LOCK.read_text())
    SOURCE.mkdir(parents=True, exist_ok=True)

    def fetch(entry):
        path = SOURCE / entry["file"]
        if path.exists():
            verify(path, entry)
            return
        if offline:
            raise FileNotFoundError(f"Missing pinned Austin source: {path}")
        request = urllib.request.Request(entry["url"], headers={"User-Agent": "RaceSide geographic asset builder/1.0"})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read()
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"Upstream source changed: {entry['file']}; review the source lock before rebuilding")
        temporary = path.with_suffix(path.suffix + ".download")
        temporary.write_bytes(data)
        temporary.replace(path)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, manifest["sources"]))
    (SOURCE / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Austin: verified {len(manifest['sources'])} pinned sources")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    download(parser.parse_args().offline)
