import { Types } from 'mongoose';
import { ERROR_CODES, PERMISSIONS, estimatePrice, forecastCommission, type Comparable, type DealStage } from '@recrm/shared';
import { formatPkr as formatPkrShort } from '../../utils/text';
import { env } from '../../config/env';
import { Activity } from '../../models/Activity';
import { Client, type ClientDoc } from '../../models/Client';
import { Deal } from '../../models/Deal';
import { FollowUp } from '../../models/FollowUp';
import { InstallmentPlan } from '../../models/InstallmentPlan';
import { Lease } from '../../models/Lease';
import { Match } from '../../models/Match';
import { Property, type PropertyDoc } from '../../models/Property';
import { clientRepository, propertyRepository } from '../../repositories/entityRepositories';
import type { AuthContext } from '../../types/context';
import { forbidden } from '../../utils/AppError';
import { branchFilter } from '../branchScope';
import { ownDealsFilter } from '../dealService';
import { aiClient, jsonOf } from './aiClient';

export type AiLanguage = 'en' | 'ur';
const LANG = { en: 'English', ur: 'Urdu (in Urdu script, natural Pakistani real-estate wording; keep numbers, PKR amounts and society names in their usual form)' };
const DAY = 86_400_000;
const can = (auth: AuthContext, p: string) => auth.permissions.includes(p as never);
const need = (auth: AuthContext, ...p: string[]) => {
  if (!p.some((x) => can(auth, x))) throw forbidden();
};

// ───────────────────────── Property description ─────────────────────────

const UNIT: Record<string, { en: string; ur: string }> = { SQ_FT: { en: 'sq. ft', ur: 'مربع فٹ' }, SQ_YARD: { en: 'sq. yard', ur: 'مربع گز' }, MARLA: { en: 'marla', ur: 'مرلہ' }, KANAL: { en: 'kanal', ur: 'کنال' }, ACRE: { en: 'acre', ur: 'ایکڑ' }, SQ_METER: { en: 'sq. m', ur: 'مربع میٹر' } };
const TYPE_UR: Record<string, string> = { RESIDENTIAL_PLOT: 'رہائشی پلاٹ', HOUSE: 'مکان', FLAT: 'فلیٹ', APARTMENT: 'اپارٹمنٹ', PORTION: 'پورشن', SHOP: 'دکان', OFFICE: 'دفتر', COMMERCIAL: 'کمرشل پراپرٹی', OTHER: 'پراپرٹی', FARMHOUSE: 'فارم ہاؤس', FILE: 'پلاٹ فائل', COMMERCIAL_PLOT: 'کمرشل پلاٹ', BUILDING: 'عمارت', WAREHOUSE: 'گودام', FACTORY: 'فیکٹری', INDUSTRIAL_PLOT: 'صنعتی پلاٹ', AGRICULTURAL_LAND: 'زرعی زمین' };
const sizeText =(p: Pick<PropertyDoc, 'size' | 'sizeUnit'>, lang: AiLanguage = 'en') => `${p.size} ${UNIT[p.sizeUnit]?.[lang] ?? human(p.sizeUnit)}`;
/** Location parts without repeats (society and area are often the same name). */
const placeText = (p: PropertyDoc) => {
  const seen = new Set<string>();
  return [p.block && /^\d/.test(p.block) ? `Block ${p.block}` : p.block, p.phase, p.sector, p.society, p.area, p.city]
    .filter((x): x is string => !!x && !!String(x).trim())
    .map((x) => x.trim())
    .filter((x) => (seen.has(x.toLowerCase()) ? false : (seen.add(x.toLowerCase()), true)))
    .join(', ');
};

/** Listing facts the AI may use — never owner details, plot / unit numbers or the floor price. */
function listingFacts(p: PropertyDoc) {
  return {
    type: p.propertyType,
    purpose: p.listingPurpose,
    location: placeText(p),
    size: sizeText(p),
    price: p.askingPrice,
    priceText: formatPkrShort(p.askingPrice),
    negotiable: p.negotiable,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    floors: p.floors,
    furnishing: p.furnishing,
    facing: p.facing,
    corner: p.corner,
    parkFacing: p.parkFacing,
    mainRoad: p.mainRoad,
    possession: p.possessionStatus,
    development: p.developmentStatus,
    construction: p.constructionStatus,
    amenities: p.amenities,
    agentNotes: p.description?.slice(0, 1500),
  };
}

const human = (v?: string) => (v ? v.toLowerCase().replace(/_/g, ' ') : '');

/** Built-in description used when no AI key is configured (or on request). */
export function templateDescription(p: PropertyDoc, language: AiLanguage): { headline: string; description: string } {
  const f = { ...listingFacts(p), size: sizeText(p, language) };
  const type = language === 'ur' ? (TYPE_UR[p.propertyType] ?? human(p.propertyType)) : human(p.propertyType);
  const features = [f.corner && (language === 'ur' ? 'کارنر' : 'corner'), f.parkFacing && (language === 'ur' ? 'پارک فیسنگ' : 'park facing'), f.mainRoad && (language === 'ur' ? 'مین روڈ' : 'on the main road')].filter(Boolean) as string[];
  if (language === 'ur') {
    const purpose = p.listingPurpose === 'RENT' ? 'کرائے کے لیے' : 'برائے فروخت';
    const rooms = f.bedrooms ? `، ${f.bedrooms} بیڈروم` : '';
    return {
      headline: `${f.size} ${type} ${purpose} — ${p.society ?? p.area ?? ''}`.trim(),
      description: [
        `${f.location} میں ${f.size} کا ${type}${rooms} ${purpose} دستیاب ہے۔`,
        features.length ? `خصوصیات: ${features.join('، ')}۔` : '',
        `قیمت ${f.priceText}${f.negotiable ? ' (قابلِ گفت و شنید)' : ''}۔`,
        'مزید تفصیل اور وزٹ کے لیے ہم سے رابطہ کریں۔',
      ].filter(Boolean).join(' '),
    };
  }
  const purpose = p.listingPurpose === 'RENT' ? 'for rent' : 'for sale';
  const rooms = f.bedrooms ? ` with ${f.bedrooms} bedroom${f.bedrooms > 1 ? 's' : ''}${f.bathrooms ? ` and ${f.bathrooms} bathroom${f.bathrooms > 1 ? 's' : ''}` : ''}` : '';
  return {
    headline: `${f.size} ${type} ${purpose} in ${p.society ?? p.area ?? p.city ?? ''}`.trim(),
    description: [
      `A ${f.size} ${type}${rooms} ${purpose} in ${f.location}.`,
      features.length ? `It is ${features.join(', ')}.` : '',
      f.amenities?.length ? `Nearby / included: ${f.amenities.join(', ')}.` : '',
      `Asking ${f.priceText}${f.negotiable ? ', negotiable' : ''}.`,
      'Contact us for details or to arrange a visit.',
    ].filter(Boolean).join(' '),
  };
}

// ───────────────────────── Client brief ─────────────────────────

export async function clientContext(auth: AuthContext, c: ClientDoc) {
  const bid = new Types.ObjectId(auth.businessId);
  const [activities, followUps, matches, deals] = await Promise.all([
    Activity.find({ businessId: bid, 'refs.entityId': c._id }).sort({ createdAt: -1 }).limit(15).select('type summary createdAt').lean(),
    FollowUp.find({ businessId: bid, clientId: c._id, deletedAt: null, status: { $in: ['PENDING', 'OVERDUE'] } }).sort({ dueAt: 1 }).limit(5).select('type dueAt notes status').lean(),
    can(auth, PERMISSIONS.MATCHES_READ)
      ? Match.find({ businessId: bid, clientId: c._id, status: { $ne: 'REJECTED' } }).sort({ matchScore: -1 }).limit(3).populate({ path: 'propertyId', select: 'propertyId propertyType society block size sizeUnit askingPrice status', options: { skipTenantGuard: true } }).lean()
      : Promise.resolve([]),
    can(auth, PERMISSIONS.DEALS_READ) ? Deal.find({ businessId: bid, clientId: c._id, deletedAt: null, ...ownDealsFilter(auth) }).select('dealNo stage agreedPrice updatedAt').limit(5).lean() : Promise.resolve([]),
  ]);
  const req = c.requirements.find((r) => r.active && r.isPrimary) ?? c.requirements.find((r) => r.active);
  return {
    name: c.fullName.split(' ')[0],
    status: c.status,
    source: c.source,
    temperature: c.temperature,
    leadScore: c.leadScore,
    scoreReasons: (c.leadScoreReasons ?? []).map((r) => `${r.code} (${r.points})`),
    buyingTimeline: c.buyingTimeline,
    lastContacted: c.lastContactedAt ?? null,
    daysSinceContact: c.lastContactedAt ? Math.floor((Date.now() - +new Date(c.lastContactedAt)) / DAY) : null,
    requirement: req
      ? { purpose: req.purpose, types: req.propertyTypes, areas: [...req.societies, ...req.areas, ...req.blocks], size: [req.minSize, req.maxSize, req.sizeUnit], budget: [req.minBudget, req.maxBudget] }
      : null,
    notes: c.notes?.slice(0, 1000),
    recentActivity: activities.map((a) => `${new Date(a.createdAt).toISOString().slice(0, 10)} ${a.type}: ${a.summary}`),
    pendingFollowUps: followUps.map((f) => `${f.status} ${f.type} due ${new Date(f.dueAt).toISOString().slice(0, 10)}${f.notes ? ` — ${f.notes.slice(0, 120)}` : ''}`),
    topMatches: matches.map((m) => {
      const p = m.propertyId as unknown as Partial<PropertyDoc> | null;
      return p ? `${p.propertyId}: ${p.size} ${p.sizeUnit} ${human(p.propertyType)} in ${[p.block, p.society].filter(Boolean).join(', ')} at ${formatPkrShort(p.askingPrice ?? 0)} (score ${m.matchScore}, ${p.status})` : '';
    }).filter(Boolean),
    deals: deals.map((d) => `${d.dealNo} ${d.stage}${d.agreedPrice ? ` at ${formatPkrShort(d.agreedPrice)}` : ''}`),
  };
}

export interface ClientBrief {
  summary: string;
  nextAction: string;
  message: string;
  risks: string[];
}

function ruleBrief(ctx: Awaited<ReturnType<typeof clientContext>>, language: AiLanguage): ClientBrief {
  const ur = language === 'ur';
  const stale = ctx.daysSinceContact === null || ctx.daysSinceContact > 7;
  const overdue = ctx.pendingFollowUps.some((f) => f.startsWith('OVERDUE'));
  const risks = [
    stale && (ur ? 'ایک ہفتے سے زیادہ رابطہ نہیں ہوا' : ctx.daysSinceContact === null ? 'Never contacted' : `No contact for ${ctx.daysSinceContact} days`),
    overdue && (ur ? 'فالو اپ تاخیر کا شکار ہے' : 'A follow-up is overdue'),
    !ctx.requirement && (ur ? 'ضرورت درج نہیں' : 'No requirement recorded'),
  ].filter(Boolean) as string[];
  const nextAction = ctx.topMatches.length
    ? ur ? `${ctx.name} کو بہترین میچ ${ctx.topMatches[0].split(':')[0]} بھیجیں اور وزٹ طے کریں۔` : `Send ${ctx.name} the top match ${ctx.topMatches[0].split(':')[0]} and offer a visit.`
    : ur ? `${ctx.name} سے ضرورت کی تصدیق کے لیے کال کریں۔` : `Call ${ctx.name} to confirm what they are looking for.`;
  return {
    summary: ur
      ? `${ctx.temperature} لیڈ (اسکور ${ctx.leadScore})۔ ${ctx.deals.length ? `سودے: ${ctx.deals.join('، ')}۔ ` : ''}${ctx.topMatches.length} میچ دستیاب۔`
      : `${ctx.temperature} lead (score ${ctx.leadScore}).${ctx.requirement ? ` Wants ${ctx.requirement.purpose.toLowerCase()} of ${ctx.requirement.types.map(human).join('/') || 'property'}${ctx.requirement.areas.length ? ` in ${ctx.requirement.areas.join(', ')}` : ''}.` : ''} ${ctx.deals.length ? `Deals: ${ctx.deals.join(', ')}. ` : ''}${ctx.topMatches.length} matching listings.`,
    nextAction,
    message: ur ? `السلام علیکم ${ctx.name}، آپ کی ضرورت کے مطابق کچھ نئی پراپرٹیز آئی ہیں۔ کیا آپ اس ہفتے وزٹ کرنا چاہیں گے؟` : `Assalam-o-Alaikum ${ctx.name}, we have new properties matching what you are looking for. Would you like to visit this week?`,
    risks,
  };
}

// ───────────────────────── Service ─────────────────────────

export const aiService = {
  async status(auth: AuthContext) {
    return { configured: aiClient.configured(), model: aiClient.configured() ? aiClient.model() : null, usedThisMonth: await aiClient.usedThisMonth(auth.businessId), monthlyLimit: env.AI_MONTHLY_LIMIT };
  },

  async describeProperty(auth: AuthContext, id: string, opts: { language: AiLanguage; useAi?: boolean }) {
    const p = await propertyRepository.getById(auth, id, 'Property not found');
    if (!aiClient.configured() || opts.useAi === false) return { ...templateDescription(p, opts.language), source: 'template' as const };
    const m = await aiClient.create(auth, 'description', {
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: { type: 'object', properties: { headline: { type: 'string' }, description: { type: 'string' } }, required: ['headline', 'description'], additionalProperties: false },
        },
      },
      system:
        'You write property listings for a Pakistani real-estate agency. Use only the facts given — never invent features, distances, legal status or prices. ' +
        'Write a headline (max 70 characters) and a description of 80–140 words: clear, warm and specific, no exaggeration, no emojis, no ALL CAPS. ' +
        'Never mention owners, plot or house numbers, or a minimum price. End with an invitation to call or visit.',
      messages: [{ role: 'user', content: `Language: ${LANG[opts.language]}\nListing facts (JSON):\n${JSON.stringify(listingFacts(p))}` }],
    });
    const out = jsonOf<{ headline: string; description: string }>(m);
    return { headline: out.headline.slice(0, 120), description: out.description.slice(0, 4000), source: 'ai' as const };
  },

  async clientBrief(auth: AuthContext, id: string, language: AiLanguage = 'en') {
    const c = await clientRepository.getById(auth, id, 'Client not found');
    const ctx = await clientContext(auth, c);
    if (!aiClient.configured()) return { ...ruleBrief(ctx, language), source: 'rules' as const };
    const m = await aiClient.create(auth, 'client_brief', {
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, nextAction: { type: 'string' }, message: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } } },
            required: ['summary', 'nextAction', 'message', 'risks'],
            additionalProperties: false,
          },
        },
      },
      system:
        'You help a Pakistani real-estate agent decide what to do next with a lead. From the record given, write: ' +
        '"summary" (2–3 sentences: who they are, what they want, where things stand), "nextAction" (one concrete step for today), ' +
        '"message" (a short, polite WhatsApp message the agent could send, starting with Assalam-o-Alaikum, no emojis, no promises about price or availability that the record does not support), ' +
        'and "risks" (0–3 short warnings, e.g. going cold, budget mismatch). Base everything strictly on the record.',
      messages: [{ role: 'user', content: `Language: ${LANG[language]}\nToday: ${new Date().toISOString().slice(0, 10)}\nLead record (JSON):\n${JSON.stringify(ctx)}` }],
    });
    const out = jsonOf<ClientBrief>(m);
    return { summary: out.summary, nextAction: out.nextAction, message: out.message, risks: (out.risks ?? []).slice(0, 5), source: 'ai' as const };
  },

  /** Weighted commission pipeline, scheduled installment / rent inflows and lead flow (no AI needed). */
  async forecast(auth: AuthContext) {
    need(auth, PERMISSIONS.DEALS_READ, PERMISSIONS.REPORTS_READ);
    const bid = new Types.ObjectId(auth.businessId);
    const base = { businessId: bid, deletedAt: null, ...branchFilter(auth) };
    const now = new Date();
    const horizon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 1));
    const deals = can(auth, PERMISSIONS.DEALS_READ)
      ? await Deal.find({ ...base, ...ownDealsFilter(auth), stage: { $ne: 'CLOSED_LOST' }, outstanding: { $gt: 0 } }).select('stage outstanding expectedCloseDate updatedAt').lean()
      : [];
    const commission = forecastCommission(deals.map((d) => ({ stage: d.stage as DealStage, outstanding: d.outstanding ?? 0, expectedCloseDate: d.expectedCloseDate, updatedAt: d.updatedAt })), now);
    const months = commission.months.map((m) => ({ ...m, installments: 0, rent: 0 }));
    const idx = (d: Date) => months.findIndex((m) => m.month === `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    if (can(auth, PERMISSIONS.FINANCE_READ)) {
      const plans = await InstallmentPlan.find({ ...base, status: 'ACTIVE' }).select('items').lean();
      for (const p of plans) for (const it of p.items) {
        const bal = it.amount - (it.paid ?? 0);
        if (bal <= 0 || it.status === 'WAIVED' || new Date(it.dueDate) >= horizon) continue;
        const i = Math.max(0, idx(new Date(it.dueDate) < now ? now : new Date(it.dueDate)));
        months[i].installments += bal;
      }
    }
    if (can(auth, PERMISSIONS.RENTALS_READ)) {
      const leases = await Lease.find({ ...base, status: 'ACTIVE' }).select('schedule managementFeePct').lean();
      for (const l of leases) for (const it of l.schedule) {
        const bal = it.amount + (it.lateFee ?? 0) - (it.paid ?? 0);
        if (bal <= 0 || it.status === 'WAIVED' || new Date(it.dueDate) >= horizon) continue;
        const i = Math.max(0, idx(new Date(it.dueDate) < now ? now : new Date(it.dueDate)));
        months[i].rent += bal;
      }
    }
    let leads: { month: string; created: number; won: number }[] = [];
    if (can(auth, PERMISSIONS.CLIENTS_READ)) {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
      const rows = await Client.aggregate<{ _id: string; created: number; won: number }>([
        { $match: { ...base, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, created: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED_WON'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]);
      leads = rows.map((r) => ({ month: r._id, created: r.created, won: r.won }));
    }
    const recent = leads.slice(-3);
    const avgLeads = recent.length ? Math.round(recent.reduce((s, r) => s + r.created, 0) / recent.length) : 0;
    return {
      months,
      totals: { weightedCommission: commission.weightedTotal, bestCaseCommission: commission.bestCaseTotal, installments: months.reduce((s, m) => s + m.installments, 0), rent: months.reduce((s, m) => s + m.rent, 0) },
      leads,
      expectedLeadsNextMonth: avgLeads,
      method: 'Open deals weighted by stage probability; scheduled installments and rent not yet paid; lead trend is the 3-month average.',
    };
  },

  /** Indicative price from comparable listings and recorded sales — an estimate, not a valuation. */
  async priceEstimate(auth: AuthContext, id: string) {
    const p = await propertyRepository.getById(auth, id, 'Property not found');
    const bid = new Types.ObjectId(auth.businessId);
    const base = { businessId: bid, deletedAt: null, _id: { $ne: p._id }, propertyType: p.propertyType, listingPurpose: p.listingPurpose, sizeSqft: { $gt: 0 }, askingPrice: { $gt: 0 } };
    const scopes: { label: string; filter: Record<string, unknown> }[] = [
      ...(p.society ? [{ label: p.block ? `${p.block}, ${p.society}` : p.society, filter: { society: p.society, ...(p.block ? { block: p.block } : {}) } }] : []),
      ...(p.society ? [{ label: p.society, filter: { society: p.society } }] : []),
      ...(p.area ? [{ label: p.area, filter: { area: p.area } }] : []),
      ...(p.city ? [{ label: p.city, filter: { city: p.city } }] : []),
    ];
    for (const s of scopes) {
      const listings = await Property.find({ ...base, ...s.filter }).select('_id askingPrice sizeSqft status').limit(300).lean();
      const soldIds = listings.filter((l) => ['SOLD', 'RENTED'].includes(l.status)).map((l) => l._id);
      const closed = soldIds.length ? await Deal.find({ businessId: bid, deletedAt: null, stage: 'CLOSED_WON', propertyId: { $in: soldIds } }).select('propertyId finalPrice agreedPrice').lean() : [];
      const closedPrice = new Map(closed.map((d) => [String(d.propertyId), d.finalPrice ?? d.agreedPrice ?? 0]));
      const comps: Comparable[] = listings.map((l) => (closedPrice.get(String(l._id)) ? { price: closedPrice.get(String(l._id))!, sizeSqft: l.sizeSqft, kind: 'SOLD' as const } : { price: l.askingPrice, sizeSqft: l.sizeSqft, kind: 'ASKING' as const }));
      const est = estimatePrice(p.sizeSqft, comps);
      if (est) {
        const position = p.askingPrice > est.high ? 'ABOVE' : p.askingPrice < est.low ? 'BELOW' : 'WITHIN';
        return { ...est, scope: s.label, askingPrice: p.askingPrice, position, disclaimer: 'Indicative estimate from your own listings and recorded sales — not a valuation.' };
      }
    }
    return { mid: null, comparables: 0, disclaimer: 'Not enough comparable listings yet (at least 3 of the same type and purpose nearby are needed).' };
  },
};

export { ERROR_CODES };
