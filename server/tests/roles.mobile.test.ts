import request from 'supertest';
import { ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();

/**
 * The phone shows a menu entry only when the signed-in user holds these permissions
 * (mobile/lib/features/more/*.dart and home_shell.dart). For every role template, every entry
 * the phone would show must be allowed by the API — a 403 here means a button that leads to an
 * error for that kind of user. Keep this table in step with the app's menus.
 */
const SCREENS: { name: string; show: string[]; calls: string[] }[] = [
  { name: 'Reports › Business overview', show: ['reports:read'], calls: ['/api/reports/business-summary'] },
  { name: 'Reports › Leads', show: ['reports:read', 'clients:read'], calls: ['/api/reports/leads'] },
  { name: 'Reports › Inventory', show: ['reports:read', 'properties:read'], calls: ['/api/reports/inventory'] },
  { name: 'Reports › Agent performance', show: ['reports:read'], calls: ['/api/reports/agent-performance'] },
  { name: 'Reports › Branches', show: ['reports:read'], calls: ['/api/reports/branches'] },
  { name: 'Reports › Team (sees every deal)', show: ['deals:read', 'deals:read_all'], calls: ['/api/dashboard/team'] },
  { name: 'Reports › Team (manages people)', show: ['deals:read', 'members:read'], calls: ['/api/dashboard/team'] },
  { name: 'Reports › Forecast', show: ['reports:read'], calls: ['/api/ai/forecast'] },
  { name: 'Reports › Campaign results', show: ['reports:read', 'marketing:manage'], calls: ['/api/reports/campaigns'] },
  { name: 'Reports › Income statement', show: ['reports:read', 'finance:read'], calls: ['/api/reports/income-statement', '/api/reports/cash-flow', '/api/reports/aging'] },
  { name: 'Reports › Agent statement (all agents)', show: ['reports:read', 'finance:read', 'deals:read', 'members:read'], calls: ['/api/members?limit=100', '/api/reports/agent-statement?userId=SELF'] },
  { name: 'Reports › Agent statement (own)', show: ['reports:read', 'finance:read', 'deals:read'], calls: ['/api/reports/agent-statement?userId=SELF'] },
  { name: 'Reports › Rent roll', show: ['rentals:read'], calls: ['/api/leases/rent-roll'] },
  { name: 'Marketing › Inquiries', show: ['clients:read'], calls: ['/api/inquiries?limit=50'] },
  { name: 'Marketing › Campaigns', show: ['clients:read'], calls: ['/api/campaigns?limit=50'] },
  { name: 'Marketing › Website / portals / WhatsApp', show: ['marketing:manage'], calls: ['/api/website', '/api/portal-settings', '/api/whatsapp'] },
  { name: 'Marketing › Who gets new leads', show: ['settings:manage', 'members:read'], calls: ['/api/settings', '/api/members?limit=100'] },
  { name: 'Verification queue', show: ['properties:read', 'verification:submit'], calls: ['/api/verifications?limit=50'] },
  { name: 'Verification queue (officer)', show: ['properties:read', 'verification:decide'], calls: ['/api/verifications?limit=50'] },
  { name: 'Bulk actions › clients', show: ['clients:read', 'clients:update'], calls: ['/api/clients?limit=100'] },
  { name: 'Bulk actions › properties', show: ['properties:read', 'properties:update'], calls: ['/api/properties?limit=100'] },
  { name: 'Rentals', show: ['rentals:read'], calls: ['/api/leases?status=ACTIVE&limit=100'] },
  { name: 'Installments', show: ['finance:read'], calls: ['/api/installments?status=ACTIVE&limit=100'] },
  { name: 'Listing tools', show: ['properties:read'], calls: ['/api/properties/PROPERTY/verification', '/api/ai/properties/PROPERTY/quality', '/api/properties/PROPERTY/qr'] },
  { name: 'Saved views', show: ['clients:read'], calls: ['/api/saved-views?page=clients'] },
  { name: 'Administration › Subscription', show: [], calls: ['/api/subscription'] },
  { name: 'Administration › Settings editors', show: ['settings:manage'], calls: ['/api/settings'] },
  { name: 'Administration › Business profile', show: ['business:manage'], calls: ['/api/business'] },
  { name: 'Administration › Member passwords', show: ['members:manage'], calls: ['/api/members?limit=100'] },
  { name: 'Assistant status', show: [], calls: ['/api/ai/status'] },
];

describe('every role can open what the phone shows it', () => {
  let owner: Session;
  let propertyId: string;
  beforeEach(async () => {
    owner = await registerOwner(app);
    await createClient(app, owner);
    propertyId = (await createProperty(app, owner))._id;
  });

  const roles = Object.entries(ROLE_PRESETS).filter(([k]) => k !== 'OWNER');
  it.each(roles)('%s template', async (_role, perms) => {
    const member = await addActiveMember(app, owner, { permissions: [...perms] });
    const has = new Set<string>(perms as readonly string[]);
    const problems: string[] = [];
    let shown = 0;
    for (const s of SCREENS) {
      if (!s.show.every((p) => has.has(p))) continue;
      shown += 1;
      for (const raw of s.calls) {
        const url = raw.replace('PROPERTY', propertyId).replace('SELF', member.userId);
        const r = await request(app).get(url).set(bearer(member.accessToken));
        if (r.status === 403 || r.status >= 500) problems.push(`${s.name}: GET ${raw} → ${r.status} ${r.body?.code ?? ''}`);
      }
    }
    expect(problems).toEqual([]);
    expect(shown).toBeGreaterThan(1); // every template sees at least the always-on screens
  });

  it('the owner can open every screen', async () => {
    const problems: string[] = [];
    for (const s of SCREENS) {
      for (const raw of s.calls) {
        const r = await request(app).get(raw.replace('PROPERTY', propertyId).replace('SELF', owner.userId)).set(bearer(owner.accessToken));
        if (r.status !== 200) problems.push(`${s.name}: GET ${raw} → ${r.status}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('notes on every kind of record', () => {
  it('can be read by anyone who may read that record, and by nobody else', async () => {
    const owner = await registerOwner(app);
    const client = await createClient(app, owner);
    const deal = (await request(app).post('/api/deals').set(bearer(owner.accessToken)).send({ clientId: client._id }).expect(201)).body.data;
    await request(app).post('/api/notes').set(bearer(owner.accessToken)).send({ entityType: 'deal', entityId: deal._id, content: 'Buyer wants possession in March' }).expect(201);

    const notes = (await request(app).get(`/api/notes?entityType=deal&entityId=${deal._id}&limit=100`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(notes).toHaveLength(1);

    const reader = await addActiveMember(app, owner, { permissions: ['deals:read', 'deals:read_all'] });
    await request(app).get(`/api/notes?entityType=deal&entityId=${deal._id}&limit=100`).set(bearer(reader.accessToken)).expect(200);
    const noDeals = await addActiveMember(app, owner, { permissions: ['clients:read'] });
    await request(app).get(`/api/notes?entityType=deal&entityId=${deal._id}&limit=100`).set(bearer(noDeals.accessToken)).expect(404);
    // The other record types that hold notes are mapped too.
    for (const [type, perm] of [['agreement', 'agreements:read'], ['transaction', 'finance:read'], ['lease', 'rentals:read']] as const) {
      const m = await addActiveMember(app, owner, { permissions: [perm] });
      const r = await request(app).get(`/api/notes?entityType=${type}&entityId=${deal._id}&limit=100`).set(bearer(m.accessToken));
      expect(r.status).not.toBe(403);
    }
  });
});
