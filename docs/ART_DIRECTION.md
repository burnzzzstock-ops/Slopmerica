# Art direction

How SLOPMERICA should look, and how to check it. Written after playtest 5's
graphics review ("build one representative polished block before changing
the full asset library"). The satire lives in the signs, the land use and
the civic details; the rendering underneath should read as a believable
American town at any hour, so the jokes land on something real.

## The reference block

One block carries the standard: a stroad with a side-street grid, strip
retail with parking out front, a shopfront row, offices, apartments, a
subdivision of houses, a factory yard, a school, a fire station, a sheriff,
a clinic and a park, on the Redwood Coast near water. Every look change is
judged there first, then rolled out.

- `scripts/lookbook.mjs` grows the block once (saved to
  `shots/lookbook/town.json`, so every later run shows the same town) and
  shoots fixed cameras at noon, dusk, a moonless night, a full-moon night and
  a rainy night, on each quality preset. Compare runs side by side before
  and after a change.
- `scripts/nighttest.mjs` measures the night exposure targets below on the
  same block.

## Materials and texel density

Everything on a building comes from one 4096² atlas (plus a 2048² satire
sheet) or, for city services, communes and scaffolds, a texture array. Tile
sizes are set where the painter and the preset meet (`art/facades.ts` and
`buildings/blocks.ts` must agree).

| Surface | Tile | Density | Notes |
| --- | --- | --- | --- |
| Brick | 256 px / 2 m | 128 px/m | the one fine pattern; needs it for coursing to read |
| Shopfront, house siding | 512 px / 8 m, 256 px / 4 m | 64 px/m | the target for anything with windows seen at street zoom |
| Apartment and office facades | 512 px / 12 m | ~43 px/m | window rhythm carries these; detail goes in the window, not the wall |
| Stucco, concrete, metal panel | 256 px / 4 m (stucco, metal at half res) | 32 to 64 px/m | low-frequency; half resolution saves atlas for signs |
| Flat roofs | 256 px / 8 m | 32 px/m | seen from above at distance; texture noise here fights the buildings |
| Shingles | 256 px / 4 m | 64 px/m | |

Rules:

- **Target 43 to 64 px/m** on walls; only brick goes higher. A new tile
  outside that range needs a reason in its comment.
- **Tint, don't repaint.** One grey-scale-ish tile tinted per building by
  vertex colour gives variety without atlas space.
- **Windows carry the detail.** Every window has a frame, a sill, a reveal
  (a shadow line along the head and left jamb, a lit right edge) and head and
  jamb shade on the glass, so it reads as set back into the wall
  (`win()` in `art/facades.ts`).
- **Lit windows aren't flat panels.** The head shades the top of the glow, the
  ceiling light falls off toward the floor, furniture cuts the bottom of most
  rooms and some have blinds down (`win()` and `litPane()`). Flat full-bright
  panes were what blew out to white at night.

## Silhouettes by class

Read the class from the silhouette before the sign.

- **Houses:** pitched roofs with overhang, fascia and soffit; porches, garages.
- **Strip retail:** low box, tall parapet sign band, parking in front, one
  tall pole (a pole sign *or* a flag, not both).
- **Offices and apartments:** stacked floors, a base (podium or storefront
  floor) distinct from the shaft, rooftop plant.
- **Industry:** big low sheds, tanks, stacks, yard floodlights.
- **Civic:** a clear entrance (canopy, steps, flagpole), a named sign, one
  landmark element (the fire station's hose tower, the school's gym, the
  hospital's helipad).
- **Every flat roof** gets a parapet with a pale **coping** that oversails the
  wall, so the roof line has an edge and a shadow line (`parapet()` in
  `buildings/mesh.ts`).

## Props

Restraint: props explain a lot; they don't compete with the building.

- One tall pole per strip lot (curb-hype flags only go up where there's no
  pole sign or flag yet). Flagpoles are satin aluminium, not paint-white.
- Pole signs, tube men, billboards and flags are the satire of the stroad;
  keep them at the curb, where they face traffic.

## Ground, lots and water

- **Lawns** are the map's own grass, pushed greener (a watered lawn in dry
  country is the point), mottled, and blended over the lot's edge cells. Never
  a single flat green slab.
- **Paved lots** are asphalt-grey; the lot's paving is part of the building
  model and blends to the terrain with the lot's grading feather.
- **Shores** are uneven mud and wet sand, with real beaches only where the
  map draws them. Water fades out over the last 35 cm of depth, so the edge
  follows the smooth depth contour, not terrain triangles. The white lap line
  is a coastal thing; rivers and ponds get a dark wet margin.

## Light

### Day

ACES filmic, graded in display space (`render/post.ts`). Weather and season
tint the grade; the sun key is the only strong shadow.

### Night: exposure targets

The eye adapts: the night is exposed up by up to 1.85x on a moonless night
(`nightLift` in `config.ts`), less under a bright moon. Everything that glows
is divided by that lift, so lamps stay lamps and don't bloom into discs.

Targets, measured by `scripts/nighttest.mjs` on the reference block at High
(display luma 0 to 255, from a class mask of facades, road surfaces and
everything else):

| | Target | Why |
| --- | --- | --- |
| Road surfaces, median | at least 50, every night | streets are the readable skeleton of the town |
| Roads under lamps (90th percentile) | at least 100 | pools read as pools |
| Facades (90th percentile) vs ground (median) | at least 20 apart | buildings separate from the ground by their lit windows and lit feet |
| Blown-out pixels (over 245) | under 1% | nothing turns into a white disc |
| Day | unchanged | practical light is off by day |

### Practical light

Street lamps, shopfronts and their parking lots, office and apartment
entrances, civic sites, factory yards and porches throw pools of light
(`world/nightLights.ts`). The pools are painted top-down into one texture over
the built-up area, repainted when roads or buildings change, and every
ground-level surface adds that light times its own colour: a pool on asphalt
stays asphalt-dark, one on a pale sidewalk reads bright. Walls take it on
their bottom 3.5 m. One texture read per pixel; nothing per lamp per frame.

- Street lamps: high-pressure sodium, warm orange.
- Shops, entrances, civic: warm white.
- Factory yards and big lots: cool LED.
- Porches: warm, small, not every house.

The night grade turns moonlit shadow blue and colourless, but where a lamp
lights, colour comes back (the eye sees colour where it's bright), so sodium
stays orange and a shop sign stays red.

## Performance

Look changes are paid for in frame time. `scripts/perfTown.mjs` tracks frame
time, worst frames, draw calls and triangles per preset; `scripts/reflecttest.mjs`
guards the water mirror pass (no per-material shader variants, no first-look
hitch). Prefer atlas tiles, instancing and baked detail over new materials and
draw calls.
