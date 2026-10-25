import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

enum AuthStatus { unknown, signedOut, restoring, signedIn, locked }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.business,
    this.membership,
  });

  final AuthStatus status;
  final Map<String, dynamic>? user;
  final Map<String, dynamic>? business;
  final Map<String, dynamic>? membership;

  String? get userId => user?['_id'] as String?;
  bool get mustChangePassword => user?['mustChangePassword'] == true;
  List<String> get permissions => ((membership?['permissions'] as List?) ?? const []).cast<String>();
  bool can(String permission) => permissions.contains(permission);
  bool get isOwner => membership?['role'] == 'OWNER';

  AuthState copyWith({AuthStatus? status, Map<String, dynamic>? user, Map<String, dynamic>? business, Map<String, dynamic>? membership}) => AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        business: business ?? this.business,
        membership: membership ?? this.membership,
      );
}

/// Owns the signed-in session on this device.
///
/// New phone after loss/theft: install → sign in → [_restore] downloads the
/// whole business through /sync/bootstrap. Nothing lives only on the phone.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this.ref) : super(const AuthState()) {
    ref.read(apiClientProvider).onSessionLost = () => unawaited(signOut(callServer: false));
  }

  final Ref ref;

  ApiClient get _api => ref.read(apiClientProvider);

  /// App start: resume an existing session if the keystore still has tokens.
  Future<void> init() async {
    final store = ref.read(secureStoreProvider);
    if (await store.refreshToken == null) {
      state = const AuthState(status: AuthStatus.signedOut);
      return;
    }
    final cached = await ref.read(databaseProvider).getJson('session.me');
    if (cached != null) _setSession(cached);
    try {
      final me = await _api.get<Map<String, dynamic>>('/auth/me');
      await ref.read(databaseProvider).setJson('session.me', me);
      _setSession(me);
    } on ApiException catch (e) {
      if (!e.isNetwork) {
        await signOut(callServer: false);
        return;
      }
      // Offline start: keep working from the cached session and local data.
      if (cached == null) {
        state = const AuthState(status: AuthStatus.signedOut);
        return;
      }
    }
    state = state.copyWith(status: await store.hasPin ? AuthStatus.locked : AuthStatus.signedIn);
    unawaited(ref.read(syncEngineProvider).start());
  }

  void _setSession(Map<String, dynamic> d) {
    state = state.copyWith(
      user: Map<String, dynamic>.from(d['user'] as Map),
      business: Map<String, dynamic>.from(d['business'] as Map),
      membership: Map<String, dynamic>.from(d['membership'] as Map),
    );
  }

  Future<void> signIn(String email, String password) => _authenticate('/auth/login', {'email': email, 'password': password, 'deviceName': 'Mobile app'});

  Future<void> register(Map<String, dynamic> body) => _authenticate('/auth/register', {...body, 'deviceName': 'Mobile app'});

  Future<void> _authenticate(String path, Map<String, dynamic> body) async {
    final d = await _api.post<Map<String, dynamic>>(path, body);
    await ref.read(secureStoreProvider).saveTokens(access: d['accessToken'] as String, refresh: d['refreshToken'] as String);
    final session = {'user': d['user'], 'business': d['business'], 'membership': d['membership']};
    await ref.read(databaseProvider).setJson('session.me', session);
    _setSession(session);
    final lang = (d['user'] as Map)['preferences']?['language'] as String?;
    if (lang != null) await ref.read(prefsProvider.notifier).setLanguage(lang);
    if (state.mustChangePassword) {
      state = state.copyWith(status: AuthStatus.signedIn);
      return;
    }
    await _restore();
  }

  Future<void> _restore() async {
    state = state.copyWith(status: AuthStatus.restoring);
    try {
      await ref.read(syncEngineProvider).bootstrap();
    } finally {
      state = state.copyWith(status: AuthStatus.signedIn);
      unawaited(ref.read(syncEngineProvider).start());
    }
  }

  Future<void> changePassword(String current, String next) async {
    await _api.post('/auth/change-password', {'currentPassword': current, 'newPassword': next});
    final me = await _api.get<Map<String, dynamic>>('/auth/me');
    await ref.read(databaseProvider).setJson('session.me', me);
    _setSession(me);
    await _restore();
  }

  Future<void> forgotPassword(String email) => _api.post('/auth/forgot-password', {'email': email});

  Future<void> resetPassword(String token, String newPassword) => _api.post('/auth/reset-password', {'token': token, 'newPassword': newPassword});

  Future<void> updateProfile(Map<String, dynamic> body) async {
    final user = await _api.patch<Map<String, dynamic>>('/auth/me', body);
    state = state.copyWith(user: user);
  }

  void lock() {
    if (state.status == AuthStatus.signedIn) state = state.copyWith(status: AuthStatus.locked);
  }

  void unlock() => state = state.copyWith(status: AuthStatus.signedIn);

  /// Signing out wipes local data and tokens from this phone. Unsynced
  /// changes are lost, so the UI warns first when the outbox isn't empty.
  Future<void> signOut({bool callServer = true}) async {
    if (state.status == AuthStatus.signedOut) return;
    final store = ref.read(secureStoreProvider);
    if (callServer) {
      try {
        await _api.post('/auth/logout', {'refreshToken': await store.refreshToken});
      } catch (_) {
        // Offline: the server session expires on its own.
      }
    }
    ref.read(syncEngineProvider).stop();
    await store.clearTokens();
    await store.clearPin();
    await ref.read(databaseProvider).clearAll();
    state = const AuthState(status: AuthStatus.signedOut);
  }
}

final authProvider = StateNotifierProvider<AuthController, AuthState>((ref) => AuthController(ref));
