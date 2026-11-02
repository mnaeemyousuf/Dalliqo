import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../database/app_database.dart';
import '../network/api_client.dart';
import 'reminder_scheduler.dart';

const _channel = AndroidNotificationChannel('crm_default', 'Dalliqo notifications',
    description: 'Follow-up reminders, new matches and property updates', importance: Importance.high);

NotificationDetails _details() => NotificationDetails(
      android: AndroidNotificationDetails(_channel.id, _channel.name, channelDescription: _channel.description, importance: Importance.high, priority: Priority.high),
      iOS: const DarwinNotificationDetails(),
    );

bool _isReminder(RemoteMessage m) => m.data['type'] == 'FOLLOWUP_REMINDER' && m.data['followUpId'] is String;

/// Data-only follow-up reminder pushes that arrive while the app is in the background or closed.
/// The phone usually rang its own local reminder already ([ReminderScheduler]); only if it has no
/// local reminder for this follow-up (e.g. it was assigned on the web while the phone was offline)
/// is the push shown.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage m) async {
  if (!_isReminder(m)) return;
  AppDatabase? db;
  try {
    db = await AppDatabase.open();
    final stored = await db.getJson(ReminderScheduler.kvKey);
    if (!ReminderScheduler.shouldShowPushFor(stored, m.data['followUpId'] as String)) return;
    final plugin = FlutterLocalNotificationsPlugin();
    await plugin.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher'), iOS: DarwinInitializationSettings()));
    await plugin.show(
      id: ReminderScheduler.notificationId(m.data['followUpId'] as String),
      title: m.data['title'] as String? ?? '',
      body: m.data['body'] as String? ?? '',
      notificationDetails: _details(),
      payload: m.data['deepLink'] as String?,
    );
  } catch (e) {
    debugPrint('Background reminder push failed: $e');
  } finally {
    await db?.db.close();
  }
}

/// Firebase Cloud Messaging + local notifications.
///
/// Firebase needs android/app/google-services.json and
/// ios/Runner/GoogleService-Info.plist (see mobile/README.md). Without them the
/// app still runs: in-app notifications, Socket.IO and local follow-up
/// reminders keep working, only pushes to a closed app are unavailable.
class PushService {
  PushService(this._api, {required this.onOpen, this.shouldShowReminder});

  final ApiClient _api;

  /// Called with the notification's deep link (e.g. `/clients/<id>`) when tapped.
  final void Function(String deepLink) onOpen;

  /// Decides whether a reminder push is a duplicate of a local reminder (see [ReminderScheduler.shouldShowPush]).
  final Future<bool> Function(String followUpId)? shouldShowReminder;

  final plugin = FlutterLocalNotificationsPlugin();
  bool _firebaseReady = false;
  String? _token;
  StreamSubscription<String>? _refreshSub;

  Future<void> init() async {
    await plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (r) => _open(r.payload),
    );
    final android = plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(_channel);
    await android?.createNotificationChannel(LocalNotificationsPlatform.channel);
    // The app was started by tapping a (local) notification: open its screen.
    final launch = await plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp ?? false) _open(launch!.notificationResponse?.payload);

    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      debugPrint('Firebase not configured; push notifications disabled ($e)');
      return;
    }

    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
    FirebaseMessaging.onMessage.listen(_onForeground);
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(m.data['deepLink'] as String?));
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _open(initial.data['deepLink'] as String?);
  }

  Future<void> _onForeground(RemoteMessage m) async {
    if (_isReminder(m)) {
      final id = m.data['followUpId'] as String;
      if (shouldShowReminder != null && !await shouldShowReminder!(id)) return;
      await show(m.data['title'] as String? ?? '', m.data['body'] as String? ?? '', deepLink: m.data['deepLink'] as String?);
      return;
    }
    final n = m.notification;
    if (n != null) await show(n.title ?? '', n.body ?? '', deepLink: m.data['deepLink'] as String?);
  }

  void _open(String? link) {
    if (link != null && link.isNotEmpty) onOpen(link);
  }

  /// Asks permission and registers this device's FCM token with the API (after sign-in).
  Future<void> registerDevice() async {
    if (!_firebaseReady) return;
    final settings = await FirebaseMessaging.instance.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;
    // register()/onRegistered yield a Firebase Installation ID, but the API
    // sends with firebase-admin's registration-token target, so keep using
    // the (deprecated, still supported) token APIs until both sides migrate.
    // ignore: deprecated_member_use
    _token = await FirebaseMessaging.instance.getToken();
    if (_token != null) await _send(_token!);
    // ignore: deprecated_member_use
    _refreshSub ??= FirebaseMessaging.instance.onTokenRefresh.listen(_send);
  }

  Future<void> _send(String token) async {
    _token = token;
    try {
      // localReminders: this app rings follow-up reminders itself, so the server sends reminder pushes data-only.
      await _api.post('/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android', 'localReminders': true});
    } catch (e) {
      debugPrint('Device registration failed: $e');
    }
  }

  Future<void> unregister() async {
    final t = _token;
    if (t == null) return;
    try {
      await _api.delete('/devices/${Uri.encodeComponent(t)}');
    } catch (_) {
      // Logout revokes the session server-side, which removes the token anyway.
    }
  }

  /// Local notification (foreground FCM messages and socket notices).
  Future<void> show(String title, String body, {String? deepLink}) => plugin.show(
        id: DateTime.now().millisecondsSinceEpoch ~/ 1000 % 100000,
        title: title,
        body: body,
        notificationDetails: _details(),
        payload: deepLink,
      );
}
