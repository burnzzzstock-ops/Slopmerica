import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One skinned-ish procedural citizen is instanced for the whole population. Parts are
// tagged in the geometry and articulated in the vertex shader; optional outfit pieces
// collapse to a point when their per-instance style does not select them.
export const PERSON_PART = {
  root: 0, torso: 1, head: 2, leftUpperArm: 3, rightUpperArm: 4,
  leftForearm: 5, rightForearm: 6, leftThigh: 7, rightThigh: 8,
  leftCalf: 9, rightCalf: 10,
} as const;

const ZONE = { skin: 1, shirt: 2, pants: 3, shoe: 4, hair: 5, accent: 6, face: 7, prop: 8, light: 9, decal: 10, metal: 11 } as const;

export const OUTFIT_ID = { tee: 0, hoodie: 1, suit: 2, vest: 3, tank: 4, flannel: 5, overalls: 6, robe: 7, jersey: 8, workwear: 9, raincoat: 10 } as const;
export const HAIR_ID = { bald: 0, crop: 1, long: 2, ponytail: 3, mohawk: 4, mullet: 5, bun: 6 } as const;
export const HAT_ID = { none: 0, ballcap: 1, beanie: 2, cowboy: 3, hardhat: 4, tinfoil: 5, sunhat: 6 } as const;
export const PROP_ID = { none: 0, cigarette: 1, beer: 2, vape: 3, phone: 4, sign: 5, drum: 6 } as const;

const F_OUTFIT = 100;
const F_HAIR = 200;
const F_HAT = 300;
const F_PROP = 400;
const F_MERCH = 500;

type Piece = { geometry: THREE.BufferGeometry; part: number; zone: number; feature: number };

function tagged(
  geometry: THREE.BufferGeometry,
  part: number,
  zone: number,
  feature = 0,
  position?: [number, number, number],
  scale?: [number, number, number],
  rotation?: [number, number, number],
): Piece {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3(...(position ?? [0, 0, 0]));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]), 'XYZ'));
  const s = new THREE.Vector3(...(scale ?? [1, 1, 1]));
  m.compose(p, q, s);
  g.applyMatrix4(m);
  const count = g.getAttribute('position').count;
  const tags = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { tags[i * 3] = part; tags[i * 3 + 1] = zone; tags[i * 3 + 2] = feature; }
  g.setAttribute('aTag', new THREE.BufferAttribute(tags, 3));
  return { geometry: g, part, zone, feature };
}

function cyl(radial = 7, top = 1, bottom = 1): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(top, bottom, 1, radial, 1, false);
}

// Small blocks read as chamfered once lit and post-processed, while a true extrude
// spends hundreds of hidden triangles for every optional accessory.
function box(_bevel = 0): THREE.BufferGeometry { return new THREE.BoxGeometry(1, 1, 1); }

function plane(): THREE.PlaneGeometry { return new THREE.PlaneGeometry(1, 1, 1, 1); }

function nearPieces(): Piece[] {
  const p: Piece[] = [];
  // Core proportions: 1.75 m at the crown. Tapered cylinders and low-poly spheres
  // keep readable silhouettes without the toy-block look of the old renderer.
  p.push(tagged(cyl(6, 0.33, 0.25), 1, ZONE.shirt, 0, [0, 1.20, 0], [1, 0.54, 0.66]));
  p.push(tagged(cyl(6, 0.26, 0.28), 1, ZONE.pants, 0, [0, 0.91, 0], [1, 0.25, 0.82]));
  p.push(tagged(cyl(5, 0.11, 0.12), 2, ZONE.skin, 0, [0, 1.48, 0], [1, 0.11, 1]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 8, 5), 2, ZONE.skin, 0, [0, 1.61, 0.005], [0.35, 0.40, 0.34]));

  // Limbs are smooth tapered sections. Hands and shoes follow their parent bones.
  p.push(tagged(cyl(5, 0.07, 0.085), 3, ZONE.shirt, 0, [-0.35, 1.22, 0], [1, 0.34, 1]));
  p.push(tagged(cyl(5, 0.07, 0.085), 4, ZONE.shirt, 0, [0.35, 1.22, 0], [1, 0.34, 1]));
  p.push(tagged(cyl(5, 0.055, 0.07), 5, ZONE.skin, 0, [-0.35, 0.91, 0], [1, 0.30, 1]));
  p.push(tagged(cyl(5, 0.055, 0.07), 6, ZONE.skin, 0, [0.35, 0.91, 0], [1, 0.30, 1]));
  p.push(tagged(new THREE.OctahedronGeometry(0.5, 0), 5, ZONE.skin, 0, [-0.35, 0.735, 0], [0.15, 0.18, 0.13]));
  p.push(tagged(new THREE.OctahedronGeometry(0.5, 0), 6, ZONE.skin, 0, [0.35, 0.735, 0], [0.15, 0.18, 0.13]));
  p.push(tagged(cyl(6, 0.105, 0.125), 7, ZONE.pants, 0, [-0.14, 0.68, 0], [1, 0.43, 1]));
  p.push(tagged(cyl(6, 0.105, 0.125), 8, ZONE.pants, 0, [0.14, 0.68, 0], [1, 0.43, 1]));
  p.push(tagged(cyl(6, 0.075, 0.105), 9, ZONE.pants, 0, [-0.14, 0.285, 0], [1, 0.37, 1]));
  p.push(tagged(cyl(6, 0.075, 0.105), 10, ZONE.pants, 0, [0.14, 0.285, 0], [1, 0.37, 1]));
  p.push(tagged(box(0.16), 9, ZONE.shoe, 0, [-0.14, 0.075, 0.055], [0.20, 0.11, 0.34]));
  p.push(tagged(box(0.16), 10, ZONE.shoe, 0, [0.14, 0.075, 0.055], [0.20, 0.11, 0.34]));

  // Emoji-simple face laid just above the head surface and selected from a canvas atlas.
  p.push(tagged(plane(), 2, ZONE.face, 0, [0, 1.61, 0.176], [0.245, 0.245, 1]));

  // Outfit geometry. Fitted extras are cheap and mutually exclusive in the shader.
  p.push(tagged(new THREE.TorusGeometry(0.21, 0.055, 3, 5, Math.PI * 1.75), 1, ZONE.shirt, F_OUTFIT + OUTFIT_ID.hoodie, [0, 1.45, -0.01], [1, 0.78, 0.8], [Math.PI / 2, 0, 0.38]));
  p.push(tagged(cyl(5, 0.36, 0.28), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.suit, [0, 1.19, 0], [1, 0.55, 0.69]));
  p.push(tagged(new THREE.ConeGeometry(0.065, 0.28, 3), 1, ZONE.decal, F_OUTFIT + OUTFIT_ID.suit, [0, 1.29, 0.235], [1, 1, 0.25], [Math.PI, 0, 0]));
  p.push(tagged(cyl(5, 0.345, 0.27), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.vest, [0, 1.18, 0], [1, 0.47, 0.69]));
  p.push(tagged(cyl(5, 0.35, 0.27), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.flannel, [0, 1.19, 0], [1, 0.54, 0.70]));
  p.push(tagged(box(0.05), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.overalls, [0, 1.20, 0.225], [0.35, 0.37, 0.035]));
  p.push(tagged(box(0.03), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.overalls, [-0.17, 1.39, 0.225], [0.055, 0.35, 0.03], [0, 0, -0.16]));
  p.push(tagged(box(0.03), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.overalls, [0.17, 1.39, 0.225], [0.055, 0.35, 0.03], [0, 0, 0.16]));
  p.push(tagged(new THREE.CylinderGeometry(0.31, 0.46, 0.78, 8, 1, true), 1, ZONE.shirt, F_OUTFIT + OUTFIT_ID.robe, [0, 0.83, 0], [1, 1, 0.75]));
  p.push(tagged(box(0.05), 1, ZONE.decal, F_OUTFIT + OUTFIT_ID.jersey, [0, 1.24, 0.225], [0.19, 0.24, 0.018]));
  p.push(tagged(cyl(5, 0.36, 0.28), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.workwear, [0, 1.18, 0], [1, 0.52, 0.70]));
  p.push(tagged(new THREE.TorusGeometry(0.30, 0.025, 3, 6), 1, ZONE.decal, F_OUTFIT + OUTFIT_ID.workwear, [0, 1.19, 0.02], [1, 1, 0.82], [Math.PI / 2, 0, 0]));
  p.push(tagged(cyl(5, 0.38, 0.29), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.raincoat, [0, 1.15, 0], [1, 0.66, 0.74]));
  p.push(tagged(new THREE.TorusGeometry(0.22, 0.06, 3, 5, Math.PI * 1.75), 1, ZONE.accent, F_OUTFIT + OUTFIT_ID.raincoat, [0, 1.46, -0.02], [1, 0.82, 0.8], [Math.PI / 2, 0, 0.38]));
  // Lime back plate for merch hoodies, suggestive of the SLOP script at gameplay scale.
  p.push(tagged(plane(), 1, ZONE.decal, F_MERCH, [0, 1.22, -0.235], [0.32, 0.17, 1], [0, Math.PI, -0.10]));

  // Hair silhouettes.
  p.push(tagged(new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.54), 2, ZONE.hair, F_HAIR + HAIR_ID.crop, [0, 1.685, -0.005], [0.37, 0.28, 0.36]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.62), 2, ZONE.hair, F_HAIR + HAIR_ID.long, [0, 1.67, -0.04], [0.39, 0.33, 0.38]));
  p.push(tagged(box(0.18), 2, ZONE.hair, F_HAIR + HAIR_ID.long, [0, 1.43, -0.13], [0.31, 0.47, 0.11]));
  p.push(tagged(new THREE.OctahedronGeometry(0.5, 0), 2, ZONE.hair, F_HAIR + HAIR_ID.ponytail, [0, 1.62, -0.24], [0.19, 0.34, 0.18]));
  p.push(tagged(new THREE.ConeGeometry(0.10, 0.34, 5), 2, ZONE.hair, F_HAIR + HAIR_ID.mohawk, [0, 1.88, -0.015], [1, 1, 0.48]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.54), 2, ZONE.hair, F_HAIR + HAIR_ID.mullet, [0, 1.685, -0.005], [0.37, 0.28, 0.36]));
  p.push(tagged(box(0.16), 2, ZONE.hair, F_HAIR + HAIR_ID.mullet, [0, 1.47, -0.14], [0.27, 0.34, 0.12]));
  p.push(tagged(new THREE.OctahedronGeometry(0.5, 0), 2, ZONE.hair, F_HAIR + HAIR_ID.bun, [0, 1.79, -0.16], [0.22, 0.22, 0.20]));

  // Hats.
  p.push(tagged(cyl(8, 0.20, 0.23), 2, ZONE.accent, F_HAT + HAT_ID.ballcap, [0, 1.79, 0], [1, 0.14, 1]));
  p.push(tagged(box(0.2), 2, ZONE.accent, F_HAT + HAT_ID.ballcap, [0, 1.77, 0.17], [0.28, 0.035, 0.22], [-0.08, 0, 0]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.57), 2, ZONE.accent, F_HAT + HAT_ID.beanie, [0, 1.78, 0], [0.47, 0.30, 0.43]));
  p.push(tagged(cyl(8, 0.19, 0.22), 2, ZONE.accent, F_HAT + HAT_ID.cowboy, [0, 1.83, 0], [1, 0.22, 1]));
  p.push(tagged(cyl(10, 0.39, 0.39), 2, ZONE.accent, F_HAT + HAT_ID.cowboy, [0, 1.77, 0], [1, 0.035, 0.78]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.56), 2, ZONE.accent, F_HAT + HAT_ID.hardhat, [0, 1.79, 0], [0.49, 0.26, 0.44]));
  p.push(tagged(new THREE.ConeGeometry(0.23, 0.42, 5), 2, ZONE.metal, F_HAT + HAT_ID.tinfoil, [0, 1.96, 0]));
  p.push(tagged(cyl(9, 0.20, 0.25), 2, ZONE.accent, F_HAT + HAT_ID.sunhat, [0, 1.81, 0], [1, 0.15, 1]));
  p.push(tagged(cyl(12, 0.46, 0.46), 2, ZONE.accent, F_HAT + HAT_ID.sunhat, [0, 1.76, 0], [1, 0.028, 0.78]));

  // Props. Handheld props share the right-forearm bone; sign and drum stay on the root.
  p.push(tagged(cyl(5), 6, ZONE.prop, F_PROP + PROP_ID.cigarette, [0.35, 0.69, 0.08], [0.012, 0.15, 0.012], [Math.PI / 2, 0, 0]));
  p.push(tagged(new THREE.SphereGeometry(0.5, 5, 3), 6, ZONE.light, F_PROP + PROP_ID.cigarette, [0.35, 0.69, 0.155], [0.035, 0.035, 0.035]));
  p.push(tagged(cyl(8), 6, ZONE.prop, F_PROP + PROP_ID.beer, [0.35, 0.70, 0.06], [0.065, 0.20, 0.065]));
  p.push(tagged(box(0.15), 6, ZONE.light, F_PROP + PROP_ID.vape, [0.35, 0.70, 0.055], [0.055, 0.17, 0.05]));
  p.push(tagged(box(0.12), 6, ZONE.light, F_PROP + PROP_ID.phone, [0.35, 0.70, 0.055], [0.12, 0.20, 0.025], [-0.18, 0, 0]));
  p.push(tagged(cyl(5), 0, ZONE.prop, F_PROP + PROP_ID.sign, [0.39, 1.42, 0.08], [0.024, 1.25, 0.024]));
  p.push(tagged(box(0.08), 0, ZONE.prop, F_PROP + PROP_ID.sign, [0.39, 1.92, 0.08], [0.66, 0.43, 0.045]));
  p.push(tagged(cyl(10), 0, ZONE.prop, F_PROP + PROP_ID.drum, [0, 1.02, 0.28], [0.25, 0.36, 0.25], [Math.PI / 2, 0, 0]));
  return p;
}

function farPieces(): Piece[] {
  const p: Piece[] = [];
  p.push(tagged(cyl(5, 0.30, 0.23), 1, ZONE.shirt, 0, [0, 1.18, 0], [1, 0.55, 0.62]));
  p.push(tagged(new THREE.OctahedronGeometry(0.17, 0), 2, ZONE.skin, 0, [0, 1.60, 0]));
  p.push(tagged(cyl(4), 3, ZONE.shirt, 0, [-0.32, 1.09, 0], [0.07, 0.56, 0.07]));
  p.push(tagged(cyl(4), 4, ZONE.shirt, 0, [0.32, 1.09, 0], [0.07, 0.56, 0.07]));
  p.push(tagged(cyl(4), 7, ZONE.pants, 0, [-0.13, 0.49, 0], [0.09, 0.82, 0.09]));
  p.push(tagged(cyl(4), 8, ZONE.pants, 0, [0.13, 0.49, 0], [0.09, 0.82, 0.09]));
  return p;
}

function merge(pieces: Piece[]): THREE.BufferGeometry {
  const g = mergeGeometries(pieces.map((p) => p.geometry), false);
  if (!g) throw new Error('Could not build procedural person geometry');
  g.computeBoundingSphere();
  for (const p of pieces) p.geometry.dispose();
  return g;
}

export function buildPersonGeometry(far = false): THREE.BufferGeometry {
  return merge(far ? farPieces() : nearPieces());
}

export function buildFaceAtlas(): THREE.CanvasTexture {
  const cell = 64, cols = 4, rows = 3;
  const canvas = document.createElement('canvas'); canvas.width = cell * cols; canvas.height = cell * rows;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  const styles = ['plain', 'smile', 'scowl', 'sleepy', 'shades', 'glasses', 'mustache', 'beard', 'soyjak', 'wojak', 'blush', 'npc'];
  for (let i = 0; i < styles.length; i++) {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    c.save(); c.translate(x, y); c.strokeStyle = styles[i] === 'npc' ? '#35393c' : '#30231f'; c.fillStyle = c.strokeStyle;
    c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
    if (styles[i] === 'shades') { c.fillRect(10, 19, 19, 12); c.fillRect(35, 19, 19, 12); c.fillRect(28, 22, 8, 4); }
    else if (styles[i] === 'glasses') { c.strokeRect(9, 17, 20, 15); c.strokeRect(35, 17, 20, 15); c.beginPath(); c.moveTo(29, 23); c.lineTo(35, 23); c.stroke(); c.fillRect(16, 22, 3, 3); c.fillRect(43, 22, 3, 3); }
    else if (styles[i] === 'sleepy') { c.beginPath(); c.moveTo(12, 25); c.lineTo(25, 27); c.moveTo(39, 27); c.lineTo(52, 25); c.stroke(); }
    else if (styles[i] === 'wojak') { c.beginPath(); c.arc(19, 25, 5, 0, Math.PI * 2); c.arc(45, 25, 5, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#7bb8df'; c.beginPath(); c.ellipse(49, 34, 3, 7, -0.2, 0, Math.PI * 2); c.fill(); }
    else { c.beginPath(); c.arc(19, 25, styles[i] === 'soyjak' ? 4.5 : 2.8, 0, Math.PI * 2); c.arc(45, 25, styles[i] === 'soyjak' ? 4.5 : 2.8, 0, Math.PI * 2); c.fill(); }
    if (styles[i] === 'smile' || styles[i] === 'blush' || styles[i] === 'npc') { c.beginPath(); c.arc(32, 35, 13, 0.18, Math.PI - 0.18); c.stroke(); }
    else if (styles[i] === 'scowl') { c.beginPath(); c.moveTo(19, 47); c.quadraticCurveTo(32, 35, 45, 47); c.stroke(); }
    else if (styles[i] === 'soyjak') { c.beginPath(); c.ellipse(34, 44, 9, 12, -0.18, 0, Math.PI * 2); c.stroke(); }
    else { c.beginPath(); c.moveTo(24, 44); c.lineTo(41, 44); c.stroke(); }
    if (styles[i] === 'mustache') { c.beginPath(); c.moveTo(18, 39); c.quadraticCurveTo(27, 33, 32, 41); c.quadraticCurveTo(37, 33, 47, 39); c.stroke(); }
    if (styles[i] === 'beard') { c.beginPath(); c.moveTo(17, 37); c.quadraticCurveTo(20, 59, 33, 61); c.quadraticCurveTo(47, 58, 49, 37); c.stroke(); }
    if (styles[i] === 'blush') { c.fillStyle = 'rgba(220,80,90,.62)'; c.beginPath(); c.ellipse(13, 38, 7, 4, 0, 0, Math.PI * 2); c.ellipse(51, 38, 7, 4, 0, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export interface PersonMaterialControl {
  material: THREE.MeshStandardMaterial;
  setNight(value: number): void;
  setLodDistance(value: number): void;
  dispose(): void;
}

const VERTEX_DECLARATIONS = /* glsl */`
attribute vec3 aTag;
attribute vec3 iSkin;
attribute vec3 iShirt;
attribute vec3 iPants;
attribute vec3 iHair;
attribute vec3 iAccent;
attribute vec3 iShape;
attribute vec4 iStyle;
attribute vec4 iMotion;
varying vec3 vCitizenColor;
varying float vCitizenZone;
varying vec2 vCitizenUv;
varying float vCitizenFace;
varying float vCitizenOutfit;
uniform float uLodDistance;
uniform float uFarDistance;
uniform float uFarLod;

vec3 rotateXAt(vec3 p, vec3 pivot, float a) {
  float s = sin(a), c = cos(a); p -= pivot;
  p.yz = mat2(c, -s, s, c) * p.yz; return p + pivot;
}
vec3 rotateZAt(vec3 p, vec3 pivot, float a) {
  float s = sin(a), c = cos(a); p -= pivot;
  p.xy = mat2(c, -s, s, c) * p.xy; return p + pivot;
}
bool featureVisible(float f, float outfit, float hair, float hat, float prop, float merch) {
  if (f < 0.5) return true;
  if (f > 499.5) return merch > 0.5;
  if (f > 399.5) return abs(f - (400.0 + prop)) < 0.25;
  if (f > 299.5) return abs(f - (300.0 + hat)) < 0.25;
  if (f > 199.5) return abs(f - (200.0 + hair)) < 0.25;
  return abs(f - (100.0 + outfit)) < 0.25;
}
`;

const VERTEX_BODY = /* glsl */`
float action = iMotion.x;
float t = iMotion.y;
float s = sin(t), c = cos(t);
float lLeg = 0.0, rLeg = 0.0, lCalf = 0.0, rCalf = 0.0;
float lArm = 0.0, rArm = 0.0, lFore = 0.0, rFore = 0.0;
float lSide = 0.0, rSide = 0.0, torsoPitch = 0.0, torsoRoll = 0.0, crouch = 0.0, bob = 0.0;
float prop = iStyle.w;
float aPart = aTag.x, aZone = aTag.y, aFeature = aTag.z;
int act = int(action + 0.5);
if (act == 0) { lLeg=s*.52; rLeg=-lLeg; lCalf=max(0.0,-s)*.58; rCalf=max(0.0,s)*.58; lArm=-s*.42; rArm=s*.42; bob=abs(c)*.025; }
else if (act == 1) { lLeg=s*.86; rLeg=-lLeg; lCalf=.22+max(0.0,-s)*.88; rCalf=.22+max(0.0,s)*.88; lArm=-s*.72; rArm=s*.72; lFore=.55; rFore=.55; torsoPitch=.16; bob=abs(c)*.055; }
else if (act == 2) { bob=s*.007; torsoRoll=s*.014; }
else if (act == 3) { rArm=-1.48+s*.04; rFore=-.75; torsoRoll=-.035; prop=1.0; }
else if (act == 4) { rArm=-1.43+s*.06; rFore=-.92; prop=2.0; }
else if (act == 5) { rArm=-1.45; rFore=-.82; prop=3.0; }
else if (act == 6) { rArm=-.78+s*.02; rFore=-.72; lArm=-.72; lFore=-.65; torsoPitch=.11; prop=4.0; }
else if (act == 7) { rArm=2.85+s*.08; lArm=2.68-s*.08; rFore=.12; lFore=.12; bob=max(0.0,s)*.035; prop=5.0; }
else if (act == 8) { lLeg=s*.34; rLeg=-s*.34; lSide=.72+c*.42; rSide=-.72+c*.42; lArm=2.0+s*.48; rArm=2.0-s*.48; torsoRoll=s*.16; bob=abs(c)*.05; }
else if (act == 9) { lArm=-.84+max(0.0,s)*.43; rArm=-.84+max(0.0,-s)*.43; lFore=-.64+max(0.0,s)*.52; rFore=-.64+max(0.0,-s)*.52; prop=6.0; bob=s*.015; }
else if (act == 10) { lSide=1.48; rSide=-1.48; lArm=.04*s; rArm=-.04*s; torsoRoll=s*.025; }
else if (act == 11) { crouch=.42; lLeg=-1.42; rLeg=-1.42; lCalf=1.38; rCalf=1.38; lArm=-.52; rArm=-.52; }
else if (act == 13) { crouch=.08+abs(s)*.035; torsoPitch=.15; torsoRoll=s*.08; lArm=-.95-max(0.0,s)*1.15; rArm=-.95-max(0.0,-s)*1.15; lFore=-.58; rFore=-.58; lLeg=-.18; rLeg=.22; }

vec3 q = transformed;
q.x *= iShape.x; q.y *= iShape.y; q.z *= iShape.z;
vec3 hipL=vec3(-.14*iShape.x,.90*iShape.y,0.0), hipR=vec3(.14*iShape.x,.90*iShape.y,0.0);
vec3 kneeL=vec3(-.14*iShape.x,.47*iShape.y,0.0), kneeR=vec3(.14*iShape.x,.47*iShape.y,0.0);
vec3 shoulderL=vec3(-.35*iShape.x,1.39*iShape.y,0.0), shoulderR=vec3(.35*iShape.x,1.39*iShape.y,0.0);
vec3 elbowL=vec3(-.35*iShape.x,1.05*iShape.y,0.0), elbowR=vec3(.35*iShape.x,1.05*iShape.y,0.0);
if (aPart > 8.5) q = rotateXAt(q, aPart < 9.5 ? kneeL : kneeR, aPart < 9.5 ? lCalf : rCalf);
if (aPart > 6.5 && aPart < 10.5) q = rotateXAt(q, aPart < 8.5 || (aPart > 8.5 && aPart < 9.5) ? hipL : hipR, (aPart < 7.5 || (aPart > 8.5 && aPart < 9.5)) ? lLeg : rLeg);
if (aPart > 4.5 && aPart < 6.5) q = rotateXAt(q, aPart < 5.5 ? elbowL : elbowR, aPart < 5.5 ? lFore : rFore);
if (aPart > 2.5 && aPart < 6.5) {
  bool left = aPart < 3.5 || (aPart > 4.5 && aPart < 5.5);
  q = rotateXAt(q, left ? shoulderL : shoulderR, left ? lArm : rArm);
  q = rotateZAt(q, left ? shoulderL : shoulderR, left ? lSide : rSide);
}
if (aPart > .5 && aPart < 2.5) { q = rotateXAt(q, vec3(0,.91*iShape.y,0), torsoPitch); q = rotateZAt(q, vec3(0,.91*iShape.y,0), torsoRoll); }
q.y -= crouch;
q.y += bob;
if (act == 12) q = rotateXAt(q, vec3(0,.13,0), 1.5707963 + .05*s);

float merch = iMotion.w;
bool showFeature = featureVisible(aFeature, iStyle.x, iStyle.y, iStyle.z, prop, merch);
vec3 citizenCenter = (modelMatrix * instanceMatrix * vec4(0,0,0,1)).xyz;
float citizenDistance = distance(cameraPosition, citizenCenter);
bool showLod = uFarLod > .5 ? (citizenDistance > uLodDistance && citizenDistance < uFarDistance) : (citizenDistance <= uLodDistance);
if (!showFeature || !showLod) q = vec3(0.0);
transformed = q;

vCitizenZone = aZone;
vCitizenUv = uv;
vCitizenFace = iMotion.z;
vCitizenOutfit = iStyle.x;
vCitizenColor = iShirt;
if (aZone < 1.5) vCitizenColor=iSkin;
else if (aZone < 2.5) vCitizenColor=iShirt;
else if (aZone < 3.5) vCitizenColor=iPants;
else if (aZone < 4.5) vCitizenColor=vec3(.045,.05,.055);
else if (aZone < 5.5) vCitizenColor=iHair;
else if (aZone < 6.5) vCitizenColor=iAccent;
else if (aZone < 7.5) vCitizenColor=iSkin;
else if (aZone < 8.5) vCitizenColor=vec3(.42,.24,.10);
else if (aZone < 9.5) vCitizenColor=vec3(.55,.72,.82);
else if (aZone < 10.5) vCitizenColor=vec3(.776,.957,.196);
else vCitizenColor=vec3(.64,.68,.71);
// Bare upper arms for tank tops.
if (iStyle.x > 3.5 && iStyle.x < 4.5 && (aPart > 2.5 && aPart < 4.5)) vCitizenColor=iSkin;
// Cheap plaid survives distance better than a tiny texture.
if (iStyle.x > 4.5 && iStyle.x < 5.5 && aZone > 5.5 && aZone < 6.5) {
  float plaid = step(.55, fract((position.y+position.x)*18.0)) * .16 + step(.72,fract(position.y*31.0))*.12;
  vCitizenColor *= 1.0-plaid;
}
`;

const FRAGMENT_DECLARATIONS = /* glsl */`
varying vec3 vCitizenColor;
varying float vCitizenZone;
varying vec2 vCitizenUv;
varying float vCitizenFace;
varying float vCitizenOutfit;
uniform sampler2D uFaceAtlas;
uniform float uNight;
`;

export function createPersonMaterial(faceAtlas: THREE.Texture, far: boolean): PersonMaterialControl {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.025 });
  const uniforms = { uFaceAtlas: { value: faceAtlas }, uNight: { value: 0 }, uLodDistance: { value: 72 }, uFarDistance: { value: 1500 }, uFarLod: { value: far ? 1 : 0 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n
        diffuseColor.rgb *= vCitizenColor;
        if (vCitizenZone > 6.5 && vCitizenZone < 7.5) {
          float faceIndex = floor(vCitizenFace + .5);
          vec2 faceCell = vec2(mod(faceIndex, 4.0), floor(faceIndex / 4.0));
          vec2 faceUv = (vec2(vCitizenUv.x, 1.0-vCitizenUv.y) + faceCell) / vec2(4.0,3.0);
          vec4 ink = texture2D(uFaceAtlas, faceUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, ink.a);
        }
      `)
      .replace('vec3 totalEmissiveRadiance = emissive;', `vec3 totalEmissiveRadiance = emissive;
        if (vCitizenZone > 8.5 && vCitizenZone < 9.5) {
          totalEmissiveRadiance += vCitizenColor * (0.15 + uNight * 4.5);
        }
      `);
  };
  material.customProgramCacheKey = () => `slop-person-aa-${far ? 'far' : 'near'}-3`;
  return {
    material,
    setNight(value: number) { uniforms.uNight.value = THREE.MathUtils.clamp(value, 0, 1); },
    setLodDistance(value: number) { uniforms.uLodDistance.value = value; },
    dispose() { material.dispose(); },
  };
}

/** Shadow pass companion: same bones and feature masks, without view-camera LOD tests. */
export function createPersonDepthMaterial(): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial();
  const uniforms = { uLodDistance: { value: 1e7 }, uFarDistance: { value: 1e7 }, uFarLod: { value: 0 } };
  const depthBody = VERTEX_BODY.replace(
    'bool showLod = uFarLod > .5 ? (citizenDistance > uLodDistance && citizenDistance < uFarDistance) : (citizenDistance <= uLodDistance);',
    'bool showLod = true;',
  );
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${depthBody}`);
  };
  material.customProgramCacheKey = () => 'slop-person-aa-depth-1';
  return material;
}

export interface PersonInstanceAttributes {
  skin: THREE.InstancedBufferAttribute;
  shirt: THREE.InstancedBufferAttribute;
  pants: THREE.InstancedBufferAttribute;
  hair: THREE.InstancedBufferAttribute;
  accent: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  style: THREE.InstancedBufferAttribute;
  motion: THREE.InstancedBufferAttribute;
  all: THREE.InstancedBufferAttribute[];
}

export function attachPersonInstanceAttributes(geometry: THREE.BufferGeometry, max: number): PersonInstanceAttributes {
  const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(max * size), size).setUsage(THREE.DynamicDrawUsage);
  const result: PersonInstanceAttributes = {
    skin: attr(3), shirt: attr(3), pants: attr(3), hair: attr(3), accent: attr(3), shape: attr(3), style: attr(4), motion: attr(4), all: [],
  };
  result.all = [result.skin, result.shirt, result.pants, result.hair, result.accent, result.shape, result.style, result.motion];
  geometry.setAttribute('iSkin', result.skin); geometry.setAttribute('iShirt', result.shirt); geometry.setAttribute('iPants', result.pants);
  geometry.setAttribute('iHair', result.hair); geometry.setAttribute('iAccent', result.accent); geometry.setAttribute('iShape', result.shape);
  geometry.setAttribute('iStyle', result.style); geometry.setAttribute('iMotion', result.motion);
  return result;
}

export function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
