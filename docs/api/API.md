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
