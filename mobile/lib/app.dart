import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import 'core/config/env.dart';
import 'core/l10n/app_localizations.dart';
import 'core/notifications/push_service.dart';
import 'core/providers.dart';
import 'core/realtime/realtime_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/brand_tokens.dart';
import 'features/auth/auth_controller.dart';

final pushServiceProvider = Provider<PushService>((ref) => PushService(
      ref.watch(apiClientProvider),
      onOpen: (link) => ref.read(routerProvider).push(appRouteFor(link)),
    ));

final realtimeProvider = ChangeNotifierProvider<RealtimeService>((ref) => RealtimeService(
      ref.watch(secureStoreProvider),
      ref.watch(apiClientProvider),
      // Another device changed something: pull the delta.
      onChange: (_) => ref.read(syncEngineProvider).schedule(const Duration(milliseconds: 800)),
      onNotification: (d) => ref.read(pushServiceProvider).show(d['title'] as String? ?? '', d['body'] as String? ?? '', deepLink: d['deepLink'] as String?),
      onSessionRevoked: () => ref.read(authProvider.notifier).signOut(callServer: false),
    ));

class CrmApp extends ConsumerStatefulWidget {
  const CrmApp({super.key});
  @override
  ConsumerState<CrmApp> createState() => _CrmAppState();
}

class _CrmAppState extends ConsumerState<CrmApp> with WidgetsBindingObserver {
  DateTime? _backgroundedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(ref.read(pushServiceProvider).init());
    unawaited(ref.read(authProvider.notifier).init());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) _backgroundedAt = DateTime.now();
    if (state == AppLifecycleState.resumed) {
      final away = _backgroundedAt == null ? Duration.zero : DateTime.now().difference(_backgroundedAt!);
      if (away > Env.lockAfter) {
        ref.read(secureStoreProvider).hasPin.then((has) {
          if (has) ref.read(authProvider.notifier).lock();
        });
      }
      if (ref.read(authProvider).status == AuthStatus.signedIn) {
        ref.read(syncEngineProvider).schedule(Duration.zero);
        unawaited(ref.read(realtimeProvider).connect());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Connect realtime and register for pushes once signed in; tear down on sign-out.
    ref.listen<AuthState>(authProvider, (prev, next) {
      final signedInNow = next.status == AuthStatus.signedIn && !next.mustChangePassword;
      final wasSignedIn = prev?.status == AuthStatus.signedIn && !(prev?.mustChangePassword ?? false);
      if (signedInNow && !wasSignedIn) {
        unawaited(ref.read(realtimeProvider).connect());
        unawaited(ref.read(pushServiceProvider).registerDevice());
      }
      if (next.status == AuthStatus.signedOut) unawaited(ref.read(realtimeProvider).disconnect());
    });
    final prefs = ref.watch(prefsProvider);
    return MaterialApp.router(
      title: Brand.name,
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(routerProvider),
      locale: prefs.locale,
      themeMode: prefs.theme,
      theme: AppTheme.light(prefs.locale),
      darkTheme: AppTheme.dark(prefs.locale),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
    );
  }
}
