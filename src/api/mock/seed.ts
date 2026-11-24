/**
 * MOCK SERVER ONLY. A starting account, with dates relative to "today" in
 * the user's zone so it never goes stale.
 *
 * Shaped like production, not like a demo: commitments are the brief's own
 * (Brain docs/15-planner.md), items look like real captures, and there are
 * **no goals** (only the user creates them). Items whose type Brain can't
 * read carry its question (T3); a few sizes and categories are model
 * guesses (`t2`, Brain 0.9.0), sizes at the low confidence they measure at.
 * The only suggested link is a `blocks` from an "after X" phrase.
 */
import { ulid } from 'ulid';
import type { Capture, Category, Edge, Effort, Item, ItemType, JournalEntry, Rule } from '../types';
import { typeQuestion } from './enrich';
import { addDaysToKey, dayKey, zonedToInstant, type DayKey } from '../../domain/time';
import { emptyDb, type MockDb, type OccurrenceRow, type StoredCommitment } from './mockClient';
import { days } from './recurrence';

export function seedDb(now: Date, tz: string): MockDb {
  let t = now.getTime() - 40 * 864e5;
  const nextId = () => ulid((t += 60_000));
  const at = () => new Date(t).toISOString();
  const today = dayKey(now, tz);
  const dueIn = (n: number, hour = 18) => {
    const [y, m, d] = addDaysToKey(today, n).split('-').map(Number);
    return zonedToInstant(y!, m!, d!, hour, 0, tz).toISOString();
  };
  const db = emptyDb(tz);

  // ---- commitments: the brief's, started five weeks ago ----
  const startOn = addDaysToKey(today, -35);
  const commit = (title: string, kind: StoredCommitment['kind'], rule: Rule, minutes: number, note?: string): StoredCommitment => {
    const c: StoredCommitment = {
      id: nextId(), title, kind, rule, minutes, startOn, paused: false, archived: false,
      createdAt: at(), updatedAt: at(), ...(note ? { note } : {}),
    };
    db.commitments.push(c);
    return c;
  };
  const daily: Rule = { kind: 'daily' };
  const habits = [
    commit('Read 10 pages', 'habit', daily, 20),
    commit('Ukulele', 'habit', daily, 20),
    commit('Brain game', 'habit', daily, 10),
    commit('Move body', 'habit', daily, 30),
    commit('Reel work', 'habit', daily, 45),
    commit('English video', 'habit', daily, 15),
    commit('3-line journal', 'habit', daily, 5),
  ];
  const office = commit('Office work', 'block', daily, 480);
  commit('Friday deep block', 'block', { kind: 'weeklyOn', weekday: 'friday' }, 180);
  commit('Weekly review', 'ritual', { kind: 'weeklyOn', weekday: 'sunday' }, 30);
  commit('Monthly review', 'ritual', { kind: 'monthlyOnNthWeekday', n: 1, weekday: 'saturday' }, 60);
  commit('Pay rent', 'payment', { kind: 'monthlyOnDay', day: 4 }, 5, '22k');
  commit('Loan EMI', 'payment', { kind: 'monthlyOnDay', day: 9 }, 5);

  // History: habits mostly done, never perfectly. Deterministic, so a reload looks the same.
  const occ: OccurrenceRow[] = [];
  habits.forEach((h, hi) => {
    for (const d of days(h, startOn, addDaysToKey(today, -1))) {
      const k = (d.charCodeAt(8) * 7 + d.charCodeAt(9) * 13 + hi * 5) % 10;
      if (k < 7) occ.push({ commitmentId: h.id, day: d, state: 'done', updatedAt: at() });
      else if (k === 7) occ.push({ commitmentId: h.id, day: d, state: 'skipped', updatedAt: at() });
    }
  });
  for (const d of days(office, startOn, addDaysToKey(today, -1))) occ.push({ commitmentId: office.id, day: d, state: 'done', updatedAt: at() });
  db.occurrences = occ;

  // ---- captured items, over the last few days ----
  t = now.getTime() - 4 * 864e5;
  // Brain 0.9.0 reads a size by rule (t0) only from a stated duration;
  // anything else is the model's guess (t2), at the confidence it measures at.
  const sized = (text: string, effort: Effort, by?: 't0' | 't2'): Item['effort'] => {
    const stated = /\d+\s*(min|mins|minutes|hours?|hrs?|ghante)\b/i.test(text);
    const tier = by ?? (stated ? 't0' : 't2');
    return { value: effort, confidence: tier === 't0' ? 0.95 : 0.39, decidedBy: tier };
  };
  const mk = (text: string, o: { type?: ItemType; effort?: Effort; due?: number; status?: Item['status']; title?: string; typeBy?: 't0' | 't2'; effortBy?: 't0' | 't2'; category?: Category; categoryBy?: 't0' | 't2' } = {}): Item => {
    t += 5 * 3600e3;
    const capture: Capture = { id: nextId(), text, source: 'text', status: 'enriched', capturedAt: at() };
    db.captures.push(capture);
    const item: Item = {
      id: nextId(), captureId: capture.id, title: o.title ?? text, status: o.status ?? 'open',
      type: o.type ? { value: o.type, confidence: 0.9, decidedBy: o.typeBy ?? 't0' } : { confidence: 0.3, decidedBy: 't0' },
      effort: o.effort ? sized(text, o.effort, o.effortBy) : { confidence: 0, decidedBy: 't0' },
      dueAt: o.due !== undefined ? { value: dueIn(o.due), confidence: 0.9, decidedBy: 't0' } : { confidence: 0, decidedBy: 't0' },
      goal: { confidence: 0, decidedBy: 't0' },
      category: o.category ? { value: o.category, confidence: o.categoryBy === 't2' ? 0.86 : 0.7, decidedBy: o.categoryBy ?? 't0' } : { confidence: 0, decidedBy: 't0' },
      createdAt: at(), updatedAt: at(),
    };
    db.items.push(item);
    // Brain asks when it can't tell the type (T3).
    if (!item.type.value && item.status === 'open') {
      db.questions.push({ id: nextId(), captureId: capture.id, itemId: item.id, ...typeQuestion(item.title), createdAt: at() });
    }
    return item;
  };

  const resume = mk('Update resume for iOS contract roles 2 hours', { type: 'task', effort: 'large', due: 3, title: 'Update resume for iOS contract roles' });
  const apply = mk('Apply to 5 iOS contract jobs after updating resume', { type: 'task', effort: 'medium', title: 'Apply to 5 iOS contract jobs' });
  mk('Call CA about advance tax kal', { type: 'task', effort: 'small', due: 1, title: 'Call CA about advance tax' });
  mk('Record reel: BFS vs DFS in 60 seconds', { type: 'task', effort: 'medium', due: 0 });
  mk('Reply to Swift Pune venue thread', { type: 'task', effort: 'tiny', due: 2 });
  mk('Book scooter service', { type: 'task', effort: 'small', category: 'errands' });
  mk('Write the Brain T&C data-use disclosure', { type: 'task', effort: 'large', category: 'deepWork', categoryBy: 't2' });
  mk('Fix the outbox retry toast copy 10 min', { type: 'task', effort: 'tiny', title: 'Fix the outbox retry toast copy' });
  mk('Plan the CoreLearnly DSA batch syllabus', { type: 'task', effort: 'xlarge', due: 10 });
  mk('Buy dog food', { type: 'task', effort: 'tiny', due: 0 });
  mk('Renew car insurance before 5th', { type: 'task', effort: 'small', due: 8 });
  mk('Pay society maintenance', { type: 'task', effort: 'tiny', status: 'done' });
  mk('idea: import my WhatsApp-to-self messages as captures', { type: 'idea', title: 'Import my WhatsApp-to-self messages as captures' });
  mk('Hummingbird 2 docs: routing and middleware', { type: 'link', typeBy: 't2' });
  mk('that pricing thing', { effort: 'medium' });
  mk('Shreya’s number for the venue');

  // The one suggestion the real pipeline makes: "after updating resume".
  const edge: Edge = { id: nextId(), from: resume.id, to: apply.id, kind: 'blocks', confidence: 0.8, suggestedBy: 't0Rule', confirmed: false };
  db.edges = [edge];

  // ---- a little history: journal and confirmed big tasks ----
  const journal = (n: number, body: string): JournalEntry => ({ day: addDaysToKey(today, -n), body, createdAt: at(), updatedAt: at() });
  db.journal = [
    journal(3, 'Shipped the outbox tests.\nSkipped ukulele, tired.\nGood call with Priya about the batch.'),
    journal(2, 'Slow start. Read 10 pages on the train.\nResume half done.\nNeed to sleep earlier.'),
    journal(1, 'Friday block went to the planner spec.\nMoved body: 30 min walk.\nGrateful for a quiet evening.'),
  ];
  const plan = (n: number, itemId: string, proposed: string): MockDb['dailyPlans'][number] => ({
    day: addDaysToKey(today, -n) as DayKey, itemId, proposedItemId: proposed, swapped: itemId !== proposed, confirmedAt: at(),
  });
  db.dailyPlans = [plan(2, resume.id, resume.id), plan(1, resume.id, apply.id)];

  return db;
}
