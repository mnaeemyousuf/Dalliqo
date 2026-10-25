import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/network/api_client.dart';
import 'package:real_estate_crm/core/storage/secure_store.dart';
import 'package:real_estate_crm/core/sync/local_store.dart';
import 'package:real_estate_crm/core/sync/sync_engine.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Always-online connectivity for tests.
class _Online implements Connectivity {
  @override
  Future<List<ConnectivityResult>> checkConnectivity() async => [ConnectivityResult.wifi];
  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged => const Stream.empty();
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Answers API calls from in-test handlers instead of the network.
class _FakeAdapter implements HttpClientAdapter {
  final handlers = <String, Map<String, dynamic> Function(RequestOptions o, dynamic body)>{};
  final calls = <String>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    calls.add('${o.method} ${o.path}');
    final h = handlers['${o.method} ${o.path}'];
    if (h == null) return ResponseBody.fromString(jsonEncode({'success': false, 'code': 'NOT_FOUND', 'message': 'no handler'}), 404, headers: _json);
    return ResponseBody.fromString(jsonEncode({'success': true, 'data': h(o, o.data)}), 200, headers: _json);
  }

  static final _json = {
    Headers.contentTypeHeader: ['application/json'],
  };

  @override
  void close({bool force = false}) {}
}

class _MemoryStore extends SecureStore {
  _MemoryStore() : super();
  @override
  Future<String?> get accessToken async => 'token';
  @override
  Future<String?> get refreshToken async => 'refresh';
}

void main() {
  late AppDatabase db;
  late LocalStore store;
  late _FakeAdapter adapter;
  late SyncEngine engine;

  setUpAll(sqfliteFfiInit);

  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    store = LocalStore(db);
    adapter = _FakeAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'))..httpClientAdapter = adapter;
    engine = SyncEngine(db, ApiClient(_MemoryStore(), dio: dio), connectivity: _Online());
  });

  tearDown(() async {
    engine.stop();
    await engine.idle;
    await db.close();
  });

  group('offline writes', () {
    test('create stores the row and queues a create mutation in one go', () async {
      final r = await store.create(Entities.clients, {'fullName': 'Offline Client', 'mobileNumber': '+923001234567'});
      expect(r.syncStatus, SyncStatus.pending);
      final rows = await db.list(Entities.clients);
      expect(rows.single.data['fullName'], 'Offline Client');
      final outbox = await db.allOutbox();
      expect(outbox.single.op, 'create');
      expect(outbox.single.uuid, r.uuid);
    });

    test('edits before sync are coalesced into the waiting create', () async {
      final r = await store.create(Entities.clients, {'fullName': 'A', 'mobileNumber': '+923001234567'});
      await store.update(Entities.clients, r.uuid, {'priority': 'HIGH'});
      await store.update(Entities.clients, r.uuid, {'fullName': 'B'});
      final outbox = await db.allOutbox();
      expect(outbox, hasLength(1));
      expect(outbox.single.data, {'fullName': 'B', 'mobileNumber': '+923001234567', 'priority': 'HIGH'});
    });

    test('deleting a never-synced record just forgets it', () async {
      final r = await store.create(Entities.owners, {'fullName': 'Temp', 'mobileNumber': '+923001234567'});
      await store.delete(Entities.owners, r.uuid);
      expect(await db.list(Entities.owners), isEmpty);
      expect(await db.allOutbox(), isEmpty);
    });

    test('search matches local Pakistani number formats', () async {
      await store.create(Entities.clients, {'fullName': 'Muhammad Ali', 'mobileNumber': '+923001112233'});
      expect(await db.list(Entities.clients, search: '0300111'), hasLength(1));
      expect(await db.list(Entities.clients, search: 'ali'), hasLength(1));
      expect(await db.list(Entities.clients, search: 'zubair'), isEmpty);
    });
  });

  group('sync engine', () {
    test('pushes the outbox, adopts server ids and versions, then pulls', () async {
      final r = await store.create(Entities.clients, {'fullName': 'Synced', 'mobileNumber': '+923001234567'});
      adapter.handlers['POST /sync/push'] = (o, body) {
        final m = ((body as Map)['mutations'] as List).single as Map;
        return {
          'results': [
            {'mutationId': m['mutationId'], 'uuid': m['uuid'], 'status': 'applied', 'serverId': 'srv1', 'version': 1, 'record': {'_id': 'srv1', 'uuid': m['uuid'], 'version': 1, 'fullName': 'Synced', 'matchCount': 2}},
          ],
        };
      };
      adapter.handlers['GET /sync/pull'] = (o, _) => {
            'changes': {
              'properties': [
                {'_id': 'p1', 'uuid': 'pu1', 'version': 3, 'propertyId': 'RE-000001', 'askingPrice': 15500000, 'updatedAt': '2026-10-12T10:00:00.000Z'},
              ],
            },
            'cursor': 'c1',
            'hasMore': false,
          };
      await engine.syncNow();
      final local = await db.get(Entities.clients, r.uuid);
      expect(local!.serverId, 'srv1');
      expect(local.version, 1);
      expect(local.syncStatus, SyncStatus.synced);
      expect(local.data['matchCount'], 2);
      expect(await db.get(Entities.properties, 'p1'), isNotNull);
      expect(await db.getValue('sync.cursor'), 'c1');
      expect(engine.state.pending, 0);
    });

    test('a conflict is kept for the user to resolve, and Keep mine re-sends with force', () async {
      await db.put(LocalRecord(entity: Entities.properties, uuid: 'pu1', serverId: 'p1', version: 1, data: {'_id': 'p1', 'askingPrice': 16000000}));
      await store.update(Entities.properties, 'p1', {'askingPrice': 15000000});
      final sent = <Map>[];
      adapter.handlers['GET /sync/pull'] = (o, _) => {'changes': <String, dynamic>{}, 'cursor': 'c', 'hasMore': false};
      adapter.handlers['POST /sync/push'] = (o, body) {
        final m = ((body as Map)['mutations'] as List).single as Map;
        sent.add(m);
        if (m['force'] == true) {
          return {
            'results': [
              {'mutationId': m['mutationId'], 'uuid': 'pu1', 'status': 'applied_with_conflict', 'version': 3, 'record': {'_id': 'p1', 'uuid': 'pu1', 'version': 3, 'askingPrice': 15000000}},
            ],
          };
        }
        return {
          'results': [
            {'mutationId': m['mutationId'], 'uuid': 'pu1', 'status': 'conflict', 'version': 2, 'message': 'modified (askingPrice)', 'record': {'_id': 'p1', 'uuid': 'pu1', 'version': 2, 'askingPrice': 15500000}},
          ],
        };
      };
      await engine.syncNow();
      expect(engine.state.conflicts, 1);
      expect((await db.get(Entities.properties, 'p1'))!.syncStatus, SyncStatus.conflict);
      expect(sent.single['baseVersion'], 1);

      await engine.keepMine(Entities.properties, 'pu1');
      await engine.syncNow();
      expect(sent.last['force'], true);
      expect(sent.last['baseVersion'], 2);
      final after = await db.get(Entities.properties, 'p1');
      expect(after!.data['askingPrice'], 15000000);
      expect(after.version, 3);
      expect(engine.state.conflicts, 0);
    });

    test('rejected mutations become failed items that can be discarded', () async {
      final r = await store.create(Entities.clients, {'fullName': 'X', 'mobileNumber': 'bad'});
      adapter.handlers['GET /sync/pull'] = (o, _) => {'changes': <String, dynamic>{}, 'cursor': 'c', 'hasMore': false};
      adapter.handlers['POST /sync/push'] = (o, body) {
        final m = ((body as Map)['mutations'] as List).single as Map;
        return {
          'results': [
            {'mutationId': m['mutationId'], 'uuid': m['uuid'], 'status': 'rejected', 'code': 'VALIDATION_ERROR', 'message': 'Invalid mobile number'},
          ],
        };
      };
      await engine.syncNow();
      expect(engine.state.failed, 1);
      final failed = (await db.allOutbox()).single;
      expect(failed.lastError, 'Invalid mobile number');
      await engine.discardFailed(failed.id, Entities.clients, r.uuid);
      expect(engine.state.failed, 0);
    });

    test('pulled rows never overwrite local edits that are still waiting to be pushed', () async {
      await db.put(LocalRecord(entity: Entities.clients, uuid: 'cu1', serverId: 'c1', version: 1, data: {'_id': 'c1', 'fullName': 'Old'}));
      await store.update(Entities.clients, 'c1', {'fullName': 'Mine'});
      // The push round trip doesn't resolve the edit (e.g. the response was lost),
      // and the pull then delivers a newer server copy of the same record.
      adapter.handlers['POST /sync/push'] = (o, body) => {'results': <Map<String, dynamic>>[]};
      adapter.handlers['GET /sync/pull'] = (o, _) => {
            'changes': {
              'clients': [
                {'_id': 'c1', 'uuid': 'cu1', 'version': 2, 'fullName': 'Theirs'},
              ],
            },
            'cursor': 'c',
            'hasMore': false,
          };
      await engine.syncNow();
      expect(adapter.calls, contains('GET /sync/pull'));
      expect((await db.get(Entities.clients, 'c1'))!.data['fullName'], 'Mine');
      expect(await db.hasPending(Entities.clients, 'cu1'), isTrue);
    });
  });
}
