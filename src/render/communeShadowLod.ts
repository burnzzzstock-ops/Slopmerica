import * as THREE from 'three';
import { clusteredShadowIndices } from './propShadowLod';
import { distantComponentIndices } from './buildingLod';

/** Static tent fabric, buses and camp furniture share one mesh. The visible
 * overview retains large connected components. The sun uses a separate
 * index range matched to each cascade's actual shadow texels. */
export function prepareCommuneShadows(group: THREE.Group) {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.castShadow) return;
    const mesh = object, geometry = mesh.geometry;
    const position = geometry.getAttribute('position'), source = geometry.index;
    if (!source || !position || geometry.groups.length) return;
    const packed = Array.from(source.array);
    const farStart = packed.length;
    const distant = distantComponentIndices(geometry, 12);
    if (distant) for (const i of distant) packed.push(i);
    const ranges = [0.15, 0.35, 1.2, 2.4].map(cell => {
      const start = packed.length;
      for (const index of clusteredShadowIndices(geometry, cell)) packed.push(index);
      return { start, count: packed.length - start };
    });
    geometry.setIndex(packed);
    const restore = () => geometry.setDrawRange(0, source.count);
    restore();
    mesh.onBeforeShadow = (renderer, _object, _camera, shadowCamera) => {
      if (!(shadowCamera instanceof THREE.OrthographicCamera)) { restore(); return; }
      const pixels = renderer.getRenderTarget()?.width;
      if (!pixels) { restore(); return; }
      const texel = (shadowCamera.right - shadowCamera.left) / (pixels * shadowCamera.zoom);
      const range = texel >= 6.5 ? ranges[3] : texel >= 3.5 ? ranges[2] : texel >= 1 ? ranges[1] : texel >= .45 ? ranges[0] : null;
      if (range) geometry.setDrawRange(range.start, range.count);
      else restore();
    };
    mesh.onAfterShadow = restore;
    const center = new THREE.Vector3();
    geometry.computeBoundingSphere();
    let far = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!distant || !(camera instanceof THREE.PerspectiveCamera)) { restore(); return; }
      center.copy(geometry.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);
      const scale = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2) / Math.tan(THREE.MathUtils.degToRad(25));
      far = camera.position.distanceTo(center) * scale > (far ? 680 : 800);
      if (far) geometry.setDrawRange(farStart, distant.length);
      else restore();
    };
    mesh.onAfterRender = restore;
  });
}
