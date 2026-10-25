import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Match, Property } from '@/api/types';
import { MatchCard, PropertyCard } from '@/components/domain';
import { Button, ConfirmDialog, DataTable, EmptyState, Tabs } from '@/components/ui';

describe('UI components', () => {
  it('Button is disabled while loading', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('DataTable renders loading, error, empty and data states', () => {
    const columns = [{ key: 'n', header: 'Name', render: (r: { _id: string; n: string }) => r.n }];
    const base = { refetch: vi.fn(), isLoading: false, isError: false };
    const empty = <EmptyState title="Nothing" />;
    const meta = (total: number) => ({ page: 1, limit: 20, total, totalPages: 1 });
    const { rerender } = render(<DataTable columns={columns} query={{ ...base, isLoading: true }} page={1} onPage={vi.fn()} empty={empty} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<DataTable columns={columns} query={{ ...base, isError: true, error: new Error('Boom') }} page={1} onPage={vi.fn()} empty={empty} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    rerender(<DataTable columns={columns} query={{ ...base, data: { items: [], meta: meta(0) } }} page={1} onPage={vi.fn()} empty={empty} />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    rerender(<DataTable columns={columns} query={{ ...base, data: { items: [{ _id: '1', n: 'Muhammad Ali' }], meta: meta(1) } }} page={1} onPage={vi.fn()} empty={empty} />);
    expect(screen.getByText('Muhammad Ali')).toBeInTheDocument();
  });

  it('Tabs report the selected value', () => {
    const onChange = vi.fn();
    render(<Tabs<'a' | 'b'> value="a" onChange={onChange} tabs={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 3 }]} />);
    fireEvent.click(screen.getByRole('tab', { name: /B/ }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ConfirmDialog confirms', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete?" confirmLabel="Yes, delete" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('domain cards', () => {
  const property = {
    _id: 'p1',
    propertyId: 'RE-000125',
    propertyType: 'RESIDENTIAL_PLOT',
    listingPurpose: 'SALE',
    status: 'AVAILABLE',
    society: 'Gulshan-e-Iqbal',
    size: 120,
    sizeUnit: 'SQ_YARD',
    askingPrice: 15_500_000,
    matchCount: 8,
  } as Property;

  it('PropertyCard shows the spec fields', () => {
    render(<MemoryRouter><PropertyCard property={property} /></MemoryRouter>);
    expect(screen.getByText('RE-000125')).toBeInTheDocument();
    expect(screen.getByText('120 Sq. yard Residential plot')).toBeInTheDocument();
    expect(screen.getByText('PKR 1.55 Crore')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('8 matches')).toBeInTheDocument();
  });

  it('MatchCard shows the score and translated reasons', () => {
    const match = {
      _id: 'm1',
      matchScore: 95,
      band: 'EXCELLENT',
      status: 'NEW',
      createdAt: '',
      breakdown: {},
      matchReasons: [{ code: 'BUDGET_WITHIN' }, { code: 'SOCIETY_MATCH' }, { code: 'TYPE_MATCH' }, { code: 'SIZE_ANY' }],
      clientId: { _id: 'c1', fullName: 'Muhammad Ali', mobileNumber: '+923001234567' },
      propertyId: property,
    } as unknown as Match;
    render(<MemoryRouter><MatchCard match={match} perspective="client" /></MemoryRouter>);
    expect(screen.getByText('95% Match')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Area / society')).toBeInTheDocument();
    expect(screen.queryByText('Any size')).not.toBeInTheDocument();
    expect(screen.getByTitle('Call').closest('a')).toHaveAttribute('href', 'tel:+923001234567');
  });
});
