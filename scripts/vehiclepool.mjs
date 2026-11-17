// BASE_URL is intentionally unused: this renderer contract test runs through Vite SSR, without a browser.
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server = await createServer({ root: process.cwd(), cacheDir: 'shots/tmp/vite/vehiclepool-' + process.pid, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const rows = [];
const check = (name, pass, detail) => { rows.push({ name, pass, detail }); console.log(pass ? 'OK' : 'FAIL', name, detail ?? ''); };
try {
  const { VehicleRenderer, VEHICLE_SPECS } = await server.ssrLoadModule('/src/agents/vehicles.ts');
  const T = await server.ssrLoadModule('three');
  const scene = new T.Scene(), r = new VehicleRenderer(scene, 12);
  while (r.pending.length) r.warm();
  r.setLodOverride(1);
  const camera = new T.PerspectiveCamera(50, 1.6, 0.1, 5000);
  camera.position.set(0, 15, -25); camera.lookAt(0, 0, 60); camera.updateMatrixWorld(true);
  const cars = [];
  const makeCar = (id, x, z, h = -1) => ({ id, h, kind: 'sedan', paint: 0xf2f2f2, crashed: 0, parked: false,
    x, y: 0, z, yaw: 0, v: 12, acc: 0, turn: 0, brakeT: 0, dep: 0, arr: -1, posed: true,
    shown: new Float64Array([x, 0, z, 0]), pose: new Float64Array([x + 4, 0, z, 0, .1, -.1]),
    pose0: new Float64Array([x - 4, 0, z, 0, -.1, .1]) });
  for (let i = 0; i < 12; i++) {
    const h = r.add('sedan', 0xff0000, { exact: true, seed: i + 1 });
    r.set(h, (i - 6) * 8, 0, 700, 0); cars.push(makeCar(i + 1, (i - 6) * 8, 700, h));
  }
  for (let i = 0; i < 4; i++) cars.push(makeCar(100 + i, (i - 1.5) * 6, 30));
  check('legacy capacity remains full', r.add('sedan', 0) === -1 && r.stats().active === 12);
  const before = JSON.stringify(cars), rngBefore = r.rngState;
  const originalAppearance = [...r.batches.get('sedan').paint];
  r.observeTraffic(cars, camera, .5, 'low');
  const realRandom = Math.random; let rngCalls = 0; Math.random = () => { rngCalls++; return realRandom(); };
  r.flush(1 / 60);
  Math.random = realRandom;
  const first = r.presentationStats();
  check('nearest four unallocated cars are drawn', cars.slice(12).every(c => r.isCarDrawn(c.id)) && first.unallocatedDrawn === 4, first);
  check('global cap preserved', first.selected === 12 && first.drawnCars.length === 12);
  check('observation leaves every car and handle unchanged', before === JSON.stringify(cars));
  check('appearance RNG and global RNG unchanged', r.rngState === rngBefore && rngCalls === 0, { rngCalls });
  check('allocated paint and capacity preserved', JSON.stringify(originalAppearance) === JSON.stringify([...r.batches.get('sedan').paint]) && r.stats().active === 12);
  const virtual = r.presentationBatches.get('sedan'), record = r.drawnSlots.get(100), vi = record.slot;
  check('shown pose is consumed once, without a second interpolation', virtual.matrices[vi * 16 + 12] === cars[12].shown[0] && Math.abs(virtual.matrices[vi * 16 + 9]) < 1e-6);
  scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(cars[12].shown[0], 20, 30), new T.Vector3(0, -1, 0));
  check('new pick identifies a drawn car without a handle', r.pickCarId(ray) === 100, r.pickCarId(ray));
  const allocated = cars.find(c => c.h >= 0 && r.isCarDrawn(c.id));
  ray.set(new T.Vector3(allocated.x, 20, allocated.z), new T.Vector3(0, -1, 0));
  check('legacy pick still resolves allocated handles', r.pick(ray) === allocated.h);
  const style = () => [virtual.seed[vi], virtual.variantOf[vi], ...virtual.paint.slice(vi * 3, vi * 3 + 3), ...virtual.look.slice(vi * 4, vi * 4 + 4)];
  const firstStyle = style();
  camera.position.set(0, 15, 1400); camera.lookAt(0, 0, 700); camera.updateMatrixWorld(true);
  r.observeTraffic(cars, camera, .5, 'low'); r.flush(.5);
  check('camera move immediately exchanges presentation membership', !r.isCarDrawn(100) && r.presentationStats().drawnCars.some(id => id < 100));
  camera.position.set(0, 15, -25); camera.lookAt(0, 0, 60); camera.updateMatrixWorld(true);
  r.observeTraffic(cars, camera, .5, 'low'); r.flush(.5);
  const again = r.drawnSlots.get(100), ai = again.slot;
  const againStyle = [virtual.seed[ai], virtual.variantOf[ai], ...virtual.paint.slice(ai * 3, ai * 3 + 3), ...virtual.look.slice(ai * 4, ai * 4 + 4)];
  check('unallocated appearance survives eviction and return', JSON.stringify(firstStyle) === JSON.stringify(againStyle));
  const fixedScans = r.presentationStats().scans;
  for (let i = 0; i < 20; i++) r.flush(.01);
  check('selection is throttled between camera changes', r.presentationStats().scans === fixedScans);
  // A parked handle is not reassigned or removed when a nearer unallocated trip replaces its drawing.
  r.setParked(cars[0].h, true); const parkedHandle = cars[0].h; cars.shift();
  r.flush(.5);
  check('parking still owns its original handle', r.slots[parkedHandle] !== undefined && r.isReversing(parkedHandle) === false && r.stats().active === 12);
  const removed = cars.pop(); r.flush(.01);
  check('departed unallocated car disappears before the next rank scan', !r.isCarDrawn(removed.id));
  const matricesFinite = [...r.presentationBatches.values()].every(b => [...b.matrices].every(Number.isFinite));
  check('presentation matrices stay finite', matricesFinite);
  // Large pool: steady-camera CPU measurement, including two rank scans per second.
  const many = Array.from({ length: 5000 }, (_, i) => makeCar(i + 10000, (i % 70 - 35) * 8, 40 + Math.floor(i / 70) * 8));
  r.observeTraffic(many, camera, 1, 'low'); r.flush(.5);
  const times = [];
  for (let i = 0; i < 360; i++) { const start = performance.now(); r.flush(1 / 60); times.push(performance.now() - start); }
  times.sort((a,b) => a-b);
  check('5,000 observed cars remain bounded', r.presentationStats().selected === 12 && r.stats().active === 12,
    { medianMs: times[180], p95Ms: times[342], worstMs: times.at(-1), selected: r.presentationStats().selected });
  r.dispose();
  for (const cap of [450, 1400]) {
    const rr = new VehicleRenderer(new T.Scene(), cap);
    while (rr.pending.length) rr.warm();
    rr.setLodOverride(1);
    const kinds = Object.keys(VEHICLE_SPECS);
    for (let i = 0; i < many.length; i++) many[i].kind = kinds[i % kinds.length];
    rr.observeTraffic(many, camera, 1, cap === 450 ? 'low' : 'high'); rr.flush(.5);
    const samples = [];
    for (let i = 0; i < 360; i++) { const start = performance.now(); rr.flush(1 / 60); samples.push(performance.now() - start); }
    samples.sort((a,b) => a-b);
    const detail = { cap, observed: many.length, drawn: rr.presentationStats().drawnCars.length, medianMs: samples[180], p95Ms: samples[342], worstMs: samples.at(-1) };
    check(`5,000 observed / ${cap} drawn cap`, detail.drawn === cap && rr.stats().active === 0, detail);
    rr.dispose();
  }
} finally { await server.close(); }
mkdirSync('shots/vehicle-pool', { recursive: true });
writeFileSync('shots/vehicle-pool/unit.json', JSON.stringify({ passed: rows.every(r => r.pass), rows }, null, 2));
if (rows.some(r => !r.pass)) process.exitCode = 1;
