# Polish pass: audit log

Working record for the gameplay audit of the 5-minute San Slopcisco recording
(2026-09-25). Each item: what the recording showed, what the code actually
did, what changed, and the script that keeps it fixed. "Observed" means
visible in the recording; causes below were confirmed by reproduction, not
inferred from the video.

## System map (money, tools, services)

| Seam | Authoritative source | Views of it |
| --- | --- | --- |
| Money | `Sim.spend / earn / refund` (src/sim/sim.ts) write the week's `ledger` and a labelled `transactions` log | HUD treasury + `/wk`, Budget panel, in-the-red card, placement tips, bug reports |
| Weekly rate | `Sim.forecastWeek()`: the recurring lines at today's rates (taxes, road upkeep, service upkeep, imports, transit, policies, freight, loan payments) | HUD `/wk`, Budget "Every week", `afterSpend()` projections |
| Weekly bill | `Sim.weekly()` bills the same lines as the forecast (`weekLines(false)`), then reconciles cash against the ledger | Budget "Last week", `ledgerDrift` |
| Affordability | `Sim.cantAfford(cost)` (cash + $20k credit line) | every placement's preview and commit |
| Active tool | `Tools.active` / `extTool` / `placingLabel` | toolbar, open panel's highlighted card, "Placing …" badge, ghost, cursor tip, click handler |
| Service placement | `canPlaceService` → `findServiceSpot` (shared by preview and click) | ghost colour, tip, `placeService` |
| Undo | `Game.undoStack`: roads, lane upgrades, placed buildings; refunds exactly what was paid | Undo button title, Ctrl+Z, toast |

## Fixed

### P0-A: the weekly figure lied about one-time spending
- **Observed (4:10–5:04):** cash fell ~$40k while the HUD showed +$266/wk, then the rate jumped to −$41,659/wk and later −$16,272/wk.
- **Cause:** `weeklyNet()` returned *last week's total cash change*, construction, impact fees, grants, refunds and loan money included, and only changed when a week closed. A service spree showed up a week late as a "weekly" deficit.
- **Also mis-booked:** lane upgrades were booked as road upkeep, bus depots and disaster recovery as service operating cost, transit/policies/freight/refunds/loans as "other".
- **Now:** the ledger has recurring and one-time kinds. The HUD's `/wk` is a live forecast of recurring lines only. Every transaction is labelled. Each weekly close checks cash change = ledger sum (a mismatch logs an error that bug reports capture). The Budget panel shows every-week lines, this week's one-time money, last week's reconciled cash, recent transactions, the credit line and the bankruptcy rule. Service previews show `cash after · rate → new rate`. Going into the red shows a non-blocking card with the recent causes, the weekly rate and credit left.
- **Before/after (scripts/ledgertest.mjs, same six-service spree, $74,000):**
  - before: HUD −$39/wk during the spree → **−$74,299/wk** when the week closed → −$1,027/wk.
  - after: HUD moves at most $296 (the new buildings' upkeep); weeks reconcile to the dollar.
- **Finding for balance (not changed):** a 100-person town runs about **−$1,450/wk** in recurring costs, mostly road upkeep, and lives on one-time impact fees from new buildings. That is the "Growth Ponzi" premise; it was invisible before. The Budget panel now says so ("Growth money … stops when growth stops"). Whether it is too harsh for a first session is a playtest question.

### P0-B: a building stayed in hand after switching tabs
- **Observed (4:56, 4:23):** a Sheriff's Office ghost and warning under the Garbage tab; a Water Tower label under Garbage.
- **Cause:** the Services category tabs changed the panel but not the tool.
- **Now:** switching category puts the building away. Tool changes re-render the open panel so its highlighted card follows. Desktop shows "Placing … · Esc or right-click to cancel" with a Cancel button. Right-click cancels whatever is in progress, then puts a placement tool away (right-drag still orbits).
- **Found on the way:** four quick clicks bought four $11,000 offices (the spot finder snapped each click next to the last). Pointing at an existing building no longer snaps. Ctrl+Z never undid anything (plain Z opened Zoning first). Undo now also covers placed services, depots and landmarks, and names what it reverses: "Undo Sheriff's Office (+$11,000 back)".
- **Script:** scripts/tooltest.mjs.

### Services status line was frozen while the panel stayed open
- **Observed (2:30–4:13):** "130 kL/day used · 0 built · importing 130" while population grew 142 → 243.
- **Cause:** the line was rendered once when the panel opened; utilities are recomputed daily.
- **Now:** open panels refresh their live numbers twice a second.

### P1-C: roads say the rule and the way out
- **Observed (0:27):** "Birkenstock Bluffs won't let you. Pay them off or sue." Joke first, rule unclear, remedy not offered.
- **Now:** "Commune land: roads can't cross Patchouli Pines. Pay them off $56,000 (64% chance) or sue $13,000 (47%, 20 days). Click here for options." Clicking anyway spends nothing and opens the commune, whose panel now says what happens if a pay-off or lawsuit fails. Forever communes say "Protected land … Roads must go around." A road you can't afford says how much it needs. **Script:** scripts/roadrules.mjs.

### P1-C: zoning says what it did and why lots wait
- A brush stroke reports "Zoned 50 lots Suburban Slop (Low Res) · 13 outside your land (buy it in 🏞️ Land) · 9 already zoned something else (Dezone first) · builders want it (R +60)".
- With the zoning tool out, zoned lots are bright when builders want them and dim while waiting for demand; the tip says which.
- Clicking an empty zoned lot opens it with the primary reason: waiting for demand (with a link to that demand card), a back lot (only street-front lots start buildings), or in line (how many buildings a day builders start, across how many empty lots).
- **Script:** scripts/zonetest.mjs.

### P1-D: services read as choices
- Each category says whether it's covered by your buildings, by a paid fallback (highway imports, the county trash contract, with its weekly price and limit), or short, and why buildings are cut off (no road; no plant and no route to the highway; past the import limit). It compares the cheapest local building ("A Groundwater Well Tower ($7,000 + $30/wk) makes 800 kL/day: costs about $26/wk more than importing"). Coverage services say what being uncovered risks. Cards show output or reach. "Boil notice pending" is marked as a joke.
- **Script:** scripts/svcstatus.mjs.

### P1-E: progression you can find later
- The 250-person unlock is a small card ("🔓 Unlocked at 250 people: Luxury Slop apartments · Zoning → 🏢 Luxury Slop (High Res)") with Open, which goes there with it selected; the card says NEW until used. Celebrations during placement shrink to a notice. Locked cards give the population they need. The 🌲/🏙️ meters open a card explaining both, with live numbers and the win condition.
- **Script:** scripts/progresstest.mjs.

### Also
- Mouse at a screen edge scrolls the map (Settings → Edge scrolling). **Script:** scripts/edgetest.mjs.
- Bug reports now carry frame times, the slowest frames with what the game was doing, graphics state (effects on/off and why), demand and a short timeline; F3 shows where frame time goes.

## Playtest 2 (2026-09-26): live commentary, a 6:56 recording and six reference shots

The reference shots put the game at about **1268x595 CSS px** (Windows scaling
inside the browser frame), which changed several conclusions.

### The HUD covered the map
- **Observed:** road drawer + top bar ~40% of the height; the toolbar ran off the right edge ("REPORT B").
- **Now:** a slimmer top bar and toolbar on desktop; drawers share their title row with their mode chips; cards are one row; short windows tighten further. Milestones are a ribbon under the top bar, not a card over the middle. Settings has a field-of-view slider.
- **Before/after (scripts/hudfootprint.mjs, share of the height that is map):** at 1268x595 roads 47% -> 73%, zoning 44% -> 73%, services 27% -> 62%; at 1690x946 roads 67% -> 80%.

### "Spotting" at every preset was ambient occlusion
- **Cause 1:** terrain facets read as creases, so AO blotched flat grass (Ultra). **Fix:** an angle bias; only real corners occlude.
- **Cause 2:** at half resolution (High) every AO pixel sat exactly on the edge between two depth texels, and rounding picked one row or the other in slow bands (moire stripes that moved with the window size and zoom). **Fix:** read depth at texel centres; interleaved gradient noise for the rotation.
- **Before/after (scripts/aotest.mjs, bare ground, AO on vs off):** AO darkened it by up to 49/255 with row-to-row stripes of 4-9; now under 1.6/255 and under 1, at High and Ultra, 1268x700 and 1268x595, two zooms.

### Speckled water, flag-like distant trees, a black box
- **Water:** the wave noise used the `fract(sin(x)*43758)` hash with world coordinates in the thousands; on GPUs whose `sin` loses precision for large arguments (the Windows/ANGLE path) it turns blocky and the reflection breaks into white speckles. All seven shaders that used it now use a sin-free hash. **Script:** scripts/shadercheck.mjs. (Not reproducible in the headless renderer, whose `sin` is exact.)
- **Distant trees** were side-view impostors: from the usual camera angle, dark flags on long trunk streaks, and lit twice. They now bake a side view and a view from 55 degrees up, blend by view angle, and bake about their albedo.
- **The black cube** was the Freedom Incinerator: dark metal under a near-black roof. Service and depot flat roofs are now a light membrane.

### Night, junctions, people, boats
- **Night:** the grade lifts exposure after dark and blacks go moonlit blue; water stays dark; fireflies (lime HDR glows up to 600 m out) are now warm, small and only close up.
- **Junctions:** a road built over the end of another road didn't join it; the capped dead end sat on the through road as a round disc, unconnected (it happened at the county road's end in the town centre). Dead ends a new road runs over now become T junctions; roads can't meet closer than 15 degrees; junction asphalt matches the roads; street junctions get crosswalks. **Script:** scripts/junctiontest.mjs.
- **People and boats:** pedestrians come from a town budget (3 + 7% of residents) with per-building caps, and each building lets one person out every 6-10 s (the lines outside a factory were people leaving together and walking off in step). Boats: 73 at 27 people before, 1 now (1 + pop/120). **Script:** scripts/scaletest.mjs.

### New: prebuilt interchanges (Roads -> Interchanges)
- **Freedom Circle:** a roundabout with four stubs.
- **Diamond Interchange:** the cross street bridges the highway on an overpass (a raised deck with approach ramps; roads it crosses pass under; nothing joins or zones along it mid-span; saved with the city), four ramps join the two. Placed on a Slopway it lines up with it and uses it. `,` and `.` rotate. **Script:** scripts/interchangetest.mjs.

## Reference shots 145605 and the placement notes (2026-09-26)

- **Special buildings "don't snap to roads, janky; not cutting the earth":** services, bus depots and landmarks now sit square to the nearest road, facing it with a 2.5 m apron, sliding along it to the nearest spot that fits. The preview is the building's own model, its footprint and an entrance arrow, at exactly the transform it's built with. Pads are cut to the road's grade with a 1:2 embankment (6-24 m) that leaves road beds alone. **Before/after (scripts/placetest.mjs, a fire station on an 8 m hillside):** the building sat 1.4 m above the street on a pad 0.17 m out of level, 5.6 m back from the curb, and a landmark next to the road was refused as "Overlaps a road"; now 2.5 m back, level to 0, entrance at street grade, ghost = final.
- **Trees floating over cuts or buried in fill:** trees follow any regrading (roads, pads, terraforming). 19 of 879 trees near that street were off by up to 2.5 m; now 0.
- **"Weird circle of trees":** round crowns had no leaves above ~50 degrees, so a close tree seen from above was a hollow ring. Crowns are closed on top.
- **Neon magenta trees (spring):** redbud and dogwood are muted rose and off-white.
- **Big white hoop while zoning:** the brush ring is draped on the ground and hidden behind trees and buildings.
- **Shore plant said "Needs a road" at the water's edge:** it now says to run a road down to the shore.

## Graphics (user: "we need the graphics to improve")

- **Distant forest was a lime carpet:** impostors were lit as one sunny face while detailed broadleaf crowns shade themselves. **Before/after (scripts/treelod.mjs):** Holler County far/near brightness 1.34-1.53 → 1.05-1.12, cover 46-66% → 70-79%; Golden Coast 0.97-1.05.
- Broadleaf crowns are lobes of smaller cards with baked self-shadowing and rounder normals; oaks are fuller; leaves glow faintly when backlit.

## Playtest 3 (Growth Ponzi, Holler County, bankrupt at 190 residents)

- **The budget couldn't be balanced:** the pre-built 2.3 km Old County Road (4 lanes) was billed to the town: $814/wk on day one, ~$1,420 by year two, nearly all of the $1,498 road bill at game over, while 190 residents pay ~$170/wk. It's the state's now (you pay only for widening it). The county trash contract is $12/t (was $22, nearly all the residential tax of a 400-person town). **Simulated compact town (1.5 km of two-lane streets, homes, a shop street, industry), two game years:** before, −$989/wk at day 90 and bankrupt by day 720; after, −$180 to +$160/wk with ~$120k in the bank throughout.
- **Road commitments:** the preview gives length, cost, upkeep now and once aged, trees cleared, buildings bulldozed, and what it joins (or that it connects to nothing). Undo replants the trees, for roads and buildings.
- **Demand as a next action:** the demand card counts buildings, homes or jobs filled, empty zoned lots and jobs vs workers, and says one next step (zone X, build a street, wait for builders, or what's dragging demand); the bars' tooltip too.
- **Runway and goal:** the budget shows road upkeep now, in a year and in four, and roughly how many more residents break even takes. The meters card lists nearer goals; the sprawl meter shows tenths of a percent early on, with marks at 1%, 2.5% and 5%.
- **Sluggish on Ultra past 150 residents:** (a) every new day in spring and autumn recoloured the trees by re-streaming every tree on the map, and every building going up in the woods did the same: 90-130 ms hitches about once a second at top speed. Now colours repaint a slice per frame and cuts/regrades edit the drawn instances in place; the worst frames while a town grows are 16-35 ms. (b) Pedestrians drew their whole capacity, hidden people included, in the shadow pass too: 2.1M of Ultra's 4.8M triangles a frame in an empty county. Now 2.6M in all. (c) The sprawl sweep runs a fifth of the county a day instead of all of it every fifth day (a ~14 ms hitch).

## Buildings, round 1 (feedback: satirical exaggeration on a realistic base, judged at neighbourhood zoom)

- **The town read as a spreadsheet:** empty zoned lots stayed painted at 30% opacity outside the zoning tool; now 10%.
- **Commercial strips shout:** brand pole signs 1.5x wider and 1.3x taller (9 m minimum); half the shops get flailing tube men (6.5 m, kinked, arms thrown); 40% fly an oversized flag; a quarter of wide shop lots and 30% of factories carry a roadside billboard on a tall pole behind the building (the billboard art existed but was never placed).
- **Homes:** half of them fly a flag at the front corner, bigger with the house.
- **Night:** building glow 1.45 -> 2.2 (nightglow.mjs: 0.15% blown pixels, limit 0.5%); 60% of home windows lit (was 35%); warm lanterns by every front door, a bare bulb by every trailer door.
- **Daytime white orbs by trailers** were burn-barrel fire particles at night brightness; fire and sparks are a third as bright by day.
- **Harness:** scripts/bldshots.mjs builds the same town each run and shoots it at neighbourhood zoom (triangles unchanged at ~0.85M for those views).

## Round 4 (a Codex first-five-minutes review of Golden Coast, and the user's Sawgrass Springs screenshots)

- **The first five minutes:** a "Next" line sits by the toolbar the whole game. A new town gets five steps (a street off Old County Road or homes zoned right along it, zone homes, the first home, zone jobs, open the budget), each with a button that does it (opens Roads, starts zoning homes with the drawer open, speeds up time); after that it follows demand. It shows the next unlock ("250: Luxury Slop apartments (40 now)") and can be hidden.
- **Wording:** demand no longer says "every lot is taken" in an empty town: it says "no lots are zoned for homes yet", "every lot zoned for homes has a building", and counts unzoned lots along roads separately.
- **Construction consequences:** the road preview adds the weekly balance before and after ("weekly +$120 → −$64").
- **Back to town:** H, or clicking the town's name, flies to the middle of the town.
- **Toolbar:** on desktop it leads with the building tools (Roads, Zones, Services, Landmarks, Upgrade, Bulldoze) with bigger icons and bold labels, hotkeys in the tooltips; transit, communes, terrain and the rest are under More. Zoning types sit in a grid instead of a sideways-scrolling row.
- **Zoning cells:** each cell is drawn with a light rim, so rows of lots read as lots, and the overlay is stronger while zoning.
- **Feed:** opens as a peek at the newest post; click it (or ⤢) for the list.
- **Screenshots:** chimney smoke from every house read as a town on fire in Florida in summer: chimneys smoke only in winter (and in the Appalachian autumn and spring), never in Florida, with smaller, fainter plumes. Storefront windows were a solid near-white tile at glow 2.2 and blew out at night: they're a lit interior now (warm gradient, dark shelves), glow 1.8. Notices sat in the middle of the screen over the town; on desktop they stack at the right. Need icons next to the camera no longer balloon to twice the size of the rest (their minimum size was 3.2 m, now 1 m).
- **Not done yet from the review:** named save slots/checkpoints, undo for zoning, highlighting the exact plots the Next step means, a "why isn't this growing" inspector, Golden Coast terrain identity and more ground variation.

## Economy, round 2 (user: "the economy is deff too easy")

- **Why it was easy:** taxes grow with population and building level, while service costs were flat and tiny: a $85/wk sheriff covered 2,600 people paying ~$2,300/wk, and one 14 MW gas peaker powered ~5,000 people. Services were 15% of the taxes of a 2,000-person town, which netted ~$1.80 per resident a week (the user's Sawgrass Springs: +$2,901/wk at 1,985).
- **Now costs scale with use:** every service has a running cost on top of a lower fixed upkeep: fuel per MW for power plants, per kL for pumps and sewage, per ton collected for dumps, and per person (fire: per building) served for police, fire, clinics, hospitals, schools and colleges. Station capacities are smaller (sheriff 2,600 → 1,600 people, clinic 1,800 → 1,200, school 1,600 → 1,100), so a growing town needs more of them. Cards, placement tips and the facility inspector show the rate and this week's running cost; the "a plant would save you" hint counts its fuel.
- **Shops were empty:** goods moved at truck speed (a game day is 2.5 s of driving, ~30 m) but shops sold a truckload in five days, so most shops sat closed with "No goods to sell" and paid no tax while demand asked for more shops. Shops now sell and factories make goods at rates trucks can keep up with, hold one to three months of stock, reorder at 60% from the nearest factory with a load, can have two loads coming (up to 120 units) while a factory runs three trucks, a slow import no longer blocks a nearby factory, and a shop rides out eight bare days before closing. In the harness town late-game shops went from nearly empty to 40-80% staffed and commercial taxes from ~$30/wk to $200-935/wk.
- **Harness (scripts/econtest.mjs):** a Growth Ponzi town on Florida grown like a player grows one: a street of homes, more streets as lots fill, jobs, then density; services when the game asks (a fire, crime, sickness, trash, a station outgrown, supply running short); a loan when cash runs low; no hurricanes. **After (three runs):** ~380 people −$350 to −$620/wk, breaks even ~1,000-1,100, ~2,000 people +$600 to +$1,150/wk ($0.3-0.55 per resident, was ~$1.80), services ~63% of taxes, lowest cash $6-11k, $20-70k in the bank through years two and three.
- **Landfills:** a full landfill left trash on the curb and a month later 200 buildings were abandoned at once (2,081 → 80 people in the harness). There's now a warning at 80% full with the days left.

## Fresh-city playtest (Holler County, 0 to 5,284, builds 9b1b8d4 → 4e7cfed)

- **A bus line vanished after an $864 street:** a new street joining a road with bus stops splits that road's segment, and the transit system treated the old segment's removal as demolition and deleted every line with a stop on it. Stops now move to the new halves (the road network flags a split); only a real removal ends a line, and the bulldoze tool names the line it would end before the click ("⚠️ ends The 69 Express bus line"). scripts/playtest5.mjs fails on the old code (0 lines) and passes now.
- **A good build looked like a failure:** after placing a service or bus depot the tool stayed armed over the new building and tested it against itself ("already here" in red). The tip now says "✅ Built …" in green until the pointer moves off it; one click still builds one.
- **Finding room for big buildings took many tries:** while placing a service, green rings mark the curb in front of every roadside spot around the view where it fits (checked a few a frame, nearest first), and a red tip points to them.
- **The Transit panel said "No routes" after a line was made on the map** until reopened: it now redraws when lines, stops, buses or ridership change (not while a name is being typed).
- **Transit was a money printer:** one bus carried ~2,000 riders a week at $2 against $135 of upkeep (the tester's 69 Express: $4,074/wk fares, nearly half the city's profit). Each ride now costs $1.50 to run (drivers, fuel, the fare app): a busy line at $2 nets a little, free fares are a real subsidy, surge pricing trades riders for money.
- **The game returned to the title and resumed ~10 game days earlier:** that was a new build of the artifact being published while the city was open (the artifact reloads open views). The game already saved every 30 s and when the tab hides; it now also saves when the page is replaced.
- **Road demolition preview:** already there (the road preview says "bulldozes N buildings" before the click; civic buildings block the road).

## Remaining (ranked)

1. Cities saved before this build keep any dead end that was built over (a disc on a through road, unconnected): bulldoze and redraw that stub. A load-time repair would move road endpoints that zoning and buildings refer to, so it wasn't done blind.
2. The water speckle fix is reasoned from the shader, not reproduced: the headless renderer's `sin` is exact. Confirm on the playtest machine.
3. Junction at 1:27–1:37 of the first recording (dark slab, queue behind a DUI crash): needs that save to reproduce.
4. Balance: retuned for a harder mid-game (above); the next playtest says whether the early deficit (−$300 to −$600/wk until ~1,000 people) is fun or grim.
5. "143/300" vs HUD 142: the transit notice reads population at the moment of the click while the HUD refreshes four times a second; not a data mismatch.
6. P2: persisted audio/motion settings, colour-blind-safe zone patterns (the overlay still relies on hue plus brightness), keyboard focus through every panel.
7. Phase 3: observe five unfamiliar players on the first neighbourhood (the report's playtest questions) before further tuning.
