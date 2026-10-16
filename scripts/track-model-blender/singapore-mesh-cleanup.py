"""Remove overlapping coplanar triangles while retaining facade UV interpolation."""
import math
import struct
from collections import defaultdict


def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def area(poly):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2


def split(poly,a,b,sign):
    inside=[];outside=[]
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dp=cross(a,b,p)*sign;dq=cross(a,b,q)*sign
        (inside if dp>=-1e-9 else outside).append(p)
        if (dp>=-1e-9)!=(dq>=-1e-9):
            t=dp/(dp-dq);hit=[p[i]+(q[i]-p[i])*t for i in (0,1)];inside.append(hit);outside.append(hit)
    return inside,outside


def subtract(poly,triangle):
    sign=1 if cross(*triangle)>0 else -1;remaining=poly;result=[]
    for a,b in zip(triangle,triangle[1:]+triangle[:1]):
        remaining,outside=split(remaining,a,b,sign)
        if len(outside)>2 and area(outside)>1e-8:result.append(outside)
        if len(remaining)<3:return [poly]
    # Crossing an infinite clipping line does not mean the finite triangles
    # overlap. Keep untouched faces intact, avoiding numerical sliver meshes.
    return result if area(remaining)>1e-4 else [poly]


def clean(builder,uvs=None):
    builder.vertices=[struct.unpack('fff',struct.pack('fff',*p)) for p in builder.vertices]
    buckets=defaultdict(list);triangles=[];vertices=[];faces=[];colors=[];materials=[];new_uvs=[];removed=0;affected=0
    for fi,face in enumerate(builder.faces):
        tri=[builder.vertices[i] for i in face];a,b,c=tri
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)];n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];length=math.sqrt(sum(x*x for x in n))
        if length<1e-9:continue
        n=[x/length for x in n];axis=max(range(3),key=lambda i:abs(n[i]))
        if n[axis]<0:n=[-x for x in n]
        axes=[i for i in range(3) if i!=axis];flat=[[p[i] for i in axes] for p in tri];key=tuple(round(x,5) for x in n)+(round(sum(n[i]*a[i] for i in range(3)),3),)
        lo=[min(p[i] for p in flat) for i in (0,1)];hi=[max(p[i] for p in flat) for i in (0,1)]
        cells=[(*key,x,y) for x in range(math.floor(lo[0]/20),math.floor(hi[0]/20)+1) for y in range(math.floor(lo[1]/20),math.floor(hi[1]/20)+1)]
        candidates={index for cell in cells for index in buckets[cell]};pieces=[flat]
        for index in candidates:
            other,ol,oh=triangles[index]
            if any(hi[i]<=ol[i]+1e-8 or lo[i]>=oh[i]-1e-8 for i in (0,1)):continue
            pieces=[q for p in pieces for q in subtract(p,other)]
            if not pieces:break
        lost=max(0,area(flat)-sum(area(p) for p in pieces));removed+=lost/abs(n[axis]);affected+=lost>1e-6
        index=len(triangles);triangles.append((flat,lo,hi))
        for cell in cells:buckets[cell].append(index)
        denominator=cross(*flat)
        def weights(p):
            w0=cross(flat[1],flat[2],p)/denominator;w1=cross(flat[2],flat[0],p)/denominator;return (w0,w1,1-w0-w1)
        for poly in pieces:
            for j in range(1,len(poly)-1):
                points=[poly[0],poly[j],poly[j+1]]
                if area(points)<1e-8:continue
                start=len(vertices);ws=[weights(p) for p in points]
                vertices.extend(tuple(sum(tri[k][i]*w[k] for k in range(3)) for i in range(3)) for w in ws)
                faces.append((start,start+1,start+2));colors.append(builder.face_colors[fi]);materials.append(builder.material_indices[fi])
                if uvs is not None:new_uvs.append([tuple(sum(uvs[fi][k][i]*w[k] for k in range(3)) for i in (0,1)) for w in ws])
    builder.vertices=vertices;builder.faces=faces;builder.face_colors=colors;builder.material_indices=materials
    if uvs is not None:uvs[:]=new_uvs
    return {'removedCoplanarAreaSquareMeters':round(removed,4),'affectedTriangles':affected,'remainingTriangles':len(faces)}
