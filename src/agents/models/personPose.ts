import * as THREE from 'three';
import { POSE_DECLARATIONS, POSE_FRAGMENT, POSE_LIB, POSE_MAIN } from './personShader';

// The pose pass. A figure is rigid parts (PART in personGeo.ts) that a skeleton moves, and the pose of that skeleton (a gait with
// planted feet, two-bone legs and arms, the idle and action poses) costs a few hundred operations including dozens of sines. Worked out
// per vertex, as the first version did, that is 1000+ times per person and frame and five times the old model's cost on the software
// GPU. So it is worked out once per person and bone, here: one point per (person, bone) in an instanced draw over the same
// per-person attributes (the list of the people who are drawn in any way), writing a rigid transform (rotation and translation) into a 14 x N float texture pair. The
// vertex shader of the figure then only fetches its bone's transform. One extra draw call for the whole population, none per person.

export const POSE_BONES = 14;

/** the textures every material of the figure shares: the poses (this pass) and the per-person data (PersonStyle) */
export interface SharedUniforms {
  uPoseA: { value: THREE.Texture | null };
  uPoseB: { value: THREE.Texture | null };
  uPoseC: { value: THREE.Texture | null };
  uStyle: { value: THREE.Texture | null };
}

/** Float render targets are needed to write the transforms; without them the figure's vertex shader works the pose out itself. */
export function poseSupported(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
}

export class PersonPosePass {
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms: SharedUniforms;
  private geometry: THREE.InstancedBufferGeometry | null = null;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly clearColor = new THREE.Color();

  constructor(private readonly max: number, style: THREE.Texture) {
    this.target = new THREE.WebGLRenderTarget(POSE_BONES, Math.max(1, max), {
      count: 3, type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.target.textures.forEach((t, i) => { t.name = `person-pose-${'ABC'[i]}`; });
    this.uniforms = { uPoseA: { value: this.target.textures[0] }, uPoseB: { value: this.target.textures[1] }, uPoseC: { value: this.target.textures[2] }, uStyle: { value: style } };
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `${POSE_DECLARATIONS}\n${POSE_LIB}\n${POSE_MAIN}`,
      fragmentShader: POSE_FRAGMENT,
      uniforms: { uPoseSize: { value: new THREE.Vector2(POSE_BONES, Math.max(1, max)) }, uStyle: this.uniforms.uStyle },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
  }

  /** The people to work out: one instance of `motion` each (action, phase, handle), the handle being the row of the pose texture written. */
  connect(motion: THREE.InstancedBufferAttribute): void {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POSE_BONES * 3), 3));
    g.setAttribute('aBone', new THREE.BufferAttribute(Float32Array.from({ length: POSE_BONES }, (_, i) => i), 1));
    g.setAttribute('iMotion', motion);
    g.instanceCount = 0;
    const points = new THREE.Points(g, this.material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.geometry = g;
  }

  /** Allocate the textures now, so the first draw of the figure does not sample an incomplete texture. */
  init(renderer: THREE.WebGLRenderer): void { renderer.initRenderTarget(this.target); }

  /** Work out the pose of the first `count` people of the list given to `connect`. Call it outside a render, before the frame that draws them. */
  update(renderer: THREE.WebGLRenderer, count: number): void {
    if (!this.geometry || count <= 0) return;
    this.geometry.instanceCount = Math.min(count, this.max);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear, prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.geometry?.dispose();
  }
}
