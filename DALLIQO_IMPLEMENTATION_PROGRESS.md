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

## Next phases (planned order)
- **Phase 4:** property verification workflow (document checklist, verification officer, approve/reject, CNIC restricted access), multiple owners/agents pickers, Android property form for Pakistan attributes, map discovery, property QR codes + bulk import, saved views, role presets (Branch/Sales/Finance managers, Verification Officer), role dashboards, deal approval workflow.
- **Phase 5:** rental management (tenants, leases, rent schedules, late fees, inspections), installment plans, receipts/vouchers, receivables/payables aging, cash flow, commission lifecycle (approved → distributed), external dealer/referral shares, agent statements.
- **Phase 6:** public listing pages + inquiry → lead automation, campaigns and ROI, agent/agency landing pages, client & owner portals, email notifications, WhatsApp Business integration.
- **Phase 7:** AI layer (permission-aware assistant, descriptions, summaries, forecasting, indicative pricing — clearly labelled estimates).
