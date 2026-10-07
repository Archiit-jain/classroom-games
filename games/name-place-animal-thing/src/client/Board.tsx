import type { BoardProps, BoardReaction, BoardStream, EffectsMode } from '@cg/game-sdk/client';
import type { SeatView } from '@cg/protocol';
import { Avatar, CountdownRing, ReactionBubble, Stamp, durationFor, seatAccent } from '@cg/ui';
import { AnimatePresence, motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  LETTERS,
  MAX_ANSWER_LENGTH,
  POINTS,
  looksValid,
  type Answers,
  type Category,
  type CheckedAnswer,
  type DraftChunk,
  type GroupView,
  type NpatAction,
  type NpatEvent,
  type NpatView,
} from '../shared';
import { CategoryIcon, CheckIcon, CrossIcon } from './icons';
import { f, type NpatMessageKey } from './messages';
import './name-place-animal-thing.css';

type Props = BoardProps<NpatView, NpatAction, NpatEvent>;

/** Autosave this long after the last keystroke (design §6.2). */
const AUTOSAVE_MS = 400;

const pop = (effects: EffectsMode) =>
  effects === 'full'
    ? { type: 'spring' as const, stiffness: 520, damping: 16 }
    : { duration: durationFor(effects, 220, 160) / 1000 };

const catLabel = (c: Category) => f(`cat.${c}` as NpatMessageKey);

export default function NpatBoard(props: Props) {
  const { view, me, seats, effects, msUntil, reactions } = props;
  const nameOf = (seat: number) =>
    seat === me ? f('you') : (seats.find((s) => s.seat === seat)?.displayName ?? `#${seat + 1}`);
  const latestReaction = (seat: number): BoardReaction | undefined =>
    [...reactions].reverse().find((r) => r.seat === seat);
  const timed = view.phase === 'WRITING' || view.phase === 'REVIEW';

  return (
    <div className={`np np--${view.phase.toLowerCase()}`}>
      <header className="np-top">
        <span className="np-round">{f('round', { round: view.round, rounds: view.rounds })}</span>
        <LetterBadge view={view} effects={effects} />
        {timed && view.phaseMs > 0 ? (
          <CountdownRing
            key={`${view.round}-${view.phase}`}
            deadline={view.phaseEndsAt}
            totalMs={view.phaseMs}
            msUntil={msUntil}
            size={48}
            urgentMs={10_000}
          />
        ) : (
          <span className="np-top__spacer" />
        )}
      </header>

      <Players view={view} me={me} seats={seats} effects={effects} reaction={latestReaction} />

      {view.phase === 'LETTER' && <GetReady effects={effects} />}
      {(view.phase === 'WRITING' || view.phase === 'LOCKING') && (
        <Worksheet {...props} nameOf={nameOf} />
      )}
      {view.phase === 'REVIEW' && <Review {...props} nameOf={nameOf} />}
      {(view.phase === 'ROUND_RESULT' || view.phase === 'OVER') && (
        <RoundScores view={view} seats={seats} me={me} effects={effects} nameOf={nameOf} />
      )}
    </div>
  );
}

// ───────────────────────────── header ─────────────────────────────

function LetterBadge({ view, effects }: { view: NpatView; effects: EffectsMode }) {
  if (!view.letter || view.phase === 'LETTER') {
    return <span className="np-letter np-letter--empty" aria-hidden="true" />;
  }
  return (
    <motion.span
      key={`${view.round}-${view.letter}`}
      className="np-letter"
      role="img"
      aria-label={f('letterLabel', { letter: view.letter })}
      initial={
        effects === 'reduced'
          ? false
          : { scale: effects === 'full' ? 2.4 : 1.2, rotate: -18, opacity: 0 }
      }
      animate={{ scale: 1, rotate: -6, opacity: 1 }}
      transition={pop(effects)}
    >
      {view.letter}
    </motion.span>
  );
}

/** The letter "slot machine" while everyone gets ready (decoration: the real letter is not known yet). */
function GetReady({ effects }: { effects: EffectsMode }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (effects !== 'full') return;
    const timer = setInterval(() => setI((n) => (n + 1) % LETTERS.length), 90);
    return () => clearInterval(timer);
  }, [effects]);
  return (
    <div className="np-ready" role="status">
      {effects !== 'reduced' && (
        <span className="np-ready__slot" aria-hidden="true">
          {effects === 'full' ? LETTERS[i] : '?'}
        </span>
      )}
      <p className="np-ready__text">{f('getReady')}</p>
    </div>
  );
}

function Players({
  view,
  me,
  seats,
  effects,
  reaction,
}: {
  view: NpatView;
  me: number;
  seats: readonly SeatView[];
  effects: EffectsMode;
  reaction(seat: number): BoardReaction | undefined;
}) {
  const showDelta = view.phase === 'ROUND_RESULT' || view.phase === 'OVER';
  return (
    <ol className="np-players">
      {[...seats]
        .sort((a, b) => a.seat - b.seat)
        .map((s) => {
          const done = view.phase === 'REVIEW' && view.done.includes(s.seat);
          const delta = showDelta ? (view.last?.deltas[s.seat] ?? 0) : 0;
          return (
            <li
              key={s.seat}
              className={[
                'np-player',
                s.seat === me && 'np-player--me',
                view.stoppedBy === s.seat && view.phase === 'LOCKING' && 'np-player--stopped',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--seat': `var(--cb-${seatAccent(s.seat)})` } as CSSProperties}
            >
              <ReactionBubble reaction={reaction(s.seat)} />
              <Avatar
                name={s.displayName}
                accent={seatAccent(s.seat)}
                size={30}
                botLabel={s.controller === 'BOT' ? f('bot') : undefined}
              />
              <span className="np-player__name">{s.displayName}</span>
              <span className="np-player__score">{view.scores[s.seat] ?? 0}</span>
              {done && (
                <span className="np-player__done" role="img" aria-label={f('done')}>
                  <CheckIcon size={14} />
                </span>
              )}
              {delta > 0 && (
                <motion.span
                  className="np-player__delta"
                  initial={effects === 'full' ? { y: 14, opacity: 0, scale: 0.6 } : false}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={effects === 'full' ? { ...pop(effects), delay: 0.4 } : undefined}
                >
                  {f('roundPoints', { n: delta })}
                </motion.span>
              )}
            </li>
          );
        })}
    </ol>
  );
}

// ───────────────────────────── writing ─────────────────────────────

/**
 * The private sheet: local text, autosaved to the server (never to other players)
 * with a per-round sequence so the newest save always wins.
 */
function useSheet(view: NpatView, stream: BoardStream, botPlaying: boolean) {
  const [answers, setAnswers] = useState<Answers>(view.mine);
  const [pending, setPending] = useState(false);
  // A new round, or taking my seat back from a bot: start from the server's sheet.
  const [shownRound, setShownRound] = useState(view.round);
  const [wasBot, setWasBot] = useState(botPlaying);
  if (shownRound !== view.round || wasBot !== botPlaying) {
    setShownRound(view.round);
    setWasBot(botPlaying);
    setAnswers(view.mine);
  }
  const latest = useRef(answers);
  const round = useRef(view.round);
  const seq = useRef(view.mineSeq);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    seq.current += 1;
    const chunk: DraftChunk = { round: round.current, seq: seq.current, answers: latest.current };
    stream.send(chunk);
    setPending(false);
  }, [stream]);

  useEffect(() => {
    latest.current = answers;
  }, [answers]);
  // Continue after the server's latest sequence (new round, reconnect, a bot that played for me).
  useEffect(() => {
    if (view.round !== round.current) {
      round.current = view.round;
      seq.current = view.mineSeq;
      dirty.current = false;
    }
    seq.current = Math.max(seq.current, view.mineSeq);
  }, [view.round, view.mineSeq]);
  // Writing ended (STOP or time-up): send what was typed right away.
  useEffect(() => {
    if (view.phase !== 'WRITING') flush();
  }, [view.phase, flush]);
  useEffect(() => flush, [flush]);

  const change = (category: Category, value: string) => {
    const next = { ...latest.current, [category]: value };
    latest.current = next;
    setAnswers(next);
    dirty.current = true;
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };
  /** STOP carries the sheet itself: nothing else needs sending. */
  const takeForStop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    setPending(false);
    return latest.current;
  };
  /** STOP was refused: autosave the sheet as usual instead. */
  const resave = () => {
    dirty.current = true;
    flush();
  };
  // While a bot plays my seat, its sheet is what I see.
  return {
    answers: botPlaying ? view.mine : answers,
    change,
    flush,
    pending,
    takeForStop,
    resave,
  };
}

function Worksheet({
  view,
  me,
  seats,
  send,
  stream,
  effects,
  nameOf,
}: Props & { nameOf(seat: number): string }) {
  const botPlaying = seats.find((s) => s.seat === me)?.controller === 'BOT';
  const sheet = useSheet(view, stream, botPlaying);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [stopping, setStopping] = useState(false);
  const writing = view.phase === 'WRITING' && !botPlaying;
  const letter = view.letter;
  const valid = (c: Category) => looksValid(sheet.answers[c] ?? '', letter);
  const full = view.categories.every(valid);
  const canStop = writing && view.stopOpen && full && !stopping;

  // Focus the first field when writing opens (not on phones mid-scroll: only if nothing is focused).
  useEffect(() => {
    if (view.phase === 'WRITING' && document.activeElement === document.body) {
      inputs.current[0]?.focus({ preventScroll: true });
    }
  }, [view.phase, view.round]);

  const next = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    sheet.flush();
    const order = view.categories.map((_, k) => (i + 1 + k) % view.categories.length);
    const target = order.find((k) => !valid(view.categories[k] as Category)) ?? i + 1;
    const el = inputs.current[target];
    if (el && target > i) el.focus();
    else (e.target as HTMLInputElement).blur();
  };

  const stop = async () => {
    if (!canStop) return;
    setStopping(true);
    const ok = await send({ type: 'STOP', round: view.round, answers: sheet.takeForStop() });
    if (!ok) sheet.resave();
    setStopping(false);
  };

  const stopHint = !view.stopOpen ? 'stopHintLocked' : full ? 'stopHintReady' : 'stopHintFill';
  const ended = view.phase === 'LOCKING';

  return (
    <div className="np-sheet-wrap">
      <form
        className="np-sheet"
        onSubmit={(e) => e.preventDefault()}
        aria-label={f('letterIs', { letter: letter ?? '' })}
      >
        <p className="np-sheet__note">{botPlaying ? f('botWriting') : f('privateNote')}</p>
        {view.categories.map((c, i) => {
          const value = sheet.answers[c] ?? '';
          const ok = valid(c);
          return (
            <label key={c} className={`np-field np-field--${c}${ok ? ' np-field--ok' : ''}`}>
              <span className="np-field__label">
                <CategoryIcon category={c} />
                {catLabel(c)}
              </span>
              <input
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                className="np-field__input"
                value={value}
                maxLength={MAX_ANSWER_LENGTH}
                disabled={!writing}
                placeholder={letter ? f('startsWith', { letter }) : ''}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint={i === view.categories.length - 1 ? 'done' : 'next'}
                onChange={(e) => sheet.change(c, e.target.value)}
                onBlur={sheet.flush}
                onKeyDown={(e) => next(i, e)}
                // Immediate (a smooth scroll gets cancelled when focus and the round's
                // start, or the keyboard, arrive together); the field's scroll margin keeps
                // it clear of the pinned STOP bar.
                onFocus={(e) => e.target.scrollIntoView({ block: 'nearest' })}
                data-category={c}
              />
              <AnimatePresence>
                {ok && (
                  <motion.span
                    className="np-field__tick"
                    role="img"
                    aria-label={f('looksGood')}
                    initial={effects === 'reduced' ? false : { scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ opacity: 0 }}
                    transition={pop(effects)}
                  >
                    <CheckIcon />
                  </motion.span>
                )}
              </AnimatePresence>
            </label>
          );
        })}
      </form>

      <div className="np-actions">
        <span className="np-actions__status" aria-live="polite">
          {ended ? f('pencilsDown') : sheet.pending ? f('saving') : f('saved')}
        </span>
        {!botPlaying && (
          <button
            type="button"
            className={`np-stop${canStop ? ' np-stop--ready' : ''}`}
            disabled={!canStop}
            onClick={() => void stop()}
            aria-describedby="np-stop-hint"
          >
            {f('stop')}
          </button>
        )}
        <span id="np-stop-hint" className="np-actions__hint">
          {ended ? '' : f(stopHint)}
        </span>
      </div>

      <AnimatePresence>
        {ended && (
          <motion.div
            key="ended"
            className="np-banner"
            role="status"
            initial={
              effects === 'reduced'
                ? false
                : { scale: effects === 'full' ? 1.8 : 1, opacity: 0, rotate: -10 }
            }
            animate={{ scale: 1, opacity: 1, rotate: -4 }}
            exit={{ opacity: 0 }}
            transition={pop(effects)}
          >
            <Stamp tone="danger">
              {view.stoppedBy === null
                ? f('timeUp')
                : view.stoppedBy === me
                  ? f('youStopped')
                  : f('stoppedBy', { name: nameOf(view.stoppedBy) })}
            </Stamp>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────── review ─────────────────────────────

function Review({ view, me, send, effects, nameOf }: Props & { nameOf(seat: number): string }) {
  const review = view.review;
  const [busy, setBusy] = useState(false);
  const cards = useRef<Partial<Record<Category, HTMLElement | null>>>({});
  if (!review) return null;
  const groups = new Map(review.groups.map((g) => [g.id, g]));
  const iAmDone = view.done.includes(me);
  const waiting = view.waitingFor.filter((s) => s !== me).length;

  const vote = async (g: GroupView) => {
    if (busy) return;
    setBusy(true);
    await send({ type: 'VOTE', round: view.round, group: g.id, out: !g.mine });
    setBusy(false);
  };

  return (
    <div className="np-review">
      <p className="np-review__hint">
        {view.canVote ? f('reviewHint') : f('reviewReadOnly')} {!view.canVote && f('noVoting')}
      </p>
      <nav className="np-tabs" aria-label={f('review')}>
        {view.categories.map((c) => (
          <button
            key={c}
            type="button"
            className="np-tab"
            onClick={() =>
              cards.current[c]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'start',
              })
            }
          >
            <CategoryIcon category={c} size={18} />
            <span>{catLabel(c)}</span>
          </button>
        ))}
      </nav>
      <div className="np-cards">
        {view.categories.map((c, i) => (
          <motion.section
            key={c}
            ref={(el) => {
              cards.current[c] = el;
            }}
            className={`np-card np-card--${c}`}
            aria-label={catLabel(c)}
            initial={
              effects === 'reduced'
                ? false
                : effects === 'full'
                  ? { rotateY: 80, opacity: 0 }
                  : { opacity: 0 }
            }
            animate={{ rotateY: 0, opacity: 1 }}
            transition={
              effects === 'full'
                ? { type: 'spring', stiffness: 300, damping: 24, delay: i * 0.07 }
                : { duration: durationFor(effects, 200, 160) / 1000 }
            }
          >
            <h3 className="np-card__title">
              <CategoryIcon category={c} />
              {catLabel(c)}
            </h3>
            <ul className="np-rows">
              {review.answers[c].map((a) => (
                <AnswerRow
                  key={a.seat}
                  answer={a}
                  group={a.group ? groups.get(a.group) : undefined}
                  me={me}
                  name={nameOf(a.seat)}
                  canVote={view.canVote}
                  busy={busy}
                  onVote={(g) => void vote(g)}
                />
              ))}
            </ul>
          </motion.section>
        ))}
      </div>
      {view.canVote && (
        <div className="np-review__footer">
          <button
            type="button"
            className="btn btn--lime"
            disabled={iAmDone}
            onClick={() => void send({ type: 'DONE', round: view.round })}
          >
            {f('done')}
          </button>
          <span className="np-review__waiting" aria-live="polite">
            {iAmDone ? f('youAreDone') : waiting > 0 ? f('doneWaiting', { n: waiting }) : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function AnswerRow({
  answer,
  group,
  me,
  name,
  canVote,
  busy,
  onVote,
}: {
  answer: CheckedAnswer;
  group: GroupView | undefined;
  me: number;
  name: string;
  canVote: boolean;
  busy: boolean;
  onVote(g: GroupView): void;
}) {
  const mine = group?.authors.includes(me) ?? answer.seat === me;
  const losing = group ? group.votes >= group.needed && group.eligible > 0 : false;
  const others = group ? group.authors.length - 1 : 0;
  const status =
    answer.status === 'INVALID'
      ? f(`reason.${answer.reason ?? 'CHARACTERS'}` as NpatMessageKey)
      : answer.status === 'RECOGNISED'
        ? f('inList')
        : answer.status === 'UNVERIFIED'
          ? f('notInList')
          : '';
  return (
    <li
      className={[
        'np-row',
        `np-row--${answer.status.toLowerCase()}`,
        answer.seat === me && 'np-row--me',
        losing && 'np-row--out',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="np-row__who">{name}</span>
      <span className="np-row__text">{answer.text || f('blank')}</span>
      <span className="np-row__meta">
        {status && <span className="np-row__status">{status}</span>}
        {others > 0 && <span className="np-row__shared">{f('shared', { n: others })}</span>}
        {group && group.eligible > 0 && (
          <span className="np-row__votes">
            {f('votes', { votes: group.votes, needed: group.needed })}
          </span>
        )}
      </span>
      {group && canVote && !mine && (
        <button
          type="button"
          className={`np-vote${group.mine ? ' np-vote--on' : ''}`}
          aria-pressed={group.mine}
          aria-label={
            group.mine
              ? f('undoVote', { answer: answer.text })
              : f('voteOut', { answer: answer.text })
          }
          disabled={busy}
          onClick={() => onVote(group)}
        >
          <CrossIcon />
        </button>
      )}
    </li>
  );
}

// ───────────────────────────── scores ─────────────────────────────

function RoundScores({
  view,
  seats,
  me,
  effects,
  nameOf,
}: {
  view: NpatView;
  seats: readonly SeatView[];
  me: number;
  effects: EffectsMode;
  nameOf(seat: number): string;
}) {
  const result = view.last;
  if (!result) return null;
  const order = [...seats].sort((a, b) => (view.scores[b.seat] ?? 0) - (view.scores[a.seat] ?? 0));
  const tone = (p: number) =>
    p === POINTS.unique ? 'unique' : p === POINTS.shared ? 'shared' : 'zero';
  return (
    <div className="np-scores">
      <h3 className="np-scores__title">{f('results', { round: result.round })}</h3>
      <div className="np-table-wrap">
        <table className="np-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{f('player')}</span>
              </th>
              {view.categories.map((c) => (
                <th key={c} scope="col" title={catLabel(c)}>
                  <CategoryIcon category={c} size={18} />
                  <span className="sr-only">{catLabel(c)}</span>
                </th>
              ))}
              <th scope="col">{f('roundCol')}</th>
              <th scope="col">{f('total')}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((s, row) => (
              <tr key={s.seat} className={s.seat === me ? 'np-table__me' : undefined}>
                <th scope="row">{nameOf(s.seat)}</th>
                {view.categories.map((c, col) => {
                  const p = result.points[s.seat]?.[c] ?? 0;
                  return (
                    <td key={c}>
                      <motion.span
                        className={`np-points np-points--${tone(p)}`}
                        aria-label={`${catLabel(c)}: ${p}`}
                        initial={
                          effects === 'reduced'
                            ? false
                            : { scale: effects === 'full' ? 2 : 1, opacity: 0 }
                        }
                        animate={{ scale: 1, opacity: 1 }}
                        transition={
                          effects === 'full'
                            ? {
                                ...pop(effects),
                                delay: 0.05 * (row * view.categories.length + col),
                              }
                            : { duration: 0.15 }
                        }
                      >
                        {p}
                      </motion.span>
                    </td>
                  );
                })}
                <td className="np-table__delta">+{result.deltas[s.seat] ?? 0}</td>
                <td className="np-table__total">{view.scores[s.seat] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
