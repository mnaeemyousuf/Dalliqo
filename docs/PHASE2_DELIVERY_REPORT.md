# Phase 2 delivery report — gaps closed and future features built

Dalliqo (MERN + Flutter real-estate CRM) · 3 November 2026 · plan: [IMPLEMENTATION_PLAN_PHASE2.md](IMPLEMENTATION_PLAN_PHASE2.md)

Phase 2 closed three gaps from the original requirements and built the five "future features" on the API, the web CRM and the
Flutter app, then brought the two apps to parity. Every phase was committed separately and all test suites were run after each one.
Nothing below is reported as working unless it was executed; what could not be executed here is marked **BLOCKED** with the missing
dependency.

## Status

Legend: ✅ done and tested · ⚠️ done, part not verifiable here · ⛔ BLOCKED (dependency) · — not applicable

| Item | Backend | Web | Mobile | Offline | Tests | Status |
|---|---|---|---|---|---|---|
| A1 Client search by block and size | ✅ | ✅ | ✅ | ✅ local filter | ✅ server, web, Flutter, benchmark | **Done** |
| A2 "Date added" on property / client / owner | — (`createdAt`) | ✅ | ✅ | ✅ | ⚠️ display only (no automated test) | **Done** (mobile visual needs a device) |
| A3 Local follow-up reminders (offline, reboot, exact alarms, FCM de-dupe, deep link) | ✅ data-only push, `localReminders` | — | ✅ | ✅ rings offline | ✅ server + 11 Flutter tests | **Done** (real alarms ⛔ device) |
| B4 Multi-branch (+ migration, scoped access, cross-branch matching, reports, switcher) | ✅ | ✅ | ✅ | ✅ branch-limited data | ✅ 9 server + web + Flutter | **Done** |
| B1 Deal pipeline + commission | ✅ | ✅ | ✅ | ✅ (stage, payments, payouts) | ✅ 10 server + 2 web + 7 Flutter | **Done** |
| B2 Income & expense (+ auto income from commission, receipts) | ✅ | ✅ | ✅ | ✅ entries; report computed on the phone | ✅ 6 server + 3 web + 4 Flutter | **Done** |
| B3 Agreements (EN/UR templates, PDFs, statuses, versions, signed copy, renewals, lawyer note) | ✅ | ✅ | ✅ | ✅ drafts / edits / status; text and PDF online | ✅ 7 server + 3 web + 4 Flutter; PDFs inspected | **Done** |
| B5 Brochures (PDF + 1080×1350 image, QR, EN/UR, price confidentiality, WhatsApp) | ✅ | ✅ | ✅ | — online (says so) | ✅ 4 server + 1 web + 2 Flutter; images inspected | **Done** (WhatsApp share on a phone ⛔ device) |
| C Parity (matrix, mobile users / categories / settings, realtime, Urdu, pagination, benchmark) | ✅ | ✅ | ✅ | ✅ | ✅ | **Done** — [PARITY_MATRIX.md](PARITY_MATRIX.md) |
| Android APK | — | — | ⛔ | — | — | **BLOCKED**: no Android SDK / JDK on this machine (`flutter doctor`) |
| Device checks | — | — | ⛔ | — | — | **BLOCKED**: script ready — [DEVICE_TEST_SCRIPT.md](DEVICE_TEST_SCRIPT.md) |

## Commits (local, not pushed)

| Commit | Phase |
|---|---|
| `50f4df5` | A1–A3: client block + size search, "Date added" on mobile, local reminders |
| `6b02bcd` | B4: multi-branch (API, web, mobile, migration 001) |
| `ab09979` | B1: deal pipeline and commission |
| `3eadb0d` | B2: income & expense (+ migration 002, aggregate id-casting fix) |
| `57b256e` | B3: agreements (+ migration 003, Urdu PDF layout) |
| `c39f345` | B5: brochures (+ `qrcode` dependency, bundled Noto Sans) |
| (last commit) | C: parity (mobile admin screens, realtime events), benchmark, documentation, manuals |

Pushing to GitHub triggers a Render redeploy of the demo, so nothing has been pushed yet. The lockfile's hand-added Linux entries
(needed by Render's `npm ci`) were checked after adding `qrcode`: no package or `libc` entry was lost.

## Test counts

| Suite | Before Phase 2 | After Phase 2 |
|---|---|---|
| Server (Jest, in-memory MongoDB) | 166 passed, 1 skipped (16 files) | **207 passed**, 1 skipped (21 files) |
| Web (Vitest) | 25 passed (5 files) | **38 passed** (11 files) |
| Flutter `analyze` | 0 issues | **0 issues** |
| Flutter `test` | 39 passed | **76 passed** |
| Typecheck (`tsc --noEmit`, server + web) | clean | clean |
| Volume benchmark (`PERF=1`) | 5,000 clients + properties: all ≤ 0.3 s | 5,000 each of clients, properties, deals, transactions, agreements: all ≤ 0.38 s (table in [PARITY_MATRIX.md](PARITY_MATRIX.md)) |

## What was built (short)

* **Branches.** Branch model, `branchId` on every branched collection, branch scope applied inside the tenant repository (lists,
  gets, updates, deletes, aggregates, sync pulls, exports, dashboard), `X-Branch-Id` header that can only narrow, member branch
  access (all / selected). Migration 001 created a "Main Branch" per business, back-filled every record and gave every existing
  member access to all branches, so **nobody's access changed** (tested). Matching stays within a branch unless the
  `crossBranch` setting is on. Web branch switcher and settings; mobile switcher with only the user's branches on the phone.
* **Deals & commission.** Pipeline with stage history, agents and shares (must total 100%), buyer/seller commission as percent of
  the final (else agreed) price or fixed, payments and payouts with their own ids (so they work offline), commission report,
  exports, dashboard tiles. Agents see only their own deals everywhere (lists, sync, exports, report).
* **Income & expense.** Entries and EN/UR categories (11 built-ins), receipts as documents, finance report by month or category.
  A commission payment creates exactly one income entry (unique key per payment; retries and replays don't duplicate; removing
  the payment removes it; re-adding brings it back; can be switched off).
* **Agreements.** Six built-in templates (sale, rent, token receipt × English, Urdu); agreements filled from client, owner,
  property and deal; every render or hand edit kept as a version; DRAFT → SENT → SIGNED → EXPIRED / CANCELLED with signed
  agreements locked; signed-copy upload; PDFs with right-to-left Urdu and the lawyer-review note in every footer (the note is
  also on every web and mobile screen); rent agreements plan follow-ups 30 and 7 days before the end date.
* **Brochures.** A4 PDF and 1080×1350 PNG with cover photo, details, contact person and a WhatsApp QR; English or Urdu; only the
  asking price is ever printed and it can be hidden; share text and WhatsApp link.
* **Parity.** Mobile gained user management with permission templates and branch access, client categories and business
  settings; mobile and web now react live to all new entities; every new string exists in English and Urdu.

## Defects found and fixed during Phase 2

1. The tenant repository's `aggregate()` passed the business id as a string, which MongoDB aggregation does not cast, so
   aggregations matched nothing — the existing per-category client counts were always 0 (found by the finance report tests).
2. An existing e2e follow-up test failed whenever it ran after 22:30 Karachi time (it scheduled a visit 90 minutes ahead, which
   crossed midnight).
3. Urdu PDF export tables split multi-word Urdu runs (a `\s` written as `s` in a regex).
4. Urdu agreement PDFs: missing spaces between words, unmirrored brackets, and Urdu/Latin words on different baselines — found by
   rendering the PDFs and fixed with a per-word layout (simplified Unicode bidi), checked again visually.
5. The agreement PDF opened in a window created after an `await`, which browsers block as a popup.
6. The web app did not refresh on deal and branch events (B1/B4), and the mobile app ignored every new entity's events.
7. Users without report access (Viewer template) saw the Income & expense Report tab and got an error, and download buttons
   showed for users without export access — found while re-capturing the manuals as the Viewer; the tab and buttons now follow
   the permissions (web test added; the mobile report button too).

## Documentation updated

[API.md](api/API.md) (Phase 2 endpoints), [Database.md](database/Database.md) (new collections, indexes, migrations, sync
fields), [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md) (new permissions per template, branch manager / commission
manager now implemented), [FINAL_REQUIREMENTS_AUDIT.md](FINAL_REQUIREMENTS_AUDIT.md) (Phase 2 addendum),
[PARITY_MATRIX.md](PARITY_MATRIX.md), [DEVICE_TEST_SCRIPT.md](DEVICE_TEST_SCRIPT.md), Architecture §6 and Roadmap, README feature
list and document index, and the six role manuals (new chapter "Deals, money, agreements and brochures", screenshots re-captured as
each demo user — see [user-manuals/README.md](user-manuals/README.md)).

## Open risks and limitations

| Risk | Impact | Mitigation / next step |
|---|---|---|
| No APK built, nothing run on a phone (no Android SDK here) | Local alarms, reboot restore, exact-alarm permission, share sheet, QR scanning and on-screen Urdu are unverified on a device | Run [DEVICE_TEST_SCRIPT.md](DEVICE_TEST_SCRIPT.md) on a machine with Android Studio before release |
| Firebase, Cloudinary and Maps credentials not available | Push de-duplication against real FCM and brochure cover images from Cloudinary are untested (local storage path is tested) | Configure keys in staging and run device script §1.7 and §6 |
| Existing members do not automatically get the new modules | By design (their access must not change); an owner must apply a template or tick the new permissions | Mention in release notes; the Users screen shows "Custom" for older members |
| Agents cannot make brochures (no `exports:create` in the Agent template, as planned) | Field agents may expect it | Owner can tick "exports" for an agent; revisit the template with the customer |
| Records moved to another branch stay on phones that can no longer see that branch until their next full re-sync | A restricted user may briefly see a moved record offline | Documented assumption; a forced re-sync on branch-access change is a possible follow-up |
| Agreement templates are generic | Not legal advice; provincial stamp-paper rules differ | Lawyer-review note on every screen and page; owners can copy and adapt templates |
| Urdu PDF/PNG layout uses a simplified bidi algorithm | Unusual mixes of punctuation, numbers and Latin inside Urdu could be ordered imperfectly | Samples inspected (agreements, brochures); full UBA would need a dedicated library |
| Mobile finance report is computed from the phone's entries | Commission income appears only after the deal payment syncs and the server creates it | Same maths and Karachi month boundaries as the server (tested); shows the synced state |
| Render free plan demo (in-memory database, sleeps) | Demo data resets; migrations re-run on every start (idempotent) | Use MongoDB Atlas for persistence |
| Not pushed / not deployed | The live demo still runs the pre-Phase-2 build | Push `main` after review; Render redeploys automatically |
