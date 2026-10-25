# Customer Demo Playbook

A 30–40 minute demonstration of the web CRM using synthetic Karachi demo data. Everything shown is
the real application working against a real (in-memory) database — no mock-ups.

## 1. Target customer profile

* Property dealers and small/medium brokerages in Karachi (later Lahore/Islamabad), 2–25 people.
* Family-run offices (owner + son/relatives) and agencies with a few field agents.
* Today they run on WhatsApp, phone calls, notebooks and Excel; one or two people hold most of the
  client knowledge.
* Deal sizes in lakh/crore; plots, houses, flats, portions, shops and rentals.

## 2. Pain points addressed (research references in REAL_ESTATE_INDUSTRY_RESEARCH.md)

| Pain point | What you show |
|---|---|
| Inquiries scattered across WhatsApp, calls and notebooks | One client record with source, requirements, notes, timeline |
| Same buyer entered twice by different staff (F2) | Duplicate warning with link to the existing client |
| Hard to find the right property for a buyer | Automatic matching with a score and ✓ reasons |
| Slow follow-up, forgotten calls (F1) | Follow-ups, reminders, My Day, overdue tracking, reschedule |
| Stale or fake listings hurt credibility (F3) | "Listings to re-verify" + Confirm availability |
| WhatsApp-first communication (F4) | Send a matched property to the buyer on WhatsApp in one click |
| Owner can't see who is performing (F12) | Lead sources & conversion, team performance |
| Data lost when a phone is lost; internet outages (F5) | Cloud backup, restore by signing in; offline mobile app (describe) |
| Staff see too much | Permission templates; read-only access |
| Urdu-speaking staff | Urdu with right-to-left layout |

## 3. Key benefits (talking points)

1. **Never lose a client or a follow-up again** — everything in one place, shared by the team in real time.
2. **Find the right property in seconds** — matching runs automatically with transparent reasons.
3. **Look professional on WhatsApp** — consistent property messages, every contact logged.
4. **Know what's really available** — listings are re-confirmed with owners on a schedule.
5. **See your business** — live dashboard, lead sources, team performance, Excel/PDF reports.
6. **Control access** — each staff member sees only what their job needs; every change is audited.

## 4. Demo environment requirements

* A laptop with Node.js 20+ (the demo needs **no** MongoDB install) and Chrome or Edge.
* Optional second screen or second browser window for the "two users in real time" moment.
* Optional Android phone with the app installed (**not yet available** — the APK has to be built on a
  machine with the Android SDK; until then, describe the mobile app using the manuals).
* Internet only needed for the map preview on the property page.

Device checklist to run once the APK exists (record results before showing it to customers):
airplane-mode create client → reconnect → appears on web; edit the same price on two devices →
conflict prompt; PIN lock on resume; fingerprint unlock; camera upload; map location picker; push
reminder with Firebase configured; sign in on a second phone → data restored.

## 5. Demo account setup

```bash
# from the project root
npm install
npm run demo --api-port=4300            # in-memory MongoDB + seeded demo business
npm run dev:web --api-port=4300         # prints the web address, e.g. http://localhost:5173
```

The demo prints the sign-in accounts. They exist only in the in-memory demo database and disappear
when the demo stops.

| Account | Access level | Use it to show |
|---|---|---|
| `owner@demo.recrm.test` | Owner | Full walkthrough, team & settings |
| `son@demo.recrm.test` | Standard member | Second user for real-time updates |
| `manager@demo.recrm.test` | Manager template | Delete rights, audit log |
| `agent@demo.recrm.test` | Agent template | Field agent view (no reports/admin) |
| `accounts@demo.recrm.test` | Accountant template | Reports only |
| `viewer@demo.recrm.test` | Read-only template | Look-up only |

* **Password:** set `DEMO_PASSWORD` before `npm run demo` to choose one (recommended for any
  shared or remote demo). If unset, the local-only default printed by the demo is used.
* **Reset the demo:** stop and restart `npm run demo` (fresh data every time).
* **Persistent demo server:** `npm run seed` against a dedicated demo database
  (`npm run seed -- --reset` recreates it). The seed refuses to run with `NODE_ENV=production`,
  uses reserved `.test` e-mail addresses and a separate business marked "DEMO", so it can never mix
  with a customer's data. Never seed a customer's production database.

## 6. Sample data (seeded automatically)

One business ("DEMO — Yousuf Estate & Builders") with: 6 users; 10 owners; 30 properties across
Gulshan-e-Iqbal, DHA Karachi, Clifton, North Nazimabad, PECHS and Bahria Town Karachi (plots,
houses, flats, apartments, portions, shops, offices, sale and rent), each with a labelled
**DEMO IMAGE** illustration; 20 buyers/tenants with budgets, sizes and preferred societies;
60+ automatically computed matches; follow-ups spread over the past days and the coming week (some
overdue, some done today); notes; 5 labelled demo documents; won/lost/on-hold clients for the
conversion chart; 7 listings that "need verification". All names and numbers are synthetic.

## 7. Recommended demonstration sequence (≈35 min)

| # | Step (as owner unless noted) | Expected output | Talking point |
|---|---|---|---|
| 1 | Sign in → **Dashboard** | Live cards (30 properties, 7 listings to re-verify, overdue follow-ups…) | "Every number is live from your data." |
| 2 | **My Day** | Today's/overdue follow-ups, visits, new matches | "This is the first screen your agents open each morning." |
| 3 | Clients → **Add client**: name, a new number, source WhatsApp, House, DHA Karachi, 200–300 sq yd, 5–8 crore → Save | Client page opens; Matching properties tab already filled | "Matching happened the moment you saved." |
| 4 | Try adding a client with an **existing** number | "Possible duplicate client" with a link | "No more two agents chasing the same buyer." |
| 5 | Open a match → **Send property on WhatsApp** | WhatsApp opens with the property message ready | "One click, consistent message — and it's logged on the timeline." |
| 6 | **Follow-up** → Property visit tomorrow 5 pm → Save; then **Reschedule** and **Mark done** with an outcome | Appears in Follow-ups and My Day; timeline shows each step | "Nothing promised to a client is forgotten." |
| 7 | Properties → open a property → tabs: photos, matching clients, documents | Cover image, matches, private documents | "Documents open through expiring secure links." |
| 8 | Dashboard card **Listings to re-verify** → open one → **Confirm availability** with a note | Badge turns to "Verified just now"; count drops | "Buyers only hear about stock that's really available." |
| 9 | **Change status** → Reserved, reason "Token received" | Activity + audit entry; matches update | "Every change is recorded with who and when." |
| 10 | Second window signed in as **son@** — add a property | Appears for the owner without refresh ("Live") | "Father and son see the same business in real time." |
| 11 | Dashboard → **Lead sources & conversion**, **Team performance** | Chart and table from live data | "Spend on the channels that close; coach on overdue work." |
| 12 | **Users** → Add user → Agent template; sign in as **agent@** / **viewer@** | Menus and buttons change; blocked actions are blocked by the server | "Each person sees only what their job needs." |
| 13 | **Reports** → Properties → Excel | Real .xlsx downloads | "Your data is always yours." |
| 14 | Switch to **اردو** | Whole layout flips right-to-left | "Your staff can work in Urdu." |
| 15 | Close with the mobile story (manual screenshots/description) | — | "Works offline in the field; sign in on a new phone and everything is back." |

## 8. Known limitations (say them before the customer finds them)

* Mobile app not yet demonstrated on a phone (build pending — see §4).
* Push notifications need the customer's Firebase project; in-app notifications work without it.
* Photos/documents are stored on the server disk until Cloudinary (or S3) credentials are configured.
* PDF reports render Urdu text in a Naskh typeface on one line per cell (Excel shows Urdu too).
* No commission tracking, rentals/tenancy module, bulk Excel import, branches or WhatsApp Business
  API yet (roadmap). Matching weights are configurable; the 30-day verification window is fixed for now.
* Password-reset e-mails need SMTP settings on the customer's server.

## 9. Questions to ask during the demo

1. How do inquiries reach you today (WhatsApp, calls, portals, walk-ins)? Roughly what share each?
2. How many people handle clients? Who keeps the "master list" today?
3. How often do two of your people end up talking to the same buyer?
4. How do you know a listing is still available? How often do owners sell elsewhere without telling you?
5. How do you settle commission between agents today? Any disputes?
6. Do you handle rentals? Do you register tenants with the police for owners?
7. Would your staff prefer Urdu or English screens?
8. Which reports does the owner want every week/month?
9. Who should **not** see minimum prices or owner phone numbers?
10. Do you have any existing data in Excel we should import?

## 10. Next steps after a successful demo

1. Agree a 4–6 week pilot with one office; capture success measures (inquiries logged, overdue
   follow-ups, listings verified).
2. Collect their data (Excel) for import and their logo/business details.
3. Configure production hosting (HTTPS, backups), SMTP, storage, and Firebase if push is wanted.
4. Build and install the Android app on the pilot users' phones; run the device checklist (§4).
5. Create their users with the right templates; hand out the role manuals (`docs/user-manuals/`).
6. Review after two weeks: answers to §9, roadmap priorities (R-01 uncontacted-lead alert, R-02
   import, R-05/R-06 deals & commission).
