import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, tokenStore } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { LoginPage } from '@/pages/AuthPages';
import { useAuth, useCan } from '@/store/auth';

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
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
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
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('useCan reflects the membership permissions', () => {
    useAuth.setState({ status: 'authenticated', membership: session.membership });
    expect(renderHook(() => useCan('clients:read')).result.current).toBe(true);
    expect(renderHook(() => useCan('clients:delete')).result.current).toBe(false);
  });
});
