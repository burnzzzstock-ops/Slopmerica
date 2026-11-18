import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { Quality } from '../config';
import { withVisualRandom } from './visualRandom';

const managers = new WeakMap<THREE.Scene, CascadeShadows>();
const litTypes = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial']);
let installed = false;

/** Keep material-specific atlas, foliage, lamp and clipping hooks intact.
 * Binding at draw time also covers assets streamed into nested groups. */
function installMaterialHook() {
  if (installed) return;
  const previous = THREE.Material.prototype.onBeforeRender;
  THREE.Material.prototype.onBeforeRender = function (...args) {
    previous.apply(this, args);
    managers.get(args[1])?.bindMaterial(this);
  };
  installed = true;
}

/** Camera-frustum cascades share one directional light's colour and energy.
 * The original light remains the public weather/grade control. */
export class CascadeShadows {
  private csm!: CSM;
  private materials = new Set<THREE.Material>();
  private projection = new THREE.Matrix4();
  private shadowView = new THREE.Matrix4();
  private focusDistance = -1;
  private lightFrame = new THREE.Matrix4();
  private inverseLightFrame = new THREE.Matrix4();
  private origin = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private point = new THREE.Vector3();
  private uniforms = {
    CSM_cascades: { value: [] as THREE.Vector2[] },
    cameraNear: { value: .5 },
    shadowFar: { value: 6000 },
    uCSMViewToShadow: { value: new THREE.Matrix4() },
  };

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private sun: THREE.DirectionalLight, private quality: Quality) {
    installMaterialHook();
    managers.set(scene, this);
    this.createCascades();
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      previous.apply(scene, args);
      // Planar reflections reuse the main view's world-space shadow maps.
      if (args[0].shadowMap.autoUpdate && (args[2] as THREE.PerspectiveCamera).isPerspectiveCamera) {
        this.update(args[2] as THREE.PerspectiveCamera);
        this.uniforms.uCSMViewToShadow.value.identity();
      } else {
        this.uniforms.uCSMViewToShadow.value.multiplyMatrices(this.shadowView, args[2].matrixWorld);
      }
    };
  }

  private createCascades() {
    const low = this.quality.name === 'low';
    this.csm = withVisualRandom(() => new CSM({
      camera: this.camera, parent: this.scene, cascades: low ? 2 : 3,
      maxFar: this.quality.name === 'ultra' ? 10000 : 7000,
      mode: 'custom', shadowMapSize: this.quality.shadowMap,
      shadowBias: -.00015, lightNear: 1, lightFar: 10000, lightMargin: 1600,
      customSplitsCallback: (count, near, far, breaks) => {
        const focus = Math.max(100, this.focusDistance);
        const first = low ? THREE.MathUtils.clamp(focus * 1.3, 260, 2400) : THREE.MathUtils.clamp(focus * .85, 180, 1800);
        breaks.push(Math.min(.8, Math.max(near + 1, first) / far));
        if (count === 3) breaks.push(Math.min(.95, Math.max(first + 100, focus * 1.8, 850) / far));
        breaks.push(1);
      },
    }));
    this.csm.fade = true;
    this.csm.updateFrustums();
    for (const [index, light] of this.csm.lights.entries()) {
      const size = low && index === 1 ? 512 : this.quality.shadowMap;
      light.shadow.mapSize.set(size, size);
      light.shadow.normalBias = index === 0 ? .35 : .65;
      light.name = `sun-cascade-${index + 1}`;
    }
    this.uniforms.CSM_cascades.value = this.csm.breaks.map(() => new THREE.Vector2());
    this.focusDistance = -1;
    this.sun.visible = false;
    this.sun.castShadow = false;
  }

  setQuality(quality: Quality) {
    if (quality.name === this.quality.name) return;
    for (const light of this.csm.lights) light.shadow.dispose();
    this.csm.remove();
    this.quality = quality;
    this.createCascades();
    for (const material of this.materials) {
      const lit = material as THREE.MeshStandardMaterial;
      lit.defines = { ...lit.defines, CSM_CASCADES: this.csm.cascades };
      material.needsUpdate = true;
    }
  }

  bindMaterial(material: THREE.Material) {
    if (!litTypes.has(material.type) || this.materials.has(material)) return;
    this.materials.add(material);
    const lit = material as THREE.MeshStandardMaterial;
    lit.defines = { ...lit.defines, USE_CSM: '', CSM_CASCADES: this.csm.cascades, CSM_FADE: '' };
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    const defaultKey = key === THREE.Material.prototype.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      // A mirrored camera samples the main view's maps. Select the cascade
      // using the original shadow view's depth at the same world-space point.
      const lighting = THREE.ShaderChunk.lights_fragment_begin.replace(
        'float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);',
        'float linearDepth = -(uCSMViewToShadow * vec4(-vViewPosition, 1.0)).z / (shadowFar - cameraNear);');
      shader.fragmentShader = 'uniform mat4 uCSMViewToShadow;\n' + shader.fragmentShader.replace('#include <lights_fragment_begin>', lighting);
    };
    material.customProgramCacheKey = () => (defaultKey ? compile.toString() : key.call(material)) + '|cascades-world-depth-' + this.csm.cascades;
    material.needsUpdate = true;
  }

  private update(camera: THREE.PerspectiveCamera) {
    this.shadowView.copy(camera.matrixWorldInverse);
    const focusDistance = Math.round(camera.position.distanceTo(this.sun.target.position) / 25) * 25;
    if (this.csm.camera !== camera || !this.projection.equals(camera.projectionMatrix) || focusDistance !== this.focusDistance) {
      this.csm.camera = camera;
      this.focusDistance = focusDistance;
      this.projection.copy(camera.projectionMatrix);
      this.csm.updateFrustums();
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.shadowFar.value = Math.min(camera.far, this.csm.maxFar);
      for (let i = 0; i < this.csm.breaks.length; i++) {
        this.uniforms.CSM_cascades.value[i].set(i ? this.csm.breaks[i - 1] : 0, this.csm.breaks[i]);
      }
    }
    this.sun.visible = false;
    this.sun.castShadow = false;
    this.csm.lightDirection.subVectors(this.sun.target.position, this.sun.position).normalize();
    this.csm.update();
    this.lightFrame.lookAt(this.origin, this.csm.lightDirection, this.up);
    this.inverseLightFrame.copy(this.lightFrame).invert();
    for (const light of this.csm.lights) {
      light.color.copy(this.sun.color);
      light.intensity = this.sun.intensity;
      const shadow = light.shadow;
      // CSM's built-in snap assumes equal map sizes. Low's far map uses its
      // actual 512-pixel grid, so both cascades stay stable during tiny pans.
      const texelX = (shadow.camera.right - shadow.camera.left) / shadow.mapSize.x;
      const texelY = (shadow.camera.top - shadow.camera.bottom) / shadow.mapSize.y;
      this.point.copy(light.position).applyMatrix4(this.inverseLightFrame);
      this.point.x = Math.floor(this.point.x / texelX) * texelX;
      this.point.y = Math.floor(this.point.y / texelY) * texelY;
      light.position.copy(this.point.applyMatrix4(this.lightFrame));
      light.target.position.copy(light.position).add(this.csm.lightDirection);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
    }
  }

  /** Explicit exports need current-lens shadows before either mirror samples
   * them. A one-pixel colour target primes the normal renderer's shadow pass. */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const target = withVisualRandom(() => new THREE.WebGLRenderTarget(1, 1));
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const test = renderer.getScissorTest(), autoClear = renderer.autoClear;
    const autoUpdate = renderer.shadowMap.autoUpdate, needsUpdate = renderer.shadowMap.needsUpdate;
    try {
      renderer.autoClear = true;
      renderer.shadowMap.autoUpdate = true;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(target);
      renderer.render(this.scene, camera);
    } finally {
      renderer.setRenderTarget(previous, face, mip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(test);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = autoUpdate; renderer.shadowMap.needsUpdate = needsUpdate;
      target.dispose();
    }
  }

  stats() {
    return { cascades: this.csm.cascades, far: this.uniforms.shadowFar.value, breaks: [...this.csm.breaks],
      maps: this.csm.lights.map(light => [light.shadow.mapSize.x, light.shadow.mapSize.y]) };
  }
}
