import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { categoryApi, clientApi, memberApi } from '@/api/endpoints';
import { ClientsPage } from '@/pages/ClientPages';

describe('client list filters', () => {
  it('sends block and size (with unit) to the API, and the unit only when a size is set', async () => {
    vi.spyOn(categoryApi, 'list').mockResolvedValue([]);
    vi.spyOn(memberApi, 'list').mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } } as never);
    const list = vi.spyOn(clientApi, 'list').mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ sizeUnit: undefined });

    fireEvent.change(screen.getByLabelText('Block'), { target: { value: '13-D' } });
    fireEvent.change(screen.getByLabelText('Min size'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'MARLA' } });
    await waitFor(() => expect(list.mock.calls.at(-1)![0]).toMatchObject({ block: '13-D', minSize: '120', sizeUnit: 'MARLA' }));
  });
});
