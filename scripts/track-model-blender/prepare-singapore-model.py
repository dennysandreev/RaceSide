#!/usr/bin/env python3
"""Prepare a reproducible, metre-scale Marina Bay reconstruction; no surveyed facade claim."""
import bisect
import importlib.util
import json
import math
import random
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.track-model-build/singapore-prepared'
SOURCE=ROOT/'.track-model-build/singapore-source'
spec=importlib.util.spec_from_file_location('sg_sources',Path(__file__).with_name('prepare-singapore-sources.py'))
geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)
spec=importlib.util.spec_from_file_location('sg_context',Path(__file__).with_name('prepare-singapore-context.py'))
context=importlib.util.module_from_spec(spec);spec.loader.exec_module(context)
BOUNDS={'minX':371850,'minY':141750,'maxX':374150,'maxY':143590}
CENTER={'x':373000,'y':142670}


def cumulative(line):
    result=[0]
    for a,b in zip(line,line[1:]):result.append(result[-1]+math.dist(a,b))
    return result


def sample(line,d):
    steps=cumulative(line);d=max(0,min(d,steps[-1]));i=min(len(line)-2,max(0,bisect.bisect_right(steps,d)-1))
    t=(d-steps[i])/max(1e-12,steps[i+1]-steps[i]);return [a+(b-a)*t for a,b in zip(line[i],line[i+1])]


def distance(line,p):
    _,i,t,_=geo.nearest(line,p);c=cumulative(line);return c[i]+t*(c[i+1]-c[i])


def lonlat(x,y):
    lon,lat=103.8585,1.2905
    for _ in range(4):
        u,v=geo.utm48(lon,lat);du=geo.utm48(lon+.0001,lat);dv=geo.utm48(lon,lat+.0001)
        a,b=(du[0]-u)/.0001,(dv[0]-u)/.0001;c,d=(du[1]-v)/.0001,(dv[1]-v)/.0001
        det=a*d-b*c;lon+=((x-u)*d-(y-v)*b)/det;lat+=((y-v)*a-(x-u)*c)/det
    return lon,lat


def warp(entries,width,height):
    z=entries[0]['zoom'];left=min(e['x'] for e in entries);top=min(e['y'] for e in entries)
    cols=max(e['x'] for e in entries)-left+1;rows=max(e['y'] for e in entries)-top+1
    mosaic=Image.new('RGB',(cols*256,rows*256))
    for e in entries:mosaic.paste(Image.open(SOURCE/e['file']).convert('RGB'),((e['x']-left)*256,(e['y']-top)*256))
    def uv(px,py):
        x=BOUNDS['minX']+px/width*(BOUNDS['maxX']-BOUNDS['minX']);y=BOUNDS['maxY']-py/height*(BOUNDS['maxY']-BOUNDS['minY'])
        lon,lat=lonlat(x,y)
        return (((lon+180)/360*2**z-left)*256,((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z-top)*256)
    mesh=[]
    for y in range(0,height,64):
        for x in range(0,width,64):
            r,b=min(x+64,width),min(y+64,height)
            mesh.append(((x,y,r,b),(*uv(x,y),*uv(x,b),*uv(r,b),*uv(r,y))))
    return mosaic.transform((width,height),Image.Transform.MESH,mesh,Image.Resampling.BILINEAR)


def facade_textures():
    # Repeating bay/floor details are an explicit architectural estimate, not photo-survey data.
    for style in ('glass','balcony','stone','garage'):
        im=Image.new('RGB',(256,256),(184,181,169));d=ImageDraw.Draw(im)
        if style=='glass':
            d.rectangle((0,0,255,255),fill=(85,117,126));d.rectangle((5,6,125,243),fill=(109,143,150));d.rectangle((131,6,249,243),fill=(82,111,124))
            for x in (0,126,251):d.rectangle((x,0,x+4,255),fill=(166,179,179))
            d.rectangle((0,220,255,254),fill=(65,81,85));d.line((7,8,120,115),fill=(138,165,169),width=3)
        elif style=='balcony':
            d.rectangle((10,14,245,222),fill=(58,70,74));d.rectangle((25,25,231,199),fill=(78,105,117))
            for x in (25,125,227):d.rectangle((x,24,x+4,199),fill=(163,167,162))
            d.rectangle((0,207,255,251),fill=(201,198,181));d.line((0,207,255,207),fill=(240,235,214),width=6)
            for x in range(9,256,22):d.line((x,170,x,214),fill=(166,171,168),width=3)
        elif style=='stone':
            for y in range(0,256,32):d.line((0,y,255,y),fill=(158,155,146),width=2)
            d.rectangle((54,40,202,229),fill=(221,216,199));d.rectangle((65,51,191,217),fill=(54,65,69))
            for x in (65,123,187):d.line((x,53,x,218),fill=(180,177,164),width=5)
            d.line((67,130,191,130),fill=(176,173,160),width=5)
        else:
            d.rectangle((8,20,247,246),fill=(58,67,70))
            for y in range(26,237,15):d.line((12,y,243,y),fill=(111,117,116),width=4)
            d.rectangle((8,20,247,57),fill=(146,160,161))
        atlas=Image.new('RGB',(1024,1024));emission=Image.new('RGB',(1024,1024));lights=ImageDraw.Draw(emission);rng=random.Random(style)
        for row in range(4):
            for col in range(4):
                x,y=col*256,row*256;atlas.paste(im,(x,y))
                for left,right in ((8,121),(134,246)) if style=='glass' else ((67,121),(130,188)):
                    if rng.random()<(.58 if style=='glass' else .72):lights.rectangle((x+left,y+54,x+right,y+199),fill=rng.choice([(184,147,91),(104,142,163),(205,180,128)]))
        atlas.save(OUT/f'facade-{style}.png');emission.save(OUT/f'emission-{style}.png')


def main():
    geo.prepare()
    g=json.loads((OUT/'singapore-source-geometry.json').read_text());manifest=g['sourceManifest']
    raw=list(reversed(g['centerline']));ring=raw[:-1];smoothed=[]
    for a,b in zip(ring,ring[1:]+ring[:1]):
        smoothed.extend([[.75*a[i]+.25*b[i] for i in (0,1)],[.25*a[i]+.75*b[i] for i in (0,1)]])
    for _ in range(2):
        ring=smoothed;smoothed=[]
        for a,b in zip(ring,ring[1:]+ring[:1]):
            smoothed.extend([[.75*a[i]+.25*b[i] for i in (0,1)],[.25*a[i]+.75*b[i] for i in (0,1)]])
    smoothed.append(smoothed[0])
    # Round sub-road-width OSM kinks before offsetting a 12 m carriageway. Without
    # this, inner edges fold back and create near-vertical sliver triangles.
    count=math.ceil(geo.length(smoothed)/2)
    regular=[sample(smoothed,geo.length(smoothed)*i/count) for i in range(count)]
    corner_centers=[(distance(smoothed,sample(raw,d)),sigma) for d,sigma in ((2030,11),(2684,7),(3072,7),(3627,11))]
    smooth=[]
    for i in range(count):
        d=geo.length(smoothed)*i/count
        sigma=3+max((sigma-3)*math.exp(-.5*((d-center)/20)**2) for center,sigma in corner_centers)
        weights=[math.exp(-.5*(j*2/sigma)**2) for j in range(-20,21)]
        smooth.append([sum(regular[(i+j)%count][axis]*w for j,w in zip(range(-20,21),weights))/sum(weights) for axis in (0,1)])
    smooth.append(smooth[0]);line,gap=geo.rotate_to_control_line(smooth,g['controlPoints']['finish']['position'])
    total=geo.length(line)
    if abs(total-4927)/4927>.005:raise ValueError('Lap length exceeds tolerance')
    pit=g['pitLaneSegments'][0]['points']
    if distance(line,pit[0])<distance(line,pit[-1]):pit=list(reversed(pit))
    pit[0]=geo.nearest(line,pit[0])[3];pit[-1]=geo.nearest(line,pit[-1])[3]
    # FIA 2025 photos show a left-hand commitment lane before T18, followed
    # by the tighter inner T18/T19 arc. Preserve the mapped garage alignment.
    entry=distance(line,pit[0]);approach=[sample(line,entry-45),sample(line,entry-30),sample(line,entry-15)]
    pit=approach+pit
    for _ in range(2):
        rounded=[pit[0]]
        for a,b in zip(pit,pit[1:]):rounded.extend([[.75*a[i]+.25*b[i] for i in (0,1)],[.25*a[i]+.75*b[i] for i in (0,1)]])
        rounded.append(pit[-1]);pit=rounded
    turn_raw=[437,518,585,734,996,1460,1812,2030,2220,2684,2820,2910,3072,3627,3890,4380,4440,4730,4830]
    turns=[{'number':i+1,'distanceMeters':distance(line,sample(raw,d)),'anchorSide':1 if i%2==0 else -1} for i,d in enumerate(turn_raw)]
    ortho=warp([s for s in manifest['sources'] if s.get('kind')=='ortho'],3072,2458)
    ortho.resize((2048,1638),Image.Resampling.LANCZOS).save(OUT/'singapore-orthophoto.jpg',quality=68,optimize=True)
    # Terrarium is a coarse surface product. A local lower envelope removes most urban spikes;
    # clamping/smoothing is openly estimated grading, not a certified national vertical datum.
    dem=warp([s for s in manifest['sources'] if s.get('kind')=='elevation'],161,129)
    values=[max(0,min(7,r*256+gg+b/256-32768)) for r,gg,b in dem.getdata()]
    grey=Image.new('L',dem.size);grey.putdata([round(v/7*255) for v in values])
    grey=grey.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(3))
    terrain={'columns':161,'rows':129,'bounds':BOUNDS,'values':[[round(grey.getpixel((x,128-y))/255*7,3) for x in range(161)] for y in range(129)],'method':'Mapzen coarse elevation lower envelope (9 cells), 0–7 m clamp, Gaussian smoothing; approximate terrain, vertical datum unverified'}
    (OUT/'terrain.json').write_text(json.dumps(terrain)+'\n')
    tree=[];vectors=[];osm=ET.parse(SOURCE/'osm.xml').getroot();nodes={n.get('id'):geo.utm48(float(n.get('lon')),float(n.get('lat'))) for n in osm.findall('node')}
    for n in osm.findall('node'):
        if geo.tags(n).get('natural')=='tree':tree.append({'id':int(n.get('id')),'point':nodes[n.get('id')],'tags':geo.tags(n)})
    for w in osm.findall('way'):
        t=geo.tags(w)
        if any(k in t for k in ('bridge','natural','landuse','leisure','barrier','building','building:part')):
            p=[nodes[n.get('ref')] for n in w.findall('nd')];vectors.append({'id':int(w.get('id')),'tags':t,'points':p})
    # Relative locations/sides follow the promoter's 10 Sep 2026 map. Extents are estimates.
    stands=[('Pit',60,320,-1,23,24),('Super Pit',-80,45,-1,23,24),('Turn 1',335,410,-1,30,23),('Turn 2',447,497,-1,27,22),
        ('Pit Exit',648,700,1,26,18),('Republic',760,875,-1,25,20),('Stamford',1835,1935,-1,25,20),
        ('Padang A',2290,2390,1,25,20),('Padang B',2440,2590,1,25,20),('Connaught',3500,3580,1,27,18),
        ('Empress',2790,2835,-1,17,10),('Raffles',940,1000,1,28,15),('Bayfront',4410,4450,-1,27,14),
        ('Promenade',4490,4560,-1,28,16),('Skyline',4660,4710,-1,25,16),('Marina Bay',4765,4805,-1,25,14)]
    config={'modelId':'singapore','model':{'centerline':line,'pitCenterline':pit,'center':CENTER,'bounds':BOUNDS,'turns':turns},
        'buildings':g['buildings'],'buildingRelations':g['buildingRelations'],'vectors':vectors,'trees':tree,
        'grandstands':[dict(name=n,start=a,end=b,side=s,offset=o,depth=dep) for n,a,b,s,o,dep in stands],
        'officialControlPoints':{'referenceYear':2025,'currentEventVerified':False,'authority':'FIA 2025 control distances, promoter 2026 direction and turn layout; map-derived turn anchors',
        'sectorBoundaryDistancesMeters':[turns[6]['distanceMeters']-150,turns[13]['distanceMeters']-140],
        'speedTrapDistanceMeters':turns[0]['distanceMeters']-150,'raceStartDistanceMeters':distance(line,g['controlPoints']['start']['position'])},
        'sourceManifest':manifest,'geometryAudit':{'rawLengthMeters':geo.length(raw),'smoothLengthMeters':total,'finishProjectionGapMeters':gap,'smoothing':'three closed Chaikin passes (0.25), 2 m resampling, 3 m Gaussian rounding with 7–11 m local smoothing at four sharp bends; native UTM, no global scale change','direction':'reversed source ring to match official racing direction'},
        'limitations':['Reconstruction authorised by user; not a surveyed digital twin.','Window/balcony repetition, untagged roofs and building heights are architectural estimates.','Terrain and bridge elevations are approximate; no verified bare-earth DTM or vertical datum.','Temporary grandstand dimensions/rows and pit garage division are estimated from the 2026 promoter map.','Timing boundaries use FIA 2025 offsets, pending 2026 operational confirmation.','Orthophoto capture date unknown; NS Square construction and small temporary equipment may differ.','Small vehicles, people, exact signs and temporary hospitality interiors are omitted.']}
    context.prepare(SOURCE,geo,config)
    # Deterministic infill only in mapped green areas; preserve paths and open lawns.
    rng=random.Random(20260929);green=[];candidates=[]
    image=Image.open(OUT/'singapore-orthophoto.jpg')
    for v in vectors:
        t=v['tags'];ring=v['points']
        if len(ring)<4 or ring[0]!=ring[-1] or t.get('level') or t.get('location')=='roof':continue
        if not(t.get('leisure') in ('park','garden') or t.get('landuse') in ('grass','forest','meadow') or t.get('natural') in ('wood','scrub','grassland')):continue
        green.append(v)
        xmin=max(BOUNDS['minX']+5,min(p[0] for p in ring));xmax=min(BOUNDS['maxX']-5,max(p[0] for p in ring));ymin=max(BOUNDS['minY']+5,min(p[1] for p in ring));ymax=min(BOUNDS['maxY']-5,max(p[1] for p in ring))
        for x in range(math.ceil(xmin),math.floor(xmax),12):
            for y in range(math.ceil(ymin),math.floor(ymax),12):
                p=[x+rng.uniform(-3,3),y+rng.uniform(-3,3)]
                if not context.inside(p,ring):continue
                edge=geo.nearest(ring,p)[0]
                if edge<3 or (t.get('landuse') in ('grass','meadow') and edge>6):continue
                px=round((p[0]-BOUNDS['minX'])/2300*(image.width-1));py=round((BOUNDS['maxY']-p[1])/1840*(image.height-1));red,green_value,blue=image.getpixel((px,py))
                if green_value<red*.96 or green_value<blue*1.03:continue
                candidates.append({'point':p,'greenAreaId':v['id'],'height':rng.uniform(5,10),'variant':rng.randrange(3)})
    rng.shuffle(candidates);config['landscapeCandidates']=candidates;config['greenAreas']=green
    lightmap=Image.new('L',(2048,1638));lightdraw=ImageDraw.Draw(lightmap)
    def pixel(p):return ((p[0]-BOUNDS['minX'])/2300*2048,(BOUNDS['maxY']-p[1])/1840*1638)
    for road in config['landscapeExclusions']:
        if road['radius']>=5:lightdraw.line([pixel(p) for p in road['points']],fill=55,width=7)
    for path in (line,pit):lightdraw.line([pixel(p) for p in path],fill=170,width=19)
    lightmap=lightmap.filter(ImageFilter.GaussianBlur(8))
    Image.merge('RGB',(lightmap,lightmap.point(lambda v:round(v*.86)),lightmap.point(lambda v:round(v*.65)))).save(OUT/'night-lightmap.jpg',quality=75,optimize=True)
    (ROOT/'.track-model-build/singapore.json').write_text(json.dumps(config,ensure_ascii=False)+'\n')
    facade_textures()
    print(json.dumps({'lap':total,'pit':geo.length(pit),'buildingParts':len(g['buildings']),'trees':len(tree),'terrainRange':[min(map(min,terrain['values'])),max(map(max,terrain['values']))]}))

if __name__=='__main__':main()
