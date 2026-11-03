# Role & Permission Matrix

Source of truth: `shared/src/permissions.ts` (permission catalogue), `shared/src/roles.ts` (roles and
templates), `server/src/routes/*.ts` (route guards) and the services listed below. Every "✅" in
this document is enforced **by the API**; the web and mobile apps only hide controls the user
cannot use. Verified by `server/tests/members.test.ts`, `tenancy.test.ts`, `e2e.scenarios.test.ts`
(Scenario E), `enhancements.test.ts` and `ratelimit.test.ts`.

## 1. Role inventory

| Role / access level | Status | How it works |
|---|---|---|
| **Business Owner** (`OWNER`) | ✅ Implemented | Created at registration. Always holds every permission, including permissions added in future releases. Cannot be suspended, removed or edited by members. |
| **Member** (`MEMBER`) | ✅ Implemented | Everyone the owner adds. Access is exactly the permissions ticked on the membership. |
| ↳ Standard member template | ✅ Implemented (template) | The family-business default (the "son" in the original brief): all day-to-day work, reports and exports, no deletes, no administration. |
| ↳ Manager template | ✅ Implemented (template) | Standard member **plus** deleting clients/properties/owners/documents, managing everyone's notes, and the audit log. No user or business administration. |
| ↳ Agent template | ✅ Implemented (template) | Day-to-day work on clients, properties, owners, matches, follow-ups, notes and documents. No reports/exports, no deletes, no administration. |
| ↳ Salesperson template | ✅ Implemented (template) | Read everything; create/update clients and follow-ups; add notes. Cannot add or edit properties/owners, change match status or upload documents. |
| ↳ Accountant (reports) template | ✅ Implemented (template) | Read everything; dashboard analytics, reports and Excel/PDF exports. No data entry. |
| ↳ Read-only viewer template | ✅ Implemented (template) | Read everything; cannot create, edit, delete, export or administer. |
| Platform Super Admin | ❌ Not implemented | There is no cross-tenant admin console. Each business self-registers and is isolated. Platform operations (backups, suspending a tenant, support access) are done by the operator at the infrastructure/database level. See roadmap item E-07. |
| Branch Manager | ✅ Implemented (Phase 2, as a configuration) | A member with the Manager template whose **branch access** is limited to selected branches (Users → Branch access). The API scopes every read, write, report, export and sync pull to those branches. |
| Property Manager (rentals/tenancy) | ⚠️ Partly | Tenancy (rent) agreements with renewal follow-ups 30/7 days before the end date are implemented (Phase 2). Monthly rent collection is not. |
| Commission Manager | ✅ Implemented (Phase 2, via `commissions:manage`) | The Accountant template records commission received and agent payouts on every deal and keeps income & expenses; Owner, Standard member and Manager can too. |
| `ADMIN`, `MANAGER`, `AGENT`, `SALESPERSON`, `ACCOUNTANT`, `VIEWER` role codes | Reserved | Presets exist in code, but only `MEMBER` is assignable (`ASSIGNABLE_ROLES`). The templates above apply those presets as a MEMBER's permission set. |

> Templates are a convenience in **Users → Add user / Permissions**. After applying one, the owner
> can still tick or untick individual permissions; the user card then shows "Custom".

## 2. Capability matrix

Legend: ✅ allowed · ❌ blocked by the API (HTTP 403) · 👁 read-only

| Capability | Owner | Standard member | Manager | Agent | Salesperson | Accountant | Viewer | Enforced by |
|---|---|---|---|---|---|---|---|---|
| Sign in, change own password, manage own sessions, language/theme | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `authenticate` |
| Dashboard KPI tiles, My Day, global search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | authenticated; search returns only types the user can read |
| Dashboard analytics charts (incl. lead sources, team performance) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `reports:read` |
| View clients | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 | `clients:read` |
| Add / edit clients, requirements | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `clients:create` / `clients:update` |
| Delete (archive) clients | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `clients:delete` |
| Log call/WhatsApp contact on a client | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `clients:read` |
| View properties | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 | `properties:read` |
| Add / edit properties, change status, confirm availability, upload photos | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `properties:create` / `properties:update` |
| Delete properties | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `properties:delete` |
| View owners | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 | `owners:read` |
| Add / edit owners | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `owners:create` / `owners:update` |
| Delete owners | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `owners:delete` |
| View matches | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 | `matches:read` |
| Change match status, recalculate matches | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `matches:manage` |
| View follow-ups | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 | `followups:read` |
| Create / reschedule / complete follow-ups | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `followups:create` / `followups:update` |
| Delete follow-ups | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `followups:delete` |
| Read notes on a record | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | read permission of that record type |
| Add notes; edit/delete **own** notes | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `notes:create` |
| Edit/delete **anyone's** notes | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `notes:manage_all` |
| Activity timeline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | entries about record types the user can't read are hidden |
| View / download documents (signed, expiring links) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `documents:read` |
| Upload / rename documents | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `documents:upload` |
| Delete documents | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `documents:delete` |
| Reports page; Excel / PDF exports | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `exports:create` (+ `reports:read` for analytics) |
| See the team list | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | `members:read` |
| Add users, change permissions, suspend/remove users, set temporary passwords | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `members:manage` (+ owner can never be modified) |
| Business profile (name, timezone, default unit) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `business:manage` |
| Settings: client categories, matching weights/thresholds, size units, reminders | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `settings:manage` |
| Audit log | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `audit:read` |
| Offline sync (mobile) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | each queued change re-checked against the same write permission (`syncService` `WRITE_PERMS`) |
| Branch access | — | — | — | — | — | — | — | not applicable (no branches) |
| Sensitive financial data | — | — | — | — | — | — | — | asking/minimum/expected prices are visible to everyone with `properties:read`; there is no separate "financial" permission (see §4) |
| **Phase 2** | | | | | | | | |
| See branches; use the branch switcher | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | any member (only their branches) |
| Create / rename / archive branches | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `branches:manage` |
| Set a user's branch access | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `members:manage` |
| View deals | ✅ all | ✅ all | ✅ all | ✅ own | ✅ own | 👁 all | 👁 all | `deals:read` (+ `deals:read_all` for all deals) |
| Create / edit deals, move stages | ✅ | ✅ | ✅ | ✅ own | ✅ own | ❌ | ❌ | `deals:create` / `deals:update` (agents only on deals they are on) |
| Delete deals | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `deals:delete` |
| Record commission payments and agent payouts | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `commissions:manage` |
| Commission report | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `deals:read` + `reports:read` |
| View income & expenses, finance report | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 👁 | `finance:read` (report also `reports:read`) |
| Add income / expense entries, receipts | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `finance:create` (+ `documents:upload` for receipts) |
| Edit entries, manage finance categories | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `finance:update` |
| Delete entries | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | `finance:delete` |
| View agreements, print PDFs | ✅ | ✅ | ✅ | ✅ | ❌ | 👁 | 👁 | `agreements:read` |
| Draft / edit agreements, regenerate, change status, attach signed copy | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `agreements:create` / `agreements:update` |
| Delete agreements (not signed ones) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `agreements:delete` |
| Add / edit agreement templates | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | `templates:manage` |
| Property brochures (PDF, image, share text) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | `properties:read` + `exports:create` |

## 3. Cross-cutting guarantees (all roles)

* **Business isolation.** Every query is scoped to the signed-in user's business by the repository
  layer, and a Mongoose plugin throws if any query on a tenant collection lacks `businessId`
  (`server/src/models/plugins/tenant.ts`). A record from another business returns **404**, not 403.
  Verified in `tenancy.test.ts` and Scenario E.
* **Permission changes apply immediately.** The membership is re-read on every request; a suspended
  or removed member is signed out and their live (Socket.IO) connection is closed.
* **Owner protection.** The owner cannot be suspended, removed or have permissions edited by anyone.
* **Audit.** Sign-ins, member changes, price/status changes, deletes and exports are written to the
  audit log (readable with `audit:read`).

## 4. Gaps found during this audit and what was done

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | `GET /api/activities` returned every timeline entry to any member, including entries about record types the member could not read (e.g. client names for a member without `clients:read`). | Medium (only reachable with custom permission sets) | **Fixed** — entries touching unreadable record types are filtered server-side; test `activity timeline permissions`. |
| 2 | Permission sets could only be built checkbox-by-checkbox, so "Agent" or "Viewer" access was easy to get wrong. | Usability / risk of over-granting | **Fixed** — permission templates in Users → Add user / Permissions; user cards show the template name or "Custom". |
| 3 | Refresh-token rate limit (120 / 15 min per IP) would sign out an office of users sharing one internet connection. | High for multi-user offices | **Fixed** — limit per refresh token plus a 3000 / 15 min IP ceiling; test `ratelimit.test.ts`. |
| 4 | No separate permission for commercially sensitive prices (minimum / expected final price). | Low–medium, depends on customer | **Open** — roadmap P2 item R-09 ("price confidentiality permission"). Until then, owners should only add trusted staff. |
| 5 | No platform super-admin. | Product scope | **Open** — roadmap E-07. |


## Phase 2 notes

* **Existing users keep exactly their access.** New permissions are added to the templates, which only apply when a template is
  chosen. Members created before Phase 2 keep their stored permission list (so they do not get the new modules until the owner
  applies a template or ticks the boxes); every existing member got `branchAccess: ALL` from migration 001. Owners always have
  every permission. Verified by `server/tests/branches.test.ts`.
* Agents see only the deals they are an agent on (also in sync pulls, exports and the commission report); a deal payment made by
  an agent's colleague still creates the income entry for the business.
* Branch scope is enforced in the repository layer for every branched collection (list, get, update, delete, aggregate, sync
  pull, exports, dashboard), and `X-Branch-Id` can only narrow it. Tests: `branches.test.ts`, `deals.test.ts`,
  `finance.test.ts`, `agreements.test.ts`, `brochures.test.ts` (each has tenant + branch + permission-template cases).
* The Agent template has no `exports:create`, so agents cannot make brochures unless the owner ticks it for them.
