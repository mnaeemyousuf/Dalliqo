import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/commission/commission.dart';
import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../data/repositories.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';

/// Offers / counter-offers and the closing checklist on the deal screen. Both work offline: the
/// full lists go through the sync outbox like payments do.
class NegotiationSection extends ConsumerWidget {
  const NegotiationSection({super.key, required this.deal, required this.canEdit});
  final Deal deal;
  final bool canEdit;

  static const _tone = {'OPEN': ChipTone.blue, 'ACCEPTED': ChipTone.green, 'REJECTED': ChipTone.red, 'COUNTERED': ChipTone.grey, 'WITHDRAWN': ChipTone.grey};

  Future<void> _addOffer(BuildContext context, WidgetRef ref) async {
    final l = context.l10n;
    var party = deal.offers.isNotEmpty && deal.offers.last['party'] == 'BUYER' ? 'SELLER' : 'BUYER';
    final amount = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(l.t('deal.negotiation.record')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            AppDropdown<String>(
              label: l.t('deal.negotiation.party'),
              value: party,
              items: {for (final p in const ['BUYER', 'SELLER']) p: l.t('deal.negotiation.$p')},
              onChanged: (v) => set(() => party = v ?? party),
            ),
            const SizedBox(height: 8),
            AppTextField(label: l.t('deal.negotiation.amount'), controller: amount, keyboardType: TextInputType.number, textDirection: TextDirection.ltr),
            const SizedBox(height: 8),
            AppTextField(label: l.t('common.notes'), controller: note),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
          ],
        ),
      ),
    );
    final value = num.tryParse(amount.text.replaceAll(',', '').trim());
    if (ok != true || value == null || value <= 0) return;
    await ref.read(crmRepositoryProvider).addDealOffer(deal.local!.uuid, party: party, amount: value.round(), note: note.text.trim().isEmpty ? null : note.text.trim());
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final theme = Theme.of(context);
    final repo = ref.read(crmRepositoryProvider);
    final offers = deal.offers.reversed.toList();
    final checklist = deal.checklist.isNotEmpty ? deal.checklist : [for (final k in dealChecklistItems) {'key': k, 'done': false}];
    final done = checklist.where((c) => c['done'] == true).length;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionHeader(
        l.t('deal.negotiation.title'),
        trailing: canEdit && deal.local != null ? TextButton.icon(onPressed: () => _addOffer(context, ref), icon: const Icon(Icons.add), label: Text(l.t('deal.negotiation.record'))) : null,
      ),
      if (deal.initialAskingPrice != null) InfoRow(l.t('deal.negotiation.asking'), formatPkr(deal.initialAskingPrice, urdu: l.isRtl)),
      if (offers.isEmpty) Text(l.t('deal.negotiation.empty'), style: theme.textTheme.bodySmall),
      for (final o in offers)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text(l.t('deal.negotiation.${o['party']}'), style: theme.textTheme.titleSmall),
                const SizedBox(width: 8),
                Ltr(formatPkr(o['amount'] as num?, urdu: l.isRtl), style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
                const Spacer(),
                AppChip(l.t('deal.negotiation.status.${o['status']}'), tone: _tone[o['status']] ?? ChipTone.grey),
              ]),
              if ((o['note'] as String?)?.isNotEmpty ?? false) Padding(padding: const EdgeInsets.only(top: 4), child: Text(o['note'] as String, style: theme.textTheme.bodySmall)),
              if (canEdit && o['status'] == 'OPEN' && deal.local != null)
                Wrap(spacing: 8, children: [
                  TextButton(onPressed: () => repo.respondDealOffer(deal.local!.uuid, o['_id'] as String, 'ACCEPTED'), child: Text(l.t('deal.negotiation.accept'))),
                  TextButton(onPressed: () => repo.respondDealOffer(deal.local!.uuid, o['_id'] as String, 'REJECTED'), child: Text(l.t('deal.negotiation.reject'))),
                ]),
            ]),
          ),
        ),
      SectionHeader(l.t('deal.checklist.title'), trailing: Ltr('$done/${checklist.length}', style: theme.textTheme.labelMedium)),
      ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(value: checklist.isEmpty ? 0 : done / checklist.length, minHeight: 6, color: const Color(0xFF10B981)),
      ),
      const SizedBox(height: 6),
      for (final c in checklist)
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          controlAffinity: ListTileControlAffinity.leading,
          value: c['done'] == true,
          onChanged: canEdit && deal.local != null ? (v) => repo.setDealChecklistItem(deal.local!.uuid, c['key'] as String, v ?? false) : null,
          title: Text((c['label'] as String?) ?? l.t('deal.checklist.items.${c['key']}')),
        ),
    ]);
  }
}
