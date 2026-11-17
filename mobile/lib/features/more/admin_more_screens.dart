import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/commission/commission.dart';
import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';
import 'extras.dart';
import 'online_kit.dart';

/// Administration on the phone: the settings the web has under Settings → Business, Automation,
/// Matching & deals, Security and Subscription, plus Excel imports and platform administration.

const _automationKeys = ['HOT_LEAD_UNCONTACTED', 'LEAD_INACTIVE', 'PROPERTY_REVERIFY', 'LISTING_EXPIRY', 'DEAL_STUCK_NEGOTIATION', 'AGREEMENT_EXPIRING', 'VERIFICATION_DUE', 'RENT_DUE', 'RENT_OVERDUE', 'INSTALLMENT_OVERDUE'];
const _automationUnits = {'HOT_LEAD_UNCONTACTED': 'minutes'};
const _scoreFactors = ['budget', 'location', 'category', 'intent', 'engagement', 'followUps', 'timeline'];
const _apiKeyPermissions = [
  'clients:read', 'clients:create', 'clients:update', 'properties:read', 'properties:create', 'properties:update', 'owners:read', 'owners:create', 'owners:update',
  'matches:read', 'followups:read', 'followups:create', 'followups:update', 'notes:create', 'deals:read', 'deals:read_all', 'deals:create', 'deals:update',
  'finance:read', 'rentals:read', 'reports:read',
];
const _plans = ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'];

class AdminHubScreen extends ConsumerWidget {
  const AdminHubScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    final auth = ref.watch(authProvider);
    final settings = auth.can('settings:manage');
    return Scaffold(
      appBar: AppBar(title: Text(t('title'))),
      body: ListView(children: [
        if (auth.can('business:manage')) MenuTile(icon: Icons.business_outlined, title: t('business'), page: () => const BusinessProfileScreen()),
        MenuTile(icon: Icons.workspace_premium_outlined, title: t('subscription'), page: () => const SubscriptionScreen()),
        MenuTile(icon: Icons.auto_awesome_outlined, title: l.t('mm.ai.title'), subtitle: l.t('mm.ai.hint'), page: () => const AiStatusScreen()),
        if (settings) ...[
          MenuTile(icon: Icons.auto_mode, title: t('automation'), subtitle: t('automationHint'), page: () => const AutomationScreen()),
          MenuTile(icon: Icons.speed, title: t('scoring'), subtitle: t('scoringHint'), page: () => const LeadScoringScreen()),
          MenuTile(icon: Icons.linear_scale, title: t('pipeline'), subtitle: t('pipelineHint'), page: () => const PipelineScreen()),
          MenuTile(icon: Icons.percent, title: t('rules'), subtitle: t('rulesHint'), page: () => const CommissionRulesScreen()),
          MenuTile(icon: Icons.auto_delete_outlined, title: t('retention'), subtitle: t('retentionHint'), page: () => const RetentionScreen()),
          MenuTile(icon: Icons.key_outlined, title: t('apiKeys'), subtitle: t('apiKeysHint'), page: () => const ApiKeysScreen()),
        ],
        if (auth.can('clients:create') || auth.can('properties:create')) MenuTile(icon: Icons.upload_file_outlined, title: t('import'), subtitle: t('importHint'), page: () => const ImportScreen()),
        if (auth.can('members:manage')) MenuTile(icon: Icons.lock_reset, title: t('resetPassword'), subtitle: t('resetPasswordHint'), page: () => const MemberPasswordScreen()),
        MenuTile(icon: Icons.admin_panel_settings_outlined, title: t('platform'), subtitle: t('platformHint'), page: () => const PlatformScreen()),
        ListTile(
          leading: const Icon(Icons.logout),
          title: Text(t('signOutAll')),
          subtitle: Text(t('signOutAllHint')),
          onTap: () async {
            if (!await confirmDialog(context, title: t('signOutAll'), message: t('signOutAllHint'), confirmLabel: t('signOutAll')) || !context.mounted) return;
            if (await runAction(context, () => apiOf(ref).post<Object?>('/auth/logout-all'))) await ref.read(authProvider.notifier).signOut(callServer: false);
          },
        ),
      ]),
    );
  }
}

/// A settings screen that loads /settings, lets [build] edit a draft, and saves [body].
class _SettingsEditor extends ConsumerStatefulWidget {
  const _SettingsEditor({required this.title, required this.section, required this.build, required this.body, this.path = '/settings'});
  final String title;
  final String section;
  final String path;
  final List<Widget> Function(BuildContext context, Json draft, VoidCallback changed) build;
  final Json Function(Json draft) body;
  @override
  ConsumerState<_SettingsEditor> createState() => _SettingsEditorState();
}

class _SettingsEditorState extends ConsumerState<_SettingsEditor> {
  Json? _draft;
  bool _saving = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: OnlineView<Json>(
          load: () => apiOf(ref).get<Json>(widget.path),
          builder: (context, s, _) {
            final d = _draft ??= widget.section.isEmpty ? {...s} : {...mapOf(s[widget.section])};
            return ListView(padding: const EdgeInsets.all(16), children: [
              ...widget.build(context, d, () => setState(() {})),
              const SizedBox(height: 16),
              AppButton(
                label: context.t('common.save'),
                expand: true,
                loading: _saving,
                onPressed: () async {
                  setState(() => _saving = true);
                  await runAction(context, () => apiOf(ref).patch<Object?>(widget.path, widget.body(d)));
                  if (mounted) setState(() => _saving = false);
                },
              ),
            ]);
          },
        ),
      );
}

/// Number field bound to a key of a draft map.
class _Num extends StatelessWidget {
  const _Num(this.draft, this.keyName, this.label, {this.percent = false});
  final Json draft;
  final String keyName;
  final String label;
  final bool percent;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          initialValue: draft[keyName] == null ? '' : '${percent ? (numOf(draft[keyName]) * 100).round() : draft[keyName]}',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(labelText: label),
          onChanged: (v) {
            final n = num.tryParse(v.trim());
            draft[keyName] = n == null ? null : (percent ? n / 100 : n);
          },
        ),
      );
}

// ───────────── Business profile ─────────────

class BusinessProfileScreen extends StatelessWidget {
  const BusinessProfileScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    Widget text(Json d, String k, String label, {bool ltr = false}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(initialValue: str(d[k]), textDirection: ltr ? TextDirection.ltr : null, decoration: InputDecoration(labelText: label), onChanged: (v) => d[k] = v.trim()),
        );
    return _SettingsEditor(
      title: t('business'),
      path: '/business',
      section: '',
      build: (context, d, changed) => [
        text(d, 'name', l.t('common.name')),
        text(d, 'phone', l.t('common.phone'), ltr: true),
        text(d, 'email', l.t('common.email'), ltr: true),
        text(d, 'address', t('address')),
        text(d, 'city', t('city')),
        text(d, 'timezone', t('timezone'), ltr: true),
        text(d, 'currency', t('currency'), ltr: true),
        AppDropdown<String>(label: t('defaultUnit'), value: str(d['defaultSizeUnit']), items: {for (final u in const ['SQ_FT', 'SQ_YARD', 'SQ_METER', 'MARLA', 'KANAL', 'ACRE']) u: l.enumLabel('sizeUnit', u)}, onChanged: (v) {
          d['defaultSizeUnit'] = v;
          changed();
        }),
      ],
      body: (d) => {for (final k in const ['name', 'phone', 'email', 'address', 'city', 'timezone', 'currency', 'defaultSizeUnit']) if (str(d[k]).isNotEmpty) k: d[k]},
    );
  }
}

// ───────────── Automation rules ─────────────

class AutomationScreen extends StatelessWidget {
  const AutomationScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return _SettingsEditor(
      title: l.t('mm.ad.automation'),
      section: 'automation',
      build: (context, d, changed) => [
        Text(l.t('mm.ad.automationIntro'), style: Theme.of(context).textTheme.bodySmall),
        for (final k in _automationKeys)
          Card(
            margin: const EdgeInsets.only(top: 10),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
              child: Column(children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(l.t('mm.auto.$k')),
                  value: mapOf(d[k])['enabled'] != false,
                  onChanged: (v) {
                    d[k] = {...mapOf(d[k]), 'enabled': v};
                    changed();
                  },
                ),
                TextFormField(
                  initialValue: '${mapOf(d[k])['threshold'] ?? ''}',
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(labelText: l.t(_automationUnits[k] == 'minutes' ? 'mm.ad.afterMinutes' : 'mm.ad.afterDays')),
                  onChanged: (v) => d[k] = {...mapOf(d[k]), 'threshold': int.tryParse(v.trim()) ?? mapOf(d[k])['threshold']},
                ),
                const SizedBox(height: 8),
              ]),
            ),
          ),
      ],
      body: (d) => {
        'automation': {for (final k in _automationKeys) k: {'enabled': mapOf(d[k])['enabled'] != false, 'threshold': mapOf(d[k])['threshold']}},
      },
    );
  }
}

// ───────────── Lead scoring ─────────────

class LeadScoringScreen extends StatelessWidget {
  const LeadScoringScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    return _SettingsEditor(
      title: t('scoring'),
      section: 'leadScoring',
      build: (context, d, changed) {
        final w = d['weights'] = {...mapOf(d['weights'])};
        return [
          Text(t('scoringIntro'), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          for (final f in _scoreFactors) _Num(w, f, l.t('mm.score.$f')),
          _Num(d, 'hotThreshold', t('hotAt')),
          _Num(d, 'warmThreshold', t('warmAt')),
        ];
      },
      body: (d) => {
        'leadScoring': {'weights': {for (final f in _scoreFactors) f: numOf(mapOf(d['weights'])[f])}, 'hotThreshold': numOf(d['hotThreshold']).round(), 'warmThreshold': numOf(d['warmThreshold']).round()},
      },
    );
  }
}

// ───────────── Deal pipeline ─────────────

class PipelineScreen extends StatelessWidget {
  const PipelineScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    return _SettingsEditor(
      title: t('pipeline'),
      section: 'dealPipeline',
      build: (context, d, changed) {
        final stages = listOf(d['stages']);
        d['stages'] = stages;
        return [
          Text(l.t('pipeline.hint'), style: Theme.of(context).textTheme.bodySmall),
          for (final s in stages)
            Card(
              margin: const EdgeInsets.only(top: 10),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                child: Column(children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l.enumLabel('dealStage', str(s['stage']))),
                    value: s['enabled'] != false,
                    onChanged: DealPipeline.requiredStages.contains(s['stage'])
                        ? null
                        : (v) {
                            s['enabled'] = v;
                            changed();
                          },
                  ),
                  TextFormField(initialValue: str(s['label']), maxLength: 40, decoration: InputDecoration(labelText: l.t('pipeline.label'), counterText: ''), onChanged: (v) => s['label'] = v.trim()),
                  const SizedBox(height: 8),
                  TextFormField(initialValue: str(s['labelUr']), maxLength: 40, textDirection: TextDirection.rtl, decoration: InputDecoration(labelText: l.t('pipeline.labelUr'), counterText: ''), onChanged: (v) => s['labelUr'] = v.trim()),
                  const SizedBox(height: 8),
                  if (s['stage'] != 'CLOSED_WON' && s['stage'] != 'CLOSED_LOST') _Num(s, 'probability', '${l.t('pipeline.chance')} (%)', percent: true),
                ]),
              ),
            ),
          const SizedBox(height: 8),
          Text(l.t('pipeline.required'), style: Theme.of(context).textTheme.bodySmall),
        ];
      },
      body: (d) => {
        'dealPipeline': {
          'stages': [for (final s in listOf(d['stages'])) {'stage': s['stage'], 'enabled': s['enabled'] != false, 'label': str(s['label']), 'labelUr': str(s['labelUr']), 'probability': numOf(s['probability']).clamp(0, 1)}],
        },
      },
    );
  }
}

// ───────────── Commission rules and approvals ─────────────

class CommissionRulesScreen extends StatelessWidget {
  const CommissionRulesScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    return _SettingsEditor(
      title: t('rules'),
      section: 'commission',
      build: (context, d, changed) {
        final rules = listOf(d['rules']);
        d['rules'] = rules;
        return [
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('deal.approval.setting')), value: d['closeApprovalRequired'] == true, onChanged: (v) {
            d['closeApprovalRequired'] = v;
            changed();
          }),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('deal.payoutApprovalSetting')), value: d['payoutApprovalRequired'] == true, onChanged: (v) {
            d['payoutApprovalRequired'] = v;
            changed();
          }),
          SectionHeader(l.t('commissionRules.title'), trailing: IconButton(icon: const Icon(Icons.add), onPressed: rules.length >= 20 ? null : () {
            rules.add({'listingPurpose': 'RENT', 'propertyType': null, 'buyerPct': 1, 'sellerPct': 1});
            changed();
          })),
          Text(l.t('commissionRules.hint'), style: Theme.of(context).textTheme.bodySmall),
          if (rules.isEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.t('commissionRules.none'))),
          for (var i = 0; i < rules.length; i++)
            Card(
              key: ObjectKey(rules[i]),
              margin: const EdgeInsets.only(top: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(children: [
                  Row(children: [
                    Expanded(child: AppDropdown<String>(label: l.t('commissionRules.purpose'), value: rules[i]['listingPurpose'] as String?, allowEmpty: true, items: {for (final x in const ['SALE', 'RENT']) x: l.enumLabel('listingPurpose', x)}, onChanged: (v) {
                      rules[i]['listingPurpose'] = v;
                      changed();
                    })),
                    IconButton(icon: const Icon(Icons.delete_outline), onPressed: () {
                      rules.removeAt(i);
                      changed();
                    }),
                  ]),
                  const SizedBox(height: 10),
                  AppDropdown<String>(label: l.t('commissionRules.type'), value: rules[i]['propertyType'] as String?, allowEmpty: true, items: {for (final x in propertyTypeKeys(l)) x: l.enumLabel('propertyType', x)}, onChanged: (v) {
                    rules[i]['propertyType'] = v;
                    changed();
                  }),
                  const SizedBox(height: 10),
                  Row(children: [
                    Expanded(child: _Num(rules[i], 'buyerPct', l.t('commissionRules.buyer'))),
                    const SizedBox(width: 10),
                    Expanded(child: _Num(rules[i], 'sellerPct', l.t('commissionRules.seller'))),
                  ]),
                ]),
              ),
            ),
        ];
      },
      body: (d) => {
        'commission': {
          'closeApprovalRequired': d['closeApprovalRequired'] == true,
          'payoutApprovalRequired': d['payoutApprovalRequired'] == true,
          'rules': [for (final r in listOf(d['rules'])) {'listingPurpose': r['listingPurpose'], 'propertyType': r['propertyType'], 'buyerPct': numOf(r['buyerPct']), 'sellerPct': numOf(r['sellerPct'])}],
        },
      },
    );
  }
}

/// Property type keys, read from the translations so the list always matches the server's.
List<String> propertyTypeKeys(AppLocalizations l) => l.enumKeys('propertyType');

// ───────────── Data retention ─────────────

class RetentionScreen extends StatelessWidget {
  const RetentionScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Map<String, String> opts(int min) => {'0': l.t('retention.forever'), for (final m in const [6, 12, 24, 36, 60, 84]) if (m >= min) '$m': l.t('retention.months', {'count': m})};
    return _SettingsEditor(
      title: l.t('retention.title'),
      section: 'retention',
      build: (context, d, changed) => [
        Text(l.t('retention.hint'), style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 12),
        AppDropdown<String>(label: l.t('retention.audit'), value: '${numOf(d['auditLogMonths']).toInt()}', items: opts(12), onChanged: (v) {
          d['auditLogMonths'] = int.parse(v ?? '0');
          changed();
        }),
        const SizedBox(height: 12),
        AppDropdown<String>(label: l.t('retention.activity'), value: '${numOf(d['activityMonths']).toInt()}', items: opts(6), onChanged: (v) {
          d['activityMonths'] = int.parse(v ?? '0');
          changed();
        }),
      ],
      body: (d) => {
        'retention': {'auditLogMonths': numOf(d['auditLogMonths']).toInt(), 'activityMonths': numOf(d['activityMonths']).toInt()},
      },
    );
  }
}

// ───────────── API keys ─────────────

class ApiKeysScreen extends ConsumerStatefulWidget {
  const ApiKeysScreen({super.key});
  @override
  ConsumerState<ApiKeysScreen> createState() => _ApiKeysState();
}

class _ApiKeysState extends ConsumerState<ApiKeysScreen> {
  int _version = 0;

  Future<void> _create() async {
    final l = context.l10n;
    final mine = ref.read(authProvider).permissions;
    final allowed = _apiKeyPermissions.where(mine.contains).toList();
    final picked = <String>{};
    final name = TextEditingController();
    final ok = await showAppBottomSheet<bool>(
      context,
      title: l.t('apiKeys.add'),
      child: StatefulBuilder(
        builder: (c, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          AppTextField(label: l.t('apiKeys.name'), controller: name, hint: l.t('apiKeys.namePlaceholder')),
          const SizedBox(height: 10),
          Text(l.t('apiKeys.permissions'), style: Theme.of(c).textTheme.bodySmall),
          for (final p in allowed) CheckboxListTile(dense: true, contentPadding: EdgeInsets.zero, title: Ltr(p), value: picked.contains(p), onChanged: (v) => set(() => v == true ? picked.add(p) : picked.remove(p))),
          AppButton(label: l.t('apiKeys.create'), expand: true, onPressed: () => Navigator.pop(c, true)),
        ]),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final k = await apiOf(ref).post<Json>('/api-keys', {'name': name.text.trim(), 'permissions': picked.toList()});
      if (!mounted) return;
      setState(() => _version++);
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(l.t('apiKeys.createdTitle')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text(l.t('apiKeys.createdHint')), const SizedBox(height: 10), SelectableText(str(k['secret']), textDirection: TextDirection.ltr)]),
          actions: [
            TextButton(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: str(k['secret'])));
                if (c.mounted) showMessage(c, l.t('apiKeys.copied'));
              },
              child: Text(l.t('apiKeys.copy')),
            ),
            FilledButton(onPressed: () => Navigator.pop(c), child: Text(l.t('apiKeys.done'))),
          ],
        ),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('apiKeys.title'))),
      floatingActionButton: FloatingActionButton(onPressed: _create, child: const Icon(Icons.add)),
      body: OnlineView<List<Json>>(
        key: ValueKey(_version),
        load: () async => listOf(await apiOf(ref).get<List<dynamic>>('/api-keys')),
        builder: (context, keys, _) => ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
          Text(l.t('apiKeys.hint'), style: Theme.of(context).textTheme.bodySmall),
          if (keys.isEmpty) AppEmptyState(title: l.t('apiKeys.none'), icon: Icons.key_outlined),
          for (final k in keys)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.key_outlined),
              title: Text('${str(k['name'])}  ${str(k['prefix'])}…'),
              subtitle: Text('${(k['permissions'] as List? ?? const []).join(', ')}\n${k['lastUsedAt'] == null ? l.t('apiKeys.neverUsed') : day(context, k['lastUsedAt'])}'),
              isThreeLine: true,
              trailing: k['revokedAt'] != null
                  ? AppChip(l.t('apiKeys.revokedBadge'), tone: ChipTone.red)
                  : TextButton(
                      onPressed: () async {
                        if (!await confirmDialog(context, title: l.t('apiKeys.revokeTitle', {'name': str(k['name'])}), message: l.t('apiKeys.revokeHint'), confirmLabel: l.t('apiKeys.revoke')) || !context.mounted) return;
                        if (await runAction(context, () => apiOf(ref).delete<Object?>('/api-keys/${k['_id']}'), done: l.t('apiKeys.revoked'))) setState(() => _version++);
                      },
                      child: Text(l.t('apiKeys.revoke')),
                    ),
            ),
        ]),
      ),
    );
  }
}

// ───────────── Subscription ─────────────

class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});
  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionState();
}

class _SubscriptionState extends ConsumerState<SubscriptionScreen> {
  int _version = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.sub.$k');
    final canRequest = ref.watch(authProvider).can('business:manage');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.ad.subscription'))),
      body: OnlineView<Json>(
        key: ValueKey(_version),
        load: () => apiOf(ref).get<Json>('/subscription'),
        builder: (context, s, _) {
          final usage = mapOf(s['usage']), limits = mapOf(s['limits']), plans = mapOf(s['plans']);
          String lim(Object? v) => v == null ? '∞' : '$v';
          return ListView(padding: const EdgeInsets.all(16), children: [
            StatCard(title: '${t('plan')}: ${str(s['plan'])}', rows: [
              (l.t('common.status'), str(s['status'])),
              if (s['trialEndsAt'] != null) (t('trialEnds'), day(context, s['trialEndsAt'])),
              if (s['currentPeriodEnd'] != null) (t('renews'), day(context, s['currentPeriodEnd'])),
              (t('users'), '${numOf(usage['users'])} / ${lim(limits['users'])}'),
              (t('branches'), '${numOf(usage['branches'])} / ${lim(limits['branches'])}'),
              (t('storage'), '${numOf(usage['storageMb']).round()} / ${lim(limits['storageMb'])} MB'),
            ]),
            SectionHeader(t('plans')),
            for (final p in _plans)
              if (plans[p] != null)
                StatCard(
                  title: p,
                  trailing: !canRequest || s['plan'] == p
                      ? null
                      : TextButton(
                          onPressed: () async {
                            final v = await showFormSheet(context, title: '${t('request')} · $p', note: t('requestHint'), fields: [
                              FormFieldSpec('cycle', t('cycle'), kind: FieldKind.select, required: true, initial: 'MONTHLY', options: {'MONTHLY': t('monthly'), 'ANNUAL': t('annual')}),
                              FormFieldSpec('note', l.t('mm.notes'), kind: FieldKind.multiline),
                            ]);
                            if (v == null || !context.mounted) return;
                            if (await runAction(context, () => apiOf(ref).post<Object?>('/subscription/request', {'plan': p, ...v}), done: t('requested'))) setState(() => _version++);
                          },
                          child: Text(t('request')),
                        ),
                  rows: [
                    (t('monthly'), money(context, mapOf(plans[p])['priceMonthly'])),
                    (t('annual'), money(context, mapOf(plans[p])['priceAnnual'])),
                    (t('modules'), ((mapOf(plans[p])['modules'] as List?) ?? const []).join(', ')),
                  ],
                ),
            SectionHeader(t('history')),
            for (final h in listOf(s['history']))
              ListTile(contentPadding: EdgeInsets.zero, title: Text('${str(h['type']).replaceAll('_', ' ')} · ${str(h['plan'])}'), subtitle: Text([day(context, h['at']), str(h['reference']), str(h['note'])].where((x) => x.isNotEmpty).join(' · ')), trailing: h['amount'] == null ? null : Ltr(money(context, h['amount']))),
          ]);
        },
      ),
    );
  }
}

// ───────────── Platform administration (Stateown staff) ─────────────

class PlatformScreen extends ConsumerStatefulWidget {
  const PlatformScreen({super.key});
  @override
  ConsumerState<PlatformScreen> createState() => _PlatformState();
}

class _PlatformState extends ConsumerState<PlatformScreen> {
  int _version = 0;
  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.sub.$k');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.ad.platform'))),
      body: OnlineView<List<Json>>(
        key: ValueKey(_version),
        load: () async => (await apiOf(ref).page('/platform/businesses', query: {'limit': 100})).items,
        builder: (context, items, _) => ListView(padding: const EdgeInsets.all(16), children: [
          for (final b in items)
            StatCard(
              title: str(b['name']),
              trailing: IconButton(
                icon: const Icon(Icons.edit_outlined),
                onPressed: () async {
                  final v = await showFormSheet(context, title: str(b['name']), fields: [
                    FormFieldSpec('plan', t('plan'), kind: FieldKind.select, required: true, initial: b['plan'], options: {for (final p in _plans) p: p}),
                    FormFieldSpec('status', l.t('common.status'), kind: FieldKind.select, required: true, initial: b['status'], options: {for (final x in const ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED']) x: x}),
                    FormFieldSpec('cycle', t('cycle'), kind: FieldKind.select, initial: b['cycle'], options: {'MONTHLY': t('monthly'), 'ANNUAL': t('annual')}),
                    FormFieldSpec('currentPeriodEnd', t('renews'), kind: FieldKind.date, initial: b['currentPeriodEnd']),
                    FormFieldSpec('amount', t('amount'), kind: FieldKind.number),
                    FormFieldSpec('reference', t('reference')),
                    FormFieldSpec('note', l.t('mm.notes'), kind: FieldKind.multiline),
                  ]);
                  if (v == null || !context.mounted) return;
                  if (await runAction(context, () => apiOf(ref).patch<Object?>('/platform/businesses/${b['_id']}/subscription', v))) setState(() => _version++);
                },
              ),
              rows: [(t('plan'), str(b['plan'])), (l.t('common.status'), str(b['status'])), if (b['currentPeriodEnd'] != null) (t('renews'), day(context, b['currentPeriodEnd'])), if (str(b['city']).isNotEmpty) (l.t('mm.ad.city'), str(b['city']))],
            ),
        ]),
      ),
    );
  }
}

// ───────────── Excel imports ─────────────

class ImportScreen extends ConsumerStatefulWidget {
  const ImportScreen({super.key});
  @override
  ConsumerState<ImportScreen> createState() => _ImportState();
}

class _ImportState extends ConsumerState<ImportScreen> {
  bool _busy = false;
  Json? _result;

  Future<void> _import(String kind) async {
    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['xlsx']);
    final file = picked.isEmpty ? null : picked.first;
    final path = file?.path;
    if (file == null || path == null || !mounted) return;
    setState(() {
      _busy = true;
      _result = null;
    });
    try {
      final form = FormData.fromMap({'file': await MultipartFile.fromFile(path, filename: file.name)});
      final r = await apiOf(ref).upload<Json>('/$kind/import', form);
      if (mounted) setState(() => _result = r);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.imp.$k');
    final auth = ref.watch(authProvider);
    final r = _result;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.ad.import'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(t('intro'), style: Theme.of(context).textTheme.bodySmall),
        for (final (kind, perm, label) in [('clients', 'clients:create', t('leads')), ('properties', 'properties:create', t('properties'))])
          if (auth.can(perm)) ...[
            SectionHeader(label),
            AppButton(label: t('template'), icon: Icons.download_outlined, outlined: true, onPressed: () => shareDownload(context, ref, '/$kind/import/template')),
            const SizedBox(height: 8),
            AppButton(label: t('choose'), icon: Icons.upload_file_outlined, loading: _busy, onPressed: () => _import(kind)),
          ],
        if (r != null) ...[
          SectionHeader(t('result')),
          StatCard(rows: [(t('created'), '${numOf(r['created']).toInt()}'), (t('duplicates'), '${listOf(r['duplicates']).length}')]),
          for (final e in listOf(r['errors'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.error_outline), title: Text('${t('row')} ${str(e['row'])}: ${str(e['message'])}')),
        ],
      ]),
    );
  }
}

// ───────────── Member password reset ─────────────

class MemberPasswordScreen extends ConsumerWidget {
  const MemberPasswordScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    String t(String k) => l.t('mm.ad.$k');
    return Scaffold(
      appBar: AppBar(title: Text(t('resetPassword'))),
      body: OnlineView<List<Json>>(
        load: () async => (await apiOf(ref).page('/members', query: {'limit': 100})).items,
        builder: (context, members, _) => ListView(children: [
          for (final m in members.where((m) => m['role'] != 'OWNER'))
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(str(mapOf(m['user'])['fullName'])),
              subtitle: Ltr(str(mapOf(m['user'])['email'])),
              trailing: const Icon(Icons.lock_reset),
              onTap: () async {
                final pw = await promptText(context, title: t('resetPassword'), label: t('tempPassword'));
                if (pw == null || pw.trim().isEmpty || !context.mounted) return;
                await runAction(context, () => apiOf(ref).post<Object?>('/members/${m['_id']}/reset-password', {'temporaryPassword': pw.trim()}), done: t('passwordReset'));
              },
            ),
        ]),
      ),
    );
  }
}
