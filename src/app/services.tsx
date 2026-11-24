import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import type { Config } from '../config';
import { createBrainClient, isApiError, type BrainClient, type MockBrainClient } from '../api';
import { createAuthService, AuthProvider, type AuthService } from '../auth/auth';
import { CaptureOutbox } from '../outbox/outbox';
import { IdbOutboxStore, MemoryOutboxStore } from '../outbox/store';
import type { OutboxEntry } from '../outbox/store';

export interface Services {
  config: Config;
  client: BrainClient;
  auth: AuthService;
  outbox: CaptureOutbox;
  queryClient: QueryClient;
  /** Present in mock mode only: reset and "server down" live in Settings. */
  mock: MockBrainClient | null;
}

export async function createServices(config: Config): Promise<Services> {
  const auth = createAuthService(config);
  const { client, mock } = await createBrainClient(config, () => auth.getToken());
  const store = typeof indexedDB === 'undefined' ? new MemoryOutboxStore() : new IdbOutboxStore();
  const outbox = new CaptureOutbox(store, client);

  const onError = (e: unknown) => {
    // 401 means the token is bad: sign out. 503 never does (see openapi.yaml).
    if (isApiError(e) && e.kind === 'unauthorized' && auth.mode === 'supabase') void auth.signOut();
  };
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, e) => isApiError(e) && e.retryable && count < 3,
        retryDelay: (n) => Math.min(30_000, 500 * 2 ** n),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });

  // Once the server has a capture, the inbox should show it.
  outbox.onStored(() => { void queryClient.invalidateQueries({ queryKey: ['captures'] }); });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => outbox.retryNow());
  }
  auth.subscribe((s) => {
    if (s.status === 'signedIn') outbox.resume();
    else if (s.status === 'signedOut') { outbox.pause(); queryClient.clear(); }
  });

  return { config, client, auth, outbox, queryClient, mock };
}

const Ctx = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return (
    <Ctx.Provider value={services}>
      <QueryClientProvider client={services.queryClient}>
        <AuthProvider auth={services.auth}>{children}</AuthProvider>
      </QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useServices(): Services {
  const v = useContext(Ctx);
  if (!v) throw new Error('useServices outside ServicesProvider');
  return v;
}

export function useOutbox(): OutboxEntry[] {
  const { outbox } = useServices();
  const [rows, setRows] = useState<OutboxEntry[]>(() => outbox.snapshot());
  useEffect(() => outbox.subscribe(setRows), [outbox]);
  return useMemo(() => rows, [rows]);
}
