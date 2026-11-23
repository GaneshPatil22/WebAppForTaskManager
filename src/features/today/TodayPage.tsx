import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Item, RankedItem } from '../../api/types';
import { useItems, useItemsById, usePlan, useToday, useUpdateItem } from '../../api/queries';
import { buildBoard, reorder, type BoardGroup } from '../../domain/board';
import { EFFORT_MINUTES } from '../../domain/labels';
import { dayKey, fmtMinutes, longDay } from '../../domain/time';
import { isOn, viewPrefsStore } from '../../domain/views';
import { planner, plannerStore } from '../../local/planner';
import { timer } from '../../local/timer';
import { InProgress, QueryProblem, Ring, Skeleton } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import { ItemRow } from '../items/ItemRow';
import { TimerCard } from '../timer/Timer';
import { QuestionsCard } from '../shared/Questions';
import { SuggestionsCard } from '../shared/Suggestions';
import { TodayRepeats, ComingUpCard } from '../repeats/RepeatsWidgets';
import { focusCapture } from '../../app/Shell';
import styles from './today.module.css';

export function TodayPage() {
  const plan = usePlan();
  const items = useItems();
  const prefs = viewPrefsStore.use();
  const local = plannerStore.use();
  const { today, tz } = useToday();
  const [rearrange, setRearrange] = useState(false);
  const toast = useToast();

  const notNow = useMemo(() => new Set(local.notNow[today] ?? []), [local.notNow, today]);
  const blockedIds = useMemo(() => new Set(plan.data?.blocked.map((b) => b.item.id) ?? []), [plan.data]);
  const doneToday = useMemo(
    () => (items.data ?? []).filter((i) => i.status === 'done' && dayKey(new Date(i.updatedAt), tz) === today),
    [items.data, tz, today],
  );
  const board = useMemo(() => plan.data ? buildBoard({
    ranked: plan.data.ranked, blockedIds, doneToday, notNow, order: local.order[today] ?? [],
  }) : [], [plan.data, blockedIds, doneToday, notNow, local.order, today]);

  const boardOn = isOn(prefs, 'board');
  const startable = (plan.data?.ranked ?? []).filter((r) => !blockedIds.has(r.item.id) && !notNow.has(r.item.id));
  // The server's `next`, unless you said "not now" to it on this device.
  const next = plan.data?.next && !notNow.has(plan.data.next.item.id) ? plan.data.next : startable[0];

  const rows = boardOn ? board.flatMap((g) => g.slots) : [...doneToday.map((item) => ({ item, done: true })), ...startable.map((r) => ({ item: r.item, done: false }))];
  const done = rows.filter((r) => r.done).length;
  const left = rows.filter((r) => !r.done).reduce((a, r) => a + EFFORT_MINUTES[r.item.effort.value ?? 'unknown'], 0);

  return (
    <>
      <div className={styles.thead}>
        <Ring value={rows.length ? done / rows.length : 0}><b style={{ fontSize: 14 }}>{done}/{rows.length}</b></Ring>
        <div className={styles.tl}>
          <h1>{longDay(today)}</h1>
          <p>{rows.length - done ? `${rows.length - done} to go, about ${fmtMinutes(left)} of work.` : rows.length ? 'Everything planned is done.' : 'Nothing planned yet.'}</p>
        </div>
        <div className={styles.tr}>
          {boardOn ? (
            <button className={`btn ${rearrange ? 'on' : ''}`} onClick={() => setRearrange((r) => !r)}>
              <Icon name="sort" size={15} />{rearrange ? 'Done rearranging' : 'Rearrange'}
            </button>
          ) : null}
          <button className="btn primary" onClick={() => void plan.refetch().then(() => toast('Plan refreshed from your latest graph.'))} disabled={plan.isFetching}>
            <span className={plan.isFetching ? 'spin' : ''} style={{ display: 'inline-flex' }}><Icon name="refresh" size={15} /></span>
            {plan.isFetching ? 'Refreshing…' : 'Refresh my plan'}
          </button>
        </div>
      </div>

      <div className={styles.today}>
        <div>
          {plan.error ? <QueryProblem error={plan.error} what="your plan" onRetry={() => void plan.refetch()} />
            : plan.isLoading ? <Skeleton rows={4} />
            : (
              <>
                <Hero next={next} timerOn={isOn(prefs, 'timer')} today={today} />
                {boardOn
                  ? <Board groups={board} rearrange={rearrange} today={today} />
                  : <RankedList ranked={startable} />}
                {notNow.size ? <NotNowList ids={[...notNow]} today={today} /> : null}
              </>
            )}
          {isOn(prefs, 'repeats') ? <TodayRepeats /> : null}
        </div>
        <aside className={styles.side}>
          {isOn(prefs, 'timer') ? <TimerCard /> : null}
          {isOn(prefs, 'questions') ? <QuestionsCard limit={2} /> : null}
          {isOn(prefs, 'suggestions') ? <SuggestionsCard limit={2} /> : null}
          {isOn(prefs, 'quickWins') && plan.data?.quickWins.length ? <QuickWins list={plan.data.quickWins.filter((q) => !notNow.has(q.item.id))} /> : null}
          {isOn(prefs, 'blocked') && plan.data?.blocked.length ? <Blocked /> : null}
          {isOn(prefs, 'comingUp') && isOn(prefs, 'repeats') ? <ComingUpCard /> : null}
        </aside>
      </div>
    </>
  );
}

function Hero({ next, timerOn, today }: { next: RankedItem | undefined; timerOn: boolean; today: string }) {
  const update = useUpdateItem();
  const toast = useToast();
  if (!next) {
    return (
      <section className={`${styles.hero} ${styles.clear}`}>
        <div className={styles.tag}>Do next</div>
        <h2>You’re clear.</h2>
        <p className={styles.why}>Nothing can be started right now. Capture something new, or look at the week.</p>
        <div className={styles.act}>
          <button className="btn gold" onClick={focusCapture}>Capture something</button>
          <Link to="/week" className="btn ghost">Open the week</Link>
        </div>
      </section>
    );
  }
  const minutes = EFFORT_MINUTES[next.item.effort.value ?? 'unknown'];
  return (
    <section className={styles.hero} aria-label="Do next">
      <div className={styles.tag}>Do next</div>
      <h2>{next.item.title}</h2>
      <p className={styles.why}>{next.reason}</p>
      <div className={styles.act}>
        {timerOn ? (
          <button className="btn gold" onClick={() => { timer.forItem(next.item, minutes); document.getElementById('timer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
            <Icon name="play" size={14} />{minutes >= 25 ? 'Start 25 min focus' : `Start ${minutes} min timer`}
          </button>
        ) : null}
        <button className="btn ghost" onClick={() => update.mutate({ id: next.item.id, update: { status: 'done' } }, {
          onSuccess: () => toast(`Done: ${next.item.title}`, { label: 'Undo', run: () => update.mutate({ id: next.item.id, update: { status: 'open' } }) }),
          onError: () => toast('Couldn’t save that. Try again.'),
        })}>Mark done</button>
        <button className="btn ghost" title="Hides it from today on this device. In progress." onClick={() => {
          planner.notNow(next.item.id, today);
          toast('Hidden for today.', { label: 'Undo', run: () => planner.undoNotNow(next.item.id, today) });
        }}>Not now</button>
      </div>
    </section>
  );
}

function Board({ groups, rearrange, today }: { groups: BoardGroup[]; rearrange: boolean; today: string }) {
  const toast = useToast();
  const move = (id: string, dir: -1 | 1) => planner.setOrder(today, reorder(groups, id, dir));
  return (
    <div>
      <p className={styles.boardNote}>
        <InProgress note="The grouping and your rearranging are kept on this device. The order inside each group is Brain’s." />
        <span>Grouped from Brain’s ranking. Rearranging stays on this device.</span>
        {rearrange ? <button className="btn sm" onClick={() => { planner.clearOrder(today); toast('Back to Brain’s order.'); }}>Reset order</button> : null}
      </p>
      {groups.map((g) => {
        const all = [...g.slots, ...g.overflow];
        const doneN = g.slots.filter((r) => r.done).length;
        const actions = (row: (typeof all)[number]) => {
          if (rearrange) {
            const i = all.indexOf(row);
            return (
              <>
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(row.item.id, -1)}><Icon name="up" /></button>
                <button className="icon-btn" aria-label="Move down" disabled={i === all.length - 1} onClick={() => move(row.item.id, 1)}><Icon name="down" /></button>
              </>
            );
          }
          return row.done ? null : <RowActions item={row.item} today={today} />;
        };
        return (
          <div className={styles.grp} key={g.id}>
            <div className={styles.ghead}>
              <div className={styles.gnum}>{g.n}</div>
              <div><div className={styles.gname}>{g.name}</div><div className={styles.ghint}>{g.hint}</div></div>
              <div className={styles.gcount}>{doneN} of {g.slots.length} done</div>
            </div>
            <ul className="list">
              {g.slots.map((r) => <ItemRow key={r.item.id} item={r.item} ranked={r.ranked} done={r.done} actions={actions(r)} />)}
              {g.slots.length < g.n ? (
                <li><button type="button" className={styles.emptySlot} onClick={focusCapture}>
                  {g.slots.length ? `${g.n - g.slots.length} open slot${g.n - g.slots.length === 1 ? '' : 's'}.` : 'Nothing this size right now.'} Capture something, or leave it light.
                </button></li>
              ) : null}
            </ul>
            {g.overflow.length ? (
              <>
                <p className={styles.overNote}>{g.overflow.length} more than fits today. They wait, ranked.</p>
                <ul className="list dashed">{g.overflow.map((r) => <ItemRow key={r.item.id} item={r.item} ranked={r.ranked} actions={actions(r)} />)}</ul>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RankedList({ ranked }: { ranked: RankedItem[] }) {
  const { today } = useToday();
  return (
    <>
      <h2 className="section-title">Ranked for you</h2>
      {ranked.length
        ? <ul className="list">{ranked.map((r) => <ItemRow key={r.item.id} item={r.item} ranked={r} showReason actions={<RowActions item={r.item} today={today} />} />)}</ul>
        : <ul className="list"><li className="empty">Nothing to rank yet.</li></ul>}
    </>
  );
}

function RowActions({ item, today }: { item: Item; today: string }) {
  const prefs = viewPrefsStore.use();
  const toast = useToast();
  const minutes = EFFORT_MINUTES[item.effort.value ?? 'unknown'];
  return (
    <>
      {isOn(prefs, 'timer') ? (
        <button className="icon-btn" title={`Start a ${fmtMinutes(minutes)} timer`} aria-label={`Start a timer for ${item.title}`}
          onClick={() => { timer.forItem(item, minutes); document.getElementById('timer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
          <Icon name="play" size={13} />
        </button>
      ) : null}
      <button className="btn sm" title="Hide from today, on this device" onClick={() => {
        planner.notNow(item.id, today);
        toast('Hidden for today.', { label: 'Undo', run: () => planner.undoNotNow(item.id, today) });
      }}>Not now</button>
    </>
  );
}

function NotNowList({ ids, today }: { ids: string[]; today: string }) {
  const byId = useItemsById();
  const rows = ids.map((id) => byId.get(id)).filter((i): i is Item => !!i && i.status === 'open');
  if (!rows.length) return null;
  return (
    <>
      <h2 className="section-title">Not today <InProgress /></h2>
      <ul className="list dashed">
        {rows.map((i) => <ItemRow key={i.id} item={i} actions={<button className="btn sm" onClick={() => planner.undoNotNow(i.id, today)}>Bring back</button>} />)}
      </ul>
    </>
  );
}

function QuickWins({ list }: { list: RankedItem[] }) {
  if (!list.length) return null;
  return (
    <section className="card">
      <h3>Quick wins</h3>
      <p className="sub">Small, and worth it. From Brain’s ranking.</p>
      <ul className={styles.mini}>{list.slice(0, 5).map((r) => <ItemRow key={r.item.id} item={r.item} ranked={r} />)}</ul>
    </section>
  );
}

function Blocked() {
  const plan = usePlan();
  const byId = useItemsById();
  return (
    <section className="card">
      <h3>Blocked</h3>
      <p className="sub">Waiting on something else first.</p>
      <ul className={styles.blocked}>
        {plan.data!.blocked.map((b) => (
          <li key={b.item.id}>
            <b>{b.item.title}</b>
            <span className="sub">waits for {b.blockedBy.map((id) => byId.get(id)?.title ?? 'an item').join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
