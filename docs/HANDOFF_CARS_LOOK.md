# Handoff: cars that look real, night light, street sound, and a polish pass

You're taking over the look and feel of SLOPMERICA, a satirical American city
builder (three.js r186, TypeScript, Vite, no framework). The owner: "the cars
still need some improvement for sure, but everything could use more polish."
The audit behind this handoff is `docs/AUDIT_ROUND7.md`. Read it first; every
item below points back to it.

You did the last graphics pass (roads, ground, walls, civic, trees, shores,
presets, draw calls), so `docs/GRAPHICS_HANDOFF.md` and
`docs/ART_DIRECTION.md` are familiar. The same rules apply.

**Another session is doing how cars behave in parallel**
(`docs/HANDOFF_TRAFFIC.md`). Read "Working alongside the traffic pass"
before you touch anything.

## The owner's decisions (2026-09-30), on top of the list below

- **Night: "make it cozy warm night lights."** Street lamps, windows, signs
  and headlights should feel warm and inviting: sodium, incandescent, amber.
  Keep `nighttest`'s readability targets. This settles the open "night reads
  as night" question: warm and readable beats dark.
- **"Work on the yellow flashing again on Ultra."** Something yellow flashes
  at night on Ultra. Earlier versions of this were:
  - "night looks like rapid glowing snowfall" (G4);
  - the yellow land-for-sale border glowing at night.

  Reproduce it on Ultra first (moving camera, night, rain and clear), find
  the cause, and add a check that fails before and passes after. Do this
  before the car bodies.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base your work on the tip of
   `claude/festive-bohr-nugn55`. Push to **your own session's branch**, not to
   `claude/festive-bohr-nugn55` this time (two sessions are working at once).
   Don't open a pull request unless asked.
2. Read:
   - `docs/AUDIT_ROUND7.md`
   - `docs/ART_DIRECTION.md`
   - `docs/GRAPHICS_HANDOFF.md` ("How to test", "Pitfalls")
   - `README.md` (the test list)
   - `docs/WORKSTREAMS.md`
3. `npx vite --port 5173`. For anything long, use a snapshot server on 5175
   (`hmr: false`, `watch: null`). Debug hooks: `window.__game`, `window.__dbg`
   (`view`, `hour`, `run`, `save`), `window.__services`.

## Working alongside the traffic pass

**Yours:**
- `src/agents/vehicles.ts` and `src/agents/models/*` (vehicle and person
  models, materials, lights);
- `src/world/*`, `src/render/*`, `src/art/*`, `src/audio/*`;
- `src/roads/roadMesh.ts`, `roadSection.ts`, `streetDetails.ts`;
- the look of `src/buildings/*`;
- the `QUALITY` presets in `src/config.ts`;
- `src/style.css` (visual styling only);
- graphics scripts.

**Theirs; don't edit:**
- `src/agents/traffic.ts` (driving, junctions, crashes, parking logic);
- how walkers move in `pedestrians.ts`;
- `src/sim/*`, `src/transit/*`, `src/zones/*`, `src/roads/network.ts`,
  `src/tools/*`;
- the `src/ui/*.ts` logic;
- saves.

**The renderer contract.**
- The traffic pass drives cars through `VehicleRenderer`'s public methods:
  `add(kind, color)`, the transform update, `setBraking`, `setTurn`,
  `remove`, `pick`.
- Keep those signatures and behaviour.
- You may add optional ones, and it will call them if present:
  - `setParked(handle, on)`: settles the suspension, stops the wheels,
    lights off;
  - `setReversing(handle, on)`: reverse lights;
  - `setHeadlights(handle, level)`.

  Document each one in a comment.

**Parking crosses both passes.** The traffic pass will make parking real: cars
park in lot and driveway spots, and drive-thru queues are live. For that it
may:
- export spot and drive-thru-lane lists from `src/buildings/comLow.ts`,
  `houses.ts` and the lot code;
- stop baking the parked cars that its live ones replace.

Don't rework the baked parked cars or drive-thru lines in those files. Leave
them for that change.

**Shared:** `src/game.ts`, `src/main.ts`, `README.md` (one line per new
script). Keep your changes there small.

**Merging:** merge `origin/claude/festive-bohr-nugn55` into your branch before
each push, and again at the end.

## Rules

- **No new npm dependencies.** Everything is hand-built on three.js.
- **Offline game.** Nothing in `src/` calls a network API. No key goes in
  `src/`, the bundle, a `VITE_` variable, a log or a commit.
- **Content belongs to the owner.** Keep every joke vehicle a joke: the
  Cyberslop stays stainless and angular, the lifted truck stays absurd, and
  sign text and brand names don't change.
- **Graphics must not change the simulation**
  (`scripts/qualitytest.mjs`). A car's size (`VEHICLE_SPECS`
  length/width/height) is used by the sim. Don't change it; build the new
  body to fit it.
- **Measure, don't eyeball.** Every change gets:
  - a before/after capture from the same camera;
  - wherever possible, a number, checked against a snapshot of the old code.

  Put the numbers in the commit message. One improvement per commit.

## How to test

- Everything in `docs/GRAPHICS_HANDOFF.md` "How to test" applies. The
  reference block and `lookbook.mjs` / `drawcalls.mjs` are your baseline.
- **Cars need traffic before you capture them.** The lookbook reopens a saved
  town with almost no cars on the road. Step the traffic model first, then
  aim the camera at a real car:
  ```js
  const g = __game;
  for (let i = 0; i < 1200; i++) g.traffic.update(1 / 20, 1, 8, g.sim.population, g.sim.jobsFilled, g.rts.target);
  const c = g.traffic.cars.find((c) => c.v > 8 && !c.junction);
  __dbg.view(c.x, c.z, 11, c.ryaw + 0.9, 0.28);
  ```
  That's how the audit's close-ups were made. Stepping costs 0.6 ms a step;
  rendering a frame costs seconds on this software GPU.
- **Build a vehicle lineup.** Make a dev page or script that shows every kind
  side by side at 8 m, 40 m and 150 m, by day and by night. Capture it before
  you start.
- **Triangles today:** about 1,000 near and 140 far for every car. Sedan,
  hatchback, SUV and minivan are the same 1,006-triangle mesh stretched. The
  semi has 1,606, the garbage truck 1,408. Near models draw within 180 m (112 m
  on Low), far ones to 1.5 km.
- **Keep passing:** `motiontest`, `scaletest`, `qualitytest`, `glcheck`,
  `shadercheck`, `nighttest`, `nightglow`, `treelod`, `impostortest`,
  `reflecttest`, `starttest`, `audiotest`, and the UI set (`tooltest`,
  `uisweep`, `tiptest`, `overlaptest`, `touchtest`). Check `perfTown.mjs` and
  `drawcalls.mjs` before and after.
- **Phone:** always check a phone context too:
  `{ viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true }`.
  Touch defaults to Low, which is what the owner plays on.

## The work, in order

1. **Car bodies (audit #7).** Rebuild the 19 kinds in `vehicleModels.ts` so
   each reads as what it is, at gameplay zoom and close up.
   - **Shape:** a side profile with wheel arches and a beltline, and glass
     split by A, B and C pillars with frames. Bumpers belong to the body.
     Lights are inset clusters (headlamps, taillight bars). Add a plate
     recess and mirrors on stalks.
   - **Wheels:** a tyre sidewall and a rim with spokes, sized to the body.
     Today's plain discs read as oversized.
   - **Distinct silhouettes:**
     - sedan: three boxes
     - hatchback: two boxes
     - SUV: tall two boxes with roof rails
     - minivan: one box with the sliding-door line
     - pickup: cab and a bed with rails and a tailgate
     - lifted truck: lift, mud tyres, light bar
     - sheriff: a Crown-Vic-style car with a push bar
     - semi: sleeper cab and trailer
     - fire truck: ladder
     - VW bus: split screen
     - motorcycle: with a rider
     - the rest in the same spirit
   - **LODs:** add a third, close LOD for the few cars within about 40 m. That
     is where the detail goes.
   - **Budgets:**
     - close: about 2,500 triangles (5,000 for trucks and buses)
     - near (40–180 m): about 1,000, today's cost
     - far: 200 or fewer
     - still one draw call per kind per LOD (instancing unchanged)

   Done when:
   - the lineup captures show every kind distinct at 40 m;
   - `drawcalls.mjs` shows no new calls beyond the LOD you add;
   - `perfTown` frame time on Low is within 5%;
   - `motiontest` and `scaletest` pass.
2. **Paint (audit #9).**
   - Use a real US paint mix: about three-quarters white, black, grey and
     silver; then blue and red; satire colours as accents.
   - Vary the finish: metallic, solid, matte (the Cyberslop's stainless).
   - Vary age and dirt per car: a faded roof, a primer panel or a mismatched
     door on beaters, mud on lifted trucks.
   - Keep the fixed liveries (sheriff, ambulance, fire, bus, garbage).
   - Rain wetness (`uWet`) keeps working.
3. **Night (audit #8).**
   - Headlights that light the road ahead: an instanced additive pool or
     beam per car, or cars written into a small light texture around the
     camera. It should cost no draw call per car, and 2 or fewer new calls in
     all.
   - Taillights visible from behind, brightening under braking.
   - Reverse lights (for backing out of parking spots).
   - Turn signals readable at gameplay zoom.
   - Emergency light bars that tint what's near them.

   Done when:
   - night captures show pools ahead of moving cars;
   - `nighttest` still passes (roads, facades, nothing blown out);
   - the day capture is unchanged.
4. **Motion you can see, without changing the sim.**
   - Suspension settles and bobs over junction joins.
   - Check wheel spin matches speed; it's in the shader today.
   - Exhaust puffs pulling away on cold mornings, dust on gravel, spray in
     rain.
   - Parked cars sit still, lights off, wheels stopped (`setParked`).
5. **People.** Give the pedestrian models and walk animation the same
   treatment:
   - silhouettes that read as the cast (archetypes in `people.ts`; don't
     change their text);
   - a walk cycle, and idle poses for people in yards.
6. **Low preset, the owner's phone (audit #11).**
   - The glass towers read as black monoliths at noon on Low.
   - Then run the lookbook on Low and fix what reads worst, day and night.
7. **Street sound (audit #10).**
   - Pass-bys come from real cars near the camera, with Doppler.
   - Engines differ by kind: semi, motorcycle, lifted truck, the Cyberslop's
     hum.
   - Honks come from cars actually waiting in a jam (`traffic.stats()`
     / `sigWhy`).
   - Sirens follow moving emergency vehicles.
   - Tyres hiss in rain.

   Everything stays procedural (WebAudio, nothing downloaded), and
   `audiotest` passes.
8. **Junction mouths (audit #12).** Four-way stops have very wide asphalt
   mouths. Compare with real references. Tighten the corner radii in the road
   section if it holds up at every junction angle; `junctiontest` passes.

## Finishing

- Merge the latest `origin/claude/festive-bohr-nugn55`. Run the full graphics
  and UI test list on a snapshot of your final code. Every test passes, or you
  say exactly which one fails and why.
- `npm run build:single`. Check the bundle has no API keys and no `typesafe`.
  **Don't publish to the main game link** this time. If you can publish, put
  your build up as a new artifact for the owner to try on their phone.
- Report plainly:
  - your branch name;
  - what changed, with before/after numbers (triangles, calls, frame time on
    Low) and a before/after image pair per item;
  - what you didn't get to;
  - anything you found in the traffic pass's files.
