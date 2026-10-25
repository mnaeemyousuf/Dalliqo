import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import 'package:share_plus/share_plus.dart';

import '../../app.dart';
import '../../core/l10n/app_localizations.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/brand.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_screens.dart';

/// Profile · Business · Users · Language · Theme · Notifications · Security ·
/// Backup & sync · Export · About · Logout.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final prefs = ref.watch(prefsProvider);
    final sync = ref.watch(syncEngineProvider).state;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('settings.title'))),
      body: ListView(children: [
        SectionHeader(l.t('settings.profile')),
        ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text(auth.user?['fullName'] as String? ?? ''),
          subtitle: Text(auth.user?['email'] as String? ?? '', textDirection: TextDirection.ltr),
          trailing: const Icon(Icons.edit_outlined),
          onTap: () => _editProfile(context, ref),
        ),
        ListTile(
          leading: const Icon(Icons.business_outlined),
          title: Text(l.t('settings.business')),
          subtitle: Text(auth.business?['name'] as String? ?? ''),
        ),
        if (auth.can('members:read'))
          ListTile(leading: const Icon(Icons.group_outlined), title: Text(l.t('nav.users')), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const _MembersScreen()))),
        SectionHeader(l.t('settings.appearance')),
        ListTile(
          leading: const Icon(Icons.translate),
          title: Text(l.t('topbar.language')),
          trailing: SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'en', label: Text('EN')), ButtonSegment(value: 'ur', label: Text('اردو'))],
            selected: {prefs.locale.languageCode},
            onSelectionChanged: (s) {
              ref.read(prefsProvider.notifier).setLanguage(s.first);
              ref.read(authProvider.notifier).updateProfile({'preferences': {'language': s.first}}).catchError((_) {});
            },
          ),
        ),
        ListTile(
          leading: const Icon(Icons.dark_mode_outlined),
          title: Text(l.t('topbar.theme')),
          trailing: DropdownButton<ThemeMode>(
            value: prefs.theme,
            underline: const SizedBox(),
            items: [for (final m in ThemeMode.values) DropdownMenuItem(value: m, child: Text(l.t('topbar.${m.name}')))],
            onChanged: (m) {
              if (m == null) return;
              ref.read(prefsProvider.notifier).setTheme(m);
              ref.read(authProvider.notifier).updateProfile({'preferences': {'theme': m.name}}).catchError((_) {});
            },
          ),
        ),
        SectionHeader(l.t('nav.notifications')),
        ListTile(
          leading: const Icon(Icons.notifications_active_outlined),
          title: Text(l.t('mobile.notificationsPermission')),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => ref.read(pushServiceProvider).registerDevice(),
        ),
        SectionHeader(l.t('settings.security')),
        const _LockSettings(),
        ListTile(leading: const Icon(Icons.password), title: Text(l.t('auth.changePassword')), onTap: () => _changePassword(context, ref)),
        ListTile(leading: const Icon(Icons.devices_outlined), title: Text(l.t('settings.sessions')), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const _SessionsScreen()))),
        SectionHeader(l.t('mobile.backup.title')),
        ListTile(
          leading: const Icon(Icons.cloud_done_outlined),
          title: Text(l.t('mobile.backup.cloud')),
          subtitle: Text(l.t('mobile.backup.description')),
          isThreeLine: true,
        ),
        ListTile(
          leading: const Icon(Icons.backup_outlined),
          title: Text(l.t('mobile.backup.now')),
          subtitle: Text(sync.pending > 0 ? l.t('mobile.backup.pending', {'count': sync.pending}) : l.t('mobile.backup.upToDate')),
          onTap: () async {
            await ref.read(syncEngineProvider).syncNow();
            if (!context.mounted) return;
            final s = ref.read(syncEngineProvider).state;
            showMessage(context, s.pending == 0 && s.lastError == null ? l.t('mobile.backup.done') : (s.lastError ?? l.t('mobile.backup.pending', {'count': s.pending})));
          },
        ),
        SectionHeader(l.t('mobile.sync.title')),
        ListTile(
          leading: const Icon(Icons.cloud_sync_outlined),
          title: Text(l.t('mobile.sync.title')),
          subtitle: Text(sync.lastSyncedAt == null ? '' : l.t('mobile.sync.lastSync', {'time': relativeTime(sync.lastSyncedAt!, locale: l.locale.languageCode)})),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/sync'),
        ),
        if (auth.can('exports:create')) ...[
          SectionHeader(l.t('mobile.exportShare')),
          for (final r in const ['clients', 'properties', 'owners', 'followups', 'matches'])
            ListTile(
              leading: const Icon(Icons.file_download_outlined),
              title: Text(l.t('enums.exportResource.$r')),
              trailing: Wrap(children: [
                TextButton(onPressed: () => _export(context, ref, r, 'xlsx'), child: const Text('Excel')),
                TextButton(onPressed: () => _export(context, ref, r, 'pdf'), child: const Text('PDF')),
              ]),
            ),
        ],
        SectionHeader(l.t('settings.about')),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const BrandLogo(height: 36),
            const SizedBox(height: 10),
            Text(l.t('app.tagline'), style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text('${l.t('app.description')} · ${l.t('settings.version', {'version': '1.0.0'})}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            Text(l.t('settings.aboutText'), style: Theme.of(context).textTheme.bodyMedium),
          ]),
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.all(16),
          child: AppButton(
            label: l.t('nav.logout'),
            icon: Icons.logout,
            danger: true,
            expand: true,
            onPressed: () async {
              final pending = ref.read(syncEngineProvider).state.pending;
              final message = pending > 0 ? '${l.t('mobile.sync.syncing', {'count': pending})}\n${l.t('common.cannotUndo')}' : null;
              if (await confirmDialog(context, title: l.t('nav.logout'), message: message, confirmLabel: l.t('nav.logout'))) {
                await ref.read(pushServiceProvider).unregister();
                await ref.read(authProvider.notifier).signOut();
              }
            },
          ),
        ),
      ]),
    );
  }

  Future<void> _export(BuildContext context, WidgetRef ref, String resource, String format) async {
    showMessage(context, context.t('report.generating'));
    try {
      final file = await ref.read(onlineRepositoryProvider).export(resource, format);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], text: context.mounted ? context.t('mobile.exported') : null));
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _editProfile(BuildContext context, WidgetRef ref) async {
    final auth = ref.read(authProvider);
    final name = TextEditingController(text: auth.user?['fullName'] as String? ?? '');
    final mobile = TextEditingController(text: auth.user?['mobileNumber'] as String? ?? '');
    await showAppBottomSheet<void>(
      context,
      title: context.t('settings.profile'),
      child: Column(children: [
        AppTextField(label: context.t('auth.fullName'), controller: name),
        const SizedBox(height: 12),
        AppTextField(label: context.t('auth.mobile'), controller: mobile, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr),
        const SizedBox(height: 16),
        AppButton(
          label: context.t('common.save'),
          expand: true,
          onPressed: () async {
            try {
              await ref.read(authProvider.notifier).updateProfile({'fullName': name.text.trim(), if (mobile.text.trim().isNotEmpty) 'mobileNumber': mobile.text.trim()});
              if (context.mounted) {
                Navigator.pop(context);
                showMessage(context, context.t('settings.profileSaved'));
              }
            } catch (e) {
              if (context.mounted) showError(context, e);
            }
          },
        ),
      ]),
    );
  }

  Future<void> _changePassword(BuildContext context, WidgetRef ref) async {
    final current = TextEditingController();
    final next = TextEditingController();
    await showAppBottomSheet<void>(
      context,
      title: context.t('auth.changePassword'),
      child: Column(children: [
        AppTextField(label: context.t('auth.currentPassword'), controller: current, obscure: true),
        const SizedBox(height: 12),
        AppTextField(label: context.t('auth.newPassword'), controller: next, obscure: true, helper: context.t('auth.passwordHint')),
        const SizedBox(height: 16),
        AppButton(
          label: context.t('common.save'),
          expand: true,
          onPressed: () async {
            try {
              await ref.read(apiClientProvider).post('/auth/change-password', {'currentPassword': current.text, 'newPassword': next.text});
              if (context.mounted) {
                Navigator.pop(context);
                showMessage(context, context.t('settings.passwordChanged'));
              }
            } catch (e) {
              if (context.mounted) showError(context, e);
            }
          },
        ),
      ]),
    );
  }
}

class _LockSettings extends ConsumerStatefulWidget {
  const _LockSettings();
  @override
  ConsumerState<_LockSettings> createState() => _LockSettingsState();
}

class _LockSettingsState extends ConsumerState<_LockSettings> {
  bool _pin = false;
  bool _bio = false;
  bool _bioAvailable = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final store = ref.read(secureStoreProvider);
    final pin = await store.hasPin;
    final bio = await store.biometricEnabled;
    var available = false;
    try {
      available = await LocalAuthentication().canCheckBiometrics;
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _pin = pin;
      _bio = bio;
      _bioAvailable = available;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final store = ref.read(secureStoreProvider);
    return Column(children: [
      SwitchListTile(
        secondary: const Icon(Icons.pin_outlined),
        title: Text(l.t('mobile.lock.enablePin')),
        value: _pin,
        onChanged: (on) async {
          if (on) {
            final set = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const LockScreen(setup: true)));
            if (set != true) return;
          } else {
            await store.clearPin();
          }
          await _load();
        },
      ),
      if (_pin && _bioAvailable)
        SwitchListTile(
          secondary: const Icon(Icons.fingerprint),
          title: Text(l.t('mobile.lock.enableBiometric')),
          value: _bio,
          onChanged: (on) async {
            await store.setBiometric(on);
            await _load();
          },
        ),
    ]);
  }
}

class _MembersScreen extends ConsumerWidget {
  const _MembersScreen();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('nav.users'))),
      body: FutureBuilder(
        future: ref.read(onlineRepositoryProvider).members(),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!);
          if (!snap.hasData) return const AppLoader();
          return ListView(children: [
            for (final m in snap.data!)
              ListTile(
                leading: CircleAvatar(child: Text(((m['user'] as Map)['fullName'] as String).characters.first)),
                title: Text((m['user'] as Map)['fullName'] as String),
                subtitle: Text('${l.enumLabel('role', m['role'] as String?)} · ${l.enumLabel('memberStatus', m['status'] as String?)}'),
                trailing: Text('${(m['permissions'] as List).length}', style: Theme.of(context).textTheme.bodySmall),
              ),
            Padding(padding: const EdgeInsets.all(16), child: Text(l.t('user.permissions'), style: Theme.of(context).textTheme.bodySmall)),
          ]);
        },
      ),
    );
  }
}

class _SessionsScreen extends ConsumerStatefulWidget {
  const _SessionsScreen();
  @override
  ConsumerState<_SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<_SessionsScreen> {
  int _reload = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final repo = ref.read(onlineRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.t('settings.sessions'))),
      body: FutureBuilder(
        key: ValueKey(_reload),
        future: repo.sessions(),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!);
          if (!snap.hasData) return const AppLoader();
          return ListView(children: [
            for (final s in snap.data!)
              ListTile(
                leading: Icon(s['clientType'] == 'mobile' ? Icons.smartphone : Icons.laptop),
                title: Text((s['deviceName'] ?? s['clientType']) as String),
                subtitle: Text('${s['ip'] ?? ''} · ${relativeTime(parseDate(s['lastUsedAt']) ?? DateTime.now(), locale: l.locale.languageCode)}'),
                trailing: s['current'] == true
                    ? Text(l.t('settings.thisDevice'))
                    : TextButton(
                        onPressed: () async {
                          await repo.revokeSession(s['_id'] as String);
                          setState(() => _reload++);
                        },
                        child: Text(l.t('settings.signOutDevice')),
                      ),
              ),
          ]);
        },
      ),
    );
  }
}
