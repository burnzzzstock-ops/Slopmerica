// Frame profiler: where each frame's CPU time goes, section by section,
// cheap enough (one clock read per section) to stay on in playtest builds.
// Averages hide the frames players complain about, so it also keeps the
// slowest frames of the session together with what the game was doing.

/** One remembered slow frame. */
export interface SlowFrame {
  /** total frame ms (CPU, this thread) */
  ms: number;
  /** performance.now() when it happened */
  at: number;
  /** the biggest sections, slowest first: [name, ms] */
  parts: [string, number][];
  /** what the game was doing (day, hour, speed, tool, zoom, city size, notes) */
  ctx: string;
}

const RING = 600; // ~10 s at 60 fps
const KEEP = 5;
/** the first frames compile shaders and fill caches; they'd crowd out real hitches */
const WARMUP = 90;

export class FrameProfiler {
  private cur = new Map<string, number>();
  /** smoothed ms per section, for the F3 overlay */
  readonly avg = new Map<string, number>();
  /** the slowest frames this session, slowest first */
  readonly worst: SlowFrame[] = [];
  private ring = new Float32Array(RING);
  private n = 0;
  private t0 = 0;
  private last = 0;
  private notes = '';

  begin() {
    this.cur.clear();
    this.notes = '';
    this.t0 = this.last = performance.now();
  }

  /** charge the time since the previous lap (or begin) to `name` */
  lap(name: string) {
    const t = performance.now();
    this.cur.set(name, (this.cur.get(name) ?? 0) + (t - this.last));
    this.last = t;
  }

  /** remember something unusual about this frame ("new day", "quality change") */
  note(s: string) {
    this.notes = this.notes ? `${this.notes}, ${s}` : s;
  }

  end(ctx: () => string) {
    const total = performance.now() - this.t0;
    this.ring[this.n % RING] = total;
    this.n++;
    for (const [k, v] of this.cur) this.avg.set(k, (this.avg.get(k) ?? v) * 0.95 + v * 0.05);
    if (this.n <= WARMUP) return;
    if (this.worst.length === KEEP && total <= this.worst[KEEP - 1].ms) return;
    const parts = [...this.cur].filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => [k, Math.round(v * 10) / 10] as [string, number]);
    this.worst.push({ ms: total, at: performance.now(), parts, ctx: ctx() + (this.notes ? ` · ${this.notes}` : '') });
    this.worst.sort((a, b) => b.ms - a.ms);
    if (this.worst.length > KEEP) this.worst.length = KEEP;
  }

  /** frame-time summary over the last ~10 s of frames */
  stats() {
    const k = Math.min(this.n, RING);
    if (!k) return { frames: 0, avg: 0, p95: 0, max: 0 };
    const a = Array.from(this.ring.subarray(0, k)).sort((x, y) => x - y);
    const sum = a.reduce((s, v) => s + v, 0);
    return { frames: k, avg: sum / k, p95: a[Math.min(k - 1, Math.floor(k * 0.95))], max: a[k - 1] };
  }

  /** the n most expensive sections on average */
  top(n: number): [string, number][] {
    return [...this.avg].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
}
