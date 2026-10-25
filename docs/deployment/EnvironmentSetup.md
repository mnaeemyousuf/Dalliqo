# Environment setup

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20 LTS or newer (22 recommended) | API, web, shared |
| npm | 10+ | workspaces |
| Docker Desktop | current | local MongoDB replica set (or use MongoDB Atlas) |
| Flutter SDK | 3.27+ (Dart 3.6+) | mobile app |
| Android Studio / Xcode | current | emulators, signing |

## API

```bash
npm install
```
```bash
cp .env.example server/.env
```
Generate two different secrets and put them in `server/.env` as `JWT_SECRET` and `JWT_REFRESH_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Start MongoDB (replica set) only:
```bash
docker compose up -d mongo
```
Run the API with reload:
```bash
npm run dev:server
```
Health check: `http://localhost:4000/api/health`.

Without SMTP configured (development), password-reset emails are written to the API log instead of sent.

## Web CRM

With the API running on port 4000:

```bash
npm run dev:web
```

Open http://localhost:5173 (the Vite dev server proxies `/api` and `/socket.io` to the API).

## Demo data

Against your own database (refuses to run in production, `--reset` recreates it):

```bash
npm run seed
```

Or run everything in memory with `npm run demo` (see the root README).

## Media storage

Without Cloudinary credentials, uploads are stored on disk under `UPLOAD_DIR` (default `server/uploads`)
and served through signed links. Set `CLOUDINARY_*` (or `STORAGE_DRIVER=cloudinary`) to use Cloudinary.
Set `PUBLIC_API_URL` to the address phones and browsers use to reach the API so file links work.

## Mobile app

See [mobile/README.md](../../mobile/README.md).

## Tests

```bash
npm test
```
The suite starts its own in-memory MongoDB replica set (`mongodb-memory-server`); the first run
downloads a MongoDB binary (~600 MB, cached afterwards). No Docker or local MongoDB is needed.

> **npm 11 note:** npm 11 may print "install scripts not yet covered by allowScripts" for `argon2`,
> `esbuild` and `mongodb-memory-server`. All three work without their install scripts (prebuilt
> binaries / lazy download). Approve them with `npm install-scripts approve <pkg>` if you prefer.

## Everything in Docker

```bash
cp .env.example .env
```
```bash
docker compose up --build
```

## Third-party accounts (later phases)

| Service | Phase | What to create |
|---|---|---|
| Cloudinary | 4 | cloud name + API key/secret (server only); an upload preset is **not** used — uploads are server-signed |
| Google Cloud | 4 | Maps SDK for Android/iOS keys restricted by app signature/bundle id; a separate server key for Geocoding API restricted by IP |
| Firebase | 6 | project; Android `google-services.json`, iOS `GoogleService-Info.plist` (not committed); service-account credentials for the API |
| SMTP provider (e.g. SES, Postmark) | 1 (prod) | SMTP credentials, verified sender domain (SPF/DKIM) |
