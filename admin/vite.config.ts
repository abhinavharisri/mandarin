import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const projectRoot = path.resolve(import.meta.dirname, '..');

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
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
  plugins: [
    react(),
    {
      // Serves the public resort website next to the dashboard during development,
      // mirroring the Vercel deployment so links between them work locally.
      name: 'serve-resort-website-in-development',
      configureServer(server) {
        for (const directory of ['images', 'css', 'js']) {
          server.middlewares.use(`/${directory}`, express.static(path.join(projectRoot, directory)));
        }
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
          const page = publicPage(url);
          if (!page) {
            next();
            return;
          }
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          fs.createReadStream(page).pipe(response);
        });
      },
    },
  ],
});
