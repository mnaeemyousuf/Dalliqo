import request from 'supertest';
import { createApp } from '../src/app';
import { FollowUp } from '../src/models/FollowUp';
import { Notification } from '../src/models/Notification';
import { followUpService } from '../src/services/followUpService';
import { dayRange } from '../src/utils/time';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('follow-ups', () => {
  it('creates a follow-up with a default reminder and shows it on the client timeline', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const p = await createProperty(app, s);
    const res = await request(app)
      .post('/api/followups')
      .set(bearer(s.accessToken))
      .send({ clientId: c._id, propertyId: p._id, type: 'CALL', dueAt: inMinutes(120), priority: 'HIGH', notes: 'Discuss price' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', assignedTo: s.userId, priority: 'HIGH' });
    const due = new Date(res.body.data.dueAt).getTime();
    expect(due - new Date(res.body.data.reminderAt).getTime()).toBe(30 * 60_000);

    const acts = await request(app).get(`/api/activities?entityId=${p._id}`).set(bearer(s.accessToken));
    expect(acts.body.data[0].summary).toBe('Follow-up scheduled: Call Muhammad Ali regarding the Gulshan-e-Iqbal property (RE-000001)');
  });

  it('notifies the assignee when the father assigns a follow-up to the son', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const c = await createClient(app, father);
    await request(app)
      .post('/api/followups')
      .set(bearer(father.accessToken))
      .send({ clientId: c._id, type: 'PROPERTY_VISIT', dueAt: inMinutes(60), assignedTo: son.userId })
      .expect(201);
    const inbox = await request(app).get('/api/notifications').set(bearer(son.accessToken));
    expect(inbox.body.data[0]).toMatchObject({ category: 'FOLLOWUP', title: 'New follow-up assigned to you' });
    expect(inbox.body.meta.unreadCount).toBe(1);
    // The father did not notify himself.
    expect((await request(app).get('/api/notifications').set(bearer(father.accessToken))).body.data).toHaveLength(0);
  });

  it('rejects assigning to someone outside the business', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const c = await createClient(app, a);
    const res = await request(app).post('/api/followups').set(bearer(a.accessToken)).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(5), assignedTo: b.userId });
    expect(res.status).toBe(400);
  });

  it('completes a follow-up, records the outcome and updates last contact', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const f = await request(app).post('/api/followups').set(bearer(s.accessToken)).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(10) });
    const done = await request(app).post(`/api/followups/${f.body.data._id}/complete`).set(bearer(s.accessToken)).send({ outcome: 'Interested, wants a visit' });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', outcome: 'Interested, wants a visit' });
    expect((await request(app).get(`/api/clients/${c._id}`).set(bearer(s.accessToken))).body.data.lastContactedAt).toBeTruthy();
    const acts = await request(app).get(`/api/activities?entityId=${c._id}`).set(bearer(s.accessToken));
    expect(acts.body.data[0].type).toBe('FOLLOWUP_COMPLETED');
  });

  it('lists my follow-ups ordered by due time', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    for (const m of [300, 60, 180]) {
      await request(app).post('/api/followups').set(bearer(s.accessToken)).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(m) });
    }
    const res = await request(app).get('/api/followups?assignedTo=me&status=PENDING').set(bearer(s.accessToken));
    const dues = res.body.data.map((f: { dueAt: string }) => new Date(f.dueAt).getTime());
    expect(dues).toEqual([...dues].sort((a, b) => a - b));
    expect(res.body.data[0].clientId.fullName).toBe('Muhammad Ali');
  });
});

describe('scheduled jobs', () => {
  it('sends each due reminder exactly once, to the assignee', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const c = await createClient(app, father);
    const p = await createProperty(app, father);
    await request(app)
      .post('/api/followups')
      .set(bearer(father.accessToken))
      .send({ clientId: c._id, propertyId: p._id, type: 'CALL', dueAt: inMinutes(10), reminderMinutesBefore: 15, assignedTo: son.userId })
      .expect(201);

    expect(await followUpService.sendDueReminders()).toBe(1);
    expect(await followUpService.sendDueReminders()).toBe(0);
    const reminder = await Notification.findOne({ businessId: father.businessId, userId: son.userId, title: 'Follow-up Reminder' }).lean();
    expect(reminder!.body).toBe('Call Muhammad Ali regarding the Gulshan-e-Iqbal property (RE-000001)');
    expect(reminder!.deepLink).toMatch(/^\/followups\/[a-f0-9]{24}$/);
  });

  it('marks past-due follow-ups as overdue', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const f = await request(app).post('/api/followups').set(bearer(s.accessToken)).send({ clientId: c._id, type: 'MEETING', dueAt: inMinutes(30) });
    await FollowUp.updateOne({ _id: f.body.data._id, businessId: s.businessId }, { $set: { dueAt: new Date(Date.now() - 60_000) } });
    expect(await followUpService.markOverdue()).toBe(1);
    const after = await request(app).get(`/api/followups/${f.body.data._id}`).set(bearer(s.accessToken));
    expect(after.body.data.status).toBe('OVERDUE');
    expect(after.body.data.version).toBe(2);
  });
});

describe('notification centre', () => {
  it('filters by category, marks one and all as read', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const c = await createClient(app, father);
    await createProperty(app, father); // match notification to everyone (client unassigned)
    await request(app).post('/api/followups').set(bearer(father.accessToken)).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(60), assignedTo: son.userId });

    const auth = bearer(son.accessToken);
    expect((await request(app).get('/api/notifications?category=MATCH').set(auth)).body.data).toHaveLength(1);
    const all = await request(app).get('/api/notifications').set(auth);
    expect(all.body.meta.unreadCount).toBe(2);
    await request(app).post(`/api/notifications/${all.body.data[0]._id}/read`).set(auth).expect(200);
    expect((await request(app).get('/api/notifications?unread=true').set(auth)).body.data).toHaveLength(1);
    await request(app).post('/api/notifications/read-all').set(auth).send({}).expect(200);
    expect((await request(app).get('/api/notifications').set(auth)).body.meta.unreadCount).toBe(0);
    // Cannot read someone else's notification.
    const fatherN = await request(app).get('/api/notifications').set(bearer(father.accessToken));
    expect((await request(app).post(`/api/notifications/${fatherN.body.data[0]._id}/read`).set(auth)).status).toBe(404);
  });

  it('registers FCM device tokens per session and drops them on logout', async () => {
    const s = await registerOwner(app);
    const res = await request(app).post('/api/devices').set(bearer(s.accessToken)).send({ token: 'f'.repeat(152), platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.data.pushEnabled).toBe(false); // no Firebase credentials in tests
    const { DeviceToken } = await import('../src/models/Notification');
    expect(await DeviceToken.countDocuments({ userId: s.userId })).toBe(1);
    await request(app).post('/api/auth/logout').set({ 'X-Client-Type': 'mobile' }).send({ refreshToken: s.refreshToken }).expect(200);
    expect(await DeviceToken.countDocuments({ userId: s.userId })).toBe(0);
  });
});

describe('My Day', () => {
  it("groups today's follow-ups, meetings, visits, overdue items and today's new records", async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    await createProperty(app, s);
    const auth = bearer(s.accessToken);
    await request(app).post('/api/followups').set(auth).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(1) });
    await request(app).post('/api/followups').set(auth).send({ clientId: c._id, type: 'MEETING', dueAt: inMinutes(2) });
    await request(app).post('/api/followups').set(auth).send({ clientId: c._id, type: 'PROPERTY_VISIT', dueAt: inMinutes(3) });
    await request(app).post('/api/followups').set(auth).send({ clientId: c._id, type: 'CALL', dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });

    const res = await request(app).get('/api/my-day').set(auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    // Items due in a few minutes are "today" unless that crosses midnight in Karachi.
    const sameDay = Date.now() + 3 * 60_000 < dayRange('Asia/Karachi').end.getTime() ? 1 : 0;
    expect([d.todaysFollowUps.length, d.todaysMeetings.length, d.propertyVisits.length]).toEqual([sameDay, sameDay, sameDay]);
    expect(d.overdueFollowUps).toHaveLength(1);
    expect(d.overdueFollowUps[0].status).toBe('OVERDUE');
    expect(d.newClients).toHaveLength(1);
    expect(d.newProperties).toHaveLength(1);
    expect(d.newMatches[0].matchScore).toBe(100);
    expect(d.timezone).toBe('Asia/Karachi');
  });
});
