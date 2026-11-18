// BASE_URL serves the frozen source used by the live WebGL regression.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './measure.mjs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const out = process.env.OUT ?? 'shots/water/transparency';
mkdirSync(out, { recursive: true });
const browser = await launch(process.env.GPU !== '1');
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text());
  });
  await page.goto(`${base}/package.json`);
  const result = await page.evaluate(async baseline => {
    const source = await (await fetch('/src/render/post.ts')).text();
    const T = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { createWater } = await import('/src/world/water.ts');
    const { WaterRefraction } = await import(baseline ? '/src/render/refraction-before.ts' : '/src/render/refraction.ts');
    const { installAmbientOutput } = await import('/src/render/ambientOutput.ts');
    const renderer = new T.WebGLRenderer({ antialias: false });
    renderer.setSize(640, 480);
    document.body.replaceChildren(renderer.domElement);
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const adapter = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    const scene = new T.Scene();
    installAmbientOutput(scene);
    scene.background = new T.Color(.1, .1, .1);
    const camera = new T.PerspectiveCamera(50, 640 / 480, .1, 1000);
    camera.position.set(0, 10, 16);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const heights = new Float32Array(1537 ** 2).fill(-8);
    const heightTex = new T.DataTexture(new Float32Array([-8]), 1, 1, T.RedFormat, T.FloatType);
    heightTex.needsUpdate = true;
    const water = createWater({ heights, heightTex, h: () => -8, map: { rivers: [] } }, {
      shallow: 0x4f9cbd, deep: 0x123652, murk: 0x777744,
    }, false, 'norcal');
    water.mat.uniforms.uSunColor.value.setRGB(0, 0, 0);
    water.mat.uniforms.uSky.value.setRGB(0, 0, 0);
    water.mat.uniforms.uSkyTop.value.setRGB(0, 0, 0);
    water.mat.uniforms.uWindAmp.value = 0;
    scene.add(water.mesh);
    const bed = new T.Mesh(new T.PlaneGeometry(150, 150), new T.MeshBasicMaterial({ color: 0xffffff }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -8;
    scene.add(bed);
    const material = new T.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: .5, depthWrite: false, side: T.DoubleSide });
    const panel = new T.Mesh(new T.PlaneGeometry(4, 4), material);
    panel.position.set(0, 3, 0);
    scene.add(panel);
    const target = new T.WebGLRenderTarget(640, 480, {
      depthTexture: new T.DepthTexture(640, 480, T.UnsignedIntType), samples: 0, count: 2,
    });
    const refraction = new WaterRefraction(renderer, scene, water.mesh, 'high');
    const pixels = () => {
      const data = new Uint8Array(640 * 480 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 640, 480, data);
      return data;
    };
    const draw = () => {
      renderer.setRenderTarget(target);
      refraction.render(target, camera, () => renderer.render(scene, camera));
      return pixels();
    };
    const sample = (data, point) => {
      const p = point.clone().project(camera);
      const x = Math.round((p.x + 1) * 320);
      const y = Math.round((p.y + 1) * 240);
      const rgb = [0, 0, 0];
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const k = ((y + dy) * 640 + x + dx) * 4;
        for (let c = 0; c < 3; c++) rgb[c] += data[k + c] / 81;
      }
      return rgb;
    };
    const difference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
    panel.visible = false;
    const cold = draw();
    draw();
    const background = draw();
    // Independent source-over reference draws the foreground panel onto completed water.
    panel.visible = true;
    water.mesh.visible = bed.visible = false;
    scene.background = null;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const expectedAbove = pixels();
    renderer.autoClear = true;
    scene.background = new T.Color(.1, .1, .1);
    water.mesh.visible = bed.visible = true;
    const above = draw();
    const copiedAbove = new Uint8Array(640 * 480 * 4);
    renderer.readRenderTargetPixels(refraction.copy, 0, 0, 640, 480, copiedAbove);
    const abovePoint = panel.position.clone();
    panel.position.y = -3;
    const below = draw();
    const belowPoint = panel.position.clone();
    panel.visible = false;
    const belowBackground = draw();
    panel.visible = true;
    water.mesh.visible = false;
    const belowDry = draw();
    water.mesh.visible = true;
    const aboveRGB = sample(above, abovePoint);
    const coldError = difference(sample(cold, abovePoint), sample(background, abovePoint));
    const expectedRGB = sample(expectedAbove, abovePoint);
    const belowRGB = sample(below, belowPoint);
    const belowDryRGB = sample(belowDry, belowPoint);
    const aboveError = difference(aboveRGB, expectedRGB);
    const submergedChange = difference(belowRGB, sample(belowBackground, belowPoint));
    const submergedAbsorption = difference(belowRGB, belowDryRGB);
    const shader = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, .5); }',
    });
    const raw = new T.RawShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'precision highp float; attribute vec3 position; uniform mat4 projectionMatrix, modelViewMatrix; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'precision highp float; void main(void) { gl_FragColor = vec4(1.0, 0.0, 1.0, .5); }',
    });
    const cases = [];
    for (const samples of [0, 4]) {
      target.dispose();
      target.samples = samples;
      for (const [name, panelMaterial] of [['basic', material], ['shader', shader], ['raw', raw]]) {
        panel.material = panelMaterial;
        for (const height of [3, 0]) {
          panel.position.y = height;
          const point = new T.Vector3(0, height === 0 ? 1 : height, 0);
          panel.visible = false;
          draw();
          draw();
          panel.visible = true;
          water.mesh.visible = bed.visible = false;
          scene.background = null;
          renderer.autoClear = false;
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          const expected = sample(pixels(), point);
          renderer.autoClear = true;
          scene.background = new T.Color(.1, .1, .1);
          water.mesh.visible = bed.visible = true;
          const actual = sample(draw(), point);
          cases.push({ samples, material: name, height, actual, expected, error: difference(actual, expected) });
        }
      }
    }
    panel.material = material;
    panel.position.y = 3;
    draw();
    draw();
    const programsBefore = renderer.info.programs.length;
    const originalCompile = gl.compileShader.bind(gl);
    let compiles = 0;
    gl.compileShader = (...args) => { compiles++; return originalCompile(...args); };
    for (let frame = 0; frame < 8; frame++) draw();
    gl.compileShader = originalCompile;
    const programsAfter = renderer.info.programs.length;
    const hooks = () => [material.onBeforeRender, material.onBeforeCompile, material.customProgramCacheKey];
    const expectedHooks = hooks();
    const state = () => ({
      waterVisible: water.mesh.visible, waterMask: water.mesh.layers.mask,
      cameraMask: camera.layers.mask, colorWrite: water.mat.colorWrite,
      depthWrite: water.mat.depthWrite, bedVisible: bed.material.visible,
      autoClear: renderer.autoClear, shadowAuto: renderer.shadowMap.autoUpdate,
      shadowNeeded: renderer.shadowMap.needsUpdate, target: renderer.getRenderTarget() === target,
      viewport: renderer.getViewport(new T.Vector4()).toArray(),
      scissor: renderer.getScissor(new T.Vector4()).toArray(),
      scissorTest: renderer.getScissorTest(), refraction: water.mat.uniforms.uRefractionOn.value,
    });
    const failures = [];
    for (const failAt of [1, 2, 3, 4]) {
      renderer.setRenderTarget(target);
      const expected = state();
      const originalRender = renderer.render;
      let calls = 0;
      let caught = false;
      renderer.render = function (...args) {
        if (++calls === failAt) throw Error('injected water pass failure');
        return originalRender.apply(this, args);
      };
      try { draw(); } catch (error) { caught = error.message === 'injected water pass failure'; }
      finally { renderer.render = originalRender; }
      failures.push({ failAt, caught, stateRestored: JSON.stringify(expected) === JSON.stringify(state()),
        hooksRestored: hooks().every((hook, i) => hook === expectedHooks[i]) });
    }
    const originalRandom = Math.random;
    let randomDraws = 0;
    let alternate;
    let alternateError;
    Math.random = () => { randomDraws++; return originalRandom(); };
    try {
      alternate = new WaterRefraction(renderer, scene, water.mesh, 'high');
      renderer.setRenderTarget(target);
      alternate.render(target, camera, () => renderer.render(scene, camera));
      alternateError = difference(sample(pixels(), abovePoint), sample(draw(), abovePoint));
    } finally {
      Math.random = originalRandom;
      alternate?.dispose();
    }
    const viewportPasses = [];
    const originalRender = renderer.render;
    renderer.setRenderTarget(target);
    renderer.setViewport(30, 40, 500, 360);
    renderer.setScissor(50, 60, 300, 240);
    renderer.setScissorTest(true);
    renderer.render = function (...args) {
      viewportPasses.push({ viewport: renderer.getCurrentViewport(new T.Vector4()).toArray(),
        scissor: renderer.getScissor(new T.Vector4()).toArray(), scissorTest: renderer.getScissorTest() });
      return originalRender.apply(this, args);
    };
    try { refraction.render(target, camera, () => renderer.render(scene, camera)); }
    finally { renderer.render = originalRender; }
    const regionPreserved = viewportPasses.every(pass =>
      JSON.stringify(pass.viewport) === '[30,40,500,360]' &&
      JSON.stringify(pass.scissor) === '[50,60,300,240]' && pass.scissorTest);
    renderer.setViewport(0, 0, 640, 480);
    renderer.setScissorTest(false);
    refraction.setQuality('low');
    const disposed = refraction.size === null && (!('surfaceSize' in refraction) || refraction.surfaceSize === null);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return {
      adapter, aboveRGB, expectedRGB, aboveError, belowRGB, belowDryRGB, coldError,
      copiedAbove: sample(copiedAbove, abovePoint), backgroundAbove: sample(background, abovePoint),
      cases, programsBefore, programsAfter, compiles, failures, disposed,
      randomDraws, alternateError, viewportPasses, regionPreserved,
      submergedChange, submergedAbsorption, glError: gl.getError(),
      passed: aboveError < 2 && coldError < 2 && submergedChange > 2 && submergedAbsorption > 10 &&
        cases.every(row => row.error < 2) && compiles === 0 && programsAfter === programsBefore &&
        failures.every(row => row.caught && row.stateRestored && row.hooksRestored) && disposed &&
        randomDraws === 0 && alternateError < 2 && regionPreserved,
    };
  }, process.env.WATER_BASELINE === '1');
  result.errors = errors;
  result.passed &&= !errors.length && result.glError === 0;
  writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2) + '\n');
  await page.screenshot({ path: `${out}/scene.png` });
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
