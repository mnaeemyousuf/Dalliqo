import { Types } from 'mongoose';
import { ERROR_CODES, PERMISSIONS, type Permission } from '@recrm/shared';
import { logger } from '../config/logger';
import { SyncRecord } from '../models/SyncRecord';
import {
  categoryRepository,
  clientRepository,
  followUpRepository,
  noteRepository,
  ownerRepository,
  propertyRepository,
} from '../repositories/entityRepositories';
import type { AuthContext } from '../types/context';
import { AppError, forbidden } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { auditService } from './auditService';
import { authService } from './authService';
import { clientService } from './clientService';
import { followUpService } from './followUpService';
import { memberService } from './memberService';
import { noteService } from './noteService';
import { ownerService } from './ownerService';
import { propertyService } from './propertyService';
import { settingsService } from './settingsService';
import {
  clientCreateSchema,
  clientUpdateSchema,
  followUpCreateSchema,
  followUpUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  ownerCreateSchema,
  ownerUpdateSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
} from '../validators/crm.schemas';
import type { ZodTypeAny } from 'zod';

/** Offline writes pass exactly the same validation as the REST endpoints. */
const SCHEMAS: Record<PushEntity, { create: ZodTypeAny; update: ZodTypeAny }> = {
  clients: { create: clientCreateSchema, update: clientUpdateSchema },
  owners: { create: ownerCreateSchema, update: ownerUpdateSchema },
  properties: { create: propertyCreateSchema, update: propertyUpdateSchema },
  followUps: { create: followUpCreateSchema, update: followUpUpdateSchema },
  notes: { create: noteCreateSchema, update: noteUpdateSchema },
};

export type PushEntity = 'clients' | 'owners' | 'properties' | 'followUps' | 'notes';

export interface Mutation {
  mutationId: string;
  entity: PushEntity;
  op: 'create' | 'update' | 'delete';
  uuid: string;
  baseVersion?: number;
  data?: Record<string, unknown>;
  /** "Keep mine" after a conflict: overwrite protected fields deliberately. */
  force?: boolean;
}

export type MutationStatus = 'applied' | 'applied_with_conflict' | 'conflict' | 'rejected';

export interface MutationResult {
  mutationId: string;
  uuid: string;
  status: MutationStatus;
  serverId?: string;
  version?: number;
  record?: unknown;
  code?: string;
  message?: string;
}

/** Fields where a silent last-write-wins could hurt the business; conflicts on these need a human. */
const PROTECTED_FIELDS: Partial<Record<PushEntity, string[]>> = {
  properties: ['status', 'askingPrice', 'minimumPrice'],
  followUps: ['status'],
};

const REPOS = {
  clients: clientRepository,
  owners: ownerRepository,
  properties: propertyRepository,
  followUps: followUpRepository,
  notes: noteRepository,
} as const;

const WRITE_PERMS: Record<PushEntity, Record<Mutation['op'], Permission>> = {
  clients: { create: PERMISSIONS.CLIENTS_CREATE, update: PERMISSIONS.CLIENTS_UPDATE, delete: PERMISSIONS.CLIENTS_DELETE },
  owners: { create: PERMISSIONS.OWNERS_CREATE, update: PERMISSIONS.OWNERS_UPDATE, delete: PERMISSIONS.OWNERS_DELETE },
  properties: { create: PERMISSIONS.PROPERTIES_CREATE, update: PERMISSIONS.PROPERTIES_UPDATE, delete: PERMISSIONS.PROPERTIES_DELETE },
  followUps: { create: PERMISSIONS.FOLLOWUPS_CREATE, update: PERMISSIONS.FOLLOWUPS_UPDATE, delete: PERMISSIONS.FOLLOWUPS_DELETE },
  notes: { create: PERMISSIONS.NOTES_CREATE, update: PERMISSIONS.NOTES_CREATE, delete: PERMISSIONS.NOTES_CREATE },
};

const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

/**
 * Offline-created records reference each other by device uuid (the server id
 * isn't known yet). Resolve uuid references to server ids before calling the
 * normal services.
 */
async function resolveRefs(auth: AuthContext, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...data };
  const refs: [string, { findByUuid(c: AuthContext, u: string): Promise<{ _id: unknown } | null> }][] = [
    ['clientId', clientRepository],
    ['propertyId', propertyRepository],
    ['ownerId', ownerRepository],
    ['categoryId', categoryRepository],
  ];
  for (const [field, repo] of refs) {
    const v = out[field];
    if (typeof v === 'string' && v && !isObjectId(v)) {
      const found = await repo.findByUuid(auth, v);
      if (!found) throw new AppError(400, ERROR_CODES.ENTITY_NOT_FOUND, `${field} ${v} not found (not synced yet?)`);
      out[field] = String(found._id);
    }
  }
  if (typeof out.entityId === 'string' && !isObjectId(out.entityId)) {
    const repo = { client: clientRepository, property: propertyRepository, owner: ownerRepository, followUp: followUpRepository }[String(out.entityType)];
    const found = repo ? await repo.findByUuid(auth, out.entityId) : null;
    if (!found) throw new AppError(400, ERROR_CODES.ENTITY_NOT_FOUND, `entity ${out.entityId} not found`);
    out.entityId = String(found._id);
  }
  for (const k of ['dueAt', 'reminderAt']) if (typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  delete out._id;
  delete out.uuid;
  delete out.version;
  delete out.businessId;
  return out;
}

async function create(auth: AuthContext, entity: PushEntity, uuid: string, data: Record<string, unknown>) {
  const input = { ...data, uuid } as never;
  switch (entity) {
    case 'clients': return clientService.create(auth, input);
    case 'owners': return ownerService.create(auth, input);
    case 'properties': return propertyService.create(auth, input);
    case 'followUps': return followUpService.create(auth, input);
    case 'notes': return noteService.create(auth, input);
  }
}

async function update(auth: AuthContext, entity: PushEntity, id: string, data: Record<string, unknown>, baseVersion?: number) {
  const input = data as never;
  switch (entity) {
    case 'clients': return clientService.update(auth, id, input, { baseVersion });
    case 'owners': return ownerService.update(auth, id, input, { baseVersion });
    case 'properties': return propertyService.update(auth, id, input, { baseVersion });
    case 'followUps': return followUpService.update(auth, id, input, baseVersion);
    case 'notes': return noteService.update(auth, id, String(data.content ?? ''), baseVersion);
  }
}

async function remove(auth: AuthContext, entity: PushEntity, id: string) {
  switch (entity) {
    case 'clients': return clientService.remove(auth, id);
    case 'owners': return ownerService.remove(auth, id);
    case 'properties': return propertyService.remove(auth, id);
    case 'followUps': return followUpService.remove(auth, id);
    case 'notes': return noteService.remove(auth, id);
  }
}

async function apply(auth: AuthContext, m: Mutation): Promise<MutationResult> {
  const base = { mutationId: m.mutationId, uuid: m.uuid };
  if (!auth.permissions.includes(WRITE_PERMS[m.entity][m.op])) throw forbidden();
  const repo = REPOS[m.entity];
  const raw = m.data ?? {};
  const validated: Record<string, unknown> =
    m.op === 'delete' ? {} : m.op === 'create' ? SCHEMAS[m.entity].create.parse({ ...raw, uuid: m.uuid }) : SCHEMAS[m.entity].update.parse(raw);
  delete validated.baseVersion;
  const data = await resolveRefs(auth, validated);

  if (m.op === 'create') {
    const doc = (await create(auth, m.entity, m.uuid, data)) as { _id: unknown; version: number };
    return { ...base, status: 'applied', serverId: String(doc._id), version: doc.version, record: doc };
  }

  const current = (await repo.findByUuid(auth, m.uuid)) as ({ _id: unknown; version: number; deletedAt?: Date | null } & Record<string, unknown>) | null;
  if (!current) return { ...base, status: 'rejected', code: ERROR_CODES.NOT_FOUND, message: 'Record not found on the server' };
  const id = String(current._id);

  if (m.op === 'delete') {
    if (current.deletedAt) return { ...base, status: 'applied', serverId: id, version: current.version, record: current };
    const doc = (await remove(auth, m.entity, id)) as { version: number };
    return { ...base, status: 'applied', serverId: id, version: doc.version, record: doc };
  }

  // update
  if (current.deletedAt) {
    return { ...base, status: 'conflict', serverId: id, version: current.version, record: current, code: ERROR_CODES.VERSION_CONFLICT, message: 'This record was deleted by another user' };
  }
  const stale = m.baseVersion !== undefined && m.baseVersion !== current.version;
  if (!stale) {
    const doc = (await update(auth, m.entity, id, data, current.version)) as { version: number };
    return { ...base, status: 'applied', serverId: id, version: doc.version, record: doc };
  }

  const changedProtected = (PROTECTED_FIELDS[m.entity] ?? []).filter((f) => f in data && JSON.stringify(data[f]) !== JSON.stringify(current[f]));
  if (changedProtected.length && !m.force) {
    return {
      ...base,
      status: 'conflict',
      serverId: id,
      version: current.version,
      record: current,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: `This record was modified by another user (${changedProtected.join(', ')})`,
    };
  }
  // Field-level last-write-wins; what we overwrite is preserved in the audit log.
  const overwritten = diffFields(current, data, Object.keys(data));
  const doc = (await update(auth, m.entity, id, data)) as { version: number };
  if (overwritten.length) {
    await auditService.record(auth, {
      action: m.force ? 'sync.conflict_kept_mine' : 'sync.conflict_overwritten',
      entityType: m.entity,
      entityId: new Types.ObjectId(id),
      changes: overwritten,
      meta: { baseVersion: m.baseVersion, serverVersion: current.version, mutationId: m.mutationId },
    });
  }
  return { ...base, status: 'applied_with_conflict', serverId: id, version: doc.version, record: doc };
}

interface Cursor {
  [entity: string]: { t: string; id: string };
}

const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(s?: string): Cursor {
  if (!s) return {};
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
  } catch {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Invalid sync cursor');
  }
}

const PULL_REPOS = {
  clientCategories: categoryRepository,
  clients: clientRepository,
  owners: ownerRepository,
  properties: propertyRepository,
  followUps: followUpRepository,
  notes: noteRepository,
} as const;
type PullEntity = keyof typeof PULL_REPOS;

const READ_PERMS: Record<PullEntity, Permission | null> = {
  clientCategories: null,
  clients: PERMISSIONS.CLIENTS_READ,
  owners: PERMISSIONS.OWNERS_READ,
  properties: PERMISSIONS.PROPERTIES_READ,
  followUps: PERMISSIONS.FOLLOWUPS_READ,
  notes: null,
};

export const syncService = {
  /** Applies offline mutations in order. Each one is idempotent by mutationId. */
  async push(auth: AuthContext, mutations: Mutation[]): Promise<MutationResult[]> {
    const results: MutationResult[] = [];
    for (const m of mutations) {
      const prior = await SyncRecord.findOne({ businessId: auth.businessId, mutationId: m.mutationId }).lean();
      if (prior) {
        results.push(prior.result as unknown as MutationResult);
        continue;
      }
      let result: MutationResult;
      try {
        result = await apply(auth, m);
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) {
          if (err.code === ERROR_CODES.VERSION_CONFLICT) {
            const details = err.details as { server?: { version: number } } | undefined;
            result = { mutationId: m.mutationId, uuid: m.uuid, status: 'conflict', record: details?.server, version: details?.server?.version, code: err.code, message: err.message };
          } else {
            result = { mutationId: m.mutationId, uuid: m.uuid, status: 'rejected', code: err.code, message: err.message };
          }
        } else if ((err as { name?: string })?.name === 'ZodError' || (err as { name?: string })?.name === 'ValidationError') {
          result = { mutationId: m.mutationId, uuid: m.uuid, status: 'rejected', code: ERROR_CODES.VALIDATION_ERROR, message: (err as Error).message };
        } else {
          // Transient server failure: not recorded, so the device retries it.
          logger.error({ err, mutationId: m.mutationId }, 'Sync mutation failed');
          throw err;
        }
      }
      await SyncRecord.create({
        businessId: auth.businessId,
        mutationId: m.mutationId,
        userId: auth.userId,
        entity: m.entity,
        entityUuid: m.uuid,
        op: m.op,
        result: JSON.parse(JSON.stringify(result)),
      }).catch((e) => logger.warn({ e }, 'Could not store sync record'));
      results.push(result);
    }
    return results;
  },

  /** Delta of everything (including tombstones) changed after the cursor. */
  async pull(auth: AuthContext, cursorStr: string | undefined, limit = 500) {
    const cursor = decode(cursorStr);
    const changes: Record<string, unknown[]> = {};
    let hasMore = false;
    for (const [entity, repo] of Object.entries(PULL_REPOS) as [PullEntity, (typeof PULL_REPOS)[PullEntity]][]) {
      const perm = READ_PERMS[entity];
      if (perm && !auth.permissions.includes(perm)) continue;
      const after = cursor[entity] ? { updatedAt: new Date(cursor[entity].t), id: cursor[entity].id } : null;
      const rows = (await repo.changedSince(auth, after, limit + 1)) as unknown as { _id: unknown; updatedAt: Date }[];
      if (rows.length > limit) {
        hasMore = true;
        rows.length = limit;
      }
      changes[entity] = rows;
      const last = rows[rows.length - 1];
      if (last) cursor[entity] = { t: last.updatedAt.toISOString(), id: String(last._id) };
    }
    return { changes, cursor: encode(cursor), hasMore, serverTime: new Date() };
  },

  /** First install / new phone: account context plus the first page of data. */
  async bootstrap(auth: AuthContext) {
    const [me, members, settings, first] = await Promise.all([
      authService.me(auth),
      auth.permissions.includes(PERMISSIONS.MEMBERS_READ) ? memberService.list(auth, { page: 1, limit: 100 }) : { items: [], total: 0 },
      settingsService.get(auth),
      this.pull(auth, undefined),
    ]);
    return { ...me, members: members.items, settings, ...first };
  },
};
