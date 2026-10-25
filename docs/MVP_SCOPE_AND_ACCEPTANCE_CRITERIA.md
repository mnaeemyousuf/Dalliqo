# MVP Scope & Acceptance Criteria

Goal: a working, credible Real Estate CRM that can be **demonstrated to prospective customers**,
used to qualify leads, and deployed for a first customer — without fake data or fake integrations.
Status reflects the code and tests as of 18 October 2026 (see FINAL_QA_REPORT.md for evidence).

Status key: ✅ Done & tested · 🟡 Done, needs environment/device verification · ⏳ Not started · ❌ Out of scope.

## A. Mandatory MVP

| # | Capability | Business value | Dependencies | Status | Acceptance criteria (all must hold) |
|---|---|---|---|---|---|
| A1 | Secure login/logout, sessions | Trust; protects client data | — | ✅ | Wrong password rejected; 15-min access token; refresh rotates; logout revokes; no token in browser storage |
| A2 | Account & business setup | Self-service onboarding | — | ✅ | Register creates owner + business + default categories/settings in one transaction |
| A3 | Add team members securely | Father + son / staff share one account | — | ✅ | Owner adds a member with a temporary password; member must change it at first sign-in |
| A4 | Role-based access (permission templates) | Right access per job | — | ✅ | Each template's blocked actions return HTTP 403 from the API (role matrix §2) |
| A5 | Business-level data isolation | Non-negotiable for SaaS | — | ✅ | Another business's record IDs return 404; search/exports/realtime never leak (Scenario E) |
| A6 | Password recovery | Users can self-serve | SMTP in production | 🟡 | Reset link e-mailed, single-use, expires, revokes sessions (logic tested; real e-mail needs SMTP) |
| A7 | Client CRUD, archive, search | Core CRM | — | ✅ | Create → reopen shows saved values; search by name/mobile; archive removes from lists, keeps audit (Scenarios A, F, H) |
| A8 | Contact info, categories, requirements (budget, location, size, purpose) | Matching input | — | ✅ | Multiple requirements; partial edits never wipe other fields (regression test) |
| A9 | Notes and follow-up dates on clients | Memory of the relationship | — | ✅ | Notes timeline; follow-ups on client page |
| A10 | Matching properties on client page | Finds the right stock fast | Matching | ✅ | Matches tab lists properties ≥ store threshold with score and reasons |
| A11 | Property CRUD, search, filter, archive; unique IDs | Inventory | — | ✅ | IDs RE-000001… unique under concurrency; filters by type, status, area, society, block, price, size, owner |
| A12 | Property images & documents | Credible listings | Storage driver | ✅ (local) / 🟡 (Cloudinary) | Upload JPEG/PNG/WebP/MP4 and PDF/DOCX/XLSX; disguised files rejected; thumbnails; private documents via expiring links |
| A13 | Status changes recorded | Accountability | — | ✅ | Only valid transitions; activity + audit entry "RE-… Available → Reserved" |
| A14 | Matching clients on property page | Two-way matching | — | ✅ | Matching clients tab with score and reasons |
| A15 | Smart matching: automatic, transparent, de-duplicated, recalculated, no stale-as-live | Core differentiator | — | ✅ | Scenario C: score 100 with reasons → budget cut lowers score → restored to exactly one match at 100; sold property's matches go STALE |
| A16 | Follow-ups: schedule, link to client/property, views (today/upcoming/overdue/done), complete, **reschedule** | Never miss a call | — | ✅ | Scenario D + reschedule test (overdue → pending, timeline entry) |
| A17 | Notifications only when infrastructure is configured | No fake integrations | Firebase for push | ✅ in-app / 🟡 push | In-app notifications work; push sends only when Firebase credentials exist (otherwise logged as disabled) |
| A18 | Daily-work dashboard (My Day) | Daily command centre | — | ✅ | Seven sections from live data |
| A19 | Real KPIs, search, filters, empty/loading/error states | Credibility | — | ✅ | Every tile is a database aggregate; empty states shown; network errors show a friendly message |
| A20 | Team collaboration with backend permissions; consistent updates | Father + son | Socket.IO | ✅ | Record created by one user visible to the other; live indicator; permission changes apply on next request |
| A21 | Sync status where sync exists | Trust in offline mode | Mobile | ✅ (logic) / 🟡 device | Sync chip and Sync screen show pending/failed/conflicts |
| A22 | Professional responsive web UI | First impression | — | ✅ | Desktop + tablet layouts captured; light/dark; English/Urdu RTL |
| A23 | Professional Flutter UI | Field use | Android SDK to build | 🟡 | Analyzer clean; widget tests pass; **APK not yet built/installed** |
| A24 | Validation & useful errors | Data quality | — | ✅ | Server Zod validation with field details; client-side checks; no stack traces |
| A25 | Activity history for important actions | Accountability | — | ✅ | Client/property/follow-up timelines; audit log |
| A26 | Secure secrets and uploads | Security | — | ✅ | No secrets in clients; magic-byte validation; size limits; signed URLs |
| A27 | Setup instructions, reliable demo data, reproducible launch | Sales readiness | — | ✅ | `npm run demo` seeds 6 role accounts, 30 properties (14 with labelled demo images), 20 clients, 10 owners, ≥50 matches, follow-ups |
| A28 | Duplicate client detection | Data quality (research F2) | — | ✅ | Same number (any format) warns with link to existing client; "Save anyway" works; offline creations never rejected |
| A29 | Listing availability verification | Credibility (research F3) | — | ✅ | New listings verified on creation; >30 days flagged; "Confirm availability" records who/when/note |

## B. Important enhancements

| # | Capability | Business value | Dependencies | Status | Acceptance criteria |
|---|---|---|---|---|---|
| B1 | Excel/PDF exports | Reporting, sharing with partners | — | ✅ Excel / ✅ PDF | Filtered exports open in Excel/PDF readers; Urdu renders in Excel and (since 25 Oct 2026) in PDF |
| B2 | Offline-first mobile with conflict handling | Work during outages (research F5) | Device test | ✅ logic / 🟡 device | Airplane-mode create → sync on reconnect; conflict prompt for price/status |
| B3 | Urdu RTL | Wider adoption | — | ✅ web / 🟡 mobile visual | Language switch flips layout; all new strings translated |
| B4 | PIN & biometric lock | Device security | Device | 🟡 | PIN required on resume; biometrics if enrolled |
| B5 | Push notifications | Timely reminders | Firebase project | 🟡 | Reminder arrives on a closed app |
| B6 | WhatsApp property sharing to a matched buyer | Fits WhatsApp-first market (F4) | WhatsApp installed | ✅ | Pre-filled message with ID, type, location, price; contact logged |
| B7 | Lead sources & conversion, team performance | Owner insight (F12, F1) | — | ✅ | Chart and table computed from live data |
| B8 | Permission templates | Safe onboarding of staff | — | ✅ | One click applies a tested permission set |
| B9 | Uncontacted-lead alert | Speed to lead (F1) | — | ⏳ | Alert when no contact logged within N hours (R-01) |
| B10 | Bulk import from Excel | Onboarding dealers with spreadsheets | — | ⏳ | Import with preview and duplicate check (R-02) |
| B11 | Brochure / share card with QR | Marketing | — | ⏳ | Branded PDF/image per property (R-04) |

## C. Future enterprise features

| # | Capability | Business value | Dependencies | Status |
|---|---|---|---|---|
| C1 | Deal pipeline & commission tracking | Fewer commission disputes (F6) | Deals model; legal/tax review | ⏳ (R-05, R-06) |
| C2 | Rentals / tenancy (incl. Sindh tenant registration checklist) | Karachi rentals (F9) | Legal review | ⏳ (R-11) |
| C3 | Multi-branch, branch managers | Larger agencies | Branch model | ⏳ (E-01) |
| C4 | Income & expense, agreements, contracts, e-signature | Back office | Providers, legal | ⏳ (E-02, E-03) |
| C5 | WhatsApp Business API | Inbound lead capture | Meta verification, paid | ⏳ (R-12) |
| C6 | AI search/drafting/summaries | Productivity | Model provider, opt-in | ⏳ (R-08, E-05) |
| C7 | Platform super-admin & billing | Run as multi-customer SaaS | — | ⏳ (E-07, E-08) |

## Readiness verdict

* **Customer-demo ready (web):** Yes — all Mandatory MVP items marked ✅ were exercised against the
  running demo and by automated tests.
* **Customer-demo ready (mobile):** Not yet on a phone — the app is complete in code and passes its
  tests, but an Android build must be produced on a machine with the Android SDK (A23).
* **First production deployment:** Possible after the 🟡 items for the chosen setup are closed:
  SMTP, Cloudinary (or another storage driver), Firebase (if push is sold), Docker/hosting run,
  HTTPS, backups — see FINAL_DELIVERY_REPORT.md §14.
