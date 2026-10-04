# Mandarin Orchid Resort admin

The public website stays static. The React dashboard (`admin/`) and a small API run on **Cloudflare Pages**: the API is a Pages Function (`functions/api/[[path]].ts`, code in `server/src/`) and files are stored in a private **R2** bucket. There is no database or separate server.

## Local preview — no setup required

Run `npm install`, then `npm run dev`, and open:

- Website: `http://localhost:5173/`
- Dashboard: `http://localhost:5173/admin/` (local password `mandarin-local-password`)

`npm run dev` runs Cloudflare's local Pages runtime (port 8788, with a simulated R2 bucket saved under the ignored `data/wrangler/` folder) and the Vite dashboard dev server. The local password only works on `localhost`; to use your own locally, copy `.dev.vars.example` to `.dev.vars`.

## Publish on Cloudflare Pages (one-time setup)

1. **R2 → Create bucket**, e.g. `mandarin-orchid-admin`. Keep it private.
2. **Workers & Pages → your Pages project → Settings → Build**:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Settings → Bindings → Add → R2 bucket**: variable name `BUCKET`, choose the bucket from step 1 (for Production, and Preview if you use previews).
4. **Settings → Variables and Secrets** (type *Secret*):
   - `ADMIN_PASSWORD`: at least 12 characters.
   - `ADMIN_SESSION_SECRET`: at least 32 random characters (`openssl rand -hex 32`).
5. Push to GitHub (or **Deployments → Retry deployment**). Node 22 is selected by `.node-version`.

Until steps 2–4 are done, `/admin` shows a message explaining what is missing; the public website is unaffected.

## Security

- The password is checked only by the API. Sign-in sets a signed, HttpOnly, `SameSite=Strict`, `Secure` cookie that lasts eight hours; the dashboard also locks after 30 minutes of inactivity.
- Repeated wrong passwords are throttled (5 attempts per 15 minutes per Worker instance). Cross-site write requests are rejected.
- Only `dist/` is published, so source code and configuration are never served. `_headers` adds a strict Content Security Policy and no-index headers to `/admin`.

## Reaching the dashboard

There is no visible admin link on the public site. Go to `/admin` directly, type `orchid` anywhere on the website (outside a form field), or press and hold the header logo for about a second.

## Menu, tabs and billing

- **Menu** holds the food & beverages menu (seeded from the printed card): categories, veg / non-veg / egg markers, prices, sizes such as Plate / 1 kg, and an on/off switch to hide items when taking orders. An empty price means "as per availability" and is entered when ordering. Saved to `menu/menu.json` in R2.
- **Tabs**: open one per villa or room at check-in, then add orders from the menu during the stay (phone-friendly). Each order is filed under the day and meal (defaults from the current time in India and can be changed). Menu prices are enforced by the server; custom items cover rent and anything not on the menu. Simultaneous additions from different phones are merged safely.
- **Check out & bill** turns a tab into a pre-filled invoice on the Billing page (repeat orders merged, grouped by day and meal). Generating the invoice closes the tab; it then appears under "Recently billed".
- The Billing page also has **Add from menu** for invoices made without a tab.

## Gallery and invoices

- The existing gallery photos are included in the dashboard. Removing one hides it from the public gallery without deleting the original website image.
- New photos are resized (max 2400px) and converted to WebP in the browser before upload, which also strips location metadata. Originals up to 25 MB are accepted. They are served from `/api/files/gallery/…`. The static gallery remains as a fallback if the API is unavailable.
- Invoice PDFs, attached bills and invoice records are private R2 objects, downloadable only when signed in. Invoice numbers are random `MO-YYYY-XXXXXXXXXXXX` values, so no counter or database is needed.
- PDFs use the standard PDF fonts, so amounts show as "Rs." and characters outside Western alphabets (for example Tamil script) appear as "?". Enter guest names in English letters for invoices.
- Removing an invoice permanently deletes its PDF, attached bill and record, and requires the admin password again.
- **Import from staff notes:** on the Billing page, drop the PDF exported from the notes app. It is read in the browser (nothing is sent anywhere until you generate), and the villa, check-in/out dates, day and meal sections, items, quantities and amounts are filled in for review. Amounts in the notes are treated as line totals; the import is checked against any `Total` written in the notes. Lines it cannot read are listed so they can be added by hand. Photos or scans of notes have no text and must be entered manually. The parser is in `admin/src/notes/parseNotes.ts` with tests built from a real notes export.
- The imported notes PDF is stored privately with the invoice as its source record. Tax defaults to 0%; confirm your accounting requirements before issuing invoices as official tax documents. Invoices are downloadable and not emailed.
