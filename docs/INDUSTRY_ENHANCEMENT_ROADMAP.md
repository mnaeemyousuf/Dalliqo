# Industry Enhancement Roadmap

Inputs: `docs/REAL_ESTATE_INDUSTRY_RESEARCH.md` (findings F1–F14, assumptions A1–A7),
`docs/FINAL_REQUIREMENTS_AUDIT.md`, and code inspection. Prepared 18 October 2026.

## 1. Prioritisation framework

| Priority | Meaning |
|---|---|
| **P0** | Security, data integrity or release-blocking issue |
| **P1** | Essential for the MVP or a critical daily workflow |
| **P2** | High-value competitive enhancement |
| **P3** | Future enhancement |

Each candidate is scored 1–5 on: **V** customer value · **F** frequency of the pain · **D**
differentiation · **E** effort (5 = easiest) · **T** technical dependencies (5 = none) · **S**
privacy/security risk (5 = lowest) · **C** operating cost (5 = none) · **R** regression risk
(5 = lowest). **Score = V×2 + F×2 + D + E + T + S + C + R** (max 50).

## 2. Delivered in this release (implemented and tested)

| ID | Item | Research link | V | F | D | E | T | S | C | R | Score | Priority | Evidence of completion |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D-01 | Fix: partial client edits wiped the rest of the buyer's requirement | Audit (data integrity) | 5 | 4 | 1 | 5 | 5 | 5 | 5 | 4 | 43 | **P0** | `clientService.mergeFlatIntoRequirement`; Scenario C test |
| D-02 | Fix: refresh-token rate limit signed out offices sharing one IP | Audit (security/availability) | 5 | 4 | 1 | 5 | 5 | 4 | 5 | 4 | 42 | **P0** | `rateLimiters.ts`; `ratelimit.test.ts` |
| D-03 | Fix: activity timeline leaked entries for unreadable record types | Audit (authorization) | 3 | 2 | 1 | 5 | 5 | 5 | 5 | 5 | 34 | **P0** | `activityService.list`; test "activity timeline permissions" |
| D-04 | Duplicate client detection (web server-side check, mobile offline check, "save anyway") | F2 | 5 | 5 | 3 | 4 | 5 | 5 | 5 | 4 | 46 | P1 | API + web + mobile tests |
| D-05 | Listing availability verification ("Confirm availability", 30-day stale flag, filter, dashboard tile, audit) | F3 | 5 | 4 | 5 | 4 | 5 | 5 | 5 | 4 | 46 | P1 | API + web + mobile tests |
| D-06 | Send a matched property to the buyer on WhatsApp (pre-filled, logged on timeline) | F4 | 5 | 5 | 4 | 5 | 5 | 4 | 5 | 5 | 48 | P1 | Web + mobile; web test |
| D-07 | Follow-up reschedule (web + offline mobile) with timeline entry | MVP brief | 4 | 5 | 2 | 5 | 5 | 5 | 5 | 5 | 45 | P1 | API, web, mobile tests |
| D-08 | Lead sources & conversion chart; team performance table | F12, F1 | 4 | 3 | 3 | 4 | 5 | 4 | 5 | 5 | 40 | P1 | API test; web dashboard |
| D-09 | Permission templates (Standard, Manager, Agent, Salesperson, Accountant, Viewer) | Role audit | 4 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 41 | P1 | Users screen; role matrix |
| D-10 | Friendly "can't reach the server" message instead of "status code 500" | QA (failure handling) | 3 | 3 | 1 | 5 | 5 | 5 | 5 | 5 | 35 | P1 | Web test |
| D-11 | Index on plot number (property-ID search 165 ms → 22 ms at 5,000 listings) | QA (performance) | 3 | 4 | 1 | 5 | 5 | 5 | 5 | 5 | 38 | P1 | `perf.test.ts` |
| D-12 | Demo data: 6 role accounts, labelled demo images, lead outcomes, stale listings | Demo readiness | 4 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 41 | P1 | `seed.test.ts` |
| D-13 | UI fixes: header overflow, "1 match" plural, demo-image label placement | QA | 2 | 5 | 1 | 5 | 5 | 5 | 5 | 5 | 38 | P1 | Visual check |

## 3. Next candidates (not implemented)

| ID | Item | Research link | V | F | D | E | T | S | C | R | Score | Priority | Notes / dependencies |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | "Uncontacted new lead" alert (no call/WhatsApp logged within N hours) | F1 | 5 | 5 | 3 | 4 | 5 | 5 | 5 | 4 | 46 | P1-next | Uses existing `lastContactedAt`; job + notification |
| R-02 | Bulk import from Excel/CSV (clients, properties, owners) with duplicate check | F2, adoption | 5 | 3 | 3 | 3 | 4 | 4 | 5 | 3 | 39 | P2 | Biggest onboarding blocker for dealers with spreadsheets |
| R-03 | Configurable verification window (default 30 days) | F3, A4 | 3 | 3 | 2 | 5 | 5 | 5 | 5 | 5 | 36 | P2 | Settings field |
| R-04 | Branded property brochure / share card (PDF + image with QR) | F4, original §44 | 4 | 4 | 4 | 3 | 4 | 5 | 5 | 4 | 41 | P2 | Brochure architecture already documented |
| R-05 | Deal pipeline (inquiry → visit → offer → token → transfer) per client–property pair | F12 | 5 | 4 | 3 | 2 | 4 | 5 | 5 | 3 | 40 | P2 | New `deals` collection; foundation for commission |
| R-06 | Commission tracking per deal (% per side, paid/unpaid, split between agents) | F6 | 5 | 3 | 4 | 2 | 2 | 4 | 5 | 3 | 38 | P2 | Needs R-05; legal/tax review for invoices |
| R-07 | Transparent lead priority score on My Day (overdue, priority, recency, budget fit) | F11 | 4 | 5 | 3 | 4 | 5 | 5 | 5 | 4 | 44 | P2 | No AI required |
| R-08 | Natural-language search parsed into the existing filters | §6 AI | 3 | 3 | 4 | 3 | 3 | 4 | 3 | 4 | 34 | P2 | Model provider; show parsed filters |
| R-09 | Price-confidentiality permission (hide minimum/expected price) | F10, role audit | 4 | 3 | 3 | 4 | 5 | 5 | 5 | 4 | 40 | P2 | Field-level filtering in API + apps |
| R-10 | Identity-document permission (separate from other documents) | F10 | 4 | 2 | 3 | 4 | 5 | 5 | 5 | 4 | 38 | P2 | Legal review |
| R-11 | Rentals module: tenancy, rent schedule, police registration checklist (Sindh) | F9 | 4 | 3 | 4 | 2 | 3 | 4 | 5 | 3 | 35 | P3 | **Legal review**; enables "Property Manager" role |
| R-12 | WhatsApp Business API integration (inbound capture, templates) | F4 | 4 | 4 | 4 | 1 | 1 | 3 | 2 | 3 | 30 | P3 | Meta business verification, paid conversations |
| R-13 | DNFBP / KYC fields and checklist | F8 | 2 | 2 | 2 | 4 | 5 | 4 | 5 | 5 | 31 | P3 | **Legal review** |
| R-14 | ✅ Done 25 Oct 2026 — Urdu-capable PDF exports (embed a Nastaliq/Naskh font + shaping) | Audit | 3 | 2 | 3 | 3 | 3 | 5 | 5 | 4 | 33 | P2 | Font licence; shaping library |
| R-15 | Cursor pagination for very deep pages (page 200 of 5,000 = ~0.3–0.5 s today) | QA | 2 | 1 | 1 | 3 | 5 | 5 | 5 | 3 | 25 | P3 | Not needed below ~20k records |

## 4. Future enterprise features (not started)

| ID | Item | Notes |
|---|---|---|
| E-01 | Multi-branch (branch-scoped data and managers) | `branchId` + branch-scoped repository checks; enables Branch Manager role |
| E-02 | Income & expense tracking | Separate finance module; Accountant role gains write permissions |
| E-03 | Agreements and contracts with templates and e-signature | Legal templates per city; e-signature provider |
| E-04 | Portal publishing (Zameen/Graana feeds) | Depends on portal partner APIs |
| E-05 | AI assistants (drafting, summaries) | Opt-in, grounded, see research §6 |
| E-06 | Customer self-service (buyer portal / saved searches) | New public surface; security review |
| E-07 | Platform super-admin console (tenant list, suspension, usage, support access with audit) | Required before running as multi-customer SaaS |
| E-08 | Billing/subscriptions | Depends on E-07 |
