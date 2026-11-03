import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';

import '../../core/commission/commission.dart';
import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../branches/branch_screens.dart';
import '../common/record_panels.dart';

final _financeTypeProvider = StateProvider<String?>((ref) => null);
final _financeSearchProvider = StateProvider<String>((ref) => '');

final moneyCategoriesProvider = FutureProvider.autoDispose<List<MoneyCategory>>((ref) {
  ref.watch(entityChangesProvider('transactionCategories'));
  return ref.watch(crmRepositoryProvider).moneyCategories();
});

final moneyEntriesProvider = FutureProvider.autoDispose<List<MoneyEntry>>((ref) {
  ref.watch(entityChangesProvider('transactions'));
  return ref.watch(crmRepositoryProvider).moneyEntries(search: ref.watch(_financeSearchProvider), type: ref.watch(_financeTypeProvider));
});

/// Start of the current month (Karachi time, like the server's dashboard tiles).
DateTime monthStart() {
  final pk = DateTime.now().toUtc().add(const Duration(hours: 5));
  return DateTime.utc(pk.year, pk.month).subtract(const Duration(hours: 5));
}

final _thisMonthProvider = FutureProvider.autoDispose<FinanceSummary>((ref) {
  ref.watch(entityChangesProvider('transactions'));
  return ref.watch(crmRepositoryProvider).financeSummary(from: monthStart());
});

String _catLabel(BuildContext context, MoneyEntry e, Map<String, MoneyCategory> cats) {
  final c = cats[e.categoryId];
  if (c != null) return c.label(context.l10n.isRtl);
  return (e.category?['name'] as String?) ?? '—';
}

class FinanceScreen extends ConsumerWidget {
  const FinanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final type = ref.watch(_financeTypeProvider);
    final cats = {for (final c in ref.watch(moneyCategoriesProvider).value ?? const <MoneyCategory>[]) c.id: c};
    final month = ref.watch(_thisMonthProvider).value;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('finance.title')),
        actions: [IconButton(icon: const Icon(Icons.bar_chart), tooltip: l.t('finance.report'), onPressed: () => context.push('/finance/report'))],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(104),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(children: [
              TextField(
                decoration: InputDecoration(hintText: l.t('finance.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
                onChanged: (v) => ref.read(_financeSearchProvider.notifier).state = v,
              ),
              const SizedBox(height: 8),
              SegmentedButton<String?>(
                segments: [
                  ButtonSegment(value: null, label: Text(l.t('common.all'))),
                  ButtonSegment(value: 'INCOME', label: Text(l.enumLabel('transactionType', 'INCOME'))),
                  ButtonSegment(value: 'EXPENSE', label: Text(l.enumLabel('transactionType', 'EXPENSE'))),
                ],
                selected: {type},
                onSelectionChanged: (s) => ref.read(_financeTypeProvider.notifier).state = s.first,
              ),
            ]),
          ),
        ),
      ),
      floatingActionButton: auth.can('finance:create') ? FloatingActionButton(onPressed: () => context.push('/finance/new'), child: const Icon(Icons.add)) : null,
      body: ref.watch(moneyEntriesProvider).when(
            loading: () => const AppLoader(),
            error: (e, _) => AppErrorState(error: e),
            data: (items) => ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              if (month != null)
                AppCard(
                  child: Row(children: [
                    Expanded(child: _Figure(l.t('dashboard.incomeThisMonth'), month.income, Colors.green)),
                    Expanded(child: _Figure(l.t('dashboard.expenseThisMonth'), month.expense, Colors.red)),
                    Expanded(child: _Figure(l.t('dashboard.netThisMonth'), month.net, month.net < 0 ? Colors.red : null)),
                  ]),
                ),
              const SizedBox(height: 8),
              if (items.isEmpty) AppEmptyState(title: l.t('finance.empty'), hint: l.t('finance.emptyHint'), icon: Icons.account_balance_wallet_outlined),
              for (final e in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: AppCard(
                    onTap: () => context.push('/finance/${e.id}'),
                    child: Row(children: [
                      Icon(e.isIncome ? Icons.south_west : Icons.north_east, color: e.isIncome ? Colors.green : Colors.red),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Flexible(child: Text(_catLabel(context, e, cats), style: Theme.of(context).textTheme.titleSmall, overflow: TextOverflow.ellipsis)),
                            const SizedBox(width: 6),
                            SyncBadge(e.syncStatus),
                            if (e.fromCommission) ...[const SizedBox(width: 6), AppChip(l.t('finance.fromCommission'), tone: ChipTone.blue)],
                          ]),
                          Text(
                            [formatDate(e.date, locale: l.locale.languageCode), l.enumLabel('paymentMethod', e.method), if ((e.description ?? '').isNotEmpty) e.description!].join(' · '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ]),
                      ),
                      Ltr('${e.isIncome ? '+' : '−'}${formatPkr(e.amount, urdu: l.isRtl)}', style: TextStyle(fontWeight: FontWeight.w600, color: e.isIncome ? Colors.green : Colors.red)),
                    ]),
                  ),
                ),
            ]),
          ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure(this.label, this.value, this.color);
  final String label;
  final int value;
  final Color? color;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        Ltr(formatPkr(value, urdu: context.l10n.isRtl), style: TextStyle(fontWeight: FontWeight.w700, color: color)),
      ]);
}

/// Entry detail: amounts, links, receipts. Commission income is read-only (it follows its deal payment).
class MoneyEntryScreen extends ConsumerWidget {
  const MoneyEntryScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    ref.watch(entityChangesProvider('transactions'));
    final cats = {for (final c in ref.watch(moneyCategoriesProvider).value ?? const <MoneyCategory>[]) c.id: c};
    return FutureBuilder<MoneyEntry?>(
      future: ref.read(crmRepositoryProvider).moneyEntry(id),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Scaffold(body: AppLoader());
        final e = snap.data;
        if (e == null) return Scaffold(appBar: AppBar(), body: AppEmptyState(title: l.t('common.notFound'), icon: Icons.search_off));
        final editable = !e.fromCommission;
        return Scaffold(
          appBar: AppBar(
            title: Text(l.enumLabel('transactionType', e.type)),
            actions: [
              if (editable && auth.can('finance:update')) IconButton(icon: const Icon(Icons.edit_outlined), tooltip: l.t('common.edit'), onPressed: () => context.push('/finance/${e.id}/edit')),
              if (editable && auth.can('finance:delete'))
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: l.t('common.delete'),
                  onPressed: () async {
                    if (!await confirmDialog(context, title: l.t('finance.deleteTitle'), message: l.t('finance.deleteMessage'))) return;
                    await ref.read(crmRepositoryProvider).deleteMoneyEntry(e.local!.uuid);
                    if (context.mounted) {
                      showMessage(context, l.t('finance.deleted'));
                      context.pop();
                    }
                  },
                ),
            ],
          ),
          body: ListView(padding: const EdgeInsets.all(16), children: [
            Ltr('${e.isIncome ? '+' : '−'}${formatPkr(e.amount, urdu: l.isRtl)}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: e.isIncome ? Colors.green : Colors.red, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            InfoRow(l.t('finance.category'), _catLabel(context, e, cats)),
            InfoRow(l.t('common.date'), formatDate(e.date, locale: l.locale.languageCode)),
            InfoRow(l.t('deal.method'), l.enumLabel('paymentMethod', e.method)),
            if ((e.reference ?? '').isNotEmpty) InfoRow(l.t('deal.reference'), e.reference!),
            if ((e.description ?? '').isNotEmpty) InfoRow(l.t('finance.description'), e.description!),
            if (ref.watch(branchScopeProvider).hasChoice)
              InfoRow(l.t('branch.branch'), ref.watch(branchScopeProvider).branches.where((b) => b.serverId == e.branchId || b.id == e.branchId).firstOrNull?.name ?? '—'),
            if (e.fromCommission) ...[
              const SizedBox(height: 8),
              Text(l.t('finance.commissionNote'), style: Theme.of(context).textTheme.bodySmall),
              if (e.dealId != null) TextButton.icon(icon: const Icon(Icons.handshake_outlined), label: Text(l.t('finance.openDeal')), onPressed: () => context.push('/deals/${e.dealId}')),
            ],
            SectionHeader(l.t('finance.receipts')),
            DocumentsPanel(entityType: 'transaction', serverId: e.serverId),
          ]),
        );
      },
    );
  }
}

class MoneyEntryFormScreen extends ConsumerStatefulWidget {
  const MoneyEntryFormScreen({super.key, this.id, this.type});
  final String? id;
  final String? type;
  @override
  ConsumerState<MoneyEntryFormScreen> createState() => _MoneyEntryFormScreenState();
}

class _MoneyEntryFormScreenState extends ConsumerState<MoneyEntryFormScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _reference = TextEditingController();
  String _type = 'EXPENSE';
  String? _categoryId;
  String _method = 'CASH';
  String? _branchId;
  DateTime _date = DateTime.now();
  MoneyEntry? _editing;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _type = widget.type ?? 'EXPENSE';
    if (widget.id != null) _load();
  }

  Future<void> _load() async {
    final e = await ref.read(crmRepositoryProvider).moneyEntry(widget.id!);
    if (!mounted || e == null) return;
    setState(() {
      _editing = e;
      _type = e.type;
      _categoryId = e.categoryId;
      _method = e.method;
      _branchId = e.branchId;
      _date = e.date.toLocal();
      _amount.text = '${e.amount}';
      _description.text = e.description ?? '';
      _reference.text = e.reference ?? '';
    });
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (!_form.currentState!.validate()) return;
    if (_categoryId == null) return showMessage(context, l.t('common.required'));
    setState(() => _saving = true);
    final fields = <String, dynamic>{
      if (_branchId != null) 'branchId': _branchId,
      'type': _type,
      'categoryId': _categoryId,
      'amount': int.parse(_amount.text.replaceAll(',', '').trim()),
      'date': DateTime(_date.year, _date.month, _date.day, 12).toUtc().toIso8601String(),
      'method': _method,
      'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
      'reference': _reference.text.trim().isEmpty ? null : _reference.text.trim(),
    };
    if (_editing == null) fields.removeWhere((k, v) => v == null);
    try {
      final repo = ref.read(crmRepositoryProvider);
      await (_editing == null ? repo.saveMoneyEntry(fields) : repo.saveMoneyEntry(fields, id: _editing!.local!.uuid));
      if (!mounted) return;
      showMessage(context, l.t(_editing == null ? 'finance.saved' : 'finance.updated'));
      context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final cats = (ref.watch(moneyCategoriesProvider).value ?? const <MoneyCategory>[]).where((c) => c.type == _type).toList();
    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'finance.add' : 'finance.edit'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          BranchDropdown(value: _branchId, onChanged: (v) => setState(() => _branchId = v)),
          SegmentedButton<String>(
            segments: [for (final t in const ['INCOME', 'EXPENSE']) ButtonSegment(value: t, label: Text(l.enumLabel('transactionType', t)))],
            selected: {_type},
            onSelectionChanged: (s) => setState(() {
              _type = s.first;
              _categoryId = null;
            }),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            key: ValueKey('category-$_type'),
            label: l.t('finance.category'),
            value: cats.any((c) => c.id == _categoryId) ? _categoryId : null,
            items: {for (final c in cats) c.id: c.label(l.isRtl)},
            onChanged: (v) => setState(() => _categoryId = v),
          ),
          if (cats.isEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.t('finance.noCategories'), style: Theme.of(context).textTheme.bodySmall)),
          const SizedBox(height: 12),
          AppTextField(
            label: l.t('finance.amount'),
            controller: _amount,
            keyboardType: TextInputType.number,
            validator: (v) => (int.tryParse((v ?? '').replaceAll(',', '').trim()) ?? 0) > 0 ? null : l.t('common.required'),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('deal.method'), value: _method, items: {for (final m in paymentMethods) m: l.enumLabel('paymentMethod', m)}, onChanged: (v) => setState(() => _method = v ?? _method)),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l.t('common.date')),
            subtitle: Text(formatDate(_date, locale: l.locale.languageCode)),
            trailing: const Icon(Icons.calendar_today_outlined),
            onTap: () async {
              final p = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2015), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (p != null) setState(() => _date = p);
            },
          ),
          AppTextField(label: l.t('deal.reference'), controller: _reference),
          const SizedBox(height: 12),
          AppTextField(label: l.t('finance.description'), controller: _description, maxLines: 2),
          const SizedBox(height: 24),
          FilledButton(onPressed: _saving ? null : _save, child: Text(l.t('common.save'))),
        ]),
      ),
    );
  }
}

/// Income / expense summary, computed from the entries on the phone (works offline).
class FinanceReportScreen extends ConsumerStatefulWidget {
  const FinanceReportScreen({super.key});
  @override
  ConsumerState<FinanceReportScreen> createState() => _FinanceReportScreenState();
}

class _FinanceReportScreenState extends ConsumerState<FinanceReportScreen> {
  String _groupBy = 'month';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    ref.watch(entityChangesProvider('transactions'));
    return Scaffold(
      appBar: AppBar(title: Text(l.t('finance.reportTitle'))),
      body: FutureBuilder<FinanceSummary>(
        future: ref.read(crmRepositoryProvider).financeSummary(groupBy: _groupBy),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() {}));
          if (!snap.hasData) return const AppLoader();
          final s = snap.data!;
          return ListView(padding: const EdgeInsets.all(16), children: [
            SegmentedButton<String>(
              segments: [ButtonSegment(value: 'month', label: Text(l.t('deal.byMonth'))), ButtonSegment(value: 'category', label: Text(l.t('finance.byCategory')))],
              selected: {_groupBy},
              onSelectionChanged: (v) => setState(() => _groupBy = v.first),
            ),
            const SizedBox(height: 12),
            InfoRow(l.t('finance.income'), formatPkr(s.income, urdu: l.isRtl)),
            InfoRow(l.t('finance.expense'), formatPkr(s.expense, urdu: l.isRtl)),
            InfoRow(l.t('finance.net'), formatPkr(s.net, urdu: l.isRtl)),
            SectionHeader(_groupBy == 'month' ? l.t('deal.month') : l.t('finance.category')),
            if (s.rows.isEmpty) Text(l.t('finance.empty')),
            for (final r in s.rows)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: _groupBy == 'month' ? Ltr(r.key) : Text(r.category?.label(l.isRtl) ?? '—'),
                subtitle: Ltr('+${formatPkr(r.income, urdu: l.isRtl)}   −${formatPkr(r.expense, urdu: l.isRtl)}'),
                trailing: Ltr(formatPkr(r.net, urdu: l.isRtl), style: TextStyle(fontWeight: FontWeight.w600, color: r.net < 0 ? Colors.red : null)),
              ),
          ]);
        },
      ),
    );
  }
}
