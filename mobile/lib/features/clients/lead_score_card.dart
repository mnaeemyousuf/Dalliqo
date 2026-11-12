import 'package:flutter/material.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/widgets/app_widgets.dart';

/// Lead score (0–100), temperature and the reasons behind it — computed by the server.
class LeadScoreCard extends StatelessWidget {
  const LeadScoreCard({super.key, required this.client});
  final Client client;

  static const _tone = {'HOT': ChipTone.red, 'WARM': ChipTone.amber, 'COLD': ChipTone.blue};
  static const _color = {'HOT': Color(0xFFEF4444), 'WARM': Color(0xFFF59E0B), 'COLD': Color(0xFF0EA5E9)};

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final theme = Theme.of(context);
    final score = client.leadScore ?? 0;
    final temp = client.temperature ?? 'WARM';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            SizedBox(
              width: 64,
              height: 64,
              child: Stack(alignment: Alignment.center, children: [
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: score / 100),
                  duration: const Duration(milliseconds: 800),
                  curve: Curves.easeOutCubic,
                  builder: (_, v, _) => CircularProgressIndicator(value: v, strokeWidth: 6, color: _color[temp], backgroundColor: theme.colorScheme.outlineVariant.withValues(alpha: 0.5)),
                ),
                Ltr('$score', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              ]),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(l.t('lead.title'), style: theme.textTheme.titleSmall),
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  AppChip(l.enumLabel('leadTemperature', temp), tone: _tone[temp] ?? ChipTone.grey, icon: temp == 'HOT' ? Icons.local_fire_department : null),
                  if (client.buyingTimeline != null) AppChip(l.enumLabel('buyingTimeline', client.buyingTimeline)),
                ]),
                const SizedBox(height: 4),
                Text(
                  client.responseMinutes == null ? l.t('lead.notContactedYet') : l.t('lead.responseTime', {'time': _minutes(client.responseMinutes!)}),
                  style: theme.textTheme.bodySmall,
                ),
              ]),
            ),
          ]),
          const SizedBox(height: 12),
          for (final r in client.leadScoreReasons)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Icon(r['positive'] == true ? Icons.trending_up_rounded : Icons.trending_down_rounded, size: 18, color: r['positive'] == true ? const Color(0xFF10B981) : const Color(0xFFF59E0B)),
                const SizedBox(width: 10),
                Expanded(child: Text(l.t('lead.reasons.${r['code']}'), style: theme.textTheme.bodyMedium)),
                Ltr('${(r['points'] as num? ?? 0).round()} / ${(r['max'] as num? ?? 0).round()}', style: theme.textTheme.labelMedium),
              ]),
            ),
        ]),
      ),
    );
  }

  static String _minutes(int m) => m < 60 ? '$m min' : (m < 1440 ? '${(m / 60).round()} h' : '${(m / 1440).round()} d');
}
