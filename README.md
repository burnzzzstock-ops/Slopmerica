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
```

`BASE_URL=http://127.0.0.1:5174` points any of them at another server (handy for running the suite against a frozen copy while you keep editing). Scripts that assert exit nonzero on failure.
