# Final QA Report

Date: 18 October 2026 · Build machine: Windows 11, Node 24, Flutter 3.47 (local SDK), Microsoft Edge
(for browser automation). Everything below was **executed and its output inspected**; anything not
executed is listed in §7.

## 1. Summary

| Area | Command | Result |
|---|---|---|
| Server type check | `npx tsc --noEmit -p server` | ✅ no errors |
| Server tests (unit, integration, API, auth, permissions, tenancy, matching, follow-ups, media, sync, dashboard/exports, seed, sockets, scenarios A–H, enhancements, rate limits) | `npm test -w @recrm/server` | ✅ **165 passed**, 1 skipped (opt-in volume benchmark), 16 files |
| Volume benchmark | `PERF=1 npx jest tests/perf.test.ts` | ✅ passed (see §5) |
| Web type check | `npx tsc --noEmit -p web` | ✅ no errors |
| Web tests (components, login/session, documents, enhancements, translations) | `npx vitest run` | ✅ **25 passed**, 5 files |
| Production builds (shared, server, web) | `npm run build` | ✅ success |
| Flutter static analysis | `flutter analyze` | ✅ **No issues found** |
| Flutter tests (unit, widget, repository/filters, sync engine, enhancements) | `flutter test` | ✅ **39 passed** |
| Flutter Android build | `flutter build apk` | ⛔ not run — no Android SDK on the build machine |
| Docker images / compose | `docker compose up --build` | ⛔ not run — Docker not installed |
| Linting | — | No ESLint/Prettier configuration exists in the repo; type checks and the Flutter analyzer were used instead |
| Browser checks of the running demo | scripted Edge (`tools/manuals/capture.mjs`) + manual inspection | ✅ 196 screenshots across 6 roles + public pages, 0 failed captures; all inspected via contact sheets |
| PDF manuals | `node build.mjs && node verify.mjs --render` | ✅ 6 PDFs, 287 pages, 211 figures, 357 contents references checked, every page rendered and reviewed |

## 2. Backend checks (§5.1 of the brief)

| Check | Evidence |
|---|---|
| Reproducible install | npm workspaces + committed lockfile; `npm install` at root |
| Authentication & authorization | `auth.test.ts`, `members.test.ts`, `enhancements.test.ts` (verify needs `properties:update`), Scenario E (member cannot delete), Scenario G (expired vs invalid token) |
| Tenant isolation | `tenancy.test.ts`; Scenario E (another business gets 404 on read and update, empty list and search); the tenant-guard plugin threw on an unscoped query written in a test — the guard works |
| Client CRUD | `crm.test.ts`; Scenario A; duplicate detection tests |
| Property CRUD | `crm.test.ts`; Scenario B; concurrency-safe IDs (Scenario H) |
| Matching calculations | `matching.scoring.test.ts` (pure scoring), `crm.test.ts` (re-scoring, stale, settings), Scenario C |
| Follow-up workflows | `followups.test.ts`; Scenario D; reschedule test |
| Validation & error handling | Scenario G (field details, no stack traces); `media.test.ts` (disguised files) |
| Pagination & filters | Scenario F; `perf.test.ts` (page 200 of 5,000) |
| Upload authorization | `media.test.ts` (permission + other-tenant property) |
| Audit events | Scenario H (`client.created`, `client.deleted`); verify writes `property.verified` |
| Rate limiting | `ratelimit.test.ts` (refresh, login, API-wide, health check) |

## 3. End-to-end scenarios (§5.4) — `server/tests/e2e.scenarios.test.ts`

| Scenario | What was checked | Result |
|---|---|---|
| A — New client | Create buyer with budget/location → reopen → values persisted (phone normalised to +92…) → the matching property is listed | ✅ |
| B — New property | Create → `RE-000001` → upload JPEG → reopen: cover image, media item with thumbnail → matching client listed | ✅ |
| C — Matching | Score 100 with reasons TYPE/SOCIETY/BUDGET/SIZE/PURPOSE → budget lowered → score drops and budget reason disappears → recalculate → budget restored → exactly **one** match at 100 | ✅ (this scenario exposed and now guards the data-loss defect D-1) |
| D — Follow-up | Schedule property visit → appears in My Day "property visits" and Pending → complete with outcome → in Completed; timeline has created/completed | ✅ |
| E — Team collaboration | Father's client visible to son; son's property visible to father; another business: 404 on read/update, empty list/search; son (Standard member) cannot delete | ✅ |
| F — Search | By name, mobile digits, property ID (`RE-000002` and `2`), area, type, purpose, price range | ✅ |
| G — Failure handling | Invalid input → 400 with details, no stack trace; expired token → `TOKEN_EXPIRED`; garbage token → `INVALID_TOKEN`; disguised upload rejected, nothing stored. Unavailable backend: web now shows "Can't reach the server" (web test) | ✅ |
| H — Data integrity | 8 concurrent creates → RE-000001…008 unique; replayed offline mutation applied once; delete removes from lists and matches, audit keeps history | ✅ |

The same journeys were also performed in the browser by the capture script as each role
(create client, duplicate warning, schedule/reschedule/complete follow-up, confirm availability,
change status, add user with template) and the resulting screens were inspected.

## 4. React and Flutter checks (§5.2, §5.3)

**Web:** production bundle builds; major routes opened for every role (dashboard, My Day, search,
clients, client tabs, properties, property tabs, owners, matches, follow-ups, documents,
notifications, settings, users, reports, audit) with **0 capture failures**; login/logout tested
(`login.test.tsx`) and exercised for 6 accounts; permission-restricted controls confirmed hidden
(e.g. viewer: no Add/Edit/Confirm availability/Change status; agent: no Reports/Users/Audit in
the menu) and confirmed blocked by the API (Scenario E, verify 403). Browser console: no
application errors were observed in the in-app browser checks; the only 500s seen earlier were the
dev proxy while the API was still starting — now shown as a friendly "can't reach the server".

**Flutter:** analyzer clean; 39 tests incl. widget tests (PropertyCard, MatchCard with
send-property action, FollowUpCard, Urdu RTL, promptText dialog), repository/filter tests
(offline area/budget/size/owner/assigned filters, duplicate lookup, needs-verification), and
sync-engine tests against an in-memory SQLite database (outbox, conflicts, keep-mine, failures,
idempotence, offline reschedule). **Not done:** running the app on an emulator/device, APK build,
camera/maps/biometrics/push on hardware.

## 5. Performance (5,000 clients + 5,000 properties, second tenant with 2,000 each)

Median of 5 runs through the full HTTP stack (in-memory MongoDB, same machine):

| Request | Median |
|---|---|
| Client list, page 1 (20 rows) | 31 ms |
| Client list, page 200 | 282 ms (offset paging; roadmap R-15 if ever needed) |
| Client search by name / by mobile digits | 100 ms / 79 ms |
| Property list, page 1 (24 rows) | 25 ms |
| Property lookup by ID `RE-004321` | **22 ms** (was 165 ms before the plot-number index added in this audit) |
| Property list with type + status + price + society filters | 31 ms |
| "Needs verification" filter | 48 ms |
| Global search | 75 ms |
| Dashboard (cache bypassed) | 81 ms |

## 6. Defects found during QA and fixed

| # | Defect | Severity | Fix | Regression test |
|---|---|---|---|---|
| D-1 | Partial client update with flat fields (e.g. only budget) **replaced the whole requirement**, silently deleting property types, society and size | **High (data loss)** | Merge flat fields into the existing primary requirement | Scenario C |
| D-2 | Refresh-token limit of 120/15 min **per IP** would sign out an office sharing one connection | High | Per-token limit + 3000/IP ceiling | `ratelimit.test.ts` |
| D-3 | API-wide limit of 1000/15 min **per IP**, and health checks rate-limited (load balancer would mark the server down) | High | Per-token 3000 + 30,000/IP; `/health` exempt | `ratelimit.test.ts` |
| D-4 | Activity timeline returned entries about record types the member cannot read | Medium | Filter by readable entity types | `enhancements.test.ts` |
| D-5 | Property-ID search scanned the collection (unindexed plot number) | Low | Index `{businessId, plotNumber}` | `perf.test.ts` |
| D-6 | Proxy/gateway errors shown as "Request failed with status code 500" | Low | Mapped to "Can't reach the server" | web test |
| D-7 | Business name overflowed into the search bar | Low (visual) | Truncation fixed | screenshots |
| D-8 | "1 matches", "1 properties" | Low | Singular forms (web + mobile, en/ur parity kept) | translation parity tests |
| D-9 | Demo image label hidden under the listing badge | Low (demo) | Label moved | screenshots |

## 7. Not tested / blocked

| Item | Why | What is needed |
|---|---|---|
| Android/iOS build and on-device behaviour (offline in airplane mode, camera, maps picker, PIN/biometrics, push, restore on new phone) | No Android SDK / device on the build machine | Build with `flutter build apk` on a machine with the Android SDK; run the device checklist in CUSTOMER_DEMO_PLAYBOOK.md §4 |
| Docker images and `docker compose` | Docker not installed | `docker compose up --build` on a Docker host |
| Push notification delivery (FCM) | No Firebase project/credentials | Firebase service account in server `.env`, `google-services.json` in the app |
| Cloudinary storage | No credentials | `STORAGE_DRIVER=cloudinary` + keys, then run `media.test.ts` against it |
| Password-reset e-mail delivery | No SMTP server | SMTP settings |
| Load beyond a single node / concurrent users | Out of scope for MVP | Load test on target hosting |
| Cross-browser (Firefox/Safari) | Only Chromium (Edge) automated | Manual check before launch |
