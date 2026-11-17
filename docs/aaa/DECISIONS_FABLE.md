# Owner decisions (FABLE's lane)

Nothing here is decided by the agent. Each item has a recommendation and the evidence. The game runs with the recommended value until the owner says otherwise.

## Behaviour that changed and that you would notice

| What | Before | Now | Why | Say no and |
|---|---|---|---|---|
| Waits at normal and double speed | Door and kerb waits, bus dwell and a commune packing up ran on real seconds, so in game time they were 4x shorter at normal speed and 2x shorter at double speed than at top speed | The same length in game time at every speed (the length they had at top speed) | A wait on real seconds makes the county depend on the frame rate and the speed button. Top speed is where traffic was tuned and tested | I scale them by a constant in `src/core/time.ts`; pick the pace you want |
| A drunk driver's weave | Advanced once per frame: barely moved at top speed, raced at normal speed | 1.6 radians per game second at every speed | Same reason | One constant |
| How fast roads get wet and snow settles | Partly real time | Game time, at the rate the sky had at top speed: wet in about 8 calendar days of rain, dry over about 72 | Same reason | Two constants in `src/sim/climate.ts` |
| The shortest weather spell | 12 real seconds at the speed set | The same (after a detour: for half a day it was a fixed 19 days, which made rain last weeks at normal speed; `weathertest` caught it) | It is your accepted behaviour | Nothing to do |
| A drive-thru that closes or is rebuilt without a window | Cars already on their way waited at its kerb, on the road, for good; a main street could lock up behind them with no alert | They pull into the lot like any other visit (897fd37) | It was a bug, found on the new reference town | Nothing to do |
| A shop that levels up into a drive-thru | It got no lane and no grand opening until the county was reloaded | It gets both at once (ef3b669) | It was a bug | Nothing to do |
| The first-steps card on a phone | Three lines and a button, always | One line while a drawer is open or a tool is in hand (a tap opens it); hidden while a finger draws | The card, a drawer and the toolbar covered 45 to 56% of a 390 x 844 screen | I put the full card back; one CSS class |
| The reference town every look and traffic test opens | 262 buildings, no main street, no working utilities | 969 people, 143 buildings, with its main street, plants, wells, landfill and sewage works | The old one was broken by a bug in the script that grew it; tests were measuring a town in a permanent utility emergency | Keep both; the old one is still in the repo |

## Balance questions the tests raised

| Question | What was measured | Recommendation |
|---|---|---|
| How early fans set off for a game (`EVENT_SLACK` in `src/agents/traffic.ts`, 6 times the free-flow drive) | On the reference town with its traffic moving, 16 to 22 of 29 fans are in their seats by kickoff (seeds 1 to 6); the test asks two in three. On the first reference town, which had little traffic, 18 to 21 of 21 were | Leave the number until the traffic phase has dealt with driveway waits and junction losses, then measure again: the slack may be fine once a car is not held 5 minutes in its own driveway |
| How much actuated traffic lights should help | At their best junction they carry 11 to 33% more cars than fixed greens (six seeds); the test asks a fifth more. Leading greens for left turns cost all the lights 10 to 19% of their cars on two seeds of six | A finding for the traffic phase, not a number to change now |

## What ONE MORE LANE's record shows

The design says: "Induced demand really works (widen the road and the traffic comes back)" and "it always works for about 18 months". The game now measures it (the road inspector's chart, `scripts/onemorelane.mjs`), and **today it is not true on a town that is not growing**: three seeds, the fullest stroad piece widened from four lanes to six, 35 to 45% full at its busiest before, at most 31% in the 78 weeks after. The lane works for good.

The cause is in how trips are made: a trip picks its shop or its job at random, whatever the drive takes. The fix that matches the design ("where people go and how they get there both depend on travel time") is to weigh a few candidate destinations by today's drive. It changes traffic in every town, so it comes as its own piece of work with before and after numbers on six seeds and the large town. **Nothing to decide yet; this is so you are not surprised by a chart that says the lane worked.**

## Proposed numbers (`src/sim/tuning.ts`)

| Name | Value | What it does | Why this value | Evidence |
|---|---|---|---|---|
| `smogCell` | 2.5 | Air pollution at which a map cell counts as smoggy | The level the services already treat as the worst for land value | Reference town: worst cell 0.66, smog 0 |
| `smogFullShare` | 0.125 | Share of the map that must be smoggy for the sky to be fully sepia | An eighth of the county is a large industrial belt | To be checked on the 10,000-person town |
| `derelictDays` | 90 | Days for an abandoned building to read as fully derelict | The same 90 days an abandoned building stands before it is cleared | Matches the existing trash-cliff timing |
| `roadWearYears` | 22 | Years for an untouched road to read as fully worn (provisional, look only) | The middle of the design's 20 to 25 year maintenance cliff | Replaced by the road-condition system in the Ponzi work |
| `crashWreckSpeed` | 40 | The crashed cars' speeds added up (m/s) at which the look and sound treat a crash as a full wreck | Two cars at a Freedom Stroad's 20 m/s | Nothing in the simulation reads it |
| `widening.weeks` | 78 | How long a widening is followed, one reading a week | The design's "about 18 months" | `scripts/onemorelane.mjs` |
| `widening.minBefore` | 0.33 | How full a road must have been at its busiest for "traffic is back" to be worth a headline | A road nobody used is "back" the first week otherwise | Reasoned; no town has reached it yet |
| `widening.minWeeks` | 4 | No "back to normal" headline in the first month | The works clear the road of cars, and they take a while to return | Reasoned |
| `widening.peakDays` | 144 | The stretch of days a road's "busiest lately" covers (this one and the one before) | One turn of the day-and-night clock, so it always holds a whole day's rush hours | Weekly readings swung between 0% and 26% without it |
| `disasterLook` | hurricane 4345 m / 1.0, wildfire 35 m / 0.8, landslide 30 m / 0.6, Florida Man 40 m / 0.2 | The reach and strength of a disaster as the look and sound are told them | Each matches what the disaster does in the simulation (a wildfire front burns 35 m round) | Nothing in the simulation reads it |

## Defaults

| Question | Recommendation | Why |
|---|---|---|
| Use the real graphics card for tests on this PC | Yes, for every test that does not measure pixels (`npm run smoke:gpu`, `npm run suite:gpu`) | 131 s against 370 s for the smoke tier, and the game runs at a player's frame rate, not 0.7 fps |
| Pack a save when it is larger than | 1,000,000 characters | Below that the browser's 5 MB of storage is not at risk and a plain-text save is easier to inspect. A 14,632-person county is 3.29 million characters plain and 0.75 million packed (4.4x) |
| The one-file build (`npm run build:single`) carries the model packs inside | Yes: one 12.1 MB file that runs from a double-click with no server | It was a small file that silently loaded no models when opened from disk |
| vite 8.3.1 to 8.3.8, source-map-js to 1.2.2 | Keep | Patch bumps that clear `npm audit` (0 vulnerabilities). No new dependency |
| The county's dice | Seed 1 under automation; a random seed for a player's new city, saved with it; `#seed=N` to pick one | The same seed and the same inputs give the same county, which is what makes a bug report replayable |
| Local AI tools on this PC, for the play lane | Use the local language model (Qwen 3.6 35B on Ollama: it reads images, runs offline, costs nothing) at dev time only, as a first-time player: it is shown the phone screen and asked what it understands and what it would tap, and it drives scripted playtests. It never writes a joke, a name or a balance number, and nothing in the game calls it | A UI that teaches is the goal of Phase 2, and a reader who has never seen the game is the test of it. It is the same rule the brief sets for the TypeSafe model |
| Local AI tools, for art and sound | Passed to the look lane as a request (image, upscaling, masks, music and effects models are installed under ComfyUI). **Yours to decide before any of it ships: each model's licence for output in a released game**, and whether generated art and music fit the game at all. Until you say yes, anything generated stays PROPOSED and out of the build | Content is your call, and a licence is not something an agent should guess |
| The third lane (the director and reviewer) and files the other lanes own | It reviews, generates art and plays; a change it wants in a file another lane owns goes in as a request, or as a commit on its own branch that touches only that file. `aaa/integration` is still merged and pushed from the play lane only | Its handoff also lists "cross-branch integration" as its job. Two agents pushing one branch is how work gets lost. **Say if you want it otherwise** |
| The order of work after the roadmap of 17 Nov | Phone screen first, then the look lane's waiting features, One More Lane, Honest Mode, the visible Ponzi, the Plat-o-Matic and Old Main; the rest of the foundation (people independent of the camera, save slots UI, hot spots) fitted in between | The roadmap asks for fun first, and the phone is where you play. The remaining foundation items block none of these |
| Words the roadmap proposes that are not in `GAME_DESIGN.md` | Used as written where the roadmap you pasted gives them ("80% FEDERAL HIGHWAY GRANT APPROVED", "Whispering Oaks Estates: 0 Oaks Remaining"); any other new line is marked PROPOSED in `src/content/` and listed here before it ships | Content is your call |
| The build's size budget (`scripts/budgets.json`: 2,255,099 bytes, 5% over allowed) | Raise the baseline to today's size at the next integration, and keep 5% | The main bundle is 2,334 kB, 3.5% over the baseline set before either lane added a feature: the look lane's icons and photo mode and this lane's HUD wiring and widening record. It will cross 5% with the next feature, and the budget is there to catch an accident, not to refuse features |
| Fast-forward `main` to `aaa/integration` | Not yet | The integration suite has three failures that are also on the base (two look tests, one traffic test on some seeds) and one new look test that fails on its own branch |
