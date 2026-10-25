import { create } from 'zustand';
import i18n, { applyLanguage, type Lang } from '@/i18n';

export type Theme = 'light' | 'dark' | 'system';

function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode): preference just isn't remembered */
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', !!dark);
}

interface UiState {
  theme: Theme;
  lang: Lang;
  sidebarOpen: boolean;
  setTheme(theme: Theme): void;
  setLang(lang: Lang): void;
  toggleSidebar(open?: boolean): void;
}

/** Per-device preferences (theme, language) — also synced to the user profile when signed in. */
export const useUi = create<UiState>((set) => ({
  theme: read<Theme>('recrm.theme', 'system'),
  lang: read<Lang>('recrm.lang', 'en'),
  sidebarOpen: false,
  setTheme(theme) {
    write('recrm.theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  setLang(lang) {
    write('recrm.lang', lang);
    void i18n.changeLanguage(lang);
    set({ lang });
  },
  toggleSidebar(open) {
    set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen }));
  },
}));

export function initUi(): void {
  const { theme, lang } = useUi.getState();
  applyTheme(theme);
  void i18n.changeLanguage(lang);
  applyLanguage(lang);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(useUi.getState().theme));
}
