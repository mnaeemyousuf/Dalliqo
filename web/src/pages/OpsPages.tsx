import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleX, Download, FileDown, Printer, ReceiptText, Target, Undo2, Users } from 'lucide-react';
import { PAYMENT_METHODS, PERMISSIONS, PROPERTY_TYPES } from '@recrm/shared';
import { aiApi, followUpApi, inquiryApi, leaseApi, opsApi, portalSettingsApi } from '@/api/endpoints';
import type { Transaction } from '@/api/types';
import { useBranches } from '@/components/branches';
import { Badge, Button, Card, EmptyState, Input, MetricTile, Modal, Select, Switch, Textarea } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useEnumOptions, useErrorText, useMembers, useOnError } from '@/lib/hooks';
import { useCan, useModule } from '@/store/auth';
import { toast } from '@/store/toast';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

function DownloadButton({ label, run, icon }: { label: string; run(): Promise<unknown>; icon?: React.ReactNode }) {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} icon={icon ?? <FileDown className="h-3.5 w-3.5" />} onClick={async () => {
      setBusy(true);
      try {
        await run();
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        setBusy(false);
      }
    }}>{label}</Button>
  );
}

/* ═════════════ Finance: refunds & vouchers ═════════════ */

export function RefundButton({ entry }: { entry: Transaction }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const can = useCan(PERMISSIONS.FINANCE_CREATE);
  const methods = useEnumOptions('paymentMethod', PAYMENT_METHODS);
  const [open, setOpen] = useState(false);
  const left = entry.amount - (entry.refundedAmount ?? 0);
  const [f, setF] = useState({ amount: '', date: today(), method: entry.method ?? 'CASH', reason: '' });
  const save = useMutation({
    mutationFn: () => opsApi.refund(entry._id, { amount: Number(f.amount), date: f.date, method: f.method, reason: f.reason }),
    onSuccess: () => (toast.success(t('ops.refunded')), void qc.invalidateQueries({ queryKey: ['transactions'] }), void qc.invalidateQueries({ queryKey: ['reports'] }), setOpen(false)),
    onError,
  });
  if (!can || entry.type !== 'INCOME' || left <= 0) return null;
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={t('ops.refund')} title={t('ops.refund')} onClick={() => setOpen(true)}><Undo2 className="h-4 w-4" /></Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('ops.refund')} footer={<Button disabled={!(Number(f.amount) > 0) || Number(f.amount) > left || f.reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
        <p className="mb-3 text-xs text-muted">{t('ops.refundHint', { left: formatPkr(left) })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('finance.amount')} type="number" min={1} max={left} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Input label={t('common.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Select label={t('deal.method')} options={methods} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as never })} />
          <Input label={t('deal.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}

export function VoucherButton({ kind, id, subId }: { kind: 'transaction' | 'payout'; id: string; subId?: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  return (
    <button type="button" title={t('ops.voucher')} aria-label={t('ops.voucher')} className="inline-flex items-center gap-1 rounded p-1 text-xs text-muted hover:text-brand-600" onClick={() => opsApi.voucher(kind, id, subId).catch((e) => toast.error(errorText(e)))}>
      <ReceiptText className="h-4 w-4" />
    </button>
  );
}

/* ═════════════ Reports ═════════════ */

export function IncomeStatementCard() {
  const { t, i18n } = useTranslation();
  const [p, setP] = useState({ from: monthStart(), to: today() });
  const q = useQuery({ queryKey: ['reports', 'income-statement', p], queryFn: () => opsApi.incomeStatement(p) });
  const d = q.data;
  const name = (r: { name: string; nameUr?: string | null }) => (i18n.language === 'ur' && r.nameUr ? r.nameUr : r.name);
  return (
    <Card title={t('ops.incomeStatement')} actions={<span className="flex gap-2 print:hidden"><Input aria-label={t('common.from')} type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /><Input aria-label={t('common.to')} type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /><Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>{t('ops.print')}</Button></span>}>
      {!d ? <div className="h-24 animate-pulse rounded bg-surface-2" /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile tone="good" label={t('finance.income')} value={formatPkr(d.totals.income)} />
            <MetricTile tone="bad" label={t('finance.expense')} value={formatPkr(d.totals.expense)} />
            <MetricTile tone="brand" label={t('ops.netProfit')} value={formatPkr(d.totals.net)} />
            <MetricTile label={t('ops.margin')} value={d.totals.marginPct === null ? '—' : `${d.totals.marginPct}%`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {([['income', d.income, 'text-emerald-600'], ['expense', d.expenses, 'text-red-600']] as const).map(([k, rows, tone]) => (
              <div key={k}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t(`finance.${k}`)}</p>
                {!rows.length ? <p className="text-sm text-muted">—</p> : (
                  <ul className="divide-y divide-line text-sm">{rows.map((r) => <li key={r.categoryId} className="flex justify-between py-1"><span>{name(r)}</span><span className={`ltr-nums font-medium ${tone}`}>{formatPkr(r.total)}</span></li>)}</ul>
                )}
              </div>
            ))}
          </div>
          {d.branches.length > 1 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t('ops.byBranch')}</p>
              <ul className="divide-y divide-line text-sm">{d.branches.map((b) => <li key={b.branchId} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 py-1"><span>{b.name}</span><span className="ltr-nums text-emerald-600">{formatPkr(b.income)}</span><span className="ltr-nums text-red-600">{formatPkr(b.expense)}</span><span className="ltr-nums font-semibold">{formatPkr(b.net)}</span></li>)}</ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function BusinessSummaryCard() {
  const { t } = useTranslation();
  const branches = useBranches();
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  const [p, setP] = useState({ from: monthStart(), to: today(), branchId: '', propertyType: '' });
  const q = useQuery({ queryKey: ['reports', 'business-summary', p], queryFn: () => opsApi.businessSummary(p) });
  const d = q.data;
  return (
    <Card title={t('ops.businessSummary')} actions={
      <span className="flex flex-wrap gap-2">
        <Input aria-label={t('common.from')} type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
        <Input aria-label={t('common.to')} type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
        {(branches.data?.length ?? 0) > 1 && <Select aria-label={t('branch.title', { defaultValue: 'Branch' })} placeholder={t('ops.allBranches')} options={(branches.data ?? []).map((b) => ({ value: b._id, label: b.name }))} value={p.branchId} onChange={(e) => setP({ ...p, branchId: e.target.value })} />}
        <Select aria-label={t('property.type')} placeholder={t('ops.allTypes')} options={types} value={p.propertyType} onChange={(e) => setP({ ...p, propertyType: e.target.value })} />
      </span>
    }>
      {!d ? <div className="h-24 animate-pulse rounded bg-surface-2" /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <MetricTile label={t('ops.properties')} value={`${d.properties.active} / ${d.properties.total}`} />
          <MetricTile tone="good" label={t('ops.verified')} value={d.properties.verified} />
          <MetricTile tone="warn" label={t('ops.unsold90')} value={d.properties.over90Days} />
          <MetricTile tone="brand" label={t('ops.newLeads')} value={d.leads.new} />
          <MetricTile label={t('ops.conversion')} value={d.leads.conversionPct === null ? '—' : `${d.leads.conversionPct}%`} />
          <MetricTile label={t('ops.activeDeals')} value={d.deals.active} />
          <MetricTile tone="good" label={t('ops.closedDeals')} value={d.deals.closed} />
          <MetricTile label={t('ops.transactionValue')} value={formatPkr(d.deals.transactionValue)} />
          <MetricTile label={t('ops.daysToClose')} value={d.deals.avgDaysToClose ?? '—'} />
          <MetricTile tone="good" label={t('ops.commissionReceived')} value={formatPkr(d.commission.received)} />
          <MetricTile tone="warn" label={t('ops.commissionOutstanding')} value={formatPkr(d.commission.outstanding)} />
          <MetricTile tone={d.finance.netProfit < 0 ? 'bad' : 'brand'} label={t('ops.netProfit')} value={formatPkr(d.finance.netProfit)} />
        </div>
      )}
    </Card>
  );
}

export function AgentPerformanceCard() {
  const { t } = useTranslation();
  const branches = useBranches();
  const members = useMembers();
  const canAll = useCan(PERMISSIONS.DEALS_READ_ALL);
  const [p, setP] = useState({ from: monthStart(), to: today(), branchId: '', agentId: '' });
  const q = useQuery({ queryKey: ['reports', 'agent-performance', p], queryFn: () => opsApi.agentPerformance(p) });
  const head = ['ops.agent', 'ops.assigned', 'ops.contacted', 'ops.followUpsDone', 'ops.siteVisits', 'ops.negotiations', 'ops.dealsClosed', 'ops.commission', 'ops.conversion', 'ops.responseMin'];
  return (
    <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-600" />{t('ops.agentPerformance')}</span>} actions={
      <span className="flex flex-wrap gap-2">
        <Input aria-label={t('common.from')} type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
        <Input aria-label={t('common.to')} type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
        {(branches.data?.length ?? 0) > 1 && <Select aria-label="branch" placeholder={t('ops.allBranches')} options={(branches.data ?? []).map((b) => ({ value: b._id, label: b.name }))} value={p.branchId} onChange={(e) => setP({ ...p, branchId: e.target.value })} />}
        {canAll && <Select aria-label={t('ops.agent')} placeholder={t('ops.allAgents')} options={members.options} value={p.agentId} onChange={(e) => setP({ ...p, agentId: e.target.value })} />}
        <DownloadButton label="Excel" icon={<Download className="h-3.5 w-3.5" />} run={() => opsApi.agentPerformanceFile(p, 'xlsx')} />
        <DownloadButton label="PDF" run={() => opsApi.agentPerformanceFile(p, 'pdf')} />
      </span>
    } bodyClassName="!p-0">
      {!q.data ? <div className="m-4 h-24 animate-pulse rounded bg-surface-2" /> : !q.data.rows.length ? <p className="p-4 text-sm text-muted">—</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted"><tr>{head.map((h, i) => <th key={h} className={`whitespace-nowrap px-3 py-2 ${i ? 'text-end' : 'text-start'}`}>{t(h)}</th>)}</tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.userId} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{r.fullName}</td>
                  {[r.leadsAssigned, r.leadsContacted, r.followUpsCompleted, r.siteVisits, r.negotiations, r.dealsClosed].map((v, i) => <td key={i} className="ltr-nums px-3 py-2 text-end">{v}</td>)}
                  <td className="ltr-nums whitespace-nowrap px-3 py-2 text-end font-semibold">{formatPkr(r.commission)}</td>
                  <td className="ltr-nums px-3 py-2 text-end">{r.conversionPct === null ? '—' : `${r.conversionPct}%`}</td>
                  <td className="ltr-nums px-3 py-2 text-end">{r.avgResponseMinutes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function BranchTargetsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.BRANCHES_MANAGE);
  const multi = useModule('branches');
  const q = useQuery({ queryKey: ['reports', 'branches'], queryFn: () => opsApi.branches({}) });
  const [editing, setEditing] = useState<{ branchId: string; name: string; leads: string; dealsWon: string; commission: string } | null>(null);
  const save = useMutation({
    mutationFn: () => opsApi.setBranchTargets(editing!.branchId, { leads: editing!.leads ? Number(editing!.leads) : null, dealsWon: editing!.dealsWon ? Number(editing!.dealsWon) : null, commission: editing!.commission ? Number(editing!.commission) : null }),
    onSuccess: () => (toast.success(t('common.saved')), void qc.invalidateQueries({ queryKey: ['reports', 'branches'] }), setEditing(null)),
    onError,
  });
  if (!multi || !q.data?.rows.length) return null;
  const bar = (pct: number | null) => pct === null ? <span className="text-xs text-muted">{t('ops.noTarget')}</span> : (
    <span className="flex items-center gap-2"><span className="h-2 w-24 rounded-full bg-surface-2"><span className={`block h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></span><span className="ltr-nums text-xs">{pct}%</span></span>
  );
  return (
    <Card title={<span className="flex items-center gap-2"><Target className="h-4 w-4 text-brand-600" />{t('ops.branchTargets')}</span>} bodyClassName="!p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted"><tr><th className="px-3 py-2 text-start">{t('ops.branch')}</th><th className="px-3 py-2 text-start">{t('ops.newLeads')}</th><th className="px-3 py-2 text-start">{t('ops.closedDeals')}</th><th className="px-3 py-2 text-start">{t('ops.commissionReceived')}</th><th className="px-3 py-2 text-end">{t('ops.netProfit')}</th><th /></tr></thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.branchId} className="border-t border-line">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2"><span className="ltr-nums">{r.leads}{r.targets.leads ? ` / ${r.targets.leads}` : ''}</span>{bar(r.progress.leads)}</td>
                <td className="px-3 py-2"><span className="ltr-nums">{r.dealsWon}{r.targets.dealsWon ? ` / ${r.targets.dealsWon}` : ''}</span>{bar(r.progress.dealsWon)}</td>
                <td className="px-3 py-2"><span className="ltr-nums">{formatPkr(r.commission)}{r.targets.commission ? ` / ${formatPkr(r.targets.commission)}` : ''}</span>{bar(r.progress.commission)}</td>
                <td className="ltr-nums px-3 py-2 text-end font-semibold">{formatPkr(r.net)}</td>
                <td className="px-3 py-2 text-end">{canManage && <Button size="sm" variant="ghost" onClick={() => setEditing({ branchId: r.branchId, name: r.name, leads: String(r.targets.leads ?? ''), dealsWon: String(r.targets.dealsWon ?? ''), commission: String(r.targets.commission ?? '') })}>{t('ops.setTargets')}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`${t('ops.setTargets')} — ${editing.name}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
          <p className="mb-3 text-xs text-muted">{t('ops.targetsHint')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={t('ops.newLeads')} type="number" min={0} value={editing.leads} onChange={(e) => setEditing({ ...editing, leads: e.target.value })} />
            <Input label={t('ops.closedDeals')} type="number" min={0} value={editing.dealsWon} onChange={(e) => setEditing({ ...editing, dealsWon: e.target.value })} />
            <Input label={t('ops.commissionReceived')} type="number" min={0} value={editing.commission} onChange={(e) => setEditing({ ...editing, commission: e.target.value })} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ═════════════ Property: quality & interest ═════════════ */

export function ListingQuality({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['ai', 'quality', propertyId], queryFn: () => aiApi.quality(propertyId) });
  const d = q.data;
  if (!d) return null;
  const color = d.grade === 'GOOD' ? 'green' : d.grade === 'FAIR' ? 'amber' : 'red';
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">{t('ops.quality')} <Badge color={color}>{d.score}/100 · {t(`ops.grade.${d.grade}`)}</Badge></p>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {d.checks.map((c) => <li key={c.key} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <CircleX className="h-3.5 w-3.5 text-red-500" />}<span className={c.ok ? 'text-muted' : ''}>{t(`ops.check.${c.key}`)}</span></li>)}
      </ul>
    </div>
  );
}

export function PropertyInterestPanel({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const canClients = useCan(PERMISSIONS.CLIENTS_READ);
  const inquiries = useQuery({ queryKey: ['inquiries', 'property', propertyId], queryFn: () => inquiryApi.list({ propertyId, limit: 50 }), enabled: canClients });
  const visits = useQuery({ queryKey: ['followups', 'visits', propertyId], queryFn: () => followUpApi.list({ propertyId, type: 'PROPERTY_VISIT', limit: 50 }) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('ops.inquiryHistory')}>
        {!inquiries.data?.items.length ? <EmptyState title={t('ops.noInquiries')} /> : (
          <ul className="divide-y divide-line text-sm">
            {inquiries.data.items.map((i) => (
              <li key={i._id} className="flex flex-wrap items-center gap-2 py-2">
                {i.clientId ? <Link className="font-medium hover:text-brand-600" to={`/clients/${i.clientId}`}>{i.name}</Link> : <span className="font-medium">{i.name}</span>}
                <Badge color={i.channel === 'WHATSAPP' ? 'green' : 'blue'}>{i.channel === 'WHATSAPP' ? 'WhatsApp' : t('marketing.website')}</Badge>
                {i.message && <span className="line-clamp-1 text-xs text-muted">{i.message}</span>}
                <span className="ltr-nums ms-auto text-xs text-muted">{formatDate(i.createdAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('ops.viewingHistory')}>
        {!visits.data?.items.length ? <EmptyState title={t('ops.noViewings')} /> : (
          <ul className="divide-y divide-line text-sm">
            {visits.data.items.map((v) => (
              <li key={v._id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{typeof v.clientId === 'object' && v.clientId ? (v.clientId as { fullName?: string }).fullName : ''}</span>
                <Badge color={v.status === 'COMPLETED' ? 'green' : v.status === 'OVERDUE' ? 'red' : 'gray'}>{t(`enums.followUpStatus.${v.status}`)}</Badge>
                {v.outcome && <span className="line-clamp-1 text-xs text-muted">{v.outcome}</span>}
                <span className="ltr-nums ms-auto text-xs text-muted">{formatDate(v.dueAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ═════════════ Rentals: notices & expenses ═════════════ */

export function LeaseNoticesPanel({ leaseId, notices, canManage, tenantPhone }: { leaseId: string; notices: { _id: string; type: string; date: string; subject: string; message: string; deliveredVia: string }[]; canManage: boolean; tenantPhone?: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const [open, setOpen] = useState(false);
  const types = useEnumOptions('noticeType', ['RENT_REMINDER', 'RENT_INCREASE', 'RENEWAL', 'VACATE', 'MAINTENANCE', 'GENERAL']);
  const via = useEnumOptions('noticeDelivery', ['WHATSAPP', 'PRINTED', 'EMAIL', 'IN_PERSON']);
  const [f, setF] = useState({ type: 'RENT_REMINDER', subject: '', message: '', deliveredVia: 'WHATSAPP' });
  const save = useMutation({
    mutationFn: () => leaseApi.addNotice(leaseId, f),
    onSuccess: () => {
      toast.success(t('ops.noticeSaved'));
      void qc.invalidateQueries({ queryKey: ['lease', leaseId] });
      if (f.deliveredVia === 'WHATSAPP' && tenantPhone) window.open(`https://wa.me/${tenantPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`${f.subject}\n\n${f.message}`)}`, '_blank', 'noopener');
      setOpen(false);
    },
    onError,
  });
  return (
    <Card title={t('ops.notices')} actions={canManage && <Button size="sm" onClick={() => setOpen(true)}>{t('ops.addNotice')}</Button>}>
      {!notices.length ? <p className="text-sm text-muted">{t('ops.noNotices')}</p> : (
        <ul className="divide-y divide-line text-sm">
          {[...notices].reverse().map((n) => (
            <li key={n._id} className="py-2">
              <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{n.subject}</span><Badge color="gray">{t(`enums.noticeType.${n.type}`)}</Badge><span className="text-xs text-muted">{t(`enums.noticeDelivery.${n.deliveredVia}`)} · {formatDate(n.date)}</span>
                <button type="button" className="ms-auto inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" onClick={() => leaseApi.noticePdf(leaseId, n._id)}><Printer className="h-3.5 w-3.5" />PDF</button></p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ops.addNotice')} footer={<Button disabled={f.subject.trim().length < 3 || f.message.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('common.type')} options={types} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} />
          <Select label={t('ops.deliveredVia')} options={via} value={f.deliveredVia} onChange={(e) => setF({ ...f, deliveredVia: e.target.value })} />
          <Input label={t('ops.subject')} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} wrapperClassName="sm:col-span-2" />
          <Textarea label={t('marketing.message')} rows={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} wrapperClassName="sm:col-span-2" />
        </div>
      </Modal>
    </Card>
  );
}

export function LeaseExpensesPanel({ leaseId, onAdd }: { leaseId: string; onAdd?: () => void }) {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ['lease', leaseId, 'expenses'], queryFn: () => leaseApi.expenses(leaseId) });
  const d = q.data;
  return (
    <Card title={t('ops.maintenance')} actions={onAdd && <Button size="sm" variant="secondary" onClick={onAdd}>{t('ops.addExpense')}</Button>}>
      {!d?.items.length ? <p className="text-sm text-muted">{t('ops.noMaintenance')}</p> : (
        <>
          <ul className="divide-y divide-line text-sm">
            {d.items.map((x) => (
              <li key={x._id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="ltr-nums font-semibold text-red-600">{formatPkr(x.amount)}</span>
                <span>{typeof x.categoryId === 'object' && x.categoryId ? (i18n.language === 'ur' && x.categoryId.nameUr ? x.categoryId.nameUr : x.categoryId.name) : ''}</span>
                {x.description && <span className="text-xs text-muted">{x.description}</span>}
                <span className="ltr-nums ms-auto text-xs text-muted">{formatDate(x.date)}</span>
                <VoucherButton kind="transaction" id={x._id} />
              </li>
            ))}
          </ul>
          <p className="ltr-nums mt-2 text-end text-sm font-semibold">{t('finance5b.total')}: {formatPkr(d.total)}</p>
        </>
      )}
    </Card>
  );
}

/* ═════════════ Portal controls ═════════════ */

export function PortalSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.MARKETING_MANAGE);
  const q = useQuery({ queryKey: ['portal-settings'], queryFn: portalSettingsApi.get });
  const [d, setD] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (q.data && !d) setD({ ...q.data });
  }, [q.data, d]);
  const save = useMutation({ mutationFn: () => portalSettingsApi.update(d!), onSuccess: (s) => (toast.success(t('common.saved')), qc.setQueryData(['portal-settings'], s)), onError });
  if (!d) return null;
  const keys = ['showMatches', 'allowPreferenceUpdates', 'allowVisitRequests', 'showDocuments', 'showOwnerInquiries', 'showOwnerOffers', 'allowOwnerAvailabilityUpdates'];
  return (
    <Card title={t('ops.portalSettings')}>
      <div className="space-y-2">
        {keys.map((k) => <Switch key={k} checked={!!d[k]} disabled={!canManage} onChange={(v) => setD({ ...d, [k]: v })} label={t(`ops.portal.${k}`)} />)}
        <p className="text-2xs text-muted">{t('ops.portalHint')}</p>
        {canManage && <div className="flex justify-end"><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
      </div>
    </Card>
  );
}
