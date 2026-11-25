/**
 * MOCK SERVER ONLY. An in-browser fake of the Brain API, written to the same
 * contract (openapi.yaml) and, as far as it can be, the same behaviour as
 * the real server (Server/Sources/App). If the two disagree, the server is
 * right and this file is a bug: a mock that invents behaviour misleads the
 * design (it already did once, with questions and duplicate links).
 *
 * What it does, as the server and Brain 0.9.0 do:
 * - asks a question when the type can't be read (Brain's `typeQuestion`).
 *   The mock has no model, so it asks whenever its rules abstain. In
 *   production a model answers most of those first, so expect fewer;
 * - suggests at most one duplicate (Brain's `TitleMatcher.bestDuplicate`)
 *   and `blocks` links from phrases such as "after X", all unconfirmed.
 *
 * What it does NOT do: suggest "relates" links, or assign goals to items
 * (only the user does that).
 *
 * State is kept in localStorage so a reload keeps your data. Settings has
 * a reset and a "server down" switch for testing the capture outbox.
 */
import { ulid } from 'ulid';
import { ApiError, type BrainClient, type DayRange, type PageQuery } from '../client';
import {
  ULID_PATTERN, type Answer, type Capture, type CaptureStatus, type Commitment, type CommitmentUpdate, type DailyPlan,
  type DailyPlanConfirm, type Edge, type Goal, type GoalUpdate, type Item, type ItemStatus, type ItemUpdate,
  type JournalEntry, type Me, type NewCapture, type NewCommitment, type NewEdge, type NewGoal, type Occurrence,
  type OccurrenceState, type OccurrenceUpdate, type Plan, type Question, type Review, type ScheduledCommitment,
  type Comment, type CommentTarget, type CommentUpdate, type GoalMark, type GoalMarkUpdate, type NewComment, type NewGoalMark,
  COMMITMENT_KINDS, CATEGORIES,
} from '../types';
import { appearsInPlan, computePlan, wouldCycle } from './scoring';
import { bestDuplicate, bestMatch, extract, typeQuestion } from './enrich';
import { days, falls, hitRate, next, ruleText, scheduledOn, streak, validRule } from './recurrence';
import { seedDb } from './seed';
import { addDaysToKey, dayKey, daysBetween, isValidTimeZone, type DayKey } from '../../domain/time';
import { parsePeriod, periodBounds, periodLabel } from '../../domain/period';

export interface Correction {
  id: string; targetId: string; field: string; beforeValue: unknown; afterValue: unknown; tier: string; createdAt: string;
}

/** A commitment as stored: the template plus whether it was deleted. */
export interface StoredCommitment {
  id: string; title: string; kind: Commitment['kind']; rule: Commitment['rule']; minutes: number;
  category?: Commitment['category']; goalId?: string; startOn: DayKey; endOn?: DayKey; paused: boolean; note?: string;
  archived: boolean; createdAt: string; updatedAt: string;
}

export interface OccurrenceRow { commitmentId: string; day: DayKey; state: OccurrenceState; movedTo?: DayKey; updatedAt: string }

/** A T3 question as stored (Server M0006). */
export interface StoredQuestion extends Question { answeredAt?: string; answer?: string }

export interface MockDb {
  version: 3;
  me: Me;
  captures: Capture[];
  items: Item[];
  goals: Goal[];
  edges: Edge[];
  /** "from|to|kind" of rejected suggestions: never suggested again. */
  rejected: string[];
  corrections: Correction[];
  commitments: StoredCommitment[];
  occurrences: OccurrenceRow[];
  journal: JournalEntry[];
  dailyPlans: DailyPlan[];
  questions: StoredQuestion[];
  /** M0007. Added after v3 shipped; filled in on load if missing. */
  comments: Comment[];
  marks: GoalMark[];
}

export interface MockOptions {
  storageKey?: string | null;
  latencyMs?: [number, number];
  enrichDelayMs?: [number, number];
  now?: () => Date;
  timezone?: string;
  /** Start with no data at all, as a new account does. */
  empty?: boolean;
}

const DEFAULT_TZ = 'Asia/Kolkata';
const STREAK_HISTORY_DAYS = 400;
const MAX_RANGE_DAYS = 92;

export class MockBrainClient implements BrainClient {
  private db: MockDb;
  private readonly opt: Required<Omit<MockOptions, 'storageKey' | 'empty'>> & { storageKey: string | null };
  private down = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: MockOptions = {}) {
    this.opt = {
      storageKey: options.storageKey === undefined ? 'brain-mock-db-v2' : options.storageKey,
      latencyMs: options.latencyMs ?? [120, 320],
      enrichDelayMs: options.enrichDelayMs ?? [700, 1600],
      now: options.now ?? (() => new Date()),
      timezone: options.timezone ?? DEFAULT_TZ,
    };
    this.db = this.load() ?? (options.empty ? emptyDb(this.opt.timezone) : seedDb(this.opt.now(), this.opt.timezone));
    this.save();
    // Anything left mid-enrichment by a reload resumes, as the worker would.
    for (const c of this.db.captures) if (c.status !== 'enriched') this.scheduleEnrichment(c.id);
  }

  // ---------- test and settings hooks ----------
  setServerDown(down: boolean) { this.down = down; }
  get isServerDown() { return this.down; }
  reset(empty = false) {
    this.db = empty ? emptyDb(this.db.me.timezone) : seedDb(this.opt.now(), this.db.me.timezone);
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
      // v2 had no questions; everything else is the same shape.
      if ((db?.version as number) === 2) return { ...db!, version: 3, questions: [], comments: [], marks: [] };
      return db?.version === 3 ? { ...db, comments: db.comments ?? [], marks: db.marks ?? [] } : null;
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
  private today(): DayKey { return dayKey(this.opt.now(), this.db.me.timezone); }

  private notFound(what = 'Not found.'): never { throw new ApiError(404, 'not_found', what); }
  private invalid(message: string, code = 'invalid'): never { throw new ApiError(400, code, message); }
  private checkId(id: string, field = 'id') { if (!ULID_PATTERN.test(id)) this.invalid(`${field} must be a ULID`, 'invalid_id'); }
  private checkDay(day: string, field: string): DayKey {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
      this.invalid(`${field} must be a day, YYYY-MM-DD`, 'invalid_day');
    }
    return day;
  }
  private checkRange(r: DayRange) {
    const from = this.checkDay(r.from, 'from');
    const through = this.checkDay(r.through, 'through');
    if (from > through) this.invalid('from must not be after through', 'invalid_range');
    if (daysBetween(from, through) >= MAX_RANGE_DAYS) this.invalid(`at most ${MAX_RANGE_DAYS} days at a time`, 'invalid_range');
    return { from, through };
  }
  /** Length in Unicode code points, like the server's scalar count. */
  private text(v: string, field: string, max: number) {
    const n = [...v].length;
    if (n < 1) this.invalid(`${field} must not be empty`, `empty_${field}`);
    if (n > max) this.invalid(`${field} is over ${max} characters`, `${field}_too_long`);
    return v;
  }
  private page<T extends { id: string }>(rows: T[], q: PageQuery) {
    const limit = q.limit ?? 100;
    if (limit < 1 || limit > 500) this.invalid('limit must be 1 to 500', 'invalid_limit');
    if (q.after) this.checkId(q.after, 'after');
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const start = q.after ? sorted.filter((r) => r.id <= q.after!).length : 0;
    const slice = sorted.slice(start, start + limit);
    const more = start + limit < sorted.length;
    return { slice, nextCursor: more ? slice[slice.length - 1]!.id : undefined };
  }
  private item(id: string): Item { this.checkId(id); return this.db.items.find((i) => i.id === id) ?? this.notFound('No such item.'); }

  // ---------- me ----------
  getMe(): Promise<Me> { return this.call(() => this.db.me); }
  updateMe(timezone: string): Promise<Me> {
    return this.call(() => {
      if (!isValidTimeZone(timezone)) this.invalid('not an IANA timezone name', 'invalid_timezone');
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
      this.text(input.text, 'text', 20000);
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
    return this.call(() => { this.checkId(id); return this.db.captures.find((c) => c.id === id) ?? this.notFound('No such capture.'); });
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

  /** One item per capture, like Brain's pipeline. Goals are never assigned. */
  private enrich(captureId: string) {
    const c = this.db.captures.find((x) => x.id === captureId);
    if (!c || c.status === 'enriched') return;
    if (this.db.items.some((i) => i.captureId === c.id)) { c.status = 'enriched'; return; }
    const now = this.opt.now();
    const x = extract(c.text, now, this.db.me.timezone);
    const item: Item = {
      id: ulid(now.getTime()),
      captureId: c.id,
      title: x.title,
      status: 'open',
      type: { ...x.type, decidedBy: 't0' },
      effort: { ...x.effort, decidedBy: 't0' },
      dueAt: { ...x.dueAt, decidedBy: 't0' },
      goal: { confidence: 0, decidedBy: 't0' },
      category: { ...x.category, decidedBy: 't0' },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const open = this.db.items.filter((i) => i.status === 'open');
    this.db.items.push(item);
    // Explicit dependencies only ("after X"), proposed and never confirmed.
    if (x.dependsOn) {
      const m = bestMatch(x.dependsOn, this.db.items, item.id);
      if (m && !this.db.rejected.includes(`${m.id}|${item.id}|blocks`) && !wouldCycle(m.id, item.id, this.db.edges)) {
        this.db.edges.push({ id: ulid(now.getTime()), from: m.id, to: item.id, kind: 'blocks', confidence: 0.8, suggestedBy: 't0Rule', confirmed: false });
      }
    }
    // At most one duplicate, against the open items that existed before.
    const twin = bestDuplicate(item.title, open);
    if (twin && !this.db.rejected.includes(`${item.id}|${twin.id}|duplicate`)) {
      this.db.edges.push({ id: ulid(now.getTime()), from: item.id, to: twin.id, kind: 'duplicate', confidence: twin.score, suggestedBy: 't0Rule', confirmed: false });
    }
    // T3: every rung abstained on the type, so ask rather than guess.
    if (!item.type.value) {
      const q = typeQuestion(item.title);
      this.db.questions.push({ id: ulid(now.getTime()), captureId: c.id, itemId: item.id, ...q, createdAt: now.toISOString() });
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
        this.text(u.title, 'title', 500);
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
      // Setting the type by hand answers Brain's open question about it; the
      // edit's own correction is the label, so none is written here.
      if (u.type !== undefined) {
        for (const q of this.db.questions) {
          if (q.itemId === id && q.field === 'type' && !q.answeredAt && q.options.includes(u.type)) { q.answeredAt = now; q.answer = u.type; }
        }
      }
      classified('effort', u.effort);
      if (u.dueAt !== undefined && Number.isNaN(Date.parse(u.dueAt))) this.invalid('dueAt must be a date-time.');
      classified('dueAt', u.dueAt);
      classified('category', u.category);
      if (u.goalId !== undefined) {
        this.checkId(u.goalId, 'goalId');
        if (!this.db.goals.some((g) => g.id === u.goalId)) this.notFound('No such goal.');
        correct('goal', it.goal.value, u.goalId, it.goal.decidedBy);
        it.goal = { value: u.goalId, confidence: 1, decidedBy: 'user' };
      }
      it.updatedAt = now;
      return it;
    });
  }

  // ---------- goals ----------
  /** As the server sends it: `doneCount` exactly when there is a `targetCount`. */
  private goalJson(g: Goal): Goal {
    const { doneCount: _d, ...rest } = g;
    const out: Goal = g.period ? { ...rest, periodText: periodLabel(g.period) } : { ...rest };
    if (g.targetCount !== undefined) out.doneCount = this.db.marks.filter((m) => m.goalId === g.id).length;
    return out;
  }
  /** A whole number of things, 1–1000. Never an amount. */
  private checkTarget(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > 1000) this.invalid('a target count is between 1 and 1000', 'invalid_target');
    return n;
  }
  listGoals(period?: string) {
    return this.call(() => {
      if (period !== undefined && !parsePeriod(period)) this.invalid('period must be YYYY-MM or YYYY-Qn', 'invalid_period');
      return this.db.goals.filter((g) => period === undefined || g.period === period).map((g) => this.goalJson(g));
    });
  }
  /** A month goal may roll up only into the quarter containing it (`Goal.canRollUp`). */
  private checkRollUp(goal: Goal) {
    const bad = () => this.invalid('a month goal can roll up only into the quarter containing it', 'invalid_rollup');
    if (goal.parentId) {
      const parent = this.db.goals.find((g) => g.id === goal.parentId) ?? this.notFound('No such goal.');
      if (!canRollUp(goal, parent)) bad();
    }
    for (const child of this.db.goals) if (child.parentId === goal.id && !canRollUp(child, goal)) bad();
  }
  createGoal(input: NewGoal) {
    return this.call(() => {
      this.checkId(input.id);
      this.text(input.title, 'title', 500);
      if (input.period !== undefined && !parsePeriod(input.period)) this.invalid('period must be YYYY-MM or YYYY-Qn', 'invalid_period');
      if (input.parentId !== undefined) this.checkId(input.parentId, 'parentId');
      if (input.targetCount !== undefined) this.checkTarget(input.targetCount);
      const existing = this.db.goals.find((g) => g.id === input.id);
      if (existing) return this.goalJson(existing);
      const g: Goal = {
        id: input.id, title: input.title, status: 'active', createdAt: this.nowIso(),
        ...(input.period ? { period: input.period } : {}), ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
      };
      this.checkRollUp(g);
      this.db.goals.push(g);
      return this.goalJson(g);
    });
  }
  updateGoal(id: string, u: GoalUpdate) {
    return this.call(() => {
      this.checkId(id);
      const stored = this.db.goals.find((x) => x.id === id) ?? this.notFound('No such goal.');
      const clear = new Set(u.clear ?? []);
      if ((clear.has('period') && u.period !== undefined) || (clear.has('parentId') && u.parentId !== undefined)
        || (clear.has('targetCount') && u.targetCount !== undefined)) {
        this.invalid('a field is both sent and cleared', 'conflicting_clear');
      }
      const g: Goal = { ...stored };
      if (u.title !== undefined) g.title = this.text(u.title, 'title', 500);
      if (u.status) g.status = u.status;
      if (u.period !== undefined) {
        if (!parsePeriod(u.period)) this.invalid('period must be YYYY-MM or YYYY-Qn', 'invalid_period');
        g.period = u.period;
      }
      if (u.parentId !== undefined) { this.checkId(u.parentId, 'parentId'); g.parentId = u.parentId; }
      if (clear.has('period')) delete g.period;
      if (clear.has('parentId')) delete g.parentId;
      this.checkRollUp(g);
      // The count first, as the server does: it can be refused, and a refusal
      // leaves the whole goal unchanged.
      if (u.targetCount !== undefined || clear.has('targetCount')) {
        const target = u.targetCount !== undefined ? this.checkTarget(u.targetCount) : undefined;
        const done = this.db.marks.filter((m) => m.goalId === id).length;
        if (done > (target ?? 0)) this.invalid(`${done} circle${done === 1 ? ' is' : 's are'} filled; empty some first`, 'target_below_done');
        if (target === undefined) delete g.targetCount; else g.targetCount = target;
      }
      Object.keys(stored).forEach((k) => delete (stored as Record<string, unknown>)[k]);
      Object.assign(stored, g);
      return this.goalJson(stored);
    });
  }

  // ---------- plan ----------
  getPlan(): Promise<Plan> {
    return this.call(() => {
      const now = this.opt.now();
      const today = this.today();
      const ranked = computePlan(this.db.items, this.db.edges, now, this.db.me.timezone, this.db.goals);
      const { section, owed } = this.commitmentsSection(today);
      const bigTask = this.db.dailyPlans.find((p) => p.day === today);
      return { ...ranked, day: today, commitments: section, committedMinutes: owed, ...(bigTask ? { bigTask } : {}) };
    });
  }

  /** The server's `commitmentsSection`: today's, in Brain's order, plus anything moved into today. */
  private commitmentsSection(today: DayKey): { section: ScheduledCommitment[]; owed: number } {
    const live = this.live();
    const done = this.completed(today);
    const rows = this.db.occurrences.filter((r) => r.day === today || r.movedTo === today);
    const section: ScheduledCommitment[] = [];
    let owed = 0;
    for (const s of scheduledOn(live, today)) {
      const row = rows.find((r) => r.commitmentId === s.id && r.day === today);
      section.push({
        commitment: this.commitmentJson(s, done, today),
        ...(row ? { state: row.state } : {}),
        ...(row?.state === 'moved' && row.movedTo ? { movedTo: row.movedTo } : {}),
      });
      // Anything with a state is not owed today: done, skipped, or moved away.
      if (!row) owed += s.minutes;
    }
    for (const row of rows) {
      if (row.day === today || row.movedTo !== today) continue;
      const s = live.find((c) => c.id === row.commitmentId);
      if (!s) continue;
      section.push({
        commitment: this.commitmentJson(s, done, today),
        ...(row.state === 'done' ? { state: 'done' as const } : {}),
        movedFrom: row.day,
      });
      if (row.state !== 'done') owed += s.minutes;
    }
    return { section, owed };
  }

  // ---------- commitments ----------
  private live() { return this.db.commitments.filter((c) => !c.archived).sort((a, b) => a.id.localeCompare(b.id)); }
  private completed(today: DayKey): Map<string, Set<DayKey>> {
    const since = addDaysToKey(today, -STREAK_HISTORY_DAYS);
    const out = new Map<string, Set<DayKey>>();
    for (const r of this.db.occurrences) {
      if (r.state !== 'done' || r.day < since) continue;
      out.set(r.commitmentId, (out.get(r.commitmentId) ?? new Set()).add(r.day));
    }
    return out;
  }
  private commitmentJson(s: StoredCommitment, done: Map<string, Set<DayKey>>, today: DayKey): Commitment {
    const { archived: _a, ...rest } = s;
    const nextOn = next(s, today);
    return { ...rest, ruleText: ruleText(s.rule), streak: streak(s, done.get(s.id) ?? new Set(), today), ...(nextOn ? { nextOn } : {}) };
  }
  private liveCommitment(id: string): StoredCommitment {
    this.checkId(id);
    const s = this.db.commitments.find((c) => c.id === id);
    if (!s || s.archived) this.notFound('No such commitment.');
    return s;
  }
  private checkCommitmentFields(c: Partial<NewCommitment>) {
    if (c.title !== undefined) this.text(c.title, 'title', 200);
    if (c.kind !== undefined && !COMMITMENT_KINDS.includes(c.kind)) this.invalid('unknown kind', 'invalid_kind');
    if (c.rule !== undefined && !validRule(c.rule)) this.invalid(`${c.rule.kind} takes the fields of its shape, and nothing else`, 'invalid_rule');
    if (c.minutes !== undefined && (!Number.isInteger(c.minutes) || c.minutes < 0 || c.minutes > 1440)) this.invalid('minutes must be 0 to 1440', 'invalid_minutes');
    if (c.category !== undefined && !CATEGORIES.includes(c.category)) this.invalid('unknown category', 'invalid_category');
    if (c.note !== undefined && c.note !== '') this.text(c.note, 'note', 200);
    if (c.startOn !== undefined) this.checkDay(c.startOn, 'startOn');
    if (c.endOn !== undefined) this.checkDay(c.endOn, 'endOn');
    if (c.goalId !== undefined) {
      this.checkId(c.goalId, 'goalId');
      if (!this.db.goals.some((g) => g.id === c.goalId)) this.notFound('No such goal.');
    }
  }

  listCommitments() {
    return this.call(() => {
      const today = this.today();
      const done = this.completed(today);
      return this.live().map((s) => this.commitmentJson(s, done, today));
    });
  }
  createCommitment(input: NewCommitment) {
    return this.call(() => {
      this.checkId(input.id);
      this.checkCommitmentFields(input);
      const today = this.today();
      const startOn = input.startOn ?? today;
      if (input.endOn && input.endOn < startOn) this.invalid('endOn must not be before startOn', 'invalid_window');
      const existing = this.db.commitments.find((c) => c.id === input.id);
      if (existing) return this.commitmentJson(existing, this.completed(today), today);
      const now = this.nowIso();
      const s: StoredCommitment = {
        id: input.id, title: input.title, kind: input.kind, rule: input.rule, minutes: input.minutes,
        ...(input.category ? { category: input.category } : {}), ...(input.goalId ? { goalId: input.goalId } : {}),
        startOn, ...(input.endOn ? { endOn: input.endOn } : {}), paused: input.paused ?? false,
        ...(input.note ? { note: input.note } : {}), archived: false, createdAt: now, updatedAt: now,
      };
      this.db.commitments.push(s);
      return this.commitmentJson(s, this.completed(today), today);
    });
  }
  getCommitment(id: string) {
    return this.call(() => {
      const s = this.liveCommitment(id);
      const today = this.today();
      return this.commitmentJson(s, this.completed(today), today);
    });
  }
  updateCommitment(id: string, u: CommitmentUpdate) {
    return this.call(() => {
      const s = this.liveCommitment(id);
      const clear = new Set(u.clear ?? []);
      const sent = { category: u.category !== undefined, goalId: u.goalId !== undefined, endOn: u.endOn !== undefined, note: u.note !== undefined };
      const both = [...clear].find((f) => sent[f]);
      if (both) this.invalid(`${both} is both sent and cleared`, 'conflicting_clear');
      this.checkCommitmentFields(u);
      const c: StoredCommitment = { ...s };
      if (u.title !== undefined) c.title = u.title;
      if (u.kind !== undefined) c.kind = u.kind;
      if (u.rule !== undefined) c.rule = u.rule;
      if (u.minutes !== undefined) c.minutes = u.minutes;
      if (u.category !== undefined) c.category = u.category;
      if (u.goalId !== undefined) c.goalId = u.goalId;
      if (u.startOn !== undefined) c.startOn = u.startOn;
      if (u.endOn !== undefined) c.endOn = u.endOn;
      if (u.paused !== undefined) c.paused = u.paused;
      if (u.note !== undefined) { if (u.note) c.note = u.note; else delete c.note; }
      for (const f of clear) delete c[f];
      if (c.endOn && c.endOn < c.startOn) this.invalid('endOn must not be before startOn', 'invalid_window');
      c.updatedAt = this.nowIso();
      Object.keys(s).forEach((k) => delete (s as unknown as Record<string, unknown>)[k]);
      Object.assign(s, c);
      const today = this.today();
      return this.commitmentJson(s, this.completed(today), today);
    });
  }
  /** Archives and ends it today; its done days stay, so past reviews don't change. */
  deleteCommitment(id: string) {
    return this.call(() => {
      const s = this.liveCommitment(id);
      const today = this.today();
      const end = s.endOn && s.endOn < today ? s.endOn : today;
      s.endOn = end > s.startOn ? end : s.startOn;
      s.archived = true;
      s.updatedAt = this.nowIso();
    });
  }

  setOccurrence(id: string, day: string, u: OccurrenceUpdate) {
    return this.call((): Occurrence => {
      this.checkId(id);
      this.checkDay(day, 'day');
      if (u.movedTo !== undefined) this.checkDay(u.movedTo, 'movedTo');
      const s = this.liveCommitment(id);
      if (!falls(s, day)) this.invalid(`this commitment does not fall on ${day}`, 'not_scheduled');
      const today = this.today();
      const existing = this.db.occurrences.find((r) => r.commitmentId === id && r.day === day);
      let target: DayKey | undefined;
      if (u.state === 'moved') {
        if (!u.movedTo || u.movedTo === day) this.invalid('moved needs a different movedTo', 'invalid_move');
        target = u.movedTo;
      } else {
        if (u.movedTo !== undefined) this.invalid('movedTo is only for moved', 'invalid_move');
        // Done after a move: keep where it was done.
        if (u.state === 'done' && existing && existing.state !== 'skipped') target = existing.movedTo;
      }
      if (u.state === 'done' && (target ?? day) > today) this.invalid('that day has not come yet', 'in_future');
      const row: OccurrenceRow = { commitmentId: id, day, state: u.state, ...(target ? { movedTo: target } : {}), updatedAt: this.nowIso() };
      this.db.occurrences = [...this.db.occurrences.filter((r) => !(r.commitmentId === id && r.day === day)), row];
      return occurrenceJson(row);
    });
  }
  clearOccurrence(id: string, day: string) {
    return this.call(() => {
      this.checkDay(day, 'day');
      this.liveCommitment(id);
      this.db.occurrences = this.db.occurrences.filter((r) => !(r.commitmentId === id && r.day === day));
    });
  }
  listOccurrences(range: DayRange) {
    return this.call(() => {
      const { from, through } = this.checkRange(range);
      const live = this.live();
      const byKey = new Map(this.db.occurrences.filter((r) => (r.day >= from && r.day <= through) || (r.movedTo && r.movedTo >= from && r.movedTo <= through)).map((r) => [`${r.commitmentId}|${r.day}`, r]));
      const out: { place: DayKey; o: Occurrence }[] = [];
      for (const c of live) {
        for (const d of days(c, from, through)) {
          const key = `${c.id}|${d}`;
          const row = byKey.get(key);
          byKey.delete(key);
          out.push({ place: row?.movedTo ?? d, o: { commitmentId: c.id, day: d, ...(row ? { state: row.state } : {}), ...(row?.movedTo ? { movedTo: row.movedTo } : {}) } });
        }
      }
      // Moved in from outside the range.
      const liveIds = new Set(live.map((c) => c.id));
      for (const row of byKey.values()) {
        if (liveIds.has(row.commitmentId) && row.movedTo && row.movedTo >= from && row.movedTo <= through) {
          out.push({ place: row.movedTo, o: occurrenceJson(row) });
        }
      }
      const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      out.sort((a, b) => cmp(a.place, b.place) || cmp(a.o.commitmentId, b.o.commitmentId) || cmp(a.o.day, b.o.day));
      return out.map((x) => x.o);
    });
  }

  // ---------- journal ----------
  listJournal(range: DayRange) {
    return this.call(() => {
      const { from, through } = this.checkRange(range);
      return this.db.journal.filter((e) => e.day >= from && e.day <= through).sort((a, b) => a.day.localeCompare(b.day));
    });
  }
  writeJournal(day: string, body: string) {
    return this.call(() => {
      this.checkDay(day, 'day');
      this.text(body, 'body', 2000);
      if (day > this.today()) this.invalid('that day has not come yet', 'in_future');
      const now = this.nowIso();
      const existing = this.db.journal.find((e) => e.day === day);
      if (existing) { existing.body = body; existing.updatedAt = now; return existing; }
      const e: JournalEntry = { day, body, createdAt: now, updatedAt: now };
      this.db.journal.push(e);
      return e;
    });
  }
  deleteJournal(day: string) {
    return this.call(() => {
      this.checkDay(day, 'day');
      this.db.journal = this.db.journal.filter((e) => e.day !== day);
    });
  }

  // ---------- daily plans (the big task) ----------
  listDailyPlans(range: DayRange) {
    return this.call(() => {
      const { from, through } = this.checkRange(range);
      return this.db.dailyPlans.filter((p) => p.day >= from && p.day <= through).sort((a, b) => a.day.localeCompare(b.day));
    });
  }
  confirmDailyPlan(day: string, input: DailyPlanConfirm) {
    return this.call(() => {
      this.checkDay(day, 'day');
      this.checkId(input.itemId, 'itemId');
      if (input.proposedItemId !== undefined) this.checkId(input.proposedItemId, 'proposedItemId');
      if (Math.abs(daysBetween(this.today(), day)) > 1) {
        this.invalid('a big task is confirmed for yesterday, today or tomorrow', 'day_out_of_range');
      }
      const item = this.db.items.find((i) => i.id === input.itemId) ?? this.notFound('No such item.');
      if (item.status !== 'open') this.invalid('that item is already finished', 'item_not_open');
      // Brain's own rule, checked on write as the server does (0.11.0).
      if (!appearsInPlan(item)) this.invalid('ideas and notes are not planned; make it a task first', 'item_not_actionable');
      if (input.proposedItemId) {
        const proposed = this.db.items.find((i) => i.id === input.proposedItemId) ?? this.notFound('No such item.');
        if (!appearsInPlan(proposed)) this.invalid('Brain does not propose ideas or notes as the big task', 'item_not_actionable');
      }
      const existing = this.db.dailyPlans.find((p) => p.day === day);
      if (existing && existing.itemId === input.itemId && existing.proposedItemId === input.proposedItemId) return existing;
      const swapped = input.proposedItemId ? input.proposedItemId !== input.itemId : false;
      const plan: DailyPlan = {
        day, itemId: input.itemId, ...(input.proposedItemId ? { proposedItemId: input.proposedItemId } : {}),
        swapped, confirmedAt: this.nowIso(),
      };
      // A swap is a correction: the most valuable training signal there is.
      if (swapped && input.proposedItemId && existing?.itemId !== input.itemId) {
        this.db.corrections.push({
          id: ulid(), targetId: input.proposedItemId, field: 'bigTask', beforeValue: input.proposedItemId,
          afterValue: input.itemId, tier: 't0', createdAt: plan.confirmedAt,
        });
      }
      this.db.dailyPlans = [...this.db.dailyPlans.filter((p) => p.day !== day), plan];
      return plan;
    });
  }

  // ---------- review ----------
  getReview(range: DayRange) {
    return this.call((): Review => {
      const { from, through } = this.checkRange(range);
      const today = this.today();
      const done = this.completed(today);
      const byKey = new Map(this.db.occurrences.map((r) => [`${r.commitmentId}|${r.day}`, r]));
      const commitments: Review['commitments'] = [];
      // Deleted ones too: their history is the point of a review.
      for (const s of [...this.db.commitments].sort((a, b) => a.id.localeCompare(b.id))) {
        const expected = days(s, from, through);
        if (!expected.length) continue;
        const n = { done: 0, skipped: 0, moved: 0, missed: 0 };
        for (const d of expected) {
          const row = byKey.get(`${s.id}|${d}`);
          if (row?.state === 'done') n.done++;
          else if (row?.state === 'skipped') n.skipped++;
          else if (row?.state === 'moved') { if (row.movedTo && row.movedTo < today) n.missed++; else n.moved++; }
          else if (d < today) n.missed++;
        }
        const completed = done.get(s.id) ?? new Set<DayKey>();
        const rate = hitRate(s, completed, from, through);
        commitments.push({
          commitment: this.commitmentJson(s, done, today), expected: expected.length, ...n,
          ...(rate !== undefined ? { hitRate: rate } : {}),
          streak: s.archived ? 0 : streak(s, completed, today),
        });
      }
      const goals = this.db.goals
        .filter((g) => g.period && periodBounds(g.period).from <= through && periodBounds(g.period).through >= from)
        .map((g) => ({ goal: this.goalJson(g), children: this.db.goals.filter((c) => c.parentId === g.id).map((g) => this.goalJson(g)) }));
      const plans = this.db.dailyPlans.filter((p) => p.day >= from && p.day <= through);
      return {
        from, through, commitments, goals,
        journalEntries: this.db.journal.filter((e) => e.day >= from && e.day <= through).length,
        bigTasksConfirmed: plans.length,
        bigTasksSwapped: plans.filter((p) => p.swapped).length,
      };
    });
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
      this.checkId(input.from, 'from');
      this.checkId(input.to, 'to');
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

  // ---------- comments (M0007): the user's own notes, never read by Brain ----------
  /** Exactly one target, as `Validation.commentTarget`. */
  private commentTarget(t: Partial<{ itemId: string; goalId: string; commitmentId: string }>): CommentTarget {
    const named = [t.itemId, t.goalId, t.commitmentId].filter((x) => x !== undefined);
    if (named.length !== 1) this.invalid('name exactly one of itemId, goalId or commitmentId', 'one_target');
    if (t.itemId !== undefined) { this.checkId(t.itemId, 'itemId'); return { itemId: t.itemId }; }
    if (t.goalId !== undefined) { this.checkId(t.goalId, 'goalId'); return { goalId: t.goalId }; }
    this.checkId(t.commitmentId!, 'commitmentId');
    return { commitmentId: t.commitmentId! };
  }
  private onTarget(c: Comment, t: CommentTarget) {
    return 'itemId' in t ? c.itemId === t.itemId : 'goalId' in t ? c.goalId === t.goalId : c.commitmentId === t.commitmentId;
  }
  /** Oldest first. A target that doesn't exist simply has none. */
  listComments(target: CommentTarget) {
    return this.call(() => {
      const t = this.commentTarget(target);
      return this.db.comments.filter((c) => this.onTarget(c, t))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }
  createComment(input: NewComment) {
    return this.call(() => {
      this.checkId(input.id);
      const t = this.commentTarget(input);
      this.text(input.body, 'body', 2000);
      const existing = this.db.comments.find((c) => c.id === input.id);
      if (existing) return existing;
      const exists = 'itemId' in t ? this.db.items.some((i) => i.id === t.itemId)
        : 'goalId' in t ? this.db.goals.some((g) => g.id === t.goalId)
        : this.db.commitments.some((c) => c.id === t.commitmentId); // archived ones too
      if (!exists) this.notFound('No such item, goal or commitment.');
      const now = this.nowIso();
      const c: Comment = { id: input.id, ...t, body: input.body, createdAt: now, updatedAt: now };
      this.db.comments.push(c);
      return c;
    });
  }
  updateComment(id: string, u: CommentUpdate) {
    return this.call(() => {
      this.checkId(id);
      this.text(u.body, 'body', 2000);
      const c = this.db.comments.find((x) => x.id === id) ?? this.notFound('No such comment.');
      c.body = u.body;
      c.updatedAt = this.nowIso();
      return c;
    });
  }
  deleteComment(id: string) {
    return this.call(() => {
      this.checkId(id);
      if (!this.db.comments.some((x) => x.id === id)) this.notFound('No such comment.');
      this.db.comments = this.db.comments.filter((x) => x.id !== id);
    });
  }

  // ---------- count goals (M0007): circles, never money ----------
  private marksOf(goalId: string) {
    return this.db.marks.filter((m) => m.goalId === goalId)
      .sort((a, b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  listGoalMarks(goalId: string) {
    return this.call(() => {
      this.checkId(goalId);
      if (!this.db.goals.some((g) => g.id === goalId)) this.notFound('No such goal.');
      return this.marksOf(goalId);
    });
  }
  /** Fills one circle. Idempotent on id; filling the last one does not achieve the goal. */
  addGoalMark(goalId: string, input: NewGoalMark) {
    return this.call(() => {
      this.checkId(goalId);
      this.checkId(input.id, 'markId');
      if (input.day !== undefined) this.checkDay(input.day, 'day');
      if (input.note !== undefined) this.text(input.note, 'note', 500);
      const today = this.today();
      const day = input.day ?? today;
      if (daysBetween(today, day) > 0) this.invalid('a circle is filled on a day that has come', 'in_future');
      const goal = this.db.goals.find((g) => g.id === goalId) ?? this.notFound('No such goal.');
      const existing = this.db.marks.find((m) => m.id === input.id);
      if (existing) return existing;
      if (goal.targetCount === undefined) this.invalid('this goal has no target count, so no circles to fill', 'not_a_count_goal');
      if (this.marksOf(goalId).length >= goal.targetCount) throw new ApiError(409, 'target_reached', 'every circle is filled; raise the target to add more');
      const now = this.nowIso();
      const m: GoalMark = { id: input.id, goalId, day: day as DayKey, ...(input.note !== undefined ? { note: input.note } : {}), createdAt: now, updatedAt: now };
      this.db.marks.push(m);
      return m;
    });
  }
  updateGoalMark(goalId: string, markId: string, u: GoalMarkUpdate) {
    return this.call(() => {
      const clearNote = (u.clear ?? []).includes('note');
      if (clearNote && u.note !== undefined) this.invalid('a field is both sent and cleared', 'conflicting_clear');
      this.checkId(goalId);
      this.checkId(markId, 'markId');
      if (u.note !== undefined) this.text(u.note, 'note', 500);
      const m = this.db.marks.find((x) => x.id === markId && x.goalId === goalId) ?? this.notFound('No such circle.');
      if (u.note === undefined && !clearNote) return m;
      if (clearNote) delete m.note; else m.note = u.note!;
      m.updatedAt = this.nowIso();
      return m;
    });
  }
  deleteGoalMark(goalId: string, markId: string) {
    return this.call(() => {
      this.checkId(goalId);
      this.checkId(markId, 'markId');
      if (!this.db.marks.some((x) => x.id === markId && x.goalId === goalId)) this.notFound('No such circle.');
      this.db.marks = this.db.marks.filter((x) => x.id !== markId);
    });
  }

  // ---------- questions (T3) ----------
  /** Unanswered, newest first, at most 50. */
  listQuestions(): Promise<Question[]> {
    return this.call(() => this.db.questions
      .filter((q) => !q.answeredAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 50)
      .map(({ answeredAt: _a, answer: _b, ...q }) => q));
  }
  /**
   * Sets the item's field as the user's decision and records a `t3`
   * correction. The same option again changes nothing; a different one is
   * 409, because changing your mind is an item edit.
   */
  answerQuestion(id: string, answer: Answer) {
    return this.call(() => {
      this.checkId(id);
      this.text(answer.option, 'option', 100);
      const q = this.db.questions.find((x) => x.id === id) ?? this.notFound('No such question.');
      if (!q.options.includes(answer.option)) this.invalid('answer with one of the question\'s options', 'not_an_option');
      if (q.answer !== undefined) {
        if (q.answer !== answer.option) throw new ApiError(409, 'already_answered', 'already answered; edit the item to change it');
        return;
      }
      const it = this.db.items.find((i) => i.id === q.itemId)!;
      const now = this.nowIso();
      const before = it.type.value;
      it.type = { value: answer.option as Item['type']['value'] & string, confidence: 1, decidedBy: 'user' };
      it.updatedAt = now;
      this.db.corrections.push({ id: ulid(), targetId: it.id, field: q.field, beforeValue: before, afterValue: answer.option, tier: 't3', createdAt: now });
      q.answeredAt = now;
      q.answer = answer.option;
    });
  }
}


function canRollUp(child: Goal, parent: Goal): boolean {
  if (child.id === parent.id || !child.period || !parent.period) return false;
  const c = parsePeriod(child.period);
  const p = parsePeriod(parent.period);
  if (c?.horizon !== 'month' || p?.horizon !== 'quarter') return false;
  const pb = periodBounds(parent.period);
  const cb = periodBounds(child.period);
  return cb.from >= pb.from && cb.through <= pb.through;
}

function occurrenceJson(r: OccurrenceRow): Occurrence {
  return { commitmentId: r.commitmentId, day: r.day, state: r.state, ...(r.movedTo ? { movedTo: r.movedTo } : {}) };
}

export function emptyDb(tz: string): MockDb {
  return {
    version: 3, me: { userId: '7d9f3c1e-2b4a-4c6d-9e8f-0a1b2c3d4e5f', timezone: tz },
    captures: [], items: [], goals: [], edges: [], rejected: [], corrections: [],
    commitments: [], occurrences: [], journal: [], dailyPlans: [], questions: [], comments: [], marks: [],
  };
}
