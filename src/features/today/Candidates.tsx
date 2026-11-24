import { useMemo, useState } from 'react';
import type { Item, Plan, RankedItem } from '../../api/types';
import { useItems, useItemsById, useToday, useUpdateItem } from '../../api/queries';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/toast';
import { prefsStore } from '../../app/prefs';
import { ItemRow } from '../items/ItemRow';
import { focusOn } from '../timer/Timer';
import { EFFORT_MINUTES } from '../../domain/labels';
import { dayKey } from '../../domain/time';
import { buildBoard, moveStep, type BoardGroup } from '../../domain/board';
import { board as boardOps, boardStore } from '../../local/planner';
import styles from './today.module.css';

type Tab = 'top' | 'quick' | 'waiting';
const CAP = 5;

/**
 * Captured work, in Brain's order. Numbered, because order is the point.
 * Views here only filter and cap the server's lists; nothing is re-sorted.
 * The 1-3-5 board is an optional way to show the same list.
 */
export function Candidates({ plan, exclude }: { plan: Plan; exclude?: string | undefined }) {
  const prefs = prefsStore.use();
  const [tab, setTab] = useState<Tab>('top');
  const [all, setAll] = useState(false);
  const byId = useItemsById();

  const blocked = useMemo(() => new Set(plan.blocked.map((b) => b.item.id)), [plan.blocked]);
  const top = plan.ranked.filter((r) => r.item.id !== exclude);
  const quick = plan.quickWins.filter((r) => r.item.id !== exclude);

  return (
    <section aria-label="Ranked by Brain">
      <div className="section-head">
        <h2><span className={styles.rankDot} />Ranked by Brain</h2>
        <span className="grow sub">Captured work, in Brain’s order.</span>
        <div className="seg" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={tab === 'top'} onClick={() => setTab('top')}>{prefs.board ? '1-3-5' : 'Next up'}</button>
          <button role="tab" aria-selected={tab === 'quick'} onClick={() => setTab('quick')}>Quick wins</button>
          <button role="tab" aria-selected={tab === 'waiting'} onClick={() => setTab('waiting')}>Waiting{plan.blocked.length ? ` ${plan.blocked.length}` : ''}</button>
        </div>
      </div>

      {tab === 'top' && prefs.board ? <Board plan={plan} blocked={blocked} /> : null}
      {tab === 'top' && !prefs.board ? <RankedList rows={top} plan={plan} blocked={blocked} all={all} setAll={setAll} empty="Nothing ranked yet. Capture something and Brain will place it." /> : null}
      {tab === 'quick' ? <RankedList rows={quick} plan={plan} blocked={blocked} all={all} setAll={setAll} empty="No quick wins right now." /> : null}
      {tab === 'waiting' ? (
        plan.blocked.length ? (
          <div className={styles.list}>
            {plan.blocked.map((b) => (
              <ItemRow key={b.item.id} item={b.item} lead={<span className={styles.waitIcon}><Icon name="lock" size={13} /></span>}
                reason={`Waits for ${b.blockedBy.map((id) => byId.get(id)?.title ?? 'another item').join(', ')}`} />
            ))}
          </div>
        ) : <p className="empty">Nothing is waiting on anything else.</p>
      ) : null}
    </section>
  );
}

function RankedList({ rows, plan, blocked, all, setAll, empty }: {
  rows: RankedItem[]; plan: Plan; blocked: Set<string>; all: boolean; setAll: (v: boolean) => void; empty: string;
}) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  const shown = all ? rows : rows.slice(0, CAP);
  return (
    <>
      <ol className={styles.list}>
        {shown.map((r) => (
          <li key={r.item.id}>
            <ItemRow item={r.item} reason={whyLine(r, blocked.has(r.item.id))}
              lead={<span className={styles.rankNum}>{plan.ranked.findIndex((x) => x.item.id === r.item.id) + 1}</span>}
              actions={<RowActions item={r.item} />} />
          </li>
        ))}
      </ol>
      {rows.length > CAP ? (
        <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      ) : null}
    </>
  );
}

/**
 * The part of the server's reason the row doesn't already show: what the
 * item unblocks or serves. Effort and due date are in the row's own line,
 * marked as guesses where they are.
 */
function whyLine(r: RankedItem, blocked: boolean): string | undefined {
  const parts: string[] = [];
  if (r.why.unblocks) parts.push(`unblocks ${r.why.unblocks}`);
  if (r.why.servesGoals) parts.push(`serves ${r.why.servesGoals} goal${r.why.servesGoals === 1 ? '' : 's'}`);
  if (blocked) parts.push('waiting on something first');
  if (!parts.length) return undefined;
  const s = parts.join(' · ');
  return s[0]!.toUpperCase() + s.slice(1);
}

function RowActions({ item }: { item: Item }) {
  const update = useUpdateItem();
  const toast = useToast();
  const prefs = prefsStore.use();
  return (
    <>
      {prefs.timer ? (
        <button type="button" className="icon-btn" aria-label={`Focus on ${item.title}`} title="Start a timer"
          onClick={() => focusOn(item, EFFORT_MINUTES[item.effort.value ?? 'unknown'])}><Icon name="play" size={12} /></button>
      ) : null}
      <button type="button" className="icon-btn" aria-label={`Done: ${item.title}`} title="Done"
        onClick={() => update.mutate({ id: item.id, update: { status: 'done' } }, { onSuccess: () => toast('Done.', { label: 'Undo', run: () => update.mutate({ id: item.id, update: { status: 'open' } }) }) })}>
        <Icon name="check" size={15} />
      </button>
    </>
  );
}

/**
 * The optional 1-3-5 board: the same ranked list, bucketed by effort and
 * capped. You can rearrange it for today on this device; that changes
 * neither the item nor Brain's ranking.
 */
function Board({ plan, blocked }: { plan: Plan; blocked: Set<string> }) {
  const { tz } = useToday();
  const items = useItems();
  const arrangement = boardStore.use();
  const day = plan.day;
  const [moving, setMoving] = useState<string | null>(null);
  const doneToday = useMemo(
    () => (items.data ?? []).filter((i) => i.status === 'done' && dayKey(new Date(i.updatedAt), tz) === day),
    [items.data, tz, day],
  );
  const groups: BoardGroup[] = buildBoard({
    ranked: plan.ranked, blockedIds: blocked, doneToday, notNow: new Set(),
    order: arrangement.order[day] ?? [], moved: arrangement.moved[day] ?? {},
  });
  const step = (id: string, dir: -1 | 1) => {
    const m = moveStep(groups, id, dir);
    if (m) boardOps.applyMove(day, id, m.order, m.to);
  };

  return (
    <div className={styles.board}>
      {groups.map((g) => (
        <div key={g.id} className={styles.bgroup}>
          <div className={styles.bhead}><b>{g.n}</b> {g.name} <span className="faint">· {g.hint}</span></div>
          {g.slots.length ? (
            <div className={styles.list}>
              {g.slots.map((r) => (
                <ItemRow key={r.item.id} item={r.item} reason={r.ranked ? whyLine(r.ranked, false) : undefined}
                  actions={r.done ? <span className="chip">done</span> : moving === r.item.id ? (
                    <>
                      <button type="button" className="icon-btn" aria-label="Move up" onClick={() => step(r.item.id, -1)}><Icon name="up" /></button>
                      <button type="button" className="icon-btn" aria-label="Move down" onClick={() => step(r.item.id, 1)}><Icon name="down" /></button>
                      <button type="button" className="btn sm quiet" onClick={() => setMoving(null)}>Done</button>
                    </>
                  ) : <button type="button" className="icon-btn" aria-label={`Rearrange ${r.item.title}`} title="Rearrange" onClick={() => setMoving(r.item.id)}><Icon name="more" /></button>} />
              ))}
            </div>
          ) : <p className="sub" style={{ padding: '6px 0' }}>Nothing this size right now.</p>}
          {g.overflow.length ? <p className="sub">+{g.overflow.length} more waiting for a slot</p> : null}
        </div>
      ))}
      {(arrangement.order[day]?.length ?? 0) > 0 ? (
        <button type="button" className="link-btn" onClick={() => boardOps.reset()}>Back to Brain’s order</button>
      ) : null}
    </div>
  );
}
