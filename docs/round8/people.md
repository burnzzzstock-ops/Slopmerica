# People on the phone (round 8, item 4)

Branch `wt/people8`, based on the base tip `c85b1e6`. The citizen model (lofted bodies, 14 hats, props, a skeleton posed on the GPU) cost up to
2.1x the old model's people on the software GPU. On Low (the owner's iPhone) the people group now submits **13 to 33 % of the old model's
triangles** in the reference block (Low phone: 24 m 174 k -> 58 k, 60 m 174 k -> 30 k, 140 m 174 k -> 22 k, the same 63 people from the same
camera) and costs **0.2 to 0.7 of the old model's time** in the lineup bench's street, far, play-view and phone-canvas crowds. The worst
case, 120 people all in view within 12 to 30 m, costs about the old model's time (0.94x and 0.99x, inside the noise); the base tip's
cost there was 3.7x and 2.7x. Medium is at 0.75 to 0.77 of the old model's time in its bench crowds (the base tip: 3.1x and 1.4x), High at 1.05x with
420 people all near (the base tip: 2.9x) and 0.77x in the play-view crowd. Nothing the simulation reads changed.

## 1. What the cost is made of (measured, same box)

All "bench" times are the people group alone: the same frame with the group shown and hidden, alternated, in `scripts/peoplelineup.mjs bench`
(Low shadow map, 120 people unless said, 640 x 360, the builds measured round by round in one browser so that the machine's load, which
changed by a factor of two from one minute to the next, hits all of them alike; a ratio between two runs made at different times measured
the load: the base tip's all-far crowd read 271 ms in two runs an hour apart, with half the triangles in the second).

| per person | old | base tip | now |
|---|---|---|---|
| triangles held: near figure / far figure | 1196 / 92 | 3117 / 497 | same, and 239 in the shadow map on Low and Medium |
| triangles shown (mean) | 429 / 92 | 768 / 210 | same |
| submitted for 120 slots in every view | 298 k (near twice, far once) | 2 x 497 each for everybody, 3117 more for each within 64 m of a camera, in view or not | only what is in view |
| near figure, bench | 4.4 ms | 14.2 ms | 14.2 ms, at most 12 on Low |
| far figure, bench | - | 2.2 ms in the view, 1 to 1.5 ms in the shadow map | the same, for the people in view only |

What was wrong with the base tip's draws: every person went through the far figure's vertex stage twice (the view and the shadow map)
whether anybody could see him or not, the near figure was drawn for everybody within 64 m of a camera even behind it, the pose pass worked
out all of them, and a slot that had once held a person stayed in every draw (`used` is a high-water mark: 20 people in a page that had once
held 69 drew 69 slots). The shader's own distance test only hid what had already been submitted. A near figure holds 3117 triangles of
which a person shows 768, and a software GPU pays for the ones it throws away.

## 2. What changed

1. **`fbe6691` Draw lists, made on the CPU every frame** (`personRenderer.ts`, `flush()`). Each draw is given only its own people: *near*
   (within the near range of a camera, inside its frustum, the nearest N), *far* (the other people inside a frustum), *shadow* (people
   within the shadow range who are in a frustum or within a shadow's reach, 24 m, of one). The shadow map has a mesh of its own that draws
   nothing in a view (zero instances are not drawn at all). The pose pass works out only the people on a list, and only when somebody's
   pose changed or he was off every list before. The cameras are the ones the figure was drawn from the frame before, read as they are when
   the lists are made (the game moves its camera before the people are updated; the water's mirror camera is one of them). The shaders'
   distance test is gone: the list decides. The renderer's contract (`add`, `set`, `remove`, `pick`, `flush`, `setNight`) is unchanged;
   `flush(viewers?)` takes cameras too, `setDetail(...)` takes the preset's knobs.
2. **`0146f59` A lighter figure for the sun's shadow map** on Low and Medium: the far figure without hair, hats, jackets, vests and bags
   (239 triangles held, 178 shown; the coat, robe and long skirt, the sign, the drum and the crate stay).
3. **`63453a0`, `6486859` Preset knobs** (`src/config.ts`, wired by one line in `src/game.ts`): `peopleNear`, `peopleNearMax`, `peopleShadow`,
   `peopleShadowLite`.

| preset | maxPeople | near within | at most near | shadows within | shadow figure |
|---|---|---|---|---|---|
| low | 120 | 40 m (60 px tall on the phone) | 12 | 120 m | light (239) |
| medium | 250 | 64 m | 40 | 160 m | light (239) |
| high | 420 | 64 m | 100 | everybody | full (497), as before |
| ultra | 580 | 64 m | 120 | everybody | full (497), as before |

   High and Ultra are as before in every crowd the game spawns (people appear over a square of about 2 x 140 m round the camera: a hundred
   of them within 64 m and in view would be the whole city in one block); their caps only bound the worst case.
4. **`664684b`, `17ab360` Scripts.** `peoplecost.mjs` timed frames with `gl.finish()` alone, which returns while the software GPU still has the
   frame queued (the base tip's Low phone street view read 16 ms a frame, the people group "-4 ms" and "+3 ms"); it reads a pixel back
   now, shows every build the same crowd from the same camera (`BASES=old=url,base=url,new=url`, one browser, measured alternately),
   reports the pose pass and the lists, and writes the canvas for pictures. `peoplelineup.mjs` gained `PRESET`, `N`, seven crowds, `BASES`,
   per-knob queries, the `crowd60` / `crowd24` sheets and a `lists` check.

## 3. Numbers

### 3.1 Lineup bench, Low (120 people, 640 x 360; ms for the people group, three builds in one run)

| crowd | old | base tip | now | now / old | triangles old / base / now |
|---|---|---|---|---|---|
| all near, 30 to 55 m, all in view | 696 | 2112 | 417 | 0.60 | 298 k / 493 k / 120 k |
| all far, 150 to 200 m | 615 | 294 | 233 | 0.38 | 298 k / 119 k / 60 k |
| a street: 40 near, 80 far | 656 | 822 | 290 | 0.44 | 298 k / 244 k / 80 k |
| all close, 12 to 30 m, all in view | 641 | 2354 | 600 | 0.94 | 298 k / 493 k / 120 k |
| play view: a 60 m camera, 120 people over 140 x 140 m | 536 | 795 | 237 | 0.44 | 298 k / 328 k / 74 k |

The same on the phone's canvas (585 x 1266, where a near figure covers many more pixels):

| crowd | old | base tip | now | now / old | triangles old / base / now |
|---|---|---|---|---|---|
| all close, 120 people, 12 to 30 m | 506 | 1341 | 500 | 0.99 | 298 k / 493 k / 87 k |
| 40 people, a 24 m camera | 618 | 888 | 428 | 0.69 | 298 k / 244 k / 61 k |
| 40 people, a 60 m camera | 579 | 540 | 108 | 0.19 | 298 k / 200 k / 29 k |

The old model's triangles are those of all 120 slots in every view (the page had held 120 people before these crowds of 40).

### 3.2 One change at a time (Low, same bench, percent of old; `BASES=...#q=low&near=64&max=9999&shadow=9999&lite=0` and so on)

| step | near crowd | street | play view |
|---|---|---|---|
| base tip | 304 % | 129 % | 137 % |
| lists, frustum, pose only for the listed (near 64 m, no cap, every shadow, full shadow figure) | 265 % | 114 % | 109 % |
| + near range 40 m, at most 12 near, shadows within 120 m | 70 % | 51 % | 36 % |
| + light shadow figure (final) | 77 % | 54 % | 48 % |

Triangles of the last step: 150.7 k -> 119.8 k, 90.0 k -> 79.7 k, 94.2 k -> 71.5 k (-20 %, -11 %, -24 %), but its milliseconds are not
better than the step before it (all three within each other's ranges, the final one a little higher each time). **The light shadow figure
has no effect I can measure on the software GPU**; it removes 258 triangles per caster from the shadow pass, which a real GPU also pays as
vertex work. It is one knob (`peopleShadowLite`; false everywhere and the figure is the full one again) and one commit (`0146f59`) if the
lead prefers to leave it out. Culling alone (second row) is small in these crowds, because the bench puts nearly everybody in view; in the
play view it is 137 % -> 109 %. The step that matters is the near range and the cap.

### 3.3 The reference block (`peoplecost.mjs`), the same 63 people from the same camera, Low phone (390 x 844 at 3x, canvas 585 x 1266)

| camera | people near / far (lists) | triangles old / base / now | draw calls (+1 pose pass) |
|---|---|---|---|
| 24 m | 12 near, 24 far, 38 in the shadow map | 173,880 / 162,740 / 58,226 | 3 / 3 / 3 |
| 60 m (the usual play height) | 1 near, 40 far, 29 shadow | 173,880 / 128,263 / 29,928 | 3 / 3 / 3 |
| 140 m | 0 near, 44 far, 2 shadow | 173,878 / 81,508 / 22,346 | 3 / 2 / 2 |

The milliseconds of the group in the game are not usable: a frame is 3.4 to 4.9 s on the software GPU there and the group's difference has
quartiles of 300 to 600 ms either way (24 m: old 124, base 483, now 409; 60 m: old 419, base 4, now 236; 140 m: old 250, base -368, now 48),
as the earlier report said; read the triangles here and the bench above for time. The pose pass on its own is 3 to 8 ms for 40 to 60 people
on this box.

### 3.4 Low desktop, Medium and High

Reference block (`peoplecost.mjs`, 1280 x 720, the same crowd from the same camera in the three builds; triangles, draw calls; the group's
milliseconds in the game are noise there too: frames of 6 to 10 s, quartiles of 500 to 1500 ms):

| preset, camera | people near / far (lists) | triangles old / base / now | draw calls (+1 pose pass) |
|---|---|---|---|
| Low desktop, 24 m | 10 near, 18 far, 41 shadow | 161,462 / 167,066 / 49,915 | 3 / 3 / 3 |
| Low desktop, 60 m | 2 near, 46 far, 35 shadow | 161,458 / 132,779 / 37,461 | 3 / 3 / 3 |
| Medium, 24 m | 18 near, 8 far, 37 shadow | 161,460 / 195,303 / 68,739 | 3 / 3 / 3 |
| Medium, 60 m | 15 near, 22 far, 47 shadow | 161,460 / 132,779 / 68,920 | 3 / 3 / 3 |
| High, 24 m | 21 near, 24 far, 57 shadow | 166,428 / 176,470 / 105,520 | 3 / 3 / 3 |
| High, 60 m | 15 near, 42 far, 58 shadow | 166,428 / 126,410 / 96,455 | 3 / 3 / 3 |

Lineup bench with the preset's own shadow map and `maxPeople` crowds (ms for the group; the three builds in one run):

| preset, crowd | old | base tip | now | now / old | triangles old / base / now |
|---|---|---|---|---|---|
| Medium, 250 all near, 30 to 55 m | 1123 | 3526 | 869 | 0.77 | 621 k / 1028 k / 289 k |
| Medium, 250 over 140 x 140 m, 60 m camera | 959 | 1328 | 716 | 0.75 | 621 k / 666 k / 244 k |
| High, 420 all near, 30 to 55 m | 2090 | 5976 | 2193 | 1.05 | 1043 k / 1727 k / 679 k |
| High, 420 over 140 x 140 m, 60 m camera | 1903 | 1991 | 1462 | 0.77 | 1043 k / 1041 k / 510 k |

High is the preset that stays as it was (near within 64 m, every shadow, the full shadow figure, a cap of 100 near figures that no spawned
crowd reaches): the base tip cost 2.9x the old model's time with 420 people all near and now costs the old model's (1.05x, inside the noise,
with 100 near figures and 320 far); in the play-view crowd it is 0.77x. In the reference block its near figures are 15 to 21 of 67 people.
Medium is under the old model's cost in both crowds (0.77x and 0.75x); the base tip's was 3.1x and 1.4x.

## 4. Pictures (`docs/screenshots/round8/people-*`)

The same people, the same camera, base tip (`-before`) against now (`-after`); `-old` is the old model, for reference.
* `people-default-*`: the usual play camera (60 m, 0.5 rad), Low phone, 63 people along a street. Silhouette, gait, signs and bags read as
  before; the people near the bottom edge are far figures (the near range is 40 m) and cannot be told from near ones at this size.
* `people-close-*`: 24 m, Low phone. Twelve near figures (the cap) and the rest far: faces, hats, hi-vis stripes and props are the same in the
  pair; the cap boundary is not visible.
* `people-crowd60-*` and `people-crowd24-*`: forty people on the lineup pavement (Halton-spread, the same on every build) from the same two
  cameras, Low knobs against the base tip.

## 5. Tests (final code)

* `qualitytest`: all OK (trees 232,790 on Low and High, land-value samples equal at 121 spots, traffic budget 1000 on both, trip launches with the
  pool full): the presets do not change the simulation.
* `scaletest`: all OK. `motiontest`: all OK (walkers' legs 0.704 cycles per metre, 0 teleports in 42,858 steps). `glcheck`: 0 GL errors.
  `shadercheck`: OK. `npx tsc --noEmit`: clean.
* `peoplelineup.mjs lists` (the near, far, shadow and pose lists against what the knobs say, 5 checks each): 20 of 20 OK for low, medium, high
  and ultra (an earlier run failed one Medium line at a person standing at exactly 160.0 m; the check compares 3-D distances now).
  `peoplelineup.mjs feet`: OK (worst mean slide 9.1 % of the ground speed, lowest shoe vertex 4.4 mm from the pavement); `lod`: 13 people from
  50 to 80 m all drawn.
* Not run: `nighttest` (the fragment shader and the lighting are untouched; the vertex shader lost its distance test and gained nothing else).

## 6. Not done, and things for the lead

* Nothing here is measured on a phone or any real GPU; the software GPU's cost per triangle is not a phone's.
* The near figure still holds 3117 triangles and shows 768; splitting it into a body and a few accessory draws (people with a hat, a prop, a bag)
  would cut the Low worst case by another 2 to 3x at the price of 4 or 5 more draw calls. Not done: the caps already bound the case.
* The near range is in metres. At the 110 degree field of view the Settings now allow, a person at 40 m is about 3 times smaller on screen
  than at 35 degrees; scaling the range with the field of view would be a one-line change in `fillLists`.
* `src/dev/people.ts` takes `?q=<preset>&near=&max=&shadow=&lite=` to set single knobs.
