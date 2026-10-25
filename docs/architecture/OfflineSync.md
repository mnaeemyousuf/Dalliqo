# Offline-first sync ✅

## Principles

1. **The local SQLite database is the UI's source of truth.** Screens watch local queries; they never
   wait on the network to render.
2. **Every local write is also an outbox entry**, written in the same SQLite transaction.
3. **The server is the source of truth for the business.** It assigns versions, property IDs,
   matches and audit entries.
4. Sync is **idempotent**: replaying a mutation never applies it twice.

```text
UI ─► Controller ─► Repository ─► [SQLite txn: entity row (syncStatus=pending) + outbox row]
                                        │
                     SyncEngine (connectivity / timer / socket notice / app resume)
                                        │ push (batched)            pull (delta)
                                        ▼                           ▲
                          POST /api/sync/push            GET /api/sync/pull?cursor=…
                                        │                           │
                                     services ─► MongoDB ─► domain events ─► Socket.IO ─► other devices
```

## Local schema (sqflite) — mobile/lib/core/database/app_database.dart

`records`: `(entity, uuid)` PK · `server_id` · `version` · `data` (the API JSON) · `search` · `sync_status`
(`pending | syncing | synced | failed | conflict`) · `sync_error` · `deleted` (tombstone) · `updated_at`.
`conflicts`: my change + the server record, for the Keep mine / Keep latest screen.

`outbox`: `mutationId` (UUID) · `entityType` · `entityUuid` · `op` (create | update | delete) ·
`payload` (changed fields only) · `baseVersion` · `status` · `attempts` · `nextAttemptAt` ·
`lastError` · `createdAt`. Consecutive updates to the same pending entity are **coalesced** before
sending.

`sync_state`: per-entity pull cursor `(updatedAt, _id)`; last successful sync time.

## Push

`POST /api/sync/push` with up to 100 mutations, in creation order. The server, per mutation:

1. If `mutationId` is already in `syncRecords` → return the stored result (idempotency).
2. Validate with the same Zod schema and permission as the REST endpoint (shared service code).
3. `create`: insert with the client `uuid` (unique per business ⇒ a duplicate create is a no-op).
4. `update`/`delete`: compare `baseVersion` with the current `version`:
   * equal → apply, `version++`
   * different → **conflict**, resolved by the entity's policy (below)
5. Record the result in `syncRecords`; publish domain events (sockets, matching, notifications).

Response per mutation: `applied | applied_with_conflict | conflict | rejected` + current server
record + new `version`.

## Conflict policy

* **Default: last-write-wins at field level.** Only the fields the device changed are applied over
  the latest server record; the overwritten server values are written to the audit log
  (`sync.conflict_overwritten`), so nothing is lost silently.
* **Protected fields require confirmation**: `property.status`, `property.askingPrice`,
  `property.minimumPrice`, `followUp.status`. On a conflict touching these, the server does **not**
  apply the change; it returns `conflict` with the server version. The app shows:

  > This record was modified by another user. **Your version** / **Server version** —
  > [Keep mine] [Keep latest]

  *Keep mine* re-sends with `baseVersion = serverVersion` (an explicit, audited overwrite);
  *Keep latest* drops the local change.
* Deletes beat concurrent edits (tombstone wins); edits to a deleted record surface as `conflict`.

## Pull

`GET /api/sync/pull?cursor=<opaque>&limit=500` returns all entity changes (including tombstones) for
the business since the cursor, ordered by `(updatedAt, _id)` — a compound cursor avoids missing
writes that share a millisecond. The client upserts rows, skipping any whose local copy has pending
outbox entries (they'll be reconciled by the push result), and stores the new cursor.

## Triggers & retry

* Connectivity regained, app resumed, pull-to-refresh, every 5 minutes while foregrounded, and on
  any Socket.IO change notice (debounced 1 s).
* Retry with exponential backoff + jitter (2 s → 5 min cap). 4xx validation rejections are
  **not** retried: the row becomes `failed` with the server message and the user can fix or discard it.
* WorkManager (Android) / BGTaskScheduler (iOS) for background sync where the OS allows.

## Status UI

A global indicator: `✓ All data synced` · `⟳ Syncing 4 changes…` · `⚠ 1 change needs attention`
(opens a list of failed/conflicted items). Each list row shows a small pending/conflict badge.

## Backup / restore (new phone)

There is no device-only data: every record reaches MongoDB once synced. On a new install:
login → `GET /api/sync/bootstrap` (paged snapshot of all entities + cursor) → local DB populated →
normal delta sync. Media is fetched lazily by URL. Logging out wipes the local DB and secure storage
(with a warning if unsynced changes exist).

## Tests

Repository and sync-engine tests (in-memory SQLite via sqflite_common_ffi, fake API adapter — `mobile/test/sync_test.dart`), outbox coalescing, retry/backoff timing with a fake clock,
conflict resolution matrix, and an end-to-end test: two simulated devices offline-edit the same
property → both sync → expected merge + audit entries.
