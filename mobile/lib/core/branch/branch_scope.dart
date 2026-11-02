import 'dart:async';

import 'package:flutter/foundation.dart';

import '../database/app_database.dart';
import '../models/models.dart';

/// Which branch the app is looking at (multi-branch businesses).
///
/// The server already limits what a member can see (only their branches are synced to the phone);
/// this is the branch switcher on top of that: null = all branches the member can see. The choice
/// filters local lists, is the default branch for records created offline, and goes to the API as
/// the X-Branch-Id header for online screens (dashboard, matches, reports).
class BranchScope extends ChangeNotifier {
  BranchScope(this.db) {
    _sub = db.changes.where((e) => e == Entities.branches).listen((_) => unawaited(load()));
  }

  final AppDatabase db;
  late final StreamSubscription<String> _sub;

  static const kvKey = 'session.branch';

  List<Branch> _branches = const [];
  bool _disposed = false;
  String? _selected;

  /// Live (not archived) branches this member can see.
  List<Branch> get branches => _branches;
  String? get selected => _selected;
  Branch? get selectedBranch => _branches.where((b) => b.id == _selected || b.serverId == _selected).firstOrNull;

  /// The business's main branch (records created before branches existed belong to it).
  String? get defaultId => (_branches.where((b) => b.isDefault).firstOrNull ?? _branches.firstOrNull)?.serverId;

  /// Only worth showing a switcher / branch field when there is a choice.
  bool get hasChoice => _branches.length > 1;

  Future<void> load() async {
    final rows = await db.list(Entities.branches, where: (d) => d['archivedAt'] == null);
    _branches = rows.map((r) => Branch(r.data, local: r)).toList()..sort((a, b) => a.isDefault == b.isDefault ? a.name.compareTo(b.name) : (a.isDefault ? -1 : 1));
    final saved = await db.getValue(kvKey);
    _selected = saved != null && saved.isNotEmpty && _branches.any((b) => b.serverId == saved) ? saved : null;
    if (!_disposed) notifyListeners();
  }

  Future<void> select(String? branchId) async {
    _selected = branchId;
    await db.setValue(kvKey, branchId ?? '');
    notifyListeners();
    // Every list re-queries with the new filter (the branch list itself did not change).
    for (final e in Entities.all.where((e) => e != Entities.branches)) {
      db.notify(e);
    }
  }

  /// Whether a local record belongs to the selected branch (all records when none is selected).
  bool contains(Map<String, dynamic> d) => matches(d, selected: _selected, defaultId: defaultId);

  /// Pure rule (tested): a record without branchId belongs to the default branch.
  static bool matches(Map<String, dynamic> d, {required String? selected, required String? defaultId}) {
    if (selected == null) return true;
    final branch = JsonModel.refId(d['branchId']) ?? defaultId;
    return branch == selected;
  }

  /// Branch for a record created on this phone: the selected branch, else the only branch, else the main branch.
  String? branchForNewRecord() => _selected ?? (_branches.length == 1 ? _branches.first.serverId : defaultId);

  Future<void> clear() async {
    _selected = null;
    _branches = const [];
    await db.setValue(kvKey, '');
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _sub.cancel();
    super.dispose();
  }
}
