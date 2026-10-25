import type { Express } from 'express';
import request from 'supertest';

let seq = 0;
const unique = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export const MOBILE = { 'X-Client-Type': 'mobile' };
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  businessId: string;
  memberId: string;
  email: string;
  password: string;
}

export async function registerOwner(
  app: Express,
  overrides: Partial<{ fullName: string; email: string; password: string; businessName: string; mobileNumber: string }> = {},
): Promise<Session> {
  const body = {
    fullName: 'Muhammad Yousuf',
    email: `owner_${unique()}@example.com`,
    password: 'Father123',
    businessName: 'Yousuf Estate & Builders',
    mobileNumber: '03001234567',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').set(MOBILE).send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const d = res.body.data;
  return {
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
    userId: d.user._id,
    businessId: d.business._id,
    memberId: d.membership._id,
    email: body.email,
    password: body.password,
  };
}

export async function login(app: Express, email: string, password: string): Promise<Session & { mustChangePassword: boolean }> {
  const res = await request(app).post('/api/auth/login').set(MOBILE).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const d = res.body.data;
  return {
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
    userId: d.user._id,
    businessId: d.business._id,
    memberId: d.membership._id,
    email,
    password,
    mustChangePassword: d.user.mustChangePassword,
  };
}

/** Owner adds a member, who then signs in and replaces the temporary password. */
export async function addActiveMember(
  app: Express,
  owner: Session,
  overrides: Record<string, unknown> = {},
): Promise<Session> {
  const email = `son_${unique()}@example.com`;
  const res = await request(app)
    .post('/api/members')
    .set(bearer(owner.accessToken))
    .send({ fullName: 'Ahmed Yousuf', email, temporaryPassword: 'TempPass1', ...overrides });
  if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${JSON.stringify(res.body)}`);

  const first = await login(app, email, 'TempPass1');
  const change = await request(app)
    .post('/api/auth/change-password')
    .set(bearer(first.accessToken))
    .send({ currentPassword: 'TempPass1', newPassword: 'SonPass123' });
  if (change.status !== 200) throw new Error(`change password failed: ${change.status} ${JSON.stringify(change.body)}`);
  return { ...first, password: 'SonPass123' };
}
