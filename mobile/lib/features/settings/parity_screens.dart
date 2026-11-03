import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';

/// Screens that bring the phone to parity with the web: analytics, audit log, documents library, the detailed permission
/// editor, agreement templates and income / expense categories. All read live data from the API (they need a connection).

/// Dashboard analytics (same data as the web charts), drawn as labelled bars.
class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});
  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  String _range = '30d';

  Widget _bars(BuildContext context, String title, List<(String, num)> rows) {
    final max = rows.fold<num>(0, (m, r) => r.$2 > m ? r.$2 : m);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionHeader(title),
      if (rows.isEmpty) Text(context.t('dashboard.noData'), style: Theme.of(context).textTheme.bodySmall),
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            SizedBox(width: 120, child: Text(r.$1, maxLines: 1, overflow: TextOverflow.ellipsis)),
            Expanded(child: LinearProgressIndicator(value: max == 0 ? 0 : r.$2 / max, minHeight: 10, borderRadius: BorderRadius.circular(5))),
            SizedBox(width: 48, child: Align(alignment: AlignmentDirectional.centerEnd, child: Ltr('${r.$2}'))),
          ]),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.parity.analytics'))),
      body: FutureBuilder<Map<String, dynamic>>(
        key: ValueKey(_range),
        future: ref.read(onlineRepositoryProvider).analytics(_range),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() {}));
          if (!snap.hasData) return const AppLoader();
          final d = snap.data!;
          List<Map<String, dynamic>> list(String k) => ((d[k] as List?) ?? const []).cast<Map<String, dynamic>>();
          final fu = list('followUpPerformance');
          num sum(List<Map<String, dynamic>> rows, String k) => rows.fold<num>(0, (s, r) => s + ((r[k] as num?) ?? 0));
          final nr = list('newRecords');
          return ListView(padding: const EdgeInsets.all(16), children: [
            SegmentedButton<String>(
              segments: [for (final r in const ['7d', '30d', '12m']) ButtonSegment(value: r, label: Text(l.t('dashboard.range$r')))],
              selected: {_range},
              onSelectionChanged: (s) => setState(() => _range = s.first),
            ),
            _bars(context, l.t('dashboard.propertyDistribution'), [for (final r in list('propertyDistribution')) (l.enumLabel('propertyType', r['type'] as String?), r['count'] as num)]),
            _bars(context, l.t('dashboard.propertyStatus'), [for (final r in list('propertyStatus')) (l.enumLabel('propertyStatus', r['status'] as String?), r['count'] as num)]),
            _bars(context, l.t('dashboard.clientCategories'), [for (final r in list('clientCategories')) ('${r['name']}', r['count'] as num)]),
            _bars(context, l.t('dashboard.followUpPerformance'), [
              (l.t('dashboard.completed'), sum(fu, 'completed')),
              (l.t('dashboard.pending'), sum(fu, 'pending')),
              (l.t('dashboard.overdue'), sum(fu, 'overdue')),
              (l.t('dashboard.cancelled'), sum(fu, 'cancelled')),
            ]),
            _bars(context, l.t('dashboard.newRecords'), [
              (l.t('nav.clients'), sum(nr, 'clients')),
              (l.t('nav.properties'), sum(nr, 'properties')),
              (l.t('nav.matches'), sum(nr, 'matches')),
            ]),
            _bars(context, l.t('dashboard.matchQuality'), [for (final r in list('matchQuality')) (l.enumLabel('matchBand', r['band'] as String?), r['count'] as num)]),
            _bars(context, l.t('dashboard.leadSources'), [for (final r in list('leadSources')) ('${l.enumLabel('source', r['source'] as String?)} (${r['won']}✓)', r['total'] as num)]),
            SectionHeader(l.t('dashboard.teamPerformance')),
            for (final r in list('teamPerformance'))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${r['name']}'),
                subtitle: Text('${l.t('dashboard.completed')}: ${r['followUpsCompleted']} · ${l.t('dashboard.overdue')}: ${r['followUpsOverdue']} · ${l.t('nav.clients')}: ${r['activeClients']}'),
              ),
          ]);
        },
      ),
    );
  }
}

/// Audit log: who changed what, with old and new values.
class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});
  @override
  ConsumerState<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends ConsumerState<AuditScreen> {
  final _items = <Map<String, dynamic>>[];
  int _page = 1;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading || !_more) return;
    setState(() => _loading = true);
    try {
      final r = await ref.read(onlineRepositoryProvider).auditLogs(page: _page);
      setState(() {
        _items.addAll(r.items);
        _more = _page < ((r.meta['totalPages'] as num?) ?? 1);
        _page++;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('audit.title'))),
      body: _error != null && _items.isEmpty
          ? AppErrorState(error: _error!, onRetry: () => setState(() {
                _error = null;
                _load();
              }))
          : NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _load();
                return false;
              },
              child: ListView.separated(
                padding: const EdgeInsets.all(12),
                itemCount: _items.length + 1,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  if (i == _items.length) return _loading ? const Padding(padding: EdgeInsets.all(16), child: AppLoader()) : (_items.isEmpty ? AppEmptyState(title: l.t('audit.noEntries')) : const SizedBox(height: 24));
                  final a = _items[i];
                  final changes = ((a['changes'] as List?) ?? const []).cast<Map>();
                  final who = a['actorUserId'] is Map ? (a['actorUserId'] as Map)['fullName'] : '';
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${a['action']}${a['entityLabel'] != null ? ' · ${a['entityLabel']}' : ''}'),
                    subtitle: Text([
                      '$who · ${relativeTime(parseDate(a['createdAt']) ?? DateTime.now(), locale: l.locale.languageCode)}',
                      for (final c in changes.take(4)) '${c['field']}: ${c['oldValue'] ?? '—'} → ${c['newValue'] ?? '—'}',
                    ].join('\n')),
                    isThreeLine: changes.isNotEmpty,
                  );
                },
              ),
            ),
    );
  }
}

/// Every document in the business (filter by record type and category); opens through a short-lived signed link.
class DocumentsLibraryScreen extends ConsumerStatefulWidget {
  const DocumentsLibraryScreen({super.key});
  @override
  ConsumerState<DocumentsLibraryScreen> createState() => _DocumentsLibraryScreenState();
}

class _DocumentsLibraryScreenState extends ConsumerState<DocumentsLibraryScreen> {
  String? _entityType;
  String? _category;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final repo = ref.read(onlineRepositoryProvider);
    const types = ['client', 'property', 'owner', 'deal', 'transaction', 'agreement'];
    const categories = ['REGISTRATION', 'OWNERSHIP', 'AGREEMENT', 'IDENTITY', 'PROPERTY_DOCUMENT', 'OTHER'];
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.parity.documents'))),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Row(children: [
            Expanded(child: AppDropdown<String>(label: l.t('document.entity'), value: _entityType, allowEmpty: true, items: {for (final t in types) t: l.enumLabel('entity', t)}, onChanged: (v) => setState(() => _entityType = v))),
            const SizedBox(width: 8),
            Expanded(child: AppDropdown<String>(label: l.t('document.category'), value: _category, allowEmpty: true, items: {for (final c in categories) c: l.enumLabel('documentCategory', c)}, onChanged: (v) => setState(() => _category = v))),
          ]),
        ),
        Expanded(
          child: FutureBuilder<List<Map<String, dynamic>>>(
            key: ValueKey('$_entityType-$_category'),
            future: repo.documentLibrary(entityType: _entityType, category: _category),
            builder: (context, snap) {
              if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() {}));
              if (!snap.hasData) return const AppLoader();
              if (snap.data!.isEmpty) return AppEmptyState(title: l.t('document.noDocuments'), icon: Icons.folder_open);
              return ListView(children: [
                for (final d in snap.data!)
                  ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: Text('${d['fileName']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text('${l.enumLabel('entity', d['entityType'] as String?)} · ${l.enumLabel('documentCategory', d['category'] as String?)} · ${formatDate(parseDate(d['createdAt']) ?? DateTime.now(), locale: l.locale.languageCode)}'),
                    onTap: () async {
                      try {
                        await Contact.openUrl(await repo.documentUrl(d['_id'] as String));
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                    trailing: IconButton(
                      icon: const Icon(Icons.share_outlined),
                      tooltip: l.t('common.share'),
                      onPressed: () async => SharePlus.instance.share(ShareParams(text: await repo.documentUrl(d['_id'] as String))),
                    ),
                  ),
              ]);
            },
          ),
        ),
      ]),
    );
  }
}

/// Tick or untick individual permissions for a member (same catalogue and groups as the web editor).
class PermissionEditorScreen extends ConsumerStatefulWidget {
  const PermissionEditorScreen({super.key, required this.member});
  final Map<String, dynamic> member;
  @override
  ConsumerState<PermissionEditorScreen> createState() => _PermissionEditorScreenState();
}

class _PermissionEditorScreenState extends ConsumerState<PermissionEditorScreen> {
  late final Set<String> _perms = {...((widget.member['permissions'] as List?) ?? const []).cast<String>()};
  Map<String, List<String>> _groups = const {};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    ref.read(onlineRepositoryProvider).permissionGroups().then((g) {
      if (mounted) setState(() => _groups = g);
    }).catchError((Object e) {
      if (mounted) showError(context, e);
    });
  }

  Future<void> _save() async {
    final l = context.l10n;
    setState(() => _saving = true);
    try {
      await ref.read(onlineRepositoryProvider).updateMember(widget.member['_id'] as String, {'permissions': _perms.toList()});
      if (mounted) {
        showMessage(context, l.t('user.permissionsSaved'));
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
    final name = (widget.member['user'] as Map?)?['fullName'] as String? ?? '';
    return Scaffold(
      appBar: AppBar(title: Text('${l.t('mobile.parity.permissions')} · $name')),
      body: _groups.isEmpty
          ? const AppLoader()
          : ListView(padding: const EdgeInsets.only(bottom: 96), children: [
              for (final g in _groups.entries) ...[
                SectionHeader(l.t('user.groups.${g.key}')),
                for (final p in g.value)
                  CheckboxListTile(
                    dense: true,
                    title: Text(l.enumLabel('permission', p)),
                    value: _perms.contains(p),
                    onChanged: (v) => setState(() => v == true ? _perms.add(p) : _perms.remove(p)),
                  ),
              ],
            ]),
      floatingActionButton: FloatingActionButton.extended(onPressed: _saving ? null : _save, icon: const Icon(Icons.save_outlined), label: Text(l.t('common.save'))),
    );
  }
}

/// Agreement templates: built-ins are copied, custom ones edited or archived.
class AgreementTemplatesScreen extends ConsumerStatefulWidget {
  const AgreementTemplatesScreen({super.key});
  @override
  ConsumerState<AgreementTemplatesScreen> createState() => _AgreementTemplatesScreenState();
}

class _AgreementTemplatesScreenState extends ConsumerState<AgreementTemplatesScreen> {
  int _reload = 0;

  Future<void> _edit({Map<String, dynamic>? template, bool copy = false}) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _TemplateEditor(template: template, copy: copy)));
    if (saved == true) setState(() => _reload++);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final repo = ref.read(onlineRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.parity.templates'))),
      floatingActionButton: FloatingActionButton(onPressed: () => _edit(), child: const Icon(Icons.add)),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_reload),
        future: repo.agreementTemplatesOnline(),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++));
          if (!snap.hasData) return const AppLoader();
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            for (final t in snap.data!)
              ListTile(
                title: Text('${t['name']}', style: t['archivedAt'] != null ? const TextStyle(decoration: TextDecoration.lineThrough) : null),
                subtitle: Text('${l.enumLabel('agreementKind', t['kind'] as String?)} · ${(t['language'] as String? ?? '').toUpperCase()}${t['builtIn'] == true ? ' · ${l.t('mobile.parity.builtIn')}' : ''}'),
                trailing: Wrap(children: [
                  t['builtIn'] == true
                      ? IconButton(icon: const Icon(Icons.copy_outlined), tooltip: l.t('mobile.parity.copy'), onPressed: () => _edit(template: t, copy: true))
                      : IconButton(icon: const Icon(Icons.edit_outlined), tooltip: l.t('common.edit'), onPressed: () => _edit(template: t)),
                  IconButton(
                    icon: Icon(t['archivedAt'] != null ? Icons.unarchive_outlined : Icons.archive_outlined),
                    tooltip: l.t(t['archivedAt'] != null ? 'common.restore' : 'common.archive'),
                    onPressed: () async {
                      try {
                        await repo.updateAgreementTemplate(t['_id'] as String, {'archived': t['archivedAt'] == null});
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

class _TemplateEditor extends ConsumerStatefulWidget {
  const _TemplateEditor({this.template, this.copy = false});
  final Map<String, dynamic>? template;
  final bool copy;
  @override
  ConsumerState<_TemplateEditor> createState() => _TemplateEditorState();
}

class _TemplateEditorState extends ConsumerState<_TemplateEditor> {
  late final _name = TextEditingController(text: widget.template == null ? '' : '${widget.template!['name']}${widget.copy ? ' (copy)' : ''}');
  late final _body = TextEditingController(text: widget.template?['body'] as String? ?? '');
  late String _kind = widget.template?['kind'] as String? ?? 'OTHER';
  late String _language = widget.template?['language'] as String? ?? 'en';
  bool _saving = false;

  bool get _isNew => widget.template == null || widget.copy;

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _body.text.trim().length < 20) return showMessage(context, context.t('common.required'));
    setState(() => _saving = true);
    try {
      final repo = ref.read(onlineRepositoryProvider);
      _isNew
          ? await repo.createAgreementTemplate({'name': _name.text.trim(), 'kind': _kind, 'language': _language, 'body': _body.text})
          : await repo.updateAgreementTemplate(widget.template!['_id'] as String, {'name': _name.text.trim(), 'body': _body.text});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(_isNew ? l.t('mobile.parity.newTemplate') : l.t('common.edit')), actions: [
        IconButton(icon: const Icon(Icons.save_outlined), tooltip: l.t('common.save'), onPressed: _saving ? null : _save),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppTextField(label: l.t('common.name'), controller: _name),
        const SizedBox(height: 12),
        if (_isNew) ...[
          AppDropdown<String>(label: l.t('agreement.kind'), value: _kind, items: {for (final k in const ['SALE', 'RENT', 'TOKEN_RECEIPT', 'OTHER']) k: l.enumLabel('agreementKind', k)}, onChanged: (v) => setState(() => _kind = v ?? _kind)),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('agreement.language'), value: _language, items: const {'en': 'English', 'ur': 'اردو'}, onChanged: (v) => setState(() => _language = v ?? _language)),
          const SizedBox(height: 12),
        ],
        Directionality(
          textDirection: _language == 'ur' ? TextDirection.rtl : TextDirection.ltr,
          child: AppTextField(label: l.t('mobile.parity.templateBody'), controller: _body, maxLines: 18),
        ),
      ]),
    );
  }
}

/// Income / expense categories (built-ins can be archived, custom ones renamed too).
class FinanceCategoriesScreen extends ConsumerStatefulWidget {
  const FinanceCategoriesScreen({super.key});
  @override
  ConsumerState<FinanceCategoriesScreen> createState() => _FinanceCategoriesScreenState();
}

class _FinanceCategoriesScreenState extends ConsumerState<FinanceCategoriesScreen> {
  int _reload = 0;

  Future<void> _dialog({Map<String, dynamic>? category}) async {
    final l = context.l10n;
    final name = TextEditingController(text: category?['name'] as String? ?? '');
    final nameUr = TextEditingController(text: category?['nameUr'] as String? ?? '');
    var type = category?['type'] as String? ?? 'EXPENSE';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(category == null ? l.t('category.add') : l.t('common.rename')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            if (category == null)
              SegmentedButton<String>(
                segments: [for (final t in const ['INCOME', 'EXPENSE']) ButtonSegment(value: t, label: Text(l.enumLabel('transactionType', t)))],
                selected: {type},
                onSelectionChanged: (s) => set(() => type = s.first),
              ),
            const SizedBox(height: 8),
            AppTextField(label: l.t('common.name'), controller: name, enabled: category?['isSystem'] != true),
            const SizedBox(height: 8),
            AppTextField(label: l.t('finance.nameUr'), controller: nameUr),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
          ],
        ),
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return;
    try {
      final repo = ref.read(onlineRepositoryProvider);
      if (category == null) {
        await repo.createFinanceCategory({'name': name.text.trim(), if (nameUr.text.trim().isNotEmpty) 'nameUr': nameUr.text.trim(), 'type': type});
      } else {
        await repo.updateFinanceCategory(category['_id'] as String, {if (category['isSystem'] != true) 'name': name.text.trim(), 'nameUr': nameUr.text.trim()});
      }
      setState(() => _reload++);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final repo = ref.read(onlineRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.parity.financeCategories'))),
      floatingActionButton: FloatingActionButton(onPressed: () => _dialog(), child: const Icon(Icons.add)),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        key: ValueKey(_reload),
        future: repo.financeCategories(),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++));
          if (!snap.hasData) return const AppLoader();
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            for (final c in snap.data!)
              ListTile(
                title: Text(l.isRtl && (c['nameUr'] as String? ?? '').isNotEmpty ? c['nameUr'] as String : '${c['name']}',
                    style: c['archivedAt'] != null ? const TextStyle(decoration: TextDecoration.lineThrough) : null),
                subtitle: Text(l.enumLabel('transactionType', c['type'] as String?) + (c['isSystem'] == true ? ' · ${l.t('mobile.parity.builtIn')}' : '')),
                trailing: Wrap(children: [
                  IconButton(icon: const Icon(Icons.edit_outlined), tooltip: l.t('common.rename'), onPressed: () => _dialog(category: c)),
                  IconButton(
                    icon: Icon(c['archivedAt'] != null ? Icons.unarchive_outlined : Icons.archive_outlined),
                    tooltip: l.t(c['archivedAt'] != null ? 'common.restore' : 'common.archive'),
                    onPressed: () async {
                      try {
                        await repo.updateFinanceCategory(c['_id'] as String, {'archived': c['archivedAt'] == null});
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
