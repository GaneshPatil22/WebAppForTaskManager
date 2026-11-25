import { describe, expect, it, vi } from 'vitest';
import { CommentOutbox } from './comments';
import { MemoryOutboxStore } from './store';
import { ApiError, type BrainClient } from '../api/client';

const manual = () => ({ now: () => 1_000_000, random: () => 0.5, schedule: () => 1, cancel: () => {} });

describe('CommentOutbox', () => {
  it('stores first, sends with the same id, then forgets', async () => {
    const createComment = vi.fn(async (c: { id: string; body: string; goalId?: string }) => ({ ...c, createdAt: '', updatedAt: '' }));
    const box = new CommentOutbox(new MemoryOutboxStore(), { createComment } as unknown as BrainClient, manual());
    const stored = vi.fn();
    box.onStored(stored);
    const e = await box.enqueue({ goalId: 'G' }, 'first note');
    await box.flush();
    expect(createComment).toHaveBeenCalledWith({ id: e.id, goalId: 'G', body: 'first note' });
    expect(box.snapshot()).toEqual([]);
    expect(stored).toHaveBeenCalledWith(expect.objectContaining({ id: e.id }));
  });

  it('keeps it through an outage, and keeps a refused one for the user', async () => {
    const script: unknown[] = [new ApiError(503, 'x', 'down'), new ApiError(404, 'not_found', 'gone')];
    const createComment = vi.fn(async () => { throw script.shift(); });
    const box = new CommentOutbox(new MemoryOutboxStore(), { createComment } as unknown as BrainClient, manual());
    await box.enqueue({ itemId: 'I' }, 'x');
    await box.flush();
    expect(box.snapshot()[0]).toMatchObject({ state: 'pending', attempts: 1 });
    await box.flush(true);
    expect(box.snapshot()[0]).toMatchObject({ state: 'rejected', attempts: 2 });
  });
});
