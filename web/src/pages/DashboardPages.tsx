import { useQuery } from '@tanstack/react-query';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// Only the chart types the dashboard uses, to keep the bundle small.
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
import {
  AlarmClock,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Handshake,
  Home,
  KeyRound,
  Sparkles,
  UserPlus,
  Users,
  Clock,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PERMISSIONS, BRAND } from '@recrm/shared';
import { dashboardApi, followUpApi } from '@/api/endpoints';
import type { FollowUp } from '@/api/types';
import { MatchCard, PropertyCard, Stat } from '@/components/domain';
import { Avatar, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Segmented, Skeleton } from '@/components/ui';
import { formatRange, formatTime, relativeTime, formatPkr } from '@/lib/format';
import { useCategories, useOnError } from '@/lib/hooks';
import { useAuth, useCan } from '@/store/auth';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';
import { useQueryClient } from '@tanstack/react-query';

// Chart colours start from the Dalliqo palette (primary blue, amber accent, status colours).
const PALETTE = [BRAND.color.primary['500'], BRAND.color.accent['500'], BRAND.color.status.success, '#8B5CF6', BRAND.color.status.danger, '#0891B2', '#64748B', '#DB2777', '#65A30D'];

function useChartTheme() {
  const theme = useUi((s) => s.theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return {
    dark,
    text: dark ? '#94a3b8' : '#64748b',
    line: dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.14)',
    surface: dark ? '#141a29' : '#ffffff',
    border: dark ? '#273047' : '#e6e9ef',
    ink: dark ? '#eef2f8' : '#0d1220',
  };
}

function Chart({ option, height = 280 }: { option: Record<string, unknown>; height?: number }) {
  const c = useChartTheme();
  const lang = useUi((s) => s.lang);
  return (
    <ReactEChartsCore
      echarts={echarts}
      notMerge
      style={{ height }}
      option={{
        color: PALETTE,
        animationDuration: 700,
        animationEasing: 'cubicOut',
        textStyle: { color: c.text, fontFamily: lang === 'ur' ? 'Noto Nastaliq Urdu' : '"Plus Jakarta Sans", system-ui, sans-serif', fontSize: 11 },
        tooltip: {
          trigger: 'item',
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: c.ink, fontSize: 12 },
          extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -8px rgba(15,23,42,.25);',
        },
        grid: { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 },
        ...option,
      }}
    />
  );
}

function axis(c: ReturnType<typeof useChartTheme>) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
    axisLabel: { color: c.text, fontSize: 11 },
  };
}

/** Vertical gradient for bars and areas, from a brand colour to a lighter tint. */
function gradient(color: string, fade = 0.55) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color },
    { offset: 1, color: color + Math.round(fade * 255).toString(16).padStart(2, '0') },
  ]);
}

function KpiGroup({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="animate-rise space-y-3" style={style}>
      <h2 className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">{title}</h2>
      {children}
    </section>
  );
}

/** One full row of KPI tiles (so a group never leaves gaps). */
function KpiRow({ cols = 4, children }: { cols?: 3 | 4; children: React.ReactNode }) {
  return <div className={`stagger grid grid-cols-2 gap-3 ${cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>{children}</div>;
}

function greetingKey() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<'7d' | '30d' | '12m'>('30d');
  const canReports = useCan(PERMISSIONS.REPORTS_READ);
  const user = useAuth((s) => s.user);
  const c = useChartTheme();
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: dashboardApi.summary, refetchInterval: 60_000 });
  const analytics = useQuery({ queryKey: ['dashboard', 'analytics', range], queryFn: () => dashboardApi.analytics(range), enabled: canReports });

  if (summary.isLoading) return <PageLoader />;
  if (summary.isError) return <ErrorState onRetry={() => summary.refetch()} />;
  const s = summary.data!;
  const a = analytics.data;
  const i = 'h-4 w-4';
  const first = user?.fullName?.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString(i18n.language === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const st = (n: number) => ({ ['--i' as string]: n }) as React.CSSProperties;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card md:p-8">
        <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 end-40 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-600">{today}</p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight md:text-3xl">{t(`dashboard.greeting.${greetingKey()}`, { name: first })}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              {t('dashboard.heroSummary', { today: s.followUps.today, overdue: s.followUps.overdue, matches: s.today.newMatches })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/my-day" className="btn-primary">
              <Sparkles className="h-4 w-4" /> {t('dashboard.myDay')}
            </Link>
            {s.followUps.overdue > 0 && (
              <Link to="/followups?tab=overdue" className="btn-secondary text-red-600">
                <AlarmClock className="h-4 w-4" /> {t('dashboard.overdueFollowUps')} · <span className="ltr-nums">{s.followUps.overdue}</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <KpiGroup title={t('dashboard.groups.portfolio')} style={st(1)}>
        <KpiRow>
        <Stat label={t('dashboard.totalProperties')} value={s.properties.total} icon={<Home className={i} />} to="/properties" />
        <Stat label={t('dashboard.available')} value={s.properties.available} icon={<CheckCircle2 className={i} />} tone="green" to="/properties?status=AVAILABLE" />
        <Stat label={t('dashboard.sold')} value={s.properties.sold} icon={<Handshake className={i} />} tone="blue" to="/properties?status=SOLD" />
        <Stat label={t('dashboard.rented')} value={s.properties.rented} icon={<KeyRound className={i} />} tone="purple" to="/properties?status=RENTED" />
        </KpiRow>
        <KpiRow cols={3}>
        <Stat label={t('dashboard.needsVerification')} value={s.properties.needsVerification} icon={<AlarmClock className={i} />} tone="amber" to="/properties?verification=stale&view=table" />
        <Stat label={t('dashboard.newPropertiesToday')} value={s.today.newProperties} icon={<Home className={i} />} />
        <Stat label={t('dashboard.newMatchesToday')} value={s.today.newMatches} icon={<Handshake className={i} />} tone="green" to="/matches" />
        </KpiRow>
      </KpiGroup>

      <KpiGroup title={t('dashboard.groups.clients')} style={st(2)}>
        <KpiRow>
        <Stat label={t('dashboard.totalClients')} value={s.clients.total} icon={<Users className={i} />} to="/clients" />
        <Stat label={t('dashboard.buyers')} value={s.clients.buyers} icon={<UserPlus className={i} />} tone="green" to="/clients?purpose=PURCHASE" />
        <Stat label={t('dashboard.rentalClients')} value={s.clients.rental} icon={<KeyRound className={i} />} tone="purple" to="/clients?purpose=RENTAL" />
        <Stat label={t('dashboard.owners')} value={s.clients.owners} icon={<Building2 className={i} />} tone="blue" to="/owners" />
        </KpiRow>
        <KpiRow cols={3}>
        <Stat label={t('dashboard.todaysFollowUps')} value={s.followUps.today} icon={<CalendarCheck className={i} />} tone="amber" to="/followups?tab=today" />
        <Stat label={t('dashboard.overdueFollowUps')} value={s.followUps.overdue} icon={<AlarmClock className={i} />} tone="red" to="/followups?tab=overdue" />
        <Stat label={t('dashboard.newClientsToday')} value={s.today.newClients} icon={<UserPlus className={i} />} />
        </KpiRow>
      </KpiGroup>

      {(s.deals || s.finance || s.agreements) && (
        <KpiGroup title={t('dashboard.groups.business')} style={st(3)}>
          {s.deals && (
            <KpiRow>
              <Stat label={t('dashboard.openDeals')} value={s.deals.open} icon={<Handshake className={i} />} tone="purple" to="/deals" />
              <Stat label={t('dashboard.dealsWonThisMonth')} value={s.deals.wonThisMonth} icon={<CheckCircle2 className={i} />} tone="green" to="/deals?view=table&stage=CLOSED_WON" />
              <Stat label={t('dashboard.commissionThisMonth')} value={<span className="ltr-nums">{formatPkr(s.deals.receivedThisMonth)}</span>} icon={<CheckCircle2 className={i} />} tone="green" to="/reports" />
              <Stat label={t('dashboard.commissionOutstanding')} value={<span className="ltr-nums">{formatPkr(s.deals.outstanding)}</span>} icon={<AlarmClock className={i} />} tone="amber" to="/deals?view=table&commissionStatus=PARTIALLY_RECEIVED" />
            </KpiRow>
          )}
          {s.finance && (
            <KpiRow cols={3}>
              <Stat label={t('dashboard.incomeThisMonth')} value={<span className="ltr-nums">{formatPkr(s.finance.incomeThisMonth)}</span>} icon={<CheckCircle2 className={i} />} tone="green" to="/finance?type=INCOME" />
              <Stat label={t('dashboard.expenseThisMonth')} value={<span className="ltr-nums">{formatPkr(s.finance.expenseThisMonth)}</span>} icon={<AlarmClock className={i} />} tone="red" to="/finance?type=EXPENSE" />
              <Stat label={t('dashboard.netThisMonth')} value={<span className={`ltr-nums ${s.finance.netThisMonth < 0 ? 'text-red-600' : ''}`}>{formatPkr(s.finance.netThisMonth)}</span>} icon={<Handshake className={i} />} tone={s.finance.netThisMonth < 0 ? 'red' : 'blue'} to="/finance?tab=report" />
            </KpiRow>
          )}
          {s.agreements && (
            <KpiRow cols={3}>
              <Stat label={t('dashboard.agreementDrafts')} value={s.agreements.drafts} icon={<CalendarCheck className={i} />} to="/agreements?status=DRAFT" />
              <Stat label={t('dashboard.agreementsAwaitingSignature')} value={s.agreements.awaitingSignature} icon={<AlarmClock className={i} />} tone="blue" to="/agreements?status=SENT" />
              <Stat label={t('dashboard.agreementsExpiring')} value={s.agreements.expiringSoon} icon={<AlarmClock className={i} />} tone="amber" to="/agreements?expiring=1" />
            </KpiRow>
          )}
        </KpiGroup>
      )}

      {canReports && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight">{t('dashboard.analytics')}</h2>
              <p className="text-sm text-muted">{t('dashboard.analyticsHint')}</p>
            </div>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: '7d', label: t('dashboard.range7d') },
                { value: '30d', label: t('dashboard.range30d') },
                { value: '12m', label: t('dashboard.range12m') },
              ]}
            />
          </div>
          {analytics.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((k) => <div key={k} className="card h-[340px] p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-6 h-[250px] w-full" /></div>)}</div>
          ) : analytics.isError || !a ? (
            <ErrorState onRetry={() => analytics.refetch()} />
          ) : (
            <div className="stagger grid gap-4 lg:grid-cols-2">
              <Card title={t('dashboard.propertyDistribution')}>
                {a.propertyDistribution.length ? (
                  <Chart
                    option={{
                      legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: c.text } },
                      series: [{ type: 'pie', center: ['50%', '42%'], radius: ['48%', '70%'], padAngle: 2, itemStyle: { borderRadius: 8, borderColor: c.surface, borderWidth: 2 }, label: { show: false }, emphasis: { scale: true, scaleSize: 6 }, data: a.propertyDistribution.map((d) => ({ name: t(`enums.propertyType.${d.type}`), value: d.count })) }],
                    }}
                  />
                ) : (
                  <EmptyState title={t('dashboard.noData')} />
                )}
              </Card>
              <Card title={t('dashboard.propertyStatus')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: a.propertyStatus.map((d) => t(`enums.propertyStatus.${d.status}`)), ...axis(c) },
                    yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: [{ type: 'bar', barMaxWidth: 36, itemStyle: { borderRadius: [8, 8, 2, 2], color: gradient(PALETTE[0]) }, data: a.propertyStatus.map((d) => d.count) }],
                  }}
                />
              </Card>
              <Card title={t('dashboard.clientCategories')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    grid: { containLabel: true, left: 8, right: 24, top: 8, bottom: 8 },
                    yAxis: { type: 'category', data: a.clientCategories.map((d) => d.name), ...axis(c) },
                    xAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: [{ type: 'bar', barMaxWidth: 18, itemStyle: { borderRadius: [2, 8, 8, 2], color: PALETTE[1] }, data: a.clientCategories.map((d) => d.count) }],
                  }}
                />
              </Card>
              <Card title={t('dashboard.followUpPerformance')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: c.text } },
                    grid: { containLabel: true, left: 8, right: 16, top: 20, bottom: 44 },
                    xAxis: { type: 'category', data: a.followUpPerformance.map((d) => d.period.slice(5) || d.period), ...axis(c) },
                    yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: (['completed', 'overdue', 'pending', 'cancelled'] as const).map((k, idx) => ({
                      name: t(`dashboard.${k}`),
                      type: 'bar',
                      stack: 'f',
                      color: ['#16a34a', '#ef4444', '#f59e0b', '#94a3b8'][idx],
                      data: a.followUpPerformance.map((d) => d[k]),
                    })),
                  }}
                />
              </Card>
              <Card title={t('dashboard.newRecords')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: c.text } },
                    grid: { containLabel: true, left: 8, right: 16, top: 20, bottom: 44 },
                    xAxis: { type: 'category', data: a.newRecords.map((d) => d.period.slice(5) || d.period), ...axis(c) },
                    yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: (['clients', 'properties', 'matches'] as const).map((k) => ({
                      name: t(`nav.${k}`),
                      type: 'line',
                      smooth: true,
                      showSymbol: false,
                      lineStyle: { width: 2.5 },
                      areaStyle: { opacity: 0.08 },
                      data: a.newRecords.map((d) => d[k]),
                    })),
                  }}
                />
              </Card>
              <Card title={t('dashboard.matchQuality')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: a.matchQuality.map((d) => t(`enums.matchBand.${d.band}`)), ...axis(c) },
                    yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: [{ type: 'bar', barMaxWidth: 40, itemStyle: { borderRadius: [6, 6, 0, 0] }, data: a.matchQuality.map((d, idx) => ({ value: d.count, itemStyle: { color: [BRAND.color.status.success, BRAND.color.primary['500'], '#8B5CF6', BRAND.color.accent['500']][idx] } })) }],
                  }}
                />
              </Card>
              <Card title={t('dashboard.leadSources')}>
                {a.leadSources.length ? (
                  <Chart
                    option={{
                      tooltip: { trigger: 'axis' },
                      legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: c.text } },
                      grid: { containLabel: true, left: 8, right: 24, top: 8, bottom: 44 },
                      yAxis: { type: 'category', data: a.leadSources.map((d) => t(`enums.source.${d.source}`)), ...axis(c) },
                      xAxis: { type: 'value', minInterval: 1, ...axis(c) },
                      series: (['won', 'active', 'lost'] as const).map((k, idx) => ({
                        name: t(`dashboard.${k}`),
                        type: 'bar',
                        stack: 's',
                        barMaxWidth: 22,
                        color: [BRAND.color.status.success, BRAND.color.primary['500'], BRAND.color.status.danger][idx],
                        data: a.leadSources.map((d) => d[k]),
                      })),
                    }}
                  />
                ) : (
                  <EmptyState title={t('dashboard.noData')} />
                )}
              </Card>
              <Card title={t('dashboard.teamPerformance')}>
                {a.teamPerformance.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-2xs font-semibold uppercase tracking-[0.06em] text-muted">
                        <tr>
                          <th className="pb-2.5 text-start font-semibold">{t('dashboard.member')}</th>
                          <th className="pb-2.5 text-end font-semibold">{t('dashboard.followUpsCompleted')}</th>
                          <th className="pb-2.5 text-end font-semibold">{t('dashboard.followUpsOverdue')}</th>
                          <th className="pb-2.5 text-end font-semibold">{t('dashboard.activeClients')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {a.teamPerformance.map((r) => (
                          <tr key={r.userId}>
                            <td className="py-2.5"><span className="flex items-center gap-2.5 font-semibold"><Avatar name={r.name} size="sm" />{r.name}</span></td>
                            <td className="ltr-nums py-2 text-end">{r.followUpsCompleted}</td>
                            <td className={`ltr-nums py-2 text-end ${r.followUpsOverdue ? 'font-semibold text-red-600' : ''}`}>{r.followUpsOverdue}</td>
                            <td className="ltr-nums py-2 text-end">{r.activeClients}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title={t('dashboard.noData')} />
                )}
              </Card>
            </div>
          )}
        </>
      )}
      <p className="flex items-center justify-end gap-1.5 text-2xs font-medium text-subtle"><span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-emerald-500" />{t('dashboard.updatedAt', { time: relativeTime(s.generatedAt) })}</p>
    </div>
  );
}

function FollowUpRow({ f }: { f: FollowUp }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const client = typeof f.clientId === 'object' ? f.clientId : null;
  const property = typeof f.propertyId === 'object' ? f.propertyId : null;
  const done = async () => {
    try {
      await followUpApi.complete(f._id);
      toast.success(t('followup.completed'));
      void qc.invalidateQueries({ queryKey: ['myDay'] });
    } catch (e) {
      onError(e);
    }
  };
  return (
    <li className="group flex items-center gap-3 rounded-lg py-2.5 transition-colors">
      <span className="ltr-nums flex w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-lg bg-surface-2 py-1.5 text-xs font-semibold text-ink-2 ring-1 ring-inset ring-line">
        <Clock className="h-3.5 w-3.5 text-subtle" /> {formatTime(f.dueAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {t(`enums.followUpType.${f.type}`)} · {client ? <Link to={`/clients/${client._id}`} className="hover:underline">{client.fullName}</Link> : '—'}
        </p>
        <p className="truncate text-xs text-muted">
          {property && <span className="ltr-nums">{property.propertyId} · </span>}
          {f.notes}
        </p>
      </div>
      <Button size="sm" variant="secondary" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />} onClick={done} className="opacity-90 group-hover:opacity-100">
        {t('followup.complete')}
      </Button>
    </li>
  );
}

function Section({ title, count, children, tone = 'gray' }: { title: string; count: number; children: React.ReactNode; tone?: 'gray' | 'red' | 'amber' | 'blue' | 'purple' }) {
  const dot = { gray: 'bg-slate-400', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500', purple: 'bg-violet-500' }[tone];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {title}
          <span className="ltr-nums rounded-full bg-ink/[0.06] px-2 py-px text-2xs font-bold text-ink-2 dark:bg-white/10">{count}</span>
        </span>
      }
      bodyClassName="!py-1"
    >
      {children}
    </Card>
  );
}

export function MyDayPage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const cats = useCategories();
  const q = useQuery({ queryKey: ['myDay', scope], queryFn: () => dashboardApi.myDay(scope), refetchInterval: 60_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data!;
  const list = (items: FollowUp[]) =>
    items.length ? <ul className="divide-y divide-line">{items.map((f) => <FollowUpRow key={f._id} f={f} />)}</ul> : <p className="flex items-center gap-2 py-5 text-sm text-muted"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{t('myDay.nothing')}</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('myDay.title')}
        subtitle={t('myDay.subtitle')}
        actions={<Segmented value={scope} onChange={setScope} options={[{ value: 'mine', label: t('myDay.mine') }, { value: 'all', label: t('myDay.everyone') }]} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section tone="red" title={t('myDay.overdue')} count={d.overdueFollowUps.length}>{list(d.overdueFollowUps)}</Section>
        <Section tone="amber" title={t('myDay.todaysFollowUps')} count={d.todaysFollowUps.length}>{list(d.todaysFollowUps)}</Section>
        <Section tone="blue" title={t('myDay.meetings')} count={d.todaysMeetings.length}>{list(d.todaysMeetings)}</Section>
        <Section tone="purple" title={t('myDay.visits')} count={d.propertyVisits.length}>{list(d.propertyVisits)}</Section>
      </div>
      <Card title={`${t('myDay.newMatches')} (${d.newMatches.length})`}>
        {d.newMatches.length ? <div className="space-y-2">{d.newMatches.map((m) => <MatchCard key={m._id} match={m} perspective="client" />)}</div> : <p className="text-sm text-muted">{t('myDay.nothing')}</p>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${t('myDay.newClients')} (${d.newClients.length})`}>
          {d.newClients.length ? (
            <ul className="divide-y divide-line">
              {d.newClients.map((c) => (
                <li key={c._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link to={`/clients/${c._id}`} className="flex items-center gap-2.5 font-semibold hover:text-brand-600"><Avatar name={c.fullName} size="sm" />{c.fullName}</Link>
                  <span className="text-muted">{cats.name(c.categoryId) ?? '—'} · {formatRange(c.minBudget, c.maxBudget)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('myDay.nothing')}</p>
          )}
        </Card>
        <Card title={`${t('myDay.newProperties')} (${d.newProperties.length})`}>
          {d.newProperties.length ? <div className="grid gap-3 sm:grid-cols-2">{d.newProperties.slice(0, 4).map((p) => <PropertyCard key={p._id} property={p} />)}</div> : <p className="text-sm text-muted">{t('myDay.nothing')}</p>}
        </Card>
      </div>
    </div>
  );
}
