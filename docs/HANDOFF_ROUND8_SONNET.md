# Handoff (round 8, Sonnet): what the player sees and touches

You're taking over a polish-and-QA pass on SLOPMERICA, a satirical American city
builder (three.js r186, TypeScript, Vite, no framework). The owner plays the
published build on an **iPhone**. The last rounds merged a traffic pass and a
new look for cars, people and towers (`claude/festive-bohr-nugn55`, c908e7d or
later). This round is an **audit, then fixes**: play it as the owner would, find
what looks wrong, reads wrong or doesn't work, and fix it one proven change at a
time. Some items below are already known; the audit finds the rest.

**An Opus session works in parallel on the simulation** (traffic, people
crossing, freight, the late game; `docs/HANDOFF_ROUND8_OPUS.md`). Read "Working
alongside" before you edit anything.

## Start here

1. Repo `burnzzzstock-ops/Slopmerica`. Base on the tip of
   `claude/festive-bohr-nugn55`. Push to **your own session's branch**, never to
   `claude/festive-bohr-nugn55`. Don't open a pull request unless asked.
2. Read: `README.md` (the test list), `docs/WORKSTREAMS.md` (content rules),
   `docs/CARS_LOOK_REPORT.md` (what the look pass did and didn't finish),
   `docs/GRAPHICS_HANDOFF.md` ("How to test" and "Pitfalls").
3. `npm install` if needed. Debug hooks in the page: `window.__game` (the whole
   game), `window.__dbg` (`run(days)`, `view(x, z, dist, yaw, pitch)`,
   `hour(h)`, `save()`, `unlockAll()`), `window.__services`.

## Working alongside

**Yours:**
- `src/ui/*`, `src/style.css`, `index.html`;
- `src/render/*`, `src/world/*`, `src/art/*`, `src/audio/*`;
- `src/agents/vehicles.ts`, `src/agents/models/*`, `src/agents/people.ts` (how
  cars and people look, not where they go);
- the `QUALITY` presets in `src/config.ts`;
- these test scripts: `playtestcheck`, `feedtest`, `yellowflash`, `glcheck`,
  `uisweep`, `touchtest`, `nighttest`, `presetlight`, `peoplecost`, and the new
  suite runner (item 5);
- `docs/AUDIT_ROUND8_UI.md` (new).

**Opus's; don't edit:** `src/agents/traffic.ts`, `src/agents/parking.ts`,
`src/agents/pedestrians.ts`, `src/sim/*`, `src/transit/*`, `src/zones/*`,
`src/roads/*`, and the traffic, freight and late-game tests (`carsolid`,
`crosswalktest`, `landmarktest`, `parkingtest`, `trafficscale`, `freighttest`,
`playtest6-late`, `progresstest`, `demandtest`, `econtest`).

**Shared:** `src/game.ts`, `src/config.ts` (outside the presets), `README.md`
(one line per new script). Keep changes there small and in their own commits.

If a fix belongs in Opus's files, don't make it: write it up in your report
(file, what's wrong, how you saw it). **Merge** `origin/claude/festive-bohr-nugn55`
into your branch before each push and at the end, without undoing anyone's
work, then rerun your tests.

## Rules (the owner's)

- **No new npm dependencies.**
- **Offline game.** Nothing in `src/` calls a network API. No API key goes into
  `src/`, the bundle, a `VITE_` variable, a log, a commit or a report. Never
  open or print `.env.local`.
- **Jev (the TypeSafe API) only in Node scripts** (`scripts/contentaudit.mjs`,
  `learnability.mjs`, `brandcheck.mjs`), never in the game, never to write
  jokes, posts, names or dialogue. Use `--dry-run` first. Report requests,
  tokens and dollars for each run; keep a full pass under $1.
- **Content and balance are the owner's.** Don't rename brands, rewrite jokes
  or change numbers that tune the game. If copy is unclear, list it for the
  owner with a suggested rewrite; don't apply it.
- **Graphics presets must not change the simulation** (`scripts/qualitytest.mjs`).
- **Every fix gets a check that fails before and passes after,** or, for a look
  change, a before/after picture pair and a number (luma, pixel count, frame
  time). One fix per commit; the message says what was wrong, why, and the
  numbers. No model names in commits or files.
- **When you're not sure whether something is a bug or the owner's intent,**
  write it up instead of changing it. If an item blocks you for long, record
  what you found and move to the next one.

## How to test (lessons from round 7)

- **Freeze what you test.** The dev server reloads the page whenever you save a
  file, which kills running tests. Serve a frozen copy with
  `node scripts/snapshot.mjs <name> <port>`; for before/after, serve the old
  commit and your new code on two ports.
- **Run scripts from the repo root**, with `BASE_URL` pointing at the snapshot.
  `scripts/refblock.mjs` reads the reference town from
  `shots/lookbook/town.json` relative to the working directory; from anywhere
  else it silently grows a different town.
- **Two browsers at a time** (`scripts/withslot.sh`). Slow tests: `nighttest`
  ~17 min, `yellowflash` ~21 min, `uisweep` ~10 min. A tap or screenshot
  timeout under load is usually load: rerun the test alone before believing it.
- **The phone:** `openBlock(browser, { phone: true })` gives a real touch
  context (3× pixels, touch, mobile UA); iPhone portrait is 390×844.
- **The container can restart** and kill background jobs. Write results to
  files as you go.
- **Pictures:** look at every screenshot you cite. On this software GPU a High
  frame at night takes seconds; give screenshots `timeout: 420000`.

## Known today (c908e7d, this machine)

| item | today |
|---|---|
| `playtestcheck` | "broken save shows the rescue screen" fails, on the base too |
| `feedtest` | crashes from a snapshot: it runs `git log -S FEED_TEMPLATES`, and a snapshot has no `.git` |
| `yellowflash` | "pan street clear moon 0.5" fails inside the full 8-case run (45–52 flash pixels in one frame, limit 40), on old and new code; run alone it passes on both (28–36) |
| `glcheck` | reports 0 GL errors but never exits nonzero |
| Save to a file | does nothing inside the claude.ai artifact viewer (it blocks downloads), which is where the owner plays |
| Field of view | Settings slider now 35–110° (the camera's vertical angle; 110 is ~137° across on 16:9). Draw calls at 110: Low 131 → 207, High 255 → 521 |
| People | the new person model costs 2.1× the old within 64 m in the worst case (`CARS_LOOK_REPORT.md`) |
| Night look | street trees near-black in night close-ups; dark cars still dark at night (`CARS_LOOK_REPORT.md`) |
| High at night | ~3.8 s a frame here in the render pass, old code too; unknown whether it's only this software GPU |
| Sound | Settings has Music on/off and volume only; no way to turn the sound effects or the street sound down |

## The work, in order

**0. Audit (do this first, keep it short).** On the phone (390×844, touch) and
desktop, start a new game on each map and play 20–30 minutes of game time:
build roads, zone, place services, open every panel, inspector and Settings,
try the tools, save and load. Also open the reference block at night, in rain
and at 110° field of view. Write `docs/AUDIT_ROUND8_UI.md`: each finding with a
screenshot path, the steps, and how much a player would notice; mark which are
yours, which are Opus's, and which are the owner's to decide. Then fix yours,
starting with the items below.

1. **Saving where the owner plays.** Find the Save-to-file control and what it
   does (likely an `<a download>` or a blob link). Inside the artifact viewer
   downloads are blocked, so the button silently does nothing. When a download
   can't start, fall back to copying the save to the clipboard and saying so
   ("Save copied: paste it somewhere safe"); add a matching "Load from
   clipboard/paste" if there's a load-from-file. Keep the in-browser save as is.
   Done when: a test hosts the built game in a sandboxed iframe without
   `allow-downloads`, clicks Save to file, and finds the save on the clipboard
   and a message on screen; the normal download still works outside it.
2. **The 110° field of view on the phone.** Check Settings fits and the slider
   is usable at 390 px; the label says what the number is; icons, picking and
   edge-scroll behave at 110°. Pictures at 35, 50, 75 and 110° on phone and
   desktop. Done when `uisweep` (phone) and `touchtest` pass and the pictures
   show nothing broken.
3. **Night look leftovers.** Street trees near-black in close-ups; dark paint
   unreadable at night. Measure first (median luma of the tree crowns and of
   dark cars in a fixed night close-up), then fix by light or material, not by
   brightening everything. Done when the numbers rise, `nighttest`,
   `presetlight` and `yellowflash` still pass, and the before/after pictures
   show the change.
4. **People on the phone.** Measure the person model's cost per preset
   (`scripts/peoplecost.mjs`). On Low (the phone), bring it back to the old
   model's cost or below (LOD distances per preset, fewer bones or draws), with
   pictures showing people still read at the default camera.
5. **The test suite tells the truth.**
   - `playtestcheck`: find out what the game does today with a broken save.
     If the rescue screen is broken, fix the game; if the check's premise is
     stale, update the check and say what changed (`git log` on both).
   - `feedtest`: make it run from a snapshot (skip the history check with a
     clear note when there's no `.git`, or read history from the repo root).
   - `yellowflash`: make each case independent of the ones before it (fresh
     page or a full reset), then report whether the moonlit pan really fails.
   - `glcheck`: exit 1 when a draw call raises a GL error.
   - **A suite runner**, `scripts/suite.mjs`: runs the README test list against
     `BASE_URL` in two slots, with a timeout per test, appending each result
     (name, exit code, seconds) to a summary file as it goes, so a rerun after a
     container restart skips what already finished; prints a table at the end.
     One README line.
   - README: every listed script exists, honours `BASE_URL`, and its usage line
     is right.
6. **High at night.** Find which pass takes the ~3.8 s (renderer info per pass,
   with lights, shadows and post toggled off one at a time). If it's a real
   per-pixel cost a phone or laptop would pay too (too many lights in every
   shader, a shadow cascade, a post pass), fix it with numbers; if it's only
   this software GPU, say so and how you know.
7. **A sound control.** Settings has Music on/off and a music volume, but
   nothing a player can reach turns the *sound* down or off:
   `AudioEngine.setMuted` and `setVolume` (`src/audio/audio.ts`) are only called
   from a dev page. Now that every car near the camera has a voice, add Sound
   on/off and a sound volume to Settings (remembered like the music ones),
   applying to effects, ambience and the street sound. Done when a test
   toggles them and reads the master gain (and the street voices going to
   sleep when muted), and the phone Settings panel still fits.

## Finishing

- Merge the latest base, then run the whole `README.md` test list (your suite
  runner) on a frozen snapshot of your final code. Every test passes, or you
  say which fails, why, and whether it fails on the base too.
- `npm run build:single`; check the bundle has no API key and no `typesafe`.
  **Never publish to the main game link.** Publish your build as a new artifact
  so the owner can try it on their phone.
- Report plainly: your branch; what you fixed, with before/after numbers and
  picture paths; what's for the owner to decide (copy, balance, anything
  ambiguous); what you didn't get to; anything you found in Opus's files.
