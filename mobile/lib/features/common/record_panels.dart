import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// Notes work offline (they're a synced entity).
class NotesPanel extends ConsumerStatefulWidget {
  const NotesPanel({super.key, required this.entityType, required this.entityId});
  final String entityType;
  final String entityId;
  @override
  ConsumerState<NotesPanel> createState() => _NotesPanelState();
}

class _NotesPanelState extends ConsumerState<NotesPanel> {
  final _text = TextEditingController();

  @override
  Widget build(BuildContext context) {
    ref.watch(entityChangesProvider('notes'));
    final repo = ref.watch(crmRepositoryProvider);
    final me = ref.watch(authProvider).userId;
    final canAll = ref.watch(authProvider).can('notes:manage_all');
    return FutureBuilder(
      future: repo.notes(widget.entityType, widget.entityId),
      builder: (context, snap) {
        final notes = snap.data ?? const [];
        return ListView(padding: const EdgeInsets.all(16), children: [
          AppTextField(label: context.t('note.placeholder'), controller: _text, maxLines: 3),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: AppButton(
              label: context.t('note.add'),
              icon: Icons.add,
              onPressed: () async {
                if (_text.text.trim().isEmpty) return;
                await repo.addNote(widget.entityType, widget.entityId, _text.text.trim());
                _text.clear();
                if (context.mounted) showMessage(context, context.t('note.added'));
              },
            ),
          ),
          const SizedBox(height: 12),
          if (snap.connectionState == ConnectionState.done && notes.isEmpty) AppEmptyState(title: context.t('note.noNotes')),
          for (final n in notes)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(n.content),
                  const SizedBox(height: 6),
                  Row(children: [
                    Text(n.createdAt == null ? '' : relativeTime(n.createdAt!, locale: context.l10n.locale.languageCode), style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(width: 6),
                    SyncBadge(n.syncStatus),
                    const Spacer(),
                    if (n.authorId == null || n.authorId == me || canAll)
                      IconButton(
                        icon: const Icon(Icons.delete_outline, size: 18),
                        onPressed: () async {
                          if (await confirmDialog(context, title: context.t('common.areYouSure'))) await repo.deleteNote(n.local!.uuid);
                        },
                      ),
                  ]),
                ]),
              ),
            ),
        ]);
      },
    );
  }
}

/// Business timeline (online; computed by the server).
class ActivityPanel extends ConsumerWidget {
  const ActivityPanel({super.key, required this.entityId});
  final String entityId;

  @override
  Widget build(BuildContext context, WidgetRef ref) => FutureBuilder(
        future: ref.watch(onlineRepositoryProvider).activities(entityId),
        builder: (context, snap) {
          if (snap.hasError) return AppErrorState(error: snap.error!);
          if (!snap.hasData) return const AppLoader();
          final items = snap.data!;
          if (items.isEmpty) return AppEmptyState(title: context.t('activity.noActivity'));
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            itemBuilder: (context, i) {
              final a = items[i];
              final actor = a['actorUserId'] is Map ? (a['actorUserId'] as Map)['fullName'] as String? : null;
              return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Column(children: [
                  Container(width: 10, height: 10, margin: const EdgeInsets.only(top: 5), decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, shape: BoxShape.circle)),
                  if (i < items.length - 1) Container(width: 2, height: 44, color: Theme.of(context).colorScheme.outlineVariant),
                ]),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(a['summary'] as String? ?? ''),
                      Text('${actor ?? ''} · ${formatDate(parseDate(a['createdAt']), time: true, locale: context.l10n.locale.languageCode)}', style: Theme.of(context).textTheme.bodySmall),
                    ]),
                  ),
                ),
              ]);
            },
          );
        },
      );
}

/// Documents live in private cloud storage; opening one fetches a short-lived signed link.
class DocumentsPanel extends ConsumerStatefulWidget {
  const DocumentsPanel({super.key, required this.entityType, required this.serverId});
  final String entityType;

  /// Null until the record has synced (documents need the server record).
  final String? serverId;
  @override
  ConsumerState<DocumentsPanel> createState() => _DocumentsPanelState();
}

class _DocumentsPanelState extends ConsumerState<DocumentsPanel> {
  double? _progress;
  int _reload = 0;

  Future<void> _upload() async {
    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx']);
    final path = picked.isEmpty ? null : picked.single.path;
    if (path == null || !mounted) return;
    final category = await showAppBottomSheet<String>(
      context,
      title: context.t('document.category'),
      child: Column(children: [
        for (final c in const ['REGISTRATION', 'OWNERSHIP', 'AGREEMENT', 'IDENTITY', 'PROPERTY_DOCUMENT', 'OTHER'])
          ListTile(title: Text(context.l10n.enumLabel('documentCategory', c)), onTap: () => Navigator.pop(context, c)),
      ]),
    );
    if (category == null) return;
    setState(() => _progress = 0);
    try {
      await ref.read(onlineRepositoryProvider).uploadDocument(widget.entityType, widget.serverId!, File(path), category, onProgress: (p) => setState(() => _progress = p));
      if (mounted) showMessage(context, context.t('document.uploaded'));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) {
        setState(() {
          _progress = null;
          _reload++;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.serverId == null) return AppEmptyState(title: context.t('mobile.sync.pending'), icon: Icons.cloud_upload_outlined);
    final repo = ref.watch(onlineRepositoryProvider);
    final auth = ref.watch(authProvider);
    return FutureBuilder(
      key: ValueKey(_reload),
      future: repo.documents(widget.entityType, widget.serverId!),
      builder: (context, snap) => ListView(padding: const EdgeInsets.all(16), children: [
        if (auth.can('documents:upload'))
          AppButton(
            label: _progress == null ? context.t('document.upload') : '${(_progress! * 100).round()}%',
            icon: Icons.upload_file,
            loading: _progress != null && _progress! >= 1,
            onPressed: _progress == null ? _upload : null,
            expand: true,
          ),
        const SizedBox(height: 12),
        if (snap.hasError) AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++)),
        if (!snap.hasData && !snap.hasError) const AppLoader(),
        if (snap.hasData && snap.data!.isEmpty) AppEmptyState(title: context.t('document.noDocuments'), icon: Icons.description_outlined),
        for (final d in snap.data ?? const <Map<String, dynamic>>[])
          Card(
            child: ListTile(
              leading: const Icon(Icons.description_outlined),
              title: Text(d['fileName'] as String? ?? ''),
              subtitle: Text(context.l10n.enumLabel('documentCategory', d['category'] as String?)),
              onTap: () async {
                try {
                  await Contact.openUrl(await repo.documentUrl(d['_id'] as String));
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
              trailing: PopupMenuButton<String>(
                onSelected: (v) async {
                  try {
                    if (v == 'share') await SharePlus.instance.share(ShareParams(text: await repo.documentUrl(d['_id'] as String)));
                    if (v == 'rename' && context.mounted) {
                      final name = await promptText(context, title: context.t('document.rename'), label: context.t('document.fileName'), initial: d['fileName'] as String? ?? '');
                      if (name != null && name.trim().isNotEmpty) {
                        await repo.renameDocument(d['_id'] as String, name.trim());
                        if (context.mounted) showMessage(context, context.t('document.renamed'));
                        setState(() => _reload++);
                      }
                    }
                    if (v == 'delete' && context.mounted && await confirmDialog(context, title: context.t('common.areYouSure'))) {
                      await repo.deleteDocument(d['_id'] as String);
                      setState(() => _reload++);
                    }
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  }
                },
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'share', child: Text(context.t('common.share'))),
                  if (auth.can('documents:upload')) PopupMenuItem(value: 'rename', child: Text(context.t('document.rename'))),
                  if (auth.can('documents:delete')) PopupMenuItem(value: 'delete', child: Text(context.t('common.delete'))),
                ],
              ),
            ),
          ),
      ]),
    );
  }
}

class FollowUpsPanel extends ConsumerWidget {
  const FollowUpsPanel({super.key, this.clientId, this.propertyId});
  final String? clientId;
  final String? propertyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('followUps'));
    final repo = ref.watch(crmRepositoryProvider);
    return FutureBuilder(
      future: repo.followUps(clientId: clientId, propertyId: propertyId),
      builder: (context, snap) => ListView(padding: const EdgeInsets.all(16), children: [
        AppButton(
          label: context.t('followup.add'),
          icon: Icons.add,
          expand: true,
          onPressed: () => context.push(Uri(path: '/followups/new', queryParameters: {if (clientId != null) 'clientId': clientId, if (propertyId != null) 'propertyId': propertyId}).toString()),
        ),
        const SizedBox(height: 12),
        if (snap.hasData && snap.data!.isEmpty) AppEmptyState(title: context.t('followup.noFollowUps')),
        for (final f in snap.data ?? const [])
          Padding(padding: const EdgeInsets.only(bottom: 8), child: FollowUpCard(followUp: f, onComplete: () => repo.completeFollowUp(f.local!.uuid))),
      ]),
    );
  }
}
