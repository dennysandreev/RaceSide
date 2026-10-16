#!/usr/bin/env python3
"""Prepare native UTM11 geometry, USGS terrain and the 2026 event reconstruction."""
from bisect import bisect_right
import importlib.util
import json
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.track-model-build/las-vegas-source'
PREPARED = ROOT / '.track-model-build/las-vegas-prepared'
spec = importlib.util.spec_from_file_location('geographic_helpers', Path(__file__).with_name('prepare-austin-model.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def utm11(lat, lon):
    # The helper evaluates transverse Mercator relative to -99 degrees. Moving
    # longitude by +18 selects the -117-degree central meridian of UTM zone 11.
    return helpers.utm14(lat, lon + 18)


def gaussian(values, sigma, axis=0):
    radius = math.ceil(sigma * 3)
    kernel = np.exp(-.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, radius, mode='edge'), kernel, mode='valid'), axis, values)


def round_driving_axis(points, closed):
    """Round polygonal survey-guide vertices before offsetting the road edges.

    Work in native metres. A short filter retains existing broad bends; the
    wider filter is confined to sharp vertices where a 12 m ribbon needs room.
    Return source-to-render arc length mapping for geographic annotations.
    """
    points=np.asarray(points,dtype=float)
    lengths=np.linalg.norm(np.diff(points,axis=0),axis=1)
    source_distances=np.r_[0,np.cumsum(lengths)]
    count=math.ceil(source_distances[-1]/.25)
    distances=np.linspace(0,source_distances[-1],count+1)
    raw=np.stack([np.interp(distances,source_distances,points[:,i])for i in (0,1)],axis=1)
    step=source_distances[-1]/count
    def filtered(sigma):
        radius=math.ceil(4*sigma/step)
        kernel=np.exp(-.5*(np.arange(-radius,radius+1)*step/sigma)**2)
        kernel/=kernel.sum()
        if closed:
            padded=np.pad(raw[:-1],((radius,radius),(0,0)),mode='wrap')
        else:
            # Linear endpoint continuation preserves pit entry/exit and their
            # direction instead of flattening them with duplicated samples.
            padded=np.vstack([raw[0]+np.arange(-radius,0)[:,None]*(raw[1]-raw[0]),raw,
                              raw[-1]+np.arange(1,radius+1)[:,None]*(raw[-1]-raw[-2])])
        result=np.stack([np.convolve(padded[:,i],kernel,mode='valid')for i in (0,1)],axis=1)
        return np.vstack([result,result[0]]) if closed else result
    rounded=filtered(3 if closed else 6)
    if closed:
        directions=np.diff(points,axis=0)/lengths[:,None]
        angles=np.arccos(np.clip(np.sum(directions*np.roll(directions,1,axis=0),axis=1),-1,1))
        sharp=source_distances[:-1][angles>math.radians(45)]
        if len(sharp):
            gap=np.min(abs((distances[:,None]-sharp[None,:]+source_distances[-1]/2)%source_distances[-1]-source_distances[-1]/2),axis=1)
            blend=np.clip((42-gap)/21,0,1)
            blend=blend**3*(10-15*blend+6*blend**2)
            rounded=rounded*(1-blend[:,None])+filtered(10.5)*blend[:,None]
    # Preserve the surveyed finish and pit join points exactly. Corrections are
    # sub-millimetre because each endpoint lies on a straight approach.
    rounded[0]=points[0];rounded[-1]=points[-1]
    cumulative=np.r_[0,np.cumsum(np.linalg.norm(np.diff(rounded,axis=0),axis=1))]
    return rounded.tolist(),distances,cumulative,{
        'sourceLengthMeters':float(source_distances[-1]),'renderLengthMeters':float(cumulative[-1]),
        'maximumCorrespondingPointShiftMeters':float(np.linalg.norm(rounded-raw,axis=1).max()),
        'method':'native-metre 0.25 m sampling; Gaussian sigma 3 m, locally 10.5 m at >45 degree vertices with C2 blend; pit sigma 6 m with linear endpoint continuation; no global scaling'}


def clip_polygon(points, bounds):
    points=points[:-1] if points and points[0]==points[-1] else points[:]
    for axis,edge,sign in [(0,bounds['minX'],1),(0,bounds['maxX'],-1),(1,bounds['minY'],1),(1,bounds['maxY'],-1)]:
        if not points:return []
        output=[];previous=points[-1];inside=(previous[axis]-edge)*sign>=0
        for point in points:
            current=(point[axis]-edge)*sign>=0
            if current!=inside:
                t=(edge-previous[axis])/(point[axis]-previous[axis])
                output.append([previous[k]+t*(point[k]-previous[k])for k in (0,1)])
            if current:output.append(point)
            previous,inside=point,current
        points=output
    return points+[points[0]] if len(points)>=3 else []


def contains(point, polygon):
    x,y=point;inside=False
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside


def relation_rings(relation, ways, positions, role):
    pending=[(int(m.get('ref')),[int(n.get('ref'))for n in ways[int(m.get('ref'))].findall('nd')])
             for m in relation.findall('member')if m.get('type')=='way' and m.get('role')==role and int(m.get('ref'))in ways]
    rings=[]
    while pending:
        identifier,ring=pending.pop(0)
        while ring[0]!=ring[-1]:
            match=next((i for i,(_,nodes)in enumerate(pending)if nodes[0]==ring[-1] or nodes[-1]==ring[-1]),None)
            if match is None:break
            _,nodes=pending.pop(match)
            ring+=(nodes if nodes[0]==ring[-1] else nodes[::-1])[1:]
        if len(ring)>=4 and ring[0]==ring[-1]:rings.append((identifier,[positions[n]for n in ring]))
    return rings


def prepare_textures():
    from PIL import ImageDraw
    rng = np.random.default_rng(6201)
    for name, color, ink in [('red', (184,18,15), (244,240,232)), ('white', (234,231,223), (30,32,32))]:
        pixels = np.clip(np.array(color)[None,None,:] * rng.uniform(.92,1,(128,128,1)),0,255).astype('uint8')
        image = Image.fromarray(pixels)
        draw = ImageDraw.Draw(image)
        # Original geometric suit tile based on the real casino-themed kerbs.
        if name == 'white':
            draw.ellipse((44,30,70,56),fill=ink);draw.ellipse((30,48,57,75),fill=ink);draw.ellipse((59,48,86,75),fill=ink)
            draw.polygon([(58,56),(51,87),(65,87)],fill=ink)
        else:
            draw.polygon([(58,30),(80,59),(58,88),(36,59)],fill=ink)
        image.save(PREPARED/f'las-vegas-kerb-{name}.png')
    # Four windows across and two storeys: mapped in metres by the Blender
    # builder, rather than repeated four times within a 2 m surface tile.
    facade = Image.new('RGB',(512,256),(236,233,226))
    draw = ImageDraw.Draw(facade)
    for row in range(2):
        y=row*128
        draw.rectangle((0,y,511,y+6),fill=(188,184,177))
        draw.line((0,y+8,511,y+8),fill=(253,250,242),width=3)
        for column in range(4):
            x=column*128
            draw.rectangle((x+15,y+20,x+113,y+116),fill=(80,83,83))
            draw.rectangle((x+19,y+24,x+109,y+112),fill=(36,52,63))
            draw.polygon([(x+20,y+25),(x+108,y+25),(x+108,y+47),(x+20,y+76)],fill=(84,103,114))
            draw.line((x+64,y+25,x+64,y+112),fill=(151,157,156),width=3)
            draw.line((x+20,y+70,x+108,y+70),fill=(145,152,152),width=3)
            draw.line((x+14,y+118,x+114,y+118),fill=(252,249,240),width=4)
    facade.save(PREPARED/'las-vegas-facade-windows.png',optimize=True)
    # A larger, deterministic room atlas avoids an alternating chessboard
    # repeated on every two storeys. Its UV scale is one quarter of the facade.
    emission = Image.new('RGB',(1024,512))
    lights = ImageDraw.Draw(emission)
    rooms=np.random.default_rng(6201)
    palette=[(249,198,121),(234,186,110),(228,170,93),(167,202,230)]
    for row in range(8):
        for column in range(16):
            if rooms.random()>.66:continue
            x,y=column*64,row*64
            brightness=rooms.uniform(.58,1)
            color=tuple(round(value*brightness)for value in palette[rooms.integers(0,len(palette))])
            lights.rectangle((x+10,y+13,x+54,y+55),fill=color)
            lights.line((x+32,y+13,x+32,y+55),fill=(0,0,0),width=2)
            lights.line((x+10,y+35,x+54,y+35),fill=(0,0,0),width=2)
    emission.save(PREPARED/'las-vegas-window-emission.png',optimize=True)
    width,height = 1024,512
    yy,xx = np.indices((height,width))
    intensity = .92 + .08*np.sin(yy/height*np.pi)
    intensity[(xx%4==0)|(yy%4==0)] *= .70
    image = Image.fromarray((intensity[:,:,None]*np.array([190,12,9])[None,None,:]).clip(0,255).astype('uint8'))
    # The exact official vector is a pinned input. Draw its absolute cubic
    # paths into the LED map; no lettering or approximate text substitute.
    logo = Image.new('RGBA',(800,200))
    draw = ImageDraw.Draw(logo)
    for path in ET.parse(SOURCE/'f1-logo-official.svg').getroot():
        tokens=re.findall(r'[MLCHVZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?',path.attrib['d'])
        polygon=[];position=(0,0);command=None;i=0
        while i<len(tokens):
            if tokens[i] in 'MLCHVZ':
                command=tokens[i];i+=1
                if command=='Z':
                    if polygon:draw.polygon([(x/2,y/2)for x,y in polygon],fill=(255,250,244,255))
                    polygon=[];continue
            if command=='M':
                if polygon:draw.polygon([(x/2,y/2)for x,y in polygon],fill=(255,250,244,255))
                position=tuple(map(float,tokens[i:i+2]));i+=2;polygon=[position];command='L'
            elif command=='L':
                position=tuple(map(float,tokens[i:i+2]));i+=2;polygon.append(position)
            elif command=='H':position=(float(tokens[i]),position[1]);i+=1;polygon.append(position)
            elif command=='V':position=(position[0],float(tokens[i]));i+=1;polygon.append(position)
            elif command=='C':
                a,b,c=[tuple(map(float,tokens[j:j+2]))for j in range(i,i+6,2)];i+=6
                start=position
                for step in range(1,17):
                    t=step/16
                    polygon.append(tuple((1-t)**3*start[k]+3*(1-t)**2*t*a[k]+3*(1-t)*t*t*b[k]+t**3*c[k]for k in (0,1)))
                position=c
        if polygon:draw.polygon([(x/2,y/2)for x,y in polygon],fill=(255,250,244,255))
    logo=logo.resize((240,60),Image.Resampling.LANCZOS)
    for center in (.125,.458333,.791667):image.paste(logo,(round(center*width)-120,175),logo)
    image.save(PREPARED/'las-vegas-exosphere.png',optimize=True)


def prepare_night_lighting(line,pit,bounds,context_roads):
    from PIL import ImageDraw, ImageFilter
    width,height=1024,1103
    streets=Image.new('L',(width,height));draw=ImageDraw.Draw(streets)
    def pixel(point):
        return ((point[0]-bounds['minX'])/(bounds['maxX']-bounds['minX'])*(width-1),
                (bounds['maxY']-point[1])/(bounds['maxY']-bounds['minY'])*(height-1))
    for road in context_roads:
        if len(road)>1:draw.line([pixel(p)for p in road],fill=40,width=4)
    for path in (line,pit):draw.line([pixel(p)for p in path],fill=185,width=12)
    cumulative=helpers.cumulative(line)
    for distance in range(0,math.floor(cumulative[-1]),60):
        p=helpers.sample(line,cumulative,distance)
        a=helpers.sample(line,cumulative,max(0,distance-12))
        b=helpers.sample(line,cumulative,min(cumulative[-1],distance+12))
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        x,y=pixel((p[0]+dy/length*11,p[1]-dx/length*11))
        draw.ellipse((x-5,y-5,x+5,y+5),fill=255)
    streets=streets.filter(ImageFilter.GaussianBlur(5))
    Image.merge('RGB',(streets.point(lambda value:round(value*.87)),
                       streets.point(lambda value:round(value*.94)),streets)).save(
        PREPARED/'las-vegas-night-lightmap.jpg',quality=75,optimize=True)


def prepare():
    PREPARED.mkdir(parents=True, exist_ok=True)
    prepare_textures()
    settings = json.loads((ROOT / 'docs/track-model-las-vegas-config.json').read_text())
    bounds = settings['bounds']
    center = {'x': (bounds['minX'] + bounds['maxX']) / 2, 'y': (bounds['minY'] + bounds['maxY']) / 2}
    nodes, ways, relations = {}, {}, {}
    for file in sorted(SOURCE.glob('osm-*.xml')):
        root = ET.parse(file).getroot()
        for kind, target in [('node', nodes), ('way', ways), ('relation', relations)]:
            target.update({int(element.get('id')): element for element in root.findall(kind)})
    positions = {id: utm11(float(n.get('lat')), float(n.get('lon'))) for id, n in nodes.items()}
    features = {}
    for id, way in ways.items():
        tags = {t.get('k'): t.get('v') for t in way.findall('tag')}
        world = [positions[int(n.get('ref'))] for n in way.findall('nd')]
        features[id] = {'id': id, 'tags': tags, 'world': world}
    # Building tags often belong to a multipolygon relation, not its ways.
    # Preserve courtyard holes and promote each outer shell without duplicates.
    for identifier,relation in relations.items():
        tags={t.get('k'):t.get('v')for t in relation.findall('tag')}
        if tags.get('type')!='multipolygon' or not (tags.get('building')or tags.get('building:part')):continue
        holes=[p for _,p in relation_rings(relation,ways,positions,'inner')]
        for way_id,outer in relation_rings(relation,ways,positions,'outer'):
            original=features.get(way_id,{})
            features[way_id]={'id':way_id,'osmRelationId':identifier,'tags':{**tags,**original.get('tags',{})},'world':outer,
                'innerRings':[hole for hole in holes if contains(hole[0],outer)]}
    relation = relations[settings['osmRelation']]
    line, main_ids = [], []
    for member in relation.findall('member'):
        if member.get('type') != 'way' or member.get('role') not in ('forward', 'backward'):
            continue
        id = int(member.get('ref'))
        points = features[id]['world'][:]
        if member.get('role') == 'backward':
            points.reverse()
        if line and math.dist(line[-1], points[0]) > .05:
            raise ValueError(f'Circuit topology gap at OSM way {id}')
        line.extend(points[1:] if line else points)
        main_ids.append(id)
    if math.dist(line[0], line[-1]) > .001:
        raise ValueError('Open geographic circuit')
    original_cum = helpers.cumulative(line)
    finish = positions[settings['finishNode']]
    finish_index = min(range(len(line) - 1), key=lambda i: math.dist(line[i], finish))
    rotation_distance = original_cum[-1] - original_cum[finish_index]
    line = line[finish_index:-1] + line[:finish_index + 1]
    source_line=line
    line,source_distances,render_distances,geometry_audit=round_driving_axis(line,True)
    remap=lambda distance:float(np.interp(distance,source_distances,render_distances))
    cum = helpers.cumulative(line)
    total = cum[-1]
    if abs(total - settings['officialLapLengthMeters']) / settings['officialLapLengthMeters'] > .005:
        raise ValueError('Circuit differs from the official lap by over 0.5%')
    pit,_,_,pit_geometry_audit=round_driving_axis(features[settings['pitWay']]['world'],False)
    # Rejoin the smoothed main axis at the geographic pit connections. Blend
    # each correction over 15 m so the endpoint adjustment cannot form a kink.
    main=np.asarray(line)
    segments=np.diff(main,axis=0)
    squared=np.sum(segments*segments,axis=1)
    pit_points=np.asarray(pit)
    pit_distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(pit_points,axis=0),axis=1))]
    shifts=[]
    for endpoint in (0,-1):
        point=pit_points[endpoint].copy()
        t=np.clip(np.sum((point-main[:-1])*segments,axis=1)/squared,0,1)
        candidates=main[:-1]+t[:,None]*segments
        closest=candidates[np.argmin(np.linalg.norm(candidates-point,axis=1))]
        shift=closest-point;shifts.append(float(np.linalg.norm(shift)))
        gap=pit_distances if endpoint==0 else pit_distances[-1]-pit_distances
        weight=np.clip(1-gap/15,0,1)
        weight=weight**3*(10-15*weight+6*weight**2)
        pit_points+=weight[:,None]*shift
    pit=pit_points.tolist()
    pit_geometry_audit['endpointProjectionShiftsMeters']=shifts
    pit_geometry_audit['renderLengthMeters']=helpers.cumulative(pit)[-1]
    pc = helpers.cumulative(pit)
    turns = [{'number': i + 1, 'distanceMeters': round(remap(d + rotation_distance), 3)}
             for i, d in enumerate(settings['officialTurnDistancesFromRaceStartMeters'])]
    source = np.array(Image.open(SOURCE / 'usgs-dtm-final.tif'), dtype=np.float64)
    if not np.isfinite(source).all() or source.min() < 500 or source.max() > 800:
        raise ValueError('USGS raster has no-data or invalid elevations')
    # Suppress noisy local DEM artifacts without exaggerating the measured slope.
    terrain = gaussian(gaussian(source, 5, 0), 5, 1)
    height, width = terrain.shape
    def elevation(point):
        return bilinear(point)
    def bilinear(point):
        x = np.clip((point[0] - bounds['minX']) / (bounds['maxX'] - bounds['minX']) * (width - 1), 0, width - 1.001)
        y = np.clip((bounds['maxY'] - point[1]) / (bounds['maxY'] - bounds['minY']) * (height - 1), 0, height - 1.001)
        ix, iy = int(x), int(y)
        tx, ty = x - ix, y - iy
        return terrain[iy, ix] * (1-tx) * (1-ty) + terrain[iy, ix+1] * tx * (1-ty) + terrain[iy+1, ix] * (1-tx) * ty + terrain[iy+1, ix+1] * tx * ty
    profiles = []
    for path, distances, closed in [(line, cum, True), (pit, pc, False)]:
        steps = np.linspace(0, distances[-1], math.ceil(distances[-1] / 2) + 1)
        values = np.array([elevation(helpers.sample(path, distances, d)) for d in steps])
        values = gaussian(values, 12)
        if closed:
            # Blend the cyclic seam, keeping both endpoints equal.
            raw = np.array([elevation(helpers.sample(path, distances, d)) for d in steps[:-1]])
            radius = 36
            kernel = np.exp(-.5 * (np.arange(-radius, radius+1) / 12) ** 2)
            kernel /= kernel.sum()
            values = np.convolve(np.pad(raw, radius, mode='wrap'), kernel, mode='valid')
            values = np.append(values, values[0])
        else:
            for end in (0, -1):
                nearest = helpers.nearest(line, cum, path[end])[1]
                target = np.interp(nearest, profiles[0]['distanceMeters'], profiles[0]['elevationMeters'])
                delta = target - values[end]
                for i, d in enumerate(steps):
                    gap = d if end == 0 else steps[-1] - d
                    if gap < 50:
                        weight = max(0, 1 - gap/50)
                        values[i] += delta * weight * weight * (3-2*weight)
        profiles.append({'distanceMeters': steps.tolist(), 'elevationMeters': values.tolist(), 'stepMeters': float(steps[1])})
    # Bring only the 12/8-metre driving corridors to the smooth road profile.
    nearest_gap = np.full_like(terrain, np.inf)
    grading = terrain.copy()
    spacing_x = (bounds['maxX']-bounds['minX'])/(width-1)
    spacing_y = (bounds['maxY']-bounds['minY'])/(height-1)
    for path, distances, profile in [(line, cum, profiles[0]), (pit, pc, profiles[1])]:
        for da in np.arange(0, distances[-1], 5):
            db = min(da+5, distances[-1])
            a, b = helpers.sample(path, distances, da), helpers.sample(path, distances, db)
            left = max(0, int((min(a[0],b[0])-26-bounds['minX'])/spacing_x))
            right = min(width, math.ceil((max(a[0],b[0])+26-bounds['minX'])/spacing_x)+1)
            top = max(0, int((bounds['maxY']-max(a[1],b[1])-26)/spacing_y))
            bottom = min(height, math.ceil((bounds['maxY']-min(a[1],b[1])+26)/spacing_y)+1)
            xx, yy = np.meshgrid(bounds['minX']+np.arange(left,right)*spacing_x, bounds['maxY']-np.arange(top,bottom)*spacing_y)
            dx, dy = b[0]-a[0], b[1]-a[1]
            t = np.clip(((xx-a[0])*dx+(yy-a[1])*dy)/max(dx*dx+dy*dy,1e-9),0,1)
            gaps = np.hypot(xx-a[0]-t*dx, yy-a[1]-t*dy)
            mask = gaps < nearest_gap[top:bottom,left:right]
            nearest_gap[top:bottom,left:right][mask] = gaps[mask]
            heights = np.interp(da+t*(db-da), profile['distanceMeters'], profile['elevationMeters'])
            grading[top:bottom,left:right][mask] = heights[mask]
    weight = np.clip((26-nearest_gap)/14,0,1)
    weight = weight*weight*(3-2*weight)
    graded = terrain*(1-weight)+grading*weight
    graded.astype('<f4').tofile(PREPARED / 'las-vegas-dtm.f32le')
    Image.open(SOURCE / 'ortho-final.jpg').convert('RGB').resize((2600,2800), Image.Resampling.LANCZOS).save(PREPARED / 'las-vegas-orthophoto.jpg', quality=60)
    relevant = []
    for f in features.values():
        tags, pts = f['tags'], f['world']
        if not any(k in tags for k in ('building','building:part','barrier','natural','water','leisure','man_made')) and f['id'] != 402543930:
            continue
        clipped=clip_polygon(pts,bounds)
        if not clipped:continue
        f={**f,'world':clipped,'innerRings':[ring for ring in (clip_polygon(hole,bounds)for hole in f.get('innerRings',[]))if ring],
           'sceneBoundaryClipped':clipped!=pts}
        relevant.append(f)
    def ribbon_polygon(start,end,side,offset,depth):
        positions = []
        for lateral, ds in [(side*offset, [start+(end-start)*i/8 for i in range(9)]),
                            (side*(offset+depth), [end-(end-start)*i/8 for i in range(9)])]:
            for d in ds:
                a = helpers.sample(line,cum,d)
                first, last = helpers.sample(line,cum,max(0,d-2)), helpers.sample(line,cum,min(total,d+2))
                dx,dy = last[0]-first[0],last[1]-first[1]
                length = math.hypot(dx,dy)
                positions.append([a[0]-dy/length*lateral,a[1]+dx/length*lateral])
        return positions+[positions[0]]
    for stand in settings['grandstands']:
        for block in range(stand['blocks']):
            start = remap(stand['from']+(stand['to']-stand['from'])*block/stand['blocks']+.5)
            end = remap(stand['from']+(stand['to']-stand['from'])*(block+1)/stand['blocks']-.5)
            relevant.append({'id': f"event-{len(relevant)}", 'tags': {'grandstand':'yes','name':stand['name'], 'source':stand['source']},
                             'world':ribbon_polygon(start,end,stand['side'],stand['offset'],stand['depth'])})
    trees = [positions[id] for id,n in nodes.items() if any(t.get('k')=='natural' and t.get('v')=='tree' for t in n.findall('tag'))
             and bounds['minX'] < positions[id][0] < bounds['maxX'] and bounds['minY'] < positions[id][1] < bounds['maxY']]
    controls = dict(settings['controlReference'], raceStartDistanceMeters=remap(rotation_distance),
                    sectorBoundaryDistancesMeters=[turns[4]['distanceMeters']+90,turns[11]['distanceMeters']+140],
                    speedTrapDistanceMeters=turns[13]['distanceMeters']-140)
    payload = {'model':{'bounds':bounds,'center':center,'centerline':line,'pitCenterline':pit,'turns':turns},
               'vectors':relevant,'trees':trees,'mainWayIds':main_ids,'officialControlPoints':controls,
               'sourceManifest':json.loads((ROOT/'docs/track-model-las-vegas-source-manifest.json').read_text()),
               'limitations':settings['limitations'],'grandstandDefinitions':settings['grandstands'],
               'geometryAudit':{**geometry_audit,'sourceCenterline':source_line,'pit':pit_geometry_audit,
                   'turnReferenceDistancesMeters':[d+rotation_distance for d in settings['officialTurnDistancesFromRaceStartMeters']]}}
    prepare_night_lighting(line,pit,bounds,[f['world']for f in features.values()
        if f['tags'].get('highway') in ('primary','secondary','tertiary','residential','service')])
    (ROOT/'.track-model-build/las-vegas.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    (PREPARED/'las-vegas-road-profiles.json').write_text(json.dumps(profiles))
    (PREPARED/'raster-metadata.json').write_text(json.dumps({'rasters':{'dtm':{'width':width,'height':height,'mean':float(graded.mean())}},
       'terrainSurface':{'source':'USGS 3DEP, NAVD88','originalResolutionMeters':5,'smoothingSigmaMeters':25,'verticalExaggeration':1},
       'roadGrading':{'corridorMeters':26,'maximumCorrectionMeters':float(np.abs(graded-source).max())}},indent=2))
    print(json.dumps({'lengthMeters':total,'lengthErrorPercent':abs(total-6201)/6201*100,'turns':turns,'controls':controls,'vectors':len(relevant),'trees':len(trees)},ensure_ascii=False))


if __name__ == '__main__':
    prepare()
