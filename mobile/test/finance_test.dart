import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
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
    final cats = [
      {'_id': 'k-com', 'key': 'COMMISSION', 'name': 'Commission', 'nameUr': 'کمیشن', 'type': 'INCOME', 'sortOrder': 0},
      {'_id': 'k-rent', 'key': 'OFFICE_RENT', 'name': 'Office rent', 'nameUr': 'دفتر کا کرایہ', 'type': 'EXPENSE', 'sortOrder': 4},
      {'_id': 'k-old', 'name': 'Old', 'type': 'EXPENSE', 'sortOrder': 9, 'archivedAt': '2026-01-01T00:00:00Z'},
    ];
    for (final c in cats) {
      await db.put(LocalRecord(entity: Entities.transactionCategories, uuid: c['_id'] as String, serverId: c['_id'] as String, version: 1, data: c));
    }
    // Commission income created by the server from a deal payment (pulled by sync).
    await db.put(LocalRecord(entity: Entities.transactions, uuid: 't-com', serverId: 't-com', version: 1, data: {
      '_id': 't-com', 'type': 'INCOME', 'categoryId': 'k-com', 'amount': 200000, 'date': '2026-10-05T07:00:00Z', 'method': 'BANK_TRANSFER', 'source': 'COMMISSION', 'dealId': 'd1',
    }));
  });
  tearDown(() => db.close());

  test('categories by type, archived ones hidden, Urdu labels', () async {
    expect((await repo.moneyCategories(type: 'EXPENSE')).map((c) => c.name), ['Office rent']);
    expect((await repo.moneyCategories(includeArchived: true)), hasLength(3));
    expect((await repo.moneyCategories(type: 'INCOME')).single.label(true), 'کمیشن');
  });

  test('an expense recorded offline is queued once with only API fields, and edits fold into it', () async {
    final e = await repo.saveMoneyEntry({'type': 'EXPENSE', 'categoryId': 'k-rent', 'amount': 85000, 'date': '2026-10-01T07:00:00Z', 'description': 'October rent'});
    await repo.saveMoneyEntry({'amount': 90000}, id: e.local!.uuid);
    final q = await db.allOutbox();
    expect(q, hasLength(1));
    expect(q.single.entity, 'transactions');
    expect(q.single.op, 'create');
    expect(q.single.data, {'type': 'EXPENSE', 'categoryId': 'k-rent', 'amount': 90000, 'date': '2026-10-01T07:00:00Z', 'description': 'October rent', 'method': 'CASH'});
    expect((await repo.moneyEntries(type: 'EXPENSE')).single.amount, 90000);
    expect(await repo.moneyEntries(search: 'october'), hasLength(1));
  });

  test('commission income is read-only on the phone', () async {
    expect(() => repo.saveMoneyEntry({'amount': 1}, id: 't-com'), throwsStateError);
    expect(() => repo.deleteMoneyEntry('t-com'), throwsStateError);
    expect(await db.allOutbox(), isEmpty);
  });

  test('summary by month (Karachi time) and by category matches the server report', () async {
    await repo.saveMoneyEntry({'type': 'EXPENSE', 'categoryId': 'k-rent', 'amount': 85000, 'date': '2026-10-31T20:00:00Z'}); // 1 Nov in Karachi
    await repo.saveMoneyEntry({'type': 'EXPENSE', 'categoryId': 'k-rent', 'amount': 30000, 'date': '2026-10-15T07:00:00Z'});
    final byMonth = await repo.financeSummary();
    expect(byMonth.rows.map((r) => [r.key, r.income, r.expense, r.net]), [
      ['2026-10', 200000, 30000, 170000],
      ['2026-11', 0, 85000, -85000],
    ]);
    expect([byMonth.income, byMonth.expense, byMonth.net], [200000, 115000, 85000]);
    final byCat = await repo.financeSummary(groupBy: 'category');
    expect(byCat.rows.first.category?.name, 'Commission');
    expect(byCat.rows.last.expense, 115000);
    final october = await repo.financeSummary(from: DateTime.utc(2026, 9, 30, 19), to: DateTime.utc(2026, 10, 31, 18, 59));
    expect(october.expense, 30000);
  });
}
