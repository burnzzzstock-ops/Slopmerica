import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { withVisualRandom } from '../render/visualRandom';

export interface ReflectiveRoad {
  mesh: THREE.Mesh;
  /** Normalized map U half-width of the carriageway and median. */
  span: number;
  median: number;
  /** Crossing decals use the same reflection without selecting its plane. */
  select?: boolean;
}

export interface RoadMirrorPlane {
  plane: THREE.Plane;
  center: THREE.Vector3;
  area: number;
  dip: number;
}

/** Derive mirror planes from the actual rendered, puddle-bearing triangles. */
export function roadMirrorPlanes(surfaces: readonly ReflectiveRoad[]): RoadMirrorPlane[] {
  const planes: RoadMirrorPlane[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const surface of surfaces) {
    if (surface.select === false) continue;
    const mesh = surface.mesh, geometry = mesh.geometry;
    const position = geometry.getAttribute('position'), state = geometry.getAttribute('aRoadState');
    if (!position || !state) continue;
    const uv = geometry.getAttribute('uv'), index = geometry.index;
    const count = index?.count ?? position.count;
    mesh.updateWorldMatrix(true, false);
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const ia = index?.getX(offset) ?? offset;
      const ib = index?.getX(offset + 1) ?? offset + 1;
      const ic = index?.getX(offset + 2) ?? offset + 2;
      const dip = (state.getY(ia) + state.getY(ib) + state.getY(ic)) / 3;
      if (dip < .15) continue;
      const lateral = uv ? Math.abs((uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3 - .5) : 0;
      if (lateral > surface.span || lateral < surface.median) continue;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const area = normal.length() * .5;
      if (area < 1) continue;
      normal.normalize();
      if (normal.y < .9) continue;
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      planes.push({ plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), center, area, dip });
    }
  }
  return planes;
}

/** One full-resolution Ultra mirror, accepted only by coplanar puddle fragments. */
export class RoadReflection {
  readonly uniforms = {
    uRoadReflectionOn: { value: 0 },
    tRoadReflection: { value: null as THREE.Texture | null },
    uRoadReflectionMatrix: { value: new THREE.Matrix4() },
    uRoadReflectionPlane: { value: new THREE.Vector4(0, 1, 0, 0) },
  };
  enabled = false;
  private reflector?: Reflector;
  private geometries: THREE.BufferGeometry[] = [];
  private planes: RoadMirrorPlane[] = [];
  private selected?: RoadMirrorPlane;
  private drawing = false;
  private size = new THREE.Vector2();
  private projection = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private lastEye = new THREE.Vector3(Infinity, 0, 0);
  private lastRotation = new THREE.Quaternion();
  private lastProjection = new THREE.Matrix4();
  private lastPlane = new THREE.Plane();
  private lastRefresh = -Infinity;

  get target(): THREE.WebGLRenderTarget | null { return this.reflector?.getRenderTarget() ?? null; }

  dispose() {
    this.reflector?.geometry.dispose();
    this.reflector?.dispose();
    this.reflector = undefined;
    this.uniforms.tRoadReflection.value = null;
    this.uniforms.uRoadReflectionOn.value = 0;
    this.lastRefresh = -Infinity;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    surfaces: readonly ReflectiveRoad[], seconds?: number): boolean {
    if (this.drawing) return false;
    this.uniforms.uRoadReflectionOn.value = 0;
    if (!this.enabled) { this.lastRefresh = -Infinity; return false; }
    if (this.geometries.length !== surfaces.length || surfaces.some((surface, i) => surface.mesh.geometry !== this.geometries[i])) {
      this.geometries = surfaces.map(surface => surface.mesh.geometry);
      this.planes = roadMirrorPlanes(surfaces);
      this.selected = undefined;
    }
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const score = (candidate: RoadMirrorPlane) => {
      const distance = candidate.center.distanceToSquared(camera.position);
      if (distance > 500 * 500 || !this.frustum.containsPoint(candidate.center) || candidate.plane.distanceToPoint(camera.position) < .1) return 0;
      return candidate.area * candidate.dip / Math.max(1, distance);
    };
    let chosen = this.selected, best = chosen ? score(chosen) * 1.15 : 0;
    for (const candidate of this.planes) {
      const value = score(candidate);
      if (value > best) { chosen = candidate; best = value; }
    }
    if (!chosen || !best) { this.selected = undefined; this.lastRefresh = -Infinity; return false; }
    this.selected = chosen;
    const reflector = this.reflector ??= withVisualRandom(() => new Reflector(new THREE.BufferGeometry(), {
      textureWidth: 16, textureHeight: 16, multisample: 0,
    }));
    const target = reflector.getRenderTarget();
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x), height = Math.max(1, this.size.y);
    const resized = target.width !== width || target.height !== height;
    if (resized) target.setSize(width, height);
    const plane = chosen.plane;
    this.uniforms.uRoadReflectionOn.value = 1;
    const angularTolerance = Math.tan(THREE.MathUtils.degToRad(camera.fov) * .5) * .25 / height;
    const positionTolerance = Math.max(1, plane.distanceToPoint(camera.position)) * angularTolerance;
    if (seconds !== undefined && !resized && plane.equals(this.lastPlane) && seconds >= this.lastRefresh && seconds - this.lastRefresh < 1 / 30 - 1e-6 &&
      this.lastEye.distanceToSquared(camera.position) <= positionTolerance ** 2 &&
      1 - Math.abs(this.lastRotation.dot(camera.quaternion)) <= angularTolerance ** 2 / 8 && this.lastProjection.equals(camera.projectionMatrix)) return false;

    reflector.position.copy(chosen.center);
    reflector.quaternion.setFromUnitVectors(this.zAxis, plane.normal);
    reflector.updateMatrixWorld(true);
    const reflectionCamera = withVisualRandom(() => reflector.getReflectionCamera(camera));
    reflectionCamera.userData.isPlanarReflection = true;
    const previousTarget = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace(), mipLevel = renderer.getActiveMipmapLevel();
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate, shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const xrEnabled = renderer.xr.enabled;
    const viewport = renderer.getViewport(new THREE.Vector4());
    const visible = surfaces.map(surface => surface.mesh.visible);
    const beforeScene = scene.onBeforeRender;
    this.drawing = true;
    this.lastRefresh = -Infinity;
    try {
      // Reflector replaces the projection with an oblique near plane. Keep its
      // inverse consistent before any existing per-camera scene hook runs.
      scene.onBeforeRender = (...args) => {
        if (args[2] === reflectionCamera) reflectionCamera.projectionMatrixInverse.copy(reflectionCamera.projectionMatrix).invert();
        beforeScene.apply(scene, args);
      };
      for (const surface of surfaces) surface.mesh.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      withVisualRandom(() => reflector.onBeforeRender(renderer, scene, camera, reflector.geometry, reflector.material as THREE.Material, null!));
      reflectionCamera.projectionMatrixInverse.copy(reflectionCamera.projectionMatrix).invert();
      const material = reflector.material as THREE.ShaderMaterial;
      this.inverse.copy(reflector.matrixWorld).invert();
      this.uniforms.uRoadReflectionMatrix.value.copy(material.uniforms.textureMatrix.value).multiply(this.inverse);
      this.uniforms.uRoadReflectionPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      this.uniforms.tRoadReflection.value = target.texture;
      this.lastEye.copy(camera.position);
      this.lastRotation.copy(camera.quaternion);
      this.lastProjection.copy(camera.projectionMatrix);
      this.lastPlane.copy(plane);
      this.lastRefresh = seconds ?? -Infinity;
    } catch (error) {
      this.uniforms.uRoadReflectionOn.value = 0;
      throw error;
    } finally {
      scene.onBeforeRender = beforeScene;
      renderer.setRenderTarget(previousTarget, cubeFace, mipLevel);
      renderer.setViewport(viewport);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      renderer.xr.enabled = xrEnabled;
      surfaces.forEach((surface, index) => { surface.mesh.visible = visible[index]; });
      this.drawing = false;
    }
    return true;
  }
}
