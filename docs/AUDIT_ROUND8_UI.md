# Round 8 UI audit

What a player sees and touches, on a phone (390×844, touch, the Low preset: the owner's iPhone) and on a desktop (1280×720, High), played the way a new
player would: new game from the title screen on each of the three counties, a first road, zoning, a service, every panel, an inspector, Settings, the tools,
save and resume; then the same block at night, in rain, and at 35 / 50 / 75 / 110° field of view.

Run on frozen copies of the tree (the base tip `c85b1e6` plus the save, sound and field-of-view changes; the desktop Florida run on the build with the fixes below), with `scripts/audit8.mjs` (a scripted play session: every step is screenshotted and logged with page errors,
controls that spill off the screen and touch targets under 44 px). The pictures are contact sheets under `docs/screenshots/round8/` and `docs/screenshots/round8/audit/`; the full-size
frames are in `shots/r8/audit/<phone|desk>-<county>/NN-name.png` of the session that took them (`shots/` is not committed).

**How much a player would notice** is my judgement: *high* = anyone playing the first ten minutes hits it; *medium* = a player who goes there sees it;
*low* = you have to be looking. **Whose**: *mine* = the UI/graphics session (`src/ui`, `src/style.css`, `src/render`, `src/world`, `src/audio`, models, tests);
*Sim* = the simulation session (`src/sim`, `src/agents/traffic|parking|pedestrians`, `src/roads`, `src/zones`, `src/transit`); *owner* = content, copy, balance or
a design call, which I did not change.

## What was covered, and what was not

| run | what | where the pictures are |
| --- | --- | --- |
| phone, Holler County (Appalachia) | whole tour: title, new city, first road by finger (plan, Build, Done), zoning, services, every toolbar panel and More item, a demand card, an inspector, Settings, night, rain, save, resume | `audit/phone-tour.jpg`, `audit/night-rain-phone.jpg` |
| desktop, Holler County | the same, plus the 35 / 50 / 75 / 110° sequence | `audit/desk-tour.jpg`, `audit/night-rain-desk.jpg`, `fov-desk.jpg` |
| phone and desktop, Golden Coast (Norcal) and Gator Gulch (Florida) | shorter tour (new game, town, the three build panels, Views, 110°, night, rain, save, resume): the panels are the same code on every county | `audit/norcal-florida-phone-desk.jpg`, the last six frames of `audit/night-rain-phone.jpg` |

Not covered: real iPhone Safari (this is headless Chromium on a software GPU, so frame rates and anything about touch *feel* are not measured), sound (nothing to
see), game time beyond ~30 days (the long-game pacing is `playtest6-late`, which the simulation session owns).

## Findings

Numbered in the order a player meets them. Each says what was seen, where (picture), how to see it, how much a player would notice, whose it is, and
what was done. A fix names its check: a test that fails on the base tip and passes now (output kept in `shots/r8/`, quoted in the commit message).

### Mine, fixed

**U1. Phone: the first-steps card lies across the bottom of the inspector sheet.** *High.* Select any building on a phone while the green "Step n/5" card
is up (every new game, for the first several minutes): the card covers the sheet's last rows, "Transit access" and the red **Bulldoze** button, so a tap
meant for the button lands on the card. The sheet is as wide as the screen and sits where the card does; the desktop layout already moved the card out of the way,
the phone layout had `yield` switched off. Picture: `inspector-over-next-before-after.jpg` (left the base tip, right now). *Fixed*: the card steps aside while the
sheet is up (`Hud.layoutCards`). Check: `overlaptest` has a second scenario (no emergency, first-steps card up, building inspected, no drawer): before
`FAIL 390×844 … inspector×next 366×51px`, after `OK … no overlaps` at 390×844 and 1280×800.

**U2. Save city file does nothing in the claude.ai viewer.** *High for the owner (it is where the game is played).* Covered by item 1 of the handoff, see
the report: Save to file in a sandboxed frame without `allow-downloads` clicks an `<a download>` that is dropped without an event or an error, so the player
saw nothing. Now the file is also copied to the clipboard and the screen says "City file copied: paste it somewhere safe", the title screen has **Paste a
copied city**, Settings has **Save city file** (it only existed in the bug sheet), and the rescue screen's "Save the city file" says what happened.
Check: `savefallback`: the built game in a sandboxed iframe without `allow-downloads`: base `FAIL` (clipboard empty, message says "saved"), now 14 of 14 `OK`.

**U3. Phone title: text links and the back arrow under 44 px, and the footer steals taps.** *Low to medium (title screen only).* "Load a city file" and "Paste a
copied city" reached 29 px, the back arrow 43, and the title's footer box (the Playtest note) rises into the row above it on a phone and answered taps meant for
the bottom of "Real Slop merch": that link reached only 18 px of its height. Picture: `audit/phone-tour.jpg`, first frame. *Fixed* (links and the arrow 44 px on touch; the
footer ignores taps: nothing in it is a control). Check: `phonetargets` now measures the title screen too (title, its Paste block and New city): base `FAIL: 5 controls
under 44 px`, now `OK` (161 controls measured, none under 44 px).

**U4. Settings: "Field of view 50°" did not say what 50 is.** *Medium.* The number is the camera's vertical angle; on a phone held upright that is
a 24° wide picture, on a desktop 79°. The label now reads "50° tall · 24° across" and follows the window. Pictures: `fov-*` (item 2 of the report).

**U5. "1 buildings without power" in the emergency toast, "Court in 1 days" in the commune inspector.** *Medium (a first power cut in a small town is the
common case).* *Fixed* in `src/ui/copy.ts`, used by the HUD. Check: `copytest` (no browser): base `FAIL` (the HUD builds the sentence itself), now 12 of 12 `OK`.

**U6. Phone: a tap on a building that lies where the inspector's ✕ appears selects it and closes it again.** *Low to medium (a thin band of the screen, but the tap
"does nothing").* Found by `fovtest`, which missed one building at the right edge of the screen at 110° on the phone, again in the next run: `Game.inspect` selected
the building and 21 ms later the sheet's close button selected nothing. The sheet opens under the finger as the tap lifts, and the browser's emulated click is then
delivered to what is under the finger *now*: the ✕. Any building whose middle is within about 22 px of the ✕'s place (the top right of the sheet) is affected; at
110° and at the default angle alike. *Fixed*: a click on the sheet within 350 ms of its opening is not a press (`Hud`, a capture listener on the inspector).
Check: new `ghosttap` puts a building exactly where the ✕ will be and taps it with a real touch: base `FAIL a tap where the sheet's x will appear selects the building and
the sheet stays {"after":null}`, now `OK`, and the ✕ still closes the sheet when pressed a moment later.

### For the simulation session: files I did not touch

**S1. Need bubbles shrink to a third at 110°.** *Medium on a phone.* `src/sim/serviceIcons.ts` sizes a bubble in the world (`dist * 0.03`), so its size on the
screen is `0.03 · H / (2 · tan(fov / 2))` pixels: on the 390×844 phone 40 px at 35°, 27 at 50°, 16 at 75°, **9 at 110°** (desktop 34, 23, 14, 8; `fovtest` prints
them). At 110° a bubble is hard to see and hard to tap, and `pick()` follows (it uses the camera's own fov, so picking and drawing agree, they are just both small).
Suggested: in `bubbleSize()` and the vertex shader multiply by `tan(fov / 2) / tan(25°)` (25° is the default 50° view), with `fov` passed as a uniform in
`update(camera)` and read from `camera.fov` in `pick()`. `STRICT_ICONS=1 node scripts/fovtest.mjs phone` turns the numbers into a check (bubble within 80-125% of its 50° size).

**S2. Grammar in the demand card:** `src/sim/services.ts:1405` `${miss} buildings missing utilities` reads "1 buildings missing utilities" (seen on the phone,
`audit/phone-tour.jpg`, the demand card); `src/sim/sim.ts:524` `${n} more workers than jobs` reads "1 more workers than jobs". Same fix as U5 (singular at 1). The services panel
already does it right (`plural()` at `services.ts:2074`).

### For the owner to decide (not changed)

**O1. Copy.** (a) Settings help line reads "Interchanges  Roads → Interchanges ·, and . rotate" (`src/ui/hud.ts`, the `help` panel): the keys are lost between the
punctuation. Suggested: "Interchanges: Roads → Interchanges; the , and . keys rotate the layout". (b) Desktop zoning cards cut the first name ("Suburban Slop (Low …");
the services panel's subtitle is cut ("Power, wat…"): the name is the owner's, the card width is `max-width: 230px`, wider cards mean fewer per row. Low.

**O2. A saved game that fails the shape check vanishes from the title without a word.** Since `06ecee0` ("a partial city file is turned away on the title") a
save with, say, `communes = 42` is not offered: with an earlier checkpoint Resume loads that instead, with none there is no Resume button at all and the player is
never told their city is still in the browser (it is: `slopmerica.save.v1.broken` holds a copy). `playtestcheck` assumed the old behaviour and has been brought up to date.
Suggested (a design call): a line on the title, "Your last save could not be read. Keep a copy?" with the save-file button. Needs `saveProblem()` from `src/sim/save.ts`.

**O3. The top bar's controls are below 44 px on the phone** (speed buttons 30×26, the population pill 25×16, the R/C/I/O bars 16×36). Known and accepted since
round 6 (invisible hit areas bring them to 30×43 and 15×40; `phonetargets` lists them at that minimum). Making them 44 means a second top-bar row, which pushes
every card under it down. Your call; I did not.

**O4. The first-steps card offers a "Roads" button while the Roads drawer is already open** ("Let's pave" opens it), and the button then does nothing. Harmless;
left alone because the card's wording is yours.

### Seen once, not reproduced

**R1. Phone Settings drawer painted blank once** (`audit/phone-settings-blank-once.jpg`, taken in the Appalachia audit right after moving the field of view slider to 110°).
The page's own measurements in that same step found every control (the label read "110° tall · 67° across"), the drawer's contents were there a step later, and
`fovtest` (which sets all four angles and photographs Settings at 35 and 110) never saw it again in four runs on the phone. Most likely the software GPU's compositor
caught the backdrop blur mid-frame (frames take 3-10 s here); I cannot rule out a real redraw bug in Safari. Worth a look on the iPhone: slide the field of view
slider all the way right with Settings open and see whether the panel keeps its contents.

## Things that are fine

New game on each county, the first road by finger (plan, Build, Done, Undo, double-tap), zoning, a service by tap then Build, every toolbar and More item, the
demand card (R/C/I/O, the "why" and the buttons), the building inspector, Settings (graphics, music, sound, field of view, save), the bug sheet, save and Resume
all work on both devices with no page errors; the town reads at night and in rain on all three counties. Settings fits at 390 px at every angle from 35° to 110°
and its sliders are 44 px tall. The desktop layout has no overlaps down to 1280×800.

## Tests on disk that the README list does not run

`suite.mjs --lint` lists 50 scripts that are not in the README (so the suite does not run them). Most are capture tools. These are tests with a pass/fail exit that
are not in the list: `blankwalls`, `groundnoise`, `roadjunction`, `roadsection`, `roadwear`, `shoretest`, `silhouette`, `treevariety` (graphics round, mine),
`onewaytest`, `pollutiontest`, `freighttest` (simulation session). I added `presetlight` (the handoff names it). Whether the old graphics tests still pass was not checked;
the owner decides whether they belong in the list.

