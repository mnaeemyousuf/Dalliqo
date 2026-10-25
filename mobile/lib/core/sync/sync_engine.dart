import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../config/env.dart';
import '../database/app_database.dart';
import '../network/api_client.dart';

/// What the UI shows in the sync indicator.
@immutable
class SyncState {
  const SyncState({
    this.online = true,
    this.running = false,
    this.pending = 0,
    this.failed = 0,
    this.conflicts = 0,
    this.lastSyncedAt,
    this.lastError,
  });

  final bool online;
  final bool running;
  final int pending;
  final int failed;
  final int conflicts;
  final DateTime? lastSyncedAt;
  final String? lastError;

  int get needsAttention => failed + conflicts;

  SyncState copyWith({bool? online, bool? running, int? pending, int? failed, int? conflicts, DateTime? lastSyncedAt, String? lastError, bool clearError = false}) =>
      SyncState(
        online: online ?? this.online,
        running: running ?? this.running,
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
        conflicts: conflicts ?? this.conflicts,
        lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
        lastError: clearError ? null : (lastError ?? this.lastError),
      );
}

/// Pushes the outbox and pulls server deltas (see docs/architecture/OfflineSync.md).
///
/// Triggers: connectivity regained, app resumed, a periodic timer, any local
/// write, and Socket.IO change notices (debounced).
class SyncEngine extends ChangeNotifier {
  SyncEngine(this.db, this.api, {Connectivity? connectivity}) : _connectivity = connectivity ?? Connectivity();

  final AppDatabase db;
  final ApiClient api;
  final Connectivity _connectivity;

  SyncState _state = const SyncState();
  SyncState get state => _state;

  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _timer;
  Timer? _debounce;
  bool _again = false;
  Future<void>? _inflight;
  int _backoffStep = 0;

  static const _cursorKey = 'sync.cursor';
  static const _lastSyncKey = 'sync.lastAt';

  void _set(SyncState s) {
    _state = s;
    notifyListeners();
  }

  Future<void> start() async {
    final last = await db.getValue(_lastSyncKey);
    _set(_state.copyWith(lastSyncedAt: last == null ? null : DateTime.tryParse(last)));
    await _refreshCounts();
    _connSub = _connectivity.onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      _set(_state.copyWith(online: online));
      if (online) schedule();
    });
    final initial = await _connectivity.checkConnectivity();
    _set(_state.copyWith(online: initial.any((r) => r != ConnectivityResult.none)));
    _timer = Timer.periodic(Env.syncInterval, (_) => schedule());
    unawaited(syncNow());
  }

  /// Completes when no sync cycle is running.
  Future<void> get idle => _inflight ?? Future<void>.value();

  void stop() {
    _connSub?.cancel();
    _timer?.cancel();
    _debounce?.cancel();
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }

  /// Debounced trigger for bursts (typing, many socket notices).
  void schedule([Duration delay = const Duration(seconds: 1)]) {
    _debounce?.cancel();
    _debounce = Timer(delay, () => unawaited(syncNow()));
  }

  /// First sign-in on this device: restores the whole business from the server.
  Future<void> bootstrap() async {
    final d = await api.get<Map<String, dynamic>>('/sync/bootstrap');
    await _applyChanges(d['changes'] as Map<String, dynamic>);
    await db.setValue(_cursorKey, d['cursor'] as String);
    await db.setJson('session.members', {'items': d['members']});
    await db.setJson('session.settings', d['settings'] as Map<String, dynamic>);
    var more = d['hasMore'] == true;
    while (more) {
      more = await _pullOnce();
    }
    await _markSynced();
  }

  /// Runs a sync cycle. Callers arriving mid-cycle get the in-flight future,
  /// which also covers the follow-up cycle their call requested, so awaiting
  /// syncNow() always means "everything queued so far has been attempted".
  Future<void> syncNow() {
    if (_inflight != null) {
      _again = true;
      return _inflight!;
    }
    return _inflight = _cycles().whenComplete(() => _inflight = null);
  }

  Future<void> _cycles() async {
    do {
      _again = false;
      await _syncOnce();
    } while (_again && _state.online);
  }

  Future<void> _syncOnce() async {
    if (!_state.online) return;
    _set(_state.copyWith(running: true, clearError: true));
    try {
      await _push();
      var more = true;
      while (more) {
        more = await _pullOnce();
      }
      await _markSynced();
      _backoffStep = 0;
    } catch (e) {
      final err = ApiClient.toApiException(e);
      _set(_state.copyWith(lastError: err.message, online: err.isNetwork ? false : null));
      // Exponential backoff with jitter: 2 s, 4 s … capped at 5 min.
      _backoffStep = min(_backoffStep + 1, 8);
      final seconds = min(300, pow(2, _backoffStep).toInt()) + Random().nextInt(3);
      schedule(Duration(seconds: seconds));
    } finally {
      await _refreshCounts();
      _set(_state.copyWith(running: false));
    }
  }

  Future<void> _markSynced() async {
    final now = DateTime.now();
    await db.setValue(_lastSyncKey, now.toUtc().toIso8601String());
    _set(_state.copyWith(lastSyncedAt: now));
  }

  Future<void> _push() async {
    while (true) {
      final batch = await db.pendingOutbox();
      if (batch.isEmpty) return;
      final res = await api.post<Map<String, dynamic>>('/sync/push', {'mutations': batch.map((m) => m.toMutation()).toList()});
      final results = (res['results'] as List).cast<Map<String, dynamic>>();
      final byId = {for (final r in results) r['mutationId'] as String: r};
      final touched = <String>{};
      for (final m in batch) {
        final r = byId[m.mutationId];
        if (r == null) continue;
        touched.add(m.entity);
        await _applyResult(m, r);
      }
      for (final e in touched) {
        db.notify(e);
      }
      if (batch.length < 50) return;
    }
  }

  Future<void> _applyResult(OutboxEntry m, Map<String, dynamic> r) async {
    final status = r['status'] as String;
    final record = r['record'] as Map<String, dynamic>?;
    await db.db.transaction((txn) async {
      switch (status) {
        case 'applied':
        case 'applied_with_conflict':
          await txn.delete('outbox', where: 'id = ?', whereArgs: [m.id]);
          final stillPending = (await txn.query('outbox', where: 'entity = ? AND uuid = ?', whereArgs: [m.entity, m.uuid])).isNotEmpty;
          if (record != null) {
            await db.put(
              LocalRecord(
                entity: m.entity,
                uuid: m.uuid,
                serverId: record['_id'] as String?,
                version: (record['version'] as num?)?.toInt() ?? 0,
                data: record,
                deleted: record['deletedAt'] != null,
                syncStatus: stillPending ? SyncStatus.pending : SyncStatus.synced,
              ),
              txn: txn,
            );
            // Later queued edits must be based on the version the server now has.
            await txn.update('outbox', {'base_version': (record['version'] as num?)?.toInt()},
                where: "entity = ? AND uuid = ? AND op != 'create'", whereArgs: [m.entity, m.uuid]);
          }
        case 'conflict':
          await txn.delete('outbox', where: 'id = ?', whereArgs: [m.id]);
          final local = await txn.query('records', where: 'entity = ? AND uuid = ?', whereArgs: [m.entity, m.uuid]);
          await txn.insert(
            'conflicts',
            {
              'entity': m.entity,
              'uuid': m.uuid,
              'mine': jsonEncode(m.data),
              'server': jsonEncode(record ?? {}),
              'server_version': (r['version'] as num?)?.toInt() ?? 0,
              'message': r['message'] as String?,
              'created_at': DateTime.now().toUtc().toIso8601String(),
            },
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
          if (local.isNotEmpty) {
            await txn.update('records', {'sync_status': SyncStatus.conflict.name}, where: 'entity = ? AND uuid = ?', whereArgs: [m.entity, m.uuid]);
          }
        default: // rejected: needs the user (validation, permission, missing parent)
          await txn.update('outbox', {'status': 'failed', 'last_error': r['message'] as String?, 'attempts': m.attempts + 1}, where: 'id = ?', whereArgs: [m.id]);
          await txn.update('records', {'sync_status': SyncStatus.failed.name, 'sync_error': r['message'] as String?},
              where: 'entity = ? AND uuid = ?', whereArgs: [m.entity, m.uuid]);
      }
    });
  }

  /// One page of the delta feed. Returns true while more pages remain.
  Future<bool> _pullOnce() async {
    final cursor = await db.getValue(_cursorKey);
    final d = await api.get<Map<String, dynamic>>('/sync/pull', query: {'cursor': cursor, 'limit': 500});
    await _applyChanges(d['changes'] as Map<String, dynamic>);
    await db.setValue(_cursorKey, d['cursor'] as String);
    return d['hasMore'] == true;
  }

  Future<void> _applyChanges(Map<String, dynamic> changes) async {
    for (final entry in changes.entries) {
      final rows = (entry.value as List).cast<Map<String, dynamic>>();
      if (rows.isEmpty) continue;
      await db.db.transaction((txn) async {
        for (final row in rows) {
          final uuid = row['uuid'] as String? ?? row['_id'] as String;
          // Local edits waiting to be pushed win until their push result arrives.
          final pending = await txn.query('outbox', where: 'entity = ? AND uuid = ?', whereArgs: [entry.key, uuid], limit: 1);
          if (pending.isNotEmpty) continue;
          await db.put(
            LocalRecord(
              entity: entry.key,
              uuid: uuid,
              serverId: row['_id'] as String?,
              version: (row['version'] as num?)?.toInt() ?? 0,
              data: row,
              deleted: row['deletedAt'] != null,
            ),
            txn: txn,
          );
        }
      });
      db.notify(entry.key);
    }
  }

  Future<void> _refreshCounts() async {
    final pending = await db.outboxCount();
    final failed = Sqflite.firstIntValue(await db.db.rawQuery("SELECT COUNT(*) FROM outbox WHERE status = 'failed'")) ?? 0;
    final conflicts = Sqflite.firstIntValue(await db.db.rawQuery('SELECT COUNT(*) FROM conflicts')) ?? 0;
    _set(_state.copyWith(pending: pending, failed: failed, conflicts: conflicts));
  }

  // ── Resolving problems from the sync centre ──

  Future<List<Map<String, Object?>>> conflicts() => db.db.query('conflicts', orderBy: 'created_at DESC');

  /// "Keep mine": re-send my change as an explicit, audited overwrite of the server version.
  Future<void> keepMine(String entity, String uuid) async {
    final rows = await db.db.query('conflicts', where: 'entity = ? AND uuid = ?', whereArgs: [entity, uuid]);
    if (rows.isEmpty) return;
    final c = rows.first;
    await db.db.transaction((txn) async {
      await txn.insert('outbox', {
        'mutation_id': const Uuid().v4(),
        'entity': entity,
        'uuid': uuid,
        'op': 'update',
        'data': c['mine'],
        'base_version': c['server_version'],
        'force': 1,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      });
      await txn.delete('conflicts', where: 'entity = ? AND uuid = ?', whereArgs: [entity, uuid]);
    });
    await _refreshCounts();
    unawaited(syncNow());
  }

  /// "Keep latest": drop my change and take the server's record.
  Future<void> keepLatest(String entity, String uuid) async {
    final rows = await db.db.query('conflicts', where: 'entity = ? AND uuid = ?', whereArgs: [entity, uuid]);
    if (rows.isEmpty) return;
    final server = jsonDecode(rows.first['server']! as String) as Map<String, dynamic>;
    await db.db.transaction((txn) async {
      if (server.isNotEmpty) {
        await db.put(
          LocalRecord(
            entity: entity,
            uuid: uuid,
            serverId: server['_id'] as String?,
            version: (server['version'] as num?)?.toInt() ?? 0,
            data: server,
            deleted: server['deletedAt'] != null,
          ),
          txn: txn,
        );
      }
      await txn.delete('conflicts', where: 'entity = ? AND uuid = ?', whereArgs: [entity, uuid]);
    });
    db.notify(entity);
    await _refreshCounts();
  }

  /// Drops a rejected change (the server refused it, e.g. invalid data).
  Future<void> discardFailed(int outboxId, String entity, String uuid) async {
    await db.db.delete('outbox', where: 'id = ?', whereArgs: [outboxId]);
    await db.db.update('records', {'sync_status': SyncStatus.synced.name, 'sync_error': null}, where: 'entity = ? AND uuid = ?', whereArgs: [entity, uuid]);
    db.notify(entity);
    await _refreshCounts();
    unawaited(syncNow());
  }

  /// Puts a rejected change back in the queue (after the user fixed the cause).
  Future<void> retryFailed(int outboxId) async {
    await db.db.update('outbox', {'status': 'pending', 'last_error': null}, where: 'id = ?', whereArgs: [outboxId]);
    await _refreshCounts();
    unawaited(syncNow());
  }
}
