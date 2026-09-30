import * as THREE from 'three';
import {
  buildPieces, mergePieces, bitNames, PROP, type LodName, type Piece,
} from './personGeo';
import {
  FRAGMENT_BODY, FRAGMENT_DECLARATIONS, FRAGMENT_LIB, POSE_SAMPLER_DECLARATIONS, VERTEX_DECLARATIONS, VERTEX_LIB,
} from './personShader';
import { poseSupported, type PoseUniforms } from './personPose';
import type { PersonLook } from './personLooks';

// One procedural citizen is instanced for the whole population (two draw calls: near and far). The geometry is a set of small
// pieces in the rest pose (personGeo.ts); the vertex shader poses a skeleton on the GPU, hides the pieces a person does not
// wear, and the fragment shader paints cloth from the rest position (personShader.ts). What one person wears comes from
// personLooks.ts. This file builds the geometry and materials and lays out the per-instance attributes.

export { PROP } from './personGeo';
export { PED_STRIDE } from './personShader';

export function personLodList(): { id: LodName; far: boolean }[] { return [{ id: 'near', far: false }, { id: 'far', far: true }]; }

/** far = true (or 'far') for the distant figure */
export function buildPersonGeometry(lod: LodName | boolean = 'near'): THREE.BufferGeometry {
  const id: LodName = lod === true || lod === 'far' ? 'far' : 'near';
  return mergePieces(buildPieces(id));
}

/** triangles a person with these look bits and base prop shows at a level of detail (the rest collapse in the vertex shader) */
export function shownTriangles(lod: LodName, bits: readonly string[], baseProp: number, sitting = false): number {
  const names = bitNames();
  const on = new Set(bits);
  let t = 0;
  for (const p of buildPieces(lod)) {
    const f = p.feature;
    const shown = f === 0 || (f >= 200 ? sitting && f - 200 === 1 : f >= 100 ? f - 100 === baseProp : on.has(names[f - 1]));
    if (shown) t += (p.geometry.index?.count ?? p.geometry.getAttribute('position').count) / 3;
  }
  return t;
}
export function pieceList(lod: LodName): Piece[] { return buildPieces(lod); }

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
  texture.flipY = false; // the shader reads the canvas top-down
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export interface PersonMaterialControl {
  material: THREE.MeshStandardMaterial;
  setNight(value: number): void;
  setLodDistance(value: number): void;
  dispose(): void;
}

const VERTEX_INJECT = `${VERTEX_DECLARATIONS}\n${POSE_SAMPLER_DECLARATIONS}\n${VERTEX_LIB}`;
/** the poses come from the pose pass (personPose.ts) when the renderer can write float textures, else the vertex shader works them out */
const poseDefine = (renderer: THREE.WebGLRenderer | undefined): string => (renderer && poseSupported(renderer) ? '#define CITIZEN_POSE_TEX\n' : '');
const VARYINGS = /* glsl */`
  {
    int i1 = int(iLook.x + 0.5), i2 = int(iLook.y + 0.5);
    vZP = vec4(aTag.y, aTag.x, aTag.z, aTag.w);
    vRest = position;
    vColA = iColA; vColB = iColB;
    vLookA = vec4(float(i1 & 31), float((i1 >> 5) & 3), float((i1 >> 7) & 7), float((i1 >> 23) & 1));
    vLookB = vec4(float((i1 >> 13) & 15), float((i1 >> 17) & 7), float((i1 >> 20) & 7), float(((i2 >> 19) & 15) * 8 + ((i1 >> 10) & 7)));
    vLookC = vec4(iLook.w, iMaskA.w, iLook.z, iMotion.x);
  }
`;

export function createPersonMaterial(faceAtlas: THREE.Texture, far: boolean, pose: PoseUniforms): PersonMaterialControl {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.02 });
  const uniforms = { uFaceAtlas: { value: faceAtlas }, uNight: { value: 0 }, uLodDistance: { value: 64 }, uFarDistance: { value: 1500 }, uFarLod: { value: far ? 1 : 0 } };
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms, pose);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${poseDefine(renderer)}${VERTEX_INJECT}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vec3 cPos = vec3(0.0);\n  citizenDeform(objectNormal, cPos);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed = cPos;\n${VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}\n${FRAGMENT_LIB}\n${FRAGMENT_BODY}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cEmis = vec3(0.0);
        diffuseColor.rgb *= citizenColor(cEmis);
        totalEmissiveRadiance += cEmis;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = gMetal;');
  };
  material.customProgramCacheKey = () => 'slop-person-rig-2'; // near and far are the same program with different uniforms: compile it once
  return {
    material,
    setNight(value: number) { uniforms.uNight.value = THREE.MathUtils.clamp(value, 0, 1); },
    setLodDistance(value: number) { uniforms.uLodDistance.value = value; },
    dispose() { material.dispose(); },
  };
}

/** Shadow pass companion: the same pose and feature masks, without the view camera's level-of-detail test. */
export function createPersonDepthMaterial(pose: PoseUniforms): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial();
  const uniforms = { uLodDistance: { value: 1e7 }, uFarDistance: { value: 1e7 }, uFarLod: { value: 0 } };
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms, pose);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n#define CITIZEN_DEPTH\n${poseDefine(renderer)}${VERTEX_INJECT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec3 cNormal = vec3(0.0, 1.0, 0.0);\n  vec3 cPos = vec3(0.0);\n  citizenDeform(cNormal, cPos);\n  transformed = cPos;');
  };
  material.customProgramCacheKey = () => 'slop-person-rig-depth-2';
  return material;
}

export interface PersonInstanceAttributes {
  colA: THREE.InstancedBufferAttribute;
  colB: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  build: THREE.InstancedBufferAttribute;
  mask: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  motion: THREE.InstancedBufferAttribute;
  /** every attribute but the motion one, which changes every frame */
  style: THREE.InstancedBufferAttribute[];
}

export function attachPersonInstanceAttributes(geometry: THREE.BufferGeometry, max: number): PersonInstanceAttributes {
  const attr = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const r: PersonInstanceAttributes = { colA: attr(), colB: attr(), shape: attr(), build: attr(), mask: attr(), look: attr(), motion: attr(), style: [] };
  r.style = [r.colA, r.colB, r.shape, r.build, r.mask, r.look];
  geometry.setAttribute('iColA', r.colA); geometry.setAttribute('iColB', r.colB); geometry.setAttribute('iShape', r.shape);
  geometry.setAttribute('iBuild', r.build); geometry.setAttribute('iMaskA', r.mask); geometry.setAttribute('iLook', r.look);
  geometry.setAttribute('iMotion', r.motion);
  return r;
}

export function writeLook(at: PersonInstanceAttributes, h: number, l: PersonLook): void {
  at.colA.setXYZW(h, l.colA[0], l.colA[1], l.colA[2], l.colA[3]);
  at.colB.setXYZW(h, l.colB[0], l.colB[1], l.colB[2], l.colB[3]);
  at.shape.setXYZW(h, l.shape[0], l.shape[1], l.shape[2], l.shape[3]);
  at.build.setXYZW(h, l.build[0], l.build[1], l.build[2], l.build[3]);
  at.mask.setXYZW(h, l.maskA, l.maskB, l.maskC, l.seed01);
  at.look.setXYZW(h, l.ints1, l.ints2, l.ints3, l.face);
}

export function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

export const PROP_ID = PROP;
