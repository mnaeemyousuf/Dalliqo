import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'brand_tokens.dart';

/// Dalliqo Material 3 theme for light and dark modes.
///
/// All colours, radii and the typeface come from [Brand] / [BrandLight] / [BrandDark], which are
/// generated from shared/brand/dalliqo.tokens.json (the same source as the web CSS variables), so
/// both apps stay visually identical. Urdu uses Noto Nastaliq when installed on the device.
class AppTheme {
  static const brand = Brand.primary600;

  static ThemeData light(Locale locale) => _build(Brightness.light, locale);
  static ThemeData dark(Locale locale) => _build(Brightness.dark, locale);

  static ColorScheme scheme(Brightness brightness) {
    final light = brightness == Brightness.light;
    final base = ColorScheme.fromSeed(seedColor: Brand.primary600, brightness: brightness);
    return base.copyWith(
      primary: light ? BrandLight.primary : BrandDark.primary,
      onPrimary: light ? BrandLight.onPrimary : BrandDark.onPrimary,
      primaryContainer: light ? BrandLight.primarySoft2 : BrandDark.primarySoft2,
      onPrimaryContainer: light ? BrandLight.primarySoftInk : BrandDark.primarySoftInk,
      secondary: Brand.accent,
      onSecondary: Brand.primary900,
      secondaryContainer: light ? BrandLight.primarySoft : BrandDark.primarySoft,
      onSecondaryContainer: light ? BrandLight.primarySoftInk : BrandDark.primarySoftInk,
      tertiary: Brand.accent,
      error: Brand.danger,
      surface: light ? BrandLight.surface : BrandDark.surface,
      onSurface: light ? BrandLight.ink : BrandDark.ink,
      onSurfaceVariant: light ? BrandLight.muted : BrandDark.muted,
      surfaceContainerLowest: light ? BrandLight.surface : BrandDark.surface,
      surfaceContainerLow: light ? const Color(0xFFF8FAFD) : const Color(0xFF151E33),
      surfaceContainer: light ? const Color(0xFFF1F4F9) : const Color(0xFF18223A),
      surfaceContainerHigh: light ? const Color(0xFFECF0F6) : const Color(0xFF1C2742),
      surfaceContainerHighest: light ? BrandLight.canvas : BrandDark.primarySoft,
      outline: light ? BrandLight.muted : BrandDark.muted,
      outlineVariant: light ? BrandLight.line : BrandDark.line,
      shadow: light ? const Color(0xFF0F172A) : Colors.black,
    );
  }

  /// Soft, layered elevation used by cards and floating surfaces.
  static List<BoxShadow> softShadow(BuildContext context, {bool raised = false}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (dark) return [BoxShadow(color: Colors.black.withValues(alpha: raised ? 0.45 : 0.25), blurRadius: raised ? 24 : 10, offset: Offset(0, raised ? 10 : 3))];
    return [
      BoxShadow(color: const Color(0xFF0F172A).withValues(alpha: 0.04), blurRadius: 2, offset: const Offset(0, 1)),
      BoxShadow(color: const Color(0xFF0F172A).withValues(alpha: raised ? 0.10 : 0.05), blurRadius: raised ? 28 : 12, offset: Offset(0, raised ? 12 : 4)),
    ];
  }

  static TextTheme _text(TextTheme t, Color ink, Color muted) => t.copyWith(
        displaySmall: t.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -1, color: ink),
        headlineLarge: t.headlineLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.8, color: ink),
        headlineMedium: t.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.6, color: ink),
        headlineSmall: t.headlineSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.4, color: ink),
        titleLarge: t.titleLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.3, color: ink),
        titleMedium: t.titleMedium?.copyWith(fontWeight: FontWeight.w600, letterSpacing: -0.1, color: ink),
        titleSmall: t.titleSmall?.copyWith(fontWeight: FontWeight.w600, color: ink),
        bodyLarge: t.bodyLarge?.copyWith(color: ink, height: 1.4),
        bodyMedium: t.bodyMedium?.copyWith(color: ink, height: 1.4),
        bodySmall: t.bodySmall?.copyWith(color: muted, height: 1.35),
        labelLarge: t.labelLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.1),
        labelMedium: t.labelMedium?.copyWith(fontWeight: FontWeight.w600, color: muted),
        labelSmall: t.labelSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.6, color: muted),
      );

  static ThemeData _build(Brightness brightness, Locale locale) {
    final scheme = AppTheme.scheme(brightness);
    final light = brightness == Brightness.light;
    final urdu = locale.languageCode == 'ur';
    final ink = light ? BrandLight.ink : BrandDark.ink;
    final muted = light ? BrandLight.muted : BrandDark.muted;
    final canvas = light ? BrandLight.canvas : BrandDark.canvas;
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: brightness, fontFamily: urdu ? 'Noto Nastaliq Urdu' : Brand.fontFamily);
    final text = _text(urdu ? base.textTheme.apply(fontFamilyFallback: const ['Noto Naskh Arabic', 'sans-serif']) : base.textTheme, ink, muted);
    final radiusMd = BorderRadius.circular(12);
    final radiusLg = BorderRadius.circular(Brand.radiusLg + 2);
    OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: radiusMd, borderSide: BorderSide(color: c, width: w));
    return base.copyWith(
      scaffoldBackgroundColor: canvas,
      textTheme: text,
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.standard,
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
      }),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        backgroundColor: canvas,
        foregroundColor: ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.6,
        shadowColor: scheme.outlineVariant,
        titleSpacing: 16,
        titleTextStyle: text.titleLarge?.copyWith(fontWeight: FontWeight.w800, fontSize: 21, color: ink),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: radiusLg, side: BorderSide(color: scheme.outlineVariant.withValues(alpha: light ? 0.9 : 0.7))),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: light ? const Color(0xFFF8FAFD) : const Color(0xFF0F1729),
        border: border(scheme.outlineVariant),
        enabledBorder: border(scheme.outlineVariant),
        disabledBorder: border(scheme.outlineVariant.withValues(alpha: 0.5)),
        focusedBorder: border(light ? BrandLight.primaryFocus : BrandDark.primaryFocus, 1.6),
        errorBorder: border(Brand.danger.withValues(alpha: 0.7)),
        focusedErrorBorder: border(Brand.danger, 1.6),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        labelStyle: TextStyle(color: muted, fontWeight: FontWeight.w500),
        floatingLabelStyle: TextStyle(color: scheme.primary, fontWeight: FontWeight.w600),
        hintStyle: TextStyle(color: muted.withValues(alpha: 0.75)),
        prefixIconColor: muted,
        suffixIconColor: muted,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 50),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          textStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 15),
          shape: RoundedRectangleBorder(borderRadius: radiusMd),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 46),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          foregroundColor: ink,
          backgroundColor: scheme.surface,
          textStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
          side: BorderSide(color: scheme.outlineVariant),
          shape: RoundedRectangleBorder(borderRadius: radiusMd),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(textStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w600), shape: RoundedRectangleBorder(borderRadius: radiusMd)),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: radiusMd)),
          side: WidgetStatePropertyAll(BorderSide(color: scheme.outlineVariant)),
          textStyle: WidgetStatePropertyAll(text.labelLarge?.copyWith(fontWeight: FontWeight.w600)),
          backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? scheme.primaryContainer : scheme.surface),
          foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? scheme.onPrimaryContainer : muted),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 3,
        focusElevation: 4,
        hoverElevation: 5,
        highlightElevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => TextStyle(fontSize: 11.5, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500, color: s.contains(WidgetState.selected) ? ink : muted),
        ),
        iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? scheme.onPrimaryContainer : muted)),
      ),
      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(borderRadius: radiusMd),
        iconColor: muted,
        titleTextStyle: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
        subtitleTextStyle: text.bodySmall,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      ),
      chipTheme: ChipThemeData(
        showCheckmark: false,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        side: BorderSide(color: scheme.outlineVariant),
        backgroundColor: scheme.surface,
        selectedColor: scheme.primaryContainer,
        labelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: light ? const Color(0xFF0F172A) : const Color(0xFF243150),
        contentTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: radiusMd),
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        elevation: 4,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radiusXl + 4)),
        titleTextStyle: text.titleLarge,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        dragHandleColor: scheme.outlineVariant,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Brand.radiusXl + 8))),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        shape: RoundedRectangleBorder(borderRadius: radiusMd, side: BorderSide(color: scheme.outlineVariant)),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: scheme.primary,
        unselectedLabelColor: muted,
        labelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w700),
        unselectedLabelStyle: text.labelLarge?.copyWith(fontWeight: FontWeight.w500),
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: scheme.outlineVariant,
        indicator: UnderlineTabIndicator(borderSide: BorderSide(color: scheme.primary, width: 2.5), borderRadius: const BorderRadius.vertical(top: Radius.circular(3))),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary, linearTrackColor: scheme.primaryContainer, circularTrackColor: Colors.transparent),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1, space: 1),
    );
  }
}
