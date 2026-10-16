#!/usr/bin/env python3
"""Verify a pinned Albert Park source snapshot, acquiring missing public files."""

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".track-model-build/albert-park-source"


def acquire(offline=False):
    manifest = json.loads((ROOT/"docs/track-model-albert-park-source-manifest.json").read_text())
    SOURCE.mkdir(parents=True, exist_ok=True)
    for entry in manifest["sources"]:
        authored = entry["file"].startswith("docs/")
        path = ROOT/entry["file"] if authored else SOURCE/entry["file"]
        if not path.exists():
            if offline or authored: raise FileNotFoundError(f"Missing pinned Albert Park source: {path}")
            request = urllib.request.Request(entry["url"], headers={"User-Agent":"RaceSide geographic asset builder/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response: data = response.read()
            # Never replace the pin with a changed live endpoint automatically.
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise ValueError(f"Live source changed: {entry['file']}; review and repin explicitly")
            path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Albert Park source checksum mismatch: {entry['file']}")
    combined = ET.Element("osm", {"version":"0.6", "generator":"RaceSide pinned snapshot merger"})
    seen = set()
    for i in range(4):
        for element in ET.parse(SOURCE/f"osm-{i}.xml").getroot():
            key = (element.tag, element.get("id"))
            if element.tag in ("node","way","relation") and key not in seen:
                combined.append(element); seen.add(key)
    ET.ElementTree(combined).write(SOURCE/"osm.xml", encoding="utf-8", xml_declaration=True)
    print(f"Verified {len(manifest['sources'])} pinned Albert Park sources")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--offline",action="store_true")
    acquire(parser.parse_args().offline)
