# Security and load checks

Black-box scripts that attack and load a **local** demo API (`npm run demo`, default `http://localhost:4300/api`).
They refuse any other host. Each prints `ok` / `ISSUE` lines; anything other than `ok` needs a look.

| Script | What it tries |
|---|---|
| `attack-surface.mjs` | Broad sweep: cross-agency reads, injection, privilege escalation, mass assignment, dangerous uploads, token forgery and reuse, account enumeration, headers, CORS, public site |
| `cross-tenant-create.mjs` | Creating records (API and offline sync) that point at another agency's clients, owners, properties, deals, branches, categories, templates and users — each paired with a control using the agency's own ids |
| `cross-tenant-update.mjs` | The same through edits |
| `role-access.mjs` | What the demo agent, viewer and accountant can reach: notes, documents, activity, phone download, minimum price, CNIC, exports |
| `abuse-and-limits.mjs` | Link schemes, weak passwords, oversized bodies, webhook signatures, portal tokens, login brute force, Socket.IO |
| `load.mjs [users] [seconds]` | Mixed read / write traffic from many sessions; prints p50 / p95 / p99 per endpoint |

```bash
node tools/security/attack-surface.mjs
```

```bash
node tools/security/load.mjs 100 40
```

Results of the 21 Nov 2026 run are in `STATEOWN_TEST_REPORT.md` ("Security, load and workflow QA").
