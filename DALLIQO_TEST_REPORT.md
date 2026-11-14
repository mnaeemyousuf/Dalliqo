# Dalliqo — Test Report

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

## Manual / visual verification
Demo API (`npm run demo`) + web, headless Chrome screenshots at 1440 px: client list with lead scores and temperature filter, client lead panel, Reports (leads + inventory aging), Settings → Subscription. All rendered correctly with real demo data.

## Not yet covered
Device testing of the new Android screens (render-tested via unit tests only); load testing of automation jobs on large tenants.
