import * as THREE from 'three';
import type { Quality } from '../config';
import { withVisualRandom } from './visualRandom';
import { WaterTransparency } from './waterTransparency';

/** Copy opaque/submerged color, draw water, then blend foreground transparency.
 * Attach render to PostFX.scenePass. No scene target is sampled while attached.
 */
export class WaterRefraction {
  private copy?: THREE.WebGLRenderTarget;
  private surface?: THREE.WebGLRenderTarget;
  private enabled = true;
  private maxPixels: number;
  private objects: THREE.Object3D[] = [];
  private masks: number[] = [];
  private viewport = new THREE.Vector4();
  private rasterViewport = new THREE.Vector4();
  private scissor = new THREE.Vector4();
  private transparency: WaterTransparency;
  private waterObjects = new Set<THREE.Object3D>();
  private rendering = false;
  copies = 0;
  waterDraws = 0;
  surfaceDraws = 0;
  transparentDraws = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene,
    private water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    quality: Quality['name'] = 'high', maxPixels = 3840 * 2160) {
    this.maxPixels = maxPixels;
    this.transparency = new WaterTransparency(scene, this.waterObjects);
    this.setQuality(quality, maxPixels);
  }

  setQuality(quality: Quality['name'], maxPixels = this.maxPixels) {
    this.objects.length = 0;
    this.waterObjects.clear();
    this.water.traverse(object => { this.objects.push(object); this.waterObjects.add(object); });
    this.enabled = quality === 'high' || quality === 'ultra';
    this.maxPixels = Math.max(1, maxPixels);
    if (!this.enabled) this.dispose();
  }

  /** Stable callback; cam is the current lens, including photo/export cameras. */
  readonly render = (target: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera, draw: () => void) => {
    if (this.rendering) {
      draw();
      return;
    }
    const u = this.water.material.uniforms;
    u.uRefractionOn.value = 0;
    if (!this.enabled || !this.water.visible || !target.depthTexture || target.width * target.height > this.maxPixels) {
      draw();
      return;
    }
    const r = this.renderer;
    if (!this.copy) {
      this.copy = withVisualRandom(() => {
        const copy = new THREE.WebGLRenderTarget(target.width, target.height, { type: target.texture.type, samples: 0 });
        copy.texture.generateMipmaps = false;
        copy.depthTexture = new THREE.DepthTexture(target.width, target.height, target.depthTexture!.type);
        copy.depthTexture.format = target.depthTexture!.format;
        return copy;
      });
    }
    if (this.copy.width !== target.width || this.copy.height !== target.height) this.copy.setSize(target.width, target.height);
    withVisualRandom(() => r.initRenderTarget(this.copy!));
    const visible = this.water.visible, mask = cam.layers.mask, background = this.scene.background;
    const autoClear = r.autoClear, shadowAuto = r.shadowMap.autoUpdate, shadowNeeded = r.shadowMap.needsUpdate;
    const previousTarget = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const scissorTest = r.getScissorTest();
    const colorWrite = this.water.material.colorWrite, depthWrite = this.water.material.depthWrite;
    r.getViewport(this.viewport);
    r.getCurrentViewport(this.rasterViewport).divideScalar(r.getPixelRatio());
    r.getScissor(this.scissor);
    for (let i = 0; i < this.objects.length; i++) this.masks[i] = this.objects[i].layers.mask;
    this.rendering = true;
    try {
      const split = this.transparency.prepare(cam);
      if (split) {
        if (!this.surface) {
          this.surface = withVisualRandom(() => new THREE.WebGLRenderTarget(target.width, target.height, {
            format: THREE.RedFormat,
            type: THREE.UnsignedByteType,
            depthTexture: new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType),
          }));
        }
        if (this.surface.width !== target.width || this.surface.height !== target.height) {
          this.surface.setSize(target.width, target.height);
        }
        withVisualRandom(() => r.initRenderTarget(this.surface!));
        // Only the animated surface writes this depth. Its normal fragment
        // shader retains the exact terrain/shore discard and wave displacement.
        for (const object of this.objects) {
          if ((object as THREE.Mesh).material === this.water.material) object.layers.set(31);
          else object.layers.mask = 0;
        }
        cam.layers.set(31);
        this.scene.background = null;
        r.shadowMap.autoUpdate = r.shadowMap.needsUpdate = false;
        this.water.material.colorWrite = false;
        this.water.material.depthWrite = true;
        r.setRenderTarget(this.surface);
        r.setViewport(this.rasterViewport);
        r.setScissor(this.scissor);
        r.setScissorTest(scissorTest);
        r.clear(false, true, false);
        r.render(this.scene, cam);
        this.surfaceDraws++;
        this.water.material.colorWrite = colorWrite;
        this.water.material.depthWrite = depthWrite;
        for (let i = 0; i < this.objects.length; i++) this.objects[i].layers.mask = this.masks[i];
        cam.layers.mask = mask;
        this.scene.background = background;
        r.shadowMap.autoUpdate = shadowAuto;
        r.shadowMap.needsUpdate = shadowNeeded;
        this.transparency.setSide(-1, this.surface.depthTexture!, target.width, target.height);
      }
      this.water.visible = false;
      // Initializing or resizing a copy can change the GL framebuffer binding.
      // Rebind even without a transparent split so the first capture is complete.
      r.setRenderTarget(target);
      r.setViewport(this.rasterViewport);
      r.setScissor(this.scissor);
      r.setScissorTest(scissorTest);
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
      r.setViewport(this.rasterViewport);
      r.setScissor(this.scissor);
      r.setScissorTest(scissorTest);
      r.render(this.scene, cam);
      this.waterDraws++;
      if (split) {
        // The copy already contains submerged transparency. Only fragments in
        // front of the surface are blended onto the completed water image.
        this.water.visible = false;
        cam.layers.mask = mask;
        this.transparency.hideOpaque();
        this.transparency.setSide(1, this.surface!.depthTexture!, target.width, target.height);
        r.render(this.scene, cam);
        this.transparentDraws++;
      }
    } finally {
      this.transparency.restore();
      this.rendering = false;
      this.water.material.colorWrite = colorWrite;
      this.water.material.depthWrite = depthWrite;
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
  get surfaceSize() { return this.surface ? { width: this.surface.width, height: this.surface.height } : null; }
  dispose() {
    this.transparency.restore();
    this.surface?.dispose();
    this.surface = undefined;
    this.copy?.dispose();
    this.copy = undefined;
    const u = this.water.material.uniforms;
    u.uSceneColor.value = u.uSceneDepth.value = null;
    u.uRefractionOn.value = 0;
  }
}
