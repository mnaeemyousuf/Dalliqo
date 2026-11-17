import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../more/extras.dart';
import '../more/online_kit.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// Publish / unpublish a property on the agency website (online action; the listing's
/// local copy picks up the new state on the next sync).
class PublishOnWebsiteButton extends ConsumerWidget {
  const PublishOnWebsiteButton({super.key, required this.propertyServerId, required this.published});

  final String? propertyServerId;
  final bool published;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    if (propertyServerId == null || !ref.watch(authProvider).can('properties:update')) return const SizedBox.shrink();
    return IconButton(
      tooltip: published ? l.t('marketing.onWebsite') : l.t('marketing.publish'),
      icon: Icon(Icons.public, color: published ? Colors.green.shade600 : null),
      onPressed: () async {
        var value = published;
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => StatefulBuilder(
            builder: (ctx, set) => AlertDialog(
              title: Text(l.t('marketing.publishTitle')),
              content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                SwitchListTile(contentPadding: EdgeInsets.zero, value: value, onChanged: (v) => set(() => value = v), title: Text(l.t('marketing.onWebsite'))),
                Text(l.t('marketing.publishHint'), style: Theme.of(ctx).textTheme.bodySmall),
              ]),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('common.save'))),
              ],
            ),
          ),
        );
        if (ok != true || value == published) return;
        try {
          await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/properties/$propertyServerId/publish', {'published': value});
          if (context.mounted) showMessage(context, value ? l.t('marketing.publishedToast') : l.t('marketing.unpublishedToast'));
        } catch (e) {
          if (context.mounted) showError(context, e);
        }
      },
    );
  }
}

/// Creates a private portal link for a client (deals, installments, rent, receipts) or an owner
/// (listings, verification, interest) and shares it — on WhatsApp when there is a number.
class PortalLinkButton extends ConsumerWidget {
  const PortalLinkButton({super.key, required this.kind, required this.partyServerId, required this.name, this.phone});

  final String kind; // CLIENT | OWNER
  final String? partyServerId;
  final String name;
  final String? phone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    if (partyServerId == null || !auth.can(kind == 'CLIENT' ? 'clients:update' : 'owners:update')) return const SizedBox.shrink();
    return IconButton(
      tooltip: l.t('marketing.portal'),
      icon: const Icon(Icons.link_rounded),
      onPressed: () async {
        var days = 30;
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => StatefulBuilder(
            builder: (ctx, set) => AlertDialog(
              title: Text(l.t('marketing.portalTitle', {'name': name})),
              content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(kind == 'CLIENT' ? l.t('marketing.portalClientHint') : l.t('marketing.portalOwnerHint'), style: Theme.of(ctx).textTheme.bodySmall),
                const SizedBox(height: 12),
                AppDropdown<int>(label: l.t('marketing.validFor'), value: days, items: {for (final d in const [7, 30, 90, 365]) d: l.t('marketing.days', {'count': d})}, onChanged: (v) => set(() => days = v ?? days)),
              ]),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(ctx, false);
                    openPage<void>(context, PortalLinksScreen(kind: kind, partyId: partyServerId!, name: name));
                  },
                  child: Text(l.t('mm.pl.existing')),
                ),
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.t('common.cancel'))),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.t('marketing.createLink'))),
              ],
            ),
          ),
        );
        if (ok != true) return;
        try {
          final r = await ref.read(onlineRepositoryProvider).api.post<Map<String, dynamic>>('/portal-links', {'kind': kind, 'partyId': partyServerId, 'days': days});
          final url = r['url'] as String;
          final message = l.t('marketing.portalMessage', {'name': name, 'business': auth.business?['name'] ?? '', 'url': url});
          final number = (r['phone'] as String?) ?? phone;
          if (number != null && number.isNotEmpty) {
            final wa = Uri.parse('https://wa.me/${number.replaceAll(RegExp(r'\D'), '')}?text=${Uri.encodeComponent(message)}');
            if (await launchUrl(wa, mode: LaunchMode.externalApplication)) return;
          }
          await SharePlus.instance.share(ShareParams(text: message));
        } catch (e) {
          if (context.mounted) showError(context, e);
        }
      },
    );
  }
}
