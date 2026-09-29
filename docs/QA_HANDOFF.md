# Handoff: the late game and the phone

You're taking over a play-and-fix pass on SLOPMERICA, a satirical American
city builder (three.js r186, TypeScript, Vite, no framework). The last
playtest covered the early game on a desktop. Nobody has properly played the
**late game**, and the owner plays on an **iPhone**. Your job: play both
end to end, find what breaks or confuses, and fix it, one proven fix at a
time.

**Another session is doing graphics work in parallel.** Read "Working
alongside the graphics run" before you touch anything.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base your work on the tip of
   `claude/festive-bohr-nugn55`. Push to **your own session's branch**, never
   to `claude/festive-bohr-nugn55` (the graphics run pushes there). Don't open
   a pull request unless you're asked.
2. Read `README.md` (the test list), `docs/GAME_DESIGN.md`,
   `docs/WORKSTREAMS.md` (who owns which files) and
   `docs/GRAPHICS_HANDOFF.md` ("How to test" and "Pitfalls" apply to you too).
3. `npm install` if needed, then `npx vite --port 5173`. Debug hooks in the
   page: `window.__game` (the whole game), `window.__dbg` (`road`, `zone`,
   `run(days)`, `view(x, z, dist, yaw, pitch)`, `hour(h)`, `save()`,
   `unlockAll()`), `window.__services` (`canPlace`, `place`, `findSpot`).

## Working alongside the graphics run

- **Don't edit these files**; they're the graphics run's:
  - `src/world/*`, `src/render/*`, `src/art/*`
  - `src/roads/roadMesh.ts`, `roadSection.ts`, `streetDetails.ts`
  - the look of buildings: `src/buildings/*` models and materials
  - the `QUALITY` presets in `src/config.ts`
  - graphics scripts: `lookbook`, `nighttest`, `treelod`, `impostortest`,
    `reflecttest`, `refblock`
- **Yours:**
  - simulation and logic: `src/sim/*`, `src/transit/*`, `src/zones/*`,
    `src/roads/network.ts`, `src/tools/*`, `src/ext/*`
  - interface: `src/ui/*`, `src/style.css`
  - saves
  - new test scripts
- **Shared:** `src/game.ts` and `src/main.ts`. Keep your changes there small
  and separate.
- **If a bug's fix belongs in a graphics file,** don't make it. Write it up
  in your report (file, cause, proposed fix) for the owner to pass along.
- **Merge regularly:** merge `origin/claude/festive-bohr-nugn55` into your
  branch at least before each push, and again at the end. Resolve conflicts
  without undoing the graphics work, then re-run your tests.
- **Leave out:** the Jev scripts and their outputs (`scripts/typesafe.mjs`,
  `scripts/feedtags.mjs`, `nametags`, `learnability*`, `brandcheck`,
  `triage*`, `ipcheck`). Another session owns them.

## Rules

- **No new npm dependencies.**
- **Offline game.** Nothing in `src/` calls a network API. No API key goes in
  `src/`, the bundle, a `VITE_` variable, a log or a commit.
- **Content belongs to the owner.** Don't rename brands, rewrite jokes or
  change the satire. For a UI message that confuses players, you may fix the
  wording of the explanation (say what happened and what to do next). Leave
  the jokes alone.
- **Balance is the owner's call.** If the late game is too easy or impossible,
  measure it (money, population and time to each milestone) and propose
  numbers. Change them only if something is outright broken (a milestone
  that can't be reached, a stuck state, runaway money).
- **Every fix gets a check that fails before and passes after,** either a new
  `scripts/*.mjs` or an addition to an existing one. Put what it proves in the
  commit message. One fix per commit.

## How to test

Everything in `docs/GRAPHICS_HANDOFF.md` "How to test" applies:

- headless Chromium on a software GPU, slow
- snapshot servers so hot-reload doesn't break long runs
- `timeout: 180000` on screenshots

For playing fast:

- `__dbg.unlockAll()` opens every milestone's unlocks without grants.
- `__game.sim.growthMul = 3` and `__dbg.run(days)` fast-forward growth.
- To reach a milestone honestly, grow a real town (roads, zones, services,
  utilities) and check the numbers you'd see as a player.
- Existing tests to lean on and keep passing:
  - **economy and progression:** `econtest`, `ledgertest`, `progression`,
    `progresstest`
  - **transit and roads:** `transittest`, `interchangetest`, `gridtest`
  - **disasters, saves, stability:** `disasters-test`, `savetest`,
    `savecontinuity`, `soak`, `nantest`, `leakprobe`
  - **touch and UI:** `touchtest`, `mobileshots`, `overlaptest`, `uisweep`,
    `tooltest`, `tiptest`, `placetest`, `servicestest`
- **Phone:** a context of
  `{ viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true }`.
  Touch devices default to the Low preset. Drive it with real touch events
  (`page.touchscreen.tap`, and CDP `Input.dispatchTouchEvent` for drags and
  pinches), not mouse clicks: that's how the owner plays.

## What to play, in order

1. **The phone, first ten minutes.** Fresh game on the iPhone context. Do what
   the Step 1–5 guide says:
   - Draw a road with one finger.
   - Zone.
   - Place a service.
   - Open and close every panel.
   - Pinch and two-finger pan.
   - Use the bug reporter.

   Look for:
   - tap targets under 44 px
   - panels covering what you're trying to touch
   - gestures that zoom when you meant to draw
   - text that doesn't fit
   - anything that needs a hover

   Record frame time on Low.
2. **Progression to the top.** Grow a city from Wide Spot in the Road through
   Metroplex, Megalopolis and Capital of Slop (10,000 people).
   - At each milestone: does the popup say what unlocked, is it usable right
     away, does the Next guide point somewhere sensible?
   - Time each milestone in game days, and note what blocked growth.
   - Use the College when it unlocks: does it do something visible?
3. **Every landmark and special building.** Place each one:
   - Does it need a road, and does it say so clearly?
   - Does it change anything (traffic, land value, visitors)?
   - Does the inspector explain it?

   The triage file had "Built the stadium, nothing happens".
4. **Transit and interchanges.**
   - Build bus lines across a town.
   - Bulldoze and rebuild roads under them.
   - Upgrade roads with transit on them.
   - Build each prebuilt interchange onto a live highway.
   - Check riders, fares, costs and the route list stay honest (the ledger
     must balance).
5. **Money to the edge.** On purpose:
   - Take loans, repay them early and on schedule.
   - Run a deficit into debt and then bankruptcy.
   - Recover from it.

   Is every state explained, is the countdown honest, and is the way out
   clear? Nothing may leave the city stuck or the numbers disagreeing between
   the top bar, the budget panel and the ledger.
6. **Every disaster and weather emergency.**
   - Hurricane (Florida)
   - Wildfire (NorCal)
   - Landslide (Appalachia)
   - Florida Man
   - blizzards
   - floods and storm surge

   For each: does it fire, warn, get explained, cost what it says, and end?
   Save and reload in the middle of each.
7. **Saves, the long way.**
   - Load a city file from the title screen.
   - Autosave and Continue after a two-hour session.
   - Grid, then Undo, then save.

   The triage file had "load froze" and "grid Undo crashed": reproduce them
   or show they're fixed. Soak at top speed for a long session and watch
   memory, NaNs and frame time.

## Finishing

- Write `docs/PLAYTEST_6.md`:
  - what you played (map, mode, days, population)
  - every finding, ranked by severity, with its status: fixed with the check
    that proves it, proposed (with numbers, for the owner), or a graphics-file
    fix for the other run
- Merge the latest `origin/claude/festive-bohr-nugn55` into your branch, then
  run the whole test list from `README.md`. Every test passes, or you say
  exactly which fails and why.
- `npm run build:single`, and check the bundle has no API keys and no
  `typesafe`. **Don't publish to the main game link** (the graphics run
  does). If you can publish, put your build up as a *new* artifact and give
  the owner that link to try on their phone.
- Report plainly:
  - your branch name
  - what you fixed (with proof)
  - what you propose
  - what you didn't get to
