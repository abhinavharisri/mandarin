import emblemUrl from './icons/apple-touch-icon.png';

/** The full Mandarin Orchid wordmark, served by the website. */
const logoUrl = '/images/logo.png';

/** Print size: A5 portrait at 300 dpi. */
export const cardWidth = 1748;
export const cardHeight = 2480;

const ivory = '#FBF7EF';
const gold = '#C4963C';
const goldDark = '#8B6B14';
const charcoal = '#1A1814';
const warmGrey = '#6B6560';
const serif = '"Cormorant Garamond", Georgia, serif';
const sans = 'Montserrat, system-ui, sans-serif';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

/** Draws text with letter spacing (canvas letterSpacing is not available everywhere). */
function spacedText(context: CanvasRenderingContext2D, text: string, centerX: number, y: number, spacing: number) {
  const characters = [...text];
  const widths = characters.map(character => context.measureText(character).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (characters.length - 1);
  let x = centerX - total / 2;
  const align = context.textAlign;
  const width = total;
  context.textAlign = 'left';
  characters.forEach((character, index) => {
    context.fillText(character, x, y);
    x += widths[index] + spacing;
  });
  context.textAlign = align;
  return width;
}

function star(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = (Math.PI / 5) * point - Math.PI / 2;
    const r = point % 2 === 0 ? radius : radius * 0.45;
    context.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  context.closePath();
  context.fill();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/**
 * A print-ready "review us" card in the resort's style: a hills photo fading into ivory,
 * gold frame, logo, headline and the QR code (with the emblem at its centre).
 */
export async function drawReviewCard(url: string, photoUrl = '/images/optimized/mistandmornings-1600.webp') {
  const [QRCode, photo, logo, emblem] = await Promise.all([
    import('qrcode'),
    loadImage(photoUrl),
    loadImage(logoUrl),
    loadImage(emblemUrl),
    document.fonts.load(`italic 400 120px ${serif}`),
    document.fonts.load(`500 120px ${serif}`),
    document.fonts.load(`600 30px ${sans}`),
    document.fonts.load(`400 30px ${sans}`),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = cardWidth;
  canvas.height = cardHeight;
  const context = canvas.getContext('2d')!;
  const center = cardWidth / 2;

  // Ivory paper with a soft gold glow.
  context.fillStyle = ivory;
  context.fillRect(0, 0, cardWidth, cardHeight);
  const glow = context.createRadialGradient(center, cardHeight * 0.62, 100, center, cardHeight * 0.62, cardWidth * 0.9);
  glow.addColorStop(0, 'rgba(217, 185, 106, 0.16)');
  glow.addColorStop(1, 'rgba(217, 185, 106, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, cardWidth, cardHeight);

  // Hills photo across the top, fading into the paper.
  const photoHeight = 760;
  const scale = Math.max(cardWidth / photo.width, photoHeight / photo.height);
  const drawWidth = photo.width * scale;
  const drawHeight = photo.height * scale;
  context.save();
  context.beginPath();
  context.rect(0, 0, cardWidth, photoHeight);
  context.clip();
  context.drawImage(photo, (cardWidth - drawWidth) / 2, (photoHeight - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
  const fade = context.createLinearGradient(0, photoHeight * 0.35, 0, photoHeight);
  fade.addColorStop(0, 'rgba(251, 247, 239, 0)');
  fade.addColorStop(1, ivory);
  context.fillStyle = fade;
  context.fillRect(0, 0, cardWidth, photoHeight);

  // Gold double frame.
  context.strokeStyle = gold;
  context.lineWidth = 4;
  context.strokeRect(60, 60, cardWidth - 120, cardHeight - 120);
  context.lineWidth = 1.5;
  context.strokeRect(80, 80, cardWidth - 160, cardHeight - 160);

  // Logo on an ivory medallion where the photo fades out.
  const logoWidth = 560;
  const logoHeight = (logo.height / logo.width) * logoWidth;
  const logoTop = 500;
  context.fillStyle = 'rgba(251, 247, 239, 0.92)';
  roundedRect(context, center - logoWidth / 2 - 50, logoTop - 34, logoWidth + 100, logoHeight + 68, 24);
  context.fill();
  context.drawImage(logo, center - logoWidth / 2, logoTop, logoWidth, logoHeight);

  let y = logoTop + logoHeight + 110;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';

  // Five gold stars and the eyebrow.
  context.fillStyle = gold;
  for (let index = 0; index < 5; index++) star(context, center + (index - 2) * 62, y - 14, 22);
  y += 64;
  context.font = `600 30px ${sans}`;
  context.fillStyle = goldDark;
  spacedText(context, 'GUEST VOICES', center, y, 11);

  // Headline: "Loved your stay?" with "stay" in gold italic.
  y += 140;
  context.font = `500 132px ${serif}`;
  const lead = 'Loved your ';
  const accent = 'stay';
  const tail = '?';
  context.font = `500 132px ${serif}`;
  const leadWidth = context.measureText(lead).width;
  const tailWidth = context.measureText(tail).width;
  context.font = `italic 400 132px ${serif}`;
  const accentWidth = context.measureText(accent).width;
  let x = center - (leadWidth + accentWidth + tailWidth) / 2;
  context.textAlign = 'left';
  context.font = `500 132px ${serif}`;
  context.fillStyle = charcoal;
  context.fillText(lead, x, y);
  x += leadWidth;
  context.font = `italic 400 132px ${serif}`;
  context.fillStyle = gold;
  context.fillText(accent, x, y);
  x += accentWidth;
  context.font = `500 132px ${serif}`;
  context.fillStyle = charcoal;
  context.fillText(tail, x, y);
  context.textAlign = 'center';

  y += 84;
  context.font = `400 36px ${sans}`;
  context.fillStyle = warmGrey;
  context.fillText('Scan to share your experience with us', center, y);

  // QR on a white tile with gold corner accents and the emblem at its centre.
  const tile = 700;
  const tileTop = y + 64;
  const tileLeft = center - tile / 2;
  context.save();
  context.shadowColor = 'rgba(26, 24, 20, 0.12)';
  context.shadowBlur = 60;
  context.shadowOffsetY = 20;
  context.fillStyle = '#FFFFFF';
  roundedRect(context, tileLeft, tileTop, tile, tile, 28);
  context.fill();
  context.restore();
  context.strokeStyle = gold;
  context.lineWidth = 6;
  const corner = 70;
  const inset = 22;
  for (const [cx, cy, dx, dy] of [[tileLeft + inset, tileTop + inset, 1, 1], [tileLeft + tile - inset, tileTop + inset, -1, 1], [tileLeft + inset, tileTop + tile - inset, 1, -1], [tileLeft + tile - inset, tileTop + tile - inset, -1, -1]] as const) {
    context.beginPath();
    context.moveTo(cx, cy + dy * corner);
    context.lineTo(cx, cy);
    context.lineTo(cx + dx * corner, cy);
    context.stroke();
  }

  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const modules = qr.modules.size;
  // Wide blank margin (more than the 4 modules scanners need) inside the tile's gold corners.
  const qrSize = tile - 230;
  const cell = qrSize / modules;
  const qrLeft = center - qrSize / 2;
  const qrTop = tileTop + (tile - qrSize) / 2;
  context.fillStyle = charcoal;
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (qr.modules.get(row, column)) context.fillRect(qrLeft + column * cell, qrTop + row * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
  // Emblem badge: about 20% of the code, well within what high error correction recovers.
  const badge = qrSize * 0.18;
  context.fillStyle = '#FFFFFF';
  roundedRect(context, center - badge / 2 - 10, qrTop + qrSize / 2 - badge / 2 - 10, badge + 20, badge + 20, 18);
  context.fill();
  context.save();
  roundedRect(context, center - badge / 2, qrTop + qrSize / 2 - badge / 2, badge, badge, 14);
  context.clip();
  context.drawImage(emblem, center - badge / 2, qrTop + qrSize / 2 - badge / 2, badge, badge);
  context.restore();

  // Link and sign-off.
  y = tileTop + tile + 100;
  context.font = `600 40px ${sans}`;
  context.fillStyle = goldDark;
  spacedText(context, url.replace(/^https?:\/\//, ''), center, y, 3);
  y += 120;
  context.font = `400 26px ${sans}`;
  context.fillStyle = warmGrey;
  const signOffWidth = spacedText(context, 'KOTAGIRI · THE NILGIRIS', center, y, 8);
  // Short gold rules either side of the sign-off.
  const gap = signOffWidth / 2 + 36;
  context.strokeStyle = gold;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center - gap - 110, y - 10);
  context.lineTo(center - gap, y - 10);
  context.moveTo(center + gap, y - 10);
  context.lineTo(center + gap + 110, y - 10);
  context.stroke();

  return canvas;
}
