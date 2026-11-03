import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/network/api_client.dart';
import 'package:real_estate_crm/core/storage/secure_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Answers like the API and records what the phone asked for.
class _Adapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final responses = <String, Object>{};

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    requests.add(o);
    final body = responses['${o.method} ${o.path}'] ?? <String, dynamic>{};
    return ResponseBody.fromString(jsonEncode({'success': true, 'data': body, 'meta': {'page': 1, 'limit': 30, 'total': 1, 'totalPages': 1}}), 200, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });
  }

  @override
  void close({bool force = false}) {}
}

class _Store extends SecureStore {
  @override
  Future<String?> get accessToken async => 'token';
}

void main() {
  late AppDatabase db;
  late _Adapter adapter;
  late OnlineRepository online;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    adapter = _Adapter();
    online = OnlineRepository(ApiClient(_Store(), dio: Dio(BaseOptions(baseUrl: 'http://test/api'))..httpClientAdapter = adapter), db);
  });
  tearDown(() => db.close());

  test('permission editor uses the same groups as the web (from the API catalogue)', () async {
    adapter.responses['GET /meta/permissions'] = {
      'groups': {'finance': ['finance:read', 'finance:create'], 'agreements': ['agreements:read']},
      'permissionTemplates': {'VIEWER': ['finance:read']},
    };
    final groups = await online.permissionGroups();
    expect(groups.keys, ['finance', 'agreements']);
    expect(groups['finance'], ['finance:read', 'finance:create']);
    expect((await online.permissionTemplates())['VIEWER'], ['finance:read']);
  });

  test('audit log pages and library filters are sent to the API; categories include archived', () async {
    adapter.responses['GET /audit-logs'] = [
      {'action': 'deal.created'},
    ];
    adapter.responses['GET /documents'] = [
      {'fileName': 'receipt.jpg'},
    ];
    adapter.responses['GET /transaction-categories'] = [
      {'name': 'Office rent', 'type': 'EXPENSE'},
    ];
    final audit = await online.auditLogs(page: 3);
    expect(audit.items.single['action'], 'deal.created');
    expect(adapter.requests.last.queryParameters, {'page': 3, 'limit': 30});
    expect((await online.documentLibrary(entityType: 'transaction')).single['fileName'], 'receipt.jpg');
    expect(adapter.requests.last.queryParameters, {'limit': 100, 'entityType': 'transaction'});
    expect((await online.financeCategories()).single['name'], 'Office rent');
    expect(adapter.requests.last.queryParameters, {'includeArchived': 'true'});
    await online.analytics('12m');
    expect([adapter.requests.last.path, adapter.requests.last.queryParameters], ['/dashboard/analytics', {'range': '12m'}]);
  });
}
