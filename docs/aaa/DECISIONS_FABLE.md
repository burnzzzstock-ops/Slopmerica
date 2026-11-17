# Owner decisions (FABLE's lane)

Nothing here is decided by the agent. Each item has a recommendation and the evidence. The game runs with the recommended value until the owner says otherwise.

## Behaviour that changed and that you would notice

| What | Before | Now | Why | Say no and |
|---|---|---|---|---|
| Waits at normal and double speed | Door and kerb waits, bus dwell and a commune packing up ran on real seconds, so in game time they were 4x shorter at normal speed and 2x shorter at double speed than at top speed | The same length in game time at every speed (the length they had at top speed) | A wait on real seconds makes the county depend on the frame rate and the speed button. Top speed is where traffic was tuned and tested | I scale them by a constant in `src/core/time.ts`; pick the pace you want |
| A drunk driver's weave | Advanced once per frame: barely moved at top speed, raced at normal speed | 1.6 radians per game second at every speed | Same reason | One constant |
| How fast roads get wet and snow settles | Partly real time | Game time, at the rate the sky had at top speed: wet in about 8 calendar days of rain, dry over about 72 | Same reason | Two constants in `src/sim/climate.ts` |
| The shortest weather spell | 12 real seconds at the speed set | The same (after a detour: for half a day it was a fixed 19 days, which made rain last weeks at normal speed; `weathertest` caught it) | It is your accepted behaviour | Nothing to do |
| The reference town every look and traffic test opens | 262 buildings, no main street, no working utilities | 969 people, 143 buildings, with its main street, plants, wells, landfill and sewage works | The old one was broken by a bug in the script that grew it; tests were measuring a town in a permanent utility emergency | Keep both; the old one is still in the repo |

## Proposed numbers (`src/sim/tuning.ts`)

| Name | Value | What it does | Why this value | Evidence |
|---|---|---|---|---|
| `smogCell` | 2.5 | Air pollution at which a map cell counts as smoggy | The level the services already treat as the worst for land value | Reference town: worst cell 0.66, smog 0 |
| `smogFullShare` | 0.125 | Share of the map that must be smoggy for the sky to be fully sepia | An eighth of the county is a large industrial belt | To be checked on the 10,000-person town |
| `derelictDays` | 90 | Days for an abandoned building to read as fully derelict | The same 90 days an abandoned building stands before it is cleared | Matches the existing trash-cliff timing |
| `roadWearYears` | 22 | Years for an untouched road to read as fully worn (provisional, look only) | The middle of the design's 20 to 25 year maintenance cliff | Replaced by the road-condition system in the Ponzi work |
| `crashWreckSpeed` | 40 | The crashed cars' speeds added up (m/s) at which the look and sound treat a crash as a full wreck | Two cars at a Freedom Stroad's 20 m/s | Nothing in the simulation reads it |
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
| Fast-forward `main` to `aaa/integration` | Not yet | The integration suite has three failures that are also on the base (two look tests, one traffic test on some seeds) and one new look test that fails on its own branch |
