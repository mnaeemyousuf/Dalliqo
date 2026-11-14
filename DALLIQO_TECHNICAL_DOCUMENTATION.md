# Dalliqo — Technical Documentation (Phase 3 additions)

The base architecture is documented in `docs/architecture`, `docs/api` and `docs/database`. This file covers what Phase 3 added.

## Shared domain (`shared/src`)
- `leads.ts` — `scoreLead(input, settings, now)` returns `{ score 0–100, temperature, reasons[] }`. Seven factors (budget fit vs. inventory, location precision, property type, intent, engagement recency, follow-up history, buying timeline), each 0..1, weighted by normalised business weights. Reasons are codes the apps translate. `temperatureFor(score, thresholds)`.
- `plans.ts` — `PLANS` (modules + limits + list prices), `effectiveStatus()` (trial/period lapse by clock, 7-day grace), `entitlementsFor()`, `hasModule()`.
- `automation.ts` — rule catalogue (`AUTOMATION_RULES`) with units, bounds and defaults.
- `enums.ts` / `commission.ts` — property categories and Pakistan attributes, new statuses/stages, offers, checklist items.

## Server
| Concern | Where |
|---|---|
| Lead scoring, assignment, reports, Excel import | `services/leadService.ts` |
| Scoring hooks | `clientService` (create/update/communicate), `followUpService` (create/complete), `automationService.rescoreStaleLeads` (every 30 min) |
| Property attributes, duplicates, inventory report, floor redaction | `services/propertyService.ts`, `controllers/crmControllers.ts`, `services/syncService.ts` |
| Offers and checklist | `services/dealService.ts` (`addOffer`, `respondToOffer`, `setChecklistItem`; arrays also accepted through sync) |
| Plans | `services/subscriptionService.ts`, `middleware/entitlements.ts`, `routes/subscriptionRoutes.ts` |
| Automation | `services/automationService.ts`, `jobs/scheduler.ts` (`automation-rules` every 10 min, lock-protected) |
| Migration | `migrations/004-phase3.ts` (idempotent, runs at start-up) |

### Entitlement enforcement
`entitlementGuard` runs after authentication on every CRM prefix and on `/members`:
1. Maps the request path to modules (`MODULE_PREFIXES`) and rejects modules outside the plan with **403 MODULE_NOT_IN_PLAN**.
2. Rejects writes on an expired subscription with **402 SUBSCRIPTION_EXPIRED** (reads stay available; notifications/devices exempt).
Limits are checked where resources are created (`memberService.create`, `branchService.create`, media/document uploads) with **403 PLAN_LIMIT_REACHED**. Subscription state is cached for 30 s per business and invalidated on change.
Platform admins are the users whose email is in `PLATFORM_ADMIN_EMAILS`; only they can change plans (`/platform/*`). Owners can only request a change.

### Automation de-duplication
Each alert has a `dedupeKey` (rule + record + situation, e.g. `LEAD_INACTIVE:<id>:<lastContactedAt>`). `notificationService.notify` skips users who already have that key, and a partial unique index guarantees it under concurrency.

### Floor price protection
`minimumPrice` is removed from property list/detail responses and from `/sync/pull` unless the member holds `properties:view_floor_price`.

## Web
New components live in `web/src/pages/Phase3Pages.tsx` (LeadPanel, TemperatureBadge, LeadImportModal, LeadReportCard, PropertyExtraFields/Details, InventoryReportCard, NegotiationPanel, ChecklistPanel, SubscriptionSettings, AutomationSettings, PlatformPage). `useModule()` and `entitlements` in `store/auth.ts` hide modules outside the plan.

## Android
`features/clients/lead_score_card.dart`, `features/deals/negotiation_section.dart`; repository methods `addDealOffer`, `respondDealOffer`, `setDealChecklistItem` write full arrays through the offline outbox (server reconciles ids and actors).

## Phase 4 additions
| Concern | Where |
|---|---|
| Verification workflow | `services/verificationService.ts`, `shared/src/verification.ts` (checklist, sensitive categories, CNIC helpers) |
| Sensitive data | `mediaService` (`canSeeSensitive`: list filter, 404 on download, audited access), `ownerService.redactOwner` (API + sync), CNIC masked in audit |
| Property import, QR, saved views | `services/inventoryToolsService.ts`, `models/SavedView.ts` |
| Deal approval | `dealService.requestCloseApproval` / `decideApproval`; triggered inside `changeStage` so offline syncs are covered |
| Map | `web/src/components/domain/PropertyMap.tsx` (Leaflet, lazy-loaded chunk) |
| Migration | `migrations/005-phase4.ts` |

## Phase 5A — rentals
| Concern | Where |
|---|---|
| Schedule, allocation, late fee, summary maths | `shared/src/rentals.ts` |
| Lease lifecycle, payments, rent roll, scheduled refresh | `server/src/services/leaseService.ts`, `models/Lease.ts` |
| Alerts | `automationService.rentAlerts` (RENT_DUE, RENT_OVERDUE) |
| UI | `web/src/pages/RentalPages.tsx`, `mobile/lib/features/rentals/rental_screens.dart` |

## Phase 5B — installments & finance
| Concern | Where |
|---|---|
| Installment schedule, aging buckets, amount in words | `shared/src/installments.ts` |
| Commission split with outside shares, lifecycle | `shared/src/commission.ts` (mirrored in `mobile/lib/core/commission/commission.dart`) |
| Installment plans (create, pay, cancel, scheduled refresh) | `server/src/services/installmentService.ts`, `models/InstallmentPlan.ts` |
| Approve commission, pay outside share | `dealService.approveCommission`, `dealService.payExternal` |
| Cash flow, aging, agent statement (JSON/PDF), receipts (PDF) | `server/src/services/financeReportService.ts` |
| Alerts | `automationService.installmentAlerts` (INSTALLMENT_OVERDUE) |
| UI | `web/src/pages/InstallmentPages.tsx` (also the report cards and `ReceiptButton`), `DealPages.tsx` outside-shares card |

Payment allocation reuses the rental helpers (`allocatePayment`, `statusFor`). Installment items keep `lateFee: 0` so the same code applies. Receipts are generated on demand from the stored payment and never stored.

## Phase 6 — marketing, portals, WhatsApp
| Concern | Where |
|---|---|
| Channels, ROI maths, slugs, wa.me links | `shared/src/marketing.ts` |
| Inquiry → lead (match by phone, assign listing agent, call-back, notify, acknowledgement) | `server/src/services/leadIntakeService.ts` (`systemAuth` acts for the business owner) |
| Website settings, publishing, public listings (field allow-list `toPublic`) | `server/src/services/websiteService.ts` |
| Campaigns and ROI (computed from clients → won deals → received commission) | `server/src/services/campaignService.ts` |
| Portal links (SHA-256 token hash, expiry / revoke, own-record receipts) | `server/src/services/portalService.ts`, `models/PortalLink.ts` |
| WhatsApp Cloud API send, webhook verify / signature, inbound → lead | `server/src/services/whatsappService.ts` (raw body kept in `app.ts` for `/api/public/whatsapp`) |
| Email copies of notifications | `notificationService.emailCopies` (opt-in `preferences.emailNotifications`) |
| Routes | `server/src/routes/marketingRoutes.ts` (`marketingRoutes` signed in, `publicRoutes` at `/api/public`) |
| UI | `web/src/pages/MarketingPages.tsx`, `web/src/pages/PublicPages.tsx` (own axios instance, no auth), `mobile/lib/features/marketing/marketing_actions.dart` |

Public endpoints never take a business id from the caller: sites resolve by slug (website on, business active), portals by token hash, and webhooks by the Meta phone number id.

## Configuration
WhatsApp Business (optional): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` (default v21.0). Email: `SMTP_*` (inquiry acknowledgements, notification copies).

| Variable | Purpose |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Comma-separated Dalliqo staff emails allowed to manage subscriptions |
| `VITE_MAP_TILES` / `VITE_MAP_ATTRIBUTION` | Optional map tile provider for the web map (default OpenStreetMap) |
