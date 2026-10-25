import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/router/app_router.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';

final notificationCategoryProvider = StateProvider<String?>((ref) => null);

final notificationsProvider = FutureProvider.autoDispose((ref) => ref.watch(onlineRepositoryProvider).notifications(category: ref.watch(notificationCategoryProvider)));

/// All / Follow-ups / Matches / System, with mark-read and deep links.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final category = ref.watch(notificationCategoryProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('notification.title')),
        actions: [
          IconButton(
            tooltip: l.t('notification.markAllRead'),
            icon: const Icon(Icons.done_all),
            onPressed: () async {
              try {
                await ref.read(onlineRepositoryProvider).markAllRead();
                ref.invalidate(notificationsProvider);
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            },
          ),
        ],
      ),
      body: Column(children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Row(children: [
            for (final c in const [null, 'FOLLOWUP', 'MATCH', 'PROPERTY', 'SYSTEM'])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: ChoiceChip(
                  label: Text(l.t('notification.tabs.${c ?? 'all'}')),
                  selected: category == c,
                  onSelected: (_) => ref.read(notificationCategoryProvider.notifier).state = c,
                ),
              ),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => ref.invalidate(notificationsProvider),
            child: ref.watch(notificationsProvider).when(
                  loading: () => const AppLoader(),
                  error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(notificationsProvider))]),
                  data: (r) => r.items.isEmpty
                      ? ListView(children: [AppEmptyState(title: l.t('notification.empty'), icon: Icons.notifications_none)])
                      : ListView.separated(
                          itemCount: r.items.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final n = r.items[i];
                            return ListTile(
                              leading: Icon(
                                switch (n.category) { 'FOLLOWUP' => Icons.event_available, 'MATCH' => Icons.handshake_outlined, 'PROPERTY' => Icons.home_work_outlined, _ => Icons.info_outline },
                                color: n.read ? Theme.of(context).colorScheme.outline : Theme.of(context).colorScheme.primary,
                              ),
                              title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.normal : FontWeight.w700)),
                              subtitle: Text('${n.body}\n${relativeTime(n.createdAt, locale: l.locale.languageCode)}'),
                              isThreeLine: true,
                              onTap: () async {
                                if (!n.read) {
                                  try {
                                    await ref.read(onlineRepositoryProvider).markRead(n.id);
                                  } catch (_) {}
                                  ref.invalidate(notificationsProvider);
                                }
                                if (n.deepLink != null && context.mounted) context.push(appRouteFor(n.deepLink!));
                              },
                            );
                          },
                        ),
                ),
          ),
        ),
      ]),
    );
  }
}
