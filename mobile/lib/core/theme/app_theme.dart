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
      surfaceContainerHighest: light ? BrandLight.canvas : BrandDark.primarySoft,
      outline: light ? BrandLight.muted : BrandDark.muted,
      outlineVariant: light ? BrandLight.line : BrandDark.line,
    );
  }

  static ThemeData _build(Brightness brightness, Locale locale) {
    final scheme = AppTheme.scheme(brightness);
    final light = brightness == Brightness.light;
    final urdu = locale.languageCode == 'ur';
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: brightness, fontFamily: urdu ? 'Noto Nastaliq Urdu' : Brand.fontFamily);
    return base.copyWith(
      scaffoldBackgroundColor: light ? BrandLight.canvas : BrandDark.canvas,
      textTheme: urdu ? base.textTheme.apply(fontFamilyFallback: const ['Noto Naskh Arabic', 'sans-serif']) : base.textTheme,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        backgroundColor: light ? BrandLight.surface : BrandDark.surface,
        foregroundColor: light ? BrandLight.ink : BrandDark.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
        titleTextStyle: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, color: light ? BrandLight.ink : BrandDark.ink),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radiusLg), side: BorderSide(color: scheme.outlineVariant)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(Brand.radiusMd), borderSide: BorderSide(color: scheme.outlineVariant)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Brand.radiusMd), borderSide: BorderSide(color: scheme.outlineVariant)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Brand.radiusMd), borderSide: BorderSide(color: light ? BrandLight.primaryFocus : BrandDark.primaryFocus, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          textStyle: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radiusMd)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 44),
          side: BorderSide(color: scheme.outlineVariant),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radiusMd)),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(backgroundColor: scheme.primary, foregroundColor: scheme.onPrimary),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        surfaceTintColor: Colors.transparent,
      ),
      chipTheme: const ChipThemeData(showCheckmark: false),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant),
    );
  }
}
