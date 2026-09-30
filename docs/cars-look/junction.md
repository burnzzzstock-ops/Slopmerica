# Junction mouths (audit #12)

Branch `wt/junction`. Files: `src/roads/roadSection.ts` (the numbers), `roadJunction.ts` (the drawn shape),
`roadMesh.ts` (the zebra strip), `streetDetails.ts` (the crosswalk's transverse lines, stop bars, sign posts). `network.ts` and `traffic.ts` are
untouched, and the network the cars run on is bit-identical (proof below).

## What was wrong

The audit said "four-way stops are very wide slabs of asphalt". Reproduced on High (day and night, `junction-*-before.jpg`).
Measured on the old code, the wide look had four causes, and the corner radius was only the first:

1. **The kerb return.** Two-lane x two-lane at a right angle had a 5.0 m radius, so the plain asphalt box between the four
   zebra crossings was 17.6 m across on a 7.6 m street (231 m2 of unmarked asphalt, 22 m2 of it outside the two roads' own
   strips).
2. **The paint sat far behind where the cars stop.** The zebra started 0.7 m past the ribbon's start (8.8 m from the node),
   the stop bar 4.45 m past it. The network stops a car's centre 1.5 m short of its trim (`traffic.ts`: `exitS - 1.5`), which puts
   a 4.5 m car's nose 7.2 m from the node: in 158 of 162 legs I measured (all class pairs and angles) the nose of a stopped car
   was on the zebra, and the stop bar was up to 11.8 m behind the nose.
3. **Skewed junctions.** Below 90 degrees the two neighbouring walks overlap, so the leg's ribbon can only start where the walks'
   outer edges cross (11.1 m from the node at 60 degrees for two-lane streets). The acute corner was refused a kerb return
   (needed radius under the 2.2 m floor once the sim's trim limit applied), so it was a straight chamfer.
4. **Wide roads.** A stroad crossing keeps its 17.5 m of lanes; nothing in the corner can change that.

## Real references (recalled from the sources listed; nothing here is copied text)

| what | number | source |
|---|---|---|
| standard kerb radius | 10 to 15 ft (3 to 4.6 m); "many cities use as small as 2 ft"; over 15 ft should be the exception in urban settings | NACTO Urban Street Design Guide, Corner Radii |
| municipal design manuals (kerb return radius) | local-local 15 ft (4.6 m); local-collector, local-arterial 20 ft (6.1 m); collector-collector, collector-arterial 25 ft (7.6 m); arterial-arterial 30 to 35 ft (9 to 10.7 m) | City design standards found by search (Corpus Christi Infrastructure Design Manual and others) |
| effective turning radius | is bigger than the kerb radius when there is a parked lane, a bike lane or several lanes to swing into | NACTO, same page |
| stop bar | at least 4 ft (1.2 m) in advance of the nearest crosswalk line | MUTCD 3B.16 |
| crosswalk width | at least 6 ft (1.8 m) with longitudinal lines | MUTCD 3B.18 |

Reading them against this game: a US local street is 8 to 9 m wide with a parked lane each side. These roads have none, so
the kerb *is* the lane edge. What decides the smallest honest radius here is the game's own turning curve (the cubic each car
follows from the lane at one leg's stop line to the lane at the next leg's entry), not a manual: I keep at least
1.3 m of asphalt between that curve and the kerb (0.35 m to spare beside a 1.9 m car), at every angle. At a right angle between
two-lane streets that is a 2.2 m radius; I use 3.0 m, the low end of NACTO's standard, so the old 5.0 m (inside the municipal
range) is now the tight-urban 3.0 m.

## What changed (three commits, then the scripts and this note)

**1. Kerb returns** (`roadSection.ts curbReturnRadius`, `roadJunction.ts`).
- Radius at a right angle: `r90 = clamp(0.35 + 0.7 * (0.75 * lo + 0.25 * hi), 2.4, 3.6)` where `lo` and `hi` are the two
  roads' kerb offsets (carriageway half + gutter). Two-lane x two-lane: 3.0 m (was 5.0). A side street onto a stroad and
  stroad x stroad: 3.6 m at most (was 4.6 and 3.8, which the old code reached by clamping). The smaller road counts three
  times as much as the bigger: a wide road's extra lanes give a turning car room to swing.
- Across the angle the flare keeps one length: `r = r90 * tan(phi/2)` (capped at 2.4 x r90), so the tangent distance
  `r / tan(phi/2)` stays `r90`. Acute corners get a small arc instead of the straight chamfer the old code fell back to; obtuse
  corners a bigger one. That is not taste: the game's turning curves cut close to an obtuse corner's apex, so it needs the
  asphalt, and stay far from an acute corner's tip. (My first version shrank acute and kept obtuse at r90; the sweep in
  `junctionmouth.mjs --sweep` showed the obtuse corners dropping to 0.8 m of clearance, which is why.)
- Then a solve against the cars. `carClearance()` builds the cubic `traffic.ts enterJunction` builds (from the kerb lane at
  one leg's stop line, `seg.length - trim`, to the kerb lane at the next leg's entry, control points 0.42 of their distance
  along the two headings), both directions, and the arc grows in 0.25 m steps until 1.3 m of asphalt (`CAR_CLEAR`) lies between
  the curve and the kerb, within the room the old clamps allow (tangent within 1.5 m of the network's trim, within the walk's
  outer corner). It reads `trimA/trimB` and the lane offsets; it moves nothing. If the traffic pass changes that curve, this
  function is the one line to change; `node scripts/junctionmouth.mjs --min-clear 1.25` will say so (it re-derives the curve on
  its own).
- `junctionShape()` is cached per node against a hash of what it reads (legs' ids, types, trims, lengths, end samples), because
  the solve made a call 3x dearer (23 -> 75 us) and the renderer asks for a node's shape dozens of times per rebuild. A cached
  lookup is 1.4 us.

**2. Paint that follows the corners and the cars** (`roadJunction.ts legMarks`, `roadMesh.ts`, `streetDetails.ts`).
- The zebra now starts `ZEBRA_SETBACK` = 0.45 m past the kerb line of the road it crosses (measured at the zebra's two ends, so
  the acute side of a skewed junction is cleared too), is 1.8 to 2.4 m wide (MUTCD 3B.18: at least 1.8 m), and ends 0.85 m short of
  the nose of a car stopped at the network's stop line (`NOSE_BACK` = 0.75 m short of the trim for a 4.5 m car). The stop bar sits
  0.6 m behind the zebra (MUTCD 3B.16 asks for at least 1.2 m in advance of the crosswalk line; the network's stop line leaves
  less than that at a right angle, see below). One function decides it for the zebra strip, the transverse lines and the stop bar.
- The old crossing was two systems drawn over each other: a textured strip (bars along the road) and seven transverse rungs
  0.34 m deep across the whole road, hidden by the strip's polygon offset except for their last few centimetres and the ends
  beyond it (the dotted white blocks and the loose line at the edge of the zebra in `junction-zebra-*-before.jpg`). Now the strip is
  framed by one transverse line at each end (a ladder crosswalk), and only at junctions of three or more roads: mid-block joins
  of two pieces of the same road used to get rungs on both sides.
- Paint that lies over the junction asphalt rides on it (the fan slopes from the node's height to the leg's at its mouth), so it
  does not sink into it on a hillside.
- Stop-sign and signal posts stay 3.6 m past the network's trim as before but never more than 2.5 m behind the stop bar.

**3. The lines take the lamp light** (`streetDetails.ts`). The instanced lines and stop bars went unlit through the night while the
zebra strip beside them took the lamp pools, so they read as blue slabs framing a warm crossing (see `junction-zebra-night-before.jpg`,
where the old loose rungs and the stop bar are blue). They go through `litByLamps` now, like the road meshes.

**A fallback that matters.** A grown or bent corner can fold the junction's outline or its corner slab. The old code then gave the
whole junction to the plain convex hull, which draws no sidewalk slab (node 45 of the reference block: 84 empty spots). Now the
offending arc is eased 0.5 m at a time (and becomes a chamfer below 1.5 m) before the hull is used, and the mouths are taken on each
leg's real, bending centreline, where the ribbon starts. `junctionmesh.mjs` reproduces the hole test on the real triangles in node.

## Numbers (old code -> new code; `node scripts/junctionmouth.mjs`, no browser)

"box" is the whole drawn junction polygon (the plain asphalt between the legs' ribbons, no lane paint); "flare" is the part of it
outside both roads' own strips, i.e. what the corners add to two crossing rectangles. "mouth" is how far from the node the
leg's ribbon starts. "car clearance" is the closest a car's turning curve comes to the kerb.

| roads | junction | radius m | mouth m | box m2 | flare m2 | car clearance m |
|---|---|---|---|---|---|---|
| twoLane x twoLane | crossing 90 | 5 -> 3.01 | 8.8 -> 6.8 | 231.7 -> 156.8 | 22 -> 7.9 | 2.13 -> 1.73 |
| twoLane x twoLane | crossing 75 | 5/3.59 -> 3.92/2.31 | 9.6 -> 8.4 | 249.2 -> 203.3 | 16 -> 7.9 | 1.82 -> 1.54 |
| twoLane x twoLane | crossing 60 | 5 -> 5.21/1.74 | 11.1 -> 11.1 | 292.9 -> 279.4 | 20.8 -> 7.3 | 1.36 -> 1.4 |
| twoLane x twoLane | T 90 | 5 -> 3.01 | 8.8 -> 6.8 | 182.7 -> 130.1 | 11 -> 4 | 2.05 -> 1.73 |
| stroad4 x twoLane | crossing 90 | 4.6 -> 3.6 | 13.7 -> 12.7 | 392.7 -> 333.9 | 18.7 -> 11.3 | 2.09 -> 2.02 |
| stroad4 x twoLane | crossing 75 | 7.4/2.51 -> 4.69/2.51 | 14.0 -> 13.7 | 438 -> 424.6 | 17.9 -> 10.1 | 2.04 -> 1.75 |
| stroad4 x twoLane | crossing 60 | - -> - | 16.0 -> 16.0 | 686.3 -> 686.3 | 109 -> 109 | 3.01 -> 3.01 |
| stroad4 x twoLane | T 90 | 4.6 -> 3.6 | 13.7 -> 12.7 | 348.4 -> 300.9 | 9.3 -> 5.7 | 2.05 -> 2.02 |
| stroad4 x stroad4 | crossing 90 | 3.8 -> 3.6 | 12.8 -> 12.7 | 615.4 -> 599.6 | 12.7 -> 11.3 | 2.11 -> 2.09 |
| stroad4 x stroad4 | crossing 60 | 7.7 -> 7.24 | 18.5 -> 18.5 | 974.7 -> 973.9 | 13.7 -> 12.9 | 1.37 -> 1.29 |
| stroad6 x twoLane | crossing 90 | 4.4 -> 3.6 | 16.9 -> 16.1 | 495.4 -> 437.5 | 16.9 -> 11.3 | 2.07 -> 2.02 |
| oneWay2 x twoLane | crossing 90 | 5 -> 3.01 | 8.8 -> 6.8 | 231.7 -> 156.8 | 22 -> 7.9 | 2.13 -> 1.78 |
| oneWay1 x oneWay1 | crossing 90 | 3.6 -> 2.4 | 6.0 -> 4.8 | 103.5 -> 74.2 | 11.3 -> 5.1 | 2.4 -> 2 |

(All 48 shaped class-pair x angle rows, including T junctions at 60 to 120 degrees, are in the appendix.)

At 60 degrees and for stroad crossings below about 70 degrees nothing changed: the ribbon's start there is set by the
sidewalks' outer edges crossing (11.1 m for two-lane streets at 60 degrees), and a stroad's chamfered corners are refused a
fillet by the rule that the tangent stays within 1.5 m of the network's trim. I left both (see "Not done").

Reference block (24 junctions of 3 or more legs, `shots/lookbook/town.json`):
- the 20 two-lane four-ways: box 4584 -> 3382 m2 in total, flare 377 -> 168 m2;
- all 24: box 6876 -> 5636 m2, flare 649 -> 427 m2;
- car clearance, worst drawn kerb return: 1.30 (old, its chamfers included) -> 1.31 m; every fillet is at 1.3 m or more.

Paint (162 legs of the synthetic set, 94 of the block): at a right angle, 42 of 42 stopped cars' noses used to be on the zebra
(the nose 2.4 m beyond it, the stop bar 6.1 m behind the nose); now 3 of 42 (stroad legs where the network's stop line is closer
to the crossing than a full crosswalk needs). Median distance from the stop bar to the nose 6.70 m -> 0.69 m. Zebra 2.8 m wide
-> 1.8 to 2.4 m. The crossing sits 4.3 to 6.3 m from the node on a two-lane four-way (was 9.5 to 12.3).

Odd layouts (still drawn as shaped junctions): Freedom Circle R 28 box 172.7 -> 130.3 m2, flare 13.8 -> 8.6; R 18 box 167.1 -> 129.2;
two crossings 14, 18, 26, 40 m apart 231.7 -> 156.8 (216.5 -> 152.5 at 14 m); a one-way couplet 26 m apart 231.7 -> 156.8; two curved
two-lane roads crossing 227.9 -> 196.9; a curved stroad meeting a curved side street 349.9 -> 311.4. None fell back to the plain hull.

### The network did not move

`node scripts/junctionmouth.mjs --compare <old run>` dumps every node, segment (curve, length, `trimA`, `trimB`, heights per
sample) and every junction curve's control points (from traffic.ts's own formula, all lane pairs) and prints SHA-256s. Old and new:

| group | hash old | hash new |
|---|---|---|
| reference block nodes | c35f439f2e2f2a21 | c35f439f2e2f2a21 |
| reference block segments | f067897e41e9fabe | f067897e41e9fabe |
| reference block trims | 30515ea68909fe63 | 30515ea68909fe63 |
| reference block junction curves (680) | 717228d0be6acd1c | 717228d0be6acd1c |
| 7 class pairs x 3 crossing + 5 T angles | ee3603cb95a64e25 | ee3603cb95a64e25 |
| Freedom Circle, close crossings, couplet, curved | equal per layout | equal per layout |

(`git diff ed63264 -- src/roads/network.ts src/agents/traffic.ts` is empty.)

## Watch-outs

- Roundabout (Freedom Circle), close crossings, one-way couplets, curved legs: drawn as shaped junctions in the harness, network
  identical, clearance 1.27 to 1.66 m. In the browser `junctionedit.mjs` lays the ring the way `interchanges.ts` does.
- Diamond interchanges: highways and ramps have no sidewalk, so `junctionShape` returns null and they keep the plain hull as
  before (`interchangetest`).
- Dead ends (1 leg) and bends (2 legs): not touched (cul-de-sac bulb; convex hull).
- Slopes: nothing in the shape depends on height; the zebra and the lines ride the junction fan (see above). `roadsection.mjs`
  and `junctionedit.mjs` (the site it finds has some slope) exercise it.
- Rebuild paths (build across, upgrade, flip, bulldoze arm by arm down to nothing): `junctionedit.mjs`, every vertex finite.
- Cost: no new mesh, no new draw call; the ladder needs 2 lines per leg where seven rungs were (instances go down).

## Tests

Browser runs against snapshots of my worktree (`scripts/snapshot.mjs junction 5184`), the old code on the frozen 5175 server. Two
things changed after most of them ran: the corner-easing fallback (a curved layout, node 45's neighbours) and the lamp-lit crosswalk
lines. So `junctiontest`, `roadjunction` and `junctionedit` were run again on the final code (all pass: 5/5; corner radius median 2.96
m, 0 of 10031 empty spots, 0 faces down, ring and rebuild paths finite; `glcheck` and the night captures ran after the lines change),
and `junctionmesh` / `junctionmouth --compare` (no browser) ran on the final code too. `interchangetest`, `gridtest`, `onewaytest`,
`roadthrough`, `motiontest`, `roadsection`, `roadwear`, `roadclass` and `nighttest` ran on the earlier snapshot; none of what changed
afterwards touches what they measure (the Freedom Circle's ring is in `junctionmouth`/`junctionedit` on the final code).

| test | old code | new code |
|---|---|---|
| `junctionmesh.mjs` (real meshes, no browser): grid points in the roads' strips with nothing drawn, 17 junctions | 0 of 10031 | 0 of 10031 |
| `junctionmouth.mjs --compare --min-clear 1.25` | (reference run) | network identical (4 hashes + synthetic + 6 layouts); every fillet in the block at 1.31 m or more |
| `junctiontest` | pass | pass (5/5) |
| `roadjunction` (drawn meshes by ray casts): corner radius median | 4.97 m (range 2.41 to 9.31) | 2.96 m (2.19 to 6.13); the target moved from 3.2 to 2.6, see below |
| ... holes in the strips / zebra faces down / asphalt faces down | 0 of 10031 / 0 of 172 / 0 of 1148 | 0 of 10031 / 0 of 184 / 0 of 1144 |
| `roadsection` (kerb reveal, verge slope, driveway lip) | 0.120 m / 1.00 / 0.019 m | 0.120 m / 1.00 / 0.019 m (77 driveways against 74: the blocks are longer) |
| `roadwear` | pass | pass (mean tone 81.67 -> 81.69; the junction tile 83.77 -> 83.73) |
| `roadclass` (day, low): junction mesh pixels / median luma | 31061 / 94 | 18988 / 95 (the ribbons take over the rest: two-lane class 97656 -> 109911 px) |
| `roadthrough` | pass | pass |
| `onewaytest` | pass | pass |
| `gridtest` | not run on the old code (queue) | 19 of 19 checks pass; "no page errors" fails on 3 HTTP 403 resource loads, see below |
| `interchangetest` | pass | pass (14 of 14; the ring is 4 x 3-way nodes, the diamond keeps its hull) |
| `motiontest` | pass | pass (231 trips, biggest heading step 0.105 rad, 145 of 145 turns braked for) |
| `junctionedit` (build, upgrade, flip, bulldoze arm by arm, Freedom Circle, couplet; every vertex finite; trims untouched by the renderer) | n/a (new) | pass |
| `nighttest high` (moonless, rain) | failed to run on the old server (`window.__cls` undefined in its mask pass) | pass: road median 89 / 69 (target 50), lamp pools p90 166 / 136 (target 100), 0.03 / 0.02% blown out |
| `shadercheck` | pass | pass |
| `glcheck` (GL errors on any draw call, after the crosswalk material change) | n/a | 0 hits |
| road renderer, reference block, counted in node (`junctionmesh.mjs`, `roadRenderer`): meshes drawn / of them instanced / instances / triangles including instances | 26 / 19 / 7629 / 215,517 | 26 / 19 / 6397 / 202,377 (no new draw call; 16% fewer instances, 6% fewer triangles) |
| `drawcalls low` in the browser, overview / street / houses / shore | not measured: the old-code run was killed at its 30 minute limit on the loaded box, and the queue never gave the low-only rerun a slot; the road renderer's own counts above are the comparison | 177 / 216 / 175 / 186 calls; 898k / 850k / 839k / 776k triangles; 399 visible meshes, 189 instanced |

`roadjunction.mjs`' corner-radius target was `median >= 3.2` and was written to catch the old square corners; it now says
`>= 2.6` because the corners are 3 m by design (min 2, unchanged).

`gridtest` "no page errors": the page logs three `Failed to load resource: 403` console errors during the test. `gridtest` is the only test here that counts console errors (the others count `pageerror` events), and I could not get the old-code run through the queue to show it fails the same way. Nothing in this change requests a resource (the road textures are canvases, the meshes are generated), and the same three appeared on the first snapshot of the new code; I take them to be the sandbox's: while a browser job runs, the agent proxy reports connections from Chromium to android.clients.google.com and www.google.com being denied (its own background requests), which the page logs as 403s. All 19 functional checks of the test pass.

## Not done

- **Skewed junctions keep their long plain mouths.** Below 90 degrees the walks of two neighbouring legs overlap until their
  outer edges cross, so a leg's ribbon cannot start before that (11.1 m from the node for two-lane streets at 60 degrees, 8.4 m at
  75). The fix is to mitre the walk ends along the corner's bisector so the ribbon can start at the kerb-return tangent; it touches
  the first row of every ribbon in `buildSeg` and I did not want to do that blind on the slot queue.
- **Stroad crossings below about 70 degrees still get straight chamfers**, as before: the crossing road's kerb line meets the leg
  beyond the network's trim (`netRoom` in `junctionShape` keeps a fillet's tangent within 1.5 m of it), so no arc fits. Relaxing that
  clamp to 5 m gave arcs but longer trims, which I judged worse.
- The stop-line mismatch below (the paint follows the sim; the sim does not follow the corner).
- Alley one-ways (`oneWay1`) at 60 and 120 degrees got up to 5.5 m2 more flare and 1.3 m2 more box: the obtuse corner's bigger arc.
- Not run: `perfTown.mjs` (it grows a different town every run; `drawcalls.mjs` on the saved block is the comparison), the UI set
  (`tooltest`, `uisweep`, `tiptest`, `overlaptest`, `touchtest`): nothing here touches the HUD.

## Found in files I may not edit

- `src/roads/network.ts updateTrims`: the trim a leg gets is `other.hw / max(0.35, sin) + 1.5` with `hw` the crossing road's
  half-width *including its sidewalks*; at oblique angles and at wide crossings that is closer to the crossing road than a
  stopped car should be. In my synthetic set 75 of 162 legs have a stopped car's nose past the near edge of a 1.8 m crosswalk (median
  1.1 m, worst 5.5 m at a 60 degree stroad6 crossing; none at a right angle beyond 0.1 m). `junctionShape(net, nodeId).legs[i].marks`
  has the crosswalk (`z0`, `z1`) and stop-bar (`bar`) distances from the node along each leg, computed from the kerb lines; stopping the
  car's nose 0.3 m short of `bar` would put the sim where the paint is.
- `src/agents/traffic.ts`: `c.s` is the car's centre and the stop point is `exitS - 1.5` for every car, so a 16 m semi's nose stops
  8 m beyond the line, inside the junction box. Stopping the nose (`c.s + len / 2`) at the line would fix that.
- `traffic.ts enterJunction` builds the cars' turning curve from the lane at the stop line to the lane at the next leg's entry with
  control points 0.42 of their distance along the two headings. `roadJunction.ts carClearance()` mirrors it; if that curve
  changes, change the mirror, and `node scripts/junctionmouth.mjs --min-clear 1.25` will say so.

## README lines for the new scripts

Add to the test list in `README.md` (one line each):

- `scripts/junctionmouth.mjs`: junction shapes without a browser: mouth areas per class pair and angle, the cars' clearance to the kerb, paint against stopped cars; `--compare old.json` proves the network did not move.
- `scripts/junctionmesh.mjs`: the real road meshes in node (no GPU): empty spots and down-facing triangles at the reference block's junctions.
- `scripts/junctionplan.mjs`: a plan view (PNG) of the drawn junction from the real meshes, with the stopped cars' noses and the lamps.
- `scripts/junctionshots.mjs`: before/after close-ups of junctions (day and night) on the reference block and on synthetic tee, skew and one-way junctions.
- `scripts/junctionedit.mjs`: rebuilds a junction every way the game does and checks the meshes stay finite and the trims stay the network's.

## Appendix: every class pair and angle measured

(`node scripts/junctionmouth.mjs`; "crossing" = both roads run through, "T" = the second road ends on the first; the angle is between the two.
radius and mouth are per corner / per leg, the largest is shown when they differ; gravel roads have no sidewalk and keep the plain hull)

| roads | junction | radii m (old -> new) | mouth trim m | box m2 | flare m2 | car clearance m |
|---|---|---|---|---|---|---|
| twoLane x twoLane | crossing 90 | 5 -> 3.01 | 8.8 -> 6.8 | 231.7 -> 156.8 | 22 -> 7.9 | 2.13 -> 1.73 |
| twoLane x twoLane | crossing 75 | 5/3.59 -> 3.92/2.31 | 9.6 -> 8.4 | 249.2 -> 203.3 | 16 -> 7.9 | 1.82 -> 1.54 |
| twoLane x twoLane | crossing 60 | 5 -> 5.21/1.74 | 11.1 -> 11.1 | 292.9 -> 279.4 | 20.8 -> 7.3 | 1.36 -> 1.4 |
| twoLane x twoLane | T 90 | 5 -> 3.01 | 8.8 -> 6.8 | 182.7 -> 130.1 | 11 -> 4 | 2.05 -> 1.73 |
| twoLane x twoLane | T 75 | 3.59/5 -> 2.31/3.92 | 9.6 -> 8.4 | 175.9 -> 146.5 | 8 -> 3.9 | 1.82 -> 1.54 |
| twoLane x twoLane | T 60 | 5 -> 1.74/5.21 | 11.1 -> 11.1 | 184.8 -> 178.8 | 10.4 -> 3.7 | 1.36 -> 1.4 |
| twoLane x twoLane | T 105 | 5/3.59 -> 3.92/2.31 | 9.6 -> 8.4 | 175.8 -> 146.5 | 8 -> 3.9 | 1.82 -> 1.54 |
| twoLane x twoLane | T 120 | 5 -> 5.21/1.74 | 11.1 -> 11.1 | 184.8 -> 178.8 | 10.4 -> 3.7 | 1.36 -> 1.4 |
| stroad4 x twoLane | crossing 90 | 4.6 -> 3.6 | 13.7 -> 12.7 | 392.7 -> 333.9 | 18.7 -> 11.3 | 2.09 -> 2.02 |
| stroad4 x twoLane | crossing 75 | 7.4/2.51 -> 4.69/2.51 | 14.0 -> 13.7 | 438 -> 424.6 | 17.9 -> 10.1 | 2.04 -> 1.75 |
| stroad4 x twoLane | crossing 60 | - -> - | 16.0 -> 16.0 | 686.3 -> 686.3 | 109 -> 109 | 3.01 -> 3.01 |
| stroad4 x twoLane | T 90 | 4.6 -> 3.6 | 13.7 -> 12.7 | 348.4 -> 300.9 | 9.3 -> 5.7 | 2.05 -> 2.02 |
| stroad4 x twoLane | T 75 | 2.51/7.4 -> 2.51/4.69 | 14.0 -> 13.7 | 348.4 -> 303.7 | 8.9 -> 5.1 | 2.04 -> 1.75 |
| stroad4 x twoLane | T 60 | - -> - | 16.0 -> 16.0 | 383.4 -> 383.4 | 22.3 -> 22.3 | 1.9 -> 1.9 |
| stroad4 x twoLane | T 105 | 7.4/2.51 -> 4.69/2.51 | 14.0 -> 13.7 | 348.4 -> 303.7 | 8.9 -> 5.1 | 2.04 -> 1.75 |
| stroad4 x twoLane | T 120 | - -> - | 16.0 -> 16.0 | 383.4 -> 383.4 | 22.3 -> 22.3 | 1.9 -> 1.9 |
| stroad4 x stroad4 | crossing 90 | 3.8 -> 3.6 | 12.8 -> 12.7 | 615.4 -> 599.6 | 12.7 -> 11.3 | 2.11 -> 2.09 |
| stroad4 x stroad4 | crossing 75 | 5.3 -> 4.69/1.71 | 13.9 -> 14.0 | 681.1 -> 684.7 | 11 -> 7.5 | 1.79 -> 1.63 |
| stroad4 x stroad4 | crossing 60 | 7.7 -> 7.24 | 18.5 -> 18.5 | 974.7 -> 973.9 | 13.7 -> 12.9 | 1.37 -> 1.29 |
| stroad4 x stroad4 | T 90 | 3.8 -> 3.6 | 12.8 -> 12.7 | 540.3 -> 528.8 | 6.3 -> 5.7 | 2.05 -> 2.05 |
| stroad4 x stroad4 | T 75 | 5.3 -> 1.71/4.69 | 13.9 -> 14.0 | 538.7 -> 533.3 | 5.5 -> 3.8 | 1.79 -> 1.63 |
| stroad4 x stroad4 | T 60 | 7.7 -> 7.24 | 18.5 -> 18.5 | 670.2 -> 669.8 | 6.9 -> 6.5 | 1.37 -> 1.29 |
| stroad4 x stroad4 | T 105 | 5.3 -> 4.69/1.71 | 13.9 -> 14.0 | 538.7 -> 533.3 | 5.5 -> 3.7 | 1.79 -> 1.63 |
| stroad4 x stroad4 | T 120 | 7.7 -> 7.24 | 18.5 -> 18.5 | 670.2 -> 669.8 | 6.9 -> 6.5 | 1.37 -> 1.29 |
| stroad6 x twoLane | crossing 90 | 4.4 -> 3.6 | 16.9 -> 16.1 | 495.4 -> 437.5 | 16.9 -> 11.3 | 2.07 -> 2.02 |
| stroad6 x twoLane | crossing 75 | 7.13 -> 4.69/1.79 | 17.4 -> 16.3 | 612 -> 580.7 | 22.3 -> 7.7 | 2.01 -> 1.75 |
| stroad6 x twoLane | crossing 60 | - -> - | 19.9 -> 19.9 | 990.3 -> 990.3 | 130.7 -> 130.7 | 3.03 -> 3.03 |
| stroad6 x twoLane | T 90 | 4.4 -> 3.6 | 16.9 -> 16.1 | 453.5 -> 404.5 | 8.5 -> 5.7 | 2.05 -> 2.02 |
| stroad6 x twoLane | T 75 | 7.13 -> 1.79/4.69 | 17.4 -> 16.3 | 459.1 -> 395.7 | 11.1 -> 3.8 | 2.01 -> 1.75 |
| stroad6 x twoLane | T 60 | - -> - | 19.9 -> 19.9 | 558 -> 558 | 27.8 -> 27.8 | 2.05 -> 2.05 |
| stroad6 x twoLane | T 105 | 7.13 -> 4.69/1.79 | 17.4 -> 16.3 | 459.1 -> 395.7 | 11.2 -> 3.8 | 2.01 -> 1.75 |
| stroad6 x twoLane | T 120 | - -> - | 19.9 -> 19.9 | 558.1 -> 558.1 | 27.9 -> 27.9 | 2.05 -> 2.05 |
| oneWay2 x twoLane | crossing 90 | 5 -> 3.01 | 8.8 -> 6.8 | 231.7 -> 156.8 | 22 -> 7.9 | 2.13 -> 1.78 |
| oneWay2 x twoLane | crossing 75 | 5/3.43 -> 3.92/2.31 | 9.4 -> 8.3 | 241.4 -> 199.3 | 15.1 -> 7.8 | 1.85 -> 1.57 |
| oneWay2 x twoLane | crossing 60 | 5 -> 5.21/1.74 | 11.0 -> 11.0 | 285.7 -> 273.6 | 19.5 -> 7.3 | 1.39 -> 1.42 |
| oneWay2 x twoLane | T 90 | 5 -> 3.01 | 8.8 -> 6.8 | 182.7 -> 130.1 | 11 -> 4 | 2.05 -> 1.78 |
| oneWay2 x twoLane | T 75 | 3.43/5 -> 2.31/3.92 | 9.4 -> 8.3 | 172.4 -> 144.9 | 7.6 -> 3.9 | 1.85 -> 1.57 |
| oneWay2 x twoLane | T 60 | 5 -> 1.74/5.21 | 11.0 -> 11.0 | 181.6 -> 176.3 | 9.7 -> 3.7 | 1.39 -> 1.42 |
| oneWay2 x twoLane | T 105 | 5/3.43 -> 3.92/2.31 | 9.4 -> 8.3 | 172.4 -> 144.8 | 7.6 -> 3.9 | 1.85 -> 1.57 |
| oneWay2 x twoLane | T 120 | 5 -> 5.21/1.74 | 11.0 -> 11.0 | 181.6 -> 176.3 | 9.7 -> 3.6 | 1.39 -> 1.42 |
| oneWay1 x oneWay1 | crossing 90 | 3.6 -> 2.4 | 6.0 -> 4.8 | 103.5 -> 74.2 | 11.3 -> 5.1 | 2.4 -> 2 |
| oneWay1 x oneWay1 | crossing 75 | 3.6/3.56 -> 3.13/1.84 | 7.8 -> 6.0 | 138.1 -> 97.3 | 13 -> 5 | 2.06 -> 1.93 |
| oneWay1 x oneWay1 | crossing 60 | 3.6/2.4 -> 4.16 | 8.3 -> 8.0 | 142.3 -> 142.1 | 9.4 -> 14.9 | 1.79 -> 1.88 |
| oneWay1 x oneWay1 | T 90 | 3.6 -> 2.4 | 6.0 -> 4.8 | 80.5 -> 60.1 | 5.7 -> 2.5 | 2.4 -> 2 |
| oneWay1 x oneWay1 | T 75 | 3.56/3.6 -> 1.84/3.13 | 7.8 -> 6.0 | 91.4 -> 69 | 6.5 -> 2.5 | 2.06 -> 1.93 |
| oneWay1 x oneWay1 | T 60 | 2.4/3.6 -> 4.16 | 8.3 -> 8.0 | 88 -> 89.3 | 4.7 -> 7.5 | 1.79 -> 1.88 |
| oneWay1 x oneWay1 | T 105 | 3.6/3.56 -> 3.13/1.84 | 7.8 -> 6.0 | 91.4 -> 69 | 6.5 -> 2.5 | 2.06 -> 1.93 |
| oneWay1 x oneWay1 | T 120 | 3.6/2.4 -> 4.16 | 8.3 -> 8.0 | 88 -> 89.3 | 4.8 -> 7.5 | 1.79 -> 1.88 |
