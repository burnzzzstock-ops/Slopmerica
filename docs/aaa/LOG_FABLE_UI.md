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

## State of the work (17 Nov 2026)

Merged into `claude/aaa-play` and pushed (699ec0e): the tool badge, top bar and inspector drawn with the icon set; photo mode's Focus slider and the P key; the step card changing shape the moment a drawer opens; step 5 of 5 ending on day 15; and, cherry-picked earlier, the inspector not redrawing under a held mouse press.

On `claude/aaa-play-polish`, waiting to be merged:

| Commit | What | Check |
|---|---|---|
| 446cf12 | The buttons on the cards are drawn (Next, demand, emergency, in the red, Settings, policies, the medal). `actLabel()` in `src/ui/icons.ts` picks the drawing by what a button does | `hudicons` 53 of 69 before, 69 of 69 |
| 6f94512 | A toast stays up as long as it takes to read: 3 s at least, 1 s and 300 ms a word, 10 s at most (`toastMs` in `src/ui/copy.ts`) | `toasttest` (new), `copytest` |
| 6e65a63 | Phone: a planned road's readout takes the badge's width, the buttons under it. Badge 224 px to 106 px, map share 55.1% to 68.7% | `phonefree` |
| c8581ed | Sentences and figures in the cards are 12 px at least; `scripts/textfloor.mjs` counts what is not | under 12 px: phone 101 runs to 51, desktop 122 to 38 |
| bf97074 | Phone: the inspector's buttons stay at the sheet's foot when a card is taller than the sheet | `presstest` phone 8 of 10 before, 10 of 10 |
| 9046a0f | Every control answers a press (brighter, the plain buttons a little smaller) and a mouse over it | `presslook` (new) 6 of 28 before, 28 of 28 |

Two of these put right something an earlier commit of this session broke, and the same care applies to what comes next:

- The drawn icons made the tool badge's buttons wider, and on a phone the readout beside them went from 116 px tall to 214 px. `phonefree` only checked that it was taller than its two-line form. It now has a ceiling (6e65a63).
- The 12 px labels made a home's card 12 to 17 px taller, and on a phone a card already at the sheet's limit put Bulldoze under the fold. `presstest` caught it one commit late, because it was not in the set run for c8581ed. **Run `presstest`, `phonefree`, `overlaptest`, `phonetargets` and `hudfootprint` for any change of size or spacing.**

### Numbers worth knowing

- The build is at +4.7% of its gzip budget with 5% allowed (`scripts/budgets.json`; the owner has the re-baseline question in `DECISIONS_FABLE.md`). Anything sizeable is loaded on demand or waits.
- `phonefree` holds Roads at 60.6% and Zoning at 61% of the screen against a 60% floor. A card one line taller trips it.
- A phone's inspector sheet is 403 px of an 844 px screen; a plain home's card is 398 px.
- `scripts/textfloor.mjs` (a measure, not pass/fail): what is still under 12 px is the one-row top bar and toolbar (8 to 11 px), and on a phone the second line of a road, zone or service card, the road modes and the tool readout (11 px).

## Asked of the simulation session

| What | Why | State |
|---|---|---|
| An export from `src/sim/services.ts` for the look of the service buildings: read it (`'vault'`, `'classic'`, or null when the vault's pack has not loaded) and set it (store the choice, restyle the standing buildings). Today `LOOK_KEY`, `svcLook()` and `VAULT_LOOK` are private to the file and the panel block sets them inline | The "Looks: Asset Vault / Classic" row moves from the Services drawer, the tallest thing on a phone, to Settings | Asked 17 Nov |
| A way to pick a bus on the map and a `ViewTarget` for it (`{ kind: 'bus', id }` with `fields.poseOf`). A bus in service is a run in `src/transit/system.ts` drawn by the transit renderer; it is not one of `traffic.cars`, so a tap on it selects nothing and there is no card to put Follow on | Follow on a bus | Asked 17 Nov |

## Asked of the look lane (through the simulation session's `REQUESTS_FABLE.md`)

Drawings the icon set does not have, so the control keeps an emoji or words: the three speeds (two and three play signs side by side do not fit the phone's 30 px buttons), Safety and Wellness in the inspector, the two interchange layouts, Save to a slot, New city, the postcard frame and Adjust in photo mode.

## Next

1. The Looks row to Settings, when the export above exists.
2. Follow on a bus, when a bus can be picked.
3. The statistics and budget charts (the brief's U2), from what the simulation gives: loaded on demand, like nothing else in the main bundle should be until the budget is re-baselined.
4. Honest Mode's toggle waits on the owner (today's labels are the plain words; the booster's words would have to become the default first, which is a content decision).
5. From the brief, in this session's files and not started: the layout of the top bar and the toolbar as one system with a 12 px floor (U4), long refusals as cards (U3), a pause menu (U5), text scale and keyboard focus order (U6).
