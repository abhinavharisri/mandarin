import { handleApi } from '../../server/src/app.js';
import type { Env } from '../../server/src/env.js';

// Cloudflare Pages Function: every /api/* request is handled by the admin API.
export const onRequest: PagesFunction<Env> = context => handleApi(context.request, context.env);
