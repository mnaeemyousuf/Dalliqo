# Dalliqo Rebrand — QA Report

Date: 25 October 2026 · Scope: rebrand of the existing MERN + Flutter Real Estate CRM as **Dalliqo** ("Every Property. Every Lead. One Platform.") without rebuilding or changing behaviour.
Brand rules: [`DALLIQO_BRAND_GUIDELINES.md`](DALLIQO_BRAND_GUIDELINES.md).

## 1. Summary

| Area | Result |
|---|---|
| Logo suite (SVG, transparent PNG, favicon, PWA, Android, iOS) | ✅ Generated from one token file by `tools/brand/build.mjs` |
| Theme (web + Flutter, light + dark) | ✅ Centralised tokens; WCAG AA on all 20 checked text pairs (min 5.53 : 1) |
| Web rebrand | ✅ Title, favicon, manifest, login/register/reset, sidebar, fonts, charts |
| Mobile rebrand | ✅ App name, icons, native + in-app splash, sign-in header, theme, font, notification channel |
| Server rebrand | ✅ PDF/Excel exports, e-mail sender & password-reset mail |
| PDF user manuals (6) | ✅ Rebranded (Rev. B), all 196 screenshots recaptured, rebuilt and verified |
| Backend tests | ✅ 165 passed, 1 skipped (pre-existing skip), 0 failed |
| Web tests | ✅ 25 passed |
| Web production build | ✅ Built (shared + server + web) |
| Flutter analyze / test | ✅ No issues found · 39 tests passed |
| APIs, auth, data, permissions, sync | ✅ No identifiers, routes, schemas, storage keys or permission codes changed |

## 2. Changes made

### Brand assets (new)
* `shared/brand/dalliqo.tokens.json` — single source of truth (name, tagline, descriptor, palette, light/dark tokens, logo colours, typography, radii).
* `tools/brand/` — generator (`npm --prefix tools/brand run build`). Produces:
  * `branding/svg/` — 10 SVGs (primary, primary-dark, horizontal, horizontal-dark, wordmark ×2, mark, mark-square, mark-white, mark-mono). Wordmark and tagline are outlined paths (font-independent).
  * `branding/png/` — logos at 600/1200/2400 px, marks at 16–1024 px (transparent).
  * `branding/favicon/` + `web/public/` — `favicon.ico` (16/32/48), `favicon.svg`, 16/32 px PNG, `apple-touch-icon.png`, 192/512/maskable PWA icons, `site.webmanifest`.
  * Android: `mipmap-*` launcher + round icons, adaptive icon (foreground/background/monochrome) with `mipmap-anydpi-v26` XML, `drawable-*` splash logo, `launch_background.xml`, `values-v31` / `values-night-v31` Android 12 splash styles, `values/colors.xml`.
  * iOS: full `AppIcon.appiconset` (flattened, as Apple requires), `LaunchImage.imageset` @1/2/3x.
  * `web/src/styles/brand.css`, `shared/src/brand.ts` (`BRAND`), `mobile/lib/core/theme/brand_tokens.dart` — generated theme code.
  * `mobile/assets/brand/*.png`, `mobile/assets/fonts/PlusJakartaSans-*.ttf` (+ OFL licence), `server/assets/brand/*.png`.
  * `branding/contrast-report.json` — WCAG audit.

### Web (React)
* `index.html` — title "Dalliqo — Real Estate CRM", description, application-name, theme-color `#0B1B4A`, SVG/PNG/ICO favicons, apple-touch-icon, manifest; Google Fonts links removed (fonts now self-hosted).
* `index.css` imports the generated `brand.css`; hand-written palette removed; primary buttons use `text-on-brand` (white in light mode, midnight in dark mode).
* `tailwind.config.js` — `brand.ink`, `on-brand`, `accent` colours; Plus Jakarta Sans as the sans font.
* `main.tsx` — `@fontsource/plus-jakarta-sans` (400–800) and `@fontsource/noto-nastaliq-urdu`.
* New `components/BrandLogo.tsx` (horizontal / primary / mark, automatic light/dark artwork).
* `AuthPages.tsx` — logo + tagline on sign-in, register, forgot/reset password.
* `AppLayout.tsx` — Dalliqo mark in the sidebar header.
* `DashboardPages.tsx` — chart palette and chart font from the brand (`BRAND.color`, Plus Jakarta Sans).
* i18n (en/ur) — `app.name`, `app.tagline`, `app.description`; "Real Estate CRM" text replaced by "Dalliqo".

### Mobile (Flutter)
* `pubspec.yaml` — `assets/brand/` and the Plus Jakarta Sans font family (400–800).
* `core/theme/app_theme.dart` — rebuilt on `Brand` / `BrandLight` / `BrandDark`: explicit colour scheme, canvas/surface, cards, inputs, buttons, navigation bar, radii, typeface (Urdu keeps Noto Nastaliq).
* New `core/widgets/brand.dart` — `BrandLogo` and `BrandSplash`.
* `app.dart` — `title: Brand.name`.
* `auth_screens.dart` — sign-in/registration header shows the logo + tagline; the session-restore splash is the branded `BrandSplash`.
* `push_service.dart` — Android channel name "Dalliqo notifications" (channel id `crm_default` unchanged so existing notification settings survive).
* `AndroidManifest.xml` — `android:label="Dalliqo"`; `Info.plist` — `CFBundleDisplayName` "Dalliqo"; `LaunchScreen.storyboard` — midnight background, new launch image size.
* i18n (en/ur) — same keys as web; biometric prompt "Unlock Dalliqo".

### Server
* `services/exportService.ts` — PDF: logo top-right, primary-600 header row, primary-50 zebra rows, footer "Generated with Dalliqo · tagline" + "Page X of Y", PDF Author/Creator "Dalliqo"; Excel: creator "Dalliqo", brand-coloured header row; fallback business name "Dalliqo".
* `config/env.ts` / `.env.example` — default sender "Dalliqo <no-reply@…>".
* `services/authService.ts` — reset e-mail subject "Reset your Dalliqo password", Dalliqo signature with tagline.
* `docker/server.Dockerfile` — copies `server/assets` so the report logo ships in the image.

### Manuals and docs
* `tools/manuals/build.mjs` — midnight-gradient cover with the Dalliqo logo (vector), tagline, amber accent and product line; running header with mark + "Dalliqo"; footer with tagline, version, revision, date and page numbers; brand colours for headings, rules, tables and callouts; Plus Jakarta Sans embedded; PDF metadata Creator/Author "Dalliqo".
* `tools/manuals/content.mjs` — `PRODUCT = 'Dalliqo'`, `TAGLINE`, revision **Rev. B**; text references to "the CRM" now say "Dalliqo"; revision history row added for the rebrand.
* `tools/manuals/verify.mjs` — new brand checks (see §3.6) so future manuals cannot regress.
* `README.md`, `mobile/README.md`, root `package.json` description, `docs/user-manuals/README.md` — rebranded.
* New: `docs/branding/DALLIQO_BRAND_GUIDELINES.md`, this report.

## 3. Test results (actual runs, 25 October 2026)

### 3.1 Backend — `npm test` (Jest, in-memory MongoDB)
```
Test Suites: 1 skipped, 15 passed, 15 of 16 total
Tests:       1 skipped, 165 passed, 166 total
```
After the export footer fix (§4) the export suite was re-run: `tests/dashboard.test.ts` — **7 passed, 7 total**. `npm run typecheck` — clean.

### 3.2 Web — Vitest
```
Test Files  5 passed (5)
Tests       25 passed (25)
```

### 3.3 Production build — `npm run build`
shared → server → web: `✓ 2368 modules transformed … ✓ built in 51.79s`. (Only the pre-existing Vite "chunk larger than 500 kB" advisory.)

### 3.4 Flutter (SDK 3.x, Windows)
* `flutter pub get` — OK.
* `flutter analyze` — **No issues found!**
* `flutter test` — **All tests passed!** (39 tests, including the Urdu RTL and widget tests).

### 3.5 Live checks against the running demo (API :4300, web :5174)
* Browser tab title "Dalliqo — Real Estate CRM"; favicon, logo, tagline, fonts load (network: all brand assets 200).
* Sign-in page (light and dark) and the signed-in dashboard (dark mode) reviewed visually: logo/mark, Plus Jakarta Sans, brand blue primary, readable midnight-on-blue dark buttons.
* `GET /api/exports/properties?format=pdf` as the demo owner → 200 `application/pdf`, 2 pages for 30 records, logo top-right, brand header row and zebra rows, footer "Generated with Dalliqo · Every Property. Every Lead. One Platform. … Page 1 of 2"; metadata Author "Dalliqo", Creator "Dalliqo — Real Estate CRM & Business Management Platform".

### 3.6 PDF manuals
* `capture.mjs` — **196 captured, 0 failed** (common + owner, member, manager, agent, accountant, viewer), then 14 dashboard screenshots retaken after the chart-font fix (14 captured, 0 failed).
* `build.mjs` + `verify.mjs --render`:

| Manual | Pages | Figures | TOC refs checked | Result |
|---|---|---|---|---|
| Business_Owner_User_Manual.pdf | 62 | 51 | 70 | ✓ |
| Office_Manager_User_Manual.pdf | 53 | 40 | 66 | ✓ |
| Real_Estate_Agent_User_Manual.pdf | 49 | 36 | 61 | ✓ |
| CRM_Operator_User_Manual.pdf | 52 | 39 | 63 | ✓ |
| Accountant_User_Manual.pdf | 37 | 24 | 49 | ✓ |
| Read_Only_User_Manual.pdf | 34 | 21 | 48 | ✓ |

Checks per manual: cover title and **tagline**, intended role, contents present, every contents entry lands on its heading, sequential figures, no duplicate figure images, footer "Page X of Y" on every page, **"Dalliqo" + tagline in the header/footer of every page**, **no leftover "Real Estate CRM" product name**, **PDF title metadata starts with "Dalliqo"**, no placeholders/"undefined", no near-blank pages. Pages were rendered to PNG and spot-reviewed (covers, contents, figure pages). Instructions were not rewritten because no feature, label or workflow changed — only branding.

### 3.7 Old-branding search
`grep -r "Real Estate CRM"` (excluding node_modules/build output) — remaining hits are only:
* the brand **descriptor** "Real Estate CRM & Business Management Platform" and the browser title "Dalliqo — Real Estate CRM" (intentional),
* the Windows folder path inside Flutter-generated iOS config files (machine-generated, not user-visible),
* historical references in the earlier audit documents (`FINAL_REQUIREMENTS_AUDIT.md`, `MVP_SCOPE_AND_ACCEPTANCE_CRITERIA.md`) that quote the original specification's name,
* the verifier's own check pattern.
Old palette colours (`#1F4E79`, `#2e6da4`, `#0f2f4f`) — none left in web, mobile, server or manual tooling.

## 4. Defects found and fixed during QA
1. **Report footer added blank pages** — the new two-part footer in PDF exports was written below the bottom margin, so PDFKit opened extra pages (30 records → 6 pages). Fixed by lifting the margin while writing the footer; the export test now asserts 40 rows produce 2–3 pages and contain "Dalliqo".
2. **Chart axis text in a serif fallback font** — charts still requested the removed "Inter" font. Switched to Plus Jakarta Sans; dashboard screenshots retaken.
3. **Excel header row** still used the old blue — now uses brand primary-600.

## 5. Compatibility (Task 6)
Unchanged on purpose: API routes and payloads, JWT/refresh flow and the `recrm_rt` cookie, database names/collections/records, permission codes and role templates, Socket.IO events, offline sync queue and local SQLite schema, notification channel **id**, npm package names `@recrm/*`, Dart package `real_estate_crm`, Android `applicationId` `com.recrm.real_estate_crm`, iOS `CFBundleName`/bundle id, demo account e-mails. Existing installs therefore update in place and keep their sessions and offline data.

## 6. Limitations
* **Mobile not run on a device/emulator** (no Android SDK or Xcode on this machine). The Flutter screens themselves *were* rendered to PNG by Flutter's own engine (§7), but the **native** launcher icon, adaptive/themed icon and native splash (Android resources, iOS storyboard) have not been seen on real hardware. Recommended: one `flutter run` on Android and iOS before release.
* **Store identifiers** (`com.recrm.real_estate_crm`) were kept to avoid breaking installs; publishing under a Dalliqo bundle id is a separate store decision (new listing).
* **Manual header/footer text** renders in Segoe UI/Arial (Chromium's print header/footer cannot use page web fonts); body, headings and cover use Plus Jakarta Sans.
* **Manuals contain no mobile screenshots** (same reason as the first limitation) and remain English-only; Urdu UI is shown via screenshots in the owner manual.
* Logo is an original design produced for this project; a trademark/availability search for the name "Dalliqo" and the mark has **not** been performed.
* `flutter analyze` is slow on this machine (~26 min with a cold cache); it completed successfully.

## 7. Follow-up audit — 25 October 2026

A requirement-by-requirement re-audit found and fixed the following:

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | English descriptor read **"Dalliqo & Business Management Platform"** (my first rebrand script ran a blanket "Real Estate CRM" → "Dalliqo" replace over the i18n files after setting `app.description`). It was visible only on the mobile in-app splash; no manual or screenshot contained it. | Restored "Real Estate CRM & Business Management Platform" in web + mobile `en.json`. | PDF text scan of all 6 manuals: 0 hits; mobile splash render shows the corrected line |
| 2 | Settings → **About** (web + mobile) still showed a plain name and "Multi-tenant real estate CRM". | Logo, tagline, descriptor + version; About text names Dalliqo (en + ur). | Web About tab reviewed in the browser; `flutter analyze` clean |
| 3 | Mobile **primary button label** did not use Plus Jakarta Sans (the theme's button `textStyle` replaced the theme typeface, so devices fell back to the system font). Found only by rendering the screen. | Button style now derives from `textTheme.labelLarge`. | `mobile-renders/login-*.png` |
| 4 | **Urdu text in PDF exports** was blank (EXP-02, the only PARTIAL item in the requirements audit). | Bundled Noto Naskh Arabic (OFL) in `server/assets/fonts`; Arabic-script runs drawn whole with right-to-left ordering and right alignment; Latin stays Helvetica. | New test `embeds an Urdu font for Urdu text in PDF exports`; rendered clients export with "محمد علی خان" and "گلشن اقبال Block 13-D" reviewed at 5× zoom |

**Mobile visual verification without a device.** `mobile/test_render/brand_render_test.dart` pumps the real `LoginScreen` (light + dark) and `SplashScreen` with the production theme, the bundled Plus Jakarta Sans font and the logo assets, and writes PNGs (`flutter test test_render` → `mobile/build/brand_renders/`). Copies: [`mobile-renders/`](mobile-renders/). Confirmed: logo (light/dark artwork), tagline, Dalliqo colours in both modes, typeface on headings/body/buttons, branded splash. (The "اردو" language button shows boxes in the renders only because the test engine has no Urdu system font.)

**Re-run results (25 October 2026, after these fixes):**

| Check | Result |
|---|---|
| Backend `npm test` | 15 suites passed (1 skipped), **166 passed**, 1 skipped, 0 failed |
| Web Vitest | **25 passed** |
| `npm run build` (shared + server + web) | ✓ built |
| `flutter analyze` | **No issues found** |
| `flutter test` | **39 passed** |
| `flutter test test_render` | 3 passed, 3 PNGs written |
| `verify.mjs` (6 manuals, incl. brand checks) | **all ✓** (287 pages, 211 figures, 357 TOC references) |
