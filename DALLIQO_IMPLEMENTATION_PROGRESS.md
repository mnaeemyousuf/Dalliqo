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

## Next phases (planned order)
- **Phase 4 follow-ups:** role-specific dashboards (branch/sales/finance), co-owner and listing-agent pickers in the forms (API ready), verification screens on Android (status shown today).
- **Phase 6:** public listing pages + inquiry → lead automation, campaigns and ROI, agent/agency landing pages, client & owner portals, email notifications, WhatsApp Business integration.
- **Phase 7:** AI layer (permission-aware assistant, descriptions, summaries, forecasting, indicative pricing — clearly labelled estimates).
