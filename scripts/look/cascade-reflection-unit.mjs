import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ root: process.env.SOURCE_ROOT || process.cwd(), configFile: false,
  cacheDir: resolve('shots/tmp/vite/cascade-reflection-' + process.pid),
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { CascadeShadows } = await server.ssrLoadModule('/src/render/cascadeShadows.ts');
  const { QUALITY } = await server.ssrLoadModule('/src/config.ts');
  const THREE = await import('three');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .5, 20000);
  camera.position.set(20, 8, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 10, 5); scene.add(sun, sun.target);
  const shadows = new CascadeShadows(scene, camera, sun, QUALITY.high);
  const renderer = { shadowMap: { autoUpdate: true } };
  scene.onBeforeRender(renderer, scene, camera);
  const material = new THREE.MeshStandardMaterial();
  shadows.bindMaterial(material);
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader, renderer);
  assert.ok(shader.fragmentShader.includes('float linearDepth = -(uCSMViewToShadow'), 'Reflection shader must select the main shadow view depth');
  const mainView = camera.matrixWorldInverse.clone();
  const reflection = camera.clone();
  reflection.position.y = -camera.position.y;
  reflection.lookAt(0, 0, 0); reflection.updateMatrixWorld();
  renderer.shadowMap.autoUpdate = false;
  scene.onBeforeRender(renderer, scene, reflection);
  for (const point of [new THREE.Vector3(), new THREE.Vector3(20, 3, -400), new THREE.Vector3(-10, 20, -6000)]) {
    const actual = point.clone().applyMatrix4(reflection.matrixWorldInverse).applyMatrix4(shader.uniforms.uCSMViewToShadow.value);
    assert.ok(actual.distanceTo(point.clone().applyMatrix4(mainView)) < 1e-8);
  }
  assert.ok(shadows.shadowView.equals(mainView));
  renderer.shadowMap.autoUpdate = true;
  scene.onBeforeRender(renderer, scene, camera);
  assert.ok(shader.uniforms.uCSMViewToShadow.value.equals(new THREE.Matrix4()));
  material.dispose(); shadows.csm.remove();
  console.log('PASS reflected points use the retained main shadow view and return to exact identity for the main camera');
} finally { await server.close(); }
