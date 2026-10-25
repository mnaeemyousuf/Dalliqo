# Authentication & security architecture

## Tokens ✅

| | Access token | Refresh token |
|---|---|---|
| Format | JWT HS256, `iss=recrm-api`, `aud=recrm-clients` | 384-bit random, opaque |
| Claims | `sub` userId, `bid` businessId, `mid` memberId, `sid` sessionId | — |
| Lifetime | 15 min (`JWT_ACCESS_TTL_SECONDS`) | 30 days sliding (`REFRESH_TOKEN_TTL_DAYS`) |
| Stored server-side | no | only `HMAC-SHA256(JWT_REFRESH_SECRET, token)` in `sessions` |
| Mobile storage | memory + `flutter_secure_storage` | `flutter_secure_storage` (Keychain / Android Keystore) |
| Web storage | **memory only** | httpOnly, `Secure`, `SameSite=Strict`, `Path=/api/auth` cookie |

The access token is **not** trusted on its own. Each request (and each socket handshake) loads the
session, user and membership (`resolveAuthContext`), so these take effect immediately rather than
after up to 15 minutes:

* logout / logout-all / device revoked
* password changed or reset
* member suspended / removed
* a permission removed

Cost: three indexed point lookups per request, run in parallel. A short in-process cache keyed on
`sid` can be added if profiling shows a need.

## Flows ✅

**Register** — creates `users` + `businesses` + `businessMembers(OWNER)` + audit entry in one
transaction, then opens a session.

**Login** — constant-time behaviour for unknown emails (dummy argon2 verify); identical error for
wrong email and wrong password; 5 failures ⇒ 15-minute lock (HTTP 423); picks the user's default
business membership; records `auth.login` in the audit log.

**Refresh (rotation + reuse detection)**
```text
client presents R1 ─► hash(R1) == session.tokenHash ?
     yes ─► CAS update tokenHash=hash(R2), prevTokenHash=hash(R1) ─► return R2 + new access token
     no  ─► hash(R1) == some session.prevTokenHash ?  (R1 was already rotated ⇒ it was copied)
              yes ─► revoke that session, audit, disconnect sockets ─► 401 REFRESH_TOKEN_REUSED
              no  ─► 401 INVALID_REFRESH_TOKEN
```
The compare-and-swap means two concurrent refreshes cannot both succeed. **Clients must refresh
single-flight** (one in-flight refresh; queued requests wait for it). Both the Dio and Axios
interceptors implement this.

**Forgot / reset password** — always returns 200; emails a link
`APP_WEB_URL/reset-password?token=…` plus the same code for the mobile app; token stored hashed,
30-minute TTL, single use (atomic consume), previous unused tokens invalidated; on reset every
session is revoked.

**Change password** — requires the current password; rejects reuse of the same password; keeps the
current device signed in and revokes all others.

**Members with temporary passwords** — owner-created members (`mustChangePassword=true`) can only
call `/auth/me`, `/auth/change-password`, `/auth/logout*` until they set their own password; sockets
are refused.

**Session management** — `GET /auth/sessions` lists devices (type, name, IP, last used);
`DELETE /auth/sessions/:id` signs one out.

## Authorization ✅

* Permissions (`shared/src/permissions.ts`) are the unit of authorization; roles are presets
  (`shared/src/roles.ts`). OWNER always resolves to *all* permissions, including ones added later.
* Routes declare `requirePermission(...)`. Record-level rules (e.g. "edit only your own notes unless
  `notes:manage_all`") live in services.
* Owners cannot be modified through the members API, members cannot modify themselves, and only
  roles in `ASSIGNABLE_ROLES` can be granted (currently `MEMBER`).

## PIN & biometric unlock (mobile) ✅

This is a **local unlock gate, not a server credential**. After a normal sign-in the user may set a
4-digit PIN and/or enable biometrics (`local_auth`). The refresh token is kept in secure storage
under a key that requires the app to pass the gate; PIN is stored as a salted, iterated SHA-256 hash in
secure storage; 5 wrong PINs ⇒ local sign-out (tokens wiped). Re-locks after a configurable
background timeout.

## Security controls checklist

| Control | Status |
|---|---|
| argon2id password hashing (19 MiB, t=2) | ✅ |
| Password policy (8–128, letters + digits) | ✅ |
| Rate limits: global, login (IP+email), register, password reset, refresh | ✅ |
| Account lockout | ✅ |
| Helmet headers, strict CSP for a JSON API, `x-powered-by` off | ✅ |
| CORS allow-list with credentials | ✅ |
| Zod validation on every body/query/param; unknown fields rejected on writes | ✅ |
| Body size limit 1 MB (uploads go direct-to-storage) | ✅ |
| Errors without stack traces; request id on every response | ✅ |
| Secrets & credentials redacted from logs | ✅ |
| Env validation at boot; production refuses insecure cookies, missing SMTP, disabled rate limits | ✅ |
| Tenant isolation: repository scoping + tenant guard plugin | ✅ |
| Append-only audit log | ✅ |
| File validation by magic bytes, size caps, safe generated names, private signed URLs for documents | ✅ |
| No secrets in clients: Maps keys are restricted per-platform; Cloudinary uploads are server-signed | ✅ |
