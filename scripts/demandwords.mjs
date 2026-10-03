// The demand card's reasons read right at 1 (docs/AUDIT_ROUND8_UI.md S2: the phone's card said "1 buildings missing
// utilities" and "1 more workers than jobs"). No browser: the reasons are built in src/sim/sim.ts (the demand parts) and
// src/sim/services.ts (the utilities' hit), and a count there goes into a sentence only through a helper that makes its
// noun singular at 1 (many() in sim.ts, the ternary in services.ts). This finds any count put straight before a plural.
// usage: node scripts/demandwords.mjs      exits 1 on failure
import { readFileSync } from 'node:fs';
let bad = 0;
const check = (label, ok, extra) => { console.log(ok ? 'OK  ' : 'FAIL', label, ok || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); if (!ok) bad++; };
// "${Math.round(x)} more jobs", "${miss} buildings": a number, then (more / too many) and a word ending in s
const raw = /\$\{(?:Math\.round\([^`}]*\)|[a-zA-Z_.]+)\} (?:(?:more|too many) )?(?:[a-z]+ )?(?:jobs|workers|buildings|homes|shops|people)\b/g;
const src = (f) => readFileSync(new URL(`../src/sim/${f}`, import.meta.url), 'utf8');
const sim = src('sim.ts'), at = sim.indexOf('// ---- demand'), demand = sim.slice(at, sim.indexOf('\n  }\n', at));
check('the demand parts in sim.ts are found', at > 0 && demand.includes("part('res'"));
const inSim = demand.match(raw) ?? [];
check(`no count goes straight before a plural in the demand parts (${inSim.length})`, inSim.length === 0, inSim);
const svc = src('services.ts'), hook = svc.slice(svc.indexOf('H.demand.push('), svc.indexOf('H.demand.push(') + 900);
const inSvc = hook.match(raw) ?? [];
check(`nor in the utilities' hit on demand in services.ts (${inSvc.length})`, inSvc.length === 0, inSvc);
// the helper itself: singular at 1, plural otherwise
const m = demand.match(/const many = \(n: number, one: string, more = `\$\{one\}s`\) => `\$\{n\} \$\{n === 1 \? one : more\}`;/);
check('many() makes the noun singular at 1 only', !!m || !demand.includes('many('), m ? undefined : 'many() not found as written');
process.exit(bad ? 1 : 0);
