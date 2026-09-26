// Conserved industrial production, retail inventories, and real freight trips.
import * as THREE from 'three';
import type { Game, Selection } from '../game';
import type { Car } from '../agents/traffic';
import type { Bld } from './buildings';
import { POLICY_MOBILITY } from './policyEffects';
import { registerInspector, registerSystem, registerView } from '../ext/registry';

type FreightKind = 'local' | 'import' | 'export';
interface FactoryStock { id: number; stock: number; capacity: number; produced: number }
interface ShopStock { id: number; stock: number; capacity: number; sold: number; dryDays: number; localDelivered: number; imported: number; lastDelivery: number; supplier: string }
interface Shipment { id: number; kind: FreightKind; qty: number; fromId: number; toId: number; car: Car }
interface Totals { produced: number; localDelivered: number; imported: number; exported: number; sold: number; factoryLost: number; shopSpoiled: number }
interface SavedStock { id: number; x: number; z: number; stock: number; capacity: number; produced?: number; sold?: number; dryDays?: number; localDelivered?: number; imported?: number; lastDelivery?: number; supplier?: string }
interface FreightSave { version: 1; factories: SavedStock[]; shops: SavedStock[]; totals: Totals; routes: [number, number][]; pending?: { exportIncome: number; importCosts: number } }

const factories = new Map<number, FactoryStock>();
const shops = new Map<number, ShopStock>();
const shipments = new Map<number, Shipment>();
const truckRoutes = new Map<number, number>();
let nextShipment = 1;
let game: Game | null = null;
let exportIncome = 0;
let importCosts = 0;
let lastWeek = { produced: 0, delivered: 0, imported: 0, exported: 0, sold: 0, lost: 0 };
let totals = zeroTotals();
let weekStart = zeroTotals();
let routeLines: THREE.LineSegments | null = null;
let routeMaterial: THREE.LineDashedMaterial | null = null;
let routesDirty = true;
let viewTintTimer = 0;

function zeroTotals(): Totals { return { produced: 0, localDelivered: 0, imported: 0, exported: 0, sold: 0, factoryLost: 0, shopSpoiled: 0 } }
const isFactoryBuilding = (b: Bld) => b.zone === 'industry';
const isShopBuilding = (b: Bld) => b.zone === 'comLow' || b.zone === 'comHigh';
const isFactory = (b: Bld) => isFactoryBuilding(b) && b.state === 'active' && b.abandoned === undefined;
const isShop = (b: Bld) => isShopBuilding(b) && b.state === 'active' && b.abandoned === undefined;
const round1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const factoryCapacity = (b: Bld) => Math.max(30, b.cap * (8 + b.level * 3));
const shopCapacity = (b: Bld) => Math.max(18, b.cap * (5 + b.level * 2));

function syncBuildings(g: Game) {
  const liveFactories = new Set<number>(), liveShops = new Set<number>();
  for (const b of g.buildings.list.values()) {
    if (isFactoryBuilding(b)) {
      liveFactories.add(b.id);
      const capacity = factoryCapacity(b), s = factories.get(b.id);
      if (s) s.capacity = capacity;
      else factories.set(b.id, { id: b.id, stock: 0, capacity, produced: 0 });
    } else if (isShopBuilding(b)) {
      liveShops.add(b.id);
      const capacity = shopCapacity(b), s = shops.get(b.id);
      if (s) s.capacity = capacity;
      else shops.set(b.id, { id: b.id, stock: 0, capacity, sold: 0, dryDays: 0, localDelivered: 0, imported: 0, lastDelivery: -1, supplier: 'None yet' });
    }
  }
  for (const [id, s] of factories) if (!liveFactories.has(id)) { totals.factoryLost += s.stock; factories.delete(id); }
  for (const [id, s] of shops) if (!liveShops.has(id)) { totals.shopSpoiled += s.stock; shops.delete(id); }
}

function incoming(toId: number) { let n = 0; for (const s of shipments.values()) if (s.toId === toId) n += s.qty; return n; }
function outbound(fromId: number) { let n = 0; for (const s of shipments.values()) if (s.fromId === fromId) n += s.qty; return n; }
function recordRoute(car: Car) { for (const step of car.path) truckRoutes.set(step.seg, (truckRoutes.get(step.seg) ?? 0) + 1); routesDirty = true; }

function finishShipment(g: Game, id: number, arrived: boolean) {
  const s = shipments.get(id);
  if (!s) return;
  shipments.delete(id); routesDirty = true;
  if (!arrived) { if (s.kind !== 'import') totals.factoryLost += s.qty; return; }
  if (s.kind === 'export') { totals.exported += s.qty; exportIncome += s.qty * 3.2; return; }
  const shop = shops.get(s.toId), b = g.buildings.list.get(s.toId);
  if (!shop || !b || !isShopBuilding(b)) { if (s.kind === 'local') totals.factoryLost += s.qty; return; }
  const accepted = Math.min(s.qty, Math.max(0, shop.capacity - shop.stock));
  shop.stock += accepted;
  totals.shopSpoiled += s.qty - accepted;
  shop.lastDelivery = g.sim.day; shop.dryDays = 0;
  if (s.kind === 'local') {
    totals.localDelivered += s.qty; shop.localDelivered += s.qty;
    shop.supplier = g.buildings.list.get(s.fromId)?.label ?? 'Demolished factory';
  } else {
    totals.imported += s.qty; shop.imported += s.qty;
    shop.supplier = 'The Interstate Logistics Cloud'; importCosts += s.qty * 4.8;
  }
}

function launch(g: Game, kind: FreightKind, qty: number, from: Bld | 'edge', to: Bld | 'edge') {
  const id = nextShipment++, fromId = from === 'edge' ? 0 : from.id, toId = to === 'edge' ? 0 : to.id;
  const vehicle = qty >= 24 ? 'semi' : 'boxTruck';
  const purpose = kind === 'local' ? 'delivering conserved goods' : kind === 'import' ? 'importing emergency shelf filler' : 'exporting surplus slop';
  const car = g.traffic.dispatch(vehicle, from, to, purpose, to === 'edge' ? 'the interstate' : to.label, g.hour, {
    sober: true, local: kind !== 'import', onDone: (_car, arrived) => finishShipment(g, id, arrived),
  });
  if (!car) return false;
  shipments.set(id, { id, kind, qty, fromId, toId, car }); recordRoute(car); return true;
}

function produceAndSell(g: Game) {
  for (const b of g.buildings.list.values()) {
    if (isFactory(b)) {
      const s = factories.get(b.id)!;
      const actual = Math.min(Math.max(0, b.occ) * (0.45 + b.level * 0.12), Math.max(0, s.capacity - s.stock));
      s.stock += actual; s.produced += actual; totals.produced += actual;
    } else if (isShop(b)) {
      const s = shops.get(b.id)!;
      let nearbyPopulation = 0;
      for (const n of g.buildings.near(b.x, b.z, 180)) if (n.zone === 'resLow' || n.zone === 'resHigh') nearbyPopulation += n.occ;
      const sold = Math.min(s.stock, Math.max(0.35, b.occ * 0.28 + nearbyPopulation * 0.012));
      s.stock -= sold; s.sold += sold; totals.sold += sold;
      if (s.stock < 0.05) s.dryDays++; else s.dryDays = 0;
    }
  }
}

function scheduleDeliveries(g: Game) {
  const available = [...factories.entries()].map(([id, s]) => ({ b: g.buildings.list.get(id), s }))
    .filter((x): x is { b: Bld; s: FactoryStock } => !!x.b && POLICY_MOBILITY.truckAllowed(x.b) && x.s.stock >= 4 && !outbound(x.b.id)).sort((a, b) => b.s.stock - a.s.stock);
  for (const [id, shop] of shops) {
    const b = g.buildings.list.get(id);
    if (!b || !isShop(b) || !POLICY_MOBILITY.truckAllowed(b) || incoming(id) > 0 || shop.stock >= shop.capacity * 0.45) continue;
    const factory = available.find((x) => x.s.stock >= 4);
    let sent = false;
    if (factory) {
      const qty = Math.min(30, factory.s.stock, shop.capacity - shop.stock);
      factory.s.stock -= qty;
      sent = launch(g, 'local', qty, factory.b, b);
      if (!sent) factory.s.stock += qty;
    }
    if (!sent && shop.dryDays >= 2 && g.traffic.outsideConnections() > 0) {
      launch(g, 'import', Math.min(24, shop.capacity - shop.stock), 'edge', b);
    }
  }
  if (g.traffic.outsideConnections() > 0) for (const [id, s] of factories) {
    const b = g.buildings.list.get(id);
    if (!b || !POLICY_MOBILITY.truckAllowed(b) || outbound(id) > 0 || s.stock < s.capacity * 0.82) continue;
    const qty = Math.min(36, s.stock - s.capacity * 0.55);
    if (qty < 4) continue;
    s.stock -= qty; if (!launch(g, 'export', qty, b, 'edge')) s.stock += qty;
  }
}

function daily(g: Game) { syncBuildings(g); produceAndSell(g); scheduleDeliveries(g); }

function balance() {
  let factoryStock = 0, shopStock = 0, localTransit = 0, exportTransit = 0;
  for (const s of factories.values()) factoryStock += s.stock;
  for (const s of shops.values()) shopStock += s.stock;
  for (const s of shipments.values()) { if (s.kind === 'local') localTransit += s.qty; else if (s.kind === 'export') exportTransit += s.qty; }
  const productionRight = factoryStock + totals.localDelivered + totals.exported + totals.factoryLost + localTransit + exportTransit;
  const shopRight = totals.sold + shopStock + totals.shopSpoiled;
  return { productionLeft: round1(totals.produced), productionRight: round1(productionRight), productionError: round1(totals.produced - productionRight), shopLeft: round1(totals.localDelivered + totals.imported), shopRight: round1(shopRight), shopError: round1(totals.localDelivered + totals.imported - shopRight), factoryStock: round1(factoryStock), shopStock: round1(shopStock), inTransit: round1(localTransit + exportTransit) };
}

function assertBalance() {
  const b = balance(), ok = Math.abs(b.productionError) < 0.11 && Math.abs(b.shopError) < 0.11;
  if (!ok) throw new Error(`Freight conservation failed: production ${b.productionLeft} != ${b.productionRight}; shops ${b.shopLeft} != ${b.shopRight}`);
  return { ok, ...b };
}

function weekly() {
  const delta = (k: keyof Totals) => totals[k] - weekStart[k];
  lastWeek = { produced: round1(delta('produced')), delivered: round1(delta('localDelivered')), imported: round1(delta('imported')), exported: round1(delta('exported')), sold: round1(delta('sold')), lost: round1(delta('factoryLost')) };
  weekStart = { ...totals };
  for (const [id, n] of truckRoutes) { const next = Math.floor(n * 0.55); if (next) truckRoutes.set(id, next); else truckRoutes.delete(id); }
  routesDirty = true;
  if (typeof location !== 'undefined' && (location.search.includes('debug') || location.hash.includes('debug'))) assertBalance();
}

function importShare() { const supplied = totals.localDelivered + totals.imported; return supplied > 0 ? totals.imported / supplied : 0; }

function buildRouteLines(g: Game) {
  if (!routeLines || !routesDirty) return;
  const pos: number[] = [];
  for (const shipment of shipments.values()) for (const step of shipment.car.path) {
    const seg = g.net.segs.get(step.seg); if (!seg) continue;
    const pts = step.dir > 0 ? seg.samp.pts : [...seg.samp.pts].reverse();
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; pos.push(a.x, g.terrain.h(a.x, a.z) + 1.5, a.z, b.x, g.terrain.h(b.x, b.z) + 1.5, b.z); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  routeLines.geometry.dispose(); routeLines.geometry = geo; routeLines.computeLineDistances(); routesDirty = false;
}

function updateView(g: Game, dt: number) {
  buildRouteLines(g); if (routeMaterial) (routeMaterial as THREE.LineDashedMaterial & { dashOffset: number }).dashOffset -= dt * 8;
  viewTintTimer -= dt; if (viewTintTimer > 0) return; viewTintTimer = 0.4;
  const low = new THREE.Color(0xe53535), mid = new THREE.Color(0xffc62e), high = new THREE.Color(0x35df73), c = new THREE.Color();
  g.overlays.tintBuildings((b) => {
    const s = factories.get(b.id) ?? shops.get(b.id); if (!s) return null;
    const v = Math.max(0, Math.min(1, s.stock / s.capacity));
    return c.copy(low).lerp(mid, Math.min(1, v * 2)).lerp(high, Math.max(0, v * 2 - 1));
  });
}

function inspector(sel: NonNullable<Selection>, g: Game) {
  if (sel.kind !== 'building') return null;
  const b = sel.b, f = factories.get(b.id);
  if (f) return `<div class="in-stats"><div><span>Goods stock</span><b>${round1(f.stock)} / ${round1(f.capacity)}</b></div><div><span>Production</span><b>${round1(f.produced)} total</b></div><div><span>Outbound</span><b>${round1(outbound(b.id))} in transit</b></div><div><span>Truck route</span><b>${truckRoutes.get(b.seg) ?? 0} recent loads</b></div></div>`;
  const s = shops.get(b.id); if (!s) return null;
  const supplied = s.localDelivered + s.imported, imported = supplied ? Math.round((s.imported / supplied) * 100) : 0;
  const price = 1 + imported * 0.0035;
  const delivered = s.lastDelivery < 0 ? 'Never' : `${Math.max(0, Math.floor(g.sim.day - s.lastDelivery))} day(s) ago`;
  return `<div class="in-stats"><div><span>Goods stock</span><b>${round1(s.stock)} / ${round1(s.capacity)}</b></div><div><span>Last delivery</span><b>${delivered}</b></div><div><span>Supplier</span><b>${esc(s.supplier)}</b></div><div><span>Import share</span><b>${imported}%${s.dryDays ? ` · dry ${s.dryDays}d` : ''}</b></div><div><span>Shelf prices</span><b>${price.toFixed(2)}× from imports</b></div></div>`;
}

function savedStocks(g: Game, source: Map<number, FactoryStock | ShopStock>): SavedStock[] {
  const out: SavedStock[] = [];
  for (const [id, s] of source) { const b = g.buildings.list.get(id); if (b) out.push({ ...s, id, x: round1(b.x), z: round1(b.z) }); }
  return out;
}

function restoreMap<T extends FactoryStock | ShopStock>(g: Game, rows: SavedStock[], zone: 'factory' | 'shop', make: (row: SavedStock, id: number) => T) {
  const candidates = [...g.buildings.list.values()].filter(zone === 'factory' ? isFactoryBuilding : isShopBuilding);
  for (const row of rows) {
    const byId = g.buildings.list.get(row.id);
    const match = byId && (zone === 'factory' ? isFactoryBuilding(byId) : isShopBuilding(byId)) ? byId : candidates.find((x) => Math.hypot(x.x - row.x, x.z - row.z) < 1);
    if (match) { if (zone === 'factory') factories.set(match.id, make(row, match.id) as FactoryStock); else shops.set(match.id, make(row, match.id) as ShopStock); }
  }
}

/**
 * Trucks on the road can't be resumed, so the snapshot rolls them back
 * without creating or losing goods: outbound loads go back into their
 * factory's stock (the live game is untouched), imports were not paid for
 * yet and are simply re-ordered later. Money earned or owed this week that
 * the weekly bill hasn't settled yet is kept.
 */
function saveState(g: Game): FreightSave {
  const back = new Map<number, number>();
  for (const s of shipments.values()) if (s.kind !== 'import' && s.fromId) back.set(s.fromId, (back.get(s.fromId) ?? 0) + s.qty);
  const facRows = savedStocks(g, factories).map((r) => (back.has(r.id) ? { ...r, stock: r.stock + back.get(r.id)! } : r));
  let orphaned = 0; // loads whose factory is gone: they were lost with it
  for (const [id, qty] of back) if (!factories.has(id)) orphaned += qty;
  return { version: 1, factories: facRows, shops: savedStocks(g, shops), totals: { ...totals, factoryLost: totals.factoryLost + orphaned }, routes: [...truckRoutes], pending: { exportIncome, importCosts } };
}

function loadState(g: Game, raw: unknown) {
  const data = raw as Partial<FreightSave>; factories.clear(); shops.clear(); shipments.clear(); truckRoutes.clear();
  totals = { ...zeroTotals(), ...(data.totals ?? {}) }; weekStart = { ...totals };
  restoreMap(g, data.factories ?? [], 'factory', (r, id) => ({ id, stock: r.stock, capacity: r.capacity, produced: r.produced ?? 0 }));
  restoreMap(g, data.shops ?? [], 'shop', (r, id) => ({ id, stock: r.stock, capacity: r.capacity, sold: r.sold ?? 0, dryDays: r.dryDays ?? 0, localDelivered: r.localDelivered ?? 0, imported: r.imported ?? 0, lastDelivery: r.lastDelivery ?? -1, supplier: r.supplier ?? 'None yet' }));
  for (const [id, n] of data.routes ?? []) truckRoutes.set(id, n);
  exportIncome = data.pending?.exportIncome ?? 0;
  importCosts = data.pending?.importCosts ?? 0;
  syncBuildings(g); routesDirty = true;
}

registerSystem({
  id: 'freight',
  init(g) {
    game = g; syncBuildings(g);
    routeMaterial = new THREE.LineDashedMaterial({ color: 0xffb62e, dashSize: 10, gapSize: 7, transparent: true, opacity: 0.95, depthWrite: false });
    routeLines = new THREE.LineSegments(new THREE.BufferGeometry(), routeMaterial); routeLines.visible = false; routeLines.renderOrder = 7; routeLines.frustumCulled = false; g.scene.add(routeLines);
    g.traffic.freightTrip = () => false;
    g.sim.hooks.vacancy.push((b) => { const s = shops.get(b.id); return s && s.stock < 0.05 && s.dryDays >= 5 ? 'No goods to sell' : null; });
    g.sim.hooks.demand.push((d, why) => { const share = importShare(); if (share > 0) { d.ind += Math.min(25, share * 30); why.ind.push(`Shops import ${Math.round(share * 100)}% of goods`); } });
    g.sim.hooks.landValue.push((b) => b.zone === 'industry' ? 0 : -Math.min(5, (truckRoutes.get(b.seg) ?? 0) * 0.35));
    g.sim.hooks.weekly.push((add) => { if (exportIncome > 0) add('Freight export income', -exportIncome, 'other'); if (importCosts > 0) add('Emergency goods imports', importCosts, 'other'); exportIncome = 0; importCosts = 0; });
    (g as Game & { freight?: unknown }).freight = {
      stats: () => ({
        factories: factories.size, shops: shops.size, dryShops: [...shops.values()].filter((s) => s.dryDays >= 5).length,
        activeTrucks: shipments.size,
        activeByKind: { local: [...shipments.values()].filter((s) => s.kind === 'local').length, import: [...shipments.values()].filter((s) => s.kind === 'import').length, export: [...shipments.values()].filter((s) => s.kind === 'export').length },
        importShare: round1(importShare() * 100), lastWeek: { ...lastWeek }, totals: { ...totals }, ...balance(),
      }),
      assertBalance, daily: () => daily(g), factory: (id: number) => factories.get(id), shop: (id: number) => shops.get(id),
      roundTrip: () => { const before = JSON.stringify(saveState(g)); loadState(g, JSON.parse(before)); const after = JSON.stringify(saveState(g)); return { equal: before === after, bytes: before.length }; },
    };
  },
  daily, weekly: () => weekly(),
  save: saveState,
  load: loadState,
});

registerView({
  id: 'goods', icon: '📦', label: 'Goods',
  enable(g) { if (routeLines) routeLines.visible = true; viewTintTimer = 0; updateView(g, 0); },
  disable(g) { if (routeLines) routeLines.visible = false; g.overlays.resetBuildingColors(); },
  update: updateView,
  legend: () => '<b>Goods stock</b> <span style="color:#e53535">■ empty</span> <span style="color:#ffc62e">■ low</span> <span style="color:#35df73">■ stocked</span><br><span style="color:#ffb62e">- - active truck route</span>',
});
registerInspector(inspector);
export const freightDebug = () => game && (game as Game & { freight?: unknown }).freight;
