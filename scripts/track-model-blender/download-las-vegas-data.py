#!/usr/bin/env python3
"""Download missing Las Vegas inputs and verify the immutable source lock."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.track-model-build/las-vegas-source'
LOCK = ROOT / 'docs/track-model-las-vegas-source-manifest.json'


def download(offline=False):
    manifest = json.loads(LOCK.read_text())
    SOURCE.mkdir(parents=True, exist_ok=True)

    def fetch(entry):
        path = SOURCE / entry['file']
        if not path.exists():
            if offline:
                raise FileNotFoundError(f"Missing pinned source: {path}")
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'RaceSide geographic asset builder/1.0'})
            with urllib.request.urlopen(request, timeout=180) as response:
                data = response.read()
            if entry.get('extraction') == 'inline-f1-svg':
                svg = next(svg for svg in re.findall(r'<svg\b.*?</svg>', data.decode(), re.S) if '<title>F1</title>' in svg)
                paths = re.findall(r'<path\b[^>]*\bd="([^"]+)"', svg)
                data = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400">'
                        + ''.join(f'<path fill="#e10600" d="{path}"/>' for path in paths) + '</svg>\n').encode()
        else:
            data = path.read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError(f"Source checksum mismatch: {entry['file']}; review the source lock before rebuilding")
        if not path.exists():
            temporary = path.with_suffix(path.suffix + '.download')
            temporary.write_bytes(data)
            temporary.replace(path)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, manifest['sources']))
    (SOURCE / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f"Las Vegas: verified {len(manifest['sources'])} pinned sources")
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    download(parser.parse_args().offline)
