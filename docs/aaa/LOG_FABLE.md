# FABLE log: the AAA push

A fresh session can take over from this file alone. Read "Where things are", "State of the work" and "Next" first; the rest is reference.

## Where things are

- **Worktree:** `C:/Users/burnz/Slopmerica-fable`, branch `claude/aaa-play` (LF line endings: `core.autocrlf false` in the worktree config).
- **Integration:** `C:/Users/burnz/Slopmerica-int`, branch `aaa/integration` (mine to merge and push). It has its own `node_modules` (`npm ci` there after a lock change). ASTRA works on `codex/aaa-world` in its own worktree.
- **Main checkout:** `C:/Users/burnz/Slopmerica` is on `aaa/briefs`. Leave it alone.
- **Ports:** 5180 to 5189. `--serve` in the suite uses 5189 by default; pass another port for a second run.
- **Brief:** `docs/aaa/FABLE.md`. ASTRA's: `docs/aaa/ASTRA.md`. Requests: `REQUESTS_FABLE.md` (mine to ASTRA), `REQUESTS_ASTRA.md` (ASTRA's to me, on its branch). Owner decisions: `DECISIONS_FABLE.md`. The rules both lanes share are in `AGENTS.md` / `CLAUDE.md` at the repo root.
- **Before a commit:** `npm run gate` (about 50 s). **Before a push:** `npm run smoke:gpu` (about 2 min). **At a merge:** the full suite on the merged tree (about 18 min with `--gpu`).
- **Never pipe the gate through `tail` in a command that then pushes.** The pipe hides the gate's exit code. This pushed one commit past a failing gate on day one.
- **Long text goes through a file writer, not a shell heredoc.** Git Bash on this PC drops backslashes and trips on apostrophes in long heredocs. Edit scripts live in the session scratchpad; small edits go through a split/join helper that reports a missed match.
- **A server on a port does not die with `pkill`.** Find the PID with `netstat -ano` and use `taskkill //F //PID`.

## This PC

Windows 11, 32 cores, RTX 5090, Node 24.22, Chrome 157 (system Chrome; no Playwright Chromium installed). `scripts/lib/browser.mjs` finds it.

- Software WebGL (SwiftShader) draws a live game page at **0.7 fps**; the real card (`GPU=1`, ANGLE D3D11) at **55 fps**.
- `node scripts/suite.mjs --gpu` uses the card for every test not marked `"pixels": true` in the registry (those always use SwiftShader, so their numbers are the same on every machine).
- Smoke tier, 4 at a time: 370 s on SwiftShader, **131 s with `--gpu`**. The full suite: about 18 minutes with `--gpu` (two pixel tests, yellowflash and presetlight, take 10 minutes each on SwiftShader and set the floor).

## State of the work (17 Nov 2026)

`claude/aaa-play` is at `17e194e`. Everything below is committed. The registry has 189 entries on this branch (12 gate, 15 smoke, 87 full, 75 measure), 201 on the merge.

| Item | State |
|---|---|
| F0.1 harness on Windows | Done |
| F0.2 gates | Done, except `noUnusedLocals` / `noUnusedParameters`, a `tsconfig.scripts.json` and a `scripts/worktree.sh` without symlinks |
| F0.3 determinism | Done for frame rate and for save and reload on the norcal test town. Open: the other two maps, a two-year scripted-player town, the Low and Ultra modes (blocked on F0.4) |
| F0.4 presets never change the sim | **Open.** People still exist only near the camera and are capped by the preset |
| F0.5 saves | Exact state, versions and migration, packing, quota fallbacks and IndexedDB slot storage are done. Open: the slots UI, the confirm before New city, the message for an unreadable save, the golden-save test |
| F0.6 ship like a game | Done: no debug hooks or playtest tools in a player's build, one-file build with packs inside, README, `shiptest` |
| F0.7 sim hot spots | Open. The 10,000-person town to measure on is at `shots/towns/florida-10k.json` (gitignored; 14,632 people, 635 buildings) |
| F0.8 AGENTS.md / CLAUDE.md | Done |
| Contracts for ASTRA | Types, `game.fields` and 9 of 12 world events are live. Not emitted yet: `flood`, `collapseStage`, `paradisePaved` (they come with the systems that cause them) |
| Phases 1 to 4 | Not started |

### What changed, by commit

| Commit | What |
|---|---|
| 2238295 to 92920c7 | Harness: LF everywhere, slots and process helpers, one browser launcher (156 call sites), suite hardening, snapshot without tar, the registry as three JSON files with tiers, `--gpu`, `--serve`, the gate and smoke commands |
| 332a155 | Node rigs pass `ws: false` to Vite (two rigs at once clashed on port 24678) |
| 906954e | **One fixed step.** `Game.step()` is the only place the county changes; `Game.frame()` turns real time into whole steps and draws. Per-system seeded dice from one county seed. `src/sim/climate.ts` is the weather the sim runs on. `scripts/determinism.mjs`, `scripts/simpure.mjs` (gate) |
| b60851a | `src/core/snapshot.ts`: an exact serializer (typed arrays, maps, sets, references by id) with unit tests |
| f82d1ac | Review and suite fixes: a day is exactly 32 steps (0.078125 game seconds), `weather.force()` reaches the sim, the sky cannot drift from it, and a dozen draw-side fixes |
| c7da844 | **Exact saves.** A reload at any point carries on as the same county: every system saves its full state (`src/sim/state.ts`, `saveExact` / `loadExact`), trips in progress are saved by handler name, zone cells have stable ids |
| fc9b8a6 | Saves 25% smaller (1,361 kB to 1,024 kB raw on the test town); demolished buildings a car is still driving to are saved once as ghosts |
| 9f5be49 | `SEED=n` reaches the county's dice again; feedtest runs on Windows |
| a5961f6 | Save version 2 with a migration chain, packed with `src/core/lz.ts` above 1,000,000 characters (4.4x), quota fallbacks |
| 6964345 to 14d4e1b | World events wired: crash, levelUp, construction, demolished, roadBuilt, laneAdded, moneyTick, zonePainted, treesCleared, disaster, fireFront |
| ecdc0e6 | `src/sim/slots.ts`: named save slots in IndexedDB (no UI yet) |
| 1a50bfb to eefdc4a | Ship hygiene: `src/core/flags.ts`, hooks and playtest tools off in a player's build, packs inlined in `build:single` (one 12.1 MB file), README, vite 8.3.1 to 8.3.8 and source-map-js 1.2.2 (clears `npm audit`), `scripts/shiptest.mjs`, the phone population stat is finger-sized |
| 1cbdb6b | **A new reference town** (see below) |
| 321eec7 | `AGENTS.md` and `CLAUDE.md` |
| 98fb177 | costtest points its cursor at the spot the game's finder returns |
| 17e194e | A weather spell's floor is 12 real seconds at the player's speed again (19 days at top speed, under 5 at normal), so rain is days long at normal speed |

### How the simulation is built now

- `STEPS_PER_DAY = 32`, `STEP_SECONDS = 2.5 / 32` (`src/core/time.ts`). `Game.step()` order: `onStep` hooks, `zones.sync()`, the hour, `sim.step`, `climate.step`, weather effects, communes, `zones.sync()`, `traffic.step`, `peds.step`, every extension system's `step`.
- `Game.runSteps(n)` and `Game.stepsFor(days)`; `__dbg.run(days)` uses them.
- Dice: `streamSeed(game.seed, name)` per system; `fx` for looks and words. The seed comes from `window.__seed`, `#seed=N`, or 1 under automation, and is saved.
- Cars and people keep `pose0` and `pose`; `traffic.draw(alpha, dtReal, cam)` and `peds.draw(alpha, dtReal)` draw between them and record `shown`.
- Saves: `snapshot()` in `src/sim/save.ts` holds the legacy fields plus `seed` and `state` (`ExactState`). `SAVE_VERSION = 2`. `readSaveText` unpacks and migrates. `localStorage['slopmerica.packFrom']` overrides the packing threshold (tests set `'0'`).
- Debug: `src/core/flags.ts` (`DEBUG`, `PLAYTEST`). The test launcher asks for both on every page.

### The reference town

`scripts/fixtures/refblock-town.json.gz`, read through `scripts/lib/fixtures.mjs`. Norcal, seed 1: 969 people, 143 buildings, 128 roads, 112 junctions, 173 cars, centre `{x: 525, z: 45}`. Its main street, plants, wells, landfill and sewage works all stand and work. `scripts/refblock.mjs` grows it and refuses to save a broken town.

The town it replaced (262 buildings, no main street, no working utilities: the stroad had been drawn on top of the county road and every service aimed at ground with no road) is kept as `scripts/fixtures/saves/v1-norcal-block.json`, a version 1 save for the migration test.

A first fully serviced version grew to 2,277 people and 363 cars and made the traffic tests fail for load reasons, so the zones were cut back to about 1,000 people.

## Test results

### Baseline: commit 92920c7 (harness only), `--gpu`, seed 1

101 of 109 pass. The eight that did not:

| Test | Why | Now |
|---|---|---|
| feedtest | `import()` of a `C:\` path | Fixed (9f5be49) |
| phonetargets | The population stat was narrower than a finger with the emoji font on this PC | Fixed (eefdc4a) |
| trashcliff | The old town had no landfill | Passes on the new town |
| landmarktest, lightstest, parkingtest | Aim at places in the old town | Being re-pointed at the new town |
| yellowflash | Real: parked cars flash at night with bloom | ASTRA's (requested) |
| presetlight | Real: Low is brighter than the other presets at the noon shore | ASTRA's (requested) |

### Seeded traffic tests against the base, six seeds

- carsolid: fails on 3 of 6 seeds on the base and on this branch (overlapping pairs per car: base 0.00 to 0.07, now 0.00 to 0.02).
- crosswalktest: fails on 1 of 6 seeds on both (seed 6).

### Determinism (`scripts/determinism.mjs`)

Seed 1, norcal, a street grid with zones and services. Stepped, stepped again, 30 fps, 144 fps and a reload every 45 days agree on all 17 system fingerprints at every checkpoint for 180 days. Before the fixed step, 30 fps and 144 fps differed from day 1.

### First integration merge (`codex/aaa-world` 9fd06ea + `claude/aaa-play` ecdc0e6), `--gpu`, seed 1

113 of 122. The nine: photo-reflection (fails on `codex/aaa-world` alone: `mirror.lastEye` is undefined in `photoPNG`), presetlight and carsolid (as on the base), phonetargets and trashcliff (fixed by commits after ecdc0e6), parkingtest and lightstest (old-town aim), costtest (fixed, 98fb177), weathertest (fixed, 17e194e).

## Findings still to act on

1. People hold cars at crossings and trigger signal phases, and exist only when the camera is within 900 m. This is F0.4. The plan: town-wide seeded walkers in `peds` that do not depend on the camera; camera-local cosmetic extras in a separate list on the `fx` stream; a renderer handle of -1 for a walker not drawn; handles assigned at draw time. Then extend `qualitytest` to fingerprint the whole sim on Low and Ultra.
2. The interchange tool (`net.together()`) and communes clearing trees do not raise `roadBuilt` / `treesCleared`.
3. The sky module rolls nothing of its own any more but still owns the look of a spell; it is handed each spell through `weather.force`. It should read `game.climate` (requested).

## Next

1. Finish the integration merge: full suite on the merged tree, push `claude/aaa-play` and `aaa/integration`.
2. Cherry-pick the re-pointed lightstest, parkingtest and landmarktest once they pass on several seeds.
3. F0.4 (people), then the rest of F0.3 (three maps, the scripted-player town, Low and Ultra).
4. F0.5: slots UI on the title screen and in the game menu, confirm before New city, the unreadable-save message, three golden saves plus the v1 fixture, `slotstest`.
5. F0.7: profile the 10,000-person town, write `docs/aaa/PERF_SIM.md`, measure the save hitch.
6. Phase 1 in the brief's order: F1 traffic and induced demand, F2 the Growth Ponzi, F3 endings, F4 nature, F5 American roads, F6 parking, F7 citizens, F8 politics and Honest Mode, F9 headless sim.
7. Phase 2 (UI; this is where ASTRA's follow camera, photo mode and HUD icons get wired), Phase 3 (writing), Phase 4 (proof).
