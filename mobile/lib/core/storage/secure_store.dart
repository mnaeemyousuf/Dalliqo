import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens and the app-lock PIN live in the OS keystore (Android Keystore /
/// iOS Keychain), never in SQLite or shared preferences.
class SecureStore {
  SecureStore([FlutterSecureStorage? storage])
      : _s = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _s;

  static const _access = 'access_token';
  static const _refresh = 'refresh_token';
  static const _pinHash = 'pin_hash';
  static const _pinSalt = 'pin_salt';
  static const _biometric = 'biometric_enabled';
  static const _failed = 'pin_failed';

  Future<String?> get accessToken => _s.read(key: _access);
  Future<String?> get refreshToken => _s.read(key: _refresh);

  Future<void> saveTokens({required String access, required String refresh}) async {
    await _s.write(key: _access, value: access);
    await _s.write(key: _refresh, value: refresh);
  }

  Future<void> saveAccessToken(String access) => _s.write(key: _access, value: access);

  Future<void> clearTokens() async {
    await _s.delete(key: _access);
    await _s.delete(key: _refresh);
  }

  // ── App lock ──

  Future<bool> get hasPin async => (await _s.read(key: _pinHash)) != null;

  Future<void> setPin(String pin) async {
    final salt = base64Url.encode(List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    await _s.write(key: _pinSalt, value: salt);
    await _s.write(key: _pinHash, value: _hash(pin, salt));
    await _s.write(key: _failed, value: '0');
  }

  /// Returns remaining attempts after a wrong PIN, or null when correct.
  Future<int?> verifyPin(String pin, {int maxAttempts = 5}) async {
    final salt = await _s.read(key: _pinSalt);
    final hash = await _s.read(key: _pinHash);
    if (salt == null || hash == null) return null;
    if (_hash(pin, salt) == hash) {
      await _s.write(key: _failed, value: '0');
      return null;
    }
    final failed = int.parse(await _s.read(key: _failed) ?? '0') + 1;
    await _s.write(key: _failed, value: '$failed');
    return maxAttempts - failed;
  }

  Future<void> clearPin() async {
    await _s.delete(key: _pinHash);
    await _s.delete(key: _pinSalt);
    await _s.delete(key: _biometric);
  }

  Future<bool> get biometricEnabled async => (await _s.read(key: _biometric)) == 'true';
  Future<void> setBiometric(bool on) => _s.write(key: _biometric, value: '$on');

  /// Iterated, salted SHA-256: the PIN is short, so slow down offline guessing.
  static String _hash(String pin, String salt) {
    List<int> digest = utf8.encode('$salt:$pin');
    for (var i = 0; i < 10000; i++) {
      digest = sha256.convert(digest).bytes;
    }
    return base64Url.encode(digest);
  }

  Future<void> wipe() => _s.deleteAll();
}
