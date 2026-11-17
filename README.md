# SLOPMERICA
*Land of the Free Parking.*

A satirical 3D city builder where the goal is everything urban planners warn you about. You start with a pristine Appalachian-meets-Texas river valley and end with 8-lane stroads, 120-pump gas stations, cul-de-sacs over the wetlands, and a five-level interchange where two gravel roads used to cross.

**Status:** playtest. The game runs in the browser (desktop and phone) and builds to a single offline HTML file. Design notes: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Run it

```sh
npm install
npm run dev            # http://127.0.0.1:5173
npm run build:single   # dist-single/index.html, one file (about 12 MB, the art packs inside), works offline
```

`#skip&map=florida&mode=sandbox` on the URL skips the title screen (maps: `appalachia`, `norcal`, `florida`; modes: `ponzi`, `sandbox`, `hippie`, `speedrun`).

A built game has no debug hooks and no playtest tools. `#debug` on the URL installs the hooks (`window.__game`, `__dbg`, ...). `#playtest` installs them too and shows the tester's tools (bug button, build stamp, performance); the tools stay on for that device until `#playtest=0`.

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

Headless checks live in `scripts/` and drive the game with Playwright. By default the browser draws with SwiftShader (software WebGL), so the pixels are the same on every machine; `GPU=1` uses the real graphics card. They run on Windows, Linux and macOS: `scripts/lib/browser.mjs` finds the browser (`CHROME=` overrides it) and at most four run at once per checkout (`scripts/lib/slots.mjs`).

The list of tests is not in this file. It is in `scripts/tests/fable.json` (simulation, traffic, tools, UI, saves, writing), `scripts/tests/astra.json` (how the world looks and sounds) and `scripts/tests/shared.json` (both). Each entry gives the command, a tier, a timeout, whether it needs a browser or a key, and what it checks. Every script in `scripts/` must be listed there, as a test or as a `measure` entry that says why it is not one; `node scripts/suite.mjs --lint` fails otherwise.

```sh
npm run gate                              # before every commit: typecheck, build and its size budget, the checks that need no browser, the registry lint
npm run smoke                             # before every push: the quick browser checks against a frozen copy of the tree
node scripts/suite.mjs --serve            # everything that is pass/fail, against a frozen copy (results in shots/suite/full; a rerun resumes)
node scripts/suite.mjs --list             # what would run, what would not, and why
node scripts/suite.mjs --only savetest    # one test (BASE_URL=http://127.0.0.1:5173 unless --serve)
node scripts/snapshot.mjs name 5181       # serve a frozen copy yourself, so editing src/ never reloads a running test
```

`BASE_URL=http://127.0.0.1:5181` points any script at another server. Scripts that assert exit nonzero on failure. Tests with traffic in them take `SEED=` (default 1; `FUZZ=1` picks a random one and prints it).
