---
schema: clarification/v1
generated_at: "2026-10-04T08:22:00Z"
scope:
  - frontend
  - backend
  - generic
clarity_score: 1.00
rounds: 1
gaps:
  - target.routing
  - i18n.locales
  - state_mgmt.preference
  - constraints.additional
blocking_gaps: []
---

# Scenario Clarification

## Frontend

- **Target framework**: React for the admin only; leave public pages unchanged
- **Component library**: Reuse the existing CSS and resort design tokens
- **Screenshots**: User provided dashboard references at Dribbble and Pinterest; adapt them to the resort theme
- **Design system**: Match the existing resort theme and CSS tokens in `css/style.css`
- **Accessibility**: WCAG 2.1 AA
- **Browser targets**: Modern evergreen browsers (latest two major versions)
- **Responsive strategy**: Mobile-first using existing breakpoints
- **i18n locales**: Preserve current locales (default)
- **State management**: Minimal built-in state and server-backed data (default)
- **Routing**: Use the framework-default router (default)

## Backend

- **Target framework**: Vercel serverless API in the existing Vercel project
- **API contract preservation**: Must preserve existing public pages and behavior
- **Data migration strategy**: No database; store gallery and invoice data as files in Vercel Blob
- **Auth framework**: One admin password stored as a server environment variable with signed secure sessions
- **SLA targets**: Match the current production baseline; no regression

## Generic

- **Success definition**: Secure admin login; admin can add/remove gallery images; uploaded bill files produce downloadable invoices using the resort theme; resort logo appears as the browser tab icon; public website remains usable.
- **Out of scope**: Keep public content and visitor behavior unchanged except for the admin entry point, gallery updates, and favicon. No online card/payment processing.
- **Existing test posture**: Existing checks must pass; add focused tests for the new dashboard.
- **Output location**: In place, keeping the current public website intact.
- **Additional constraints**: None specified beyond the decisions listed here.

## Gaps & Defaults Applied

- id: target.routing
  resolution: default
  default_used: "use the de-facto router for the chosen target framework"
- id: i18n.locales
  resolution: default
  default_used: "preserve current locales; keep existing i18n library if present"
- id: state_mgmt.preference
  resolution: default
  default_used: "preserve existing pattern if identifiable; otherwise recommend minimal (component state + server-state library)"
- id: constraints.additional
  resolution: default
  default_used: "None beyond the decisions listed in this specification."

## Downstream Usage Notes

- Use React for the admin only; preserve the public static pages and current visual identity.
- Implement a small Vercel serverless API with password-protected admin access and managed file storage; do not add a database.
- Keep invoice PDFs and uploaded source bills private, and gallery image assets public. Use unique non-sequential invoice references because a database-backed counter is out of scope.
- Invoice field schema and tax rules remain assumptions; confirm accounting requirements before production use.
- Invoice generation should produce a downloadable, resort-branded invoice from the uploaded bill PDF. Do not add payment processing or assume the uploaded PDF can be reliably parsed until the invoice workflow is designed.
