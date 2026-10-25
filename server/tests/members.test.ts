import request from 'supertest';
import { PERMISSIONS, ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { MOBILE, addActiveMember, bearer, login, registerOwner } from './support/helpers';

const app = createApp();

describe('family shared account: father adds son', () => {
  it('creates the son with the MEMBER preset and forces a password change', async () => {
    const father = await registerOwner(app);
    const res = await request(app)
      .post('/api/members')
      .set(bearer(father.accessToken))
      .send({ fullName: 'Ahmed Yousuf', email: 'son@example.com', mobileNumber: '+92 321 7654321', temporaryPassword: 'TempPass1' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('MEMBER');
    expect(res.body.data.permissions.sort()).toEqual([...ROLE_PRESETS.MEMBER].sort());
    expect(res.body.data.user.mobileNumber).toBe('+923217654321');

    const son = await login(app, 'son@example.com', 'TempPass1');
    expect(son.mustChangePassword).toBe(true);
    expect(son.businessId).toBe(father.businessId);

    const blocked = await request(app).get('/api/business').set(bearer(son.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await request(app)
      .post('/api/auth/change-password')
      .set(bearer(son.accessToken))
      .send({ currentPassword: 'TempPass1', newPassword: 'SonPass123' })
      .expect(200);

    const business = await request(app).get('/api/business').set(bearer(son.accessToken));
    expect(business.status).toBe(200);
    expect(business.body.data._id).toBe(father.businessId);
  });

  it('lets the son read members but not administer the account', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);

    expect((await request(app).get('/api/members').set(bearer(son.accessToken))).status).toBe(200);

    const addMember = await request(app)
      .post('/api/members')
      .set(bearer(son.accessToken))
      .send({ fullName: 'Intruder', email: 'x@example.com', temporaryPassword: 'TempPass1' });
    expect(addMember.status).toBe(403);
    expect(addMember.body.code).toBe('FORBIDDEN');

    expect((await request(app).patch('/api/business').set(bearer(son.accessToken)).send({ name: 'Mine now' })).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(bearer(son.accessToken))).status).toBe(403);
  });

  it('applies permission changes immediately, without waiting for token expiry', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    expect((await request(app).get('/api/members').set(bearer(son.accessToken))).status).toBe(200);

    const patch = await request(app)
      .patch(`/api/members/${son.memberId}`)
      .set(bearer(father.accessToken))
      .send({ permissions: [PERMISSIONS.CLIENTS_READ] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.permissions).toEqual([PERMISSIONS.CLIENTS_READ]);

    expect((await request(app).get('/api/members').set(bearer(son.accessToken))).status).toBe(403);
  });

  it('refuses to modify the owner, oneself, or assign a role that is not enabled', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);

    const self = await request(app).patch(`/api/members/${father.memberId}`).set(bearer(father.accessToken)).send({ status: 'SUSPENDED' });
    expect(self.status).toBe(403);
    expect(['CANNOT_MODIFY_OWNER', 'CANNOT_MODIFY_SELF']).toContain(self.body.code);

    const admin = await request(app).patch(`/api/members/${son.memberId}`).set(bearer(father.accessToken)).send({ role: 'ADMIN' });
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe('ROLE_NOT_ASSIGNABLE');

    const unknownPermission = await request(app)
      .patch(`/api/members/${son.memberId}`)
      .set(bearer(father.accessToken))
      .send({ permissions: ['everything:all'] });
    expect(unknownPermission.status).toBe(400);
  });

  it('suspending a member ends their sessions and blocks sign-in until reactivated', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);

    await request(app).patch(`/api/members/${son.memberId}`).set(bearer(father.accessToken)).send({ status: 'SUSPENDED' }).expect(200);

    const me = await request(app).get('/api/auth/me').set(bearer(son.accessToken));
    expect(me.status).toBe(401);
    const signIn = await request(app).post('/api/auth/login').set(MOBILE).send({ email: son.email, password: son.password });
    expect(signIn.status).toBe(403);
    expect(signIn.body.code).toBe('NO_ACTIVE_MEMBERSHIP');

    await request(app).patch(`/api/members/${son.memberId}`).set(bearer(father.accessToken)).send({ status: 'ACTIVE' }).expect(200);
    expect((await request(app).post('/api/auth/login').send({ email: son.email, password: son.password })).status).toBe(200);
  });

  it('removing a member hides them from the list and revokes access', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);

    await request(app).delete(`/api/members/${son.memberId}`).set(bearer(father.accessToken)).expect(200);

    const list = await request(app).get('/api/members').set(bearer(father.accessToken));
    expect(list.body.data.map((m: { _id: string }) => m._id)).not.toContain(son.memberId);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });
    expect((await request(app).get('/api/auth/me').set(bearer(son.accessToken))).status).toBe(401);
    expect((await request(app).get(`/api/members/${son.memberId}`).set(bearer(father.accessToken))).status).toBe(404);
  });

  it('owner can set a new temporary password for a member', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);

    await request(app)
      .post(`/api/members/${son.memberId}/reset-password`)
      .set(bearer(father.accessToken))
      .send({ temporaryPassword: 'Reset1234' })
      .expect(200);

    expect((await request(app).get('/api/auth/me').set(bearer(son.accessToken))).status).toBe(401);
    const again = await login(app, son.email, 'Reset1234');
    expect(again.mustChangePassword).toBe(true);
  });

  it('records member administration in the audit log', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    await request(app)
      .patch(`/api/members/${son.memberId}`)
      .set(bearer(father.accessToken))
      .send({ permissions: [PERMISSIONS.CLIENTS_READ] })
      .expect(200);

    const logs = await request(app).get('/api/audit-logs?entityType=member').set(bearer(father.accessToken));
    expect(logs.status).toBe(200);
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['member.created', 'member.updated']));
    const update = logs.body.data.find((l: { action: string }) => l.action === 'member.updated');
    expect(update.changes[0].field).toBe('permissions');
    expect(update.actorUserId.fullName).toBe('Muhammad Yousuf');
  });
});

describe('business settings', () => {
  it('owner updates business details and the change is audited', async () => {
    const father = await registerOwner(app);
    const res = await request(app)
      .patch('/api/business')
      .set(bearer(father.accessToken))
      .send({ name: 'Yousuf Real Estate', city: 'Karachi', defaultSizeUnit: 'SQ_YARD', timezone: 'Asia/Karachi' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Yousuf Real Estate');

    const logs = await request(app).get('/api/audit-logs?action=business.updated').set(bearer(father.accessToken));
    expect(logs.body.data[0].changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name', newValue: 'Yousuf Real Estate' })]),
    );
  });

  it('rejects unknown fields and bad timezones', async () => {
    const father = await registerOwner(app);
    expect((await request(app).patch('/api/business').set(bearer(father.accessToken)).send({ ownerUserId: 'x' })).status).toBe(400);
    expect((await request(app).patch('/api/business').set(bearer(father.accessToken)).send({ timezone: 'Mars/Base' })).status).toBe(400);
  });

  it('exposes the permission catalogue for permission editors', async () => {
    const father = await registerOwner(app);
    const res = await request(app).get('/api/meta/permissions').set(bearer(father.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.assignableRoles).toEqual(['MEMBER']);
  });
});
