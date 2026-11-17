import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';
import 'online_kit.dart';

/// Bulk actions (assign, change status, delete many clients or properties at once) and the
/// "new lease" / "new installment plan" forms. All work against the server.

const _clientStatuses = ['ACTIVE', 'ON_HOLD', 'CLOSED_WON', 'CLOSED_LOST', 'INACTIVE'];
const _propertyStatuses = ['AVAILABLE', 'RESERVED', 'UNDER_NEGOTIATION', 'ON_HOLD', 'SOLD', 'RENTED', 'EXPIRED', 'WITHDRAWN', 'INACTIVE'];

class BulkActionsScreen extends ConsumerStatefulWidget {
  const BulkActionsScreen({super.key});
  @override
  ConsumerState<BulkActionsScreen> createState() => _BulkState();
}

class _BulkState extends ConsumerState<BulkActionsScreen> {
  String _kind = 'clients';
  String _q = '';
  int _version = 0;
  final _picked = <String>{};

  Future<void> _run(Json body) async {
    final l = context.l10n;
    try {
      final r = await apiOf(ref).post<Json>('/$_kind/bulk', {'ids': _picked.toList(), ...body});
      if (!mounted) return;
      final failed = listOf(r['failed']);
      showMessage(context, failed.isEmpty ? l.t('bulk.done', {'count': numOf(r['done']).toInt()}) : l.t('bulk.partial', {'done': numOf(r['done']).toInt(), 'failed': failed.length, 'reason': str(failed.first['message'])}));
      setState(() {
        _picked.clear();
        _version++;
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _assign() async {
    final l = context.l10n;
    final members = (await apiOf(ref).page('/members', query: {'limit': 100})).items;
    if (!mounted) return;
    final f = await showFormSheet(context, title: l.t('bulk.assign'), fields: [
      FormFieldSpec('user', l.t('bulk.assign'), kind: FieldKind.select, required: true, options: {for (final x in members.where((x) => x['status'] == 'ACTIVE')) str(mapOf(x['user'])['_id']): str(mapOf(x['user'])['fullName'])}),
    ]);
    if (f != null) await _run(_kind == 'clients' ? {'action': 'ASSIGN', 'assignedTo': f['user']} : {'action': 'ASSIGN', 'agentIds': [f['user']]});
  }

  Future<void> _status() async {
    final l = context.l10n;
    final clients = _kind == 'clients';
    final f = await showFormSheet(context, title: l.t('bulk.status'), fields: [
      FormFieldSpec('status', l.t('common.status'), kind: FieldKind.select, required: true, options: {for (final s in clients ? _clientStatuses : _propertyStatuses) s: l.enumLabel(clients ? 'clientStatus' : 'propertyStatus', s)}),
    ]);
    if (f != null) await _run({'action': 'STATUS', 'status': f['status']});
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final clients = _kind == 'clients';
    final canUpdate = auth.can(clients ? 'clients:update' : 'properties:update');
    final canDelete = auth.can(clients ? 'clients:delete' : 'properties:delete');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.bulk.title'))),
      bottomNavigationBar: _picked.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
                child: Row(children: [
                  Expanded(child: Text(l.t('bulk.selected', {'count': _picked.length}), style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (canUpdate && auth.can('members:read')) IconButton(tooltip: l.t('bulk.assign'), icon: const Icon(Icons.person_add_alt), onPressed: _assign),
                  if (canUpdate) IconButton(tooltip: l.t('bulk.status'), icon: const Icon(Icons.swap_horiz), onPressed: _status),
                  if (canDelete)
                    IconButton(
                      tooltip: l.t('common.delete'),
                      icon: Icon(Icons.delete_outline, color: Theme.of(context).colorScheme.error),
                      onPressed: () async {
                        if (await confirmDialog(context, title: l.t('common.areYouSure'), message: l.t('bulk.deleteConfirm', {'count': _picked.length}))) await _run({'action': 'DELETE'});
                      },
                    ),
                  IconButton(tooltip: l.t('bulk.clear'), icon: const Icon(Icons.close), onPressed: () => setState(_picked.clear)),
                ]),
              ),
            ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [ButtonSegment(value: 'clients', label: Text(l.t('nav.clients'))), ButtonSegment(value: 'properties', label: Text(l.t('nav.properties')))],
            selected: {_kind},
            onSelectionChanged: (s) => setState(() {
              _kind = s.first;
              _picked.clear();
            }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: TextField(decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.t('common.search')), textInputAction: TextInputAction.search, onSubmitted: (v) => setState(() => _q = v.trim())),
        ),
        Expanded(
          child: OnlineView<List<Json>>(
            key: ValueKey('$_kind|$_q|$_version'),
            load: () async => (await apiOf(ref).page('/$_kind', query: {'limit': 100, if (_q.isNotEmpty) 'q': _q})).items,
            builder: (context, items, _) => items.isEmpty
                ? ListView(children: [AppEmptyState(title: l.t('common.noResults'), icon: Icons.search_off)])
                : ListView(children: [
                    CheckboxListTile(
                      title: Text(l.t('bulk.selectAll')),
                      value: items.every((x) => _picked.contains(str(x['_id']))),
                      onChanged: (on) => setState(() => on == true ? _picked.addAll(items.map((x) => str(x['_id']))) : _picked.clear()),
                    ),
                    const Divider(height: 1),
                    for (final x in items)
                      CheckboxListTile(
                        value: _picked.contains(str(x['_id'])),
                        onChanged: (on) => setState(() => on == true ? _picked.add(str(x['_id'])) : _picked.remove(str(x['_id']))),
                        title: Text(clients ? str(x['fullName']) : str(x['propertyId']), textDirection: clients ? null : TextDirection.ltr),
                        subtitle: Text(
                          clients
                              ? [str(x['mobileNumber']), l.enumLabel('clientStatus', str(x['status'])), refName(x['assignedTo'])].where((s) => s.isNotEmpty).join(' · ')
                              : [str(x['society']), str(x['block']), l.enumLabel('propertyStatus', str(x['status']))].where((s) => s.isNotEmpty).join(' · '),
                        ),
                      ),
                  ]),
          ),
        ),
      ]),
    );
  }
}

/// Options for a picker: the first 100 records of a list endpoint, labelled by [label].
Future<Map<String, String>> _options(WidgetRef ref, String path, String Function(Json) label, {Map<String, dynamic>? query}) async {
  final items = (await apiOf(ref).page(path, query: {'limit': 100, ...?query})).items;
  return {for (final x in items) str(x['_id']): label(x)};
}

/// New lease (rental agreement). Returns true when one was created.
Future<bool> showNewLeaseForm(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  String t(String k) => l.t('mm.nl.$k');
  try {
    final properties = await _options(ref, '/properties', (x) => '${str(x['propertyId'])} · ${str(x['society'])}', query: {'listingPurpose': 'RENT'});
    final tenants = await _options(ref, '/clients', (x) => '${str(x['fullName'])} · ${str(x['mobileNumber'])}');
    if (!context.mounted) return false;
    final now = DateTime.now().toUtc();
    final f = await showFormSheet(context, title: t('title'), fields: [
      FormFieldSpec('propertyId', l.t('nav.properties'), kind: FieldKind.select, required: true, options: properties),
      FormFieldSpec('tenantId', l.t('rental.tenant'), kind: FieldKind.select, required: true, options: tenants),
      FormFieldSpec('startDate', t('start'), kind: FieldKind.date, required: true, initial: now.toIso8601String()),
      FormFieldSpec('endDate', t('end'), kind: FieldKind.date, required: true, initial: DateTime.utc(now.year + 1, now.month, now.day).toIso8601String()),
      FormFieldSpec('monthlyRent', l.t('rental.monthlyRent'), kind: FieldKind.number, required: true),
      FormFieldSpec('dueDay', t('dueDay'), kind: FieldKind.number, initial: 5),
      FormFieldSpec('securityDeposit', l.t('rental.securityDeposit'), kind: FieldKind.number),
      FormFieldSpec('escalationPct', t('escalation'), kind: FieldKind.number),
      FormFieldSpec('graceDays', t('grace'), kind: FieldKind.number, initial: 5),
      FormFieldSpec('lateFeeType', t('lateFee'), kind: FieldKind.select, initial: 'NONE', options: {for (final x in const ['NONE', 'FIXED', 'PERCENT']) x: l.enumLabel('lateFeeType', x)}),
      FormFieldSpec('lateFeeValue', t('lateFeeValue'), kind: FieldKind.number),
      FormFieldSpec('markRented', t('markRented'), kind: FieldKind.toggle, initial: true),
      FormFieldSpec('notes', l.t('mm.notes'), kind: FieldKind.multiline),
    ]);
    if (f == null || !context.mounted) return false;
    if (f['dueDay'] != null) f['dueDay'] = numOf(f['dueDay']).round();
    if (f['graceDays'] != null) f['graceDays'] = numOf(f['graceDays']).round();
    return await runAction(context, () => apiOf(ref).post<Object?>('/leases', f));
  } catch (e) {
    if (context.mounted) showError(context, e);
    return false;
  }
}

/// New installment plan. Returns true when one was created.
Future<bool> showNewPlanForm(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  String t(String k) => l.t('mm.np.$k');
  try {
    final clients = await _options(ref, '/clients', (x) => '${str(x['fullName'])} · ${str(x['mobileNumber'])}');
    if (!context.mounted) return false;
    final f = await showFormSheet(context, title: t('title'), fields: [
      FormFieldSpec('clientId', l.t('deal.client'), kind: FieldKind.select, required: true, options: clients),
      FormFieldSpec('title', t('planTitle')),
      FormFieldSpec('totalAmount', t('total'), kind: FieldKind.number, required: true),
      FormFieldSpec('bookingAmount', t('booking'), kind: FieldKind.number),
      FormFieldSpec('downPayment', t('down'), kind: FieldKind.number),
      FormFieldSpec('frequency', t('frequency'), kind: FieldKind.select, required: true, initial: 'MONTHLY', options: {for (final x in const ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']) x: t(x)}),
      FormFieldSpec('count', t('count'), kind: FieldKind.number, required: true, initial: 12),
      FormFieldSpec('startDate', t('start'), kind: FieldKind.date, required: true, initial: DateTime.now().toUtc().toIso8601String()),
      FormFieldSpec('graceDays', t('grace'), kind: FieldKind.number, initial: 5),
      FormFieldSpec('notes', l.t('mm.notes'), kind: FieldKind.multiline),
    ]);
    if (f == null || !context.mounted) return false;
    f['count'] = numOf(f['count']).round();
    if (f['graceDays'] != null) f['graceDays'] = numOf(f['graceDays']).round();
    return await runAction(context, () => apiOf(ref).post<Object?>('/installments', f));
  } catch (e) {
    if (context.mounted) showError(context, e);
    return false;
  }
}
