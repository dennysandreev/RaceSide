import * as T from "three";

// Project exact world-space triangles into a spatial grid. Queries return the
// outermost surface on either side, including thin two-sided carbon panels.
export function createSurfaceSampler(meshes: T.Mesh[], axis: "y" | "z") {
  const bounds = new T.Box3();
  meshes.forEach(mesh => bounds.expandByObject(mesh));
  const other = axis === "y" ? "z" : "y";
  const nx = 96, nv = 48, dx = Math.max(1e-8, bounds.max.x - bounds.min.x) / nx;
  const dv = Math.max(1e-8, bounds.max[other] - bounds.min[other]) / nv;
  const cells: number[][] = Array.from({length:nx*nv},()=>[]), triangles:number[]=[];
  const ix = (x:number)=>T.MathUtils.clamp(Math.floor((x-bounds.min.x)/dx),0,nx-1);
  const iv = (v:number)=>T.MathUtils.clamp(Math.floor((v-bounds.min[other])/dv),0,nv-1);
  const matrix=new T.Matrix4(),instance=new T.Matrix4(),point=new T.Vector3();
  for(const mesh of meshes){
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
    for(let copy=0;copy<(mesh instanceof T.InstancedMesh?mesh.count:1);copy++){
      matrix.copy(mesh.matrixWorld);
      if(mesh instanceof T.InstancedMesh){mesh.getMatrixAt(copy,instance);matrix.multiply(instance);}
      const vertices=new Float64Array(p.count*3);
      for(let i=0;i<p.count;i++){
        point.fromBufferAttribute(p,i).applyMatrix4(matrix);
        vertices[i*3]=point.x;vertices[i*3+1]=point[other];vertices[i*3+2]=point[axis];
      }
      for(let i=0;i<(index?.count??p.count);i+=3){
        const a=(index?index.getX(i):i)*3,b=(index?index.getX(i+1):i+1)*3,c=(index?index.getX(i+2):i+2)*3;
        const ax=vertices[a],av=vertices[a+1],bx=vertices[b],bv=vertices[b+1],cx=vertices[c],cv=vertices[c+1];
        const d=(bv-cv)*(ax-cx)+(cx-bx)*(av-cv);
        if(Math.abs(d)<1e-12)continue;
        const id=triangles.length;
        triangles.push(ax,av,bx,bv,cx,cv,vertices[a+2],vertices[b+2],vertices[c+2],d);
        for(let x=ix(Math.min(ax,bx,cx));x<=ix(Math.max(ax,bx,cx));x++)for(let v=iv(Math.min(av,bv,cv));v<=iv(Math.max(av,bv,cv));v++)cells[x*nv+v].push(id);
      }
    }
  }
  return (x:number,v:number,side:1|-1):number|undefined=>{
    if(x<bounds.min.x||x>bounds.max.x||v<bounds.min[other]||v>bounds.max[other])return;
    let edge=-Infinity;
    for(const i of cells[ix(x)*nv+iv(v)]){
      const ax=triangles[i],av=triangles[i+1],bx=triangles[i+2],bv=triangles[i+3],cx=triangles[i+4],cv=triangles[i+5],d=triangles[i+9];
      const u=((bv-cv)*(x-cx)+(cx-bx)*(v-cv))/d,w=((cv-av)*(x-cx)+(ax-cx)*(v-cv))/d;
      if(u>=-1e-8&&w>=-1e-8&&u+w<=1+1e-8)edge=Math.max(edge,side*(u*triangles[i+6]+w*triangles[i+7]+(1-u-w)*triangles[i+8]));
    }
    return Number.isFinite(edge)?side*edge:undefined;
  };
}

// Exact vertical intersections with a fixed mesh. A projected grid avoids
// traversing every triangle for each vertex seated on the floor shoulder.
export function createHeightSampler(geometry: T.BufferGeometry) {
  const p = geometry.attributes.position, index = geometry.index;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, nx = 64, nz = 16;
  const dx = Math.max(bounds.max.x - bounds.min.x, 1e-8) / nx;
  const dz = Math.max(bounds.max.z - bounds.min.z, 1e-8) / nz;
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  const triangles: number[][] = [];
  const cellX = (x: number) => T.MathUtils.clamp(Math.floor((x - bounds.min.x) / dx), 0, nx - 1);
  const cellZ = (z: number) => T.MathUtils.clamp(Math.floor((z - bounds.min.z) / dz), 0, nz - 1);
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    const ax = p.getX(a), az = p.getZ(a), bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
    const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    // Front-facing upper triangles only, as in the original downward ray.
    if (determinant >= -1e-12) continue;
    const id = triangles.length;
    triangles.push([ax, az, bx, bz, cx, cz, p.getY(a), p.getY(b), p.getY(c), determinant]);
    for (let x = cellX(Math.min(ax, bx, cx)); x <= cellX(Math.max(ax, bx, cx)); x++) {
      for (let z = cellZ(Math.min(az, bz, cz)); z <= cellZ(Math.max(az, bz, cz)); z++) cells[x * nz + z].push(id);
    }
  }
  return (x: number, z: number): number | undefined => {
    if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) return;
    let highest = -Infinity;
    for (const id of cells[cellX(x) * nz + cellZ(z)]) {
      const [ax, az, bx, bz, cx, cz, ay, by, cy, d] = triangles[id];
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) highest = Math.max(highest, u * ay + v * by + (1 - u - v) * cy);
    }
    return Number.isFinite(highest) ? highest : undefined;
  };
}
