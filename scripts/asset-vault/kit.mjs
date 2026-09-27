import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
export { THREE };

export const palette = {
  'brick-red': [0x985e4b,.83,0], 'brick-cream': [0xc5b895,.8,0],
  'stucco-ivory': [0xd9d5c6,.86,0], concrete: [0xaaa99e,.86,0],
  limestone: [0xcbbfa5,.8,0], asphalt: [0x36393e,.96,0],
  'roof-shingle': [0x4f5960,.9,0], 'roof-metal': [0x688387,.48,.8],
  'wood-oak': [0x947047,.72,0], 'wood-painted': [0xd2d4c5,.68,0],
  'metal-dark': [0x424c51,.38,.86], 'metal-galvanized': [0xa1a9ac,.44,.95],
  'metal-copper': [0x689387,.55,.8], 'glass-blue': [0x4b6571,.16,0],
  foliage: [0x4c6939,.9,0], bark: [0x65503a,.93,0], soil: [0x65543d,.97,0], rubber: [0x25292c,.88,0],
  'paint-teal': [0x397d78,.59,.05], 'paint-red': [0xb65040,.62,.05],
  'paint-yellow': [0xe2b84f,.66,.03], 'paint-blue': [0x405d83,.58,.05],
  'paint-white': [0xe6e3d7,.68,0], 'paint-orange': [0xd27839,.68,.03],
};
const materials = new Map(), geometry = new Map();
export function variation(v) {
  if (!Number.isInteger(v) || v < 0 || v > 39) throw new Error('Variant must be 0–39');
  return { size:v%5, layout:Math.floor(v/5)%4, state:Math.floor(v/20),
    scale:.88+(v%5)*.08, bays:2+v%5, side:Math.floor(v/5)%2?1:-1 };
}
function cached(key, make) { if (!geometry.has(key)) geometry.set(key, make()); return geometry.get(key); }
function mat(id) {
  if (!palette[id]) throw new Error('Unknown material: '+id);
  if (!materials.has(id)) {
    const [color,roughness,metalness] = palette[id];
    const value=new THREE.MeshStandardMaterial({color,roughness,metalness}); value.name=id; materials.set(id,value);
  }
  return materials.get(id);
}
function metreBoxUV(g,size) {
  const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i)*size[0],y=p.getY(i)*size[1],z=p.getZ(i)*size[2];
    const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));
    if(ny>=nx&&ny>=nz) uv.setXY(i,x,-z);
    else if(nx>=nz)uv.setXY(i,-z*Math.sign(n.getX(i)),y);
    else uv.setXY(i,x*Math.sign(n.getZ(i)),y);
  }
  g.userData.metreUV=true;return g;
}
export class Model {
  constructor(lod=0){if(![0,1,2].includes(lod))throw new Error('Invalid LOD');this.lod=lod;this.group=new THREE.Group();}
  material(id){return mat(id);}
  add(obj){this.group.add(obj);return obj;}
  mesh(name,g,pos,material,options={}){
    const mesh=new THREE.Mesh(g,mat(material));mesh.name=name;mesh.position.fromArray(pos);
    if(options.rotation)mesh.rotation.fromArray(options.rotation);
    mesh.castShadow=mesh.receiveShadow=true;return this.add(mesh);
  }
  box(name,size,pos,material,options={}){
    if(size.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Invalid box '+name);
    // Shared unit positions/normals; only physical UV dimensions vary. The exporter
    // deduplicates each attribute separately across all 4,000 models.
    const bevel=this.lod===0?Math.min(.03,(options.bevel??.02)/Math.min(...size)):0;
    const r=bevel>.001?Math.max(.002,Math.round(bevel*500)/500):0;
    const key=JSON.stringify(['box',r,...size]);
    const geo=cached(key,()=>metreBoxUV(r?new RoundedBoxGeometry(1,1,1,1,r):new THREE.BoxGeometry(1,1,1),size));
    const mesh=this.mesh(name,geo,pos,material,options);mesh.scale.fromArray(size);return mesh;
  }
  cylinder(name,top,bottom,height,pos,material,options={}){
    const radius=Math.max(top,bottom);
    if(radius<=0||height<=0)throw new Error('Invalid cylinder '+name);
    const segments=Math.max(6,Math.round((options.segments??28)/[1,2,4][this.lod]));
    const key=JSON.stringify(['cyl',top/radius,bottom/radius,segments,radius,height]);
    const geo=cached(key,()=>{
      const g=new THREE.CylinderGeometry(top/radius,bottom/radius,1,segments,1,false);
      const uv=g.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*2*Math.PI*radius,uv.getY(i)*height);
      g.userData.metreUV=true;return g;
    });
    const mesh=this.mesh(name,geo,pos,material,options);mesh.scale.set(radius,height,radius);return mesh;
  }
  sphere(name,radii,pos,material){
    const key=JSON.stringify(['sphere',this.lod,...radii]);
    const geo=cached(key,()=>{
      const g=new THREE.SphereGeometry(1,[20,12,8][this.lod],[12,8,5][this.lod]),uv=g.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.PI*(radii[0]+radii[2]),uv.getY(i)*Math.PI*radii[1]);
      g.userData.metreUV=true;return g;
    });
    const mesh=this.mesh(name,geo,pos,material);mesh.scale.fromArray(radii);return mesh;
  }
  torus(name,radius,tube,pos,material,options={}){
    const segments=[28,16,10][this.lod],radial=[8,6,4][this.lod],arc=options.arc??Math.PI*2;
    const geo=cached(JSON.stringify(['torus',radius,tube,segments,radial,arc]),()=>new THREE.TorusGeometry(radius,tube,radial,segments,arc));
    return this.mesh(name,geo,pos,material,options);
  }
  pipe(name,points,radius,material){
    const key=JSON.stringify(['pipe',this.lod,points,radius]);
    const geo=cached(key,()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(4,points.length*[4,2,1][this.lod]),radius,[8,6,4][this.lod],false));
    return this.mesh(name,geo,[0,0,0],material);
  }
  sign(name,size,pos,options={}){
    const group=new THREE.Group();group.position.fromArray(pos);if(options.rotation)group.rotation.fromArray(options.rotation);
    const board=new THREE.Mesh(cached('sign-board',()=>new THREE.BoxGeometry(1,1,.05)),mat('metal-dark'));
    board.name=name+'-back';board.scale.set(size[0]+.1,size[1]+.1,1);group.add(board);
    const face=new THREE.Mesh(cached('sign-face',()=>new THREE.PlaneGeometry(1,1)),mat('paint-white'));
    face.name=name;face.scale.set(size[0],size[1],1);face.position.z=.029;face.userData.vaultSign=true;group.add(face);
    this.add(group);return group;
  }
}
