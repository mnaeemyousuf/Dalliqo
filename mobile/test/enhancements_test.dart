import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/models/models.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  late AppDatabase db;
  late LocalStore store;
  late CrmRepository repo;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    store = LocalStore(db);
    repo = CrmRepository(db, store);
  });
  tearDown(() => db.close());

  String daysAgo(int n) => DateTime.now().subtract(Duration(days: n)).toUtc().toIso8601String();

  group('listing verification', () {
    test('available listings older than 30 days need verification; sold ones never do', () {
      expect(Property({'status': 'AVAILABLE', 'lastVerifiedAt': daysAgo(45)}).needsVerification, isTrue);
      expect(Property({'status': 'AVAILABLE'}).needsVerification, isTrue);
      expect(Property({'status': 'AVAILABLE', 'lastVerifiedAt': daysAgo(5)}).needsVerification, isFalse);
      expect(Property({'status': 'SOLD', 'lastVerifiedAt': daysAgo(300)}).needsVerification, isFalse);
    });

    test('the property filter can show only listings that need verification', () {
      const f = PropertyFilter(needsVerification: true);
      expect(f.active, isTrue);
      expect(f.matches({'status': 'AVAILABLE', 'lastVerifiedAt': daysAgo(60)}), isTrue);
      expect(f.matches({'status': 'AVAILABLE', 'lastVerifiedAt': daysAgo(2)}), isFalse);
      expect(f.cleared().needsVerification, isFalse);
    });
  });

  group('duplicate clients (offline check)', () {
    test('finds existing clients by mobile, WhatsApp or alternate number', () async {
      final ali = await store.create(Entities.clients, {'fullName': 'Muhammad Ali', 'mobileNumber': '+923001112233'});
      await store.create(Entities.clients, {'fullName': 'Sana Tariq', 'mobileNumber': '+923007770000', 'alternateNumber': '+923214445566'});

      expect((await repo.clientsWithPhones(['+923001112233'])).map((c) => c.fullName), ['Muhammad Ali']);
      expect((await repo.clientsWithPhones([null, '+923214445566'])).map((c) => c.fullName), ['Sana Tariq']);
      expect(await repo.clientsWithPhones(['+923339998877']), isEmpty);
      // Editing a client must not flag the client itself.
      expect(await repo.clientsWithPhones(['+923001112233'], exceptId: ali.uuid), isEmpty);
    });
  });

  group('follow-up reschedule', () {
    test('works offline: updates the local row and queues one change for sync', () async {
      final f = await store.create(Entities.followUps, {'clientId': 'c1', 'type': 'CALL', 'dueAt': daysAgo(1), 'status': 'PENDING'});
      expect(FollowUp(f.data).status, 'OVERDUE');

      final next = DateTime.now().add(const Duration(days: 2));
      await repo.rescheduleFollowUp(f.uuid, next);
      final row = await db.get(Entities.followUps, f.uuid);
      final updated = FollowUp(row!.data);
      expect(updated.status, 'PENDING');
      expect(updated.dueAt.difference(next).inSeconds.abs(), lessThan(1));
      final outbox = await db.allOutbox();
      expect(outbox, hasLength(1)); // coalesced into the waiting create
      expect(outbox.single.data['dueAt'], next.toUtc().toIso8601String());
    });
  });
}
