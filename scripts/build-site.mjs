// Copies only the public website into dist/ so Vercel never serves source code,
// server files, or configuration. The admin dashboard is built into dist/admin.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const publicDirectories = ['css', 'js', 'images'];

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

const pages = (await fs.readdir(root)).filter(name => name.endsWith('.html'));
await Promise.all(pages.map(name => fs.copyFile(path.join(root, name), path.join(out, name))));
await Promise.all(publicDirectories.map(name => fs.cp(path.join(root, name), path.join(out, name), {
  recursive: true,
  filter: source => path.basename(source) !== '.DS_Store',
})));
for (const optional of ['robots.txt', 'sitemap.xml', 'favicon.ico']) {
  await fs.copyFile(path.join(root, optional), path.join(out, optional)).catch(() => {});
}

console.log(`Copied ${pages.length} pages and ${publicDirectories.join(', ')} into dist/`);
