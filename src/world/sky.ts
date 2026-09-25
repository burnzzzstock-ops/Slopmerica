// Sky dome, sun/moon, fog, stars and the day/night cycle. The sky is also
// rendered into a PMREM environment map (refreshed as the sun moves or the
// weather changes) so every standard material gets sky-colored ambient light
// and reflections. The weather system drives overcast, fog, smoke and flashes.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { MapDef } from './maps';
import type { Quality } from '../config';
import { ATMOS } from './atmos';

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
  // ---- weather inputs (written by WeatherSystem)
  overcast = 0;
  fogMul = 1;
  /** wildfire smoke 0..1 */
  smoke = 0;
  /** heat haze 0..1 */
  haze = 0;
  /** lightning flash 0..1 */
  flash = 0;
  /** extra fog whiteness for snow/blizzard 0..1 */
  whiteout = 0;

  private sunDir = new THREE.Vector3();
  private fogDay: THREE.Color;
  private fogNight = new THREE.Color(0x0b1020);
  private fogDusk = new THREE.Color(0xd08a6a);
  private overcastDome: THREE.Mesh;
  private domeMat: THREE.MeshBasicMaterial;
  private pmrem?: THREE.PMREMGenerator;
  private envRT?: THREE.WebGLRenderTarget;
  private envScene?: THREE.Scene;
  private envMat?: THREE.ShaderMaterial;
  private envKey = '';
  private envT = 0;
  private hemiBase: number;
  readonly sunColor = new THREE.Color();

  constructor(private scene: THREE.Scene, private def: MapDef, q: Quality, private renderer?: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(90000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = def.sky.turbidity;
    u.rayleigh.value = def.sky.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    // overcast / smoke veil over the sky dome (only the sky: it sits behind all terrain)
    this.domeMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, side: THREE.BackSide, fog: false, depthWrite: false });
    this.overcastDome = new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 16), this.domeMat);
    this.overcastDome.renderOrder = -1;
    this.overcastDome.frustumCulled = false;
    scene.add(this.overcastDome);

    this.fogDay = new THREE.Color(def.sky.fog);
    this.fog = new THREE.FogExp2(def.sky.fog, def.sky.fogDensity);
    scene.fog = this.fog;

    this.hemiBase = renderer ? 0.55 : 1.1;
    this.hemi = new THREE.HemisphereLight(def.sky.hemiSky, def.sky.hemiGround, this.hemiBase);
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
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * 38000;
      pos[i * 3 + 1] = Math.cos(ph) * 38000;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 38000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    if (renderer) {
      // Image-based lighting from a controlled gradient sky (zenith / horizon /
      // ground bounce + a soft sun glow). The physical Sky shader's HDR horizon
      // is far too hot to light with directly.
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.envScene = new THREE.Scene();
      this.envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
        },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            vec3 c = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -d.y));
            c += uSunCol * (pow(max(dot(d, uSunDir), 0.0), 24.0) * 0.8 + pow(max(dot(d, uSunDir), 0.0), 4.0) * 0.15);
            gl_FragColor = vec4(c, 1.0);
          }`,
      });
      this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.envMat));
      scene.environmentIntensity = 1;
    }
  }

  /** Advance clock (hours) and update lighting; focus = camera target for shadow box. */
  update(dtHours: number, focus: THREE.Vector3, viewDist: number, camPos?: THREE.Vector3) {
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
    const oc = this.overcast;

    // Directional light follows the sun by day and a pale moon by night
    const lightDir = daylight > 0.05 ? this.sunDir.clone() : new THREE.Vector3(-0.4, 0.8, 0.3).normalize();
    ATMOS.uSunDirW.value.copy(lightDir);
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
    if (this.smoke > 0) warm.lerp(new THREE.Color(1, 0.45, 0.2), this.smoke * 0.7);
    this.sunColor.copy(daylight > 0.05 ? warm : new THREE.Color(0.55, 0.65, 1));
    this.sun.color.copy(this.sunColor);
    const sunI = daylight > 0.05 ? 0.4 + daylight * 2.8 : 2.2; // moonlight at night (artistic, not physical)
    this.sun.intensity = sunI * (1 - oc * 0.78) * (1 - this.smoke * 0.45) + this.flash * 4;
    this.hemi.intensity = ((this.hemiBase / 1.1) * 1.2 * daylight + this.night * 0.7) * (1 + oc * 0.35) + this.flash * 2.5;
    this.hemi.color.set(this.def.sky.hemiSky).lerp(new THREE.Color(0.35, 0.45, 0.8), this.night);
    this.hemi.groundColor.set(this.def.sky.hemiGround).lerp(new THREE.Color(0.08, 0.1, 0.14), this.night);

    // fog: denser and grayer with weather, orange in smoke, white in snow
    const fc = this.fogDay.clone().lerp(this.fogDusk, dusk * 0.5);
    fc.lerp(new THREE.Color(0x8d939b), oc * 0.7);
    if (this.whiteout > 0) fc.lerp(new THREE.Color(0xdfe3ea), this.whiteout * 0.8);
    if (this.smoke > 0) fc.lerp(new THREE.Color(0xb07a4a), this.smoke * 0.85);
    if (this.haze > 0) fc.lerp(new THREE.Color(0xd8cfb0), this.haze * 0.5);
    fc.lerp(this.fogNight, this.night);
    fc.lerp(new THREE.Color(0xc8d0ff), this.flash * 0.6);
    this.fog.color.copy(fc);
    this.fog.density = this.def.sky.fogDensity * this.fogMul * (1 + this.haze * 0.6);

    // veil: overcast gray / smoke brown / snow white, darker at night
    const veil = new THREE.Color(0x9aa0a8).lerp(new THREE.Color(0xd9dde4), this.whiteout * 0.7).lerp(new THREE.Color(0xa06a3c), this.smoke * 0.8);
    veil.lerp(new THREE.Color(0x0d1018), this.night * 0.92).lerp(new THREE.Color(0xdde2ff), this.flash);
    veil.multiplyScalar(0.55 + daylight * 0.45);
    this.domeMat.color.copy(veil);
    this.domeMat.opacity = Math.min(0.93, oc * 0.95 + this.smoke * 0.55 + this.haze * 0.15);
    this.overcastDome.position.copy(camPos ?? focus);

    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.3) * (1 - this.lightPollution * 0.85) * (1 - oc) * 1.4;
    this.stars.position.copy(camPos ?? focus);
    this.scene.background = null;
    const su = this.sky.material.uniforms;
    su.rayleigh.value = this.def.sky.rayleigh * (0.4 + daylight * 0.6) * (1 - oc * 0.5);
    su.turbidity.value = this.def.sky.turbidity + oc * 6 + this.smoke * 8 + this.haze * 4;
    su.mieCoefficient.value = 0.004 + this.smoke * 0.02 + this.haze * 0.006;

    this.refreshEnv();
  }

  /** Re-bake the image-based lighting when the sky has changed enough. */
  private refreshEnv() {
    if (!this.pmrem || !this.envScene) return;
    const now = performance.now();
    const key = `${Math.round(this.hour * 5)}|${Math.round(this.overcast * 12)}|${Math.round(this.smoke * 8)}|${Math.round(this.whiteout * 6)}`;
    if (key === this.envKey || now - this.envT < 1200) return;
    this.envKey = key;
    this.envT = now;
    const day = 1 - this.night, oc = this.overcast;
    const u = this.envMat!.uniforms;
    u.uZenith.value.set(this.def.sky.hemiSky).multiplyScalar(0.7).lerp(new THREE.Color(0.32, 0.33, 0.35), oc * 0.8).multiplyScalar(0.04 + day * 0.96);
    if (day < 0.5) u.uZenith.value.lerp(new THREE.Color(0.05, 0.07, 0.14), 1 - day * 2); // moonlit blue
    u.uHorizon.value.copy(this.fog.color).multiplyScalar(0.85);
    u.uGround.value.set(this.def.sky.hemiGround).multiplyScalar(0.35 * (0.05 + day * 0.95));
    u.uSunDir.value.copy(this.sunDir);
    u.uSunCol.value.copy(this.sunColor).multiplyScalar(day * (1 - oc * 0.85) * 1.2);
    const prevTarget = this.renderer!.getRenderTarget();
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200, { size: 64 });
    this.renderer!.setRenderTarget(prevTarget);
    this.scene.environment = rt.texture;
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environmentIntensity = 1;
  }

  get sunDirection() {
    return this.sunDir;
  }
}
