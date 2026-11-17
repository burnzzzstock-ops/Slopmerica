// BASE_URL serves the current game. Count audio requests from real building,
// road and weekly-close operations, then check pending typed event consumers.
import { launch, openScene, saveReport } from './measure.mjs';
const browser = await launch();
try {
  const { page, errs } = await openScene(browser, { quality: 'low', scene: 'reference', width: 390, height: 844, phone: true });
  const report = await page.evaluate(async () => {
    const { bindWorldAudio } = await import('/src/audio/events.ts');
    const { ROAD_TYPES } = await import('/src/roads/roadTypes.ts');
    const { MAX_LEVEL } = await import('/src/contracts.ts');
    const T = await import('/@id/three');
    const g = window.__game, calls = [];
    g.audio.play = (kind, volume) => calls.push({ kind, volume });
    g.audio.playAt = (kind, x, z, volume) => calls.push({ kind, x, z, volume });
    g.audio.zonePaint = (x, z, cells) => calls.push({ kind: 'zone', x, z, cells });
    bindWorldAudio(g); bindWorldAudio(g);
    const building = [...g.buildings.list.values()].find(b => b.state === 'active' && MAX_LEVEL[b.zone] > b.level);
    if (!building) throw Error('Reference needs an upgradable building');
    const atBuilding = kind => calls.filter(c => c.kind === kind && c.x === building.x && c.z === building.z).length;
    g.buildings.levelUp(building);
    const level = atBuilding('levelUp');
    g.buildings.tickConstruction(1000, 1);
    const completed = atBuilding('build');
    g.buildings.tickConstruction(1000, 1);
    const completionRepeat = atBuilding('build') - completed;
    const demolished = g.bulldozeAt(new T.Vector3(building.x, building.y, building.z));
    const demolition = atBuilding('bulldoze');
    g.buildings.demolish(building, 'bulldozed');
    const demolitionRepeat = atBuilding('bulldoze') - demolition;
    calls.length = 0;
    const segment = [...g.net.segs.values()].find(s => ROAD_TYPES[s.type].next);
    const upgrade = g.upgradeRoads([segment]);
    const lane = calls.filter(c => c.kind === 'build').length;
    calls.length = 0;
    g.bulldozeRoad(segment); g.bulldozeRoad(segment);
    const roadBulldoze = calls.filter(c => c.kind === 'bulldoze').length;
    calls.length = 0;
    g.sim.weekly();
    const week = calls.filter(c => c.kind === 'cash' || c.kind === 'error').length;
    calls.length = 0;
    g.sim.events.emit('milestone', { kind: 'tier', value: 1, label: 'Audio test' });
    const milestone = calls.filter(c => c.kind === 'levelUp').length;
    calls.length = 0;
    g.sim.events.emit('moneyTick', { delta: 120, kind: 'tax', x: 11, z: 12 });
    g.sim.events.emit('moneyTick', { delta: -120, kind: 'upkeep' });
    g.sim.events.emit('zonePainted', { zone: 'resLow', cells: 8, x: 21, z: 22, r: 30 });
    g.sim.events.emit('treesCleared', { x: 31, z: 32, r: 30, count: 4, cause: 'tool' });
    g.sim.events.emit('crash', { x: 41, z: 42, severity: 0.5, segId: -1 });
    g.sim.events.emit('paradisePaved', { x: 0, z: 0 });
    g.sim.events.emit('collapseStage', { stage: 3 });
    const pending = calls.slice();
    return { level, completed, completionRepeat, demolished, demolition, demolitionRepeat, upgrade, lane, roadBulldoze, week, milestone, pending };
  });
  report.errors = errs;
  report.passed = report.level === 1 && report.completed === 1 && report.completionRepeat === 0 && report.demolished && report.demolition === 1 &&
    report.demolitionRepeat === 0 && report.upgrade.ok && report.lane === 1 && report.roadBulldoze === 1 && report.week === 1 && report.milestone === 1 &&
    report.pending.map(c => c.kind).join(',') === 'cash,zone,bulldoze,crash,notify,error' && !errs.length;
  console.log(JSON.stringify(report));
  saveReport('shots/audio/actions/events.json', report);
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
