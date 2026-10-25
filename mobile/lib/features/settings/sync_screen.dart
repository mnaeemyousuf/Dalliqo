import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/database/app_database.dart';
import '../../core/l10n/app_localizations.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';

/// Sync centre: status, waiting changes, rejected changes and conflicts
/// ("This record was modified by another user — Keep mine / Keep latest").
class SyncScreen extends ConsumerStatefulWidget {
  const SyncScreen({super.key});
  @override
  ConsumerState<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends ConsumerState<SyncScreen> {
  int _reload = 0;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final engine = ref.watch(syncEngineProvider);
    final s = engine.state;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('mobile.sync.title'))),
      body: FutureBuilder(
        key: ValueKey('${_reload}_${s.pending}_${s.failed}_${s.conflicts}'),
        future: Future.wait<Object>([engine.db.allOutbox(), engine.conflicts()]),
        builder: (context, snap) {
          final outbox = (snap.data?[0] as List<OutboxEntry>?) ?? const [];
          final conflicts = (snap.data?[1] as List<Map<String, Object?>>?) ?? const [];
          final failed = outbox.where((o) => o.status == 'failed').toList();
          final pending = outbox.where((o) => o.status == 'pending').toList();
          return ListView(padding: const EdgeInsets.all(16), children: [
            AppCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(s.online ? Icons.cloud_done_outlined : Icons.cloud_off, color: s.online ? Colors.green : Colors.grey),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(!s.online
                        ? l.t('mobile.sync.offline')
                        : s.needsAttention > 0
                            ? l.t('mobile.sync.attention', {'count': s.needsAttention})
                            : s.pending > 0
                                ? l.t('mobile.sync.syncing', {'count': s.pending})
                                : l.t('mobile.sync.allSynced')),
                  ),
                ]),
                if (s.lastSyncedAt != null) Text(l.t('mobile.sync.lastSync', {'time': relativeTime(s.lastSyncedAt!, locale: l.locale.languageCode)}), style: Theme.of(context).textTheme.bodySmall),
                if (s.lastError != null) Text(s.lastError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
                const SizedBox(height: 12),
                AppButton(label: l.t('mobile.sync.syncNow'), icon: Icons.sync, loading: s.running, onPressed: () => engine.syncNow(), expand: true),
              ]),
            ),
            if (conflicts.isNotEmpty) ...[
              SectionHeader('${l.t('mobile.sync.conflict')} (${conflicts.length})'),
              for (final c in conflicts) _ConflictCard(conflict: c, onDone: () => setState(() => _reload++)),
            ],
            if (failed.isNotEmpty) ...[
              SectionHeader('${l.t('mobile.sync.failed')} (${failed.length})'),
              for (final f in failed)
                Card(
                  child: ListTile(
                    title: Text('${l.t('enums.entity.${_singular(f.entity)}')} · ${f.op}'),
                    subtitle: Text(f.lastError ?? ''),
                    trailing: Wrap(children: [
                      IconButton(tooltip: l.t('common.retry'), icon: const Icon(Icons.refresh), onPressed: () => engine.retryFailed(f.id)),
                      IconButton(tooltip: l.t('mobile.sync.discard'), icon: const Icon(Icons.delete_outline), onPressed: () => engine.discardFailed(f.id, f.entity, f.uuid)),
                    ]),
                  ),
                ),
            ],
            SectionHeader('${l.t('mobile.sync.pending')} (${pending.length})'),
            if (pending.isEmpty) Text(l.t('mobile.sync.nothing'), style: Theme.of(context).textTheme.bodySmall),
            for (final p in pending)
              ListTile(
                dense: true,
                leading: const Icon(Icons.cloud_upload_outlined),
                title: Text('${l.t('enums.entity.${_singular(p.entity)}')} · ${p.op}'),
                subtitle: Text(_summary(p.data)),
              ),
          ]);
        },
      ),
    );
  }

  static String _singular(String entity) => switch (entity) { 'clients' => 'client', 'properties' => 'property', 'owners' => 'owner', 'followUps' => 'followUp', _ => 'client' };

  static String _summary(Map<String, dynamic> d) =>
      [d['fullName'], d['propertyId'], d['society'], d['content'], d['type'], d['status']].whereType<String>().take(2).join(' · ');
}

class _ConflictCard extends ConsumerWidget {
  const _ConflictCard({required this.conflict, required this.onDone});
  final Map<String, Object?> conflict;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final mine = jsonDecode(conflict['mine']! as String) as Map<String, dynamic>;
    final server = jsonDecode(conflict['server']! as String) as Map<String, dynamic>;
    final entity = conflict['entity']! as String;
    final uuid = conflict['uuid']! as String;
    String fmt(String k, Object? v) => v is num && k.toLowerCase().contains('price') ? formatPkr(v, urdu: l.isRtl) : '${v ?? '—'}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l.t('mobile.sync.conflictTitle'), style: Theme.of(context).textTheme.titleSmall),
          Text('${server['fullName'] ?? server['propertyId'] ?? ''}', style: Theme.of(context).textTheme.bodySmall),
          if (conflict['message'] != null) Text(conflict['message']! as String, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Table(
            columnWidths: const {0: IntrinsicColumnWidth()},
            children: [
              TableRow(children: [const SizedBox(), Text(l.t('mobile.sync.yourVersion'), style: const TextStyle(fontWeight: FontWeight.w600)), Text(l.t('mobile.sync.serverVersion'), style: const TextStyle(fontWeight: FontWeight.w600))]),
              for (final k in mine.keys)
                TableRow(children: [
                  Padding(padding: const EdgeInsetsDirectional.only(end: 8, top: 4), child: Text(k, style: Theme.of(context).textTheme.bodySmall)),
                  Padding(padding: const EdgeInsets.only(top: 4), child: Text(fmt(k, mine[k]), style: const TextStyle(color: Colors.blue))),
                  Padding(padding: const EdgeInsets.only(top: 4), child: Text(fmt(k, server[k]), style: const TextStyle(color: Colors.green))),
                ]),
            ],
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppButton(label: l.t('mobile.sync.keepMine'), outlined: true, onPressed: () async {
              await ref.read(syncEngineProvider).keepMine(entity, uuid);
              onDone();
            })),
            const SizedBox(width: 8),
            Expanded(child: AppButton(label: l.t('mobile.sync.keepLatest'), onPressed: () async {
              await ref.read(syncEngineProvider).keepLatest(entity, uuid);
              onDone();
            })),
          ]),
        ]),
      ),
    );
  }
}
