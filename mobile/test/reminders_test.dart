import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/notifications/reminder_scheduler.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Records what the scheduler asks the phone to do.
class FakePlatform implements ReminderPlatform {
  final scheduled = <int, ReminderPlan>{};
  final log = <String>[];
  bool exact = true;

  @override
  Future<void> schedule(ReminderPlan plan, {required bool exact}) async {
    scheduled[plan.notificationId] = plan;
    log.add('schedule:${plan.key}:${exact ? 'exact' : 'inexact'}');
  }

  @override
  Future<void> cancel(int notificationId) async {
    scheduled.remove(notificationId);
    log.add('cancel:$notificationId');
  }

  @override
  Future<bool> exactAllowed() async => exact;
}

void main() {
  late AppDatabase db;
  late LocalStore store;
  late FakePlatform platform;
  late ReminderScheduler scheduler;
  var me = 'u-father';
  final now = DateTime.utc(2026, 11, 2, 9);

  String iso(DateTime d) => d.toUtc().toIso8601String();

  Future<LocalRecord> putSynced(String uuid, Map<String, dynamic> data, {String? serverId}) async {
    final r = LocalRecord(entity: Entities.followUps, uuid: uuid, serverId: serverId ?? 'srv-$uuid', version: 1, data: {'uuid': uuid, '_id': serverId ?? 'srv-$uuid', ...data});
    await db.put(r);
    return r;
  }

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    store = LocalStore(db);
    platform = FakePlatform();
    me = 'u-father';
    scheduler = ReminderScheduler(
      db,
      platform,
      userId: () => me,
      defaultMinutes: () async => 30,
      text: () async => (String key, [Map<String, Object?> p = const {}]) => p.isEmpty ? key : '$key ${p.values.join('|')}',
    );
    await db.put(LocalRecord(entity: Entities.clients, uuid: 'c1', serverId: 'srv-c1', data: {'_id': 'srv-c1', 'fullName': 'Muhammad Ali'}));
  });
  tearDown(() => db.close());

  group('reminder time', () {
    final due = DateTime.utc(2026, 11, 3, 10);
    test('uses the stored reminder time, else due time minus the minutes before', () {
      expect(ReminderScheduler.reminderTime({'dueAt': iso(due), 'reminderAt': iso(due.subtract(const Duration(hours: 2)))}, 30), due.subtract(const Duration(hours: 2)));
      expect(ReminderScheduler.reminderTime({'dueAt': iso(due)}, 30), due.subtract(const Duration(minutes: 30)));
      expect(ReminderScheduler.reminderTime({'dueAt': iso(due), 'reminderMinutesBefore': 0}, 30), due);
    });
    test('a reminder switched off (reminderAt: null) never rings', () {
      expect(ReminderScheduler.reminderTime({'dueAt': iso(due), 'reminderAt': null}, 30), isNull);
    });
    test('notification ids are stable and positive', () {
      final a = ReminderScheduler.notificationId('5f0c2a3e-1111-4222-8333-444455556666');
      expect(a, ReminderScheduler.notificationId('5f0c2a3e-1111-4222-8333-444455556666'));
      expect(a, isNonNegative);
      expect(a, lessThan(1 << 31));
      expect(a, isNot(ReminderScheduler.notificationId('5f0c2a3e-1111-4222-8333-444455556667')));
    });
  });

  group('which follow-ups ring on this phone', () {
    test('only my pending follow-ups with a future reminder', () async {
      final soon = iso(now.add(const Duration(hours: 3)));
      await putSynced('mine', {'assignedTo': me, 'status': 'PENDING', 'dueAt': soon, 'type': 'CALL', 'clientId': 'srv-c1'});
      await putSynced('populated', {'assignedTo': {'_id': me, 'fullName': 'Father'}, 'status': 'PENDING', 'dueAt': soon, 'type': 'MEETING', 'clientId': {'_id': 'srv-c1', 'fullName': 'Sana Khan'}});
      await putSynced('son', {'assignedTo': 'u-son', 'status': 'PENDING', 'dueAt': soon});
      await putSynced('done', {'assignedTo': me, 'status': 'COMPLETED', 'dueAt': soon});
      await putSynced('cancelled', {'assignedTo': me, 'status': 'CANCELLED', 'dueAt': soon});
      await putSynced('past', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.subtract(const Duration(hours: 1)))});
      await db.put(LocalRecord(entity: Entities.followUps, uuid: 'deleted', serverId: 'srv-del', deleted: true, data: {'assignedTo': me, 'status': 'PENDING', 'dueAt': soon}));

      final plans = await scheduler.plan(now: now);
      expect(plans.map((p) => p.key).toSet(), {'mine', 'populated'});
      final mine = plans.firstWhere((p) => p.key == 'mine');
      expect(mine.at, now.add(const Duration(hours: 3)).subtract(const Duration(minutes: 30)));
      expect(mine.title, 'mobile.reminders.title');
      expect(mine.body, contains('Muhammad Ali')); // client name looked up locally
      expect(plans.firstWhere((p) => p.key == 'populated').body, contains('Sana Khan'));
      expect(mine.payload, '/followups/srv-mine'); // deep link opens the follow-up
      expect(mine.ids, ['mine', 'srv-mine']);
    });
  });

  group('resync', () {
    test('schedules, re-schedules when the time changes, leaves unchanged ones alone, cancels completed ones', () async {
      final r = await putSynced('f1', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(days: 1))), 'type': 'CALL'});
      await scheduler.resync(now: now);
      expect(platform.log, ['schedule:f1:exact']);

      platform.log.clear();
      await scheduler.resync(now: now);
      expect(platform.log, isEmpty, reason: 'nothing changed, nothing re-scheduled');

      // Rescheduled to a week later (e.g. "follow up after one week").
      await db.put(LocalRecord(entity: r.entity, uuid: r.uuid, serverId: r.serverId, version: 2, data: {...r.data, 'dueAt': iso(now.add(const Duration(days: 7)))}));
      await scheduler.resync(now: now);
      expect(platform.log, ['schedule:f1:exact']);
      expect(platform.scheduled.values.single.at, now.add(const Duration(days: 7)).subtract(const Duration(minutes: 30)));

      platform.log.clear();
      await db.put(LocalRecord(entity: r.entity, uuid: r.uuid, serverId: r.serverId, version: 3, data: {...r.data, 'status': 'COMPLETED'}));
      await scheduler.resync(now: now);
      expect(platform.log, ['cancel:${ReminderScheduler.notificationId('f1')}']);
      expect(platform.scheduled, isEmpty);
    });

    test('a follow-up created offline gets a reminder before it ever syncs; it keeps it after syncing', () async {
      final local = await store.create(Entities.followUps, {'clientId': 'srv-c1', 'type': 'CALL', 'dueAt': iso(DateTime.now().add(const Duration(days: 1))), 'assignedTo': me, 'status': 'PENDING'});
      await scheduler.resync();
      final plan = platform.scheduled.values.single;
      expect(plan.key, local.uuid);
      expect(plan.payload, '/followups/${local.uuid}');
      expect(await scheduler.shouldShowPush(local.uuid), isFalse);

      // Sync assigns the server id: same notification, now also known by the server id pushes carry.
      platform.log.clear();
      await db.put(LocalRecord(entity: Entities.followUps, uuid: local.uuid, serverId: 'srv-new', version: 1, data: {...local.data, '_id': 'srv-new', 'version': 1}));
      await scheduler.resync();
      expect(platform.scheduled.keys.single, ReminderScheduler.notificationId(local.uuid));
      expect(await scheduler.shouldShowPush('srv-new'), isFalse);
    });

    test('deleting or reassigning cancels the reminder; inexact mode when exact alarms are refused', () async {
      platform.exact = false;
      final r = await putSynced('f2', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(hours: 5)))});
      await scheduler.resync(now: now);
      expect(platform.log, ['schedule:f2:inexact']);
      await db.put(LocalRecord(entity: r.entity, uuid: r.uuid, serverId: r.serverId, data: {...r.data, 'assignedTo': 'u-son'}));
      await scheduler.resync(now: now);
      expect(platform.scheduled, isEmpty);
    });

    test('sign-out cancels everything', () async {
      await putSynced('a', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(hours: 5)))});
      await putSynced('b', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(hours: 6)))});
      await scheduler.resync(now: now);
      expect(platform.scheduled, hasLength(2));
      await scheduler.cancelAll();
      expect(platform.scheduled, isEmpty);
      expect(await db.getJson(ReminderScheduler.kvKey), isEmpty);
    });
  });

  group('no duplicate when the Firebase push for the same follow-up arrives', () {
    test('pushes for follow-ups with a local reminder are skipped; others are shown', () async {
      await putSynced('f3', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(hours: 2)))});
      await scheduler.resync(now: now);
      expect(await scheduler.shouldShowPush('srv-f3'), isFalse);
      expect(await scheduler.shouldShowPush('f3'), isFalse);
      expect(await scheduler.shouldShowPush('assigned-on-web-while-offline'), isTrue);
    });

    test('a reminder that already rang is remembered for 12 hours, then forgotten', () async {
      await putSynced('f4', {'assignedTo': me, 'status': 'PENDING', 'dueAt': iso(now.add(const Duration(minutes: 40)))});
      await scheduler.resync(now: now); // rings at now + 10 min
      await scheduler.resync(now: now.add(const Duration(hours: 1)));
      expect(await scheduler.shouldShowPush('srv-f4'), isFalse, reason: 'late push after the local reminder rang');
      expect(platform.log.where((l) => l.startsWith('cancel')), isEmpty, reason: 'nothing to cancel once rung');
      await scheduler.resync(now: now.add(const Duration(hours: 13)));
      expect(await scheduler.shouldShowPush('srv-f4'), isTrue);
    });

    test('works on the stored map alone (used by the background push handler)', () {
      expect(ReminderScheduler.shouldShowPushFor(null, 'x'), isTrue);
      expect(ReminderScheduler.shouldShowPushFor({'k': {'ids': ['k', 'srv-k']}}, 'srv-k'), isFalse);
    });
  });
}
