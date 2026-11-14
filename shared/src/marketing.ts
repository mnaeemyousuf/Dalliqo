/**
 * Marketing: the agency website, website inquiries, campaigns and their return on spend,
 * client / owner portal links and WhatsApp Business messaging.
 */

export const CAMPAIGN_CHANNELS = ['FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'YOUTUBE', 'TIKTOK', 'PORTAL', 'WHATSAPP', 'SMS', 'EMAIL', 'PRINT', 'BILLBOARD', 'EVENT', 'REFERRAL', 'OTHER'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'SPAM'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const PORTAL_KINDS = ['CLIENT', 'OWNER'] as const;
export type PortalKind = (typeof PORTAL_KINDS)[number];

/** Default and maximum life of a portal link, in days. */
export const PORTAL_LINK_DAYS = { default: 30, max: 365 } as const;

export interface CampaignFigures {
  spend: number;
  leads: number;
  /** Leads that became clients with a deal closed as won. */
  won: number;
  /** Commission actually received on those won deals. */
  revenue: number;
}

export interface CampaignMetrics extends CampaignFigures {
  costPerLead: number | null;
  conversionPct: number | null;
  costPerWin: number | null;
  /** (revenue − spend) / spend × 100; null when nothing was spent. */
  roiPct: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function campaignMetrics(f: CampaignFigures): CampaignMetrics {
  return {
    ...f,
    costPerLead: f.leads > 0 ? Math.round(f.spend / f.leads) : null,
    conversionPct: f.leads > 0 ? r1((f.won / f.leads) * 100) : null,
    costPerWin: f.won > 0 ? Math.round(f.spend / f.won) : null,
    roiPct: f.spend > 0 ? r1(((f.revenue - f.spend) / f.spend) * 100) : null,
  };
}

/** URL-safe slug: lower case latin letters, digits and dashes (3–60 chars once trimmed). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** Slugs that would clash with app routes or look official. */
export const RESERVED_SLUGS = ['admin', 'api', 'app', 'dalliqo', 'login', 'portal', 'support', 'help', 'www', 'static', 'assets'];

/** wa.me link (digits only, no plus) with an optional pre-filled message. */
export function whatsappLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
