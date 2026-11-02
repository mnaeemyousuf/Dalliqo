import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { branchSelection, http } from '@/api/client';
import { branchApi } from '@/api/endpoints';
import type { Branch } from '@/api/types';
import { BranchAccessEditor, BranchSwitcher } from '@/components/branches';
import { useAuth } from '@/store/auth';

const branches = [
  { _id: 'b1', name: 'Main Branch', isDefault: true, uuid: 'u1', version: 1 },
  { _id: 'b2', name: 'Clifton Office', nameUr: 'کلفٹن آفس', isDefault: false, uuid: 'u2', version: 1 },
] as Branch[];

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('branch switcher', () => {
  it('lists the branches, remembers the pick and sends it as X-Branch-Id on every request', async () => {
    useAuth.setState({ status: 'authenticated' });
    vi.spyOn(branchApi, 'list').mockResolvedValue(branches);
    wrap(<BranchSwitcher />);
    const select = await screen.findByLabelText('Branch');
    expect(screen.getByRole('option', { name: 'All branches' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'b2' } });
    expect(branchSelection.get()).toBe('b2');
    expect(localStorage.getItem('recrm.branch')).toBe('b2');

    // The request interceptor adds the header.
    const handlers = (http.interceptors.request as unknown as { handlers: { fulfilled: (c: unknown) => { headers: Record<string, string> } }[] }).handlers;
    const config = handlers.reduce((c, h) => h.fulfilled(c), { headers: {} as Record<string, string> } as unknown);
    expect((config as { headers: Record<string, string> }).headers['X-Branch-Id']).toBe('b2');

    fireEvent.change(select, { target: { value: '' } });
    expect(branchSelection.get()).toBeNull();
  });

  it('is hidden for a business (or member) with one branch', async () => {
    useAuth.setState({ status: 'authenticated' });
    const list = vi.spyOn(branchApi, 'list').mockResolvedValue([branches[0]]);
    const { container } = wrap(<BranchSwitcher />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('member branch access editor', () => {
  it('switches between all branches and selected branches', async () => {
    useAuth.setState({ status: 'authenticated' });
    vi.spyOn(branchApi, 'list').mockResolvedValue(branches);
    const onChange = vi.fn();
    const { rerender } = wrap(<BranchAccessEditor access="ALL" branchIds={[]} onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Only selected branches' }));
    expect(onChange).toHaveBeenLastCalledWith({ branchAccess: 'SELECTED', branchIds: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<QueryClientProvider client={qc}><BranchAccessEditor access="SELECTED" branchIds={[]} onChange={onChange} /></QueryClientProvider>);
    expect(await screen.findByText('Choose at least one branch')).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText('Clifton Office'));
    expect(onChange).toHaveBeenLastCalledWith({ branchAccess: 'SELECTED', branchIds: ['b2'] });
  });
});
