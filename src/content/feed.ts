import type { FeedContext, FeedEventKind, FeedPost } from '../contracts';

type Rng = () => number;
type Badge = FeedPost['badge'];
type Vars = Record<'city' | 'road' | 'brand' | 'building' | 'commune' | 'amount' | 'season' | 'weather' | 'population' | 'nature' | 'sprawl' | 'count', string>;

interface Persona {
  name: string;
  handle: string;
  badge: Badge;
  bg: string;
  emoji: string;
  reach: number;
}

const roads = ['Freedom Boulevard', 'Old Creek Road', 'Whispering Pines Parkway', 'Route 9', 'Liberty Stroad', 'Heron Marsh Drive'];
const brands = ["Possum Pete's", 'SprawlMart', 'Dollar Colonel', 'Burger Duke', 'Waffle Bunker', 'Chick-Fil-Eh', 'Neural Fly'];
const buildings = ['the new drive-thru', 'the five-over-one', 'the mega gas station', 'the luxury storage units', 'the vape-and-mattress plaza'];
const communes = ['Sunflower Commons', 'Mossy Rock Collective', 'Free Range Acres', 'The Yurt District', 'Moonwater Cooperative'];

// Four wrappers times 256 base lines = 1,024 textual combinations before context,
// personas, media, notes, and replies are varied.
const wrappers = ['', 'BREAKING: ', 'Local update: ', 'Reply guys hate this: '];

const templates: Record<FeedEventKind, readonly string[]> = {
  gameStart: [
    'Welcome to {city}: population {population}, nature still in original packaging.',
    '{city} just dropped. Beautiful views, zero traffic, enormous monetization potential.',
    'Day one in {city}. Every tree is standing between us and a ribbon cutting.',
    'Moved to {city} for the peace and quiet. Hearing rumors about a 120-pump gas station. Finally.',
    'The road to prosperity begins in {city} and ends in a center turn lane.',
  ],
  roadBuilt: [
    '{road} connects two places that were already connected, but faster on paper.',
    'Fresh asphalt on {road}. You can still smell the public-private partnership.',
    'They paved a perfectly good desire path and called it {road}.',
    '{road} has curves, drainage-ish, and a shoulder that becomes a ditch without warning.',
    'Road enjoyers, we are eating GOOD on {road} today.',
  ],
  stroadBuilt: [
    '{road} is neither street nor road. It is a lifestyle corridor.',
    'Seven driveways per block on {road}. Traffic engineers hate this one weird trick.',
    '{road} has a 55 mph limit and a bus stop in a ditch. Balanced design.',
    'The left calls it hostile design. The right calls it not enough lanes. I call it lunch traffic.',
    '{road} is fast enough to be scary, slow enough to be late.',
  ],
  highwayBuilt: [
    'New highway removed ten minutes from the commute and added thirty miles to everyone\'s ambitions.',
    '{road} is OPEN. The induced demand is already circling the block.',
    'Finally, a highway wide enough to see from the weather satellite.',
    'They said the bypass would save downtown. Downtown would like a Community Note.',
    'Highway ribbon cutting in {city}. Scissors provided by the bond market.',
  ],
  bridgeBuilt: [
    'The {road} bridge is a triumph of concrete over going around.',
    'Bridge open. River asked for fish passage and received decorative lighting.',
    'You can now cross the water without looking at it. Progress.',
    'Nothing says responsibility like six lanes over a creek you could jump.',
    'The bridge bike lane is painted directly into everyone\'s imagination.',
  ],
  laneAdded: [
    'Just one more lane bro. {road} is gonna be FINE this time.',
    'They widened {road}. Traffic is permanently solved until 4:15 PM.',
    '{road} got wider and my destination somehow got farther away.',
    'ONE. MORE. LANE. The ancient ritual is complete.',
    '@grok explain induced demand but make it agree with me.',
    'The woke mob said geometry has limits. {road} said hold my energy drink.',
    'We defeated congestion by giving it more habitat.',
  ],
  roadBulldozed: [
    'RIP {road}. You were young, over budget, and already full of potholes.',
    'They removed {road}; traffic discovered every residential side street.',
    'Bulldozing a road is road construction in reverse, so GDP went up twice.',
    'Pour one out for {road}, preferably into an approved storm drain.',
    'The map says {road} is gone. My GPS has chosen denial.',
  ],
  zoned: [
    'New zoning in {city}. The render shows 14 mature trees that are not included.',
    'Public hearing lasted four hours. The zoning map changed color anyway.',
    'Love the mixed-use district: storage units mixed with a drive-thru.',
    'The left wants apartments, the right wants acreage, the developer wants a variance. Developer wins.',
    'Rezoned from Unactivated Land to Tax Base With Decorative Pond.',
  ],
  buildingOpened: [
    '{building} is OPEN under the {brand} sign. First 100 get a traffic cone.',
    'Grand opening at {building}. The drive-thru line has achieved road status.',
    '{brand} opened another location because the previous one is visible from here.',
    'Finally, {city} has {building}. We used to drive eleven minutes for this.',
    'Ribbon: cut. Parking: 92% empty. Economic development: achieved.',
  ],
  buildingLeveled: [
    '{building} leveled up. Same parking lot, now with stone veneer.',
    'Luxury upgrade at {building}: rent up, shrub count unchanged.',
    '{brand} added a story visible only in the tax assessment.',
    'They installed black window trim. You know what that means: artisanal rent.',
    '{building} has evolved into its final beige form.',
  ],
  buildingDemolished: [
    '{building} is gone. The sign outlived it by six minutes.',
    'Demolition at {building} produced affordable gravel parking.',
    'They tore down local history to preserve the character of the tax district.',
    'RIP {building}. A Halloween pop-up already wants the airspace.',
    'Building removed; memories available for lease.',
  ],
  crash: [
    'Fender-bender on {road}. Everyone is shaken; the Tire Iron billboard is thrilled.',
    'Traffic stopped on {road} after two drivers attempted the same gap. No serious injuries.',
    'Another crash near {brand}. Maybe seven curb cuts in 200 feet was ambitious.',
    '{road} is backed up after a low-speed collision. Please stop filming and merge.',
    'Minor wreck, major reply section.',
  ],
  drunkCrash: [
    'Impaired driver hit a light pole on {road}. Nobody seriously hurt. Get a ride home.',
    'DUI crash outside {building}; crews are clearing debris. The jokes can wait.',
    'A bad decision ended against a guardrail. Everyone survived; license did not.',
    'Reminder from {city}: your car is not a designated driver.',
    'Drunk driving is not lore. It is paperwork, sirens, and people who did not ask for it.',
  ],
  pedestrianHit: [
    'Driver struck a pedestrian on {road}. They are receiving care. Slow down.',
    'Another person hit where the sidewalk disappears. The design is part of the story.',
    '{road} is closed after a pedestrian collision. Wishing them a full recovery.',
    'Paint is not protection. A person was hit in the crosswalk today.',
    'Someone walking was injured. Replies arguing about reflective clothing will be muted.',
  ],
  trafficJam: [
    '{road} currently has the speed and emotional tone of a group project.',
    'Traffic backed up past {brand}. Estimated travel time: yes.',
    'Gridlock in {city}. The traffic app is displaying a solid red cry for help.',
    'Reply guys explaining zipper merges from three miles back, assemble.',
    'The anti-car people are smug. The pro-car people want a lane. Nature remains offline.',
  ],
  communeFound: [
    'Discovered {commune} in the woods. They have tomatoes, drums, and no parking minimum.',
    '{commune} is directly on the proposed interchange footprint. Awkward.',
    'Local hippies discovered with suspiciously functional rain barrels.',
    '{commune} has one van, twelve hammocks, and terrifying procedural knowledge.',
    'People at {commune} appear happy without a warehouse membership.',
  ],
  communeProtest: [
    '{commune} is blocking bulldozers with a drum circle in 7/8 time.',
    'Protest at {road}: NO JUSTICE, NO PEACE, NO ADDITIONAL CURB CUTS.',
    'Hippies chained themselves to a sycamore. County says the tree lacked the proper form.',
    '{commune} brought snacks and one devastatingly detailed watershed map.',
    'The commune deployed acoustic guitar. Deputies request chord charts.',
  ],
  communeBribed: [
    '{commune} accepted {amount} and an easement behind the tire shop.',
    'Conflict resolved: the commune gets solar panels, the developer gets everything else.',
    '{commune} rebranded the payment as reparative mulch funding.',
    'The drum circle ended after an anonymous donation of {amount}.',
    'County purchased community goodwill at the competitive rate of {amount}.',
  ],
  communeSued: [
    '{commune} filed suit. Their bicycle attorney has 340 pages of exhibits.',
    'The hippies lawyered up. Repeat: the hippies lawyered up.',
    'Suit claims {road} would disturb wetlands and a very old sourdough starter.',
    '{commune} v. County is trending above the grand opening.',
    'The bulldozer is idling while everyone learns “irreparable harm.”',
  ],
  communeLawsuitLost: [
    '{commune} lost. The ruling was 84 pages; the road plan was arrows on a napkin.',
    'Judge clears {road}. Bulldozers posting eye emojis.',
    'Commune lawsuit dismissed. Bake-sale proceeds insufficient for appeal.',
    'County wins. Watershed loses on a technicality.',
    'Legal obstacle removed; physical obstacles scheduled for Monday.',
  ],
  communeForever: [
    '{commune} secured permanent protection. A developer just whispered “density.”',
    'The commune stays FOREVER. Patchouli futures up 600%.',
    'Conservation covenant recorded. Even the bulldozer has to go around.',
    '{commune} cannot be paved. Engineers are studying tunnels and spite.',
    'A piece of {city} will remain green. Ratio that, asphalt lobby.',
  ],
  treesCut: [
    '{count} trees converted into views of {building}.',
    'Chainsaws active near {road}. The brochure still says “wooded setting.”',
    'They named it Whispering Pines after removing the part that whispers.',
    'Tree cover is {nature}. Parking visibility has never been better.',
    'Old-growth timber successfully transformed into short-term revenue.',
  ],
  natureMilestone: [
    'Nature remaining: {nature}. Great news for anyone who hates shade.',
    '{city} hit an ecological milestone and the milestone points downward.',
    'Wildlife habitat now comes in convenient median-sized portions.',
    'Birdsong has been replaced by a backup alarm in the official soundscape.',
    'We preserved nature as a mural inside {building}.',
  ],
  populationMilestone: [
    '{city} population reaches {population}. All of them are trying to turn left.',
    'Welcome resident {population}! Your commemorative cul-de-sac is ready.',
    'Population boom in {city}. Housing discourse has become self-aware.',
    '{population} people, {population} opinions about the bypass.',
    'More neighbors, more traffic, more accounts named LocalTruth1776.',
  ],
  sprawlMilestone: [
    'Sprawl completion: {sprawl}. The edge of town filed for relocation.',
    '{city} unlocked “Somewhere Else Is Twenty Minutes Away.”',
    'The metro has three downtowns and none of them are downtown.',
    'New growth boundary established immediately beyond the old boundary.',
    'From ridge to retention pond: {sprawl} and climbing.',
  ],
  maxLevelReached: [
    '{building} hit MAX LEVEL: mixed-use because it contains two chains.',
    'Final evolution: luxury facade, rooftop HVAC, no rear exit.',
    '{brand} has achieved architectural dominance.',
    'Property-tax spreadsheet making cartoon heart eyes.',
    '{building} is too big to fail and too wide to walk around.',
  ],
  lowMoney: [
    'County balance is {amount}. Have we tried renaming debt “future growth”?',
    'Low funds. The ribbon-cutting scissors are listed on Marketplace.',
    'Budget meeting: coffee removed, consultant retained.',
    '{city} is running out of money at the speed it adds obligations.',
    'We can maintain a road or build one with a federal grant. Easy choice.',
  ],
  bankrupt: [
    '{city} is bankrupt. Growth paid for growth until growth sent an invoice.',
    'Municipal balance: {amount}. Vibes: in receivership.',
    'Turns out impact fees are a snack, not a pension plan.',
    'The bond market has unfollowed {city}.',
    'County assets: 900 miles of road and one ceremonial shovel.',
  ],
  taxRaised: [
    'Taxes raised by {amount}. The replies have declared 1776 again.',
    'New tax maintains the roads everyone demanded and nobody wishes to fund.',
    'Property tax went up. Profile pictures became more flag-shaped.',
    'Council raised taxes, then scheduled town halls about lowering taxes.',
    'Fiscal conservatives demand pavement; fiscal reality entered the replies.',
  ],
  taxCut: [
    'Taxes cut by {amount}. Potholes asked whether this includes them.',
    'Tax cut approved. Future maintenance assigned to a future commissioner.',
    'Everyone gets twelve dollars and a bridge with trust issues.',
    'The county starved the beast. The beast was storm drainage.',
    'Tax cut! Please avoid looking directly at the unfunded liability.',
  ],
  seasonChange: [
    '{season} has arrived in {city}. Seasonal affective zoning begins now.',
    'First day of {season}: beautiful light on the retention pond.',
    'It is {season}, according to twelve chain-store displays.',
    '{season} update: scenic roads, deferred maintenance, leaf photos from traffic.',
    '{city} entered {season} with {nature} tree cover.',
  ],
  weatherChange: [
    'Weather: {weather} over {city}. Drive like your deductible can see you.',
    '{weather} on {road}. Headlights on, reply-guy expertise off.',
    'Forecast: {weather}, with someone blaming zoning.',
    '{city} has {weather}. The Waffle Bunker index is being monitored.',
    'Weather app: {weather}. Local dads: “roads are fine.”',
  ],
  nightfall: [
    'Night falls on {city}. Every gas-station canopy becomes a minor sun.',
    '3 a.m. on {road}: six empty lanes and a red light for nobody.',
    'The stars used to be incredible, says Earl and the historical exposure slider.',
    'Goodnight to everyone except the lifted truck outside {building}.',
    'The county sleeps. Neural Fly absolutely does not.',
  ],
  serviceBuilt: [
    'Ribbon cutting at the new {building}. The mayor thanked himself for his courage.',
    '{building} is open. Staffed by one guy named Randy and a laminated binder.',
    'They built {building}. My taxes went up and so did my expectations. One of those is wrong.',
    'Finally, {building}. Only took three referendums and a guy yelling about fluoride.',
    '{city} opened {building} and a Facebook group already wants it closed.',
  ],
  blackout: [
    'Power out in {count} buildings. The generator guy is charging $400 an hour and has never been happier.',
    'Blackout across {city}. Somebody tell the grid that the cloud runs on electricity.',
    'No power again. Grandpa says this is why he stockpiled 900 AA batteries in 1999.',
    'The lights went out and my smart fridge unfollowed me.',
    '{count} buildings dark. The official statement blames windmills, which we do not have.',
  ],
  waterOutage: [
    'No running water in {count} buildings. Showering with LaCroix like our ancestors did.',
    'Taps are dry. The artisanal water store downtown raised prices 300%. Capitalism works.',
    'Water outage day {count}. I have discovered what dry shampoo was invented for.',
  ],
  sewageBackup: [
    'Sewage backing up in {count} buildings. The smell has a Wikipedia page now.',
    'Toilets aren\'t flushing and the HOA sent a letter about my lawn.',
    'The sewer is full. Nobody will say where it all goes. We all know where it goes.',
  ],
  garbagePile: [
    'Trash piling up in {count} buildings. The raccoons have unionized.',
    'Garbage day was three weeks ago. The bags are forming a government.',
    'My trash can is now load-bearing.',
    'The dumpster behind the Slop Mart has achieved sentience and is running for city council.',
  ],
  landfillFull: [
    '{building} is FULL. Mt. Trashmore is now visible from the interstate and has a ski lift proposal.',
    'The landfill hit capacity. Plan B: a second, larger landfill named after the mayor.',
  ],
  buildingFire: [
    '{building} is ON FIRE. Everyone is filming. Nobody called 911.',
    'Smoke over {city}: {building} is burning. Somebody said "it\'s the vibe" and got ratioed.',
    'Huge fire at {building}. Volunteer fire dept is en route after finishing their chili.',
    'FIRE at {building}. The comments are already blaming a different political party.',
  ],
  buildingBurned: [
    '{building} burned to the ground. No fire station close enough. Thoughts and prayers deployed.',
    'RIP {building}. The fire department was "fifteen minutes out" for forty minutes.',
    '{building} is ash. The insurance company is already typing the word "unfortunately."',
  ],
  abandoned: [
    '{building} has been abandoned. It is now the most affordable housing in {city}.',
    'Another one abandoned: {building}. The squatters left a 4.5-star review.',
    '{building} is empty. Zillow calls it "a blank canvas with character."',
    'Abandoned: {building}. No power, no water, no problem for the urban explorers.',
  ],
  crimeWave: [
    'Crime spike near {building}. Neighborhood app is 90% suspicious-van posts.',
    'Somebody stole a catalytic converter off a catalytic converter.',
    'Police response time near {building}: "just move." Crime is up.',
  ],
  sickness: [
    'Half the block near {building} is sick. Doctors say it\'s the water. Influencers say it\'s 5G.',
    'Urgent care wait is 6 hours. I have healed naturally out of spite.',
    'Everybody near {building} has a cough. The essential oil MLM has never been busier.',
  ],
  pollution: [
    'The air in {city} now has a flavor. Tastes like freedom and diesel.',
    'Air quality in {city} is "Rolling Coal." Stay indoors, keep grinding.',
    'Sunset was beautiful tonight. Scientists say that\'s the pollution.',
  ],
  merchDrop: [
    'SLOP DROP: Slop Script hoodies, questionable judgment, cream ink. imaginesupply.co',
    'Slop 69 pinstripe jersey landed. Dress for the collapse. imaginesupply.co',
    'GET IN THE F*CKING CANNON. Slop Cannon gear at imaginesupply.co',
    'Neural Fly sweatshirt: psychedelic insect, data-center energy. imaginesupply.co',
    'Propane Paradise and Pig Cabana resort shirts. imaginesupply.co',
    'Bad Luck Club, Dirty Habits, Cherry Fuse. Closet rezoned SLOP. imaginesupply.co',
    'Cannon Coast: palms, cannon, no environmental review. imaginesupply.co',
  ],
  ambient: [
    'Saw a MAN WALKING on {road}. Just walking. Has anyone else seen this??',
    'Was that fireworks or a transformer or somebody\'s exhaust tune?',
    'The left wants a bike lane. The right wants a turn lane. I want the light to change.',
    'Florida Man teaching an alligator self-checkout at {brand}.',
    'My rent went up because the apartment is now The Vue @ {road}.',
    '@grok is this retention pond legally a lake if my realtor says it twice',
    'AsphaltCoin has utility because you can use it to pay one pothole.',
    'Doomer take: civilization peaked when {brand} served breakfast all day.',
    'Reply guy here. The roundabout works if everyone else understands it.',
    'AI image of {city} has 400-lane roads, twelve moons, and impossible hands.',
    'Bot says {building} represents grassroots excitement. Bot joined today.',
    'Urbanists posted a chart. Truck guys posted a burnout. Chart got ratioed.',
    'Florida Man tried to rezone a sinkhole as an infinity pool.',
    'Hippies at {commune} make great coffee and this complicates my politics.',
    'Bought a Slop Script hoodie at imaginesupply.co. Meetings fear me.',
    'Blue check: “mindset.” Gold check: “opportunity.” Gray check: “expected.”',
    'SLOP energy drink tastes like lime, static, and a zoning variance.',
    'Truck nuts on a golf cart. The culture war reached its final form.',
    'Community Notes is fighting over whether {road} is a boulevard.',
    'A cybertruck-shaped dumpster is blocking the charger again.',
    'Anti-development sign attached to a new eight-car garage. Nature is healing.',
    '{weather} weather, {season} mood, gas-station dinner.',
    'hot singles in your cul-de-sac \ud83d\ude18 link in bio',
    'Bot report: 46 hot singles in your cul-de-sac, zero sidewalks in your cul-de-sac.',
    'Shrimp Jesus appeared in the freezer aisle at Dollar Colonel and blessed the family-size mozzarella sticks.',
    'AI image says Shrimp Jesus saved Dollar Colonel. His left claw has seven fingers.',
    'The AI-generated six-fingered mayor cut a ribbon with all six of them.',
    'Official portrait of the six-fingered mayor looks great if you ignore both elbows.',
    '15-minute cities are a plot to put groceries within a convenient distance of my home.',
    'If this is a 15-minute city why have I been in the drive-thru for 38 minutes CHECKMATE.',
    'The left built a 15-minute city. The right drove through it in eleven.',
    'They are coming for your gas stoves after they finish coming for your center turn lanes.',
    'My gas stove has never asked me to accept cookies or install an update.',
    'Gas stove discourse has reached {city}. Nobody has cooked anything.',
    'Bike lanes are woke because bicycles refuse to pull themselves up by their bootstraps.',
    'BIKE LANES ARE WOKE posted from a truck currently parked in one.',
    'County painted a bike lane. Local podcast network declared martial law.',
    'EAT THE RICH says the bumper sticker on a car idling outside {brand}.',
    '“Eat the rich” but the only restaurant open after ten is {brand}.',
    'Developer saw EAT THE RICH and immediately proposed a luxury food hall.',
    'touch grass, but hurry because this parcel closes Friday.',
    'Told me to touch grass. Closest grass is a median across {road}.',
    'Touch grass? In this parking minimum economy?',
    'OK boomer but Earl was right about the creek flooding.',
    'OK boomer, the bypass did kill downtown exactly like you said.',
    'Earl replied “OK developer” and logged off forever.',
    'Seed oils discourse has reached the Waffle Bunker syrup caddy.',
    'The seed oils are not why your commute is 74 minutes, Brandon.',
    'Local man avoids seed oils, inhales six lanes of particulate matter daily.',
    'Raw milk meetup relocated because the original pasture became luxury storage.',
    'Raw milk account and pasteurization reply guy have entered hour nine.',
    'Bought raw milk from a cooler behind {building}. This is not a recommendation.',
    'Egg prices up again. County considering a strategic omelet reserve.',
    'Egg prices have surpassed the per-acre tax yield of the strip mall.',
    'The mayor promised lower egg prices at a road ribbon cutting.',
    'YIMBY: build it. NIMBY: build it elsewhere. Developer: already poured the slab.',
    'YIMBY vs NIMBY debate ends when both sides discover it is a vape warehouse.',
    'The YIMBY brought charts. The NIMBY brought a petition. The parking minimum brought 400 spaces.',
    'NIMBY in the streets, YIMBY for the home-value appreciation.',
    'Crypto bro tokenized a pothole and calls the repair roadmap “community-governed.”',
    'Doomer account predicts collapse by Tuesday and posts a brunch photo Wednesday.',
    'Patriot bot, urbanist bot, and realtor bot are arguing beneath a photo of a culvert.',
    'This account posts “organic local support” in twelve counties every six minutes.',
    'AI generated town hall has 300 residents and 614 American flags.',
    'Neural Fly rendered {road} with upside-down traffic lights and emotionally accurate congestion.',
    'The bot called the retention pond a vibrant waterfront ecosystem again.',
    'Community Notes: this “small local account” is three bots in a data center trench coat.',
    '@grok count the mayor\'s fingers and do not be weird about it.',
    '@grok explain why every AI pickup truck has five rear axles.',
    'Ratioed by the official account for a drainage ditch.',
    'Reply guy has never attended a planning meeting but has attended every reply.',
    'Blue check says raw milk. Gold check says premium raw milk. Gray check says boil-water notice.',
    'Left-city meme: abolish parking. Right-city meme: park on the lawn. Centrist: valet the lawn.',
    'One side wants to eat the rich. The other wants to franchise them.',
    'Florida Man paid his egg bill with AsphaltCoin and an alligator-backed IOU.',
    'Florida Man opened a raw milk drive-thru accessible only by airboat.',
    'The commune sells seed-oil-free granola beside a sign reading EAT THE RICH.',
    '{commune} asked everyone to touch grass. County sent a mowing violation.',
    'A NIMBY and a YIMBY walk into a hearing. The developer owns the microphone.',
    'Gas stoves, bike lanes, egg prices: the local feed has achieved full discourse.',
    'No one knows what the meeting is about anymore, but someone yelled 15-minute cities.',
    'SLOP hoodie spotted in the raw milk line. Shop the municipal collapse at imaginesupply.co.',
  ],
};

const firstNames = ['Brett', 'Kayleigh', 'Dale', 'Skyler', 'Randy', 'Maddie', 'Tucker', 'Brandi', 'Earl', 'Hunter', 'Deb', 'Colton', 'Ash', 'Tripp'];
const lastNames = ['Culvert', 'McMansion', 'Pothole', 'Turnlane', 'Creekmore', 'Asphalt', 'Mallard', 'Gains', 'Diesel', 'Holloway', 'Pines', 'Runoff'];
const handleBits = ['truth', 'patriot', 'urbanist', 'replyguy', 'local', 'alpha', 'mom', 'real', 'official', 'hodl', 'doomer', 'based'];
const handleEnds = ['1776', '420', '69', 'actual', 'posting', 'dotbiz', 'fan', 'online', 'county'];
const colors = ['#1677ff', '#f5a623', '#7b61ff', '#ec4899', '#0f9d78', '#de3c4b', '#68737d', '#b56b26', '#32a8a2', '#111111'];
const emojis = ['\ud83c\udfce\ufe0f', '\ud83d\udede\ufe0f', '\ud83c\udfdb\ufe0f', '\ud83d\udc0a', '\ud83e\udd85', '\ud83d\udee3\ufe0f', '\ud83c\udf33', '\ud83e\udd83', '\ud83d\udcf1', '\ud83e\udd8b'];

const organizations: readonly Persona[] = [
  { name: 'Department of Maximum Mobility', handle: 'MaxMobilityGov', badge: 'gray', bg: '#5d6a72', emoji: '\ud83d\udee3\ufe0f', reach: 4 },
  { name: 'SLOP County Chamber', handle: 'SLOPChamber', badge: 'gold', bg: '#c6f432', emoji: '\ud83d\udcc8', reach: 5 },
  { name: 'Fill Er Up Newswire', handle: 'FillErUpNews', badge: 'gold', bg: '#b3202a', emoji: '\u26fd', reach: 6 },
  { name: 'Citizens For More Lanes', handle: 'MoreLanesNow', badge: 'gold', bg: '#1565c0', emoji: '\ud83d\ude97', reach: 3 },
  { name: 'County Weather Desk', handle: 'CountyWXDesk', badge: 'gray', bg: '#287c9f', emoji: '\ud83c\udf2a\ufe0f', reach: 4 },
];

const parodyFigures: readonly Persona[] = [
  { name: 'Elongated Muskrat', handle: 'elongatedmuskrat', badge: 'blue', bg: '#121212', emoji: '\ud83d\udc00', reach: 18 },
  { name: 'Zuckerborg', handle: 'zuckerborg_real', badge: 'blue', bg: '#356bc4', emoji: '\ud83e\udd16', reach: 15 },
  { name: 'Broe Jogan', handle: 'broejoganexperience', badge: 'blue', bg: '#8e3a22', emoji: '\ud83c\udf99\ufe0f', reach: 12 },
  { name: 'Tucker Car-Lot-Son', handle: 'tuckercarlotson', badge: 'blue', bg: '#28355c', emoji: '\ud83d\udc54', reach: 10 },
  { name: 'AOCivic', handle: 'aocivic', badge: 'blue', bg: '#6d42a2', emoji: '\ud83d\ude98', reach: 9 },
];

const replies = ['source?', 'ratio + add a lane', 'Community Notes incoming', 'my brother in asphalt that is induced demand', 'big if paved', 'mute this account', '@grok summarize as a zoning complaint', 'bot', 'I was there and it was worse'];
const notes = [
  'Readers added context: the project was described as “temporary” in 1998.',
  'Readers added context: adding road capacity generally induces more driving.',
  'Readers added context: the pictured “lake” is a retention pond.',
  'Readers added context: this account is funded by the County Asphalt Partnership.',
  'Readers added context: the rendering includes trees not in the approved plan.',
  'Readers added context: @grok cannot issue building permits.',
];

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
}

function pick<T>(items: readonly T[], rnd: Rng): T {
  return items[Math.floor(clamp(rnd()) * items.length)];
}

function cash(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '$0';
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  if (n >= 1e9) return `${sign}$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${sign}$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${sign}$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(n).toLocaleString('en-US')}`;
}

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

function variables(ctx: FeedContext, rnd: Rng): Vars {
  return {
    city: ctx.city,
    road: ctx.road || pick(roads, rnd),
    brand: ctx.brand || pick(brands, rnd),
    building: ctx.building || pick(buildings, rnd),
    commune: ctx.commune || pick(communes, rnd),
    amount: cash(ctx.amount ?? ctx.money),
    season: label(ctx.season || 'summer'),
    weather: label(ctx.weather || 'clear'),
    population: Math.max(0, Math.round(ctx.population)).toLocaleString('en-US'),
    nature: `${Math.round(Math.max(0, Math.min(1, ctx.naturePct)) * 100)}%`,
    sprawl: `${Math.round(Math.max(0, Math.min(1, ctx.sprawlPct)) * 100)}%`,
    count: Math.max(0, Math.round(ctx.count || 0)).toLocaleString('en-US'),
  };
}

function render(source: string, vars: Vars): string {
  return source.replace(/\{(\w+)\}/g, (_, key: keyof Vars) => vars[key] ?? '');
}

function citizen(rnd: Rng): Persona {
  const first = pick(firstNames, rnd);
  const last = pick(lastNames, rnd);
  return {
    name: `${first} ${last}`,
    handle: `${pick(handleBits, rnd)}${pick(['', '_', ''], rnd)}${last.toLowerCase()}${pick(handleEnds, rnd)}`.slice(0, 24),
    badge: clamp(rnd()) < 0.38 ? 'blue' : null,
    bg: pick(colors, rnd), emoji: pick(emojis, rnd), reach: 1,
  };
}

function author(kind: FeedEventKind, rnd: Rng): Persona {
  const roll = clamp(rnd());
  if (kind === 'merchDrop') return { name: 'SLOP', handle: 'SLOPofficial', badge: 'gold', bg: '#111111', emoji: '\ud83d\udca5', reach: 14 };
  if (kind === 'weatherChange') return organizations[4];
  if (['taxRaised', 'taxCut', 'bankrupt', 'lowMoney'].includes(kind) && roll < 0.5) return organizations[0];
  if (['roadBuilt', 'stroadBuilt', 'highwayBuilt', 'bridgeBuilt', 'laneAdded'].includes(kind) && roll < 0.35) return organizations[3];
  if (roll < 0.08) return pick(parodyFigures, rnd);
  if (roll < 0.25) return pick(organizations, rnd);
  return citizen(rnd);
}

function image(kind: FeedEventKind, v: Vars, text: string, rnd: Rng): FeedPost['image'] | undefined {
  if (kind === 'merchDrop') return { kind: 'merch', caption: 'SLOP goods on municipal-grade concrete', brand: 'SLOP' };
  if (text.includes('Shrimp Jesus')) return { kind: 'aiSlop', caption: 'Shrimp Jesus at Dollar Colonel, generated with incorrect crustacean anatomy', brand: 'Dollar Colonel' };
  if (text.includes('six-fingered mayor') || text.includes("mayor's fingers")) return { kind: 'aiSlop', caption: `${v.city}'s AI-generated mayor displays a ceremonial surplus finger` };
  if (kind === 'ambient' && clamp(rnd()) < 0.24) return { kind: 'aiSlop', caption: `${v.city}: patriotic alligators, twelve-lane clouds, impossible hands` };
  if (['buildingOpened', 'buildingLeveled', 'sprawlMilestone', 'natureMilestone'].includes(kind) && clamp(rnd()) < 0.25) return { kind: 'aiSlop', caption: `${v.building}, suspicious sunset, too many trucks`, brand: v.brand };
  if (['laneAdded', 'trafficJam', 'communeProtest', 'crash'].includes(kind) && clamp(rnd()) < 0.2) return { kind: 'meme', caption: pick(['ONE MORE LANE', 'LIVE TRAFFIC REACTION', 'LOCAL DISCOURSE, COLORIZED'], rnd) };
  return undefined;
}

function postReplies(kind: FeedEventKind, rnd: Rng): FeedPost['replies'] | undefined {
  const chance = ['trafficJam', 'laneAdded', 'taxRaised', 'communeProtest', 'ambient'].includes(kind) ? 0.72 : 0.38;
  if (clamp(rnd()) >= chance) return undefined;
  return Array.from({ length: 1 + Math.floor(clamp(rnd()) * 3) }, () => ({ handle: citizen(rnd).handle, text: pick(replies, rnd) }));
}

function engagement(persona: Persona, kind: FeedEventKind, rnd: Rng): Pick<FeedPost, 'likes' | 'reposts' | 'views'> {
  const hot = ['bankrupt', 'crash', 'drunkCrash', 'pedestrianHit', 'communeForever', 'merchDrop'].includes(kind) ? 2.4 : 1;
  const views = Math.max(23, Math.floor((180 + Math.pow(clamp(rnd()), 0.3) * 18_000) * persona.reach * hot));
  const reposts = Math.floor(views * (0.006 + clamp(rnd()) * 0.045));
  const likes = Math.max(reposts, Math.floor(views * (0.018 + clamp(rnd()) * 0.14)));
  return { likes, reposts, views };
}

/** A post reacting to a game event, or null to stay quiet. rnd() is 0..1. */
export function postFor(kind: FeedEventKind, ctx: FeedContext, rnd: () => number): FeedPost | null {
  const v = variables(ctx, rnd);
  const persona = author(kind, rnd);
  const text = pick(wrappers, rnd) + render(pick(templates[kind], rnd), v);
  const noteKinds: FeedEventKind[] = ['laneAdded', 'highwayBuilt', 'natureMilestone', 'taxCut', 'ambient'];
  return {
    name: persona.name,
    handle: persona.handle,
    badge: persona.badge,
    avatar: { bg: persona.bg, emoji: persona.emoji },
    text,
    image: image(kind, v, text, rnd),
    note: noteKinds.includes(kind) && clamp(rnd()) < 0.24 ? pick(notes, rnd) : undefined,
    replies: postReplies(kind, rnd),
    ...engagement(persona, kind, rnd),
  };
}

/** Background meme chatter when nothing is happening. */
export function ambientPost(ctx: FeedContext, rnd: () => number): FeedPost {
  return postFor('ambient', ctx, rnd)!;
}
