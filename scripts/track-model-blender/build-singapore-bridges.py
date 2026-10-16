"""Continuous bridge decks, source-aligned approaches, shared joints and grounded ends."""
import math
from mathutils import Vector


def smooth_points(original):
    points=[Vector(p) for p in original]
    for _ in range(2):
        smooth=[points[0]]
        for a,b in zip(points,points[1:]):smooth.extend((a.lerp(b,.25),a.lerp(b,.75)))
        smooth.append(points[-1]);points=smooth
    return points


def build(model,base,Mesh,beam,context):
    bounds=model.c['model']['bounds'];local={k:v-model.center['x' if k.endswith('X') else 'y'] for k,v in bounds.items()}
    class ClippedMesh(Mesh):
        def add_triangle(self,triangle,material_index=0,color=None):
            polygon=context.clip_ring(triangle,local)
            for i in range(1,len(polygon)-1):super().add_triangle([polygon[0],polygon[i],polygon[i+1]],material_index,color)
    raised,integrated,rails=ClippedMesh(),ClippedMesh(),ClippedMesh();records=[];joints={}
    for chain in model.c['bridgeChains']:
        for p,mode in zip((chain['points'][0],chain['points'][-1]),chain['endpoints']):
            if mode=='junction':joints[tuple(p)]=24 if chain['category']=='road' else 7
    def visible(p):return bounds['minX']<=p[0]<=bounds['maxX'] and bounds['minY']<=p[1]<=bounds['maxY']
    for chain in model.c['bridgeChains']:
        original=chain['points'];points=smooth_points(original)
        if len(points)<2:continue
        # Corner cuts retain endpoints, so independently sourced bridge ways join exactly.
        cum,total=base.line_distance(points)
        if total<1:continue
        road=chain['category']=='road';name=chain['name'];race_bridge=name in ('Anderson Bridge','Esplanade Bridge') or any(i in chain['osmWayIds'] for i in (395859738,256505618))
        target=integrated if race_bridge else raised
        width=chain['widthMeters'];half=width/2
        # Shared absolute deck levels avoid separate-way steps. Heights are documented estimates.
        high=24 if 'Sheares' in name or name=='East Coast Parkway' or 'junction' in chain['endpoints'] else 16 if name=='Bayfront Bridge' else 7 if road else 5.5
        high=max(high,max(model.r.sample(*p) for p in points)+(5 if road else 3))
        paired_road=None
        if not road and not race_bridge and total>65:
            probes=[base.sample_polyline(points,cum,total*i/8,closed=False) for i in range(9)]
            candidates=[]
            for other in model.c['bridgeChains']:
                if other['category']!='road':continue
                distances=sorted(base.distance_to_polyline(p,other['points']) for p in probes)
                candidates.append((distances[len(distances)//2],other))
            gap,other=min(candidates,key=lambda item:item[0])
            if gap<30:
                paired_road=other['name']
                if paired_road=='Esplanade Bridge':race_bridge=True;target=integrated
                elif 'Sheares' in paired_road or paired_road=='East Coast Parkway' or 'junction' in other['endpoints']:high=max(high,24)
                elif paired_road=='Bayfront Bridge':high=max(high,16)
        if not race_bridge:
            for d in range(0,math.ceil(total),10):
                p=base.sample_polyline(points,cum,d,closed=False)
                if base.distance_to_polyline(p,model.line)<half+8:
                    distance=base.nearest_distance(model.line,model.cum,p)
                    high=max(high,model.surface(distance)[2]+7)
        start_ground=model.r.sample(*points[0])+.25;end_ground=model.r.sample(*points[-1])+.25
        end_heights=[joints.get(tuple(p),high) if mode=='junction' else model.r.sample(*p)+.25 if mode=='ground' else high for p,mode in zip((points[0],points[-1]),chain['endpoints'])]
        ramp=min((330 if high>=20 else 140) if road else 35,total*.46)
        steps=max(2,math.ceil(total/8));sections=[]
        def interpolate(t):t=max(0,min(t,1));return t*t*(3-2*t)
        for i in range(steps+1):
            d=total*i/steps;p=base.sample_polyline(points,cum,d,closed=False);t=base.sample_tangent(points,cum,d,delta=3,closed=False);n=Vector((-t.y,t.x))
            if race_bridge:
                nearest=base.nearest_distance(model.line,model.cum,p);z=model.surface(nearest)[2]-.10
                # Source approaches extend beyond the race footprint, meeting the real ground.
                if base.distance_to_polyline(p,model.line)>35:z=model.r.sample(*p)+.25
            else:
                z=high
                if chain['endpoints'][0]=='ground':z=min(z,start_ground+(high-start_ground)*interpolate(d/ramp))
                if chain['endpoints'][1]=='ground':z=min(z,end_ground+(high-end_ground)*interpolate((total-d)/ramp))
                if chain['endpoints'][0]=='junction':z+= (end_heights[0]-high)*(1-interpolate(d/max(ramp,1)))
                if chain['endpoints'][1]=='junction':z+= (end_heights[1]-high)*(1-interpolate((total-d)/max(ramp,1)))
            left,right=Vector(p)+n*half,Vector(p)-n*half
            blend=max(1-interpolate(d/20) if chain['endpoints'][0]=='ground' else 0,1-interpolate((total-d)/20) if chain['endpoints'][1]=='ground' else 0) if not race_bridge else 0
            crossfall=lambda q:(model.r.sample(*q)-model.r.sample(*p))*blend
            sections.append({'d':d,'p':p,'n':n,'z':z,'left':(*model.xy(left),z+crossfall(left)),'right':(*model.xy(right),z+crossfall(right))})
        for a,b in zip(sections,sections[1:]):
            top=[a['left'],a['right'],b['right'],b['left']];bottom=[(x,y,z-.55) for x,y,z in top]
            target.add_quad(top,color=(.39,.41,.40,1) if road else (.56,.55,.50,1))
            target.add_quad(list(reversed(bottom)),color=(.58,.59,.56,1))
            for indices in ((0,3),(1,2)):
                i,j=indices;target.add_quad([bottom[i],bottom[j],top[j],top[i]],color=(.63,.64,.60,1))
            # A road integrated into the circuit gets its race safety walls from the main ribbon.
            if not race_bridge:
                for side in ('left','right'):
                    aa,bb=a[side],b[side]
                    # A ground-level city junction is closed by the circuit's
                    # safety wall. Its city guardrail must not cut across F1.
                    if any(base.distance_to_polyline((q[0]+model.center['x'],q[1]+model.center['y']),model.line)<9 and q[2]<model.surface(base.nearest_distance(model.line,model.cum,(q[0]+model.center['x'],q[1]+model.center['y'])))[2]+4.5 for q in (aa,bb)):continue
                    rails.add_quad([(aa[0],aa[1],aa[2]+.50),(bb[0],bb[1],bb[2]+.50),(bb[0],bb[1],bb[2]+.90),(aa[0],aa[1],aa[2]+.90)],color=(.71,.72,.69,1))
                if road and round(a['d']/8)%2==0:
                    for lateral in range(1,max(2,round(width/3.2))):
                        if base.distance_to_polyline(a['p'],model.line)<half+8 and a['z']<model.surface(base.nearest_distance(model.line,model.cum,a['p']))[2]+4.5:continue
                        offset=-half+width*lateral/max(2,round(width/3.2));aa=Vector(a['p'])+a['n']*offset;bb=Vector(b['p'])+b['n']*offset
                        # Shared cross section gives continuous source-aligned lane paint.
                        n=a['n']*.08;m=b['n']*.08
                        rails.add_quad([(*model.xy(aa-n),a['z']+.045),(*model.xy(aa+n),a['z']+.045),(*model.xy(bb+m),b['z']+.045),(*model.xy(bb-m),b['z']+.045)],color=(.82,.83,.78,1))
        for section,mode in ((sections[0],chain['endpoints'][0]),(sections[-1],chain['endpoints'][-1])):
            if mode!='junction':
                a,b=section['left'],section['right'];target.add_quad([a,b,(b[0],b[1],b[2]-.55),(a[0],a[1],a[2]-.55)],color=(.60,.61,.58,1))
        supports=0
        for section in sections[::max(1,round(55/(total/steps)))]:
            if not visible(section['p']):continue
            q=section['left']
            if base.distance_to_polyline(section['p'],model.line)<half+9 and section['z']<7:continue
            beam(rails,(q[0],q[1],q[2]),(q[0],q[1],q[2]+5),.06)
            model.luminaires.add_box((q[0],q[1],q[2]+5),(.7,.35,.12))
        for section in sections[::max(1,round(38/(total/steps)))]:
            p=section['p'];z=section['z'];ground=model.r.sample(*p)
            if not visible(p) or z-ground<2 or any(base.distance_to_polyline(p,l)<radius+1.5 for l,radius in model.corridors):continue
            raised.add_cylinder((*model.xy(p),ground-.1),.65 if road else .25,z-ground-.45,8,color=(.64,.65,.61,1));supports+=1
        # Helix bridge is a pedestrian deck with a visible double helical steel frame.
        if name=='The Helix' and total>70:
            for i,(a,b) in enumerate(zip(sections,sections[1:])):
                for phase in (0,math.pi):
                    def helix(s):
                        angle=s['d']/14*math.tau+phase;p=Vector(s['p'])+s['n']*(math.cos(angle)*2.7)
                        return (*model.xy(p),s['z']+2.6+math.sin(angle)*2.6)
                    beam(rails,helix(a),helix(b),.09,(.77,.78,.75,1))
        endpoint_records=[]
        for sec,mode in zip((sections[0],sections[-1]),chain['endpoints']):
            endpoint_records.append({'mode':mode,'position':list(sec['p']),'heightMeters':sec['z'],'groundMeters':model.r.sample(*sec['p']),'visible':visible(sec['p'])})
        records.append({'name':name,'osmWayIds':chain['osmWayIds'],'approachWayIds':chain['approachWayIds'],'lengthMeters':total,'widthMeters':width,'category':chain['category'],'raceIntegrated':race_bridge,'pairedRoad':paired_road,'endpoints':endpoint_records,'supports':supports,'heightEstimated':True})
    model.object(raised,'Elevated_Bridges');model.object(integrated,'Race_Bridge_Decks');model.object(rails,'Bridge_Rails_And_Paint')
    by_position={}
    for record in records:
        for endpoint in record['endpoints']:
            if endpoint['mode']=='junction':by_position.setdefault(tuple(endpoint['position']),[]).append(endpoint['heightMeters'])
    max_gap=max((max(v)-min(v) for v in by_position.values()),default=0)
    ungrounded=[e for r in records if not r['raceIntegrated'] for e in r['endpoints'] if e['mode']=='ground' and e['visible'] and abs(e['heightMeters']-e['groundMeters']-.25)>.01]
    if max_gap>.001 or ungrounded:raise ValueError(f'Bridge endpoint audit failed: {max_gap}, {ungrounded}')
    return {'chains':records,'count':len(records),'maximumJointHeightGapMeters':max_gap,'ungroundedInteriorEndpoints':len(ungrounded),'joinedSourceWays':sum(len(r['osmWayIds']) for r in records),'method':'OSM endpoint topology, continuous shared sections, source-aligned approach roads, map-edge clipping. Vertical profiles estimated.'}
