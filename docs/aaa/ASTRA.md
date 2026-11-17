# SLOPMERICA: the AAA push. Brief for ASTRA (Codex lead)

You are ASTRA, the lead agent in Codex. You may hand bounded jobs to Sol and Luna: screenshot sweeps, lineup runs, codemods, measurement batches, one-file refactors. You review their work and own every decision and every commit. Your job is to make SLOPMERICA **look, sound and feel** like a AAA city builder on every device the owner plays on: the world, the light, the buildings, the roads, the cars and people as objects, the camera, the effects and the audio.

A second agent, **FABLE** (Claude Code), works in parallel on **how the game plays and reads**: the simulation, the systems, traffic behaviour, the UI, onboarding and the writing. Its brief is `docs/aaa/FABLE.md`. Read its lane table before you touch a file. If you run alone, see "Running alone" at the end.

This is a long run. The owner wants tokens spent on quality: measure, look, compare, iterate. Don't stop at the end of a phase to ask permission. Stop only for the owner decisions listed below, and even then park that item and move on to the next.

---

## 1. The game in two paragraphs

SLOPMERICA (*Land of the Free Parking*) is a satirical 3D city builder in the browser: TypeScript, three.js r186, Vite, no UI framework, about 58k lines in `src/`. It is Cities: Skylines, except the goal is to do everything urban planners warn against: stroads, 120-pump gas stations, cul-de-sacs over the wetland, parking lots that sit empty 364 days a year. There are three maps: Holler County (Appalachia), Golden Coast (NorCal) and Gator Gulch (Florida). There are four modes: Growth Ponzi, Unlimited Slop (sandbox), Hippie Hell and Speedrun to Delhi. It has seasons, weather, night, ten milestone tiers from 0 to 10,000 people, utilities, services, freight, buses, districts, terraforming, disasters, hippie communes as opposition, and an X-style feed. The in-world mega-brand is **SLOP**, the owner's real merch line (Imagine Supply Co.).

Design pillars (`docs/GAME_DESIGN.md` §2), which every visual decision serves:
1. **Paradise first.** The starting valley must be truly beautiful: golden-hour light, birdsong, fireflies, a creek you can hear. The destruction only lands, as comedy or as tragedy, when you can see and hear what was traded away.
2. **The satire lives in the systems.**
3. **The game is a true believer.** The UI is boosterish; the game never winks.
4. **Specific beats generic.** Center turn lanes, frankenpine cell towers, one sad tree in a mulch island.
5. **It has to be fun to build.** Buttery, instant, juicy.

The art direction is a **semi-realistic, slightly toy-like diorama**: Skylines-1 readable, darker and goofier, golden hour as the hero light, a liminal sodium-orange night. Read `docs/ART_DIRECTION.md`, `docs/GRAPHICS_HANDOFF.md`, `docs/CARS_LOOK_REPORT.md`, `docs/round8/night.md` and `docs/round8/people.md` before you start.

**The owner plays on a phone at the Low preset.** Low is not a fallback. It is the main platform. Every visual change ships a Low version, or says in its commit why it is High-only.

---

## 2. Where things stand (surveyed 2026-11-17 on `claude/round8-sim` @ 0418fcc)

Every line below was checked in code unless marked *(doc)*.

### Render pipeline
- **Renderer** (`src/game.ts:231-241`): ACESFilmic, exposure 0.95, sRGB, `PCFShadowMap`, `antialias: !q.post`. FOV 50 (slider 35 to 110). Near plane is `dist*0.004`, clamped 0.5 to 8 (`render/camera.ts:317`). 24-bit depth and no log depth, so decals stack polygonOffset (roads -2/-4, junction -3, crosswalk -4, zone tiles -4, signs -6).
- **Presets** (`src/config.ts:45-61`):

  | | Pixel ratio | Shadow map | Post | AO | Trees |
  |---|---|---|---|---|---|
  | Low | 1 | 1024 | off | off | 0.5 |
  | Medium | 1.4 | 2048 | on | off | 0.75 |
  | High | 2 | 2048 | on | half | 1 |
  | Ultra | 2.25 | 4096 | on | full | 1.15 |

  - Touch devices default to Low (`config.ts:94`), with a pixel-ratio floor of 1.5 on phones (`:69-72`).
  - The PMREM environment map is High and Ultra only (`game.ts:258`).
  - The Civic Foundry street furniture and street trees are skipped on Low (`game.ts:325`). **The owner never sees them.**
- **Bug: the auto-benchmark is inverted on touch** (`game.ts:957-959`).
  - A fast phone measures as high or ultra and is then forced to `low`. A slower phone (24 to 34 ms) gets `medium`, with post, an MSAA HDR target and bloom.
  - It also measures the first 3 s of boot, shader-compile hitches included.
  - `PostFX.enabled` is readonly (`post.ts:383`), so a live preset change needs a reload.
- **Post** (`render/post.ts`):
  - A 4x MSAA HalfFloat target, plus custom SSAO (12 samples, half-res, depth-aware blur).
  - **The AO composite multiplies the whole lit colour, direct sun included** (`:151`).
  - UnrealBloom, effectively night only (threshold about 5 by day).
  - A grade with ACES, saturation, contrast, lift, tint, vignette and grain.
  - **Tilt-shift (`:257`) and TAA (`:157-185`) exist but only the dev atmosphere lab turns them on.** Low renders straight to the canvas, with its grade faked through exposure and lights (`render/lowGrade.ts`).
- **Lighting** (`world/sky.ts`):
  - One directional light for sun and moon. **One shadow cascade**, an ortho box sized `viewDist*0.75` and clamped 90 to 1400 m around the focus (`:618`), so the far half of a low-pitch view has no shadows.
  - Hemisphere light, a custom sky dome with Milky Way, moon phases and 4,200 stars that fade with light pollution, and a PMREM re-bake at 64 px every 1.2 s.
  - Exp2 fog plus a ground-mist layer patched into three's fog chunks (`:24-91`).
- **Night** (`world/nightLights.ts`):
  - Top-down practical-light pools painted into one texture. Ground adds pool times albedo; walls take it on the bottom 3.5 m.
  - Lamp heads are emissive instances, with no real lights.
  - Open gaps from round 8: street furniture is unlit by the pools, pale cars take no lamp light, dark paint (the Cyberslop) reads black, the tow-truck amber bar has no halo, garbage-truck beacons never light *(doc, `round8/night.md:199-205`, `CARS_LOOK_REPORT.md:300-323`)*.
- **Weather** (`world/weather.ts`, `atmos.ts`, `clouds.ts`, `seasons.ts`):
  - GPU rain, snow and ash; a cloud deck with matching cloud shadows; snow cover; wet ground; puddles in terrain flats; river ice; storm surge; fireflies.
  - **Wet roads only lower roughness and darken** (`roads/roadMesh.ts:627-636`). There are no reflections.
- **Buildings**:
  - Procedural generators per zone and level (`buildings/resLow.ts`, `houses.ts` with 50 styles, `comLow`, `comHigh`, `office`, `resHigh`, `industry`) through the `MB` mesh builder (`buildings/mesh.ts`).
  - **One shared `MeshStandardMaterial`** (`buildings/material.ts:39-50`): roughness 0.84 everywhere, metalness 0.04, a 4096² canvas albedo atlas, a half-res emissive atlas and a 2048² satire sheet (`art/atlas.ts`, `art/facades.ts`). Glass is faked with a fresnel sky term.
  - **No normal or roughness maps.** Rendered through two `BatchedMesh`es (`sim/buildings.ts:62-110`), with **no LOD, no distance cull, and every building in the shadow pass.**
  - 16 variants per zone, level and size (40 for resLow), plus vault slots, with a model cache capped at 900.
  - **Construction is a Y-scale squash of the finished model** plus a stretched scaffold (`sim/buildings.ts:356-366`); signs and windows squash with it.
- **Two building pipelines that can't share a batch**:
  - `buildings/generator.ts` with `art/atlas.ts` (canvas atlas) builds zoned buildings, landmarks and billboards.
  - `buildings/kitGenerator.ts` with `buildings/atlas.ts` (texture array) builds communes, services and scaffolds (`kitGenerator.ts:1-4` says so).
- **Roads** (`roads/roadMesh.ts`, `roadSection.ts`, `streetDetails.ts`):
  - Per-type ribbons with a canvas-painted texture and painted wear.
  - **Junction hulls have their own texture and material** (`:560`), so every intersection is a visibly different, mottled patch.
  - Curb, gutter, walk, earth-bank skirts and driveway ramps; instanced lamps (cap 4000).
  - Any change re-concatenates the whole network per type (`:638-697`).
  - **Street-name blades are one DoubleSide quad, so the text is mirrored from behind** (`streetDetails.ts:606`).
- **Terrain** (`world/terrain.ts`):
  - A 4 m heightmap in 12×12 chunks with 4 LOD levels and skirts. Ground paint is per vertex, so lot edges are quantised to 4 m.
  - Triplanar rock and cloud shadows. `groundDetail.ts` adds camera-local plant cards and pebbles.
- **Trees** (`world/trees.ts`):
  - Hundreds of thousands in typed arrays. Near trees are card-foliage models (8 kinds × 3 variants). Far trees are impostors baked at load and darkened by `FAR_FOOT 0.61` (`:34`).
  - Impostors cast no shadows. About 10 to 17 of the 32 buckets are drawn.
- **Water** (`world/water.ts`):
  - One plane at y = 0, depth from the height texture, foam, rain rings, ice, surge and a moon path.
  - Planar reflection at 0.5 res, High and Ultra only (`:247`). No refraction, and **rivers are flat at sea level**.
- **Particles** (`render/particles.ts`): a GPU ring buffer of instanced quads with 9 kinds, all small.
- **Info views** (`render/overlays.ts`, `sim/services.ts:1714`): a traffic ribbon, a land-value tint, and a coverage DataTexture of **192² over a 6 km map, so 32 m per texel**. That is blurry and blocky. Need bubbles carpet the town (`sim/serviceIcons.ts`).
- **Asset library vs game**:
  - Civic Foundry (`public/asset-library`, 83 glTF assets, 37 MB) is not loaded by the game.
  - The game streams `public/civic/pack.json`, 31 of those assets drawn as instanced PBR with 2 LODs (NEAR 150 m, cull 720 m), placed by `src/civic/layer.ts:179-237`.
  - **All 40 window, door, storefront, roof and facade modules are catalog-only.** So are the street lamps, signal mast, hydrant, fences, curb ramp, water tower, pine, birch and reed bed.
  - The Asset Vault (4,000 models in `public/vault`) *is* used: it is rebuilt into the building atlas through vault slots (`generator.ts:127-135`) and roadside scenery (`vault/scenery.ts`).
- **Vehicles and people (as objects)**:
  - 59 vehicle models with night lights, turn signals and reverse lamps (`agents/vehicles.ts`, `vehicleFx.ts`).
  - 69 citizen archetypes posed on the GPU (`agents/people.ts`, `agents/models/*`).
  - **`updateLod` for people is never called by the game**, and the near range doesn't scale with FOV *(doc, `round8/people.md` §6)*.
  - **The car draw pool is not camera-priority**: past the preset's pool, `add` returns −1 (`vehicles.ts:504-508`, `perKind = maxTotal/3`). In a big town on Low, many cars near the camera are simulated but invisible, and visible cars queue behind nothing.
- **Ambient life** (`agents/ambient.ts`): camera-local wildlife and boats per map (deer, bears, sea lions, gators, flamingos, manatees, jet skis), slower at night and in storms. Deer flee roads.
- **Audio**: all procedural WebAudio, with no audio files.
  - **Graph** (`audio/audio.ts:49-101`): master to a compressor; a sound bus with convolver reverb; a separate piano/music path. Settings has on/off and volume for each.
  - **Street audio** (`streetAudio.ts`, `streetProfiles.ts`), the best piece:
    - A voice pool (8 cars, 3 sirens, 4 horns; 4/2/2 on Low) goes to the loudest nearby real cars at 4 Hz.
    - Per-kind engines with gears, Doppler and a distance low-pass. Jake and air brakes, Cyberslop whine, honks only from queues of 3 or more, wet-road hiss.
    - Panning is a `StereoPanner` by bearing, not HRTF.
    - **"Nobody has listened to it"** *(doc, `cars-look/audio.md`)*.
    - Undrawn cars still get voices (`streetAudio.ts:718`).
  - **Ambience** (`ambience.ts`):
    - Wind, rain, a "creek" reused for every body of water (no surf), a town-wide traffic hum (count/400, not local), cicadas and a crowd walla.
    - Birds, frogs, crickets and an owl by map and season. Visible animals and boats make no sound of their own.
  - **Music** (`piano.ts`): one generative ambient felt piano whose only input is `night`.
  - **SFX** (`sfx.ts`), 13 recipes:
    - `zone` is never played and `honk` is unused.
    - `cash` plays only on taking a loan.
    - Build, bulldoze and crash are unpanned.
    - There is no ducking.

### Performance (be suspicious of every number)
- **The only real-GPU numbers** *(doc, `docs/aa-world/README.md`, AMD Radeon 860M with ANGLE D3D11)*:

  | | Viewport | FPS | Frame | Draw calls | Triangles |
  |---|---|---:|---:|---:|---:|
  | High | 1280×800 | 75 | 13.3 ms | 147 | 3.40 M |
  | Low | 390×844 | 131 | 7.6 ms | 112 | 1.22 M |

  GPU split at High: trees 2.57 ms, post 2.49 ms, shadows 1.52 ms.
- Everything else in the docs was measured on a 4-core **SwiftShader** Linux container.
- **There are no real phone numbers anywhere.**
- No script enforces an ms or draw-call budget. `frametime`, `drawcalls` and `perfTown` only print.
- Budgets that are enforced: `aotest` (AO darkens open ground at most 4/255), `nighttest` (road luma ≥ 50, pool p90 ≥ 100, blown pixels < 1%), `yellowflash`, `treelod` (far/near canopy ratio 0.85 to 1.15).

### What reads cheap today (worst first, from the screenshots)
1. **The far forest is a "leopard print":** near-black impostor blobs on bright lit grass. It dominates every overview shot.
2. **Downtown towers are identical dark-blue glass prisms** with flat tops and lit floor bands: no setbacks, no crowns, no podiums.
3. **Everything is matte cardboard:** one roughness value, no normal detail, no edge wear, no grime.
4. **Sidewalks and lot banks read as raised concrete walls,** and junction boxes are differently toned patches.
5. **Low on a phone is flat:** lime-green fields, sparse trees, no AO, no civic layer. This is the owner's platform.
6. **Info views are icon carpets** over saturated, opaque zone tiles.
7. Mirrored street-blade text, hard alpha-cut leaf edges up close, and construction as a stretched box.

---

## 3. What "AAA" means here: the bar you're held to

These are the targets for your lane. Each one must be shown with a picture, a number or both.

1. **Golden shots.** A fixed set of cameras renders without one placeholder-looking element, judged against the "reads cheap" list above. The set covers the reference block and an overview of each map, at noon, golden hour, moonless night and rain, on Low and High. Each item on that list is gone or demonstrably improved, with before/after contact sheets.
2. **The owner's phone looks good.** Low has a real grade, contact shadows or baked AO, a populated civic layer and a forest that reads as forest. It holds the frame budget below.
3. **Frame budgets on the reference town, enforced by a script:**
   - Desktop High at 1920×1080 on the RTX 5090 under 8 ms, which leaves headroom for mid laptops.
   - Low at 390×844 DPR 3 with 4× CPU throttling under 16 ms.
   - Draw calls: Low ≤ 250, High ≤ 600.
   - Empty-map triangles no higher than today unless a commit justifies it.
4. **Camera feels expensive:** smooth zoom-to-cursor with easing, pitch tied to zoom, depth-based tilt-shift that makes it a diorama, a photo mode, and a follow-cam on any car or person.
5. **Every player action has a visual and an audio response** within 100 ms (with FABLE's events): build, zone, bulldoze, level-up, money, milestone, disaster.
6. **The soundscape is a health bar** (GAME_DESIGN §5.5): a pristine valley sounds like paradise, and a paved one sounds like a stroad. You can hear the difference blind, and it is measured by a script.
7. **Music follows the arc:** porch banjo and fiddle, then gas-station muzak, then a Top-40 country station stuffed with parody ads (GAME_DESIGN §8), adaptive to population tier, money trouble, jams, disasters and night.
8. **No regressions:** every existing look test still passes (`aotest`, `nighttest`, `nightglow`, `yellowflash`, `treelod`, `impostortest`, `shadercheck`, `glcheck`, `nantest`, `qualitytest`, `presetlight` and the rest), and graphics presets never change the simulation.

---

## 4. The two-agent setup

### Lanes (file ownership)

| | **ASTRA (you): the world you see and hear** | **FABLE: the game you play and read** |
|---|---|---|
| Owns | `src/render/*` (including `camera.ts`), `src/world/*` (shading, vegetation, water, sky, weather; **not** heightfield generation, see the rules), `src/buildings/*`, `src/art/*`, `src/vault/*`, `src/civic/*`, `src/agents/vehicles.ts`, `vehicleFx.ts`, `people.ts`, `models/*`, `ambient.ts`, `communeBuilder.ts`, `src/audio/*`, `src/roads/roadMesh.ts`, `roadSection.ts` (except the paint constants that FABLE's crossing logic reads), `streetDetails.ts`, `src/sim/serviceIcons.ts`, the **rendering block** of `src/sim/buildings.ts` (BatchedMesh setup, construction visuals, LOD/cull; announce each such commit with a `Render:` subject), `src/asset-library/*`, `src/asset-vault/*`, `dev/*.html` and `src/dev/*` except `src/dev/debug.ts`, the look/perf/audio scripts, new `scripts/look/*` | `src/sim/*` (except that rendering block and `serviceIcons.ts`), `src/zones/*`, `src/transit/*`, `src/tools/*`, `src/ui/*`, `src/style.css`, `index.html`, `src/content/*`, `src/ext/*`, `src/core/*`, `src/agents/traffic.ts`, `parking.ts`, `pedestrians.ts`, `communes.ts`, `src/roads/network.ts`, `roadJunction.ts`, `roadTypes.ts`, `src/world/maps.ts`, `src/dev/debug.ts`, the test harness (`scripts/suite.mjs`, `scripts/lib/*`, `refblock`, snapshot/lock tooling, the test registry) and the sim/UI test scripts |
| Shared (small, separate commits; merge `aaa/integration` first) | `src/game.ts`, `src/config.ts`, `src/main.ts`, `src/contracts.ts`, `vite.config.ts`, `package.json`, `README.md` | same |

- **If a fix belongs in FABLE's files, don't make it.** Write it in `docs/aaa/REQUESTS_ASTRA.md` (file, cause, proposed fix, what it blocks). FABLE reads that file at each merge. Read `docs/aaa/REQUESTS_FABLE.md` the same way.
- **The UI seam.** FABLE owns the HUD. You own the art it uses:
  - The drawn icon set that replaces emoji (section 6, item W14).
  - Heatmap and overlay rendering.
  - Need-bubble rendering and clustering.
  - Every sound.

  FABLE wires them in.

### Contracts (`src/contracts.ts`)

Add typed interfaces here in small commits. These are the ones this push needs; whoever needs one first writes it, and the other side codes against it exactly.

- **`SimEvents` FABLE emits, you consume:**
  - `construction(bldId, progress 0..1)`, `demolished(bldId, pos, size)`, `levelUp(bldId)`;
  - `disaster(kind, phase, pos, radius, intensity)`, `flood(cells)`, `fireFront(points)`;
  - `crash(pos, severity)`, `moneyTick(delta, kind)`, `milestone(tier)`;
  - `zonePainted(cells, zone)`, `roadBuilt(segIds)`, `laneAdded(segId)`;
  - `collapseStage(stage)` for the Ponzi ending, `paradisePaved()`.
- **Fields you read:**
  - `fieldFor(view) → { w, h, cellM, data, min, max, legend }` for every info view. Ask FABLE for 384² or more where it is cheap; upsample smoothly yourself where it isn't.
  - `roadCondition(segId) → 0..1`, so cracks, potholes and patches show age. This is the Ponzi made visible: GAME_DESIGN says "roads visibly crack and grow potholes as they wear down".
  - `buildingAge` and `buildingCondition`, for grime and decay.
  - `pollution` and `smog` for the sky tint, and `naturePct` for the soundscape health bar.
- **A `ViewTarget` for follow-cam**: a car id, a citizen id or a building id.

### Branches, worktrees, ports

- **Base.** Start from `aaa/integration` if it exists (`git fetch`), otherwise from `aaa/briefs` (which is `claude/round8-sim` plus these briefs). `main` is a stale one-commit branch; don't base on it.
- **Your branch** is `codex/aaa-world`. Work in your own worktree so FABLE's dev server and edits never touch yours:
  ```bash
  git -C C:/Users/burnz/Slopmerica worktree add C:/Users/burnz/Slopmerica-astra -b codex/aaa-world origin/aaa/integration
  ```
  If `origin/aaa/integration` doesn't exist yet, use `origin/aaa/briefs`, or local `aaa/briefs`.
- **Line endings.** In your worktree run `git config core.autocrlf false`, then a fresh checkout. The repo's blobs are LF; Windows autocrlf made the suite silently find 0 tests.
- **Ports 5190 to 5199 are yours.** FABLE uses 5180 to 5189. You may run up to **4 headless browsers at once**; this PC has 32 cores, and FABLE has its own 4.
- **Integration.**
  - FABLE owns `aaa/integration` and merges your branch into it at milestones after running the gates.
  - Before every push and at least every 3 hours, merge `origin/aaa/integration` into your branch. Resolve conflicts without undoing anyone's work, rerun your tests, then push `codex/aaa-world`.
  - Never push to `aaa/integration`, `claude/*` or `main`. Never force-push. Don't open pull requests unless the owner asks.
- **Logs.** Keep `docs/aaa/LOG_ASTRA.md` as you go: what you did, numbers, commits, what's next. Write it so a fresh session can take over from it alone. Commit it with your work.

---

## 5. The owner's rules (unchanged from earlier rounds; they override this brief)

- **No new npm dependencies.** Write the small thing yourself: an inline pixel diff, a tiny noise function, a shader.
- **Offline game.** Nothing in `src/` calls a network API. No key or token goes into `src/`, the bundle, a `VITE_` variable, a log, a commit or a report. Never open or print `.env.local`.
- **Jev (TypeSafe) only in Node scripts** at dev or build time, with a `--dry-run` that needs no key. Report requests, tokens and dollars per run, and keep a full pass under $1. Never per frame, never for jokes, names or balance.
- **Content and balance are the owner's call.** Don't rename brands or rewrite jokes. Signage and art for *new* things are fine, using parody brands only. Run `node scripts/ipcheck.mjs` and the content audit on anything with words or brand art.
- **Content rules** (`docs/WORKSTREAMS.md`, the newest statement of them, which wins over the older GAME_DESIGN tone notes):
  - Raunchy-ish is fine; nothing sexually explicit.
  - Mock ideologies, corporations and both political tribes. No slurs, and no jokes aimed at race, religion-as-identity, disability or sexuality.
  - Public figures only as obvious parody names, kept in data.
  - No real logos.
  - The SLOP / Imagine Supply Co. brand is the owner's own and is used straight. The palette is lime `#c6f432`, cream `#efe6cf`, ink `#111111`, Cannon red `#b3202a`.
- **Graphics presets must not change the simulation** (`scripts/qualitytest.mjs`). Your pools (cars drawn, people drawn, trees drawn) are render caps only. FABLE is separating the pedestrian *sim* cap from the preset; don't fight that.
- **Terrain generation is frozen.** Saves store only edits, and the world is regenerated from its seed (`src/sim/save.ts:2`). Any change to heightfield generation, river carving, the start site or the RNG draw order silently corrupts every saved city.
  - Shading, textures, vegetation placement *rendering* and water rendering are yours.
  - Anything that moves a vertex of the heightfield or a tree position needs a save migration plus FABLE's golden-save test passing. Ask in `REQUESTS_ASTRA.md` first.
  - River slope (item W8) is the obvious case: do it as a *visual* water surface that follows the carved bed, not by changing the bed.
- **Every fix gets a check that fails before and passes after,** or for pure looks, a fixed-camera before/after contact sheet plus a numeric metric (luma, contrast, edge energy, mask coverage) that the commit message quotes.
- **One change per commit.** Subject in the house style `Area: plain-English outcome` (look at `git log`: e.g. `Night: street trees and forest trees take the street lamps' pools`). The body carries the numbers, seeds and preset.
- **No model or agent names in code, docs you write, or commit subjects and bodies.** These brief and log files are the exception.
- **The debug hooks are a public API** that 100+ tests use: `window.__game`, `__dbg`, `__services`, `__land`, `__vault`, `__startSite`, `__people`, `__atmo`, `__lineup`, `__gallery`. Keep them stable. Add, don't rename.

---

## 6. The work

Order matters: Phase 0 makes everything after it measurable. Within a phase, go roughly in order, but if something blocks, park it in the log and take the next item. "Done when" is the bar for each item.

### Phase 0: measure first (first 2 to 4 hours)

**W0.1 Run the tests on this PC.**
- FABLE's first commits on `aaa/integration` fix the harness for Windows:
  - `.gitattributes`;
  - `scripts/lib/browser.mjs`, which exports `EXE` and `ARGS` from env `CHROME`;
  - the suite's CRLF bug (it printed "0 of 0 pass" and exited 0);
  - a Node lock to replace `withslot.sh`.
- Merge them as soon as they land. Until then:
  - Export `CHROME` pointing at `C:/Program Files/Google/Chrome/Application/chrome.exe`, and run scripts from the repo root against a frozen snapshot (`node scripts/snapshot.mjs astra 5191`).
  - About 84 scripts hard-code `/opt/pw-browsers/...`. Don't codemod them yourself (that's FABLE's), but patch copies outside git if you need one early.
- Done when you've run, on your worktree: `glcheck`, `nantest`, `aotest`, `nightglow`, `treelod`, `impostortest`, `qualitytest`, `shadercheck` (after FABLE's `fileURLToPath` fix), and the people and vehicle node checks (`vehicletest`, `peoplestats`). The results go in the log as your baseline.

**W0.2 Real GPU numbers on the RTX 5090.**
- Make `scripts/look/gpu.mjs` launch Chrome headless (`--headless=new --use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu-rasterization`).
- **Prove the GPU is real.** Read `WEBGL_debug_renderer_info` and fail if the renderer string says SwiftShader, llvmpipe or "Basic Render".
- Measure the reference town (`scripts/refblock.mjs`; FABLE is turning it into a committed fixture) and an overview of each map, at 1920×1080 and 2560×1440, for each preset:
  - frame ms (median and p95 over 300 frames after a 5 s warm-up);
  - `renderer.info` calls and triangles;
  - per-pass GPU ms with `EXT_disjoint_timer_query_webgl2`, reusing `nightcost.mjs`'s pass table.
- Done when the numbers are in `docs/aaa/PERF.md`, with the renderer string, Chrome version and date.

**W0.3 A phone proxy, and its limits.**
- Make `scripts/look/phone.mjs`: 390×844 at DPR 3, touch emulation, `Emulation.setCPUThrottlingRate` at 4× and 6×, Low preset, the hardware GPU.
- Say plainly in `PERF.md` that this proxies CPU but not a phone GPU. The owner's phone is the ground truth.
- Make `npm run build:single` output (plus its packs folder; see FABLE's note that `build:single` is not one file) easy for the owner to open on the phone, and list in your log what the owner should check.
- Done when the Low phone-proxy numbers are in `PERF.md`.

**W0.4 Budgets that fail.**
- Make `scripts/look/budget.mjs`: draw calls and triangles per preset on the reference block, from fixed cameras (deterministic, so SwiftShader works), plus GPU frame ms from W0.2 as a warning only.
- Budgets live in `scripts/look/budgets.json`. Start them at today's numbers plus 5%, and tighten as you win.
- Register it in FABLE's test registry format (`scripts/tests/astra.json`) once that exists.
- Done when it exits 1 on a deliberate regression and 0 on the base.

**W0.5 Golden screenshots.**
- Make `scripts/look/golden.mjs`. The fixed shot list is:
  - the reference block: street junction, mid zoom, overview;
  - each map: valley overview, coast or river, forest edge;
  - at noon, golden hour, moonless night and rain;
  - on Low (390×844 DPR 3) and High (1280×720 DPR 1).
- Make each frame deterministic:
  - fixed `SEED`;
  - `__dbg.hour(h)`;
  - weather pinned;
  - the frame loop stopped the way refblock does it (`cancelAnimationFrame(g.raf)`);
  - frozen `Math.random`, TAA off;
  - SwiftShader, so pixels match across runs.
- Store PNGs in `scripts/fixtures/golden/`. Compare with a small inline diff (per-pixel ΔE threshold, failing over 0.5% of pixels) and write a before / after / diff contact sheet with `scripts/sheet.mjs`.
- Update goldens only in their own commit, `Goldens: <why>`, with the sheet path in the body.
- Pin the Chromium build: download Playwright's Chromium into a known folder and record its version. Use it for goldens, not auto-updating system Chrome.
- Done when two consecutive runs match bit-for-bit and a one-line material change is caught.

**W0.6 Fix the inverted phone benchmark** (`game.ts:957-959`; shared file, small commit).
- Pick the preset from frames measured *after* shader warm-up (use `renderer.compile` or 1 s of frames first).
- On touch, cap at medium, never above.
- Never force a fast phone down.
- Make `PostFX` toggleable live, so a preset change applies without a reload.
- Done when a script shows that a fast proxy lands on medium and a slow one on low, and that changing presets in Settings changes `post.enabled` with no reload.

### Phase 1: the big visual wins (most of the run)

The order is visual impact per effort. Every item needs: a Low variant, a before/after contact sheet from the golden cameras, budget numbers before and after, and the regression tests above still passing.

**W1. The forest reads as forest** (`world/trees.ts`, `world/terrain.ts:633-650, 846-850`).
- Bake a low-res canopy-density texture from the tree arrays. Re-bake incrementally when trees are cleared; FABLE emits tree-clear events, and `trees` already tracks cleared trees for saves.
- Use it in the terrain shader: forest-floor colour and fake canopy AO under forests, so the ground between impostors is dark, mossy understory, not lit lawn.
- Let impostors grow and overlap with distance, so ridges read as continuous canopy mass with a soft top silhouette.
- Retune `FAR_FOOT` against `treelod`, which must stay within 0.85 to 1.15.
- Give clear-cut edges a visible stump-and-slash band. Clear-cutting is the game's first verb, so make it look like a scar.
- Done when the overview goldens on all three maps have no leopard print. Metric: the luma std-dev of forested hillside regions (mask from the density texture) drops by at least 40% at equal mean, and `treelod` and `impostortest` pass.

**W2. The camera feels expensive** (`render/camera.ts`, `render/post.ts:257`).
- **Depth-based tilt-shift.** Use the scene depth texture, with focus distance = `rts.distance` and blur growing with depth difference. It is on by default at mid and far zoom, off at street level, and has a Settings slider. On Low, use a cheap two-tap version or none, and say which.
- **Pitch tied to zoom**, Skylines-2 style: low pitch close in, steeper far out, and the player can still override with the existing controls.
- **Zoom to the cursor** with critically damped easing and a slight settle. Optional orbit around the cursor.
- **Follow-cam** on a car, a person or a moving bus, from the inspector (FABLE wires the button). Use a chase or over-shoulder rig with smoothing; a top-down `setView` isn't enough. It needs FABLE's `ViewTarget`.
- **Photo mode:**
  - hide the HUD;
  - free camera at street level;
  - FOV, tilt-shift focus, time of day and weather;
  - a frame overlay for **"Greetings from ___" postcards** (GAME_DESIGN §5.11), drawn in code with the county name;
  - save the PNG.
- **Then & Now:** a split-screen slider between the current city and the untouched valley from the same camera. The valley regenerates from the seed; only edits are saved, so the pristine world is cheap to rebuild in a second scene. This is the screenshot everyone posts. Coordinate the entry point with FABLE.
- Done when `gesturetest`, `edgetest`, `fovtest` (phone and desk) and `tiptest` pass. You also need a short frame sequence (a 60-frame zoom-in) showing smooth easing (no frame-to-frame jump over 2% of the distance), and photo mode producing a postcard PNG on all three maps.

**W3. Materials stop being cardboard** (`buildings/material.ts`, `art/atlas.ts`, `art/facades.ts`, `buildings/mesh.ts`).
- Add a roughness/specular channel per atlas tile class (glass, metal panel, brick, siding, roof membrane, concrete), packed into the emissive atlas's spare channel or a half-res sheet.
- Add a tiny tiling detail normal chosen by tile class (brick, panel seams, siding, shingles), as a texture array or one small atlas. Cost: one or two texture reads.
- Add world-space **grime**: darker at the base and under sills, streaks below parapets and window heads, and more with building age and condition (from FABLE's contract; until then use `Bld.born`).
- Bake a cheap per-vertex AO term in `MB` for inner corners and under overhangs.
- Apply the same treatment to the kit/texture-array material (`buildings/atlas.ts`), so services and communes match zoned buildings.
- Done when a close-up golden of the reference block shows readable material differences. Metric: local contrast (edge energy) on building faces up at least 25% at equal mean luma. `towers.mjs` facade luma doesn't regress, and the draw-call budget is unchanged.

**W4. Skylines with silhouettes** (`buildings/comHigh.ts`, `office.ts`, `resHigh.ts`, `mesh.ts`).
- Compose towers as podium + shaft + crown:
  - setbacks;
  - chamfered and stepped crowns;
  - spandrel colour variety;
  - rooftop plant clusters, water tanks and antenna masts;
  - crowns lit at night (seeded per building).
- Bring in the **unused Civic Foundry modules** (`public/asset-library`: windows, doors, storefronts, cornices, roofs) as a merged kit by baking their geometry into `MB` helpers at build time. Don't ship 37 MB; extract what you use into the pack the game already streams, and keep `dist` growth under 1.5 MB.
- Keep the vault slots.
- Satire belongs here too:
  - the 5-over-1 "luxury" podium with a fake-brick panel;
  - the McMansion's seven rooflines and stone veneer on the front only (GAME_DESIGN §6; `houses.ts` already has 50 styles, so check which exist first);
  - pole signs that get taller as roads get faster;
  - the frankenpine cell tower.
- Done when a downtown overview golden at 4,000 people shows no two adjacent towers with the same silhouette (a script compares bounding-profile signatures of neighbouring towers), `housetown.mjs` variety holds, and the building batch budget holds.

**W5. Roads read as one surface** (`roads/roadMesh.ts:292-430, 560`, `roadSection.ts`, `streetDetails.ts`).
- Paint junction hulls from the same asphalt as their approaches, using a shared world-space asphalt plus wear projection across segments and junctions, so no intersection is a patch.
- Add decals for stop lines, turn arrows, patch seams, oil stains concentrated at stop lines, manholes, and tar-snake cracks keyed to `roadCondition` from FABLE. Roads should visibly age as the Ponzi bill approaches.
- Lower or soften the earth-bank skirts (`GROUND_BELOW`, `VERGE_RUN`, `bankFoot`) so sidewalks stop reading as walls.
- **Wet roads**:
  - a cheap sky/environment reflection term on asphalt when wet (reuse the water reflection target on High);
  - on Low, a fresnel-boosted env colour;
  - puddle masks in road dips.
- **Street blades**: two single-sided quads, or flip the UVs on the back face, so the text is never mirrored.
- Skewed junctions: mitred walk ends in the section builder, so mouths aren't long and plain *(doc, `cars-look/junction.md`)*. Coordinate with FABLE, who owns `roadJunction.ts` geometry; you own the mesh.
- Done when `junctionmesh`, `junctionmouth --compare` (the network must not move), `junctiontest`, `crosswalktest` (paint versus walk path) and `nighttest` pass, and the junction close-up goldens show no tone seam. Metric: mean ΔE across the hull/approach boundary under 3.

**W6. Light that wraps** (`world/sky.ts:618`, `game.ts:238`, `render/post.ts:151`).
- 2 or 3 shadow cascades on High; on Low at least a second far cascade at 512.
- Try PCFSoft and compare cost on the 5090 and the phone proxy.
- **AO on ambient only**: scale by `1 - sunVisibility`, or inject into materials as an aoMap-style term, so direct sun isn't darkened.
- A sky-occlusion term on walls from height above ground.
- A warm bounce fill from the ground colour (build on the `uFillK` hack in `material.ts:21-28`).
- Shadow-pass culling for distant buildings and small props.
- Done when the low-pitch golden has shadows to the horizon band, `aotest` passes, and the High frame budget holds.

**W7. The phone look** (`config.ts:45-49`, `render/lowGrade.ts`, `game.ts:325`).
- Give Low a single-pass "grade lite": contrast, saturation, lift and vignette folded into a custom tone-map chunk, so there is no extra pass.
- Use baked vertex AO from W3 instead of SSAO.
- Bring a reduced civic layer to Low (LOD2 only, half density). The owner has never seen the street furniture.
- Give Low ground more value variation (a cheap macro noise), so grass isn't a flat lime field.
- Check every W item's Low variant here.
- Done when the Low goldens (390×844 DPR 3) beside today's Low clearly read as the same game as High, the phone-proxy frame budget holds, and `presetlight` passes, including its documented `VIEWS=` and the Low noon-shore case that fails today (+0.047).

**W8. Water you want to look at** (`world/water.ts`).
- Refraction: read scene colour behind the water, with depth-based absorption.
- Shoreline foam that follows contours.
- Rivers with flow direction and a visual surface that follows the carved bed (do not change the bed; see the rules).
- Surf on ocean coasts.
- Reflection on Medium at 0.25 res.
- River colour follows pollution from FABLE's field: brown sediment, green fertilizer, orange acid mine drainage, and finally **on fire** (GAME_DESIGN §5.5; the *Burning River* achievement).
- Done when the coast and river goldens on all three maps improve visibly, `shoretest` passes, and the budget holds.

**W9. Atmosphere and the colour of your choices** (`world/sky.ts:41-91`).
- Height-based aerial perspective tinted by sun direction (Mie glow toward the sun).
- Screen-space god rays at dawn and dusk, High only.
- Haze and dust over industry.
- **A smog dome** tied to the pollution field that pushes the whole grade toward sepia as the town gets dirtier (GAME_DESIGN §8: "the world's color follows your choices").
- Light pollution that fades the Milky Way. It exists; make it obvious.
- Done when a clean-valley versus dirty-city pair from the same camera shows the shift (metric: mean chroma and hue of the sky band), and `nightglow`, `yellowflash` and `nighttest` pass.

**W10. Things happen visibly** (render side of construction, demolition, disasters and endings; `sim/buildings.ts:356-366` rendering block, `render/particles.ts`, new `src/render/vfx/*`).
- **Construction.** Replace the Y-squash:
  - a clip-plane rise (discard above a per-instance height in the shader);
  - a floor-by-floor slab or skeleton reveal;
  - a crane on mid and high buildings;
  - a dust puff at completion.

  Cars and people stay at a construction site's kerb, using FABLE's construction events.
- **Demolition.** A shrink with a dust burst, then a rubble pile that clears.
- **Disasters** that read as set pieces:
  - Wildfire: a moving fire front with embers, a smoke column lit from below, and a char gradient on terrain and trees.
  - Hurricane: sideways rain, trees bending (vertex wind), surge foam on stroads.
  - Flood: water rising in the floodplain cells FABLE reports, with floating cars.
  - Landslide: a mud decal mesh, not five dodecahedra (`disasters.ts:43-58`).
  - The Florida Man parade float as a real slow vehicle model (FABLE drives it).
- **The Ponzi collapse ending** (FABLE drives the stages):
  - roads decay to gravel;
  - chains close, with dark signs and boarded windows;
  - every storefront becomes a Halloween pop-up, then nothing;
  - saplings push up through the parking lots;
  - the deer come back.
- **"Paradise Paved":** the cell tower disguised as a pine goes up where the last tree stood, with a plaque.
- Done when each set piece has a short frame sequence (contact sheet) and stays within budget while running. Particle caps stay inside the ring buffer.

**W11. Info views like Skylines 2** (`render/overlays.ts`, `sim/serviceIcons.ts`, `zones/zoning.ts:178-181` rendering only).
- Heatmaps from FABLE's `fieldFor()`, upsampled smoothly, projected onto terrain and buildings with a contour band and a clear ramp, a legend panel and readable values on hover (FABLE wires the hover).
- **Desaturate and lighten the world under an active view,** so the data pops.
- Zone tiles become thin outlines at about 30% fill.
- Need bubbles cluster with zoom and filter by the active view; in Goods view, show goods problems only.
- A colour-blind-safe ramp option (FABLE owns the setting; you own the palettes).
- Done when the info-view goldens on the reference block show a legible map for each view, and on desktop and phone there are no more than about 25 bubbles at the default zoom of a 1,000-person town.

**W12. Vegetation up close** (`world/foliage.ts`, `groundDetail.ts`, `trees.ts`).
- Alpha-to-coverage under MSAA for leaf cards, so there are no hard cutout edges.
- Wind sway scaled by weather.
- Verge grass along roads; denser ground cover at lot edges.
- Seasonal colour that really reads (fall colour in the hollers).
- Done when the close-up goldens lose the hard edges, `treevariety` passes and the budget holds.

**W13. Building LOD and culling** (`sim/buildings.ts` rendering block).
- A box-plus-atlas impostor LOD past about 800 m.
- Distance cull for tiny props.
- Shadow-pass cull.

This pays for W3, W4 and W6. Done when triangles in the overview goldens drop by at least 30% with no visible pop at the default zoom (an A/B sequence while zooming).

**W14. A drawn icon set for the HUD** (`art/icons.ts`).
- Replace the emoji the HUD uses today (toolbar, drawers, the inspector's `⚡✓ 🚰✓` rows, the More grid) with a drawn set in the sticker style `art/icons.ts` already uses for brands. Canvas or SVG, generated in code, crisp at 1× to 3×.
- Export it with names FABLE can map to its controls. Agree the list in `contracts.ts` or a small `art/hudIcons.ts` manifest; FABLE does the wiring.
- Done when a contact sheet shows every icon at 16, 24 and 32 px on dark and light, and a colour-blind simulation pass shows each status icon still distinguishable by shape.

**W15. Cars and people as objects** (`agents/vehicles.ts`, `vehicleFx.ts`, `people.ts`, `models/*`).
- **A camera-priority draw pool.** Rebind instance handles to the nearest N simulated cars about once a second, so nothing visible queues behind an invisible car on Low.
- Street voices go only to drawn cars (`streetAudio.ts:718`).
- Night gaps: pale cars take lamp light, dark paint gets a lamp sheen, the tow-truck amber halo, garbage-truck beacons, street furniture lit by the pools.
- Call people's `updateLod`, and scale their near range with FOV.
- Models for FABLE's new behaviour: tow trucks and ambulances at wrecks, buses with doors that open at stops, construction crews and vehicles, golf carts, commune VW buses driving (the models exist; FABLE dispatches them).
- Done when `motiontest`, `carsolid` (seeded, compared with base), `vehicletest`, `peoplelineup lists` and `feet`, `nightlook` and `carcam` day and night pass. You also need a Low town over 5,000 people where a sampled frame has 0 visible cars stopped behind an undrawn leader (a script checks this).

### Phase 2: sound that sells it (start when Phase 1 is half done; run alongside)

You can't hear. Say so in your log, and make up for it with rendering and measurement:
- `OfflineAudioContext` renders, with spectrograms (`streetaudio-figure.mjs` shows how).
- Loudness in LUFS.
- No clipping.
- Key and tempo checks (`musictest` does this for the piano).
- WAV files the owner can listen to, in `shots/audio/` (gitignored), with a listening checklist in your log for the owner.

**A1. The soundscape is a health bar** (`audio/ambience.ts`).
- Drive the beds from FABLE's `naturePct`, pollution and local density, not town-wide counts.
- The pristine valley: birdsong by species and season, the creek you can hear, crickets, fireflies' night.
- Then chainsaws as the forest goes, traffic drone, leaf blowers, truck revs, car alarms, and fireworks-or-gunshots.
- Make the traffic hum local to the camera's surroundings.
- Real surf on coasts, outboards on boats, and calls for the animals you can see (gators, sea lions, gulls).
- Done when a script renders 30 s from the same camera on a pristine and a paved valley and shows the spectral and event-density shift, and the WAV pair is in the owner's checklist.

**A2. An adaptive score** (`audio/piano.ts` and new modules).
- Keep the felt piano as the paradise layer.
- Add procedural stems that follow GAME_DESIGN §8's arc: porch banjo and fiddle (a plucked-string synth), then gas-station muzak, then a Top-40 country station.
- The stems are driven by population tier, money trouble, jam density (`flowEma`), disasters, night and season.
- **Parody radio ads** between songs, voiced by synthesized text, or as on-screen and feed text with jingles only if speech synthesis would mean a dependency or a network call.
- **Only original or procedurally generated music.** Any sample must be CC0 with its source and licence logged in `docs/aaa/AUDIO_SOURCES.md`, and kept small. No copyrighted songs, no real artists.
- Done when `musictest`-style checks pass for every stem (in key, never clips, crossfades without clicks), and a render of a population sweep with the stems shows the arc.

**A3. A UI and SFX vocabulary.**
- A satisfying zone-paint loop (`zone` exists and is unused).
- Cash ticks on income and on the weekly close.
- A milestone fanfare.
- Positional build, bulldoze and crash, and level-up shimmer.
- An error sound that isn't punishing.
- Ducking when a banner or feed post pops.

FABLE emits the events; you make every sound. Done when every `SimEvents` kind that the player causes has a sound, a script asserts each one fires once per event with no audio nodes created per frame (as `streetaudio` already checks), and there is a WAV montage for the owner.

**A4. World sound set pieces.**
- Drive-thru intercom gibberish at queues.
- A stadium roar on game nights at Slop 69 Field.
- Megachurch bells and organ on Sundays.
- Car stereos from passing lifted trucks and Cyberslops (country, a bro-podcast murmur) through the existing voice pool.
- Reversing beepers on parked cars backing out.
- Tyre squeal and crunch on real wrecks.
- Sirens that come from the moving emergency vehicles (they already do; keep it).
- HRTF `PannerNode` on High only, if it measures cheap.

Done when each has a test like `streetaudio-game.mjs` (voices sit on real sources, sleep when zoomed out, paused or muted) and the owner's checklist has a WAV of each.

### Phase 3: polish and proof (the last 15% of the run)
- Run every golden and look test; tighten `budgets.json` to the new numbers.
- Write `docs/aaa/LOOKBOOK.md`: before/after contact sheets for every W item, with the metric.
- Bundle size: main JS must stay ≤ 2.4 MB raw / 750 kB gzip unless a commit justifies it. Packs as small as they can be.
- Build `build:single` and leave the owner a folder to open on the phone, plus a checklist of what to look at.

---

## 7. How to work

- **Freeze what you test.** The dev server hot-reloads and kills running captures ("execution context was destroyed"). Serve a frozen copy with `node scripts/snapshot.mjs <name> <port>`, and run old and new side by side on two ports for every before/after.
- **Run scripts from the repo root.** `refblock.mjs` reads `shots/lookbook/town.json` relative to the working directory; run it from elsewhere and it silently grows a different town.
- **Step the sim; render only what you look at.** For traffic and people states use `__game.traffic.update(...)` and `__dbg.run(days)`, then render a single frame.
- **Seed everything you compare** (`SEED=`). One run proves nothing for anything with traffic in it: compare several seeds of old and new and report counts.
- **Look at your pictures.** Open every contact sheet before you write the commit. A metric that improves while the picture gets worse is a bad metric; fix the metric.
- **Delegate wide, review narrow.** Sol and Luna are good at: running a lineup or golden sweep across presets and maps; a codemod over many files you own; measuring one thing many times; writing a first draft of a test script. You keep the design, the shader code you'd be embarrassed by, the commit messages and the judgement calls.
- **Write results to files as you go.** A crashed run or a restarted session must not lose an hour.
- **When something you need is FABLE's, write it in `REQUESTS_ASTRA.md` and move on.** Don't wait idle.

## 8. Owner decisions (don't make these; list them in `docs/aaa/DECISIONS_ASTRA.md` with your recommendation)
- Anything that changes the game's tone or the brand look beyond the brand bible in `docs/WORKSTREAMS.md`.
- **The culture-war dial.** GAME_DESIGN (§3, Q2) says 3, with no real people. WORKSTREAMS says "dial at 10" with parody public figures. WORKSTREAMS is newer and governs today, but before any store release the owner should confirm.
- Whether tilt-shift is on by default, and how strong.
- Any visual that would show a real logo, real person or real place name.
- Music style choices beyond the GAME_DESIGN arc.
- Raising any budget instead of meeting it.

## 9. Reporting
At each milestone, and at the end, update `docs/aaa/LOG_ASTRA.md` and give a short report:
- Your branch and the last merged `aaa/integration` commit.
- What changed, with before/after numbers and contact sheet paths.
- Test results: what passes, what fails, and whether it fails on the base too.
- What's in `REQUESTS_ASTRA.md` and `DECISIONS_ASTRA.md`.
- The owner's phone checklist and WAV listening list.
- What you didn't get to, in priority order, so the next session can start there.

## 10. Running alone
If FABLE isn't running:
- Do FABLE's Phase 0 harness items yourself first: Windows line endings, `scripts/lib/browser.mjs`, the suite's CRLF and zero-test exit, the Node lock, the committed reference-block fixture. They are listed in `docs/aaa/FABLE.md` §6 under Phase 0.
- Create `aaa/integration` yourself from `aaa/briefs` and push your work through it.
- Stay in your lane until Phase 1 is done. Then take FABLE's list in its order: Phase 0 determinism, then the systems, then the UI. Follow FABLE's rules for those files, since they are stricter about balance.
