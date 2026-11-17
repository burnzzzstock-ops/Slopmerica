// BASE_URL and optional NEXT_URL select builds differing only in Ultra's near-detail cap.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { capture, shots } from './golden-scenes.mjs';

const urls = [process.env.BASE_URL || 'http://127.0.0.1:5173'];
if (process.env.NEXT_URL) urls.push(process.env.NEXT_URL);
const out = process.env.OUT || 'shots/people-ultra';
mkdirSync(out, { recursive: true });
const rows = [];
const town = [];
const browser = await launch();

try {
  for (const [index, base] of urls.entries()) {
    const label = index === urls.length - 1 ? 'after' : 'before';
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.goto(base + '/package.json', { waitUntil: 'load' });
    const rig = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { PeopleRenderer, ARCHETYPES } = await import('/src/agents/people.ts');
      const { QUALITY } = await import('/src/config.ts');
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(1280, 720);
      renderer.shadowMap.enabled = false;
      const gl = renderer.getContext();
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const device = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      if (/swiftshader|llvmpipe|basic render|software|WARP/i.test(device)) {
        throw Error('Hardware GPU required');
      }
      const camera = new THREE.PerspectiveCamera(50, 1280 / 720, .1, 1000);
      camera.position.set(0, 24, 30);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const hash = arrays => {
        let value = 2166136261;
        for (const array of arrays) {
          for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) {
            value = Math.imul(value ^ byte, 16777619) >>> 0;
          }
        }
        return value.toString(16);
      };
      const rows = [];
      for (const quality of ['low', 'high', 'ultra']) {
        const q = QUALITY[quality];
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xc8d1d6);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
        const people = new PeopleRenderer(scene, q.maxPeople);
        const count = Math.min(320, q.maxPeople);
        const rowCount = Math.ceil(count / 20);
        people.setDetail(q);
        people.bindRenderer(renderer);
        for (let i = 0; i < count; i++) {
          const handle = people.add(i % ARCHETYPES.length, 1776 + i);
          if (handle !== i) throw Error('Unstable handle allocation');
          people.set(
            handle, (i % 20 - 9.5) * 1.3, 0,
            (Math.floor(i / 20) - (rowCount - 1) / 2) * 1.3, Math.PI, 'idle', 0,
          );
        }
        const data = () => hash([
          people.alive, people.archetypeIndex, people.cadence,
          people.matrices, people.motion, people.style.texture.image.data,
        ]);
        const collect = () => {
          const buffers = new Set();
          for (const value of Object.values(people)) {
            if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
          }
          buffers.add(people.style.texture.image.data.buffer);
          people.object.traverse(object => {
            for (const attr of Object.values(object.geometry?.attributes ?? {})) {
              buffers.add((attr.array ?? attr.data.array).buffer);
            }
            if (object.geometry?.index) buffers.add(object.geometry.index.array.buffer);
            if (object.instanceMatrix) buffers.add(object.instanceMatrix.array.buffer);
          });
          return [...buffers];
        };
        if (quality === 'ultra') people.setDetail({ ...q, peopleNearMax: 120 });
        people.flush([camera.position]);
        renderer.render(scene, camera);
        const initial = data();
        const buffers = collect();
        const poseTarget = people.pose.target;
        const poseTextures = [...poseTarget.textures];
        const before = people.listCounts();
        const random = Math.random;
        let randomDraws = 0;
        Math.random = () => {
          randomDraws++;
          return .5;
        };
        try {
          people.setDetail(q);
          people.flush([camera.position]);
          renderer.info.reset();
          renderer.render(scene, camera);
        } finally {
          Math.random = random;
        }
        const after = people.listCounts();
        const lists = people.listHandles();
        const storage = collect();
        if (
          after.near !== q.peopleNearMax ||
          after.far !== count - q.peopleNearMax ||
          after.used !== count
        ) {
          throw Error('Wrong ' + quality + ' near/far counts ' + JSON.stringify(after));
        }
        if (new Set([...lists.near, ...lists.far]).size !== count) {
          throw Error('Missing or duplicated people');
        }
        if (initial !== data() || randomDraws) throw Error('Detail cap changed people or RNG');
        if (
          storage.length !== buffers.length ||
          storage.some((buffer, i) => buffer !== buffers[i]) ||
          people.pose.target !== poseTarget ||
          poseTextures.some((texture, i) => texture !== poseTarget.textures[i])
        ) {
          throw Error('Detail cap replaced buffers or pose targets');
        }
        rows.push({
          quality, capacity: q.maxPeople, nearRange: q.peopleNear,
          nearCap: q.peopleNearMax, before, after, dataHash: initial,
          bufferBytes: buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
          poseTarget: [poseTarget.width, poseTarget.height, poseTarget.textures.length],
          randomDraws, buffersUnchanged: true,
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          png: renderer.domElement.toDataURL().split(',')[1],
        });
        people.dispose();
      }
      if (gl.getError() !== 0) throw Error('WebGL error after citizen detail changes');
      renderer.dispose();
      return { device, rows };
    });
    await page.close();
    assert.deepEqual(errors, []);

    for (const { png, ...row } of rig.rows) {
      writeFileSync(`${out}/${label}-${row.quality}-crowd.png`, Buffer.from(png, 'base64'));
      rows.push({ label, device: rig.device, ...row });
      const before = rows.find(other => other.label === 'before' && other.quality === row.quality);
      if (label === 'after' && before) {
        for (const key of ['capacity', 'nearRange', 'dataHash', 'bufferBytes', 'poseTarget']) {
          assert.deepEqual(row[key], before[key]);
        }
        if (row.quality !== 'ultra') {
          for (const key of ['nearCap', 'after', 'calls', 'triangles']) {
            assert.deepEqual(row[key], before[key]);
          }
        }
      }
      if (label === 'after' && row.quality === 'ultra') {
        assert.equal(row.nearCap, 200);
        assert.equal(row.capacity, 580);
        assert.equal(row.nearRange, 64);
      }
      console.log(label, JSON.stringify(row));
    }

    for (const quality of ['low', 'high', 'ultra']) {
      const shot = {
        ...shots.find(shot => shot.id === `block-${quality === 'ultra' ? 'high' : quality}-junction-noon`),
        quality,
      };
      const frame = await capture(browser, shot, base, false, async page => page.evaluate(() => {
        const g = window.__game;
        const p = g.peds.renderer;
        const initial = JSON.stringify(window.__dbg.fingerprint());
        const handles = JSON.stringify(g.peds.peds.map(person => [person.id, person.h]));
        for (let i = 0; i < 4; i++) g.frame(0);
        if (
          JSON.stringify(window.__dbg.fingerprint()) !== initial ||
          JSON.stringify(g.peds.peds.map(person => [person.id, person.h])) !== handles
        ) {
          throw Error('Detail changed town simulation/handles');
        }
        return {
          population: g.sim.population, buildings: g.buildings.list.size,
          nearCap: p.detail.nearMax, capacity: g.q.maxPeople, nearRange: g.q.peopleNear,
          counts: p.listCounts(), calls: g.perf.calls, triangles: g.perf.triangles,
          simulationUnchanged: true,
        };
      }), process.env.GPU === '1' ? 'hardware' : 'swiftshader');
      town.push({ label, quality, ...frame.measurement });
      writeFileSync(`${out}/${label}-${quality}-town.png`, frame.png);
      const before = town.find(other => other.label === 'before' && other.quality === quality);
      if (label === 'after' && before) {
        for (const key of ['population', 'buildings', 'capacity', 'nearRange', 'counts', 'calls', 'triangles']) {
          assert.deepEqual(frame.measurement[key], before[key]);
        }
      }
      if (label === 'after' && quality === 'ultra') assert.equal(frame.measurement.nearCap, 200);
      console.log(label, quality, 'town', JSON.stringify(frame.measurement));
    }
    writeFileSync(`${out}/result.json`, JSON.stringify({ rows, town }, null, 2) + '\n');
  }
} finally {
  await browser.close();
}
console.log('PASS Ultra200 near citizens, fixed logical capacity/arrays/pose targets/RNG, exact Low/High and actual-town simulation');
