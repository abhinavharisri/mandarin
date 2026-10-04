import express from 'express';
import multer from 'multer';
import { router } from './routes.js';

const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  if (request.path.startsWith('/api/admin')) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', router);
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    response.status(413).json({ error: 'The uploaded file is too large. The maximum size is 4 MB.' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

export default app;
