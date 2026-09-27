# Asset Vault verification

Verified on 2026-09-27 with the repository's Three.js/Vite/TypeScript dependencies and headless Chrome using SwiftShader. These are asset-format and catalog checks, not populated-city performance benchmarks.

## Final inventory

| Item | Verified count |
| --- | ---: |
| Parametric family designs | 100 |
| Structural configurations per family | 40 |
| glTF asset files | 4,000 |
| LOD scenes | 12,000 |
| Distinct substantive geometry signatures | 4,000 |
| PBR surface sets / texture maps | 18 / 54 |
| Sign atlases / labeled plan regions | 100 / 4,000 |
| Rendered family previews | 100 |
| Shared geometry buffer | 16,435,520 bytes |

LODs, sign regions, and thumbnails are not counted as additional assets.

## Completed checks

- **Full static validation:** all 4,000 final glTF files and 12,000 scenes passed hash, buffer/accessor, finite geometry, normal, index, transform, bounds, LOD, image, and structural-uniqueness checks.
- **Repeat model generation:** two consecutive final model builds produced the same manifest SHA-256, including all 4,000 glTF hashes and the shared-buffer hash: `d072df16c5f2142554296c21009195d25e8990695079c9088d41aa1eee823b98`.
- **Full browser load sweep:** 4,000 assets / 12,000 scenes loaded, switched LODs, and disposed with zero browser errors. After the final gable repair, all 320 affected assets / 960 scenes were checked again, also with zero errors. The remaining geometry was unchanged. This sweep checks loaded scene data; the separate preview pass renders one representative per family.
- **Catalog interaction checks:** search, category and family filters, pagination, plan selection, LOD selection, and wireframe controls passed. A representative from every family loaded at all three LODs.
- **Visual review:** all 100 rendered family previews were reviewed in category contact sheets. Inverted neighborhood roof pitches found during that review were repaired; all 760 affected gable pairs were checked for opposing pitch, joined ridges, and level eaves. The eight affected previews were re-rendered.
- **Visual atlas:** all 100 images loaded, category counts were 35/35/30, family links opened their 3D model, and the mobile layout had no horizontal overflow.
- **Portable GLB exports:** final exports of GATHER Modern Farmhouse at LOD 0, World's Largest Fork at LOD 1, and County Water Tower at LOD 2 loaded and rendered in WebGL with embedded textures, one valid scene, correct source-LOD metadata, and no external buffer/image references.
- **Builds:** TypeScript checking, normal game build, single-file game build, and the isolated asset-catalog production build passed. Normal game outputs did not copy the optional asset vault.
- **Production smoke test:** the built static catalog loaded on desktop and mobile, changed all three LODs, and loaded all 100 atlas images with zero browser errors.

## Reproduce

See [ASSET_VAULT.md](ASSET_VAULT.md) for generator prerequisites, build commands, and integration guidance. The browser tools expect the isolated Vite server to be running.

```sh
node scripts/asset-vault/validate.mjs
node scripts/asset-vault/browser-check.mjs --full
node scripts/asset-vault/browser-check.mjs --screenshots
node scripts/asset-vault/browser-check.mjs --thumbnails
node scripts/asset-vault/overview-check.mjs
```

For a focused iteration, add `--families holler-cabin,gather-farmhouse` to either `--full` or `--thumbnails`. Those modes retain manifest-wide inventory checks and validate the requested subset; their reports identify the selected families and actual counts. Browser reports and temporary exports live in the ignored `shots/asset-vault/` folder.

## Practical limits

The collection is stylized procedural art: 100 family concepts with 40 geometric configurations each. It has not been integrated into zoning, services, collision, night lighting, or simulation. Draw-call batching, streaming, shared-resource ownership, and target-device city benchmarks remain integration work. A successful software-renderer check establishes load/render correctness; it does not certify hardware frame rates or every variant's artistic composition.
