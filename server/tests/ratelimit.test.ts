import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { MOBILE, registerOwner } from './support/helpers';

describe('rate limits (enabled)', () => {
  const original = env.RATE_LIMIT_ENABLED;
  beforeAll(() => {
    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = true;
  });
  afterAll(() => {
    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = original;
  });

  it('lets a busy office behind one IP keep refreshing sessions', async () => {
    // A fresh app so the limiter counters start at zero for this test.
    const app = createApp();
    const s = await registerOwner(app);
    let token = s.refreshToken;
    // The old per-IP limit (120 per 15 minutes) signed everyone out after page reloads.
    for (let i = 0; i < 150; i++) {
      const res = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: token });
      expect(res.status).toBe(200);
      token = res.body.data.refreshToken;
    }
  }, 120_000);

  it('still limits repeated sign-in attempts for one account', async () => {
    const app = createApp();
    const s = await registerOwner(app);
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await request(app).post('/api/auth/login').set(MOBILE).send({ email: s.email, password: 'wrong-password-1' })).status;
    }
    expect(last).toBe(429);
  }, 60_000);
});

describe('API-wide limit (enabled)', () => {
  const original = env.RATE_LIMIT_ENABLED;
  beforeAll(() => {
    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = true;
  });
  afterAll(() => {
    (env as { RATE_LIMIT_ENABLED: boolean }).RATE_LIMIT_ENABLED = original;
  });

  it('never rate-limits health checks and allows well over 1,000 signed-in requests from one IP', async () => {
    const app = createApp();
    for (let i = 0; i < 50; i++) expect((await request(app).get('/api/health')).status).toBe(200);
    // Several office users behind one IP: each has their own token, so they don't share one bucket.
    const users = await Promise.all([registerOwner(app), registerOwner(app), registerOwner(app)]);
    let ok = 0;
    for (let i = 0; i < 400; i++) {
      for (const u of users) if ((await request(app).get('/api/dashboard').set({ Authorization: `Bearer ${u.accessToken}` })).status === 200) ok++;
    }
    expect(ok).toBe(1200);
  }, 300_000);
});
