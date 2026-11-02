import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../database/app_database.dart';
import '../models/models.dart';

/// One reminder the phone should ring by itself.
@immutable
class ReminderPlan {
  const ReminderPlan({required this.key, required this.ids, required this.notificationId, required this.at, required this.title, required this.body, required this.payload});

  /// Follow-up uuid (stable across offline create → sync).
  final String key;

  /// Every id the follow-up is known by (uuid and, once synced, the server id): pushes carry the server id.
  final List<String> ids;
  final int notificationId;
  final DateTime at;
  final String title;
  final String body;
  final String payload;

  Map<String, dynamic> toJson() => {'id': notificationId, 'at': at.toUtc().toIso8601String(), 'ids': ids, 'title': title, 'body': body};
}

/// The device side of local notifications (a fake replaces it in tests).
abstract class ReminderPlatform {
  Future<void> schedule(ReminderPlan plan, {required bool exact});
  Future<void> cancel(int notificationId);

  /// Whether Android lets us use exact alarms (Android 12+ may refuse).
  Future<bool> exactAllowed();
}

/// Rings follow-up reminders from the phone itself, without Firebase or internet.
///
/// Wanted reminders: follow-ups assigned to the signed-in user, still PENDING, whose reminder time
/// (reminderAt, else dueAt minus the business default) is in the future. [resync] diffs that set
/// against what is already scheduled (kept in the local `kv` table) and only schedules, re-schedules
/// or cancels the difference. It runs at start-up, after sign-in and whenever local follow-up rows
/// change: local create / edit / reschedule / complete / cancel / delete and every sync pull.
class ReminderScheduler {
  ReminderScheduler(this.db, this.platform, {required this.userId, required this.defaultMinutes, required this.text});

  final AppDatabase db;
  final ReminderPlatform platform;
  final String? Function() userId;
  /// Business default "minutes before" (Settings → reminders), read from the cached settings.
  final Future<int> Function() defaultMinutes;

  /// Localised strings: key + params → text.
  final Future<String Function(String key, [Map<String, Object?> params])> Function() text;

  static const kvKey = 'reminders.scheduled';

  /// After a reminder has rung we keep remembering it for this long, so a late push for the same
  /// follow-up is still recognised as a duplicate.
  static const rememberRung = Duration(hours: 12);

  Future<void>? _running;
  bool _again = false;

  /// Stable positive 31-bit id (FNV-1a) so the same follow-up always maps to the same notification.
  static int notificationId(String key) {
    var h = 0x811c9dc5;
    for (final c in utf8.encode(key)) {
      h ^= c;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return h & 0x7fffffff;
  }

  /// When this follow-up's reminder should ring, or null for none.
  static DateTime? reminderTime(Map<String, dynamic> f, int defaultMinutes) {
    final explicit = f.containsKey('reminderAt');
    if (explicit && f['reminderAt'] == null) return null; // reminder switched off
    final at = explicit ? DateTime.tryParse(f['reminderAt'] as String? ?? '') : null;
    if (at != null) return at.toUtc();
    final due = DateTime.tryParse(f['dueAt'] as String? ?? '');
    if (due == null) return null;
    final minutes = (f['reminderMinutesBefore'] as num?)?.toInt() ?? defaultMinutes;
    return due.toUtc().subtract(Duration(minutes: minutes));
  }

  /// Rules for which follow-ups get a local reminder.
  static bool wanted(LocalRecord r, String? me, DateTime now, int defaultMinutes) {
    if (r.deleted || me == null) return false;
    final f = r.data;
    if ((f['status'] as String? ?? 'PENDING') != 'PENDING') return false;
    if (JsonModel.refId(f['assignedTo']) != me) return false;
    final at = reminderTime(f, defaultMinutes);
    return at != null && at.isAfter(now);
  }

  /// The reminders that should be scheduled right now.
  Future<List<ReminderPlan>> plan({DateTime? now}) async {
    final t = now ?? DateTime.now().toUtc();
    final me = userId();
    final minutes = await defaultMinutes();
    final rows = (await db.list(Entities.followUps)).where((r) => wanted(r, me, t, minutes)).toList();
    if (rows.isEmpty) return const [];
    final tr = await text();
    final plans = <ReminderPlan>[];
    for (final r in rows) {
      final f = FollowUp(r.data, local: r);
      final client = f.client?['fullName'] as String? ?? await _clientName(f.clientId);
      final type = tr('enums.followUpType.${f.type}');
      plans.add(ReminderPlan(
        key: r.uuid,
        ids: [r.uuid, ?r.serverId],
        notificationId: notificationId(r.uuid),
        at: reminderTime(r.data, minutes)!,
        title: tr('mobile.reminders.title'),
        body: client == null ? type : tr('mobile.reminders.body', {'type': type, 'client': client}),
        payload: '/followups/${r.refId}',
      ));
    }
    return plans;
  }

  Future<String?> _clientName(String? id) async => id == null ? null : (await db.get(Entities.clients, id))?.data['fullName'] as String?;

  Future<Map<String, Map<String, dynamic>>> _stored() async {
    final raw = await db.getJson(kvKey);
    return {for (final e in (raw ?? const {}).entries) e.key: Map<String, dynamic>.from(e.value as Map)};
  }

  /// Brings the phone's scheduled reminders in line with the local follow-ups. Calls arriving
  /// while a pass runs are folded into one more pass, so the last change always wins.
  Future<void> resync({DateTime? now}) {
    if (_running != null) {
      _again = true;
      return _running!;
    }
    return _running = _loop(now).whenComplete(() => _running = null);
  }

  Future<void> _loop(DateTime? now) async {
    do {
      _again = false;
      await _resyncOnce(now ?? DateTime.now().toUtc());
    } while (_again);
  }

  Future<void> _resyncOnce(DateTime now) async {
    final desired = {for (final p in await plan(now: now)) p.key: p};
    final stored = await _stored();
    final next = <String, Map<String, dynamic>>{};
    final exact = desired.isEmpty ? false : await platform.exactAllowed();

    for (final e in stored.entries) {
      final at = DateTime.tryParse(e.value['at'] as String? ?? '');
      final rung = at != null && !at.isAfter(now);
      if (desired.containsKey(e.key)) continue;
      if (rung) {
        // Already rang: remember it for a while (push de-duplication), nothing to cancel.
        if (now.difference(at) < rememberRung) next[e.key] = e.value;
      } else {
        await platform.cancel((e.value['id'] as num).toInt());
      }
    }
    for (final p in desired.values) {
      final old = stored[p.key];
      final same = old != null && old['at'] == p.toJson()['at'] && old['title'] == p.title && old['body'] == p.body;
      if (!same) await platform.schedule(p, exact: exact);
      next[p.key] = p.toJson();
    }
    await db.setJson(kvKey, next);
  }

  /// Sign-out: nothing of this user's may ring on the phone any more.
  Future<void> cancelAll() async {
    await _running;
    for (final e in (await _stored()).values) {
      await platform.cancel((e['id'] as num).toInt());
    }
    await db.setJson(kvKey, {});
  }

  /// A reminder push arrived for [followUpId]: show it only if the phone has no local reminder for it.
  static bool shouldShowPushFor(Map<String, dynamic>? stored, String followUpId) {
    if (stored == null) return true;
    return !stored.values.any((e) => e is Map && ((e['ids'] as List?) ?? const []).contains(followUpId));
  }

  Future<bool> shouldShowPush(String followUpId) async => shouldShowPushFor(await db.getJson(kvKey), followUpId);
}

/// `flutter_local_notifications` implementation. Instants are scheduled in UTC, so changing the
/// phone's time zone cannot move a reminder; Android restores them after a reboot through the
/// plugin's boot receiver (declared in AndroidManifest.xml).
class LocalNotificationsPlatform implements ReminderPlatform {
  LocalNotificationsPlatform(this._plugin);

  final FlutterLocalNotificationsPlugin _plugin;
  static bool _tzReady = false;

  static const channel = AndroidNotificationChannel('crm_reminders', 'Follow-up reminders',
      description: 'Reminders for your follow-ups (work without internet)', importance: Importance.high);

  AndroidFlutterLocalNotificationsPlugin? get _android => _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();

  Future<void> init() async {
    if (!_tzReady) {
      tzdata.initializeTimeZones();
      _tzReady = true;
    }
    await _android?.createNotificationChannel(channel);
  }

  /// Asks Android 13+ for notification permission and Android 12+ for exact alarms (once).
  Future<void> requestPermissions() async {
    await _android?.requestNotificationsPermission();
    if (!await exactAllowed()) await _android?.requestExactAlarmsPermission();
  }

  @override
  Future<bool> exactAllowed() async => (await _android?.canScheduleExactNotifications()) ?? true;

  @override
  Future<void> schedule(ReminderPlan plan, {required bool exact}) async {
    await init();
    await _plugin.zonedSchedule(
      id: plan.notificationId,
      title: plan.title,
      body: plan.body,
      payload: plan.payload,
      scheduledDate: tz.TZDateTime.from(plan.at.toUtc(), tz.UTC),
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(channel.id, channel.name,
            channelDescription: channel.description, importance: Importance.high, priority: Priority.high, category: AndroidNotificationCategory.reminder),
        iOS: const DarwinNotificationDetails(),
      ),
      // Exact when allowed; otherwise Android may delay it a few minutes (Doze), but it still rings.
      androidScheduleMode: exact ? AndroidScheduleMode.exactAllowWhileIdle : AndroidScheduleMode.inexactAllowWhileIdle,
    );
  }

  @override
  Future<void> cancel(int notificationId) => _plugin.cancel(id: notificationId);
}
