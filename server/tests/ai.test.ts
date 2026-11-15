import request from 'supertest';
import { ROLE_PRESETS, estimatePrice, forecastCommission } from '@recrm/shared';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { AiUsage } from '../src/models/AiUsage';
import { aiClient, type MessagesClient } from '../src/services/ai/aiClient';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const DAY = 86_400_000;

type Params = Parameters<MessagesClient['beta']['messages']['create']>[0];
const usage = { input_tokens: 120, output_tokens: 40 };
const text = (t: string, stop = 'end_turn') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: t }], stop_reason: stop, usage });

function fake(replies: unknown[]) {
  const calls: Params[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (p: Params) => {
          calls.push(JSON.parse(JSON.stringify(p)));
          const r = replies.shift();
          if (!r) throw new Error('no scripted reply');
          return r as never;
        },
      },
    },
  };
  return { client, calls };
}

afterEach(() => aiClient.use(undefined));

describe('forecast and price maths (shared)', () => {
  it('weights open deals by stage into the right months', () => {
    const now = new Date(Date.UTC(2026, 10, 14));
    const f = forecastCommission(
      [
        { stage: 'TOKEN', outstanding: 300_000, expectedCloseDate: new Date(Date.UTC(2026, 11, 10)) },
        { stage: 'INQUIRY', outstanding: 100_000 }, // no date: ~90 days out
        { stage: 'NEGOTIATION', outstanding: 200_000, expectedCloseDate: new Date(Date.UTC(2026, 8, 1)) }, // overdue → this month
        { stage: 'CLOSED_LOST', outstanding: 999_999 },
      ],
      now,
    );
    expect(f.months[0]).toMatchObject({ month: '2026-11', weighted: 70_000, deals: 1 });
    expect(f.months[1]).toMatchObject({ month: '2026-12', weighted: 210_000, bestCase: 300_000 });
    expect(f.months[2].weighted + f.months[3].weighted).toBe(5_000);
    expect(f.weightedTotal).toBe(285_000);
  });

  it('estimates a range from comparables, ignoring outliers, and refuses with too few', () => {
    const comps = [10_000, 10_500, 11_000, 9_800, 10_200, 100_000].map((r) => ({ price: r * 1000, sizeSqft: 1000, kind: 'ASKING' as const }));
    const e = estimatePrice(1080, [...comps, { price: 10_400_000, sizeSqft: 1000, kind: 'SOLD' }])!;
    expect(e.perSqft).toBeGreaterThan(10_000);
    expect(e.perSqft).toBeLessThan(11_000);
    expect(e.low).toBeLessThanOrEqual(e.mid);
    expect(e.high).toBeGreaterThanOrEqual(e.mid);
    expect(e.sold).toBe(1);
    expect(estimatePrice(1000, comps.slice(0, 2))).toBeNull();
  });
});

describe('AI layer', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('works without a key: template descriptions, rule-based briefs, forecast and price estimate', async () => {
    aiClient.use(null);
    const p = await createProperty(app, owner, { bedrooms: 3, corner: true });
    const status = (await request(app).get('/api/ai/status').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(status).toMatchObject({ configured: false, model: null });
    const d = (await request(app).post(`/api/ai/properties/${p._id}/description`).set(bearer(owner.accessToken)).send({ language: 'en' }).expect(200)).body.data;
    expect(d.source).toBe('template');
    expect(d.description).toContain('Gulshan');
    expect(d.description).not.toContain('B-77');
    const ur = (await request(app).post(`/api/ai/properties/${p._id}/description`).set(bearer(owner.accessToken)).send({ language: 'ur' }).expect(200)).body.data;
    expect(ur.description).toMatch(/[؀-ۿ]/);

    const c = await createClient(app, owner);
    const brief = (await request(app).post(`/api/ai/clients/${c._id}/brief`).set(bearer(owner.accessToken)).send({}).expect(200)).body.data;
    expect(brief.source).toBe('rules');
    expect(brief.risks).toContain('Never contacted');
    expect(brief.message).toContain('Assalam-o-Alaikum');

    await request(app).post('/api/ai/assistant').set(bearer(owner.accessToken)).send({ messages: [{ role: 'user', content: 'Hello' }] }).expect(503);

    for (const [i, price] of [14_000_000, 15_000_000, 16_000_000, 15_500_000].entries()) await createProperty(app, owner, { askingPrice: price, block: `X${i}` });
    const est = (await request(app).get(`/api/ai/properties/${p._id}/price-estimate`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(est.comparables).toBe(4);
    expect(est.scope).toBe('Gulshan-e-Iqbal');
    expect(est.disclaimer).toMatch(/not a valuation/);

    await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: c._id, propertyId: p._id, agreedPrice: 15_000_000, stage: 'TOKEN', expectedCloseDate: new Date(Date.now() + 20 * DAY) }).expect(201);
    const f = (await request(app).get('/api/ai/forecast').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(f.months).toHaveLength(6);
    expect(f.totals.weightedCommission).toBe(210_000); // 2 % of 1.5 Cr at 70 %
    expect(f.leads.at(-1).created).toBeGreaterThanOrEqual(1);
  });

  it('writes a description with the model, without private fields, and meters usage', async () => {
    const { client, calls } = fake([text(JSON.stringify({ headline: 'Corner plot in Gulshan', description: 'A bright 120 sq. yard corner plot…' }))]);
    aiClient.use(client);
    const p = await createProperty(app, owner, { plotNumber: 'B-77', minimumPrice: 14_000_000, corner: true });
    const d = (await request(app).post(`/api/ai/properties/${p._id}/description`).set(bearer(owner.accessToken)).send({ language: 'en' }).expect(200)).body.data;
    expect(d).toMatchObject({ source: 'ai', headline: 'Corner plot in Gulshan' });
    const sent = calls[0];
    expect(sent.model).toBe(env.AI_MODEL);
    expect(sent.fallbacks).toBe('default');
    expect(sent.betas).toContain('server-side-fallback-2026-07-01');
    expect(sent.output_config?.format?.type).toBe('json_schema');
    const body = JSON.stringify(sent.messages);
    expect(body).not.toContain('B-77');
    expect(body).not.toContain('14000000');
    expect(await AiUsage.countDocuments({ businessId: owner.businessId, feature: 'description', outcome: 'OK' })).toBe(1);
  });

  it('runs the assistant with only the tools the user is allowed, then answers', async () => {
    await createClient(app, owner, { fullName: 'Bilal Khan', mobileNumber: '03337654321' });
    const viewer = await addActiveMember(app, owner, { permissions: ['clients:read'] });
    const { client, calls } = fake([
      { ...text('', 'tool_use'), content: [{ type: 'tool_use', id: 'tu1', name: 'search_clients', input: { query: 'Bilal', temperature: null } }] },
      text('Bilal Khan is a WARM lead; his number is +923337654321.'),
    ]);
    aiClient.use(client);
    const r = (await request(app).post('/api/ai/assistant').set(bearer(viewer.accessToken)).send({ messages: [{ role: 'user', content: 'Who is Bilal?' }] }).expect(200)).body.data;
    expect(r.answer).toContain('Bilal Khan');
    expect(r.toolsUsed).toEqual(['search_clients']);
    const toolNames = (calls[0].tools ?? []).map((t) => (t as { name: string }).name);
    expect(toolNames).toEqual(['search_clients', 'get_client']); // no deals, finance, properties, follow-ups
    const toolResult = JSON.stringify(calls[1].messages.at(-1));
    expect(toolResult).toContain('Bilal Khan');
    expect((calls[0].system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('refuses a tool the user may not use even if the model asks for it, and handles refusals and the monthly cap', async () => {
    const viewer = await addActiveMember(app, owner, { permissions: ['clients:read'] });
    const { client, calls } = fake([
      { ...text('', 'tool_use'), content: [{ type: 'tool_use', id: 'tu1', name: 'collections', input: {} }] },
      text('I cannot see collections.'),
      { ...text(''), stop_reason: 'refusal', content: [] },
    ]);
    aiClient.use(client);
    await request(app).post('/api/ai/assistant').set(bearer(viewer.accessToken)).send({ messages: [{ role: 'user', content: 'Who owes us money?' }] }).expect(200);
    expect(JSON.stringify(calls[1].messages.at(-1))).toContain('not available to this user');
    const refused = await request(app).post('/api/ai/assistant').set(bearer(owner.accessToken)).send({ messages: [{ role: 'user', content: 'x' }] });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AI_DECLINED');

    const limit = env.AI_MONTHLY_LIMIT;
    Object.assign(env, { AI_MONTHLY_LIMIT: 3 });
    try {
      const capped = await request(app).post('/api/ai/assistant').set(bearer(owner.accessToken)).send({ messages: [{ role: 'user', content: 'x' }] });
      expect(capped.status).toBe(429);
      expect(capped.body.code).toBe('AI_LIMIT_REACHED');
    } finally {
      Object.assign(env, { AI_MONTHLY_LIMIT: limit });
    }
  });

  it('is an Enterprise feature and respects permissions', async () => {
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.SALESPERSON] });
    await request(app).get('/api/ai/forecast').set(bearer(agent.accessToken)).expect(200); // own deals only
    const noReports = await addActiveMember(app, owner, { permissions: ['clients:read'] });
    await request(app).get('/api/ai/forecast').set(bearer(noReports.accessToken)).expect(403);
    const { Business } = await import('../src/models/Business');
    const { subscriptionService } = await import('../src/services/subscriptionService');
    await Business.updateOne({ _id: owner.businessId }, { $set: { 'subscription.plan': 'BUSINESS', 'subscription.status': 'ACTIVE' } });
    subscriptionService.forget(owner.businessId);
    const r = await request(app).get('/api/ai/status').set(bearer(owner.accessToken));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MODULE_NOT_IN_PLAN');
  });
});

describe('pluggable AI provider', () => {
  it('routes features and the assistant through the provider named by AI_PROVIDER, metering each call', async () => {
    const { AI_PROVIDERS } = await import('../src/services/ai/providers');
    const seen: string[] = [];
    AI_PROVIDERS.stub = {
      name: 'stub',
      configured: () => true,
      model: () => 'stub-model-1',
      async generateJson<T>(req: { prompt: string }, report: (r: { model: string; inputTokens: number; outputTokens: number; outcome: 'OK' }) => Promise<void>) {
        seen.push(`json:${req.prompt.slice(0, 9)}`);
        await report({ model: 'stub-model-1', inputTokens: 5, outputTokens: 7, outcome: 'OK' });
        return { headline: 'Stub headline', description: 'Stub description' } as T;
      },
      async runTools(req, report) {
        const r = await req.runTool('search_clients', { query: 'Zara', temperature: null });
        seen.push(`tool:${r.isError ? 'error' : 'ok'}`);
        await report({ model: 'stub-model-1', inputTokens: 1, outputTokens: 1, outcome: 'OK' });
        return { text: `Found via ${req.tools.length} tools`, exhausted: false };
      },
    };
    const prev = env.AI_PROVIDER;
    (env as { AI_PROVIDER: string }).AI_PROVIDER = 'stub';
    try {
      const owner = await registerOwner(app);
      const status = (await request(app).get('/api/ai/status').set(bearer(owner.accessToken)).expect(200)).body.data;
      expect(status).toMatchObject({ configured: true, provider: 'stub', model: 'stub-model-1' });
      const p = await createProperty(app, owner, {});
      const d = (await request(app).post(`/api/ai/properties/${p._id}/description`).set(bearer(owner.accessToken)).send({ language: 'en' }).expect(200)).body.data;
      expect(d).toMatchObject({ source: 'ai', headline: 'Stub headline' });
      const a = (await request(app).post('/api/ai/assistant').set(bearer(owner.accessToken)).send({ messages: [{ role: 'user', content: 'Who is Zara?' }] }).expect(200)).body.data;
      expect(a.answer).toMatch(/^Found via \d+ tools$/);
      expect(a.toolsUsed).toEqual(['search_clients']);
      expect(seen).toEqual(['json:Language:', 'tool:ok']);
      expect(await AiUsage.countDocuments({ businessId: owner.businessId, model: 'stub-model-1' })).toBe(2);
    } finally {
      (env as { AI_PROVIDER: string }).AI_PROVIDER = prev;
      delete AI_PROVIDERS.stub;
    }
  });
});
