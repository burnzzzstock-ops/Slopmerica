// Original 24-unit cut-paper signs. The cream rim survives a dark toolbar and the
// ink contour survives a light drawer. Every control keeps its own accessible text.
const INK = '#111111', CREAM = '#efe6cf', LIME = '#c6f432', RED = '#b3202a';
const disc = (x: number, y: number, r: number) =>
  `M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0Z`;
const stamp = (outline: string, detail = '', fill = CREAM, outside = '') => ({ outline, detail, fill, outside });

const art = {
  // Toolbar and More
  inspect: stamp('M5 3l15 11-7 1 3 6-4 1-3-7-5 4z', '', LIME),
  roads: stamp('M7 3h10l5 18H2z', 'M12 5v3m0 4v6'),
  zones: stamp('M3 6l13-3 5 4-1 12-13 2-4-4z', 'M3 7l5 4 13-3M8 11l-1 9m7-10-1 9M6 5l5 4', LIME),
  upgrade: stamp('M3 20l4-16h8l-1 5h4v3h4v4h-4v4h-4v-4h-4l-1 4z', 'M11 6l-1 4m-1 3-1 3', LIME),
  bulldoze: stamp('M3 14h2V7h8l3 7h2l3-4v10h-5l-2-2H4q-3-1-1-4z', 'M8 9h4l2 5H7zm-3 7h8', RED),
  landmarks: stamp('M12 2l2 5 6-2-2 6 4 2-6 2 1 6-5-3-5 3 1-6-6-2 5-3-2-5 5 2z', '', LIME),
  views: stamp('M2 6l6-3 8 3 6-3v15l-6 3-8-3-6 3z', 'M8 4v13m8-11v14m-13-9 4-2 5 4 8-4'),
  budget: stamp('M7 3l5 2 5-2-2 6q7 5 6 9-1 4-9 4t-9-4q-1-4 6-9z', 'M8 9h8m-1 4h-4l-1 2 4 1-1 2H9', LIME),
  communes: stamp(disc(12, 12, 9), 'M12 4v16m0-8-6 5m6-5 6 5', LIME),
  feed: stamp('M3 4h16q2 0 2 2v10H10l-6 5v-5H2V6z', 'M6 8h11M6 12h8'),
  settings: stamp('M10 2h4l1 3 3-1 3 3-2 3 3 1v4l-3 1 1 3-3 2-3-2-1 3H9l-1-3-3 1-2-3 2-3-3-1V9l3-1-1-3 3-2 3 2z', disc(12, 12, 3)),
  bug: stamp('M8 6 7 3l3 2h4l3-2-1 3q4 3 2 10-1 5-6 5t-6-5Q4 9 8 6z', 'M7 9h10m-5 1v8', RED, 'M6 11l-3-1m3 5-3 1m15-5 3-1m-3 5 3 1'),
  more: stamp('M3 6h18v12H3z', disc(7,12,1)+disc(12,12,1)+disc(17,12,1)),
  services: stamp('M2 9l10-6 10 6-1 2H3zm2 10h16l1 2H3zM5 11h3v8H5zm6 0h3v8h-3zm6 0h3v8h-3z'),
  land: stamp('M3 6l10-3 8 4-1 12-11 2-7-4z', 'M5 15l5-5 3 3 3-5 3 3', LIME),
  transit: stamp('M5 5q0-2 4-2h6q5 0 5 3v12h-2v3h-3v-3H9v3H6v-3H4V8z', 'M7 7h10v6H7zm0 9h1m8 0h1', LIME),
  districts: stamp('M3 5l7-2 5 4 6-1v13l-7 2-5-4-6 2z', 'M10 4l-1 5 3 3-3 5m6-10-2 5 2 8', LIME),
  terraform: stamp('M2 20l7-12 3 4 4-9 6 17z', 'M6 14l3-1 2 3m2-5 3-2 2 2'),
  disasters: stamp('M2 5q7-4 20 0l-3 4-3 1 2 1-3 3-2 1 1 1-3 4-4 2 2-5-3-3 1-2-3-2z', 'M5 7q7 3 14-1m-11 6 6 1', RED),
  // Road drawer
  gravel: stamp('M3 20l2-10 6-6h6l4 8-3 8z', 'M6 14l4-3 5 2 3-3m-7-5 2 4'),
  oneWay1: stamp('M12 2l8 8h-5v11H9V10H4z', '', LIME),
  oneWay2: stamp('M7 3l5 6H9v12H5V9H2zm10 0 5 6h-3v12h-4V9h-3z', '', LIME),
  stroad4: stamp('M6 3h12l4 18H2z', 'M10 4 7 20m7-16 3 16m-5-13v3m0 4v3'),
  stroad6: stamp('M4 3h16l2 18H2z', 'M8 5 6 19m5-14-1 14m4-14 1 14m2-14 2 14'),
  stroad8: stamp('M3 3h18l1 18H2z', 'M6 5 5 19m4-14-1 14m4-14v14m3-14 1 14m2-14 1 14'),
  highway: stamp('M4 3h6v10l-5 8H2l2-9zm10 0h5l1 8 2 2v6l-5-3-3-5z', 'M7 5v5m10-5 1 6'),
  straight: stamp('M2 16 17 2l5 5L7 21z', 'M15 6l2 2m-5 1 2 2m-5 1 2 2'),
  curve: stamp('M3 20v-4q0-10 12-10V2l7 6-7 6v-4q-8 0-8 6v4z', '', LIME),
  freeform: stamp('M2 17q1-8 6-8 3 0 5 3 3 3 6-6l3 1q-3 14-10 9-4-5-5-2l-2 5z'),
  grid: stamp('M3 3h18v18H3z', 'M9 4v16m6-16v16M4 9h16M4 15h16'),
  // Zoning and map views
  resLow: stamp('M2 11l10-8 10 8-3 1v9H5v-9z', 'M10 20v-7h5v7', LIME),
  resHigh: stamp('M4 20V7l8-4 7 2v15h2v1H3z', 'M8 9v2m4-3v2m4-2v2m-8 4v2m4-3v2m2 6v-5h3v5', LIME),
  comLow: stamp('M3 4h3l2 3h14l-3 9H9L5 7H3z'+disc(10,20,1.5)+disc(17,20,1.5), 'M10 11h8'),
  comHigh: stamp('M4 4h16l2 6-2 2v9H4v-9l-2-2z', 'M3 10h18m-12-5-1 4m7-4 1 4M7 14h5v5H7zm8 0h3v7'),
  industry: stamp('M3 21V9l6 4V8l6 4V3h4l2 18z', 'M7 17h2m3 0h2m3 0h1'),
  office: stamp('M5 4h14v12l3 4H2l3-4z', 'M7 7h10v7H7zm-1 10h12'),
  dezone: stamp('M2 13l10-10 9 8-10 10H8z', 'M6 10l8 7', RED),
  normal: stamp(disc(12,12,9), 'M7 5l1 4 4 1-1 4-4 1-1 3m11-12-3 4 4 2-1 5', LIME),
  traffic: stamp('M7 2h10v17h-3v3h-4v-3H7z', disc(12,6,1.4)+disc(12,11,1.4)+disc(12,16,1.4)),
  landValue: stamp('M3 8l8-5 10 1-1 10-9 7-9-9z', 'M7 12l4-4 4 1m1-2 1-1', LIME),
  goods: stamp('M3 7l9-4 9 4v11l-9 4-9-4z', 'M3 7l9 4 9-4m-9 4v10M8 5l9 5'),
  pollution: stamp('M3 21l1-12h5l1 12zm10-2 1-8h5l1 8zM7 6q-2-4 3-3 3-3 6 0 5-1 5 3-1 2-6 1z'),
  noise: stamp('M3 10h4l7-6v16l-7-6H3z', '', CREAM, 'M17 9q3 3 0 6m2-10q6 7 0 14'),
  // Utility badges and service cards
  power: stamp('M12 2h8l-6 8h6L8 22l2-9H4z', '', LIME),
  water: stamp('M9 3h7v3h-2v3h5l2 3v5h-5v-4H9v3H3V9h7V6H8z', '', CREAM, 'M16 19q2-5 4 0 0 3-2 3t-2-3z'),
  sewage: stamp('M3 3h7v8h5v-3h6v8h-3v3H8l-4-4V7H3z', 'M5 7h5m6 8h4m-9 6h5'),
  garbage: stamp('M3 6h5l1-3h6l1 3h5v3h-2l-1 12H6L5 9H3z', 'M6 9h12m-8 3v6m4-6v6'),
  fire: stamp('M11 2q7 4 5 10l3-4q6 8-1 13H7Q1 18 4 12l4-6q-1 6 2 6 3-3 1-10z', 'M10 18q0-2 3-4-1 4 1 5', RED),
  police: stamp('M3 5l6-1 3-2 3 2 6 1-1 8q-1 5-8 9-7-4-8-9z', 'M12 7l1 3 3 1-2 2v3l-2-2-3 2 1-3-2-2 3-1z'),
  health: stamp('M3 7h5V5q0-2 2-2h4q2 0 2 2v2h5v14H3z', 'M9 7V6h6v1m-3 4v7m-4-4h8'),
  education: stamp('M2 9l10-6 10 6-4 2v6l-6 4-6-4v-6z', 'M3 9l9 5 9-5m0 1v6'),
  parks: stamp('M9 21v-5q-5 1-6-3-1-4 3-6 1-5 6-4 5-1 6 3 6 3 3 8-2 3-7 2v5z', 'M12 16V9m0 4 3-2', LIME),
  solar: stamp('M5 4h17l-4 13h-5v3h4v1H5v-2h5v-2H2z', 'M4 10h15M10 5l-3 11m9-11-3 11', LIME),
  nuclear: stamp('M6 3h12l-2 7q0 6 5 11H3q5-6 5-11z', 'M6 5h12m-5 3v3m-4 6 2-3m5 3-2-3'),
  tower: stamp('M3 8l9-6 9 6-2 1v5l-3 3 2 5h-3l-2-5h-2l-2 5H6l2-6-3-2V9z', 'M5 8h14m-12 5h10'),
  treatment: stamp('M3 6q0-3 8-3t8 3v7l3 2v4q0 2-6 2t-6-2v-3q-7-1-7-4z', 'M4 7q7 4 14 0m-6 9q4 2 8 0'),
  clinic: stamp('M3 3h3v6q0 4 4 4t4-4V3h3v6q0 6-6 7 0 3 4 3t4-4l-2-1q-1-4 2-4t3 4l-1 2q0 6-6 6t-7-6Q3 14 3 9z'),
  school: stamp('M3 11h5V7l4-4 4 4v4h5v10H3z', 'M10 20v-6h4v6m-2-12v2M5 14v2m14-2v2'),
  // Landmarks, parks and policies
  stadium: stamp('M2 8q10-8 20 0v7q-10 10-20 0z', 'M3 9q9 7 18 0m-14 1 5-4 5 4'),
  pig: stamp('M4 9 3 3l6 3q4-2 7 0l5-3-1 7 1 3q0 8-9 8T3 13z', 'M8 10h.5m7.5 0h.5m-8 5q3-4 7 0 0 4-4 3t-3-3z'),
  server: stamp('M3 3h18v18H3z', 'M4 9h16M4 15h16M7 6h4m-4 6h4m-4 6h4m5-12h1m-1 6h1m-1 6h1'),
  fuel: stamp('M4 3h11v16h2v2H2v-2h2z', 'M6 6h7v5H6zm10-2 4 4v8q0 3-3 1v-5l-2-2'),
  church: stamp('M4 13l6-4V6l2-4 2 4v3l6 4v8H4z', 'M10 21v-5q2-3 4 0v5m-2-12v2'),
  parking: stamp('M4 3h16v16H4zm7 16h2v3h-2z', 'M9 15V7h4q5 3 0 5H9', LIME),
  coin: stamp(disc(12,12,9), 'M7 8q5-4 9 0m-1 9q-4 3-8-1m4-7 3 3-3 3', LIME),
  drivethru: stamp('M3 4h12v9h-4v8H7v-8H3zm14 9h3l2 3v4h-6v-5z', 'M6 7h6m-6 3h4'),
  noBikes: stamp(disc(12,12,9), disc(8,14,2.2)+disc(16,14,2.2)+'M7 18 18 6M8 14l3-5 3 4m-1-5h2l1 5'),
  leaf: stamp('M3 19Q2 6 20 3q0 14-13 16l-3 3z', 'M5 18l10-10m-7 7-1-4m4 1 4-1', LIME),
  calendar: stamp('M3 5h4V2h2v3h6V2h2v3h4v16H3z', 'M4 9h16m-13 6 3 2 6-5'),
  repair: stamp('M4 21 2 18l10-9q-1-6 6-7l-3 5 3 2 4-4q1 7-7 8z'),
  books: stamp('M3 5l13-2 4 3-12 3zm0 4 5 3 13-3v4L8 16l-5-3zm0 7 5 3 13-4v4L8 22l-5-3z'),
  truck: stamp('M2 6h12v4h4l4 5v3h-3l-1 2h-3l-1-2H9l-1 2H5l-1-2H2z', 'M14 11v5m2-4h1l2 3h-3z'),
  crane: stamp('M4 20h3V7H3V5l9-3 10 4v2H11v12h3v2H4z', 'M9 8v10m9-10v5l-2 1'),
  smokeFree: stamp(disc(12,12,9), 'M6 18 18 6M6 14h5m2 0h4m-1-2q-3-3 0-5'),
  ration: stamp('M12 2q8 10 8 14a8 7 0 1 1-16 0Q4 11 12 2z', 'M7 18 17 9'),
  ferris: stamp(disc(12,10,7)+'M10 17h4l4 5H6z', 'M12 4v12M6 7l12 6m-12 0 12-6'),
  pine: stamp('M12 2l6 8h-3l6 7h-7v5h-4v-5H3l6-7H6z', '', LIME),
  fountain: stamp('M2 15h20l-4 5H6zM10 14V9q-5-5-6 0-1-7 4-5l4 4q3-7 7-4 3 2 2 5-3-4-6 1v4z'),
  golf: stamp('M6 18h5V3l10 3-8 4v8h4q7 4-5 4t-6-4z', '', LIME),
  bench: stamp('M4 5h16v7H4zm-2 9h20v3h-3v4h-3v-4H8v4H5v-4H2z', 'M5 9h14'),
  duck: stamp('M2 13q4 3 9 0l2-3q-3-4 0-7 4-2 6 2l3 1-3 2q0 12-9 12-6 0-8-7z', 'M6 16q4 2 7-1'),
  lizard: stamp('M3 17q4 0 6-4l-4-4 2-2 4 3 4-4V3l3 1 3 4-2 3-4 1 2 4-2 2-4-3q-5 8-9 5z', '', LIME),
  statue: stamp('M5 20h14v2H5zM9 18V9L5 7l1-3 5 3q0-5 3-4t1 5l5-3 1 3-6 3v7z'),
  gate: stamp('M2 6l3-3 2 3v15H2zm15 0 3-3 2 3v15h-5zM7 8h10v7H7z', 'M9 10l6 4m-4-5 4 2'),
  twine: stamp(disc(12,12,9), 'M5 8q11 0 12 11m-9-15q11 2 12 9M5 17l10-11m-6 15 10-10'),
  cross: stamp('M10 2h4v6h6v4h-6v10h-4V12H4V8h6z'),
  fork: stamp('M5 2h2v7h3V2h3v7h3V2h2v9l-4 3v8h-4v-8l-5-3z'),
  // Inspector states have redundant shape, internal mark and colour codes.
  ok: stamp(disc(12,12,9), 'M6 12l4 4 8-9', LIME),
  missing: stamp('M8 3h8l5 5v8l-5 5H8l-5-5V8z', 'M8 8l8 8m0-8-8 8', RED),
  warning: stamp('M11 3q1-1 2 0l9 17H2z', 'M12 9v5m0 3h.1', LIME),
  building: stamp('M3 6h18v8h-2v7h-3v-7H8v7H5v-7H3z', 'M5 12l4-5m2 5 4-5m2 5 3-4'),
  abandoned: stamp('M2 11l8-8 5 4 2-2 5 7-3 1v8H6L5 12z', 'M8 13l8 4m-7 0 6-5', RED),
  emergency: stamp('M4 17h2l1-8q1-5 5-5t5 5l1 8h2l1 4H3z', 'M5 17h14m-9-8 1-2', RED),
  // Repeated HUD actions, weather and meters
  hammer: stamp('M3 7l6-5 7 4-2 5 7 8-3 3-8-9-3 2-3-4 4-3-2-2z'),
  undo: stamp('M3 10l7-7v5h4q8 0 8 8v4h-4v-3q0-5-5-5h-3v5z'),
  pause: stamp('M4 3h6v18H4zm10 0h6v18h-6z'),
  play: stamp('M5 3l16 9-16 9z', '', LIME),
  sound: stamp('M3 9h4l6-5v16l-6-5H3z', '', CREAM, 'M16 9q4 3 0 6m3-9q5 6 0 12'),
  music: stamp('M3 4h18v16H3z', 'M4 13h16M7 5v7m5-7v7m5-7v7M8 14v5m7-5v5'),
  save: stamp('M3 3h15l3 3v15H3z', 'M7 4v6h10V4M7 21v-7h10v7'),
  folder: stamp('M2 6h7l3 3h9v11H2z', 'M3 11h16'),
  pin: stamp('M12 22Q3 12 4 8q1-6 8-6 8 0 8 7 0 4-8 13z', disc(12,9,2.5), RED),
  residents: stamp(disc(9,7,3)+disc(17,8,2.3)+'M2 20q0-8 7-8t7 8zm15-7q5-1 5 6h-4z'),
  medal: stamp('M3 3h6l3 5 3-5h6l-6 9q5 7-3 10-8-2-5-9z', disc(12,16,2)),
  lock: stamp('M4 10h2V8q0-6 6-6t6 6v2h2v11H4z', 'M9 10V8q0-3 3-3t3 3v2m-3 4v3'),
  sun: stamp(disc(12,12,5), '', LIME, 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'),
  cloud: stamp('M5 18q-6-2-2-7 2-2 4-1 1-8 8-6 4 0 4 5 5 0 3 7-1 2-5 2z'),
  rain: stamp('M4 13Q0 9 5 7q2-6 7-4 3-1 5 4 6-1 5 5-1 2-4 2H5z', '', CREAM, 'M7 17l-2 4m7-4-2 4m7-4-2 4'),
  storm: stamp('M4 12Q0 9 5 6q2-5 7-3 3-1 5 4 6-1 5 5-1 2-5 2h-4l-3 7 1-8z', '', LIME),
  snow: stamp('M4 12Q0 9 5 6q2-5 7-3 3-1 5 4 6-1 5 5-1 2-5 2H6z', '', CREAM, 'M5 18h3m-1.5-1.5v3m8-1.5h3m-1.5-1.5v3'),
  blizzard: stamp('M10 2h4v6l5-3 2 3-5 4 5 3-2 3-5-3v7h-4v-7l-5 3-2-3 5-3-5-4 2-3 5 3z'),
  fog: stamp('M3 7q4-5 8-2 4 2 10-1v4q-6 3-11 0-3-1-7 2zm0 9q4-5 8-2 4 2 10-1v4q-6 3-11 0-3-1-7 2z'),
  heatwave: stamp('M4 21q4-5 0-9-3-4 1-9h3q-3 5 0 8 5 5-1 10zm8 0q4-5 1-9-4-4 0-9h3q-3 5 0 8 5 5-1 10z', '', RED),
  hurricane: stamp('M2 15Q3 4 13 3q5-1 8 2-4-1-7 1 7 1 5 8-1 5-8 5-3 3-8 2 4-1 6-4-4-1-5-5z', disc(12,12,2)),
  scales: stamp('M11 3h2v3l8 2v2l-1-1 2 5q-3 4-6 0l2-6-5-1v11h4v3H7v-3h4V7L6 8l2 6q-3 4-6 0l2-5-1 1V8l8-2z'),
} as const;

export type HudIconName = keyof typeof art;
export const HUD_ICON_NAMES = Object.freeze(Object.keys(art) as HudIconName[]);

/** Keys mirror data-t/data-more, data-zone, data-road, data-mode, data-view,
 * data-svc and data-lm. Inspector rows compose a utility icon and a status icon. */
export const HUD_CONTROLS = {
  toolbar: {
    inspect: 'inspect', roads: 'roads', zones: 'zones', upgrade: 'upgrade', bulldoze: 'bulldoze',
    landmarks: 'landmarks', views: 'views', budget: 'budget', communes: 'communes', feed: 'feed',
    help: 'settings', bug: 'bug', more: 'more', 'ext:services': 'services', 'ext:land': 'land',
    'ext:transit': 'transit', 'ext:districts': 'districts', 'ext:terraform': 'terraform', 'ext:disasters': 'disasters',
  },
  road: { gravel: 'gravel', twoLane: 'roads', oneWay1: 'oneWay1', oneWay2: 'oneWay2', stroad4: 'stroad4', stroad6: 'stroad6', stroad8: 'stroad8', highway: 'highway' },
  roadMode: { straight: 'straight', curve: 'curve', freeform: 'freeform', grid: 'grid' },
  zone: { resLow: 'resLow', resHigh: 'resHigh', comLow: 'comLow', comHigh: 'comHigh', industry: 'industry', office: 'office', none: 'dezone' },
  view: {
    none: 'normal', traffic: 'traffic', landValue: 'landValue', goods: 'goods', transit: 'transit', districts: 'districts',
    'svc:power': 'power', 'svc:water': 'water', 'svc:sewage': 'sewage', 'svc:garbage': 'garbage',
    'svc:fire': 'fire', 'svc:police': 'police', 'svc:health': 'health', 'svc:education': 'education',
    'svc:pollution': 'pollution', 'svc:noise': 'noise',
  },
  category: { power: 'power', water: 'water', sewage: 'sewage', garbage: 'garbage', fire: 'fire', police: 'police', health: 'health', education: 'education', parks: 'parks' },
  utility: { power: 'power', water: 'water', sewage: 'sewage', garbage: 'garbage' },
  status: { ok: 'ok', missing: 'missing', warning: 'warning', emergency: 'emergency', building: 'building', abandoned: 'abandoned', locked: 'lock' },
  facility: {
    gasPeaker: 'fire', coalPlant: 'industry', solarFarm: 'solar', nuclearPlant: 'nuclear', waterPump: 'water',
    wellTower: 'tower', sewageOutfall: 'sewage', treatmentPlant: 'treatment', landfill: 'garbage',
    incinerator: 'fire', fireStation: 'emergency', sheriff: 'police', clinic: 'clinic', hospital: 'health',
    school: 'school', college: 'education', park: 'parks',
    'va:county-fair-midway': 'ferris', 'va:frankenpine-memorial': 'pine', 'va:freedom-splash-pad': 'fountain',
    'va:gated-golf-estate': 'golf', 'va:hostile-bench-plaza': 'bench', 'va:lake-serenity-pond': 'duck',
    'va:last-hellbender-memorial': 'lizard', 'va:liberty-muffler-man': 'statue', 'va:mandatory-hoa-gate': 'gate',
    'va:miracle-twine-ball': 'twine', 'va:mount-trashmore': 'terraform', 'va:pocket-park': 'parks',
    'va:roadside-cross': 'cross', 'va:sidewalk-to-nowhere': 'building', 'va:suburban-history-museum': 'services',
    'va:worlds-largest-fork': 'fork',
  },
  landmark: {
    slopCannon: 'landmarks', slop69Field: 'stadium', pigCabanaResort: 'pig', neuralFlyDatacenter: 'server',
    propaneParadise: 'fire', fillErUpMegaStation: 'fuel', megachurch: 'church', waterTower: 'tower',
  },
  policy: {
    freeParking: 'parking', hoaTyranny: 'resLow', cryptoHaven: 'coin', openCarry: 'drivethru', banBikes: 'noBikes',
    legalizeIt: 'leaf', fourDayWeek: 'calendar', rightToRepair: 'repair', bookBans: 'books', heavyTrafficBan: 'truck',
    sprawlZone: 'crane', smokeFree: 'smokeFree', solarMandate: 'solar', waterRationing: 'ration',
  },
  weather: { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', snow: 'snow', blizzard: 'blizzard', fog: 'fog', heatwave: 'heatwave', hurricane: 'hurricane', wildfireSmoke: 'fire' },
  action: {
    build: 'hammer', done: 'ok', stop: 'missing', undo: 'undo', pause: 'pause', play: 'play', music: 'music', sound: 'sound',
    save: 'save', file: 'folder', show: 'pin', report: 'bug', court: 'scales', bribe: 'budget', unlock: 'medal',
  },
  meter: { nature: 'pine', sprawl: 'resHigh', population: 'residents', milestone: 'medal' },
} as const satisfies Record<string, Record<string, HudIconName>>;

/** Decorative inline SVG. Put the accessible name on the control or adjacent status text. */
export function hudIcon(name: HudIconName, size = 24): string {
  const { outline, detail, fill, outside } = art[name];
  const px = Number.isFinite(size) ? Math.max(1, Math.min(512, size)) : 24;
  const fringe = outside ? `<path d="${outside}" fill="none" stroke="${CREAM}" stroke-width="3.5"/><path d="${outside}" fill="none" stroke="${INK}" stroke-width="1.6"/>` : '';
  const mark = detail ? `<path d="${detail}" fill="none" stroke="${fill === RED ? CREAM : INK}" stroke-width="1.75"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="${px}" height="${px}" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${fringe}<path d="${outline}" fill="${CREAM}" stroke="${CREAM}" stroke-width="3.5"/><path d="${outline}" fill="${fill}" stroke="${INK}" stroke-width="1.6"/>${mark}</svg>`;
}

/** Dynamic extension and drawer IDs can use the same mapping as typed core buttons. */
export function hudIconFor(group: keyof typeof HUD_CONTROLS, id: string, size = 24): string {
  const icons: Readonly<Record<string, HudIconName>> = HUD_CONTROLS[group];
  return Object.prototype.hasOwnProperty.call(icons, id) ? hudIcon(icons[id], size) : '';
}
