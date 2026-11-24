import createClient from 'openapi-fetch';
import type { paths } from './schema.gen';
import { ApiError, type BrainClient, type DayRange } from './client';
import type { Problem } from './types';

/** Returns the current access token, or null when signed out. */
export type TokenSource = () => Promise<string | null>;

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * The real server, through `openapi-fetch` and the generated `paths`. A
 * spec change that breaks a call fails `make typecheck`, not production.
 */
export class HttpBrainClient implements BrainClient {
  private readonly api;

  constructor(baseUrl: string, token: TokenSource, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {
    this.api = createClient<paths>({ baseUrl, fetch: fetchImpl });
    this.api.use({
      async onRequest({ request }) {
        const t = await token();
        if (t) request.headers.set('Authorization', `Bearer ${t}`);
        return request;
      },
    });
  }

  private async run<T>(call: () => Promise<Result<T>>): Promise<{ data: T; status: number }> {
    let res: Result<T>;
    try {
      res = await call();
    } catch (e) {
      // fetch throws only for network failure: the server never answered.
      throw new ApiError(0, 'network', e instanceof Error ? e.message : 'Network error');
    }
    const { response } = res;
    if (!response.ok) {
      const p = (res.error ?? {}) as Partial<Problem>;
      throw new ApiError(response.status, p.code ?? `http_${response.status}`, p.message ?? response.statusText);
    }
    return { data: res.data as T, status: response.status };
  }

  async getMe() {
    return (await this.run(() => this.api.GET('/v1/me'))).data;
  }
  async updateMe(timezone: string) {
    return (await this.run(() => this.api.PATCH('/v1/me', { body: { timezone } }))).data;
  }

  async createCapture(input: Parameters<BrainClient['createCapture']>[0]) {
    const r = await this.run(() => this.api.POST('/v1/captures', { body: input }));
    return { capture: r.data, created: r.status === 201 };
  }
  async listCaptures(q: Parameters<BrainClient['listCaptures']>[0] = {}) {
    return (await this.run(() => this.api.GET('/v1/captures', { params: { query: q } }))).data;
  }
  async getCapture(id: string) {
    return (await this.run(() => this.api.GET('/v1/captures/{id}', { params: { path: { id } } }))).data;
  }

  async listItems(q: Parameters<BrainClient['listItems']>[0] = {}) {
    return (await this.run(() => this.api.GET('/v1/items', { params: { query: q } }))).data;
  }
  async getItem(id: string) {
    return (await this.run(() => this.api.GET('/v1/items/{id}', { params: { path: { id } } }))).data;
  }
  async updateItem(id: string, update: Parameters<BrainClient['updateItem']>[1]) {
    return (await this.run(() => this.api.PATCH('/v1/items/{id}', { params: { path: { id } }, body: update }))).data;
  }

  async listGoals(period?: string) {
    return (await this.run(() => this.api.GET('/v1/goals', { params: { query: period ? { period } : {} } }))).data.goals;
  }
  async createGoal(input: Parameters<BrainClient['createGoal']>[0]) {
    return (await this.run(() => this.api.POST('/v1/goals', { body: input }))).data;
  }
  async updateGoal(id: string, update: Parameters<BrainClient['updateGoal']>[1]) {
    return (await this.run(() => this.api.PATCH('/v1/goals/{id}', { params: { path: { id } }, body: update }))).data;
  }

  async getPlan() {
    return (await this.run(() => this.api.GET('/v1/plan'))).data;
  }

  async listCommitments() {
    return (await this.run(() => this.api.GET('/v1/commitments'))).data.commitments;
  }
  async createCommitment(input: Parameters<BrainClient['createCommitment']>[0]) {
    return (await this.run(() => this.api.POST('/v1/commitments', { body: input }))).data;
  }
  async getCommitment(id: string) {
    return (await this.run(() => this.api.GET('/v1/commitments/{id}', { params: { path: { id } } }))).data;
  }
  async updateCommitment(id: string, update: Parameters<BrainClient['updateCommitment']>[1]) {
    return (await this.run(() => this.api.PATCH('/v1/commitments/{id}', { params: { path: { id } }, body: update }))).data;
  }
  async deleteCommitment(id: string) {
    await this.run(() => this.api.DELETE('/v1/commitments/{id}', { params: { path: { id } } }));
  }
  async setOccurrence(id: string, day: string, update: Parameters<BrainClient['setOccurrence']>[2]) {
    return (await this.run(() => this.api.PUT('/v1/commitments/{id}/occurrences/{day}', { params: { path: { id, day } }, body: update }))).data;
  }
  async clearOccurrence(id: string, day: string) {
    await this.run(() => this.api.DELETE('/v1/commitments/{id}/occurrences/{day}', { params: { path: { id, day } } }));
  }
  async listOccurrences(range: DayRange) {
    return (await this.run(() => this.api.GET('/v1/occurrences', { params: { query: range } }))).data.occurrences;
  }

  async listJournal(range: DayRange) {
    return (await this.run(() => this.api.GET('/v1/journal', { params: { query: range } }))).data.entries;
  }
  async writeJournal(day: string, body: string) {
    return (await this.run(() => this.api.PUT('/v1/journal/{day}', { params: { path: { day } }, body: { body } }))).data;
  }
  async deleteJournal(day: string) {
    await this.run(() => this.api.DELETE('/v1/journal/{day}', { params: { path: { day } } }));
  }

  async listDailyPlans(range: DayRange) {
    return (await this.run(() => this.api.GET('/v1/daily-plans', { params: { query: range } }))).data.plans;
  }
  async confirmDailyPlan(day: string, input: Parameters<BrainClient['confirmDailyPlan']>[1]) {
    return (await this.run(() => this.api.PUT('/v1/daily-plans/{day}', { params: { path: { day } }, body: input }))).data;
  }

  async getReview(range: DayRange) {
    return (await this.run(() => this.api.GET('/v1/review', { params: { query: range } }))).data;
  }

  async listEdges(q: { confirmed?: boolean } = {}) {
    return (await this.run(() => this.api.GET('/v1/edges', { params: { query: q } }))).data.edges;
  }
  async createEdge(input: Parameters<BrainClient['createEdge']>[0]) {
    return (await this.run(() => this.api.POST('/v1/edges', { body: input }))).data;
  }
  async confirmEdge(id: string) {
    return (await this.run(() => this.api.POST('/v1/edges/{id}/confirm', { params: { path: { id } } }))).data;
  }
  async rejectEdge(id: string) {
    await this.run(() => this.api.POST('/v1/edges/{id}/reject', { params: { path: { id } } }));
  }

  async listQuestions() {
    return (await this.run(() => this.api.GET('/v1/questions'))).data.questions;
  }
  async answerQuestion(id: string, answer: Parameters<BrainClient['answerQuestion']>[1]) {
    await this.run(() => this.api.POST('/v1/questions/{id}/answer', { params: { path: { id } }, body: answer }));
  }
}
