import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/brand.dart';
import 'auth_controller.dart';

class _AuthScaffold extends ConsumerWidget {
  const _AuthScaffold({required this.title, this.subtitle, required this.child, this.footer});
  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? footer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lang = ref.watch(prefsProvider).locale.languageCode;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  const BrandLogo(height: 40),
                  const Spacer(),
                  TextButton.icon(
                    icon: const Icon(Icons.translate),
                    label: Text(lang == 'en' ? 'اردو' : 'English'),
                    onPressed: () => ref.read(prefsProvider.notifier).setLanguage(lang == 'en' ? 'ur' : 'en'),
                  ),
                ]),
                const SizedBox(height: 8),
                Text(context.t('app.tagline'), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant, fontWeight: FontWeight.w500)),
                const SizedBox(height: 28),
                Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                if (subtitle != null) ...[const SizedBox(height: 6), Text(subtitle!, style: Theme.of(context).textTheme.bodyMedium)],
                const SizedBox(height: 24),
                child,
                if (footer != null) ...[const SizedBox(height: 20), footer!],
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

String? _required(BuildContext c, String? v) => (v == null || v.trim().isEmpty) ? c.t('common.required') : null;
String? _validatePassword(BuildContext c, String? v) =>
    (v == null || v.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'\d').hasMatch(v)) ? c.t('auth.passwordHint') : null;

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).signIn(_email.text.trim(), _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => _AuthScaffold(
        title: context.t('auth.signInTitle'),
        subtitle: context.t('auth.signInSubtitle'),
        footer: TextButton(onPressed: () => context.push('/register'), child: Text('${context.t('auth.noAccount')} ${context.t('auth.register')}')),
        child: AutofillGroup(
          child: Form(
            key: _form,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (_error != null) _ErrorBanner(_error!),
              AppTextField(label: context.t('auth.email'), controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], validator: (v) => _required(context, v), textDirection: TextDirection.ltr),
              const SizedBox(height: 12),
              AppTextField(label: context.t('auth.password'), controller: _password, obscure: true, autofillHints: const [AutofillHints.password], validator: (v) => _required(context, v)),
              Align(alignment: AlignmentDirectional.centerEnd, child: TextButton(onPressed: () => context.push('/forgot-password'), child: Text(context.t('auth.forgot')))),
              AppButton(label: context.t('auth.signIn'), loading: _loading, onPressed: _submit, expand: true),
            ]),
          ),
        ),
      );
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner(this.message);
  final String message;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.errorContainer, borderRadius: BorderRadius.circular(10)),
        child: Text(message, style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer)),
      );
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _business = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;
  Map<String, String> _fieldErrors = {};

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
      _fieldErrors = {};
    });
    try {
      await ref.read(authProvider.notifier).register({
        'businessName': _business.text.trim(),
        'fullName': _name.text.trim(),
        'email': _email.text.trim(),
        if (_mobile.text.trim().isNotEmpty) 'mobileNumber': _mobile.text.trim(),
        'password': _password.text,
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = errorText(context, e);
          _fieldErrors = e.fieldErrors;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => _AuthScaffold(
        title: context.t('auth.registerTitle'),
        subtitle: context.t('auth.registerSubtitle'),
        footer: TextButton(onPressed: () => context.pop(), child: Text('${context.t('auth.haveAccount')} ${context.t('auth.signIn')}')),
        child: Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (_error != null) _ErrorBanner(_error!),
            AppTextField(label: context.t('auth.businessName'), controller: _business, validator: (v) => _required(context, v), error: _fieldErrors['businessName']),
            const SizedBox(height: 12),
            AppTextField(label: context.t('auth.fullName'), controller: _name, validator: (v) => _required(context, v), error: _fieldErrors['fullName']),
            const SizedBox(height: 12),
            AppTextField(label: context.t('auth.email'), controller: _email, keyboardType: TextInputType.emailAddress, validator: (v) => _required(context, v), error: _fieldErrors['email'], textDirection: TextDirection.ltr),
            const SizedBox(height: 12),
            AppTextField(
              label: context.t('auth.mobile'),
              controller: _mobile,
              keyboardType: TextInputType.phone,
              hint: '0300 1234567',
              textDirection: TextDirection.ltr,
              error: _fieldErrors['mobileNumber'],
              validator: (v) => (v != null && v.trim().isNotEmpty && normalizePhone(v) == null) ? context.t('errors.VALIDATION_ERROR') : null,
            ),
            const SizedBox(height: 12),
            AppTextField(label: context.t('auth.password'), controller: _password, obscure: true, helper: context.t('auth.passwordHint'), validator: (v) => _validatePassword(context, v), error: _fieldErrors['password']),
            const SizedBox(height: 20),
            AppButton(label: context.t('auth.register'), loading: _loading, onPressed: _submit, expand: true),
          ]),
        ),
      );
}

/// Forgot password: request the email, then enter the code from it here.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});
  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _sent = false;
  bool _loading = false;
  String? _error;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.read(authProvider.notifier);
    return _AuthScaffold(
      title: context.t('auth.forgotTitle'),
      subtitle: _sent ? context.t('auth.linkSent') : context.t('auth.forgotSubtitle'),
      footer: TextButton(onPressed: () => context.go('/login'), child: Text(context.t('auth.backToSignIn'))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_error != null) _ErrorBanner(_error!),
        if (!_sent) ...[
          AppTextField(label: context.t('auth.email'), controller: _email, keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr),
          const SizedBox(height: 16),
          AppButton(label: context.t('auth.sendLink'), loading: _loading, expand: true, onPressed: () => _run(() async {
                await auth.forgotPassword(_email.text.trim());
                setState(() => _sent = true);
              })),
          TextButton(onPressed: () => setState(() => _sent = true), child: Text(context.t('mobile.haveCode'))),
        ] else ...[
          AppTextField(label: context.t('mobile.resetCode'), controller: _code, textDirection: TextDirection.ltr),
          const SizedBox(height: 12),
          AppTextField(label: context.t('auth.newPassword'), controller: _password, obscure: true, helper: context.t('auth.passwordHint')),
          const SizedBox(height: 16),
          AppButton(label: context.t('common.save'), loading: _loading, expand: true, onPressed: () => _run(() async {
                await auth.resetPassword(_code.text.trim(), _password.text);
                if (context.mounted) {
                  showMessage(context, context.t('auth.resetDone'));
                  context.go('/login');
                }
              })),
        ],
      ]),
    );
  }
}

/// Owner-created members must replace their temporary password first.
class ChangeTemporaryPasswordScreen extends ConsumerStatefulWidget {
  const ChangeTemporaryPasswordScreen({super.key});
  @override
  ConsumerState<ChangeTemporaryPasswordScreen> createState() => _ChangeTempState();
}

class _ChangeTempState extends ConsumerState<ChangeTemporaryPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  Widget build(BuildContext context) => _AuthScaffold(
        title: context.t('auth.changeTempTitle'),
        subtitle: context.t('auth.changeTempSubtitle'),
        footer: TextButton(onPressed: () => ref.read(authProvider.notifier).signOut(), child: Text(context.t('nav.logout'))),
        child: Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (_error != null) _ErrorBanner(_error!),
            AppTextField(label: context.t('auth.currentPassword'), controller: _current, obscure: true, validator: (v) => _required(context, v)),
            const SizedBox(height: 12),
            AppTextField(label: context.t('auth.newPassword'), controller: _next, obscure: true, helper: context.t('auth.passwordHint'), validator: (v) => _validatePassword(context, v)),
            const SizedBox(height: 12),
            AppTextField(label: context.t('auth.confirmPassword'), controller: _confirm, obscure: true, validator: (v) => v != _next.text ? context.t('auth.passwordsMismatch') : null),
            const SizedBox(height: 20),
            AppButton(
              label: context.t('auth.changePassword'),
              loading: _loading,
              expand: true,
              onPressed: () async {
                if (!_form.currentState!.validate()) return;
                setState(() => _loading = true);
                try {
                  await ref.read(authProvider.notifier).changePassword(_current.text, _next.text);
                } catch (e) {
                  if (mounted) setState(() => _error = errorText(context, e));
                } finally {
                  if (mounted) setState(() => _loading = false);
                }
              },
            ),
          ]),
        ),
      );
}

class RestoringScreen extends StatelessWidget {
  const RestoringScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(context.t('mobile.sync.restoring')),
          ]),
        ),
      );
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const BrandSplash();
}

/// Local app lock (PIN and/or biometrics). Not a server credential: it guards
/// an already signed-in phone. Five wrong PINs sign the device out.
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key, this.setup = false});
  final bool setup;
  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  static const _pinLength = 4;
  String _pin = '';
  String? _first;
  String? _error;
  final _localAuth = LocalAuthentication();

  @override
  void initState() {
    super.initState();
    if (!widget.setup) WidgetsBinding.instance.addPostFrameCallback((_) => _tryBiometric());
  }

  Future<void> _tryBiometric() async {
    final store = ref.read(secureStoreProvider);
    final reason = context.t('mobile.lock.biometricReason');
    if (!await store.biometricEnabled) return;
    try {
      final ok = await _localAuth.authenticate(localizedReason: reason);
      if (ok) ref.read(authProvider.notifier).unlock();
    } on PlatformException {
      // Biometrics unavailable: PIN still works.
    }
  }

  Future<void> _digit(String d) async {
    if (_pin.length >= _pinLength) return;
    setState(() {
      _pin += d;
      _error = null;
    });
    if (_pin.length < _pinLength) return;
    if (widget.setup) {
      await _confirmSetup();
      return;
    }
    await _check();
  }

  Future<void> _check() async {
    final left = await ref.read(secureStoreProvider).verifyPin(_pin);
    if (!mounted) return;
    if (left == null) {
      ref.read(authProvider.notifier).unlock();
      return;
    }
    if (left <= 0) {
      showMessage(context, context.t('mobile.lock.tooManyAttempts'));
      await ref.read(authProvider.notifier).signOut(callServer: false);
      return;
    }
    setState(() {
      _error = context.t('mobile.lock.wrongPin', {'left': left});
      _pin = '';
    });
  }

  Future<void> _confirmSetup() async {
    if (_pin.length < _pinLength) return;
    if (_first == null) {
      setState(() {
        _first = _pin;
        _pin = '';
      });
      return;
    }
    if (_first != _pin) {
      setState(() {
        _error = context.t('mobile.lock.pinMismatch');
        _first = null;
        _pin = '';
      });
      return;
    }
    await ref.read(secureStoreProvider).setPin(_pin);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = widget.setup ? (_first == null ? context.t('mobile.lock.setPin') : context.t('mobile.lock.confirmPin')) : context.t('mobile.lock.title');
    Widget key(String label, {VoidCallback? onTap, IconData? icon}) => Padding(
          padding: const EdgeInsets.all(8),
          child: SizedBox(
            width: 72,
            height: 72,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(shape: const CircleBorder()),
              onPressed: onTap ?? () => _digit(label),
              child: icon != null ? Icon(icon) : Text(label, style: theme.textTheme.headlineSmall),
            ),
          ),
        );
    return Scaffold(
      appBar: widget.setup ? AppBar() : null,
      body: SafeArea(
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(Icons.lock_outline, size: 40, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: 16),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < _pinLength; i++)
                Container(
                  margin: const EdgeInsets.all(6),
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: i < _pin.length ? theme.colorScheme.primary : theme.colorScheme.outlineVariant),
                ),
            ]),
            SizedBox(height: 24, child: _error == null ? null : Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
            for (final row in const [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]) Row(mainAxisAlignment: MainAxisAlignment.center, children: [for (final d in row) key(d)]),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              widget.setup ? key('', icon: Icons.check, onTap: _confirmSetup) : key('', icon: Icons.fingerprint, onTap: _tryBiometric),
              key('0'),
              key('', icon: Icons.backspace_outlined, onTap: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1))),
            ]),
            if (!widget.setup) TextButton(onPressed: () => ref.read(authProvider.notifier).signOut(callServer: false), child: Text(context.t('nav.logout'))),
          ]),
        ),
      ),
    );
  }
}
