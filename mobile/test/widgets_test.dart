import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/l10n/app_localizations.dart';
import 'package:real_estate_crm/core/models/models.dart';
import 'package:real_estate_crm/core/widgets/app_widgets.dart';
import 'package:real_estate_crm/core/widgets/domain_widgets.dart';

Widget _wrap(Widget child, {Locale locale = const Locale('en')}) => ProviderScope(
      child: MaterialApp(
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [AppLocalizations.delegate, ...GlobalMaterialLocalizations.delegates],
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    );

void main() {
  final property = Property({
    '_id': 'p1',
    'propertyId': 'RE-000125',
    'propertyType': 'RESIDENTIAL_PLOT',
    'listingPurpose': 'SALE',
    'status': 'AVAILABLE',
    'society': 'Gulshan-e-Iqbal',
    'size': 120,
    'sizeUnit': 'SQ_YARD',
    'askingPrice': 15500000,
    'matchCount': 8,
  });

  testWidgets('PropertyCard shows the spec fields', (tester) async {
    await tester.pumpWidget(_wrap(PropertyCard(property: property, onTap: () {})));
    await tester.pumpAndSettle();
    expect(find.text('RE-000125'), findsOneWidget);
    expect(find.text('120 Sq. yard Residential plot'), findsOneWidget);
    expect(find.text('PKR 1.55 Crore'), findsOneWidget);
    expect(find.text('Available'), findsOneWidget);
    expect(find.text('8 matches'), findsOneWidget);
  });

  testWidgets('Urdu switches the layout to right-to-left', (tester) async {
    await tester.pumpWidget(_wrap(PropertyCard(property: property, onTap: () {}), locale: const Locale('ur')));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byType(PropertyCard))), TextDirection.rtl);
    expect(find.text('دستیاب'), findsOneWidget);
    // IDs stay left-to-right inside Urdu text.
    final id = tester.widget<Text>(find.text('RE-000125'));
    expect(id.textDirection, TextDirection.ltr);
  });

  testWidgets('FollowUpCard shows overdue status for past pending items', (tester) async {
    final f = FollowUp({'type': 'CALL', 'dueAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(), 'status': 'PENDING', 'priority': 'HIGH', 'clientId': {'_id': 'c1', 'fullName': 'Muhammad Ali'}});
    var completed = false;
    await tester.pumpWidget(_wrap(FollowUpCard(followUp: f, onComplete: () => completed = true)));
    await tester.pumpAndSettle();
    expect(find.text('Call · Muhammad Ali'), findsOneWidget);
    expect(find.text('Overdue'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.check_circle_outline));
    expect(completed, isTrue);
  });

  testWidgets('AppEmptyState and AppButton loading state', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_wrap(Column(children: [
      const AppEmptyState(title: 'Nothing here'),
      AppButton(label: 'Save', loading: true, onPressed: () => taps++),
    ])));
    await tester.pump();
    expect(find.text('Nothing here'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byType(FilledButton));
    expect(taps, 0);
  });
  testWidgets('MatchCard shows score, reasons and View / Call / WhatsApp / Follow-up actions', (tester) async {
    final m = Match({
      '_id': 'm1',
      'matchScore': 95,
      'band': 'EXCELLENT',
      'status': 'NEW',
      'clientId': {'_id': 'c1', 'fullName': 'Muhammad Ali', 'mobileNumber': '+923001234567'},
      'propertyId': {'_id': 'p1', 'propertyId': 'RE-000125', 'propertyType': 'RESIDENTIAL_PLOT', 'size': 120, 'sizeUnit': 'SQ_YARD', 'society': 'Gulshan-e-Iqbal', 'askingPrice': 15500000},
      'matchReasons': [
        {'code': 'BUDGET_MATCH'},
      ],
    });
    await tester.pumpWidget(_wrap(MatchCard(match: m, perspective: 'client')));
    await tester.pumpAndSettle();
    expect(find.text('95% Match'), findsOneWidget);
    expect(find.text('PKR 1.55 Crore'), findsOneWidget);
    expect(find.byIcon(Icons.call), findsOneWidget);
    expect(find.byIcon(Icons.chat), findsOneWidget);
    expect(find.byIcon(Icons.event_available), findsOneWidget);
  });

  testWidgets('promptText returns the typed value, or null when cancelled', (tester) async {
    String? result = 'unset';
    await tester.pumpWidget(_wrap(Builder(builder: (c) => TextButton(onPressed: () async => result = await promptText(c, title: 'Rename', label: 'File name', initial: 'a.pdf'), child: const Text('open')))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'deed.pdf');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(result, 'deed.pdf');
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(result, isNull);
  });
}
