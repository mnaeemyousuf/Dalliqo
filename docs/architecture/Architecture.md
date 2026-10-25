# Architecture

Status legend: **✅ built & tested**. Everything in this document is implemented except the future-feature extension points in §6.

## 1. System overview

```text
 ┌──────────────────────┐        ┌──────────────────────┐
 │ Flutter mobile app   │        │ React web CRM        │
 │ (primary, offline-   │        │ (admin / desktop,    │
 │  first, sqflite DB)  │        │  online-only)        │
 └─────────┬────────────┘        └─────────┬────────────┘
           │ REST (JSON, Bearer JWT)       │ REST + httpOnly refresh cookie
           │ Socket.IO (change notices)    │ Socket.IO
           ▼                               ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Node.js + Express API  (single source of business rules)│
 │  routes → controllers → services → repositories → Mongo │
 │  domain event bus ─► Socket.IO gateway, dashboard cache │
 │  services ─► matching engine, notifications → FCM       │
 │  jobs: follow-up reminders, overdue sweep (lease lock)  │
 └──────┬───────────────────────┬──────────────────┬───────┘
        ▼                       ▼                  ▼
   MongoDB (replica set)   Cloudinary / disk    Firebase (FCM)
```

The mobile app is the primary business tool and must work offline. The web app is a richer,
online-only admin/CRM console. **Both are thin clients over the same API**: no business rule
(matching, permissions, status transitions, ID generation, audit) is implemented in a client.
Clients validate input only for UX; the API's Zod schemas are authoritative.

## 2. Backend layering ✅

```text
server/src/
├── config/        env (Zod-validated at boot), logger (pino, secrets redacted), database
├── routes/        URL → middleware chain (auth, permission, validation) → controller
├── controllers/   HTTP only: read req, call one service method, shape the response
├── services/      business rules, transactions, audit, domain events
├── repositories/  the only code that touches Mongoose; every tenant method takes a TenantContext
├── models/        Mongoose schemas + indexes; plugins/tenant.ts (tenant guard)
├── validators/    Zod schemas per resource
├── middleware/    authenticate, requirePermission, validate, rate limits, error handler
├── sockets/       Socket.IO gateway (auth handshake, rooms, event fan-out)
├── jobs/          scheduled work (follow-up reminders, overdue sweep) with a MongoDB lease lock
├── utils/         AppError, http helpers, crypto, phone normalisation, diff, event bus
├── types/         AuthContext / TenantContext, Express augmentation
├── constants/     server-only constants (cookie name, JWT claims, upload MIME allow-lists) + re-export of @recrm/shared
└── app.ts / server.ts
```

Rules enforced by convention and review:

* Controllers never import models or repositories.
* Services never touch `req`/`res`.
* Repositories never accept a tenant query without a `TenantContext`.
* All responses use `{ success, data, message?, meta? }` / `{ success:false, code, message, details? }`.

### Multi-tenancy — three layers of defence ✅

1. **Identity**: the access token carries `bid` (businessId) and the membership is re-verified
   on every request (`authContextService.resolveAuthContext`).
2. **Repositories**: every tenant query is built as `{ ...filter, businessId: ctx.businessId }`.
   Lookups by id use `findOne({ _id, businessId })`, so a foreign id yields 404, not 403
   (no existence oracle).
3. **Tenant guard plugin** (`models/plugins/tenant.ts`): any find/update/delete/count/aggregate
   on a tenant collection without a `businessId` filter **throws before reaching MongoDB**.
   The one legitimate cross-tenant lookup (memberships at sign-in) opts out explicitly.

Tests: `tests/tenancy.test.ts`.

### Domain events ✅

Services publish `DomainEvent`s on an in-process bus **after** the write commits. Subscribers
(Socket.IO gateway now; notifications, matching and sync bookkeeping later) never run inside the
request's transaction and can't fail it. When the API scales beyond one node, the bus is swapped for
Redis pub/sub (and Socket.IO gets `@socket.io/redis-adapter`) without touching services.

## 3. Real-time (Socket.IO) architecture

| Aspect | Design |
|---|---|
| Auth | `io(url, { auth: { token: <accessToken> } })`; the same `resolveAuthContext` as HTTP. Temporary-password users are refused. ✅ |
| Rooms | `business:<businessId>` (all members) and `user:<userId>` (targeted). ✅ |
| Payload | A **change notice**, not a record: `{ entity, id, version, actorUserId, at, data? }`. Clients re-fetch through REST (web: invalidate TanStack Query keys) or pull a delta (mobile sync engine). This keeps permission checks and field-level filtering on the normal request path. ✅ |
| Revocation | `session.revoked` is sent to the affected sockets, which are then disconnected (logout-all, password reset, member suspended/removed). ✅ |
| Token expiry | Client refreshes the access token, then reconnects with the new token. |
| Echo | Clients ignore notices where `actorUserId` is themselves *and* they already hold that `version`. |

Event catalogue (`shared/src/socketEvents.ts`):

| Event | Emitted when | Status |
|---|---|---|
| `business.updated`, `member.created`, `member.updated`, `session.revoked` | account admin | ✅ |
| `client.created/updated/deleted` | client CRUD | ✅ |
| `owner.created/updated` | owner CRUD | ✅ |
| `property.created/updated/deleted`, `property.statusChanged` | property CRUD / status | ✅ |
| `match.created` | matching engine stores a new match ≥ store threshold | ✅ |
| `followup.created/updated/completed` | follow-ups | ✅ |
| `notification.created` | to `user:<id>` room only | ✅ |

## 4. Flutter architecture ✅

**State management: Riverpod 3** (plain providers and `StateNotifier`s via `flutter_riverpod/legacy.dart`,
no code generation, so the app builds with a bare `flutter pub get`). Navigation: GoRouter with
auth-aware redirects and a `StatefulShellRoute` bottom-navigation shell. Local DB: **sqflite (SQLite)**
with a generic `records` table (entity, uuid, server id, version, JSON data, sync status), an
`outbox`, `conflicts` and a key/value cache; a per-entity change stream notifies screens. HTTP: Dio
with a single-flight refresh interceptor. Tokens and the app-lock PIN hash: `flutter_secure_storage`.

```text
mobile/lib/
├── main.dart, app.dart          bootstrap, lifecycle (app lock, resume sync), MaterialApp.router
├── core/
│   ├── config/env.dart          API_BASE_URL (--dart-define)
│   ├── models/models.dart       domain entities (Client, Property, Owner, FollowUp, Note, Match …)
│   ├── database/                sqflite: records · outbox · conflicts · kv
│   ├── sync/                    LocalStore (offline writes + outbox) · SyncEngine (push / pull / conflicts)
│   ├── network/api_client.dart  Dio, single-flight refresh, error-code mapping
│   ├── realtime/                Socket.IO change notices → sync pull
│   ├── notifications/           FCM + local notifications, deep links
│   ├── storage/                 secure storage: tokens, PIN hash, biometric flag
│   ├── l10n/ theme/ router/     en.json / ur.json + RTL, Material 3 light/dark, GoRouter guards
│   ├── providers.dart           app-wide providers (database, API, sync engine, preferences)
│   └── widgets/                 design system: AppButton, AppTextField, AppCard, AppChip, AppDialog
│                                (confirmDialog / promptText), AppBottomSheet, AppLoader, AppEmptyState,
│                                AppErrorState; domain widgets PropertyCard, ClientCard, MatchCard, FollowUpCard
├── data/repositories.dart       CrmRepository (offline, local DB) + OnlineRepository (server-computed data)
└── features/<feature>/          auth · home · dashboard (My Day) · clients · properties · owners · matches ·
                                 followups · notifications · settings (+ sync centre) · common panels
```

How the clean-architecture layers map onto the folders:

| Layer | Where |
|---|---|
| Presentation | `features/*/…_screens.dart`, `core/widgets/` |
| Application | Riverpod providers / notifiers (`features/auth/auth_controller.dart`, `core/providers.dart`, feature providers), `SyncEngine` |
| Domain | `core/models/` (entities with derived rules, e.g. locally derived *Overdue*) — business rules themselves live in the API |
| Data | `data/repositories.dart`, `core/database/`, `core/sync/local_store.dart`, `core/network/` |
| Core | `core/config`, `l10n`, `theme`, `router`, `storage`, `realtime`, `notifications` |

Layers are folders rather than per-feature sub-packages because the app holds no business logic of
its own (the spec keeps it in the API); a feature is a few screens over the shared repositories.

Data flow: **UI → repository → local DB (source of truth for the UI) → outbox → sync engine → API**.
Screens re-query when the entity's change stream fires, so local writes and pulled remote changes
render identically. See [OfflineSync.md](OfflineSync.md).

## 5. React web architecture ✅

Vite + React 18 + TypeScript, React Router, **TanStack Query** for all server state,
**Zustand** for session/UI state only, Tailwind CSS with an in-house component library,
**ECharts** (tree-shaken) for analytics, Axios, socket.io-client, i18next with `en.json`/`ur.json` and
`dir="rtl"` switching. Pages are lazy-loaded chunks.

```text
web/src/
├── App.tsx, main.tsx  router (lazy pages), providers, error boundary
├── layout/            AppLayout: sidebar, top bar (global search, language, theme, live status)
├── api/               axios client (access token in memory, cookie refresh, single-flight), typed endpoints
├── realtime/          socket → queryClient.invalidateQueries by entity
├── store/             auth (session, permissions), ui (theme, language), toast
├── components/ui/     Button, Input, Select, Textarea, DatePicker, Modal, Drawer, ConfirmDialog, Dropdown,
│                      Tabs, Table, DataTable, Pagination, Card, Badge, EmptyState, ErrorState
├── components/domain/ PropertyCard, ClientCard, MatchCard, badges; panels: Notes, Activity, Documents
│                      (upload / preview / share / rename / delete), Follow-ups
├── pages/             Auth, Dashboard (+ My Day, analytics), Clients, Properties, Owners, Matches,
│                      Follow-ups, Documents, Reports/exports, Users & permissions, Notifications, Audit, Settings
├── i18n/              en.json, ur.json
└── lib/               formatting (PKR crore/lakh), hooks (debounce, URL state, enum options)
```

**Large lists.** Every table is server-paginated (`?page=&limit=`, the API caps `limit` at 100) with
debounced search and indexed filters, so a page never renders more than 100 rows and row
virtualization isn't needed. If a future screen needs to show more rows at once, `DataTable` is the
single place to add it.

The access token lives **in memory only**; on reload the app calls `POST /api/auth/refresh`, which
uses the httpOnly, `SameSite=Strict`, `Path=/api/auth` cookie. No token is ever in `localStorage`.

## 6. Extension points for future features

These are **not** implemented; the architecture reserves room for them:

| Future feature | Where it plugs in |
|---|---|
| Commission management, income & expense | New `deals`, `commissions`, `transactions` tenant collections referencing `propertyId`/`clientId`; new permissions group `finance:*`; ACCOUNTANT role preset already exists. |
| Agreements / contracts | `documents` already support categories `AGREEMENT`; a `contracts` collection adds lifecycle (draft → signed). |
| Multiple staff, more roles | Roles are permission presets (`shared/src/roles.ts`); enabling a role = adding it to `ASSIGNABLE_ROLES`. |
| Multi-branch | Optional `branchId` on tenant docs + a branch-scoped permission check in repositories; `businessId` stays the isolation boundary. |
| WhatsApp property sharing | A `share` service producing a public, expiring, signed brochure URL + `wa.me` deep link. |
| Brochure generation | A `brochures` job type: render HTML template → PDF (headless Chromium) → store in cloud storage → `documents` record. Kept out of the property module on purpose. |
