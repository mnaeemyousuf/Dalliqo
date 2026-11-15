import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { BadgeCheck, BedDouble, Bath, FileDown, Mail, MapPin, MessageCircle, Phone, Ruler, Search, Send } from 'lucide-react';
import { LISTING_PURPOSES, PROPERTY_TYPES, whatsappLink } from '@recrm/shared';
import { BrandLogo } from '@/components/BrandLogo';
import { useSizeLabel } from '@/components/domain';
import { Badge, Button, Card, EmptyState, Input, Pagination, Select, Textarea, type BadgeColor } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useEnumOptions } from '@/lib/hooks';
import { useUi } from '@/store/ui';

/* Public pages: no session, own API client (no auth headers, no refresh-token handling). */
const pub = axios.create({ baseURL: '/api/public', timeout: 30_000 });
type Meta = { total: number; totalPages: number; page: number; limit: number };
const getPage = async <T,>(url: string, params?: Record<string, unknown>) => (await pub.get<{ data: T; meta?: Meta }>(url, { params })).data;
const get = async <T,>(url: string, params?: Record<string, unknown>) => (await getPage<T>(url, params)).data;
const errorText = (e: unknown, fallback: string) => (axios.isAxiosError(e) && (e.response?.data as { message?: string })?.message) || fallback;

interface Site { slug: string; name: string; tagline?: string | null; about?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null; city?: string | null; listingCount: number; agents: { _id: string; fullName: string }[] }
interface PublicListing {
  _id: string; ref: string; headline?: string | null; propertyType: string; listingPurpose: string; status: string;
  location: { area?: string; society?: string; block?: string; phase?: string; city?: string };
  size: number; sizeUnit: string; price: number; negotiable: boolean; bedrooms?: number; bathrooms?: number; floors?: number;
  furnishing?: string; corner?: boolean; mainRoad?: boolean; parkFacing?: boolean; possessionStatus?: string; amenities: string[];
  description?: string | null; coverImageUrl?: string | null; coverThumbnailUrl?: string | null; approxLocation?: { lat: number; lng: number } | null; verified: boolean;
  media?: { kind: string; url: string; thumbnailUrl: string }[]; agents?: { _id: string; fullName: string; mobileNumber?: string }[];
}

const CAMPAIGN_KEY = 'stateown.campaign';
function useCampaign() {
  const [sp] = useSearchParams();
  const c = sp.get('c');
  useEffect(() => {
    if (c) try { sessionStorage.setItem(CAMPAIGN_KEY, c); } catch { /* private mode */ }
  }, [c]);
  try { return c ?? sessionStorage.getItem(CAMPAIGN_KEY) ?? undefined; } catch { return c ?? undefined; }
}

function LangToggle() {
  const { lang, setLang } = useUi();
  return <button type="button" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>{lang === 'en' ? 'اردو' : 'English'}</button>;
}

function Shell({ site, children }: { site?: Pick<Site, 'slug' | 'name' | 'tagline' | 'phone' | 'whatsapp'> | null; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          {site ? (
            <Link to={`/w/${site.slug}`} className="min-w-0">
              <p className="truncate text-lg font-bold">{site.name}</p>
              {site.tagline && <p className="truncate text-xs text-muted">{site.tagline}</p>}
            </Link>
          ) : <BrandLogo className="h-7" />}
          <span className="ms-auto flex items-center gap-2">
            {site?.phone && <a href={`tel:${site.phone}`} className="hidden items-center gap-1 text-sm text-muted hover:text-brand-600 sm:flex"><Phone className="h-4 w-4" /><span className="ltr-nums">{site.phone}</span></a>}
            {site?.whatsapp && <a href={whatsappLink(site.whatsapp, t('site.waHello', { name: site.name }))} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
            <LangToggle />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center text-xs text-muted">{t('site.poweredBy')} <a className="font-semibold hover:text-brand-600" href="/" target="_blank" rel="noopener">Stateown</a></footer>
    </div>
  );
}

function Missing({ message }: { message: string }) {
  return (
    <Shell>
      <EmptyState title={message} icon={<Search className="h-6 w-6" />} />
    </Shell>
  );
}

const placeLabel = (l: PublicListing['location']) => [l.block, l.phase, l.society ?? l.area, l.city].filter(Boolean).join(', ');

function ListingCard({ l, slug }: { l: PublicListing; slug: string }) {
  const { t } = useTranslation();
  const size = useSizeLabel();
  return (
    <Link to={`/w/${slug}/p/${l._id}`} className="card group block overflow-hidden transition hover:shadow-lg">
      <div className="relative aspect-[4/3] bg-surface-2">
        {l.coverThumbnailUrl || l.coverImageUrl ? <img src={l.coverThumbnailUrl ?? l.coverImageUrl!} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-subtle"><MapPin className="h-8 w-8" /></div>}
        <span className="absolute start-2 top-2"><Badge color={l.listingPurpose === 'RENT' ? 'purple' : 'blue'}>{t(`enums.listingPurpose.${l.listingPurpose}`)}</Badge></span>
        {l.verified && <span className="absolute end-2 top-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-2xs font-semibold text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />{t('site.verified')}</span>}
      </div>
      <div className="space-y-1 p-3">
        <p className="ltr-nums text-lg font-bold text-brand-600">{formatPkr(l.price)}{l.listingPurpose === 'RENT' && <span className="text-xs font-normal text-muted"> / {t('site.month')}</span>}</p>
        <p className="line-clamp-1 font-medium">{l.headline || `${size(l.size, l.sizeUnit)} ${t(`enums.propertyType.${l.propertyType}`)}`}</p>
        <p className="line-clamp-1 text-xs text-muted">{placeLabel(l.location)}</p>
        <p className="flex flex-wrap gap-3 pt-1 text-xs text-muted">
          <span className="flex items-center gap-1"><Ruler className="h-3.5 w-3.5" />{size(l.size, l.sizeUnit)}</span>
          {!!l.bedrooms && <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" />{l.bedrooms}</span>}
          {!!l.bathrooms && <span className="flex items-center gap-1"><Bath className="h-3.5 w-3.5" />{l.bathrooms}</span>}
        </p>
      </div>
    </Link>
  );
}

export function PublicAgentPage() {
  const { t } = useTranslation();
  const { slug = '', id = '' } = useParams();
  useCampaign();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['public-agent', slug, id], queryFn: () => get<{ site: Site; agent: { _id: string; fullName: string; mobileNumber?: string | null; listingCount: number } }>(`/sites/${slug}/agents/${id}`), retry: false });
  const listings = useQuery({ queryKey: ['public-agent-listings', slug, id, page], queryFn: () => getPage<PublicListing[]>(`/sites/${slug}/listings`, { agentId: id, page, limit: 12 }), enabled: q.isSuccess, placeholderData: (p) => p });
  useEffect(() => { if (q.data) document.title = `${q.data.agent.fullName} — ${q.data.site.name}`; }, [q.data]);
  if (q.isError) return <Missing message={t('site.agentGone')} />;
  if (!q.data) return <Shell><div className="h-48 animate-pulse rounded-xl bg-surface-2" /></Shell>;
  const { site, agent } = q.data;
  const initials = agent.fullName.split(' ').map((x) => x[0]).slice(0, 2).join('');
  const meta = listings.data?.meta;
  return (
    <Shell site={site}>
      <Link to={`/w/${slug}`} className="mb-3 inline-block text-sm text-muted hover:text-brand-600">← {t('site.allListings')}</Link>
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-xl font-bold text-white">{initials}</span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{agent.fullName}</h1>
            <p className="text-sm text-muted">{t('site.agentAt', { name: site.name })} · {t('site.heroCount', { count: agent.listingCount })}</p>
          </div>
          <span className="ms-auto flex flex-wrap gap-2">
            {agent.mobileNumber && <a href={`tel:${agent.mobileNumber}`} className="btn btn-secondary"><Phone className="h-4 w-4" />{t('site.call')}</a>}
            {agent.mobileNumber && <a href={whatsappLink(agent.mobileNumber, t('site.waHello', { name: site.name }))} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
          </span>
        </div>
      </Card>
      {!listings.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{listings.data.data.map((l) => <ListingCard key={l._id} l={l} slug={slug} />)}</div>
          {meta && meta.totalPages > 1 && <div className="mt-4"><Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} limit={meta.limit} onChange={setPage} /></div>}
        </>
      )}
      <Card className="mt-6" title={t('site.contact')}><InquiryForm slug={slug} /></Card>
    </Shell>
  );
}

export function PublicSitePage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  useCampaign();
  const [sp, setSp] = useSearchParams();
  const f = { q: sp.get('q') ?? '', purpose: sp.get('purpose') ?? '', propertyType: sp.get('type') ?? '', maxPrice: sp.get('max') ?? '', sort: sp.get('sort') ?? 'newest', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => setSp((x) => { const n = new URLSearchParams(x); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); return n; }, { replace: true });
  const [q, setQ] = useState(f.q);
  const site = useQuery({ queryKey: ['public-site', slug], queryFn: () => get<Site>(`/sites/${slug}`), retry: false });
  const listings = useQuery({
    queryKey: ['public-listings', slug, f],
    queryFn: () => getPage<PublicListing[]>(`/sites/${slug}/listings`, { q: f.q || undefined, purpose: f.purpose || undefined, propertyType: f.propertyType || undefined, maxPrice: f.maxPrice || undefined, sort: f.sort, page: f.page, limit: 12 }),
    enabled: site.isSuccess,
    placeholderData: (p) => p,
  });
  const purposes = useEnumOptions('listingPurpose', LISTING_PURPOSES);
  const types = useEnumOptions('propertyType', PROPERTY_TYPES);
  useEffect(() => { if (site.data) document.title = `${site.data.name} — ${t('site.listings')}`; }, [site.data, t]);
  if (site.isError) return <Missing message={t('site.notFound')} />;
  if (!site.data) return <Shell><div className="h-64 animate-pulse rounded-xl bg-surface-2" /></Shell>;
  const s = site.data;
  const meta = listings.data?.meta;
  return (
    <Shell site={s}>
      <section className="mb-6 rounded-2xl bg-brand-600 p-6 text-white sm:p-10">
        <h1 className="text-2xl font-bold sm:text-3xl">{s.tagline || t('site.heroTitle', { name: s.name })}</h1>
        <p className="mt-1 text-sm opacity-90">{t('site.heroCount', { count: s.listingCount })}{s.city ? ` · ${s.city}` : ''}</p>
        <form className="mt-5 flex flex-wrap gap-2" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
          <input className="min-w-[14rem] flex-1 rounded-lg border-0 px-3 py-2.5 text-sm text-gray-900" placeholder={t('site.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('site.searchPlaceholder')} />
          <button className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50" type="submit">{t('common.search')}</button>
        </form>
      </section>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select wrapperClassName="w-36" placeholder={t('site.anyPurpose')} options={purposes} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} aria-label={t('site.anyPurpose')} />
        <Select wrapperClassName="w-48" placeholder={t('site.anyType')} options={types} value={f.propertyType} onChange={(e) => set('type', e.target.value)} aria-label={t('site.anyType')} />
        <Select wrapperClassName="w-44" placeholder={t('site.anyPrice')} options={[5e6, 1e7, 2e7, 5e7, 1e8].map((v) => ({ value: String(v), label: `≤ ${formatPkr(v)}` }))} value={f.maxPrice} onChange={(e) => set('max', e.target.value)} aria-label={t('site.anyPrice')} />
        <Select wrapperClassName="ms-auto w-44" options={[{ value: 'newest', label: t('site.newest') }, { value: 'price_asc', label: t('site.priceLow') }, { value: 'price_desc', label: t('site.priceHigh') }]} value={f.sort} onChange={(e) => set('sort', e.target.value)} aria-label={t('site.sort')} />
      </div>
      {!listings.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : !listings.data.data.length ? (
        <EmptyState title={t('site.noResults')} icon={<Search className="h-6 w-6" />} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{listings.data.data.map((l) => <ListingCard key={l._id} l={l} slug={slug} />)}</div>
          {meta && meta.totalPages > 1 && <div className="mt-4"><Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} limit={meta.limit} onChange={(p) => set('page', String(p))} /></div>}
        </>
      )}
      {!!s.agents.length && (
        <div className="mt-8">
          <p className="mb-2 text-sm font-semibold">{t('site.ourAgents')}</p>
          <div className="flex flex-wrap gap-2">
            {s.agents.map((a) => <Link key={a._id} to={`/w/${slug}/a/${a._id}`} className="chip ring-1 ring-inset ring-line hover:bg-surface-2">{a.fullName}</Link>)}
          </div>
        </div>
      )}
      <div className="mt-8 grid gap-4 md:grid-cols-[2fr_1fr]">
        {s.about && <Card title={t('site.about', { name: s.name })}><p className="whitespace-pre-wrap text-sm text-muted">{s.about}</p></Card>}
        <Card title={t('site.contact')}>
          <ul className="space-y-2 text-sm">
            {s.phone && <li><a className="flex items-center gap-2 hover:text-brand-600" href={`tel:${s.phone}`}><Phone className="h-4 w-4" /><span className="ltr-nums">{s.phone}</span></a></li>}
            {s.email && <li><a className="flex items-center gap-2 hover:text-brand-600" href={`mailto:${s.email}`}><Mail className="h-4 w-4" />{s.email}</a></li>}
            {s.address && <li className="flex items-start gap-2 text-muted"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{s.address}</li>}
          </ul>
          <InquiryForm slug={slug} />
        </Card>
      </div>
    </Shell>
  );
}

function InquiryForm({ slug, propertyId, compact }: { slug: string; propertyId?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const campaign = useCampaign();
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', website: '' });
  const send = useMutation({ mutationFn: () => pub.post(`/sites/${slug}/inquiries`, { ...f, email: f.email || undefined, message: f.message || undefined, website: f.website || undefined, propertyId, campaign }) });
  if (send.isSuccess) return <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">{t('site.thanks')}</p>;
  const submit = (e: FormEvent) => (e.preventDefault(), send.mutate());
  const span = compact ? '' : 'sm:col-span-2';
  return (
    <form onSubmit={submit} className={`mt-4 grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
      <p className={`text-sm font-semibold ${span}`}>{propertyId ? t('site.askAbout') : t('site.sendMessage')}</p>
      <Input aria-label={t('site.yourName')} placeholder={t('site.yourName')} required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Input aria-label={t('site.yourPhone')} placeholder={t('site.yourPhone')} required inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <Input aria-label={t('common.email')} placeholder={`${t('common.email')} (${t('site.optional')})`} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} wrapperClassName={span} />
      <Textarea aria-label={t('site.message')} placeholder={t('site.message')} rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} wrapperClassName={span} />
      {/* Honeypot: invisible to people, irresistible to bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {send.isError && <p className={`text-sm text-red-600 ${span}`}>{errorText(send.error, t('site.sendFailed'))}</p>}
      <Button type="submit" loading={send.isPending} icon={<Send className="h-4 w-4" />} className={compact ? 'w-full' : span}>{t('site.send')}</Button>
      <p className={`text-2xs text-muted ${span}`}>{t('site.privacy')}</p>
    </form>
  );
}

export function PublicListingPage() {
  const { t } = useTranslation();
  const { slug = '', id = '' } = useParams();
  const size = useSizeLabel();
  const q = useQuery({ queryKey: ['public-listing', slug, id], queryFn: () => get<{ site: Site; listing: PublicListing }>(`/sites/${slug}/listings/${id}`), retry: false });
  const [active, setActive] = useState(0);
  useEffect(() => { if (q.data) document.title = `${q.data.listing.headline ?? q.data.listing.ref} — ${q.data.site.name}`; }, [q.data]);
  if (q.isError) return <Missing message={t('site.listingGone')} />;
  if (!q.data) return <Shell><div className="h-96 animate-pulse rounded-xl bg-surface-2" /></Shell>;
  const { site, listing: l } = q.data;
  const images = (l.media ?? []).filter((m) => m.kind === 'image');
  const hero = images[active]?.url ?? l.coverImageUrl;
  const features: [string, ReactNode][] = [
    [t('site.size'), size(l.size, l.sizeUnit)],
    [t('site.type'), t(`enums.propertyType.${l.propertyType}`)],
    ...(l.bedrooms ? [[t('site.bedrooms'), l.bedrooms] as [string, ReactNode]] : []),
    ...(l.bathrooms ? [[t('site.bathrooms'), l.bathrooms] as [string, ReactNode]] : []),
    ...(l.floors ? [[t('site.floors'), l.floors] as [string, ReactNode]] : []),
    ...(l.furnishing ? [[t('site.furnishing'), t(`enums.furnishing.${l.furnishing}`, { defaultValue: l.furnishing })] as [string, ReactNode]] : []),
    ...(l.possessionStatus ? [[t('site.possession'), t(`enums.possessionStatus.${l.possessionStatus}`, { defaultValue: l.possessionStatus })] as [string, ReactNode]] : []),
  ];
  const tags = [l.corner && t('site.corner'), l.parkFacing && t('site.parkFacing'), l.mainRoad && t('site.mainRoad'), l.negotiable && t('site.negotiable')].filter(Boolean) as string[];
  const wa = site.whatsapp ? whatsappLink(site.whatsapp, t('site.waAbout', { ref: l.ref, url: window.location.href })) : null;
  return (
    <Shell site={site}>
      <Link to={`/w/${slug}`} className="mb-3 inline-block text-sm text-muted hover:text-brand-600">← {t('site.allListings')}</Link>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div>
          <div className="aspect-[16/10] overflow-hidden rounded-xl bg-surface-2">
            {hero ? <img src={hero} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-subtle"><MapPin className="h-10 w-10" /></div>}
          </div>
          {images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {images.map((m, i) => (
                <button key={m.url} type="button" onClick={() => setActive(i)} className={`h-16 w-24 shrink-0 overflow-hidden rounded-md ring-2 ${i === active ? 'ring-brand-500' : 'ring-transparent'}`} aria-label={t('site.photo', { n: i + 1 })}>
                  <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <Card className="mt-4" title={t('site.details')}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {features.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            </dl>
            {!!tags.length && <p className="mt-3 flex flex-wrap gap-1.5">{tags.map((x) => <Badge key={x} color="blue" dot={false}>{x}</Badge>)}</p>}
            {!!l.amenities.length && <p className="mt-3 text-sm text-muted">{l.amenities.join(' · ')}</p>}
            {l.description && <p className="mt-4 whitespace-pre-wrap text-sm">{l.description}</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={l.listingPurpose === 'RENT' ? 'purple' : 'blue'}>{t(`enums.listingPurpose.${l.listingPurpose}`)}</Badge>
              {l.verified && <Badge color="green">{t('site.verified')}</Badge>}
              <span className="ltr-nums ms-auto text-xs text-muted">{l.ref}</span>
            </div>
            <h1 className="mt-2 text-xl font-bold">{l.headline || `${size(l.size, l.sizeUnit)} ${t(`enums.propertyType.${l.propertyType}`)}`}</h1>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPin className="h-4 w-4" />{placeLabel(l.location)}</p>
            <p className="ltr-nums mt-3 text-3xl font-bold text-brand-600">{formatPkr(l.price)}{l.listingPurpose === 'RENT' && <span className="text-sm font-normal text-muted"> / {t('site.month')}</span>}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {site.phone && <a href={`tel:${site.phone}`} className="btn btn-secondary flex-1 justify-center"><Phone className="h-4 w-4" />{t('site.call')}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">{t('site.share')}:</span>
              <a className="rounded-full border border-line px-2.5 py-1 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`}>Facebook</a>
              <a className="rounded-full border border-line px-2.5 py-1 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(l.headline ?? l.ref)}`}>X</a>
              <a className="rounded-full border border-line px-2.5 py-1 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`}>LinkedIn</a>
              <a className="rounded-full border border-line px-2.5 py-1 hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={whatsappLink('', `${l.headline ?? l.ref} — ${window.location.href}`).replace('https://wa.me/?', 'https://wa.me/?')}>WhatsApp</a>
              <button type="button" className="rounded-full border border-line px-2.5 py-1 hover:bg-surface-2" onClick={() => void navigator.clipboard?.writeText(window.location.href)}>{t('site.copyLink')}</button>
            </div>
            {l.approxLocation && <a className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-brand-600" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${l.approxLocation.lat},${l.approxLocation.lng}`}><MapPin className="h-3.5 w-3.5" />{t('site.approxMap')}</a>}
            {!!l.agents?.length && (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <p className="text-xs text-muted">{t('site.agent')}</p>
                {l.agents.map((a) => <p key={a._id} className="font-medium"><Link className="hover:text-brand-600" to={`/w/${slug}/a/${a._id}`}>{a.fullName}</Link>{a.mobileNumber && <a className="ltr-nums ms-2 text-xs text-brand-600" href={`tel:${a.mobileNumber}`}>{a.mobileNumber}</a>}</p>)}
              </div>
            )}
          </Card>
          <Card><InquiryForm slug={slug} propertyId={l._id} compact /></Card>
        </div>
      </div>
    </Shell>
  );
}

/* ═════════════ Client / owner portal ═════════════ */

const STAGE_COLOR: Record<string, BadgeColor> = { CLOSED_WON: 'green', CLOSED_LOST: 'red' };
const ITEM_COLOR: Record<string, BadgeColor> = { PENDING: 'gray', PARTIAL: 'amber', PAID: 'green', OVERDUE: 'red', WAIVED: 'purple' };
type Pay = { _id: string; date: string; amount: number; method: string };
type Prop = { ref?: string; location?: string } | null;
interface PortalView {
  kind: 'CLIENT' | 'OWNER';
  expiresAt: string;
  party: { fullName: string };
  business: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null };
  deals?: { _id?: string; dealNo: string; stage: string; price?: number | null; property: Prop; payments?: Pay[]; offers?: { party: string; amount: number; status: string; at: string }[] }[];
  installmentPlans?: { _id: string; planNo: string; title?: string; status: string; totalAmount: number; paidTotal: number; outstanding: number; overdueAmount: number; nextDueDate?: string | null; property: Prop; items: { label: string; dueDate: string; amount: number; paid: number; status: string }[]; payments: Pay[] }[];
  leases?: { _id: string; leaseNo: string; status: string; startDate: string; endDate: string; monthlyRent: number; property: Prop; overdue: number; collected?: number; maintenance?: number; nextDue?: { dueDate: string; balance: number } | null; schedule?: { period: string; dueDate: string; amount: number; paid: number; status: string }[]; payments?: Pay[] }[];
  settings?: Record<string, boolean>;
  documents?: { _id: string; fileName: string; category?: string; createdAt: string }[];
  requirement?: { purpose: string; propertyTypes: string[]; societies: string[]; areas: string[]; minBudget: number | null; maxBudget: number | null; bedroomsMin: number | null; notes: string | null } | null;
  matches?: { matchId: string; score: number; favorite: boolean; property: PublicListing }[];
  inquiries?: { name: string; channel: string; at: string; ref: string }[];
  agreements?: { agreementNo: string; kind: string; title?: string; status: string; updatedAt: string }[];
  properties?: { _id: string; ref: string; propertyType: string; listingPurpose: string; status: string; location: string; size: number; sizeUnit: string; askingPrice: number; verification: string; onWebsite: boolean; views: number; inquiries: number; coverThumbnailUrl?: string | null }[];
}

function Receipts({ token, kind, id, payments }: { token: string; kind: 'lease' | 'installment' | 'deal'; id: string; payments?: Pay[] }) {
  const { t } = useTranslation();
  if (!payments?.length) return null;
  return (
    <ul className="mt-3 divide-y divide-line text-sm">
      {[...payments].reverse().map((p) => (
        <li key={p._id} className="flex flex-wrap items-center gap-2 py-1.5">
          <span className="ltr-nums font-semibold">{formatPkr(p.amount)}</span>
          <span className="text-xs text-muted">{t(`enums.paymentMethod.${p.method}`)} · {formatDate(p.date)}</span>
          <a className="ms-auto inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" href={`/api/public/portal/${token}/receipts/${kind}/${id}/${p._id}`} target="_blank" rel="noopener noreferrer"><FileDown className="h-3.5 w-3.5" />{t('finance5b.receipt')}</a>
        </li>
      ))}
    </ul>
  );
}

function PreferencesCard({ token, req, editable, onSaved }: { token: string; req: NonNullable<PortalView['requirement']>; editable: boolean; onSaved(): void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ minBudget: req.minBudget ? String(req.minBudget) : '', maxBudget: req.maxBudget ? String(req.maxBudget) : '', societies: req.societies.join(', '), bedroomsMin: req.bedroomsMin ? String(req.bedroomsMin) : '', notes: req.notes ?? '' });
  const save = useMutation({
    mutationFn: () => pub.patch(`/portal/${token}/preferences`, { minBudget: f.minBudget ? Number(f.minBudget) : null, maxBudget: f.maxBudget ? Number(f.maxBudget) : null, societies: f.societies.split(',').map((s) => s.trim()).filter(Boolean), bedroomsMin: f.bedroomsMin ? Number(f.bedroomsMin) : null, notes: f.notes || null }),
    onSuccess: () => (setEditing(false), onSaved()),
  });
  return (
    <Card title={t('portal.yourRequirement')} actions={editable && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{t('portal.change')}</Button>}>
      {!editing ? (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">{t('portal.looking')}</dt><dd>{t(`enums.clientPurpose.${req.purpose}`)}{req.propertyTypes.length ? ` · ${req.propertyTypes.map((x) => t(`enums.propertyType.${x}`)).join(', ')}` : ''}</dd></div>
          <div><dt className="text-xs text-muted">{t('portal.areas')}</dt><dd>{[...req.societies, ...req.areas].join(', ') || '—'}</dd></div>
          <div><dt className="text-xs text-muted">{t('portal.budget')}</dt><dd className="ltr-nums">{req.minBudget || req.maxBudget ? `${req.minBudget ? formatPkr(req.minBudget) : '…'} – ${req.maxBudget ? formatPkr(req.maxBudget) : '…'}` : '—'}</dd></div>
          <div><dt className="text-xs text-muted">{t('site.bedrooms')}</dt><dd>{req.bedroomsMin ? `${req.bedroomsMin}+` : '—'}</dd></div>
        </dl>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('portal.minBudget')} type="number" min={0} value={f.minBudget} onChange={(e) => setF({ ...f, minBudget: e.target.value })} />
          <Input label={t('portal.maxBudget')} type="number" min={0} value={f.maxBudget} onChange={(e) => setF({ ...f, maxBudget: e.target.value })} />
          <Input label={t('portal.areas')} value={f.societies} onChange={(e) => setF({ ...f, societies: e.target.value })} hint={t('client.commaHint')} />
          <Input label={t('site.bedrooms')} type="number" min={0} value={f.bedroomsMin} onChange={(e) => setF({ ...f, bedroomsMin: e.target.value })} />
          <Textarea label={t('common.notes')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} wrapperClassName="sm:col-span-2" />
          {save.isError && <p className="text-sm text-red-600 sm:col-span-2">{errorText(save.error, t('site.sendFailed'))}</p>}
          <div className="flex gap-2 sm:col-span-2"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button></div>
        </div>
      )}
    </Card>
  );
}

function MatchesCard({ token, matches, canVisit, onChange }: { token: string; matches: NonNullable<PortalView['matches']>; canVisit: boolean; onChange(): void }) {
  const { t } = useTranslation();
  const size = useSizeLabel();
  const [visitFor, setVisitFor] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const react = useMutation({ mutationFn: (v: { id: string; reaction: string }) => pub.post(`/portal/${token}/matches/${v.id}`, { reaction: v.reaction }), onSuccess: onChange });
  const visit = useMutation({ mutationFn: () => pub.post(`/portal/${token}/visits`, { propertyId: visitFor, preferredAt: new Date(when).toISOString(), note: note || undefined }), onSuccess: () => (setVisitFor(null), setWhen(''), setNote('')) });
  return (
    <Card title={t('portal.matches')}>
      {!matches.length ? <p className="text-sm text-muted">{t('portal.noMatches')}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (
            <div key={m.matchId} className="overflow-hidden rounded-xl border border-line">
              <div className="aspect-[4/3] bg-surface-2">{m.property.coverThumbnailUrl && <img src={m.property.coverThumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
              <div className="space-y-1 p-3 text-sm">
                <p className="ltr-nums font-bold text-brand-600">{formatPkr(m.property.price)}</p>
                <p className="font-medium">{m.property.headline || `${size(m.property.size, m.property.sizeUnit)} ${t(`enums.propertyType.${m.property.propertyType}`)}`}</p>
                <p className="text-xs text-muted">{placeLabel(m.property.location)} · {t('portal.matchScore', { score: m.score })}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant={m.favorite ? 'primary' : 'secondary'} onClick={() => react.mutate({ id: m.matchId, reaction: m.favorite ? 'UNFAVORITE' : 'FAVORITE' })}>{m.favorite ? t('portal.saved') : t('portal.save')}</Button>
                  {canVisit && <Button size="sm" variant="secondary" onClick={() => setVisitFor(m.property._id)}>{t('portal.requestVisit')}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => react.mutate({ id: m.matchId, reaction: 'NOT_INTERESTED' })}>{t('portal.notInterested')}</Button>
                </div>
                {visitFor === m.property._id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-surface-2 p-2">
                    <Input label={t('portal.when')} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    <Input label={t('common.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
                    {visit.isError && <p className="text-xs text-red-600">{errorText(visit.error, t('site.sendFailed'))}</p>}
                    <Button size="sm" disabled={!when} loading={visit.isPending} onClick={() => visit.mutate()}>{t('site.send')}</Button>
                  </div>
                )}
                {visit.isSuccess && !visitFor && <p className="text-xs text-emerald-700">{t('portal.visitRequested')}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DocumentsCard({ token, docs }: { token: string; docs: NonNullable<PortalView['documents']> }) {
  const { t } = useTranslation();
  const open = async (id: string) => {
    const r = await get<{ url: string }>(`/portal/${token}/documents/${id}`);
    window.open(r.url, '_blank', 'noopener');
  };
  if (!docs.length) return null;
  return (
    <Card title={t('portal.documents')}>
      <ul className="divide-y divide-line text-sm">
        {docs.map((d) => <li key={d._id} className="flex items-center gap-2 py-2"><FileDown className="h-4 w-4 text-muted" /><button type="button" className="hover:text-brand-600" onClick={() => void open(d._id)}>{d.fileName}</button><span className="ltr-nums ms-auto text-xs text-muted">{formatDate(d.createdAt)}</span></li>)}
      </ul>
    </Card>
  );
}

function OwnerAvailability({ token, propertyId, askingPrice }: { token: string; propertyId: string; askingPrice: number }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'none' | 'price'>('none');
  const [price, setPrice] = useState(String(askingPrice));
  const send = useMutation({ mutationFn: (v: { available: boolean; askingPrice?: number }) => pub.post(`/portal/${token}/properties/${propertyId}/availability`, v) });
  if (send.isSuccess) return <p className="mt-2 text-xs text-emerald-700">{t('portal.ownerThanks')}</p>;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Button size="sm" variant="secondary" loading={send.isPending} onClick={() => send.mutate({ available: true })}>{t('portal.stillAvailable')}</Button>
      <Button size="sm" variant="ghost" loading={send.isPending} onClick={() => send.mutate({ available: false })}>{t('portal.notAvailable')}</Button>
      {mode === 'none' ? <Button size="sm" variant="ghost" onClick={() => setMode('price')}>{t('portal.changePrice')}</Button> : (
        <>
          <Input aria-label={t('portal.newPrice')} type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} wrapperClassName="w-40" />
          <Button size="sm" onClick={() => send.mutate({ available: true, askingPrice: Number(price) })}>{t('portal.requestPrice')}</Button>
        </>
      )}
    </div>
  );
}

export function PortalPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const size = useSizeLabel();
  const q = useQuery({ queryKey: ['portal', token], queryFn: () => get<PortalView>(`/portal/${token}`), retry: false });
  const [msg, setMsg] = useState('');
  const send = useMutation({ mutationFn: () => pub.post(`/portal/${token}/requests`, { message: msg }), onSuccess: () => setMsg('') });
  useEffect(() => { document.title = t('portal.title'); }, [t]);
  if (q.isError) return <Missing message={errorText(q.error, t('portal.invalid'))} />;
  if (!q.data) return <Shell><div className="h-64 animate-pulse rounded-xl bg-surface-2" /></Shell>;
  const v = q.data;
  const b = v.business;
  return (
    <Shell site={{ slug: '', name: b.name, tagline: t('portal.title'), phone: b.phone, whatsapp: b.whatsapp }}>
      <h1 className="text-xl font-bold">{t('portal.hello', { name: v.party.fullName })}</h1>
      <p className="mb-5 text-sm text-muted">{v.kind === 'CLIENT' ? t('portal.clientIntro', { business: b.name }) : t('portal.ownerIntro', { business: b.name })} {t('portal.validUntil', { date: formatDate(v.expiresAt) })}</p>
      <div className="space-y-4">
        {v.requirement && <PreferencesCard token={token} req={v.requirement} editable={!!v.settings?.allowPreferenceUpdates} onSaved={() => void q.refetch()} />}
        {v.kind === 'CLIENT' && v.settings?.showMatches && <MatchesCard token={token} matches={v.matches ?? []} canVisit={!!v.settings?.allowVisitRequests} onChange={() => void q.refetch()} />}
        {v.properties?.map((p) => (
          <Card key={p._id}>
            <div className="flex flex-wrap items-center gap-3">
              {p.coverThumbnailUrl && <img src={p.coverThumbnailUrl} alt="" className="h-16 w-20 rounded-md object-cover" />}
              <div className="min-w-0">
                <p className="font-semibold"><span className="ltr-nums">{p.ref}</span> · {size(p.size, p.sizeUnit)} {t(`enums.propertyType.${p.propertyType}`)}</p>
                <p className="text-xs text-muted">{p.location} · <span className="ltr-nums">{formatPkr(p.askingPrice)}</span></p>
              </div>
              <span className="ms-auto flex flex-wrap gap-1.5">
                <Badge color={p.status === 'AVAILABLE' ? 'green' : 'gray'}>{t(`enums.propertyStatus.${p.status}`)}</Badge>
                <Badge color={p.verification === 'APPROVED' ? 'green' : 'amber'}>{t(`verification.status.${p.verification}`, { defaultValue: p.verification })}</Badge>
                {p.onWebsite && <Badge color="blue">{t('portal.onWebsite', { views: p.views, inquiries: p.inquiries })}</Badge>}
              </span>
            </div>
            {v.settings?.allowOwnerAvailabilityUpdates && <OwnerAvailability token={token} propertyId={p._id} askingPrice={p.askingPrice} />}
          </Card>
        ))}
        {v.installmentPlans?.map((p) => (
          <Card key={p._id} title={<span><span className="ltr-nums">{p.planNo}</span>{p.title ? ` · ${p.title}` : ''}{p.property?.ref ? ` · ${p.property.ref}` : ''}</span>}>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted">{t('finance5b.total')}</p><p className="ltr-nums font-semibold">{formatPkr(p.totalAmount)}</p></div>
              <div><p className="text-xs text-muted">{t('rental.paid')}</p><p className="ltr-nums font-semibold text-emerald-600">{formatPkr(p.paidTotal)}</p></div>
              <div><p className="text-xs text-muted">{t('finance5b.outstanding')}</p><p className="ltr-nums font-semibold">{formatPkr(p.outstanding)}</p></div>
              <div><p className="text-xs text-muted">{t('rental.overdue')}</p><p className={`ltr-nums font-semibold ${p.overdueAmount ? 'text-red-600' : ''}`}>{formatPkr(p.overdueAmount)}</p></div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand-600">{t('finance5b.schedule')}</summary>
              <ul className="mt-2 divide-y divide-line text-sm">
                {p.items.map((i, n) => <li key={n} className="flex flex-wrap items-center gap-2 py-1.5"><span>{i.label}</span><span className="ltr-nums text-xs text-muted">{formatDate(i.dueDate)}</span><span className="ltr-nums ms-auto">{formatPkr(i.amount)}</span><Badge color={ITEM_COLOR[i.status]}>{t(`enums.rentStatus.${i.status}`)}</Badge></li>)}
              </ul>
            </details>
            <Receipts token={token} kind="installment" id={p._id} payments={p.payments} />
          </Card>
        ))}
        {v.leases?.map((l) => (
          <Card key={l._id} title={<span><span className="ltr-nums">{l.leaseNo}</span>{l.property?.ref ? ` · ${l.property.ref}` : ''} · {formatPkr(l.monthlyRent)}/{t('site.month')}</span>}>
            <p className="text-sm text-muted">{formatDate(l.startDate)} – {formatDate(l.endDate)} · {t(`enums.leaseStatus.${l.status}`)}</p>
            <p className="mt-1 text-sm">
              {l.nextDue && <span>{t('rental.nextDue')}: <span className="ltr-nums font-semibold">{formatPkr(l.nextDue.balance)}</span> · {formatDate(l.nextDue.dueDate)}</span>}
              {!!l.overdue && <span className="ms-3 font-semibold text-red-600">{t('rental.overdue')}: <span className="ltr-nums">{formatPkr(l.overdue)}</span></span>}
              {l.collected !== undefined && <span className="ms-3">{t('portal.collected')}: <span className="ltr-nums font-semibold">{formatPkr(l.collected)}</span></span>}
              {!!l.maintenance && <span className="ms-3">{t('ops.maintenance')}: <span className="ltr-nums font-semibold">{formatPkr(l.maintenance)}</span></span>}
            </p>
            <Receipts token={token} kind="lease" id={l._id} payments={l.payments} />
          </Card>
        ))}
        {v.deals?.map((d) => (
          <Card key={d._id ?? d.dealNo}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ltr-nums font-semibold">{d.dealNo}</span>
              {d.property?.ref && <span className="text-sm text-muted">{d.property.ref} · {d.property.location}</span>}
              {d.price ? <span className="ltr-nums text-sm">{formatPkr(d.price)}</span> : null}
              <Badge color={STAGE_COLOR[d.stage] ?? 'blue'} className="ms-auto">{t(`enums.dealStage.${d.stage}`)}</Badge>
            </div>
            {!!d.offers?.length && (
              <ul className="mt-2 space-y-1 text-xs">
                {d.offers.map((o, i) => <li key={i} className="flex gap-2"><span>{t(`enums.offerParty.${o.party}`, { defaultValue: o.party })}</span><span className="ltr-nums font-semibold">{formatPkr(o.amount)}</span><Badge color={o.status === 'ACCEPTED' ? 'green' : o.status === 'REJECTED' ? 'red' : 'gray'}>{t(`enums.offerStatus.${o.status}`, { defaultValue: o.status })}</Badge><span className="ltr-nums ms-auto text-muted">{formatDate(o.at)}</span></li>)}
              </ul>
            )}
            {d._id && <Receipts token={token} kind="deal" id={d._id} payments={d.payments} />}
          </Card>
        ))}
        {!!v.inquiries?.length && (
          <Card title={t('portal.inquiries')}>
            <ul className="divide-y divide-line text-sm">{v.inquiries.map((i, n) => <li key={n} className="flex gap-2 py-1.5"><span className="ltr-nums">{i.ref}</span><span>{i.name}</span><span className="text-xs text-muted">{i.channel === 'WHATSAPP' ? 'WhatsApp' : t('marketing.website')}</span><span className="ltr-nums ms-auto text-xs text-muted">{formatDate(i.at)}</span></li>)}</ul>
          </Card>
        )}
        {!!v.agreements?.length && (
          <Card title={t('portal.agreements')}>
            <ul className="divide-y divide-line text-sm">{v.agreements.map((a) => <li key={a.agreementNo} className="flex gap-2 py-1.5"><span className="ltr-nums font-medium">{a.agreementNo}</span><span>{a.title ?? t(`enums.agreementKind.${a.kind}`, { defaultValue: a.kind })}</span><Badge color={a.status === 'SIGNED' ? 'green' : 'gray'}>{t(`enums.agreementStatus.${a.status}`, { defaultValue: a.status })}</Badge><span className="ltr-nums ms-auto text-xs text-muted">{formatDate(a.updatedAt)}</span></li>)}</ul>
          </Card>
        )}
        <DocumentsCard token={token} docs={v.documents ?? []} />
        {!v.properties?.length && !v.installmentPlans?.length && !v.leases?.length && !v.deals?.length && !v.matches?.length && <EmptyState title={t('portal.nothing')} />}
        <Card title={t('portal.contact')}>
          {send.isSuccess ? <p className="text-sm text-emerald-700">{t('portal.sent')}</p> : (
            <form onSubmit={(e) => (e.preventDefault(), send.mutate())} className="space-y-2">
              <Textarea aria-label={t('site.message')} placeholder={t('portal.messagePlaceholder')} rows={3} required minLength={2} value={msg} onChange={(e) => setMsg(e.target.value)} />
              {send.isError && <p className="text-sm text-red-600">{errorText(send.error, t('site.sendFailed'))}</p>}
              <Button type="submit" loading={send.isPending} icon={<Send className="h-4 w-4" />}>{t('site.send')}</Button>
            </form>
          )}
        </Card>
      </div>
    </Shell>
  );
}
