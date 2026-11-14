import request from 'supertest';
import { ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { aiClient, type MessagesClient } from '../src/services/ai/aiClient';
import { createClient, createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const text = (t: string, stop = 'end_turn') => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: t }], stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } });

describe('follow-ups batch', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });
  afterEach(() => {
    aiClient.use(undefined);
    jest.restoreAllMocks();
  });

  it('saves co-owners and listing agents on a property', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const o1 = await createOwner(app, owner);
    const o2 = await createOwner(app, owner, { fullName: 'Second Owner', mobileNumber: '03215550000' });
    const p = await createProperty(app, owner, { ownerId: o1._id, coOwnerIds: [o2._id], agentIds: [agent.userId] });
    const got = (await request(app).get(`/api/properties/${p._id}`).set(bearer(owner.accessToken))).body.data;
    expect(got.coOwnerIds.map((x: { _id?: string } | string) => (typeof x === 'string' ? x : x._id))).toEqual([o2._id]);
    expect(got.agentIds.map((x: { _id?: string } | string) => (typeof x === 'string' ? x : x._id))).toEqual([agent.userId]);
  });

  it('counts expenses booked against a campaign in its spend and ROI', async () => {
    const camp = (await request(app).post('/api/campaigns').set(bearer(owner.accessToken)).send({ name: 'Billboard Shahrah-e-Faisal', channel: 'BILLBOARD', spend: 10_000 }).expect(201)).body.data;
    const cats = (await request(app).get('/api/transaction-categories').set(bearer(owner.accessToken))).body.data;
    const exp = cats.find((c: { type: string }) => c.type === 'EXPENSE');
    const inc = cats.find((c: { type: string }) => c.type === 'INCOME');
    await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'EXPENSE', categoryId: exp._id, amount: 40_000, date: new Date(), campaignId: camp._id }).expect(201);
    await request(app).post('/api/transactions').set(bearer(owner.accessToken)).send({ type: 'INCOME', categoryId: inc._id, amount: 5_000, date: new Date(), campaignId: camp._id }).expect(400);
    const c = (await request(app).get(`/api/campaigns/${camp._id}`).set(bearer(owner.accessToken))).body.data;
    expect(c.metrics).toMatchObject({ spend: 50_000, otherSpend: 10_000, bookedSpend: 40_000 });
  });

  it('shows an agent landing page only for agents with live listings', async () => {
    await request(app).put('/api/website').set(bearer(owner.accessToken)).send({ enabled: true, slug: `agency-${Date.now()}` }).expect(200);
    const slug = (await request(app).get('/api/website').set(bearer(owner.accessToken))).body.data.slug;
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT], fullName: 'Kashif Agent' });
    const idle = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const p = await createProperty(app, owner, { agentIds: [agent.userId] });
    await request(app).post(`/api/properties/${p._id}/publish`).set(bearer(owner.accessToken)).send({ published: true }).expect(200);
    const page = (await request(app).get(`/api/public/sites/${slug}/agents/${agent.userId}`).expect(200)).body.data;
    expect(page.agent).toMatchObject({ fullName: 'Kashif Agent', listingCount: 1 });
    await request(app).get(`/api/public/sites/${slug}/agents/${idle.userId}`).expect(404);
    const list = (await request(app).get(`/api/public/sites/${slug}/listings?agentId=${agent.userId}`).expect(200)).body;
    expect(list.meta.total).toBe(1);
  });

  it('gives managers a team leaderboard and hides it from agents', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    await createClient(app, owner, { assignedTo: agent.userId });
    const c = await createClient(app, owner, { fullName: 'Deal Client', mobileNumber: '03001239999' });
    const d = (await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: c._id, agreedPrice: 10_000_000, agents: [{ userId: agent.userId, sharePct: 50 }, { userId: owner.userId, sharePct: 50 }] }).expect(201)).body.data;
    await request(app).post(`/api/deals/${d._id}/payments`).set(bearer(owner.accessToken)).send({ side: 'BUYER', amount: 100_000, date: new Date() }).expect(201);
    const team = (await request(app).get('/api/dashboard/team').set(bearer(owner.accessToken)).expect(200)).body.data;
    const row = team.rows.find((r: { userId: string }) => r.userId === agent.userId);
    expect(row).toMatchObject({ leads: 1, openDeals: 1, commissionThisMonth: 50_000 });
    await request(app).get('/api/dashboard/team').set(bearer(agent.accessToken)).expect(403);
  });

  it('lets the assistant propose a follow-up without saving it', async () => {
    const c = await createClient(app, owner, { fullName: 'Hina Butt', mobileNumber: '03007778888' });
    const calls: unknown[] = [];
    const fake: MessagesClient = {
      beta: {
        messages: {
          create: async (p) => {
            calls.push(p);
            return (calls.length === 1
              ? { ...text('', 'tool_use'), content: [{ type: 'tool_use', id: 't1', name: 'propose_follow_up', input: { client_id: c._id, type: 'CALL', due: '2026-12-01T11:00', notes: 'Discuss DHA plot' } }] }
              : text('I have suggested a call with Hina for 1 December.')) as never;
          },
        },
      },
    };
    aiClient.use(fake);
    const r = (await request(app).post('/api/ai/assistant').set(bearer(owner.accessToken)).send({ messages: [{ role: 'user', content: 'Schedule a call with Hina on 1 Dec' }] }).expect(200)).body.data;
    expect(r.proposals).toEqual([expect.objectContaining({ kind: 'FOLLOW_UP', clientId: c._id, clientName: 'Hina Butt', type: 'CALL', notes: 'Discuss DHA plot' })]);
    const fups = (await request(app).get(`/api/followups?clientId=${c._id}`).set(bearer(owner.accessToken))).body.meta.total;
    expect(fups).toBe(0); // nothing saved until the user confirms
  });

  it('syncs approved WhatsApp templates and sends one with parameters', async () => {
    const saved = { token: env.WHATSAPP_ACCESS_TOKEN };
    Object.assign(env, { WHATSAPP_ACCESS_TOKEN: 'tok' });
    try {
      await request(app).put('/api/whatsapp').set(bearer(owner.accessToken)).send({ phoneNumberId: '1234567890', businessAccountId: '9876543210' }).expect(200);
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: 'new_listing', language: 'en', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, a new {{2}} is available.' }] }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.T1' }] }), { status: 200 }));
      const st = (await request(app).post('/api/whatsapp/templates/sync').set(bearer(owner.accessToken)).expect(200)).body.data;
      expect(st.templates).toEqual([{ name: 'new_listing', language: 'en', category: 'MARKETING', body: 'Hi {{1}}, a new {{2}} is available.', params: 2 }]);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/9876543210/message_templates');
      await request(app).post('/api/whatsapp/send').set(bearer(owner.accessToken)).send({ to: '03001112233', text: 'Hi Ali, a new plot is available.', template: { name: 'new_listing', language: 'en', params: ['Ali', 'plot'] } }).expect(200);
      const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
      expect(body).toMatchObject({ type: 'template', template: { name: 'new_listing', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ali' }, { type: 'text', text: 'plot' }] }] } });
    } finally {
      Object.assign(env, { WHATSAPP_ACCESS_TOKEN: saved.token });
    }
  });
});
