# Selling Stateown as SaaS on Hostinger

One Stateown installation serves every agency. Each agency works at its own address,
`https://<agency>.<your-domain>` (for example `https://yousuf.stateown.pk`), and only that agency's
staff can sign in there. The bare domain (`https://stateown.pk`) is the shared address: new agencies
sign up there, platform staff manage subscriptions there, and the phone app talks to it.

Replace `stateown.pk` below with your own domain.

## 1. Choose the Hostinger product

| What Stateown needs | **Hostinger VPS** (recommended) | Hostinger Business / Cloud web hosting (Node.js apps) |
|---|---|---|
| A subdomain per agency | One wildcard DNS record `*` and one wildcard certificate cover every agency automatically | Each agency's subdomain is added by hand in hPanel and attached to the app (check in hPanel that several domains can point at one Node.js app before selling) |
| Live updates between colleagues | WebSockets | No incoming WebSockets on these plans: Stateown falls back to HTTP long-polling automatically (works, uses a little more traffic) |
| Background jobs (reminders, overdue follow-ups, automation, rent and installment status, data retention) | Run inside the app (`JOBS_ENABLED=true`) | Timers stop on restarts: use hPanel's cron (section 4.3) |
| Database (MongoDB) | MongoDB Atlas, or MongoDB on the VPS | MongoDB Atlas only (MongoDB cannot run on these plans) |
| Uploaded photos and documents | Local disk outside the app folder | Cloudinary (recommended) — the app folder is replaced on every deploy |
| Long requests | No limit | Requests stop after 120 seconds (large exports: filter first) |

**Recommendation:** a Hostinger **VPS (KVM 2: 2 vCPU, 8 GB RAM)** with Ubuntu 24.04 and MongoDB Atlas.
It supports any number of agencies without manual steps per client. Use web hosting only for a small start,
and plan to move to a VPS as you grow — the application and data move unchanged.

## 2. DNS (both options)

In hPanel → Domains → DNS records for `stateown.pk`:

| Type | Name | Points to |
|---|---|---|
| A | `@` | VPS IP (or the IP hPanel shows for the web app) |
| A | `*` | same IP — every agency subdomain (VPS) |
| CNAME | `www` | `stateown.pk` |

On web hosting, instead of `*`, each agency's subdomain is created in hPanel (section 4.2).

## 3. Settings (`.env`)

```bash
NODE_ENV=production
PORT=4000
MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/stateown?retryWrites=true&w=majority
JWT_SECRET=<64 random characters>
JWT_REFRESH_SECRET=<64 different random characters>
COOKIE_SECURE=true
TRUST_PROXY=1
RATE_LIMIT_ENABLED=true
APP_WEB_URL=https://stateown.pk
PUBLIC_API_URL=https://stateown.pk
CORS_ORIGINS=https://stateown.pk,https://www.stateown.pk
TENANT_BASE_DOMAIN=stateown.pk
PLATFORM_ADMIN_EMAILS=you@yourcompany.pk
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@stateown.pk
SMTP_PASS=<mailbox password>
MAIL_FROM="Stateown <no-reply@stateown.pk>"
# VPS:
JOBS_ENABLED=true
STORAGE_DRIVER=local
UPLOAD_DIR=/var/lib/stateown/uploads
# Web hosting instead:
# JOBS_ENABLED=false
# CRON_SECRET=<40 random characters>
# STORAGE_DRIVER=cloudinary
# CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=...
```

Production mode refuses to start without SMTP, secure cookies and rate limiting, and never loads demo data.
Generate secrets with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

MongoDB Atlas: create a free or M10 cluster, a database user, and allow the server's IP under Network Access.
Atlas is already a replica set, which Stateown needs for transactions. (MongoDB on a VPS must be started as a
one-node replica set: `replication.replSetName: rs0` in `/etc/mongod.conf`, then `rs.initiate()` once.)

## 4. Install

### 4.1 VPS (recommended)

```bash
# Node 22 LTS, git, nginx, certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-dns-cloudflare
sudo npm install -g pm2

sudo mkdir -p /var/lib/stateown/uploads /opt/stateown && sudo chown -R $USER /var/lib/stateown /opt/stateown
git clone https://github.com/<you>/<repo>.git /opt/stateown && cd /opt/stateown
nano .env            # the settings from section 3
npm ci && npm run build
pm2 start server/dist/server.js --name stateown --cwd /opt/stateown
pm2 save && pm2 startup
```

Nginx (`/etc/nginx/sites-available/stateown`), one block for the domain and every agency:

```nginx
server {
  listen 443 ssl http2;
  server_name stateown.pk www.stateown.pk *.stateown.pk;
  ssl_certificate     /etc/letsencrypt/live/stateown.pk/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/stateown.pk/privkey.pem;
  client_max_body_size 110m;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;     # live updates (WebSocket)
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
  }
}
server { listen 80; server_name stateown.pk *.stateown.pk; return 301 https://$host$request_uri; }
```

Wildcard certificate: Let's Encrypt issues `*.stateown.pk` only through a DNS check. The simplest way that
renews by itself is to use Cloudflare's free DNS for the domain (change the nameservers in hPanel), create a
Cloudflare API token with "Zone → DNS → Edit", save it in `/root/cloudflare.ini`, then:

```bash
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/cloudflare.ini -d stateown.pk -d '*.stateown.pk'
sudo ln -s /etc/nginx/sites-available/stateown /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

(Keeping DNS at Hostinger works too, with `certbot --manual --preferred-challenges dns`, but then the
certificate must be renewed by hand every 90 days.)

Updates: `cd /opt/stateown && git pull && npm ci && npm run build && pm2 reload stateown`.
Backups: a daily `mongodump` (or Atlas backups) and a copy of `/var/lib/stateown/uploads`.

### 4.2 Business / Cloud web hosting

1. hPanel → Websites → **Add website → Node.js web app** on `stateown.pk`; connect the GitHub repository
   (branch `main`).
2. Node.js version **22**; build command `npm ci && npm run build`; start file `server/dist/server.js`
   (start command `node server/dist/server.js`).
3. Add the settings of section 3 as environment variables (with the web-hosting lines).
4. For **each agency**: hPanel → Domains → Subdomains → create `<agency>.stateown.pk`, attach it to the same
   Node.js app, and turn on its free SSL. Do this before giving the agency its address.

### 4.3 Background jobs on web hosting

hPanel → Advanced → Cron jobs → every minute (`* * * * *`):

```bash
curl -fsS -X POST -H "X-Cron-Secret: <CRON_SECRET>" https://stateown.pk/api/internal/jobs > /dev/null
```

Each job still runs at its own pace (reminders every minute, automation every 10 minutes, data retention daily):
the call runs only the jobs that are due. Without `CRON_SECRET` the endpoint does not exist.

## 5. The phone app

One app serves every agency. Build it against the shared address — GitHub → Actions → "Build Android APK" →
Run workflow with `api_base_url = https://stateown.pk`. Staff sign in with their e-mail and password and the
server opens their own agency.

## 6. Selling to a new agency

1. The agency signs up at `https://stateown.pk/register` and picks its address (`yousuf` →
   `https://yousuf.stateown.pk`), or you create it for them there. It starts on the trial plan.
2. After sign-up the browser moves to the agency's own address; the owner signs in there and adds staff.
3. You manage plans, payments and addresses in **Settings → Platform administration** (only for e-mails listed in
   `PLATFORM_ADMIN_EMAILS`). Changing an agency's address breaks its old links; on web hosting add the new
   subdomain in hPanel first.

## 7. Check before going live

- `https://stateown.pk/api/health` → `{"status":"ok","database":"up"}`.
- Sign up two test agencies; each opens only at its own address, and one agency's staff get "Incorrect email or
  password" at the other's address.
- `https://unknown-name.stateown.pk` shows "Agency not found".
- A password-reset e-mail arrives and its link opens the agency's own address.
- On web hosting: the cron job runs (Settings → Automation shows recent alerts) and live updates work in two
  browser windows (a few seconds' delay is normal with long-polling).
