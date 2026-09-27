// The X feed picks lines that fit the city (src/content/feedTags.ts, from
// scripts/feedtags.mjs). In the running game: every event, map, town size and
// weather has lines to pick from, and none that don't fit (a Florida Man story
// only in Gator Gulch, a stars line only on a clear night, "day one" only in an
// empty valley); Florida Man posts on the Florida map and never elsewhere; "one
// more lane" comes from Big Dale or the lane lobby more often than not. Without
// the tags (Node, where the file isn't loaded, like a build without it) the
// feed posts exactly what it posted before this change, draw for draw.
// Exits nonzero on failure.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };

// ---- without tags: the same posts as before, draw for draw
{
  const now = await import('../src/content/feed.ts');
  const dir = mkdtempSync(join(tmpdir(), 'feed-'));
  // the feed's picking code as it was before tags, run on today's lines (the owner edits lines;
  // this checks the picking, not the text)
  const rev = execSync('git log --format=%H -S FEED_TEMPLATES -- src/content/feed.ts', { encoding: 'utf8' }).trim().split('\n').pop();
  const before = execSync(`git show ${rev ? `${rev}~1` : 'HEAD'}:src/content/feed.ts`, { encoding: 'utf8' });
  const today = readFileSync(new URL('../src/content/feed.ts', import.meta.url), 'utf8');
  const lines = (src) => [src.indexOf('const roads = ['), src.indexOf('const firstNames')];
  const [a0, a1] = lines(before), [b0, b1] = lines(today);
  writeFileSync(join(dir, 'feed.ts'), before.slice(0, a0) + today.slice(b0, b1) + before.slice(a1));
  const old = await import(join(dir, 'feed.ts'));
  const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const kinds = Object.keys(now.FEED_TEMPLATES);
  let same = 0, n = 0;
  for (const map of ['appalachia', 'norcal', 'florida']) for (const pop of [0, 400, 9000]) for (const kind of kinds) for (let i = 0; i < 4; i++) {
    const ctx = { city: 'Testville', map, population: pop, money: 5000, naturePct: 0.5, sprawlPct: pop / 20000, season: 'summer', weather: 'rain' };
    const a = JSON.stringify(now.postFor(kind, ctx, seeded(1 + i * 97 + n))), b = JSON.stringify(old.postFor(kind, ctx, seeded(1 + i * 97 + n)));
    n++; if (a === b) same++;
  }
  check(`without the tags file, posts are identical to before (${same}/${n} seeded posts)`, !now.feedTagged() && same === n, { tagged: now.feedTagged(), same, n });
}

// ---- in the game, with tags
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('slopmerica.quality', 'low'); localStorage.setItem('slopmerica.onboarded', '1'); } catch { /* */ } });
await page.goto(`${base}/#skip&map=florida&mode=sandbox`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
const r = await page.evaluate(async () => {
  const F = await import('/src/content/feed.ts');
  cancelAnimationFrame(window.__game.raf);
  const kinds = Object.keys(F.FEED_TEMPLATES);
  const maps = ['appalachia', 'norcal', 'florida'];
  const pops = [0, 200, 700, 2000, 5000, 9000]; // stages 0..5
  const weathers = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'blizzard', 'fog', 'heatwave', 'hurricane', 'wildfireSmoke'];
  const empty = [], wrong = [], loose = [];
  let pools = 0;
  for (const kind of kinds) for (const map of maps) for (const population of pops) for (const weather of weathers) {
    const ctx = { city: 'Testville', map, population, money: 5000, naturePct: 0.5, sprawlPct: population > 8000 ? 0.5 : 0.1, season: 'summer', weather };
    const pool = F.feedPool(kind, ctx), stage = F.townStage(ctx);
    pools++;
    if (!pool.length) { empty.push(`${kind} ${map} ${population} ${weather}`); continue; }
    let off = 0;
    for (const line of pool) {
      const t = F.feedTag(kind, line);
      if (!t) continue;
      if (t.region && t.region !== map) wrong.push(`region: ${kind} on ${map}: ${line}`);
      if (t.weather && (kind === 'weatherChange' || kind === 'nightfall') && !t.weather.includes(F.weatherGroup(weather))) wrong.push(`weather: ${kind} in ${weather}: ${line}`);
      if (t.stage && (stage < t.stage[0] || stage > t.stage[1])) off++;
    }
    if (off) loose.push(`${kind}@${stage}`);
  }
  // posts in the game's own feed: ambient chatter on each map
  const fm = {};
  for (const map of maps) {
    let n = 0;
    for (let i = 0; i < 1500; i++) if (/Florida Man/.test(F.postFor('ambient', { city: 'T', map, population: 2000, money: 1, naturePct: 0.5, sprawlPct: 0.1, weather: 'clear' }, Math.random).text)) n++;
    fm[map] = n;
  }
  const lane = { n: 0, lobby: 0 };
  for (let i = 0; i < 600; i++) { const p = F.postFor('laneAdded', { city: 'T', map: 'florida', population: 2000, money: 1, naturePct: 0.5, sprawlPct: 0.1 }, Math.random); lane.n++; if (['OneMoreLane', 'MoreLanesNow', 'MaxMobilityGov'].includes(p.handle)) lane.lobby++; }
  // the game's feed panel shows tagged posts
  const g = window.__game;
  const before = document.querySelectorAll('.xfeed .xpost').length;
  g.feed.push('laneAdded', { road: 'Route 9' });
  for (let i = 0; i < 40; i++) g.feed.update(0.5);
  const shown = [...document.querySelectorAll('.xfeed .xpost')].slice(0, Math.max(1, document.querySelectorAll('.xfeed .xpost').length - before)).map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 140));
  // a shop opening posts its brand's name, not its id ("Taco Bull", not "tacoBull")
  const pushed = [];
  const push = g.feed.push.bind(g.feed);
  g.feed.push = (kind, extra) => { pushed.push({ kind, extra }); };
  const rnd = Math.random;
  Math.random = () => 0.01;
  try { g.buildings.onComplete?.({ id: 1e9, zone: 'comLow', brand: 'tacoBull', label: 'Taco Bull', x: 1e5, z: 1e5, y: 0, level: 1, model: { height: 5 } }); } finally { Math.random = rnd; g.feed.push = push; }
  const opened = pushed.find((p) => p.kind === 'buildingOpened');
  return { tagged: F.feedTagged(), pools, empty, wrong: [...new Set(wrong)], loose: [...new Set(loose)], fm, lane, shown, opened: opened?.extra ?? null };
});
console.log(JSON.stringify({ ...r, wrong: r.wrong.slice(0, 5), loose: r.loose }).slice(0, 1500));
check(`the tags are loaded in the game`, r.tagged, r);
check(`every event has lines to pick on every map, town size and weather (${r.pools.toLocaleString()} pools)`, r.empty.length === 0, r.empty.slice(0, 5));
check('no pool holds a line for another map, or a weather line that clashes', r.wrong.length === 0, r.wrong.slice(0, 5));
check(`town size is only loosened where no line fits (${r.loose.length} event/size pairs: ${r.loose.join(', ')})`, r.loose.every((x) => /^(gameStart@[1-5]|sprawlMilestone@[0-3]|maxLevelReached@[0-2]|natureMilestone@[0-2])$/.test(x)), r.loose);
check(`Florida Man posts only in Gator Gulch (per 1,500 chatter posts: ${JSON.stringify(r.fm)})`, r.fm.florida > 0 && r.fm.appalachia === 0 && r.fm.norcal === 0, r.fm);
check(`"one more lane" usually comes from Big Dale or the lane lobby (${r.lane.lobby}/${r.lane.n})`, r.lane.lobby / r.lane.n > 0.5, r.lane);
check(`the game's feed panel posts it ("${(r.shown[0] ?? '').slice(0, 90)}")`, r.shown.length > 0, r.shown);
check(`a shop opening names its brand for the feed ("${r.opened?.brand}")`, r.opened?.brand === 'Taco Bull', r.opened);
check('no page errors', errs.length === 0, errs.slice(0, 3));
await browser.close();
process.exit(bad ? 1 : 0);
