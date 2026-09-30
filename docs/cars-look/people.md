# People (HANDOFF_CARS_LOOK item 5), short version

Branch `wt/peds`. The full report, with the findings on the old model, is `docs/cars-look/peds.md`.

**What changed.** The citizens are no longer tinted boxes. `src/agents/models/personGeo.ts` builds a lofted body (head, neck, chest,
pelvis, tapered limbs, hands, shoes) with 3-D hair, 14 hats and head gears, jackets, coats, bags and about 20 hand props; the
fragment shader in `personShader.ts` paints cloth patterns, collars, pockets, shoe styles and hi-vis stripes from the rest-pose
position; `personLooks.ts` turns each archetype's look fields in `people.ts` into per-instance data. The vertex shader poses a
skeleton: a walk with heel strike, foot roll and a planted foot (the leg phase is ground / `STRIDE`, and each person's stride is tied
to leg length), swing arc, knee bend by two-bone IK, opposite arm swing, pelvis/chest counter-rotation, bob from leg reach; a run
cycle with a flight phase; eight walk styles; eight idle habits with weight shift and head look-arounds; a pose for each of the
14 actions. Still 2 draw calls (`people-aa`: near + far), 14 vertex attributes (was 16). Names, bios and behaviour fields of the cast
are unchanged; 29 look fields (body, outfit, hair, hat, prop) of existing archetypes were changed. Pedestrian movement
(`pedestrians.ts`) is untouched.

## Numbers (old -> new)

{{NUMBERS}}

## Pictures (same camera, `docs/screenshots/cars-look/peds-<item>-before.jpg` / `-after.jpg`)

`8m`, `8m-night`, `30m`, `100m-zoom`, `100m-night-zoom`, `walk`, `run`, `idle`, `actions` (18 JPEGs, 1.6 MB).
{{STREET_PICTURES}}

## Tests

{{TESTS}}

## README lines for the new scripts (README.md itself is not edited here)

* `scripts/peoplelineup.mjs`: every archetype on the no-game lineup page (`/dev/people.html`) at 8, 30 and 100 m by day and night, walk, run,
  idle and action sheets; `feet` runs the GPU foot probe and prints OK/FAIL lines (env `BASE_URL`, `OUT`, `JPEG=1`).
* `scripts/peoplestats.mjs`: vertices and triangles per level of detail and per archetype (`--all`), no browser; run it in the old tree to compare.
* `scripts/peoplecost.mjs`: draw calls, triangles and milliseconds the people group costs in the saved reference block, close and at play height.

## Limits

No close LOD and no blending between actions. The near/far switch moved from 72 m to 64 m to pay for the heavier near figure (the game
never calls `updateLod`, so it stays at that default). `PED_STRIDE` in `personShader.ts` must stay equal to `STRIDE` in `pedestrians.ts`.
