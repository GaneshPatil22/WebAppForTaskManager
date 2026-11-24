/**
 * Friendly names for the generated contract types. `schema.gen.ts` is
 * generated from ../Server/Sources/API/openapi.yaml (`make api`) and is the
 * only source of these shapes. Never hand-edit it.
 */
import type { components } from './schema.gen';

type S = components['schemas'];

export type ULID = S['ULID'];
export type Problem = S['Problem'];
export type DecidedBy = S['DecidedBy'];
export type Span = S['Span'];
export type Me = S['Me'];
export type CaptureSource = S['CaptureSource'];
export type CaptureStatus = S['CaptureStatus'];
export type NewCapture = S['NewCapture'];
export type Capture = S['Capture'];
export type CapturePage = S['CapturePage'];
export type ItemType = S['ItemType'];
export type ItemStatus = S['ItemStatus'];
export type Effort = S['Effort'];
export type Category = S['Category'];
export type Item = S['Item'];
export type ItemUpdate = S['ItemUpdate'];
export type ItemPage = S['ItemPage'];
export type GoalStatus = S['GoalStatus'];
export type NewGoal = S['NewGoal'];
export type GoalUpdate = S['GoalUpdate'];
export type Goal = S['Goal'];
export type EdgeKind = S['EdgeKind'];
export type EdgeSuggestedBy = S['EdgeSuggestedBy'];
export type NewEdge = S['NewEdge'];
export type Edge = S['Edge'];
export type Why = S['Why'];
export type RankedItem = S['RankedItem'];
export type BlockedItem = S['BlockedItem'];
export type Plan = S['Plan'];
export type Question = S['Question'];
export type Day = S['Day'];
export type Period = S['Period'];
export type ScheduledCommitment = S['ScheduledCommitment'];
export type CommitmentKind = S['CommitmentKind'];
export type Weekday = S['Weekday'];
export type Rule = S['Rule'];
export type RuleKind = Rule['kind'];
export type NewCommitment = S['NewCommitment'];
export type CommitmentUpdate = S['CommitmentUpdate'];
export type Commitment = S['Commitment'];
export type OccurrenceState = S['OccurrenceState'];
export type OccurrenceUpdate = S['OccurrenceUpdate'];
export type Occurrence = S['Occurrence'];
export type JournalEntry = S['JournalEntry'];
export type DailyPlanConfirm = S['DailyPlanConfirm'];
export type DailyPlan = S['DailyPlan'];
export type CommitmentReview = S['CommitmentReview'];
export type GoalReview = S['GoalReview'];
export type Review = S['Review'];
export type Answer = S['Answer'];

export const ITEM_TYPES: readonly ItemType[] = ['task', 'idea', 'note', 'reminder', 'link'];
export const ITEM_STATUSES: readonly ItemStatus[] = ['open', 'done', 'dropped'];
export const EFFORTS: readonly Effort[] = ['tiny', 'small', 'medium', 'large', 'xlarge', 'unknown'];
export const CATEGORIES: readonly Category[] = [
  'paperwork', 'errands', 'communication', 'planning', 'deepWork', 'chores', 'money', 'learning', 'health',
];
export const GOAL_STATUSES: readonly GoalStatus[] = ['active', 'achieved', 'abandoned'];
export const COMMITMENT_KINDS: readonly CommitmentKind[] = ['habit', 'ritual', 'payment', 'block'];
export const WEEKDAYS: readonly Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const RULE_KINDS: readonly RuleKind[] = ['daily', 'weeklyOn', 'monthlyOnDay', 'monthlyOnNthWeekday', 'quarterlyOnNthWeekday'];
export const EDGE_KINDS: readonly EdgeKind[] = ['blocks', 'relates', 'duplicate', 'serves'];

/** Matches the spec's ULID pattern. Uppercase only: the server refuses lowercase. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
