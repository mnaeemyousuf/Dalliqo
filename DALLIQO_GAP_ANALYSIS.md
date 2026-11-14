# Dalliqo — Gap Analysis (Business Operating System brief)

Audit date: 13 Nov 2026 · Baseline: commit `4cb4f21` (Phase 2 + UI overhaul) · Stack: Node/Express/MongoDB API, React web admin, Flutter Android app (offline-first, outbox sync).

Legend: ✅ implemented · 🟡 partial · ❌ missing · **P3** = delivered in Phase 3 (this round).

## Existing foundation (already production-grade)

- Multi-tenant isolation (tenant guard plugin on every query, branch scoping), JWT sessions, device sessions, password reset, rate limiting, audit log with field diffs.
- Clients with multiple requirements, owners, properties with media/documents, weighted matching (score + reasons, notifications), follow-ups with reminders, My Day.
- Deals pipeline with stage history, commission (buyer/seller, % or fixed, agent shares, payments, payouts), income/expense with categories and reports, agreements with templates/versions/PDF.
- Branches, permission-based roles (presets), notifications (in-app, socket, FCM), Excel/PDF exports, brochures (PDF/PNG/WhatsApp text), English/Urdu RTL, light/dark.
- Android: offline create/update for all core entities, conflict detection ("keep mine / take server"), sync status, local reminders.

## Requirement matrix

| # | Area | Before | Now | Notes / remaining |
|---|------|--------|-----|-------------------|
| 3 | Lead sources (FB, IG, WhatsApp, Zameen, OLX, website, walk-in, phone, referral, other) | 🟡 generic SOCIAL/PORTAL | ✅ **P3** | Old values kept for existing records |
| 3 | Assignment / reassignment + history, unassigned inbox | 🟡 assignee only | ✅ **P3** | `POST /clients/:id/assign`, `assignmentHistory`, `?unassigned=true` |
| 3 | Hot/Warm/Cold, configurable lead scoring with explanation | ❌ | ✅ **P3** | `shared/src/leads.ts`, weights + thresholds in Settings |
| 3 | Response time, status history, lost reasons, conversion | ❌ | ✅ **P3** | `firstContactedAt`, `responseMinutes`, `statusHistory`, `lostReason` |
| 3 | Duplicate lead detection | ✅ | ✅ | Phone-number based (existing) |
| 3 | Lead aging / source / conversion reports | 🟡 analytics only | ✅ **P3** | `GET /reports/leads` |
| 3 | Bulk Excel import (with template) / export | 🟡 export only | ✅ **P3** | `POST /clients/import`, duplicates & invalid rows reported |
| 3 | Saved views | ❌ | ✅ **P4** | Private or team-shared, clients and properties |
| 4 | Residential/commercial/industrial/agricultural types, plots, files, warehouses | 🟡 9 types | ✅ **P3** | 17 types + category map |
| 4 | Marla/Kanal/Sq ft/Sq yd/Acre | 🟡 no acre | ✅ **P3** | Marla size configurable per business |
| 4 | Phase, sector, unit no., possession, development, construction, furnishing, facing, corner, main road, park facing | 🟡 society/block/street/plot | ✅ **P3** | Web form section + detail; Android shows via sync, form editing → Phase 4 |
| 4 | Lifecycle incl. under negotiation, on hold, expired | 🟡 | ✅ **P3** | Availability expiry date auto-expires listings |
| 4 | Price history, floor price restricted | 🟡 floor visible to all | ✅ **P3** | New permission `properties:view_floor_price`; redacted in API and sync |
| 4 | Duplicate property detection | ❌ | ✅ **P3** | Society + block/phase + plot/unit, normalised |
| 4 | Multiple owners / agents per property | ❌ | 🟡 **P3** | `coOwnerIds`, `agentIds` in API (import assigns the agent); form pickers pending |
| 4 | Inventory aging report | ❌ | ✅ **P3** | `GET /reports/inventory` |
| 4 | Viewing / inquiry history, QR codes, bulk property import | 🟡 visits via follow-ups | ✅ **P4** | QR PNG, Excel import with owner matching |
| 5 | Verification workflow (submit, assign, checklist, approve/reject, CNIC access control) | 🟡 availability re-confirm only | ✅ **P4** | Four-eyes approval, history, missing/expiring documents, disclaimer; Android shows status |
| 6 | Weighted matching, configurable weights, notifications, explanations | ✅ | ✅ | Bedrooms now trigger re-matching |
| 6 | Rejected tracking, favourites | 🟡 match statuses | 🟡 | Favourites → client portal phase |
| 6 | Interactive map discovery | 🟡 geo radius filter + pins on detail | ✅ **P4** | Map view of filtered listings (OSM, `VITE_MAP_TILES` configurable) |
| 7 | Extended pipeline (qualified, negotiation, payment) | 🟡 | ✅ **P3** | 11 stages |
| 7 | Offers / counter-offers with history | ❌ | ✅ **P3** | Auto-moves to Negotiation; accept sets agreed price |
| 7 | Closing checklist (configurable) | ❌ | ✅ **P3** | 10 defaults + custom items, who/when recorded |
| 7 | Token amount, initial asking price, cancellation reason | 🟡 | ✅ **P3** | |
| 7 | Approval workflows for deal changes | ❌ | ✅ **P4** | Close-won approval (optional setting) |
| 8 | Commission lifecycle (approved, distributed), external dealer / referral shares, statements | 🟡 | 🟡 | Phase 5 |
| 9 | Installments, receipts/vouchers, receivables/payables aging, cash flow | 🟡 income/expense | 🟡 | Phase 5 |
| 10 | Rental management (tenants, leases, rent schedules, late fees) | ❌ (rent agreements only) | ✅ **P5A** | Leases, schedules, partial payments, late fees, inspections, renewals, rent roll, reminders; maintenance expenses via finance |
| 11 | Public listings, inquiry → lead automation, campaigns/ROI, WhatsApp Business API | ❌ (brochures/share only) | 🟡 | Campaign attribution field added; rest Phase 6 (needs WhatsApp Business credentials) |
| 12 | AI layer (assistant, descriptions, forecasting) | ❌ | ❌ | Phase 7 (needs AI provider key; module `ai` reserved) |
| 13 | Role dashboards, agent performance | 🟡 owner dashboard + team table | 🟡 | Lead/inventory reports added; per-role dashboards Phase 4 |
| 14 | Client / owner portals | ❌ | ❌ | Phase 6 |
| 15 | Configurable automation rules | ❌ | ✅ **P3** | 6 rules, thresholds, on/off, de-duplicated alerts |
| 15 | Email / WhatsApp notifications | 🟡 email for auth | 🟡 | Phase 6 |
| 16 | Branch features, record-level permissions | ✅ | ✅ | |
| 16 | Named roles (Branch Manager, Finance Manager, Verification Officer…) | 🟡 templates | ✅ **P4** | 12 templates incl. all roles in the brief |
| 17 | Offline sync with conflicts, status visibility | ✅ | ✅ | Offers/checklist also work offline (**P3**) |
| 18 | Premium UI, RTL, dark mode, empty/loading states | ✅ | ✅ | |
| 19 | Security, audit, rate limit, file access | ✅ | ✅ | Floor price + plan enforcement added |
| 20 | Plans, trials, module entitlements, limits, billing history | ❌ | ✅ **P3** | Central enforcement; payment gateway needs credentials |
| 21 | Indexes, pagination, background jobs | ✅ | ✅ | New indexes for leads/expiry/agents |

## External dependencies (need credentials / decisions)

- **Payment gateway** (JazzCash / EasyPaisa / card): billing is recorded by platform admins today; online checkout needs merchant credentials.
- **WhatsApp Business API** (Meta Cloud API): template approval + phone number id + token.
- **AI provider** (Claude or other): API key, data-processing approval.
- **Maps** (OSM is free; Google Maps needs a key) and **email provider** (SMTP is configured; transactional templates pending).
