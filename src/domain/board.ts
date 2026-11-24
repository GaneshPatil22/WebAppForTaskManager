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
 *
 * The user can move an item to another bucket for the day. That is a view
 * choice kept on the device: it does not change the item's effort, which
 * would be a correction sent to Brain.
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
  /** Buckets the user moved items into today, by item id. */
  moved?: Readonly<Record<string, BucketId>>;
}

export function buildBoard(input: BoardInput): BoardGroup[] {
  const pos = new Map(input.order.map((id, i) => [id, i]));
  const byOrder = (a: BoardRow, b: BoardRow) =>
    (pos.get(a.item.id) ?? Infinity) - (pos.get(b.item.id) ?? Infinity);

  const bucket = (i: Item) => input.moved?.[i.id] ?? bucketOf(i.effort.value);

  return BUCKETS.map((b) => {
    const done: BoardRow[] = input.doneToday
      .filter((i) => bucket(i) === b.id)
      .map((item) => ({ item, done: true }));
    const open: BoardRow[] = input.ranked
      .filter((r) => !input.blockedIds.has(r.item.id) && !input.notNow.has(r.item.id))
      .filter((r) => bucket(r.item) === b.id)
      .map((r) => ({ item: r.item, ranked: r, done: false }));
    // Stable sort: server order survives wherever the user expressed none.
    const rows = [...done, ...open].sort(byOrder);
    return { id: b.id, n: b.n, name: b.name, hint: b.hint, slots: rows.slice(0, b.n), overflow: rows.slice(b.n) };
  });
}

export interface Move {
  /** The new full order across the board. */
  order: string[];
  /** Set when the item changed bucket. */
  to?: BucketId;
}

/**
 * Moves an item one step. Inside a bucket it swaps with its neighbour. From
 * the top of a bucket it goes to the bottom of the bucket above; from the
 * bottom, to the top of the bucket below. Returns null at the board's ends.
 */
export function moveStep(groups: BoardGroup[], id: string, dir: -1 | 1): Move | null {
  const lists = groups.map((g) => [...g.slots, ...g.overflow].map((r) => r.item.id));
  const gi = lists.findIndex((l) => l.includes(id));
  if (gi < 0) return null;
  const l = lists[gi]!;
  const i = l.indexOf(id);
  const j = i + dir;
  if (j >= 0 && j < l.length) {
    [l[i], l[j]] = [l[j]!, l[i]!];
    return { order: lists.flat() };
  }
  const gj = gi + dir;
  if (gj < 0 || gj >= lists.length) return null;
  l.splice(i, 1);
  if (dir < 0) lists[gj]!.push(id); else lists[gj]!.unshift(id);
  return { order: lists.flat(), to: groups[gj]!.id };
}

/** Moves an item straight to the end of another bucket's list. */
export function moveTo(groups: BoardGroup[], id: string, to: BucketId): Move {
  const lists = groups.map((g) => [...g.slots, ...g.overflow].map((r) => r.item.id).filter((x) => x !== id));
  const gj = groups.findIndex((g) => g.id === to);
  // Into the first free slot if there is one, otherwise first in line behind the full slots.
  lists[gj]!.splice(Math.min(lists[gj]!.length, groups[gj]!.n), 0, id);
  return { order: lists.flat(), to };
}
