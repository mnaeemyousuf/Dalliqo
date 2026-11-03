import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import 'parity_screens.dart';

/// Administration on the phone (parity with the web): users and their access, client categories, and
/// business settings. These change shared configuration, so they need a connection.

const permissionTemplates = ['MEMBER', 'MANAGER', 'AGENT', 'SALESPERSON', 'ACCOUNTANT', 'VIEWER'];

/// Which template a permission list matches exactly (null = custom, edited on the web).
String? templateOf(List<String> perms, Map<String, List<String>> templates) {
  final key = ([...perms]..sort()).join(',');
  for (final t in permissionTemplates) {
    final p = templates[t];
    if (p != null && ([...p]..sort()).join(',') == key) return t;
  }
  return null;
}

class MembersAdminScreen extends ConsumerStatefulWidget {
  const MembersAdminScreen({super.key});
  @override
  ConsumerState<MembersAdminScreen> createState() => _MembersAdminScreenState();
}

class _MembersAdminScreenState extends ConsumerState<MembersAdminScreen> {
  int _reload = 0;
  Map<String, List<String>> _templates = const {};

  @override
  void initState() {
    super.initState();
    ref.read(onlineRepositoryProvider).permissionTemplates().then((t) {
      if (mounted) setState(() => _templates = t);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final canManage = ref.watch(authProvider).can('members:manage');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('nav.users'))),
      floatingActionButton: canManage ? FloatingActionButton(onPressed: () => _add(context), child: const Icon(Icons.person_add_alt)) : null,
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_reload),
        future: ref.read(onlineRepositoryProvider).members(),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++));
          if (!snap.hasData) return const AppLoader();
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            for (final m in snap.data!)
              Builder(builder: (context) {
                final user = Map<String, dynamic>.from(m['user'] as Map);
                final perms = ((m['permissions'] as List?) ?? const []).cast<String>();
                final tpl = m['role'] == 'OWNER' ? null : templateOf(perms, _templates);
                final access = m['branchAccess'] == 'SELECTED' ? l.t('mobile.admin.someBranches', {'count': '${(m['branchIds'] as List?)?.length ?? 0}'}) : l.t('branch.all');
                return ListTile(
                  leading: CircleAvatar(child: Text(((user['fullName'] as String?) ?? '?').characters.first)),
                  title: Text(user['fullName'] as String? ?? ''),
                  subtitle: Text([
                    l.enumLabel('role', m['role'] as String?),
                    if (m['role'] != 'OWNER') tpl == null ? l.t('mobile.admin.custom') : l.t('user.templates.$tpl'),
                    l.enumLabel('memberStatus', m['status'] as String?),
                    access,
                  ].join(' · ')),
                  trailing: canManage && m['role'] != 'OWNER' ? const Icon(Icons.chevron_right) : null,
                  onTap: canManage && m['role'] != 'OWNER' ? () => _edit(context, m, tpl) : null,
                );
              }),
            Padding(padding: const EdgeInsets.all(16), child: Text(l.t('mobile.admin.customHint'), style: Theme.of(context).textTheme.bodySmall)),
          ]);
        },
      ),
    );
  }

  Future<void> _edit(BuildContext context, Map<String, dynamic> m, String? tpl) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _MemberSheet(member: m, template: tpl, templates: _templates),
    );
    if (changed == true) setState(() => _reload++);
  }

  Future<void> _add(BuildContext context) async {
    final changed = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => _MemberSheet(templates: _templates));
    if (changed == true) setState(() => _reload++);
  }
}

class _MemberSheet extends ConsumerStatefulWidget {
  const _MemberSheet({this.member, this.template, required this.templates});
  final Map<String, dynamic>? member;
  final String? template;
  final Map<String, List<String>> templates;
  @override
  ConsumerState<_MemberSheet> createState() => _MemberSheetState();
}

class _MemberSheetState extends ConsumerState<_MemberSheet> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  String? _template;
  bool _active = true;
  String _access = 'ALL';
  Set<String> _branchIds = {};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final m = widget.member;
    _template = widget.template ?? (m == null ? 'MEMBER' : null);
    _active = m == null || m['status'] != 'SUSPENDED';
    _access = (m?['branchAccess'] as String?) ?? 'ALL';
    _branchIds = {...((m?['branchIds'] as List?) ?? const []).cast<String>()};
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (_access == 'SELECTED' && _branchIds.isEmpty) return showMessage(context, l.t('mobile.admin.chooseBranch'));
    setState(() => _saving = true);
    final repo = ref.read(onlineRepositoryProvider);
    final branch = {'branchAccess': _access, if (_access == 'SELECTED') 'branchIds': _branchIds.toList()};
    final perms = _template == null ? null : widget.templates[_template];
    try {
      if (widget.member == null) {
        await repo.createMember({
          'fullName': _name.text.trim(),
          'email': _email.text.trim(),
          if (_mobile.text.trim().isNotEmpty) 'mobileNumber': _mobile.text.trim(),
          'temporaryPassword': _password.text,
          'permissions': ?perms,
          ...branch,
        });
      } else {
        await repo.updateMember(widget.member!['_id'] as String, {
          'permissions': ?perms,
          'status': _active ? 'ACTIVE' : 'SUSPENDED',
          ...branch,
        });
      }
      if (mounted) {
        showMessage(context, l.t('common.changesSaved'));
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final branches = ref.watch(branchScopeProvider).branches;
    final isNew = widget.member == null;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(isNew ? l.t('user.add') : ((widget.member!['user'] as Map)['fullName'] as String? ?? ''), style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            if (isNew) ...[
              AppTextField(label: l.t('auth.fullName'), controller: _name),
              const SizedBox(height: 8),
              AppTextField(label: l.t('auth.email'), controller: _email, keyboardType: TextInputType.emailAddress),
              const SizedBox(height: 8),
              AppTextField(label: l.t('auth.mobileNumber'), controller: _mobile, keyboardType: TextInputType.phone),
              const SizedBox(height: 8),
              AppTextField(label: l.t('user.temporaryPassword'), controller: _password, obscure: true),
              const SizedBox(height: 12),
            ],
            AppDropdown<String>(
              label: l.t('user.template'),
              value: _template,
              allowEmpty: !isNew,
              items: {for (final t in permissionTemplates) if (widget.templates.containsKey(t)) t: l.t('user.templates.$t')},
              onChanged: (v) => setState(() => _template = v),
            ),
            if (_template == null && !isNew) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.t('mobile.admin.keepCustom'), style: Theme.of(context).textTheme.bodySmall)),
            if (!isNew)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  icon: const Icon(Icons.checklist),
                  label: Text(l.t('mobile.parity.editPermissions')),
                  onPressed: () async {
                    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => PermissionEditorScreen(member: widget.member!)));
                    if (saved == true && context.mounted) Navigator.pop(context, true);
                  },
                ),
              ),
            if (!isNew) SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('mobile.admin.active')), value: _active, onChanged: (v) => setState(() => _active = v)),
            if (branches.length > 1) ...[
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: [ButtonSegment(value: 'ALL', label: Text(l.t('branch.all'))), ButtonSegment(value: 'SELECTED', label: Text(l.t('mobile.admin.selectedBranches')))],
                selected: {_access},
                onSelectionChanged: (s) => setState(() => _access = s.first),
              ),
              if (_access == 'SELECTED')
                Wrap(spacing: 6, children: [
                  for (final b in branches)
                    if (b.serverId != null)
                      FilterChip(
                        label: Text(b.name),
                        selected: _branchIds.contains(b.serverId),
                        onSelected: (v) => setState(() => v ? _branchIds.add(b.serverId!) : _branchIds.remove(b.serverId)),
                      ),
                ]),
            ],
            const SizedBox(height: 16),
            FilledButton(onPressed: _saving ? null : _save, child: Text(l.t('common.save'))),
          ]),
        ),
      ),
    );
  }
}

/// Client categories (names in English and Urdu; archive instead of delete).
class ClientCategoriesScreen extends ConsumerStatefulWidget {
  const ClientCategoriesScreen({super.key});
  @override
  ConsumerState<ClientCategoriesScreen> createState() => _ClientCategoriesScreenState();
}

class _ClientCategoriesScreenState extends ConsumerState<ClientCategoriesScreen> {
  int _reload = 0;

  Future<void> _editDialog({Map<String, dynamic>? category}) async {
    final l = context.l10n;
    final name = TextEditingController(text: category?['name'] as String? ?? '');
    final nameUr = TextEditingController(text: category?['nameUr'] as String? ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(category == null ? l.t('category.add') : l.t('common.rename')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          AppTextField(label: l.t('common.name'), controller: name),
          const SizedBox(height: 8),
          AppTextField(label: l.t('finance.nameUr'), controller: nameUr),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
        ],
      ),
    );
    if (ok != true || name.text.trim().length < 2) return;
    try {
      final repo = ref.read(onlineRepositoryProvider);
      final body = {'name': name.text.trim(), if (nameUr.text.trim().isNotEmpty) 'nameUr': nameUr.text.trim()};
      category == null ? await repo.createClientCategory(body) : await repo.updateClientCategory(category['_id'] as String, body);
      await ref.read(syncEngineProvider).syncNow();
      setState(() => _reload++);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('settings.categories'))),
      floatingActionButton: FloatingActionButton(onPressed: () => _editDialog(), child: const Icon(Icons.add)),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_reload),
        future: ref.read(onlineRepositoryProvider).clientCategories(includeArchived: true),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++));
          if (!snap.hasData) return const AppLoader();
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            for (final c in snap.data!)
              ListTile(
                title: Text(l.isRtl && (c['nameUr'] as String? ?? '').isNotEmpty ? c['nameUr'] as String : c['name'] as String,
                    style: c['archivedAt'] != null ? const TextStyle(decoration: TextDecoration.lineThrough) : null),
                subtitle: Text('${c['clientCount'] ?? 0} ${l.t('nav.clients')}'),
                trailing: Wrap(children: [
                  IconButton(icon: const Icon(Icons.edit_outlined), tooltip: l.t('common.rename'), onPressed: () => _editDialog(category: c)),
                  IconButton(
                    icon: Icon(c['archivedAt'] != null ? Icons.unarchive_outlined : Icons.archive_outlined),
                    tooltip: l.t(c['archivedAt'] != null ? 'common.restore' : 'common.archive'),
                    onPressed: () async {
                      try {
                        await ref.read(onlineRepositoryProvider).updateClientCategory(c['_id'] as String, {'archived': c['archivedAt'] == null});
                        await ref.read(syncEngineProvider).syncNow();
                        setState(() => _reload++);
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                  ),
                ]),
              ),
          ]);
        },
      ),
    );
  }
}

/// Matching, reminder and commission settings for the whole business.
class BusinessSettingsScreen extends ConsumerStatefulWidget {
  const BusinessSettingsScreen({super.key});
  @override
  ConsumerState<BusinessSettingsScreen> createState() => _BusinessSettingsScreenState();
}

class _BusinessSettingsScreenState extends ConsumerState<BusinessSettingsScreen> {
  Map<String, dynamic>? _s;
  Object? _error;
  bool _saving = false;
  final _buyer = TextEditingController();
  final _seller = TextEditingController();
  final _reminder = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await ref.read(onlineRepositoryProvider).settings();
      if (!mounted) return;
      setState(() {
        _s = s;
        _buyer.text = '${(s['commission'] as Map?)?['defaultBuyerPct'] ?? ''}';
        _seller.text = '${(s['commission'] as Map?)?['defaultSellerPct'] ?? ''}';
        _reminder.text = '${(s['reminders'] as Map?)?['defaultMinutesBefore'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  num _get(String group, String key, num fallback) => ((_s?[group] as Map?)?[key] as num?) ?? fallback;

  void _set(String group, String key, Object value) => setState(() => _s = {..._s!, group: {...((_s![group] as Map?) ?? const {}), key: value}});

  Future<void> _save() async {
    final l = context.l10n;
    setState(() => _saving = true);
    try {
      final m = Map<String, dynamic>.from(_s!['matching'] as Map);
      await ref.read(onlineRepositoryProvider).updateSettings({
        'matching': {'storeThreshold': m['storeThreshold'], 'notifyThreshold': m['notifyThreshold'], 'crossBranch': m['crossBranch'] == true},
        'reminders': {'defaultMinutesBefore': int.tryParse(_reminder.text) ?? 30},
        'commission': {
          'defaultBuyerPct': num.tryParse(_buyer.text) ?? 1,
          'defaultSellerPct': num.tryParse(_seller.text) ?? 1,
          'autoCreateIncome': (_s!['commission'] as Map?)?['autoCreateIncome'] != false,
        },
      });
      if (mounted) showMessage(context, l.t('common.changesSaved'));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (_error != null) return Scaffold(appBar: AppBar(title: Text(l.t('mobile.admin.businessSettings'))), body: AppErrorState(error: _error!, onRetry: _load));
    if (_s == null) return Scaffold(appBar: AppBar(title: Text(l.t('mobile.admin.businessSettings'))), body: const AppLoader());
    final store = _get('matching', 'storeThreshold', 40).toDouble();
    final notify = _get('matching', 'notifyThreshold', 70).toDouble();
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.admin.businessSettings'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SectionHeader(l.t('settings.matching')),
        Text('${l.t('settings.storeThreshold')}: ${store.round()}'),
        Slider(value: store, min: 0, max: 100, divisions: 20, label: '${store.round()}', onChanged: (v) => _set('matching', 'storeThreshold', v.round())),
        Text('${l.t('settings.notifyThreshold')}: ${notify.round()}'),
        Slider(value: notify, min: 0, max: 100, divisions: 20, label: '${notify.round()}', onChanged: (v) => _set('matching', 'notifyThreshold', v.round())),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(l.t('branch.crossBranch')),
          value: (_s!['matching'] as Map?)?['crossBranch'] == true,
          onChanged: (v) => _set('matching', 'crossBranch', v),
        ),
        SectionHeader(l.t('mobile.admin.reminders')),
        AppTextField(label: l.t('mobile.admin.reminderMinutes'), controller: _reminder, keyboardType: TextInputType.number),
        SectionHeader(l.t('deal.commission')),
        AppTextField(label: l.t('mobile.admin.buyerPct'), controller: _buyer, keyboardType: const TextInputType.numberWithOptions(decimal: true)),
        const SizedBox(height: 8),
        AppTextField(label: l.t('mobile.admin.sellerPct'), controller: _seller, keyboardType: const TextInputType.numberWithOptions(decimal: true)),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(l.t('mobile.admin.autoIncome')),
          value: (_s!['commission'] as Map?)?['autoCreateIncome'] != false,
          onChanged: (v) => _set('commission', 'autoCreateIncome', v),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: _saving ? null : _save, child: Text(l.t('common.save'))),
      ]),
    );
  }
}
