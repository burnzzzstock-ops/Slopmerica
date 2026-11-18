// BASE_URL selects the frozen material candidate through measure.openScene.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, openScene, preflight, fixtureHash } from './measure.mjs';

const out = process.env.OUT || 'shots/look/material-state';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const rendererName = await preflight(browser, true);
  const { page, errs, town } = await openScene(browser, { scene: 'reference', quality: 'high', width: 1280, height: 720 });
  const result = await page.evaluate(async () => {
    const g = window.__game;
    const source = await (await fetch('/src/buildings/material.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { buildingMaterial } = await import('/src/buildings/material.ts');
    const { kitMaterial } = await import('/src/buildings/kitGenerator.ts');
    const { finishTexture, Finish } = await import('/src/art/surfaceDetail.ts');
    const { T } = await import('/src/art/atlas.ts');
    const { applySave } = await import('/src/sim/save.ts');
    const { atmo } = await import('/src/world/seasons.ts');
    const savedFill = atmo.uFill.value.clone();
    const texture = finishTexture();
    const rough = layer => texture.image.data[layer * 64 * 64 * 4 + 2] / 255;
    const roughness = { glass: rough(Finish.glass), brick: rough(Finish.brick) };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
    camera.position.set(0, 0, 12);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(0, 0, 10);
    const ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(sun, ambient);
    const target = new THREE.WebGLRenderTarget(96, 96);
    const savedTarget = g.renderer.getRenderTarget();
    const pixels = new Uint8Array(96 * 96 * 4);
    const occlusion = [];
    try {
      for (const pipeline of ['atlas', 'kit']) {
        const geometry = new THREE.PlaneGeometry(8, 8);
        const count = geometry.getAttribute('position').count;
        const visibility = new THREE.BufferAttribute(new Float32Array(count).fill(1), 1);
        geometry.setAttribute('ambientVisibility', visibility);
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
        geometry.setAttribute('tile', new THREE.BufferAttribute(new Float32Array(count).fill(2), 1));
        geometry.setAttribute('buildClipY', new THREE.BufferAttribute(new Float32Array(count), 1));
        if (pipeline === 'atlas') {
          const tile = T('brick'), uv = geometry.getAttribute('uv');
          for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, tile.u0 + uv.getX(i) * (tile.u1 - tile.u0), tile.v0 + uv.getY(i) * (tile.v1 - tile.v0));
          }
        }
        const material = pipeline === 'atlas' ? buildingMaterial() : kitMaterial();
        const plane = new THREE.Mesh(geometry, material);
        scene.add(plane);
        const draw = amount => {
          visibility.array.fill(amount);
          visibility.needsUpdate = true;
          g.renderer.setRenderTarget(target);
          g.renderer.render(scene, camera);
          g.renderer.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
          return pixels.slice();
        };
        const mean = data => {
          let sum = 0, n = 0;
          for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) {
            const i = (y * 96 + x) * 4;
            sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
            n++;
          }
          return sum / n;
        };
        sun.intensity = 1; ambient.intensity = 0;
        atmo.uFill.value.setRGB(0, 0, 0);
        const direct = draw(1), directOccluded = draw(.5);
        sun.intensity = 0; ambient.intensity = 2;
        atmo.uFill.value.copy(savedFill);
        const indirect = draw(1), indirectOccluded = draw(.5);
        occlusion.push({ pipeline, directEqual: direct.every((value, i) => value === directOccluded[i]),
          directMean: mean(direct), ambientRatio: mean(indirectOccluded) / mean(indirect) });
        scene.remove(plane);
        geometry.dispose();
        if (pipeline === 'kit') material.dispose();
      }
    } finally {
      g.renderer.setRenderTarget(savedTarget);
      atmo.uFill.value.copy(savedFill);
      target.dispose();
    }

    const saved = JSON.parse(window.__dbg.snapshot());
    const fields = g.fields;
    const color = new THREE.Vector4();
    const rows = [];
    const fingerprint = () => JSON.stringify(window.__dbg.fingerprint());
    const checkFinishes = label => {
      const before = fingerprint();
      g.finishes.update(g);
      let maxError = 0;
      for (const b of g.buildings.list.values()) {
        const mesh = b.zone === 'service' && !b.onMain ? g.buildings.kitMesh : g.buildings.mesh;
        mesh.getColorAt(b.inst, color);
        const expected = 1 - Math.min(1, Math.min(1, g.fields.buildingAge(b.id) / 365) * .35 + (1 - g.fields.buildingCondition(b.id)) * .65);
        maxError = Math.max(maxError, Math.abs(color.w - expected));
      }
      rows.push({ label, maxError, unchanged: before === fingerprint(), count: g.buildings.list.size });
    };
    try {
      checkFinishes('live fields');
      g.fields = { ...fields, buildingAge: () => 730, buildingCondition: () => .25 };
      checkFinishes('changed condition within the same day');
      const b = [...g.buildings.list.values()].find(b => b.zone === 'resLow');
      g.buildings.setTint(b, new THREE.Color(.2, .4, .6));
      checkFinishes('info tint');
      g.buildings.mesh.getColorAt(b.inst, color);
      const tintKept = [.2, .4, .6].every((v, i) => Math.abs(v - color.getComponent(i)) < 1e-6);
      applySave(g, saved);
      checkFinishes('same-day same-count reload');
      g.fields = fields;
      checkFinishes('restored real fields');
      return { roughness, occlusion, rows, tintKept, glError: g.renderer.getContext().getError() };
    } finally { g.fields = fields; }
  });
  writeFileSync(out + '/result.json', JSON.stringify({ rendererName, town, fixture: fixtureHash(), result, errors: errs }, null, 2));
  assert.equal(errs.length, 0, errs.join('\n'));
  assert(Math.abs(result.roughness.glass - .12) < .003);
  assert(Math.abs(result.roughness.brick - .88) < .003);
  assert(result.occlusion.every(row => row.directEqual && row.directMean > 2 && row.ambientRatio > .45 && row.ambientRatio < .55));
  assert(result.rows.every(row => row.maxError < 1e-6 && row.unchanged));
  assert(result.tintKept);
  assert.equal(result.glError, 0);
  console.log('PASS', JSON.stringify(result));
} finally { await browser.close(); }
