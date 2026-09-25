import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://127.0.0.1:5173/#skip&map=florida&mode=sandbox`, { waitUntil: 'load' });
await page.waitForTimeout(7000);
const out = await page.evaluate(async () => {
  const d = window.__dbg, g = window.__game, T = g.traffic;
  for (const c of g.communes.list) { c.state = 'gone'; g.communes.group.remove(c.group); }
  g.syncBlockers();
  const cx = 60, cz = 60;
  for (let k = -3; k <= 3; k++) { d.road(cx - 300, cz + k * 90, cx + 300, cz + k * 90, k === 0 ? 'stroad4' : 'twoLane'); d.road(cx + k * 90, cz - 300, cx + k * 90, cz + 300, k === 0 ? 'stroad4' : 'twoLane'); }
  d.zone(cx - 150, cz - 150, 130, 'resLow'); d.zone(cx + 150, cz + 150, 130, 'resLow'); d.zone(cx, cz, 70, 'comLow'); d.zone(cx + 170, cz - 170, 110, 'industry'); d.zone(cx - 170, cz + 170, 110, 'resHigh');
  d.run(100);
  const st = T.stats();
  const rows = [];
  for (const c of T.cars) {
    if (c.junction && c.v < 0.5 && rows.length < 10) {
      const next = c.path[c.pi + 1];
      const nseg = g.net.segs.get(next.seg);
      const entryS = next.dir > 0 ? nseg.trimA : nseg.trimB;
      const lane = Math.min(c.lane, 99);
      const occ = T.cars.filter((o) => !o.junction && o.path[o.pi].seg === next.seg && o.path[o.pi].dir === next.dir).map((o) => [+o.s.toFixed(1), +o.v.toFixed(1), o.lane, o.crashed]);
      rows.push({ J: +c.junction.t.toFixed(2), node: c.junction.node, nseg: next.seg, dir: next.dir, entryS: +entryS.toFixed(1), lane: c.lane, occ: JSON.stringify(occ.slice(0, 6)), nlen: +nseg.length.toFixed(1) });
      continue;
    }
    if (c.crashed || c.junction || c.v > 0.5) continue;
    const step = c.path[c.pi];
    const seg = g.net.segs.get(step.seg);
    const last = c.pi === c.path.length - 1;
    const exitS = last ? c.endS : seg.length - (step.dir > 0 ? seg.trimB : seg.trimA);
    const key = step.seg * 16 + (step.dir > 0 ? 0 : 8) + c.lane;
    const arr = T.cars.filter((o) => !o.junction && o.crashed !== -1 && o.path[o.pi].seg === step.seg && o.path[o.pi].dir === step.dir && o.lane === c.lane && o.s > c.s).sort((a, b) => a.s - b.s);
    const lead = arr[0];
    const nodeId = step.dir > 0 ? seg.b : seg.a;
    rows.push({ s: +c.s.toFixed(1), exitS: +exitS.toFixed(1), len: +seg.length.toFixed(1), last, pi: c.pi, n: c.path.length, green: T.isGreen(nodeId, seg.id), blocked: seg.blocked, leadGap: lead ? +(lead.s - c.s - lead.len).toFixed(1) : null, leadV: lead ? +lead.v.toFixed(1) : null, leadCrashed: lead ? lead.crashed : null, lanes: seg.type });
    if (rows.length > 14) break;
  }
  return { st, rows };
});
console.log(JSON.stringify(out.st));
for (const r of out.rows) console.log(JSON.stringify(r));
await browser.close();
