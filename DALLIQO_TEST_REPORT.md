# Dalliqo — Test Report

Run date: 13 Nov 2026 (Phase 3).

| Suite | Command | Result |
|---|---|---|
| API (Jest + in-memory MongoDB replica set) | `npm test -w @recrm/server` | **227 passed**, 1 skipped (22 files) |
| API typecheck | `npx tsc --noEmit -p server` | clean |
| Web (Vitest) | `npm test -w @recrm/web` | **38 passed** (11 files) |
| Web typecheck | `npx tsc --noEmit -p web` | clean |
| Android (flutter test) | `flutter test` | **79 passed** |
| Android static analysis | `flutter analyze` | no issues |

## New Phase 3 tests (`server/tests/phase3.test.ts`, `mobile/test/deals_test.dart`)
- Lead scoring engine: hot/explained, cold/never-perfect, configurable weights (unit).
- Entitlements: trial/period lapse and grace, Starter modules and limits (unit).
- Leads: scoring on create, campaign/timeline, response time and score increase after contact; manual temperature, lost reason, status history; assignment history, assignee notification, unassigned inbox, permission check (403 for viewer); lead report; Excel import with duplicate and invalid rows.
- Properties: Pakistan attributes and kanal conversion, price history, category/corner/park filters; duplicate plot detection (409) and override; floor price hidden in API and offline sync; new lifecycle statuses and inventory aging.
- Deals: offer → negotiation stage, counter-offer, acceptance sets agreed price and stage, checklist actor recorded, unknown offer 404; Android offline offers/checklist coalesced into one outbox mutation.
- Subscriptions: trial on registration and `/auth/me` entitlements; module blocked on Starter (403), user limit (403); expired account read-only (402) but readable; platform-only plan changes.
- Automation: hot-lead alert raised exactly once across two runs (de-duplication); lapsed listing auto-expired; settings validation (bounds, thresholds).

## Manual / visual verification
Demo API (`npm run demo`) + web, headless Chrome screenshots at 1440 px: client list with lead scores and temperature filter, client lead panel, Reports (leads + inventory aging), Settings → Subscription. All rendered correctly with real demo data.

## Not yet covered
Device testing of the new Android screens (render-tested via unit tests only); load testing of automation jobs on large tenants.
