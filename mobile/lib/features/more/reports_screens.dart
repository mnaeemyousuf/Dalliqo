import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../auth/auth_controller.dart';
import 'online_kit.dart';

/// Reports on the phone — the same server reports the web shows (business overview, leads,
/// inventory, agent performance, branches, team, forecast and the finance statements), drawn as
/// cards and bars instead of wide tables.

enum _Period { month, last30, year, all }

Map<String, dynamic> _query(_Period p) {
  final now = DateTime.now().toUtc();
  final from = switch (p) {
    _Period.month => DateTime.utc(now.year, now.month, 1),
    _Period.last30 => now.subtract(const Duration(days: 30)),
    _Period.year => DateTime.utc(now.year, 1, 1),
    _Period.all => DateTime.utc(2000, 1, 1),
  };
  return {'from': from.toIso8601String(), 'to': now.toIso8601String()};
}

String _pct(Object? v) => v == null ? '—' : '${numOf(v).toStringAsFixed(numOf(v) % 1 == 0 ? 0 : 1)}%';
String _n(Object? v) => v == null ? '—' : '${numOf(v) % 1 == 0 ? numOf(v).toInt() : numOf(v).toStringAsFixed(1)}';

class ReportsHubScreen extends ConsumerWidget {
  const ReportsHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    final reports = auth.can('reports:read');
    final finance = auth.can('finance:read') && reports;
    // Same rule as the API and the web dashboard: managers of people or of every deal.
    final team = auth.can('deals:read') && (auth.can('deals:read_all') || auth.can('members:read'));
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mm.reports.title'))),
      body: ListView(children: [
        if (reports) ...[
          SectionHeader(l.t('mm.reports.business')),
          MenuTile(icon: Icons.apartment_outlined, title: l.t('mm.reports.summary'), page: () => const _PeriodReport(kind: _Kind.summary)),
          if (auth.can('clients:read')) MenuTile(icon: Icons.person_search_outlined, title: l.t('mm.reports.leads'), page: () => const _PeriodReport(kind: _Kind.leads)),
          if (auth.can('properties:read')) MenuTile(icon: Icons.inventory_2_outlined, title: l.t('mm.reports.inventory'), page: () => const _SimpleReport(kind: _Kind.inventory)),
          MenuTile(icon: Icons.leaderboard_outlined, title: l.t('mm.reports.agents'), page: () => const _PeriodReport(kind: _Kind.agents)),
          MenuTile(icon: Icons.account_tree_outlined, title: l.t('mm.reports.branches'), page: () => const _PeriodReport(kind: _Kind.branches)),
          MenuTile(icon: Icons.trending_up, title: l.t('mm.reports.forecast'), page: () => const _SimpleReport(kind: _Kind.forecast)),
          if (auth.can('marketing:manage')) MenuTile(icon: Icons.campaign_outlined, title: l.t('mm.reports.campaigns'), page: () => const _SimpleReport(kind: _Kind.campaigns)),
        ],
        if (team) MenuTile(icon: Icons.groups_outlined, title: l.t('mm.reports.team'), page: () => const _SimpleReport(kind: _Kind.team)),
        if (finance) ...[
          SectionHeader(l.t('mm.reports.finance')),
          MenuTile(icon: Icons.receipt_long_outlined, title: l.t('mm.reports.incomeStatement'), page: () => const _PeriodReport(kind: _Kind.incomeStatement)),
          MenuTile(icon: Icons.waterfall_chart, title: l.t('mm.reports.cashFlow'), page: () => const _PeriodReport(kind: _Kind.cashFlow)),
          MenuTile(icon: Icons.hourglass_bottom, title: l.t('mm.reports.aging'), page: () => const _SimpleReport(kind: _Kind.aging)),
          if (auth.can('deals:read')) MenuTile(icon: Icons.badge_outlined, title: l.t('mm.reports.agentStatement'), page: () => const AgentStatementScreen()),
        ],
        if (auth.can('rentals:read')) MenuTile(icon: Icons.key_outlined, title: l.t('mm.reports.rentRoll'), page: () => const _SimpleReport(kind: _Kind.rentRoll)),
        if (!reports && !team && !auth.can('rentals:read')) Padding(padding: const EdgeInsets.all(24), child: Text(l.t('mm.noAccess'), textAlign: TextAlign.center)),
      ]),
    );
  }
}

enum _Kind { summary, leads, inventory, agents, branches, team, forecast, campaigns, incomeStatement, cashFlow, aging, rentRoll }

const _paths = {
  _Kind.summary: '/reports/business-summary',
  _Kind.leads: '/reports/leads',
  _Kind.inventory: '/reports/inventory',
  _Kind.agents: '/reports/agent-performance',
  _Kind.branches: '/reports/branches',
  _Kind.team: '/dashboard/team',
  _Kind.forecast: '/ai/forecast',
  _Kind.campaigns: '/reports/campaigns',
  _Kind.incomeStatement: '/reports/income-statement',
  _Kind.cashFlow: '/reports/cash-flow',
  _Kind.aging: '/reports/aging',
  _Kind.rentRoll: '/leases/rent-roll',
};

const _titles = {
  _Kind.summary: 'mm.reports.summary',
  _Kind.leads: 'mm.reports.leads',
  _Kind.inventory: 'mm.reports.inventory',
  _Kind.agents: 'mm.reports.agents',
  _Kind.branches: 'mm.reports.branches',
  _Kind.team: 'mm.reports.team',
  _Kind.forecast: 'mm.reports.forecast',
  _Kind.campaigns: 'mm.reports.campaigns',
  _Kind.incomeStatement: 'mm.reports.incomeStatement',
  _Kind.cashFlow: 'mm.reports.cashFlow',
  _Kind.aging: 'mm.reports.aging',
  _Kind.rentRoll: 'mm.reports.rentRoll',
};

/// A report without a period filter.
class _SimpleReport extends ConsumerWidget {
  const _SimpleReport({required this.kind});
  final _Kind kind;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: Text(context.t(_titles[kind]!))),
        body: OnlineView<Json>(
          load: () => apiOf(ref).get<Json>(_paths[kind]!),
          builder: (context, d, reload) => ListView(padding: const EdgeInsets.all(16), children: _body(context, ref, kind, d, reload)),
        ),
      );
}

/// A report for a chosen period (this month, last 30 days, this year, everything).
class _PeriodReport extends ConsumerStatefulWidget {
  const _PeriodReport({required this.kind});
  final _Kind kind;
  @override
  ConsumerState<_PeriodReport> createState() => _PeriodReportState();
}

class _PeriodReportState extends ConsumerState<_PeriodReport> {
  _Period _period = _Period.month;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final kind = widget.kind;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t(_titles[kind]!)),
        actions: [
          if (kind == _Kind.agents)
            PopupMenuButton<String>(
              icon: const Icon(Icons.ios_share),
              onSelected: (f) => shareDownload(context, ref, _paths[kind]!, query: {..._query(_period), 'format': f}),
              itemBuilder: (_) => const [PopupMenuItem(value: 'xlsx', child: Text('Excel')), PopupMenuItem(value: 'pdf', child: Text('PDF'))],
            ),
        ],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: SegmentedButton<_Period>(
            showSelectedIcon: false,
            segments: [for (final p in _Period.values) ButtonSegment(value: p, label: Text(l.t('mm.period.${p.name}'), maxLines: 1))],
            selected: {_period},
            onSelectionChanged: (s) => setState(() => _period = s.first),
          ),
        ),
        Expanded(
          child: OnlineView<Json>(
            key: ValueKey(_period),
            load: () => apiOf(ref).get<Json>(_paths[kind]!, query: _query(_period)),
            builder: (context, d, reload) => ListView(padding: const EdgeInsets.all(16), children: _body(context, ref, kind, d, reload)),
          ),
        ),
      ]),
    );
  }
}

List<Widget> _body(BuildContext context, WidgetRef ref, _Kind kind, Json d, VoidCallback reload) {
  final l = context.l10n;
  String t(String k) => l.t('mm.r.$k');
  String m(Object? v) => money(context, v);
  switch (kind) {
    case _Kind.summary:
      final p = mapOf(d['properties']), le = mapOf(d['leads']), de = mapOf(d['deals']), c = mapOf(d['commission']), f = mapOf(d['finance']);
      return [
        StatCard(title: l.t('nav.properties'), rows: [(t('total'), _n(p['total'])), (t('active'), _n(p['active'])), (t('verified'), _n(p['verified'])), (t('avgDaysOnMarket'), _n(p['avgDaysOnMarket'])), (t('over90'), _n(p['over90Days']))]),
        StatCard(title: t('leadsTitle'), rows: [(t('newLeads'), _n(le['new'])), (t('activeClients'), _n(le['activeClients'])), (t('conversion'), _pct(le['conversionPct']))]),
        StatCard(title: l.t('nav.deals'), rows: [(t('activeDeals'), _n(de['active'])), (t('closedDeals'), _n(de['closed'])), (t('transactionValue'), m(de['transactionValue'])), (t('avgDaysToClose'), _n(de['avgDaysToClose']))]),
        StatCard(title: t('commission'), rows: [(t('expected'), m(c['expected'])), (t('received'), m(c['received'])), (t('outstanding'), m(c['outstanding']))]),
        StatCard(title: t('money'), rows: [(t('income'), m(f['income'])), (t('expense'), m(f['expense'])), (t('netProfit'), m(f['netProfit']))]),
      ];
    case _Kind.leads:
      final tot = mapOf(d['totals']);
      final temp = mapOf(d['byTemperature']);
      return [
        StatCard(rows: [(t('newLeads'), _n(tot['leads'])), (t('converted'), _n(tot['converted'])), (t('conversion'), _pct(tot['conversionRate'])), (t('unassigned'), _n(tot['unassigned'])), (t('neverContacted'), _n(tot['neverContacted'])), (t('avgResponse'), tot['avgResponseMinutes'] == null ? '—' : '${_n(tot['avgResponseMinutes'])} ${t('minutes')}')]),
        SectionHeader(t('byTemperature')),
        BarList(rows: [for (final k in const ['HOT', 'WARM', 'COLD']) (l.enumLabel('leadTemperature', k), numOf(temp[k]))]),
        SectionHeader(t('bySource')),
        for (final s in listOf(d['bySource'])) StatCard(title: l.enumLabel('source', str(s['source'])), rows: [(t('newLeads'), _n(s['leads'])), (t('converted'), _n(s['converted'])), (t('lost'), _n(s['lost'])), (t('conversion'), _pct(s['conversionRate'])), (t('avgScore'), _n(s['avgScore']))]),
        SectionHeader(t('leadAging')),
        BarList(rows: [for (final a in listOf(d['aging'])) (str(a['key']).replaceAll('_', '–'), numOf(a['count']))]),
        if (listOf(d['lostReasons']).isNotEmpty) ...[SectionHeader(t('lostReasons')), BarList(rows: [for (final a in listOf(d['lostReasons'])) (str(a['reason']), numOf(a['count']))])],
      ];
    case _Kind.inventory:
      return [
        StatCard(rows: [(t('onMarket'), _n(d['onMarket'])), (t('avgDaysOnMarket'), _n(d['avgDaysOnMarket']))]),
        SectionHeader(t('inventoryAging')),
        BarList(rows: [for (final a in listOf(d['aging'])) (str(a['key']).replaceAll('_', '–'), numOf(a['count']))]),
        SectionHeader(l.t('mm.r.byStatus')),
        for (final e in mapOf(d['byStatus']).entries) InfoRow(l.enumLabel('propertyStatus', e.key), '${_n(mapOf(e.value)['count'])} · ${m(mapOf(e.value)['value'])}'),
        SectionHeader(t('byType')),
        BarList(rows: [for (final e in mapOf(d['byType']).entries) (l.enumLabel('propertyType', e.key), numOf(e.value))]),
        SectionHeader(t('oldest')),
        for (final o in listOf(d['oldest'])) ListTile(contentPadding: EdgeInsets.zero, title: Ltr(str(o['propertyId'])), subtitle: Text([str(o['society']), str(o['block'])].where((x) => x.isNotEmpty).join(' · ')), trailing: Text('${_n(o['days'])} ${t('days')}\n${m(o['askingPrice'])}', textAlign: TextAlign.end)),
      ];
    case _Kind.agents:
      final rows = listOf(d['rows']);
      if (rows.isEmpty) return [AppEmptyState(title: l.t('dashboard.noData'), icon: Icons.leaderboard_outlined)];
      return [
        for (final r in rows)
          StatCard(title: str(r['fullName']), rows: [
            (t('leadsAssigned'), _n(r['leadsAssigned'])),
            (t('leadsContacted'), _n(r['leadsContacted'])),
            (t('followUpsDone'), _n(r['followUpsCompleted'])),
            (t('siteVisits'), _n(r['siteVisits'])),
            (t('negotiations'), _n(r['negotiations'])),
            (t('dealsClosed'), _n(r['dealsClosed'])),
            (t('commission'), m(r['commission'])),
            (t('conversion'), _pct(r['conversionPct'])),
            (t('avgResponse'), r['avgResponseMinutes'] == null ? '—' : '${_n(r['avgResponseMinutes'])} ${t('minutes')}'),
          ]),
      ];
    case _Kind.branches:
      final canEdit = ref.read(authProvider).can('settings:manage');
      return [
        for (final r in listOf(d['rows']))
          StatCard(
            title: str(r['name']),
            trailing: !canEdit
                ? null
                : IconButton(
                    icon: const Icon(Icons.flag_outlined),
                    tooltip: t('setTargets'),
                    onPressed: () async {
                      final tg = mapOf(r['targets']);
                      final v = await showFormSheet(context, title: '${t('setTargets')} · ${str(r['name'])}', note: t('targetsHint'), fields: [
                        FormFieldSpec('leads', t('targetLeads'), kind: FieldKind.number, initial: tg['leads']),
                        FormFieldSpec('dealsWon', t('targetDeals'), kind: FieldKind.number, initial: tg['dealsWon']),
                        FormFieldSpec('commission', t('targetCommission'), kind: FieldKind.number, initial: tg['commission']),
                      ]);
                      if (v == null || !context.mounted) return;
                      if (await runAction(context, () => apiOf(ref).patch<Object?>('/branches/${r['branchId']}', {'targets': {'leads': v['leads'], 'dealsWon': v['dealsWon'], 'commission': v['commission']}}))) reload();
                    },
                  ),
            rows: [
              (t('newLeads'), '${_n(r['leads'])}${_target(mapOf(r['targets'])['leads'], mapOf(r['progress'])['leads'])}'),
              (t('dealsClosed'), '${_n(r['dealsWon'])}${_target(mapOf(r['targets'])['dealsWon'], mapOf(r['progress'])['dealsWon'])}'),
              (t('commission'), '${m(r['commission'])}${_target(mapOf(r['targets'])['commission'], mapOf(r['progress'])['commission'], money: (x) => m(x))}'),
              (t('income'), m(r['income'])),
              (t('expense'), m(r['expense'])),
              (t('netProfit'), m(r['net'])),
            ],
          ),
      ];
    case _Kind.team:
      return [
        for (final r in listOf(d['rows']))
          StatCard(title: str(r['fullName']), rows: [
            (t('leadsAssigned'), _n(r['leads'])),
            (t('hotLeads'), _n(r['hotLeads'])),
            (t('overdueFollowUps'), _n(r['overdueFollowUps'])),
            (t('followUpsWeek'), _n(r['followUpsDoneThisWeek'])),
            (t('activeDeals'), _n(r['openDeals'])),
            (t('wonMonth'), _n(r['wonThisMonth'])),
            (t('commissionMonth'), m(r['commissionThisMonth'])),
          ]),
      ];
    case _Kind.forecast:
      final tot = mapOf(d['totals']);
      return [
        Text(t('forecastNote'), style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 10),
        StatCard(rows: [(t('weighted'), m(tot['weightedCommission'])), (t('bestCase'), m(tot['bestCaseCommission'])), (t('installmentsDue'), m(tot['installments'])), (t('rentDue'), m(tot['rent'])), (t('expectedLeads'), _n(d['expectedLeadsNextMonth']))]),
        SectionHeader(t('byMonth')),
        for (final x in listOf(d['months'])) StatCard(title: str(x['month']), rows: [(t('weighted'), m(x['weighted'])), (t('bestCase'), m(x['bestCase'])), (l.t('nav.deals'), _n(x['deals'])), (t('installmentsDue'), m(x['installments'])), (t('rentDue'), m(x['rent']))]),
      ];
    case _Kind.campaigns:
      final tot = mapOf(d['totals']);
      return [
        StatCard(rows: [(t('spend'), m(tot['spend'])), (t('newLeads'), _n(tot['leads'])), (t('won'), _n(tot['won'])), (t('revenue'), m(tot['revenue'])), (t('costPerLead'), tot['costPerLead'] == null ? '—' : m(tot['costPerLead'])), (t('roi'), _pct(tot['roiPct']))]),
        for (final r in listOf(d['rows']))
          StatCard(title: '${str(r['name'])} · ${l.enumLabel('campaignChannel', str(r['channel']))}', rows: [(t('spend'), m(r['spend'])), (t('newLeads'), _n(r['leads'])), (t('won'), _n(r['won'])), (t('revenue'), m(r['revenue'])), (t('costPerLead'), r['costPerLead'] == null ? '—' : m(r['costPerLead'])), (t('roi'), _pct(r['roiPct']))]),
        SectionHeader(t('bySource')),
        BarList(rows: [for (final s in listOf(d['bySource'])) (l.enumLabel('source', str(s['source'])), numOf(s['leads']))]),
      ];
    case _Kind.incomeStatement:
      final tot = mapOf(d['totals']);
      String name(Json c) => l.isRtl && str(c['nameUr']).isNotEmpty ? str(c['nameUr']) : str(c['name']);
      return [
        StatCard(rows: [(t('income'), m(tot['income'])), (t('expense'), m(tot['expense'])), (t('netProfit'), m(tot['net'])), (t('margin'), _pct(tot['marginPct']))]),
        SectionHeader(t('income')),
        BarList(rows: [for (final c in listOf(d['income'])) (name(c), numOf(c['total']))], format: (v) => m(v)),
        SectionHeader(t('expense')),
        BarList(rows: [for (final c in listOf(d['expenses'])) (name(c), numOf(c['total']))], format: (v) => m(v)),
        if (listOf(d['branches']).length > 1) ...[
          SectionHeader(l.t('mm.reports.branches')),
          for (final b in listOf(d['branches'])) StatCard(title: str(b['name']), rows: [(t('income'), m(b['income'])), (t('expense'), m(b['expense'])), (t('netProfit'), m(b['net']))]),
        ],
      ];
    case _Kind.cashFlow:
      final tot = mapOf(d['totals']);
      return [
        StatCard(rows: [(t('income'), m(tot['income'])), (t('expense'), m(tot['expense'])), (t('netProfit'), m(tot['net']))]),
        for (final x in listOf(d['months'])) StatCard(title: str(x['month']), rows: [(t('income'), m(x['income'])), (t('expense'), m(x['expense'])), (t('netProfit'), m(x['net'])), (t('cumulative'), m(x['cumulative']))]),
      ];
    case _Kind.aging:
      final rc = mapOf(d['receivables']), py = mapOf(d['payables']);
      Widget bucket(String title, Object? b) => StatCard(title: title, rows: [for (final e in mapOf(b).entries) (e.key.replaceAll('_', '–'), m(e.value))]);
      return [
        StatCard(rows: [(t('receivable'), m(rc['total'])), (t('payable'), m(py['total']))]),
        SectionHeader(t('receivable')),
        bucket(t('commission'), rc['commission']),
        bucket(t('installmentsDue'), rc['installments']),
        bucket(t('rentDue'), rc['rent']),
        for (final r in listOf(d['receivableRows'])) ListTile(contentPadding: EdgeInsets.zero, title: Text('${str(r['party'])} · ${str(r['ref'])}'), subtitle: Text('${day(context, r['dueDate'])} · ${str(r['bucket']).replaceAll('_', '–')}'), trailing: Ltr(m(r['amount']))),
        SectionHeader(t('payable')),
        bucket(t('agents'), py['agents']),
        bucket(t('external'), py['external']),
        for (final r in listOf(d['payableRows'])) ListTile(contentPadding: EdgeInsets.zero, title: Text('${str(r['party'])} · ${str(r['ref'])}'), subtitle: Text('${day(context, r['since'])} · ${str(r['bucket']).replaceAll('_', '–')}'), trailing: Ltr(m(r['amount']))),
      ];
    case _Kind.rentRoll:
      return [
        StatCard(rows: [
          (t('activeLeases'), _n(d['activeLeases'])),
          (t('monthlyRent'), m(d['monthlyRentRoll'])),
          (t('dueThisMonth'), m(d['dueThisMonth'])),
          (t('collectedThisMonth'), m(d['collectedThisMonth'])),
          (t('overdue'), m(d['overdue'])),
          (t('depositsHeld'), m(d['depositsHeld'])),
          (t('expiringSoon'), _n(d['expiringSoon'])),
        ]),
      ];
  }
}

String _target(Object? target, Object? progress, {String Function(Object?)? money}) {
  if (target == null) return '';
  return '  / ${money == null ? _n(target) : money(target)} (${_pct(progress)})';
}

/// Commission statement of one agent, with the PDF to share.
class AgentStatementScreen extends ConsumerStatefulWidget {
  const AgentStatementScreen({super.key});
  @override
  ConsumerState<AgentStatementScreen> createState() => _AgentStatementState();
}

class _AgentStatementState extends ConsumerState<AgentStatementScreen> {
  String? _userId;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String t(String k) => l.t('mm.r.$k');
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('mm.reports.agentStatement')),
        actions: [if (_userId != null) IconButton(icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => shareDownload(context, ref, '/reports/agent-statement', query: {'userId': _userId, 'format': 'pdf'}, mimeType: 'application/pdf'))],
      ),
      body: OnlineView<List<Json>>(
        load: () async {
          final auth = ref.read(authProvider);
          if (!auth.can('members:read')) {
            return [
              {'status': 'ACTIVE', 'user': {'_id': auth.userId, 'fullName': auth.user?['fullName'] ?? ''}},
            ];
          }
          return (await apiOf(ref).page('/members', query: {'limit': 100})).items;
        },
        builder: (context, members, _) {
          final options = {for (final x in members.where((x) => x['status'] == 'ACTIVE')) str(mapOf(x['user'])['_id']): str(mapOf(x['user'])['fullName'])};
          if (options.length == 1) _userId ??= options.keys.first;
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppDropdown<String>(label: t('agent'), value: _userId, items: options, onChanged: (v) => setState(() => _userId = v)),
            const SizedBox(height: 12),
            if (_userId != null)
              SizedBox(
                height: MediaQuery.of(context).size.height * 0.7,
                child: OnlineView<Json>(
                  key: ValueKey(_userId),
                  load: () => apiOf(ref).get<Json>('/reports/agent-statement', query: {'userId': _userId}),
                  builder: (context, d, _) {
                    final tot = mapOf(d['totals']);
                    return ListView(children: [
                      StatCard(rows: [(t('expected'), money(context, tot['expected'])), (t('earned'), money(context, tot['earned'])), (t('paidOut'), money(context, tot['paidOut'])), (t('owed'), money(context, tot['owed']))]),
                      for (final r in listOf(d['rows']))
                        StatCard(title: '${str(r['dealNo'])} · ${l.enumLabel('dealStage', str(r['stage']))}', rows: [(t('share'), _pct(r['sharePct'])), (t('expected'), money(context, r['expected'])), (t('earned'), money(context, r['earned'])), (t('paidOut'), money(context, r['paidOut'])), (t('owed'), money(context, r['owed']))]),
                    ]);
                  },
                ),
              ),
          ]);
        },
      ),
    );
  }
}
