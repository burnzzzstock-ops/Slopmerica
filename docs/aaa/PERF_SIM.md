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
