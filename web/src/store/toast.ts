import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  href?: string;
}

interface ToastState {
  toasts: Toast[];
  push(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
}

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(t) {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 7000 : 4500);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

export const toast = {
  success: (title: string, body?: string) => useToasts.getState().push({ kind: 'success', title, body }),
  error: (title: string, body?: string) => useToasts.getState().push({ kind: 'error', title, body }),
  info: (title: string, body?: string, href?: string) => useToasts.getState().push({ kind: 'info', title, body, href }),
};
