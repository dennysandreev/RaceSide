import * as T from "three";

// C14.2.2: the reflective surface projects to 200 × 50 mm. The cylindrical
// section is convex, R600 mm; its inboard normal is 26° to the rearward axis.
// Housing depth and supports are reconstructed from the W17 launch renders.
const centreY=.700,centreZ=.590,radius=.600,inboardAngle=26*Math.PI/180;
function rearSurface(across:number){
  const sine=Math.sin(inboardAngle)-(across+.100)/radius;
  return .650+radius*(Math.cos(inboardAngle)-Math.sqrt(1-sine*sine));
}

function outline(width:number,height:number,corner:number){
  const points:T.Vector2[]=[];
  for(const [x,y,start]of[[width/2-corner,height/2-corner,0],[-width/2+corner,height/2-corner,Math.PI/2],[-width/2+corner,-height/2+corner,Math.PI],[width/2-corner,-height/2+corner,Math.PI*1.5]]){
    for(let i=0;i<=12;i++){
      const a=start+i*Math.PI/24;
      points.push(new T.Vector2(x+Math.cos(a)*corner,y+Math.sin(a)*corner));
    }
  }
  const sampled:T.Vector2[]=[];
  for(let i=0;i<points.length;i++){
    sampled.push(points[i]);
    if(i%13===12){
      const steps=Math.floor(i/13)%2===0?64:16,next=points[(i+1)%points.length];
      for(let j=1;j<steps;j++)sampled.push(points[i].clone().lerp(next,j/steps));
    }
  }
  return sampled;
}

export function createMirrorHead(side:1|-1,mat:Record<"silver"|"metal",T.Material>){
  const root=new T.Group();root.name=`Mirror head ${side}`;
  const solid=(name:string,points:number[],indices:number[],material:T.Material)=>{
    // Mirroring across the centre plane reverses orientation.
    if(side<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(points,3));g.setIndex(indices);g.computeVertexNormals();
    const mesh=new T.Mesh(g,material);mesh.name=`Mirror ${name} ${side}`;
    mesh.userData={component:"mirrors",cover:true};mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;
  };
  const point=(across:number,y:number,depth:number)=>{
    const front=.657-.29*across-.006*(across/.102)**2;
    const x=depth>=.03?front+depth-.040:rearSurface(across)+depth;
    return[x,centreY+y,side*(centreZ+across)];
  };

  // One closed cup: rear rim, external wall, nose, inner floor and cavity wall.
  // Keeping the aperture in the actual geometry avoids a glass decal on a cap.
  const sections=[
    {width:.216,height:.060,corner:.008,depth:-.0025},
    {width:.204,height:.054,corner:.009,depth:.040},
    {width:.198,height:.048,corner:.007,depth:.037},
    {width:.203,height:.053,corner:.0075,depth:-.0025},
  ];
  const outlines=sections.map(s=>outline(s.width,s.height,s.corner)),n=outlines[0].length;
  const positions:number[]=[],indices:number[]=[];
  sections.forEach((section,row)=>outlines[row].forEach(p=>positions.push(...point(p.x,p.y,section.depth))));
  for(const [from,to]of[[0,1],[2,3],[3,0]])for(let i=0;i<n;i++){
    const j=(i+1)%n,a=from*n+i,b=to*n+i,c=from*n+j,d=to*n+j;
    indices.push(a,b,c,c,b,d);
  }
  for(const row of[1,2]){
    // Concentric rings triangulate the curved cap without long diagonals
    // cutting through the cylindrical profile or the recessed mirror glass.
    let previous=row*n;
    for(let ring=1;ring<=8;ring++){
      const current=positions.length/3,scale=1-ring/9;
      for(const p of outlines[row])positions.push(...point(p.x*scale,p.y*scale,sections[row].depth));
      for(let i=0;i<n;i++){
        const j=(i+1)%n,faces=[previous+i,current+i,previous+j,previous+j,current+i,current+j];
        if(row===2)for(let k=0;k<faces.length;k+=3)[faces[k+1],faces[k+2]]=[faces[k+2],faces[k+1]];
        indices.push(...faces);
      }
      previous=current;
    }
    const centre=positions.length/3;positions.push(...point(0,0,sections[row].depth));
    for(let i=0;i<n;i++)indices.push(...(row===1?[previous+i,centre,previous+(i+1)%n]:[previous+i,previous+(i+1)%n,centre]));
  }
  solid("housing",positions,indices,mat.silver);

  const glassPoints:number[]=[],glassIndices:number[]=[],stations=[0,.0005,.0015,.003,.0045,.006];
  for(let i=1;i<64;i++)stations.push(.006+.188*i/64);
  stations.push(...[.194,.1955,.197,.1985,.1995,.200]);
  const rows=stations.length,columns=8,count=rows*(columns+1);
  for(const depth of[0,.0012])for(const s of stations){
    const cornerDistance=Math.max(.006-s,s-.194,0);
    const halfHeight=.019+Math.sqrt(Math.max(0,.006**2-cornerDistance**2));
    for(let col=0;col<=columns;col++)glassPoints.push(...point(s-.1,halfHeight*(2*col/columns-1),depth));
  }
  for(let face=0;face<2;face++)for(let row=0;row<rows-1;row++)for(let col=0;col<columns;col++){
    const a=face*count+row*(columns+1)+col,b=a+columns+1,c=a+1,d=b+1;
    glassIndices.push(...(face===0?[a,c,b,c,d,b]:[a,b,c,c,b,d]));
  }
  const boundary:number[]=[];
  for(let row=0;row<rows;row++)boundary.push(row*(columns+1));
  for(let col=1;col<=columns;col++)boundary.push((rows-1)*(columns+1)+col);
  for(let row=rows-2;row>=0;row--)boundary.push(row*(columns+1)+columns);
  for(let col=columns-1;col>0;col--)boundary.push(col);
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length];
    glassIndices.push(a,b,a+count,b,b+count,a+count);
  }
  for(let i=0;i<glassIndices.length;i+=3)[glassIndices[i+1],glassIndices[i+2]]=[glassIndices[i+2],glassIndices[i+1]];
  solid("glass",glassPoints,glassIndices,mat.metal);
  return root;
}
