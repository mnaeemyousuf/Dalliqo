import { ERROR_CODES, SOCKET_EVENTS, type FollowUpStatus, type FollowUpType, type Priority } from '@recrm/shared';
import { scopedPopulate } from '../models/plugins/tenant';
import { logger } from '../config/logger';
import { FollowUp, type FollowUpDoc } from '../models/FollowUp';
import { clientRepository, followUpRepository, propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, notFound } from '../utils/AppError';
import { diffFields } from '../utils/diff';
import { activityService, type ActivityRef } from './activityService';
import { auditService } from './auditService';
import { notificationService } from './notificationService';
import { publishChange } from './publish';
import { settingsService } from './settingsService';

export interface FollowUpInput {
  uuid?: string;
  clientId: string;
  propertyId?: string | null;
  type: FollowUpType;
  dueAt: Date;
  priority?: Priority;
  notes?: string;
  assignedTo?: string;
  /** Explicit reminder time, or minutes before dueAt; defaults to the business setting. */
  reminderAt?: Date | null;
  reminderMinutesBefore?: number;
}

export interface FollowUpQuery {
  assignedTo?: string;
  status?: FollowUpStatus;
  type?: FollowUpType;
  clientId?: string;
  propertyId?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

const TYPE_VERB: Record<FollowUpType, string> = {
  CALL: 'Call',
  MEETING: 'Meet',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  PROPERTY_VISIT: 'Property visit with',
  GENERAL: 'Follow up with',
};

async function context(ctx: TenantContext, clientId: string, propertyId?: string | null) {
  const client = await clientRepository.findById(ctx, clientId);
  if (!client) throw badRequest(ERROR_CODES.CLIENT_NOT_FOUND, 'Client not found');
  const property = propertyId ? await propertyRepository.findById(ctx, propertyId) : null;
  if (propertyId && !property) throw badRequest(ERROR_CODES.PROPERTY_NOT_FOUND, 'Property not found');
  return { client, property };
}

function refsFor(client: { _id: unknown; fullName: string }, property?: { _id: unknown; propertyId: string } | null, followUpId?: unknown): ActivityRef[] {
  const refs: ActivityRef[] = [{ entityType: 'client', entityId: String(client._id), label: client.fullName }];
  if (property) refs.push({ entityType: 'property', entityId: String(property._id), label: property.propertyId });
  if (followUpId) refs.push({ entityType: 'followUp', entityId: String(followUpId) });
  return refs;
}

/** Human sentence, e.g. "Call Muhammad Ali regarding the Gulshan-e-Iqbal property (RE-000125)". */
export function describeFollowUp(type: FollowUpType, clientName: string, property?: { propertyId: string; society?: string; area?: string } | null) {
  const where = property ? ` regarding the ${property.society ?? property.area ?? ''} property (${property.propertyId})`.replace('the  property', 'the property') : '';
  return `${TYPE_VERB[type]} ${clientName}${where}`;
}

export const followUpService = {
  async create(auth: AuthContext, input: FollowUpInput): Promise<FollowUpDoc> {
    if (input.uuid) {
      const existing = await followUpRepository.findByUuid(auth, input.uuid);
      if (existing) return existing;
    }
    const { client, property } = await context(auth, input.clientId, input.propertyId);
    const assignedTo = input.assignedTo ?? auth.userId;
    if (!(await memberRepository.isActiveMemberUser(auth, assignedTo))) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assigned user is not an active member of this business');
    }
    const settings = await settingsService.get(auth);
    const reminderAt =
      input.reminderAt === null
        ? undefined
        : input.reminderAt ?? new Date(input.dueAt.getTime() - (input.reminderMinutesBefore ?? settings.reminders.defaultMinutesBefore) * 60_000);

    const { reminderMinutesBefore: _r, ...rest } = input;
    const followUp = await followUpRepository.create(auth, {
      ...rest,
      propertyId: input.propertyId ?? undefined,
      assignedTo,
      reminderAt,
      status: input.dueAt < new Date() ? 'OVERDUE' : 'PENDING',
    });

    const summary = describeFollowUp(input.type, client.fullName, property);
    await activityService.record(auth, 'FOLLOWUP_CREATED', `Follow-up scheduled: ${summary}`, refsFor(client, property, followUp._id), {
      dueAt: input.dueAt.toISOString(),
      type: input.type,
    });
    publishChange(auth, SOCKET_EVENTS.FOLLOWUP_CREATED, 'followUp', followUp);
    if (assignedTo !== auth.userId) {
      await notificationService.notify(auth, {
        userIds: [assignedTo],
        category: 'FOLLOWUP',
        title: 'New follow-up assigned to you',
        body: summary,
        deepLink: `/followups/${followUp._id}`,
        data: { followUpId: followUp._id.toString() },
      });
    }
    return followUp;
  },

  list(ctx: TenantContext, q: FollowUpQuery) {
    const filter: Record<string, unknown> = {};
    if (q.assignedTo) filter.assignedTo = q.assignedTo;
    if (q.status) filter.status = q.status;
    if (q.type) filter.type = q.type;
    if (q.clientId) filter.clientId = q.clientId;
    if (q.propertyId) filter.propertyId = q.propertyId;
    if (q.from || q.to) filter.dueAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const done = q.status === 'COMPLETED' || q.status === 'CANCELLED';
    return followUpRepository.list(ctx, filter, {
      page: q.page,
      limit: q.limit,
      sort: done ? { completedAt: -1, dueAt: -1 } : { dueAt: 1, _id: 1 },
      populate: [
        { path: 'clientId', select: 'fullName mobileNumber whatsappNumber' },
        { path: 'propertyId', select: 'propertyId society area propertyType' },
        { path: 'assignedTo', select: 'fullName' },
      ],
    });
  },

  async get(ctx: TenantContext, id: string) {
    const f = await followUpRepository.model
      .findOne(followUpRepository.scope(ctx, { _id: id }))
      .populate(scopedPopulate('clientId', 'fullName mobileNumber whatsappNumber email'))
      .populate(scopedPopulate('propertyId', 'propertyId society area propertyType askingPrice'))
      .populate('assignedTo', 'fullName')
      .lean();
    if (!f) throw notFound(ERROR_CODES.FOLLOWUP_NOT_FOUND, 'Follow-up not found');
    return f;
  },

  async update(auth: AuthContext, id: string, input: Partial<FollowUpInput> & { status?: FollowUpStatus; outcome?: string }, baseVersion?: number) {
    const before = await followUpRepository.getById(auth, id, 'Follow-up not found');
    if (input.status === 'COMPLETED') return this.complete(auth, id, input.outcome, baseVersion);
    if (input.status === 'CANCELLED') return this.cancel(auth, id, input.outcome, baseVersion);
    if (input.clientId || input.propertyId) await context(auth, input.clientId ?? before.clientId.toString(), input.propertyId);
    if (input.assignedTo && !(await memberRepository.isActiveMemberUser(auth, input.assignedTo))) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assigned user is not an active member of this business');
    }
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of ['clientId', 'propertyId', 'type', 'dueAt', 'priority', 'notes', 'assignedTo', 'reminderAt'] as const) {
      if (input[k] === undefined) continue;
      if (input[k] === null) unset.push(k);
      else set[k] = input[k];
    }
    if (set.dueAt) {
      const due = set.dueAt as Date;
      if (input.reminderAt === undefined) {
        const settings = await settingsService.get(auth);
        set.reminderAt = new Date(due.getTime() - (input.reminderMinutesBefore ?? settings.reminders.defaultMinutesBefore) * 60_000);
      }
      set.reminderSentAt = null;
      if (before.status === 'PENDING' || before.status === 'OVERDUE') set.status = due < new Date() ? 'OVERDUE' : 'PENDING';
    }
    if (set.reminderAt) set.reminderSentAt = null;
    const updated = await followUpRepository.update(auth, id, set, { baseVersion, unset });
    const changes = diffFields(before as unknown as Record<string, unknown>, set, ['type', 'dueAt', 'priority', 'assignedTo', 'notes']);
    if (changes.length) await auditService.record(auth, { action: 'followup.updated', entityType: 'followUp', entityId: updated._id, changes });
    if (set.dueAt && new Date(set.dueAt as Date).getTime() !== new Date(before.dueAt).getTime()) {
      const { client, property } = await context(auth, updated.clientId.toString(), updated.propertyId?.toString());
      await activityService.record(auth, 'FOLLOWUP_RESCHEDULED', `Follow-up rescheduled: ${describeFollowUp(updated.type, client.fullName, property)}`, refsFor(client, property, updated._id), {
        from: new Date(before.dueAt).toISOString(),
        to: new Date(set.dueAt as Date).toISOString(),
      });
    }
    publishChange(auth, SOCKET_EVENTS.FOLLOWUP_UPDATED, 'followUp', updated);
    if (set.assignedTo && set.assignedTo !== before.assignedTo.toString() && set.assignedTo !== auth.userId) {
      const { client, property } = await context(auth, updated.clientId.toString(), updated.propertyId?.toString());
      await notificationService.notify(auth, {
        userIds: [String(set.assignedTo)],
        category: 'FOLLOWUP',
        title: 'Follow-up assigned to you',
        body: describeFollowUp(updated.type, client.fullName, property),
        deepLink: `/followups/${updated._id}`,
      });
    }
    return updated;
  },

  async complete(auth: AuthContext, id: string, outcome?: string, baseVersion?: number) {
    const before = await followUpRepository.getById(auth, id, 'Follow-up not found');
    if (before.status === 'COMPLETED') return before;
    const updated = await followUpRepository.update(auth, id, { status: 'COMPLETED', completedAt: new Date(), ...(outcome ? { outcome } : {}) }, { baseVersion });
    const { client, property } = await context(auth, updated.clientId.toString(), updated.propertyId?.toString());
    await activityService.record(auth, 'FOLLOWUP_COMPLETED', `Follow-up completed: ${describeFollowUp(updated.type, client.fullName, property)}${outcome ? ` — ${outcome}` : ''}`, refsFor(client, property, updated._id));
    if (['CALL', 'MEETING', 'WHATSAPP', 'SMS', 'PROPERTY_VISIT'].includes(updated.type)) {
      await clientRepository.model.updateOne({ businessId: auth.businessId, _id: client._id }, { $set: { lastContactedAt: new Date() } });
    }
    publishChange(auth, SOCKET_EVENTS.FOLLOWUP_COMPLETED, 'followUp', updated);
    return updated;
  },

  async cancel(auth: AuthContext, id: string, reason?: string, baseVersion?: number) {
    const updated = await followUpRepository.update(auth, id, { status: 'CANCELLED', completedAt: new Date(), ...(reason ? { outcome: reason } : {}) }, { baseVersion });
    const { client, property } = await context(auth, updated.clientId.toString(), updated.propertyId?.toString());
    await activityService.record(auth, 'FOLLOWUP_CANCELLED', `Follow-up cancelled: ${describeFollowUp(updated.type, client.fullName, property)}`, refsFor(client, property, updated._id));
    publishChange(auth, SOCKET_EVENTS.FOLLOWUP_UPDATED, 'followUp', updated);
    return updated;
  },

  async remove(auth: AuthContext, id: string, baseVersion?: number) {
    const deleted = await followUpRepository.softDelete(auth, id, { baseVersion });
    publishChange(auth, SOCKET_EVENTS.FOLLOWUP_UPDATED, 'followUp', deleted);
    return deleted;
  },

  // ── Scheduled jobs (cross-tenant; explicitly opt out of the tenant guard) ──

  /** Sends due reminders. Returns how many were sent. */
  async sendDueReminders(now = new Date()): Promise<number> {
    let sent = 0;
    for (;;) {
      // Claim one at a time so concurrent runners never double-send.
      const f = await FollowUp.findOneAndUpdate(
        { status: { $in: ['PENDING', 'OVERDUE'] }, deletedAt: null, reminderAt: { $lte: now }, reminderSentAt: null },
        { $set: { reminderSentAt: now } },
        { new: true, sort: { reminderAt: 1 } },
      )
        .setOptions({ skipTenantGuard: true } as never)
        .lean<FollowUpDoc>();
      if (!f) break;
      try {
        const ctx = { businessId: f.businessId.toString(), userId: f.createdBy.toString() };
        const { client, property } = await context(ctx, f.clientId.toString(), f.propertyId?.toString());
        await notificationService.notify(ctx, {
          userIds: [f.assignedTo.toString()],
          category: 'FOLLOWUP',
          title: 'Follow-up Reminder',
          body: describeFollowUp(f.type, client.fullName, property),
          deepLink: `/followups/${f._id}`,
          data: { followUpId: f._id.toString(), dueAt: f.dueAt.toISOString() },
        });
        sent++;
      } catch (err) {
        logger.error({ err, followUpId: f._id }, 'Failed to send follow-up reminder');
      }
    }
    return sent;
  },

  /** Marks PENDING follow-ups whose due time has passed as OVERDUE. */
  async markOverdue(now = new Date()): Promise<number> {
    const due = await FollowUp.find({ status: 'PENDING', deletedAt: null, dueAt: { $lt: now } })
      .setOptions({ skipTenantGuard: true } as never)
      .select('_id businessId createdBy version')
      .limit(1000)
      .lean<FollowUpDoc[]>();
    for (const f of due) {
      const updated = await FollowUp.findOneAndUpdate(
        { _id: f._id, businessId: f.businessId, status: 'PENDING' },
        { $set: { status: 'OVERDUE' }, $inc: { version: 1 } },
        { new: true },
      ).lean<FollowUpDoc>();
      if (updated) {
        publishChange({ businessId: f.businessId.toString(), userId: f.createdBy.toString() }, SOCKET_EVENTS.FOLLOWUP_UPDATED, 'followUp', updated);
      }
    }
    return due.length;
  },

};
