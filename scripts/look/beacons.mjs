// BASE_URL points to the frozen game. Mesh codes and the one shared FX draw
// must agree across the flash cycle for every model carrying an amber beacon.
import { launch, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto((process.env.BASE_URL ?? 'http://127.0.0.1:5173') + '/dev/vehicles.html');
  await page.waitForFunction(() => window.__lineup?.ready);
  const result = await page.evaluate(async () => {
    const T = await import('/@id/three');
    const { VehicleRenderer } = await import('/src/agents/vehicles.ts');
    const { vehicleModelList } = await import('/src/agents/models/vehicleModels.ts');
    const clock = performance.now;
    let time = 0;
    performance.now = () => time * 1000;
    const rows = [];
    try {
      for (const model of vehicleModelList().filter(m => ['towTruck', 'garbageTruck'].includes(m.kind) || /work/i.test(m.id) && m.kind === 'pickup')) {
        const r = new VehicleRenderer(new T.Scene(), 6);
        const h = r.add(model.kind, 0xeaeaea, { variant: model.id, exact: true, seed: 17 });
        r.setLodOverride(1);
        r.set(h, 0, 0, 0, 0);
        r.setNight(1);
        const b = r.batches.get(model.kind), slot = r.slots[h], i = slot.instance;
        const lamps = r.lampsOf(h);
        b.speed[i] = 3;
        let on = 0, off = 0, mismatches = 0, silentErrors = 0;
        for (let frame = 0; frame < 40; frame++) {
          time = frame / 20;
          r.flush(1 / 20);
          const code = b.variants.get(model.id).near.attrs.misc.array[2];
          const armed = Math.floor(code / 36 + 0.01);
          const flash = Math.sin(time * 8 + b.seed[i] * 13 + 1.6) > 0.15;
          let halos = 0;
          for (let fx = 0; fx < r.fx.n; fx++) {
            const k = fx * 4;
            if (r.fx.f2[k] === 0 && Math.abs(r.fx.f1[k + 1] - 0.55) < 0.001 && Math.abs(r.fx.f1[k + 2] - 0.05) < 0.001) halos++;
          }
          if (armed !== 1 || (flash ? halos !== lamps.beacon.length || !halos : halos !== 0)) mismatches++;
          if (flash) on++; else off++;
        }
        for (const forced of [false, true]) {
          r.setSiren(h, forced);
          r.flush(1 / 20);
          const armed = Math.floor(b.variants.get(model.id).near.attrs.misc.array[2] / 36 + 0.01);
          if (armed !== Number(forced)) silentErrors++;
        }
        rows.push({ model: model.id, beaconPositions: lamps.beacon.length, on, off, mismatches, silentErrors });
        r.dispose();
      }
    } finally { performance.now = clock; }
    return rows;
  });
  console.log(JSON.stringify(result));
  saveReport('shots/look/beacons.json', result);
  if (!result.length || result.some(r => !r.beaconPositions || !r.on || !r.off || r.mismatches || r.silentErrors)) process.exitCode = 1;
} finally { await browser.close(); }
