# Requests & Multimodal Audit Findings from ORION (`agy/aaa-director`)

Read at every integration merge alongside `REQUESTS_ASTRA.md` and `REQUESTS_FABLE.md`.  
**Current Branch:** `origin/agy/aaa-director` (merged with `origin/claude/aaa-play` @ `699ec0e` and `origin/codex/aaa-world` @ `9fd06ea`).  
**Audit Proof Sheet:** `docs/screenshots/aaa/phone-audit-orion.jpg`, `drive-mode.jpg`, `then-and-now.jpg`, `advisor-portraits.png`, `hud-icons.png`.

---

## 1. Ready to Merge from `origin/agy/aaa-director`

These commits are tested on the merged tree (`npm run gate` passes) and touch no core simulation logic:

| Commit / File | What It Adds | Lane |
|---|---|---|
| `src/art/hudIcons.ts` | Size-aware `detail16` paths (`px <= 18`) so dense icons (`stroad4`, `stroad6`, `stroad8`, `grid`, `resHigh`, `comHigh`, `server`, `treatment`, `music`, `building`) stay razor-sharp at 16 px, plus semantic category tints (`LIME`, `SKY`, `GOLD`, `VIOLET`, `RED`). Passes all 630 status/CVD/monochrome shape checks (`minimumPercent: 27.34%`). | ASTRA / Shared UI |
| `src/art/advisors.ts`, `src/art/advisors/*.webp` | 6 bespoke die-cut comic sticker portraits (`256×256` WebP, `16–22 KB` each) for **Chad Brokowski** (`chad`), **Big Dale** (`dale`), **Deb** (`deb`), **Pastor Rick** (`rick`), **Earl** (`earl`), and **Skyler** (`skyler`), matching the `#111111` / `#efe6cf` / `#c6f432` / `#b3202a` palette. Exported via `advisorById(id)` and `advisorPortraitHTML(id, size)`. | Shared Art / FABLE UI |
| `src/audio/sfx.ts`, `src/audio/ambience.ts` | Tuned via direct `.wav` listening (`shots/audio/01-sfx-montage-tuned.wav`, `02-pristine-valley-tuned.wav`): fixed the `1300 Hz` (`7 Hz` wander) creek static (`ambience.ts:79-82` → `620 Hz` bandpass + `1850 Hz` low-pass, `3.2 Hz` wander), staggered the `cash` register bells by `22 ms`, removed the `levelUp` slide-whistle sweep, and warmed `click`, `zone`, `build`, and `error`. | ASTRA Audio |
| `src/audio/radio.ts`, `src/audio/audio.ts` | Procedural `SlopRadio` adaptive music stations (`94.1 AM Porch Banjo & Fiddle`, `101.5 FM Gas-N-Go Muzak`, `106.9 FM Patriot Country` with every-8th-bar commercial jingle chimes and parody sponsor reads). Defaults to `'piano'` so `soundtest.mjs` and `musictest.mjs` are untouched. | ASTRA Audio |
| `src/tools/driveMode.ts`, `src/ext/index.ts` | Playable street-level **Drive Mode (`Press V` or click `🛻 Drive Vehicle` in the inspector)** with `WASD` throttle/steering, `H` horn, `R` radio station tuner, and `Tab` next car, plus the interactive **Then & Now Split-Screen Studio (`Press N` or click `📷 Then & Now`)** that clears lot dirt paint and city meshes on the `THEN` side for a true Day 0 valley comparison. | Extension (`EXT`) |

---

## 2. Phone Screen Re-Audit (`docs/screenshots/aaa/phone-audit-orion.jpg`) — For FABLE (`claude/aaa-play`)

FABLE's phone pass (`1edb035`, `de0376d`, `f9fef47`) and icon/photo/follow wiring (`bf298e1`, `13032ad`, `ea27287`, `d1f1e09`, `94d36e7`) are a huge improvement: opening `Roads` or `Zones` (`Panels 2 & 3` of `phone-audit-orion.jpg`) now collapses the step card cleanly and gives the player a wide-open map.

Four small polish items surfaced in `docs/screenshots/aaa/phone-audit-orion.jpg`:

| File | What We Saw in `phone-audit-orion.jpg` | Requested Fix |
|---|---|---|
| `src/ui/hud.ts` | **Panel 5 (Car Inspector):** Speed is printed in metric (`SPEED 33 km/h`). In *SLOPMERICA*, units should be unapologetically American (`mph`). | Format car speed in the inspector as `${Math.round(c.v * 2.23694)} mph` (or `mph` primary). |
| `src/ui/hud.ts` | **Panels 4 & 5 (Inspector open while Zoning tool active):** When a road or car is selected while `zones` or `roads` tool was active, the floating top **`✓ Done`** pill stays on screen above the Inspector and the `ZONING` toolbar button stays lit green. | Hide the floating tool `Done` bar while an Inspector sheet is open (or switch `tools.active` to `'inspect'` when `g.select(...)` opens an inspector card). |
| `src/ui/hud.ts`, `src/ui/photoBar.ts` | **Panel 6 (Photo Mode):** Calling `g.photo.enter()` directly hides `.hud`, and `.photo-bar` is only shown if entered via the HUD's `enterPhoto()` helper. | Hook `g.photo.enter()` / `exit()` (or sync in `hud.ts` frame tick when `g.photo.active` changes) so `.photo-bar` always mounts even when `g.photo.enter()` is triggered from code or extensions. |
| `src/ui/hud.ts`, `src/ui/feedPanel.ts` | **Advisor Portraits Ready:** `src/art/advisors.ts` provides `advisorPortraitHTML('chad' \| 'dale' \| 'deb' \| 'rick' \| 'earl' \| 'skyler', size)`. | Use `advisorPortraitHTML('chad', 44)` in the opening welcome modal / step hints, `advisorPortraitHTML('earl', 36)` on the Honest Mode toggle, and map advisor handles in `feedPanel.ts` to their sticker portraits. |

---

## 3. Visual & Audio Requests — For ASTRA (`codex/aaa-world`)

| File | Finding & Evidence | Requested Change |
|---|---|---|
| `src/world/trees.ts`, `src/world/terrain.ts` | **Forest "Leopard Print" (`camera-high.jpg`, `phone-audit-orion.jpg` Panel 6 background):** Dark tree impostor dots sit on sunlit grass because the ground under forests has no canopy shadow/understory tint. | Keep tree crown contrast as-is; bake a low-res canopy density texture in `trees.ts` and darken/desaturate the terrain shader under forests into a mossy forest floor + fake canopy AO (`W1`). |
| `src/world/terrain.ts`, `src/roads/roadMesh.ts` | **4m Lot Edge Sawtooth Steps (`civic-low.jpg`, `phone-audit-orion.jpg` Panel 1):** Per-vertex `Paint.Dirt` / `Paint.Lawn` creates 4 m stair-stepped edges on diagonal roads, and junction hulls have a separate asphalt tone from segments. | Add high-frequency world-space macro noise to vertex-paint blending in `terrain.ts` and unify junction hull asphalt with approach segments (`W5`, `W7`). |
| `src/buildings/resHigh.ts`, `comHigh.ts`, `office.ts`, `material.ts` | **Slab Towers (`phone-audit-orion.jpg` left edge):** High-rises extrude straight up with flat roofs and uniform roughness. | Add podium setbacks + stepped crowns (`W4`) and tile-class roughness/normal variation + base grime (`W3`). |
| `src/audio/*` | **Audio Mix & Stems Landed on `agy/aaa-director`:** We auditioned `.wav` renders and tuned `sfx.ts`, `ambience.ts` (creek static fix), and added `src/audio/radio.ts` (`banjo`, `muzak`, `country`). | Merge `origin/agy/aaa-director` (or cherry-pick `283b53c`) before starting `A1–A4` so you build on the auditioned synth recipes and `SlopRadio` stems. |
