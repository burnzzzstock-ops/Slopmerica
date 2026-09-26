// Shader source checks that don't need a GPU. The classic fract(sin(x)*43758)
// hash breaks on GPUs whose sin loses precision for large arguments (the
// Windows/ANGLE path the playtest ran on): water noise turned into blocky
// white speckles. Use the sin-free hash instead. Exits nonzero on failure.
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|glsl)$/.test(f)) files.push(p); } };
walk(root);
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/fract\s*\(\s*sin\s*\(/.test(line) || /43758\.5/.test(line)) { console.log(`FAIL ${path.relative(root, f)}:${i + 1} sin-based hash: ${line.trim().slice(0, 100)}`); bad++; }
  });
}
console.log(bad ? `FAIL ${bad} sin-based hash(es) in shaders` : `OK   no sin-based hashes in ${files.length} source files`);
process.exit(bad ? 1 : 0);
