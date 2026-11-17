# SLOPMERICA: Full Project Evaluation & AAA "Fun First" Dev Team Roadmap

**Evaluated Date:** 2026-11-17  
**Repository:** `burnzzzstock-ops/Slopmerica`  
**Evaluated Branches:** `origin/codex/aaa-world` (`9fd06ea`), `origin/claude/aaa-play` (`9b3f161`), `origin/aaa/integration` (`332a155`)  
**Codebase Scale:** ~58,000+ LOC TypeScript, Three.js r186, Vite 8, zero UI framework, procedural WebAudio, 83-component Civic Foundry PBR library (`public/civic`), 4,000-model satirical Asset Vault (`public/vault`), and 185 registered automated Playwright/Node checks.

---

## 1. Executive Verdict: Where SLOPMERICA Stands Today

**SLOPMERICA** already has a better premise, sharper satirical voice, and more ambitious technical foundation than 95% of indie city builders. Building a full 3D procedural city simulator with spline roads, actuated traffic signals, multi-source Dijkstra service coverage, conserved truck freight, 4,000 packed satirical buildings, procedural WebAudio Doppler street sound, and a single-file offline bundle in ~58k lines of vanilla TypeScript is a massive achievement.

### What Is Already AAA-Grade
1. **The Satirical World & Asset Density:** The 4,000-model Asset Vault (`src/vault/`), parody brand bible (*Dillo's*, *SprawlMart*, *Chick-Fil-Eh*, *Waffle Hut*, *Dollar Colonel*, *SLOP*), and procedural signage system (`src/art/`) give the game an unmistakable identity.
2. **Title Screen & Onboarding Aesthetic:** The title flow (`src/ui/title.ts`) with bundled display fonts (`Yellowtail`, `Bungee`, `Anton`, `Overpass`) and the SLOP palette (`#c6f432` lime, `#efe6cf` cream, `#111111` ink, `#b3202a` Cannon red) looks like a shipped commercial game.
3. **Micro-Simulation Depth:** Cars run IDM car-following with cubic junction paths, leading-green left turns, drive-thru queue spillbacks onto stroads (`traffic.ts:1434`), and crosswalk yielding (`pedestrians.ts`).
4. **Engineering Rigor & Test Harness:** The two-agent split (`ASTRA` on `codex/aaa-world` and `FABLE` on `claude/aaa-play` merging through `aaa/integration`) has already solved the Windows harness bugs, established RTX 5090 hardware benchmarks (`docs/aaa/PERF.md`), shipped smooth cursor-zoom easing, 4K county postcards, fixed 102,284 unpacked civic normal vectors, and created 115 drawn HUD icons (`src/art/hudIcons.ts`).

---

## 2. Visual & Gameplay Diagnosis (From Code + Multimodal Inspection)

By inspecting the actual source code alongside the latest rendered contact sheets (`docs/aaa/figures/camera-high.jpg`, `civic-low.jpg`, `hud-icons.png`, `desk-tour.jpg`, and `phone-tour.jpg`), seven core gaps currently hold SLOPMERICA back from feeling **AAA** and **effortlessly fun**:

### A. Visual Gaps (What Still Reads "Procedural Prototype" Instead of "AAA Diorama")
1. **The Forest "Leopard Print" (`camera-high.jpg`):**
   - In overview shots (`src/world/trees.ts`, `src/world/terrain.ts`), dark tree impostor blobs sit on top of bright, sunlit lime-green grass (`#5d8d3b`). Because there is no canopy density shadow or dark mossy forest-floor understory beneath tree stands, forested ridges read like polka-dot stickers on a golf course.
2. **4-Meter Jagged Lot Borders (`civic-low.jpg`):**
   - Terrain ground paint (`src/world/terrain.ts`) is stored per vertex on a 4 m grid. Around zoned lots and blocks, the transition between dry dirt/lot pad and grass forms harsh 4 m stair-stepped sawtooth edges.
3. **Monolithic Slab High-Rises Next to Tiny Shops (`civic-low.jpg`):**
   - High-density buildings (`src/buildings/resHigh.ts`, `office.ts`, `comHigh.ts`) extrude straight up as flat-topped rectangular prisms with uniform `roughness: 0.84` (`src/buildings/material.ts:44`), no podium setbacks, no cornices/crowns, and no ground-floor storefront rhythm.
4. **White Wireframe Box Construction (`desk-tour.jpg #28`, `phone-tour.jpg #23`):**
   - Growing buildings (`src/sim/buildings.ts:356-366`) render as white/gray squashed boxes wrapped in a stretched wireframe grid. In a city builder where you spend 80% of your time watching lots develop, construction needs to look tactile (rising floor slabs, cranes, scaffolding, dust puffs).
5. **16px HUD Icon Mud (`hud-icons.png`):**
   - While ASTRA's new 115-icon sticker set (`src/art/hudIcons.ts`) is a huge upgrade over OS emoji, icons with dense interior linework (`stroad6`, `stroad8`, `grid`, `resHigh`, `comHigh`, `server`, `music`, `building`) merge into indistinct blobs at the 16 px size, and too many unrelated tools share the identical `#c6f432` lime fill instead of semantic color coding (R/C/I/O hues, utility colors, warning reds).

### B. Mobile & UI Ergonomics Gaps (`phone-tour.jpg`)
6. **55%+ Vertical Screen Occlusion on Phones:**
   - On the owner's primary platform (390×844 phone), the persistent `"Step 5/5 Check the money"` guide bar stacks *on top of* the active tool drawer (`ROADS`, `ZONING`, `SERVICES`, `INSPECTOR`) *on top of* the bottom navigation bar. Combined with the top status bar and X-feed toast, **over half the screen is covered by dark UI boxes**, leaving almost no room to drag roads or admire the city.
7. **Opaque Pastel Zone Slabs (`desk-tour.jpg #17`):**
   - Painted zones (`src/zones/zoning.ts`) draw opaque pastel slabs over the ground that obscure terrain contours and road edges.

### C. The "Fun & Satire Loop" Gaps (`GAME_DESIGN.md` vs. Code)
8. **The Best Jokes in `GAME_DESIGN.md` Aren't Interactive Verbs Yet:**
   - **No Plat-o-Matic™ (`GAME_DESIGN.md §5.2`):** Players currently have to hand-draw every street and paint S/M/L zone brushes. Letting players drag a box to stamp an instant *Cul-de-Sac Gardens* or *Loops & Lollipops* subdivision (complete with a fake "Lake Serenity" retention pond and 40 tract homes named after the trees they just killed) is a 10× fun multiplier.
   - **No "Old Main" Anchor (`GAME_DESIGN.md §7`):** You currently start on a bare highway stub (`seedRoad`). Starting with a tiny, charming, walkable 1890s courthouse square (`Old Main`) that pays high tax-per-acre—and watching your bypass *SprawlMart* slowly board up its windows and turn it into a *Specter Halloween*—gives the player an emotional & comedic anchor from minute one.
   - **The Growth Ponzi & Induced Demand Are Invisible:** Road upkeep steps up at year 1 and 4 (`roads/network.ts`), and widening secretly resets road age, but the player never *sees* the 25-year maintenance cliff approaching, never sees roads cracking into potholes, and never gets the satirical high of hitting **ONE MORE LANE** to get an 80% federal bailout grant that temporarily fixes traffic before induced demand clogs it again.
   - **Silent World Events:** `WorldEvents` are typed in `src/contracts.ts`, but **zero events are emitted yet** (`LOG_FABLE.md` line 104). That means building completions, demolitions, zoning strokes, level-ups, and cash ticks lack the juicy 100 ms audio-visual pop that makes a city builder addictive.

---

## 3. Top 10 High-Impact Initiatives to Make SLOPMERICA AAA & Unputdownable

### Pillar 1: "The Toybox Feel" — Buttery, Juicy 100ms Building Feedback
1. **Tactile Road & Zone Drawing:**
   - As you drag a road spline, play subtle distance-tick clicks pitched up by length, show live tree-clear count + lumber cash payout (`+$420 Clear-Cut Bonus!`) right on the cursor ghost, and trigger a directional dust cloud + chainsaw bark + bass thud on placement.
   - When painting zones, play an ascending pentatonic marimba/synth arpeggio (`zone` SFX per lot cell) with a springy border outline instead of opaque slabs.
2. **"ONE MORE LANE" as the Ultimate Dopamine Button:**
   - Give the **One More Lane** button a hazard-striped, oversized arcade button treatment in the road inspector and toolbar.
   - Pressing it triggers: (a) a construction rumble & screen micro-shake, (b) a `"🏛️ 80% FEDERAL HIGHWAY GRANT APPROVED"` stamp, (c) a live **Corridor Speed Boost** where queued cars surge forward, and (d) an in-inspector **"Induced Demand Timer"** chart showing volume creeping right back to 100% over the next 18 game-months.
3. **Real 3D Construction & Demolition Set Pieces:**
   - Replace the Y-squash box (`src/sim/buildings.ts:356`) with shader clip-plane vertical reveals, rising concrete floor slabs, rotating tower cranes on level 3–5 buildings, and a celebratory completion pop + confetti/dust ring.

### Pillar 2: Signature Satirical Mechanics You Can See and Touch
4. **The Plat-o-Matic™ Subdivision Stamp Tool:**
   - Add a 5th mode to the Roads/Zones drawer: **Plat-o-Matic™**. Drag a rectangle over forest or farmland to preview and stamp a instant cul-de-sac or lollipop loop subdivision, automatically naming it after what it destroyed (*"Whispering Oaks Estates — 0 Oaks Remaining"*).
5. **Visible Growth Ponzi & "Cousin Dale's Paving LLC":**
   - Connect `fields.roadCondition(segId)` to visible asphalt cracks, alligator patching, and potholes on aging roads, plus suspension rattle in `streetAudio.ts`.
   - Add the **Unfunded Liabilities** ticker to the Budget panel: show the 20-year maintenance wave marching toward the treasury, and offer shady short-term fixes (*Tax Abatement for Amazin'*, *Cousin Dale's No-Bid Repaving*, *Federal Widening Loophole*).
6. **Earl's "Honest Mode" Toggle & The Waffle Hut Index:**
   - Add a single live toggle in the top bar (unlocked after Earl's first public hearing) that flips every euphemism in the DOM and overlays (*"Unactivated Land" ↔ "Old-Growth Forest"*, *"Growth" ↔ "Unfunded Liabilities"*, *"Quality Time in Your Truck™" ↔ "Commute Time"*), paired with the **Value-Per-Acre** 3D bar overlay.
   - During storms, hurricanes, grid freezes, and floods, pop the **Waffle Hut Index** badge (`GREEN: Full Menu` → `YELLOW: Limited Menu` → `RED: Waffle Hut Closed — Seek Shelter`) into the HUD header.

### Pillar 3: AAA Diorama Visuals & Phone-First Polish
7. **Kill the Forest Leopard Print & 4m Lot Jaggies:**
   - Bake a low-res canopy density mask (`src/world/trees.ts`) into the terrain shader (`src/world/terrain.ts`) so ground under forests renders as dark mossy forest floor with canopy AO, and blend lot edges with a sub-texel distance field or world-space macro noise so 4 m vertex steps disappear.
8. **Podium + Shaft + Crown Skylines & Weathering:**
   - Give `resHigh`, `comHigh`, and `office` generators setbacks, distinct podium storefronts, rooftop HVAC/water-tank clutter, and seeded night crown lighting, backed by a per-tile roughness/normal detail sheet so glass reflects the sky while brick and concrete stay matte.
9. **Phone-First Collapsible HUD Chrome:**
   - Auto-collapse the bottom drawer into a slim pill when dragging on the canvas, merge the `"Next Step"` tutorial prompt into a compact collapsible header pill, and move debug weather chips behind `#playtest` so phone players get **80%+ unobstructed 3D viewport area**.

### Pillar 4: Living Soundscape & Playable "Drive Mode"
10. **Adaptive Radio Arc + Street-Level "Drive Mode":**
    - Evolve the music from the existing felt piano (`src/audio/piano.ts`) → porch banjo/fiddle → 16-bit gas-station muzak → Top-40 country synth with between-song parody radio spots (*"Hurt in a wreck on Freedom Stroad? Call The Tire Iron!"*).
    - Turn ASTRA's new `rts.follow(ViewTarget)` chase camera (`src/render/camera.ts`) into a playable **Drive / Ride-Along Mode**: click any car (or spawn your own Commissioner's Lifted Truck / Cyberslop) to ride bumper-level through your 8-lane stroad traffic while the radio plays.

---

## 4. How the 3-Agent Team Divides the Push

To move fast without merge collisions, the team operates in three specialized lanes merging through `aaa/integration`:

| Agent | Environment & Branch | Ports | Core Superpower & Ownership |
|---|---|---|---|
| **ASTRA (GPT / Codex)** | `codex/aaa-world` | `5190–5199` | **3D World, Shaders, Rendering Pipeline, Performance Budgets & Procedural WebAudio.** Owns `src/render/*`, `src/world/*` (except `maps.ts`), `src/buildings/*`, `src/art/*`, `src/vault/*`, `src/civic/*`, `src/agents/{vehicles,people,models,ambient}`, `src/audio/*`, `src/roads/{roadMesh,roadSection,streetDetails}`. |
| **FABLE (Claude Code)** | `claude/aaa-play` & `aaa/integration` | `5180–5189` | **Simulation Determinism, Satire Mechanics, Traffic AI, UI/HUD & Test Harness.** Owns `src/sim/*`, `src/zones/*`, `src/transit/*`, `src/tools/*`, `src/ui/*`, `src/style.css`, `src/content/*`, `src/agents/{traffic,parking,pedestrians,communes}`, `src/roads/{network,roadJunction,roadTypes}`, and `aaa/integration`. |
| **ORION / STUDIO DIRECTOR (Antigravity / Gemini)** | `agy/aaa-director` (or cross-branch studio) | `5170–5179` | **Multimodal Audio/Visual QA, Bespoke 2D Art Generation (`image-generator`), Live Interactive Browser Playtesting (`@browser`), Drive Mode & Cross-Branch Integration.** Listens to rendered `.wav` mixes natively, inspects golden screenshots visually, generates custom raster/sticker art assets, live-playtests phone/desktop UX in a real browser, and bridges seams between ASTRA and FABLE. |

See the individual handoff documents for each agent's exact queue:
- [HANDOFF_ASTRA_GPT.md](./HANDOFF_ASTRA_GPT.md)
- [HANDOFF_FABLE_CLAUDE.md](./HANDOFF_FABLE_CLAUDE.md)
- [HANDOFF_ANTIGRAVITY_GEMINI.md](./HANDOFF_ANTIGRAVITY_GEMINI.md)
