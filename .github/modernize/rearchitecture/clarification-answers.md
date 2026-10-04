---
schema: clarification-answers/v1
status: submitted
generated_at: "2026-10-04T08:21:38.377Z"
scope: [frontend, backend, generic]
questions_file: clarification-questions.json
---

# Rearchitecture Clarification Answers

## 🖥️ Frontend

- **F1** How should the admin dashboard be built while keeping the public website intact?
  - answer: Use React for the admin only; leave public pages unchanged
  - source: user
- **F2** Which component or styling approach should the dashboard and generated invoice use?
  - answer: Reuse the existing CSS and resort design tokens (Recommended)
  - source: user
- **F3** Do you have a screenshot, sketch, or reference for the admin dashboard? You can provide a file path or URL, or say to use the existing resort site as the visual reference.
  - answer: https://cdn.dribbble.com/userupload/37126821/file/original-bf43d918c9642bbfd33a7d499645cc5a.png?resize=1504x1128&vertical=center


https://i.pinimg.com/736x/3a/76/e4/3a76e4de8c593ea3bbd3d935d2f5fb7d.jpg

something like these, but use our websites theme
  - source: user
- **F4** Should the admin and generated invoice follow the existing resort design tokens and branding? The current CSS source is css/style.css.
  - answer: Match the existing resort theme and extracted CSS tokens in css/style.css (Recommended)
  - source: user
- **F5** What accessibility standard should the admin dashboard target?
  - answer: WCAG 2.1 AA
  - source: user
- **F6** Which browsers and devices must the admin dashboard support?
  - answer: modern evergreen (Chrome, Firefox, Safari, Edge — latest 2 major versions)
  - source: user
- **F7** How should the admin dashboard adapt to phones and desktop?
  - answer: Mobile-first and responsive, using existing breakpoints (Recommended)
  - source: user
- **F8** Which languages should the admin dashboard and generated invoices support?
  - answer: preserve current locales; keep existing i18n library if present
  - source: user
- **F9** Do you have a preference for how the dashboard manages form and session state?
  - answer: preserve existing pattern if identifiable; otherwise recommend minimal (component state + server-state library)
  - source: user
- **F10** How should people reach the admin login/dashboard?
  - answer: use the de-facto router for the chosen target framework
  - source: user

## ⚙️ Backend

- **B1** Which backend platform should provide secure login, gallery updates, file storage, and invoice generation? The current site is static and has no backend.
  - answer: A separately hosted Node.js/TypeScript backend
  - source: user
- **B2** Should the existing public pages and their behavior remain unchanged as the admin API is added?
  - answer: Must preserve existing public pages and behavior (Recommended)
  - source: user
- **B3** There is no detected existing database. Should the admin use a new managed data/file store, or do you need to migrate existing gallery or billing records?
  - answer: No migration; create new managed storage for admin data and uploads (Recommended)
  - source: user
- **B4** How should the administrator account be authenticated? A shared password hard-coded into a static page or stored in browser code is not secure.
  - answer: Managed authentication with one private admin account
  - source: user
- **B5** What availability or response-time expectations should apply to admin login, uploads, and invoice generation?
  - answer: match current production baseline; no regression
  - source: user

## 📋 General

- **G1** What must work for you to consider this complete?
  - answer: Secure admin login; admin can add/remove gallery images; uploaded bill files produce downloadable invoices using the resort theme; resort logo appears as the browser tab icon; public website remains usable.
  - source: user
- **G2** Are there related features or pages that must not be changed?
  - answer: Keep existing public website content and visitor behavior unchanged except for the admin entry point, gallery updates, and the favicon. No online card/payment processing was explicitly requested.
  - source: user
- **G3** How should existing tests be treated? No automated test suite was detected in the repository scan.
  - answer: must pass
  - source: user
- **G5** Please specify what the uploaded bill PDF should do (for example, extract its details or just attach it), the information required on the generated invoice (guest, stay dates, line items, taxes, currency, invoice numbering), whether invoices should be emailed or only downloaded, and any file-retention or administrator-account requirements. Add any other constraints here too.
  - answer: None beyond the decisions listed in this specification.
  - source: user
