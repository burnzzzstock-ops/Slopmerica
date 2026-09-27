# Department of Unnecessary Development Asset Vault

This generated folder contains 4,000 additional original SLOPMERICA assets: 100 parametric families × 40 structural variants. The three scenes in every glTF are LOD alternatives, so the 12,000 LOD scenes are not additional asset-count inflation.

| Category | Families | Assets |
| --- | ---: | ---: |
| Commerce | 35 | 1,400 |
| Infrastructure | 35 | 1,400 |
| Neighborhood | 30 | 1,200 |
| **Total** | **100** | **4,000** |

![Asset Vault overview](../../docs/assets/vault-overview.jpg)

See the [100 family thumbnails](./thumbnails/) for one representative per family. The canonical technical handoff, full family inventory, API notes, performance guidance, limitations, and integration TODOs are in [docs/ASSET_VAULT.md](../../docs/ASSET_VAULT.md).

The separate visual atlas is available at `http://127.0.0.1:5176/asset-vault-overview.html` while the catalog server runs.

## Use the catalog

From the repository root:

```sh
npx vite --config vite.vault.config.ts
```

Open [http://127.0.0.1:5176/asset-vault.html](http://127.0.0.1:5176/asset-vault.html). A production catalog build uses `npx vite build --config vite.vault.config.ts` and writes `dist/asset-vault`, which is already ignored through `dist/`.

This folder is intentionally under `vault-public`, not the game's normal `public` directory. The isolated Vite configuration serves it without making the normal game build copy the library. `package.json` is unchanged; these are direct commands rather than `npm run` scripts. The vault was built on a new base-game branch and does not modify the existing PR6 implementation.

## Rebuild

Python generation requires NumPy and Pillow 10.1 or newer. Run in order:

```sh
python scripts/asset-vault/textures.py
node scripts/asset-vault/build.mjs
python scripts/asset-vault/signs.py
node scripts/asset-vault/validate.mjs
```

For browser validation, keep the Vite server running and execute the two modes separately:

```sh
node scripts/asset-vault/browser-check.mjs --full
node scripts/asset-vault/browser-check.mjs --thumbnails
```

Set `CHROME_PATH` when a Chromium-compatible browser is not installed in a standard location.

## Distribution contents

- `manifest.json` is the canonical index for 100 families and 4,000 assets.
- `catalog.csv` is the searchable 4,000-row flat catalog with tags, satire, dimensions, and LOD counts.
- `models/` contains 4,000 glTF 2.0 documents. Every document has scenes 0, 1, and 2 for LOD 0, 1, and 2.
- `shared/geometry.bin` is the external 16,435,520-byte (15.67 MiB) geometry buffer used by all models.
- `textures/` contains 18 PBR sets × albedo/normal/ORM at 512 × 512, plus a review contact sheet. Six solid paint materials require no maps.
- `signs/` contains 100 atlases at 2048 × 2048, with 40 labeled 512 × 200 regions per atlas.
- `thumbnails/` contains 100 generated family representatives and is not part of the 4,000-asset count.

Models use metres, +Y up, +Z front, and a ground-centered root. Visible signs and props are included in bounds. `ground-anchor` and `street-front` sockets contain positions only; there are no authored colliders or gameplay registrations.

## Loading and export

`src/asset-vault/library.ts` provides `VaultLibrary.open()`, `vault.load(id, lod)`, `handle.root`, `handle.setLOD()`, and `handle.dispose()`. Loading parses all three glTF scenes. Disposal owns resources across all three scenes, so resource-sharing clones must stay co-owned with their handle. CPU-side Three.js caching is opt-in; the library does not enable it globally.

The source assets retain separate mesh nodes and therefore separate draw calls. They are not single baked batches. A production integration should apply projected-size LOD selection (roughly 180 px / 80 px thresholds), cap high-detail assets, and instance repeated assets or merge compatible geometry per material and chunk.

Export one LOD as a self-contained GLB with embedded PNG images:

```text
node scripts/asset-vault/export-glb.mjs --id <asset-id> --lod <0|1|2> [--out <file.glb>] [--force]
```

Without `--out`, output goes to `work/<asset-id>-lod<lod>.glb`. Existing files require `--force`.

## Status and limits

The 40 variants per family are 5 sizes × 4 layouts × 2 states with structural geometry changes. They are procedurally authored, not 4,000 individually hand-modeled assets. Distinct `geometrySignature` values verify serialized geometry/transform differences while excluding signs and common base pieces; they do not certify art quality.

Glass is a solid PBR surface, canopies and details are low-poly masses, interiors and authored collision are absent, and no human artist refined every variant. The vault is not yet registered with SLOPMERICA's services, zoning, renderer atlas, emissive/night pipeline, collision, or simulation. City-scale in-game performance remains to be measured.

This README does not grant a license or redistribution rights. Determine the repository's applicable terms before redistribution.
