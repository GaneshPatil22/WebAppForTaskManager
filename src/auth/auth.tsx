import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config';

/**
 * Who is signed in. Mock mode has a pretend user and no network. http mode
 * uses Supabase: Google, or an email magic link; tokens refreshed by
 * supabase-js. Both give the same kind of Supabase token, so the server
 * needs nothing extra for Google. The
 * Brain server verifies those tokens itself (ADR-0007); anonymous sign-in
 * is refused there, so it is not offered here.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; email: string | null };

export interface AuthService {
  mode: 'mock' | 'supabase';
  getToken(): Promise<string | null>;
  subscribe(l: (s: AuthState) => void): () => void;
  current(): AuthState;
  sendMagicLink(email: string): Promise<void>;
  /** Leaves the page for Google, then returns to this origin signed in. */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

export function createAuthService(config: Config): AuthService {
  return config.apiMode === 'mock' ? mockAuth() : supabaseAuth(config.supabaseUrl, config.supabaseKey);
}

function mockAuth(): AuthService {
  const state: AuthState = { status: 'signedIn', email: 'you@mock.local' };
  return {
    mode: 'mock',
    getToken: async () => 'mock-token',
    subscribe: (l) => { l(state); return () => {}; },
    current: () => state,
    sendMagicLink: async () => {},
    signInWithGoogle: async () => {},
    signOut: async () => {},
  };
}

function supabaseAuth(url: string, key: string): AuthService {
  // Loaded on demand: mock mode never downloads supabase-js.
  const sbP: Promise<SupabaseClient> = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
  let state: AuthState = { status: 'loading' };
  const ls = new Set<(s: AuthState) => void>();
  const set = (s: AuthState) => { state = s; for (const l of ls) l(s); };
  void sbP.then(async (sb) => {
    sb.auth.onAuthStateChange((_event, session) => {
      set(session ? { status: 'signedIn', email: session.user.email ?? null } : { status: 'signedOut' });
    });
    const { data } = await sb.auth.getSession();
    set(data.session ? { status: 'signedIn', email: data.session.user.email ?? null } : { status: 'signedOut' });
  });
  return {
    mode: 'supabase',
    async getToken() {
      const { data } = await (await sbP).auth.getSession();
      return data.session?.access_token ?? null;
    },
    subscribe(l) { ls.add(l); l(state); return () => ls.delete(l); },
    current: () => state,
    async sendMagicLink(email) {
      const { error } = await (await sbP).auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
    },
    async signInWithGoogle() {
      // Back to whichever origin started it: localhost in dev, the site in
      // production. Both must be in Supabase's redirect URLs.
      const { error } = await (await sbP).auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
      if (error) throw error;
    },
    async signOut() { await (await sbP).auth.signOut(); },
  };
}

const Ctx = createContext<{ auth: AuthService; state: AuthState } | null>(null);

export function AuthProvider({ auth, children }: { auth: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>(auth.current());
  useEffect(() => auth.subscribe(setState), [auth]);
  const v = useMemo(() => ({ auth, state }), [auth, state]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
