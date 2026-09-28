# Graphics handoff: SLOPMERICA

You're taking over graphics work on SLOPMERICA, a satirical American city
builder (three.js r186, TypeScript, Vite, no framework). The goal is a town
that looks believable at every zoom, hour, weather and quality preset, so the
satire in the signs, land use and civic details lands on something real.
Gameplay, UI copy and satire content are not your job; leave them alone.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base your work on the tip of
   `claude/festive-bohr-nugn55`, and push to the branch your session is
   given. Don't open a pull request unless you're asked.
2. Read `docs/ART_DIRECTION.md` (the style guide, texel densities, night
   exposure targets), the test list in `README.md`, and
   `docs/WORKSTREAMS.md` (who owns which files).
3. `npm install` if needed, then `npx vite --port 5173` for the dev server.
   Debug hooks in the page: `window.__game` (the whole game), `window.__dbg`
   (`road`, `zone`, `run(days)`, `view(x, z, dist, yaw, pitch)`, `hour(h)`,
   `save()`), `window.__services`.

## Rules

- **No new npm dependencies.** Everything is hand-built on three.js.
- **Offline game.** Nothing in `src/` calls a network API. No API key goes in
  `src/`, the bundle, a `VITE_` variable, a log or a commit.
- **Content belongs to the owner.** Don't rename brands, rewrite jokes or
  change sign text. `src/content/*`, `src/art/*`, `src/buildings/*`,
  `src/agents/people.ts` and `src/agents/vehicles.ts` take additive, clearly
  commented changes (graphics work in `src/art` and `src/buildings` is fine;
  keep it to looks).
- **Graphics must not change the simulation.** Quality presets only change
  how things are drawn (`scripts/qualitytest.mjs` guards this).
- **Measure, don't eyeball.** Every change gets a before/after capture from
  the same camera and, wherever possible, a number, checked against a
  snapshot of the old code. Put the numbers in the commit message.
- One improvement per commit, pushed as you go.

## How to test (read this, it will save you hours)

- Headless Chromium through `playwright-core`, executable
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, args
  `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`. It is a
  software GPU on 4 cores: a page load takes 2 to 3 minutes and a capture
  about a minute. Give screenshots `timeout: 180000`. Run at most two browser
  jobs at once.
- **Editing `src/` while a test runs against the 5173 dev server hot-reloads
  the page and silently breaks the run.** For anything long, copy the tree
  (without `node_modules`, symlink it instead) to a snapshot directory and
  serve that with its own Vite config (`port 5175`, `hmr: false`,
  `watch: null`). The same snapshot of the *old* code is your "before".
- `scripts/refblock.mjs` grows the reference block once (a stroad, strip
  retail, offices, apartments, houses, a factory yard, school, fire station,
  sheriff, clinic, park; saved to `shots/lookbook/town.json`) and reopens it
  mid-summer with the loop stopped. Build new captures on it.
- `scripts/lookbook.mjs [low,medium,high,ultra]` shoots the block from fixed
  cameras (overview, street, houses, shore) at noon, dusk, moonless night,
  full moon and rain, with a contact sheet at `shots/lookbook/index.html`.
- Phones: a touch device defaults to the **Low** preset at a pixel ratio above
  1 with MSAA. Always check a phone-shaped context too:
  `{ viewport: {width: 390, height: 780}, deviceScaleFactor: 3, isMobile: true, hasTouch: true }`.
- Graphics tests that already exist and must keep passing:
  `nighttest`, `treelod`, `impostortest`, `reflecttest`, `starttest`,
  `nightglow`, `qualitytest`, `glcheck`, `shadercheck`, plus the UI set
  (`tooltest`, `uisweep`, `tiptest`, `overlaptest`) since HUD and 3D share
  the screen. `perfTown.mjs` for frame time, draw calls and triangles per
  preset.

## Pitfalls already paid for

1. `renderer.setViewport` / `setScissor` are scaled by the screen's pixel
   ratio. When rendering into a render target, set `rt.viewport` /
   `rt.scissor` instead. (This made distant trees vanish on phones.)
2. `renderer.clippingPlanes` gives every material a second shader variant:
   a 124 ms hitch the first time, and a program switch per material every
   frame. The water mirror uses an oblique near plane instead; do the same
   for any new clipped pass.
3. Materials are shared by many meshes. If a debug or mask pass toggles
   material state, remember each material once and restore it, and restore
   the renderer's clear colour. (A mask pass that got this wrong made every
   later capture lose its terrain.)
4. Night: everything self-lit (windows, signs, lamps, bloom) is divided by
   the night exposure lift (`GLOW` in `src/config.ts`), so lamps stay lamps.
   Ground-level practical light comes from `src/world/nightLights.ts` (one
   top-down light texture). The night grade desaturates only moonlit pixels
   (`src/render/post.ts`).
5. Trees: detailed 3D trees near the camera, billboards baked at load beyond
   that (`src/world/trees.ts`). Both use a *capped* per-mip alpha boost.
   Uncapped, the billboards turned into opaque rectangles (playtest 5). The
   far billboards cast no shadows.
6. Save files: after `__dbg.save()` the save is
   `localStorage['slopmerica.save.v1']`. Set `g.sim.day = 120` (summer) and
   run a frame before `g.weather.settle()`, or you'll get snow.

## Where things live

| Area | Files |
| --- | --- |
| Terrain, lots, lawns, shore bands | `src/world/terrain.ts`, `groundTextures.ts`, `groundDetail.ts` |
| Water, reflections, foam | `src/world/water.ts` |
| Sky, light, fog, weather, clouds | `src/world/sky.ts`, `weather.ts`, `atmos.ts`, `clouds.ts` |
| Trees | `src/world/trees.ts`, `foliage.ts`, `seasons.ts` |
| Night practical light | `src/world/nightLights.ts` |
| Post (AO, bloom, grade, tone) | `src/render/post.ts` |
| Roads, sidewalks, lamps, street furniture | `src/roads/roadMesh.ts`, `streetDetails.ts` |
| Zoned buildings | `src/buildings/*` (generators per zone, `mesh.ts` builder, `material.ts` atlas material) |
| Facade and sign art (atlas) | `src/art/facades.ts` and friends |
| City services (kit models) | `src/buildings/serviceModels.ts`, `kitGenerator.ts` |
| Asset Vault models, civic furniture | `src/vault/*`, `src/civic/*`, `docs/ASSET_VAULT.md` |
| Quality presets | `src/config.ts` (`QUALITY`) |

## Where it stands

Playtest 5's graphics review drove the last pass. Done and measured:

- **Night light:** road median luma 71 / 56 / 53 (moonless / full moon / rain;
  target at least 50); pools p90 at least 120; under 0.1% blown out.
- **Windows:** reveals, head shade, lit panes read as rooms.
- **Roofs:** parapet coping.
- **Lawns:** blended, in the map's palette.
- **Shores:** edge fade and muddier banks (not checked on a gentle bank yet).
- **Water mirror:** first-look hitch gone (12.9 s to 4 ms on the software GPU).
- **Distant trees:** fixed on phones; far canopy cover 76 to 79% of the
  detailed trees'.
- **Props:** one tall pole per strip lot.

## The work, in order

Take these in order. For each: look first (lookbook shots, a close-up),
decide the smallest change that fixes it, build a check that fails before and
passes after, then commit.

1. **Roads and their joins.** Roads read as broad, flat, dark slabs with
   harsh joins at curbs, driveways and the ground, and striped vertical slab
   edges show on slopes. Build a consistent road section: curb faces,
   gutters, a sidewalk-to-verge transition, driveway aprons where lots meet
   the road, rounder corner radii, edge decals. Add subtle wear only after
   the geometry is right. Check it on a slope and at an intersection, day
   and night.
2. **Ground noise at distance.** The fine ground texture competes with
   buildings when zoomed out. Fade the detail with distance, keep it close
   up. Add verges and planting beds at lot edges so zoning still reads
   without a hard tile line.
3. **Long blank walls.** Strip retail and big commercial boxes show
   unsegmented planes. Add articulation in the generators: a plinth at the
   base, pilasters every few bays, a sign band, awnings where they fit.
   Prefer shared helpers in `src/buildings/mesh.ts` so every generator gets
   them.
4. **Civic silhouettes.** The school, sheriff and utilities read as plain
   boxes. The default looks come from Asset Vault models (packed data), so
   read `docs/ASSET_VAULT.md` first and decide whether to change the pack or
   add an overlay; don't break the pack format or its tests (`vaulttest`).
5. **Tree variety and placement.** Too many identical trees. Vary scale, hue
   and species in controlled ranges, and cluster them the way real land does:
   street rows, riparian bands along water, windbreaks, yard specimens, ragged
   woodland edges. Keep instancing. Consider a cheap darkening under far
   billboards so distant forest isn't lighter than the near forest's shadow.
6. **Shorelines on gentle banks.** Check Appalachia's river and Florida's
   coast from low angles; add reeds and rock bands and irregular grading, and
   make sure the water edge follows the depth contour, not terrain triangles.
7. **Per-preset review.** Run the lookbook on low, medium, high and ultra and
   fix what reads worst on each. Low on a phone matters most, because that's
   what the owner plays on.
8. **Performance.** `perfTown.mjs` before and after the whole pass. Nothing
   you add should cost a new draw call per building or per tree.

## Finishing

- Run the full graphics and UI test list on a snapshot of your final code.
  Every test passes, or you say exactly which one fails and why.
- `npm run build:single` builds `dist-single/index.html` (plus
  `dist-single/vault/pack.json` and `pack.b64.txt`). Grep the bundle for API
  keys and the word `typesafe` before sharing it anywhere; both must be
  absent. The playable build is published at
  https://claude.ai/artifact/T6bRhiwVmjT1ZL2QBanWaX. If you can publish,
  update that URL (read it first) with the page and the two vault files.
- Report plainly: what changed, before/after numbers, a before/after image
  pair per item, what you didn't get to, and anything you're unsure about.
