import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

/** Resolves a site asset under css/, js/ or images/ without allowing path traversal. */
function publicAsset(urlPath: string) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (!/^(css|js|images)\//.test(relative)) return null;
  const candidate = path.resolve(projectRoot, relative);
  if (!candidate.startsWith(projectRoot + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

/** Resolves a clean URL such as `/rooms` or `/` to the matching public HTML page. */
function publicPage(urlPath: string) {
  const clean = decodeURIComponent(urlPath).replace(/\/+$/, '') || '/index';
  if (clean.includes('..') || clean.split('/').length > 2) return null;
  const candidate = path.join(projectRoot, clean.endsWith('.html') ? clean : `${clean}.html`);
  return fs.existsSync(candidate) ? candidate : null;
}

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, 'public'),
  base: '/admin/',
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/admin'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Keep the browser's Host header so the API's same-origin check matches production.
      '/api': { target: 'http://localhost:8788', changeOrigin: false },
    },
  },
  plugins: [
    react(),
    {
      // Serves the public resort website next to the dashboard during development,
      // mirroring the Cloudflare Pages deployment so links between them work locally.
      name: 'serve-resort-website-in-development',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = (request.url || '/').split('?')[0];
          if (url === '/admin') {
            response.statusCode = 302;
            response.setHeader('Location', '/admin/');
            response.end();
            return;
          }
          if (request.method !== 'GET' || url.startsWith('/admin/') || url.startsWith('/api/') || url.startsWith('/@')) {
            next();
            return;
          }
          const file = publicAsset(url) || publicPage(url);
          if (!file) {
            next();
            return;
          }
          response.setHeader('Content-Type', contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream');
          fs.createReadStream(file).pipe(response);
        });
      },
    },
  ],
});
