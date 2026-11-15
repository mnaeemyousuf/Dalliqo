import { Types } from 'mongoose';
import { OPEN_DEAL_STAGES, PERMISSIONS } from '@recrm/shared';
import { Business } from '../../models/Business';
import { Deal } from '../../models/Deal';
import { User } from '../../models/User';
import { clientRepository } from '../../repositories/entityRepositories';
import type { AuthContext } from '../../types/context';
import { formatPkr } from '../../utils/text';
import { branchFilter } from '../branchScope';
import { clientService } from '../clientService';
import { dashboardService } from '../dashboardService';
import { ownDealsFilter } from '../dealService';
import { financeReportService } from '../financeReportService';
import { propertyService } from '../propertyService';
import { aiClient } from './aiClient';
import type { AiToolSpec } from './providers/types';
import { aiService, clientContext } from './aiService';

type Tool = AiToolSpec;

const MAX_STEPS = 6;
const MAX_RESULT_CHARS = 12_000;
const nullable = (t: string, extra: Record<string, unknown> = {}) => ({ type: [t, 'null'], ...extra });
const obj = (properties: Record<string, unknown>): Tool['inputSchema'] => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

/** An action the assistant suggests; nothing is saved until the user confirms it in the app. */
export type Proposal =
  | { kind: 'FOLLOW_UP'; clientId: string; clientName: string; type: string; dueAt: string; notes: string }
  | { kind: 'NOTE'; clientId: string; clientName: string; content: string };

interface ToolDef {
  tool: Tool;
  /** Any one of these permissions lets the user (and so the assistant) use the tool. */
  perms: string[];
  run(auth: AuthContext, input: Record<string, unknown>, proposals: Proposal[]): Promise<unknown>;
}

async function proposalClient(auth: AuthContext, id: unknown) {
  const cid = String(id);
  if (!Types.ObjectId.isValid(cid)) return null;
  return clientRepository.findById(auth, cid);
}

const TOOLS: ToolDef[] = [
  {
    perms: [PERMISSIONS.CLIENTS_READ],
    tool: {
      name: 'search_clients',
      description: 'Find clients / leads by name, phone, area or society. Returns up to 10 with status, temperature, lead score, requirement and last contact.',
      inputSchema: obj({ query: nullable('string', { description: 'Search text; null lists the most recently updated.' }), temperature: nullable('string', { enum: ['HOT', 'WARM', 'COLD', null] }) }),
    },
    async run(auth, i) {
      const r = await clientService.list(auth, { q: (i.query as string) || undefined, temperature: (i.temperature as never) ?? undefined, page: 1, limit: 10 });
      return { total: r.total, clients: r.items.map((c) => ({ id: String(c._id), name: c.fullName, phone: c.mobileNumber, status: c.status, temperature: c.temperature, score: c.leadScore, lastContacted: c.lastContactedAt ?? null, budget: [c.requirements?.[0]?.minBudget, c.requirements?.[0]?.maxBudget], wants: c.requirements?.[0] ? [...(c.requirements[0].propertyTypes ?? []), ...(c.requirements[0].societies ?? [])].join(', ') : null })) };
    },
  },
  {
    perms: [PERMISSIONS.CLIENTS_READ],
    tool: {
      name: 'get_client',
      description: 'Full picture of one client: requirement, recent activity, pending follow-ups, best matching listings, deals. Use an id from search_clients.',
      inputSchema: obj({ client_id: { type: 'string' } }),
    },
    async run(auth, i) {
      const id = String(i.client_id);
      if (!Types.ObjectId.isValid(id)) return { error: 'Unknown client id' };
      const c = await clientRepository.getById(auth, id, 'Client not found');
      return { id, fullName: c.fullName, phone: c.mobileNumber, ...(await clientContext(auth, c)) };
    },
  },
  {
    perms: [PERMISSIONS.PROPERTIES_READ],
    tool: {
      name: 'search_properties',
      description: 'Find listings by society, area, block or reference, optionally by purpose and maximum price. Returns up to 10 available listings.',
      inputSchema: obj({
        query: nullable('string'),
        purpose: nullable('string', { enum: ['SALE', 'RENT', null] }),
        max_price: nullable('integer', { description: 'PKR' }),
      }),
    },
    async run(auth, i) {
      const r = await propertyService.list(auth, { q: (i.query as string) || undefined, listingPurpose: (i.purpose as never) ?? undefined, maxPrice: (i.max_price as number) ?? undefined, status: 'AVAILABLE', page: 1, limit: 10 } as never);
      return { total: r.total, properties: r.items.map((p) => ({ id: String(p._id), ref: p.propertyId, type: p.propertyType, purpose: p.listingPurpose, location: [p.block, p.society, p.area].filter(Boolean).join(', '), size: `${p.size} ${p.sizeUnit}`, price: formatPkr(p.askingPrice), bedrooms: p.bedrooms ?? null, status: p.status })) };
    },
  },
  {
    perms: [PERMISSIONS.PROPERTIES_READ],
    tool: {
      name: 'price_estimate',
      description: 'Indicative price range for a listing from comparable listings and recorded sales. Always present the result as an estimate, not a valuation.',
      inputSchema: obj({ property_id: { type: 'string' } }),
    },
    async run(auth, i) {
      const id = String(i.property_id);
      if (!Types.ObjectId.isValid(id)) return { error: 'Unknown property id' };
      return aiService.priceEstimate(auth, id);
    },
  },
  {
    perms: [PERMISSIONS.FOLLOWUPS_READ],
    tool: {
      name: 'my_day',
      description: "The signed-in user's agenda for today: follow-ups due and overdue, and other items needing attention.",
      inputSchema: obj({}),
    },
    async run(auth) {
      return dashboardService.myDay(auth, 'mine');
    },
  },
  {
    perms: [PERMISSIONS.DEALS_READ],
    tool: {
      name: 'deal_pipeline',
      description: 'Open deals the user can see: count by stage, commission still outstanding, and the largest open deals.',
      inputSchema: obj({}),
    },
    async run(auth) {
      const deals = await Deal.find({ businessId: auth.businessId, deletedAt: null, ...branchFilter(auth), ...ownDealsFilter(auth), stage: { $in: OPEN_DEAL_STAGES } })
        .select('dealNo title stage outstanding expectedCloseDate clientId')
        .populate({ path: 'clientId', select: 'fullName', options: { skipTenantGuard: true } })
        .sort({ outstanding: -1 })
        .limit(200)
        .lean();
      const byStage: Record<string, number> = {};
      for (const d of deals) byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
      return {
        open: deals.length,
        byStage,
        outstandingCommission: formatPkr(deals.reduce((s, d) => s + (d.outstanding ?? 0), 0)),
        largest: deals.slice(0, 10).map((d) => ({ dealNo: d.dealNo, stage: d.stage, client: (d.clientId as unknown as { fullName?: string })?.fullName ?? null, outstanding: formatPkr(d.outstanding ?? 0), expectedClose: d.expectedCloseDate ?? null })),
      };
    },
  },
  {
    perms: [PERMISSIONS.FINANCE_READ],
    tool: {
      name: 'collections',
      description: 'Money owed to the business (commission, installments, rent) and owed by it (agents, outside dealers), by how late it is, with the largest items.',
      inputSchema: obj({}),
    },
    async run(auth) {
      const a = await financeReportService.aging(auth);
      return { receivablesTotal: formatPkr(a.receivables.total), payablesTotal: formatPkr(a.payables.total), receivables: a.receivableRows.slice(0, 15).map((r) => ({ kind: r.kind, ref: r.ref, party: r.party, amount: formatPkr(r.amount), bucket: r.bucket })), payables: a.payableRows.slice(0, 10).map((r) => ({ kind: r.kind, ref: r.ref, party: r.party, amount: formatPkr(r.amount), bucket: r.bucket })) };
    },
  },
  {
    perms: [PERMISSIONS.DEALS_READ, PERMISSIONS.REPORTS_READ],
    tool: {
      name: 'forecast',
      description: 'Next 6 months: commission expected from open deals (weighted by stage), scheduled installments and rent, and the recent lead trend.',
      inputSchema: obj({}),
    },
    async run(auth) {
      return aiService.forecast(auth);
    },
  },
];

TOOLS.push(
  {
    perms: [PERMISSIONS.FOLLOWUPS_CREATE],
    tool: {
      name: 'propose_follow_up',
      description: 'Suggest a follow-up (call, meeting, visit…) for a client. It is shown to the user with a Confirm button and is NOT saved unless they confirm. Use a client id from search_clients.',
      inputSchema: obj({
        client_id: { type: 'string' },
        type: { type: 'string', enum: ['CALL', 'MEETING', 'WHATSAPP', 'SMS', 'PROPERTY_VISIT', 'GENERAL'] },
        due: { type: 'string', description: 'ISO date-time, e.g. 2026-11-16T11:00' },
        notes: { type: 'string' },
      }),
    },
    async run(auth, i, proposals) {
      const c = await proposalClient(auth, i.client_id);
      if (!c) return { error: 'Unknown client id' };
      const due = new Date(String(i.due));
      if (Number.isNaN(+due)) return { error: 'Invalid due date' };
      proposals.push({ kind: 'FOLLOW_UP', clientId: String(c._id), clientName: c.fullName, type: String(i.type), dueAt: due.toISOString(), notes: String(i.notes ?? '').slice(0, 1000) });
      return { proposed: true, note: 'Shown to the user for confirmation — not saved yet.' };
    },
  },
  {
    perms: [PERMISSIONS.NOTES_CREATE],
    tool: {
      name: 'propose_note',
      description: 'Suggest a note on a client record (e.g. a summary of what was discussed). Shown to the user with a Confirm button; NOT saved unless they confirm.',
      inputSchema: obj({ client_id: { type: 'string' }, content: { type: 'string' } }),
    },
    async run(auth, i, proposals) {
      const c = await proposalClient(auth, i.client_id);
      if (!c) return { error: 'Unknown client id' };
      proposals.push({ kind: 'NOTE', clientId: String(c._id), clientName: c.fullName, content: String(i.content ?? '').slice(0, 2000) });
      return { proposed: true, note: 'Shown to the user for confirmation — not saved yet.' };
    },
  },
);

const STABLE_SYSTEM =
  'You are the Dalliqo assistant inside a real-estate agency CRM used in Pakistan. You answer questions about the agency’s own clients, listings, deals, follow-ups and money by calling the tools provided.\n' +
  'Rules:\n' +
  '- Use only what the tools return. If the tools cannot answer, say so plainly and suggest where in the app to look. Never guess names, numbers or phone numbers.\n' +
  '- You never change data yourself. You may suggest a follow-up or a note with the propose_* tools — the user confirms it in the app. For anything else (editing, deleting, sending messages, payments) explain which screen to use.\n' +
  '- The tools already apply the user’s permissions; if one is unavailable, the user is not allowed that information — say so briefly.\n' +
  '- Write amounts in PKR with lakh / crore. Price estimates are indicative, never a valuation.\n' +
  '- Reply in the language the user writes in (English, Urdu or Roman Urdu). Be brief: short paragraphs or bullet lists, no tables wider than 4 columns.';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const assistantService = {
  async ask(auth: AuthContext, history: AssistantTurn[]) {
    const allowed = TOOLS.filter((t) => t.perms.some((p) => auth.permissions.includes(p as never)));
    const [user, business] = await Promise.all([User.findById(auth.userId).select('fullName').lean(), Business.findById(auth.businessId).select('name').lean()]);
    const used: string[] = [];
    const proposals: Proposal[] = [];
    const res = await aiClient.runTools(auth, 'assistant', {
      maxTokens: 8000,
      effort: 'medium',
      maxSteps: MAX_STEPS,
      system: STABLE_SYSTEM,
      context: `Business: ${business?.name ?? ''}. User: ${user?.fullName ?? ''} (${auth.role}). Today: ${new Date().toISOString().slice(0, 10)}.`,
      history: history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      tools: allowed.map((t) => t.tool),
      async runTool(name, input) {
        const def = allowed.find((t) => t.tool.name === name);
        used.push(name);
        if (!def) return { content: 'This tool is not available to this user.', isError: true };
        try {
          const out = JSON.stringify(await def.run(auth, input, proposals));
          return { content: out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}…(truncated)` : out };
        } catch (err) {
          return { content: (err as Error).message || 'The lookup failed.', isError: true };
        }
      },
    });
    const answer = res.exhausted ? 'That needed more lookups than I can do in one go. Please ask a narrower question.' : res.text || 'I could not find an answer to that.';
    return { answer, toolsUsed: [...new Set(used)], proposals };
  },

  toolNames(auth: AuthContext) {
    return TOOLS.filter((t) => t.perms.some((p) => auth.permissions.includes(p as never))).map((t) => t.tool.name);
  },
};
