import request from 'supertest';
import { DEAL_STAGES, activeOpenStages, forecastCommission, normalizeDealPipeline } from '@recrm/shared';
import { createApp } from '../src/app';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

describe('configurable deal pipeline', () => {
  it('normalises stored settings: fixed order, required stages always on, won/lost certainties', () => {
    const p = normalizeDealPipeline({ stages: [{ stage: 'QUALIFIED', enabled: false }, { stage: 'INQUIRY', enabled: false }, { stage: 'CLOSED_WON', probability: 0.2 }, { stage: 'TOKEN', probability: 7 }] });
    expect(p.stages.map((s) => s.stage)).toEqual([...DEAL_STAGES]);
    expect(p.stages.find((s) => s.stage === 'INQUIRY')!.enabled).toBe(true);
    expect(p.stages.find((s) => s.stage === 'CLOSED_WON')!.probability).toBe(1);
    expect(p.stages.find((s) => s.stage === 'TOKEN')!.probability).toBe(0.7); // out of range → default
    expect(activeOpenStages(p)).not.toContain('QUALIFIED');
    const f = forecastCommission([{ stage: 'TOKEN', outstanding: 100_000, expectedCloseDate: new Date() }], new Date(), 6, { ...Object.fromEntries(DEAL_STAGES.map((s) => [s, 0])), TOKEN: 0.5 } as never);
    expect(f.weightedTotal).toBe(50_000);
  });

  it('lets managers rename, switch off and re-weight stages; deals follow the configuration', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const agent = await addActiveMember(app, owner, { permissions: ['deals:read', 'deals:create', 'deals:update', 'clients:read'] });

    // Defaults: every stage on.
    let pipe = (await request(app).get('/api/deals/pipeline').set(bearer(agent.accessToken)).expect(200)).body.data;
    expect(pipe.stages).toHaveLength(DEAL_STAGES.length);
    expect(pipe.stages.every((s: { enabled: boolean }) => s.enabled)).toBe(true);

    // Agents cannot change it; Inquiry / Won / Lost cannot be switched off.
    await request(app).patch('/api/settings').set(bearer(agent.accessToken)).send({ dealPipeline: { stages: [{ stage: 'QUALIFIED', enabled: false }] } }).expect(403);
    await request(app).patch('/api/settings').set(auth).send({ dealPipeline: { stages: [{ stage: 'CLOSED_LOST', enabled: false }] } }).expect(400);
    await request(app).patch('/api/settings').set(auth).send({ dealPipeline: { stages: [{ stage: 'TOKEN', probability: 1.5 }] } }).expect(400);

    const s = (
      await request(app)
        .patch('/api/settings')
        .set(auth)
        .send({ dealPipeline: { stages: [{ stage: 'QUALIFIED', enabled: false }, { stage: 'NEGOTIATION', enabled: false }, { stage: 'SITE_VISIT', label: 'Viewing', labelUr: 'معائنہ' }, { stage: 'TOKEN', probability: 0.5 }] } })
        .expect(200)
    ).body.data;
    expect(s.dealPipeline.stages.find((x: { stage: string }) => x.stage === 'SITE_VISIT')).toMatchObject({ enabled: true, label: 'Viewing', labelUr: 'معائنہ' });
    // A later partial update keeps earlier changes.
    await request(app).patch('/api/settings').set(auth).send({ dealPipeline: { stages: [{ stage: 'OFFER', label: 'Offer made' }] } }).expect(200);
    pipe = (await request(app).get('/api/deals/pipeline').set(auth).expect(200)).body.data;
    const by = (k: string) => pipe.stages.find((x: { stage: string }) => x.stage === k);
    expect(by('QUALIFIED').enabled).toBe(false);
    expect(by('OFFER').label).toBe('Offer made');
    expect(by('TOKEN').probability).toBe(0.5);

    const client = await createClient(app, owner);
    const property = await createProperty(app, owner);
    // Creating or moving a deal into a switched-off stage is refused.
    await request(app).post('/api/deals').set(auth).send({ clientId: client._id, stage: 'QUALIFIED' }).expect(400);
    const deal = (await request(app).post('/api/deals').set(auth).send({ clientId: client._id, propertyId: property._id }).expect(201)).body.data;
    await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage: 'QUALIFIED' }).expect(400);
    await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage: 'SITE_VISIT' }).expect(200);

    // An offer would normally move the deal to NEGOTIATION — switched off, so it stays put.
    const d = (await request(app).post(`/api/deals/${deal._id}/offers`).set(auth).send({ party: 'BUYER', amount: 14_000_000 }).expect(201)).body.data;
    expect(d.stage).toBe('SITE_VISIT');

    // The forecast uses the business's own stage weights.
    await request(app).post(`/api/deals/${deal._id}/stage`).set(auth).send({ stage: 'TOKEN' }).expect(200);
    const f = (await request(app).get('/api/ai/forecast').set(auth).expect(200)).body.data;
    const total = (await request(app).get(`/api/deals/${deal._id}`).set(auth).expect(200)).body.data.outstanding;
    expect(f.totals.weightedCommission).toBe(Math.round(total * 0.5));
  });
});
