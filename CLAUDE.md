# Working on SLOPMERICA

This file and `CLAUDE.md` have the same content (one is read by Codex, the other by Claude Code). Change both together.

SLOPMERICA is a satirical 3D city builder in the browser: TypeScript, three.js, Vite, no UI framework. The vision is in `docs/GAME_DESIGN.md`; the code is the truth. The owner plays on a phone at the Low preset.

## Where things are

| What | Where |
|---|---|
| The two briefs for the current push | `docs/aaa/FABLE.md` (how the game plays and reads), `docs/aaa/ASTRA.md` (how the world looks and sounds) |
| Each agent's log (a fresh session can take over from it) | `docs/aaa/LOG_FABLE.md`, `docs/aaa/LOG_ASTRA.md` |
| Requests across lanes | `docs/aaa/REQUESTS_FABLE.md`, `docs/aaa/REQUESTS_ASTRA.md` |
| Decisions for the owner | `docs/aaa/DECISIONS_FABLE.md`, `docs/aaa/DECISIONS_ASTRA.md` |
| Typed seams between the lanes | `src/contracts.ts` |
| The test list | `scripts/tests/fable.json`, `astra.json`, `shared.json` |
| Every new number that is the owner's call | `src/sim/tuning.ts`, marked PROPOSED |

## Lanes (who edits what)

| | Play and read | Look and sound |
|---|---|---|
| Owns | `src/sim/*` (except the rendering block of `sim/buildings.ts` and `sim/serviceIcons.ts`), `src/zones/*`, `src/transit/*`, `src/tools/*`, `src/ui/*`, `src/style.css`, `index.html`, `src/content/*`, `src/ext/*`, `src/core/*`, `src/agents/traffic.ts`, `parking.ts`, `pedestrians.ts`, `communes.ts`, `src/roads/network.ts`, `roadJunction.ts`, `roadTypes.ts`, `src/world/maps.ts`, `src/dev/debug.ts`, the test harness (`scripts/suite.mjs`, `scripts/gate.mjs`, `scripts/lib/*`, `scripts/refblock.mjs`, snapshot and slot tooling, the registry format) and the sim and UI test scripts | `src/render/*`, `src/world/*` except `maps.ts`, `src/buildings/*`, `src/art/*`, `src/vault/*`, `src/civic/*`, `src/agents/vehicles.ts`, `vehicleFx.ts`, `people.ts`, `models/*`, `ambient.ts`, `communeBuilder.ts`, `src/audio/*`, `src/roads/roadMesh.ts`, `roadSection.ts`, `streetDetails.ts`, `src/sim/serviceIcons.ts`, the rendering block of `src/sim/buildings.ts` (commits titled `Render:`), the asset library and vault apps, `dev/*.html`, `src/dev/*` except `debug.ts`, `scripts/look/*` and the look, perf and audio scripts |
| Shared: small, separate commits; merge `aaa/integration` first | `src/game.ts`, `src/config.ts`, `src/main.ts`, `src/contracts.ts`, `vite.config.ts`, `package.json`, `README.md` | same |

If a fix belongs in the other lane's files, do not make it: write it in your `REQUESTS_*.md` (file, cause, proposed fix, what it blocks) and move on.

Heightfield generation is frozen for everyone: saves keep only edits, and the world regenerates from its seed.

## Branches

- `aaa/integration` is where both branches meet. Only its owner (the play lane) merges and pushes it, after the gates below pass on the merge.
- `claude/aaa-play` and `codex/aaa-world` are the two working branches, each in its own worktree. Merge `origin/aaa/integration` into yours before every push and at least every 3 hours.
- Never force-push. Never push to the other lane's branch or to `main`. No pull requests unless the owner asks.
- Text files are LF everywhere (`.gitattributes`). In a new worktree run `git config core.autocrlf false`.

## Gates

```sh
npm run gate        # before every commit, about a minute: typecheck, build and its size budget, the tests that need no browser, the registry lint
npm run smoke:gpu   # before every push, about 2 minutes on this PC: the 15 quick browser tests on a frozen copy of the tree
npm run suite:gpu   # at every integration merge: every pass/fail test (about 20 minutes)
```

- `npm run smoke` and `npm run suite` are the same on software rendering (SwiftShader), for a machine with no graphics card.
- A commit lands only with the gate passing. A push lands only with smoke passing, or with each failure shown to fail on the parent too (say so in the message).
- Do not pipe a gate or a test through `tail` or `head` in a command that goes on to commit or push: the pipe hides the exit code.
- Every script at the top of `scripts/` must be in a registry file, as a test or as a `measure` entry with a `why`; the gate's lint fails otherwise.
- A test that reads pixels back or depends on frame cost is marked `"pixels": true` and always runs on SwiftShader, so its numbers are the same on every machine.

## Running tests

- From the repo root of your own worktree, always.
- `node scripts/suite.mjs --only <name> --serve <port>` copies your tree to a frozen snapshot and serves it for the run, so editing `src/` never reloads a running test. Use it for one test as well as for many.
- `node scripts/snapshot.mjs <name> <port>` serves a frozen copy yourself, for a before/after pair on two ports.
- Ports: 5180 to 5189 for the play lane, 5190 to 5199 for the look lane. One `--serve` run per port at a time.
- At most 4 browsers at once per checkout (`scripts/lib/slots.mjs`); `launch()` from `scripts/lib/browser.mjs` takes a slot itself. Start every browser through `launch()`: nothing else may name a browser path.
- `GPU=1` (or `--gpu` on the suite) draws with the real graphics card. `SEED=n` sets the county's dice for a seeded test (default 1; `FUZZ=1` picks one and prints it). One run proves nothing for anything with traffic in it: compare several seeds.
- A Node rig that loads `src/` through Vite in middleware mode must pass `ws: false`, or two rigs at once clash on a port.
- The reference town every look and traffic test opens is a committed fixture (`scripts/fixtures/refblock-town.json.gz`). Change it only in a commit of its own that says so: every number measured on it moves.
- `REFTOWN=v1` opens the town it replaced (`scripts/fixtures/refblock-town.json`: no main street, no working utilities). The suite sets it for every test in `astra.json`, because the look lane's numbers were recorded on that town; a test moves to today's town with `"env": {"REFTOWN": "new"}`. Run a look script by hand with `REFTOWN=v1` to get the town its numbers expect.

## The simulation is deterministic. Keep it so.

The same seed and the same inputs give the same county at any frame rate, on any graphics preset, stepped by hand or live, and across a save and reload at any point. `scripts/determinism.mjs` proves it; `scripts/simpure.mjs` (in the gate) guards it.

- Everything that changes the county happens in `Game.step()`: one fixed step of 1/32 game day (0.078125 game seconds). `Game.frame()` only turns real time into whole steps and draws.
- Nothing in a step may read the frame time, the wall clock, the camera's per-frame state, the graphics preset or `Math.random`. A delay is a count of steps. Dice come from a seeded stream (`streamSeed(game.seed, name)` in `src/core/rng.ts`), one stream per system. Looks and words use the cosmetic stream `fx`.
- Rendering and audio must never change simulation state. They read `game.fields` and listen to `game.sim.events` (`src/contracts.ts`).
- A graphics preset may cap what is drawn, never what is simulated (`scripts/qualitytest.mjs`).
- New simulation state must be saved exactly: add it to the system's exact save (`src/sim/state.ts`, or `saveExact` / `loadExact` on an extension system) and check `MODES=stepped,f30,reload node scripts/determinism.mjs`. A change of save shape needs a new save version and a migration in `src/sim/save.ts`.

## The owner's rules

- No new npm dependencies. Patch bumps of existing ones to clear `npm audit` are fine; list them in the commit.
- The game is offline. Nothing in `src/` calls a network API. No key or token goes into `src/`, the bundle, a `VITE_` variable, a log, a commit or a report. Never open or print `.env.local`.
- The TypeSafe (Jev) model is for Node scripts at dev or build time only, each with a `--dry-run` that needs no key; never in the game, never per frame, never for jokes, names or balance. Report requests, tokens and dollars per run; a full pass stays under $1.
- Content and balance are the owner's call. Do not rename brands or rewrite existing jokes. Change an existing balance constant only when it is outright broken or the owner says yes; measure and propose instead. New numbers go in `src/sim/tuning.ts` marked PROPOSED and are listed in `DECISIONS_*.md` with evidence.
- Content rules (`docs/WORKSTREAMS.md`): raunchy-ish is fine, nothing sexually explicit; mock ideologies, online behaviour, corporations and both political tribes; no slurs, no jokes aimed at race, religion-as-identity, disability or sexuality; public figures only as obvious parody names kept in data; no real logos; the SLOP / Imagine Supply Co. brand is the owner's own and is used straight. Punch at systems, not people. The game is a true believer and never winks.
- Every UI change works at 390 px with a finger first.
- Every fix gets a check that fails before and passes after (for pure looks: a fixed-camera before/after sheet and a number).
- One change per commit. Subject in the house style `Area: plain-English outcome`; the body carries the before and after numbers, the seeds and the preset. Look at `git log`.
- No model or agent names in code, in docs you write, or in commit subjects and bodies. The brief, log, request and decision files under `docs/aaa/` and the two registry file names are the exception.

## Debug hooks are a public API

More than a hundred tests use `window.__game`, `__dbg` (`road`, `zone`, `run(days)`, `view`, `hour`, `save`, `snapshot`, `fingerprint`, `dump`, `unlockAll`, `showcase`), `__services`, `__land`, `__vault`, `__startSite`, `__people`, `__atmo`, `__lineup`, `__gallery`. Add, never rename or remove.

They exist only on the dev server, with `#debug` or `#playtest` on the address, or with `localStorage['slopmerica.debug'] = '1'` (`src/core/flags.ts`). The test launcher sets that for every page. A player's build has none of them, and none of the playtest tools (`#playtest` brings those back and is remembered; `#playtest=0` turns it off).

## Writing

Code comments say why, in plain English. Docs and commit messages are for a reader who was not there: say what changed, what it was before, and the numbers.
