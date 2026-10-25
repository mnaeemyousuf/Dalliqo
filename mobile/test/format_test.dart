import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/utils/format.dart';

void main() {
  group('formatPkr', () {
    test('uses crore / lakh', () {
      expect(formatPkr(15500000), 'PKR 1.55 Crore');
      expect(formatPkr(550000), 'PKR 5.5 Lakh');
      expect(formatPkr(75000), 'PKR 75,000');
      expect(formatPkr(null), '—');
      expect(formatPkr(20000000, urdu: true), 'روپے 2 کروڑ');
    });

    test('compacts ranges that share a unit', () {
      expect(formatRange(12000000, 16000000), 'PKR 1.2 – 1.6 Crore');
      expect(formatRange(5000000, 16000000), 'PKR 50 Lakh – PKR 1.6 Crore');
      expect(formatRange(null, 16000000), '≤ PKR 1.6 Crore');
      expect(formatRange(null, null), '—');
    });
  });

  group('normalizePhone (same rules as the API)', () {
    final cases = {
      '03001234567': '+923001234567',
      '0300-1234567': '+923001234567',
      '3001234567': '+923001234567',
      '00923001234567': '+923001234567',
      '+92 300 1234567': '+923001234567',
      '021-34567890': '+922134567890',
      '+447911123456': '+447911123456',
    };
    cases.forEach((input, expected) => test('$input → $expected', () => expect(normalizePhone(input), expected)));
    for (final bad in ['', '12', 'abc', '0300123']) {
      test('rejects "$bad"', () => expect(normalizePhone(bad), isNull));
    }
  });

  test('English and Urdu dictionaries have the same keys and placeholders', () {
    List<String> keys(Map<String, dynamic> m, [String p = '']) => m.entries
        .expand((e) => e.value is Map<String, dynamic> ? keys(e.value as Map<String, dynamic>, '$p${e.key}.') : ['$p${e.key}'])
        .toList();
    String at(Map<String, dynamic> m, String k) => k.split('.').fold<dynamic>(m, (a, p) => (a as Map)[p]) as String;
    final en = jsonDecode(File('assets/i18n/en.json').readAsStringSync()) as Map<String, dynamic>;
    final ur = jsonDecode(File('assets/i18n/ur.json').readAsStringSync()) as Map<String, dynamic>;
    expect(keys(ur)..sort(), keys(en)..sort());
    final placeholder = RegExp(r'{{\w+}}');
    for (final k in keys(en)) {
      final a = placeholder.allMatches(at(en, k)).map((m) => m[0]).toList()..sort();
      final b = placeholder.allMatches(at(ur, k)).map((m) => m[0]).toList()..sort();
      expect(b, a, reason: k);
    }
  });
}
