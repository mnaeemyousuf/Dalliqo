import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../common/record_panels.dart';

const propertyTypes = ['RESIDENTIAL_PLOT', 'HOUSE', 'FLAT', 'APARTMENT', 'PORTION', 'SHOP', 'OFFICE', 'COMMERCIAL', 'OTHER'];
const sizeUnits = ['SQ_YARD', 'SQ_FT', 'SQ_METER', 'MARLA', 'KANAL'];

final clientFilterProvider = StateProvider<ClientFilter>((ref) => const ClientFilter());

final categoriesProvider = FutureProvider<List<Category>>((ref) {
  ref.watch(entityChangesProvider('clientCategories'));
  return ref.watch(crmRepositoryProvider).categories();
});

String? categoryName(List<Category>? cats, String? id, bool urdu) {
  for (final c in cats ?? const <Category>[]) {
    if (c.id == id || c.serverId == id) return c.label(urdu);
  }
  return null;
}

class ClientsScreen extends ConsumerStatefulWidget {
  const ClientsScreen({super.key});
  @override
  ConsumerState<ClientsScreen> createState() => _ClientsScreenState();
}

class _ClientsScreenState extends ConsumerState<ClientsScreen> {
  static const _page = 30;
  final _scroll = ScrollController();
  final _search = TextEditingController();
  Timer? _debounce;
  List<Client> _items = [];
  bool _loading = true;
  bool _hasMore = true;
  ClientFilter? _loadedFor;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400 && _hasMore && !_loading) _load(more: true);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final filter = ref.read(clientFilterProvider);
    setState(() => _loading = true);
    final page = await ref.read(crmRepositoryProvider).clients(filter, limit: _page, offset: more ? _items.length : 0);
    if (!mounted) return;
    setState(() {
      _items = more ? [..._items, ...page] : page;
      _hasMore = page.length == _page;
      _loading = false;
      _loadedFor = filter;
    });
  }

  void _openFilters() {
    final cats = ref.read(categoriesProvider).value ?? const [];
    final l = context.l10n;
    final repo = ref.read(onlineRepositoryProvider);
    var draft = ref.read(clientFilterProvider);
    final area = TextEditingController(text: draft.area ?? '');
    final minBudget = TextEditingController(text: draft.minBudget?.toString() ?? '');
    final maxBudget = TextEditingController(text: draft.maxBudget?.toString() ?? '');
    String? text(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    showAppBottomSheet<void>(
      context,
      title: l.t('common.filters'),
      child: StatefulBuilder(builder: (context, setSheet) {
        void pick(ClientFilter n) => setSheet(() => draft = n);
        return Column(children: [
          AppDropdown<String>(label: l.t('client.category'), value: draft.categoryId, allowEmpty: true, items: {for (final c in cats) c.id: c.label(l.isRtl)}, onChanged: (v) => pick(draft.copyWith(categoryId: v))),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('common.status'), value: draft.status, allowEmpty: true, items: {for (final s in const ['ACTIVE', 'ON_HOLD', 'CLOSED_WON', 'CLOSED_LOST', 'INACTIVE']) s: l.enumLabel('clientStatus', s)}, onChanged: (v) => pick(draft.copyWith(status: v))),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('client.purpose'), value: draft.purpose, allowEmpty: true, items: {for (final s in const ['PURCHASE', 'RENTAL']) s: l.enumLabel('clientPurpose', s)}, onChanged: (v) => pick(draft.copyWith(purpose: v))),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('common.type'), value: draft.propertyType, allowEmpty: true, items: {for (final s in propertyTypes) s: l.enumLabel('propertyType', s)}, onChanged: (v) => pick(draft.copyWith(propertyType: v))),
          const SizedBox(height: 12),
          AppTextField(label: l.t('property.area'), controller: area),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('client.minBudget'), controller: minBudget, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('client.maxBudget'), controller: maxBudget, keyboardType: TextInputType.number)),
          ]),
          const SizedBox(height: 12),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: repo.members(),
            builder: (context, snap) => AppDropdown<String>(
              label: l.t('client.assignedTo'),
              value: draft.assignedTo,
              allowEmpty: true,
              items: {
                for (final m in snap.data ?? const <Map<String, dynamic>>[])
                  if (m['user'] is Map) (m['user'] as Map)['_id'] as String: ((m['user'] as Map)['fullName'] as String?) ?? '',
                if (draft.assignedTo != null && !(snap.data ?? const []).any((m) => m['user'] is Map && (m['user'] as Map)['_id'] == draft.assignedTo)) draft.assignedTo!: '…',
              },
              onChanged: (v) => pick(draft.copyWith(assignedTo: v)),
            ),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('common.sortBy'), value: draft.sort, items: {'updated': l.t('common.updatedAt'), 'name': l.t('common.name'), 'matches': l.t('nav.matches')}, onChanged: (v) => pick(draft.copyWith(sort: v))),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: AppButton(
                label: l.t('common.clear'),
                outlined: true,
                onPressed: () {
                  ref.read(clientFilterProvider.notifier).state = ref.read(clientFilterProvider).cleared();
                  Navigator.pop(context);
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AppButton(
                label: l.t('common.apply'),
                onPressed: () {
                  ref.read(clientFilterProvider.notifier).state = draft.copyWith(
                    search: ref.read(clientFilterProvider).search,
                    area: text(area),
                    minBudget: num.tryParse(minBudget.text.trim()),
                    maxBudget: num.tryParse(maxBudget.text.trim()),
                  );
                  Navigator.pop(context);
                },
              ),
            ),
          ]),
        ]);
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(clientFilterProvider);
    ref.listen(entityChangesProvider('clients'), (_, _) => _load());
    if (_loadedFor != filter && !(_loading && _loadedFor != null)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _loadedFor != ref.read(clientFilterProvider)) _load();
      });
    }
    final cats = ref.watch(categoriesProvider).value;
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('client.title')),
        actions: [const SyncIndicator(), IconButton(icon: Badge(isLabelVisible: filter.active, child: const Icon(Icons.filter_list)), onPressed: _openFilters)],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(hintText: l.t('client.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), () => ref.read(clientFilterProvider.notifier).state = ref.read(clientFilterProvider).copyWith(search: v));
              },
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncEngineProvider).syncNow();
          await _load();
        },
        child: _items.isEmpty && !_loading
            ? ListView(children: [
                AppEmptyState(
                  title: l.t('client.noClients'),
                  hint: l.t('client.noClientsHint'),
                  icon: Icons.people_outline,
                  action: ref.watch(authProvider).can('clients:create') ? AppButton(label: l.t('client.add'), onPressed: () => context.push('/clients/new')) : null,
                ),
              ])
            : ListView.separated(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: _items.length + (_hasMore ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, i) => i >= _items.length
                    ? const AppLoader()
                    : ClientCard(
                        client: _items[i],
                        categoryName: categoryName(cats, _items[i].categoryId, l.isRtl),
                        onFollowUp: () => context.push('/followups/new?clientId=${_items[i].id}'),
                      ),
              ),
      ),
    );
  }
}

final clientProvider = FutureProvider.autoDispose.family<Client?, String>((ref, id) {
  ref.watch(entityChangesProvider('clients'));
  return ref.watch(crmRepositoryProvider).client(id);
});

class ClientDetailScreen extends ConsumerWidget {
  const ClientDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(clientProvider(id));
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    return async.when(
      loading: () => const Scaffold(body: AppLoader()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: AppErrorState(error: e)),
      data: (c) {
        if (c == null) return Scaffold(appBar: AppBar(), body: AppEmptyState(title: l.t('common.notFound')));
        final cats = ref.watch(categoriesProvider).value;
        Future<void> contact(String channel, Future<bool> Function() open) async {
          await open();
          if (c.serverId != null) {
            try {
              await ref.read(onlineRepositoryProvider).logContact(c.serverId!, channel);
            } catch (_) {}
          }
        }

        return DefaultTabController(
          length: 8,
          child: Scaffold(
            appBar: AppBar(
              title: Text(c.fullName),
              actions: [
                if (auth.can('clients:update')) IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/clients/${c.id}/edit')),
                if (auth.can('clients:delete'))
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      if (await confirmDialog(context, title: l.t('common.areYouSure'), message: l.t('client.deleteConfirm', {'name': c.fullName}))) {
                        await ref.read(crmRepositoryProvider).deleteClient(c.local!.uuid);
                        if (context.mounted) context.pop();
                      }
                    },
                  ),
              ],
              bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
                for (final k in const ['overview', 'requirements', 'matches', 'followups', 'notes', 'documents', 'activity', 'communication']) Tab(text: l.t('client.tabs.$k')),
              ]),
            ),
            body: TabBarView(children: [
              ListView(padding: const EdgeInsets.all(16), children: [
                Wrap(spacing: 6, runSpacing: 6, children: [
                  AppChip(l.enumLabel('clientStatus', c.status), tone: c.status == 'ACTIVE' ? ChipTone.green : ChipTone.grey),
                  AppChip(l.enumLabel('priority', c.priority), tone: priorityTone(c.priority)),
                  if (categoryName(cats, c.categoryId, l.isRtl) != null) AppChip(categoryName(cats, c.categoryId, l.isRtl)!, tone: ChipTone.blue),
                  SyncBadge(c.syncStatus),
                ]),
                const SizedBox(height: 12),
                ContactActions(phone: c.mobileNumber, whatsapp: c.whatsappNumber, clientId: c.serverId, onFollowUp: () => context.push('/followups/new?clientId=${c.id}')),
                const SizedBox(height: 8),
                InfoRow(l.t('client.mobile'), c.mobileNumber, ltr: true),
                InfoRow(l.t('client.whatsapp'), c.whatsappNumber, ltr: true),
                InfoRow(l.t('client.alternate'), c.alternateNumber, ltr: true),
                InfoRow(l.t('common.email'), c.email, ltr: true),
                InfoRow(l.t('common.address'), c.address),
                InfoRow(l.t('client.source'), c.source == null ? null : l.enumLabel('source', c.source)),
                InfoRow(l.t('client.budget'), formatRange(c.minBudget, c.maxBudget, urdu: l.isRtl)),
                InfoRow(l.t('client.lastContacted'), c.lastContactedAt == null ? null : formatDate(c.lastContactedAt, time: true, locale: l.locale.languageCode)),
                InfoRow(l.t('common.notes'), c.notes),
                if (c.local?.syncError != null) Text(c.local!.syncError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ]),
              ListView(padding: const EdgeInsets.all(16), children: [for (final r in c.requirements) _RequirementCard(r)]),
              _ClientMatches(serverId: c.serverId),
              FollowUpsPanel(clientId: c.id),
              NotesPanel(entityType: 'client', entityId: c.id),
              DocumentsPanel(entityType: 'client', serverId: c.serverId),
              c.serverId == null ? AppEmptyState(title: l.t('mobile.sync.pending')) : ActivityPanel(entityId: c.serverId!),
              ListView(padding: const EdgeInsets.all(16), children: [
                Text(l.t('client.communicationHint')),
                const SizedBox(height: 16),
                ListTile(leading: const Icon(Icons.call), title: Text(l.t('client.call')), subtitle: Ltr(c.mobileNumber), onTap: () => contact('CALL', () => Contact.call(c.mobileNumber))),
                ListTile(leading: const Icon(Icons.chat, color: Color(0xFF16A34A)), title: const Text('WhatsApp'), subtitle: Ltr(c.whatsapp), onTap: () => contact('WHATSAPP', () => Contact.whatsapp(c.whatsapp, text: 'Assalam o Alaikum ${c.fullName},'))),
                ListTile(leading: const Icon(Icons.sms_outlined), title: Text(l.t('client.sms')), subtitle: Ltr(c.mobileNumber), onTap: () => contact('SMS', () => Contact.sms(c.mobileNumber))),
                if (c.email != null) ListTile(leading: const Icon(Icons.email_outlined), title: Text(l.t('common.email')), subtitle: Ltr(c.email!), onTap: () => contact('EMAIL', () => Contact.email(c.email!))),
              ]),
            ]),
          ),
        );
      },
    );
  }
}

class _RequirementCard extends StatelessWidget {
  const _RequirementCard(this.r);
  final Requirement r;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(spacing: 6, runSpacing: 6, children: [
            AppChip(l.enumLabel('clientPurpose', r.purpose), tone: ChipTone.blue),
            if (r.isPrimary) AppChip(l.t('client.primary')),
            for (final t in r.propertyTypes) AppChip(l.enumLabel('propertyType', t), tone: ChipTone.purple),
          ]),
          const SizedBox(height: 8),
          InfoRow(l.t('client.preferredSocieties'), [...r.societies, ...r.areas].join(', ')),
          InfoRow(l.t('client.preferredBlocks'), r.blocks.join(', ')),
          InfoRow(l.t('client.size'), r.minSize == null && r.maxSize == null ? null : '${r.minSize ?? '…'} – ${r.maxSize ?? '…'} ${l.enumLabel('sizeUnit', r.sizeUnit)}'),
          InfoRow(l.t('client.budget'), formatRange(r.minBudget, r.maxBudget, urdu: l.isRtl)),
        ]),
      ),
    );
  }
}

class _ClientMatches extends ConsumerWidget {
  const _ClientMatches({required this.serverId});
  final String? serverId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (serverId == null) return AppEmptyState(title: context.t('mobile.sync.pending'), icon: Icons.cloud_upload_outlined);
    return FutureBuilder(
      future: ref.watch(onlineRepositoryProvider).matches(clientId: serverId),
      builder: (context, snap) {
        if (snap.hasError) return AppErrorState(error: snap.error!);
        if (!snap.hasData) return const AppLoader();
        final items = snap.data!.items;
        if (items.isEmpty) return AppEmptyState(title: context.t('match.noMatches'), hint: context.t('match.noMatchesHint'));
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, i) => MatchCard(match: items[i], perspective: 'client'),
        );
      },
    );
  }
}

/// Requirement editor state for the client form.
class _ReqDraft {
  _ReqDraft([Requirement? r])
      : purpose = r?.purpose ?? 'PURCHASE',
        types = {...?r?.propertyTypes},
        societies = TextEditingController(text: r?.societies.join(', ') ?? ''),
        areas = TextEditingController(text: r?.areas.join(', ') ?? ''),
        blocks = TextEditingController(text: r?.blocks.join(', ') ?? ''),
        minSize = TextEditingController(text: r?.minSize?.toString() ?? ''),
        maxSize = TextEditingController(text: r?.maxSize?.toString() ?? ''),
        sizeUnit = r?.sizeUnit ?? 'SQ_YARD',
        minBudget = TextEditingController(text: r?.minBudget?.toString() ?? ''),
        maxBudget = TextEditingController(text: r?.maxBudget?.toString() ?? ''),
        id = r?.json['_id'] as String?;

  final String? id;
  String purpose;
  Set<String> types;
  final TextEditingController societies, areas, blocks, minSize, maxSize, minBudget, maxBudget;
  String sizeUnit;

  static List<String> _list(TextEditingController c) => c.text.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
  static num? _num(TextEditingController c) => num.tryParse(c.text.replaceAll(',', '').trim());

  Map<String, dynamic> toJson(bool primary) => {
        if (id != null) '_id': id,
        'isPrimary': primary,
        'purpose': purpose,
        'propertyTypes': types.toList(),
        'societies': _list(societies),
        'areas': _list(areas),
        'blocks': _list(blocks),
        if (_num(minSize) != null) 'minSize': _num(minSize),
        if (_num(maxSize) != null) 'maxSize': _num(maxSize),
        if (_num(minSize) != null || _num(maxSize) != null) 'sizeUnit': sizeUnit,
        if (_num(minBudget) != null) 'minBudget': _num(minBudget)!.round(),
        if (_num(maxBudget) != null) 'maxBudget': _num(maxBudget)!.round(),
      };
}

class ClientFormScreen extends ConsumerStatefulWidget {
  const ClientFormScreen({super.key, this.id});
  final String? id;
  @override
  ConsumerState<ClientFormScreen> createState() => _ClientFormScreenState();
}

class _ClientFormScreenState extends ConsumerState<ClientFormScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _whatsapp = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();
  String? _categoryId;
  String _status = 'ACTIVE';
  String _priority = 'MEDIUM';
  String? _source;
  String? _assignedTo;
  List<_ReqDraft> _reqs = [_ReqDraft()];
  Client? _editing;
  bool _saving = false;
  List<Map<String, dynamic>> _members = const [];

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final m = await ref.read(onlineRepositoryProvider).members();
      if (mounted) setState(() => _members = m.where((e) => e['status'] == 'ACTIVE').toList());
    } catch (_) {}
    if (widget.id == null) return;
    final c = await ref.read(crmRepositoryProvider).client(widget.id!);
    if (c == null || !mounted) return;
    setState(() {
      _editing = c;
      _name.text = c.fullName;
      _mobile.text = c.mobileNumber;
      _whatsapp.text = c.whatsappNumber ?? '';
      _email.text = c.email ?? '';
      _address.text = c.address ?? '';
      _notes.text = c.notes ?? '';
      _categoryId = c.categoryId;
      _status = c.status;
      _priority = c.priority;
      _source = c.source;
      _assignedTo = c.assignedTo;
      if (c.requirements.isNotEmpty) _reqs = c.requirements.map(_ReqDraft.new).toList();
    });
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final fields = <String, dynamic>{
      'fullName': _name.text.trim(),
      'mobileNumber': normalizePhone(_mobile.text)!,
      if (_whatsapp.text.trim().isNotEmpty) 'whatsappNumber': normalizePhone(_whatsapp.text),
      if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
      if (_address.text.trim().isNotEmpty) 'address': _address.text.trim(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      if (_categoryId != null) 'categoryId': _categoryId,
      'status': _status,
      'priority': _priority,
      if (_source != null) 'source': _source,
      if (_assignedTo != null) 'assignedTo': _assignedTo,
      'requirements': [for (var i = 0; i < _reqs.length; i++) _reqs[i].toJson(i == 0)],
    };
    // Keep the list/card summary right while offline (the server recomputes it on sync).
    final primary = fields['requirements'][0] as Map<String, dynamic>;
    final local = <String, dynamic>{
      ...fields,
      if ((primary['societies'] as List).isNotEmpty) 'preferredSociety': (primary['societies'] as List).first,
      if ((primary['areas'] as List).isNotEmpty) 'preferredArea': (primary['areas'] as List).first,
      'propertyTypeRequired': primary['propertyTypes'],
      if (primary['minBudget'] != null) 'minBudget': primary['minBudget'],
      if (primary['maxBudget'] != null) 'maxBudget': primary['maxBudget'],
      'purchaseOrRental': primary['purpose'],
    };
    try {
      final repo = ref.read(crmRepositoryProvider);
      if (_editing == null) {
        final dups = await repo.clientsWithPhones([fields['mobileNumber'] as String?, fields['whatsappNumber'] as String?, fields['alternateNumber'] as String?]);
        if (dups.isNotEmpty && mounted) {
          final choice = await showDialog<String>(
            context: context,
            builder: (c) => AlertDialog(
              title: Text(c.t('client.duplicateTitle')),
              content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(c.t('client.duplicateHint')),
                const SizedBox(height: 8),
                for (final d in dups) ListTile(contentPadding: EdgeInsets.zero, dense: true, leading: const Icon(Icons.person_outline), title: Text(d.fullName), subtitle: Ltr(d.mobileNumber), onTap: () => Navigator.pop(c, 'open:${d.id}')),
              ]),
              actions: [
                TextButton(onPressed: () => Navigator.pop(c), child: Text(c.t('common.cancel'))),
                FilledButton(onPressed: () => Navigator.pop(c, 'save'), child: Text(c.t('client.saveAnyway'))),
              ],
            ),
          );
          if (!mounted) return;
          if (choice == null) return;
          if (choice.startsWith('open:')) {
            context.pushReplacement('/clients/${choice.substring(5)}');
            return;
          }
        }
      }
      final saved = _editing == null ? await repo.saveClient(local) : await repo.saveClient(local, id: _editing!.local!.uuid);
      if (!mounted) return;
      showMessage(context, context.t(_editing == null ? 'client.created' : 'client.updated'));
      _editing == null ? context.pushReplacement('/clients/${saved.id}') : context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final cats = ref.watch(categoriesProvider).value ?? const [];
    String? phone(String? v, {bool required = false}) {
      if (v == null || v.trim().isEmpty) return required ? l.t('common.required') : null;
      return normalizePhone(v) == null ? l.t('errors.VALIDATION_ERROR') : null;
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'client.add' : 'client.edit'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          AppTextField(label: l.t('client.fullName'), controller: _name, validator: (v) => (v == null || v.trim().length < 2) ? l.t('common.required') : null),
          const SizedBox(height: 12),
          AppTextField(label: l.t('client.mobile'), controller: _mobile, keyboardType: TextInputType.phone, hint: '0300 1234567', textDirection: TextDirection.ltr, validator: (v) => phone(v, required: true)),
          const SizedBox(height: 12),
          AppTextField(label: l.t('client.whatsapp'), controller: _whatsapp, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, validator: phone),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.email'), controller: _email, keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('client.category'), value: _categoryId, items: {for (final c in cats) c.serverId ?? c.id: c.label(l.isRtl)}, onChanged: (v) => setState(() => _categoryId = v)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppDropdown<String>(label: l.t('common.status'), value: _status, items: {for (final s in const ['ACTIVE', 'ON_HOLD', 'CLOSED_WON', 'CLOSED_LOST', 'INACTIVE']) s: l.enumLabel('clientStatus', s)}, onChanged: (v) => setState(() => _status = v ?? 'ACTIVE'))),
            const SizedBox(width: 12),
            Expanded(child: AppDropdown<String>(label: l.t('client.priority'), value: _priority, items: {for (final s in const ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) s: l.enumLabel('priority', s)}, onChanged: (v) => setState(() => _priority = v ?? 'MEDIUM'))),
          ]),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('client.source'), value: _source, items: {for (final s in const ['WALK_IN', 'PHONE', 'REFERRAL', 'WHATSAPP', 'SOCIAL_MEDIA', 'PORTAL', 'OTHER']) s: l.enumLabel('source', s)}, onChanged: (v) => setState(() => _source = v)),
          if (_members.isNotEmpty) ...[
            const SizedBox(height: 12),
            AppDropdown<String>(label: l.t('client.assignedTo'), value: _assignedTo, items: {for (final m in _members) (m['user'] as Map)['_id'] as String: (m['user'] as Map)['fullName'] as String}, onChanged: (v) => setState(() => _assignedTo = v)),
          ],
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.address'), controller: _address),
          SectionHeader(l.t('client.requirements'), trailing: TextButton.icon(icon: const Icon(Icons.add), label: Text(l.t('client.addRequirement')), onPressed: () => setState(() => _reqs.add(_ReqDraft())))),
          for (var i = 0; i < _reqs.length; i++) _reqEditor(context, i),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.notes'), controller: _notes, maxLines: 3),
          const SizedBox(height: 24),
          AppButton(label: l.t('common.save'), loading: _saving, onPressed: _save, expand: true),
        ]),
      ),
    );
  }

  Widget _reqEditor(BuildContext context, int i) {
    final l = context.l10n;
    final r = _reqs[i];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${l.t('client.requirement')} ${i + 1}${i == 0 ? ' · ${l.t('client.primary')}' : ''}', style: Theme.of(context).textTheme.titleSmall)),
            if (_reqs.length > 1) IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _reqs.removeAt(i))),
          ]),
          SegmentedButton<String>(
            segments: [for (final p in const ['PURCHASE', 'RENTAL']) ButtonSegment(value: p, label: Text(l.enumLabel('clientPurpose', p)))],
            selected: {r.purpose},
            onSelectionChanged: (s) => setState(() => r.purpose = s.first),
          ),
          const SizedBox(height: 10),
          Text(l.t('client.propertyTypes'), style: Theme.of(context).textTheme.bodySmall),
          Wrap(spacing: 6, children: [
            for (final t in propertyTypes)
              FilterChip(
                label: Text(l.enumLabel('propertyType', t)),
                selected: r.types.contains(t),
                onSelected: (on) => setState(() => on ? r.types.add(t) : r.types.remove(t)),
              ),
          ]),
          const SizedBox(height: 10),
          AppTextField(label: l.t('client.preferredSocieties'), controller: r.societies, helper: l.t('client.commaHint')),
          const SizedBox(height: 10),
          AppTextField(label: l.t('client.preferredAreas'), controller: r.areas),
          const SizedBox(height: 10),
          AppTextField(label: l.t('client.preferredBlocks'), controller: r.blocks),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('client.minSize'), controller: r.minSize, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('client.maxSize'), controller: r.maxSize, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(child: AppDropdown<String>(label: l.t('property.sizeUnit'), value: r.sizeUnit, items: {for (final u in sizeUnits) u: l.enumLabel('sizeUnit', u)}, onChanged: (v) => setState(() => r.sizeUnit = v ?? 'SQ_YARD'))),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('client.minBudget'), controller: r.minBudget, keyboardType: TextInputType.number)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('client.maxBudget'), controller: r.maxBudget, keyboardType: TextInputType.number, validator: (v) {
              final min = num.tryParse(r.minBudget.text), max = num.tryParse(v ?? '');
              return min != null && max != null && min > max ? l.t('errors.VALIDATION_ERROR') : null;
            })),
          ]),
        ]),
      ),
    );
  }
}
