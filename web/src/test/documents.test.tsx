import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { documentApi } from '@/api/endpoints';
import type { FileAsset } from '@/api/types';
import { RenameDocumentModal } from '@/components/domain/panels';

describe('RenameDocumentModal', () => {
  it('prefills the current name and saves the trimmed new one', async () => {
    const update = vi.spyOn(documentApi, 'update').mockResolvedValue({ _id: 'd1', fileName: 'Sale deed.pdf' } as FileAsset);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<RenameDocumentModal doc={{ _id: 'd1', fileName: 'scan_001.pdf' }} onClose={onClose} onSaved={onSaved} />);

    const input = screen.getByLabelText('File name');
    expect(input).toHaveValue('scan_001.pdf');
    fireEvent.change(input, { target: { value: '  Sale deed.pdf ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('d1', { fileName: 'Sale deed.pdf' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('does not save an empty name', () => {
    const update = vi.spyOn(documentApi, 'update');
    render(<RenameDocumentModal doc={{ _id: 'd1', fileName: 'a.pdf' }} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });
});
