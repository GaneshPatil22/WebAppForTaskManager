import type {
  Answer, Capture, CapturePage, CaptureStatus, Edge, Goal, GoalUpdate, Item, ItemPage, ItemStatus,
  ItemUpdate, Me, NewCapture, NewEdge, NewGoal, Plan, Question, ULID,
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

  listGoals(): Promise<Goal[]>;
  createGoal(input: NewGoal): Promise<Goal>;
  updateGoal(id: ULID, update: GoalUpdate): Promise<Goal>;

  getPlan(): Promise<Plan>;

  listEdges(q?: { confirmed?: boolean }): Promise<Edge[]>;
  createEdge(input: NewEdge): Promise<Edge>;
  confirmEdge(id: ULID): Promise<Edge>;
  rejectEdge(id: ULID): Promise<void>;

  listQuestions(): Promise<Question[]>;
  answerQuestion(id: ULID, answer: Answer): Promise<void>;
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
