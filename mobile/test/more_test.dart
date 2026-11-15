import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/l10n/app_localizations.dart';
import 'package:real_estate_crm/features/more/online_kit.dart';

Widget _wrap(Widget child, {Locale locale = const Locale('en')}) => ProviderScope(
      child: MaterialApp(
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, ...GlobalMaterialLocalizations.delegates],
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    );

void main() {
  testWidgets('form sheet returns typed values, parses numbers and enforces required fields', (tester) async {
    Json? result;
    var opened = 0;
    await tester.pumpWidget(_wrap(Builder(
      builder: (c) => TextButton(
        onPressed: () async {
          opened++;
          result = await showFormSheet(c, title: 'Adjust', fields: const [
            FormFieldSpec('amount', 'Amount', kind: FieldKind.number, required: true),
            FormFieldSpec('reason', 'Reason'),
            FormFieldSpec('relist', 'Relist', kind: FieldKind.toggle, initial: true),
            FormFieldSpec('kind', 'Kind', kind: FieldKind.select, options: {'A': 'Alpha', 'B': 'Beta'}, initial: 'B'),
          ]);
        },
        child: const Text('open'),
      ),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Required number missing → stays open with a message.
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Amount: required'), findsOneWidget);
    expect(result, isNull);

    // Not a number → message, still open.
    await tester.enterText(find.byType(TextField).first, 'abc');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Amount: enter a number'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '-50,000');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(opened, 1);
    expect(result, {'amount': -50000, 'relist': true, 'kind': 'B'}); // empty text is left out
  });

  testWidgets('stat cards and bar lists render their rows', (tester) async {
    await tester.pumpWidget(_wrap(Column(children: [
      const StatCard(title: 'Commission', rows: [('Expected', 'PKR 2 Lakh'), ('Received', 'PKR 50,000')]),
      BarList(rows: const [('Hot', 4), ('Cold', 0)], format: (v) => '$v leads'),
    ])));
    await tester.pumpAndSettle();
    expect(find.text('Commission'), findsOneWidget);
    expect(find.text('PKR 50,000'), findsOneWidget);
    expect(find.text('4 leads'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNWidgets(2));
  });

  test('value helpers read server JSON defensively', () {
    expect(numOf('12.5'), 12.5);
    expect(numOf(null), 0);
    expect(refName({'_id': 'u1', 'fullName': 'Ahmed'}), 'Ahmed');
    expect(refName('u1'), '');
    expect(refId({'_id': 'u1'}), 'u1');
    expect(listOf(null), isEmpty);
    expect(mapOf(null), isEmpty);
    expect(dateOf('not a date'), isNull);
  });

  test('every text key used by the new screens exists in English and Urdu', () {
    dynamic read(String lang) => jsonDecode(File('assets/i18n/$lang.json').readAsStringSync());
    bool has(dynamic j, String key) {
      dynamic node = j;
      for (final part in key.split('.')) {
        if (node is! Map || !node.containsKey(part)) return false;
        node = node[part];
      }
      return true;
    }

    final en = read('en'), ur = read('ur');
    final keys = <String>{};
    for (final f in Directory('lib/features/more').listSync().whereType<File>()) {
      final s = f.readAsStringSync();
      for (final m in RegExp(r"'(mm\.[A-Za-z0-9_.]*[A-Za-z0-9_])'").allMatches(s)) {
        keys.add(m.group(1)!);
      }
    }
    expect(keys.length, greaterThan(40));
    final missing = [for (final k in keys) if (!has(en, k) || !has(ur, k)) k];
    expect(missing, isEmpty);
    // Dynamic groups: every key has both languages.
    for (final g in const ['auto', 'score', 'portal', 'qc', 'period', 'la', 'np', 'r', 'mk', 'ad', 'pt', 'dt', 'lt', 'tt']) {
      final a = (en['mm'][g] as Map).keys.toSet(), b = (ur['mm'][g] as Map).keys.toSet();
      expect(a.difference(b), isEmpty, reason: 'mm.$g');
    }
  });
}
