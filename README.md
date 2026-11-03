# Dalliqo

<img src="branding/svg/dalliqo-logo-horizontal.svg" alt="Dalliqo" height="56">

**Every Property. Every Lead. One Platform.** — Real Estate CRM & Business Management Platform.
Brand assets and guidelines: [`branding/`](branding/) · [`docs/branding/DALLIQO_BRAND_GUIDELINES.md`](docs/branding/DALLIQO_BRAND_GUIDELINES.md).

A multi-tenant real estate CRM for small agencies (initially a father-and-son business in Karachi):
a **Flutter** mobile app (primary, offline-first), a **React** web CRM, and a shared **Node.js +
Express + MongoDB** API that holds every business rule.

## What it does

* Register a business, add family members/staff with fine-grained permissions (owner/member roles,
  future roles ready), live permission changes, session management, password reset, app lock (PIN /
  biometrics).
* Clients with categories (9 built-in + custom, Urdu names) and multiple requirements; owners;
  properties with auto IDs (`RE-000001`), status workflow, price history, photos/videos, private
  documents, Google Maps location.
* **Automatic two-way matching** with weighted scores (type 25 · area 25 · budget 25 · size 15 ·
  purpose 10, configurable), reasons, quality bands and notifications for high-quality matches.
* Follow-ups with reminders (push + in-app), overdue tracking, **My Day**, dashboards and analytics.
* One-tap call / WhatsApp / SMS / email with contact logging; notes; activity timeline; audit log.
* **Works offline** on the phone (SQLite + outbox), syncs automatically, resolves conflicts, restores
  everything on a new phone; real-time updates between devices (Socket.IO).
* Excel and PDF exports; global search; English and Urdu (RTL); light/dark/system theme.
* **Multi-branch** offices: every record belongs to a branch, users see all or selected branches (enforced by the API, also
  offline), branch switcher, per-branch or consolidated reports, matching within a branch or across branches.
* **Deal pipeline and commission**: Inquiry → Site visit → Offer → Token → Agreement → Transfer → Won/Lost, buyer/seller commission
  (percent or fixed), agent shares, payments received and agent payouts, commission report.
* **Income & expense** with categories (English/Urdu), receipts, monthly / by-category report; commission received becomes income
  automatically (never twice).
* **Agreements**: sale, tenancy and token-receipt templates in English and Urdu, every version kept, Urdu-correct PDFs, signed-copy
  upload, renewal follow-ups 30 and 7 days before a tenancy ends, lawyer-review note on every screen and page.
* **Property brochures**: A4 PDF and a 1080×1350 share image with the agent's WhatsApp QR code, in English or Urdu; the minimum and
  expected prices are never printed.
* Follow-up reminders scheduled on the phone, so they ring even without internet; client search by block and size.

## Repository layout

```text
real-estate-crm/
├── server/     Node.js + Express + TypeScript API (routes → controllers → services → repositories → MongoDB)
├── web/        React + Vite + TypeScript CRM (TanStack Query, Zustand, Tailwind, ECharts, i18next)
├── mobile/     Flutter app (Riverpod, GoRouter, Dio, sqflite, FCM, Google Maps)
├── shared/     permissions, roles, enums, error codes, socket events, commission maths, agreement templates (server + web)
├── docs/       architecture, database, api, deployment
├── docker/     Dockerfiles + nginx config
├── docker-compose.yml
└── .env.example
```

## Try it in one command (no MongoDB needed)

```bash
npm install
```
```bash
npm run demo
```

This starts an in-memory MongoDB, seeds a demo agency (30 properties with labelled demo images,
20 clients, 10 owners, follow-ups, documents and real computed matches) and runs the API on port
4000. In a second terminal:

```bash
npm run dev:web
```

Open http://localhost:5173 and sign in with one of the demo accounts the demo prints — one per
access level: `owner@`, `son@` (standard member), `manager@`, `agent@`, `accounts@` and
`viewer@demo.recrm.test`. The password is the value of `DEMO_PASSWORD` if you set it before
starting the demo (do this for any shared demo), otherwise the local-only default printed in the
terminal. Demo data disappears when the demo stops. If port 4000 is taken, run
`npm run demo --api-port=4300` and `npm run dev:web --api-port=4300`.

See [docs/CUSTOMER_DEMO_PLAYBOOK.md](docs/CUSTOMER_DEMO_PLAYBOOK.md) for a scripted customer demo.

For the mobile app see [mobile/README.md](mobile/README.md).

## Real setup

* Local development with a persistent database: [EnvironmentSetup.md](docs/deployment/EnvironmentSetup.md)
* Everything in Docker (MongoDB + API + web on http://localhost:8080): `docker compose up --build`
* Production: [Deployment.md](docs/deployment/Deployment.md)

## Tests

```bash
npm test
```

Runs the API suite (165 tests against a real in-memory MongoDB replica set: auth, permissions,
tenant isolation, rate limits, sockets, CRM, matching, media, follow-ups/jobs, sync,
dashboard/exports, seed, customer-journey scenarios A–H) and the web suite (25 Vitest tests). The
Flutter suite (39 tests) runs with `flutter test` in `mobile/`. A volume benchmark with 5,000
clients and properties runs with `PERF=1 npx jest tests/perf.test.ts` in `server/`.

## Documentation

| Document | Covers |
|---|---|
| [Architecture](docs/architecture/Architecture.md) | system design, layering, multi-tenancy, real-time events, Flutter & React architecture, future extension points |
| [Database](docs/database/Database.md) | collections, fields, indexes, ER diagram |
| [API](docs/api/API.md) | REST conventions and every endpoint |
| [Authentication](docs/api/Authentication.md) | tokens, sessions, refresh rotation, permissions, app lock, security checklist |
| [Matching engine](docs/architecture/MatchingEngine.md) | triggers, scoring, thresholds |
| [Offline sync](docs/architecture/OfflineSync.md) | outbox, push/pull, conflicts, restore on a new phone |
| [Screen inventory](docs/architecture/ScreenInventory.md) | every mobile and web screen |
| [Roadmap](docs/architecture/Roadmap.md) | phase status and known limitations |
| [Deployment](docs/deployment/Deployment.md) · [Environment setup](docs/deployment/EnvironmentSetup.md) | running it |

### Release documents (MVP audit)

| Document | Covers |
|---|---|
| [Final delivery report](docs/FINAL_DELIVERY_REPORT.md) | what was done, test results, readiness, remaining work |
| [Requirements audit](docs/FINAL_REQUIREMENTS_AUDIT.md) | traceability matrix for every original requirement |
| [Phase 2 delivery report](docs/PHASE2_DELIVERY_REPORT.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN_PHASE2.md) | branches, deals & commission, income & expense, agreements, brochures: status, tests, risks |
| [Parity matrix](docs/PARITY_MATRIX.md) · [Device test script](docs/DEVICE_TEST_SCRIPT.md) | every feature on web and mobile; what to check on a phone |
| [MVP scope & acceptance criteria](docs/MVP_SCOPE_AND_ACCEPTANCE_CRITERIA.md) | mandatory MVP, enhancements, future features |
| [Industry research](docs/REAL_ESTATE_INDUSTRY_RESEARCH.md) · [Enhancement roadmap](docs/INDUSTRY_ENHANCEMENT_ROADMAP.md) | evidence-based priorities |
| [QA report](docs/FINAL_QA_REPORT.md) | tests executed, results, defects fixed, untested items |
| [Customer demo playbook](docs/CUSTOMER_DEMO_PLAYBOOK.md) | how to run a sales demo |
| [Role & permission matrix](docs/ROLE_PERMISSION_MATRIX.md) | roles, templates and enforced permissions |
| [User manuals (PDF)](docs/user-manuals/README.md) | one manual per access level, with real screenshots |
