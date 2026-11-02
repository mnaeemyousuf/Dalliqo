# Dalliqo — Phase 2 Implementation Plan

Scope: close the review gaps (Part A), build the remaining future features (Part B) on backend, web and
mobile with full parity (Part C). Written after reading the code; it follows the existing conventions:
routes → controllers → services → repositories, tenant guard on every query, `shared/` as the single
source of permissions / enums / socket events, activity + audit on every write, offline outbox + idempotent
replay on mobile, exceljs / pdfkit exports.

Baseline before Phase 2 (25 Oct 2026): server **166 passed / 1 skipped**, web **25**, Flutter **39**, `flutter analyze` clean.

Order of work (one commit per phase, all suites after each): **A1–A3 → B4 → B1 → B2 → B3 → B5 → C (parity, docs)**.

---

## Part A — gaps

### A1 Client search by block and size
* `clientListQuery` + `ClientQuery`: `block`, `minSize`, `maxSize`, `sizeUnit` (default `SQ_YARD`, same as properties).
* `clientService.list`: `block` → regex on `preferredBlock` **or** `requirements.blocks`. Size → converted to sq ft with the
  business's `sqftPerUnit`; a client matches when **any** requirement's `[minSizeSqft, maxSizeSqft]` overlaps the requested range
  (open ends overlap), via `$elemMatch` so both bounds are tested on the same requirement.
* Index: `{ businessId, 'requirements.blocks': 1 }`; size uses the existing business-scoped scan plus `$elemMatch` on the embedded
  array (5,000-record perf test must stay green; a test for the new filters is added to it).
* Web: Block + Size min/max + unit in the Clients filter panel (URL state like the other filters).
* Mobile: `ClientFilter.block/minSize/maxSize/sizeUnit`, same semantics in `matches()` (offline), fields in the filter sheet.
* Tests: server (block, size overlap, unit conversion), web (filter panel sends params), `filters_test.dart`.

### A2 "Date added" on mobile
* Property, client and owner detail screens show **Date added** = `createdAt` in the user's locale.
  Offline-created rows already carry the local `createdAt` written by `LocalStore.create` until the server record replaces it.

### A3 Local reminders (no Firebase / no internet)
* New `ReminderScheduler` (pure Dart logic + a thin `flutter_local_notifications` adapter) using `zonedSchedule` with
  `timezone` (instants scheduled in `tz.UTC`, so the phone's zone setting cannot shift them).
* Desired set = follow-ups **assigned to me**, status `PENDING`, not deleted, reminder instant in the future
  (`reminderAt`, else `dueAt − default minutes from settings`). Diffed against the ids already scheduled (stored in `kv`) →
  schedule / re-schedule / cancel. Runs on: app start, after every sync pull/push, after local create/edit/reschedule/complete/
  cancel/delete (the database change stream for `followUps`).
* Notification id = stable 31-bit hash of the follow-up uuid; payload = `/followups/<id>` (deep link).
* Android: `RECEIVE_BOOT_COMPLETED` + the plugin's boot/scheduled receivers (schedules survive reboot), `SCHEDULE_EXACT_ALARM`
  with runtime request on Android 12+/14+; falls back to inexact-while-idle when the user refuses exact alarms.
* Dedupe with FCM: devices register `localReminders: true`; the server sends **data-only** reminder pushes carrying `followUpId`
  to those devices. The app's foreground and background handlers show it only if no local reminder exists for that follow-up
  (`ReminderScheduler.shouldShowPush`). Older devices keep the normal notification payload.
* Tests: scheduler diff logic, reminder-time rules, dedupe rule (fake plugin adapter).

---

## B4 Multi-branch (first, because everything else carries `branchId`)

**Model**
* `Branch` (tenant): `name`, `nameUr`, `code`, `address`, `phone`, `isDefault`, `archivedAt`, sync fields (pulled by mobile).
* `BusinessMember`: `branchAccess: 'ALL' | 'SELECTED'` (default `ALL`), `branchIds: ObjectId[]`.
* `branchId` (required after migration) on clients, owners, properties, follow-ups, deals, agreements, transactions;
  copied onto matches (client's branch), notes/documents are checked through their parent; activities carry `branchId` when known.
* Settings: `matching.crossBranch` (default **false**).

**Enforcement (server, not UI)**
* `TenantContext.branchIds?: string[]` — `undefined` = unrestricted. Resolved per request in `resolveAuthContext`:
  owner or `branchAccess: 'ALL'` → unrestricted; otherwise the member's branch ids.
* Optional header **`X-Branch-Id`** (web branch switcher / mobile branch switcher): narrows the scope to that branch; 403 if the
  user may not see it. Lists, dashboard, reports, exports and sync pull all follow it automatically.
* `createTenantRepository.scope()` adds `branchId: { $in }` whenever the context is branch-restricted and the model has a
  `branchId` path — one choke point for reads and writes. `dashboardService` / `matchingService` raw queries use the same
  `branchFilter(ctx)` helper.
* Creates: `branchId` from the input (must be allowed) → else the header branch → else the user's only branch → else the
  business's default branch. Follow-ups/deals/agreements default to their client's branch.
* Matching: candidates restricted to the same branch unless `matching.crossBranch`.

**Permissions**: `branches:read`, `branches:manage`. Templates: Owner (all); Manager `branches:read`; Agent/Accountant/Viewer
`branches:read`. Branch *visibility* is data scope (member assignment), not a permission.

**Migration** (`server/src/migrations/001-branches.ts`, run at API start and via `npm run migrate -w @recrm/server`):
for every business without a default branch create **"Main Branch"** (`isDefault`), then `updateMany({ branchId: { $exists: false } })`
per collection, and set `branchAccess: 'ALL'` on members missing it. Idempotent (re-running changes nothing) — covered by a test that
runs it twice. Existing users keep exactly today's access because every existing member gets `ALL`.

**UI**: web Settings → Branches (CRUD), member editor (branch access), header branch switcher (owner/multi-branch users), branch
column/filter; mobile branch switcher (More → branch), branches list (manage if permitted), member branch display.
Offline: branches pulled into the local store; local lists filter by the selected branch.

---

## B1 Commission management with deal pipeline

* `Deal` (tenant, syncable): `dealNo` (DL-000001), `title`, `clientId`, `propertyId`, `agents[{ userId, sharePct }]` (Σ = 100),
  `stage` ∈ `INQUIRY, SITE_VISIT, OFFER, TOKEN, AGREEMENT, TRANSFER, CLOSED_WON, CLOSED_LOST`, `lostReason`, `stageHistory[{ stage,
  at, by, note }]`, `agreedPrice`, `finalPrice`, `expectedCloseDate`, `closedAt`, `branchId`, `notes`.
* Commission (embedded on the deal so it is created/edited/synced offline as one unit):
  `commission.buyer` / `commission.seller` = `{ mode: 'PERCENT' | 'FIXED', value, expected }` (expected computed from final/agreed price),
  `payments[{ _id(uuid), side, amount, date, method, reference, notes, transactionId }]`, `payouts[{ _id(uuid), userId, amount, date,
  status: PENDING|PAID }]`, derived `expectedTotal`, `receivedTotal`, `outstanding`, `status` (PENDING / PARTIALLY_RECEIVED / RECEIVED).
* Settings: `commission.defaultBuyerPct`, `defaultSellerPct`, `autoCreateIncome` (default true).
* Endpoints: `GET/POST /deals`, `GET/PATCH/DELETE /deals/:id`, `POST /deals/:id/stage`, `POST /deals/:id/payments`,
  `DELETE /deals/:id/payments/:paymentId`, `POST /deals/:id/payouts`, `PATCH /deals/:id/payouts/:payoutId`,
  `GET /reports/commissions?groupBy=month|agent&from&to`.
* Permissions: `deals:read`, `deals:read_all`, `deals:create`, `deals:update`, `deals:delete`, `commissions:manage` (payments/payouts).
  Without `deals:read_all` a user only sees deals where they are an agent (server filter).
  Templates — Owner all; Manager all; Agent read/create/update (own only); Accountant read + read_all + commissions:manage;
  Viewer read + read_all.
* Activity `DEAL_*`, audit `deal.*`, sockets `deal.created|updated|deleted`, dashboard tiles (open deals, commission received this
  month, outstanding), Excel/PDF exports `deals`, `commissions`.

## B2 Income & expense

* `Transaction` (tenant, syncable): `type` INCOME/EXPENSE, `categoryId`, `amount`, `date`, `method`
  (CASH, BANK_TRANSFER, CHEQUE, JAZZCASH, EASYPAISA, OTHER), `dealId`, `propertyId`, `clientId`, `description`, `reference`,
  `source` (MANUAL | COMMISSION), `sourceKey` (unique per business → commission income is never duplicated), `branchId`.
* `TransactionCategory` (tenant, syncable; built-ins seeded per business with Urdu names; custom allowed; archive).
* Receipts: documents with `entityType: 'transaction'` (existing private storage + signed URLs).
* Commission payment → income transaction automatically (`sourceKey = deal:<id>:payment:<paymentId>`); deleting the payment
  deletes its transaction.
* `GET /reports/finance?from&to&groupBy=month|category` (income, expense, net, by category).
* Permissions `finance:read`, `finance:create`, `finance:update`, `finance:delete` (Owner all; Manager all; Accountant all;
  Agent none; Viewer read).

## B3 Agreements

* `AgreementTemplate` (tenant, syncable): `name`, `kind` SALE/RENT/TOKEN_RECEIPT/OTHER, `language` en/ur, `body` (paragraph
  text with `{{placeholders}}`), `builtIn`, `archivedAt`. Built-ins seeded (EN + UR for each kind).
* `Agreement` (tenant, syncable): `agreementNo` (AG-000001), `templateId`, `kind`, `language`, `title`, `dealId`, `clientId`,
  `ownerId`, `propertyId`, `amount`, `tokenAmount`, `monthlyRent`, `securityDeposit`, `startDate`, `endDate`, `status`
  DRAFT/SENT/SIGNED/EXPIRED/CANCELLED, `versions[{ no, body, createdAt, createdBy }]` (rendered text snapshot), `signedDocumentId`,
  `renewalFollowUps` (ids), `branchId`.
* `POST /agreements/:id/render` (fills placeholders → new version), `GET /agreements/:id/pdf?version=` (pdfkit; Urdu with the bundled
  Naskh font and RTL line wrapping), signed copy via `POST /documents` (`entityType: 'agreement'`), status endpoint.
* Rent agreements with `endDate`: follow-ups auto-created 30 and 7 days before (re-created when dates change, cancelled when
  agreement cancelled) → they also fire as local reminders (A3).
* Lawyer-review disclaimer on every screen and in every PDF footer.
* Permissions `agreements:read|create|update|delete`, `templates:manage`. Owner all; Manager all; Agent read/create/update;
  Accountant read; Viewer read.

## B5 Brochures

* `GET /properties/:id/brochure?format=pdf|png&lang=en|ur&hidePrice=true|false&agentId=`.
  PDF (pdfkit): cover photo, details table, description, agency name/logo, agent contact, QR to `https://wa.me/<agent>`.
  PNG 1080×1350 (sharp composite of an SVG whose text is converted to vector paths with **fontkit** — the same shaping engine as
  the PDFs, so Urdu renders correctly without system fonts). QR via the `qrcode` package.
* Never prints `minimumPrice` / `expectedFinalPrice`; `hidePrice` hides the asking price.
* Permission: `properties:read` + `exports:create`. Audit `property.brochure_generated`.
* Web: brochure dialog (language, hide price, agent) → download PDF / PNG, copy share text. Mobile: same options → generate
  (needs internet; says so) → share to WhatsApp / share sheet.

---

## Part C — parity, realtime, performance

* `docs/PARITY_MATRIX.md`: every feature → web screen → mobile screen → endpoint → tests. Existing gaps found while reading:
  mobile member management (read-only today), client-category management, matching/reminder settings — closed in Part C.
* New mobile data-entry modules (deals, transactions, agreements, templates, branches) use the outbox; push/pull entity lists
  extended on both ends; protected fields for conflicts: deal `stage`, commission payments, agreement `status`, transaction `amount`.
* Socket events for every new entity; web invalidates queries, mobile schedules a pull.
* Perf benchmark extended with deals / transactions / agreements (5,000 each) list + report timings.

## Test plan (per phase)
server Jest: CRUD, validation, permissions (each template), tenant isolation (two businesses), branch isolation (two branches,
header narrowing, 403 outside scope), migration idempotency, sync push/pull for new entities, report maths, PDF/PNG smoke tests.
Web Vitest: filter panels, forms, pages render. Flutter: filter logic, reminder scheduler, commission maths, model parsing,
widget tests for new forms. `flutter analyze` must stay clean.

## Assumptions (stated, safest option chosen)
1. Existing members get `branchAccess: 'ALL'` (identical access). New members default to `ALL` unless branches are chosen.
2. Records whose branch changes leave the devices of users who can no longer see that branch at their next full re-sync
   (pull is cursor-based); documented as a limitation.
3. Commission percentages are of `finalPrice` (fallback `agreedPrice`); amounts are whole rupees (as everywhere else).
4. Template placeholders are plain `{{path}}` tokens; no conditional logic.
5. No Android SDK on this machine (checked): APK build reported as BLOCKED; device-only behaviour listed in `docs/DEVICE_TEST_SCRIPT.md`.
