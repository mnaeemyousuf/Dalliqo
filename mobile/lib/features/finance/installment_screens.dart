import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// Installment plans are online-only (like leases); a payment carries its own id so a retried
/// request is never applied twice.

final _plansProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, bool>((ref, overdueOnly) async {
  final r = await ref.watch(onlineRepositoryProvider).api.page('/installments', query: {'status': 'ACTIVE', 'limit': 100, if (overdueOnly) 'overdue': 'true'});
  return r.items;
});

final _planProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(onlineRepositoryProvider).api.get<Map<String, dynamic>>('/installments/$id'));

String _name(dynamic v, [String key = 'fullName']) => v is Map ? '${v[key] ?? ''}' : '';

ChipTone _tone(String? s) => switch (s) {
      'PAID' => ChipTone.green,
      'OVERDUE' => ChipTone.red,
      'PARTIAL' => ChipTone.amber,
      'WAIVED' => ChipTone.purple,
      _ => ChipTone.grey,
    };

class InstallmentsScreen extends ConsumerStatefulWidget {
  const InstallmentsScreen({super.key});
  @override
  ConsumerState<InstallmentsScreen> createState() => _InstallmentsScreenState();
}

class _InstallmentsScreenState extends ConsumerState<InstallmentsScreen> {
  bool _overdue = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final async = ref.watch(_plansProvider(_overdue));
    return Scaffold(
      appBar: AppBar(title: Text(l.t('finance5b.title'))),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_plansProvider(_overdue)),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          Wrap(spacing: 8, children: [
            ChoiceChip(label: Text(l.t('finance5b.allPlans')), selected: !_overdue, onSelected: (_) => setState(() => _overdue = false)),
            ChoiceChip(label: Text(l.t('rental.overdueOnly')), selected: _overdue, onSelected: (_) => setState(() => _overdue = true)),
          ]),
          const SizedBox(height: 12),
          ...async.when(
            loading: () => [const AppLoader(rows: 4)],
            error: (e, _) => [AppErrorState(error: e, onRetry: () => ref.invalidate(_plansProvider(_overdue)))],
            data: (items) => items.isEmpty
                ? [AppEmptyState(title: l.t('finance5b.empty'), hint: l.t('finance5b.emptyHint'), icon: Icons.date_range_outlined)]
                : [
                    for (final (i, x) in items.indexed)
                      FadeSlideIn(
                        index: i,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AppCard(
                            onTap: () => context.push('/installments/${x['_id']}'),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Ltr('${x['planNo']}', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary)),
                                const SizedBox(width: 8),
                                Expanded(child: Text(_name(x['propertyId'], 'propertyId'), overflow: TextOverflow.ellipsis)),
                                if (((x['overdueAmount'] as num?) ?? 0) > 0) AppChip(formatPkr(x['overdueAmount'] as num, urdu: l.isRtl), tone: ChipTone.red),
                              ]),
                              const SizedBox(height: 6),
                              Text(_name(x['clientId']), style: Theme.of(context).textTheme.titleSmall),
                              Text(
                                '${formatPkr(x['paidTotal'] as num?, urdu: l.isRtl)} / ${formatPkr(x['totalAmount'] as num?, urdu: l.isRtl)} · ${l.t('rental.nextDue')}: ${formatDate(parseDate(x['nextDueDate']), locale: l.locale.languageCode)}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ]),
                          ),
                        ),
                      ),
                  ],
          ),
        ]),
      ),
    );
  }
}

class InstallmentDetailScreen extends ConsumerWidget {
  const InstallmentDetailScreen({super.key, required this.id});
  final String id;

  Future<void> _pay(BuildContext context, WidgetRef ref, num suggested) async {
    final l = context.l10n;
    final amount = TextEditingController(text: suggested > 0 ? suggested.round().toString() : '');
    final reference = TextEditingController();
    var method = 'CASH';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(l.t('finance5b.recordPayment')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            AppTextField(label: l.t('rental.amount'), controller: amount, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, helper: l.t('rental.allocationHint')),
            const SizedBox(height: 8),
            AppDropdown<String>(label: l.t('deal.method'), value: method, items: {for (final m in const ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'JAZZCASH', 'EASYPAISA', 'OTHER']) m: l.enumLabel('paymentMethod', m)}, onChanged: (v) => set(() => method = v ?? method)),
            const SizedBox(height: 8),
            AppTextField(label: l.t('deal.reference'), controller: reference),
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
    try {
      await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/installments/$id/payments', {
        'id': const Uuid().v4(),
        'amount': value.round(),
        'date': DateTime.now().toUtc().toIso8601String(),
        'method': method,
        if (reference.text.trim().isNotEmpty) 'reference': reference.text.trim(),
      });
      ref.invalidate(_planProvider(id));
      if (context.mounted) showMessage(context, l.t('finance5b.paymentRecorded'));
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final canPay = ref.watch(authProvider).can('finance:create');
    final async = ref.watch(_planProvider(id));
    return Scaffold(
      appBar: AppBar(title: Ltr(async.value?['planNo'] as String? ?? l.t('finance5b.plan'))),
      floatingActionButton: canPay && async.value?['status'] == 'ACTIVE'
          ? FloatingActionButton.extended(
              onPressed: () {
                final x = async.value!;
                final items = ((x['items'] as List?) ?? const []).cast<Map>();
                final next = items.where((i) => ((i['amount'] as num) - ((i['paid'] as num?) ?? 0)) > 0 && i['status'] != 'WAIVED').firstOrNull;
                final overdue = (x['overdueAmount'] as num?) ?? 0;
                _pay(context, ref, overdue > 0 ? overdue : next == null ? 0 : (next['amount'] as num) - ((next['paid'] as num?) ?? 0));
              },
              icon: const Icon(Icons.payments_outlined),
              label: Text(l.t('finance5b.recordPayment')),
            )
          : null,
      body: async.when(
        loading: () => const AppLoader(),
        error: (e, _) => AppErrorState(error: e, onRetry: () => ref.invalidate(_planProvider(id))),
        data: (x) {
          final items = ((x['items'] as List?) ?? const []).cast<Map>();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(_planProvider(id)),
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              if ((x['title'] as String?)?.isNotEmpty ?? false) Text('${x['title']}', style: Theme.of(context).textTheme.titleMedium),
              InfoRow(l.t('finance5b.buyer'), _name(x['clientId'])),
              InfoRow(l.t('nav.properties'), _name(x['propertyId'], 'propertyId')),
              InfoRow(l.t('finance5b.total'), formatPkr(x['totalAmount'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.paid'), formatPkr(x['paidTotal'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('finance5b.outstanding'), formatPkr(x['outstanding'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.overdue'), formatPkr(x['overdueAmount'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('common.status'), l.enumLabel('installmentPlanStatus', x['status'] as String?)),
              SectionHeader(l.t('finance5b.schedule')),
              for (final it in items)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text('${it['label']} · ${formatPkr(it['amount'] as num, urdu: l.isRtl)}'),
                  subtitle: Text('${l.t('rental.paid')}: ${formatPkr(it['paid'] as num?, urdu: l.isRtl)} · ${formatDate(parseDate(it['dueDate']), locale: l.locale.languageCode)}'),
                  trailing: AppChip(l.enumLabel('rentStatus', it['status'] as String?), tone: _tone(it['status'] as String?)),
                ),
            ]),
          );
        },
      ),
    );
  }
}
