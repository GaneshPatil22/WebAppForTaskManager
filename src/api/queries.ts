import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ulid } from 'ulid';
import { isApiError, listAll, type DayRange } from './client';
import type {
  Capture, Commitment, CommitmentUpdate, Day, Edge, Goal, GoalUpdate, Item, ItemUpdate, NewCommitment, NewEdge,
  ItemType, NewGoal, OccurrenceState, Plan, Question,
} from './types';
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
  commitments: ['commitments'] as const,
  occurrences: ['occurrences'] as const,
  journal: ['journal'] as const,
  dailyPlans: ['dailyPlans'] as const,
  review: ['review'] as const,
};
const GRAPH = [K.plan, K.items, K.edges, K.questions];
/** Everything a commitment's state shows up in. */
const SCHEDULE = [K.plan, K.commitments, K.occurrences, K.review];

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

// ---------- the planner ----------
export function useCommitments() {
  const { client } = useServices();
  return useQuery({ queryKey: K.commitments, queryFn: () => client.listCommitments() });
}

export function useOccurrences(range: DayRange | null) {
  const { client } = useServices();
  return useQuery({
    queryKey: [...K.occurrences, range?.from, range?.through],
    queryFn: () => client.listOccurrences(range!),
    enabled: !!range,
  });
}

export function useJournal(range: DayRange | null) {
  const { client } = useServices();
  return useQuery({
    queryKey: [...K.journal, range?.from, range?.through],
    queryFn: () => client.listJournal(range!),
    enabled: !!range,
  });
}

export function useDailyPlans(range: DayRange | null) {
  const { client } = useServices();
  return useQuery({
    queryKey: [...K.dailyPlans, range?.from, range?.through],
    queryFn: () => client.listDailyPlans(range!),
    enabled: !!range,
  });
}

export function useReview(range: DayRange | null) {
  const { client } = useServices();
  return useQuery({
    queryKey: [...K.review, range?.from, range?.through],
    queryFn: () => client.getReview(range!),
    enabled: !!range,
  });
}

function useInvalidate(keys: readonly (readonly string[])[]) {
  const qc = useQueryClient();
  return () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

/**
 * Done, skipped or moved, or `null` to undo. Optimistic on the plan's
 * commitments section, because ticking a habit should feel instant.
 */
export function useSetOccurrence() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidate(SCHEDULE);
  return useMutation({
    mutationFn: async ({ id, day, state, movedTo }: { id: string; day: Day; state: OccurrenceState | null; movedTo?: Day }) => {
      if (state === null) await client.clearOccurrence(id, day);
      else await client.setOccurrence(id, day, { state, ...(movedTo ? { movedTo } : {}) });
    },
    onMutate: async ({ id, day, state }) => {
      await qc.cancelQueries({ queryKey: K.plan });
      const before = qc.getQueryData<Plan>(K.plan);
      if (before && before.day === day) {
        qc.setQueryData<Plan>(K.plan, {
          ...before,
          commitments: before.commitments.map((s) => {
            if (s.commitment.id !== id || s.movedFrom) return s;
            const { state: _s, movedTo: _m, ...rest } = s;
            return state === null ? rest : { ...rest, state };
          }),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(K.plan, ctx.before); },
    onSettled: () => invalidate(),
  });
}

export function useCreateCommitment() {
  const { client } = useServices();
  const invalidate = useInvalidate(SCHEDULE);
  return useMutation({
    mutationFn: (c: Omit<NewCommitment, 'id'>) => client.createCommitment({ ...c, id: ulid() }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCommitment() {
  const { client } = useServices();
  const invalidate = useInvalidate(SCHEDULE);
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: CommitmentUpdate }): Promise<Commitment> => client.updateCommitment(id, update),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCommitment() {
  const { client } = useServices();
  const invalidate = useInvalidate(SCHEDULE);
  return useMutation({ mutationFn: (id: string) => client.deleteCommitment(id), onSuccess: () => invalidate() });
}

export function useWriteJournal() {
  const { client } = useServices();
  const invalidate = useInvalidate([K.journal, K.review]);
  return useMutation({
    mutationFn: async ({ day, body }: { day: Day; body: string | null }) => {
      if (body === null) await client.deleteJournal(day);
      else await client.writeJournal(day, body);
    },
    onSuccess: () => invalidate(),
  });
}

/**
 * Confirms a day's big task. `proposedItemId` is what Brain showed; when the
 * user picks something else the server records the swap as a correction.
 */
export function useConfirmBigTask() {
  const { client } = useServices();
  const invalidate = useInvalidate([K.plan, K.dailyPlans, K.review]);
  return useMutation({
    mutationFn: ({ day, itemId, proposedItemId }: { day: Day; itemId: string; proposedItemId?: string | undefined }) =>
      client.confirmDailyPlan(day, { itemId, ...(proposedItemId ? { proposedItemId } : {}) }),
    onSuccess: () => invalidate(),
  });
}

// ---------- writes ----------
export function useUpdateItem() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: ItemUpdate }) => client.updateItem(id, update),
    onMutate: async ({ id, update }) => {
      // Optimistic: an edit shows at once and is put back if refused.
      await qc.cancelQueries({ queryKey: K.items });
      await qc.cancelQueries({ queryKey: K.plan });
      const before = qc.getQueryData<Item[]>(K.items);
      if (before) qc.setQueryData<Item[]>(K.items, before.map((i) => (i.id === id ? optimistic(i, update) : i)));
      // The plan carries its own copies of items. Only their look changes
      // here; the order stays Brain's until the plan is refetched.
      const plan = qc.getQueryData<Plan>(K.plan);
      if (plan && (update.effort || update.type || update.category || update.title !== undefined)) {
        const fix = <R extends { item: Item }>(r: R): R => (r.item.id === id ? { ...r, item: optimistic(r.item, update) } : r);
        qc.setQueryData<Plan>(K.plan, {
          ...plan, ranked: plan.ranked.map(fix), quickWins: plan.quickWins.map(fix), blocked: plan.blocked.map(fix),
          ...(plan.next ? { next: fix(plan.next) } : {}),
        });
      }
      // Setting the type answers Brain's open question about it (the server
      // closes it in the same edit), so it leaves the list now.
      const questions = qc.getQueryData<Question[]>(K.questions);
      if (questions && update.type) qc.setQueryData<Question[]>(K.questions, questions.filter((q) => !(q.itemId === id && q.field === 'type' && q.options.includes(update.type!))));
      return { before, questions, plan };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(K.items, ctx.before);
      if (ctx?.plan) qc.setQueryData(K.plan, ctx.plan);
      if (ctx?.questions) qc.setQueryData(K.questions, ctx.questions);
    },
    onSettled: () => invalidate(),
  });
}

/** What an edit will look like once the server has it: changed fields become yours. */
function optimistic(i: Item, u: ItemUpdate): Item {
  const mine = <T,>(v: T) => ({ value: v, confidence: 1, decidedBy: 'user' as const });
  return {
    ...i,
    ...(u.status ? { status: u.status } : {}),
    ...(u.title !== undefined ? { title: u.title } : {}),
    ...(u.type ? { type: mine(u.type) } : {}),
    ...(u.effort ? { effort: mine(u.effort) } : {}),
    ...(u.category ? { category: mine(u.category) } : {}),
  };
}

export function useCreateGoal() {
  const { client } = useServices();
  const invalidate = useInvalidate([K.goals, K.review, K.plan]);
  return useMutation({
    mutationFn: (g: Omit<NewGoal, 'id'>) => client.createGoal({ ...g, id: ulid() }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGoal() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: GoalUpdate }) => client.updateGoal(id, update),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K.goals }), qc.invalidateQueries({ queryKey: K.review }), invalidate()]),
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

/**
 * Answer Brain's question. The question leaves the list at once and the
 * item shows the answer as yours; both are put back if the server refuses.
 */
export function useAnswerQuestion() {
  const { client } = useServices();
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: async ({ q, option }: { q: Question; option: string }) => { await client.answerQuestion(q.id, { option }); },
    onMutate: async ({ q, option }) => {
      await qc.cancelQueries({ queryKey: K.questions });
      await qc.cancelQueries({ queryKey: K.items });
      const questions = qc.getQueryData<Question[]>(K.questions);
      const items = qc.getQueryData<Item[]>(K.items);
      if (questions) qc.setQueryData<Question[]>(K.questions, questions.filter((x) => x.id !== q.id));
      if (items && q.field === 'type') {
        qc.setQueryData<Item[]>(K.items, items.map((i) => (i.id === q.itemId ? { ...i, type: { value: option as ItemType, confidence: 1, decidedBy: 'user' } } : i)));
      }
      return { questions, items };
    },
    onError: (e, _v, ctx) => {
      // Already answered (409) or gone (404): it is not coming back either way.
      if (isApiError(e) && (e.status === 409 || e.status === 404)) return;
      if (ctx?.questions) qc.setQueryData(K.questions, ctx.questions);
      if (ctx?.items) qc.setQueryData(K.items, ctx.items);
    },
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
