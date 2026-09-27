import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VaultLibrary, type VaultAsset, type VaultHandle } from './library';
import './catalog.css';

const params=new URLSearchParams(location.search),capture=params.has('capture');
if(capture)document.body.classList.add('capture');
document.querySelector('#app')!.innerHTML=`
<header><div class="seal">DUD</div><div class="department">DEPARTMENT OF<br><strong>UNNECESSARY DEVELOPMENT</strong></div><div class="header-end">SLOPMERICA / FUTURE ASSETS DIVISION<span class="status-dot"> APPROVED FOR MORE</span></div></header>
<section class="intro"><div><p class="eyebrow">THE NEXT GROWTH CYCLE STARTS HERE.</p><h1>4,000 opportunities.<br><em>Zero restraint.</em></h1></div><div class="lede"><p>A reserve of fictional businesses, civic wonders, questionable neighborhoods, and improvements nobody requested.</p><div class="stats"><b>100</b> families <span>×</span> <b>40</b> structural plans <span>=</span> <b>4,000</b> assets</div></div></section>
<main><aside><div class="search-heading">FIND YOUR NEXT LIABILITY</div><input id="search" type="search" placeholder="Search assets, satire, tags…" aria-label="Search assets"><div id="categories" class="filters"></div><label class="small-label" for="family">ASSET FAMILY</label><select id="family"><option value="">All 100 families</option></select><div class="list-status"><span id="count"></span><span id="page-label"></span></div><div id="list"></div><div class="pagination"><button id="previous">← Previous</button><button id="next">Next →</button></div><a class="csv-link" href="./asset-vault-overview.html">Browse all 100 family previews ↗</a><a class="csv-link" href="./asset-vault/catalog.csv" download>Download all 4,000 catalog records ↗</a></aside>
<section class="workspace"><div class="studio-bar"><span id="sector">ASSET PREVIEW</span><span>LIVE 3D / STANDARD glTF 2.0</span></div><div id="viewport"><div id="loading" role="status">Opening the department…</div><div class="viewport-note">DRAG TO ORBIT · SCROLL TO INSPECT · RIGHT DRAG TO PAN</div><div class="studio-controls"><button id="reset">Reset</button><button id="wire" aria-pressed="false">Wireframe</button><button id="random">Surprise me</button></div></div>
<section class="details"><div><div class="eyebrow" id="asset-id">ORIGINAL SATIRICAL ASSET COLLECTION</div><h2 id="title">Growth pending.</h2><p id="satire" class="satire"></p><p id="description"></p><div id="tags"></div></div><div class="controls"><label class="small-label" for="lod">LEVEL OF DETAIL</label><select id="lod"><option value="0">LOD 0 · Close inspection</option><option value="1">LOD 1 · Street scale</option><option value="2">LOD 2 · City scale</option></select><a id="gltf" download>glTF file ↗</a><small>Keep the shared geometry and texture folders.</small></div></section><div id="metrics"></div><div class="variants"><label class="small-label">40 PLANS IN THIS FAMILY</label><div id="variants"></div></div><div class="integration"><span class="small-label">USE THIS ASSET</span><code id="snippet"></code><button id="copy">Copy ID</button></div><footer>METRES / Y UP / FRONT +Z <span>Art library for future integration. No gameplay changes.</span></footer></section></main>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const viewport=el('viewport'),loading=el('loading');
// This isolated catalog opts into CPU-side shared-file caching. The library API
// itself does not change Three.js global cache behavior in a host game.
THREE.Cache.enabled=true;
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
viewport.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#d9ddd3');
const camera=new THREE.PerspectiveCamera(33,1,.02,1000);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.05);
scene.environment=environment.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe7efff,0x83795d,1.6));
const sun=new THREE.DirectionalLight(0xfff1d8,3.0);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.00015;scene.add(sun,sun.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0xcdd3c4,roughness:.95}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const observer=new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});
observer.observe(viewport);
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
let library:VaultLibrary,selected:VaultAsset,current:VaultHandle|null=null,request=0,wire=false,page=0,category='',familyFilter='',query='';
const PAGE_SIZE=40;
function frame(){
  if(!current)return;
  const box=new THREE.Box3().setFromObject(current.root),center=box.getCenter(new THREE.Vector3()),radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.3);
  const vertical=camera.fov*Math.PI/360,dir=new THREE.Vector3(1.15,.82,1.75).normalize();
  const right=new THREE.Vector3().crossVectors(camera.up,dir).normalize(),up=new THREE.Vector3().crossVectors(dir,right);
  let distance=0;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const corner=new THREE.Vector3(x,y,z).sub(center),depth=corner.dot(dir);
    distance=Math.max(distance,depth+Math.abs(corner.dot(right))/(Math.tan(vertical)*camera.aspect),depth+Math.abs(corner.dot(up))/Math.tan(vertical));
  }
  controls.target.copy(center);camera.position.copy(center).add(dir.multiplyScalar(distance*1.12));
  controls.minDistance=radius*.22;controls.maxDistance=radius*10;camera.near=Math.max(.005,radius/200);camera.far=Math.max(200,radius*80);camera.updateProjectionMatrix();
  floor.position.y=box.min.y-.012;sun.position.copy(center).add(new THREE.Vector3(2,4,3).multiplyScalar(radius));sun.target.position.copy(center);
  Object.assign(sun.shadow.camera,{left:-radius*1.5,right:radius*1.5,top:radius*1.5,bottom:-radius*1.5,near:.02,far:radius*16});sun.shadow.camera.updateProjectionMatrix();controls.update();
}
function wireMode(){current?.root.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])(m as THREE.MeshStandardMaterial).wireframe=wire;});}
function lod():0|1|2{return Number(el<HTMLSelectElement>('lod').value) as 0|1|2;}
function refreshDetails(){
  const f=library.manifest.families.find(f=>f.id===selected.family)!,l=selected.lods[lod()];
  el('asset-id').textContent=selected.id;el('title').textContent=selected.label;el('sector').textContent=f.category.toUpperCase();
  el('satire').textContent=f.satire;el('description').textContent=f.description;
  el('tags').replaceChildren(...f.tags.map(tag=>{const b=document.createElement('button');b.textContent=tag;b.onclick=()=>{query=tag;el<HTMLInputElement>('search').value=tag;familyFilter='';el<HTMLSelectElement>('family').value='';page=0;renderList();};return b;}));
  el('metrics').innerHTML=[['TRIANGLES',l.triangles.toLocaleString()],['MESHES',String(l.drawCalls)],['W × H × D',selected.dimensions.map(n=>n.toFixed(1)).join(' × ')+' m'],['PLAN',selected.plan]].map(([k,v])=>'<div><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
  el<HTMLAnchorElement>('gltf').href=new URL(selected.url,library.base).href;
  el('snippet').textContent="await vault.load('"+selected.id+"', "+lod()+")";
  el('variants').replaceChildren(...library.manifest.assets.filter(a=>a.family===selected.family).map(a=>{
    const b=document.createElement('button');b.textContent=a.plan;b.classList.toggle('selected',a.id===selected.id);b.onclick=()=>{void select(a);};return b;
  }));
}
async function select(asset:VaultAsset){
  const token=++request;selected=asset;loading.hidden=false;loading.textContent='Preparing '+asset.label+'…';
  refreshDetails();renderList();
  try{
    const handle=await library.load(asset.id,lod());
    if(token!==request){handle.dispose();return;}
    handle.setLOD(lod());
    if(current){scene.remove(current.root);current.dispose();}
    current=handle;scene.add(current.root);wireMode();frame();loading.hidden=true;
    viewport.dataset.loaded=asset.id;viewport.dataset.lod=String(lod());
    const url=new URL(location.href);url.searchParams.set('asset',asset.id);history.replaceState(null,'',url);
  }catch(error){if(token===request)loading.textContent=String(error);}
}
function renderList(){
  const families=new Map(library.manifest.families.map(f=>[f.id,f]));
  const assets=library.manifest.assets.filter(a=>{
    const f=families.get(a.family)!;
    return(!category||f.category===category)&&(!familyFilter||a.family===familyFilter)&&(!query||[a.id,a.label,f.description,f.satire,...f.tags].join(' ').toLowerCase().includes(query));
  }).sort((a,b)=>a.variant-b.variant||a.family.localeCompare(b.family));
  const pages=Math.max(1,Math.ceil(assets.length/PAGE_SIZE));page=Math.min(page,pages-1);
  el('count').textContent=assets.length.toLocaleString()+' ASSETS';el('page-label').textContent=(page+1)+' / '+pages;
  el<HTMLButtonElement>('previous').disabled=page===0;el<HTMLButtonElement>('next').disabled=page===pages-1;
  el('list').replaceChildren(...assets.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=>{
    const f=families.get(a.family)!,b=document.createElement('button');b.className='asset-card';b.dataset.id=a.id;b.classList.toggle('selected',a.id===selected?.id);
    const badge=document.createElement('span');badge.className='card-badge';badge.textContent=f.category==='commerce'?'C':f.category==='infrastructure'?'I':'N';
    const copy=document.createElement('span'),title=document.createElement('strong'),small=document.createElement('small');title.textContent=f.label;small.textContent='PLAN '+a.plan+' / '+a.lods[0].triangles.toLocaleString()+' TRI';copy.append(title,small);b.append(badge,copy);b.onclick=()=>{void select(a);};return b;
  }));
}
el('search').addEventListener('input',()=>{query=el<HTMLInputElement>('search').value.toLowerCase().trim();page=0;renderList();});
el('family').onchange=()=>{familyFilter=el<HTMLSelectElement>('family').value;page=0;renderList();};
el('previous').onclick=()=>{page--;renderList();};el('next').onclick=()=>{page++;renderList();};
el('reset').onclick=frame;el('wire').onclick=()=>{wire=!wire;el('wire').setAttribute('aria-pressed',String(wire));wireMode();};
el('random').onclick=()=>{void select(library.manifest.assets[Math.floor(Math.random()*library.manifest.assets.length)]);};
el('lod').onchange=()=>{if(current){current.setLOD(lod());wireMode();frame();refreshDetails();viewport.dataset.lod=String(lod());}};
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(selected.id);el('copy').textContent='Copied';}catch{el('copy').textContent='Select ID above';}};
async function init(){
  try{
    library=await VaultLibrary.open();
    for(const f of library.manifest.families){const option=document.createElement('option');option.value=f.id;option.textContent=f.label;el('family').append(option);}
    for(const c of ['',...new Set(library.manifest.families.map(f=>f.category))]){
      const b=document.createElement('button');b.textContent=c||'All';b.classList.toggle('active',!c);
      b.onclick=()=>{category=c;page=0;el('categories').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderList();};el('categories').append(b);
    }
    const initial=library.manifest.assets.find(a=>a.id===params.get('asset'))??library.manifest.assets.find(a=>a.family==='gas-guzzler-gulch')??library.manifest.assets[0];
    await select(initial);
  }catch(error){loading.textContent=String(error);}
}
void init();
