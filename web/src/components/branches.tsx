import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BRANCH_ACCESS, PERMISSIONS, type BranchAccess } from '@recrm/shared';
import { branchSelection } from '@/api/client';
import { branchApi } from '@/api/endpoints';
import type { Branch } from '@/api/types';
import { Badge, Button, Card, Checkbox, Input, PageLoader, Select } from '@/components/ui';
import { useOnError } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

/** Branches the signed-in member can see (the switcher's options). */
export function useBranches() {
  const status = useAuth((s) => s.status);
  return useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list(), enabled: status === 'authenticated', staleTime: 60_000 });
}

/** Display name of a branch in the current language. */
export function useBranchName() {
  const { data } = useBranches();
  const lang = useUi((s) => s.lang);
  return (id?: string | null) => {
    const b = data?.find((x) => x._id === id);
    return b ? (lang === 'ur' && b.nameUr ? b.nameUr : b.name) : undefined;
  };
}

/** The branch picked in the switcher (null = all branches). Persisted per browser. */
export function useSelectedBranch(): [string | null, (id: string | null) => void] {
  const [value, setValue] = useState(branchSelection.get());
  useEffect(() => branchSelection.subscribe(setValue), []);
  return [value, branchSelection.set];
}

/**
 * Header switcher for members who can see more than one branch (owners see "All branches" =
 * consolidated). The choice travels to the API as the X-Branch-Id header, so every list,
 * dashboard, report and export follows it; the server refuses a branch outside the member's.
 */
export function BranchSwitcher() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const branches = useBranches();
  const name = useBranchName();
  const [selected, setSelected] = useSelectedBranch();
  const list = branches.data ?? [];
  useEffect(() => {
    // A remembered branch that no longer exists for this member falls back to all branches.
    if (selected && branches.data && !branches.data.some((b) => b._id === selected)) {
      setSelected(null);
      void qc.invalidateQueries();
    }
  }, [selected, branches.data, setSelected, qc]);
  if (list.length < 2) return null;
  return (
    <label className="hidden items-center gap-1.5 sm:flex" title={t('branch.switch')}>
      <Building2 className="h-4 w-4 text-muted" />
      <select
        className="input !h-8 !w-auto !py-0 text-sm"
        aria-label={t('branch.switch')}
        value={selected ?? ''}
        onChange={(e) => {
          setSelected(e.target.value || null);
          void qc.invalidateQueries();
        }}
      >
        <option value="">{t('branch.all')}</option>
        {list.map((b) => (
          <option key={b._id} value={b._id}>
            {name(b._id)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Branch field for record forms. Hidden when the member can only use one branch; defaults to the
 * branch picked in the switcher (the API applies the same default when none is sent).
 */
export function BranchField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const name = useBranchName();
  const [selected] = useSelectedBranch();
  const list = branches.data ?? [];
  useEffect(() => {
    if (!value && list.length) onChange(selected ?? list.find((b) => b.isDefault)?._id ?? list[0]._id);
  }, [value, list, selected, onChange]);
  if (list.length < 2) return null;
  return <Select label={t('branch.branch')} options={list.map((b) => ({ value: b._id, label: name(b._id) ?? b.name }))} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** Member editor: all branches, or only the ticked ones. */
export function BranchAccessEditor({
  access,
  branchIds,
  onChange,
}: {
  access: BranchAccess;
  branchIds: string[];
  onChange(v: { branchAccess: BranchAccess; branchIds: string[] }): void;
}) {
  const { t } = useTranslation();
  const branches = useBranches();
  const name = useBranchName();
  const list = branches.data ?? [];
  if (list.length < 2 && access === 'ALL') return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-2 text-sm font-medium">{t('branch.access')}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {BRANCH_ACCESS.map((a) => (
          <Button key={a} size="sm" variant={access === a ? 'primary' : 'secondary'} onClick={() => onChange({ branchAccess: a, branchIds: a === 'ALL' ? [] : branchIds })}>
            {t(`branch.accessMode.${a}`)}
          </Button>
        ))}
      </div>
      {access === 'SELECTED' && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {list.map((b) => (
            <Checkbox
              key={b._id}
              label={name(b._id) ?? b.name}
              checked={branchIds.includes(b._id)}
              onChange={(on) => onChange({ branchAccess: 'SELECTED', branchIds: on ? [...new Set([...branchIds, b._id])] : branchIds.filter((x) => x !== b._id) })}
            />
          ))}
        </div>
      )}
      {access === 'SELECTED' && branchIds.length === 0 && <p className="mt-2 text-xs text-red-600">{t('branch.chooseOne')}</p>}
    </div>
  );
}

/** Settings → Branches. */
export function BranchSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.BRANCHES_MANAGE);
  const q = useQuery({ queryKey: ['branches', 'all'], queryFn: () => branchApi.list(true) });
  const [form, setForm] = useState({ name: '', nameUr: '', code: '', address: '' });
  const [editing, setEditing] = useState<Branch | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['branches'] });
  const add = useMutation({
    mutationFn: () => branchApi.create({ name: form.name, nameUr: form.nameUr || undefined, code: form.code || undefined, address: form.address || undefined }),
    onSuccess: () => (toast.success(t('branch.created')), setForm({ name: '', nameUr: '', code: '', address: '' }), refresh()),
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => branchApi.update(id, body),
    onSuccess: () => (toast.success(t('branch.updated')), setEditing(null), refresh()),
    onError,
  });
  if (q.isLoading) return <PageLoader />;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">{t('branch.intro')}</p>
      {canManage && (
        <div className="mb-4 grid items-end gap-2 sm:grid-cols-5">
          <Input label={t('branch.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t('branch.nameUr')} value={form.nameUr} onChange={(e) => setForm({ ...form, nameUr: e.target.value })} dir="rtl" />
          <Input label={t('branch.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input label={t('common.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Button icon={<Plus className="h-4 w-4" />} disabled={form.name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>
            {t('branch.add')}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {q.data?.map((b) => (
          <li key={b._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            {editing?._id === b._id ? (
              <span className="flex flex-wrap items-end gap-2">
                <Input aria-label={t('branch.name')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <Input aria-label={t('branch.nameUr')} value={editing.nameUr ?? ''} onChange={(e) => setEditing({ ...editing, nameUr: e.target.value })} dir="rtl" />
                <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ id: b._id, body: { name: editing.name, nameUr: editing.nameUr || undefined } })}>
                  {t('common.save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              </span>
            ) : (
              <span>
                {b.name} {b.nameUr && <span className="font-urdu text-muted" dir="rtl">· {b.nameUr}</span>} {b.code && <Badge>{b.code}</Badge>}{' '}
                {b.isDefault && <Badge color="blue">{t('branch.main')}</Badge>} {b.archivedAt && <Badge color="amber">{t('branch.archived')}</Badge>}
              </span>
            )}
            <span className="flex items-center gap-3">
              <span className="text-xs text-muted">{t('branch.memberCount', { count: b.memberCount ?? 0 })}</span>
              {canManage && editing?._id !== b._id && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>{t('common.edit')}</Button>
                  {!b.isDefault && (
                    <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => update.mutate({ id: b._id, body: { archived: !b.archivedAt } })}>
                      {b.archivedAt ? t('branch.restore') : t('settings.archive')}
                    </Button>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
