# REST API

Base path `/api`. JSON only. Authenticated routes need `Authorization: Bearer <accessToken>`.
Mobile clients send `X-Client-Type: mobile` on auth routes (see [Authentication.md](Authentication.md)).

## Conventions

**Success**
```json
{ "success": true, "data": {}, "message": "Property created successfully", "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }
```
**Error** — never contains stack traces
```json
{ "success": false, "code": "PROPERTY_NOT_FOUND", "message": "Property not found", "details": [{ "path": "askingPrice", "message": "..." }] }
```

| Status | Used for |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_ID`, `INVALID_RESET_TOKEN` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` (→ refresh), `INVALID_TOKEN`, `SESSION_REVOKED`, `INVALID_CREDENTIALS`, `REFRESH_TOKEN_REUSED` |
| 403 | `FORBIDDEN` (missing permission), `PASSWORD_CHANGE_REQUIRED`, `NO_ACTIVE_MEMBERSHIP`, `CANNOT_MODIFY_OWNER` |
| 404 | resource not found **or belongs to another business** (no existence oracle) |
| 409 | `EMAIL_IN_USE`, `DUPLICATE_KEY`, `VERSION_CONFLICT` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` |

**Lists**: `?page=1&limit=20` (max 100), `sort=-updatedAt`, filters as query params. Large or
infinite-scroll lists also accept `?cursor=<opaque>` (keyset on `(sortField,_id)`) and return
`meta.nextCursor`. **Writes** to sync-base entities accept `If-Match: <version>` (or `baseVersion` in
the body) and return the new `version`.

## Phase 1 — implemented ✅

| Method | Path | Auth / permission | Notes |
|---|---|---|---|
| GET | `/health` | public | DB connectivity |
| POST | `/auth/register` | public, rate-limited | creates user + business + OWNER membership (transaction) |
| POST | `/auth/login` | public, rate-limited | lockout after 5 failures / 15 min |
| POST | `/auth/refresh` | refresh token (body for mobile, cookie for web) | rotates; reuse ⇒ session revoked |
| POST | `/auth/logout` | refresh token or bearer | revokes this session |
| POST | `/auth/logout-all` | bearer | revokes every session, disconnects sockets |
| POST | `/auth/forgot-password` | public, rate-limited | always 200 |
| POST | `/auth/reset-password` | reset token | single use; signs out all devices |
| POST | `/auth/change-password` | bearer (allowed with temporary password) | signs out other devices |
| GET | `/auth/me` | bearer | user, business, role, effective permissions |
| PATCH | `/auth/me` | bearer | fullName, mobileNumber, preferences.language/theme |
| GET | `/auth/sessions` | bearer | active devices, `current` flag |
| DELETE | `/auth/sessions/:id` | bearer | sign out one device |
| GET | `/business` | bearer | current business |
| PATCH | `/business` | `business:manage` | audited |
| GET | `/members` | `members:read` | `?status=` |
| POST | `/members` | `members:manage` | adds a user with a temporary password |
| GET | `/members/:id` | `members:read` | |
| PATCH | `/members/:id` | `members:manage` | `role`, `permissions[]`, `status` ACTIVE/SUSPENDED |
| DELETE | `/members/:id` | `members:manage` | soft remove + revoke sessions |
| POST | `/members/:id/reset-password` | `members:manage` | owner sets a new temporary password |
| GET | `/audit-logs` | `audit:read` | `?entityType&entityId&actorUserId&action&from&to` |
| GET | `/meta/permissions` | bearer | permission catalogue & assignable roles |

### Example: register (mobile)
```http
POST /api/auth/register
X-Client-Type: mobile
Content-Type: application/json

{ "fullName": "Muhammad Yousuf", "email": "m.yousuf@example.com", "password": "Father123",
  "mobileNumber": "0300-1234567", "businessName": "Yousuf Estate", "deviceName": "Pixel 8" }
```
```json
{ "success": true, "message": "Account created successfully",
  "data": { "user": { "_id": "…", "email": "m.yousuf@example.com", "mobileNumber": "+923001234567", "mustChangePassword": false, "preferences": { "language": "en", "theme": "system" } },
            "business": { "_id": "…", "name": "Yousuf Estate", "currency": "PKR", "timezone": "Asia/Karachi" },
            "membership": { "_id": "…", "role": "OWNER", "permissions": ["clients:read", "…"] },
            "accessToken": "eyJ…", "accessTokenExpiresIn": 900,
            "refreshToken": "…", "refreshTokenExpiresAt": "2026-11-10T…" } }
```

## CRM modules — implemented ✅

### Clients & categories
| Method | Path | Permission |
|---|---|---|
| GET | `/client-categories` · POST · PATCH `/:id` (rename; `archived: true` archives a custom category — built-ins cannot be archived) | read: `clients:read`; write: `settings:manage` |
| GET | `/clients?q&categoryId&status&priority&assignedTo&area&society&propertyType&minBudget&maxBudget&purpose&page&limit&cursor&sort` | `clients:read` |
| POST | `/clients` (with optional `requirements[]`) | `clients:create` |
| GET/PATCH/DELETE | `/clients/:id` | read / `clients:update` / `clients:delete` |
| GET/POST | `/clients/:id/requirements` · PATCH/DELETE `/clients/:id/requirements/:reqId` | `clients:update` |
| POST | `/clients/:id/communications` `{channel: CALL|WHATSAPP|SMS|EMAIL}` — logs one-tap contact | `clients:update` |
| GET | `/clients/:id/matches` · `/clients/:id/followups` · `/clients/:id/activities` | read perms |
| GET/POST/PATCH/DELETE | `/owners`, `/owners/:id`, `/owners/:id/properties` | `owners:*` |
| GET/POST | `/notes?entityType&entityId` · PATCH/DELETE `/notes/:id` | `notes:create`; others' notes need `notes:manage_all` |
| GET | `/activities?entityType&entityId` | read perm of the entity |

### Properties, media, documents, maps
| Method | Path | Permission |
|---|---|---|
| GET | `/properties?q&propertyId&type&status&purpose&area&society&block&minPrice&maxPrice&minSize&maxSize&sizeUnit&ownerId&near=lat,lng&radiusKm` | `properties:read` |
| POST | `/properties` → generates `RE-000001` | `properties:create` |
| GET/PATCH/DELETE | `/properties/:id` | |
| POST | `/properties/:id/status` `{status, reason}` → activity + audit + `property.statusChanged` | `properties:update` |
| GET/POST | `/properties/:id/media` (multipart `files`, up to 10; images compressed + thumbnailed) · PATCH `/media/:id` `{sortOrder, setCover}` · DELETE `/media/:id` | `properties:update` |
| POST | `/documents` (alias `/uploads`): multipart `file` + `entityType`, `entityId`, `category`; magic-byte type check, size limits | `documents:upload` |
| GET | `/documents?entityType&entityId&category` · PATCH `/documents/:id` (rename/category) · DELETE | `documents:*` |
| GET | `/documents/:id/download` → short-lived signed URL for private documents | `documents:read` |

### Matching
`GET /matches?clientId&propertyId&minScore&band&status&includeStale` · `GET /clients/:id/matches` · `GET /properties/:id/matches` · `PATCH /matches/:id {status}` ·
`POST /matches/recalculate {clientId? | propertyId? | all}` (`matches:manage`) ·
`GET/PATCH /settings` (matching weights/thresholds, marla size, reminder default; `settings:manage`). Changing weights recalculates every match.

### Follow-ups, notifications, My Day
`GET /followups?assignedTo&status&type&from&to&clientId` · `POST /followups` · `PATCH /followups/:id` ·
`POST /followups/:id/complete {outcome}` · `GET /my-day` · `GET /notifications?category&unread` ·
`POST /notifications/:id/read` · `POST /notifications/read-all` · `POST /devices` / `DELETE /devices/:token` (FCM tokens).

### Sync — see [OfflineSync.md](../architecture/OfflineSync.md)
`POST /sync/push {mutations[]}` · `GET /sync/pull?cursor&entities` · `GET /sync/bootstrap` (first install / restore).

### Dashboard, search, reports, export
`GET /dashboard` (counts computed with `$facet` aggregations, cached ~30 s per business) ·
`GET /dashboard/analytics?range=7d|30d|12m` · `GET /search?q=&types=clients,properties,owners,matches` ·
`GET /exports/:resource?format=xlsx|pdf&<list filters>` streams the file (filters validated with the list schema).

## Phase 2 modules — implemented ✅

All new endpoints follow the conventions above: tenant-scoped, branch-scoped (see Branches), Zod-validated, audited,
and every write emits a socket event. Offline writes for deals, transactions and agreements go through `POST /sync/push`
with exactly the same validation.

### Client search additions (A1)
`GET /clients?block=<text>&minSize&maxSize&sizeUnit=SQ_FT|SQ_YARD|SQ_METER|MARLA|KANAL` — block matches the preferred block or any
requirement block; size matches requirements whose range overlaps the given range (converted to sq ft).

### Devices & reminders (A3)
`POST /devices {token, platform, localReminders: true}` — devices that schedule follow-up reminders locally receive data-only
FCM messages (`type: FOLLOWUP_REMINDER`, `followUpId`) so the phone de-duplicates them against its own scheduled reminder.

### Branches (B4)
| Method | Path | Permission |
|---|---|---|
| GET | `/branches?includeArchived` (a branch-restricted member gets only their branches) | any member |
| POST · PATCH | `/branches` · `/branches/:id` `{name, nameUr, code, address, phone, archived}` | `branches:manage` |
| PATCH | `/members/:id {branchAccess: ALL\|SELECTED, branchIds[]}` | `members:manage` |

Header `X-Branch-Id: <id>` narrows any request to one of the caller's branches (never widens it). Records carry `branchId`;
creates default to: requested → selected → member's only branch → the default "Main Branch". Settings `matching.crossBranch`
(default `false`) lets matching cross branches. Migration `001-branches` created the default branch and back-filled records.

### Deals & commission (B1)
| Method | Path | Permission |
|---|---|---|
| GET | `/deals?q&stage&open&agentId&clientId&propertyId&commissionStatus&branchId&from&to&sort&page&limit` | `deals:read` (own deals only without `deals:read_all`) |
| POST | `/deals` → `DL-000001` (agents can only create deals they are on) | `deals:create` |
| GET · PATCH · DELETE | `/deals/:id` | `deals:read` · `deals:update` · `deals:delete` |
| POST | `/deals/:id/stage {stage, note, lostReason}` (lost needs a reason; history kept) | `deals:update` |
| POST · DELETE | `/deals/:id/payments` `{id?, side, amount, date, method, reference}` · `/deals/:id/payments/:paymentId` | `commissions:manage` |
| POST · PATCH | `/deals/:id/payouts` `{userId, amount, status}` · `/deals/:id/payouts/:payoutId` | `commissions:manage` |
| GET | `/reports/commissions?groupBy=month\|agent&from&to` | `deals:read` + `reports:read` |
Settings `commission.defaultBuyerPct`, `defaultSellerPct` (1 / 1) and `autoCreateIncome` (true).

### Income & expense (B2)
| Method | Path | Permission |
|---|---|---|
| GET | `/transactions?q&type&categoryId&method&dealId&branchId&from&to&page&limit` | `finance:read` |
| POST · PATCH · DELETE | `/transactions` · `/transactions/:id` (commission income → `409 TRANSACTION_MANAGED_BY_DEAL`) | `finance:create` · `finance:update` · `finance:delete` |
| GET · POST · PATCH | `/transaction-categories` · `/transaction-categories/:id` `{name, nameUr, type, archived}` (built-ins: archive only) | read · `finance:update` |
| GET | `/reports/finance?groupBy=month\|category&from&to` → `{rows[{key,label,labelUr,income,expense,net,count}], totals}` | `finance:read` + `reports:read` |
Receipts: `POST /documents` with `entityType: transaction`. Commission payments create one income entry each
(`sourceKey = deal:<id>:payment:<paymentId>`, unique); removing the payment removes it. Migration `002-finance-categories`.

### Agreements (B3)
| Method | Path | Permission |
|---|---|---|
| GET | `/agreements?q&status&kind&clientId&propertyId&dealId&expiringWithinDays&branchId&page&limit` | `agreements:read` |
| POST | `/agreements` → `AG-000001`, version 1 rendered from the template | `agreements:create` |
| GET · PATCH · DELETE | `/agreements/:id` (signed/expired/cancelled → `409 AGREEMENT_LOCKED`; signed cannot be deleted) | read · `agreements:update` · `agreements:delete` |
| POST | `/agreements/:id/render {templateId?}` → new version · `/agreements/:id/versions {body}` → hand-edited version | `agreements:update` |
| POST | `/agreements/:id/status {status, note, signedDocumentId}` (DRAFT→SENT→SIGNED→EXPIRED; CANCELLED) | `agreements:update` |
| GET | `/agreements/:id/pdf?version=n` (A4, Urdu right-to-left, lawyer-review note in every footer) | `agreements:read` |
| GET · POST · PATCH | `/agreement-templates?kind&language&includeArchived` · `/agreement-templates/:id` (built-ins: copy or archive) | read · `templates:manage` |
Rent agreements with an end date get follow-ups 30 and 7 days before it (re-planned on change, cancelled on cancel).
Signed copy: `POST /documents` with `entityType: agreement`. Migration `003-agreement-templates`.

### Brochures (B5)
`GET /properties/:id/brochure?format=pdf|png|text&lang=en|ur&hidePrice=true|false&agentId=` — `properties:read` + `exports:create`,
audited as `property.brochure_generated`. PDF (A4) or PNG (1080×1350) with the cover photo, details, the contact person and a
WhatsApp QR; `text` returns `{text, whatsappUrl}`. Only the asking price is ever printed (never minimum / expected price).

### Meta
`GET /meta/permissions` now also returns `permissionTemplates` (Member, Manager, Agent, Salesperson, Accountant, Viewer) — used by
the web and mobile user editors.

### Exports
`GET /exports/:resource` also accepts `deals`, `commissions`, `transactions`, `finance` (summary; `groupBy`) and `agreements`.

### Socket events
`branch.created|updated`, `deal.created|updated|deleted`, `transaction.created|updated|deleted`, `agreement.created|updated|deleted`
(web invalidates the matching queries; the app schedules a pull).
