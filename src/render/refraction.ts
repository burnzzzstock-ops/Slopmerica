import * as THREE from 'three';
import type { Quality } from '../config';

/** Opaque color/depth copies followed by one water-only draw into retained depth.
 * Attach render to PostFX.scenePass. No scene target is sampled while attached.
 */
export class WaterRefraction {
  private copy?: THREE.WebGLRenderTarget;
  private enabled = true;
  private maxPixels: number;
  private objects: THREE.Object3D[] = [];
  private masks: number[] = [];
  private viewport = new THREE.Vector4();
  private scissor = new THREE.Vector4();
  copies = 0;
  waterDraws = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene,
    private water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    quality: Quality['name'] = 'high', maxPixels = 3840 * 2160) {
    this.maxPixels = maxPixels;
    water.traverse(o => this.objects.push(o));
    this.setQuality(quality, maxPixels);
  }

  setQuality(quality: Quality['name'], maxPixels = this.maxPixels) {
    this.enabled = quality === 'high' || quality === 'ultra';
    this.maxPixels = Math.max(1, maxPixels);
    if (!this.enabled) this.dispose();
  }

  /** Stable callback; cam is the current lens, including photo/export cameras. */
  readonly render = (target: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera, draw: () => void) => {
    const u = this.water.material.uniforms;
    u.uRefractionOn.value = 0;
    if (!this.enabled || !this.water.visible || !target.depthTexture || target.width * target.height > this.maxPixels) {
      draw();
      return;
    }
    const r = this.renderer;
    if (!this.copy) {
      this.copy = new THREE.WebGLRenderTarget(target.width, target.height, { type: target.texture.type, samples: 0 });
      this.copy.texture.generateMipmaps = false;
      this.copy.depthTexture = new THREE.DepthTexture(target.width, target.height, target.depthTexture.type);
      this.copy.depthTexture.format = target.depthTexture.format;
    }
    if (this.copy.width !== target.width || this.copy.height !== target.height) this.copy.setSize(target.width, target.height);
    r.initRenderTarget(this.copy);
    const visible = this.water.visible, mask = cam.layers.mask, background = this.scene.background;
    const autoClear = r.autoClear, shadowAuto = r.shadowMap.autoUpdate, shadowNeeded = r.shadowMap.needsUpdate;
    const previousTarget = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const scissorTest = r.getScissorTest();
    r.getViewport(this.viewport);
    r.getScissor(this.scissor);
    for (let i = 0; i < this.objects.length; i++) this.masks[i] = this.objects[i].layers.mask;
    try {
      this.water.visible = false;
      draw();
      // render() resolves MSAA color and depth before these distinct copies.
      r.copyTextureToTexture(target.texture, this.copy.texture);
      r.copyTextureToTexture(target.depthTexture, this.copy.depthTexture!);
      this.copies++;
      u.uSceneColor.value = this.copy.texture;
      u.uSceneDepth.value = this.copy.depthTexture;
      u.uViewport.value.set(target.width, target.height);
      u.uCameraRange.value.set(cam.near, cam.far);
      u.uRefractionOn.value = 1;
      this.water.visible = visible;
      for (const object of this.objects) object.layers.set(31);
      cam.layers.set(31);
      this.scene.background = null;
      r.autoClear = false;
      r.shadowMap.autoUpdate = r.shadowMap.needsUpdate = false;
      r.setRenderTarget(target);
      r.render(this.scene, cam);
      this.waterDraws++;
    } finally {
      this.water.visible = visible;
      for (let i = 0; i < this.objects.length; i++) this.objects[i].layers.mask = this.masks[i];
      cam.layers.mask = mask;
      this.scene.background = background;
      r.autoClear = autoClear;
      r.shadowMap.autoUpdate = shadowAuto;
      r.shadowMap.needsUpdate = shadowNeeded;
      u.uRefractionOn.value = 0;
      r.setRenderTarget(previousTarget, face, mip);
      r.setViewport(this.viewport);
      r.setScissor(this.scissor);
      r.setScissorTest(scissorTest);
    }
  };

  get size() { return this.copy ? { width: this.copy.width, height: this.copy.height } : null; }
  dispose() {
    this.copy?.dispose();
    this.copy = undefined;
    const u = this.water.material.uniforms;
    u.uSceneColor.value = u.uSceneDepth.value = null;
    u.uRefractionOn.value = 0;
  }
}
