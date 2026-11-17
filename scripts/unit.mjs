// (no browser) Runs the unit tests in scripts/unit/ with Node's own test runner: plain math and data code from src/, loaded as
// TypeScript with no build and no page. A test file is scripts/unit/<name>.test.mjs.
// usage: node scripts/unit.mjs [name]      (name: run only scripts/unit/<name>.test.mjs)
import { spawnSync } from 'node:child_process';
const only = process.argv[2];
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', only ? `scripts/unit/${only}.test.mjs` : 'scripts/unit/*.test.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
