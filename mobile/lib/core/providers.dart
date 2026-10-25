import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import 'database/app_database.dart';
import 'network/api_client.dart';
import 'storage/secure_store.dart';
import 'sync/local_store.dart';
import 'sync/sync_engine.dart';

/// Opened in main() before runApp and injected with overrideWithValue.
final databaseProvider = Provider<AppDatabase>((ref) => throw UnimplementedError('databaseProvider must be overridden'));

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(secureStoreProvider)));

final localStoreProvider = Provider<LocalStore>((ref) {
  final store = LocalStore(ref.watch(databaseProvider));
  // Every local write nudges the sync engine (debounced).
  store.onWrite = () => ref.read(syncEngineProvider).schedule();
  return store;
});

final syncEngineProvider = ChangeNotifierProvider<SyncEngine>((ref) => SyncEngine(ref.watch(databaseProvider), ref.watch(apiClientProvider)));

/// Emits whenever local rows of [entity] change (local writes or pulled deltas).
final entityChangesProvider = StreamProvider.family<int, String>((ref, entity) async* {
  var tick = 0;
  yield tick;
  await for (final e in ref.watch(databaseProvider).changes) {
    if (e == entity) yield ++tick;
  }
});

// ── Device preferences ──

class PrefsNotifier extends StateNotifier<({Locale locale, ThemeMode theme})> {
  PrefsNotifier(this._db) : super((locale: const Locale('en'), theme: ThemeMode.system)) {
    _load();
  }

  final AppDatabase _db;

  Future<void> _load() async {
    final lang = await _db.getValue('prefs.lang');
    final theme = await _db.getValue('prefs.theme');
    state = (
      locale: Locale(lang ?? 'en'),
      theme: ThemeMode.values.firstWhere((m) => m.name == theme, orElse: () => ThemeMode.system),
    );
  }

  Future<void> setLanguage(String lang) async {
    state = (locale: Locale(lang), theme: state.theme);
    await _db.setValue('prefs.lang', lang);
  }

  Future<void> setTheme(ThemeMode mode) async {
    state = (locale: state.locale, theme: mode);
    await _db.setValue('prefs.theme', mode.name);
  }
}

final prefsProvider = StateNotifierProvider<PrefsNotifier, ({Locale locale, ThemeMode theme})>((ref) => PrefsNotifier(ref.watch(databaseProvider)));
