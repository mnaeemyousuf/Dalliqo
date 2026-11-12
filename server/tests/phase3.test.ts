import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import request from 'supertest';
import { DEFAULT_LEAD_SCORING, ROLE_PRESETS, effectiveStatus, entitlementsFor, scoreLead } from '@recrm/shared';
import { createApp } from '../src/app';
import { Business } from '../src/models/Business';
import { Client } from '../src/models/Client';
import { Notification } from '../src/models/Notification';
import { Property } from '../src/models/Property';
import { automationService } from '../src/services/automationService';
import { subscriptionService } from '../src/services/subscriptionService';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const DAY = 86_400_000;

async function setPlan(s: Session, sub: Record<string, unknown>) {
  await Business.updateOne({ _id: s.businessId }, { $set: Object.fromEntries(Object.entries(sub).map(([k, v]) => [`subscription.${k}`, v])) });
  subscriptionService.forget(s.businessId);
}

describe('lead scoring engine (shared)', () => {
  const now = Date.now();
  it('scores a well-qualified, recently contacted lead as HOT and explains why', () => {
    const r = scoreLead(
      {
        status: 'ACTIVE',
        purpose: 'PURCHASE',
        minBudget: 20_000_000,
        maxBudget: 25_000_000,
        societies: ['DHA'],
        blocks: ['Phase 8'],
        propertyTypes: ['HOUSE'],
        matchCount: 3,
        createdAt: new Date(now - 5 * DAY),
        lastContactedAt: new Date(now - DAY),
        followUpsCompleted: 2,
        buyingTimeline: 'IMMEDIATE',
      },
      DEFAULT_LEAD_SCORING,
      now,
    );
    expect(r.score).toBe(100);
    expect(r.temperature).toBe('HOT');
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['BUDGET_MATCHES_INVENTORY', 'CONTACTED_RECENTLY', 'TIMELINE_IMMEDIATE']));
    expect(r.reasons.reduce((s, x) => s + x.max, 0)).toBeCloseTo(100, 0);
  });

  it('scores a vague, never-contacted lead as COLD and never as a perfect lead', () => {
    const r = scoreLead({ status: 'ACTIVE', createdAt: new Date(now - 10 * DAY) }, DEFAULT_LEAD_SCORING, now);
    expect(r.temperature).toBe('COLD');
    expect(r.score).toBeLessThan(DEFAULT_LEAD_SCORING.warmThreshold);
    expect(r.reasons.find((x) => x.factor === 'engagement')?.code).toBe('NEVER_CONTACTED');
    expect(r.reasons.find((x) => x.factor === 'budget')?.positive).toBe(false);
  });

  it('respects configured weights and thresholds', () => {
    const only = { ...DEFAULT_LEAD_SCORING, weights: { budget: 0, location: 0, category: 0, intent: 0, engagement: 0, followUps: 0, timeline: 1 } };
    expect(scoreLead({ buyingTimeline: 'IMMEDIATE' }, only, now).score).toBe(100);
    expect(scoreLead({ buyingTimeline: 'EXPLORING' }, only, now).score).toBe(10);
  });
});

describe('subscription entitlements (shared)', () => {
  it('lapses trials and paid periods by the clock, with a grace period', () => {
    const now = Date.now();
    expect(effectiveStatus({ plan: 'STARTER', status: 'TRIAL', trialEndsAt: new Date(now + DAY) }, now)).toBe('TRIAL');
    expect(effectiveStatus({ plan: 'STARTER', status: 'TRIAL', trialEndsAt: new Date(now - DAY) }, now)).toBe('EXPIRED');
    expect(effectiveStatus({ plan: 'STARTER', status: 'ACTIVE', currentPeriodEnd: new Date(now - DAY) }, now)).toBe('PAST_DUE');
    expect(effectiveStatus({ plan: 'STARTER', status: 'ACTIVE', currentPeriodEnd: new Date(now - 30 * DAY) }, now)).toBe('EXPIRED');
    const e = entitlementsFor({ plan: 'STARTER', status: 'ACTIVE' });
    expect(e.modules).toEqual(['crm', 'matching']);
    expect(e.limits.users).toBe(2);
  });
});

describe('lead management', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('scores leads on create, records source, campaign, timeline and response time', async () => {
    const c = await createClient(app, owner, { mobileNumber: '03005550001', source: 'FACEBOOK', campaign: 'DHA ad', buyingTimeline: 'ONE_MONTH' });
    const fresh = (await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).body.data;
    expect(fresh.source).toBe('FACEBOOK');
    expect(fresh.campaign).toBe('DHA ad');
    expect(fresh.leadScore).toBeGreaterThan(0);
    expect(fresh.leadScoreReasons.length).toBeGreaterThan(3);
    expect(['HOT', 'WARM', 'COLD']).toContain(fresh.temperature);
    expect(fresh.statusHistory[0].status).toBe('ACTIVE');

    const before = fresh.leadScore;
    await request(app).post(`/api/clients/${c._id}/communications`).set(bearer(owner.accessToken)).send({ channel: 'CALL' }).expect(200);
    const after = (await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).body.data;
    expect(after.firstContactedAt).toBeTruthy();
    expect(after.responseMinutes).toBeGreaterThanOrEqual(0);
    expect(after.leadScore).toBeGreaterThan(before);
  });

  it('keeps a manual temperature, a lost reason and the status history', async () => {
    const c = await createClient(app, owner, { mobileNumber: '03005550002' });
    await request(app).patch(`/api/clients/${c._id}`).set(bearer(owner.accessToken)).send({ temperatureOverride: 'HOT' }).expect(200);
    let d = (await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.temperature).toBe('HOT');
    await request(app).patch(`/api/clients/${c._id}`).set(bearer(owner.accessToken)).send({ status: 'CLOSED_LOST', lostReason: 'BUDGET', lostNote: 'Wanted under 1 crore' }).expect(200);
    d = (await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.lostReason).toBe('BUDGET');
    expect(d.statusHistory.map((h: { status: string }) => h.status)).toEqual(['ACTIVE', 'CLOSED_LOST']);
  });

  it('assigns leads with history, notifies the agent, and serves the unassigned inbox', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const c = await createClient(app, owner, { mobileNumber: '03005550003' });
    const inbox = await request(app).get('/api/clients?unassigned=true&limit=100').set(bearer(owner.accessToken)).expect(200);
    expect(inbox.body.data.some((x: { _id: string }) => x._id === c._id)).toBe(true);

    await request(app).post(`/api/clients/${c._id}/assign`).set(bearer(owner.accessToken)).send({ userId: agent.userId, note: 'Your area' }).expect(200);
    const d = (await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.assignedTo).toBe(agent.userId);
    expect(d.assignmentHistory).toHaveLength(1);
    const notes = await request(app).get('/api/notifications?category=LEAD').set(bearer(agent.accessToken)).expect(200);
    expect(notes.body.data[0].deepLink).toBe(`/clients/${c._id}`);

    // An agent without clients:update cannot reassign.
    const viewer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VIEWER] });
    await request(app).post(`/api/clients/${c._id}/assign`).set(bearer(viewer.accessToken)).send({ userId: null }).expect(403);
  });

  it('reports lead sources, conversion, aging and lost reasons', async () => {
    await createClient(app, owner, { mobileNumber: '03005550011', source: 'FACEBOOK' });
    await createClient(app, owner, { mobileNumber: '03005550012', source: 'ZAMEEN' });
    const lost = await createClient(app, owner, { mobileNumber: '03005550013' });
    await request(app).patch(`/api/clients/${lost._id}`).set(bearer(owner.accessToken)).send({ status: 'CLOSED_LOST', lostReason: 'BUDGET' }).expect(200);
    const r = await request(app).get('/api/reports/leads').set(bearer(owner.accessToken)).expect(200);
    expect(r.body.data.totals.leads).toBeGreaterThanOrEqual(3);
    expect(r.body.data.bySource.find((s: { source: string }) => s.source === 'FACEBOOK').leads).toBeGreaterThanOrEqual(1);
    expect(r.body.data.lostReasons.find((l: { reason: string }) => l.reason === 'BUDGET').count).toBe(1);
    expect(r.body.data.aging.map((a: { key: string }) => a.key)).toEqual(['0_7', '8_30', '31_90', '90_PLUS']);
  });

  it('imports leads from Excel, skipping duplicates and invalid rows', async () => {
    await createClient(app, owner, { mobileNumber: '03005550001' });
    const tpl = await request(app).get('/api/clients/import/template').set(bearer(owner.accessToken)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.addRow(['Name', 'Mobile', 'Source', 'Society', 'Max budget (PKR)', 'Property type']);
    ws.addRow(['Bilal Shah', '03217778899', 'ZAMEEN', 'Bahria Town', '30,000,000', 'HOUSE']);
    ws.addRow(['Duplicate Person', '03005550001', 'OLX', '', '', '']);
    ws.addRow(['No Phone', 'abc', '', '', '', '']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await request(app).post('/api/clients/import').set(bearer(owner.accessToken)).attach('file', file, 'leads.xlsx').expect(200);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.duplicates).toHaveLength(1);
    expect(res.body.data.errors).toHaveLength(1);
    const found = await request(app).get('/api/clients?q=Bilal').set(bearer(owner.accessToken));
    expect(found.body.data[0].source).toBe('ZAMEEN');
    expect(found.body.data[0].maxBudget).toBe(30_000_000);
  });
});

describe('property inventory', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('stores Pakistan-specific attributes and keeps a price history', async () => {
    const p = await createProperty(app, owner, { propertyType: 'HOUSE', phase: 'Phase 6', corner: true, parkFacing: true, facing: 'EAST', possessionStatus: 'POSSESSION', size: 1, sizeUnit: 'KANAL' });
    expect(p.corner).toBe(true);
    expect(p.sizeSqft).toBe(4500);
    await request(app).patch(`/api/properties/${p._id}`).set(bearer(owner.accessToken)).send({ askingPrice: 14_900_000 }).expect(200);
    const d = (await request(app).get(`/api/properties/${p._id}`).set(bearer(owner.accessToken))).body.data;
    expect(d.priceHistory.map((h: { price: number }) => h.price)).toEqual([15_500_000, 14_900_000]);
    const list = await request(app).get('/api/properties?corner=true&parkFacing=true&category=RESIDENTIAL').set(bearer(owner.accessToken));
    expect(list.body.data.map((x: { _id: string }) => x._id)).toContain(p._id);
  });

  it('detects duplicate listings of the same plot', async () => {
    await createProperty(app, owner, { plotNumber: 'Plot 12-A', block: '13-D' });
    const dup = await request(app).post('/api/properties').set(bearer(owner.accessToken)).send({ propertyType: 'RESIDENTIAL_PLOT', society: 'gulshan-e-iqbal', block: '13 D', plotNumber: 'plot 12a', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 15_000_000 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('PROPERTY_DUPLICATE');
    await request(app).post('/api/properties').set(bearer(owner.accessToken)).send({ propertyType: 'RESIDENTIAL_PLOT', society: 'Gulshan-e-Iqbal', block: '13-D', plotNumber: 'Plot 12-A', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 15_000_000, allowDuplicate: true }).expect(201);
    const look = await request(app).get('/api/properties/duplicates?society=Gulshan-e-Iqbal&block=13-D&plotNumber=Plot%2012A').set(bearer(owner.accessToken)).expect(200);
    expect(look.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('hides the floor price from members without permission (API and sync)', async () => {
    const p = await createProperty(app, owner, { minimumPrice: 14_000_000 });
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const own = await request(app).get(`/api/properties/${p._id}`).set(bearer(owner.accessToken));
    expect(own.body.data.minimumPrice).toBe(14_000_000);
    const theirs = await request(app).get(`/api/properties/${p._id}`).set(bearer(agent.accessToken));
    expect(theirs.body.data.minimumPrice).toBeUndefined();
    const pull = await request(app).get('/api/sync/pull').set(bearer(agent.accessToken));
    expect(pull.body.data.changes.properties.find((x: { _id: string }) => x._id === p._id).minimumPrice).toBeUndefined();
  });

  it('allows the new lifecycle statuses and reports inventory aging', async () => {
    const p = await createProperty(app, owner);
    await request(app).post(`/api/properties/${p._id}/status`).set(bearer(owner.accessToken)).send({ status: 'UNDER_NEGOTIATION' }).expect(200);
    await request(app).post(`/api/properties/${p._id}/status`).set(bearer(owner.accessToken)).send({ status: 'ON_HOLD' }).expect(200);
    const r = await request(app).get('/api/reports/inventory').set(bearer(owner.accessToken)).expect(200);
    expect(r.body.data.byStatus.ON_HOLD.count).toBe(1);
    expect(r.body.data.aging[0].key).toBe('0_30');
  });
});

describe('deal negotiation and closing checklist', () => {
  it('records offers and counter-offers, accepts one and ticks the checklist', async () => {
    const owner = await registerOwner(app);
    const client = await createClient(app, owner);
    const property = await createProperty(app, owner);
    const deal = (await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: client._id, propertyId: property._id })).body.data;
    expect(deal.initialAskingPrice).toBe(15_500_000);
    expect(deal.checklist).toHaveLength(10);

    let d = (await request(app).post(`/api/deals/${deal._id}/offers`).set(bearer(owner.accessToken)).send({ party: 'BUYER', amount: 14_000_000 }).expect(201)).body.data;
    expect(d.stage).toBe('NEGOTIATION');
    d = (await request(app).post(`/api/deals/${deal._id}/offers`).set(bearer(owner.accessToken)).send({ party: 'SELLER', amount: 15_000_000, note: 'Final' }).expect(201)).body.data;
    expect(d.offers[0].status).toBe('COUNTERED');
    const sellerOffer = d.offers[1]._id;
    d = (await request(app).post(`/api/deals/${deal._id}/offers/${sellerOffer}/respond`).set(bearer(owner.accessToken)).send({ status: 'ACCEPTED' }).expect(200)).body.data;
    expect(d.agreedPrice).toBe(15_000_000);
    expect(d.stage).toBe('OFFER');
    expect(d.expectedTotal).toBeGreaterThan(0);

    d = (await request(app).post(`/api/deals/${deal._id}/checklist`).set(bearer(owner.accessToken)).send({ key: 'TOKEN_RECEIVED', done: true }).expect(200)).body.data;
    const item = d.checklist.find((c: { key: string }) => c.key === 'TOKEN_RECEIVED');
    expect(item.done).toBe(true);
    expect(item.doneBy).toBe(owner.userId);
    await request(app).post(`/api/deals/${deal._id}/offers/3f0d6a3e-1c2b-4b8e-9a51-2f0f6d1a9b77/respond`).set(bearer(owner.accessToken)).send({ status: 'ACCEPTED' }).expect(404);
  });
});

describe('subscriptions', () => {
  it('starts new businesses on a full trial and exposes entitlements on /auth/me', async () => {
    const owner = await registerOwner(app);
    const me = await request(app).get('/api/auth/me').set(bearer(owner.accessToken)).expect(200);
    expect(me.body.data.entitlements.status).toBe('TRIAL');
    expect(me.body.data.entitlements.modules).toContain('finance');
    const sub = await request(app).get('/api/subscription').set(bearer(owner.accessToken)).expect(200);
    expect(sub.body.data.history[0].type).toBe('TRIAL_STARTED');
  });

  it('blocks modules outside the plan and enforces user limits', async () => {
    const owner = await registerOwner(app);
    await setPlan(owner, { plan: 'STARTER', status: 'ACTIVE' });
    const deals = await request(app).get('/api/deals').set(bearer(owner.accessToken));
    expect(deals.status).toBe(403);
    expect(deals.body.code).toBe('MODULE_NOT_IN_PLAN');
    await request(app).get('/api/clients').set(bearer(owner.accessToken)).expect(200);
    await addActiveMember(app, owner);
    const third = await request(app).post('/api/members').set(bearer(owner.accessToken)).send({ fullName: 'Third User', email: `third_${Date.now()}@example.com`, temporaryPassword: 'TempPass1' });
    expect(third.status).toBe(403);
    expect(third.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('makes an expired account read-only without hiding data', async () => {
    const owner = await registerOwner(app);
    await createClient(app, owner);
    await setPlan(owner, { status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) });
    await request(app).get('/api/clients').set(bearer(owner.accessToken)).expect(200);
    const write = await request(app).post('/api/clients').set(bearer(owner.accessToken)).send({ fullName: 'New Person', mobileNumber: '03009998877' });
    expect(write.status).toBe(402);
    expect(write.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('lets only platform admins change plans', async () => {
    const owner = await registerOwner(app);
    await request(app).get('/api/platform/businesses').set(bearer(owner.accessToken)).expect(403);
    await request(app).post('/api/subscription/request').set(bearer(owner.accessToken)).send({ plan: 'BUSINESS', cycle: 'ANNUAL' }).expect(200);
  });
});

describe('automation rules', () => {
  it('alerts on uncontacted hot leads once, and expires lapsed listings', async () => {
    const owner = await registerOwner(app);
    const c = await createClient(app, owner, { mobileNumber: '03005550099' });
    await Client.collection.updateOne({ _id: new Types.ObjectId(c._id) }, { $set: { temperature: 'HOT', createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    const p = await createProperty(app, owner);
    await Property.collection.updateOne({ _id: new Types.ObjectId(p._id) }, { $set: { availabilityExpiresAt: new Date(Date.now() - 60_000) } });

    const business = await Business.findById(owner.businessId).lean();
    await automationService.runForBusiness(business!);
    await automationService.runForBusiness(business!);
    const hot = await Notification.collection.find({ dedupeKey: `HOT_LEAD_UNCONTACTED:${c._id}` }).toArray();
    expect(hot).toHaveLength(1);
    const expired = await Property.collection.findOne({ _id: new Types.ObjectId(p._id) });
    expect(expired!.status).toBe('EXPIRED');
  });

  it('validates and stores automation and lead-scoring settings', async () => {
    const owner = await registerOwner(app);
    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ automation: { HOT_LEAD_UNCONTACTED: { threshold: 2 } } }).expect(400);
    const ok = await request(app)
      .patch('/api/settings')
      .set(bearer(owner.accessToken))
      .send({ automation: { LEAD_INACTIVE: { enabled: false, threshold: 10 } }, leadScoring: { hotThreshold: 80, warmThreshold: 50 } })
      .expect(200);
    expect(ok.body.data.automation.LEAD_INACTIVE).toEqual({ enabled: false, threshold: 10 });
    expect(ok.body.data.leadScoring.hotThreshold).toBe(80);
    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ leadScoring: { hotThreshold: 40, warmThreshold: 50 } }).expect(400);
  });
});
