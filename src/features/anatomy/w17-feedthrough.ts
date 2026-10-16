import * as T from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// Cut an enclosed transverse service passage through a closed skin. Keep the
// original contour and join both cut rims with real walls, instead of drawing
// a dark patch over the panel. The supplied profile is convex and CCW in XY.
export function servicePassage(source:T.BufferGeometry,profile:T.Vector2[],preserveNormals=false,protectedHalfWidth=0) {
  const polygons:T.Vector3[][]=[],p=source.attributes.position,index=source.index;
  const originalFaces=new Map<T.Vector3[],number[]>();
  const faceMaterials=new Map<T.Vector3[],number>();
  const edgeKey=(a:T.Vector3,b:T.Vector3)=>[a,b].map(v=>v.toArray().map(n=>Math.round(n*1e8)).join()).sort().join("/");
  const edgeCuts=new Map<string,T.Vector3[]>();
  const walls:{a:T.Vector3;b:T.Vector3;t0:number;t1:number}[][]=profile.map(()=>[]);
  const eps=1e-9;
  const planes=profile.map((a,i)=>{
    const b=profile[(i+1)%profile.length],dx=b.x-a.x,dy=b.y-a.y;
    return {a,b,dx,dy,d:(v:T.Vector3)=>dx*(v.y-a.y)-dy*(v.x-a.x),t:(v:T.Vector3)=>((v.x-a.x)*dx+(v.y-a.y)*dy)/(dx*dx+dy*dy)};
  });
  let sourceGroup=0;
  for(let i=0;i<(index?.count??p.count);i+=3){
    const triangle=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j));
    const original=[0,1,2].map(j=>index?index.getX(i+j):i+j);
    while(sourceGroup<source.groups.length-1&&i>=source.groups[sourceGroup].start+source.groups[sourceGroup].count)sourceGroup++;
    const material=source.groups[sourceGroup]?.materialIndex??0;
    const remember=(polygon:T.Vector3[])=>{
      polygons.push(polygon);
      if(preserveNormals){originalFaces.set(polygon,original);faceMaterials.set(polygon,material);}
    };
    // A side-wall opening can share its XY projection with a separate central
    // duct. Leave that duct intact when there is a clear gap between the two.
    if(protectedHalfWidth&&triangle.every(v=>Math.abs(v.z)<protectedHalfWidth)){remember(triangle);continue;}
    if(preserveNormals&&planes.some(plane=>triangle.every(v=>plane.d(v)<-eps))){remember(triangle);continue;}
    let inside=triangle;
    for(const plane of planes){
      const next:T.Vector3[]=[],outside:T.Vector3[]=[];
      for(let j=0;j<inside.length;j++){
        const a=inside[j],b=inside[(j+1)%inside.length],da=plane.d(a),db=plane.d(b);
        if(da>=-eps)next.push(a);if(da<=eps)outside.push(a);
        if((da>eps&&db< -eps)||(da< -eps&&db>eps)){
          const cut=a.clone().lerp(b,da/(da-db));next.push(cut);outside.push(cut);
        }
      }
      if(outside.length>=3)remember(outside);
      inside=next;if(inside.length<3)break;
    }
    planes.forEach((plane,k)=>{
      const hits:T.Vector3[]=[];
      for(let j=0;j<3;j++){
        const a=triangle[j],b=triangle[(j+1)%3],da=plane.d(a),db=plane.d(b);
        if(Math.abs(da)<eps)hits.push(a);
        if(da*db< -eps*eps)hits.push(a.clone().lerp(b,da/(da-db)));
      }
      const unique=hits.filter((v,j)=>!hits.slice(0,j).some(a=>a.distanceToSquared(v)<eps*eps));
      if(unique.length!==2)return;
      let [a,b]=unique,t0=plane.t(a),t1=plane.t(b);
      if(t1<t0){[a,b]=[b,a];[t0,t1]=[t1,t0];}
      if(t1-t0<eps||t1<0||t0>1)return;
      const lo=Math.max(0,t0),hi=Math.min(1,t1);
      walls[k].push({a:a.clone().lerp(b,(lo-t0)/(t1-t0)),b:a.clone().lerp(b,(hi-t0)/(t1-t0)),t0:lo,t1:hi});
    });
    if(preserveNormals)for(let j=0;j<3;j++){
      const a=triangle[j],b=triangle[(j+1)%3],key=edgeKey(a,b);
      if(edgeCuts.has(key))continue;
      const cuts:T.Vector3[]=[];
      for(const plane of planes){const da=plane.d(a),db=plane.d(b);if(da*db< -eps*eps)cuts.push(a.clone().lerp(b,da/(da-db)));}
      edgeCuts.set(key,cuts);
    }
  }
  walls.forEach((segments,k)=>{
    const stops=[...new Set(segments.flatMap(s=>[s.t0,s.t1]).map(t=>Math.round(t*1e9)/1e9))].sort((a,b)=>a-b);
    const at=(s:typeof segments[number],t:number)=>s.a.clone().lerp(s.b,(t-s.t0)/(s.t1-s.t0));
    for(let i=0;i<stops.length-1;i++){
      const lo=stops[i],hi=stops[i+1],mid=(lo+hi)/2;
      if(hi-lo<eps)continue;
      const crossing=segments.filter(s=>mid>s.t0&&mid<s.t1).sort((a,b)=>at(a,mid).z-at(b,mid).z);
      for(let j=0;j+1<crossing.length;j+=2){
        const a=crossing[j],b=crossing[j+1],quad=[at(a,lo),at(a,hi),at(b,hi),at(b,lo)];
        const normal=new T.Vector3().subVectors(quad[1],quad[0]).cross(new T.Vector3().subVectors(quad[2],quad[0]));
        if(normal.dot(new T.Vector3(-planes[k].dy,planes[k].dx,0))<0)quad.reverse();
        polygons.push(quad);
      }
    }
  });
  // Rim triangles on the two faces have different subdivisions. Split their
  // shared edges before triangulating so the bore has no T-junctions.
  // An edge can only be subdivided by vertices on its own cutting plane.
  // Index and deduplicate those vertices once; scanning every duplicated rim
  // for every edge made a small round opening take seconds to construct.
  const rimByPlane=planes.map(plane=>{
    const points=new Map<string,T.Vector3>();
    for(const polygon of polygons)for(const v of polygon)if(Math.abs(plane.d(v))<eps){
      const key=`${Math.round(v.x*1e10)},${Math.round(v.y*1e10)},${Math.round(v.z*1e10)}`;
      if(!points.has(key))points.set(key,v);
    }
    return [...points.values()];
  });
  const positions:number[]=[],indices:number[]=[],normals:number[]=[],groups:{start:number;count:number;materialIndex:number}[]=[];
  for(const polygon of polygons){
    const original=originalFaces.get(polygon),weights=new T.Vector3();
    const startIndex=indices.length;
    const triangle=original?new T.Triangle(...original.map(i=>new T.Vector3().fromBufferAttribute(p,i)) as [T.Vector3,T.Vector3,T.Vector3]):undefined;
    const faceNormal=new T.Triangle(polygon[0],polygon[1],polygon[2]).getNormal(new T.Vector3());
    const append=(vertices:T.Vector3[])=>{
      positions.push(...vertices.flatMap(v=>v.toArray()));
      if(preserveNormals)for(const v of vertices){
        const n=faceNormal.clone();
        if(triangle&&source.attributes.normal){
          triangle.getBarycoord(v,weights);n.set(0,0,0);
          original!.forEach((id,j)=>n.addScaledVector(new T.Vector3().fromBufferAttribute(source.attributes.normal,id),weights.getComponent(j)));n.normalize();
        }
        normals.push(...n.toArray());
      }
    };
    const boundary:T.Vector3[]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],direction=b.clone().sub(a),length=direction.lengthSq();
      if(length<eps*eps)continue;
      const points=[{t:0,v:a}];
      const planeIndex=planes.findIndex(plane=>Math.abs(plane.d(a))<eps&&Math.abs(plane.d(b))<eps);
      if(planeIndex!==-1)for(const v of rimByPlane[planeIndex]){
        const t=v.clone().sub(a).dot(direction)/length;
        if(t>1e-7&&t<1-1e-7&&a.clone().addScaledVector(direction,t).distanceToSquared(v)<1e-16)points.push({t,v});
      }
      if(preserveNormals&&triangle)for(const [u,v]of[[triangle.a,triangle.b],[triangle.b,triangle.c],[triangle.c,triangle.a]]){
        const edge=v.clone().sub(u),edgeLength=edge.lengthSq();
        if(!edgeLength||edge.clone().cross(a.clone().sub(u)).lengthSq()>1e-14||edge.clone().cross(b.clone().sub(u)).lengthSq()>1e-14)continue;
        for(const cut of edgeCuts.get(edgeKey(u,v))??[]){
          const t=cut.clone().sub(a).dot(direction)/length;
          if(t>1e-7&&t<1-1e-7)points.push({t,v:cut});
        }
      }
      points.sort((a,b)=>a.t-b.t);
      points.forEach(({v},j)=>{if(j===0||v.distanceToSquared(points[j-1].v)>1e-16)boundary.push(v);});
    }
    if(boundary.length<3)continue;
    // Most triangles are outside the bore. Preserve them instead of adding
    // three new faces around a redundant centre vertex on every service cut.
    if(boundary.length===3){
      const [a,b,c]=boundary;
      // Keep small but real faces created by a second passage. Dropping them
      // leaves triangular pinholes in otherwise closed structural skins.
      if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>1e-28){
        const start=positions.length/3;append(boundary);indices.push(start,start+1,start+2);
      }
      if(preserveNormals)groups.push({start:startIndex,count:indices.length-startIndex,materialIndex:faceMaterials.get(polygon)??(source.groups.length?1:0)});
      continue;
    }
    const centre=boundary.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(1/boundary.length),start=positions.length/3;
    append([centre,...boundary]);
    for(let i=0;i<boundary.length;i++){
      const a=boundary[i],b=boundary[(i+1)%boundary.length];
      if(a.clone().sub(centre).cross(b.clone().sub(centre)).lengthSq()>1e-28)indices.push(start,start+1+i,start+1+(i+1)%boundary.length);
    }
    if(preserveNormals)groups.push({start:startIndex,count:indices.length-startIndex,materialIndex:faceMaterials.get(polygon)??(source.groups.length?1:0)});
  }
  const raw=new T.BufferGeometry();raw.setAttribute("position",preserveNormals?new T.BufferAttribute(Float64Array.from(positions),3):new T.Float32BufferAttribute(positions,3));raw.setIndex(indices);
  if(preserveNormals&&source.groups.length)for(const g of groups){const last=raw.groups.at(-1);if(last&&last.materialIndex===g.materialIndex)last.count+=g.count;else raw.addGroup(g.start,g.count,g.materialIndex);}
  if(preserveNormals)raw.setAttribute("normal",new T.Float32BufferAttribute(normals,3));
  const geometry=mergeVertices(raw,1e-7);if(!preserveNormals)geometry.computeVertexNormals();raw.dispose();return geometry;
}
