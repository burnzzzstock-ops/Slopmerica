# Polish pass: audit log

Working record for the gameplay audit of the 5-minute San Slopcisco recording
(2026-09-25). Each item: what the recording showed, what the code actually
did, what changed, and the script that keeps it fixed. "Observed" means
visible in the recording; causes below were confirmed by reproduction, not
inferred from the video.

## System map (money, tools, services)

| Seam | Authoritative source | Views of it |
| --- | --- | --- |
| Money | `Sim.spend / earn / refund` (src/sim/sim.ts) write the week's `ledger` and a labelled `transactions` log | HUD treasury + `/wk`, Budget panel, in-the-red card, placement tips, bug reports |
| Weekly rate | `Sim.forecastWeek()`: the recurring lines at today's rates (taxes, road upkeep, service upkeep, imports, transit, policies, freight, loan payments) | HUD `/wk`, Budget "Every week", `afterSpend()` projections |
| Weekly bill | `Sim.weekly()` bills the same lines as the forecast (`weekLines(false)`), then reconciles cash against the ledger | Budget "Last week", `ledgerDrift` |
| Affordability | `Sim.cantAfford(cost)` (cash + $20k credit line) | every placement's preview and commit |
| Active tool | `Tools.active` / `extTool` / `placingLabel` | toolbar, open panel's highlighted card, "Placing …" badge, ghost, cursor tip, click handler |
| Service placement | `canPlaceService` → `findServiceSpot` (shared by preview and click) | ghost colour, tip, `placeService` |
| Undo | `Game.undoStack`: roads, lane upgrades, placed buildings; refunds exactly what was paid | Undo button title, Ctrl+Z, toast |

## Fixed

### P0-A: the weekly figure lied about one-time spending
- **Observed (4:10–5:04):** cash fell ~$40k while the HUD showed +$266/wk, then the rate jumped to −$41,659/wk and later −$16,272/wk.
- **Cause:** `weeklyNet()` returned *last week's total cash change*, construction, impact fees, grants, refunds and loan money included, and only changed when a week closed. A service spree showed up a week late as a "weekly" deficit.
- **Also mis-booked:** lane upgrades were booked as road upkeep, bus depots and disaster recovery as service operating cost, transit/policies/freight/refunds/loans as "other".
- **Now:** the ledger has recurring and one-time kinds. The HUD's `/wk` is a live forecast of recurring lines only. Every transaction is labelled. Each weekly close checks cash change = ledger sum (a mismatch logs an error that bug reports capture). The Budget panel shows every-week lines, this week's one-time money, last week's reconciled cash, recent transactions, the credit line and the bankruptcy rule. Service previews show `cash after · rate → new rate`. Going into the red shows a non-blocking card with the recent causes, the weekly rate and credit left.
- **Before/after (scripts/ledgertest.mjs, same six-service spree, $74,000):**
  - before: HUD −$39/wk during the spree → **−$74,299/wk** when the week closed → −$1,027/wk.
  - after: HUD moves at most $296 (the new buildings' upkeep); weeks reconcile to the dollar.
- **Finding for balance (not changed):** a 100-person town runs about **−$1,450/wk** in recurring costs, mostly road upkeep, and lives on one-time impact fees from new buildings. That is the "Growth Ponzi" premise; it was invisible before. The Budget panel now says so ("Growth money … stops when growth stops"). Whether it is too harsh for a first session is a playtest question.

### P0-B: a building stayed in hand after switching tabs
- **Observed (4:56, 4:23):** a Sheriff's Office ghost and warning under the Garbage tab; a Water Tower label under Garbage.
- **Cause:** the Services category tabs changed the panel but not the tool.
- **Now:** switching category puts the building away. Tool changes re-render the open panel so its highlighted card follows. Desktop shows "Placing … · Esc or right-click to cancel" with a Cancel button. Right-click cancels whatever is in progress, then puts a placement tool away (right-drag still orbits).
- **Found on the way:** four quick clicks bought four $11,000 offices (the spot finder snapped each click next to the last). Pointing at an existing building no longer snaps. Ctrl+Z never undid anything (plain Z opened Zoning first). Undo now also covers placed services, depots and landmarks, and names what it reverses: "Undo Sheriff's Office (+$11,000 back)".
- **Script:** scripts/tooltest.mjs.

### Services status line was frozen while the panel stayed open
- **Observed (2:30–4:13):** "130 kL/day used · 0 built · importing 130" while population grew 142 → 243.
- **Cause:** the line was rendered once when the panel opened; utilities are recomputed daily.
- **Now:** open panels refresh their live numbers twice a second.

### P1-C: roads say the rule and the way out
- **Observed (0:27):** "Birkenstock Bluffs won't let you. Pay them off or sue." Joke first, rule unclear, remedy not offered.
- **Now:** "Commune land: roads can't cross Patchouli Pines. Pay them off $56,000 (64% chance) or sue $13,000 (47%, 20 days). Click here for options." Clicking anyway spends nothing and opens the commune, whose panel now says what happens if a pay-off or lawsuit fails. Forever communes say "Protected land … Roads must go around." A road you can't afford says how much it needs. **Script:** scripts/roadrules.mjs.

### P1-C: zoning says what it did and why lots wait
- A brush stroke reports "Zoned 50 lots Suburban Slop (Low Res) · 13 outside your land (buy it in 🏞️ Land) · 9 already zoned something else (Dezone first) · builders want it (R +60)".
- With the zoning tool out, zoned lots are bright when builders want them and dim while waiting for demand; the tip says which.
- Clicking an empty zoned lot opens it with the primary reason: waiting for demand (with a link to that demand card), a back lot (only street-front lots start buildings), or in line (how many buildings a day builders start, across how many empty lots).
- **Script:** scripts/zonetest.mjs.

### P1-D: services read as choices
- Each category says whether it's covered by your buildings, by a paid fallback (highway imports, the county trash contract, with its weekly price and limit), or short, and why buildings are cut off (no road; no plant and no route to the highway; past the import limit). It compares the cheapest local building ("A Groundwater Well Tower ($7,000 + $30/wk) makes 800 kL/day: costs about $26/wk more than importing"). Coverage services say what being uncovered risks. Cards show output or reach. "Boil notice pending" is marked as a joke.
- **Script:** scripts/svcstatus.mjs.

### P1-E: progression you can find later
- The 250-person unlock is a small card ("🔓 Unlocked at 250 people: Luxury Slop apartments · Zoning → 🏢 Luxury Slop (High Res)") with Open, which goes there with it selected; the card says NEW until used. Celebrations during placement shrink to a notice. Locked cards give the population they need. The 🌲/🏙️ meters open a card explaining both, with live numbers and the win condition.
- **Script:** scripts/progresstest.mjs.

### Also
- Mouse at a screen edge scrolls the map (Settings → Edge scrolling). **Script:** scripts/edgetest.mjs.
- Bug reports now carry frame times, the slowest frames with what the game was doing, graphics state (effects on/off and why), demand and a short timeline; F3 shows where frame time goes.

## Remaining (ranked)

1. Junction at 1:27–1:37 (dark slab, queue behind a DUI crash): needs the recording's save to reproduce.
2. Balance: the recurring deficit of an early town (see P0-A finding). A playtest question before tuning.
3. "143/300" vs HUD 142: the transit notice reads population at the moment of the click while the HUD refreshes four times a second; not a data mismatch.
4. P2: persisted audio/motion settings, colour-blind-safe zone patterns (the overlay still relies on hue plus brightness), keyboard focus through every panel.
5. Phase 3: observe five unfamiliar players on the first neighbourhood (the report's playtest questions) before further tuning.
