import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AGREEMENT_DISCLAIMER, ALL_PERMISSIONS } from '@recrm/shared';
import { agreementApi, clientApi, ownerApi, propertyApi } from '@/api/endpoints';
import type { Agreement } from '@/api/types';
import { AgreementDetailPage, AgreementFormDrawer } from '@/pages/AgreementPages';
import { useAuth } from '@/store/auth';

const page = <T,>(items: T[]) => ({ items, meta: { page: 1, limit: 30, total: items.length, totalPages: 1 } }) as never;
const wrap = (ui: ReactNode, path = '/agreements/a1') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agreements/:id" element={ui} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const agreement = (over: Partial<Agreement>): Agreement =>
  ({
    _id: 'a1', uuid: 'u1', version: 3, agreementNo: 'AG-000001', kind: 'SALE', language: 'en', status: 'DRAFT', clientId: { _id: 'c1', fullName: 'Kamran Akmal' },
    amount: 2_550_000, versions: [{ no: 1, body: 'AGREEMENT TO SELL\nFirst text', source: 'RENDER', createdAt: '2026-11-01T00:00:00Z' }, { no: 2, body: 'AGREEMENT TO SELL\nSecond text', source: 'EDIT', createdAt: '2026-11-02T00:00:00Z' }],
    renewalFollowUpIds: [], statusHistory: [], createdAt: '', updatedAt: '', ...over,
  }) as Agreement;

describe('agreements', () => {
  it('shows the lawyer note, the latest version and the allowed status moves for a draft', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'MEMBER', permissions: ['agreements:read', 'agreements:update'] } as never });
    vi.spyOn(agreementApi, 'get').mockResolvedValue(agreement({}));
    wrap(<AgreementDetailPage />);
    expect(await screen.findByText('Second text', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(AGREEMENT_DISCLAIMER.en)).toBeInTheDocument();
    expect(screen.getByText('Version 2 of 2')).toBeInTheDocument();
    for (const label of ['Mark sent', 'Mark signed', 'Cancel agreement']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate from template' })).toBeInTheDocument();
    // No delete permission → no delete button.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('locks a signed agreement: no edit or regenerate, only expire / cancel', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'OWNER', permissions: [...ALL_PERMISSIONS] } as never });
    vi.spyOn(agreementApi, 'get').mockResolvedValue(agreement({ status: 'SIGNED', language: 'ur', versions: [{ no: 1, body: 'اقرار نامہ بیع\nمتن', source: 'RENDER', createdAt: '2026-11-01T00:00:00Z' }] }));
    wrap(<AgreementDetailPage />);
    const text = await screen.findByText('متن', { exact: false });
    expect(text).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate from template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark expired' })).toBeInTheDocument();
  });

  it('switches the form to rent fields and sends a rent draft with dates', async () => {
    useAuth.setState({ status: 'authenticated', membership: { _id: 'm', role: 'OWNER', permissions: [] } as never });
    vi.spyOn(clientApi, 'list').mockResolvedValue(page([{ _id: 'c1', fullName: 'Saad Ansari', mobileNumber: '+923001234567' }]));
    vi.spyOn(propertyApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(ownerApi, 'list').mockResolvedValue(page([]));
    vi.spyOn(agreementApi, 'templates').mockResolvedValue([]);
    const create = vi.spyOn(agreementApi, 'create').mockResolvedValue(agreement({ _id: 'a9' }));
    wrap(<AgreementFormDrawer onClose={() => undefined} defaults={{ clientId: 'c1' }} />, '/agreements');
    expect(screen.getByLabelText('Total price (PKR)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'RENT' } });
    expect(screen.queryByLabelText('Total price (PKR)')).toBeNull();
    expect(screen.getByText(/Renewal follow-ups are added 30 and 7 days/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Monthly rent (PKR)'), { target: { value: '85000' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'RENT', clientId: 'c1', monthlyRent: 85_000, endDate: '2027-06-30T00:00:00.000Z', uuid: expect.any(String) })));
  });
});
