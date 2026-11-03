import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/models/models.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  late AppDatabase db;
  late CrmRepository repo;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    repo = CrmRepository(db, LocalStore(db));
    await db.put(LocalRecord(entity: Entities.clients, uuid: 'c1', serverId: 'srv-c1', version: 1, data: {'_id': 'srv-c1', 'fullName': 'Saad Ansari', 'branchId': 'b-clifton'}));
    for (final t in [
      {'_id': 't1', 'key': 'RENT_EN', 'name': 'Tenancy agreement', 'kind': 'RENT', 'language': 'en', 'builtIn': true},
      {'_id': 't2', 'key': 'RENT_UR', 'name': 'کرایہ نامہ', 'kind': 'RENT', 'language': 'ur', 'builtIn': true},
      {'_id': 't3', 'name': 'Old rent', 'kind': 'RENT', 'language': 'en', 'archivedAt': '2026-01-01T00:00:00Z'},
    ]) {
      await db.put(LocalRecord(entity: Entities.agreementTemplates, uuid: t['_id'] as String, serverId: t['_id'] as String, version: 1, data: t));
    }
    // A signed agreement synced from the server (with its rendered text).
    await db.put(LocalRecord(entity: Entities.agreements, uuid: 'a-signed', serverId: 'a-signed', version: 4, data: {
      '_id': 'a-signed', 'agreementNo': 'AG-000001', 'kind': 'SALE', 'language': 'en', 'status': 'SIGNED', 'clientId': {'_id': 'srv-c1', 'fullName': 'Saad Ansari'},
      'versions': [{'no': 1, 'body': 'AGREEMENT TO SELL', 'source': 'RENDER'}], 'updatedAt': '2026-11-01T00:00:00Z',
    }));
  });
  tearDown(() => db.close());

  test('templates by kind and language, archived hidden', () async {
    expect((await repo.agreementTemplates(kind: 'RENT', language: 'en')).map((t) => t.name), ['Tenancy agreement']);
    expect((await repo.agreementTemplates(kind: 'RENT', language: 'ur')).single.name, 'کرایہ نامہ');
  });

  test('a rent draft made offline joins its client\'s branch, shows as a draft and queues only API fields', () async {
    final a = await repo.saveAgreement({'kind': 'RENT', 'language': 'en', 'clientId': 'srv-c1', 'monthlyRent': 85000, 'endDate': '2027-06-30T00:00:00.000Z'});
    expect(a.status, 'DRAFT');
    expect(a.branchId, 'b-clifton');
    expect(a.versions, isEmpty);
    final q = (await db.allOutbox()).single;
    expect(q.entity, 'agreements');
    expect(q.op, 'create');
    expect(q.data, {'kind': 'RENT', 'language': 'en', 'clientId': 'srv-c1', 'monthlyRent': 85000, 'endDate': '2027-06-30T00:00:00.000Z', 'branchId': 'b-clifton'});
    // Status changes wait for the server copy (it renders the text first).
    expect(() => repo.changeAgreementStatus(a.local!.uuid, 'SENT'), throwsStateError);
    expect(await repo.agreements(status: 'DRAFT'), hasLength(1));
  });

  test('status moves follow the same rules as the server; signed agreements are locked', () async {
    expect(Agreement({'status': 'DRAFT'}).nextStatuses, ['SENT', 'SIGNED', 'CANCELLED']);
    expect(Agreement({'status': 'CANCELLED'}).nextStatuses, isEmpty);
    expect(() => repo.changeAgreementStatus('a-signed', 'DRAFT'), throwsStateError);
    expect(() => repo.saveAgreement({'notes': 'x'}, id: 'a-signed'), throwsStateError);
    expect(() => repo.deleteAgreement('a-signed'), throwsStateError);
    await repo.changeAgreementStatus('a-signed', 'EXPIRED');
    final q = (await db.allOutbox()).single;
    expect([q.op, q.data], ['update', {'status': 'EXPIRED'}]);
    expect((await repo.agreement('a-signed'))!.status, 'EXPIRED');
  });

  test('lists filter by status, kind, deal and search; expiring rent agreements', () async {
    final soon = DateTime.now().add(const Duration(days: 12)).toUtc().toIso8601String();
    await db.put(LocalRecord(entity: Entities.agreements, uuid: 'a-rent', serverId: 'a-rent', version: 2, data: {
      '_id': 'a-rent', 'agreementNo': 'AG-000002', 'kind': 'RENT', 'status': 'SIGNED', 'clientId': 'srv-c1', 'dealId': 'd1', 'endDate': soon, 'updatedAt': '2026-11-02T00:00:00Z',
    }));
    expect((await repo.agreements(kind: 'RENT')).single.agreementNo, 'AG-000002');
    expect((await repo.agreements(dealId: 'd1')).single.agreementNo, 'AG-000002');
    expect((await repo.agreements(search: 'saad')).single.agreementNo, 'AG-000001');
    expect((await repo.agreements(expiringSoon: true)).single.agreementNo, 'AG-000002');
    expect((await repo.agreements()).map((a) => a.agreementNo), ['AG-000002', 'AG-000001']);
  });
}
