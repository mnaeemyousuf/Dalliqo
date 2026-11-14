import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// Rentals need the server (leases are not part of the offline store); a rent payment carries its
/// own id so a retried request is never applied twice.

final _leasesProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, bool>((ref, overdueOnly) async {
  final r = await ref.watch(onlineRepositoryProvider).api.page('/leases', query: {'status': 'ACTIVE', 'limit': 100, if (overdueOnly) 'overdue': 'true'});
  return r.items;
});

final _leaseProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) => ref.watch(onlineRepositoryProvider).api.get<Map<String, dynamic>>('/leases/$id'));

String _name(dynamic v, [String key = 'fullName']) => v is Map ? '${v[key] ?? ''}' : '';

ChipTone _tone(String? s) => switch (s) {
      'PAID' => ChipTone.green,
      'OVERDUE' => ChipTone.red,
      'PARTIAL' => ChipTone.amber,
      'WAIVED' => ChipTone.purple,
      _ => ChipTone.grey,
    };

class RentalsScreen extends ConsumerStatefulWidget {
  const RentalsScreen({super.key});
  @override
  ConsumerState<RentalsScreen> createState() => _RentalsScreenState();
}

class _RentalsScreenState extends ConsumerState<RentalsScreen> {
  bool _overdue = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final async = ref.watch(_leasesProvider(_overdue));
    return Scaffold(
      appBar: AppBar(title: Text(l.t('rental.title'))),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_leasesProvider(_overdue)),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          Wrap(spacing: 8, children: [
            ChoiceChip(label: Text(l.t('rental.allLeases')), selected: !_overdue, onSelected: (_) => setState(() => _overdue = false)),
            ChoiceChip(label: Text(l.t('rental.overdueOnly')), selected: _overdue, onSelected: (_) => setState(() => _overdue = true)),
          ]),
          const SizedBox(height: 12),
          ...async.when(
            loading: () => [const AppLoader(rows: 4)],
            error: (e, _) => [AppErrorState(error: e, onRetry: () => ref.invalidate(_leasesProvider(_overdue)))],
            data: (items) => items.isEmpty
                ? [AppEmptyState(title: l.t('rental.empty'), hint: l.t('rental.emptyHint'), icon: Icons.key_outlined)]
                : [
                    for (final (i, x) in items.indexed)
                      FadeSlideIn(
                        index: i,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AppCard(
                            onTap: () => context.push('/leases/${x['_id']}'),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Ltr('${x['leaseNo']}', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary)),
                                const SizedBox(width: 8),
                                Expanded(child: Text(_name(x['propertyId'], 'propertyId'), overflow: TextOverflow.ellipsis)),
                                if (((x['overdueAmount'] as num?) ?? 0) > 0) AppChip(formatPkr(x['overdueAmount'] as num, urdu: l.isRtl), tone: ChipTone.red),
                              ]),
                              const SizedBox(height: 6),
                              Text(_name(x['tenantId']), style: Theme.of(context).textTheme.titleSmall),
                              Text('${formatPkr(x['monthlyRent'] as num?, urdu: l.isRtl)} · ${l.t('rental.nextDue')}: ${formatDate(parseDate(x['nextDueDate']), locale: l.locale.languageCode)}', style: Theme.of(context).textTheme.bodySmall),
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

class LeaseDetailScreen extends ConsumerWidget {
  const LeaseDetailScreen({super.key, required this.id});
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
          title: Text(l.t('rental.recordRent')),
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
      await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/leases/$id/payments', {
        'id': const Uuid().v4(),
        'amount': value.round(),
        'date': DateTime.now().toUtc().toIso8601String(),
        'method': method,
        if (reference.text.trim().isNotEmpty) 'reference': reference.text.trim(),
      });
      ref.invalidate(_leaseProvider(id));
      if (context.mounted) showMessage(context, l.t('rental.rentRecorded'));
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final canManage = ref.watch(authProvider).can('rentals:manage');
    final async = ref.watch(_leaseProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(async.value?['leaseNo'] as String? ?? l.t('rental.lease'))),
      floatingActionButton: canManage && async.value?['status'] == 'ACTIVE'
          ? FloatingActionButton.extended(
              onPressed: () {
                final s = (async.value!['summary'] as Map?) ?? const {};
                _pay(context, ref, ((s['overdue'] as num?) ?? 0) > 0 ? s['overdue'] as num : (((s['nextDue'] as Map?)?['balance'] as num?) ?? 0));
              },
              icon: const Icon(Icons.payments_outlined),
              label: Text(l.t('rental.recordRent')),
            )
          : null,
      body: async.when(
        loading: () => const AppLoader(),
        error: (e, _) => AppErrorState(error: e, onRetry: () => ref.invalidate(_leaseProvider(id))),
        data: (x) {
          final s = Map<String, dynamic>.from((x['summary'] as Map?) ?? const {});
          final schedule = ((x['schedule'] as List?) ?? const []).cast<Map>();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(_leaseProvider(id)),
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              Text(_name(x['propertyId'], 'propertyId'), style: Theme.of(context).textTheme.titleMedium),
              InfoRow(l.t('rental.tenant'), _name(x['tenantId'])),
              InfoRow(l.t('rental.landlord'), _name(x['landlordId'])),
              InfoRow(l.t('rental.monthlyRent'), formatPkr(x['monthlyRent'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.paid'), formatPkr(s['totalPaid'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.overdue'), formatPkr(s['overdue'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.securityDeposit'), formatPkr(x['securityDeposit'] as num?, urdu: l.isRtl)),
              InfoRow(l.t('rental.period'), '${formatDate(parseDate(x['startDate']), locale: l.locale.languageCode)} – ${formatDate(parseDate(x['endDate']), locale: l.locale.languageCode)}'),
              SectionHeader(l.t('rental.schedule')),
              for (final it in schedule)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Ltr('${it['period']} · ${formatPkr((it['amount'] as num) + ((it['lateFee'] as num?) ?? 0), urdu: l.isRtl)}'),
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
