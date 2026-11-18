// The Statistics drawer: the county over time, drawn from what the simulation already keeps (sim.history, one row every two
// days; sim.popLog, the last 60 days of who moved in and who left and why). Four charts for a start: population, the treasury,
// nature against sprawl, and arrivals and departures. Each is a small inline SVG made here (no library); a pointer or a finger
// across a chart reads off the day under it. Loaded when the drawer is first opened, so a player who never looks at a chart
// never downloads it.
import type { Game } from '../game';
import { LOSS_LABEL, usd, type LossCause } from '../sim/sim';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n0 = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${v > 0 && v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;

/** one line on a chart: its points (already in order of day), its colour and how a value reads */
interface Line { name: string; color: string; ys: number[]; say: (v: number) => string; fill?: boolean }
/** what a chart needs to answer a pointer: the day of each column and each line's values */
interface Probe { days: number[]; lines: Line[]; bars?: { in: number[]; out: number[] } }

/** A polyline through `ys` on a 100 x 100 box, low values at the bottom (the box is stretched to the plot by the SVG). */
function path(ys: number[], lo: number, hi: number, close = false): string {
  const span = hi - lo || 1, step = ys.length > 1 ? 100 / (ys.length - 1) : 0;
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(100 - ((y - lo) / span) * 100).toFixed(2)}`).join('');
  return close ? `${d}L100 100L0 100Z` : d;
}

/** The frame every chart shares: a heading with the figure for today, the plot, and the days it runs from and to. */
function frame(id: string, title: string, now: string, note: string, plot: string, from: string, to: string, label: string, legend = ''): string {
  return `<figure class="st-chart" data-chart="${id}" role="img" aria-label="${esc(label)}">
    <figcaption class="st-head"><b>${esc(title)}</b><span class="st-note">${note}</span><span class="st-now">${esc(now)}</span></figcaption>
    <div class="st-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${plot}</svg><i class="st-guide" hidden></i></div>
    <div class="st-foot"><span>${esc(from)}</span><span class="st-at"></span><span>${esc(to)}</span></div>${legend}
  </figure>`;
}

function lineChart(g: Game, id: string, title: string, days: number[], lines: Line[], lo: number, hi: number, note = ''): { html: string; probe: Probe } {
  const s = g.sim, last = days.length - 1;
  const plot = lines.map((l) => `${l.fill ? `<path d="${path(l.ys, lo, hi, true)}" fill="${l.color}" fill-opacity="0.18" stroke="none"/>` : ''}<path d="${path(l.ys, lo, hi)}" stroke="${l.color}"/>`).join('');
  const now = lines.map((l) => l.say(l.ys[last])).join(' · ');
  const label = `${title}, ${s.dateOf(days[0], false)} to ${s.dateOf(days[last], false)}: ${lines.map((l) => `${l.name} from ${l.say(l.ys[0])} to ${l.say(l.ys[last])}`).join('; ')}`;
  const legend = lines.length > 1 ? `<div class="st-legend">${lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join('')}</div>` : '';
  return { html: frame(id, title, now, note, plot, s.dateOf(days[0], false), s.dateOf(days[last], false), label, legend), probe: { days, lines } };
}

/**
 * Draw the charts into `el` and return a function that draws them again when the county has a new day to show (the HUD
 * calls it four times a second while the drawer is open; it does nothing until the day changes).
 */
export function drawStats(el: HTMLElement, g: Game): () => void {
  const probes = new Map<string, Probe>();
  let shown = '';

  const draw = () => {
    const s = g.sim, H = s.history, key = `${H.length}|${Math.floor(s.day)}|${s.population}`;
    if (key === shown) return;
    shown = key;
    probes.clear();
    const out: string[] = [];
    if (H.length < 2) out.push('<p class="st-empty">The charts start once the county has a few days behind it.</p>');
    else {
      const days = H.map((h) => h.day);
      // population: from nothing to the most it has been
      const pop = lineChart(g, 'pop', 'Population', days, [{ name: 'residents', color: 'var(--res)', ys: H.map((h) => h.pop), say: n0, fill: true }], 0, Math.max(10, ...H.map((h) => h.pop)), `most ever ${n0(s.peakPop)}`);
      out.push(pop.html); probes.set('pop', pop.probe);
      // the treasury: a sandbox has no money to chart
      if (s.money === Infinity) out.push(`<figure class="st-chart" data-chart="money"><figcaption class="st-head"><b>Treasury</b></figcaption><p class="st-empty">Sandbox: money is no object, so there is nothing to chart.</p></figure>`);
      else {
        const ys = H.map((h) => h.money), net = s.weeklyNet();
        const money = lineChart(g, 'money', 'Treasury', days, [{ name: 'treasury', color: 'var(--ind)', ys, say: usd }], Math.min(0, ...ys), Math.max(1000, ...ys), `${net >= 0 ? '+' : ''}${usd(net)}/wk running`);
        out.push(money.html); probes.set('money', money.probe);
      }
      // what is left of the county's trees against how much of it is paved and built
      const land = lineChart(g, 'land', 'Nature and sprawl', days, [
        { name: 'nature left', color: 'var(--good)', ys: H.map((h) => h.nature), say: pct },
        { name: 'Endless Sprawl', color: 'var(--slop)', ys: H.map((h) => h.sprawl), say: pct },
      ], 0, 1);
      out.push(land.html); probes.set('land', land.probe);
    }
    // Who moved in and who left: a bar for every day of the last 60 (or of the county's life, if it is younger), arrivals up
    // and departures down. The log only has a row for a day somebody moved; a day nobody did is a gap, not a missing column.
    const P = s.popLog.slice(-60);
    if (P.length) {
      const end = Math.floor(s.day), start = Math.max(end - 59, Math.min(P[0].day, H[0]?.day ?? P[0].day));
      const span = Array.from({ length: Math.max(1, end - start + 1) }, (_, i) => start + i);
      const row = new Map(P.map((d) => [d.day, d]));
      const ins = span.map((d) => row.get(d)?.in ?? 0), outs = span.map((d) => Object.values(row.get(d)?.out ?? {}).reduce((a: number, v) => a + (v ?? 0), 0));
      const top = Math.max(1, ...ins, ...outs), w = 100 / span.length;
      const bars = span.map((_, i) => `${ins[i] ? `<rect x="${(i * w + w * 0.1).toFixed(2)}" y="${(50 - (ins[i] / top) * 50).toFixed(2)}" width="${(w * 0.8).toFixed(2)}" height="${((ins[i] / top) * 50).toFixed(2)}" fill="var(--good)"/>` : ''}${outs[i] ? `<rect x="${(i * w + w * 0.1).toFixed(2)}" y="50" width="${(w * 0.8).toFixed(2)}" height="${((outs[i] / top) * 50).toFixed(2)}" fill="var(--bad)"/>` : ''}`).join('');
      const tin = ins.reduce((a, v) => a + v, 0), tout = outs.reduce((a, v) => a + v, 0);
      const why = new Map<LossCause, number>();
      for (const d of P) for (const [c, v] of Object.entries(d.out) as [LossCause, number][]) why.set(c, (why.get(c) ?? 0) + v);
      const causes = [...why].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const legend = `<div class="st-legend"><span><i style="background:var(--good)"></i>moved in</span><span><i style="background:var(--bad)"></i>left</span>${causes.length ? `<span class="st-why">Left because: ${causes.map(([c, v]) => `${esc(LOSS_LABEL[c])} ${n0(v)}`).join(', ')}</span>` : ''}</div>`;
      out.push(frame('flow', 'Moved in and left', `+${n0(tin)} · −${n0(tout)}`, `last ${span.length} days`, `<path d="M0 50L100 50" stroke="var(--line)"/>${bars}`, s.dateOf(start, false), s.dateOf(end, false), `Moved in and left over the last ${span.length} days: ${n0(tin)} moved in, ${n0(tout)} left`, legend));
      probes.set('flow', { days: span, lines: [], bars: { in: ins, out: outs } });
    }
    el.innerHTML = out.join('');
  };

  // a pointer (or a finger moved sideways) over a chart reads off the day under it
  const read = (e: PointerEvent) => {
    const plot = (e.target as HTMLElement).closest<HTMLElement>('.st-plot'), fig = plot?.closest<HTMLElement>('.st-chart');
    const p = fig && probes.get(fig.dataset.chart ?? '');
    if (!plot || !fig || !p) return;
    const r = plot.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    const i = p.bars ? Math.min(p.days.length - 1, Math.floor(f * p.days.length)) : Math.round(f * (p.days.length - 1));
    const at = p.bars ? `+${n0(p.bars.in[i])} · −${n0(p.bars.out[i])}` : p.lines.map((l) => l.say(l.ys[i])).join(' · ');
    fig.querySelector('.st-at')!.textContent = `${g.sim.dateOf(p.days[i], false)}: ${at}`;
    const guide = fig.querySelector<HTMLElement>('.st-guide')!;
    guide.hidden = false;
    guide.style.left = `${(p.bars ? (i + 0.5) / p.days.length : p.days.length > 1 ? i / (p.days.length - 1) : 0) * 100}%`;
  };
  const clear = (e: PointerEvent) => {
    const fig = (e.target as HTMLElement).closest<HTMLElement>('.st-chart');
    if (!fig) return;
    fig.querySelector('.st-at')!.textContent = '';
    const guide = fig.querySelector<HTMLElement>('.st-guide');
    if (guide) guide.hidden = true;
  };
  el.addEventListener('pointermove', read);
  el.addEventListener('pointerdown', read);
  el.addEventListener('pointerleave', clear, true);

  draw();
  return draw;
}
