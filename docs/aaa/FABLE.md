# SLOPMERICA: the AAA push. Brief for FABLE (Claude Code)

You are FABLE, working in Claude Code. Your job is to make SLOPMERICA **play and read** like a AAA city builder:
- a simulation that is deep, deterministic and fast;
- satire that lives in real mechanics;
- traffic that behaves like American roads;
- a UI that teaches, informs and delights;
- writing that stays sharp for hours.

You also own the **foundation** both agents stand on: the test harness, determinism, saves and the integration branch.

A second agent, **ASTRA** (the Codex lead, which delegates to Sol and Luna), works in parallel on **how the world looks and sounds**: rendering, buildings, roads as meshes, vegetation, water, the camera, VFX, the car and people models, and all audio. Its brief is `docs/aaa/ASTRA.md`. Read its lane table before you touch a file. If you run alone, see "Running alone" at the end.

This is a long run, and the owner wants tokens spent on quality. You are authorized to use subagents freely: Explore for wide reads, general-purpose for parallel investigation, a reviewer for an independent read of a risky diff, a verifier for adversarial checks. You may also run workflows to fan out work: multi-seed measurement batches, review passes across dimensions, parallel bot playtests on three maps. Keep any single workflow to about ten agents unless a task clearly needs more. Delegate the breadth and keep the judgement: design decisions, the commit, and what you tell the owner stay with you.

Don't stop at the end of a phase to ask permission. Stop only for the owner decisions listed below, and even then park that item and take the next.

---

## 1. The game in two paragraphs

SLOPMERICA (*Land of the Free Parking*) is a satirical 3D city builder in the browser: TypeScript, three.js r186, Vite, no UI framework, about 58k lines in `src/`.

It is Cities: Skylines, except the goal is to do everything urban planners warn against: stroads, 120-pump gas stations, cul-de-sacs over the wetland, parking lots that sit empty 364 days a year, and ONE MORE LANE. The game includes:
- **Three maps:** Holler County (Appalachia), Golden Coast (NorCal) and Gator Gulch (Florida).
- **Four modes:** Growth Ponzi, Unlimited Slop (sandbox), Hippie Hell and Speedrun to Delhi.
- **Growth:** ten milestone tiers from 0 to 10,000 people with state grants.
- **City systems:** utilities over the road network, services by drive time, freight between factories and shops, buses, districts and policies, terraforming, disasters, and hippie communes as opposition.
- **The rest:** an X-style feed, a bug reporter and save/continue.

The in-world mega-brand is **SLOP**, the owner's real merch line (Imagine Supply Co.).

The design pillars (`docs/GAME_DESIGN.md` §2):
1. **Paradise first.**
2. **The satire lives in the systems.** The punchlines are mechanics:
   - induced demand really works;
   - the growth Ponzi really bankrupts you;
   - parking minimums really make oceans of asphalt;
   - floodplain subdivisions really flood.
3. **The game is a true believer.** The UI, advisors and achievements celebrate everything with Chamber-of-Commerce enthusiasm. The game never winks; the player does.
4. **Specific beats generic.**
5. **It has to be fun to build.** Buttery, instant feedback, number goes up.

`docs/GAME_DESIGN.md` is the vision; the code is the truth. Where they disagree, the gap is a decision to make, not a bug to assume. Read in this order:
1. GAME_DESIGN (all of it);
2. `docs/PLAYTEST_6.md`;
3. `docs/AUDIT_ROUND8_SIM.md`;
4. `docs/AUDIT_ROUND8_UI.md`;
5. `docs/HANDOFF_TRAFFIC.md`;
6. `docs/LEARNABILITY.md`;
7. `docs/POLISH_AUDIT.md`;
8. `docs/CONTENT_REVIEW.md`;
9. `docs/WORKSTREAMS.md`;
10. the README test list;
11. the last 20 commit messages on `claude/round8-sim`, each of which carries its numbers.

**The owner plays on a phone.** Every UI change works at 390 px with a finger first.

---

## 2. Where things stand (surveyed 2026-11-17 on `claude/round8-sim` @ 0418fcc)

Every line here was checked in code unless marked *(doc)*.

### Build and harness
- **Build:** install, typecheck (TypeScript 7, 0 errors) and both builds pass. The main JS is 2,255 kB (713 kB gzip).
  - `build:single` is **not one file**: the `gamePacks` plugin writes `civic/pack.b64.txt` and `vault/pack.b64.txt` beside it (`vite.config.ts:14-33`), and README line 13 says otherwise.
  - `npm audit` shows 2 highs (vite 8.3.x dev-server advisories, source-map-js).
  - `window.__game` and `__dbg` are installed unconditionally in production (`src/main.ts:47-48`).
- **The test suite is broken on this Windows PC in four ways:**
  1. **It silently passes with zero tests.** With `core.autocrlf=true`, README.md is checked out with CRLF and the registry regex (`scripts/suite.mjs:49-52`) never matches. It printed "0 of 0 pass" and **exited 0**.
  2. **Linux browser paths.** 102 scripts hard-code `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, and 84 of them have no override. That includes `scripts/refblock.mjs:9`, which 34 tests import.
  3. **POSIX process handling.** The suite spawns `scripts/withslot.sh` (needs `flock`, and `spawn EFTYPE` on Windows), and its timeouts use `process.kill(-pid)`.
  4. **Smaller breaks.** `shadercheck.mjs:7` uses `URL.pathname`, which gives `C:\C:\...`. `snapshot.mjs` and `worktree.sh` use symlinks.
- **What passes once those are patched:** the game logic is healthy. Patched copies passed `savetest`, `tooltest`, `glcheck`, `nantest`, `weathertest`, `qualitytest`, `playtestcheck`, `savecontinuity`, `starttest`, `collegetest`, `copytest`, `demandwords`, `ipcheck`, `vehicletest`, `junctionmesh` and both asset validators.
- **The suite's coverage:**
  - 131 README lines are the test registry; 34 are skipped by name, which leaves 97 tests.
  - **48 scripts on disk are not registered.** Several are real pass/fail tests: `blankwalls`, `groundnoise`, `roadjunction`, `roadsection`, `roadwear`, `shoretest`, `silhouette`, `treevariety`, `onewaytest`, `pollutiontest`, `freighttest`.
  - README.md is the conflict hotspot: it was touched in 69 of the last 120 commits.
  - The reference town is grown into gitignored `shots/lookbook/town.json` on first run, so it isn't versioned.
  - Default seeds are random.
  - There are no unit tests; every check is a whole-page Playwright script or a Node rig.
- **This PC:** Windows 11, 32 cores, an **RTX 5090**, Node 24.22, Git Bash and PowerShell. Every perf number in the docs came from a 4-core SwiftShader Linux container; treat them as stale.

### Simulation
- **Tick.**
  - `sim.update(dt)` takes the **real frame time** (`game.ts:1069`, capped at 0.1 s). One day is 2.5 s × speed (`sim.ts:15`), with speeds [0, 1, 2, 4].
  - `dailyTick` runs on whole-day crossings. Extensions hang off `'day'` and `'week'` events (`game.ts:360-365`) through the `EXT` registry (`src/ext/registry.ts`).
  - Traffic is a microsim in up to 8 substeps of about 0.08 s **sized by the frame** (`traffic.ts:1206-1212`).
  - The clock hour runs on another scale: 360 s per clock day at 1× (`game.ts:1058`). A rush hour spans about 20 calendar days.
- **Determinism: there is none.**
  - The frame-sized `dt` drives traffic. Freight deliveries depend on truck arrivals, and coverage depends on `seg.vc`, so the economy inherits frame timing.
  - **150 `Math.random()` calls** remain: traffic 36, pedestrians 32, game.ts 13, services 10, weather 10 and more. 53 of them are in sim scope, including fires, sickness move-outs, crime and commune bribes and lawsuits (`services.ts:1011-1070`, `game.ts:769, 797`).
  - The audit's "same seed, one of two outcomes, seemingly by load" is this.
- **Saves lose state.**
  - **The Buildings RNG `new Rng(4242)` (`sim/buildings.ts:162`) is never saved**, and `restore()` draws from it (`:549`).
  - Services' critical-day counters `bs.bad`, fires (`burning`) and landfill `rate` aren't saved (`services.ts:2362-2371`), so a reload resets abandonment countdowns and puts out fires.
  - System state is keyed by **rounded building positions** (`services.ts:2380-2388`, `freight.ts:255-262`).
  - `v: 1` is a literal with **no migration path** (`save.ts:8`), and there is **one save slot**.
- **Graphics presets change the sim.** The pedestrian *sim* cap is the preset's `maxPeople`: 120 on Low, 580 on Ultra (`config.ts:48-60`, `game.ts:319`, `pedestrians.ts:262`). Cars yield to walkers (`game.ts:322-323`), so Low and Ultra run different traffic, freight and economy above about 1,700 people. `qualitytest` doesn't check pedestrians. This breaks an owner rule.
- **Demand** (`sim.ts:500-559`):
  - Hand-built RCIO formulas.
  - The explainer regex-parses hook text (`sim.ts:120-125, 542-553`), so a hook that formats numbers differently silently breaks the "parts add up" check (`demandtest`).
- **Growth:**
  - Households arrive at (2.5 + 0.012 × pop) × the residential factor per day.
  - At most **3 new sites a day** (`sim.ts:576`).
  - Workers = 0.55 × pop, and **every job building gets the same fill ratio** (`sim.ts:492-497`). Nobody has a job, a home-to-work link or a commute.
  - The inspector misstates the growth rate: `lotStatus` (`game.ts:859`) disagrees with the sim (`sim.ts:576`).
- **Economy:**
  - Tax is per occupant × level × rate; land value doesn't enter tax.
  - Impact fees are paid on level-1 completion.
  - Road upkeep is 0.35× in year 1, full at year 4, up to 2.5×. **Widening resets the road's age** (`roads/network.ts:642`, `:717-726`).
  - One loan type. Bankruptcy is 6 weekly closes below −$15k, which brings a card and then a $50k "federal bailout" labelled "(sandbox)" while the mode stays Ponzi (`hud.ts:1726`).
  - Ledger reconciliation is solid (`sim.ts:318-358, 775-803`).
- **Services** (`sim/services.ts`, 2,408 lines, module-global `S`). This is the deepest system:
  - Utilities pooled per connected road component.
  - Coverage by multi-source Dijkstra over the road graph, with congestion-scaled edges.
  - Garbage with landfills, abandonment and demolition with warnings.
  - UI panels, icons and particles are mixed into the same file.
  - **Service vehicles are decorative:** a fire goes out on a dice roll on coverage (`:1049`), whatever the dispatched truck does. Garbage trucks are dispatched at random half the time (`:919`).
- **Freight** (`freight.ts`): conserved stock moved by real trucks, with a county-line trickle as a stopgap. `scheduleDeliveries` is O(shops × factories × shipments).
- **Transit** (`transit/system.ts`): aggregate daily ridership plus a logit mode choice whose car side uses a **fixed 12 m/s**, not real congestion (`:549-576`). It changes no demand or land value.
- **Districts and policies:** 14 policies, mostly flat demand deltas (`policies.ts:72-89`). They don't match the design doc: no Parking Minimums, Single-Family Only, setbacks, Right Turn on Red or abatements. The crypto rug-pull is cosmetic, because `dailyTick` overwrites office occupancy (`districts.ts:361-364` vs `sim.ts:497`).
- **Disasters** (`disasters.ts`, 207 lines): 4 random scripted events (hurricane, landslide, wildfire, Florida Man). None comes from player choices.
- **Not in the code at all:**
  - Honest Mode, Clout and public hearings, achievements;
  - parking minimums, flooding, the lumber payout, bonds and abatements;
  - the collapse sequence, a reachable "Paradise Paved", Then & Now.
  - The sprawl win needs 90% county coverage and 98% maxed (`sim.ts:712`), which is effectively unreachable.
- **The sim can't run headless.** Seven sim files import three, `Buildings` owns BatchedMeshes, services owns icons and particles, and `window` is touched in `buildings.ts:300`.
- **Hot spots (scaling):**
  - **Every frame:**
    - `zones.update()` rebuilds the overlay over all cells and up to 8,000 planting strips whenever any building changes, which is nearly every frame in a growing town (`zoning.ts:497-583`);
    - `buildings.counts()` twice;
    - `tickConstruction` over all buildings.
  - **Every day or every few days:**
    - land value calls `near(140)` plus `near(300)` per zoned building every 3 days (`sim.ts:611, 626`);
    - `zones.candidates()` scans every cell up to 12× a day;
    - the districts hook scans all buildings once per policy (14×), and again in every forecast;
    - `forecastWeek` runs about 8× a game day plus after every transaction.

### Traffic and people
- **Cars are real agents.** They have A* routes with BPR-style costs (`traffic.ts:830-923`), lane buckets, IDM car-following (`:1544-1549`), cubic junction curves, actuated signals with a leading green for lefts, don't-block-the-box, and a 20 s gridlock reroute (`REROUTE_T`).
- **Hard cap: 1,000 simulated cars** (`SIM_MAX_CARS`, `:21`). Trip demand hits it at about 8k people, so congestion stops scaling with the city.
- **Demand is aggregate.** `targetCars` comes from population and jobs, and random origin-destination pairs come by purpose (`:1001-1097`, `:1247-1258`). Drivers are a random archetype (`:1157`), so every Florida Man driver is "Florida Man".
- **One step at 1,000 cars costs 4.3 to 4.8 ms** *(doc)*, against a 4 ms target.
- **Car tests are still unstable** *(doc)*: `carsolid` fails on 3 seeds (a lane change at 19 to 20 m/s, a semi trailer swinging over the oncoming lane) and `landmarktest` passes about half the time.
- **Roads that don't behave like American roads:**
  - **Unsignalled nodes have no stop signs and no priority by class.** Ramps and roundabouts yield like a 4-way.
  - **The stroad's painted center turn lane is never driven.** `centerTurn` only multiplies crash risk (`:1562`).
  - Per-vehicle `maxSpeed` is never read, and the IDM parameters are the same for a semi and a motorcycle.
  - **Emergency vehicles stop at reds,** and nobody pulls over.
  - Wrecks evaporate after 16 to 28 s: no tow, no ambulance, no rubbernecking.
  - A `seg.blocked` road holds cars short of mid-segment for a whole 1,200 s disaster, because the reroute only fires on `boxWait`.
- **Parking is drawn only** (`parking.ts`). A full lot makes the car vanish (`:91`), and parking has no simulation weight. Drive-thrus are real queues that spill onto the road (`traffic.ts:1434-1442`); that is the model to copy.
- **Buses vanish at every stop** (`transit/system.ts:601-620`), and waiting riders never board.
- **Pedestrians** are decorative and camera-local: they appear within 520 m and walk a random direction for 40 to 100 s (`pedestrians.ts:290-320, 657-685`). The crosswalk interaction is real and good. The archetype schedule flags `nightOwl` and `civicRegular` are read nowhere.
- **Bug:** protesters spawn on any blocked segment, so every 8 s crash block summons a hippie protest in the road (`pedestrians.ts:597-611`; its guard `!seg.name.startsWith('')` is always false).
- **`pedestrianHit` has five feed lines but is never pushed.** The `Hold` reason on each car (`traffic.ts:29`) already says exactly why it is stopped ("drive-thru", "left: oncoming", "no room past the box"), and nothing uses it.

### UI, onboarding, writing
- **Flow.**
  - The title (`ui/title.ts`) is strong.
  - The opening is a 120-word modal from Chad (`hud.ts:254-275`), then a 5-step text card (`:808-830`), then a demand-driven "Next" line (`:740-802`). The Next logic is good.
  - **Utilities are never taught,** yet the first emergency is "buildings without power, water and sewage" at population 17. Step 5/5 "Check the money" stays on screen until the player opens Budget.
- **No charts anywhere.** `sim.history`, `demandHistory`, `popFlow` and the ledger have the data. Only service views have a legend (`services.ts:1838`).
- **Toasts last 2.6 s** (`hud.ts:1641-1658`), but refusals and budget warnings run 25 to 45 words.
- **Dev furniture in plain sight:** lowercase debug weather chips (`hud.ts:1279`), a Playtest badge and build hash on the title, the 🐞 button in the desktop toolbar's primary slots, "Show performance", "Reload to finish applying", and raw "·ON / inherits OFF" in district cards.
- **Emoji are the whole icon set.** Text runs at 8 to 12 px in about 90 CSS rules. `style.css` is 3,439 lines with 17 media blocks overriding earlier rules, and layout is patched in JS (`layoutCards`, `placeNextBar`, `hud.ts:877-902, 1742-1786`).
- **Saves and menus:** **one save slot**, and New city overwrites it silently within 30 s. There is **no pause/Esc menu and no quit to title**.
- **Inspector Bulldoze fires immediately with no confirm,** and undo doesn't cover grown buildings (`hud.ts:1618-1622`, `game.ts:103-105`).
- **Device detection:** `COMPACT` is computed once from the user agent (`hud.ts:67`, `config.ts:13-15`). An iPad with a keyboard gets the phone toolbar, and the toolbar never rebuilds on resize.
- **Accessibility:** none. No text scale, colour-blind palettes, remapping or focus order. Reduced motion is CSS only. Edge scroll defaults on. `index.html` sets `user-scalable=no`.
- **Learnability:** none of the 54 refusals LEARNABILITY.md flagged as lacking a next step are fixed. Audit items O1 (a garbled help line, `hud.ts:1354`), O2 (a broken save vanishes silently) and O4 are open. Nobody unfamiliar has ever played it; all playtests were bots or the owner.
- **Feed:**
  - 299 lines.
  - **Thin event pools:** `driveThruLine` 1 (a placeholder "for the owner to reword", `feed.ts:126-129`), and `landfillFull` 2.
  - **No lines at all** for transit, districts, disasters, goods, landmark events or milestones.
  - **Repetition:** "The left wants X…" appears 5 times and @grok 6.
  - **Bugs:** the joke wrappers ("BREAKING: ", "Reply guys hate this: ") are added even to the sober `pedestrianHit` and `drunkCrash` kinds (`feed.ts:23, 625-627`). Posts don't point at places, every timestamp says "now", and the HUD's "Commissioner" meets the feed's "mayor".

---

## 3. What "AAA" means here: the bar you're held to

These are your lane's targets, each shown with a number, a test or a recorded session.

1. **Deterministic.** The same seed and the same inputs give the same city:
   - across frame rates (30, 60, 144 and a stepped run);
   - across graphics presets;
   - across a save/reload at any point.

   Proven by a script that runs a 2-year Ponzi town each of those ways and compares a full-state fingerprint.
2. **Saves never lose anything.** Every piece of sim state round-trips. Old v1 saves load through a migration. A golden-save test loads three committed saves from different maps and eras, steps 30 days and matches stored fingerprints. There are named slots, and nothing is ever overwritten without asking.
3. **The satire is mechanics** (GAME_DESIGN pillar 2), each with a scripted demonstration:
   - **Induced demand:** widen a corridor and travel time drops, then the same corridor's volume returns within about 18 game-months, shown on a before/after chart in the game.
   - **The Growth Ponzi:** the maintenance cliff lands, the liability per acre is visible, and only new growth pays it.
   - **Parking minimums:** they pave land you can measure.
   - **Floodplain:** subdivisions there flood more as you pave the watershed.
   - **Honest Mode:** relabels the game.
4. **The first session teaches itself.** An unfamiliar player reaches 350 people in 30 to 45 minutes and understands roads, zoning, utilities and the weekly budget without leaving the game. Measured by a scripted "naive player" bot that only follows on-screen guidance, plus the owner's own fresh-eyes session checklist.
5. **Information like Skylines 2.** A statistics panel with charts, a legend and hover values on every info view, and budget history and forecasts as charts. Any number the game shows can be clicked to see why.
6. **Feedback everywhere.** Every action the player takes has an immediate visual and audio response, from your events plus ASTRA's art and sound. No refusal without a next step. Nothing important on screen for less time than it takes to read (about 250 ms per word, with a floor of 3 s).
7. **No dev furniture in the shipped build.** Playtest tools live behind a `#playtest` flag the owner can turn on.
8. **Sim scale.** Traffic volume keeps scaling past 8k people (via the meso layer). `traffic.update` at 1,000 agents is under 4 ms, and no daily tick in a 10k town spikes a frame over 8 ms on this PC.
9. **The UI holds at 390 px** with a finger, at 1280×720 with a mouse, and at 200% text scale.
10. **All existing tests pass,** or each failure is explained and shown to fail on the base too.

---

## 4. The two-agent setup

### Lanes (file ownership)

| | **FABLE (you): the game you play and read** | **ASTRA: the world you see and hear** |
|---|---|---|
| Owns | `src/sim/*` (except the **rendering block** of `sim/buildings.ts`, the BatchedMesh setup, construction visuals and LOD/cull, which ASTRA edits in commits titled `Render:`, and `sim/serviceIcons.ts`), `src/zones/*`, `src/transit/*`, `src/tools/*`, `src/ui/*`, `src/style.css`, `index.html`, `src/content/*`, `src/ext/*`, `src/core/*`, `src/agents/traffic.ts`, `parking.ts`, `pedestrians.ts`, `communes.ts`, `src/roads/network.ts`, `roadJunction.ts`, `roadTypes.ts`, `src/world/maps.ts`, `src/dev/debug.ts`, the test harness (`scripts/suite.mjs`, `scripts/lib/*`, `refblock.mjs`, snapshot and lock tooling, the test registry) and the sim/UI test scripts | `src/render/*` (including `camera.ts`), `src/world/*` except `maps.ts` (shading, vegetation, water, sky, weather; heightfield *generation* is frozen for both of you), `src/buildings/*`, `src/art/*`, `src/vault/*`, `src/civic/*`, `src/agents/vehicles.ts`, `vehicleFx.ts`, `people.ts`, `models/*`, `ambient.ts`, `communeBuilder.ts`, `src/audio/*`, `src/roads/roadMesh.ts`, `roadSection.ts` (you may read its paint constants), `streetDetails.ts`, `sim/serviceIcons.ts`, the asset library and vault apps, `dev/*.html` and `src/dev/*` except `debug.ts`, and the look/perf/audio scripts under `scripts/look/*` |
| Shared (small, separate commits; merge `aaa/integration` first) | `src/game.ts`, `src/config.ts`, `src/main.ts`, `src/contracts.ts`, `vite.config.ts`, `package.json`, `README.md` | same |

- **If a fix belongs in ASTRA's files, don't make it.** Write it in `docs/aaa/REQUESTS_FABLE.md` (file, cause, proposed fix, what it blocks), and read `docs/aaa/REQUESTS_ASTRA.md` at every merge.
- **The UI seam.** The HUD is yours. ASTRA makes:
  - the drawn icon set that replaces emoji (its W14);
  - heatmap and overlay rendering;
  - need-bubble rendering and clustering;
  - every sound.

  You wire them in, and you give them the data and events below.

### Contracts (`src/contracts.ts`): you are the main producer

Add these early (Phase 0 or the start of Phase 1) as typed interfaces with a stub implementation, so ASTRA can build against them on day one:

- **`SimEvents` (you emit, ASTRA consumes):**
  - `construction(bldId, progress 0..1)`, `demolished(bldId, pos, size)`, `levelUp(bldId)`;
  - `disaster(kind, phase, pos, radius, intensity)`, `flood(cells)`, `fireFront(points)`;
  - `crash(pos, severity)`, `moneyTick(delta, kind)`, `milestone(tier)`;
  - `zonePainted(cells, zone)`, `roadBuilt(segIds)`, `laneAdded(segId)`;
  - `treesCleared(cells)`;
  - `collapseStage(stage)`, `paradisePaved()`.

  Use the existing `Sim.events` bus (`src/core/events.ts`).
- **Fields (you expose):**
  - `fieldFor(view) → { w, h, cellM, data, min, max, legend }` for every info view. Raise resolution where cheap; today's coverage texture is 192² over 6 km, 32 m per texel (`services.ts:1714`).
  - `roadCondition(segId) → 0..1` (ASTRA turns it into cracks and potholes);
  - `buildingAge` and `buildingCondition`;
  - pollution and smog;
  - `naturePct` (ASTRA's soundscape health bar reads it).
- **`ViewTarget`**: a car id, a citizen id or a building id, for ASTRA's follow-cam. Your inspector gets the "Follow" button.

### Branches, worktrees, ports, integration

- **You own `aaa/integration`.** Create it from `aaa/briefs` (which is `claude/round8-sim` plus these briefs) and push it:
  ```bash
  git -C C:/Users/burnz/Slopmerica fetch origin
  git -C C:/Users/burnz/Slopmerica branch aaa/integration aaa/briefs
  git -C C:/Users/burnz/Slopmerica push -u origin aaa/integration
  ```
  If `origin/aaa/briefs` doesn't exist yet, the local `aaa/briefs` branch is the source; push it too.
- **Your branch is `claude/aaa-play`, in your own worktree:**
  ```bash
  git -C C:/Users/burnz/Slopmerica worktree add C:/Users/burnz/Slopmerica-fable -b claude/aaa-play aaa/integration
  ```
  In it, run `git config core.autocrlf false` and re-checkout. The repo's blobs are LF, and Windows autocrlf is what made the suite find zero tests. Then `npm ci`.
- **Ports 5180 to 5189 are yours.** ASTRA uses 5190 to 5199. Run up to **4 headless browsers at once**; ASTRA has its own 4.
- **Harness changes reach `aaa/integration` within your first hour.** ASTRA is waiting on them: `.gitattributes`, `scripts/lib/browser.mjs`, the suite's CRLF and zero-test fix, the Node lock and the `shadercheck` path fix.
- **Integration cadence.** At each milestone, or at least every 3 to 4 hours:
  1. Merge `origin/codex/aaa-world` (ASTRA's branch) and your branch into `aaa/integration`.
  2. Run the gates (section 6, F0.2) on a frozen snapshot of the merge.
  3. Push only if they pass, or if every failure also fails on the parent commit (say so in the merge message).
  4. Resolve conflicts without undoing anyone's work. If a conflict is in ASTRA's files, take ASTRA's side and file a request if that breaks you.
- **Never force-push. Never push to `codex/*` or `main`.** Don't open pull requests unless asked. Fast-forwarding `main` to `aaa/integration` is an owner decision; recommend it at the end.
- **Logs.** Keep `docs/aaa/LOG_FABLE.md` as you go: what you did, numbers, commits, what's next. Write it so a fresh session can take over from it alone.

---

## 5. The owner's rules (unchanged from earlier rounds; they override this brief)

- **No new npm dependencies.** Patch-level bumps of existing ones to clear `npm audit` are fine; list them.
- **Offline game.** Nothing in `src/` calls a network API. No key or token goes into `src/`, the bundle, a `VITE_` variable, a log, a commit or a report. Never open or print `.env.local`.
- **Jev (TypeSafe) only in Node scripts** at dev or build time, never in the game, never for jokes, posts, names, dialogue, balance or anything per frame. Every Jev script needs a `--dry-run` that needs no key. Report requests, tokens and dollars for each run, and keep a full pass under $1.
- **Content and balance are the owner's call.**
  - Don't rename brands or rewrite existing jokes.
  - Measure and propose numbers. Change an existing balance constant only when it is outright broken or the owner says yes.
  - New systems from GAME_DESIGN are in scope. Put every new number in `src/sim/tuning.ts`, marked `PROPOSED` with a one-line reason, and list them in `docs/aaa/DECISIONS_FABLE.md` with bot-run evidence.
  - **New writing** (feed lines for event kinds that have none, tutorial lines, advisor barks, Honest Mode labels, achievement names) is allowed in data files, in the house voice. List every new line in `DECISIONS_FABLE.md` for review, and run `node scripts/contentaudit.mjs` (needs the owner's key; otherwise `--dry-run` plus a list) and `node scripts/ipcheck.mjs`.
- **Content rules** (`docs/WORKSTREAMS.md`, the newest statement of them, which wins over older GAME_DESIGN tone notes):
  - Raunchy-ish is fine; nothing sexually explicit.
  - Mock ideologies, online behaviour, corporations and both political tribes. No slurs, and no jokes aimed at race, religion-as-identity, disability or sexuality.
  - Public figures only as obvious parody names, kept in data.
  - No real logos.
  - The SLOP / Imagine Supply Co. brand is the owner's own and is used straight.
  - Punch at systems, not people (King of the Hill rules). The game is a true believer.
- **Graphics presets must not change the simulation** (`scripts/qualitytest.mjs`). Fixing the pedestrian cap (F0.4) is yours.
- **Terrain generation is frozen** for both agents. The world regenerates from its seed, and saves keep only edits (`save.ts:2`).
- **Every fix gets a check that fails before and passes after.** One fix per commit, with the before and after numbers and seeds in the message. House style for subjects is `Area: plain-English outcome` (see `git log`).
- **No model or agent names in code, docs you write, or commit subjects and bodies.** These brief and log files are the exception.
- **The debug hooks are a public API** that 100+ tests use: `window.__game`, `__dbg` (`road`, `zone`, `run(days)`, `view`, `hour`, `save`, `unlockAll`, `showcase`), `__services`, `__land`, `__vault`, `__startSite`. Add, don't rename. Gating them in production (F0.6) must keep every test working.

---

## 6. The work

Order matters: Phase 0 makes everything after it trustworthy. Within a phase, go roughly in order, but if something is blocked, park it in the log and take the next item. "Done when" is the bar for each item.

### Phase 0: foundation (first 6 to 10 hours; push harness pieces in the first hour)

**F0.1 The harness runs on Windows, and fails loudly.**
- Add `.gitattributes` with `* text=auto eol=lf` and `*.sh eol=lf`, then `git add --renormalize .`. Expect it to touch little, since the blobs are already LF.
- `suite.mjs`: strip `\r` when reading the registry, and **exit 1 when it finds 0 tests**.
- `scripts/lib/browser.mjs`:
  - exports `EXE` (env `CHROME`, then a per-platform default: Playwright's Chromium if installed, else `C:/Program Files/Google/Chrome/Application/chrome.exe` on win32, else today's Linux path);
  - exports `ARGS` (SwiftShader by default, `GPU=1` for hardware ANGLE D3D11);
  - exports `launch(opts)`.
- Codemod the 102 scripts to use it, in one mechanical commit with a script that proves it (grep for `/opt/pw-browsers` returns only `lib/browser.mjs`).
- Replace `withslot.sh` with a Node lock (`fs.open(path, 'wx')` lock files with stale-PID cleanup) under `scripts/lib/slots.mjs`, with `SLOTS` defaulting to 4.
- Replace `process.kill(-pid)` timeouts with a cross-platform tree kill (`taskkill /T /F /PID` on win32).
- Fix `shadercheck` with `fileURLToPath`. Make `snapshot.mjs` and `worktree.sh` work without symlinks (copy or junction on win32).
- **Commit the reference-block town as a fixture** at `scripts/fixtures/refblock-town.json`, and make `refblock.mjs` use it, so `junctionmouth` and `junctionmesh` stop needing a browser to have run first.
- Default `SEED` to a fixed value in every traffic test; `FUZZ=1` picks random seeds and prints them.
- **Move the test registry out of README** into `scripts/tests/fable.json`, `scripts/tests/astra.json` and `scripts/tests/shared.json`. Each entry holds name, command, tier (`gate` / `smoke` / `full` / `measure`), timeout, `needsBrowser`, `needsKey` and env. Keep README as prose that points there. This ends the README conflict hotspot.
- **Triage the 48 unregistered scripts:** register the real tests, mark measurements, delete nothing without saying why.
- Done when `node scripts/suite.mjs --tier smoke` runs green on this PC from a fresh worktree, and a deliberately broken test makes it exit 1.

**F0.2 Gates.**
- `npm run gate` (under 2 minutes), run before every commit:
  - typecheck;
  - build, failing if main JS grows more than 5% over `scripts/budgets.json`;
  - the node-only checks: `copytest`, `demandwords`, `copyscan`, `ipcheck`, `vehicletest`, `shadercheck`, `junctionmesh`, `junctionmouth`, `assets:check`, the vault validator;
  - `suite --lint`.
- `npm run smoke` (about 5 minutes), run before every push:
  - `savetest`, `savecontinuity`, `loadfiletest`, `playtestcheck`;
  - `glcheck`, `nantest`, `qualitytest`, `tooltest`;
  - `uisweep phone` and `desk`, `overlaptest`, `starttest`, `firststeps`, `commandtest`, `demandtest`.
- The full suite runs at each integration merge and at the end.
- Turn on `noUnusedLocals` and `noUnusedParameters` (fix what fires; mechanical commits), and typecheck `scripts/` through a JSDoc-checked `tsconfig.scripts.json` if it stays cheap.
- Done when both npm scripts exist and pass, and are documented in AGENTS.md and CLAUDE.md.

**F0.3 Determinism.**
- **Fixed timestep** in `game.ts` (shared; its own commit): an accumulator steps the sim, traffic, parking and pedestrians at a fixed `1/20 s` (or whatever `traffic.update`'s current substep implies; measure first). Rendering interpolates car and person positions between steps; ask ASTRA for the `vehicles.ts`/`people.ts` side through `REQUESTS_FABLE.md` if needed.
- **Seeded RNG streams per system** from `core/rng.ts`: sim, buildings, services, freight, traffic, pedestrians, communes, disasters, transit. Each is saved and restored.
- Replace `Math.random` in all sim-scope code. Cosmetic-only randomness (particles, a ped's idle animation) may keep a separate unsaved stream, but nothing that changes state may use it.
- Save the Buildings RNG, plus services `bs.bad`, `burning` and landfill `rate`.
- Key system state by stable building ids, not rounded positions (with a migration).
- The pedestrian **sim** cap becomes independent of the preset (see F0.4).
- Make `__dbg.run(days)` step through exactly the same code path as live play.
- **The determinism test,** `scripts/determinism.mjs`: one seed and a scripted build order (reuse `scripts/lib/latePlayer.mjs`), run for 2 game-years four ways (stepped, at 30 fps, at 144 fps, and with a save/reload every 90 days). The full-state fingerprint (buildings, treasury, ledger, RNG states, every system's save blob, car count) must match exactly across all four.
- Done when that test passes on all three maps, and `carsolid`, `crosswalktest` and `landmarktest` give identical numbers for the same `SEED` twice.

**F0.4 Graphics presets never change the sim.**
- Pedestrian simulation runs at a fixed sim budget on every preset; the preset only caps how many are *drawn* (ASTRA's side).
- Extend `qualitytest` to fingerprint the whole sim, pedestrians and car yields included, after 60 game-days on Low and on Ultra.
- Done when it passes, and fails on the old code.

**F0.5 Saves you can trust.**
- Versioned save with a migration table: `v1 → v2` functions, applied in order.
- Named slots: at least 5, plus autosave and checkpoint.
- Confirm before New city overwrites anything.
- The O2 message when a save can't be read ("Your last city couldn't be loaded; it's kept, here's what to do").
- **Golden-save test:** commit three saves (one per map, early, mid and late game) under `scripts/fixtures/saves/`. Load each, step 30 days, and compare against stored fingerprints. Regenerate fingerprints only in a dedicated commit that explains why.
- Done when `savetest`, `savecontinuity`, `loadfiletest`, `savefallback` and the golden-save test pass, and every one of today's v1 fixture saves loads.

**F0.6 Ship like a game.**
- Gate `__dbg` and the debug globals behind `import.meta.env.DEV` or a `#debug` / `#playtest` hash. Tests set the hash; check every script that uses them.
- Move the dev furniture (bug button, Playtest badge and build hash, Show performance, weather chips, "Reload to finish applying") behind `#playtest`. The bug reporter stays one tap away in Settings for everyone.
- Fix `build:single` so it really is one file (inline the packs as base64 when `--mode single`, or say plainly in README that it's a folder), and fix the README line.
- Clear `npm audit` with patch bumps.
- Done when a production build has no `__dbg` without the hash, the suite passes with it, and `ipcheck` and the key scan of the bundle are clean.

**F0.7 Simulation hot spots** (measure with `core/prof.ts` and a 10k-person Florida town; keep the save as a fixture).
- `zones.update()`: rebuild only dirty cells and beds, not all of them.
- Land value: an incremental spatial accumulator or a coarse grid, in place of per-building `near(300)`.
- `zones.candidates()`: maintain a candidate set, don't scan.
- Freight: index shipments by shop and factory.
- Districts: compute policy effects once per tick, not 14 scans per forecast.
- `forecastWeek`: dirty-flag it.
- `buildings.counts()`: cache it per frame.
- Done when no daily tick in that 10k town spikes a frame over 8 ms on this PC, the per-system numbers are in `docs/aaa/PERF_SIM.md`, and `soak`, `econtest` and `demandtest` hold.

**F0.8 AGENTS.md and CLAUDE.md** (identical content; Codex reads the first, Claude Code the second):
- the lane table;
- the gates;
- the debug-hook contract;
- the owner's rules;
- the commit style;
- the snapshot/port/slot conventions;
- where the briefs and logs are.

Keep each under about 200 lines and link to the docs for the rest.

### Phase 1: the satire becomes the systems (the heart of the run)

The order is player impact. Every item: new numbers in `tuning.ts` marked PROPOSED; bot runs on all three maps before and after (`playtest6-late.mjs` with `CHECK=1`, several seeds each, results in `PLAYTEST_6.md`'s style); saves migrate; events added to the contract so ASTRA can show and sound it; a demonstration script.

**F1. Traffic that scales, and induced demand that really happens** (`traffic.ts`, `sim.ts`, `transit/system.ts`).
- **Add the mesoscopic layer GAME_DESIGN §9.3 promised:**
  - zone-to-zone (or district-to-district) trip tables by purpose;
  - route choice by travel time;
  - a BPR volume/capacity curve per segment carrying the *full* city's volume.

  The 1,000 agents become the visible sample, drawn from the meso flows, and their `vc` blends with the meso `vc`. Congestion now keeps scaling past 8k people.
- **Congestion costs something:**
  - commute time per residential building feeds land value and residential demand;
  - shops' sales follow passing traffic (gas stations *love* traffic, and brand choice can follow volume; today it's random, `buildings.ts:287`);
  - transit's car-time side uses real `vc`, not 12 m/s.
- **Induced demand per corridor.** Widening drops travel time, more and longer trips take that corridor, and its volume climbs back. Show it in-game: the road inspector gets a before/after volume chart since the last ONE MORE LANE, and the feed posts "Route 9 widening complete; traffic back to normal within 18 months, experts stunned" when it actually happens on that road.
- Done when:
  - a scripted demonstration widens a congested corridor and shows travel time down, then volume back to at least 90% of before within about 18 game-months, on 3 seeds;
  - `trafficscale` at 1,000 agents is under 4 ms a step;
  - a 20k town still congests;
  - `carsolid`, `crosswalktest` and `landmarktest` are no worse on the same seeds.

**F2. The Growth Ponzi you can see** (`roads/network.ts:642, 717-726`, new `src/sim/liabilities.ts`, the ledger UI).
- **Road condition 0..1 that decays with age and traffic,** exposed to ASTRA for cracks and potholes, with a **repave** action.
- **The maintenance cliff at about 20 to 25 game-years** (GAME_DESIGN §5.4). The number is PROPOSED, so make the year length readable: say in DECISIONS how many real minutes a game-year is at ▶▶▶.
- **Make the reset visible in the UI.** Widening resetting age is great satire if the game says so ("New lanes! Maintenance clock reset. 80% federal."). Whether it stays is an owner decision; implement it as a tuning flag.
- **Federal grants** cover 80% of new road construction and none of the maintenance.
- **An "Unfunded Liabilities" counter,** with a ledger line projecting the next 10 years of bills.
- **Tax per acre vs liability per acre,** and a **value-per-acre view** (the Strong Towns joke, computed). Today tax is per occupant only (`sim.ts:296`).
- Bonds, tax abatements ("give Amazin' 20 years tax-free"), and **Cousin Dale's Paving LLC** (no-bid contracts: cheaper now, crumbling faster).
- Done when a bot town on each map hits the cliff and the ledger and chart show the bill landing, the value-per-acre view ranks the old downtown above the big box, and `ledgertest`, `moneyedge` and `econtest` pass.

**F3. Endings with weight** (`sim.ts:712`, a new `src/sim/endings.ts`, `hud.ts:1712-1730`).
- **"The Ponzi Ends."** Bankruptcy becomes a staged collapse (emit `collapseStage` for ASTRA):
  - roads crumble to gravel;
  - chains close;
  - storefronts turn into Halloween pop-ups, then nothing;
  - saplings return and the deer come back.

  The bailout comes with strings (austerity: services cut, no new roads for N weeks), and its "(sandbox)" mislabel goes.
- **"Paradise Paved," made reachable:** cut down the last tree (via `trees.naturePct`), with a final cinematic hook for ASTRA (a frankenpine cell tower with a plaque).
- **Capital of Slop at 10,000:** a real "you made it" moment, with a full-screen card and a **city report** (population curve, money, trees lost, lanes added, commute, the best feed posts) the player can save as an image.
- **Sandbox:** no ending.
- **Speedrun to Delhi:** a clock and a score.
- Done when each ending is reachable by a scripted run and has a test.

**F4. Nature fights back from what you built** (`pollution.ts` grid machinery, `disasters.ts`).
- An **impervious-surface and runoff field** derived from pavement and roofs, with flow from terrain.
- **Flash floods** in floodplain cells, scaling with rain × upstream pavement. Wetlands absorb until paved. "You take the federal money and rebuild in the same spot" is a button.
- **Heat islands** from tree loss plus asphalt (AC load on the grid).
- **Wildfire risk** in the wildland-urban interface.
- **The river's colour** tracks what you dump in it (a field ASTRA renders).
- **The Waffle Hut Index** (green, yellow, red) as the disaster-severity meter.
- Today's random events stay as rare background; the player-caused ones become the main source.
- Done when a scripted pair (the same town with and without a paved watershed) shows more flooding in the paved one on 3 seeds, and `disasters-test` and `disasterloop` pass.

**F5. American roads** (`traffic.ts:1494-1516, 1918-1937`, `roadTypes.ts:54-62`).
- **Stop signs and priority by road class** at unsignalled nodes, with rolling stops for reckless and Florida Man drivers. Ramps merge, not 4-way.
- **The center turn lane is used:** mid-block lefts into lots wait in it, with the crash multiplier attached to that act.
- Per-vehicle `maxSpeed` and IDM parameters: semis launch slowly; golf carts crawl at 9 m/s with a honking queue behind.
- **Trailer-aware turn paths,** which fixes the remaining `carsolid` overlaps.
- **Emergency vehicles** run reds and cars pull over. A **"Police Union Priority"** policy keeps the old behaviour as satire.
- **Wrecks get a tow truck and an ambulance,** plus rubbernecking slowdowns on the opposite side.
- **Fire outcome depends on when the dispatched truck actually arrives** (`services.ts:1041-1100`). The fire truck stuck in your 8-lane stroad while the McMansion burns is the joke.
- **Blocked roads:** cars reroute.
- **Bugs:**
  - protesters only at commune actions, never at crashes (`pedestrians.ts:597-611`);
  - wire `pedestrianHit` to a real event.
- Done when `motiontest`, `carsolid` (all 3 failing seeds now pass), `crosswalktest`, `gridlocktest`, `onewaytest` and `junctiontest` pass, and there is a new `emergencytest`.

**F6. Parking as a mechanic** (`parking.ts`, `buildings.ts:142` `LOT_SIZE`, policies).
- **The Parking Minimums policy** (Black Friday Standard) scales lot size. Asphalt eats land, density and land value.
- Cars circle and search when a lot is full, then try the next lot. They don't vanish.
- A full SprawlMart lot costs sales and starts feed rage.
- On-street parking on two-lanes.
- **Black Friday** (every November) and **Easter** (Pastor Rick) overflow onto grass and stroad shoulders.
- Done when a test shows the policy paving measurable extra land, lots full on Black Friday and 90% empty otherwise, and `parkingtest` passing.

**F7. Citizens with names, homes and jobs** (`sim.ts:492-497`, `traffic.ts:1157`, `pedestrians.ts`, `hud.ts:1549-1566`).
- **Aggregated household cohorts per building:** a seeded family name, education and income tier, and a workplace chosen by drive time. Keep it cheap with district-level origin-destination matrices.
- Jobs fill by matching, not uniformly. Unemployment and commute are per area.
- Car trips draw from those households: "going home" goes to *their* home.
- **The inspector:** "The Dwyers. 2.4 kids, 3 trucks, 1 boat (used twice). Commute: 74 min. Wants Route 9 widened. Also wants less traffic. Currently idling in a drive-thru (23 min)." Their **contradictory demands** are on purpose (GAME_DESIGN §5.6).
- **Pedestrians get destinations:** shops, bus stops, landmarks. The `nightOwl` and `civicRegular` schedules are used.
- **Buses dwell at the kerb and riders board** (`transit/system.ts:601-620`); ASTRA does the doors.
- **The `Hold` reason becomes comedy:** car thought lines in the inspector, and feed posts authored by the specific citizen stuck on the specific road.
- Done when a test follows one household for a week of trips that all start and end at its home and job, the inspector shows the card, and `scaletest`, `crosswalktest` and `soak` hold.

**F8. Politics and the conscience** (new `src/sim/politics.ts`, the UI).
- **Clout**, earned from ribbon cuttings, tax cuts and potholes filled before elections, and spent on rezonings and variances.
- **Public hearings** with the regulars: Earl, Skyler (the bike guy), Deb (HOA), Chad (developer), Pastor Rick (Easter parking). You always win; it costs time and Clout. Keep these short: a card and a vote.
- **The endangered salamander.**
- **Honest Mode, unlocked through Earl:** one swapped dictionary over every label, ledger line and info view ("Unactivated Land → Old-growth forest", "Growth → Unfunded liabilities"; the table is in GAME_DESIGN §3). This is cheap and it is the thesis; do it early in this phase.
- **Achievements** from the GAME_DESIGN list: *One More Lane*, *Induced*, *Burning River*, *Silent Spring*, *Lakefront Living*, *Mattress Mystery*, *Five Levels Deep*, *Paradise Paved* and the rest.
- **Scenarios** on the existing maps with goals, starting with "Mountaintop Makeover" (Holler County) and "Gator Gulch" hurricanes.
- **The design doc's policies:** Single-Family Only, 1-Acre Minimum Lots, 50-ft Setbacks, Right Turn on Red, Speed Traps (a revenue building), Corporate Tax Abatements, Mandatory HOA. Make each a real modifier on a system, not a flat demand delta.
- Done when each has a test, and Honest Mode flips every visible label with no untranslated booster word left (a script scans the DOM).

**F9. Headless sim core** (start once F0.3 is in, and keep it incremental).
- Pull rendering out of `src/sim` behind interfaces, so `sim`, `services`, `freight`, `transit`, `zones`, `network` and the meso traffic run in Node with no three.js or DOM.
- Then add unit tests for the sim math, using Node's built-in test runner (no new dependency), and fast balance runs: a 10-year town in seconds, not 20 minutes of Playwright.
- A Web Worker is the later payoff; don't start it in this push unless everything else is done.
- Done when `node --test scripts/unit/` runs the demand, ledger, freight-conservation, coverage and liability tests in under 30 s, and the browser game is unchanged (fingerprint test).

### Phase 2: the player's screen (start when F1 to F3 are in; F8's Honest Mode can come earlier)

**U1. "Orientation with Chad"**: a guided first session that teaches by doing (`hud.ts:254-275, 740-830`, `ui/*`).
- Replace the modal and text steps with spotlight highlights tied to real UI elements and to world cells ("zone *these* plots"). The step list:
  1. road;
  2. zone homes;
  3. **power, water, sewage** (taught before the first emergency, not after);
  4. jobs;
  5. the first weekly close, explained on the budget.
- Each step completes on the action, not on a button.
- Chad becomes a recurring voice in short barks (≤ 15 words) at milestones and emergencies, always the true believer. A second voice can be Earl's quiet asides once Honest Mode is unlocked.
- Fix the goal line ("pave every inch and max every building" is unreachable).
- Step 5 leaves the screen when it's done.
- Done when a new `naivebot.mjs`, which only does what the on-screen guidance highlights, reaches 350 people on all three maps with no emergency it wasn't taught to handle. `firststeps` is updated and passes.

**U2. Information like Skylines 2.**
- A **statistics panel** with charts drawn in a small in-house SVG/canvas chart module (no dependency) from `sim.history`, `demandHistory`, `popFlow`, the ledger and the new liabilities:
  - population;
  - money and weekly balance;
  - RCIO demand;
  - commute;
  - trees lost;
  - lanes added;
  - service coverage.
- Budget history and a 10-year liability forecast as charts.
- **Every info view gets** a legend (ASTRA renders, you supply `legend`), hover values, and filtered need bubbles (ASTRA's clustering, your filters).
- **"Why?" on every number** the HUD shows (the demand card already does this beautifully; extend the pattern).
- Done when every view has a legend and hover, `uisweep` passes on both devices, and a test asserts each chart renders non-empty data after 60 days.

**U3. Feedback and juice** (with ASTRA's sounds and VFX).
- Completion pops.
- Money ticks on weekly close.
- Zone-paint ripple.
- **Milestone fanfare as a full-screen moment.**
- Readable toasts: duration by word count, a 3 s floor, and long refusals become cards.
- A press state on every button, and hover on desktop.
- Snappy tool feel: preview → place → confirmation within 100 ms (measure input-to-paint with a script).
- Done when a script measures every primary action's response time under 100 ms on desktop and under 150 ms on the phone proxy.

**U4. A HUD that looks shipped** (`style.css`, `hud.ts`).
- **One layout system:** CSS grid regions for the top bar, toolbar, cards and sheets, replacing the `layoutCards` / `placeNextBar` JS patches and the 17 stacked media blocks. Restructure `style.css` into tokens, layout and components, using the existing palette (lime `#c6f432`, cream `#efe6cf`, ink `#111111`, Cannon red `#b3202a`) and fonts (Anton, Bungee, Overpass, Permanent Marker, Titan One, Yellowtail).
- **A type scale with a 12 to 13 px floor.**
- Wire ASTRA's drawn icon set in place of emoji.
- Formatted policy and district cards (no raw "·ON").
- Fix the help line (O1) and O4.
- Done when `overlaptest`, `phonetargets` (44 px, except what the owner accepted), `hudfootprint`, `uisweep`, `fovtest` and `audit8 phone/desk` pass, and the audit screenshots are compared before and after.

**U5. Menus and safety.**
- **A pause/Esc menu:** Resume, Save, Load (slots), Settings, Quit to title.
- **Bulldozing a grown building asks or can be undone,** and undo covers it.
- Detect form factor from viewport and pointer, and rebuild the toolbar on resize and rotate (`hud.ts:67`, `config.ts:13`). An iPad with a keyboard gets desktop.
- **Every one of the 54 LEARNABILITY refusals names a next step.** Red means "you can act"; news is neutral.
- **Feed posts are clickable:** they fly the camera to the place, with real relative timestamps.
- Done when `tooltest`, `ghosttap`, `gesturetest`, `touchtest`, `inputtest`, `roadrules` and `zonetest` pass, plus a new `menutest` and `refusaltest` (every refusal string has a next step).

**U6. Accessibility.**
- UI text scale at 100%, 125%, 150% and 200%.
- Colour-blind palettes and **zone patterns** (R/C/I/O can't rely on hue; `style.css:1-21`; ASTRA does the world palette).
- Key remapping and full keyboard focus order.
- Reduced motion that also covers camera flights, float text and particles, through a flag ASTRA reads.
- Edge scroll: propose default-off on desktop in DECISIONS.
- Remove `user-scalable=no`, or provide the in-game scale instead.
- Done when a test runs `uisweep` at 200% scale with no overflow, and an axe-style DOM check (written in-house) finds no unlabeled controls.

### Phase 3: the writing (alongside Phase 2)

**C1. Grow the thin feed pools** (`content/feed.ts`, `feedPanel.ts`).
- New lines for every event kind with fewer than 5. New kinds for transit, districts, disasters (the new player-caused ones), goods shortages, landmark game nights, milestones, induced demand, the Ponzi cliff, parking, floods and endings.
- Write in the house voice: deadpan local internet, Chamber-of-Commerce boosterism, punching at systems not people, balanced across both tribes (the audit counts about 120 right-leaning, 119 left-leaning and 40 both-sides lines; keep it balanced).
- Prefer evergreen specifics (center turn lanes, mattress stores, HOA lawn rules) over meme-of-the-month references that date fast.
- Leave the `driveThruLine` placeholder for the owner, but offer three drafts in DECISIONS.
- Done when each kind has at least 6 lines, `feedtest` and `copytest` pass, `contentaudit` (or the dry-run list) and `ipcheck` pass, and every new line is listed for the owner.

**C2. Feed bugs.**
- Don't wrap sober kinds (`pedestrianHit`, `drunkCrash`) in joke prefixes.
- Reduce repetition (a per-line cooldown across the session).
- Post authors become real citizens (F7).
- "Commissioner" vs "mayor" is an owner wording call: propose it.
- Done when there's a test for each.

**C3. The UI's voice.** The learnability pass made HUD copy plain, and that was right for instructions. Add voice where it doesn't cost clarity:
- milestone titles;
- the ledger's line names (booster labels with Honest Mode flips);
- advisor barks;
- loading tips;
- achievement names.

Instructions stay plain.

**C4. Content-risk list for the owner** (don't fix; list in DECISIONS with options):
- the six open CONTENT_REVIEW items (Chick-Fil-Eh's script font, chicken icon and red; Bullseye's red and target; the Hoots owl; Whole Paycheck green; "DoorDash Driver"; "Stanley Cup Mom");
- the parody public figures who post in the feed ("Elongated Muskrat", "Zuckerborg", "Broe Jogan", "Tucker Car-Lot-Son", "AOCivic"; it leans about 4 to 1 against one side);
- the word-for-word song lyric in the win card (`hud.ts:1721`), which should be replaced with an original line;
- "GET IN THE F*CKING CANNON" (the owner's own slogan);
- merch links in five places;
- the 𝕏 mark, @grok and Community Notes before any store release.

### Phase 4: proof (the last 15% of the run)
- **Bot playtests on all three maps,** several seeds each, Ponzi mode, before and after the whole push: days to each milestone, treasury, what blocked growth, where it bankrupted. Write them up in `docs/aaa/PLAYTEST_AAA.md` in PLAYTEST_6's format.
- **Pacing.** Ten thousand people in about 8 minutes at ▶▶▶ was left for the owner to judge. Give them the numbers and two or three proposals.
- **The full suite** on a frozen snapshot of the final `aaa/integration`: everything passes, or each failure is explained and shown failing on the base.
- `npm run build:single`. Check the bundle for no API key, no `typesafe` and no `__dbg` without the hash. Leave the owner a build to open on the phone, with a fresh-eyes checklist for the first session.
- Write `docs/aaa/HANDOFF_NEXT.md`: what's done, what's proposed, and what's next, in priority order.

---

## 7. How to work

- **Freeze what you test.** The dev server hot-reloads and kills captures. Serve a frozen copy (`node scripts/snapshot.mjs <name> <port>`), and run old and new side by side on two ports for every before/after.
- **Run scripts from the repo root.**
- **Step the car model; don't render it,** when you test traffic (`__game.traffic.update(...)`). After F9, prefer the Node sim.
- **Seed everything** and compare several seeds. One run proves nothing for anything with traffic in it.
- **Write results to files as you go.** A restart must not lose an hour.
- **Use subagents for breadth.**
  - Parallel multi-seed or multi-map runs, each agent with its own port in your range.
  - A reviewer on every risky diff before it lands on `aaa/integration` (traffic, services, save, determinism). Give it the code, not your conclusion.
  - Explore for wide reads.
  - A workflow when a task fans out (for example "measure F1 on 3 maps × 4 seeds", or "check all 54 refusals").

  Brief each like a peer: goal, files, what's ruled out, what done looks like. Verify what comes back before you act on it.
- **When something you need is ASTRA's,** write it in `REQUESTS_FABLE.md` and move on.
- **Keep `traffic.ts` and `services.ts` changes small and measured.** They are the riskiest files: interacting fixes, owner-approved balance, and position-keyed saves. Every round-8 fix there needed multi-seed before/after runs. Splitting `services.ts`'s UI panels into `src/ui/servicesPanel.ts` early will make the rest of your work safer.

## 8. Owner decisions (don't make these; list them in `docs/aaa/DECISIONS_FABLE.md` with your recommendation and evidence)
- **Every number in `tuning.ts` marked PROPOSED,** especially:
  - the maintenance cliff's timing and size;
  - whether widening resets a road's age;
  - bailout strings;
  - pacing.
- **Tone:**
  - the culture-war dial (GAME_DESIGN §3 says 3 with no real people; WORKSTREAMS says 10 with parody public figures; WORKSTREAMS governs today);
  - the C4 content-risk list;
  - "Commissioner" vs "mayor";
  - the `driveThruLine` copy.
- Defaults: edge scroll, tilt-shift strength (ASTRA's, but the setting is in your UI), and whether new systems start on in existing saves.
- Fast-forwarding `main` to `aaa/integration`.

## 9. Reporting
At each integration merge, and at the end, update `docs/aaa/LOG_FABLE.md` and give a short report:
- the `aaa/integration` commit, and what came in from each branch;
- what changed, with before/after numbers and seeds;
- test results: what passes, what fails, and whether it fails on the base too;
- what's in `REQUESTS_*` and `DECISIONS_FABLE.md`;
- the owner's phone and fresh-eyes checklist;
- what you didn't get to, in priority order.

## 10. Running alone
If ASTRA isn't running:
- Still create `aaa/integration` and work through it.
- Finish Phase 0 and Phase 1.
- Then take ASTRA's highest-impact items in its order (`docs/aaa/ASTRA.md` §6):
  - W0.6, the inverted phone benchmark (a real bug);
  - W1, the forest;
  - W2, camera and tilt-shift;
  - W7, the phone look;
  - W11, info-view rendering (your U2 needs it);
  - W14, icons (your U4 needs them);
  - A3, UI sounds (your U3 needs them).

  Follow ASTRA's rules for those files: Low variants, golden before/after, budgets.
