import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../network/api_client.dart';
import '../theme/app_theme.dart';

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

/// Surface card with a soft shadow; when tappable it springs down slightly on press.
class AppCard extends StatefulWidget {
  const AppCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(16), this.color, this.gradient, this.border = true});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color? color;
  final Gradient? gradient;
  final bool border;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  bool _down = false;

  void _set(bool v) {
    if (widget.onTap != null && _down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final radius = BorderRadius.circular(16);
    return AnimatedScale(
      scale: _down ? 0.975 : 1,
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOutCubic,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        decoration: BoxDecoration(
          color: widget.gradient == null ? (widget.color ?? scheme.surface) : null,
          gradient: widget.gradient,
          borderRadius: radius,
          border: widget.border ? Border.all(color: scheme.outlineVariant.withValues(alpha: 0.8)) : null,
          boxShadow: AppTheme.softShadow(context, raised: _down),
        ),
        child: Material(
          type: MaterialType.transparency,
          borderRadius: radius,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onTap,
            onTapDown: (_) => _set(true),
            onTapUp: (_) => _set(false),
            onTapCancel: () => _set(false),
            child: Padding(padding: widget.padding, child: widget.child),
          ),
        ),
      ),
    );
  }
}

/// Initials avatar with a stable colour per name.
class AppAvatar extends StatelessWidget {
  const AppAvatar(this.name, {super.key, this.size = 40});
  final String? name;
  final double size;

  static const _hues = [Color(0xFF2563EB), Color(0xFF7C3AED), Color(0xFF059669), Color(0xFFD97706), Color(0xFFE11D48), Color(0xFF0891B2), Color(0xFF4F46E5), Color(0xFF0D9488)];

  @override
  Widget build(BuildContext context) {
    final n = (name ?? '').trim();
    final parts = n.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2);
    final initials = parts.isEmpty ? '?' : parts.map((p) => p.characters.first.toUpperCase()).join();
    final hue = _hues[n.codeUnits.fold<int>(0, (a, b) => a + b) % _hues.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(colors: [hue, Color.lerp(hue, Colors.black, 0.18)!], begin: Alignment.topLeft, end: Alignment.bottomRight),
      ),
      child: Text(initials, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: size * 0.36), textDirection: TextDirection.ltr),
    );
  }
}

/// Animates a number from 0 to [value] once (ease-out), keeping digits left-to-right.
class CountUpText extends StatelessWidget {
  const CountUpText(this.value, {super.key, this.style, this.duration = const Duration(milliseconds: 900)});
  final num value;
  final TextStyle? style;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return Text('$value', style: style, textDirection: TextDirection.ltr);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: duration,
      curve: Curves.easeOutQuart,
      builder: (_, v, _) => Text('${v.round()}', style: style, textDirection: TextDirection.ltr),
    );
  }
}

/// Fades and lifts its child into place; [index] staggers siblings.
class FadeSlideIn extends StatelessWidget {
  const FadeSlideIn({super.key, required this.child, this.index = 0, this.offset = 14});
  final Widget child;
  final int index;
  final double offset;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    final delay = (index.clamp(0, 12)) * 40;
    final total = 380 + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      curve: Interval(delay / total, 1, curve: Curves.easeOutCubic),
      builder: (_, t, c) => Opacity(opacity: t, child: Transform.translate(offset: Offset(0, (1 - t) * offset), child: c)),
      child: child,
    );
  }
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

/// Loading placeholder: shimmering skeleton cards in the shape of a list.
class AppLoader extends StatelessWidget {
  const AppLoader({super.key, this.rows = 5});
  final int rows;
  @override
  Widget build(BuildContext context) => ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: rows,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => Semantics(
          label: i == 0 ? MaterialLocalizations.of(context).refreshIndicatorSemanticLabel : null,
          child: const _SkeletonCard(),
        ),
      );
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard();
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: scheme.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.8))),
      child: const Row(children: [
        Skeleton(width: 44, height: 44, radius: 22),
        SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Skeleton(width: 160, height: 14),
            SizedBox(height: 10),
            Skeleton(height: 10),
            SizedBox(height: 6),
            Skeleton(width: 110, height: 10),
          ]),
        ),
      ]),
    );
  }
}

/// A shimmering placeholder block.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 12, this.radius = 6});
  final double? width;
  final double height;
  final double radius;
  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? const Color(0xFF1C2742) : const Color(0xFFEDF1F7);
    final glow = dark ? const Color(0xFF26324B) : const Color(0xFFF8FAFD);
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(-1.5 + _c.value * 3, 0),
            end: Alignment(-0.5 + _c.value * 3, 0),
            colors: [base, glow, base],
          ),
        ),
      ),
    );
  }
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
    final scheme = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: FadeSlideIn(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(shape: BoxShape.circle, color: scheme.primary.withValues(alpha: 0.05)),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(shape: BoxShape.circle, color: scheme.primary.withValues(alpha: 0.08)),
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: scheme.surface, boxShadow: AppTheme.softShadow(context)),
                  child: Icon(icon, color: scheme.primary, size: 26),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700), textAlign: TextAlign.center),
            if (hint != null) ...[const SizedBox(height: 6), Text(hint!, textAlign: TextAlign.center, style: theme.textTheme.bodySmall)],
            if (action != null) ...[const SizedBox(height: 18), action!],
          ]),
        ),
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
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: theme.colorScheme.error.withValues(alpha: 0.1), shape: BoxShape.circle),
            child: Icon(Icons.cloud_off_rounded, size: 30, color: theme.colorScheme.error),
          ),
          const SizedBox(height: 14),
          Text(errorText(context, error), textAlign: TextAlign.center, style: theme.textTheme.titleSmall),
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
        padding: EdgeInsets.only(left: 20, right: 20, bottom: MediaQuery.of(c).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: Theme.of(c).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
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
        padding: const EdgeInsets.fromLTRB(4, 20, 4, 10),
        child: Row(children: [
          Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2))),
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
