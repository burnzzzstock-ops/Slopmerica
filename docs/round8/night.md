# Round 8, night: "High at night" and the night look leftovers

Branch `wt/night8`. Two items from `docs/HANDOFF_ROUND8_SONNET.md`: 6 (High at night) first, then 3 (street trees and dark
paint at night). Everything here was measured on the shared software GPU (SwiftShader, 4 cores, load average 8 to 11 the whole
time), so absolute milliseconds are inflated 2 to 3 times against a quiet box; the comparisons are what to read.

New scripts (README lines at the end):

- `scripts/nightcost.mjs`: where a frame goes. Per GPU pass (every pass followed by a 1x1 readback from a scratch framebuffer, which on
  the software GPU waits for everything drawn so far), the whole frame with one feature switched off at a time, the same camera at
  several window sizes, each scene layer hidden on its own, and an A/B mode that alternates a toggle frame by frame.
- `scripts/nightlook.mjs`: median display luma of just the tree crowns and just the dark cars in a fixed night close-up (mask pass,
  described below).

## Item 6: High at night

### Answer

**It is not a night cost, and nothing in it is a per-light, per-pass or per-draw mistake. It is the software rasterizer. I changed nothing.**

How I know:

1. **Day costs the same as night.** Same camera, same town, High, 1280x720, median of 3 frames, one load:
   night 10.9 s, noon 12.3 s. Ultra 14.1 s / 14.2 s. Low 8.0 s / 7.6 s. If the night lights (pool texture, moon light, bloom at the night
   threshold, stars, fireflies, car halos) cost anything real, night would be the slower one.
2. **The scene pass is 92% of the High frame** (10.1 s of 10.9 s); shadow map 0.19 s, AO 0.07 + blur 0.12, composite 0.08, bloom
   0.28 (13 small passes), grade 0.07, JavaScript 0.02. No post pass is a problem.
3. **Frame time is `a + b x pixels`, with a big `a`, and `a` follows the triangle count.** Scene pass, same camera, High at night:

   | window | pixels | scene pass |
   |---|---:|---:|
   | 320x180 | 58 k | 4.4 s |
   | 640x360 | 230 k | 6.2 s |
   | 1280x720 | 922 k | 12.5 s |

   That is 4.1 s that does not depend on the resolution at all plus 9 us per pixel. Low shows the same shape (2.7 s plus 6 us per
   pixel: 2.7 / 4.1 / 8.3 s). The fixed part is vertex work: 1.19 M triangles in 4.1 s is 3.4 us a triangle on High, and Low's 0.83 M
   triangles in 2.7 s is 3.3 us a triangle, the same number on two presets. A GPU does that in a millisecond or so; a CPU rasterizer
   does not.
4. **Switching features off one at a time** (High, night, 1280x720, median of 3 frames, baseline 14.2 s then 13.2 s as the box's load
   drifted, so differences under about 1 s are noise):

   | switched off | frame | vs baseline |
   |---|---:|---:|
   | nothing (start / end of run) | 14.2 / 13.2 s | |
   | shadows (shadow map and shadow lookups; 78 draws, 250 k triangles fewer) | 14.2 s | none |
   | sun / moon light (removed) | 12.8 s | -8% |
   | sky light (hemisphere) | 12.9 s | -7% |
   | lamp pools (the pool texture read and its emissive) | 12.8 s | -7% |
   | bloom | 13.0 s | -5% |
   | AO | 12.5 s | -9% |
   | sky dome / stars / water mesh / water mirror | 13.3 / 13.4 / 12.4 / 12.9 s | within noise |
   | the environment map (image based light on every lit material) | 10.9 s | -20% |
   | MSAA (4 samples on the HDR scene target) | 7.9 s | -42% |
   | all post (straight to the canvas: no HDR target, no MSAA, no AO, no bloom, no grade) | 7.1 s | -48% |

   And the two lights that are always compiled into every lit shader at near-zero intensity (the shared campfire point light, the
   lightning fill light), switched off against on, alternating frame by frame so the box's drift cancels (`MODES=ab`):
   High 13.2 s vs 13.5 s (+2%), 14.6 vs 14.5 s (-1%), both 13.2 vs 12.7 s (-3%); Low, the campfire light: 9.2 vs 9.3 s (+2%). None
   of them is measurable here.
5. **What the triangles are** (each scene layer hidden on its own, 320x180 so the fixed part shows; 2 frames each, so times are
   +-15%, the triangle counts from the renderer are exact):

   | hidden | High frame | High triangles | Low frame | Low triangles |
   |---|---:|---:|---:|---:|
   | nothing | 4.85 s | 1 219 606 | 2.25 s | 834 446 |
   | **the trees** (near trees 26 000 / 6 000 cap, their shadow pass included) | **2.66 s (-45%)** | 715 256 (-41%) | **1.20 s (-46%)** | 464 530 (-44%) |
   | an unnamed 32-mesh group (probably the terrain tiles) | 4.56 s | 993 031 (-19%) | 2.39 s | 594 529 (-29%) |
   | the civic layer (65 meshes) | 4.45 s | 1 082 144 (-11%) | n/a (not loaded on Low) | |
   | traffic (aa-vehicles) | 4.35 s | 1 112 282 (-9%) | 2.69 s | 792 666 (-5%) |
   | two batched meshes (133 k + 50 k triangles) | 4.11 / 4.99 s | -7% / 0% | 2.32 / 2.55 s | -11% / 0% |
   | people, sky, stars, water, vault scenery, ambient life, icons | all within the noise | | | |

   Only the trees move the time: they are about half of the fixed part of the frame on both presets, the triangle budget a phone would
   pay for in vertex work (leaf cards, three models a species, plus the shadow pass).

So: the two features that make the High frame slow here are the ones whose cost a software renderer exaggerates most (4x multisampling
of a half-float target, and the IBL lookup), the geometry is a vertex-throughput cost, and the rest is flat. The per-light, per-shadow
and per-pass hypotheses from the handoff are all measured and none of them costs anything you can see through the box's noise.

What I cannot prove from here: that a phone or laptop GPU pays little for the same frame. No real GPU was available. If a phone is slow
on Low, the order of suspicion from these numbers is: the near trees (the biggest geometry, and alpha-tested leaf cards with MSAA on the
default framebuffer), then the per-pixel work of the PBR materials; not the lights, shadows or the night.

### What was not fixed, and why

Nothing was changed for item 6. The one candidate that is a real cost anywhere, the always-compiled idle lights, measures at +2% /
-1% / -3% (noise); removing the campfire light would also change the look near camps. Per-device numbers (iPhone) would be the next
step, with `scripts/nightcost.mjs` pointed at the device's browser.

## Item 3: night look leftovers

### Method (`scripts/nightlook.mjs`)

A fixed night close-up (High, 23:00, moonless, clear, 1280x720, the saved reference town; same camera on every build) is drawn, read
back from the canvas (display luma 0..255 = 0.2126 R + 0.7152 G + 0.0722 B of what reaches the screen), and then drawn once more straight
to the canvas as a **mask pass**: the subject in a flat colour, every other object writing depth only (`colorWrite` off, so a lamp post
in front still hides what is behind it; shared materials restored afterwards). A pixel counts as the subject when its mask colour says so.

- **Street tree crowns**: the civic street tree nearest the block centre (a maple at 200, 70), the camera 20 m away at pitch 0.3; the
  mask is the civic `foliage` material (27093 px, 2.9% of the frame). The road meshes are a second class, for scale.
- **Dark cars**: a private `VehicleRenderer` with three cars made by `add(kind, colour, { exact: true })` (black sedan `050505`, charcoal
  pickup `1d1f22`, dark blue sedan `0b1426`), standing in the lane at the middle of the nearest street lamp's pool, the camera 15 m
  away on the pole side; the town's own traffic is hidden for the shot, the mask is that renderer's meshes (64364 px, 7%).
- **Pale cars** (the check that nothing else moved): the same shot with white, silver and red paint (`CASES=lightcars`).
- `SWEEP_TREE` / `SWEEP_CAR` redraw the same shot (same camera, same mask) at several values of the tuning uniform, so a constant is
  chosen from numbers and pictures in one page load.

A black car's **median** cannot be made to move without painting its sides brown (below), so each result also gives p75, p90, the mean and
the share of the subject's pixels that reach luma 20 (readable).

### What was wrong

At night a tree took only the moon and the sky light: the road meshes, terrain and facades add `diffuse colour x lamp-pool texture`
(`nightLights.ts`: `litByLamps`, `lampAdd`); trees and cars never did. Foliage and a black paint are dark enough that the moon and sky
alone leave them at display luma 3.

### What changed

1. **Trees take the lamp pools** (`src/world/nightLights.ts`, `src/world/trees.ts`, `src/civic/layer.ts`; commits `dd77225`,
   `34d5690`). The civic street trees' foliage and bark go through `litByLamps` (new optional `share` uniform), the near forest tree
   material gets the same `lampAdd` on its existing world-position varying. `TREE_LAMP` (1.0: the ground's share) scales the street
   trees, `FOREST_LAMP` (3) the forest trees, whose leaf atlas is darker. By day, and where the pool texture is empty (everything
   outside the town's lit area), the lookup returns before reading the texture: nothing else changes.
2. **Dark paint gets a believable sheen** (`src/agents/vehicles.ts`, the `uVehicleNight` emissive line; commit `97e8f9a`). The vehicle
   shader adds the same pool texture as light thrown back by the gloss: `x` 0.6 on up-facing panels where the camera would see the
   lamp overhead mirrored (hood, roof, deck), `y` 0.3 along grazing edges, `z` 0.05 on the sides (the lit road mirrored), faded out by the
   paint's own luminance so white and silver cars keep their look. `CAR_SHEEN` is the tuning uniform. One extra pool lookup per car
   fragment at night (0 by day, and it returns before the read outside the lit area).

Not done, on purpose: no ambient "fill" light. The brief's "a little moon/sky fill" is what the roads and facades get from the existing
hemisphere and moon light; adding more would brighten every tree in the forest, lit or not. Away from a lamp a tree is still dark.

### Numbers (High, same camera; before = base tip on 5210, after = this branch)

| subject | median | p10 | p75 | p90 | mean | pixels at luma 20+ |
|---|---:|---:|---:|---:|---:|---:|
| street tree crowns, before | 3 | 2.1 | 3 | 3 | 3.7 | 0.8% |
| **street tree crowns, after** | **32.8** | 22.2 | 38.3 | 44.5 | 33.6 | 92.9% |
| dark cars, before | 3 | 2.1 | 7.5 | 18 | 9.2 | 7.8% |
| **dark cars, after** | 3 | 2.1 | **43.8** | **99.1** | **26.7** | **31.2%** |
| pale cars (white, silver, red), before | 18.5 | 3 | 38.1 | 69.6 | 29.1 | 45.3% |
| pale cars, after | 20.5 | 3 | 57.3 | 103.2 | 35.9 | 50.6% |

The road in the same frames reads 62 to 77 (median), unchanged. Tuning sweeps (kept in `docs/screenshots/round8/` where they matter):

- `TREE_LAMP` 0 / 0.5 / 1 / 1.5 / 2 gives crown median 3 / 17.7 / 32.8 / 45.9 / 57.8 (the road is 65). 1.0 reads as a lit tree; 1.5
  starts to look floodlit.
- Car sheen: a uniform lift (0.3 on every face) took the median to 18.6 but turned the black cars brown
  (`night-cars-uniformlift-rejected.jpg`). The two-term, three-direction sheen leaves the sides black and lights the top panels and
  edges: median 3, but p90 18 -> 99. Side term 0 / 0.05 / 0.1: mean 26.5 / 26.7 / 27.6; 0.1 tints the sides bronze, 0.05 is the
  smallest that still reads as a reflection of the lit road.
- The pale-car check before the luminance fade: median 23.9, mean 44 (+15); with it 20.5 and 35.9 (white and silver look the same, the red
  car warms: it is a dark paint).

Pictures (same camera): `night-trees-{before,after}.jpg`, `night-cars-{before,after}.jpg`, `night-lightcars-{before,after}.jpg`,
`night-lowcars-{before,after}.jpg` (Low).

### Low (the owner's preset)

- **Cars**: same shot on Low: dark cars mean 6.2 -> 26.9, p75 9.1 -> 48.5, p90 14.8 -> 87.9, readable 4.6% -> 33.4% (median 0.1 -> 6.3);
  pale cars median 22.5 -> 23.6, mean 27.8 -> 35.7.
- **Trees**: Low does not load the civic layer, so it has no street trees at all, and the reference town has cleared its forest: of
  the trees in the streaming set around the block only shrubs are near (the first four attempts at a "nearest tree" counted 0 pixels
  for that reason, and for a mask colour the forest trees' instance colour multiplied away; both are in the script's history). The
  subject is a real forest oak copied beside the nearest lamp (the real shader, the test's place), seen from 22 m: 101030 crown pixels,
  11% of the frame. Before: median 1.8, mean 3.4, p90 5.4, 2.6% of the pixels at luma 20+ (a black cutout, `night-lowtrees-before.jpg`).
  The forest leaf atlas is darker than the civic maple's, so it gets its own share, `FOREST_LAMP` (3; `TREE_LAMP` stays 1 for the
  street trees): sweep 1 / 2 / 3 / 4 gives median 6.3 / 11.3 / **16.2** / 20.5, mean 8.6 / 14.1 / **19.3** / 24.2, readable 5.8% /
  21.5% / **37.1%** / 51.9%. 3 shows an olive crown and a warm trunk (`night-lowtrees-after.jpg`); 4 looks floodlit. The road in
  the frame is 55.4 before and after. Where no lamp pool reaches (the forest, away from the town) a tree is exactly as before.
- Cost, `scripts/lowperf.mjs` at 23:00, Low, old vs new, interleaved frames (K=7): overview 1.059, street 0.971, houses 0.950, geometric
  mean **0.992** (-0.8%: nothing measurable); draw calls +1 in each view (168 -> 169, 188 -> 189, 162 -> 163: not from this change,
  which adds no mesh; the traffic differs run to run).

### Tests (frozen snapshot of this branch, port 5220)

The tests ran on the snapshot on port 5220, taken before the forest trees got their own share: there the near forest tree material
used `TREE_LAMP` (1) where the final commit uses `FOREST_LAMP` (3). No test below looks at a forest tree under a lamp, so none depends on
it; the Low tree pictures and numbers above are from a second snapshot (5221) with the final constants.

| test | result |
|---|---|
| `shadercheck` | pass (no sin-based hashes in 161 files) |
| `qualitytest` | pass: reference tree count equal (232790 on Low and High), land value equal at 121 spots, traffic budget equal, trips launch with the drawable pool full, no page errors |
| `glcheck` | 0 GL errors (total hits 0) |
| `treelod` | pass: impostors vs detailed trees brightness ratio 0.92 at 140 m, 0.94 at 320 m; cover as before |
| `impostortest` | pass: every species has a side and a top billboard on the 3x phone, same as desktop |
| `nightglow` | pass: 0% blown to white on the close night street (mean 51.6 vs 154.6 at noon), 0% amber specks in the wildfire-smoke view |
| `nighttest` | pass: road median 87 / 75 / 74 (moonless / full moon / rain, target 50), pools p90 160 / 153 / 143 (target 100), facades 159 vs ground 67 (and 164 vs 46, 162 vs 40), blown out 0.01 / 0.01 / 0.09%, pools off by day (road median 123) |
| `presetlight` | **1 pair out of tolerance: Low vs High at noon, shore camera, +0.048 luma (limit 0.03). The same pair fails on the base tip (5210): +0.047 (High 0.331, Low 0.378).** Daylight only; nothing in this branch draws by day. Every other pair is within 0.02 |
| `lowperf` Low, 23:00 | geometric mean new/old 0.992 (overview 1.059, street 0.971, houses 0.950; K=7) |
| `lowperf` High, 23:00 | stopped by the coordinator after two of three cameras: overview 0.896, street 1.026 (K=5; the box is loaded: noise is +-10%); the lead's final suite has the rest |
| `yellowflash` | stopped after 4 of its 8 cases, all inside the limits (mean pops a frame <= 4, worst frame <= 40): still, moonless 0.9 / worst 9; still with fireflies x9 1.6 / 12; pan moonless 2.0 / 33; pan full moon 1.8 / 29; 0 GL errors. The other four cases: run by the lead in the final suite |

Not run: `drawcalls.mjs` (this branch adds no mesh and no draw; `lowperf` shows the calls moving by +1 to +2 in both directions between
builds, from traffic), `peoplecost.mjs`, `reflecttest`, `starttest`, `scaletest`, `motiontest`: nothing here touches what they measure.

## Not done

- **A real GPU number for item 6.** Everything about "is it only the software GPU" is inference from how the cost scales and from what
  the toggles do; no phone or laptop GPU was available. `scripts/nightcost.mjs` runs unchanged in any browser the lead can open the
  game in, if there is one.
- **Street furniture, benches and the like at night** are still unlit by the pools (only trees and cars were asked for).
- **Pale cars take no lamp light** (they are exactly as before; a white car under a lamp is dim). That is the car diffuse path, not the
  sheen, and a lead decision.
- **Campfire glow on Low**: not touched (item 6 found nothing to gain from removing the idle light).
- `yellowflash` (4 of 8 cases) and `lowperf` High (2 of 3 cameras) ran only in part; the lead's final suite has them.

## Found in files I may not edit, or that are not mine

- `scripts/presetlight.mjs` documents `VIEWS=` but never reads it (only `ONLY=` filters), so a one-camera run is not possible.
- `presetlight` fails on the base tip too (Low noon shore, +0.047): the Low preset's daylight shore view is a little brighter than High's
  (High has the water mirror and the environment map, Low neither). Not a night problem.
- Nothing found in the Opus-owned files.

## README lines for the new scripts (the lead adds them)

```
node scripts/nightcost.mjs [quality]  # where a frame goes: per GPU pass, one feature off at a time (MODES=passes,toggles,ab,scale,children; HOURS=23,12.5; SIZE=320x180; ONLY=)
node scripts/nightlook.mjs [quality]  # median/p90 display luma of street-tree crowns and dark cars in a fixed night close-up, from a mask pass (CASES=trees,cars,lightcars; URLS=before=..,after=..; SWEEP_TREE/SWEEP_CAR; MIN_TREE/MIN_CAR gate)
```
