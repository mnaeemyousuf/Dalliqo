import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, LayoutGrid, Mail, MessageCircle, MessageSquare, Pencil, Phone, Plus, Rows3, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CLIENT_PURPOSES, CLIENT_SOURCES, CLIENT_STATUSES, PERMISSIONS, PRIORITIES, PROPERTY_TYPES, SIZE_UNITS } from '@recrm/shared';
import { toApiError } from '@/api/client';
import { clientApi } from '@/api/endpoints';
import type { Client, Requirement } from '@/api/types';
import { ClientCard, ContactActions, MatchCard, PriorityBadge } from '@/components/domain';
import { ActivityPanel, DocumentsPanel, FollowUpForm, FollowUpsPanel, NotesPanel } from '@/components/domain/panels';
import { Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Input, PageHeader, PageLoader, Pagination, Select, Tabs, Textarea, type Column } from '@/components/ui';
import { formatDate, formatRange, mailHref, smsHref, splitList, telHref, waHref } from '@/lib/format';
import { useCategories, useDebounce, useEnumOptions, useMembers, useOnError, useUrlState } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';

/* ───────────── Form ───────────── */

interface ReqDraft {
  _id?: string;
  purpose: string;
  propertyTypes: string[];
  areas: string;
  societies: string;
  blocks: string;
  minSize: string;
  maxSize: string;
  sizeUnit: string;
  minBudget: string;
  maxBudget: string;
  isPrimary: boolean;
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
const toDraft = (r?: Requirement): ReqDraft => ({
  _id: r?._id,
  purpose: r?.purpose ?? 'PURCHASE',
  propertyTypes: r?.propertyTypes ?? [],
  areas: (r?.areas ?? []).join(', '),
  societies: (r?.societies ?? []).join(', '),
  blocks: (r?.blocks ?? []).join(', '),
  minSize: r?.minSize?.toString() ?? '',
  maxSize: r?.maxSize?.toString() ?? '',
  sizeUnit: r?.sizeUnit ?? 'SQ_YARD',
  minBudget: r?.minBudget?.toString() ?? '',
  maxBudget: r?.maxBudget?.toString() ?? '',
  isPrimary: r?.isPrimary ?? true,
});

function RequirementEditor({ value, onChange, onRemove, index }: { value: ReqDraft; onChange(v: ReqDraft): void; onRemove?(): void; index: number }) {
  const { t } = useTranslation();
  const purposes = useEnumOptions('clientPurpose', CLIENT_PURPOSES);
  const units = useEnumOptions('sizeUnit', SIZE_UNITS);
  const set = (k: keyof ReqDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const toggleType = (type: string) =>
    onChange({ ...value, propertyTypes: value.propertyTypes.includes(type) ? value.propertyTypes.filter((x) => x !== type) : [...value.propertyTypes, type] });
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {t('client.requirement')} {index + 1} {value.isPrimary && <Badge color="blue">{t('client.primary')}</Badge>}
        </p>
        {onRemove && (
          <button type="button" className="btn-ghost !p-1" onClick={onRemove} aria-label={t('common.delete')}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Select label={t('client.purpose')} options={purposes} value={value.purpose} onChange={set('purpose')} />
      <div>
        <p className="label">{t('client.propertyTypes')}</p>
        <div className="flex flex-wrap gap-1.5">
          {PROPERTY_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => toggleType(type)}
              className={`chip border ${value.propertyTypes.includes(type) ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-line text-muted'}`}
            >
              {t(`enums.propertyType.${type}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t('client.preferredSocieties')} value={value.societies} onChange={set('societies')} hint={t('client.commaHint')} placeholder="Gulshan-e-Iqbal, DHA Karachi" />
        <Input label={t('client.preferredAreas')} value={value.areas} onChange={set('areas')} />
        <Input label={t('client.preferredBlocks')} value={value.blocks} onChange={set('blocks')} placeholder="13-D, 10-A" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t('client.minSize')} type="number" min={0} value={value.minSize} onChange={set('minSize')} />
        <Input label={t('client.maxSize')} type="number" min={0} value={value.maxSize} onChange={set('maxSize')} />
        <Select label={t('property.sizeUnit')} options={units} value={value.sizeUnit} onChange={set('sizeUnit')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('client.minBudget')} type="number" min={0} step={1000} value={value.minBudget} onChange={set('minBudget')} />
        <Input label={t('client.maxBudget')} type="number" min={0} step={1000} value={value.maxBudget} onChange={set('maxBudget')} />
      </div>
    </div>
  );
}

export function ClientFormDrawer({ open, onClose, client }: { open: boolean; onClose(): void; client?: Client }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const cats = useCategories();
  const members = useMembers();
  const statuses = useEnumOptions('clientStatus', CLIENT_STATUSES);
  const priorities = useEnumOptions('priority', PRIORITIES);
  const sources = useEnumOptions('source', CLIENT_SOURCES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<{ _id: string; fullName: string; mobileNumber: string; status: string }[]>([]);
  const [form, setForm] = useState({
    fullName: client?.fullName ?? '',
    mobileNumber: client?.mobileNumber ?? '',
    whatsappNumber: client?.whatsappNumber ?? '',
    alternateNumber: client?.alternateNumber ?? '',
    email: client?.email ?? '',
    address: client?.address ?? '',
    categoryId: client?.categoryId ?? '',
    status: client?.status ?? 'ACTIVE',
    priority: client?.priority ?? 'MEDIUM',
    source: client?.source ?? '',
    assignedTo: client?.assignedTo ?? '',
    notes: client?.notes ?? '',
  });
  const [reqs, setReqs] = useState<ReqDraft[]>(client?.requirements.length ? client.requirements.map(toDraft) : [toDraft()]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (allowDuplicate: boolean = false) => {
      const body = {
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? undefined : v])),
        requirements: reqs.map((r, i) => ({
          ...(r._id ? { _id: r._id } : {}),
          isPrimary: i === 0,
          purpose: r.purpose,
          propertyTypes: r.propertyTypes,
          areas: splitList(r.areas),
          societies: splitList(r.societies),
          blocks: splitList(r.blocks),
          minSize: num(r.minSize),
          maxSize: num(r.maxSize),
          sizeUnit: r.minSize || r.maxSize ? r.sizeUnit : undefined,
          minBudget: num(r.minBudget),
          maxBudget: num(r.maxBudget),
        })),
      };
      return client ? clientApi.update(client._id, { ...body, baseVersion: client.version }) : clientApi.create(body);
    },
    onSuccess: (saved) => {
      toast.success(client ? t('client.updated') : t('client.created'));
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['client', saved._id] });
      setDuplicates([]);
      onClose();
      if (!client) navigate(`/clients/${saved._id}`);
    },
    onError: (e) => {
      const err = toApiError(e);
      // A phone-number clash isn't an error to toast: show who already has the number.
      if (err.code === 'CLIENT_DUPLICATE') {
        setDuplicates((err.details as { duplicates?: typeof duplicates } | undefined)?.duplicates ?? []);
        return;
      }
      setErrors(onError(e));
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={client ? t('client.edit') : t('client.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(false)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {duplicates.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">{t('client.duplicateTitle')}</p>
          <p className="mt-1">{t('client.duplicateHint')}</p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((d) => (
              <li key={d._id}>
                <Link to={`/clients/${d._id}`} className="font-medium underline" onClick={onClose}>
                  {d.fullName}
                </Link>{' '}
                <span className="ltr-nums">{d.mobileNumber}</span> · {t(`enums.clientStatus.${d.status}`)}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-3" loading={save.isPending} onClick={() => save.mutate(true)}>
            {t('client.saveAnyway')}
          </Button>
        </div>
      )}
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate(false))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('client.fullName')} required value={form.fullName} onChange={set('fullName')} error={errors.fullName} wrapperClassName="sm:col-span-2" />
          <Input label={t('client.mobile')} type="tel" required value={form.mobileNumber} onChange={set('mobileNumber')} error={errors.mobileNumber} placeholder="0300 1234567" />
          <Input label={t('client.whatsapp')} type="tel" value={form.whatsappNumber} onChange={set('whatsappNumber')} error={errors.whatsappNumber} />
          <Input label={t('client.alternate')} type="tel" value={form.alternateNumber} onChange={set('alternateNumber')} error={errors.alternateNumber} />
          <Input label={t('common.email')} type="email" value={form.email} onChange={set('email')} error={errors.email} />
          <Select label={t('client.category')} placeholder="—" options={cats.options} value={form.categoryId} onChange={set('categoryId')} />
          <Select label={t('common.status')} options={statuses} value={form.status} onChange={set('status')} />
          <Select label={t('client.priority')} options={priorities} value={form.priority} onChange={set('priority')} />
          <Select label={t('client.source')} placeholder="—" options={sources} value={form.source} onChange={set('source')} />
          {members.options.length > 0 && <Select label={t('client.assignedTo')} placeholder={t('client.unassigned')} options={members.options} value={form.assignedTo} onChange={set('assignedTo')} />}
          <Input label={t('common.address')} value={form.address} onChange={set('address')} wrapperClassName="sm:col-span-2" />
        </div>
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t('client.requirements')}</p>
          {reqs.map((r, i) => (
            <RequirementEditor
              key={i}
              index={i}
              value={{ ...r, isPrimary: i === 0 }}
              onChange={(v) => setReqs((xs) => xs.map((x, j) => (j === i ? v : x)))}
              onRemove={reqs.length > 1 ? () => setReqs((xs) => xs.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setReqs((xs) => [...xs, { ...toDraft(), isPrimary: false }])}>
            {t('client.addRequirement')}
          </Button>
        </div>
        <Textarea label={t('common.notes')} value={form.notes} onChange={set('notes')} />
      </form>
    </Drawer>
  );
}

/* ───────────── List ───────────── */

export function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cats = useCategories();
  const members = useMembers();
  const canCreate = useCan(PERMISSIONS.CLIENTS_CREATE);
  const [filters, setFilters] = useUrlState({ q: '', categoryId: '', status: '', purpose: '', propertyType: '', assignedTo: '', area: '', minBudget: '', maxBudget: '', sort: '-updatedAt', page: '1', view: 'table' });
  const [formOpen, setFormOpen] = useState(false);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const q = useDebounce(filters.q, 300);
  const area = useDebounce(filters.area, 300);
  const page = Number(filters.page);
  const params = { ...filters, q, area, page, limit: 20, view: undefined };
  const query = useQuery({ queryKey: ['clients', params], queryFn: () => clientApi.list(params), placeholderData: (prev) => prev });
  const statuses = useEnumOptions('clientStatus', CLIENT_STATUSES);
  const purposes = useEnumOptions('clientPurpose', CLIENT_PURPOSES);
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  const f = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ [k]: e.target.value, page: '1' } as never);

  const columns: Column<Client>[] = [
    { key: 'name', header: t('common.name'), render: (c) => <span className="font-medium">{c.fullName}</span> },
    { key: 'mobile', header: t('common.mobile'), render: (c) => <span className="ltr-nums">{c.mobileNumber}</span> },
    { key: 'category', header: t('client.category'), render: (c) => cats.name(c.categoryId) ?? '—' },
    { key: 'location', header: t('property.society'), render: (c) => c.preferredSociety ?? c.preferredArea ?? '—' },
    { key: 'budget', header: t('client.budget'), render: (c) => formatRange(c.minBudget, c.maxBudget) },
    { key: 'priority', header: t('client.priority'), render: (c) => <PriorityBadge priority={c.priority} /> },
    { key: 'matches', header: t('nav.matches'), render: (c) => <span className="ltr-nums">{c.matchCount}</span> },
    {
      key: 'contact',
      header: t('common.actions'),
      render: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ContactActions phone={c.mobileNumber} whatsapp={c.whatsappNumber} compact />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('client.title')}
        actions={
          <>
            <div className="flex rounded-lg border border-line">
              <button className={`btn-ghost !rounded-e-none ${filters.view === 'table' ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'table' })} title={t('property.tableView')}>
                <Rows3 className="h-4 w-4" />
              </button>
              <button className={`btn-ghost !rounded-s-none ${filters.view === 'cards' ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'cards' })} title={t('property.gridView')}>
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                {t('client.add')}
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4" bodyClassName="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Input wrapperClassName="md:col-span-2" placeholder={t('client.searchPlaceholder')} value={filters.q} onChange={f('q')} aria-label={t('common.search')} />
        <Select options={cats.options} placeholder={`${t('client.category')}: ${t('common.all')}`} value={filters.categoryId} onChange={f('categoryId')} />
        <Select options={statuses} placeholder={`${t('common.status')}: ${t('common.all')}`} value={filters.status} onChange={f('status')} />
        <Select options={purposes} placeholder={`${t('client.purpose')}: ${t('common.all')}`} value={filters.purpose} onChange={f('purpose')} />
        <Select options={types} placeholder={`${t('common.type')}: ${t('common.all')}`} value={filters.propertyType} onChange={f('propertyType')} />
        <Input placeholder={t('property.area')} value={filters.area} onChange={f('area')} />
        <Input type="number" placeholder={t('client.minBudget')} value={filters.minBudget} onChange={f('minBudget')} />
        <Input type="number" placeholder={t('client.maxBudget')} value={filters.maxBudget} onChange={f('maxBudget')} />
        {members.options.length > 0 && <Select options={members.options} placeholder={`${t('client.assignedTo')}: ${t('common.all')}`} value={filters.assignedTo} onChange={f('assignedTo')} />}
        <Select
          options={[
            { value: '-updatedAt', label: t('common.updatedAt') },
            { value: '-createdAt', label: t('common.createdAt') },
            { value: 'fullName', label: t('common.name') },
            { value: '-matchCount', label: t('nav.matches') },
            { value: '-maxBudget', label: t('client.maxBudget') },
          ]}
          value={filters.sort}
          onChange={f('sort')}
          aria-label={t('common.sortBy')}
        />
      </Card>

      {filters.view === 'cards' ? (
        query.isLoading ? (
          <PageLoader />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data!.items.length ? (
          <EmptyState title={t('client.noClients')} hint={t('client.noClientsHint')} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {query.data!.items.map((c) => (
                <ClientCard key={c._id} client={c} categoryName={cats.name(c.categoryId)} onFollowUp={() => setFollowUpFor(c._id)} />
              ))}
            </div>
            <Pagination page={page} totalPages={query.data!.meta.totalPages} total={query.data!.meta.total} limit={20} onChange={(p) => setFilters({ page: String(p) })} />
          </>
        )
      ) : (
        <Card bodyClassName="!p-0">
          <DataTable
            columns={columns}
            query={query}
            page={page}
            onPage={(p) => setFilters({ page: String(p) })}
            onRowClick={(c) => navigate(`/clients/${c._id}`)}
            empty={<EmptyState title={t('client.noClients')} hint={t('client.noClientsHint')} action={canCreate && <Button onClick={() => setFormOpen(true)}>{t('client.add')}</Button>} />}
          />
        </Card>
      )}
      {formOpen && <ClientFormDrawer open onClose={() => setFormOpen(false)} />}
      {followUpFor && <FollowUpForm open onClose={() => setFollowUpFor(null)} clientId={followUpFor} />}
    </div>
  );
}

/* ───────────── Detail ───────────── */

type ClientTab = 'overview' | 'requirements' | 'matches' | 'followups' | 'notes' | 'documents' | 'activity' | 'communication';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

function RequirementSummary({ r }: { r: Requirement }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge color="blue">{t(`enums.clientPurpose.${r.purpose}`)}</Badge>
        {r.isPrimary && <Badge>{t('client.primary')}</Badge>}
        {r.propertyTypes.map((p) => (
          <Badge key={p} color="purple">
            {t(`enums.propertyType.${p}`)}
          </Badge>
        ))}
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Info label={t('client.preferredSocieties')}>{[...r.societies, ...r.areas].join(', ')}</Info>
        <Info label={t('client.preferredBlocks')}>{r.blocks.join(', ')}</Info>
        <Info label={t('client.size')}>{r.minSize || r.maxSize ? `${r.minSize ?? '…'} – ${r.maxSize ?? '…'} ${t(`enums.sizeUnit.${r.sizeUnit}`)}` : ''}</Info>
        <Info label={t('client.budget')}>{formatRange(r.minBudget, r.maxBudget)}</Info>
      </dl>
    </div>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const cats = useCategories();
  const members = useMembers();
  const canEdit = useCan(PERMISSIONS.CLIENTS_UPDATE);
  const canDelete = useCan(PERMISSIONS.CLIENTS_DELETE);
  const [tab, setTab] = useState<ClientTab>('overview');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const q = useQuery({ queryKey: ['client', id], queryFn: () => clientApi.get(id) });
  const matches = useQuery({ queryKey: ['matches', 'client', id], queryFn: () => clientApi.matches(id, { limit: 50 }), enabled: tab === 'matches' || tab === 'overview' });
  const contact = useMutation({
    mutationFn: (channel: string) => clientApi.communicate(id, channel),
    onSuccess: () => {
      toast.success(t('client.contactLogged'));
      void qc.invalidateQueries({ queryKey: ['client', id] });
      void qc.invalidateQueries({ queryKey: ['activities', id] });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => clientApi.remove(id),
    onSuccess: () => {
      toast.success(t('client.deletedMsg'));
      void qc.invalidateQueries({ queryKey: ['clients'] });
      navigate('/clients');
    },
    onError,
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const c = q.data!;

  const tabs: { value: ClientTab; label: string; count?: number }[] = [
    { value: 'overview', label: t('client.tabs.overview') },
    { value: 'requirements', label: t('client.tabs.requirements'), count: c.requirements.length },
    { value: 'matches', label: t('client.tabs.matches'), count: c.matchCount },
    { value: 'followups', label: t('client.tabs.followups') },
    { value: 'notes', label: t('client.tabs.notes') },
    { value: 'documents', label: t('client.tabs.documents') },
    { value: 'activity', label: t('client.tabs.activity') },
    { value: 'communication', label: t('client.tabs.communication') },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="ltr-nums">{c.mobileNumber}</span> · {cats.name(c.categoryId) ?? '—'} · <PriorityBadge priority={c.priority} />
            <Badge color={c.status === 'ACTIVE' ? 'green' : 'gray'}>{t(`enums.clientStatus.${c.status}`)}</Badge>
          </span>
        }
        actions={
          <>
            <ContactActions phone={c.mobileNumber} whatsapp={c.whatsappNumber} onContact={(ch) => contact.mutate(ch)} />
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setFollowUp(true)}>
              {t('followup.single')}
            </Button>
            {canEdit && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={t('common.details')} className="lg:col-span-1">
            <dl className="space-y-3">
              <Info label={t('client.whatsapp')}><span className="ltr-nums">{c.whatsappNumber}</span></Info>
              <Info label={t('client.alternate')}><span className="ltr-nums">{c.alternateNumber}</span></Info>
              <Info label={t('common.email')}>{c.email}</Info>
              <Info label={t('common.address')}>{c.address}</Info>
              <Info label={t('client.source')}>{c.source ? t(`enums.source.${c.source}`) : ''}</Info>
              <Info label={t('client.assignedTo')}>{members.name(c.assignedTo) ?? t('client.unassigned')}</Info>
              <Info label={t('client.lastContacted')}>{c.lastContactedAt ? formatDate(c.lastContactedAt, true) : ''}</Info>
              <Info label={t('common.createdAt')}>{formatDate(c.createdAt)}</Info>
              {c.notes && <Info label={t('common.notes')}>{c.notes}</Info>}
            </dl>
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <Card title={t('client.requirements')}>
              <div className="space-y-2">{c.requirements.length ? c.requirements.map((r) => <RequirementSummary key={r._id} r={r} />) : <p className="text-sm text-muted">—</p>}</div>
            </Card>
            <Card title={t('client.matchingProperties', { count: c.matchCount })}>
              {matches.data?.items.length ? (
                <div className="space-y-2">{matches.data.items.slice(0, 5).map((m) => <MatchCard key={m._id} match={m} perspective="client" />)}</div>
              ) : (
                <p className="text-sm text-muted">{t('match.noMatches')}</p>
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === 'requirements' && <div className="space-y-2">{c.requirements.map((r) => <RequirementSummary key={r._id} r={r} />)}</div>}
      {tab === 'matches' &&
        (matches.isLoading ? (
          <PageLoader />
        ) : !matches.data?.items.length ? (
          <EmptyState title={t('match.noMatches')} hint={t('match.noMatchesHint')} />
        ) : (
          <div className="space-y-2">{matches.data.items.map((m) => <MatchCard key={m._id} match={m} perspective="client" />)}</div>
        ))}
      {tab === 'followups' && <FollowUpsPanel clientId={id} />}
      {tab === 'notes' && <Card><NotesPanel entityType="client" entityId={id} /></Card>}
      {tab === 'documents' && <Card><DocumentsPanel entityType="client" entityId={id} /></Card>}
      {tab === 'activity' && <Card><ActivityPanel entityId={id} /></Card>}
      {tab === 'communication' && (
        <Card>
          <p className="mb-4 text-sm text-muted">{t('client.communicationHint')}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <a className="btn-secondary !py-4" href={telHref(c.mobileNumber)} onClick={() => contact.mutate('CALL')}>
              <Phone className="h-5 w-5" /> {t('client.call')}
            </a>
            <a className="btn-secondary !py-4 text-emerald-600" href={waHref(c.whatsappNumber ?? c.mobileNumber, `Assalam o Alaikum ${c.fullName},`)} target="_blank" rel="noreferrer" onClick={() => contact.mutate('WHATSAPP')}>
              <MessageCircle className="h-5 w-5" /> WhatsApp
            </a>
            <a className="btn-secondary !py-4" href={smsHref(c.mobileNumber)} onClick={() => contact.mutate('SMS')}>
              <MessageSquare className="h-5 w-5" /> {t('client.sms')}
            </a>
            <a className={`btn-secondary !py-4 ${c.email ? '' : 'pointer-events-none opacity-50'}`} href={mailHref(c.email)} onClick={() => c.email && contact.mutate('EMAIL')}>
              <Mail className="h-5 w-5" /> {t('common.email')}
            </a>
          </div>
          <div className="mt-6">
            <ActivityPanel entityId={id} />
          </div>
        </Card>
      )}

      {editing && <ClientFormDrawer open client={c} onClose={() => setEditing(false)} />}
      {followUp && <FollowUpForm open onClose={() => setFollowUp(false)} clientId={id} />}
      <ConfirmDialog open={confirmDelete} title={t('common.areYouSure')} message={t('client.deleteConfirm', { name: c.fullName })} loading={remove.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
