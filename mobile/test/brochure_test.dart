import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/network/api_client.dart';
import 'package:real_estate_crm/core/storage/secure_store.dart';
import 'package:real_estate_crm/data/repositories.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Records brochure requests and answers like the API.
class _Adapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    requests.add(o);
    if (o.queryParameters['format'] == 'text') {
      return ResponseBody.fromString(jsonEncode({'success': true, 'data': {'text': 'Plot for sale', 'whatsappUrl': 'https://wa.me/?text=Plot'}}), 200, headers: {
        Headers.contentTypeHeader: ['application/json'],
      });
    }
    return ResponseBody.fromBytes(utf8.encode('%PNG-fake'), 200, headers: {
      Headers.contentTypeHeader: ['image/png'],
      'content-disposition': ['inline; filename="RE-000001-brochure-ur.png"'],
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
  TestWidgetsFlutterBinding.ensureInitialized();
  late AppDatabase db;
  late _Adapter adapter;
  late OnlineRepository online;
  late Directory tmp;

  setUpAll(sqfliteFfiInit);
  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('brochure');
    // path_provider's temporary directory → a real temp folder in tests.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('plugins.flutter.io/path_provider'), (call) async => tmp.path);
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    adapter = _Adapter();
    online = OnlineRepository(ApiClient(_Store(), dio: Dio(BaseOptions(baseUrl: 'http://test/api'))..httpClientAdapter = adapter), db);
  });
  tearDown(() async {
    await db.close();
    await tmp.delete(recursive: true);
  });

  test('image brochure: options go to the server and the file is saved for sharing', () async {
    final file = await online.brochure('p1', format: 'png', lang: 'ur', hidePrice: true, agentId: 'u-son');
    final q = adapter.requests.single;
    expect(q.path, '/properties/p1/brochure');
    expect(q.queryParameters, {'format': 'png', 'lang': 'ur', 'hidePrice': 'true', 'agentId': 'u-son'});
    expect(file.path, endsWith('RE-000001-brochure-ur.png'));
    expect(await file.readAsString(), '%PNG-fake');
  });

  test('share text: no agent sent when it is the user themselves; returns the WhatsApp link', () async {
    final r = await online.brochureText('p1', lang: 'en');
    expect(adapter.requests.single.queryParameters, {'format': 'text', 'lang': 'en', 'hidePrice': 'false'});
    expect(r['whatsappUrl'], startsWith('https://wa.me/'));
  });
}
