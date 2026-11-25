import type {
  Answer, Capture, CapturePage, CaptureStatus, Commitment, CommitmentUpdate, DailyPlan, DailyPlanConfirm, Day,
  Edge, Goal, GoalUpdate, Item, ItemPage, ItemStatus, ItemUpdate, JournalEntry, Me, NewCapture, NewCommitment,
  NewEdge, NewGoal, Occurrence, Comment, CommentTarget, CommentUpdate, GoalMark, GoalMarkUpdate, NewComment, NewGoalMark, OccurrenceUpdate, Period, Plan, Question, Review, ULID,
} from './types';

/**
 * Everything the app can ask of Brain. Two implementations: `HttpBrainClient`
 * (the real server) and `MockBrainClient` (an in-browser fake). Screens only
 * ever see this interface, so switching is one config value.
 *
 * Nothing here ranks, scores or classifies. That is the server's job, always.
 */
export interface BrainClient {
  getMe(): Promise<Me>;
  updateMe(timezone: string): Promise<Me>;

  /** `created` is false when the id was already stored (a safe retry). */
  createCapture(input: NewCapture): Promise<{ capture: Capture; created: boolean }>;
  listCaptures(q?: PageQuery & { status?: CaptureStatus }): Promise<CapturePage>;
  getCapture(id: ULID): Promise<Capture>;

  listItems(q?: PageQuery & { status?: ItemStatus }): Promise<ItemPage>;
  getItem(id: ULID): Promise<Item>;
  updateItem(id: ULID, update: ItemUpdate): Promise<Item>;

  /** All goals, or only one month's (`2026-11`) or quarter's (`2026-Q4`). */
  listGoals(period?: Period): Promise<Goal[]>;
  createGoal(input: NewGoal): Promise<Goal>;
  updateGoal(id: ULID, update: GoalUpdate): Promise<Goal>;

  getPlan(): Promise<Plan>;

  // The planner (Brain docs/15-planner.md). Commitments are scheduled, never ranked.
  listCommitments(): Promise<Commitment[]>;
  createCommitment(input: NewCommitment): Promise<Commitment>;
  getCommitment(id: ULID): Promise<Commitment>;
  updateCommitment(id: ULID, update: CommitmentUpdate): Promise<Commitment>;
  deleteCommitment(id: ULID): Promise<void>;
  setOccurrence(id: ULID, day: Day, update: OccurrenceUpdate): Promise<Occurrence>;
  clearOccurrence(id: ULID, day: Day): Promise<void>;
  /** At most 92 days, `through` inclusive. */
  listOccurrences(range: DayRange): Promise<Occurrence[]>;

  listJournal(range: DayRange): Promise<JournalEntry[]>;
  writeJournal(day: Day, body: string): Promise<JournalEntry>;
  deleteJournal(day: Day): Promise<void>;

  listDailyPlans(range: DayRange): Promise<DailyPlan[]>;
  /** Send both ids: if they differ the server records the swap as a correction. */
  confirmDailyPlan(day: Day, input: DailyPlanConfirm): Promise<DailyPlan>;

  getReview(range: DayRange): Promise<Review>;

  listEdges(q?: { confirmed?: boolean }): Promise<Edge[]>;
  createEdge(input: NewEdge): Promise<Edge>;
  confirmEdge(id: ULID): Promise<Edge>;
  rejectEdge(id: ULID): Promise<void>;

  listQuestions(): Promise<Question[]>;
  answerQuestion(id: ULID, answer: Answer): Promise<void>;

  /** The user's own notes. Brain never reads them; never sent to a model. Oldest first. */
  listComments(target: CommentTarget): Promise<Comment[]>;
  /** Idempotent on `id`, so it can go through an outbox. */
  createComment(input: NewComment): Promise<Comment>;
  updateComment(id: ULID, update: CommentUpdate): Promise<Comment>;
  deleteComment(id: ULID): Promise<void>;

  /** A count goal's filled circles, oldest day first. */
  listGoalMarks(goalId: ULID): Promise<GoalMark[]>;
  /** Idempotent on `id`. Day defaults to the user's today. */
  addGoalMark(goalId: ULID, input: NewGoalMark): Promise<GoalMark>;
  updateGoalMark(goalId: ULID, markId: ULID, update: GoalMarkUpdate): Promise<GoalMark>;
  deleteGoalMark(goalId: ULID, markId: ULID): Promise<void>;
}

export interface DayRange {
  from: Day;
  /** Inclusive. */
  through: Day;
}

export interface PageQuery {
  after?: ULID;
  limit?: number;
}

/**
 * How a call failed, in the terms the UI acts on. From the spec:
 * 401 bad token → sign out. 503 / network → retry, never sign out.
 * 404 also means "not yours". 409 is a conflict such as a cycle.
 * 501 is an operation the server has not built yet.
 */
export type ApiErrorKind =
  | 'unauthorized'
  | 'unavailable'
  | 'notFound'
  | 'conflict'
  | 'invalid'
  | 'notImplemented'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.kind = kindFor(status, code);
  }

  /** Worth trying again later without the user changing anything. */
  get retryable(): boolean {
    return this.kind === 'unavailable' || this.kind === 'unknown';
  }
}

function kindFor(status: number, code: string): ApiErrorKind {
  if (status === 0) return 'unavailable';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  if (status === 501 || code === 'not_implemented') return 'notImplemented';
  if (status === 503 || status === 502 || status === 504 || status === 429) return 'unavailable';
  return 'unknown';
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Reads every page of a cursor-paginated list. */
export async function listAll<T>(
  fetchPage: (after: ULID | undefined) => Promise<{ rows: T[]; nextCursor?: ULID | undefined }>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let after: ULID | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(after);
    out.push(...page.rows);
    if (!page.nextCursor) break;
    after = page.nextCursor;
  }
  return out;
}
