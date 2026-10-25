import 'dart:async';
import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Sync status of a local row (mirrors shared/src/enums.ts SYNC_STATUSES).
enum SyncStatus { pending, syncing, synced, failed, conflict }

/// Entities stored offline. Names match the server's sync feed keys.
class Entities {
  static const clients = 'clients';
  static const owners = 'owners';
  static const properties = 'properties';
  static const followUps = 'followUps';
  static const notes = 'notes';
  static const categories = 'clientCategories';
  static const all = [categories, clients, owners, properties, followUps, notes];
}

/// A locally stored record. `data` is the record as the API returns it
/// (plus local edits); the other columns are sync bookkeeping.
class LocalRecord {
  LocalRecord({
    required this.entity,
    required this.uuid,
    required this.data,
    this.serverId,
    this.version = 0,
    this.syncStatus = SyncStatus.synced,
    this.syncError,
    this.deleted = false,
  });

  final String entity;
  final String uuid;
  final Map<String, dynamic> data;
  final String? serverId;
  final int version;
  final SyncStatus syncStatus;
  final String? syncError;
  final bool deleted;

  /// The id other records use to reference this one: server id once synced, device uuid before.
  String get refId => serverId ?? uuid;

  factory LocalRecord.fromRow(Map<String, Object?> r) => LocalRecord(
        entity: r['entity']! as String,
        uuid: r['uuid']! as String,
        serverId: r['server_id'] as String?,
        version: (r['version'] as int?) ?? 0,
        data: jsonDecode(r['data']! as String) as Map<String, dynamic>,
        syncStatus: SyncStatus.values.byName(r['sync_status']! as String),
        syncError: r['sync_error'] as String?,
        deleted: (r['deleted'] as int? ?? 0) == 1,
      );
}

class OutboxEntry {
  OutboxEntry({
    required this.id,
    required this.mutationId,
    required this.entity,
    required this.uuid,
    required this.op,
    required this.data,
    this.baseVersion,
    this.force = false,
    this.attempts = 0,
    this.status = 'pending',
    this.lastError,
  });

  final int id;
  final String mutationId;
  final String entity;
  final String uuid;
  final String op;
  final Map<String, dynamic> data;
  final int? baseVersion;
  final bool force;
  final int attempts;
  final String status;
  final String? lastError;

  factory OutboxEntry.fromRow(Map<String, Object?> r) => OutboxEntry(
        id: r['id']! as int,
        mutationId: r['mutation_id']! as String,
        entity: r['entity']! as String,
        uuid: r['uuid']! as String,
        op: r['op']! as String,
        data: jsonDecode(r['data']! as String) as Map<String, dynamic>,
        baseVersion: r['base_version'] as int?,
        force: (r['force'] as int? ?? 0) == 1,
        attempts: r['attempts'] as int? ?? 0,
        status: r['status']! as String,
        lastError: r['last_error'] as String?,
      );

  Map<String, dynamic> toMutation() => {
        'mutationId': mutationId,
        'entity': entity,
        'op': op,
        'uuid': uuid,
        if (op != 'delete') 'data': data,
        if (baseVersion != null) 'baseVersion': baseVersion,
        if (force) 'force': true,
      };
}

/// SQLite database: the UI's source of truth. Every local write goes into
/// `records` and `outbox` in one transaction; the sync engine drains the
/// outbox and folds server changes back into `records`.
class AppDatabase {
  AppDatabase(this.db);

  final Database db;
  final _changes = StreamController<String>.broadcast();

  /// Emits an entity name whenever its rows change, so screens can re-query.
  Stream<String> get changes => _changes.stream;
  void notify(String entity) => _changes.add(entity);

  static const _version = 1;

  static Future<AppDatabase> open({String? path, DatabaseFactory? factory}) async {
    final f = factory ?? databaseFactory;
    final dbPath = path ?? p.join(await getDatabasesPath(), 'recrm.db');
    final db = await f.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(version: _version, onCreate: _create, onUpgrade: _upgrade),
    );
    return AppDatabase(db);
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      CREATE TABLE records (
        entity TEXT NOT NULL,
        uuid TEXT NOT NULL,
        server_id TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        search TEXT NOT NULL DEFAULT '',
        sort_key TEXT,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        sync_error TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        PRIMARY KEY (entity, uuid)
      )''');
    await db.execute('CREATE INDEX records_server ON records(entity, server_id)');
    await db.execute('CREATE INDEX records_list ON records(entity, deleted, updated_at)');
    await db.execute('''
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_id TEXT NOT NULL UNIQUE,
        entity TEXT NOT NULL,
        uuid TEXT NOT NULL,
        op TEXT NOT NULL,
        data TEXT NOT NULL,
        base_version INTEGER,
        force INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      )''');
    await db.execute('CREATE INDEX outbox_entity ON outbox(entity, uuid)');
    await db.execute('''
      CREATE TABLE conflicts (
        entity TEXT NOT NULL,
        uuid TEXT NOT NULL,
        mine TEXT NOT NULL,
        server TEXT NOT NULL,
        server_version INTEGER NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity, uuid)
      )''');
    await db.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  static Future<void> _upgrade(Database db, int from, int to) async {
    // Future schema migrations go here, one `if (from < n)` block per version.
  }

  // ── Key/value cache (sync cursor, dashboard snapshots, …) ──

  Future<String?> getValue(String key) async {
    final rows = await db.query('kv', where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  Future<void> setValue(String key, String value) =>
      db.insert('kv', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<Map<String, dynamic>?> getJson(String key) async {
    final v = await getValue(key);
    return v == null ? null : jsonDecode(v) as Map<String, dynamic>;
  }

  Future<void> setJson(String key, Map<String, dynamic> value) => setValue(key, jsonEncode(value));

  // ── Records ──

  static String searchText(Map<String, dynamic> d) => [
        d['fullName'], d['mobileNumber'], d['whatsappNumber'], d['email'], d['propertyId'], d['society'], d['area'],
        d['block'], d['plotNumber'], d['preferredSociety'], d['preferredArea'], d['name'], d['content'],
      ].whereType<String>().join(' ').toLowerCase();

  Map<String, Object?> _row(LocalRecord r) => {
        'entity': r.entity,
        'uuid': r.uuid,
        'server_id': r.serverId,
        'version': r.version,
        'data': jsonEncode(r.data),
        'search': searchText(r.data),
        'sort_key': (r.data['fullName'] ?? r.data['propertyId'] ?? r.data['name'] ?? '') as String,
        'sync_status': r.syncStatus.name,
        'sync_error': r.syncError,
        'deleted': r.deleted ? 1 : 0,
        'updated_at': (r.data['updatedAt'] as String?) ?? DateTime.now().toUtc().toIso8601String(),
      };

  Future<void> put(LocalRecord r, {DatabaseExecutor? txn}) async {
    await (txn ?? db).insert('records', _row(r), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<LocalRecord?> get(String entity, String id) async {
    final rows = await db.query('records', where: 'entity = ? AND (uuid = ? OR server_id = ?)', whereArgs: [entity, id, id], limit: 1);
    return rows.isEmpty ? null : LocalRecord.fromRow(rows.first);
  }

  /// Local list query: text search plus arbitrary filters evaluated in Dart
  /// (fine for the thousands of rows a small agency holds), newest first.
  Future<List<LocalRecord>> list(
    String entity, {
    String? search,
    bool Function(Map<String, dynamic> d)? where,
    int Function(LocalRecord a, LocalRecord b)? sort,
    int? limit,
    int offset = 0,
  }) async {
    final args = <Object?>[entity];
    var clause = 'entity = ? AND deleted = 0';
    if (search != null && search.trim().isNotEmpty) {
      for (final token in search.toLowerCase().split(RegExp(r'\s+')).where((t) => t.isNotEmpty)) {
        clause += ' AND search LIKE ?';
        args.add('%${token.replaceAll(RegExp(r'^0'), '')}%');
      }
    }
    final rows = await db.query('records', where: clause, whereArgs: args, orderBy: 'updated_at DESC');
    var items = rows.map(LocalRecord.fromRow).where((r) => where == null || where(r.data)).toList();
    if (sort != null) items.sort(sort);
    if (offset > 0) items = items.skip(offset).toList();
    if (limit != null && items.length > limit) items = items.sublist(0, limit);
    return items;
  }

  Future<int> count(String entity) async =>
      Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM records WHERE entity = ? AND deleted = 0', [entity])) ?? 0;

  // ── Outbox ──

  Future<List<OutboxEntry>> pendingOutbox({int limit = 50}) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rows = await db.query(
      'outbox',
      where: "status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      whereArgs: [now],
      orderBy: 'id ASC',
      limit: limit,
    );
    return rows.map(OutboxEntry.fromRow).toList();
  }

  Future<List<OutboxEntry>> allOutbox() async => (await db.query('outbox', orderBy: 'id ASC')).map(OutboxEntry.fromRow).toList();

  Future<int> outboxCount() async =>
      Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")) ?? 0;

  Future<bool> hasPending(String entity, String uuid) async =>
      (Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM outbox WHERE entity = ? AND uuid = ?', [entity, uuid])) ?? 0) > 0;

  Future<void> clearAll() async {
    await db.transaction((txn) async {
      for (final t in ['records', 'outbox', 'conflicts', 'kv']) {
        await txn.delete(t);
      }
    });
    for (final e in Entities.all) {
      notify(e);
    }
  }

  Future<void> close() async {
    await _changes.close();
    await db.close();
  }
}
