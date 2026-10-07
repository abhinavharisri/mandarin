// Copies only the public website into dist/ so Cloudflare Pages never serves source code,
// server files, or configuration. The admin dashboard is built into dist/admin.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const siteUrl = 'https://mandarinorchid.in';
const shareImage = { url: `${siteUrl}/images/og-cover.jpg`, width: 1200, height: 630, alt: 'Mandarin Orchid Resort villa on the hillside in Kotagiri at dusk' };

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
  const pattern = /(href|src)="(\/?)((?:css|js)\/[^"?#]+\.(?:css|js))"/g;
  const assets = [...new Set([...html.matchAll(pattern)].map(match => match[3]))];
  const versions = new Map(await Promise.all(assets.map(async asset => [asset, await fingerprint(asset)])));
  return html.replace(pattern, (whole, attribute, slash, asset) => versions.get(asset) ? `${attribute}="${slash}${asset}?v=${versions.get(asset)}"` : whole);
}

const escapeAttribute = text => text.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;');
const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pageUrl = name => (name === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${name.replace(/\.html$/, '')}`);

/**
 * Link-preview (WhatsApp, Facebook, X) and search tags, built from each page's own
 * title and description so they never drift apart.
 */
function addShareTags(html, name) {
  if (name === '404.html' || html.includes('property="og:title"')) return html;
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] || 'Mandarin Orchid Resort');
  const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '');
  const url = pageUrl(name);
  const type = name === 'index.html' ? 'website' : /journal/i.test(title) ? 'article' : 'website';
  const tags = [
    `<link rel="canonical" href="${url}" />`,
    `<meta name="theme-color" content="#1A1814" />`,
    html.includes('rel="icon"') ? '' : '<link rel="icon" type="image/png" href="/images/favicon.png" />',
    `<meta property="og:type" content="${type}" />`,
    '<meta property="og:site_name" content="Mandarin Orchid Resort" />',
    '<meta property="og:locale" content="en_IN" />',
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    description ? `<meta property="og:description" content="${escapeAttribute(description)}" />` : '',
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${shareImage.url}" />`,
    `<meta property="og:image:width" content="${shareImage.width}" />`,
    `<meta property="og:image:height" content="${shareImage.height}" />`,
    `<meta property="og:image:alt" content="${escapeAttribute(shareImage.alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
    description ? `<meta name="twitter:description" content="${escapeAttribute(description)}" />` : '',
    `<meta name="twitter:image" content="${shareImage.url}" />`,
  ].filter(Boolean).map(tag => `  ${tag}`).join('\n');
  return html.replace('</head>', `${tags}\n</head>`);
}

const pages = (await fs.readdir(root)).filter(name => name.endsWith('.html')).sort();
await Promise.all(pages.map(async name => {
  const html = await fs.readFile(path.join(root, name), 'utf8');
  await fs.writeFile(path.join(out, name), addShareTags(await versionAssets(html), name));
}));

// Sitemap for search engines (clean URLs, as Cloudflare Pages serves them).
const today = new Date().toISOString().slice(0, 10);
const sitemapEntries = await Promise.all(pages.filter(name => name !== '404.html').map(async name => {
  const stats = await fs.stat(path.join(root, name));
  const priority = name === 'index.html' ? '1.0' : /^(rooms|amenities|gallery|reviews|contactus|aboutus|attractions)\.html$/.test(name) ? '0.8' : '0.5';
  return `  <url><loc>${pageUrl(name)}</loc><lastmod>${(stats.mtime.toISOString().slice(0, 10) > today ? today : stats.mtime.toISOString().slice(0, 10))}</lastmod><priority>${priority}</priority></url>`;
}));
await fs.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join('\n')}\n</urlset>\n`);

/**
 * Images: every optimised image ships unchanged, plus any original that something
 * actually references (pages, styles, scripts, the API's gallery and the dashboard).
 * Large unused originals stay in the repository but are not published.
 */
async function textFiles(directory, extensions) {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(entry => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(relative, extensions);
    return extensions.some(extension => entry.name.endsWith(extension)) ? [relative] : [];
  }));
  return files.flat();
}
const referenceSources = [
  ...pages,
  ...(await textFiles('css', ['.css'])),
  ...(await textFiles('js', ['.js'])),
  ...(await textFiles('server/src', ['.ts'])),
  ...(await textFiles('admin/src', ['.ts', '.tsx', '.css'])),
];
const referencedImages = new Set();
for (const file of referenceSources) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/images\/([A-Za-z0-9_\-./]+\.(?:webp|jpe?g|png|avif|gif|svg|ico))/gi)) referencedImages.add(match[1]);
}
referencedImages.add('og-cover.jpg');
referencedImages.add('favicon.png');
referencedImages.add('logo.png');

let skippedBytes = 0;
let skippedFiles = 0;
await fs.cp(path.join(root, 'images'), path.join(out, 'images'), {
  recursive: true,
  filter: async source => {
    const relative = path.relative(path.join(root, 'images'), source).split(path.sep).join('/');
    if (!relative) return true;
    if (path.basename(source) === '.DS_Store') return false;
    const stats = await fs.stat(source);
    if (stats.isDirectory() || relative.startsWith('optimized/') || referencedImages.has(relative)) return true;
    skippedBytes += stats.size;
    skippedFiles += 1;
    return false;
  },
});

for (const directory of ['css', 'js']) {
  await fs.cp(path.join(root, directory), path.join(out, directory), { recursive: true, filter: source => path.basename(source) !== '.DS_Store' });
}
// _headers holds Cloudflare Pages security headers for the admin dashboard.
for (const optional of ['_headers', '_redirects', 'robots.txt', 'favicon.ico']) {
  await fs.copyFile(path.join(root, optional), path.join(out, optional)).catch(() => {});
}

console.log(`Copied ${pages.length} pages, css, js and images into dist/ (${fingerprints.size} versioned assets; `
  + `${skippedFiles} unused original images, ${(skippedBytes / 1024 / 1024).toFixed(0)} MB, left out)`);
