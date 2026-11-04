import clsx from 'clsx';
import { AlertTriangle, ArrowUpRight, BadgeCheck, CalendarPlus, Check, Home, MapPin, MessageCircle, Phone, Send, Sparkle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LISTING_VERIFICATION_STALE_DAYS, type MatchBand, type PropertyStatus } from '@recrm/shared';
import { clientApi } from '@/api/endpoints';
import type { Client, Match, Property } from '@/api/types';
import { Avatar, Badge, type BadgeColor } from '@/components/ui';
import { useCountUp } from '@/lib/hooks';
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
  const img = property.coverThumbnailUrl ?? property.coverImageUrl;
  return (
    <Link to={`/properties/${property._id}`} className="card card-interactive group block overflow-hidden">
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
        {img ? (
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-50 to-surface-2 text-brand-600/40">
            <Home className="h-10 w-10" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/50 to-transparent" />
        <span className="absolute start-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-bold uppercase tracking-wide text-slate-800 shadow-xs backdrop-blur">
          {t(`enums.listingPurpose.${property.listingPurpose}`)}
        </span>
        <span className="absolute bottom-3 start-3 rounded-lg bg-white/95 px-2.5 py-1 text-sm font-bold tracking-tight text-slate-900 shadow-card backdrop-blur ltr-nums">
          {formatPkr(property.askingPrice)}
        </span>
      </div>
      <div className="space-y-1.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="ltr-nums text-xs font-bold tracking-wide text-brand-600">{property.propertyId}</p>
          <PropertyStatusBadge status={property.status} />
        </div>
        <p className="truncate font-semibold tracking-tight text-ink">
          {size(property.size, property.sizeUnit)} {t(`enums.propertyType.${property.propertyType}`)}
        </p>
        <p className="flex items-center gap-1 truncate text-sm text-muted">
          <MapPin className="h-3.5 w-3.5 shrink-0" /> {locationLabel(property)}
        </p>
        <div className="flex items-center justify-between gap-2 pt-1.5">
          <VerificationBadge property={property} />
          <span className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-muted">
            <Sparkle className="h-3 w-3 text-brand-500" />
            {t('property.matches', { count: property.matchCount })}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ContactActions({ phone, whatsapp, onContact, compact }: { phone?: string; whatsapp?: string; onContact?(channel: 'CALL' | 'WHATSAPP'): void; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <a href={telHref(phone)} onClick={() => onContact?.('CALL')} className={clsx('btn-secondary !h-8', compact ? '!w-8 !px-0' : '!px-2.5')} title={t('client.call')} aria-label={t('client.call')}>
        <Phone className="h-4 w-4" />
        {!compact && <span className="text-xs">{t('client.call')}</span>}
      </a>
      <a
        href={waHref(whatsapp ?? phone)}
        target="_blank"
        rel="noreferrer"
        onClick={() => onContact?.('WHATSAPP')}
        className={clsx('btn-secondary !h-8 text-emerald-600 hover:!border-emerald-300 hover:!bg-emerald-50 dark:hover:!bg-emerald-500/10', compact ? '!w-8 !px-0' : '!px-2.5')}
        title="WhatsApp"
        aria-label="WhatsApp"
      >
        <MessageCircle className="h-4 w-4" />
        {!compact && <span className="text-xs">WhatsApp</span>}
      </a>
    </div>
  );
}

export function ClientCard({ client, categoryName, onFollowUp }: { client: Client; categoryName?: string; onFollowUp?(): void }) {
  const { t } = useTranslation();
  return (
    <div className="card card-interactive flex flex-col gap-3 p-4">
      <Link to={`/clients/${client._id}`} className="flex items-center gap-3">
        <Avatar name={client.fullName} />
        <span className="min-w-0">
          <span className="block truncate font-semibold tracking-tight text-ink">{client.fullName}</span>
          <span className="block truncate text-xs text-muted">{categoryName ?? '—'}</span>
        </span>
      </Link>
      <div className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-sm">
        <p className="flex items-center gap-1.5 truncate text-ink-2">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-subtle" /> {client.preferredSociety ?? client.preferredArea ?? '—'}
        </p>
        <p className="ltr-nums truncate font-semibold text-ink">{formatRange(client.minBudget, client.maxBudget)}</p>
      </div>
      <p className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
        <Sparkle className="h-3 w-3" /> {t('client.matchingProperties', { count: client.matchCount })}
      </p>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
        <ContactActions phone={client.mobileNumber} whatsapp={client.whatsappNumber} compact />
        {onFollowUp && (
          <button className="btn-ghost !h-8 !px-2.5 text-xs" onClick={onFollowUp}>
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
    <ul className="flex flex-wrap gap-1.5 text-xs">
      {match.matchReasons
        .filter((r) => !r.code.endsWith('_ANY'))
        .map((r) => (
          <li key={r.code} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check className="h-3 w-3" /> {t(`enums.matchReason.${r.code}`, r.params)}
          </li>
        ))}
    </ul>
  );
}

/** Circular score gauge for a match. */
function ScoreRing({ score }: { score: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? 'text-emerald-500' : score >= 70 ? 'text-brand-500' : score >= 60 ? 'text-violet-500' : 'text-amber-500';
  return (
    <div className="relative h-12 w-12 shrink-0">
      <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-line" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className={clsx('stroke-current transition-[stroke-dashoffset] duration-700 ease-out', color)}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, score) / 100)}
        />
      </svg>
      <span className="ltr-nums absolute inset-0 flex items-center justify-center text-xs font-bold text-ink">{score}</span>
    </div>
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
    <div className={clsx('card flex flex-col gap-4 p-4 transition hover:border-line-strong hover:shadow-lift sm:flex-row sm:items-center', match.status === 'STALE' && 'opacity-60')}>
      <ScoreRing score={match.matchScore} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ScoreBadge score={match.matchScore} band={match.band} />
          <Badge dot={false}>{t(`enums.matchStatus.${match.status}`)}</Badge>
        </div>
        {perspective === 'client' ? (
          <Link to={`/properties/${p._id}`} className="block">
            <span className="font-semibold tracking-tight text-ink hover:text-brand-600">
              {size(p.size, p.sizeUnit)} {t(`enums.propertyType.${p.propertyType}`)}
            </span>{' '}
            <span className="ltr-nums text-xs font-semibold text-brand-600">{p.propertyId}</span>
            <span className="block text-sm text-muted">
              {locationLabel(p)} · <span className="ltr-nums font-medium text-ink-2">{formatPkr(p.askingPrice)}</span>
            </span>
          </Link>
        ) : (
          <Link to={`/clients/${c._id}`} className="flex items-center gap-2 font-semibold tracking-tight text-ink hover:text-brand-600">
            <Avatar name={c.fullName} size="sm" /> {c.fullName} <span className="ltr-nums text-xs font-normal text-muted">{c.mobileNumber}</span>
          </Link>
        )}
        <MatchReasons match={match} />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={sendProperty} className="btn-secondary !h-8 !w-8 !px-0 text-emerald-600" title={t('match.sendProperty')} aria-label={t('match.sendProperty')}>
          <Send className="h-4 w-4" />
        </button>
        <ContactActions phone={c.mobileNumber} whatsapp={c.whatsappNumber} compact />
        {actions}
      </div>
    </div>
  );
}

const STAT_TONES = {
  brand: 'from-brand-500/15 to-brand-500/5 text-brand-600 ring-brand-500/15',
  green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400',
  amber: 'from-amber-500/20 to-amber-500/5 text-amber-600 ring-amber-500/20 dark:text-amber-400',
  red: 'from-red-500/15 to-red-500/5 text-red-600 ring-red-500/15 dark:text-red-400',
  blue: 'from-sky-500/15 to-sky-500/5 text-sky-600 ring-sky-500/15 dark:text-sky-400',
  purple: 'from-violet-500/15 to-violet-500/5 text-violet-600 ring-violet-500/15 dark:text-violet-400',
};

function AnimatedNumber({ value }: { value: number }) {
  const v = useCountUp(value);
  return <>{v.toLocaleString('en-PK')}</>;
}

/** KPI tile: icon, label and a value that counts up; links to the matching list. */
export function Stat({ label, value, icon, tone = 'brand', to, hint, size = 'md' }: { label: string; value: ReactNode; icon?: ReactNode; tone?: keyof typeof STAT_TONES; to?: string; hint?: ReactNode; size?: 'md' | 'lg' }) {
  const body = (
    <div className={clsx('card group relative flex h-full flex-col gap-3 overflow-hidden p-4', to && 'card-interactive', size === 'lg' && 'p-5')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-muted">{label}</p>
        {icon && <div className={clsx('rounded-[10px] bg-gradient-to-br p-2 ring-1 ring-inset transition-transform duration-300 group-hover:scale-110', STAT_TONES[tone])}>{icon}</div>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <p className={clsx('ltr-nums font-bold tracking-tight text-ink', size === 'lg' ? 'text-3xl' : 'text-2xl')}>{typeof value === 'number' ? <AnimatedNumber value={value} /> : value}</p>
        {to && <ArrowUpRight className="h-4 w-4 shrink-0 -translate-x-1 text-subtle opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 rtl:-scale-x-100" />}
      </div>
      {hint && <p className="-mt-1 text-2xs font-medium text-muted">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full rounded-xl focus-visible:shadow-ring focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
