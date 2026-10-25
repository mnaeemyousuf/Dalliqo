import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell,
  Building2,
  CalendarCheck,
  FileText,
  FolderOpen,
  Handshake,
  Home,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  SunMoon,
  UserCog,
  Users,
  Wifi,
  WifiOff,
  X,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PERMISSIONS, type Permission } from '@recrm/shared';
import { authApi, dashboardApi, notificationApi } from '@/api/endpoints';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BrandLogo } from '@/components/BrandLogo';
import { Dropdown, MenuItem, Spinner } from '@/components/ui';
import { formatPkr } from '@/lib/format';
import { useDebounce } from '@/lib/hooks';
import { useRealtime } from '@/realtime/socket';
import { useAuth, useCan } from '@/store/auth';
import { useUi } from '@/store/ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission;
}

function useNav(): NavItem[][] {
  const { t } = useTranslation();
  const i = 'h-4 w-4';
  return [
    [
      { to: '/', label: t('nav.dashboard'), icon: <LayoutDashboard className={i} /> },
      { to: '/my-day', label: t('nav.myDay'), icon: <Sparkles className={i} /> },
    ],
    [
      { to: '/clients', label: t('nav.clients'), icon: <Users className={i} />, perm: PERMISSIONS.CLIENTS_READ },
      { to: '/properties', label: t('nav.properties'), icon: <Home className={i} />, perm: PERMISSIONS.PROPERTIES_READ },
      { to: '/owners', label: t('nav.owners'), icon: <Building2 className={i} />, perm: PERMISSIONS.OWNERS_READ },
      { to: '/matches', label: t('nav.matches'), icon: <Handshake className={i} />, perm: PERMISSIONS.MATCHES_READ },
      { to: '/followups', label: t('nav.followups'), icon: <CalendarCheck className={i} />, perm: PERMISSIONS.FOLLOWUPS_READ },
      { to: '/documents', label: t('nav.documents'), icon: <FolderOpen className={i} />, perm: PERMISSIONS.DOCUMENTS_READ },
      { to: '/reports', label: t('nav.reports'), icon: <FileText className={i} />, perm: PERMISSIONS.EXPORTS_CREATE },
    ],
    [
      { to: '/users', label: t('nav.users'), icon: <UserCog className={i} />, perm: PERMISSIONS.MEMBERS_READ },
      { to: '/notifications', label: t('nav.notifications'), icon: <Bell className={i} /> },
      { to: '/audit', label: t('nav.audit'), icon: <ShieldCheck className={i} />, perm: PERMISSIONS.AUDIT_READ },
      { to: '/settings', label: t('nav.settings'), icon: <Settings className={i} /> },
    ],
  ];
}

function Sidebar() {
  const { t } = useTranslation();
  const groups = useNav();
  const permissions = useAuth((s) => s.membership?.permissions ?? []);
  const business = useAuth((s) => s.business);
  const { sidebarOpen, toggleSidebar } = useUi();
  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => toggleSidebar(false)} />}
      <aside
        className={clsx(
          'fixed inset-y-0 start-0 z-40 flex w-64 shrink-0 flex-col border-e border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen',
          sidebarOpen ? 'translate-x-0' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold" title={business?.name ?? t('app.name')}>
            <BrandLogo variant="mark" className="h-8 w-8 shrink-0" />
            <span className="truncate text-sm">{business?.name ?? t('app.name')}</span>
          </Link>
          <button className="btn-ghost !p-1 lg:hidden" onClick={() => toggleSidebar(false)} aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {groups.map((group, gi) => (
            <ul key={gi} className="space-y-0.5">
              {group
                .filter((n) => !n.perm || permissions.includes(n.perm))
                .map((n) => (
                  <li key={n.to}>
                    <NavLink
                      to={n.to}
                      end={n.to === '/'}
                      onClick={() => toggleSidebar(false)}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                          isActive ? 'bg-brand-50 text-brand-600' : 'text-muted hover:bg-canvas hover:text-ink',
                        )
                      }
                    >
                      {n.icon}
                      {n.label}
                    </NavLink>
                  </li>
                ))}
            </ul>
          ))}
        </nav>
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

  return (
    <div className="relative w-full max-w-md" ref={ref} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted" />
      <input
        className="input !ps-9"
        placeholder={t('topbar.searchPlaceholder')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label={t('common.search')}
      />
      {open && term.length >= 2 && (
        <div className="card absolute z-40 mt-1 max-h-96 w-full overflow-y-auto p-2 text-sm">
          {res.isLoading && (
            <div className="flex justify-center p-3">
              <Spinner />
            </div>
          )}
          {nothing && <p className="p-3 text-muted">{t('common.noResults')}</p>}
          {d?.clients.map((c) => (
            <button key={c._id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-start hover:bg-canvas" onClick={() => go(`/clients/${c._id}`)}>
              <span>
                <Users className="me-2 inline h-3.5 w-3.5 text-muted" />
                {c.fullName}
              </span>
              <span className="ltr-nums text-xs text-muted">{c.mobileNumber}</span>
            </button>
          ))}
          {d?.properties.map((p) => (
            <button key={p._id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-start hover:bg-canvas" onClick={() => go(`/properties/${p._id}`)}>
              <span>
                <Home className="me-2 inline h-3.5 w-3.5 text-muted" />
                <span className="ltr-nums">{p.propertyId}</span> · {p.society ?? p.area}
              </span>
              <span className="text-xs text-muted">{formatPkr(p.askingPrice)}</span>
            </button>
          ))}
          {d?.owners.map((o) => (
            <button key={o._id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-start hover:bg-canvas" onClick={() => go(`/owners/${o._id}`)}>
              <span>
                <Building2 className="me-2 inline h-3.5 w-3.5 text-muted" />
                {o.fullName}
              </span>
              <span className="ltr-nums text-xs text-muted">{o.mobileNumber}</span>
            </button>
          ))}
          {d?.matches.map((m) => (
            <button key={m._id} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-start hover:bg-canvas" onClick={() => go(`/clients/${m.clientId._id}`)}>
              <span>
                <Handshake className="me-2 inline h-3.5 w-3.5 text-muted" />
                {m.clientId.fullName} ↔ <span className="ltr-nums">{m.propertyId.propertyId}</span>
              </span>
              <span className="text-xs text-muted">{m.matchScore}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur">
      <button className="btn-ghost !p-1.5 lg:hidden" onClick={() => toggleSidebar(true)} aria-label="menu">
        <Menu className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="ms-auto flex items-center gap-1">
        <span className={clsx('hidden items-center gap-1 text-xs sm:flex', connected ? 'text-emerald-600' : 'text-muted')} title={connected ? t('topbar.live') : t('topbar.reconnecting')}>
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {connected ? t('topbar.live') : t('topbar.reconnecting')}
        </span>
        <button className="btn-ghost !p-2" onClick={() => switchLang(lang === 'en' ? 'ur' : 'en')} title={t('topbar.language')}>
          <Languages className="h-4 w-4" />
          <span className="text-xs">{lang === 'en' ? 'اردو' : 'English'}</span>
        </button>
        <Dropdown trigger={<button className="btn-ghost !p-2" title={t('topbar.theme')}><ThemeIcon className="h-4 w-4" /></button>}>
          {(close) =>
            (['light', 'dark', 'system'] as const).map((th) => (
              <MenuItem key={th} onClick={() => (switchTheme(th), close())}>
                {th === 'light' ? <Sun className="h-4 w-4" /> : th === 'dark' ? <Moon className="h-4 w-4" /> : <SunMoon className="h-4 w-4" />}
                {t(`topbar.${th}`)}
              </MenuItem>
            ))
          }
        </Dropdown>
        <Link to="/notifications" className="btn-ghost relative !p-2" aria-label={t('nav.notifications')}>
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 end-0 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </Link>
        <Dropdown
          trigger={
            <button className="ms-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-on-brand" aria-label={t('nav.profile')}>
              {user?.fullName?.[0] ?? '?'}
            </button>
          }
        >
          {(close) => (
            <>
              <div className="border-b border-line px-3 py-2">
                <p className="text-sm font-medium">{user?.fullName}</p>
                <p className="text-xs text-muted">{user?.email}</p>
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
        {!online && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t('common.offline')}</div>}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

