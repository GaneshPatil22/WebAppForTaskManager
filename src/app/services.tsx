import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import type { Config } from '../config';
import { createBrainClient, isApiError, type BrainClient, type MockBrainClient } from '../api';
import { createAuthService, AuthProvider, type AuthService } from '../auth/auth';
import { CaptureOutbox } from '../outbox/outbox';
import { CommentOutbox, type CommentEntry } from '../outbox/comments';
import { IdbOutboxStore, MemoryOutboxStore } from '../outbox/store';
import type { OutboxEntry } from '../outbox/store';

export interface Services {
  config: Config;
  client: BrainClient;
  auth: AuthService;
  outbox: CaptureOutbox;
  comments: CommentOutbox;
  queryClient: QueryClient;
  /** Present in mock mode only: reset and "server down" live in Settings. */
  mock: MockBrainClient | null;
}

export async function createServices(config: Config): Promise<Services> {
  const auth = createAuthService(config);
  const { client, mock } = await createBrainClient(config, () => auth.getToken());
  const store = typeof indexedDB === 'undefined' ? new MemoryOutboxStore() : new IdbOutboxStore();
  const outbox = new CaptureOutbox(store, client);
  const comments = new CommentOutbox(
    typeof indexedDB === 'undefined' ? new MemoryOutboxStore<CommentEntry>() : new IdbOutboxStore<CommentEntry>('brain-comment-outbox', 'comments'),
    client,
  );

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
  // A sent comment joins its thread from the server's own list.
  comments.onStored(() => { void queryClient.invalidateQueries({ queryKey: ['comments'] }); });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { outbox.retryNow(); comments.retryNow(); });
  }
  auth.subscribe((s) => {
    if (s.status === 'signedIn') { outbox.resume(); comments.resume(); }
    else if (s.status === 'signedOut') { outbox.pause(); comments.pause(); queryClient.clear(); }
  });

  return { config, client, auth, outbox, comments, queryClient, mock };
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

/** Comments still on this device (unsent, or refused). */
export function useCommentOutbox(): CommentEntry[] {
  const { comments } = useServices();
  const [rows, setRows] = useState<CommentEntry[]>(() => comments.snapshot());
  useEffect(() => comments.subscribe(setRows), [comments]);
  return rows;
}

export function useOutbox(): OutboxEntry[] {
  const { outbox } = useServices();
  const [rows, setRows] = useState<OutboxEntry[]>(() => outbox.snapshot());
  useEffect(() => outbox.subscribe(setRows), [outbox]);
  return useMemo(() => rows, [rows]);
}
