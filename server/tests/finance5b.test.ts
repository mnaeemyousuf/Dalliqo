import request from 'supertest';
import { ROLE_PRESETS, agingBucket, buildInstallmentSchedule, rupeesInWords, summarizeCommission } from '@recrm/shared';
import { createApp } from '../src/app';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const DAY = 86_400_000;

async function binary(req: request.Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('shared finance maths', () => {
  it('builds booking + down payment + installments + possession that add up to the total', () => {
    const s = buildInstallmentSchedule({ totalAmount: 10_000_000, bookingAmount: 500_000, downPayment: 1_500_000, possessionAmount: 1_000_000, frequency: 'QUARTERLY', count: 7, startDate: new Date(Date.UTC(2026, 0, 15)) });
    expect(s.map((i) => i.kind)).toEqual(['BOOKING', 'DOWN_PAYMENT', ...Array(7).fill('INSTALLMENT'), 'POSSESSION']);
    expect(s.reduce((a, i) => a + i.amount, 0)).toBe(10_000_000);
    expect(new Date(s[2].dueDate).getUTCMonth()).toBe(3); // first quarterly installment in April
  });

  it('splits commission with outside dealers before agents and tracks the lifecycle', () => {
    const base = {
      agreedPrice: 20_000_000,
      commission: { buyer: { mode: 'PERCENT' as const, value: 1 }, seller: { mode: 'PERCENT' as const, value: 1 } },
      agents: [{ userId: 'a', sharePct: 100 }],
      externalShares: [{ kind: 'EXTERNAL_DEALER' as const, name: 'Khan Estate', mode: 'PERCENT' as const, value: 25 }],
    };
    const expected = summarizeCommission(base);
    expect(expected.agencyExpected).toBe(300_000);
    expect(expected.external[0].expected).toBe(100_000);
    expect(expected.lifecycle).toBe('EXPECTED');
    expect(summarizeCommission({ ...base, commissionApprovedAt: new Date() }).lifecycle).toBe('APPROVED');
    const received = summarizeCommission({ ...base, payments: [{ side: 'BUYER', amount: 200_000 }, { side: 'SELLER', amount: 200_000 }] });
    expect(received.lifecycle).toBe('RECEIVED');
    expect(received.agents[0].received).toBe(300_000);
    const distributed = summarizeCommission({ ...base, payments: [{ side: 'BUYER', amount: 400_000 }], payouts: [{ userId: 'a', amount: 300_000, status: 'PENDING' }] });
    expect(distributed.lifecycle).toBe('DISTRIBUTED');
    const paid = summarizeCommission({ ...base, externalShares: [{ ...base.externalShares[0], paid: 100_000 }], payments: [{ side: 'BUYER', amount: 400_000 }], payouts: [{ userId: 'a', amount: 300_000, status: 'PAID' }] });
    expect(paid.lifecycle).toBe('PAID');
  });

  it('writes amounts in words and buckets by age', () => {
    expect(rupeesInWords(1_525_000)).toBe('Fifteen Lakh Twenty Five Thousand Rupees Only');
    expect(rupeesInWords(25_000_000)).toBe('Two Crore Fifty Lakh Rupees Only');
    expect(agingBucket(new Date(Date.now() - 45 * DAY))).toBe('31_60');
    expect(agingBucket(new Date(Date.now() + DAY))).toBe('CURRENT');
  });
});

describe('installments, aging, statements and receipts', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('creates an installment plan, allocates payments, reports overdue and prints a receipt', async () => {
    const client = await createClient(app, owner);
    const property = await createProperty(app, owner);
    const plan = (await request(app)
      .post('/api/installments')
      .set(bearer(owner.accessToken))
      .send({ clientId: client._id, propertyId: property._id, title: 'Plot 12-A plan', totalAmount: 3_000_000, bookingAmount: 300_000, frequency: 'MONTHLY', count: 9, startDate: new Date(Date.now() - 95 * DAY), graceDays: 5 })
      .expect(201)).body.data;
    expect(plan.planNo).toBe('IP-000001');
    expect(plan.items).toHaveLength(10);
    expect(plan.overdueAmount).toBeGreaterThan(0);
    await request(app).post('/api/installments').set(bearer(owner.accessToken)).send({ clientId: client._id, totalAmount: 100_000, frequency: 'CUSTOM', startDate: new Date(), items: [{ label: 'One', dueDate: new Date(), amount: 90_000 }] }).expect(400);

    const paid = (await request(app).post(`/api/installments/${plan._id}/payments`).set(bearer(owner.accessToken)).send({ date: new Date(), amount: 500_000, method: 'CHEQUE' }).expect(200)).body.data;
    expect(paid.items[0].status).toBe('PAID');
    expect(paid.items[1].paid).toBe(200_000);
    expect(paid.paidTotal).toBe(500_000);

    const aging = (await request(app).get('/api/reports/aging').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(aging.receivables.total).toBeGreaterThan(0);
    expect(aging.receivableRows.some((r: { kind: string }) => r.kind === 'INSTALLMENT')).toBe(true);

    const pdf = await binary(request(app).get(`/api/receipts/installment/${plan._id}/${paid.payments[0]._id}`).set(bearer(owner.accessToken)));
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('approves commission, pays an outside dealer, and gives agents their own statement only', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const client = await createClient(app, owner);
    const deal = (await request(app)
      .post('/api/deals')
      .set(bearer(owner.accessToken))
      .send({ clientId: client._id, agreedPrice: 20_000_000, agents: [{ userId: agent.userId, sharePct: 100 }], externalShares: [{ kind: 'REFERRAL', name: 'Cousin Bilal', mode: 'FIXED', value: 50_000 }] })
      .expect(201)).body.data;
    await request(app).post(`/api/deals/${deal._id}/commission/approve`).set(bearer(owner.accessToken)).expect(200);
    let d = (await request(app).get(`/api/deals/${deal._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.summary.lifecycle).toBe('APPROVED');
    await request(app).post(`/api/deals/${deal._id}/payments`).set(bearer(owner.accessToken)).send({ side: 'BUYER', amount: 400_000, date: new Date() }).expect(201);
    await request(app).post(`/api/deals/${deal._id}/external/${d.externalShares[0]._id}/pay`).set(bearer(owner.accessToken)).send({ amount: 50_000 }).expect(200);
    d = (await request(app).get(`/api/deals/${deal._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.summary.external[0].owed).toBe(0);
    expect(d.summary.agents[0].received).toBe(350_000);

    const mine = (await request(app).get(`/api/reports/agent-statement?userId=${agent.userId}`).set(bearer(agent.accessToken)).expect(200)).body.data;
    expect(mine.totals.earned).toBe(350_000);
    expect(mine.totals.owed).toBe(350_000);
    await request(app).get(`/api/reports/agent-statement?userId=${owner.userId}`).set(bearer(agent.accessToken)).expect(403);
    const pdf = await binary(request(app).get(`/api/reports/agent-statement?userId=${agent.userId}&format=pdf`).set(bearer(owner.accessToken)));
    expect(pdf.status).toBe(200);
    const aging = (await request(app).get('/api/reports/aging').set(bearer(owner.accessToken))).body.data;
    expect(aging.payables.total).toBe(350_000);
    expect(aging.payableRows[0].party).toBe('Ahmed Yousuf');
  });

  it('reports monthly cash flow from the ledger', async () => {
    const cats = (await request(app).get('/api/transaction-categories').set(bearer(owner.accessToken))).body.data;
    const income = cats.find((c: { key: string }) => c.key === 'CONSULTANCY');
    const expense = cats.find((c: { key: string }) => c.key === 'UTILITIES');
    await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'INCOME', categoryId: income._id, amount: 150_000, date: new Date() }).expect(201);
    await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'EXPENSE', categoryId: expense._id, amount: 40_000, date: new Date() }).expect(201);
    const cf = (await request(app).get('/api/reports/cash-flow').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(cf.months).toHaveLength(12);
    expect(cf.months[11]).toMatchObject({ income: 150_000, expense: 40_000, net: 110_000, cumulative: 110_000 });
    expect(cf.totals.net).toBe(110_000);
  });
});
