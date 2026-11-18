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
- **A test does not press Esc to tidy up.** With nothing open Esc is the pause menu since 77aa8bc, which stops the game and covers the screen. Close what the test opened by name (`g.ui.openPanel(null)`, `g.tools.set('inspect')`, `g.ui.select(null)`), or use `audit8`'s `tidy()`, which puts the menu away again.
- **A script loaded on demand imports types only.** `pauseMenu.ts` first imported the save code, and the bundler cut 800 kB of the simulation out of the main script into a second file that every player would have loaded anyway. The gate's size line said -30.7%, which is how it was seen. The HUD hands such a script what it needs (`PauseMenuHost`), as it hands `statsPanel.ts` the game.
- **A gate test that times out may be the PC, not the change.** With another session's suite running (look for its browsers and servers: `netstat -ano`, `tasklist`), `road-bank-unit` took over its 30 s and passes alone in 2 s. Run the one test alone before believing it. Each checkout has its own four browser slots (`scripts/lib/slots.mjs`), so two sessions' suites at once are eight browsers on one graphics card: expect timeouts, and rerun alone what fails.
- **Before changing markup or words a test may read, grep `scripts/` for the old text.** The drawn utility row broke `playtest4` (it looked for "🗑️ 12d") and moving the Looks row broke the look lane's `vaulttest`; neither is in the sets this session ran by habit.
- **Run the full suite on the tip before handing a batch over** (`node scripts/suite.mjs --serve 5187 --gpu --fresh --dir shots/suite/full-ui`, about 44 minutes with the look lane's tests in it, in the background). It serves a frozen copy of `src/`, so source can be edited while it runs; the scripts under `scripts/` are read live and must be left alone. Do not run other tests from this checkout while it runs: they share its four browser slots and time out.

## State of the work (17 Nov 2026, late)

Everything in the table below through f7f6887 (and the log commit 81d8f9b) is merged into `claude/aaa-play` and `aaa/integration` and pushed (the simulation session's b4f1332, on origin since ba6fbd9; pushing works again). Earlier and also there: the tool badge, top bar and inspector drawn with the icon set; photo mode's Focus slider and the P key; the step card changing shape the moment a drawer opens; step 5 of 5 ending on day 15; the inspector not redrawing under a held mouse press.

Waiting on `claude/aaa-play-polish` for the simulation session's next merge: the last four rows of this table (77aa8bc to d42c12a) and the four in "After d42c12a" further down. `origin/claude/aaa-play` at 5fc3310 is merged in here (72fe488).

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
| 77aa8bc | Esc with nothing open is a pause menu: Resume, Save, Settings, Quit to title. The game waits while it is up; the game's keys stay out of it; Tab and the arrows stay in. Esc still closes a drawer, a tool or a card first, and lets go of a followed car. `src/ui/pauseMenu.ts`, 2.2 kB, loaded when first asked for | `menutest` (new) no menu before, 27 of 27 |
| ea7b473 | `audit8`'s phone run finds Settings when More is closed (it took a hidden tile for a visible one and stopped at step 24, before the menu too) | 42 of 42 steps, 168 s (it stopped after 446 s) |
| af3832a | The pause menu has Load: it saves, then opens the title screen on its saved cities with the first Load in focus (`TITLE_OPEN` in `src/ui/title.ts`, one sessionStorage flag read once) | `menutest` 15 pass and a stop before, 35 of 35 |
| d42c12a | UI: every control has a name a screen reader can say. The Land map's 64 tiles and the bug report's preview box had none. The Land map is 242 px, so every tile is 30 px to a finger | `labeltest` (new) 130 nameless before, 0 of 2,112; `phonetargets` |

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

### After d42c12a

| Commit | What | Check |
|---|---|---|
| 5b7045f | A feed post says how long ago it was posted (now, 4m, 2h, 3d, real time), and the age is outside the part of the line a long handle cuts short | `feedclock` (new) 2 of 12 before, 12 of 12 |
| 618ff9f | The advisors have faces (the owner's "Yes, use them" of 17 Nov, for these six pictures): Chad on the welcome card and on the desktop's first steps, and the feed's five regulars who are advisors post under their portraits. A phone's step card has no face (it made the card a line taller). The step card is compared with what was last written, not with the page | `facestest` (new) 14 of 22 before, 22 of 22 |
| c6f9cd4 | UI: a merged need bubble left with one building by the open view's filter still says what it is (it said nothing). The hover and `clusterText` in `src/sim/services.ts`, with the simulation session's leave | `needhover` (new) 3 of 4 before, 4 of 4 |
| 0c52b07 | Statistics has a fifth chart, Weekly balance: a bar up for a week's income and a bar down for its costs, from `game.sim.weeks`; a pointer reads the week, with its one-time money | `statstest` 28 of 28 (it had 22 checks) |

### The fifth full suite, on 513a15b (b4f1332 merged in, with the pause menu, Load and the labels)

196 of 204, with another session's suite running on the PC at the same time. The six standing ones (`golden-regression`, `follow-camera`, `reflecttest`, `carsolid`, `landmarktest`, `lightstest`), and two that were the PC: `vaulttest` ("growing the town stayed quick": 7.4 s) and `world-audio` (a timeout at 602 s) both pass alone, in 31 s and 15 s. `follow-camera` passes since the look lane's change to its test came in with ba6fbd9.

### The review of the look lane's work (the owner, 18 Nov: "review astras work too")

`docs/aaa/REVIEW_ASTRA.md`: its 106 commits since the push began, read by area and then checked here, with what was measured marked as such. Three things it found were in this session's own files and are fixed:

| Commit | What | Check |
|---|---|---|
| f85c2e6 | The wheel zooms again while a car's card is open: the HUD travelled with the car by a `setView` every frame, which the camera's new zoom treats as the end of a zoom. It now slides the view by the car's own movement (`rts.nudge`) | `camseams` (new): a notch from 150 m went to 151 m, now 195 m as with nothing selected |
| 2071fdd | Esc leaves photo mode after a slider has been dragged (the slider kept the keyboard, and photo mode's keys are not read while an input has it) | `camseams` 10 of 10 |
| 7f0349e | An emergency card's Show asked for while riding with a car goes to 460 m, not to the 17 m the chase camera was from the car | `camseams` 11 of 12 before, 12 of 12 |

The probes that measured the review's findings are in the session's scratch folder and are not in the repository; the numbers are in the review.

### After the review (18 Nov): what the simulation session delivered, wired

| Commit | What | Check |
|---|---|---|
| 15214a0 | The bulldozer's Undo is on its buttons (the simulation's `game.bulldozeBuilding`, ef4c30c): a card's Bulldoze leaves an Undo and offers it in a toast with a button; one press of the bulldozer, however far it is dragged, is one Undo; the badge has its Undo button with the bulldozer in hand | `razeui` (new) 1 pass and a stop before, 19 of 19 |
| cf288d5 | `feedclock` empties the feed's queue first (the game's start-of-game post came out between its two posts, once, under load) | 12 of 12 |
| (merge) | `origin/claude/aaa-play` at 174e5af is merged in (cf2a151). In it: a trip takes a parked car's body only when it is the same model (the review's A1, closed from the simulation's side); `carsolid` and `lightstest` pass; land value and level-ups are spread over three days of steps, so a county takes a different course from the same seed. Any interface test that grows a town and reads it on a fixed day may have moved: the simulation session's full suite on integration (75892a6) will say | gate |
| 9bad96c | UI: a site picked from the Services drawer's garbage board while riding with a car is shown from 420 m, not from the 10 m the chase camera was from the car (the review's D2, second caller; the panel's own block in `src/sim/services.ts`) | `camseams` 13 of 14 before, 14 of 14 |
| 0e310f5 | A feed post with a place takes the camera there (the simulation's `FeedPost.at`, e874e36): a click or tap on the post, or its Show button; 120 to 420 m up; on a phone the open feed returns to its newest post | `feedgo` (new) 0 pass before, 18 of 18 |

### The sixth full suite, on 0c52b07 (5fc3310 merged in, with everything in the two tables above)

201 of 208 in 36 minutes, nothing else running. None of the seven is from the interface: the simulation session's standing three (`carsolid`, `landmarktest`, `lightstest`) and four in the look lane's work, which are in the review of that lane (`docs/aaa/REVIEW_ASTRA.md`): `golden-regression` (its pinned browser is not in this checkout), `reflecttest` (the first frame with water compiles 8 shader programs), `presetlight` (two camera and hour pairs more than 0.03 luma from the high preset) and `roadsection` (the walk's edge is a sheer skirt again: 8.97 rise per run against 1.2).

### Numbers worth knowing

- The size budget was raised on 17 Nov (the owner: "Yes, raise it"): `scripts/budgets.json` is 2,447,673 bytes and 771,012 gzip with 5% allowed. On 0c52b07 the main script is 2,520 kB and 796 kB gzip, +3.2% of it. Loaded on demand and not counted: `statsPanel` 6.6 kB, `pauseMenu` 2.2 kB. The six portraits are files beside the page (116 kB), inside the page in the one-file build.
- `shiptest`'s false alarm on "sk-" is fixed by the simulation session (9c418f3).
- **Need bubbles, by distance.** The look lane's screen layout drops a single bubble more than 1,900 m from the camera before it merges anything, and lets a merged one through to 4,400 m; the camera goes out to 6,500 m. On the look lane's `needs-town` save (79 buildings with a problem) the shown bubbles stand for 79 of them at 700, 1,200, 1,800, 2,600 and 3,600 m as things are, and for 79, 79, 67, 0 and 0 if the simulation hands them over unmerged at every zoom. So `clusterIcons` in `src/sim/services.ts` (merging beyond 600 m) is what keeps the far overview, and it stays until the layout keeps far singles. Reported to the simulation session for the look lane.
- **How often a radio caption shows.** The engine plays an ad only with Music on and the county an Edge City (2,800 people) or more: every sixteenth bar, about every 40 to 46 s by day, three lines in rotation, so the same line about every two minutes. Each caption is up for 4.0 to 4.6 s. If that is too often on screen, the place to thin it is the one line in the `Hud` constructor that sets `game.audio.onRadioAd`; how often the jingle plays is the look lane's (`src/audio/score.ts`).
- `phonefree` holds Roads at 60.6% and Zoning at 61% of the screen against a 60% floor. A card one line taller trips it.
- A phone's inspector sheet is 403 px of an 844 px screen; a plain home's card is about 400 px and the tallest on presstest's street 482 px (79 px over). The action row is pinned to the sheet's foot, so a taller card scrolls under it.
- `scripts/textfloor.mjs` (a measure, not pass/fail): what is still under 12 px is the one-row top bar and toolbar (8 to 11 px), and on a phone the second line of a road, zone or service card, the road modes and the tool readout (11 px).

## Asked of the simulation session

| What | Why | State |
|---|---|---|
| An export from `src/sim/services.ts` for the look of the service buildings | The "Looks: Asset Vault / Classic" row moves from the Services drawer to Settings | Done by this session with the simulation session's leave (1be543b: the one export and the panel block) |
| A follow target for a bus that lasts across its stops | Follow on a bus | Done by the simulation session (0e682a4: `fields.busOf`, `bus`, `buses`, a `ViewTarget` of kind 'bus'); wired here in eea0ce8. (A moving bus was one of `traffic.cars` all along; what was missing was a target that outlives one leg.) |
| A series of the budget by week: one row per weekly close for about two years, `{ day, income, expense, net, money }` (and the one-time total if cheap) | The budget chart and, later, the liability forecast drawn on it | Done by the simulation session (aaa0e66: `game.sim.weeks`, with `oneTime`); charted in 0c52b07 |
| The look lane's need-bubble request (`REQUESTS_ASTRA.md`: raw problems to `S.icons.set(raw)`, and `clusterText` when `hit.id < 0` as well as when `n > 1`) | Its lines are in `src/sim/services.ts` outside the panel blocks; the simulation session gave leave | The hover half done (c6f9cd4). The raw half not done, on purpose: it loses the far overview (Numbers, above) |
| A place for a feed post: `at?: { x, z }` on what `feed.push` is given, at the sites that have one | Feed posts that take the camera to where the news happened (the brief's U5) | Done by the simulation session (e874e36, 24 push sites); wired in 0e310f5 |
| A way to put back what the bulldozer took | Undo for the bulldozer (U5) | Done by the simulation session (ef4c30c, 240b808: `game.bulldozeBuilding`, and a road laid through homes puts them back when undone); wired in 15214a0 |

## Asked of the look lane (through the simulation session's `REQUESTS_FABLE.md`)

Drawings the icon set does not have, so the control keeps an emoji or words: the three speeds (two and three play signs side by side do not fit the phone's 30 px buttons), Safety and Wellness in the inspector, the two interchange layouts, Save to a slot, New city, the postcard frame and Adjust in photo mode.

## Next

1. The advisors' portraits are on screen (618ff9f). Left for later: Earl on Honest Mode's toggle when Honest Mode exists; Pastor Rick has a portrait and no place.
1. The look lane's requests that landed in this session's files are done: Photo in the toolbar's list, the banner's duck, the radio caption, the brush sound, the hover of a merged bubble.
2. On the weekly series: the liability forecast drawn on the budget (the brief's U2), when the simulation has liabilities to forecast.
2. A milestone's banner and the step card overlap on a phone with a drawer open (seen in `shots/stats/phone.png`: "Population 50" under the Next line). Not looked into.
3. The label of the look lane's `vaulttest` check still reads "Services > Looks"; theirs to reword.
4. Honest Mode's toggle waits on the owner (today's labels are the plain words; the booster's words would have to become the default first, which is a content decision).
5. The pause menu has no way in for a finger or a mouse: Esc only. A phone still has everything it offers in Settings (Save now, slots, New city). A button for it belongs with the top bar's redesign (U4), which waits on the owner's go-ahead.
6. From the brief, in this session's files and not started. U5: bulldozing a grown building asks or can be undone; the toolbar rebuilt on resize and rotate; every refusal names a next step (new words: list them for the owner first); feed posts that fly the camera to their place. U6: the text scale (100 to 200%), zone patterns for colour-blind players, key remapping and the keyboard's focus order through the HUD, reduced motion. U3: long refusals as cards, and a script that times each primary action's response. U4: the top bar and the toolbar as one system with a 12 px floor.
