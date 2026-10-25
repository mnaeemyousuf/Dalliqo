import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

const followUpTypes = ['CALL', 'MEETING', 'WHATSAPP', 'SMS', 'PROPERTY_VISIT', 'GENERAL'];

class FollowUpsScreen extends ConsumerStatefulWidget {
  const FollowUpsScreen({super.key});
  @override
  ConsumerState<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends ConsumerState<FollowUpsScreen> {
  bool _mine = true;

  @override
  Widget build(BuildContext context) {
    ref.watch(entityChangesProvider('followUps'));
    ref.watch(entityChangesProvider('clients'));
    final l = context.l10n;
    final repo = ref.watch(crmRepositoryProvider);
    final me = ref.watch(authProvider).userId;
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.t('followup.title')),
          actions: [
            TextButton(onPressed: () => setState(() => _mine = !_mine), child: Text(_mine ? l.t('followup.mine') : l.t('followup.everyone'))),
          ],
          bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
            for (final k in const ['today', 'upcoming', 'overdue', 'done']) Tab(text: l.t('followup.tabs.$k')),
          ]),
        ),
        floatingActionButton: ref.watch(authProvider).can('followups:create') ? FloatingActionButton(onPressed: () => context.push('/followups/new'), child: const Icon(Icons.add)) : null,
        body: FutureBuilder(
          future: Future.wait<Object>([repo.followUps(assignedTo: _mine ? me : null), repo.clients(const ClientFilter(), limit: 100000)]),
          builder: (context, snap) {
            if (!snap.hasData) return const AppLoader();
            final all = snap.data![0] as List<FollowUp>;
            final clients = {for (final c in snap.data![1] as List<Client>) ...{c.id: c.fullName, c.local!.uuid: c.fullName}};
            final now = DateTime.now();
            final startOfDay = DateTime(now.year, now.month, now.day);
            final endOfDay = startOfDay.add(const Duration(days: 1));
            final tabs = [
              all.where((f) => f.isOpen && !f.dueAt.toLocal().isBefore(startOfDay) && f.dueAt.toLocal().isBefore(endOfDay)).toList(),
              all.where((f) => f.isOpen && !f.dueAt.toLocal().isBefore(endOfDay)).toList(),
              all.where((f) => f.status == 'OVERDUE' && f.dueAt.toLocal().isBefore(startOfDay)).toList(),
              all.where((f) => f.status == 'COMPLETED').toList().reversed.toList(),
            ];
            return TabBarView(children: [
              for (final list in tabs)
                list.isEmpty
                    ? AppEmptyState(title: l.t('followup.noFollowUps'), icon: Icons.event_available)
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                        itemCount: list.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => FollowUpCard(
                          followUp: list[i],
                          clientName: clients[list[i].clientId],
                          onComplete: () => _complete(context, list[i]),
                        ),
                      ),
            ]);
          },
        ),
      ),
    );
  }

  Future<void> _complete(BuildContext context, FollowUp f) async {
    final outcome = TextEditingController();
    final ok = await showAppBottomSheet<bool>(
      context,
      title: context.t('followup.complete'),
      child: Column(children: [
        AppTextField(label: context.t('followup.outcome'), controller: outcome, maxLines: 3),
        const SizedBox(height: 12),
        AppButton(label: context.t('common.save'), expand: true, onPressed: () => Navigator.pop(context, true)),
      ]),
    );
    if (ok == true) {
      await ref.read(crmRepositoryProvider).completeFollowUp(f.local!.uuid, outcome: outcome.text.trim());
      if (context.mounted) showMessage(context, context.t('followup.completed'));
    }
  }
}

/// Works offline: clients and properties are picked from the local database,
/// and an unsynced client is referenced by its device uuid (resolved on sync).
class FollowUpFormScreen extends ConsumerStatefulWidget {
  const FollowUpFormScreen({super.key, this.clientId, this.propertyId});
  final String? clientId;
  final String? propertyId;
  @override
  ConsumerState<FollowUpFormScreen> createState() => _FollowUpFormScreenState();
}

class _FollowUpFormScreenState extends ConsumerState<FollowUpFormScreen> {
  String? _clientId;
  String? _propertyId;
  String _type = 'CALL';
  String _priority = 'MEDIUM';
  DateTime _due = DateTime.now().add(const Duration(hours: 1));
  int _reminder = 30;
  String? _assignedTo;
  final _notes = TextEditingController();
  bool _saving = false;
  List<Client> _clients = const [];
  List<Property> _properties = const [];
  List<Map<String, dynamic>> _members = const [];

  @override
  void initState() {
    super.initState();
    _clientId = widget.clientId;
    _propertyId = widget.propertyId;
    _assignedTo = ref.read(authProvider).userId;
    _due = DateTime(_due.year, _due.month, _due.day, _due.hour);
    _init();
  }

  Future<void> _init() async {
    final repo = ref.read(crmRepositoryProvider);
    final clients = await repo.clients(const ClientFilter(sort: 'name'), limit: 100000);
    final properties = await repo.properties(const PropertyFilter(), limit: 100000);
    List<Map<String, dynamic>> members = const [];
    try {
      members = (await ref.read(onlineRepositoryProvider).members()).where((m) => m['status'] == 'ACTIVE').toList();
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _clients = clients;
      _properties = properties;
      _members = members;
    });
  }

  Future<void> _pickDue() async {
    final date = await showDatePicker(context: context, initialDate: _due, firstDate: DateTime.now().subtract(const Duration(days: 365)), lastDate: DateTime.now().add(const Duration(days: 730)));
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_due));
    if (time == null) return;
    setState(() => _due = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _save() async {
    if (_clientId == null) return showMessage(context, context.t('followup.selectClient'));
    setState(() => _saving = true);
    try {
      await ref.read(crmRepositoryProvider).saveFollowUp({
        'clientId': _clientId,
        if (_propertyId != null) 'propertyId': _propertyId,
        'type': _type,
        'priority': _priority,
        'dueAt': _due.toUtc().toIso8601String(),
        'reminderMinutesBefore': _reminder,
        if (_assignedTo != null) 'assignedTo': _assignedTo,
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      showMessage(context, context.t('followup.created'));
      context.pop();
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
      appBar: AppBar(title: Text(l.t('followup.add'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        AppDropdown<String>(label: l.t('followup.client'), value: _clientId, items: {for (final c in _clients) c.id: '${c.fullName} — ${c.mobileNumber}'}, onChanged: (v) => setState(() => _clientId = v)),
        const SizedBox(height: 12),
        AppDropdown<String>(
          label: l.t('followup.property'),
          value: _propertyId,
          allowEmpty: true,
          items: {for (final p in _properties) p.id: '${p.propertyId ?? l.t('mobile.pendingId')} — ${p.location}'},
          onChanged: (v) => setState(() => _propertyId = v),
        ),
        const SizedBox(height: 12),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final t in followUpTypes) ChoiceChip(label: Text(l.enumLabel('followUpType', t)), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
        ]),
        const SizedBox(height: 12),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.event),
          title: Text(l.t('followup.dueAt')),
          subtitle: Ltr(formatDate(_due, time: true, locale: l.locale.languageCode)),
          onTap: _pickDue,
        ),
        AppDropdown<int>(
          label: l.t('followup.reminderBefore'),
          value: _reminder,
          items: {for (final m in const [0, 15, 30, 60, 120, 1440]) m: '$m ${l.t('common.minutes')}'},
          onChanged: (v) => setState(() => _reminder = v ?? 30),
        ),
        const SizedBox(height: 12),
        AppDropdown<String>(label: l.t('followup.priority'), value: _priority, items: {for (final p in const ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) p: l.enumLabel('priority', p)}, onChanged: (v) => setState(() => _priority = v ?? 'MEDIUM')),
        if (_members.isNotEmpty) ...[
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('followup.assignedTo'), value: _assignedTo, items: {for (final m in _members) (m['user'] as Map)['_id'] as String: (m['user'] as Map)['fullName'] as String}, onChanged: (v) => setState(() => _assignedTo = v)),
        ],
        const SizedBox(height: 12),
        AppTextField(label: l.t('common.notes'), controller: _notes, maxLines: 3),
        const SizedBox(height: 24),
        AppButton(label: l.t('common.save'), loading: _saving, onPressed: _save, expand: true),
      ]),
    );
  }
}

/// One follow-up: details, complete / cancel (both work offline) and its notes.
class FollowUpDetailScreen extends ConsumerWidget {
  const FollowUpDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('followUps'));
    final l = context.l10n;
    final repo = ref.watch(crmRepositoryProvider);
    final canUpdate = ref.watch(authProvider).can('followups:update');
    return FutureBuilder<FollowUp?>(
      future: repo.followUp(id),
      builder: (context, snap) {
        if (!snap.hasData) {
          return Scaffold(appBar: AppBar(), body: snap.connectionState == ConnectionState.done ? AppEmptyState(title: l.t('common.notFound')) : const AppLoader());
        }
        final f = snap.data!;
        final uuid = f.local!.uuid;
        final property = f.property;
        return Scaffold(
          appBar: AppBar(
            title: Text(l.enumLabel('followUpType', f.type)),
            actions: [
              if (canUpdate && f.isOpen)
                IconButton(
                  tooltip: l.t('followup.cancelFollowUp'),
                  icon: const Icon(Icons.cancel_outlined),
                  onPressed: () async {
                    if (await confirmDialog(context, title: l.t('followup.cancelFollowUp'))) await repo.cancelFollowUp(uuid);
                  },
                ),
            ],
          ),
          body: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Wrap(spacing: 6, runSpacing: 4, children: [
                    AppChip(l.enumLabel('followUpStatus', f.status), tone: switch (f.status) { 'OVERDUE' => ChipTone.red, 'COMPLETED' => ChipTone.green, 'CANCELLED' => ChipTone.grey, _ => ChipTone.blue }),
                    AppChip(l.enumLabel('priority', f.priority), tone: priorityTone(f.priority)),
                    SyncBadge(f.syncStatus),
                  ]),
                  const SizedBox(height: 8),
                  InfoRow(l.t('followup.dueAt'), formatDate(f.dueAt, time: true, locale: l.locale.languageCode), ltr: true),
                  if (f.client != null)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.person_outline),
                      title: Text(f.client!['fullName'] as String? ?? ''),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/clients/${f.clientId}'),
                    ),
                  if (property != null)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.home_work_outlined),
                      title: Ltr('${property['propertyId'] ?? ''}'),
                      subtitle: Text([property['block'], property['society'] ?? property['area']].whereType<String>().join(', ')),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/properties/${f.propertyId}'),
                    ),
                  InfoRow(l.t('common.notes'), f.notes),
                  InfoRow(l.t('followup.outcome'), f.outcome),
                  if (f.client != null) ...[
                    const SizedBox(height: 4),
                    ContactActions(phone: f.client!['mobileNumber'] as String? ?? '', whatsapp: f.client!['whatsappNumber'] as String?, clientId: f.clientId),
                  ],
                  if (canUpdate && f.isOpen) ...[
                    const SizedBox(height: 12),
                    AppButton(
                      label: l.t('followup.reschedule'),
                      icon: Icons.schedule,
                      outlined: true,
                      expand: true,
                      onPressed: () async {
                        final start = f.dueAt.isAfter(DateTime.now()) ? f.dueAt : DateTime.now().add(const Duration(hours: 1));
                        final day = await showDatePicker(context: context, initialDate: start, firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 730)));
                        if (day == null || !context.mounted) return;
                        final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(start));
                        if (time == null) return;
                        await repo.rescheduleFollowUp(uuid, DateTime(day.year, day.month, day.day, time.hour, time.minute));
                        if (context.mounted) showMessage(context, l.t('followup.rescheduled'));
                      },
                    ),
                    const SizedBox(height: 8),
                    AppButton(
                      label: l.t('followup.complete'),
                      icon: Icons.check_circle_outline,
                      expand: true,
                      onPressed: () async {
                        final outcome = await promptText(context, title: l.t('followup.complete'), label: l.t('followup.outcome'), maxLines: 3);
                        if (outcome == null) return;
                        await repo.completeFollowUp(uuid, outcome: outcome);
                        if (context.mounted) showMessage(context, l.t('followup.completed'));
                      },
                    ),
                  ],
                ]),
              ),
            ),
            Expanded(child: NotesPanel(entityType: 'followUp', entityId: f.id)),
          ]),
        );
      },
    );
  }
}
