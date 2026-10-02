# Audit, round 8: the simulation under load (2026-10-01, base c85b1e6)

What still goes wrong in the simulation when the town is busy, big or old,
measured before anything was changed. It feeds the fixes in
`docs/HANDOFF_ROUND8_OPUS.md`; each fix's commit carries its before and after
numbers.

**Method.**

- **The late game, on all three maps.** `scripts/playtest6-late.mjs` (the
  scripted commissioner) from nothing toward 10,000 people, one run a map, on
  a frozen snapshot of c85b1e6 (the owner's five decisions in). Florida ran to
  day 1,157, NorCal to 1,069, Appalachia to 1,468.
- **Busy towns, stepped at ▶▶▶.** Two Florida towns grown by the same bot and
  saved: 650 people (`shots/florida650.json`, day 292) and 2,800
  (`shots/florida2800.json`, day 504). Each was loaded and run for 60 game days
  at ▶▶▶ (150 s of traffic), seeded. A probe counted truck deliveries a week,
  what every goods truck was waiting for, how long lane heads stood still and
  why, and rings of lanes each waiting on the next.
- **The reference block** (`scripts/refblock.mjs`, 708 people, about 100
  cars): `carsolid`, `crosswalktest` and `landmarktest`, seeded, and the node-45
  probe for left turns.
- **Code read:** `traffic.ts` (lot exits, the junction box rule, left turns,
  the event crowds), `freight.ts` (truck dispatch) and `services.ts`
  (coverage), and the bot (`scripts/lib/latePlayer.mjs`).

## Findings, by how much a player would notice

| # | Finding | How it was measured | Player notices |
|---|---|---|---|
| 1 | **Goods trucks can't get out of the factory lots.** A driver leaving a lot waits at the kerb for a gap the length of its vehicle plus room to the car behind, in its own lane and (from a lot across the road) the oncoming one. Traffic only lets someone out when it's crawling (under 5 m/s, within 25 m). A 16 m semi on a flowing two-lane road never gets that gap. In the 2,800-person Florida town, goods trucks spent **76% of their time in a lot** (2,982 of about 3,900 truck-seconds). **10 semis waited at the kerb over 60 s**, the worst 146 s, which is the whole run: they never got out. Only **9 truck trips** finished in 60 days. The lot's queue limit then refused **45 goods trucks** outright. The county-line imports carried 2,544 units against 757 by truck: **77% of the goods**. | The Florida 2,800 save, 60 days at ▶▶▶, seed 1 (a repeat run gave identical numbers). | High: the shops' goods, the dashed truck routes and the "Interstate Logistics Cloud" bill all come from this. |
| 2 | **Long waits for room past the box, without rings.** Lane heads standing still for over 30 s were held by "no room past the box" 77% of the time (682 of 886 s), the longest 100 s. The ring detector (each held head waiting on a lane whose head is also held) found **no ring** in either town. Following the chain behind each wait over 60 s: three or four full 80 m blocks, 7–8 cars each, all draining into one street (segment 46 → 55), whose head crawls into the box at 2–4 m/s with nothing in its way. That's a funnel: more traffic than one two-lane street toward the highway carries. The box rule isn't locking anything; a player would widen the street, and the bot never does (it never upgrades a road). | Same runs; each car now records what it's following or waiting for (`Car.hold`). | Medium: queues that don't move at a green. |
| 3 | **A permissive left at a signal lets one car go a cycle.** At node 45 (Wildflower Dr × Old County Road), a left-turner waits for a gap in the oncoming traffic; only the head of the queue goes as the light changes. The longest wait away from a red is 19–51 s (5 runs), and 56 s on the old code. | `carsolid`; the node-45 probe. | Medium: the visible queue on the reference block. |
| 4 | **The traffic tests weren't reproducible.** carsolid, crosswalktest, landmarktest and parkingtest used real randomness, so one run proved nothing. Even with a seed, two runs differed: the asset pack gives up after 15 s, so on a busy machine a run can build the town from other models (seed 1234: 34,127 walker-samples with the pack, 24,062 without, and 32,406 in a run that probably lost it). | Two runs of each test with `SEED=1234`, and one with the pack blocked. | None directly; it hid regressions. |
| 5 | **The landmark crowd doesn't all get home by 2 am.** 10 of 24 fans reached Slop 69 Field **after** 10 pm, so they were still leaving at 2 am: 15 trips home against the check's 16.8. | `landmarktest`, seed 1234, failing the same way twice. | Low: a few late cars after a game. |
| 6 | **Traffic costs 5.2–6.5 ms a step at 1,000 cars** (target 4). | `trafficscale` (the round-7 numbers). | Medium on phones in big towns. |
| 7 | **A trash crisis empties a third of a town.** In Appalachia the main landfill filled ("Mt. Trashmore Landfill is full", day 748). 258 buildings piled up trash at day 772, and population fell from 5,109 to 4,269 in 10 days. At day 819–835, 45 days after they were abandoned, **149 buildings were demolished** (447 → 298 buildings while people moved back in). Florida at 20,000 people has 212 buildings piling up trash because its trucks are at their daily limit. The game warns at 75% and 90% full; the bot doesn't act on it in time. | The late-game runs. | High when it happens; it's a known balance item (`PLAYTEST_6.md`, "Trash at 8,000–9,400"). |
| 8 | **Cars that pull out of a lot near a junction turn from the wrong lane.** A car that joins a four-lane stroad 10–50 m before a junction has no room to get over for its turn. It turns from the lane it's in, across the car going straight beside it, and they're drawn inside each other in the box. carsolid's remaining overlaps, on seeds 1, 2, 3, 5 and 6, are almost all of this kind: two cars on their first road on segment 44, side by side at s 88.4–88.5. | carsolid, seeds 1–6. | Low: a moment's overlap in a busy box. |
| 9 | **The bot builds dozens of clinics that don't help.** When a clinic is overloaded, the bot builds another at the town's centre. Each building is served by its nearest clinic, so one far from the overloaded clinic takes none of its load: 83 clinics in Florida, 53 in NorCal, 44 in Appalachia. In Appalachia the same clinic stayed overloaded ("2,180 of 1,200") through the last 450 days while the bot built a clinic every 10–20 days. | The late-game runs' notes. | None: it's the bot. But it spends the bot's treasury, so "can't afford" in the blockers is partly self-inflicted. A person would build next to the overloaded clinic. |

## The late game with the owner's decisions

All three maps now pass 1,800 people (offices unlock at 1,100); two reach
10,000. One run each, so read them as a direction, not a distribution.

| map | 650 | 1,100 | 1,800 | 2,800 | 4,200 | 6,500 | 10,000 | peak (day) |
|---|---|---|---|---|---|---|---|---|
| Florida | 292 ($28k) | 363 ($16k) | 444 ($40k) | 504 ($58k) | 565 ($65k) | 675 ($105k) | **766** ($175k) | 22,464 (1157) |
| NorCal | 313 ($38k) | 393 ($19k) | 474 ($53k) | 534 ($79k) | 585 ($67k) | 642 ($112k) | **729** ($178k) | 17,144 (1069) |
| Appalachia | 292 ($39k) | 363 ($26k) | 504 ($43k) | 583 ($53k) | 698 ($64k) | 1004 ($97k) | – | 8,131 (1468) |

Round 7 (`PLAYTEST_6.md`): no run reached 10,000. The best reached 9,395
(Appalachia B) and 8,161 (NorCal B). The three Florida runs stalled at
1,214–1,662. The comparison and what blocked growth go in `PLAYTEST_6.md`
(item 5).

## What's fine

- No page errors in any run.
- carsolid, seeds 1–6: no heading snaps; 73–80% of cars moving; 86–99 trips
  finished; the longest wait away from a red is 16–59 s. Seed 4 passes every
  line. The others fail on overlaps of at most 0.02 pairs at any moment (as on
  the old code), nearly all of them on one road (#8).
- crosswalktest, seed 1234: nobody on foot inside a car, and 89 cars stopped
  for people.

## What this changes in the plan

Item 2 (the gridlock breaker) was written for rings at junctions. On these
towns there are none: the trucks are lost at the lot exits, and the long box
waits are a funnel toward the highway, which more lanes would fix and a breaker
wouldn't. So the breaker is at the kerb: a driver who has waited there long
enough gets waved out by moving traffic, as people wave out a truck, not only
by a crawling queue. It's measured on the 2,800 save (deliveries a week) and
checked against the reference block's tests on the same seeds, with the ring
detector watching a long ▶▶▶ soak.

## Addendum: what the fixes found (2026-10-02)

Corrections to the findings above, and what turned up while fixing them.
Each fix's commit has its before and after numbers.

- **#2, rings: they exist.** The 60-day runs found none, but a 30-minute
  ▶▶▶ soak of the same Florida county (grown on to 5,200 people) locked into
  rings: seed 1 had nine full blocks and 59 cars, each lane's front car
  waiting for room on the next, for the rest of the soak. The gridlock
  breaker (a front car held 20 s by a full lane past the box takes another
  way out) cut the moments with a ring 747 -> 142 and 813 -> 20, and the
  longest standing front car 6,424 s -> 1,176 s and 6,752 s -> 480 s.
- **#3, left turns: capacity, not a bug.** By hour at node 45, the waits are
  within one green in the morning and at noon. At the evening rush the lefts
  from Wildflower Dr (seg 48) wait 113 s on average, because one left goes
  on each change and the oncoming platoon fills the green. carsolid's "60 s
  away from a red" passes on every seed, before and after: a car at a light
  waits at most a green and a clearing. Two lefts on the change only moved
  the waits around, and a leading left never triggered. What did help was
  the lights themselves: a green nobody waits for now gives way to one
  somebody does (actuated), +31-58% cars through node 45 and +31-39%
  through all the lights. The lefts are the owner's call: a protected left
  phase, or a turn lane, at a T this busy.
- **#8, lane overlaps: they aren't wrong-lane turns.** carsolid's remaining
  lane overlaps (seg 44, both cars on their first road, side by side at
  s 16-31) are cars pulling out of a lot across the near lane to the far one.
  The car is drawn across the near lane while a car passes in it. Not fixed
  (at most 0.03 pairs at any moment); the fix would treat a pull-out as in
  both lanes until it's over.
- **New: people inside cars, a timing bug.** crosswalktest put someone
  inside a car on 4 seeds of 13. Three different windows, each traced to
  the step:
  - people asked to cross from the corner, before the 2 s walk round to the
    kerb, and a car that set off meanwhile was past its line when they
    stepped out;
  - a car out of the box into the arm, which isn't in the arm's lane lists
    until the next step;
  - a car pulling out of a driveway at the crosswalk.
  Fixed: people wait at the kerb they step off, and canCross sees both kinds
  of car. 0 of 13 seeds now, with 3% more trips.
- **New: round 7's stop line, on arms nobody crosses.** The 10 sharp-cornered
  arms that held cars 3-6.5 m behind their line are arms pedestrians.ts
  never lets anyone cross. Where people cross, where cars stop and where the
  zebra goes now come from one function (roadJunction.ts armCrossing). Arms
  nobody crosses have no zebra, and their cars stop at the bar.
- **New: the landmark crowd is late.** It isn't stuck and the lot isn't slow.
  A drive across the block takes 1-4 hours on the clock (15 s of traffic an
  hour; a light's cycle is nearly 2 hours), and the crowd sets off 0-1.5
  hours before kickoff. Half arrive during the game, and 4-7 of 21 are still
  driving there at 1 am. The test now counts the fans who got there. When
  they set off is proposed to the owner.
- **New: a thousand cars, many shapes.** The cars had a dozen of their fields
  added as they came up, so the loops over them read many shapes of object.
  One shape each (and four smaller changes) took a step at 1,000 cars from
  7-9 ms to 4.3-4.8 ms on this machine, with every car where it was.
- **New: a residual divergence in the seeded runs.** The same seed on the
  same code gives one of two outcomes (on trafficscale's town, two
  fingerprints with the same town fingerprint), seemingly by load. Every
  before/after comparison here was made between matching outcomes, or
  across many seeds. The source isn't found yet. It isn't the asset pack
  (same town), and the feed has its own random stream.
- **New, from the round's full test run: the breaker had no way out where
  it mattered most.** On a fresh seed (1826941211) the gridlock test failed:
  583 moments with a ring and a front car standing 4,688 s. Each stuck car's
  destination was on the road just past the jam, so the route from every
  other road with room went straight back through the same box (a U-turn),
  and the breaker turned it down. Now that route is planned leaving the way
  the car turns onto the road, round the block; the ring loses the car even
  if it comes back to the same lane. That showed a second standstill: a car
  just out of an all-way stop waved a driver out of a driveway with its tail
  still in the box, the driver never got out, and the box car behind it,
  and everyone waiting at the stop for that car, stood 4,424 s. A
  car no longer stops for a courtesy until its tail is out of the box. The
  two commits have the numbers.
- **New: the bot's clinics, again.** botclinics fails on the final code
  (10 clinics by 2,805 people, one still overloaded). The commit's "after"
  ran on an older snapshot. The relief clinics land on the nearest free
  lots, at the core's edge, and take little of the overloaded one's load.
  docs/PLAYTEST_6.md has the correction and a proposal.

## Addendum: the owner's calls, done (2026-10-02)

The owner said yes to six proposals. Each commit has its before and after
numbers and seeds; in short:

- **#3, node 45's lefts: a leading green.** When a green starts with a left
  first at one of two paired roads' lines and someone coming the other way,
  that road goes alone for up to 5 s. The lefts at node 45 wait 16-43 s
  instead of 95-124 s (lightstest, seeds 1-3, two runs each). A road going
  alone lengthens the cycle: all four lights passed -6% to +8% as many cars
  at the evening rush (the commit says 6% fewer, from the first three runs;
  that count moves ~15% between runs of the same code). A turn lane would
  cost the other lights nothing; that's a road change, not done.
- **The landmark crowd sets off by its drive.** 18-21 of 21 fans are in their
  seats by kickoff on seven seeds, against 0 of 21 before. A drive to the
  field takes 2-6 times its free-flowing time, so the longest set off up to
  12 hours ahead on the clock (15 s of traffic an hour).
- **The trash cliff: 90 days, with warnings.** An abandoned building stands
  90 days, and the game says how many come down and when, 30 days and again
  7 days ahead; the inspector gives the days left.
- **Pacing:** left until a person has played it.
- **#8, pull-outs: in both lanes until it's over.** No pull-out overlap on
  any of carsolid's six seeds (four had one). carsolid still fails on three
  seeds for two older overlaps, not pull-outs: a lane change at 19-20 m/s
  near the start of road 16, and a semi's trailer swinging over the oncoming
  lane turning onto two-lane roads 74 and 90.
- **#9, the bot's clinics: the lot that takes the load.** Over five seeds the
  clinics were overloaded 30-74% of the clinic-days from the first overload
  (95/73/83/30/75% before), the worst at 123-150% of capacity (140-214%).
  The bot never had the $66k for a hospital.
