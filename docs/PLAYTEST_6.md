# Playtest 6: the late game

The report the playtest-6 session never wrote (docs/AUDIT_ROUND7.md #13),
written by the traffic pass (docs/HANDOFF_TRAFFIC.md step 6), 2026-09-30.

**How it was played.** `scripts/playtest6-late.mjs` with the scripted
commissioner in `scripts/lib/latePlayer.mjs`: Ponzi mode from nothing, roads
in rings, zones by the demand bars, a service when the game says something
is failing, taxes lowered when the guide asks and the week is in the black.
It's a bot, not a person. It can't terrace a hillside to fit a pump, never
takes a loan, never upgrades a road, never touches a policy, only builds an
incinerator with $60,000 in the bank, and keeps laying rings when the
treasury can't carry them. Read its numbers as what a steady, unimaginative
player gets. Runs differ a lot from one to the next (random sites, demand
and disasters), so each map has several. No run threw a page error.

## Milestones

Game day each milestone was reached, with the treasury then. "–" means
never. The last column is the peak population and the day.

| run | 150 | 350 | 650 | 1,100 | 1,800 | 2,800 | 4,200 | 6,500 | 10,000 | peak (day) |
|---|---|---|---|---|---|---|---|---|---|---|
| Appalachia A¹ | 111 ($49k) | 212 ($23k) | 474 ($4k) | 1090 ($7k) | – | – | – | – | – | 1,526 (2678) |
| Appalachia B² | ≈110 | ≈200 | ≈315 | ≈440 | ≈700 | ≈810 | ≈950 | ≈1100 | – | 9,395 (1401) |
| Appalachia C | 121 ($48k) | 202 ($33k) | 313 ($41k) | 454 ($33k) | – | – | – | – | – | 1,217 (1399) |
| Appalachia D | 111 ($47k) | 202 ($33k) | 303 ($44k) | 434 ($25k) | 696 ($35k) | 829 ($45k) | – | – | – | 3,878 (1572) |
| Appalachia E | 121 ($49k) | 202 ($35k) | 313 ($47k) | 454 ($27k) | 575 ($41k) | 715 ($46k) | 846 ($72k) | – | – | 4,323 (1333) |
| NorCal A¹ | 111 ($49k) | 192 ($34k) | 292 ($46k) | 363 ($20k) | – | – | – | – | – | 1,703 (3016) |
| NorCal B | 121 ($49k) | 192 ($35k) | 292 ($38k) | 383 ($29k) | 524 ($30k) | 645 ($50k) | 746 ($56k) | 1192 ($109k) | – | 8,161 (1446) |
| Florida A | 111 ($49k) | 192 ($37k) | 302 ($47k) | 433 ($28k) | – | – | – | – | – | 1,214 (1495) |
| Florida B³ | 111 ($49k) | 222 ($27k) | 313 ($32k) | 444 ($22k) | – | – | – | – | – | 1,278 (1109) |
| Florida C³ | 111 ($49k) | 202 ($39k) | 292 ($43k) | 393 ($26k) | – | – | – | – | – | 1,662 (1109) |

¹ Before the bot's tax rule was fixed (it cut taxes while losing money: 22
bankruptcies in Appalachia A). ² From 100-day samples; the run was cut off at
day 3,057 by a server restart. ³ After the demand-bar fix below.

Nobody reached 10,000. The early game is steady on every map: 1,100 people
in 360–470 days. After that the runs split into towns that stall under
1,800 and towns that run on to 4,000–9,400.

## What got in the way

**The office lock at 1,800 (all maps).** Past about 1,100 people, homes run
out of jobs ("380 more workers than jobs", homes −27), factories have more
jobs than the shops need, and the one sector that wants to grow, offices
(+70 to +100), is locked until 1,800. A town that stalls in that band never
unlocks the one thing that would unstick it. NorCal A sat at 1,650–1,703
for 2,600 days; Florida C sat at 1,662, with the guide saying so correctly
("Grow: offices unlock at 1,800 people, and nothing else wants building").
The towns that got past 1,800 (Appalachia D and E, NorCal B) then grew
fast: 2,800 about 130 days later, 4,200 about 130 after that.

**Bare shelves: the goods don't reach the shops (Florida, worst).** In
every Florida run most shops ended with nothing to sell: 142 of 143 in one
run, 14 of 14 and 13 of 13 in the two after the fix. The goods exist. In a
saved Florida town at day 302, the factories held 4,247 units, the shops
19, and 11 trucks were on the road with 444 more, but they delivered **0**
the week before. The semis wait at the factory lots to pull out into
queues that don't move. The head of each queue waits at a junction for room
in the next lane (the "don't block the box" rule, in the traffic since
before this pass), and on a dense two-lane grid the lanes around a block
fill in a ring that takes weeks of game time to clear. Shops without goods
have no jobs, workers have nowhere to work, homes demand drops, and the
town stalls.

- *Fixed in this pass:* the demand bars lied about it. A bare shop dropped
  out of the job count, so the bars asked for **more shops** (which also
  went bare) and said there were **enough factories**. Florida A sat at
  1,214 people for 1,000 days with the guide repeating "builders are
  putting up shops on 12 zoned lots". Now bare shops count as shops, and
  the factory reason says how many have nothing to sell (commit
  "Demand: shops with bare shelves still count as shops").
- *Not fixed (proposal):* a gridlock breaker. A driver held at the line for
  more than about 20 s with the box empty could creep in, or reroute; or
  goods trucks could bypass the junction wait. That changes how every
  junction behaves, so it needs its own measured pass (carsolid,
  crosswalktest, landmarktest, throughput) and is left for the next
  traffic session. I tried making drivers park and walk in rather than
  wait on the road when a drive-thru line is full outside a grand opening.
  It didn't help (the drive-thru was never the lock), so it isn't in.

**Utilities on the ring roads (Appalachia, NorCal).** "N buildings without
water and sewage: on roads with no pump or outfall and no route to the
highway" is the most frequent guide message in the Appalachia runs, and
"no spot for waterPump / wellTower" the bot's most frequent failure. The
guide is right and says how to fix it; the bot can't place pumps on the
hills. A person would. Not a game bug.

**Services the treasury can't carry (Appalachia D/E, NorCal B).** Past
3,000 people the bot is mostly "can't afford clinic / sheriff / school",
with the treasury swinging around zero; overloaded clinics and sheriffs
slow growth but don't stop it.

**Trash at 8,000–9,400 (Appalachia B).** The best run peaked at 9,395 on
day 1,401, then nine full landfills left 269 buildings piling up trash,
and it fell to 7,804. The game warns at 75% and 90% full and on full,
naming "another landfill or an incinerator". The bot didn't build the
incinerator (its $60,000 rule). A player who reads the warnings gets
through.

## The College

Prosperity Gospel University unlocks at 4,200 people (Metroplex; only
Appalachia E and NorCal B got there). It is the only way to level-5 homes. A
school alone brings education to 0.65 at most (0.15 + 0.5 × school
coverage), level-5 homes need 0.7, and the college adds 0.4 × its coverage
within 320 m. Offices need 0.6 for levels 4–5, which full school coverage
already gives, so for offices the college only matters where schools are
thin. In the stalled towns, "Needs college grads (build a university)" was
the level cap on 155–180 homes each, long before the college could be
built.

Does it do something visible? Yes: homes in its reach grow to level 5, the
tallest models. The inspector says why a building has stopped, and the
Education view shows the college's reach. What's weak is that nothing says
what it did once built, and a tower going up a level reads as ordinary
growth. **Proposal (the owner's call):** a toast when the first home
reaches level 5 because of it ("First graduates: 12 homes can grow to
level 5"), and the college's inspector counting how many buildings it has
lifted past a cap.

## Landmarks

Each landmark needs a road that reaches the highway, and says so three
ways: the toast when it's placed off the network, the 🚧 alert when its
road goes, and its inspector ("Not connected … it does nothing: no
visitors, and no lift to land values around it", with a Draw a road
button). `scripts/linktest.mjs` checks all three.

Connected, every landmark lifts land value for zoned buildings: +15 for
each landmark within 140 m (up to +30), and +6 if any is within 300 m.

Visitors are new in this pass. Before it, no trip ever went to a landmark,
so "built the stadium, nothing happens" was exactly right. Now
(`scripts/landmarktest.mjs`):

| landmark | unlocks | cost | visitors | lot |
|---|---|---|---|---|
| 🗼 Water Tower | start | $8,000 | none (it's a water tower) | none |
| 🔥 Propane Paradise | 350 | $18,000 | sightseers, 2.0% of local trips by day | none |
| ⛽ Fill Er Up Mega Station | 650 | $30,000 | sightseers, 3.5% | live, gas-station hours |
| 💥 The Slop Cannon | 1,100 | $25,000 | sightseers, 2.5% | none |
| ⛪ Megachurch | 1,800 | $35,000 | sightseers 1.5%; services every morning, 8:30 am to 12:30 pm: 2% of the town drives in | live, full for services |
| 🐷 Pig Cabana Resort | 2,800 | $45,000 | sightseers, 3.5% | live, bar hours |
| ⚾ Slop 69 Field | 4,200 | $60,000 | sightseers 1.5%; game night every evening, 5 to 10 pm: 3% of the town (60 cars at most) drives in, and home after | live, full for the game |
| 🪰 Neural Fly Datacenter | 6,500 | $80,000 | sightseers, 1.0% | none |

Sightseeing shares are of the town's local trips between 9 am and 9 pm,
capped at 12% for all landmarks together. A day on the clock is 144 of the
calendar's days, so "every evening" is honest: each one has its Friday.

The inspector now shows **Visitors today**, says what the landmark does
(the Water Tower doesn't claim visitors), and says when its events are.

On the reference block (708 people), game night sends 21 cars. 13–14
arrive by 10 pm and 23–25 in all, since a drive across town takes a couple
of hours on the clock, longer when the crowd queues at a left turn. The
field's 12 stalls fill, and 18–19 cars drive home after, backing out of
the stalls.

**Proposals (the owner's call):** the shares and crowd sizes above are
first guesses, in two tables (`VISIT_PULL` in `src/agents/traffic.ts`,
`LANDMARK_EVENTS` in `src/agents/parking.ts`). The design doc's other ideas
for landmarks are untouched: the Slop Cannon drawing a crowd when it fires,
a feed post on game night, the stadium's lights at night. The Neural Fly
Datacenter could bring commuters (jobs) rather than sightseers.

## Balance proposals (the owner's call)

1. **Offices unlock earlier, at 1,100 (Boomburb) instead of 1,800 (Exurb).**
   It's the one lock every stalled town ran into. Alternatively, keep 1,800
   but let locked office demand spill into shops and factories.
2. **Taxes.** Every stalled town sat at 15%. The bot starts at the default
   9% and raises a point for each losing week while the treasury is thin, as
   a person would. At 15% every bar loses 27 ((15% − 9%) × 450). A stalled
   town loses money and raises taxes, which stalls it further. The guide
   does say "held back by taxes" and suggests lowering them, but a town in
   the red can't. Proposal: 300 per point instead of 450 (−18 at 15%), so a
   squeezed town can still grow out of it.
3. **Goods.** Until junctions stop locking into rings, shops could draw a
   trickle of goods from the county line at a price (imports exist, but
   only when a shop is dry and no truck is coming). Or a factory with a
   shop on its own road could stock it without a truck.

## Bugs found and fixed on the way

- The demand bars counted bare shops as missing shops (above).
- Landmarks did nothing but lift land value; no trip ever went to one.
- The landmark inspector said "Open" and nothing else.
- The bot's own tax rule cut taxes while losing money (22 bankruptcies in
  Appalachia A); it now needs the week in the black and money to spare.
- The guide, when only a locked zone was wanted, didn't say what held homes
  back; it now names the drag ("held back by taxes at 15%") and the fix.
