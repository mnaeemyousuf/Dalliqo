# Deployment

## Recommended production topology

```text
            Cloudflare / CDN (TLS, WAF)
                 │
     ┌───────────┴────────────┐
     ▼                        ▼
 Web (docker/web.Dockerfile:  API containers (docker/server.Dockerfile)
 nginx + static build)        behind a load balancer with sticky sessions for Socket.IO
                              │            (or Socket.IO Redis adapter; required once >1 replica)
                              ▼
        MongoDB Atlas (replica set, M10+, continuous backup / point-in-time restore)
        Redis (Socket.IO adapter, job queue, rate-limit store)   Cloudinary/S3   Firebase FCM
```

## Configuration

* Set every variable from `.env.example` through the platform's secret manager, never in the image.
* `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=<number of proxies>`,
  `MONGO_AUTO_INDEX=false` (create indexes in a release step: `syncIndexes` script, Phase 10).
* `CORS_ORIGINS` = the exact web origin(s). The API refuses to start with insecure production settings.
* The web app and API should share a registrable domain (`app.example.com` / `api.example.com`) so
  the `SameSite=Strict` refresh cookie is sent.

## Containers

* `docker/server.Dockerfile` — API (Node 22, non-root, healthcheck on `/api/health`).
* `docker/web.Dockerfile` — React build served by nginx, which also proxies `/api` and `/socket.io`
  to the API so the browser uses a single origin.
* `docker-compose.yml` — MongoDB replica set + API + web for a single server; mount a volume at
  `UPLOAD_DIR` if you use local file storage (Cloudinary is recommended in production).

## Release checklist

1. `npm ci && npm test` (CI).
2. Build and push the API image; run the index-sync step against the target database.
3. Rolling deploy; the container healthcheck hits `/api/health`; graceful shutdown on SIGTERM
   (closes sockets and HTTP, then the DB connection, within 15 s).
4. Smoke test: register → login → `/auth/me`.

## Operations

* Logs: JSON (pino) to stdout → log platform; every response carries `X-Request-Id`.
* Backups: Atlas continuous backup with point-in-time restore; quarterly restore drill.
* Security: rotate `JWT_SECRET` by deploying a new one (all access tokens expire within 15 minutes);
  rotating `JWT_REFRESH_SECRET` signs everyone out (refresh hashes change), so schedule it.
* Mobile releases: Android App Bundle via Play Console, iOS via TestFlight/App Store; API base URL per flavour.
