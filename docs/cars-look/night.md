# night: the yellow flashing on Ultra, and cozy warm night lights

Helper `night`, branch `wt/night`. The owner's two night decisions from
`docs/HANDOFF_CARS_LOOK.md` (2026-09-30), in the order asked.

## 1. "Work on the yellow flashing again on Ultra"

### Reproduction

`scripts/yellowflash.mjs` (new) opens the reference block on **Ultra**
(640x360, DPR 1: the pixel ratio is `min(devicePixelRatio, 2.25)`, so on a
1x-2x screen Ultra renders at the same ratio as High), steps traffic, sets
23:00 and renders consecutive frames at a real dt, reading each one back:

- camera still for 4 s (40 frames at 0.1 s): what blinks;
- camera panning ~2 m/s with a slow orbit (30 frames at 1/30 s): what
  shimmers; moonless and full moon, clear and rain.

A **flash pixel** is a bright, saturated yellow-to-amber pixel (hue 25-75,
max >= 150) at least 45 luma brighter than anything within 5 px of it in the
previous frame. The camera moves a few pixels a frame, so a steady light
never counts; something that pops on does.

On the old code (5175) the still camera showed a flash of ~100 px every
0.7 s, right on schedule. Hiding candidates one at a time:

| still camera, moonless, 4 s | flash px / frame | worst frame |
|---|---:|---:|
| everything drawn | 9.6 | 106 |
| additive particle pool hidden (fire, sparks) | 0.2 | 3 |
| fire hidden, fireflies at Appalachian-summer density (420) | 0.3 | 3 |

The flashes sit exactly on the screen positions of the fire emitters of
*Sweet Trouble*, *Loyalty Lab* and *Propane Paradise* (the script prints the
emitters it projects).

### Cause

**Prop flames.** Every burn barrel in a yard, dumpster and tire fire in a
lot, flare stack and the Liberty waver's torch is a building emitter of
kind `fire`. Each tick (0.6 s) it had a 50% chance to emit two HDR particle
puffs (`particles.ts`, colour up to 4.0/2.7/1.0) that were 3.2 m across,
appeared at full brightness on their first frame, and were **not divided by
the night lift** (`GLOW`), so after dark they were lifted 1.85x and bloomed
(bloom threshold 1.1 at night). With the skipped ticks each flame blinked on
and off every 0.6-1.2 s as a bright yellow-white blob: the "yellow flashing".
Nothing in it is Ultra-only (the emitters, particles and bloom are the same
on Medium, High and Ultra; Low has no bloom but the same HDR puffs); Ultra is
the preset the owner plays on at a desk. With the particle pool hidden, the
Ultra runs showed no other flashing (0.2 px a frame), so Ultra's own
differences (full-res AO, 4096 shadow map, denser ground cover and trees)
are not it. Not tested: a screen above 2x, the only place Ultra's 2.25 pixel
ratio differs from High's 2.

The earlier "rapid glowing snowfall" (G4) was traced to bright rain streaks
(`weather.ts`) and lime HDR fireflies (`POLISH_AUDIT.md`); the fireflies were
still lifted 1.85x and drifted over lit roads and lots, so I cleaned them
up too (they fade in over ~0.3 s, so they never
counted as flashes).

### Fix

- `src/render/particles.ts`: fire and spark particles are divided by `GLOW`
  like every other light; a fire puff grows in over the first fifth of its
  life instead of popping in.
- `src/game.ts` (three lines, commented): prop flames emit on every tick (no
  on/off gaps), at 0.6 size and 0.3 m spread (a flame that fits a barrel).
- `src/world/weather.ts` fireflies: divided by `GLOW`; none where the
  practical-light texture lights the ground (light pollution; the design doc:
  "the fireflies go first"); never smaller than ~1.5 px (dimmed by the size
  ratio), so they don't twinkle across the pixel grid; 2.4 x GLOW. Still
  drawn where it's dark: in the houses' back yards (ff=1) they add 92 yellow
  px a frame (old 122); over the lamp-lit street, noise (old 1, new 10).

### Numbers (flash px per frame, mean / worst frame; old 5175 -> new)

| case (Ultra, 640x360) | old (5175) | flash fix only | final code |
|---|---|---|---|
| still, moonless clear, 4 s | **9.6 / 106** | 1.2 / 11 | 1.7 / 16 |
| still, fireflies x9 (Appalachian summer) | - | - | 1.6 / 9 |
| pan ~2 m/s, moonless clear | **4.0 / 105** | 0.7 / 11 | 1.6 / 21 |
| pan, full moon clear | **6.2 / 170** | 1.1 / 18 | 2.1 / 25 |
| pan, moonless rain | 0.4 / 5 | 0.8 / 15 | 1.4 / 17 |
| pan, full moon rain | - | - | 1.1 / 17 |
| still, fireflies x9, fire hidden | 0.3 / 3 | 0.2 / 2 | - |

Limits: mean <= 4 and worst frame <= 40 per case. Old: **FAIL** in 3 cases;
new: all pass, with 0 GL errors and 0 failed shader builds. Flames are
random (the old rain run happened to miss an emission tick). The final-code
column is a little higher than the fix-only one because the warmer windows
put more pixels in the yellow class; it is still an order of magnitude under
the old flashes. (The final check ran before the last firefly-visibility
commit, 8e31e1d; fireflies never registered as flashes, 0.2-0.3 a frame.)

Images: `docs/screenshots/cars-look/night-yellowflash-before.jpg` /
`-after.jpg` (the same frame of the still case, on an emission tick;
magenta boxes are the flash pixels the check found; the white-pink blob at
the shop front is the flame).

## 2. "Make it cozy warm night lights"

### What was cold

- **Pools** (`world/nightLights.ts`): the fixture colours are linear light
  but were written like sRGB, so a "sodium" pool showed on screen as a pale
  cream (255,218,171), and the yard and big-lot floods were 6500 K blue.
- **Lit rooms** (`art/facades.ts`): 30% cool white and 15% TV blue; and the
  warm ones were so pale that at night's brightness the tone curve washed
  them to cream (`#ffc670` showed as 243,226,181). Offices, the ribbon
  windows and the clinic/gym were cool white.
- Kit windows (services, communes, scaffolds): pale peach and cool blue.
  Street lamp heads: pale yellow.

### Changes (colours only; signs keep their brand colours, car lights are the lead's)

- Pools, encoded from the on-screen colour: sodium 255,184,110 (street);
  incandescent 255,213,169 (shops, entrances, civic); warm-white LED
  255,228,199 (yards, big lots); amber 255,191,122 (porches).
  `POOL_GAIN` 1.85 -> 2.25 for the luma the tint lost.
- Rooms: amber and warm white, 6% blue TV left; deeper warm colours
  (`#ffa94d` shows as 248,209,127); offices, ribbon windows, clinic/gym,
  house window decals, lampWarm/lampWhite tiles all warm. `litColor` makes
  the same random draws, so the same windows are lit with the same blinds.
- Kit windows amber / warm white; lamp heads sodium `0xff9c44`.
- `docs/ART_DIRECTION.md` "Practical light" updated (and the linear-colour
  pitfall noted).

### Numbers

`scripts/nightwarmth.mjs` (new): the lookbook's street, overview and houses
cameras, High, moonless and full moon. "Added light" is the frame minus the
same frame with the practical lights switched off (pools, windows and signs,
lamp heads), summed in linear light: the colour of the light itself. CCT by
McCamy from CIE xy (display white = 6500 K; on this scale the new sodium
pool colour is ~3000 K and warm white ~4000 K). Mean of the 6 frames:

| | old | new |
|---|---|---|
| added light | 5032 K, R/B 1.58 | **3830 K, R/B 2.85** |
| brightest 2% of pixels | 6051 K, R/B 1.08 | 5257 K, R/B 1.26 |
| lit pixels (luma >= 110) | 5612 K, R/B 1.28 | 4612 K, R/B 1.54 |

The brightest 2% are mostly moonlit roofs and sidewalks (the cool night
fill, deliberately left alone: warm lights against a cool night is the cozy
read, and the night grade is being worked on by `towers`).

nighttest (High; moonless / full moon / rain), old -> new, all pass:

| | old | new | target |
|---|---|---|---|
| road median | 91 / 83 / 70 | 87 / 76 / 67 | >= 50 |
| pools p90 | 163 / 157 / 131 | 158 / 150 / 127 | >= 100 |
| facades p90 vs ground median | 164/68, 173/47, 163/40 | 156/67, 161/46, 155/39 | 20 apart |
| blown out | 0.03 / 0.03 / 0.01% | 0.01 / 0.00 / 0.00% | < 1% |
| day road median (pools off) | 120 | 119 | unchanged |

Images (High, 1280x720, same cameras):
`docs/screenshots/cars-look/night-warm-{moonless,fullmoon}-{street,overview,houses}-{before,after}.jpg`.

## Tests

(run on a snapshot of the final code, 5185, unless noted)

- `nighttest` high: all OK (numbers above).
- `nightglow`: all OK, old and new. Its town is grown fresh each run, so
  its street mean isn't comparable between runs (old 46.7 vs 144 at noon,
  new 99.2 vs 153; both under the 70% bar); 0% blown, 0% amber specks.
- `yellowflash` (new, default cases, Ultra): all OK on the final code
  (table above); FAIL on the old code (3 cases). The firefly-visibility
  cases after 8e31e1d: shaders build, 0 GL errors, fireflies drawn.
- `shadercheck`: OK (no sin hashes).
- `tsc --noEmit`: clean.
- Not run (slots are shared and busy; my changes don't touch what they
  test): `qualitytest` (game.ts only changes which particles are emitted;
  no sim, trees or traffic), `glcheck` (hard-coded to 5173; the yellowflash
  run counts GL errors and failed shader builds instead), `treelod`,
  `impostortest`, `reflecttest`, `starttest`, `audiotest`, `motiontest`,
  `scaletest`, `junctiontest`, the UI set, `drawcalls`, `perfTown` (nothing
  new is drawn: no new meshes, materials or draw calls).

## README lines for the new scripts

```
node scripts/yellowflash.mjs      # night flashing on Ultra: bright yellow pixels that pop on from one frame to the next (still camera and panning, moonless/full moon, clear/rain), GL errors and failed shader builds
node scripts/nightwarmth.mjs      # how warm the night lights are: colour temperature of the practical light on the reference block's lookbook cameras (OUT=dir saves JPEGs; MAX_CCT=K makes it a check)
```

## Not done / notes

- Signs keep their brand colours (content); car headlights and the vehicle
  light shader are the lead's.
- `src/art/facades.ts` (also edited by `towers`): my change there is colour
  constants only (the `LIT` palette and `litColor`'s last branch, and the
  `litCol`/`litPane`/glow-tile colour literals), no structure, so a merge
  conflict is a pick-both of hex values.
- Not tested on a screen above 2x, where Ultra's 2.25 pixel ratio differs
  from High's 2.
- The moonlit fill stays cool (see above). A warm sodium sky glow on the
  night fill, scaled by light pollution, would warm a big town further; it
  is a small change in `world/sky.ts` if the owner wants more.
- Found in files I may not edit: `agents/communes.ts` turns each commune's
  campfire `PointLight` visible/invisible when the camera crosses 420 m. That
  changes the scene's light count, so every material recompiles (a hitch),
  and its intensity (`night * 25`) isn't divided by `GLOW`. Proposed: keep the
  light always in the scene (intensity 0 when far), times `GLOW.value`.
- The vehicle turn signals and emergency bars blink by design (`vehicles.ts`,
  the lead's); they did not show up as flashes in these runs (35 cars).
