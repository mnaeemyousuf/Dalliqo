import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, tokenStore } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { LoginPage } from '@/pages/AuthPages';
import { tenantApi, type TenantInfo } from '@/lib/tenant';
import { useAuth, useCan } from '@/store/auth';

const shared: TenantInfo = { baseDomain: null, subdomain: null, tenant: null };
function renderLogin(info: TenantInfo = shared) {
  vi.spyOn(tenantApi, 'get').mockResolvedValue(info);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);
}

const session = {
  accessToken: 'tok',
  user: { _id: 'u1', email: 'a@b.c', fullName: 'Muhammad Yousuf', status: 'ACTIVE', mustChangePassword: false, preferences: { language: 'en' as const, theme: 'light' as const } },
  business: { _id: 'b1', name: 'Yousuf Estate', currency: 'PKR', timezone: 'Asia/Karachi', defaultSizeUnit: 'SQ_YARD' as const },
  membership: { _id: 'm1', role: 'MEMBER' as const, permissions: ['clients:read' as const] },
};

describe('login', () => {
  beforeEach(() => useAuth.setState({ status: 'anonymous', user: null, business: null, membership: null }));

  it('signs in and keeps the access token in memory only', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(session);
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(authApi.login).toHaveBeenCalledWith('a@b.c', 'Secret123');
    expect(tokenStore.get()).toBe('tok');
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok');
  });

  it('shows a translated error for wrong credentials', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'Incorrect email or password', 401));
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('on an agency address shows the agency and no sign-up link', async () => {
    renderLogin({ baseDomain: 'stateown.pk', subdomain: 'yousuf', tenant: { name: 'Yousuf Estate', subdomain: 'yousuf', url: 'https://yousuf.stateown.pk' } });
    expect(await screen.findByRole('heading', { name: 'Yousuf Estate' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to Yousuf Estate')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create/i })).toBeNull();
  });

  it('says so when no agency uses the address', async () => {
    renderLogin({ baseDomain: 'stateown.pk', subdomain: 'nobody', tenant: null });
    expect(await screen.findByRole('heading', { name: 'Agency not found' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('useCan reflects the membership permissions', () => {
    useAuth.setState({ status: 'authenticated', membership: session.membership });
    expect(renderHook(() => useCan('clients:read')).result.current).toBe(true);
    expect(renderHook(() => useCan('clients:delete')).result.current).toBe(false);
  });
});
