// The sentences the HUD builds from numbers read right at 0, 1 and many (round 8 audit: a first power cut in a small town toasted "1 buildings without
// power", and a commune's court date "1 days"). No browser: the sentences live in src/ui/copy.ts, which the HUD uses and this imports.
// usage: node scripts/copytest.mjs      exits 1 on failure
import { count, courtText, emergencyToast } from '../src/ui/copy.ts';
let bad = 0;
const check = (label, got, want) => { const ok = got === want; console.log(ok ? 'OK  ' : 'FAIL', label, ok ? '' : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); if (!ok) bad++; };
check('1 building', count(1, 'building'), '1 building');
check('0 buildings', count(0, 'building'), '0 buildings');
check('1,204 buildings', count(1204, 'building'), '1,204 buildings');
check('the emergency toast, one building', emergencyToast('Power', 1, 'without power', 'same'), '🚨 Power emergency: 1 building without power.');
check('the emergency toast, many buildings, slowed', emergencyToast('Water', 14, 'without water', 'slowed'), '🚨 Water emergency: 14 buildings without water. Slowed to normal speed.');
check('the emergency toast, paused', emergencyToast('Garbage', 2, 'buried in trash', 'paused'), '🚨 Garbage emergency: 2 buildings buried in trash. Paused.');
check('the emergency toast with no names yet', emergencyToast(undefined, 3, undefined, 'same'), '🚨 Service emergency: 3 buildings failing.');
check('court tomorrow', courtText(1), '⚖️ Court in 1 day');
check('court in a week', courtText(7), '⚖️ Court in 7 days');
check('court today never goes negative', courtText(-2), '⚖️ Court in 0 days');
// and the HUD really uses them (the old toast was a template string inside hud.ts)
import { readFileSync } from 'node:fs';
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
check('the HUD builds the emergency toast with emergencyToast()', /this\.toast\(emergencyToast\(/.test(hud) && !/\$\{e\.atRisk\} buildings/.test(hud.replace(/crumb\([^\n]*\n/g, '')), true);
check('the HUD builds a commune court date with courtText()', /courtText\(/.test(hud) && !/Court in \$\{Math\.max/.test(hud), true);
process.exit(bad ? 1 : 0);
