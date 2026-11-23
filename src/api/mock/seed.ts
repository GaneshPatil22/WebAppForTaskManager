/**
 * MOCK SERVER ONLY. A starting graph adapted from the v1 prototype, with
 * dates relative to "today" in the user's zone so it never goes stale.
 */
import { ulid } from 'ulid';
import type { Capture, Edge, Goal, Item, ItemType, Effort, Question } from '../types';
import { addDaysToKey, dayKey, zonedToInstant } from '../../domain/time';
import type { MockDb } from './mockClient';

export function seedDb(now: Date, tz: string): MockDb {
  let t = now.getTime() - 10 * 864e5;
  const nextId = () => ulid((t += 60_000));
  const at = () => new Date(t).toISOString();
  const today = dayKey(now, tz);
  const dueIn = (days: number, hour = 18) => {
    const [y, m, d] = addDaysToKey(today, days).split('-').map(Number);
    return zonedToInstant(y!, m!, d!, hour, 0, tz).toISOString();
  };

  const goals: Goal[] = ['Brain', 'Career', 'Swift Pune', 'CoreLearnly', 'Home'].map((title) => ({
    id: nextId(), title, status: 'active', createdAt: at(),
  }));
  const goalId = (title: string) => goals.find((g) => g.title === title)!.id;

  const captures: Capture[] = [];
  const items: Item[] = [];
  const mk = (
    text: string,
    o: { type?: ItemType; effort?: Effort; due?: number; goal?: string; status?: Item['status']; title?: string; typeBy?: 't0' | 't2' },
  ): Item => {
    const capture: Capture = { id: nextId(), text, source: 'text', status: 'enriched', capturedAt: at() };
    captures.push(capture);
    const item: Item = {
      id: nextId(),
      captureId: capture.id,
      title: o.title ?? text,
      status: o.status ?? 'open',
      type: o.type ? { value: o.type, confidence: 0.9, decidedBy: o.typeBy ?? 't0' } : { confidence: 0.3, decidedBy: 't0' },
      effort: o.effort ? { value: o.effort, confidence: 0.9, decidedBy: 'user' } : { confidence: 0, decidedBy: 't0' },
      dueAt: o.due !== undefined ? { value: dueIn(o.due), confidence: 0.9, decidedBy: 't0' } : { confidence: 0, decidedBy: 't0' },
      goal: o.goal ? { value: goalId(o.goal), confidence: 1, decidedBy: 'user' } : { confidence: 0, decidedBy: 't0' },
      category: { confidence: 0, decidedBy: 't0' },
      createdAt: at(),
      updatedAt: at(),
    };
    items.push(item);
    return item;
  };

  const scoring = mk('Finish scoring: count what each task unblocks', { type: 'task', effort: 'medium', due: 1, goal: 'Brain' });
  const callMgr = mk('Call manager about the raise', { type: 'task', effort: 'small', due: 3, goal: 'Career' });
  const schema = mk('Draft the eval dataset schema (JSONL)', { type: 'task', effort: 'medium', due: 1, goal: 'Brain' });
  const reel = mk('Record a reel on BFS vs DFS', { type: 'task', effort: 'medium', due: 0, goal: 'CoreLearnly' });
  const venue = mk('Reply to the Swift Pune venue thread', { type: 'task', effort: 'tiny', due: 2, goal: 'Swift Pune' });
  mk('Book the scooter test ride', { type: 'task', effort: 'small', goal: 'Home' });
  mk('Pay society maintenance', { type: 'task', effort: 'tiny', due: 0, goal: 'Home', status: 'done' });
  const pooler = mk('Compare Supabase pooler modes with PostgresNIO', { type: 'task', effort: 'small', due: 2, goal: 'Brain' });
  const outline = mk('Outline the Swift Pune college session', { type: 'task', effort: 'medium', due: 6, goal: 'Swift Pune' });
  const gate = mk('Run the Brain B1 gate review', { type: 'task', effort: 'medium', due: 7, goal: 'Brain' });
  mk('Sort the DSA batch fee sheet', { type: 'task', effort: 'small', goal: 'CoreLearnly' });
  const tnc = mk('Write the T&C data-use disclosure', { type: 'task', effort: 'large', goal: 'Brain' });
  mk('Buy dog food', { type: 'task', effort: 'tiny' });
  mk('idea: import my WhatsApp-to-self messages as captures', { type: 'idea', title: 'Import my WhatsApp-to-self messages as captures' });
  mk('Hummingbird 2 docs: routing and middleware', { type: 'link', typeBy: 't2' });
  const vague = mk('that pricing thing', {});
  const dup = mk('kal manager ko call karna hai about raise', { type: 'task', effort: 'small', due: 1 });

  const edge = (from: Item, to: Item, kind: Edge['kind'], confirmed: boolean, confidence = 1): Edge => ({
    id: nextId(), from: from.id, to: to.id, kind, confidence,
    suggestedBy: confirmed ? 'user' : 't0Rule', confirmed,
  });
  const edges: Edge[] = [
    edge(pooler, scoring, 'blocks', true),
    edge(scoring, tnc, 'blocks', true),
    edge(schema, gate, 'blocks', true),
    edge(venue, outline, 'blocks', true),
    edge(dup, callMgr, 'duplicate', false, 0.86),
    edge(schema, scoring, 'blocks', false, 0.72),
    edge(reel, outline, 'relates', false, 0.55),
  ];

  const questions: Question[] = [{
    id: nextId(), captureId: vague.captureId!, itemId: vague.id, field: 'type',
    prompt: `What is “${vague.title}”?`, options: ['task', 'idea', 'note', 'reminder', 'link'],
  }];

  return { version: 1, me: { userId: '7d9f3c1e-2b4a-4c6d-9e8f-0a1b2c3d4e5f', timezone: tz }, captures, items, goals, edges, rejected: [], questions, corrections: [] };
}
