# Where a simulation step's time goes

Measured with `scripts/simperf.mjs`: it opens a saved town, steps the simulation with nothing drawn, and times each part of `Game.step()`. One step is 1/32 of a game day; top speed runs 128 steps a second, so a step that takes 7.8 ms uses a whole core at top speed.

**Machine:** the development PC (32 cores, RTX 5090, Chrome 157). A phone is several times slower per core: treat these as the floor, and the shares as what carries over.

**Town:** `shots/towns/florida-10k.json` (not in the repo: grown by the scripted player). Florida, 14,440 people, 637 buildings, 245 road pieces, about 1,000 cars on the road, 110 people on foot. 640 steps (20 game days).

```sh
node scripts/snapshot.mjs perf 5181 &
BASE_URL=http://127.0.0.1:5181 GPU=1 TOWN=shots/towns/florida-10k.json node scripts/simperf.mjs
```

## 17 Nov 2026

| | Before | After the land value fix |
|---|---|---|
| A step, on average | 4.28 ms | 3.85 ms |
| Median step | 3.30 ms | 3.00 ms |
| 99th percentile | 38.5 ms | 23.6 ms |
| Slowest step | 61.9 ms | 41.2 ms |
| Share of one core at top speed | 55% | 49% |

Where the average step goes (before the fix):

| Part | ms a step | Share |
|---|---|---|
| Traffic | 3.35 | 78% |
| Sim (demand, growth, money, the daily and weekly ticks) | 0.66 | 15% |
| People on foot | 0.22 | 5% |
| Services | 0.04 | 1% |
| Weather, zoning sync, communes, transit, districts, hooks | under 0.02 together | 0% |

## 17 Nov 2026, later: the reference town as a phone would run it

The look lane's frame timings on Low with the CPU slowed four times miss their target on the frames that run a simulation step (its `Performance/Low-phone-CPU-profile.md`). This is the same town with nothing drawn: `scripts/fixtures/refblock-town.json.gz`, 969 people, 143 buildings, 128 road pieces, 166 cars, 141 people on foot, 640 steps.

```sh
BASE_URL=http://127.0.0.1:5183 GPU=1 TOWN=ref node scripts/simperf.mjs               # as this PC runs it
BASE_URL=http://127.0.0.1:5183 GPU=1 TOWN=ref THROTTLE=4 node scripts/simperf.mjs    # Chrome's CPU slowed four times
BASE_URL=http://127.0.0.1:5183 GPU=1 TOWN=ref PROFILE=1 node scripts/simperf.mjs     # and which functions the time is in
```

| | This PC | Slowed four times |
|---|---|---|
| A step, on average | 1.32 ms | 6.52 ms |
| Median step | 1.10 ms | 5.40 ms |
| The 20 steps that end a day, on average | 6.3 ms | 28.6 ms |
| The slowest of them | 18.0 ms | 45.5 ms |
| Every other step, on average | 1.16 ms | 5.81 ms |
| Their 99th percentile | 2.8 ms | 14.2 ms |
| Share of one core at top speed (128 steps a second) | 17% | 83% |

(Taken while another lane's software-rendered test was running on the machine, so the absolute figures are a little high. The shares are not affected.)

What this says for a phone, on a town of under a thousand people:

- **A hitch at the end of every game day.** One step in 32 costs 29 ms on average and up to 45, on top of the frame it lands in. At normal speed that is every 2.5 seconds; at top speed four times as often.
- **Top speed has no room.** The simulation alone takes five sixths of a core at top speed, before anything is drawn.
- **An ordinary step is 6 ms**, three quarters of it traffic: a third of a 60-a-second frame.

Where the day's end goes (the profile, this PC, ms over 21 day ends): the services' daily pass 36 (its fields 8, wellbeing 4, coverage 4, the service-road graph 4), the sprawl meter 31 (18 of it finding the nearest road to each point it looks at), land value and levels 17 (11 of it the 140 m neighbour count), freight's deliveries for the day 16. A week's end adds the budget.

Where an ordinary step goes inside traffic (590 ms over 672 steps): the main loop's own code 253, working out where every car is in the world 207 (`place` and `pathPointInto`, every car on every step whether it moved or not), sending trips out 28, checking the box at junctions 21.

**What to do, in this order:** (1) make the day's end cheaper without changing a number it produces (the nearest-road search, the neighbour count, a spatial query that builds a new set on every call); (2) then spread what is left over the day's steps, each part on a step of its own, which changes the step things happen on and so needs its own before and after; (3) a car that has not moved keeps its place.

### What has been done about it

- **b4559eb, the sprawl meter:** empty land is answered from the spatial grids' own cells, and the road question stops at the first road. Identical county on both towns (45 and 30 days, every fingerprint). The meter's time over 21 day ends went from 29.2 to 20.4 ms on the reference town and from 50.1 to 36.5 on the Florida town. A first try that only shortened the road search gained nothing: the time was in building a set for every lookup, not in measuring distances. Measure with `PROFILE=1` before believing a guess.

- **1e9a2b2 and 6600d25, the day's end spread over the day:** the sprawl meter looks at its sample points a few every step, and land value with level-ups runs at noon on its third day. On the reference town the simulation's work in the 21 day-ending steps profiled went from 101 ms to 48 (4.8 ms a day end to 2.3 on this PC, so about 19 to 9 slowed four times). What is left in a day end: the services' pass 28, freight 5 to 16, the county's own demand, growth and money. The sprawl sweep is now 22.6 ms spread over all 672 steps (0.03 ms each), and land value is 2 ms on a noon step every third day. Both change which step something happens in, so the county takes a different course than before from the same seed; it is still the same county however it is run (the determinism test, seven ways, 180 days).
- **Tried and taken back out: the services' daily pass in a step of its own.** A step before the day's end, nobody ever moves into a home with no water (the pass marks it before the county's daily work fills it; people moving in and then leaving is what the game teaches with). A step after, three things that read its results at the day's end read yesterday's: freight (shops did not run dry when the factory's roads were cut), the advisor bot (a sixth clinic for a town that needs five), and it also showed two things worth knowing whoever tries again: the problem icons, on a frame, are the first to ask for a new building's or a facility's record and so make it, and the facilities' records are kept in the order they were first asked for. To move the pass, each of freight, the disasters and the bot has to say what it reads from it, and those records have to be made in a step.
- **Timings need a quiet machine.** While another lane runs a suite (100% of 32 cores, 80 browsers) the same measurement gives 13 ms and 37 ms on two runs. The profile's shares hold up under load; the milliseconds do not.

### The big town's day end is mostly drawing work

On the Florida town (14,440 people) a day-ending step is 28 ms on average on this PC and 90 to 170 at worst. The profile of 21 of them (580 ms):

| Part | ms | What it is |
|---|---|---|
| Land value and levels | 221 | 114 of it is `levelUp`, and nearly all of that is making the levelled-up building's new model on the spot |
| The services' daily pass | 201 | simulation work |
| Making building models, in all (`modelFor`) | 136 | the generator (52), then the far-away outline for it (`buildingSilhouette`, 68, of which 58 is one function, `overlap`, in `src/render/buildingLod.ts`) |
| The sprawl meter | 37 | after the fix above |

So a quarter of the big town's day end is not simulation at all: it is a model being generated and outlined inside the fixed step, because the step is where the building levelled up. The same kind of work shows in ordinary steps on the reference town: a new car's model variant (`quantize`, `src/agents/models/vehicleKit.ts`) when a trip is sent out, and terrain chunks rebuilt (`shade`, `buildChunk`, `src/world/terrain.ts`) when a lot is painted. None of it changes the county, so all of it can wait for a frame with time to spare. It is asked of the look lane in `REQUESTS_FABLE.md`.

## Hot spots

1. **A hitch every third day, in the sim's land value and levels pass** (`Sim.landValueAndLevels`). It runs for every zoned building in one step. On this town: 29 ms warm, and the step it lands in took 44 to 69 ms. At top speed that is a dropped frame or three every three quarters of a second.
   - **Fixed in part:** over half of it was a 300 m search round every building, 200 buildings a search, only to see whether any landmark was near. It now asks the handful of landmarks directly, which gives the same answer: every one of the county's 22 fingerprints, and every building's land value and level, are identical after 45 days on the reference town and 30 days on this one. The pass's share of the slow step went from 37 to 63 ms down to 20 to 30 ms.
   - **Left:** the 140 m neighbour count round every building (5 ms here, and it grows with the square of density), and the step still does the whole county at once. Spreading the buildings over the three days' 96 steps would remove the hitch, but it changes which step a building levels up on, so it changes the county: it needs its own before and after.
2. **Traffic is four fifths of an ordinary step:** 3.3 ms for 1,000 cars. Nothing in it stands out yet; it has not been profiled inside.
3. **The daily tick:** steps that end a day are the next slowest after the every-third-day ones (the 99th percentile, 24 ms after the fix). Not broken down yet.

## Not measured yet

- Saving: how long the game stops when it writes a save of this size (3.3 million characters, 0.75 million packed).
- A town of 50,000, which is where the brief wants the traffic model to still hold.
- The same steps on a phone.
