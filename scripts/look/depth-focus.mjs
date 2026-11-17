// Two equal-size stripe panels on the same screen row, separated in depth.
// Moving focus should move the sharp stripes from one panel to the other.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/browser.mjs';
import { seededInit, seededRandom } from '../refblock.mjs';

const label = process.argv[2] || 'current';
if (!/^[\w-]+$/.test(label)) throw Error('Invalid capture label');
const out = join('shots/look/focus', label);
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5195';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
  page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
  await page.addInitScript(seededInit, { seed: 1776, rng: seededRandom.toString() });
  await page.addInitScript(() => {
    localStorage.setItem('slopmerica.quality', 'high');
    localStorage.setItem('slopmerica.onboarded', '1');
    localStorage.setItem('slopmerica.resolution', 'full');
  });
  await page.goto(`${base}/#skip&map=appalachia&mode=sandbox`, { timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__dbg, null, { timeout: 300000 });
  const world = await page.evaluate(() => {
    const g = window.__game; g.stop(); g.sim.speed = 0;
    g.sim.day = g.sim.lastWhole = 120; window.__reseed(1776);
    window.__dbg.hour(12.5); g.weather.force('clear', 30); g.weather.settle();
    g.rts.setView(10, -170, 1440, 0.48, 0.53, true);
    g.frame(0, true);
    const canvas = g.renderer.domElement, sheet = document.createElement('canvas');
    sheet.width = canvas.width; sheet.height = 2 * (canvas.height + 24);
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#191b1b'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (const [i, enabled] of [false, true].entries()) {
      g.post.tiltShift = enabled; g.post.render(0, g.rts.distance);
      const y = i * (canvas.height + 24); ctx.drawImage(canvas, 0, y);
      ctx.font = '14px system-ui'; ctx.fillStyle = '#eee'; ctx.fillText(enabled ? 'Tilt-shift on' : 'Tilt-shift off', 8, y + canvas.height + 17);
    }
    return sheet.toDataURL('image/jpeg', 0.92).split(',')[1];
  });
  writeFileSync(join(out, 'overview.jpg'), Buffer.from(world, 'base64'));
  await page.evaluate(async () => {
    const g = window.__game; g.stop();
    const source = await (await fetch('/src/render/post.ts')).text();
    const THREE = await import(source.match(/from\s+["']([^"']*three[^"']*)["']/)[1]);
    const { PostFX } = await import('/src/render/post.ts');
    const camera = g.camera; camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1);
    camera.near = 1; camera.far = 50000; camera.updateProjectionMatrix();
    const scene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 coord; void main(){coord=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 coord; void main(){float v=mix(0.03,0.8,step(0.5,fract(coord.x*60.0)));gl_FragColor=vec4(vec3(v),1.);}',
    });
    for (const [depth, side] of [[1000, -1], [3500, 1]]) {
      const h = 2 * depth * Math.tan(camera.fov * Math.PI / 360);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(h * camera.aspect * 0.48, h * 0.9), material);
      panel.position.set(side * h * camera.aspect * 0.25, 0, -depth); scene.add(panel);
    }
    // Construct the normal post pipeline for this scene, including its ambient
    // output attachment. Game water and sky hooks belong to the original world.
    const p = new PostFX(g.renderer, scene, camera, g.q);
    window.__focusPost = p;
    p.bloomOn = false; p.vignette = false; p.ao = false;
  });
  const metrics = {};
  for (const [name, distance] of [['off', 1000], ['near', 1000], ['far', 3500], ['street', 40]]) {
    const { energy, img } = await page.evaluate(([kind, focus]) => {
      const g = window.__game, p = window.__focusPost;
      p.tiltShift = kind !== 'off'; p.render(0, focus);
      const c = document.createElement('canvas'), screen = g.renderer.domElement;
      c.width = screen.width; c.height = screen.height;
      const ctx = c.getContext('2d'); ctx.drawImage(screen, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      function edgeEnergy(mid) {
        let sum = 0, n = 0;
        for (let y = Math.floor(c.height * 0.45); y < c.height * 0.55; y++) {
          for (let x = Math.floor(c.width * (mid - 0.15)); x < c.width * (mid + 0.15); x++) {
            const i = (y * c.width + x) * 4; sum += Math.abs(data[i + 4] - data[i]); n++;
          }
        }
        return sum / n;
      }
      return { energy: [edgeEnergy(0.25), edgeEnergy(0.75)], img: c.toDataURL('image/png').split(',')[1] };
    }, [name, distance]);
    metrics[name] = energy;
    writeFileSync(join(out, name + '.png'), Buffer.from(img, 'base64'));
  }
  const ratio = name => metrics[name].map((v, i) => v / metrics.off[i]);
  const [nearL, nearR] = ratio('near'), [farL, farR] = ratio('far'), street = ratio('street');
  const pass = metrics.off.every(v => v > 10) && nearL > 0.97 && nearR < 0.65 && farL < 0.65 && farR > 0.97 && street.every(v => v > 0.97);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ metrics, near: [nearL, nearR], far: [farL, farR], street, pass }, null, 2));
  console.log(pass ? 'OK' : 'FAIL', 'near, far and street edge-energy ratios', ratio('near'), ratio('far'), street);
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }
