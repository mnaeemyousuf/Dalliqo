import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Copy, FileSignature, FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AGREEMENT_DISCLAIMER,
  AGREEMENT_KINDS,
  AGREEMENT_LANGUAGES,
  AGREEMENT_PLACEHOLDERS,
  AGREEMENT_STATUSES,
  AGREEMENT_TRANSITIONS,
  PERMISSIONS,
  isAgreementLocked,
  type AgreementKind,
  type AgreementLanguage,
  type AgreementStatus,
} from '@recrm/shared';
import { agreementApi, clientApi, documentApi, ownerApi, propertyApi } from '@/api/endpoints';
import type { Agreement, AgreementTemplate } from '@/api/types';
import { BranchField } from '@/components/branches';
import { ActivityPanel, DocumentsPanel, NotesPanel } from '@/components/domain/panels';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Table, Tabs, Textarea, type BadgeColor, type Column } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useDebounce, useEnumOptions, useErrorText, useOnError, useUrlState, useOpenOnNew } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const refId = (v: unknown) => (v && typeof v === 'object' ? String((v as { _id: string })._id) : v ? String(v) : '');
const refName = (v: unknown, key = 'fullName') => (v && typeof v === 'object' ? String((v as Record<string, unknown>)[key] ?? '') : '');

const STATUS_COLOR: Record<AgreementStatus, BadgeColor> = { DRAFT: 'gray', SENT: 'blue', SIGNED: 'green', EXPIRED: 'amber', CANCELLED: 'red' };

export function AgreementStatusBadge({ status }: { status: AgreementStatus }) {
  const { t } = useTranslation();
  return <Badge color={STATUS_COLOR[status]}>{t(`enums.agreementStatus.${status}`)}</Badge>;
}

/** The lawyer-review note, shown on every agreement screen (also printed in every PDF). */
export function LawyerNote() {
  const { i18n } = useTranslation();
  return (
    <div role="note" className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{i18n.language === 'ur' ? AGREEMENT_DISCLAIMER.ur : AGREEMENT_DISCLAIMER.en}</p>
    </div>
  );
}

/* ═════════════ Form ═════════════ */

export function AgreementFormDrawer({ onClose, agreement, defaults }: { onClose(): void; agreement?: Agreement; defaults?: Partial<Record<'dealId' | 'clientId' | 'propertyId' | 'ownerId' | 'kind', string>> & { amount?: number } }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const kinds = useEnumOptions('agreementKind', AGREEMENT_KINDS);
  const langs = AGREEMENT_LANGUAGES.map((l) => ({ value: l, label: l === 'ur' ? 'اردو' : 'English' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientSearch, setClientSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const clients = useQuery({ queryKey: ['clients', 'pick', useDebounce(clientSearch, 250)], queryFn: () => clientApi.list({ q: clientSearch, limit: 30 }) });
  const properties = useQuery({ queryKey: ['properties', 'pick', useDebounce(propertySearch, 250)], queryFn: () => propertyApi.list({ q: propertySearch, limit: 30 }) });
  const owners = useQuery({ queryKey: ['owners', 'pick'], queryFn: () => ownerApi.list({ limit: 100 }) });
  const d = (v?: string | null) => (v ? v.slice(0, 10) : '');
  const [form, setForm] = useState({
    branchId: agreement?.branchId ?? '',
    kind: (agreement?.kind ?? defaults?.kind ?? 'SALE') as AgreementKind,
    language: (agreement?.language ?? (i18n.language === 'ur' ? 'ur' : 'en')) as AgreementLanguage,
    templateId: refId(agreement?.templateId),
    title: agreement?.title ?? '',
    clientId: refId(agreement?.clientId) || defaults?.clientId || '',
    propertyId: refId(agreement?.propertyId) || defaults?.propertyId || '',
    ownerId: refId(agreement?.ownerId) || defaults?.ownerId || '',
    amount: agreement?.amount?.toString() ?? defaults?.amount?.toString() ?? '',
    tokenAmount: agreement?.tokenAmount?.toString() ?? '',
    monthlyRent: agreement?.monthlyRent?.toString() ?? '',
    securityDeposit: agreement?.securityDeposit?.toString() ?? '',
    startDate: d(agreement?.startDate),
    endDate: d(agreement?.endDate),
    clientCnic: agreement?.clientCnic ?? '',
    ownerCnic: agreement?.ownerCnic ?? '',
    witness1: agreement?.witness1 ?? '',
    witness2: agreement?.witness2 ?? '',
    notes: agreement?.notes ?? '',
  });
  const templates = useQuery({ queryKey: ['agreementTemplates', form.kind, form.language], queryFn: () => agreementApi.templates({ kind: form.kind, language: form.language }) });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const rent = form.kind === 'RENT';
  const num = (v: string) => (v.trim() === '' ? (agreement ? null : undefined) : Number(v));
  const date = (v: string) => (v ? new Date(v).toISOString() : agreement ? null : undefined);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        ...(form.branchId ? { branchId: form.branchId } : {}),
        kind: form.kind,
        language: form.language,
        templateId: form.templateId || (agreement ? null : undefined),
        title: form.title || undefined,
        clientId: form.clientId,
        propertyId: form.propertyId || (agreement ? null : undefined),
        ownerId: form.ownerId || (agreement ? null : undefined),
        amount: num(form.amount),
        tokenAmount: num(form.tokenAmount),
        monthlyRent: num(form.monthlyRent),
        securityDeposit: num(form.securityDeposit),
        startDate: date(form.startDate),
        endDate: date(form.endDate),
        clientCnic: form.clientCnic || undefined,
        ownerCnic: form.ownerCnic || undefined,
        witness1: form.witness1 || undefined,
        witness2: form.witness2 || undefined,
        notes: form.notes || undefined,
        ...(!agreement && defaults?.dealId ? { dealId: defaults.dealId } : {}),
      };
      return agreement ? agreementApi.update(agreement._id, { ...body, baseVersion: agreement.version }) : agreementApi.create({ ...body, uuid: crypto.randomUUID() });
    },
    onSuccess: (a) => {
      toast.success(agreement ? t('agreement.updated') : t('agreement.created'));
      void qc.invalidateQueries({ queryKey: ['agreements'] });
      void qc.invalidateQueries({ queryKey: ['agreement', a._id] });
      onClose();
      if (!agreement) navigate(`/agreements/${a._id}`);
    },
    onError: (e) => setErrors(onError(e)),
  });
  const clientOptions = [
    ...(clients.data?.items ?? []).map((c) => ({ value: c._id, label: `${c.fullName} · ${c.mobileNumber}` })),
    ...(agreement && !clients.data?.items.some((c) => c._id === form.clientId) && form.clientId ? [{ value: form.clientId, label: refName(agreement.clientId) }] : []),
  ];
  const propertyOptions = [
    ...(properties.data?.items ?? []).map((p) => ({ value: p._id, label: `${p.propertyId} · ${[p.block, p.society].filter(Boolean).join(', ')}` })),
    ...(agreement?.propertyId && !properties.data?.items.some((p) => p._id === form.propertyId) && form.propertyId ? [{ value: form.propertyId, label: refName(agreement.propertyId, 'propertyId') }] : []),
  ];
  return (
    <Drawer
      open
      onClose={onClose}
      title={agreement ? t('agreement.edit') : t('agreement.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} disabled={!form.clientId} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <LawyerNote />
        <BranchField value={form.branchId} onChange={(v) => setForm((f) => ({ ...f, branchId: v }))} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('agreement.kind')} options={kinds} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as AgreementKind, templateId: '' }))} />
          <Select label={t('agreement.language')} options={langs} value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value as AgreementLanguage, templateId: '' }))} />
          <Select label={t('agreement.template')} placeholder={t('agreement.defaultTemplate')} options={(templates.data ?? []).map((x) => ({ value: x._id, label: x.name }))} value={form.templateId} onChange={set('templateId')} />
        </div>
        <Input label={t('agreement.titleField')} value={form.title} onChange={set('title')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input label={rent ? t('agreement.tenant') : t('agreement.buyer')} placeholder={t('common.search')} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
            <Select aria-label={t('deal.client')} placeholder="—" options={clientOptions} value={form.clientId} onChange={set('clientId')} error={errors.clientId} />
          </div>
          <div>
            <Input label={t('deal.property')} placeholder={t('common.search')} value={propertySearch} onChange={(e) => setPropertySearch(e.target.value)} />
            <Select aria-label={t('deal.property')} placeholder="—" options={propertyOptions} value={form.propertyId} onChange={set('propertyId')} />
          </div>
          <Select label={rent ? t('agreement.landlord') : t('agreement.seller')} placeholder={t('agreement.propertyOwner')} options={(owners.data?.items ?? []).map((o) => ({ value: o._id, label: o.fullName }))} value={form.ownerId} onChange={set('ownerId')} />
          <div />
          <Input label={t('agreement.clientCnic')} value={form.clientCnic} onChange={set('clientCnic')} placeholder="42101-1234567-1" error={errors.clientCnic} />
          <Input label={t('agreement.ownerCnic')} value={form.ownerCnic} onChange={set('ownerCnic')} placeholder="42101-1234567-1" error={errors.ownerCnic} />
          {rent ? (
            <>
              <Input label={t('agreement.monthlyRent')} type="number" min={0} value={form.monthlyRent} onChange={set('monthlyRent')} />
              <Input label={t('agreement.securityDeposit')} type="number" min={0} value={form.securityDeposit} onChange={set('securityDeposit')} />
            </>
          ) : (
            <>
              <Input label={t('agreement.amount')} type="number" min={0} value={form.amount} onChange={set('amount')} />
              <Input label={t('agreement.tokenAmount')} type="number" min={0} value={form.tokenAmount} onChange={set('tokenAmount')} />
            </>
          )}
          <Input label={rent ? t('agreement.startDate') : t('agreement.agreementDate')} type="date" value={form.startDate} onChange={set('startDate')} />
          <Input label={rent ? t('agreement.endDate') : t('agreement.transferBy')} type="date" value={form.endDate} onChange={set('endDate')} error={errors.endDate} />
          <Input label={t('agreement.witness1')} value={form.witness1} onChange={set('witness1')} />
          <Input label={t('agreement.witness2')} value={form.witness2} onChange={set('witness2')} />
        </div>
        {rent && <p className="text-xs text-muted">{t('agreement.renewalHint')}</p>}
        <Textarea label={t('common.notes')} value={form.notes} onChange={set('notes')} />
      </form>
    </Drawer>
  );
}

/* ═════════════ List ═════════════ */

export function AgreementsPage() {
  const { t } = useTranslation();
  const canCreate = useCan(PERMISSIONS.AGREEMENTS_CREATE);
  const canTemplates = useCan(PERMISSIONS.TEMPLATES_MANAGE);
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlState({ q: '', status: '', kind: '', expiring: '', page: '1' });
  const q = useDebounce(filters.q, 300);
  const params = { q, status: filters.status, kind: filters.kind, ...(filters.expiring ? { expiringWithinDays: 30 } : {}), page: Number(filters.page), limit: 20 };
  const list = useQuery({ queryKey: ['agreements', params], queryFn: () => agreementApi.list(params), placeholderData: (p) => p });
  const [formOpen, setFormOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  useOpenOnNew(() => setFormOpen(true));
  const f = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ [k]: e.target.value, page: '1' } as never);
  const columns: Column<Agreement>[] = [
    { key: 'no', header: t('agreement.no'), render: (a) => <span className="ltr-nums font-medium">{a.agreementNo}</span> },
    { key: 'kind', header: t('agreement.kind'), render: (a) => <>{t(`enums.agreementKind.${a.kind}`)} <span className="text-xs text-muted">{a.language.toUpperCase()}</span></> },
    { key: 'client', header: t('deal.client'), render: (a) => refName(a.clientId) || '—' },
    { key: 'property', header: t('deal.property'), render: (a) => <span className="ltr-nums">{refName(a.propertyId, 'propertyId') || '—'}</span> },
    { key: 'amount', header: t('finance.amount'), render: (a) => <span className="ltr-nums">{a.kind === 'RENT' ? (a.monthlyRent ? `${formatPkr(a.monthlyRent)}/${t('agreement.month')}` : '—') : a.amount ? formatPkr(a.amount) : '—'}</span> },
    { key: 'end', header: t('agreement.endDate'), render: (a) => <span className="ltr-nums">{a.endDate ? formatDate(a.endDate) : '—'}</span> },
    { key: 'status', header: t('common.status'), render: (a) => <AgreementStatusBadge status={a.status} /> },
  ];
  return (
    <div>
      <PageHeader
        title={t('agreement.title')}
        subtitle={t('agreement.subtitle')}
        actions={
          <>
            {canTemplates && <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => setTemplatesOpen(true)}>{t('agreement.templates')}</Button>}
            {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('agreement.add')}</Button>}
          </>
        }
      />
      <LawyerNote />
      <Card className="mb-4" bodyClassName="grid gap-3 md:grid-cols-4">
        <Input placeholder={t('agreement.searchPlaceholder')} value={filters.q} onChange={f('q')} aria-label={t('common.search')} />
        <Select options={useEnumOptions('agreementStatus', AGREEMENT_STATUSES)} placeholder={`${t('common.status')}: ${t('common.all')}`} value={filters.status} onChange={f('status')} />
        <Select options={useEnumOptions('agreementKind', AGREEMENT_KINDS)} placeholder={`${t('agreement.kind')}: ${t('common.all')}`} value={filters.kind} onChange={f('kind')} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!filters.expiring} onChange={(e) => setFilters({ expiring: e.target.checked ? '1' : '', page: '1' })} />
          {t('agreement.expiringSoon')}
        </label>
      </Card>
      {list.isLoading ? (
        <PageLoader />
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : !list.data!.items.length ? (
        <EmptyState title={t('agreement.empty')} hint={t('agreement.emptyHint')} icon={<FileSignature className="h-6 w-6" />} action={canCreate ? <Button onClick={() => setFormOpen(true)}>{t('agreement.add')}</Button> : undefined} />
      ) : (
        <>
          <Card bodyClassName="!p-0">
            <Table columns={columns} rows={list.data!.items} onRowClick={(a) => navigate(`/agreements/${a._id}`)} />
          </Card>
          <Pagination page={Number(filters.page)} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} limit={20} onChange={(p) => setFilters({ page: String(p) })} />
        </>
      )}
      {formOpen && <AgreementFormDrawer onClose={() => setFormOpen(false)} />}
      {templatesOpen && <TemplatesModal onClose={() => setTemplatesOpen(false)} />}
    </div>
  );
}

/* ═════════════ Detail ═════════════ */

export function AgreementDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const errorText = useErrorText();
  const canUpdate = useCan(PERMISSIONS.AGREEMENTS_UPDATE);
  const canDelete = useCan(PERMISSIONS.AGREEMENTS_DELETE);
  const q = useQuery({ queryKey: ['agreement', id], queryFn: () => agreementApi.get(id) });
  const [tab, setTab] = useState('text');
  const [versionNo, setVersionNo] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [textEdit, setTextEdit] = useState<string | null>(null);
  const [statusTo, setStatusTo] = useState<AgreementStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [signedDoc, setSignedDoc] = useState('');
  const [removing, setRemoving] = useState(false);
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['agreement', id] }), void qc.invalidateQueries({ queryKey: ['agreements'] }));
  const render = useMutation({ mutationFn: () => agreementApi.render(id), onSuccess: () => (toast.success(t('agreement.rendered')), setVersionNo(null), refresh()), onError });
  const saveText = useMutation({ mutationFn: (body: string) => agreementApi.addVersion(id, body), onSuccess: () => (toast.success(t('agreement.versionSaved')), setTextEdit(null), setVersionNo(null), refresh()), onError });
  const status = useMutation({
    mutationFn: () => agreementApi.status(id, { status: statusTo, note: statusNote || undefined, signedDocumentId: signedDoc || undefined }),
    onSuccess: () => (toast.success(t('agreement.statusChanged')), setStatusTo(null), setStatusNote(''), setSignedDoc(''), refresh()),
    onError,
  });
  const remove = useMutation({ mutationFn: () => agreementApi.remove(id), onSuccess: () => (toast.success(t('agreement.deleted')), navigate('/agreements')), onError });
  const docs = useQuery({ queryKey: ['documents', 'agreement', id], queryFn: () => documentApi.list({ entityType: 'agreement', entityId: id, limit: 50 }), enabled: statusTo === 'SIGNED' });
  const [busyPdf, setBusyPdf] = useState(false);
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const a = q.data;
  const locked = isAgreementLocked(a.status);
  const version = (versionNo ? a.versions.find((v) => v.no === versionNo) : a.versions.at(-1)) ?? null;
  const openPdf = async () => {
    setBusyPdf(true);
    try {
      await agreementApi.openPdf(a._id, version?.no);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusyPdf(false);
    }
  };
  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="ltr-nums">{a.agreementNo}</span> <AgreementStatusBadge status={a.status} /></span>}
        subtitle={[t(`enums.agreementKind.${a.kind}`), a.language === 'ur' ? 'اردو' : 'English', a.title].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={busyPdf} disabled={!version} onClick={() => void openPdf()}>{t('agreement.pdf')}</Button>
            {canUpdate && !locked && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
            {canDelete && a.status !== 'SIGNED' && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
          </>
        }
      />
      <LawyerNote />
      <Card className="mb-4" bodyClassName="grid gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-muted">{a.kind === 'RENT' ? t('agreement.tenant') : t('agreement.buyer')}</p>{a.clientId && typeof a.clientId === 'object' ? <Link className="hover:underline" to={`/clients/${a.clientId._id}`}>{a.clientId.fullName}</Link> : '—'}</div>
        <div><p className="text-xs text-muted">{a.kind === 'RENT' ? t('agreement.landlord') : t('agreement.seller')}</p>{refName(a.ownerId) || '—'}</div>
        <div><p className="text-xs text-muted">{t('deal.property')}</p>{a.propertyId && typeof a.propertyId === 'object' ? <Link className="ltr-nums hover:underline" to={`/properties/${a.propertyId._id}`}>{a.propertyId.propertyId}</Link> : '—'}</div>
        <div><p className="text-xs text-muted">{t('enums.entity.deal')}</p>{a.dealId && typeof a.dealId === 'object' ? <Link className="ltr-nums hover:underline" to={`/deals/${a.dealId._id}`}>{a.dealId.dealNo}</Link> : '—'}</div>
        {a.kind === 'RENT' ? (
          <>
            <div><p className="text-xs text-muted">{t('agreement.monthlyRent')}</p><span className="ltr-nums">{a.monthlyRent ? formatPkr(a.monthlyRent) : '—'}</span></div>
            <div><p className="text-xs text-muted">{t('agreement.securityDeposit')}</p><span className="ltr-nums">{a.securityDeposit ? formatPkr(a.securityDeposit) : '—'}</span></div>
          </>
        ) : (
          <>
            <div><p className="text-xs text-muted">{t('agreement.amount')}</p><span className="ltr-nums">{a.amount ? formatPkr(a.amount) : '—'}</span></div>
            <div><p className="text-xs text-muted">{t('agreement.tokenAmount')}</p><span className="ltr-nums">{a.tokenAmount ? formatPkr(a.tokenAmount) : '—'}</span></div>
          </>
        )}
        <div><p className="text-xs text-muted">{a.kind === 'RENT' ? t('agreement.startDate') : t('agreement.agreementDate')}</p><span className="ltr-nums">{a.startDate ? formatDate(a.startDate) : '—'}</span></div>
        <div><p className="text-xs text-muted">{a.kind === 'RENT' ? t('agreement.endDate') : t('agreement.transferBy')}</p><span className="ltr-nums">{a.endDate ? formatDate(a.endDate) : '—'}</span></div>
        {a.kind === 'RENT' && a.renewalFollowUpIds.length > 0 && <p className="text-xs text-muted sm:col-span-4">{t('agreement.renewalsPlanned', { count: a.renewalFollowUpIds.length })}</p>}
      </Card>
      {canUpdate && AGREEMENT_TRANSITIONS[a.status].length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {AGREEMENT_TRANSITIONS[a.status].map((s) => (
            <Button key={s} size="sm" variant={s === 'CANCELLED' ? 'ghost' : 'secondary'} onClick={() => setStatusTo(s)}>{t(`agreement.to.${s}`)}</Button>
          ))}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'text', label: t('agreement.text'), count: a.versions.length },
          { value: 'documents', label: t('agreement.signedCopy') },
          { value: 'notes', label: t('note.title') },
          { value: 'activity', label: t('activity.title') },
        ]}
      />
      <div className="mt-4">
        {tab === 'text' && (
          <Card
            title={version ? t('agreement.versionOf', { no: version.no, total: a.versions.length }) : t('agreement.noText')}
            actions={
              <span className="flex flex-wrap gap-2">
                {a.versions.length > 1 && (
                  <Select aria-label={t('agreement.version')} options={[...a.versions].reverse().map((v) => ({ value: String(v.no), label: `v${v.no} · ${t(`agreement.source.${v.source}`)} · ${formatDate(v.createdAt)}` }))} value={String(version?.no ?? '')} onChange={(e) => setVersionNo(Number(e.target.value))} />
                )}
                {canUpdate && !locked && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={render.isPending} onClick={() => render.mutate()}>{t('agreement.regenerate')}</Button>}
                {canUpdate && !locked && version && <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setTextEdit(version.body)}>{t('agreement.editText')}</Button>}
              </span>
            }
          >
            {version ? (
              <pre dir={a.language === 'ur' ? 'rtl' : 'ltr'} className={`whitespace-pre-wrap text-sm leading-7 ${a.language === 'ur' ? 'font-urdu text-base' : 'font-sans'}`}>{version.body}</pre>
            ) : (
              <p className="text-sm text-muted">{t('agreement.noTextHint')}</p>
            )}
          </Card>
        )}
        {tab === 'documents' && (
          <>
            <p className="mb-2 text-sm text-muted">{t('agreement.signedCopyHint')}</p>
            <DocumentsPanel entityType="agreement" entityId={a._id} />
          </>
        )}
        {tab === 'notes' && <NotesPanel entityType="agreement" entityId={a._id} />}
        {tab === 'activity' && <ActivityPanel entityId={a._id} />}
      </div>
      {editing && <AgreementFormDrawer agreement={a} onClose={() => setEditing(false)} />}
      {textEdit !== null && (
        <Modal open size="lg" onClose={() => setTextEdit(null)} title={t('agreement.editText')} footer={<Button loading={saveText.isPending} onClick={() => saveText.mutate(textEdit)}>{t('agreement.saveVersion')}</Button>}>
          <p className="mb-2 text-xs text-muted">{t('agreement.editTextHint')}</p>
          <Textarea aria-label={t('agreement.text')} dir={a.language === 'ur' ? 'rtl' : 'ltr'} rows={18} value={textEdit} onChange={(e) => setTextEdit(e.target.value)} />
        </Modal>
      )}
      {statusTo && (
        <Modal open onClose={() => setStatusTo(null)} title={t(`agreement.to.${statusTo}`)} footer={<Button loading={status.isPending} onClick={() => status.mutate()}>{t('common.confirm')}</Button>}>
          {statusTo === 'SIGNED' && (
            <Select
              label={t('agreement.signedCopy')}
              placeholder={t('agreement.noSignedCopy')}
              options={(docs.data?.items ?? []).map((d) => ({ value: d._id, label: d.fileName }))}
              value={signedDoc}
              onChange={(e) => setSignedDoc(e.target.value)}
            />
          )}
          {statusTo === 'SIGNED' && !docs.data?.items.length && <p className="mt-1 text-xs text-muted">{t('agreement.uploadFirst')}</p>}
          <Input label={t('common.notes')} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
        </Modal>
      )}
      <ConfirmDialog open={removing} title={t('agreement.deleteTitle')} message={t('common.cannotUndo')} loading={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setRemoving(false)} />
    </div>
  );
}

/* ═════════════ Templates ═════════════ */

function TemplatesModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const list = useQuery({ queryKey: ['agreementTemplates', 'all'], queryFn: () => agreementApi.templates({ includeArchived: true }) });
  const [edit, setEdit] = useState<Partial<AgreementTemplate> & { body: string; name: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agreementTemplates'] });
  const save = useMutation({
    mutationFn: () => (edit!._id && !edit!.builtIn ? agreementApi.updateTemplate(edit!._id, { name: edit!.name, body: edit!.body }) : agreementApi.createTemplate({ uuid: crypto.randomUUID(), name: edit!.name, kind: edit!.kind, language: edit!.language, body: edit!.body })),
    onSuccess: () => (toast.success(t('agreement.templateSaved')), setEdit(null), refresh()),
    onError,
  });
  const archive = useMutation({ mutationFn: (x: AgreementTemplate) => agreementApi.updateTemplate(x._id, { archived: !x.archivedAt }), onSuccess: refresh, onError });
  const kinds = useEnumOptions('agreementKind', AGREEMENT_KINDS);
  if (edit) {
    return (
      <Modal open size="lg" onClose={() => setEdit(null)} title={edit._id && !edit.builtIn ? t('agreement.editTemplate') : t('agreement.newTemplate')} footer={<Button loading={save.isPending} disabled={!edit.name.trim() || edit.body.trim().length < 20} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <Input label={t('common.name')} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Select label={t('agreement.kind')} options={kinds} value={edit.kind ?? 'OTHER'} disabled={!!edit._id && !edit.builtIn} onChange={(e) => setEdit({ ...edit, kind: e.target.value as AgreementKind })} />
          <Select label={t('agreement.language')} options={AGREEMENT_LANGUAGES.map((l) => ({ value: l, label: l === 'ur' ? 'اردو' : 'English' }))} value={edit.language ?? 'en'} disabled={!!edit._id && !edit.builtIn} onChange={(e) => setEdit({ ...edit, language: e.target.value as AgreementLanguage })} />
        </div>
        <Textarea aria-label={t('agreement.text')} rows={16} dir={edit.language === 'ur' ? 'rtl' : 'ltr'} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
        <p className="mt-2 text-xs text-muted">{t('agreement.placeholdersHint')} <span className="ltr-nums">{AGREEMENT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ')}</span></p>
      </Modal>
    );
  }
  return (
    <Modal open size="lg" onClose={onClose} title={t('agreement.templates')} footer={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', body: '', kind: 'OTHER', language: 'en' })}>{t('agreement.newTemplate')}</Button>}>
      <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto text-sm">
        {(list.data ?? []).map((x) => (
          <li key={x._id} className={`flex items-center justify-between gap-2 py-2 ${x.archivedAt ? 'text-muted line-through' : ''}`}>
            <span>
              {x.name} <span className="text-xs text-muted">· {t(`enums.agreementKind.${x.kind}`)} · {x.language.toUpperCase()}{x.builtIn ? ` · ${t('finance.builtIn')}` : ''}</span>
            </span>
            <span className="flex gap-1">
              {x.builtIn ? (
                <Button variant="ghost" size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => setEdit({ name: `${x.name} (copy)`, body: x.body, kind: x.kind, language: x.language })}>{t('agreement.copy')}</Button>
              ) : (
                <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(x)}>{t('common.edit')}</Button>
              )}
              <Button variant="ghost" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => archive.mutate(x)}>{x.archivedAt ? t('common.restore') : t('common.archive')}</Button>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Agreements of a deal / client / property, on their detail pages. */
export function AgreementsPanel({ dealId, clientId, propertyId, defaults }: { dealId?: string; clientId?: string; propertyId?: string; defaults?: Parameters<typeof AgreementFormDrawer>[0]['defaults'] }) {
  const { t } = useTranslation();
  const canCreate = useCan(PERMISSIONS.AGREEMENTS_CREATE);
  const q = useQuery({ queryKey: ['agreements', { dealId, clientId, propertyId }], queryFn: () => agreementApi.list({ dealId, clientId, propertyId, limit: 50 }) });
  const [open, setOpen] = useState(false);
  return (
    <Card title={t('agreement.title')} actions={canCreate && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>{t('agreement.add')}</Button>}>
      {!q.data?.items.length ? (
        <p className="text-sm text-muted">{t('agreement.empty')}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {q.data.items.map((a) => (
            <li key={a._id} className="flex items-center justify-between py-2">
              <Link to={`/agreements/${a._id}`} className="hover:underline"><span className="ltr-nums font-medium">{a.agreementNo}</span> {t(`enums.agreementKind.${a.kind}`)}</Link>
              <AgreementStatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
      {open && <AgreementFormDrawer onClose={() => setOpen(false)} defaults={{ dealId, clientId, propertyId, ...defaults }} />}
    </Card>
  );
}
