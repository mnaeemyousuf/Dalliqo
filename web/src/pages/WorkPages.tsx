import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CLIENT_PURPOSES, CLIENT_STATUSES, DOCUMENT_CATEGORIES, DOCUMENT_ENTITY_TYPES, FOLLOWUP_TYPES, MATCH_STATUSES, PERMISSIONS, PROPERTY_STATUSES, PROPERTY_TYPES } from '@recrm/shared';
import { documentApi, exportApi, followUpApi, matchApi, ownerApi } from '@/api/endpoints';
import type { Owner } from '@/api/types';
import { ContactActions, MatchCard, PropertyStatusBadge, locationLabel, useSizeLabel } from '@/components/domain';
import { ActivityPanel, DocumentsPanel, FollowUpForm, FollowUpItem, NotesPanel, RenameDocumentModal } from '@/components/domain/panels';
import { Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Input, PageHeader, PageLoader, Pagination, Select, Tabs, Textarea, type Column } from '@/components/ui';
import { formatBytes, formatDate, formatPkr } from '@/lib/format';
import { useDebounce, useEnumOptions, useErrorText, useMembers, useOnError, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

/* ═════════════ Owners ═════════════ */

function OwnerFormDrawer({ open, onClose, owner }: { open: boolean; onClose(): void; owner?: Owner }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: owner?.fullName ?? '',
    mobileNumber: owner?.mobileNumber ?? '',
    whatsappNumber: owner?.whatsappNumber ?? '',
    alternateNumber: owner?.alternateNumber ?? '',
    email: owner?.email ?? '',
    address: owner?.address ?? '',
    notes: owner?.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined]));
      return owner ? ownerApi.update(owner._id, { ...body, baseVersion: owner.version }) : ownerApi.create(body);
    },
    onSuccess: (o) => {
      toast.success(owner ? t('owner.updated') : t('owner.created'));
      void qc.invalidateQueries({ queryKey: ['owners'] });
      void qc.invalidateQueries({ queryKey: ['owner', o._id] });
      onClose();
      if (!owner) navigate(`/owners/${o._id}`);
    },
    onError: (e) => setErrors(onError(e)),
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={owner ? t('owner.edit') : t('owner.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <Input label={t('common.name')} required value={form.fullName} onChange={set('fullName')} error={errors.fullName} wrapperClassName="sm:col-span-2" />
        <Input label={t('client.mobile')} type="tel" required value={form.mobileNumber} onChange={set('mobileNumber')} error={errors.mobileNumber} />
        <Input label={t('client.whatsapp')} type="tel" value={form.whatsappNumber} onChange={set('whatsappNumber')} error={errors.whatsappNumber} />
        <Input label={t('client.alternate')} type="tel" value={form.alternateNumber} onChange={set('alternateNumber')} />
        <Input label={t('common.email')} type="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Input label={t('common.address')} value={form.address} onChange={set('address')} wrapperClassName="sm:col-span-2" />
        <Textarea label={t('common.notes')} value={form.notes} onChange={set('notes')} wrapperClassName="sm:col-span-2" />
      </form>
    </Drawer>
  );
}

export function OwnersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreate = useCan(PERMISSIONS.OWNERS_CREATE);
  const [filters, setFilters] = useUrlState({ q: '', sort: '-updatedAt', page: '1' });
  const [formOpen, setFormOpen] = useState(false);
  const q = useDebounce(filters.q, 300);
  const page = Number(filters.page);
  const query = useQuery({ queryKey: ['owners', { ...filters, q }], queryFn: () => ownerApi.list({ q, sort: filters.sort, page, limit: 20 }), placeholderData: (p) => p });
  const columns: Column<Owner>[] = [
    { key: 'name', header: t('common.name'), render: (o) => <span className="font-medium">{o.fullName}</span> },
    { key: 'mobile', header: t('common.mobile'), render: (o) => <span className="ltr-nums">{o.mobileNumber}</span> },
    { key: 'email', header: t('common.email'), render: (o) => o.email ?? '—' },
    { key: 'count', header: t('owner.properties'), render: (o) => <span className="ltr-nums">{o.propertyCount}</span> },
    { key: 'contact', header: t('common.actions'), render: (o) => <div onClick={(e) => e.stopPropagation()}><ContactActions phone={o.mobileNumber} whatsapp={o.whatsappNumber} compact /></div> },
  ];
  return (
    <div>
      <PageHeader title={t('owner.title')} actions={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('owner.add')}</Button>} />
      <Card className="mb-4" bodyClassName="grid gap-3 sm:grid-cols-3">
        <Input wrapperClassName="sm:col-span-2" placeholder={t('owner.searchPlaceholder')} value={filters.q} onChange={(e) => setFilters({ q: e.target.value, page: '1' })} />
        <Select
          options={[
            { value: '-updatedAt', label: t('common.updatedAt') },
            { value: 'fullName', label: t('common.name') },
            { value: '-propertyCount', label: t('owner.properties') },
          ]}
          value={filters.sort}
          onChange={(e) => setFilters({ sort: e.target.value })}
        />
      </Card>
      <Card bodyClassName="!p-0">
        <DataTable columns={columns} query={query} page={page} onPage={(p) => setFilters({ page: String(p) })} onRowClick={(o) => navigate(`/owners/${o._id}`)} empty={<EmptyState title={t('owner.noOwners')} />} />
      </Card>
      {formOpen && <OwnerFormDrawer open onClose={() => setFormOpen(false)} />}
    </div>
  );
}

export function OwnerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const size = useSizeLabel();
  const canEdit = useCan(PERMISSIONS.OWNERS_UPDATE);
  const canDelete = useCan(PERMISSIONS.OWNERS_DELETE);
  const [tab, setTab] = useState<'properties' | 'documents' | 'notes' | 'activity'>('properties');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({ queryKey: ['owner', id], queryFn: () => ownerApi.get(id) });
  const remove = useMutation({
    mutationFn: () => ownerApi.remove(id),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['owners'] }), navigate('/owners')),
    onError: (e) => (onError(e), setConfirmDelete(false)),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const o = q.data!;
  return (
    <div className="space-y-4">
      <PageHeader
        title={o.fullName}
        subtitle={<span className="ltr-nums">{o.mobileNumber}{o.email ? ` · ${o.email}` : ''}</span>}
        actions={
          <>
            <ContactActions phone={o.mobileNumber} whatsapp={o.whatsappNumber} />
            {canEdit && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
            {canDelete && <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
          </>
        }
      />
      {(o.address || o.notes) && (
        <Card>
          <p className="text-sm">{o.address}</p>
          {o.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{o.notes}</p>}
        </Card>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'properties', label: t('owner.properties'), count: o.properties?.length ?? 0 },
          { value: 'documents', label: t('document.title') },
          { value: 'notes', label: t('note.title') },
          { value: 'activity', label: t('activity.title') },
        ]}
      />
      {tab === 'properties' &&
        (o.properties?.length ? (
          <Card bodyClassName="!p-0">
            <ul className="divide-y divide-line">
              {o.properties.map((p) => (
                <li key={p._id}>
                  <Link to={`/properties/${p._id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <span>
                      <span className="ltr-nums font-medium text-brand-600">{p.propertyId}</span> · {size(p.size, p.sizeUnit)} {t(`enums.propertyType.${p.propertyType}`)} · {locationLabel(p)}
                    </span>
                    <span className="flex items-center gap-2">
                      {formatPkr(p.askingPrice)} <PropertyStatusBadge status={p.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title={t('property.noProperties')} />
        ))}
      {tab === 'documents' && <Card><DocumentsPanel entityType="owner" entityId={id} /></Card>}
      {tab === 'notes' && <Card><NotesPanel entityType="owner" entityId={id} /></Card>}
      {tab === 'activity' && <Card><ActivityPanel entityId={id} /></Card>}
      {editing && <OwnerFormDrawer open owner={o} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={confirmDelete} title={t('common.areYouSure')} message={t('owner.deleteConfirm', { name: o.fullName })} loading={remove.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />
    </div>
  );
}

/* ═════════════ Matches ═════════════ */

export function MatchesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.MATCHES_MANAGE);
  const [filters, setFilters] = useUrlState({ minScore: '', band: '', status: '', perspective: 'client', page: '1' });
  const page = Number(filters.page);
  const params = { minScore: filters.minScore, band: filters.band, status: filters.status, page, limit: 20 };
  const q = useQuery({ queryKey: ['matches', params], queryFn: () => matchApi.list(params), placeholderData: (p) => p });
  const statuses = useEnumOptions('matchStatus', MATCH_STATUSES);
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => matchApi.setStatus(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }), onError });
  const recalc = useMutation({ mutationFn: matchApi.recalculate, onSuccess: () => (toast.success(t('match.recalculated')), qc.invalidateQueries({ queryKey: ['matches'] })), onError });
  return (
    <div>
      <PageHeader
        title={t('match.title')}
        actions={canManage && <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={recalc.isPending} onClick={() => recalc.mutate()}>{t('match.recalculate')}</Button>}
      />
      <Card className="mb-4" bodyClassName="grid gap-3 sm:grid-cols-4">
        <Tabs
          value={filters.perspective as 'client' | 'property'}
          onChange={(v) => setFilters({ perspective: v })}
          tabs={[{ value: 'client', label: t('match.clientToProperties') }, { value: 'property', label: t('match.propertyToClients') }]}
        />
        <Select options={['EXCELLENT', 'VERY_GOOD', 'GOOD', 'POSSIBLE'].map((b) => ({ value: b, label: t(`enums.matchBand.${b}`) }))} placeholder={`${t('match.quality')}: ${t('common.all')}`} value={filters.band} onChange={(e) => setFilters({ band: e.target.value, page: '1' })} />
        <Select options={statuses} placeholder={`${t('common.status')}: ${t('common.all')}`} value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })} />
        <Input type="number" min={0} max={100} placeholder={t('match.minScore')} value={filters.minScore} onChange={(e) => setFilters({ minScore: e.target.value, page: '1' })} />
      </Card>
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <EmptyState title={t('match.noMatches')} hint={t('match.noMatchesHint')} />
      ) : (
        <>
          <div className="space-y-2">
            {q.data!.items.map((m) => (
              <div key={m._id}>
                {filters.perspective === 'property' && (
                  <p className="mb-1 text-xs text-muted">
                    <Link to={`/properties/${m.propertyId._id}`} className="ltr-nums hover:underline">{m.propertyId.propertyId}</Link> · {locationLabel(m.propertyId)} · {formatPkr(m.propertyId.askingPrice)}
                  </p>
                )}
                {filters.perspective === 'client' && (
                  <p className="mb-1 text-xs text-muted">
                    <Link to={`/clients/${m.clientId._id}`} className="hover:underline">{m.clientId.fullName}</Link>
                  </p>
                )}
                <MatchCard
                  match={m}
                  perspective={filters.perspective as 'client' | 'property'}
                  actions={
                    canManage && (
                      <select className="input !w-auto !py-1 text-xs" value={m.status} onChange={(e) => setStatus.mutate({ id: m._id, status: e.target.value })} aria-label={t('match.markAs')}>
                        {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} limit={20} onChange={(p) => setFilters({ page: String(p) })} />
        </>
      )}
    </div>
  );
}

/* ═════════════ Follow-ups ═════════════ */

type FuTab = 'today' | 'upcoming' | 'overdue' | 'done';

export function FollowUpsPage() {
  const { t } = useTranslation();
  const me = useAuth((s) => s.user?._id);
  const canCreate = useCan(PERMISSIONS.FOLLOWUPS_CREATE);
  const members = useMembers();
  const types = useEnumOptions('followUpType', FOLLOWUP_TYPES);
  const [filters, setFilters] = useUrlState({ tab: 'today', assignedTo: 'me', type: '', page: '1' });
  const [formOpen, setFormOpen] = useState(false);
  const page = Number(filters.page);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  const byTab: Record<FuTab, Record<string, unknown>> = {
    today: { from: start.toISOString(), to: end.toISOString() },
    upcoming: { from: end.toISOString(), status: 'PENDING' },
    overdue: { status: 'OVERDUE' },
    done: { status: 'COMPLETED' },
  };
  const params = { ...byTab[filters.tab as FuTab], assignedTo: filters.assignedTo === 'all' ? undefined : filters.assignedTo === 'me' ? me : filters.assignedTo, type: filters.type, page, limit: 25 };
  const q = useQuery({ queryKey: ['followups', params], queryFn: () => followUpApi.list(params), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title={t('followup.title')} actions={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('followup.add')}</Button>} />
      <Card className="mb-4" bodyClassName="flex flex-wrap items-end gap-3">
        <Tabs<FuTab>
          value={filters.tab as FuTab}
          onChange={(v) => setFilters({ tab: v, page: '1' })}
          tabs={(['today', 'upcoming', 'overdue', 'done'] as const).map((v) => ({ value: v, label: t(`followup.tabs.${v}`) }))}
        />
        <Select
          wrapperClassName="w-48"
          options={[{ value: 'me', label: t('followup.mine') }, { value: 'all', label: t('followup.everyone') }, ...members.options]}
          value={filters.assignedTo}
          onChange={(e) => setFilters({ assignedTo: e.target.value, page: '1' })}
        />
        <Select wrapperClassName="w-44" options={types} placeholder={`${t('common.type')}: ${t('common.all')}`} value={filters.type} onChange={(e) => setFilters({ type: e.target.value, page: '1' })} />
      </Card>
      <Card bodyClassName="!py-0">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : !q.data!.items.length ? (
          <EmptyState title={t('followup.noFollowUps')} />
        ) : (
          <>
            <ul className="divide-y divide-line">{q.data!.items.map((f) => <FollowUpItem key={f._id} f={f} />)}</ul>
            <Pagination page={page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} limit={25} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )}
      </Card>
      {formOpen && <FollowUpForm open onClose={() => setFormOpen(false)} />}
    </div>
  );
}

/* ═════════════ Documents library ═════════════ */

export function DocumentsPage() {
  const { t } = useTranslation();
  const onError = useOnError();
  const categories = useEnumOptions('documentCategory', DOCUMENT_CATEGORIES);
  const entities = useEnumOptions('entity', DOCUMENT_ENTITY_TYPES);
  const [filters, setFilters] = useUrlState({ entityType: '', category: '', page: '1' });
  const page = Number(filters.page);
  const q = useQuery({ queryKey: ['documents', filters], queryFn: () => documentApi.list({ ...filters, page, limit: 25 }), placeholderData: (p) => p });
  const qc = useQueryClient();
  const canRename = useCan(PERMISSIONS.DOCUMENTS_UPLOAD);
  const [toRename, setToRename] = useState<{ _id: string; fileName: string } | null>(null);
  const open = async (id: string) => {
    try {
      window.open((await documentApi.downloadUrl(id)).url, '_blank', 'noopener');
    } catch (e) {
      onError(e);
    }
  };
  const linkFor = (type: string, id: string) => `/${type === 'property' ? 'properties' : type === 'owner' ? 'owners' : 'clients'}/${id}`;
  return (
    <div>
      <PageHeader title={t('document.title')} subtitle={t('document.chooseRecord')} />
      <Card className="mb-4" bodyClassName="grid gap-3 sm:grid-cols-3">
        <Select options={entities} placeholder={`${t('document.entity')}: ${t('common.all')}`} value={filters.entityType} onChange={(e) => setFilters({ entityType: e.target.value, page: '1' })} />
        <Select options={categories} placeholder={`${t('document.category')}: ${t('common.all')}`} value={filters.category} onChange={(e) => setFilters({ category: e.target.value, page: '1' })} />
      </Card>
      <Card bodyClassName="!py-0">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : !q.data!.items.length ? (
          <EmptyState title={t('document.noDocuments')} icon={<FileText className="h-6 w-6" />} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((d) => (
                <li key={d._id} className="flex flex-wrap items-center gap-3 py-3">
                  <FileText className="h-8 w-8 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.fileName}</p>
                    <p className="text-xs text-muted">
                      <Badge>{t(`enums.documentCategory.${d.category}`)}</Badge> · <Link className="hover:underline" to={linkFor(d.entityType, d.entityId)}>{t(`enums.entity.${d.entityType}`)}</Link> · {formatBytes(d.fileSize)} · {formatDate(d.createdAt)}
                      {typeof d.uploadedBy === 'object' && ` · ${d.uploadedBy.fullName}`}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void open(d._id)}>{t('document.preview')}</Button>
                  {canRename && (
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setToRename(d)}>
                      {t('document.rename')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} limit={25} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )}
      </Card>
      <RenameDocumentModal doc={toRename} onClose={() => setToRename(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ['documents'] })} />
    </div>
  );
}

/* ═════════════ Reports & exports ═════════════ */

export function ReportsPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [resource, setResource] = useState('properties');
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const resources = useEnumOptions('exportResource', ['clients', 'properties', 'owners', 'followups', 'matches']);
  const f = (k: string) => (e: { target: { value: string } }) => setFilters((x) => ({ ...x, [k]: e.target.value }));
  const filterFields: Record<string, React.ReactNode> = {
    properties: (
      <>
        <Select label={t('property.type')} placeholder={t('common.all')} options={useEnumOptions('propertyType', PROPERTY_TYPES)} value={filters.propertyType ?? ''} onChange={f('propertyType')} />
        <Select label={t('common.status')} placeholder={t('common.all')} options={useEnumOptions('propertyStatus', PROPERTY_STATUSES)} value={filters.status ?? ''} onChange={f('status')} />
        <Input label={t('property.society')} value={filters.society ?? ''} onChange={f('society')} />
        <Input label={t('property.minPrice')} type="number" value={filters.minPrice ?? ''} onChange={f('minPrice')} />
        <Input label={t('property.maxPrice')} type="number" value={filters.maxPrice ?? ''} onChange={f('maxPrice')} />
      </>
    ),
    clients: (
      <>
        <Select label={t('common.status')} placeholder={t('common.all')} options={useEnumOptions('clientStatus', CLIENT_STATUSES)} value={filters.status ?? ''} onChange={f('status')} />
        <Select label={t('client.purpose')} placeholder={t('common.all')} options={useEnumOptions('clientPurpose', CLIENT_PURPOSES)} value={filters.purpose ?? ''} onChange={f('purpose')} />
        <Input label={t('property.area')} value={filters.area ?? ''} onChange={f('area')} />
      </>
    ),
    owners: <Input label={t('common.search')} value={filters.q ?? ''} onChange={f('q')} />,
    followups: (
      <>
        <Select label={t('common.status')} placeholder={t('common.all')} options={useEnumOptions('followUpStatus', ['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE'])} value={filters.status ?? ''} onChange={f('status')} />
        <Input label={t('common.from')} type="date" value={filters.from ?? ''} onChange={f('from')} />
        <Input label={t('common.to')} type="date" value={filters.to ?? ''} onChange={f('to')} />
      </>
    ),
    matches: <Input label={t('match.minScore')} type="number" value={filters.minScore ?? ''} onChange={f('minScore')} />,
  };
  const download = async () => {
    setBusy(true);
    try {
      await exportApi.download(resource, format, filters);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title={t('report.title')} subtitle={t('report.subtitle')} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('report.resource')} options={resources} value={resource} onChange={(e) => (setResource(e.target.value), setFilters({}))} />
          <div>
            <p className="label">{t('report.format')}</p>
            <div className="flex gap-2">
              <button className={`btn-secondary flex-1 ${format === 'xlsx' ? '!border-brand-600 text-brand-600' : ''}`} onClick={() => setFormat('xlsx')}>
                <FileSpreadsheet className="h-4 w-4" /> {t('report.excel')}
              </button>
              <button className={`btn-secondary flex-1 ${format === 'pdf' ? '!border-brand-600 text-brand-600' : ''}`} onClick={() => setFormat('pdf')}>
                <FileText className="h-4 w-4" /> {t('report.pdf')}
              </button>
            </div>
          </div>
        </div>
        <p className="mb-2 mt-5 text-sm font-medium">{t('report.filtersHint')}</p>
        <div className="grid gap-3 sm:grid-cols-3">{filterFields[resource]}</div>
        <div className="mt-6 flex justify-end">
          <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={() => void download()}>
            {busy ? t('report.generating') : t('report.generate')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
