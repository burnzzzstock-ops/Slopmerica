import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CivicLibrary, disposeAsset, type AssetEntry } from './library';
import './catalog.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><a class="wordmark" href="./asset-library.html">CF<span>CIVIC FOUNDRY</span></a><div class="edition">SLOPMERICA / COMPONENT LIBRARY / 01</div><a class="manifest-link" href="./asset-library/manifest.json">Asset manifest ↗</a></header>
  <div class="intro"><div><p class="eyebrow">BUILT FOR THE STREET. DESIGNED FOR THE CLOSE-UP.</p><h1>A better city starts<br>with better pieces.</h1></div><div class="intro-note"><p>Modular architecture, living landscapes, and the structures that keep a city running.</p><div id="summary">Loading collection…</div></div></div>
  <main><aside><label class="search-label" for="search">EXPLORE THE COLLECTION</label><input id="search" type="search" placeholder="Find windows, roofs, trees…" autocomplete="off"><div id="filters" aria-label="Asset category"></div><div id="count" aria-live="polite"></div><div id="asset-list"></div></aside>
  <section class="workspace"><div class="viewer-top"><span id="category">COLLECTION</span><span class="live"><i></i> LIVE 3D PREVIEW</span></div><div id="viewport"><div id="loading" role="status">Preparing the studio…</div><div class="viewer-help">DRAG TO ORBIT · SCROLL TO ZOOM · RIGHT DRAG TO PAN</div><div class="view-buttons"><button id="reset" title="Reset camera">Reset view</button><button id="wire" aria-pressed="false">Wireframe</button></div></div>
  <div class="detail"><div><p class="eyebrow" id="asset-id"></p><h2 id="asset-title">Civic Foundry</h2><p id="description"></p></div><div class="detail-controls"><label for="lod">DETAIL LEVEL</label><select id="lod"><option value="0">LOD 0 — Close view</option><option value="1">LOD 1 — Street view</option><option value="2">LOD 2 — City view</option></select><a id="download" download>Open glTF ↗</a></div></div><div id="metrics"></div><div id="materials"></div>
  <footer>METRES · Y UP · FRONT +Z <span>Original models + 18 coordinated PBR surfaces</span></footer></section></main>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = el('viewport'), loading = el('loading');
const scene = new THREE.Scene(); scene.background = new THREE.Color('#e5e5df');
const camera = new THREE.PerspectiveCamera(35, 1, .01, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
viewport.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Interactive 3D component preview');
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture; scene.environmentIntensity = .7;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe8efff, 0x867c67, 1.7));
const sun = new THREE.DirectionalLight(0xfff3df, 3.3); sun.position.set(8, 15, 10);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0002;
scene.add(sun); scene.add(sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({color: 0xdadbd3, roughness: .97}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
let current: THREE.Group | null = null, library: CivicLibrary, selected: AssetEntry, generation = 0, wireframe = false;
let category = 'All', query = '';
const resize = new ResizeObserver(() => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}); resize.observe(viewport);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
function frame() {
  if (!current) return;
  const box = new THREE.Box3().setFromObject(current), center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()), radius = Math.max(size.length() / 2, .25);
  const angle = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
  const distance = radius / Math.sin(angle) * 1.12;
  controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(1.2, .72, 1.8).normalize().multiplyScalar(distance));
  controls.minDistance = radius * .3; controls.maxDistance = radius * 14;
  camera.near = Math.max(.005, radius / 100); camera.far = Math.max(100, radius * 60); camera.updateProjectionMatrix();
  floor.position.y = box.min.y - .012;
  sun.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(radius * 3));
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -radius*1.5, right: radius*1.5, top: radius*1.5, bottom: -radius*1.5, near: .01, far: radius*15 });
  sun.shadow.camera.updateProjectionMatrix(); controls.update();
}
function applyWire() {
  current?.traverse(o => {
    if (o instanceof THREE.Mesh) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) (mat as THREE.MeshStandardMaterial).wireframe = wireframe;
  });
}
async function select(entry: AssetEntry) {
  selected = entry;
  const version = ++generation, lod = Number(el<HTMLSelectElement>('lod').value) as 0 | 1 | 2;
  loading.hidden = false; loading.textContent = 'Loading ' + entry.label + '…';
  el('asset-title').textContent = entry.label; el('asset-id').textContent = entry.id;
  el('category').textContent = entry.category.toUpperCase(); el('description').textContent = entry.description;
  const data = entry.lods[lod];
  el('metrics').innerHTML = [['TRIANGLES', data.triangles.toLocaleString()], ['MATERIAL BATCHES', String(data.drawCalls)], ['SIZE · W × H × D', entry.dimensions.map(n => n.toFixed(2)).join(' × ') + ' m'], ['GEOMETRY', (data.bufferBytes / 1024).toFixed(0) + ' KB']].map(([label,value]) => '<div><span>' + label + '</span><strong>' + value + '</strong></div>').join('');
  const download = el<HTMLAnchorElement>('download'); download.href = new URL(data.url, library.base).href;
  el('materials').replaceChildren(...entry.materials.map(id => {
    const m = library.manifest.materials.find(m => m.id === id)!;
    const chip = document.createElement('span'); chip.className = 'material-chip';
    const img = document.createElement('img'); img.src = new URL(m.albedo, library.base).href; img.alt = ''; chip.append(img, m.label); return chip;
  }));
  renderList();
  try {
    const loaded = await library.load(entry.id, lod);
    if (version !== generation) { disposeAsset(loaded); return; }
    if (current) { scene.remove(current); disposeAsset(current); }
    current = loaded; scene.add(current); applyWire(); frame(); loading.hidden = true;
    viewport.dataset.loaded = entry.id; viewport.dataset.lod = String(lod);
  } catch (error) { if (version === generation) loading.textContent = String(error); }
}
function renderList() {
  const assets = library.manifest.assets.filter(a => (category === 'All' || a.category === category) && (a.label + ' ' + a.description + ' ' + a.id).toLowerCase().includes(query));
  el('count').textContent = assets.length + ' COMPONENTS';
  el('asset-list').replaceChildren(...assets.map(a => {
    const button = document.createElement('button'); button.className = 'asset-card';
    button.classList.toggle('selected', selected?.id === a.id); button.setAttribute('aria-pressed', String(selected?.id === a.id));
    const title = document.createElement('strong'); title.textContent = a.label;
    const sub = document.createElement('span'); sub.textContent = a.category + ' / ' + a.lods[0].triangles.toLocaleString() + ' triangles';
    button.append(title, sub); button.onclick = () => { void select(a); }; return button;
  }));
}
el('search').addEventListener('input', () => { query = el<HTMLInputElement>('search').value.trim().toLowerCase(); renderList(); });
el('lod').onchange = () => { if (selected) void select(selected); };
el('reset').onclick = frame;
el('wire').onclick = () => { wireframe = !wireframe; el('wire').setAttribute('aria-pressed', String(wireframe)); applyWire(); };
async function initialize() {
try {
  library = await CivicLibrary.open();
  el('summary').innerHTML = '<strong>' + library.manifest.assets.length + '</strong> components <b> / </b><strong>18</strong> PBR materials <b> / </b><strong>3</strong> detail levels';
  const categories = ['All', ...new Set(library.manifest.assets.map(a => a.category))];
  el('filters').replaceChildren(...categories.map(c => {
    const button = document.createElement('button'); button.textContent = c; button.classList.toggle('active', c === category);
    button.onclick = () => { category = c; el('filters').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button)); renderList(); }; return button;
  }));
  const requested = new URLSearchParams(location.search).get('asset');
  await select(library.manifest.assets.find(a => a.id === requested) ?? library.manifest.assets.find(a => a.category === 'storefronts') ?? library.manifest.assets[0]);
} catch (error) { loading.textContent = String(error); }
}
void initialize();
