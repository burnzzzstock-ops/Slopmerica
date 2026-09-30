# Cars that look real, night light, street sound, and a polish pass: report

Branch: **`claude/vibrant-mendel-309l5y`**, based on the tip of `claude/festive-bohr-nugn55` (merged four times, the last one after the
final tests had started; nothing pushed anywhere else, no pull request opened). Handoff: `docs/HANDOFF_CARS_LOOK.md`.

Numbers about the picture (draw calls, triangles, frame time, brightness) were measured on the same saved reference block
(`shots/lookbook/town.json`), with the same cameras, on the frozen old code (the tip of `claude/festive-bohr-nugn55` before this pass)
and on the final code; the model, paint and sound numbers come from the offline tests named beside them. The timings are from the
software GPU in this container (SwiftShader), so they say "more or less than before", not "frames per second on an iPhone".
Before/after pictures are in `docs/screenshots/cars-look/` (`*-before.jpg` / `*-after.jpg`). Longer write-ups by area:
[`cars-look/audio.md`](cars-look/audio.md), [`cars-look/night.md`](cars-look/night.md),
[`cars-look/junction.md`](cars-look/junction.md), [`cars-look/towers.md`](cars-look/towers.md),
[`cars-look/people.md`](cars-look/people.md) (short) and [`cars-look/peds.md`](cars-look/peds.md) (long).

## The short version

| Item | Result |
| --- | --- |
| Yellow flashing on Ultra | Found: prop flames (burn barrels, dumpster and tyre fires, flare stacks) were HDR fire puffs that popped in at full brightness and blinked. Fixed; a new check fails on the old code (3 of 4 cases) and passes on the new. |
| Warm night | Lamp pools, street lamp heads and lit windows are sodium, incandescent and amber. Colour temperature of the practical light 5032 K to 3830 K. `nighttest` still passes. |
| Vehicles | 19 models rebuilt and 40 added (59), each with a close, a near and a far level. Real paint mix with wear and dirt. Headlights that light the road, tail, brake, reverse and turn lamps, siren tint. Suspension, exhaust, dust and rain spray. |
| People | New citizen model (lofted body, hair, 14 hats, coats, bags, about 20 hand props), a gait with planted feet, eight idle habits, a pose for each of the 14 actions. |
| Low preset | The black towers now read as glass. Low gets the weather grade it never had and a fill for shaded walls. |
| Street sound | Voices sit on real cars: Doppler pass-bys, engines by vehicle kind, honks only from jams, sirens that follow the moving vehicle, wet-road hiss. |
| Junction mouths | Kerb radius 5.0 m to 3.0 m between two-lane streets, and the zebra and stop bar now sit where cars actually stop. The cars did not move (hash-identical network). |

Cost, old to new, Low preset, side by side in two pages of the same browser (frame time is the geometric mean over the three
lookbook cameras; draw calls and triangles are the renderer's counters for one frame):

| | Old | New |
| --- | --- | --- |
| Draw calls, one frame, Low (overview / street / houses / shore) | 175 / 226 / 173 / 184 | 165 / 189 / 163 / 174 |
| Draw calls, High | 417 / 349 / 410 / 436 | 393 / 313 / 390 / 416 |
| Triangles drawn, Low | 908,017 / 858,429 / 846,319 / 782,994 | 894,505 / 841,813 / 826,155 / 764,482 |
| Triangles drawn, High | 2,127,845 / 1,207,585 / 1,993,347 / 1,931,643 | 2,104,353 / 1,228,317 / 1,958,922 / 1,887,328 |
| Vehicle calls / thousand triangles in view, Low | 20/2, 62/37, 20/12, 20/12 | 11/18, 26/50, 11/22, 11/22 |
| People calls / thousand triangles in view, Low | 3/20, 3/30, 3/30, 3/30 | 2/9, 2/13, 2/13, 3/20 |
| Frame time, Low, noon, desktop (overview 0.951, street 1.038, houses 0.999) | 1.000 | **0.995 (-0.5%)** |
| Frame time, Low, noon, phone 390x780 at 3x touch (0.988, 0.940, 0.984) | 1.000 | **0.971 (-2.9%)** |
| Frame time, Low, 23:00, desktop | 1.000 | **1.031 (+3.1%)** |
| Frame time, High, noon, desktop | 1.000 | **0.995 (-0.5%)** |

The whole-frame counts include the merged junction, people and tower work; the vehicle rows are the renderer alone (the models have
more triangles, in fewer calls). The 5% bar for Low frame time holds on every context measured. These are `drawcalls.mjs` (calls and
triangles) and `lowperf.mjs` (frame time, old and new in two pages of one browser, alternating frames, so the load of the box hits both
alike; 9 frames per camera and build) on the software GPU.

## 1. Yellow flashing on Ultra, and the warm night (the owner's two decisions)

See [`cars-look/night.md`](cars-look/night.md). Reproduced on Ultra, still and panning, moonless and full moon, clear and rain.
Each prop flame is an HDR `fire` particle puff 3 m across. It popped in at full brightness, was lifted 1.85x by the night
exposure (it was not divided by `GLOW` like every other light) and bloomed; its emitter also skipped half of its 0.6 s ticks, so
every flame blinked on and off. Hiding only that particle pool took the still case from 9.6 to 0.2 flash pixels a frame; the
flashes sit on the fire emitters of Sweet Trouble, Loyalty Lab and Propane Paradise. It is not Ultra only (Medium and High
share the bloom); Ultra is where the owner plays.

Fix: fire and spark particles are divided by `GLOW`, a puff grows in over the first fifth of its life, and prop flames emit
every tick at 0.6 size. Fireflies were never the flash, but they are now also divided by `GLOW` and kept off lamp-lit ground.

New check `scripts/yellowflash.mjs` (Ultra, 640x360, reference block): counts bright saturated yellow pixels that appear from
one frame to the next. Flash pixels per frame, mean / worst frame:

| Case | Old | New |
| --- | --- | --- |
| Still camera, moonless | 9.6 / 106 | 1.7 / 16 |
| Pan, moonless | 4.0 / 105 | 1.6 / 21 |
| Pan, full moon | 6.2 / 170 | 2.1 / 25 |
| Pan, rain | 0.4 / 5 | 1.4 / 17 (the old run happened to miss a flame tick) |

Limits: mean at most 4, worst frame at most 40. Old FAILS three cases, new passes all, with 0 GL errors and 0 failed shader
builds. Pictures: `night-yellowflash-before/after.jpg`.

**Warm night.** The pool colours in `nightLights.ts` were linear light written as if they were sRGB, so "sodium" pools came
out pale cream and the yard floods a cold 6500 K blue. Pools are now sodium, incandescent, warm-white LED and amber
(`POOL_GAIN` 1.85 to 2.25 to keep the roads readable), street lamp heads are sodium orange, lit windows are amber and warm
white with 6% blue TV. Signs keep their brand colours. New `scripts/nightwarmth.mjs` measures the colour of the light itself
(each frame minus the same frame with the lights off): 5032 K to 3830 K over six frames. `nighttest`, moonless / full moon /
rain: road median 91 / 83 / 70 to 87 / 76 / 67 (target 50), pools p90 163 / 157 / 131 to 158 / 150 / 127 (target 100), blown
out 0.03% to 0.01% (target under 1%). Pictures: `night-warm-{moonless,fullmoon}-{overview,street,houses}-before/after.jpg`.

## 2. Vehicles

### 2.1 Models: 19 to 59, three levels of detail

Every vehicle kind keeps its own model and gets extra variants (sedan 5, pickup 5, hatchback 3, SUV 3, semi 3, box truck 3,
minivan 2, lifted truck 2, slop van 2, motorcycle 2, fire truck 2, garbage truck 2, and one each for police, ambulance, golf cart,
VW bus, tow truck and city bus): 40 extra, 59 in all. `VEHICLE_SPECS` sizes and the simulation are untouched; a model may
stick out of its kind's box only by mirrors, a rider and a few accessories (`vehicletest` checks it).

| | Old (19 kinds) | New (59 models) |
| --- | --- | --- |
| Close level (within 46 m, 36 m on Low; built on demand, one model per frame) | none | 136,714 triangles in all, 2,317 on average (budget 2,500; 5,000 for trucks and buses) |
| Near level (to 180 m, 112 m on Low) | 19,906 in all, 1,048 on average | 54,578 in all, 925 on average |
| Far level (one silhouette per kind, to 1,500 m, 930 m on Low) | 2,720 in all, 143 on average | 11,346 in all, 192 on average |
| Draw calls, 100-car town (`vehicletest`, no browser) | 42 | 29 (6 for the close-range models, and the whole effects layer is one call) |
| Start-up, building the meshes of the 19 kinds (Node) | 93 ms | 92 ms |

Bodies are lofted from a side profile with real wheel arches and a crisp dark trim edge, with a greenhouse of pillars, roof and
inset glass panes; wheels have hubs, spokes and tyre tread by vehicle type. Every joke vehicle is still a joke (Cyberslop is
angular stainless, the lifted truck is absurd, sign text and brand names are unchanged). Old bugs found and fixed on the way:
the old wheel shader turned tyres the wrong way in both spin and steer (a test now proves the direction), and the decal atlas
clipped the words on the ambulance and sheriff cars.

Pictures (one contact sheet each, all models): `cars-bodies-40m-day`, `cars-bodies-8m-day`, `cars-bodies-40m-night`,
`cars-far-150m-day`. In the game: `cars-game-{sedan,pickup}-{moving,queue,junction}-{day,night}`, `cars-game-rain-*`,
`cars-game-low-*`, `cars-game-phone-*`.

### 2.2 Paint, dirt and age

Weighted like the real US fleet: `vehicletest` over 20,000 cars: white, black, grey or silver 73% (old palette: 7 of 14
colours, 50%), blue and red 19%, accents 8%. Finishes: solid 38%, metallic 52%, matte 8%, pearl 2%. About one car in six is a
beater (16%): faded roof, rust, a primer panel or another car's door (12%). Mud only on pickups and lifted trucks. The
traffic pass still asks for one of its 14 colours; the renderer treats that as a request and draws from the weighted mix, and
choosing a paint never draws from `Math.random` (the simulation's random stream is untouched: tested). Pictures:
`cars-paint-sedan`, `cars-paint-pickup` (14 cars each, same camera).

### 2.3 Lights

Headlights add a soft-edged pool on the road ahead (17 m, following the slope the car stands on), tail lamps glow, brake
lamps flare and light the road behind, turn signals blink, reverse lamps come on by themselves when a car backs up along its
own nose (and via the optional `setReversing`), emergency vehicles tint the road with their siren colour. All of it is one
extra draw call for the whole town (halos, pools and ground discs are instanced billboards in a single mesh). `nighttest`
passes with the same numbers as on the old code (road median 91 / 83 / 71, target 50; nothing blows out). A dark car at night
gets a thin sky-glow rim so a black car still reads. Pictures: `cars-game-*-night`, `cars-lights-rear-night` (brake and turn),
`cars-lights-siren-night` (police and fire truck).

### 2.4 Suspension, exhaust, dust and rain spray

Purely visual; `VehicleRenderer.set` has the same signature and the simulation is not touched. The body sits on a damped spring
driven by the road height under it: a 6 cm step in the road moves the body 2.2 cm at the peak and it settles to 0.0 mm within
4 s (`vehicletest`). Exhaust puffs show in the cold (below about 11 C; heavy diesels launching throw dark soot), dust rises
behind wheels on gravel roads (the game gives the renderer a `surfaceAt` callback), and rain throws spray off the tyres. Parked
cars (the traffic pass's live parking calls `setParked`) sit still with their lamps off and their wheels not turning.

### 2.5 API

The public methods are unchanged (`add`, `remove`, `set`, `setBraking`, `setTurn`, `setDamaged`, `setNight`, `updateLod`,
`flush`, `pick`, `stats`, `dispose`; `vehicletest` checks the list). Added, all optional and commented: `add(kind, color,
{variant, exact, seed})`, `setParked`, `setReversing`, `setHeadlights`, `setSiren`, `setEnvironment`, `setLodOverride`, and the
`surfaceAt` property.

## 3. People

See [`cars-look/people.md`](cars-look/people.md) and [`cars-look/peds.md`](cars-look/peds.md). The citizens were tinted
boxes. They are now lofted bodies (head, neck, chest, pelvis, tapered limbs, hands, shoes) with 3-D hair, 14 hats and head
gears, jackets, coats, bags and about 20 hand props, painted in the fragment shader (cloth patterns, collars, pockets, hi-vis
stripes). A skeleton in the vertex shader gives a walk with heel strike and a planted foot, a run with a flight phase, eight
walk styles, eight idle habits and a pose for each of the 14 actions. All 69 archetypes have their own look data; names, bios
and behaviour fields are byte-identical (checked), and pedestrian movement is untouched.

Old to new: GPU foot probe (7 archetypes, walk and run): soles 3.2 to 6.5 cm above the pavement, now on it; a foot on the
ground moved at 144 to 161% of ground speed, now 1.4 to 5.6% (the elder's shuffle 9.1%); both feet off the ground in 23 to 71%
of frames while walking, now 0%. Triangles per person near 429 mean, now 768 (budget 2x); far 92 to 210. Draw calls: people group 3, 3,
plus one pose draw for the whole population. Crowd cost on the software GPU (`peoplelineup.mjs bench`, 120 people = Low
`maxPeople`), ms a frame old to new: all near 603 to 1284 (2.1x, the worst case), all far 614 to 155, a street with 40 near and 80
far 517 to 465. Pictures: `peds-*` (8 m, 30 m, 100 m, night, walk, run, idle, actions, near/far switch).

## 4. Low preset (what the owner plays on)

See [`cars-look/towers.md`](cars-look/towers.md). The towers were painted near-black and the shader had nothing glass-like; Low
has no environment map and High's rough lobe shows almost nothing, so High was dark too. Glass tiles now carry a flag and the
building shader adds a fresnel sky reflection to those texels only: no new texture read, mesh or draw call. Mean luma of tower
walls, old to new (share of pixels under luma 20 in brackets): Low noon overview 37.6 to 59.9 (36.9% to 11.5%); Low phone (390x780
at 3x) noon overview 23.4 to 52.2 (54.5% to 17.9%), street 26.4 to 65.4 (42.8% to 3.4%); High noon overview 54.6 to 79.2. At night the
walls between the lit windows lift only a little (Low moonless overview 62.0 to 67.8) but the window rhythm holds.

The Low lookbook pass found that Low never applied the weather grade, so its night was olive and storms or heat were exposed like a
clear day (blue/red on a moonless night 0.840 against High's 1.003). `render/lowGrade.ts` puts the grade's exposure on the tone map
and its tint on the hemisphere light and sun/moon (0.958 now); shaded walls get a share of the hemisphere light. Every camera stays
within 0.03 mean luma of High. Pictures: `towers-glass{,-phone,-night,-high}`, `towers-low-night-grade`.

## 5. Street sound

See [`cars-look/audio.md`](cars-look/audio.md). All procedural WebAudio, nothing downloaded. A fixed voice pool (8 cars, 3 sirens,
4 horns; 4, 2 and 2 on Low) goes to the loudest real cars near the camera, re-picked 4 times a second and glided 16 times a second, with
no per-frame allocation. Old to new from the offline FFT test: the Cyberslop whine at 30 m/s has Doppler 2931 Hz approaching / 2465 Hz
receding (physical 2930 / 2464); the ambulance's two tones are 744.7 / 626.2 Hz (physical 744.4 / 625.9); 60 s of free flow 6 random
honks to 0, a 10-car queue 4 random honks to 12, all from queued cars; honks a minute for queues of 2 / 4 / 8 / 14: about 5 whatever the
queue, to 0 / 7 / 13.7 / 28.7; semi against motorcycle spectral centroid 460 / 1152 Hz (was the same bed); idle 4.9x quieter than
cruising; rain hiss +17 dB in rain, +12 dB on a wet road with no rain; worst-case crowd peaks at 0.74 after the limiter. Cost: 0.2 ms
median on the 4 Hz scan frame with 1,900 cars, about 0.03 ms otherwise; 0 audio nodes created while playing. Picture:
`audio-spectrograms-before/after.jpg`. **Nobody has listened to it**: the tests measure pitch, level, pan and timing, not taste; the
audition page is `dev/streetaudio.html`.

## 6. Junction mouths

See [`cars-look/junction.md`](cars-look/junction.md). Radius was only one of four causes. Kerb returns are now solved against the
cars' own turning curve (a car keeps at least 1.3 m of asphalt between its path and the kerb at every fillet); two-lane by two-lane at
90 degrees: kerb radius 5.0 m to 3.0 m, mouth 8.8 m to 6.8 m from the node, junction asphalt 231.7 to 156.8 m2; a tee 182.7 to 130.1; 75
degrees 249 to 203; 60 degrees 293 to 279; stroad by two-lane 392.7 to 333.9; the block's 20 two-lane four-ways 4,584 to 3,382 m2 in
all. The paint sat 6 to 12 m behind where the network stops a car (the stopped nose was on the zebra in 42 of 42 right-angle legs, and
the median stop bar was 6.7 m behind the nose): now 3 of 42 (by 0.1 m) and 0.69 m. Fixed along the way: the zebra strip was
double-drawn with seven transverse rungs, crosswalk lines and stop bars were unlit (blue at night), and a hull fallback left one node
with 84 empty spots. Road renderer: 26 meshes (19 instanced) old and new, no new draw call; instances 7,629 to 6,397, triangles 215,517
to 202,377. **The cars did not move**: `junctionmouth.mjs --compare` shows identical SHA-256s of every node, segment, trim and
junction curve control point, old against new. Pictures: `junction-*`.

## 7. Tests

The full graphics and UI list, plus the sim, traffic, transit, save and content checks from the README that need no key, ran on a snapshot of the
final code (the merge of `origin/claude/festive-bohr-nugn55` at a333c00 with this branch) with `scripts/snapshot.mjs`: **76 of 79 pass; 3 fail
(`playtestcheck`, `crosswalktest`, `landmarktest`), and each of those fails on the untouched base tip too** (run there on the same kind of snapshot). None of
the three touches anything this pass changed: `playtestcheck` is a broken-save rescue screen, `crosswalktest` and `landmarktest` are the traffic pass's
walkers and parking.

How the table was made: each test ran once on the snapshot and every failure was then re-run. Most first-run failures were my own test
servers: the frozen snapshot servers returned 403 for the font files under `node_modules` (a symlink out of the snapshot root), and every test that counts
console errors reported them. `scripts/snapshot.mjs` now serves them (`fs.strict` off) and the re-runs pass. The "Time" column is the last run, in
seconds, with two browsers running at once on a 4-core software GPU. Earlier rounds on snapshots of slightly older code (before the last base
merge, the review fixes and the exhaust tweak) also passed the same tests, including `nighttest`, `treelod`, `impostortest`, `reflecttest`, `starttest`, `nightglow`,
`qualitytest`, `glcheck`, `shadercheck` and the UI set (`tooltest`, `uisweep`, `tiptest`, `overlaptest`).

Not run: the scripts that ask the Jev model (`contentaudit`, `feedtags`, `nametags`, `learnability`, `brandcheck`, `triage`; they need a key and
this pass is offline), the measuring tools that are not pass/fail (`progression`, `playtest6-late`, `townshots`, `aacompare`, `lookbook`, `lineup`, `carcam`,
`towers`, `towerlab`, `lowperf`, `peoplelineup`, `junctionshots`, `junctionplan`, `nightwarmth`) and `perfTown` (it grows a different town every run; see the cost table).

| Test | Result | Time | Note |
| --- | --- | --- | --- |
| `vehicletest` | PASS | 452 s |  |
| `qualitytest` | PASS | 557 s |  |
| `glcheck` | PASS | 134 s |  |
| `motiontest` | PASS | 173 s |  |
| `carsolid` | PASS | 74 s | the traffic pass's own test; README says it fails in most runs on one residual (two cars from the two lanes of road 44 entering the box side by side). Failed on my first run here (one such pair), passed on re-run, and failed on the untouched base tip in both of my runs. |
| `nighttest` | PASS | 623 s |  |
| `playtestcheck` | **FAIL** | 440 s | **FAILS**: `broken save shows the rescue screen` (the other four checks pass). Fails the same way on the untouched base tip, on both snapshot servers. |
| `phonetargets` | PASS | 66 s | first run: 3 summary controls at 42 to 43 px (the base tip's first run failed the same three); passes on re-run. |
| `gesturetest` | PASS | 49 s |  |
| `inputtest` | PASS | 99 s |  |
| `svctouch` | PASS | 191 s |  |
| `widentest` | PASS | 57 s |  |
| `demandtest` | PASS | 201 s |  |
| `commandtest` | PASS | 61 s |  |
| `savecontinuity` | PASS | 98 s |  |
| `nantest` | PASS | 150 s |  |
| `ledgertest` | PASS | 140 s |  |
| `moneyedge` | PASS | 62 s | first run: 3 console 403s from my snapshot server (font files), fixed in `scripts/snapshot.mjs`; every functional check passed both times. |
| `roadrules` | PASS | 58 s |  |
| `zonetest` | PASS | 54 s |  |
| `svcstatus` | PASS | 59 s |  |
| `progresstest` | PASS | 62 s |  |
| `edgetest` | PASS | 114 s |  |
| `hudfootprint` | PASS | 63 s |  |
| `aotest` | PASS | 512 s |  |
| `interchangetest` | PASS | 492 s |  |
| `roadthrough` | PASS | 61 s |  |
| `needtest` | PASS | 96 s |  |
| `restest` | PASS | 117 s |  |
| `rescheck` | PASS | 459 s |  |
| `musictest` | PASS | 8 s |  |
| `placetest` | PASS | 61 s |  |
| `playtest3` | PASS | 59 s |  |
| `playtest4` | PASS | 59 s | first run: the same 403s; passes on re-run. |
| `firststeps` | PASS | 58 s |  |
| `playtest5` | PASS | 126 s |  |
| `housetown` | PASS | 89 s |  |
| `civictest` | PASS | 303 s |  |
| `gridtest` | PASS | 70 s | first run: the same 403s; passes on re-run. |
| `undotest` | PASS | 64 s |  |
| `weathertest` | PASS | 155 s |  |
| `costtest` | PASS | 70 s | first run: the same 403s; passes on re-run. |
| `ipcheck` | PASS | 1 s |  |
| `copyscan` | PASS | 1 s |  |
| `feedtest` | PASS | 60 s | needs git history and this clone was shallow; passes after unshallowing. |
| `nametest` | PASS | 101 s |  |
| `transittest` | PASS | 114 s | first run: riders 373 against 374 (an off-by-one in a random town); passes on re-run. |
| `transithonest` | PASS | 59 s | first run: the same 403s; passes on re-run. |
| `transitcut` | PASS | 64 s | first run: the same 403s; passes on re-run. |
| `savetest` | PASS | 108 s |  |
| `loadfiletest` | PASS | 169 s |  |
| `disasterloop` | PASS | 405 s |  |
| `gradetest` | PASS | 52 s |  |
| `soak` | PASS | 151 s |  |
| `collegetest` | PASS | 61 s |  |
| `crosswalktest` | **FAIL** | 113 s | **FAILS**: `nobody on foot is ever inside a car` (10 times here, 13 on the untouched base tip). The traffic pass's test and the traffic pass's behaviour. |
| `parkingtest` | PASS | 398 s |  |
| `landmarktest` | **FAIL** | 91 s | **FLAKY**: in three repeats 2 pass on this code; on the untouched base tip 0 of 3 pass (different checks each time). Traffic pass. |
| `nightglow` | PASS | 85 s |  |
| `treelod` | PASS | 123 s |  |
| `impostortest` | PASS | 98 s |  |
| `reflecttest` | PASS | 262 s |  |
| `starttest` | PASS | 377 s |  |
| `shadercheck` | PASS | 0 s |  |
| `tooltest` | PASS | 74 s |  |
| `tiptest` | PASS | 51 s |  |
| `overlaptest` | PASS | 325 s |  |
| `uisweep-phone` | PASS | 536 s |  |
| `uisweep-desk` | PASS | 816 s |  |
| `touchtest` | PASS | 477 s | first run: a tap timed out on the disabled Build button (the same step timed out once on the old build); passes on re-run and passed on the earlier snapshot. |
| `scaletest` | PASS | 84 s |  |
| `audiotest` | PASS | 3 s |  |
| `streetaudio` | PASS | 15 s |  |
| `streetaudio-game` | PASS | 84 s |  |
| `yellowflash` | PASS | 1168 s |  |
| `junctiontest` | PASS | 60 s |  |
| `roadjunction` | PASS | 189 s |  |
| `junctionmesh` | PASS | 64 s |  |
| `junctionedit` | PASS | 49 s |  |


## 8. What I did not get to

- **Nobody has listened to the street sound.** The tests measure pitch, level, pan and timing. Please open `dev/streetaudio.html` and
  listen, especially to honk frequency and the balance of engines against the old traffic bed (which I did not thin). No crash sound,
  tyre squeal or reversing beeper.
- **No real-device numbers.** Every timing here is the software GPU of this container. Low is within a few percent of the old code
  there, but I could not run an iPhone. The people model is the one to watch: everybody within 64 m costs 2.1x the old one on the
  software GPU (worst case; a street with 40 near and 80 far is 10% cheaper), and without `EXT_color_buffer_float` its pose pass falls
  back to a per-vertex pose (about 2x, unmeasured on a device). `updateLod` for people is never called by the game.
- **No picture of dust off a gravel road.** The path is wired (`surfaceAt` from the road network) and unit-tested for its inputs, but the
  reference block has no gravel road with traffic, so I have no before/after for it. Rain spray shows faintly in `cars-game-rain-*`.
- **Dark paint at night is still dark.** A black car now gets a thin sky-glow rim and its lamps, but it is a dark shape on a dark road,
  which is honest. The Cyberslop's "stainless" reflects the night sky, so it reads black at night (day view is right).
- **Street trees are near-black in night close-ups** (`cars-game-pickup-moving-night-after.jpg`, the tree in front of the lens). Trees take
  no lamp-pool light like the roads and facades do. Not touched.
- **Junctions:** skewed junctions keep long plain mouths (their sidewalks trim them; needs mitred walk ends in `buildSeg`), stroad
  crossings under about 70 degrees still get straight chamfers, and the one-way alley at 60/120 degrees got up to 5.5 m2 more flare.
- **Low:** ground, and the grade's saturation, contrast and vignette on Low, are not touched. The phone context in the tower numbers is
  390x780 at 3x (the size the brief gives), not 390x844. Ultra above a 2x screen (where its 2.25 pixel ratio differs from High's 2) was
  not checked for the yellow flash.
- **Cosmetic mismatches:** a tow truck's amber bar flashes on the mesh with no halo; garbage-truck and work-pickup beacons get halos
  while moving but the mesh beacon never lights (`lampCode` is per kind, `emit` per model).
- **No `perfTown`.** It grows a different town every run, so its counts cannot be compared; I used side-by-side frame timing of the saved
  reference block (`scripts/lowperf.mjs`) and the draw-call script instead.

## 9. Found in the traffic pass's files (not edited)

I edited none of the traffic pass's files (`traffic.ts`, `parking.ts`, `pedestrians.ts`, `sim/*`, `transit/*`, `zones/*`,
`roads/network.ts`). What I found in or about them:

- **`carsolid.mjs` fails on the untouched base tip too**, in both of two runs (a different pair of cars each time inside a junction, and
  once a heading snap), so it is not caused by anything here; on the merged code it failed once with a pair in a lane. Queued cars still
  overlap in some captures (two pickups nose to tail inside each other at a junction in my first High night capture). This is audit item 1 and it
  is the traffic pass's.
- **Stop lines and trims** (junction helper): `updateTrims` uses the crossing road's half-width including sidewalks, so at oblique and wide
  crossings 75 of 162 legs stop a car's nose past the crosswalk (median 1.1 m, worst 5.5 m at a 60 degree stroad crossing).
  `junctionShape(net, id).legs[i].marks` has the kerb-line distances (`z0`, `z1`, `bar`). `c.s` is the car centre and the stop is
  `exitS - 1.5` for every car, so the nose of a 16 m semi ends 8 m inside the box. The kerb-return solver mirrors `enterJunction`'s 0.42
  cubic: if that curve changes, run `node scripts/junctionmouth.mjs --min-clear 1.25`.
- **Parked cars** (audio helper): the street sound reads `kind, id, x, y, z, v, yaw, crashed` and optionally `acc, len, dep, arr, parked`.
  If parked cars ever sit in `traffic.cars` with `v = 0` they must carry `parked: true`, or a full car park will read as a jam and honk.
  `parking.ts` already calls the renderer's `setParked(handle, true/false)`, which is what gives parked cars dark lamps and still wheels.
- **`agents/communes.ts`** (night helper): each commune's campfire light is switched on and off as the camera crosses 420 m. That
  recompiles every material (a hitch) and its brightness is not divided by `GLOW`. Fix: keep the light in the scene at brightness 0 when
  far, and multiply by `GLOW.value`.
- **`game.ts`** (people helper): it sets `renderer.info.autoReset = false`; the people pose pass adds one draw call to that count.
- **`traffic.ts` paint:** it still picks one of its 14 colours with `Math.random()`. The renderer treats that as a request and draws from
  the real-US mix, so no change is needed there, but the 14-colour list no longer decides what the player sees.
