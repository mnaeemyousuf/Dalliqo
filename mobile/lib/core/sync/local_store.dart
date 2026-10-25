import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../database/app_database.dart';

/// Offline-first writes. Each create/update/delete changes the local row and
/// queues an outbox mutation in the same SQLite transaction, so nothing the
/// user saves can be lost even if the app is killed before it syncs.
class LocalStore {
  LocalStore(this.db, {void Function()? onWrite}) : _onWrite = onWrite;

  final AppDatabase db;
  void Function()? _onWrite;
  static const _uuid = Uuid();

  set onWrite(void Function()? fn) => _onWrite = fn;

  Future<LocalRecord> create(String entity, Map<String, dynamic> fields) async {
    final uuid = _uuid.v4();
    final now = DateTime.now().toUtc().toIso8601String();
    final record = LocalRecord(
      entity: entity,
      uuid: uuid,
      data: {...fields, 'uuid': uuid, 'createdAt': now, 'updatedAt': now, 'version': 0},
      syncStatus: SyncStatus.pending,
    );
    await db.db.transaction((txn) async {
      await db.put(record, txn: txn);
      await txn.insert('outbox', {
        'mutation_id': _uuid.v4(),
        'entity': entity,
        'uuid': uuid,
        'op': 'create',
        'data': jsonEncode(fields),
        'created_at': now,
      });
    });
    _changed(entity);
    return record;
  }

  /// Applies [changes] locally and queues them. Successive edits to a record
  /// that hasn't synced yet are coalesced into the waiting mutation.
  Future<LocalRecord> update(String entity, String id, Map<String, dynamic> changes) async {
    final current = await db.get(entity, id);
    if (current == null) throw StateError('$entity $id not found');
    final now = DateTime.now().toUtc().toIso8601String();
    final updated = LocalRecord(
      entity: entity,
      uuid: current.uuid,
      serverId: current.serverId,
      version: current.version,
      data: {...current.data, ...changes, 'updatedAt': now},
      syncStatus: SyncStatus.pending,
    );
    await db.db.transaction((txn) async {
      await db.put(updated, txn: txn);
      final waiting = await txn.query(
        'outbox',
        where: "entity = ? AND uuid = ? AND status = 'pending' AND op IN ('create','update') AND force = 0",
        whereArgs: [entity, current.uuid],
        orderBy: 'id DESC',
        limit: 1,
      );
      if (waiting.isNotEmpty) {
        final row = waiting.first;
        final merged = {...jsonDecode(row['data']! as String) as Map<String, dynamic>, ...changes};
        await txn.update('outbox', {'data': jsonEncode(merged)}, where: 'id = ?', whereArgs: [row['id']]);
      } else {
        await txn.insert('outbox', {
          'mutation_id': _uuid.v4(),
          'entity': entity,
          'uuid': current.uuid,
          'op': 'update',
          'data': jsonEncode(changes),
          'base_version': current.version,
          'created_at': now,
        });
      }
    });
    _changed(entity);
    return updated;
  }

  Future<void> delete(String entity, String id) async {
    final current = await db.get(entity, id);
    if (current == null) return;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.db.transaction((txn) async {
      if (current.serverId == null) {
        // Never reached the server: just forget it.
        await txn.delete('outbox', where: 'entity = ? AND uuid = ?', whereArgs: [entity, current.uuid]);
        await txn.delete('records', where: 'entity = ? AND uuid = ?', whereArgs: [entity, current.uuid]);
        return;
      }
      await txn.update('records', {'deleted': 1, 'sync_status': SyncStatus.pending.name},
          where: 'entity = ? AND uuid = ?', whereArgs: [entity, current.uuid]);
      await txn.delete('outbox', where: "entity = ? AND uuid = ? AND op = 'update' AND status = 'pending'", whereArgs: [entity, current.uuid]);
      await txn.insert('outbox', {
        'mutation_id': _uuid.v4(),
        'entity': entity,
        'uuid': current.uuid,
        'op': 'delete',
        'data': '{}',
        'base_version': current.version,
        'created_at': now,
      });
    });
    _changed(entity);
  }

  void _changed(String entity) {
    db.notify(entity);
    _onWrite?.call();
  }
}
