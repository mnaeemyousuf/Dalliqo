import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/Toaster';
import { PageLoader } from '@/components/ui';
import { AppLayout } from '@/layout/AppLayout';
import { ChangeTemporaryPasswordPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/pages/AuthPages';
import { connectRealtime } from '@/realtime/socket';
import { useAuth } from '@/store/auth';
import { ApiError } from '@/api/client';

// Each area is its own chunk, loaded on first visit.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const admin = () => import('@/pages/AdminPages');
const clients = () => import('@/pages/ClientPages');
const dash = () => import('@/pages/DashboardPages');
const props = () => import('@/pages/PropertyPages');
const work = () => import('@/pages/WorkPages');
const DashboardPage = page(dash, 'DashboardPage');
const MyDayPage = page(dash, 'MyDayPage');
const ClientsPage = page(clients, 'ClientsPage');
const ClientDetailPage = page(clients, 'ClientDetailPage');
const PropertiesPage = page(props, 'PropertiesPage');
const PropertyDetailPage = page(props, 'PropertyDetailPage');
const OwnersPage = page(work, 'OwnersPage');
const OwnerDetailPage = page(work, 'OwnerDetailPage');
const MatchesPage = page(work, 'MatchesPage');
const FollowUpsPage = page(work, 'FollowUpsPage');
const DocumentsPage = page(work, 'DocumentsPage');
const ReportsPage = page(work, 'ReportsPage');
const UsersPage = page(admin, 'UsersPage');
const NotificationsPage = page(admin, 'NotificationsPage');
const AuditPage = page(admin, 'AuditPage');
const SettingsPage = page(admin, 'SettingsPage');

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      // Don't retry permission or validation errors.
      retry: (count, err) => !(err instanceof ApiError && err.status && err.status < 500) && count < 2,
    },
  },
});

function Realtime() {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  useEffect(() => (status === 'authenticated' ? connectRealtime(qc) : undefined), [status, qc]);
  return null;
}

function Protected({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <ChangeTemporaryPasswordPage />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <PageLoader />;
  return status === 'authenticated' ? <Navigate to="/" replace /> : <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="my-day" element={<MyDayPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:id" element={<PropertyDetailPage />} />
        <Route path="owners" element={<OwnersPage />} />
        <Route path="owners/:id" element={<OwnerDetailPage />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="followups" element={<FollowUpsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    void useAuth.getState().bootstrap();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Realtime />
        <Suspense fallback={<PageLoader />}>
          <AppRoutes />
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
