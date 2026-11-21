import { Types } from 'mongoose';
import { ERROR_CODES, PERMISSIONS, type ActivityType, type EntityType } from '@recrm/shared';
import { Deal } from '../models/Deal';
import type { TenantContext } from '../types/context';
import { notFound } from '../utils/AppError';

/**
 * Who may read which kind of record. Notes, documents and timeline entries hang off a record
 * (client, deal, income entry …) and are only as visible as that record: reading them needs the
 * record's read permission, and a deal's attachments are limited to the deal's agents unless the
 * member may read every deal.
 */
export const READ_PERMISSION: Record<EntityType, string> = {
  client: PERMISSIONS.CLIENTS_READ,
  property: PERMISSIONS.PROPERTIES_READ,
  owner: PERMISSIONS.OWNERS_READ,
  followUp: PERMISSIONS.FOLLOWUPS_READ,
  deal: PERMISSIONS.DEALS_READ,
  transaction: PERMISSIONS.FINANCE_READ,
  agreement: PERMISSIONS.AGREEMENTS_READ,
  lease: PERMISSIONS.RENTALS_READ,
};

/** Timeline entries whose text carries money figures not covered by the records they point at. */
export const ACTIVITY_TYPE_PERMISSION: Partial<Record<ActivityType, string>> = {
  INSTALLMENT_PLAN_CREATED: PERMISSIONS.FINANCE_READ,
  INSTALLMENT_RECEIVED: PERMISSIONS.FINANCE_READ,
  TRANSACTION_RECORDED: PERMISSIONS.FINANCE_READ,
  TRANSACTION_UPDATED: PERMISSIONS.FINANCE_READ,
  TRANSACTION_DELETED: PERMISSIONS.FINANCE_READ,
};

type Ctx = TenantContext & { permissions?: readonly string[] };

/** System contexts (jobs, portals) carry no permission list and see everything in their business. */
const can = (ctx: Ctx, permission: string) => !ctx.permissions || ctx.permissions.includes(permission);

/** Record types this member may not read at all. */
export function hiddenEntityTypes(ctx: Ctx): EntityType[] {
  return (Object.keys(READ_PERMISSION) as EntityType[]).filter((t) => !can(ctx, READ_PERMISSION[t]));
}

/** Ids of the deals this member may read, or null when they may read every deal. */
export async function readableDealIds(ctx: Ctx): Promise<Types.ObjectId[] | null> {
  if (can(ctx, PERMISSIONS.DEALS_READ_ALL)) return null;
  return Deal.find({ businessId: ctx.businessId, 'agents.userId': new Types.ObjectId(ctx.userId) }).distinct('_id');
}

/**
 * A filter for collections that point at a record through `entityType` / `entityId` (notes,
 * documents): hides record types the member cannot read and other agents' deals.
 */
export async function readableAttachmentFilter(ctx: Ctx): Promise<Record<string, unknown>> {
  const hidden = hiddenEntityTypes(ctx);
  const deals = hidden.includes('deal') ? null : await readableDealIds(ctx);
  const nor: Record<string, unknown>[] = [];
  if (hidden.length) nor.push({ entityType: { $in: hidden } });
  if (deals) nor.push({ entityType: 'deal', entityId: { $nin: deals } });
  return nor.length ? { $nor: nor } : {};
}

/** Same rule for timeline entries, which point at records through `refs`. */
export async function readableActivityFilter(ctx: Ctx): Promise<Record<string, unknown>> {
  const hidden = hiddenEntityTypes(ctx);
  const deals = hidden.includes('deal') ? null : await readableDealIds(ctx);
  const hiddenTypes = Object.entries(ACTIVITY_TYPE_PERMISSION).filter(([, p]) => !can(ctx, p)).map(([t]) => t);
  const nor: Record<string, unknown>[] = [];
  if (hidden.length) nor.push({ 'refs.entityType': { $in: hidden } });
  if (deals) nor.push({ refs: { $elemMatch: { entityType: 'deal', entityId: { $nin: deals } } } });
  if (hiddenTypes.length) nor.push({ type: { $in: hiddenTypes } });
  return nor.length ? { $nor: nor } : {};
}

/** Throws 404 (never 403, so ids don't leak) unless the member may read this record. */
export async function assertCanReadRecord(ctx: Ctx, entityType: EntityType, entityId: string | Types.ObjectId): Promise<void> {
  const hide = () => notFound(ERROR_CODES.ENTITY_NOT_FOUND, `${entityType} not found`);
  if (!can(ctx, READ_PERMISSION[entityType])) throw hide();
  if (entityType === 'deal') {
    const deals = await readableDealIds(ctx);
    if (deals && !deals.some((d) => d.equals(String(entityId)))) throw hide();
  }
}
