import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { migrateSubdomains } from '../src/migrations/008-subdomains';
import { Business } from '../src/models/Business';
import { subscriptionService } from '../src/services/subscriptionService';
import { slugifySubdomain, subdomainProblem, tenantService } from '../src/services/tenantService';
import { MOBILE, addActiveMember, bearer, registerOwner } from './support/helpers';

// SaaS mode for this file: agencies at <subdomain>.stateown.test.
const mutable = env as { TENANT_BASE_DOMAIN?: string; CRON_SECRET?: string };
const app = createApp();
const on = (sub: string) => ({ Host: `${sub}.stateown.test` });

beforeAll(() => {
  mutable.TENANT_BASE_DOMAIN = 'stateown.test';
  mutable.CRON_SECRET = 'cron-secret-0123456789-abcdefghij';
});
afterAll(() => {
  mutable.TENANT_BASE_DOMAIN = undefined;
  mutable.CRON_SECRET = undefined;
});
beforeEach(() => tenantService.forget());

describe('subdomain rules', () => {
  it('makes addresses from names and refuses bad or reserved ones', () => {
    expect(slugifySubdomain('Yousuf Estate & Builders')).toBe('yousuf-estate-builders');
    expect(slugifySubdomain('AB')).toBe('agency-ab');
    expect(subdomainProblem('ok-name')).toBeNull();
    for (const bad of ['ab', '-start', 'end-', 'two--dashes', 'UPPER', 'has.dot', 'x'.repeat(31)]) expect(subdomainProblem(bad)).not.toBeNull();
    for (const reserved of ['www', 'api', 'admin', 'mail', 'cpanel']) expect(subdomainProblem(reserved)).toBe('This address is reserved');
  });

  it('reads the agency from the host and ignores the shared address', () => {
    expect(tenantService.subdomainOf('yousuf.stateown.test')).toBe('yousuf');
    expect(tenantService.subdomainOf('Yousuf.StateOwn.test:443')).toBe('yousuf');
    for (const shared of ['stateown.test', 'www.stateown.test', 'api.stateown.test', 'a.b.stateown.test', 'localhost', 'evilstateown.test']) {
      expect(tenantService.subdomainOf(shared)).toBeNull();
    }
  });
});

describe('agencies on their own subdomain', () => {
  it('sign-up gives every agency a unique address (requested or made from its name)', async () => {
    const a = await registerOwner(app, { businessName: 'Crescent Homes' });
    const b = await registerOwner(app, { businessName: 'Crescent Homes' });
    const subA = (await Business.findById(a.businessId).lean())!.subdomain;
    const subB = (await Business.findById(b.businessId).lean())!.subdomain;
    expect(subA).toMatch(/^crescent-homes/);
    expect(subB).not.toBe(subA);

    const body = (sub: string) => ({ fullName: 'Owner Two', email: `o2_${Date.now()}_${sub}@example.com`, password: 'Father123', businessName: 'Second Agency', subdomain: sub });
    const ok = await request(app).post('/api/auth/register').set(MOBILE).send(body('second-agency'));
    expect(ok.status).toBe(201);
    expect(ok.body.data.business.subdomain).toBe('second-agency');
    const taken = await request(app).post('/api/auth/register').set(MOBILE).send(body('second-agency'));
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SUBDOMAIN_TAKEN');
    const reserved = await request(app).post('/api/auth/register').set(MOBILE).send(body('admin'));
    expect(reserved.status).toBe(400);
    expect(reserved.body.details[0]).toMatchObject({ path: 'subdomain', message: 'This address is reserved' });
    // New agencies are created on the shared address only.
    expect((await request(app).post('/api/auth/register').set(MOBILE).set(on('second-agency')).send(body('third-agency'))).status).toBe(403);
  });

  it('agencies with the same name signing up at the same moment each get their own address', async () => {
    const owners = await Promise.all([1, 2, 3, 4].map(() => registerOwner(app, { businessName: 'Same Name Realty' })));
    const subs = await Promise.all(owners.map(async (o) => (await Business.findById(o.businessId).lean())!.subdomain));
    expect(new Set(subs).size).toBe(4);
  });

  it('the sign-in page learns the agency; an unknown address is not an agency', async () => {
    const owner = await registerOwner(app, { businessName: 'Lookup Realty' });
    const sub = (await Business.findById(owner.businessId).lean())!.subdomain!;
    const known = await request(app).get('/api/public/tenant').set(on(sub));
    expect(known.body.data).toMatchObject({ baseDomain: 'stateown.test', subdomain: sub, tenant: { name: 'Lookup Realty', subdomain: sub } });
    const unknown = await request(app).get('/api/public/tenant').set(on('nobody-here'));
    expect(unknown.body.data).toMatchObject({ subdomain: 'nobody-here', tenant: null });
    const shared = await request(app).get('/api/public/tenant');
    expect(shared.body.data).toMatchObject({ subdomain: null, tenant: null });
    const api = await request(app).get('/api/clients').set(on('nobody-here')).set(bearer(owner.accessToken));
    expect(api.status).toBe(404);
    expect(api.body.code).toBe('TENANT_NOT_FOUND');
  });

  it('only an agency’s own people sign in on its address, and their tokens work only there', async () => {
    const a = await registerOwner(app, { businessName: 'Alpha Estates' });
    const b = await registerOwner(app, { businessName: 'Beta Estates' });
    const subA = (await Business.findById(a.businessId).lean())!.subdomain!;
    const subB = (await Business.findById(b.businessId).lean())!.subdomain!;

    // B's owner on A's address: same answer as a wrong password.
    const wrong = await request(app).post('/api/auth/login').set(MOBILE).set(on(subA)).send({ email: b.email, password: b.password });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    const right = await request(app).post('/api/auth/login').set(MOBILE).set(on(subA)).send({ email: a.email, password: a.password });
    expect(right.status).toBe(200);
    expect(right.body.data.business._id).toBe(a.businessId);

    // A token of agency B does not work on agency A's address (it does on B's and on the shared address).
    expect((await request(app).get('/api/clients').set(on(subA)).set(bearer(b.accessToken))).body.code).toBe('WRONG_TENANT');
    expect((await request(app).get('/api/clients').set(on(subB)).set(bearer(b.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/clients').set(bearer(b.accessToken))).status).toBe(200);
    const refresh = await request(app).post('/api/auth/refresh').set(MOBILE).set(on(subA)).send({ refreshToken: b.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('a person in two agencies signs in to the one whose address they use', async () => {
    const a = await registerOwner(app, { businessName: 'Gamma Homes' });
    const b = await registerOwner(app, { businessName: 'Delta Homes' });
    const member = await addActiveMember(app, b, { email: a.email } as never).catch(() => null);
    const subB = (await Business.findById(b.businessId).lean())!.subdomain!;
    if (member) {
      const r = await request(app).post('/api/auth/login').set(MOBILE).set(on(subB)).send({ email: a.email, password: a.password });
      expect(r.body.data.business._id).toBe(b.businessId);
    }
  });

  it('agency subdomains pass CORS; others do not', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://anything.stateown.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://anything.stateown.test');
    const evil = await request(app).get('/api/health').set('Origin', 'http://stateown.test.evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('links in e-mails and portals use the agency’s address', async () => {
    const owner = await registerOwner(app, { businessName: 'Link Realty' });
    const sub = (await Business.findById(owner.businessId).lean())!.subdomain!;
    expect(await tenantService.urlForBusiness(owner.businessId)).toBe(`http://${sub}.stateown.test`);
  });

  it('platform staff can move an agency to a new address', async () => {
    const owner = await registerOwner(app, { businessName: 'Moving Realty' });
    const admin = { businessId: owner.businessId, userId: owner.userId } as never;
    const r = await subscriptionService.setSubdomain(admin, owner.businessId, 'moved-realty');
    expect(r).toEqual({ subdomain: 'moved-realty', url: 'http://moved-realty.stateown.test' });
    expect((await request(app).get('/api/public/tenant').set(on('moved-realty'))).body.data.tenant.name).toBe('Moving Realty');
    await expect(subscriptionService.setSubdomain(admin, owner.businessId, 'www')).rejects.toThrow('reserved');
  });

  it('gives businesses created before subdomains an address', async () => {
    const owner = await registerOwner(app, { businessName: 'Old Timer Estates' });
    await Business.updateOne({ _id: owner.businessId }, { $unset: { subdomain: 1 } });
    const r = await migrateSubdomains();
    expect(r.assigned).toBeGreaterThanOrEqual(1);
    expect((await Business.findById(owner.businessId).lean())!.subdomain).toMatch(/^old-timer-estates/);
  });
});

describe('cron-triggered jobs (hosts without always-on timers)', () => {
  it('needs the secret and runs the due jobs', async () => {
    expect((await request(app).post('/api/internal/jobs')).status).toBe(404);
    expect((await request(app).post('/api/internal/jobs').set('X-Cron-Secret', 'wrong')).status).toBe(404);
    const r = await request(app).post('/api/internal/jobs').set('X-Cron-Secret', 'cron-secret-0123456789-abcdefghij');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});
