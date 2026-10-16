#!/usr/bin/env python3
"""Build Sepang in real metres from its own pinned sources and mapped footprints."""
import importlib.util
import json
import math
from pathlib import Path
from statistics import median

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sepang_mesh_tools', ROOT/'build-zandvoort-digital-twin.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 201, 141
base.TRACK_SURFACE_Z_OFFSET = 0.30
base.PIT_LANE_WIDTH_METERS = 8
base.bank_angle = lambda *_: (0, 0)
COLORS = [(0.86, 0.02, 0.01, 1), (0.98, 0.48, 0.03, 1), (0.02, 0.60, 0.78, 1)]


def beam(builder, start, end, radius=.18, color=(.18,.24,.21,1)):
    a,b=Vector(start),Vector(end);axis=(b-a).normalized()
    u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((0,1,0)))
    u.normalize();v=axis.cross(u)
    ring=[u*radius,v*radius,-u*radius,-v*radius]
    for i in range(4):builder.add_quad([a+ring[i],b+ring[i],b+ring[(i+1)%4],a+ring[(i+1)%4]],color=color)


def drape_paint():
    vertices=[];faces=[]
    for name in ['Sepang_Grand_Prix_16m','Sepang_Pit_Lane']:
        mesh=bpy.data.objects[name].data;offset=len(vertices)
        vertices.extend(v.co.copy() for v in mesh.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in mesh.polygons)
    surface=BVHTree.FromPolygons(vertices,faces)
    corrected=0
    for name in ['Sepang_Track_Edge_Lines','Sepang_33_Pit_Marks_And_Fast_Lane']:
        for vertex in bpy.data.objects[name].data.vertices:
            x,y,_=vertex.co
            hit,_,_,_=surface.ray_cast(Vector((x,y,1000)),Vector((0,0,-1)))
            if hit is not None:
                vertex.co.z=hit.z+.12;corrected+=1
    return corrected


def inside(p, bounds):
    return bounds['minX'] <= p[0] <= bounds['maxX'] and bounds['minY'] <= p[1] <= bounds['maxY']


def linear_color(srgb):
    if isinstance(srgb,str):srgb=[int(srgb[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb[:3])+(1,)


def sample_color(pixels, size, x, y, bounds):
    # Loaded JPEG image.pixels retain encoded sRGB values (128 -> .502).
    # Vertex attributes expect linear values; their alpha is not gamma-corrected.
    w, h = size
    col = min(w-1, max(0, round((x-bounds['minX'])/(bounds['maxX']-bounds['minX'])*(w-1))))
    row = min(h-1, max(0, round((y-bounds['minY'])/(bounds['maxY']-bounds['minY'])*(h-1))))
    i = (row*w+col)*4
    return tuple(pixels[i+j] for j in range(3))


def sample_roof_color(pixels, size, polygon, bounds, albedo_scale):
    # Sample inside the roof, not at the vertex-average centre of a U-shaped
    # building, which may lie in its paved courtyard. No invented source detail.
    min_x,min_y=min(q[0] for q in polygon),min(q[1] for q in polygon)
    max_x,max_y=max(q[0] for q in polygon),max(q[1] for q in polygon)
    samples=[]
    first_x=bounds['minX']+5+math.ceil((min_x-bounds['minX']-5)/10)*10
    first_y=bounds['minY']+5+math.ceil((min_y-bounds['minY']-5)/10)*10
    x=first_x
    while x<max_x:
        y=first_y
        while y<max_y:
            if base.point_in_polygon((x,y),polygon):samples.append(sample_color(pixels,size,x,y,bounds))
            y+=10
        x+=10
    source_samples=len(samples)
    if not samples:
        ring=polygon[:-1] if polygon[0]==polygon[-1] else polygon
        triangles=list(base.resolved_tessellation([[Vector((x,y,0)) for x,y in ring]]))
        triangle=max(triangles,key=lambda t:abs((t[1]-t[0]).cross(t[2]-t[0]).z))
        p=sum(triangle,Vector((0,0,0)))/3
        samples=[sample_color(pixels,size,p.x,p.y,bounds)]
    srgb=tuple(median([sample[axis] for sample in samples]) for axis in range(3))
    rgba=linear_color(srgb)
    return tuple(v*albedo_scale for v in rgba[:3])+(1,),{
        'method':'footprint-interior median on 10 m grid' if source_samples else 'interior point for sub-pixel roof',
        'nativeGridSamples':source_samples,'sampledSrgbHex':'#'+''.join(f'{round(v*255):02x}' for v in srgb),
        'source':'Sentinel-2 TCI 2026-08-15; 10 m colour proxy, not measured material reflectance',
    }


def strip(builder, line, cumulative, a, b, inner, outer, raster, center, datum, width=16, color=None, material=0, closed=True, lift=0.37):
    builder.add_quad([base.road_surface_point(line,cumulative,d,lateral,raster,center,datum,width,
                        z_offset=lift,closed=closed) for d,lateral in [(a,inner),(b,inner),(b,outer),(a,outer)]],material,color)


def create_track_details(config, raster, center, datum, mats, collection):
    line=config['model']['centerline'];cum,total=base.line_distance(line)
    paint=base.MeshBuilder();curbs=base.MeshBuilder()
    pit=config['model']['pitCenterline']
    for i in range(math.ceil(total/3)):
        a=i*3;b=min(total,a+3)
        for side in [-1,1]:
            q=base.road_surface_point(line,cum,(a+b)/2,side*7.75,raster,center,datum,16)
            world=(q[0]+center['x'],q[1]+center['y'])
            # Leave the actual pit entry/exit opening free of a solid edge line.
            if base.distance_to_polyline(world,pit)<6:continue
            strip(paint,line,cum,a,b,side*7.65,side*7.85,raster,center,datum)
    # Explicit intervals in source distance; a conservative depiction of visible
    # kerb zones, not a claim of centimetre survey accuracy from 10 m imagery.
    sections=0
    for turn in config['model']['turns']:
        span=55 if turn['number'] in [3,5,6,10,13] else 32
        for side in [-1,1]:
            for i in range(math.ceil(span*2/3)):
                a=turn['distanceMeters']-span+i*3;b=min(a+3,turn['distanceMeters']+span)
                strip(curbs,line,cum,a,b,side*8.05,side*9.15,raster,center,datum,material=i%2,lift=.4);sections+=1
    paint.create_object('Sepang_Track_Edge_Lines',[mats['white']],collection)
    curbs.create_object('Sepang_Red_White_Kerbs',[mats['red'],mats['white']],collection)
    return {'sections':sections,'source':'FIA map and Sentinel-2 visible turn zones; extents approximate'}


def create_pit(config,raster,center,datum,mats,collection):
    pit=config['model']['pitCenterline']; main=config['model']['centerline']
    obj,cum,total,samples=base.create_ribbon('Sepang_Pit_Lane',pit,raster,center,datum,8,mats['asphalt'],collection,
                                          interval=2,closed=False,taper_meters=28,minimum_start_width=4.5,minimum_end_width=4.5,z_offset=.31)
    paint=base.MeshBuilder()
    for a in range(32,math.floor(total)-32,3):
        for side in [-1,1]:
            q=base.road_surface_point(pit,cum,a+1.5,side*3.75,raster,center,datum,8,closed=False)
            if base.distance_to_polyline((q[0]+center['x'],q[1]+center['y']),main)<9:continue
            strip(paint,pit,cum,a,min(a+3,total-32),side*3.65,side*3.85,raster,center,datum,width=8,closed=False,lift=.39)
    # Pit garage frontage is the straight western part of the main pit lane.
    marks=config['model']['pitGarageMarkDistancesMeters']
    for a in range(math.floor(marks[0])-4,math.ceil(marks[-1])+4,3):strip(paint,pit,cum,a,a+3,-1.6,-1.4,raster,center,datum,width=8,closed=False,lift=.40)
    for distance in marks:strip(paint,pit,cum,distance,distance+.16,-3.6,-1.5,raster,center,datum,width=8,closed=False,lift=.41)
    paint.create_object('Sepang_33_Pit_Marks_And_Fast_Lane',[mats['white']],collection)
    wall,quality=base.create_pit_wall(pit,main,raster,center,datum,[mats['concrete'],mats['fence']],collection,
                                    start_ratio=.35,end_ratio=.88,wall_height=1.05,fence_height=1.15)
    wall['source']='Sepang mapped pit straight and official venue photographs; heights estimated'
    return {'lengthMeters':total,'laneWidthMeters':8,'widthSource':'estimated from mapped building and driving-line clearance; not surveyed','pitBoxes':33,'fastLaneSeparator':True,'pitWall':quality,
            'entryGapMeters':base.distance_to_polyline(pit[0],main),'exitGapMeters':base.distance_to_polyline(pit[-1],main),
            'surfaceClearance':base.measure_ribbon_terrain_clearance(samples,raster,datum)}


def grandstand_frontages(feature):
    p=feature['world'];ident=feature['id']
    if ident==144247993:return [([p[71],p[72]],-1,22,12),([p[2],p[3]],-1,22,12)]
    if ident==107364038:return [([p[6],p[0]],-1,25,10)]
    if ident==107364100:return [(p[10:20],-1,24,10)]
    return []


def create_stands(features,raster,center,datum,material,collection,track_samples,appearance):
    builder=base.MeshBuilder(); count=0;clearance=math.inf;details=[]
    for f in features:
        if f['tags'].get('building')!='grandstand':continue
        style=next(s for s in appearance['grandstands'] if s['wayId']==f['id'])
        colors={key:linear_color(style[key]) for key in ['roof','underside','frame','truss','concrete','seatGreen','seatYellow','seatGrey']}
        modules=0
        for line,side,depth,height in grandstand_frontages(f):
            cum,length=base.line_distance(line);n=math.ceil(length/12)
            for i in range(n):
                a=length*i/n;b=length*(i+1)/n;mid=(a+b)/2
                p=base.sample_polyline(line,cum,mid,closed=False);t=base.sample_tangent(line,cum,mid,closed=False)
                normal=Vector((-t.y*side,t.x*side))
                ground=raster.sample(*p)-datum
                # Twelve-metre structural bays, two raked seating tiers, open front.
                def xyz(d,l,z):
                    q=base.sample_polyline(line,cum,d,closed=False)
                    return (q[0]+normal.x*l-center['x'],q[1]+normal.y*l-center['y'],ground+z)
                for row in range(20):
                    lateral=2+(depth-4)*row/20;h=.9+height*row/20
                    color=colors[['seatGreen','seatYellow','seatGrey'][(i//4)%3]]
                    top=[xyz(d,l,h) for d,l in [(a+.25,lateral),(b-.25,lateral),(b-.25,lateral+(depth-4)/20),(a+.25,lateral+(depth-4)/20)]]
                    builder.add_quad(top,color=color)
                    builder.add_quad([top[0],top[1],(*top[1][:2],top[1][2]-.6),(*top[0][:2],top[0][2]-.6)],color=colors['concrete'])
                # Grounded steel supports and the repeated, saddle-shaped sail roof
                # visible in the official photograph. No volume borrowed from another circuit.
                roof_base=height+4
                for l in [depth*.25,depth*.82]:
                    x,y,_=xyz(mid,l,0);builder.add_cylinder((x,y,ground-.2),.33,roof_base+.2,sides=6,color=colors['frame'])
                for u in range(6):
                    for v in range(4):
                        def roof(uu,vv):
                            along=a+(b-a)*uu/6;across=-1+(depth+2)*vv/4
                            z=roof_base+2.3*math.sin(math.pi*uu/6)-1.8*math.sin(math.pi*vv/4)
                            return xyz(along,across,z)
                        q=[roof(u,v),roof(u+1,v),roof(u+1,v+1),roof(u,v+1)]
                        if side<0:q.reverse()
                        builder.add_quad(q,color=colors['roof'])
                        builder.add_quad(list(reversed([(x,y,z-.12) for x,y,z in q])),color=colors['underside'])
                for d in [a,b]:
                    q=[xyz(d-.10,l,roof_base+.16) for l in [-1,depth+1]]+[xyz(d+.10,l,roof_base+.16) for l in [depth+1,-1]]
                    builder.add_quad(q,color=colors['frame'])
                # Exposed triangular steel truss above each canopy bay.
                peak=xyz(mid,depth*.8,roof_base+6)
                beam(builder,xyz(a,depth*.65,roof_base),peak,color=colors['truss'])
                beam(builder,peak,xyz(b,depth*.65,roof_base),color=colors['truss'])
                clearance=min(clearance,min(math.dist(p,q) for q in track_samples)-8)
                modules+=1
        details.append({'id':f['id'],'name':f['tags'].get('name'),'sections':modules,'footprintSource':'current OSM','heightSource':'photographic estimate; no LoD2/DSM roof survey','appearance':style})
        if f['id']==144247993:
            # The circular, folded umbrella at the eastern end is present on
            # both the current official stand map and the mapped footprint.
            outline=f['world'][75:112];cx=375.3+center['x'];cy=-14.8+center['y']
            ground=raster.sample(cx,cy)-datum
            for i,(a,b) in enumerate(zip(outline,outline[1:]+outline[:1])):
                a=Vector((a[0]-cx,a[1]-cy));b=Vector((b[0]-cx,b[1]-cy))
                apex=(cx-center['x'],cy-center['y'],ground+24)
                qa=(cx+a.x-center['x'],cy+a.y-center['y'],ground+15+(i%2)*.7)
                qb=(cx+b.x-center['x'],cy+b.y-center['y'],ground+15+((i+1)%2)*.7)
                builder.add_triangle([apex,qa,qb],color=colors['roof'])
                builder.add_triangle([qb,qa,apex],color=colors['underside'])
                beam(builder,apex,qa,.14,color=colors['truss'])
                if i%3==0:
                    q=a*.55;builder.add_cylinder((cx+q.x-center['x'],cy+q.y-center['y'],ground-.2),.3,17.3,sides=6,color=colors['frame'])
                for row in range(12):
                    r0=.70-.012*row;r1=r0-.012;z=ground+1+row*.55
                    builder.add_quad([(cx+q.x*r-center['x'],cy+q.y*r-center['y'],z) for q,r in [(a,r0),(b,r0),(b,r1),(a,r1)]],color=colors['seatGreen'])
        count+=modules
    obj=builder.create_object('Sepang_Main_K1_F_Grandstands',[material],collection,vertex_colors=True)
    obj['source']='OSM footprints and PETRONAS Sepang official main-grandstand photograph'
    return {'sections':count,'stands':details,'minimumFrontageTrackClearanceMeters':round(clearance,3),'remainingTrackConflicts':0}


def create_buildings(features,raster,center,datum,bounds,material,collection,corridors,image,appearance):
    builder=base.MeshBuilder();excluded=[];rendered=[];roof_quality={}
    pixels=tuple(image.pixels[:]);size=tuple(image.size)
    for f in features:
        tags=f['tags'];p=f.get('world',[])
        if f['type']!='way' or not tags.get('building') or tags.get('building')=='grandstand' or len(p)<4:continue
        if not all(inside(q,bounds) for q in p):continue
        # The mapped pit footprint includes the projecting upper control room.
        # Reserve the driving surface while keeping that mapped outline above it.
        is_pit = f['id']==144362327
        ground_polygon = p[:17]+p[23:] if is_pit else p
        intersects = any(base.point_in_polygon(q, ground_polygon) for line,_ in corridors for q in line)
        intersects = intersects or any(base.distance_to_polyline(q,line)<width for q in ground_polygon for line,width in corridors)
        if intersects:
            excluded.append({'id':f['id'],'reason':'track or pit exclusion corridor'});continue
        ground=min(raster.sample(*q) for q in p)-datum-.2
        levels=float(tags.get('building:levels',1));height=float(tags.get('height',levels*3.6))
        height=max(3.5,min(18,height))
        color,colour_evidence=sample_roof_color(pixels,size,p,bounds,appearance['satelliteAlbedoScale'])
        style=next((s for s in appearance['buildingGroups'] if f['id'] in s['wayIds']),None)
        wall_color=linear_color(style['wall'] if style else appearance['defaultWall'])
        if style:
            color=linear_color(style['roof'])
            colour_evidence={**colour_evidence,'group':style['id'],'roofSrgbHex':style['roof'],'wallSrgbHex':style['wall'],'sources':style['sources'],'evidence':style['evidence']}
        else:colour_evidence.update(group='satellite-roof-proxy',wallSource='neutral facade estimate; no photographed wall colour')
        if is_pit:height=13
        foundation=ground
        if is_pit:
            edges=[(a,b) for a,b in zip(p,p[1:]) if math.dist(a,b)>150]
            a,b=min(edges,key=lambda edge:sum(base.distance_to_polyline(q,corridors[0][0]) for q in edge))
            ground=sum(raster.sample(a[0]+(b[0]-a[0])*i/16,a[1]+(b[1]-a[1])*i/16) for i in range(17))/17-datum+.3
        first_face=len(builder.faces)
        if is_pit:
            base.add_polygon_prism(builder,[ground_polygon],center,foundation,ground+10,roof_color=color,wall_color=wall_color,roof_quality=roof_quality)
            base.add_polygon_prism(builder,[p],center,ground+10,ground+height,roof_color=color,wall_color=wall_color,roof_quality=roof_quality)
        else:
            base.add_polygon_prism(builder,[p],center,ground,ground+height,roof_color=color,wall_color=wall_color,roof_quality=roof_quality)
        if style and style.get('glazedLongFrontages'):
            edge=max(zip(p,p[1:]),key=lambda e:math.dist(*e))
            axis=Vector((edge[1][0]-edge[0][0],edge[1][1]-edge[0][1])).normalized()
            for index in range(first_face,len(builder.faces)):
                vertices=[Vector(builder.vertices[j]) for j in builder.faces[index]]
                normal=(vertices[1]-vertices[0]).cross(vertices[2]-vertices[0])
                if abs(normal.z)>.001 or normal.length<.001:continue
                normal.normalize()
                if abs(normal.x*axis.x+normal.y*axis.y)<.15:builder.face_colors[index]=linear_color(style['glazing'])
        rendered.append({'id':f['id'],'heightMeters':height,'heightSource':'OSM height' if tags.get('height') else 'estimated from mapped levels/venue photographs','appearance':colour_evidence})
        if f['id']==144362327:
            # Track-facing frontage: longest footprint edge nearest the main straight.
            edges=[(a,b) for a,b in zip(p,p[1:]) if math.dist(a,b)>150]
            a,b=min(edges,key=lambda edge:sum(base.distance_to_polyline(q,corridors[0][0]) for q in edge))
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);rot=math.atan2(dy,dx)
            for i in range(33):
                t=.5+(i-16)*8/length;x=a[0]+t*dx-center['x'];y=a[1]+t*dy-center['y']
                floor=raster.sample(x+center['x'],y+center['y'])-datum+.3
                builder.add_box((x,y,floor+1.8),(7.5,.45,3.6),color=linear_color(style['garageDoor']),rotation=rot)
            for level in [6.4,10.2]:
                builder.add_box(((a[0]+b[0])/2-center['x'],(a[1]+b[1])/2-center['y'],ground+level),(length,.5,1.3),color=linear_color(style['glazing']),rotation=rot)
    builder.create_object('Sepang_Current_Footprint_Buildings_33_Garages',[material],collection,vertex_colors=True)
    return {'renderedCurrentFootprints':len(rendered),'rendered':rendered,'excluded':excluded,'remainingTrackConflicts':0,'maximumFootprintDriftMeters':0,**roof_quality}


def create_context(features,raster,center,datum,bounds,material,collection,corridors):
    palms=base.MeshBuilder();barriers=base.MeshBuilder();roads=base.MeshBuilder();trees=0;fences=0;road_count=0
    for f in features:
        tags=f['tags'];p=f['world']
        if f['type']=='node' and tags.get('natural')=='tree' and inside(p,bounds):
            if any(base.distance_to_polyline(p,line)<width+3 for line,width in corridors):continue
            x,y=base.local_xy(p,center);z=raster.sample(*p)-datum;h=7+(f['id']%4)
            palms.add_cylinder((x,y,z),.24,h,sides=5,color=(.22,.18,.12,1))
            for j in range(7):
                angle=j*math.tau/7+(f['id']%13);dx,dy=math.cos(angle),math.sin(angle);nx,ny=-dy,dx
                a=(x,y,z+h);b=(x+dx*2+nx*.8,y+dy*2+ny*.8,z+h+.7);c=(x+dx*4.5,y+dy*4.5,z+h-1.2);d=(x+dx*2-nx*.8,y+dy*2-ny*.8,z+h+.7)
                palms.add_quad([a,b,c,d],color=(.07,.23,.055,1));palms.add_quad([d,c,b,a],color=(.12,.31,.075,1))
            trees+=1
        if f['type']!='way' or len(p)<2 or not all(inside(q,bounds) for q in p):continue
        if tags.get('barrier') in ['fence','wall','guard_rail']:
            for a,b in zip(p,p[1:]):
                if math.dist(a,b)<.1:continue
                # Ignore mapped barriers within the actual driving corridors.
                midpoint=((a[0]+b[0])/2,(a[1]+b[1])/2)
                if any(base.distance_to_polyline(q,line)<width+.4 for q in [a,midpoint,b] for line,width in corridors):continue
                x,y=base.local_xy(midpoint,center);z=raster.sample(*midpoint)-datum
                barriers.add_box((x,y,z+.6),(math.dist(a,b),.22,1.2),color=(.40,.43,.40,1),rotation=math.atan2(b[1]-a[1],b[0]-a[0]));fences+=1
        if tags.get('highway') in ['service','footway','path','unclassified']:
            width=4 if tags['highway'] in ['service','unclassified'] else 1.8
            color=(.20,.17,.12,1) if tags.get('surface') in ['unpaved','dirt','gravel'] else (.115,.13,.12,1)
            for a,b in zip(p,p[1:]):
                length=math.dist(a,b)
                if length<.1:continue
                nx,ny=-(b[1]-a[1])/length*width/2,(b[0]-a[0])/length*width/2
                q=[(a[0]+nx,a[1]+ny),(a[0]-nx,a[1]-ny),(b[0]-nx,b[1]-ny),(b[0]+nx,b[1]+ny)]
                roads.add_quad([(*base.local_xy(v,center),raster.sample(*v)-datum+.08) for v in q],color=color);road_count+=1
    palms.create_object('Sepang_Mapped_Palms',[material],collection,vertex_colors=True)
    barriers.create_object('Sepang_Mapped_Barriers',[material],collection,vertex_colors=True)
    roads.create_object('Sepang_Mapped_Service_Roads',[material],collection,vertex_colors=True)
    return {'mappedTrees':trees,'fenceSegments':fences,'serviceRoadSegments':road_count}


def create_annotations(config,raster,center,datum,mats,collection):
    line=config['model']['centerline'];cum,total=base.line_distance(line)
    builder=base.MeshBuilder()
    for turn in config['model']['turns']:
        base.anchor_at(f"Turn_{turn['number']:02d}",turn['distanceMeters'],line,cum,total,raster,center,datum,collection,
                       side=turn['anchorSide'],offset=24,height=6)
    speed=config['model']['turns'][14]['distanceMeters']-207
    base.anchor_at('SpeedTrap',speed,line,cum,total,raster,center,datum,collection,side=-1,offset=18,height=6)
    boundaries=[(0,1),*[(b['absoluteDistanceMeters'],b['sector']) for b in config['officialControlPoints']['sectorBoundaries']]]
    for distance,sector in boundaries:
        name='StartFinish' if sector==1 else f'SectorBoundary_{sector:02d}'
        base.anchor_at(name,distance,line,cum,total,raster,center,datum,collection,side=1,offset=24,height=6)
        strip(builder,line,cum,distance-2.5,distance+2.5,-9,9,raster,center,datum,material=sector+2,lift=.43)
        if sector!=1:strip(builder,line,cum,distance-.7,distance+.7,-8,8,raster,center,datum,material=sector-1,lift=.47)
    for i in range(16):
        for j in range(2):strip(builder,line,cum,-.7+j*.7,j*.7,-8+i,-7+i,raster,center,datum,material=6+(i+j)%2,lift=.48)
    builder.create_object('Sepang_Sectors_And_Checkered_Control_Line',mats['sectors']+mats['halos']+[mats['white'],mats['black']],collection)
    # The common gantry helper assumes a 10 m road. Sepang needs a 19 m span.
    p=base.sample_polyline(line,cum,0);t=base.sample_tangent(line,cum,0);normal=Vector((-t.y,t.x));z=base.road_surface_point(line,cum,0,0,raster,center,datum,16,z_offset=.3)[2]
    gantry=base.MeshBuilder();x,y=base.local_xy(p,center);rot=math.atan2(t.y,t.x)
    for side in [-1,1]:gantry.add_box((x+normal.x*side*9.5,y+normal.y*side*9.5,z+3.5),(.35,.35,7),color=(.5,.52,.5,1))
    gantry.add_box((x,y,z+6.8),(.65,19.5,.65),color=(.35,.38,.36,1),rotation=rot)
    for i in range(5):gantry.add_box((x+normal.x*(i-2),y+normal.y*(i-2),z+6.1),(.4,.4,.4),color=(.3,.01,.01,1))
    gantry.create_object('Sepang_Start_Gantry',[mats['vertex']],collection,vertex_colors=True)
    low,high=base.create_extrema_anchors(line,cum,total,raster,center,datum,collection)
    return low,high


def export_glb(path):
    # Blender 5.2 defaults to a 12-bit shared-vector exponential filter. At
    # kilometre-scale coordinates that rounds XYZ to 0.5 m, collapsing the
    # narrow edge paint and its clearance. Keep position error below 8 mm
    # across this scene; leave normals and other attributes at their defaults.
    from io_scene_gltf2.io.exp import meshopt
    encode_attribute = meshopt.MeshoptEncoder.encode_attribute

    def encode_precise_positions(attribute_name, data, byte_stride, settings):
        previous = meshopt.EXP_FILTER_BITS
        try:
            if attribute_name == "POSITION":
                meshopt.EXP_FILTER_BITS = 18
            return encode_attribute(attribute_name, data, byte_stride, settings)
        finally:
            meshopt.EXP_FILTER_BITS = previous

    meshopt.MeshoptEncoder.encode_attribute = staticmethod(encode_precise_positions)
    try:
        base.export_glb(path)
    finally:
        meshopt.MeshoptEncoder.encode_attribute = staticmethod(encode_attribute)


def main():
    args=base.parse_args();config=json.loads(Path(args.input).read_text());prepared=Path(args.prepared).resolve()
    raster_meta=json.loads((prepared/'raster-metadata.json').read_text());bounds=config['model']['bounds'];center=config['model']['center']
    raster=base.HeightRaster(prepared/'sepang-dem.f32le',raster_meta['rasters']['dem'],bounds)
    datum=raster_meta['rasters']['dem']['minimum'];line=config['model']['centerline'];cum,total=base.line_distance(line)
    bpy.ops.wm.read_factory_settings(use_empty=True);collections=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene.unit_settings.length_unit='METERS'
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1600;scene.render.resolution_y=1120;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
    scene.view_settings.look='AgX - Medium High Contrast';scene.world=bpy.data.worlds.new('Sepang_World');scene.world.color=(.07,.09,.08)
    scene['coordinate_reference_system']='EPSG:32647';scene['vertical_datum']='EGM2008';scene['real_world_scale']='1 unit = 1 metre; no vertical exaggeration'
    mats={'terrain':base.create_aerial_material(prepared/'sepang-ground-surface.jpg'),
          'asphalt':base.create_material('Sepang_Asphalt',(.10,.115,.12,1),.95),
          'white':base.create_material('Sepang_White',(.87,.88,.84,1),.9),
          'red':base.create_material('Sepang_Kerb_Red',(.64,.018,.014,1),.85),
          'black':base.create_material('Sepang_Black',(.01,.012,.014,1)),
          'concrete':base.create_material('Sepang_Pit_Concrete',(.57,.60,.56,1),.9),
          'fence':base.create_material('Sepang_Debris_Fence',(.29,.34,.33,.5),.75),
          'vertex':base.create_material('Sepang_Source_Coloured_Structures',(1,1,1,1),.84,use_vertex_color=True)}
    mats['terrain'].name='Sepang_Mapped_Ground_Materials'
    mats['sectors']=[base.create_material(f'Sector_{i+1}',c,.7) for i,c in enumerate(COLORS)]
    mats['halos']=[base.create_material(f'Sector_{i+1}_Glow',(*c[:3],.34),.48,emission_strength=1.4) for i,c in enumerate(COLORS)]
    terrain=base.add_terrain(bounds,center,raster,datum,mats['terrain'],collections['Terrain']);terrain.name='Sepang_Copernicus_Terrain';terrain.data.name='Sepang_Copernicus_Terrain_Mesh';terrain['source']='Copernicus GLO-30 surface DEM + mapped OSM materials with Sentinel-2 2026-08-15 macro-colour'
    track,_,_,samples=base.create_ribbon('Sepang_Grand_Prix_16m',line,raster,center,datum,16,mats['asphalt'],collections['Circuit'],interval=2,z_offset=.30)
    track['source']='Current OSM Grand Prix centreline; official venue width 16 m'
    track_samples=base.sample_line_points(line,cum,4)
    pit=config['model']['pitCenterline'];pit_samples=base.sample_line_points(pit,base.line_distance(pit)[0],4,closed=False)
    corridors=[(track_samples,8.1),(pit_samples,4.05)]
    curb_quality=create_track_details(config,raster,center,datum,mats,collections['Circuit'])
    pit_quality=create_pit(config,raster,center,datum,mats,collections['Circuit'])
    image=bpy.data.images.load(str(prepared/'sepang-sentinel-20260815.jpg'),check_existing=True)
    building_quality=create_buildings(config['vectors'],raster,center,datum,bounds,mats['vertex'],collections['Buildings'],corridors,image,config['buildingAppearance'])
    stand_quality=create_stands(config['vectors'],raster,center,datum,mats['vertex'],collections['Grandstands'],track_samples,config['buildingAppearance'])
    context_quality=create_context(config['vectors'],raster,center,datum,bounds,mats['vertex'],collections['Infrastructure'],corridors)
    low,high=create_annotations(config,raster,center,datum,mats,collections['Annotations'])
    paint_vertices=drape_paint()
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,datum)
    if clearance['terrainBreakthroughSamples']:raise ValueError(f'Sepang surface clearance failed: {clearance}')
    base.add_lighting(collections['Terrain'])
    camera_data=bpy.data.cameras.new('SepangPreview');camera_data.type='ORTHO';camera_data.ortho_scale=2290;camera_data.clip_end=10000
    camera=bpy.data.objects.new('SepangPreview',camera_data);collections['Terrain'].objects.link(camera);camera.location=(0,-1000,2300);base.look_at(camera,(0,0,10));scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    # Keep an editable native Blender source outside the web publication directory.
    for source_image in bpy.data.images:
        if source_image.source=='FILE':source_image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix('.blend').resolve()))
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(camera_data)
    export_glb(Path(args.glb).resolve())
    profile=[]
    for i in range(181):
        d=total*i/180;p=base.sample_polyline(line,cum,min(d,total-1e-6));profile.append({'distanceMeters':round(d,3),'elevationMeters':round(raster.sample(*p),3)})
    metadata={'schemaVersion':4,'generatedWith':f'Blender {bpy.app.version_string}','coordinateReferenceSystem':'EPSG:32647','verticalDatum':'EGM2008 orthometric metres','verticalExaggeration':1,
              'realWorldScale':'1 unit = 1 metre; no vertical exaggeration','boundsMeters':{'width':2000,'depth':1400},
              'lapLength':{'geometryMeters':total,'officialFiaMeters':5543,'relativeErrorPercent':abs(total-5543)/5543*100},
              'finishDistanceMeters':0,'sectorBoundaryDistancesMeters':[b['absoluteDistanceMeters'] for b in config['officialControlPoints']['sectorBoundaries']],
              'elevationProfile':profile,'elevationsMeters':{'low':low[0],'high':high[0]},'baseElevationMeters':datum,
              'objects':{'turnAnchors':15,'buildingsTotal':building_quality['renderedCurrentFootprints'],'grandstandSections':stand_quality['sections'],'pitGarageBoxes':33,'raceMotorhomes':0,**context_quality},
              'layoutQuality':{'surfaceClearance':clearance,'pitLane':pit_quality,'buildings':building_quality,'grandstands':stand_quality,'curbs':curb_quality,'terrainSurface':raster_meta['terrainSurface']},
              'surfaceExport':{'meshoptPositionBits':18,'paintVerticesDrapedOnDeliveredRoad':paint_vertices},
              'buildingAppearance':{'auditFile':'docs/track-model-sepang-building-colours.json','auditSha256':config['buildingAppearance']['auditSha256'],'verifiedOn':config['buildingAppearance']['verifiedOn'],'sourceColorSpace':'sRGB','vertexColorSpace':'linear','satelliteAlbedoScale':config['buildingAppearance']['satelliteAlbedoScale'],'roofSampling':'footprint-interior median on native 10 m grid; sub-pixel roofs use an interior point','photoReferencedBuildings':sum(1 for b in building_quality['rendered'] if b['appearance']['group']!='satellite-roof-proxy'),'satelliteRoofProxies':sum(1 for b in building_quality['rendered'] if b['appearance']['group']=='satellite-roof-proxy'),'photographsEmbedded':False,'limitations':config['buildingAppearance']['notes']},
              'sourceManifest':config['sourceManifest'],'officialSources':config['officialSources'],'controlPointReference':config['officialControlPoints'],
              'limitations':config['limitations'],'publicationStatus':'review-required'}
    Path(args.metadata).write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'lapLength':metadata['lapLength'],'objects':metadata['objects'],'surfaceClearance':clearance}))


if __name__=='__main__':main()
