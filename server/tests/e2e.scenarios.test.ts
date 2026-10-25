/**
 * Customer-journey scenarios from the final QA plan (A–H), exercised through the
 * real HTTP API, services and MongoDB (in-memory replica set). UI rendering of
 * the same journeys is checked separately in the browser (docs/FINAL_QA_REPORT.md).
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/constants';
import { addActiveMember, bearer, MOBILE, registerOwner } from './support/helpers';

const app = createApp();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const jpeg = () => sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 170, b: 120 } } }).jpeg().toBuffer();

const buyer = {
  fullName: 'Kamran Hussain',
  mobileNumber: '0321 5550101',
  purchaseOrRental: 'PURCHASE',
  propertyTypeRequired: ['HOUSE'],
  preferredSociety: 'DHA Karachi',
  minSize: 200,
  maxSize: 300,
  sizeUnit: 'SQ_YARD',
  minBudget: 50_000_000,
  maxBudget: 70_000_000,
};
const house = {
  propertyType: 'HOUSE',
  listingPurpose: 'SALE',
  area: 'Defence',
  society: 'DHA Karachi',
  block: 'Phase 6',
  size: 250,
  sizeUnit: 'SQ_YARD',
  askingPrice: 65_000_000,
  bedrooms: 4,
};

describe('Scenario A — new client', () => {
  it('creates a buyer with budget and location, persists it and finds relevant properties', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const p = await request(app).post('/api/properties').set(auth).send(house).expect(201);

    const created = await request(app).post('/api/clients').set(auth).send(buyer);
    expect(created.status).toBe(201);
    const reopened = await request(app).get(`/api/clients/${created.body.data._id}`).set(auth);
    expect(reopened.body.data).toMatchObject({ fullName: 'Kamran Hussain', mobileNumber: '+923215550101', minBudget: 50_000_000, maxBudget: 70_000_000, preferredSociety: 'DHA Karachi' });

    const matches = await request(app).get(`/api/clients/${created.body.data._id}/matches`).set(auth);
    expect(matches.body.data).toHaveLength(1);
    expect(matches.body.data[0].propertyId._id ?? matches.body.data[0].propertyId).toBe(p.body.data._id);
  });
});

describe('Scenario B — new property', () => {
  it('creates a property, uploads an image, reopens it with media and finds matching clients', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const c = await request(app).post('/api/clients').set(auth).send(buyer).expect(201);
    const p = await request(app).post('/api/properties').set(auth).send(house);
    expect(p.status).toBe(201);
    expect(p.body.data.propertyId).toBe('RE-000001');

    const up = await request(app).post(`/api/properties/${p.body.data._id}/media`).set(auth).attach('files', await jpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);

    const reopened = await request(app).get(`/api/properties/${p.body.data._id}`).set(auth);
    expect(reopened.body.data).toMatchObject({ society: 'DHA Karachi', block: 'Phase 6', askingPrice: 65_000_000, status: 'AVAILABLE' });
    expect(reopened.body.data.coverImageUrl).toBeTruthy();
    const media = await request(app).get(`/api/properties/${p.body.data._id}/media`).set(auth);
    expect(media.body.data).toHaveLength(1);
    expect(media.body.data[0]).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' });
    expect(media.body.data[0].thumbnailUrl).toBeTruthy();

    const matches = await request(app).get(`/api/properties/${p.body.data._id}/matches`).set(auth);
    expect((matches.body.data[0].clientId._id ?? matches.body.data[0].clientId)).toBe(c.body.data._id);
  });
});

describe('Scenario C — matching', () => {
  it('scores a buyer/property pair with reasons and recalculates when the budget changes', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const c = await request(app).post('/api/clients').set(auth).send(buyer).expect(201);
    await request(app).post('/api/properties').set(auth).send(house).expect(201);

    let m = await request(app).get(`/api/clients/${c.body.data._id}/matches`).set(auth);
    expect(m.body.data[0].matchScore).toBe(100);
    expect(m.body.data[0].band).toBe('EXCELLENT');
    const codes = m.body.data[0].matchReasons.map((r: { code: string }) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['TYPE_MATCH', 'SOCIETY_MATCH', 'BUDGET_WITHIN', 'SIZE_WITHIN', 'PURPOSE_MATCH']));

    // Budget drops below the asking price: the score must fall, not stay at the old value.
    await request(app).patch(`/api/clients/${c.body.data._id}`).set(auth).send({ minBudget: 30_000_000, maxBudget: 45_000_000 }).expect(200);
    m = await request(app).get(`/api/clients/${c.body.data._id}/matches?includeStale=true`).set(auth);
    const score = m.body.data[0]?.matchScore ?? 0;
    expect(score).toBeLessThan(100);
    expect(m.body.data[0]?.matchReasons?.some((r: { code: string }) => r.code === 'BUDGET_WITHIN') ?? false).toBe(false);

    // Only one match record per client/property pair, however often it is recalculated.
    await request(app).post('/api/matches/recalculate').set(auth).send({}).expect(200);
    await request(app).post('/api/matches/recalculate').set(auth).send({}).expect(200);
    const after = await request(app).get(`/api/clients/${c.body.data._id}/matches?includeStale=true`).set(auth);
    expect(after.body.data.length).toBeLessThanOrEqual(1);
    // Restoring the budget brings back exactly one live match, not a second copy.
    await request(app).patch(`/api/clients/${c.body.data._id}`).set(auth).send({ minBudget: 50_000_000, maxBudget: 70_000_000 }).expect(200);
    const restored = await request(app).get(`/api/clients/${c.body.data._id}/matches?includeStale=true`).set(auth);
    expect(restored.body.data).toHaveLength(1);
    expect(restored.body.data[0].matchScore).toBe(100);
  });
});

describe('Scenario D — follow-up', () => {
  it('schedules, shows in the right view, completes, and records history', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const c = await request(app).post('/api/clients').set(auth).send(buyer).expect(201);
    const f = await request(app).post('/api/followups').set(auth).send({ clientId: c.body.data._id, type: 'PROPERTY_VISIT', dueAt: inMinutes(90), notes: 'Show Phase 6 house' });
    expect(f.status).toBe(201);

    const day = await request(app).get('/api/my-day').set(auth);
    expect(day.body.data.propertyVisits.map((x: { _id: string }) => x._id)).toContain(f.body.data._id);
    const pending = await request(app).get('/api/followups?status=PENDING').set(auth);
    expect(pending.body.data.map((x: { _id: string }) => x._id)).toContain(f.body.data._id);

    const done = await request(app).post(`/api/followups/${f.body.data._id}/complete`).set(auth).send({ outcome: 'Liked it, second visit with family' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', outcome: 'Liked it, second visit with family' });
    expect(done.body.data.completedAt).toBeTruthy();
    const completed = await request(app).get('/api/followups?status=COMPLETED').set(auth);
    expect(completed.body.data.map((x: { _id: string }) => x._id)).toContain(f.body.data._id);

    const acts = await request(app).get(`/api/activities?entityId=${c.body.data._id}`).set(auth);
    const types = acts.body.data.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(['CLIENT_CREATED', 'FOLLOWUP_CREATED', 'FOLLOWUP_COMPLETED']));
  });
});

describe('Scenario E — team collaboration', () => {
  it('shares records inside a business and hides them from other businesses', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const stranger = await registerOwner(app);

    const c = await request(app).post('/api/clients').set(bearer(father.accessToken)).send(buyer).expect(201);
    const p = await request(app).post('/api/properties').set(bearer(son.accessToken)).send(house).expect(201);

    expect((await request(app).get(`/api/clients/${c.body.data._id}`).set(bearer(son.accessToken))).status).toBe(200);
    expect((await request(app).get(`/api/properties/${p.body.data._id}`).set(bearer(father.accessToken))).status).toBe(200);

    const asStranger = bearer(stranger.accessToken);
    expect((await request(app).get(`/api/clients/${c.body.data._id}`).set(asStranger)).status).toBe(404);
    expect((await request(app).patch(`/api/properties/${p.body.data._id}`).set(asStranger).send({ askingPrice: 1 })).status).toBe(404);
    expect((await request(app).get('/api/clients?q=Kamran').set(asStranger)).body.data).toHaveLength(0);
    expect((await request(app).get('/api/search?q=Kamran').set(asStranger)).body.data.clients).toHaveLength(0);

    // The member preset cannot delete core records; the backend enforces it.
    expect((await request(app).delete(`/api/clients/${c.body.data._id}`).set(bearer(son.accessToken))).status).toBe(403);
  });
});

describe('Scenario F — search', () => {
  it('finds records by name, mobile, property ID, area and type', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    await request(app).post('/api/clients').set(auth).send(buyer).expect(201);
    await request(app).post('/api/clients').set(auth).send({ ...buyer, fullName: 'Sana Tariq', mobileNumber: '03007770000', purchaseOrRental: 'RENTAL', propertyTypeRequired: ['FLAT'] }).expect(201);
    await request(app).post('/api/properties').set(auth).send(house).expect(201);
    await request(app).post('/api/properties').set(auth).send({ ...house, propertyType: 'FLAT', listingPurpose: 'RENT', area: 'Clifton', society: 'Clifton', block: 'Block 5', size: 1200, sizeUnit: 'SQ_FT', askingPrice: 85_000 }).expect(201);

    const names = async (url: string) => (await request(app).get(url).set(auth)).body.data.map((x: { fullName?: string; propertyId?: string }) => x.fullName ?? x.propertyId);
    expect(await names('/api/clients?q=kamran')).toEqual(['Kamran Hussain']);
    expect(await names('/api/clients?q=5550101')).toEqual(['Kamran Hussain']);
    expect(await names('/api/properties?q=RE-000002')).toEqual(['RE-000002']);
    expect(await names('/api/properties?q=2')).toEqual(['RE-000002']);
    expect(await names('/api/properties?area=clifton')).toEqual(['RE-000002']);
    expect(await names('/api/properties?propertyType=HOUSE')).toEqual(['RE-000001']);
    expect(await names('/api/clients?purpose=RENTAL')).toEqual(['Sana Tariq']);
    expect(await names('/api/properties?minPrice=1000000&maxPrice=70000000')).toEqual(['RE-000001']);
  });
});

describe('Scenario G — failure handling', () => {
  it('rejects invalid input with field details and no stack traces', async () => {
    const s = await registerOwner(app);
    const res = await request(app).post('/api/clients').set(bearer(s.accessToken)).send({ fullName: 'X', mobileNumber: '12' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it('distinguishes expired and invalid access tokens', async () => {
    const s = await registerOwner(app);
    const expired = jwt.sign({ bid: s.businessId, mid: s.memberId, sid: 'x' }, env.JWT_SECRET, {
      subject: s.userId, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: -10,
    });
    const r1 = await request(app).get('/api/clients').set(bearer(expired));
    expect(r1.status).toBe(401);
    expect(r1.body.code).toBe('TOKEN_EXPIRED');
    const r2 = await request(app).get('/api/clients').set(bearer('not-a-token'));
    expect(r2.status).toBe(401);
    expect(r2.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a disguised upload without creating a record', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const p = await request(app).post('/api/properties').set(auth).send(house).expect(201);
    const bad = await request(app).post(`/api/properties/${p.body.data._id}/media`).set(auth).attach('files', Buffer.from('MZ fake exe'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(bad.status).toBe(400);
    expect((await request(app).get(`/api/properties/${p.body.data._id}/media`).set(auth)).body.data).toHaveLength(0);
  });
});

describe('Scenario H — data integrity', () => {
  it('issues unique sequential property IDs under concurrent creation', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => request(app).post('/api/properties').set(auth).send({ ...house, block: `Phase ${i + 1}` })));
    const ids = results.map((r) => r.body.data.propertyId).sort();
    expect(new Set(ids).size).toBe(8);
    expect(ids).toEqual(Array.from({ length: 8 }, (_, i) => `RE-00000${i + 1}`));
  });

  it('applies a replayed offline mutation only once', async () => {
    const s = await registerOwner(app);
    const auth = { ...bearer(s.accessToken), ...MOBILE };
    const body = { mutations: [{ mutationId: randomUUID(), entity: 'clients', op: 'create', uuid: randomUUID(), data: { fullName: 'Offline Buyer', mobileNumber: '03451234567' } }] };
    await request(app).post('/api/sync/push').set(auth).send(body).expect(200);
    await request(app).post('/api/sync/push').set(auth).send(body).expect(200);
    expect((await request(app).get('/api/clients?q=offline').set(auth)).body.data).toHaveLength(1);
  });

  it('archives safely: deleted records leave lists and matches but stay in the audit trail', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const c = await request(app).post('/api/clients').set(auth).send(buyer).expect(201);
    const p = await request(app).post('/api/properties').set(auth).send(house).expect(201);
    expect((await request(app).get(`/api/properties/${p.body.data._id}/matches`).set(auth)).body.data).toHaveLength(1);

    await request(app).delete(`/api/clients/${c.body.data._id}`).set(auth).expect(200);
    expect((await request(app).get(`/api/clients/${c.body.data._id}`).set(auth)).status).toBe(404);
    expect((await request(app).get('/api/clients').set(auth)).body.data).toHaveLength(0);
    expect((await request(app).get(`/api/properties/${p.body.data._id}/matches`).set(auth)).body.data).toHaveLength(0);
    const audit = await request(app).get('/api/audit-logs').set(auth);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['client.created', 'client.deleted']));
  });
});
