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
import '../agreements/agreement_screens.dart';
import '../common/record_panels.dart';

final _dealSearchProvider = StateProvider<String>((ref) => '');
final _dealOpenOnlyProvider = StateProvider<bool>((ref) => true);

final dealsProvider = FutureProvider.autoDispose<List<Deal>>((ref) {
  ref.watch(entityChangesProvider('deals'));
  return ref.watch(crmRepositoryProvider).deals(search: ref.watch(_dealSearchProvider), open: ref.watch(_dealOpenOnlyProvider) ? true : null);
});

ChipTone stageTone(String stage) => switch (stage) {
      'CLOSED_WON' => ChipTone.green,
      'CLOSED_LOST' => ChipTone.red,
      'TOKEN' || 'AGREEMENT' => ChipTone.amber,
      'INQUIRY' => ChipTone.grey,
      _ => ChipTone.blue,
    };

ChipTone commissionTone(String status) => switch (status) {
      'RECEIVED' => ChipTone.green,
      'PARTIALLY_RECEIVED' => ChipTone.amber,
      _ => ChipTone.grey,
    };

String _name(dynamic v) => v is Map ? (v['fullName'] as String? ?? '') : '';

/// Member names (for agents), from the cached members list.
final _membersProvider = FutureProvider.autoDispose<Map<String, String>>((ref) async {
  try {
    final items = await ref.watch(onlineRepositoryProvider).members();
    return {for (final m in items) if (m['user'] is Map) (m['user'] as Map)['_id'] as String: ((m['user'] as Map)['fullName'] as String?) ?? ''};
  } catch (_) {
    return const {};
  }
});

class DealsScreen extends ConsumerWidget {
  const DealsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final openOnly = ref.watch(_dealOpenOnlyProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('deal.title')),
        actions: [
          if (auth.can('reports:read')) IconButton(icon: const Icon(Icons.bar_chart), tooltip: l.t('deal.reportTitle'), onPressed: () => context.push('/reports/commissions')),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(104),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(children: [
              TextField(
                decoration: InputDecoration(hintText: l.t('deal.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
                onChanged: (v) => ref.read(_dealSearchProvider.notifier).state = v,
              ),
              const SizedBox(height: 8),
              SegmentedButton<bool>(
                segments: [ButtonSegment(value: true, label: Text(l.t('deal.board'))), ButtonSegment(value: false, label: Text(l.t('common.all')))],
                selected: {openOnly},
                onSelectionChanged: (s) => ref.read(_dealOpenOnlyProvider.notifier).state = s.first,
              ),
            ]),
          ),
        ),
      ),
      floatingActionButton: auth.can('deals:create') ? FloatingActionButton(onPressed: () => context.push('/deals/new'), child: const Icon(Icons.add)) : null,
      body: ref.watch(dealsProvider).when(
            loading: () => const AppLoader(),
            error: (e, _) => AppErrorState(error: e),
            data: (deals) {
              if (deals.isEmpty) return AppEmptyState(title: l.t('deal.empty'), hint: l.t('deal.emptyHint'), icon: Icons.handshake_outlined);
              // Grouped by stage, in pipeline order.
              final stages = openOnly ? openDealStages : dealStages;
              return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
                for (final stage in stages)
                  if (deals.any((d) => d.stage == stage)) ...[
                    SectionHeader('${l.enumLabel('dealStage', stage)} · ${deals.where((d) => d.stage == stage).length}'),
                    for (final d in deals.where((d) => d.stage == stage)) Padding(padding: const EdgeInsets.only(bottom: 8), child: DealCard(deal: d)),
                  ],
              ]);
            },
          ),
    );
  }
}

class DealCard extends ConsumerWidget {
  const DealCard({super.key, required this.deal});
  final Deal deal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final s = summarizeCommission(deal.json);
    return AppCard(
      onTap: () => context.push('/deals/${deal.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Ltr(deal.dealNo, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(width: 6),
          SyncBadge(deal.syncStatus),
          const Spacer(),
          AppChip(l.enumLabel('commissionStatus', s.status), tone: commissionTone(s.status)),
        ]),
        const SizedBox(height: 4),
        Text(deal.title ?? _name(deal.json['clientId']), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text('${l.t('deal.expected')}: ${formatPkr(s.expected, urdu: l.isRtl)} · ${l.t('deal.outstanding')}: ${formatPkr(s.outstanding, urdu: l.isRtl)}', style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}

class DealDetailScreen extends ConsumerWidget {
  const DealDetailScreen({super.key, required this.id});
  final String id;

  Future<void> _addPayment(BuildContext context, WidgetRef ref, Deal d) async {
    final l = context.l10n;
    var side = 'BUYER';
    var method = 'CASH';
    final amount = TextEditingController();
    final reference = TextEditingController();
    var date = DateTime.now();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(l.t('deal.addPayment')),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              AppDropdown<String>(label: l.t('deal.side'), value: side, items: {for (final s in const ['BUYER', 'SELLER']) s: l.enumLabel('dealSide', s)}, onChanged: (v) => set(() => side = v ?? side)),
              const SizedBox(height: 8),
              AppTextField(label: l.t('deal.amount'), controller: amount, keyboardType: TextInputType.number),
              const SizedBox(height: 8),
              AppDropdown<String>(label: l.t('deal.method'), value: method, items: {for (final m in paymentMethods) m: l.enumLabel('paymentMethod', m)}, onChanged: (v) => set(() => method = v ?? method)),
              const SizedBox(height: 8),
              AppTextField(label: l.t('deal.reference'), controller: reference),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.t('common.date')),
                subtitle: Text(formatDate(date, locale: l.locale.languageCode)),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: () async {
                  final p = await showDatePicker(context: ctx, initialDate: date, firstDate: DateTime(2015), lastDate: DateTime.now().add(const Duration(days: 365)));
                  if (p != null) set(() => date = p);
                },
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
          ],
        ),
      ),
    );
    final value = int.tryParse(amount.text.replaceAll(',', '').trim());
    if (ok != true || value == null || value <= 0) return;
    await ref.read(crmRepositoryProvider).addDealPayment(d.local!.uuid, {
      'side': side,
      'amount': value,
      'date': date.toUtc().toIso8601String(),
      'method': method,
      if (reference.text.trim().isNotEmpty) 'reference': reference.text.trim(),
    });
    if (context.mounted) showMessage(context, l.t('deal.paymentSaved'));
  }

  Future<void> _addPayout(BuildContext context, WidgetRef ref, Deal d, Map<String, String> names) async {
    final l = context.l10n;
    final agents = d.agents.map((a) => JsonModel.refId(a['userId'])!).toList();
    var userId = agents.isEmpty ? null : agents.first;
    final amount = TextEditingController();
    var paid = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(l.t('deal.addPayout')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            AppDropdown<String>(label: l.t('deal.agent'), value: userId, items: {for (final a in agents) a: names[a] ?? _name(d.agents.firstWhere((x) => JsonModel.refId(x['userId']) == a)['userId'])}, onChanged: (v) => set(() => userId = v)),
            const SizedBox(height: 8),
            AppTextField(label: l.t('deal.amount'), controller: amount, keyboardType: TextInputType.number),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('enums.payoutStatus.PAID')), value: paid, onChanged: (v) => set(() => paid = v)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
          ],
        ),
      ),
    );
    final value = int.tryParse(amount.text.replaceAll(',', '').trim());
    if (ok != true || userId == null || value == null || value <= 0) return;
    await ref.read(crmRepositoryProvider).addDealPayout(d.local!.uuid, {
      'userId': userId,
      'amount': value,
      'status': paid ? 'PAID' : 'PENDING',
      if (paid) 'date': DateTime.now().toUtc().toIso8601String(),
    });
    if (context.mounted) showMessage(context, l.t('deal.payoutSaved'));
  }

  Future<void> _setStage(BuildContext context, WidgetRef ref, Deal d, String stage) async {
    final l = context.l10n;
    String? reason;
    if (stage == 'CLOSED_LOST') {
      reason = await promptText(context, title: l.enumLabel('dealStage', stage), label: l.t('deal.lostReason'), maxLines: 3);
      if (reason == null || reason.trim().isEmpty) return;
    }
    await ref.read(crmRepositoryProvider).changeDealStage(d.local!.uuid, stage, by: ref.read(authProvider).userId, lostReason: reason);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('deals'));
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final names = ref.watch(_membersProvider).value ?? const {};
    final repo = ref.watch(crmRepositoryProvider);
    return FutureBuilder<Deal?>(
      future: repo.deal(id),
      builder: (context, snap) {
        if (!snap.hasData) return Scaffold(appBar: AppBar(), body: snap.connectionState == ConnectionState.done ? AppEmptyState(title: l.t('common.notFound')) : const AppLoader());
        final d = snap.data!;
        final s = summarizeCommission(d.json);
        final canMoney = auth.can('commissions:manage');
        final canEdit = auth.can('deals:update');
        String agentName(dynamic v) => names[JsonModel.refId(v)] ?? _name(v);
        return DefaultTabController(
          length: 4,
          child: Scaffold(
            appBar: AppBar(
              title: Ltr(d.dealNo),
              actions: [
                if (canEdit) IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/deals/${d.id}/edit')),
                if (auth.can('deals:delete'))
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      if (await confirmDialog(context, title: l.t('common.areYouSure'), message: l.t('deal.deleteConfirm', {'no': d.dealNo}))) {
                        await repo.deleteDeal(d.local!.uuid);
                        if (context.mounted) context.pop();
                      }
                    },
                  ),
              ],
              bottom: TabBar(tabs: [Tab(text: l.t('deal.commission')), Tab(text: l.t('document.title')), Tab(text: l.t('note.title')), Tab(text: l.t('activity.title'))]),
            ),
            body: TabBarView(children: [
              ListView(padding: const EdgeInsets.all(16), children: [
                Row(children: [AppChip(l.enumLabel('dealStage', d.stage), tone: stageTone(d.stage)), const SizedBox(width: 6), SyncBadge(d.syncStatus)]),
                if (d.title != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(d.title!, style: Theme.of(context).textTheme.titleMedium)),
                const SizedBox(height: 12),
                // Pipeline steps: tap to move the deal (works offline).
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final st in openDealStages)
                    ChoiceChip(label: Text(l.enumLabel('dealStage', st)), selected: d.stage == st, onSelected: canEdit ? (_) => _setStage(context, ref, d, st) : null),
                  ChoiceChip(label: Text(l.enumLabel('dealStage', 'CLOSED_WON')), selected: d.stage == 'CLOSED_WON', onSelected: canEdit ? (_) => _setStage(context, ref, d, 'CLOSED_WON') : null),
                  ChoiceChip(label: Text(l.enumLabel('dealStage', 'CLOSED_LOST')), selected: d.stage == 'CLOSED_LOST', onSelected: canEdit ? (_) => _setStage(context, ref, d, 'CLOSED_LOST') : null),
                ]),
                if (d.lostReason != null && d.stage == 'CLOSED_LOST') Padding(padding: const EdgeInsets.only(top: 6), child: Text('${l.t('deal.lostReason')}: ${d.lostReason}', style: TextStyle(color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 12),
                Row(children: [
                  for (final (label, value) in [(l.t('deal.expected'), s.expected), (l.t('deal.received'), s.received), (l.t('deal.outstanding'), s.outstanding)])
                    Expanded(child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: Theme.of(context).textTheme.bodySmall), Ltr(formatPkr(value, urdu: l.isRtl), style: Theme.of(context).textTheme.titleSmall)]))),
                ]),
                const SizedBox(height: 8),
                InfoRow(l.t('deal.client'), _name(d.json['clientId']).isEmpty ? null : _name(d.json['clientId'])),
                InfoRow(l.t('deal.property'), d.property?['propertyId'] as String?),
                InfoRow(l.t('deal.agreedPrice'), d.agreedPrice == null ? null : formatPkr(d.agreedPrice, urdu: l.isRtl)),
                InfoRow(l.t('deal.finalPrice'), d.finalPrice == null ? null : formatPkr(d.finalPrice, urdu: l.isRtl)),
                InfoRow(l.t('deal.expectedClose'), d.expectedCloseDate == null ? null : formatDate(d.expectedCloseDate, locale: l.locale.languageCode)),
                for (final side in const ['buyer', 'seller'])
                  InfoRow('${l.t('deal.commission')} · ${l.enumLabel('dealSide', side.toUpperCase())}',
                      '${d.term(side)['mode'] == 'PERCENT' ? '${d.term(side)['value']}% = ' : ''}${formatPkr(side == 'buyer' ? s.expectedBuyer : s.expectedSeller, urdu: l.isRtl)}'),
                InfoRow(l.t('common.notes'), d.notes),
                SectionHeader(l.t('deal.agents')),
                for (final a in s.agents)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${agentName(d.agents.firstWhere((x) => JsonModel.refId(x['userId']) == a.userId)['userId'])} · ${a.sharePct}%'),
                    subtitle: Ltr('${l.t('deal.receivedShort')} ${formatPkr(a.received)} · ${l.t('deal.paidOut')} ${formatPkr(a.paidOut)} · ${l.t('deal.owed')} ${formatPkr(a.owed)}'),
                  ),
                SectionHeader(l.t('deal.payments'), trailing: canMoney ? TextButton.icon(onPressed: () => _addPayment(context, ref, d), icon: const Icon(Icons.add), label: Text(l.t('deal.addPayment'))) : null),
                if (d.payments.isEmpty) Text(l.t('deal.noPayments'), style: Theme.of(context).textTheme.bodySmall),
                for (final p in d.payments)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Ltr(formatPkr(p['amount'] as num?, urdu: l.isRtl)),
                    subtitle: Text('${l.enumLabel('dealSide', p['side'] as String?)} · ${l.enumLabel('paymentMethod', p['method'] as String?)} · ${formatDate(parseDate(p['date']), locale: l.locale.languageCode)}'),
                    trailing: canMoney ? IconButton(icon: const Icon(Icons.delete_outline), onPressed: () => repo.removeDealPayment(d.local!.uuid, p['_id'] as String)) : null,
                  ),
                SectionHeader(l.t('deal.payouts'), trailing: canMoney ? TextButton.icon(onPressed: () => _addPayout(context, ref, d, names), icon: const Icon(Icons.add), label: Text(l.t('deal.addPayout'))) : null),
                if (d.payouts.isEmpty) Text(l.t('deal.noPayouts'), style: Theme.of(context).textTheme.bodySmall),
                for (final p in d.payouts)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${names[JsonModel.refId(p['userId'])] ?? ''} · ${formatPkr(p['amount'] as num?, urdu: l.isRtl)}'),
                    subtitle: Text(l.enumLabel('payoutStatus', p['status'] as String?)),
                    trailing: canMoney && p['status'] != 'PAID' ? TextButton(onPressed: () => repo.markDealPayoutPaid(d.local!.uuid, p['_id'] as String), child: Text(l.t('deal.markPaid'))) : null,
                  ),
              ]),
              if (auth.can('agreements:read')) AgreementsPanel(dealId: d.id, clientId: d.clientId, propertyId: d.propertyId, kind: d.stage == 'TOKEN' ? 'TOKEN_RECEIPT' : 'SALE'),
              DocumentsPanel(entityType: 'deal', serverId: d.serverId),
              NotesPanel(entityType: 'deal', entityId: d.id),
              d.serverId == null ? AppEmptyState(title: l.t('mobile.sync.pending')) : ActivityPanel(entityId: d.serverId!),
            ]),
          ),
        );
      },
    );
  }
}

class DealFormScreen extends ConsumerStatefulWidget {
  const DealFormScreen({super.key, this.id, this.clientId, this.propertyId});
  final String? id;
  final String? clientId;
  final String? propertyId;
  @override
  ConsumerState<DealFormScreen> createState() => _DealFormScreenState();
}

class _DealFormScreenState extends ConsumerState<DealFormScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _agreed = TextEditingController();
  final _final = TextEditingController();
  final _notes = TextEditingController();
  final _buyerValue = TextEditingController();
  final _sellerValue = TextEditingController();
  String _buyerMode = 'PERCENT';
  String _sellerMode = 'PERCENT';
  String? _clientId;
  String? _propertyId;
  String? _branchId;
  DateTime? _close;
  List<({String? userId, TextEditingController share})> _agents = [];
  List<Client> _clients = const [];
  List<Property> _properties = const [];
  Deal? _editing;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _clientId = widget.clientId;
    _propertyId = widget.propertyId;
    _agents = [(userId: ref.read(authProvider).userId, share: TextEditingController(text: '100'))];
    _init();
  }

  Future<void> _init() async {
    final repo = ref.read(crmRepositoryProvider);
    final clients = await repo.clients(const ClientFilter(sort: 'name'), limit: 1000);
    final properties = await repo.properties(const PropertyFilter(), limit: 1000);
    Deal? d;
    if (widget.id != null) d = await repo.deal(widget.id!);
    if (!mounted) return;
    setState(() {
      _clients = clients;
      _properties = properties;
      if (d != null) {
        _editing = d;
        _title.text = d.title ?? '';
        _clientId = d.clientId;
        _propertyId = d.propertyId;
        _branchId = d.branchId;
        _agreed.text = d.agreedPrice?.toString() ?? '';
        _final.text = d.finalPrice?.toString() ?? '';
        _notes.text = d.notes ?? '';
        _close = d.expectedCloseDate;
        _buyerMode = d.term('buyer')['mode'] as String? ?? 'PERCENT';
        _sellerMode = d.term('seller')['mode'] as String? ?? 'PERCENT';
        _buyerValue.text = '${d.term('buyer')['value'] ?? ''}';
        _sellerValue.text = '${d.term('seller')['value'] ?? ''}';
        _agents = [for (final a in d.agents) (userId: JsonModel.refId(a['userId']), share: TextEditingController(text: '${a['sharePct']}'))];
      }
    });
  }

  num get _shareSum => _agents.fold<num>(0, (s, a) => s + (num.tryParse(a.share.text) ?? 0));

  Future<void> _save() async {
    final l = context.l10n;
    if (!_form.currentState!.validate()) return;
    if (_clientId == null) return showMessage(context, l.t('common.required'));
    if (!sharesValid(_agents.map((a) => num.tryParse(a.share.text) ?? 0).toList()) || _agents.any((a) => a.userId == null)) return showMessage(context, l.t('errors.INVALID_AGENT_SHARES'));
    setState(() => _saving = true);
    num? n(TextEditingController c) => num.tryParse(c.text.replaceAll(',', '').trim());
    final fields = <String, dynamic>{
      if (_branchId != null) 'branchId': _branchId,
      if (_title.text.trim().isNotEmpty) 'title': _title.text.trim(),
      'clientId': _clientId,
      'propertyId': _propertyId,
      if (n(_agreed) != null) 'agreedPrice': n(_agreed)!.round(),
      if (n(_final) != null) 'finalPrice': n(_final)!.round(),
      'expectedCloseDate': _close?.toUtc().toIso8601String(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      'agents': [for (final a in _agents) {'userId': a.userId, 'sharePct': num.parse(a.share.text)}],
      'commission': {
        if (n(_buyerValue) != null) 'buyer': {'mode': _buyerMode, 'value': n(_buyerValue)},
        if (n(_sellerValue) != null) 'seller': {'mode': _sellerMode, 'value': n(_sellerValue)},
      },
    };
    if ((fields['commission'] as Map).isEmpty) fields.remove('commission');
    if (_editing == null) {
      fields.removeWhere((k, v) => v == null);
    }
    try {
      final repo = ref.read(crmRepositoryProvider);
      final saved = await (_editing == null ? repo.saveDeal(fields) : repo.saveDeal(fields, id: _editing!.local!.uuid));
      if (!mounted) return;
      showMessage(context, l.t(_editing == null ? 'deal.created' : 'deal.updated'));
      _editing == null ? context.pushReplacement('/deals/${saved.id}') : context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final names = ref.watch(_membersProvider).value ?? const {};
    final modes = {for (final m in const ['PERCENT', 'FIXED']) m: l.enumLabel('commissionMode', m)};
    final preview = summarizeCommission({
      'agreedPrice': num.tryParse(_agreed.text),
      'finalPrice': num.tryParse(_final.text),
      'commission': {
        'buyer': {'mode': _buyerMode, 'value': num.tryParse(_buyerValue.text) ?? 0},
        'seller': {'mode': _sellerMode, 'value': num.tryParse(_sellerValue.text) ?? 0},
      },
    });
    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'deal.add' : 'deal.edit'))),
      body: Form(
        key: _form,
        onChanged: () => setState(() {}),
        child: ListView(padding: const EdgeInsets.all(16), children: [
          BranchDropdown(value: _branchId, onChanged: (v) => setState(() => _branchId = v)),
          AppTextField(label: l.t('deal.titleField'), controller: _title, hint: l.t('deal.titlePlaceholder')),
          const SizedBox(height: 12),
          AppDropdown<String>(
            label: l.t('deal.client'),
            value: _clientId,
            items: {for (final c in _clients) c.id: c.fullName, if (_clientId != null && !_clients.any((c) => c.id == _clientId)) _clientId!: _editing == null ? '…' : _name(_editing!.json['clientId'])},
            onChanged: (v) => setState(() => _clientId = v),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            label: l.t('deal.property'),
            value: _propertyId,
            allowEmpty: true,
            items: {for (final p in _properties) p.id: '${p.propertyId ?? '…'} · ${p.location}', if (_propertyId != null && !_properties.any((p) => p.id == _propertyId)) _propertyId!: '…'},
            onChanged: (v) => setState(() => _propertyId = v),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('deal.agreedPrice'), controller: _agreed, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('deal.finalPrice'), controller: _final, keyboardType: TextInputType.number)),
          ]),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l.t('deal.expectedClose')),
            subtitle: Text(_close == null ? '—' : formatDate(_close, locale: l.locale.languageCode)),
            trailing: const Icon(Icons.calendar_today_outlined),
            onTap: () async {
              final p = await showDatePicker(context: context, initialDate: _close ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime.now().add(const Duration(days: 1095)));
              if (p != null) setState(() => _close = p);
            },
          ),
          SectionHeader(l.t('deal.commission')),
          for (final (side, mode, ctrl, setMode) in [
            ('BUYER', _buyerMode, _buyerValue, (String v) => setState(() => _buyerMode = v)),
            ('SELLER', _sellerMode, _sellerValue, (String v) => setState(() => _sellerMode = v)),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(flex: 3, child: AppDropdown<String>(label: l.enumLabel('dealSide', side), value: mode, items: modes, onChanged: (v) => setMode(v ?? mode))),
                const SizedBox(width: 8),
                Expanded(flex: 2, child: AppTextField(label: mode == 'PERCENT' ? '%' : 'PKR', controller: ctrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), hint: mode == 'PERCENT' ? l.t('deal.defaultPct') : null)),
              ]),
            ),
          Text(l.t('deal.expectedPreview', {'amount': formatPkr(preview.expected, urdu: l.isRtl)}), style: Theme.of(context).textTheme.bodySmall),
          SectionHeader(l.t('deal.agents')),
          for (var i = 0; i < _agents.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(
                  flex: 3,
                  child: AppDropdown<String>(
                    label: l.t('deal.agent'),
                    value: _agents[i].userId,
                    items: {...names, if (_agents[i].userId != null && !names.containsKey(_agents[i].userId)) _agents[i].userId!: '…'},
                    onChanged: (v) => setState(() => _agents[i] = (userId: v, share: _agents[i].share)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(child: AppTextField(label: l.t('deal.share'), controller: _agents[i].share, keyboardType: const TextInputType.numberWithOptions(decimal: true))),
                IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: _agents.length == 1 ? null : () => setState(() => _agents.removeAt(i))),
              ]),
            ),
          Row(children: [
            TextButton.icon(onPressed: () => setState(() => _agents.add((userId: null, share: TextEditingController()))), icon: const Icon(Icons.add), label: Text(l.t('deal.addAgent'))),
            const Spacer(),
            Text(l.t('deal.shareTotal', {'total': _shareSum}), style: TextStyle(color: (_shareSum - 100).abs() > 0.01 ? Theme.of(context).colorScheme.error : null)),
          ]),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.notes'), controller: _notes, maxLines: 3),
          const SizedBox(height: 24),
          AppButton(label: l.t('common.save'), loading: _saving, onPressed: _save, expand: true),
        ]),
      ),
    );
  }
}

/// Commission received by month or agent (server report; needs a connection, last result cached).
class CommissionReportScreen extends ConsumerStatefulWidget {
  const CommissionReportScreen({super.key});
  @override
  ConsumerState<CommissionReportScreen> createState() => _CommissionReportScreenState();
}

class _CommissionReportScreenState extends ConsumerState<CommissionReportScreen> {
  String _groupBy = 'month';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('deal.reportTitle'))),
      body: FutureBuilder(
        future: ref.read(onlineRepositoryProvider).commissionReport(groupBy: _groupBy),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() {}));
          if (!snap.hasData) return const AppLoader();
          final d = snap.data!.data;
          final totals = Map<String, dynamic>.from(d['totals'] as Map);
          final rows = (d['rows'] as List).cast<Map>();
          final outstanding = (d['outstanding'] as List).cast<Map>();
          return ListView(padding: const EdgeInsets.all(16), children: [
            if (snap.data!.cachedAt != null) Text(l.t('mobile.offlineCached'), style: Theme.of(context).textTheme.bodySmall),
            SegmentedButton<String>(
              segments: [ButtonSegment(value: 'month', label: Text(l.t('deal.byMonth'))), ButtonSegment(value: 'agent', label: Text(l.t('deal.byAgent')))],
              selected: {_groupBy},
              onSelectionChanged: (s) => setState(() => _groupBy = s.first),
            ),
            const SizedBox(height: 12),
            InfoRow(l.t('deal.expected'), formatPkr(totals['expected'] as num?, urdu: l.isRtl)),
            InfoRow(l.t('deal.received'), formatPkr(totals['received'] as num?, urdu: l.isRtl)),
            InfoRow(l.t('deal.outstanding'), formatPkr(totals['outstanding'] as num?, urdu: l.isRtl)),
            SectionHeader(_groupBy == 'month' ? l.t('deal.month') : l.t('deal.agent')),
            if (rows.isEmpty) Text(l.t('deal.noPayments')),
            for (final r in rows) ListTile(contentPadding: EdgeInsets.zero, title: Ltr('${r['label']}'), trailing: Ltr(formatPkr(r['received'] as num?, urdu: l.isRtl))),
            if (outstanding.isNotEmpty) SectionHeader(l.t('deal.outstandingDeals')),
            for (final o in outstanding)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Ltr('${o['dealNo']}'),
                subtitle: o['title'] == null ? null : Text('${o['title']}'),
                trailing: Ltr(formatPkr(o['outstanding'] as num?, urdu: l.isRtl)),
                onTap: () => context.push('/deals/${o['_id']}'),
              ),
          ]);
        },
      ),
    );
  }
}

/// Deals of a client / property, shown on their detail screens.
class DealsPanel extends ConsumerWidget {
  const DealsPanel({super.key, this.clientId, this.propertyId});
  final String? clientId;
  final String? propertyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('deals'));
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    return FutureBuilder<List<Deal>>(
      future: ref.watch(crmRepositoryProvider).deals(clientId: clientId, propertyId: propertyId),
      builder: (context, snap) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SectionHeader(
          l.t('nav.deals'),
          trailing: auth.can('deals:create')
              ? TextButton.icon(
                  onPressed: () => context.push('/deals/new?${clientId != null ? 'clientId=$clientId' : 'propertyId=$propertyId'}'),
                  icon: const Icon(Icons.add),
                  label: Text(l.t('deal.add')),
                )
              : null,
        ),
        for (final d in snap.data ?? const <Deal>[]) Padding(padding: const EdgeInsets.only(bottom: 8), child: DealCard(deal: d)),
        if ((snap.data ?? const []).isEmpty) Text(l.t('deal.empty'), style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}
