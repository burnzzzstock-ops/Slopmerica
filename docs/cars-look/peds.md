# People: models, walk cycle, idles (helper `peds`, HANDOFF_CARS_LOOK item 5)

Branch `wt/peds`. Files touched: `src/agents/models/person*.ts` (the model, its shader, its looks table),
`src/agents/people.ts` (look fields of the cast only), the dev lineup page `src/dev/people.ts` + `dev/people.html`,
and the scripts `peoplelineup.mjs`, `peoplestats.mjs`, `peoplecost.mjs`. Nothing else: `pedestrians.ts`, `traffic.ts`,
`src/sim`, saves, README, package.json are untouched. The renderer contract is unchanged (`add`, `set`, `remove`,
`pick`, `flush`, `setNight`, `updateLod`, `dispose`).

## What was wrong with the old people (measured, not guessed)

| | old code | how it was measured |
|---|---|---|
| shape | 11 boxes and cylinders (torso, head, 2 x 2 arm, 2 x 2 leg), everything else a tinted box: a capsule with a hat | `scripts/peoplestats.mjs`, `docs/screenshots/cars-look/peds-8m-before.jpg` |
| triangles a person shows (near) | mean 429, max 532 (geometry: 3588 vertices, not indexed, 1196 triangles) | `peoplestats.mjs` |
| far figure | 92 triangles, one silhouette for everyone | same |
| feet | soles float 3.2 to 6.5 cm above the pavement while walking and running; **both feet are off the ground 23 to 71 % of the time** | GPU probe (`peoplelineup.mjs feet`), `shots/people/before/feet.json` |
| foot slide | a foot that is on the ground moves at 123 to 161 % of the ground speed (walking) and 139 to 157 % (running), depending on the band | same probe |
| walk | `sin(t)` per limb, fixed swing angle, calf bend on one half cycle, no pelvis or chest rotation, no foot roll, bob = `abs(cos)`; the swing does not depend on how much ground a step covers | `git show c8209d1:src/agents/models/personModel.ts` |
| lighting | normals were not rotated with the limbs, so bent arms and legs lit as if straight | code |
| attributes | 16 vertex attributes, exactly the WebGL2 minimum, no room for anything new per person | code |
| picking | `pick()` ray-cast the whole rest-pose merged mesh (every hat, every prop of every instance at once) | code |
| idle | one breathing sway for everybody | code |

Also found, not mine to change: the game never calls `PeopleRenderer.updateLod` (the near/far switch stays at the default distance),
and the sitting action (`sit`) had no seat, so people sat on air (the renderer now puts a crate under them, see below).

## What changed

### Silhouettes (`personGeo.ts`, `personLooks.ts`)
* Body lofted from rings instead of boxes: head (5 rings) with neck, nose and a face patch, shoulders and chest with a waist,
  pelvis, tapered arms with hands, thighs and calves with knees, shoes with a sole, all indexed. Head scale, shoulder width,
  belly, limb thickness and height differ per archetype (`build`, 6 body types incl. the new `kid`).
* Hair: cap, long, ponytail, mullet, bun, mohawk, bob, curls, balding (fringe only), pigtails, beard.
* Hats and head gear: ballcap (with brim), beanie, hard hat, foil cone, sun hat, cowboy, flat cap, visor, helmet, headphones, headband,
  flowers, hood up, shades on the head.
* Clothes: tee, hoodie, suit (lapels, shirt V, tie), vest, tank, flannel, overalls, robe, jersey, workwear, raincoat, polo, hawaiian,
  dress, track suit; jackets, coats with belt, aprons, pouches, badges and lanyards, boots, long skirts, hi-vis stripes, sashes.
* Bags: backpack, big pack, delivery box, messenger bag, tote, fanny pack, tool belt, chair bag, camera.
* Props in the hand (chosen by the action or the archetype): cigarette, beer, vape, phone, sign on a pole, drum, tumbler, briefcase,
  clipboard, laptop, skateboard, cane, paddle, basket, leaf blower, sparkler, tube, coffee, ruler, flag; a crate as seat.
* Painting in the fragment shader from the rest-pose position (no textures, no extra geometry): shirt, pants and outer patterns
  (stripes, plaid, hi-vis, camo, pinstripe, tie-dye, dots ...), collars, pockets, zips, shoe styles (sneakers, dress shoes, boots,
  sandals, barefoot), cardboard sign text bars, face atlas (12 faces) sampled with the person's own tint.
* All 69 archetypes have their own palette, build, walk style, idle habit and 0 to 5 pieces of gear (`people.ts`). Names,
  handles, bios, lean, vices, `hippie`, `merch`, `nightOwl`, `civicRegular` are byte-identical to before (checked by comparing
  the two modules, 0 text or behaviour differences). Look-field changes to existing archetypes (29): e.g. Florida Man broad ->
  stocky, Developer Chad and Zoning Lawyer carry a briefcase, HOA President Deb a clipboard, Retired Engineer a rolled plan,
  Code Enforcer a ruler, Roadside Philosopher a cane, Pickleball Retiree a paddle, Leaf-Blower Enthusiast a blower, Skater a
  skateboard, Trad Wife a dress, Beach Bro a hawaiian shirt, Brainrot Kid the `kid` body. Nobody was renamed.

### Motion (`personShader.ts`)
* **Walk**: a foot has a stance and a swing. In stance the heel strikes, the foot rolls flat and then rolls onto the toe while the
  pelvis moves on; the planted point travels back at exactly the ground speed (the game feeds the leg phase as ground / `STRIDE`, and
  the person's own stride length `Lp` is tied to leg length, so the foot does not skate). Swing: the foot lifts (clearance per
  walk style) and reaches the next heel strike. Legs are two-bone IK (hip, knee, ankle) so knees bend, hips drop and the pelvis
  height comes from the reach of the legs, with the vertical bob a result of that, not a sine on top.
* Arms swing opposite to the legs, elbows bend more as the swing grows, pelvis and chest counter-rotate, the head stays level,
  shoulders roll. Eight walk styles (normal, stiff, slouch, bouncy, swagger, elder, strut, kid) change stride, arm swing, twist, lean
  and foot clearance. Carried props (briefcase, cane, coffee, phone ...) have their own arm pose while walking.
* **Run**: its own cycle (flight phase, higher knee lift, forward lean, bent elbows), same planting rule.
* **Idle**: eight habits (arms hanging, pockets, crossed, hands on hips, behind the back, clasped, loose, one pocket); slow weight
  shift from one leg to the other, chest breathing, head looks around, a stance width and foot angle per person.
* The other 12 actions (smoke, drink, vape, phone, protest, dance, drum, yoga, sit, lie, fight) have poses of their own with
  two-bone arms and legs; hems (coats, robes, skirts) and hanging hair sway.
* Lighting normals are rotated with the bones.

### Rendering
* Still instanced: **2 draw calls** (near, far) in the `people-aa` group, one merged indexed geometry per level of detail.
  14 vertex attributes (was 16). Shadows use a depth material running the same vertex code.
* Per-instance data are packed into floats (colours as sRGB24, feature masks 24 bits a word, small integers in bit fields), all exact
  below 2^24.
* Pieces a person does not wear collapse to a point and the vertex shader returns before the pose maths (they are dropped as
  degenerate triangles), so the cost of a person is the pieces he shows.
* `pick()` now ray-casts a static column proxy that shares the instance matrices; a click hits a person, not the ghost of every
  hat.
* `PED_STRIDE` (in `personShader.ts`) must stay equal to `STRIDE` in `pedestrians.ts` (1.42 m walking, 2.2 m running): the
  renderer only scales the phase by a per-person cadence factor, it does not change the ground speed.

## Numbers

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


## Pictures

Same camera, old code (`before`) against the new one (`after`), captured by `scripts/peoplelineup.mjs` on the dev page
(no game): `docs/screenshots/cars-look/peds-<item>-before.jpg` / `-after.jpg` with the items

* `8m` and `8m-night`: 8 archetypes side by side at 8 m, day and night
* `30m`: the whole cast at 30 m
* `100m-zoom` and `100m-night-zoom`: the whole cast at 100 m (the real pixels, cut out and enlarged 4x without smoothing)
* `walk`, `run`: one full leg cycle in twelve frames, side view, the pavement joints stand still (a planted foot stays on its joint)
* `idle`: twelve people standing
* `actions`: one person in all 14 actions
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

## Not done / limits

* No close LOD (the near figure is the only one below 64 m; the budget did not need a third one).
* Actions do not blend into each other: when the sim changes a person's action the pose switches (as before).
* The elder walk shuffles: the foot skims the pavement in swing, so the probe counts part of the swing as "on the ground"
  (p95 96 % in the 1.2 cm band); the mean is 9 %.
* The near/far switch is still the fixed default distance because the game never calls `updateLod`; that is in code I do not own.
* The 100 m figure is a 2.5x heavier far model than before (232 against 92 triangles shown) so it keeps a hat, a bag and a sign; see the cost table.

## New scripts (README lines)

* `scripts/peoplelineup.mjs`: capture every archetype on the no-game lineup page (`/dev/people.html`) at 8, 30 and 100 m by day and night,
  walk, run, idle and action sheets, and run the GPU foot probe (`feet`) with OK/FAIL lines.
* `scripts/peoplestats.mjs`: vertices and triangles per level of detail and per archetype (`--all`), no browser.
* `scripts/peoplecost.mjs`: draw calls, triangles and milliseconds the people group costs in the saved reference block.
