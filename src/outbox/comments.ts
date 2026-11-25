import { ulid } from 'ulid';
import { isApiError } from '../api/client';
import type { Comment, CommentTarget } from '../api/types';
import { Outbox } from './outbox';
import type { QueuedEntry } from './store';

/** A comment waiting to be sent. The server is idempotent on its id. */
export interface CommentEntry extends QueuedEntry {
  target: CommentTarget;
  body: string;
  createdAt: string;
}

export const MAX_COMMENT_CHARS = 2000;

/**
 * New comments go through an outbox like captures: written on the device
 * first, so a note typed on a train is not lost. Edits and deletes are plain
 * requests; they change something the server already has.
 */
export class CommentOutbox extends Outbox<CommentEntry, Comment> {
  async enqueue(target: CommentTarget, body: string): Promise<CommentEntry> {
    const t = this.now();
    return this.add({ id: ulid(t), target, body, createdAt: new Date(t).toISOString(), attempts: 0, nextAttemptAt: t, state: 'pending' });
  }

  protected send(e: CommentEntry): Promise<Comment> {
    return this.client.createComment({ id: e.id, ...e.target, body: e.body });
  }

  /** The thing it was on is gone (404): no retry brings it back. */
  protected override refused(err: unknown): boolean {
    return super.refused(err) || (isApiError(err) && err.kind === 'notFound');
  }
}

/** Whether an entry belongs on this thread. */
export function sameTarget(a: CommentTarget, b: CommentTarget): boolean {
  if ('itemId' in a) return 'itemId' in b && a.itemId === b.itemId;
  if ('goalId' in a) return 'goalId' in b && a.goalId === b.goalId;
  return 'commitmentId' in b && a.commitmentId === b.commitmentId;
}
