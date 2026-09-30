// The street-sound lab, installed into a page that can import the game's modules (any page on the dev/snapshot server):
// window.__lab = { A (FFT analysis), render (offline render of scripted cars through StreetAudio), ... }.
// Passed to page.evaluate(installLab), so it must stay self-contained (it is serialised). Returns 'new' when
// src/audio/streetAudio.ts exists, 'old' on the old code (where only Ambience is available).
// Used by scripts/streetaudio.mjs (measurements) and scripts/streetaudio-figure.mjs (spectrograms).
export async function installLab() {
  const { Synth } = await import('/src/audio/synth.ts');
  const { Ambience } = await import('/src/audio/ambience.ts');
  let street = null;
  try { street = await import('/src/audio/streetAudio.ts'); } catch { /* the old code has none */ }
  const prof = street ? await import('/src/audio/streetProfiles.ts') : null;

  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const LEN = { semi: 16, cityBus: 12, firetruck: 10, garbageTruck: 9, boxTruck: 8, towTruck: 7, ambulance: 6.5, liftedTruck: 6, pickup: 5.8, cyberslop: 5.7, slopVan: 5.4, minivan: 5.1, police: 5, suv: 4.9, sedan: 4.6, vwBus: 4.5, hatchback: 4, golfCart: 2.4, motorcycle: 2.2 };

  // ---- analysis
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  };
  const psd = (x, N = 8192) => {
    const P = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
    const w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    let frames = 0;
    for (let s = 0; s === 0 || s + N <= x.length; s += N / 2) {
      for (let i = 0; i < N; i++) { re[i] = (s + i < x.length ? x[s + i] : 0) * w[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    for (let k = 0; k < N / 2; k++) P[k] /= frames;
    return P;
  };
  const A = {
    seg: (ch, t0, t1) => { const L = A.last; const a = ch === 'L' ? L.L : ch === 'R' ? L.R : null; const r = L.rate; const i0 = Math.floor(t0 * r), i1 = Math.floor(t1 * r); if (a) return a.subarray(i0, i1); const m = new Float32Array(i1 - i0); for (let i = 0; i < m.length; i++) m[i] = (L.L[i0 + i] + L.R[i0 + i]) / 2; return m; },
    rms: (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); },
    peakAbs: (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; },
    db: (x) => 20 * Math.log10(Math.max(1e-12, x)),
    bandDb: (P, rate, lo, hi, N = 8192) => { let s = 0; for (let k = Math.max(1, Math.floor((lo * N) / rate)); k < Math.min(N / 2, Math.ceil((hi * N) / rate)); k++) s += P[k]; return 10 * Math.log10(Math.max(1e-30, s)); },
    peakHz: (P, rate, lo, hi, N = 8192) => {
      let bk = 0, bv = -1;
      const k0 = Math.max(2, Math.floor((lo * N) / rate)), k1 = Math.min(N / 2 - 2, Math.ceil((hi * N) / rate));
      for (let k = k0; k <= k1; k++) if (P[k] > bv) { bv = P[k]; bk = k; }
      const a = Math.log(P[bk - 1] + 1e-30), b = Math.log(P[bk] + 1e-30), c = Math.log(P[bk + 1] + 1e-30);
      const d = 0.5 * (a - c) / (a - 2 * b + c);
      return ((bk + (isFinite(d) ? d : 0)) * rate) / N;
    },
    /** peak-to-median in a band, dB: how tonal (a whine) versus noisy (a rumble) */
    tonal: (P, rate, lo, hi, N = 8192) => {
      const k0 = Math.floor((lo * N) / rate), k1 = Math.ceil((hi * N) / rate), v = [];
      for (let k = k0; k < k1; k++) v.push(P[k]);
      const s = v.slice().sort((a, b) => a - b);
      return 10 * Math.log10(Math.max(...v) / Math.max(1e-30, s[s.length >> 1]));
    },
    centroid: (P, rate, lo, hi, N = 8192) => { let a = 0, b = 0; for (let k = Math.floor((lo * N) / rate); k < Math.ceil((hi * N) / rate); k++) { a += P[k] * ((k * rate) / N); b += P[k]; } return a / Math.max(1e-30, b); },
    /** share of the band's power within +/- `hw` Hz of its strongest peak: a whine is one line, a rumble is not */
    peakShare: (P, rate, lo, hi, hw = 25, N = 8192) => {
      const k0 = Math.floor((lo * N) / rate), k1 = Math.ceil((hi * N) / rate); let tot = 0, bk = k0;
      for (let k = k0; k < k1; k++) { tot += P[k]; if (P[k] > P[bk]) bk = k; }
      const w = Math.ceil((hw * N) / rate); let near = 0;
      for (let k = Math.max(k0, bk - w); k <= Math.min(k1 - 1, bk + w); k++) near += P[k];
      return near / Math.max(1e-30, tot);
    },
    /** share of the power below `hz` */
    lowShare: (P, rate, hz, N = 8192) => { let a = 0, b = 0; for (let k = 1; k < N / 2; k++) { b += P[k]; if ((k * rate) / N < hz) a += P[k]; } return a / Math.max(1e-30, b); },
    psd,
    /** depth (0..1) of amplitude modulation in [lo,hi] Hz of the loudness envelope */
    modDepth: (x, rate, lo, hi) => {
      const hop = Math.round(rate * 0.004), win = hop * 2, env = [];
      for (let i = 0; i + win <= x.length; i += hop) { let s = 0; for (let k = 0; k < win; k++) s += Math.abs(x[i + k]); env.push(s / win); }
      const N = 512, m = env.reduce((a, b) => a + b, 0) / env.length, re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (env[i % env.length] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      fft(re, im);
      const fs = rate / hop; let best = 0;
      for (let k = Math.floor((lo * N) / fs); k <= Math.ceil((hi * N) / fs); k++) best = Math.max(best, (2 * Math.hypot(re[k], im[k])) / (N * 0.5));
      return best / m;
    },
    spectrogram: (x, rate, N = 1024, hop = 512, fmax = 6000) => {
      const cols = Math.floor((x.length - N) / hop), rows = Math.floor((fmax * N) / rate), img = { cols, rows, data: new Float32Array(cols * rows) };
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let c = 0; c < cols; c++) {
        for (let i = 0; i < N; i++) { re[i] = x[c * hop + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
        fft(re, im);
        for (let r = 0; r < rows; r++) img.data[c * rows + r] = 10 * Math.log10(re[r] * re[r] + im[r] * im[r] + 1e-12);
      }
      return img;
    },
  };

  // ---- rendering
  const vAt = (vs, t) => { if (t <= vs[0][0]) return vs[0][1]; for (let i = 1; i < vs.length; i++) if (t <= vs[i][0]) { const f = (t - vs[i - 1][0]) / (vs[i][0] - vs[i - 1][0]); return vs[i - 1][1] + f * (vs[i][1] - vs[i - 1][1]); } return vs[vs.length - 1][1]; };
  const mkCar = (s) => ({ id: s.id, kind: s.kind, x: s.x, y: 0, z: s.z, v: vAt(s.vs, 0), yaw: s.yaw ?? 0, crashed: 0, acc: 0, len: s.len ?? LEN[s.kind] ?? 5, _s: s });
  const advance = (cars, t0, t1) => {
    const dt = t1 - t0;
    for (const c of cars) {
      const s = c._s;
      const v0 = vAt(s.vs, t0), v1 = vAt(s.vs, t1);
      if (dt > 0) {
        c.x += Math.sin(c.yaw) * ((v0 + v1) / 2) * dt; c.z += Math.cos(c.yaw) * ((v0 + v1) / 2) * dt;
        c.acc = s.acc !== undefined ? s.acc : (v1 - v0) / dt;
      }
      c.v = v1;
      if (s.wrap) { const [a, b] = s.wrap; if (c.z > b) c.z -= b - a; else if (c.z < a) c.z += b - a; }
      if (s.crashAt !== undefined && t1 >= s.crashAt) c.crashed = 1;
    }
  };
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const render = async (spec) => {
    const rate = spec.rate || 22050, dur = spec.dur, STEP = spec.step || 0.0625;
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * rate), rate);
    const counts = {};
    for (const k of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createWaveShaper', 'createPeriodicWave']) { const f = ctx[k].bind(ctx); counts[k] = 0; ctx[k] = (...a) => { counts[k]++; return f(...a); }; }
    const synth = new Synth(ctx);
    const out = ctx.createGain(); out.connect(ctx.destination);
    const st = new street.StreetAudio(synth, out, { ...(spec.pool || {}), rng: mulberry32(spec.seed || 1), softClip: spec.softClip, sirenPhase: spec.sirenPhase });
    if (spec.limit) st.limit(spec.limit);
    if (spec.only) { for (const b of ['engineBus', 'hornBus', 'sirenBus']) if (b !== spec.only + 'Bus') st[b].disconnect(); }
    const nodesBuilt = total(counts);
    const view = { x: 0, y: 2, z: 0, rx: 1, rz: 0, dist: 60, ...(spec.view || {}) };
    const env = { rain: 0, wet: 0, hush: 0, speed: 1, ...(spec.env || {}) };
    const cars = spec.cars.map(mkCar);
    const max = { voices: 0, sirens: 0, horns: 0 }, honks = [], probes = [];
    let last = 0, seen = 0;
    const tick = (t) => {
      for (const [at, patch] of spec.envAt || []) if (last < at && t >= at) Object.assign(env, patch); // e.g. pause the game at 4 s
      advance(cars, last, t);
      st.update(t - last || 0.3, cars, view, env);
      last = t;
      max.voices = Math.max(max.voices, st.stats.voices); max.sirens = Math.max(max.sirens, st.stats.sirens); max.horns = Math.max(max.horns, st.stats.horns);
      while (seen < st.stats.honks) { const s = st.honkLog[seen & 31]; honks.push({ t: +t.toFixed(2), id: s.id, kind: s.kind, size: s.size }); seen++; }
      if (spec.probeAt && spec.probeAt.some((p) => last >= p && last - STEP < p)) probes.push({ t: +t.toFixed(2), dbg: st.debug(), awake: st.awake, stats: { ...st.stats }, cars: cars.map((c) => ({ id: c.id, x: c.x, z: c.z, v: c.v })) });
    };
    tick(0);
    for (let t = STEP; t < dur - 0.05; t += STEP) ctx.suspend(t).then(() => { tick(ctx.currentTime); ctx.resume(); });
    const buf = await ctx.startRendering();
    const post = total(counts);
    A.last = { L: buf.getChannelData(0), R: buf.getChannelData(1), rate };
    return { rate, max, honks, probes, nodesBuilt, nodesAfter: post, stats: { ...st.stats }, poolSize: st.poolSize, mono: 0 };
  };
  window.__lab = { A, render, mulberry32, LEN, Synth, Ambience, street, prof, mkCar, advance, vAt };
  return street ? 'new' : 'old';
}
