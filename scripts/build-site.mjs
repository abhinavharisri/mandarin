// Copies only the public website into dist/ so Cloudflare Pages never serves source code,
// server files, or configuration. The admin dashboard is built into dist/admin.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const publicDirectories = ['css', 'js', 'images'];

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });

/**
 * Adds a content fingerprint to stylesheet and script links (css/style.css?v=3f9a1c2b7d).
 * Browsers may reuse css/ and js/ files for hours; a changed file gets a new URL, so
 * visitors always receive the stylesheet and scripts that match the page.
 */
const fingerprints = new Map();
async function fingerprint(asset) {
  if (!fingerprints.has(asset)) {
    const content = await fs.readFile(path.join(root, asset)).catch(() => null);
    fingerprints.set(asset, content ? createHash('sha256').update(content).digest('hex').slice(0, 10) : null);
  }
  return fingerprints.get(asset);
}

async function versionAssets(html) {
  const pattern = /(href|src)="((?:css|js)\/[^"?#]+\.(?:css|js))"/g;
  const assets = [...new Set([...html.matchAll(pattern)].map(match => match[2]))];
  const versions = new Map(await Promise.all(assets.map(async asset => [asset, await fingerprint(asset)])));
  return html.replace(pattern, (whole, attribute, asset) => versions.get(asset) ? `${attribute}="${asset}?v=${versions.get(asset)}"` : whole);
}

const pages = (await fs.readdir(root)).filter(name => name.endsWith('.html'));
await Promise.all(pages.map(async name => {
  const html = await fs.readFile(path.join(root, name), 'utf8');
  await fs.writeFile(path.join(out, name), await versionAssets(html));
}));
await Promise.all(publicDirectories.map(name => fs.cp(path.join(root, name), path.join(out, name), {
  recursive: true,
  filter: source => path.basename(source) !== '.DS_Store',
})));
// _headers holds Cloudflare Pages security headers for the admin dashboard.
for (const optional of ['_headers', '_redirects', 'robots.txt', 'sitemap.xml', 'favicon.ico']) {
  await fs.copyFile(path.join(root, optional), path.join(out, optional)).catch(() => {});
}

console.log(`Copied ${pages.length} pages and ${publicDirectories.join(', ')} into dist/ (${fingerprints.size} versioned assets)`);
