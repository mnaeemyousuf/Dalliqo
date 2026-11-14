import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';

class _Turn {
  _Turn(this.role, this.content, {this.proposals = const [], this.failed = false});
  final String role; // user | assistant
  final String content;
  final List<Map<String, dynamic>> proposals;
  final bool failed;
}

/// Assistant chat (online). Read-only answers; suggested follow-ups / notes are saved only when
/// the user taps Confirm.
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key});
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _turns = <_Turn>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _saved = <int>{};
  bool _busy = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send(String q) async {
    final text = q.trim();
    if (text.isEmpty || _busy) return;
    setState(() {
      _turns.add(_Turn('user', text));
      _busy = true;
      _input.clear();
    });
    try {
      final history = [for (final t in _turns.where((t) => !t.failed)) {'role': t.role, 'content': t.content}];
      final r = await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/ai/assistant', {'messages': history});
      setState(() => _turns.add(_Turn('assistant', '${r['answer'] ?? ''}', proposals: ((r['proposals'] as List?) ?? const []).cast<Map>().map((m) => Map<String, dynamic>.from(m)).toList())));
    } catch (e) {
      setState(() => _turns.add(_Turn('assistant', '⚠ ${errorText(context, e)}', failed: true)));
    } finally {
      if (mounted) setState(() => _busy = false);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    }
  }

  Future<void> _confirm(int key, Map<String, dynamic> p) async {
    final api = ref.read(onlineRepositoryProvider).api;
    try {
      if (p['kind'] == 'NOTE') {
        await api.post<Map<String, dynamic>>('/notes', {'entityType': 'client', 'entityId': p['clientId'], 'content': p['content']});
      } else {
        await api.post<Map<String, dynamic>>('/followups', {'uuid': const Uuid().v4(), 'clientId': p['clientId'], 'type': p['type'], 'dueAt': p['dueAt'], if ((p['notes'] as String?)?.isNotEmpty ?? false) 'notes': p['notes']});
      }
      setState(() => _saved.add(key));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(l.t('ai.title'))),
      body: Column(children: [
        Expanded(
          child: _turns.isEmpty
              ? ListView(padding: const EdgeInsets.all(24), children: [
                  Icon(Icons.auto_awesome, size: 36, color: scheme.primary),
                  const SizedBox(height: 8),
                  Text(l.t('ai.intro'), textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 16),
                  for (final q in [l.t('ai.q1'), l.t('ai.q2'), l.t('ai.q3'), l.t('ai.q5')])
                    Padding(padding: const EdgeInsets.only(bottom: 8), child: OutlinedButton(onPressed: () => _send(q), child: Text(q, textAlign: TextAlign.center))),
                ])
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(12),
                  itemCount: _turns.length + (_busy ? 1 : 0),
                  itemBuilder: (_, i) {
                    if (i == _turns.length) return Align(alignment: AlignmentDirectional.centerStart, child: Padding(padding: const EdgeInsets.all(8), child: Text(l.t('ai.thinking'))));
                    final t = _turns[i];
                    final mine = t.role == 'user';
                    return Align(
                      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
                        decoration: BoxDecoration(color: mine ? scheme.primary : scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(16)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          SelectableText(t.content.replaceAll('**', ''), style: TextStyle(color: mine ? scheme.onPrimary : null)),
                          for (final (j, p) in t.proposals.indexed)
                            Card(
                              margin: const EdgeInsets.only(top: 8),
                              child: ListTile(
                                title: Text(p['kind'] == 'NOTE' ? l.t('ai.proposeNote') : l.t('ai.proposeFollowUp')),
                                subtitle: Text(p['kind'] == 'NOTE'
                                    ? '${p['clientName']}: ${p['content']}'
                                    : '${p['clientName']} · ${l.enumLabel('followUpType', p['type'] as String?)} · ${formatDate(parseDate(p['dueAt']), locale: l.locale.languageCode)}${(p['notes'] as String?)?.isNotEmpty ?? false ? ' — ${p['notes']}' : ''}'),
                                trailing: _saved.contains(i * 100 + j)
                                    ? const Icon(Icons.check_circle, color: Colors.green)
                                    : FilledButton(onPressed: () => _confirm(i * 100 + j, p), child: Text(l.t('ai.confirm'))),
                                onTap: () => context.push('/clients/${p['clientId']}'),
                              ),
                            ),
                        ]),
                      ),
                    );
                  },
                ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: Row(children: [
              Expanded(child: TextField(controller: _input, minLines: 1, maxLines: 4, textInputAction: TextInputAction.send, onSubmitted: _send, decoration: InputDecoration(hintText: l.t('ai.placeholder'), border: const OutlineInputBorder()))),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _busy ? null : () => _send(_input.text), icon: const Icon(Icons.send)),
            ]),
          ),
        ),
      ]),
    );
  }
}
