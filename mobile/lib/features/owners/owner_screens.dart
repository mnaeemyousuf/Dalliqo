import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/utils/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../core/widgets/domain_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';
import '../common/record_panels.dart';

final ownerSearchProvider = StateProvider<String>((ref) => '');

final ownersProvider = FutureProvider.autoDispose<List<Owner>>((ref) {
  ref.watch(entityChangesProvider('owners'));
  return ref.watch(crmRepositoryProvider).owners(search: ref.watch(ownerSearchProvider), limit: 500);
});

class OwnersScreen extends ConsumerWidget {
  const OwnersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.t('owner.title')),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: TextField(
              decoration: InputDecoration(hintText: l.t('owner.searchPlaceholder'), prefixIcon: const Icon(Icons.search), isDense: true),
              onChanged: (v) => ref.read(ownerSearchProvider.notifier).state = v,
            ),
          ),
        ),
      ),
      floatingActionButton: ref.watch(authProvider).can('owners:create') ? FloatingActionButton(onPressed: () => context.push('/owners/new'), child: const Icon(Icons.add)) : null,
      body: ref.watch(ownersProvider).when(
            loading: () => const AppLoader(),
            error: (e, _) => AppErrorState(error: e),
            data: (owners) => owners.isEmpty
                ? AppEmptyState(title: l.t('owner.noOwners'), icon: Icons.apartment)
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                    itemCount: owners.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final o = owners[i];
                      return AppCard(
                        onTap: () => context.push('/owners/${o.id}'),
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [Flexible(child: Text(o.fullName, style: Theme.of(context).textTheme.titleMedium)), const SizedBox(width: 6), SyncBadge(o.syncStatus)]),
                              Ltr(o.mobileNumber, style: Theme.of(context).textTheme.bodySmall),
                              Text(l.t('owner.propertyCount', {'count': o.propertyCount}), style: Theme.of(context).textTheme.bodySmall),
                            ]),
                          ),
                          ContactActions(phone: o.mobileNumber, whatsapp: o.whatsappNumber),
                        ]),
                      );
                    },
                  ),
          ),
    );
  }
}

class OwnerDetailScreen extends ConsumerWidget {
  const OwnerDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(entityChangesProvider('owners'));
    ref.watch(entityChangesProvider('properties'));
    final l = context.l10n;
    final repo = ref.watch(crmRepositoryProvider);
    final auth = ref.watch(authProvider);
    return FutureBuilder(
      future: repo.owner(id),
      builder: (context, snap) {
        if (!snap.hasData) return Scaffold(appBar: AppBar(), body: snap.connectionState == ConnectionState.done ? AppEmptyState(title: l.t('common.notFound')) : const AppLoader());
        final o = snap.data!;
        return DefaultTabController(
          length: 4,
          child: Scaffold(
            appBar: AppBar(
              title: Text(o.fullName),
              actions: [
                if (auth.can('owners:update')) IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/owners/${o.id}/edit')),
                if (auth.can('owners:delete'))
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      if (o.propertyCount > 0) return showMessage(context, l.t('errors.OWNER_HAS_PROPERTIES'));
                      if (await confirmDialog(context, title: l.t('common.areYouSure'), message: l.t('owner.deleteConfirm', {'name': o.fullName}))) {
                        await repo.deleteOwner(o.local!.uuid);
                        if (context.mounted) context.pop();
                      }
                    },
                  ),
              ],
              bottom: TabBar(tabs: [
                Tab(text: l.t('owner.properties')),
                Tab(text: l.t('document.title')),
                Tab(text: l.t('note.title')),
                Tab(text: l.t('activity.title')),
              ]),
            ),
            body: TabBarView(children: [
              ListView(padding: const EdgeInsets.all(16), children: [
                ContactActions(phone: o.mobileNumber, whatsapp: o.whatsappNumber),
                InfoRow(l.t('common.mobile'), o.mobileNumber, ltr: true),
                InfoRow(l.t('common.email'), o.email, ltr: true),
                InfoRow(l.t('common.address'), o.address),
                InfoRow(l.t('common.notes'), o.notes),
                const SizedBox(height: 8),
                FutureBuilder(
                  future: repo.properties(PropertyFilter(ownerId: o.serverId ?? o.id), limit: 200),
                  builder: (context, ps) => Column(children: [
                    for (final p in ps.data ?? const <Property>[]) Padding(padding: const EdgeInsets.only(bottom: 10), child: PropertyCard(property: p)),
                  ]),
                ),
              ]),
              DocumentsPanel(entityType: 'owner', serverId: o.serverId),
              NotesPanel(entityType: 'owner', entityId: o.id),
              o.serverId == null ? AppEmptyState(title: l.t('mobile.sync.pending')) : ActivityPanel(entityId: o.serverId!),
            ]),
          ),
        );
      },
    );
  }
}

class OwnerFormScreen extends ConsumerStatefulWidget {
  const OwnerFormScreen({super.key, this.id});
  final String? id;
  @override
  ConsumerState<OwnerFormScreen> createState() => _OwnerFormScreenState();
}

class _OwnerFormScreenState extends ConsumerState<OwnerFormScreen> {
  final _form = GlobalKey<FormState>();
  final _c = {for (final k in const ['fullName', 'mobileNumber', 'whatsappNumber', 'alternateNumber', 'email', 'address', 'notes']) k: TextEditingController()};
  Owner? _editing;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    if (widget.id != null) {
      ref.read(crmRepositoryProvider).owner(widget.id!).then((o) {
        if (o == null || !mounted) return;
        setState(() {
          _editing = o;
          for (final k in _c.keys) {
            _c[k]!.text = (o.json[k] as String?) ?? '';
          }
        });
      });
    }
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _saving = true);
    final fields = <String, dynamic>{
      for (final e in _c.entries)
        if (e.value.text.trim().isNotEmpty) e.key: e.key.contains('Number') ? normalizePhone(e.value.text) : e.value.text.trim(),
    };
    try {
      final repo = ref.read(crmRepositoryProvider);
      await (_editing == null ? repo.saveOwner(fields) : repo.saveOwner(fields, id: _editing!.local!.uuid));
      if (!mounted) return;
      showMessage(context, context.t(_editing == null ? 'owner.created' : 'owner.updated'));
      context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String? phone(String? v, {bool required = false}) {
      if (v == null || v.trim().isEmpty) return required ? l.t('common.required') : null;
      return normalizePhone(v) == null ? l.t('errors.VALIDATION_ERROR') : null;
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.t(_editing == null ? 'owner.add' : 'owner.edit'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          AppTextField(label: l.t('common.name'), controller: _c['fullName'], validator: (v) => (v == null || v.trim().length < 2) ? l.t('common.required') : null),
          const SizedBox(height: 12),
          AppTextField(label: l.t('client.mobile'), controller: _c['mobileNumber'], keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, validator: (v) => phone(v, required: true)),
          const SizedBox(height: 12),
          AppTextField(label: l.t('client.whatsapp'), controller: _c['whatsappNumber'], keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, validator: phone),
          const SizedBox(height: 12),
          AppTextField(label: l.t('client.alternate'), controller: _c['alternateNumber'], keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, validator: phone),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.email'), controller: _c['email'], keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.address'), controller: _c['address']),
          const SizedBox(height: 12),
          AppTextField(label: l.t('common.notes'), controller: _c['notes'], maxLines: 3),
          const SizedBox(height: 24),
          AppButton(label: l.t('common.save'), loading: _saving, onPressed: _save, expand: true),
        ]),
      ),
    );
  }
}
