# Web ↔ mobile parity matrix

Every feature, where it lives on the web and in the Flutter app, the API behind it, how it behaves offline, and the tests that
cover it. "Offline ✅" means it is read from and written to the phone's database and synced later through the outbox
(`POST /sync/push`, idempotent by `mutationId`, conflicts on protected fields shown to the user). "Online" means it needs a
connection (the screen says so). Realtime = socket event → web invalidates queries, the app schedules a pull.

Test files: server `server/tests/*.test.ts` (Jest), web `web/src/test/*.test.tsx` (Vitest), mobile `mobile/test/*_test.dart`.

## Core CRM (Phase 1, unchanged unless noted)

| Feature | Web | Mobile | API | Offline | Realtime | Tests |
|---|---|---|---|---|---|---|
| Sign in, password change/reset, sessions | Login, Settings → Security | Login, Settings → Security | `/auth/*` | Online | session revoked | auth, ratelimit |
| Dashboard tiles | Dashboard | Dashboard | `GET /dashboard` | Cached (last result) | ✅ | dashboard |
| My Day | My Day | Home | `GET /my-day` | Cached | ✅ | dashboard, e2e |
| Global search | Top bar | Search | `GET /search` | Local search | — | crm |
| Clients: list, filters, add, edit, requirements, duplicates | Clients | Clients | `/clients` | ✅ | ✅ | crm, sync, `clientFilters.test.tsx`, `filters_test` |
| **Client search by block and size (A1)** | Clients filters | Clients filter sheet | `GET /clients?block&minSize&maxSize&sizeUnit` | ✅ (local filter) | — | crm, perf, `clientFilters.test.tsx`, `filters_test` |
| **Date added on details (A2)** | Client/property/owner pages | Detail screens | `createdAt` | ✅ | — | No automated test (display only; checked by eye on web, covered by `flutter analyze`) |
| Properties: list, filters, add, edit, status, verify, media | Properties | Properties | `/properties` | ✅ (media upload online) | ✅ | crm, media, sync |
| Owners | Owners | Owners | `/owners` | ✅ | ✅ | crm |
| Matching (scores, status) | Matches, client/property tabs | Matches | `/matches` | Read cached; status online | ✅ | matching.scoring, crm |
| Follow-ups | Follow-ups | Follow-ups | `/followups` | ✅ | ✅ | followups, sync |
| **Local reminders (A3)** | — (web shows in-app notifications) | Scheduled on the phone (`zonedSchedule`), restored after reboot, de-duplicated with FCM, open the follow-up | `POST /devices {localReminders}` + data-only push | ✅ (rings offline) | ✅ | crm (push split), `reminders_test` |
| Notes, activity timeline | Record tabs | Record tabs | `/notes`, `/activities` | Notes ✅, activity online | ✅ | crm |
| Documents | Documents, record tabs | Record panels | `/documents` | Online (upload/preview) | — | media |
| Notifications | Bell, Notifications | Notifications | `/notifications` | Cached | ✅ | followups |
| Reports & exports (Excel/PDF) | Reports | Settings → Export & share | `/exports/:resource` | Online | — | enhancements, finance, agreements |
| Language EN/UR, RTL | Top bar | Settings | user preferences | ✅ | — | i18n keys checked by both builds |
| **Users (members)** | Users | **Settings → Users: add, template, suspend, branch access (Part C)** | `/members`, `GET /meta/permissions` | Online | member.* | members, `admin_test` |
| **Client categories** | Settings → Client categories | **Settings → Client categories (Part C)** | `/client-categories` | List ✅ (synced), edits online | — | crm |
| **Business settings (matching, cross-branch, reminders, commission)** | Settings → Matching / Deals | **Settings → Business settings (Part C)** | `/settings` | Online | — | crm, deals, finance |

## Phase 2 modules

| Feature | Web | Mobile | API | Offline | Realtime | Tests |
|---|---|---|---|---|---|---|
| **Branches (B4)** — list, switcher, scoped data | Branch switcher (top bar), Settings → Branches | More → Branches, switcher tile; data on the phone limited to the user's branches | `/branches`, `X-Branch-Id` | List ✅ (synced), management online | branch.* | branches (9), `branches.test.tsx`, `branches_test` |
| Branch on records, cross-branch matching setting | Branch field on forms, detail pages | Branch dropdown on forms | `branchId` on records, `matching.crossBranch` | ✅ | ✅ | branches |
| Per-branch / consolidated reports | Switcher → reports, dashboard | Switcher → dashboard | all reports honour scope | — | — | branches, finance |
| **Deals pipeline (B1)** | Deals (board + table), detail, Deals tab on client/property | More → Deals, detail, form, panels on client/property/deal | `/deals` | ✅ (stage, payments, payouts travel inside the deal) | deal.* | deals (10), `deals.test.tsx`, `deals_test` (7) |
| Commission payments / payouts, maths | Deal → Commission | Deal detail | `/deals/:id/payments`, `/payouts` | ✅ | ✅ | deals, `deals_test` (same cases as server) |
| Commission report | Reports, Deals → report | Deals → report | `GET /reports/commissions` | Last result cached | — | deals |
| **Income & expense (B2)** | Income & expense (entries, report, categories) | More → Income & expense, entry form, report (computed on the phone) | `/transactions`, `/transaction-categories`, `GET /reports/finance` | ✅ entries; categories synced, managed online; report computed locally | transaction.* | finance (6), `finance.test.tsx`, `finance_test` (4) |
| Commission → income (once) | Entry shows "From deal" | Same, read-only | deal payment hook (`sourceKey`) | Created by the server when the payment syncs | ✅ | finance |
| Receipts | Paperclip → documents | Entry detail → Receipts | `POST /documents` (`transaction`) | Online | — | finance (entity types) |
| **Agreements (B3)** — draft, edit, statuses, versions | Agreements, detail, Agreements tab on deal | More → Agreements, detail, form, panel on deal | `/agreements` | ✅ drafts, edits, status (after first sync); text rendered by the server | agreement.* | agreements (7), `agreements.test.tsx` (3), `agreements_test` (4) |
| Agreement text regenerate / PDF EN-UR | Detail → Regenerate / PDF | Detail → Regenerate / Share PDF | `/agreements/:id/render`, `/pdf` | Online (says so) | ✅ | agreements (PDF in both languages) |
| Signed copy, lawyer-review note | Signed copy tab; note on every screen + PDF footer | Signed copy panel; note on every screen | `/documents` (`agreement`), status `signedDocumentId` | Upload online | ✅ | agreements |
| Renewal follow-ups 30/7 days | Shown on detail; follow-ups list | Follow-ups + local reminders | server plans them | ✅ (follow-ups sync; reminders ring offline) | followup.* | agreements |
| Templates | Agreements → Templates (copy/edit/archive) | Synced, chosen on the form (editing on web) | `/agreement-templates` | Read ✅ | ✅ | agreements |
| **Brochures (B5)** — PDF, 1080×1350 image, share text, WhatsApp | Property → Brochure | Property → Brochure sheet → share sheet / WhatsApp | `GET /properties/:id/brochure` | Online (says so) | — | brochures (4), `brochure.test.tsx`, `brochure_test` (2) |
| Dashboard tiles: deals, income, agreements | Dashboard | Dashboard | `GET /dashboard` | Cached | ✅ | deals, finance, agreements |
| Exports: deals, commissions, transactions, finance, agreements | Reports | Settings → Export & share | `/exports/:resource` | Online | — | deals, finance, agreements |
| Urdu / RTL for all new screens and PDFs | ✅ | ✅ | EN/UR strings for every new key; Urdu PDFs and images laid out right to left | — | — | agreements (Urdu PDF), brochures (Urdu PNG/PDF) |
| Pagination | All new lists | Lists read the phone's database | `page`/`limit`; sync pull pages | — | — | perf (page 50, sync pull) |

## Known differences (by design)

| Item | Web | Mobile | Why |
|---|---|---|---|
| Fine-grained permission ticks | Full editor | Templates only (custom permissions are kept) | Small screen; templates cover normal use. |
| Agreement template editing | Yes | Choose only | Long legal text is edited on a computer. |
| Branch create/rename | Settings → Branches | More → Branches (owner) | Same capability. |
| Finance report | Server report | Computed from the phone's entries (same maths, Karachi months) | Works offline; identical once synced (`finance_test`). |

## Performance (5,000 of each: clients, properties, deals, transactions, agreements)

Run with `PERF=1 npx jest tests/perf.test.ts` (server). Median of 5 runs on the development laptop, in-memory MongoDB, 2026-11-03:

| Request | ms |
|---|---|
| Clients page 1 / page 200 / name search / block filter / size filter | 22 / 319 / 47 / 50 / 58 |
| Properties page 1 / ID search / combined filters / stale verification | 20 / 14 / 19 / 39 |
| Global search · dashboard (uncached) | 56 · 142 |
| Deals board (100 open) · deals filtered page 50 · commission report | 61 · 33 · 270 |
| Transactions page 1 · type+date filter · finance report by month / category | 48 · 25 · 62 / 53 |
| Agreements page 1 · expiring in 30 days · number search | 24 · 30 · 19 |
| Sync pull, first page (500 records) | 379 |
