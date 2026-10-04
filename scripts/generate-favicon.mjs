// Builds the Mandarin Orchid emblem icons from images/logo.png.
// Run with `npm run favicon` after changing the logo.
import fs from 'node:fs/promises';
import sharp from 'sharp';

const emblem = { left: 183, top: 0, width: 187, height: 145 }; // the gold mark above the wordmark
const gold = { r: 176, g: 131, b: 44 }; // slightly deeper than the brand gold for contrast on light tabs

const mark = await sharp('images/logo.png').extract(emblem).ensureAlpha().png().toBuffer();

/** Spreads the alpha channel to neighbouring pixels so thin strokes survive at tab size. */
function thicken(alpha, size, strength) {
  const out = Buffer.alloc(alpha.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let neighbour = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size) neighbour = Math.max(neighbour, alpha[ny * size + nx]);
        }
      }
      out[y * size + x] = Math.max(alpha[y * size + x], Math.round(neighbour * strength));
    }
  }
  return out;
}

/** Centres the emblem on a square canvas, recoloured in solid resort gold. */
async function icon(size, { padding = 0.08, strength = 0, background } = {}) {
  const inner = Math.round(size * (1 - padding * 2));
  const fitted = sharp(mark).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  let alpha = await fitted.extractChannel('alpha').raw().toBuffer();
  if (strength) alpha = thicken(alpha, inner, strength);
  const shape = await sharp({ create: { width: inner, height: inner, channels: 3, background: gold } })
    .joinChannel(alpha, { raw: { width: inner, height: inner, channels: 1 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: background || { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shape, gravity: 'center' }])
    .png()
    .toBuffer();
}

await fs.mkdir('admin/src/icons', { recursive: true });
await fs.writeFile('admin/src/icons/favicon-32.png', await icon(32, { padding: 0.02, strength: 0.35 }));
await fs.writeFile('admin/src/icons/favicon-64.png', await icon(64, { padding: 0.04, strength: 0.2 }));
// Home-screen icons cannot be transparent on iOS, so use the resort's ivory.
await fs.writeFile('admin/src/icons/apple-touch-icon.png', await icon(180, { padding: 0.16, background: { r: 253, g: 250, b: 245, alpha: 1 } }));
console.log('Wrote admin/src/icons/');
