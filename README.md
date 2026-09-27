# SLOPMERICA
*Land of the Free Parking.*

A satirical 3D city builder where the goal is everything urban planners warn you about. You start with a pristine Appalachian-meets-Texas river valley and end with 8-lane stroads, 120-pump gas stations, cul-de-sacs over the wetlands, and a five-level interchange where two gravel roads used to cross.

**Status:** playtest. The game runs in the browser (desktop and phone) and builds to a single offline HTML file. Design notes: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Run it

```sh
npm install
npm run dev            # http://127.0.0.1:5173
npm run build:single   # dist-single/index.html, one file, works offline
```

`#skip&map=florida&mode=sandbox` on the URL skips the title screen (maps: `appalachia`, `norcal`, `florida`; modes: `ponzi`, `sandbox`, `hippie`, `speedrun`).

## Playtesting

- The title screen and Settings show the build (`commit · date`); every bug report carries it.
- Testers report from **🐞 Report bug** (toolbar on desktop, first item under More on phones, and in Settings). The report is plain text: what happened, the build, device, GPU, frame rate, city stats, where the camera was, the last actions and any errors caught. Nothing is sent automatically; testers copy, share or save it and send it to you.
- An uncaught error pops a "Something broke" toast with a prefilled report. A lost WebGL context saves the city and offers a reload.
- If the game can't start (no WebGL, or a save that breaks loading) the tester gets a rescue screen instead of a frozen loader: report it, try again, or start a new city. Starting over keeps the old save in `localStorage['slopmerica.save.v1.broken']`.

**Reproducing a tester's city file** (`slopmerica-<city>-day<N>.json` from the report sheet): on the title screen, **Load a city file** and pick it. The file is checked first, and the city already saved in that browser is only replaced once the loaded one is running.

## Tests

Headless checks live in `scripts/` and drive the dev server with Playwright + SwiftShader, e.g.:

```sh
node scripts/playtestcheck.mjs   # bug reporter, crash toast, context loss, rescue screen (phone)
node scripts/touchtest.mjs       # phone road drawing: plan, Build, Done, double-tap
node scripts/inputtest.mjs       # desktop road + zoning input
node scripts/svctouch.mjs        # phone placement previews (services, landmarks)
node scripts/widentest.mjs       # One More Lane keeps the street's buildings
node scripts/soak.mjs norcal 360 # a simulated year: errors, NaN, save/continue, leaks
node scripts/uisweep.mjs phone   # every panel opens cleanly (also: desk)
node scripts/demandtest.mjs      # demand cards: reasons add up, actions, Esc/tap to close
node scripts/commandtest.mjs     # road upgrade/bulldoze: same rules from toolbar and inspector
node scripts/savecontinuity.mjs  # a reload resumes the same future (rng, ledger, trees, imports)
node scripts/qualitytest.mjs     # graphics presets never change the simulation
node scripts/nantest.mjs         # one NaN/Inf pixel can't black out the screen; black-frame fallback
node scripts/ledgertest.mjs      # the weekly rate is recurring only; weeks reconcile; budget, previews, in-the-red card
node scripts/tooltest.mjs        # one active tool: tab switches, Esc, right-click, Cancel, double-clicks, undo
node scripts/roadrules.mjs       # a blocked road says the rule and the way out (communes)
node scripts/zonetest.mjs        # zoning strokes report what they did; lots say why they wait
node scripts/svcstatus.mjs       # services: covered / paid fallback / short, costs, why cut off
node scripts/progresstest.mjs    # unlocks say where; NEW badges; locked cards; nature & sprawl meters
node scripts/edgetest.mjs        # mouse at a screen edge scrolls the map
node scripts/scaletest.mjs       # people, cars and boats in proportion to the town; one person out of a door at a time
node scripts/hudfootprint.mjs    # how much of the height the HUD leaves for the map (W= H= for the window size)
node scripts/shadercheck.mjs     # no sin-based hashes in shaders (they break on some Windows GPUs)
node scripts/aotest.mjs          # ambient occlusion leaves open ground alone (no blotches, no stripes)
node scripts/junctiontest.mjs    # roads over a dead end join it; no near-parallel junctions; crosswalks
node scripts/interchangetest.mjs # roundabout and diamond interchange (overpass, ramps, save, undo)
node scripts/townshots.mjs tag   # builds a ~250-person river town and screenshots day, night, a junction, a factory
node scripts/treelod.mjs         # distant trees match near ones in brightness, colour and cover (MAP=, VIEWS=)
node scripts/roadthrough.mjs     # a road through homes bulldozes them (and says so first); services refuse it
node scripts/tiptest.mjs         # placement tooltips stay inside the window at every edge
node scripts/needtest.mjs        # hovering a building's need icon says what it needs
node scripts/nightglow.mjs       # at night lights stay lights: no multiplied emissives or glowing dust
node scripts/aacompare.mjs       # MSAA vs TAA, still and panning (error, edge energy, shimmer)
node scripts/restest.mjs         # automatic resolution drops only when it helps, and recovers
node scripts/rescheck.mjs        # render resolution vs the screen, per preset
node scripts/musictest.mjs       # ambient piano renders offline: plays, never clips, stays in key
node scripts/placetest.mjs       # services, depots and landmarks front the street on level pads; ghost = final
node scripts/playtest3.mjs       # county road is the state's; road previews; undo replants; demand next step; goals
node scripts/playtest4.mjs       # landfill 75/90/full warnings; emergency card + slowdown, Fix / Worst area, Recovering; why trash piles up; departures by cause; earned unlocks stay; "Built", not "already here"; blocker outline; road budget preview; merged icons
node scripts/bldshots.mjs tag    # neighbourhood-zoom shots of homes, shops, apartments, offices, factories, day and night (CLOSE=1 adds close-ups)
```

`BASE_URL=http://127.0.0.1:5174` points any of them at another server (handy for running the suite against a frozen copy while you keep editing). Scripts that assert exit nonzero on failure.
