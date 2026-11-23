/**
 * MOCK SERVER ONLY. An in-browser fake of the Brain API, written to the same
 * contract (openapi.yaml) and the same rules: ids are client ULIDs and
 * creates are idempotent, other users' ids are 404, captures are never
 * deleted, a `blocks` cycle is a 409, `confirmed` implies `user`.
 *
 * State is kept in localStorage so a reload keeps your data. Settings has
 * a reset and a "server down" switch for testing the capture outbox.
 */
import { ulid } from 'ulid';
import { ApiError, type BrainClient, type PageQuery } from '../client';
import {
  ULID_PATTERN, type Answer, type Capture, type CaptureStatus, type Edge, type Goal, type GoalUpdate, type Item,
  type ItemStatus, type ItemUpdate, type Me, type NewCapture, type NewEdge, type NewGoal, type Plan, type Question,
} from '../types';
import { computePlan, wouldCycle } from './scoring';
import { bestMatch, extract, jaccard } from './enrich';
import { seedDb } from './seed';
import { isValidTimeZone } from '../../domain/time';

export interface Correction {
  id: string; targetId: string; field: string; beforeValue: unknown; afterValue: unknown; tier: string; createdAt: string;
}

export interface MockDb {
  version: 1;
  me: Me;
  captures: Capture[];
  items: Item[];
  goals: Goal[];
  edges: Edge[];
  /** "from|to|kind" of rejected suggestions: never suggested again. */
  rejected: string[];
  questions: Question[];
  corrections: Correction[];
}

export interface MockOptions {
  storageKey?: string | null;
  latencyMs?: [number, number];
  enrichDelayMs?: [number, number];
  now?: () => Date;
  timezone?: string;
}

const DEFAULT_TZ = 'Asia/Kolkata';

export class MockBrainClient implements BrainClient {
  private db: MockDb;
  private readonly opt: Required<Omit<MockOptions, 'storageKey'>> & { storageKey: string | null };
  private down = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: MockOptions = {}) {
    this.opt = {
      storageKey: options.storageKey === undefined ? 'brain-mock-db-v1' : options.storageKey,
      latencyMs: options.latencyMs ?? [120, 320],
      enrichDelayMs: options.enrichDelayMs ?? [700, 1600],
      now: options.now ?? (() => new Date()),
      timezone: options.timezone ?? DEFAULT_TZ,
    };
    this.db = this.load() ?? seedDb(this.opt.now(), this.opt.timezone);
    this.save();
    // Anything left mid-enrichment by a reload resumes, as the worker would.
    for (const c of this.db.captures) if (c.status === 'raw' || c.status === 'enriching' || c.status === 'failed') this.scheduleEnrichment(c.id);
  }

  // ---------- test and settings hooks ----------
  setServerDown(down: boolean) { this.down = down; }
  get isServerDown() { return this.down; }
  reset(empty = false) {
    this.db = seedDb(this.opt.now(), this.db.me.timezone);
    if (empty) Object.assign(this.db, { captures: [], items: [], goals: [], edges: [], questions: [], rejected: [], corrections: [] });
    this.save();
  }
  dispose() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  snapshot(): MockDb { return structuredClone(this.db); }

  // ---------- plumbing ----------
  private load(): MockDb | null {
    if (!this.opt.storageKey) return null;
    try {
      const raw = localStorage.getItem(this.opt.storageKey);
      const db = raw ? (JSON.parse(raw) as MockDb) : null;
      return db?.version === 1 ? db : null;
    } catch { return null; }
  }
  private save() {
    if (!this.opt.storageKey) return;
    try { localStorage.setItem(this.opt.storageKey, JSON.stringify(this.db)); } catch { /* storage full or blocked: memory still works */ }
  }
  private async call<T>(f: () => T): Promise<T> {
    const [lo, hi] = this.opt.latencyMs;
    if (hi > 0) await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
    if (this.down) throw new ApiError(503, 'unavailable', 'The server is unavailable (simulated).');
    const out = f();
    this.save();
    return structuredClone(out);
  }
  private later(ms: number, f: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); f(); this.save(); }, ms);
    this.timers.add(t);
  }
  private nowIso() { return this.opt.now().toISOString(); }

  private notFound(): never { throw new ApiError(404, 'not_found', 'Not found.'); }
  private invalid(message: string, code = 'invalid'): never { throw new ApiError(400, code, message); }
  private checkId(id: string) { if (!ULID_PATTERN.test(id)) this.invalid('Ids must be uppercase ULIDs.', 'invalid_id'); }
  private page<T extends { id: string }>(rows: T[], q: PageQuery) {
    const limit = q.limit ?? 100;
    if (limit < 1 || limit > 500) this.invalid('limit must be between 1 and 500.');
    if (q.after) this.checkId(q.after);
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const start = q.after ? sorted.filter((r) => r.id <= q.after!).length : 0;
    const slice = sorted.slice(start, start + limit);
    const more = start + limit < sorted.length;
    return { slice, nextCursor: more ? slice[slice.length - 1]!.id : undefined };
  }
  private item(id: string): Item { this.checkId(id); return this.db.items.find((i) => i.id === id) ?? this.notFound(); }

  // ---------- me ----------
  getMe(): Promise<Me> { return this.call(() => this.db.me); }
  updateMe(timezone: string): Promise<Me> {
    return this.call(() => {
      if (!isValidTimeZone(timezone)) this.invalid(`Unknown timezone "${timezone}".`, 'invalid_timezone');
      this.db.me.timezone = timezone;
      return this.db.me;
    });
  }

  // ---------- captures ----------
  createCapture(input: NewCapture) {
    return this.call(() => {
      this.checkId(input.id);
      const existing = this.db.captures.find((c) => c.id === input.id);
      if (existing) return { capture: existing, created: false };
      const len = [...input.text].length;
      if (len < 1 || len > 20000) this.invalid('Capture text must be 1 to 20,000 characters.', 'invalid_text');
      const now = this.opt.now();
      let at = input.capturedAt ? new Date(input.capturedAt) : now;
      if (Number.isNaN(at.getTime()) || at > now) at = now; // never refuse a capture for its timestamp
      const capture: Capture = { id: input.id, text: input.text, source: input.source ?? 'text', status: 'raw', capturedAt: at.toISOString() };
      this.db.captures.push(capture);
      this.scheduleEnrichment(capture.id);
      return { capture, created: true };
    });
  }
  listCaptures(q: PageQuery & { status?: CaptureStatus } = {}) {
    return this.call(() => {
      const rows = q.status ? this.db.captures.filter((c) => c.status === q.status) : this.db.captures;
      const { slice, nextCursor } = this.page(rows, q);
      return { captures: slice, ...(nextCursor ? { nextCursor } : {}) };
    });
  }
  getCapture(id: string) {
    return this.call(() => { this.checkId(id); return this.db.captures.find((c) => c.id === id) ?? this.notFound(); });
  }

  private scheduleEnrichment(captureId: string) {
    const [lo, hi] = this.opt.enrichDelayMs;
    const d = lo + Math.random() * (hi - lo);
    this.later(d / 3, () => {
      const c = this.db.captures.find((x) => x.id === captureId);
      if (c && c.status !== 'enriched') c.status = 'enriching';
    });
    this.later(d, () => this.enrich(captureId));
  }

  private enrich(captureId: string) {
    const c = this.db.captures.find((x) => x.id === captureId);
    if (!c || c.status === 'enriched') return;
    if (this.db.items.some((i) => i.captureId === c.id)) { c.status = 'enriched'; return; }
    const now = this.opt.now();
    const x = extract(c.text, now, this.db.me.timezone);
    const goal = this.db.goals.find((g) => g.status === 'active' && new RegExp(`\\b${escapeRe(g.title)}\\b`, 'i').test(c.text));
    const item: Item = {
      id: ulid(now.getTime()),
      captureId: c.id,
      title: x.title,
      status: 'open',
      type: { ...x.type, decidedBy: 't0' },
      effort: { ...x.effort, decidedBy: 't0' },
      dueAt: { ...x.dueAt, decidedBy: 't0' },
      goal: goal ? { value: goal.id, confidence: 0.7, decidedBy: 't0' } : { confidence: 0, decidedBy: 't0' },
      category: { ...x.category, decidedBy: 't0' },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.db.items.push(item);

    // Suggestions are unconfirmed edges. Rejected ones never come back.
    const suggest = (from: string, to: string, kind: Edge['kind'], confidence: number) => {
      if (this.db.rejected.includes(`${from}|${to}|${kind}`)) return;
      if (kind === 'blocks' && wouldCycle(from, to, this.db.edges)) return;
      this.db.edges.push({ id: ulid(now.getTime()), from, to, kind, confidence, suggestedBy: 't0Rule', confirmed: false });
    };
    if (x.dependsOn) {
      const m = bestMatch(x.dependsOn, this.db.items, item.id);
      if (m) suggest(m.id, item.id, 'blocks', 0.85);
    }
    for (const other of this.db.items) {
      if (other.id === item.id || other.status !== 'open') continue;
      const s = jaccard(item.title, other.title);
      if (s >= 0.5) suggest(item.id, other.id, 'duplicate', Math.min(0.95, s + 0.2));
    }
    // Abstained on type: ask instead of guessing (T3).
    if (!item.type.value) {
      this.db.questions.push({
        id: ulid(now.getTime()), captureId: c.id, itemId: item.id, field: 'type',
        prompt: `What is “${item.title}”?`, options: ['task', 'idea', 'note', 'reminder', 'link'],
      });
    }
    c.status = 'enriched';
  }

  // ---------- items ----------
  listItems(q: PageQuery & { status?: ItemStatus } = {}) {
    return this.call(() => {
      const rows = q.status ? this.db.items.filter((i) => i.status === q.status) : this.db.items;
      const { slice, nextCursor } = this.page(rows, q);
      return { items: slice, ...(nextCursor ? { nextCursor } : {}) };
    });
  }
  getItem(id: string) { return this.call(() => this.item(id)); }
  updateItem(id: string, u: ItemUpdate) {
    return this.call(() => {
      const it = this.item(id);
      const now = this.nowIso();
      const correct = (field: string, before: unknown, after: unknown, tier: string) =>
        this.db.corrections.push({ id: ulid(), targetId: id, field, beforeValue: before, afterValue: after, tier, createdAt: now });
      if (u.title !== undefined) {
        const len = [...u.title].length;
        if (len < 1 || len > 500) this.invalid('Title must be 1 to 500 characters.');
        if (u.title !== it.title) { correct('title', it.title, u.title, 'user'); it.title = u.title; }
      }
      if (u.status !== undefined && u.status !== it.status) { correct('status', it.status, u.status, 'user'); it.status = u.status; }
      const classified = <K extends 'type' | 'effort' | 'dueAt' | 'category'>(k: K, v: Item[K]['value']) => {
        if (v === undefined) return;
        const before = it[k];
        if (before.value !== v || before.decidedBy !== 'user') correct(k, before.value, v, before.decidedBy);
        (it[k] as { value?: unknown; confidence: number; decidedBy: string }) = { value: v, confidence: 1, decidedBy: 'user' };
      };
      classified('type', u.type);
      classified('effort', u.effort);
      if (u.dueAt !== undefined && Number.isNaN(Date.parse(u.dueAt))) this.invalid('dueAt must be a date-time.');
      classified('dueAt', u.dueAt);
      classified('category', u.category);
      if (u.goalId !== undefined) {
        this.checkId(u.goalId);
        if (!this.db.goals.some((g) => g.id === u.goalId)) this.notFound();
        correct('goal', it.goal.value, u.goalId, it.goal.decidedBy);
        it.goal = { value: u.goalId, confidence: 1, decidedBy: 'user' };
      }
      // Answering by editing makes the question moot.
      if (u.type) this.db.questions = this.db.questions.filter((q) => !(q.itemId === id && q.field === 'type'));
      it.updatedAt = now;
      return it;
    });
  }

  // ---------- goals ----------
  listGoals() { return this.call(() => this.db.goals); }
  createGoal(input: NewGoal) {
    return this.call(() => {
      this.checkId(input.id);
      const existing = this.db.goals.find((g) => g.id === input.id);
      if (existing) return existing;
      const len = [...input.title.trim()].length;
      if (len < 1 || len > 500) this.invalid('Title must be 1 to 500 characters.');
      const g: Goal = { id: input.id, title: input.title.trim(), status: 'active', createdAt: this.nowIso() };
      this.db.goals.push(g);
      return g;
    });
  }
  updateGoal(id: string, u: GoalUpdate) {
    return this.call(() => {
      this.checkId(id);
      const g = this.db.goals.find((x) => x.id === id) ?? this.notFound();
      if (u.title !== undefined) {
        const len = [...u.title.trim()].length;
        if (len < 1 || len > 500) this.invalid('Title must be 1 to 500 characters.');
        g.title = u.title.trim();
      }
      if (u.status) g.status = u.status;
      return g;
    });
  }

  // ---------- plan ----------
  getPlan(): Promise<Plan> {
    return this.call(() => computePlan(this.db.items, this.db.edges, this.opt.now(), this.db.me.timezone));
  }

  // ---------- edges ----------
  listEdges(q: { confirmed?: boolean } = {}) {
    return this.call(() => (q.confirmed === undefined ? this.db.edges : this.db.edges.filter((e) => e.confirmed === q.confirmed)));
  }
  createEdge(input: NewEdge) {
    return this.call(() => {
      this.checkId(input.id);
      const existing = this.db.edges.find((e) => e.id === input.id);
      if (existing) return existing;
      this.checkId(input.from);
      this.checkId(input.to);
      if (!this.db.items.some((i) => i.id === input.from)) this.notFound();
      const toIsGoal = this.db.goals.some((g) => g.id === input.to);
      const toIsItem = this.db.items.some((i) => i.id === input.to);
      if (input.kind === 'serves' ? !toIsGoal : !toIsItem) this.notFound();
      if (input.from === input.to) this.invalid('An item cannot link to itself.', 'self_loop');
      if (this.db.edges.some((e) => e.from === input.from && e.to === input.to && e.kind === input.kind)) {
        throw new ApiError(409, 'duplicate_edge', 'These two are already linked that way.');
      }
      if (input.kind === 'blocks' && wouldCycle(input.from, input.to, this.db.edges.filter((e) => e.confirmed))) {
        throw new ApiError(409, 'cycle', 'That link would make a loop: each would be waiting on the other.');
      }
      const e: Edge = { ...input, confidence: 1, suggestedBy: 'user', confirmed: true };
      this.db.edges.push(e);
      return e;
    });
  }
  confirmEdge(id: string) {
    return this.call(() => {
      this.checkId(id);
      const e = this.db.edges.find((x) => x.id === id) ?? this.notFound();
      if (e.kind === 'blocks' && !e.confirmed && wouldCycle(e.from, e.to, this.db.edges.filter((x) => x.confirmed))) {
        throw new ApiError(409, 'cycle', 'Confirming this would make a loop.');
      }
      // `confirmed` requires source = user (invariant 3).
      e.confirmed = true;
      e.suggestedBy = 'user';
      return e;
    });
  }
  rejectEdge(id: string) {
    return this.call(() => {
      this.checkId(id);
      const e = this.db.edges.find((x) => x.id === id) ?? this.notFound();
      this.db.rejected.push(`${e.from}|${e.to}|${e.kind}`);
      this.db.edges = this.db.edges.filter((x) => x.id !== id);
    });
  }

  // ---------- questions ----------
  listQuestions() { return this.call(() => this.db.questions); }
  answerQuestion(id: string, answer: Answer) {
    return this.call(() => {
      this.checkId(id);
      const q = this.db.questions.find((x) => x.id === id) ?? this.notFound();
      if (!q.options.includes(answer.option)) this.invalid('Answer with one of the offered options.', 'invalid_option');
      const it = q.itemId ? this.db.items.find((i) => i.id === q.itemId) : undefined;
      if (it && q.field === 'type') {
        this.db.corrections.push({ id: ulid(), targetId: it.id, field: 'type', beforeValue: it.type.value, afterValue: answer.option, tier: it.type.decidedBy, createdAt: this.nowIso() });
        it.type = { value: answer.option as Item['type']['value'] & string, confidence: 1, decidedBy: 't3' } as Item['type'];
        it.updatedAt = this.nowIso();
      }
      this.db.questions = this.db.questions.filter((x) => x.id !== id);
    });
  }
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
