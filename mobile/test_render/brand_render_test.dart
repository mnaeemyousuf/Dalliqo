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
import 'package:real_estate_crm/features/auth/auth_screens.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _size = Size(412, 892); // a typical Android phone in logical pixels
const _ratio = 2.0;
final _out = Directory('build/brand_renders');

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

  Future<void> render(WidgetTester tester, String name, Widget home, {Brightness brightness = Brightness.light}) async {
    tester.view.physicalSize = _size * _ratio;
    tester.view.devicePixelRatio = _ratio;
    addTearDown(tester.view.reset);
    const locale = Locale('en');
    final key = GlobalKey();
    await tester.pumpWidget(ProviderScope(
      overrides: [databaseProvider.overrideWithValue(db)],
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

  testWidgets('sign-in, light', (t) => render(t, 'login-light', const LoginScreen()));
  testWidgets('sign-in, dark', (t) => render(t, 'login-dark', const LoginScreen(), brightness: Brightness.dark));
  testWidgets('splash', (t) => render(t, 'splash', const SplashScreen()));
}
