# towers: the black towers on Low, and the Low pass

Helper `towers`, branch `wt/towers`. Task: HANDOFF_CARS_LOOK.md item 6, "Low preset, the owner's phone (audit #11)".

## 1. The black towers

### What it looked like, and why

On Low at noon the glass towers were black slabs (overview, Low, desktop: 37% of the tower-wall pixels were under luma 20, the
median was 26). On the phone context it was worse (54% under 20). High showed the same towers only a little lighter (22% under 20),
so this was not only a Low problem; Low just had nothing to soften it.

The cause is not the pipeline. The building material is one `MeshStandardMaterial` (roughness 0.84, metalness 0.04) with an atlas
albedo. Three things stacked:

1. The tower tiles are painted near-black: `glassB` (the SLOP HQ smoked-glass tower, and every `L5` neon crown) is `#4a4f55`
   to `#141619` glass in `#2a2d31` mullions; `neonFacade` (the tallest tower in the reference block) is a `#3b3d44` wall; the
   neon tower's base is `WALL.concrete(0x3a3a40)`. Albedo 0.01 to 0.05 under a sun of 3.25 times cos(60 degrees) is radiance 0.03,
   which the tone map turns into luma 30.
2. Nothing in the shader looks like glass. Low has no environment map (that is what keeps it cheap), and on High the
   roughness-0.84 lobe of the PMREM shows almost nothing. A dielectric at F0 0.04 mirrors 4% of the sky.
3. There is no light on the shaded side except the hemisphere light, which reaches a vertical face at about half strength.

The post pipeline, AO and the grade are not involved (checked with the class-masked numbers on Low against High).

### What changed (commit 1, `Towers: glass mirrors the sky ...`)

- `art/atlas.ts`: a tile can be flagged `glass` (strength 1 to 4). The flag rides on the UVs: the tile's `u` is shifted by
  `GLASS_U (4) + step`, the way the satire sheet already rides on `u + 2`. No vertex attribute, no extra texture read, no draw call.
- `buildings/material.ts`: the shader reads the band from `floor(u)`, samples with `u - band`, and adds
  `sky * fresnel * strength * darkness` to `outgoingLight` on glass texels only. `sky` is the sky dome's own zenith and
  horizon colour (already computed by `Environment`) mixed by the reflected ray's height, folded upward so a camera above the wall
  sees sky and not ground; `darkness` is 1 minus a smoothstep of the texel's luma, so light mullions and slab edges do not mirror.
  `GLASS.uGlass` holds the four tunables and can be set from the console.
- `world/sky.ts`, `world/seasons.ts`: the sky colours (plus a floor of blue-grey city glow after dark, so the walls between lit
  windows are not pure black at night) and the key light's direction reach the material as uniforms.
- `art/facades.ts` (kept small): `glassA/B/C` strength 4, `glassPlain` and `towerResi` 3, `officeBand` 2. `glassB` gets
  brushed-aluminium mullions (`#8b949b`) so a smoked tower still has a frame and floor lines; `neonFacade` wall
  `#3b3d44` to `#7c818a` with lighter panes; `comHigh.ts`: the neon tower's base concrete tint `0x3a3a40` to `0x646470`.

### Numbers: class-masked luma of tower walls (`scripts/towers.mjs`)

The mask draws every building flat-coloured; walls of anything taller than 22 m above its pad are the "tower facade" class
(the tallest is the 121 m neon tower; the block has eight towers over 55 m). Display luma 0..255, before -> after.

Low, desktop 1280x720, clear noon:

| camera | mean | std-dev | under luma 20 | under luma 40 | median | p90 |
| --- | --- | --- | --- | --- | --- | --- |
| overview | 37.6 -> 59.9 | 33.4 -> 31.8 | 36.9% -> 11.5% | 65.6% -> 28.7% | 26.2 -> 57.7 | 92 -> 105 |
| wide (tallest tower) | 45.3 -> 68.6 | 36.9 -> 33.2 | 27.7% -> 7.2% | 58.6% -> 24.3% | 30.9 -> 66.5 | 111 -> 112 |
| street | 35.2 -> 56.6 | 22.2 -> 24.2 | 27.4% -> 8.9% | 63.5% -> 16.8% | 33.5 -> 56.2 | 66 -> 86 |

Low, desktop, moonless night 23:00 (the lit windows keep the rhythm; the walls between them come off black):

| camera | mean | under luma 20 | p10 |
| --- | --- | --- | --- |
| overview | 62.0 -> 67.8 | 45.2% -> 32.5% | 1.0 -> 7.5 |
| wide | 67.8 -> 73.1 | 34.4% -> 19.8% | 3.1 -> 11.4 |
| street | 84.5 -> 88.2 | 32.6% -> 17.2% | 3.4 -> 16.5 |

Low, phone context (390x780, 3x, touch, Low at pixel ratio 1.5 with MSAA):

| camera | mean | under luma 20 | median |
| --- | --- | --- | --- |
| noon overview | 23.4 -> 52.2 | 54.5% -> 17.9% | 17.7 -> 48.6 |
| noon street | 26.4 -> 65.4 | 42.8% -> 3.4% | 23.1 -> 59.3 |
| moonless overview | 48.4 -> 57.2 | 61.4% -> 42.1% | 5.7 -> 25.5 |
| moonless street | 88.1 -> 93.9 | 40.3% -> 19.9% | 43.2 -> 46.9 |

High, desktop, clear noon (the glass reflection runs on every preset): overview mean 54.6 -> 79.2 and 22.4% -> 3.6% under 20;
street 54.3 -> 72.6 and 13.9% -> 5.8%. The day picture is otherwise unchanged; the towers are lighter.

The std-dev barely moves (33 -> 32) because the whole facade lifts out of the black instead of gaining spread. The floor lines and
window rhythm are what the mean and the under-20 share measure. Pairs: `docs/screenshots/cars-look/towers-glass-{before,after}.jpg`
(Low), `-phone-`, `-night-`, `-high-`.

## 2. The Low pass

Ran `scripts/lookbook.mjs low` (and the phone context) for noon, dusk, moonless, full moon and rain, and compared Low with High
on the same block and cameras with `scripts/presetlight.mjs` (mean luma, blue-to-red ratio, share of crushed pixels under luma 0.02).
Low was within 0.02 of High's mean luma almost everywhere (the earlier pass tuned that), so brightness was not the problem.
What read worst, in order:

1. **The grade never ran on Low.** `PostFX.look` (the weather's tint and exposure, the moonlight's blue, colourless cast) is
   written every frame and only applied in the post pass, which Low skips. After dark Low's blue-to-red ratio sat 16% (overview)
   and 11% (street) under High's, so Low's night was olive where High's is blue; storm, rain, heat and smoke exposed like a
   clear day. Commit 2 (`render/lowGrade.ts`, 25 lines): the tint multiplies the hemisphere light and the sun/moon (the radiance of
   anything unlit is light colour times albedo, so it is the same multiply the grade does before the tone map), and
   `look.exposure` goes on the tone map. Emissive things keep their colour. No pass, texture or draw call.
2. **Shaded walls were dark slabs beside bright roofs.** Commit 3: the hemisphere light reaches a vertical face at about half
   strength and the ground half is dark, and High has an environment map for that. The building shader (presets without an
   environment map only) adds a share (K 0.35) of the hemisphere light to vertical faces, roofs gain nothing.

Presetlight, Low, clear (mean luma / blue-to-red / crushed share; the old code, glass only, grade on, fill on; High for reference):

| camera | old Low | + glass | + grade | + fill (final) | High |
| --- | --- | --- | --- | --- | --- |
| noon overview | 0.558 / 0.731 / 0.8% | 0.563 / 0.740 / 0.2% | 0.564 / 0.734 / 0.2% | 0.568 / 0.743 / 0.14% | 0.558 / 0.788 / 0.4% |
| noon street | 0.457 / 0.892 / 3.2% | 0.466 / 0.900 / 1.9% | 0.466 / 0.893 / 1.9% | 0.480 / 0.921 / 1.2% | 0.465 / 0.958 / 2.7% |
| dusk overview | 0.295 / 0.527 / 2.7% | 0.299 / 0.534 / 1.3% | 0.301 / 0.516 / 1.3% | 0.306 / 0.528 / 1.0% | 0.301 / 0.544 / 1.4% |
| dusk street | 0.271 / 0.679 / 2.6% | 0.281 / 0.680 / 1.7% | 0.282 / 0.659 / 1.6% | 0.297 / 0.685 / 1.4% | 0.290 / 0.687 / 0.8% |
| moonless overview | 0.253 / 0.840 / 3.4% | 0.255 / 0.844 / 2.1% | 0.244 / 0.958 / 2.3% | 0.247 / 0.967 / 1.8% | 0.266 / 1.003 / 4.9% |
| moonless street | 0.240 / 0.968 / 5.5% | 0.242 / 0.970 / 4.7% | 0.235 / 1.075 / 4.8% | 0.242 / 1.099 / 2.8% | 0.242 / 1.085 / 8.1% |

Every camera and hour stays within 0.03 luma of High. Pairs: `towers-low-night-grade-{before,after}.jpg` (moonless street).

Showcase lineup (`scripts/towerlab.mjs`), tower-wall luma, clear noon, fill K 0 -> 0.35: shade side mean 35.2 -> 45.9, median 32.5 -> 49.1,
under 20 38.2% -> 28.4%; sunlit side 92.8 -> 101.5. K 0.7 and 1.1 flatten the form (the shade side approaches the sunlit one).

## Cost

PERF_PLACEHOLDER

## Tests

Run on a snapshot of the final code (port 5183, `scripts/snapshot.mjs`, frozen copy of commit 3), Low and High as each script asks:

| test | result |
| --- | --- |
| `shadercheck` | pass (no sin-based hashes in 137 source files; needs no GPU) |
| `qualitytest` | pass (tree counts, land value, traffic budget and trip launches equal on Low and High; no page errors) |
| `nighttest high` and `nighttest low` | pass: roads 91 / 83 / 71 median (target 50), pools p90 163 / 157 / 132 (target 100), facades 165 vs 68 ground (target 20 apart), 0.03% blown out (target 1%), pools off by day |
| `nightglow` | pass (the street at night 52.8 against 153.5 at noon, under 70%; no amber specks in smoke) |
| `treelod` | pass (canopy cover 50,689 vs 59,060 px; no page errors) |
| `impostortest` | pass (every species has both billboards on the phone) |
| `glcheck` | pass (0 GL error hits) |
| `reflecttest` | pass |
| `starttest` | pass |
| `tiptest`, `overlaptest` | pass |
| `touchtest` | **fails, on the old build too** (`page.tap: #ta-build` is disabled after "Zoning toggled off, tap map"; the same step on the 5175 build). UI logic, not touched by this change |

The phone UI checks were run because CSS might have moved; it did not (no CSS was edited).

## What I did not get to

- Ground: Low's tan ground reads flat, but its mean luma matches High's, so I did not touch it (the earlier pass tuned the terrain
  shader; a Low-only cheap detail or contact darkening was the next candidate).
- Saturation and contrast (1.08 and 1.06) and the vignette of the grade are still not on Low: they need a pass, or a per-material
  patch of every shader. The weather's saturation (rain 0.84, storm 0.76) is not reproduced by tinting lights.
- The lit windows of `glassA/C` at night are chunky white rectangles at a distance (the 512-px tile's emissive is 125 px wide);
  they belong to the night helper's warm-light pass.

## New scripts (README lines)

```
node scripts/towers.mjs low       # tower-facade luma on the reference block (mean, std-dev, share under luma 20/40, percentiles) at noon and night; PHONE=1, OUT=dir saves JPEGs; BASE_URL for old vs new
node scripts/towerlab.mjs low     # the showcase lineup (every zone x level) beside the block, swept over glass / wall-fill settings (SETS=), class-masked luma per shot
node scripts/lowperf.mjs low      # frame time of two builds side by side (A_URL old, B_URL new) on the reference block, plus draw calls and triangles
```

`scripts/lookbook.mjs` gains `VIEWS=` and `JPEG=dir`, `scripts/presetlight.mjs` gains `ONLY=`, `VIEWS=` and `EVAL=`.
`scripts/lib/towermask.mjs` is the shared mask and statistics.
