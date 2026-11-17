# Handoff for GPT ASTRA (`codex/aaa-world`)

**Role:** World, Shaders, 3D Assets, Camera & Procedural Audio Lead  
**Branch:** `codex/aaa-world` (merge `origin/aaa/integration` before every push)  
**Assigned Ports:** `5190–5199` (up to 4 headless browser slots)  
**Current HEAD Reviewed:** `9fd06ea` (*Photo: refresh water mirrors before direct high-resolution exports*)

---

## 1. What You Have Landed So Far (Verified)

Your work through `9fd06ea` is strong and clean:
- **Live Preset Switching (`694752c`):** Fixed the inverted phone benchmark and made `PostFX` toggleable without reloading.
- **RTX 5090 Hardware Benchmarks & Budgets (`d6f20c8`):** `docs/aaa/PERF.md`, `scripts/look/gpu.mjs`, `phone.mjs`, and `budget.mjs` are live and enforcing draw-call/triangle ceilings.
- **Low Civic Layer (`08ed4a7`) & Civic Normal Stride Fix (`6a660ed`):** Fixed 102,284 broken normal vectors (`stride 4` vs `stride 3`) and brought LOD2 street furniture + bus shelters to Low within the 12-camera budget.
- **Camera Easing, Follow-Cam & 4K Postcards (`931cffb`, `5c3842c`, `9fd06ea`):** Cursor-zoom drift dropped from 78.8 px to 0.26 px; `rts.follow(ViewTarget)` works smoothly; 4K postcards refresh water mirrors prior to capture.
- **Citizen FOV LOD (`d3ca717`) & Night Lamp Pools (`W15.md`):** Citizen `updateLod` now scales by FOV, and vehicle/civic shaders take sodium lamp pools.
- **Drawn HUD Icon Library (`87313bc`):** 115 icons mapped to 158 control IDs in `src/art/hudIcons.ts`.

---

## 2. Multimodal Visual Critique of Your Latest Contact Sheets (Fix These Next)

Our multimodal review agent (`ORION / Antigravity`) visually inspected your committed contact sheets (`docs/aaa/figures/camera-high.jpg`, `civic-low.jpg`, and `docs/screenshots/aaa/hud-icons.png`). Metrics alone missed four visual issues that you should address in your next commits:

### Issue A: The Forest "Leopard Print" Still Dominates Overviews (`camera-high.jpg`)
- In `LOG_ASTRA.md` you noted your first forest trial reduced numerical contrast but made tree crowns look pale and flat, so you parked it.
- **Why it looked flat:** Lowering crown contrast washes out the trees. Instead, **keep tree crown contrast rich and darken the terrain underneath the forest!**
- **Exact Fix (`W1` — `src/world/trees.ts`, `src/world/terrain.ts`):**
  1. Bake a `256×256` or `512×512` `R8` canopy-density texture from the live tree arrays (and update dirty cells on `treesCleared` / `trees.resettle`).
  2. In `terrain.ts`'s fragment shader, sample canopy density to blend the bright `#5d8d3b` lawn grass toward a dark, cool-warm mottled **pine-needle / moss understory** (`~35–45%` darker luma, lower saturation) and multiply ambient light by `mix(1.0, 0.52, canopyDensity)` (fake canopy AO).
  3. Slightly widen far-impostor billboards (`1.12×` to `1.22×` width with distance) with alpha-dithered skirts so adjacent crowns overlap into continuous ridgeline masses instead of isolated dots.

### Issue B: 4-Meter Stair-Step Lot Borders & Extruded Sidewalk Walls (`civic-low.jpg`)
- In `docs/aaa/figures/civic-low.jpg`, the unbuilt inner block shows harsh **4-meter sawtooth stair-steps** where per-vertex dry-dirt paint meets green grass, and the foreground street's sidewalk bank drops like a concrete retaining wall.
- **Exact Fix (`W5` & `W7` — `src/world/terrain.ts`, `src/roads/roadSection.ts`, `src/roads/roadMesh.ts`):**
  1. Perturb the vertex-paint weight interpolation in the terrain fragment shader with world-space 2D simplex/value noise (`freq ~0.18/m` + `0.65/m`) so 4 m vertex grid edges break up into organic grass/soil transitions.
  2. Soften `GROUND_BELOW` / `VERGE_RUN` / `bankFoot` in `roadSection.ts` and blend vertex normals at the skirt foot so sidewalks sit naturally in the ground rather than towering like walls.
  3. Unify junction hull asphalt (`roadMesh.ts:560`) with the approach road segments using world-space UV wear projection so intersections stop reading as darker octagonal patches.

### Issue C: Monolithic Flat-Top Slab Towers (`civic-low.jpg` Left Edge)
- Look at the tall tower on the left of `civic-low.jpg`: it is an unbroken vertical gray box with repeating window bands and a flat roof sitting right next to a 1-story brick storefront.
- **Exact Fix (`W3` & `W4` — `src/buildings/resHigh.ts`, `comHigh.ts`, `office.ts`, `material.ts`):**
  1. Enforce a **2–3 story podium base** (wider footprint, storefront/brick material, cornice lip) + **stepped shaft setback** (`0.75–0.85×` footprint above floor 3) + **distinct roof crown** (parapet, mechanical penthouse, water tank, or lit spandrel crown).
  2. Pack a **roughness/metalness/AO channel** per atlas tile class (`src/buildings/material.ts`) so window glass (`roughness ~0.12`, sky reflection fresnel) contrasts sharply against matte brick (`roughness ~0.88`) and vertical world-space grime darkens the bottom 4 m of facades.

### Issue D: 16px HUD Icon Line Density & Semantic Grouping (`src/art/hudIcons.ts`)
- Visually inspecting `docs/screenshots/aaa/hud-icons.png` shows that at `16×16`, icons with 4+ parallel interior strokes (`stroad6`, `stroad8`, `grid`, `resHigh`, `comHigh`, `server`, `treatment`, `music`, `building`) blur together.
- Also, nearly every tool icon uses the same `#c6f432` lime accent fill, making it hard to scan tool categories at a glance.
- **Exact Fix (`W14 follow-up` — `src/art/hudIcons.ts`):**
  1. Add a size-aware simplification branch when rendering or viewing `size <= 18` (or thicken primary silhouettes and reduce interior lane/window counts from 4–6 lines down to 2–3 bold strokes).
  2. Give semantic accent fills by category while keeping `#111111` sticker outlines:
     - **Zones:** R/C/I/O distinct accent tints (keep pattern/shape differences for color-blind safety).
     - **Utilities:** Power (`#ffd84a`), Water (`#4cc3ff`), Sewage/Trash (`#c89d54`).
     - **Danger / Bulldoze / Disasters:** Cannon red (`#b3202a` / `#ff5a52`).

---

## 3. Incoming Requests From FABLE (`docs/aaa/REQUESTS_FABLE.md`)

Read and act on these items from FABLE's latest log (`9b3f161`):

1. **New Top Desktop Preset for RTX 5090 Class GPUs (`src/config.ts`, `src/render/*`, `src/world/sky.ts`):**
   - The owner asked to use the RTX 5090 wherever it improves the desktop experience (High at 1080p currently takes only ~4.4 ms GPU time).
   - Add or upgrade the top desktop preset (`ultra` or a new `extreme` / `5090` tier) with:
     - Multi-cascade 4096 shadow maps (`W6`) covering out to the horizon band;
     - Full-resolution (`1.0×`) planar water reflections + wet-road reflections;
     - Extended near-tree 3D foliage range (`350 m+`) and full Civic Foundry range;
     - Larger **render-only** car and pedestrian draw pools (must remain strictly render-only so `scripts/qualitytest.mjs` passes!).
2. **Substep Position Interpolation Hook (`src/agents/vehicles.ts`, `src/agents/people.ts`):**
   - FABLE is landing the fixed simulation timestep (`F0.3`). Expose an `alpha` (`0..1`) interpolation parameter in the vehicle and citizen instance transform uploaders (`prevPose -> currPose`) so 144 Hz monitors get buttery motion between 20 Hz sim ticks.
3. **Node Rig WebSocket Clash (`ws: false`):**
   - Whenever you write a Node script that boots Vite in middleware mode, pass `server: { ws: false }` so port `24678` never hangs when two checks run concurrently.

---

## 4. Your Prioritized Execution Queue (Next 10 Commits)

Work through these in order, committing one focused change at a time with before/after contact sheets and metrics:

1. **`Merge:`** Merge `origin/aaa/integration` into `codex/aaa-world`.
2. **`Trees:` (W1)** Canopy-density understory texture + terrain shader forest-floor darkening + overlapping far impostors + clear-cut stump/slash edge band. Verify on all 3 map overview goldens that the "leopard print" is gone (luma std-dev drop ≥ 40%).
3. **`Terrain/Roads:` (W5 + W7)** Break up 4 m vertex-paint lot jaggies with macro noise; unify junction hull and segment asphalt materials (`ΔE < 3` across boundary); soften sidewalk bank skirts; fix mirrored street-blade backfaces.
4. **`Buildings:` (W3 + W4)** Per-tile-class roughness/normal/AO in `material.ts` + vertical base grime + podium/setback/crown tower silhouettes (`comHigh`, `office`, `resHigh`) so no two adjacent downtown towers share a silhouette.
5. **`Render:` (W10)** Replace Y-squash construction (`src/sim/buildings.ts:356`) with shader clip-plane vertical rise + floor slab reveal + tower crane + completion dust burst; add demolition shrink + rubble pile wired to `sim.events.on('construction' | 'demolished' | 'levelUp')`.
6. **`Lighting/Post:` (W6 + W7 + RTX 5090 Request)** 2–3 shadow cascades (including Low far cascade), AO applied to ambient only (never darkening direct sun), single-pass `lowGrade.ts` tone-map chunk for phones, and supercharged `Ultra` settings for the RTX 5090.
7. **`Water/Atmos:` (W8 + W9)** Water depth absorption & shoreline contour foam, sloped visual river surface with flow, pollution-driven river color (`fields.pollutionAt` → sediment brown, algae green, acid orange, river fire), and smog-driven sepia sky shift (`fields.smog()`).
8. **`Overlays:` (W11)** Skylines-2 style smooth upsampled heatmaps from `game.fields.fieldFor(view)`, desaturated/lightened world under active info views, thin 30%-fill zone outlines, and zoom-clustered need bubbles.
9. **`Vehicles:` (W15)** Camera-priority car draw pool (rebind instance handles to nearest N cars every ~0.5 s so Low never shows cars stopped behind invisible leaders) + `alpha` interpolation for FABLE's fixed timestep.
10. **`Audio:` (A1–A4)** Drive `ambience.ts` from `fields.naturePct()` and local camera density; add the adaptive music stems (`banjo/fiddle` → `gas-station muzak` → `Top-40 country` in `src/audio/`) and wire positional SFX to `WorldEvents`. Render `.wav` stems to `shots/audio/` so `ORION` (Antigravity/Gemini) can listen to them with native audio perception and give you mix notes!
