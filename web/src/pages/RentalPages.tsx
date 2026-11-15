import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, KeyRound, Plus, RefreshCcw, Wallet } from 'lucide-react';
import { INSPECTION_TYPES, LATE_FEE_TYPES, LEASE_STATUSES, PAYMENT_METHODS, PERMISSIONS, type RentItemStatus } from '@recrm/shared';
import { clientApi, leaseApi, propertyApi } from '@/api/endpoints';
import type { Lease } from '@/api/types';
import { ReceiptButton } from '@/pages/InstallmentPages';
import { LeaseExpensesPanel, LeaseNoticesPanel } from '@/pages/OpsPages';
import { TransactionFormDrawer } from '@/pages/FinancePages';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, ErrorState, Input, MetricTile, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, type BadgeColor, type Column } from '@/components/ui';
import { formatDate, formatPkr, toLocalInput } from '@/lib/format';
import { useDebounce, useEnumOptions, useOnError, useOpenOnNew, useUrlState } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const ITEM_COLOR: Record<RentItemStatus, BadgeColor> = { PENDING: 'gray', PARTIAL: 'amber', PAID: 'green', OVERDUE: 'red', WAIVED: 'purple' };
const LEASE_COLOR: Record<string, BadgeColor> = { DRAFT: 'gray', ACTIVE: 'green', ENDED: 'blue', TERMINATED: 'red' };
const label = (v: unknown, k: 'fullName' | 'propertyId') => (v && typeof v === 'object' && k in v ? String((v as Record<string, unknown>)[k]) : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : String(v ?? ''));
const today = () => toLocalInput(new Date()).slice(0, 10);

/* ═════════════ List + rent roll ═════════════ */

export function RentalsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useCan(PERMISSIONS.RENTALS_MANAGE);
  const [filters, setFilters] = useUrlState({ q: '', status: 'ACTIVE', overdue: '', page: '1' });
  const [formOpen, setFormOpen] = useState(false);
  useOpenOnNew(() => setFormOpen(true));
  const q = useDebounce(filters.q, 300);
  const page = Number(filters.page);
  const query = useQuery({ queryKey: ['leases', { ...filters, q }], queryFn: () => leaseApi.list({ ...filters, q, page, limit: 20 }), placeholderData: (p) => p });
  const roll = useQuery({ queryKey: ['leases', 'rent-roll'], queryFn: () => leaseApi.rentRoll() });
  const statuses = useEnumOptions('leaseStatus', LEASE_STATUSES);
  const columns: Column<Lease>[] = [
    { key: 'no', header: t('rental.lease'), render: (l) => <span className="ltr-nums font-bold text-brand-600">{l.leaseNo}</span> },
    { key: 'property', header: t('nav.properties'), render: (l) => <span className="whitespace-nowrap">{label(l.propertyId, 'propertyId')}</span> },
    { key: 'tenant', header: t('rental.tenant'), render: (l) => label(l.tenantId, 'fullName') },
    { key: 'rent', header: t('rental.monthlyRent'), render: (l) => <span className="ltr-nums whitespace-nowrap font-semibold">{formatPkr(l.monthlyRent)}</span> },
    { key: 'overdue', header: t('rental.overdue'), render: (l) => (l.overdueAmount ? <span className="ltr-nums font-semibold text-red-600">{formatPkr(l.overdueAmount)}</span> : <span className="text-subtle">—</span>) },
    { key: 'next', header: t('rental.nextDue'), render: (l) => (l.nextDueDate ? formatDate(l.nextDueDate) : '—') },
    { key: 'end', header: t('rental.endDate'), render: (l) => formatDate(l.endDate) },
    { key: 'status', header: t('common.status'), render: (l) => <Badge color={LEASE_COLOR[l.status]}>{t(`enums.leaseStatus.${l.status}`)}</Badge> },
  ];
  const r = roll.data;
  return (
    <div>
      <PageHeader title={t('rental.title')} subtitle={t('rental.subtitle')} actions={canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>{t('rental.add')}</Button>} />
      {r && (
        <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile tone="brand" label={t('rental.activeLeases')} value={r.activeLeases} />
          <MetricTile label={t('rental.rentRoll')} value={formatPkr(r.monthlyRentRoll)} />
          <MetricTile tone="good" label={t('rental.collectedThisMonth')} value={`${formatPkr(r.collectedThisMonth)} / ${formatPkr(r.dueThisMonth)}`} />
          <MetricTile tone="bad" label={t('rental.overdue')} value={formatPkr(r.overdue)} />
          <MetricTile tone="warn" label={t('rental.expiringSoon')} value={r.expiringSoon} />
        </div>
      )}
      <Card className="mb-4" bodyClassName="flex flex-wrap gap-2 !p-3">
        <Input wrapperClassName="min-w-[14rem] flex-1" placeholder={t('rental.search')} value={filters.q} onChange={(e) => setFilters({ q: e.target.value, page: '1' })} />
        <Select wrapperClassName="w-44" placeholder={`${t('common.status')}: ${t('common.all')}`} options={statuses} value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })} />
        <Select wrapperClassName="w-44" placeholder={t('rental.allLeases')} options={[{ value: 'true', label: t('rental.overdueOnly') }]} value={filters.overdue} onChange={(e) => setFilters({ overdue: e.target.value, page: '1' })} />
      </Card>
      <Card bodyClassName="!p-0">
        <DataTable columns={columns} query={query} page={page} onPage={(p) => setFilters({ page: String(p) })} onRowClick={(l) => navigate(`/leases/${l._id}`)} empty={<EmptyState title={t('rental.empty')} hint={t('rental.emptyHint')} icon={<KeyRound className="h-6 w-6" />} action={canManage && <Button onClick={() => setFormOpen(true)}>{t('rental.add')}</Button>} />} />
      </Card>
      {formOpen && <LeaseFormDrawer onClose={() => setFormOpen(false)} />}
    </div>
  );
}

function LeaseFormDrawer({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onError = useOnError();
  const [ps, setPs] = useState('');
  const [cs, setCs] = useState('');
  const properties = useQuery({ queryKey: ['properties', 'pick-rent', useDebounce(ps, 250)], queryFn: () => propertyApi.list({ q: ps, limit: 30, listingPurpose: 'RENT' }) });
  const clients = useQuery({ queryKey: ['clients', 'pick-tenant', useDebounce(cs, 250)], queryFn: () => clientApi.list({ q: cs, limit: 30 }) });
  const lateTypes = useEnumOptions('lateFeeType', LATE_FEE_TYPES);
  const [f, setF] = useState({ propertyId: '', tenantId: '', startDate: today(), endDate: '', monthlyRent: '', dueDay: '5', escalationPct: '10', graceDays: '5', lateFeeType: 'NONE', lateFeeValue: '', securityDeposit: '', managementFeePct: '', notes: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const save = useMutation({
    mutationFn: () =>
      leaseApi.create({
        propertyId: f.propertyId,
        tenantId: f.tenantId,
        startDate: f.startDate,
        endDate: f.endDate,
        monthlyRent: num(f.monthlyRent),
        dueDay: num(f.dueDay),
        escalationPct: num(f.escalationPct),
        graceDays: num(f.graceDays),
        lateFeeType: f.lateFeeType,
        lateFeeValue: num(f.lateFeeValue),
        securityDeposit: num(f.securityDeposit),
        managementFeePct: num(f.managementFeePct),
        notes: f.notes || undefined,
      }),
    onSuccess: (l) => {
      toast.success(t('rental.created'));
      void qc.invalidateQueries({ queryKey: ['leases'] });
      onClose();
      navigate(`/leases/${l._id}`);
    },
    onError,
  });
  return (
    <Drawer open onClose={onClose} title={t('rental.add')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} disabled={!f.propertyId || !f.tenantId || !f.endDate || !f.monthlyRent} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('rental.findProperty')} value={ps} onChange={(e) => setPs(e.target.value)} placeholder={t('property.searchPlaceholder')} />
        <Select label={t('nav.properties')} required placeholder="—" options={(properties.data?.items ?? []).map((p) => ({ value: p._id, label: `${p.propertyId} · ${[p.block, p.society].filter(Boolean).join(', ')} · ${formatPkr(p.askingPrice)}` }))} value={f.propertyId} onChange={(e) => { const p = properties.data?.items.find((x) => x._id === e.target.value); setF((x) => ({ ...x, propertyId: e.target.value, monthlyRent: x.monthlyRent || String(p?.askingPrice ?? '') })); }} />
        <Input label={t('rental.findTenant')} value={cs} onChange={(e) => setCs(e.target.value)} placeholder={t('client.searchPlaceholder')} />
        <Select label={t('rental.tenant')} required placeholder="—" options={(clients.data?.items ?? []).map((c) => ({ value: c._id, label: `${c.fullName} · ${c.mobileNumber}` }))} value={f.tenantId} onChange={set('tenantId')} />
        <Input label={t('rental.startDate')} type="date" required value={f.startDate} onChange={set('startDate')} />
        <Input label={t('rental.endDate')} type="date" required value={f.endDate} onChange={set('endDate')} />
        <Input label={t('rental.monthlyRent')} type="number" min={1} required value={f.monthlyRent} onChange={set('monthlyRent')} />
        <Input label={t('rental.securityDeposit')} type="number" min={0} value={f.securityDeposit} onChange={set('securityDeposit')} />
        <Input label={t('rental.dueDay')} type="number" min={1} max={28} value={f.dueDay} onChange={set('dueDay')} />
        <Input label={t('rental.escalation')} type="number" min={0} max={100} value={f.escalationPct} onChange={set('escalationPct')} hint={t('rental.escalationHint')} />
        <Input label={t('rental.graceDays')} type="number" min={0} max={60} value={f.graceDays} onChange={set('graceDays')} />
        <Select label={t('rental.lateFee')} options={lateTypes} value={f.lateFeeType} onChange={set('lateFeeType')} />
        {f.lateFeeType !== 'NONE' && <Input label={f.lateFeeType === 'PERCENT' ? t('rental.lateFeePct') : t('rental.lateFeeAmount')} type="number" min={0} value={f.lateFeeValue} onChange={set('lateFeeValue')} />}
        <Input label={t('rental.managementFee')} type="number" min={0} max={100} value={f.managementFeePct} onChange={set('managementFeePct')} hint={t('rental.managementFeeHint')} />
        <Textarea label={t('common.notes')} value={f.notes} onChange={set('notes')} wrapperClassName="sm:col-span-2" />
      </div>
    </Drawer>
  );
}

/* ═════════════ Lease detail ═════════════ */

export function LeaseDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.RENTALS_MANAGE);
  const q = useQuery({ queryKey: ['lease', id], queryFn: () => leaseApi.get(id) });
  const [tab, setTab] = useState<'schedule' | 'payments' | 'inspections' | 'notices' | 'expenses'>('schedule');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const canFinance = useCan(PERMISSIONS.FINANCE_CREATE);
  const [paying, setPaying] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['lease', id] }), void qc.invalidateQueries({ queryKey: ['leases'] }));
  const waive = useMutation({ mutationFn: (v: { itemId: string; reason: string }) => leaseApi.waive(id, v.itemId, v.reason), onSuccess: refresh, onError });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;
  const l = q.data;
  const s = l.summary;
  const active = l.status === 'ACTIVE';
  return (
    <div>
      <PageHeader
        eyebrow={<Link to="/leases" className="hover:text-brand-600">{t('rental.title')}</Link>}
        title={<span className="flex flex-wrap items-center gap-2"><span className="ltr-nums">{l.leaseNo}</span><Badge color={LEASE_COLOR[l.status]}>{t(`enums.leaseStatus.${l.status}`)}</Badge></span>}
        subtitle={
          <>
            <Link className="hover:text-brand-600" to={`/properties/${refId(l.propertyId)}`}>{label(l.propertyId, 'propertyId')}</Link> · {t('rental.tenant')}:{' '}
            <Link className="hover:text-brand-600" to={`/clients/${refId(l.tenantId)}`}>{label(l.tenantId, 'fullName')}</Link>
            {l.landlordId && <> · {t('rental.landlord')}: <Link className="hover:text-brand-600" to={`/owners/${refId(l.landlordId)}`}>{label(l.landlordId, 'fullName')}</Link></>}
          </>
        }
        actions={
          canManage && active && (
            <>
              <Button icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(true)}>{t('rental.recordRent')}</Button>
              <Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setInspecting(true)}>{t('rental.inspection')}</Button>
              <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} onClick={() => setRenewing(true)}>{t('rental.renew')}</Button>
              <Button variant="ghost" onClick={() => setEnding(true)}>{t('rental.end')}</Button>
            </>
          )
        }
      />
      <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile tone="brand" label={t('rental.monthlyRent')} value={formatPkr(l.monthlyRent)} />
        <MetricTile tone="good" label={t('rental.paid')} value={formatPkr(s.totalPaid)} />
        <MetricTile tone="bad" label={t('rental.overdue')} value={formatPkr(s.overdue)} />
        <MetricTile tone="warn" label={t('rental.nextDue')} value={s.nextDue ? `${formatPkr(s.nextDue.balance)} · ${formatDate(s.nextDue.dueDate)}` : '—'} />
      </div>
      <Card className="mb-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t('rental.period'), `${formatDate(l.startDate)} – ${formatDate(l.endDate)}`],
            [t('rental.dueDay'), String(l.dueDay)],
            [t('rental.escalation'), `${l.escalationPct}%`],
            [t('rental.graceDays'), String(l.graceDays)],
            [t('rental.lateFee'), l.lateFeeType === 'NONE' ? t('enums.lateFeeType.NONE') : l.lateFeeType === 'PERCENT' ? `${l.lateFeeValue}%` : formatPkr(l.lateFeeValue)],
            [t('rental.securityDeposit'), `${formatPkr(l.securityDeposit)} · ${t(`enums.depositStatus.${l.depositStatus}`)}`],
            [t('rental.managementFee'), `${l.managementFeePct}%`],
            [t('rental.credit'), formatPkr(l.credit)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="ltr-nums font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {l.endReason && <p className="mt-3 text-sm text-muted">{t('rental.endReason')}: {l.endReason}</p>}
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'schedule', label: t('rental.schedule'), count: s.overdueItems || undefined }, { value: 'payments', label: t('rental.payments'), count: l.payments.length || undefined }, { value: 'inspections', label: t('rental.inspections') }, { value: 'notices', label: t('ops.notices'), count: l.notices?.length || undefined }, { value: 'expenses', label: t('ops.maintenance') }]} />
      <div className="mt-4">
        {tab === 'schedule' && (
          <Card bodyClassName="!p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted">
                <tr><th className="px-4 py-2 text-start">{t('rental.month')}</th><th className="px-4 py-2 text-start">{t('rental.due')}</th><th className="px-4 py-2 text-end">{t('rental.rent')}</th><th className="px-4 py-2 text-end">{t('rental.lateFee')}</th><th className="px-4 py-2 text-end">{t('rental.paid')}</th><th className="px-4 py-2 text-start">{t('common.status')}</th><th /></tr>
              </thead>
              <tbody>
                {l.schedule.map((i) => (
                  <tr key={i._id} className="border-t border-line">
                    <td className="ltr-nums px-4 py-2 font-medium">{i.period}</td>
                    <td className="ltr-nums px-4 py-2">{formatDate(i.dueDate)}</td>
                    <td className="ltr-nums px-4 py-2 text-end">{formatPkr(i.amount)}</td>
                    <td className="ltr-nums px-4 py-2 text-end">{i.lateFee ? formatPkr(i.lateFee) : '—'}</td>
                    <td className="ltr-nums px-4 py-2 text-end">{i.paid ? formatPkr(i.paid) : '—'}</td>
                    <td className="px-4 py-2"><Badge color={ITEM_COLOR[i.status]}>{t(`enums.rentStatus.${i.status}`)}</Badge>{i.waivedReason && <span className="ms-2 text-xs text-muted">{i.waivedReason}</span>}</td>
                    <td className="px-4 py-2 text-end">
                      {canManage && active && !i.paid && i.status !== 'WAIVED' && (
                        <button className="text-xs text-muted hover:text-brand-600" onClick={() => { const reason = window.prompt(t('rental.waiveReason')); if (reason) waive.mutate({ itemId: i._id, reason }); }}>{t('rental.waive')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        {tab === 'payments' && (
          <Card bodyClassName="!p-0">
            {!l.payments.length ? (
              <EmptyState title={t('rental.noPayments')} icon={<Wallet className="h-6 w-6" />} />
            ) : (
              <ul className="divide-y divide-line">
                {[...l.payments].reverse().map((p) => (
                  <li key={p._id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="ltr-nums font-bold">{formatPkr(p.amount)}</span>
                    <Badge color="gray">{t(`enums.paymentMethod.${p.method}`)}</Badge>
                    {p.reference && <span className="text-xs text-muted">{p.reference}</span>}
                    <span className="ltr-nums ms-auto text-xs text-muted">{formatDate(p.date)} · {p.allocations.map((a) => l.schedule.find((i) => i._id === a.itemId)?.period).filter(Boolean).join(', ')}</span>
                    <ReceiptButton kind="lease" id={l._id} paymentId={p._id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tab === 'notices' && <LeaseNoticesPanel leaseId={id} notices={l.notices ?? []} canManage={canManage && active} tenantPhone={typeof l.tenantId === 'object' ? l.tenantId.mobileNumber : null} />}
        {tab === 'expenses' && <LeaseExpensesPanel leaseId={id} onAdd={canFinance ? () => setExpenseOpen(true) : undefined} />}
        {tab === 'inspections' && (
          <Card bodyClassName="!p-0">
            {!l.inspections.length ? (
              <EmptyState title={t('rental.noInspections')} icon={<CalendarClock className="h-6 w-6" />} />
            ) : (
              <ul className="divide-y divide-line">
                {[...l.inspections].reverse().map((i) => (
                  <li key={i._id} className="px-4 py-3 text-sm">
                    <p className="font-semibold">{t(`enums.inspectionType.${i.type}`)} · {t(`enums.propertyCondition.${i.condition}`)} <span className="ltr-nums ms-2 text-xs font-normal text-muted">{formatDate(i.date)}</span></p>
                    {i.notes && <p className="mt-1 text-muted">{i.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      {expenseOpen && <TransactionFormDrawer onClose={() => setExpenseOpen(false)} defaults={{ type: 'EXPENSE', leaseId: id, categoryKey: 'MAINTENANCE', onSaved: () => void qc.invalidateQueries({ queryKey: ['lease', id, 'expenses'] }) }} />}
      <PaymentModal open={paying} leaseId={id} suggested={s.overdue || s.nextDue?.balance || l.monthlyRent} onClose={() => setPaying(false)} onDone={refresh} />
      <RenewModal open={renewing} lease={l} onClose={() => setRenewing(false)} onDone={refresh} />
      <EndModal open={ending} lease={l} onClose={() => setEnding(false)} onDone={refresh} />
      <InspectionModal open={inspecting} leaseId={id} onClose={() => setInspecting(false)} onDone={refresh} />
    </div>
  );
}

function PaymentModal({ open, leaseId, suggested, onClose, onDone }: { open: boolean; leaseId: string; suggested: number; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const methods = useEnumOptions('paymentMethod', PAYMENT_METHODS);
  const [f, setF] = useState({ amount: '', date: today(), method: 'CASH', reference: '' });
  const save = useMutation({
    mutationFn: () => leaseApi.pay(leaseId, { amount: Number(f.amount || suggested), date: f.date, method: f.method, reference: f.reference || undefined }),
    onSuccess: () => (toast.success(t('rental.rentRecorded')), onDone(), onClose()),
    onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('rental.recordRent')} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('rental.amount')} type="number" min={1} placeholder={String(suggested)} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} hint={t('rental.allocationHint')} />
        <Input label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Select label={t('deal.method')} options={methods} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
        <Input label={t('deal.reference')} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      </div>
    </Modal>
  );
}

function RenewModal({ open, lease, onClose, onDone }: { open: boolean; lease: Lease; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const [f, setF] = useState({ endDate: '', monthlyRent: '' });
  const save = useMutation({
    mutationFn: () => leaseApi.renew(lease._id, { endDate: f.endDate, ...(f.monthlyRent ? { monthlyRent: Number(f.monthlyRent) } : {}) }),
    onSuccess: () => (toast.success(t('rental.renewed')), onDone(), onClose()),
    onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('rental.renew')} footer={<Button disabled={!f.endDate} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('rental.newEndDate')} type="date" min={lease.endDate.slice(0, 10)} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        <Input label={t('rental.newRent')} type="number" min={1} placeholder={String(lease.schedule[lease.schedule.length - 1]?.amount ?? lease.monthlyRent)} value={f.monthlyRent} onChange={(e) => setF({ ...f, monthlyRent: e.target.value })} />
      </div>
    </Modal>
  );
}

function EndModal({ open, lease, onClose, onDone }: { open: boolean; lease: Lease; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const [f, setF] = useState({ status: 'ENDED', date: today(), reason: '', depositRefund: '', relist: true });
  const save = useMutation({
    mutationFn: () => leaseApi.end(lease._id, { status: f.status, date: f.date, reason: f.reason || undefined, depositRefund: f.depositRefund ? Number(f.depositRefund) : undefined, relist: f.relist }),
    onSuccess: () => (toast.success(t('rental.ended')), onDone(), onClose()),
    onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('rental.end')} footer={<Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>{t('common.confirm')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('common.status')} options={[{ value: 'ENDED', label: t('enums.leaseStatus.ENDED') }, { value: 'TERMINATED', label: t('enums.leaseStatus.TERMINATED') }]} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} />
        <Input label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label={t('rental.depositRefund')} type="number" min={0} max={lease.securityDeposit} placeholder={String(lease.securityDeposit)} value={f.depositRefund} onChange={(e) => setF({ ...f, depositRefund: e.target.value })} />
        <Input label={t('rental.endReason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.relist} onChange={(e) => setF({ ...f, relist: e.target.checked })} />{t('rental.relist')}</label>
      </div>
    </Modal>
  );
}

function InspectionModal({ open, leaseId, onClose, onDone }: { open: boolean; leaseId: string; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const types = useEnumOptions('inspectionType', INSPECTION_TYPES);
  const conditions = useEnumOptions('propertyCondition', ['EXCELLENT', 'GOOD', 'FAIR', 'POOR']);
  const [f, setF] = useState({ type: 'ROUTINE', condition: 'GOOD', date: today(), notes: '' });
  const save = useMutation({
    mutationFn: () => leaseApi.inspect(leaseId, { ...f, notes: f.notes || undefined }),
    onSuccess: () => (toast.success(t('common.saved')), onDone(), onClose()),
    onError,
  });
  return (
    <Modal open={open} onClose={onClose} title={t('rental.inspection')} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label={t('common.type')} options={types} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} />
        <Select label={t('rental.condition')} options={conditions} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
        <Input label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Textarea label={t('common.notes')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} wrapperClassName="sm:col-span-3" />
      </div>
    </Modal>
  );
}
