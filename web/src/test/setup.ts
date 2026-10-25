import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import '@/i18n';

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
