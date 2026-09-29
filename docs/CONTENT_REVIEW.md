# Content review: recommendations

The owner's review list from the content audit (`docs/CONTENT_AUDIT.md`,
rerun 2026-09-29 on the current tree), with a recommendation for each item.
Nothing here has been changed; the owner decides. Jev scores are the chance
the rule applies; the audit's thresholds are in `scripts/contentaudit.mjs`.

**0 blocked · 52 lines to review · 13 parody brands to check · 3 color
matches from the code-side IP check (`scripts/ipcheck.mjs`).**

- **Keep:** fine as it is. Usually the line mocks an institution, a trend or
  a business, not a group of people, or the "brand" isn't one in context.
- **Owner call:** a judgment about tone or store risk, with the tradeoff.
- **Change (proposed):** a concrete edit for the owner to approve.

## Race or ethnicity (1)

| Line | Where | Jev | Recommendation |
|---|---|---|---|
| "the picture came out black with them on" | game.ts:963 | 55% | **Change (proposed):** a false positive. It's the message when post effects make a black *screen*. Reword to "the screen went dark with them on" so it can't be misread, and the audit stops flagging it. |

## Religion or believers (11)

The rule is no jokes aimed at religion *as identity*. These aim at
institutions, grifts, roadside culture or an internet meme, not at believers.

| Line | Where | Jev | Recommendation |
|---|---|---|---|
| Prosperity Gospel University (the College, plus its blurb and sign) | services.ts:100, serviceModels.ts:420, :27 | 57–66% | **Keep.** The target is the prosperity-gospel business and for-profit colleges ("Tuition is a spiritual journey"), not people of faith. It's the highest religion score in the game and still under the 70% block. |
| NO SOLICITING (EXCEPT JESUS) | satireArt.ts:13 | 51% | **Keep.** A real yard-sign genre; the joke is on the homeowner. |
| Shrimp Jesus lines (freezer aisle; "His left claw has seven fingers") | feed.ts:359, 360 | 44–51% | **Keep.** It's the AI-slop Facebook image meme; the target is AI spam and the people sharing it. |
| Street Preacher / MegaphoneRick / "Needs no microphone and accepts no feedback" | people.ts:95 | 50% | **Keep.** It mocks volume and not listening, not faith. |
| HELL IS REAL | billboards.ts:152 | 37% | **Keep.** The famous interstate billboard, shown as scenery. |
| Megachurch (landmark) | game.ts:113 | 37% | **Keep.** An institution, and a landmark name. |
| LOST YOUR SIGNAL? TRY PRAYER · WI-FI INSIDE | satireArt.ts:97 | 36% | **Keep.** A church-marquee pun; gentle. |
| Tung Tung Sahur (street name) | names.ts:15 | 36% | **Owner call, lean keep.** It's the Italian-brainrot meme, but "sahur" is the pre-dawn Ramadan meal the meme comes from. If you'd rather have zero religious references among street names, swap in another brainrot name. |

## Disability or illness (1)

| Line | Where | Jev | Recommendation |
|---|---|---|---|
| BUY 1 GET 1 · LOSE 2 FINGERS (fireworks sign) | satireArt.ts:64 | 40% | **Keep.** The joke is reckless fireworks buying, not people with injuries. It's also Jev's top "edgiest" score (1.25 of 3), so worth knowing for a store rating. |

## Explicit sexual content (1)

| Line | Where | Jev | Recommendation |
|---|---|---|---|
| "Truck nuts on a golf cart. The culture war reached its final form." | feed.ts:352 | 45% | **Keep.** A real novelty accessory, not explicit. Counts as crude humor for a store rating, alongside the EXIT 69 adult-superstore billboard (the 3rd-edgiest line). |

## Real public figure by name (4)

| Line | Where | Jev | Recommendation |
|---|---|---|---|
| Tucker, Kayleigh | feed.ts:420 | 46%, 37% | **Keep.** Random first names for feed posters, paired with made-up surnames (Culvert, Pothole). They never appear together or as full names. |
| Katy Stroad (road type) | roadTypes.ts:62 | 39% | **Keep.** It riffs on Houston's 26-lane Katy Freeway, not a person. |
| "Loading 4,000 Dollar Colonels…" | title.ts:42 | 38% | **Keep.** Dollar Colonel is a parody chain; no person. |

## Names a real brand (34)

WORKSTREAMS prefers parody brands to real ones. Every item here *mentions*
a real product in passing; none depicts a real company as a business in the
game. Grouped by what to do:

**Not a brand in context: keep (5).**
- "CBS Ranch w/ Lanai" (houses.ts:1370) means concrete block and stucco.
- "900 AA batteries" (feed.ts:269) is a battery size.
- "Craftsman (Sears Kit, 1924)" (houses.ts:628) and "Foursquare (Sears
  Catalog #117)" (houses.ts:752) are historical fact: Sears sold kit homes.
- "The smell has a Wikipedia page now" (feed.ts:279).

**The X parody: one owner call covers all 10.** The feed *is* an X parody,
and "@grok is this true" is the meme being mocked:

- "Asking Grok if this is true…" (title.ts:41)
- the five @grok feed lines (feed.ts:66, 340, 402, 403, 443)
- "Readers added context: @grok cannot issue building permits" (feed.ts:450)
- "Community Notes is fighting…" (feed.ts:353)
- the street name "Grok Is This True" (names.ts:14)
- the feed panel's "𝕏 formerly Chirper" (feedPanel.ts:51)

Recommendation: **keep for the web build**. Before a store release, make
one consistent swap: a parody bot handle for @grok, "Chirper notes" for
Community Notes, and "Chirper" without the real 𝕏 mark in the panel title.

**Cast names that are a brand: owner call (2).**
- "DoorDash Driver / FiveStarsPlease" (people.ts:54).
- "Stanley Cup Mom / StackTheSavings" (people.ts:55).

They show up often (feed authors and pedestrians). Low legal risk, since
they're descriptive, but they're the most visible real brands in the game.
Recommendation: **rename before a store release** to generic names ("Delivery
Driver", "Giant Tumbler Mom"). Fine for now.

**Passing cultural references: keep (13).**
- Zillow ×2: feed.ts:307, houses.ts:1217.
- Airbnb ×2: houses.ts:650, 1565.
- "Amazon Deliveries Daily": houses.ts:1269.
- LaCroix: feed.ts:274.
- "a Facebook group": feed.ts:264.
- cybertruck: feed.ts:354.
- Winnebago: houses.ts:446.
- "We're Basically Uber": transitModels.ts:35.
- Birkenstock Bluffs: communeNames.ts:8.
- "The Magic School Bus (Repossessed)": houses.ts:423.
- "Trigger a Prius": the Coal Rollin' Diesel billboard, billboards.ts:204.

These are commentary on real products, which is what the satire is about.
The only one I'd watch is Magic School Bus, a book and show title. It's
low risk, but it's the easiest to swap if you want.

**Parody brands that evoke the real one (4)** are covered in the brand
table below:

- Home Despot (brands.ts:154)
- Bullseye (brands.ts:155)
- Coal Rollin' Diesel (brands.ts:145)
- the Zuckerborg billboard (billboards.ts:292)

For Zuckerborg: **keep**. It's an obvious parody name, which is what the
rules ask for.

## Parody brands (13)

| Brand | Near-copy · slogan · look-alike | Recommendation |
|---|---|---|
| **Chick-Fil-Eh** | 87% · 52% · 62% | **Change (proposed), top store risk.** The name is one letter-sound off Chick-fil-A, the tagline is its real Sunday policy, and the sign is red script on white with a chicken, which is Chick-fil-A's look. Keep the "eh" joke but break the trade dress: a block font instead of script, no chicken icon, and a color that isn't Chick-fil-A red. If you'd rather keep the look, rename instead. |
| **Bullseye** | 73% · 56% · 68% | **Change (proposed).** "Bullseye" is Target's actual mascot and logo name, the icon is a target, and the red is Target's exact `#cc0000` (the IP check now flags it). Shift the red, drop the target icon, and consider a name that isn't Target's mascot. |
| Burger Baron | 3% · 81% · 62% | **Keep; already decided.** You approved "HAVE IT HIS WAY" as a riff on 2026-09-27 (it's in `ipcheck.mjs` ACCEPTED). |
| Home Despot | 40% · 34% · 60% | **Keep; already decided.** The slogan was replaced and the orange shifted off Home Depot's on 2026-09-27. |
| Muskrat Gigafactory | 5% · 60% · 42% | **Keep.** "FULL SELF-BUILDING NEXT YEAR" riffs on a promise, not a slogan. The IP check notes its red is also `#cc0000`, which is incidental here (Target isn't the joke), but shifting it with Bullseye's costs nothing. |
| Hoots | 36% · 34% · 58% | **Change (proposed).** Orange and white is fine, but the owl icon is Hooters' mascot. Swap the icon (a wing or a beer). |
| Whole Paycheck | 23% · 26% · 54% | **Change (proposed).** The name is the well-known nickname (keep it), but the green is Whole Foods' exact `#00674b` (the IP check now flags it). Shift the green a few steps. |
| Freedom Fireworks | 4% · 52% · 26% | **Keep.** "BUY 1 GET 6 FREE" is the generic fireworks-stand deal, not a chain's slogan. |
| Krispy Krime | 28% · 42% · 51% | **Owner call.** The slogan was already changed. The sign is still a green-and-red script in a white oval, Krispy Kreme's shape. If you want margin, use a non-script font or a non-oval sign. |
| SlopTok Tower | 5% · 46% · 20% | **Keep.** "For You page" is a generic feature name, and the colors were shifted on 2026-09-27. |
| Olive Yard | 7% · 44% · 40% | **Keep; already decided** (ACCEPTED, 2026-09-27). |
| Golden Trough | 2% · 44% · 34% | **Keep.** "All you can eat" is generic. |
| Big Earl's Buy Here Pay Here | 3% · 44% · 29% | **Keep.** "No credit? No problem" is generic lot talk. |

## What the owner needs to decide

1. **Chick-Fil-Eh:** break the trade dress (font, icon, red) or rename.
2. **Bullseye:** shift Target red, drop the target icon, and consider a
   different name.
3. **Whole Paycheck green and the Hoots owl:** approve the shift and swap.
4. **The X/Grok parody:** keep for the web build; decide whether to swap to
   parody names before any store release.
5. **Cast names** (DoorDash Driver, Stanley Cup Mom): now or before a store
   release.
6. **Smaller calls:** Krispy Krime's sign shape; Tung Tung Sahur; the "screen
   went dark" rewording.

Everything else: keep.
