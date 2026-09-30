# Audit, round 7 (2026-09-30, build 217458e / v38)

The owner: "the cars still need some improvement for sure, but everything
could use more polish." This audit comes after the graphics pass (roads,
ground, walls, civic, trees, shores, presets) and the playtest-6 fixes were
merged. It feeds two handoffs:

- `docs/HANDOFF_TRAFFIC.md`: how cars behave, parking, the late game.
- `docs/HANDOFF_CARS_LOOK.md`: how cars and the town look and sound.

**Method.** I read `src/agents/traffic.ts`, `vehicles.ts`,
`models/vehicleModels.ts`, `pedestrians.ts` and `src/audio/ambience.ts`.

I measured the reference block (`scripts/refblock.mjs`: 708 residents, 126
buildings, about 99 cars):
- 60 s of morning-rush traffic to warm up;
- then 120 s stepped directly, 20 steps a second, with no rendering, so the
  numbers don't depend on the preset.

Captures:
- close-ups on High, aimed at real cars (one moving, one queue, one busy
  junction), each by day and by night;
- the lookbook on Low, the owner's phone preset.

The new check `scripts/carsolid.mjs` fails today, and each car item below says
which of its lines should pass.

## Cars: behaviour (measured)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | **Cars are drawn inside each other in lanes.** A car pulling out of a lot yields only to cars moving faster than 2 m/s, and gives up yielding after 4 s. So it merges into a stopped queue, and two cars leaving one lot together merge at the same instant. Once two cars overlap by more than 1.5 m, the car behind ignores its leader ("overlapped: let them untangle", traffic.ts ~650), so they drive on inside each other, through the next junction. | carsolid: **5.4–8.0 pairs at any moment** over two runs (95–99 cars). A diagnostic run gave 8.6. Traffic is random, so runs vary; the bar is 0. Every same-lane pair includes a car still on its first road. Example: a pickup and an SUV from the same lot, s = 86.3 and 86.7, then crossing the junction as one. | High: visible at every queue |
| 2 | **Cars are drawn inside each other in junctions.** A car on a junction curve sets its speed from the exit lane only. It never follows a car ahead on the same curve, or on another curve joining the same exit. When the exit is full, every car on that curve stops at its end (t = 1), at one point. | carsolid: **1.2–2.1 pairs at any moment**. In the diagnostic, three cars (sedan, box truck, pickup) sat at one point at a stroad junction entry. | High |
| 3 | **Heading snaps.** | carsolid: **20–25 turns of more than 0.35 rad (20°) in one step** in 120 s. Sliding sideways is otherwise rare (p95 1.3°, p99 15°). | Medium |
| 4 | **Crashes are frequent.** 4% of drivers are drunk by day (14% at night) and 8% more are reckless. A drunk driver is 30× as likely to have a random crash, a reckless one 5×. | 3–5 crashes per 120 s in a 708-person town, about one every 25–40 s at ▶. Almost all are "random"; none are rear-end. | Owner's call (balance) |
| 5 | **Cars don't yield to people.** Walkers cross at corners and cars never check for them. | No pedestrian code in traffic.ts. | Medium |
| 6 | **Parking isn't real.** An arriving car pulls in for 2.2 s and is deleted. Cars in lots and in drive-thru lines are part of the building models, so a SprawlMart lot looks the same at 3 am as at noon. The design doc's drive-thru queue that "spills onto the stroad, eats a lane" doesn't exist. | traffic.ts ~790 (`parked: off the road`); comLow.ts (drive-thru lines "always full"). | Medium: a big realism win |
| — | Fine today | No car waits more than 60 s away from a red light (longest 13–35 s). 74–81% of cars are moving at rush hour, and 128 trips finish in 120 s. Lane offsets are centred (1.75 m on a 3.5 m two-lane lane). | — |

## Cars: look and sound (captures)

| # | Finding | Evidence |
|---|---|---|
| 7 | **The models read as PS1-era.** Bodies are 3–4 lofted boxes: a wedge hood, a flat box for a bed, no wheel arches, no pillars or window frames. Wheels are plain black discs that look oversized. Mirrors are blocks. At gameplay zoom, sedan, hatchback, SUV and minivan have nearly the same silhouette. | Close-ups of a pickup on a two-lane road, and a queue on a shop street. |
| 8 | **Night.** Headlights are glow sprites that light nothing, so there are no pools on the road ahead. Taillights are barely visible from behind; one sedan showed no lights at all. Brake and turn lights exist but read weakly at gameplay zoom. | Night close-ups at 21:30. |
| 9 | **Paint.** Colours are drawn at random from 14 paints. Real US traffic is about three-quarters white, black, grey and silver. There's no dirt or age: every pickup looks showroom-new, which fights the satire. | vehicles.ts `PAINT`. |
| 10 | **Traffic audio doesn't follow the cars.** It's one ambient bed scaled by the car count, plus random honks and pass-bys. Honks don't come from real jams, sirens don't follow the fire truck, and a semi sounds like everything else. | ambience.ts ~230, 268. |

## Everything else (polish)

| # | Finding | Evidence |
|---|---|---|
| 11 | **Low preset: the glass towers read as black monoliths at noon.** Low is what the owner plays on (iPhone). | Low lookbook, overview at noon. |
| 12 | **Junction mouths at four-way stops are very wide slabs of asphalt.** | High junction close-up. |
| 13 | **The late game is unverified.** The playtest-6 run fixed the phone, bankruptcy, disasters, saves, transit and undo. It never wrote `docs/PLAYTEST_6.md`: no milestone table to 10,000 people, no landmark review ("Built the stadium, nothing happens"). Its bot, `scripts/playtest6-late.mjs`, exists. | git log on the branch. |
| 14 | **The "night reads as night" check still fails, by choice.** Night was brightened for readability (`nightglow.mjs`, 83% against a 70% bar). | POLISH_AUDIT.md. |

## Decisions for the owner

1. **Crash rate (item 4).** Proposal: 1% drunk by day and 6% at night, with a
   random-crash rate a third of today's. That's about one crash every few
   minutes at ▶ in a 700-person town instead of one every 30 s. Crashes still
   rise with speed, volume and driveways, as the design doc says. Or keep
   today's chaos as satire.
2. **Parking (item 6).** Agree that the parked cars and drive-thru lines built
   into the building models give way to real parked cars (same look, but
   they come and go). This touches the building generators, which the look
   pass owns; the handoffs split it cleanly.
3. **Night brightness (item 14):** still open from earlier.
