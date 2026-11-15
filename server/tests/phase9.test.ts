import request from 'supertest';
import { ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { Client } from '../src/models/Client';
import { Document } from '../src/models/FileAsset';
import { FollowUp } from '../src/models/FollowUp';
import { Match } from '../src/models/Match';
import { createClient, createOwner, createProperty } from './support/crm';
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

describe('gap-closing batch', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('requires payout approval when switched on, records adjustments and disputes', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const c = await createClient(app, owner);
    const deal = (await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: c._id, agreedPrice: 10_000_000, agents: [{ userId: agent.userId, sharePct: 100 }] }).expect(201)).body.data;
    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ commission: { payoutApprovalRequired: true } }).expect(200);
    const withPayout = (await request(app).post(`/api/deals/${deal._id}/payouts`).set(bearer(owner.accessToken)).send({ userId: agent.userId, amount: 50_000 }).expect(201)).body.data;
    const pid = withPayout.payouts[0]._id;
    await request(app).patch(`/api/deals/${deal._id}/payouts/${pid}`).set(bearer(owner.accessToken)).send({ status: 'PAID' }).expect(400);
    await request(app).post(`/api/deals/${deal._id}/payouts/${pid}/approve`).set(bearer(agent.accessToken)).send({}).expect(403);
    const approved = (await request(app).post(`/api/deals/${deal._id}/payouts/${pid}/approve`).set(bearer(owner.accessToken)).send({}).expect(200)).body.data;
    expect(approved.payouts[0]).toMatchObject({ status: 'APPROVED', approvedBy: owner.userId });
    await request(app).patch(`/api/deals/${deal._id}/payouts/${pid}`).set(bearer(owner.accessToken)).send({ status: 'PAID' }).expect(200);
    const voucher = await binary(request(app).get(`/api/vouchers/payout/${deal._id}/${pid}`).set(bearer(owner.accessToken)));
    expect(voucher.status).toBe(200);
    expect((voucher.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const adj = (await request(app).post(`/api/deals/${deal._id}/adjustments`).set(bearer(owner.accessToken)).send({ amount: -50_000, reason: 'Discount agreed with buyer' }).expect(200)).body.data;
    expect(adj.expectedTotal).toBe(150_000); // 2 % of 1 Cr minus 50,000
    await request(app).post(`/api/deals/${deal._id}/dispute`).set(bearer(owner.accessToken)).send({ action: 'RESOLVE', text: 'nothing open' }).expect(400);
    await request(app).post(`/api/deals/${deal._id}/dispute`).set(bearer(owner.accessToken)).send({ action: 'OPEN', text: 'Seller contests 1 %' }).expect(200);
    const res = (await request(app).post(`/api/deals/${deal._id}/dispute`).set(bearer(owner.accessToken)).send({ action: 'RESOLVE', text: 'Settled at 0.5 %' }).expect(200)).body.data;
    expect(res.dispute).toMatchObject({ status: 'RESOLVED', resolution: 'Settled at 0.5 %' });
  });

  it('refunds income without editing it, and reports an income statement by category and branch', async () => {
    const cats = (await request(app).get('/api/transaction-categories').set(bearer(owner.accessToken))).body.data;
    const inc = cats.find((x: { key: string }) => x.key === 'CONSULTANCY');
    const t = (await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'INCOME', categoryId: inc._id, amount: 100_000, date: new Date() }).expect(201)).body.data;
    await request(app).post(`/api/transactions/${t._id}/refund`).set(bearer(owner.accessToken)).send({ amount: 30_000, date: new Date(), reason: 'Client cancelled' }).expect(201);
    await request(app).post(`/api/transactions/${t._id}/refund`).set(bearer(owner.accessToken)).send({ amount: 80_000, date: new Date(), reason: 'Too much' }).expect(400);
    const st = (await request(app).get('/api/reports/income-statement').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(st.totals).toMatchObject({ income: 100_000, expense: 30_000, net: 70_000, marginPct: 70 });
    expect(st.expenses[0]).toMatchObject({ key: 'REFUNDS', total: 30_000 });
    expect(st.branches).toHaveLength(1);
    const list = (await request(app).get('/api/transactions?type=EXPENSE').set(bearer(owner.accessToken))).body.data;
    const voucher = await binary(request(app).get(`/api/vouchers/transaction/${list[0]._id}`).set(bearer(owner.accessToken)));
    expect(voucher.status).toBe(200);
  });

  it('records tenant notices (printable) and maintenance expenses on a lease', async () => {
    const o = await createOwner(app, owner);
    const p = await createProperty(app, owner, { listingPurpose: 'RENT', askingPrice: 80_000, ownerId: o._id });
    const tenant = await createClient(app, owner, { fullName: 'Tenant Tariq', mobileNumber: '03001110000', purchaseOrRental: 'RENTAL' });
    const lease = (await request(app).post('/api/leases').set(bearer(owner.accessToken)).send({ propertyId: p._id, tenantId: tenant._id, startDate: new Date(), endDate: new Date(Date.now() + 365 * DAY), monthlyRent: 80_000 }).expect(201)).body.data;
    const withNotice = (await request(app).post(`/api/leases/${lease._id}/notices`).set(bearer(owner.accessToken)).send({ type: 'RENT_INCREASE', subject: 'Rent revision from next month', message: 'Your rent will be revised by 10% as agreed.', deliveredVia: 'WHATSAPP' }).expect(201)).body.data;
    const pdf = await binary(request(app).get(`/api/leases/${lease._id}/notices/${withNotice.notices[0]._id}/pdf`).set(bearer(owner.accessToken)));
    expect(pdf.status).toBe(200);
    const cats = (await request(app).get('/api/transaction-categories').set(bearer(owner.accessToken))).body.data;
    const maint = cats.find((x: { key: string }) => x.key === 'MAINTENANCE');
    await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'EXPENSE', categoryId: maint._id, amount: 12_000, date: new Date(), leaseId: lease._id, description: 'Geyser repair' }).expect(201);
    const ex = (await request(app).get(`/api/leases/${lease._id}/expenses`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(ex.total).toBe(12_000);
  });

  it('assigns website leads in turn between the chosen agents', async () => {
    const a1 = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT], fullName: 'Agent One' });
    const a2 = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT], fullName: 'Agent Two' });
    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ leadAssignment: { mode: 'ROUND_ROBIN', agentIds: [a1.userId, a2.userId] } }).expect(200);
    await request(app).put('/api/website').set(bearer(owner.accessToken)).send({ enabled: true, slug: `rr-${Date.now()}` }).expect(200);
    const slug = (await request(app).get('/api/website').set(bearer(owner.accessToken))).body.data.slug;
    for (const n of ['03011111111', '03022222222', '03033333333']) await request(app).post(`/api/public/sites/${slug}/inquiries`).send({ name: 'Visitor', phone: n }).expect(201);
    const leads = await Client.find({ businessId: owner.businessId, source: 'WEBSITE' }).sort({ createdAt: 1 }).lean();
    expect(leads.map((l) => String(l.assignedTo))).toEqual([a1.userId, a2.userId, a1.userId]);
  });

  it('lets clients manage preferences, favourites and visit requests, and owners confirm availability, as the agency allows', async () => {
    const c = await createClient(app, owner);
    const p = await createProperty(app, owner);
    const match = await Match.findOne({ businessId: owner.businessId, clientId: c._id, propertyId: p._id }).lean();
    expect(match).toBeTruthy();
    const link = (await request(app).post('/api/portal-links').set(bearer(owner.accessToken)).send({ kind: 'CLIENT', partyId: c._id }).expect(201)).body.data;
    const token = link.url.split('/portal/')[1];
    const view = (await request(app).get(`/api/public/portal/${token}`).expect(200)).body.data;
    expect(view.matches[0].property.ref).toBe(p.propertyId);
    expect(JSON.stringify(view.matches)).not.toContain('ownerId');
    await request(app).post(`/api/public/portal/${token}/matches/${match!._id}`).send({ reaction: 'FAVORITE' }).expect(200);
    expect((await Match.findOne({ businessId: owner.businessId, _id: match!._id }).lean())!.status).toBe('SHORTLISTED');
    await request(app).patch(`/api/public/portal/${token}/preferences`).send({ maxBudget: 20_000_000, societies: ['DHA Karachi'] }).expect(200);
    expect((await Client.findOne({ businessId: owner.businessId, _id: c._id }).lean())!.requirements[0]).toMatchObject({ maxBudget: 20_000_000, societies: ['DHA Karachi'] });
    await request(app).post(`/api/public/portal/${token}/visits`).send({ propertyId: p._id, preferredAt: new Date(Date.now() + 2 * DAY) }).expect(201);
    expect(await FollowUp.countDocuments({ businessId: owner.businessId, clientId: c._id, type: 'PROPERTY_VISIT' })).toBe(1);
    const other = await createProperty(app, owner, { block: '99', society: 'Faraway', askingPrice: 999_000_000 });
    await request(app).post(`/api/public/portal/${token}/visits`).send({ propertyId: other._id, preferredAt: new Date(Date.now() + DAY) }).expect(404);

    await request(app).put('/api/portal-settings').set(bearer(owner.accessToken)).send({ allowPreferenceUpdates: false }).expect(200);
    await request(app).patch(`/api/public/portal/${token}/preferences`).send({ maxBudget: 1 }).expect(403);

    const o = await createOwner(app, owner);
    const op = await createProperty(app, owner, { ownerId: o._id, block: '5' });
    const olink = (await request(app).post('/api/portal-links').set(bearer(owner.accessToken)).send({ kind: 'OWNER', partyId: o._id }).expect(201)).body.data;
    const otoken = olink.url.split('/portal/')[1];
    await request(app).post(`/api/public/portal/${otoken}/properties/${op._id}/availability`).send({ available: true, askingPrice: 16_000_000 }).expect(200);
    const after = (await request(app).get(`/api/properties/${op._id}`).set(bearer(owner.accessToken))).body.data;
    expect(after.lastVerifiedAt).toBeTruthy();
    expect(after.askingPrice).toBe(15_500_000); // a price change is a request to the agent, never applied directly
    await request(app).post(`/api/public/portal/${otoken}/properties/${p._id}/availability`).send({ available: true }).expect(404);
  });

  it('never shares sensitive documents through the portal', async () => {
    const o = await createOwner(app, owner);
    const doc = await Document.create({ businessId: owner.businessId, entityType: 'owner', entityId: o._id, kind: 'pdf', category: 'CNIC', fileName: 'cnic.pdf', storageKey: 'k', storageProvider: 'local', mimeType: 'application/pdf', fileSize: 10, isPrivate: true, uploadedBy: owner.userId, createdBy: owner.userId, updatedBy: owner.userId });
    const r = await request(app).patch(`/api/documents/${doc._id}`).set(bearer(owner.accessToken)).send({ sharedWithPortal: true });
    expect(r.status).toBe(400);
  });

  it('reports agent performance (with Excel export), business summary, branch targets and listing quality', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    await createClient(app, owner, { assignedTo: agent.userId });
    const perf = (await request(app).get('/api/reports/agent-performance').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(perf.rows.find((r: { userId: string }) => r.userId === agent.userId).leadsAssigned).toBe(1);
    const mine = (await request(app).get('/api/reports/agent-performance').set(bearer(agent.accessToken)).expect(200)).body.data;
    expect(mine.rows.map((r: { userId: string }) => r.userId)).toEqual([agent.userId]);
    await request(app).get(`/api/reports/agent-performance?agentId=${owner.userId}`).set(bearer(agent.accessToken)).expect(403);
    const xlsx = await binary(request(app).get('/api/reports/agent-performance?format=xlsx').set(bearer(owner.accessToken)));
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const p = await createProperty(app, owner);
    const sum = (await request(app).get('/api/reports/business-summary').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(sum.properties.total).toBe(1);
    expect(sum.leads.new).toBe(1);

    const branches = (await request(app).get('/api/branches').set(bearer(owner.accessToken))).body.data;
    await request(app).patch(`/api/branches/${branches[0]._id}`).set(bearer(owner.accessToken)).send({ targets: { leads: 4, dealsWon: 2, commission: 500_000 } }).expect(200);
    const br = (await request(app).get('/api/reports/branches').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(br.rows[0]).toMatchObject({ leads: 1, progress: { leads: 25, dealsWon: 0, commission: 0 } });

    const q = (await request(app).get(`/api/ai/properties/${p._id}/quality`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(q.grade).toBe('POOR');
    expect(q.checks.find((c: { key: string }) => c.key === 'PHOTOS').ok).toBe(false);
  });
});
