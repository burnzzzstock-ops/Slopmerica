// Proposed fixes for messages scripts/learnability.mjs flags, written by hand
// (Jev doesn't write text), keyed by the message's first text as the scanner
// shows it. Proposals only: nothing here changes the game.
// "News:" marks red toasts that report an event the player can't act on; the
// proposal there is to show them in the normal colour, so red always means
// "you can do something about this".
export const FIXES = {
  // placement and road refusals
  'No road there': 'No road there: click a road to widen it.',
  'Outside the county': "Outside the county line: place it inside the map's border.",
  'Outside the county line': 'Outside the county line: end the road inside the border.',
  'Not in the water (yet)': 'Not in the water (yet): pick dry ground.',
  'Overlaps a road': 'Overlaps a road: move it beside the road, facing it.',
  'Overlaps {label}': 'Overlaps {label}: move it, or bulldoze {label} first.',
  'Overlaps an existing road': 'Overlaps an existing road: start or end on it instead of running along it.',
  'Hippies live here': "Hippies live here: build around their land, or click the commune to buy them out or sue.",
  'Too short': 'Too short: drag at least 8 m.',
  "Commune land: roads can't cross {name}.": "Commune land: roads can't cross {name}. Go around it, or click the commune to buy them out or sue.",
  'Curve too tight': 'Curve too tight: pull the bend out wider, or build it as two straight pieces.',
  'Too steep here': 'Too steep here: find flatter ground.',
  '{label} is already here': '{label} is already here: click it to inspect it, or pick an empty spot.',
  'The buses are not amphibious': 'The buses are not amphibious: put the depot on dry land.',
  'The drum circle rejected the bus easement': 'The drum circle rejected the bus easement: build the depot off commune land.',
  'Needs {DEPOT_COST}': 'A bus depot costs {DEPOT_COST}: wait for tax income, or take a loan in 💰 Budget.',
  "Can't build that here": "Can't build that interchange here: it needs open, fairly level ground around the crossing.",
  // money and communes
  'Not enough money to bribe hippies': 'Not enough money to buy out {name}: it costs {cost}. Save up, or sue instead.',
  'Not enough money for lawyers': 'Not enough money for lawyers: the suit costs {cost}. Save up, or take a loan in 💰 Budget.',
  'Not enough money: this tile costs {price}.': 'Not enough money: this tile costs {price}. Save up, or take a loan in 💰 Budget.',
  '{name} laughs at your money. They\'ve been here since 1969.': "{name} laughs at your money. They've been here since 1969. (Try suing, or build around them.)",
  '{name} spent your ${cost} on kombucha and stayed.': '{name} spent your ${cost} on kombucha and stayed. (Offer again, or sue.)',
  'No court in America will touch them. They are forever.': 'No court in America will touch them. They are forever: build around them.',
  "Can't undo {label}: it's already gone.": "Can't undo {label}: it's already gone, so there's nothing to put back.",
  // budget warnings
  '🛣️ A new road put the weekly budget in the red ({weekAfter}/wk)': '🛣️ A new road put the weekly budget in the red ({weekAfter}/wk): zone along it so new buildings pay for it.',
  '🛣️ A new street grid put the weekly budget in the red ({weekAfter}/wk)': '🛣️ A new street grid put the weekly budget in the red ({weekAfter}/wk): zone the blocks so new buildings pay for it.',
  "That road put the weekly budget in the red: +${weekBefore} → −${weekAfter}/wk. New buildings' fees cover it while the town grows; they stop when growth stops, and the upkeep doesn't.": "That road took the weekly budget from +${weekBefore} to −${weekAfter} a week. Zone along it: new buildings' fees cover it while the town grows, but they stop when growth stops and the upkeep doesn't.",
  // services
  '🗑️ {label} full ({store} t): trucks stopped': '🗑️ {label} is full ({store} t) and its trucks stopped: build another landfill or an incinerator in 🏛️ Services.',
  '🗑️ {label} 90% full: {pace}': '🗑️ {label} is 90% full ({pace}): plan a second landfill or an incinerator in 🏛️ Services.',
  '🗑️ {label} 75% full: {pace}': '🗑️ {label} is 75% full ({pace}): start saving for a second landfill.',
  '{icon} {n} buildings cut off from {u}': '{icon} {n} buildings are cut off from {u}: reach them with a plant, pipe or station in 🏛️ Services.',
  '🚨 {label} emergency: {atRisk} buildings, {residents} residents on the clock (first abandoned in ~{value} days)': '🚨 {label} emergency: {atRisk} buildings ({residents} residents) start leaving in ~{value} days. Open 🏛️ Services → {label} to fix it.',
  '🚨 {label} emergency: {atRisk} buildings {failing}.Slowed to normal speed.': '🚨 {label} emergency: {atRisk} buildings {failing}. Slowed to normal speed: open 🏛️ Services → {label}.',
  "{label} is full and its trucks stopped, but your other garbage sites ({others} t/day) handle all of the town's trash ({made} t/day). It still costs ${upkeep}/wk while it sits idle: bulldoze it if you don't need it.": "{label} is full and its trucks stopped, but your other garbage sites take {others} tons a day, more than the town's {made}. It still costs ${upkeep} a week while it sits idle: bulldoze it if you don't need it.",
  // grids, transit, saving
  'Those streets are all there already.': 'Those streets are all there already: drag the grid over new ground.',
  'Nothing here can be built: every street is already there': 'Nothing new to build: every street is already there. Drag the grid over new ground.',
  'Built a {nu}×{nv}-block grid: {value}': 'Built a {nu}×{nv}-block grid ({value}). The streets left out were red in the preview: redraw there to add them.',
  'That stop is already on this line': 'That stop is already on this line: pick another stop.',
  'A transit line vanished with its road. Planning remains undefeated.': 'A bus line vanished with its road. Planning remains undefeated: redraw it in 🚌 Transit.',
  '{name} created. It will run when an active depot can pretend to supervise it.': '{name} created. It runs once you have a bus depot to supervise it (build one in 🚌 Transit).',
  'Could not save in this browser': 'Could not save in this browser (storage is full or blocked). Keep a copy: 🐞 Report bug → 🏙️ Save city file.',
  'Buy the land next to yours first.': 'You can only buy land next to land you own: buy the tile next to yours first.',
  // zoning demand tooltip (letters and signed numbers)
  '{value}: builders want it ({letter} +{v}) / waiting for demand ({letter} {value}{v}; starts at +5) · dim lots are waiting': '{zone}: builders want it (demand +{v}) / waiting: demand is {v}, builders start at +5 · dim lots are waiting',
  // fine as they are (the scanner sees placeholders the player never does)
  'The trees had it coming. / New stuff in the toolbar.': "Fine: the banner's title names the milestone; this is its subtitle.",
  'The trees had it coming.': "Fine: the banner's title names the milestone; this is its subtitle.",
  '{nu} block{value} along, {S} m · {value} to set the first side, then pull out the width': 'Fine in game ("3 blocks along, 240 m · Click to set the first side, then pull out the width"); the jargon is the placeholders.',
  '{value} out the first side ({blk})': 'Fine in game ("Drag out the first side (Medium blocks)").',
  '▦ {name} grid ({blk}): {value} the first corner· on a road: the grid can run along it': 'Fine in game ("▦ Two-lane grid (Medium blocks): click the first corner · on a road: the grid can run along it").',
  'on roads with no {k} and no route to the highway': 'Fine in game ("on roads with no bus stop and no route to the highway").',
  "That grid put the weekly budget in the red: +${weekBefore} → −${weekAfter}/wk. Zone it so new buildings' fees cover the upkeep.": "That grid took the weekly budget from +${weekBefore} to −${weekAfter} a week. Zone the blocks so new buildings' fees cover the upkeep.",
  // news, not refusals
  'Storm surge closed {length} roads and damaged {damaged} buildings. Recovery: ${cost}.': 'News: nothing to do but pay. Show it in the normal colour, or add "Roads reopen as crews clear them."',
  'Mud buried {name}. Crews estimate three to five days and a suspiciously round invoice.': 'News: it clears by itself. Show it in the normal colour.',
  'Wildfire front is moving with the wind. Trees and buildings are at risk.': 'News with a stake: add what helps, e.g. "…at risk: fire stations nearby limit the damage."',
  'Florida Man blocked {name} with a homemade parade float.': 'News: it clears by itself. Show it in the normal colour.',
  'Crypto rug pull: {hit} office{value} discovered decentralization.': 'News (and a joke, keep the jargon): show it in the normal colour, or add "they\'ll refill as demand returns" if true.',
};
