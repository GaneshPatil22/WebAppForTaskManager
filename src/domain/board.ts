import type { Effort, Item, RankedItem } from '../api/types';

/**
 * The 1-3-5 board (Brain backlog B-06a): one big thing, three medium,
 * five quick wins. A projection over the server's ranked list — a filter,
 * a bucket and a cap. It never computes a score. Order inside a bucket is
 * the server's order unless the user rearranged it on this device.
 *
 * Buckets are drawn against Brain's effort buckets rather than invented:
 * big = large/xlarge, medium = medium (and unknown, which Brain scores as
 * medium), quick = tiny/small. When a bucket has fewer candidates than
 * slots it is under-filled and says so, never padded.
 */
export type BucketId = 'big' | 'medium' | 'quick';

export const BUCKETS: { id: BucketId; n: number; name: string; hint: string; efforts: Effort[] }[] = [
  { id: 'big', n: 1, name: 'One big thing', hint: 'Half a day or more', efforts: ['large', 'xlarge'] },
  { id: 'medium', n: 3, name: 'Three medium tasks', hint: 'About an hour each', efforts: ['medium', 'unknown'] },
  { id: 'quick', n: 5, name: 'Five quick wins', hint: '20 minutes or less', efforts: ['tiny', 'small'] },
];

export function bucketOf(effort: Effort | undefined): BucketId {
  const e = effort ?? 'unknown';
  return BUCKETS.find((b) => b.efforts.includes(e))!.id;
}

export interface BoardRow {
  item: Item;
  /** Present for open items: the server's one-line reason. */
  ranked?: RankedItem;
  done: boolean;
}

export interface BoardGroup {
  id: BucketId;
  n: number;
  name: string;
  hint: string;
  slots: BoardRow[];
  overflow: BoardRow[];
}

export interface BoardInput {
  ranked: RankedItem[];
  blockedIds: ReadonlySet<string>;
  /** Items finished today: they keep their slot, struck through. */
  doneToday: Item[];
  notNow: ReadonlySet<string>;
  /** Manual order for today, if the user rearranged. */
  order: readonly string[];
}

export function buildBoard(input: BoardInput): BoardGroup[] {
  const pos = new Map(input.order.map((id, i) => [id, i]));
  const byOrder = (a: BoardRow, b: BoardRow) =>
    (pos.get(a.item.id) ?? Infinity) - (pos.get(b.item.id) ?? Infinity);

  return BUCKETS.map((b) => {
    const done: BoardRow[] = input.doneToday
      .filter((i) => bucketOf(i.effort.value) === b.id)
      .map((item) => ({ item, done: true }));
    const open: BoardRow[] = input.ranked
      .filter((r) => !input.blockedIds.has(r.item.id) && !input.notNow.has(r.item.id))
      .filter((r) => bucketOf(r.item.effort.value) === b.id)
      .map((r) => ({ item: r.item, ranked: r, done: false }));
    // Stable sort: server order survives wherever the user expressed none.
    const rows = [...done, ...open].sort(byOrder);
    return { id: b.id, n: b.n, name: b.name, hint: b.hint, slots: rows.slice(0, b.n), overflow: rows.slice(b.n) };
  });
}

/** Moves an id one step within its bucket's visible list, returning the new full order. */
export function reorder(groups: BoardGroup[], id: string, dir: -1 | 1): string[] {
  const lists = groups.map((g) => [...g.slots, ...g.overflow].map((r) => r.item.id));
  for (const l of lists) {
    const i = l.indexOf(id);
    const j = i + dir;
    if (i >= 0 && j >= 0 && j < l.length) [l[i], l[j]] = [l[j]!, l[i]!];
  }
  return lists.flat();
}
