# Dalliqo — Implementation Progress

## Phase 3 — Leads, Inventory, Negotiation, Plans, Automation ✅ (13 Nov 2026)

### Features implemented
- **Lead management:** expanded sources, campaign attribution, buying timeline, configurable lead scoring (score + per-factor explanation), HOT/WARM/COLD (automatic or manual override), first-response time, status and assignment history, lost reasons, assignment with notification, unassigned inbox, lead report (sources, conversion, aging, lost reasons), Excel import with template.
- **Property inventory:** 17 property types in 4 categories, acre unit, Pakistan attributes (phase, sector, unit/file no., possession, development, construction, furnishing, facing, corner, main road, park facing, amenities), lifecycle statuses under negotiation / on hold / expired, availability expiry, price history, duplicate-plot detection, co-owners and listing agents (API), floor price hidden without permission (API and offline sync), inventory aging report.
- **Deal negotiation:** 11-stage pipeline, offers and counter-offers (accept → agreed price and stage), initial asking price snapshot, token amount, closing checklist with custom items. Works offline on Android.
- **Subscriptions:** Starter / Professional / Business / Enterprise plans with module entitlements and user/branch/storage limits, 14-day full trial for new businesses, past-due grace period, read-only when expired, upgrade requests, billing history, platform-admin console (PLATFORM_ADMIN_EMAILS).
- **Automation:** hot lead not contacted, lead going cold, listing re-verification, listing expiry (auto-expire + warning), deal stuck in negotiation, agreement expiring; per-business on/off and thresholds; alerts de-duplicated; periodic lead rescoring.

### Database changes (MongoDB, migration `004-phase3`)
- `clients`: campaign, buyingTimeline, temperature, temperatureOverride, leadScore, leadScoreReasons, leadScoredAt, firstContactedAt, responseMinutes, lostReason, lostNote, convertedAt, statusHistory, assignmentHistory (+2 indexes).
- `properties`: phase, sector, unitNumber, possessionStatus, developmentStatus, constructionStatus, furnishing, facing, corner, mainRoad, parkFacing, amenities, availabilityExpiresAt, coOwnerIds, agentIds, priceHistory (+2 indexes).
- `deals`: initialAskingPrice, offers, tokenAmount, checklist.
- `businesses`: subscription {plan, status, cycle, trialEndsAt, currentPeriodEnd, history}.
- `settings`: leadScoring, automation, sqftPerUnit.ACRE.
- `notifications`: dedupeKey (unique per user when set).
- Migration: existing businesses → ENTERPRISE/ACTIVE (no behaviour change); members with properties:update get properties:view_floor_price; open deals get the default checklist.

### APIs created / modified
New: `POST /clients/:id/assign`, `POST /clients/import`, `GET /clients/import/template`, `GET /reports/leads`, `GET /reports/inventory`, `GET /properties/duplicates`, `POST /deals/:id/offers`, `POST /deals/:id/offers/:offerId/respond`, `POST /deals/:id/checklist`, `GET /subscription`, `POST /subscription/request`, `GET /platform/businesses`, `PATCH /platform/businesses/:id/subscription`.
Modified: client/property/deal create/update and list filters, `PATCH /settings` (leadScoring, automation, ACRE), `GET /auth/me` (+entitlements, platformAdmin), `GET /sync/pull` (floor price redaction), every CRM route (entitlement guard).

### Web changes
Lead score column, temperature filter, source/unassigned filters, Import dialog; lead panel on client detail (score gauge, reasons, temperature override, assignment, history); new client fields; Pakistan details section in property form and detail with price history; duplicate-plot confirmation; Negotiation and Checklist tabs on deals; Leads and Inventory reports; Settings → Automation & scoring and Subscription; Platform admin page; navigation hides modules outside the plan; English + Urdu strings.

### Android changes
New enums (types, units, statuses, stages, sources), buying timeline in client form, lead score card on client detail, offers/counter-offers and closing checklist on deal detail (offline via outbox), Urdu/English strings.

### Tests
Server 227 passed (20 new Phase 3 tests) · Web 38 passed · Flutter 79 passed (1 new) · typecheck/analyze clean. Details in `DALLIQO_TEST_REPORT.md`.

### Outstanding dependencies
Payment gateway, WhatsApp Business API, AI provider key, Google Maps key (optional). See gap analysis.

## Phase 4 — Verification, sensitive data, inventory tools, approvals ✅ (14 Nov 2026)

### Features implemented
- **Property verification workflow:** submit (with note) → assign to a verification officer → 8-item checklist (identity, ownership proof, NOC, tax, dues, possession, site inspection, price) → approve / reject / send back with remarks; four-eyes rule (the submitter cannot approve their own submission, owners/admins excepted); verified by/at, next verification date (default 6 months), full history, missing-document detection by category, documents expiring within 30 days; verification queue page; notifications to officers/submitters; disclaimer on every screen that this is an internal check, not a government confirmation of ownership.
- **Sensitive data protection:** new document categories (CNIC, registry, allotment letter, transfer letter, society NOC, property tax, dues record, possession); identity/title documents and owners' CNIC numbers visible only with `documents:read_sensitive` (API, sync and download); CNIC masked (12345-*******-1) otherwise and never written to the audit log in clear text; every download of a sensitive document is audited; document expiry dates with reminders.
- **Inventory tools:** property Excel import (template, owner matched by mobile or created, duplicate plots and invalid rows reported), property QR code (PNG), map view of listings (OpenStreetMap, configurable tiles), saved list views (private or shared with the team) for clients and properties, Android property form with Pakistan attributes.
- **Roles:** six new permission templates — Branch manager, Sales manager, Property manager, Verification officer, Finance manager, Marketing manager; new permissions `verification:submit`, `verification:decide`, `documents:read_sensitive`, `deals:approve`.
- **Deal approval workflow:** optional setting — closing a deal as won by an agent becomes a request that members with `deals:approve` approve or reject (also when the agent closes it offline on Android).
- **Automation:** new rule "Re-verification & document expiry".

### Database changes (migration `005-phase4`)
- `properties.verification` {status, assignedTo, submittedBy/At, checklist[], decision, remarks, verifiedBy/At, nextVerificationAt, history[]} + 2 indexes.
- `propertyOwners.cnic`; `propertyDocuments.expiresAt`; `deals.approval`; `settings.commission.closeApprovalRequired`; new collection `savedViews`.
- Migration keeps behaviour for existing members: property editors get `verification:submit`, document uploaders keep `documents:read_sensitive`, commission managers get `deals:approve`.

### APIs
New: `GET /properties/:id/verification`, `POST /properties/:id/verification/{submit,assign,checklist,decide}`, `GET /verifications`, `GET /properties/import/template`, `POST /properties/import`, `GET /properties/:id/qr`, `GET|POST /saved-views`, `DELETE /saved-views/:id`, `POST /deals/:id/approval`. Modified: owners (cnic, masking), documents (categories, expiry, sensitive filtering), sync pull (owner CNIC), deal stage change (approval), settings (closeApprovalRequired).

### Tests
Server 236 passed (9 new) · Web 38 passed · Flutter 79 passed · typecheck/analyze clean.

## Phase 5A — Rental management ✅ (14 Nov 2026)

### Features implemented
- Leases linking property, landlord (owner), tenant (client) and optionally the signed rent agreement; lease numbers `LS-000001`.
- Monthly rent schedule generated from the term with due day, yearly escalation, grace days and late fees (fixed or % of rent); the first month is never due before the lease starts; back-dated months never get a late fee.
- Rent payments allocated to the oldest unpaid months, partial payments, advances kept as credit, idempotent payment ids (safe retries from the phone), optional agency fee (% of rent) recorded automatically as income in "Rent collection fee".
- Waive a month (with reason, audited), move-in / routine / move-out inspections, renewal (extends the schedule, optional new rent), end or terminate (future months removed, deposit refund tracked, property back on the market), property marked RENTED on activation.
- Rent roll: active leases, monthly rent roll, due and collected this month, overdue, deposits held, leases ending in 60 days.
- Automation: "Rent due reminder" and "Rent overdue" rules; hourly job marks overdue months and charges late fees.
- Web: Rentals list with rent-roll tiles and filters, lease detail (schedule, payments, inspections, record rent, renew, end, waive). Android: Rentals list and lease detail with rent recording (online).
- Plans: `rentals` module (Business and Enterprise); permissions `rentals:read`, `rentals:manage`; demo data includes two leases.

### Database / APIs
- New collection `leases` (schedule, payments, inspections embedded; 7 indexes); migration `006-rentals` (permissions); transaction source `RENTAL`.
- `GET /leases`, `GET /leases/rent-roll`, `POST /leases`, `GET /leases/:id`, `POST /leases/:id/{payments,waive,inspections,renew,end}`.

### Tests
Server 242 passed (6 new rental tests: schedule maths, allocation, summary, full lease lifecycle, scheduled overdue refresh, permissions) · Web 38 · Flutter 79.

## Phase 5B — Installments, commission lifecycle, finance reports ✅ (14 Nov 2026)

### Features implemented
- **Installment plans** for buyers: booking, down payment, monthly / quarterly / half-yearly / yearly installments (remainder on the last one) and an on-possession payment; or a custom list of items. The items must add up to the total. Plan numbers `IP-000001`.
- Payments go to the oldest unpaid installment first, with partial payments, advances kept as credit and safe retries. A plan is marked COMPLETED when nothing is left. Plans can be cancelled with a reason. An hourly job marks late installments, and the "Installment overdue" automation rule alerts the creator and managers.
- **Commission lifecycle:** Expected → Approved → Partly received → Received → Distributed → Fully paid.
  - Approval is an explicit, audited action.
  - Outside dealer, referral and other-branch shares (percent of the total commission, or a fixed amount) come off the top. Agents split what the agency keeps. Outside shares are earned in proportion to what has been received and can be paid and tracked.
- **Finance reports:**
  - 12-month cash flow (income, expense, net, cumulative) from the ledger.
  - Receivables and payables aging in five buckets (not yet due, 1–30, 31–60, 61–90, 90+ days). Receivables cover commission still due, late installments and late rent; payables cover agent shares and outside parties owed.
  - Agent commission statement, as JSON or PDF. Agents see only their own; managers with `deals:read_all` see anyone's.
- **Receipts:** a PDF receipt for any recorded payment (rent, installment or deal commission), with the amount in words in lakh/crore. Every receipt generated is audited.
- **Web:**
  - New Installments section: a list, a create drawer with a live schedule preview, and a detail page with the schedule, payments, receipts, record payment and cancel.
  - The Reports page gains Cash flow, Aging and Agent statement cards.
  - Deal detail gains the lifecycle badge, an Approve button, and an outside-shares card with an editor and a "pay owed" action.
  - Receipt buttons on lease, installment and deal payments.
- **Android:** commission maths mirror updated (outside shares and lifecycle); the deal screen shows the lifecycle and outside shares.

### Database / APIs
- New collection `installmentPlans` (items and payments embedded; 6 indexes). Deals gain `externalShares[]`, `commissionApprovedAt` and `commissionApprovedBy`. These are additive, so no migration is needed.
- `GET|POST /installments`, `GET /installments/:id`, `POST /installments/:id/payments`, `POST /installments/:id/cancel`
- `POST /deals/:id/commission/approve`, `POST /deals/:id/external/:shareId/pay`
- `GET /reports/cash-flow`, `GET /reports/aging`, `GET /reports/agent-statement?userId=&format=json|pdf`
- `GET /receipts/:kind(lease|installment|deal)/:id/:paymentId` (PDF)
- Plan gating: installments, cash flow and aging belong to the `finance` module; the agent statement belongs to `deals`.

### Tests
- Server: 248 passed, 6 of them new (schedule maths, commission split and lifecycle, amounts in words and aging buckets, full installment flow with receipt PDF, approval with outside-dealer payment and statement permissions, cash flow).
- Web: 38. Flutter: 81 (2 new commission parity tests).

## Phase 6 — Website, inquiries, campaigns, portals, email, WhatsApp ✅ (14 Nov 2026)

### Features implemented
- **Agency website** at `/w/<address>`: listings page with search, filters, sorting and pages; a page per listing with photos, details, call and WhatsApp buttons and an inquiry form; about and contact sections. English/Urdu; works on phones.
  - Only published listings that are available, reserved or under negotiation appear.
  - Owner, plot / street / unit number, minimum price and the exact location are never sent. The map link is rounded to about 200 m.
  - Each listing counts its views and inquiries.
- **Inquiry → lead:** a website inquiry (or a WhatsApp message) matches an existing client by phone or creates a lead (source WEBSITE / WHATSAPP).
  - The lead is assigned to the listing's agent and gets a follow-up within the hour (one at a time; repeats don't pile up).
  - The assignee, or the owner and managers if nobody is assigned, is notified.
  - The raw inquiry is kept; an email acknowledgement goes out when an email was given.
  - Abuse protection: honeypot field and 10 submissions per 15 minutes per IP. IPs are stored only as salted hashes.
- **Campaigns and ROI:** channel, status, budget, spend and a link code (`?c=code`, carried from the site to the inquiry). Per campaign: leads, inquiries, wins, commission actually received, cost per lead, conversion, cost per win and ROI. The Reports page adds campaign and lead-source cards.
- **Client and owner portals:** private links with no account needed; only a hash of the token is stored. Links are valid for 7–365 days, can be revoked and count how often they were opened.
  - Clients see their deals, installment plans (schedule, payments) and leases (schedule, overdue), and can download their own receipts as PDFs.
  - Owners see their listings (status, verification, on the website, views and inquiries), leases (collected, overdue) and deal progress.
  - Both can message their agent: this records activity and notifies the agent. Expired or revoked links return 410.
- **Email notifications:** a per-user switch (Settings → Profile) emails a copy of every in-app notification, with a link back to the record. SMTP is required in production; in development mail goes to the dev outbox.
- **WhatsApp Business (Cloud API):**
  - Each business enters its phone number id; the deployment holds the Meta access token, app secret and verify token.
  - "Send WhatsApp" sends from the business number when connected, otherwise it opens wa.me with the text ready. Either way it is recorded as activity.
  - The webhook (verification handshake plus HMAC-SHA256 signature check) turns inbound messages into leads and inquiries. Meta's retries are de-duplicated by message id.
- **Web:** a new Marketing section (Inquiries, Campaigns, Website, WhatsApp); "Publish" on property detail; "Portal link" on client and owner detail (copy or send on WhatsApp); "Send WhatsApp" on client detail; the email switch in Profile; public pages for the site, listings and portal.
- **Android:** publish / unpublish from property detail; create and share portal links from client and owner detail (opens WhatsApp with the message, or the share sheet).
- **Permissions and plans:**
  - New `marketing:manage` (website, campaigns, WhatsApp settings). Migration `007-marketing` grants it to members who could manage settings and to managers / marketing managers.
  - Campaigns are in the `marketing` module (Business and Enterprise plans). The website, inquiries and portals work on every plan.
- **Demo data:** website `/w/yousuf-estate-demo` with 10 published listings, two campaigns (one with attributed leads and a won deal) and a website inquiry.

### Database / APIs
- **New collections:** `campaigns`, `inquiries` (unique per-business `externalId` for WhatsApp) and `portalLinks` (unique token hash).
- **New fields:**
  - Business: `website{enabled,slug(unique),tagline,about,phone,whatsapp,email,showAgents}` and `whatsapp{phoneNumberId,displayNumber}`.
  - Property: `publicListing{published,publishedAt,headline,views,inquiries}`.
  - Client: `campaignId`.
  - User: `preferences.emailNotifications`.
- **Signed in:**
  - `GET|PUT /website`, `POST /properties/:id/publish`
  - `GET /inquiries`, `PATCH /inquiries/:id`
  - `/campaigns` CRUD, `GET /reports/campaigns`
  - `POST|GET /portal-links`, `DELETE /portal-links/:id`
  - `GET|PUT /whatsapp`, `POST /whatsapp/send`
  - `PATCH /auth/me` accepts `preferences.emailNotifications`
- **Public, no sign-in:**
  - `GET /public/sites/:slug`, `GET /public/sites/:slug/listings`, `GET /public/sites/:slug/listings/:id`, `POST /public/sites/:slug/inquiries`
  - `GET /public/portal/:token`, `GET /public/portal/:token/receipts/:kind/:id/:paymentId`, `POST /public/portal/:token/requests`
  - `GET|POST /public/whatsapp/webhook`

### Credentials needed for WhatsApp Business
`WHATSAPP_ACCESS_TOKEN` (permanent system-user token), `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`, set on the API service. Then register the webhook `https://<api>/api/public/whatsapp/webhook` in the Meta app, and each business enters its phone number id under Marketing → WhatsApp. Without these, everything works with wa.me links.

### Tests
- Server: 10 new marketing tests; 258 passed + 1 skipped in total.
- Web: 38. Flutter: 81. `flutter analyze` clean; web build OK.

## Phase 7 — AI layer ✅ (15 Nov 2026)

### Features implemented
- **Assistant** (web → Assistant): ask in English, Urdu or Roman Urdu about clients, listings, deals, follow-ups and money.
  - It runs on Claude through the official Anthropic SDK, using model `claude-opus-5-5` (configurable).
  - It can only read, through 8 tools: search clients, client record, search listings, price estimate, my day, deal pipeline, collections, forecast.
  - **Permission-aware:** each tool runs as the signed-in user, so the same permissions, branch scope and own-deals-only rules apply. Tools the user isn't allowed are never offered, and a request for one is refused.
  - At most 6 lookups per question.
- **Listing descriptions:** "Write description" on a property drafts a headline and description in English or Urdu, which the user edits and then saves.
  - The AI only sees allow-listed listing facts: no owner, plot / unit number or minimum price.
  - Without a key, a built-in template writes it instead (readable units, no repeated place names, Urdu property types).
- **Lead brief:** a card on the client overview gives a summary, the next step, risks and a WhatsApp message ready to send (copy, or open in WhatsApp). Without a key, a rule-based brief is shown.
- **Forecast, no AI needed:** the next 6 months of commission from open deals, weighted by how likely each stage is to close (best case shown too), plus scheduled installments and rent still unpaid and the lead trend. It is a card on the Reports page and is also available to the assistant.
- **Price estimate, no AI needed:** an indicative range from comparable listings and recorded sales (price per sq ft; sold prices count double; outliers removed). It widens the area searched (block → society → area → city) until there are at least 3 comparables, and reports confidence, the basis used and where the asking price sits in the range. It is always labelled as an estimate, not a valuation.
- **Cost and safety:**
  - Server-side refusal fallbacks are on: if Claude declines, the API retries on a fallback model in the same call.
  - Refusals return a clear 422 AI_DECLINED.
  - Each business has a monthly allowance (`AI_MONTHLY_LIMIT`, default 3000 calls; 429 AI_LIMIT_REACHED when used up), plus 20 AI calls per minute per user.
  - Every call is metered in `aiUsage` (feature, model, tokens, outcome), kept for one year.
  - The fixed system prompt is cached.
  - Provider errors are mapped to clear messages (busy, credentials, unavailable).
- **Android:** a lead brief sheet on client detail (WhatsApp button) and a price-estimate dialog on property detail.
- **Plan:** `/ai` belongs to the `ai` module (Enterprise, which is also the trial plan).

### Database / APIs
- New collection `aiUsage`. No migration needed; uses existing permissions.
- `GET /ai/status`, `POST /ai/assistant`, `POST /ai/properties/:id/description`, `GET /ai/properties/:id/price-estimate`, `POST /ai/clients/:id/brief`, `GET /ai/forecast`.
- New dependency: `@anthropic-ai/sdk` 1.8.0 (server). The lockfile's Linux build entries were checked and are intact.

### Credentials needed
`ANTHROPIC_API_KEY` on the API service turns on the assistant and AI-written text. Optional: `AI_MODEL` and `AI_MONTHLY_LIMIT`. Without a key, every screen still works: descriptions use templates, briefs use rules, and forecast and price estimates don't need a key.

### Tests
- Server: 7 new AI tests using a fake Anthropic client (no paid calls); 265 passed + 1 skipped in total.
- Web: 38. Flutter: 81. `flutter analyze` clean; web build OK.

## Follow-ups batch ✅ (15 Nov 2026)

### Features implemented
- **Co-owners and listing agents** can be picked in the property form (web). Pickers show the chosen people as removable chips.
- **Campaign spend from the books:** an expense can be booked against a campaign (Income & expense form). A campaign's spend is now the amount typed on it plus the expenses booked against it, and ROI and cost per lead use that total. Only expenses can be linked; an income entry is refused.
- **Agent landing pages** at `/w/<site>/a/<agent>`:
  - A page shows the agent's name, call and WhatsApp buttons, their live listings and an inquiry form.
  - It exists only for active members who have a live listing, and only while the website shows agents.
  - The site home lists "Our agents", and listing pages link to the agent's page.
- **Role dashboards** (top of the dashboard):
  - Agents see their own commission (open deals, expected, earned, owed).
  - Managers see a team table for this month: leads, hot leads, overdue follow-ups, follow-ups done in 7 days, open deals, deals won, and each member's share of commission received. It respects branch scope.
  - Finance roles see collections: receivables, late installments, late rent, payables, and rent collected against rent due this month.
- **The assistant can suggest actions:** new `propose_follow_up` and `propose_note` tools return suggestions that appear as cards with a "Confirm & save" button. Nothing is written until the user confirms, and the confirmed save goes through the normal follow-up / note API under the user's own permissions.
- **WhatsApp templates:**
  - Each business enters its WhatsApp Business Account id, then "Sync from Meta" stores its approved templates (name, language, category, body, number of parameters).
  - The Send WhatsApp composer lets you pick a template, fill in its parameters with a live preview, and send it through the Cloud API. Templates work outside the 24-hour window.
- **Android:**
  - An Installments screen (list with an overdue filter, plan detail with the schedule, record payment with a retry-safe payment id).
  - An Assistant chat with suggested follow-ups and notes that you confirm.
  - Both are new tiles on the More screen.
- **Demo data:** the demo agent now handles half of the published listings, so the agent page and team table have data.

### Database / APIs
- **New fields (all additive):** Transaction `campaignId`; Business `whatsapp.businessAccountId`, `whatsapp.templates[]` and `whatsapp.templatesSyncedAt`.
- `GET /dashboard/team`
- `GET /public/sites/:slug/agents/:id`
- `POST /whatsapp/templates/sync`
- `POST /whatsapp/send` accepts `template {name, language, params[]}`
- The assistant response now includes `proposals[]`.

### Tests
- Server: 6 new tests (`server/tests/followups8.test.ts`); 271 passed + 1 skipped in total.
- Web: 38. Flutter: 81. `flutter analyze` clean; web build OK.

## What is left
Every item of the brief and the follow-ups is implemented. Live use of WhatsApp Business and the AI assistant needs the credentials listed above; device testing of the Android screens is still to be done on real phones.

- **Remaining ideas (not in the brief):** assistant proposals for deal updates; per-agent public profile photos; scheduled campaign spend import from bank statements.
