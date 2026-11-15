import { z } from 'zod';
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, INQUIRY_STATUSES, LISTING_PURPOSES, PORTAL_KINDS, PORTAL_LINK_DAYS, PROPERTY_TYPES } from '@recrm/shared';
import { email, objectId, pagination, phone } from './common';

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable().optional().transform((v) => (v === '' ? null : v));
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const money = z.coerce.number().int().min(0).max(1e12);

export const websiteSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    slug: z.string().trim().toLowerCase().max(60).nullable().optional(),
    tagline: nullableText(160),
    about: nullableText(3000),
    phone: phone.nullable().optional(),
    whatsapp: phone.nullable().optional(),
    email: email.nullable().optional(),
    showAgents: z.boolean().optional(),
  })
  .strict();

export const publishSchema = z.object({ published: z.boolean(), headline: nullableText(120) }).strict();

export const inquiryListQuery = pagination.extend({ status: z.enum(INQUIRY_STATUSES).optional(), propertyId: objectId.optional(), campaignId: objectId.optional() });
export const inquiryStatusSchema = z.object({ status: z.enum(INQUIRY_STATUSES) }).strict();

const campaignFields = {
  name: text(120).min(2),
  channel: z.enum(CAMPAIGN_CHANNELS),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 letters, digits or dashes').optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  budget: money.optional(),
  spend: money.optional(),
  notes: nullableText(2000),
};
export const campaignCreateSchema = z.object(campaignFields).strict();
export const campaignUpdateSchema = z.object(campaignFields).partial().strict();
export const campaignListQuery = pagination.extend({ status: z.enum(CAMPAIGN_STATUSES).optional() });

export const portalLinkSchema = z.object({ kind: z.enum(PORTAL_KINDS), partyId: objectId, days: z.coerce.number().int().min(1).max(PORTAL_LINK_DAYS.max).optional() }).strict();
export const portalLinkListQuery = z.object({ kind: z.enum(PORTAL_KINDS), partyId: objectId });

export const whatsappSettingsSchema = z
  .object({
    phoneNumberId: z.string().trim().regex(/^\d{6,30}$/, 'The phone number id is a long number from Meta').nullable().optional(),
    businessAccountId: z.string().trim().regex(/^\d{6,30}$/, 'The business account id is a long number from Meta').nullable().optional(),
    displayNumber: phone.nullable().optional(),
  })
  .strict();
export const whatsappSendSchema = z
  .object({
    to: phone,
    text: text(4096).min(1),
    clientId: objectId.optional(),
    /** Send an approved template instead of free text (works outside the 24-hour window). */
    template: z.object({ name: z.string().trim().min(1).max(512), language: z.string().trim().min(2).max(15), params: z.array(text(1000)).max(20).default([]) }).strict().optional(),
  })
  .strict();

// ── Public ──
export const slugParams = z.object({ slug: z.string().trim().toLowerCase().max(60) });
export const slugIdParams = slugParams.extend({ id: z.string().max(40) });
export const publicListingQuery = z.object({
  q: text(80).optional(),
  purpose: z.enum(LISTING_PURPOSES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  minPrice: money.optional(),
  maxPrice: money.optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  agentId: objectId.optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});
export const publicInquirySchema = z
  .object({
    name: text(120).min(2, 'Please enter your name'),
    phone,
    email: email.optional().or(z.literal('').transform(() => undefined)),
    message: text(2000).optional(),
    propertyId: objectId.optional(),
    campaign: z.string().trim().toLowerCase().max(40).optional(),
    /** Honeypot (hidden field). */
    website: z.string().max(200).optional(),
  })
  .strict();
export const tokenParams = z.object({ token: z.string().min(30).max(80) });
export const portalReceiptParams = tokenParams.extend({ kind: z.enum(['lease', 'installment', 'deal']), id: z.string().max(40), paymentId: z.string().min(8).max(64) });
export const portalRequestSchema = z.object({ message: text(1000).min(2) }).strict();
export const portalSettingsSchema = z
  .object({ showMatches: z.boolean(), allowPreferenceUpdates: z.boolean(), allowVisitRequests: z.boolean(), showDocuments: z.boolean(), showOwnerInquiries: z.boolean(), showOwnerOffers: z.boolean(), allowOwnerAvailabilityUpdates: z.boolean() })
  .partial()
  .strict();
export const portalPreferencesSchema = z
  .object({
    minBudget: z.coerce.number().int().min(0).max(1e12).nullable().optional(),
    maxBudget: z.coerce.number().int().min(0).max(1e12).nullable().optional(),
    societies: z.array(text(120)).max(10).optional(),
    bedroomsMin: z.coerce.number().int().min(0).max(20).nullable().optional(),
    notes: text(1000).nullable().optional(),
  })
  .strict();
export const portalMatchParams = tokenParams.extend({ matchId: z.string().max(40) });
export const portalReactionSchema = z.object({ reaction: z.enum(['FAVORITE', 'UNFAVORITE', 'NOT_INTERESTED']) }).strict();
export const portalVisitSchema = z.object({ propertyId: z.string().max(40), preferredAt: z.coerce.date(), note: text(500).optional() }).strict();
export const portalPropertyParams = tokenParams.extend({ propertyId: z.string().max(40) });
export const portalAvailabilitySchema = z.object({ available: z.boolean(), askingPrice: z.coerce.number().int().min(1).max(1e12).nullable().optional(), note: text(500).optional() }).strict();
export const portalDocParams = tokenParams.extend({ docId: z.string().max(40) });
export const emailPrefsSchema = z.object({ emailNotifications: z.boolean() }).strict();
export { bool };
