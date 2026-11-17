// A bounded visual state of heavily polluted water, never a disaster producer.
import * as THREE from 'three';
import { HALF, HM_N, WATER, WORLD } from '../config';
import type { WorldFields } from '../contracts';
import type { Terrain } from './terrain';
import { RIVER_FIRE_THRESHOLD } from './waterFields';

const CAP = 64;
export class RiverFire {
  readonly mesh: THREE.Mesh;
  private candidates: { x: number; z: number }[] = [];
  private selected: { x: number; z: number; pollution: number }[] = [];
  private centers = new Float32Array(CAP * 3);
  private strength = new Float32Array(CAP);
  constructor(private terrain: Terrain, time: THREE.IUniform, night: THREE.IUniform, level: THREE.IUniform) {
    for (const path of terrain.map.rivers) for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(length / 24));
      for (let j = 0; j < steps; j++) {
        const t = (j + .5) / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (Math.abs(x) < HALF && Math.abs(z) < HALF && terrain.h(x, z) < WATER - .3) this.candidates.push({ x, z });
      }
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.attributes = plane.attributes;
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aStrength', new THREE.InstancedBufferAttribute(this.strength, 1).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHeight: { value: null } }]),
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 aCenter;
        attribute float aStrength;
        uniform float uTime, uLevel;
        uniform sampler2D uHeight;
        varying vec2 vUv;
        varying float vStrength, vSeed;
        void main() {
          vUv = uv;
          vec3 seed = fract(aCenter.xzx * .1031);
          seed += dot(seed, seed.yzx + 33.33);
          vSeed = fract((seed.x + seed.y) * seed.z);
          vec2 huv = ((aCenter.xz + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)}) * ${((HM_N - 1) / HM_N).toFixed(8)} + ${(0.5 / HM_N).toFixed(8)};
          vStrength = aStrength * step(texture2D(uHeight, huv).r, ${WATER.toFixed(1)} + uLevel - .15);
          vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
          right = normalize(right);
          float flicker = .87 + .13 * sin(uTime * 7.0 + vSeed * 30.0);
          vec3 p = aCenter + right * position.x * (4.0 + aStrength * 6.0);
          p.y = .12 + (position.y + .5) * (1.2 + aStrength * 3.0) * flicker;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uNight;
        varying vec2 vUv;
        varying float vStrength, vSeed;
        void main() {
          float sway = sin(vUv.y * 8.0 - uTime * 4.0 + vSeed * 12.0) * .12 * vUv.y;
          float body = 1.0 - abs((vUv.x + sway - .5) * 2.0);
          float tongues = sin(vUv.x * 27.0 + uTime * 5.0 + vSeed * 16.0) * .08;
          float a = smoothstep(vUv.y * .85, vUv.y * .85 + .3, body + tongues) * (1.0 - smoothstep(.55, 1.0, vUv.y));
          a *= smoothstep(0.0, .08, vUv.y) * vStrength * .85;
          if (a < .015) discard;
          vec3 col = mix(vec3(1.6, .19, .025), vec3(2.8, 1.1, .12), (1.0 - vUv.y) * body);
          col *= mix(1.0, .75, uNight);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uHeight.value = terrain.heightTex;
    mat.uniforms.uTime = time;
    mat.uniforms.uNight = night;
    mat.uniforms.uLevel = level;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }
  update(fields: WorldFields) {
    const selected = this.selected;
    selected.length = 0;
    for (const p of this.candidates) {
      const pollution = fields.pollutionAt(p.x, p.z);
      if (!Number.isFinite(pollution) || pollution <= RIVER_FIRE_THRESHOLD || this.terrain.h(p.x, p.z) >= WATER - .15) continue;
      let i = selected.length;
      if (i === CAP && pollution <= selected[i - 1].pollution) continue;
      while (i > 0 && pollution > selected[i - 1].pollution) i--;
      selected.splice(i, 0, { x: p.x, z: p.z, pollution });
      if (selected.length > CAP) selected.pop();
    }
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      this.centers[i * 3] = p.x;
      this.centers[i * 3 + 1] = 0;
      this.centers[i * 3 + 2] = p.z;
      this.strength[i] = Math.min(1, (p.pollution - RIVER_FIRE_THRESHOLD) / 1.4);
    }
    const geo = this.mesh.geometry as THREE.InstancedBufferGeometry;
    geo.instanceCount = selected.length;
    geo.attributes.aCenter.needsUpdate = geo.attributes.aStrength.needsUpdate = true;
    this.mesh.visible = selected.length > 0;
  }
  get count() { return (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
