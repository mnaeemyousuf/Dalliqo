import { Types } from 'mongoose';
import {
  DEFAULT_REVERIFY_DAYS,
  ERROR_CODES,
  PERMISSIONS,
  SOCKET_EVENTS,
  VERIFICATION_CHECKLIST,
  type VerificationDecision,
  type VerificationStatus,
} from '@recrm/shared';
import { Document } from '../models/FileAsset';
import { Property, type PropertyDoc, type PropertyVerification } from '../models/Property';
import { propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, RequestMeta, TenantContext } from '../types/context';
import { badRequest, forbidden } from '../utils/AppError';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { branchFilter } from './branchScope';
import { notificationService } from './notificationService';
import { publishChange } from './publish';

/**
 * Internal property verification: submit → (assign) → checklist → approve / reject / send back,
 * with remarks, history, missing-document detection and a next verification date. The result is
 * an internal review, never a government confirmation of legal ownership.
 */

const OPEN: VerificationStatus[] = ['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED'];

function emptyVerification(): PropertyVerification {
  return {
    status: 'NOT_SUBMITTED',
    checklist: VERIFICATION_CHECKLIST.map((c) => ({ key: c.key, done: false, note: null, doneBy: null, doneAt: null })),
    history: [],
  };
}

const current = (p: Pick<PropertyDoc, 'verification'>): PropertyVerification =>
  p.verification?.checklist?.length ? p.verification : { ...emptyVerification(), ...(p.verification ?? {}), checklist: emptyVerification().checklist };

async function save(auth: AuthContext, p: PropertyDoc, next: PropertyVerification, entry: { status: VerificationStatus; remarks?: string | null; action: string }, meta: RequestMeta = {}) {
  const history = { status: entry.status, action: entry.action, remarks: entry.remarks ?? null, by: new Types.ObjectId(auth.userId), at: new Date() };
  const updated = await propertyRepository.update(auth, p._id.toString(), { verification: { ...next, history: [...(next.history ?? []), history] } });
  await auditService.record(auth, {
    action: `property.verification_${entry.action}`,
    entityType: 'property',
    entityId: updated._id,
    entityLabel: updated.propertyId,
    changes: [{ field: 'verification.status', oldValue: p.verification?.status ?? 'NOT_SUBMITTED', newValue: entry.status }],
    meta: entry.remarks ? { remarks: entry.remarks } : undefined,
    ip: meta.ip,
  });
  publishChange(auth, SOCKET_EVENTS.PROPERTY_UPDATED, 'property', updated);
  return updated;
}

export const verificationService = {
  /** Status, checklist, history and which required documents are still missing. */
  async get(ctx: TenantContext, propertyId: string) {
    const p = await propertyRepository.getById(ctx, propertyId, 'Property not found');
    const v = current(p);
    const docs = await Document.find({ businessId: ctx.businessId, entityType: 'property', entityId: p._id, deletedAt: null }).select('category expiresAt fileName').lean<{ category?: string; expiresAt?: Date | null; fileName: string }[]>();
    const have = new Set(docs.map((d) => d.category));
    const missing = VERIFICATION_CHECKLIST.filter((c) => c.documents?.length && !c.documents.some((d) => have.has(d))).map((c) => c.key);
    const now = Date.now();
    const expiring = docs.filter((d) => d.expiresAt && +new Date(d.expiresAt) - now < 30 * 86_400_000).map((d) => ({ fileName: d.fileName, category: d.category, expiresAt: d.expiresAt }));
    return { ...v, missingDocuments: missing, expiringDocuments: expiring };
  },

  async submit(auth: AuthContext, propertyId: string, note?: string, meta: RequestMeta = {}) {
    const p = await propertyRepository.getById(auth, propertyId, 'Property not found');
    const v = current(p);
    if (OPEN.includes(v.status) && v.status !== 'CHANGES_REQUESTED') return p;
    const next: PropertyVerification = { ...v, status: 'PENDING', submittedBy: new Types.ObjectId(auth.userId), submittedAt: new Date(), decision: null };
    const updated = await save(auth, p, next, { status: 'PENDING', remarks: note, action: 'submitted' }, meta);
    await activityService.record(auth, 'VERIFICATION_SUBMITTED', `${p.propertyId} submitted for verification${note ? `: ${note}` : ''}`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }]);
    const officers = (await memberRepository.activeUserIdsWithPermission(auth, PERMISSIONS.VERIFICATION_DECIDE)).filter((u) => u !== auth.userId);
    await notificationService.notify(auth, {
      userIds: v.assignedTo ? [v.assignedTo.toString()] : officers,
      category: 'PROPERTY',
      title: 'Verification requested',
      body: `${p.propertyId}${p.society ? ` (${p.society})` : ''} is waiting for verification.`,
      deepLink: `/properties/${p._id}?tab=verification`,
    });
    return updated;
  },

  async assign(auth: AuthContext, propertyId: string, userId: string, meta: RequestMeta = {}) {
    const p = await propertyRepository.getById(auth, propertyId, 'Property not found');
    if (!(await memberRepository.activeUserIdsWithPermission(auth, PERMISSIONS.VERIFICATION_DECIDE)).includes(userId)) {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Assign verification to a member who can approve verifications');
    }
    const v = current(p);
    const status: VerificationStatus = v.status === 'NOT_SUBMITTED' ? 'PENDING' : v.status === 'PENDING' ? 'IN_REVIEW' : v.status;
    const updated = await save(auth, p, { ...v, status, assignedTo: new Types.ObjectId(userId) }, { status, action: 'assigned' }, meta);
    await activityService.record(auth, 'VERIFICATION_ASSIGNED', `${p.propertyId} verification assigned`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }], { to: userId });
    if (userId !== auth.userId) {
      await notificationService.notify(auth, { userIds: [userId], category: 'PROPERTY', title: 'Verification assigned to you', body: `Please verify ${p.propertyId}.`, deepLink: `/properties/${p._id}?tab=verification` });
    }
    return updated;
  },

  async setChecklistItem(auth: AuthContext, propertyId: string, key: string, done: boolean, note?: string) {
    const p = await propertyRepository.getById(auth, propertyId, 'Property not found');
    const v = current(p);
    if (!v.checklist.some((c) => c.key === key)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Unknown checklist item');
    const checklist = v.checklist.map((c) =>
      c.key === key ? { ...c, done, note: note ?? c.note ?? null, doneBy: done ? new Types.ObjectId(auth.userId) : null, doneAt: done ? new Date() : null } : c,
    );
    const status: VerificationStatus = v.status === 'PENDING' ? 'IN_REVIEW' : v.status;
    const updated = await propertyRepository.update(auth, propertyId, { verification: { ...v, status, checklist } });
    publishChange(auth, SOCKET_EVENTS.PROPERTY_UPDATED, 'property', updated);
    return updated;
  },

  /** Approve / reject / send back. Approval stamps the listing as verified and schedules the next check. */
  async decide(auth: AuthContext, propertyId: string, decision: VerificationDecision, remarks?: string, nextVerificationAt?: Date | null, meta: RequestMeta = {}) {
    if (!auth.permissions.includes(PERMISSIONS.VERIFICATION_DECIDE)) throw forbidden();
    const p = await propertyRepository.getById(auth, propertyId, 'Property not found');
    const v = current(p);
    if (!OPEN.includes(v.status)) throw badRequest(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Submit the property for verification first');
    if (decision !== 'APPROVED' && !remarks?.trim()) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Add remarks explaining the decision');
    if (decision === 'APPROVED' && v.submittedBy && String(v.submittedBy) === auth.userId && !auth.permissions.includes(PERMISSIONS.MEMBERS_MANAGE)) {
      // Four-eyes: the person who submitted cannot approve their own listing (owners/admins excepted).
      throw forbidden(ERROR_CODES.FORBIDDEN, 'Another member must approve a verification you submitted');
    }
    const now = new Date();
    const next: PropertyVerification = {
      ...v,
      status: decision,
      decision,
      remarks: remarks ?? null,
      verifiedBy: decision === 'APPROVED' ? new Types.ObjectId(auth.userId) : v.verifiedBy ?? null,
      verifiedAt: decision === 'APPROVED' ? now : v.verifiedAt ?? null,
      nextVerificationAt: decision === 'APPROVED' ? (nextVerificationAt ?? new Date(now.getTime() + DEFAULT_REVERIFY_DAYS * 86_400_000)) : v.nextVerificationAt ?? null,
    };
    const updated = await save(auth, p, next, { status: decision, remarks, action: decision.toLowerCase() }, meta);
    if (decision === 'APPROVED') {
      await Property.updateOne({ _id: p._id, businessId: auth.businessId }, { $set: { lastVerifiedAt: now, lastVerifiedBy: auth.userId } });
    }
    await activityService.record(auth, 'VERIFICATION_DECIDED', `${p.propertyId} verification ${decision.toLowerCase().replace('_', ' ')}${remarks ? `: ${remarks}` : ''}`, [{ entityType: 'property', entityId: p._id, label: p.propertyId }], { decision });
    const notify = [v.submittedBy, ...(p.agentIds ?? []), p.createdBy].filter(Boolean).map(String).filter((u) => u !== auth.userId);
    await notificationService.notify(auth, {
      userIds: [...new Set(notify)],
      category: 'PROPERTY',
      title: `Verification ${decision === 'APPROVED' ? 'approved' : decision === 'REJECTED' ? 'rejected' : 'sent back'}`,
      body: `${p.propertyId}${remarks ? `: ${remarks}` : ''}`,
      deepLink: `/properties/${p._id}?tab=verification`,
    });
    return (await propertyRepository.findById(auth, propertyId)) ?? updated;
  },

  /** Verification queue (open items first, then upcoming re-verifications). */
  async queue(auth: AuthContext, q: { status?: VerificationStatus; mine?: boolean; page: number; limit: number }) {
    const filter: Record<string, unknown> = { businessId: auth.businessId, deletedAt: null, ...branchFilter(auth) };
    filter['verification.status'] = q.status ?? { $in: OPEN };
    if (q.mine) filter['verification.assignedTo'] = new Types.ObjectId(auth.userId);
    const [items, total] = await Promise.all([
      Property.find(filter)
        .select('propertyId propertyType society block plotNumber askingPrice status verification.status verification.assignedTo verification.submittedAt verification.nextVerificationAt coverThumbnailUrl')
        .sort({ 'verification.submittedAt': 1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Property.countDocuments(filter),
    ]);
    return { items, total };
  },
};
