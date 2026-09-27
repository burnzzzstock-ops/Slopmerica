// IP check for the parody brands, in code (no Jev, no key): a small table of
// the real slogans and brand colors the parody chains riff on, checked against
// every string in src/ and every brand's colors. A language model's memory of
// slogans is patchy (the first content audit missed Tractor Supply's "For Life
// Out Here"), so exact lookups live here and Jev is left to judgment.
//   FAIL    a real slogan used word for word, or a brand wearing both of a real
//           brand's exact colors (trade dress)
//   REVIEW  a one-word riff on a real slogan, or one exact real brand color
// The owner decides content: a finding they've signed off goes in ACCEPTED
// (with why), and the check passes. It never edits copy. `import { ipFindings }`
// for other scripts (the content audit's IP section). Exits 1 on an unaccepted
// FAIL. --dry-run is the same (this check needs no key).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** real slogans and trade names the parody brands riff on (what the real brand says) */
export const REAL_SLOGANS = [
  { owner: 'Taco Bell', text: 'Think outside the bun' },
  { owner: 'Taco Bell', text: 'Run for the border' },
  { owner: 'Tractor Supply', text: 'For life out here' },
  { owner: 'Cracker Barrel', text: 'Old Country Store' },
  { owner: 'Home Depot', text: 'More saving. More doing.' },
  { owner: 'Home Depot', text: "Let's do this" },
  { owner: 'Burger King', text: 'Have it your way' },
  { owner: 'Krispy Kreme', text: 'Hot now' },
  { owner: 'Olive Garden', text: "When you're here, you're family" },
  { owner: "Applebee's", text: 'Neighborhood Grill + Bar' },
  { owner: "McDonald's", text: 'Billions and billions served' },
  { owner: "McDonald's", text: 'Billions served' },
  { owner: 'Walmart', text: 'Save money. Live better.' },
];

/** exact published brand colors (lowercase hex) */
export const REAL_COLORS = [
  { owner: 'Walmart', colors: ['#0071ce', '#ffc220'] },
  { owner: "McDonald's", colors: ['#da291c', '#ffc72c'] },
  { owner: 'Amazon', colors: ['#232f3e', '#ff9900'] },
  { owner: 'TikTok', colors: ['#25f4ee', '#fe2c55'] },
  { owner: 'Home Depot', colors: ['#f96302'] },
];

/**
 * Findings the owner has reviewed and kept, keyed `slogan:<file>:<real slogan>`
 * or `color:<brand id>:<real owner>`, each with the reason. Empty until they decide.
 */
export const ACCEPTED = {};

const words = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/\+/g, ' and ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** 'exact' when the slogan's words appear in order; 'riff' when a 4+ word slogan has one word swapped, or keeps its first three words and goes elsewhere */
export function sloganMatch(line, slogan) {
  const L = words(line), S = words(slogan), n = S.length;
  let riff = false;
  for (let i = 0; i + Math.min(n, 3) <= L.length; i++) {
    let same = 0, lead = 0;
    for (let j = 0; j < n && i + j < L.length; j++) if (L[i + j] === S[j]) { same++; if (lead === j) lead++; }
    const span = Math.min(n, L.length - i);
    if (same === n && span === n) return 'exact';
    if (n >= 4 && span === n && same === n - 1 && L[i] === S[0]) riff = true;
    if (n >= 4 && lead >= 3) riff = true; // "Save money. Live in your car."
  }
  return riff ? 'riff' : null;
}

/** every quoted string in a TS source, with its line */
function strings(src) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    const text = (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (/[a-z]{2}/i.test(text)) out.push({ text, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

function tsFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/** all findings: { kind, level, key, where, what, real, owner } */
export async function ipFindings() {
  const found = [];
  for (const file of tsFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const s of strings(readFileSync(file, 'utf8'))) {
      for (const r of REAL_SLOGANS) {
        const m = sloganMatch(s.text, r.text);
        if (!m) continue;
        // one finding per line of source (a brand's blurb, tagline and sign say it three times;
        // "Billions served" and "Billions and billions served" are one McDonald's line)
        const where = `${rel}:${s.line}`, same = found.find((f) => f.where === where && (f.real === r.text || f.owner === r.owner && /^Billions/.test(f.real) && /^Billions/.test(r.text)));
        if (same) {
          if (!same.variants.includes(s.text)) same.variants.push(s.text);
          if (m === 'exact') { same.level = 'FAIL'; same.match = 'exact'; }
          continue;
        }
        found.push({ kind: 'slogan', level: m === 'exact' ? 'FAIL' : 'REVIEW', key: `slogan:${rel}:${r.text}`, where, what: s.text, variants: [s.text], real: r.text, owner: r.owner, match: m });
      }
    }
  }
  const { BRANDS } = await import(pathToFileURL(join(ROOT, 'src/art/brands.ts')).href);
  for (const b of BRANDS) {
    const mine = new Set([...b.colors, b.sign?.bg, b.sign?.fg, b.sign?.accent].filter(Boolean).map((c) => c.toLowerCase()));
    for (const r of REAL_COLORS) {
      const hit = r.colors.filter((c) => mine.has(c));
      if (!hit.length) continue;
      const pair = r.colors.length > 1 && hit.length === r.colors.length;
      found.push({ kind: 'color', level: pair ? 'FAIL' : 'REVIEW', key: `color:${b.id}:${r.owner}`, where: `src/art/brands.ts (${b.id})`, what: `${b.name} ${hit.join(' + ')}`, real: r.colors.join(' + '), owner: r.owner, match: pair ? 'pair' : 'one' });
    }
  }
  return found;
}

// ---- CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let bad = 0;
  // the matcher itself, on cases from the first audit
  for (const [line, slogan, want] of [
    ['THINK OUTSIDE THE BUN', 'Think outside the bun', 'exact'],
    ['For life out here (in the subdivision).', 'For life out here', 'exact'],
    ['HAVE IT HIS WAY', 'Have it your way', 'riff'],
    ["When you're here, you're parked.", "When you're here, you're family", 'riff'],
    ['SAVE MONEY. LIVE IN YOUR CAR.', 'Save money. Live better.', 'riff'],
    ['NEIGHBORHOOD GRILL + BAR', 'Neighborhood Grill + Bar', 'exact'],
    ['Your package is safe in locker QZ-47 behind the old tire store.', 'Old Country Store', null],
    ['Hot takes now available', 'Hot now', null],
  ]) {
    const got = sloganMatch(line, slogan);
    if (got !== want) { console.log(`FAIL matcher: "${line}" vs "${slogan}" gave ${got}, expected ${want}`); bad++; }
  }
  const all = await ipFindings();
  for (const f of all) {
    const ok = f.key in ACCEPTED;
    const tag = ok ? 'OK  ' : f.level === 'FAIL' ? 'FAIL' : 'REVIEW';
    if (tag === 'FAIL') bad++;
    const what = f.kind === 'slogan' ? `${f.variants.map((v) => `"${v.slice(0, 60)}"`).join(' / ')} ${f.match === 'exact' ? 'uses' : 'riffs on'} "${f.real}" (${f.owner})` : `${f.what} ${f.match === 'pair' ? 'is' : 'shares'} ${f.real} (${f.owner})`;
    console.log(`${tag} ${f.kind === 'slogan' ? 'slogan' : 'colors'}: ${what} (${f.where})${ok ? ` · accepted: ${ACCEPTED[f.key]}` : ''}`);
  }
  const n = (lvl) => all.filter((f) => f.level === lvl && !(f.key in ACCEPTED)).length;
  console.log(`${all.length} findings: ${n('FAIL')} to fix or accept, ${n('REVIEW')} to review, ${all.filter((f) => f.key in ACCEPTED).length} accepted`);
  if (!all.length) console.log('OK   no real slogans or brand colors found');
  process.exit(bad ? 1 : 0);
}
