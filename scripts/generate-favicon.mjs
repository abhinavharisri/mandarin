import fs from 'node:fs/promises';
import sharp from 'sharp';

const logo = await fs.readFile('images/logo.png');
const favicon = await sharp(logo)
  .extract({ left: 182, top: 0, width: 179, height: 150 })
  .resize(96, 96, { fit: 'contain', background: { r: 247, g: 242, b: 234, alpha: 1 } })
  .png()
  .toBuffer();

await fs.writeFile('images/favicon.png', favicon);
await fs.mkdir('admin/public', { recursive: true });
await fs.writeFile('admin/public/favicon.png', favicon);
