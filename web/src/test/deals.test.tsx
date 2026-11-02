import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { clientApi, dealApi, memberApi, propertyApi } from '@/api/endpoints';
import type { Deal } from '@/api/types';
import { DealFormDrawer, DealsPage } from '@/pages/DealPages';
import { useAuth } from '@/store/auth';

const page = <T,>(items: T[]) => ({ items, meta: { page: 1, limit: 100, total: items.length, totalPages: 1 } }) as never;
const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

const deal = (over: Partial<Deal>): Deal =>
  ({
    _id: 'd1', uuid: 'u1', version: 1, dealNo: 'DL-000001', clientId: { _id: 'c1', fullName: 'Muhammad Ali' }, agents: [], stage: 'OFFER', stageHistory: [],
    commission: { buyer: { mode: 'PERCENT', value: 1 }, seller: { mode: 'PERCENT', value: 1 } }, payments: [], payouts: [],
    expectedTotal: 300_000, receivedTotal: 0, outstanding: 300_000, commissionStatus: 'PENDING', createdAt: '', updatedAt: '', ...over,
  }) as Deal;

describe('deals pipeline', () => {
  it('shows open deals in their stage column with the commission status', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'OWNER', permissions: ['deals:read', 'deals:create'] } as never });
    vi.spyOn(memberApi, 'list').mockResolvedValue(page([]));
    const list = vi.spyOn(dealApi, 'list').mockResolvedValue(page([deal({}), deal({ _id: 'd2', dealNo: 'DL-000002', stage: 'TOKEN', title: 'DHA house', commissionStatus: 'PARTIALLY_RECEIVED' })]));
    wrap(<DealsPage />);
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ open: true })));
    expect(await screen.findByText('DL-000001')).toBeInTheDocument();
    expect(screen.getByText('DHA house')).toBeInTheDocument();
    expect(screen.getByText('Token / bayana')).toBeInTheDocument();
    const card = screen.getByText('DHA house').closest('a')!;
    expect(card).toHaveAttribute('href', '/deals/d2');
    expect(within(card).getByText('Partially received')).toBeInTheDocument();
  });
});

describe('deal form', () => {
  it('previews the expected commission and requires agent shares to total 100%', async () => {
    useAuth.setState({ status: 'authenticated', user: { _id: 'u-owner' } as never });
    vi.spyOn(memberApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(clientApi, 'list').mockResolvedValue(page([{ _id: 'c1', fullName: 'Muhammad Ali', mobileNumber: '+923001234567' }]));
    vi.spyOn(propertyApi, 'list').mockResolvedValue(page([]));
    wrap(<DealFormDrawer open onClose={() => undefined} clientId="c1" />);
    fireEvent.change(screen.getByLabelText('Agreed price'), { target: { value: '20000000' } });
    const values = screen.getAllByLabelText('Value');
    fireEvent.change(values[0], { target: { value: '1' } });
    fireEvent.change(values[1], { target: { value: '1.5' } });
    expect(screen.getByText(/Expected commission: PKR 5 Lakh/)).toBeInTheDocument();
    expect(screen.getByText('Total 100% (must be 100%)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Share %'), { target: { value: '80' } });
    expect(screen.getByText('Total 80% (must be 100%)')).toHaveClass('text-red-600');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
