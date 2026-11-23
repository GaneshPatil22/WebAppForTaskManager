import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ulid } from 'ulid';
import { listAll } from './client';
import type { Answer, Capture, Edge, Goal, GoalUpdate, Item, ItemUpdate, NewEdge } from './types';
import { useServices } from '../app/services';
import { dayKey, type DayKey } from '../domain/time';

/** Query keys. Anything that can change the graph invalidates `GRAPH`. */
export const K = {
  me: ['me'] as const,
  plan: ['plan'] as const,
  items: ['items'] as const,
  captures: ['captures'] as const,
  goals: ['goals'] as const,
  edges: ['edges'] as const,
  questions: ['questions'] as const,
};
const GRAPH = [K.plan, K.items, K.edges, K.questions];

function useInvalidateGraph() {
  const qc = useQueryClient();
  return () => Promise.all(GRAPH.map((k) => qc.invalidateQueries({ queryKey: k })));
}

// ---------- reads ----------
export function useMe() {
  const { client } = useServices();
  return useQuery({ queryKey: K.me, queryFn: () => client.getMe(), staleTime: 5 * 60_000 });
}

/** The user's timezone. Until /v1/me answers, the browser's, so the first paint isn't blank. */
export function useTimezone(): string {
  const me = useMe();
  return me.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Now, refreshed every 30 s, so "today" rolls over at the user's midnight. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(iv);
  }, []);
  return now;
}

export function useToday(): { today: DayKey; now: Date; tz: string } {
  const tz = useTimezone();
  const now = useNow();
  return { today: dayKey(now, tz), now, tz };
}

export function usePlan() {
  const { client } = useServices();
  return useQuery({ queryKey: K.plan, queryFn: () => client.getPlan() });
}

export function useItems() {
  const { client } = useServices();
  return useQuery({
    queryKey: K.items,
    queryFn: () => listAll<Item>(async (after) => {
      const p = await client.listItems({ ...(after ? { after } : {}), limit: 500 });
      return { rows: p.items, nextCursor: p.nextCursor };
    }),
  });
}

export function useItemsById(): Map<string, Item> {
  const { data } = useItems();
  return useMemo(() => new Map((data ?? []).map((i) => [i.id, i])), [data]);
}

export function useCaptures() {
  const { client } = useServices();
  return useQuery({
    queryKey: K.captures,
    queryFn: () => listAll<Capture>(async (after) => {
      const p = await client.listCaptures({ ...(after ? { after } : {}), limit: 500 });
      return { rows: p.captures, nextCursor: p.nextCursor };
    }),
    // Poll only while something is being organised.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'raw' || c.status === 'enriching') ? 1500 : false),
  });
}

/**
 * When a capture finishes enriching, the graph changed: refetch it. Mounted
 * once, in the shell.
 */
export function useEnrichmentWatcher() {
  const { data } = useCaptures();
  const invalidate = useInvalidateGraph();
  const prev = useRef<Map<string, Capture['status']>>(new Map());
  useEffect(() => {
    if (!data) return;
    let changed = false;
    for (const c of data) {
      const before = prev.current.get(c.id);
      if (before && before !== c.status && (c.status === 'enriched' || c.status === 'failed')) changed = true;
    }
    prev.current = new Map(data.map((c) => [c.id, c.status]));
    if (changed) void invalidate();
  }, [data, invalidate]);
}

export function useGoals() {
  const { client } = useServices();
  return useQuery({ queryKey: K.goals, queryFn: () => client.listGoals() });
}

export function useGoalsById(): Map<string, Goal> {
  const { data } = useGoals();
  return useMemo(() => new Map((data ?? []).map((g) => [g.id, g])), [data]);
}

export function useEdges() {
  const { client } = useServices();
  return useQuery({ queryKey: K.edges, queryFn: () => client.listEdges() });
}

export function useSuggestions(): { data: Edge[] | undefined; error: unknown; isLoading: boolean; refetch: () => void } {
  const q = useEdges();
  const data = useMemo(() => q.data?.filter((e) => !e.confirmed), [q.data]);
  return { data, error: q.error, isLoading: q.isLoading, refetch: () => void q.refetch() };
}

export function useQuestions() {
  const { client } = useServices();
  return useQuery({ queryKey: K.questions, queryFn: () => client.listQuestions() });
}

// ---------- writes ----------
export function useUpdateItem() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: ItemUpdate }) => client.updateItem(id, update),
    onMutate: async ({ id, update }) => {
      // Optimistic for the common case, ticking something done.
      await qc.cancelQueries({ queryKey: K.items });
      const before = qc.getQueryData<Item[]>(K.items);
      if (before && update.status) qc.setQueryData<Item[]>(K.items, before.map((i) => (i.id === id ? { ...i, status: update.status! } : i)));
      return { before };
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(K.items, ctx.before); },
    onSettled: () => invalidate(),
  });
}

export function useCreateGoal() {
  const { client } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => client.createGoal({ id: ulid(), title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.goals }),
  });
}

export function useUpdateGoal() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: GoalUpdate }) => client.updateGoal(id, update),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K.goals }), invalidate()]),
  });
}

export function useCreateEdge() {
  const { client } = useServices();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: (e: Omit<NewEdge, 'id'>) => client.createEdge({ ...e, id: ulid() }),
    onSuccess: () => invalidate(),
  });
}

export function useConfirmEdge() {
  const { client } = useServices();
  const invalidate = useInvalidateGraph();
  return useMutation({ mutationFn: (id: string) => client.confirmEdge(id), onSettled: () => invalidate() });
}

export function useRejectEdge() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: (id: string) => client.rejectEdge(id),
    onMutate: (id) => {
      const before = qc.getQueryData<Edge[]>(K.edges);
      if (before) qc.setQueryData<Edge[]>(K.edges, before.filter((e) => e.id !== id));
      return { before };
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(K.edges, ctx.before); },
    onSettled: () => invalidate(),
  });
}

export function useAnswerQuestion() {
  const { client } = useServices();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: Answer }) => client.answerQuestion(id, answer),
    onSettled: () => invalidate(),
  });
}

export function useUpdateTimezone() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: (tz: string) => client.updateMe(tz),
    onSuccess: (me) => { qc.setQueryData(K.me, me); void invalidate(); },
  });
}
