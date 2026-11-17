# FABLE log: the AAA push

A fresh session can take over from this file alone. Read "Where things are", "State of the work" and "Next" first; the rest is reference.

## Where things are

- **Worktree:** `C:/Users/burnz/Slopmerica-fable`, branch `claude/aaa-play` (LF line endings: `core.autocrlf false` in the worktree config).
- **Integration:** `C:/Users/burnz/Slopmerica-int`, branch `aaa/integration` (mine to merge and push). It has its own `node_modules` (`npm ci` there after a lock change). ASTRA works on `codex/aaa-world` in its own worktree.
- **Main checkout:** `C:/Users/burnz/Slopmerica` is on `aaa/briefs`. Leave it alone.
- **A second session worked this lane on 17 Nov** ("Claude FABLE handoff", worktree `C:/Users/burnz/Slopmerica/.claude/worktrees/play-ui`, local branch `claude/aaa-play-ui`): the owner pasted the same handoff into it. It built the HUD wiring in parallel; this branch's versions are the ones on integration, and its one new fix was cherry-picked (acc29c5). It was asked to cut a fresh branch from `claude/aaa-play` and offer only what this branch lacked, and did: `claude/aaa-play-polish`, four commits, merged here at 699ec0e after its 16 UI tests passed on the merged tree (icons on the inspector rows, the tool badge and the top bar; a Focus slider and a P key for photo mode; the Next card re-placed the moment a drawer opens; step 5 ending by itself on day 15). Its first branch, `claude/aaa-play-ui`, is superseded and nothing on it is needed; deleting it is the owner's call. **The owner decided on 17 Nov that the lane has two sessions ("Two, split them"):** that one has the interface (`src/ui/*`, `src/tools/*`, `src/style.css`, `index.html`, the panel and inspector blocks inside simulation files), this one has the simulation, the harness and `aaa/integration`. `AGENTS.md`, Lanes, has it file by file, with the ports (this session: 5180 to 5184, and 5189 for integration). From here on this session does not edit `src/ui/*` or `src/tools/*`: what a player should see of new simulation work goes to that session as a message. Whether there are two sessions is the owner's call (`DECISIONS_FABLE.md`). **Check `git worktree list` and `git branch -a` for a parallel play-lane branch before starting UI work.**
- **A third lane joined on 17 Nov:** ORION (Antigravity), the director and reviewer: it listens to rendered audio, looks at screenshots, plays the game in a live browser and generates 2D art. Workspace `C:/Users/burnz/.gemini/antigravity/scratch/Slopmerica`, ports 5170 to 5179, branch `agy/aaa-director` (not pushed yet). Its evaluation and its queue for this lane are in that workspace, untracked: `docs/aaa/EVAL_AND_AAA_FUN_ROADMAP.md` and `docs/aaa/HANDOFF_FABLE_CLAUDE.md`. The owner pasted the roadmap into this session on 17 Nov, so its priorities are the owner's ("fun first"); "Next" below follows them. Both files were written against `9b3f161` and are out of date on everything listed in "State of the work".
- **Ports:** 5180 to 5189. `--serve` in the suite uses 5189 by default; pass another port for a second run.
- **Brief:** `docs/aaa/FABLE.md`. ASTRA's: `docs/aaa/ASTRA.md`. Requests: `REQUESTS_FABLE.md` (mine to ASTRA), `REQUESTS_ASTRA.md` (ASTRA's to me, on its branch). Owner decisions: `DECISIONS_FABLE.md`. The rules both lanes share are in `AGENTS.md` / `CLAUDE.md` at the repo root.
- **Before a commit:** `npm run gate` (about 50 s). **Before a push:** `npm run smoke:gpu` (about 2 min). **At a merge:** the full suite on the merged tree (about 18 min with `--gpu`).
- **Never pipe the gate through `tail` in a command that then pushes.** The pipe hides the gate's exit code. This pushed one commit past a failing gate on day one.
- **Long text goes through a file writer, not a shell heredoc.** Git Bash on this PC drops backslashes and trips on apostrophes in long heredocs. Edit scripts live in the session scratchpad; small edits go through a split/join helper that reports a missed match.
- **A server on a port does not die with `pkill`.** Find the PID with `netstat -ano` and use `taskkill //F //PID`.
- **NOT PUSHED, waiting on the owner:** from the evening of 17 Nov, GitHub sign-in on this PC stopped working (the credential manager wants a sign-in, and `gh auth status` says the token is invalid). `aaa/integration` and `claude/aaa-play` are both at c17d707 locally (or later for the play branch) and verified; origin has 584ab95 and 699ec0e. When the owner has signed in again: `git push origin aaa/integration` in `Slopmerica-int` and `git push origin claude/aaa-play` in `Slopmerica-fable`. A push that hangs is the credential manager waiting for a window nobody is looking at: run it with `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0` to get the error instead.
- **Do not wait for a suite with a shell loop that starts a process every few seconds.** Two of those running at once ended with "fork: Resource temporarily unavailable" and took the session down with the suite. Wait on the background task's own notice, or with one process that reads the log.
- **Keep the machine quiet while an integration suite runs.** Running my own gates and tests beside it made the look lane's frame-cost test (reflecttest) fail; it passes alone.
- **nightglow is a coin toss.** On one commit it reads the night street at 103 (pass) or 110.1 (fail) from run to run: three runs at bda104b gave fail, pass, fail. Do not chase it as a regression (it cost an hour); it is reported to the look lane.
- **Do not export a test's setting for a whole suite run.** `DAYS=120`, meant for the determinism test, also reached trashcliff and made it fail (it needs 133 days). The determinism entry in the registry carries its own settings now.
- **Merge `origin/aaa/integration` into `claude/aaa-play` before every push** (done at 29cc868; the push at `03ecb16` went without it).

## This PC

Windows 11, 32 cores, RTX 5090, Node 24.22, Chrome 157 (system Chrome; no Playwright Chromium installed). `scripts/lib/browser.mjs` finds it.

- Software WebGL (SwiftShader) draws a live game page at **0.7 fps**; the real card (`GPU=1`, ANGLE D3D11) at **55 fps**.
- `node scripts/suite.mjs --gpu` uses the card for every test not marked `"pixels": true` in the registry (those always use SwiftShader, so their numbers are the same on every machine).
- Smoke tier, 4 at a time: 370 s on SwiftShader, **131 s with `--gpu`**. The full suite: about 18 minutes with `--gpu` (two pixel tests, yellowflash and presetlight, take 10 minutes each on SwiftShader and set the floor).

## State of the work (17 Nov 2026)

`aaa/integration` is pushed at `584ab95`: 123 of 129 on its suite (the six: photo-reflection and presetlight, the look lane's; carsolid, crosswalktest, lightstest and landmarktest, the traffic table below). `claude/aaa-play` is pushed at `699ec0e` plus this file, with the save slots, the held-press fix and the polish branch on top of what integration had. Everything below is committed. The registry has 191 entries on this branch (12 gate, 15 smoke, 89 full, 75 measure), 203 on the merge.

| Item | State |
|---|---|
| F0.1 harness on Windows | Done |
| F0.2 gates | Done, except `noUnusedLocals` / `noUnusedParameters`, a `tsconfig.scripts.json` and a `scripts/worktree.sh` without symlinks |
| F0.3 determinism | Done for frame rate and for save and reload on the norcal test town. Open: the other two maps, a two-year scripted-player town, the Low and Ultra modes (blocked on F0.4) |
| F0.4 presets never change the sim | **Open.** People still exist only near the camera and are capped by the preset |
| F0.5 saves | Done but for the golden-save test: exact state, versions and migration, packing, quota fallbacks, slots with their UI on the title screen and in Settings, the question before a new city replaces the one to resume, and the notice for a stored city that cannot be read (1ea4162, `scripts/slotstest.mjs`). Open: three committed golden saves that every build must still load (there are two fixtures to start from: `saves/v1-norcal-block.json` and `saves/v2-drivethru-jam.json.gz`) |
| F0.6 ship like a game | Done: no debug hooks or playtest tools in a player's build, one-file build with packs inside, README, `shiptest` |
| F0.7 sim hot spots | Started: `scripts/simperf.mjs` and `docs/aaa/PERF_SIM.md`. On the 14,440-person town a step is 3.85 ms (traffic four fifths), 49% of a core at top speed; the every-third-day hitch is 41 ms, down from 62 (c5a94a8). Left: spread the land value pass over its three days, the daily tick, traffic inside, the save hitch, a 50,000-person town |
| F0.8 AGENTS.md / CLAUDE.md | Done |
| Contracts for ASTRA | Types, `game.fields` and 11 of 14 world events are live. Not emitted yet: `flood`, `collapseStage`, `paradisePaved` (they come with the systems that cause them) |
| U1, U4 the phone screen | First pass done (1edb035): see "The phone screen" below |
| Phases 1 to 4 otherwise | Not started. Two traffic bugs that locked a main street are fixed (897fd37, ef3b669) |

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
| 65e2c58 | `REFTOWN=v1` opens the old reference town; the suite sets it for every test in `astra.json` until the look lane has measured again on today's town |
| 1edb035 | **Phone:** the map stays in view under an open drawer and a drawing finger; `scripts/phonefree.mjs` |
| 897fd37 | **Traffic:** a car on its way to a drive-thru that is gone pulls into the lot (it waited at the kerb for good and locked the main street); `scripts/thrugone.mjs` |
| ef3b669 | **Traffic:** a shop rebuilt as a drive-thru gets its lane; parkingtest fits any town |
| fc09515 | The reference town regrown with its traffic moving; the grower refuses a town saved in a jam |
| be5dbff, 03ecb16 | lightstest and landmarktest look at the new town's own junctions and field |
| 29cc868 | `aaa/integration` merged into this branch: it now holds the look lane's code |
| bf298e1 | **HUD:** the look lane's drawn icons are on the controls (`src/ui/icons.ts`, `scripts/hudicons.mjs`) |
| 13032ad | **HUD:** a Follow button on cars and people, and a pill for who the camera rides with (`scripts/followtest.mjs`) |
| ea27287 | **HUD:** photo mode has a way in (More) and a bar of controls (`src/ui/photoBar.ts`, `scripts/phototest.mjs`) |
| 087e9cf | The content audit no longer reads a drawn icon's outline as a line of copy |
| 556917f | The toolbar is as tall as it was before it got drawn icons (an open drawer lay 3 px over it) |
| 5c44154 | Photo joins the toolbar apart from the core list (the look lane's icon test reads that list and wants art for every id) |
| ab8573e, 2c54bcc | **Roads:** ONE MORE LANE is remembered, stamped and watched for 78 weeks (`src/sim/widening.ts`, `scripts/onemorelane.mjs`) |
| 4ea05b4 | A household's trip can weigh a few places by today's drive: in the code, switched off (`TUNING.whereTo.choices: 1`) |
| 7f727f1, c5a94a8 | `scripts/simperf.mjs`; the land value pass no longer searches 300 m round every building for a landmark (the same county, a third less hitch) |
| 1ea4162 | **Saves:** slots on the title screen and in Settings; Start paving asks before a new city takes the old one's place; an unreadable stored city is said so and kept |
| acc29c5 | A mouse press held on Bulldoze or One More Lane is no longer lost when the inspector redraws (`scripts/presstest.mjs`; from the second play-lane session) |
| d1f1e09, 94d36e7, de0376d, f9fef47 (merged at 699ec0e) | From the second session's polish branch: drawn icons on the tool badge, the top bar and the inspector; photo mode gets a Focus slider (after Street level the Blur slider did nothing, and nothing could move the focus back) and opens on P; the step card changes shape the moment a drawer opens or closes; the last first step ends by itself on day 15 |

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

The town committed in 1cbdb6b had been saved with its main street locked for good: a McDougal's levelled up into a building with no drive-thru while three cars were on their way to its window, and they waited at its kerb for ever with 30 cars behind them. That save is kept as `scripts/fixtures/saves/v2-drivethru-jam.json.gz` (thrugone opens it). The town was regrown in fc09515 after the fix: the same buildings and roads, 187 cars, nobody standing on the road for over 33 s in its last 85 days. `scripts/refblock.mjs` now refuses to save a jammed town.

### The phone screen (1edb035)

Share of a 390 x 844 screen where a finger lands on the map and nothing else (`scripts/phonefree.mjs`): idle with the first step showing 82%; Roads open 55% to 60%; Zoning open 57% to 61%; Services open 44% to 48%; a finger drawing a road 71% to 83%. Beside an open drawer the tutorial step is one line (a tap opens it); under a drawing finger it is hidden and the cost readout is two lines; a tool drawer has no title row; the service categories and road modes are one scrolling row.

Still to do on the phone: the readout after the finger lifts is the whole text again (116 px tall); the Services drawer is the tallest thing on the screen and its "Looks: Asset Vault / Classic" row belongs in Settings; the top bar is one tight row.

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

### The play lane's traffic tests on the regrown town (fc09515), seeds 1 to 6, Low, real GPU

| Test | Result | What fails |
|---|---|---|
| thrugone, trashcliff | pass | |
| parkingtest | 5 of 6 | seed 6: the grand opening's line holds nobody behind it |
| crosswalktest | 5 of 6 | seed 1: one walker inside a car once (the base: seed 6) |
| carsolid | 0 of 6 | cars inside each other for an instant (0.00 to 0.02 pairs in a lane, 0.01 to 0.02 in a junction) and 2 to 5 heading snaps in 120 s. Its 60-second-wait check passes on all six now (it was 120 s on all six) |
| lightstest | 2 of 6 | actuated greens carry 11 to 17% more at their best junction where the test asks 20%; a leading green does not cut the lefts' wait on seed 1; leading greens cost all the lights over a tenth of their cars on seeds 5 and 6 |
| landmarktest | 1 of 6 | 16 to 22 of 29 fans are in their seats by kickoff where the test asks 20 |

None of these thresholds was loosened. They are what the traffic does on a town whose streets are moving, and they are the first work of the traffic phase.

### Integration at bda104b, `--gpu`, seed 1

119 of 125. The six: photo-reflection (fails on the look lane's branch alone) and presetlight (fails on the base), both the look lane's; carsolid, lightstest and landmarktest (the table above); crosswalktest (one walker inside a car once on seed 1; it was seed 6 on the base: one seed in six on both).

### Integration at 556917f (the HUD wiring), `--gpu`, seed 1

119 of 128. The nine: hud-icon-art (Photo had no drawn icon; fixed in 5c44154), reflecttest (slowed by my own work running beside the suite; passes alone), nightglow (the coin toss above), photo-reflection and presetlight (the look lane's, failing before), carsolid, crosswalktest, lightstest and landmarktest (the traffic table above).

### Integration at c17d707 (save slots, the held-press fix, the interface session's polish branch), `--gpu`, seed 1

122 of 131 at 699ec0e. The nine: playtest4 (it looked for the garbage emoji the inspector's utility row no longer starts with; fixed in cd31237 and passing on c17d707), people-fov (the browser did not start; passes alone), nightglow (the coin toss; passed on the rerun), and the same six as before: photo-reflection, presetlight, carsolid, crosswalktest, lightstest, landmarktest. Gate passes on c17d707.

### First integration merge (`codex/aaa-world` 9fd06ea + `claude/aaa-play` ecdc0e6), `--gpu`, seed 1

113 of 122. The nine: photo-reflection (fails on `codex/aaa-world` alone: `mirror.lastEye` is undefined in `photoPNG`), presetlight and carsolid (as on the base), phonetargets and trashcliff (fixed by commits after ecdc0e6), parkingtest and lightstest (old-town aim), costtest (fixed, 98fb177), weathertest (fixed, 17e194e).

## What induced demand needs

The design: "widen the road and the traffic comes back", "it always works for about 18 months", and "it isn't scripted: it falls out of the model". Measured (`scripts/onemorelane.mjs`), it does not happen, and three things in the model are why:

1. **The county keeps a set number of cars on the road.** `targetCars` in `src/agents/traffic.ts` is people and jobs times the hour of day times `induced = 0.6 + 0.6 * flowEma`. A wider road gives the same cars more room (a third less full going from four lanes to six) and clears its queues faster (less full again). Trips end sooner, so more are made in an hour, but the roads never hold more cars than before. The one thing that answers to speed is that county-wide factor, worth at most a doubling between the worst flow and the best.
2. **Most trips on a town's main road come in from out of town** when jobs outnumber the workers who live there (up to 85% of trips), and they pass through the road wherever they are bound, so where they choose to go changes nothing on it.
3. **Nothing in the demand for homes, shops or jobs listens to traffic.** `src/sim/sim.ts` has no traffic term at all: a jammed county grows as fast as a flowing one, and a relieved one grows no faster. This is the loop the design means ("traffic, one more lane, growth, traffic") and it is not closed.

What was tried: every household trip weighing three places by today's drive (`Traffic.whereTo`, in the code, switched off). It sways two thirds of those trips and does not refill the road, for reasons 1 and 2.

What would do it, in the order I would try them:
- **Demand listens to the drive (reason 3).** A demand part for travel time: a county whose roads are slow draws fewer households and shops, and one whose roads have just been relieved draws more, so it grows into the new lane over the following months and the cars come with the people. This is the design's own mechanism and it makes the widening a real choice. It changes how every town grows, so it is the owner's to approve: measure on the scripted-player town first.
- **Then turn `whereTo` on**, so the growth lands along the faster road.
- **A test town with room to grow.** The reference town is full; onemorelane needs a second scenario with zoned empty land.
- Not proposed: extra cars written in per widened road. It would make the chart look right and would be the scripted version the design rules out.

## Findings still to act on

1. People hold cars at crossings and trigger signal phases, and exist only when the camera is within 900 m. This is F0.4. The plan: town-wide seeded walkers in `peds` that do not depend on the camera; camera-local cosmetic extras in a separate list on the `fx` stream; a renderer handle of -1 for a walker not drawn; handles assigned at draw time. Then extend `qualitytest` to fingerprint the whole sim on Low and Ultra.
2. The interchange tool (`net.together()`) and communes clearing trees do not raise `roadBuilt` / `treesCleared`.
3. The sky module rolls nothing of its own any more but still owns the look of a spell; it is handed each spell through `weather.force`. It should read `game.climate` (requested).
4. Traffic, from the tests on the regrown town: cars pass through each other for an instant where a truck pulls out of a lot and where two turning curves cross in a junction; 2 to 5 heading snaps in 120 s; a car can wait in its driveway up to 333 s for a gap on a residential street at rush hour; one car stopped past its stop line on a crosswalk while yielding to a walker and sat there through the red (seed 2); actuated lights help less than the test expects, and leading greens can cost a junction cars.
5. The gridlock breaker (`REROUTE_T`) only frees a front car held by a full block. A front car held by anything else (it was a drive-thru that did not exist) locks the street for good with no alert. A watchdog for "a car on the road that has not moved in N minutes" would catch the next cause, whatever it is.

## Next

The order below follows the owner's "fun first" roadmap of 17 Nov: what a player sees and touches comes before the rest of the foundation. Each item names the brief's code for it.

1. Push `aaa/integration` at the merge of `03ecb16` once its suite is read, then merge `origin/aaa/integration` into `claude/aaa-play`.
2. Done: the re-pointed lightstest, parkingtest and landmarktest are in (be5dbff, ef3b669, 03ecb16).
3. **The phone screen (U1, U4):** first pass done (1edb035). What is left is listed under "The phone screen" above, and is the interface session's now, as are items 4 and 6 and the player's side of 5, 7, 8 and 9.
4. **Wire what the look lane has built (U5):** done (bf298e1, 13032ad, ea27287, 087e9cf, and d1f1e09 for the inspector rows, tool badge and top bar). Left over: the speed buttons and policies; Follow on buses; the controls with no drawn icon yet (`REQUESTS_FABLE.md`).
5. **One More Lane as a loop (F1):** the first slice is in (2c54bcc): the stamp, the taped button, the record, the chart, the headline. **What it shows is that the traffic does not come back**: on the reference town (not growing) the widened piece got 35 to 45% full at its busiest before and at most 31% in the 78 weeks after, on three seeds. Trips pick where to go at random (`spawnTrip` in `src/agents/traffic.ts`: `pick(jobs)`, `pick(shops)`), and the only thing that answers to speed is one county-wide factor (`induced = 0.6 + 0.6 * flowEma`). That was tried (4ea05b4, switched off) and is not enough on its own: see "What induced demand needs". The next slice is a demand part for travel time, measured on a town with room to grow, for the owner to approve.
6. **Honest Mode (F8):** a table of euphemism and plain word, a toggle that flips the whole UI, unlocked by Earl; the value-per-acre view.
7. **The Growth Ponzi made visible (F2):** real road condition, the unfunded-liabilities curve in the budget, Cousin Dale's Paving LLC, tax abatements.
8. **The Plat-o-Matic and Old Main** (`GAME_DESIGN.md` 5.2 and 7): a subdivision stamped from one drag; a courthouse square to start beside.
9. **The Waffle Hut Index and floods the player caused (F4).** Then endings (F3), American roads (F5), parking (F6), citizens (F7), the headless sim (F9).
10. Foundation still owed, fitted in between: F0.4 (people do not depend on the camera or the preset), the rest of F0.3 (three maps, the scripted-player town, Low and Ultra), F0.5 (slots UI, confirm before New city, the unreadable-save message, golden saves), F0.7 (hot spots on the 10,000-person town).
11. Phase 3 (writing), Phase 4 (proof).
