import * as THREE from 'three';

interface MaterialState {
  manager?: WaterTransparency;
  material: THREE.Material;
  beforeRender: THREE.Material['onBeforeRender'];
  beforeCompile: THREE.Material['onBeforeCompile'];
  cacheKey: THREE.Material['customProgramCacheKey'];
  ownBeforeRender: boolean;
  ownBeforeCompile: boolean;
  ownCacheKey: boolean;
  installed: boolean;
  render: THREE.Material['onBeforeRender'];
  compile: THREE.Material['onBeforeCompile'];
  key: THREE.Material['customProgramCacheKey'];
  uniforms: {
    uWaterSurfaceDepth: { value: THREE.DepthTexture | null };
    uWaterSurfaceSize: { value: THREE.Vector2 };
    uWaterSide: { value: number };
  };
}

// A shared material keeps one uniform set even when two refraction owners draw
// it in turn. Three may reuse the same cached material program between owners.
const known = new WeakMap<THREE.Material, MaterialState>();

/** Split transparent fragments at the actual animated water surface. Hooks are
 * scoped to one refraction draw. Cached shader variants are reused next frame. */
export class WaterTransparency {
  private active: MaterialState[] = [];
  private opaque: THREE.Material[] = [];
  private seen = new Set<THREE.Material>();
  private camera?: THREE.Camera;
  private side = 0;

  constructor(private scene: THREE.Scene, private waterObjects: Set<THREE.Object3D>) {}

  prepare(camera: THREE.Camera) {
    this.camera = camera;
    this.seen.clear();
    this.scene.traverseVisible(object => {
      if (this.waterObjects.has(object) || !object.layers.test(camera.layers)) return;
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      if (Array.isArray(material)) {
        for (const entry of material) this.add(entry);
      } else this.add(material);
    });
    return this.active.length > 0;
  }

  private add(material: THREE.Material) {
    if (!material.visible || this.seen.has(material)) return;
    this.seen.add(material);
    if (!material.transparent) {
      this.opaque.push(material);
      return;
    }
    let state = known.get(material);
    if (!state) {
      const uniforms = {
        uWaterSurfaceDepth: { value: null as THREE.DepthTexture | null },
        uWaterSurfaceSize: { value: new THREE.Vector2() },
        uWaterSide: { value: 0 },
      };
      state = {
        material, uniforms,
        beforeRender: material.onBeforeRender,
        beforeCompile: material.onBeforeCompile,
        cacheKey: material.customProgramCacheKey,
        ownBeforeRender: false,
        ownBeforeCompile: false,
        ownCacheKey: false,
        installed: false,
        render(this: THREE.Material, ...args) {
          const entry = state!;
          entry.beforeRender.apply(this, args);
          // Let ambient/CSM hooks install first, then wrap the resulting shader.
          if (!entry.installed) {
            entry.beforeCompile = this.onBeforeCompile;
            entry.cacheKey = this.customProgramCacheKey;
            entry.ownBeforeCompile = Object.hasOwn(this, 'onBeforeCompile');
            entry.ownCacheKey = Object.hasOwn(this, 'customProgramCacheKey');
            this.onBeforeCompile = entry.compile;
            this.customProgramCacheKey = entry.key;
            this.needsUpdate = true;
            entry.installed = true;
          }
          const owner = entry.manager;
          entry.uniforms.uWaterSide.value = owner && args[2] === owner.camera ? owner.side : 0;
          if ((this as THREE.ShaderMaterial).isShaderMaterial) {
            (this as THREE.ShaderMaterial).uniformsNeedUpdate = true;
          }
        },
        compile(this: THREE.Material, shader, renderer) {
          const entry = state!;
          entry.beforeCompile.call(this, shader, renderer);
          Object.assign(shader.uniforms, entry.uniforms);
          shader.fragmentShader = `
uniform highp sampler2D uWaterSurfaceDepth;
uniform highp vec2 uWaterSurfaceSize;
uniform highp float uWaterSide;
` + shader.fragmentShader.replace(/void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/, `$&
  if (uWaterSide != 0.0) {
    #if __VERSION__ >= 300
      float waterDepth = texture(uWaterSurfaceDepth, gl_FragCoord.xy / uWaterSurfaceSize).r;
    #else
      float waterDepth = texture2D(uWaterSurfaceDepth, gl_FragCoord.xy / uWaterSurfaceSize).r;
    #endif
    bool foreground = gl_FragCoord.z <= waterDepth;
    if ((uWaterSide < 0.0 && foreground) || (uWaterSide > 0.0 && !foreground)) discard;
  }
`);
        },
        key(this: THREE.Material) {
          const entry = state!;
          const upstream = entry.cacheKey === THREE.Material.prototype.customProgramCacheKey
            ? entry.beforeCompile.toString() : entry.cacheKey.call(this);
          return upstream + '/' + entry.beforeCompile.toString() + '/water-depth-split-v1';
        },
      };
      known.set(material, state);
    }
    state.manager = this;
    state.beforeRender = material.onBeforeRender;
    state.ownBeforeRender = Object.hasOwn(material, 'onBeforeRender');
    state.installed = false;
    material.onBeforeRender = state.render;
    this.active.push(state);
  }

  setSide(side: number, depth: THREE.DepthTexture, width: number, height: number) {
    this.side = side;
    for (const state of this.active) {
      state.uniforms.uWaterSide.value = side;
      state.uniforms.uWaterSurfaceDepth.value = depth;
      state.uniforms.uWaterSurfaceSize.value.set(width, height);
    }
  }

  hideOpaque() {
    for (const material of this.opaque) material.visible = false;
  }

  restore() {
    this.side = 0;
    for (const state of this.active) {
      const material = state.material;
      state.uniforms.uWaterSide.value = 0;
      state.uniforms.uWaterSurfaceDepth.value = null;
      state.manager = undefined;
      if (state.installed) {
        if (state.ownBeforeCompile) material.onBeforeCompile = state.beforeCompile;
        else delete (material as Partial<THREE.Material>).onBeforeCompile;
        if (state.ownCacheKey) material.customProgramCacheKey = state.cacheKey;
        else delete (material as Partial<THREE.Material>).customProgramCacheKey;
        material.needsUpdate = true;
      }
      if (state.ownBeforeRender) material.onBeforeRender = state.beforeRender;
      else delete (material as Partial<THREE.Material>).onBeforeRender;
    }
    for (const material of this.opaque) material.visible = true;
    this.active.length = this.opaque.length = 0;
    this.seen.clear();
    this.camera = undefined;
  }
}
