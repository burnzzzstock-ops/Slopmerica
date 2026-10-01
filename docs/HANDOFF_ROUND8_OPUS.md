# Handoff (round 8, Opus): the simulation under load

You're taking over the simulation side of SLOPMERICA, a satirical American city
builder (three.js r186, TypeScript, Vite, no framework). The traffic pass, the
owner's five balance decisions and the cars-look pass are merged and pushed
(`claude/festive-bohr-nugn55`, c908e7d or later). This round is an **audit, then
fixes**: find what still goes wrong when the town is busy, big or old, prove it
with numbers, and fix it one measured change at a time.

**A Sonnet session works in parallel on what the player sees and touches**
(`docs/HANDOFF_ROUND8_SONNET.md`). Read "Working alongside" before you edit
anything.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base on the tip of
   `claude/festive-bohr-nugn55`. Push to **your own session's branch**, never to
   `claude/festive-bohr-nugn55`. Don't open a pull request unless asked.
2. Read, in this order:
   - `docs/PLAYTEST_6.md` (the late game, the owner's decisions of 2026-09-30,
     what's still proposed);
   - `docs/HANDOFF_TRAFFIC.md` (how the traffic model is built and tested);
   - `docs/cars-look/junction.md` (junction paint; read its correction note);
   - `README.md` (the test list) and `docs/WORKSTREAMS.md`;
   - the last ten commit messages on the base branch: each carries its numbers.
3. `npm install` if needed. Debug hooks in the page: `window.__game` (the whole
   game; `__game.traffic` is the car model, `__game.peds` the people),
   `window.__dbg` (`road`, `zone`, `run(days)`, `view(x, z, dist, yaw, pitch)`,
   `hour(h)`, `save()`, `unlockAll()`), `window.__services`.

## Working alongside

**Yours:**
- `src/agents/traffic.ts`, `src/agents/parking.ts`, how people move in
  `src/agents/pedestrians.ts` (where they walk, wait and cross);
- `src/sim/*`, `src/transit/*`, `src/zones/*`, `src/roads/network.ts`,
  `src/roads/roadJunction.ts` and the paint constants in `src/roads/roadSection.ts`
  (the crossings must follow where people actually walk: item 4);
- the traffic, freight and late-game test scripts (`carsolid`, `crosswalktest`,
  `landmarktest`, `parkingtest`, `trafficscale`, `freighttest`,
  `playtest6-late`, `progresstest`, `demandtest`, `econtest`), and new ones;
- `docs/PLAYTEST_6.md`.

**Sonnet's; don't edit:** `src/ui/*`, `src/style.css`, `src/render/*`,
`src/world/*`, `src/art/*`, `src/audio/*`, `src/agents/vehicles.ts`,
`src/agents/models/*`, `src/agents/people.ts`, the `QUALITY` presets, and the
test-infrastructure scripts Sonnet is told to fix (`playtestcheck`, `feedtest`,
`yellowflash`, the new suite runner).

**Shared:** `src/game.ts`, `src/config.ts`, `README.md` (one line per new
script). Keep your changes there small and in their own commits.

**If a fix belongs in Sonnet's files,** don't make it; write it up (file, cause,
proposed fix) in your report. **Merge** `origin/claude/festive-bohr-nugn55` into
your branch before each push and at the end; resolve conflicts without undoing
anyone's work, then rerun your tests.

## Rules (the owner's, unchanged)

- **No new npm dependencies.**
- **Offline game.** Nothing in `src/` calls a network API. No API key goes into
  `src/`, the bundle, a `VITE_` variable, a log, a commit or a report.
- **Jev (the TypeSafe API) only in Node scripts** at dev or build time, never in
  the game, never for jokes, posts, names, dialogue, balance or anything
  per-frame. Every script has a `--dry-run` that needs no key. Report requests,
  tokens and dollars for each run; keep a full pass under $1. Never open or
  print `.env.local` or the key.
- **Content and balance are the owner's call.** Measure and propose numbers;
  change a balance constant only when something is outright broken, or the
  owner says yes. Don't rename brands or rewrite jokes.
- **Graphics presets must not change the simulation** (`scripts/qualitytest.mjs`).
- **Every fix gets a check that fails before and passes after.** One fix per
  commit, with the before and after numbers in the message. No model names in
  commits or files.

## How to test (lessons from round 7: read all of it)

- **Freeze what you test.** The dev server hot-reloads the page whenever you save
  a file, and a running test dies with "execution context was destroyed". Serve
  a frozen copy: `node scripts/snapshot.mjs <name> <port>` (hmr and file
  watching off). Run old and new side by side on two ports for every
  before/after.
- **Run scripts from the repo root**, with `BASE_URL` pointing at the snapshot.
  `scripts/refblock.mjs` reads the reference town from
  `shots/lookbook/town.json` relative to the working directory; run from
  anywhere else and it silently grows a *different* town. Watch your shell:
  `cd X && (A) & (B) &` runs B in the old directory.
- **Two browsers at a time** on this 4-core software-GPU box
  (`scripts/withslot.sh`). Heavy tests: `nighttest` ~17 min, `yellowflash`
  ~21 min, `parkingtest` ~13 min. Under load, tap and screenshot timeouts are
  load, not bugs: rerun alone before believing them.
- **Step the car model; don't render it** (`__game.traffic.update(1/20, 1, hour,
  pop, jobs, target)`). One rendered High frame at night takes ~3.8 s here.
- **The container can restart** and kill every background job and server. Write
  results to files as you go, and check what finished before rerunning.
- **The traffic tests are not seeded.** One run proves nothing: compare 6 runs
  of old and new and report counts. Item 1 fixes this.

## Baselines (c908e7d, this machine)

| check | today |
|---|---|
| `crosswalktest` people inside a car | 0 in 12 runs (old code: fails ~1 run in 6) |
| `crosswalktest` trips with people vs cars ignoring them | 0.955 (old 0.99); 1 run in 6 under the 85% floor |
| `carsolid` overlaps | lane 0.00–0.02 and junction 0.00–0.02 pairs at any moment, 0–1 heading snaps: fails most runs, old code too |
| `carsolid` longest wait away from a red | 19–51 s (5 runs); the queue that tops it is a permissive left from Wildflower Dr onto Old County Road (node 45); 56 s on the old code, and 73–120 s in rounds where its line moved back |
| `landmarktest` "the crowd drives home" | passes about half the runs, old and new |
| `trafficscale` at 1,000 cars | 5.2–6.5 ms a step (target 4), last measured before the merge |
| late-game bot runs | stalled towns sat at 1,214–1,703 people; the owner's five decisions are in but **no bot run has measured them yet** |

## The work, in order

For each item: reproduce, find the root cause, smallest fix, a check, commit.
Start with a short audit (play a big town at ▶▶▶ for an hour of game time on
each map, read the traffic and freight code paths you'll touch) and write
`docs/AUDIT_ROUND8_SIM.md`: findings ranked by how much a player would notice,
each with how you measured it. Then:

1. **Make the traffic tests reproducible.** Seed `Math.random` in `carsolid`,
   `crosswalktest`, `landmarktest` and `parkingtest` from a `SEED` env (print it;
   default random), the way `trafficscale` does. Done when the same `SEED` gives
   identical numbers twice, and a failing seed from a flaky run can be replayed.
2. **The gridlock breaker** (`PLAYTEST_6.md`, "Bare shelves"). On a dense
   two-lane grid the "don't block the box" wait locks queues into rings; goods
   trucks sat for weeks, and the goods trickle is only a stopgap. Design it
   (a driver held at the line with the box empty creeps in after N s, or
   reroutes; or a ring detector), measure it on a grown Florida town and on
   the reference block. Round 7's Florida save isn't in the repo: grow one
   with `MAP=florida SAVE=shots/florida.json SAVEAT=650 node
   scripts/playtest6-late.mjs` and keep it for before/after. Done when: truck deliveries a week rise on the Florida
   save, `carsolid`, `crosswalktest` and `landmarktest` don't get worse (same
   seeds), and a 30-minute ▶▶▶ soak has no ring.
3. **Left turns at capacity.** At signals a permissive left waits for a gap and
   only one car goes as the light changes. Measure queue length and waits at
   node 45 by hour; propose and (if it's a bug, not balance) implement a fix:
   gap acceptance that counts the oncoming car's time to arrive, two cars on
   the change, or a protected left phase where the queue is long. Done when
   no car waits over 60 s away from a red across 6 seeded runs, without
   throughput falling elsewhere.
4. **One walk line for everyone.** Today three places each guess where people
   cross: `pedestrians.ts kerbs()` (where they really walk),
   `traffic.ts stopBack()` (the worst of the two sidewalk ends, capped at 6 m;
   it costs ~5% of trips) and `roadJunction.ts legMarks()` (paints the zebra on
   the trim, not where skewed-corner walkers cross). Round 7 tried moving each
   lane's line back by the walkers' straight diagonal: people were inside cars
   again 1 run in 6, because they don't walk that diagonal. Log the real walk
   paths (`p.go`, `p.crossing`) at the 10 skewed arms, put the crossing
   geometry in one roads-level function that all three use, and stop each
   lane only as far back as the path over it. Done when: 0 people inside a car
   over 6 seeds, the trips ratio is back to ≥ 0.98, and the zebra covers the
   walk path on skewed legs (a new check, plus pictures).
5. **The late game, measured.** Run `playtest6-late` on all three maps with the
   owner's five decisions (offices at 1,100, taxes 3/pt, the goods parcel,
   landmark numbers, the College toast). Add a before/after milestone table to
   `PLAYTEST_6.md`: days to each milestone, treasury, what blocked growth now.
   Fix what's broken; propose numbers for the rest.
6. **Traffic at scale.** Get `traffic.update` under 4 ms a step at 1,000 cars
   (`trafficscale`, seeded): profile first, then move what's O(n²) onto the
   lane buckets or a grid. People: time `peds.update` at 3,000 walkers.
7. **`landmarktest`'s crowd going home.** Half the runs miss the target (14–16
   trips home against 16.8). Find out whether the lot lets cars out too slowly,
   the crowd gets stuck, or the check is too tight, and fix the cause.

## Finishing

- Merge the latest base, then run the whole `README.md` test list on a frozen
  snapshot of your final code. Every test passes, or you say which fails, why,
  and whether it fails on the base too.
- `npm run build:single`; check the bundle has no API key and no `typesafe`.
  **Never publish to the main game link.** Publish your build as a new
  artifact for the owner to try on their phone.
- Report plainly: your branch; what you fixed with before/after numbers and
  seeds; what you propose (numbers) for the owner to decide; what you didn't
  get to; anything you found in Sonnet's files.
