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
| Boomburb | 1,100 | $20,000 | high-density homes, offices; MEGA Stroad; solar farm; bigger attractions; the Slop Cannon |
| Exurb | 1,800 | $30,000 | treatment plant, incinerator; Megachurch |
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

Before merging a content branch (Cast & Feed, City Look), run both content gates:

**Content audit.** `node scripts/contentaudit.mjs` asks [TypeSafe](https://docs.typesafe.ai)'s Jev model typed questions about every player-facing line in `src/` (feed posts, billboards, brands, signs, names, UI copy), drawn from the content rules in [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md). It also checks each parody brand for a near-copy name, a reused real slogan or a look-alike sign. The report goes to [docs/CONTENT_AUDIT.md](docs/CONTENT_AUDIT.md). Pieces of one billboard, brand, character card or sign are judged together, because a line cut loose from its card reads very differently. Answers are kept in `docs/content-audit.json`, so a rerun only asks about new or changed lines; a full pass is about 2,000 requests, takes a minute and costs around $0.15. It exits 1 when a line crosses a hard rule and 2 when lines couldn't be judged. The thresholds are `COPY_RULES` and `BRAND_RULES` in the script.

It needs a TypeSafe API key: put `TYPESAFE_API_KEY=...` in `.env.local` (or set it in the environment). That file is gitignored, and Vite only passes `VITE_*` variables to the game, so the key never ships. `--inventory` lists what would be checked and `--dry-run` prints the requests; neither needs a key.

**IP check.** `node scripts/ipcheck.mjs`: real slogans and exact real brand colors the parody chains riff on, checked in code with no key (a language model's memory of slogans is patchy, so the audit's IP questions don't carry this alone). A finding the owner keeps goes in its `ACCEPTED` table with the reason.

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
node scripts/glcheck.mjs          # no draw call raises a GL error (BASE_URL=; GL_JS= runs a snippet in the page first); exits 1 on any, or on a page error
node scripts/savefallback.mjs     # saving where downloads are blocked: the built game in a sandboxed iframe (no allow-downloads) copies the city file to the clipboard and says so; outside a frame the file still downloads; "Paste a copied city" loads it back (DIST= another build, BUILD=0 skips the build)
node scripts/soundtest.mjs        # Settings > Sound on/off and volume (effects, ambience, street sound; the music keeps its own): the audio graph's gains, the street voices asleep when off, remembered after a reload, the phone panel still fits
node scripts/fovtest.mjs phone     # the field of view slider at 35, 50, 75 and 110: the label says what the number is, Settings fits at 390 px, tapping a building selects it, edge scrolling (desk), draw calls per angle; pictures in shots/r8/fov
node scripts/audit8.mjs phone appalachia   # a scripted play session for a UI audit (also: desk, norcal, florida): new game from the title, a road by finger, zoning, a service, every panel, an inspector, Settings, field of view, night, rain, save and resume; every step screenshotted to shots/r8/audit and logged with page errors, spills and touch targets under 44 px; not a pass/fail test
node scripts/ghosttap.mjs       # phone: a tap on a building that sits where the inspector sheet's x will appear selects it and the sheet stays (the emulated click used to close it 21 ms later); the x still closes it when pressed on purpose
node scripts/copytest.mjs       # (no browser) sentences built from numbers read right at 1 and many ("1 building", "Court in 1 day"), and the HUD uses them
node scripts/suite.mjs --dir shots/suite/x   # runs every test in this list against BASE_URL, two at a time, a timeout each; results go to a summary file as they finish, so a rerun resumes (--retry-failed, --only a,b, --list, --lint); prints a table
node scripts/touchtest.mjs       # phone road drawing: plan, Build, Done, double-tap
node scripts/phonetargets.mjs    # phone: every control in every panel, and on the title screen, reaches 44 px for a finger (measured with elementFromPoint); the one-row top bar is listed at its minimum
node scripts/gesturetest.mjs     # phone: pinching or panning with two fingers keeps a planned road or service (real touch events); a stroke that turns into a pinch plans nothing
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
node scripts/moneyedge.mjs       # the edge of the money: the countdown matches the weekly closes, bankruptcy is announced once (one card, game stays paused, speed keys wait), one click on the bailout gets out, recovering resets the count
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
node scripts/impostortest.mjs    # the distant-tree billboards bake the same on a 3x phone as on a 1x desktop (both views, every species)
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
node scripts/carsolid.mjs        # (fails in most runs on one residual: two cars from the two lanes of the block's road 44 overlapping as they enter the box side by side; lanes are clean) cars never drawn inside each other in a lane or a junction at morning rush, no car stuck off a red, no heading snaps; steps the traffic model without rendering
node scripts/vehicletest.mjs     # (no browser) vehicles: all 59 models build inside their kind's size and triangle budget, a 100-car town costs no more draw calls than the old renderer, the paint mix is the real-US mix, wheels turn the right way (forwards, backwards, steering), suspension settles, reverse lamps come on by themselves, the public API and every emergency livery are kept
node scripts/vehiclestats.mjs    # (no browser) per model: triangles at close / near / far, build time, bounding box against the kind's spec; flags over-budget or oversize models
node scripts/lineup.mjs tag      # every vehicle model at 8 m / 40 m / 150 m, day and night, on the real renderer with no game boot (dev/vehicles.html; BASE_URL= picks old or new code; AZS EL SEEDS BRAKE TURN REV PARKED WET FOV env); contact sheets and index.html in shots/lineup/tag
node scripts/carcam.mjs tag      # real cars on the reference block after the morning rush: one moving, one queued, one at a junction, day and night, any preset (PHONE=1 for the 390x844 3x phone); draw calls and triangles per picture, same camera on old and new code
node scripts/sheet.mjs out.jpg 3 520 a.jpg b.jpg   # tile captures into one labelled contact sheet (before/after pairs for reports)
node scripts/streetaudio.mjs     # (no WebGL) street sound rendered offline and measured: Doppler pass-bys, engines by vehicle kind, honks only from jams of 3+ cars (never a drive-thru line), sirens that follow the moving vehicle, wet-road hiss, peak level, no audio nodes created while playing; `dev/streetaudio.html` is the audition page, docs/cars-look/audio.md the report
node scripts/streetaudio-game.mjs  # the same street sound wired into the running game (QUALITY=low for the phone pool): voices sit on real cars, sleep when zoomed out, paused or muted; a queue honks and free flow does not
node scripts/streetaudio-figure.mjs   # draws the report's before/after spectrograms
node scripts/yellowflash.mjs     # night flashing on Ultra (each case on a freshly opened page): bright yellow pixels that pop on frame to frame (still and panning, moonless/full moon, clear/rain), GL errors, failed shader builds; the old prop-flame flash fails it
node scripts/nightwarmth.mjs     # how warm the night lights are: colour temperature of the practical light on the lookbook cameras (OUT=dir saves JPEGs; MAX_CCT=K makes it a check)
node scripts/junctionmouth.mjs   # (no browser) junction shapes: mouth areas per class pair and angle, the cars' clearance to the kerb, paint against stopped cars; --compare old.json proves the network (nodes, segments, trims, junction curves) did not move
node scripts/junctionmesh.mjs    # (no browser) the real road meshes: empty spots, down-facing triangles, what the road renderer submits
node scripts/junctionplan.mjs    # top-down PNG of a drawn junction from the real meshes
node scripts/junctionshots.mjs   # before/after junction close-ups, day and night (reference block plus tee, skew and one-way junctions)
node scripts/junctionedit.mjs    # rebuilds a junction every way the game does (build across, upgrade, flip, bulldoze arm by arm, the Freedom Circle) and checks meshes stay finite and trims stay the network's
node scripts/towers.mjs low      # tower-facade luma on the reference block (mean, std-dev, share under luma 20/40, percentiles) at noon and night; PHONE=1, OUT=dir saves JPEGs; BASE_URL for old vs new
node scripts/towerlab.mjs low    # the showcase lineup (every zone x level) beside the block, swept over glass / wall-fill settings (SETS=), class-masked luma per shot
node scripts/lowperf.mjs low     # frame time of two builds side by side (A_URL old, B_URL new) on the reference block, plus draw calls and triangles
node scripts/peoplelineup.mjs    # every citizen archetype on the no-game lineup page (/dev/people.html) at 8/30/100 m day and night, walk/run/idle/action sheets, `lod` (near/far switch sheet), `feet` (GPU foot probe: planted feet, OK/FAIL) and `bench` (crowd cost); env BASE_URL, OUT, JPEG=1, W/H, BREAKDOWN=1
node scripts/peoplestats.mjs     # (no browser) people model vertices and triangles per level of detail and per archetype (--all); run it in the old tree to compare
node scripts/peoplecost.mjs low  # draw calls, triangles and ms of the people group in the reference block, close and at play height (VIEWS=close,street, ROUNDS, FRAMES, SHOT=prefix)
node scripts/snapshot.mjs name 5176   # (tooling) serves a frozen copy of the tree with its own Vite cache, so editing src/ never reloads a running capture; scripts/withslot.sh <command> runs it in one of two shared browser slots (at most two headless Chromium jobs at once); scripts/worktree.sh <name> makes a scratch worktree for a parallel helper
node scripts/crosswalktest.mjs   # people and cars at crosswalks: nobody on foot inside a car, people cross junction arms and wait at the kerb for a gap or the walk phase, cars stop for them, and stopping costs under a tenth of the traffic
node scripts/parkingtest.mjs     # live parking and drive-thru lines: lots fill by the hour (offices mid-morning, shops at noon, empty at 3 am), cars pull into stalls and back out, a grand opening spills the drive-thru line onto the road and it clears; parked cars, frame time and calls per preset with and without
node scripts/landmarktest.mjs    # landmarks draw visitors: sightseers by day, a game-night crowd at Slop 69 Field (every evening, 5 to 10 pm) that arrives, fills its lot and drives home after; the inspector counts today's visitors; a landmark no road reaches draws nobody
node scripts/collegetest.mjs     # the College's first graduates: the first home in its reach to reach level 5 says so once (with how many homes can follow), none without a college, never twice
node scripts/trafficscale.mjs    # (over its 4 ms target today: about 5 ms a step at 1,000 cars on this machine) traffic at 250, 500 and 1,000 cars in a big seeded town (grown once to shots/scale/town.json): the median, mean and 95th percentile of one traffic.update
node scripts/civictest.mjs       # Civic Foundry pack streams in: street trees, furniture, bus shelters; instanced LODs; Low skips it
node scripts/starttest.mjs       # new county: sensible site (random among good ones, saved), county road follows the land; trees: no detail disc, no gaps; far trees keep their shape (no rectangles)
node scripts/gridtest.mjs        # Roads > Grid: three clicks lay a street grid (junctions, lots, price, red streets left out, one-ways alternate, one undo, touch)
node scripts/undotest.mjs        # Undo pays for what still stands (a bulldozed road isn't refunded twice), follows a piece split by a joining street, and leaves no road behind; the Undo button names what it will pay
node scripts/progression.mjs     # (not a pass/fail test) a scripted player grows a Ponzi town: when each population mark is reached, money, what got built
node scripts/weathertest.mjs     # weather keeps to the calendar: no rain or snow spell over a month, no summer snow, changes often, doesn't strobe at top speed
node scripts/costtest.mjs        # honest service costs (running cost, committed projects, units), Next priorities, locked-fix notes, full landfill note, red bulldoze outlines
node scripts/contentaudit.mjs    # (content gate, Jev, ~$0.15 a full pass, reruns only ask new lines; --inventory/--dry-run need no key) every player-facing line vs the content rules, parody-brand IP; docs/CONTENT_AUDIT.md
node scripts/ipcheck.mjs         # (content gate, no key) real slogans used word for word and real brands' exact colors on the parody chains; riffs listed for review
node scripts/copyscan.mjs        # (no key) self-check of the copy scanner shared by contentaudit, learnability and brandcheck: literals, template holes, call arguments, every src/ file scans
node scripts/feedtags.mjs        # (Jev, $0.04 a full pass; --dry-run needs no key) tag every feed line: region, town size, weather, fits its event, likely authors
node scripts/feedtest.mjs        # the feed picks lines that fit the map, town size and weather, never empties a pool, and posts exactly as before without the tags; shop openings post the brand's name
node scripts/nametags.mjs        # (Jev, $0.01 a full pass; --dry-run needs no key) street, suffix and commune names tagged by the region they belong to
node scripts/parkingtags.mjs     # (Jev, $0.003 a full pass; --dry-run needs no key) when each brand's lot is full: busiest hours, open late, how full when quiet; writes src/agents/parkingTags.ts (the live parking's curves off screen; drawn only, never the simulation) and docs/PARKING_TAGS.md
node scripts/nametest.mjs        # no street names from another region on any map (4,000 generated per map, and roads built in game), every list still has names
node scripts/learnability.mjs    # (Jev, <$0.01; --dry-run needs no key; --list shows what it reads) every toast, alert, refusal and tooltip: says what happened, says what to do next, jargon; report and hand-written fixes in docs/LEARNABILITY.md
node scripts/brandcheck.mjs      # (Jev, $0.01; --dry-run needs no key) chain names in copy that aren't in the brand registry ("Burger Duke", "Waffle Bunker"), with a proposed canonical name; docs/BRAND_NAMES.md
node scripts/transittest.mjs     # buses: depot, lines, riders at opening, two overlapping lines split riders, diversions
node scripts/transithonest.mjs  # the transit panel ends with the whole network (fares, costs incl. depots, net) and that net is the budget's; a line with no depot says it is not running
node scripts/transitcut.mjs      # a road cut between a bus line's stops: the line stops running and stops costing, says why once, and returns when the road is rebuilt
node scripts/savetest.mjs        # save, reload and Resume bring back the same town: roads, buildings, zoning, population, money
node scripts/loadfiletest.mjs    # Load a city file from the title: a whole city loads; a partial or damaged one (roads: {}, a null building, no clock) is turned away on the title in words; a damaged own save falls back to the checkpoint
node scripts/disasterloop.mjs    # hurricane, wildfire, landslide and Florida Man: warn, hit, bill what they say (and say what they billed), end; a save in the warning or the response comes back as the same emergency, charged once
node scripts/playtest6-late.mjs   # late-game pacing: a scripted commissioner (scripts/lib/latePlayer.mjs) grows a Ponzi county toward 10,000 and prints the day, treasury and buildings at each milestone, what got in the way, and page errors; SAVETEST=1 also saves, reloads and compares. A measuring tool (CHECK=1 makes it a gate), not part of the default pass
node scripts/triage.mjs <folder>  # (Jev, <$0.01 per dozen) tester reports (🐞 text, one .txt each): area, severity, which check would catch it, duplicates; table in <folder>/TRIAGE.md. Try scripts/triage-samples (hand-labelled)
node scripts/overlaptest.mjs     # HUD panels never cover each other: emergency card, inspector, drawers, Next, toolbar, tool badge at 1707×1019 down to a phone; also the inspector against the first-steps card (it lay across the sheet's Bulldoze button on a phone)
node scripts/gradetest.mjs       # contours and slope shading around the cursor when drawing roads or placing; live road grade in the tip (amber near 15%); steep refusal names the rule and the way out
node scripts/reflecttest.mjs     # water mirror pass: first look at water compiles no shader variants (was 12.9 s on the software GPU), image matches the old clipping, nothing under the surface shows
node scripts/nighttest.mjs       # night exposure targets on the reference block: road median >= 50, pools p90 >= 100, lit facades clear of the ground, < 1% blown out, pools off by day
node scripts/presetlight.mjs     # the presets light the same street alike (noon, dusk, moonless night on the reference block): mean luma within 0.03 of High on every camera and hour
node scripts/lookbook.mjs high   # fixed-camera captures of the reference block (noon, dusk, moonless, full moon, rain) per quality, with a contact sheet (docs/ART_DIRECTION.md)
node scripts/linktest.mjs        # landmarks/services off the road network: tip, toast, red no-road bubble, inspector, alerts, no land value; feed pacing
node scripts/vaulttest.mjs       # Asset Vault: pack streams in; zoned lots grow vault buildings that fit; merch lots kept; attractions; services' vault looks + toggle; road furniture; no pack = no change
node scripts/crisisfixtest.mjs   # info views show every building with that view's problem; utility outages merge only for the same buildings; a closed warning returns when worse
node scripts/roadgrade.mjs       # a road across a dip stands on an embankment, not a floating slab
node scripts/audiotest.mjs       # ambience loops have no seam thump and no steady beat (no "train chugging")
node scripts/econtest.mjs [map] [days]  # a town grown like a player grows one: weekly bill vs population (CHECK=1 gates it, OUT=file dumps rows)
node scripts/bldshots.mjs tag    # neighbourhood-zoom shots of homes, shops, apartments, offices, factories, day and night (CLOSE=1 adds close-ups)
```

`BASE_URL=http://127.0.0.1:5174` points any of them at another server (handy for running the suite against a frozen copy while you keep editing). Scripts that assert exit nonzero on failure.
