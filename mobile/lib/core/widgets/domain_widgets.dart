import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../database/app_database.dart';
import '../l10n/app_localizations.dart';
import '../models/models.dart';
import '../providers.dart';
import '../utils/format.dart';
import 'app_widgets.dart';

ChipTone statusTone(String status) => switch (status) {
      'AVAILABLE' => ChipTone.green,
      'RESERVED' => ChipTone.amber,
      'SOLD' => ChipTone.blue,
      'RENTED' => ChipTone.purple,
      _ => ChipTone.grey,
    };

ChipTone priorityTone(String p) => switch (p) { 'URGENT' => ChipTone.red, 'HIGH' => ChipTone.amber, 'MEDIUM' => ChipTone.blue, _ => ChipTone.grey };

ChipTone bandTone(String band) => switch (band) { 'EXCELLENT' => ChipTone.green, 'VERY_GOOD' => ChipTone.blue, 'GOOD' => ChipTone.purple, _ => ChipTone.amber };

String sizeLabel(BuildContext context, num? size, String? unit) => size == null ? '—' : '${size % 1 == 0 ? size.toInt() : size} ${context.l10n.enumLabel('sizeUnit', unit)}';

/// Small badge for rows that haven't reached the server yet.
class SyncBadge extends StatelessWidget {
  const SyncBadge(this.status, {super.key});
  final SyncStatus status;
  @override
  Widget build(BuildContext context) => switch (status) {
        SyncStatus.synced => const SizedBox.shrink(),
        SyncStatus.conflict => AppChip(context.t('mobile.sync.conflict'), tone: ChipTone.red, icon: Icons.warning_amber),
        SyncStatus.failed => AppChip(context.t('mobile.sync.failed'), tone: ChipTone.red, icon: Icons.error_outline),
        _ => AppChip(context.t('mobile.sync.pending'), tone: ChipTone.amber, icon: Icons.cloud_upload_outlined),
      };
}

/// Spec card: image, ID, size + type, location, price, status, match count.
class PropertyCard extends StatelessWidget {
  const PropertyCard({super.key, required this.property, this.onTap});
  final Property property;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final theme = Theme.of(context);
    final image = property.coverThumbnailUrl ?? property.coverImageUrl;
    return AppCard(
      padding: EdgeInsets.zero,
      onTap: onTap ?? () => context.push('/properties/${property.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        AspectRatio(
          aspectRatio: 16 / 9,
          child: image == null
              ? Container(color: theme.colorScheme.surfaceContainerHighest, child: Icon(Icons.home_work_outlined, size: 42, color: theme.colorScheme.outline))
              : CachedNetworkImage(imageUrl: image, fit: BoxFit.cover, errorWidget: (_, _, _) => const Icon(Icons.broken_image_outlined)),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Ltr(property.propertyId ?? l.t('mobile.pendingId'), style: TextStyle(color: theme.colorScheme.primary, fontWeight: FontWeight.w700, fontSize: 12)),
              const Spacer(),
              SyncBadge(property.syncStatus),
            ]),
            const SizedBox(height: 4),
            Text('${sizeLabel(context, property.size, property.sizeUnit)} ${l.enumLabel('propertyType', property.propertyType)}', style: theme.textTheme.titleMedium),
            Row(children: [
              Icon(Icons.place_outlined, size: 15, color: theme.colorScheme.outline),
              const SizedBox(width: 4),
              Expanded(child: Text(property.location.isEmpty ? '—' : property.location, style: theme.textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
            ]),
            const SizedBox(height: 6),
            Text(formatPkr(property.askingPrice, urdu: l.isRtl), style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Row(children: [
              AppChip(l.enumLabel('propertyStatus', property.status), tone: statusTone(property.status)),
              const SizedBox(width: 6),
              if (property.needsVerification)
                AppChip(l.t('property.needsVerification'), tone: ChipTone.amber)
              else
                AppChip(l.enumLabel('listingPurpose', property.listingPurpose)),
              const Spacer(),
              Text(l.t('property.matches', {'count': property.matchCount}), style: theme.textTheme.bodySmall),
            ]),
          ]),
        ),
      ]),
    );
  }
}

/// Call / WhatsApp / follow-up in one tap.
class ContactActions extends ConsumerWidget {
  const ContactActions({super.key, required this.phone, this.whatsapp, this.clientId, this.onFollowUp});
  final String phone;
  final String? whatsapp;
  final String? clientId;
  final VoidCallback? onFollowUp;

  Future<void> _log(WidgetRef ref, String channel) async {
    if (clientId == null) return;
    try {
      await ref.read(apiClientProvider).post('/clients/$clientId/communications', {'channel': channel});
    } catch (_) {
      // Best effort: contact logging is a convenience, not a requirement.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton.filledTonal(
          tooltip: context.t('client.call'),
          icon: const Icon(Icons.call),
          onPressed: () {
            Contact.call(phone);
            _log(ref, 'CALL');
          },
        ),
        IconButton.filledTonal(
          tooltip: 'WhatsApp',
          icon: const Icon(Icons.chat),
          color: const Color(0xFF16A34A),
          onPressed: () {
            Contact.whatsapp(whatsapp ?? phone);
            _log(ref, 'WHATSAPP');
          },
        ),
        if (onFollowUp != null) IconButton.filledTonal(tooltip: context.t('followup.single'), icon: const Icon(Icons.event_available), onPressed: onFollowUp),
      ]);
}

class ClientCard extends StatelessWidget {
  const ClientCard({super.key, required this.client, this.categoryName, this.onFollowUp});
  final Client client;
  final String? categoryName;
  final VoidCallback? onFollowUp;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final theme = Theme.of(context);
    return AppCard(
      onTap: () => context.push('/clients/${client.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(client.fullName, style: theme.textTheme.titleMedium)),
          SyncBadge(client.syncStatus),
          const SizedBox(width: 6),
          AppChip(l.enumLabel('priority', client.priority), tone: priorityTone(client.priority)),
        ]),
        Text(categoryName ?? '—', style: theme.textTheme.bodySmall),
        const SizedBox(height: 6),
        Row(children: [
          Icon(Icons.place_outlined, size: 15, color: theme.colorScheme.outline),
          const SizedBox(width: 4),
          Expanded(child: Text(client.preferredSociety ?? client.preferredArea ?? '—', overflow: TextOverflow.ellipsis)),
        ]),
        Text('${l.t('client.budget')}: ${formatRange(client.minBudget, client.maxBudget, urdu: l.isRtl)}'),
        const SizedBox(height: 4),
        Text(l.t('client.matchingProperties', {'count': client.matchCount}), style: TextStyle(color: theme.colorScheme.primary, fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        ContactActions(phone: client.mobileNumber, whatsapp: client.whatsappNumber, clientId: client.serverId, onFollowUp: onFollowUp),
      ]),
    );
  }
}

/// "95% Match · 120 Sq. Yard Plot · Gulshan-e-Iqbal · PKR 1.55 Crore · ✓ Budget ✓ Area …"
class MatchCard extends StatelessWidget {
  const MatchCard({super.key, required this.match, required this.perspective, this.trailing});
  final Match match;
  final String perspective; // 'client' shows the property, 'property' shows the client
  final Widget? trailing;

  /// Opens the client's WhatsApp chat with the matched property pre-filled; the agent presses Send.
  void _sendProperty(BuildContext context, AppLocalizations l) {
    final p = match.property;
    final c = match.client;
    final details = [
      '${p['propertyId'] ?? ''} · ${sizeLabel(context, p['size'] as num?, p['sizeUnit'] as String?)} ${l.enumLabel('propertyType', p['propertyType'] as String?)} (${l.enumLabel('listingPurpose', p['listingPurpose'] as String?)})',
      '${[p['block'], p['society'] ?? p['area']].whereType<String>().join(', ')} · ${formatPkr(p['askingPrice'] as num?)}',
    ].join('\n');
    Contact.whatsapp((c['whatsappNumber'] ?? c['mobileNumber'] ?? '') as String, text: l.t('match.shareMessage', {'name': c['fullName'] ?? '', 'details': details}));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final theme = Theme.of(context);
    final p = match.property;
    final c = match.client;
    return AppCard(
      onTap: () => context.push(perspective == 'client' ? '/properties/${p['_id']}' : '/clients/${c['_id']}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          AppChip(l.t('match.percentMatch', {'score': match.score}), tone: bandTone(match.band)),
          const SizedBox(width: 6),
          AppChip(l.enumLabel('matchStatus', match.status)),
          const Spacer(),
          ?trailing,
        ]),
        const SizedBox(height: 8),
        if (perspective == 'client') ...[
          Text('${sizeLabel(context, p['size'] as num?, p['sizeUnit'] as String?)} ${l.enumLabel('propertyType', p['propertyType'] as String?)}', style: theme.textTheme.titleMedium),
          Text([p['block'], p['society'] ?? p['area']].whereType<String>().join(', '), style: theme.textTheme.bodySmall),
          Text(formatPkr(p['askingPrice'] as num?, urdu: l.isRtl), style: const TextStyle(fontWeight: FontWeight.w700)),
        ] else ...[
          Text(c['fullName'] as String? ?? '', style: theme.textTheme.titleMedium),
          Ltr(c['mobileNumber'] as String? ?? '', style: theme.textTheme.bodySmall),
        ],
        const SizedBox(height: 6),
        Wrap(spacing: 10, runSpacing: 4, children: [
          for (final r in match.reasons.where((r) => !(r['code'] as String).endsWith('_ANY')))
            Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.check, size: 15, color: Color(0xFF16A34A)),
              Text(l.t('enums.matchReason.${r['code']}', Map<String, Object?>.from((r['params'] as Map?) ?? const {})), style: const TextStyle(fontSize: 12, color: Color(0xFF16A34A))),
            ]),
        ]),
        const SizedBox(height: 4),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              icon: const Icon(Icons.send_outlined, size: 18, color: Color(0xFF16A34A)),
              label: Text(l.t('match.sendProperty'), overflow: TextOverflow.ellipsis),
              onPressed: () => _sendProperty(context, l),
            ),
          ),
        ]),
        const SizedBox(height: 4),
        ContactActions(
          phone: c['mobileNumber'] as String? ?? '',
          whatsapp: c['whatsappNumber'] as String?,
          clientId: c['_id'] as String?,
          onFollowUp: () => context.push(Uri(path: '/followups/new', queryParameters: {
                if (c['_id'] != null) 'clientId': c['_id'] as String,
                if (p['_id'] != null) 'propertyId': p['_id'] as String,
              }).toString()),
        ),
      ]),
    );
  }
}

class FollowUpCard extends StatelessWidget {
  const FollowUpCard({super.key, required this.followUp, this.clientName, this.propertyLabel, this.onComplete});
  final FollowUp followUp;
  final String? clientName;
  final String? propertyLabel;
  final VoidCallback? onComplete;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final theme = Theme.of(context);
    final f = followUp;
    final tone = switch (f.status) { 'OVERDUE' => ChipTone.red, 'COMPLETED' => ChipTone.green, 'CANCELLED' => ChipTone.grey, _ => ChipTone.blue };
    final icon = switch (f.type) {
      'CALL' => Icons.call,
      'MEETING' => Icons.groups_outlined,
      'WHATSAPP' => Icons.chat,
      'SMS' => Icons.sms_outlined,
      'PROPERTY_VISIT' => Icons.home_work_outlined,
      _ => Icons.event_note,
    };
    return AppCard(
      onTap: () => context.push('/followups/${f.id}'),
      child: Row(children: [
        CircleAvatar(backgroundColor: theme.colorScheme.primaryContainer, child: Icon(icon, color: theme.colorScheme.primary)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${l.enumLabel('followUpType', f.type)} · ${clientName ?? f.client?['fullName'] ?? ''}', style: theme.textTheme.titleSmall),
            Ltr(formatDate(f.dueAt, time: true, locale: l.locale.languageCode), style: theme.textTheme.bodySmall),
            if (propertyLabel != null) Ltr(propertyLabel!, style: theme.textTheme.bodySmall),
            if (f.notes != null && f.notes!.isNotEmpty) Text(f.notes!, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
            const SizedBox(height: 4),
            Wrap(spacing: 6, children: [
              AppChip(l.enumLabel('followUpStatus', f.status), tone: tone),
              AppChip(l.enumLabel('priority', f.priority), tone: priorityTone(f.priority)),
              SyncBadge(f.syncStatus),
            ]),
          ]),
        ),
        if (f.isOpen && onComplete != null) IconButton(tooltip: l.t('followup.complete'), icon: const Icon(Icons.check_circle_outline), onPressed: onComplete),
      ]),
    );
  }
}

/// "✓ All data synced" / "⟳ Syncing 4 changes…" / "⚠ 1 change needs attention".
class SyncIndicator extends ConsumerWidget {
  const SyncIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncEngineProvider).state;
    final (IconData icon, Color color, String text) = !s.online
        ? (Icons.cloud_off, Colors.grey, context.t('mobile.sync.offline'))
        : s.needsAttention > 0
            ? (Icons.warning_amber, Colors.red, context.t('mobile.sync.attention', {'count': s.needsAttention}))
            : (s.running || s.pending > 0)
                ? (Icons.sync, Colors.orange, context.t('mobile.sync.syncing', {'count': s.pending}))
                : (Icons.cloud_done_outlined, Colors.green, context.t('mobile.sync.allSynced'));
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => context.push('/sync'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Flexible(child: Text(text, style: TextStyle(fontSize: 11, color: color), overflow: TextOverflow.ellipsis)),
        ]),
      ),
    );
  }
}
