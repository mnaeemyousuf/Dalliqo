import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell,
  Building2,
  CalendarCheck,
  ChevronsLeft,
  CornerDownLeft,
  FileText,
  FolderOpen,
  Handshake,
  Home,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  SunMoon,
  UserCog,
  UserPlus,
  Users,
  X,
  Sparkles,
  HandCoins,
  Wallet,
  FileSignature,
  CalendarPlus,
  HousePlus,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PERMISSIONS, type Permission } from '@recrm/shared';
import { authApi, dashboardApi, notificationApi } from '@/api/endpoints';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BrandLogo } from '@/components/BrandLogo';
import { Avatar, Dropdown, MenuItem, Spinner } from '@/components/ui';
import { formatPkr } from '@/lib/format';
import { useDebounce } from '@/lib/hooks';
import { useRealtime } from '@/realtime/socket';
import { useAuth, useCan } from '@/store/auth';
import { useUi } from '@/store/ui';
import { BranchSwitcher } from '@/components/branches';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission;
}

function useNav(): { label: string; items: NavItem[] }[] {
  const { t } = useTranslation();
  const i = 'h-[18px] w-[18px] shrink-0';
  return [
    {
      label: t('nav.section.overview'),
      items: [
        { to: '/', label: t('nav.dashboard'), icon: <LayoutDashboard className={i} /> },
        { to: '/my-day', label: t('nav.myDay'), icon: <Sparkles className={i} /> },
      ],
    },
    {
      label: t('nav.section.workspace'),
      items: [
        { to: '/clients', label: t('nav.clients'), icon: <Users className={i} />, perm: PERMISSIONS.CLIENTS_READ },
        { to: '/properties', label: t('nav.properties'), icon: <Home className={i} />, perm: PERMISSIONS.PROPERTIES_READ },
        { to: '/owners', label: t('nav.owners'), icon: <Building2 className={i} />, perm: PERMISSIONS.OWNERS_READ },
        { to: '/matches', label: t('nav.matches'), icon: <Handshake className={i} />, perm: PERMISSIONS.MATCHES_READ },
        { to: '/followups', label: t('nav.followups'), icon: <CalendarCheck className={i} />, perm: PERMISSIONS.FOLLOWUPS_READ },
      ],
    },
    {
      label: t('nav.section.business'),
      items: [
        { to: '/deals', label: t('nav.deals'), icon: <HandCoins className={i} />, perm: PERMISSIONS.DEALS_READ },
        { to: '/agreements', label: t('nav.agreements'), icon: <FileSignature className={i} />, perm: PERMISSIONS.AGREEMENTS_READ },
        { to: '/finance', label: t('nav.finance'), icon: <Wallet className={i} />, perm: PERMISSIONS.FINANCE_READ },
        { to: '/documents', label: t('nav.documents'), icon: <FolderOpen className={i} />, perm: PERMISSIONS.DOCUMENTS_READ },
        { to: '/reports', label: t('nav.reports'), icon: <FileText className={i} />, perm: PERMISSIONS.EXPORTS_CREATE },
      ],
    },
    {
      label: t('nav.section.admin'),
      items: [
        { to: '/users', label: t('nav.users'), icon: <UserCog className={i} />, perm: PERMISSIONS.MEMBERS_READ },
        { to: '/notifications', label: t('nav.notifications'), icon: <Bell className={i} /> },
        { to: '/audit', label: t('nav.audit'), icon: <ShieldCheck className={i} />, perm: PERMISSIONS.AUDIT_READ },
        { to: '/settings', label: t('nav.settings'), icon: <Settings className={i} /> },
      ],
    },
  ];
}

function Sidebar() {
  const { t } = useTranslation();
  const groups = useNav();
  const permissions = useAuth((s) => s.membership?.permissions ?? []);
  const business = useAuth((s) => s.business);
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.membership?.role);
  const { sidebarOpen, toggleSidebar, sidebarCollapsed: collapsed, toggleCollapsed } = useUi();
  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 animate-fade-in bg-slate-950/40 backdrop-blur-[2px] lg:hidden" onClick={() => toggleSidebar(false)} />}
      <aside
        className={clsx(
          'fixed inset-y-0 start-0 z-40 flex shrink-0 flex-col border-e border-line bg-sidebar transition-[width,transform] duration-300 ease-out lg:sticky lg:top-0 lg:h-screen',
          collapsed ? 'w-[17rem] lg:w-[4.5rem]' : 'w-[17rem]',
          sidebarOpen ? 'translate-x-0 shadow-pop lg:shadow-none' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className={clsx('flex h-16 items-center gap-2.5 px-4', collapsed && 'lg:justify-center lg:px-0')}>
          <Link to="/" className="flex min-w-0 items-center gap-2.5" title={business?.name ?? t('app.name')}>
            <BrandLogo variant="mark" className="h-9 w-9 shrink-0 rounded-[10px] shadow-card" />
            <span className={clsx('min-w-0', collapsed && 'lg:hidden')}>
              <span className="block truncate text-sm font-bold tracking-tight text-ink">{business?.name ?? t('app.name')}</span>
              <span className="block truncate text-2xs font-medium text-muted">{t('app.name')} · {t(`enums.role.${role ?? 'MEMBER'}`)}</span>
            </span>
          </Link>
          <button className="icon-btn ms-auto !h-8 !w-8 lg:hidden" onClick={() => toggleSidebar(false)} aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2">
          {groups.map((group) => {
            const items = group.items.filter((n) => !n.perm || permissions.includes(n.perm));
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <p className={clsx('mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle', collapsed && 'lg:invisible lg:h-0 lg:mb-0')}>{group.label}</p>
                <ul className="space-y-0.5">
                  {items.map((n) => (
                    <li key={n.to}>
                      <NavLink
                        to={n.to}
                        end={n.to === '/'}
                        title={collapsed ? n.label : undefined}
                        onClick={() => toggleSidebar(false)}
                        className={({ isActive }) =>
                          clsx(
                            'group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-all duration-150',
                            collapsed && 'lg:justify-center lg:px-0',
                            isActive
                              ? 'bg-surface text-ink shadow-card ring-1 ring-line dark:bg-white/[0.07] dark:ring-white/5'
                              : 'text-muted hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/[0.04]',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="absolute start-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-e-full bg-brand-600 animate-fade-in" />}
                            <span className={clsx('transition-colors', isActive ? 'text-brand-600' : 'text-subtle group-hover:text-ink-2')}>{n.icon}</span>
                            <span className={clsx('truncate', collapsed && 'lg:hidden')}>{n.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className={clsx('border-t border-line p-3', collapsed && 'lg:px-2')}>
          <div className={clsx('flex items-center gap-2.5 rounded-xl p-1.5', collapsed && 'lg:justify-center')}>
            <Avatar name={user?.fullName} size="sm" />
            <div className={clsx('min-w-0 flex-1', collapsed && 'lg:hidden')}>
              <p className="truncate text-xs font-semibold text-ink">{user?.fullName}</p>
              <p className="truncate text-2xs text-muted">{user?.email}</p>
            </div>
            <button
              className={clsx('icon-btn hidden !h-7 !w-7 lg:inline-flex', collapsed && 'lg:hidden')}
              onClick={toggleCollapsed}
              title={t('topbar.collapse')}
              aria-label={t('topbar.collapse')}
            >
              <ChevronsLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
          {collapsed && (
            <button className="icon-btn mt-1 hidden w-full lg:inline-flex" onClick={toggleCollapsed} title={t('topbar.expand')} aria-label={t('topbar.expand')}>
              <ChevronsLeft className="h-4 w-4 rotate-180 rtl:rotate-0" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounce(q.trim(), 250);
  const ref = useRef<HTMLDivElement>(null);
  const res = useQuery({ queryKey: ['search', term], queryFn: () => dashboardApi.search(term), enabled: term.length >= 2 });
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.querySelector('input')?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };
  const d = res.data;
  const nothing = d && !d.clients.length && !d.properties.length && !d.owners.length;
  const row = 'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-brand-50/70 focus:bg-brand-50/70 focus:outline-none dark:hover:bg-white/[0.05]';
  const group = (label: string) => <p className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">{label}</p>;

  return (
    <div className="relative w-full max-w-md" ref={ref} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        className="input !h-9 !rounded-full !border-transparent !bg-ink/[0.045] !ps-9 !pe-14 !shadow-none hover:!bg-ink/[0.06] focus:!border-brand-500 focus:!bg-surface dark:!bg-white/[0.06]"
        placeholder={t('topbar.searchPlaceholder')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label={t('common.search')}
      />
      <span className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 sm:flex">
        <kbd className="kbd">{mac ? '⌘' : 'Ctrl'}</kbd>
        <kbd className="kbd">K</kbd>
      </span>
      {open && term.length >= 2 && (
        <div className="absolute z-40 mt-2 max-h-[26rem] w-full animate-scale-in overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-sm shadow-pop">
          {res.isLoading && (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          )}
          {nothing && <p className="p-4 text-center text-muted">{t('common.noResults')}</p>}
          {!!d?.clients.length && group(t('nav.clients'))}
          {d?.clients.map((c) => (
            <button key={c._id} className={row} onClick={() => go(`/clients/${c._id}`)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={c.fullName} size="sm" />
                <span className="truncate font-medium">{c.fullName}</span>
              </span>
              <span className="ltr-nums text-xs text-muted">{c.mobileNumber}</span>
            </button>
          ))}
          {!!d?.properties.length && group(t('nav.properties'))}
          {d?.properties.map((p) => (
            <button key={p._id} className={row} onClick={() => go(`/properties/${p._id}`)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="rounded-lg bg-brand-50 p-1.5 text-brand-600"><Home className="h-3.5 w-3.5" /></span>
                <span className="truncate"><span className="ltr-nums font-medium">{p.propertyId}</span> · {p.society ?? p.area}</span>
              </span>
              <span className="text-xs font-medium text-muted">{formatPkr(p.askingPrice)}</span>
            </button>
          ))}
          {!!d?.owners.length && group(t('nav.owners'))}
          {d?.owners.map((o) => (
            <button key={o._id} className={row} onClick={() => go(`/owners/${o._id}`)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="rounded-lg bg-amber-50 p-1.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><Building2 className="h-3.5 w-3.5" /></span>
                <span className="truncate font-medium">{o.fullName}</span>
              </span>
              <span className="ltr-nums text-xs text-muted">{o.mobileNumber}</span>
            </button>
          ))}
          {!!d?.matches.length && group(t('nav.matches'))}
          {d?.matches.map((m) => (
            <button key={m._id} className={row} onClick={() => go(`/clients/${m.clientId._id}`)}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="rounded-lg bg-emerald-50 p-1.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Handshake className="h-3.5 w-3.5" /></span>
                <span className="truncate">{m.clientId.fullName} ↔ <span className="ltr-nums">{m.propertyId.propertyId}</span></span>
              </span>
              <span className="text-xs font-semibold text-emerald-600">{m.matchScore}%</span>
            </button>
          ))}
          {d && !nothing && (
            <p className="mt-1 flex items-center gap-1.5 border-t border-line px-2.5 pb-1 pt-2 text-2xs text-subtle">
              <CornerDownLeft className="h-3 w-3" /> {t('topbar.openHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One-click creation of the most common records. */
function CreateMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const items = [
    { can: useCan(PERMISSIONS.CLIENTS_CREATE), icon: <UserPlus className="h-4 w-4" />, label: t('client.add'), to: '/clients?new=1' },
    { can: useCan(PERMISSIONS.PROPERTIES_CREATE), icon: <HousePlus className="h-4 w-4" />, label: t('property.add'), to: '/properties?new=1' },
    { can: useCan(PERMISSIONS.FOLLOWUPS_CREATE), icon: <CalendarPlus className="h-4 w-4" />, label: t('followup.add'), to: '/followups?new=1' },
    { can: useCan(PERMISSIONS.DEALS_CREATE), icon: <HandCoins className="h-4 w-4" />, label: t('deal.add'), to: '/deals?new=1' },
    { can: useCan(PERMISSIONS.AGREEMENTS_CREATE), icon: <FileSignature className="h-4 w-4" />, label: t('agreement.add'), to: '/agreements?new=1' },
    { can: useCan(PERMISSIONS.FINANCE_CREATE), icon: <Wallet className="h-4 w-4" />, label: t('finance.add'), to: '/finance?new=1' },
  ].filter((x) => x.can);
  if (!items.length) return null;
  return (
    <Dropdown
      trigger={
        <button className="btn-primary !h-9 !rounded-full !px-3.5" aria-label={t('topbar.create')}>
          <Plus className="h-4 w-4" />
          <span className="hidden md:inline">{t('topbar.create')}</span>
        </button>
      }
    >
      {(close) =>
        items.map((x) => (
          <MenuItem key={x.to} onClick={() => (navigate(x.to), close())}>
            <span className="rounded-md bg-brand-50 p-1 text-brand-600">{x.icon}</span>
            {x.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

function Topbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme, lang, setLang, toggleSidebar } = useUi();
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const connected = useRealtime((s) => s.connected);
  const unread = useQuery({ queryKey: ['notifications', 'unread-count'], queryFn: () => notificationApi.list({ limit: 1 }), refetchInterval: 60_000 });
  const unreadCount = Number(unread.data?.meta.unreadCount ?? 0);
  const patchUser = useAuth((s) => s.patchUser);
  // Saved to the profile too, so the choice follows the user to other devices.
  const persist = (preferences: Record<string, string>) => void authApi.updateProfile({ preferences }).then(patchUser).catch(() => undefined);
  const switchLang = (l: 'en' | 'ur') => (setLang(l), persist({ language: l }));
  const switchTheme = (th: 'light' | 'dark' | 'system') => (setTheme(th), persist({ theme: th }));
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-canvas/75 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-6">
      <button className="icon-btn lg:hidden" onClick={() => toggleSidebar(true)} aria-label="menu">
        <Menu className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="ms-auto flex items-center gap-1">
        <BranchSwitcher />
        <span
          className={clsx('mx-1 hidden items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-semibold sm:flex', connected ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted')}
          title={connected ? t('topbar.live') : t('topbar.reconnecting')}
        >
          <span className="relative flex h-2 w-2">
            {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={clsx('relative inline-flex h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-subtle')} />
          </span>
          {connected ? t('topbar.live') : t('topbar.reconnecting')}
        </span>
        <CreateMenu />
        <button className="btn-ghost !px-2.5" onClick={() => switchLang(lang === 'en' ? 'ur' : 'en')} title={t('topbar.language')}>
          <Languages className="h-4 w-4" />
          <span className="hidden text-xs sm:inline">{lang === 'en' ? 'اردو' : 'English'}</span>
        </button>
        <Dropdown trigger={<button className="icon-btn" title={t('topbar.theme')} aria-label={t('topbar.theme')}><ThemeIcon className="h-[18px] w-[18px]" /></button>}>
          {(close) =>
            (['light', 'dark', 'system'] as const).map((th) => (
              <MenuItem key={th} onClick={() => (switchTheme(th), close())}>
                {th === 'light' ? <Sun className="h-4 w-4" /> : th === 'dark' ? <Moon className="h-4 w-4" /> : <SunMoon className="h-4 w-4" />}
                {t(`topbar.${th}`)}
                {theme === th && <span className="ms-auto h-1.5 w-1.5 rounded-full bg-brand-600" />}
              </MenuItem>
            ))
          }
        </Dropdown>
        <Link to="/notifications" className="icon-btn relative" aria-label={t('nav.notifications')}>
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute end-1 top-1 flex h-4 min-w-[1rem] animate-pop-in items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Dropdown
          trigger={
            <button className="ms-1 rounded-full transition hover:ring-4 hover:ring-brand-500/15" aria-label={t('nav.profile')}>
              <Avatar name={user?.fullName} />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="mb-1 flex items-center gap-3 border-b border-line px-2.5 pb-3 pt-2">
                <Avatar name={user?.fullName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user?.fullName}</p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                </div>
              </div>
              <MenuItem onClick={() => (navigate('/settings'), close())}>
                <Settings className="h-4 w-4" /> {t('nav.settings')}
              </MenuItem>
              <MenuItem danger onClick={() => void signOut()}>
                <LogOut className="h-4 w-4" /> {t('nav.logout')}
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
    </header>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {!online && <div className="animate-fade-in border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">{t('common.offline')}</div>}
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 md:px-8 md:py-8">
          <ErrorBoundary resetKey={location.pathname}>
            {/* Keyed by path so every page enters with the same soft rise. */}
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
