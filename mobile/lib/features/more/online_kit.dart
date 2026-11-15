import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';

/// Building blocks for the screens that work against live server data (reports, marketing,
/// administration and the record actions that the server must decide). They all need a
/// connection; errors are shown with a retry.

typedef Json = Map<String, dynamic>;

ApiClient apiOf(WidgetRef ref) => ref.read(apiClientProvider);

List<Json> listOf(Object? v) => ((v as List?) ?? const []).whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
Json mapOf(Object? v) => (v as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
num numOf(Object? v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String str(Object? v) => v == null ? '' : '$v';
DateTime? dateOf(Object? v) => v == null ? null : DateTime.tryParse('$v')?.toLocal();

/// Name of a populated reference ({_id, fullName | name | title}) or '' for a bare id.
String refName(Object? v) => v is Map ? str(v['fullName'] ?? v['name'] ?? v['title'] ?? v['propertyId'] ?? v['dealNo']) : '';
String refId(Object? v) => v is Map ? str(v['_id']) : str(v);

String money(BuildContext context, Object? v) => formatPkr(numOf(v), urdu: context.l10n.isRtl);
String day(BuildContext context, Object? v) => formatDate(dateOf(v), locale: context.l10n.locale.languageCode);

/// Loads data once, shows loader / error with retry, and gives the builder a reload callback.
class OnlineView<T> extends StatefulWidget {
  const OnlineView({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, VoidCallback reload) builder;
  @override
  State<OnlineView<T>> createState() => _OnlineViewState<T>();
}

class _OnlineViewState<T> extends State<OnlineView<T>> {
  late Future<T> _future = widget.load();
  void _reload() => setState(() => _future = widget.load());

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const AppLoader();
          if (snap.hasError) return AppErrorState(error: snap.error!, onRetry: _reload);
          return RefreshIndicator(onRefresh: () async => _reload(), child: widget.builder(context, snap.data as T, _reload));
        },
      );
}

/// Runs a server action, showing the error (or [done]) as a snack bar. True when it succeeded.
Future<bool> runAction(BuildContext context, Future<Object?> Function() action, {String? done}) async {
  try {
    await action();
    if (context.mounted) showMessage(context, done ?? context.t('common.changesSaved'));
    return true;
  } catch (e) {
    if (context.mounted) showError(context, e);
    return false;
  }
}

/// Downloads a server-made file (PDF / Excel / PNG) and opens the share sheet.
Future<void> shareDownload(BuildContext context, WidgetRef ref, String path, {Map<String, dynamic>? query, String? mimeType}) async {
  showMessage(context, context.t('report.generating'));
  try {
    final r = await apiOf(ref).download(path, query: query);
    final dir = await getTemporaryDirectory();
    final file = File(p.join(dir.path, r.fileName));
    await file.writeAsBytes(r.bytes, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: mimeType)]));
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

// ───────────── Declarative form sheet ─────────────

enum FieldKind { text, number, multiline, select, toggle, date }

class FormFieldSpec {
  const FormFieldSpec(this.key, this.label, {this.kind = FieldKind.text, this.options = const {}, this.initial, this.required = false, this.hint, this.ltr = false});
  final String key;
  final String label;
  final FieldKind kind;
  final Map<String, String> options;
  final Object? initial;
  final bool required;
  final String? hint;
  final bool ltr;
}

/// A bottom-sheet form. Returns the entered values (numbers as num, dates as ISO strings, empty
/// text left out) or null when cancelled.
Future<Json?> showFormSheet(BuildContext context, {required String title, required List<FormFieldSpec> fields, String? submitLabel, String? note}) =>
    showAppBottomSheet<Json>(context, title: title, child: _FormSheet(fields: fields, submitLabel: submitLabel, note: note));

class _FormSheet extends StatefulWidget {
  const _FormSheet({required this.fields, this.submitLabel, this.note});
  final List<FormFieldSpec> fields;
  final String? submitLabel;
  final String? note;
  @override
  State<_FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<_FormSheet> {
  final _text = <String, TextEditingController>{};
  final _values = <String, Object?>{};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      switch (f.kind) {
        case FieldKind.text || FieldKind.number || FieldKind.multiline:
          _text[f.key] = TextEditingController(text: f.initial == null ? '' : '${f.initial}');
        case FieldKind.toggle:
          _values[f.key] = f.initial == true;
        case FieldKind.select || FieldKind.date:
          _values[f.key] = f.initial;
      }
    }
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final out = <String, dynamic>{};
    for (final f in widget.fields) {
      Object? v;
      switch (f.kind) {
        case FieldKind.text || FieldKind.multiline:
          final t = _text[f.key]!.text.trim();
          v = t.isEmpty ? null : t;
        case FieldKind.number:
          final t = _text[f.key]!.text.trim().replaceAll(',', '');
          v = t.isEmpty ? null : num.tryParse(t);
          if (t.isNotEmpty && v == null) {
            setState(() => _error = '${f.label}: ${context.t('mm.number')}');
            return;
          }
        case FieldKind.toggle || FieldKind.select || FieldKind.date:
          v = _values[f.key];
      }
      if (f.required && (v == null || v == '')) {
        setState(() => _error = '${f.label}: ${context.t('mm.required')}');
        return;
      }
      if (v != null) out[f.key] = v;
    }
    Navigator.pop(context, out);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (widget.note != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(widget.note!, style: Theme.of(context).textTheme.bodySmall)),
      for (final f in widget.fields)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: switch (f.kind) {
            FieldKind.text => AppTextField(label: f.label, controller: _text[f.key], hint: f.hint, textDirection: f.ltr ? TextDirection.ltr : null),
            FieldKind.number => AppTextField(label: f.label, controller: _text[f.key], hint: f.hint, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), textDirection: TextDirection.ltr),
            FieldKind.multiline => AppTextField(label: f.label, controller: _text[f.key], hint: f.hint, maxLines: 3),
            FieldKind.select => AppDropdown<String>(label: f.label, value: _values[f.key] as String?, items: f.options, allowEmpty: !f.required, onChanged: (v) => setState(() => _values[f.key] = v)),
            FieldKind.toggle => SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(f.label), subtitle: f.hint == null ? null : Text(f.hint!), value: _values[f.key] == true, onChanged: (v) => setState(() => _values[f.key] = v)),
            FieldKind.date => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event_outlined),
                title: Text(f.label),
                subtitle: Text(_values[f.key] == null ? '—' : formatDate(DateTime.tryParse('${_values[f.key]}')?.toLocal(), locale: l.locale.languageCode)),
                trailing: _values[f.key] == null ? null : IconButton(icon: const Icon(Icons.clear), onPressed: () => setState(() => _values[f.key] = null)),
                onTap: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse('${_values[f.key] ?? ''}') ?? now, firstDate: DateTime(now.year - 10), lastDate: DateTime(now.year + 30));
                  if (picked != null) setState(() => _values[f.key] = DateTime.utc(picked.year, picked.month, picked.day).toIso8601String());
                },
              ),
          },
        ),
      if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      AppButton(label: widget.submitLabel ?? l.t('common.save'), onPressed: _submit, expand: true),
    ]);
  }
}

// ───────────── Small display pieces ─────────────

/// A titled card of label / value rows.
class StatCard extends StatelessWidget {
  const StatCard({super.key, this.title, required this.rows, this.trailing});
  final String? title;
  final List<(String, String)> rows;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [Expanded(child: Text(title!, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800))), ?trailing]),
              ),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: Text(r.$1, style: Theme.of(context).textTheme.bodySmall)),
                  const SizedBox(width: 12),
                  Flexible(child: Text(r.$2, textAlign: TextAlign.end, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w600))),
                ]),
              ),
          ]),
        ),
      );
}

/// Labelled horizontal bars (the phone's stand-in for the web charts).
class BarList extends StatelessWidget {
  const BarList({super.key, required this.rows, this.format});
  final List<(String, num)> rows;
  final String Function(num)? format;
  @override
  Widget build(BuildContext context) {
    final max = rows.fold<num>(0, (m, r) => r.$2 > m ? r.$2 : m);
    return Column(children: [
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            SizedBox(width: 112, child: Text(r.$1, maxLines: 1, overflow: TextOverflow.ellipsis)),
            Expanded(child: LinearProgressIndicator(value: max <= 0 ? 0 : (r.$2 / max).clamp(0, 1).toDouble(), minHeight: 10, borderRadius: BorderRadius.circular(5))),
            SizedBox(width: 96, child: Align(alignment: AlignmentDirectional.centerEnd, child: Ltr(format == null ? '${r.$2}' : format!(r.$2)))),
          ]),
        ),
    ]);
  }
}

/// Opens a full-screen page (these screens are reached from menus, not deep links).
Future<T?> openPage<T>(BuildContext context, Widget page) => Navigator.of(context).push<T>(MaterialPageRoute<T>(builder: (_) => page));

/// One row of a menu of screens.
class MenuTile extends StatelessWidget {
  const MenuTile({super.key, required this.icon, required this.title, this.subtitle, required this.page});
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget Function() page;
  @override
  Widget build(BuildContext context) => ListTile(leading: Icon(icon), title: Text(title), subtitle: subtitle == null ? null : Text(subtitle!), trailing: const Icon(Icons.chevron_right), onTap: () => openPage<void>(context, page()));
}
