import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Loads `assets/i18n/<lang>.json` (the same dictionaries the web CRM uses,
/// plus a `mobile` section). Keys are dotted paths; `{{name}}` placeholders
/// are filled from [params]. Urdu switches the whole app to RTL through the
/// MaterialApp locale.
class AppLocalizations {
  AppLocalizations(this.locale, this._strings, this._fallback);

  final Locale locale;
  final Map<String, dynamic> _strings;
  final Map<String, dynamic> _fallback;

  static const supportedLocales = [Locale('en'), Locale('ur')];

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  static const LocalizationsDelegate<AppLocalizations> delegate = _Delegate();

  bool get isRtl => locale.languageCode == 'ur';

  String t(String key, [Map<String, Object?> params = const {}]) {
    // Same plural convention as i18next on the web: a 'key_one' variant is used when count == 1.
    final one = params['count'] == 1 ? (_lookup(_strings, '${key}_one') ?? _lookup(_fallback, '${key}_one')) : null;
    var value = one ?? _lookup(_strings, key) ?? _lookup(_fallback, key) ?? key;
    params.forEach((k, v) => value = value.replaceAll('{{$k}}', '${v ?? ''}'));
    return value;
  }

  /// Translated label for a shared enum, e.g. enumLabel('propertyType', 'HOUSE').
  String enumLabel(String group, String? value) => value == null ? '—' : t('enums.$group.$value');

  static String? _lookup(Map<String, dynamic> map, String key) {
    dynamic node = map;
    for (final part in key.split('.')) {
      if (node is Map<String, dynamic> && node.containsKey(part)) {
        node = node[part];
      } else {
        return null;
      }
    }
    return node is String ? node : null;
  }

  static final _dictionaries = <String, Map<String, dynamic>>{};

  /// Decoded on the calling isolate (loadString would hop to a background
  /// isolate for files this size) and cached per language.
  static Future<Map<String, dynamic>> _load(String lang) async {
    final cached = _dictionaries[lang];
    if (cached != null) return cached;
    final data = await rootBundle.load('assets/i18n/$lang.json');
    final text = utf8.decode(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
    return _dictionaries[lang] = jsonDecode(text) as Map<String, dynamic>;
  }
}

class _Delegate extends LocalizationsDelegate<AppLocalizations> {
  const _Delegate();

  @override
  bool isSupported(Locale locale) => ['en', 'ur'].contains(locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) async {
    final fallback = await AppLocalizations._load('en');
    final strings = locale.languageCode == 'en' ? fallback : await AppLocalizations._load(locale.languageCode);
    return AppLocalizations(locale, strings, fallback);
  }

  @override
  bool shouldReload(_Delegate old) => false;
}

extension L10nX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
  String t(String key, [Map<String, Object?> params = const {}]) => AppLocalizations.of(this).t(key, params);
}
