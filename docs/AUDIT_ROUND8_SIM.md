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
