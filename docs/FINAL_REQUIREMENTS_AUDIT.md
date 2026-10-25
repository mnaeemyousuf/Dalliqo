# Final Requirements Audit — Traceability Matrix

Prepared 18 October 2026 against the original "Real Estate CRM — MERN + Flutter" specification
(sections §1–§70) and the customer's original business requirements. The original requirements are
the source of truth; nothing has been removed or redefined.

## Status definitions

| Status | Meaning |
|---|---|
| **PASS** | Implemented and verified by an automated test and/or an executed manual check (named in "Verification") |
| **PARTIAL** | Works, but important behaviour is missing or unverified in the target environment |
| **FAIL** | Not implemented or demonstrably broken |
| **BLOCKED** | Implemented, but cannot be verified end-to-end without an unavailable dependency (credentials, device, Docker) |
| **N/A** | Does not apply to this release (reason given) |

## Verification sources (referenced as V-codes)

| Code | What was executed | Result |
|---|---|---|
| V-API | Server Jest suite: 16 files (unit, integration/API, auth, permissions, tenancy, matching, sync, media, dashboard/export, seed, socket, e2e scenarios A–H, enhancements, rate limits) against an in-memory MongoDB replica set | **165 passed**, 1 skipped (the opt-in volume benchmark) |
| V-WEB | Web Vitest suite (components, login/session, documents, enhancements) + production build | **25 passed**, build OK |
| V-MOB | Flutter `analyze` + `flutter test` (format, sync engine, repository/filters, widgets, enhancements) | **0 issues**, **39 passed** |
| V-E2E | `server/tests/e2e.scenarios.test.ts` — journeys A–H through the real API and database | 12 passed |
| V-UI | Live browser checks of the running demo (Edge, scripted) and 196 screenshots captured as six demo users plus the public pages | Inspected; see FINAL_QA_REPORT.md §4 |
| V-PERF | `server/tests/perf.test.ts` with 5,000 clients + 5,000 properties (+2,000 in a second business) | Every measured request ≤ 0.3 s median (deep page 200: 0.28 s) |
| V-CODE | Code inspection only (no executable proof) | — |

Priorities: **P0** security/data integrity/release blocker · **P1** MVP-critical · **P2** important · **P3** future.

---

## A. Authentication and account recovery

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Register (§8) | API/web/mobile | New user creates account + business in one step | `authService.register` (transaction), Register screens | V-API `auth.test.ts`; V-UI register page | Pass | — | — | — | P1 | **PASS** |
| AUTH-02 | Login / logout (§8) | API/web/mobile | Credential check, session created, logout revokes | argon2id hashes, sessions collection | V-API, V-WEB `login.test.tsx`, V-UI | Pass | — | — | — | P1 | **PASS** |
| AUTH-03 | Refresh token, short-lived JWT (§8) | API | 15-min access JWT; rotating refresh token with reuse detection | `tokenService`, `authService.refresh` | V-API (rotation, reuse revokes family) | Pass | — | — | — | P0 | **PASS** |
| AUTH-04 | Secure token storage — Flutter secure storage, web httpOnly cookie (§8, §46) | web/mobile | Web token in memory + httpOnly SameSite=Strict cookie; mobile Keychain/Keystore | `api/client.ts`, `secure_store.dart` | V-WEB (token not in localStorage); V-CODE mobile | Pass (mobile by code + unit tests) | Device keystore not exercised | Low | Device test | P1 | **PASS** (web) / **BLOCKED** device |
| AUTH-05 | Forgot / reset password (§8) | API/web | Emailed one-time link, expiry, sessions revoked on reset | `passwordResetToken`, mail service (dev outbox) | V-API (outbox token, reset, reuse rejected) | Pass in tests | Real email delivery needs SMTP credentials | Medium (owners must configure SMTP) | Configure SMTP_* in production (env validation already requires it) | P1 | **BLOCKED** (delivery) / **PASS** (logic) |
| AUTH-06 | Change password, session management (§8) | API/web/mobile | Change password; list and revoke sessions; logout-all | `/auth/change-password`, `/auth/sessions` | V-API; V-UI settings | Pass | — | — | — | P1 | **PASS** |
| AUTH-07 | Expired / invalid token handling (QA G) | API/web | 401 with distinct codes; web refreshes silently | `tokenService.verifyAccessToken`; single-flight refresh | V-E2E Scenario G | Pass | — | — | — | P1 | **PASS** |
| AUTH-08 | Rate limiting (§46) | API | Brute-force limits without locking out legitimate offices | `rateLimiters.ts`, account lockout | V-API `ratelimit.test.ts` | **Defect found**: refresh limit per IP (120/15 min) signed out shared-IP offices | — | High for teams | **Fixed** (per-token + 3000/IP) | P0 | **PASS** after fix |
| AUTH-09 | PIN / biometric app lock (§69) | mobile | 4-digit PIN (hashed), optional biometrics, lock on resume | `local_auth`, `secure_store.dart`, lock screen | V-MOB (PIN hash unit tests); V-CODE | Implemented | Not tested on a physical device | Medium | Device test before release | P1 | **BLOCKED** (device) |

## B. Business account and tenant isolation

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TEN-01 | Every query enforces businessId (§7) | API | No cross-business reads/writes | Repository scoping + tenant-guard plugin that throws on unscoped queries | V-API `tenancy.test.ts`; V-E2E E | Pass (guard even caught a test that forgot businessId) | — | Critical | — | P0 | **PASS** |
| TEN-02 | Foreign IDs return 404 (no existence oracle) | API | 404 for another tenant's record | `findOne({_id, businessId})` | V-E2E E | Pass | — | — | — | P0 | **PASS** |
| TEN-03 | Business setup (§69 "Create business") | API/web | Business created at registration; profile editable by owner | `businessService` | V-API; V-UI settings | Pass | — | — | — | P1 | **PASS** |
| TEN-04 | Search/exports/socket scoped per tenant | API | No leakage via search, export, realtime rooms | `searchService` per-permission, exports scoped, `business:<id>` rooms | V-API `socket.test.ts`, `dashboard.test.ts`; V-E2E E | Pass | — | — | — | P0 | **PASS** |

## C. User management and role-based permissions

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USR-01 | OWNER full access; MEMBER per permissions (§9) | API | Permission checks on every route | Permission catalogue + `requirePermission` | V-API `members.test.ts`; V-E2E E | Pass | — | — | — | P0 | **PASS** |
| USR-02 | Add Father/Son users (§10, §69) | web | Owner adds members with temporary password | Users page; forced password change | V-API; V-UI | Pass | — | — | — | P1 | **PASS** |
| USR-03 | Manage permissions (§69) | web | Tick/untick permissions, apply immediately | PermissionMatrix; membership re-read per request | V-API; V-UI | Pass | Templates missing → easy to misconfigure | Medium | **Added permission templates** | P1 | **PASS** |
| USR-04 | Future roles Admin/Agent/Salesperson/Accountant/Manager/Viewer (§9) | shared | Architecture supports them | Presets in `roles.ts`; exposed as MEMBER templates | V-CODE; V-UI | Pass as templates | Role codes not assignable (by design) | Low | Documented in role matrix | P2 | **PASS** (architecture) |
| USR-05 | Authorization of timeline/notes data | API | Users only see data for record types they may read | Notes checked; activities were not | V-API new test | **Defect found** | — | Medium (custom permission sets) | **Fixed** | P0 | **PASS** after fix |
| USR-06 | Super Admin / platform admin (final brief) | — | Platform-level operations | Not present | V-CODE | — | No cross-tenant console | Needed only for SaaS operation | Roadmap E-07 | P3 | **N/A** this release (documented) |

## D. Client management, categories, requirements and lead tracking

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CLI-01 | Client CRUD with spec fields (§11–12) | API/web/mobile | Create, view, edit, archive, search | `clientService`, Client model with all spec fields | V-API `crm.test.ts`; V-E2E A; V-UI | Pass | — | — | — | P1 | **PASS** |
| CLI-02 | Built-in + custom categories (§11) | API/web | 9 built-ins + custom; archive custom | `categoryService` | V-API; V-UI settings | Pass | — | — | — | P1 | **PASS** |
| CLI-03 | Requirements: budget, location, size, purchase/rental (§12) | API/web/mobile | Multiple requirements per client | Embedded `requirements[]` + flat shorthand | V-E2E A, C | **Defect found**: partial flat edit replaced whole requirement (type, society, size lost) | — | High (silent data loss) | **Fixed** (`mergeFlatIntoRequirement`) | P0 | **PASS** after fix |
| CLI-04 | Search, filter, sort, pagination, infinite scroll, pull-to-refresh (§13, §33) | web/mobile | Category, area, budget, type, status, assigned user | Web filters; mobile offline filters | V-WEB; V-MOB `filters_test.dart`; V-E2E F | Pass | — | — | — | P1 | **PASS** |
| CLI-05 | Client detail sections (§13) | web/mobile | Overview, Requirements, Matches, Follow-ups, Notes, Documents, Activity, Communication | Tabs on both platforms | V-UI (web screenshots); V-MOB widget code | Pass (web visual) | Mobile not seen on a device | Low | Device test | P1 | **PASS** (web) / **BLOCKED** (mobile visual) |
| CLI-06 | Duplicate client records (industry F2) | API/web/mobile | Warn on existing phone number | Not present before | V-API, V-WEB, V-MOB new tests | **Missing** | — | High | **Implemented** | P1 | **PASS** |
| CLI-07 | Lead source and conversion visibility (industry F12) | API/web | Source per client; conversion by source | Source field existed; no report | V-API new test; V-UI | Partial | — | Medium | **Added chart** | P1 | **PASS** |
| CLI-08 | Archive (MVP brief) | API | Remove from active work without losing history | Soft delete (`deletedAt`) + status Inactive/Closed | V-E2E H | Pass | No "restore" button | Low | Roadmap if requested | P2 | **PASS** |

## E. Property management, owners, status

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PRO-01 | Property types and spec fields (§14–15) | API/web/mobile | All 9 types; all spec fields | Property model | V-API; V-E2E B | Pass | — | — | — | P1 | **PASS** |
| PRO-02 | Auto property ID RE-000001 (§15) | API | Unique, sequential per business, concurrency-safe | Atomic counter | V-E2E H (8 concurrent creates) | Pass | — | — | — | P0 | **PASS** |
| PRO-03 | Separate owner entity, one-to-many (§16) | API/web/mobile | Owner CRUD; owner with properties can't be deleted | `ownerService` | V-API | Pass | — | — | — | P1 | **PASS** |
| PRO-04 | Status lifecycle + activity on every change (§20) | API | Valid transitions only; activity + audit | `PROPERTY_STATUS_TRANSITIONS`, `changeStatus` | V-API; V-UI | Pass | — | — | — | P1 | **PASS** |
| PRO-05 | Prevent invalid/unauthorized modification (MVP) | API | Validation + permissions + version conflicts | Zod, `requirePermission`, `baseVersion` | V-API; V-E2E E, G | Pass | — | — | — | P0 | **PASS** |
| PRO-06 | Outdated availability (industry F3) | API/web/mobile | Know when availability was last confirmed | Not present before | V-API, V-WEB, V-MOB new tests; V-UI | **Missing** | — | High (credibility) | **Implemented** verification | P1 | **PASS** |

## F. Media, documents and cloud storage

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MED-01 | Images, videos, PDFs, registration documents (§17, §42) | API/web/mobile | Upload, preview, download, delete, rename, share | `mediaService`, documents panels | V-API `media.test.ts`; V-E2E B; V-UI | Pass | — | — | — | P1 | **PASS** |
| MED-02 | Compression + thumbnails (§18) | API/mobile | Images ≤2048 px, 480 px thumbs; client-side compression on mobile | sharp; `flutter_image_compress` | V-API (dimensions asserted) | Pass | — | — | — | P1 | **PASS** |
| MED-03 | File-type/MIME/size validation, safe names, signed private URLs (§51) | API | Magic-byte sniffing; private documents via expiring signed links | `sniff()`, `SAFE_KEY`, signed local URLs | V-API; V-E2E G (disguised file rejected) | Pass | — | — | — | P0 | **PASS** |
| MED-04 | Cloud object storage — Cloudinary/S3 (§18) | API | Files in cloud storage, metadata in MongoDB | `CloudinaryStorage` driver; demo uses `LocalStorage` | V-CODE | Implemented | Not exercised against a real Cloudinary account | Medium | Add credentials, run media tests with `STORAGE_DRIVER=cloudinary` | P1 | **BLOCKED** (credentials) |
| MED-05 | Upload progress + retry (§18) | web/mobile | Progress bar; retry failed uploads | Axios progress; mobile retry button | V-CODE; V-UI (progress) | Pass (web visual) | Mobile retry not device-tested | Low | Device test | P2 | **PASS** (web) / **BLOCKED** (mobile) |

## G. Maps

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MAP-01 | Map preview, open in Google Maps, share location (§19) | web | Preview on property page; link opens Google Maps | Embedded map + Maps URL | V-UI (map rendered in screenshot) | Pass | — | — | — | P2 | **PASS** |
| MAP-02 | Select/search location, drop pin (§19) | mobile | Location picker with search and GPS | `google_maps_flutter`, geocoding, geolocator | V-CODE | Implemented | Needs Android/iOS Maps API key and a device | Medium | Add keys, device test | P2 | **BLOCKED** |

## H. Search and filtering

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SRCH-01 | Global search across clients/properties/owners/matches (§32) | API/web | One search box | `/search`, top-bar search | V-API; V-UI | Pass | — | — | — | P1 | **PASS** |
| SRCH-02 | Property filters: type, status, area, society, block, price, size, owner (§33) | web/mobile | All listed filters | Web + mobile filter sheets | V-E2E F; V-MOB; V-UI | Pass (Area/Owner added earlier in this engagement) | — | — | — | P1 | **PASS** |
| SRCH-03 | Indexed, efficient queries (§32, §50) | API | Fast at thousands of records | Compound indexes | V-PERF | Pass; plot-number lookup slow (165 ms) | — | Low | **Index added** (22 ms) | P1 | **PASS** |

## I. Smart matching

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MAT-01 | Automatic two-way matching on create/update (§21) | API | New property → clients; new client → properties | `matchingService` hooks | V-API; V-E2E A, B | Pass | — | — | — | P1 | **PASS** |
| MAT-02 | Weighted score 25/25/25/15/10 + reasons (§22) | API | Transparent score and reasons | `scoring.ts` | V-API `matching.scoring.test.ts`; V-E2E C | Pass | — | — | — | P1 | **PASS** |
| MAT-03 | Thresholds/bands, configurable notifications (§23) | API/web | Bands; notify only above threshold | Settings weights/thresholds | V-API | Pass | — | — | — | P1 | **PASS** |
| MAT-04 | No duplicate match records; recalculation; no stale results shown as live (MVP) | API | One record per pair; stale when unavailable | Unique index; STALE status | V-E2E C (recalculate, restore → exactly one) | Pass | — | — | — | P0 | **PASS** |
| MAT-05 | Match screen actions View/Call/WhatsApp/Follow-up (§25) | web/mobile | Actions on each card | Cards on both platforms; **plus send-property on WhatsApp** | V-WEB; V-MOB | Pass | — | — | — | P1 | **PASS** |

## J. Follow-ups, reminders, notifications, My Day

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FU-01 | Follow-up types, fields, statuses (§26) | API/web/mobile | Pending/Completed/Cancelled/Overdue | `followUpService`, overdue job | V-API `followups.test.ts`; V-E2E D | Pass | — | — | — | P1 | **PASS** |
| FU-02 | Reschedule (MVP brief) | web/mobile | Move due time; reminder recalculated | API supported; no UI | V-API, V-WEB, V-MOB new tests | **Missing UI** | — | Medium | **Implemented** + timeline entry | P1 | **PASS** |
| FU-03 | Reminders (§27, §69) | API | Reminder at configured time | Scheduler with lease lock → in-app notification | V-API (job tests) | Pass (in-app) | — | — | — | P1 | **PASS** |
| FU-04 | FCM push notifications (§27, §69) | API/mobile | Push to devices | `pushService` (lazy firebase-admin), device registration | V-CODE; V-API (device registration) | Implemented | No Firebase project/credentials | High for "receive push" acceptance | Configure Firebase + device test | P1 | **BLOCKED** |
| FU-05 | Notification centre with tabs, mark read, deep links (§58) | web/mobile | All/Follow-ups/Matches/System | Notification pages | V-API; V-UI | Pass | — | — | — | P1 | **PASS** |
| FU-06 | My Day (§28) | API/web/mobile | Seven sections | `dashboardService.myDay` | V-API; V-E2E D; V-UI | Pass | — | — | — | P1 | **PASS** |

## K. Notes, activity history, audit

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LOG-01 | Notes on client/property/owner/follow-up (§35) | all | Chronological notes | `noteService`; panels incl. follow-up notes | V-API; V-UI | Pass | — | — | — | P1 | **PASS** |
| LOG-02 | Activity timeline events (§36) | API/web | All listed events (+ rescheduled, verified) | `activityService` | V-API; V-E2E D | Pass | — | — | — | P1 | **PASS** |
| LOG-03 | Audit log with old/new values (§37) | API/web | Price/status/member changes with diffs | `auditService`, Audit page | V-API; V-E2E H; V-UI | Pass | — | — | — | P1 | **PASS** |

## L. Dashboard, analytics, exports

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DSH-01 | Dashboard metrics from real data (§29, §68) | API/web/mobile | 13 KPIs, no hard-coded numbers | Aggregations, 15 s cache | V-API `dashboard.test.ts`; V-UI | Pass | — | — | — | P1 | **PASS** |
| DSH-02 | Analytics charts (§31) | web | Six charts | ECharts dashboard | V-UI | Pass (+ lead sources, team performance) | — | — | — | P1 | **PASS** |
| EXP-01 | Excel export of 5 resources (§43) | API/web/mobile | Real workbook with filters | exceljs streaming | V-API (workbook parsed) | Pass | — | — | — | P1 | **PASS** |
| EXP-02 | PDF reports (§43) | API | Professional PDF | pdfkit | V-API (PDF signature); V-UI | Pass (English); Urdu fixed 25 Oct 2026 | — (Urdu cells are single-line; Naskh typeface, not Nastaliq) | Medium for Urdu-only customers | **Implemented** R-14: bundled Noto Naskh Arabic, run-by-run RTL layout; test `embeds an Urdu font for Urdu text in PDF exports`; rendered export reviewed | P2 | **PASS** |

## M. Localization

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L10N-01 | English + Urdu via en.json/ur.json, no hard-coded text (§45) | web/mobile | All UI strings translated | i18next; mobile JSON loader | V-WEB; V-MOB; V-UI | Pass (new strings added in both languages) | — | — | — | P1 | **PASS** |
| L10N-02 | Urdu RTL (§45) | web/mobile | Direction switches to RTL | `dir="rtl"`; MaterialApp locale | V-UI (Urdu dashboard/clients screenshots); V-MOB widget test | Pass | Mobile RTL not seen on a device | Low | Device test | P1 | **PASS** (web) |
| L10N-03 | Plurals ("1 match") | web/mobile | Grammatical counts | Missing singular forms | V-UI | **Defect** | — | Low | **Fixed** (`_one` keys, mobile support) | P2 | **PASS** |

## N. Flutter Android app, offline and sync

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MOB-01 | Flutter app with Riverpod, GoRouter, Dio, SQLite, secure storage (§3) | mobile | Clean, analyzable codebase | As specified | V-MOB (0 analyzer issues) | Pass | — | — | — | P1 | **PASS** |
| MOB-02 | Android build | mobile | Installable APK | Platform folders configured | — | Not built | No Android SDK on the build machine | **High** for demo on a phone | Build on a machine with Android SDK (`flutter build apk`) | P1 | **BLOCKED** |
| OFF-01 | Offline create/edit with local DB + sync queue (§38) | mobile | Works without internet | `LocalStore`, outbox | V-MOB `sync_test.dart` | Pass (automated, in-memory DB) | Not exercised on a device | Medium | Device test with airplane mode | P0 | **PASS** (logic) |
| OFF-02 | Sync states, retry, status UI (§39) | mobile | pending/syncing/synced/failed/conflict | `SyncEngine` with backoff | V-MOB | Pass | — | — | — | P0 | **PASS** |
| OFF-03 | Conflict resolution LWW + Keep mine/Keep latest (§40) | API/mobile | Audited LWW; protected fields prompt | `syncService`, conflicts table | V-API `sync.test.ts`; V-MOB | Pass | — | — | — | P0 | **PASS** |
| OFF-04 | Idempotent replay (QA H) | API | Duplicate push applied once | `syncRecords` ledger | V-E2E H | Pass | — | — | — | P0 | **PASS** |
| BAK-01 | Backup/restore on a new phone (§60) | API/mobile | Sign in → data restored | `/sync/bootstrap`; Backup section in Settings | V-API (bootstrap); V-CODE | Pass (API) | Device restore not exercised | Medium | Device test | P1 | **PASS** (API) / **BLOCKED** (device) |

## O. Real-time

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RT-01 | Socket.IO events; other users' UI updates (§41, §10) | API/web/mobile | Change notices to business room | Gateway; web invalidates queries; mobile pulls | V-API `socket.test.ts`; V-UI ("Live" indicator; earlier two-user check) | Pass | — | — | — | P1 | **PASS** |

## P. Security

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SEC-01 | Helmet, CORS, validation, no stack traces (§46, §48) | API | Secure headers; consistent errors | helmet, CORS allow-list, Zod, error handler | V-API; V-E2E G | Pass | — | — | — | P0 | **PASS** |
| SEC-02 | No secrets in apps (§46) | web/mobile | Only public config in clients | `.env` server-side only | V-CODE (grep) | Pass | — | — | — | P0 | **PASS** |
| SEC-03 | Demo data separated from production (§63) | API | Demo isolated and removable | DEMO business; seed refuses in production; `.test` e-mails; `DEMO_PASSWORD` override | V-API `seed.test.ts` | Pass | — | — | — | P1 | **PASS** |

## Q. Performance, installation, deployment, documentation, testing

| ID | Original requirement | Module | Expected behaviour | Existing implementation | Verification | Result | Missing functionality | Business impact | Corrective action | Priority | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PERF-01 | Thousands of records, pagination, debounced search (§50) | API/web/mobile | No screen loads thousands of rows; fast queries | Server pagination (≤100), indexes, debounce, lazy lists | V-PERF (5,000 + 5,000) | Pass | Deep offset paging ~0.3 s | Low | Roadmap R-15 | P1 | **PASS** |
| DEP-01 | Docker + docker-compose (§64) | infra | `docker compose up` runs Mongo, API, web | Dockerfiles, compose, nginx | V-CODE | Not executed | Docker not installed on the build machine | High for a customer server install | Run `docker compose up --build` on a Docker host | P1 | **BLOCKED** |
| DEP-02 | `.env.example` (§65) | infra | All listed variables | Present (+ DEMO_PASSWORD documented) | V-CODE; env parse | Pass | — | — | — | P1 | **PASS** |
| DEP-03 | Reproducible local demo | infra | One command | `npm run demo` (in-memory MongoDB + seed) | Executed repeatedly | Pass | — | — | — | P1 | **PASS** |
| DOC-01 | Documentation set (§66) | docs | README, Architecture, Database, API, Auth, Matching, OfflineSync, Deployment, EnvironmentSetup | Present; corrected in this engagement | V-CODE | Pass | — | — | — | P1 | **PASS** |
| TST-01 | Backend/Flutter/React tests (§62) | all | Unit, integration, API, auth, permission, matching; widget, repository, sync; component, API integration | As listed in V-API/V-WEB/V-MOB | Executed | Pass | No browser e2e suite in CI | Low | Screenshot capture script doubles as a smoke test | P2 | **PASS** |
| FUT-01 | Future features prepared, not faked (§61, §44) | arch | Extension points documented | Architecture §6 | V-CODE | Pass | — | — | — | P3 | **PASS** |

---

## Summary

82 requirements traced.

| Final status | Count | Notes |
|---|---|---|
| **PASS** | 68 | Includes EXP-02 (Urdu PDF text, completed 25 Oct 2026) and 3 that passed only after fixes made in this audit (AUTH-08, USR-05, CLI-03) and USR-04 (architecture) |
| **PASS where testable, part BLOCKED** | 7 | Logic/web verified; device, e-mail delivery or mobile visual check outstanding (AUTH-04, AUTH-05, CLI-05, MED-05, L10N-02, OFF-01, BAK-01) |
| **BLOCKED** | 6 | Need an external dependency: device (AUTH-09), Cloudinary credentials (MED-04), Maps keys + device (MAP-02), Firebase (FU-04), Android SDK (MOB-02), Docker (DEP-01) |
| **PARTIAL** | 0 | (EXP-02 completed 25 Oct 2026) |
| **FAIL** | 0 | |
| **N/A** | 1 | USR-06 — platform super-admin, not part of this release |

Defects found **and fixed** during this audit: CLI-03 (data loss on partial edit), AUTH-08 (shared-IP
sign-outs), USR-05 (timeline authorization), SRCH-03 (slow ID lookup), L10N-03 (plurals), plus UI
issues (header overflow, demo label overlap, unfriendly 500 message) — see FINAL_QA_REPORT.md.
