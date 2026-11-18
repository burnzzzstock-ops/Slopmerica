// Zero-time refresh contract for paused weather overrides. No browser is needed.
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server = await createServer({
  root: process.cwd(),
  cacheDir: 'shots/tmp/vite/weather-source-' + process.pid,
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
const rows = [];
try {
  const { Climate } = await server.ssrLoadModule('/src/sim/climate.ts');
  const { seasonOf, temperatureC } = await server.ssrLoadModule('/src/world/seasons.ts');
  // Independent expected output from the public seasonal temperature and
  // documented full-strength weather deltas. The first refresh still sees
  // the previous intensity, so it cannot produce this value for a new spell.
  const temperatureOffset = { clear: 0, cloudy: 0, rain: -1.4, storm: -2, snow: -2.1, blizzard: -3, fog: 0, heatwave: 7, hurricane: -2.7, wildfireSmoke: 0 };
  const kinds = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'heatwave', 'hurricane', 'wildfireSmoke'];
  for (const map of ['appalachia', 'norcal', 'florida']) for (const kind of kinds) for (const duration of [.001, 3, 4320]) {
    const climate = new Climate(map, 1776);
    const day = 2655;
    const hour = 13;
    climate.load({ ...climate.save(), wet: .65, snowCover: map === 'florida' ? 0 : .23 });
    const before = climate.save();
    // Forcing first places the expiry after the current day. Calling step(0)
    // on an expired, unforced spell could legitimately roll another spell.
    climate.force(kind, day, duration);
    const forced = climate.save();
    climate.step(0, day, hour, 0);
    const firstTemperature = climate.temperature;
    climate.step(0, day, hour, 0);
    const refreshed = climate.save();
    const wind = { ...climate.wind };
    climate.step(0, day, hour, 0);
    const stable = climate.save();
    const changed = Object.keys(forced).filter(key => forced[key] !== refreshed[key]);
    const allowed = new Set(['season', 'temperature', 'intensity']);
    const offset = map === 'florida' && (kind === 'snow' || kind === 'blizzard') ? 0 : temperatureOffset[kind];
    const expectedTemperature = temperatureC(map, day % 365, hour) + offset;
    const temperatureMatches = Math.abs(refreshed.temperature - expectedTemperature) < 1e-8;
    const pass = temperatureMatches && refreshed.kind === kind && Math.abs(refreshed.intensity - 1) < 1e-8 && refreshed.season === seasonOf(day % 365)
      && refreshed.rng === before.rng && refreshed.windAngle === before.windAngle && refreshed.spell === before.spell + 1
      && refreshed.wet === before.wet && refreshed.snowCover === before.snowCover
      && changed.every(key => allowed.has(key)) && JSON.stringify(refreshed) === JSON.stringify(stable)
      && climate.wind.x === wind.x && climate.wind.y === wind.y;
    rows.push({ map, kind, duration, pass, changed, firstTemperature, expectedTemperature, temperature: refreshed.temperature });
  }
} finally {
  await server.close();
}
mkdirSync('shots/weather-source', { recursive: true });
writeFileSync('shots/weather-source/unit.json', JSON.stringify({ rows }, null, 2));
const failures = rows.filter(row => !row.pass);
console.log(`${failures.length ? 'FAIL' : 'OK'} ${rows.length - failures.length}/${rows.length} forced paused refreshes preserve RNG, clock bounds, wetness and snow, and reach stable intensity/season/temperature`);
if (failures.length) console.log(JSON.stringify(failures));
process.exitCode = failures.length ? 1 : 0;
