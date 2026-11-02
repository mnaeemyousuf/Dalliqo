import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import 'core/config/env.dart';
import 'core/l10n/app_localizations.dart';
import 'core/notifications/push_service.dart';
import 'core/notifications/reminder_scheduler.dart';
import 'core/providers.dart';
import 'core/realtime/realtime_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/brand_tokens.dart';
import 'features/auth/auth_controller.dart';

final Provider<PushService> pushServiceProvider = Provider<PushService>((ref) => PushService(
      ref.watch(apiClientProvider),
      onOpen: (link) => ref.read(routerProvider).push(appRouteFor(link)),
      shouldShowReminder: (id) => ref.read(reminderSchedulerProvider).shouldShowPush(id),
    ));

/// Local follow-up reminders (work without Firebase and without internet).
final Provider<ReminderScheduler> reminderSchedulerProvider = Provider<ReminderScheduler>((ref) {
  final db = ref.watch(databaseProvider);
  return ReminderScheduler(
    db,
    LocalNotificationsPlatform(ref.watch(pushServiceProvider).plugin),
    userId: () => ref.read(authProvider).userId,
    defaultMinutes: () async => ((await db.getJson('session.settings'))?['reminders']?['defaultMinutesBefore'] as num?)?.toInt() ?? 30,
    text: () async {
      final l = await AppLocalizations.delegate.load(ref.read(prefsProvider).locale);
      return l.t;
    },
  );
});

final realtimeProvider = ChangeNotifierProvider<RealtimeService>((ref) => RealtimeService(
      ref.watch(secureStoreProvider),
      ref.watch(apiClientProvider),
      // Another device changed something: pull the delta.
      onChange: (_) => ref.read(syncEngineProvider).schedule(const Duration(milliseconds: 800)),
      onNotification: (d) async {
        // A follow-up reminder this phone already rang by itself is not shown twice.
        final followUpId = d['followUpId'] as String?;
        if (followUpId != null && !await ref.read(reminderSchedulerProvider).shouldShowPush(followUpId)) return;
        await ref.read(pushServiceProvider).show(d['title'] as String? ?? '', d['body'] as String? ?? '', deepLink: d['deepLink'] as String?);
      },
      onSessionRevoked: () => ref.read(authProvider.notifier).signOut(callServer: false),
    ));

class CrmApp extends ConsumerStatefulWidget {
  const CrmApp({super.key});
  @override
  ConsumerState<CrmApp> createState() => _CrmAppState();
}

class _CrmAppState extends ConsumerState<CrmApp> with WidgetsBindingObserver {
  DateTime? _backgroundedAt;
  StreamSubscription<String>? _followUpChanges;
  Timer? _reminderDebounce;

  /// Re-plans local reminders after follow-up rows change (local edits and sync pulls), debounced.
  void _watchReminders() {
    _followUpChanges ??= ref.read(databaseProvider).changes.where((e) => e == 'followUps').listen((_) {
      _reminderDebounce?.cancel();
      _reminderDebounce = Timer(const Duration(milliseconds: 600), () => unawaited(ref.read(reminderSchedulerProvider).resync()));
    });
  }

  Future<void> _startReminders() async {
    final platform = LocalNotificationsPlatform(ref.read(pushServiceProvider).plugin);
    await platform.init();
    await platform.requestPermissions();
    _watchReminders();
    await ref.read(reminderSchedulerProvider).resync();
  }

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
    _followUpChanges?.cancel();
    _reminderDebounce?.cancel();
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
        unawaited(_startReminders());
      }
      if (next.status == AuthStatus.signedOut) {
        unawaited(ref.read(realtimeProvider).disconnect());
        unawaited(ref.read(reminderSchedulerProvider).cancelAll());
      }
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
