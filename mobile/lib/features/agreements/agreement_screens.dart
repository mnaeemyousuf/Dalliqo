import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

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

final _agreementSearchProvider = StateProvider<String>((ref) => '');
final _agreementStatusProvider = StateProvider<String?>((ref) => null);

final agreementsProvider = FutureProvider.autoDispose<List<Agreement>>((ref) {
  ref.watch(entityChangesProvider('agreements'));
  return ref.watch(crmRepositoryProvider).agreements(search: ref.watch(_agreementSearchProvider), status: ref.watch(_agreementStatusProvider));
});

ChipTone agreementTone(String status) => switch (status) {
      'SIGNED' => ChipTone.green,
      'SENT' => ChipTone.blue,
      'EXPIRED' => ChipTone.amber,
      'CANCELLED' => ChipTone.red,
      _ => ChipTone.grey,
    };

String _name(dynamic v, [String key = 'fullName']) => v is Map ? (v[key] as String? ?? '') : '';

/// The lawyer-review note shown on every agreement screen.
class LawyerNote extends StatelessWidget {
  const LawyerNote({super.key});

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.amber.withValues(alpha: 0.15), border: Border.all(color: Colors.amber.shade700), borderRadius: BorderRadius.circular(10)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.warning_amber_rounded, color: Colors.amber.shade800, size: 20),
        const SizedBox(width: 8),
        Expanded(child: Text(agreementDisclaimer[l.isRtl ? 'ur' : 'en']!, style: Theme.of(context).textTheme.bodySmall)),
      ]),
    );
  }
}

class AgreementCard extends StatelessWidget {
  const AgreementCard({super.key, required this.agreement});
  final Agreement agreement;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final a = agreement;
    return AppCard(
      onTap: () => context.push('/agreements/${a.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Ltr(a.agreementNo, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(width: 6),
          SyncBadge(a.syncStatus),
          const Spacer(),
          AppChip(l.enumLabel('agreementStatus', a.status), tone: agreementTone(a.status)),
        ]),
        const SizedBox(height: 4),
        Text('${l.enumLabel('agreementKind', a.kind)} · ${a.language == 'ur' ? 'اردو' : 'English'}${_name(a.json['clientId']).isNotEmpty ? ' · ${_name(a.json['clientId'])}' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis),
        if (a.endDate != null) Text('${l.t(a.kind == 'RENT' ? 'agreement.endDate' : 'agreement.transferBy')}: ${formatDate(a.endDate!, locale: l.locale.languageCode)}', style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}

class AgreementsScreen extends ConsumerWidget {
  const AgreementsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final status = ref.watch(_agreementStatusProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('agreement.title')),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(104),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(children: [
              TextField(
                decoration: InputDecoration(hintText: l.t('agreement.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
                onChanged: (v) => ref.read(_agreementSearchProvider.notifier).state = v,
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 36,
                child: ListView(scrollDirection: Axis.horizontal, children: [
                  for (final s in const [null, 'DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED'])
                    Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: ChoiceChip(
                        label: Text(s == null ? l.t('common.all') : l.enumLabel('agreementStatus', s)),
                        selected: status == s,
                        onSelected: (_) => ref.read(_agreementStatusProvider.notifier).state = s,
                      ),
                    ),
                ]),
              ),
            ]),
          ),
        ),
      ),
      floatingActionButton: auth.can('agreements:create') ? FloatingActionButton(onPressed: () => context.push('/agreements/new'), child: const Icon(Icons.add)) : null,
      body: ref.watch(agreementsProvider).when(
            loading: () => const AppLoader(),
            error: (e, _) => AppErrorState(error: e),
            data: (items) => ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              const LawyerNote(),
              if (items.isEmpty) AppEmptyState(title: l.t('agreement.empty'), hint: l.t('agreement.emptyHint'), icon: Icons.description_outlined),
              for (final a in items) Padding(padding: const EdgeInsets.only(bottom: 8), child: AgreementCard(agreement: a)),
            ]),
          ),
    );
  }
}

class AgreementDetailScreen extends ConsumerStatefulWidget {
  const AgreementDetailScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<AgreementDetailScreen> createState() => _AgreementDetailScreenState();
}

class _AgreementDetailScreenState extends ConsumerState<AgreementDetailScreen> {
  int? _versionNo;
  bool _busy = false;

  Future<void> _online(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    ref.watch(entityChangesProvider('agreements'));
    return FutureBuilder<Agreement?>(
      future: ref.read(crmRepositoryProvider).agreement(widget.id),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Scaffold(body: AppLoader());
        final a = snap.data;
        if (a == null) return Scaffold(appBar: AppBar(), body: AppEmptyState(title: l.t('common.notFound'), icon: Icons.search_off));
        final versions = a.versions;
        final version = versions.where((v) => v['no'] == _versionNo).firstOrNull ?? a.latestVersion;
        final rent = a.kind == 'RENT';
        final online = ref.read(onlineRepositoryProvider);
        return Scaffold(
          appBar: AppBar(
            title: Ltr(a.agreementNo),
            actions: [
              if (a.serverId != null && version != null)
                IconButton(
                  icon: const Icon(Icons.picture_as_pdf_outlined),
                  tooltip: l.t('agreement.share'),
                  onPressed: _busy
                      ? null
                      : () => _online(() async {
                            final file = await online.agreementPdf(a.serverId!, version: version['no'] as int?);
                            await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/pdf')], text: a.agreementNo));
                          }),
                ),
              if (!a.locked && auth.can('agreements:update')) IconButton(icon: const Icon(Icons.edit_outlined), tooltip: l.t('common.edit'), onPressed: () => context.push('/agreements/${a.id}/edit')),
              if (a.status != 'SIGNED' && auth.can('agreements:delete'))
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: l.t('common.delete'),
                  onPressed: () async {
                    if (!await confirmDialog(context, title: l.t('agreement.deleteTitle'))) return;
                    await ref.read(crmRepositoryProvider).deleteAgreement(a.local!.uuid);
                    if (context.mounted) context.pop();
                  },
                ),
            ],
          ),
          body: ListView(padding: const EdgeInsets.all(16), children: [
            const LawyerNote(),
            Row(children: [
              AppChip(l.enumLabel('agreementStatus', a.status), tone: agreementTone(a.status)),
              const SizedBox(width: 8),
              Expanded(child: Text('${l.enumLabel('agreementKind', a.kind)} · ${a.language == 'ur' ? 'اردو' : 'English'}', overflow: TextOverflow.ellipsis)),
              SyncBadge(a.syncStatus),
            ]),
            const SizedBox(height: 8),
            if ((a.title ?? '').isNotEmpty) InfoRow(l.t('agreement.titleField'), a.title!),
            InfoRow(l.t(rent ? 'agreement.tenant' : 'agreement.buyer'), _name(a.json['clientId']).isEmpty ? '—' : _name(a.json['clientId'])),
            InfoRow(l.t(rent ? 'agreement.landlord' : 'agreement.seller'), _name(a.json['ownerId']).isEmpty ? '—' : _name(a.json['ownerId'])),
            if (a.json['propertyId'] is Map) InfoRow(l.t('deal.property'), _name(a.json['propertyId'], 'propertyId')),
            if (rent) ...[
              InfoRow(l.t('agreement.monthlyRent'), formatPkr(a.monthlyRent, urdu: l.isRtl)),
              InfoRow(l.t('agreement.securityDeposit'), formatPkr(a.securityDeposit, urdu: l.isRtl)),
            ] else ...[
              InfoRow(l.t('agreement.amount'), formatPkr(a.amount, urdu: l.isRtl)),
              InfoRow(l.t('agreement.tokenAmount'), formatPkr(a.tokenAmount, urdu: l.isRtl)),
            ],
            if (a.startDate != null) InfoRow(l.t(rent ? 'agreement.startDate' : 'agreement.agreementDate'), formatDate(a.startDate!, locale: l.locale.languageCode)),
            if (a.endDate != null) InfoRow(l.t(rent ? 'agreement.endDate' : 'agreement.transferBy'), formatDate(a.endDate!, locale: l.locale.languageCode)),
            if (rent && a.renewalCount > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.t('agreement.renewalsPlanned', {'count': '${a.renewalCount}'}), style: Theme.of(context).textTheme.bodySmall)),
            if (auth.can('agreements:update') && a.nextStatuses.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final s in a.nextStatuses)
                  OutlinedButton(
                    onPressed: () async {
                      try {
                        await ref.read(crmRepositoryProvider).changeAgreementStatus(a.local!.uuid, s);
                        if (context.mounted) showMessage(context, l.t('agreement.statusChanged'));
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                    child: Text(l.t('agreement.to.$s')),
                  ),
              ]),
            ],
            SectionHeader(
              version == null ? l.t('agreement.text') : l.t('agreement.versionOf', {'no': '${version['no']}', 'total': '${versions.length}'}),
              trailing: !a.locked && a.serverId != null && auth.can('agreements:update')
                  ? TextButton.icon(
                      icon: const Icon(Icons.refresh),
                      label: Text(l.t('agreement.regenerate')),
                      onPressed: _busy
                          ? null
                          : () => _online(() async {
                                await online.renderAgreement(a.serverId!);
                                await ref.read(syncEngineProvider).syncNow();
                                if (mounted) {
                                  setState(() => _versionNo = null);
                                  showMessage(this.context, l.t('agreement.rendered'));
                                }
                              }),
                    )
                  : null,
            ),
            if (versions.length > 1)
              AppDropdown<int>(
                label: l.t('agreement.version'),
                value: version?['no'] as int?,
                items: {for (final v in versions.reversed) v['no'] as int: 'v${v['no']} · ${l.t('agreement.source.${v['source'] ?? 'RENDER'}')}'},
                onChanged: (v) => setState(() => _versionNo = v),
              ),
            if (version == null)
              Text(a.serverId == null ? l.t('agreement.pendingRender') : l.t('agreement.noTextHint'), style: Theme.of(context).textTheme.bodySmall)
            else
              AppCard(
                child: Directionality(
                  textDirection: a.language == 'ur' ? TextDirection.rtl : TextDirection.ltr,
                  child: SelectableText(version['body'] as String? ?? '', style: TextStyle(height: a.language == 'ur' ? 1.9 : 1.5)),
                ),
              ),
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.t('agreement.onlineOnly'), style: Theme.of(context).textTheme.bodySmall)),
            SectionHeader(l.t('agreement.signedCopy')),
            DocumentsPanel(entityType: 'agreement', serverId: a.serverId),
            NotesPanel(entityType: 'agreement', entityId: a.id),
            a.serverId == null ? AppEmptyState(title: l.t('mobile.sync.pending')) : ActivityPanel(entityId: a.serverId!),
          ]),
        );
      },
    );
  }
}

class AgreementFormScreen extends ConsumerStatefulWidget {
  const AgreementFormScreen({super.key, this.id, this.clientId, this.propertyId, this.dealId, this.kind});
  final String? id;
  final String? clientId;
  final String? propertyId;
  final String? dealId;
  final String? kind;
  @override
  ConsumerState<AgreementFormScreen> createState() => _AgreementFormScreenState();
}

class _AgreementFormScreenState extends ConsumerState<AgreementFormScreen> {
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in const ['title', 'amount', 'tokenAmount', 'monthlyRent', 'securityDeposit', 'clientCnic', 'ownerCnic', 'witness1', 'witness2', 'notes']) k: TextEditingController()};
  String _kind = 'SALE';
  String _language = 'en';
  String? _templateId;
  String? _clientId;
  String? _propertyId;
  String? _ownerId;
  String? _branchId;
  DateTime? _start;
  DateTime? _end;
  List<Client> _clients = const [];
  List<Property> _properties = const [];
  List<Owner> _owners = const [];
  List<AgreementTemplateModel> _templates = const [];
  Agreement? _editing;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _kind = widget.kind ?? 'SALE';
    _clientId = widget.clientId;
    _propertyId = widget.propertyId;
    _init();
  }

  Future<void> _init() async {
    final repo = ref.read(crmRepositoryProvider);
    final clients = await repo.clients(const ClientFilter(sort: 'name'), limit: 1000);
    final properties = await repo.properties(const PropertyFilter(), limit: 1000);
    final owners = await repo.owners(limit: 1000);
    Agreement? a;
    if (widget.id != null) a = await repo.agreement(widget.id!);
    if (!mounted) return;
    setState(() {
      _clients = clients;
      _properties = properties;
      _owners = owners;
      _language = context.l10n.isRtl ? 'ur' : 'en';
      if (a != null) {
        _editing = a;
        _kind = a.kind;
        _language = a.language;
        _templateId = a.templateId;
        _clientId = a.clientId;
        _propertyId = a.propertyId;
        _ownerId = a.ownerId;
        _branchId = a.branchId;
        _start = a.startDate;
        _end = a.endDate;
        for (final k in _c.keys) {
          final v = a.json[k];
          if (v != null) _c[k]!.text = '$v';
        }
      }
    });
    await _loadTemplates();
  }

  Future<void> _loadTemplates() async {
    final t = await ref.read(crmRepositoryProvider).agreementTemplates(kind: _kind, language: _language);
    if (mounted) setState(() => _templates = t);
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (!_form.currentState!.validate()) return;
    if (_clientId == null) return showMessage(context, l.t('common.required'));
    if (_start != null && _end != null && !_end!.isAfter(_start!)) return showMessage(context, l.t('errors.VALIDATION_ERROR'));
    setState(() => _saving = true);
    int? n(String k) => int.tryParse(_c[k]!.text.replaceAll(',', '').trim());
    String? s(String k) => _c[k]!.text.trim().isEmpty ? null : _c[k]!.text.trim();
    final fields = <String, dynamic>{
      if (_branchId != null) 'branchId': _branchId,
      'kind': _kind,
      'language': _language,
      'templateId': _templateId,
      'title': s('title'),
      'clientId': _clientId,
      'propertyId': _propertyId,
      'ownerId': _ownerId,
      'amount': n('amount'),
      'tokenAmount': n('tokenAmount'),
      'monthlyRent': n('monthlyRent'),
      'securityDeposit': n('securityDeposit'),
      'startDate': _start?.toUtc().toIso8601String(),
      'endDate': _end?.toUtc().toIso8601String(),
      'clientCnic': s('clientCnic'),
      'ownerCnic': s('ownerCnic'),
      'witness1': s('witness1'),
      'witness2': s('witness2'),
      'notes': s('notes'),
      if (_editing == null && widget.dealId != null) 'dealId': widget.dealId,
    };
    if (_editing == null) fields.removeWhere((k, v) => v == null);
    // Text fields are cleared with an empty value the API ignores; ids and numbers with null.
    if (_editing != null) fields.removeWhere((k, v) => v == null && const ['title', 'clientCnic', 'ownerCnic', 'witness1', 'witness2', 'notes'].contains(k));
    try {
      final repo = ref.read(crmRepositoryProvider);
      final saved = await (_editing == null ? repo.saveAgreement(fields) : repo.saveAgreement(fields, id: _editing!.local!.uuid));
      if (!mounted) return;
      showMessage(context, l.t(_editing == null ? 'agreement.created' : 'agreement.updated'));
      _editing == null ? context.pushReplacement('/agreements/${saved.id}') : context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _date(String label, DateTime? value, ValueChanged<DateTime?> onChanged) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        subtitle: Text(value == null ? '—' : formatDate(value, locale: context.l10n.locale.languageCode)),
        trailing: const Icon(Icons.calendar_today_outlined),
        onTap: () async {
          final p = await showDatePicker(context: context, initialDate: value ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime.now().add(const Duration(days: 365 * 10)));
          if (p != null) onChanged(p);
        },
      );

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final rent = _kind == 'RENT';
    Widget field(String k, String label, {bool number = false, String? hint}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: AppTextField(label: label, controller: _c[k]!, hint: hint, keyboardType: number ? TextInputType.number : null),
        );
    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'agreement.add' : 'agreement.edit'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const LawyerNote(),
          BranchDropdown(value: _branchId, onChanged: (v) => setState(() => _branchId = v)),
          AppDropdown<String>(
            label: l.t('agreement.kind'),
            value: _kind,
            items: {for (final k in agreementKinds) k: l.enumLabel('agreementKind', k)},
            onChanged: (v) {
              setState(() {
                _kind = v ?? _kind;
                _templateId = null;
              });
              _loadTemplates();
            },
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            label: l.t('agreement.language'),
            value: _language,
            items: const {'en': 'English', 'ur': 'اردو'},
            onChanged: (v) {
              setState(() {
                _language = v ?? _language;
                _templateId = null;
              });
              _loadTemplates();
            },
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            key: ValueKey('tpl-$_kind-$_language'),
            label: l.t('agreement.template'),
            value: _templates.any((t) => t.id == _templateId) ? _templateId : null,
            allowEmpty: true,
            items: {for (final t in _templates) t.id: t.name},
            onChanged: (v) => setState(() => _templateId = v),
          ),
          const SizedBox(height: 12),
          field('title', l.t('agreement.titleField')),
          AppDropdown<String>(
            label: l.t(rent ? 'agreement.tenant' : 'agreement.buyer'),
            value: _clientId,
            items: {for (final c in _clients) c.id: c.fullName, if (_clientId != null && !_clients.any((c) => c.id == _clientId)) _clientId!: _editing == null ? '…' : _name(_editing!.json['clientId'])},
            onChanged: (v) => setState(() => _clientId = v),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            label: l.t('deal.property'),
            value: _properties.any((p) => p.id == _propertyId) ? _propertyId : null,
            allowEmpty: true,
            items: {for (final p in _properties) p.id: p.propertyId ?? '…'},
            onChanged: (v) => setState(() => _propertyId = v),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(
            label: l.t(rent ? 'agreement.landlord' : 'agreement.seller'),
            value: _owners.any((o) => o.id == _ownerId) ? _ownerId : null,
            allowEmpty: true,
            items: {for (final o in _owners) o.id: o.fullName},
            onChanged: (v) => setState(() => _ownerId = v),
          ),
          const SizedBox(height: 12),
          field('clientCnic', l.t('agreement.clientCnic'), hint: '42101-1234567-1'),
          field('ownerCnic', l.t('agreement.ownerCnic'), hint: '42101-1234567-1'),
          if (rent) ...[
            field('monthlyRent', l.t('agreement.monthlyRent'), number: true),
            field('securityDeposit', l.t('agreement.securityDeposit'), number: true),
          ] else ...[
            field('amount', l.t('agreement.amount'), number: true),
            field('tokenAmount', l.t('agreement.tokenAmount'), number: true),
          ],
          _date(l.t(rent ? 'agreement.startDate' : 'agreement.agreementDate'), _start, (v) => setState(() => _start = v)),
          _date(l.t(rent ? 'agreement.endDate' : 'agreement.transferBy'), _end, (v) => setState(() => _end = v)),
          if (rent) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(l.t('agreement.renewalHint'), style: Theme.of(context).textTheme.bodySmall)),
          field('witness1', l.t('agreement.witness1')),
          field('witness2', l.t('agreement.witness2')),
          field('notes', l.t('common.notes')),
          const SizedBox(height: 12),
          FilledButton(onPressed: _saving ? null : _save, child: Text(l.t('common.save'))),
        ]),
      ),
    );
  }
}

/// Agreements of a deal / client / property, on their detail screens.
class AgreementsPanel extends ConsumerWidget {
  const AgreementsPanel({super.key, this.dealId, this.clientId, this.propertyId, this.kind});
  final String? dealId;
  final String? clientId;
  final String? propertyId;
  final String? kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('agreements'));
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final query = [if (dealId != null) 'dealId=$dealId', if (clientId != null) 'clientId=$clientId', if (propertyId != null) 'propertyId=$propertyId', if (kind != null) 'kind=$kind'].join('&');
    return FutureBuilder<List<Agreement>>(
      future: ref.watch(crmRepositoryProvider).agreements(dealId: dealId, clientId: dealId == null ? clientId : null, propertyId: dealId == null && clientId == null ? propertyId : null),
      builder: (context, snap) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SectionHeader(
          l.t('agreement.title'),
          trailing: auth.can('agreements:create') ? TextButton.icon(onPressed: () => context.push('/agreements/new?$query'), icon: const Icon(Icons.add), label: Text(l.t('agreement.add'))) : null,
        ),
        for (final a in snap.data ?? const <Agreement>[]) Padding(padding: const EdgeInsets.only(bottom: 8), child: AgreementCard(agreement: a)),
        if ((snap.data ?? const []).isEmpty) Text(l.t('agreement.empty'), style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}
