import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';

final myDayScopeProvider = StateProvider<String>((ref) => 'mine');

final myDayProvider = FutureProvider.autoDispose((ref) {
  // Re-run when follow-ups change locally or arrive through sync.
  ref.watch(entityChangesProvider('followUps'));
  return ref.watch(onlineRepositoryProvider).myDay(ref.watch(myDayScopeProvider));
});

final dashboardProvider = FutureProvider.autoDispose((ref) {
  ref.watch(entityChangesProvider('properties'));
  ref.watch(entityChangesProvider('clients'));
  return ref.watch(onlineRepositoryProvider).dashboard();
});

class _CachedBanner extends StatelessWidget {
  const _CachedBanner(this.at);
  final DateTime at;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(8),
        color: Colors.amber.withValues(alpha: 0.15),
        child: Text(context.t('mobile.offlineCached', {'time': relativeTime(at, locale: context.l10n.locale.languageCode)}), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12)),
      );
}

/// The daily command centre: today's and overdue follow-ups, meetings,
/// visits and what's new.
class MyDayScreen extends ConsumerWidget {
  const MyDayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myDayProvider);
    final scope = ref.watch(myDayScopeProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(context.t('myDay.title')),
        actions: [
          const SyncIndicator(),
          IconButton(tooltip: context.t('nav.notifications'), icon: const Icon(Icons.notifications_outlined), onPressed: () => context.push('/notifications')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncEngineProvider).syncNow();
          ref.invalidate(myDayProvider);
        },
        child: async.when(
          loading: () => const AppLoader(),
          error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(myDayProvider))]),
          data: (r) {
            final d = r.data;
            List<FollowUp> fu(String k) => ((d[k] as List?) ?? const []).map((e) => FollowUp(Map<String, dynamic>.from(e as Map))).toList();
            final sections = {
              'myDay.overdue': fu('overdueFollowUps'),
              'myDay.todaysFollowUps': fu('todaysFollowUps'),
              'myDay.meetings': fu('todaysMeetings'),
              'myDay.visits': fu('propertyVisits'),
            };
            final matches = ((d['newMatches'] as List?) ?? const []).map((e) => Match(Map<String, dynamic>.from(e as Map))).toList();
            final newClients = ((d['newClients'] as List?) ?? const []).cast<Map>();
            final newProperties = ((d['newProperties'] as List?) ?? const []).map((e) => Property(Map<String, dynamic>.from(e as Map))).toList();
            return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 96), children: [
              if (r.cachedAt != null) _CachedBanner(r.cachedAt!),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: [ButtonSegment(value: 'mine', label: Text(context.t('myDay.mine'))), ButtonSegment(value: 'all', label: Text(context.t('myDay.everyone')))],
                selected: {scope},
                onSelectionChanged: (s) => ref.read(myDayScopeProvider.notifier).state = s.first,
              ),
              for (final e in sections.entries) ...[
                SectionHeader('${context.t(e.key)} (${e.value.length})'),
                if (e.value.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: Text(context.t('myDay.nothing'), style: Theme.of(context).textTheme.bodySmall))
                else
                  for (final f in e.value)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: FollowUpCard(
                        followUp: f,
                        propertyLabel: f.property?['propertyId'] as String?,
                        onComplete: () async {
                          final local = await ref.read(crmRepositoryProvider).db.get('followUps', f.serverId ?? f.id);
                          if (local != null) await ref.read(crmRepositoryProvider).completeFollowUp(local.uuid);
                          ref.invalidate(myDayProvider);
                        },
                      ),
                    ),
              ],
              SectionHeader('${context.t('myDay.newMatches')} (${matches.length})'),
              for (final m in matches) Padding(padding: const EdgeInsets.only(bottom: 8), child: MatchCard(match: m, perspective: 'client')),
              SectionHeader('${context.t('myDay.newClients')} (${newClients.length})'),
              for (final c in newClients)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(c['fullName'] as String? ?? ''),
                  subtitle: Text(formatRange(c['minBudget'] as num?, c['maxBudget'] as num?, urdu: context.l10n.isRtl)),
                  onTap: () => context.push('/clients/${c['_id']}'),
                ),
              SectionHeader('${context.t('myDay.newProperties')} (${newProperties.length})'),
              for (final p in newProperties) Padding(padding: const EdgeInsets.only(bottom: 8), child: PropertyCard(property: p)),
            ]);
          },
        ),
      ),
    );
  }
}

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(title: Text(context.t('dashboard.title'))),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardProvider),
        child: async.when(
          loading: () => const AppLoader(),
          error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(dashboardProvider))]),
          data: (r) {
            final d = r.data;
            final p = Map<String, dynamic>.from(d['properties'] as Map);
            final c = Map<String, dynamic>.from(d['clients'] as Map);
            final f = Map<String, dynamic>.from(d['followUps'] as Map);
            final t = Map<String, dynamic>.from(d['today'] as Map);
            final tiles = <(String, Object?, IconData, Color, String?)>[
              ('dashboard.totalProperties', p['total'], Icons.home_work_outlined, Colors.blue, '/properties'),
              ('dashboard.available', p['available'], Icons.check_circle_outline, Colors.green, null),
              ('dashboard.sold', p['sold'], Icons.handshake_outlined, Colors.indigo, null),
              ('dashboard.rented', p['rented'], Icons.key_outlined, Colors.purple, null),
              ('dashboard.needsVerification', p['needsVerification'] ?? 0, Icons.verified_outlined, Colors.amber, '/properties'),
              ('dashboard.totalClients', c['total'], Icons.people_outline, Colors.blue, '/clients'),
              ('dashboard.buyers', c['buyers'], Icons.person_add_alt, Colors.green, null),
              ('dashboard.rentalClients', c['rental'], Icons.key_outlined, Colors.purple, null),
              ('dashboard.owners', c['owners'], Icons.apartment, Colors.teal, '/owners'),
              ('dashboard.todaysFollowUps', f['today'], Icons.event_available, Colors.orange, '/followups'),
              ('dashboard.overdueFollowUps', f['overdue'], Icons.alarm, Colors.red, '/followups'),
              ('dashboard.newClientsToday', t['newClients'], Icons.person_add_alt, Colors.blue, null),
              ('dashboard.newPropertiesToday', t['newProperties'], Icons.add_home_outlined, Colors.blue, null),
              ('dashboard.newMatchesToday', t['newMatches'], Icons.handshake, Colors.green, '/matches'),
            ];
            return ListView(padding: const EdgeInsets.all(16), children: [
              if (r.cachedAt != null) _CachedBanner(r.cachedAt!),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.6,
                children: [
                  for (final (key, value, icon, color, route) in tiles)
                    AppCard(
                      onTap: route == null ? null : () => context.push(route),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Icon(icon, color: color),
                        Ltr('${value ?? 0}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                        Text(context.t(key), maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
                      ]),
                    ),
                ],
              ),
              SectionHeader(context.t('dashboard.clientCategories')),
              for (final cat in ((c['byCategory'] as List?) ?? const []).cast<Map>())
                ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(cat['name'] as String? ?? ''), trailing: Ltr('${cat['count']}')),
            ]);
          },
        ),
      ),
    );
  }
}
