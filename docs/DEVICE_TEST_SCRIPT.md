# Device test script (Android, Phase 2 — two phones: father and son)

The release APK is built by GitHub Actions (`.github/workflows/android-apk.yml`): the Phase 2 build is
[release `apk-build-3`](https://github.com/mnaeemyousuf/Dalliqo/releases/tag/apk-build-3) (`Dalliqo-1.0.0+1-3.apk`, run 41661337077,
pointing at `https://dalliqo.onrender.com`). It has **not yet been installed on a phone** — the development machine has no Android
SDK and no phone — so none of the steps below has been executed. The logic behind them is covered by automated tests (named in
each section); this script checks what only real phones can show: notifications and alarms, reboot, the share sheet, WhatsApp,
the camera, PDF viewers, right-to-left Urdu on screen, and two people working on the same business at once.

## 0. Setup (two phones)

| | Phone A — "father" | Phone B — "son" |
|---|---|---|
| Account | `owner@demo.recrm.test` (Owner, full access) | `son@demo.recrm.test` (Standard member template) |
| Role in the tests | Admin actions, approvals, owner-only screens | Day-to-day entry, offline work, permission limits |

1. On each phone: open the release page above, download `Dalliqo-1.0.0+1-3.apk`, allow "install unknown apps" for the browser,
   install. (The APK is debug-signed, for sideloading only; Play Store needs a release keystore.) To build your own instead:
   on a machine with Android Studio (SDK 34+, JDK 17) run `cd mobile && flutter build apk --release --dart-define=API_BASE_URL=https://dalliqo.onrender.com`,
   or push to the `build-apk` branch / run the workflow manually (it can take another API URL).
2. The live demo uses the password set in Render's `DEMO_PASSWORD` (the code default is `Demo1234!`; `.env.example` suggests
   `DEMO@1234`). The Render free plan sleeps: open https://dalliqo.onrender.com once and wait for it to wake before signing in.
   Demo data resets when the service restarts.
3. Optional push: the CI build has no `google-services.json`, so Firebase push is off; in-app and **local** reminders still work.
4. Record phone model, Android version and build in the results table at the end. Use Android 13+ (14 recommended for the
   exact-alarm permission flow).

## 0b. Father and son on the same business (realtime, conflicts, permissions)

| # | Steps | Expected |
|---|---|---|
| 0b.1 | Both phones open Clients. Father adds a client. | The client appears on the son's phone within a few seconds (no pull-down). |
| 0b.2 | Son adds a follow-up for that client assigned to the father. | Father gets the in-app notification; the follow-up shows in his My Day and gets a local reminder. |
| 0b.3 | Son turns on airplane mode, edits the client's budget and adds a deal payment; father edits the same deal's stage online. Son reconnects. | Son's edits sync once (no duplicates); the stage conflict shows Keep mine / Keep latest on the son's phone. |
| 0b.4 | Father: Settings → Users → son → Edit permissions → untick "Delete follow-ups" (or apply the Agent template). | Within one screen load the son can no longer do it (the server refuses; the button disappears). Restore afterwards. |
| 0b.5 | Father limits the son to the Clifton branch (Branch access: Selected). | After the next sync the son sees only Clifton records; new records he adds go to Clifton. Restore "All branches" afterwards. |
| 0b.6 | Father records commission on a deal; son (no finance delete rights) opens Income & expense. | Son sees the "From deal" income entry, cannot edit or delete it. |

## 1. Local reminders (A3) — `mobile/test/reminders_test.dart`

| # | Steps | Expected |
|---|---|---|
| 1.1 | First sign-in → allow notifications. Android 14: when asked, allow **Alarms & reminders**. | Permission granted; no crash if refused (reminders fall back to inexact). |
| 1.2 | Create a follow-up for a client due in 6 minutes (default reminder 5 minutes before). Lock the phone. | A notification "Follow-up: …" arrives at due−5 min (±1 min) with sound. |
| 1.3 | Turn on airplane mode, create another follow-up due in 6 minutes. | The reminder still rings on time (scheduled on the phone). |
| 1.4 | Reschedule a follow-up to 10 minutes later. | Only one reminder, at the new time; the old one does not ring. |
| 1.5 | Complete or cancel a follow-up before its reminder. | Its reminder is cancelled. |
| 1.6 | Schedule one for 8 minutes ahead, then restart the phone. | It still rings after the reboot (boot receiver restores alarms). |
| 1.7 | With Firebase configured: let a reminder fire while online. | Exactly **one** notification (the phone ignores the push for a reminder it already showed). |
| 1.8 | Tap a reminder notification (app closed, and app in background). | The app opens on that follow-up. |
| 1.9 | Sign out. | Pending local reminders are cancelled. |

## 2. Branches (B4) — `branches_test.dart`, server `branches.test.ts`

| # | Steps | Expected |
|---|---|---|
| 2.1 | Owner: More → Branches shows Main Branch and Clifton Office; switch to Clifton. | Clients, properties, deals, agreements and the dashboard show Clifton data only. |
| 2.2 | Switch to "All branches". | Everything visible again. |
| 2.3 | Settings → Users → pick a member → Branch access: Selected → Clifton → Save. Sign in as that member on a second phone. | They only ever see Clifton records (also after a full sync); creating a client puts it in Clifton. |
| 2.4 | Offline, create a client while Clifton is selected; go online. | The client syncs into Clifton. |

## 3. Deals and commission (B1) — `deals_test.dart`, server `deals.test.ts`

| # | Steps | Expected |
|---|---|---|
| 3.1 | Airplane mode → More → Deals → + → choose client, price 20,000,000, agents 60/40 → Save. | Deal shows at Inquiry with "pending sync"; expected commission 400,000. |
| 3.2 | Still offline: move to Offer, record a buyer payment of 200,000, add a payout. | Totals update immediately; status Partly received. |
| 3.3 | Go online. | It syncs once (no duplicate); DL number appears; web shows the same deal and an income entry of 200,000. |
| 3.4 | Edit the same deal's stage on the web and on the phone while offline, then reconnect. | Conflict screen offers Keep mine / Keep latest (stage is protected). |
| 3.5 | Sign in as `agent@demo.recrm.test`. | Only the agent's own deals are listed. |

## 4. Income & expense (B2) — `finance_test.dart`, server `finance.test.ts`

| # | Steps | Expected |
|---|---|---|
| 4.1 | Accountant: More → Income & expense → + Expense → Office rent 85,000 offline → Save. | Listed with pending badge; this-month expense updated. |
| 4.2 | Online: open the entry → Receipts → upload a photo from the camera. | Receipt uploaded and viewable. |
| 4.3 | Open a commission entry ("From deal"). | No edit/delete; "Open deal" goes to the deal. |
| 4.4 | Report tab: by month and by category, in Urdu. | Figures match the web report; Urdu labels right to left. |

## 5. Agreements (B3) — `agreements_test.dart`, server `agreements.test.ts`

| # | Steps | Expected |
|---|---|---|
| 5.1 | Offline: More → Agreements → + → Rent, Urdu, tenant, monthly rent, end date in 40 days → Save. | Draft shown with "text is generated when this draft syncs"; lawyer-review note visible. |
| 5.2 | Go online. | Version 1 appears in Urdu, right to left; two renewal follow-ups (30 and 7 days before) appear in Follow-ups and get local reminders. |
| 5.3 | Share PDF. | Share sheet opens with `AG-…-v1.pdf`; opens in a PDF viewer with correct Urdu shaping and the footer note. |
| 5.4 | Mark sent → upload signed scan (camera) under Signed copy → mark signed. | Status Signed; edit and regenerate disappear. |
| 5.5 | Change the end date of a draft rent agreement. | Old renewal follow-ups cancelled, new ones planned. |

## 6. Brochures (B5) — `brochure_test.dart`, server `brochures.test.ts`

| # | Steps | Expected |
|---|---|---|
| 6.1 | Offline: property → Brochure. | Buttons disabled with "needs an internet connection". |
| 6.2 | Online: Urdu, hide price off → Image → share to WhatsApp status. | 1080×1350 image with photo, Urdu title/price right to left, QR. |
| 6.3 | Scan the QR with another phone. | WhatsApp opens a chat with the chosen contact person and a prefilled message about the property. |
| 6.4 | Hide price on → PDF. | "Price on request"; no amount anywhere. Minimum/expected price never appear in any option. |
| 6.5 | WhatsApp button. | WhatsApp opens with the share text. |

## 7. Administration parity (Part C) — `admin_test.dart`, `parity_test.dart`, server `members.test.ts`

| # | Steps | Expected |
|---|---|---|
| 7.1 | Owner: Settings → Users → + → name, email, temporary password, template Agent → Save. | New user listed with "Agent"; can sign in and is forced to change the password. |
| 7.2 | Suspend that user. | Their open sessions are signed out. |
| 7.3 | Settings → Client categories → add "Overseas Pakistani" with an Urdu name; archive it. | Appears/disappears in the client form after sync. |
| 7.4 | Settings → Business settings → change thresholds, cross-branch, reminder minutes, commission defaults → Save. | Web Settings shows the same values; a new deal uses the new default percentages. |
| 7.5 | Father: Settings → Analytics (7 days / 30 days / 12 months), Audit log, Documents library (open and share a document). | Same figures and entries as the web; documents open through a short-lived link. Son (no audit access) does not see Audit log. |
| 7.6 | Father: Settings → Agreement templates → copy a built-in, edit the copy, archive it; Settings → Income & expense categories → add one with an Urdu name. | Changes appear on the web and in the agreement / entry forms after sync. |

## 8. Realtime and Urdu

| # | Steps | Expected |
|---|---|---|
| 8.1 | Keep the app open; on the web, add a deal, an expense and an agreement. | The phone's lists update within a few seconds without pulling down. |
| 8.2 | Switch the app to اردو and open every new screen (deals, income & expense, agreements, brochure sheet, users, business settings). | Layout right to left, no clipped text, numbers and IDs left to right. |

## Results

| Section | Phone / Android | Build | Tester | Date | Pass / fail / notes |
|---|---|---|---|---|---|
| 0b, 1–8 | | apk-build-3 | | | Not run yet (needs two Android phones) |
