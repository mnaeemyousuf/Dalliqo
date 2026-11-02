import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/commission/commission.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  group('commission maths (same cases as the API test)', () {
    test('percentages of the final price, fixed amounts as-is, agent shares and payouts', () {
      final s = summarizeCommission({
        'agreedPrice': 20000000,
        'finalPrice': 19500000,
        'commission': {
          'buyer': {'mode': 'PERCENT', 'value': 1},
          'seller': {'mode': 'FIXED', 'value': 150000},
        },
        'agents': [
          {'userId': 'a', 'sharePct': 60},
          {'userId': {'_id': 'b', 'fullName': 'Son'}, 'sharePct': 40},
        ],
        'payments': [
          {'side': 'BUYER', 'amount': 195000},
        ],
        'payouts': [
          {'userId': 'a', 'amount': 50000, 'status': 'PAID'},
          {'userId': 'a', 'amount': 20000, 'status': 'PENDING'},
        ],
      });
      expect(s.basePrice, 19500000);
      expect([s.expectedBuyer, s.expectedSeller, s.expected], [195000, 150000, 345000]);
      expect([s.receivedBuyer, s.receivedSeller, s.received], [195000, 0, 195000]);
      expect(s.outstanding, 150000);
      expect(s.status, 'PARTIALLY_RECEIVED');
      final a = s.agents.first;
      expect([a.expected, a.received, a.paidOut, a.owed], [207000, 117000, 50000, 67000]);
      final b = s.agents.last;
      expect([b.userId, b.expected, b.received, b.owed], ['b', 138000, 78000, 78000]);
    });

    test('agreed price fallback, empty deal, fully received', () {
      expect(summarizeCommission({'agreedPrice': 10000000, 'commission': {'buyer': {'mode': 'PERCENT', 'value': 2}}}).expected, 200000);
      expect(summarizeCommission({}).status, 'PENDING');
      expect(
        summarizeCommission({
          'commission': {'buyer': {'mode': 'FIXED', 'value': 1000}},
          'payments': [{'side': 'BUYER', 'amount': 1000}],
        }).status,
        'RECEIVED',
      );
    });

    test('agent shares must total 100%', () {
      expect(sharesValid([50, 50]), isTrue);
      expect(sharesValid([33.33, 33.33, 33.34]), isTrue);
      expect(sharesValid([60, 30]), isFalse);
      expect(sharesValid([]), isFalse);
    });
  });

  group('deals offline', () {
    late AppDatabase db;
    late CrmRepository repo;

    setUpAll(sqfliteFfiInit);
    setUp(() async {
      db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
      repo = CrmRepository(db, LocalStore(db));
      await db.put(LocalRecord(entity: Entities.clients, uuid: 'c1', serverId: 'srv-c1', version: 1, data: {'_id': 'srv-c1', 'fullName': 'Muhammad Ali', 'branchId': 'b-clifton'}));
    });
    tearDown(() => db.close());

    Future<List<Map<String, dynamic>>> outbox() async => (await db.allOutbox()).map((e) => {'op': e.op, 'entity': e.entity, ...e.data}).toList();

    test('a new deal starts at Inquiry in its client\'s branch and is queued for sync', () async {
      final d = await repo.saveDeal({'clientId': 'srv-c1', 'agreedPrice': 15000000, 'agents': [{'userId': 'u1', 'sharePct': 100}]});
      expect(d.stage, 'INQUIRY');
      expect(d.branchId, 'b-clifton');
      final q = await outbox();
      expect(q.single, containsPair('op', 'create'));
      expect(q.single['entity'], 'deals');
    });

    test('payments, payouts and stage changes are recorded offline with their own ids', () async {
      final d = await repo.saveDeal({'clientId': 'srv-c1', 'finalPrice': 20000000, 'agents': [{'userId': 'u1', 'sharePct': 100}]});
      await repo.addDealPayment(d.id, {'side': 'BUYER', 'amount': 200000, 'date': '2026-10-05T00:00:00Z', 'method': 'CASH'});
      await repo.addDealPayout(d.id, {'userId': 'u1', 'amount': 50000});
      var now = (await repo.deal(d.id))!;
      expect(now.payments.single['_id'], isA<String>());
      expect(summarizeCommission(now.json).received, 200000);
      await repo.markDealPayoutPaid(now.id, now.payouts.single['_id'] as String);
      await repo.changeDealStage(now.id, 'TOKEN', by: 'u1');
      now = (await repo.deal(d.id))!;
      expect(now.payouts.single['status'], 'PAID');
      expect(now.stage, 'TOKEN');
      expect(now.stageHistory.last['stage'], 'TOKEN');
      // Not yet synced: every edit is folded into the single pending create.
      final q = await db.allOutbox();
      expect(q, hasLength(1));
      final data = q.single.data;
      expect((data['payments'] as List).single, containsPair('amount', 200000));
      expect((data['payouts'] as List).single, containsPair('status', 'PAID'));
      expect(data['stage'], 'TOKEN');
      // Only fields the API accepts are sent (no local-only history).
      expect(data.containsKey('stageHistory'), isFalse);
      expect(jsonEncode(data), isNot(contains('transactionId')));
    });

    test('removing a payment updates the totals', () async {
      final d = await repo.saveDeal({'clientId': 'srv-c1', 'finalPrice': 10000000, 'agents': [{'userId': 'u1', 'sharePct': 100}]});
      await repo.addDealPayment(d.id, {'side': 'SELLER', 'amount': 100000, 'date': '2026-10-05T00:00:00Z'});
      final withPay = (await repo.deal(d.id))!;
      await repo.removeDealPayment(d.id, withPay.payments.single['_id'] as String);
      expect(summarizeCommission((await repo.deal(d.id))!.json).received, 0);
    });

    test('lists filter by open/closed, stage, client and agent', () async {
      await repo.saveDeal({'clientId': 'srv-c1', 'agents': [{'userId': 'u1', 'sharePct': 100}]});
      final won = await repo.saveDeal({'clientId': 'srv-c1', 'stage': 'CLOSED_WON', 'agents': [{'userId': 'u2', 'sharePct': 100}]});
      expect(await repo.deals(open: true), hasLength(1));
      expect((await repo.deals(open: false)).single.id, won.id);
      expect(await repo.deals(stage: 'INQUIRY'), hasLength(1));
      expect(await repo.deals(clientId: 'srv-c1'), hasLength(2));
      expect((await repo.deals(agentId: 'u2')).single.id, won.id);
    });
  });
}
