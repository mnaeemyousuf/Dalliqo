import request from 'supertest';
import { createApp } from '../src/app';
import { DEMO, seed } from '../src/scripts/seed';
import { login } from './support/helpers';

const app = createApp();

describe('development seed', () => {
  it('creates a realistic demo business through the real services', async () => {
    const counts = await seed();
    expect(counts).toMatchObject({ users: 6, owners: 10, properties: 30, clients: 20, followUps: 20 });
    expect(counts.matches).toBeGreaterThanOrEqual(50);

    const father = await login(app, DEMO.ownerEmail, DEMO.password);
    const dash = await request(app).get('/api/dashboard').set({ Authorization: `Bearer ${father.accessToken}` });
    expect(dash.body.data.properties.total).toBe(30);
    expect(dash.body.data.properties.sold).toBe(1);
    expect(dash.body.data.properties.reserved).toBe(1);
    const clients = await request(app).get('/api/clients?limit=100').set({ Authorization: `Bearer ${father.accessToken}` });
    expect(clients.body.data.every((c: { mobileNumber: string }) => /^\+92\d{10}$/.test(c.mobileNumber))).toBe(true);

    const son = await login(app, DEMO.sonEmail, DEMO.password);
    expect(son.mustChangePassword).toBe(false);
    expect(son.businessId).toBe(father.businessId);

    await expect(seed()).rejects.toThrow('already exists');
    const again = await seed({ reset: true });
    expect(again.properties).toBe(30);
  }, 180_000);
});
