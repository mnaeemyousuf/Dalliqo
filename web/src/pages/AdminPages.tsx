import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Bell, CheckCheck, KeyRound, Laptop, LogOut, Plus, Smartphone, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PERMISSION_GROUPS, PERMISSIONS, ROLE_PRESETS, SIZE_UNITS, type Permission } from '@recrm/shared';
import { auditApi, authApi, businessApi, categoryApi, memberApi, notificationApi, settingsApi } from '@/api/endpoints';
import type { Member, Settings } from '@/api/types';
import { BrandLogo } from '@/components/BrandLogo';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Tabs } from '@/components/ui';
import { formatDate, relativeTime } from '@/lib/format';
import { useEnumOptions, useOnError, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';

/* ═════════════ Users & permissions ═════════════ */

/**
 * Permission templates for members. The member's role stays MEMBER; a template only
 * pre-ticks a proven permission set, which the API then enforces permission by permission.
 */
const TEMPLATES = ['MEMBER', 'MANAGER', 'AGENT', 'SALESPERSON', 'ACCOUNTANT', 'VIEWER'] as const;

function templateOf(perms: readonly string[]): (typeof TEMPLATES)[number] | null {
  const key = [...perms].sort().join(',');
  return TEMPLATES.find((tpl) => [...ROLE_PRESETS[tpl]].sort().join(',') === key) ?? null;
}

function PermissionMatrix({ value, onChange, disabled }: { value: Permission[]; onChange(v: Permission[]): void; disabled?: boolean }) {
  const { t } = useTranslation();
  const toggle = (p: Permission, on: boolean) => onChange(on ? [...new Set([...value, p])] : value.filter((x) => x !== p));
  const current = templateOf(value);
  return (
    <div className="space-y-4">
    {!disabled && (
      <div>
        <p className="mb-2 text-xs font-medium text-muted">{t('user.template')}</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((tpl) => (
            <Button key={tpl} size="sm" variant={current === tpl ? 'primary' : 'secondary'} onClick={() => onChange([...ROLE_PRESETS[tpl]])}>
              {t(`user.templates.${tpl}`)}
            </Button>
          ))}
        </div>
      </div>
    )}
    <div className="grid gap-4 sm:grid-cols-2">
      {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
        <div key={group} className="rounded-lg border border-line p-3">
          <p className="mb-2 text-sm font-medium">{t(`user.groups.${group}`)}</p>
          <div className="space-y-1.5">
            {perms.map((p) => (
              <Checkbox key={p} label={t(`enums.permission.${p}`)} checked={value.includes(p)} onChange={(on) => toggle(p, on)} disabled={disabled} />
            ))}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const me = useAuth((s) => s.user?._id);
  const canManage = useCan(PERMISSIONS.MEMBERS_MANAGE);
  const q = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [tempPassword, setTempPassword] = useState('');
  const [form, setForm] = useState({ fullName: '', email: '', mobileNumber: '', temporaryPassword: '' });
  const [newPerms, setNewPerms] = useState<Permission[]>([...ROLE_PRESETS.MEMBER]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });

  const create = useMutation({
    mutationFn: () => memberApi.create({ ...form, mobileNumber: form.mobileNumber || undefined, permissions: newPerms }),
    onSuccess: () => (toast.success(t('user.added')), setAdding(false), setForm({ fullName: '', email: '', mobileNumber: '', temporaryPassword: '' }), refresh()),
    onError,
  });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => memberApi.update(id, body), onSuccess: () => (toast.success(t('user.permissionsSaved')), setEditing(null), refresh()), onError });
  const remove = useMutation({ mutationFn: (id: string) => memberApi.remove(id), onSuccess: () => (setRemoving(null), refresh()), onError });
  const reset = useMutation({ mutationFn: () => memberApi.resetPassword(resetting!._id, tempPassword), onSuccess: () => (toast.success(t('user.passwordReset')), setResetting(null), setTempPassword('')), onError });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const members = q.data!.items;

  return (
    <div>
      <PageHeader title={t('user.title')} actions={canManage && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t('user.add')}</Button>} />
      <div className="grid gap-3 md:grid-cols-2">
        {members.map((m) => {
          const isOwner = m.role === 'OWNER';
          const isMe = m.user._id === me;
          return (
            <Card key={m._id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {m.user.fullName} {isMe && <Badge color="blue">{t('user.you')}</Badge>}
                  </p>
                  <p className="text-sm text-muted">{m.user.email}</p>
                  <p className="ltr-nums text-sm text-muted">{m.user.mobileNumber}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge color={isOwner ? 'purple' : 'gray'}>{t(`enums.role.${m.role}`)}</Badge>
                  <Badge color={m.status === 'ACTIVE' ? 'green' : 'amber'}>{t(`enums.memberStatus.${m.status}`)}</Badge>
                  {m.user.mustChangePassword && <Badge color="amber">{t('user.mustChange')}</Badge>}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">
                {t('user.lastLogin')}: {m.user.lastLoginAt ? relativeTime(m.user.lastLoginAt) : t('user.never')} · {t('user.access')}:{' '}
                {isOwner ? t('user.fullAccess') : templateOf(m.permissions) ? t(`user.templates.${templateOf(m.permissions)}`) : `${t('user.custom')} (${m.permissions.length})`}
              </p>
              {canManage && !isOwner && !isMe && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => (setEditing(m), setPerms(m.permissions))}>{t('user.permissions')}</Button>
                  <Button size="sm" variant="secondary" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetting(m)}>{t('user.resetPassword')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: m._id, body: { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })}>
                    {m.status === 'ACTIVE' ? t('user.suspend') : t('user.activate')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<UserMinus className="h-3.5 w-3.5 text-red-600" />} onClick={() => setRemoving(m)}>{t('user.remove')}</Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('user.add')} size="lg" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('auth.fullName')} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input label={t('auth.email')} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label={t('auth.mobile')} type="tel" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })} />
          <Input label={t('user.temporaryPassword')} required value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} hint={t('auth.passwordHint')} />
        </div>
        <p className="mb-2 mt-5 text-sm font-medium">{t('user.permissions')}</p>
        <PermissionMatrix value={newPerms} onChange={setNewPerms} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${t('user.permissions')} · ${editing?.user.fullName ?? ''}`} size="lg" footer={<Button loading={update.isPending} onClick={() => update.mutate({ id: editing!._id, body: { permissions: perms } })}>{t('common.save')}</Button>}>
        <PermissionMatrix value={perms} onChange={setPerms} />
      </Modal>
      <Modal open={!!resetting} onClose={() => setResetting(null)} title={t('user.resetPassword')} size="sm" footer={<Button loading={reset.isPending} onClick={() => reset.mutate()}>{t('common.save')}</Button>}>
        <Input label={t('user.temporaryPassword')} value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} hint={t('auth.passwordHint')} />
      </Modal>
      <ConfirmDialog open={!!removing} title={t('user.remove')} message={t('user.removeConfirm', { name: removing?.user.fullName })} loading={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => remove.mutate(removing!._id)} />
    </div>
  );
}

/* ═════════════ Notifications ═════════════ */

export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlState({ category: '', page: '1' });
  const page = Number(filters.page);
  const q = useQuery({ queryKey: ['notifications', filters], queryFn: () => notificationApi.list({ category: filters.category, page, limit: 25 }), placeholderData: (p) => p });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const open = async (id: string, link?: string, read?: boolean) => {
    if (!read) await notificationApi.read(id).catch(() => undefined);
    refresh();
    if (link) navigate(link.replace(/^\/followups\/.+$/, '/followups').replace(/^\/matches\/.+$/, '/matches'));
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title={t('notification.title')} actions={<Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void notificationApi.readAll(filters.category || undefined).then(refresh)}>{t('notification.markAllRead')}</Button>} />
      <Tabs
        value={filters.category || 'all'}
        onChange={(v) => setFilters({ category: v === 'all' ? '' : v, page: '1' })}
        tabs={['all', 'FOLLOWUP', 'MATCH', 'PROPERTY', 'SYSTEM'].map((c) => ({ value: c, label: t(`notification.tabs.${c}`) }))}
      />
      <Card className="mt-4" bodyClassName="!py-0">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : !q.data!.items.length ? (
          <EmptyState title={t('notification.empty')} icon={<Bell className="h-6 w-6" />} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((n) => (
                <li key={n._id}>
                  <button className="flex w-full items-start gap-3 py-3 text-start" onClick={() => void open(n._id, n.deepLink, !!n.readAt)}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} />
                    <span className="flex-1">
                      <span className={`block text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span>
                      <span className="block text-sm text-muted">{n.body}</span>
                    </span>
                    <span className="text-xs text-muted">{relativeTime(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} limit={25} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ═════════════ Audit log ═════════════ */

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useUrlState({ entityType: '', page: '1' });
  const page = Number(filters.page);
  const q = useQuery({ queryKey: ['audit', filters], queryFn: () => auditApi.list({ entityType: filters.entityType, page, limit: 30 }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <Card className="mb-4" bodyClassName="grid gap-3 sm:grid-cols-3">
        <Select
          options={['client', 'property', 'owner', 'member', 'business', 'document', 'settings', 'user', 'session'].map((e) => ({ value: e, label: e }))}
          placeholder={`${t('audit.entity')}: ${t('common.all')}`}
          value={filters.entityType}
          onChange={(e) => setFilters({ entityType: e.target.value, page: '1' })}
        />
      </Card>
      <Card bodyClassName="!py-0">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : !q.data!.items.length ? (
          <EmptyState title={t('audit.noEntries')} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((a) => (
                <li key={a._id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{a.actorUserId?.fullName}</span> · <code className="rounded bg-canvas px-1 text-xs">{a.action}</code>{' '}
                      {a.entityLabel && <span className="ltr-nums text-muted">{a.entityLabel}</span>}
                    </span>
                    <span className="text-xs text-muted">{formatDate(a.createdAt, true)}</span>
                  </div>
                  {a.changes.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <thead>
                        <tr className="text-muted">
                          <th className="w-1/4 text-start font-medium">{t('audit.changes')}</th>
                          <th className="text-start font-medium">{t('audit.old')}</th>
                          <th className="text-start font-medium">{t('audit.new')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.changes.map((c) => (
                          <tr key={c.field}>
                            <td className="py-0.5">{c.field}</td>
                            <td className="ltr-nums break-all py-0.5 text-red-600">{show(c.oldValue)}</td>
                            <td className="ltr-nums break-all py-0.5 text-emerald-600">{show(c.newValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} limit={30} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ═════════════ Settings ═════════════ */

type SettingsTab = 'profile' | 'business' | 'categories' | 'matching' | 'security' | 'appearance' | 'about';

function ProfileSettings() {
  const { t } = useTranslation();
  const onError = useOnError();
  const { user, patchUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [mobileNumber, setMobile] = useState(user?.mobileNumber ?? '');
  const save = useMutation({ mutationFn: () => authApi.updateProfile({ fullName, mobileNumber: mobileNumber || undefined }), onSuccess: (u) => (patchUser(u), toast.success(t('settings.profileSaved'))), onError });
  return (
    <Card>
      <div className="grid max-w-xl gap-3">
        <Input label={t('auth.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input label={t('auth.email')} value={user?.email ?? ''} disabled />
        <Input label={t('auth.mobile')} value={mobileNumber} onChange={(e) => setMobile(e.target.value)} />
        <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>
      </div>
    </Card>
  );
}

function BusinessSettings() {
  const { t } = useTranslation();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.BUSINESS_MANAGE);
  const { business, patchBusiness } = useAuth();
  const units = useEnumOptions('sizeUnit', SIZE_UNITS);
  const [form, setForm] = useState({ name: business?.name ?? '', phone: business?.phone ?? '', email: business?.email ?? '', address: business?.address ?? '', city: business?.city ?? '', timezone: business?.timezone ?? 'Asia/Karachi', currency: business?.currency ?? 'PKR', defaultSizeUnit: business?.defaultSizeUnit ?? 'SQ_YARD' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({ mutationFn: () => businessApi.update(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined]))), onSuccess: (b) => (patchBusiness(b), toast.success(t('settings.businessSaved'))), onError });
  return (
    <Card>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Input label={t('auth.businessName')} value={form.name} onChange={set('name')} disabled={!canManage} wrapperClassName="sm:col-span-2" />
        <Input label={t('common.phone')} value={form.phone} onChange={set('phone')} disabled={!canManage} />
        <Input label={t('common.email')} value={form.email} onChange={set('email')} disabled={!canManage} />
        <Input label={t('common.address')} value={form.address} onChange={set('address')} disabled={!canManage} wrapperClassName="sm:col-span-2" />
        <Input label={t('property.city')} value={form.city} onChange={set('city')} disabled={!canManage} />
        <Input label={t('settings.timezone')} value={form.timezone} onChange={set('timezone')} disabled={!canManage} />
        <Input label={t('settings.currency')} value={form.currency} onChange={set('currency')} disabled={!canManage} />
        <Select label={t('settings.defaultSizeUnit')} options={units} value={form.defaultSizeUnit} onChange={set('defaultSizeUnit')} disabled={!canManage} />
        {canManage && <div><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
      </div>
    </Card>
  );
}

function CategorySettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['categories', 'all'], queryFn: () => categoryApi.list() });
  const [name, setName] = useState('');
  const [nameUr, setNameUr] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });
  const add = useMutation({ mutationFn: () => categoryApi.create({ name, nameUr: nameUr || undefined }), onSuccess: () => (setName(''), setNameUr(''), refresh()), onError });
  const archive = useMutation({ mutationFn: (id: string) => categoryApi.update(id, { archived: true }), onSuccess: refresh, onError });
  if (q.isLoading) return <PageLoader />;
  return (
    <Card>
      {canManage && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Input label={t('settings.categoryName')} value={name} onChange={(e) => setName(e.target.value)} wrapperClassName="w-56" />
          <Input label={t('settings.categoryNameUr')} value={nameUr} onChange={(e) => setNameUr(e.target.value)} wrapperClassName="w-56" dir="rtl" />
          <Button icon={<Plus className="h-4 w-4" />} disabled={name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>{t('settings.addCategory')}</Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {q.data?.map((c) => (
          <li key={c._id} className="flex items-center justify-between py-2.5 text-sm">
            <span>
              {c.name} {c.nameUr && <span className="font-urdu text-muted" dir="rtl">· {c.nameUr}</span>} {c.isSystem && <Badge>{t('settings.builtIn')}</Badge>}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-muted">{t('settings.clientCount', { count: c.clientCount ?? 0 })}</span>
              {canManage && !c.isSystem && <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => archive.mutate(c._id)}>{t('settings.archive')}</Button>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MatchingSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data, draft]);
  const save = useMutation({
    mutationFn: () => settingsApi.update({ matching: draft!.matching, sqftPerUnit: { MARLA: draft!.sqftPerUnit.MARLA }, reminders: draft!.reminders }),
    onSuccess: (s) => (setDraft(s), toast.success(t('settings.matchingSaved')), qc.invalidateQueries({ queryKey: ['matches'] })),
    onError,
  });
  if (!draft) return <PageLoader />;
  const w = draft.matching.weights;
  const total = w.type + w.location + w.budget + w.size + w.purpose;
  const setW = (k: keyof typeof w) => (e: { target: { value: string } }) => setDraft({ ...draft, matching: { ...draft.matching, weights: { ...w, [k]: Number(e.target.value) || 0 } } });
  const labels: Record<keyof typeof w, string> = { type: t('enums.matchReason.TYPE_MATCH'), location: t('enums.matchReason.SOCIETY_MATCH'), budget: t('enums.matchReason.BUDGET_WITHIN'), size: t('enums.matchReason.SIZE_WITHIN'), purpose: t('enums.matchReason.PURPOSE_MATCH') };
  return (
    <Card>
      <p className="mb-2 text-sm font-medium">{t('settings.weights')}</p>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-5">
        {(Object.keys(w) as (keyof typeof w)[]).map((k) => (
          <Input key={k} label={labels[k]} type="number" min={0} max={100} value={w[k]} onChange={setW(k)} disabled={!canManage} />
        ))}
      </div>
      <p className={`mt-1 text-xs ${total === 100 ? 'text-muted' : 'text-red-600'}`}>{t('settings.weightsTotal', { total })}</p>
      <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2">
        <Input label={`${t('settings.storeThreshold')} (%)`} type="number" min={0} max={100} value={draft.matching.storeThreshold} disabled={!canManage} onChange={(e) => setDraft({ ...draft, matching: { ...draft.matching, storeThreshold: Number(e.target.value) } })} />
        <Input label={`${t('settings.notifyThreshold')} (%)`} type="number" min={0} max={100} value={draft.matching.notifyThreshold} disabled={!canManage} onChange={(e) => setDraft({ ...draft, matching: { ...draft.matching, notifyThreshold: Number(e.target.value) } })} />
        <Input label={t('settings.marla')} type="number" min={1} value={draft.sqftPerUnit.MARLA} disabled={!canManage} onChange={(e) => setDraft({ ...draft, sqftPerUnit: { ...draft.sqftPerUnit, MARLA: Number(e.target.value) } })} />
        <Input label={t('settings.reminderDefault')} type="number" min={0} value={draft.reminders.defaultMinutesBefore} disabled={!canManage} onChange={(e) => setDraft({ ...draft, reminders: { defaultMinutesBefore: Number(e.target.value) } })} />
      </div>
      {canManage && <div className="mt-4"><Button disabled={total !== 100} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
    </Card>
  );
}

function SecuritySettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const signOut = useAuth((s) => s.signOut);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions });
  const change = useMutation({ mutationFn: () => authApi.changePassword(current, next), onSuccess: () => (setCurrent(''), setNext(''), toast.success(t('settings.passwordChanged')), qc.invalidateQueries({ queryKey: ['sessions'] })), onError });
  const revoke = useMutation({ mutationFn: authApi.revokeSession, onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }), onError });
  return (
    <div className="space-y-4">
      <Card title={t('auth.changePassword')}>
        <div className="grid max-w-xl gap-3">
          <Input label={t('auth.currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input label={t('auth.newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t('auth.passwordHint')} />
          <div><Button loading={change.isPending} disabled={!current || next.length < 8} onClick={() => change.mutate()}>{t('auth.changePassword')}</Button></div>
        </div>
      </Card>
      <Card title={t('settings.sessions')} actions={<Button size="sm" variant="danger" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => void authApi.logoutAll().then(() => signOut(false))}>{t('settings.signOutAll')}</Button>}>
        <ul className="divide-y divide-line">
          {sessions.data?.map((s) => (
            <li key={s._id} className="flex items-center gap-3 py-2.5 text-sm">
              {s.clientType === 'mobile' ? <Smartphone className="h-5 w-5 text-muted" /> : <Laptop className="h-5 w-5 text-muted" />}
              <span className="flex-1">
                {s.deviceName ?? s.userAgent?.slice(0, 60) ?? s.clientType} {s.current && <Badge color="green">{t('settings.thisDevice')}</Badge>}
                <span className="block text-xs text-muted">
                  <span className="ltr-nums">{s.ip}</span> · {relativeTime(s.lastUsedAt)}
                </span>
              </span>
              {!s.current && <Button size="sm" variant="secondary" onClick={() => revoke.mutate(s._id)}>{t('settings.signOutDevice')}</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  const { theme, setTheme, lang, setLang } = useUi();
  const patchUser = useAuth((s) => s.patchUser);
  const persist = (prefs: Record<string, string>) => void authApi.updateProfile({ preferences: prefs }).then(patchUser).catch(() => undefined);
  return (
    <Card>
      <div className="grid max-w-md gap-4">
        <Select label={t('topbar.language')} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} value={lang} onChange={(e) => (setLang(e.target.value as 'en' | 'ur'), persist({ language: e.target.value }))} />
        <Select label={t('topbar.theme')} options={(['light', 'dark', 'system'] as const).map((v) => ({ value: v, label: t(`topbar.${v}`) }))} value={theme} onChange={(e) => (setTheme(e.target.value as 'light'), persist({ theme: e.target.value }))} />
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('profile');
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <Tabs<SettingsTab>
        value={tab}
        onChange={setTab}
        tabs={(['profile', 'business', 'categories', 'matching', 'security', 'appearance', 'about'] as const).map((v) => ({ value: v, label: t(`settings.${v}`) }))}
      />
      <div className="mt-4">
        {tab === 'profile' && <ProfileSettings />}
        {tab === 'business' && <BusinessSettings />}
        {tab === 'categories' && <CategorySettings />}
        {tab === 'matching' && <MatchingSettings />}
        {tab === 'security' && <SecuritySettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'about' && (
          <Card>
            <BrandLogo className="h-10 w-auto" />
            <p className="mt-3 font-semibold">{t('app.tagline')}</p>
            <p className="text-sm text-muted">{t('app.description')} · {t('settings.version', { version: '1.0.0' })}</p>
            <p className="mt-3 max-w-xl text-sm">{t('settings.aboutText')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
