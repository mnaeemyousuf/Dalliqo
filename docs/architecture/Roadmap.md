# Development roadmap

Each phase is done only when it is connected end to end (client → API → service → MongoDB), validated,
permission-checked, has loading/empty/error states, and its tests pass.

| Phase | Scope | Status | Verified by |
|---|---|---|---|
| 1 | Monorepo, shared constants, API foundation, tenant guard, auth (register/login/logout/refresh rotation + reuse detection/forgot/reset/change password/sessions), businesses, members, roles & permissions, audit log, Socket.IO gateway | ✅ | `server/tests/{auth,members,tenancy,socket,unit}.test.ts` |
| 2 | Flutter foundation: Material 3 theme (light/dark/system), en/ur + RTL, GoRouter with auth redirects, Riverpod, Dio + single-flight refresh, secure storage, SQLite, auth screens, temporary-password change, PIN/biometric lock | ✅ code complete | `mobile/test/*` (`flutter test`), `flutter analyze` |
| 3 | Client categories (9 built-in + custom, Urdu names), clients with embedded requirements, owners, notes, activities, one-tap communication logging | ✅ | `server/tests/crm.test.ts` |
| 4 | Properties (RE-000001 per business), status transitions + activity + audit, media (magic-byte validation, compression, thumbnails, cover), private documents with signed URLs, Cloudinary/local storage drivers, map location | ✅ | `server/tests/{crm,media}.test.ts` |
| 5 | Matching engine (weighted scoring, configurable weights/thresholds, two-way, stale on sold, notifications) | ✅ | `server/tests/matching.scoring.test.ts`, `crm.test.ts` |
| 6 | Follow-ups, reminder & overdue jobs (lease-locked scheduler), FCM push (server + app), notification centre, My Day, dashboard | ✅ | `server/tests/followups.test.ts`, `dashboard.test.ts` |
| 7 | Offline sync: outbox, push (idempotent, validated, uuid references), pull deltas with tombstones, bootstrap restore on a new phone, conflict policy (field-level LWW + audit; protected fields need Keep mine / Keep latest) | ✅ | `server/tests/sync.test.ts`, `mobile/test/sync_test.dart` |
| 8 | React CRM: dashboard analytics (ECharts), clients/properties/owners/matches/follow-ups/documents/reports/users & permission matrix/notifications/audit log/settings, en/ur RTL, dark mode, live updates | ✅ | `web/src/test/*` (Vitest) + manual browser walkthrough against the demo API |
| 9 | Exports: Excel (exceljs streaming) and PDF reports (pdfkit), filter-validated | ✅ | `server/tests/dashboard.test.ts` |
| 10 | Hardening: seed data, demo mode, Docker (API + web + MongoDB), deployment docs, security review items below | ✅ | `server/tests/seed.test.ts` |

## Known limitations / next steps

* **PDF exports render Latin text only.** Urdu names in PDF reports need an embedded Nastaliq font and a
  bidi-aware layout engine (e.g. headless Chromium); Excel exports handle Urdu correctly.
* **Mobile builds require platform setup** (Firebase files, Google Maps keys, signing) — see
  [mobile/README.md](../../mobile/README.md).
* **Multi-instance scale-out** needs the Socket.IO Redis adapter and a shared rate-limit store;
  scheduled jobs are already safe across instances (MongoDB lease lock).
* Future modules (commission, income/expense, contracts, multi-branch, brochure generation) are designed
  in [Architecture.md §6](Architecture.md) and intentionally not implemented.
