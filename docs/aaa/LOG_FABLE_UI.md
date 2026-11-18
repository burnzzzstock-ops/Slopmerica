# FABLE log, interface session: the AAA push

The play lane has two sessions since 17 Nov 2026 (the owner's decision; the split is in `AGENTS.md` / `CLAUDE.md` under Lanes). This is the interface session's log. A fresh session can take over from this file and `docs/aaa/LOG_FABLE.md` (the simulation session's, which also covers the harness and the branches).

## Where things are

- **Worktree:** `C:/Users/burnz/Slopmerica/.claude/worktrees/play-ui` (it has its own `node_modules`; `core.autocrlf false`).
- **Branch:** `claude/aaa-play-polish`, local only. It is cut from `claude/aaa-play` and the simulation session merges it there at each integration. This session never pushes it, never merges `aaa/integration` and never edits the simulation session's files.
- **Ports:** 5185 to 5188. `--serve 5187` for a suite run, 5188 for a copy of the parent commit to measure "before" on, 5186 for a look.
- **Mine:** `src/ui/*`, `src/tools/*`, `src/style.css`, `index.html`, the interface's tests, and inside a simulation file only the blocks that draw a panel or an inspector row (`registerPanel`, `registerInspector`, `registerView`). A commit that touches only those is titled `UI:`.
- **Before a commit:** `npm run gate`. **Before handing the branch over:** the smoke tier (`node scripts/suite.mjs --tier smoke --serve 5187 --fresh --gpu`) and every interface test the change could touch, on the tip.
- **Every fix has a check that fails on its parent.** To run a test against the parent: `git archive <commit> -- src scripts public index.html package.json tsconfig.json vite.config.ts` into a scratch folder, link `node_modules` there with `mklink /J`, serve it with `scripts/snapshot.mjs` on 5188, and run the test with `BASE_URL`. Remove the link with `rmdir` (not `rm -rf`) before deleting the folder.
- **Long text for a commit or an edit goes through a file, not a shell heredoc.** Git Bash on this PC trips on apostrophes in a heredoc and halves doubled backslashes.
- **A new test's registry entry goes at the end of `scripts/tests/fable.json`,** one per commit.
- **Before changing markup or words a test may read, grep `scripts/` for the old text.** The drawn utility row broke `playtest4` (it looked for "🗑️ 12d") and moving the Looks row broke the look lane's `vaulttest`; neither is in the sets this session ran by habit.
- **Run the full suite on the tip before handing a batch over** (`node scripts/suite.mjs --serve 5187 --gpu --fresh --dir shots/suite/full-ui`, about 44 minutes with the look lane's tests in it, in the background). It serves a frozen copy of `src/`, so source can be edited while it runs; the scripts under `scripts/` are read live and must be left alone. Do not run other tests from this checkout while it runs: they share its four browser slots and time out.

## State of the work (17 Nov 2026)

Merged into `claude/aaa-play` (699ec0e, pushed): the tool badge, top bar and inspector drawn with the icon set; photo mode's Focus slider and the P key; the step card changing shape the moment a drawer opens; step 5 of 5 ending on day 15; and, cherry-picked earlier, the inspector not redrawing under a held mouse press.

Merged into the local `claude/aaa-play` (436a5a3; nothing has been pushed from this PC since the GitHub sign-in lapsed on the evening of 17 Nov), all but the last two rows, which wait on `claude/aaa-play-polish`:

| Commit | What | Check |
|---|---|---|
| 446cf12 | The buttons on the cards are drawn (Next, demand, emergency, in the red, Settings, policies, the medal). `actLabel()` in `src/ui/icons.ts` picks the drawing by what a button does | `hudicons` 53 of 69 before, 69 of 69 |
| 6f94512 | A toast stays up as long as it takes to read: 3 s at least, 1 s and 300 ms a word, 10 s at most (`toastMs` in `src/ui/copy.ts`) | `toasttest` (new), `copytest` |
| 6e65a63 | Phone: a planned road's readout takes the badge's width, the buttons under it. Badge 224 px to 106 px, map share 55.1% to 68.7% | `phonefree` |
| c8581ed | Sentences and figures in the cards are 12 px at least; `scripts/textfloor.mjs` counts what is not | under 12 px: phone 101 runs to 51, desktop 122 to 38 |
| bf97074 | Phone: the inspector's buttons stay at the sheet's foot when a card is taller than the sheet | `presstest` phone 8 of 10 before, 10 of 10 |
| 9046a0f | Every control answers a press (brighter, the plain buttons a little smaller) and a mouse over it | `presslook` (new) 6 of 28 before, 28 of 28 |
| 1be543b | UI: the look of the service buildings is chosen in Settings, not in the Services drawer (one export, `serviceLooks`, in `src/sim/services.ts`). Phone: the drawer 304 px to 284 px, the map's share 48.6% to 50.8% | `servicelooks` (new) |
| 081f5e0 | The look lane's `vaulttest` presses the look switch in Settings (one line, a commit of its own) | 19 of 20 before, 20 of 20 |
| 766b79a | Phone: the inspector's buttons are 44 px (they were 38), and `presstest` looks at every home's card | `presstest` 11 of 11 |
| 9355ad3 | `presstest` reads the button's place in one call inside the page (a locator could find the button and lose it to a redraw before asking for its box: two crashes in about fifteen runs) | ten runs, 11 of 11 each |
| eeef0e5 | A bus's card is headed by its line, with Driver and Next stop rows | `followtest` 22 of 26 before, 26 of 26 |
| dd67996 | Statistics: four charts (population, treasury, nature and sprawl, moved in and left) in a drawer under More, in `src/ui/statsPanel.ts`, loaded when first opened (a 5.1 kB script of its own, the first thing in the game loaded on demand) | `statstest` (new) 22 of 22 |
| eea0ce8 | Follow on a bus rides the bus across its stops (the simulation's `fields.busOf` and a target of kind 'bus'); the pill says where on the line it is; the pill is as wide as its words on a phone | `busridetest` (new) 21 of 21 |
| eb61c0d | A car's speed is in miles an hour (the third lane's phone audit). Every length on screen is still metric | `followtest` 26 of 28 before, 28 of 28 |
| 2eacc53 | Phone: a card that opens puts the tool in hand and its drawer away (the audit's lingering Done badge). The desktop keeps the tool | `sheettool` (new) 8 of 12 before, 12 of 12 |
| 0d4bd35 | Photo mode's bar is up however photo mode began (it looks at `game.photo.active` itself) | `phototest` 28 of 32 before, 32 of 32 |
| 89e18bf | Photo is in the toolbar's own list, now that it has a drawn icon. Nothing on screen moves: the More grid's order is as it was, on a phone and on a desktop | the look lane's `hud-icon-art`, `phototest`, `statstest` |
| 284e16a | A banner asks the audio engine to duck the music and the street, once, when it is put on screen (not when it is shown as a toast) | `soundhooks` (new) 2 of 4 before, 4 of 4 |
| 055b18a | The radio's ads have their words on screen: a toast with a radio in front of the ad's own words when the engine says the jingle has started (`AudioEngine.onRadioAd`). It makes no sound, and stays out of a bug report's recent actions | `soundhooks` 10 of 18 before, 18 of 18 |
| f7f6887 | The zoning brush tells the engine each time it changes lots during a stroke, so it is heard for as long as it paints; the stroke's one `zonePainted` at the end is untouched | `soundhooks` 19 of 22 before, 22 of 22 |

Two of these put right something an earlier commit of this session broke, and the same care applies to what comes next:

- The drawn icons made the tool badge's buttons wider, and on a phone the readout beside them went from 116 px tall to 214 px. `phonefree` only checked that it was taller than its two-line form. It now has a ceiling (6e65a63).
- The 12 px labels made a home's card 12 to 17 px taller, and on a phone a card already at the sheet's limit put Bulldoze under the fold. `presstest` caught it one commit late, because it was not in the set run for c8581ed. **Run `presstest`, `phonefree`, `overlaptest`, `phonetargets` and `hudfootprint` for any change of size or spacing.**

### The full suite on a318b42 plus the Looks commits (17 Nov, real GPU, seed 1)

127 of 134. None of the seven is from the interface: `photo-reflection`, `presetlight` and `carsolid` fail on the base; `treelod` failed under the suite's load and passes alone; `presstest` failed only on its new 44 px check, which 766b79a satisfies; `landmarktest` ("in their seats by kickoff", 16 of 29) and `lightstest` (the leading green at node 67, and a walker 15.8 s at a kerb) fail the same way on the simulation session's own tip c6b0165 with its own scripts, and were reported to it.

### The full suite again, on afc0dc2 (436a5a3 merged in, with Statistics)

129 of 135. `photo-reflection`, `presetlight`, `carsolid`, `landmarktest` and `lightstest` as before (the simulation session bisected the last two: not the walkers; `landmarktest` failed on 5 of 6 seeds before them, and `lightstest` counts too few cars to tell 17% from 20%). `nightglow` is new and fails the same way on the simulation session's own tip 0e682a4 ("the street at 110.1 vs 149.5 at noon"). After merging 0e682a4 the look lane's `follow-camera` fails too ("Target disappeared early"), also on that tip alone: `poseOf` now answers null for a car in the step before it has a place on the road, and the test asks straight after launching one. Both reported.

### The third full suite, on a42bd66 (0e682a4 merged in, with the bus ride)

131 of 137: `photo-reflection`, `follow-camera`, `nightglow`, `carsolid`, `landmarktest`, `lightstest`, all as reported above. After merging 4e4a22c (integration: the look lane's 78 commits and the third lane's portraits) the interface's own twenty tests pass but for `shiptest` (below).

### The fourth full suite, on 2dc0b12 (6600d25 merged in, with the three sound hooks)

195 of 202 (the look lane's tests are in the suite since integration; it takes 44 minutes now, not 19). None of the seven is from the interface. `follow-camera`, `carsolid`, `landmarktest` and `lightstest` as before. `golden-regression` stops at once: it wants its own pinned browser, which this worktree has not installed (`node scripts/look/golden.mjs --install-browser`). `reflecttest` ("the first mirror frame compiles nothing of its own": 8 new programs) and `disasterloop` ("every road it closed is open again": 1 still closed, after the wildfire) are new here, and both fail the same way run alone against a copy of the simulation session's own tip 6600d25 with its own scripts. Reported.

### Numbers worth knowing

- The size budget was raised on 17 Nov (the owner: "Yes, raise it"): `scripts/budgets.json` is 2,447,673 bytes and 771,012 gzip with 5% allowed. With the look lane's local tip merged, this branch's build is 2,494 kB and 788 kB gzip, +2.2% of it. Something rarely opened still belongs in a script loaded on demand, as `statsPanel.ts` is.
- **`shiptest` fails on this branch's tip, on a false alarm.** Its scan for an API key finds "sk-" in the built script: `Math.ceil(sk-u)`, where the minifier has named a variable `sk`. Which names it hands out depends on everything in the bundle, so it shows with this branch merged and not without. The scan is the simulation session's; reported, with a tighter pattern suggested (a key is "sk-" and then sixteen or more letters, digits, dashes).
- **How often a radio caption shows.** The engine plays an ad only with Music on and the county an Edge City (2,800 people) or more: every sixteenth bar, about every 40 to 46 s by day, three lines in rotation, so the same line about every two minutes. Each caption is up for 4.0 to 4.6 s. If that is too often on screen, the place to thin it is the one line in the `Hud` constructor that sets `game.audio.onRadioAd`; how often the jingle plays is the look lane's (`src/audio/score.ts`).
- `phonefree` holds Roads at 60.6% and Zoning at 61% of the screen against a 60% floor. A card one line taller trips it.
- A phone's inspector sheet is 403 px of an 844 px screen; a plain home's card is about 400 px and the tallest on presstest's street 482 px (79 px over). The action row is pinned to the sheet's foot, so a taller card scrolls under it.
- `scripts/textfloor.mjs` (a measure, not pass/fail): what is still under 12 px is the one-row top bar and toolbar (8 to 11 px), and on a phone the second line of a road, zone or service card, the road modes and the tool readout (11 px).

## Asked of the simulation session

| What | Why | State |
|---|---|---|
| An export from `src/sim/services.ts` for the look of the service buildings | The "Looks: Asset Vault / Classic" row moves from the Services drawer to Settings | Done by this session with the simulation session's leave (1be543b: the one export and the panel block) |
| A follow target for a bus that lasts across its stops | Follow on a bus | Done by the simulation session (0e682a4: `fields.busOf`, `bus`, `buses`, a `ViewTarget` of kind 'bus'); wired here in eea0ce8. (A moving bus was one of `traffic.cars` all along; what was missing was a target that outlives one leg.) |
| A series of the budget by week: one row per weekly close for about two years, `{ day, income, expense, net, money }` (and the one-time total if cheap) | The budget chart and, later, the liability forecast drawn on it | Asked 17 Nov |
| The look lane's need-bubble request (`REQUESTS_ASTRA.md`: raw problems to `S.icons.set(raw)`, and `clusterText` when `hit.id < 0` as well as when `n > 1`) | It was passed to this session with the audio hooks, but the three lines are in `src/sim/services.ts` outside the blocks that draw a panel or an inspector row (the icon update near line 1700, `clusterText` near 1741, the hover text near 2398), so they are the simulation session's | Passed back 18 Nov |

## Asked of the look lane (through the simulation session's `REQUESTS_FABLE.md`)

Drawings the icon set does not have, so the control keeps an emoji or words: the three speeds (two and three play signs side by side do not fit the phone's 30 px buttons), Safety and Wellness in the inspector, the two interchange layouts, Save to a slot, New city, the postcard frame and Adjust in photo mode.

## Next

1. **The third lane's advisor portraits wait on the owner.** The six pictures are in the tree (`src/art/advisors/*.webp`, 17 to 23 kB each, with `advisorPortraitHTML(id, size)` in `src/art/advisors.ts`) but nothing imports them, so they are not in the build. They are generated art, and `DECISIONS_FABLE.md` keeps generated art out of the build until the owner says yes. Asked 18 Nov. On a yes: chad on the welcome card and the step card, the feed's advisor handles, earl for Honest Mode when it exists; check the phone's map share (`phonefree`) with a portrait on the step card.
1. The look lane's requests that landed in this session's files are done: Photo in the toolbar's list, the banner's duck, the radio caption, the brush sound (the table above). The need-bubble one is the simulation session's (above).
2. The budget chart, when the weekly series exists.
3. The label of the look lane's `vaulttest` check still reads "Services > Looks"; theirs to reword.
3. The statistics and budget charts (the brief's U2), from what the simulation gives: loaded on demand, like nothing else in the main bundle should be until the budget is re-baselined.
4. Honest Mode's toggle waits on the owner (today's labels are the plain words; the booster's words would have to become the default first, which is a content decision).
5. From the brief, in this session's files and not started: the layout of the top bar and the toolbar as one system with a 12 px floor (U4), long refusals as cards (U3), a pause menu (U5), text scale and keyboard focus order (U6).
