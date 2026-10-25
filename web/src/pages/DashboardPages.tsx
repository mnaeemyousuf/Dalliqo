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
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { formatRange, formatTime, relativeTime } from '@/lib/format';
import { useCategories, useOnError } from '@/lib/hooks';
import { useCan } from '@/store/auth';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';
import { useQueryClient } from '@tanstack/react-query';

// Chart colours start from the Dalliqo palette (primary blue, amber accent, status colours).
const PALETTE = [BRAND.color.primary['500'], BRAND.color.accent['500'], BRAND.color.status.success, '#8B5CF6', BRAND.color.status.danger, '#0891B2', '#64748B', '#DB2777', '#65A30D'];

function useChartTheme() {
  const theme = useUi((s) => s.theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return {
    text: dark ? '#cbd5e1' : '#334155',
    line: dark ? '#334155' : '#e2e8f0',
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
        textStyle: { color: c.text, fontFamily: lang === 'ur' ? 'Noto Nastaliq Urdu' : '"Plus Jakarta Sans", system-ui, sans-serif' },
        tooltip: { trigger: 'item' },
        grid: { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 },
        ...option,
      }}
    />
  );
}

function axis(c: ReturnType<typeof useChartTheme>) {
  return { axisLine: { lineStyle: { color: c.line } }, splitLine: { lineStyle: { color: c.line } }, axisLabel: { color: c.text } };
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<'7d' | '30d' | '12m'>('30d');
  const canReports = useCan(PERMISSIONS.REPORTS_READ);
  const c = useChartTheme();
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: dashboardApi.summary, refetchInterval: 60_000 });
  const analytics = useQuery({ queryKey: ['dashboard', 'analytics', range], queryFn: () => dashboardApi.analytics(range), enabled: canReports });

  if (summary.isLoading) return <PageLoader />;
  if (summary.isError) return <ErrorState onRetry={() => summary.refetch()} />;
  const s = summary.data!;
  const a = analytics.data;
  const i = 'h-5 w-5';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Link to="/my-day" className="btn-secondary">
            <Sparkles className="h-4 w-4" /> {t('dashboard.myDay')}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('dashboard.totalProperties')} value={s.properties.total} icon={<Home className={i} />} to="/properties" />
        <Stat label={t('dashboard.available')} value={s.properties.available} icon={<CheckCircle2 className={i} />} tone="green" to="/properties?status=AVAILABLE" />
        <Stat label={t('dashboard.sold')} value={s.properties.sold} icon={<Handshake className={i} />} tone="blue" to="/properties?status=SOLD" />
        <Stat label={t('dashboard.rented')} value={s.properties.rented} icon={<KeyRound className={i} />} tone="purple" to="/properties?status=RENTED" />
        <Stat label={t('dashboard.needsVerification')} value={s.properties.needsVerification} icon={<AlarmClock className={i} />} tone="amber" to="/properties?verification=stale&view=table" />
        <Stat label={t('dashboard.totalClients')} value={s.clients.total} icon={<Users className={i} />} to="/clients" />
        <Stat label={t('dashboard.buyers')} value={s.clients.buyers} icon={<UserPlus className={i} />} tone="green" to="/clients?purpose=PURCHASE" />
        <Stat label={t('dashboard.rentalClients')} value={s.clients.rental} icon={<KeyRound className={i} />} tone="purple" to="/clients?purpose=RENTAL" />
        <Stat label={t('dashboard.owners')} value={s.clients.owners} icon={<Building2 className={i} />} tone="blue" to="/owners" />
        <Stat label={t('dashboard.todaysFollowUps')} value={s.followUps.today} icon={<CalendarCheck className={i} />} tone="amber" to="/followups?tab=today" />
        <Stat label={t('dashboard.overdueFollowUps')} value={s.followUps.overdue} icon={<AlarmClock className={i} />} tone="red" to="/followups?tab=overdue" />
        <Stat label={t('dashboard.newClientsToday')} value={s.today.newClients} icon={<UserPlus className={i} />} />
        <Stat label={t('dashboard.newPropertiesToday')} value={s.today.newProperties} icon={<Home className={i} />} />
        <Stat label={t('dashboard.newMatchesToday')} value={s.today.newMatches} icon={<Handshake className={i} />} tone="green" to="/matches" />
      </div>

      {canReports && (
        <>
          <div className="flex justify-end">
            <Tabs
              value={range}
              onChange={setRange}
              tabs={[
                { value: '7d', label: t('dashboard.range7d') },
                { value: '30d', label: t('dashboard.range30d') },
                { value: '12m', label: t('dashboard.range12m') },
              ]}
            />
          </div>
          {analytics.isLoading ? (
            <PageLoader />
          ) : analytics.isError || !a ? (
            <ErrorState onRetry={() => analytics.refetch()} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('dashboard.propertyDistribution')}>
                {a.propertyDistribution.length ? (
                  <Chart
                    option={{
                      legend: { bottom: 0, textStyle: { color: c.text } },
                      series: [{ type: 'pie', center: ['50%', '42%'], radius: ['38%', '62%'], itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 }, label: { show: false }, data: a.propertyDistribution.map((d) => ({ name: t(`enums.propertyType.${d.type}`), value: d.count })) }],
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
                    series: [{ type: 'bar', barMaxWidth: 40, itemStyle: { borderRadius: [6, 6, 0, 0] }, data: a.propertyStatus.map((d) => d.count) }],
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
                    series: [{ type: 'bar', barMaxWidth: 22, itemStyle: { borderRadius: [0, 6, 6, 0], color: PALETTE[1] }, data: a.clientCategories.map((d) => d.count) }],
                  }}
                />
              </Card>
              <Card title={t('dashboard.followUpPerformance')}>
                <Chart
                  option={{
                    tooltip: { trigger: 'axis' },
                    legend: { bottom: 0, textStyle: { color: c.text } },
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
                    legend: { bottom: 0, textStyle: { color: c.text } },
                    grid: { containLabel: true, left: 8, right: 16, top: 20, bottom: 44 },
                    xAxis: { type: 'category', data: a.newRecords.map((d) => d.period.slice(5) || d.period), ...axis(c) },
                    yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                    series: (['clients', 'properties', 'matches'] as const).map((k) => ({
                      name: t(`nav.${k}`),
                      type: 'line',
                      smooth: true,
                      symbolSize: 6,
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
                      legend: { bottom: 0, textStyle: { color: c.text } },
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
                      <thead className="text-start text-xs text-muted">
                        <tr>
                          <th className="py-2 text-start font-medium">{t('dashboard.member')}</th>
                          <th className="py-2 text-end font-medium">{t('dashboard.followUpsCompleted')}</th>
                          <th className="py-2 text-end font-medium">{t('dashboard.followUpsOverdue')}</th>
                          <th className="py-2 text-end font-medium">{t('dashboard.activeClients')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {a.teamPerformance.map((r) => (
                          <tr key={r.userId}>
                            <td className="py-2 font-medium">{r.name}</td>
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
      <p className="text-end text-xs text-muted">{t('dashboard.updatedAt', { time: relativeTime(s.generatedAt) })}</p>
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
    <li className="flex items-center gap-3 py-2.5">
      <span className="ltr-nums flex w-16 shrink-0 items-center gap-1 text-xs text-muted">
        <Clock className="h-3.5 w-3.5" /> {formatTime(f.dueAt)}
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
      <Button size="sm" variant="secondary" onClick={done}>
        {t('followup.complete')}
      </Button>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card title={`${title} (${count})`} bodyClassName="!py-1">
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
    items.length ? <ul className="divide-y divide-line">{items.map((f) => <FollowUpRow key={f._id} f={f} />)}</ul> : <p className="py-4 text-sm text-muted">{t('myDay.nothing')}</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('myDay.title')}
        subtitle={t('myDay.subtitle')}
        actions={<Tabs value={scope} onChange={setScope} tabs={[{ value: 'mine', label: t('myDay.mine') }, { value: 'all', label: t('myDay.everyone') }]} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('myDay.overdue')} count={d.overdueFollowUps.length}>{list(d.overdueFollowUps)}</Section>
        <Section title={t('myDay.todaysFollowUps')} count={d.todaysFollowUps.length}>{list(d.todaysFollowUps)}</Section>
        <Section title={t('myDay.meetings')} count={d.todaysMeetings.length}>{list(d.todaysMeetings)}</Section>
        <Section title={t('myDay.visits')} count={d.propertyVisits.length}>{list(d.propertyVisits)}</Section>
      </div>
      <Card title={`${t('myDay.newMatches')} (${d.newMatches.length})`}>
        {d.newMatches.length ? <div className="space-y-2">{d.newMatches.map((m) => <MatchCard key={m._id} match={m} perspective="client" />)}</div> : <p className="text-sm text-muted">{t('myDay.nothing')}</p>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${t('myDay.newClients')} (${d.newClients.length})`}>
          {d.newClients.length ? (
            <ul className="divide-y divide-line">
              {d.newClients.map((c) => (
                <li key={c._id} className="flex justify-between py-2 text-sm">
                  <Link to={`/clients/${c._id}`} className="font-medium hover:underline">{c.fullName}</Link>
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
