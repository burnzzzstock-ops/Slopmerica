# Owner decisions (FABLE's lane)

Nothing here is decided by the agent. Each item has a recommendation and the evidence. The game runs with the recommended value until the owner says otherwise.

## Proposed numbers (`src/sim/tuning.ts`)

| Name | Value | What it does | Why this value | Evidence |
|---|---|---|---|---|
| `smogCell` | 2.5 | Air pollution at which a map cell counts as smoggy | The level the services already treat as the worst for land value | Reference block: worst cell 0.66, smog 0 |
| `smogFullShare` | 0.125 | Share of the map that must be smoggy for the sky to be fully sepia | An eighth of the county is a large industrial belt | To be checked on a 10,000-person town |
| `derelictDays` | 90 | Days for an abandoned building to read as fully derelict | The same 90 days an abandoned building stands before it is cleared | Matches the existing trash-cliff timing |
| `roadWearYears` | 22 | Years for an untouched road to read as fully worn (provisional, look only) | The middle of the design's 20 to 25 year maintenance cliff | Replaced by the road-condition system in the Ponzi work |

## Defaults

| Question | Recommendation | Why |
|---|---|---|
| Use the real graphics card for tests on this PC | Yes, for every test that does not measure pixels (`npm run smoke:gpu`, `npm run suite:gpu`) | 131 s against 370 s for the smoke tier, and the game runs at a player's frame rate, not 0.7 fps |
