import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

bool _hasAi(WidgetRef ref) => ((ref.watch(authProvider).business?['entitlements'] as Map?)?['modules'] as List?)?.contains('ai') ?? true;

/// Lead brief (online): summary, next step, risks and a WhatsApp message ready to send.
class ClientBriefButton extends ConsumerWidget {
  const ClientBriefButton({super.key, required this.clientServerId, this.phone});

  final String? clientServerId;
  final String? phone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    if (clientServerId == null || !_hasAi(ref) || !ref.watch(authProvider).can('clients:read')) return const SizedBox.shrink();
    return IconButton(
      tooltip: l.t('ai.briefTitle'),
      icon: const Icon(Icons.auto_awesome_outlined),
      onPressed: () async {
        try {
          final b = await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/ai/clients/$clientServerId/brief', {'language': l.isRtl ? 'ur' : 'en'});
          if (!context.mounted) return;
          final message = '${b['message'] ?? ''}';
          await showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            showDragHandle: true,
            builder: (ctx) => SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: SingleChildScrollView(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    Text(l.t('ai.briefTitle'), style: Theme.of(ctx).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text('${b['summary'] ?? ''}'),
                    const SizedBox(height: 8),
                    Text('${l.t('ai.nextAction')}: ${b['nextAction'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    for (final r in (b['risks'] as List? ?? const [])) Padding(padding: const EdgeInsets.only(top: 4), child: Text('⚠ $r', style: TextStyle(color: Colors.amber.shade800))),
                    const SizedBox(height: 12),
                    Text(l.t('ai.suggestedMessage'), style: Theme.of(ctx).textTheme.labelMedium),
                    const SizedBox(height: 4),
                    Container(width: double.infinity, padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Theme.of(ctx).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)), child: Text(message)),
                    const SizedBox(height: 8),
                    Row(children: [
                      TextButton.icon(onPressed: () => Clipboard.setData(ClipboardData(text: message)), icon: const Icon(Icons.copy, size: 18), label: Text(l.t('common.copy'))),
                      const Spacer(),
                      if (phone != null && phone!.isNotEmpty)
                        FilledButton.icon(
                          onPressed: () => launchUrl(Uri.parse('https://wa.me/${phone!.replaceAll(RegExp(r'\D'), '')}?text=${Uri.encodeComponent(message)}'), mode: LaunchMode.externalApplication),
                          icon: const Icon(Icons.chat),
                          label: const Text('WhatsApp'),
                        ),
                    ]),
                    const SizedBox(height: 4),
                    Text(b['source'] == 'ai' ? l.t('ai.sourceAi') : l.t('ai.sourceRules'), style: Theme.of(ctx).textTheme.bodySmall),
                  ]),
                ),
              ),
            ),
          );
        } catch (e) {
          if (context.mounted) showError(context, e);
        }
      },
    );
  }
}

/// Indicative price range from comparable listings (online). Never a valuation.
class PriceEstimateButton extends ConsumerWidget {
  const PriceEstimateButton({super.key, required this.propertyServerId});

  final String? propertyServerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    if (propertyServerId == null || !_hasAi(ref)) return const SizedBox.shrink();
    return IconButton(
      tooltip: l.t('ai.priceTitle'),
      icon: const Icon(Icons.speed_outlined),
      onPressed: () async {
        try {
          final e = await ref.read(onlineRepositoryProvider).api.get<Map<String, dynamic>>('/ai/properties/$propertyServerId/price-estimate');
          if (!context.mounted) return;
          final mid = e['mid'] as num?;
          await showDialog<void>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text(l.t('ai.priceTitle')),
              content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (mid != null) ...[
                  Ltr('${formatPkr(e['low'] as num?, urdu: l.isRtl)} – ${formatPkr(e['high'] as num?, urdu: l.isRtl)}', style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text(l.t('ai.position.${e['position']}')),
                  Text(l.t('ai.confidence.${e['confidence']}')),
                  const SizedBox(height: 6),
                  Text(l.t('ai.basedOn', {'count': e['comparables'], 'sold': e['sold'], 'scope': e['scope']}), style: Theme.of(ctx).textTheme.bodySmall),
                ],
                const SizedBox(height: 6),
                Text('${e['disclaimer'] ?? ''}', style: Theme.of(ctx).textTheme.bodySmall),
              ]),
              actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.t('common.close')))],
            ),
          );
        } catch (err) {
          if (context.mounted) showError(context, err);
        }
      },
    );
  }
}
