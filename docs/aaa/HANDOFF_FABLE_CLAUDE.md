# Handoff for Claude FABLE (`claude/aaa-play` & `aaa/integration`)

**Role:** Simulation, Determinism, Satire Mechanics, Traffic AI, UI/HUD, Writing & Integration Lead  
**Branches:** `claude/aaa-play` (worktree) and `aaa/integration` (integration branch you own)  
**Assigned Ports:** `5180–5189` (up to 4 headless browser slots)  
**Current HEAD Reviewed:** `9b3f161` (*Docs: the log, the requests and the first proposed numbers*)

---

## 1. What You Have Landed So Far (Verified)

Your Phase 0 foundation work through `9b3f161` has unblocked the entire Windows/RTX 5090 pipeline:
- **Windows Harness & GPU Test Runner (`2238295` → `332a155`):** `.gitattributes`, `scripts/lib/browser.mjs` (156 launch sites migrated), `slots.mjs`, `proc.mjs`, `snapshot.mjs` junction support, `ws: false` for parallel Node rigs, and the split JSON test registry (`scripts/tests/{fable,astra,shared}.json`) with `--gpu` running smoke in 131 s vs 370 s.
- **Committed Reference Town (`10c8b8e`):** `scripts/fixtures/refblock-town.json` is locked and deterministic.
- **Live Contracts & `game.fields` (`1743bb1`, `944d79a`, `effaa9e`):** `WorldEvents`, `WorldFields`, `ScalarField`, and `ViewTarget` are live in `src/contracts.ts` and `src/sim/fields.ts`, verified by `scripts/contracttest.mjs`.
- **Deep Determinism Audit (`LOG_FABLE.md`):** Your 10-point inventory of why saves and frame rates diverge (renumbered building IDs breaking freight stock, frame-dependent traffic spawns/T-bone checks, unsaved weather state, camera-distance pedestrian spawning holding cars, `setTimeout` commune blockers, and 116 sim-scope `Math.random()` calls) is spot-on.

---

## 2. Multimodal UI & Gameplay Findings From Your Screenshots (Fix These in Phase 0–2)

Our multimodal review agent (`ORION / Antigravity`) visually inspected `docs/screenshots/round8/audit/phone-tour.jpg` and `desk-tour.jpg` alongside your code:

### Finding A: 55%+ Vertical Screen Occlusion on Phones (`phone-tour.jpg` Panels 16–23)
- Look at `16-panel_roads`, `17-panel_zones`, `18-panel_ext_services`, `19-panel_views`, and `23-inspect_building` in `phone-tour.jpg`:
  - The top status bar + X-feed toast take the top ~15% of the 390×844 screen.
  - At the bottom, the `"Step 5/5 Check the money"` tutorial card sits *above* the open drawer (`ROADS` / `ZONING` / `SERVICES` / `VIEWS` / `INSPECTOR`), which sits *above* the bottom toolbar.
  - Together, **more than 55% of the vertical phone screen is covered by dark UI chrome**, leaving a tiny horizontal slit in the middle to actually see or touch the 3D city!
- **Exact Fix (`U1` & `U4` — `src/ui/hud.ts`, `src/style.css`):**
  1. **Auto-dismiss Step 5/5** as soon as the player opens Budget or reaches day 15, and collapse the active tutorial prompt into a single compact 36 px top-or-bottom pill when any drawer is open (never stack the full tutorial card + an open drawer simultaneously on `< 640px` viewports!).
  2. **Auto-collapse drawers on canvas drag:** When the player starts drawing a road or painting a zone on touch, smoothly slide the tool drawer down to a mini header bar (`Done` / `Undo` / cost badge only) so 85% of the screen is open 3D world.
  3. **Hide dev weather chips (`clear`, `rain`, `storm`, `snow`, `fog`, `heatwave`)** inside `INFO VIEWS` (`phone-tour.jpg #19`, `desk-tour.jpg #22`) unless `#playtest` or `#debug` is in the URL (`F0.6`).

### Finding B: ASTRA Has Shipped 4 Major Features Waiting on Your HUD Wiring (`REQUESTS_ASTRA.md`)
ASTRA (`codex/aaa-world` @ `9fd06ea`) has already built and tested these APIs—they are invisible to the player until you wire them into `src/ui/hud.ts`:
1. **115 Drawn HUD Icons (`src/art/hudIcons.ts`):**
   - Replace the raw emoji in the toolbar, drawers, More grid, and inspector status rows (`⚡✓ 🚰✓`) by calling `hudIcon(controlId, size)` / `HUD_CONTROLS`.
2. **Follow-Cam Button in Inspector (`g.rts.follow(ViewTarget)`):**
   - Add a **🎥 Follow** button to the Car, Citizen, and Bus inspector cards calling `g.rts.follow({ kind: 'car' | 'person', id })`, plus a floating `"Following [Name] — Esc / Tap to release"` pill when `g.rts.following` is non-null.
3. **Photo Mode & 4K County Postcards (`g.photo.*`):**
   - Add a **📷 Postcard / Photo Mode** button (in the top bar / More menu) that calls `g.photo.enter()`, with clean controls for Street View (`g.photo.street()`), Hour (`hour`), Weather (`weather`), Tilt-Shift (`tilt`, `focusDistance`), `"Greetings from [County]"` frame toggle, and Download (`g.photo.download(framed)` or `4K`).
4. **Content Audit Scanner SVG Path Skip (`scripts/contentaudit.mjs`):**
   - Skip `src/art/hudIcons.ts` SVG path literals (`M... L... C...`) when enumerating strings in `contentaudit.mjs` so those 174 vector paths aren't flagged as prose.

---

## 3. Making the Game 10× More Fun: The Core Satirical Mechanics to Prioritize

Beyond determinism and bug fixes, the owner wants SLOPMERICA to be **genuinely fun and hilarious to play**. Prioritize these gameplay loops in Phase 1–2:

1. **Emit All 12 `WorldEvents` Immediately (`src/contracts.ts`):**
   - Right now `game.sim.events` emits **none** of the new `WorldEvents` (`construction`, `demolished`, `levelUp`, `disaster`, `flood`, `fireFront`, `crash`, `moneyTick`, `zonePainted`, `roadBuilt`, `laneAdded`, `treesCleared`, `collapseStage`, `paradisePaved`).
   - Wire these first! Every road built, tree clear-cut (`+$Lumber Payout!`), zone stroke, and building level-up needs to fire its event so ASTRA's positional audio and particle VFX give the player instant <100 ms tactile juice.
2. **Make "ONE MORE LANE" & Induced Demand a Playable Dopamine Loop (`F1`):**
   - When the player clicks **One More Lane**, pop a celebratory Chamber-of-Commerce stamp (`"80% FEDERAL GRANT! MAINTENANCE CLOCK RESET!"`), immediately boost corridor capacity, and track the corridor's pre-widening volume.
   - Add a miniature **Before / After Volume Sparkline** right inside the Road Inspector showing traffic dropping and then climbing back to 100% over 18 game-months via your mesoscopic BPR trip layer, firing the `"Route X widening complete; traffic back to normal, experts stunned"` feed event when it saturates.
3. **The Plat-o-Matic™ Subdivision Stamper (`GAME_DESIGN.md §5.2`):**
   - In `src/tools/gridRoads.ts` / `tools.ts`, add a **Subdivision Template** mode alongside `Grid`: let the player drag a box to auto-layout a *Cul-de-Sac Loops* or *Suburban Pod* road + residential zone + corner retention pond in one gesture, auto-named after the trees cleared (*"Bulldozed Pine Estates"*).
4. **Earl's "Honest Mode" Dictionary Toggle (`F8` — Quick Win, Huge Payoff):**
   - Build a clean translation table in `src/ui/copy.ts` (`Unactivated Land` ↔ `Old-growth forest`, `Growth` ↔ `Unfunded liabilities`, `Freedom Stroad` ↔ `High-speed commercial strip`, `Quality Time in Your Truck™` ↔ `Time stuck in traffic`, `Lakefront Lot` ↔ `Stormwater retention pond`).
   - Add an **Honest Mode (👓 Earl's Glasses)** toggle in the top bar / Settings so players can flip the entire UI between shameless Chamber-of-Commerce propaganda and brutal urbanist truth at any time.
5. **The Growth Ponzi Liability Wave & Value-Per-Acre (`F2`):**
   - Expose `valuePerAcre` and `roadCondition` in `game.fields.fieldFor(...)`.
   - In the Budget sheet, show the **20-Year Unfunded Infrastructure Liability** curve and let desperate commissioners sign **Cousin Dale's Paving LLC** (50% cheaper today, crumbles 3× faster) or grant **20-Year Corporate Tax Abatements** for short-term impact fees.
6. **The Waffle Hut Index & Self-Inflicted Disasters (`F4`):**
   - Tie flash floods directly to `rain × upstream impervious pavement` (`zones` + `buildings` + `roads`) and wildfire risk to subdivisions built into dense forest (`WUI`).
   - Display the **Waffle Hut Index** (`🟢 GREEN: Full Menu` / `🟡 YELLOW: Limited Menu` / `🔴 RED: CLOSED`) in the HUD whenever a disaster hits.

---

## 4. Your Prioritized Execution Queue (Next 10 Milestones)

1. **`Merge:`** Merge `origin/codex/aaa-world` (`9fd06ea`) and `claude/aaa-play` (`9b3f161`) into `aaa/integration`, run `npm run gate` and `npm run smoke:gpu`, and push `aaa/integration`.
2. **`Events:`** Emit all 12 `WorldEvents` across `sim.ts`, `buildings.ts`, `tools.ts`, `network.ts`, `traffic.ts`, and `disasters.ts`; verify with `scripts/contracttest.mjs`.
3. **`Determinism (F0.3 & F0.4):`** Fixed simulation timestep in `game.ts` (with `alpha` passed to `vehicles`/`people`), seeded `Rng` streams per subsystem (replacing all 116 sim-scope `Math.random()` calls), stable building IDs across save/load (`Bld.born` preserved for ASTRA's weathering), camera-independent pedestrian sim cap, and `scripts/determinism.mjs` passing across 30 fps / 144 fps / stepped / save-reload.
4. **`Saves & Prod Gate (F0.5 & F0.6):`** Versioned save migrations (`v1 -> v2`), 5 named save slots + overwrite confirmation, and gating `__dbg` + dev furniture (weather chips in Info Views, Playtest badge) behind `#playtest` / `#debug`.
5. **`UI Seam Wiring (ASTRA Requests):`** Wire `src/art/hudIcons.ts` into the HUD, add the Inspector **Follow** button (`g.rts.follow`), wire the **Postcard / Photo Mode** UI (`g.photo`), and exclude SVG paths in `scripts/contentaudit.mjs`.
6. **`Phone HUD Ergonomics (U1 & U4):`** Fix the 55% phone screen occlusion (auto-collapse drawers while dragging on the canvas, compact tutorial pill, CSS Grid layout cleanup with 12–13 px font floor).
7. **`Honest Mode & Statistics Charts (F8 & U2):`** Ship Earl's Honest Mode toggle + the Skylines-2 Statistics & 10-Year Liability Forecast SVG/Canvas charts + Info View legends & hover probes.
8. **`Traffic Meso Layer, Induced Demand & American Roads (F1 & F5):`** Mesoscopic BPR trip matrix scaling past 20k population, stop signs/priority by road class, center-turn-lane mid-block left waits, emergency vehicles running reds, and the Road Inspector Induced Demand before/after chart.
9. **`The Growth Ponzi, Parking Minimums & Self-Inflicted Floods (F2, F4, F6):`** Road decay + repaving, Cousin Dale's contracts, `valuePerAcre` field, Black Friday parking lot overflow, impervious runoff flash floods, and the Waffle Hut Index.
10. **`Citizens, Hearings, Endings & Feed Expansion (F3, F7, C1–C3):`** Named household cohorts (`The Dwyers`) with contradictory demands, short public hearing cards, staged Ponzi Collapse / Paradise Paved endings, and expanded feed pools.
