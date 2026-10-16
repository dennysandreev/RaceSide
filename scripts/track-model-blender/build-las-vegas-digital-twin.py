#!/usr/bin/env python3
"""Build Las Vegas in metres, using only its pinned geographic/event inputs."""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('shared_textured_mesh_tools', SCRIPTS / 'build-suzuka-digital-twin.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
base, tools = shared.base, shared.tools
base.TERRAIN_COLUMNS, base.TERRAIN_ROWS = 221, 241
base.PIT_LANE_WIDTH_METERS = 8
base.TRACK_SURFACE_Z_OFFSET = .45
tools.COPYRIGHT = 'RaceSide Las Vegas; © OpenStreetMap contributors (ODbL); USDA NAIP / USGS 3DEP (public domain); FIA 2025 and promoter 2026 reference maps'

# The prepared axis is rounded before offsets are built. Use its local tangent
# for every road, paint and barrier surface rather than a mismatched wide chord.
native_tangent = base.sample_tangent
def vegas_tangent(points, cumulative, distance, delta=.5, closed=True):
    return native_tangent(points, cumulative, distance, delta=delta, closed=closed)
base.sample_tangent = vegas_tangent


def hex_color(value, fallback):
    named = {'white':'#ece9e1','brown':'#80624d','beige':'#d3c3a5','grey':'#969898','gray':'#969898','black':'#303335'}
    value = named.get(value, value)
    if isinstance(value, str) and value.startswith('#') and len(value) == 7:
        try:
            return tuple(int(value[i:i+2],16)/255 for i in (1,3,5)) + (1,)
        except ValueError:
            pass
    return fallback


class VegasScene(shared.SuzukaScene):
    def __init__(self, *args):
        super().__init__(*args)
        self.corridors = [(base.sample_line_points(self.line,self.cum,3),6.4),
                          (base.sample_line_points(self.pit,self.pc,3,closed=False),4.4)]

    def surface(self, d, offset=0, pit=False, lift=.45):
        point = super().surface(d, offset, pit, lift)
        # A single continuous XY height field prevents folded inside-corner
        # triangles acquiring different heights at virtually the same position.
        return (point[0], point[1], self.raster.sample(point[0]+self.center['x'], point[1]+self.center['y'])+lift)

    def grade_ribbon(self, obj, samples):
        for vertex in obj.data.vertices:
            vertex.co.z = self.raster.sample(vertex.co.x+self.center['x'],vertex.co.y+self.center['y'])+.45
        return [(d,x,y,self.raster.sample(x,y)+.45,tangent,normal,bank,width)
                for d,x,y,_,tangent,normal,bank,width in samples]

    def source_color(self, point):
        # Metallic temporary seating is gray, as in the promoter photographs.
        for polygon in self.reserved:
            if base.point_in_polygon(point, polygon):
                return (.27,.29,.30,1)
        return super().source_color(point)

    def terrain(self):
        super().terrain()
        obj = bpy.data.objects['Suzuka_Terrain']
        obj['source'] = 'USDA NAIP 11 June 2022 / USGS 3DEP; geographic alignment retained'

    def road(self):
        obj,_,_,samples = base.create_ribbon('LasVegas_Raceway',self.line,self.raster,self.center,0,12,
            self.m['asphalt'],self.c['Circuit'],interval=1,z_offset=.45)
        obj['source'] = 'OSM circuit relation 16696508; locally rounded native EPSG:32611 axis; no geometric scaling'
        samples = self.grade_ribbon(obj, samples)
        for d in range(0,math.ceil(self.total),2):
            a,b=base.sample_tangent(self.line,self.cum,d),base.sample_tangent(self.line,self.cum,d+2)
            pieces=2 if a.dot(b)<math.cos(math.radians(2)) else 1
            for side in (-1,1):
                for piece in range(pieces):
                    self.strip(self.paint,d+2*piece/pieces,min(d+2*(piece+1)/pieces,self.total),side*5.65,side*5.83)
        kerbs = base.MeshBuilder()
        kerb_uvs=[]
        ranges = []
        for turn in self.config['model']['turns']:
            if turn['number'] == 13:
                continue  # The broad Strip kink has no invented temporary kerb.
            d = turn['distanceMeters']
            a,b = base.sample_tangent(self.line,self.cum,d-12),base.sample_tangent(self.line,self.cum,d+12)
            side = 1 if a.x*b.y-a.y*b.x>0 else -1
            span = 12 if turn['number'] in (7,8,14,15,16) else 24
            ranges.append({'turn':turn['number'],'startMeters':d-span,'endMeters':d+span,'side':side})
            for i in range(span):
                start = d-span+i*2
                for piece in range(4):
                    self.strip(kerbs,start+piece*.5,start+(piece+1)*.5,side*6,side*6.85,i%2,lift=.60)
                    u,v=piece/4,(piece+1)/4
                    kerb_uvs.extend([(u,0),(v,0),(v,1),(u,0),(v,1),(u,1)])
        obj = kerbs.create_object('LasVegas_Casino_Kerbs',[self.m['curbRed'],self.m['curbWhite']],self.c['Circuit'])
        uv = obj.data.uv_layers.new(name='IndividualCasinoKerbTileUV')
        for i,loop in enumerate(uv.data):
            loop.uv = kerb_uvs[i]
        return samples, ranges

    def pit_lane(self):
        obj,_,_,samples = base.create_ribbon('LasVegas_Pit_Lane',self.pit,self.raster,self.center,0,8,
            self.m['asphalt'],self.c['Circuit'],interval=1,closed=False,taper_meters=30,
            minimum_start_width=4,minimum_end_width=4,z_offset=.45)
        samples = self.grade_ribbon(obj, samples)
        first,last = 165,450
        for i in range(44):
            d = first+(last-first)*i/43
            self.strip(self.paint,d,d+.16,1.1,3.8,pit=True,lift=.59)
        for d in range(first,last,3):
            self.strip(self.paint,d,d+2,1.2,1.36,pit=True,lift=.59)
        quality = self.pit_wall()
        colors = [(.80,.80,.78,1)]*6+[(.90,.43,.06,1)]*3+[(.72,.03,.035,1)]*3+[(.04,.09,.22,1)]*4+[(.03,.23,.23,1)]*3+[(.015,.27,.20,1)]*3+[(.13,.35,.65,1)]*3+[(.73,.75,.74,1)]*3+[(.11,.21,.61,1)]*3+[(.055,.26,.60,1)]*3+[(.17,.50,.32,1)]*3+[(.80,.80,.78,1)]*6
        for i in range(43):
            d = first+(last-first)*(i+.5)/43
            p = self.surface(d,8.8,True)
            tangent = base.sample_tangent(self.pit,self.pc,d,closed=False)
            along = Vector((tangent.x,tangent.y,0))*(last-first)/43*.45
            for lo,hi,color in [(0,3.2,(.17,.19,.20,1)),(3.2,3.8,colors[i])]:
                self.props.add_quad([Vector(p)-along+Vector((0,0,lo)),Vector(p)+along+Vector((0,0,lo)),
                                    Vector(p)+along+Vector((0,0,hi)),Vector(p)-along+Vector((0,0,hi))],color=color)
        return {'pitGarageBoxes':43,'garageReferenceYear':2025,'frontageDistancesMeters':[first,last],
                'fastLaneSeparator':True,'wall':quality,'lengthMeters':self.pt,
                'entryGapMeters':base.distance_to_polyline(self.pit[0],self.line),
                'exitGapMeters':base.distance_to_polyline(self.pit[-1],self.line),
                'surfaceClearance':base.measure_ribbon_terrain_clearance(samples,self.raster,0)}

    def pit_wall(self):
        # The wall begins after the entry curve, beside the parallel garage
        # frontage. A 0.36 m edge gap accommodates concrete thickness and the
        # different road/wall sampling intervals at the bend.
        first,last = 130,450
        midpoint = base.sample_polyline(self.pit,self.pc,(first+last)/2,closed=False)
        tangent = base.sample_tangent(self.pit,self.pc,(first+last)/2,closed=False)
        normal = Vector((-tangent.y,tangent.x))
        main = base.sample_polyline(self.line,self.cum,base.nearest_distance(self.line,self.cum,midpoint))
        side = 1 if (main[0]-midpoint[0])*normal.x+(main[1]-midpoint[1])*normal.y>=0 else -1
        offset = side*4.5
        builder = base.MeshBuilder()
        panels = 0
        for d in range(first,last,3):
            end = min(d+3,last)
            bottom = [self.surface(distance,lateral,True,.47)for distance,lateral in
                      [(d,offset-.14),(end,offset-.14),(end,offset+.14),(d,offset+.14)]]
            builder.add_volume(bottom,[(x,y,z+1.05)for x,y,z in bottom])
            a,b = self.surface(d,offset,True,.47),self.surface(end,offset,True,.47)
            builder.add_quad([(a[0],a[1],a[2]+1.05),(b[0],b[1],b[2]+1.05),
                              (b[0],b[1],b[2]+3.35),(a[0],a[1],a[2]+3.35)],material_index=1)
            builder.add_cylinder((a[0],a[1],a[2]+1.05),.055,2.3,sides=6)
            panels += 1
        builder.create_object('LasVegas_Pit_Wall',[self.m['concrete'],self.m['fence']],self.c['Circuit'])
        return {'lengthMeters':last-first,'panels':panels,'wallHeightMeters':1.05,'fenceHeightMeters':2.3,
                'frontageDistancesMeters':[first,last],'edgeGapMeters':.36}

    def buildings(self):
        walls,roofs,details = base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        wall_mapping = []
        rendered,excluded = [],[]
        specials = {976405284,27831699}
        for f in self.features:
            tags = f['tags']
            if not (tags.get('building') or tags.get('building:part')) or tags.get('grandstand')=='yes' or f['id'] in specials:
                continue
            poly = f['world'][:-1] if f['world'][0]==f['world'][-1] else f['world']
            if len(poly)<3:
                continue
            if base.polygon_intersects_corridors(poly,self.corridors) or any(base.polygons_overlap(poly,r)for r in self.reserved):
                excluded.append({'id':f['id'],'reason':'driving corridor or reserved event grandstand'})
                continue
            try:
                height = float(tags.get('height',str(float(tags.get('building:levels',2))*3.1)).split()[0])
                low_height = float(tags.get('min_height',str(float(tags.get('building:min_level',0))*3.1)).split()[0])
            except ValueError:
                height,low_height = 6.2,0
            if height<=low_height or tags.get('location')=='underground':
                continue
            low = max(self.ground(p)for p in poly)
            if f['id']==1468774558:
                # Native rectangular footprint and official 542/660 ft heights.
                # The waisted guitar silhouette is an explicit reconstruction.
                edges=sorted(zip(poly,poly[1:]+poly[:1]),key=lambda ab:math.dist(*ab),reverse=True)
                axis=(Vector(edges[0][1])-Vector(edges[0][0])).normalized();normal=Vector((-axis.y,axis.x))
                coords=[(Vector(p).dot(axis),Vector(p).dot(normal))for p in poly]
                left,right=min(u for u,v in coords),max(u for u,v in coords)
                front,rear=min(v for u,v in coords),max(v for u,v in coords)
                middle=(left+right)/2;width=right-left
                outline=[(-.5,0),(-.5,32),(-.45,65),(-.25,100),(-.34,128),(-.12,151),(-.12,165.2016),
                         (.12,165.2016),(.12,151),(.34,128),(.25,100),(.45,65),(.5,32),(.5,0)]
                shells=[]
                for v in (front,rear):
                    shell=[Vector((*self.xy(axis*(middle+w*width)+normal*v),low+h))for w,h in outline];shells.append(shell)
                    for triangle in base.resolved_tessellation([shell]):walls.add_triangle(triangle,color=(.26,.50,.65,1));wall_mapping.append(((shell[0].x,shell[0].y),(axis.x,axis.y),low))
                for i in range(len(outline)):
                    j=(i+1)%len(outline);start=len(walls.faces)
                    walls.add_quad([shells[0][i],shells[1][i],shells[1][j],shells[0][j]],color=(.30,.55,.66,1))
                    wall_mapping.extend([((shells[0][i].x,shells[0][i].y),(normal.x,normal.y),low)]*(len(walls.faces)-start))
                for i in range(6):
                    p=axis*(middle+(i-2.5)*2.3)+normal*(rear-.4)
                    tools.beam(details,(*self.xy(p),low+165.2016),(*self.xy(p),low+201.168),.22,(.75,.83,.85,1))
                rendered.append({'osmWayId':f['id'],'name':tags['name'],'heightMeters':201.168,'occupiedTowerHeightMeters':165.2016,
                    'minimumHeightMeters':0,'heightMethod':'Clark County approved 542 ft occupied tower / 660 ft architectural strings',
                    'footprint':poly,'facadeColor':[.26,.50,.65],'sourceToRenderCentroidDriftMeters':0,
                    'shapeMethod':'estimated guitar silhouette at mapped footprint; construction-era massing, not surveyed facade'})
                continue
            centroid = [sum(p[i]for p in poly)/len(poly)for i in (0,1)]
            sample = super().source_color(centroid)
            color = hex_color(tags.get('building:colour'), tuple(min(.84,max(.25,v*.8+.10))for v in sample[:3])+(1,))
            name = tags.get('name','')
            if 'Bellagio' in name:color=(.81,.76,.66,1)
            elif 'Caesars' in name:color=(.86,.82,.73,1)
            elif 'Cosmopolitan' in name:color=(.20,.30,.35,1)
            elif 'Wynn Las Vegas' in name:color=(.46,.31,.20,1)
            # These OSM part colours are saturated editing approximations.
            # Retain the bronze/beige appearance of the source-era towers.
            if f['id']==27727143:color=(.54,.44,.31,1)
            elif f['id']==27727145:color=(.72,.66,.55,1)
            pit = f['id']==1198427833
            if pit:color=(.89,.90,.87,1)
            rings=[poly]+[ring[:-1]if ring[0]==ring[-1]else ring for ring in f.get('innerRings',[])]
            for a,b in [(a,b)for ring in rings for a,b in zip(ring,ring[1:]+ring[:1])]:
                length=math.dist(a,b)
                if length<.01:continue
                start=len(walls.faces)
                walls.add_quad([(*self.xy(a),low+low_height),(*self.xy(b),low+low_height),
                                (*self.xy(b),low+height),(*self.xy(a),low+height)],color=color)
                aa=self.xy(a);direction=((b[0]-a[0])/length,(b[1]-a[1])/length)
                wall_mapping.extend([(aa,direction,low)]*(len(walls.faces)-start))
            for triangle in base.resolved_tessellation([[Vector((*self.xy(p),low+height))for p in ring]for ring in rings]):
                if (triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).z<0:
                    triangle = list(reversed(triangle))
                if pit:
                    details.add_triangle(triangle,color=(.80,.82,.79,1))
                else:
                    roofs.add_triangle(triangle)
            if pit:
                # Four-storey white pit pavilion with terrace slabs, glazing and
                # structural members. Its complex footprint is kept unchanged.
                for a,b in zip(poly,poly[1:]+poly[:1]):
                    if math.dist(a,b)<20:continue
                    aa,bb = Vector((*self.xy(a),low)),Vector((*self.xy(b),low))
                    for h in (5,10,15,19.5):tools.beam(details,aa+Vector((0,0,h)),bb+Vector((0,0,h)),.20,(.79,.82,.82,1))
                    count=max(1,math.ceil(math.dist(a,b)/9))
                    for i in range(count+1):
                        p=aa+(bb-aa)*i/count
                        tools.beam(details,p,p+Vector((0,0,19.5)),.16,(.70,.74,.74,1))
            rendered.append({'osmWayId':f['id'],'name':name,'heightMeters':height,'minimumHeightMeters':low_height,
                'heightMethod':'OSM height' if tags.get('height')else 'OSM levels × 3.1 m' if tags.get('building:levels')else '6.2 m estimate',
                'footprint':poly,'innerRings':f.get('innerRings',[]),'osmRelationId':f.get('osmRelationId'),
                'sceneBoundaryClipped':f.get('sceneBoundaryClipped',False),'sourceToRenderCentroidDriftMeters':0,'facadeColor':color[:3]})
        obj=walls.create_object('LasVegas_Buildings',[self.m['facade']],self.c['Infrastructure'],vertex_colors=True)
        uv=obj.data.uv_layers.new(name='MetreScaledFacadeWindowsUV')
        for face,(origin,direction,low) in zip(obj.data.polygons,wall_mapping):
            for index in face.loop_indices:
                point=obj.data.vertices[obj.data.loops[index].vertex_index].co
                uv.data[index].uv=(((point.x-origin[0])*direction[0]+(point.y-origin[1])*direction[1])/12.8,(point.z-low)/6.4)
        obj=roofs.create_object('LasVegas_NAIP_Roofs',[self.m['terrain']],self.c['Infrastructure'])
        tools.aerial_uv(obj,self.center,self.config['model']['bounds'])
        details.create_object('LasVegas_Pit_Pavilion_Details',[self.m['vertex']],self.c['Infrastructure'],vertex_colors=True)
        return {'count':len(rendered),'rendered':rendered,'excluded':excluded,'remainingDrivingCorridorConflicts':0,
                'lod2Available':False,'sourceToRenderCentroidDriftMeters':0,
                'multipolygonShells':sum(b.get('osmRelationId')is not None for b in rendered),
                'courtyardRings':sum(len(b.get('innerRings',[]))for b in rendered),
                'boundaryClippedBuildings':sum(b.get('sceneBoundaryClipped',False)for b in rendered),
                'facadeMapping':{'windowModuleWidthMeters':3.2,'storeyHeightMeters':3.2,
                    'tileWindowsAcross':4,'tileStoreys':2,'method':'local wall distance and height above building base; estimated glazing and masonry details'}}

    def grandstands(self):
        # Open temporary bleachers: track-facing low front, raised rear,
        # stairs between seat bays, visible metal trestles and safety rails.
        builder,seats=base.MeshBuilder(),base.MeshBuilder()
        seat_uvs=[];rendered=[];excluded=[]
        for f in self.features:
            if f['tags'].get('grandstand')!='yes':continue
            polygon=f['world'][:-1]
            if base.polygon_intersects_corridors(polygon,self.corridors):
                excluded.append({'id':f['id'],'reason':'stand intersects driving corridor'});continue
            edges=sorted(zip(polygon,polygon[1:]+polygon[:1]),key=lambda ab:math.dist(*ab),reverse=True)
            axis=(Vector(edges[0][1])-Vector(edges[0][0])).normalized();normal=Vector((-axis.y,axis.x))
            points=[(Vector(p).dot(axis),Vector(p).dot(normal))for p in polygon]
            lo,hi=min(u for u,v in points),max(u for u,v in points)
            front,rear=min(v for u,v in points),max(v for u,v in points)
            middle=(lo+hi)/2
            if base.distance_to_polyline(axis*middle+normal*front,self.line)>base.distance_to_polyline(axis*middle+normal*rear,self.line):front,rear=rear,front
            facing=1 if rear>front else -1
            sections=max(1,math.ceil((hi-lo)/12));built_rows=seat_count=rail_count=0
            for section in range(sections):
                left=lo+(hi-lo)*section/sections+.05;right=lo+(hi-lo)*(section+1)/sections-.05
                u=(left+right)/2
                for lower,upper in tools.polygon_scanline_spans(points,u):
                    near,far=(lower,upper)if facing>0 else (upper,lower)
                    rows=max(3,min(30,round(abs(far-near)/.85)))
                    ground=self.ground(axis*u+normal*near)
                    seat_left,seat_right=left+.8,right-.8
                    for row in range(rows):
                        a=near+(far-near)*row/rows;b=near+(far-near)*(row+1)/rows
                        ring=[axis*x+normal*y for x,y in ((left,a),(right,a),(right,b),(left,b))]
                        if not all(base.point_in_polygon(p,polygon)or base.distance_point_polygon(p,polygon)<.15 for p in ring):continue
                        z=max(ground+.70+row*.43,max(self.ground(p)for p in ring)+.20)
                        builder.add_quad([(*self.xy(p),z)for p in ring],color=(.62,.65,.65,1))
                        builder.add_quad([(*self.xy(ring[0]),z-.43),(*self.xy(ring[1]),z-.43),(*self.xy(ring[1]),z),(*self.xy(ring[0]),z)],color=(.45,.48,.49,1))
                        # A light stair strip and yellow nosing identify aisles.
                        stair=[axis*x+normal*y for x,y in ((left,a),(left+.65,a),(left+.65,b),(left,b))]
                        builder.add_quad([(*self.xy(p),z+.025)for p in stair],color=(.78,.79,.76,1))
                        tools.beam(builder,(*self.xy(stair[0]),z+.04),(*self.xy(stair[1]),z+.04),.045,(.81,.68,.28,1))
                        p=axis*seat_left+normal*((a+b)/2);q=axis*seat_right+normal*((a+b)/2)
                        width=normal*.18*facing;corners=[p-width,q-width,q+width,p+width]
                        seats.add_quad([(*self.xy(v),z+.13)for v in corners],color=(.19,.22,.24,1))
                        seats.add_quad([(*self.xy(v),zz)for v,zz in ((corners[2],z+.13),(corners[3],z+.13),(corners[3],z+.57),(corners[2],z+.57))],color=(.21,.24,.26,1))
                        n=max(2,round((seat_right-seat_left)/.55))
                        for _ in range(2):seat_uvs.extend(((0,0),(n,0),(n,1),(0,0),(n,1),(0,1)))
                        built_rows+=1;seat_count+=n
                    rear_z=ground+.7+(rows-1)*.43
                    # Open triangular supports remain visible under the raked rows.
                    for x in (left+.4,right-.4):
                        a=axis*x+normal*(near+(far-near)*.20);b=axis*x+normal*(near+(far-near)*.95)
                        pa=Vector((*self.xy(a),self.ground(a)));pb=Vector((*self.xy(b),self.ground(b)))
                        top_a=Vector((pa.x,pa.y,ground+.7+rows*.43*.2));top_b=Vector((pb.x,pb.y,rear_z))
                        for p,q in ((pa,top_a),(pb,top_b),(pa,top_b),(top_a,top_b)):
                            tools.beam(builder,p,q,.10,(.48,.52,.53,1))
                        # Side stair handrail climbs toward the rear.
                        tools.beam(builder,top_a+Vector((0,0,1.0)),top_b+Vector((0,0,1.0)),.045,(.76,.78,.77,1));rail_count+=1
                    for v,z in ((near,ground+.7),(far,rear_z)):
                        p=axis*left+normal*v;q=axis*right+normal*v
                        tools.beam(builder,(*self.xy(p),z+1.0),(*self.xy(q),z+1.0),.045,(.76,.78,.77,1))
                        for x in (left,(left+right)/2,right):
                            point=axis*x+normal*v
                            tools.beam(builder,(*self.xy(point),z),(*self.xy(point),z+1.0),.04,(.76,.78,.77,1))
                        rail_count+=1
            rendered.append({'osmWayId':f['id'],'name':f['tags']['name'],'footprint':polygon,
                'rowsBuilt':built_rows,'seatsBuilt':seat_count,'covered':False,'frontFacesTrack':True,
                'seatBackDirection':'toward raised rear','aislesPerBlock':sections,'guardrailRuns':rail_count,
                'minimumTrackClearanceMeters':base.minimum_polygon_track_clearance(polygon,self.corridors[0][0],6)})
        builder.create_object('LasVegas_Grandstands',[self.m['vertex']],self.c['Grandstands'],vertex_colors=True)
        obj=seats.create_object('LasVegas_Textured_Seat_Rows',[self.m['seats']],self.c['Grandstands'],vertex_colors=True)
        uv=obj.data.uv_layers.new(name='IndividualSeatShellUV')
        for loop,coordinate in zip(obj.data.loops,seat_uvs):uv.data[loop.index].uv=coordinate
        return {'count':len(rendered),'rendered':rendered,'excluded':excluded,
            'seatColorMethod':'dark gray shell seats and galvanized metal steps from promoter photo; railings, aisles and trestles reconstructed',
            'placementMethod':'2026 promoter maps; SG4 on outside of T5–T6, front rows face the circuit'}

    def infrastructure(self):
        barrier,fences,landmarks = base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        lamps,tower_lights,wheel_lights=base.MeshBuilder(),base.MeshBuilder(),base.MeshBuilder()
        count=0
        # Continuous concrete and mesh catch fencing along the closed raceway.
        # Leave the real pit join openings free.
        joins=[base.nearest_distance(self.line,self.cum,p)for p in (self.pit[0],self.pit[-1])]
        d=0
        while d<self.total:
            a,b=base.sample_tangent(self.line,self.cum,d),base.sample_tangent(self.line,self.cum,d+5)
            start=d;d=min(d+(2 if a.dot(b)<math.cos(math.radians(5)) else 5),self.total)
            end=d;d0=start
            if any(min(abs(d0-j),self.total-abs(d0-j))<32 for j in joins):continue
            for side in (-1,1):
                p,q=self.surface(d0,side*7.6),self.surface(end,side*7.6)
                # Inspect the full segment at bends, including its concrete
                # thickness, against both driving corridors.
                world=[(p[0]+(q[0]-p[0])*t+self.center['x'],p[1]+(q[1]-p[1])*t+self.center['y'])
                       for t in (0,.25,.5,.75,1)]
                if any(base.distance_to_polyline(v,self.pit)<4.8 or base.distance_to_polyline(v,self.line)<6.6 for v in world):continue
                length=math.dist(p,q)
                mid=(Vector(p)+Vector(q))/2
                rotation=math.atan2(q[1]-p[1],q[0]-p[0])
                barrier.add_box(mid+Vector((0,0,.48)),(length,.45,.96),color=(.68,.69,.67,1),rotation=rotation)
                fences.add_quad([Vector(p)+Vector((0,0,.96)),Vector(q)+Vector((0,0,.96)),
                                 Vector(q)+Vector((0,0,3.8)),Vector(p)+Vector((0,0,3.8))])
                tools.beam(barrier,Vector(p)+Vector((0,0,.96)),Vector(p)+Vector((0,0,3.8)),.045,(.53,.55,.54,1))
                count+=1
        for d in range(0,math.floor(self.total),60):
            p=self.surface(d,-11)
            self.props.add_cylinder(p,.17,11,sides=5,color=(.50,.52,.52,1))
            self.props.add_box((p[0],p[1],p[2]+11),(.9,.35,.20),color=(.88,.89,.86,1))
            lamps.add_box((p[0],p[1],p[2]+11.12),(.86,.31,.055))
        barrier.create_object('LasVegas_Safety_Barriers',[self.m['vertex']],self.c['Infrastructure'],vertex_colors=True)
        fences.create_object('LasVegas_Catch_Fences',[self.m['fence']],self.c['Infrastructure'])
        features={f['id']:f for f in self.features}
        # Eiffel Tower: retain the mapped four-leg footprint; lattice geometry
        # replaces a false solid 165-metre building extrusion.
        f=features[27831699];poly=f['world'][:-1]
        cx=sum(p[0]for p in poly)/len(poly);cy=sum(p[1]for p in poly)/len(poly)
        x,y=self.xy((cx,cy));ground=self.ground((cx,cy))
        steel=(.53,.48,.40,1)
        levels=[(0,32),(45,18),(90,9),(145,2.2),(165,.3)]
        for (z0,r0),(z1,r1)in zip(levels,levels[1:]):
            lower=[Vector((x+sx*r0,y+sy*r0,ground+z0))for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
            upper=[Vector((x+sx*r1,y+sy*r1,ground+z1))for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
            for i in range(4):
                tools.beam(landmarks,lower[i],upper[i],.55 if z0<90 else .24,steel)
                tools.beam(tower_lights,lower[i],upper[i],.38,(1,1,1,1))
                steps=6
                for j in range(steps):
                    blend=j/steps;following=(j+1)/steps
                    a=lower[i].lerp(upper[i],blend);b=lower[(i+1)%4].lerp(upper[(i+1)%4],following)
                    c=lower[(i+1)%4].lerp(upper[(i+1)%4],blend);d=lower[i].lerp(upper[i],following)
                    tools.beam(landmarks,a,b,.15,steel);tools.beam(landmarks,c,d,.15,steel)
            if z1 in (45,90):landmarks.add_box((x,y,ground+z1),(r1*2.3,r1*2.3,2),color=steel)
        # High Roller: native OSM outline fixes centre, orientation and diameter.
        f=features[402543930];poly=f['world']
        cx=(min(p[0]for p in poly)+max(p[0]for p in poly))/2
        cy=(min(p[1]for p in poly)+max(p[1]for p in poly))/2
        x,y=self.xy((cx,cy));ground=self.ground((cx,cy));hub=Vector((x,y,ground+88))
        axis=Vector((0,1,0));normal=Vector((1,0,0));radius=79
        for side in (-1,1):
            for foot in (-1,1):tools.beam(landmarks,Vector((x+side*20,y+foot*26,ground)),hub+normal*side*3,.60,(.85,.86,.83,1))
            points=[hub+normal*side*2+axis*math.cos(i*math.tau/96)*radius+Vector((0,0,math.sin(i*math.tau/96)*radius))for i in range(97)]
            for a,b in zip(points,points[1:]):
                tools.beam(landmarks,a,b,.33,(.83,.85,.85,1))
                tools.beam(wheel_lights,a,b,.43,(1,1,1,1))
            for i in range(28):
                p=hub+axis*math.cos(i*math.tau/28)*radius+Vector((0,0,math.sin(i*math.tau/28)*radius))
                tools.beam(landmarks,hub,p,.07,(.78,.80,.80,1))
                if side==1:
                    landmarks.add_cylinder((p.x,p.y,p.z-2),2.3,4,sides=8,color=(.21,.29,.32,1))
        landmarks.create_object('LasVegas_Eiffel_And_High_Roller',[self.m['vertex']],self.c['Infrastructure'],vertex_colors=True)
        lamps.create_object('LasVegas_Floodlight_Emitters',[self.m['lamp']],self.c['Infrastructure'])
        tower_lights.create_object('LasVegas_Eiffel_Illumination',[self.m['warmLight']],self.c['Infrastructure'])
        wheel_lights.create_object('LasVegas_High_Roller_Illumination',[self.m['blueLight']],self.c['Infrastructure'])
        sphere=features[976405284];poly=sphere['world'][:-1]
        cx=(min(p[0]for p in poly)+max(p[0]for p in poly))/2
        cy=(min(p[1]for p in poly)+max(p[1]for p in poly))/2
        x,y=self.xy((cx,cy));ground=self.ground((cx,cy))
        radius=157.2768/2;vertical_center=111.5568-radius
        vertices,faces,uvs=[],[],[]
        theta_max=math.acos(-vertical_center/radius)
        for row in range(49):
            theta=theta_max*row/48
            for col in range(97):
                angle=math.tau*col/96
                vertices.append((x+radius*math.sin(theta)*math.cos(angle),y+radius*math.sin(theta)*math.sin(angle),ground+vertical_center+radius*math.cos(theta)))
                uvs.append((col/96,1-row/48))
        for row in range(48):
            for col in range(96):
                a=row*97+col;faces.extend([(a,a+97,a+98),(a,a+98,a+1)])
        mesh=bpy.data.meshes.new('LasVegas_Sphere_Exosphere_Mesh');mesh.from_pydata(vertices,[],faces);mesh.materials.append(self.m['sphere']);mesh.update()
        uv=mesh.uv_layers.new(name='ExosphereUV')
        for loop in mesh.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
        obj=bpy.data.objects.new('LasVegas_Sphere_Exosphere',mesh);self.c['Infrastructure'].objects.link(obj)
        for face in mesh.polygons:face.use_smooth=True
        return {'safetyBarrierPanels':count,'lightingMasts':len(range(0,math.floor(self.total),60)),
                'sphere':{'osmWayId':976405284,'heightMeters':111.5568,'diameterMeters':157.2768,'source':'Populous Sphere architectural project + OSM footprint',
                          'displayArtwork':'official-f1-logo','displaySource':'f1-logo-official.svg','displayConfiguration':'user-requested white F1 on red LED screen; not a verified event configuration'},
                'eiffelTower':{'osmWayId':27831699,'heightMeters':165},'highRoller':{'osmWayId':402543930,'heightMeters':167,'gondolas':28}}

    def vegetation(self):
        builder=base.MeshBuilder();count=0
        for point in self.config['trees']:
            if any(base.distance_to_polyline(point,path)<half+3 for path,half in self.corridors):continue
            if any(base.point_in_polygon(point,poly)for poly in self.reserved):continue
            x,y=self.xy(point);z=self.ground(point)
            builder.add_cylinder((x,y,z),.23,8,sides=5,color=(.43,.34,.24,1))
            color=(.18,.28,.14,1)
            for i in range(9):
                angle=i*math.tau/9
                start=Vector((x,y,z+8));mid=start+Vector((math.cos(angle)*2.1,math.sin(angle)*2.1,.2));tip=start+Vector((math.cos(angle)*3.5,math.sin(angle)*3.5,-1.3))
                width=Vector((-math.sin(angle)*.4,math.cos(angle)*.4,0))
                builder.add_triangle([start,mid-width,mid+width],color=color)
                builder.add_triangle([mid-width,tip,mid+width],color=color)
            count+=1
        builder.create_object('LasVegas_Mapped_Palms',[self.m['vertex']],self.c['Infrastructure'],vertex_colors=True)
        return {'mappedTrees':count,'canopyGeometry':'estimated palm reconstruction at mapped individual tree points'}


def export(path):
    # Preserve centimetre clearance in metre coordinates after meshopt filtering.
    from io_scene_gltf2.io.exp import meshopt
    original = meshopt.MeshoptEncoder.encode_attribute
    def precise(name, data, stride, settings):
        bits = meshopt.EXP_FILTER_BITS
        mode = meshopt.ENCODE_EXP_SHARED_VECTOR
        try:
            if name == "POSITION":
                meshopt.EXP_FILTER_BITS = 21
            elif name == "NORMAL":
                meshopt.EXP_FILTER_BITS = 9
            elif name.startswith("COLOR_"):
                meshopt.EXP_FILTER_BITS = 8
                return original("POSITION", data, stride, settings)
            elif name.startswith("TEXCOORD_"):
                meshopt.EXP_FILTER_BITS = 16
                # UV axes have different ranges (local XY vs world altitude).
                # Independent exponents retain texture precision and compress
                # repeated seat surfaces without removing their geometry.
                meshopt.ENCODE_EXP_SHARED_VECTOR = meshopt.ENCODE_EXP_SHARED_COMPONENT
                return original("POSITION", data, stride, settings)
            return original(name, data, stride, settings)
        finally:
            meshopt.EXP_FILTER_BITS = bits
            meshopt.ENCODE_EXP_SHARED_VECTOR = mode
    meshopt.MeshoptEncoder.encode_attribute = staticmethod(precise)
    try:
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_apply=True,
            export_yup=True, export_cameras=False, export_lights=False, export_animations=False,
            export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
            export_all_vertex_colors=False,
            export_meshopt_compression_enable=True, export_meshopt_extension="EXT_meshopt_compression",
            export_copyright=tools.COPYRIGHT)
    finally:
        meshopt.MeshoptEncoder.encode_attribute = staticmethod(original)


def main():
    args=base.parse_args();config=json.loads(Path(args.input).read_text());prepared=Path(args.prepared)
    raster_meta=json.loads((prepared/'raster-metadata.json').read_text())
    raster=base.HeightRaster(prepared/'las-vegas-dtm.f32le',raster_meta['rasters']['dtm'],config['model']['bounds'])
    raster.profiles=json.loads((prepared/'las-vegas-road-profiles.json').read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collections=base.create_collections();scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene.unit_settings.length_unit='METERS'
    scene['coordinate_reference_system']='EPSG:32611';scene['vertical_datum']='NAVD88'
    scene['real_world_scale']='1 unit = 1 metre; no vertical exaggeration'
    grain=shared.texture('LasVegas_Mineral_Grain');facade=bpy.data.images.load(str(prepared/'las-vegas-facade-windows.png'))
    m={'terrain':base.create_aerial_material(prepared/'las-vegas-orthophoto.jpg'),
       'asphalt':tools.textured_material('LasVegas_Asphalt',(.24,.25,.26,1),grain),
       'white':tools.textured_material('LasVegas_White_Paint',(.91,.92,.89,1),grain),
       'black':tools.textured_material('LasVegas_Checker_Black',(.035,.04,.045,1),grain),
       'red':tools.textured_material('LasVegas_Red_Paint',(.75,.045,.035,1),grain),
       'concrete':tools.textured_material('LasVegas_Pit_Concrete',(.69,.70,.67,1),grain),
       'vertex':tools.textured_material('LasVegas_Physical_Structures',(1,1,1,1),grain,vertex=True),
       'facade':tools.textured_material('LasVegas_Textured_Facades',(1,1,1,1),facade,vertex=True),
       'fence':shared.fence_material(),'seats':tools.seating_material()}
    m['terrain'].name='LasVegas_NAIP_2022_Orthophoto';m['fence'].name='LasVegas_Chain_Link_Fence';m['seats'].name='LasVegas_Seat_Rows'
    # Reuse the Singapore night-scene approach: emissive atlases and a native
    # ground lightmap keep WebGL lightweight without hundreds of point lights.
    nodes,links=m['terrain'].node_tree.nodes,m['terrain'].node_tree.links
    principled=nodes.get('Principled BSDF')
    image=next(n for n in nodes if n.type=='TEX_IMAGE')
    tint=nodes.new('ShaderNodeMix');tint.data_type='RGBA';tint.blend_type='MULTIPLY'
    tint.inputs[0].default_value=1;tint.inputs[7].default_value=tools.linear((.43,.49,.60,1))
    links.new(image.outputs['Color'],tint.inputs[6]);links.new(tint.outputs[2],principled.inputs['Base Color'])
    glow=nodes.new('ShaderNodeTexImage');glow.image=bpy.data.images.load(str(prepared/'las-vegas-night-lightmap.jpg'))
    links.new(glow.outputs['Color'],principled.inputs['Emission Color']);principled.inputs['Emission Strength'].default_value=.65
    nodes=m['facade'].node_tree.nodes
    glow=nodes.new('ShaderNodeTexImage');glow.image=bpy.data.images.load(str(prepared/'las-vegas-window-emission.png'));glow.extension='REPEAT'
    uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(.25,.25,1)
    m['facade'].node_tree.links.new(uv.outputs['UV'],mapping.inputs['Vector']);m['facade'].node_tree.links.new(mapping.outputs['Vector'],glow.inputs['Vector'])
    shader=nodes.get('Principled BSDF');m['facade'].node_tree.links.new(glow.outputs['Color'],shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value=.85
    for key,strength in [('asphalt',1.1),('white',.25),('concrete',.12)]:
        shader=m[key].node_tree.nodes.get('Principled BSDF')
        m[key].node_tree.links.new(shader.inputs['Base Color'].links[0].from_socket,shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value=strength
    for key,color,strength in [('lamp',(.88,.94,1,1),2.4),('warmLight',(1,.63,.22,1),1.8),('blueLight',(.10,.47,1,1),2.0)]:
        m[key]=tools.textured_material('LasVegas_Night_'+key,color,grain)
        shader=m[key].node_tree.nodes.get('Principled BSDF')
        m[key].node_tree.links.new(shader.inputs['Base Color'].links[0].from_socket,shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value=strength
    m['sphere']=base.create_aerial_material(prepared/'las-vegas-exosphere.png');m['sphere'].name='LasVegas_F1_LED_Exosphere'
    nodes=m['sphere'].node_tree.nodes;principled=nodes.get('Principled BSDF')
    m['sphere'].node_tree.links.new(next(n for n in nodes if n.type=='TEX_IMAGE').outputs['Color'],principled.inputs['Emission Color'])
    principled.inputs['Emission Strength'].default_value=1.1
    for color,key in [('red','curbRed'),('white','curbWhite')]:
        m[key]=base.create_aerial_material(prepared/f'las-vegas-kerb-{color}.png');m[key].name=f'LasVegas_Casino_Kerb_{color.title()}'
    m['sectors']=[];m['halos']=[]
    for i,color in enumerate([(.80,.02,.015,1),(.97,.43,.02,1),(.02,.56,.72,1)]):
        m['sectors'].append(base.create_material(f'LasVegas_Sector_{i+1}',tools.linear(color),.8))
        m['halos'].append(base.create_material(f'LasVegas_Sector_{i+1}_Glow',(*tools.linear(color)[:3],.30),.5,emission_strength=1.3))
    aerial=next(n.image for n in m['terrain'].node_tree.nodes if n.type=='TEX_IMAGE')
    model=VegasScene(config,raster,collections,m,aerial)
    model.terrain();samples,curbs=model.road();pit=model.pit_lane()
    print('Las Vegas: terrain, raceway and physical pit wall built',flush=True)
    clearance=base.measure_ribbon_terrain_clearance(samples,raster,0)
    if clearance['terrainBreakthroughSamples'] or pit['surfaceClearance']['terrainBreakthroughSamples']:
        raise ValueError(f'Driving surfaces intersect terrain: {clearance}; {pit}')
    stands=model.grandstands();buildings=model.buildings();infrastructure=model.infrastructure();vegetation=model.vegetation()
    profile,low,high=model.annotations()
    for obj in bpy.data.objects:
        if obj.type=='MESH':
            if obj.name.startswith('Suzuka_'):obj.name=obj.name.replace('Suzuka_','LasVegas_');obj.data.name=obj.name+'_Mesh'
            obj['physical_texture']='NAIP or authored mineral, facade, seating, LED or fence texture with UV'
            tools.uv_surface(obj,2)
    for image in bpy.data.images:
        if image.name.startswith(('Mexico_','Suzuka_')):image.name='LasVegas_'+image.name.split('_',1)[1]
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1600;scene.render.resolution_y=1500;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.world=bpy.data.worlds.new('LasVegas_World');scene.world.color=(.12,.13,.14)
    base.add_lighting(collections['Terrain'])
    for light in bpy.data.lights:
        light.energy=.65;light.color=(.52,.66,1)
    scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.012,.018,.040,1)
    scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5
    scene.render.film_transparent=False
    camera_data=bpy.data.cameras.new('LasVegasPreview');camera_data.type='ORTHO';camera_data.ortho_scale=3100;camera_data.clip_end=10000
    camera=bpy.data.objects.new('LasVegasPreview',camera_data);collections['Terrain'].objects.link(camera)
    camera.location=(0,-1000,3600);base.look_at(camera,(0,0,635));scene.camera=camera
    scene.render.filepath=str(Path(args.preview).resolve());bpy.ops.render.render(write_still=True)
    for image in bpy.data.images:
        if image.source=='FILE':image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.input).with_suffix('.blend').resolve()))
    bpy.data.objects.remove(camera,do_unlink=True);bpy.data.cameras.remove(camera_data)
    export(Path(args.glb).resolve())
    metadata={'schemaVersion':4,'modelId':'las-vegas','generatedWith':f'Blender {bpy.app.version_string}',
       'coordinateReferenceSystem':'EPSG:32611','verticalDatum':'NAVD88 orthometric metres','verticalExaggeration':1,
       'realWorldScale':'1 unit = 1 metre; no vertical exaggeration','boundsMeters':{'width':2600,'depth':2800},
       'originMeters':config['model']['center'],'baseElevationMeters':0,'finishDistanceMeters':0,
       'lapLength':{'geometryMeters':model.total,'officialFiaMeters':6201,'relativeErrorPercent':abs(model.total-6201)/6201*100},
       'sectorBoundaryDistancesMeters':config['officialControlPoints']['sectorBoundaryDistancesMeters'],
       'elevationProfile':profile,'elevationsMeters':{'low':low['elevationMeters'],'high':high['elevationMeters']},'elevationApproximate':True,
       'objects':{'turnAnchors':17,'pitGarageBoxes':43,'grandstandFootprints':stands['count'],'buildingsTotal':buildings['count'],
                  'raceMotorhomes':0,**infrastructure,**vegetation},
       'layoutQuality':{'surfaceClearance':clearance,'pitLane':pit,'grandstands':stands,'buildings':buildings,
                        'curbs':curbs,'terrainSurface':raster_meta['terrainSurface'],'roadGrading':raster_meta['roadGrading'],
                        'cornerGeometry':config['geometryAudit']},
       'materials':{'physicalObjectsTextured':True,'method':'embedded NAIP + metre-scaled facade windows, surface, casino kerb, chain-link, seat-shell and official F1 LED screen textures','opaqueStructures':True},
       'sourceManifest':config['sourceManifest'],'controlPointReference':config['officialControlPoints'],
       'lighting':{'timeOfDay':'night','windowAtlas':'las-vegas-window-emission.png',
                   'floodlightEmitters':infrastructure['lightingMasts'],
                   'method':'Emissive windows, existing floodlight heads, native circuit/pit/street ground lightmap, warm Eiffel and blue High Roller outlines, F1 LED Sphere; artistic night reconstruction, not measured photometry'},
       'limitations':config['limitations'],'publicationStatus':'review-required'}
    Path(args.metadata).write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'lap':metadata['lapLength'],'objects':metadata['objects'],'clearance':clearance},ensure_ascii=False))


if __name__=='__main__':
    main()
