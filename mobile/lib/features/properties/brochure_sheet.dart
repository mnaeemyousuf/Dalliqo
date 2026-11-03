import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// Brochure options → PDF / 1080×1350 image / text, shared to WhatsApp or the share sheet. The server makes
/// the files (needs internet). Only the asking price is ever printed, and it can be hidden.
Future<void> showBrochureSheet(BuildContext context, WidgetRef ref, Property p) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _BrochureSheet(property: p),
  );
}

class _BrochureSheet extends ConsumerStatefulWidget {
  const _BrochureSheet({required this.property});
  final Property property;
  @override
  ConsumerState<_BrochureSheet> createState() => _BrochureSheetState();
}

class _BrochureSheetState extends ConsumerState<_BrochureSheet> {
  late String _lang = context.l10n.isRtl ? 'ur' : 'en';
  bool _hidePrice = false;
  String? _agentId;
  String? _busy;
  Map<String, String> _members = const {};

  @override
  void initState() {
    super.initState();
    _agentId = ref.read(authProvider).userId;
    ref.read(onlineRepositoryProvider).members().then((items) {
      if (!mounted) return;
      setState(() => _members = {
            for (final m in items)
              if (m['user'] is Map && m['status'] == 'ACTIVE') (m['user'] as Map)['_id'] as String: ((m['user'] as Map)['fullName'] as String?) ?? '',
          });
    }).catchError((_) {});
  }

  String? get _agentParam => _agentId == ref.read(authProvider).userId ? null : _agentId;

  Future<void> _run(String key, Future<void> Function() action) async {
    setState(() => _busy = key);
    try {
      await action();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _shareFile(String format) => _run(format, () async {
        final file = await ref.read(onlineRepositoryProvider).brochure(widget.property.serverId!, format: format, lang: _lang, hidePrice: _hidePrice, agentId: _agentParam);
        await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: format == 'pdf' ? 'application/pdf' : 'image/png')], text: widget.property.propertyId));
      });

  Future<void> _whatsapp() => _run('wa', () async {
        final r = await ref.read(onlineRepositoryProvider).brochureText(widget.property.serverId!, lang: _lang, hidePrice: _hidePrice, agentId: _agentParam);
        await launchUrl(Uri.parse(r['whatsappUrl'] as String), mode: LaunchMode.externalApplication);
      });

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final synced = widget.property.serverId != null;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.t('brochure.title'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(l.t('brochure.hint'), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ur', label: Text('اردو'))],
            selected: {_lang},
            onSelectionChanged: (s) => setState(() => _lang = s.first),
          ),
          if (_members.length > 1) ...[
            const SizedBox(height: 12),
            AppDropdown<String>(label: l.t('brochure.agent'), value: _members.containsKey(_agentId) ? _agentId : null, items: _members, onChanged: (v) => setState(() => _agentId = v)),
          ],
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('brochure.hidePrice')), value: _hidePrice, onChanged: (v) => setState(() => _hidePrice = v)),
          Text(l.t('brochure.confidential'), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Text(synced ? l.t('brochure.needsInternet') : l.t('mobile.sync.pending'), style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.amber.shade800)),
          const SizedBox(height: 12),
          if (_busy != null) const LinearProgressIndicator(),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton.icon(onPressed: !synced || _busy != null ? null : () => _shareFile('png'), icon: const Icon(Icons.image_outlined), label: Text(l.t('brochure.image'))),
            OutlinedButton.icon(onPressed: !synced || _busy != null ? null : () => _shareFile('pdf'), icon: const Icon(Icons.picture_as_pdf_outlined), label: Text(l.t('brochure.pdf'))),
            OutlinedButton.icon(onPressed: !synced || _busy != null ? null : _whatsapp, icon: const Icon(Icons.chat_outlined, color: Colors.green), label: const Text('WhatsApp')),
          ]),
        ]),
      ),
    );
  }
}
