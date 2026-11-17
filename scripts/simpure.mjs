// (no browser) The simulation's files never reach for the dice or the clock themselves. A county must come out the same at any
// frame rate, on any graphics preset and after any reload (scripts/determinism.mjs proves it on a town; this keeps it true as
// code is added), so in the files the simulation lives in:
//   Math.random                       never: dice come from a seeded stream (core/rng.ts: streamSeed), looks and words from `fx`
//   setTimeout / setInterval          never: a delay is a count of fixed steps
//   performance.now / Date.now / new Date    never for a decision
//   requestAnimationFrame             only the game loop
// The uses that are fine are listed below with why, as a count per file: a new one fails this until it is looked at and listed.
// usage: node scripts/simpure.mjs
import { readFileSync, readdirSync } from 'node:fs';

const DIRS = ['src/sim', 'src/transit', 'src/zones', 'src/ext', 'src/core'];
const FILES = ['src/game.ts', 'src/agents/traffic.ts', 'src/agents/pedestrians.ts', 'src/agents/communes.ts', 'src/agents/parking.ts', 'src/roads/network.ts', 'src/roads/roadJunction.ts', 'src/roads/roadTypes.ts'];
const SKIP = new Set(['src/core/prof.ts', 'src/sim/serviceIcons.ts']);   // the frame profiler is a clock; the icons are drawing
const RULES = {
  random: /Math\.random/,
  timer: /\bsetTimeout\b|\bsetInterval\b/,
  clock: /performance\.now|Date\.now|new Date\(/,
  raf: /requestAnimationFrame/,
};
// file -> rule -> [how many, why they are fine]
const ALLOW = {
  'src/game.ts': {
    random: [1, 'the seed of a brand-new county when none is given'],
    timer: [1, 'thunder is heard a moment after the flash (sound only)'],
    clock: [8, 'boot timing lines, the black-frame check and the frame loop measuring real frames'],
    raf: [1, 'the frame loop'],
  },
  'src/core/rng.ts': { random: [1, 'the seed of fx, the dice for looks and words only'] },
  'src/sim/save.ts': { clock: [4, 'when a save was written, and how often to warn that saving failed'] },
  'src/sim/slots.ts': { clock: [1, 'when a city was put in a slot (shown in the list of slots)'] },
  'src/sim/buildings.ts': { clock: [2, 'a counter of model-building time for the performance overlay'] },
  'src/sim/services.ts': { clock: [1, 'a counter of the daily tick cost for the performance overlay'] },
  'src/sim/sim.ts': { clock: [2, 'the calendar label (day 0 is March 20): arithmetic on a fixed date, not the clock'] },
};

const files = [...FILES, ...DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`))].filter((f) => !SKIP.has(f));
let bad = 0;
const seen = {};
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  for (const [rule, re] of Object.entries(RULES)) {
    const hits = [];
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');                       // not what a comment says
      if (/^\s*(\*|\/\*)/.test(line)) return;
      if (re.test(code)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 130)}`);
    });
    const [n, why] = ALLOW[f]?.[rule] ?? [0, ''];
    (seen[f] ??= {})[rule] = hits.length;
    if (hits.length === n) continue;
    bad++;
    console.log(`FAIL ${f}: ${hits.length} use(s) of ${rule} (${n} known${why ? `: ${why}` : ''})`);
    for (const h of hits) console.log(`       ${h}`);
  }
}
// an allowance for something that is no longer there is stale: say so, so the list stays true
for (const [f, rules] of Object.entries(ALLOW)) for (const rule of Object.keys(rules)) if (!(f in seen)) { bad++; console.log(`FAIL ${f} is listed here but is not one of the files checked`); }
console.log(bad ? `FAIL ${bad} file/rule pair(s): use a seeded stream or a count of fixed steps, or list the use here with its reason` : `OK   ${files.length} simulation files: no unseeded dice, no timers, no clock in a decision`);
process.exit(bad ? 1 : 0);
