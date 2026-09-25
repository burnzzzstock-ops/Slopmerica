// Sky dome, sun/moon, fog, stars and the day/night cycle.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { MapDef } from './maps';
import type { Quality } from '../config';

export class Environment {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  readonly fog: THREE.FogExp2;
  /** 0..24 hour of day */
  hour = 15.5;
  /** 0 day .. 1 full night */
  night = 0;
  lightPollution = 0;
  private sunDir = new THREE.Vector3();
  private fogDay: THREE.Color;
  private fogNight = new THREE.Color(0x0b1020);
  private fogDusk = new THREE.Color(0xd08a6a);

  constructor(private scene: THREE.Scene, private def: MapDef, q: Quality) {
    this.sky.scale.setScalar(90000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = def.sky.turbidity;
    u.rayleigh.value = def.sky.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.fogDay = new THREE.Color(def.sky.fog);
    this.fog = new THREE.FogExp2(def.sky.fog, def.sky.fogDensity);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(def.sky.hemiSky, def.sky.hemiGround, 1.1);
    scene.add(this.hemi);

    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = 5000;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // stars
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.9 + 0.1);
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * 40000;
      pos[i * 3 + 1] = Math.cos(ph) * 40000;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 40000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);
  }

  /** Advance clock (hours) and update lighting; focus = camera target for shadow box. */
  update(dtHours: number, focus: THREE.Vector3, viewDist: number) {
    this.hour = (this.hour + dtHours) % 24;
    const h = this.hour;
    // sun path: rises 6, sets 20
    const dayT = (h - 6) / 14; // 0..1 across daylight
    const elev = Math.sin(Math.PI * dayT) * 62; // degrees
    const azim = -100 + dayT * 200;
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    const daylight = THREE.MathUtils.smoothstep(elev, -6, 10); // 0 night .. 1 day
    this.night = 1 - daylight;
    const dusk = Math.max(0, 1 - Math.abs(elev - 4) / 12) * (elev > -8 ? 1 : 0);

    // Directional light follows the sun by day and a pale moon by night
    const lightDir = daylight > 0.05 ? this.sunDir.clone() : new THREE.Vector3(-0.4, 0.8, 0.3).normalize();
    const shadowSize = THREE.MathUtils.clamp(viewDist * 0.75, 90, 1400);
    this.sun.position.copy(focus).addScaledVector(lightDir, 2500);
    this.sun.target.position.copy(focus);
    const cam = this.sun.shadow.camera;
    if (cam.right !== shadowSize) {
      cam.left = cam.bottom = -shadowSize;
      cam.right = cam.top = shadowSize;
      cam.updateProjectionMatrix();
    }
    const warm = new THREE.Color(1, 0.93, 0.82).lerp(new THREE.Color(1, 0.55, 0.3), dusk * 0.8);
    this.sun.color.copy(daylight > 0.05 ? warm : new THREE.Color(0.55, 0.65, 1));
    this.sun.intensity = daylight > 0.05 ? 0.4 + daylight * 2.8 : 0.35;
    this.hemi.intensity = 0.25 + daylight * 0.95;

    const fc = this.fogDay.clone().lerp(this.fogDusk, dusk * 0.5).lerp(this.fogNight, this.night);
    this.fog.color.copy(fc);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.3) * (1 - this.lightPollution * 0.85) * 1.4;
    this.stars.position.copy(focus);
    this.scene.background = null;
    this.sky.material.uniforms.rayleigh.value = this.def.sky.rayleigh * (0.4 + daylight * 0.6);
  }

  get sunDirection() {
    return this.sunDir;
  }
}
