import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Users, Wallet } from 'lucide-react';
import { PERMISSIONS } from '@recrm/shared';
import { dashboardApi, financeReportApi, leaseApi } from '@/api/endpoints';
import { Card, MetricTile } from '@/components/ui';
import { formatPkr } from '@/lib/format';
import { useAuth, useCan, useModule } from '@/store/auth';

/** Panels picked by what the member does: agents see their commission, managers their team, finance its collections. */
export function RoleDashboards() {
  const role = useAuth((s) => s.membership?.role);
  const readAll = useCan(PERMISSIONS.DEALS_READ_ALL);
  const canDeals = useCan(PERMISSIONS.DEALS_READ);
  const dealsModule = useModule('deals');
  const canFinance = useCan(PERMISSIONS.FINANCE_READ);
  const canReports = useCan(PERMISSIONS.REPORTS_READ);
  const financeModule = useModule('finance');
  const canMembers = useCan(PERMISSIONS.MEMBERS_READ);
  const deals = canDeals && dealsModule;
  // The collections panel reads the receivables report, which needs reports access as well.
  const finance = canFinance && financeModule && canReports;
  const team = readAll || canMembers;
  const financeFirst = role === 'ACCOUNTANT' || role === 'FINANCE_MANAGER';
  const panels = [
    deals && !readAll && <MyCommissionPanel key="mine" />,
    financeFirst && finance && <FinancePanel key="fin" />,
    team && deals && <TeamPanel key="team" />,
    !financeFirst && finance && readAll && <FinancePanel key="fin2" />,
  ].filter(Boolean);
  if (!panels.length) return null;
  return <div className="space-y-4">{panels}</div>;
}

function MyCommissionPanel() {
  const { t } = useTranslation();
  const me = useAuth((s) => s.user?._id ?? '');
  const q = useQuery({ queryKey: ['reports', 'agent-statement', me], queryFn: () => financeReportApi.agentStatement({ userId: me }), enabled: !!me });
  const s = q.data;
  if (!s) return null;
  const open = s.rows.filter((r) => !['CLOSED_WON', 'CLOSED_LOST'].includes(r.stage)).length;
  return (
    <Card title={<span className="flex items-center gap-2"><HandCoins className="h-4 w-4 text-brand-600" />{t('roleDash.myCommission')}</span>} actions={<Link to="/reports" className="text-xs text-brand-600 hover:underline">{t('roleDash.statement')}</Link>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile tone="brand" label={t('roleDash.openDeals')} value={open} />
        <MetricTile label={t('deal.expected')} value={formatPkr(s.totals.expected)} />
        <MetricTile tone="good" label={t('finance5b.earned')} value={formatPkr(s.totals.earned)} />
        <MetricTile tone="warn" label={t('roleDash.owedToYou')} value={formatPkr(s.totals.owed)} />
      </div>
    </Card>
  );
}

function TeamPanel() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['dashboard', 'team'], queryFn: dashboardApi.team, refetchInterval: 120_000 });
  const d = q.data;
  if (!d || !d.rows.length) return null;
  const head = ['roleDash.member', 'roleDash.leads', 'roleDash.hot', 'roleDash.overdue', 'roleDash.doneWeek', 'roleDash.openDeals', 'roleDash.won', 'roleDash.commission'];
  return (
    <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-600" />{t('roleDash.team')}</span>} bodyClassName="!p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-2xs font-semibold uppercase tracking-wider text-muted">
            <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2 ${i ? 'text-end' : 'text-start'}`}>{t(h)}</th>)}</tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.userId} className="border-t border-line">
                <td className="px-4 py-2 font-medium">{r.fullName}<span className="block text-2xs font-normal text-muted">{t(`enums.role.${r.role}`, { defaultValue: r.role })}</span></td>
                <td className="ltr-nums px-4 py-2 text-end">{r.leads}</td>
                <td className="ltr-nums px-4 py-2 text-end">{r.hotLeads || '—'}</td>
                <td className={`ltr-nums px-4 py-2 text-end ${r.overdueFollowUps ? 'font-semibold text-red-600' : ''}`}>{r.overdueFollowUps || '—'}</td>
                <td className="ltr-nums px-4 py-2 text-end">{r.followUpsDoneThisWeek}</td>
                <td className="ltr-nums px-4 py-2 text-end">{r.openDeals}</td>
                <td className="ltr-nums px-4 py-2 text-end">{r.wonThisMonth || '—'}</td>
                <td className="ltr-nums whitespace-nowrap px-4 py-2 text-end font-semibold">{formatPkr(r.commissionThisMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FinancePanel() {
  const { t } = useTranslation();
  const rentalsModule = useModule('rentals');
  const canRentals = useCan(PERMISSIONS.RENTALS_READ);
  const rentals = rentalsModule && canRentals;
  const aging = useQuery({ queryKey: ['reports', 'aging'], queryFn: () => financeReportApi.aging() });
  const roll = useQuery({ queryKey: ['leases', 'rent-roll'], queryFn: () => leaseApi.rentRoll(), enabled: rentals });
  const a = aging.data;
  if (!a) return null;
  const late = (g: Record<string, number>) => Object.entries(g).filter(([k]) => k !== 'CURRENT').reduce((s, [, v]) => s + v, 0);
  return (
    <Card title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" />{t('roleDash.collections')}</span>} actions={<Link to="/reports" className="text-xs text-brand-600 hover:underline">{t('roleDash.details')}</Link>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricTile tone="brand" label={t('finance5b.receivables')} value={formatPkr(a.receivables.total)} />
        <MetricTile tone="bad" label={t('roleDash.lateInstallments')} value={formatPkr(late(a.receivables.installments))} />
        <MetricTile tone="bad" label={t('roleDash.lateRent')} value={formatPkr(roll.data?.overdue ?? late(a.receivables.rent))} />
        <MetricTile tone="warn" label={t('finance5b.payables')} value={formatPkr(a.payables.total)} />
        {roll.data && <MetricTile tone="good" label={t('rental.collectedThisMonth')} value={`${formatPkr(roll.data.collectedThisMonth)} / ${formatPkr(roll.data.dueThisMonth)}`} />}
      </div>
    </Card>
  );
}
