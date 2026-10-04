# Mandarin Orchid Resort admin

The public website remains static. The React dashboard and a small serverless API run in the same Vercel project. Vercel Blob stores gallery images and metadata as public files, and invoice PDFs, source bills, and invoice records as private files. There is no database or separate API host.

## Local preview — no setup required

Run `npm run dev` in the repository folder and open `http://localhost:5173/admin/`. The public website is served at `http://localhost:5173/` alongside it, so links between the dashboard and the site work locally. Local files are saved under the ignored `data/` folder. The local-only sign-in password is `mandarin-local-password`. This local default is deliberately rejected in production.

## Publish on Vercel

1. Create and connect a Vercel Blob store to the project.
2. Set a unique `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (generate one with `openssl rand -hex 32`) in the Vercel project settings.
3. Redeploy. The Vercel API uses Blob for persistent files; no database is required.

`npm run build` copies only the public pages, `css/`, `js/` and `images/` into `dist/` and builds the dashboard into `dist/admin`, so source code and configuration are never served. Vercel deploys `dist/` plus the `api/` function.

The admin password is checked only by the server API. Repeated wrong passwords are throttled (5 attempts per 15 minutes, per server instance), state-changing requests from other sites are rejected, and the dashboard locks after 30 minutes of inactivity. Successful sign-in uses a signed, HttpOnly, same-site cookie with an eight-hour lifetime. Neither the password nor the Blob token is included in the dashboard bundle.
## Reaching the dashboard

There is no visible admin link on the public site. Go to `/admin` directly, type `orchid` anywhere on the website (outside a form field), or press and hold the header logo for about a second; a "Staff entrance" screen then opens the sign-in page. A normal click on the logo still goes to the home page.

## Gallery and invoices

- The existing gallery photos are included in the dashboard. Removing one hides it from the public gallery without deleting the original website image. New photos are optimized to WebP and saved as public Blob files with their small JSON metadata files. The static gallery remains as a fallback if the API is unavailable.
- Uploaded bill PDFs, generated invoices, and invoice metadata are saved as private Blob files. Earlier invoices can be downloaded again in the dashboard.
- Removing an invoice permanently deletes its PDF, attached bill and record, and requires the admin password to be entered again. The server checks it and wrong attempts count toward the sign-in throttle.
- Invoice references are unique, randomly generated `MO-YYYY-XXXXXXXXXXXX` values rather than sequential numbers, so invoice creation needs no database or shared counter.
- Attached bills are stored but not OCR-parsed. Tax defaults to 0%; confirm your accounting requirements before issuing invoices as official tax documents. Invoices are downloadable and not emailed.
- Uploads are capped at 4 MB to fit Vercel Functions' request-size limit; larger bills should be compressed before attaching.

The admin and public photo gallery are hosted on Vercel; your domain can remain registered with GoDaddy and point to Vercel as it does today.
