#!/usr/bin/env python3
"""Retrieve only the pinned Singapore reference files; reject source changes."""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/singapore-source"
LOCK = ROOT / "docs/track-model-singapore-source-manifest.json"


def verify(data, entry):
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError(f"Singapore source changed: {entry['file']}; review and update the source lock explicitly")


def download(offline=False):
    manifest = json.loads(LOCK.read_text())
    for entry in manifest["sources"]:
        target = SOURCE / entry["file"]
        if target.exists():
            verify(target.read_bytes(), entry)
            continue
        if offline:
            raise FileNotFoundError(f"Missing pinned Singapore source: {target}")
        request = urllib.request.Request(entry["url"], headers={"User-Agent": "RaceSide geographic asset builder/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()
        verify(data, entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".download")
        temporary.write_bytes(data)
        temporary.replace(target)
    print(f"Singapore: verified {len(manifest['sources'])} source files; this is not a publication approval")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    download(parser.parse_args().offline)
