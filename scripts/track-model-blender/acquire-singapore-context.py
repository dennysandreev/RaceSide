#!/usr/bin/env python3
"""Explicitly acquire and pin Singapore raster/reference context (build-time only)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.track-model-build/singapore-source'
LOCK = ROOT / 'docs/track-model-singapore-source-manifest.json'
BBOX = [103.848,1.282,103.869,1.299]


def tile(lon, lat, zoom):
    return int((lon+180)/360*2**zoom), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**zoom)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pin-new-sources',action='store_true',required=True)
    parser.parse_args()
    manifest=json.loads(LOCK.read_text())
    known={entry['file']:entry for entry in manifest['sources']}
    requests=[]
    for kind,zoom in [('ortho',18),('elevation',13)]:
        left,top=tile(BBOX[0],BBOX[3],zoom);right,bottom=tile(BBOX[2],BBOX[1],zoom)
        for x in range(left,right+1):
            for y in range(top,bottom+1):
                url=(f'https://www.onemap.gov.sg/maps/tiles/Satellite/{zoom}/{x}/{y}.png' if kind=='ortho'
                     else f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png')
                requests.append(dict(file=f'{kind}/{zoom}-{x}-{y}.png',url=url,kind=kind,x=x,y=y,zoom=zoom,
                    role='Surface imagery' if kind=='ortho' else 'Coarse elevation; not a surveyed bare-earth DTM',
                    license='Singapore Open Data Licence 1.0 / OneMap API Terms' if kind=='ortho' else 'Mapzen terrain tiles; underlying SRTM/other providers, attribution retained',
                    attribution='© Singapore Land Authority / OneMap' if kind=='ortho' else 'Mapzen / AWS Terrain Tiles',
                    crs='EPSG:3857',verticalDatum=None,captureDate=None,
                    resolution=f'256 px tile, zoom {zoom}',bboxWgs84=[x/2**zoom*360-180,
                        math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+1)/2**zoom)))),
                        (x+1)/2**zoom*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*y/2**zoom))))]))
    refs=[('flyer','https://www.singaporeflyer.com/en/fun-facts'),
          ('esplanade','https://www.esplanade.com/about-us/our-story/architecture'),
          ('onemap-license','https://www.onemap.gov.sg/legal/opendatalicence.html'),
          ('onemap-api-terms','https://www.onemap.gov.sg/legal/apitermsofservice.html')]
    for name,url in refs:
        requests.append(dict(file=f'references/{name}.html',url=url,kind='reference',role='Architectural or licence reference',
            license='Reference only; text/images not embedded in GLB',attribution=url.split('/')[2],crs=None,
            verticalDatum=None,captureDate=None,resolution='HTML document',bboxWgs84=None))
    for ident in (9542146,9569901):
        requests.append(dict(file=f'water-{ident}.osm',url=f'https://www.openstreetmap.org/api/0.6/relation/{ident}/full',kind='water',role='Complete reservoir and river boundaries for shoreline clearance',license='ODbL 1.0',attribution='© OpenStreetMap contributors',crs='EPSG:4326',verticalDatum=None,captureDate=None,resolution='Vector',bboxWgs84=BBOX))
    def fetch(entry):
        target=SOURCE/entry['file']; target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():
            temporary=target.with_suffix('.download')
            subprocess.run(['curl','--http1.1','-L','--fail','--retry','2','--max-time','60','-sS',entry['url'],'-o',str(temporary)],check=True)
            temporary.replace(target)
        data=target.read_bytes();digest=hashlib.sha256(data).hexdigest()
        if entry['file'] in known:
            if digest!=known[entry['file']]['sha256']:raise ValueError(f'Changed cached source {target}')
            return known[entry['file']]
        return {**entry,'bytes':len(data),'sha256':digest,'retrievedAt':datetime.fromtimestamp(target.stat().st_mtime,timezone.utc).isoformat()}
    with ThreadPoolExecutor(max_workers=4) as pool:
        additions=list(pool.map(fetch,requests))
    for item in additions:known[item['file']]=item
    manifest['sources']=list(known.values());manifest['status']='reconstruction-authorized'
    manifest['reconstructionConsent']='User approved reconstruction with explicitly documented estimates on 2026-09-29.'
    LOCK.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Pinned {len(additions)} raster/reference sources; {len(known)} total')

if __name__=='__main__':main()
