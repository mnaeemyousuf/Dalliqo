import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/providers.dart';
import '../../core/theme/brand_tokens.dart';
import '../../core/widgets/brand.dart';

const _seenKey = 'prefs.onboarded';

/// Shows the onboarding slides on the very first launch, then [child] (the sign-in screen).
class OnboardingGate extends ConsumerStatefulWidget {
  const OnboardingGate({super.key, required this.child});
  final Widget child;

  @override
  ConsumerState<OnboardingGate> createState() => _OnboardingGateState();
}

class _OnboardingGateState extends ConsumerState<OnboardingGate> {
  bool? _seen;

  @override
  void initState() {
    super.initState();
    ref.read(databaseProvider).getValue(_seenKey).then((v) {
      if (mounted) setState(() => _seen = v == '1');
    }, onError: (_) {
      if (mounted) setState(() => _seen = true);
    });
  }

  Future<void> _finish() async {
    setState(() => _seen = true);
    await ref.read(databaseProvider).setValue(_seenKey, '1');
  }

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        switchInCurve: Curves.easeOutCubic,
        child: switch (_seen) {
          null => const BrandSplash(key: ValueKey('splash')),
          false => OnboardingScreen(key: const ValueKey('onboarding'), onDone: _finish),
          true => KeyedSubtree(key: const ValueKey('child'), child: widget.child),
        },
      );
}

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onDone});
  final VoidCallback onDone;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pages = PageController();
  int _index = 0;

  static const _slides = [
    (Icons.home_work_rounded, Color(0xFF60A5FA), 'mobile.ui.onboarding.t1', 'mobile.ui.onboarding.b1'),
    (Icons.auto_awesome_rounded, Color(0xFFFCD34D), 'mobile.ui.onboarding.t2', 'mobile.ui.onboarding.b2'),
    (Icons.cloud_sync_rounded, Color(0xFF6EE7B7), 'mobile.ui.onboarding.t3', 'mobile.ui.onboarding.b3'),
  ];

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _next() {
    HapticFeedback.lightImpact();
    if (_index == _slides.length - 1) {
      widget.onDone();
    } else {
      _pages.nextPage(duration: const Duration(milliseconds: 420), curve: Curves.easeOutCubic);
    }
  }

  @override
  Widget build(BuildContext context) {
    final last = _index == _slides.length - 1;
    return Scaffold(
      backgroundColor: Brand.splashBackground,
      body: BrandBackdrop(
        child: SafeArea(
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
              child: Row(children: [
                const BrandLogo(variant: BrandLogoVariant.horizontal, height: 30, onDark: true),
                const Spacer(),
                AnimatedOpacity(
                  opacity: last ? 0 : 1,
                  duration: const Duration(milliseconds: 200),
                  child: TextButton(
                    onPressed: last ? null : widget.onDone,
                    style: TextButton.styleFrom(foregroundColor: Colors.white70),
                    child: Text(context.t('mobile.ui.onboarding.skip')),
                  ),
                ),
              ]),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _index = i),
                itemBuilder: (context, i) {
                  final (icon, color, title, body) = _slides[i];
                  return AnimatedBuilder(
                    animation: _pages,
                    builder: (context, child) {
                      final page = _pages.hasClients && _pages.position.haveDimensions ? _pages.page ?? 0 : 0.0;
                      final delta = (page - i).clamp(-1.0, 1.0);
                      return Opacity(opacity: 1 - delta.abs() * 0.6, child: Transform.translate(offset: Offset(delta * -40, 0), child: child));
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 28),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        _Illustration(icon: icon, color: color),
                        const SizedBox(height: 40),
                        Text(context.t(title),
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                        const SizedBox(height: 12),
                        Text(context.t(body),
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: const Color(0xFFB8C6E0), height: 1.5)),
                      ]),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Row(children: [
                for (var i = 0; i < _slides.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOutCubic,
                    margin: const EdgeInsetsDirectional.only(end: 6),
                    width: i == _index ? 24 : 8,
                    height: 8,
                    decoration: BoxDecoration(color: i == _index ? Colors.white : Colors.white.withValues(alpha: 0.25), borderRadius: BorderRadius.circular(4)),
                  ),
                const Spacer(),
                FilledButton(
                  onPressed: _next,
                  style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Brand.primary800, minimumSize: const Size(140, 52)),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: Row(key: ValueKey(last), mainAxisSize: MainAxisSize.min, children: [
                      Text(context.t(last ? 'mobile.ui.onboarding.start' : 'mobile.ui.onboarding.next')),
                      const SizedBox(width: 6),
                      Icon(last ? Icons.check_rounded : Icons.arrow_forward_rounded, size: 18),
                    ]),
                  ),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Layered glass rings around a glowing icon tile.
class _Illustration extends StatelessWidget {
  const _Illustration({required this.icon, required this.color});
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 220,
        height: 220,
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white.withValues(alpha: 0.06)), color: Colors.white.withValues(alpha: 0.02)),
        child: Container(
          width: 160,
          height: 160,
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white.withValues(alpha: 0.10)), color: Colors.white.withValues(alpha: 0.04)),
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(28),
              gradient: LinearGradient(colors: [color.withValues(alpha: 0.35), color.withValues(alpha: 0.12)], begin: Alignment.topLeft, end: Alignment.bottomRight),
              border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
              boxShadow: [BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 40, spreadRadius: -4)],
            ),
            child: Icon(icon, size: 44, color: Colors.white),
          ),
        ),
      );
}
