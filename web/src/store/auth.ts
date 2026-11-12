import { create } from 'zustand';
import type { Entitlements, Module, Permission } from '@recrm/shared';
import { authApi } from '@/api/endpoints';
import { refreshAccessToken, tokenStore, branchSelection } from '@/api/client';
import type { Business, Membership, Session, User } from '@/api/types';
import { useUi } from './ui';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: User | null;
  business: Business | null;
  membership: Membership | null;
  entitlements: Entitlements | null;
  platformAdmin: boolean;
  refreshEntitlements(): Promise<void>;
  /** Restores the session on page load using the httpOnly refresh cookie. */
  bootstrap(): Promise<void>;
  signIn(session: Session & { accessToken: string }): void;
  setSession(session: Session): void;
  patchUser(user: User): void;
  patchBusiness(business: Business): void;
  signOut(callServer?: boolean): Promise<void>;
}

function applyPreferences(user: User) {
  const ui = useUi.getState();
  if (user.preferences?.language && user.preferences.language !== ui.lang) ui.setLang(user.preferences.language);
  if (user.preferences?.theme && user.preferences.theme !== ui.theme) ui.setTheme(user.preferences.theme);
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  business: null,
  membership: null,
  entitlements: null,
  platformAdmin: false,

  async refreshEntitlements() {
    try {
      const me = await authApi.me();
      set({ entitlements: me.entitlements ?? null, platformAdmin: !!me.platformAdmin });
    } catch {
      /* the next page load retries */
    }
  },

  async bootstrap() {
    const token = await refreshAccessToken();
    if (!token) return set({ status: 'anonymous' });
    try {
      get().setSession(await authApi.me());
    } catch {
      tokenStore.set(null);
      set({ status: 'anonymous' });
    }
  },

  signIn({ accessToken, ...session }) {
    tokenStore.set(accessToken);
    // A fresh sign-in adopts the profile's saved language/theme; a page reload keeps this device's choice.
    applyPreferences(session.user);
    get().setSession(session);
    if (!session.entitlements) void get().refreshEntitlements();
  },

  setSession(session) {
    set({
      status: 'authenticated',
      user: session.user,
      business: session.business,
      membership: session.membership,
      ...(session.entitlements ? { entitlements: session.entitlements, platformAdmin: !!session.platformAdmin } : {}),
    });
  },

  patchUser(user) {
    set({ user });
  },

  patchBusiness(business) {
    set({ business });
  },

  async signOut(callServer = true) {
    if (callServer) await authApi.logout().catch(() => undefined);
    tokenStore.set(null);
    // The next person on this browser starts with all their branches, not this user's pick.
    branchSelection.set(null);
    set({ status: 'anonymous', user: null, business: null, membership: null, entitlements: null, platformAdmin: false });
  },
}));

tokenStore.onSessionLost(() => {
  if (useAuth.getState().status === 'authenticated') void useAuth.getState().signOut(false);
});

/** Whether the plan includes a module (true until entitlements load, so nothing flickers away). */
export function useModule(module: Module): boolean {
  const e = useAuth((s) => s.entitlements);
  return !e || e.modules.includes(module);
}

/** UI hint only — the API enforces every permission. */
export function useCan(...perms: Permission[]): boolean {
  const granted = useAuth((s) => s.membership?.permissions);
  return !!granted && perms.every((p) => granted.includes(p));
}
