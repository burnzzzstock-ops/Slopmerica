# Integration requests

| File or interface | Cause and requested change | Work it supports |
| --- | --- | --- |
| `scripts/suite.mjs` at `0d7e4d2` | `node scripts/suite.mjs --only does-not-exist-verify` still exits 0 after printing “0 of 0 pass”. The registry has tests, but the filtered selection is empty. Please reject unknown selectors or a zero-length selected run. | Prevents a misspelled look gate from approving a change |
| `scripts/fixtures/refblock-town.json`, `scripts/refblock.mjs` | The starting branch grows an unversioned reference town. Please publish the canonical town and centre and make capture scripts load them. | Reproducible block goldens, hardware timing and draw-call budgets |
| `src/contracts.ts`, inspector and Settings | Expose a stable view target and a way to resolve its current world pose. Wire inspector follow and photo/camera controls to the rendering API once the camera changes land. | Car/person follow and photo mode |
| Simulation events and fields in `src/contracts.ts` | Please publish the typed event names, position units, availability of condition/age, per-view field and local pollution access as they land. | Road wear, material aging, overlays, world feedback and adaptive sound |
