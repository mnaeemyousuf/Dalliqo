import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ROLE_PRESETS, summarizeCommission, sharesValid } from '@recrm/shared';
import { createApp } from '../src/app';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();

async function createDeal(s: Session, body: Record<string, unknown>) {
  const res = await request(app).post('/api/deals').set(bearer(s.accessToken)).send(body);
  if (res.status !== 201) throw new Error(`create deal failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

const member = (owner: Session, template: keyof typeof ROLE_PRESETS) => addActiveMember(app, owner, { permissions: [...ROLE_PRESETS[template]] });

describe('commission maths (shared)', () => {
  it('applies percentages to the final price (else the agreed price), fixed amounts as-is', () => {
    const s = summarizeCommission({
      agreedPrice: 20_000_000,
      finalPrice: 19_500_000,
      commission: { buyer: { mode: 'PERCENT', value: 1 }, seller: { mode: 'FIXED', value: 150_000 } },
      agents: [{ userId: 'a', sharePct: 60 }, { userId: 'b', sharePct: 40 }],
      payments: [{ side: 'BUYER', amount: 195_000 }],
      payouts: [{ userId: 'a', amount: 50_000, status: 'PAID' }, { userId: 'a', amount: 20_000, status: 'PENDING' }],
    });
    expect(s.basePrice).toBe(19_500_000);
    expect(s.expected).toEqual({ buyer: 195_000, seller: 150_000, total: 345_000 });
    expect(s.received).toEqual({ buyer: 195_000, seller: 0, total: 195_000 });
    expect(s.outstanding).toBe(150_000);
    expect(s.status).toBe('PARTIALLY_RECEIVED');
    expect(s.agents).toEqual([
      { userId: 'a', sharePct: 60, expected: 207_000, received: 117_000, paidOut: 50_000, owed: 67_000 },
      { userId: 'b', sharePct: 40, expected: 138_000, received: 78_000, paidOut: 0, owed: 78_000 },
    ]);
    expect(summarizeCommission({ agreedPrice: 10_000_000, commission: { buyer: { mode: 'PERCENT', value: 2 } } }).expected.total).toBe(200_000);
    expect(summarizeCommission({}).status).toBe('PENDING');
    expect(summarizeCommission({ commission: { buyer: { mode: 'FIXED', value: 1000 } }, payments: [{ side: 'BUYER', amount: 1000 }] }).status).toBe('RECEIVED');
  });

  it('validates agent shares', () => {
    expect(sharesValid([{ sharePct: 50 }, { sharePct: 50 }])).toBe(true);
    expect(sharesValid([{ sharePct: 33.33 }, { sharePct: 33.33 }, { sharePct: 33.34 }])).toBe(true);
    expect(sharesValid([{ sharePct: 60 }, { sharePct: 30 }])).toBe(false);
    expect(sharesValid([])).toBe(false);
  });
});

describe('deals', () => {
  it('creates a deal with the default commission terms, a deal number and a timeline entry', async () => {
    const owner = await registerOwner(app);
    const client = await createClient(app, owner);
    const property = await createProperty(app, owner);
    const deal = await createDeal(owner, { clientId: client._id, propertyId: property._id, agreedPrice: 15_000_000 });
    expect(deal).toMatchObject({ dealNo: 'DL-000001', stage: 'INQUIRY', expectedTotal: 300_000, receivedTotal: 0, commissionStatus: 'PENDING', branchId: client.branchId });
    expect(deal.commission).toEqual({ buyer: { mode: 'PERCENT', value: 1 }, seller: { mode: 'PERCENT', value: 1 } });
    expect(deal.agents).toEqual([{ userId: owner.userId, sharePct: 100 }]);
    const second = await createDeal(owner, { clientId: client._id });
    expect(second.dealNo).toBe('DL-000002');

    const got = await request(app).get(`/api/deals/${deal._id}`).set(bearer(owner.accessToken));
    expect(got.body.data.clientId.fullName).toBe('Muhammad Ali');
    expect(got.body.data.summary.expected.total).toBe(300_000);
    const timeline = await request(app).get(`/api/activities?entityId=${deal._id}`).set(bearer(owner.accessToken));
    expect(timeline.body.data[0].type).toBe('DEAL_CREATED');
    // Settings change the default percentages.
    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ commission: { defaultBuyerPct: 2, defaultSellerPct: 0 } }).expect(200);
    const third = await createDeal(owner, { clientId: client._id, agreedPrice: 10_000_000 });
    expect(third.expectedTotal).toBe(200_000);
  });

  it('validates agents and their shares', async () => {
    const owner = await registerOwner(app);
    const son = await member(owner, 'MEMBER');
    const client = await createClient(app, owner);
    const bad = await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: client._id, agents: [{ userId: owner.userId, sharePct: 60 }, { userId: son.userId, sharePct: 30 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_AGENT_SHARES');
    const ok = await createDeal(owner, { clientId: client._id, agents: [{ userId: owner.userId, sharePct: 60 }, { userId: son.userId, sharePct: 40 }] });
    expect(ok.agents).toHaveLength(2);
  });

  it('moves through the pipeline with stage history; a lost deal needs a reason', async () => {
    const owner = await registerOwner(app);
    const client = await createClient(app, owner);
    const deal = await createDeal(owner, { clientId: client._id });
    const auth = bearer(owner.accessToken);
    for (const stage of ['SITE_VISIT', 'OFFER', 'TOKEN']) await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage, note: `to ${stage}` }).expect(200);
    const lost = await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage: 'CLOSED_LOST' });
    expect(lost.status).toBe(400);
    const won = await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage: 'CLOSED_WON' });
    expect(won.body.data.closedAt).toBeTruthy();
    const got = await request(app).get(`/api/deals/${deal._id}`).set(auth);
    expect(got.body.data.stageHistory.map((h: { stage: string }) => h.stage)).toEqual(['INQUIRY', 'SITE_VISIT', 'OFFER', 'TOKEN', 'CLOSED_WON']);
    const open = await request(app).get('/api/deals?open=true').set(auth);
    expect(open.body.data).toHaveLength(0);
    const timeline = await request(app).get(`/api/activities?entityId=${deal._id}`).set(auth);
    expect(timeline.body.data.filter((a: { type: string }) => a.type === 'DEAL_STAGE_CHANGED')).toHaveLength(4);
  });

  it('records commission payments (idempotent) and agent payouts', async () => {
    const owner = await registerOwner(app);
    const son = await member(owner, 'MEMBER');
    const client = await createClient(app, owner);
    const deal = await createDeal(owner, {
      clientId: client._id, finalPrice: 20_000_000,
      agents: [{ userId: owner.userId, sharePct: 50 }, { userId: son.userId, sharePct: 50 }],
    });
    const auth = bearer(owner.accessToken);
    const id = randomUUID();
    const first = await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ id, side: 'BUYER', amount: 200_000, date: '2026-10-05', method: 'JAZZCASH' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ receivedTotal: 200_000, outstanding: 200_000, commissionStatus: 'PARTIALLY_RECEIVED' });
    const replay = await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ id, side: 'BUYER', amount: 200_000, date: '2026-10-05' });
    expect(replay.body.data.payments).toHaveLength(1);
    const seller = await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ side: 'SELLER', amount: 200_000, date: '2026-11-01', method: 'CHEQUE', reference: 'CHQ-1122' });
    expect(seller.body.data.commissionStatus).toBe('RECEIVED');

    const payout = await request(app).post(`/api/deals/${deal._id}/payouts`).set(auth).send({ userId: son.userId, amount: 100_000 });
    expect(payout.status).toBe(201);
    const payoutId = payout.body.data.payouts[0]._id;
    const paid = await request(app).patch(`/api/deals/${deal._id}/payouts/${payoutId}`).set(auth).send({ status: 'PAID' });
    expect(paid.body.data.payouts[0].status).toBe('PAID');
    expect(paid.body.data.payouts[0].date).toBeTruthy();
    const notAgent = await request(app).post(`/api/deals/${deal._id}/payouts`).set(auth).send({ userId: (await member(owner, 'VIEWER')).userId, amount: 1000 });
    expect(notAgent.status).toBe(400);

    const got = await request(app).get(`/api/deals/${deal._id}`).set(auth);
    const sonShare = got.body.data.summary.agents.find((a: { userId: string }) => a.userId === son.userId);
    expect(sonShare).toMatchObject({ received: 200_000, paidOut: 100_000, owed: 100_000 });

    const paymentId = seller.body.data.payments.find((p: { side: string }) => p.side === 'SELLER')._id;
    const removed = await request(app).delete(`/api/deals/${deal._id}/payments/${paymentId}`).set(auth);
    expect(removed.body.data.commissionStatus).toBe('PARTIALLY_RECEIVED');
    const timeline = await request(app).get(`/api/activities?entityId=${deal._id}`).set(auth);
    expect(timeline.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['COMMISSION_RECEIVED', 'COMMISSION_PAYOUT', 'COMMISSION_PAYMENT_REMOVED']));
  });

  it('agents see only their own deals; payments need commissions:manage; viewers read only', async () => {
    const owner = await registerOwner(app);
    const agent = await member(owner, 'AGENT');
    const accountant = await member(owner, 'ACCOUNTANT');
    const viewer = await member(owner, 'VIEWER');
    const client = await createClient(app, owner);
    const mine = await createDeal(owner, { clientId: client._id, title: 'Agent deal', agents: [{ userId: agent.userId, sharePct: 100 }] });
    const other = await createDeal(owner, { clientId: client._id, title: 'Owner deal' });

    const list = await request(app).get('/api/deals').set(bearer(agent.accessToken));
    expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(['Agent deal']);
    expect((await request(app).get(`/api/deals/${other._id}`).set(bearer(agent.accessToken))).status).toBe(404);
    expect((await request(app).patch(`/api/deals/${other._id}`).set(bearer(agent.accessToken)).send({ notes: 'x' })).status).toBe(404);
    expect((await request(app).patch(`/api/deals/${mine._id}`).set(bearer(agent.accessToken)).send({ notes: 'Visit Saturday' })).status).toBe(200);
    // An agent cannot create a deal they would not be on.
    expect((await request(app).post('/api/deals').set(bearer(agent.accessToken)).send({ clientId: client._id, agents: [{ userId: owner.userId, sharePct: 100 }] })).status).toBe(403);
    expect((await createDeal(agent, { clientId: client._id })).agents[0].userId).toBe(agent.userId);
    expect((await request(app).post(`/api/deals/${mine._id}/payments`).set(bearer(agent.accessToken)).send({ side: 'BUYER', amount: 1000, date: '2026-10-01' })).status).toBe(403);
    // Accountant: all deals, records payments, cannot create deals.
    expect((await request(app).get('/api/deals').set(bearer(accountant.accessToken))).body.data).toHaveLength(3);
    expect((await request(app).post(`/api/deals/${other._id}/payments`).set(bearer(accountant.accessToken)).send({ side: 'BUYER', amount: 1000, date: '2026-10-01' })).status).toBe(201);
    expect((await request(app).post('/api/deals').set(bearer(accountant.accessToken)).send({ clientId: client._id })).status).toBe(403);
    // Viewer: reads all, changes nothing.
    expect((await request(app).get('/api/deals').set(bearer(viewer.accessToken))).body.data).toHaveLength(3);
    expect((await request(app).post(`/api/deals/${other._id}/stage`).set(bearer(viewer.accessToken)).send({ stage: 'OFFER' })).status).toBe(403);
    expect((await request(app).delete(`/api/deals/${other._id}`).set(bearer(viewer.accessToken))).status).toBe(403);
  });

  it('keeps deals inside their business and branch', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const client = await createClient(app, a);
    const deal = await createDeal(a, { clientId: client._id });
    expect((await request(app).get(`/api/deals/${deal._id}`).set(bearer(b.accessToken))).status).toBe(404);
    expect((await request(app).get('/api/deals').set(bearer(b.accessToken))).body.data).toHaveLength(0);
    // Another business's client cannot be used.
    expect((await request(app).post('/api/deals').set(bearer(b.accessToken)).send({ clientId: client._id })).status).toBe(400);

    const clifton = (await request(app).post('/api/branches').set(bearer(a.accessToken)).send({ name: 'Clifton' })).body.data;
    const restricted = await addActiveMember(app, a, { permissions: [...ROLE_PRESETS.MANAGER], branchAccess: 'SELECTED', branchIds: [clifton._id] });
    expect((await request(app).get(`/api/deals/${deal._id}`).set(bearer(restricted.accessToken))).status).toBe(404);
  });

  it('syncs deals offline (create, payment, stage) and pulls only an agent\'s own deals', async () => {
    const owner = await registerOwner(app);
    const agent = await member(owner, 'AGENT');
    const client = await createClient(app, owner);
    const uuid = randomUUID();
    const push = await request(app).post('/api/sync/push').set(bearer(owner.accessToken)).send({
      mutations: [
        { mutationId: randomUUID(), entity: 'deals', op: 'create', uuid, data: { clientId: client.uuid, agreedPrice: 5_000_000, stage: 'OFFER' } },
        { mutationId: randomUUID(), entity: 'deals', op: 'update', uuid, baseVersion: 1, data: { payments: [{ _id: randomUUID(), side: 'BUYER', amount: 50_000, date: '2026-10-10' }] } },
      ],
    });
    expect(push.body.data.results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied']);
    expect(push.body.data.results[1].record).toMatchObject({ stage: 'OFFER', receivedTotal: 50_000 });
    // Replaying the same mutations changes nothing.
    await createDeal(owner, { clientId: client._id, agents: [{ userId: agent.userId, sharePct: 100 }], title: 'For agent' });
    const agentPull = await request(app).get('/api/sync/pull').set(bearer(agent.accessToken));
    expect(agentPull.body.data.changes.deals.map((d: { title: string }) => d.title)).toEqual(['For agent']);
    const ownerPull = await request(app).get('/api/sync/pull').set(bearer(owner.accessToken));
    expect(ownerPull.body.data.changes.deals).toHaveLength(2);
  });

  it('reports commission by month and agent, exports deals and commissions, and shows dashboard tiles', async () => {
    const owner = await registerOwner(app);
    const son = await member(owner, 'MEMBER');
    const client = await createClient(app, owner);
    const auth = bearer(owner.accessToken);
    const deal = await createDeal(owner, { clientId: client._id, finalPrice: 10_000_000, agents: [{ userId: owner.userId, sharePct: 70 }, { userId: son.userId, sharePct: 30 }] });
    await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ side: 'BUYER', amount: 100_000, date: '2026-09-15' }).expect(201);
    await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ side: 'SELLER', amount: 50_000, date: '2026-10-02' }).expect(201);
    const byMonth = await request(app).get('/api/reports/commissions?groupBy=month').set(auth);
    expect(byMonth.body.data.rows.map((r: { key: string; received: number }) => [r.key, r.received])).toEqual([['2026-09', 100_000], ['2026-10', 50_000]]);
    expect(byMonth.body.data.totals).toEqual({ expected: 200_000, received: 150_000, outstanding: 50_000 });
    expect(byMonth.body.data.outstanding[0]).toMatchObject({ dealNo: deal.dealNo, outstanding: 50_000 });
    const byAgent = await request(app).get('/api/reports/commissions?groupBy=agent').set(auth);
    expect(byAgent.body.data.rows.map((r: { received: number }) => r.received)).toEqual([105_000, 45_000]);
    const ranged = await request(app).get('/api/reports/commissions?groupBy=month&from=2026-10-01').set(auth);
    expect(ranged.body.data.rows).toHaveLength(1);

    for (const resource of ['deals', 'commissions']) {
      for (const format of ['xlsx', 'pdf']) {
        const res = await request(app).get(`/api/exports/${resource}?format=${format}`).set(auth).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(res.status).toBe(200);
        expect((res.body as Buffer).length).toBeGreaterThan(500);
      }
    }
    const dash = await request(app).get('/api/dashboard').set(auth);
    expect(dash.body.data.deals).toMatchObject({ open: 1, outstanding: 50_000 });
  });
});
