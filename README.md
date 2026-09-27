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

## Milestones

As in Cities: Skylines, the town earns its tools by growing (src/sim/milestones.ts). A new county has $70,000, low-density zones, three kinds of road and the basic utilities; each milestone unlocks the next batch and pays a state grant toward building it. Unlocks are kept if the city shrinks. Sandbox has everything.

| Milestone | People | Grant | Unlocks |
|---|---:|---:|---|
| Unincorporated Land | 0 | | homes, shops, industry; gravel, two-lane, one-lane one-way; gas peaker, well tower, river pump, sewage outfall, pocket park; roundabout; Water Tower |
| Wide Spot in the Road | 150 | $5,000 | landfill, urgent care; Freedom Stroad, one-way couplet |
| Census-Designated Place | 350 | $10,000 | fire station, sheriff; small roadside attractions; Propane Paradise |
| Speed Trap Town | 650 | $15,000 | big-box commercial; school, coal plant; buses; Fill Er Up Mega Station |
| Boomburb | 1,100 | $20,000 | high-density homes; MEGA Stroad; solar farm; bigger attractions; the Slop Cannon |
| Exurb | 1,800 | $30,000 | offices; treatment plant, incinerator; Megachurch |
| Edge City | 2,800 | $45,000 | the Slopway and diamond interchanges; hospital; the biggest attractions; Pig Cabana Resort |
| Metroplex | 4,200 | $60,000 | Katy Stroad; university; Slop 69 Field |
| Megalopolis | 6,500 | $90,000 | nuclear plant; Neural Fly Datacenter |
| Capital of Slop | 10,000 | $150,000 | bragging rights |

## Civic Foundry asset library

83 original architectural, vegetation, service, and streetscape components, with
three glTF detail levels and 18 shared PBR material sets. The separate interactive
catalog supports filtering, orbit inspection, wireframe, and LOD comparison.

```sh
npm run assets:dev     # http://127.0.0.1:5174/asset-library.html
npm run assets:check   # validate all generated geometry, maps, and references
npm run assets:build   # standalone catalog in dist-assets/
```

See [the integration and authoring guide](docs/ASSET_LIBRARY.md). The game uses
31 of the components (street furniture, bus shelters, street trees, planters,
utility cabinets and service equipment) through `src/civic/layer.ts`: instanced
LOD1/LOD2 meshes with the library's PBR materials, streamed in after the town is
up (Low quality skips them). `node scripts/civic-pack.mjs` rebuilds the pack
(`public/civic/pack.json` + `pack.bin` + the material maps it needs); builds copy
`public/civic` next to the page. The rest of the library stays catalog-only.

## Asset Vault

The Department of Unnecessary Development's 4,000 satirical buildings (PR #7):
100 families, 40 structural plans each, a searchable 3D catalog and a family atlas.

```sh
npx vite --config vite.vault.config.ts   # http://127.0.0.1:5176/asset-vault.html
node scripts/asset-vault/validate.mjs    # all 4,000 models / 12,000 scenes
```

See [the vault guide](docs/ASSET_VAULT.md). In the game (`src/vault/`), all
4,000 are packed by `node scripts/vault-pack.mjs` into `public/vault` (a
748-shape library plus one compact record per part, 2 MiB, 0.4 MiB gzipped)
and built as ordinary buildings: each part goes through the MeshBuilder with the
game's own atlas tiles standing in for the vault's materials, and the family's
sign on the satire sheet, so they batch, light up at night, grow under
scaffolding and get picked like everything else. Zoned lots grow them in extra
variant slots when one fits (shops on commercial lots, homes on residential,
yards on industry, permit offices on office lots; SLOP merch brands keep their
lots), and 16 roadside attractions (World's Largest Fork, Miracle Twine Ball,
Liberty Muffler Man...) are parks in Services. Eleven city services wear the
vault's version of themselves (the Very Clean Coal Plant, the County Water
Tower, the Volunteer Firehouse, Copay Castle for urgent care; stacks still
smoke); Services > Looks switches them back to Classic. Without the pack the
game falls back to its own buildings. The road network dresses itself from the
vault too (`src/vault/scenery.ts`): express-lane gantries across the stroads
and the Slopway, pedestrian overpasses where a stroad cuts through shops,
cell towers disguised as pines, a substation beside every power plant, a
token kiosk beside every bus depot, "broadband promise" fiber huts on local
corners and a Bus Stop to Nowhere at the end of every dead end. 96 of the 100
families are in the game. The buildings dev page has a
Vault view (`dev/buildings.html#view=vault`).

## Content checks (TypeSafe Jev)

Some content judgments are made at dev time by TypeSafe's Jev model, which answers typed questions (yes/no, choice, score) with probabilities; code makes every decision. Scripts call it through `scripts/typesafe.mjs` (no dependencies; the key comes from `TYPESAFE_API_KEY` or the gitignored `.env.local` and is never printed). The game never calls Jev: scripts ship plain data, and the game behaves as before without it. Every Jev script prints its requests, tokens and cost, caches raw answers so a threshold change costs nothing, and has a `--dry-run` that needs no key.

Before merging a content branch (Cast & Feed, City Look), run `node scripts/ipcheck.mjs`: real slogans and exact real brand colors the parody chains riff on, checked in code (a language model's memory of slogans is patchy). A finding the owner keeps goes in its `ACCEPTED` table with the reason.

**Feed tags.** `node scripts/feedtags.mjs` asks Jev about every X-feed line once (which region it assumes, how built-up a town, which weather, whether it reacts to its event, who would post it, and whether it only talks about that poster) and writes `src/content/feedTags.ts`. `postFor` then prefers lines and authors that fit the city: Florida Man only posts in Gator Gulch, the stars line only on a clear night, "day one" only in an empty valley, and "one more lane" mostly comes from Big Dale or the lane lobby. Delete the file and the feed picks as before. The review list (misfiled lines, reversed outcomes, dropped authors) is in `docs/FEED_TAGS.md`. Behind an HTTPS proxy, run the Jev scripts with `NODE_USE_ENV_PROXY=1`.

**Names that fit the map.** `node scripts/nametags.mjs` asks Jev whether each generated name is tied to one part of the country and where, and writes `src/roads/nameTags.ts`: street names and commune names tied to another region are left out of that map (no Sequoia streets in the Florida swamp, no Bayou in the hollers, "Holler Rd" only in Appalachia, Texas bluebonnets nowhere). Delete the file and every name goes on every map. House and Asset Vault names tied to a region are listed for review in `docs/NAME_TAGS.md`.

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
node scripts/progresstest.mjs    # milestones: a new county can't build every service; batches unlock at real populations with grants; the card says what and where; NEW badges; locked cards; nature & sprawl meters
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
node scripts/firststeps.mjs      # first-steps Next bar and its button; demand wording; weekly balance on road previews; H goes home; toolbar; notices; feed peek
node scripts/playtest5.mjs       # transit lines survive a street joining their road; bulldoze names the line; transit list refreshes; per-ride costs; green "Built" after placing; valid-site rings; save on page hide
node scripts/housetown.mjs       # a dense town of every house style: variety, model cost, building batch budget (SHOTS=prefix)
node scripts/motiontest.mjs      # cars: no heading snaps, brake for turns, change lanes, blink, never wrong-way on a one-way; walkers' stride, no teleports
node scripts/civictest.mjs       # Civic Foundry pack streams in: street trees, furniture, bus shelters; instanced LODs; Low skips it
node scripts/starttest.mjs       # new county: sensible site (random among good ones, saved), county road follows the land; trees: no detail disc, no gaps
node scripts/gridtest.mjs        # Roads > Grid: three clicks lay a street grid (junctions, lots, price, red streets left out, one-ways alternate, one undo, touch)
node scripts/progression.mjs     # (not a pass/fail test) a scripted player grows a Ponzi town: when each population mark is reached, money, what got built
node scripts/weathertest.mjs     # weather keeps to the calendar: no rain or snow spell over a month, no summer snow, changes often, doesn't strobe at top speed
node scripts/costtest.mjs        # honest service costs (running cost, committed projects, units), Next priorities, locked-fix notes, full landfill note, red bulldoze outlines
node scripts/ipcheck.mjs         # (content gate, no key) real slogans used word for word and real brands' exact colors on the parody chains; riffs listed for review
node scripts/feedtags.mjs        # (Jev, $0.04 a full pass; --dry-run needs no key) tag every feed line: region, town size, weather, fits its event, likely authors
node scripts/feedtest.mjs        # the feed picks lines that fit the map, town size and weather, never empties a pool, and posts exactly as before without the tags
node scripts/nametags.mjs        # (Jev, $0.01 a full pass; --dry-run needs no key) street, suffix and commune names tagged by the region they belong to
node scripts/nametest.mjs        # no street names from another region on any map (4,000 generated per map, and roads built in game), every list still has names
node scripts/linktest.mjs        # landmarks/services off the road network: tip, toast, red no-road bubble, inspector, alerts, no land value; feed pacing
node scripts/vaulttest.mjs       # Asset Vault: pack streams in; zoned lots grow vault buildings that fit; merch lots kept; attractions; services' vault looks + toggle; road furniture; no pack = no change
node scripts/crisisfixtest.mjs   # info views show every building with that view's problem; utility outages merge only for the same buildings; a closed warning returns when worse
node scripts/roadgrade.mjs       # a road across a dip stands on an embankment, not a floating slab
node scripts/audiotest.mjs       # ambience loops have no seam thump and no steady beat (no "train chugging")
node scripts/econtest.mjs [map] [days]  # a town grown like a player grows one: weekly bill vs population (CHECK=1 gates it, OUT=file dumps rows)
node scripts/bldshots.mjs tag    # neighbourhood-zoom shots of homes, shops, apartments, offices, factories, day and night (CLOSE=1 adds close-ups)
```

`BASE_URL=http://127.0.0.1:5174` points any of them at another server (handy for running the suite against a frozen copy while you keep editing). Scripts that assert exit nonzero on failure.
