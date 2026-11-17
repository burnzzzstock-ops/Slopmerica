# Integration requests

| File or interface | Cause and requested change | Work it supports |
| --- | --- | --- |
| Inspector, Settings and photo entry | Wire `g.rts.follow(ViewTarget)` and `g.rts.follow(null)`. The getter `g.rts.following` identifies the subject. Photo APIs are `g.photo.enter()`, `exit()`, `street()`, `move(right, up, forward)`, `setPose(x,y,z,yaw,elevation)`, `capture(framed, size?)` returning a PNG Blob, and `download(framed, size?)`. Public photo fields are `hour`, `weather` (`clear`, `cloudy`, `rain`, `fog` or null), `fov`, `focusDistance` in metres and `tilt` from 0 to 1. `size` can be `{width:3840,height:2160}`. Native resolution is the default. Wire the HUD entry and focus strength. | Let players use follow and take postcards |
| HUD, drawer and inspector controls | Map control IDs through `src/art/hudIcons.ts` (`hudIcon` and `HUD_CONTROLS`). Status glyph shapes work with colour removed. | Drawn HUD artwork |
| Content-audit scanner | A dry run classified 174 SVG geometry literals from `src/art/hudIcons.ts` as prose. Skip SVG path data when enumerating strings for review. | Reduces false positives and unnecessary review |
| Building save/load | `WorldFields.buildingAge` uses `Bld.born`, but the current serialized building tuple omits it. Preserve age in new saves with a compatible fallback for older tuples. | Material weathering across reloads |
| Simulation RNG isolation | three.js UUID allocation consumes `Math.random` when render objects are created. Civic and other preset-specific objects change that stream. Please keep simulation randomness on its explicit seeded RNG, as planned in S0. | Full simulation equivalence across graphics presets |
| Traffic and parking draw ownership | Expose a rendering-only reconciliation contract with car ID, kind, stable appearance seed, pose and current handle. Rebinding must preserve moving/parked ownership and invalidate `traffic.drawn`. The renderer can rank nearby projected cars and keep stable virtual handles. | Camera-priority draw pools on large Low towns |
| Goods view and legend controls | Goods currently has no `InfoViewId` or `Problem` source. Add typed goods fields/problems when available and wire the rendering legend and palette APIs as they land. The renderer will suppress unrelated service bubbles in this view. | Genuine goods information and accessible legends |

The canonical reference fixture landed at `10c8b8e`. Unknown test names fail as of `52e217e`. The typed events, field accessors, building age/condition and follow targets landed through `effaa9e`.
