import request from 'supertest';
import { ALL_PERMISSIONS } from '@recrm/shared';
import { createApp } from '../src/app';
import { AuditLog } from '../src/models/AuditLog';
import { Session as SessionModel } from '../src/models/Session';
import { User } from '../src/models/User';
import { devOutbox } from '../src/services/mailService';
import { MOBILE, bearer, login, registerOwner } from './support/helpers';

const app = createApp();

describe('POST /api/auth/register', () => {
  it('creates user, business and owner membership with every permission', async () => {
    const res = await request(app).post('/api/auth/register').set(MOBILE).send({
      fullName: 'Muhammad Yousuf',
      email: 'Father@Example.com',
      password: 'Father123',
      businessName: 'Yousuf Estate',
      mobileNumber: '0300-1234567',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.user.email).toBe('father@example.com');
    expect(d.user.mobileNumber).toBe('+923001234567');
    expect(d.user.passwordHash).toBeUndefined();
    expect(d.business.name).toBe('Yousuf Estate');
    expect(d.business.currency).toBe('PKR');
    expect(d.membership.role).toBe('OWNER');
    expect(d.membership.permissions).toEqual(expect.arrayContaining([...ALL_PERMISSIONS]));
    expect(d.accessToken).toEqual(expect.any(String));
    expect(d.refreshToken).toEqual(expect.any(String));

    const stored = await User.findOne({ email: 'father@example.com' }).select('+passwordHash').lean();
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    const audit = await AuditLog.findOne({ businessId: d.business._id, action: 'business.created' }).lean();
    expect(audit).not.toBeNull();
  });

  it('rejects a duplicate email', async () => {
    const owner = await registerOwner(app);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Someone Else', email: owner.email.toUpperCase(), password: 'Another123', businessName: 'Other' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_IN_USE');
  });

  it('validates input and never echoes a stack trace', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'A', email: 'not-an-email', password: 'short', businessName: 'X', mobileNumber: '12' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    const paths = res.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['fullName', 'email', 'password', 'businessName', 'mobileNumber']));
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with correct credentials and records the login', async () => {
    const owner = await registerOwner(app);
    const session = await login(app, owner.email, owner.password);
    expect(session.businessId).toBe(owner.businessId);
    const me = await request(app).get('/api/auth/me').set(bearer(session.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(owner.email);
    expect(me.body.data.membership.role).toBe('OWNER');
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    const owner = await registerOwner(app);
    const wrong = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'Wrong1234' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Wrong1234' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const owner = await registerOwner(app);
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: owner.email, password: 'Wrong1234' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('access tokens', () => {
  it('rejects missing, malformed and tampered tokens', async () => {
    const owner = await registerOwner(app);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer('garbage'))).body.code).toBe('INVALID_TOKEN');
    const [h, p, s] = owner.accessToken.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}xx`;
    expect((await request(app).get('/api/auth/me').set(bearer(tampered))).status).toBe(401);
  });
});

describe('refresh token rotation (mobile)', () => {
  it('rotates the refresh token on every use', async () => {
    const owner = await registerOwner(app);
    const res = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: owner.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(owner.refreshToken);
    expect((await request(app).get('/api/auth/me').set(bearer(res.body.data.accessToken))).status).toBe(200);
  });

  it('detects reuse of a rotated token and kills the session', async () => {
    const owner = await registerOwner(app);
    const first = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: owner.refreshToken });
    expect(first.status).toBe(200);

    // An attacker replays the old token.
    const replay = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: owner.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate (rotated) token and its access token are now dead too.
    const legit = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: first.body.data.refreshToken });
    expect(legit.status).toBe(401);
    const me = await request(app).get('/api/auth/me').set(bearer(first.body.data.accessToken));
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('SESSION_REVOKED');
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').set(MOBILE).send({ refreshToken: 'x'.repeat(64) });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('refresh token cookie (web)', () => {
  it('keeps the refresh token out of the body and in an httpOnly cookie', async () => {
    const owner = await registerOwner(app);
    const res = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('recrm_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie.split(';')[0]);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.data.refreshToken).toBeUndefined();
  });
});

describe('logout', () => {
  it('revokes the session so its access token stops working immediately', async () => {
    const owner = await registerOwner(app);
    const out = await request(app).post('/api/auth/logout').set(MOBILE).send({ refreshToken: owner.refreshToken });
    expect(out.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(bearer(owner.accessToken));
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('SESSION_REVOKED');
  });

  it('logout-all signs out every device', async () => {
    const owner = await registerOwner(app);
    const phone2 = await login(app, owner.email, owner.password);
    await request(app).post('/api/auth/logout-all').set(bearer(owner.accessToken)).expect(200);
    expect((await request(app).get('/api/auth/me').set(bearer(phone2.accessToken))).status).toBe(401);
    expect(await SessionModel.countDocuments({ userId: owner.userId, revokedAt: null })).toBe(0);
  });
});

describe('forgot / reset password', () => {
  it('does not reveal whether an email exists', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(devOutbox).toHaveLength(0);
  });

  it('resets the password with a single-use token and signs out all devices', async () => {
    const owner = await registerOwner(app);
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email }).expect(200);
    expect(devOutbox).toHaveLength(1);
    const token = /Reset code \(for the mobile app\): (\S+)/.exec(devOutbox[0].text)![1];

    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'BrandNew123' });
    expect(reset.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set(bearer(owner.accessToken))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: owner.email, password: 'BrandNew123' })).status).toBe(200);

    const again = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Another123' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_RESET_TOKEN');
  });
});

describe('change password and sessions', () => {
  it('requires the current password and keeps only the current device signed in', async () => {
    const owner = await registerOwner(app);
    const otherDevice = await login(app, owner.email, owner.password);

    const bad = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(owner.accessToken))
      .send({ currentPassword: 'Nope12345', newPassword: 'Changed123' });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(owner.accessToken))
      .send({ currentPassword: owner.password, newPassword: 'Changed123' });
    expect(ok.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set(bearer(owner.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(otherDevice.accessToken))).status).toBe(401);
  });

  it('lists active sessions and revokes a specific one', async () => {
    const owner = await registerOwner(app);
    const tablet = await login(app, owner.email, owner.password);
    const list = await request(app).get('/api/auth/sessions').set(bearer(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);

    await request(app).delete(`/api/auth/sessions/${other._id}`).set(bearer(owner.accessToken)).expect(200);
    expect((await request(app).get('/api/auth/me').set(bearer(tablet.accessToken))).status).toBe(401);
  });

  it('updates profile preferences', async () => {
    const owner = await registerOwner(app);
    const res = await request(app)
      .patch('/api/auth/me')
      .set(bearer(owner.accessToken))
      .send({ preferences: { language: 'ur', theme: 'dark' } });
    expect(res.status).toBe(200);
    expect(res.body.data.preferences).toEqual({ language: 'ur', theme: 'dark' });
  });
});
