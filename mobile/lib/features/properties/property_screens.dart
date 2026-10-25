import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../clients/client_screens.dart' show propertyTypes, sizeUnits;
import '../common/record_panels.dart';

const propertyStatuses = ['AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'];

/// Mirrors shared PROPERTY_STATUS_TRANSITIONS (the server enforces it).
const statusTransitions = {
  'AVAILABLE': ['RESERVED', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  'RESERVED': ['AVAILABLE', 'SOLD', 'RENTED', 'WITHDRAWN', 'INACTIVE'],
  'SOLD': ['AVAILABLE', 'INACTIVE'],
  'RENTED': ['AVAILABLE', 'INACTIVE'],
  'WITHDRAWN': ['AVAILABLE', 'INACTIVE'],
  'INACTIVE': ['AVAILABLE'],
};

final propertyFilterProvider = StateProvider<PropertyFilter>((ref) => const PropertyFilter());

class PropertiesScreen extends ConsumerStatefulWidget {
  const PropertiesScreen({super.key});
  @override
  ConsumerState<PropertiesScreen> createState() => _PropertiesScreenState();
}

class _PropertiesScreenState extends ConsumerState<PropertiesScreen> {
  static const _page = 20;
  final _scroll = ScrollController();
  Timer? _debounce;
  List<Property> _items = [];
  bool _loading = true;
  bool _hasMore = true;
  PropertyFilter? _loadedFor;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600 && _hasMore && !_loading) _load(more: true);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final f = ref.read(propertyFilterProvider);
    setState(() => _loading = true);
    final page = await ref.read(crmRepositoryProvider).properties(f, limit: _page, offset: more ? _items.length : 0);
    if (!mounted) return;
    setState(() {
      _items = more ? [..._items, ...page] : page;
      _hasMore = page.length == _page;
      _loading = false;
      _loadedFor = f;
    });
  }

  void _filters() {
    final l = context.l10n;
    var draft = ref.read(propertyFilterProvider);
    final c = {
      'area': TextEditingController(text: draft.area ?? ''),
      'society': TextEditingController(text: draft.society ?? ''),
      'block': TextEditingController(text: draft.block ?? ''),
      'minPrice': TextEditingController(text: draft.minPrice?.toString() ?? ''),
      'maxPrice': TextEditingController(text: draft.maxPrice?.toString() ?? ''),
      'minSize': TextEditingController(text: draft.minSize?.toString() ?? ''),
      'maxSize': TextEditingController(text: draft.maxSize?.toString() ?? ''),
    };
    String? text(String k) => c[k]!.text.trim().isEmpty ? null : c[k]!.text.trim();
    num? number(String k) => num.tryParse(c[k]!.text.trim());
    final owners = ref.read(crmRepositoryProvider).owners(limit: 1000);
    Widget pair(String a, String b, String la, String lb) => Row(children: [
          Expanded(child: AppTextField(label: la, controller: c[a], keyboardType: TextInputType.number)),
          const SizedBox(width: 8),
          Expanded(child: AppTextField(label: lb, controller: c[b], keyboardType: TextInputType.number)),
        ]);
    showAppBottomSheet<void>(
      context,
      title: l.t('common.filters'),
      child: StatefulBuilder(builder: (context, setSheet) {
        void pick(PropertyFilter n) => setSheet(() => draft = n);
        return Column(children: [
          AppDropdown<String>(label: l.t('property.type'), value: draft.type, allowEmpty: true, items: {for (final t in propertyTypes) t: l.enumLabel('propertyType', t)}, onChanged: (v) => pick(draft.copyWith(type: v))),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('common.status'), value: draft.status, allowEmpty: true, items: {for (final s in propertyStatuses) s: l.enumLabel('propertyStatus', s)}, onChanged: (v) => pick(draft.copyWith(status: v))),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('property.purpose'), value: draft.purpose, allowEmpty: true, items: {for (final s in const ['SALE', 'RENT']) s: l.enumLabel('listingPurpose', s)}, onChanged: (v) => pick(draft.copyWith(purpose: v))),
          const SizedBox(height: 12),
          AppTextField(label: l.t('property.area'), controller: c['area']),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(flex: 3, child: AppTextField(label: l.t('property.society'), controller: c['society'])),
            const SizedBox(width: 8),
            Expanded(flex: 2, child: AppTextField(label: l.t('property.block'), controller: c['block'])),
          ]),
          const SizedBox(height: 12),
          pair('minPrice', 'maxPrice', l.t('property.minPrice'), l.t('property.maxPrice')),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l.t('property.needsVerification')),
            value: draft.needsVerification,
            onChanged: (v) => pick(draft.copyWith(needsVerification: v)),
          ),
          pair('minSize', 'maxSize', l.t('client.minSize'), l.t('client.maxSize')),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('property.sizeUnit'), value: draft.sizeUnit, items: {for (final u in sizeUnits) u: l.enumLabel('sizeUnit', u)}, onChanged: (v) => pick(draft.copyWith(sizeUnit: v))),
          const SizedBox(height: 12),
          FutureBuilder<List<Owner>>(
            future: owners,
            builder: (context, snap) => AppDropdown<String>(
              label: l.t('property.owner'),
              value: draft.ownerId,
              allowEmpty: true,
              items: {
                for (final o in snap.data ?? const <Owner>[]) o.serverId ?? o.id: o.fullName,
                if (draft.ownerId != null && !(snap.data ?? const <Owner>[]).any((o) => (o.serverId ?? o.id) == draft.ownerId)) draft.ownerId!: '…',
              },
              onChanged: (v) => pick(draft.copyWith(ownerId: v)),
            ),
          ),
          const SizedBox(height: 12),
          AppDropdown<String>(label: l.t('common.sortBy'), value: draft.sort, items: {'updated': l.t('common.updatedAt'), 'priceAsc': '${l.t('property.askingPrice')} ↑', 'priceDesc': '${l.t('property.askingPrice')} ↓', 'matches': l.t('nav.matches')}, onChanged: (v) => pick(draft.copyWith(sort: v))),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: AppButton(
                label: l.t('common.clear'),
                outlined: true,
                onPressed: () {
                  ref.read(propertyFilterProvider.notifier).state = ref.read(propertyFilterProvider).cleared();
                  Navigator.pop(context);
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AppButton(
                label: l.t('common.apply'),
                onPressed: () {
                  ref.read(propertyFilterProvider.notifier).state = draft.copyWith(
                    search: ref.read(propertyFilterProvider).search,
                    area: text('area'),
                    society: text('society'),
                    block: text('block'),
                    minPrice: number('minPrice'),
                    maxPrice: number('maxPrice'),
                    minSize: number('minSize'),
                    maxSize: number('maxSize'),
                  );
                  Navigator.pop(context);
                },
              ),
            ),
          ]),
        ]);
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(propertyFilterProvider);
    ref.listen(entityChangesProvider('properties'), (_, _) => _load());
    if (_loadedFor != filter && !(_loading && _loadedFor != null)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _loadedFor != ref.read(propertyFilterProvider)) _load();
      });
    }
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('property.title')),
        actions: [const SyncIndicator(), IconButton(icon: Badge(isLabelVisible: filter.active, child: const Icon(Icons.filter_list)), onPressed: _filters)],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: TextField(
              decoration: InputDecoration(hintText: l.t('property.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), () => ref.read(propertyFilterProvider.notifier).state = ref.read(propertyFilterProvider).copyWith(search: v));
              },
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(syncEngineProvider).syncNow();
          await _load();
        },
        child: _items.isEmpty && !_loading
            ? ListView(children: [
                AppEmptyState(
                  title: l.t('property.noProperties'),
                  hint: l.t('property.noPropertiesHint'),
                  icon: Icons.home_work_outlined,
                  action: ref.watch(authProvider).can('properties:create') ? AppButton(label: l.t('property.add'), onPressed: () => context.push('/properties/new')) : null,
                ),
              ])
            : ListView.separated(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: _items.length + (_hasMore ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (_, i) => i >= _items.length ? const AppLoader() : PropertyCard(property: _items[i]),
              ),
      ),
    );
  }
}

final propertyProvider = FutureProvider.autoDispose.family<Property?, String>((ref, id) {
  ref.watch(entityChangesProvider('properties'));
  return ref.watch(crmRepositoryProvider).property(id);
});

class PropertyDetailScreen extends ConsumerWidget {
  const PropertyDetailScreen({super.key, required this.id});
  final String id;

  Future<void> _changeStatus(BuildContext context, WidgetRef ref, Property p) async {
    final l = context.l10n;
    final reason = TextEditingController();
    final next = await showAppBottomSheet<String>(
      context,
      title: l.t('property.changeStatus'),
      child: Column(children: [
        AppTextField(label: l.t('property.statusReason'), controller: reason),
        const SizedBox(height: 8),
        for (final s in statusTransitions[p.status] ?? const <String>[])
          ListTile(leading: AppChip(l.enumLabel('propertyStatus', s), tone: statusTone(s)), onTap: () => Navigator.pop(context, s)),
      ]),
    );
    if (next == null || !context.mounted) return;
    // Online, status changes go straight to the server (with the reason, activity
    // and audit). Offline or not yet synced, they're queued like any other edit.
    Future<void> queue() async {
      await ref.read(crmRepositoryProvider).saveProperty({'status': next}, id: p.local!.uuid);
      if (context.mounted) showMessage(context, l.t('mobile.sync.offline'));
    }

    if (p.serverId == null) return queue();
    try {
      await ref.read(onlineRepositoryProvider).changePropertyStatus(p.serverId!, next, reason: reason.text);
      await ref.read(syncEngineProvider).syncNow();
      if (context.mounted) showMessage(context, l.t('property.statusChanged'));
    } on ApiException catch (e) {
      if (e.isNetwork) {
        await queue();
      } else if (context.mounted) {
        showError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider);
    return ref.watch(propertyProvider(id)).when(
          loading: () => const Scaffold(body: AppLoader()),
          error: (e, _) => Scaffold(appBar: AppBar(), body: AppErrorState(error: e)),
          data: (p) {
            if (p == null) return Scaffold(appBar: AppBar(), body: AppEmptyState(title: l.t('common.notFound')));
            final title = p.propertyId ?? l.t('mobile.pendingId');
            return DefaultTabController(
              length: 7,
              child: Scaffold(
                appBar: AppBar(
                  title: Ltr(title),
                  actions: [
                    if (auth.can('properties:update'))
                      IconButton(
                        tooltip: l.t('property.verify'),
                        icon: Icon(Icons.verified_outlined, color: p.needsVerification ? Colors.amber.shade700 : null),
                        onPressed: () => _verify(context, ref, p),
                      ),
                    IconButton(
                      icon: const Icon(Icons.share_outlined),
                      onPressed: () => SharePlus.instance.share(ShareParams(text: [
                        '$title · ${l.t('mobile.sharePropertyText', {
                              'type': '${sizeLabel(context, p.size, p.sizeUnit)} ${l.enumLabel('propertyType', p.propertyType)}',
                              'purpose': l.enumLabel('listingPurpose', p.listingPurpose),
                              'location': p.location,
                              'price': formatPkr(p.askingPrice, urdu: l.isRtl),
                            })}',
                        if (p.hasLocation) 'https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}',
                      ].join('\n'))),
                    ),
                    if (auth.can('properties:update')) IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/properties/${p.id}/edit')),
                    if (auth.can('properties:delete'))
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          if (await confirmDialog(context, title: l.t('common.areYouSure'), message: l.t('property.deleteConfirm', {'id': title}))) {
                            await ref.read(crmRepositoryProvider).deleteProperty(p.local!.uuid);
                            if (context.mounted) context.pop();
                          }
                        },
                      ),
                  ],
                  bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
                    for (final k in const ['overview', 'media', 'matches', 'followups', 'documents', 'notes', 'activity']) Tab(text: l.t('property.tabs.$k')),
                  ]),
                ),
                body: TabBarView(children: [
                  _Overview(property: p, onChangeStatus: auth.can('properties:update') ? () => _changeStatus(context, ref, p) : null),
                  _Gallery(property: p),
                  _PropertyMatches(serverId: p.serverId),
                  FollowUpsPanel(propertyId: p.id),
                  DocumentsPanel(entityType: 'property', serverId: p.serverId),
                  NotesPanel(entityType: 'property', entityId: p.id),
                  p.serverId == null ? AppEmptyState(title: l.t('mobile.sync.pending')) : ActivityPanel(entityId: p.serverId!),
                ]),
              ),
            );
          },
        );
  }
}

class _Overview extends ConsumerWidget {
  const _Overview({required this.property, this.onChangeStatus});
  final Property property;
  final VoidCallback? onChangeStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final p = property;
    final owner = JsonModel.refObj(p.json['ownerId']);
    return ListView(padding: const EdgeInsets.all(16), children: [
      if (p.coverImageUrl != null)
        ClipRRect(borderRadius: BorderRadius.circular(12), child: CachedNetworkImage(imageUrl: p.coverImageUrl!, height: 200, fit: BoxFit.cover)),
      const SizedBox(height: 12),
      Text('${sizeLabel(context, p.size, p.sizeUnit)} ${l.enumLabel('propertyType', p.propertyType)}', style: Theme.of(context).textTheme.titleLarge),
      Text(p.location, style: Theme.of(context).textTheme.bodyMedium),
      const SizedBox(height: 6),
      Text(formatPkr(p.askingPrice, urdu: l.isRtl), style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        AppChip(l.enumLabel('propertyStatus', p.status), tone: statusTone(p.status)),
        AppChip(l.enumLabel('listingPurpose', p.listingPurpose)),
        SyncBadge(p.syncStatus),
        if (onChangeStatus != null) TextButton.icon(onPressed: onChangeStatus, icon: const Icon(Icons.swap_horiz), label: Text(l.t('property.changeStatus'))),
      ]),
      const Divider(height: 24),
      InfoRow(l.t('property.society'), p.society),
      InfoRow(l.t('property.area'), p.area),
      InfoRow(l.t('property.block'), p.block),
      InfoRow(l.t('property.plotNumber'), p.plotNumber),
      InfoRow(l.t('property.street'), p.street),
      InfoRow(l.t('property.minimumPrice'), p.minimumPrice == null ? null : formatPkr(p.minimumPrice, urdu: l.isRtl)),
      InfoRow(l.t('property.expectedFinalPrice'), p.expectedFinalPrice == null ? null : formatPkr(p.expectedFinalPrice, urdu: l.isRtl)),
      InfoRow(l.t('property.negotiable'), p.negotiable ? l.t('common.yes') : l.t('common.no')),
      InfoRow(l.t('property.bedrooms'), p.bedrooms?.toString()),
      InfoRow(l.t('property.bathrooms'), p.bathrooms?.toString()),
      InfoRow(l.t('property.floors'), p.floors?.toString()),
      if (owner != null) ...[
        SectionHeader(l.t('property.owner')),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(owner['fullName'] as String? ?? ''),
          subtitle: Ltr(owner['mobileNumber'] as String? ?? ''),
          onTap: () => context.push('/owners/${owner['_id']}'),
          trailing: ContactActions(phone: owner['mobileNumber'] as String? ?? '', whatsapp: owner['whatsappNumber'] as String?),
        ),
      ],
      if (p.description != null) ...[SectionHeader(l.t('common.description')), Text(p.description!)],
      if (p.hasLocation) ...[
        SectionHeader(l.t('property.location'), trailing: TextButton.icon(icon: const Icon(Icons.open_in_new, size: 16), label: Text(l.t('common.openInMaps')), onPressed: () => Contact.openMaps(p.latitude!, p.longitude!))),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: 200,
            child: GoogleMap(
              liteModeEnabled: Platform.isAndroid,
              initialCameraPosition: CameraPosition(target: LatLng(p.latitude!, p.longitude!), zoom: 15),
              markers: {Marker(markerId: const MarkerId('p'), position: LatLng(p.latitude!, p.longitude!))},
              zoomControlsEnabled: false,
              onTap: (_) => Contact.openMaps(p.latitude!, p.longitude!),
            ),
          ),
        ),
      ],
    ]);
  }
}

class _Gallery extends ConsumerStatefulWidget {
  const _Gallery({required this.property});
  final Property property;
  @override
  ConsumerState<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends ConsumerState<_Gallery> {
  double? _progress;
  List<File> _failed = [];
  int _reload = 0;

  Future<void> _upload(List<File> files) async {
    if (files.isEmpty) return;
    setState(() => _progress = 0);
    try {
      await ref.read(onlineRepositoryProvider).uploadMedia(widget.property.serverId!, files, onProgress: (p) => setState(() => _progress = p));
      _failed = [];
      await ref.read(syncEngineProvider).syncNow(); // picks up the new cover image
    } catch (e) {
      _failed = files;
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

  Future<void> _pick() async {
    final l = context.l10n;
    final source = await showAppBottomSheet<String>(
      context,
      title: l.t('property.uploadMedia'),
      child: Column(children: [
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(l.t('mobile.photos')), onTap: () => Navigator.pop(context, 'photos')),
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(l.t('mobile.camera')), onTap: () => Navigator.pop(context, 'camera')),
        ListTile(leading: const Icon(Icons.videocam_outlined), title: Text(l.t('mobile.video')), onTap: () => Navigator.pop(context, 'video')),
      ]),
    );
    final picker = ImagePicker();
    final files = switch (source) {
      'photos' => await picker.pickMultiImage(),
      'camera' => [await picker.pickImage(source: ImageSource.camera)].whereType<XFile>().toList(),
      'video' => [await picker.pickVideo(source: ImageSource.gallery)].whereType<XFile>().toList(),
      _ => <XFile>[],
    };
    await _upload(files.map((x) => File(x.path)).toList());
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = widget.property;
    if (p.serverId == null) return AppEmptyState(title: l.t('mobile.sync.pending'), icon: Icons.cloud_upload_outlined);
    final canEdit = ref.watch(authProvider).can('properties:update');
    final repo = ref.watch(onlineRepositoryProvider);
    return FutureBuilder(
      key: ValueKey(_reload),
      future: repo.media(p.serverId!),
      builder: (context, snap) => ListView(padding: const EdgeInsets.all(16), children: [
        if (canEdit)
          Row(children: [
            Expanded(
              child: AppButton(
                label: _progress == null ? l.t('property.uploadMedia') : l.t('property.uploading', {'percent': ((_progress ?? 0) * 100).round()}),
                icon: Icons.add_a_photo_outlined,
                onPressed: _progress == null ? _pick : null,
              ),
            ),
            if (_failed.isNotEmpty && _progress == null) ...[
              const SizedBox(width: 8),
              AppButton(label: '${l.t('common.retry')} (${_failed.length})', outlined: true, icon: Icons.refresh, onPressed: () => _upload(_failed)),
            ],
          ]),
        if (_progress != null) Padding(padding: const EdgeInsets.only(top: 8), child: LinearProgressIndicator(value: _progress)),
        const SizedBox(height: 12),
        if (snap.hasError) AppErrorState(error: snap.error!, onRetry: () => setState(() => _reload++)),
        if (!snap.hasData && !snap.hasError) const AppLoader(),
        if (snap.hasData && snap.data!.isEmpty) AppEmptyState(title: l.t('property.noMedia'), icon: Icons.photo_outlined),
        if (snap.hasData)
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            children: [
              for (final m in snap.data!)
                GestureDetector(
                  onTap: () => m['kind'] == 'video' ? Contact.openUrl(m['fileUrl'] as String) : _viewImage(context, m['fileUrl'] as String),
                  onLongPress: !canEdit
                      ? null
                      : () async {
                          final action = await showAppBottomSheet<String>(context, title: m['fileName'] as String? ?? '', child: Column(children: [
                            if (m['kind'] == 'image') ListTile(leading: const Icon(Icons.star_outline), title: Text(l.t('property.setCover')), onTap: () => Navigator.pop(context, 'cover')),
                            ListTile(leading: const Icon(Icons.delete_outline), title: Text(l.t('common.delete')), onTap: () => Navigator.pop(context, 'delete')),
                          ]));
                          try {
                            if (action == 'cover') await repo.setCover(m['_id'] as String);
                            if (action == 'delete') await repo.deleteMedia(m['_id'] as String);
                            if (action != null) {
                              await ref.read(syncEngineProvider).syncNow();
                              setState(() => _reload++);
                            }
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                  child: Stack(fit: StackFit.expand, children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: (m['thumbnailUrl'] ?? (m['kind'] == 'image' ? m['fileUrl'] : null)) == null
                          ? Container(color: Colors.black12, child: const Icon(Icons.videocam))
                          : CachedNetworkImage(imageUrl: (m['thumbnailUrl'] ?? m['fileUrl']) as String, fit: BoxFit.cover),
                    ),
                    if (p.coverImageUrl == m['fileUrl']) const Positioned(top: 4, left: 4, child: Icon(Icons.star, color: Colors.amber, size: 18)),
                    if (m['kind'] == 'video') const Center(child: Icon(Icons.play_circle_outline, color: Colors.white, size: 32)),
                  ]),
                ),
            ],
          ),
      ]),
    );
  }

  void _viewImage(BuildContext context, String url) => showDialog<void>(
        context: context,
        builder: (_) => Dialog.fullscreen(
          backgroundColor: Colors.black,
          child: Stack(children: [
            Center(child: InteractiveViewer(child: CachedNetworkImage(imageUrl: url))),
            Positioned(top: 8, right: 8, child: IconButton(color: Colors.white, icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context))),
          ]),
        ),
      );
}

class _PropertyMatches extends ConsumerWidget {
  const _PropertyMatches({required this.serverId});
  final String? serverId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (serverId == null) return AppEmptyState(title: context.t('mobile.sync.pending'));
    return FutureBuilder(
      future: ref.watch(onlineRepositoryProvider).matches(propertyId: serverId),
      builder: (context, snap) {
        if (snap.hasError) return AppErrorState(error: snap.error!);
        if (!snap.hasData) return const AppLoader();
        final items = snap.data!.items;
        if (items.isEmpty) return AppEmptyState(title: context.t('match.noMatches'), hint: context.t('match.noMatchesHint'));
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, i) => MatchCard(match: items[i], perspective: 'property'),
        );
      },
    );
  }
}

class PropertyFormScreen extends ConsumerStatefulWidget {
  const PropertyFormScreen({super.key, this.id});
  final String? id;
  @override
  ConsumerState<PropertyFormScreen> createState() => _PropertyFormScreenState();
}

class _PropertyFormScreenState extends ConsumerState<PropertyFormScreen> {
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in const ['title', 'society', 'area', 'block', 'street', 'plotNumber', 'size', 'askingPrice', 'minimumPrice', 'expectedFinalPrice', 'bedrooms', 'bathrooms', 'floors', 'description']) k: TextEditingController()};
  String _type = 'RESIDENTIAL_PLOT';
  String _purpose = 'SALE';
  String _unit = 'SQ_YARD';
  bool _negotiable = true;
  String? _ownerId;
  double? _lat;
  double? _lng;
  Property? _editing;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _unit = (ref.read(authProvider).business?['defaultSizeUnit'] as String?) ?? 'SQ_YARD';
    if (widget.id != null) _load();
  }

  Future<void> _load() async {
    final p = await ref.read(crmRepositoryProvider).property(widget.id!);
    if (p == null || !mounted) return;
    setState(() {
      _editing = p;
      _type = p.propertyType;
      _purpose = p.listingPurpose;
      _unit = p.sizeUnit;
      _negotiable = p.negotiable;
      _ownerId = p.ownerId;
      _lat = p.latitude;
      _lng = p.longitude;
      for (final k in _c.keys) {
        final v = p.json[k];
        if (v != null) _c[k]!.text = v is num && v % 1 == 0 ? v.toInt().toString() : '$v';
      }
    });
  }

  num? _num(String k) => num.tryParse(_c[k]!.text.replaceAll(',', '').trim());

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final fields = <String, dynamic>{
      'propertyType': _type,
      'listingPurpose': _purpose,
      'size': _num('size'),
      'sizeUnit': _unit,
      'askingPrice': _num('askingPrice')!.round(),
      'negotiable': _negotiable,
      for (final k in const ['title', 'society', 'area', 'block', 'street', 'plotNumber', 'description'])
        if (_c[k]!.text.trim().isNotEmpty) k: _c[k]!.text.trim(),
      for (final k in const ['minimumPrice', 'expectedFinalPrice'])
        if (_num(k) != null) k: _num(k)!.round(),
      for (final k in const ['bedrooms', 'bathrooms', 'floors'])
        if (_num(k) != null) k: _num(k)!.toInt(),
      if (_ownerId != null) 'ownerId': _ownerId,
      if (_lat != null && _lng != null) ...{'latitude': _lat, 'longitude': _lng},
    };
    try {
      final repo = ref.read(crmRepositoryProvider);
      final saved = _editing == null ? await repo.saveProperty(fields) : await repo.saveProperty(fields, id: _editing!.local!.uuid);
      if (!mounted) return;
      showMessage(context, context.t(_editing == null ? 'property.created' : 'property.updated'));
      _editing == null ? context.pushReplacement('/properties/${saved.id}') : context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final residential = const ['HOUSE', 'FLAT', 'APARTMENT', 'PORTION'].contains(_type);
    String? required(String? v) => (v == null || num.tryParse(v.replaceAll(',', '')) == null) ? l.t('common.required') : null;
    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'property.add' : 'property.edit'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          AppDropdown<String>(label: l.t('property.type'), value: _type, items: {for (final t in propertyTypes) t: l.enumLabel('propertyType', t)}, onChanged: (v) => setState(() => _type = v ?? _type)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: [for (final s in const ['SALE', 'RENT']) ButtonSegment(value: s, label: Text(l.enumLabel('listingPurpose', s)))],
            selected: {_purpose},
            onSelectionChanged: (s) => setState(() => _purpose = s.first),
          ),
          const SizedBox(height: 12),
          AppTextField(label: l.t('property.society'), controller: _c['society'], hint: 'Gulshan-e-Iqbal'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('property.area'), controller: _c['area'])),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('property.block'), controller: _c['block'])),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('property.plotNumber'), controller: _c['plotNumber'])),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('property.street'), controller: _c['street'])),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('property.size'), controller: _c['size'], keyboardType: const TextInputType.numberWithOptions(decimal: true), validator: required)),
            const SizedBox(width: 8),
            Expanded(child: AppDropdown<String>(label: l.t('property.sizeUnit'), value: _unit, items: {for (final u in sizeUnits) u: l.enumLabel('sizeUnit', u)}, onChanged: (v) => setState(() => _unit = v ?? _unit))),
          ]),
          const SizedBox(height: 12),
          StatefulBuilder(
            builder: (context, setLocal) => AppTextField(
              label: l.t('property.askingPrice'),
              controller: _c['askingPrice'],
              keyboardType: TextInputType.number,
              validator: required,
              helper: formatPkr(_num('askingPrice'), urdu: l.isRtl),
              onChanged: (_) => setLocal(() {}),
            ),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: AppTextField(label: l.t('property.minimumPrice'), controller: _c['minimumPrice'], keyboardType: TextInputType.number, validator: (v) {
              final min = num.tryParse(v ?? ''), ask = _num('askingPrice');
              return min != null && ask != null && min > ask ? l.t('errors.VALIDATION_ERROR') : null;
            })),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: l.t('property.expectedFinalPrice'), controller: _c['expectedFinalPrice'], keyboardType: TextInputType.number)),
          ]),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.t('property.negotiable')), value: _negotiable, onChanged: (v) => setState(() => _negotiable = v)),
          if (residential)
            Row(children: [
              Expanded(child: AppTextField(label: l.t('property.bedrooms'), controller: _c['bedrooms'], keyboardType: TextInputType.number)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: l.t('property.bathrooms'), controller: _c['bathrooms'], keyboardType: TextInputType.number)),
              const SizedBox(width: 8),
              Expanded(child: AppTextField(label: l.t('property.floors'), controller: _c['floors'], keyboardType: TextInputType.number)),
            ]),
          const SizedBox(height: 12),
          FutureBuilder(
            future: ref.read(crmRepositoryProvider).owners(limit: 500),
            builder: (context, snap) => AppDropdown<String>(
              label: l.t('property.owner'),
              value: _ownerId,
              items: {for (final o in snap.data ?? const <Owner>[]) o.serverId ?? o.id: '${o.fullName} — ${o.mobileNumber}'},
              onChanged: (v) => setState(() => _ownerId = v),
            ),
          ),
          Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(icon: const Icon(Icons.person_add_alt), label: Text(l.t('owner.add')), onPressed: () => context.push('/owners/new'))),
          SectionHeader(l.t('property.location')),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.place_outlined),
            title: Text(_lat == null ? l.t('mobile.map.pickLocation') : '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}', textDirection: TextDirection.ltr),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final picked = await context.push<({double lat, double lng})>('/pick-location', extra: _lat == null ? null : (lat: _lat!, lng: _lng!));
              if (picked != null) {
                setState(() {
                  _lat = picked.lat;
                  _lng = picked.lng;
                });
              }
            },
          ),
          AppTextField(label: l.t('common.description'), controller: _c['description'], maxLines: 4),
          const SizedBox(height: 24),
          AppButton(label: l.t('common.save'), loading: _saving, onPressed: _save, expand: true),
        ]),
      ),
    );
  }
}

/// Records that the owner re-confirmed availability today. Needs a connection: the
/// timestamp is set by the server so all devices agree on it.
Future<void> _verify(BuildContext context, WidgetRef ref, Property p) async {
  final l = context.l10n;
  if (p.serverId == null) return showMessage(context, l.t('mobile.sync.pending'));
  final note = await promptText(context, title: l.t('property.verify'), label: l.t('property.verifyNote'));
  if (note == null) return;
  try {
    await ref.read(onlineRepositoryProvider).verifyProperty(p.serverId!, note: note.trim());
    await ref.read(syncEngineProvider).syncNow();
    if (context.mounted) showMessage(context, l.t('property.verified'));
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}
