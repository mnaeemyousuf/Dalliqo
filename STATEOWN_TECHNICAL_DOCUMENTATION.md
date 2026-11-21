# Stateown — Technical Documentation (Phase 3 additions)

The base architecture is documented in `docs/architecture`, `docs/api` and `docs/database`. This file covers what Phase 3 added.

## Record-level access

Notes, documents and timeline entries are only as visible as the record they belong to. `server/src/services/recordAccess.ts` holds the rules (the record type's read permission; deals limited to their agents without `deals:read_all`; installment and income/expense timeline entries need `finance:read`) and is used by the notes and documents endpoints, the activity feed and the offline sync download. Hidden records answer 404 so ids do not leak.

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

## Phase 7 — AI layer
| Concern | Where |
|---|---|
| Stage probabilities, weighted commission forecast, comparable-based price estimate | `shared/src/ai.ts` |
| Anthropic client: allowance, refusal fallbacks, usage metering, error mapping | `server/src/services/ai/aiClient.ts` (`aiClient.use(fake)` in tests) |
| Descriptions (allow-listed facts / template), lead brief (structured output / rules), forecast, price estimate | `server/src/services/ai/aiService.ts` |
| Assistant (manual tool loop, read-only, permission-filtered tools, cached system prompt) | `server/src/services/ai/assistantService.ts` |
| Routes and limits | `server/src/routes/aiRoutes.ts`, `aiLimiter` (20/min per user), entitlement `/ai → ai` |
| UI | `web/src/pages/AiPages.tsx`, `mobile/lib/features/ai/ai_actions.dart` |

Data sent to Anthropic: the user's question, and the records the tools return for it (names and phones of clients the user can already see, and listing facts). CNICs, owner details, plot numbers and minimum prices are never included.

## Follow-ups batch
| Concern | Where |
|---|---|
| Team leaderboard (one aggregate per collection, branch-scoped) | `server/src/services/teamDashboardService.ts` |
| Campaign spend = typed + booked expenses | `campaignService` (`withMetrics`), Transaction `campaignId` |
| Agent landing page | `websiteService.agent`, `PublicAgentPage` in `web/src/pages/PublicPages.tsx` |
| Assistant proposals (no writes) | `propose_follow_up` / `propose_note` in `assistantService.ts`; `ProposalCard` in `AiPages.tsx` |
| WhatsApp templates | `whatsappService.syncTemplates` and the `send` template branch |
| Role panels | `web/src/pages/RoleDashboards.tsx` |
| Android | `mobile/lib/features/finance/installment_screens.dart`, `mobile/lib/features/ai/assistant_screen.dart` |

## Gap-closing batch
| Concern | Where |
|---|---|
| Feature preferences in matching | `scoreFeatures` in `server/src/services/matching/scoring.ts` (rescaled over the factors that apply) |
| Payout approval, adjustments, disputes | `dealService.approvePayout / addAdjustment / setDispute`, `summarizeCommission` (adjustments) and the Dart mirror |
| Refunds | `transactionService.refund` (separate expense, `refundedAmount` via `$inc` in one transaction) |
| Vouchers, income statement, tenant-notice PDF | `financeReportService.voucherPdf / incomeStatement / noticePdf` |
| Performance, business overview, branch targets | `server/src/services/performanceService.ts`, `performanceExport.ts` (xlsx / pdf) |
| Lead assignment rules | `settingsService.pickAssignee` (atomic cursor), used by `leadIntakeService` |
| Portal self-service and agency switches | `portalService` (`updatePreferences`, `reactToMatch`, `requestVisit`, `ownerAvailability`, `document`, `getSettings / updateSettings`) |
| Listing quality | `aiService.listingQuality` |
| Web | `web/src/pages/OpsPages.tsx` (reports, refunds, vouchers, quality, interest, notices, maintenance, portal switches); `PublicPages.tsx` portal sections |

## Final batch — pipeline and AI providers
| Concern | Where |
|---|---|
| Pipeline model, normalisation, required stages, stage probabilities | `shared/src/pipeline.ts`; `forecastCommission(…, probability)` in `shared/src/ai.ts` |
| Storage / validation / partial merge | `Settings.dealPipeline`, `settingsService` (`effective`, `update`), `settingsUpdateSchema.dealPipeline` |
| Enforcement | `dealService.create` and `changeStage` (with `auto` for offer-driven moves) |
| Web | `web/src/lib/pipeline.ts` (`useDealPipeline`), `DealPipelineCard` in `OpsPages.tsx`, `DealPages.tsx` |
| Android | `DealPipeline` in `mobile/lib/core/commission/commission.dart`, `dealPipelineProvider` / `stageLabel` in `deal_screens.dart` |
| AI provider contract | `server/src/services/ai/providers/types.ts` (`AiProvider`: `generateJson`, `runTools`, usage reports) |
| Anthropic adapter | `server/src/services/ai/providers/anthropic.ts` |
| Registry / selection | `server/src/services/ai/providers/index.ts` (`AI_PROVIDERS`, `AI_PROVIDER` env) |
| Allowance and metering gateway | `server/src/services/ai/aiClient.ts` |

To add a provider: implement `AiProvider`, add it to `AI_PROVIDERS` and to the `AI_PROVIDER` enum in `server/src/config/env.ts`. No feature code changes.

## Second re-audit batch
| Concern | Where |
|---|---|
| API key rules (prefix, allowed permissions and paths) | `shared/src/apiKeys.ts` |
| API keys: model, create / revoke / resolve | `server/src/models/ApiKey.ts`, `server/src/services/apiKeyService.ts`, `server/src/routes/apiKeyRoutes.ts` |
| API key sign-in | `server/src/middleware/authenticate.ts` (tokens starting `so_live_`) |
| Bulk actions | `server/src/services/bulkService.ts` (loops the single-record services), `bulkClientSchema` / `bulkPropertySchema` |
| Commission rules | `defaultCommissionRates` in `shared/src/commission.ts`, used by `dealService.create` |
| Retention | `RetentionSettings` in `shared/src/leads.ts`, `server/src/services/retentionService.ts`, job `data-retention` |
| Web | `web/src/pages/AdminExtras.tsx` |

Using a key: send `Authorization: Bearer so_live_…` to the normal `/api` endpoints. Responses, validation and rate limits are the same as for signed-in users.

## Mobile "more" module (parity batch)
| Concern | Where |
|---|---|
| Building blocks: online loader, form sheet, share-a-download, stat cards, bars | `mobile/lib/features/more/online_kit.dart` |
| Reports | `mobile/lib/features/more/reports_screens.dart` |
| Marketing | `mobile/lib/features/more/marketing_screens.dart` |
| Administration | `mobile/lib/features/more/admin_more_screens.dart` |
| Record tools (property, deal, entry, lease, installment) and the verification queue | `mobile/lib/features/more/record_tools.dart` (`RecordToolsButton` in each detail app bar) |
| Bulk actions, new lease, new installment plan | `mobile/lib/features/more/list_tools.dart` |
| Routes | `/reports`, `/marketing`, `/administration`, `/verifications`, `/bulk` in `app_router.dart`; tiles in `home_shell.dart` |
| Text | `mm.*` keys in `mobile/assets/i18n/{en,ur}.json` |

These screens call the API directly (`apiClientProvider`) and are online-only; the offline store and sync engine are unchanged.

## Brand
The brand is generated: edit `shared/brand/stateown.tokens.json` (name, tagline, colours) or the mark in `tools/brand/build.mjs`, then run `node build.mjs` in `tools/brand`. It rewrites the logos, favicons, launcher icons, splash, `shared/src/brand.ts`, the web CSS variables and the Flutter tokens.

## Configuration
AI (optional): `AI_PROVIDER` (default `anthropic`), `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5-5`), `AI_MONTHLY_LIMIT` (default 3000).
WhatsApp Business (optional): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` (default v21.0). Email: `SMTP_*` (inquiry acknowledgements, notification copies).

| Variable | Purpose |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Comma-separated Stateown staff emails allowed to manage subscriptions |
| `VITE_MAP_TILES` / `VITE_MAP_ATTRIBUTION` | Optional map tile provider for the web map (default OpenStreetMap) |
