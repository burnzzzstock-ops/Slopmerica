// A drifting cloud deck. Uses the same density function as the cloud shadows
// on the ground, so the shadows sit exactly under the clouds. It fades away as
// the camera climbs toward it, so zoomed-out views stay clear.
import * as THREE from 'three';
import { ATMOS, bindAtmos, CLOUD_GLSL } from './atmos';

export class CloudLayer {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.6, 0.7, 0.85) }, uNight: { value: 0 }, uDark: { value: 0 }, uFlash: { value: 0 } },
      ]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        ${CLOUD_GLSL}
        uniform vec3 uSunCol, uSkyCol;
        uniform float uNight, uDark, uFlash;
        varying vec3 vW;
        void main() {
          float d = cloudDensity(vW.xz);
          if (d < 0.01) discard;
          vec2 toSun = normalize(uSunDirW.xz + 1e-4);
          float d2 = cloudDensity(vW.xz + toSun * 260.0);
          float lit = clamp(1.0 - d2 * 0.8 + (1.0 - d) * 0.3, 0.0, 1.0);
          vec3 base = mix(uSkyCol, vec3(1.0), 0.55);
          vec3 col = mix(base * 0.5, uSunCol * 1.15 + base * 0.2, lit);
          col *= 1.0 - uDark * 0.62;
          col = mix(col, vec3(0.03, 0.035, 0.05), uNight * 0.9);
          col += uFlash * vec3(0.9, 0.92, 1.0);
          float dist = length(vW.xz - cameraPosition.xz);
          float fade = 1.0 - smoothstep(16000.0, 34000.0, dist);
          fade *= 1.0 - smoothstep(uCloudH - 1500.0, uCloudH - 350.0, cameraPosition.y);
          float alpha = smoothstep(0.0, 0.6, d) * 0.94 * fade;
          #ifdef USE_FOG
          col = mix(col, fogColor, smoothstep(5000.0, 30000.0, dist) * 0.75);
          #endif
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // ShaderMaterial clones merged uniforms; point the cloud ones back at the shared objects
    bindAtmos(this.mat);
    const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = ATMOS.uCloudH.value;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  update(sunCol: THREE.Color, skyCol: THREE.Color, night: number, dark: number, flash: number) {
    const u = this.mat.uniforms;
    u.uSunCol.value.copy(sunCol);
    u.uSkyCol.value.copy(skyCol);
    u.uNight.value = night;
    u.uDark.value = dark;
    u.uFlash.value = flash;
    this.mesh.position.y = ATMOS.uCloudH.value;
    this.mesh.visible = ATMOS.uCloudCover.value > 0.02;
  }
}
