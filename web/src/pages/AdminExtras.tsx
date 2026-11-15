import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_KEY_PERMISSIONS,
  CLIENT_STATUSES,
  LISTING_PURPOSES,
  MAX_COMMISSION_RULES,
  MIN_RETENTION,
  PERMISSIONS,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  type CommissionRule,
} from '@recrm/shared';
import { apiKeyApi, bulkApi, settingsApi } from '@/api/endpoints';
import type { ApiKey } from '@/api/types';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, type Column } from '@/components/ui';
import { formatDate, relativeTime } from '@/lib/format';
import { useEnumOptions, useMembers, useOnError } from '@/lib/hooks';
import { useAuth, useCan, useModule } from '@/store/auth';
import { toast } from '@/store/toast';

/* ═════════════ Bulk selection on lists ═════════════ */

/** Row selection for a list page: a checkbox column plus the selected ids (cleared when the page of rows changes). */
export function useSelection<T extends { _id: string }>(rows: T[] | undefined, enabled: boolean) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>([]);
  const pageKey = (rows ?? []).map((r) => r._id).join(',');
  useEffect(() => setIds([]), [pageKey]);
  const all = !!rows?.length && rows.every((r) => ids.includes(r._id));
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const column: Column<T> = {
    key: '_select',
    className: 'w-10 !pe-0',
    header: <input type="checkbox" aria-label={t('bulk.selectAll')} className="h-4 w-4 cursor-pointer accent-brand-600" checked={all} onChange={() => setIds(all ? [] : (rows ?? []).map((r) => r._id))} />,
    render: (row) => (
      // The cell swallows the click so ticking a row does not open it.
      <span className="flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={t('bulk.select')} className="h-4 w-4 cursor-pointer accent-brand-600" checked={ids.includes(row._id)} onChange={() => toggle(row._id)} />
      </span>
    ),
  };
  return { ids, clear: () => setIds([]), columns: enabled ? [column] : [] };
}

/** Action bar shown while rows are selected: assign, change status or delete them together. */
export function BulkBar({ kind, ids, onDone }: { kind: 'clients' | 'properties'; ids: string[]; onDone(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const canUpdate = useCan(kind === 'clients' ? PERMISSIONS.CLIENTS_UPDATE : PERMISSIONS.PROPERTIES_UPDATE);
  const canDelete = useCan(kind === 'clients' ? PERMISSIONS.CLIENTS_DELETE : PERMISSIONS.PROPERTIES_DELETE);
  const clientStatuses = useEnumOptions('clientStatus', CLIENT_STATUSES);
  const propertyStatuses = useEnumOptions('propertyStatus', PROPERTY_STATUSES);
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) => bulkApi.run(kind, { ids, ...body }),
    onSuccess: (r) => {
      if (r.failed.length) toast.error(t('bulk.partial', { done: r.done, failed: r.failed.length, reason: r.failed[0].message }));
      else toast.success(t('bulk.done', { count: r.done }));
      setConfirm(false);
      setAgent('');
      setStatus('');
      void qc.invalidateQueries({ queryKey: [kind] });
      onDone();
    },
    onError,
  });
  if (!ids.length || (!canUpdate && !canDelete)) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-600/30 bg-brand-50/60 px-3 py-2 dark:bg-white/[0.04]" role="region" aria-label={t('bulk.title')}>
      <span className="ltr-nums text-sm font-semibold">{t('bulk.selected', { count: ids.length })}</span>
      {canUpdate && members.options.length > 0 && (
        <span className="flex items-center gap-1.5">
          <Select aria-label={t('bulk.assign')} placeholder={t('bulk.assign')} options={members.options} value={agent} onChange={(e) => setAgent(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={!agent} loading={run.isPending} onClick={() => run.mutate(kind === 'clients' ? { action: 'ASSIGN', assignedTo: agent } : { action: 'ASSIGN', agentIds: [agent] })}>{t('bulk.apply')}</Button>
        </span>
      )}
      {canUpdate && (
        <span className="flex items-center gap-1.5">
          <Select aria-label={t('bulk.status')} placeholder={t('bulk.status')} options={kind === 'clients' ? clientStatuses : propertyStatuses} value={status} onChange={(e) => setStatus(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={!status} loading={run.isPending} onClick={() => run.mutate({ action: 'STATUS', status })}>{t('bulk.apply')}</Button>
        </span>
      )}
      {canDelete && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-600" />} onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
      <Button size="sm" variant="ghost" className="ms-auto" icon={<X className="h-3.5 w-3.5" />} onClick={onDone}>{t('bulk.clear')}</Button>
      <ConfirmDialog open={confirm} title={t('common.areYouSure')} message={t('bulk.deleteConfirm', { count: ids.length })} loading={run.isPending} onConfirm={() => run.mutate({ action: 'DELETE' })} onClose={() => setConfirm(false)} />
    </div>
  );
}

/* ═════════════ Commission rules (Settings → Matching & deals) ═════════════ */

export function CommissionRulesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const purposes = useEnumOptions('listingPurpose', LISTING_PURPOSES);
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  const [rules, setRules] = useState<CommissionRule[] | null>(null);
  useEffect(() => {
    if (q.data && !rules) setRules(q.data.commission.rules ?? []);
  }, [q.data, rules]);
  const save = useMutation({
    mutationFn: () => settingsApi.update({ commission: { rules: rules!.map((r) => ({ listingPurpose: r.listingPurpose || null, propertyType: r.propertyType || null, buyerPct: r.buyerPct, sellerPct: r.sellerPct })) } }),
    onSuccess: (s) => (toast.success(t('common.saved')), qc.setQueryData(['settings'], s)),
    onError,
  });
  if (!rules) return null;
  const set = (i: number, patch: Partial<CommissionRule>) => setRules(rules.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const incomplete = rules.some((r) => !r.listingPurpose && !r.propertyType);
  return (
    <Card title={t('commissionRules.title')}>
      <p className="mb-3 text-xs text-muted">{t('commissionRules.hint')}</p>
      {!rules.length && <p className="mb-3 text-sm text-muted">{t('commissionRules.none')}</p>}
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_1fr_7rem_7rem_auto]">
            <Select label={t('commissionRules.purpose')} placeholder={t('common.all')} options={purposes} value={r.listingPurpose ?? ''} disabled={!canManage} onChange={(e) => set(i, { listingPurpose: (e.target.value || null) as CommissionRule['listingPurpose'] })} />
            <Select label={t('commissionRules.type')} placeholder={t('common.all')} options={types} value={r.propertyType ?? ''} disabled={!canManage} onChange={(e) => set(i, { propertyType: e.target.value || null })} />
            <Input label={t('commissionRules.buyer')} type="number" min={0} max={20} step="0.1" value={r.buyerPct} disabled={!canManage} onChange={(e) => set(i, { buyerPct: Number(e.target.value) || 0 })} />
            <Input label={t('commissionRules.seller')} type="number" min={0} max={20} step="0.1" value={r.sellerPct} disabled={!canManage} onChange={(e) => set(i, { sellerPct: Number(e.target.value) || 0 })} />
            {canManage && <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => setRules(rules.filter((_, x) => x !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
          </div>
        ))}
      </div>
      {incomplete && <p className="mt-2 text-xs text-red-600">{t('commissionRules.needCondition')}</p>}
      {canManage && (
        <div className="mt-3 flex justify-between">
          <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={rules.length >= MAX_COMMISSION_RULES} onClick={() => setRules([...rules, { listingPurpose: 'RENT', propertyType: null, buyerPct: 1, sellerPct: 1 }])}>{t('commissionRules.add')}</Button>
          <Button size="sm" disabled={incomplete} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </div>
      )}
    </Card>
  );
}

/* ═════════════ Data retention (Settings → Security) ═════════════ */

export function RetentionCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, enabled: canManage });
  const [d, setD] = useState<{ auditLogMonths: number; activityMonths: number } | null>(null);
  useEffect(() => {
    if (q.data && !d) setD(q.data.retention ?? { auditLogMonths: 0, activityMonths: 0 });
  }, [q.data, d]);
  const save = useMutation({ mutationFn: () => settingsApi.update({ retention: d }), onSuccess: (s) => (toast.success(t('common.saved')), qc.setQueryData(['settings'], s)), onError });
  if (!canManage || !d) return null;
  const opts = (min: number) => [{ value: '0', label: t('retention.forever') }, ...[6, 12, 24, 36, 60, 84].filter((m) => m >= min).map((m) => ({ value: String(m), label: t('retention.months', { count: m }) }))];
  return (
    <Card title={t('retention.title')}>
      <p className="mb-3 max-w-2xl text-xs text-muted">{t('retention.hint')}</p>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Select label={t('retention.audit')} options={opts(MIN_RETENTION.auditLogMonths)} value={String(d.auditLogMonths)} onChange={(e) => setD({ ...d, auditLogMonths: Number(e.target.value) })} />
        <Select label={t('retention.activity')} options={opts(MIN_RETENTION.activityMonths)} value={String(d.activityMonths)} onChange={(e) => setD({ ...d, activityMonths: Number(e.target.value) })} />
      </div>
      <div className="mt-3"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>
    </Card>
  );
}

/* ═════════════ API access keys (Settings → Security) ═════════════ */

export function ApiKeysCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const hasApi = useModule('api');
  const mine = useAuth((s) => s.membership?.permissions);
  const q = useQuery({ queryKey: ['api-keys'], queryFn: apiKeyApi.list, enabled: canManage && hasApi });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => apiKeyApi.create({ name, permissions: perms, expiresAt: expiresAt || null }),
    onSuccess: (k) => (setSecret(k.secret), setOpen(false), setName(''), setPerms([]), setExpiresAt(''), refresh()),
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => apiKeyApi.revoke(id), onSuccess: () => (setRevoking(null), toast.success(t('apiKeys.revoked')), refresh()), onError });
  if (!canManage) return null;
  const allowed = API_KEY_PERMISSIONS.filter((p) => !!mine?.includes(p));
  const copy = () => void navigator.clipboard.writeText(secret ?? '').then(() => toast.success(t('apiKeys.copied')));
  return (
    <Card title={t('apiKeys.title')} actions={hasApi ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>{t('apiKeys.add')}</Button> : undefined}>
      <p className="mb-3 max-w-2xl text-xs text-muted">{t('apiKeys.hint')}</p>
      {!hasApi ? (
        <p className="text-sm text-muted">{t('apiKeys.notInPlan')}</p>
      ) : !q.data?.length ? (
        <EmptyState title={t('apiKeys.none')} icon={<KeyRound className="h-6 w-6" />} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((k) => (
            <li key={k._id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <KeyRound className="h-4 w-4 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{k.name}</span> <span className="ltr-nums text-xs text-muted">{k.prefix}…</span>{' '}
                {k.revokedAt ? <Badge color="red">{t('apiKeys.revokedBadge')}</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge color="amber">{t('apiKeys.expired')}</Badge> : <Badge color="green">{t('apiKeys.active')}</Badge>}
                <span className="block text-xs text-muted">
                  {k.permissions.join(', ')} · {k.lastUsedAt ? t('apiKeys.lastUsed', { when: relativeTime(k.lastUsedAt) }) : t('apiKeys.neverUsed')}
                  {k.expiresAt ? ` · ${t('apiKeys.expires', { date: formatDate(k.expiresAt) })}` : ''}
                </span>
              </span>
              {!k.revokedAt && <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>{t('apiKeys.revoke')}</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('apiKeys.add')} footer={<Button disabled={name.trim().length < 2 || !perms.length} loading={create.isPending} onClick={() => create.mutate()}>{t('apiKeys.create')}</Button>}>
        <div className="space-y-3">
          <Input label={t('apiKeys.name')} placeholder={t('apiKeys.namePlaceholder')} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <p className="label">{t('apiKeys.permissions')}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {allowed.map((p) => (
                <Checkbox key={p} label={<span className="ltr-nums">{p}</span>} checked={perms.includes(p)} onChange={(on) => setPerms(on ? [...perms, p] : perms.filter((x) => x !== p))} />
              ))}
            </div>
          </div>
          <Input label={t('apiKeys.expiry')} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} hint={t('apiKeys.expiryHint')} />
        </div>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title={t('apiKeys.createdTitle')} footer={<Button onClick={() => setSecret(null)}>{t('apiKeys.done')}</Button>}>
        <p className="mb-2 text-sm">{t('apiKeys.createdHint')}</p>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-2">
          <code className="ltr-nums min-w-0 flex-1 break-all text-xs">{secret}</code>
          <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>{t('apiKeys.copy')}</Button>
        </div>
        <p className="mt-3 text-xs text-muted">{t('apiKeys.usage')}</p>
        <code className="ltr-nums mt-1 block break-all rounded-lg bg-surface-2 p-2 text-2xs">Authorization: Bearer {secret?.slice(0, 14)}…</code>
      </Modal>
      <ConfirmDialog open={!!revoking} title={t('apiKeys.revokeTitle', { name: revoking?.name ?? '' })} message={t('apiKeys.revokeHint')} confirmLabel={t('apiKeys.revoke')} loading={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking._id)} onClose={() => setRevoking(null)} />
    </Card>
  );
}
