# Stateown — Test Report

Run date: 14 Nov 2026 (latest: Phase 5B — see per-phase sections for current totals).

| Suite | Command | Result |
|---|---|---|
| API (Jest + in-memory MongoDB replica set) | `npm test -w @recrm/server` | **227 passed**, 1 skipped (22 files) |
| API typecheck | `npx tsc --noEmit -p server` | clean |
| Web (Vitest) | `npm test -w @recrm/web` | **38 passed** (11 files) |
| Web typecheck | `npx tsc --noEmit -p web` | clean |
| Android (flutter test) | `flutter test` | **79 passed** |
| Android static analysis | `flutter analyze` | no issues |

## New Phase 3 tests (`server/tests/phase3.test.ts`, `mobile/test/deals_test.dart`)
- Lead scoring engine: hot/explained, cold/never-perfect, configurable weights (unit).
- Entitlements: trial/period lapse and grace, Starter modules and limits (unit).
- Leads: scoring on create, campaign/timeline, response time and score increase after contact; manual temperature, lost reason, status history; assignment history, assignee notification, unassigned inbox, permission check (403 for viewer); lead report; Excel import with duplicate and invalid rows.
- Properties: Pakistan attributes and kanal conversion, price history, category/corner/park filters; duplicate plot detection (409) and override; floor price hidden in API and offline sync; new lifecycle statuses and inventory aging.
- Deals: offer → negotiation stage, counter-offer, acceptance sets agreed price and stage, checklist actor recorded, unknown offer 404; Android offline offers/checklist coalesced into one outbox mutation.
- Subscriptions: trial on registration and `/auth/me` entitlements; module blocked on Starter (403), user limit (403); expired account read-only (402) but readable; platform-only plan changes.
- Automation: hot-lead alert raised exactly once across two runs (de-duplication); lapsed listing auto-expired; settings validation (bounds, thresholds).

## Phase 4 tests (`server/tests/phase4.test.ts`, run 14 Nov 2026)
- CNIC format/mask helpers.
- Verification: submit → queue + officer notification → agent cannot decide (403) → assign → checklist → remarks required for send-back → resubmit → approve; history, verifiedBy and next date checked; four-eyes rule (403 when approving own submission).
- Sensitive data: CNIC masked for a viewer in detail and sync; identity document hidden from list and 404 on download for a viewer; missing-document detection by category.
- Deal approval: direct close when off; with approvals on an agent's close-won is held (PENDING, approver notified), agent cannot approve (403), owner approval closes the deal.
- Property Excel import with owner creation, duplicate plot and invalid rows; QR PNG; saved views private/shared and deletion only by the owner; new permission templates.
- Regression fixes: permission-template list expectation; an agreement test that depended on the time of day now asserts a range.
- Full results: server 236 passed, web 38 passed, Flutter 79 passed; production web build succeeds (map is a separate lazy chunk).

## Phase 5A tests (`server/tests/rentals.test.ts`)
- Schedule: monthly items, yearly escalation, first due date not before the start.
- Allocation oldest-first with credit; fixed and percentage late fees; lease summary (overdue, next due).
- Lifecycle: create (schedule, property RENTED, double lease refused), back-dated months carry no late fee, payment allocation and agency-fee income, rent roll; waive, inspection, renewal with new rent, termination with deposit refund and property relisted; scheduled refresh marks months overdue; viewer can read but not record rent (403).
- Full results: server 242 passed, web 38, Flutter 79. Visual check of the Rentals list and lease detail with seeded demo leases.

## Phase 5B tests (`server/tests/finance5b.test.ts`, `mobile/test/commission_external_test.dart`)
- **Shared maths:** a quarterly schedule with booking, down payment and possession adds up to the total; the commission split with a 25% outside dealer, and lifecycle EXPECTED → APPROVED → RECEIVED → DISTRIBUTED → PAID; amounts in lakh/crore words; aging buckets.
- **Installments API:**
  - A back-dated plan shows overdue amounts.
  - Custom items that don't add up to the total are refused (400).
  - A payment fills the oldest installments first.
  - The plan appears in receivables aging.
  - The receipt is a valid PDF.
- **Commission API:**
  - Approve sets the lifecycle to APPROVED.
  - The outside referral is paid in full.
  - The agent's share excludes the referral.
  - An agent can read their own statement but gets 403 for someone else's.
  - The statement PDF is generated.
  - Payables aging shows the agent by name.
- **Cash flow:** 12 months; this month's income, expense, net and cumulative are correct.
- **Full results:** server 248 passed (1 skipped), web 38, Flutter 81, `flutter analyze` clean, web build OK.
- **Visual check** of the installment plan detail, the Reports page (cash flow, aging, statement) and the deal detail (lifecycle, Approve, outside shares) on the demo data.

## Phase 6 tests (`server/tests/marketing.test.ts`)
- **Shared:** ROI / cost per lead / conversion maths, slugs, wa.me links.
- **Website:**
  - A web address is required to go online; reserved addresses are refused; a duplicate address gets 409 SLUG_TAKEN; an agent can't change settings (403).
  - Only published, live listings are listed; sold and unpublished ones are hidden (404).
  - The response never contains the plot number, minimum price, owner or exact coordinates.
- **Inquiry → lead:**
  - A new lead is created with source WEBSITE, assigned to the listing agent and linked to the campaign by code, with one call-back follow-up, a notification and an acknowledgement email.
  - A repeat inquiry from the same phone creates no duplicate client and no second follow-up.
  - The honeypot is accepted silently and creates nothing.
- **Campaign ROI:** after the lead's deal closes with Rs 150,000 received, the campaign reports leads 1, won 1, cost per lead Rs 20,000 and ROI 650%. The campaign report and lead sources also check out.
- **Plans and permissions:** a Professional plan gets 403 MODULE_NOT_IN_PLAN for campaigns; an agent can't create campaigns.
- **Portals:**
  - A client sees only their own installment plan and can download its receipt PDF; another client's receipt returns 404.
  - A message to the agent creates a notification.
  - A revoked link returns 410 LINK_EXPIRED; an unknown token returns 404.
  - An owner sees their listing on the website; a viewer can't create links (403).
- **WhatsApp:**
  - Without credentials, sending returns a wa.me link.
  - With credentials (mocked Graph API), a message is sent to the phone number id.
  - Webhook verification passes with the right token and returns 403 with a wrong one.
  - A bad signature returns 401.
  - A signed inbound message creates a WHATSAPP lead and inquiry; Meta's retry is de-duplicated.
- **Email:** a member who opted in gets an email copy of "New lead assigned to you".
- **Full results:** server 258 passed (1 skipped), web 38, Flutter 81, `flutter analyze` clean, web build OK.
- **Visual check** (Chrome, 1280 px and 390 px): agency site, listing page, client portal with lease and receipt, Marketing → Campaigns with ROI.

## Phase 7 tests (`server/tests/ai.test.ts`)
- **Shared:** the forecast weights deals by stage and places them in the right months (overdue dates land in the current month, undated deals by typical time to close, lost deals excluded). The price estimate ignores an outlier, counts a sale, and refuses with fewer than 3 comparables.
- **Without a key:**
  - English and Urdu template descriptions, with no plot number.
  - A rule-based brief ("Never contacted", a WhatsApp message).
  - The assistant returns 503.
  - The price estimate uses 4 comparables in the society, with the disclaimer.
  - The forecast's weighted commission is Rs 2.1 lakh for a TOKEN-stage deal.
- **With a fake client:**
  - The request uses the configured model, `fallbacks: "default"` with the server-side fallback beta, and a JSON-schema output.
  - Neither the plot number nor the minimum price reaches the request.
  - Usage is metered.
- **Assistant:**
  - A user with only `clients:read` is offered just the client tools; the tool result reaches the model; the system prompt carries cache control.
  - A tool the model asks for that the user isn't allowed is refused.
  - A refusal returns 422 AI_DECLINED; the monthly cap returns 429 AI_LIMIT_REACHED.
- **Plans and permissions:** the forecast returns 403 without deals/reports permission; the Business plan gets 403 MODULE_NOT_IN_PLAN.
- **Full results:** server 265 passed (1 skipped), web 38, Flutter 81, `flutter analyze` clean, web build OK.
- **Visual check** on the demo with no key: the Assistant page (shown as off, with an explanation), the description writer with the template, the lead brief, and the forecast on Reports.
  - The check found and fixed a crash on the Assistant page: the scroll effect returned a value React treats as a cleanup.
  - It also found and fixed template wording (raw unit codes, a repeated society name).

## Follow-ups batch tests (`server/tests/followups8.test.ts`)
- **Co-owners / agents:** co-owners and listing agents are saved on a property.
- **Campaign spend:** an expense booked against a campaign adds to its spend (Rs 10,000 typed + Rs 40,000 booked = Rs 50,000); an income entry is refused (400).
- **Agent page:**
  - It works for an agent with a live listing, and returns 404 for an agent without one.
  - The listings filter by agent.
- **Team dashboard:**
  - The manager sees the agent's leads, open deals and 50% share of Rs 1 lakh received.
  - The agent gets 403.
- **Assistant:** it proposes a follow-up, which comes back in `proposals`, and no follow-up is saved.
- **WhatsApp templates (mocked Graph API):** templates are synced from the business account; a template is sent with `components.body.parameters`.
- **Full results:** server 271 passed (1 skipped), web 38, Flutter 81, `flutter analyze` clean, web build OK.
- **Visual check:** the dashboard team and collections panels, the property form pickers, and the public agent page, all on demo data.

## Gap-closing batch tests (`server/tests/phase9.test.ts`, `server/tests/matching.scoring.test.ts`)
- **Payout approval:** with approval required, paying an unapproved payout returns 400 and an agent can't approve (403). The owner approves (status and approver recorded) and pays, and the voucher PDF is generated.
- **Adjustments and disputes:** a −50,000 adjustment reduces the expected commission to 150,000. Resolving with nothing open returns 400; a dispute is opened and resolved.
- **Refunds:** 30,000 refunded on 100,000 income; refunding beyond what is left returns 400. The income statement shows 100,000 / 30,000 / 70,000 / 70 %, with REFUNDS as the expense line and a branch row; the expense voucher PDF is generated.
- **Leases:** a tenant notice is recorded and its PDF generated; a maintenance expense booked to the lease totals 12,000.
- **Lead assignment:** three website leads go to agent 1, agent 2, agent 1 (round-robin).
- **Client portal:**
  - A matched property is visible with no owner fields; favourite → SHORTLISTED.
  - A preferences update changes the requirement.
  - A visit request creates a PROPERTY_VISIT follow-up; a property the client was never matched with returns 404.
  - With preference updates switched off, the update returns 403.
- **Owner portal:** availability confirmation stamps the listing but leaves the price unchanged; another owner's property returns 404.
- **Documents:** sharing a CNIC document in the portal returns 400.
- **Agent performance:** the manager sees the agent's lead; the agent sees only their own row and gets 403 for another agent; the Excel export is a valid file.
- **Business summary, branch targets** (progress 25 % / 0 % / 0 %) and **listing quality** (POOR, photos missing) are checked.
- **Matching:** clients without feature preferences score unchanged (100); a full feature match scores 100; a house two bedrooms short scores lower with BEDROOMS_SHORT; a partial amenities match gives FEATURES_PARTIAL 2/3.
- **Full results:** server 280 passed (1 skipped), web 38, Flutter 81, `flutter analyze` clean, web build OK.
- **Visual check:** the client portal (requirement, picked properties with Save / Request a visit / Not interested), Reports (business overview, agent performance with Excel / PDF), the deal's adjustments and disputes, and the lease's maintenance tab.
  - The check found and fixed a bug: report ranges ending today excluded today's records.

## Final batch tests (`server/tests/pipeline.test.ts`, `server/tests/ai.test.ts`, `mobile/test/deals_test.dart`)
- **Pipeline normalisation:** stages come back in fixed order, Inquiry stays on even if stored off, Won is always 100 %, and an out-of-range chance falls back to the default. The forecast uses custom probabilities (100,000 at 50 % → 50,000).
- **Settings:** an agent gets 403 when changing the pipeline. Switching off Lost returns 400, and so does a chance of 1.5. Renaming and switching off are saved, and a later partial update keeps the earlier changes.
- **Deals:** creating or moving a deal into a switched-off stage returns 400. An offer on a Site-visit deal leaves it in Site visit when Negotiation is off. The forecast weights a Token deal at the configured 50 %.
- **AI provider:** a stub provider registered as `AI_PROVIDER` handles descriptions and the assistant (with the permission-filtered tools). `/ai/status` reports it, and both calls are metered under its model. The existing Anthropic tests pass unchanged.
- **Android:** switched-off stages are hidden except the deal's own, Urdu and English custom names are used, and the default is every stage.
- **Full results:** server 283 passed (1 skipped), web 38, Flutter 82, `flutter analyze` clean, web build OK.
- **Visual check:** in Settings, switching off Qualified and renaming Site visit to "Viewing" is reflected on the deals board.

## Second re-audit batch tests (`server/tests/final.test.ts`)
- **API keys:** a member without settings rights gets 403; a key with an admin permission is refused (400). The created key is shown once and the list never contains the secret or its hash. The key can read and create clients, but gets 403 for properties, members, settings and key management. An unknown key gets 401. On a plan without API access the key gets MODULE_NOT_IN_PLAN. After revocation it gets 401. Creation and revocation are audited.
- **Bulk actions:** assigning three ids (one unknown) updates two and reports the third. Status change and delete work for clients; an agent without delete rights gets 403 and an unknown action 400. Properties: status change with a reason and agent assignment work; an agent without update rights gets 403.
- **Commission rules:** the first fitting rule wins, otherwise the defaults; a rule with no condition is refused (400). A new deal on a matching listing gets 2.5 % / 1.5 %, a deal without a property gets the defaults, and a commission entered on the deal wins.
- **Retention:** nothing is purged by default. A 3-month audit period is refused (400). With 12 / 6 months set, entries 400 days old are removed for that business only, the recent settings change stays, and client records are untouched.
- **Full results:** server 288 passed (1 skipped), web 38, Flutter 82, `flutter analyze` clean, web build OK.
- **Visual check:** selecting two clients and putting them on hold from the bulk bar; creating an API key and seeing it listed as active; adding a commission rule. No console errors.

## Rebrand, mobile parity and manuals
- **Rebrand:** no occurrence of the old name remains in tracked text files except the hosted address. Server (288), web (38) and Flutter (86) suites pass under the new name, including the PDF test that looks for the brand in a report. Checked by eye: the new logo, the web sidebar, the phone sign-in render.
- **Mobile (`mobile/test/more_test.dart`):** the form sheet refuses a missing required number and a non-number, then returns `{amount: -50000, relist: true, kind: 'B'}`; stat cards and bar lists render; JSON helpers cope with nulls and bare ids; every `mm.*` key used by the new screens exists in English and Urdu.
- `flutter analyze`: no issues. The new screens are compiled and unit-tested; they have **not** been exercised on a physical phone (see "Not yet covered").
- **Manuals:** screenshots captured from the running demo as each role; PDFs built and verified by `tools/manuals` (see `docs/user-manuals/README.md` for page and figure counts).

## Parity and roles pass (`server/tests/roles.mobile.test.ts`, `mobile/test/extras_test.dart`, `tools/manuals/roles-smoke.mjs`)
- **Phone menus per role:** for each of the 13 role templates, every screen the phone would show is called and must not answer 403 or 5xx; the owner must get 200 everywhere.
- **Notes:** a deal's notes can be read by the owner and by a member with deals access, and are refused to a member without it; agreement, entry and lease notes are mapped too.
- **Phone:** source / temperature / unassigned filters; saved-view parameters round-trip and use the web's names; a web view with extra parameters opens on the phone.
- **Web, every demo role:** the smoke script opens each menu page, first record, record tabs and settings tabs and reports forbidden calls, page errors and error panels.

## Cross-check pass (18 Nov 2026)
- **Currency:** outside a request amounts are PKR with lakh / crore; inside a request for an AED business they read "AED 1,550,000" (also after awaits); INR keeps lakh; an invalid code falls back to PKR. The same cases are written for the web and Flutter.
- **Full results:** server 305 passed (1 skipped), web 39 (11 files). Flutter tests not run here (no Flutter SDK on this machine); the APK build on GitHub Actions compiles the Android code.
- **Prototype screens:** the five changed phone screens were rendered in headless Chrome and measured: all fit the 844 px frame.

## Security, load and workflow QA (21 Nov 2026)

Scripts in `tools/security` (local demo only). Every attack was paired with a control request that must succeed with the agency's own ids, so a refusal proves the defence and not a malformed request.

**Attacks that were refused (no change needed)**
- Another agency's records: direct reads (clients, properties, owners, media, brochure, QR, members) → 404. Linking own records to another agency's client, owner, property, deal, branch, income category, client category, agreement template or user → refused on create, on edit and through offline sync (31 create + 25 edit cases).
- Tokens: `alg: none` and tampered tokens → 401; an access token dies at logout; a reused refresh token ends the whole session.
- Injection: operator objects in queries and login → 400; regex-like search text → 400.
- Escalation: an agent cannot change roles or permissions, add members, create API keys, change settings or the business profile, read the audit log or another agent's statement; a viewer cannot create or delete; profile edits refuse role / email / status.
- Uploads: HTML, SVG, PHP-as-JPEG, HTML-as-PDF → 400; path names are stripped.
- Accounts: unknown and known emails get the same answer at sign-in and reset; weak passwords refused; 25 wrong passwords lock the account and trip the rate limit.
- Public surface: CORS refuses unknown origins; security headers present; public listings hide plot numbers, owners, CNIC and minimum price; unsigned WhatsApp webhooks → 401; portal tokens are 43 characters, cannot reach other records, are rate limited and stop working when revoked; Socket.IO refuses connections without a token and joins rooms only server-side.

**Found and fixed**
- Notes, documents and timeline entries were more visible than their record: an agent could add / read notes on finance entries and other agents' deals, download their attachments, and see installment amounts in the activity feed; the phone's download carried every note in the agency. All now follow `services/recordAccess.ts` (404 for hidden records). Re-run: all refused.
- Map links accepted `javascript:`, `data:` and `vbscript:` (stored XSS) → http(s) only, and the web never renders another scheme.
- One shared upload ceiling of 100 MB × 10 files, also for spreadsheet imports (unzipped in memory) → per-route ceilings (spreadsheets 5 MB, documents 25 MB).
- Client-supplied request ids were echoed and logged at any length → short plain ids only. Download names with Urdu letters made the file route fail → RFC 5987 header.
- Dependencies: `file-type` (infinite loop on malformed media) replaced by a bounded built-in check that matches it on every accepted type; sharp 0.35 (libvips CVEs), nodemailer 10, firebase-admin 13, echarts 6 and patch releases of mongoose, axios, body-parser, react-router, follow-redirects and node-forge.
- Android: app backup disabled (the local database held client data); release builds already refuse cleartext HTTP and keep tokens and the PIN in the Android Keystore.
- **APK builds had failed since 15 Nov**: current Flutter stable needs Android Gradle Plugin 9.1.1 (the project pinned 9.1.0). Fixed; the workflow now also runs `flutter analyze` and the Flutter unit tests and posts errors as annotations. Build 20: analyze clean, unit tests pass, APK published.

**Load**
- 25 and 100 simulated users (18 sessions, 80 % reads, follow-ups and offline-sync writes) for 30–40 s: **0 server errors, 0 timeouts, 0 rate-limit hits**; the server stayed healthy. Single-user latency 20–120 ms per endpoint. The laptop was also running other projects' test suites during the run, so throughput figures (≈45 req/s) reflect a shared CPU, not the API's ceiling.
- 5,000 of each record type (`PERF=1 npx jest tests/perf.test.ts`): passes; list and search 27–115 ms, dashboard 227 ms, sync first page 644 ms (busy machine; about 1.5–2× the Nov baseline).

**Workflows**
- `tools/manuals/roles-smoke.mjs` on the rebuilt web app: owner 21, manager 21, member 20, agent 16, accountant 18, viewer 17 menu pages with their record tabs and settings tabs — **0 problems**.
- Server suite 305 passed + 1 skipped (includes the end-to-end scenarios); web 39; Flutter unit tests pass in CI.

**Accepted / open**
- react-router open-redirect advisory: the app never navigates to a path taken from the URL.
- uuid / Google Cloud advisories inside exceljs and firebase-admin: the vulnerable call (with a caller-supplied buffer) is not used.
- The phone's local database is not encrypted on its own; it relies on Android device encryption and the app's PIN lock.
- The hosted demo runs with public demo passwords by design; a real deployment needs `NODE_ENV=production`, real accounts and a MongoDB URI.

## Zod 4 upgrade (21 Nov 2026)
- Validation library moved from zod 3.25 to 4.6.7 (closes the high-severity advisory on oversized constrained collections). Changes: boolean config defaults are booleans (Zod 4 skips parsing defaults, so `'false'` would have been truthy), record schemas name their key type, comma-separated list parameters use a preprocess step, and ids from phones use `z.guid()` (the Zod 3 format — Zod 4's `uuid()` would reject ids without RFC version bits).
- Field messages: Zod 4's built-in wording is replaced by plain English (`validators/zodMessages.ts`: Required, Must be at least …, Invalid email address, Unknown field: …); messages written on a schema still win. Both apps show these next to the field.
- Checks: server suite (305 + new message tests), production build, config booleans parsed both ways, all `tools/security` scripts (no findings), role walkthrough. `npm audit` lists no high-severity issue.


Did you mean this?
  npm audit # Run a security audit
To see a list of supported npm commands, run:
  npm help now lists no high-severity issue.

## Manual / visual verification
Demo API (`npm run demo`) + web, headless Chrome screenshots at 1440 px: client list with lead scores and temperature filter, client lead panel, Reports (leads + inventory aging), Settings → Subscription. All rendered correctly with real demo data.

## Not yet covered
Device testing of the new Android screens (render-tested via unit tests only); load testing of automation jobs on large tenants.
