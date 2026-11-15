import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Download, Flame, FileUp, Snowflake, Sun, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp, Undo2 } from 'lucide-react';
import {
  AUTOMATION_RULES,
  AUTOMATION_RULE_KEYS,
  BILLING_CYCLES,
  CLIENT_SOURCES,
  CONSTRUCTION_STATUSES,
  DEVELOPMENT_STATUSES,
  FACING_DIRECTIONS,
  FURNISHING_STATUSES,
  LEAD_SCORE_FACTORS,
  PERMISSIONS,
  PLAN_KEYS,
  POSSESSION_STATUSES,
  SUBSCRIPTION_STATUSES,
  type LeadTemperature,
  type PlanKey,
} from '@recrm/shared';
import { clientApi, dealApi, propertyApi, settingsApi, subscriptionApi } from '@/api/endpoints';
import type { Client, Deal, ImportResult, Property, Settings } from '@/api/types';
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Input, MetricTile, Modal, PageHeader, PageLoader, Pagination, Select, Switch, type BadgeColor } from '@/components/ui';
import { formatDate, formatPkr, relativeTime } from '@/lib/format';
import { useEnumOptions, useMembers, useOnError } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';

/* ═════════════ Leads ═════════════ */

const TEMP_COLOR: Record<LeadTemperature, BadgeColor> = { HOT: 'red', WARM: 'amber', COLD: 'blue' };
const TEMP_ICON: Record<LeadTemperature, typeof Flame> = { HOT: Flame, WARM: Sun, COLD: Snowflake };

export function TemperatureBadge({ value, score }: { value?: LeadTemperature; score?: number }) {
  const { t } = useTranslation();
  if (!value) return null;
  const Icon = TEMP_ICON[value];
  return (
    <Badge color={TEMP_COLOR[value]} dot={false}>
      <Icon className="h-3 w-3" />
      {t(`enums.leadTemperature.${value}`)}
      {score !== undefined && <span className="ltr-nums opacity-70">· {score}</span>}
    </Badge>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = score >= 70 ? 'text-red-500' : score >= 40 ? 'text-amber-500' : 'text-sky-500';
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-ink/[0.07] dark:stroke-white/10" />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={`${color} stroke-current transition-[stroke-dashoffset] duration-700`} strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="ltr-nums absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold leading-none text-ink">{score}</span>
        <span className="text-2xs font-semibold text-muted">/ 100</span>
      </span>
    </div>
  );
}

/** Lead score with its explanation, temperature, response time, assignment and history. */
export function LeadPanel({ client }: { client: Client }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const canUpdate = useCan(PERMISSIONS.CLIENTS_UPDATE);
  const [assignee, setAssignee] = useState(client.assignedTo ?? '');
  const assign = useMutation({
    mutationFn: () => clientApi.assign(client._id, assignee || null),
    onSuccess: () => {
      toast.success(t('lead.assigned'));
      void qc.invalidateQueries({ queryKey: ['client', client._id] });
    },
    onError,
  });
  const temperature = useMutation({
    mutationFn: (v: LeadTemperature | null) => clientApi.update(client._id, { temperatureOverride: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client._id] }),
    onError,
  });
  const reasons = client.leadScoreReasons ?? [];
  return (
    <Card title={t('lead.title')}>
      <div className="flex flex-wrap items-center gap-5">
        <ScoreGauge score={client.leadScore ?? 0} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TemperatureBadge value={client.temperature} />
            {client.temperatureOverride && <span className="text-2xs font-medium text-muted">{t('lead.manual')}</span>}
            {client.source && <Badge color="gray">{t(`enums.source.${client.source}`)}</Badge>}
            {client.campaign && <Badge color="purple">{client.campaign}</Badge>}
          </div>
          <p className="text-xs text-muted">
            {client.responseMinutes !== undefined ? t('lead.responseTime', { time: formatMinutes(client.responseMinutes) }) : t('lead.notContactedYet')}
            {client.buyingTimeline && <> · {t(`enums.buyingTimeline.${client.buyingTimeline}`)}</>}
          </p>
          {canUpdate && (
            <div className="flex flex-wrap gap-1">
              {(['HOT', 'WARM', 'COLD'] as const).map((v) => (
                <button key={v} className={`chip ring-1 ring-inset ${client.temperatureOverride === v ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line hover:bg-surface-2'}`} onClick={() => temperature.mutate(client.temperatureOverride === v ? null : v)}>
                  {t(`enums.leadTemperature.${v}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {reasons.map((r) => (
          <li key={r.factor} className="flex items-center gap-3 text-sm">
            {r.positive ? <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> : <TrendingDown className="h-4 w-4 shrink-0 text-amber-500" />}
            <span className="min-w-0 flex-1 text-ink-2">{t(`lead.reasons.${r.code}`)}</span>
            <span className="ltr-nums w-16 shrink-0 text-end text-xs font-semibold text-muted">
              {Math.round(r.points)} / {Math.round(r.max)}
            </span>
          </li>
        ))}
      </ul>
      {canUpdate && members.options.length > 0 && (
        <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
          <Select wrapperClassName="flex-1" label={t('lead.assignTo')} placeholder={t('lead.unassigned')} options={members.options} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          <Button variant="secondary" loading={assign.isPending} disabled={assignee === (client.assignedTo ?? '')} onClick={() => assign.mutate()}>
            {t('lead.assign')}
          </Button>
        </div>
      )}
      {(client.assignmentHistory?.length || client.statusHistory?.length) && (
        <details className="mt-4 border-t border-line pt-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">{t('lead.history')}</summary>
          <ul className="mt-2 space-y-1.5 text-xs text-muted">
            {[
              ...(client.statusHistory ?? []).map((h) => ({ at: h.at, text: `${t('common.status')}: ${t(`enums.clientStatus.${h.status}`)}${h.note ? ` — ${h.note}` : ''}` })),
              ...(client.assignmentHistory ?? []).map((h) => ({ at: h.at, text: `${t('lead.assignedTo')}: ${members.name(h.to ?? undefined) ?? t('lead.unassigned')}${h.note ? ` — ${h.note}` : ''}` })),
            ]
              .sort((a, b) => +new Date(b.at) - +new Date(a.at))
              .map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="ltr-nums shrink-0">{formatDate(h.at, true)}</span>
                  <span className="text-ink-2">{h.text}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

/** Excel import of leads (template download, optional assignee/source, result summary). */
export function LeadImportModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const members = useMembers();
  const sources = useEnumOptions('source', CLIENT_SOURCES);
  const file = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState({ assignedTo: '', source: '' });
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (f: File) => clientApi.importExcel(f, { assignedTo: opts.assignedTo || undefined, source: opts.source || undefined }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError,
  });
  const close = () => {
    setResult(null);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={t('lead.import.title')} footer={<Button variant="secondary" onClick={close}>{t('common.close')}</Button>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <MetricTile tone="good" label={t('lead.import.created')} value={result.created} />
            <MetricTile tone="warn" label={t('lead.import.duplicates')} value={result.duplicates.length} />
            <MetricTile tone="bad" label={t('lead.import.errors')} value={result.errors.length} />
          </div>
          {[...result.duplicates.map((d) => `${t('lead.import.row')} ${d.row}: ${d.name} — ${t('lead.import.existing', { name: d.existing })}`), ...result.errors.map((e) => `${t('lead.import.row')} ${e.row}: ${e.message}`)].map((line, i) => (
            <p key={i} className="text-xs text-muted">{line}</p>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('lead.import.hint')}</p>
          <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => clientApi.downloadTemplate().catch(onError)}>{t('lead.import.template')}</Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('lead.assignTo')} placeholder={t('lead.unassigned')} options={members.options} value={opts.assignedTo} onChange={(e) => setOpts({ ...opts, assignedTo: e.target.value })} />
            <Select label={t('client.source')} placeholder={t('lead.import.fromSheet')} options={sources} value={opts.source} onChange={(e) => setOpts({ ...opts, source: e.target.value })} />
          </div>
          <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && run.mutate(e.target.files[0])} />
          <Button icon={<FileUp className="h-4 w-4" />} loading={run.isPending} onClick={() => file.current?.click()}>{t('lead.import.choose')}</Button>
        </div>
      )}
    </Modal>
  );
}

export function LeadReportCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reports', 'leads'], queryFn: () => clientApi.leadReport({}) });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <Card title={t('lead.report.title')}>
      {!d ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile tone="brand" label={t('lead.report.leads')} value={d.totals.leads} />
            <MetricTile tone="good" label={t('lead.report.conversion')} value={`${d.totals.conversionRate}%`} />
            <MetricTile tone="warn" label={t('lead.report.unassigned')} value={d.totals.unassigned} />
            <MetricTile label={t('lead.report.response')} value={d.totals.avgResponseMinutes === null ? '—' : formatMinutes(d.totals.avgResponseMinutes)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <table className="w-full overflow-hidden rounded-xl text-sm ring-1 ring-line">
              <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted">
                <tr><th className="px-3 py-2 text-start">{t('client.source')}</th><th className="px-3 py-2 text-end">{t('lead.report.leads')}</th><th className="px-3 py-2 text-end">{t('lead.report.won')}</th><th className="px-3 py-2 text-end">%</th></tr>
              </thead>
              <tbody>
                {d.bySource.map((s) => (
                  <tr key={s.source} className="border-t border-line">
                    <td className="px-3 py-2">{s.source === 'UNKNOWN' ? '—' : t(`enums.source.${s.source}`)}</td>
                    <td className="ltr-nums px-3 py-2 text-end">{s.leads}</td>
                    <td className="ltr-nums px-3 py-2 text-end">{s.converted}</td>
                    <td className="ltr-nums px-3 py-2 text-end font-semibold">{s.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['HOT', 'WARM', 'COLD'] as const).map((k) => (
                  <Badge key={k} color={TEMP_COLOR[k]}>{t(`enums.leadTemperature.${k}`)}: <span className="ltr-nums">{d.byTemperature[k]}</span></Badge>
                ))}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('lead.report.aging')}</p>
                {d.aging.map((a) => {
                  const max = Math.max(1, ...d.aging.map((x) => x.count));
                  return (
                    <div key={a.key} className="mb-1.5 flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 text-muted">{t(`lead.report.agingBuckets.${a.key}`)}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.06] dark:bg-white/10"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(a.count / max) * 100}%` }} /></span>
                      <span className="ltr-nums w-8 text-end font-semibold">{a.count}</span>
                    </div>
                  );
                })}
              </div>
              {d.lostReasons.length > 0 && (
                <p className="text-xs text-muted">
                  {t('lead.report.lostReasons')}: {d.lostReasons.map((l) => `${t(`enums.lostReason.${l.reason}`)} (${l.count})`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ═════════════ Properties ═════════════ */

type PropertyForm = Record<string, unknown>;

/** Pakistan-specific attributes in the property form (progressive: collapsed until opened or used). */
export function PropertyExtraFields({ form, set }: { form: PropertyForm; set(patch: PropertyForm): void }) {
  const { t } = useTranslation();
  const used = ['phase', 'sector', 'possessionStatus', 'constructionStatus', 'furnishing', 'facing', 'corner', 'parkFacing', 'mainRoad', 'availabilityExpiresAt'].some((k) => !!form[k]);
  const [open, setOpen] = useState(used);
  const opt = (group: string, values: readonly string[]) => values.map((v) => ({ value: v, label: t(`enums.${group}.${v}`) }));
  const str = (k: string) => (form[k] as string | undefined) ?? '';
  return (
    <div className="rounded-xl border border-line p-3 sm:col-span-2">
      <button type="button" className="flex w-full items-center justify-between text-sm font-semibold" onClick={() => setOpen(!open)}>
        {t('property.pk.title')}
        <span className="text-xs font-medium text-brand-600">{open ? t('common.hide') : t('common.show')}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label={t('property.pk.phase')} value={str('phase')} onChange={(e) => set({ phase: e.target.value })} />
          <Input label={t('property.pk.sector')} value={str('sector')} onChange={(e) => set({ sector: e.target.value })} />
          <Input label={t('property.pk.unitNumber')} value={str('unitNumber')} onChange={(e) => set({ unitNumber: e.target.value })} />
          <Select label={t('property.pk.possession')} placeholder="—" options={opt('possessionStatus', POSSESSION_STATUSES)} value={str('possessionStatus')} onChange={(e) => set({ possessionStatus: e.target.value || undefined })} />
          <Select label={t('property.pk.development')} placeholder="—" options={opt('developmentStatus', DEVELOPMENT_STATUSES)} value={str('developmentStatus')} onChange={(e) => set({ developmentStatus: e.target.value || undefined })} />
          <Select label={t('property.pk.construction')} placeholder="—" options={opt('constructionStatus', CONSTRUCTION_STATUSES)} value={str('constructionStatus')} onChange={(e) => set({ constructionStatus: e.target.value || undefined })} />
          <Select label={t('property.pk.furnishing')} placeholder="—" options={opt('furnishing', FURNISHING_STATUSES)} value={str('furnishing')} onChange={(e) => set({ furnishing: e.target.value || undefined })} />
          <Select label={t('property.pk.facing')} placeholder="—" options={opt('facing', FACING_DIRECTIONS)} value={str('facing')} onChange={(e) => set({ facing: e.target.value || undefined })} />
          <Input label={t('property.pk.expires')} type="date" value={str('availabilityExpiresAt').slice(0, 10)} onChange={(e) => set({ availabilityExpiresAt: e.target.value || null })} hint={t('property.pk.expiresHint')} />
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <Checkbox label={t('property.pk.corner')} checked={!!form.corner} onChange={(v) => set({ corner: v })} />
            <Checkbox label={t('property.pk.parkFacing')} checked={!!form.parkFacing} onChange={(v) => set({ parkFacing: v })} />
            <Checkbox label={t('property.pk.mainRoad')} checked={!!form.mainRoad} onChange={(v) => set({ mainRoad: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Pakistan attributes + price history on the property detail page. */
export function PropertyExtraDetails({ property: p }: { property: Property }) {
  const { t } = useTranslation();
  const rows: [string, string | undefined][] = [
    [t('property.pk.phase'), p.phase],
    [t('property.pk.sector'), p.sector],
    [t('property.pk.unitNumber'), p.unitNumber],
    [t('property.pk.possession'), p.possessionStatus && t(`enums.possessionStatus.${p.possessionStatus}`)],
    [t('property.pk.development'), p.developmentStatus && t(`enums.developmentStatus.${p.developmentStatus}`)],
    [t('property.pk.construction'), p.constructionStatus && t(`enums.constructionStatus.${p.constructionStatus}`)],
    [t('property.pk.furnishing'), p.furnishing && t(`enums.furnishing.${p.furnishing}`)],
    [t('property.pk.facing'), p.facing && t(`enums.facing.${p.facing}`)],
    [t('property.pk.expires'), p.availabilityExpiresAt ? formatDate(p.availabilityExpiresAt) : undefined],
  ].filter(([, v]) => !!v) as [string, string][];
  const flags = [p.corner && t('property.pk.corner'), p.parkFacing && t('property.pk.parkFacing'), p.mainRoad && t('property.pk.mainRoad')].filter(Boolean) as string[];
  const history = p.priceHistory ?? [];
  if (!rows.length && !flags.length && history.length < 2) return null;
  return (
    <Card title={t('property.pk.title')}>
      {flags.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{flags.map((f) => <Badge key={f} color="green">{f}</Badge>)}</div>}
      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {history.length > 1 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('property.pk.priceHistory')}</p>
          <ul className="space-y-1.5 text-sm">
            {[...history].reverse().map((h, i, arr) => {
              const prev = arr[i + 1]?.price;
              return (
                <li key={h.at} className="flex items-center justify-between gap-3">
                  <span className="ltr-nums text-xs text-muted">{formatDate(h.at)}</span>
                  <span className="ltr-nums flex items-center gap-1.5 font-semibold">
                    {prev !== undefined && (h.price < prev ? <TrendingDown className="h-3.5 w-3.5 text-emerald-500" /> : <TrendingUp className="h-3.5 w-3.5 text-amber-500" />)}
                    {formatPkr(h.price)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function InventoryReportCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reports', 'inventory'], queryFn: () => propertyApi.inventoryReport() });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <Card title={t('property.inventory.title')}>
      {!d ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile tone="brand" label={t('property.inventory.onMarket')} value={d.onMarket} />
            <MetricTile label={t('property.inventory.avgDays')} value={d.avgDaysOnMarket} />
            {d.aging.slice(2).map((a) => (
              <MetricTile key={a.key} tone={a.key === '90_PLUS' ? 'bad' : 'warn'} label={t(`property.inventory.buckets.${a.key}`)} value={a.count} />
            ))}
          </div>
          {d.oldest.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('property.inventory.oldest')}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-xl text-sm ring-1 ring-line">
                {d.oldest.map((p) => (
                  <li key={p._id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link to={`/properties/${p._id}`} className="min-w-0 truncate hover:text-brand-600">
                      <span className="ltr-nums me-2 font-bold text-brand-600">{p.propertyId}</span>
                      {[p.society, p.block].filter(Boolean).join(', ')}
                    </Link>
                    <span className="ltr-nums shrink-0 text-xs font-semibold text-muted">{t('property.inventory.days', { n: p.days })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ═════════════ Deals: negotiation + checklist ═════════════ */

export function NegotiationPanel({ deal }: { deal: Deal }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canEdit = useCan(PERMISSIONS.DEALS_UPDATE);
  const [form, setForm] = useState({ party: 'BUYER', amount: '', note: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['deal', deal._id] });
  const add = useMutation({
    mutationFn: () => dealApi.addOffer(deal._id, { party: form.party, amount: Number(form.amount), note: form.note || undefined }),
    onSuccess: () => {
      setForm({ party: form.party === 'BUYER' ? 'SELLER' : 'BUYER', amount: '', note: '' });
      refresh();
    },
    onError,
  });
  const respond = useMutation({ mutationFn: (v: { id: string; status: 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' }) => dealApi.respondOffer(deal._id, v.id, v.status), onSuccess: refresh, onError });
  const offers = [...(deal.offers ?? [])].reverse();
  const color: Record<string, BadgeColor> = { OPEN: 'blue', ACCEPTED: 'green', REJECTED: 'red', COUNTERED: 'gray', WITHDRAWN: 'gray' };
  return (
    <Card title={t('deal.negotiation.title')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricTile label={t('deal.negotiation.asking')} value={deal.initialAskingPrice ? formatPkr(deal.initialAskingPrice) : '—'} />
        <MetricTile tone="brand" label={t('deal.agreedPrice')} value={deal.agreedPrice ? formatPkr(deal.agreedPrice) : '—'} />
        <MetricTile tone="good" label={t('deal.negotiation.gap')} value={deal.initialAskingPrice && deal.agreedPrice ? `${Math.round(((deal.initialAskingPrice - deal.agreedPrice) / deal.initialAskingPrice) * 1000) / 10}%` : '—'} />
      </div>
      {canEdit && (
        <form
          className="mb-4 grid gap-2 sm:grid-cols-[9rem_1fr_1.4fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(form.amount) > 0) add.mutate();
          }}
        >
          <Select label={t('deal.negotiation.party')} options={[{ value: 'BUYER', label: t('deal.negotiation.BUYER') }, { value: 'SELLER', label: t('deal.negotiation.SELLER') }]} value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} />
          <Input label={t('deal.negotiation.amount')} type="number" min={1} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Input label={t('common.notes')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button type="submit" loading={add.isPending}>{t('deal.negotiation.record')}</Button>
        </form>
      )}
      {!offers.length ? (
        <p className="text-sm text-muted">{t('deal.negotiation.empty')}</p>
      ) : (
        <ol className="relative space-y-3 border-s border-line ps-5">
          {offers.map((o) => (
            <li key={o._id} className="relative">
              <span className={`absolute -start-[1.65rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${o.party === 'BUYER' ? 'bg-brand-500' : 'bg-amber-500'}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{t(`deal.negotiation.${o.party}`)}</span>
                <span className="ltr-nums text-sm font-bold text-ink">{formatPkr(o.amount)}</span>
                <Badge color={color[o.status]}>{t(`deal.negotiation.status.${o.status}`)}</Badge>
                <span className="text-2xs text-muted">{relativeTime(o.at)}</span>
              </div>
              {o.note && <p className="mt-0.5 text-xs text-muted">{o.note}</p>}
              {canEdit && o.status === 'OPEN' && (
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" variant="secondary" icon={<ThumbsUp className="h-3.5 w-3.5" />} onClick={() => respond.mutate({ id: o._id, status: 'ACCEPTED' })}>{t('deal.negotiation.accept')}</Button>
                  <Button size="sm" variant="ghost" icon={<ThumbsDown className="h-3.5 w-3.5" />} onClick={() => respond.mutate({ id: o._id, status: 'REJECTED' })}>{t('deal.negotiation.reject')}</Button>
                  <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => respond.mutate({ id: o._id, status: 'WITHDRAWN' })}>{t('deal.negotiation.withdraw')}</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function ChecklistPanel({ deal }: { deal: Deal }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const canEdit = useCan(PERMISSIONS.DEALS_UPDATE);
  const [custom, setCustom] = useState('');
  const set = useMutation({
    mutationFn: (v: { key: string; done: boolean; label?: string }) => dealApi.setChecklist(deal._id, v.key, v.done, v.label),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deal', deal._id] }),
    onError,
  });
  const items = deal.checklist ?? [];
  const done = items.filter((i) => i.done).length;
  return (
    <Card title={t('deal.checklist.title')} actions={<span className="ltr-nums text-xs font-semibold text-muted">{done}/{items.length}</span>}>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink/[0.06] dark:bg-white/10">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.key}>
            <button
              disabled={!canEdit || set.isPending}
              onClick={() => set.mutate({ key: i.key, done: !i.done })}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-surface-2 disabled:cursor-default"
            >
              {i.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-subtle" />}
              <span className={i.done ? 'text-muted line-through' : 'text-ink'}>{i.label ?? t(`deal.checklist.items.${i.key}`, { defaultValue: i.key })}</span>
              {i.doneAt && <span className="ltr-nums ms-auto text-2xs text-muted">{formatDate(i.doneAt)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-3 flex gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const label = custom.trim();
            if (!label) return;
            set.mutate({ key: `CUSTOM_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40)}`, done: false, label });
            setCustom('');
          }}
        >
          <Input wrapperClassName="flex-1" placeholder={t('deal.checklist.add')} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button type="submit" variant="secondary">{t('common.add')}</Button>
        </form>
      )}
    </Card>
  );
}

/* ═════════════ Settings: subscription, automation & lead scoring ═════════════ */

export function SubscriptionSettings() {
  const { t } = useTranslation();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.BUSINESS_MANAGE);
  const q = useQuery({ queryKey: ['subscription'], queryFn: () => subscriptionApi.get() });
  const [cycle, setCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const request = useMutation({
    mutationFn: (plan: PlanKey) => subscriptionApi.request(plan, cycle),
    onSuccess: () => {
      toast.success(t('subscription.requested'));
      void q.refetch();
    },
    onError,
  });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;
  const s = q.data;
  const end = s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd;
  const days = end ? Math.ceil((+new Date(end) - Date.now()) / 86_400_000) : null;
  const usage: [string, number, number | null][] = [
    [t('subscription.users'), s.usage.users, s.limits.users],
    [t('subscription.branches'), s.usage.branches, s.limits.branches],
    [t('subscription.storage'), s.usage.storageMb, s.limits.storageMb],
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t('subscription.current')}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight">{t(`subscription.plans.${s.plan}`)}</p>
            <p className="text-sm text-muted">
              <Badge color={s.status === 'ACTIVE' || s.status === 'TRIAL' ? 'green' : s.status === 'PAST_DUE' ? 'amber' : 'red'}>{t(`subscription.status.${s.status}`)}</Badge>{' '}
              {days !== null && (days >= 0 ? t('subscription.daysLeft', { n: days }) : t('subscription.ended', { date: formatDate(end) }))}
            </p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:min-w-[22rem]">
            {usage.map(([label, used, limit]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="ltr-nums font-semibold">{used}{limit !== null ? ` / ${limit}` : ` · ${t('subscription.unlimited')}`}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06] dark:bg-white/10">
                  <div className={`h-full rounded-full ${limit && used / limit > 0.9 ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 8}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {!s.writable && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{t('subscription.readOnly')}</p>}
      </Card>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{t('subscription.compare')}</h3>
        <div className="flex gap-1">
          {BILLING_CYCLES.map((c) => (
            <button key={c} className={`chip ring-1 ring-inset ${cycle === c ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line'}`} onClick={() => setCycle(c)}>{t(`subscription.cycle.${c}`)}</button>
          ))}
        </div>
      </div>
      <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_KEYS.map((k) => {
          const p = s.plans[k];
          const current = k === s.plan;
          return (
            <div key={k} className={`card flex flex-col p-4 ${current ? 'ring-2 ring-brand-500' : ''}`}>
              <p className="font-bold">{t(`subscription.plans.${k}`)}</p>
              <p className="ltr-nums mt-1 text-xl font-extrabold">{formatPkr(cycle === 'MONTHLY' ? p.priceMonthly : p.priceAnnual)}<span className="text-xs font-medium text-muted"> / {t(`subscription.per.${cycle}`)}</span></p>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-ink-2">
                {p.modules.map((m) => <li key={m} className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{t(`subscription.modules.${m}`)}</li>)}
                <li className="pt-1 text-muted">{t('subscription.limitsLine', { users: p.limits.users ?? '∞', branches: p.limits.branches ?? '∞' })}</li>
              </ul>
              {canManage && !current && <Button className="mt-3" size="sm" variant="secondary" loading={request.isPending && request.variables === k} onClick={() => request.mutate(k)}>{t('subscription.request')}</Button>}
              {current && <p className="mt-3 text-center text-xs font-semibold text-brand-600">{t('subscription.yourPlan')}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">{t('subscription.billingNote')}</p>
      {s.history.length > 0 && (
        <Card title={t('subscription.history')}>
          <ul className="divide-y divide-line text-sm">
            {s.history.map((h) => (
              <li key={h._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{t(`subscription.events.${h.type}`)} · {t(`subscription.plans.${h.plan}`)}{h.cycle ? ` (${t(`subscription.cycle.${h.cycle}`)})` : ''}{h.reference ? ` · ${h.reference}` : ''}</span>
                <span className="ltr-nums text-xs text-muted">{h.amount ? `${formatPkr(h.amount)} · ` : ''}{formatDate(h.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function AutomationSettings({ settings, onSaved }: { settings: Settings; onSaved(s: Settings): void }) {
  const { t } = useTranslation();
  const onError = useOnError();
  const canManage = useCan(PERMISSIONS.SETTINGS_MANAGE);
  const [auto, setAuto] = useState(settings.automation);
  const [scoring, setScoring] = useState(settings.leadScoring);
  const save = useMutation({
    mutationFn: () => settingsApi.update({ automation: auto, leadScoring: scoring }),
    onSuccess: (s) => {
      toast.success(t('common.saved'));
      onSaved(s);
    },
    onError,
  });
  const total = useMemo(() => Object.values(scoring.weights).reduce((a, b) => a + b, 0), [scoring.weights]);
  return (
    <div className="space-y-4">
      <Card title={t('automation.title')}>
        <p className="mb-4 text-sm text-muted">{t('automation.hint')}</p>
        <ul className="divide-y divide-line">
          {AUTOMATION_RULE_KEYS.map((k) => {
            const def = AUTOMATION_RULES[k];
            return (
              <li key={k} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t(`automation.rules.${k}.title`)}</p>
                  <p className="text-xs text-muted">{t(`automation.rules.${k}.hint`)}</p>
                </div>
                <Input
                  wrapperClassName="w-28"
                  type="number"
                  min={def.min}
                  max={def.max}
                  disabled={!canManage}
                  value={auto[k].threshold}
                  onChange={(e) => setAuto({ ...auto, [k]: { ...auto[k], threshold: Number(e.target.value) } })}
                  aria-label={t(`automation.unit.${def.unit}`)}
                />
                <span className="w-14 text-xs text-muted">{t(`automation.unit.${def.unit}`)}</span>
                <Switch checked={auto[k].enabled} disabled={!canManage} onChange={(v) => setAuto({ ...auto, [k]: { ...auto[k], enabled: v } })} />
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title={t('lead.scoring.title')}>
        <p className="mb-4 text-sm text-muted">{t('lead.scoring.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEAD_SCORE_FACTORS.map((f) => (
            <Input key={f} type="number" min={0} max={100} disabled={!canManage} label={t(`lead.factors.${f}`)} value={scoring.weights[f]} hint={total ? `${Math.round((scoring.weights[f] / total) * 100)}%` : undefined} onChange={(e) => setScoring({ ...scoring, weights: { ...scoring.weights, [f]: Number(e.target.value) } })} />
          ))}
          <Input type="number" min={1} max={100} disabled={!canManage} label={t('lead.scoring.hot')} value={scoring.hotThreshold} onChange={(e) => setScoring({ ...scoring, hotThreshold: Number(e.target.value) })} />
          <Input type="number" min={0} max={99} disabled={!canManage} label={t('lead.scoring.warm')} value={scoring.warmThreshold} onChange={(e) => setScoring({ ...scoring, warmThreshold: Number(e.target.value) })} />
        </div>
      </Card>
      {canManage && <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}
    </div>
  );
}

/* ═════════════ Platform administration (Stateown staff) ═════════════ */

export function PlatformPage() {
  const { t } = useTranslation();
  const onError = useOnError();
  const platformAdmin = useAuth((s) => s.platformAdmin);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['platform', page, q], queryFn: () => subscriptionApi.businesses({ page, limit: 20, q }), enabled: platformAdmin });
  const [editing, setEditing] = useState<{ id: string; name: string; plan: string; status: string; cycle: string; currentPeriodEnd: string; amount: string; reference: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      subscriptionApi.setSubscription(editing!.id, {
        plan: editing!.plan,
        status: editing!.status,
        cycle: editing!.cycle || null,
        currentPeriodEnd: editing!.currentPeriodEnd || null,
        amount: editing!.amount ? Number(editing!.amount) : null,
        reference: editing!.reference || null,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setEditing(null);
      void list.refetch();
    },
    onError,
  });
  if (!platformAdmin) return <EmptyState title={t('platform.only')} />;
  return (
    <div>
      <PageHeader title={t('platform.title')} subtitle={t('platform.subtitle')} />
      <Input wrapperClassName="mb-4 max-w-sm" placeholder={t('common.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <Card bodyClassName="!p-0">
        <ul className="divide-y divide-line">
          {(list.data?.items ?? []).map((b) => (
            <li key={b._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={b.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{b.name}</p>
                <p className="text-xs text-muted">{b.city ?? '—'} · {formatDate(b.createdAt)}</p>
              </div>
              <Badge color="purple">{t(`subscription.plans.${b.plan}`)}</Badge>
              <Badge color={b.writable ? 'green' : 'red'}>{t(`subscription.status.${b.status}`)}</Badge>
              <Button size="sm" variant="secondary" onClick={() => setEditing({ id: b._id, name: b.name, plan: b.plan, status: b.status === 'EXPIRED' ? 'ACTIVE' : b.status, cycle: b.cycle ?? 'MONTHLY', currentPeriodEnd: (b.currentPeriodEnd ?? '').slice(0, 10), amount: '', reference: '' })}>
                {t('platform.manage')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} limit={20} onChange={setPage} />}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ''} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('subscription.plan')} options={PLAN_KEYS.map((k) => ({ value: k, label: t(`subscription.plans.${k}`) }))} value={editing.plan} onChange={(e) => setEditing({ ...editing, plan: e.target.value })} />
            <Select label={t('common.status')} options={SUBSCRIPTION_STATUSES.map((k) => ({ value: k, label: t(`subscription.status.${k}`) }))} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} />
            <Select label={t('subscription.billing')} options={BILLING_CYCLES.map((k) => ({ value: k, label: t(`subscription.cycle.${k}`) }))} value={editing.cycle} onChange={(e) => setEditing({ ...editing, cycle: e.target.value })} />
            <Input label={t('platform.paidUntil')} type="date" value={editing.currentPeriodEnd} onChange={(e) => setEditing({ ...editing, currentPeriodEnd: e.target.value })} />
            <Input label={t('platform.amount')} type="number" min={0} value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
            <Input label={t('platform.reference')} value={editing.reference} onChange={(e) => setEditing({ ...editing, reference: e.target.value })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
