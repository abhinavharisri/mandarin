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

- The password is checked only by the API. Sign-in sets a signed, HttpOnly, `SameSite=Strict`, `Secure` cookie. Sessions end after **30 minutes without activity**: each signed-in request (and active use of the page) extends them, and everyone must sign in again **12 hours** after signing in regardless of activity.
- Repeated wrong passwords are throttled (5 attempts per 15 minutes per Worker instance). Cross-site write requests are rejected.
- Only `dist/` is published, so source code and configuration are never served. `_headers` adds a strict Content Security Policy and no-index headers to `/admin`.

## Reaching the dashboard

There is no visible admin link on the public site. Go to `/admin` directly, type `orchid` anywhere on the website (outside a form field), or press and hold the header logo for about a second.

## Menu, tabs and billing

- **Menu** holds the food & beverages menu (seeded from the printed card): categories, veg / non-veg / egg markers, prices, sizes such as Plate / 1 kg, and an on/off switch to hide items when taking orders. An empty price means "as per availability" and is entered when ordering. Saved to `menu/menu.json` in R2.
- **Tabs**: open one per villa or room at check-in, then add orders from the menu during the stay (phone-friendly). Each order is filed under the day and meal (defaults from the current time in India and can be changed). Menu prices are enforced by the server; custom items cover rent and anything not on the menu. Simultaneous additions from different phones are merged safely.
- **Check out & bill** turns a tab into a pre-filled invoice on the Billing page (repeat orders merged, grouped by day and meal). Generating the invoice closes the tab; it then appears under "Recently billed".
- The Billing page also has **Add from menu** for invoices made without a tab.

## Reports & exports

- **Reports** covers any period (this month, last month, last 3 months, this year, or custom dates, using India dates): revenue, invoice count, average bill, tax collected, a daily or monthly trend, revenue split into Food & beverages / Room & stay / Activities & extras / Tax, revenue by villa, best-selling dishes and the invoice register.
- Lines are classified by their menu category when they came from the menu; otherwise by wording ("rent", "villa night" → Room & stay; "campfire", "transfer" → Activities & extras; everything else → Food & beverages).
- Exports: a branded **PDF report** for accounting, an **invoices CSV** and a **line items CSV** (opens in Excel or Google Sheets).
- Invoices now store their items, villa, subtotal and tax for reporting. Invoices created before this are counted in totals as "Not itemised".

## Guest enquiries

- The **contact form** and the homepage **booking bar** (stay, dates, guests) save each request to the dashboard's **Enquiries** page, then open WhatsApp pre-filled so the guest can continue the conversation. WhatsApp opens immediately; the enquiry is sent in the background, so pop-up blockers never interfere.
- Each enquiry shows the dates and nights, room, guests and message, with one-tap **Call**, **WhatsApp** and **Email**. Mark it New, Contacted, Booked or Closed, and keep a private note. New enquiries show as a badge in the sidebar (and on the Enquiries tab on phones).
- Spam protection matches reviews (hidden field, minimum fill time, same-site only, per-visitor and unread limits). IP addresses are not stored.

## Website build

- `npm run build` adds fingerprints to stylesheet/script links, link-preview tags (WhatsApp, Facebook, X) to every page from its title and description, a `sitemap.xml`, and copies `robots.txt` (search engines skip `/admin` and `/api`).
- Only images that are used are published: all of `images/optimized/` plus any original referenced by a page, style, script, the API or the dashboard. Unused originals stay in the repository. Quality is unchanged; files are copied as-is.
- `images/og-cover.jpg` is the 1200×630 image shown when the site is shared.

## Guest reviews

- **Public page:** `mandarinorchid.in/reviews` (also `/review` and `/feedback`) shows the average rating, a star breakdown and all published reviews, with a form for guests to write their own. Linked from every page's footer and mobile menu, and from the homepage "Guest Voices" carousel.
- **Moderation:** new reviews wait in the dashboard's **Reviews** page (with a count badge in the sidebar) until approved. Reviews can be published, hidden, featured (pinned to the top of the page and the carousel) or deleted.
- **Sharing:** the Reviews page has the link with **Copy link**, **Share on WhatsApp** (pre-written message) and **Download review card**: a print-ready A5 card (1748×2480 px, 300 dpi) in the resort's style with the QR code, logo and hills photo, previewed live. **Plain QR only** is still available.
- **Invoices:** every new or edited invoice PDF carries a "Loved your stay?" card with the review QR code beside the totals.
- **Homepage carousel:** shows published reviews first, then Google reviews rated 4★ and above, falling back to the reviews written into the page. Review text is always inserted as plain text.
- **Spam protection:** a hidden field bots fill in, a minimum time to fill the form, same-site requests only, 3 reviews per visitor per hour and at most 300 waiting reviews. Visitors' IP addresses are not stored. Only the name, rating, review and optional stay details are kept.

## Gallery and invoices

- The existing gallery photos are included in the dashboard. Removing one hides it from the public gallery without deleting the original website image.
- New photos are resized (max 2400px) and converted to WebP in the browser before upload, which also strips location metadata. Originals up to 25 MB are accepted. They are served from `/api/files/gallery/…`. The static gallery remains as a fallback if the API is unavailable.
- Invoice PDFs, attached bills and invoice records are private R2 objects, downloadable only when signed in. Invoice numbers are random `MO-YYYY-XXXXXXXXXXXX` values, so no counter or database is needed.
- PDFs use the standard PDF fonts, so amounts show as "Rs." and characters outside Western alphabets (for example Tamil script) appear as "?". Enter guest names in English letters for invoices.
- **Editing:** the pencil next to an invoice reopens it in the form. Saving keeps the same invoice number and issue date, regenerates the PDF marked "Revised", and shows a "Revised" tag in the list.
- **Advance payments** can be entered on a bill (or on a tab at check-in, which carries over). The PDF then shows Advance paid and **Balance payable**.
- **Half portions:** quantities can be whole or half (½, 1½…); the ½ button beside a quantity adds or removes a half portion.
- **Unfinished bills are kept** in the browser tab while you move around the dashboard or reload; they are cleared when the bill is generated, the form is cleared, or you sign out.
- Dates on bills are written as "2 Oct 2026". Stays over 30 nights ask for confirmation, since they are usually a day/month mix-up; notes imports pick the date order that keeps the stay closest to today.
- **Deleting an invoice** (admin password required) moves it to **Recently deleted** at the bottom of Billing; the toast also offers **Undo**. It leaves the history and reports but keeps its PDF, and can be restored with its original number for 30 days. After 30 days it is removed for good (cleared when the bin is opened or another invoice is deleted). **Delete forever** and **Empty bin** need the password again. Wrong passwords count toward the sign-in throttle.
- **Bill again** on a recently billed tab rebuilds a new bill from that tab's orders, e.g. if its invoice was lost.
- **Import from staff notes:** on the Billing page, drop the PDF exported from the notes app. It is read in the browser (nothing is sent anywhere until you generate), and the villa, check-in/out dates, day and meal sections, items, quantities and amounts are filled in for review. Amounts in the notes are treated as line totals; the import is checked against any `Total` written in the notes. Lines it cannot read are listed so they can be added by hand. Photos or scans of notes have no text and must be entered manually. The parser is in `admin/src/notes/parseNotes.ts` with tests built from a real notes export.
- The imported notes PDF is stored privately with the invoice as its source record. Tax defaults to 0%; confirm your accounting requirements before issuing invoices as official tax documents. Invoices are downloadable and not emailed.
