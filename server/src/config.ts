import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: '.env.local' });
loadDotenv();

const schema = z.object({
  ADMIN_PASSWORD: z.string().min(12).default('mandarin-local-password'),
  ADMIN_SESSION_SECRET: z.string().min(32).default('local-only-session-secret-change-before-deploy-00000000'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid admin configuration: ${z.treeifyError(parsed.error).errors.join('; ')}`);
}

const production = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
if (production && (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET)) {
  throw new Error('Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET in production environment variables.');
}
if (production && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  throw new Error('Connect a Vercel Blob store before deploying the admin API.');
}

export const config = parsed.data;
export const isProduction = production;
