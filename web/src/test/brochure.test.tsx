import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { brochureApi, memberApi } from '@/api/endpoints';
import type { Property } from '@/api/types';
import { BrochureDialog } from '@/components/domain/BrochureDialog';
import { useAuth } from '@/store/auth';

describe('brochure dialog', () => {
  it('sends language, hide-price and agent; says confidential prices are never printed', async () => {
    useAuth.setState({ status: 'authenticated', user: { _id: 'u-me' } as never, membership: { _id: 'm', role: 'OWNER', permissions: ['members:read'] } as never });
    vi.spyOn(memberApi, 'list').mockResolvedValue({
      items: [
        { _id: 'm1', status: 'ACTIVE', user: { _id: 'u-me', fullName: 'Muhammad Yousuf' } },
        { _id: 'm2', status: 'ACTIVE', user: { _id: 'u-son', fullName: 'Ahmed Yousuf' } },
      ],
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    } as never);
    const download = vi.spyOn(brochureApi, 'download').mockResolvedValue();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BrochureDialog property={{ _id: 'p1', propertyId: 'RE-000001' } as Property} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Minimum and expected prices are never printed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ur' } });
    fireEvent.click(screen.getByLabelText('Hide the price'));
    const agent = await screen.findByLabelText('Contact person');
    await waitFor(() => expect(agent.querySelectorAll('option').length).toBeGreaterThanOrEqual(2));
    fireEvent.change(agent, { target: { value: 'u-son' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download image' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('p1', { lang: 'ur', hidePrice: true, agentId: 'u-son', format: 'png' }));
    // Yourself as the contact: no agentId (the server defaults to the requester).
    fireEvent.change(agent, { target: { value: 'u-me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(download).toHaveBeenLastCalledWith('p1', { lang: 'ur', hidePrice: true, agentId: undefined, format: 'pdf' }));
  });
});
