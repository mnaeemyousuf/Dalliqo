import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';
import 'online_kit.dart';

/// "More actions" for a record — the things only the server can decide, so they need a
/// connection: property verification and listing tools, deal approvals / adjustments / disputes,
/// refunds and vouchers, lease management and installment plan actions.

const _methods = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'JAZZCASH', 'EASYPAISA', 'OTHER'];

Map<String, String> _methodOptions(AppLocalizations l) => {for (final m in _methods) m: l.enumLabel('paymentMethod', m)};

/// App-bar button that opens the tools page of a record (hidden until the record has synced).
class RecordToolsButton extends StatelessWidget {
  const RecordToolsButton({super.key, required this.kind, required this.serverId});
  final String kind; // property | deal | transaction | lease | installment
  final String? serverId;
  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: context.t('mm.tools.title'),
        icon: const Icon(Icons.more_horiz),
        onPressed: () {
          final id = serverId;
          if (id == null) return showMessage(context, context.t('mobile.sync.pending'));
          openPage<void>(context, switch (kind) {
            'property' => PropertyToolsScreen(id: id),
            'deal' => DealToolsScreen(id: id),
            'transaction' => TransactionToolsScreen(id: id),
            'lease' => LeaseToolsScreen(id: id),
            _ => InstallmentToolsScreen(id: id),
          });
        },
      );
}

/// Shared shell: loads the record, rebuilds after every action.
class _Tools extends ConsumerStatefulWidget {
  const _Tools({required this.title, required this.load, required this.builder});
  final String title;
  final Future<Json> Function(WidgetRef ref) load;
  final List<Widget> Function(BuildContext context, WidgetRef ref, Json data, Future<void> Function(Future<Object?> Function() action, {String? done}) run) builder;
  @override
  ConsumerState<_Tools> createState() => _ToolsState();
}

class _ToolsState extends ConsumerState<_Tools> {
  int _version = 0;

  Future<void> _run(Future<Object?> Function() action, {String? done}) async {
    if (await runAction(context, action, done: done) && mounted) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: OnlineView<Json>(
          key: ValueKey(_version),
          load: () => widget.load(ref),
          builder: (context, d, _) => ListView(padding: const EdgeInsets.all(16), children: widget.builder(context, ref, d, _run)),
        ),
      );
}

Future<Map<String, String>> _memberOptions(WidgetRef ref) async {
  final items = (await apiOf(ref).page('/members', query: {'limit': 100})).items;
  return {for (final x in items.where((x) => x['status'] == 'ACTIVE')) str(mapOf(x['user'])['_id']): str(mapOf(x['user'])['fullName'])};
}

// ───────────── Property: verification, quality, description, QR ─────────────

class PropertyToolsScreen extends StatelessWidget {
  const PropertyToolsScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.pt.$k');
    return _Tools(
      title: t('title'),
      load: (ref) async {
        final api = apiOf(ref);
        Future<Json?> soft(Future<Json> f) async {
          try {
            return await f;
          } catch (_) {
            return null; // no permission / not in plan: the section is simply left out
          }
        }

        return {'verification': await soft(api.get<Json>('/properties/$id/verification')), 'quality': await soft(api.get<Json>('/ai/properties/$id/quality'))};
      },
      builder: (context, ref, d, run) {
        final auth = ref.read(authProvider);
        final api = apiOf(ref);
        final v = d['verification'] == null ? null : mapOf(d['verification']);
        final q = d['quality'] == null ? null : mapOf(d['quality']);
        final status = str(v?['status']);
        return [
          if (v != null) ...[
            SectionHeader(l.t('verification.title'), trailing: AppChip(l.t('verification.status.$status'), tone: status == 'APPROVED' ? ChipTone.green : status == 'REJECTED' ? ChipTone.red : ChipTone.amber)),
            Text(l.t('verification.disclaimer'), style: Theme.of(context).textTheme.bodySmall),
            if (str(v['remarks']).isNotEmpty) InfoRow(t('remarks'), str(v['remarks'])),
            if (v['nextVerificationAt'] != null) InfoRow(t('nextCheck'), day(context, v['nextVerificationAt'])),
            for (final c in listOf(v['checklist']))
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(l.t('verification.items.${c['key']}')),
                value: c['done'] == true,
                onChanged: !auth.can('verification:submit') && !auth.can('verification:decide') ? null : (on) => run(() => api.post<Object?>('/properties/$id/verification/checklist', {'key': c['key'], 'done': on == true})),
              ),
            if ((v['missingDocuments'] as List? ?? const []).isNotEmpty) InfoRow(t('missingDocs'), (v['missingDocuments'] as List).map((x) => l.enumLabel('documentCategory', '$x')).join(', ')),
            for (final x in listOf(v['expiringDocuments'])) InfoRow(t('expiring'), '${str(x['fileName'])} · ${day(context, x['expiresAt'])}'),
            Wrap(spacing: 8, runSpacing: 4, children: [
              if (auth.can('verification:submit') && status != 'APPROVED')
                OutlinedButton(
                  onPressed: () async {
                    final note = await promptText(context, title: t('submit'), label: l.t('mm.notes'));
                    if (note != null) await run(() => api.post<Object?>('/properties/$id/verification/submit', {if (note.trim().isNotEmpty) 'note': note.trim()}));
                  },
                  child: Text(t('submit')),
                ),
              if (auth.can('verification:decide'))
                OutlinedButton(
                  onPressed: () async {
                    final members = await _memberOptions(ref);
                    if (!context.mounted) return;
                    final f = await showFormSheet(context, title: t('assign'), fields: [FormFieldSpec('userId', t('officer'), kind: FieldKind.select, required: true, options: members, initial: v['assignedTo'])]);
                    if (f != null) await run(() => api.post<Object?>('/properties/$id/verification/assign', f));
                  },
                  child: Text(t('assign')),
                ),
              if (auth.can('verification:decide') && status != 'NOT_SUBMITTED')
                FilledButton(
                  onPressed: () async {
                    final f = await showFormSheet(context, title: t('decide'), fields: [
                      FormFieldSpec('decision', t('decision'), kind: FieldKind.select, required: true, options: {for (final x in const ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']) x: l.t('verification.status.$x')}),
                      FormFieldSpec('remarks', t('remarks'), kind: FieldKind.multiline),
                      FormFieldSpec('nextVerificationAt', t('nextCheck'), kind: FieldKind.date),
                    ]);
                    if (f != null) await run(() => api.post<Object?>('/properties/$id/verification/decide', f));
                  },
                  child: Text(t('decide')),
                ),
            ]),
            if (listOf(v['history']).isNotEmpty) ...[
              SectionHeader(t('history')),
              for (final h in listOf(v['history'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(l.t('verification.status.${h['status']}')), subtitle: Text([day(context, h['at']), str(h['remarks'])].where((x) => x.isNotEmpty).join(' · '))),
            ],
          ],
          if (q != null) ...[
            SectionHeader(t('quality'), trailing: AppChip('${numOf(q['score']).round()} · ${t('grade${q['grade']}')}', tone: q['grade'] == 'GOOD' ? ChipTone.green : q['grade'] == 'FAIR' ? ChipTone.amber : ChipTone.red)),
            for (final c in listOf(q['checks'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(c['ok'] == true ? Icons.check_circle_outline : Icons.error_outline, color: c['ok'] == true ? Colors.green : Theme.of(context).colorScheme.error), title: Text(l.t('mm.qc.${c['key']}'))),
          ],
          SectionHeader(t('listingTools')),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.auto_awesome_outlined),
            title: Text(t('describe')),
            subtitle: Text(t('describeHint')),
            onTap: () async {
              showMessage(context, l.t('report.generating'));
              try {
                final r = await api.post<Json>('/ai/properties/$id/description', {'language': l.isRtl ? 'ur' : 'en'});
                if (!context.mounted) return;
                final text = '${str(r['headline'])}\n\n${str(r['description'])}';
                await showAppBottomSheet<void>(
                  context,
                  title: t('describe'),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                    SelectableText(text),
                    const SizedBox(height: 8),
                    Text(r['source'] == 'ai' ? t('writtenByAi') : t('writtenByTemplate'), style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 12),
                    AppButton(label: l.t('common.copy'), icon: Icons.copy, onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: text));
                      if (context.mounted) Navigator.pop(context);
                    }),
                  ]),
                );
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            },
          ),
          ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.qr_code_2), title: Text(t('qr')), subtitle: Text(t('qrHint')), onTap: () => shareDownload(context, ref, '/properties/$id/qr', mimeType: 'image/png')),
        ];
      },
    );
  }
}

/// Verification queue (verification officers): listings waiting for a decision.
class VerificationQueueScreen extends ConsumerStatefulWidget {
  const VerificationQueueScreen({super.key});
  @override
  ConsumerState<VerificationQueueScreen> createState() => _QueueState();
}

class _QueueState extends ConsumerState<VerificationQueueScreen> {
  bool _mine = false;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.pt.queue'))),
      body: Column(children: [
        SwitchListTile(title: Text(l.t('mm.pt.mine')), value: _mine, onChanged: (v) => setState(() => _mine = v)),
        Expanded(
          child: OnlineView<List<Json>>(
            key: ValueKey(_mine),
            load: () async => (await apiOf(ref).page('/verifications', query: {'limit': 50, if (_mine) 'mine': 'true'})).items,
            builder: (context, items, _) => items.isEmpty
                ? ListView(children: [AppEmptyState(title: l.t('mm.pt.queueEmpty'), icon: Icons.verified_outlined)])
                : ListView(children: [
                    for (final p in items)
                      ListTile(
                        leading: const Icon(Icons.home_work_outlined),
                        title: Ltr(str(p['propertyId'])),
                        subtitle: Text([str(p['society']), str(p['block']), l.t('verification.status.${mapOf(p['verification'])['status'] ?? 'PENDING'}')].where((x) => x.isNotEmpty).join(' · ')),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => openPage<void>(context, PropertyToolsScreen(id: str(p['_id']))),
                      ),
                  ]),
          ),
        ),
      ]),
    );
  }
}

// ───────────── Deal: checklist, approvals, adjustments, dispute, external shares ─────────────

class DealToolsScreen extends StatelessWidget {
  const DealToolsScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.dt.$k');
    return _Tools(
      title: t('title'),
      load: (ref) => apiOf(ref).get<Json>('/deals/$id'),
      builder: (context, ref, d, run) {
        final auth = ref.read(authProvider);
        final api = apiOf(ref);
        final canEdit = auth.can('deals:update');
        final money_ = auth.can('commissions:manage');
        final approve = auth.can('deals:approve');
        final approval = d['approval'] == null ? null : mapOf(d['approval']);
        final dispute = d['dispute'] == null ? null : mapOf(d['dispute']);
        final disputeOpen = dispute != null && dispute['status'] == 'OPEN';
        return [
          Text('${str(d['dealNo'])} · ${l.enumLabel('dealStage', str(d['stage']))}', style: Theme.of(context).textTheme.titleMedium),
          if (approval != null && approval['status'] == 'PENDING') ...[
            SectionHeader(t('approval')),
            Text(t('approvalPending')),
            if (approve)
              Wrap(spacing: 8, children: [
                FilledButton(onPressed: () => run(() => api.post<Object?>('/deals/$id/approval', {'decision': 'APPROVED'})), child: Text(t('approve'))),
                OutlinedButton(
                  onPressed: () async {
                    final note = await promptText(context, title: t('reject'), label: l.t('mm.notes'));
                    if (note != null) await run(() => api.post<Object?>('/deals/$id/approval', {'decision': 'REJECTED', if (note.trim().isNotEmpty) 'note': note.trim()}));
                  },
                  child: Text(t('reject')),
                ),
              ]),
          ],
          SectionHeader(
            l.t('deal.checklist.title'),
            trailing: !canEdit
                ? null
                : IconButton(
                    icon: const Icon(Icons.add),
                    onPressed: () async {
                      final label = await promptText(context, title: l.t('deal.checklist.add'), label: l.t('common.name'));
                      if (label != null && label.trim().isNotEmpty) await run(() => api.post<Object?>('/deals/$id/checklist', {'key': 'custom_${DateTime.now().millisecondsSinceEpoch}', 'label': label.trim(), 'done': false}));
                    },
                  ),
          ),
          for (final c in listOf(d['checklist']))
            CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(str(c['label']).isNotEmpty ? str(c['label']) : l.t('deal.checklist.items.${c['key']}')),
              value: c['done'] == true,
              onChanged: !canEdit ? null : (on) => run(() => api.post<Object?>('/deals/$id/checklist', {'key': c['key'], 'done': on == true})),
            ),
          if (listOf(d['payouts']).isNotEmpty) ...[
            SectionHeader(t('payouts')),
            for (final p in listOf(d['payouts']))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${money(context, p['amount'])} · ${l.enumLabel('payoutStatus', str(p['status']))}'),
                subtitle: Text(day(context, p['date'] ?? p['createdAt'])),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (approve && p['status'] == 'PENDING') TextButton(onPressed: () => run(() => api.post<Object?>('/deals/$id/payouts/${p['_id']}/approve', const <String, dynamic>{})), child: Text(t('approve'))),
                  if (money_) IconButton(icon: const Icon(Icons.receipt_long_outlined), tooltip: t('voucher'), onPressed: () => shareDownload(context, ref, '/vouchers/payout/$id/${p['_id']}', mimeType: 'application/pdf')),
                ]),
              ),
          ],
          if (listOf(d['payments']).isNotEmpty) ...[
            SectionHeader(t('receipts')),
            for (final p in listOf(d['payments']))
              ListTile(contentPadding: EdgeInsets.zero, title: Text(money(context, p['amount'])), subtitle: Text(day(context, p['date'])), trailing: IconButton(icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => shareDownload(context, ref, '/receipts/deal/$id/${p['_id']}', mimeType: 'application/pdf'))),
          ],
          if (listOf(d['externalShares']).isNotEmpty && money_) ...[
            SectionHeader(l.t('finance5b.externalShares')),
            for (final x in listOf(d['externalShares']))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${str(x['name'])} · ${l.enumLabel('externalShareKind', str(x['kind']))}'),
                subtitle: Text('${t('paid')}: ${money(context, x['paid'])}'),
                trailing: TextButton(
                  onPressed: () async {
                    final f = await showFormSheet(context, title: '${t('pay')} · ${str(x['name'])}', fields: [FormFieldSpec('amount', t('amount'), kind: FieldKind.number, required: true)]);
                    if (f != null) await run(() => api.post<Object?>('/deals/$id/external/${x['_id']}/pay', f));
                  },
                  child: Text(t('pay')),
                ),
              ),
          ],
          if (money_) ...[
            SectionHeader(
              t('adjustments'),
              trailing: IconButton(
                icon: const Icon(Icons.add),
                onPressed: () async {
                  final f = await showFormSheet(context, title: t('adjustments'), note: t('adjustHint'), fields: [FormFieldSpec('amount', t('amount'), kind: FieldKind.number, required: true), FormFieldSpec('reason', t('reason'), kind: FieldKind.multiline, required: true)]);
                  if (f != null) await run(() => api.post<Object?>('/deals/$id/adjustments', {'amount': numOf(f['amount']).round(), 'reason': f['reason']}));
                },
              ),
            ),
            if (listOf(d['adjustments']).isEmpty) Text(t('noAdjustments'), style: Theme.of(context).textTheme.bodySmall),
            for (final a in listOf(d['adjustments'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Ltr(money(context, a['amount'])), subtitle: Text('${str(a['reason'])} · ${day(context, a['at'])}')),
            SectionHeader(t('dispute'), trailing: disputeOpen ? AppChip(t('disputeOpen'), tone: ChipTone.red) : null),
            if (dispute != null) Text([str(dispute['reason']), str(dispute['resolution'])].where((x) => x.isNotEmpty).join('\n')),
            OutlinedButton(
              onPressed: () async {
                final text = await promptText(context, title: disputeOpen ? t('resolveDispute') : t('openDispute'), label: disputeOpen ? t('resolution') : t('reason'), maxLines: 3);
                if (text != null && text.trim().length >= 3) await run(() => api.post<Object?>('/deals/$id/dispute', {'action': disputeOpen ? 'RESOLVE' : 'OPEN', 'text': text.trim()}));
              },
              child: Text(disputeOpen ? t('resolveDispute') : t('openDispute')),
            ),
            if (approve) ...[
              const SizedBox(height: 8),
              OutlinedButton(onPressed: () => run(() => api.post<Object?>('/deals/$id/commission/approve')), child: Text(t('approveCommission'))),
            ],
          ],
        ];
      },
    );
  }
}

// ───────────── Income / expense entry: refund and voucher ─────────────

class TransactionToolsScreen extends StatelessWidget {
  const TransactionToolsScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.tt.$k');
    return _Tools(
      title: t('title'),
      load: (ref) => apiOf(ref).get<Json>('/transactions/$id'),
      builder: (context, ref, d, run) {
        final auth = ref.read(authProvider);
        final left = numOf(d['amount']) - numOf(d['refundedAmount']);
        return [
          StatCard(rows: [(t('amount'), money(context, d['amount'])), (t('refunded'), money(context, d['refundedAmount'])), (l.t('common.date'), day(context, d['date']))]),
          if (d['type'] == 'EXPENSE') AppButton(label: t('voucher'), icon: Icons.receipt_long_outlined, outlined: true, onPressed: () => shareDownload(context, ref, '/vouchers/transaction/$id', mimeType: 'application/pdf')),
          if (d['type'] == 'INCOME' && d['refundOf'] == null && left > 0 && auth.can('finance:create')) ...[
            const SizedBox(height: 8),
            AppButton(
              label: t('refund'),
              icon: Icons.undo,
              outlined: true,
              onPressed: () async {
                final f = await showFormSheet(context, title: t('refund'), note: t('refundHint'), fields: [
                  FormFieldSpec('amount', t('amount'), kind: FieldKind.number, required: true, initial: left),
                  FormFieldSpec('date', l.t('common.date'), kind: FieldKind.date, required: true, initial: DateTime.now().toUtc().toIso8601String()),
                  FormFieldSpec('method', l.t('deal.method'), kind: FieldKind.select, options: _methodOptions(l), initial: 'CASH'),
                  FormFieldSpec('reason', t('reason'), kind: FieldKind.multiline, required: true),
                  FormFieldSpec('reference', l.t('deal.reference')),
                ]);
                if (f != null) await run(() => apiOf(ref).post<Object?>('/transactions/$id/refund', f), done: t('refundDone'));
              },
            ),
          ],
        ];
      },
    );
  }
}

// ───────────── Lease: waive, inspect, renew, end, notices, expenses ─────────────

class LeaseToolsScreen extends StatelessWidget {
  const LeaseToolsScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.lt.$k');
    return _Tools(
      title: t('title'),
      load: (ref) async {
        final api = apiOf(ref);
        final lease = await api.get<Json>('/leases/$id');
        Json expenses = const {};
        try {
          expenses = await api.get<Json>('/leases/$id/expenses');
        } catch (_) {/* finance not visible to this user */}
        return {...lease, '_expenses': expenses};
      },
      builder: (context, ref, d, run) {
        final manage = ref.read(authProvider).can('rentals:manage');
        final api = apiOf(ref);
        final active = d['status'] == 'ACTIVE';
        final items = listOf(d['items'] ?? d['schedule']);
        final unpaid = items.where((i) => numOf(i['amount']) + numOf(i['lateFee']) > numOf(i['paid']) && i['status'] != 'WAIVED').toList();
        final exp = mapOf(d['_expenses']);
        return [
          Text('${str(d['leaseNo'])} · ${l.enumLabel('leaseStatus', str(d['status']))}', style: Theme.of(context).textTheme.titleMedium),
          if (manage && active)
            Wrap(spacing: 8, runSpacing: 4, children: [
              OutlinedButton(
                onPressed: () async {
                  final f = await showFormSheet(context, title: t('renew'), fields: [FormFieldSpec('endDate', t('newEnd'), kind: FieldKind.date, required: true), FormFieldSpec('monthlyRent', t('newRent'), kind: FieldKind.number, initial: d['monthlyRent'])]);
                  if (f != null) await run(() => api.post<Object?>('/leases/$id/renew', f));
                },
                child: Text(t('renew')),
              ),
              OutlinedButton(
                onPressed: () async {
                  final f = await showFormSheet(context, title: t('end'), fields: [
                    FormFieldSpec('status', t('how'), kind: FieldKind.select, required: true, initial: 'ENDED', options: {'ENDED': l.enumLabel('leaseStatus', 'ENDED'), 'TERMINATED': l.enumLabel('leaseStatus', 'TERMINATED')}),
                    FormFieldSpec('date', l.t('common.date'), kind: FieldKind.date, initial: DateTime.now().toUtc().toIso8601String()),
                    FormFieldSpec('reason', t('reason'), kind: FieldKind.multiline),
                    FormFieldSpec('depositRefund', t('depositRefund'), kind: FieldKind.number),
                    FormFieldSpec('relist', t('relist'), kind: FieldKind.toggle, initial: true),
                  ]);
                  if (f != null) await run(() => api.post<Object?>('/leases/$id/end', f));
                },
                child: Text(t('end')),
              ),
              OutlinedButton(
                onPressed: () async {
                  final f = await showFormSheet(context, title: t('inspect'), fields: [
                    FormFieldSpec('date', l.t('common.date'), kind: FieldKind.date, required: true, initial: DateTime.now().toUtc().toIso8601String()),
                    FormFieldSpec('type', l.t('common.type'), kind: FieldKind.select, required: true, initial: 'ROUTINE', options: {for (final x in const ['MOVE_IN', 'ROUTINE', 'MOVE_OUT']) x: l.enumLabel('inspectionType', x)}),
                    FormFieldSpec('condition', t('condition'), kind: FieldKind.select, required: true, initial: 'GOOD', options: {for (final x in const ['EXCELLENT', 'GOOD', 'FAIR', 'POOR']) x: l.enumLabel('propertyCondition', x)}),
                    FormFieldSpec('notes', l.t('mm.notes'), kind: FieldKind.multiline),
                  ]);
                  if (f != null) await run(() => api.post<Object?>('/leases/$id/inspections', f));
                },
                child: Text(t('inspect')),
              ),
              OutlinedButton(
                onPressed: () async {
                  final f = await showFormSheet(context, title: t('notice'), fields: [
                    FormFieldSpec('type', l.t('common.type'), kind: FieldKind.select, required: true, initial: 'GENERAL', options: {for (final x in const ['RENT_REMINDER', 'RENT_INCREASE', 'RENEWAL', 'VACATE', 'MAINTENANCE', 'GENERAL']) x: l.enumLabel('noticeType', x)}),
                    FormFieldSpec('subject', t('subject'), required: true),
                    FormFieldSpec('message', t('message'), kind: FieldKind.multiline, required: true),
                    FormFieldSpec('deliveredVia', t('via'), kind: FieldKind.select, required: true, initial: 'WHATSAPP', options: {for (final x in const ['WHATSAPP', 'PRINTED', 'EMAIL', 'IN_PERSON']) x: l.enumLabel('noticeDelivery', x)}),
                  ]);
                  if (f != null) await run(() => api.post<Object?>('/leases/$id/notices', f));
                },
                child: Text(t('notice')),
              ),
            ]),
          if (manage && unpaid.isNotEmpty) ...[
            SectionHeader(t('unpaid')),
            for (final i in unpaid)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${day(context, i['dueDate'])} · ${money(context, numOf(i['amount']) + numOf(i['lateFee']) - numOf(i['paid']))}'),
                trailing: TextButton(
                  onPressed: () async {
                    final reason = await promptText(context, title: t('waive'), label: t('reason'));
                    if (reason != null && reason.trim().isNotEmpty) await run(() => api.post<Object?>('/leases/$id/waive', {'itemId': i['_id'], 'reason': reason.trim()}));
                  },
                  child: Text(t('waive')),
                ),
              ),
          ],
          if (listOf(d['payments']).isNotEmpty) ...[
            SectionHeader(t('receipts')),
            for (final p in listOf(d['payments']))
              ListTile(contentPadding: EdgeInsets.zero, title: Text(money(context, p['amount'])), subtitle: Text(day(context, p['date'])), trailing: IconButton(icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => shareDownload(context, ref, '/receipts/lease/$id/${p['_id'] ?? p['id']}', mimeType: 'application/pdf'))),
          ],
          if (listOf(d['notices']).isNotEmpty) ...[
            SectionHeader(t('notices')),
            for (final n in listOf(d['notices']))
              ListTile(contentPadding: EdgeInsets.zero, title: Text(str(n['subject'])), subtitle: Text('${l.enumLabel('noticeType', str(n['type']))} · ${day(context, n['date'])}'), trailing: IconButton(icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => shareDownload(context, ref, '/leases/$id/notices/${n['_id']}/pdf', mimeType: 'application/pdf'))),
          ],
          if (listOf(d['inspections']).isNotEmpty) ...[
            SectionHeader(t('inspections')),
            for (final n in listOf(d['inspections'])) ListTile(contentPadding: EdgeInsets.zero, title: Text('${l.enumLabel('inspectionType', str(n['type']))} · ${l.enumLabel('propertyCondition', str(n['condition']))}'), subtitle: Text([day(context, n['date']), str(n['notes'])].where((x) => x.isNotEmpty).join(' · '))),
          ],
          if (listOf(exp['items']).isNotEmpty) ...[
            SectionHeader('${t('expenses')} · ${money(context, exp['total'])}'),
            for (final e in listOf(exp['items'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(str(e['description']).isEmpty ? refName(e['categoryId']) : str(e['description'])), subtitle: Text(day(context, e['date'])), trailing: Ltr(money(context, e['amount']))),
          ],
        ];
      },
    );
  }
}

// ───────────── Installment plan: receipts and cancel ─────────────

class InstallmentToolsScreen extends StatelessWidget {
  const InstallmentToolsScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.it.$k');
    return _Tools(
      title: t('title'),
      load: (ref) => apiOf(ref).get<Json>('/installments/$id'),
      builder: (context, ref, d, run) => [
        Text('${str(d['planNo'])} · ${l.enumLabel('installmentPlanStatus', str(d['status']))}', style: Theme.of(context).textTheme.titleMedium),
        if (listOf(d['payments']).isNotEmpty) ...[
          SectionHeader(l.t('mm.lt.receipts')),
          for (final p in listOf(d['payments']))
            ListTile(contentPadding: EdgeInsets.zero, title: Text(money(context, p['amount'])), subtitle: Text(day(context, p['date'])), trailing: IconButton(icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => shareDownload(context, ref, '/receipts/installment/$id/${p['_id'] ?? p['id']}', mimeType: 'application/pdf'))),
        ],
        if (d['status'] == 'ACTIVE' && ref.read(authProvider).can('finance:update')) ...[
          const SizedBox(height: 12),
          AppButton(
            label: t('cancel'),
            danger: true,
            outlined: true,
            onPressed: () async {
              final reason = await promptText(context, title: t('cancel'), label: l.t('mm.lt.reason'), maxLines: 2);
              if (reason != null && reason.trim().length >= 2) await run(() => apiOf(ref).post<Object?>('/installments/$id/cancel', {'reason': reason.trim()}));
            },
          ),
        ],
      ],
    );
  }
}
