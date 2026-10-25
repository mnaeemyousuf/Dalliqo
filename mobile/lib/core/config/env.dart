/// Build-time configuration, passed with --dart-define:
///
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
///
/// 10.0.2.2 is the host machine from the Android emulator; use your LAN IP
/// (e.g. http://192.168.1.20:4000) for a physical phone.
class Env {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');

  static String get api => '$apiBaseUrl/api';

  /// Lock the app after it has been in the background this long (when a PIN is set).
  static const lockAfter = Duration(minutes: 2);

  static const syncInterval = Duration(minutes: 5);
}
