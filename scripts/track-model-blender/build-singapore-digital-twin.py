#!/usr/bin/env python3
"""Blender Marina Bay reconstruction from pinned OSM/OneMap data and event references."""
import importlib.util
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('sg_mesh_tools',SCRIPTS/'build-zandvoort-digital-twin.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.TERRAIN_COLUMNS,base.TERRAIN_ROWS=161,129
spec=importlib.util.spec_from_file_location('sg_context',SCRIPTS/'prepare-singapore-context.py')
context=importlib.util.module_from_spec(spec);spec.loader.exec_module(context)
spec=importlib.util.spec_from_file_location('sg_bridges',SCRIPTS/'build-singapore-bridges.py')
bridge_builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge_builder)
spec=importlib.util.spec_from_file_location('sg_cleanup',SCRIPTS/'singapore-mesh-cleanup.py')
cleanup=importlib.util.module_from_spec(spec);spec.loader.exec_module(cleanup)


def linear(c):return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c[:3])+(c[3],)


class Mesh(base.MeshBuilder):
    def add_triangle(self,triangle,material_index=0,color=None):
        super().add_triangle(triangle,material_index,linear(color) if color else None)


base.MeshBuilder=Mesh


def beam(builder,a,b,r=.15,color=(.65,.67,.66,1)):
    a,b=Vector(a),Vector(b);axis=b-a
    if axis.length<.01:return
    axis.normalize();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((0,1,0)))
    u.normalize();v=axis.cross(u);ring=[u*r,v*r,-u*r,-v*r]
    for i in range(4):builder.add_quad([a+ring[i],b+ring[i],b+ring[(i+1)%4],a+ring[(i+1)%4]],color=color)


def fill(builder,ring,color,holes=()):
    rings=[ring,*holes]
    for tri in base.resolved_tessellation([[Vector(p) for p in r] for r in rings]):builder.add_triangle(tri,color=color)


def number(value,default=0):
    try:return float(str(value).split()[0])
    except (ValueError,TypeError):return default


def color(value,default):
    try:return tuple(int(value.lstrip('#')[i:i+2],16)/255 for i in (0,2,4))+(1,)
    except (ValueError,TypeError,AttributeError):return default


class Raster:
    def __init__(self,prepared):
        self.data=json.loads((prepared/'terrain.json').read_text());self.bounds=self.data['bounds']
    def sample(self,x,y):
        b=self.bounds;u=max(0,min(160,(x-b['minX'])/(b['maxX']-b['minX'])*160));v=max(0,min(128,(y-b['minY'])/(b['maxY']-b['minY'])*128))
        col,row=min(159,int(u)),min(127,int(v));dx,dy=u-col,v-row;a=self.data['values']
        # Match the two exported triangles in each terrain cell exactly.
        return (a[row][col]*(1-dx)+a[row][col+1]*(dx-dy)+a[row+1][col+1]*dy if dx>=dy else
                a[row][col]*(1-dy)+a[row+1][col+1]*dx+a[row+1][col]*(dy-dx))
    sample_rendered_terrain=sample


def road_section(points,cumulative,distance,raster,datum,width,z_offset=.6,closed=True,banked=False):
    p=base.sample_polyline(points,cumulative,distance,closed=closed);t=base.sample_tangent(points,cumulative,distance,closed=closed);n=Vector((-t.y,t.x))
    ground=max(raster.sample(p[0]+n.x*s,p[1]+n.y*s) for s in (-7,-3.5,0,3.5,7))
    # Smooth estimated bridge approaches, in metres without exaggeration.
    d=distance%cumulative[-1] if closed else distance
    if closed:
        for start,end,height in ((2810,3050,3.5),(3100,3550,6.5)):
            if start<d<end:ground=max(ground,height*math.sin(math.pi*(d-start)/(end-start))**2)
    return p,t,n,ground-datum+z_offset,0


base.road_cross_section=road_section


class Singapore:
    def __init__(self,c,r,collections,m):
        self.c,self.r,self.collections,self.m=c,r,collections,m;self.center=c['model']['center'];self.line=c['model']['centerline'];self.pit=c['model']['pitCenterline']
        self.cum,self.total=base.line_distance(self.line);self.pc,self.pt=base.line_distance(self.pit)
        self.corridors=[(base.sample_line_points(self.line,self.cum,2),6.4),(base.sample_line_points(self.pit,self.pc,2,closed=False),4.05)]
        self.permanent=[b['footprint'][:-1] for b in c['buildings'] if b['closed'] and number(b['tags'].get('height'),10)>0 and number(b['tags'].get('min_height'))==0 and b['tags'].get('building')!='construction']
        self.features={b['osmWayId']:b for b in c['buildings']};self.struct=Mesh();self.landmark=Mesh();self.luminaires=Mesh();self.accent=Mesh();self.reserved=[];self.stand_records=[]
        self.bridge_corridors=[]
        for chain in c['bridgeChains']:
            points=bridge_builder.smooth_points(chain['points']);steps,_=base.line_distance(points)
            self.bridge_corridors.append((base.sample_line_points(points,steps,2,closed=False),chain['widthMeters']/2+1))
    def xy(self,p):return base.local_xy(p,self.center)
    def surface(self,d,lateral=0,pit=False,lift=.6):
        return base.road_surface_point(self.pit if pit else self.line,self.pc if pit else self.cum,d,lateral,self.r,self.center,0,8 if pit else 12,z_offset=lift,closed=not pit)
    def strip(self,b,a,z,left,right,material=0,pit=False,lift=.74):
        b.add_quad([self.surface(d,s,pit,lift) for d,s in ((a,left),(z,left),(z,right),(a,right))],material)
    def object(self,b,name,collection='Infrastructure',material=None,colors=True):
        return b.create_object('Singapore_'+name,material or [self.m['vertex']],self.collections[collection],vertex_colors=colors)
    def allowed(self,ring):
        for points,radius in self.corridors:
            lo=[min(p[i] for p in ring)-radius for i in (0,1)];hi=[max(p[i] for p in ring)+radius for i in (0,1)]
            nearby=[p for p in points if lo[0]<=p[0]<=hi[0] and lo[1]<=p[1]<=hi[1]]
            if any(base.distance_point_polygon(p,ring)<radius for p in nearby):return False
        return True
    def road(self):
        _,_,_,samples=base.create_ribbon('Singapore_Raceway',self.line,self.r,self.center,0,12,self.m['asphalt'],self.collections['Circuit'],interval=2,z_offset=.6)
        pit_object,_,_,pit_samples=base.create_ribbon('Singapore_Pit_Lane',self.pit,self.r,self.center,0,8,self.m['asphalt'],self.collections['Circuit'],interval=2,z_offset=.58,closed=False,taper_meters=30,minimum_start_width=3,minimum_end_width=3)
        # Both routes share one road level at entry/exit. Independent terrain
        # samples previously made the merging pit edge half a metre lower.
        for i,section in enumerate(pit_samples):
            d,x,y,z,t,n,bank,width=section;gap=base.distance_to_polyline((x,y),self.line)
            if gap>=22:continue
            main_z=self.surface(base.nearest_distance(self.line,self.cum,(x,y)))[2]-.02
            blend=max(0,min(1,(22-gap)/10));height=max(z,z+(main_z-z)*blend)
            pit_object.data.vertices[2*i].co.z=height;pit_object.data.vertices[2*i+1].co.z=height
            pit_samples[i]=(d,x,y,height,t,n,bank,width)
        heights=[s[3] for s in pit_samples]
        for indices in (range(1,len(heights)),range(len(heights)-2,-1,-1)):
            for i in indices:
                j=i-1 if indices.step>0 else i+1
                heights[i]=max(heights[i],heights[j]-.04*abs(pit_samples[i][0]-pit_samples[j][0]))
        for i,height in enumerate(heights):
            pit_object.data.vertices[2*i].co.z=height;pit_object.data.vertices[2*i+1].co.z=height
            s=pit_samples[i];pit_samples[i]=(*s[:3],height,*s[4:])
        pit_object.data.update()
        paint,curbs=Mesh(),Mesh();count=math.ceil(self.total/2)
        for i in range(count):
            a,b=self.total*i/count,self.total*(i+1)/count
            for side in (-1,1):self.strip(paint,a,b,side*5.66,side*5.85)
        for turn in self.c['model']['turns']:
            d=turn['distanceMeters'];a=base.sample_tangent(self.line,self.cum,d-15);b=base.sample_tangent(self.line,self.cum,d+15);side=1 if a.x*b.y-a.y*b.x>0 else -1
            for i in range(18):self.strip(curbs,d-27+i*3,d-24+i*3,side*5.88,side*6.85,material=i%2,lift=.79)
        # FIA commitment line (dashed then solid), inner entry arc and garage
        # fast lane. Do not draw an arbitrary divider down the approach centre.
        for d in range(12,int(self.pt)-18,2):
            p=base.sample_polyline(self.pit,self.pc,d,closed=False);gap=base.distance_to_polyline(p,self.line)
            if d<55 and d%8>=4:continue
            self.strip(paint,d,d+2,-3.8,-3.6,pit=True,lift=.76)
            if gap>11:self.strip(paint,d,d+2,3.6,3.8,pit=True,lift=.76)
            if 260<d<self.pt-170:self.strip(paint,d,d+2,-.3,-.13,pit=True,lift=.76)
            if d<280 and gap>11:
                self.strip(curbs,d,d+2,-4,-4.9,material=(d//2)%2,pit=True,lift=.80)
        # At merges the two asphalt ribbons overlap. Project decals onto the
        # exported triangles, including their cross-slope, instead of guessing Z.
        roads=[bpy.data.objects[name].data for name in ('Singapore_Raceway','Singapore_Pit_Lane')]
        surfaces=[BVHTree.FromPolygons([v.co for v in mesh.vertices],[p.vertices for p in mesh.polygons]) for mesh in roads]
        for i,(x,y,z) in enumerate(paint.vertices):
            hits=[tree.ray_cast(Vector((x,y,100)),Vector((0,0,-1)))[0] for tree in surfaces]
            heights=[p.z for p in hits if p is not None]
            if heights:paint.vertices[i]=(x,y,max(heights)+.11)
        self.object(paint,'Edge_And_Pit_Paint','Circuit',[self.m['white']],False)
        self.object(curbs,'Kerbs','Circuit',[self.m['red'],self.m['white']],False)
        # Race safety walls follow the source-derived route; gate openings at pit junctions.
        fences=Mesh();panels=Mesh();p0=base.nearest_distance(self.line,self.cum,self.pit[0]);p1=base.nearest_distance(self.line,self.cum,self.pit[-1])
        for d in range(0,int(self.total)-4,5):
            for side in (-1,1):
                a=self.surface(d,side*8.0,lift=.6);b=self.surface(d+5,side*8.0,lift=.6)
                world=[a[0]+self.center['x'],a[1]+self.center['y']]
                if base.distance_to_polyline(world,self.pit)<6 or min(abs(d-p0),abs(d-p1))<25:continue
                if any(base.distance_to_polyline((a[0]*(1-f)+b[0]*f+self.center['x'],a[1]*(1-f)+b[1]*f+self.center['y']),self.line)<6.6 for f in (0,.25,.5,.75,1)):continue
                beam(fences,(a[0],a[1],a[2]+.6),(b[0],b[1],b[2]+.6),.38,(.69,.69,.64,1))
                beam(fences,(a[0],a[1],a[2]+1.1),(a[0],a[1],a[2]+3.7),.055)
                panels.add_quad([(a[0],a[1],a[2]+1.1),(b[0],b[1],b[2]+1.1),(b[0],b[1],b[2]+3.7),(a[0],a[1],a[2]+3.7)])
        self.object(fences,'Safety_Walls');self.object(panels,'Catch_Fences',material=[self.m['fence']],colors=False)
        # Pit wall on the side of the pit lane facing the main straight.
        wall_segments=0
        for d in range(55,int(self.pt)-40,4):
            p=base.sample_polyline(self.pit,self.pc,d,closed=False);nearest=min(self.corridors[0][0],key=lambda q:math.dist(p,q))
            if math.dist(p,nearest)<11 or math.dist(p,nearest)>32:continue
            t=base.sample_tangent(self.pit,self.pc,d,closed=False);n=Vector((-t.y,t.x));side=1 if (Vector(nearest)-Vector(p)).dot(n)>0 else -1
            a=self.surface(d,side*4.7,pit=True);b=self.surface(d+4,side*4.7,pit=True)
            beam(self.struct,(a[0],a[1],a[2]+.65),(b[0],b[1],b[2]+.65),.4,(.73,.72,.67,1));beam(self.struct,(a[0],a[1],a[2]+1),(a[0],a[1],a[2]+3),.07);wall_segments+=1
        for d in range(25,int(self.total),45):
            a=self.surface(d,-10);world=[a[0]+self.center['x'],a[1]+self.center['y']]
            if base.distance_to_polyline(world,self.pit)<6:continue
            beam(self.struct,a,(a[0],a[1],a[2]+10),.12,(.62,.65,.64,1))
            self.struct.add_box((a[0],a[1],a[2]+10),(2.5,.6,.35),color=(.87,.86,.76,1))
            self.luminaires.add_box((a[0],a[1],a[2]+9.8),(2.3,.6,.08))
        for d in range(35,int(self.pt)-30,35):
            a=self.surface(d,5.5,pit=True)
            self.luminaires.add_box((a[0],a[1],a[2]+7),(1.5,.45,.12))
            beam(self.struct,a,(a[0],a[1],a[2]+7),.07)
        return {'main':base.measure_ribbon_terrain_clearance(samples,self.r,0),'pit':base.measure_ribbon_terrain_clearance(pit_samples,self.r,0),'pitWallSegments':wall_segments}
    def in_water(self,p):
        return any(any(context.inside(p,r) for r in water['outer']) and not any(context.inside(p,r) for r in water['inner']) for water in self.c['waterPolygons'])
    def stand_fits(self,ring):
        if not self.allowed(ring) or any(base.polygons_overlap(ring,q) for q in self.reserved+self.permanent):return False
        for points,radius in self.bridge_corridors:
            lo=[min(p[i] for p in ring)-radius for i in (0,1)];hi=[max(p[i] for p in ring)+radius for i in (0,1)]
            if any(base.distance_point_polygon(p,ring)<radius for p in points if lo[0]<=p[0]<=hi[0] and lo[1]<=p[1]<=hi[1]):return False
        a,b,c,d=[Vector(p) for p in ring]
        return not any(self.in_water(a.lerp(b,u/15).lerp(d.lerp(c,u/15),v/10)) for u in range(16) for v in range(11))
    def grandstands(self):
        b=Mesh();excluded=[]
        for stand in self.c['grandstands']:
            for a in range(stand['start'],stand['end'],32):
                end=min(a+29,stand['end']);side=stand['side'];inner=stand['offset'];outer=inner+stand['depth'];mid=(a+end)/2
                p=Vector(base.sample_polyline(self.line,self.cum,mid));t=base.sample_tangent(self.line,self.cum,mid);n=Vector((-t.y,t.x))*side
                fitted=None
                for depth_candidate in (stand['depth'],12,10,8,6):
                    for offset_candidate in (stand['offset'],18,14,11,9):
                        candidate=[list(p+t*u+n*v) for u,v in ((-(end-a)/2,offset_candidate),((end-a)/2,offset_candidate),((end-a)/2,offset_candidate+depth_candidate),(-(end-a)/2,offset_candidate+depth_candidate))]
                        if self.stand_fits(candidate):
                            fitted=(candidate,offset_candidate,depth_candidate);break
                    if fitted:break
                if not fitted:
                    excluded.append({'name':stand['name'],'distance':a,'reason':'shoreline, permanent building, bridge or race corridor clearance'});continue
                ring,inner,stand_depth=fitted;outer=inner+stand_depth
                self.reserved.append(ring);z=max(self.r.sample(*q) for q in ring)+.15;rows=max(5,round(stand_depth/1.35));depth=stand_depth/rows
                for row in range(rows):
                    va=inner+row*depth;vb=va+depth;h=z+1+row*.43
                    pts=[(*self.xy(p+t*u+n*v),h) for u,v in ((-(end-a)/2,va),((end-a)/2,va),((end-a)/2,vb),(-(end-a)/2,vb))]
                    b.add_quad(pts,color=(.28,.38,.43,1));b.add_quad([pts[0],pts[1],(pts[1][0],pts[1][1],h-.43),(pts[0][0],pts[0][1],h-.43)],color=(.65,.66,.62,1))
                    # Continuous seat strips, shared mesh: restrained blue/grey as references.
                    beam(b,tuple(Vector(pts[3])+Vector((0,0,.22))),tuple(Vector(pts[2])+Vector((0,0,.22))),.16,(.27,.47,.58,1))
                for u in (-(end-a)/2,0,(end-a)/2):
                    for v in (inner,outer):
                        q=p+t*u+n*v;top=z+1+(rows-1)*.43 if v==outer else z+1
                        beam(b,(*self.xy(q),self.r.sample(*q)),(*self.xy(q),top),.16)
                    aa=p+t*u+n*inner;bb=p+t*u+n*outer
                    beam(b,(*self.xy(aa),z+.5),(*self.xy(bb),z+1+(rows-1)*.43),.13)
                self.stand_records.append({'name':stand['name'],'footprint':ring,'rows':rows,'estimated':True})
        self.object(b,'Grandstands','Grandstands')
        return {'sections':len(self.stand_records),'footprints':self.stand_records,'excluded':excluded,'remainingCorridorConflicts':0,'waterConflicts':0,'bridgeFootprintConflicts':0,'bridgeExclusionMarginMeters':1}
    def buildings(self):
        walls=Mesh();roofs=Mesh();uvs=[];records=[];excluded=[];special={256163011,256163012,230082125,116800998}
        flyer_parts={f['osmWayId'] for f in self.c['buildings'] if 492119925<=f['osmWayId']<=492119974}
        outline_ids={int(m['ref']) for rel in self.c['buildingRelations'] for m in rel['members'] if m['role']=='outline' and any(x['role']=='part' for x in rel['members'])}
        for feature in self.c['buildings']:
            ident=feature['osmWayId'];tags=feature['tags'];ring=feature['footprint']
            if not feature['closed'] or len(ring)<4:continue
            original_ring=ring[:-1];ring=context.clip_ring(original_ring,self.c['model']['bounds'])
            if len(ring)<3:continue
            holes=[context.clip_ring(h[:-1],self.c['model']['bounds']) for h in feature.get('holes',[])]
            holes=[h for h in holes if len(h)>=3]
            if ident in special or ident in flyer_parts:continue
            if ident in outline_ids or feature.get('hasBuildingParts') or ('height' in tags and number(tags['height'])<=0) or tags.get('building')=='construction':
                excluded.append({'osmWayId':ident,'reason':'parent outline / non-volumetric / construction'});continue
            if not self.allowed(ring) or any(base.polygons_overlap(ring,q) for q in self.reserved):
                excluded.append({'osmWayId':ident,'reason':'race corridor or reserved 2026 grandstand'});continue
            height=number(tags.get('height'),number(tags.get('building:levels'),3)*3.3);bottom=number(tags.get('min_height'),number(tags.get('building:min_level'))*3.3)
            if height<=bottom:continue
            foundation=self.features.get(feature.get('parentOutlineId'),feature)['footprint']
            ground=min(self.r.sample(*q) for q in foundation);roofheight=min(height-bottom,number(tags.get('roof:height'),2 if tags.get('roof:shape') in ('gabled','hipped','mansard','pyramidal','dome','round') else 0))
            top=ground+height-roofheight;floor_count=max(1,number(tags.get('building:levels'),round((height-bottom)/3.3))-number(tags.get('building:min_level')))
            style=3 if ident==49890775 else 1 if tags.get('building') in ('hotel','apartments','residential') or ident in (116801004,172307472,172307471,172364975,172364973) else 0 if height>35 else 2
            if 'Fullerton' in (feature.get('name') or ''):style=2
            facade=color(tags.get('building:colour'),(.77,.78,.76,1));roofcolor=color(tags.get('roof:colour'),(.54,.55,.53,1))
            if max(roofcolor[:3])-min(roofcolor[:3])>.7:roofcolor=(.57,.31,.23,1)
            # Facade UVs encode real wall length and tagged floor counts. Repeated bays are estimated.
            for a,b in [edge for loop in [ring,*holes] for edge in zip(loop,loop[1:]+loop[:1])]:
                length=math.dist(a,b);quad=[(*self.xy(a),ground+bottom),(*self.xy(b),ground+bottom),(*self.xy(b),top),(*self.xy(a),top)]
                start=len(walls.faces);walls.add_quad(quad,style,color=facade);u=length/(6 if style==3 else 3.3)/4;v=max(.25,floor_count-roofheight/3.3)/4
                for face in walls.faces[start:]:
                    faceuv=[]
                    for vi in face:
                        vx,vy,vz=walls.vertices[vi];frac=math.hypot(vx-quad[0][0],vy-quad[0][1])/max(length,1e-9);faceuv.append((frac*u,(vz-ground-bottom)/max(top-ground-bottom,1e-9)*v))
                    uvs.append(faceuv)
            roofring=[(*self.xy(q),top) for q in ring]
            shape=tags.get('roof:shape','flat');cx=sum(q[0] for q in ring)/len(ring);cy=sum(q[1] for q in ring)/len(ring)
            if roofheight>.1 and shape in ('dome','round'):
                apex=(*self.xy((cx,cy)),ground+height)
                for i in range(len(ring)):roofs.add_triangle([roofring[i],roofring[(i+1)%len(ring)],apex],color=roofcolor)
            elif roofheight>.1 and shape in ('hipped','gabled','mansard','pyramidal'):
                upper=[(cx+(q[0]-cx)*.64,cy+(q[1]-cy)*.64) for q in ring]
                upper=[(*self.xy(q),ground+height) for q in upper]
                for i in range(len(ring)):roofs.add_quad([roofring[i],roofring[(i+1)%len(ring)],upper[(i+1)%len(ring)],upper[i]],color=roofcolor)
                fill(roofs,upper,roofcolor)
            else:
                fill(roofs,roofring,roofcolor,[[(*self.xy(q),top) for q in hole] for hole in holes])
                if height>12 and bottom==0:
                    for a,b in zip(roofring,roofring[1:]+roofring[:1]):roofs.add_quad([a,b,(b[0],b[1],b[2]+.35),(a[0],a[1],a[2]+.35)],color=roofcolor)
            records.append({'osmWayId':ident,'name':feature.get('name'),'heightMeters':height,'baseHeightMeters':bottom,'groundMeters':ground,'parentOutlineId':feature.get('parentOutlineId'),'osmRelationId':feature.get('osmRelationId'),'clippedAtMapEdge':ring!=original_ring,'heightEstimated':not feature['positiveHeightKnown'],'facadeEstimated':True,'roofShape':shape})
        overlap_audit={'facades':cleanup.clean(walls,uvs),'roofs':cleanup.clean(roofs),'suppressedParentOutlines':sum(bool(b.get('hasBuildingParts')) for b in self.c['buildings'])}
        wall=self.object(walls,'Facades','Buildings',[self.m[s] for s in ('glass','balcony','stone','garage')]);uv=wall.data.uv_layers.new(name='FacadeBayFloorUV')
        for poly,coords in zip(wall.data.polygons,uvs):
            for index,value in zip(poly.loop_indices,coords):uv.data[index].uv=value
        self.object(roofs,'Roofs','Buildings')
        self.esplanade();self.flyer();self.skypark()
        return {'count':len(records),'rendered':records,'excluded':excluded,'coplanarCleanup':overlap_audit,'sourceToRenderCentroidDriftMeters':0,'remainingCorridorConflicts':0,'facadeMethod':'Mapped footprints/heights; tagged colours and roof shapes. Repeated window and balcony textures reconstructed, not surveyed.'}
    def esplanade(self):
        for ident in (256163011,256163012):
            f=self.features[ident];ring=f['footprint'][:-1];c=Vector(tuple(sum(p[i] for p in ring)/len(ring) for i in (0,1)))
            # Principal footprint axes, maintaining mapped building orientation and extent.
            xx=sum((p[0]-c.x)**2 for p in ring);yy=sum((p[1]-c.y)**2 for p in ring);xy=sum((p[0]-c.x)*(p[1]-c.y) for p in ring)
            theta=.5*math.atan2(2*xy,xx-yy);u=Vector((math.cos(theta),math.sin(theta)));v=Vector((-u.y,u.x))
            rx=max(abs((Vector(p)-c).dot(u)) for p in ring);ry=max(abs((Vector(p)-c).dot(v)) for p in ring);ground=self.r.sample(*c)
            def p(a,t):
                q=c+u*(rx*math.sin(t)*math.cos(a))+v*(ry*math.sin(t)*math.sin(a));return (*self.xy(q),ground+13+22*math.cos(t))
            for row in range(12):
                t0=row/12*math.pi/2;t1=(row+1)/12*math.pi/2
                for col in range(48):
                    a=col/48*math.tau;b=(col+1)/48*math.tau;quad=[p(a,t0),p(b,t0),p(b,t1),p(a,t1)]
                    self.landmark.add_quad(quad,color=(.21,.35,.36,1))
                    middle=sum((Vector(q) for q in quad),Vector())/4;middle.z+=.65
                    self.landmark.add_triangle([quad[0],quad[2],middle],color=(.70,.71,.63,1));self.landmark.add_triangle([quad[1],quad[2],middle],color=(.53,.56,.51,1))
            for a,b in zip(ring,ring[1:]+ring[:1]):self.landmark.add_quad([(*self.xy(a),ground),(*self.xy(b),ground),(*self.xy(b),ground+13),(*self.xy(a),ground+13)],color=(.65,.62,.55,1))
    def flyer(self):
        ring=self.features[230082125]['footprint'][:-1];c=Vector(tuple(sum(p[i] for p in ring)/len(ring) for i in (0,1)))
        # Wheel's long plan axis is derived from the source footprint.
        xx=sum((p[0]-c.x)**2 for p in ring);yy=sum((p[1]-c.y)**2 for p in ring);xy=sum((p[0]-c.x)*(p[1]-c.y) for p in ring);angle=.5*math.atan2(2*xy,xx-yy)
        u=Vector((math.cos(angle),math.sin(angle)));v=Vector((-u.y,u.x));ground=self.r.sample(*c);x,y=self.xy(c)
        def p(a,side=0,radius=75):return (x+u.x*math.cos(a)*radius+v.x*side,y+u.y*math.cos(a)*radius+v.y*side,ground+90+math.sin(a)*radius)
        for side in (-3,3):
            for i in range(112):beam(self.landmark,p(i/112*math.tau,side),p((i+1)/112*math.tau,side),.5,(.84,.85,.83,1))
            for i in range(112):beam(self.accent,p(i/112*math.tau,side*1.05,75.3),p((i+1)/112*math.tau,side*1.05,75.3),.16)
            for i in range(28):beam(self.landmark,(x+v.x*side,y+v.y*side,ground+90),p(i/28*math.tau,side),.10,(.72,.75,.75,1))
        for i in range(28):
            a=i/28*math.tau;q=p(a);self.landmark.add_box(q,(7.2,4,3.5),rotation=angle+math.pi/2,color=(.22,.37,.43,1))
            beam(self.landmark,p(a,-4),p(a,4),.25,(.83,.83,.78,1))
        for side in (-1,1):
            for along in (-16,16):
                foot=(x+v.x*side*22+u.x*along,y+v.y*side*22+u.y*along,ground)
                beam(self.landmark,foot,(x+v.x*side*6,y+v.y*side*6,ground+90),1.6,(.85,.85,.81,1))
        beam(self.landmark,(x-v.x*7,y-v.y*7,ground+90),(x+v.x*7,y+v.y*7,ground+90),2,(.75,.76,.73,1))
    def skypark(self):
        f=self.features[116800998];ring=f['footprint'][:-1];c=Vector(tuple(sum(p[i] for p in ring)/len(ring) for i in (0,1)));ground=self.r.sample(*c)
        top=[(*self.xy(p),ground+200) for p in ring];bottom=[(*self.xy(c+(Vector(p)-c)*.93),ground+193) for p in ring]
        fill(self.landmark,top,(.62,.60,.51,1));fill(self.landmark,bottom,(.59,.59,.55,1))
        for i in range(len(ring)):self.landmark.add_quad([bottom[i],bottom[(i+1)%len(ring)],top[(i+1)%len(ring)],top[i]],color=(.66,.65,.60,1))
        a,b=max(((Vector(a),Vector(b)) for a in ring for b in ring),key=lambda q:(q[1]-q[0]).length);u=(b-a).normalized();v=Vector((-u.y,u.x));mid=(a+b)/2
        pool=[mid+u*d+v*s for d,s in ((-90,-10),(61,-10),(61,-1),(-90,-1))]
        fill(self.landmark,[(*self.xy(p),ground+200.16) for p in pool],(.08,.48,.57,1))
        fill(self.accent,[(*self.xy(p),ground+200.22) for p in pool],(1,1,1,1))
        for d in range(-115,125,12):
            p=mid+u*d+v*9
            if base.point_in_polygon(p,ring):
                self.landmark.add_cylinder((*self.xy(p),ground+200),1,3,6,color=(.35,.31,.23,1));self.landmark.add_cylinder((*self.xy(p),ground+203),3.1,2.5,7,color=(.21,.37,.20,1))
    def context(self):
        trees=Mesh();count=0
        for feature in self.c['trees']:
            p=feature['point'];bounds=self.c['model']['bounds']
            if not(bounds['minX']<p[0]<bounds['maxX'] and bounds['minY']<p[1]<bounds['maxY']):continue
            if any(base.distance_to_polyline(p,line)<radius+3 for line,radius in self.corridors) or any(base.point_in_polygon(p,q) for q in self.reserved):continue
            x,y=self.xy(p);z=self.r.sample(*p);h=number(feature['tags'].get('height'),8);h=max(3,min(h,18))
            trees.add_cylinder((x,y,z),.22,h*.6,5,color=(.37,.31,.22,1))
            for level,radius in ((.45,h*.29),(.7,h*.23)):
                trees.add_cylinder((x,y,z+h*level),radius,h*.28,7,color=(.27,.40,.24,1))
            count+=1
        planting=Mesh();furniture=Mesh();planted=[];furniture_count=0;shrubs=0
        obstacles=self.permanent+self.reserved+[v['points'] for v in self.c['vectors'] if v['tags'].get('leisure') in ('pitch','playground','swimming_pool')]
        boxes=[(ring,min(p[0] for p in ring),max(p[0] for p in ring),min(p[1] for p in ring),max(p[1] for p in ring)) for ring in obstacles if ring]
        paths=[(v['points'],v['radius'],min(p[0] for p in v['points']),max(p[0] for p in v['points']),min(p[1] for p in v['points']),max(p[1] for p in v['points'])) for v in self.c['landscapeExclusions'] if len(v['points'])>1]
        def safe(p,radius):
            bounds=self.c['model']['bounds']
            if not(bounds['minX']+radius<p[0]<bounds['maxX']-radius and bounds['minY']+radius<p[1]<bounds['maxY']-radius):return False
            if any(base.distance_to_polyline(p,line)<width+radius for line,width in self.corridors):return False
            if any(lo-radius<p[0]<hi+radius and bottom-radius<p[1]<top+radius and base.distance_point_polygon(p,ring)<radius for ring,lo,hi,bottom,top in boxes):return False
            if any(lo-width-radius<p[0]<hi+width+radius and bottom-width-radius<p[1]<top+width+radius and base.distance_to_polyline(p,line)<width+radius for line,width,lo,hi,bottom,top in paths):return False
            if any(any(math.dist(p,q)<radius+width for q in line) for line,width in self.bridge_corridors):return False
            return not self.in_water(p)
        for feature in self.c['landscapeCandidates']:
            p=feature['point'];h=feature['height'];radius=h*.27
            if len(planted)>=620:break
            if any(math.dist(p,q)<8 for q in planted) or any(math.dist(p,t['point'])<6 for t in self.c['trees']) or not safe(p,radius):continue
            x,y=self.xy(p);z=self.r.sample(*p);planting.add_cylinder((x,y,z),.17,h*.7,4,color=(.30,.25,.18,1))
            shade=(.20+.025*feature['variant'],.36+.025*feature['variant'],.20,1)
            ring=[(x+math.cos(i/6*math.tau)*radius,y+math.sin(i/6*math.tau)*radius,z+h*.65) for i in range(6)]
            for i in range(6):
                planting.add_triangle([ring[i],ring[(i+1)%6],(x,y,z+h)],color=shade)
                planting.add_triangle([ring[(i+1)%6],ring[i],(x,y,z+h*.36)],color=shade)
            planted.append(p)
            if len(planted)%5==0:
                q=[p[0]+radius+1.2,p[1]+1]
                if safe(q,1.2):
                    furniture.add_cylinder((*self.xy(q),self.r.sample(*q)),1.1,.75,5,color=(.23,.39,.20,1));shrubs+=1
        for feature in self.c['parkFurniture']:
            p=feature['point']
            if not any(context.inside(p,g['points']) for g in self.c['greenAreas']) or not safe(p,.45):continue
            x,y=self.xy(p);z=self.r.sample(*p)
            if feature['kind'] in ('bench','picnic_table'):
                furniture.add_box((x,y,z+.45),(1.8,.5,.12),color=(.46,.34,.23,1));furniture.add_box((x,y+.24,z+.74),(1.8,.08,.48),color=(.46,.34,.23,1))
                for side in (-.65,.65):furniture.add_box((x+side,y,z+.22),(.09,.42,.44),color=(.32,.34,.32,1))
            else:furniture.add_cylinder((x,y,z),.24,.8,6,color=(.40,.43,.40,1))
            furniture_count+=1
        bridges=bridge_builder.build(self,base,Mesh,beam,context)
        for index,p in enumerate(planted):
            if index%8==0:
                x,y=self.xy(p);z=self.r.sample(*p)
                beam(self.struct,(x+1,y,z),(x+1,y,z+3.5),.05)
                self.luminaires.add_box((x+1,y,z+3.5),(.45,.45,.18))
        self.object(trees,'Mapped_Trees');self.object(planting,'Park_Trees');self.object(furniture,'Park_Furniture');self.object(self.landmark,'Landmarks','Buildings');self.object(self.struct,'Pit_Wall_And_Lighting')
        self.object(self.luminaires,'Night_Luminaires',material=[self.m['lamp']],colors=False)
        self.object(self.accent,'Architectural_Lighting',material=[self.m['accent']],colors=False)
        return {'mappedTrees':count,'additionalParkTrees':len(planted),'shrubs':shrubs,'mappedParkFurniture':furniture_count,'plantingMethod':'Seeded placement in mapped green polygons, open lawns kept clear; individual infill trees estimated','bridges':bridges}
    def annotations(self):
        c=self.c['officialControlPoints'];collection=self.collections['Annotations'];marks=Mesh()
        for turn in self.c['model']['turns']:
            base.anchor_at(f"Turn_{turn['number']:02d}",turn['distanceMeters'],self.line,self.cum,self.total,self.r,self.center,0,collection,side=turn['anchorSide'],offset=20,height=8)
        for name,d in [('SpeedTrap',c['speedTrapDistanceMeters']),('RaceStart',c['raceStartDistanceMeters'])]:base.anchor_at(name,d,self.line,self.cum,self.total,self.r,self.center,0,collection,offset=23,height=7)
        for i,d in enumerate([0,*c['sectorBoundaryDistancesMeters']]):
            base.anchor_at('StartFinish' if i==0 else f'SectorBoundary_{i+1:02d}',d,self.line,self.cum,self.total,self.r,self.center,0,collection,offset=25,height=8)
            self.strip(marks,d-3,d+3,-7,7,material=i+3,lift=.87)
            if i:self.strip(marks,d-.4,d+.4,-6,6,material=i,lift=.91)
        for i in range(12):
            for j in (0,1):self.strip(marks,-.7+j*.7,j*.7,-6+i,-5+i,material=6+(i+j)%2,lift=.95)
        self.object(marks,'Sector_Boundaries_And_Finish','Annotations',self.m['sectors']+self.m['halos']+[self.m['white'],self.m['black']],False)
        profile=[{'distanceMeters':self.total*i/180,'elevationMeters':self.surface(self.total*i/180)[2]-.6} for i in range(181)]
        for name,p in [('LowPoint',min(profile,key=lambda p:p['elevationMeters'])),('HighPoint',max(profile,key=lambda p:p['elevationMeters']))]:
            anchor=base.anchor_at(name,p['distanceMeters'],self.line,self.cum,self.total,self.r,self.center,0,collection,offset=30,height=8);anchor['elevation_datum_m']=p['elevationMeters']
        return profile


def export(path):
    from io_scene_gltf2.io.exp import meshopt
    original=meshopt.MeshoptEncoder.encode_attribute
    def precise(name,data,stride,settings):
        bits=meshopt.EXP_FILTER_BITS
        try:
            if name=='POSITION':meshopt.EXP_FILTER_BITS=18
            elif name.startswith('COLOR_'):
                meshopt.EXP_FILTER_BITS=7;return original('POSITION',data,stride,settings)
            elif name.startswith('TEXCOORD_'):
                meshopt.EXP_FILTER_BITS=14;return original('POSITION',data,stride,settings)
            elif name=='NORMAL':meshopt.EXP_FILTER_BITS=8
            return original(name,data,stride,settings)
        finally:meshopt.EXP_FILTER_BITS=bits
    meshopt.MeshoptEncoder.encode_attribute=staticmethod(precise)
    try:base.export_glb(path)
    finally:meshopt.MeshoptEncoder.encode_attribute=staticmethod(original)


def main():
    args=base.parse_args();c=json.loads(Path(args.input).read_text());prepared=Path(args.prepared);r=Raster(prepared)
    bpy.ops.wm.read_factory_settings(use_empty=True);collections=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene['coordinate_reference_system']='EPSG:32648';scene['vertical_datum']='approximate, unverified';scene['reconstruction']=True
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1800;scene.render.resolution_y=1250;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.quality=90;scene.view_settings.look='AgX - Medium High Contrast'
    scene.world=bpy.data.worlds.new('Singapore_World');scene.world.color=(.14,.16,.18)
    m={'terrain':base.create_aerial_material(prepared/'singapore-orthophoto.jpg'),'asphalt':base.create_material('Singapore_Asphalt',linear((.25,.26,.27,1)),.94),
       'white':base.create_material('Singapore_Paint',linear((.88,.89,.85,1))), 'black':base.create_material('Singapore_Black',linear((.05,.06,.07,1))),
       'red':base.create_material('Singapore_Kerb_Red',linear((.69,.06,.035,1))), 'vertex':base.create_material('Singapore_Solid_Structures',(1,1,1,1),.78,use_vertex_color=True),
       'fence':base.create_material('Singapore_Catch_Fence',(.24,.29,.28,.16))}
    m['lamp']=base.create_material('Singapore_Night_Lamps',(1,.81,.52,1),emission_strength=3)
    m['accent']=base.create_material('Singapore_Architectural_Lights',(.035,.38,.7,1),emission_strength=1.8)
    for name,strength in (('asphalt',1.4),('white',.55),('red',.6)):
        shader=m[name].node_tree.nodes.get('Principled BSDF');shader.inputs['Emission Color'].default_value=shader.inputs['Base Color'].default_value;shader.inputs['Emission Strength'].default_value=strength
    m['terrain'].name='Singapore_OneMap_Orthophoto'
    glow=m['terrain'].node_tree.nodes.new('ShaderNodeTexImage');glow.image=bpy.data.images.load(str(prepared/'night-lightmap.jpg'))
    shader=m['terrain'].node_tree.nodes.get('Principled BSDF');m['terrain'].node_tree.links.new(glow.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=.38
    for style in ('glass','balcony','stone','garage'):
        mat=base.create_material('Singapore_Facade_'+style,(1,1,1,1),.48 if style=='glass' else .78,use_vertex_color=True)
        nodes=mat.node_tree.nodes;texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(prepared/f'facade-{style}.png'));texture.extension='REPEAT'
        tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;mat.node_tree.links.new(texture.outputs['Color'],tint.inputs[1]);vertex=next(n for n in nodes if n.type=='VERTEX_COLOR');mat.node_tree.links.new(vertex.outputs['Color'],tint.inputs[2]);mat.node_tree.links.new(tint.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])
        # glTF only supports texture*factor, so bake the neutral procedural facade itself;
        # per-face mapped colours remain as COLOR_0 and multiply in the viewer.
        mat.node_tree.links.new(texture.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color']);m[style]=mat
        emission=nodes.new('ShaderNodeTexImage');emission.image=bpy.data.images.load(str(prepared/f'emission-{style}.png'));emission.extension='REPEAT'
        shader=nodes.get('Principled BSDF');mat.node_tree.links.new(emission.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=.95
    colors=[(.78,.025,.017,1),(.99,.4,.02,1),(.015,.51,.68,1)]
    m['sectors']=[base.create_material(f'Singapore_Sector_{i+1}',col) for i,col in enumerate(colors)]
    m['halos']=[base.create_material(f'Singapore_Sector_{i+1}_Glow',(*col[:3],.3),emission_strength=1.5) for i,col in enumerate(colors)]
    terrain=base.add_terrain(c['model']['bounds'],c['model']['center'],r,0,m['terrain'],collections['Terrain']);terrain.name='Singapore_Terrain';terrain.data.name='Singapore_Terrain_Mesh';terrain['source']='OneMap imagery; Mapzen lower-envelope approximate ground'
    model=Singapore(c,r,collections,m);road=model.road();stands=model.grandstands();buildings=model.buildings();context=model.context();profile=model.annotations()
    for surface in ('main','pit'):
        if road[surface]['terrainBreakthroughSamples']:raise ValueError(f'Terrain penetrates {surface}: {road[surface]}')
    base.add_lighting(collections['Terrain']);camdata=bpy.data.cameras.new('Singapore_Preview');camdata.type='ORTHO';camdata.ortho_scale=2700;camdata.clip_end=10000
    for light in bpy.data.lights:light.energy=.65;light.color=(.52,.66,1)
    scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.025,.04,.09,1)
    scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5
    cam=bpy.data.objects.new('Singapore_Preview',camdata);collections['Terrain'].objects.link(cam);cam.location=(100,-1800,2600);base.look_at(cam,(0,0,25));scene.camera=cam
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source=='FILE':image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix('.blend').resolve()));bpy.data.objects.remove(cam,do_unlink=True);bpy.data.cameras.remove(camdata);export(Path(args.glb).resolve())
    meta={'schemaVersion':4,'modelId':'singapore','generatedWith':f'Blender {bpy.app.version_string}','coordinateReferenceSystem':'EPSG:32648','verticalDatum':None,'elevationApproximate':True,'verticalExaggeration':1,'realWorldScale':'1 unit = 1 metre; no vertical exaggeration','originMeters':c['model']['center'],'boundsMeters':{'width':2300,'depth':1840},
        'lapLength':{'geometryMeters':model.total,'officialFiaMeters':4927,'relativeErrorPercent':abs(model.total-4927)/4927*100},'geometryAudit':c['geometryAudit'],'elevationProfile':profile,'elevationsMeters':{'low':min(p['elevationMeters'] for p in profile),'high':max(p['elevationMeters'] for p in profile)},'baseElevationMeters':0,'finishDistanceMeters':0,'sectorBoundaryDistancesMeters':c['officialControlPoints']['sectorBoundaryDistancesMeters'],
        'objects':{'turnAnchors':19,'buildingsTotal':buildings['count'],'grandstandSections':stands['sections'],'flyerCapsules':28,**context},'layoutQuality':{'surfaceClearance':road['main'],'pitLane':{'surfaceClearance':road['pit'],'entryGapMeters':base.distance_to_polyline(model.pit[0],model.line),'exitGapMeters':base.distance_to_polyline(model.pit[-1],model.line),'wallSegments':road['pitWallSegments']},'buildings':buildings,'grandstands':stands},'sourceManifest':c['sourceManifest'],'controlPointReference':c['officialControlPoints'],'limitations':c['limitations'],'publicationStatus':'reconstructed-with-disclosed-approximations'}
    meta['layoutQuality']['pitLane']['reference']='FIA 1 October 2025 pit lane drawing and Event Notes V2 section 16.3; left approach before T18, rounded inner arc, commitment line, kerbs and pit wall; widths estimated'
    meta['lighting']={'timeOfDay':'night','method':'Emissive window atlases, track and pit lighting, bridge and park luminaires, ground illumination map; artistic reconstruction, not measured photometry'}
    Path(args.metadata).write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'buildings':buildings['count'],'stands':stands['sections'],'road':road,'lap':meta['lapLength']}))

if __name__=='__main__':main()
