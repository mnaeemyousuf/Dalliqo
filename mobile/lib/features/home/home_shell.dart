import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/theme/brand_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../branches/branch_screens.dart';

/// Bottom navigation + the global "+" button. The most common actions are
/// one or two taps away from every tab.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  void _quickAdd(BuildContext context, WidgetRef ref) {
    HapticFeedback.lightImpact();
    final auth = ref.read(authProvider);
    Widget action(IconData icon, Color color, String title, String route, {String? subtitle}) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            onTap: () => _go(context, route),
            child: Row(children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  if (subtitle != null) Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                ]),
              ),
              Icon(Icons.chevron_right_rounded, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ]),
          ),
        );
    showAppBottomSheet<void>(
      context,
      title: context.t('mobile.quickAdd'),
      child: Column(children: [
        if (auth.can('clients:create')) action(Icons.person_add_alt_1_rounded, const Color(0xFF2563EB), context.t('client.add'), '/clients/new'),
        if (auth.can('properties:create')) action(Icons.add_home_rounded, const Color(0xFF059669), context.t('property.add'), '/properties/new'),
        if (auth.can('followups:create')) action(Icons.event_available_rounded, const Color(0xFFD97706), context.t('followup.add'), '/followups/new'),
        if (auth.can('notes:create')) action(Icons.sticky_note_2_outlined, const Color(0xFF7C3AED), context.t('mobile.addNote'), '/clients', subtitle: context.t('mobile.pickRecord')),
        if (auth.can('documents:upload')) action(Icons.upload_file_rounded, const Color(0xFF0891B2), context.t('mobile.uploadDocument'), '/properties', subtitle: context.t('mobile.pickRecord')),
      ]),
    );
  }

  void _go(BuildContext context, String route) {
    Navigator.of(context).pop();
    route == '/clients' || route == '/properties' ? context.go(route) : context.push(route);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: shell,
      floatingActionButton: FloatingActionButton(
        tooltip: context.t('mobile.quickAdd'),
        onPressed: () => _quickAdd(context, ref),
        child: const Icon(Icons.add_rounded, size: 28),
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.7)))),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          animationDuration: const Duration(milliseconds: 450),
          onDestinationSelected: (i) {
            if (i != shell.currentIndex) HapticFeedback.selectionClick();
            shell.goBranch(i, initialLocation: i == shell.currentIndex);
          },
          destinations: [
            NavigationDestination(icon: const Icon(Icons.today_outlined), selectedIcon: const Icon(Icons.today_rounded), label: context.t('mobile.tabs.myDay')),
            NavigationDestination(icon: const Icon(Icons.people_outline_rounded), selectedIcon: const Icon(Icons.people_rounded), label: context.t('mobile.tabs.clients')),
            NavigationDestination(icon: const Icon(Icons.home_work_outlined), selectedIcon: const Icon(Icons.home_work_rounded), label: context.t('mobile.tabs.properties')),
            NavigationDestination(icon: const Icon(Icons.handshake_outlined), selectedIcon: const Icon(Icons.handshake_rounded), label: context.t('mobile.tabs.matches')),
            NavigationDestination(icon: const Icon(Icons.grid_view_outlined), selectedIcon: const Icon(Icons.grid_view_rounded), label: context.t('mobile.tabs.more')),
          ],
        ),
      ),
    );
  }
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final name = auth.user?['fullName'] as String? ?? '';
    Widget tile(IconData icon, Color color, String label, String route) => ListTile(
          leading: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 20),
          ),
          title: Text(label),
          trailing: Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
          onTap: () => context.push(route),
        );
    Widget group(String title, List<Widget> children, int index) => children.isEmpty
        ? const SizedBox.shrink()
        : FadeSlideIn(
            index: index,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 20, 8, 8),
                child: Text(title.toUpperCase(), style: theme.textTheme.labelSmall),
              ),
              AppCard(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) Divider(indent: 66, height: 1, color: scheme.outlineVariant.withValues(alpha: 0.6)),
                    children[i],
                  ],
                ]),
              ),
            ]),
          );
    return Scaffold(
      appBar: AppBar(title: Text(context.t('mobile.tabs.more'))),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 110), children: [
        FadeSlideIn(
          child: AppCard(
            border: false,
            gradient: const LinearGradient(colors: [Brand.gradientFrom, Brand.gradientTo], begin: Alignment.topLeft, end: Alignment.bottomRight),
            padding: const EdgeInsets.all(18),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white.withValues(alpha: 0.5), width: 1.5)),
                child: AppAvatar(name, size: 52),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(
                    auth.business?['name'] as String? ?? context.t('app.name'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(color: Colors.white.withValues(alpha: 0.8)),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(20)),
                    child: Text(
                      context.l10n.enumLabel('role', auth.membership?['role'] as String?),
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
                    ),
                  ),
                ]),
              ),
            ]),
          ),
        ),
        if (ref.watch(branchScopeProvider).hasChoice) ...[
          const SizedBox(height: 10),
          const FadeSlideIn(index: 1, child: AppCard(padding: EdgeInsets.symmetric(vertical: 4), child: BranchSwitcherTile())),
        ],
        group(context.t('mobile.ui.workspace'), [
          tile(Icons.insights_rounded, const Color(0xFF2563EB), context.t('nav.dashboard'), '/dashboard'),
          if (auth.can('owners:read')) tile(Icons.apartment_rounded, const Color(0xFF0D9488), context.t('nav.owners'), '/owners'),
          if (auth.can('followups:read')) tile(Icons.event_note_rounded, const Color(0xFFD97706), context.t('nav.followups'), '/followups'),
          tile(Icons.notifications_rounded, const Color(0xFFE11D48), context.t('nav.notifications'), '/notifications'),
        ], 2),
        group(context.t('mobile.ui.business'), [
          if (auth.can('deals:read')) tile(Icons.handshake_rounded, const Color(0xFF7C3AED), context.t('nav.deals'), '/deals'),
          if (auth.can('agreements:read')) tile(Icons.description_rounded, const Color(0xFF4F46E5), context.t('nav.agreements'), '/agreements'),
          if (auth.can('finance:read')) tile(Icons.account_balance_wallet_rounded, const Color(0xFF059669), context.t('nav.finance'), '/finance'),
        ], 3),
        group(context.t('mobile.ui.app'), [
          if (auth.can('branches:manage') || ref.watch(branchScopeProvider).hasChoice)
            tile(Icons.store_mall_directory_rounded, const Color(0xFF0891B2), context.t('settings.branches'), '/branches'),
          tile(Icons.sync_rounded, const Color(0xFF2563EB), context.t('mobile.sync.title'), '/sync'),
          tile(Icons.settings_rounded, const Color(0xFF64748B), context.t('nav.settings'), '/settings'),
        ], 4),
      ]),
    );
  }
}
