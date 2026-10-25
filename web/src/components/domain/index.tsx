import clsx from 'clsx';
import { AlertTriangle, BadgeCheck, CalendarPlus, Check, Home, MapPin, MessageCircle, Phone, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LISTING_VERIFICATION_STALE_DAYS, type MatchBand, type PropertyStatus } from '@recrm/shared';
import { clientApi } from '@/api/endpoints';
import type { Client, Match, Property } from '@/api/types';
import { Badge, type BadgeColor } from '@/components/ui';
import { formatPkr, formatRange, relativeTime, telHref, waHref } from '@/lib/format';

export const STATUS_COLOR: Record<PropertyStatus, BadgeColor> = {
  AVAILABLE: 'green',
  RESERVED: 'amber',
  SOLD: 'blue',
  RENTED: 'purple',
  WITHDRAWN: 'gray',
  INACTIVE: 'gray',
};

export const BAND_COLOR: Record<MatchBand, BadgeColor> = { EXCELLENT: 'green', VERY_GOOD: 'blue', GOOD: 'purple', POSSIBLE: 'amber', LOW: 'gray' };

export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  const { t } = useTranslation();
  return <Badge color={STATUS_COLOR[status]}>{t(`enums.propertyStatus.${status}`)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation();
  const color: Record<string, BadgeColor> = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' };
  return <Badge color={color[priority] ?? 'gray'}>{t(`enums.priority.${priority}`)}</Badge>;
}

export function ScoreBadge({ score, band }: { score: number; band: MatchBand }) {
  const { t } = useTranslation();
  return <Badge color={BAND_COLOR[band]}>{t('match.percentMatch', { score })}</Badge>;
}

export function useSizeLabel() {
  const { t } = useTranslation();
  return (size?: number, unit?: string) => (size ? `${size} ${t(`enums.sizeUnit.${unit}`)}` : '—');
}

export function locationLabel(p: Pick<Property, 'society' | 'area' | 'block'>) {
  return [p.block, p.society ?? p.area].filter(Boolean).join(', ') || '—';
}

/** Card from the spec: image, ID, size + type, location, price, status, match count. */
/** An available listing nobody has re-confirmed with the owner recently. */
export function isListingStale(p: Pick<Property, 'status' | 'lastVerifiedAt'>): boolean {
  if (p.status !== 'AVAILABLE') return false;
  if (!p.lastVerifiedAt) return true;
  return Date.now() - new Date(p.lastVerifiedAt).getTime() > LISTING_VERIFICATION_STALE_DAYS * 86_400_000;
}

export function VerificationBadge({ property, showFresh = false }: { property: Pick<Property, 'status' | 'lastVerifiedAt'>; showFresh?: boolean }) {
  const { t } = useTranslation();
  if (isListingStale(property)) {
    return (
      <Badge color="amber" className="inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {t('property.needsVerification')}
      </Badge>
    );
  }
  if (!showFresh || !property.lastVerifiedAt) return null;
  return (
    <Badge color="green" className="inline-flex items-center gap-1">
      <BadgeCheck className="h-3 w-3" /> {t('property.verifiedAgo', { time: relativeTime(property.lastVerifiedAt) })}
    </Badge>
  );
}

/** Plain-text summary used when sharing a property on WhatsApp or elsewhere. */
export function usePropertyShareText() {
  const { t } = useTranslation();
  const size = useSizeLabel();
  return (p: Pick<Property, 'propertyId' | 'size' | 'sizeUnit' | 'propertyType' | 'listingPurpose' | 'askingPrice' | 'block' | 'society' | 'area'> & { latitude?: number; longitude?: number; googleMapsUrl?: string }) => {
    const map = p.googleMapsUrl ?? (p.latitude != null && p.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}` : '');
    return [
      `${p.propertyId} · ${size(p.size, p.sizeUnit)} ${t(`enums.propertyType.${p.propertyType}`)} (${t(`enums.listingPurpose.${p.listingPurpose}`)})`,
      `${locationLabel(p as Property)} · ${formatPkr(p.askingPrice)}`,
      map,
    ]
      .filter(Boolean)
      .join('\n');
  };
}

export function PropertyCard({ property }: { property: Property }) {
  const { t } = useTranslation();
  const size = useSizeLabel();
  return (
    <Link to={`/properties/${property._id}`} className="card group overflow-hidden transition hover:shadow-md">
      <div className="relative aspect-[16/10] bg-canvas">
        {property.coverThumbnailUrl || property.coverImageUrl ? (
          <img src={property.coverThumbnailUrl ?? property.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Home className="h-10 w-10" />
          </div>
        )}
        <span className="absolute start-2 top-2">
          <Badge color="gray" className="!bg-white/90 !text-slate-800">{t(`enums.listingPurpose.${property.listingPurpose}`)}</Badge>
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="ltr-nums text-xs font-semibold text-brand-600">{property.propertyId}</p>
        <p className="font-medium">
          {size(property.size, property.sizeUnit)} {t(`enums.propertyType.${property.propertyType}`)}
        </p>
        <p className="flex items-center gap-1 text-sm text-muted">
          <MapPin className="h-3.5 w-3.5" /> {locationLabel(property)}
        </p>
        <p className="pt-1 text-lg font-semibold">{formatPkr(property.askingPrice)}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="flex flex-wrap items-center gap-1">
            <PropertyStatusBadge status={property.status} />
            <VerificationBadge property={property} />
          </span>
          <span className="text-xs text-muted">{t('property.matches', { count: property.matchCount })}</span>
        </div>
      </div>
    </Link>
  );
}

export function ContactActions({ phone, whatsapp, onContact, compact }: { phone?: string; whatsapp?: string; onContact?(channel: 'CALL' | 'WHATSAPP'): void; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <a href={telHref(phone)} onClick={() => onContact?.('CALL')} className="btn-secondary !px-2 !py-1.5" title={t('client.call')}>
        <Phone className="h-4 w-4" />
        {!compact && <span className="text-xs">{t('client.call')}</span>}
      </a>
      <a href={waHref(whatsapp ?? phone)} target="_blank" rel="noreferrer" onClick={() => onContact?.('WHATSAPP')} className="btn-secondary !px-2 !py-1.5 text-emerald-600" title="WhatsApp">
        <MessageCircle className="h-4 w-4" />
        {!compact && <span className="text-xs">WhatsApp</span>}
      </a>
    </div>
  );
}

export function ClientCard({ client, categoryName, onFollowUp }: { client: Client; categoryName?: string; onFollowUp?(): void }) {
  const { t } = useTranslation();
  return (
    <div className="card space-y-2 p-4">
      <Link to={`/clients/${client._id}`} className="block">
        <p className="font-semibold">{client.fullName}</p>
        <p className="text-sm text-muted">{categoryName ?? '—'}</p>
      </Link>
      <p className="flex items-center gap-1 text-sm">
        <MapPin className="h-3.5 w-3.5 text-muted" /> {client.preferredSociety ?? client.preferredArea ?? '—'}
      </p>
      <p className="text-sm">
        {t('client.budget')}: {formatRange(client.minBudget, client.maxBudget)}
      </p>
      <p className="text-sm font-medium text-brand-600">{t('client.matchingProperties', { count: client.matchCount })}</p>
      <div className="flex items-center justify-between pt-1">
        <ContactActions phone={client.mobileNumber} whatsapp={client.whatsappNumber} compact />
        {onFollowUp && (
          <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={onFollowUp}>
            <CalendarPlus className="h-4 w-4" /> {t('followup.single')}
          </button>
        )}
      </div>
    </div>
  );
}

export function MatchReasons({ match }: { match: Match }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {match.matchReasons
        .filter((r) => !r.code.endsWith('_ANY'))
        .map((r) => (
          <li key={r.code} className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> {t(`enums.matchReason.${r.code}`, r.params)}
          </li>
        ))}
    </ul>
  );
}

/** "95% Match · 120 Sq. Yard Plot · Gulshan-e-Iqbal · PKR 1.55 Crore · ✓ Budget ✓ Area…" */
export function MatchCard({ match, perspective, actions }: { match: Match; perspective: 'client' | 'property'; actions?: ReactNode }) {
  const { t } = useTranslation();
  const size = useSizeLabel();
  const p = match.propertyId;
  const c = match.clientId;
  const shareText = usePropertyShareText();
  // Sends the matched property to the client's WhatsApp with a pre-filled message
  // (the user still presses Send in WhatsApp) and logs the contact on the timeline.
  const sendProperty = () => {
    const text = t('match.shareMessage', { name: c.fullName, details: shareText(p) });
    window.open(waHref(c.whatsappNumber ?? c.mobileNumber, text), '_blank', 'noopener');
    void clientApi.communicate(c._id, 'WHATSAPP', `Shared ${p.propertyId}`).catch(() => undefined);
  };
  return (
    <div className={clsx('card flex flex-col gap-3 p-4 sm:flex-row sm:items-center', match.status === 'STALE' && 'opacity-60')}>
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <ScoreBadge score={match.matchScore} band={match.band} />
          <Badge>{t(`enums.matchStatus.${match.status}`)}</Badge>
        </div>
        {perspective === 'client' ? (
          <Link to={`/properties/${p._id}`} className="block hover:underline">
            <span className="font-medium">
              {size(p.size, p.sizeUnit)} {t(`enums.propertyType.${p.propertyType}`)}
            </span>{' '}
            <span className="ltr-nums text-xs text-muted">{p.propertyId}</span>
            <span className="block text-sm text-muted">
              {locationLabel(p)} · {formatPkr(p.askingPrice)}
            </span>
          </Link>
        ) : (
          <Link to={`/clients/${c._id}`} className="block font-medium hover:underline">
            {c.fullName} <span className="ltr-nums text-xs text-muted">{c.mobileNumber}</span>
          </Link>
        )}
        <MatchReasons match={match} />
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={sendProperty} className="btn-secondary !px-2 !py-1.5 text-emerald-600" title={t('match.sendProperty')} aria-label={t('match.sendProperty')}>
          <Send className="h-4 w-4" />
        </button>
        <ContactActions phone={c.mobileNumber} whatsapp={c.whatsappNumber} compact />
        {actions}
      </div>
    </div>
  );
}

export function Stat({ label, value, icon, tone = 'brand', to }: { label: string; value: ReactNode; icon?: ReactNode; tone?: 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'purple'; to?: string }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    purple: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  };
  const body = (
    <div className="card flex h-full items-center gap-3 p-4 transition hover:shadow-md">
      {icon && <div className={clsx('rounded-lg p-2.5', tones[tone])}>{icon}</div>}
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="ltr-nums text-2xl font-semibold">{value}</p>
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

