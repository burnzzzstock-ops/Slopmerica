// BASE_URL serves the frozen game through openScene. Real-source A4 wiring:
// normal frame entry, live traffic and legal landmarks.
import { launch } from '../lib/browser.mjs';
import { openScene, identifyRenderer, fixtureHash, saveReport } from './measure.mjs';
const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const { page, errs, town } = await openScene(browser, { scene: 'reference', quality: 'low', width: 390, height: 844, phone: true });
  const renderer = await page.evaluate(identifyRenderer, true);
  const result = await page.evaluate(async () => {
    const { WorldSoundSources } = await import('/src/audio/worldSources.ts');
    const { BRANDS } = await import('/src/art/brands.ts');
    const g = window.__game, tr = g.traffic, P = g.parking, audio = g.audio, sampler = new WorldSoundSources();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    audio.unlock(); await sleep(100);
    const aim = source => g.rts.setView(source.x, source.z, 60, 0, 0.5, true);
    const peek = () => ({ world: audio.worldVoices.debug(), street: audio.streetVoices.debug(), state: JSON.parse(JSON.stringify(audio.debugState())) });
    let calendarLock = false;
    const frame = (dt = 0.1) => { if (calendarLock) { g.hour = 10; g.sim.day = 2; } g.frame(dt, false); };
    const focus = async source => { aim(source); for (let i = 0; i < 25; i++) { frame(0.02); await sleep(20); } };
    const result = { queue: null, reversing: null, radios: {}, siren: null, landmarks: {}, sleep: {}, queueSeen: 0, reverseSeen: 0, departures: 0 };
    P.inView = () => false;
    tr.crosswalkWalkers = undefined;
    let thru = [...g.buildings.list.values()].find(b => tr.thruAt(b));
    // The exact reference fixture has no procedural drive-thru. Add a legal
    // generated commercial lot; only its brand/variant are fixture choices.
    // Cars, parking transfers and queue entry still use the real systems.
    if (!thru) {
      for (const cell of g.zones.cells.values()) {
        if (!cell.valid || cell.bld || cell.row !== 0) continue;
        g.zones.paint(cell.x, cell.z, 50, 'comLow');
        const lot = g.zones.lotFrom(cell, 4, 4);
        if (!lot || lot.length < 3 || lot[0].length < 3) continue;
        let variant = -1;
        for (let i = 0; i < 40; i++) {
          const model = g.buildings.modelFor('comLow', 1, lot.length, lot[0].length, i, 'burgerBaron').model;
          if (model.spots?.some(p => p.kind === 'thru')) { variant = i; break; }
        }
        if (variant < 0) continue;
        const brandFor = g.buildings.brandFor, integer = g.buildings.rng.int;
        try {
          g.buildings.brandFor = () => BRANDS.find(b => b.id === 'burgerBaron');
          g.buildings.rng.int = () => variant;
          thru = g.buildings.create('comLow', 1, lot);
        } finally { g.buildings.brandFor = brandFor; g.buildings.rng.int = integer; }
        g.buildings.tickConstruction(1000, 1);
        result.authoredLot = { id: thru.id, variant, width: thru.w, depth: thru.d, spots: thru.model.spots.length, link: g.linkProblem(thru) ?? null };
        break;
      }
    }
    result.thru = thru ? { id: thru.id, label: thru.label, instance: thru.inst, offNet: thru.offNet ?? null } : null;
    if (thru) tr.grandOpening(thru);
    g.sim.speed = 1;
    for (let f = 0; f < 10000; f++) {
      tr.update(0.05, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target);
      tr.draw?.(1);
      P.update(0.05, 12.5, g.rts.target.x, g.rts.target.z, 500, () => tr.renderer.stats().active);
      if (!result.queue && result.queueSeen < 8) {
        const car = tr.cars.find(c => c.h >= 0 && c.thru?.out === -1 && c.thru.L.q.includes(c));
        if (car) {
          result.queueSeen++;
          await focus(car.thru.L.slots[0]);
          const source = sampler.sample(g).find(s => s.active && s.kind === 'intercom');
          if (source) result.queue = { ...source, building: car.thru?.L.b.id, queueCars: car.thru?.L.q.length, voice: peek().world.find(s => s.id === source.id) };
        }
      }
      if (!result.reversing && result.reverseSeen < 8) {
        result.departures += tr.cars.filter(c => c.fromSpot).length;
        const car = tr.cars.find(c => c.fromSpot && c.h >= 0 && tr.renderer.isReversing(c.h));
        if (car) {
          result.reverseSeen++;
          await focus(car);
          const voice = peek().street.find(v => v.id === car.id && v.reversing);
          if (voice) result.reversing = { id: car.id, fromBuilding: car.fromSpot.b.id, handle: car.h, voice };
        }
      }
      for (const kind of ['liftedTruck', 'cyberslop']) if (!result.radios[kind]) {
        const car = tr.cars.find(c => c.kind === kind && c.h >= 0 && c.v > 3 && c.crashed === 0);
        if (car) {
          await focus(car);
          const voice = peek().street.find(v => v.id === car.id && v.radio > 0);
          if (voice) result.radios[kind] = { id: car.id, handle: car.h, speed: car.v, voice };
        }
      }
      if (!result.siren) {
        const car = tr.cars.find(c => ['police', 'ambulance', 'firetruck'].includes(c.kind) && c.h >= 0 && c.v > 3 && c.crashed === 0);
        if (car) {
          await focus(car);
          const voice = peek().street.find(v => v.id === car.id && v.type === 'siren');
          if (voice) result.siren = { id: car.id, handle: car.h, kind: car.kind, voice };
        }
      }
      if (result.queue && result.radios.liftedTruck && result.radios.cyberslop && result.siren) break;
    }
    // Guarantee a departure through the actual public dispatcher and actual
    // occupied stall. Camera motion must not decide whether this test gets one.
    if (!result.reversing && thru) {
      aim(thru);
      for (let i = 0; i < 4; i++) P.update(0.6, 12.5, thru.x, thru.z, 120, () => tr.renderer.stats().active);
      const parked = [...P.parked].find(p => p.spot.b === thru);
      result.parkingFixture = { count: P.parkedAt(thru).cars, kind: parked?.kind ?? null };
      if (parked) for (const destination of g.buildings.list.values()) {
        if (destination === thru || destination.state !== 'active') continue;
        const car = tr.dispatch(parked.kind, thru, destination, 'leaving a parking spot', destination.label, 12.5, { local: true, sober: true });
        if (!car) continue;
        // One complete fixed step establishes the departure pose before aiming.
        tr.update(0.1, 1, 12.5, g.sim.population, g.sim.jobsFilled, g.rts.target); tr.draw(1);
        // Let renderer selection and the old voice's release finish while the
        // actual departure advances only0.6 game seconds (its reverse phase is short).
        aim(car);
        for (let i = 0; i < 80; i++) { frame(0.0075); await sleep(20); }
        const voice = peek().street.find(v => v.id === car.id && v.reversing);
        result.parkingFixture.departure = { id: car.id, dep: car.dep, posed: car.posed, fromSpot: !!car.fromSpot, drawn: tr.renderer.isCarDrawn?.(car.id) ?? car.h >= 0, reverse: tr.renderer.isReversing(car.h), voices: peek().street.map(v => [v.id, v.reversing]) };
        if (voice && car.fromSpot) result.reversing = { id: car.id, fromBuilding: car.fromSpot.b.id, handle: car.h, voice, dispatched: true };
        break;
      }
    }
    const place = id => {
      const existing = [...g.buildings.list.values()].find(b => b.landmark === id);
      if (existing) return existing;
      for (const segment of g.net.segs.values()) for (const f of [0.5, 0.3, 0.7]) for (const side of [1, -1]) for (const offset of [20, 35, 50, 70]) {
        const points = segment.samp.pts, i = Math.floor(f * (points.length - 1)), a = points[i], b = points[Math.min(points.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
        const spot = g.landmarkSpot(id, a.x - dz / len * side * offset, a.z + dx / len * side * offset);
        if (spot.ok && spot.front && g.placeLandmark(id, { x: spot.x, z: spot.z })) {
          g.buildings.tickConstruction(1000, 1);
          return [...g.buildings.list.values()].find(b => b.landmark === id);
        }
      }
      return null;
    };
    for (const id of ['slop69Field', 'megachurch']) {
      const building = place(id); if (!building) { result.landmarks[id] = null; continue; }
      aim(building); g.hour = id === 'megachurch' ? 10 : 19; g.sim.day = 2;
      for (let i = 0; i < 6; i++) frame();
      const active = sampler.sample(g).filter(s => s.active).map(s => ({ ...s })), voice = peek().world.find(s => s.id === building.id);
      const savedInstance = building.inst, savedState = building.state, savedLink = building.offNet;
      building.inst = -1; const undrawn = sampler.sample(g).some(s => s.active && s.id === building.id); building.inst = savedInstance;
      building.state = 'building'; const constructing = sampler.sample(g).some(s => s.active && s.id === building.id); building.state = savedState;
      building.offNet = 'noRoad'; const disconnected = sampler.sample(g).some(s => s.active && s.id === building.id); building.offNet = savedLink;
      g.sim.day = 3; const monday = sampler.sample(g).some(s => s.active && s.id === building.id);
      g.sim.day = 2; g.hour = 2; const closed = sampler.sample(g).some(s => s.active && s.id === building.id);
      result.landmarks[id] = { building: building.id, instance: building.inst, active, voice, monday, closed, undrawn, constructing, disconnected, offNet: building.offNet ?? null };
    }
    const church = [...g.buildings.list.values()].find(b => b.landmark === 'megachurch');
    if (church) {
      aim(church); g.hour = 10; g.sim.day = 2;
      calendarLock = true;
      const frames = async n => { for (let i = 0; i < n; i++) { frame(); await sleep(25); } };
      await frames(8); result.sleep.awake = peek();
      g.rts.setView(church.x, church.z, 1800, 0, 0.5, true); await frames(25); result.sleep.zoom = peek();
      aim(church); g.sim.speed = 0; await frames(25); result.sleep.pause = peek();
      g.sim.speed = 1; audio.setMuted(true); await frames(25); result.sleep.mute = peek();
      audio.setMuted(false); audio.soundOn = false; await frames(25); result.sleep.soundOff = peek();
      audio.soundOn = true; await frames(25); result.sleep.resume = peek();
    }
    const crashCar = tr.cars.find(c => c.crashed === 0 && c.h >= 0), calls = [];
    if (crashCar) {
      const playAt = audio.playAt.bind(audio); audio.playAt = (...args) => { calls.push(args); playAt(...args); };
      const segment = g.net.segs.get(crashCar.path[crashCar.pi]?.seg);
      tr.crash([crashCar], segment, false);
      result.wreck = { id: crashCar.id, crashed: crashCar.crashed, calls: calls.filter(c => c[0] === 'crash'), x: crashCar.x, z: crashCar.z };
    }
    return result;
  });
  result.renderer = renderer; result.browser = browser.version(); result.town = town; result.fixtureHash = fixtureHash(); result.errors = errs;
  const field = result.landmarks.slop69Field, church = result.landmarks.megachurch;
  result.passed = !!(result.queue?.voice && result.reversing?.voice && result.radios.liftedTruck && result.radios.cyberslop && result.siren &&
    field?.voice && !field.closed && church?.voice && !church.monday && !church.closed && [field, church].every(b => !b.undrawn && !b.constructing && !b.disconnected) && result.wreck?.calls.length === 1 &&
    ['zoom', 'pause', 'mute', 'soundOff'].every(key => result.sleep[key]?.world.length === 0 && result.sleep[key]?.state.streetVoices === 0) &&
    result.sleep.resume?.world.length > 0 && errs.length === 0);
  saveReport('shots/audio/world/sources.json', result); console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
} finally { await browser.close(); }
