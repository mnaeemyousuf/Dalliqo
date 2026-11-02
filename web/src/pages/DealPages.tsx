import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Columns3, Download, HandCoins, Plus, Rows3, Trash2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  COMMISSION_MODES,
  COMMISSION_STATUSES,
  DEAL_SIDES,
  DEAL_STAGES,
  OPEN_DEAL_STAGES,
  PAYMENT_METHODS,
  PERMISSIONS,
  summarizeCommission,
  type CommissionMode,
  type DealStage,
} from '@recrm/shared';
import { clientApi, dealApi, exportApi, propertyApi } from '@/api/endpoints';
import type { Deal } from '@/api/types';
import { BranchField } from '@/components/branches';
import { ActivityPanel, DocumentsPanel, NotesPanel } from '@/components/domain/panels';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Table, Tabs, Textarea, type BadgeColor, type Column } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useDebounce, useEnumOptions, useErrorText, useMembers, useOnError, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const STAGE_COLOR: Record<DealStage, BadgeColor> = {
  INQUIRY: 'gray', SITE_VISIT: 'blue', OFFER: 'purple', TOKEN: 'amber', AGREEMENT: 'amber', TRANSFER: 'blue', CLOSED_WON: 'green', CLOSED_LOST: 'red',
};
const STATUS_COLOR: Record<string, BadgeColor> = { PENDING: 'gray', PARTIALLY_RECEIVED: 'amber', RECEIVED: 'green' };

const name = (v: unknown) => (v && typeof v === 'object' && 'fullName' in v ? String((v as { fullName: string }).fullName) : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : (v as string | null | undefined) ?? '');

export function StageBadge({ stage }: { stage: DealStage }) {
  const { t } = useTranslation();
  return <Badge color={STAGE_COLOR[stage]}>{t(`enums.dealStage.${stage}`)}</Badge>;
}

export function CommissionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge color={STATUS_COLOR[status] ?? 'gray'}>{t(`enums.commissionStatus.${status}`)}</Badge>;
}

/* ═════════════ Deal form ═════════════ */

type Term = { mode: CommissionMode; value: string };

export function DealFormDrawer({ open, onClose, deal, clientId, propertyId }: { open: boolean; onClose(): void; deal?: Deal; clientId?: string; propertyId?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const me = useAuth((s) => s.user?._id) ?? '';
  const members = useMembers();
  const modes = useEnumOptions('commissionMode', COMMISSION_MODES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientSearch, setClientSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const clients = useQuery({ queryKey: ['clients', 'pick', useDebounce(clientSearch, 250)], queryFn: () => clientApi.list({ q: clientSearch, limit: 30 }), enabled: open });
  const properties = useQuery({ queryKey: ['properties', 'pick', useDebounce(propertySearch, 250)], queryFn: () => propertyApi.list({ q: propertySearch, limit: 30 }), enabled: open });
  const term = (x?: { mode: CommissionMode; value: number }): Term => ({ mode: x?.mode ?? 'PERCENT', value: x ? String(x.value) : '' });
  const [form, setForm] = useState({
    branchId: deal?.branchId ?? '',
    title: deal?.title ?? '',
    clientId: refId(deal?.clientId) || clientId || '',
    propertyId: refId(deal?.propertyId) || propertyId || '',
    agreedPrice: deal?.agreedPrice?.toString() ?? '',
    finalPrice: deal?.finalPrice?.toString() ?? '',
    expectedCloseDate: deal?.expectedCloseDate?.slice(0, 10) ?? '',
    notes: deal?.notes ?? '',
  });
  const [buyer, setBuyer] = useState<Term>(term(deal?.commission.buyer));
  const [seller, setSeller] = useState<Term>(term(deal?.commission.seller));
  const [agents, setAgents] = useState<{ userId: string; sharePct: string }[]>(
    deal?.agents.map((a) => ({ userId: refId(a.userId), sharePct: String(a.sharePct) })) ?? [{ userId: me, sharePct: '100' }],
  );
  const shareSum = agents.reduce((s, a) => s + (Number(a.sharePct) || 0), 0);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const preview = summarizeCommission({
    agreedPrice: num(form.agreedPrice),
    finalPrice: num(form.finalPrice),
    commission: { buyer: buyer.value ? { mode: buyer.mode, value: Number(buyer.value) } : null, seller: seller.value ? { mode: seller.mode, value: Number(seller.value) } : null },
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        ...(form.branchId ? { branchId: form.branchId } : {}),
        title: form.title || undefined,
        clientId: form.clientId,
        propertyId: form.propertyId || (deal ? null : undefined),
        agreedPrice: num(form.agreedPrice),
        finalPrice: num(form.finalPrice),
        expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : deal ? null : undefined,
        notes: form.notes || undefined,
        agents: agents.filter((a) => a.userId).map((a) => ({ userId: a.userId, sharePct: Number(a.sharePct) })),
      };
      const commission: Record<string, unknown> = {};
      if (buyer.value !== '') commission.buyer = { mode: buyer.mode, value: Number(buyer.value) };
      if (seller.value !== '') commission.seller = { mode: seller.mode, value: Number(seller.value) };
      if (Object.keys(commission).length) body.commission = commission;
      return deal ? dealApi.update(deal._id, { ...body, baseVersion: deal.version }) : dealApi.create(body);
    },
    onSuccess: (d) => {
      toast.success(deal ? t('deal.updated') : t('deal.created'));
      void qc.invalidateQueries({ queryKey: ['deals'] });
      void qc.invalidateQueries({ queryKey: ['deal', d._id] });
      onClose();
      if (!deal) navigate(`/deals/${d._id}`);
    },
    onError: (e) => setErrors(onError(e)),
  });

  const clientOptions = [
    ...(clients.data?.items ?? []).map((c) => ({ value: c._id, label: `${c.fullName} · ${c.mobileNumber}` })),
    ...(deal && refId(deal.clientId) && !clients.data?.items.some((c) => c._id === refId(deal.clientId)) ? [{ value: refId(deal.clientId), label: name(deal.clientId) }] : []),
  ];
  const propertyOptions = [
    ...(properties.data?.items ?? []).map((p) => ({ value: p._id, label: `${p.propertyId} · ${[p.block, p.society].filter(Boolean).join(', ')}` })),
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={deal ? t('deal.edit') : t('deal.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={save.isPending} disabled={!form.clientId || Math.abs(shareSum - 100) > 0.01} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <BranchField value={form.branchId} onChange={(v) => setForm((f) => ({ ...f, branchId: v }))} />
        <Input label={t('deal.titleField')} value={form.title} onChange={set('title')} placeholder={t('deal.titlePlaceholder')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input label={t('deal.client')} placeholder={t('common.search')} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
            <Select aria-label={t('deal.client')} placeholder="—" options={clientOptions} value={form.clientId} onChange={set('clientId')} error={errors.clientId} />
          </div>
          <div>
            <Input label={t('deal.property')} placeholder={t('common.search')} value={propertySearch} onChange={(e) => setPropertySearch(e.target.value)} />
            <Select aria-label={t('deal.property')} placeholder="—" options={propertyOptions} value={form.propertyId} onChange={set('propertyId')} />
          </div>
          <Input label={t('deal.agreedPrice')} type="number" min={0} value={form.agreedPrice} onChange={set('agreedPrice')} />
          <Input label={t('deal.finalPrice')} type="number" min={0} value={form.finalPrice} onChange={set('finalPrice')} />
          <Input label={t('deal.expectedClose')} type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-sm font-medium">{t('deal.commission')}</p>
          {([['buyer', buyer, setBuyer], ['seller', seller, setSeller]] as const).map(([side, v, setV]) => (
            <div key={side} className="mb-2 grid grid-cols-3 items-end gap-2">
              <p className="text-sm">{t(`enums.dealSide.${side.toUpperCase()}`)}</p>
              <Select aria-label={t('deal.mode')} options={modes} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as CommissionMode })} />
              <Input aria-label={t('deal.value')} type="number" min={0} step="0.1" placeholder={v.mode === 'PERCENT' ? t('deal.defaultPct') : 'PKR'} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
            </div>
          ))}
          <p className="text-xs text-muted">{t('deal.expectedPreview', { amount: formatPkr(preview.expected.total) })}</p>
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-sm font-medium">{t('deal.agents')}</p>
          {agents.map((a, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_6rem_auto] items-end gap-2">
              <Select aria-label={t('deal.agent')} placeholder="—" options={members.options} value={a.userId} onChange={(e) => setAgents(agents.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} />
              <Input aria-label={t('deal.share')} type="number" min={0} max={100} value={a.sharePct} onChange={(e) => setAgents(agents.map((x, j) => (j === i ? { ...x, sharePct: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" disabled={agents.length === 1} onClick={() => setAgents(agents.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAgents([...agents, { userId: '', sharePct: '' }])}>{t('deal.addAgent')}</Button>
            <span className={`text-xs ${Math.abs(shareSum - 100) > 0.01 ? 'text-red-600' : 'text-muted'}`}>{t('deal.shareTotal', { total: shareSum })}</span>
          </div>
        </div>
        <Textarea label={t('common.notes')} value={form.notes} onChange={set('notes')} />
      </form>
    </Drawer>
  );
}

/* ═════════════ Deals list (pipeline board + table) ═════════════ */

export function DealsPage() {
  const { t } = useTranslation();
  const canCreate = useCan(PERMISSIONS.DEALS_CREATE);
  const members = useMembers();
  const [filters, setFilters] = useUrlState({ q: '', stage: '', agentId: '', commissionStatus: '', page: '1', view: 'board' });
  const q = useDebounce(filters.q, 300);
  const board = filters.view === 'board';
  const params = { q, stage: filters.stage, agentId: filters.agentId, commissionStatus: filters.commissionStatus, page: board ? 1 : Number(filters.page), limit: board ? 100 : 20, ...(board ? { open: true } : {}) };
  const query = useQuery({ queryKey: ['deals', params], queryFn: () => dealApi.list(params), placeholderData: (p) => p });
  const [formOpen, setFormOpen] = useState(false);
  const stages = useEnumOptions('dealStage', DEAL_STAGES);
  const cstatus = useEnumOptions('commissionStatus', COMMISSION_STATUSES);
  const f = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ [k]: e.target.value, page: '1' } as never);
  const columns: Column<Deal>[] = [
    { key: 'no', header: t('deal.dealNo'), render: (d) => <span className="ltr-nums font-medium">{d.dealNo}</span> },
    { key: 'client', header: t('deal.client'), render: (d) => name(d.clientId) },
    { key: 'property', header: t('deal.property'), render: (d) => (d.propertyId && typeof d.propertyId === 'object' ? (d.propertyId as { propertyId: string }).propertyId : '—') },
    { key: 'stage', header: t('deal.stage'), render: (d) => <StageBadge stage={d.stage} /> },
    { key: 'expected', header: t('deal.expected'), render: (d) => <span className="ltr-nums">{formatPkr(d.expectedTotal)}</span> },
    { key: 'outstanding', header: t('deal.outstanding'), render: (d) => <span className="ltr-nums">{formatPkr(d.outstanding)}</span> },
    { key: 'status', header: t('deal.commissionStatus'), render: (d) => <CommissionStatusBadge status={d.commissionStatus} /> },
  ];
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader
        title={t('deal.title')}
        subtitle={t('deal.subtitle')}
        actions={
          <>
            <div className="flex rounded-lg border border-line">
              <button className={`btn-ghost !rounded-e-none ${board ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'board' })} title={t('deal.board')}>
                <Columns3 className="h-4 w-4" />
              </button>
              <button className={`btn-ghost !rounded-s-none ${!board ? 'bg-canvas text-ink' : ''}`} onClick={() => setFilters({ view: 'table' })} title={t('property.tableView')}>
                <Rows3 className="h-4 w-4" />
              </button>
            </div>
            {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('deal.add')}</Button>}
          </>
        }
      />
      <Card className="mb-4" bodyClassName="grid gap-3 md:grid-cols-4">
        <Input placeholder={t('deal.searchPlaceholder')} value={filters.q} onChange={f('q')} aria-label={t('common.search')} />
        {!board && <Select options={stages} placeholder={`${t('deal.stage')}: ${t('common.all')}`} value={filters.stage} onChange={f('stage')} />}
        {members.options.length > 0 && <Select options={members.options} placeholder={`${t('deal.agent')}: ${t('common.all')}`} value={filters.agentId} onChange={f('agentId')} />}
        <Select options={cstatus} placeholder={`${t('deal.commissionStatus')}: ${t('common.all')}`} value={filters.commissionStatus} onChange={f('commissionStatus')} />
      </Card>
      {query.isLoading ? (
        <PageLoader />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : !query.data!.items.length ? (
        <EmptyState title={t('deal.empty')} hint={t('deal.emptyHint')} icon={<HandCoins className="h-6 w-6" />} action={canCreate ? <Button onClick={() => setFormOpen(true)}>{t('deal.add')}</Button> : undefined} />
      ) : board ? (
        <div className="grid auto-cols-[16rem] grid-flow-col gap-3 overflow-x-auto pb-2">
          {OPEN_DEAL_STAGES.map((stage) => {
            const items = query.data!.items.filter((d) => d.stage === stage);
            return (
              <div key={stage} className="rounded-xl bg-canvas p-2">
                <p className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                  {t(`enums.dealStage.${stage}`)} <span className="ltr-nums text-xs text-muted">{items.length}</span>
                </p>
                <div className="space-y-2">
                  {items.map((d) => (
                    <Link key={d._id} to={`/deals/${d._id}`} className="card block p-3 text-sm transition hover:shadow-md">
                      <p className="flex items-center justify-between font-medium">
                        <span className="ltr-nums">{d.dealNo}</span> <CommissionStatusBadge status={d.commissionStatus} />
                      </p>
                      <p className="truncate">{d.title || name(d.clientId)}</p>
                      <p className="ltr-nums text-xs text-muted">{formatPkr(d.expectedTotal)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <Table columns={columns} rows={query.data!.items} onRowClick={(d) => navigate(`/deals/${d._id}`)} />
          <Pagination page={Number(filters.page)} totalPages={query.data!.meta.totalPages} total={query.data!.meta.total} limit={20} onChange={(p) => setFilters({ page: String(p) })} />
        </>
      )}
      {formOpen && <DealFormDrawer open onClose={() => setFormOpen(false)} />}
    </div>
  );
}

/* ═════════════ Deal detail ═════════════ */

function PaymentModal({ deal, onClose }: { deal: Deal; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const sides = useEnumOptions('dealSide', DEAL_SIDES);
  const methods = useEnumOptions('paymentMethod', PAYMENT_METHODS);
  const [form, setForm] = useState({ side: 'BUYER', amount: '', date: new Date().toISOString().slice(0, 10), method: 'CASH', reference: '', notes: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => dealApi.addPayment(deal._id, { ...form, id: crypto.randomUUID(), amount: Number(form.amount), reference: form.reference || undefined, notes: form.notes || undefined }),
    onSuccess: () => (toast.success(t('deal.paymentSaved')), void qc.invalidateQueries({ queryKey: ['deal', deal._id] }), void qc.invalidateQueries({ queryKey: ['deals'] }), onClose()),
    onError,
  });
  return (
    <Modal open onClose={onClose} title={t('deal.addPayment')} footer={<Button loading={save.isPending} disabled={!(Number(form.amount) > 0)} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('deal.side')} options={sides} value={form.side} onChange={set('side')} />
        <Input label={t('deal.amount')} type="number" min={1} value={form.amount} onChange={set('amount')} />
        <Input label={t('common.date')} type="date" value={form.date} onChange={set('date')} />
        <Select label={t('deal.method')} options={methods} value={form.method} onChange={set('method')} />
        <Input label={t('deal.reference')} value={form.reference} onChange={set('reference')} />
        <Input label={t('common.notes')} value={form.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

function PayoutModal({ deal, onClose }: { deal: Deal; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const agentOptions = deal.agents.map((a) => ({ value: refId(a.userId), label: `${name(a.userId)} (${a.sharePct}%)` }));
  const [form, setForm] = useState({ userId: agentOptions[0]?.value ?? '', amount: '', status: 'PENDING', notes: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => dealApi.addPayout(deal._id, { id: crypto.randomUUID(), userId: form.userId, amount: Number(form.amount), status: form.status, notes: form.notes || undefined }),
    onSuccess: () => (toast.success(t('deal.payoutSaved')), void qc.invalidateQueries({ queryKey: ['deal', deal._id] }), onClose()),
    onError,
  });
  return (
    <Modal open onClose={onClose} title={t('deal.addPayout')} footer={<Button loading={save.isPending} disabled={!form.userId || !(Number(form.amount) > 0)} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('deal.agent')} options={agentOptions} value={form.userId} onChange={set('userId')} />
        <Input label={t('deal.amount')} type="number" min={1} value={form.amount} onChange={set('amount')} />
        <Select label={t('common.status')} options={[{ value: 'PENDING', label: t('enums.payoutStatus.PENDING') }, { value: 'PAID', label: t('enums.payoutStatus.PAID') }]} value={form.status} onChange={set('status')} />
        <Input label={t('common.notes')} value={form.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

export function DealDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const canEdit = useCan(PERMISSIONS.DEALS_UPDATE);
  const canDelete = useCan(PERMISSIONS.DEALS_DELETE);
  const canMoney = useCan(PERMISSIONS.COMMISSIONS_MANAGE);
  const q = useQuery({ queryKey: ['deal', id], queryFn: () => dealApi.get(id) });
  const [tab, setTab] = useState<'commission' | 'documents' | 'notes' | 'activity'>('commission');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payout, setPayout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['deal', id] }), void qc.invalidateQueries({ queryKey: ['deals'] }));
  const stage = useMutation({ mutationFn: (b: { stage: DealStage; lostReason?: string }) => dealApi.stage(id, b), onSuccess: () => (setLostOpen(false), refresh()), onError });
  const removePayment = useMutation({ mutationFn: (pid: string) => dealApi.removePayment(id, pid), onSuccess: refresh, onError });
  const markPaid = useMutation({ mutationFn: (pid: string) => dealApi.updatePayout(id, pid, { status: 'PAID' }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: () => dealApi.remove(id), onSuccess: () => (toast.success(t('deal.deleted')), navigate('/deals')), onError });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.summary;
  const idx = DEAL_STAGES.indexOf(d.stage);
  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="ltr-nums">{d.dealNo}</span> <StageBadge stage={d.stage} /></span>}
        subtitle={d.title || name(d.clientId)}
        actions={
          <>
            {canEdit && <Button variant="secondary" onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
            {canDelete && <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
          </>
        }
      />
      {/* Pipeline stepper */}
      <Card className="mb-4" bodyClassName="flex flex-wrap items-center gap-1">
        {OPEN_DEAL_STAGES.map((st, i) => (
          <span key={st} className="flex items-center gap-1">
            <button
              disabled={!canEdit || stage.isPending}
              onClick={() => stage.mutate({ stage: st })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${i <= idx && d.stage !== 'CLOSED_LOST' ? 'bg-brand-600 text-on-brand' : 'bg-canvas text-muted'} ${d.stage === st ? 'ring-2 ring-brand-500' : ''}`}
            >
              {t(`enums.dealStage.${st}`)}
            </button>
            {i < OPEN_DEAL_STAGES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
          </span>
        ))}
        {canEdit && (
          <span className="ms-auto flex gap-2">
            <Button size="sm" variant={d.stage === 'CLOSED_WON' ? 'primary' : 'secondary'} onClick={() => stage.mutate({ stage: 'CLOSED_WON' })}>{t('enums.dealStage.CLOSED_WON')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setLostOpen(true)}>{t('enums.dealStage.CLOSED_LOST')}</Button>
          </span>
        )}
        {d.stage === 'CLOSED_LOST' && d.lostReason && <p className="w-full pt-1 text-xs text-red-600">{t('deal.lostReason')}: {d.lostReason}</p>}
      </Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card><p className="text-xs text-muted">{t('deal.expected')}</p><p className="ltr-nums text-lg font-semibold">{formatPkr(s.expected.total)}</p></Card>
        <Card><p className="text-xs text-muted">{t('deal.received')}</p><p className="ltr-nums text-lg font-semibold text-emerald-600">{formatPkr(s.received.total)}</p></Card>
        <Card><p className="text-xs text-muted">{t('deal.outstanding')}</p><p className="ltr-nums text-lg font-semibold text-amber-600">{formatPkr(s.outstanding)}</p></Card>
        <Card><p className="text-xs text-muted">{t('deal.commissionStatus')}</p><CommissionStatusBadge status={s.status} /></Card>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'commission', label: t('deal.commission') },
          { value: 'documents', label: t('document.title') },
          { value: 'notes', label: t('note.title') },
          { value: 'activity', label: t('activity.title') },
        ]}
      />
      <div className="mt-4">
        {tab === 'commission' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('deal.details')}>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">{t('deal.client')}</dt><dd><Link className="hover:underline" to={`/clients/${refId(d.clientId)}`}>{name(d.clientId)}</Link></dd>
                <dt className="text-muted">{t('deal.property')}</dt>
                <dd>{d.propertyId ? <Link className="hover:underline" to={`/properties/${refId(d.propertyId)}`}>{(d.propertyId as { propertyId?: string }).propertyId}</Link> : '—'}</dd>
                <dt className="text-muted">{t('deal.agreedPrice')}</dt><dd className="ltr-nums">{d.agreedPrice ? formatPkr(d.agreedPrice) : '—'}</dd>
                <dt className="text-muted">{t('deal.finalPrice')}</dt><dd className="ltr-nums">{d.finalPrice ? formatPkr(d.finalPrice) : '—'}</dd>
                <dt className="text-muted">{t('deal.expectedClose')}</dt><dd>{d.expectedCloseDate ? formatDate(d.expectedCloseDate) : '—'}</dd>
                {(['buyer', 'seller'] as const).map((side) => (
                  <span key={side} className="contents">
                    <dt className="text-muted">{t('deal.commission')} · {t(`enums.dealSide.${side.toUpperCase()}`)}</dt>
                    <dd className="ltr-nums">
                      {d.commission[side].mode === 'PERCENT' ? `${d.commission[side].value}% = ` : ''}
                      {formatPkr(s.expected[side])} <span className="text-xs text-muted">({t('deal.receivedShort')} {formatPkr(s.received[side])})</span>
                    </dd>
                  </span>
                ))}
              </dl>
              {d.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{d.notes}</p>}
            </Card>
            <Card title={t('deal.agents')}>
              <ul className="divide-y divide-line text-sm">
                {s.agents.map((a) => {
                  const ag = d.agents.find((x) => refId(x.userId) === a.userId);
                  return (
                    <li key={a.userId} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>{name(ag?.userId)} · <span className="ltr-nums">{a.sharePct}%</span></span>
                      <span className="ltr-nums text-xs text-muted">
                        {t('deal.share')}: {formatPkr(a.expected)} · {t('deal.receivedShort')} {formatPkr(a.received)} · {t('deal.paidOut')} {formatPkr(a.paidOut)} · {t('deal.owed')} {formatPkr(a.owed)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title={t('deal.payments')} actions={canMoney && <Button size="sm" icon={<Wallet className="h-3.5 w-3.5" />} onClick={() => setPaying(true)}>{t('deal.addPayment')}</Button>}>
              {d.payments.length === 0 ? (
                <p className="text-sm text-muted">{t('deal.noPayments')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.payments.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <span className="ltr-nums font-medium">{formatPkr(p.amount)}</span> · {t(`enums.dealSide.${p.side}`)} · {t(`enums.paymentMethod.${p.method}`)} · {formatDate(p.date)}
                        {p.reference && <span className="text-muted"> · {p.reference}</span>}
                      </span>
                      {canMoney && <Button size="sm" variant="ghost" onClick={() => removePayment.mutate(p._id)} aria-label={t('common.delete')}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t('deal.payouts')} actions={canMoney && <Button size="sm" variant="secondary" onClick={() => setPayout(true)}>{t('deal.addPayout')}</Button>}>
              {d.payouts.length === 0 ? (
                <p className="text-sm text-muted">{t('deal.noPayouts')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.payouts.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        {name(d.agents.find((a) => refId(a.userId) === String(p.userId))?.userId)} · <span className="ltr-nums">{formatPkr(p.amount)}</span>{' '}
                        <Badge color={p.status === 'PAID' ? 'green' : 'amber'}>{t(`enums.payoutStatus.${p.status}`)}</Badge> {p.date && <span className="text-xs text-muted">{formatDate(p.date)}</span>}
                      </span>
                      {canMoney && p.status !== 'PAID' && <Button size="sm" variant="secondary" onClick={() => markPaid.mutate(p._id)}>{t('deal.markPaid')}</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
        {tab === 'documents' && <DocumentsPanel entityType="deal" entityId={d._id} />}
        {tab === 'notes' && <NotesPanel entityType="deal" entityId={d._id} />}
        {tab === 'activity' && <ActivityPanel entityId={d._id} />}
      </div>
      {editing && <DealFormDrawer open deal={d} onClose={() => setEditing(false)} />}
      {paying && <PaymentModal deal={d} onClose={() => setPaying(false)} />}
      {payout && <PayoutModal deal={d} onClose={() => setPayout(false)} />}
      <Modal open={lostOpen} onClose={() => setLostOpen(false)} title={t('enums.dealStage.CLOSED_LOST')} footer={<Button disabled={!lostReason.trim()} loading={stage.isPending} onClick={() => stage.mutate({ stage: 'CLOSED_LOST', lostReason })}>{t('common.save')}</Button>}>
        <Textarea label={t('deal.lostReason')} value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
      </Modal>
      <ConfirmDialog open={confirmDelete} title={t('common.delete')} message={t('deal.deleteConfirm', { no: d.dealNo })} loading={remove.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />
    </div>
  );
}

/** Deals of a client or property (tab on their detail pages). */
export function DealsPanel({ clientId, propertyId }: { clientId?: string; propertyId?: string }) {
  const { t } = useTranslation();
  const canCreate = useCan(PERMISSIONS.DEALS_CREATE);
  const q = useQuery({ queryKey: ['deals', { clientId, propertyId }], queryFn: () => dealApi.list({ clientId, propertyId, limit: 50 }) });
  const [open, setOpen] = useState(false);
  return (
    <Card actions={canCreate && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>{t('deal.add')}</Button>}>
      {!q.data?.items.length ? (
        <p className="text-sm text-muted">{t('deal.empty')}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {q.data.items.map((d) => (
            <li key={d._id} className="flex items-center justify-between py-2">
              <Link to={`/deals/${d._id}`} className="hover:underline"><span className="ltr-nums font-medium">{d.dealNo}</span> {d.title}</Link>
              <span className="flex items-center gap-2"><StageBadge stage={d.stage} /><span className="ltr-nums text-xs text-muted">{formatPkr(d.expectedTotal)}</span></span>
            </li>
          ))}
        </ul>
      )}
      {open && <DealFormDrawer open clientId={clientId} propertyId={propertyId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

/* ═════════════ Commission report (Reports page) ═════════════ */

export function CommissionReport() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [groupBy, setGroupBy] = useState<'month' | 'agent'>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = { groupBy, from: from || undefined, to: to || undefined };
  const q = useQuery({ queryKey: ['reports', 'commissions', params], queryFn: () => dealApi.report(params) });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setBusy(null), [groupBy]);
  const download = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      await exportApi.download('commissions', format, { from, to });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title={t('deal.reportTitle')}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select label={t('deal.groupBy')} options={[{ value: 'month', label: t('deal.byMonth') }, { value: 'agent', label: t('deal.byAgent') }]} value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'month' | 'agent')} />
        <Input label={t('common.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t('common.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'xlsx'} onClick={() => void download('xlsx')}>{t('report.excel')}</Button>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => void download('pdf')}>{t('report.pdf')}</Button>
      </div>
      {q.data && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div><p className="text-muted">{t('deal.expected')}</p><p className="ltr-nums text-base font-semibold">{formatPkr(q.data.totals.expected)}</p></div>
            <div><p className="text-muted">{t('deal.received')}</p><p className="ltr-nums text-base font-semibold text-emerald-600">{formatPkr(q.data.totals.received)}</p></div>
            <div><p className="text-muted">{t('deal.outstanding')}</p><p className="ltr-nums text-base font-semibold text-amber-600">{formatPkr(q.data.totals.outstanding)}</p></div>
          </div>
          <table className="mb-4 w-full text-sm">
            <thead><tr className="text-start text-muted"><th className="py-1 text-start">{groupBy === 'month' ? t('deal.month') : t('deal.agent')}</th><th className="py-1 text-end">{t('deal.received')}</th><th className="py-1 text-end">{t('deal.paymentsCount')}</th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.key} className="border-t border-line"><td className="py-1.5 ltr-nums">{r.label}</td><td className="py-1.5 text-end ltr-nums">{formatPkr(r.received)}</td><td className="py-1.5 text-end ltr-nums">{r.payments}</td></tr>
              ))}
              {!q.data.rows.length && <tr><td colSpan={3} className="py-2 text-muted">{t('deal.noPayments')}</td></tr>}
            </tbody>
          </table>
          {q.data.outstanding.length > 0 && (
            <>
              <p className="mb-1 text-sm font-medium">{t('deal.outstandingDeals')}</p>
              <ul className="divide-y divide-line text-sm">
                {q.data.outstanding.map((o) => (
                  <li key={o._id} className="flex justify-between py-1.5">
                    <Link className="hover:underline" to={`/deals/${o._id}`}><span className="ltr-nums">{o.dealNo}</span> {o.title}</Link>
                    <span className="ltr-nums text-amber-600">{formatPkr(o.outstanding)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
