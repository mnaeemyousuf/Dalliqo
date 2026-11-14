import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { AGING_BUCKETS, BRAND, ERROR_CODES, PERMISSIONS, agingBucket, itemBalance, rupeesInWords, summarizeCommission, type AgingBucket } from '@recrm/shared';
import { Business } from '../models/Business';
import { Deal, type DealDoc } from '../models/Deal';
import { InstallmentPlan, type InstallmentPlanDoc } from '../models/InstallmentPlan';
import { Lease, type LeaseDoc } from '../models/Lease';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import type { AuthContext, TenantContext } from '../types/context';
import { forbidden, notFound } from '../utils/AppError';
import { formatPkr } from '../utils/text';
import { auditService } from './auditService';
import { branchFilter } from './branchScope';
import { pdfText, registerUrduFonts } from './pdf/pdfText';

/**
 * Finance reports built from the records themselves (never stored totals that could drift):
 * cash flow (ledger), receivables and payables aging, agent commission statements, and receipts.
 */

const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucket, number>;
const LOGO = [join(__dirname, '../../assets/brand/dalliqo-logo-horizontal.png'), join(process.cwd(), 'assets/brand/dalliqo-logo-horizontal.png')].find((p) => existsSync(p));

export const financeReportService = {
  /** Monthly money in / out from the income & expense ledger, with a running balance. */
  async cashFlow(ctx: TenantContext, q: { from?: Date; to?: Date }) {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
    const rows = await Transaction.aggregate<{ _id: { m: string; type: string }; total: number }>([
      { $match: { businessId: new Types.ObjectId(ctx.businessId), deletedAt: null, date: { $gte: from, $lte: to }, ...branchFilter(ctx) } },
      { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'Asia/Karachi' } }, type: '$type' }, total: { $sum: '$amount' } } },
    ]);
    const months: string[] = [];
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    let running = 0;
    const out = months.map((m) => {
      const income = rows.find((r) => r._id.m === m && r._id.type === 'INCOME')?.total ?? 0;
      const expense = rows.find((r) => r._id.m === m && r._id.type === 'EXPENSE')?.total ?? 0;
      running += income - expense;
      return { month: m, income, expense, net: income - expense, cumulative: running };
    });
    return {
      from,
      to,
      months: out,
      totals: { income: out.reduce((s, r) => s + r.income, 0), expense: out.reduce((s, r) => s + r.expense, 0), net: running },
    };
  },

  /**
   * Receivables (commission still to come, overdue installments, overdue rent) and payables
   * (agent shares owed, outside dealers / referrers owed), bucketed by how late they are.
   */
  async aging(ctx: TenantContext, now = Date.now()) {
    const base = { businessId: new Types.ObjectId(ctx.businessId), deletedAt: null, ...branchFilter(ctx) };
    const [deals, plans, leases] = await Promise.all([
      Deal.find({ ...base, stage: { $ne: 'CLOSED_LOST' } }).select('dealNo title agreedPrice finalPrice commission agents payments payouts externalShares expectedCloseDate closedAt createdAt stage outstanding').lean<DealDoc[]>(),
      InstallmentPlan.find({ ...base, status: 'ACTIVE', outstanding: { $gt: 0 } }).select('planNo items clientId').populate({ path: 'clientId', select: 'fullName', options: { skipTenantGuard: true } }).lean<InstallmentPlanDoc[]>(),
      Lease.find({ ...base, status: 'ACTIVE', overdueAmount: { $gt: 0 } }).select('leaseNo schedule tenantId').populate({ path: 'tenantId', select: 'fullName', options: { skipTenantGuard: true } }).lean<LeaseDoc[]>(),
    ]);
    const receivables = { commission: emptyBuckets(), installments: emptyBuckets(), rent: emptyBuckets() };
    const payables = { agents: emptyBuckets(), external: emptyBuckets() };
    const receivableRows: { kind: string; ref: string; id: string; party: string; amount: number; dueDate: Date; bucket: AgingBucket }[] = [];
    const payableRows: { kind: string; ref: string; id: string; party: string; amount: number; since: Date; bucket: AgingBucket }[] = [];
    const userIds = new Set<string>();
    for (const d of deals) {
      const s = summarizeCommission(d as never);
      // Commission is due when the deal closes (or is expected to); open deals count as current.
      const due = d.closedAt ?? d.expectedCloseDate ?? null;
      if (s.outstanding > 0 && d.stage === 'CLOSED_WON') {
        const b = agingBucket(due ?? d.createdAt, now);
        receivables.commission[b] += s.outstanding;
        receivableRows.push({ kind: 'COMMISSION', ref: d.dealNo, id: String(d._id), party: d.title ?? d.dealNo, amount: s.outstanding, dueDate: due ?? d.createdAt, bucket: b });
      }
      const since = d.payments?.length ? d.payments[d.payments.length - 1].date : d.createdAt;
      for (const a of s.agents) {
        if (a.owed <= 0) continue;
        const b = agingBucket(since, now);
        payables.agents[b] += a.owed;
        userIds.add(a.userId);
        payableRows.push({ kind: 'AGENT', ref: d.dealNo, id: String(d._id), party: a.userId, amount: a.owed, since, bucket: b });
      }
      for (const x of s.external) {
        if (x.owed <= 0) continue;
        const b = agingBucket(since, now);
        payables.external[b] += x.owed;
        payableRows.push({ kind: x.kind, ref: d.dealNo, id: String(d._id), party: x.name, amount: x.owed, since, bucket: b });
      }
    }
    for (const p of plans) {
      for (const it of p.items) {
        const bal = itemBalance(it);
        if (bal <= 0 || +new Date(it.dueDate) > now) continue;
        const b = agingBucket(it.dueDate, now);
        receivables.installments[b] += bal;
        receivableRows.push({ kind: 'INSTALLMENT', ref: p.planNo, id: String(p._id), party: (p.clientId as unknown as { fullName?: string })?.fullName ?? '', amount: bal, dueDate: it.dueDate, bucket: b });
      }
    }
    for (const l of leases) {
      for (const it of l.schedule) {
        const bal = itemBalance(it);
        if (bal <= 0 || +new Date(it.dueDate) > now) continue;
        const b = agingBucket(it.dueDate, now);
        receivables.rent[b] += bal;
        receivableRows.push({ kind: 'RENT', ref: l.leaseNo, id: String(l._id), party: (l.tenantId as unknown as { fullName?: string })?.fullName ?? '', amount: bal, dueDate: it.dueDate, bucket: b });
      }
    }
    const names = new Map((await User.find({ _id: { $in: [...userIds].map((u) => new Types.ObjectId(u)) } }).select('fullName').lean()).map((u) => [String(u._id), u.fullName]));
    for (const r of payableRows) if (r.kind === 'AGENT') r.party = names.get(r.party) ?? r.party;
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    return {
      receivables: { ...receivables, total: sum(receivables.commission) + sum(receivables.installments) + sum(receivables.rent) },
      payables: { ...payables, total: sum(payables.agents) + sum(payables.external) },
      receivableRows: receivableRows.sort((a, b) => +a.dueDate - +b.dueDate).slice(0, 200),
      payableRows: payableRows.sort((a, b) => +a.since - +b.since).slice(0, 200),
    };
  },

  /** One agent's commission: deals they are on, their share expected / received / paid / owed. */
  async agentStatement(auth: AuthContext, userId: string, q: { from?: Date; to?: Date }) {
    if (userId !== auth.userId && !auth.permissions.includes(PERMISSIONS.DEALS_READ_ALL)) throw forbidden();
    const user = await User.findById(userId).select('fullName email mobileNumber').lean();
    if (!user) throw notFound(ERROR_CODES.NOT_FOUND, 'Agent not found');
    const filter: Record<string, unknown> = { businessId: new Types.ObjectId(auth.businessId), deletedAt: null, 'agents.userId': new Types.ObjectId(userId), ...branchFilter(auth) };
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const deals = await Deal.find(filter).select('dealNo title stage agreedPrice finalPrice commission agents payments payouts externalShares closedAt createdAt').sort({ createdAt: 1 }).lean<DealDoc[]>();
    const rows = deals.map((d) => {
      const s = summarizeCommission(d as never);
      const a = s.agents.find((x) => x.userId === userId)!;
      const payouts = (d.payouts ?? []).filter((p) => String(p.userId) === userId);
      return { _id: d._id, dealNo: d.dealNo, title: d.title, stage: d.stage, sharePct: a.sharePct, expected: a.expected, earned: a.received, paidOut: a.paidOut, owed: a.owed, payouts: payouts.map((p) => ({ amount: p.amount, date: p.date, status: p.status })) };
    });
    const totals = rows.reduce((t, r) => ({ expected: t.expected + r.expected, earned: t.earned + r.earned, paidOut: t.paidOut + r.paidOut, owed: t.owed + r.owed }), { expected: 0, earned: 0, paidOut: 0, owed: 0 });
    return { agent: { _id: userId, fullName: user.fullName, email: user.email }, from: q.from ?? null, to: q.to ?? null, rows, totals };
  },

  async agentStatementPdf(auth: AuthContext, userId: string, q: { from?: Date; to?: Date }, out: Writable) {
    const st = await this.agentStatement(auth, userId, q);
    const business = await Business.findById(auth.businessId).select('name').lean();
    return writeDoc(out, (doc, w, left) => {
      header(doc, business?.name ?? BRAND.name, `Commission statement — ${st.agent.fullName}`, left, w);
      doc.fontSize(9).fillColor('#475569').text(`Period: ${q.from ? q.from.toISOString().slice(0, 10) : 'start'} to ${q.to ? q.to.toISOString().slice(0, 10) : 'today'}`).moveDown(0.6);
      const cols = [['Deal', 90], ['Stage', 80], ['Share', 45], ['Expected', 80], ['Earned', 80], ['Paid out', 80], ['Owed', 80]] as const;
      let x = left;
      doc.fontSize(8).fillColor('#0f172a').font('Helvetica-Bold');
      const y0 = doc.y;
      for (const [h, cw] of cols) (doc.text(h, x, y0, { width: cw }), (x += cw));
      doc.font('Helvetica').moveDown(0.5);
      for (const r of st.rows) {
        const y = doc.y;
        x = left;
        for (const [v, cw] of [[r.dealNo, 90], [r.stage.replace('_', ' ').toLowerCase(), 80], [`${r.sharePct}%`, 45], [formatPkr(r.expected), 80], [formatPkr(r.earned), 80], [formatPkr(r.paidOut), 80], [formatPkr(r.owed), 80]] as const) {
          doc.text(String(v), x, y, { width: cw });
          x += cw;
        }
        doc.moveDown(0.3);
      }
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10);
      doc.text(`Earned ${formatPkr(st.totals.earned)}   ·   Paid out ${formatPkr(st.totals.paidOut)}   ·   Owed ${formatPkr(st.totals.owed)}`, left, doc.y, { width: w });
    });
  },

  /** Printable receipt for a rent, installment or commission payment. */
  async receiptPdf(auth: AuthContext, kind: 'lease' | 'installment' | 'deal', id: string, paymentId: string, out: Writable) {
    const base = { businessId: new Types.ObjectId(auth.businessId), _id: new Types.ObjectId(id), deletedAt: null, ...branchFilter(auth) };
    let title = '';
    let party = '';
    let ref = '';
    let payment: { _id: string; date: Date; amount: number; method: string; reference?: string | null } | undefined;
    let forWhat = '';
    if (kind === 'lease') {
      if (!auth.permissions.includes(PERMISSIONS.RENTALS_READ)) throw forbidden();
      const l = await Lease.findOne(base).populate({ path: 'tenantId', select: 'fullName', options: { skipTenantGuard: true } }).populate({ path: 'propertyId', select: 'propertyId', options: { skipTenantGuard: true } }).lean<LeaseDoc>();
      payment = l?.payments.find((p) => p._id === paymentId);
      if (!l || !payment) throw notFound(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment not found');
      title = 'Rent receipt';
      party = (l.tenantId as unknown as { fullName: string }).fullName;
      ref = l.leaseNo;
      forWhat = `Rent for ${payment && l.schedule.filter((i) => (payment as { allocations?: { itemId: string }[] }).allocations?.some((a) => a.itemId === i._id)).map((i) => i.period).join(', ')} — ${(l.propertyId as unknown as { propertyId: string }).propertyId}`;
    } else if (kind === 'installment') {
      if (!auth.permissions.includes(PERMISSIONS.FINANCE_READ)) throw forbidden();
      const p = await InstallmentPlan.findOne(base).populate({ path: 'clientId', select: 'fullName', options: { skipTenantGuard: true } }).lean<InstallmentPlanDoc>();
      payment = p?.payments.find((x) => x._id === paymentId);
      if (!p || !payment) throw notFound(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment not found');
      title = 'Installment receipt';
      party = (p.clientId as unknown as { fullName: string }).fullName;
      ref = p.planNo;
      forWhat = p.title ?? `Installment plan ${p.planNo}`;
    } else {
      if (!auth.permissions.includes(PERMISSIONS.DEALS_READ)) throw forbidden();
      const d = await Deal.findOne(base).populate({ path: 'clientId', select: 'fullName', options: { skipTenantGuard: true } }).lean<DealDoc>();
      const p = d?.payments.find((x) => x._id === paymentId);
      if (!d || !p) throw notFound(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment not found');
      payment = p;
      title = 'Commission receipt';
      party = (d.clientId as unknown as { fullName: string }).fullName;
      ref = d.dealNo;
      forWhat = `Commission (${p.side.toLowerCase()} side) on ${d.dealNo}`;
    }
    const business = await Business.findById(auth.businessId).select('name phone address city').lean();
    await auditService.record(auth, { action: 'receipt.generated', entityType: kind, entityId: new Types.ObjectId(id), entityLabel: `${ref} / ${paymentId.slice(0, 8)}` });
    const p = payment!;
    return writeDoc(out, (doc, w, left) => {
      header(doc, business?.name ?? BRAND.name, title, left, w);
      doc.fontSize(9).fillColor('#475569').text([business?.address, business?.city, business?.phone].filter(Boolean).join(' · ')).moveDown(1);
      const line = (k: string, v: string) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(k, left, y, { width: 140 });
        doc.fillColor('#0f172a');
        pdfText(doc, v, left + 150, y, { width: w - 150 });
        doc.moveDown(0.5);
      };
      line('Receipt no.', `${ref}-${p._id.slice(0, 8).toUpperCase()}`);
      line('Date', new Date(p.date).toISOString().slice(0, 10));
      line('Received from', party);
      line('For', forWhat);
      line('Amount', formatPkr(p.amount));
      line('In words', rupeesInWords(p.amount));
      line('Method', p.method.replace('_', ' ').toLowerCase());
      if (p.reference) line('Reference', p.reference);
      doc.moveDown(3).fontSize(9).fillColor('#64748b').text('______________________________', left).text('Received by (signature & stamp)');
      doc.moveDown(2).fontSize(7).text(`Generated by ${BRAND.name} on ${new Date().toISOString().slice(0, 10)}. Computer-generated receipt.`);
    });
  },
};

function header(doc: PDFKit.PDFDocument, businessName: string, title: string, left: number, w: number) {
  if (LOGO) doc.image(LOGO, left + w - 110, doc.page.margins.top - 4, { height: 22 });
  doc.fillColor('#0f172a').fontSize(16);
  pdfText(doc, businessName, left, doc.page.margins.top, { width: w - 130 }, true);
  doc.font('Helvetica').fontSize(13).fillColor(BRAND.color.primary['700']).text(title).moveDown(0.4);
}

function writeDoc(out: Writable, draw: (doc: PDFKit.PDFDocument, width: number, left: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Author: BRAND.name } });
    doc.on('error', reject);
    out.on('finish', () => resolve());
    registerUrduFonts(doc);
    doc.pipe(out);
    draw(doc, doc.page.width - 80, 40);
    doc.end();
  });
}
