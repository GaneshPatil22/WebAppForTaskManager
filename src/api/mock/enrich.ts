/**
 * MOCK SERVER ONLY. A handful of toy rules so captures typed into the mock
 * turn into items. Brain's real T0 rules (Hinglish dates, effort, explicit
 * dependencies, category lexicon) are far richer; this exists so the UI has
 * something realistic to show, including abstentions and questions.
 */
import type { Category, Effort, Item, ItemType, Span } from '../types';
import { dayKey, addDaysToKey, zonedToInstant, dayOfMonthOfKey, weekdayOfKey } from '../../domain/time';

export interface Extracted {
  title: string;
  type: { value?: ItemType; confidence: number; evidence?: Span };
  effort: { value?: Effort; confidence: number; evidence?: Span };
  dueAt: { value?: string; confidence: number; evidence?: Span };
  category: { value?: Category; confidence: number };
  /** Text after "after …", "… ke baad", "once … is done", "waiting for …". */
  dependsOn?: string;
}

const VERBS = new Set([
  'call', 'buy', 'pay', 'book', 'send', 'reply', 'finish', 'fix', 'write', 'draft', 'review', 'read', 'plan',
  'file', 'email', 'clean', 'order', 'renew', 'submit', 'ship', 'record', 'outline', 'compare', 'run', 'sort',
  'prepare', 'update', 'check', 'start', 'build', 'test', 'deploy', 'schedule', 'cancel', 'return', 'collect',
  'apply', 'learn', 'practice', 'meet', 'message', 'text', 'ask', 'tell', 'share', 'post', 'publish', 'refactor',
]);

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['money', /\b(pay|sip|rent|invoice|bill|bank|tax|gst|salary|fee|emi)\b/i],
  ['communication', /\b(call|reply|email|message|text|whatsapp|ask|tell|meet)\b/i],
  ['paperwork', /\b(file|form|submit|renew|passport|aadhaar|pan|document|kyc)\b/i],
  ['errands', /\b(buy|order|pick up|collect|return|grocer|shop)\b/i],
  ['chores', /\b(clean|laundry|fix|repair|wash|cook|kitchen)\b/i],
  ['learning', /\b(read|learn|course|study|practice|docs|tutorial)\b/i],
  ['planning', /\b(plan|book|schedule|outline|organi[sz]e|trip)\b/i],
  ['deepWork', /\b(write|draft|build|design|refactor|finish|implement|record)\b/i],
  ['health', /\b(doctor|dentist|medicine|checkup|sleep)\b/i],
];

function span(text: string, re: RegExp): Span | undefined {
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : undefined;
}

function effortFromMinutes(min: number): Effort {
  if (min <= 10) return 'tiny';
  if (min <= 35) return 'small';
  if (min <= 120) return 'medium';
  if (min <= 480) return 'large';
  return 'xlarge';
}

export function extract(raw: string, now: Date, tz: string): Extracted {
  const text = raw.trim();
  const lower = text.toLowerCase();

  // ---- type ----
  let type: Extracted['type'] = { confidence: 0.3 };
  const firstWord = /^[a-z]+/.exec(lower.replace(/^(todo|task)\s*:\s*/, ''))?.[0] ?? '';
  const timeAnchor = /\b(\d{1,2})\s*(baje|am|pm)\b|\bat \d{1,2}(:\d{2})?\b/i;
  if (/^https?:\/\/\S+$/.test(text)) type = { value: 'link', confidence: 0.98, evidence: { start: 0, end: text.length } };
  else if (/^(idea\s*:|what if\b|kya agar\b)/i.test(text)) type = { value: 'idea', confidence: 0.95, evidence: span(text, /^(idea\s*:|what if|kya agar)/i) };
  else if (/^note\s*:/i.test(text)) type = { value: 'note', confidence: 0.95, evidence: span(text, /^note\s*:/i) };
  else if (/https?:\/\//.test(text) && /\bdocs?\b|\bread\b/i.test(text)) type = { value: 'link', confidence: 0.7, evidence: span(text, /https?:\/\/\S+/) };
  else if (VERBS.has(firstWord) || /\bkarna hai\b|\bkarni hai\b|\bkarne hai\b/i.test(text)) {
    const anchored = timeAnchor.test(text);
    type = anchored
      ? { value: 'reminder', confidence: 0.85, evidence: span(text, timeAnchor) }
      : { value: 'task', confidence: 0.9, evidence: span(text, VERBS.has(firstWord) ? new RegExp(`\\b${firstWord}\\b`, 'i') : /\bkar(na|ni|ne) hai\b/i) };
  }

  // ---- effort ----
  let effort: Extracted['effort'] = { confidence: 0 };
  const mins = /(\d{1,3})\s*(min|mins|minutes)\b/i.exec(text);
  const hrs = /(\d{1,2})\s*(ghante|ghanta|hours?|hrs?)\b/i.exec(text);
  if (mins) effort = { value: effortFromMinutes(+mins[1]!), confidence: 0.95, evidence: { start: mins.index, end: mins.index + mins[0].length } };
  else if (hrs) effort = { value: effortFromMinutes(+hrs[1]! * 60), confidence: 0.95, evidence: { start: hrs.index, end: hrs.index + hrs[0].length } };
  else if (/\bjaldi\b|\bquick(ly)?\b/i.test(text)) effort = { value: 'tiny', confidence: 0.7, evidence: span(text, /\bjaldi\b|\bquick(ly)?\b/i) };

  // ---- due ----
  let dueAt: Extracted['dueAt'] = { confidence: 0 };
  const today = dayKey(now, tz);
  let day: string | undefined;
  let ev: Span | undefined;
  const rules: [RegExp, () => string][] = [
    [/\b(aaj|today)\b/i, () => today],
    [/\b(kal|tomorrow)\b/i, () => addDaysToKey(today, 1)],
    [/\b(parso|day after tomorrow)\b/i, () => addDaysToKey(today, 2)],
    [/\b(agle hafte|next week)\b/i, () => addDaysToKey(today, ((8 - weekdayOfKey(today)) % 7) || 7)],
  ];
  for (const [re, f] of rules) {
    const s = span(text, re);
    if (s) { day = f(); ev = s; break; }
  }
  const nth = /\b(\d{1,2})\s*(tarikh|tareek)\b|\b(?:on the |before (?:the )?)?(\d{1,2})(st|nd|rd|th)\b/i.exec(text);
  if (!day && nth) {
    const d = +(nth[1] ?? nth[3]!);
    if (d >= 1 && d <= 31) {
      const cur = dayOfMonthOfKey(today);
      let k = today.slice(0, 8) + String(d).padStart(2, '0');
      if (d < cur) {
        const [y, m] = today.split('-').map(Number);
        const ny = m === 12 ? y! + 1 : y!;
        const nm = m === 12 ? 1 : m! + 1;
        k = `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      day = k;
      ev = { start: nth.index, end: nth.index + nth[0].length };
    }
  }
  if (day) {
    let hour = 18;
    const t = /\b(\d{1,2})\s*(baje|am|pm)\b/i.exec(text);
    if (t) {
      hour = +t[1]! % 12;
      if (t[2]!.toLowerCase() === 'pm' || (t[2]!.toLowerCase() === 'baje' && hour < 7)) hour += 12;
    } else if (/\bsubah\b|\bmorning\b/i.test(text)) hour = 9;
    else if (/\bshaam\b|\bevening\b/i.test(text)) hour = 18;
    const [y, m, d] = day.split('-').map(Number);
    dueAt = { value: zonedToInstant(y!, m!, d!, hour, 0, tz).toISOString(), confidence: 0.9, ...(ev ? { evidence: ev } : {}) };
  }

  // ---- category ----
  let category: Extracted['category'] = { confidence: 0 };
  for (const [c, re] of CATEGORY_WORDS) if (re.test(text)) { category = { value: c, confidence: 0.7 }; break; }

  // ---- explicit dependency ----
  const dep = /\bafter (.+?)(?:,|$)|^(.+?) ke baad\b|\bonce (.+?) is done\b|\bwaiting for (.+?)(?:,|$)|\bblocked by (.+?)(?:,|$)/i.exec(text);
  const dependsOn = dep ? (dep[1] ?? dep[2] ?? dep[3] ?? dep[4] ?? dep[5])?.trim() : undefined;

  const title = text.replace(/^(idea|note|todo|task)\s*:\s*/i, '');
  return {
    title: (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 500),
    type, effort, dueAt, category,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'for', 'on', 'in', 'ko', 'hai', 'karna', 'ka', 'ki', 'ke', 'about', 'with', 're']);
export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t)));
}
export function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** The open item whose title best matches some text, if the match is decent. */
export function bestMatch(text: string, items: Item[], exclude: string): Item | undefined {
  let best: Item | undefined;
  let bestScore = 0.25;
  for (const i of items) {
    if (i.id === exclude || i.status !== 'open') continue;
    const s = jaccard(text, i.title);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best;
}
