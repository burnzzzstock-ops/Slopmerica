# Handoff: traffic that behaves, real parking, and the late game

You're taking over the simulation side of SLOPMERICA, a satirical American city
builder (three.js r186, TypeScript, Vite, no framework). The owner: "the cars
still need some improvement for sure, but everything could use more polish."
The audit behind this handoff is `docs/AUDIT_ROUND7.md`. Read it first; every
item below points back to it.

**Another session is doing the look of cars and the town in parallel**
(`docs/HANDOFF_CARS_LOOK.md`). Read "Working alongside the look pass" before
you touch anything.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base your work on the tip of
   `claude/festive-bohr-nugn55`. Push to **your own session's branch**, never
   to `claude/festive-bohr-nugn55`. Don't open a pull request unless asked.
2. Read:
   - `docs/AUDIT_ROUND7.md`
   - `README.md` (the test list)
   - `docs/GAME_DESIGN.md` §5.3 (traffic and induced demand)
   - `docs/WORKSTREAMS.md` (file ownership)
   - `docs/GRAPHICS_HANDOFF.md`: its "How to test" and "Pitfalls" apply to
     you too.
3. `npm install` if needed, then `npx vite --port 5173`. Debug hooks in the
   page:
   - `window.__game` (the whole game; `__game.traffic` is the car sim)
   - `window.__dbg`: `road`, `zone`, `run(days)`, `view(x, z, dist, yaw,
     pitch)`, `hour(h)`, `save()`, `unlockAll()`
   - `window.__services`
4. Run `node scripts/carsolid.mjs` against a snapshot server (see "How to
   test"). It fails today:
   - 5.4–8.0 pairs of cars inside each other in lanes;
   - 1.2–2.1 pairs in junctions;
   - 20–25 heading snaps.

   That's your baseline. With 74–81% of cars moving and about 128 trips
   finished in 120 s, a fix mustn't simply stop the cars. Traffic is random,
   so runs vary; the bar is zero.

## Working alongside the look pass

**Yours:**
- `src/agents/traffic.ts` (driving, junctions, crashes, parking logic);
- how walkers move in `src/agents/pedestrians.ts` (where they walk and wait;
  not their models);
- `src/sim/*`, `src/transit/*`, `src/zones/*`, `src/roads/network.ts`,
  `src/tools/*`, `src/ext/*`;
- the `src/ui/*.ts` logic;
- saves, and new test scripts.

**Theirs; don't edit:**
- `src/agents/vehicles.ts` and `src/agents/models/*`;
- `src/world/*`, `src/render/*`, `src/art/*`, `src/audio/*`;
- `src/roads/roadMesh.ts`, `roadSection.ts`, `streetDetails.ts`;
- the look of `src/buildings/*`;
- the `QUALITY` presets and `src/style.css`.

**The one crossing: parking (item 5 below).**
- You may make small, clearly commented changes in the building generators
  (`src/buildings/comLow.ts`, `houses.ts` and the lot code) that:
  - export the parking-spot and drive-thru-lane lists;
  - stop baking the parked cars that your live ones replace.
- Nothing else in those files. Say so in the commit message.

**The renderer contract.**
- Drive cars only through `VehicleRenderer`'s public methods: `add`, the
  transform update, `setBraking`, `setTurn`, `remove`, `pick`.
- The look pass may add optional ones (for example `setParked`,
  `setReversing`, `setHeadlights`). Call them only if they exist
  (`renderer.setParked?.(h, true)`).

**Shared:** `src/game.ts`, `src/main.ts`, `README.md` (one line per new
script). Keep your changes there small and separate.

**If a bug's fix belongs in their files,** don't make it. Write it up in your
report (file, cause, proposed fix).

**Merging:** merge `origin/claude/festive-bohr-nugn55` into your branch before
each push, and again at the end. Resolve conflicts without undoing anyone's
work, then re-run your tests.

## Rules

- **No new npm dependencies.**
- **Offline game.** Nothing in `src/` calls a network API. No API key goes in
  `src/`, the bundle, a `VITE_` variable, a log or a commit.
- **Content belongs to the owner.** Don't rename brands or rewrite jokes.
- **Balance is the owner's call.** Crash rates, trip volume and money: measure
  them and propose numbers. Change them only if something is outright broken.
  The crash-rate proposal is in the audit; implement it behind named constants
  only if the owner says yes.
- **Graphics presets must not change the simulation**
  (`scripts/qualitytest.mjs`).
- **Every fix gets a check that fails before and passes after,** either a new
  `scripts/*.mjs` or an addition to an existing one. One fix per commit, with
  the numbers in the commit message.

## How to test

Everything in `docs/GRAPHICS_HANDOFF.md` "How to test" applies:

- headless Chromium on a software GPU, slow;
- snapshot servers on port 5175 with `hmr: false`, so edits don't reload a
  running test;
- `timeout: 180000` on screenshots;
- at most two browser jobs at once.

For traffic work:

- **Step the car model directly; don't render it.** On the software GPU one
  rendered frame of the town takes seconds. Stepping the model is 0.6 ms at
  99 cars:
  ```js
  __game.traffic.update(1 / 20, 1, hour, __game.sim.population, __game.sim.jobsFilled, __game.rts.target)
  ```
  `scripts/carsolid.mjs` shows the pattern: it opens the reference block
  (`scripts/refblock.mjs`) and steps 20 times a second.
- **Render only when you need a picture:** aim the camera at a real car
  (`__dbg.view(car.x, car.z, 12, car.ryaw + 0.9, 0.3)`).
- **Existing tests to keep passing:**
  - `motiontest` (heading, braking for turns, lane changes, blinkers,
    one-ways)
  - `junctiontest`, `onewaytest`, `gridtest`, `interchangetest`
  - `transittest`, `transitcut`, `transithonest`
  - `scaletest`, `qualitytest`
  - `econtest`, `ledgertest`, `progresstest`
  - `savetest`, `savecontinuity`, `soak`, `nantest`
  - `carsolid` (yours to turn green)

## The work, in order

For each item: reproduce it, find the root cause, make the smallest fix, add
the check, then commit.

1. **Driveway merges (audit #1).** A car leaving a lot must see stopped and
   slow cars, not only cars above 2 m/s. It should merge only into a real gap:
   - never into space a car already occupies;
   - two cars leaving one lot take turns;
   - a queued car may leave a courtesy gap after a few seconds, so nobody
     waits forever.

   Then retire the "overlapped: let them untangle" branch (~traffic.ts:650),
   or make it resolve safely (the car behind holds until there's a gap).

   Done when: carsolid's lane line passes, motiontest passes, and the share of
   cars moving and trips finished don't fall by more than 10%.
2. **Junctions (audit #2, #3).**
   - A car on a junction curve follows the car ahead of it on its own curve,
     and on any curve feeding the same exit lane (IDM along the curve).
   - A full exit holds cars at the stop line in a spaced queue, not all at
     the curve's end.
   - Permissive left turns at signals yield to oncoming traffic going
     straight.
   - All-way stops go first come, first served.
   - Find what makes the 20–25 heading snaps (junction entry and exit are the
     likely places) and remove them.

   Done when:
   - carsolid's junction and snap lines pass;
   - throughput through the block's main junction (cars a minute, measured
     before and after) doesn't drop;
   - a 30-minute soak at ▶▶▶ has no gridlock.
3. **Crash rate (audit #4).** The owner said yes to lowering it (2026-09-30).
   Measure crashes per 1,000 car-minutes by hour and cause, then apply the
   proposal behind named constants: 1% drunk by day, 6% at night, and a
   random-crash rate a third of today's. Report the numbers before and
   after.
4. **People and cars (audit #5).**
   - Cars stop for people on the crosswalks at junction arms.
   - People wait at the kerb for a gap, or for a walk phase at signals.

   Done when a new check passes: no walker is ever inside a car's footprint,
   and a car facing someone on a crosswalk stops.
5. **Real parking and drive-thru queues (audit #6).** The owner said yes:
   "the more detail the better".
   - An arriving car takes a spot in its destination's lot or driveway and
     stays there as a parked instance until its next trip. Parked cars cost
     no simulation time. Cap them per preset.
   - Departures back out of their spot.
   - Lots fill by time of day: offices mid-morning, SprawlMart at noon, homes
     at night.
   - Replace the baked lot cars where live spots exist (see "The one
     crossing").
   - Drive-thru lanes become real queues. At a grand opening the line spills
     onto the stroad and blocks the kerb lane (design doc §5.3), and the feed
     can say so.

   Done when:
   - a check shows lot occupancy by hour;
   - a spilled queue blocks a lane and clears;
   - the car counts and frame time per preset are reported before and after.
6. **The late game (audit #13).** The playtest-6 run never wrote
   `docs/PLAYTEST_6.md`. Run
   `BASE_URL=... MAP=<each map> node scripts/playtest6-late.mjs` toward
   10,000 people. Write the report:
   - the milestone table: days, treasury, what blocked growth;
   - the College: does it do something visible?
   - every landmark: does it need a road and say so? Does it change traffic,
     land value or visitors? Does the inspector explain it? The stadium
     report said "nothing happens"; Friday-night football trips (§5.3) would
     be the natural fix.

   Fix what's broken; propose numbers for what's balance.
7. **Traffic at scale.**
   - Time `traffic.update` at 250, 500 and 1,000 cars (`SIM_MAX_CARS`).
   - Anything that's O(n²) (pair checks, yield scans) goes through the
     per-lane buckets or a grid.
   - Target: under 4 ms a step at 1,000 cars on this machine.

## Finishing

- Merge the latest `origin/claude/festive-bohr-nugn55`, then run the whole
  test list from `README.md` on a snapshot of your final code. Every test
  passes, or you say exactly which one fails and why.
- `npm run build:single`. Check that the bundle has no API keys and no
  `typesafe`. **Don't publish to the main game link.** If you can publish, put
  your build up as a new artifact for the owner to try on their phone.
- Report plainly:
  - your branch name;
  - what you fixed, with before and after numbers (carsolid, throughput, frame
    time);
  - what you propose (with numbers) and the owner's decisions;
  - what you didn't get to;
  - anything you found in the look pass's files.
