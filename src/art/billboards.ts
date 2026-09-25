// Roadside billboards: text + simple canvas art. Content is data; each entry is
// painted once into the atlas as "bb:<id>". generateBillboard() picks from here.
import { defTile, Layer } from './atlas';
import { MERCH_DOMAIN } from './brands';
import { Ctx, F, textFit, linesFit, rr, stripes, slopScript, slopLightning, distress, rngFor, gradV, star, circle, ellipse, shade, blockSlogan, drawText, fillStroke } from './draw';
import { icon, cannon, wigette, cannonBoys, fillErUpGuy, neuralFly, pigHead } from './icons';

type BBPaint = (c: Ctx, w: number, h: number) => void;

export interface BillboardDef {
  id: string;
  label: string; // readable summary for tooltips / feed
  merch?: boolean; // Imagine Supply Co. ad (says imaginesupply.co)
  pair?: string; // painted side by side with this one on a double structure
  paint: BBPaint;
}

interface StdOpts {
  bg: string;
  fg: string;
  head: string[];
  sub?: string;
  icon?: string;
  iconRight?: boolean;
  headFont?: string;
  subColor?: string;
  subBg?: string;
  art?: (c: Ctx, cx: number, cy: number, s: number) => void;
}

/** Standard layout: art block on one side, headline lines + a sub strip. */
function std(o: StdOpts): BBPaint {
  return (c, w, h) => {
    c.fillStyle = o.bg;
    c.fillRect(0, 0, w, h);
    const hasArt = !!(o.icon || o.art);
    const artW = hasArt ? h * 1.05 : 0;
    const ax = o.iconRight ? w - artW : 0;
    if (o.icon) icon(c, o.icon, ax + artW / 2, h * 0.48, h * 0.8);
    if (o.art) o.art(c, ax + artW / 2, h * 0.5, h * 0.9);
    const tx = o.iconRight ? 16 : artW + 10;
    const tw = w - artW - 26;
    const subH = o.sub ? h * 0.22 : 0;
    linesFit(c, o.head, tx, 12, tw, h - subH - 30, { family: o.headFont ?? F.block, color: o.fg, gap: 0.06 });
    if (o.sub) {
      if (o.subBg) {
        c.fillStyle = o.subBg;
        c.fillRect(tx - 6, h - subH - 12, tw + 12, subH + 4);
      }
      textFit(c, o.sub, tx, h - subH - 10, tw, subH, { family: F.sans, weight: 900, color: o.subColor ?? o.fg });
    }
  };
}

function domain(c: Ctx, w: number, h: number, color = '#c6f432') {
  textFit(c, MERCH_DOMAIN, w - 170, h - 30, 158, 22, { family: F.sans, weight: 900, color });
}

function flames(c: Ctx, w: number, h: number, top: number) {
  const r = rngFor('flames');
  for (let i = 0; i < 26; i++) {
    const x = (i / 25) * w, fh = (h - top) * (0.5 + r.float() * 0.6);
    c.beginPath();
    c.moveTo(x - 18, h);
    c.quadraticCurveTo(x - 10, h - fh * 0.5, x, h - fh);
    c.quadraticCurveTo(x + 10, h - fh * 0.5, x + 18, h);
    c.fillStyle = i % 2 ? '#ff5a1f' : '#ffb300';
    c.fill();
  }
}

function lawyer(c: Ctx, cx: number, cy: number, s: number) {
  // suit + head + tire iron over the shoulder
  c.fillStyle = '#1d2a44';
  c.beginPath();
  c.moveTo(cx - s * 0.32, cy + s * 0.5);
  c.lineTo(cx - s * 0.26, cy + s * 0.02);
  c.lineTo(cx + s * 0.26, cy + s * 0.02);
  c.lineTo(cx + s * 0.32, cy + s * 0.5);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(cx - s * 0.08, cy + s * 0.02);
  c.lineTo(cx, cy + s * 0.22);
  c.lineTo(cx + s * 0.08, cy + s * 0.02);
  c.fill();
  c.fillStyle = '#b3202a';
  c.fillRect(cx - s * 0.02, cy + s * 0.04, s * 0.04, s * 0.2);
  circle(c, cx, cy - s * 0.14, s * 0.16);
  fillStroke(c, '#f0c8a0', '#111', 2);
  c.fillStyle = '#4a3020';
  c.beginPath();
  c.arc(cx, cy - s * 0.2, s * 0.16, Math.PI, 0);
  c.fill();
  c.fillStyle = '#111';
  c.fillRect(cx - s * 0.1, cy - s * 0.16, s * 0.07, s * 0.03);
  c.fillRect(cx + s * 0.03, cy - s * 0.16, s * 0.07, s * 0.03);
  c.beginPath();
  c.arc(cx, cy - s * 0.08, s * 0.06, 0.2, Math.PI - 0.2);
  c.stroke();
  icon(c, 'tireIron', cx + s * 0.3, cy - s * 0.02, s * 0.5);
}

function hoodie(c: Ctx, cx: number, cy: number, s: number, col = '#111', txt = '#efe6cf') {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(cx - s * 0.2, cy - s * 0.3);
  c.lineTo(cx - s * 0.42, cy - s * 0.15);
  c.lineTo(cx - s * 0.46, cy + s * 0.3);
  c.lineTo(cx - s * 0.32, cy + s * 0.3);
  c.lineTo(cx - s * 0.3, cy + s * 0.42);
  c.lineTo(cx + s * 0.3, cy + s * 0.42);
  c.lineTo(cx + s * 0.32, cy + s * 0.3);
  c.lineTo(cx + s * 0.46, cy + s * 0.3);
  c.lineTo(cx + s * 0.42, cy - s * 0.15);
  c.lineTo(cx + s * 0.2, cy - s * 0.3);
  c.closePath();
  fillStroke(c, col, '#333', 2);
  ellipse(c, cx, cy - s * 0.28, s * 0.14, s * 0.08);
  fillStroke(c, shade(col, 0.15), '#333', 2);
  slopScript(c, cx, cy + s * 0.05, s * 0.5, txt);
}

function pinstripes(c: Ctx, w: number, h: number, bg: string, line: string) {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = line;
  for (let x = 6; x < w; x += 14) c.fillRect(x, 0, 1.6, h);
}

function chartCrash(c: Ctx, x: number, y: number, w: number, h: number) {
  c.strokeStyle = '#2ecc71';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(x, y + h * 0.8);
  c.lineTo(x + w * 0.2, y + h * 0.6);
  c.lineTo(x + w * 0.35, y + h * 0.7);
  c.lineTo(x + w * 0.55, y + h * 0.1);
  c.stroke();
  c.strokeStyle = '#e74c3c';
  c.beginPath();
  c.moveTo(x + w * 0.55, y + h * 0.1);
  c.lineTo(x + w * 0.7, y + h * 0.5);
  c.lineTo(x + w * 0.8, y + h * 0.4);
  c.lineTo(x + w, y + h);
  c.stroke();
}

export const BILLBOARDS: BillboardDef[] = [
  // ------------------------------------------------ the classics
  { id: 'tireIron', label: 'HURT IN A WRECK? CALL THE TIRE IRON', paint: std({ bg: '#ffd400', fg: '#111', head: ['HURT IN A WRECK?', 'CALL THE TIRE IRON'], sub: '1-800-WRECKED · NO WIN NO FEE · SOME WIN SOME FEE', subBg: '#111', subColor: '#ffd400', art: lawyer }) },
  { id: 'hellIsReal', label: 'HELL IS REAL', pair: 'adultSuperstore', paint: (c, w, h) => {
    c.fillStyle = '#0a0a0a';
    c.fillRect(0, 0, w, h);
    flames(c, w, h, h * 0.55);
    textFit(c, 'HELL IS REAL', 20, 12, w - 40, h * 0.62, { family: F.block, color: '#ffffff', stroke: '#000', strokeW: 0.06 });
  } },
  { id: 'adultSuperstore', label: 'ADULT SUPERSTORE · EXIT 69', pair: 'hellIsReal', paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#ff3ea5', '#7a1f8a');
    textFit(c, 'ADULT SUPERSTORE', 16, 10, w - 32, h * 0.42, { family: F.block, color: '#fff' });
    textFit(c, 'TRUCKERS WELCOME · EXIT 69', 16, h * 0.52, w - 32, h * 0.2, { family: F.sans, weight: 900, color: '#ffe0f0' });
    c.fillStyle = '#111';
    c.fillRect(0, h * 0.78, w, h * 0.22);
    textFit(c, 'XXX · OPEN 24 HRS · XXX', 16, h * 0.8, w - 32, h * 0.17, { family: F.sign, color: '#ffd400' });
  } },
  { id: 'dillos212', label: "DILLO'S · 212 MILES · HOLD IT", paint: std({ bg: '#ffd100', fg: '#c8102e', head: ["DILLO'S", '212 MILES'], sub: 'HOLD IT. · 80 CLEAN TOILETS · BRISKET', subBg: '#c8102e', subColor: '#fff', icon: 'armadillo', headFont: F.round }) },
  { id: 'fireworksExit', label: 'FIREWORKS NEXT EXIT · BUY 1 GET 6 FREE', paint: std({ bg: '#1d3a8a', fg: '#fff', head: ['FIREWORKS', 'NEXT EXIT'], sub: 'BUY 1 GET 6 FREE · FREEDOM FIREWORKS', subBg: '#b3202a', icon: 'fireworks', iconRight: true }) },
  { id: 'jesusMattress', label: 'JESUS IS COMING · ALSO: MATTRESS SALE', paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#7fb3ff', '#ffffff');
    textFit(c, 'JESUS IS COMING', 20, 12, w - 40, h * 0.45, { family: F.serif, weight: 700, color: '#1d3a8a' });
    c.fillStyle = '#b3202a';
    c.fillRect(0, h * 0.6, w, h * 0.4);
    textFit(c, 'ALSO: MATTRESS SALE · MATTRESS KINGDOM', 20, h * 0.64, w - 40, h * 0.3, { family: F.block, color: '#fff' });
  } },
  // ------------------------------------------------ crypto & AI slop
  { id: 'bitcorn', label: 'BITCORN ATM · INSIDE EVERY VAPE SHOP', paint: std({ bg: '#111', fg: '#f5b300', head: ['BITCORN ATM', 'INSIDE EVERY VAPE SHOP'], sub: 'BUY · SELL · CRY', icon: 'coin' }) },
  { id: 'slopcoin', label: '$SLOPCOIN: YOUR 401K BUT FUNNIER', paint: (c, w, h) => {
    c.fillStyle = '#0b0f1a';
    c.fillRect(0, 0, w, h);
    chartCrash(c, w * 0.62, 20, w * 0.34, h - 40);
    textFit(c, '$SLOPCOIN', 16, 10, w * 0.58, h * 0.5, { family: F.sign, color: '#c6f432' });
    linesFit(c, ['YOUR 401K,', 'BUT FUNNIER'], 16, h * 0.56, w * 0.58, h * 0.38, { family: F.block, color: '#fff' });
  } },
  { id: 'hodl', label: 'HODL (YOUR BREATH)', paint: (c, w, h) => {
    c.fillStyle = '#141414';
    c.fillRect(0, 0, w, h);
    chartCrash(c, 20, 20, w * 0.36, h - 40);
    textFit(c, 'HODL', w * 0.42, 6, w * 0.55, h * 0.62, { family: F.block, color: '#f5b300' });
    textFit(c, '(YOUR BREATH)', w * 0.42, h * 0.68, w * 0.55, h * 0.24, { family: F.sans, weight: 900, color: '#fff' });
  } },
  { id: 'neuralThink', label: 'NEURAL FLY: WHY THINK? WE HALLUCINATE FOR YOU', paint: (c, w, h) => {
    c.fillStyle = '#07070f';
    c.fillRect(0, 0, w, h);
    neuralFly(c, h * 0.55, h * 0.5, h * 0.95);
    textFit(c, 'WHY THINK?', h * 1.1, 12, w - h * 1.2, h * 0.42, { family: F.sign, color: '#34f5ff' });
    textFit(c, 'WE HALLUCINATE FOR YOU', h * 1.1, h * 0.56, w - h * 1.2, h * 0.2, { family: F.sans, weight: 900, color: '#ff2bd6' });
    textFit(c, 'NEURAL FLY · COMPUTE GOES BRRR', h * 1.1, h * 0.8, w - h * 1.2, h * 0.12, { family: F.sans, weight: 800, color: '#c6f432' });
  } },
  { id: 'aiHand', label: 'THIS BILLBOARD WAS MADE BY AI · ENJOY YOUR 7 FINGERS', paint: std({ bg: '#f4f1ea', fg: '#222', head: ['THIS BILLBOARD WAS', 'MADE BY AI :)'], sub: 'ENJOY YOUR 7 FINGERS · INFINITE SLOP', subBg: '#ef233c', subColor: '#fff', icon: 'hand7', headFont: F.sans }) },
  { id: 'promptWanted', label: 'PROMPT ENGINEERS WANTED', paint: std({ bg: '#111', fg: '#c6f432', head: ['PROMPT ENGINEERS', 'WANTED'], sub: 'MUST HAVE 10 YRS EXP IN 2-YR-OLD TECH', subColor: '#fff', icon: 'chip' }) },
  { id: 'aiGirlfriend', label: 'LONELY? SO IS YOUR AI', paint: std({ bg: '#ffb3d9', fg: '#6a0572', head: ['LONELY?', 'SO IS YOUR AI'], sub: 'CHAT NOW · $49.99/MO · SHE REMEMBERS NOTHING', icon: 'chip', iconRight: true }) },
  // ------------------------------------------------ culture war, both directions
  { id: 'wokeBrew', label: 'WOKE BREW: ETHICALLY SOURCED GUILT', paint: std({ bg: '#1b4332', fg: '#d8f3dc', head: ['ETHICALLY', 'SOURCED GUILT'], sub: 'WOKE BREW COFFEE · OAT MILK +$2', icon: 'coffeeEye', headFont: F.sans }) },
  { id: 'coalRollin', label: "COAL ROLLIN' DIESEL: TRIGGER A PRIUS TODAY", paint: std({ bg: '#1a1a1a', fg: '#ff6b00', head: ['TRIGGER A', 'PRIUS TODAY'], sub: "COAL ROLLIN' DIESEL · LIFT KITS · STACKS", subColor: '#fff', icon: 'truck' }) },
  { id: 'fifteenMin', label: '15-MINUTE CITIES ARE COMMUNISM', paint: (c, w, h) => {
    c.fillStyle = '#b3202a';
    c.fillRect(0, 0, w, h);
    linesFit(c, ['15-MINUTE CITIES', 'ARE COMMUNISM'], 18, 10, w - 36, h * 0.66, { family: F.block, color: '#fff' });
    textFit(c, 'PAID FOR BY YOUR 74-MINUTE COMMUTE', 18, h * 0.76, w - 36, h * 0.16, { family: F.sans, weight: 900, color: '#ffd400' });
  } },
  { id: 'buyLocal', label: 'BUY LOCAL (AT SPRAWLMART)', paint: std({ bg: '#0071ce', fg: '#fff', head: ['BUY LOCAL'], sub: '(AT SPRAWLMART · 1,200 FREE PARKING SPACES)', subColor: '#ffc220', icon: 'sun', headFont: F.sans }) },
  { id: 'soyLatte', label: 'SOY LATTE CO. · NOW WITH MORE OATS', paint: std({ bg: '#f1e3c8', fg: '#4a6b2a', head: ['NOW WITH', 'MORE OATS'], sub: 'SOY LATTE CO. · OAT · ALMOND · VIBES', icon: 'soy', headFont: F.script }) },
  { id: 'dontTread', label: "DON'T TREAD ON ME (OR MY PARKING SPACE)", paint: (c, w, h) => {
    c.fillStyle = '#f2c230';
    c.fillRect(0, 0, w, h);
    // coiled snake
    c.strokeStyle = '#3a5a1a';
    c.lineWidth = 12;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(h * 0.55, h * 0.58, h * 0.24, 0.2, Math.PI * 2.2);
    c.stroke();
    c.beginPath();
    c.arc(h * 0.55, h * 0.58, h * 0.12, 0, Math.PI * 1.6);
    c.stroke();
    c.fillStyle = '#3a5a1a';
    ellipse(c, h * 0.82, h * 0.3, 14, 9, -0.5);
    c.fill();
    linesFit(c, ["DON'T TREAD ON ME"], h * 1.1, 12, w - h * 1.2, h * 0.5, { family: F.serif, weight: 700, color: '#111' });
    textFit(c, '(OR MY PARKING SPACE)', h * 1.1, h * 0.64, w - h * 1.2, h * 0.24, { family: F.sans, weight: 900, color: '#111' });
  } },
  { id: 'bikeLane', label: 'CONSERVATIVES HATE THIS BIKE LANE', paint: std({ bg: '#2d6a4f', fg: '#fff', head: ['CONSERVATIVES HATE', 'THIS ONE BIKE LANE'], sub: '(THERE IS NO BIKE LANE · SKYLER 2028)', subColor: '#b7e4c7', headFont: F.sans }) },
  { id: 'liberalTruck', label: 'LIBERALS HATE THIS ONE WEIRD TRUCK', paint: std({ bg: '#0b1d3a', fg: '#fff', head: ['LIBERALS HATE THIS', 'ONE WEIRD TRUCK'], sub: '(IT GETS 9 MPG AND HAS NEVER HAULED ANYTHING)', subColor: '#ffd400', icon: 'truck', headFont: F.sans }) },
  { id: 'evCoal', label: 'EV CHARGING · POWERED BY 100% CLEAN COAL', paint: std({ bg: '#e8f5e9', fg: '#1b5e20', head: ['EV CHARGING', 'AHEAD'], sub: 'POWERED BY 100% CLEAN COAL', subBg: '#111', subColor: '#fff', icon: 'bolt', headFont: F.sans }) },
  { id: 'wholePaycheck', label: 'WHOLE PAYCHECK · $14 KALE', paint: std({ bg: '#00674b', fg: '#f2e8cf', head: ['$14 KALE'], sub: 'WHOLE PAYCHECK · ORGANIC FEELINGS', icon: 'soy', headFont: F.serif }) },
  { id: 'kombucha', label: 'KOMBUCHA KOLLECTIVE · FERMENTED OPINIONS', paint: std({ bg: '#ffd6ff', fg: '#7b2cbf', head: ['FERMENTED', 'OPINIONS ON TAP'], sub: 'KOMBUCHA KOLLECTIVE · GLUTEN FREE-DOM', headFont: F.marker }) },
  { id: 'tacticalSocks', label: "TACTICAL TED'S: TACTICAL SOCKS IN STOCK", paint: std({ bg: '#4b5320', fg: '#f4efe2', head: ['TACTICAL SOCKS', 'IN STOCK'], sub: "TACTICAL TED'S · EXIT 14 · ALSO TACTICAL SPOONS", icon: 'shield' }) },
  { id: 'cancelCleaners', label: 'CANCEL CULTURE CLEANERS', paint: std({ bg: '#fff', fg: '#023e8a', head: ['ANY STAIN.', 'EVEN YOUR REPUTATION.'], sub: 'CANCEL CULTURE CLEANERS · SAME-DAY APOLOGY', icon: 'wave', headFont: F.sans }) },
  { id: 'crystals', label: 'CRYSTAL HEALING: ALIGN YOUR CREDIT SCORE', paint: std({ bg: '#f1e9ff', fg: '#7209b7', head: ['ALIGN YOUR', 'CREDIT SCORE'], sub: 'CRYSTAL HEALING & CBD · NO REFUNDS (MERCURY IS IN RETROGRADE)', icon: 'sparkle', headFont: F.script }) },
  // ------------------------------------------------ local business
  { id: 'blackrack', label: 'BLACKRACK: WE BOUGHT YOUR NEIGHBORHOOD', paint: std({ bg: '#111', fg: '#fff', head: ['WE BOUGHT YOUR', 'NEIGHBORHOOD'], sub: 'BLACKRACK CAPITAL · RENT IS DUE', subColor: '#9aa0a6', icon: 'house', headFont: F.sans }) },
  { id: 'gigWorker', label: 'NOW HIRING: GIG WORKERS · BENEFITS: VIBES', paint: std({ bg: '#ff6b00', fg: '#fff', head: ['NOW HIRING:', 'GIG WORKERS'], sub: 'BENEFITS: VIBES · BRING YOUR OWN CAR', subBg: '#111', icon: 'box' }) },
  { id: 'ladyLiberty', label: "LADY LIBERTY TAX: WE'LL FIND YOU A REFUND", paint: std({ bg: '#fff', fg: '#1d3a8a', head: ["WE'LL FIND YOU", 'A REFUND'], sub: '(NOT GUARANTEED) · LADY LIBERTY TAX', subColor: '#b3202a', icon: 'torch', headFont: F.sans }) },
  { id: 'ezMoney', label: 'EZ MONEY: YOUR TRUCK = CASH', paint: std({ bg: '#2e7d32', fg: '#ffd400', head: ['YOUR TRUCK', '= CASH'], sub: "(UNTIL IT ISN'T) · EZ MONEY TITLE LOANS · 389% APR", subColor: '#fff', icon: 'moneyBag' }) },
  { id: 'whisperingPines', label: 'WHISPERING PINES ESTATES · NOW PAVING', paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#fdf6e3', '#e9dcc0');
    icon(c, 'house', h * 0.55, h * 0.5, h * 0.8);
    textFit(c, 'Whispering Pines Estates', h * 1.1, 10, w - h * 1.2, h * 0.36, { family: F.script, color: '#2f5a30' });
    textFit(c, 'NOW PAVING · FROM THE LOW $400s', h * 1.1, h * 0.5, w - h * 1.2, h * 0.2, { family: F.sans, weight: 900, color: '#222' });
    textFit(c, '*pines not included', h * 1.1, h * 0.76, w - h * 1.2, h * 0.14, { family: F.sans, weight: 400, italic: true, color: '#555' });
  } },
  { id: 'lakefront', label: 'LAKEFRONT LIVING! (RETENTION POND)', paint: std({ bg: '#1e88e5', fg: '#fff', head: ['LAKEFRONT', 'LIVING!'], sub: '*STORMWATER RETENTION POND · LAKE SERENITY ESTATES', subColor: '#e3f2fd', icon: 'wave', iconRight: true, headFont: F.script }) },
  { id: 'chickClosed', label: "CHICK-FIL-EH: SORRY, WE'RE CLOSED. EH.", paint: std({ bg: '#fff', fg: '#d71920', head: ["SORRY, WE'RE", 'CLOSED. EH.'], sub: 'CHICK-FIL-EH · EVERY SUNDAY · AND HOLIDAYS · AND WHEN WE FEEL LIKE IT', subColor: '#333', icon: 'chicken', headFont: F.script }) },
  { id: 'waffleNever', label: 'WAFFLE HUT · NEVER CLOSED', paint: (c, w, h) => {
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 0, w, h);
    const t = 'WAFFLE HUT';
    const tw = (w - 40) / t.length;
    t.split('').forEach((ch, i) => {
      if (ch === ' ') return;
      c.fillStyle = '#ffd400';
      c.fillRect(20 + i * tw + 2, 14, tw - 4, tw - 4);
      textFit(c, ch, 20 + i * tw + 4, 18, tw - 8, tw - 12, { family: F.sans, weight: 900, color: '#111' });
    });
    textFit(c, 'NEVER CLOSED (EXCEPT THE APOCALYPSE)', 20, h * 0.66, w - 40, h * 0.22, { family: F.sans, weight: 900, color: '#ffd400' });
  } },
  { id: 'mattressOther', label: 'THE OTHER MATTRESS KINGDOM IS ACROSS THE STREET', paint: std({ bg: '#1c3f94', fg: '#fff', head: ['THE OTHER', 'MATTRESS KINGDOM'], sub: 'IS ACROSS THE STREET. NOBODY KNOWS WHO BUYS THE MATTRESSES.', subColor: '#ffd400', icon: 'mattress' }) },
  { id: 'bigDale', label: 'BIG DALE FOR COMMISSIONER · ONE MORE LANE', paint: (c, w, h) => {
    stripes(c, 0, 0, w, h, ['#b3202a', '#f4efe2'], 7);
    c.fillStyle = '#1d3a8a';
    c.fillRect(0, 0, w * 0.34, h);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = '#fff';
      star(c, 20 + (i % 3) * 52, 30 + Math.floor(i / 3) * 50, 12);
      c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(w * 0.36, 16, w * 0.62, h - 32);
    linesFit(c, ['BIG DALE', 'ONE MORE LANE'], w * 0.38, 22, w * 0.58, h - 44, { family: F.block, color: '#1d3a8a' });
  } },
  { id: 'cousinDale', label: "COUSIN DALE'S PAVING: NO BID TOO LOW", paint: std({ bg: '#ffd400', fg: '#111', head: ['NO BID', 'TOO LOW'], sub: "COUSIN DALE'S PAVING LLC · POTHOLES GUARANTEED", subBg: '#111', subColor: '#ffd400' }) },
  { id: 'hoots', label: 'HOOTS: GREAT WINGS. NICE VIEWS.', paint: std({ bg: '#ff6600', fg: '#fff', head: ['GREAT WINGS.', 'NICE VIEWS.'], sub: 'HOOTS · EXIT 12 · FAMILY FRIENDLY-ISH', icon: 'owl', headFont: F.round }) },
  { id: 'possumPetes', label: "POSSUM PETE'S: LIVE BAIT · HOT CHICKEN · LOTTO", paint: std({ bg: '#ffcc33', fg: '#3b2a1a', head: ['LIVE BAIT · HOT CHICKEN', '· LOTTO ·'], sub: "(NOT THE SAME FRIDGE) · POSSUM PETE'S GAS-N-GO", icon: 'possum', headFont: F.round }) },
  { id: 'cicada', label: 'CICADA WIRELESS: 5G IS HERE', paint: std({ bg: '#6a1b9a', fg: '#fff', head: ['5G IS HERE'], sub: 'NOW BUFFERING AT 5 GIGS · CICADA WIRELESS', subColor: '#b2ff59', icon: 'cicada', headFont: F.sans }) },
  { id: 'freedomFireworks', label: "FREEDOM FIREWORKS: WE'RE NOT LEGALLY A BOMB STORE", paint: std({ bg: '#b3202a', fg: '#fff', head: ["WE'RE NOT LEGALLY", 'A BOMB STORE'], sub: 'FREEDOM FIREWORKS · OPEN 365 · 4 FINGERS MINIMUM', subBg: '#1d3a8a', icon: 'fireworks' }) },
  { id: 'cyberslop', label: 'CYBERSLOP: BULLETPROOF. NOT RAINPROOF.', paint: std({ bg: '#1b1b1b', fg: '#e0e4e8', head: ['BULLETPROOF.', 'NOT RAINPROOF.'], sub: 'CYBERSLOP · FULL SELF-DRIVING NEXT YEAR', subColor: '#ff5252', headFont: F.sans }) },
  { id: 'specter', label: 'SPECTER HALLOWEEN: COMING SOON TO YOUR DEAD MALL', paint: std({ bg: '#111', fg: '#ff7518', head: ['COMING SOON', 'TO YOUR DEAD MALL'], sub: 'SPECTER HALLOWEEN · NOW HIRING SEASONAL GHOULS', subColor: '#fff', icon: 'ghost', headFont: F.marker }) },
  { id: 'prosperityDome', label: 'PROSPERITY DOME · EASTER PARKING NOW OPEN', paint: std({ bg: '#fff8e1', fg: '#6a1b9a', head: ['PROSPERITY DOME'], sub: 'EASTER PARKING NOW OPEN · 4,000 SPACES · COFFEE BAR', subBg: '#6a1b9a', subColor: '#fff8e1', icon: 'cross', headFont: F.serif }) },
  { id: 'cloudChasers', label: 'CLOUD CHASERS VAPE: MANGO POD HQ', paint: std({ bg: '#0d1b2a', fg: '#4cc9f0', head: ['MANGO POD', 'HEADQUARTERS'], sub: 'CLOUD CHASERS VAPE · NEXT EXIT', subColor: '#f72585', icon: 'cloud', headFont: F.sign }) },
  { id: 'contentHouse', label: 'GET RICH POSTING · SLOPTOK CONTENT HOUSE', paint: std({ bg: '#111', fg: '#25f4ee', head: ['GET RICH', 'POSTING'], sub: 'SLOPTOK CONTENT HOUSE · NOW RECRUITING · LIKE & SUBSCRIBE', subColor: '#fe2c55', headFont: F.marker }) },
  { id: 'muskratMars', label: 'ELONGATED MUSKRAT: MARS OR BUST', paint: std({ bg: '#1a0f0a', fg: '#ff7043', head: ['MARS OR BUST'], sub: '(PROBABLY BUST) · A MESSAGE FROM ELONGATED MUSKRAT', subColor: '#fff', icon: 'sun', headFont: F.sans }) },
  { id: 'zuckerborgLegs', label: 'ZUCKERBORG: LEGS COMING Q3', paint: std({ bg: '#0866ff', fg: '#fff', head: ['LEGS', 'COMING Q3'], sub: 'ZUCKERBORG METAVERSE · WE KNOW WHERE YOU PARKED', headFont: F.sans }) },
  { id: 'luxuryApts', label: 'LUXURY APARTMENTS FROM $2,995', paint: std({ bg: '#e9e2d0', fg: '#3a3a3c', head: ['LUXURY LIVING', 'FROM $2,995'], sub: '400 SQ FT · NO PARKING · GRANITE (VINYL) · THE VUE @ CREEKSIDE', subBg: '#e07a3f', subColor: '#fff', icon: 'house', headFont: F.sans }) },
  { id: 'slopEnergy', label: 'SLOP ENERGY: 900MG CAFFEINE', paint: (c, w, h) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
    // can
    rr(c, 24, 16, h * 0.5, h - 32, 10);
    c.fillStyle = '#c6f432';
    c.fill();
    c.save();
    c.translate(24 + h * 0.25, h / 2);
    c.rotate(-Math.PI / 2);
    textFit(c, 'SLOP', -h * 0.38, -h * 0.16, h * 0.76, h * 0.32, { family: F.block, color: '#111' });
    c.restore();
    textFit(c, 'SLOP ENERGY', h * 0.7, 12, w - h * 0.8, h * 0.5, { family: F.block, color: '#c6f432' });
    textFit(c, '900MG CAFFEINE · HEART SOLD SEPARATELY', h * 0.7, h * 0.66, w - h * 0.8, h * 0.2, { family: F.sans, weight: 900, color: '#fff' });
  } },
  { id: 'slopBeer', label: 'SLOP BEER: BREWED WITH FLAMMABLE TAP WATER', paint: std({ bg: '#c98b1a', fg: '#111', head: ['Slop Beer'], sub: 'BREWED WITH FLAMMABLE TAP WATER · DRINK RESPONSIBLY-ISH', subBg: '#111', subColor: '#efe6cf', icon: 'bottle', headFont: F.script }) },
  { id: 'dealership', label: "BIG EARL'S: NO CREDIT? NO PROBLEM", paint: std({ bg: '#d00000', fg: '#ffd400', head: ['NO CREDIT?', 'NO PROBLEM!'], sub: "BIG EARL'S BUY HERE PAY HERE · WE TOW IT BACK FOR FREE", subColor: '#fff', icon: 'car' }) },

  // ------------------------------------------------ Imagine Supply Co. (real, owned)
  { id: 'm_slopScript', label: 'Slop · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
    slopScript(c, w * 0.4, h * 0.42, w * 0.6, '#efe6cf', { h: h * 0.84 });
    distress(c, 0, 0, w, h, '#111', rngFor('m_slop'), 1.3);
    textFit(c, 'THE OFFICIAL FIT OF SLOPMERICA', w * 0.74, 18, w * 0.24, h * 0.4, { family: F.block, color: '#efe6cf' });
    domain(c, w, h);
  } },
  { id: 'm_cannon', label: 'GET IN THE F*CKING CANNON · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
    cannon(c, h * 0.6, h * 0.58, h * 0.95, { smoke: true, color: '#3a3a3a' });
    blockSlogan(c, ['GET IN THE', 'F*CKING CANNON'], h * 1.15, 10, w - h * 1.25, h * 0.7, '#c6f432');
    domain(c, w, h, '#efe6cf');
  } },
  { id: 'm_lightning', label: 'SL⚡OP LIGHTNING TEE · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
    slopLightning(c, 10, 12, w * 0.62, h * 0.7, '#f7d117');
    textFit(c, 'LIGHTNING TEE', w * 0.66, 30, w * 0.3, h * 0.3, { family: F.block, color: '#f7d117' });
    domain(c, w, h, '#efe6cf');
  } },
  { id: 'm_wigette', label: 'Wigette · imaginesupply.co', merch: true, paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#ff9ecf', '#ff5ab0');
    for (let i = 0; i < 12; i++) {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      star(c, 40 + (i * 97) % w, 20 + (i * 53) % h, 6);
      c.fill();
    }
    wigette(c, h * 0.62, h * 0.54, h * 0.95);
    textFit(c, 'WIGETTE', h * 1.2, 10, w - h * 1.3, h * 0.46, { family: F.round, color: '#fff', stroke: '#111', strokeW: 0.08 });
    textFit(c, 'WINK WINK · SLOP', h * 1.2, h * 0.56, w - h * 1.3, h * 0.18, { family: F.sans, weight: 900, color: '#111' });
    domain(c, w, h, '#111');
  } },
  { id: 'm_cannonBoys', label: 'The Cannon Boys · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#c6f432';
    c.fillRect(0, 0, w, h);
    cannonBoys(c, h * 0.95, h * 0.55, h * 0.9);
    textFit(c, 'THE CANNON BOYS', h * 1.8, 16, w - h * 1.9, h * 0.4, { family: F.block, color: '#111' });
    textFit(c, 'WIGLET & FRIEND · LOOSE CANNONS', h * 1.8, h * 0.58, w - h * 1.9, h * 0.16, { family: F.sans, weight: 900, color: '#111' });
    domain(c, w, h, '#111');
  } },
  { id: 'm_fillErUp', label: 'Fill Er Up Tee · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#f4efe2';
    c.fillRect(0, 0, w, h);
    fillErUpGuy(c, h * 0.72, h * 0.52, h * 0.95, true);
    textFit(c, 'FILL ER UP', h * 1.4, 12, w - h * 1.5, h * 0.46, { family: F.sign, color: '#b3202a', stroke: '#1d3a8a', strokeW: 0.05 });
    textFit(c, 'THE TEE · GAS NOT INCLUDED', h * 1.4, h * 0.6, w - h * 1.5, h * 0.16, { family: F.sans, weight: 900, color: '#1d3a8a' });
    domain(c, w, h, '#b3202a');
  } },
  { id: 'm_pigCabana', label: 'Pig Cabana resort wear · imaginesupply.co', merch: true, paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#7fe3dd', '#12a39a');
    icon(c, 'palm', w - 60, h * 0.5, h * 0.9);
    icon(c, 'palm', w - 120, h * 0.55, h * 0.7);
    pigHead(c, h * 0.55, h * 0.5, h * 0.85, { grin: true, starShades: true });
    textFit(c, 'PIG CABANA', h * 1.05, 14, w * 0.55, h * 0.44, { family: F.round, color: '#ffe7ef', stroke: '#b3124a', strokeW: 0.08 });
    textFit(c, 'RESORT SHIRTS & SHORTS', h * 1.05, h * 0.58, w * 0.55, h * 0.16, { family: F.sans, weight: 900, color: '#063b37' });
    domain(c, w, h, '#fff');
  } },
  { id: 'm_neuralFly', label: 'Neural Fly sweatshirt · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#0a0014';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      c.strokeStyle = ['#ff2bd6', '#34f5ff', '#c6f432', '#ffb800', '#7a2bff', '#ff4b1f'][i];
      c.lineWidth = 3;
      circle(c, h * 0.6, h * 0.5, 20 + i * 12);
      c.stroke();
    }
    neuralFly(c, h * 0.6, h * 0.5, h * 0.8);
    textFit(c, 'NEURAL FLY', h * 1.3, 14, w - h * 1.4, h * 0.44, { family: F.sign, color: '#34f5ff' });
    textFit(c, 'THE SWEATSHIRT · TRIPPY BY DEFAULT', h * 1.3, h * 0.58, w - h * 1.4, h * 0.16, { family: F.sans, weight: 900, color: '#ff2bd6' });
    domain(c, w, h);
  } },
  { id: 'm_slop69', label: 'Slop 69 jersey · imaginesupply.co', merch: true, paint: (c, w, h) => {
    pinstripes(c, w, h, '#f4efe2', '#1d3a8a');
    slopScript(c, w * 0.34, h * 0.36, w * 0.44, '#1d3a8a', { outline: '#b3202a', h: h * 0.66 });
    textFit(c, '69', w * 0.62, 10, w * 0.3, h * 0.7, { family: F.block, color: '#b3202a', stroke: '#1d3a8a', strokeW: 0.06 });
    textFit(c, 'PINSTRIPE JERSEY', 20, h * 0.74, w * 0.5, h * 0.16, { family: F.sans, weight: 900, color: '#1d3a8a' });
    domain(c, w, h, '#1d3a8a');
  } },
  { id: 'm_badLuck', label: 'Bad Luck Club · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#0b5d3b';
    c.fillRect(0, 0, w, h);
    icon(c, 'eightBalls', h * 0.65, h * 0.5, h * 0.95);
    textFit(c, 'BAD LUCK CLUB', h * 1.3, 16, w - h * 1.4, h * 0.44, { family: F.sign, color: '#f4efe2' });
    textFit(c, 'MEMBERSHIP: GUARANTEED', h * 1.3, h * 0.6, w - h * 1.4, h * 0.16, { family: F.sans, weight: 900, color: '#c6f432' });
    domain(c, w, h);
  } },
  { id: 'm_propane', label: 'Propane Paradise · imaginesupply.co', merch: true, paint: (c, w, h) => {
    gradV(c, 0, 0, w, h, '#ffb35c', '#ff6f91');
    c.fillStyle = '#ffe066';
    circle(c, w * 0.8, h * 0.62, h * 0.5);
    c.fill();
    c.fillStyle = '#12a39a';
    c.fillRect(0, h * 0.8, w, h * 0.2);
    icon(c, 'propane', h * 0.4, h * 0.55, h * 0.8);
    icon(c, 'palm', h * 0.9, h * 0.5, h * 0.9);
    textFit(c, 'PROPANE PARADISE', h * 1.3, 14, w - h * 1.4, h * 0.42, { family: F.round, color: '#fff', stroke: '#8a2a0a', strokeW: 0.08 });
    textFit(c, 'THE BEACH BUTTON-UP', h * 1.3, h * 0.56, w - h * 1.4, h * 0.16, { family: F.sans, weight: 900, color: '#3b1f14' });
    domain(c, w, h, '#fff');
  } },
  { id: 'm_myOwnPropane', label: 'My Own Propane · imaginesupply.co', merch: true, paint: std({ bg: '#1d4fa3', fg: '#fff', head: ['MY OWN', 'PROPANE'], sub: 'REFILL · EXCHANGE · GRILL LIKE YOU MEAN IT · imaginesupply.co', subColor: '#c6f432', icon: 'propane', headFont: F.round }) },
  { id: 'm_hoodie', label: 'Slop Script Hoodie · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#efe6cf';
    c.fillRect(0, 0, w, h);
    hoodie(c, h * 0.6, h * 0.52, h * 0.95);
    textFit(c, 'THE SLOP SCRIPT HOODIE', h * 1.25, 16, w - h * 1.35, h * 0.3, { family: F.block, color: '#111' });
    textFit(c, 'BEANIE · SNAPBACK · MUG · WORK HOODIE', h * 1.25, h * 0.5, w - h * 1.35, h * 0.16, { family: F.sans, weight: 900, color: '#333' });
    domain(c, w, h, '#b3202a');
  } },
  { id: 'm_looseCannon', label: 'Loose Cannon · Short Fuse · Play With Fire · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#b3202a';
    c.fillRect(0, 0, w, h);
    linesFit(c, ['LOOSE CANNON · SHORT FUSE', 'PLAY WITH FIRE · SMOKE SIGNAL'], 20, 14, w - 40, h * 0.62, { family: F.block, color: '#efe6cf' });
    textFit(c, 'SLOP CANNON', 20, h * 0.76, 200, h * 0.16, { family: F.sans, weight: 900, color: '#111' });
    domain(c, w, h, '#efe6cf');
  } },
  { id: 'm_fruit', label: 'Hot Piece · Sweet Trouble · Cherry Fuse · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#fff4ec';
    c.fillRect(0, 0, w, h);
    const items: [string, string, string][] = [['peach', 'HOT PIECE', '#ff7a45'], ['strawberry', 'SWEET TROUBLE', '#e0233a'], ['cherryBomb', 'CHERRY FUSE', '#c1121f']];
    items.forEach(([ic, t, col], i) => {
      const cx = (i + 0.5) * (w / 3);
      icon(c, ic, cx, h * 0.38, h * 0.55);
      textFit(c, t, cx - w / 6 + 8, h * 0.68, w / 3 - 16, h * 0.16, { family: F.round, color: col });
    });
    domain(c, w, h, '#111');
  } },
  { id: 'm_dirtyHabits', label: 'Dirty Habits · imaginesupply.co', merch: true, paint: (c, w, h) => {
    c.fillStyle = '#141414';
    c.fillRect(0, 0, w, h);
    icon(c, 'martini', h * 0.6, h * 0.5, h * 0.9);
    textFit(c, 'Dirty Habits', h * 1.2, 10, w - h * 1.3, h * 0.5, { family: F.script, color: '#ffd166' });
    textFit(c, 'SHAKEN · STIRRED · SLOPPY', h * 1.2, h * 0.62, w - h * 1.3, h * 0.14, { family: F.sans, weight: 900, color: '#7ae582' });
    domain(c, w, h);
  } },
];

const BB_RES = 0.62; // 512x160 logical -> ~318x100 in the atlas

export function registerBillboards() {
  for (const b of BILLBOARDS) {
    defTile('bb:' + b.id, 512, 160, (c, w, h, L: Layer) => {
      b.paint(c, w, h);
      if (L === 'e') {
        // floodlit from the catwalk: bright at the top, falling off
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(0,0,0,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0.6)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
    }, { emissive: true, res: BB_RES });
  }
  // back of a billboard: steel bracing
  defTile('bb:back', 256, 80, (c, w, h) => {
    c.fillStyle = '#6f7479';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4a4e52';
    c.lineWidth = 4;
    for (let x = 0; x <= w; x += 32) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    drawText(c, 'SPRAWL OUTDOOR ADVERTISING', w / 2, h - 8, 10, { family: F.sans, weight: 900, color: '#3a3e42', align: 'center' });
  }, { wrap: true });
}

export function billboardIds(merch?: boolean) {
  return BILLBOARDS.filter((b) => merch === undefined || !!b.merch === merch).map((b) => b.id);
}
