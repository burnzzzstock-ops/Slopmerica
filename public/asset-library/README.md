# Civic Foundry 1.0

Civic Foundry is SLOPMERICA's engine-agnostic modular asset distribution: 83 original procedural assets, 3 detail levels per asset, and 18 shared PBR materials.

## Contents

| Category | Count |
| --- | ---: |
| Windows | 8 |
| Doors | 8 |
| Storefronts | 8 |
| Roofs | 8 |
| Facades | 8 |
| Vegetation | 12 |
| Services | 18 |
| Streets | 13 |

`manifest.json` is the authoritative catalog. It contains IDs, labels, categories, descriptions, bounds, dimensions, materials, attachment sockets, and the URLs and metrics for LOD0, LOD1, and LOD2.

Each model is standard glTF 2.0 with a separate `.bin` geometry buffer. Material textures are shared PNG files under `textures/`: sRGB albedo, OpenGL +Y normal, and linear ORM with occlusion in red, roughness in green, and metalness in blue. Keep `manifest.json`, `models`, and `textures` in this relative folder layout when copying or hosting the library.

## Coordinates and placement

- Units: metres
- Up axis: +Y
- Authored front: +Z
- Root: horizontal bottom center
- Doors, storefronts, facades, vegetation, streets, and equipment: y = 0 at floor or ground
- Windows: y = 0 at the bottom of the sill assembly; translate to the required sill height
- Roofs: y = 0 at the eave/building-seat plane

Socket positions are local-space attachment points. Architecture uses `wall-anchor` and `building-seat`; infrastructure and street assets expose additional named utility, curb, road, deck, line, and side connections. Sockets provide position only, so the integrating application chooses orientation.

## Three.js loader

The repository includes `CivicLibrary` in `src/asset-library/library.ts`:

```ts
import { CivicLibrary, disposeAsset } from './asset-library/library';

const library = await CivicLibrary.open(
  new URL('/asset-library/', document.baseURI),
);
const asset = await library.load('street-bus-shelter', 1);
scene.add(asset);

// Independently loaded scenes are owned by the caller.
scene.remove(asset);
disposeAsset(asset);
```

`load()` returns a new group. If you clone a loaded asset, the clones share GPU resources; dispose the shared resources only after every clone is retired. Other engines can load the manifest and glTF files without this helper.

As initial LOD thresholds, try LOD0 above 180 projected pixels, LOD1 from 60–180 pixels, and LOD2 below 60 pixels. Profile for the target scene and use 15–20% hysteresis. Batch repeated instances by asset, material primitive, and LOD.

## Regeneration

Texture generation requires Python, NumPy, and Pillow. From the repository root:

```sh
npm run assets:textures
npm run assets:models
npm run assets:check
npm run assets:dev
```

The catalog is served at `http://127.0.0.1:5174/asset-library.html`. `npm run assets:build` writes the static catalog and library to `dist-assets`.

## SLOPMERICA integration boundary

This library is ready for integration but is not automatically substituted into the game. The existing building renderer uses one atlas-based, non-indexed building batch plus a separate indexed Kit batch with a custom `tile` attribute. Civic Foundry models use multiple standard PBR material primitives and external PNG maps. Integrate them through a dedicated cached and instanced render path, or add an offline adapter that repacks geometry and materials into the legacy batch contracts.

The models and textures are original procedural work for this repository with no downloaded models or third-party art. This provenance statement is not a separate license grant; the repository's applicable license and project terms govern use.
