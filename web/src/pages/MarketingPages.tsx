import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Globe, Link2, Megaphone, MessageCircle, Plus, Send, Trash2 } from 'lucide-react';
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, PERMISSIONS, whatsappLink, type PortalKind } from '@recrm/shared';
import { authApi, campaignApi, inquiryApi, portalApi, websiteApi, whatsappApi } from '@/api/endpoints';
import type { Campaign, Inquiry, Property } from '@/api/types';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, MetricTile, Modal, PageHeader, PageLoader, Select, Switch, Tabs, Textarea, type BadgeColor, type Column } from '@/components/ui';
import { formatDate, formatPkr } from '@/lib/format';
import { useEnumOptions, useOnError, useUrlState } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

const STATUS_COLOR: Record<string, BadgeColor> = { DRAFT: 'gray', ACTIVE: 'green', PAUSED: 'amber', ENDED: 'blue', NEW: 'amber', CONTACTED: 'green', SPAM: 'gray' };
const ref = (v: unknown, k: string) => (v && typeof v === 'object' && k in v ? String((v as Record<string, unknown>)[k]) : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : String(v ?? ''));
export const siteUrl = (slug: string) => `${window.location.origin}/w/${slug}`;

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    window.prompt('', text);
  }
}

/* ═════════════ Marketing page ═════════════ */

type MarketingTab = 'inquiries' | 'campaigns' | 'website' | 'whatsapp';

export function MarketingPage() {
  const { t } = useTranslation();
  const [s, setS] = useUrlState({ tab: 'inquiries' });
  const site = useQuery({ queryKey: ['website'], queryFn: websiteApi.get });
  return (
    <div>
      <PageHeader
        title={t('marketing.title')}
        subtitle={t('marketing.subtitle')}
        actions={site.data?.enabled && site.data.slug && (
          <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(siteUrl(site.data!.slug!), '_blank', 'noopener')}>{t('marketing.viewSite')}</Button>
        )}
      />
      <Tabs<MarketingTab>
        value={s.tab as MarketingTab}
        onChange={(v) => setS({ tab: v })}
        tabs={[
          { value: 'inquiries', label: t('marketing.inquiries'), count: site.data?.newInquiries || undefined },
          { value: 'campaigns', label: t('marketing.campaigns') },
          { value: 'website', label: t('marketing.website') },
          { value: 'whatsapp', label: 'WhatsApp' },
        ]}
      />
      <div className="mt-4">
        {s.tab === 'inquiries' && <InquiriesTab />}
        {s.tab === 'campaigns' && <CampaignsTab />}
        {s.tab === 'website' && <WebsiteTab />}
        {s.tab === 'whatsapp' && <WhatsAppTab />}
      </div>
    </div>
  );
}

function InquiriesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canEdit = useCan(PERMISSIONS.CLIENTS_UPDATE);
  const [f, setF] = useUrlState({ status: '', ipage: '1' });
  const page = Number(f.ipage);
  const query = useQuery({ queryKey: ['inquiries', f], queryFn: () => inquiryApi.list({ status: f.status || undefined, page, limit: 20 }), placeholderData: (p) => p });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => inquiryApi.setStatus(v.id, v.status), onSuccess: () => void qc.invalidateQueries({ queryKey: ['inquiries'] }), onError });
  const statuses = useEnumOptions('inquiryStatus', ['NEW', 'CONTACTED', 'SPAM']);
  const columns: Column<Inquiry>[] = [
    { key: 'when', header: t('common.date'), render: (i) => <span className="ltr-nums whitespace-nowrap text-xs">{formatDate(i.createdAt, true)}</span> },
    { key: 'who', header: t('marketing.from'), render: (i) => (
      <span>
        {i.clientId ? <Link className="font-medium hover:text-brand-600" to={`/clients/${i.clientId}`} onClick={(e) => e.stopPropagation()}>{i.name}</Link> : i.name}
        <span className="ltr-nums block text-xs text-muted">{i.phone}{i.email ? ` · ${i.email}` : ''}</span>
      </span>
    ) },
    { key: 'about', header: t('marketing.about'), render: (i) => (
      <span className="text-sm">
        {i.propertyId ? <Link className="ltr-nums font-medium text-brand-600" to={`/properties/${refId(i.propertyId)}`} onClick={(e) => e.stopPropagation()}>{ref(i.propertyId, 'propertyId')}</Link> : <span className="text-muted">{t('marketing.general')}</span>}
        {i.message && <span className="line-clamp-2 block text-xs text-muted">{i.message}</span>}
      </span>
    ) },
    { key: 'channel', header: t('marketing.channel'), render: (i) => <Badge color={i.channel === 'WHATSAPP' ? 'green' : 'blue'}>{i.channel === 'WHATSAPP' ? 'WhatsApp' : t('marketing.website')}</Badge> },
    { key: 'campaign', header: t('marketing.campaign'), render: (i) => ref(i.campaignId, 'name') || '—' },
    { key: 'lead', header: t('marketing.lead'), render: (i) => <span className="text-xs">{i.createdLead ? t('marketing.newLead') : t('marketing.existingClient')}{i.assignedTo ? ` · ${ref(i.assignedTo, 'fullName')}` : ''}</span> },
    { key: 'status', header: t('common.status'), render: (i) => canEdit ? (
      <Select aria-label={t('common.status')} options={statuses} value={i.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus.mutate({ id: i._id, status: e.target.value })} />
    ) : <Badge color={STATUS_COLOR[i.status]}>{t(`enums.inquiryStatus.${i.status}`)}</Badge> },
  ];
  return (
    <>
      <Card className="mb-4" bodyClassName="flex flex-wrap gap-2 !p-3">
        <Select wrapperClassName="w-48" placeholder={`${t('common.status')}: ${t('common.all')}`} options={statuses} value={f.status} onChange={(e) => setF({ status: e.target.value, ipage: '1' })} />
      </Card>
      <Card bodyClassName="!p-0">
        <DataTable columns={columns} query={query} page={page} onPage={(p) => setF({ ipage: String(p) })} empty={<EmptyState title={t('marketing.noInquiries')} hint={t('marketing.noInquiriesHint')} icon={<Megaphone className="h-6 w-6" />} />} />
      </Card>
    </>
  );
}

function CampaignsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.MARKETING_MANAGE);
  const site = useQuery({ queryKey: ['website'], queryFn: websiteApi.get });
  const [f, setF] = useUrlState({ cpage: '1' });
  const page = Number(f.cpage);
  const query = useQuery({ queryKey: ['campaigns', page], queryFn: () => campaignApi.list({ page, limit: 20 }), placeholderData: (p) => p });
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => campaignApi.remove(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }), onError });
  const link = (c: Campaign) => (site.data?.slug ? `${siteUrl(site.data.slug)}?c=${c.code}` : null);
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  const columns: Column<Campaign>[] = [
    { key: 'name', header: t('marketing.campaign'), render: (c) => <span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{t(`enums.campaignChannel.${c.channel}`)} · <span className="ltr-nums">{c.code}</span></span></span> },
    { key: 'status', header: t('common.status'), render: (c) => <Badge color={STATUS_COLOR[c.status]}>{t(`enums.campaignStatus.${c.status}`)}</Badge> },
    { key: 'spend', header: t('marketing.spend'), render: (c) => <span className="ltr-nums whitespace-nowrap">{formatPkr(c.spend)}{c.budget ? <span className="text-xs text-muted"> / {formatPkr(c.budget)}</span> : null}</span> },
    { key: 'leads', header: t('marketing.leads'), render: (c) => <span className="ltr-nums whitespace-nowrap">{c.metrics.leads}<span className="text-xs text-muted"> · {c.metrics.inquiries} {t('marketing.inquiriesShort')}</span></span> },
    { key: 'cpl', header: t('marketing.costPerLead'), render: (c) => <span className="ltr-nums">{c.metrics.costPerLead === null ? '—' : formatPkr(c.metrics.costPerLead)}</span> },
    { key: 'won', header: t('marketing.won'), render: (c) => <span className="ltr-nums whitespace-nowrap">{c.metrics.won} <span className="text-xs text-muted">({pct(c.metrics.conversionPct)})</span></span> },
    { key: 'revenue', header: t('marketing.revenue'), render: (c) => <span className="ltr-nums whitespace-nowrap">{formatPkr(c.metrics.revenue)}</span> },
    { key: 'roi', header: 'ROI', render: (c) => <span className={`ltr-nums font-semibold ${c.metrics.roiPct === null ? '' : c.metrics.roiPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pct(c.metrics.roiPct)}</span> },
    { key: 'actions', header: '', render: (c) => (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {link(c) && <Button size="sm" variant="ghost" aria-label={t('marketing.copyLink')} title={t('marketing.copyLink')} onClick={() => void copy(link(c)!, t('marketing.linkCopied'))}><Copy className="h-3.5 w-3.5" /></Button>}
        {canManage && <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => window.confirm(t('marketing.deleteCampaign', { name: c.name })) && remove.mutate(c._id)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>}
      </span>
    ) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t('marketing.campaignsHint')}</p>
        {canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('marketing.addCampaign')}</Button>}
      </div>
      <Card bodyClassName="!p-0">
        <DataTable columns={columns} query={query} page={page} onPage={(p) => setF({ cpage: String(p) })} onRowClick={canManage ? (c) => setEditing(c) : undefined} empty={<EmptyState title={t('marketing.noCampaigns')} icon={<Megaphone className="h-6 w-6" />} />} />
      </Card>
      {editing && <CampaignModal campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CampaignModal({ campaign, onClose }: { campaign: Campaign | null; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const channels = useEnumOptions('campaignChannel', CAMPAIGN_CHANNELS);
  const statuses = useEnumOptions('campaignStatus', CAMPAIGN_STATUSES);
  const d = (v?: string | null) => (v ? v.slice(0, 10) : '');
  const [f, setF] = useState({ name: campaign?.name ?? '', channel: campaign?.channel ?? 'FACEBOOK', status: campaign?.status ?? 'ACTIVE', code: campaign?.code ?? '', startDate: d(campaign?.startDate), endDate: d(campaign?.endDate), budget: String(campaign?.budget ?? ''), spend: String(campaign?.spend ?? ''), notes: campaign?.notes ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, channel: f.channel, status: f.status, code: f.code || undefined, startDate: f.startDate || null, endDate: f.endDate || null, budget: Number(f.budget || 0), spend: Number(f.spend || 0), notes: f.notes || null };
      return campaign ? campaignApi.update(campaign._id, body) : campaignApi.create(body);
    },
    onSuccess: () => (toast.success(t('common.saved')), void qc.invalidateQueries({ queryKey: ['campaigns'] }), onClose()),
    onError,
  });
  return (
    <Modal open onClose={onClose} size="lg" title={campaign ? campaign.name : t('marketing.addCampaign')} footer={<Button disabled={f.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('common.name')} required value={f.name} onChange={set('name')} wrapperClassName="sm:col-span-2" />
        <Select label={t('marketing.channel')} options={channels} value={f.channel} onChange={set('channel')} />
        <Select label={t('common.status')} options={statuses} value={f.status} onChange={set('status')} />
        <Input label={t('marketing.code')} value={f.code} onChange={set('code')} hint={t('marketing.codeHint')} />
        <span />
        <Input label={t('common.from')} type="date" value={f.startDate} onChange={set('startDate')} />
        <Input label={t('common.to')} type="date" value={f.endDate} onChange={set('endDate')} />
        <Input label={t('marketing.budget')} type="number" min={0} value={f.budget} onChange={set('budget')} />
        <Input label={t('marketing.spend')} type="number" min={0} value={f.spend} onChange={set('spend')} hint={t('marketing.spendHint')} />
        <Textarea label={t('common.notes')} value={f.notes} onChange={set('notes')} wrapperClassName="sm:col-span-2" />
      </div>
    </Modal>
  );
}

function WebsiteTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.MARKETING_MANAGE);
  const q = useQuery({ queryKey: ['website'], queryFn: websiteApi.get });
  const [f, setF] = useState<{ enabled: boolean; slug: string; tagline: string; about: string; phone: string; whatsapp: string; email: string; showAgents: boolean } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ enabled: q.data.enabled, slug: q.data.slug ?? q.data.suggestedSlug, tagline: q.data.tagline ?? '', about: q.data.about ?? '', phone: q.data.phone ?? '', whatsapp: q.data.whatsapp ?? '', email: q.data.email ?? '', showAgents: q.data.showAgents });
  }, [q.data, f]);
  const save = useMutation({
    mutationFn: () => websiteApi.update({ enabled: f!.enabled, slug: f!.slug || null, tagline: f!.tagline || null, about: f!.about || null, phone: f!.phone || null, whatsapp: f!.whatsapp || null, email: f!.email || null, showAgents: f!.showAgents }),
    onSuccess: (d) => (toast.success(t('common.saved')), qc.setQueryData(['website'], d)),
    onError,
  });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data || !f) return <PageLoader />;
  const set = (k: 'slug' | 'tagline' | 'about' | 'phone' | 'whatsapp' | 'email') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card title={t('marketing.websiteSettings')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Switch checked={f.enabled} disabled={!canManage} onChange={(v) => setF({ ...f, enabled: v })} label={t('marketing.siteOnline')} /></div>
          <Input label={t('marketing.address')} disabled={!canManage} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} hint={`${window.location.origin}/w/${f.slug || '…'}`} wrapperClassName="sm:col-span-2" />
          <Input label={t('marketing.tagline')} disabled={!canManage} value={f.tagline} onChange={set('tagline')} wrapperClassName="sm:col-span-2" />
          <Textarea label={t('marketing.aboutUs')} disabled={!canManage} value={f.about} onChange={set('about')} wrapperClassName="sm:col-span-2" />
          <Input label={t('common.phone')} disabled={!canManage} value={f.phone} onChange={set('phone')} />
          <Input label="WhatsApp" disabled={!canManage} value={f.whatsapp} onChange={set('whatsapp')} />
          <Input label={t('common.email')} disabled={!canManage} value={f.email} onChange={set('email')} />
          <div className="flex items-end"><Switch checked={f.showAgents} disabled={!canManage} onChange={(v) => setF({ ...f, showAgents: v })} label={t('marketing.showAgents')} /></div>
        </div>
        {canManage && <div className="mt-4 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
      </Card>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricTile tone="brand" label={t('marketing.published')} value={q.data.publishedListings} />
          <MetricTile tone="warn" label={t('marketing.newInquiries')} value={q.data.newInquiries} />
        </div>
        <Card title={t('marketing.howItWorks')}>
          <ol className="list-decimal space-y-1.5 ps-5 text-sm text-muted">
            <li>{t('marketing.how1')}</li>
            <li>{t('marketing.how2')}</li>
            <li>{t('marketing.how3')}</li>
            <li>{t('marketing.how4')}</li>
          </ol>
          {q.data.enabled && q.data.slug && (
            <Button className="mt-3" size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy(siteUrl(q.data.slug!), t('marketing.linkCopied'))}>{t('marketing.copyLink')}</Button>
          )}
        </Card>
      </div>
    </div>
  );
}

function WhatsAppTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.MARKETING_MANAGE);
  const q = useQuery({ queryKey: ['whatsapp'], queryFn: whatsappApi.status });
  const [f, setF] = useState<{ phoneNumberId: string; displayNumber: string } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ phoneNumberId: q.data.phoneNumberId ?? '', displayNumber: q.data.displayNumber ?? '' });
  }, [q.data, f]);
  const save = useMutation({ mutationFn: () => whatsappApi.update({ phoneNumberId: f!.phoneNumberId || null, displayNumber: f!.displayNumber || null }), onSuccess: (d) => (toast.success(t('common.saved')), qc.setQueryData(['whatsapp'], d)), onError });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data || !f) return <PageLoader />;
  const s = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('marketing.waStatus')}>
        <p className="mb-3 flex items-center gap-2 text-sm"><Badge color={s.mode === 'cloud' ? 'green' : 'amber'}>{s.mode === 'cloud' ? t('marketing.waCloud') : t('marketing.waLink')}</Badge></p>
        <p className="text-sm text-muted">{s.mode === 'cloud' ? t('marketing.waCloudHint') : s.platformConfigured ? t('marketing.waNeedsNumber') : t('marketing.waNeedsPlatform')}</p>
        <ul className="mt-3 space-y-1 text-xs text-muted">
          <li>{s.platformConfigured ? '✓' : '✗'} {t('marketing.waPlatform')}</li>
          <li>{s.webhookConfigured ? '✓' : '✗'} {t('marketing.waWebhook')}</li>
          <li>{s.phoneNumberId ? '✓' : '✗'} {t('marketing.waNumber')}</li>
        </ul>
      </Card>
      <Card title={t('marketing.waSettings')}>
        <div className="grid gap-3">
          <Input label={t('marketing.waPhoneNumberId')} disabled={!canManage} value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value.trim() })} hint={t('marketing.waPhoneNumberIdHint')} />
          <Input label={t('marketing.waDisplayNumber')} disabled={!canManage} value={f.displayNumber} onChange={(e) => setF({ ...f, displayNumber: e.target.value })} />
        </div>
        {canManage && <div className="mt-4 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
      </Card>
    </div>
  );
}

/* ═════════════ Pieces used on other pages ═════════════ */

/** Publish / unpublish a property on the agency website (property detail header). */
export function PublishButton({ property }: { property: Property }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const site = useQuery({ queryKey: ['website'], queryFn: websiteApi.get, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState(property.publicListing?.headline ?? '');
  const published = !!property.publicListing?.published;
  const save = useMutation({
    mutationFn: (pub: boolean) => websiteApi.publish(property._id, { published: pub, headline: headline || null }),
    onSuccess: (_d, pub) => (toast.success(pub ? t('marketing.publishedToast') : t('marketing.unpublishedToast')), void qc.invalidateQueries({ queryKey: ['property', property._id] }), void qc.invalidateQueries({ queryKey: ['website'] }), setOpen(false)),
    onError,
  });
  const url = site.data?.enabled && site.data.slug ? `${siteUrl(site.data.slug)}/p/${property._id}` : null;
  return (
    <>
      <Button variant="secondary" icon={<Globe className={`h-4 w-4 ${published ? 'text-emerald-600' : ''}`} />} onClick={() => setOpen(true)}>
        {published ? t('marketing.onWebsite') : t('marketing.publish')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('marketing.publishTitle')} footer={
        <>
          {published && <Button variant="ghost" loading={save.isPending} onClick={() => save.mutate(false)}>{t('marketing.unpublish')}</Button>}
          <Button loading={save.isPending} onClick={() => save.mutate(true)}>{published ? t('common.save') : t('marketing.publish')}</Button>
        </>
      }>
        <Input label={t('marketing.headline')} value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} placeholder={property.title ?? ''} />
        <p className="mt-3 text-xs text-muted">{t('marketing.publishHint')}</p>
        {published && property.publicListing && <p className="ltr-nums mt-2 text-xs text-muted">{t('marketing.listingStats', { views: property.publicListing.views ?? 0, inquiries: property.publicListing.inquiries ?? 0 })}</p>}
        {!site.data?.enabled && <p className="mt-2 text-xs text-amber-600">{t('marketing.siteOffline')}</p>}
        {url && published && <Button className="mt-3" size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy(url, t('marketing.linkCopied'))}>{t('marketing.copyLink')}</Button>}
      </Modal>
    </>
  );
}

/** Creates a portal link for a client / owner and offers to copy it or send it on WhatsApp. */
export function PortalLinkButton({ kind, partyId, name, phone }: { kind: PortalKind; partyId: string; name: string; phone?: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const can = useCan(kind === 'CLIENT' ? PERMISSIONS.CLIENTS_UPDATE : PERMISSIONS.OWNERS_UPDATE);
  const business = useAuth((s) => s.business?.name ?? '');
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [made, setMade] = useState<{ url: string; expiresAt: string; phone?: string | null } | null>(null);
  const links = useQuery({ queryKey: ['portal-links', kind, partyId], queryFn: () => portalApi.list(kind, partyId), enabled: open });
  const create = useMutation({ mutationFn: () => portalApi.create({ kind, partyId, days: Number(days) }), onSuccess: (d) => (setMade(d), void qc.invalidateQueries({ queryKey: ['portal-links', kind, partyId] })), onError });
  const revoke = useMutation({ mutationFn: (id: string) => portalApi.revoke(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-links', kind, partyId] }), onError });
  if (!can) return null;
  const message = made ? t('marketing.portalMessage', { name, business, url: made.url }) : '';
  return (
    <>
      <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => (setMade(null), setOpen(true))}>{t('marketing.portal')}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('marketing.portalTitle', { name })}>
        <p className="mb-3 text-sm text-muted">{kind === 'CLIENT' ? t('marketing.portalClientHint') : t('marketing.portalOwnerHint')}</p>
        {!made ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select label={t('marketing.validFor')} options={[7, 30, 90, 365].map((d) => ({ value: String(d), label: t('marketing.days', { count: d }) }))} value={days} onChange={(e) => setDays(e.target.value)} />
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('marketing.createLink')}</Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p className="ltr-nums break-all text-sm font-medium">{made.url}</p>
            <p className="text-xs text-muted">{t('marketing.expires', { date: formatDate(made.expiresAt) })} · {t('marketing.shownOnce')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy(made.url, t('marketing.linkCopied'))}>{t('marketing.copyLink')}</Button>
              {made.phone && <Button size="sm" icon={<MessageCircle className="h-3.5 w-3.5" />} onClick={() => window.open(whatsappLink(made.phone!, message), '_blank', 'noopener')}>WhatsApp</Button>}
            </div>
          </div>
        )}
        {!!links.data?.length && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold text-muted">{t('marketing.existingLinks')}</p>
            <ul className="divide-y divide-line text-sm">
              {links.data.map((l) => {
                const live = !l.revokedAt && new Date(l.expiresAt) > new Date();
                return (
                  <li key={l._id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="ltr-nums text-xs">{formatDate(l.createdAt)} → {formatDate(l.expiresAt)} · {t('marketing.opened', { count: l.useCount })}</span>
                    {live ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(l._id)}>{t('marketing.revoke')}</Button> : <Badge color="gray">{l.revokedAt ? t('marketing.revoked') : t('marketing.expired')}</Badge>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Write a WhatsApp message: sent through WhatsApp Business when connected, else opens wa.me. */
export function WhatsAppSendButton({ clientId, phone }: { clientId: string; phone: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const can = useCan(PERMISSIONS.CLIENTS_UPDATE);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => whatsappApi.send({ to: phone, text, clientId }),
    onSuccess: (r) => {
      if (r.mode === 'link') window.open(r.url, '_blank', 'noopener');
      else toast.success(t('marketing.waSent'));
      void qc.invalidateQueries({ queryKey: ['activities'] });
      setOpen(false);
      setText('');
    },
    onError,
  });
  if (!can) return null;
  return (
    <>
      <Button variant="secondary" icon={<Send className="h-4 w-4 text-emerald-600" />} onClick={() => setOpen(true)}>{t('marketing.waCompose')}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('marketing.waCompose')} footer={<Button disabled={!text.trim()} loading={send.isPending} onClick={() => send.mutate()}>{t('marketing.send')}</Button>}>
        <Textarea label={t('marketing.message')} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="mt-2 text-xs text-muted">{t('marketing.waComposeHint')}</p>
      </Modal>
    </>
  );
}

/** Reports page: campaigns and lead sources. */
export function CampaignReportCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reports', 'campaigns'], queryFn: campaignApi.report });
  if (q.isError) return null; // plan without marketing: the card simply isn't shown
  const d = q.data;
  const maxLeads = Math.max(1, ...(d?.bySource ?? []).map((s) => s.leads));
  return (
    <Card title={t('marketing.reportTitle')}>
      {!d ? (
        <div className="h-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile label={t('marketing.spend')} value={formatPkr(d.totals.spend)} />
              <MetricTile tone="brand" label={t('marketing.leads')} value={d.totals.leads} />
              <MetricTile tone="good" label={t('marketing.revenue')} value={formatPkr(d.totals.revenue)} />
              <MetricTile tone={d.totals.roiPct !== null && d.totals.roiPct < 0 ? 'bad' : 'good'} label="ROI" value={d.totals.roiPct === null ? '—' : `${d.totals.roiPct}%`} />
            </div>
            {!d.rows.length ? <p className="text-sm text-muted">{t('marketing.noCampaigns')}</p> : (
              <ul className="divide-y divide-line text-sm">
                {d.rows.slice(0, 8).map((r) => (
                  <li key={r._id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted">{t(`enums.campaignChannel.${r.channel}`)}</span>
                    <span className="ltr-nums ms-auto text-xs">{r.leads} {t('marketing.leads').toLowerCase()} · {r.won} {t('marketing.won').toLowerCase()} · ROI {r.roiPct === null ? '—' : `${r.roiPct}%`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('marketing.bySource')}</p>
            <ul className="space-y-1.5 text-sm">
              {d.bySource.map((s) => (
                <li key={s.source} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
                  <span className="truncate">{t(`enums.source.${s.source}`, { defaultValue: s.source })}</span>
                  <span className="h-2 rounded-full bg-surface-2"><span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(s.leads / maxLeads) * 100}%` }} /></span>
                  <span className="ltr-nums text-end text-xs">{s.leads}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Profile → email copies of notifications. */
export function EmailNotificationsSetting() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const patchUser = useAuth((s) => s.patchUser);
  const onError = useOnError();
  const save = useMutation({ mutationFn: (v: boolean) => authApi.updateProfile({ preferences: { emailNotifications: v } }), onSuccess: patchUser, onError });
  return (
    <Card title={t('marketing.emailTitle')}>
      <Switch checked={!!user?.preferences.emailNotifications} disabled={save.isPending} onChange={(v) => save.mutate(v)} label={t('marketing.emailLabel', { email: user?.email ?? '' })} />
      <p className="mt-2 text-xs text-muted">{t('marketing.emailHint')}</p>
    </Card>
  );
}
