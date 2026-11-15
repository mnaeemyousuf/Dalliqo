import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';
import 'online_kit.dart';
import 'reports_screens.dart';

/// Marketing on the phone: the agency website, website / WhatsApp inquiries, campaigns with
/// their results, who gets new leads, the client / owner portal switches and WhatsApp Business.

const _channels = ['FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'YOUTUBE', 'TIKTOK', 'PORTAL', 'WHATSAPP', 'SMS', 'EMAIL', 'PRINT', 'BILLBOARD', 'EVENT', 'REFERRAL', 'OTHER'];
const _campaignStatuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];

class MarketingHubScreen extends ConsumerWidget {
  const MarketingHubScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final manage = auth.can('marketing:manage');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.mk.title'))),
      body: ListView(children: [
        if (auth.can('clients:read')) MenuTile(icon: Icons.mark_email_unread_outlined, title: l.t('mm.mk.inquiries'), subtitle: l.t('mm.mk.inquiriesHint'), page: () => const InquiriesScreen()),
        if (auth.can('clients:read')) MenuTile(icon: Icons.campaign_outlined, title: l.t('mm.mk.campaigns'), subtitle: l.t('mm.mk.campaignsHint'), page: () => const CampaignsScreen()),
        if (auth.can('reports:read') && manage) MenuTile(icon: Icons.query_stats, title: l.t('mm.reports.campaigns'), page: () => const ReportsHubScreen()),
        if (manage) MenuTile(icon: Icons.language, title: l.t('mm.mk.website'), subtitle: l.t('mm.mk.websiteHint'), page: () => const WebsiteSettingsScreen()),
        if (manage) MenuTile(icon: Icons.link, title: l.t('mm.mk.portal'), subtitle: l.t('mm.mk.portalHint'), page: () => const PortalSettingsScreen()),
        if (manage) MenuTile(icon: Icons.chat_outlined, title: l.t('mm.mk.whatsapp'), subtitle: l.t('mm.mk.whatsappHint'), page: () => const WhatsAppScreen()),
        if (auth.can('settings:manage')) MenuTile(icon: Icons.alt_route, title: l.t('mm.mk.assign'), subtitle: l.t('mm.mk.assignHint'), page: () => const LeadAssignmentScreen()),
      ]),
    );
  }
}

// ───────────── Inquiries ─────────────

class InquiriesScreen extends ConsumerStatefulWidget {
  const InquiriesScreen({super.key});
  @override
  ConsumerState<InquiriesScreen> createState() => _InquiriesState();
}

class _InquiriesState extends ConsumerState<InquiriesScreen> {
  String? _status = 'NEW';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final canUpdate = ref.watch(authProvider).can('clients:update');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.mk.inquiries'))),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: AppDropdown<String>(label: l.t('common.status'), value: _status, allowEmpty: true, items: {for (final s in const ['NEW', 'CONTACTED', 'SPAM']) s: l.enumLabel('inquiryStatus', s)}, onChanged: (v) => setState(() => _status = v)),
        ),
        Expanded(
          child: OnlineView<List<Json>>(
            key: ValueKey(_status),
            load: () async => (await apiOf(ref).page('/inquiries', query: {'limit': 50, 'status': _status})).items,
            builder: (context, items, reload) {
              if (items.isEmpty) return ListView(children: [AppEmptyState(title: l.t('mm.mk.noInquiries'), icon: Icons.mark_email_read_outlined)]);
              return ListView(padding: const EdgeInsets.all(16), children: [
                for (final q in items)
                  Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(str(q['name']), style: const TextStyle(fontWeight: FontWeight.w700))),
                          AppChip(l.enumLabel('inquiryStatus', str(q['status'])), tone: q['status'] == 'NEW' ? ChipTone.amber : q['status'] == 'SPAM' ? ChipTone.red : ChipTone.green),
                        ]),
                        Ltr(str(q['phone'])),
                        if (str(q['message']).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(str(q['message']))),
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            [
                              str(q['channel']),
                              if (q['propertyId'] is Map) str(mapOf(q['propertyId'])['propertyId']),
                              if (q['campaignId'] is Map) refName(q['campaignId']),
                              if (q['assignedTo'] is Map) refName(q['assignedTo']),
                              day(context, q['createdAt']),
                            ].where((x) => x.isNotEmpty).join(' · '),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        Wrap(spacing: 4, children: [
                          TextButton.icon(icon: const Icon(Icons.call, size: 18), label: Text(l.t('mm.mk.call')), onPressed: () => launchUrl(Uri.parse('tel:${str(q['phone'])}'))),
                          if (canUpdate && q['status'] != 'CONTACTED') TextButton(onPressed: () async => await runAction(context, () => apiOf(ref).patch<Object?>('/inquiries/${q['_id']}', {'status': 'CONTACTED'})) ? reload() : null, child: Text(l.t('mm.mk.markContacted'))),
                          if (canUpdate && q['status'] != 'SPAM') TextButton(onPressed: () async => await runAction(context, () => apiOf(ref).patch<Object?>('/inquiries/${q['_id']}', {'status': 'SPAM'})) ? reload() : null, child: Text(l.t('mm.mk.markSpam'))),
                        ]),
                      ]),
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

// ───────────── Campaigns ─────────────

class CampaignsScreen extends ConsumerStatefulWidget {
  const CampaignsScreen({super.key});
  @override
  ConsumerState<CampaignsScreen> createState() => _CampaignsState();
}

class _CampaignsState extends ConsumerState<CampaignsScreen> {
  int _version = 0;

  Future<void> _edit(Json? c) async {
    final l = context.l10n;
    String t(String k) => l.t('mm.mk.$k');
    final v = await showFormSheet(context, title: c == null ? t('newCampaign') : str(c['name']), fields: [
      FormFieldSpec('name', l.t('common.name'), initial: c?['name'], required: true),
      FormFieldSpec('channel', t('channel'), kind: FieldKind.select, required: true, initial: c?['channel'] ?? 'FACEBOOK', options: {for (final x in _channels) x: l.enumLabel('campaignChannel', x)}),
      FormFieldSpec('status', l.t('common.status'), kind: FieldKind.select, required: true, initial: c?['status'] ?? 'ACTIVE', options: {for (final x in _campaignStatuses) x: l.enumLabel('campaignStatus', x)}),
      FormFieldSpec('budget', t('budget'), kind: FieldKind.number, initial: c?['budget']),
      FormFieldSpec('spend', t('spend'), kind: FieldKind.number, initial: c?['spend']),
      FormFieldSpec('startDate', t('startDate'), kind: FieldKind.date, initial: c?['startDate']),
      FormFieldSpec('endDate', t('endDate'), kind: FieldKind.date, initial: c?['endDate']),
      FormFieldSpec('notes', l.t('mm.notes'), kind: FieldKind.multiline, initial: c?['notes']),
    ]);
    if (v == null || !mounted) return;
    final ok = await runAction(context, () => c == null ? apiOf(ref).post<Object?>('/campaigns', v) : apiOf(ref).patch<Object?>('/campaigns/${c['_id']}', v));
    if (ok) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.mk.$k');
    final manage = ref.watch(authProvider).can('marketing:manage');
    return Scaffold(
      appBar: AppBar(title: Text(t('campaigns'))),
      floatingActionButton: manage ? FloatingActionButton(onPressed: () => _edit(null), child: const Icon(Icons.add)) : null,
      body: OnlineView<List<Json>>(
        key: ValueKey(_version),
        load: () async => (await apiOf(ref).page('/campaigns', query: {'limit': 50})).items,
        builder: (context, items, reload) {
          if (items.isEmpty) return ListView(children: [AppEmptyState(title: t('noCampaigns'), hint: t('campaignsHint'), icon: Icons.campaign_outlined)]);
          return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
            for (final c in items)
              StatCard(
                title: '${str(c['name'])} · ${l.enumLabel('campaignStatus', str(c['status']))}',
                trailing: !manage
                    ? null
                    : PopupMenuButton<String>(
                        onSelected: (a) async {
                          if (a == 'edit') return _edit(c);
                          if (a == 'link') {
                            await Clipboard.setData(ClipboardData(text: '?c=${str(c['code'])}'));
                            if (context.mounted) showMessage(context, t('codeCopied'));
                            return;
                          }
                          if (await confirmDialog(context, title: l.t('common.areYouSure'), message: t('deleteCampaign')) && context.mounted) {
                            if (await runAction(context, () => apiOf(ref).delete<Object?>('/campaigns/${c['_id']}'))) setState(() => _version++);
                          }
                        },
                        itemBuilder: (_) => [
                          PopupMenuItem(value: 'edit', child: Text(l.t('common.edit'))),
                          PopupMenuItem(value: 'link', child: Text(t('copyCode'))),
                          PopupMenuItem(value: 'delete', child: Text(l.t('common.delete'))),
                        ],
                      ),
                rows: [
                  (t('channel'), l.enumLabel('campaignChannel', str(c['channel']))),
                  (t('code'), str(c['code'])),
                  (t('budget'), money(context, c['budget'])),
                  (t('spend'), money(context, mapOf(c['metrics'])['spend'] ?? c['spend'])),
                  (l.t('mm.r.newLeads'), '${numOf(mapOf(c['metrics'])['leads'])}'),
                  (l.t('mm.r.won'), '${numOf(mapOf(c['metrics'])['won'])}'),
                  (l.t('mm.r.revenue'), money(context, mapOf(c['metrics'])['revenue'])),
                  (l.t('mm.r.roi'), mapOf(c['metrics'])['roiPct'] == null ? '—' : '${numOf(mapOf(c['metrics'])['roiPct']).round()}%'),
                ],
              ),
          ]);
        },
      ),
    );
  }
}

// ───────────── Website ─────────────

class WebsiteSettingsScreen extends ConsumerStatefulWidget {
  const WebsiteSettingsScreen({super.key});
  @override
  ConsumerState<WebsiteSettingsScreen> createState() => _WebsiteState();
}

class _WebsiteState extends ConsumerState<WebsiteSettingsScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.mk.$k');
    return Scaffold(
      appBar: AppBar(title: Text(t('website'))),
      body: OnlineView<Json>(
        key: ValueKey(_version),
        load: () => apiOf(ref).get<Json>('/website'),
        builder: (context, w, reload) {
          final slug = str(w['slug']);
          final url = str(w['url']);
          Future<void> save(Json body) async {
            if (await runAction(context, () => apiOf(ref).dio.put<Object?>('/website', data: body))) setState(() => _version++);
          }

          return ListView(padding: const EdgeInsets.all(16), children: [
            SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(t('siteOnline')), subtitle: url.isEmpty ? Text(t('siteNeedsAddress')) : Ltr(url), value: w['enabled'] == true, onChanged: (v) => save({'enabled': v, if (slug.isEmpty) 'slug': str(w['suggestedSlug'])})),
            StatCard(rows: [(t('published'), '${numOf(w['publishedListings'])}'), (t('newInquiries'), '${numOf(w['newInquiries'])}')]),
            StatCard(title: t('siteDetails'), rows: [(t('address'), slug.isEmpty ? '—' : slug), (t('tagline'), str(w['tagline'])), (l.t('common.phone'), str(w['phone'])), ('WhatsApp', str(w['whatsapp'])), (l.t('common.email'), str(w['email'])), (t('showAgents'), w['showAgents'] == true ? l.t('common.yes') : l.t('common.no'))]),
            AppButton(
              label: l.t('common.edit'),
              icon: Icons.edit_outlined,
              outlined: true,
              onPressed: () async {
                final v = await showFormSheet(context, title: t('siteDetails'), fields: [
                  FormFieldSpec('slug', t('address'), initial: slug.isEmpty ? w['suggestedSlug'] : slug, required: true, ltr: true),
                  FormFieldSpec('tagline', t('tagline'), initial: w['tagline']),
                  FormFieldSpec('about', t('about'), kind: FieldKind.multiline, initial: w['about']),
                  FormFieldSpec('phone', l.t('common.phone'), initial: w['phone'], ltr: true),
                  FormFieldSpec('whatsapp', 'WhatsApp', initial: w['whatsapp'], ltr: true),
                  FormFieldSpec('email', l.t('common.email'), initial: w['email'], ltr: true),
                  FormFieldSpec('showAgents', t('showAgents'), kind: FieldKind.toggle, initial: w['showAgents'] == true),
                ]);
                if (v != null) await save({for (final k in const ['tagline', 'about', 'phone', 'whatsapp', 'email']) k: v[k], 'slug': v['slug'], 'showAgents': v['showAgents'] == true});
              },
            ),
            if (url.isNotEmpty) ...[
              const SizedBox(height: 8),
              AppButton(label: t('copyLink'), icon: Icons.copy, outlined: true, onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (context.mounted) showMessage(context, t('linkCopied'));
              }),
              const SizedBox(height: 8),
              AppButton(label: t('openSite'), icon: Icons.open_in_new, outlined: true, onPressed: () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication)),
            ],
            const SizedBox(height: 12),
            Text(t('publishHint'), style: Theme.of(context).textTheme.bodySmall),
          ]);
        },
      ),
    );
  }
}

// ───────────── Portal switches ─────────────

class PortalSettingsScreen extends ConsumerStatefulWidget {
  const PortalSettingsScreen({super.key});
  @override
  ConsumerState<PortalSettingsScreen> createState() => _PortalState();
}

class _PortalState extends ConsumerState<PortalSettingsScreen> {
  int _version = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.mk.portal'))),
      body: OnlineView<Json>(
        key: ValueKey(_version),
        load: () => apiOf(ref).get<Json>('/portal-settings'),
        builder: (context, s, _) => ListView(padding: const EdgeInsets.all(16), children: [
          Text(l.t('mm.mk.portalIntro'), style: Theme.of(context).textTheme.bodySmall),
          for (final k in const ['showMatches', 'allowPreferenceUpdates', 'allowVisitRequests', 'showDocuments', 'showOwnerInquiries', 'showOwnerOffers', 'allowOwnerAvailabilityUpdates'])
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.t('mm.portal.$k')),
              value: s[k] != false,
              onChanged: (v) async {
                if (await runAction(context, () => apiOf(ref).dio.put<Object?>('/portal-settings', data: {k: v}))) setState(() => _version++);
              },
            ),
        ]),
      ),
    );
  }
}

// ───────────── WhatsApp Business ─────────────

class WhatsAppScreen extends ConsumerStatefulWidget {
  const WhatsAppScreen({super.key});
  @override
  ConsumerState<WhatsAppScreen> createState() => _WhatsAppState();
}

class _WhatsAppState extends ConsumerState<WhatsAppScreen> {
  int _version = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.wa.$k');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.mk.whatsapp'))),
      body: OnlineView<Json>(
        key: ValueKey(_version),
        load: () => apiOf(ref).get<Json>('/whatsapp'),
        builder: (context, w, _) {
          final cloud = w['mode'] == 'cloud';
          return ListView(padding: const EdgeInsets.all(16), children: [
            StatCard(rows: [
              (t('mode'), cloud ? t('modeCloud') : t('modeLink')),
              (t('platform'), w['platformConfigured'] == true ? l.t('common.yes') : l.t('common.no')),
              (t('number'), str(w['displayNumber']).isEmpty ? '—' : str(w['displayNumber'])),
              (t('phoneNumberId'), str(w['phoneNumberId']).isEmpty ? '—' : str(w['phoneNumberId'])),
            ]),
            Text(cloud ? t('cloudHint') : t('linkHint'), style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 12),
            AppButton(
              label: l.t('common.edit'),
              icon: Icons.edit_outlined,
              outlined: true,
              onPressed: () async {
                final v = await showFormSheet(context, title: l.t('mm.mk.whatsapp'), note: t('idsHint'), fields: [
                  FormFieldSpec('phoneNumberId', t('phoneNumberId'), initial: w['phoneNumberId'], ltr: true),
                  FormFieldSpec('businessAccountId', t('businessAccountId'), initial: w['businessAccountId'], ltr: true),
                  FormFieldSpec('displayNumber', t('number'), initial: w['displayNumber'], ltr: true),
                ]);
                if (v == null || !context.mounted) return;
                if (await runAction(context, () => apiOf(ref).dio.put<Object?>('/whatsapp', data: {for (final k in const ['phoneNumberId', 'businessAccountId', 'displayNumber']) k: v[k]}))) setState(() => _version++);
              },
            ),
            SectionHeader(
              t('templates'),
              trailing: TextButton(onPressed: () async => await runAction(context, () => apiOf(ref).post<Object?>('/whatsapp/templates/sync')) ? setState(() => _version++) : null, child: Text(t('sync'))),
            ),
            if (listOf(w['templates']).isEmpty) Text(t('noTemplates'), style: Theme.of(context).textTheme.bodySmall),
            for (final x in listOf(w['templates'])) ListTile(contentPadding: EdgeInsets.zero, title: Ltr('${str(x['name'])} · ${str(x['language'])}'), subtitle: Text(str(x['body']), maxLines: 3, overflow: TextOverflow.ellipsis)),
          ]);
        },
      ),
    );
  }
}

// ───────────── Who gets new leads ─────────────

class LeadAssignmentScreen extends ConsumerStatefulWidget {
  const LeadAssignmentScreen({super.key});
  @override
  ConsumerState<LeadAssignmentScreen> createState() => _LeadAssignState();
}

class _LeadAssignState extends ConsumerState<LeadAssignmentScreen> {
  Json? _draft;
  bool _saving = false;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.la.$k');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.mk.assign'))),
      body: OnlineView<(Json, List<Json>)>(
        load: () async => (await apiOf(ref).get<Json>('/settings'), (await apiOf(ref).page('/members', query: {'limit': 100})).items),
        builder: (context, data, reload) {
          final d = _draft ??= {...mapOf(data.$1['leadAssignment'])};
          final members = {for (final x in data.$2.where((x) => x['status'] == 'ACTIVE')) str(mapOf(x['user'])['_id']): str(mapOf(x['user'])['fullName'])};
          final pool = ((d['agentIds'] as List?) ?? const []).map((e) => '$e').toList();
          final bySource = listOf(d['bySource']);
          String? sourceUser(String s) => bySource.where((r) => r['source'] == s).map((r) => str(r['userId'])).firstOrNull;
          return ListView(padding: const EdgeInsets.all(16), children: [
            SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(t('listingAgent')), value: d['preferListingAgent'] != false, onChanged: (v) => setState(() => d['preferListingAgent'] = v)),
            AppDropdown<String>(label: t('mode'), value: str(d['mode']).isEmpty ? 'NONE' : str(d['mode']), items: {for (final x in const ['NONE', 'ROUND_ROBIN', 'BY_SOURCE']) x: t(x)}, onChanged: (v) => setState(() => d['mode'] = v)),
            if (d['mode'] != 'NONE' && d['mode'] != null) ...[
              SectionHeader(t('pool')),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final e in members.entries)
                  FilterChip(label: Text(e.value), selected: pool.contains(e.key), onSelected: (on) => setState(() => d['agentIds'] = on ? [...pool, e.key] : pool.where((x) => x != e.key).toList())),
              ]),
            ],
            if (d['mode'] == 'BY_SOURCE')
              for (final s in const ['WEBSITE', 'WHATSAPP'])
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: AppDropdown<String>(
                    label: l.enumLabel('source', s),
                    value: sourceUser(s),
                    allowEmpty: true,
                    items: members,
                    onChanged: (v) => setState(() => d['bySource'] = [...bySource.where((r) => r['source'] != s), if (v != null) {'source': s, 'userId': v}]),
                  ),
                ),
            const SizedBox(height: 12),
            Text(t('hint'), style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            AppButton(
              label: l.t('common.save'),
              expand: true,
              loading: _saving,
              onPressed: () async {
                setState(() => _saving = true);
                await runAction(context, () => apiOf(ref).patch<Object?>('/settings', {'leadAssignment': {'mode': d['mode'] ?? 'NONE', 'preferListingAgent': d['preferListingAgent'] != false, 'agentIds': d['agentIds'] ?? const [], 'bySource': [for (final r in listOf(d['bySource'])) {'source': r['source'], 'userId': r['userId']}]}}));
                if (mounted) setState(() => _saving = false);
              },
            ),
          ]);
        },
      ),
    );
  }
}
