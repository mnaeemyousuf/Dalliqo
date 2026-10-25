import { Types } from 'mongoose';
import {
  ERROR_CODES,
  SOCKET_EVENTS,
  type ClientPurpose,
  type ClientStatus,
  type CommunicationChannel,
  type Priority,
  type PropertyType,
  type SizeUnit,
} from '@recrm/shared';
import type { ClientDoc, RequirementDoc } from '../models/Client';
import { clientRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, conflict } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { escapeRegex, searchBlob } from '../utils/text';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { categoryService } from './categoryService';
import { matchingService } from './matching/matchingService';
import { publishChange } from './publish';
import { settingsService, type EffectiveSettings } from './settingsService';

export interface RequirementInput {
  _id?: string;
  isPrimary?: boolean;
  active?: boolean;
  purpose: ClientPurpose;
  propertyTypes?: PropertyType[];
  areas?: string[];
  societies?: string[];
  blocks?: string[];
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  minBudget?: number;
  maxBudget?: number;
  bedroomsMin?: number;
  notes?: string;
}

/** The spec's flat requirement fields, accepted as a shorthand for one primary requirement. */
export interface FlatRequirementInput {
  preferredArea?: string;
  preferredSociety?: string;
  preferredBlock?: string;
  propertyTypeRequired?: PropertyType[];
  minSize?: number;
  maxSize?: number;
  sizeUnit?: SizeUnit;
  minBudget?: number;
  maxBudget?: number;
  purchaseOrRental?: ClientPurpose;
}

export interface ClientInput extends FlatRequirementInput {
  uuid?: string;
  /** Save even when another client uses the same phone number. */
  allowDuplicate?: boolean;
  fullName: string;
  mobileNumber: string;
  alternateNumber?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  categoryId?: string;
  status?: ClientStatus;
  priority?: Priority;
  source?: string;
  assignedTo?: string;
  notes?: string;
  requirements?: RequirementInput[];
}

export interface ClientQuery {
  q?: string;
  categoryId?: string;
  status?: ClientStatus;
  priority?: Priority;
  assignedTo?: string;
  area?: string;
  society?: string;
  propertyType?: PropertyType;
  purpose?: ClientPurpose;
  minBudget?: number;
  maxBudget?: number;
  sort?: string;
  page: number;
  limit: number;
}

const AUDITED_FIELDS = [
  'fullName', 'mobileNumber', 'alternateNumber', 'whatsappNumber', 'email', 'address', 'categoryId',
  'status', 'priority', 'source', 'assignedTo', 'notes', 'requirements',
] as const;

const SORTS: Record<string, Record<string, 1 | -1>> = {
  '-updatedAt': { updatedAt: -1, _id: -1 },
  '-createdAt': { createdAt: -1, _id: -1 },
  fullName: { fullName: 1, _id: 1 },
  '-matchCount': { matchCount: -1, _id: -1 },
  '-maxBudget': { maxBudget: -1, _id: -1 },
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) && (o as Record<string, unknown>)[k] !== undefined;

/**
 * Applies only the flat shorthand fields that were actually sent onto an existing
 * requirement, so a partial edit (e.g. just the budget) keeps the rest intact.
 */
function mergeFlatIntoRequirement(existing: RequirementDoc | undefined, f: FlatRequirementInput): RequirementInput | null {
  const fresh = flatToRequirement(f);
  if (!fresh) return null;
  if (!existing) return fresh;
  return {
    isPrimary: true,
    purpose: has(f, 'purchaseOrRental') ? fresh.purpose : existing.purpose,
    propertyTypes: has(f, 'propertyTypeRequired') ? fresh.propertyTypes : existing.propertyTypes,
    areas: has(f, 'preferredArea') ? fresh.areas : existing.areas,
    societies: has(f, 'preferredSociety') ? fresh.societies : existing.societies,
    blocks: has(f, 'preferredBlock') ? fresh.blocks : existing.blocks,
    minSize: has(f, 'minSize') ? fresh.minSize : existing.minSize,
    maxSize: has(f, 'maxSize') ? fresh.maxSize : existing.maxSize,
    sizeUnit: has(f, 'sizeUnit') ? fresh.sizeUnit : existing.sizeUnit,
    minBudget: has(f, 'minBudget') ? fresh.minBudget : existing.minBudget,
    maxBudget: has(f, 'maxBudget') ? fresh.maxBudget : existing.maxBudget,
    bedroomsMin: existing.bedroomsMin,
    notes: existing.notes,
    active: existing.active,
  };
}

function flatToRequirement(f: FlatRequirementInput): RequirementInput | null {
  const any = ['preferredArea', 'preferredSociety', 'preferredBlock', 'propertyTypeRequired', 'minSize', 'maxSize', 'minBudget', 'maxBudget', 'purchaseOrRental'].some((k) => has(f, k));
  if (!any) return null;
  return {
    isPrimary: true,
    purpose: f.purchaseOrRental ?? 'PURCHASE',
    propertyTypes: f.propertyTypeRequired ?? [],
    areas: f.preferredArea ? [f.preferredArea] : [],
    societies: f.preferredSociety ? [f.preferredSociety] : [],
    blocks: f.preferredBlock ? [f.preferredBlock] : [],
    minSize: f.minSize,
    maxSize: f.maxSize,
    sizeUnit: f.sizeUnit,
    minBudget: f.minBudget,
    maxBudget: f.maxBudget,
  };
}

function buildRequirements(inputs: RequirementInput[], settings: EffectiveSettings): Omit<RequirementDoc, '_id'>[] & { _id?: Types.ObjectId }[] {
  const reqs = inputs.map((r) => {
    if (r.minBudget !== undefined && r.maxBudget !== undefined && r.minBudget > r.maxBudget) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Minimum budget cannot exceed maximum budget');
    }
    if (r.minSize !== undefined && r.maxSize !== undefined && r.minSize > r.maxSize) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Minimum size cannot exceed maximum size');
    }
    const unit = r.sizeUnit ?? (r.minSize !== undefined || r.maxSize !== undefined ? 'SQ_YARD' : undefined);
    return {
      ...(r._id ? { _id: new Types.ObjectId(r._id) } : {}),
      isPrimary: !!r.isPrimary,
      active: r.active ?? true,
      purpose: r.purpose,
      propertyTypes: r.propertyTypes ?? [],
      areas: (r.areas ?? []).filter(Boolean),
      societies: (r.societies ?? []).filter(Boolean),
      blocks: (r.blocks ?? []).filter(Boolean),
      minSize: r.minSize,
      maxSize: r.maxSize,
      sizeUnit: unit,
      minSizeSqft: settingsService.toSqft(settings, r.minSize, unit),
      maxSizeSqft: settingsService.toSqft(settings, r.maxSize, unit),
      minBudget: r.minBudget,
      maxBudget: r.maxBudget,
      bedroomsMin: r.bedroomsMin,
      notes: r.notes,
    };
  });
  if (reqs.length && !reqs.some((r) => r.isPrimary)) reqs[0].isPrimary = true;
  let seenPrimary = false;
  for (const r of reqs) {
    if (r.isPrimary && seenPrimary) r.isPrimary = false;
    if (r.isPrimary) seenPrimary = true;
  }
  return reqs as never;
}

/** Copies the primary requirement onto the client (spec fields, list filters, cards). */
function denormalise(reqs: Partial<RequirementDoc>[]) {
  const p = reqs.find((r) => r.isPrimary) ?? reqs[0];
  return {
    preferredArea: p?.areas?.[0] ?? null,
    preferredSociety: p?.societies?.[0] ?? null,
    preferredBlock: p?.blocks?.[0] ?? null,
    propertyTypeRequired: p?.propertyTypes ?? [],
    minSize: p?.minSize ?? null,
    maxSize: p?.maxSize ?? null,
    sizeUnit: p?.sizeUnit ?? null,
    minBudget: p?.minBudget ?? null,
    maxBudget: p?.maxBudget ?? null,
    purchaseOrRental: p?.purpose ?? null,
  };
}

async function assertAssignee(ctx: TenantContext, userId?: string | null) {
  if (userId && !(await memberRepository.isActiveMemberUser(ctx, userId))) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assigned user is not an active member of this business');
  }
}

function stripNulls<T extends Record<string, unknown>>(o: T) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === null) unset.push(k);
    else set[k] = v;
  }
  return { set, unset };
}

export const clientService = {
  /**
   * Clients in this business that already use any of the given (E.164) numbers
   * as their mobile, WhatsApp or alternate number.
   */
  async findDuplicates(ctx: TenantContext, phones: (string | undefined)[], excludeId?: string) {
    const numbers = [...new Set(phones.filter((p): p is string => !!p))];
    if (!numbers.length) return [];
    const filter: Record<string, unknown> = {
      $or: [{ mobileNumber: { $in: numbers } }, { whatsappNumber: { $in: numbers } }, { alternateNumber: { $in: numbers } }],
    };
    if (excludeId) filter._id = { $ne: excludeId };
    const found = await clientRepository.find(ctx, filter, { limit: 5, select: 'fullName mobileNumber whatsappNumber alternateNumber status assignedTo updatedAt' });
    return found.map((c) => ({ _id: c._id, fullName: c.fullName, mobileNumber: c.mobileNumber, whatsappNumber: c.whatsappNumber, status: c.status }));
  },

  async create(auth: AuthContext, input: ClientInput, meta: RequestMeta = {}): Promise<ClientDoc> {
    if (input.uuid) {
      const existing = await clientRepository.findByUuid(auth, input.uuid);
      if (existing) return existing; // idempotent offline replay
    } else if (!input.allowDuplicate) {
      // Interactive creates are stopped on a phone-number clash so the user can open the
      // existing record instead. Offline creates (which carry a uuid) are never rejected
      // here: the app warns locally before saving and the user already decided.
      const duplicates = await clientService.findDuplicates(auth, [input.mobileNumber, input.whatsappNumber, input.alternateNumber]);
      if (duplicates.length) {
        throw conflict(ERROR_CODES.CLIENT_DUPLICATE, `A client with this phone number already exists: ${duplicates[0].fullName}`, { duplicates });
      }
    }
    const settings = await settingsService.get(auth);
    if (input.categoryId) await categoryService.ensureUsable(auth, input.categoryId);
    await assertAssignee(auth, input.assignedTo);

    const reqInputs = input.requirements ?? (flatToRequirement(input) ? [flatToRequirement(input)!] : []);
    const requirements = buildRequirements(reqInputs, settings);
    const { set } = stripNulls(denormalise(requirements as Partial<RequirementDoc>[]));

    const client = await clientRepository.create(auth, {
      ...(input.uuid ? { uuid: input.uuid } : {}),
      fullName: input.fullName,
      mobileNumber: input.mobileNumber,
      alternateNumber: input.alternateNumber,
      whatsappNumber: input.whatsappNumber ?? input.mobileNumber,
      email: input.email,
      address: input.address,
      categoryId: input.categoryId,
      status: input.status ?? 'ACTIVE',
      priority: input.priority ?? 'MEDIUM',
      source: input.source,
      assignedTo: input.assignedTo,
      notes: input.notes,
      requirements,
      ...set,
      searchText: searchBlob(input.fullName, input.mobileNumber, input.whatsappNumber, input.alternateNumber, input.email),
    });

    await activityService.record(auth, 'CLIENT_CREATED', `Client ${client.fullName} created`, [
      { entityType: 'client', entityId: client._id, label: client.fullName },
    ]);
    await auditService.record(auth, { action: 'client.created', entityType: 'client', entityId: client._id, entityLabel: client.fullName, ip: meta.ip });
    publishChange(auth, SOCKET_EVENTS.CLIENT_CREATED, 'client', client);
    await matchingService.safeRecalcForClient(auth, client);
    return (await clientRepository.findById(auth, client._id.toString())) ?? client;
  },

  async list(ctx: TenantContext, q: ClientQuery) {
    const filter: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      if (digits.length >= 4) {
        const tail = escapeRegex(digits.startsWith('0') ? digits.slice(1) : digits);
        and.push({ $or: [{ mobileNumber: new RegExp(tail) }, { whatsappNumber: new RegExp(tail) }, { alternateNumber: new RegExp(tail) }] });
      } else {
        for (const token of searchBlob(q.q).split(' ').filter(Boolean)) and.push({ searchText: new RegExp(`(^|\\s)${escapeRegex(token)}`) });
      }
    }
    if (q.categoryId) filter.categoryId = q.categoryId;
    if (q.status) filter.status = q.status;
    if (q.priority) filter.priority = q.priority;
    if (q.assignedTo) filter.assignedTo = q.assignedTo;
    if (q.propertyType) filter.propertyTypeRequired = q.propertyType;
    if (q.purpose) filter.purchaseOrRental = q.purpose;
    if (q.area) filter['requirements.areas'] = new RegExp(escapeRegex(q.area), 'i');
    if (q.society) filter['requirements.societies'] = new RegExp(escapeRegex(q.society), 'i');
    // Budget ranges overlap the requested range.
    if (q.minBudget !== undefined) and.push({ $or: [{ maxBudget: { $gte: q.minBudget } }, { maxBudget: null }] });
    if (q.maxBudget !== undefined) and.push({ $or: [{ minBudget: { $lte: q.maxBudget } }, { minBudget: null }] });
    if (and.length) filter.$and = and;
    return clientRepository.list(ctx, filter, { page: q.page, limit: q.limit, sort: SORTS[q.sort ?? '-updatedAt'] ?? SORTS['-updatedAt'] });
  },

  get(ctx: TenantContext, id: string) {
    return clientRepository.getById(ctx, id, 'Client not found');
  },

  async update(auth: AuthContext, id: string, input: Partial<ClientInput>, opts: { baseVersion?: number; meta?: RequestMeta } = {}): Promise<ClientDoc> {
    const before = await clientRepository.getById(auth, id, 'Client not found');
    const settings = await settingsService.get(auth);
    if (input.categoryId) await categoryService.ensureUsable(auth, input.categoryId);
    if (input.assignedTo) await assertAssignee(auth, input.assignedTo);

    const set: Record<string, unknown> = {};
    for (const k of ['fullName', 'mobileNumber', 'alternateNumber', 'whatsappNumber', 'email', 'address', 'categoryId', 'status', 'priority', 'source', 'assignedTo', 'notes'] as const) {
      if (has(input, k)) set[k] = input[k];
    }
    const primary = before.requirements.find((r) => r.isPrimary);
    const flat = input.requirements ? null : mergeFlatIntoRequirement(primary, input);
    let requirementsChanged = false;
    if (input.requirements || flat) {
      const reqInputs = input.requirements ?? [
        // Shorthand edits update the primary requirement field by field, keeping the others.
        { ...flat!, _id: primary?._id?.toString() },
        ...before.requirements.filter((r) => !r.isPrimary).map((r) => ({ ...r, _id: r._id.toString() })),
      ];
      const requirements = buildRequirements(reqInputs as RequirementInput[], settings);
      set.requirements = requirements;
      Object.assign(set, denormalise(requirements as Partial<RequirementDoc>[]));
      requirementsChanged = true;
    }
    const merged = { ...before, ...set } as ClientDoc;
    set.searchText = searchBlob(merged.fullName, merged.mobileNumber, merged.whatsappNumber, merged.alternateNumber, merged.email);

    const { set: $set, unset } = stripNulls(set);
    const updated = await clientRepository.update(auth, id, $set, { baseVersion: opts.baseVersion, unset });

    const changes = diffFields(before as unknown as Record<string, unknown>, set, AUDITED_FIELDS);
    if (changes.length) {
      await auditService.record(auth, { action: 'client.updated', entityType: 'client', entityId: updated._id, entityLabel: updated.fullName, changes, ip: opts.meta?.ip });
      const fields = changes.map((c) => c.field).join(', ');
      await activityService.record(auth, 'CLIENT_UPDATED', `Client ${updated.fullName} updated (${fields})`, [
        { entityType: 'client', entityId: updated._id, label: updated.fullName },
      ], { fields: changes.map((c) => c.field) });
    }
    publishChange(auth, SOCKET_EVENTS.CLIENT_UPDATED, 'client', updated);
    if (requirementsChanged || has(set, 'status')) {
      if (updated.status === 'ACTIVE') await matchingService.safeRecalcForClient(auth, updated);
      else await matchingService.removeForClient(auth, updated._id);
    }
    return (await clientRepository.findById(auth, id)) ?? updated;
  },

  async remove(auth: AuthContext, id: string, opts: { baseVersion?: number; meta?: RequestMeta } = {}) {
    const deleted = await clientRepository.softDelete(auth, id, { baseVersion: opts.baseVersion });
    await matchingService.removeForClient(auth, deleted._id);
    await activityService.record(auth, 'CLIENT_DELETED', `Client ${deleted.fullName} deleted`, [
      { entityType: 'client', entityId: deleted._id, label: deleted.fullName },
    ]);
    await auditService.record(auth, { action: 'client.deleted', entityType: 'client', entityId: deleted._id, entityLabel: deleted.fullName, ip: opts.meta?.ip });
    publishChange(auth, SOCKET_EVENTS.CLIENT_DELETED, 'client', deleted);
    return deleted;
  },

  /** One-tap call / WhatsApp / SMS / email from the app, recorded on the timeline. */
  async logCommunication(auth: AuthContext, id: string, channel: CommunicationChannel, note?: string) {
    const client = await clientRepository.getById(auth, id, 'Client not found');
    const updated = await clientRepository.update(auth, id, { lastContactedAt: new Date() });
    const verb: Record<CommunicationChannel, string> = { CALL: 'Called', WHATSAPP: 'WhatsApp message to', SMS: 'SMS to', EMAIL: 'Emailed' };
    await activityService.record(auth, 'CLIENT_CONTACTED', `${verb[channel]} ${client.fullName}${note ? `: ${note}` : ''}`, [
      { entityType: 'client', entityId: client._id, label: client.fullName },
    ], { channel });
    publishChange(auth, SOCKET_EVENTS.CLIENT_UPDATED, 'client', updated);
    return updated;
  },
};
