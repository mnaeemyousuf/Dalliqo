import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/branch/branch_scope.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  late AppDatabase db;
  late BranchScope scope;
  late CrmRepository repo;

  Future<void> put(String entity, String uuid, Map<String, dynamic> data) =>
      db.put(LocalRecord(entity: entity, uuid: uuid, serverId: 'srv-$uuid', version: 1, data: {'_id': 'srv-$uuid', 'uuid': uuid, ...data}));

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    await put(Entities.branches, 'main', {'name': 'Main Branch', 'isDefault': true});
    await put(Entities.branches, 'clifton', {'name': 'Clifton Office', 'nameUr': 'کلفٹن آفس', 'isDefault': false});
    await put(Entities.branches, 'old', {'name': 'Closed Office', 'isDefault': false, 'archivedAt': '2026-01-01T00:00:00Z'});
    scope = BranchScope(db);
    await scope.load();
    repo = CrmRepository(db, LocalStore(db), branch: scope);
    await put(Entities.clients, 'c-main', {'fullName': 'Main Client', 'branchId': 'srv-main'});
    await put(Entities.clients, 'c-clifton', {'fullName': 'Clifton Client', 'branchId': 'srv-clifton'});
    await put(Entities.clients, 'c-legacy', {'fullName': 'Legacy Client'}); // from before branches: main branch
  });
  tearDown(() async {
    scope.dispose();
    await db.close();
  });

  Future<List<String>> clientNames() async => (await repo.clients(const ClientFilter(), limit: 100)).map((c) => c.fullName).toList()..sort();

  test('the switcher lists live branches, main first; archived ones are hidden', () {
    expect(scope.branches.map((b) => b.name), ['Main Branch', 'Clifton Office']);
    expect(scope.hasChoice, isTrue);
    expect(scope.defaultId, 'srv-main');
    expect(scope.branches.last.label(true), 'کلفٹن آفس');
  });

  test('records without a branch belong to the main branch', () {
    expect(BranchScope.matches({}, selected: 'srv-main', defaultId: 'srv-main'), isTrue);
    expect(BranchScope.matches({}, selected: 'srv-clifton', defaultId: 'srv-main'), isFalse);
    expect(BranchScope.matches({'branchId': {'_id': 'srv-clifton'}}, selected: 'srv-clifton', defaultId: 'srv-main'), isTrue);
    expect(BranchScope.matches({'branchId': 'x'}, selected: null, defaultId: 'srv-main'), isTrue);
  });

  test('local lists follow the selected branch; the pick is remembered', () async {
    expect(await clientNames(), ['Clifton Client', 'Legacy Client', 'Main Client']);
    await scope.select('srv-clifton');
    expect(await clientNames(), ['Clifton Client']);
    await scope.select('srv-main');
    expect(await clientNames(), ['Legacy Client', 'Main Client']);

    final again = BranchScope(db);
    await again.load();
    expect(again.selected, 'srv-main');
    again.dispose();
  });

  test('records created offline go to the selected branch, else the main branch', () async {
    final a = await repo.saveClient({'fullName': 'New A', 'mobileNumber': '+923001110000'});
    expect(a.branchId, 'srv-main');
    await scope.select('srv-clifton');
    final b = await repo.saveOwner({'fullName': 'New Owner', 'mobileNumber': '+923001110001'});
    expect(b.branchId, 'srv-clifton');
    final explicit = await repo.saveProperty({'propertyType': 'HOUSE', 'size': 120, 'sizeUnit': 'SQ_YARD', 'askingPrice': 1, 'branchId': 'srv-main'});
    expect(explicit.branchId, 'srv-main');
  });

  test('a follow-up created offline belongs to its client\'s branch', () async {
    await scope.select('srv-main');
    final f = await repo.saveFollowUp({'clientId': 'srv-c-clifton', 'type': 'CALL', 'dueAt': DateTime.now().toUtc().toIso8601String(), 'status': 'PENDING'});
    expect(f.branchId, 'srv-clifton');
    // Shown on the client screen even though the list filter is on another branch.
    expect((await repo.followUps(clientId: 'srv-c-clifton')).length, 1);
    expect(await repo.followUps(), isEmpty);
  });
}
