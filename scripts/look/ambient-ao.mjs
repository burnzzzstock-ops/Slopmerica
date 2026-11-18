// BASE_URL selects a frozen renderer. Check the actual HDR attachment and
// final composition with pure direct light, pure ambient light and emission.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('shots/pinned-browser');
const { launch } = await import('../lib/browser.mjs');
const { capture, shots } = await import('./golden-scenes.mjs');
const out = process.env.OUT || 'shots/look/ambient-ao';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const shot = shots.find(s => s.id === 'block-high-junction-noon');
  const frame = await capture(browser, shot, process.env.BASE_URL || 'http://127.0.0.1:5198', false, page => page.evaluate(async () => {
    const g = window.__game, r = g.renderer;
    const source = await (await fetch('/src/render/post.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { PostFX } = await import('/src/render/post.ts');
    const { QUALITY } = await import('/src/config.ts');
    const oldSize = r.getSize(new THREE.Vector2()), ratio = r.getPixelRatio();
    const size = 160;
    r.setDrawingBufferSize(size, size, 1);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
    camera.position.set(9, 7, 11); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material); floor.rotation.x = -Math.PI / 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), material); box.position.y = 2;
    const ambient = new THREE.AmbientLight(0xffffff, 0), sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.position.set(5, 8, 7); scene.add(floor, box, ambient, sun);
    const post = new PostFX(r, scene, camera, QUALITY.high);
    post.bloomOn = false; post.vignette = false; post.aoRadius = 3;
    const pixels = new Uint8Array(size * size * 4), hdr = new Uint16Array(size * size * 4);
    const rows = [];
    try {
      for (const mode of ['direct', 'ambient', 'emissive']) {
        ambient.intensity = mode === 'ambient' ? 2 : 0;
        sun.intensity = mode === 'direct' ? 3 : 0;
        material.emissive.set(mode === 'emissive' ? 0x999999 : 0);
        const frames = [];
        let ambientMaximum = 0;
        for (const ao of [false, true]) {
          post.ao = ao;
          post.gradeM.uniforms.uTime.value = 0;
          post.render(0, 15, camera);
          r.getContext().readPixels(0, 0, size, size, r.getContext().RGBA, r.getContext().UNSIGNED_BYTE, pixels);
          frames.push(pixels.slice());
          r.readRenderTargetPixels(post.sceneRT, 0, 0, size, size, hdr, undefined, 1);
          for (let i = 0; i < hdr.length; i++) if (i % 4 !== 3) ambientMaximum = Math.max(ambientMaximum, THREE.DataUtils.fromHalfFloat(hdr[i]));
        }
        let changed = 0, darker = 0, brighter = 0, maximum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const delta = frames[1][i] - frames[0][i];
          if (delta) changed++;
          if (delta < -2) darker++;
          if (delta > 2) brighter++;
          maximum = Math.max(maximum, Math.abs(delta));
        }
        rows.push({ mode, changed, darker, brighter, maximum, ambientMaximum });
      }
      const unlit = [];
      scene.remove(floor, box);
      const materials = [
        new THREE.MeshBasicMaterial({ color: 0x997755, transparent: true, opacity: .6 }),
        new THREE.ShaderMaterial({ transparent: true,
          vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'void main(){gl_FragColor=vec4(.5,.3,.1,.6);}' }),
        new THREE.RawShaderMaterial({ transparent: true,
          vertexShader: 'precision highp float; uniform mat4 projectionMatrix,modelViewMatrix; attribute vec3 position; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'precision highp float; void main(){gl_FragColor=vec4(.5,.3,.1,.6);}' }),
      ];
      const card = new THREE.Mesh(new THREE.PlaneGeometry(10, 10));
      card.position.set(0, 1, 0); card.quaternion.copy(camera.quaternion); scene.add(card);
      for (const material of materials) {
        card.material = material;
        post.gradeM.uniforms.uTime.value = 0; post.render(0, 15, camera);
        r.readRenderTargetPixels(post.sceneRT, 0, 0, size, size, hdr, undefined, 1);
        let ambientMaximum = 0;
        for (let i = 0; i < hdr.length; i++) if (i % 4 !== 3) ambientMaximum = Math.max(ambientMaximum, THREE.DataUtils.fromHalfFloat(hdr[i]));
        const center = new Uint8Array(4), gl = r.getContext();
        gl.readPixels(size / 2, size / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
        unlit.push({ type: material.type, ambientMaximum, center: [...center] });
      }
      post.setQuality(QUALITY.low);
      if (post.sceneRT) throw Error('Low retained post targets');
      post.setQuality(QUALITY.high); post.render(0, 15, camera);
      const attachments = post.sceneRT.textures.length;
      for (const material of materials) material.dispose();
      card.geometry.dispose();
      return { rows, unlit, error: r.getContext().getError(), attachments };
    } finally {
      post.setQuality(QUALITY.low);
      floor.geometry.dispose(); box.geometry.dispose(); material.dispose();
      r.setDrawingBufferSize(oldSize.x, oldSize.y, ratio);
    }
  }), process.env.GPU === '1' ? 'hardware' : 'swiftshader');
  writeFileSync(out + '/town.png', frame.png);
  writeFileSync(out + '/result.json', JSON.stringify(frame.measurement, null, 2));
  console.log(JSON.stringify(frame.measurement));
  assert.equal(frame.measurement.error, 0);
  assert.equal(frame.measurement.attachments, 2);
  for (const row of frame.measurement.unlit) {
    assert.equal(row.ambientMaximum, 0);
    assert.ok(row.center[0] > 40);
  }
  for (const row of frame.measurement.rows) {
    if (row.mode === 'ambient') {
      assert.ok(row.ambientMaximum > 0.1 && row.darker > 50);
      assert.equal(row.brighter, 0);
    } else {
      assert.equal(row.ambientMaximum, 0);
      assert.equal(row.changed, 0);
    }
  }
} finally { await browser.close(); }
