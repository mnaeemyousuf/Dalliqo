import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, FileDown, Plus, Receipt, Wallet } from 'lucide-react';
import { INSTALLMENT_FREQUENCIES, PAYMENT_METHODS, PERMISSIONS, buildInstallmentSchedule, type InstallmentFrequency, type RentItemStatus } from '@recrm/shared';
import { clientApi, financeReportApi, installmentApi, memberApi, propertyApi, receiptApi } from '@/api/endpoints';
import type { InstallmentPlan } from '@/api/types';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, ErrorState, Input, MetricTile, Modal, PageHeader, PageLoader, Select, Textarea, type BadgeColor, type Column } from '@/components/ui';
import { formatDate, formatPkr, toLocalInput } from '@/lib/format';
import { useDebounce, useEnumOptions, useErrorText, useOnError, useOpenOnNew, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const ITEM_COLOR: Record<RentItemStatus, BadgeColor> = { PENDING: 'gray', PARTIAL: 'amber', PAID: 'green', OVERDUE: 'red', WAIVED: 'purple' };
const PLAN_COLOR: Record<string, BadgeColor> = { ACTIVE: 'green', COMPLETED: 'blue', CANCELLED: 'red' };
const label = (v: unknown, k: 'fullName' | 'propertyId' | 'dealNo') => (v && typeof v === 'object' && k in v ? String((v as Record<string, unknown>)[k]) : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : String(v ?? ''));
const today = () => toLocalInput(new Date()).slice(0, 10);

/** Receipt PDF download button for any recorded payment (lease, installment or deal). */
export function ReceiptButton({ kind, id, paymentId }: { kind: 'lease' | 'installment' | 'deal'; id: string; paymentId: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={t('finance5b.receipt')}
      aria-label={t('finance5b.receipt')}
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand-600 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await receiptApi.download(kind, id, paymentId);
        } catch (e) {
          toast.error(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Receipt className="h-3.5 w-3.5" />
      {t('finance5b.receipt')}
    </button>
  );
}

/* ═════════════ List ═════════════ */

export function InstallmentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreate = useCan(PERMISSIONS.FINANCE_CREATE);
  const [filters, setFilters] = useUrlState({ q: '', status: 'ACTIVE', overdue: '', page: '1' });
  const [formOpen, setFormOpen] = useState(false);
  useOpenOnNew(() => setFormOpen(true));
  const q = useDebounce(filters.q, 300);
  const page = Number(filters.page);
  const query = useQuery({ queryKey: ['installments', { ...filters, q }], queryFn: () => installmentApi.list({ ...filters, q, page, limit: 20 }), placeholderData: (p) => p });
  const statuses = useEnumOptions('installmentPlanStatus', ['ACTIVE', 'COMPLETED', 'CANCELLED']);
  const columns: Column<InstallmentPlan>[] = [
    { key: 'no', header: t('finance5b.plan'), render: (p) => <span className="ltr-nums font-bold text-brand-600">{p.planNo}</span> },
    { key: 'client', header: t('finance5b.buyer'), render: (p) => label(p.clientId, 'fullName') },
    { key: 'property', header: t('nav.properties'), render: (p) => <span className="whitespace-nowrap">{label(p.propertyId, 'propertyId') || '—'}</span> },
    { key: 'total', header: t('finance5b.total'), render: (p) => <span className="ltr-nums whitespace-nowrap font-semibold">{formatPkr(p.totalAmount)}</span> },
    { key: 'paid', header: t('rental.paid'), render: (p) => <span className="ltr-nums whitespace-nowrap">{formatPkr(p.paidTotal)}</span> },
    { key: 'overdue', header: t('rental.overdue'), render: (p) => (p.overdueAmount ? <span className="ltr-nums font-semibold text-red-600">{formatPkr(p.overdueAmount)}</span> : <span className="text-subtle">—</span>) },
    { key: 'next', header: t('rental.nextDue'), render: (p) => (p.nextDueDate ? formatDate(p.nextDueDate) : '—') },
    { key: 'status', header: t('common.status'), render: (p) => <Badge color={PLAN_COLOR[p.status]}>{t(`enums.installmentPlanStatus.${p.status}`)}</Badge> },
  ];
  return (
    <div>
      <PageHeader title={t('finance5b.title')} subtitle={t('finance5b.subtitle')} actions={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('finance5b.add')}</Button>} />
      <Card className="mb-4" bodyClassName="flex flex-wrap gap-2 !p-3">
        <Input wrapperClassName="min-w-[14rem] flex-1" placeholder={t('finance5b.search')} value={filters.q} onChange={(e) => setFilters({ q: e.target.value, page: '1' })} />
        <Select wrapperClassName="w-44" placeholder={`${t('common.status')}: ${t('common.all')}`} options={statuses} value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })} />
        <Select wrapperClassName="w-44" placeholder={t('finance5b.allPlans')} options={[{ value: 'true', label: t('rental.overdueOnly') }]} value={filters.overdue} onChange={(e) => setFilters({ overdue: e.target.value, page: '1' })} />
      </Card>
      <Card bodyClassName="!p-0">
        <DataTable columns={columns} query={query} page={page} onPage={(p) => setFilters({ page: String(p) })} onRowClick={(p) => navigate(`/installments/${p._id}`)} empty={<EmptyState title={t('finance5b.empty')} hint={t('finance5b.emptyHint')} icon={<CalendarRange className="h-6 w-6" />} action={canCreate && <Button onClick={() => setFormOpen(true)}>{t('finance5b.add')}</Button>} />} />
      </Card>
      {formOpen && <PlanFormDrawer onClose={() => setFormOpen(false)} />}
    </div>
  );
}

function PlanFormDrawer({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const [ps, setPs] = useState('');
  const [cs, setCs] = useState('');
  const properties = useQuery({ queryKey: ['properties', 'pick-plan', useDebounce(ps, 250)], queryFn: () => propertyApi.list({ q: ps, limit: 30 }) });
  const clients = useQuery({ queryKey: ['clients', 'pick-buyer', useDebounce(cs, 250)], queryFn: () => clientApi.list({ q: cs, limit: 30 }) });
  const freqs = useEnumOptions('installmentFrequency', INSTALLMENT_FREQUENCIES.filter((x) => x !== 'CUSTOM'));
  const [f, setF] = useState({ clientId: '', propertyId: '', title: '', totalAmount: '', bookingAmount: '', downPayment: '', possessionAmount: '', frequency: 'MONTHLY', count: '12', startDate: today(), graceDays: '7', notes: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const total = Number(f.totalAmount) || 0;
  const preview = total > 0 ? buildInstallmentSchedule({ totalAmount: total, bookingAmount: num(f.bookingAmount), downPayment: num(f.downPayment), possessionAmount: num(f.possessionAmount), frequency: f.frequency as InstallmentFrequency, count: Number(f.count) || 1, startDate: new Date(f.startDate) }) : [];
  const save = useMutation({
    mutationFn: () =>
      installmentApi.create({
        clientId: f.clientId,
        propertyId: f.propertyId || undefined,
        title: f.title || undefined,
        totalAmount: total,
        bookingAmount: num(f.bookingAmount),
        downPayment: num(f.downPayment),
        possessionAmount: num(f.possessionAmount),
        frequency: f.frequency,
        count: num(f.count),
        startDate: f.startDate,
        graceDays: num(f.graceDays),
        notes: f.notes || undefined,
      }),
    onSuccess: (p) => {
      toast.success(t('finance5b.created'));
      void qc.invalidateQueries({ queryKey: ['installments'] });
      onClose();
      navigate(`/installments/${p._id}`);
    },
    onError,
  });
  return (
    <Drawer open onClose={onClose} title={t('finance5b.add')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.clientId || total <= 0} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('rental.findTenant')} value={cs} onChange={(e) => setCs(e.target.value)} placeholder={t('client.searchPlaceholder')} />
        <Select label={t('finance5b.buyer')} required placeholder="—" options={(clients.data?.items ?? []).map((c) => ({ value: c._id, label: `${c.fullName} · ${c.mobileNumber}` }))} value={f.clientId} onChange={set('clientId')} />
        <Input label={t('rental.findProperty')} value={ps} onChange={(e) => setPs(e.target.value)} placeholder={t('property.searchPlaceholder')} />
        <Select label={t('nav.properties')} placeholder="—" options={(properties.data?.items ?? []).map((p) => ({ value: p._id, label: `${p.propertyId} · ${[p.block, p.society].filter(Boolean).join(', ')} · ${formatPkr(p.askingPrice)}` }))} value={f.propertyId} onChange={(e) => { const p = properties.data?.items.find((x) => x._id === e.target.value); setF((x) => ({ ...x, propertyId: e.target.value, totalAmount: x.totalAmount || String(p?.askingPrice ?? '') })); }} />
        <Input label={t('common.title')} value={f.title} onChange={set('title')} wrapperClassName="sm:col-span-2" />
        <Input label={t('finance5b.total')} type="number" min={1} required value={f.totalAmount} onChange={set('totalAmount')} />
        <Input label={t('finance5b.booking')} type="number" min={0} value={f.bookingAmount} onChange={set('bookingAmount')} />
        <Input label={t('finance5b.downPayment')} type="number" min={0} value={f.downPayment} onChange={set('downPayment')} />
        <Input label={t('finance5b.possession')} type="number" min={0} value={f.possessionAmount} onChange={set('possessionAmount')} />
        <Select label={t('finance5b.frequency')} options={freqs} value={f.frequency} onChange={set('frequency')} />
        <Input label={t('finance5b.count')} type="number" min={1} max={240} value={f.count} onChange={set('count')} />
        <Input label={t('rental.startDate')} type="date" value={f.startDate} onChange={set('startDate')} />
        <Input label={t('rental.graceDays')} type="number" min={0} max={90} value={f.graceDays} onChange={set('graceDays')} />
        <Textarea label={t('common.notes')} value={f.notes} onChange={set('notes')} wrapperClassName="sm:col-span-2" />
      </div>
      {preview.length > 0 && (
        <div className="mt-4 rounded-lg border border-line">
          <p className="border-b border-line px-3 py-2 text-xs font-semibold text-muted">{t('finance5b.preview', { count: preview.length })}</p>
          <ul className="max-h-56 divide-y divide-line overflow-auto text-sm">
            {preview.map((i, n) => (
              <li key={n} className="flex justify-between px-3 py-1.5">
                <span>{i.label} <span className="ltr-nums text-xs text-muted">{formatDate(i.dueDate)}</span></span>
                <span className="ltr-nums font-medium">{formatPkr(i.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

/* ═════════════ Detail ═════════════ */

export function InstallmentDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const onError = useOnError();
  const canPay = useCan(PERMISSIONS.FINANCE_CREATE);
  const canCancel = useCan(PERMISSIONS.FINANCE_UPDATE);
  const q = useQuery({ queryKey: ['installment', id], queryFn: () => installmentApi.get(id) });
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['installment', id] }), void qc.invalidateQueries({ queryKey: ['installments'] }));
  const cancel = useMutation({ mutationFn: () => installmentApi.cancel(id, reason), onSuccess: () => (setCancelling(false), refresh()), onError });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;
  const p = q.data;
  const active = p.status === 'ACTIVE';
  const nextItem = p.items.find((i) => i.amount - i.paid > 0 && i.status !== 'WAIVED');
  return (
    <div>
      <PageHeader
        eyebrow={<Link to="/installments" className="hover:text-brand-600">{t('finance5b.title')}</Link>}
        title={<span className="flex flex-wrap items-center gap-2"><span className="ltr-nums">{p.planNo}</span><Badge color={PLAN_COLOR[p.status]}>{t(`enums.installmentPlanStatus.${p.status}`)}</Badge></span>}
        subtitle={
          <>
            {p.title && <>{p.title} · </>}
            {t('finance5b.buyer')}: <Link className="hover:text-brand-600" to={`/clients/${refId(p.clientId)}`}>{label(p.clientId, 'fullName')}</Link>
            {p.propertyId && <> · <Link className="hover:text-brand-600" to={`/properties/${refId(p.propertyId)}`}>{label(p.propertyId, 'propertyId')}</Link></>}
            {p.dealId && <> · <Link className="hover:text-brand-600" to={`/deals/${refId(p.dealId)}`}>{label(p.dealId, 'dealNo')}</Link></>}
          </>
        }
        actions={
          active && (
            <>
              {canPay && <Button icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(true)}>{t('finance5b.recordPayment')}</Button>}
              {canCancel && <Button variant="ghost" onClick={() => setCancelling(true)}>{t('finance5b.cancel')}</Button>}
            </>
          )
        }
      />
      <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile tone="brand" label={t('finance5b.total')} value={formatPkr(p.totalAmount)} />
        <MetricTile tone="good" label={t('rental.paid')} value={formatPkr(p.paidTotal)} />
        <MetricTile tone="bad" label={t('rental.overdue')} value={formatPkr(p.overdueAmount)} />
        <MetricTile tone="warn" label={t('finance5b.outstanding')} value={formatPkr(p.outstanding)} />
      </div>
      {p.cancelReason && <p className="mb-3 text-sm text-red-600">{t('finance5b.cancelReason')}: {p.cancelReason}</p>}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title={t('finance5b.schedule')} bodyClassName="!p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-2 text-start">{t('finance5b.installment')}</th><th className="px-4 py-2 text-start">{t('rental.due')}</th><th className="px-4 py-2 text-end">{t('rental.amount')}</th><th className="px-4 py-2 text-end">{t('rental.paid')}</th><th className="px-4 py-2 text-start">{t('common.status')}</th></tr>
            </thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i._id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{i.label}</td>
                  <td className="ltr-nums px-4 py-2">{formatDate(i.dueDate)}</td>
                  <td className="ltr-nums px-4 py-2 text-end">{formatPkr(i.amount)}</td>
                  <td className="ltr-nums px-4 py-2 text-end">{i.paid ? formatPkr(i.paid) : '—'}</td>
                  <td className="px-4 py-2"><Badge color={ITEM_COLOR[i.status]}>{t(`enums.rentStatus.${i.status}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={t('rental.payments')} bodyClassName="!p-0">
          {!p.payments.length ? (
            <EmptyState title={t('rental.noPayments')} icon={<Wallet className="h-6 w-6" />} />
          ) : (
            <ul className="divide-y divide-line">
              {[...p.payments].reverse().map((x) => (
                <li key={x._id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                  <span className="ltr-nums font-bold">{formatPkr(x.amount)}</span>
                  <Badge color="gray">{t(`enums.paymentMethod.${x.method}`)}</Badge>
                  {x.reference && <span className="text-xs text-muted">{x.reference}</span>}
                  <span className="ltr-nums text-xs text-muted">{formatDate(x.date)}</span>
                  <span className="ms-auto"><ReceiptButton kind="installment" id={p._id} paymentId={x._id} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {paying && <PayModal planId={id} suggested={p.overdueAmount || (nextItem ? nextItem.amount - nextItem.paid : 0)} onClose={() => setPaying(false)} onDone={refresh} />}
      <Modal open={cancelling} onClose={() => setCancelling(false)} title={t('finance5b.cancel')} footer={<Button variant="danger" disabled={reason.trim().length < 2} loading={cancel.isPending} onClick={() => cancel.mutate()}>{t('common.confirm')}</Button>}>
        <Textarea label={t('finance5b.cancelReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

function PayModal({ planId, suggested, onClose, onDone }: { planId: string; suggested: number; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const methods = useEnumOptions('paymentMethod', PAYMENT_METHODS);
  const [f, setF] = useState({ amount: '', date: today(), method: 'CASH', reference: '' });
  const save = useMutation({
    mutationFn: () => installmentApi.pay(planId, { amount: Number(f.amount || suggested), date: f.date, method: f.method, reference: f.reference || undefined }),
    onSuccess: () => (toast.success(t('finance5b.paymentRecorded')), onDone(), onClose()),
    onError,
  });
  return (
    <Modal open onClose={onClose} title={t('finance5b.recordPayment')} footer={<Button loading={save.isPending} disabled={!(Number(f.amount || suggested) > 0)} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('rental.amount')} type="number" min={1} placeholder={String(suggested)} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} hint={t('rental.allocationHint')} />
        <Input label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Select label={t('deal.method')} options={methods} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
        <Input label={t('deal.reference')} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      </div>
    </Modal>
  );
}

/* ═════════════ Reports page cards ═════════════ */

export function CashFlowCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reports', 'cash-flow'], queryFn: () => financeReportApi.cashFlow({}) });
  const months = q.data?.months ?? [];
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  return (
    <Card title={<span>{t('finance5b.cashFlow')} <span className="text-xs font-normal text-muted">· {t('finance5b.cashFlowHint')}</span></span>}>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="h-40 animate-pulse rounded bg-surface-2" />
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <MetricTile tone="good" label={t('finance.income')} value={formatPkr(q.data.totals.income)} />
            <MetricTile tone="bad" label={t('finance.expense')} value={formatPkr(q.data.totals.expense)} />
            <MetricTile tone="brand" label={t('finance5b.net')} value={formatPkr(q.data.totals.net)} />
          </div>
          <div className="flex h-36 items-end gap-1" role="img" aria-label={t('finance5b.cashFlow')}>
            {months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: +${formatPkr(m.income)} / −${formatPkr(m.expense)}`}>
                <div className="flex h-28 w-full items-end justify-center gap-0.5">
                  <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: `${(m.income / max) * 100}%` }} />
                  <div className="w-1/2 rounded-t bg-red-400" style={{ height: `${(m.expense / max) * 100}%` }} />
                </div>
                <span className="ltr-nums text-[10px] text-muted">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function AgingCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reports', 'aging'], queryFn: () => financeReportApi.aging() });
  const [side, setSide] = useState<'receivables' | 'payables'>('receivables');
  const buckets = ['CURRENT', '1_30', '31_60', '61_90', '90_PLUS'] as const;
  const d = q.data;
  const rows = d ? (side === 'receivables' ? d.receivableRows : d.payableRows) : [];
  const groups: Record<string, number>[] = d ? (side === 'receivables' ? [d.receivables.commission, d.receivables.installments, d.receivables.rent] : [d.payables.agents, d.payables.external]) : [];
  const bucketSum = (b: string) => groups.reduce((s, g) => s + (g[b] ?? 0), 0);
  const link = (kind: string, id: string) => (kind === 'INSTALLMENT' ? `/installments/${id}` : kind === 'RENT' ? `/leases/${id}` : `/deals/${id}`);
  return (
    <Card title={<span>{t('finance5b.aging')} <span className="text-xs font-normal text-muted">· {t('finance5b.agingHint')}</span></span>} actions={<Select aria-label={t('finance5b.aging')} options={[{ value: 'receivables', label: t('finance5b.receivables') }, { value: 'payables', label: t('finance5b.payables') }]} value={side} onChange={(e) => setSide(e.target.value as typeof side)} />}>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="h-32 animate-pulse rounded bg-surface-2" />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
            {buckets.map((b) => (
              <div key={b} className="rounded-lg bg-surface-2 p-2">
                <p className="text-2xs text-muted">{t(`enums.agingBucket.${b}`)}</p>
                <p className={`ltr-nums text-sm font-semibold ${b === '90_PLUS' && bucketSum(b) ? 'text-red-600' : ''}`}>{formatPkr(bucketSum(b))}</p>
              </div>
            ))}
            <div className="rounded-lg bg-brand-50 p-2 dark:bg-brand-900/30">
              <p className="text-2xs text-muted">{t('finance5b.total')}</p>
              <p className="ltr-nums text-sm font-bold">{formatPkr(d[side].total)}</p>
            </div>
          </div>
          {!rows.length ? (
            <p className="text-sm text-muted">{t('finance5b.nothingOutstanding')}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-auto text-sm">
              {rows.slice(0, 50).map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge color="gray">{t(`enums.agingKind.${r.kind}`)}</Badge>
                  <Link className="ltr-nums font-medium hover:text-brand-600" to={link(r.kind, r.id)}>{r.ref}</Link>
                  <span className="text-muted">{r.party}</span>
                  <span className="ltr-nums ms-auto font-semibold">{formatPkr(r.amount)}</span>
                  <span className="text-2xs text-muted">{t(`enums.agingBucket.${r.bucket}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export function AgentStatementCard() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const me = useAuth((s) => s.user?._id ?? '');
  const canAll = useCan(PERMISSIONS.DEALS_READ_ALL);
  const members = useQuery({ queryKey: ['members', 'statement'], queryFn: () => memberApi.list({ limit: 100, status: 'ACTIVE' }), enabled: canAll });
  const [userId, setUserId] = useState('');
  const uid = userId || me;
  const q = useQuery({ queryKey: ['reports', 'agent-statement', uid], queryFn: () => financeReportApi.agentStatement({ userId: uid }), enabled: !!uid });
  const [busy, setBusy] = useState(false);
  const st = q.data;
  return (
    <Card
      title={<span>{t('finance5b.statement')} <span className="text-xs font-normal text-muted">· {t('finance5b.statementHint')}</span></span>}
      actions={
        <div className="flex flex-wrap gap-2">
          {canAll && <Select aria-label={t('deal.agents')} options={(members.data?.items ?? []).map((m) => ({ value: m.user._id, label: m.user.fullName }))} value={uid} onChange={(e) => setUserId(e.target.value)} />}
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            icon={<FileDown className="h-3.5 w-3.5" />}
            onClick={async () => {
              setBusy(true);
              try {
                await financeReportApi.agentStatementPdf(uid);
              } catch (e) {
                toast.error(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            PDF
          </Button>
        </div>
      }
    >
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !st ? (
        <div className="h-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <MetricTile label={t('deal.expected')} value={formatPkr(st.totals.expected)} />
            <MetricTile tone="good" label={t('finance5b.earned')} value={formatPkr(st.totals.earned)} />
            <MetricTile tone="brand" label={t('deal.paidOut')} value={formatPkr(st.totals.paidOut)} />
            <MetricTile tone="warn" label={t('deal.owed')} value={formatPkr(st.totals.owed)} />
          </div>
          {!st.rows.length ? (
            <p className="text-sm text-muted">{t('deal.empty')}</p>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-auto text-sm">
              {st.rows.map((r) => (
                <li key={r._id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link className="ltr-nums font-medium hover:text-brand-600" to={`/deals/${r._id}`}>{r.dealNo}</Link>
                  <span className="text-muted">{r.title}</span>
                  <span className="ltr-nums ms-auto text-xs text-muted">{r.sharePct}% · {t('finance5b.earned')} {formatPkr(r.earned)} · {t('deal.owed')} {formatPkr(r.owed)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
