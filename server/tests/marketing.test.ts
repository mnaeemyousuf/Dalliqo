import { createHmac } from 'node:crypto';
import request from 'supertest';
import { ROLE_PRESETS, campaignMetrics, slugify, whatsappLink } from '@recrm/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { Business } from '../src/models/Business';
import { Client } from '../src/models/Client';
import { FollowUp } from '../src/models/FollowUp';
import { Notification } from '../src/models/Notification';
import { devOutbox } from '../src/services/mailService';
import { subscriptionService } from '../src/services/subscriptionService';
import { createClient, createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();

async function binary(req: request.Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

async function openSite(owner: Session, slug = `yousuf-${Math.random().toString(36).slice(2, 8)}`) {
  await request(app).put('/api/website').set(bearer(owner.accessToken)).send({ enabled: true, slug, tagline: 'Plots and homes in Karachi', whatsapp: '03001234567' }).expect(200);
  return slug;
}

describe('marketing maths (shared)', () => {
  it('computes cost per lead, conversion and ROI', () => {
    expect(campaignMetrics({ spend: 100_000, leads: 40, won: 2, revenue: 450_000 })).toMatchObject({ costPerLead: 2500, conversionPct: 5, costPerWin: 50_000, roiPct: 350 });
    expect(campaignMetrics({ spend: 0, leads: 0, won: 0, revenue: 0 })).toMatchObject({ costPerLead: null, roiPct: null });
    expect(slugify('Yousuf Estate & Builders')).toBe('yousuf-estate-and-builders');
    expect(whatsappLink('+92 300 1234567', 'Salam')).toBe('https://wa.me/923001234567?text=Salam');
  });
});

describe('agency website, inquiries and campaigns', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
    devOutbox.length = 0;
  });

  it('validates the web address and keeps it unique', async () => {
    const r1 = await request(app).put('/api/website').set(bearer(owner.accessToken)).send({ enabled: true });
    expect(r1.status).toBe(400);
    await request(app).put('/api/website').set(bearer(owner.accessToken)).send({ slug: 'admin' }).expect(400);
    const slug = await openSite(owner);
    const other = await registerOwner(app);
    const clash = await request(app).put('/api/website').set(bearer(other.accessToken)).send({ slug });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('SLUG_TAKEN');
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    await request(app).put('/api/website').set(bearer(agent.accessToken)).send({ tagline: 'x' }).expect(403);
  });

  it('shows only published, live listings and never private details', async () => {
    const slug = await openSite(owner);
    const ownerRec = await createOwner(app, owner);
    const pub = await createProperty(app, owner, { ownerId: ownerRec._id, plotNumber: 'B-77', minimumPrice: 14_000_000, latitude: 24.92123, longitude: 67.09876 });
    const hidden = await createProperty(app, owner, { block: '7' });
    const sold = await createProperty(app, owner, { block: '9' });
    for (const p of [pub, sold]) await request(app).post(`/api/properties/${p._id}/publish`).set(bearer(owner.accessToken)).send({ published: true, headline: 'Corner plot near park' }).expect(200);
    await request(app).patch(`/api/properties/${sold._id}`).set(bearer(owner.accessToken)).send({ status: 'SOLD' });

    const site = (await request(app).get(`/api/public/sites/${slug}`).expect(200)).body.data;
    expect(site).toMatchObject({ name: 'Yousuf Estate & Builders', tagline: 'Plots and homes in Karachi', listingCount: 1 });
    const list = await request(app).get(`/api/public/sites/${slug}/listings`).expect(200);
    expect(list.body.data.map((x: { _id: string }) => x._id)).toEqual([pub._id]);
    const raw = JSON.stringify(list.body);
    for (const secret of ['B-77', '14000000', 'ownerId', 'Haji', 'minimumPrice']) expect(raw).not.toContain(secret);
    const one = (await request(app).get(`/api/public/sites/${slug}/listings/${pub._id}`).expect(200)).body.data;
    expect(one.listing.headline).toBe('Corner plot near park');
    expect(one.listing.approxLocation.lat).not.toBe(24.92123);
    await request(app).get(`/api/public/sites/${slug}/listings/${hidden._id}`).expect(404);
    await request(app).get('/api/public/sites/no-such-agency').expect(404);
    const settings = (await request(app).get('/api/website').set(bearer(owner.accessToken))).body.data;
    expect(settings.publishedListings).toBe(2);
  });

  it('turns an inquiry into an assigned lead with a call-back, once per person', async () => {
    const slug = await openSite(owner);
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const p = await createProperty(app, owner, { agentIds: [agent.userId] });
    await request(app).post(`/api/properties/${p._id}/publish`).set(bearer(owner.accessToken)).send({ published: true }).expect(200);
    const camp = (await request(app).post('/api/campaigns').set(bearer(owner.accessToken)).send({ name: 'Facebook Gulshan plots', channel: 'FACEBOOK', budget: 50_000, spend: 20_000 }).expect(201)).body.data;
    expect(camp.code).toBe('facebook-gulshan-plots');

    await request(app).post(`/api/public/sites/${slug}/inquiries`).send({ name: 'Bilal Khan', phone: '0333 7654321', email: 'bilal@example.com', message: 'Is the price final?', propertyId: p._id, campaign: camp.code }).expect(201);
    const lead = await Client.findOne({ businessId: owner.businessId, mobileNumber: '+923337654321' }).lean();
    expect(lead).toMatchObject({ source: 'WEBSITE', fullName: 'Bilal Khan' });
    expect(String(lead!.assignedTo)).toBe(agent.userId);
    expect(String(lead!.campaignId)).toBe(camp._id);
    expect(await FollowUp.countDocuments({ businessId: owner.businessId, clientId: lead!._id, status: 'PENDING' })).toBe(1);
    expect(await Notification.countDocuments({ businessId: owner.businessId, userId: agent.userId, category: 'LEAD' })).toBeGreaterThan(0);
    expect(devOutbox.some((m) => m.to === 'bilal@example.com')).toBe(true);

    // Same person again: no duplicate lead, no second follow-up.
    await request(app).post(`/api/public/sites/${slug}/inquiries`).send({ name: 'Bilal', phone: '+923337654321' }).expect(201);
    expect(await Client.countDocuments({ businessId: owner.businessId, mobileNumber: '+923337654321' })).toBe(1);
    expect(await FollowUp.countDocuments({ businessId: owner.businessId, clientId: lead!._id })).toBe(1);
    // Bots filling the honeypot get a polite 201 and nothing is created.
    await request(app).post(`/api/public/sites/${slug}/inquiries`).send({ name: 'Spam Bot', phone: '03110000000', website: 'http://spam' }).expect(201);
    expect(await Client.countDocuments({ businessId: owner.businessId, mobileNumber: '+923110000000' })).toBe(0);

    const inq = await request(app).get('/api/inquiries').set(bearer(owner.accessToken)).expect(200);
    expect(inq.body.meta.total).toBe(2);
    expect(inq.body.data[1].createdLead).toBe(true);

    // ROI: the lead closes a deal and pays commission.
    const deal = (await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: lead!._id, propertyId: p._id, agreedPrice: 15_000_000 }).expect(201)).body.data;
    await request(app).post(`/api/deals/${deal._id}/payments`).set(bearer(owner.accessToken)).send({ side: 'BUYER', amount: 150_000, date: new Date() }).expect(201);
    await request(app).post(`/api/deals/${deal._id}/stage`).set(bearer(owner.accessToken)).send({ stage: 'CLOSED_WON' }).expect(200);
    const c = (await request(app).get(`/api/campaigns/${camp._id}`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(c.metrics).toMatchObject({ leads: 1, won: 1, revenue: 150_000, inquiries: 1, costPerLead: 20_000, roiPct: 650 });
    const report = (await request(app).get('/api/reports/campaigns').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(report.totals.revenue).toBe(150_000);
    expect(report.bySource.find((s: { source: string }) => s.source === 'WEBSITE').leads).toBe(1);
  });

  it('keeps campaigns behind the marketing plan module and permission', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    await request(app).post('/api/campaigns').set(bearer(agent.accessToken)).send({ name: 'Billboards', channel: 'BILLBOARD' }).expect(403);
    await Business.updateOne({ _id: owner.businessId }, { $set: { 'subscription.plan': 'PROFESSIONAL', 'subscription.status': 'ACTIVE' } });
    subscriptionService.forget(owner.businessId);
    const r = await request(app).get('/api/campaigns').set(bearer(owner.accessToken));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MODULE_NOT_IN_PLAN');
  });
});

describe('client & owner portals', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('shows a client their plan and receipts through a secret link, until revoked', async () => {
    const client = await createClient(app, owner);
    const other = await createClient(app, owner, { fullName: 'Someone Else', mobileNumber: '03009998877' });
    const plan = (await request(app).post('/api/installments').set(bearer(owner.accessToken)).send({ clientId: client._id, totalAmount: 1_200_000, frequency: 'MONTHLY', count: 12, startDate: new Date() }).expect(201)).body.data;
    const paid = (await request(app).post(`/api/installments/${plan._id}/payments`).set(bearer(owner.accessToken)).send({ amount: 100_000, date: new Date() }).expect(200)).body.data;
    const otherPlan = (await request(app).post('/api/installments').set(bearer(owner.accessToken)).send({ clientId: other._id, totalAmount: 100_000, frequency: 'MONTHLY', count: 1, startDate: new Date() }).expect(201)).body.data;
    const otherPaid = (await request(app).post(`/api/installments/${otherPlan._id}/payments`).set(bearer(owner.accessToken)).send({ amount: 100_000, date: new Date() }).expect(200)).body.data;

    const link = (await request(app).post('/api/portal-links').set(bearer(owner.accessToken)).send({ kind: 'CLIENT', partyId: client._id, days: 7 }).expect(201)).body.data;
    const token = link.url.split('/portal/')[1];
    const view = (await request(app).get(`/api/public/portal/${token}`).expect(200)).body.data;
    expect(view.party.fullName).toBe('Muhammad Ali');
    expect(view.installmentPlans).toHaveLength(1);
    expect(view.installmentPlans[0].paidTotal).toBe(100_000);
    expect(JSON.stringify(view)).not.toContain('Someone Else');

    const pdf = await binary(request(app).get(`/api/public/portal/${token}/receipts/installment/${plan._id}/${paid.payments[0]._id}`));
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await request(app).get(`/api/public/portal/${token}/receipts/installment/${otherPlan._id}/${otherPaid.payments[0]._id}`).expect(404);

    await request(app).post(`/api/public/portal/${token}/requests`).send({ message: 'Please send me the next due date' }).expect(201);
    expect(await Notification.countDocuments({ businessId: owner.businessId, category: 'MARKETING' })).toBe(1);

    await request(app).delete(`/api/portal-links/${link._id}`).set(bearer(owner.accessToken)).expect(200);
    const gone = await request(app).get(`/api/public/portal/${token}`);
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe('LINK_EXPIRED');
    await request(app).get('/api/public/portal/not-a-real-token-but-long-enough-xx').expect(404);
  });

  it("shows an owner their listings' status and interest", async () => {
    const o = await createOwner(app, owner);
    const p = await createProperty(app, owner, { ownerId: o._id });
    await request(app).post(`/api/properties/${p._id}/publish`).set(bearer(owner.accessToken)).send({ published: true }).expect(200);
    const link = (await request(app).post('/api/portal-links').set(bearer(owner.accessToken)).send({ kind: 'OWNER', partyId: o._id }).expect(201)).body.data;
    const view = (await request(app).get(`/api/public/portal/${link.url.split('/portal/')[1]}`).expect(200)).body.data;
    expect(view.kind).toBe('OWNER');
    expect(view.properties[0]).toMatchObject({ ref: p.propertyId, onWebsite: true, status: 'AVAILABLE' });
    const viewer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VIEWER] });
    await request(app).post('/api/portal-links').set(bearer(viewer.accessToken)).send({ kind: 'OWNER', partyId: o._id }).expect(403);
  });
});

describe('WhatsApp Business and email notifications', () => {
  let owner: Session;
  const saved = { token: env.WHATSAPP_ACCESS_TOKEN, secret: env.WHATSAPP_APP_SECRET, verify: env.WHATSAPP_VERIFY_TOKEN };
  beforeEach(async () => {
    owner = await registerOwner(app);
    devOutbox.length = 0;
  });
  afterEach(() => {
    Object.assign(env, { WHATSAPP_ACCESS_TOKEN: saved.token, WHATSAPP_APP_SECRET: saved.secret, WHATSAPP_VERIFY_TOKEN: saved.verify });
    jest.restoreAllMocks();
  });

  it('falls back to a wa.me link when not connected', async () => {
    const client = await createClient(app, owner);
    const status = (await request(app).get('/api/whatsapp').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(status.mode).toBe('link');
    const sent = (await request(app).post('/api/whatsapp/send').set(bearer(owner.accessToken)).send({ to: '03001112233', text: 'Salam, new plots available', clientId: client._id }).expect(200)).body.data;
    expect(sent).toEqual({ mode: 'link', url: 'https://wa.me/923001112233?text=Salam%2C%20new%20plots%20available' });
  });

  it('sends through the Cloud API and turns signed inbound messages into leads', async () => {
    Object.assign(env, { WHATSAPP_ACCESS_TOKEN: 'test-token', WHATSAPP_APP_SECRET: 'test-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me' });
    await request(app).put('/api/whatsapp').set(bearer(owner.accessToken)).send({ phoneNumberId: '1234567890123', displayNumber: '03001234567' }).expect(200);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT1' }] }), { status: 200 }));
    const sent = (await request(app).post('/api/whatsapp/send').set(bearer(owner.accessToken)).send({ to: '03001112233', text: 'Salam' }).expect(200)).body.data;
    expect(sent).toEqual({ mode: 'cloud', messageId: 'wamid.OUT1' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/1234567890123/messages');

    expect((await request(app).get('/api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42').expect(200)).text).toBe('42');
    await request(app).get('/api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42').expect(403);

    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890123' }, contacts: [{ wa_id: '923451112222', profile: { name: 'Sana Tariq' } }], messages: [{ id: 'wamid.IN1', from: '923451112222', type: 'text', text: { body: 'Is the DHA house still available?' } }] } }] }] };
    const raw = JSON.stringify(payload);
    const sig = `sha256=${createHmac('sha256', 'test-secret').update(raw).digest('hex')}`;
    await request(app).post('/api/public/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=bad').send(raw).expect(401);
    await request(app).post('/api/public/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw).expect(200);
    await request(app).post('/api/public/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw).expect(200); // Meta retry
    const leads = await Client.find({ businessId: owner.businessId, mobileNumber: '+923451112222' }).lean();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ fullName: 'Sana Tariq', source: 'WHATSAPP' });
    const inq = (await request(app).get('/api/inquiries').set(bearer(owner.accessToken))).body;
    expect(inq.meta.total).toBe(1);
    expect(inq.data[0].channel).toBe('WHATSAPP');
  });

  it('emails a copy of notifications to members who opted in', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    await request(app).patch('/api/auth/me').set(bearer(agent.accessToken)).send({ preferences: { emailNotifications: true } }).expect(200);
    await createClient(app, owner, { assignedTo: agent.userId });
    await new Promise((r) => setTimeout(r, 200));
    expect(devOutbox.some((m) => m.to === agent.email && m.subject.startsWith('New lead assigned to you'))).toBe(true);
  });
});
