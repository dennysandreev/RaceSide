"""Topology-aware bridge chains, complete building relations and shoreline checks."""
from collections import defaultdict
import math
import xml.etree.ElementTree as ET


def stitch(segments):
    pending=[list(s) for s in segments];rings=[]
    while pending:
        ring=pending.pop(0)
        while ring[0]!=ring[-1]:
            for i,other in enumerate(pending):
                if other[0]==ring[-1]:ring.extend(other[1:]);pending.pop(i);break
                if other[-1]==ring[-1]:ring.extend(list(reversed(other[:-1])));pending.pop(i);break
            else:raise ValueError('Incomplete polygon boundary')
        rings.append(ring)
    return rings


def inside(point,ring):
    x,y=point;hit=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit


def clip_ring(ring,bounds):
    result=[list(p) for p in ring]
    for axis,edge,sign in ((0,bounds['minX'],1),(0,bounds['maxX'],-1),(1,bounds['minY'],1),(1,bounds['maxY'],-1)):
        old=result;result=[]
        if not old:break
        for a,b in zip(old,old[1:]+old[:1]):
            ia=(a[axis]-edge)*sign>=0;ib=(b[axis]-edge)*sign>=0
            if ia:result.append(a)
            if ia!=ib:
                t=(edge-a[axis])/(b[axis]-a[axis]);result.append([a[j]+(b[j]-a[j])*t for j in range(len(a))])
    return result


def prepare(source,geo,config):
    root=ET.parse(source/'osm.xml').getroot();nodes={n.get('id'):geo.utm48(float(n.get('lon')),float(n.get('lat'))) for n in root.findall('node')}
    ways={w.get('id'):{'ids':[n.get('ref') for n in w.findall('nd')],'tags':geo.tags(w)} for w in root.findall('way')}
    # Building tags can be on relations, with entirely untagged constituent ways.
    relational=[];outer_ids=set()
    for relation in root.findall('relation'):
        tags=geo.tags(relation)
        if tags.get('type')!='multipolygon' or 'building' not in tags:continue
        outer=[m.get('ref') for m in relation.findall('member') if m.get('role')=='outer' and m.get('type')=='way']
        inner=[m.get('ref') for m in relation.findall('member') if m.get('role')=='inner' and m.get('type')=='way']
        if not all(ident in ways for ident in outer+inner):continue
        outer_ids.update(map(int,outer));holes=[[nodes[i] for i in ring] for ring in stitch([ways[i]['ids'] for i in inner])]
        for ring in stitch([ways[i]['ids'] for i in outer]):
            footprint=[nodes[i] for i in ring];clipped=clip_ring(footprint[:-1],config['model']['bounds'])
            if len(clipped)<3:continue
            ident=int(relation.get('id'));height=geo.number(tags.get('height'))
            relational.append({'osmWayId':-ident,'osmRelationId':ident,'name':tags.get('name'),'tags':tags,'footprint':footprint,'holes':[h for h in holes if inside(h[0],footprint)],'closed':True,'heightMeters':height,'positiveHeightKnown':height is not None and height>0,'roofShapeKnown':bool(tags.get('roof:shape')),'facadeSurveyAvailable':False})
    config['buildings']=[b for b in config['buildings'] if b['osmWayId'] not in outer_ids]+relational
    # Simple 3D Buildings: an outline is a 2D parent, not another solid
    # enclosing its building:part volumes (relations are optional in OSM).
    parents=[b for b in config['buildings'] if 'building' in b['tags'] and 'building:part' not in b['tags'] and b['closed']]
    def area(ring):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1])))/2
    parent_boxes={b['osmWayId']:(min(p[0] for p in b['footprint']),min(p[1] for p in b['footprint']),max(p[0] for p in b['footprint']),max(p[1] for p in b['footprint'])) for b in parents}
    for part in config['buildings']:
        if 'building:part' not in part['tags'] or not part['closed']:continue
        points=part['footprint'][:-1];candidates=[]
        for parent in parents:
            box=parent_boxes[parent['osmWayId']]
            if not all(box[0]-.15<=p[0]<=box[2]+.15 and box[1]-.15<=p[1]<=box[3]+.15 for p in points):continue
            if all((inside(p,parent['footprint']) or geo.nearest(parent['footprint'],p)[0]<.15) and not any(inside(p,h) for h in parent.get('holes',[])) for p in points):candidates.append(parent)
        if candidates:
            parent=min(candidates,key=lambda b:area(b['footprint']));parent['hasBuildingParts']=True;part['parentOutlineId']=parent['osmWayId']
    config['landscapeExclusions']=[{'points':[nodes[n] for n in w['ids']],'radius':1.8 if w['tags'].get('highway') in ('footway','path','steps','cycleway','pedestrian') else 5} for w in ways.values() if 'highway' in w['tags'] and w['tags'].get('bridge') not in ('yes','viaduct') and w['tags'].get('tunnel')!='yes']
    config['parkFurniture']=[{'id':int(n.get('id')),'point':nodes[n.get('id')],'kind':geo.tags(n)['amenity']} for n in root.findall('node') if geo.tags(n).get('amenity') in ('bench','picnic_table','waste_basket','drinking_water')]
    water=[]
    for ident in (9542146,9569901):
        doc=ET.parse(source/f'water-{ident}.osm').getroot();nn={n.get('id'):geo.utm48(float(n.get('lon')),float(n.get('lat'))) for n in doc.findall('node')};ww={w.get('id'):[n.get('ref') for n in w.findall('nd')] for w in doc.findall('way')};rel=next(r for r in doc.findall('relation') if r.get('id')==str(ident))
        rings={role:[[nn[n] for n in ring] for ring in stitch([ww[m.get('ref')] for m in rel.findall('member') if m.get('role')==role and m.get('type')=='way'])] for role in ('outer','inner')}
        water.append({'relationId':ident,**rings})
    config['waterPolygons']=water
    # Join source segments using OSM endpoint IDs, not positional proximity.
    highway={ident:w for ident,w in ways.items() if w['tags'].get('highway') and len(w['ids'])>=2}
    foot={'footway','path','steps','pedestrian','cycleway','corridor'}
    def category(w):return 'foot' if w['tags'].get('highway') in foot else 'road'
    bridges={i:w for i,w in highway.items() if w['tags'].get('bridge') in ('yes','viaduct') and w['tags'].get('highway') not in ('construction','proposed') and w['tags'].get('tourism')!='attraction'}
    adjacent=defaultdict(list);all_adjacent=defaultdict(list)
    for i,w in highway.items():
        for node in (w['ids'][0],w['ids'][-1]):all_adjacent[(node,category(w))].append(i)
    for i,w in bridges.items():
        for node in (w['ids'][0],w['ids'][-1]):adjacent[(node,category(w))].append(i)
    used=set();chains=[]
    for ident,w in bridges.items():
        if ident in used:continue
        cat=category(w);ids=list(w['ids']);members=[ident];used.add(ident)
        for reverse in (False,True):
            if reverse:ids.reverse();members.reverse()
            while len(adjacent[(ids[-1],cat)])==2:
                following=next((i for i in adjacent[(ids[-1],cat)] if i not in used),None)
                if following is None:break
                other=bridges[following]['ids'];other=other if other[0]==ids[-1] else list(reversed(other));ids.extend(other[1:]);members.append(following);used.add(following)
        members=list(dict.fromkeys(members));original_endpoints=[ids[0],ids[-1]];approaches=[]
        for reverse in (False,True):
            if reverse:ids.reverse()
            endpoint=ids[-1]
            if len(adjacent[(endpoint,cat)])>1:continue
            length=0;visited=set(members)
            while length<(230 if cat=='road' else 25):
                a,b=nodes[ids[-2]],nodes[ids[-1]];direction=[b[j]-a[j] for j in (0,1)];norm=math.hypot(*direction);candidates=[]
                for other in all_adjacent[(ids[-1],cat)]:
                    if other in visited or other in bridges:continue
                    candidate=highway[other];t=candidate['tags']
                    if t.get('tunnel')=='yes' or t.get('access')=='private':continue
                    seq=candidate['ids'] if candidate['ids'][0]==ids[-1] else list(reversed(candidate['ids']));q=nodes[seq[1]];v=[q[j]-b[j] for j in (0,1)];cos=sum(v[j]*direction[j] for j in (0,1))/max(math.hypot(*v)*norm,1e-9)
                    if cos>-.1:candidates.append((cos,other,seq))
                if not candidates:break
                _,other,seq=max(candidates);visited.add(other);approaches.append(int(other))
                for n in seq[1:]:
                    length+=math.dist(nodes[ids[-1]],nodes[n]);ids.append(n)
                    if length>=(230 if cat=='road' else 25):break
                if length>=(230 if cat=='road' else 25):break
        points=[nodes[i] for i in ids];bb=config['model']['bounds']
        if max(p[0] for p in points)<bb['minX'] or min(p[0] for p in points)>bb['maxX'] or max(p[1] for p in points)<bb['minY'] or min(p[1] for p in points)>bb['maxY']:continue
        names={bridges[i]['tags'].get('bridge:name') or bridges[i]['tags'].get('name','') for i in members};name=next((n for n in sorted(names) if n),'Pedestrian bridge' if cat=='foot' else 'Road ramp')
        lanes=max(geo.number(bridges[i]['tags'].get('lanes')) or 2 for i in members)
        width=4 if cat=='foot' else min(18,lanes*3.2+.7)
        if name=='Esplanade Bridge':width=13
        endpoint_modes=[]
        for n in (ids[0],ids[-1]):
            p=nodes[n];edge=not(bb['minX']+1<p[0]<bb['maxX']-1 and bb['minY']+1<p[1]<bb['maxY']-1)
            endpoint_modes.append('map-edge' if edge else 'junction' if len(adjacent[(n,cat)])>1 else 'ground')
        trimmed=0
        if cat=='foot' and name not in ('Anderson Bridge','Esplanade Bridge') and not any(int(i) in (395859738,256505618) for i in members):
            for reverse in (False,True):
                if reverse:points.reverse();endpoint_modes.reverse()
                if endpoint_modes[-1]=='ground':
                    while len(points)>2 and geo.nearest(config['model']['centerline'],points[-1])[0]<6.5+width/2:
                        a,b=points[-2],points[-1];length=math.dist(a,b)
                        if length<=.5:trimmed+=length;points.pop()
                        else:
                            points[-1]=[b[j]+(a[j]-b[j])*.5/length for j in (0,1)];trimmed+=.5
            points.reverse();endpoint_modes.reverse()
        chains.append({'name':name,'category':cat,'osmWayIds':list(map(int,members)),'approachWayIds':approaches,'points':points,'widthMeters':width,'endpoints':endpoint_modes,'originalEndpointIds':original_endpoints,'eventAccessTrimMeters':trimmed})
    config['bridgeChains']=chains
    config['contextPreparation']={'multipolygonBuildings':len(relational),'joinedBridgeChains':len(chains),'waterRelationIds':[9542146,9569901]}
