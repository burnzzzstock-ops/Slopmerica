# Slopmerica: parallel workstreams

Three agents work in parallel on top of the base branch `claude/festive-bohr-nugn55`, plus the core thread that owns integration. **Stay inside the files you own.** Shared interfaces live in `src/contracts.ts`; code against them exactly. The core thread merges every branch.

## The game in one paragraph
A Cities: Skylines 1-style 3D city builder in the browser (TypeScript + three.js r186 + Vite), played with mouse and keyboard and also on phones. The tone is X.com / AI-slop meme chaos with the culture-war dial at 10, both left and right memes, heavy internet culture, raunchy-ish, and dark but goofy. Real urban-planning math runs underneath (demand ratios, induced demand, a Growth Ponzi budget). There are three maps: **Holler County** (Appalachian PA/WV hollers and rivers), **Golden Coast** (NorCal: Malibu-style beaches, golden oak hills, sequoias) and **Gator Gulch** (Florida: flat bayous, marsh, turquoise coast). The game has four seasons and weather. The ending is every square inch built and every building maxed: endless sprawl, Tokyo meets Delhi. Hippie communes are scattered around the map as opposition. The look is semi-realistic like Skylines 1, but darker and goofier. The in-world mega-brand is **SLOP**, the owner's real merch line from Imagine Supply Co. (https://imaginesupply.co/).

## Content rules
- Raunchy-ish is fine: innuendo, drinking, smoking, reckless driving, crashes. No explicit sexual content.
- Mock ideologies, online behavior, corporations and both political tribes. No slurs, and no jokes aimed at race, religion-as-identity, disability or sexuality.
- Public figures appear only as obvious parody names (Elongated Muskrat, Zuckerborg). Keep the names in data so they're easy to change.
- Parody brands are preferred. The SLOP / Imagine Supply Co. brands are real and owned by the player, so use them straight.

## File ownership

| Workstream | Branch | Owns |
|---|---|---|
| **Core** (integration) | `claude/festive-bohr-nugn55` | `src/game.ts`, `src/main.ts`, `src/config.ts`, `src/contracts.ts`, `src/core/*`, `src/world/maps.ts`, `src/world/terrain.ts` (everything except the `material.onBeforeCompile` block), `src/render/camera.ts`, `src/roads/*`, `src/zones/*`, `src/sim/*`, `src/tools/*`, `src/ui/*`, `src/agents/traffic.ts`, `src/agents/pedestrians.ts`, `src/agents/communes.ts`, `src/style.css`, `index.html`, `vite.config.ts`, `package.json` |
| **A: Atmosphere** (Claude) | `ws/atmosphere` | `src/world/sky.ts`, `src/world/weather.ts`, `src/world/seasons.ts` (new), `src/world/trees.ts`, `src/world/water.ts`, the `material.onBeforeCompile` block in `src/world/terrain.ts`, `src/render/post.ts`, `src/render/particles.ts`, `src/audio/*`, `dev/atmosphere.html`, `src/dev/atmosphere*.ts` |
| **B: City Look** (Claude) | `ws/city-look` | `src/buildings/*`, `src/art/*`, `dev/buildings.html`, `src/dev/buildings*.ts` |
| **C: Cast & Feed** (Codex) | `codex/cast` | `src/agents/people.ts`, `src/agents/vehicles.ts`, `src/content/*`, `dev/cast.html`, `src/dev/cast*.ts` |

Rules:
- Don't edit files you don't own. If you need something from another stream, write it in your final report as a request.
- Don't add npm dependencies unless it's unavoidable. If you do, list them in your report; `package.json` belongs to Core.
- The fonts already loaded in `index.html` are Anton, Bungee, Overpass, Permanent Marker, Titan One and Yellowtail. If you need another Google Font, request it and fall back gracefully until then.
- Test in your own `dev/*.html` page. Vite serves them at `http://127.0.0.1:5173/dev/<name>.html`.
- Keep public signatures from the stubs you replace. Additive extras are fine.
- `npx tsc --noEmit` must pass before you push.

## Verification
`npm install && npx vite` runs the dev server. `node scripts/shot.mjs <url> <out.png> [js] [waitMs] [w] [h]` takes a headless Chromium screenshot with SwiftShader WebGL. Chromium lives at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`; if yours is elsewhere, edit the path in your own copy of the script. Look at your screenshots and iterate.

## Performance budget
Desktop at 60fps: about 1,400 cars, 400 people, 3,000 buildings and 40k trees. Phones: about a third of that. Use InstancedMesh and merged geometry, keep draw calls low, and avoid per-frame allocations.

## Brand bible (from the store)
- **Slop Script** is the main logo: "Slop" in a flowing baseball script with a swoosh tail underline, like vintage team jerseys. It comes in black on sand/cream, or cream on black with a distressed print texture. The closest loaded font is Yellowtail; draw the swoosh yourself.
- **SL⚡OP** Lightning: thin geometric caps in yellow on black, with a lightning bolt between SL and OP.
- **Slop Cannon** is the sub-brand: an old-timey cannon, often smoking. Slogans: "GET IN THE F*CKING CANNON" (heavy condensed block letters, and a lime-green version), "Loose Cannon", "Short Fuse", "Play With Fire", "Smoke Signal".
- **Characters:** **Wigette**, a blonde cartoon pig girl with star shades and a wink, and the **Cannon Boys**, two cartoon pig heads side by side (**Wiglet** is one of them).
- **Products** to reference in-world: Slop Script hoodie, beanie, snapback and mug; SLOP Work Hoodie; Slop Lightning Tee; Cannon Scribble Tee; **Slop 69** pinstripe baseball jersey; **Neural Fly** sweatshirt (a psychedelic neon fly); **Propane Paradise** beach button-up; **Fill Er Up** tee (an Uncle Sam-style guy pumping gas in front of a flag); **Pig Cabana** resort shirt and shorts; **My Own Propane**; **Cannon Coast** beach button-up (palms and a cannon); **Cabinet: After Hours**; **Social Club** jersey; **Bad Influence**; **Bad Luck Club** (two 8-balls); **Dirty Habits** (martini); **Hot Piece** (peach); **Sweet Trouble** (strawberry); **Cherry Fuse**.
- **Store accent color** is lime `#c6f432`. Slop cream is `#efe6cf`, ink is `#111111`, Cannon red is `#b3202a`.
- In-world mapping: Slop apparel stores; **Fill Er Up** gas stations; **My Own Propane** / **Propane Paradise** propane dealers; **Pig Cabana** beach resort; **Smokeshow** / **Smoke Signal** smoke shops; **Bad Luck Club** and **Cabinet After Hours** bars; **Neural Fly** AI data center; **Slop 69** ballpark; the **Slop Cannon** landmark; SLOP energy drink and SLOP beer. Billboards say `imaginesupply.co`.
