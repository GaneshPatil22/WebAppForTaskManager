import { useMemo, useState } from 'react';
import type { DailyPlan, Item, Plan, RankedItem } from '../../api/types';
import { useConfirmBigTask, useItemsById, useUpdateItem } from '../../api/queries';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { ProposalTag, errorText } from '../../ui/components';
import { useToast } from '../../ui/toast';
import { useOpenItem } from '../../app/itemSheet';
import { prefsStore } from '../../app/prefs';
import { openCapture } from '../../app/Shell';
import { ItemMeta } from '../items/ItemRow';
import { SizeChip } from '../items/SizeChip';
import { focusOn } from '../timer/Timer';
import { EFFORT_MINUTES } from '../../domain/labels';
import type { DayKey } from '../../domain/time';
import styles from './today.module.css';

/**
 * The hinge between the two halves: one substantial thing a day, drawn from
 * the ranked pile. Until you confirm, it is Brain's proposal and looks like
 * one. Choosing something else is one tap away, and both ids go to the
 * server so the swap is recorded: the most useful thing Brain can learn.
 */
export function BigTask({ plan, day }: { plan: Plan; day: DayKey }) {
  const byId = useItemsById();
  const [choosing, setChoosing] = useState(false);
  const confirmed = plan.bigTask;
  const proposal = plan.next;

  if (confirmed) {
    const item = byId.get(confirmed.itemId) ?? plan.ranked.find((r) => r.item.id === confirmed.itemId)?.item;
    return (
      <>
        <Confirmed plan={confirmed} item={item} proposed={confirmed.proposedItemId ? byId.get(confirmed.proposedItemId) : undefined} onChange={() => setChoosing(true)} />
        <Chooser open={choosing} onClose={() => setChoosing(false)} day={day} plan={plan} current={confirmed.itemId} />
      </>
    );
  }
  if (!proposal) {
    return (
      <section className={`${styles.big} ${styles.bigEmpty}`} aria-label="Today's big task">
        <div className={styles.bigLabel}>Today’s big task</div>
        <h2>Nothing to propose yet</h2>
        <p className={styles.bigSub}>Brain picks from what you capture. Dump what’s on your mind and it will rank it.</p>
        <div className={styles.bigActions}><button className="btn primary" onClick={openCapture}><Icon name="plus" size={14} />Capture</button></div>
      </section>
    );
  }
  return (
    <>
      <Proposed day={day} proposal={proposal} onChoose={() => setChoosing(true)} />
      <Chooser open={choosing} onClose={() => setChoosing(false)} day={day} plan={plan} current={proposal.item.id} />
    </>
  );
}

function Proposed({ day, proposal, onChoose }: { day: DayKey; proposal: RankedItem; onChoose: () => void }) {
  const confirm = useConfirmBigTask();
  const toast = useToast();
  const open = useOpenItem();
  return (
    <section className={`${styles.big} ${styles.bigProposed}`} aria-label="Today's big task">
      <div className={styles.bigLabel}><ProposalTag>Brain proposes · not confirmed</ProposalTag></div>
      <h2><button type="button" className={styles.bigTitle} onClick={() => open(proposal.item.id)}>{proposal.item.title}</button></h2>
      <p className={styles.bigSub}>{proposal.reason}</p>
      <div className={styles.bigSize}><SizeChip item={proposal.item} /></div>
      <div className={styles.bigActions}>
        <button className="btn primary" disabled={confirm.isPending}
          onClick={() => confirm.mutate({ day, itemId: proposal.item.id, proposedItemId: proposal.item.id }, {
            onSuccess: () => toast('Confirmed as today’s big task.'),
            onError: (e) => toast(errorText(e, 'Couldn’t confirm.')),
          })}>
          <Icon name="check" size={14} />Make it today’s big task
        </button>
        <button className="btn" onClick={onChoose}><Icon name="swap" size={14} />Choose another</button>
      </div>
    </section>
  );
}

function Confirmed({ plan, item, proposed, onChange }: { plan: DailyPlan; item: Item | undefined; proposed: Item | undefined; onChange: () => void }) {
  const update = useUpdateItem();
  const toast = useToast();
  const open = useOpenItem();
  const prefs = prefsStore.use();
  const finished = item && item.status !== 'open';
  return (
    <section className={`${styles.big} ${styles.bigConfirmed} ${finished ? styles.bigDone : ''}`} aria-label="Today's big task">
      <div className={styles.bigLabel}>Today’s big task · {finished ? 'done' : 'you confirmed it'}</div>
      <h2>{item ? <button type="button" className={styles.bigTitle} onClick={() => open(item.id)}>{item.title}</button> : 'An item that isn’t loaded'}</h2>
      {item ? (
        <div className={styles.bigSize}>
          {!finished ? <SizeChip item={item} /> : null}
          <span className={styles.bigSub}><ItemMeta item={item} showSize={!!finished} /></span>
        </div>
      ) : null}
      {plan.swapped && proposed ? <p className={styles.swapNote}><Icon name="swap" size={12} />You chose this over Brain’s pick, “{proposed.title}”. Brain learns from that.</p> : null}
      {item && !finished ? (
        <div className={styles.bigActions}>
          {prefs.timer ? (
            <button className="btn" onClick={() => focusOn(item, EFFORT_MINUTES[item.effort.value ?? 'unknown'])}><Icon name="play" size={12} />Focus</button>
          ) : null}
          <button className="btn primary" disabled={update.isPending}
            onClick={() => update.mutate({ id: item.id, update: { status: 'done' } }, { onSuccess: () => toast('Big task done. That was the one that mattered.') })}>
            <Icon name="check" size={14} />Done
          </button>
          <button className="btn quiet" onClick={onChange}>Change</button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Pick the day's big task from Brain's ranked list, in Brain's order. Brain's
 * pick is marked; anything else is a swap. Used for today and, in the
 * evening, for tomorrow.
 */
export function Chooser({ open, onClose, day, plan, current, title = 'Choose today’s big task' }: {
  open: boolean; onClose: () => void; day: DayKey; plan: Plan; current?: string | undefined; title?: string;
}) {
  const confirm = useConfirmBigTask();
  const toast = useToast();
  const [q, setQ] = useState('');
  const proposedId = plan.next?.item.id;
  const blocked = useMemo(() => new Set(plan.blocked.map((b) => b.item.id)), [plan.blocked]);
  const rows = plan.ranked.filter((r) => !q || r.item.title.toLowerCase().includes(q.toLowerCase()));

  const pick = (id: string) => confirm.mutate({ day, itemId: id, proposedItemId: proposedId }, {
    onSuccess: (p) => { toast(p.swapped ? 'Swapped. Brain records that you chose differently.' : 'Confirmed Brain’s pick.'); onClose(); },
    onError: (e) => toast(errorText(e, 'Couldn’t confirm.')),
  });

  return (
    <Dialog open={open} onClose={onClose} title={title} wide>
      <p className="sub">In Brain’s order. Picking anything other than Brain’s pick is recorded as a swap, which teaches the ranking.</p>
      {plan.ranked.length > 8 ? <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" /> : null}
      <ol className={styles.chooser}>
        {rows.map((r) => {
          const n = plan.ranked.indexOf(r) + 1;
          return (
            <li key={r.item.id}>
              <button type="button" onClick={() => pick(r.item.id)} disabled={confirm.isPending} aria-current={r.item.id === current ? 'true' : undefined}>
                <span className={styles.rankNum}>{n}</span>
                <span className={styles.chooserMain}>
                  <span className={styles.chooserTitle}>{r.item.title}</span>
                  <span className="sub">{r.reason}{blocked.has(r.item.id) ? ' · waiting on something first' : ''}</span>
                </span>
                {r.item.id === proposedId ? <ProposalTag>Brain’s pick</ProposalTag> : null}
                {r.item.id === current && r.item.id !== proposedId ? <span className="chip yours">Current</span> : null}
              </button>
            </li>
          );
        })}
        {!rows.length ? <li className="empty">Nothing matches.</li> : null}
      </ol>
    </Dialog>
  );
}
