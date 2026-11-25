import { useState, type FormEvent } from 'react';
import type { Goal, GoalMark } from '../../api/types';
import { useAddGoalMark, useDeleteGoalMark, useGoalMarks, useToday, useUpdateGoal, useUpdateGoalMark } from '../../api/queries';
import { isApiError } from '../../api/client';
import { Dialog } from '../../ui/Dialog';
import { errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { targetReachedText } from '../../domain/errors';
import { shortDay, type DayKey } from '../../domain/time';
import styles from './circles.module.css';

/** Past this many, circles stop being readable; a bar says the same thing. */
const MAX_DRAWN = 40;

/** "2 of 6 · Q4 2026". A count of things: no units, no currency, no totals. */
export function countText(goal: Goal): string | null {
  if (goal.targetCount === undefined) return null;
  return `${goal.doneCount ?? 0} of ${goal.targetCount}${goal.periodText ? ` · ${goal.periodText}` : ''}`;
}

/**
 * A count goal's circles: `targetCount` of them, `doneCount` filled, in the
 * order they were filled (oldest day first). Tap an empty one to fill it
 * (today by default, or an earlier day, with an optional note); tap a filled
 * one to see or change its note, or empty it. Filling the last circle does
 * not achieve the goal: that is offered as its own tap.
 */
export function Circles({ goal }: { goal: Goal }) {
  const target = goal.targetCount;
  const done = goal.doneCount ?? 0;
  const marks = useGoalMarks(goal.id, target !== undefined && done > 0);
  const update = useUpdateGoal();
  const toast = useToast();
  const [open, setOpen] = useState<{ mark?: GoalMark } | null>(null);
  if (target === undefined) return null;
  const active = goal.status === 'active';
  const rows = marks.data ?? [];

  return (
    <div className={styles.wrap}>
      {target <= MAX_DRAWN ? (
        <div className={styles.circles} role="group" aria-label={`${goal.title}: ${done} of ${target} done`}>
          {Array.from({ length: target }, (_, i) => {
            const m = i < done ? rows[i] : undefined;
            const filled = i < done;
            return (
              <button key={i} type="button" className={`${styles.circle} ${filled ? styles.filled : ''} ${m?.note ? styles.noted : ''}`}
                disabled={!filled && !active}
                aria-label={filled ? `Circle ${i + 1}, filled${m ? ` on ${shortDay(m.day as DayKey)}` : ''}${m?.note ? `: ${m.note}` : ''}` : `Fill circle ${i + 1}`}
                title={filled ? (m ? `${shortDay(m.day as DayKey)}${m.note ? ` · ${m.note}` : ''}` : 'Filled') : 'Fill one'}
                onClick={() => (filled ? (m ? setOpen({ mark: m }) : undefined) : setOpen({}))} />
            );
          })}
        </div>
      ) : (
        <div className={styles.barWrap}>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} aria-label={goal.title}>
            <span style={{ width: `${(done / target) * 100}%` }} />
          </div>
          {active && done < target ? <button type="button" className="btn sm" onClick={() => setOpen({})}>Fill one</button> : null}
        </div>
      )}
      <span className={styles.count}>{countText(goal)}</span>
      {active && done >= target ? (
        <button type="button" className={`btn sm ${styles.achieve}`}
          onClick={() => update.mutate({ id: goal.id, update: { status: 'achieved' } }, { onSuccess: () => toast('Achieved. Well done.'), onError: (e) => toast(errorText(e)) })}>
          All {target} done · Mark achieved?
        </button>
      ) : null}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.mark ? 'Filled circle' : 'Fill a circle'}>
        {open ? (open.mark
          ? <MarkEditor goal={goal} mark={open.mark} onDone={() => setOpen(null)} />
          : <MarkFiller goal={goal} onDone={() => setOpen(null)} />) : null}
      </Dialog>
    </div>
  );
}

function MarkFiller({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const { today } = useToday();
  const add = useAddGoalMark();
  const toast = useToast();
  const [day, setDay] = useState<string>(today);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    add.mutate({ goalId: goal.id, day: day === today ? undefined : day, note: note.trim() || undefined }, {
      onSuccess: () => {
        const n = (goal.doneCount ?? 0) + 1;
        toast(n >= (goal.targetCount ?? 0) ? `All ${goal.targetCount} done.` : `${n} of ${goal.targetCount}.`);
        onDone();
      },
      onError: (er) => setErr(isApiError(er) && er.code === 'target_reached' ? targetReachedText(goal.targetCount ?? 0) : errorText(er)),
    });
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="sub">{goal.title} · {countText(goal)}</p>
      <label className="field"><span>Day</span>
        <input className="input" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
      </label>
      <label className="field"><span>Note <span className="faint">(optional)</span></span>
        <input className="input" value={note} maxLength={500} placeholder="Which one, where, how it went" onChange={(e) => setNote(e.target.value)} />
      </label>
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="form-actions">
        <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={add.isPending}>Fill it</button>
      </div>
    </form>
  );
}

function MarkEditor({ goal, mark, onDone }: { goal: Goal; mark: GoalMark; onDone: () => void }) {
  const edit = useUpdateGoalMark();
  const del = useDeleteGoalMark();
  const toast = useToast();
  const [note, setNote] = useState(mark.note ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (note.trim() === (mark.note ?? '')) { onDone(); return; }
    edit.mutate({ goalId: goal.id, markId: mark.id, note: note.trim() }, { onSuccess: () => { toast('Saved.'); onDone(); }, onError: (er) => setErr(errorText(er)) });
  };
  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="sub">{goal.title} · filled on {shortDay(mark.day as DayKey)}</p>
      <label className="field"><span>Note</span>
        <input className="input" value={note} maxLength={500} placeholder="No note" onChange={(e) => setNote(e.target.value)} />
      </label>
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="form-actions">
        <button type="button" className="btn quiet" disabled={del.isPending}
          onClick={() => del.mutate({ goalId: goal.id, markId: mark.id }, { onSuccess: () => { toast('Emptied.'); onDone(); }, onError: (er) => setErr(errorText(er)) })}>
          Empty this circle
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn quiet" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={edit.isPending}>Save note</button>
      </div>
    </form>
  );
}
