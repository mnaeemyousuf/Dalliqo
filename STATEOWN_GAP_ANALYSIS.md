# Stateown — Gap Analysis (Business Operating System brief)

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
| 8 | Commission lifecycle (approved, distributed), external dealer / referral shares, statements | ✅ | ✅ | Phase 5B done |
| 9 | Installments, receipts/vouchers, receivables/payables aging, cash flow | ✅ | ✅ | Phase 5B done (Android: installments viewed on web for now) |
| 10 | Rental management (tenants, leases, rent schedules, late fees) | ❌ (rent agreements only) | ✅ **P5A** | Leases, schedules, partial payments, late fees, inspections, renewals, rent roll, reminders; maintenance expenses via finance |
| 11 | Public listings, inquiry → lead automation, campaigns/ROI, WhatsApp Business API | ✅ | ✅ | Phase 6 done |
| 12 | AI layer (assistant, descriptions, forecasting) | ✅ | ✅ | Phase 7 done (AI text needs an Anthropic key; forecast and price estimate need none) |
| 13 | Role dashboards, agent performance | 🟡 owner dashboard + team table | 🟡 | Lead/inventory reports added; per-role dashboards Phase 4 |
| 14 | Client / owner portals | ✅ | ✅ | Phase 6 done |
| 15 | Configurable automation rules | ❌ | ✅ **P3** | 6 rules, thresholds, on/off, de-duplicated alerts |
| 15 | Email / WhatsApp notifications | ✅ | ✅ | Phase 6 done |
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


## Re-audit against the full brief (15 Nov 2026)

Each section of the master brief was checked against the code (server, web, Android, tests). Status: ✅ done · 🟡 done with a stated limit.

| § | Area | Status | Where / notes |
|---|---|---|---|
| 3 | Lead sources (FB, IG, WhatsApp, Zameen, OLX, website, walk-in, phone, referral, other) | ✅ | `CLIENT_SOURCES` |
| 3 | Assignment and history, hot / warm / cold, scoring with reasons, response time, duplicates, lost reasons, aging, unassigned inbox, Excel import / export, saved views | ✅ | Phases 3–4 |
| 3 | Configurable assignment rules (listing agent, round-robin, by source) | ✅ | **New in this batch:** Marketing → Website → "Who gets new leads" |
| 4 | Pakistan property attributes, units, lifecycle, price history, floor price (restricted), expiry, verification reminders, aging, duplicates, co-owners, multiple agents, documents, bulk import, QR, brochure, timeline | ✅ | **New:** co-owner and agent pickers in the web form |
| 4 | Viewing history and inquiry history per property | ✅ | **New:** "Inquiries & viewings" tab |
| 5 | Verification workflow, CNIC restriction, sensitive documents, expiry reminders, disclaimer | ✅ | Phase 4 |
| 6 | Weighted, configurable matching with explanations, auto re-match, notifications, rejected tracking, favourites, map | ✅ | **New:** bedrooms, bathrooms, possession, construction and amenities as a "features" factor; favourites from the client portal |
| 7 | Pipeline, offers / counter-offers, checklist, close approval | ✅ | Phase 3–4; **final batch:** stages can be switched off, renamed (EN/UR) and re-weighted per business |
| 8 | Percentage / fixed, buyer / seller, rental fee, agent split, external dealer / referral / branch shares, lifecycle, statements, instalment receipts | ✅ | Phase 5B |
| 8 | Adjustments, disputes, payout approval history | ✅ | **New** |
| 9 | Income / expense, cash / bank (method), receipts, vouchers, receivables / payables, refunds, instalments, cash flow, income statement, profitability, branch-wise, aging | ✅ | **New:** refunds, payment vouchers, income statement by category and branch |
| 10 | Leases, schedules, partial payments, late fees, deposits, renewal / expiry, inspections, reminders | ✅ | Phase 5A |
| 10 | Maintenance expenses, tenant notices | ✅ | **New** |
| 11 | Public listings, inquiry → lead, campaigns / ROI, agent pages, WhatsApp Business, social sharing | ✅ | Phase 6 and follow-ups. **New:** Facebook / X / LinkedIn / WhatsApp / copy-link sharing |
| 12 | Permission-aware assistant, descriptions, briefs and follow-up suggestions, forecast, price estimate | 🟡 | Phase 7. The AI-written parts need `ANTHROPIC_API_KEY`. Provider abstraction lives in `aiClient`. |
| 12 | Listing quality check | ✅ | **New** (deterministic; works without a key) |
| 13 | Owner / branch / sales / agent / finance dashboards; agent performance with filters, Excel / PDF / print | ✅ | **New:** business overview with filters, full agent performance report (Excel / PDF), branch targets, printable income statement |
| 14 | Client portal: requirements, update preferences, matched properties, favourites, visit requests, documents, agent messaging | ✅ | **New** |
| 14 | Owner portal: properties, availability / price-change request, inquiries (first name), offers, agreements, statements, documents | ✅ | **New.** Agency switches control each item. |
| 15 | In-app, push, email, WhatsApp, reminders, configurable automation rules | ✅ | Phases 3, 5, 6 |
| 16 | Branches, branch scope, cross-branch matching, branch reports, branch targets, role templates, record-level permissions, tenant isolation | ✅ | **New:** branch targets and branch report |
| 17 | Offline-first Android with conflict-aware sync | ✅ | Earlier phases (version / baseVersion conflicts, sync status). Installments and assistant are online-only by design. |
| 18 | Responsive web, Urdu RTL, themes, PKR / CNIC / phone / DD/MM formatting | ✅ | |
| 19 | Auth, sessions, devices, rate limits, secure uploads, audit log with old / new values, sensitive-data protection | ✅ | Backups and monitoring are documented in `docs/deployment` (hosting-level). |
| 20 | Trial, plans, module entitlements, limits, billing history, usage | ✅ | Phase 3 |
| 8 | Custom commission rules | ✅ | **Second re-audit:** default rates by sale / rent and property type |
| 18 | Bulk actions on lists | ✅ | **Second re-audit:** assign, change status and delete on the client and property tables |
| 18 | Configurable currency and timezone | ✅ | **Cross-check (18 Nov):** amounts follow the business currency on the web, the phone and in server PDFs, exports and messages (PKR, INR, BDT, NPR and LKR keep lakh / crore; others are grouped in thousands). Web dates follow the business timezone. Report month boundaries stay on Karachi time, and amounts in words on agreements stay in rupees. |
| 19 | Data retention policies | ✅ | **Second re-audit:** per-business retention for the audit log and activity feed, purged daily |
| 20 | API access (Enterprise) | ✅ | **Second re-audit:** scoped API keys, hashed at rest, record endpoints only |
| 17 | Android has every web feature | ✅ | **Parity batch:** reports, marketing, verification, deal / lease / entry tools, bulk actions and administration added to the app (online screens), then saved views, lead filters, portal link management and WhatsApp Business sending. Every role template is tested against the phone menus. |
| 21 | Indexes, pagination, background jobs, efficient reports | ✅ | Aggregations only. Every new collection and field is indexed. |

## Cross-check against the full brief (18 Nov 2026)

Every API route was matched against the web and the Android code (232 routes), and every feature of the brief was matched against both apps and both prototypes. Gaps found and fixed:

| Where | Gap | Fix |
|---|---|---|
| Android | A plot added on the phone was never checked for duplicates (the server skips the check for records that arrive through sync) | Same rule as the server, run on the phone's data before saving: "already listed as RE-…, save anyway?" |
| Android | No "Recalculate all" for matches | Button on the Matches screen (managers only) |
| Android | Price history and "Available until" (listing expiry) not shown or editable | Price history on the property page; expiry date on the form and the page |
| Android | Matching weights and square feet per marla could only be changed on the web | Both in Administration → Business settings; the phone's size filters use the business's marla size |
| All | Currency was always written as PKR | Business currency everywhere (see § 18 above) |
| Prototypes | Web: lead aging report, favourites in the client portal. Mobile: marla / kanal units, minimum price, expiry, price history, matching weights, theme, lead aging | Added; the mobile screens are measured to fit the phone frame |

Checked and not a gap: deal offers, stage changes, payments, agreement versions and follow-up completion go through the offline sync on the phone instead of their own routes; the public site and the client and owner portals are web pages opened from a link on any device; WhatsApp webhooks are server-only.
