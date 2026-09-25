import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

// Keep Chromium's profile outside Vite's watched repo and inside the writable workspace.
const tempParent = path.resolve(process.cwd(), '..', 'playwright-tmp');
fs.mkdirSync(tempParent, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(tempParent, 'districts-'));
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('Set CHROME_PATH to Chrome/Chromium');

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.districts, null, { timeout: 30000 });

const report = await page.evaluate(async () => {
  const g = window.__game, d = window.__dbg, api = g.districts;
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -3; k <= 3; k++) {
    d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane');
    d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane');
  }
  d.zone(cx - 170, cz - 170, 120, 'resLow'); d.zone(cx + 170, cz + 170, 120, 'resHigh');
  d.zone(cx, cz, 100, 'comLow'); d.zone(cx + 170, cz - 170, 120, 'industry'); d.zone(cx - 170, cz + 170, 120, 'office');
  g.sim.speed = 1;
  for (let i = 0; i < 3600; i++) g.frame(1 / 60, false);
  const district = api.create();
  api.paint(cx, cz, district.id, 520);
  const buildings = [...g.buildings.list.values()].filter((b) => !['landmark', 'service'].includes(b.zone));
  const byZone = Object.fromEntries(['resLow', 'resHigh', 'comLow', 'industry', 'office'].map((z) => [z, buildings.find((b) => b.zone === z)]));
  const fx = await import('/src/sim/policyEffects.ts');

  const measure = () => {
    const tax = (b) => g.sim.hooks.taxMul.reduce((n, h) => n * h(b), 1);
    const land = (b) => g.sim.hooks.landValue.reduce((n, h) => n + h(b), 0);
    const vacancy = (b) => g.sim.hooks.vacancy.map((h) => h(b)).find(Boolean) || null;
    const demand = { res: 0, com: 0, ind: 0, off: 0 }, why = { res: [], com: [], ind: [], off: [] };
    for (const h of g.sim.hooks.demand) h(demand, why);
    return {
      demand,
      taxOffice: byZone.office ? tax(byZone.office) : null,
      taxIndustry: byZone.industry ? tax(byZone.industry) : null,
      landLow: byZone.resLow ? land(byZone.resLow) : null,
      landIndustry: byZone.industry ? land(byZone.industry) : null,
      vacancyHigh: byZone.resHigh ? vacancy(byZone.resHigh) : null,
      crime: byZone.comLow ? fx.POLICY.crimeMul(byZone.comLow) : null,
      education: byZone.resLow ? fx.POLICY.educationMul(byZone.resLow) : null,
      power: byZone.resLow ? fx.POLICY.powerDemandMul(byZone.resLow) : null,
      water: byZone.resLow ? fx.POLICY.waterDemandMul(byZone.resLow) : null,
      fire: byZone.resLow ? fx.POLICY.fireRiskMul(byZone.resLow) : null,
      carTrips: byZone.resLow ? fx.POLICY_MOBILITY.carTripMul(byZone.resLow) : null,
      walks: byZone.resLow ? fx.POLICY_MOBILITY.pedestrianMul(byZone.resLow) : null,
      trucks: byZone.industry ? fx.POLICY_MOBILITY.truckAllowed(byZone.industry) : null,
    };
  };

  const policies = ['freeParking', 'hoaTyranny', 'cryptoHaven', 'openCarry', 'banBikes', 'legalizeIt', 'fourDayWeek', 'rightToRepair', 'bookBans', 'heavyTrafficBan', 'sprawlZone', 'smokeFree', 'solarMandate', 'waterRationing'];
  const baseline = measure(), effects = {};
  for (const id of policies) {
    api.setCityPolicy(id, true);
    effects[id] = measure();
    api.setCityPolicy(id, false);
  }

  api.setCityPolicy('solarMandate', true);
  api.setDistrictPolicy(district.id, 'solarMandate', false);
  const overrideOff = byZone.resLow ? fx.POLICY.powerDemandMul(byZone.resLow) : null;
  api.setDistrictPolicy(district.id, 'solarMandate', undefined);
  const inheritedOn = byZone.resLow ? fx.POLICY.powerDemandMul(byZone.resLow) : null;
  const saved = api.save();
  api.erase(cx, cz, 520); api.setCityPolicy('solarMandate', false);
  api.load(saved);
  const roundTrip = api.at(cx, cz)?.id === district.id && api.policiesFor(byZone.resLow).includes('solarMandate');
  api.setCityPolicy('solarMandate', false);
  const advanceDay = () => { const start = Math.floor(g.sim.day); for (let i = 0; i < 240 && Math.floor(g.sim.day) === start; i++) g.frame(1 / 60, false); };
  api.setCityPolicy('freeParking', true); advanceDay(); const freeParkingTrips = g.traffic.policyTripMul;
  api.setCityPolicy('freeParking', false); api.setCityPolicy('banBikes', true); advanceDay(); const banBikeTrips = g.traffic.policyTripMul, banBikeWalkers = g.peds.policyOutdoorMul;
  api.setCityPolicy('banBikes', false); api.setCityPolicy('fourDayWeek', true); advanceDay(); const fourDayTrips = g.traffic.policyTripMul;
  api.setCityPolicy('fourDayWeek', false); api.setCityPolicy('smokeFree', true); const smokeAllowed = g.traffic.policySmokingAllowed(byZone.resLow);
  return { buildingCount: buildings.length, zones: Object.fromEntries(Object.entries(byZone).map(([k, v]) => [k, !!v])), paintedCells: saved.runs.reduce((n, _v, i, a) => i % 3 === 1 ? n + a[i] : n, 0), baseline, effects, override: { overrideOff, inheritedOn }, integration: { freeParkingTrips, banBikeTrips, banBikeWalkers, fourDayTrips, smokeAllowed }, roundTrip };
});

for (const [id, value] of Object.entries(report.effects)) {
  const changed = JSON.stringify(value) !== JSON.stringify(report.baseline);
  console.log(JSON.stringify({ policy: id, before: report.baseline, after: value, changed }));
  if (!changed) throw new Error(`${id} produced no measured effect`);
}
if (report.override.overrideOff !== 1 || report.override.inheritedOn !== 0.78) throw new Error(`district override precedence failed: ${JSON.stringify(report.override)}`);
if (!report.roundTrip) throw new Error('district save/load round trip failed');
if (!(report.integration.freeParkingTrips > 1 && report.integration.banBikeTrips > 1 && report.integration.banBikeWalkers < 1 && report.integration.fourDayTrips < 1 && report.integration.smokeAllowed === false)) throw new Error(`live mobility hooks failed: ${JSON.stringify(report.integration)}`);
console.log(JSON.stringify({ summary: { buildingCount: report.buildingCount, zones: report.zones, paintedCells: report.paintedCells, override: report.override, integration: report.integration, roundTrip: report.roundTrip } }));
await browser.close();
