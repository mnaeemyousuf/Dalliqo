import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { ALL_PERMISSIONS, ROLES } from '@recrm/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { BusinessMember } from '../models/BusinessMember';
import { Client } from '../models/Client';
import { FollowUp } from '../models/FollowUp';
import { Inquiry, type InquiryDoc } from '../models/Inquiry';
import { Property, type PropertyDoc } from '../models/Property';
import type { BusinessDoc } from '../models/Business';
import type { AuthContext } from '../types/context';
import { normalizePhone } from '../utils/phone';
import { activityService } from './activityService';
import { clientService } from './clientService';
import { followUpService } from './followUpService';
import { mailService } from './mailService';
import { notificationService } from './notificationService';

/**
 * Acting identity for work done on behalf of a business with no signed-in user (website
 * inquiries, WhatsApp webhooks, portal requests). Records are attributed to the owner.
 */
export function systemAuth(business: Pick<BusinessDoc, '_id' | 'ownerUserId'>): AuthContext {
  return {
    businessId: String(business._id),
    userId: String(business.ownerUserId),
    memberId: '',
    sessionId: 'system',
    role: ROLES.OWNER,
    permissions: [...ALL_PERMISSIONS],
    mustChangePassword: false,
  };
}

export const hashIp = (ip?: string) => (ip ? createHash('sha256').update(`${env.JWT_SECRET}:${ip}`).digest('hex').slice(0, 32) : null);

export interface IntakeInput {
  channel: 'WEBSITE' | 'WHATSAPP';
  name: string;
  phone: string;
  email?: string | null;
  message?: string | null;
  propertyId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  ip?: string;
  externalId?: string | null;
}

async function activeMember(businessId: string, userId?: Types.ObjectId | string | null) {
  if (!userId) return null;
  const m = await BusinessMember.findOne({ businessId, userId, status: 'ACTIVE' }).select('userId').lean();
  return m ? String(m.userId) : null;
}

/**
 * Turns an inbound message (website form, WhatsApp) into a lead: matches an existing client by
 * phone or creates one, assigns it to the listing's agent, schedules a call-back follow-up,
 * notifies the assignee and keeps the raw inquiry for reporting.
 */
export async function intakeLead(business: BusinessDoc, input: IntakeInput): Promise<InquiryDoc> {
  const ctx = systemAuth(business);
  if (input.externalId) {
    const seen = await Inquiry.findOne({ businessId: business._id, externalId: input.externalId }).lean<InquiryDoc>();
    if (seen) return seen;
  }
  const phone = normalizePhone(input.phone) ?? input.phone.trim();
  const property: PropertyDoc | null = input.propertyId && Types.ObjectId.isValid(input.propertyId)
    ? await Property.findOne({ businessId: business._id, _id: input.propertyId, deletedAt: null }).lean<PropertyDoc>()
    : null;
  const listingAgent = await activeMember(ctx.businessId, property?.agentIds?.[0]);

  const [existing] = await clientService.findDuplicates(ctx, [phone]);
  let clientId: string;
  let assignee: string | null;
  let createdLead = false;
  const what = property ? `${property.propertyId}${property.society ? ` (${[property.block, property.society].filter(Boolean).join(', ')})` : ''}` : 'general inquiry';
  if (existing) {
    clientId = String(existing._id);
    const full = await Client.findOne({ businessId: business._id, _id: existing._id }).select('assignedTo campaignId').lean();
    assignee = (await activeMember(ctx.businessId, full?.assignedTo as never)) ?? listingAgent;
    if (input.campaignId && !full?.campaignId) await Client.updateOne({ businessId: business._id, _id: existing._id }, { $set: { campaignId: input.campaignId, campaign: input.campaignName ?? undefined } });
  } else {
    const client = await clientService.create(ctx, {
      fullName: input.name.trim().slice(0, 120),
      mobileNumber: phone,
      email: input.email ?? undefined,
      source: input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEBSITE',
      assignedTo: listingAgent ?? undefined,
      notes: input.message ?? undefined,
      campaign: input.campaignName ?? undefined,
      allowDuplicate: true,
      ...(property
        ? {
            purchaseOrRental: property.listingPurpose === 'RENT' ? 'RENTAL' : 'PURCHASE',
            propertyTypeRequired: [property.propertyType],
            preferredSociety: property.society,
            maxBudget: property.askingPrice ? Math.round(property.askingPrice * 1.1) : undefined,
          }
        : {}),
    });
    clientId = String(client._id);
    assignee = listingAgent;
    createdLead = true;
    if (input.campaignId) await Client.updateOne({ businessId: business._id, _id: client._id }, { $set: { campaignId: input.campaignId } });
  }

  const label = input.channel === 'WHATSAPP' ? 'WhatsApp message' : 'Website inquiry';
  const refs = [{ entityType: 'client' as const, entityId: clientId, label: input.name }, ...(property ? [{ entityType: 'property' as const, entityId: property._id, label: property.propertyId }] : [])];
  await activityService.record(ctx, input.channel === 'WHATSAPP' ? 'WHATSAPP_RECEIVED' : 'WEBSITE_INQUIRY', `${label} from ${input.name} about ${what}${input.message ? `: “${input.message.slice(0, 200)}”` : ''}`, refs);

  // A call-back within the hour, owned by the assignee (or the owner while nobody is assigned) —
  // unless one is already waiting, so repeat messages don't pile up follow-ups.
  const pending = await FollowUp.exists({ businessId: business._id, clientId, status: 'PENDING', deletedAt: null });
  if (!pending) try {
    await followUpService.create(ctx, {
      clientId,
      propertyId: property ? String(property._id) : null,
      type: input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'CALL',
      dueAt: new Date(Date.now() + 60 * 60_000),
      priority: 'HIGH',
      notes: `${label}: ${input.message ?? what}`.slice(0, 1000),
      assignedTo: assignee ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, 'Could not schedule the inquiry follow-up');
  }

  const managers = await BusinessMember.find({ businessId: business._id, status: 'ACTIVE', permissions: 'clients:update', role: { $in: ['OWNER', 'ADMIN', 'MANAGER', 'SALES_MANAGER', 'MARKETING_MANAGER', 'BRANCH_MANAGER'] } }).select('userId').limit(20).lean();
  await notificationService.notify(ctx, {
    userIds: assignee ? [assignee] : [String(business.ownerUserId), ...managers.map((m) => String(m.userId))],
    category: 'LEAD',
    title: `New ${label.toLowerCase()}`,
    body: `${input.name} (${phone}) — ${what}`,
    deepLink: `/clients/${clientId}`,
    data: { clientId },
  });

  const inquiry = await Inquiry.create({
    businessId: business._id,
    channel: input.channel,
    propertyId: property?._id ?? null,
    campaignId: input.campaignId ?? null,
    clientId,
    createdLead,
    name: input.name.trim().slice(0, 120),
    phone,
    email: input.email ?? null,
    message: input.message ?? null,
    assignedTo: assignee,
    ipHash: hashIp(input.ip),
    externalId: input.externalId ?? null,
    createdBy: business.ownerUserId,
    updatedBy: business.ownerUserId,
  });
  if (property) await Property.updateOne({ businessId: business._id, _id: property._id }, { $inc: { 'publicListing.inquiries': 1 } });

  if (input.email && input.channel === 'WEBSITE') {
    const contact = [business.website?.phone ?? business.phone, business.website?.email ?? business.email].filter(Boolean).join(' · ');
    mailService
      .send({
        to: input.email,
        subject: `We received your inquiry — ${business.name}`,
        text: `Dear ${input.name},\n\nThank you for contacting ${business.name} about ${what}. One of our team will call you shortly.\n\n${contact ? `You can also reach us at ${contact}.\n\n` : ''}${business.name}`,
      })
      .catch((err) => logger.warn({ err }, 'Inquiry acknowledgement email failed'));
  }
  return inquiry.toObject();
}
