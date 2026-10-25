import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../network/api_client.dart';

/// Design-system building blocks. Screens compose these instead of styling
/// Material widgets ad hoc.

class AppButton extends StatelessWidget {
  const AppButton({super.key, required this.label, this.onPressed, this.icon, this.loading = false, this.outlined = false, this.danger = false, this.expand = false});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final bool outlined;
  final bool danger;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final child = loading
        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
        : Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
            Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
          ]);
    final action = loading ? null : onPressed;
    final button = outlined
        ? OutlinedButton(onPressed: action, child: child)
        : FilledButton(
            onPressed: action,
            style: danger ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError) : null,
            child: child,
          );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.error,
    this.keyboardType,
    this.obscure = false,
    this.maxLines = 1,
    this.validator,
    this.onChanged,
    this.prefixIcon,
    this.textDirection,
    this.autofillHints,
    this.enabled = true,
    this.helper,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final String? error;
  final String? helper;
  final TextInputType? keyboardType;
  final bool obscure;
  final int maxLines;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;
  final IconData? prefixIcon;
  final TextDirection? textDirection;
  final Iterable<String>? autofillHints;
  final bool enabled;

  @override
  Widget build(BuildContext context) => TextFormField(
        controller: controller,
        keyboardType: keyboardType,
        obscureText: obscure,
        maxLines: obscure ? 1 : maxLines,
        validator: validator,
        onChanged: onChanged,
        enabled: enabled,
        textDirection: textDirection,
        autofillHints: autofillHints,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          errorText: error,
          helperText: helper,
          prefixIcon: prefixIcon == null ? null : Icon(prefixIcon),
        ),
      );
}

class AppDropdown<T> extends StatelessWidget {
  const AppDropdown({super.key, required this.label, required this.value, required this.items, required this.onChanged, this.allowEmpty = false});

  final String label;
  final T? value;
  final Map<T, String> items;
  final ValueChanged<T?> onChanged;
  final bool allowEmpty;

  @override
  Widget build(BuildContext context) => DropdownButtonFormField<T>(
        // Keyed on the value so external changes (e.g. clearing filters) reset the field.
        key: ValueKey(value),
        initialValue: items.containsKey(value) ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [
          if (allowEmpty) DropdownMenuItem<T>(value: null, child: Text(context.t('common.all'))),
          ...items.entries.map((e) => DropdownMenuItem<T>(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))),
        ],
        onChanged: onChanged,
      );
}

class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(14)});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
      );
}

enum ChipTone { green, blue, amber, red, grey, purple }

class AppChip extends StatelessWidget {
  const AppChip(this.label, {super.key, this.tone = ChipTone.grey, this.icon});
  final String label;
  final ChipTone tone;
  final IconData? icon;

  static const _colors = {
    ChipTone.green: Color(0xFF16A34A),
    ChipTone.blue: Color(0xFF2563EB),
    ChipTone.amber: Color(0xFFD97706),
    ChipTone.red: Color(0xFFDC2626),
    ChipTone.grey: Color(0xFF64748B),
    ChipTone.purple: Color(0xFF7C3AED),
  };

  @override
  Widget build(BuildContext context) {
    final c = _colors[tone]!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: c), const SizedBox(width: 3)],
        Text(label, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class AppLoader extends StatelessWidget {
  const AppLoader({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
}

class AppEmptyState extends StatelessWidget {
  const AppEmptyState({super.key, required this.title, this.hint, this.icon = Icons.inbox_outlined, this.action});
  final String title;
  final String? hint;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          CircleAvatar(radius: 28, backgroundColor: theme.colorScheme.primaryContainer, child: Icon(icon, color: theme.colorScheme.primary)),
          const SizedBox(height: 12),
          Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          if (hint != null) ...[const SizedBox(height: 6), Text(hint!, textAlign: TextAlign.center, style: theme.textTheme.bodySmall)],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ]),
      ),
    );
  }
}

class AppErrorState extends StatelessWidget {
  const AppErrorState({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, size: 40, color: theme.colorScheme.error),
          const SizedBox(height: 10),
          Text(errorText(context, error), textAlign: TextAlign.center),
          if (onRetry != null) ...[const SizedBox(height: 12), AppButton(label: context.t('common.retry'), outlined: true, onPressed: onRetry)],
        ]),
      ),
    );
  }
}

/// Translated message for an API error code (falls back to the server message).
String errorText(BuildContext context, Object error) {
  final e = ApiClient.toApiException(error);
  final key = 'errors.${e.code}';
  final translated = context.t(key);
  return translated == key ? e.message : translated;
}

void showError(BuildContext context, Object error) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, error)), backgroundColor: Theme.of(context).colorScheme.error));

void showMessage(BuildContext context, String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

Future<bool> confirmDialog(BuildContext context, {required String title, String? message, String? confirmLabel, bool danger = true}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message ?? c.t('common.cannotUndo')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(c.t('common.cancel'))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Theme.of(c).colorScheme.error) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(confirmLabel ?? c.t('common.confirm')),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Single-field text dialog. Returns null when cancelled (an empty string is a valid answer).
Future<String?> promptText(BuildContext context, {required String title, required String label, String initial = '', int maxLines = 1}) =>
    showDialog<String>(context: context, builder: (_) => _PromptDialog(title: title, label: label, initial: initial, maxLines: maxLines));

class _PromptDialog extends StatefulWidget {
  const _PromptDialog({required this.title, required this.label, required this.initial, required this.maxLines});
  final String title;
  final String label;
  final String initial;
  final int maxLines;
  @override
  State<_PromptDialog> createState() => _PromptDialogState();
}

class _PromptDialogState extends State<_PromptDialog> {
  late final _text = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: TextField(controller: _text, autofocus: true, maxLines: widget.maxLines, decoration: InputDecoration(labelText: widget.label)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(context.t('common.cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, _text.text), child: Text(context.t('common.save'))),
        ],
      );
}

/// Rounded bottom sheet that resizes above the keyboard.
Future<T?> showAppBottomSheet<T>(BuildContext context, {required String title, required Widget child}) => showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (c) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, bottom: MediaQuery.of(c).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: Theme.of(c).textTheme.titleLarge),
          const SizedBox(height: 12),
          Flexible(child: SingleChildScrollView(child: child)),
        ]),
      ),
    );

/// Wraps numbers / phone numbers so they stay left-to-right inside Urdu text.
class Ltr extends StatelessWidget {
  const Ltr(this.text, {super.key, this.style});
  final String text;
  final TextStyle? style;
  @override
  Widget build(BuildContext context) => Text(text, textDirection: TextDirection.ltr, style: style);
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
        child: Row(children: [
          Expanded(child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
          ?trailing,
        ]),
      );
}

class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.ltr = false});
  final String label;
  final String? value;
  final bool ltr;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 130, child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text((value == null || value!.isEmpty) ? '—' : value!, textDirection: ltr ? TextDirection.ltr : null)),
        ]),
      );
}
