/**
 * Development seed: a demo father-and-son agency in Karachi with realistic data.
 *
 *   npm run seed            (refuses if the demo account already exists)
 *   npm run seed -- --reset (deletes the demo business and recreates it)
 *
 * Everything is created through the real services, so property IDs, matches,
 * activities and audit entries are produced exactly as in normal use.
 * Demo data lives only in its own business (marked "DEMO") and the script
 * refuses to run with NODE_ENV=production unless --force is given.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { Business } from '../models/Business';
import { BusinessMember } from '../models/BusinessMember';
import { User } from '../models/User';
import { resolvePermissions, ROLE_PRESETS, type PropertyType, type Role, type SizeUnit } from '@recrm/shared';
import { authService } from '../services/authService';
import { categoryService } from '../services/categoryService';
import { clientService } from '../services/clientService';
import { followUpService } from '../services/followUpService';
import { memberService } from '../services/memberService';
import { noteService } from '../services/noteService';
import { ownerService } from '../services/ownerService';
import { propertyService } from '../services/propertyService';
import { Match } from '../models/Match';
import { Property } from '../models/Property';
import { mediaService } from '../services/mediaService';
import { demoDocumentPdf, demoPropertyImage } from './demoImages';
import type { AuthContext } from '../types/context';
import { normalizePhone } from '../utils/phone';

/**
 * Demo sign-ins. The password is for local/demo environments only: set
 * DEMO_PASSWORD to choose your own before seeding a shared demo server.
 * `.test` addresses are reserved and can never receive real mail.
 */
export const DEMO = {
  ownerEmail: 'owner@demo.recrm.test',
  sonEmail: 'son@demo.recrm.test',
  managerEmail: 'manager@demo.recrm.test',
  agentEmail: 'agent@demo.recrm.test',
  accountantEmail: 'accounts@demo.recrm.test',
  viewerEmail: 'viewer@demo.recrm.test',
  password: process.env.DEMO_PASSWORD || 'Demo1234!',
  businessName: 'DEMO — Yousuf Estate & Builders',
};
const DEMO_EMAILS = [DEMO.ownerEmail, DEMO.sonEmail, DEMO.managerEmail, DEMO.agentEmail, DEMO.accountantEmail, DEMO.viewerEmail];

// Deterministic pseudo-random numbers so every seed run looks the same.
let state = 20261011;
const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

const LOCATIONS = [
  { area: 'Gulshan', society: 'Gulshan-e-Iqbal', blocks: ['13-D', '10-A', '2', '7'], lat: 24.9204, lng: 67.0932, pricePerSqYd: 120_000 },
  { area: 'Defence', society: 'DHA Karachi', blocks: ['Phase 6', 'Phase 8', 'Phase 5'], lat: 24.8008, lng: 67.0645, pricePerSqYd: 420_000 },
  { area: 'Clifton', society: 'Clifton', blocks: ['Block 5', 'Block 9', 'Block 2'], lat: 24.8138, lng: 67.0300, pricePerSqYd: 380_000 },
  { area: 'North Nazimabad', society: 'North Nazimabad', blocks: ['Block H', 'Block L', 'Block A'], lat: 24.9420, lng: 67.0390, pricePerSqYd: 140_000 },
  { area: 'PECHS', society: 'PECHS', blocks: ['Block 2', 'Block 6'], lat: 24.8697, lng: 67.0627, pricePerSqYd: 260_000 },
  { area: 'Super Highway', society: 'Bahria Town Karachi', blocks: ['Precinct 10', 'Precinct 27', 'Precinct 1'], lat: 25.0560, lng: 67.3100, pricePerSqYd: 75_000 },
] as const;

const FIRST = ['Muhammad', 'Ahmed', 'Ali', 'Usman', 'Bilal', 'Faisal', 'Hassan', 'Imran', 'Kamran', 'Saad', 'Ayesha', 'Fatima', 'Sana', 'Hina', 'Zainab', 'Rabia'];
const LAST = ['Khan', 'Siddiqui', 'Qureshi', 'Sheikh', 'Malik', 'Butt', 'Raza', 'Hussain', 'Memon', 'Abbasi', 'Baig', 'Ansari'];
// Stored in E.164 like everything entered through the API (the seed bypasses request validation).
const phone = () => normalizePhone(`03${pick(['00', '01', '21', '33', '45', '12'])}${String(between(1_000_000, 9_999_999))}`)!;
const person = () => `${pick(FIRST)} ${pick(LAST)}`;

interface Spec {
  type: PropertyType;
  sizes: [number, SizeUnit][];
  rent?: boolean;
}
const PROPERTY_SPECS: Spec[] = [
  { type: 'RESIDENTIAL_PLOT', sizes: [[120, 'SQ_YARD'], [240, 'SQ_YARD'], [400, 'SQ_YARD'], [500, 'SQ_YARD']] },
  { type: 'HOUSE', sizes: [[120, 'SQ_YARD'], [200, 'SQ_YARD'], [300, 'SQ_YARD'], [500, 'SQ_YARD']] },
  { type: 'FLAT', sizes: [[1100, 'SQ_FT'], [1450, 'SQ_FT'], [1800, 'SQ_FT']] },
  { type: 'APARTMENT', sizes: [[1600, 'SQ_FT'], [2200, 'SQ_FT']] },
  { type: 'PORTION', sizes: [[240, 'SQ_YARD'], [400, 'SQ_YARD']] },
  { type: 'SHOP', sizes: [[200, 'SQ_FT'], [400, 'SQ_FT']] },
  { type: 'OFFICE', sizes: [[800, 'SQ_FT'], [1500, 'SQ_FT']] },
  { type: 'FLAT', sizes: [[1100, 'SQ_FT'], [1400, 'SQ_FT']], rent: true },
  { type: 'PORTION', sizes: [[240, 'SQ_YARD']], rent: true },
];

const sqyd = (size: number, unit: SizeUnit) => (unit === 'SQ_YARD' ? size : size / 9);

async function contextFor(email: string): Promise<AuthContext> {
  const user = await User.findOne({ email }).lean();
  const member = await BusinessMember.findOne({ businessId: user!.defaultBusinessId, userId: user!._id }).lean();
  return {
    userId: user!._id.toString(),
    businessId: member!.businessId.toString(),
    memberId: member!._id.toString(),
    sessionId: 'seed',
    role: member!.role as Role,
    permissions: resolvePermissions(member!.role as Role, member!.permissions),
    mustChangePassword: false,
  };
}

async function removeDemo(): Promise<void> {
  const owner = await User.findOne({ email: DEMO.ownerEmail }).lean();
  if (!owner?.defaultBusinessId) return;
  const businessId = owner.defaultBusinessId;
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) await c.deleteMany({ businessId });
  await User.deleteMany({ email: { $in: DEMO_EMAILS } });
  await Business.deleteOne({ _id: businessId });
  await db.collection('counters').deleteMany({ _id: new RegExp(`^${businessId.toString()}:`) } as never);
}

export async function seed(opts: { reset?: boolean } = {}): Promise<Record<string, number>> {
  if (await User.exists({ email: DEMO.ownerEmail })) {
    if (!opts.reset) throw new Error('Demo data already exists. Run with --reset to recreate it.');
    await removeDemo();
  }
  const meta = { clientType: 'web' as const };
  await authService.register(
    { fullName: 'Muhammad Yousuf', email: DEMO.ownerEmail, password: DEMO.password, mobileNumber: '+923001234567', businessName: DEMO.businessName },
    meta,
  );
  const father = await contextFor(DEMO.ownerEmail);
  // One account per access level the manuals describe (all are MEMBERs with a permission template).
  const team = [
    { fullName: 'Ahmed Yousuf', email: DEMO.sonEmail, mobileNumber: '+923217654321', permissions: ROLE_PRESETS.MEMBER },
    { fullName: 'Sara Khan', email: DEMO.managerEmail, mobileNumber: '+923001234563', permissions: ROLE_PRESETS.MANAGER },
    { fullName: 'Bilal Ahmed', email: DEMO.agentEmail, mobileNumber: '+923331234560', permissions: ROLE_PRESETS.AGENT },
    { fullName: 'Nadia Shah', email: DEMO.accountantEmail, mobileNumber: '+923451234561', permissions: ROLE_PRESETS.ACCOUNTANT },
    { fullName: 'Junaid Iqbal', email: DEMO.viewerEmail, mobileNumber: '+923121234562', permissions: ROLE_PRESETS.VIEWER },
  ];
  for (const m of team) {
    await memberService.create(father, { fullName: m.fullName, email: m.email, mobileNumber: m.mobileNumber, temporaryPassword: DEMO.password, permissions: [...m.permissions] }, {});
  }
  await User.updateMany({ email: { $in: team.map((m) => m.email) } }, { $set: { mustChangePassword: false } });
  const son = await contextFor(DEMO.sonEmail);
  const agent = await contextFor(DEMO.agentEmail);
  const users = [father, son, agent];

  // Owners
  const owners = [];
  for (let i = 0; i < 10; i++) {
    const loc = pick(LOCATIONS);
    owners.push(await ownerService.create(pick(users), { fullName: person(), mobileNumber: phone(), address: `House ${between(1, 300)}, ${pick(loc.blocks)}, ${loc.society}, Karachi` }));
  }

  // Properties
  const properties = [];
  for (let i = 0; i < 30; i++) {
    const spec = PROPERTY_SPECS[i % PROPERTY_SPECS.length];
    const loc = spec.type === 'OFFICE' || spec.type === 'SHOP' ? pick([LOCATIONS[1], LOCATIONS[2], LOCATIONS[4]]) : pick(LOCATIONS);
    const [size, unit] = pick(spec.sizes);
    // Rough Karachi price-per-yard multipliers by type (built houses above land value; flats/portions below).
    const builtFactor = { RESIDENTIAL_PLOT: 1, HOUSE: 1.4, FLAT: 0.55, APARTMENT: 0.65, PORTION: 0.4, SHOP: 1.1, OFFICE: 0.8, COMMERCIAL: 1, OTHER: 1 }[spec.type];
    const sale = roundTo(sqyd(size, unit) * loc.pricePerSqYd * builtFactor * (0.9 + rand() * 0.25), 100_000);
    const asking = spec.rent ? roundTo(sale * 0.004, 5_000) : sale;
    const residential = ['HOUSE', 'FLAT', 'APARTMENT', 'PORTION'].includes(spec.type);
    properties.push(
      await propertyService.create(pick(users), {
        propertyType: spec.type,
        listingPurpose: spec.rent ? 'RENT' : 'SALE',
        area: loc.area,
        society: loc.society,
        block: pick(loc.blocks),
        plotNumber: String(between(1, 450)),
        city: 'Karachi',
        size,
        sizeUnit: unit,
        askingPrice: asking,
        minimumPrice: rand() < 0.6 ? roundTo(asking * 0.95, spec.rent ? 1_000 : 50_000) : undefined,
        negotiable: rand() < 0.7,
        ownerId: pick(owners)._id.toString(),
        latitude: +(loc.lat + (rand() - 0.5) * 0.02).toFixed(6),
        longitude: +(loc.lng + (rand() - 0.5) * 0.02).toFixed(6),
        bedrooms: residential ? between(2, 5) : undefined,
        bathrooms: residential ? between(2, 5) : undefined,
        description: `${spec.type === 'RESIDENTIAL_PLOT' ? 'West-open plot' : 'Well-maintained property'} in ${loc.society}, close to main road, schools and markets.`,
      }),
    );
  }

  // Clients, built around existing stock so the matching engine has real work to do.
  const categories = await categoryService.list(father);
  const catByKey = new Map(categories.map((c) => [c.key, c._id.toString()]));
  const typeCategory: Partial<Record<PropertyType, string>> = {
    RESIDENTIAL_PLOT: 'PLOT_BUYER', HOUSE: 'HOUSE_BUYER', FLAT: 'FLAT_BUYER', APARTMENT: 'FLAT_BUYER', PORTION: 'PORTION_BUYER',
    SHOP: 'COMMERCIAL_CLIENT', OFFICE: 'COMMERCIAL_CLIENT',
  };
  const clients = [];
  for (let i = 0; i < 20; i++) {
    const target = properties[(i * 7) % properties.length];
    const rental = target.listingPurpose === 'RENT';
    const near = rand() < 0.75; // most clients want something close to an existing listing
    const budgetMid = target.askingPrice * (near ? 1 + (rand() - 0.3) * 0.2 : 0.5 + rand());
    const step = rental ? 5_000 : 100_000;
    clients.push(
      await clientService.create(pick(users), {
        fullName: person(),
        mobileNumber: phone(),
        email: rand() < 0.4 ? `client${i + 1}@example.com` : undefined,
        categoryId: catByKey.get(rental ? 'RENTAL_CLIENT' : i % 9 === 0 ? 'INVESTOR' : typeCategory[target.propertyType] ?? 'PLOT_BUYER') ?? undefined,
        priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'] as const),
        source: pick(['WALK_IN', 'PHONE', 'REFERRAL', 'WHATSAPP', 'WHATSAPP', 'PORTAL', 'SOCIAL_MEDIA'] as const),
        assignedTo: pick(users).userId,
        requirements: [
          {
            isPrimary: true,
            purpose: rental ? 'RENTAL' : 'PURCHASE',
            propertyTypes: [target.propertyType],
            societies: near ? [target.society!] : [pick(LOCATIONS).society],
            minSize: Math.round(target.size * 0.8),
            maxSize: Math.round(target.size * 1.2),
            sizeUnit: target.sizeUnit,
            minBudget: roundTo(budgetMid * 0.8, step),
            maxBudget: roundTo(budgetMid * 1.1, step),
          },
        ],
      }),
    );
  }

  // Follow-ups across yesterday, today and the coming week.
  const types = ['CALL', 'MEETING', 'WHATSAPP', 'PROPERTY_VISIT', 'GENERAL', 'CALL'] as const;
  for (let i = 0; i < 20; i++) {
    const client = clients[i % clients.length];
    const dayOffset = between(-2, 6);
    const due = new Date();
    due.setDate(due.getDate() + dayOffset);
    due.setHours(between(10, 19), pick([0, 15, 30, 45]), 0, 0);
    const f = await followUpService.create(pick(users), {
      clientId: client._id.toString(),
      propertyId: rand() < 0.6 ? pick(properties)._id.toString() : undefined,
      type: pick(types),
      dueAt: due,
      priority: pick(['LOW', 'MEDIUM', 'HIGH'] as const),
      notes: pick(['Discuss final price', 'Share location and photos', 'Arrange site visit with owner', 'Confirm token amount', 'Send documents list']),
      assignedTo: pick(users).userId,
      reminderAt: dayOffset < 0 ? null : undefined,
    });
    if (dayOffset < -1 && rand() < 0.5) await followUpService.complete(father, f._id.toString(), 'Client interested, visit planned');
  }
  // A few follow-ups already done today, so team performance has something to show.
  for (const [i, who] of [son, agent, agent].entries()) {
    const due = new Date(Date.now() - (i + 1) * 3_600_000);
    const f = await followUpService.create(who, { clientId: clients[10 + i]._id.toString(), type: pick(types), dueAt: due, priority: 'MEDIUM', assignedTo: who.userId, reminderAt: null });
    await followUpService.complete(who, f._id.toString(), pick(['Shared location, visit on Saturday', 'Client wants a lower price', 'Owner agreed to meet']));
  }

  // Lead outcomes for the conversion report: some won, some lost, one on hold.
  for (const [i, status] of (['CLOSED_WON', 'CLOSED_WON', 'CLOSED_WON', 'CLOSED_LOST', 'CLOSED_LOST', 'ON_HOLD'] as const).entries()) {
    await clientService.update(father, clients[14 + i]._id.toString(), { status });
  }

  // Listings nobody has re-confirmed with the owner for a while ("needs verification").
  for (const [i, p] of properties.filter((x) => x.status === 'AVAILABLE').slice(20, 27).entries()) {
    await Property.updateOne({ businessId: father.businessId, _id: p._id }, { $set: { lastVerifiedAt: new Date(Date.now() - (35 + i * 9) * 86_400_000) } });
  }

  // Labelled demo illustrations through the real upload pipeline (compression, thumbnails, cover).
  for (const [i, p] of properties.entries()) {
    const buffer = await demoPropertyImage(p.propertyType, p.propertyId, i);
    await mediaService.uploadPropertyMedia(pick(users), p._id.toString(), [{ originalname: `${p.propertyId}-demo.jpg`, buffer, size: buffer.length }]);
  }

  // A few clearly labelled sample documents so the document screens aren't empty in a demo.
  const docs: [string, string, 'property' | 'client' | 'owner', string, 'REGISTRATION' | 'OWNERSHIP' | 'AGREEMENT' | 'PROPERTY_DOCUMENT'][] = [
    ['Sale deed (copy)', 'Registration', 'property', properties[0]._id.toString(), 'REGISTRATION'],
    ['Site plan', 'Property document', 'property', properties[0]._id.toString(), 'PROPERTY_DOCUMENT'],
    ['Allotment letter', 'Ownership', 'property', properties[5]._id.toString(), 'OWNERSHIP'],
    ['Token receipt', 'Agreement', 'client', clients[0]._id.toString(), 'AGREEMENT'],
    ['Transfer documents checklist', 'Ownership', 'owner', owners[0]._id.toString(), 'OWNERSHIP'],
  ];
  for (const [title, subject, entityType, entityId, category] of docs) {
    const buffer = await demoDocumentPdf(title, subject);
    await mediaService.uploadDocument(father, { entityType, entityId, category, fileName: `${title}.pdf` }, { originalname: `${title}.pdf`, buffer, size: buffer.length });
  }

  for (const c of clients.slice(0, 6)) {
    await noteService.create(pick(users), { entityType: 'client', entityId: c._id.toString(), content: pick(['Prefers corner / west-open.', 'Needs bank financing.', 'Overseas, decision through brother.', 'Ready buyer, cash payment.']) });
  }
  // A couple of realistic status changes.
  await propertyService.changeStatus(father, properties[3]._id.toString(), 'RESERVED', 'Token received');
  await propertyService.changeStatus(son, properties[11]._id.toString(), 'SOLD');

  return {
    users: 1 + team.length,
    owners: owners.length,
    properties: properties.length,
    clients: clients.length,
    followUps: 20,
    matches: await Match.countDocuments({ businessId: father.businessId }),
  };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (env.NODE_ENV === 'production' && !args.includes('--force')) {
      throw new Error('Refusing to seed demo data with NODE_ENV=production (use --force if you really mean it).');
    }
    await connectDatabase();
    const counts = await seed({ reset: args.includes('--reset') });
    console.log('Demo data created:', counts);
    console.log(`Sign in as ${DEMO.ownerEmail} (owner), ${DEMO.sonEmail} (member), ${DEMO.managerEmail} (manager), ${DEMO.agentEmail} (agent), ${DEMO.accountantEmail} (accountant) or ${DEMO.viewerEmail} (read-only)`);
    console.log(process.env.DEMO_PASSWORD ? 'Password: the DEMO_PASSWORD you set.' : `Password: ${DEMO.password} (demo only — set DEMO_PASSWORD for shared demo servers)`);
    await disconnectDatabase();
  })().catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  });
}
