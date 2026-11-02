import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_localizations.dart';
import '../../core/models/models.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

/// More screen row: which branch the app shows, tap to switch (only with more than one branch).
class BranchSwitcherTile extends ConsumerWidget {
  const BranchSwitcherTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scope = ref.watch(branchScopeProvider);
    if (!scope.hasChoice) return const SizedBox.shrink();
    final l = context.l10n;
    return ListTile(
      leading: const Icon(Icons.store_mall_directory_outlined),
      title: Text(l.t('branch.switch')),
      subtitle: Text(scope.selectedBranch?.label(l.isRtl) ?? l.t('branch.all')),
      trailing: const Icon(Icons.unfold_more),
      onTap: () => showAppBottomSheet<void>(
        context,
        title: l.t('branch.switch'),
        child: RadioGroup<String>(
          groupValue: scope.selected ?? '',
          onChanged: (v) {
            ref.read(branchScopeProvider).select(v == null || v.isEmpty ? null : v);
            Navigator.pop(context);
          },
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            RadioListTile<String>(value: '', title: Text(l.t('branch.all'))),
            for (final b in scope.branches) RadioListTile<String>(value: b.serverId ?? b.id, title: Text(b.label(l.isRtl)), subtitle: b.isDefault ? Text(l.t('branch.main')) : null),
          ]),
        ),
      ),
    );
  }
}

/// Branch picker for record forms; hidden when the member can use only one branch.
class BranchDropdown extends ConsumerWidget {
  const BranchDropdown({super.key, required this.value, required this.onChanged});
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scope = ref.watch(branchScopeProvider);
    if (!scope.hasChoice) return const SizedBox.shrink();
    final l = context.l10n;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppDropdown<String>(
        label: l.t('branch.branch'),
        value: value ?? scope.branchForNewRecord(),
        items: {for (final b in scope.branches) b.serverId ?? b.id: b.label(l.isRtl)},
        onChanged: onChanged,
      ),
    );
  }
}

final _allBranchesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) {
  ref.watch(entityChangesProvider('branches'));
  return ref.watch(onlineRepositoryProvider).allBranches();
});

/// Settings → Branches (same as the web). Managing branches needs a connection.
class BranchesScreen extends ConsumerWidget {
  const BranchesScreen({super.key});

  Future<void> _edit(BuildContext context, WidgetRef ref, [Map<String, dynamic>? b]) async {
    final l = context.l10n;
    final name = TextEditingController(text: b?['name'] as String? ?? '');
    final nameUr = TextEditingController(text: b?['nameUr'] as String? ?? '');
    final code = TextEditingController(text: b?['code'] as String? ?? '');
    final address = TextEditingController(text: b?['address'] as String? ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(l.t(b == null ? 'branch.add' : 'common.edit')),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            AppTextField(label: l.t('branch.name'), controller: name),
            const SizedBox(height: 8),
            AppTextField(label: l.t('branch.nameUr'), controller: nameUr, textDirection: TextDirection.rtl),
            const SizedBox(height: 8),
            AppTextField(label: l.t('branch.code'), controller: code),
            const SizedBox(height: 8),
            AppTextField(label: l.t('common.address'), controller: address),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.t('common.cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.t('common.save'))),
        ],
      ),
    );
    if (ok != true || name.text.trim().length < 2) return;
    final body = {
      'name': name.text.trim(),
      if (nameUr.text.trim().isNotEmpty) 'nameUr': nameUr.text.trim(),
      if (code.text.trim().isNotEmpty) 'code': code.text.trim(),
      if (address.text.trim().isNotEmpty) 'address': address.text.trim(),
    };
    try {
      final repo = ref.read(onlineRepositoryProvider);
      await (b == null ? repo.createBranch(body) : repo.updateBranch(b['_id'] as String, body));
      if (context.mounted) showMessage(context, l.t(b == null ? 'branch.created' : 'branch.updated'));
      ref.invalidate(_allBranchesProvider);
      ref.read(syncEngineProvider).schedule(Duration.zero);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final canManage = ref.watch(authProvider).can('branches:manage');
    return Scaffold(
      appBar: AppBar(title: Text(l.t('settings.branches'))),
      floatingActionButton: canManage ? FloatingActionButton(onPressed: () => _edit(context, ref), child: const Icon(Icons.add)) : null,
      body: ref.watch(_allBranchesProvider).when(
            loading: () => const AppLoader(),
            error: (e, _) => AppErrorState(error: e, onRetry: () => ref.invalidate(_allBranchesProvider)),
            data: (items) => ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
              Text(l.t('branch.intro'), style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 12),
              for (final b in items)
                AppCard(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(Branch(b).label(l.isRtl)),
                    subtitle: Text([
                      if (b['isDefault'] == true) l.t('branch.main'),
                      if (b['archivedAt'] != null) l.t('branch.archived'),
                      l.t('branch.memberCount', {'count': (b['memberCount'] as num?)?.toInt() ?? 0}),
                    ].join(' · ')),
                    trailing: canManage
                        ? PopupMenuButton<String>(
                            onSelected: (v) async {
                              if (v == 'edit') return _edit(context, ref, b);
                              try {
                                await ref.read(onlineRepositoryProvider).updateBranch(b['_id'] as String, {'archived': b['archivedAt'] == null});
                                ref.invalidate(_allBranchesProvider);
                                ref.read(syncEngineProvider).schedule(Duration.zero);
                              } catch (e) {
                                if (context.mounted) showError(context, e);
                              }
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(value: 'edit', child: Text(l.t('common.edit'))),
                              if (b['isDefault'] != true) PopupMenuItem(value: 'archive', child: Text(l.t(b['archivedAt'] == null ? 'settings.archive' : 'branch.restore'))),
                            ],
                          )
                        : null,
                  ),
                ),
            ]),
          ),
    );
  }
}
