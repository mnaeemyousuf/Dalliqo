// ignore_for_file: avoid_print
// Renders real Dalliqo mobile screens to PNG without a phone or emulator, for visual review of the
// branding (theme, logo, typeface). Not part of the regular suite (lives outside test/):
//
//   flutter test test_render            → build/brand_renders/*.png
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_crm/core/database/app_database.dart';
import 'package:real_estate_crm/core/l10n/app_localizations.dart';
import 'package:real_estate_crm/core/providers.dart';
import 'package:real_estate_crm/core/theme/app_theme.dart';
import 'package:real_estate_crm/core/theme/brand_tokens.dart';
import 'package:real_estate_crm/core/widgets/app_widgets.dart';
import 'package:real_estate_crm/core/widgets/brand.dart';
import 'package:real_estate_crm/features/auth/onboarding.dart';
import 'package:real_estate_crm/features/dashboard/dashboard_screens.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _size = Size(412, 892); // a typical Android phone in logical pixels
const _ratio = 2.0;
final _out = Directory('build/redesign_renders');

Future<void> _loadFonts() async {
  final jakarta = FontLoader(Brand.fontFamily);
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
    jakarta.addFont(rootBundle.load('assets/fonts/PlusJakartaSans-$w.ttf'));
  }
  await jakarta.load();
  // Material icons ship inside the Flutter SDK.
  // flutter_tester runs from <sdk>/bin/cache/artifacts/engine/<platform>/.
  final artifacts = File(Platform.resolvedExecutable).parent.parent.parent.path;
  final icons = File('$artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (!icons.existsSync()) print('Material icons font not found at ${icons.path}');
  if (icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
}

void main() {
  late AppDatabase db;
  setUpAll(() async {
    sqfliteFfiInit();
    db = await AppDatabase.open(path: inMemoryDatabasePath, factory: databaseFactoryFfi);
    await _loadFonts();
    _out.createSync(recursive: true);
  });

  Future<void> render(WidgetTester tester, String name, Widget home, {Brightness brightness = Brightness.light, Locale locale = const Locale('en'), List<dynamic> overrides = const []}) async {
    tester.view.physicalSize = _size * _ratio;
    tester.view.devicePixelRatio = _ratio;
    addTearDown(tester.view.reset);
    final key = GlobalKey();
    await tester.pumpWidget(ProviderScope(
      overrides: [databaseProvider.overrideWithValue(db), ...overrides.cast()],
      child: RepaintBoundary(
        key: key,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [AppLocalizations.delegate, ...GlobalMaterialLocalizations.delegates],
          theme: brightness == Brightness.light ? AppTheme.light(locale) : AppTheme.dark(locale),
          home: home,
        ),
      ),
    ));
    // Decode the logo PNGs for real (asset images load asynchronously).
    await tester.runAsync(() async {
      for (final el in find.byType(Image).evaluate()) {
        await precacheImage((el.widget as Image).image, el, onError: (e, _) => print('$name: precache error $e'));
      }
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    for (var i = 0; i < 5; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 1));
    for (final raw in tester.widgetList<RawImage>(find.byType(RawImage))) {
      print('$name: logo image ${raw.image == null ? 'NOT decoded' : '${raw.image!.width}x${raw.image!.height}'}');
    }
    final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final bytes = await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: _ratio);
      return (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
    });
    File('${_out.path}/$name.png').writeAsBytesSync(bytes!);
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
  }

  final now = DateTime.now();
  final myDay = <String, dynamic>{
    'overdueFollowUps': [
      {'_id': 'f1', 'title': 'Call about DHA portion', 'type': 'CALL', 'status': 'PENDING', 'priority': 'HIGH', 'dueAt': now.subtract(const Duration(days: 1)).toIso8601String(), 'clientId': {'_id': 'c1', 'fullName': 'Kamran Hussain'}},
    ],
    'todaysFollowUps': [
      {'_id': 'f2', 'title': 'Share brochure', 'type': 'WHATSAPP', 'status': 'PENDING', 'priority': 'MEDIUM', 'dueAt': now.add(const Duration(hours: 2)).toIso8601String(), 'clientId': {'_id': 'c2', 'fullName': 'Ayesha Baig'}},
    ],
    'todaysMeetings': [],
    'propertyVisits': [],
    'newMatches': [],
    'newClients': [
      {'_id': 'c3', 'fullName': 'Imran Memon', 'minBudget': 15000000, 'maxBudget': 22000000},
      {'_id': 'c4', 'fullName': 'Rabia Raza', 'minBudget': 40000000, 'maxBudget': 60000000},
    ],
    'newProperties': [],
  };
  final dashboard = <String, dynamic>{
    'properties': {'total': 30, 'available': 28, 'sold': 1, 'rented': 0, 'needsVerification': 7},
    'clients': {
      'total': 42, 'buyers': 25, 'rental': 9, 'owners': 10,
      'byCategory': [{'name': 'Primary', 'count': 18}, {'name': 'Investor', 'count': 9}, {'name': 'Tenant', 'count': 6}],
    },
    'followUps': {'today': 5, 'overdue': 8},
    'today': {'newClients': 3, 'newProperties': 2, 'newMatches': 43},
    'deals': {'open': 6, 'wonThisMonth': 1, 'receivedThisMonth': 471000, 'outstanding': 2599000},
    'finance': {'incomeThisMonth': 890000, 'expenseThisMonth': 120000, 'netThisMonth': 770000},
  };
  final fakes = [
    myDayProvider.overrideWith((ref) async => (data: myDay, cachedAt: null)),
    dashboardProvider.overrideWith((ref) async => (data: dashboard, cachedAt: null)),
  ];

  testWidgets('splash', (t) => render(t, 'splash', const BrandSplash()));
  testWidgets('onboarding', (t) => render(t, 'onboarding', OnboardingScreen(onDone: () {})));
  testWidgets('onboarding ur', (t) => render(t, 'onboarding-ur', OnboardingScreen(onDone: () {}), locale: const Locale('ur')));
  testWidgets('my day light', (t) => render(t, 'myday-light', const MyDayScreen(), overrides: fakes));
  testWidgets('my day dark ur', (t) => render(t, 'myday-dark-ur', const MyDayScreen(), overrides: fakes, brightness: Brightness.dark, locale: const Locale('ur')));
  testWidgets('dashboard light', (t) => render(t, 'dashboard-light', const DashboardScreen(), overrides: fakes));
  testWidgets('dashboard dark', (t) => render(t, 'dashboard-dark', const DashboardScreen(), overrides: fakes, brightness: Brightness.dark));
  testWidgets('empty + loader', (t) => render(t, 'states', const Scaffold(body: Column(children: [SizedBox(height: 260, child: AppLoader(rows: 2)), AppEmptyState(title: 'No clients yet', hint: 'Add your first client to get started')]))));
}
