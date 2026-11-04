import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/theme/brand_tokens.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

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
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(color: Colors.amber.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.amber.withValues(alpha: 0.35))),
        child: Row(children: [
          const Icon(Icons.cloud_off_rounded, size: 16, color: Color(0xFFB45309)),
          const SizedBox(width: 8),
          Expanded(child: Text(context.t('mobile.offlineCached', {'time': relativeTime(at, locale: context.l10n.locale.languageCode)}), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500))),
        ]),
      );
}

String _greeting(BuildContext context) {
  final h = DateTime.now().hour;
  return context.t(h < 12 ? 'mobile.ui.greetingMorning' : (h < 17 ? 'mobile.ui.greetingAfternoon' : 'mobile.ui.greetingEvening'));
}

/// Gradient welcome card at the top of My Day.
class _Hero extends ConsumerWidget {
  const _Hero({required this.overdue, required this.today, required this.matches});
  final int overdue;
  final int today;
  final int matches;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final first = ((ref.watch(authProvider).user?['fullName'] as String?) ?? '').split(' ').first;
    final lang = context.l10n.locale.languageCode == 'ur' ? 'ur' : 'en';
    return AppCard(
      border: false,
      padding: EdgeInsets.zero,
      gradient: const LinearGradient(colors: [Brand.gradientFrom, Brand.primary700, Brand.gradientTo], begin: Alignment.topLeft, end: Alignment.bottomRight),
      child: Stack(children: [
        PositionedDirectional(top: -40, end: -30, child: _Glow(160, Colors.white.withValues(alpha: 0.10))),
        PositionedDirectional(bottom: -60, start: -20, child: _Glow(140, Brand.accent.withValues(alpha: 0.18))),
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(DateFormat('EEEE, d MMMM', lang).format(DateTime.now()).toUpperCase(),
                style: theme.textTheme.labelSmall?.copyWith(color: Colors.white.withValues(alpha: 0.75), letterSpacing: 1)),
            const SizedBox(height: 6),
            Text(first.isEmpty ? _greeting(context) : '${_greeting(context)}, $first',
                style: theme.textTheme.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(context.t('mobile.ui.daySummary', {'overdue': overdue, 'today': today, 'matches': matches}),
                style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white.withValues(alpha: 0.85))),
            const SizedBox(height: 16),
            Row(children: [
              _HeroStat(icon: Icons.alarm_rounded, value: overdue, tone: overdue > 0 ? const Color(0xFFFCA5A5) : Colors.white),
              const SizedBox(width: 8),
              _HeroStat(icon: Icons.event_available_rounded, value: today, tone: Colors.white),
              const SizedBox(width: 8),
              _HeroStat(icon: Icons.handshake_rounded, value: matches, tone: const Color(0xFFFCD34D)),
              const Spacer(),
              Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => context.push('/dashboard'),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.insights_rounded, size: 18, color: Brand.primary700),
                      const SizedBox(width: 6),
                      Text(context.t('nav.dashboard'), style: const TextStyle(color: Brand.primary700, fontWeight: FontWeight.w700, fontSize: 13)),
                    ]),
                  ),
                ),
              ),
            ]),
          ]),
        ),
      ]),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow(this.size, this.color);
  final double size;
  final Color color;
  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: Container(width: size, height: size, decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]))),
      );
}

class _HeroStat extends StatelessWidget {
  const _HeroStat({required this.icon, required this.value, required this.tone});
  final IconData icon;
  final int value;
  final Color tone;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10), border: Border.all(color: Colors.white.withValues(alpha: 0.18))),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 15, color: tone),
          const SizedBox(width: 5),
          CountUpText(value, style: TextStyle(color: tone, fontWeight: FontWeight.w800, fontSize: 13)),
        ]),
      );
}

/// Section title with a coloured dot and a count pill.
class _Section extends StatelessWidget {
  const _Section(this.title, this.count, this.color);
  final String title;
  final int count;
  final Color color;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 22, 4, 10),
      child: Row(children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle, boxShadow: [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 6)])),
        const SizedBox(width: 10),
        Flexible(child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2))),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(color: theme.colorScheme.onSurface.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(20)),
          child: Ltr('$count', style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w800, color: theme.colorScheme.onSurface)),
        ),
      ]),
    );
  }
}

class _Calm extends StatelessWidget {
  const _Calm();
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.8)),
      ),
      child: Row(children: [
        const Icon(Icons.check_circle_outline_rounded, size: 18, color: Color(0xFF059669)),
        const SizedBox(width: 10),
        Expanded(child: Text(context.t('myDay.nothing'), style: theme.textTheme.bodySmall)),
      ]),
    );
  }
}

/// Skeleton shaped like the hero + sections while My Day / Dashboard load.
class _DashboardSkeleton extends StatelessWidget {
  const _DashboardSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          const Skeleton(height: 170, radius: 16),
          const SizedBox(height: 20),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.45,
            children: List.generate(4, (_) => const Skeleton(height: 100, radius: 16)),
          ),
          const SizedBox(height: 16),
          const AppLoader(rows: 2),
        ],
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
          IconButton(tooltip: context.t('nav.notifications'), icon: const Icon(Icons.notifications_none_rounded), onPressed: () => context.push('/notifications')),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncEngineProvider).syncNow();
          ref.invalidate(myDayProvider);
        },
        child: async.when(
          loading: () => const _DashboardSkeleton(),
          error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(myDayProvider))]),
          data: (r) {
            final d = r.data;
            List<FollowUp> fu(String k) => ((d[k] as List?) ?? const []).map((e) => FollowUp(Map<String, dynamic>.from(e as Map))).toList();
            final sections = {
              'myDay.overdue': (fu('overdueFollowUps'), const Color(0xFFEF4444)),
              'myDay.todaysFollowUps': (fu('todaysFollowUps'), const Color(0xFFF59E0B)),
              'myDay.meetings': (fu('todaysMeetings'), const Color(0xFF0EA5E9)),
              'myDay.visits': (fu('propertyVisits'), const Color(0xFF8B5CF6)),
            };
            final matches = ((d['newMatches'] as List?) ?? const []).map((e) => Match(Map<String, dynamic>.from(e as Map))).toList();
            final newClients = ((d['newClients'] as List?) ?? const []).cast<Map>();
            final newProperties = ((d['newProperties'] as List?) ?? const []).map((e) => Property(Map<String, dynamic>.from(e as Map))).toList();
            var i = 0;
            Widget anim(Widget w) => FadeSlideIn(index: i++, child: w);
            return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 110), children: [
              if (r.cachedAt != null) _CachedBanner(r.cachedAt!),
              const SizedBox(height: 8),
              anim(_Hero(overdue: sections['myDay.overdue']!.$1.length, today: sections['myDay.todaysFollowUps']!.$1.length, matches: matches.length)),
              const SizedBox(height: 14),
              anim(SizedBox(
                width: double.infinity,
                child: SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [
                    ButtonSegment(value: 'mine', icon: const Icon(Icons.person_rounded, size: 18), label: Text(context.t('myDay.mine'))),
                    ButtonSegment(value: 'all', icon: const Icon(Icons.groups_rounded, size: 18), label: Text(context.t('myDay.everyone'))),
                  ],
                  selected: {scope},
                  onSelectionChanged: (s) => ref.read(myDayScopeProvider.notifier).state = s.first,
                ),
              )),
              for (final e in sections.entries) ...[
                _Section(context.t(e.key), e.value.$1.length, e.value.$2),
                if (e.value.$1.isEmpty)
                  const _Calm()
                else
                  for (final f in e.value.$1)
                    anim(Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: FollowUpCard(
                        followUp: f,
                        propertyLabel: f.property?['propertyId'] as String?,
                        onComplete: () async {
                          final local = await ref.read(crmRepositoryProvider).db.get('followUps', f.serverId ?? f.id);
                          if (local != null) await ref.read(crmRepositoryProvider).completeFollowUp(local.uuid);
                          ref.invalidate(myDayProvider);
                        },
                      ),
                    )),
              ],
              _Section(context.t('myDay.newMatches'), matches.length, const Color(0xFF10B981)),
              if (matches.isEmpty) const _Calm(),
              for (final m in matches) anim(Padding(padding: const EdgeInsets.only(bottom: 10), child: MatchCard(match: m, perspective: 'client'))),
              _Section(context.t('myDay.newClients'), newClients.length, const Color(0xFF2563EB)),
              if (newClients.isEmpty) const _Calm(),
              for (final c in newClients)
                anim(Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: AppCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    onTap: () => context.push('/clients/${c['_id']}'),
                    child: Row(children: [
                      AppAvatar(c['fullName'] as String?, size: 40),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(c['fullName'] as String? ?? '', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 2),
                          Text(formatRange(c['minBudget'] as num?, c['maxBudget'] as num?, urdu: context.l10n.isRtl), style: Theme.of(context).textTheme.bodySmall),
                        ]),
                      ),
                      Icon(Icons.chevron_right_rounded, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ]),
                  ),
                )),
              _Section(context.t('myDay.newProperties'), newProperties.length, const Color(0xFF0D9488)),
              if (newProperties.isEmpty) const _Calm(),
              for (final p in newProperties) anim(Padding(padding: const EdgeInsets.only(bottom: 10), child: PropertyCard(property: p))),
            ]);
          },
        ),
      ),
    );
  }
}

typedef _Kpi = (String key, Object? value, IconData icon, Color color, String? route);

/// Animated KPI tile: gradient icon badge, count-up number, label.
class _KpiTile extends StatelessWidget {
  const _KpiTile(this.kpi);
  final _Kpi kpi;

  @override
  Widget build(BuildContext context) {
    final (key, value, icon, color, route) = kpi;
    final theme = Theme.of(context);
    final style = theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.6);
    final v = value ?? 0;
    return AppCard(
      padding: const EdgeInsets.all(14),
      onTap: route == null ? null : () => context.push(route),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(11),
              gradient: LinearGradient(colors: [color.withValues(alpha: 0.20), color.withValues(alpha: 0.08)], begin: Alignment.topLeft, end: Alignment.bottomRight),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const Spacer(),
          if (route != null) Icon(Icons.arrow_outward_rounded, size: 16, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.6)),
        ]),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: AlignmentDirectional.centerStart,
          child: v is num ? CountUpText(v, style: style) : Ltr('$v', style: style?.copyWith(fontSize: 20)),
        ),
        Text(context.t(key), maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500, height: 1.2)),
      ]),
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
          loading: () => const _DashboardSkeleton(),
          error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(dashboardProvider))]),
          data: (r) {
            final d = r.data;
            final p = Map<String, dynamic>.from(d['properties'] as Map);
            final c = Map<String, dynamic>.from(d['clients'] as Map);
            final f = Map<String, dynamic>.from(d['followUps'] as Map);
            final t = Map<String, dynamic>.from(d['today'] as Map);
            final urdu = context.l10n.isRtl;
            final groups = <(String, List<_Kpi>)>[
              ('mobile.ui.portfolio', [
                ('dashboard.totalProperties', p['total'], Icons.home_work_rounded, const Color(0xFF2563EB), '/properties'),
                ('dashboard.available', p['available'], Icons.check_circle_rounded, const Color(0xFF059669), null),
                ('dashboard.sold', p['sold'], Icons.handshake_rounded, const Color(0xFF4F46E5), null),
                ('dashboard.rented', p['rented'], Icons.key_rounded, const Color(0xFF7C3AED), null),
                ('dashboard.needsVerification', p['needsVerification'] ?? 0, Icons.verified_rounded, const Color(0xFFD97706), '/properties'),
                ('dashboard.newPropertiesToday', t['newProperties'], Icons.add_home_rounded, const Color(0xFF0891B2), null),
              ]),
              ('mobile.ui.clientsGroup', [
                ('dashboard.totalClients', c['total'], Icons.people_rounded, const Color(0xFF2563EB), '/clients'),
                ('dashboard.buyers', c['buyers'], Icons.person_add_alt_1_rounded, const Color(0xFF059669), null),
                ('dashboard.rentalClients', c['rental'], Icons.key_rounded, const Color(0xFF7C3AED), null),
                ('dashboard.owners', c['owners'], Icons.apartment_rounded, const Color(0xFF0D9488), '/owners'),
                ('dashboard.todaysFollowUps', f['today'], Icons.event_available_rounded, const Color(0xFFF59E0B), '/followups'),
                ('dashboard.overdueFollowUps', f['overdue'], Icons.alarm_rounded, const Color(0xFFEF4444), '/followups'),
                ('dashboard.newClientsToday', t['newClients'], Icons.person_add_rounded, const Color(0xFF2563EB), null),
                ('dashboard.newMatchesToday', t['newMatches'], Icons.auto_awesome_rounded, const Color(0xFF10B981), '/matches'),
              ]),
              if (d['deals'] is Map || d['finance'] is Map)
                ('mobile.ui.businessGroup', [
                  if (d['deals'] is Map) ...[
                    ('dashboard.openDeals', (d['deals'] as Map)['open'], Icons.handshake_rounded, const Color(0xFF7C3AED), '/deals'),
                    ('dashboard.dealsWonThisMonth', (d['deals'] as Map)['wonThisMonth'], Icons.emoji_events_rounded, const Color(0xFF059669), '/deals'),
                    ('dashboard.commissionThisMonth', formatPkr((d['deals'] as Map)['receivedThisMonth'] as num?, urdu: urdu), Icons.payments_rounded, const Color(0xFF059669), '/reports/commissions'),
                    ('dashboard.commissionOutstanding', formatPkr((d['deals'] as Map)['outstanding'] as num?, urdu: urdu), Icons.pending_actions_rounded, const Color(0xFFD97706), '/reports/commissions'),
                  ],
                  if (d['finance'] is Map) ...[
                    ('dashboard.incomeThisMonth', formatPkr((d['finance'] as Map)['incomeThisMonth'] as num?, urdu: urdu), Icons.south_west_rounded, const Color(0xFF059669), '/finance'),
                    ('dashboard.expenseThisMonth', formatPkr((d['finance'] as Map)['expenseThisMonth'] as num?, urdu: urdu), Icons.north_east_rounded, const Color(0xFFEF4444), '/finance'),
                    ('dashboard.netThisMonth', formatPkr((d['finance'] as Map)['netThisMonth'] as num?, urdu: urdu), Icons.account_balance_wallet_rounded, const Color(0xFF2563EB), '/finance/report'),
                  ],
                ]),
              if (d['agreements'] is Map)
                ('mobile.ui.agreementsGroup', [
                  ('dashboard.agreementDrafts', (d['agreements'] as Map)['drafts'], Icons.edit_note_rounded, const Color(0xFF64748B), '/agreements'),
                  ('dashboard.agreementsAwaitingSignature', (d['agreements'] as Map)['awaitingSignature'], Icons.draw_rounded, const Color(0xFF2563EB), '/agreements'),
                  ('dashboard.agreementsExpiring', (d['agreements'] as Map)['expiringSoon'], Icons.event_busy_rounded, const Color(0xFFD97706), '/agreements'),
                ]),
            ];
            final categories = ((c['byCategory'] as List?) ?? const []).cast<Map>();
            final maxCat = categories.fold<num>(1, (m, e) => (e['count'] as num? ?? 0) > m ? (e['count'] as num) : m);
            var i = 0;
            return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
              if (r.cachedAt != null) _CachedBanner(r.cachedAt!),
              for (final (title, kpis) in groups) ...[
                SectionHeader(context.t(title)),
                GridView.count(
                  crossAxisCount: MediaQuery.sizeOf(context).width > 600 ? 3 : 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: 1.45,
                  children: [for (final k in kpis) FadeSlideIn(index: i++, child: _KpiTile(k))],
                ),
              ],
              if (categories.isNotEmpty) ...[
                SectionHeader(context.t('dashboard.clientCategories')),
                AppCard(
                  child: Column(children: [
                    for (final cat in categories)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text(cat['name'] as String? ?? '', style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600))),
                            Ltr('${cat['count']}', style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800)),
                          ]),
                          const SizedBox(height: 6),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: (cat['count'] as num? ?? 0) / maxCat),
                              duration: const Duration(milliseconds: 800),
                              curve: Curves.easeOutCubic,
                              builder: (_, v, _) => LinearProgressIndicator(value: v, minHeight: 6),
                            ),
                          ),
                        ]),
                      ),
                  ]),
                ),
              ],
            ]);
          },
        ),
      ),
    );
  }
}
