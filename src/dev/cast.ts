import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FeedContext, FeedEventKind, FeedPost, PersonAction, VehicleKind } from '../contracts';
import { ARCHETYPES, PeopleRenderer } from '../agents/people';
import { VEHICLE_SPECS, VehicleRenderer } from '../agents/vehicles';
import { ambientPost, postFor } from '../content/feed';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $<HTMLElement>('stage');
const actionSelect = $<HTMLSelectElement>('action-select');
const rosterSelect = $<HTMLSelectElement>('roster-select');
const eventSelect = $<HTMLSelectElement>('event-select');
const actions: PersonAction[] = ['walk', 'run', 'idle', 'smoke', 'drink', 'vape', 'phone', 'protest', 'dance', 'drum', 'yoga', 'sit', 'lie', 'fight'];
const events: FeedEventKind[] = [
  'gameStart', 'roadBuilt', 'stroadBuilt', 'highwayBuilt', 'bridgeBuilt', 'laneAdded', 'roadBulldozed',
  'zoned', 'buildingOpened', 'buildingLeveled', 'buildingDemolished', 'crash', 'drunkCrash',
  'pedestrianHit', 'trafficJam', 'communeFound', 'communeProtest', 'communeBribed', 'communeSued',
  'communeLawsuitLost', 'communeForever', 'treesCut', 'natureMilestone', 'populationMilestone',
  'sprawlMilestone', 'maxLevelReached', 'lowMoney', 'bankrupt', 'taxRaised', 'taxCut',
  'seasonChange', 'weatherChange', 'nightfall', 'merchDrop', 'ambient',
];
const vehicleKinds = Object.keys(VEHICLE_SPECS) as VehicleKind[];
const personGroup = document.createElement('optgroup'); personGroup.label = 'Citizens';
const vehicleGroup = document.createElement('optgroup'); vehicleGroup.label = 'Vehicles';
for (let i = 0; i < ARCHETYPES.length; i++) personGroup.append(new Option(ARCHETYPES[i].name, `person:${i}`));
for (let i = 0; i < vehicleKinds.length; i++) vehicleGroup.append(new Option(VEHICLE_SPECS[vehicleKinds[i]].label, `vehicle:${i}`));
rosterSelect.append(personGroup, vehicleGroup);

for (const action of actions) actionSelect.add(new Option(action[0].toUpperCase() + action.slice(1), action));
for (const event of events) eventSelect.add(new Option(event.replace(/([A-Z])/g, ' $1').toLowerCase(), event));
eventSelect.value = 'laneAdded';
$('cast-count').textContent = `${ARCHETYPES.length} CITIZENS · ${vehicleKinds.length} VEHICLES`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#82949a');
scene.fog = new THREE.Fog('#82949a', 105, 240);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
camera.position.set(56, 82, 122);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
stage.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 6);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 8;
controls.maxDistance = 220;
controls.update();

const sun = new THREE.DirectionalLight('#fff1d2', 3.0);
sun.position.set(-34, 74, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -65; sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0005;
scene.add(sun);
const hemi = new THREE.HemisphereLight('#dbedff', '#514a32', 2.2);
scene.add(hemi);
const lotLights: THREE.PointLight[] = [];
for (const x of [-32, 0, 32]) {
  for (const z of [-38, 48]) {
    const lamp = new THREE.PointLight('#ffdd98', 0, 42, 2);
    lamp.position.set(x, 10, z);
    lotLights.push(lamp);
    scene.add(lamp);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 10, 6), new THREE.MeshStandardMaterial({ color: '#454945', metalness: 0.55, roughness: 0.55 }));
    pole.position.set(x, 5, z);
    scene.add(pole);
    const lightBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.7), new THREE.MeshStandardMaterial({ color: '#e8d7a8', emissive: '#ebad58', emissiveIntensity: 0.15 }));
    lightBox.position.set(x, 10, z);
    scene.add(lightBox);
  }
}

function flat(width: number, depth: number, color: string, x: number, y: number, z: number): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
}
flat(82, 112, '#658354', 0, -0.07, 5);
flat(70, 57, '#454947', 0, -0.045, 24);
flat(70, 1.1, '#dcce90', 0, -0.028, -4);
for (const z of [2.5, 19.5, 36.5, 50]) {
  for (const x of [-30, -20, -10, 0, 10, 20, 30]) flat(0.12, 3.4, '#d4d3c2', x, -0.018, z);
}

function groundTitle(text: string, z: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 150;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 150);
  ctx.fillStyle = '#f1ead5';
  ctx.textAlign = 'center';
  ctx.font = 'bold 100px Anton, Impact, sans-serif';
  ctx.fillText(text, 512, 109);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(32, 4.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  sign.rotation.x = -Math.PI / 2;
  sign.position.set(0, 0.017, z);
  scene.add(sign);
}
groundTitle('CITIZEN LINEUP', -42);
groundTitle('MOTORPOOL', -2);

const labelSprites: THREE.Sprite[] = [];
function nameSprite(name: string, x: number, y: number, z: number, width: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 90;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#121713df';
  ctx.fillRect(0, 0, 512, 90);
  ctx.strokeStyle = '#d6e58a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 86);
  ctx.fillStyle = '#f4f0de';
  ctx.font = 'bold 34px Overpass, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 256, 57, 490);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.position.set(x, y, z);
  sprite.scale.set(width, width * 90 / 512, 1);
  scene.add(sprite);
  labelSprites.push(sprite);
}

const people = new PeopleRenderer(scene, Math.max(400, ARCHETYPES.length));
const vehicles = new VehicleRenderer(scene, 64);
const peopleHandles: number[] = [];
const peopleByHandle = new Map<number, number>();
for (let i = 0; i < ARCHETYPES.length; i++) {
  const x = -28.1 + (i % 12) * 5.1;
  const z = -36.5 + Math.floor(i / 12) * 5.3;
  const handle = people.add(i, i * 18013 + 77);
  peopleHandles.push(handle);
  if (handle >= 0) {
    peopleByHandle.set(handle, i);
    people.set(handle, x, 0, z, 0, actions[i % actions.length], i * 0.47);
  }
  nameSprite(ARCHETYPES[i].name, x, 2.8, z, 4.7);
}
const vehicleHandles: number[] = [];
const vehicleByHandle = new Map<number, number>();
const paint = [0x8d262d, 0xd8dbd1, 0x293e5c, 0x896a39, 0x3e5b36, 0x3d4243, 0xc6f432, 0xb5aca1];
for (let i = 0; i < vehicleKinds.length; i++) {
  const x = -25 + (i % 6) * 10;
  const z = 7 + Math.floor(i / 6) * 17;
  const kind = vehicleKinds[i];
  const handle = vehicles.add(kind, paint[i % paint.length]);
  vehicleHandles.push(handle);
  if (handle >= 0) {
    vehicleByHandle.set(handle, i);
    vehicles.set(handle, x, 0, z, 0, 0, 0);
  }
  nameSprite(VEHICLE_SPECS[kind].label, x, VEHICLE_SPECS[kind].height + 1, z, 6.8);
}
people.flush();
vehicles.flush();

let night = false;
function updateNight(): void {
  const n = night ? 1 : 0;
  people.setNight(n);
  vehicles.setNight(n);
  scene.background = new THREE.Color(night ? '#0b1220' : '#82949a');
  scene.fog = new THREE.Fog(night ? '#0b1220' : '#82949a', night ? 68 : 105, night ? 175 : 240);
  sun.intensity = night ? 0.8 : 3;
  hemi.intensity = night ? 1.5 : 2.2;
  renderer.toneMappingExposure = night ? 2 : 1.25;
  for (const lamp of lotLights) lamp.intensity = night ? 100 : 0;
  $('time-toggle').textContent = night ? '☀ Day' : '☾ Night';
  $('time-state').textContent = night ? 'Night lights' : 'Daylight';
}
$('time-toggle').addEventListener('click', () => { night = !night; updateNight(); });

const focusButtons = ['view-all', 'view-people', 'view-cars'];
function focus(mode: 'all' | 'people' | 'cars'): void {
  if (mode === 'all') { camera.position.set(56, 82, 122); controls.target.set(0, 0, 6); }
  if (mode === 'people') { camera.position.set(24, 24, 12); controls.target.set(0, 0, -25); }
  if (mode === 'cars') { camera.position.set(34, 39, 78); controls.target.set(0, 0, 23); }
  controls.update();
  for (const id of focusButtons) $(id).classList.toggle('active', id === `view-${mode}`);
}
$('view-all').addEventListener('click', () => focus('all'));
$('view-people').addEventListener('click', () => focus('people'));
$('view-cars').addEventListener('click', () => focus('cars'));

let manualAction: PersonAction | null = null;
let actionOffset = 0;
actionSelect.addEventListener('change', () => { manualAction = actionSelect.value === 'auto' ? null : actionSelect.value as PersonAction; });
$('next-action').addEventListener('click', () => {
  if (manualAction) {
    manualAction = actions[(actions.indexOf(manualAction) + 1) % actions.length];
    actionSelect.value = manualAction;
  } else actionOffset++;
});

const pointerStart = new THREE.Vector2();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
function selectPerson(index: number): void {
  const archetype = ARCHETYPES[index];
  $('selection-panel').querySelector('h3')!.textContent = 'Selected citizen';
  $('selected-name').textContent = archetype.name;
  $('selected-handle').textContent = `@${archetype.handle}`;
  $('selected-bio').textContent = archetype.bio;
  $('selected-tags').replaceChildren(...[
    archetype.lean.toUpperCase(), ...archetype.vices, ...(archetype.hippie ? ['COMMUNE'] : []), ...(archetype.merch ? ['SLOP MERCH'] : []),
  ].map((label) => { const span = document.createElement('span'); span.textContent = label; return span; }));
  rosterSelect.value = `person:${index}`;
}
function selectVehicle(index: number): void {
  const spec = VEHICLE_SPECS[vehicleKinds[index]];
  $('selection-panel').querySelector('h3')!.textContent = 'Selected vehicle';
  $('selected-name').textContent = spec.label;
  $('selected-handle').textContent = 'Motorpool inventory';
  $('selected-bio').textContent = `${spec.length.toFixed(1)} m long · ${spec.width.toFixed(1)} m wide · top speed ${Math.round(spec.maxSpeed * 2.237)} mph. Every model faces +Z.`;
  $('selected-tags').replaceChildren();
  rosterSelect.value = `vehicle:${index}`;
}
function focusSelection(x: number, z: number, distance: number): void {
  camera.position.set(x + distance * 0.62, distance * 0.65, z + distance);
  controls.target.set(x, 1, z);
  controls.update();
  for (const id of focusButtons) $(id).classList.remove('active');
}
rosterSelect.addEventListener('change', () => {
  const [kind, value] = rosterSelect.value.split(':');
  const index = Number(value);
  if (!Number.isInteger(index)) return;
  if (kind === 'person' && ARCHETYPES[index]) {
    selectPerson(index);
    focusSelection(-28.1 + (index % 12) * 5.1, -36.5 + Math.floor(index / 12) * 5.3, 9);
  } else if (kind === 'vehicle' && vehicleKinds[index]) {
    selectVehicle(index);
    focusSelection(-25 + (index % 6) * 10, 7 + Math.floor(index / 6) * 17, Math.max(10, VEHICLE_SPECS[vehicleKinds[index]].length * 1.5));
  }
});
renderer.domElement.addEventListener('pointerdown', (e) => pointerStart.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 7) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const personHandle = people.pick(raycaster);
  if (personHandle !== null && peopleByHandle.has(personHandle)) {
    selectPerson(peopleByHandle.get(personHandle)!);
    return;
  }
  const vehicleHandle = vehicles.pick(raycaster);
  if (vehicleHandle !== null && vehicleByHandle.has(vehicleHandle)) {
    selectVehicle(vehicleByHandle.get(vehicleHandle)!);
  }
});

const ctx: FeedContext = {
  city: 'Holler County', map: 'appalachia', population: 12247, money: 18400,
  naturePct: 0.64, sprawlPct: 0.38, season: 'summer', weather: 'heatwave',
  road: 'Whispering Pines Stroad', brand: 'Dollar Colonel', building: 'SprawlMart',
  commune: 'Sunflower Junction', amount: 42000, count: 17,
};
const sampleRoads = ['Whispering Pines Stroad', 'Old Oak Parkway', 'Freedom Frontage Road', 'Route 9', 'Culvert Boulevard'];
const sampleBrands = ['Dollar Colonel', 'Fill Er Up', 'SprawlMart', 'Chick-Fil-Eh', 'Neural Fly'];
const sampleBuildings = ['SprawlMart', 'the 120-pump Dillo\'s', 'Slop 69 ballpark', 'Lake Serenity Estates', 'Pig Cabana'];
const sampleCommunes = ['Sunflower Junction', 'Mossy Hollow', 'Soft Landing Collective'];

function sampleContext(): FeedContext {
  return {
    ...ctx,
    road: sampleRoads[Math.floor(Math.random() * sampleRoads.length)],
    brand: sampleBrands[Math.floor(Math.random() * sampleBrands.length)],
    building: sampleBuildings[Math.floor(Math.random() * sampleBuildings.length)],
    commune: sampleCommunes[Math.floor(Math.random() * sampleCommunes.length)],
    amount: 12000 + Math.floor(Math.random() * 90000),
    count: 2 + Math.floor(Math.random() * 70),
  };
}

function metric(n: number): string {
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
function appendText(parent: HTMLElement, className: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = value;
  parent.append(el);
  return el;
}
function showPost(post: FeedPost): void {
  const card = document.createElement('article'); card.className = 'post';
  const head = document.createElement('div'); head.className = 'post-head';
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.background = post.avatar.bg; avatar.textContent = post.avatar.emoji ?? '●';
  head.append(avatar);
  const identity = document.createElement('div'); identity.className = 'identity';
  const name = document.createElement('strong'); name.textContent = post.name;
  identity.append(name);
  if (post.badge) { const badge = document.createElement('span'); badge.className = `badge ${post.badge}`; badge.textContent = '✦'; badge.title = `${post.badge} check`; identity.append(badge); }
  appendText(identity, 'handle', `@${post.handle}`);
  head.append(identity);
  card.append(head);
  appendText(card, 'post-text', post.text);
  if (post.image) { const image = appendText(card, `post-image ${post.image.kind === 'aiSlop' ? '' : post.image.kind}`, post.image.caption); image.title = post.image.kind; }
  if (post.note) { const note = appendText(card, 'note', post.note); const title = document.createElement('strong'); title.textContent = 'Community Note · '; note.prepend(title); }
  for (const reply of post.replies ?? []) {
    const line = appendText(card, 'reply', reply.text);
    const handle = document.createElement('strong'); handle.textContent = `@${reply.handle}  `;
    line.prepend(handle);
  }
  appendText(card, 'metrics', `♡ ${metric(post.likes)}     ⇄ ${metric(post.reposts)}     ◉ ${metric(post.views)} views`);
  const feed = $('feed'); feed.prepend(card);
  while (feed.childElementCount > 8) feed.lastElementChild?.remove();
}
function fire(kind: FeedEventKind): void {
  const post = kind === 'ambient' ? ambientPost(sampleContext(), Math.random) : postFor(kind, sampleContext(), Math.random);
  if (post) showPost(post);
}
$('fire-event').addEventListener('click', () => fire(eventSelect.value as FeedEventKind));
$('random-event').addEventListener('click', () => fire(events[Math.floor(Math.random() * (events.length - 1))]));
$('ambient-event').addEventListener('click', () => fire('ambient'));
fire('gameStart'); fire('merchDrop'); fire('ambient');
window.setInterval(() => fire('ambient'), 14000);

const resize = new ResizeObserver(() => {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 1 || h < 1) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const label of labelSprites) label.visible = w > 700;
});
resize.observe(stage);
let frame = 0;
renderer.setAnimationLoop((now) => {
  const t = now * 0.001;
  const current = manualAction ?? actions[(Math.floor(t / 4) + actionOffset) % actions.length];
  $('current-action').textContent = manualAction ? `Action: ${current}` : `Cycling: ${current}`;
  for (let i = 0; i < peopleHandles.length; i++) {
    const handle = peopleHandles[i];
    if (handle < 0) continue;
    const action = manualAction ?? actions[(Math.floor(t / 4) + actionOffset + i) % actions.length];
    people.set(handle, -28.1 + (i % 12) * 5.1, 0, -36.5 + Math.floor(i / 12) * 5.3, 0, action, t * (action === 'run' ? 7 : 3) + i * 0.47);
  }
  people.flush();
  // Flashing emergency lights may update during flush even when the cars are parked.
  vehicles.flush();
  if (++frame % 2 === 0) controls.update();
  renderer.render(scene, camera);
});
