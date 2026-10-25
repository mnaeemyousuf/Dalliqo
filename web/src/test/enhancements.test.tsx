import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { ApiError, toApiError } from '@/api/client';
import { categoryApi, clientApi } from '@/api/endpoints';
import type { Client, Match, Property } from '@/api/types';
import { isListingStale, MatchCard, VerificationBadge } from '@/components/domain';
import { ClientFormDrawer } from '@/pages/ClientPages';

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('listing verification badge', () => {
  it('flags available listings not confirmed in 30 days, never sold ones', () => {
    expect(isListingStale({ status: 'AVAILABLE', lastVerifiedAt: days(45) })).toBe(true);
    expect(isListingStale({ status: 'AVAILABLE' })).toBe(true);
    expect(isListingStale({ status: 'AVAILABLE', lastVerifiedAt: days(3) })).toBe(false);
    expect(isListingStale({ status: 'SOLD', lastVerifiedAt: days(400) })).toBe(false);
  });

  it('renders the warning, and the verified date only when asked', () => {
    const { rerender } = render(<VerificationBadge property={{ status: 'AVAILABLE', lastVerifiedAt: days(45) }} />);
    expect(screen.getByText('Needs verification')).toBeInTheDocument();
    rerender(<VerificationBadge property={{ status: 'AVAILABLE', lastVerifiedAt: days(3) }} />);
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    rerender(<VerificationBadge property={{ status: 'AVAILABLE', lastVerifiedAt: days(3) }} showFresh />);
    expect(screen.getByText(/^Verified/)).toBeInTheDocument();
  });
});

describe('sending a matched property on WhatsApp', () => {
  it('opens the client chat with the property details pre-filled and logs the contact', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const log = vi.spyOn(clientApi, 'communicate').mockResolvedValue({} as Client);
    const match = {
      _id: 'm1', matchScore: 95, band: 'EXCELLENT', status: 'NEW', matchReasons: [],
      clientId: { _id: 'c1', fullName: 'Muhammad Ali', mobileNumber: '+923001234567', whatsappNumber: '+923001234567' },
      propertyId: { _id: 'p1', propertyId: 'RE-000125', propertyType: 'RESIDENTIAL_PLOT', listingPurpose: 'SALE', society: 'Gulshan-e-Iqbal', block: 'Block 13-D', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 15_500_000 } as Property,
    } as unknown as Match;
    render(<MemoryRouter><MatchCard match={match} perspective="client" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send property on WhatsApp' }));

    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://wa.me/923001234567');
    const text = url.searchParams.get('text')!;
    expect(text).toContain('Assalam-o-Alaikum Muhammad Ali');
    expect(text).toContain('RE-000125 · 120 Sq. yard Residential plot (Sale)');
    expect(text).toContain('PKR 1.55 Crore');
    expect(log).toHaveBeenCalledWith('c1', 'WHATSAPP', 'Shared RE-000125');
  });
});

describe('duplicate client warning', () => {
  it('shows the existing client and lets the user save anyway', async () => {
    vi.spyOn(categoryApi, 'list').mockResolvedValue([]);
    const create = vi
      .spyOn(clientApi, 'create')
      .mockRejectedValueOnce(new ApiError('CLIENT_DUPLICATE', 'exists', 409, { duplicates: [{ _id: 'c9', fullName: 'Muhammad Ali', mobileNumber: '+923001112233', status: 'ACTIVE' }] }))
      .mockResolvedValueOnce({ _id: 'c10' } as Client);
    wrap(<ClientFormDrawer open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Mrs. Ali' } });
    fireEvent.change(screen.getByLabelText(/Mobile/), { target: { value: '03001112233' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Possible duplicate client')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Muhammad Ali' })).toHaveAttribute('href', '/clients/c9');
    expect(create.mock.calls[0][0]).not.toHaveProperty('allowDuplicate');

    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0]).toMatchObject({ allowDuplicate: true, fullName: 'Mrs. Ali' });
  });
});

describe('unreachable backend', () => {
  it('maps a proxy/gateway error page to the friendly NETWORK error, but keeps real API errors', () => {
    const res = (status: number, data: unknown) =>
      new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } });
    expect(toApiError(res(502, '<html>Bad gateway</html>')).code).toBe('NETWORK');
    expect(toApiError(res(500, '')).code).toBe('NETWORK');
    expect(toApiError(res(500, { success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong' })).code).toBe('INTERNAL_ERROR');
    expect(toApiError(res(409, { success: false, code: 'CLIENT_DUPLICATE', message: 'x' })).code).toBe('CLIENT_DUPLICATE');
  });
});
