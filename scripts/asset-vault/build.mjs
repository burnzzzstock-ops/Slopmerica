import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { THREE, palette, variation } from './kit.mjs';
import { families as commerce } from './commercial.mjs';
import { families as infrastructure } from './infrastructure.mjs';
import { families as neighborhood } from './neighborhood.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'vault-public/asset-vault');
const families=[...commerce,...infrastructure,...neighborhood].sort((a,b)=>a.id.localeCompare(b.id));
if(families.length!==100||new Set(families.map(f=>f.id)).size!==100)throw new Error('Expected exactly 100 unique families');
const surfaces=JSON.parse(await fs.readFile(path.join(out,'textures/materials.json'),'utf8'));
const surfaceMap=new Map(surfaces.map(m=>[m.id,m]));
await Promise.all(['models','shared','signs'].map(d=>fs.mkdir(path.join(out,d),{recursive:true})));
const sha=b=>createHash('sha256').update(b).digest('hex');
const round=v=>Number(v.toFixed(6));
const signatureDecoration=name=>/(?:^|[\s-])(?:sign|base|surveyed|foundation|lot|slab)(?:$|[\s-])/i.test(name);
const fragments=[],fragmentMap=new Map(), pending=[], records=[],seenGeometry=new Map();
let bufferBytes=0;
const attrCache=new WeakMap(), uvCache=new WeakMap();

function pool(data){
  const key=sha(data);if(fragmentMap.has(key))return fragmentMap.get(key);
  const offset=bufferBytes;fragments.push(data);bufferBytes+=data.byteLength;
  const pad=(4-bufferBytes%4)%4;if(pad){fragments.push(Buffer.alloc(pad));bufferBytes+=pad;}
  const ref={byteOffset:offset,byteLength:data.byteLength,hash:key};fragmentMap.set(key,ref);return ref;
}
function attribute(attr,semantic,material,signVariant){
  let value;
  if(semantic==='TEXCOORD_0'){
    const key=signVariant!==null?'sign:'+signVariant:material;
    let map=uvCache.get(attr);if(!map){map=new Map();uvCache.set(attr,map);}
    if(map.has(key))return map.get(key);
    const a=new Float32Array(attr.count*2),tile=surfaceMap.get(material)?.tileMeters??1;
    const [u,v]=Array.isArray(tile)?tile:[tile,tile];
    for(let i=0;i<attr.count;i++){
      const x=attr.getX(i),y=attr.getY(i);
      if(signVariant!==null){
        const col=signVariant%4,row=Math.floor(signVariant/4);
        // glTF V=0 is the top image edge. Inset by two pixels to avoid atlas bleed.
        a[i*2]=(col*512+2+x*508)/2048;
        a[i*2+1]=(row*200+2+(1-y)*196)/2048;
      }else {a[i*2]=x/u;a[i*2+1]=y/v;}
    }
    value=describe(a,2,false);map.set(key,value);return value;
  }
  if(attrCache.has(attr))return attrCache.get(attr);
  const isIndex=semantic==='INDEX';
  const a=isIndex?(attr.array instanceof Uint32Array?new Uint32Array(attr.array):new Uint16Array(attr.array)):new Float32Array(attr.array);
  value=describe(a,attr.itemSize,semantic==='POSITION');attrCache.set(attr,value);return value;
}
function describe(array,itemSize,bounds){
  const count=array.length/itemSize;
  const min=Array(itemSize).fill(Infinity),max=Array(itemSize).fill(-Infinity);
  for(let i=0;i<array.length;i++){
    if(!Number.isFinite(array[i]))throw new Error('Non-finite geometry');
    if(bounds){const k=i%itemSize;min[k]=Math.min(min[k],array[i]);max[k]=Math.max(max[k],array[i]);}
  }
  return {...pool(Buffer.from(array.buffer,array.byteOffset,array.byteLength)),count,
    componentType:array instanceof Uint32Array?5125:array instanceof Uint16Array?5123:5126,
    type:itemSize===1?'SCALAR':itemSize===2?'VEC2':'VEC3',...(bounds?{min,max}:{})};
}
function exportAsset(family,familyIndex,variant){
  const id='vlt-'+family.id+'-'+String(variant+1).padStart(2,'0');
  const v=variation(variant),plan='ABCD'[v.layout]+(v.size+1)+'-'+(v.state+1);
  const doc={asset:{version:'2.0',generator:'SLOPMERICA Department of Unnecessary Development 1.0'},
    scene:0,scenes:[],nodes:[],meshes:[],materials:[],textures:[],images:[],
    samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],
    buffers:[{uri:'../shared/geometry.bin',byteLength:0}],bufferViews:[],accessors:[],
    extensionsUsed:['KHR_materials_unlit'],
    extras:{id,family:family.id,variant,plan,units:'metres',up:'+Y',front:'+Z',lodScenes:[0,1,2]}};
  const accessorMap=new Map(),materialMap=new Map(),meshMap=new Map(), lods=[];
  let bounds,signature;
  function access(ref,target=34962){
    const key=ref.hash+':'+ref.type+':'+target;
    if(accessorMap.has(key))return accessorMap.get(key);
    const bufferView=doc.bufferViews.push({buffer:0,byteOffset:ref.byteOffset,byteLength:ref.byteLength,target})-1;
    const index=doc.accessors.push({bufferView,componentType:ref.componentType,count:ref.count,type:ref.type,...(ref.min?{min:ref.min,max:ref.max}:{})})-1;
    accessorMap.set(key,index);return index;
  }
  function tex(uri){
    const source=doc.images.push({uri})-1;
    return doc.textures.push({source,sampler:0})-1;
  }
  function material(id){
    if(materialMap.has(id))return materialMap.get(id);
    let definition;
    if(id==='__sign'){
      const index=tex('../signs/'+family.id+'.png');
      definition={name:family.id+' signage',pbrMetallicRoughness:{baseColorTexture:{index},roughnessFactor:1,metallicFactor:0},extensions:{KHR_materials_unlit:{}}};
    }else{
      const s=surfaceMap.get(id);
      if(s){
        const color=tex('../textures/'+s.albedo),normal=tex('../textures/'+s.normal),orm=tex('../textures/'+s.orm);
        definition={name:id,pbrMetallicRoughness:{baseColorTexture:{index:color},metallicRoughnessTexture:{index:orm},roughnessFactor:1,metallicFactor:1},
          normalTexture:{index:normal,scale:s.normalScale??.4},occlusionTexture:{index:orm,strength:.35}};
      }else{
        const p=palette[id];if(!p)throw new Error('Unknown material '+id);
        const c=new THREE.Color(p[0]);
        definition={name:id,pbrMetallicRoughness:{baseColorFactor:[c.r,c.g,c.b,1],roughnessFactor:p[1],metallicFactor:p[2]}};
      }
    }
    const index=doc.materials.push(definition)-1;materialMap.set(id,index);return index;
  }
  for(let lod=0;lod<3;lod++){
    const group=family.create(variant,lod);group.updateMatrixWorld(true);
    const nodes=[],parts=[],box=new THREE.Box3();
    let triangles=0;
    group.traverse(obj=>{
      if(!obj.isMesh)return;
      if(Array.isArray(obj.material))throw new Error(id+': material arrays unsupported');
      const g=obj.geometry,sign=!!obj.userData.vaultSign,matId=sign?'__sign':obj.material.name;
      for(const attr of ['position','normal','uv'])if(!g.attributes[attr])throw new Error(id+': missing '+attr+' in '+obj.name);
      const pos=attribute(g.attributes.position,'POSITION',matId,null);
      const norm=attribute(g.attributes.normal,'NORMAL',matId,null);
      // Custom geometries with normalized UVs still receive material tiling; kit
      // primitives have physical UV dimensions baked independently of positions.
      const uv=attribute(g.attributes.uv,'TEXCOORD_0',matId,sign?variant:null);
      const index=g.index?attribute(g.index,'INDEX',matId,null):null;
      const materialIndex=material(matId);
      const primitive={attributes:{POSITION:access(pos),NORMAL:access(norm),TEXCOORD_0:access(uv)},material:materialIndex,mode:4,...(index?{indices:access(index,34963)}:{})};
      const meshKey=[pos.hash,norm.hash,uv.hash,index?.hash,materialIndex].join(':');
      let mesh=meshMap.get(meshKey);
      if(mesh===undefined){mesh=doc.meshes.push({primitives:[primitive]})-1;meshMap.set(meshKey,mesh);}
      const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
      obj.matrixWorld.decompose(position,rotation,scale);
      const translation=position.toArray().map(round),quaternion=rotation.toArray().map(round),scaling=scale.toArray().map(round);
      if([...translation,...quaternion,...scaling].some(n=>!Number.isFinite(n))||scaling.some(n=>n===0))throw new Error(id+': invalid transform');
      const node={name:obj.name,mesh,translation,...(quaternion.some((n,i)=>n!==[0,0,0,1][i])?{rotation:quaternion}:{}),...(scaling.some(n=>n!==1)?{scale:scaling}:{})};
      nodes.push(doc.nodes.push(node)-1);
      triangles+=(index?index.count:pos.count)/3;
      const localBox=new THREE.Box3(new THREE.Vector3(...pos.min),new THREE.Vector3(...pos.max)).applyMatrix4(obj.matrixWorld);box.union(localBox);
      // A different label or a slightly larger base slab must not count as
      // another authored structure. Compare substantive geometry only.
      if(!sign&&!signatureDecoration(obj.name))parts.push([pos.hash,index?.hash??'',translation,quaternion,scaling]);
    });
    if(!nodes.length)throw new Error(id+': empty model');
    doc.scenes.push({name:'LOD '+lod,nodes,extras:{level:lod}});
    lods.push({level:lod,scene:lod,triangles,drawCalls:nodes.length,bounds:{min:box.min.toArray().map(round),max:box.max.toArray().map(round)}});
    if(lod===0){
      bounds=lods[0].bounds;
      signature=sha(Buffer.from(JSON.stringify(parts.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))));
    }
  }
  if(seenGeometry.has(signature))throw new Error('Duplicate structural geometry: '+id+' and '+seenGeometry.get(signature));
  seenGeometry.set(signature,id);
  const asset={id,family:family.id,variant,plan,label:family.label+' · '+plan,url:'models/'+id+'.gltf',
    dimensions:bounds.max.map((n,i)=>round(n-bounds.min[i])),bounds,
    parameters:v,lods,geometrySignature:signature,
    sockets:[{name:'ground-anchor',position:[0,0,0]},{name:'street-front',position:[0,0,bounds.max[2]]}]};
  pending.push({doc,asset});return asset;
}
for(let fi=0;fi<families.length;fi++){
  const f=families[fi];if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.id))throw new Error('Bad family ID: '+f.id);
  for(let variant=0;variant<40;variant++)records.push(exportAsset(f,fi,variant));
  console.log(String(fi+1).padStart(3)+' / 100 · '+f.id);
}
if(bufferBytes>=95*1024*1024)throw new Error('Shared geometry exceeds 95 MiB safety budget: '+bufferBytes);
const bin=Buffer.concat(fragments);
await fs.writeFile(path.join(out,'shared/geometry.bin'),bin);
for(const {doc,asset} of pending){
  doc.buffers[0].byteLength=bin.byteLength;
  const text=JSON.stringify(doc);asset.fileBytes=Buffer.byteLength(text);asset.sha256=sha(Buffer.from(text));
  await fs.writeFile(path.join(out,asset.url),text);
}
const familyRecords=families.map(f=>({id:f.id,label:f.label,category:f.category,description:f.description,satire:f.satire,signLines:f.signLines,tags:f.tags??[],count:40}));
const manifest={schemaVersion:1,version:'1.0.0',name:'Department of Unnecessary Development',subtitle:'4,000 assets for the next growth cycle',
  provenance:'Original procedural variants for SLOPMERICA. 100 modeled families × 40 structural configurations; LODs are not counted as extra assets.',
  units:'metres',upAxis:'+Y',frontAxis:'+Z',variantScheme:{sizes:5,layouts:4,states:2},
  textureConvention:'sRGB albedo; OpenGL +Y normals; linear ORM R=AO G=roughness B=metalness',
  sharedGeometry:{url:'shared/geometry.bin',bytes:bin.byteLength,sha256:sha(bin),uniqueAttributeBlocks:fragmentMap.size},
  materials:surfaces.map(s=>({...s,albedo:'textures/'+s.albedo,normal:'textures/'+s.normal,orm:'textures/'+s.orm})),
  families:familyRecords,assets:records};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest)+'\n');
await fs.writeFile(path.join(out,'families.json'),JSON.stringify(familyRecords,null,2)+'\n');
const csvCell=s=>'"'+String(s??'').replaceAll('"','""')+'"';
const csv=[['id','family','category','name','plan','satire','width_m','height_m','depth_m','lod0_triangles','lod1_triangles','lod2_triangles','gltf'].join(',')];
for(const a of records){const f=familyRecords.find(f=>f.id===a.family);csv.push([a.id,a.family,f.category,a.label,a.plan,f.satire,...a.dimensions,...a.lods.map(l=>l.triangles),a.url].map(csvCell).join(','));}
await fs.writeFile(path.join(out,'catalog.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify({assets:records.length,families:families.length,lodScenes:records.length*3,sharedGeometryMiB:+(bin.byteLength/1024/1024).toFixed(2),gltfMiB:+(records.reduce((s,a)=>s+a.fileBytes,0)/1024/1024).toFixed(2),uniqueStructuralSignatures:seenGeometry.size},null,2));
