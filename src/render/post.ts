// STUB — owned by the Atmosphere & People workstream (replace wholesale).
import type * as THREE from 'three';
import type { Quality } from '../config';

export class PostFX {
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, q: Quality) {}
  setSize(w: number, h: number) {}
  /** night: 0 day .. 1 night (bloom strength etc.) */
  render(night: number) {
    this.renderer.render(this.scene, this.camera);
  }
}
