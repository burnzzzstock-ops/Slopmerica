# SLOPMERICA
### *Land of the Free Parking.*
**Game Design Doc · v0.2 (playtest)**

> **Status (September 2026).** The game is built and in playtest; this document is still the vision. Read everything below as intent, and check the lists here for what actually exists. Where the code and this doc disagree, the code is the current truth and the gap is a decision to make, not a bug to assume.
>
> **Implemented:** three counties (Appalachia, NorCal, Florida) with weather, seasons and night; road drawing (curves, junctions, bridges, grading, federal grants, ONE MORE LANE) with undo; zoning and growable buildings with levels; land tiles bought with money; utilities (power, water, sewage) flowing over the road network with capped imports; garbage, fire, police, health, education and parks by drive time; pollution and noise fields; freight stock between factories and shops; bus transit; districts and policies; terraforming; disasters; communes; traffic and pedestrians; the X feed; save/continue; a playtest bug reporter.
>
> **Trust milestone (done, September 2026):** road upgrades and bulldozing go through one validated command from the toolbar and the inspector; the pollution field conserves mass; transit riders are counted once; saves keep the random stream, growth and bankruptcy state, this week's ledger, unbilled utility imports, freight in transit and cleared trees; graphics quality changes only the picture (trees and traffic budgets are the same on every preset); widening or splitting a road keeps the buildings along it. Each has a regression script in `scripts/` that exits nonzero on failure.
>
> **Learnability (in progress):** the R C I O demand bars open a card with the signed value, its trend over the last week, every reason with its signed share (they add up to the bar), what the value means for building right now, and one action (zone what's wanted, fix utilities, taxes). Next: event-driven first-session objectives, growth receipts vs recurring liabilities, a transaction ledger, persisted mute and accessibility settings. The target is one learnable 30–45 minute first session, validated by watching unfamiliar players, not by reading the code.
>
> **Aspirational (not built):** the Old Main / courthouse-square anchor and a before/after "Then & Now" comparison; the 20–25-year maintenance cliff (road upkeep currently steps up after 1 and 4 years, and widening resets a road's age: a decision still to make); the full historical downtown economy; parking-minimum and floodplain systems as described below.
>
> The original open questions are in §12.

---

## 1. The pitch

**Cities: Skylines, except the goal is to do everything urban planners warn you about.**

You're the new County Commissioner of a valley that is still flat-out beautiful: old-growth hardwood ridges, a trout river, mist in the hollers, fireflies, and a sleepy walkable 1890s main street. The Chamber of Commerce gives you one word: **GROWTH.**

So you pave it. You punch a 4-lane stroad with a center turn lane through the forest, put a gas station on every corner, ring the old downtown with drive-thrus, plat 400 cul-de-sacs over the wetland, and top it off with a five-level Texas stack interchange where two gravel roads used to cross.

Every forest you bulldoze pays out. Every lane you add fills right back up. Every subdivision is a maintenance bill due in 25 years, and the only way to pay it is to build **more subdivisions**.

**Comps:** *Cities: Skylines* (road drawing + sim) × *Terra Nil* played backwards × *Fallout* / *Helldivers 2* deadpan satire × *King of the Hill* × a Not Just Bikes video you live inside.

**The joke and the gut-punch are the same move:** the valley starts gorgeous, and the game never lets you forget what used to be there.

---

## 2. Design pillars

1. **Paradise first.** The starting valley has to be truly beautiful: golden-hour light, birdsong, fireflies, a creek you can hear. Destruction only lands, as comedy or as tragedy, when you can see and hear what you traded away.
2. **The satire lives in the systems.** The punchlines are mechanics. Induced demand really works (widen the road and the traffic comes back). The growth Ponzi really bankrupts you. Parking minimums really do make oceans of empty asphalt. Floodplain subdivisions really flood. You learn actual urban planning by doing it as wrong as possible.
3. **The game is a true believer.** The UI, the advisors, and the achievements celebrate everything with Chamber-of-Commerce enthusiasm. The game never winks. The player does.
4. **Specific beats generic.** Center turn lanes. 120-pump gas stations. A Halloween pop-up in the dead toy store. Cell towers disguised as pine trees. Retention ponds sold as "lakefront." Sidewalks that end in a ditch. Subdivisions named after whatever they bulldozed.
5. **It has to be fun to build.** Under the jokes, road drawing is buttery, feedback is instant, and number goes up. If building isn't satisfying, the jokes are dead in 20 minutes.

---

## 3. Tone & voice

- **Booster-speak by default.** Every label reads like a real-estate brochure: forest is *Unactivated Land*, wildlife loss is *Pest Management*, smog is the *Aroma of Progress*, and debt is *Growth*.
- **Punch at systems, not people.** The villains are incentives, chains, developers, and feedback loops. Residents can be ridiculous but never pathetic (King of the Hill rules). It's also just funnier: a 120-pump gas station is a better target than some guy.
- **Everything is parody.** Fictional brands, places, and people. No real logos, no real politicians. That keeps it funnier and keeps it sellable.
- **Culture-war dial:** to be decided (Q2).

### Honest Mode
A toggle, unlocked through Earl the old-timer, that relabels everything truthfully. One swapped dictionary delivers the whole thesis.

| Booster | Honest |
|---|---|
| Unactivated Land | Old-growth forest |
| Growth | Unfunded liabilities |
| Freedom Index | Car dependency |
| Lakefront Lot | Stormwater retention pond |
| Premium Parking Experience | Asphalt |
| Economic Development Incentive | Corporate welfare |
| Pest Management | Extinction |

---

## 4. Core loop

```
PRISTINE LAND
  → PAVE IT            clear-cutting pays out
  → DEVELOP IT         subdivisions, strip malls, drive-thrus
  → CASH IN            impact fees + fresh property taxes
  → TRAFFIC            → ONE MORE LANE → traffic comes back (induced demand)
  → THE BILL COMES DUE ~25 years later: repaving, bridges, pipes. No grants for maintenance.
  → the only money that covers it is the NEXT subdivision's impact fees
  → EXPAND INTO MORE NATURE ↺
     …while NATURE FIGHTS BACK: floods · heat · fire · tornadoes · the grid freezes
```

**The arc of a game:** the early game is a sugar high (cheap land, fresh fees, empty roads). In the mid game the first repaving bills land and the stroads choke. In the late game you're sprinting outward faster than the liabilities can catch you, until you pave the last tree (you win) or the Ponzi collapses (§5.10).

---

## 5. Systems

### 5.1 Roads: ONE MORE LANE
The road hierarchy doubles as the tech tree.

| Tier | Road | Notes |
|---|---|---|
| 0 | Dirt / gravel county road | Cheap. Dusty. Honest. |
| 1 | 2-lane highway | Scenic. Won't last. |
| 2 | **4-lane stroad + center turn lane** | The signature road: half street, half road, bad at both. Every business gets its own driveway, and every driveway cuts capacity and adds crashes. |
| 3 | 6-lane stroad | Unlocks "Boulevard" branding. Still has the center turn lane. |
| 4 | 8-lane stroad + frontage roads | Texas-style one-way feeder roads lined with businesses on both sides. |
| 5 | Freeway | Limited access. On-ramps, billboards, exits named after gas stations. |
| 6 | 12–26 lane mega-freeway | **The Katy.** The endgame flex. |

- **The One More Lane button.** Click a road, press the button, get a lane. It's the most satisfying button in the game, and it always works for about 18 months.
- **Freeform curved roads** (Skylines-style splines) with snapping and automatic intersections.
- **Terrain grading.** Roads cut and fill the land. When the grade gets too steep, the road goes up on **concrete spans**, and the pillars and flyovers build themselves. Taller spans earn more prestige.
- **Prefab interchanges:** diamond → cloverleaf → SPUI → 4-level stack → **the 5-level High Five**. Dropping one where two gravel roads cross is encouraged.
- **Texas U-turns, cul-de-sacs, loops & lollipops.** The street grid is available, but residents suspect it's a communist plot *(dial-dependent)*.
- **Roundabouts** are available too. Nobody can work them, and the crash rate triples.
- **Sidewalks** are optional and end abruptly. Pedestrians wear a **desire path** into the grass anyway. The bus stop is a pole in the dirt next to six lanes of traffic.
- **Roads auto-name themselves after what they destroyed:** *Whispering Pines Pkwy*, *Old Oak Dr*, *Creekside Blvd* (the creek now runs through a culvert underneath it).

### 5.2 Development: "activating" land
Three ways to build, matching how the real thing happens:

- **Strip zoning.** Paint commercial along a stroad and the pad sites fill with chains based on traffic counts. More traffic draws better chains, and gas stations *love* traffic.
- **The Plat-o-Matic™.** Draw a boundary, pick a template (Cul-de-Sac Gardens, Loops & Lollipops, Trailer Park Grid, Gated Golf Estates, Build-to-Rent), and it generates the streets, the lots, the retention pond, and 300 houses on the spot. Developers don't build towns; they build subdivisions. So do you.
- **Plop.** Landmarks, big boxes, civic buildings, industry.

Around those:
- **Parking lot generator.** Every building gets its legally required parking, sized for Black Friday, so it sits 90% empty 364 days a year. Each lot gets one sad tree in a mulch island.
- **Parking minimums** are a policy slider. Crank it and watch the asphalt spread.
- **The naming engine.** Subdivisions are named after what they replaced (*Deer Run Estates*, *The Reserve at Hemlock Creek*, *Heron Marsh*, which is on the marsh). Apartments get *The Vue @ Creekside*.
- **Dollar Colonels self-seed.** Leave rural land alone long enough and one sprouts on its own, like a weed.
- **The old downtown dies slowly** once the bypass SprawlMart opens. Vacancies fill with vape shops, then a Specter Halloween every October, then nothing.

### 5.3 Traffic & induced demand
- Households make trips: to work, shopping, drive-thrus, gas, church, and Friday night football.
- Where people go and how they get there both depend on travel time. Add a lane and travel time drops, so people take more and longer trips until the traffic comes right back. **Induced demand isn't scripted. It falls out of the model.**
- Congestion uses the real traffic-engineering formula (the BPR curve) per road segment, which keeps thousands of cars cheap to simulate.
- **Drive-thru queues are physical.** When the Chick-Fil-Eh has its grand opening, the line spills onto the stroad, eats a lane, and gridlocks the county until a deputy shows up to direct traffic.
- **Crashes** scale with speed × volume × driveways. Each one spawns an injury-lawyer billboard nearby: *"HURT IN A WRECK? CALL THE TIRE IRON. 1-800-WRECKED."*
- Commute time is a headline stat, branded *Quality Time in Your Truck™*.

### 5.4 Money: the Growth Ponzi
This is the spine of the difficulty, and it's based on real municipal finance (the Strong Towns critique).

- **Income:** impact fees (paid once by new construction, and huge), property tax, sales tax, fuel tax, speed-trap tickets, lumber and coal sales, federal highway grants.
- **Federal grants cover 80% of new road construction and none of the maintenance**, so building new is always cheaper than fixing old.
- **New infrastructure costs almost nothing to maintain for about 20–25 game-years.** Then the repaving, bridge, and pipe bills all land at once. Roads visibly crack and grow potholes as they wear down.
- **The trap:** low-density sprawl brings in less tax per mile of road than that road costs to maintain. The only thing that covers the gap is impact fees from the *next* subdivision. So you keep growing, outward, into nature.
- **Value-per-acre overlay** (Honest Mode): the old downtown pays far more tax per acre than the SprawlMart ever will. Nobody in the game cares.
- **Other levers:** bonds; tax abatements (give Amazin' 20 years tax-free to land a warehouse); **Cousin Dale's Paving LLC** (no-bid contracts: cheaper today, crumbling faster tomorrow).
- Going bankrupt triggers the collapse ending (§5.10).

### 5.5 Nature: the fuel you're burning
The land is finite, and on your timescale it doesn't come back.

- **Land cover:** old-growth forest, meadow, wetland, farmland, river, mountain. Clear-cutting pays out in lumber.
- **Wildlife:** deer, black bears, bald eagles, trout, hellbender salamanders, synchronous fireflies. Animals live in habitat patches, roads chop those patches up, and small patches die out. You can watch them thin out. The last deer wanders a SprawlMart parking lot.
- **Water:** real watersheds come from the terrain. Pavement speeds up runoff, and wetlands soak it up until you pave them. The river's color tracks what you dump in it: brown (sediment), green (lawn fertilizer), orange (acid mine drainage), and finally on fire.
- **Air & heat:** traffic and industry smog tints the whole sky. Losing trees and adding asphalt builds heat islands.
- **Light pollution:** the night sky starts with the Milky Way, and you watch it fade. The fireflies go first.
- **The soundscape is a health bar.** Birdsong, the creek, and crickets slowly give way to chainsaws, then traffic drone, leaf blowers, truck revs, car alarms, and fireworks-or-gunshots.

### 5.6 Residents
- **A household is its truck.** Click one: *"The Dwyers. 2.4 kids, 3 trucks, 1 boat (used twice). Commute: 74 min. Wants Route 9 widened. Also wants less traffic. Currently idling in a drive-thru (23 min)."*
- **Their demands contradict on purpose:** more lanes and less traffic, low taxes and perfect roads, big lots and everything nearby, and no apartments anywhere.
- **PorchWatch** (a NextDoor × doorbell-cam parody) is the game's Chirper feed:
  - *"Saw a MAN WALKING on Oak Hollow Dr. Just walking. Has anyone else seen this?? Calling it in."*
  - *"Was that fireworks or gunshots"*
  - *"Who do I call about the BEAR in my trash"*
  - *"Basement flooded AGAIN. This never happened before they built the SprawlMart"*
  - *"PSA new Dillo's opens Tuesday!!!!"*
  - Stretch goal: posts attach a real fisheye doorbell-cam render of that street in your game.

### 5.7 Opposition & politics
- **Clout** (political capital) comes from ribbon cuttings, tax cuts, and filling potholes before elections. You spend it on rezonings, variances, and steamrolling objections.
- **Public hearings.** Every rezoning brings the regulars to the podium: **Earl** (remembers when this was all woods), **Skyler** (the bike guy), **Deb** (HOA; against apartments on principle), **Chad** (developer; for everything), and **Pastor Rick** (needs more Easter parking). You always win the vote. It just costs time and Clout.
- **The endangered salamander.** A rare species turns up on your site. Pay consultants to relocate it, reclassify it, or route around it. Nobody routes around it.
- **The EPA** inspects, fines, and can be lobbied.
- **Rival counties** bid against you for Amazin' HQ3 and a gigafactory. It's a race to the bottom in tax giveaways.

### 5.8 Events & disasters (mostly self-inflicted)

| Event | Trigger | What happens |
|---|---|---|
| Flash flood | Rain × pavement in the watershed | Floodplain subdivisions go underwater. You take the federal money and rebuild in the same spot. |
| Tornado | Random, statistically fond of trailer parks | "Meteorologists remain baffled." |
| Wildfire | Drought + subdivisions in the woods | The wildland-urban interface, live. |
| Grid Freeze | Winter storm + the *Independent Grid* policy | Blackouts, burst pipes, the Waffle Hut Index goes red. |
| River fire | Water pollution maxed out | Achievement: *Burning River*. |
| Sinkhole | Karst + groundwater pumping | Swallows a Dollar Colonel. Another one sprouts next door. |
| Bear raids | Subdivisions in bear habitat | PorchWatch meltdown. |
| Deer-strike epidemic | Fragmented habitat + fast roads | Lawyer billboards multiply. |
| Chicken sandwich grand opening | A new drive-thru opens | County-wide gridlock. |
| Black Friday | Every November | The one day the parking lots are full. |
| Spooky season | Every October | Every vacant storefront turns into a Halloween pop-up. |
| Flaming tap water | Fracking near wells | You can light the kitchen faucet. |
| Heat dome | Heat island + no trees | AC load hammers the grid. |

**The Waffle Hut Index** (after FEMA's real, informal Waffle House Index) is the disaster-severity meter. Green: full menu. Yellow: limited menu. Red: closed, and God help you.

### 5.9 Progression
Unlocks come with population, and each stage is named for a classic stage of American growth.

| Pop. | Title | Unlocks |
|---|---|---|
| 0 | **Wide Spot in the Road** | Dirt roads, trailers, gas station, logging |
| 500 | **Crossroads** | 2-lane highway, Dollar Colonel, first drive-thru |
| 2,000 | **Exit Town** | 4-lane stroad, strip mall, tract homes |
| 5,000 | **Boomburb** | SprawlMart, McMansions, HOAs, parking minimums, 6 lanes |
| 15,000 | **Edge City** | Freeway, cloverleaf, lifestyle center, megachurch, stadium |
| 50,000 | **Metroplex** | Stacks, 8 lanes + frontage roads, data center, 5-over-1s |
| 100,000+ | **The Katy** | 26-lane freeway, 5-level stack, the 120-pump Dillo's |

### 5.10 How it ends
- **Sandbox:** it doesn't.
- **Victory: "Paradise Paved."** Cut down the last tree. In the final cinematic, a cell tower disguised as a pine goes up where it stood, with a plaque.
- **Collapse: "The Ponzi Ends."** Go bankrupt and the decline plays out. Roads crumble to gravel, the chains close, the mall dies, and every storefront becomes a Halloween pop-up and then nothing. Then saplings push up through the parking lots and the deer come back. Nature wins. It always does.
- **Scenarios:** maps with specific goals (§7).

### 5.11 Built to be shared
- **Then & Now slider:** your hellscape and the untouched valley, split-screen, from the same camera angle. This is the screenshot everyone posts.
- **Time-lapse:** 50 years of destruction in 30 seconds.
- **"Greetings from ___" postcards:** photo mode with the vintage big-letter postcard frame and your county's name.

### 5.12 Stretch goal: Drive Mode
Climb into a lifted truck and drive your own creation. Sit in your own traffic, rip down the 26-lane freeway, pull into Dillo's. The radio plays parody ads. Made for clips.

---

## 6. Content bible (the fun part)

All brands are fictional parodies.

**Roads & infrastructure.** Center turn lane ("the suicide lane") · frontage roads · Texas U-turns · cloverleafs · 5-level stack · concrete spans · beg-button crosswalks · sidewalk to nowhere · desire paths · bus-stop pole in the dirt · retention pond ("Lake Serenity") · creek in a culvert · concrete river channel · water tower with the county name · frankenpine cell tower · overhead power lines on every street · pole signs that get taller as roads get faster.

**Homes.** Single-wide · double-wide · *Whispering Pines Mobile Home Estates* (pines not included) · holler cabin with junk cars, trampoline, above-ground pool, and burn barrel · tract homes (floor plans: *The Ashford*, *The Beaumont*, *The Carrington*) · **procedural McMansion** (garage-forward, seven rooflines, stone veneer on the front only, one turret) · Modern Farmhouse (white board-and-batten, black windows, GATHER sign) · barndominium · gated golf estates · 5-over-1 "luxury" apartments · build-to-rent community owned by *Blackrack Capital* · golf-cart retirement village · ranchette (5 acres, 1 horse, 1 riding mower) · prepper compound.

**Commerce.**
- **Dillo's.** Armadillo mascot, 120 pumps, 80 toilets, brisket. The world's largest gas station, landmark tier.
- **Possum Pete's Gas-N-Go.** Fried chicken, live bait, fireworks, lottery.
- **Petro Patriot.** A gas station with a flag the size of a football field.
- **SprawlMart Supercenter.** 24/7, 1,200 parking spaces, kills downtowns on contact.
- **Dollar Colonel.** Self-seeding.
- **Home Despot**, **Bullseye**, **BulkCo**, **Tractor Surplus**, and the **Bass Bros. Outdoor Pyramid**.
- **Food:** **Chick-Fil-Eh** (closed Sundays; its drive-thru line counts as a traffic event), **Waffle Hut** (open 24/7/365), **McDougal's**, **Burger Baron**, **Taco Bull**, **Wadda-Burger** (orange-striped A-frame), **Dairy Monarch**, **Cracker Barn** (rocking chairs, peg game), **Applebottom's Neighborhood Grill**, **Olive Yard** ("When you're here, you're parked"), **Golden Trough** buffet, **Krispy Krime**.
- **Strip-mall filler:** vape shop · nail salon · **Mattress Kingdom** (always two, across the intersection from each other, and nobody knows who buys the mattresses) · **EZ Money Title Loans** · **Pawnographer** · tattoo parlor · kratom hut · **Cicada Wireless** · **Lady Liberty Tax** (a guy in a Statue of Liberty costume spinning a sign on the corner) · **Big Bang Fireworks Superstore** · express car wash · self-storage · urgent care · freestanding ER · bail bonds · drive-thru daiquiris · **Specter Halloween**.
- **Car lots:** dealerships with inflatable tube men and giant flags, plus Buy Here Pay Here.

**Industry & extraction.** Logging camp + sawmill · **mountaintop removal** (actually lowers the terrain, dumps the rubble into the valleys, and leaves flat "shovel-ready" land; real reclaimed sites have become golf courses and prisons) · fracking pads (earthquakes, flaming faucets) · oil pumpjacks · refinery with glowing flare stacks · coal plant · quarry → concrete plant (which feeds your spans) · **Amazin' Fulfillment Center** · **AI data center** that drinks the reservoir · crypto mine humming at a pitch only dogs and Earl can hear · hog farm + lagoon · landfill that later becomes a park ("Mount Trashmore") · wind farm (available; residents riot).

**Civic & "services."** Sheriff with a surplus MRAP · **speed trap** (it's a revenue building) · volunteer fire department (fish-fry fundraiser) · high school with portable classrooms and an $80M football stadium · megachurch (arena, coffee bar, the county's second-biggest parking lot) · DMV · a library that becomes a Halloween store · the county's one bus route (hourly, sometimes) · golf course · pocket park (a bench facing six lanes of traffic).

**Landmarks.** The 5-level stack · the 26-lane freeway · Dillo's · the Bass Bros. Pyramid · the megachurch · Friday Night Lights Stadium · the World's Largest *Something* (twine ball, fiberglass muffler man, fork) · a 200-ft roadside cross · a speedway · **a "lifestyle center"**: a fake walkable Main Street surrounded by 3,000 parking spaces, built next to the real walkable Main Street you killed.

**Policies.** Parking Minimums (Black Friday Standard) · Single-Family Only · 1-Acre Minimum Lots · 50-ft Setbacks · Right Turn on Red · Speed Limits Are Suggestions · Speed Traps · Corporate Tax Abatements · Independent Power Grid · Mandatory HOA (lawns must be 100% Kentucky bluegrass) · Burn Barrels Allowed · Year-Round Fireworks · Environmental Review Streamlining · Coal Rolling Permitted *(dial-dependent)*.

**Billboards.**
- HURT IN A WRECK? CALL THE TIRE IRON · 1-800-WRECKED
- HELL IS REAL, right next to ADULT SUPERSTORE · TRUCKERS WELCOME · EXIT 47
- DILLO'S · 212 MILES · HOLD IT
- FIREWORKS NEXT EXIT · BUY 1 GET 6 FREE
- JESUS IS COMING · ALSO: MATTRESS SALE

**News ticker.**
- *County Celebrates 14th Dollar Colonel; Residents Praise "Convenience"*
- *Man Killed Crossing 8-Lane Boulevard to Reach Bus Stop; Police Cite Dark Clothing*
- *Study: Residents Now Spend 3.5 Hours a Day in Car, Report Feeling "Free"*
- *Last Hellbender Salamander Declared Extinct; Commemorative Parking Lot Planned*
- *Chick-Fil-Eh Drive-Thru Line Reaches Neighboring County*
- *Route 9 Widening Complete; Traffic Back to Normal Within 18 Months, Experts Stunned*
- *Subdivision Built in Floodplain Floods for Third Time This Year; Residents Call It "Freak Event"*

**Advisors.**
- **Big Dale**, Roads & Transportation. Has one answer to everything: add a lane.
- **Chad Brokowski**, Economic Development. Lives on "synergy" and "shovel-ready."
- **Deb**, HOA President. Enforces lawn height and opposes apartments, leaf-dropping trees, and "outsiders."
- **Pastor Rick.** Needs more parking. For Easter.
- **Earl.** The old-timer who remembers the valley. He unlocks Honest Mode and is the closest thing the game has to a conscience.
- **Skyler.** The urbanist on a bike who brings charts to every hearing, is right about everything, and gets booed.

**Achievements.** *One More Lane* (widen the same road 5 times) · *Induced* (traffic back to pre-widening levels) · *Burning River* · *Silent Spring* (last songbird gone) · *Lakefront Living* (sell 100 retention-pond lots) · *Spirit of the Season* (10 Halloween pop-ups at once) · *Waffle Hut Is Closed* · *Five Levels Deep* (a 5-level stack at a gravel crossroads) · *Mattress Mystery* (4 mattress stores at one intersection) · *Paradise Paved* (the last tree).

---

## 7. The world

### Starting map: Possum Hollow County (working name)
One valley that holds the whole thesis, about 3 × 3 km:

- **East:** Appalachian ridges and hollers, with old-growth hardwoods, coal seams, trout streams, a long-distance hiking trail along the ridgeline, and the edge of a national forest.
- **West:** flat Texas-style prairie and bottomland, with wildflowers, an aquifer recharge zone, and a bayou.
- **Middle:** the river, its floodplain, family farms, and **Old Main**, a walkable 1890s courthouse-square town that is secretly the most tax-productive land on the map (Honest Mode shows it).
- **Edge:** an interstate connection to the outside world, which is where the money and the cars come from.

### Later scenario maps
1. **Holler County (West Virginia-ish): "Mountaintop Makeover."** Flatten three mountains and put a SprawlMart on the reclaimed site.
2. **Lone Star Sprawl (Houston/DFW-ish): "Everything's Bigger."** A 26-lane freeway, a 5-level stack, the 120-pump Dillo's, and a winter grid freeze to survive.
3. **Pleasant Acres (Midwest): "The HOA Strikes Back."** Turn every farm into cul-de-sacs.
4. **Mirage Mesa (Phoenix/Vegas-ish).** Golf courses and green lawns in the desert until the reservoir runs dry.
5. **Gator Gulch (Florida).** Build on swamp and survive hurricanes, sinkholes, and a golf-cart retirement city.

---

## 8. Art & audio direction (proposed, see Q10)
- **Low-poly diorama.** Clean shapes, a warm palette, soft shadows, optional tilt-shift. It looks like a cozy model railroad, which makes what you build on it funnier and worse.
- **Golden hour** is the hero lighting: sunset over the Waffle Hut.
- **Liminal night mode.** Glowing gas-station canopies, sodium-orange parking lots, an empty 8-lane intersection cycling through its lights at 3 a.m.
- **The world's color follows your choices:** smog pushes it sepia, the river changes color, the stars fade.
- **The signs are the jokes.** Brand signs are generated in code (canvas textures), so a new chain is one line of data.
- **Audio.** The soundscape tracks the valley's health (§5.5). The music starts as porch banjo and fiddle, slides into gas-station muzak, and ends as a Top 40 country station stuffed with parody ads.

---

## 9. How I'd build it

### 9.1 Stack

| Piece | Choice | Why |
|---|---|---|
| Platform | **Browser first** (desktop) | Plays from a link, easy to share. Steam stays possible later via an Electron/Tauri wrapper (Vampire Survivors started as a JavaScript browser game). |
| Language | TypeScript | Types keep a big simulation codebase sane. |
| 3D | three.js (r186) | Mature, fast, huge ecosystem. |
| Build | Vite | Instant reloads, static deploys anywhere. |
| Post-FX | `postprocessing` + N8AO | Ambient occlusion, bloom for night neon, color grading, tilt-shift. |
| UI | Preact over the canvas | Menus, panels, the ticker, the PorchWatch feed. |
| Tests | Vitest + Playwright (headless Chromium) | Unit tests for the sim math, plus screenshot smoke tests that can be checked by eye. |

### 9.2 Architecture

```
src/
  core/     fixed-timestep game loop, seeded RNG, event bus, save/load
  render/   renderer, sky + day/night + stars, post-FX, RTS camera
  world/    terrain (heightmap, river carving, grading), water, vegetation, wildlife
  roads/    road graph (nodes, spline segments, lanes), meshes, intersections,
            bridges/pillars, interchange prefabs, road tools
  land/     parcels, zoning, Plat-o-Matic templates, parking lot generator,
            procedural buildings, signage
  sim/      demand, population, trips, traffic (routing + BPR), economy (the Ponzi),
            environment fields, events & disasters
  content/  DATA ONLY: buildings, brands, roads, policies, ticker lines,
            PorchWatch posts, advisors, achievements
  ui/       HUD, build menus, info panels, overlays, budget, graphs, Then & Now, photo mode
```

- **The sim is separate from the renderer.** The deterministic, seeded simulation ticks on its own, and rendering only reads from it. That's what makes save/load, time-lapse replays, Then & Now (regenerated from the original seed), and later moving the sim into a Web Worker straightforward.
- **Content is data.** A new chain, billboard, or ticker joke is one entry in a file, not new code. Jokes can be written without touching the engine.

### 9.3 The hard parts, and how to keep them from eating the project
1. **Road geometry is the biggest risk.** Skylines-quality intersections are genuinely hard. The plan: spline segments with angle and length snapping, intersections built from trimmed road edges and filled as polygons, pillars and bridges added automatically whenever a road leaves the ground, and interchanges shipped as **prefabs first**. Custom ramp building can come later, if ever.
2. **Traffic at scale.** No per-car physics. Instead, a "mesoscopic" model: trips are routed over the road graph, congestion is computed per segment with the BPR formula, and the visible cars (a few thousand, instanced) ride those speeds. It's cheap, it scales, and induced demand genuinely emerges from it.
3. **Buildings without an art team.** Parametric generators (the McMansion generator is its own joke), low-poly procedural geometry, and canvas-generated signage, all batched into a handful of draw calls.
4. **Nature simulation.** Coarse grids (about 128×128) for tree cover, habitat, runoff and flooding (flow directions come from the terrain), water quality carried downstream, air, heat, and light. Updates are staggered across ticks so they stay cheap.
5. **Performance.** Instanced trees, cars, and buildings; tree LOD; chunked terrain; quality presets. The target is 60 fps on a mid-range laptop with tens of thousands of trees, about 3,000 buildings, and about 3,000 visible cars.

### 9.4 Assets
- **Procedural first.** Terrain, roads, parking lots, buildings, trees, and signs are all generated in code, which means one consistent look, no licensing headaches, and tiny downloads.
- **Optional free CC0 packs** (Kenney, Quaternius) for cars and animals, if the procedural versions don't cut it.
- **Fonts** under the OFL (Google Fonts). Parody names only, no real logos.

### 9.5 Playing the builds
Every milestone ends with something playable in a browser. Delivery options are in Q14.

---

## 10. Roadmap (every milestone is playable)

| # | Milestone | What you can do |
|---|---|---|
| M0 | **Pre-production** (now) | Read this, answer the questions, lock v1.0. |
| M1 | **Paradise** | Fly around a gorgeous procedural valley (terrain, river, forests, mist, day/night, stars, birdsong) and clear-cut it for cash. |
| M2 | **First Stroad** | Draw curved roads (dirt → 2-lane → 4-lane stroad) with automatic intersections, grading, and bridges, and press **One More Lane**. |
| M3 | **First Gas Station** (vertical slice) | Plop about 10 buildings (gas station, drive-thru, Dollar Colonel, trailer, tract home, McMansion, SprawlMart and its parking lot), then watch cars drive, money go up, nature go down, and the news ticker roll. *This is the first "oh, it's a game" moment.* |
| M4 | **The Sprawl Engine** | Population and trips, real congestion and induced demand, the Plat-o-Matic, strip zoning, the Growth Ponzi budget, unlock tiers, overlays, PorchWatch, save/load. |
| M5 | **Nature Fights Back** | Floods, wildlife fragmentation, smog, heat and light pollution, disasters, the Waffle Hut Index, Honest Mode. |
| M6 | **Everything's Bigger** | Freeways, frontage roads, Texas U-turns, prefab interchanges up to the 5-level stack, landmarks, policies. |
| M7 | **Polish & Share** | Then & Now, time-lapse, postcard photo mode, full audio and music, a tutorial ("Orientation with Chad"), achievements, a performance pass. |
| M8+ | **Scenarios & Drive Mode** | Regional maps with goals, and driving your lifted truck through your own traffic. |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Road and intersection geometry eats months | Snapping constraints, prefab interchanges, ship "good enough" and iterate. |
| Traffic sim too slow or too fake | Mesoscopic BPR model, visible cars are a sample, Web Worker later. |
| Procedural art looks cheap or inconsistent | A strict palette and style guide; lighting and post-FX do the heavy lifting; hero buildings get hand-tuned. |
| Satire comes off preachy or mean | The tone rules in §3: the game is a true believer. Playtest with friends. |
| Scope creep (this doc is already huge) | Every milestone is a playable slice, and we keep a cut list. |
| IP | Fictional brands only, no real logos or people, CC0/OFL assets. If this heads to Steam, re-check how close each parody name sits to the original. |

---

## 12. Open questions
Proposed defaults are in **bold**. Answers get recorded here.

**Vibe**
1. **Tone.** (a) Deadpan propaganda: the game sincerely loves sprawl, Fallout/Helldivers style. (b) King of the Hill: affectionate, laughing with it. (c) Straight urbanist critique. (d) Pure meme chaos. → **(a), with the real urban-planning math running underneath.**
2. **Culture-war dial, 1–5.** 1 = only cars, developers, and chains. 5 = coal rolling, truck nuts, "15-minute cities are communism," windmill cancer, flags on everything. Any hard no's (real politicians, religion, guns, parody names that are too close)? → **3. No real people or logos. The megachurch and the gun shop are fine as scenery.**

**Gameplay**
3. **Depth.** Chill and compact (Islanders, Mini Motorways), mid (SimCity 4), or full Cities: Skylines? → **Mid, built so it can go deeper.**
4. **What makes it hard?** Pick any: the growth Ponzi, opposition (hearings, lawsuits, the EPA), self-inflicted disasters, contradictory residents. → **All four, with the Ponzi as the spine.**
5. **Endings.** Sandbox only, win by paving the last tree, a collapse where nature takes it back, or scenario goals? → **All of them.**
6. **How you build.** Zone painting, plopping individual buildings, or the Plat-o-Matic (draw a boundary, get a whole subdivision)? → **All three, depending on building type.**
7. **Roads.** Freeform curves with drop-in prefab interchanges, or build-your-own ramps like Skylines (a lot more work)? → **Freeform plus prefabs. Custom ramps later if you want them.**
8. **Map.** One mixed valley (Appalachian ridges, Texas flats, a river, an old downtown), or separate regional maps from day one? A new random map each game, or one handmade map? → **One mixed valley with a random seed each game and a hand-picked default seed. Regional maps later.**
9. **Residents.** Faceless traffic, or clickable households with names plus the PorchWatch feed? → **Clickable, plus PorchWatch.**

**Look & feel**
10. **Art style.** (a) Low-poly diorama, (b) semi-realistic like Skylines, (c) PS1/liminal, (d) voxel. → **(a), plus a liminal night mode.**
11. **Drive Mode** later on? → **Yes, as a stretch goal.**

**Practical**
12. **Platform and devices.** A browser game or a downloadable engine (Godot/Unity)? Do you play on a PC/Mac with a mouse, or does it need to work on a phone? → **Browser, desktop mouse and keyboard first.**
13. **Goal.** Fun for you and your friends, viral clips, or eventually selling it? → **Friends and clips, kept IP-safe so selling stays on the table.**
14. **Playtesting.** A private claude.ai link for each build (zero setup), Vercel, or GitHub Pages? → **Private claude.ai links for now, Vercel once it's worth showing people.**
15. **Must-haves.** The top 5 things you'd be bummed not to see? Any real places to channel (the stroad you hate most, your hometown), or parody brands you want to name yourself? → *(open)*
