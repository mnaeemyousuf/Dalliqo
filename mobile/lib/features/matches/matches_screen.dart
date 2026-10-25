import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

final matchMinScoreProvider = StateProvider<int?>((ref) => null);

final allMatchesProvider = FutureProvider.autoDispose((ref) {
  ref.watch(entityChangesProvider('clients'));
  ref.watch(entityChangesProvider('properties'));
  return ref.watch(onlineRepositoryProvider).matches(minScore: ref.watch(matchMinScoreProvider));
});

/// Matches are computed by the server's engine; this view groups them either
/// by client (Client → Properties) or by property (Property → Clients).
class MatchesScreen extends ConsumerStatefulWidget {
  const MatchesScreen({super.key});
  @override
  ConsumerState<MatchesScreen> createState() => _MatchesScreenState();
}

class _MatchesScreenState extends ConsumerState<MatchesScreen> {
  String _view = 'client';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final canManage = ref.watch(authProvider).can('matches:manage');
    final minScore = ref.watch(matchMinScoreProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('match.title')),
        actions: [
          PopupMenuButton<int?>(
            icon: Badge(isLabelVisible: minScore != null, child: const Icon(Icons.tune)),
            onSelected: (v) => ref.read(matchMinScoreProvider.notifier).state = v == 0 ? null : v,
            itemBuilder: (_) => [
              PopupMenuItem(value: 0, child: Text(l.t('common.all'))),
              for (final (score, band) in const [(90, 'EXCELLENT'), (80, 'VERY_GOOD'), (70, 'GOOD')]) PopupMenuItem(value: score, child: Text('≥ $score% · ${l.enumLabel('matchBand', band)}')),
            ],
          ),
        ],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'client', label: Text(l.t('match.clientToProperties'))),
              ButtonSegment(value: 'property', label: Text(l.t('match.propertyToClients'))),
            ],
            selected: {_view},
            onSelectionChanged: (s) => setState(() => _view = s.first),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => ref.invalidate(allMatchesProvider),
            child: ref.watch(allMatchesProvider).when(
                  loading: () => const AppLoader(),
                  error: (e, _) => ListView(children: [AppErrorState(error: e, onRetry: () => ref.invalidate(allMatchesProvider))]),
                  data: (r) {
                    if (r.items.isEmpty) return ListView(children: [AppEmptyState(title: l.t('match.noMatches'), hint: l.t('match.noMatchesHint'), icon: Icons.handshake_outlined)]);
                    final groups = <String, List<Match>>{};
                    for (final m in r.items) {
                      final key = _view == 'client' ? m.client['_id'] as String : m.property['_id'] as String;
                      groups.putIfAbsent(key, () => []).add(m);
                    }
                    return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 96), children: [
                      for (final g in groups.values) ...[
                        SectionHeader(_view == 'client'
                            ? (g.first.client['fullName'] as String? ?? '')
                            : '${g.first.property['propertyId'] ?? ''} · ${[g.first.property['block'], g.first.property['society'] ?? g.first.property['area']].whereType<String>().join(', ')}'),
                        for (final m in g)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: MatchCard(
                              match: m,
                              perspective: _view,
                              trailing: !canManage
                                  ? null
                                  : PopupMenuButton<String>(
                                      tooltip: l.t('match.markAs'),
                                      onSelected: (s) async {
                                        try {
                                          await ref.read(onlineRepositoryProvider).setMatchStatus(m.id, s);
                                          ref.invalidate(allMatchesProvider);
                                        } catch (e) {
                                          if (context.mounted) showError(context, e);
                                        }
                                      },
                                      itemBuilder: (_) => [
                                        for (final s in const ['VIEWED', 'SHORTLISTED', 'CONTACTED', 'REJECTED']) PopupMenuItem(value: s, child: Text(l.enumLabel('matchStatus', s))),
                                      ],
                                    ),
                            ),
                          ),
                      ],
                    ]);
                  },
                ),
          ),
        ),
      ]),
    );
  }
}
