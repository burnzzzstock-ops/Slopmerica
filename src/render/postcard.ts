/** Keep the WebGL readback in the same task as the draw. Browsers may discard
 * the default framebuffer as soon as they present it. The DOM HUD is excluded. */
export async function photoPNG(source: HTMLCanvasElement, draw: () => void, county: string, framed = true): Promise<Blob> {
  const card = document.createElement('canvas');
  card.width = source.width; card.height = source.height;
  const ctx = card.getContext('2d', { alpha: false });
  if (!ctx || !card.width || !card.height) throw new Error('The photo canvas is unavailable');
  draw();
  ctx.drawImage(source, 0, 0);
  if (framed) {
    if (document.fonts) await Promise.all([document.fonts.load('32px Bungee'), document.fonts.load('32px Yellowtail')]);
    drawPostcard(ctx, county);
  }
  return new Promise((resolve, reject) => card.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode this photo')), 'image/png'));
}

function drawPostcard(ctx: CanvasRenderingContext2D, county: string) {
  const { width: w, height: h } = ctx.canvas;
  const unit = Math.min(w, h), trim = unit * 0.024, inset = trim + unit * 0.028;
  const cream = '#efe6cf', ink = '#111111', red = '#b3202a';
  const name = county.toUpperCase();
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  let size = Math.min(unit * 0.17, h * 0.20);
  ctx.font = `${size}px Bungee, Impact, sans-serif`;
  size *= Math.min(1, (w - 2 * inset) / Math.max(1, ctx.measureText(name).width));
  ctx.font = `${size}px Bungee, Impact, sans-serif`;
  const nameY = h - inset - size * 0.12;
  const greetingY = nameY - size * 0.86;
  const shade = ctx.createLinearGradient(0, greetingY - size, 0, h);
  shade.addColorStop(0, 'rgba(17,17,17,0)'); shade.addColorStop(1, 'rgba(17,17,17,0.62)');
  ctx.fillStyle = shade; ctx.fillRect(0, greetingY - size, w, h - greetingY + size);
  // Offset red letterpress face, narrow ink keyline and a warm two-tone fill.
  ctx.fillStyle = red; ctx.fillText(name, inset + size * 0.045, nameY + size * 0.065);
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, size * 0.045); ctx.strokeText(name, inset, nameY);
  const letter = ctx.createLinearGradient(0, nameY - size * 0.8, 0, nameY);
  letter.addColorStop(0, cream); letter.addColorStop(0.54, cream); letter.addColorStop(1, '#c6f432');
  ctx.fillStyle = letter; ctx.fillText(name, inset, nameY);
  ctx.font = `${size * 0.58}px Yellowtail, cursive`;
  ctx.lineWidth = Math.max(1, size * 0.034); ctx.strokeText('Greetings from', inset, greetingY);
  ctx.fillStyle = cream; ctx.fillText('Greetings from', inset, greetingY);
  ctx.strokeStyle = cream; ctx.lineWidth = 2 * trim; ctx.strokeRect(0, 0, w, h);
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, unit * 0.0024);
  ctx.strokeRect(trim, trim, w - 2 * trim, h - 2 * trim);
}
