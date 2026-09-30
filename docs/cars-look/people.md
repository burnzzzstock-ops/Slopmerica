# People (HANDOFF_CARS_LOOK item 5), short version

Branch `wt/peds`. The full report, with the findings on the old model, is `docs/cars-look/peds.md`.

**What changed.** The citizens are no longer tinted boxes. `src/agents/models/personGeo.ts` builds a lofted body (head, neck, chest,
pelvis, tapered limbs, hands, shoes) with 3-D hair, 14 hats and head gears, jackets, coats, bags and about 20 hand props; the
fragment shader in `personShader.ts` paints cloth patterns, collars, pockets, shoe styles and hi-vis stripes from the rest-pose
position; `personLooks.ts` turns each archetype's look fields in `people.ts` into per-instance data. The vertex shader poses a
skeleton: a walk with heel strike, foot roll and a planted foot (the leg phase is ground / `STRIDE`, and each person's stride is tied
to leg length), swing arc, knee bend by two-bone IK, opposite arm swing, pelvis/chest counter-rotation, bob from leg reach; a run
cycle with a flight phase; eight walk styles; eight idle habits with weight shift and head look-arounds; a pose for each of the
14 actions. Still instanced, 2 draw calls for the figures (`people-aa`: near + far) plus one pose draw for the whole population, 9 vertex attributes (was 16). Names, bios and behaviour fields of the cast
are unchanged; 29 look fields (body, outfit, hair, hat, prop) of existing archetypes were changed. Pedestrian movement
(`pedestrians.ts`) is untouched.

## Numbers (old -> new)

| | old | new |
|---|---|---|
| triangles a person shows, near (mean / max) | 429 / 532 | 768 / 958 (1.79x / 1.80x, budget 2x) |
| triangles a person shows, far | 92 | 210 (max 243) |
| geometry held per level (near / far) | 1196 / 92 triangles | 3117 / 497 triangles (indexed: 3464 / 679 vertices, was 3588 / 276) |
| vertex attributes | 16 (the WebGL2 minimum) | 9 (per-person data in a 6 x N float texture) |
| draw calls, `people-aa` | 2 (+1 near again in the shadow pass) = 3 | 2 (+1 far in the shadow pass) = 3, plus one pose draw for the whole population |
| feet on the ground, GPU probe, 7 archetypes walking and running | soles 3.2 to 6.5 cm above the pavement; a foot on the ground moves at 144 to 161 % of the ground speed; both feet off the ground 23 to 48 % (walk), 67 to 71 % (run) | soles 0.3 to 0.4 cm below the pavement line (on it); mean slide 1.4 to 5.6 % of the ground speed, elder shuffle 9.1 %; never airborne walking, 4 to 19 % running (a real flight phase) |
| foot-slide check (`peoplelineup.mjs feet`) | FAIL (161 %, floats 6.5 cm) | OK (worst mean 9.1 %, sole 0.44 cm) |

People group cost on the software GPU, `peoplelineup.mjs bench` (only the pavement, the sun's shadow map and 120 people, the group shown
against hidden in alternation, 640 x 360; 120 is the Low preset's `maxPeople`), milliseconds per frame for the group alone:

| crowd | old | first new version | new |
|---|---|---|---|
| 120 people all within 64 m (worst case) | 603 | 2857 | 1284 |
| 120 people all beyond 150 m | 614 | 2612 | 155 |
| 40 near + 80 far (a street) | 517 | 2780 | 465 |

What it took (each step measured): the skeleton is worked out once per person and bone in a pose pass instead of per vertex; the per-person
data moved from 14 vertex attributes and 27 floats of varyings into a texture; the near figure (3.7x the far one's triangles) is drawn only
for people within 64 m (+10 %) of a camera the figure was drawn from; the far figure casts the shadows and lost 40 % of its triangles.
On this box the cost is set by the number of triangles submitted (about 2.6 us each, drawn or not), not by what the shaders do with them.

In the game's reference block on Low (`peoplecost.mjs low`, 53 to 60 people): 3 draw calls for the group, old and new; triangles the group
sends: 161 k -> 192 k close (24 m), 162 k -> 165 k from the usual play height (60 m). The frame-time difference of the group is inside the
noise of a 4.5 s software frame there (+/- 1 s), so the bench above is the number to read: in a street mix the group costs less than
before (465 against 517 ms), with everybody near it costs 2.1 times as much (1284 against 603 ms) - on a real GPU both are far below a frame.


## Pictures (same camera, `docs/screenshots/cars-look/peds-<item>-before.jpg` / `-after.jpg`)

`8m`, `8m-night`, `30m`, `100m-zoom`, `100m-night-zoom`, `walk`, `run`, `idle`, `actions` (18 JPEGs, 1.6 MB).
* `street-...`: not taken (the in-game shots of `peoplecost.mjs` were not needed for the pairs)
* `lod-switch-after`: the near/far switch, 13 people from 50 to 80 m (no before: the old code had no compaction)

## Tests

Run on the final code (a frozen snapshot on port 5181, single jobs through `/home/user/slopmerica/scripts/withslot.sh`):

* `npx tsc --noEmit`: clean. `node scripts/shadercheck.mjs`: OK. glslangValidator (GLSL ES 3.00) on the near vertex, near fragment, shadow
  vertex and pose vertex/fragment shaders, both variants (pose textures, and per-vertex pose without float render targets): OK.
* `peoplelineup.mjs feet`: OK (see the table). `peoplelineup.mjs lod`: 13 people every 2.5 m from 50 to 80 m all drawn across the switch.
* `motiontest.mjs`: every check OK on the new code (walkers' legs 0.704 cycles per metre, 0 teleports in 6430 steps); one earlier run met no walking pedestrian in its window (0 steps, so its two walker checks had nothing to measure) and the rerun measured them. `scaletest.mjs`: every check OK. The only FAIL in both, and identically against the old code, is "no page errors": the Vite client of my frozen snapshot server logs `WebSocket closed without opened`; it is the harness, not the game.
* Not run (the final run is the lead's): qualitytest, glcheck, nighttest, nightglow, treelod, impostortest, reflecttest, starttest,
  audiotest, junctiontest, tooltest, uisweep, tiptest, overlaptest, touchtest. None of them refers to the people renderer; what could
  break them is a shader that fails to compile or a GL error, which glslang, the lineup page and the game runs above rule out on
  SwiftShader (no errors logged). `drawcalls.mjs` / `perfTown.mjs` were not run: `peoplecost.mjs` and `bench` measure the group itself.

## README lines for the new scripts (README.md itself is not edited here)

* `scripts/peoplelineup.mjs`: every archetype on the no-game lineup page (`/dev/people.html`) at 8, 30 and 100 m by day and night, walk, run,
  idle and action sheets, the near/far switch (`lod`); `feet` runs the GPU foot probe and prints OK/FAIL lines, `bench` times a crowd of
  120 with the group shown and hidden (env `BASE_URL`, `OUT`, `JPEG=1`, `W`/`H`, `BREAKDOWN=1`).
* `scripts/peoplestats.mjs`: vertices and triangles per level of detail and per archetype (`--all`), no browser; run it in the old tree to compare.
* `scripts/peoplecost.mjs`: draw calls, triangles and milliseconds the people group costs in the saved reference block, close and at play height.

## Limits

* No close LOD and no blending between actions. The near/far switch moved from 72 m to 64 m (the game never calls `updateLod`).
* Everybody within 64 m on the near figure costs 2.1x the old group on the software GPU (1284 against 603 ms for 120); a street mix costs less.
  The near figure's union of all hats, hair, bags and props (3117 triangles, 768 shown) is what remains to trim if that case matters.
* Who is on the near figure is decided from the cameras the figure was drawn from in the previous frame (the main camera, the water mirror):
  one frame late, with a 10 % overlap so nobody falls between the two figures. Without float render targets (`EXT_color_buffer_float`) the
  vertex shader works the pose out per vertex, as before the pose pass (about 2x the cost; not measured on a device).
* `PED_STRIDE` in `personShader.ts` must stay equal to `STRIDE` in `pedestrians.ts`.
