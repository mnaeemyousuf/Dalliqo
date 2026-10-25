import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../network/api_client.dart';

/// Firebase Cloud Messaging + local notifications.
///
/// Firebase needs android/app/google-services.json and
/// ios/Runner/GoogleService-Info.plist (see mobile/README.md). Without them the
/// app still runs: in-app notifications and Socket.IO keep working, only
/// pushes to a closed app are unavailable.
class PushService {
  PushService(this._api, {required this.onOpen});

  final ApiClient _api;

  /// Called with the notification's deep link (e.g. `/clients/<id>`) when tapped.
  final void Function(String deepLink) onOpen;

  final _local = FlutterLocalNotificationsPlugin();
  bool _firebaseReady = false;
  String? _token;
  StreamSubscription<String>? _refreshSub;

  static const _channel = AndroidNotificationChannel('crm_default', 'Dalliqo notifications',
      description: 'Follow-up reminders, new matches and property updates', importance: Importance.high);

  Future<void> init() async {
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (r) {
        if (r.payload != null && r.payload!.isNotEmpty) onOpen(r.payload!);
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);

    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      debugPrint('Firebase not configured; push notifications disabled ($e)');
      return;
    }

    FirebaseMessaging.onMessage.listen((m) {
      final n = m.notification;
      if (n != null) show(n.title ?? '', n.body ?? '', deepLink: m.data['deepLink'] as String?);
    });
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(m.data['deepLink'] as String?));
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _open(initial.data['deepLink'] as String?);
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
      await _api.post('/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
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
  Future<void> show(String title, String body, {String? deepLink}) => _local.show(
        id: DateTime.now().millisecondsSinceEpoch ~/ 1000 % 100000,
        title: title,
        body: body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(_channel.id, _channel.name, channelDescription: _channel.description, importance: Importance.high, priority: Priority.high),
          iOS: const DarwinNotificationDetails(),
        ),
        payload: deepLink,
      );
}
