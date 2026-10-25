import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';

/// Bottom navigation + the global "+" button. The most common actions are
/// one or two taps away from every tab.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  void _quickAdd(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authProvider);
    showAppBottomSheet<void>(
      context,
      title: context.t('mobile.quickAdd'),
      child: Column(children: [
        if (auth.can('clients:create'))
          ListTile(leading: const Icon(Icons.person_add_alt), title: Text(context.t('client.add')), onTap: () => _go(context, '/clients/new')),
        if (auth.can('properties:create'))
          ListTile(leading: const Icon(Icons.add_home_outlined), title: Text(context.t('property.add')), onTap: () => _go(context, '/properties/new')),
        if (auth.can('followups:create'))
          ListTile(leading: const Icon(Icons.event_available), title: Text(context.t('followup.add')), onTap: () => _go(context, '/followups/new')),
        if (auth.can('notes:create'))
          ListTile(leading: const Icon(Icons.sticky_note_2_outlined), title: Text(context.t('mobile.addNote')), subtitle: Text(context.t('mobile.pickRecord')), onTap: () => _go(context, '/clients')),
        if (auth.can('documents:upload'))
          ListTile(leading: const Icon(Icons.upload_file), title: Text(context.t('mobile.uploadDocument')), subtitle: Text(context.t('mobile.pickRecord')), onTap: () => _go(context, '/properties')),
      ]),
    );
  }

  void _go(BuildContext context, String route) {
    Navigator.of(context).pop();
    route == '/clients' || route == '/properties' ? context.go(route) : context.push(route);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        body: shell,
        floatingActionButton: FloatingActionButton(
          tooltip: context.t('mobile.quickAdd'),
          onPressed: () => _quickAdd(context, ref),
          child: const Icon(Icons.add),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: [
            NavigationDestination(icon: const Icon(Icons.today_outlined), selectedIcon: const Icon(Icons.today), label: context.t('mobile.tabs.myDay')),
            NavigationDestination(icon: const Icon(Icons.people_outline), selectedIcon: const Icon(Icons.people), label: context.t('mobile.tabs.clients')),
            NavigationDestination(icon: const Icon(Icons.home_work_outlined), selectedIcon: const Icon(Icons.home_work), label: context.t('mobile.tabs.properties')),
            NavigationDestination(icon: const Icon(Icons.handshake_outlined), selectedIcon: const Icon(Icons.handshake), label: context.t('mobile.tabs.matches')),
            NavigationDestination(icon: const Icon(Icons.menu), label: context.t('mobile.tabs.more')),
          ],
        ),
      );
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    Widget tile(IconData icon, String label, String route) => ListTile(leading: Icon(icon), title: Text(label), trailing: const Icon(Icons.chevron_right), onTap: () => context.push(route));
    return Scaffold(
      appBar: AppBar(title: Text(auth.business?['name'] as String? ?? context.t('app.name'))),
      body: ListView(children: [
        ListTile(
          leading: CircleAvatar(child: Text((auth.user?['fullName'] as String? ?? '?').characters.first)),
          title: Text(auth.user?['fullName'] as String? ?? ''),
          subtitle: Text(context.l10n.enumLabel('role', auth.membership?['role'] as String?)),
        ),
        const Divider(),
        tile(Icons.dashboard_outlined, context.t('nav.dashboard'), '/dashboard'),
        if (auth.can('owners:read')) tile(Icons.apartment, context.t('nav.owners'), '/owners'),
        if (auth.can('followups:read')) tile(Icons.event_note, context.t('nav.followups'), '/followups'),
        tile(Icons.notifications_outlined, context.t('nav.notifications'), '/notifications'),
        tile(Icons.sync, context.t('mobile.sync.title'), '/sync'),
        tile(Icons.settings_outlined, context.t('nav.settings'), '/settings'),
      ]),
    );
  }
}
