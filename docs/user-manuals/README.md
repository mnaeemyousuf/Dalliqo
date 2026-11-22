# Stateown user manuals

Role-specific PDF manuals for **Stateown** (*Every Property. Every Lead. One Platform.*) customer staff. Each one is written for one access level and uses
screenshots taken from the running application **signed in as the demo user for that access
level**, with synthetic Karachi demo data (no real people or properties).

| File | Intended audience | Access level documented | Pages | Figures |
|---|---|---|---|---|
| [Business_Owner_User_Manual.pdf](Business_Owner_User_Manual.pdf) | Business owner / organisation administrator | Owner — full access | 99 | 78 |
| [Office_Manager_User_Manual.pdf](Office_Manager_User_Manual.pdf) | Office manager / team lead | Member — Manager template | 84 | 61 |
| [Real_Estate_Agent_User_Manual.pdf](Real_Estate_Agent_User_Manual.pdf) | Field agents and salespeople (includes a note on the narrower Salesperson template) | Member — Agent template | 65 | 46 |
| [CRM_Operator_User_Manual.pdf](CRM_Operator_User_Manual.pdf) | Office staff / CRM operators, and the family member who helps run the business | Member — Standard member template | 79 | 57 |
| [Accountant_User_Manual.pdf](Accountant_User_Manual.pdf) | Accounts / reporting staff (commission, income & expense) | Member — Accountant template | 61 | 41 |
| [Read_Only_User_Manual.pdf](Read_Only_User_Manual.pdf) | Receptionists, trainees, anyone who only looks things up | Member — Read-only viewer template | 52 | 35 |

Every manual contains: cover page; document control; table of contents with page numbers;
introduction (what the system does, the reader's role, what they can and cannot do and why);
sign-in and first-time setup; dashboard and My Day; feature-by-feature instructions (purpose,
where to find it, prerequisites, steps, required/optional fields, what to enter, what happens after
saving, how to verify, common mistakes, troubleshooting, permissions); end-to-end workflows;
notifications and communication; documents and exports; the mobile app; English/Urdu and
appearance; troubleshooting; best practices; FAQ; support and escalation (placeholders); revision
history. Sections for actions a role cannot perform are left out of that role's manual.

## Roles without their own manual (and where they are covered)

| Role | Covered by | Notes |
|---|---|---|
| Branch Manager | Office Manager manual | A member with the Manager template whose branch access is limited to their branch(es). Everything applies, limited to those branches. |
| Sales Manager | Office Manager manual | Same screens: team dashboard, approvals, agent performance. |
| Property Manager (rentals) | Office Manager / CRM Operator manuals | The "Rental management" chapter covers leases, rent, inspections and notices for roles with rentals access. |
| Finance Manager | Accountant manual | Commission, income and expense, installments and the finance reports. |
| Marketing Manager, Verification Officer | Office Manager manual | The "Marketing" and "Verification" chapters. |
| Salesperson | Real Estate Agent manual | Documented as a note (same screens, fewer permissions). |
| Platform administrator (Stateown staff) | — | An internal screen for managing subscriptions; not a customer role. |

See `docs/ROLE_PERMISSION_MATRIX.md` for exactly what each access level may do.

## Known limitations of these manuals

* **No phone screenshots.** The Android app has not been installed on a phone or emulator on the
  build machine, so the mobile chapter is text-only and says so. Rendered images of the app's
  sign-in and splash screens are in `docs/branding/mobile-renders/`.
* **Support contacts are placeholders** (`[to be provided]`) — fill them in before distributing.
* Screenshots show a demo business; your customer's business names and numbers will differ.
* Language: the manuals are in English. They explain the Urdu / right-to-left switch and include
  real Urdu screenshots in the owner manual; a translated Urdu edition has not been produced.
* The assistant screenshot shows the screen without an AI key configured on the demo server.

## Branding

All manuals use the Stateown identity (see `docs/branding/STATEOWN_BRAND_GUIDELINES.md`): a midnight-gradient
cover with the Stateown logo, tagline and amber accent; a running header with the Stateown mark and name; a
footer with the tagline, version, revision and "Page X of Y"; Midnight `#0B1B4A` headings, primary
`#1D4ED8` rules, table headers and note boxes; and Plus Jakarta Sans embedded from
`mobile/assets/fonts/`. The branding lives in `tools/manuals/build.mjs` (`PRODUCT` / `TAGLINE` in
`content.mjs`), so every future manual built with this tooling inherits it automatically.
**Version 2.1, Rev. E** (22 Nov 2026) adds the agency’s own web address, business currency and time zone, the duplicate-plot warning, price history and listing expiry, recalculating matches, matching weights on the phone, who can see notes and documents, upload limits and clearer field messages, with every screenshot retaken. **Version 2.0, Rev. D** (Stateown rebrand and new features) retook every screenshot from the
rebranded application and added the chapters for lead management, verification and listing tools,
the deal pipeline and negotiation, rental management, installments and finance reports, marketing,
the assistant, management reports and the newer business settings. The new chapters live in
`tools/manuals/content-newer.mjs`; each section is included only for roles whose permission template
allows it.

## How the PDFs are produced (repeatable)

Tooling lives in `tools/manuals/` (its own `package.json`; uses an installed Edge/Chrome — no browser
download — plus `playwright-core`, `pdfjs-dist` and `pdf-lib`).

```bash
# 1. Start the demo (in-memory database, seeded with six role accounts)
npm run demo --api-port=4300
npm run dev:web --api-port=4300          # note the printed web address

# 2. Capture screenshots, build PDFs, verify (from tools/manuals)
cd tools/manuals && npm install
WEB_URL=http://localhost:5173 node capture.mjs      # → docs/user-manuals/screenshots/<role>/*.jpg + manifest.<role>.json
node build.mjs                                      # → docs/user-manuals/*.pdf (out/build-report.json)
node verify.mjs --render out/pages                  # → checks + page images (out/verify-report.json)
```

* `capture.mjs` signs in as each demo user and records each screenshot in a manifest; a screen that
  can't be captured is logged as failed — never replaced with a mock-up. `STEPS=a,b` retakes only
  some screenshots.
* `build.mjs` renders HTML to PDF in Chromium (header, footer "Page X of Y"), reads the PDF back with
  pdf.js to find the page of every heading, fills the table of contents, re-renders, checks the
  numbers didn't move, merges the cover with pdf-lib and warns if two figures use the same image.
* `verify.mjs` re-opens every PDF and checks: cover title, intended role, contents present, every
  contents entry points to a page containing that heading, sequential figure numbers, footer on
  every page, Stateown tagline on the cover, Stateown name + tagline in the header/footer of every page,
  no leftover old product name, branded PDF title metadata, no near-blank pages, no "undefined"/"TODO"/template placeholders; optionally renders
  every page to PNG for visual review.

Last verification (Rev. B, Stateown rebrand, 25 October 2026): all 6 manuals passed (287 pages, 211 figures,
357 contents references checked, brand checks on every page); pages were rendered to PNG and spot-reviewed visually.
