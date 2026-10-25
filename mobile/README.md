# Dalliqo — Flutter app

Offline-first Android / iOS app for the Dalliqo API. Riverpod (no code generation), GoRouter,
Dio, sqflite, Socket.IO, Firebase Cloud Messaging, Google Maps, English + Urdu (RTL).

```text
lib/
├── main.dart, app.dart          bootstrap, lifecycle (app lock, resume sync), MaterialApp.router
├── core/
│   ├── config/env.dart          API_BASE_URL (--dart-define)
│   ├── database/                sqflite: records · outbox · conflicts · kv
│   ├── sync/                    LocalStore (offline writes) + SyncEngine (push / pull / conflicts)
│   ├── network/api_client.dart  Dio, single-flight refresh, error codes
│   ├── realtime/                Socket.IO change notices → sync pull
│   ├── notifications/           FCM + local notifications, deep links
│   ├── storage/                 secure storage: tokens, PIN hash
│   ├── l10n/ theme/ router/ widgets/ models/ utils/
├── data/repositories.dart       CrmRepository (offline) + OnlineRepository (server-computed data)
└── features/                    auth · home · dashboard (My Day) · clients · properties · owners ·
                                 matches · followups · notifications · settings (+ sync centre)
```

## 1. Requirements

Flutter 3.35+ (Dart 3.9+), Android SDK (API 23+) / Xcode 16+.

```bash
flutter pub get
```

> **Windows:** if your user or project path contains spaces (e.g. `C:UsersHS LAPTOP`), the
> `sqlite3` native-asset build hook used by the tests can fail with "'C:UsersHS' is not recognized".
> Install Flutter in a path without spaces (e.g. `C:lutter`) or invoke it through its 8.3 short path.

## 2. Android (already configured)

`android/` was generated with `flutter create --org com.recrm` and then configured:

- Permissions (internet, location, camera, notifications, biometrics) and `<queries>` for dial /
  SMS / email / https intents in `AndroidManifest.xml`.
- `MainActivity` extends `FlutterFragmentActivity` (required by `local_auth`).
- `minSdk` ≥ 23, core-library desugaring (required by `flutter_local_notifications`).
- Cleartext http is allowed **only in debug builds** (for a local API); release builds require https.
- Google Maps key is read from `android/local.properties` (git-ignored):

  ```properties
  MAPS_API_KEY=your-android-maps-key
  ```

For release signing, replace the debug `signingConfig` in `android/app/build.gradle.kts` with your keystore.

## 3. iOS (already configured)

- `Info.plist` has camera / photos / location / Face ID usage strings, URL query schemes
  (tel, sms, mailto, https, whatsapp) and the remote-notification background mode.
- `AppDelegate.swift` provides the Google Maps key from the `GMS_API_KEY` build setting; set it in
  `ios/Flutter/Debug.xcconfig` and `Release.xcconfig`.
- Deployment target 15.0. In Xcode enable the **Push Notifications** capability for FCM and set your
  signing team.

## 4. Firebase (push notifications)

1. Create a Firebase project and add Android (`com.recrm.real_estate_crm`) and iOS apps.
2. Put `google-services.json` in `android/app/` and `GoogleService-Info.plist` in `ios/Runner/`
   (both are git-ignored). Follow the FlutterFire Android Gradle plugin step
   (`com.google.gms.google-services`), or run `flutterfire configure`.
3. Give the API the service-account credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` in `server/.env`).

Without Firebase the app still works: in-app notifications and real-time updates use Socket.IO; only
pushes to a closed app are unavailable.

## 5. Run

Start the API (from the repository root):

```bash
npm run demo
```

Then run the app against it. The Android emulator reaches the host at `10.0.2.2`; a physical phone
needs your computer's LAN IP:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

Demo sign-in: `owner@demo.recrm.test` / `Demo1234!` (owner) or `son@demo.recrm.test` / `Demo1234!` (member).

## 6. Test

```bash
flutter analyze
```
```bash
flutter test
```

## How offline works

Every create/edit/delete is written to SQLite **and** queued in the outbox in one transaction, so
nothing is lost if the phone is offline or the app is killed. The sync engine pushes the outbox
(idempotent by mutation id, records referenced by device uuid until they have server ids), pulls
server changes since its cursor, and runs on connectivity changes, app resume, every 5 minutes, after
local writes and when another device's change arrives over Socket.IO. Conflicts on price, status or
follow-up completion are shown in **More → Sync** with *Keep mine* / *Keep latest*; other fields use
last-write-wins with the overwritten values kept in the server audit log. Logging in on a new phone
restores the whole business from `/api/sync/bootstrap`.
