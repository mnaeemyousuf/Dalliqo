# Screen inventory

Every screen has loading, empty, error and offline states, and works in both English (LTR) and Urdu (RTL).

## Flutter mobile app

| Area | Screen | Key contents / actions | Status |
|---|---|---|---|
| Onboarding | Splash / bootstrap | token check, app lock gate, first-run restore | ✅ |
| | Language picker | English / اردو (sets RTL) | ✅ |
| | Login · Register (business) · Forgot password · Reset with code | validation, error codes mapped to messages | ✅ |
| | Change temporary password | forced for owner-created members | ✅ |
| | Set PIN · Unlock (PIN / biometric) | local app lock | ✅ |
| Shell | Bottom nav: **My Day · Clients · Properties · Matches · More** + global **+** FAB (Add client, property, follow-up, note, upload document) | sync status chip in app bar | ✅ |
| Home | My Day | today's / overdue follow-ups, meetings, visits, new clients, new properties, new matches | ✅ |
| | Dashboard | totals: properties by status, clients by category, today's activity | ✅ |
| Clients | Client list | search (debounced), filter sheet, sort, infinite scroll, pull-to-refresh, ClientCard with call/WhatsApp/follow-up | ✅ |
| | Client form (add/edit) | contact, category (incl. custom), requirements, assignment | ✅ |
| | Client detail (tabs) | Overview · Requirements · Matching properties · Follow-ups · Notes · Documents · Activity · Communication; one-tap CALL / WHATSAPP / SMS / EMAIL | ✅ |
| | Category manager | add/rename/archive custom categories | ✅ |
| Owners | Owner list · Owner detail (properties, notes, documents) · Owner form | | ✅ |
| Properties | Property list | search, filters, PropertyCard (cover image, RE-ID, size, area, price in crore/lakh, status, match count) | ✅ |
| | Property form | type, purpose, location (map picker), size+unit, prices, owner picker, rooms | ✅ |
| | Property detail | gallery, map preview, open in Google Maps, share location, status changer, matches, documents, notes, activity | ✅ |
| | Map picker | search place, drop pin, current location | ✅ |
| | Media manager | multi-select, compress, upload progress, retry, reorder, set cover | ✅ |
| | Document viewer | PDF/image preview, download, share, rename, delete | ✅ |
| Matches | Matches hub | segmented: Client → Properties / Property → Clients; MatchCard with % and ✓ reasons; actions View, Call, WhatsApp, Follow-up | ✅ |
| Follow-ups | List (Today / Upcoming / Overdue / Done) · Form · Detail (complete with outcome, cancel, notes) | reminders | ✅ |
| Notifications | Notification centre | tabs All / Follow-ups / Matches / System; mark read, mark all, deep links | ✅ |
| Sync | Sync centre | pending/failed/conflict items; conflict resolver (Your version / Server version) | ✅ |
| Settings | Profile · Business · Users & permissions (owner) · Language · Theme (light/dark/system) · Notifications · Security (PIN, biometrics, sessions, change password) · Backup & sync · Export · About · Logout | | ✅ |

## React web CRM

| Area | Screen | Status |
|---|---|---|
| Auth | Login · Register · Forgot / Reset password · Change temporary password | ✅ |
| Shell | Sidebar: Dashboard · Clients · Properties · Owners · Matches · Follow-ups · Documents · Reports · Users · Notifications · Settings; top bar with global search (⌘K), notifications, language, theme | ✅ |
| Dashboard | KPI tiles, property distribution donut, status bar chart, client categories, follow-up performance, new records (day/week/month), match-quality distribution | ✅ |
| Clients | Virtualised DataTable with saved filters, bulk assign, column chooser; detail drawer/page with same tabs as mobile | ✅ |
| Properties | DataTable + grid/card view + map view; detail page; media and documents management | ✅ |
| Owners · Matches · Follow-ups (filtered list; notes drawer per follow-up) · Documents library (preview, rename) | | ✅ |
| Reports & exports | report builder (resource + filters) → Excel / PDF | ✅ |
| Users & permissions | member list, add member, permission matrix editor, suspend/remove, reset password | ✅ |
| Audit log | filter by user / entity / action / date, field-level diffs | ✅ |
| Settings | business profile, categories, matching weights & thresholds, notification defaults | ✅ |
