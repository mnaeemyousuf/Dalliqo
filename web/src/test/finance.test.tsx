import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { transactionApi } from '@/api/endpoints';
import type { Transaction, TransactionCategory } from '@/api/types';
import { FinancePage, TransactionFormDrawer } from '@/pages/FinancePages';
import { useAuth } from '@/store/auth';

const page = <T,>(items: T[]) => ({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } }) as never;
const wrap = (ui: ReactNode, path = '/finance') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

const cats: TransactionCategory[] = [
  { _id: 'k1', uuid: 'a', key: 'COMMISSION', name: 'Commission', nameUr: 'کمیشن', type: 'INCOME', isSystem: true, sortOrder: 0 },
  { _id: 'k2', uuid: 'b', key: 'OFFICE_RENT', name: 'Office rent', nameUr: 'دفتر کا کرایہ', type: 'EXPENSE', isSystem: true, sortOrder: 4 },
  { _id: 'k3', uuid: 'c', key: 'UTILITIES', name: 'Utilities', type: 'EXPENSE', isSystem: true, sortOrder: 6 },
];
const entry = (over: Partial<Transaction>): Transaction =>
  ({ _id: 't1', uuid: 'u1', version: 1, type: 'EXPENSE', categoryId: cats[1], amount: 85_000, date: '2026-10-01T00:00:00Z', method: 'CASH', source: 'MANUAL', createdAt: '', updatedAt: '', ...over }) as Transaction;

describe('income & expense', () => {
  it('lists entries; commission income is marked as coming from its deal and cannot be edited here', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'MEMBER', permissions: ['finance:read', 'finance:create', 'finance:update', 'finance:delete'] } as never });
    vi.spyOn(transactionApi, 'categories').mockResolvedValue(cats);
    vi.spyOn(transactionApi, 'list').mockResolvedValue(
      page([
        entry({ description: 'October rent' }),
        entry({ _id: 't2', type: 'INCOME', categoryId: cats[0], amount: 200_000, source: 'COMMISSION', dealId: { _id: 'd1', dealNo: 'DL-000001' }, description: 'Commission DL-000001' }),
      ]),
    );
    wrap(<FinancePage />);
    const rent = (await screen.findByText('October rent')).closest('tr')!;
    expect(within(rent).getByLabelText('Edit')).toBeInTheDocument();
    const commission = screen.getByText('Commission DL-000001').closest('tr')!;
    expect(within(commission).getByText('From deal')).toBeInTheDocument();
    expect(within(commission).queryByLabelText('Edit')).toBeNull();
    expect(within(commission).getByRole('link', { name: 'DL-000001' })).toHaveAttribute('href', '/deals/d1');
  });

  it('only offers categories of the chosen type and sends whole-rupee amounts', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'OWNER', permissions: [] } as never });
    vi.spyOn(transactionApi, 'categories').mockResolvedValue(cats);
    const create = vi.spyOn(transactionApi, 'create').mockResolvedValue(entry({}));
    wrap(<TransactionFormDrawer onClose={() => undefined} />);
    const category = await screen.findByLabelText('Category');
    await waitFor(() => expect(within(category).getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Office rent', 'Utilities']));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'INCOME' } });
    expect(within(screen.getByLabelText('Category')).getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Commission']);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'EXPENSE' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'k3' } });
    fireEvent.change(screen.getByLabelText('Amount (PKR)'), { target: { value: '18400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXPENSE', categoryId: 'k3', amount: 18_400, method: 'CASH', uuid: expect.any(String) })));
  });
});
