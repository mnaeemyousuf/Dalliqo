import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../clients/client_screens.dart';
import '../properties/property_screens.dart';
import 'online_kit.dart';

/// Saved views (named filter sets, shared with the web), portal link management, sending through
/// WhatsApp Business and the AI usage screen.

// ───────────── Saved views ─────────────
// A view stores the same parameter names the web list pages use, so a view saved on the web
// opens on the phone and the other way round. Parameters the phone has no filter for are ignored.

num? _n(Object? v) => v == null || '$v'.isEmpty ? null : num.tryParse('$v');
String? _s(Object? v) => v == null || '$v'.isEmpty ? null : '$v';

Map<String, String> clientViewParams(ClientFilter f) => {
      if (f.search.isNotEmpty) 'q': f.search,
      if (f.categoryId != null) 'categoryId': f.categoryId!,
      if (f.status != null) 'status': f.status!,
      if (f.purpose != null) 'purpose': f.purpose!,
      if (f.propertyType != null) 'propertyType': f.propertyType!,
      if (f.assignedTo != null) 'assignedTo': f.assignedTo!,
      if (f.source != null) 'source': f.source!,
      if (f.temperature != null) 'temperature': f.temperature!,
      if (f.unassigned) 'unassigned': 'true',
      if (f.area != null) 'area': f.area!,
      if (f.block != null) 'block': f.block!,
      if (f.minBudget != null) 'minBudget': '${f.minBudget}',
      if (f.maxBudget != null) 'maxBudget': '${f.maxBudget}',
      if (f.minSize != null) 'minSize': '${f.minSize}',
      if (f.maxSize != null) 'maxSize': '${f.maxSize}',
      if (f.minSize != null || f.maxSize != null) 'sizeUnit': f.sizeUnit,
    };

ClientFilter clientFilterFromView(Map<String, dynamic> p) => ClientFilter(
      search: '${p['q'] ?? ''}',
      categoryId: _s(p['categoryId']),
      status: _s(p['status']),
      purpose: _s(p['purpose']),
      propertyType: _s(p['propertyType']),
      assignedTo: _s(p['assignedTo']),
      source: _s(p['source']),
      temperature: _s(p['temperature']),
      unassigned: p['unassigned'] == 'true' || p['unassigned'] == true,
      area: _s(p['area']),
      block: _s(p['block']),
      minBudget: _n(p['minBudget']),
      maxBudget: _n(p['maxBudget']),
      minSize: _n(p['minSize']),
      maxSize: _n(p['maxSize']),
      sizeUnit: _s(p['sizeUnit']) ?? 'SQ_YARD',
    );

Map<String, String> propertyViewParams(PropertyFilter f) => {
      if (f.search.isNotEmpty) 'q': f.search,
      if (f.type != null) 'propertyType': f.type!,
      if (f.status != null) 'status': f.status!,
      if (f.purpose != null) 'listingPurpose': f.purpose!,
      if (f.area != null) 'area': f.area!,
      if (f.society != null) 'society': f.society!,
      if (f.block != null) 'block': f.block!,
      if (f.minPrice != null) 'minPrice': '${f.minPrice}',
      if (f.maxPrice != null) 'maxPrice': '${f.maxPrice}',
      if (f.minSize != null) 'minSize': '${f.minSize}',
      if (f.maxSize != null) 'maxSize': '${f.maxSize}',
      if (f.minSize != null || f.maxSize != null) 'sizeUnit': f.sizeUnit,
      if (f.ownerId != null) 'ownerId': f.ownerId!,
      if (f.needsVerification) 'verification': 'stale',
    };

PropertyFilter propertyFilterFromView(Map<String, dynamic> p) => PropertyFilter(
      search: '${p['q'] ?? ''}',
      type: _s(p['propertyType']),
      status: _s(p['status']),
      purpose: _s(p['listingPurpose']),
      area: _s(p['area']),
      society: _s(p['society']),
      block: _s(p['block']),
      minPrice: _n(p['minPrice']),
      maxPrice: _n(p['maxPrice']),
      minSize: _n(p['minSize']),
      maxSize: _n(p['maxSize']),
      sizeUnit: _s(p['sizeUnit']) ?? 'SQ_YARD',
      ownerId: _s(p['ownerId']),
      needsVerification: p['verification'] == 'stale',
    );

/// App-bar button on the client / property list: open a saved view or save the current filters.
class SavedViewsButton extends ConsumerWidget {
  const SavedViewsButton({super.key, required this.page});
  final String page; // clients | properties

  @override
  Widget build(BuildContext context, WidgetRef ref) => IconButton(
        tooltip: context.t('mm.sv.title'),
        icon: const Icon(Icons.bookmarks_outlined),
        onPressed: () => showAppBottomSheet<void>(context, title: context.t('mm.sv.title'), child: _SavedViews(page: page)),
      );
}

class _SavedViews extends ConsumerStatefulWidget {
  const _SavedViews({required this.page});
  final String page;
  @override
  ConsumerState<_SavedViews> createState() => _SavedViewsState();
}

class _SavedViewsState extends ConsumerState<_SavedViews> {
  int _version = 0;

  Map<String, String> _current() => widget.page == 'clients' ? clientViewParams(ref.read(clientFilterProvider)) : propertyViewParams(ref.read(propertyFilterProvider));

  void _apply(Map<String, dynamic> params) {
    if (widget.page == 'clients') {
      ref.read(clientFilterProvider.notifier).state = clientFilterFromView(params);
    } else {
      ref.read(propertyFilterProvider.notifier).state = propertyFilterFromView(params);
    }
    Navigator.pop(context);
  }

  Future<void> _save() async {
    final l = context.l10n;
    final params = _current();
    if (params.isEmpty) return showMessage(context, l.t('mm.sv.nothing'));
    final f = await showFormSheet(context, title: l.t('mm.sv.save'), fields: [
      FormFieldSpec('name', l.t('common.name'), required: true),
      FormFieldSpec('shared', l.t('mm.sv.shared'), kind: FieldKind.toggle),
    ]);
    if (f == null || !mounted) return;
    if (await runAction(context, () => apiOf(ref).post<Object?>('/saved-views', {'page': widget.page, 'name': f['name'], 'params': params, 'shared': f['shared'] == true}))) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final me = ref.watch(authProvider).userId;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      SizedBox(
        height: 260,
        child: OnlineView<List<Json>>(
          key: ValueKey(_version),
          load: () async => listOf(await apiOf(ref).get<List<dynamic>>('/saved-views', query: {'page': widget.page})),
          builder: (context, views, _) => views.isEmpty
              ? ListView(children: [Padding(padding: const EdgeInsets.all(16), child: Text(l.t('mm.sv.none'), textAlign: TextAlign.center))])
              : ListView(children: [
                  for (final v in views)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(v['shared'] == true ? Icons.groups_outlined : Icons.bookmark_outline),
                      title: Text(str(v['name'])),
                      subtitle: Text(mapOf(v['params']).entries.map((e) => '${e.key}: ${e.value}').join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
                      onTap: () => _apply(mapOf(v['params'])),
                      trailing: refId(v['userId']) != me
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.delete_outline),
                              tooltip: l.t('common.delete'),
                              onPressed: () async {
                                if (await runAction(context, () => apiOf(ref).delete<Object?>('/saved-views/${v['_id']}'), done: l.t('common.deleted'))) setState(() => _version++);
                              },
                            ),
                    ),
                ]),
        ),
      ),
      AppButton(label: l.t('mm.sv.save'), icon: Icons.bookmark_add_outlined, onPressed: _save, expand: true),
    ]);
  }
}

// ───────────── Portal links of one client / owner ─────────────

class PortalLinksScreen extends ConsumerStatefulWidget {
  const PortalLinksScreen({super.key, required this.kind, required this.partyId, required this.name});
  final String kind;
  final String partyId;
  final String name;
  @override
  ConsumerState<PortalLinksScreen> createState() => _PortalLinksState();
}

class _PortalLinksState extends ConsumerState<PortalLinksScreen> {
  int _version = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.pl.$k');
    final canRevoke = ref.watch(authProvider).can('clients:update');
    return Scaffold(
      appBar: AppBar(title: Text('${t('title')} · ${widget.name}')),
      body: OnlineView<List<Json>>(
        key: ValueKey(_version),
        load: () async => listOf(await apiOf(ref).get<List<dynamic>>('/portal-links', query: {'kind': widget.kind, 'partyId': widget.partyId})),
        builder: (context, links, _) => links.isEmpty
            ? ListView(children: [AppEmptyState(title: t('none'), icon: Icons.link_off)])
            : ListView(padding: const EdgeInsets.all(16), children: [
                for (final k in links)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.link),
                    title: Text('${t('expires')} ${day(context, k['expiresAt'])}'),
                    subtitle: Text('${t('opened')} ${numOf(k['useCount']).toInt()}${k['lastUsedAt'] == null ? '' : ' · ${day(context, k['lastUsedAt'])}'}'),
                    trailing: k['revokedAt'] != null
                        ? AppChip(t('revoked'), tone: ChipTone.red)
                        : !canRevoke
                            ? null
                            : TextButton(
                                onPressed: () async {
                                  if (!await confirmDialog(context, title: t('revoke'), message: t('revokeHint'), confirmLabel: t('revoke')) || !context.mounted) return;
                                  if (await runAction(context, () => apiOf(ref).delete<Object?>('/portal-links/${k['_id']}'))) setState(() => _version++);
                                },
                                child: Text(t('revoke')),
                              ),
                  ),
              ]),
      ),
    );
  }
}

// ───────────── Send through WhatsApp Business ─────────────

/// Sends a message with the business's WhatsApp number when it is connected; otherwise the server
/// returns a wa.me link and WhatsApp opens with the text ready to send.
Future<void> showWhatsAppSend(BuildContext context, WidgetRef ref, {List<Json> templates = const [], String? to, String? clientId}) async {
  final l = context.l10n;
  String t(String k) => l.t('mm.ws.$k');
  final f = await showFormSheet(context, title: t('send'), note: t('hint'), fields: [
    FormFieldSpec('to', t('to'), initial: to, required: true, ltr: true, hint: '03xx xxxxxxx'),
    FormFieldSpec('text', t('text'), kind: FieldKind.multiline, required: true),
    if (templates.isNotEmpty) FormFieldSpec('template', t('template'), kind: FieldKind.select, options: {for (final x in templates) '${x['name']}|${x['language']}': '${x['name']} · ${x['language']}'}),
  ]);
  if (f == null || !context.mounted) return;
  try {
    final tpl = f['template'] == null ? null : '${f['template']}'.split('|');
    final r = await apiOf(ref).post<Json>('/whatsapp/send', {
      'to': f['to'],
      'text': f['text'],
      'clientId': ?clientId,
      if (tpl != null) 'template': {'name': tpl[0], 'language': tpl[1], 'params': <String>[]},
    });
    if (!context.mounted) return;
    if (r['mode'] == 'link') {
      await launchUrl(Uri.parse(str(r['url'])), mode: LaunchMode.externalApplication);
    } else {
      showMessage(context, t('sent'));
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

// ───────────── AI usage ─────────────

class AiStatusScreen extends ConsumerWidget {
  const AiStatusScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ai.$k');
    return Scaffold(
      appBar: AppBar(title: Text(t('title'))),
      body: OnlineView<Json>(
        load: () => apiOf(ref).get<Json>('/ai/status'),
        builder: (context, s, _) => ListView(padding: const EdgeInsets.all(16), children: [
          StatCard(rows: [
            (t('state'), s['configured'] == true ? t('on') : t('off')),
            if (s['configured'] == true) (t('model'), str(s['model'])),
            (t('used'), '${numOf(s['usedThisMonth']).toInt()} / ${numOf(s['monthlyLimit']).toInt()}'),
          ]),
          Text(s['configured'] == true ? t('onHint') : t('offHint'), style: Theme.of(context).textTheme.bodySmall),
          if ((s['tools'] as List? ?? const []).isNotEmpty) ...[
            SectionHeader(t('tools')),
            Wrap(spacing: 6, runSpacing: 6, children: [for (final x in s['tools'] as List) Chip(label: Text('$x'.replaceAll('_', ' ')))]),
          ],
          const SizedBox(height: 12),
          AppButton(
            label: l.t('common.copy'),
            icon: Icons.copy,
            outlined: true,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: '${t('used')}: ${numOf(s['usedThisMonth']).toInt()} / ${numOf(s['monthlyLimit']).toInt()}'));
              if (context.mounted) showMessage(context, l.t('common.copied'));
            },
          ),
        ]),
      ),
    );
  }
}
