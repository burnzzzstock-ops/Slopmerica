# FABLE log: the AAA push

A fresh session can take over from this file alone. Newest entries are at the bottom of each section.

## Where things are

- **Worktree:** `C:/Users/burnz/Slopmerica-fable`, branch `claude/aaa-play` (LF line endings: `core.autocrlf false` in the worktree config).
- **Integration:** `aaa/integration` (mine to merge and push). ASTRA works on `codex/aaa-world` in its own worktree.
- **Ports:** 5180 to 5189. `--serve` in the suite uses 5189 by default; pass another port for a second run.
- **Brief:** `docs/aaa/FABLE.md`. ASTRA's: `docs/aaa/ASTRA.md`. Requests: `REQUESTS_FABLE.md` (mine to ASTRA), `REQUESTS_ASTRA.md` (ASTRA's to me, on its branch). Owner decisions: `DECISIONS_FABLE.md`.
- **Before a commit:** `npm run gate` (about 50 s). **Before a push:** `npm run smoke:gpu` (about 2 min on this PC; `npm run smoke` is the software-rendering run, about 6 min).
- **Never pipe the gate through `tail` in a command that then pushes.** The pipe hides the gate's exit code. This pushed one commit past a failing gate on day one; the failure was the port clash described below, not the code.
- **Long text goes through a file writer, not a shell heredoc.** Git Bash on this PC drops backslashes and trips on apostrophes in long heredocs.

## This PC

Windows 11, 32 cores, RTX 5090, Node 24.22, Chrome 157 (system Chrome; no Playwright Chromium installed). `scripts/lib/browser.mjs` finds it.

- Software WebGL (SwiftShader) draws a live game page at **0.7 fps**; the real card (`GPU=1`, ANGLE D3D11, "NVIDIA GeForce RTX 5090") at **55 fps**. Boot is 14.9 s against 10.3 s.
- `node scripts/suite.mjs --gpu` uses the card for every test not marked `"pixels": true` in the registry (14 are; they always use SwiftShader so their numbers are the same on every machine).
- Smoke tier, 4 at a time: 370 s on SwiftShader, **131 s with `--gpu`**, 15 of 15 pass both ways.

## Phase 0

### F0.1 Harness on Windows: done

| Commit | What |
|---|---|
| 2238295 | `.gitattributes`: every text file LF in every checkout (renormalize touched nothing else) |
| 463b011 | `scripts/lib/slots.mjs` (Node lock files, first-come queue, stale-pid cleanup, `SLOTS=4` per checkout) and `scripts/lib/proc.mjs` (`start`, `killTree`) |
| f00fd76 | `scripts/lib/browser.mjs` (`EXE`, `ARGS`, `launch`); 156 launch calls in 155 scripts rewritten; `grep pw-browsers scripts` now finds only that file |
| 18e87a3, 8810fbc | suite: CRLF-safe, 0 tests exits 1, an unknown `--only` name exits 1, timeouts kill the whole process tree |
| 4acd751 | `shadercheck` path (`fileURLToPath`) |
| 0d7e4d2 | `snapshot.mjs` without tar or symlinks (a junction for `node_modules`); default folder `../snap/<checkout>-<name>` |
| 10c8b8e | the reference town is `scripts/fixtures/refblock-town.json` (norcal, day 195, 262 buildings, 97 nodes, 111 segments) |
| dac96e4 | `SEED` defaults to 1 in every seeded test; `FUZZ=1` picks a random one |
| 8810fbc | registry moved to `scripts/tests/{fable,astra,shared}.json`; 49 unregistered scripts triaged (10 real tests now run); `--tier`, `--serve`, `--gpu`, `--owner` |
| 332a155 | node rigs pass `ws: false` to Vite (two rigs at once clashed on port 24678 and one hung) |

Registry today: 185 entries: 10 gate, 15 smoke, 85 full, 75 measure.

Not done in F0.1: `scripts/worktree.sh` still uses a symlink (replace it with a Node script when a helper needs a worktree); `scripts/withslot.sh` is still on disk but nothing calls it.

### F0.2 Gates: done, except the stricter typecheck

- 92920c7: `npm run gate` (typecheck, build and `scripts/budgets.json` at 2,255,099 bytes / 707,280 gzip with +5% allowed, the 10 node-only tests, the registry lint) and `npm run smoke` / `smoke:gpu` / `suite` / `suite:gpu`.
- Open: `noUnusedLocals` / `noUnusedParameters`, a `tsconfig.scripts.json`.

### Baseline

A full-suite run of commit 92920c7 (harness only, no `src/` change) writes to `shots/suite/base-92920c7/` (`summary.tsv` and one log per test). `shots/` is gitignored, so its table is copied into this file when the run finishes. Any later failure is compared against it.

### Contracts (for ASTRA): first version in

- `src/contracts.ts`: `WorldEvents`, `WorldFields`, `ScalarField`, `FieldLegend`, `InfoViewId`, `ViewTarget`, `ViewPose`, `MoneyKind`, `DisasterKind`.
- `game.fields` is live (`src/sim/fields.ts`): pollution, noise and land value fields; `roadCondition` (age only, provisional), `buildingAge`, `buildingCondition`, `pollutionAt`, `smog`, `naturePct`, `poseOf`.
- `game.sim.events` is typed with the world events. **None is emitted yet.** `scripts/contracttest.mjs` lists which have fired and checks each payload shape as it appears.
- People have a stable `id` (`game.peds.peds[].id`).

## Findings to act on

From the determinism inventory (a read of the code; nothing was run). The list is longer than the brief's:

1. Building ids are renumbered 1..N on load, and freight looks its saved stock up by the old id first, so a shop can get another shop's stock.
2. Traffic depends on frame rate beyond substep size: spawns are capped per substep, the drunk weave advances once per frame, and positions are written once per frame while T-bone checks run every substep.
3. Weather drives speed, crash odds, construction, demand, fires, solar and wind, and is never saved. Parts of it advance on real time, even while paused.
4. Pedestrians hold cars and trigger signal phases, and exist only when the camera is within 900 m. Touch devices start at exactly 900.
5. After a load the first daily tick runs on default demand, construction times are forced to 5 days and land value to 30, model variants are re-rolled (which decides drive-thru lanes), and landmarks under construction come back finished.
6. Services lose abandonment counters, fires, the noise field and dispatched trucks on load.
7. Some state changes run on wall-clock time: a 4.5 s `setTimeout` for commune road blockers, wildfire ignition in an async import callback, communes vanishing after 4 real seconds, bus dwell on real time, road links refreshed every 0.6 real seconds. Pause leaves traffic at 0.0001x, pedestrians at 0.3x and buses at 0.25x.
8. On load, zone cells get new ids and a new order (which changes where buildings grow), and trees or terrain cut by since-demolished roads come back.
9. One unseeded `Math.random` stream is shared by the sim and by camera-dependent cosmetics (161 call sites, 116 in sim scope). Only the sim's `Rng(777)` and transit's roll are saved.
10. `__dbg.run(days)` calls `frame(0.1)` at 4x speed, which is not the path live play takes.

## Next

1. Wire the world events as each system is touched (cheap ones first: crash, levelUp, construction, demolished, roadBuilt, laneAdded, moneyTick, zonePainted).
2. F0.3 determinism: fixed timestep in `game.ts`, seeded streams per system, stable ids, complete saves, `scripts/determinism.mjs`.
3. F0.4 (pedestrian sim independent of preset and camera), F0.5 saves, F0.6 debug gating, F0.7 hot spots, F0.8 AGENTS.md / CLAUDE.md.
