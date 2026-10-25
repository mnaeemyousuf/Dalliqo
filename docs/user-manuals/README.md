# Dalliqo user manuals

Role-specific PDF manuals for **Dalliqo** (*Every Property. Every Lead. One Platform.*) customer staff. Each one is written for one access level and uses
screenshots taken from the running application **signed in as the demo user for that access
level**, with synthetic Karachi demo data (no real people or properties).

| File | Intended audience | Access level documented | Pages | Figures |
|---|---|---|---|---|
| [Business_Owner_User_Manual.pdf](Business_Owner_User_Manual.pdf) | Business owner / organisation administrator | Owner — full access | 62 | 51 |
| [Office_Manager_User_Manual.pdf](Office_Manager_User_Manual.pdf) | Office manager / team lead | Member — Manager template | 53 | 40 |
| [Real_Estate_Agent_User_Manual.pdf](Real_Estate_Agent_User_Manual.pdf) | Field agents and salespeople (includes a note on the narrower Salesperson template) | Member — Agent template | 49 | 36 |
| [CRM_Operator_User_Manual.pdf](CRM_Operator_User_Manual.pdf) | Office staff / CRM operators, and the family member who helps run the business | Member — Standard member template | 52 | 39 |
| [Accountant_User_Manual.pdf](Accountant_User_Manual.pdf) | Accounts / reporting staff | Member — Accountant (reports) template | 37 | 24 |
| [Read_Only_User_Manual.pdf](Read_Only_User_Manual.pdf) | Receptionists, trainees, anyone who only looks things up | Member — Read-only viewer template | 34 | 21 |

Every manual contains: cover page; document control; table of contents with page numbers;
introduction (what the system does, the reader's role, what they can and cannot do and why);
sign-in and first-time setup; dashboard and My Day; feature-by-feature instructions (purpose,
where to find it, prerequisites, steps, required/optional fields, what to enter, what happens after
saving, how to verify, common mistakes, troubleshooting, permissions); end-to-end workflows;
notifications and communication; documents and exports; the mobile app; English/Urdu and
appearance; troubleshooting; best practices; FAQ; support and escalation (placeholders); revision
history. Sections for actions a role cannot perform are left out of that role's manual.

## Roles without a manual (and why)

| Role from the brief | Status | Reason |
|---|---|---|
| Platform Super Admin | Not implemented | There is no cross-tenant admin console; platform operations are done by the operator at the infrastructure level (roadmap E-07). |
| Branch Manager | Not implemented | The product has no branches yet (roadmap E-01). |
| Property Manager | Not implemented | No rentals/tenancy module (roadmap R-11). |
| Salesperson | Covered | Documented as a note in the Real Estate Agent manual (same screens, fewer permissions). |

See `docs/ROLE_PERMISSION_MATRIX.md` for exactly what each access level may do.

## Known limitations of these manuals

* **No mobile screenshots.** The Flutter app was not installed on a phone or emulator during
  preparation (no Android SDK on the build machine), so the mobile chapter is text-only and says so.
* **Support contacts are placeholders** (`[to be provided]`) — fill them in before distributing.
* Screenshots show a demo business; your customer's business names and numbers will differ.
* Language: the manuals are in English. They explain the Urdu/right-to-left switch and include
  real Urdu screenshots in the owner manual; a translated Urdu edition has not been produced.

## Branding

All manuals use the Dalliqo identity (see `docs/branding/DALLIQO_BRAND_GUIDELINES.md`): a midnight-gradient
cover with the Dalliqo logo, tagline and amber accent; a running header with the Dalliqo mark and name; a
footer with the tagline, version, revision and "Page X of Y"; Midnight `#0B1B4A` headings, primary
`#1D4ED8` rules, table headers and note boxes; and Plus Jakarta Sans embedded from
`mobile/assets/fonts/`. The branding lives in `tools/manuals/build.mjs` (`PRODUCT` / `TAGLINE` in
`content.mjs`), so every future manual built with this tooling inherits it automatically.
Revision **Rev. B** (rebrand) recaptured all 196 screenshots from the rebranded application; the
instructions did not change because no feature or workflow changed.

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
  every page, Dalliqo tagline on the cover, Dalliqo name + tagline in the header/footer of every page,
  no leftover old product name, branded PDF title metadata, no near-blank pages, no "undefined"/"TODO"/template placeholders; optionally renders
  every page to PNG for visual review.

Last verification (Rev. B, Dalliqo rebrand, 25 October 2026): all 6 manuals passed (287 pages, 211 figures,
357 contents references checked, brand checks on every page); pages were rendered to PNG and spot-reviewed visually.
