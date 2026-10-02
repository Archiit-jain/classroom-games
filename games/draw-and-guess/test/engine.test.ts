import { createRng, eventsForSeat, type Scoped, type StepCtx, type Transition } from '@cg/game-sdk';
import { assertNoViewLeak, deepFreeze, simulateMatch } from '@cg/game-sdk/testing';
import { describe, expect, it } from 'vitest';
import { WORD_PACK } from '../content/en';
import {
  TEMPLATES,
  createDrawAndGuessGame,
  drawAndGuessGame,
  perturbDrawHidden,
} from '../src/server';
import {
  hintCap,
  normalizeGuess,
  type DrawEvent,
  type DrawState,
  type Op,
  type WordEntry,
} from '../src/shared';

type T = Transition<DrawState, DrawEvent>;
const game = drawAndGuessGame;
const SEATS = [0, 1, 2, 3];
const ctx = (now: number, seed = 7): StepCtx => ({ now, rng: createRng(seed) });
const frozen = (t: T): T => ({ ...t, state: deepFreeze(t.state) });
const start = (seats = SEATS, seed = 7, rounds = 2) =>
  frozen(game.setup(seats, { rounds }, ctx(10_000, seed)));
const timer = (s: DrawState, id = 'phase', now = s.phaseEndsAt, seed = 3) =>
  frozen(game.onTimer(s, id, ctx(now, seed)));
const choose = (s: DrawState, option = 0) =>
  frozen(game.applyAction(s, s.drawer, { type: 'CHOOSE', option }, ctx(s.phaseEndsAt - 5000)));
const chat = (s: DrawState, seat: number, text: string) =>
  game.chat!.intercept(s, seat, normalizeGuess(text), ctx(s.phaseEndsAt - 20_000));
const wordOf = (s: DrawState) => (WORD_PACK[s.wordIndex as number] as WordEntry).word;
const types = (events: Scoped<DrawEvent>[], seat: number) =>
  eventsForSeat(events, seat).map((e) => e.type);

/** A DRAWING state with a chosen word (deterministic). */
function drawing(seed = 7): DrawState {
  return choose(start(SEATS, seed).state).state;
}
/** A DRAWING state whose word is `word`. */
function drawingWord(word: string): DrawState {
  const s = drawing();
  const wordIndex = WORD_PACK.findIndex((e) => e.word === word);
  return deepFreeze({ ...s, wordIndex });
}
const stroke = (id: number, points = [10, 10, 20, 20]): Op => ({
  op: 'stroke',
  id,
  tool: 'pen',
  colour: 0,
  size: 1,
  points,
});

describe('turn flow', () => {
  it('needs 3–6 players', () => {
    expect(() => game.setup([0, 1], { rounds: 1 }, ctx(0))).toThrow(/3–6/);
    expect(() => game.setup([0, 1, 2, 3, 4, 5, 6], { rounds: 1 }, ctx(0))).toThrow(/3–6/);
  });

  it('starts with the first drawer choosing between three private cards, at least one drawable', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { state, events, timers } = start(SEATS, seed);
      expect(state).toMatchObject({
        phase: 'CHOOSING',
        drawer: 0,
        round: 1,
        turn: 1,
        phaseMs: 10_000,
      });
      expect(timers).toContainEqual({ set: 'phase', ms: 10_000 });
      const opts = eventsForSeat(events, 0).find((e) => e.type === 'WORD_OPTIONS');
      expect(opts && 'options' in opts && opts.options).toHaveLength(3);
      expect(opts && 'options' in opts && opts.options.some((o) => o.drawable)).toBe(true);
      expect(types(events, 1)).toEqual(['CHOOSING_STARTED']);
      expect(game.getPlayerView(state, 1).options).toEqual([]);
    }
  });

  it('offers one card per difficulty', () => {
    const { state } = start();
    const d = state.options.map((i) => (WORD_PACK[i] as WordEntry).difficulty).sort();
    expect(d).toEqual(['easy', 'hard', 'medium']);
  });

  it('gives only the drawer the word; guessers see the pattern', () => {
    const t = choose(start().state, 1);
    const word = wordOf(t.state);
    expect(t.state.phase).toBe('DRAWING');
    expect(eventsForSeat(t.events, 0)).toContainEqual({ type: 'YOUR_WORD', word });
    for (const seat of [1, 2, 3]) {
      expect(JSON.stringify(eventsForSeat(t.events, seat))).not.toContain(`"${word}"`);
      expect(game.getPlayerView(t.state, seat).word).toBeNull();
    }
    expect(game.getPlayerView(t.state, 0).word).toBe(word);
    expect(game.getPlayerView(t.state, 1).pattern).toMatch(/^[_ -]+$/);
  });

  it('picks a random card when the drawer runs out of time', () => {
    const t = timer(start().state);
    expect(t.state.phase).toBe('DRAWING');
    expect(start().state.options).toContain(t.state.wordIndex);
  });

  it('only the drawer may choose, only while choosing', () => {
    const s = start().state;
    expect(game.validateAction(s, 1, { type: 'CHOOSE', option: 0 })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(game.validateAction(drawing(), 0, { type: 'CHOOSE', option: 0 })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });

  it('runs every player once per round, then ends after the last round', () => {
    let s = start(SEATS, 5, 2).state;
    const drawers: number[] = [];
    while (s.phase !== 'OVER') {
      if (s.phase === 'CHOOSING') drawers.push(s.drawer);
      s = timer(s).state;
    }
    expect(drawers).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(game.getResults(s).placements).toHaveLength(4);
  });
});

describe('custom word packs', () => {
  it('start over when a small pack runs out', () => {
    const pack: WordEntry[] = ['kite', 'sun', 'umbrella', 'fish'].map((word) => ({
      word,
      aliases: [],
      difficulty: 'easy',
    }));
    const g = createDrawAndGuessGame({ pack });
    let s = g.setup([0, 1, 2], { rounds: 3 }, ctx(0)).state;
    const words: string[] = [];
    while (s.phase !== 'OVER') {
      if (s.phase === 'CHOOSING') expect(s.options).toHaveLength(3);
      s = g.onTimer(s, 'phase', ctx(s.phaseEndsAt)).state;
      if (s.phase === 'DRAWING') words.push((pack[s.wordIndex as number] as WordEntry).word);
    }
    expect(words).toHaveLength(9);
  });
});

describe('hints', () => {
  it('schedules hints at 50 % and 75 % within the cap', () => {
    const long = choose(
      { ...start().state, options: [WORD_PACK.findIndex((e) => e.word === 'watermelon')] },
      0,
    );
    expect(long.timers).toEqual(
      expect.arrayContaining([
        { set: 'hint1', ms: 30_000 },
        { set: 'hint2', ms: 45_000 },
      ]),
    );
    const short = choose(
      { ...start().state, options: [WORD_PACK.findIndex((e) => e.word === 'cat')] },
      0,
    );
    expect(short.timers).toContainEqual({ set: 'hint1', ms: 30_000 });
    expect(short.timers).not.toContainEqual({ set: 'hint2', ms: 45_000 });
  });

  it('reveals a hidden letter publicly, never beyond the cap', () => {
    let s = drawingWord('watermelon');
    const h1 = timer(s, 'hint1', s.phaseEndsAt - 30_000);
    expect(h1.events).toHaveLength(1);
    expect(h1.events[0]?.to).toBe('ALL');
    s = h1.state;
    s = timer(s, 'hint2', s.phaseEndsAt - 15_000).state;
    expect(s.revealed).toHaveLength(2);
    expect(timer(s, 'hint2').events).toEqual([]);
    expect(s.revealed.length).toBeLessThanOrEqual(hintCap('watermelon'));
    expect(game.getPlayerView(s, 1).pattern.replace(/_/g, '')).toHaveLength(2);
  });
});

describe('guessing through the chat hook', () => {
  it('consumes a correct guess: private Correct!, public "guessed it", never the word', () => {
    const s = drawingWord('ice cream');
    const d = chat(s, 2, 'is it ICE-CREAM?');
    expect(d.kind).toBe('CONSUME');
    if (d.kind !== 'CONSUME') return;
    const t = d.transition as T;
    expect(eventsForSeat(t.events, 2)).toContainEqual({
      type: 'YOU_GUESSED',
      word: 'ice cream',
      points: 100,
    });
    expect(eventsForSeat(t.events, 1)).toEqual([{ type: 'GUESSED', seat: 2, order: 1 }]);
    expect(JSON.stringify(eventsForSeat(t.events, 1))).not.toContain('ice cream');
    expect(game.getPlayerView(t.state, 2).word).toBe('ice cream');
    expect(game.getPlayerView(t.state, 1).word).toBeNull();
  });

  it('tells only the sender about a close guess', () => {
    const s = drawingWord('watermelon');
    const d = chat(s, 1, 'watermelom');
    expect(d.kind).toBe('CONSUME');
    if (d.kind !== 'CONSUME') return;
    const t = d.transition as T;
    expect(t.events).toEqual([
      { to: 'SEATS', seats: [1], event: { type: 'CLOSE', guess: 'watermelom' } },
    ]);
  });

  it('blocks the drawer, restricts solved players to the SOLVED lane, records wrong guesses', () => {
    let s = drawingWord('kite');
    expect(chat(s, 0, 'hello')).toEqual({ kind: 'BLOCK', code: 'CHAT_BLOCKED' });
    const solved = chat(s, 1, 'kite');
    if (solved.kind !== 'CONSUME') throw new Error('expected consume');
    s = (solved.transition as T).state;
    expect(chat(s, 1, 'nice drawing')).toEqual({
      kind: 'RESTRICT',
      audience: { to: 'SEATS', seats: [0, 1] },
      channel: 'SOLVED',
    });
    const wrong = chat(s, 2, 'Bird!');
    expect(wrong.kind).toBe('PASS');
    expect(wrong.kind === 'PASS' && (wrong.transition?.state as DrawState).wrong).toEqual(['bird']);
    expect(chat(start().state, 1, 'kite')).toEqual({ kind: 'PASS' }); // not drawing: normal chat
  });

  it('scores 100/80/65… by order, 20 per guesser to the drawer, and ends early when all guessed', () => {
    let s = drawingWord('kite');
    for (const seat of [3, 1]) {
      const d = chat(s, seat, 'kite');
      if (d.kind !== 'CONSUME') throw new Error('expected consume');
      s = (d.transition as T).state;
    }
    expect(s.phase).toBe('DRAWING');
    const last = chat(s, 2, 'kite');
    if (last.kind !== 'CONSUME') throw new Error('expected consume');
    const t = last.transition as T;
    expect(t.state.phase).toBe('REVEAL');
    const reveal = t.events.find((e) => e.event.type === 'REVEAL')?.event;
    expect(reveal).toMatchObject({
      type: 'REVEAL',
      result: { word: 'kite', deltas: { 3: 100, 1: 80, 2: 65, 0: 60 } },
    });
    expect(t.state.scores).toEqual({ 0: 60, 1: 80, 2: 65, 3: 100 });
  });
});

describe('the drawing stream', () => {
  const accept = (s: DrawState, seat: number, op: Op) => game.stream!.accept(s, seat, op);

  it('accepts the drawer’s ops while drawing and relays them to everyone else, tagged with the turn', () => {
    const s = drawing();
    const out = accept(s, 0, stroke(1));
    expect('state' in out).toBe(true);
    if (!('state' in out)) return;
    expect(out.audience).toEqual({ to: 'ALL_EXCEPT', seats: [0] });
    expect(out.relay).toEqual({ ...stroke(1), turn: s.turn });
    expect(out.state.ops).toEqual([stroke(1)]);
    expect(game.stream!.replay(out.state, 2)).toEqual([{ ...stroke(1), turn: s.turn }]);
    expect(game.getPlayerView(out.state, 2).strokes).toBe(1);
  });

  it('rejects other seats, other phases, odd or out-of-range points and over-limit turns', () => {
    const s = drawing();
    expect(accept(s, 1, stroke(1))).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(accept(start().state, 0, stroke(1))).toEqual({ ok: false, code: 'INVALID_PHASE' });
    expect(accept(s, 0, stroke(1, [1, 2, 3]))).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(accept(s, 0, stroke(1, [10, 3072]))).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect(game.stream!.chunkSchema.safeParse({ ...stroke(1), colour: 12 }).success).toBe(false);
    expect(
      game.stream!.chunkSchema.safeParse({ ...stroke(1), points: Array(130).fill(1) }).success,
    ).toBe(false);
    const full = deepFreeze({ ...s, strokeIds: Array.from({ length: 1000 }, (_, i) => i) });
    expect(accept(full, 0, stroke(5000))).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
    expect('state' in accept(full, 0, stroke(5))).toBe(true); // continuing an existing stroke is fine
    const points = deepFreeze({ ...s, pointCount: 19_999 });
    expect(accept(points, 0, stroke(1))).toEqual({ ok: false, code: 'ILLEGAL_ACTION' });
  });

  it('keeps the drawing through the reveal and clears it for the next turn', () => {
    const s = drawing();
    const out = accept(s, 0, { op: 'clear' });
    if (!('state' in out)) throw new Error('expected accept');
    const reveal = timer(out.state).state;
    expect(game.stream!.replay(reveal, 1)).toHaveLength(1);
    const next = timer(reveal).state;
    expect(next.phase).toBe('CHOOSING');
    expect(game.stream!.replay(next, 1)).toEqual([]);
  });
});

describe('idle drawers, leaving and reclaiming', () => {
  it('asks for a bot after 2 consecutive own turns without a stroke', () => {
    const s = start([0, 1, 2], 4, 3).state;
    let state = s;
    const requests: unknown[] = [];
    while (state.phase !== 'OVER') {
      const t = timer(state);
      requests.push(...(t.requests ?? []));
      state = t.state;
    }
    // Each seat drew 3 empty turns: one MARK_IDLE each, on their 2nd.
    expect(requests).toEqual([
      { type: 'MARK_IDLE', seat: 0 },
      { type: 'MARK_IDLE', seat: 1 },
      { type: 'MARK_IDLE', seat: 2 },
    ]);
  });

  it('ends the turn when the drawer’s seat is taken over mid-drawing', () => {
    const t = game.onSeatChange(drawing(), 0, 'BOT_TOOK_OVER', ctx(20_000));
    expect(t.state.phase).toBe('REVEAL');
    expect(game.onSeatChange(drawing(), 1, 'BOT_TOOK_OVER', ctx(20_000)).state.phase).toBe(
      'DRAWING',
    );
  });

  it('lets a drawer reclaim only after their turn (next phase boundary)', () => {
    const s = drawing();
    expect(game.canReclaimSeat!(s, 0)).toBe(false);
    expect(game.canReclaimSeat!(s, 1)).toBe(true);
    expect(game.canReclaimSeat!(timer(s).state, 0)).toBe(true);
  });
});

describe('bots', () => {
  it('choose a card they can draw and draw its template', () => {
    const s = start().state;
    const view = game.getPlayerView(s, 0);
    const d = game.bot.decide(view, null, { seat: 0, now: 0, rng: createRng(1) });
    expect(d?.kind).toBe('ACTION');
    const option = d?.kind === 'ACTION' ? d.action.option : -1;
    expect(view.options[option]?.drawable).toBe(true);
    const after = choose(s, option).state;
    const plan = game.bot.decide(game.getPlayerView(after, 0), null, {
      seat: 0,
      now: 0,
      rng: createRng(1),
    });
    expect(plan?.kind).toBe('STREAM');
    expect(TEMPLATES[wordOf(after)]).toBeDefined();
  });

  it('guess only words that fit the public pattern and were not already tried', () => {
    let s = drawingWord('kite');
    const wrong = chat(s, 2, 'bell');
    if (wrong.kind !== 'PASS' || !wrong.transition) throw new Error('expected recorded pass');
    s = wrong.transition.state as DrawState;
    for (let seed = 0; seed < 40; seed++) {
      const d = game.bot.decide(game.getPlayerView(s, 1), null, {
        seat: 1,
        now: 0,
        rng: createRng(seed),
      });
      expect(d?.kind).toBe('CHAT');
      const text = d?.kind === 'CHAT' ? d.text : '';
      expect(text).toHaveLength(4);
      expect(text).not.toBe('bell');
    }
  });
});

/**
 * Plays whole matches with bots in every seat on a virtual clock — actions, chat
 * guesses through the hook and drawing plans through the stream — checking
 * that no guesser ever receives the word before the reveal, in events or views
 * (including states where some players have already guessed it).
 */
function playBotMatch(seed: number, seats: number[]) {
  const g = createDrawAndGuessGame({ botDrawMs: [4000, 8000] });
  const rng = createRng(seed);
  const botRng = createRng(seed ^ 0x9e3779b9);
  let now = 1_000_000;
  const leakRng = createRng(seed ^ 0x5bd1e995);
  let state!: DrawState;
  const timers = new Map<string, number>();
  const plans = new Map<number, { at: number; chunk: unknown }[]>();
  let correct = 0;
  const apply = (t: T) => {
    for (const seat of seats) {
      const solved = t.state.guessed.some((x) => x.seat === seat);
      const word =
        t.state.wordIndex === null ? null : (WORD_PACK[t.state.wordIndex] as WordEntry).word;
      for (const e of eventsForSeat(t.events, seat)) {
        if (
          word &&
          seat !== t.state.drawer &&
          !solved &&
          e.type !== 'REVEAL' &&
          e.type !== 'MATCH_OVER'
        ) {
          expect(JSON.stringify(e)).not.toContain(`"${word}"`);
        }
      }
    }
    correct += t.events.filter((e) => e.event.type === 'GUESSED').length;
    state = deepFreeze(t.state);
    for (const seat of seats) assertNoViewLeak(g, state, seat, perturbDrawHidden, leakRng);
    for (const cmd of t.timers ?? []) {
      if ('set' in cmd) timers.set(cmd.set, now + cmd.ms);
      else timers.delete(cmd.clear);
    }
    if (state.phase !== 'DRAWING') plans.clear();
    const total = Object.values(state.scores).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(0);
  };
  apply(g.setup(seats, { rounds: 1 }, { now, rng }));
  for (let step = 0; step < 20_000 && state.phase !== 'OVER'; step++) {
    type Next = { at: number; run: () => void };
    const options: Next[] = [];
    for (const seat of seats) {
      if (plans.get(seat)?.length) continue;
      const d = g.bot.decide(g.getPlayerView(state, seat), null, { seat, now, rng: botRng });
      if (!d) continue;
      options.push({
        at: now + d.thinkMs,
        run: () => {
          if (d.kind === 'ACTION') {
            if (g.validateAction(state, seat, d.action).ok)
              apply(g.applyAction(state, seat, d.action, { now, rng }));
          } else if (d.kind === 'CHAT') {
            const decision = g.chat!.intercept(state, seat, normalizeGuess(d.text), { now, rng });
            if (decision.kind === 'CONSUME') apply(decision.transition as T);
            if (decision.kind === 'PASS' && decision.transition) apply(decision.transition as T);
          } else {
            let at = now;
            plans.set(
              seat,
              d.steps.map((st) => ({ at: (at += st.delayMs), chunk: st.chunk })),
            );
          }
        },
      });
    }
    for (const [seat, plan] of plans) {
      const next = plan[0];
      if (next) {
        options.push({
          at: next.at,
          run: () => {
            plan.shift();
            const out = g.stream!.accept(state, seat, next.chunk);
            if ('state' in out) state = out.state;
            else plans.delete(seat);
          },
        });
      }
    }
    for (const [id, at] of timers) {
      options.push({
        at,
        run: () => {
          timers.delete(id);
          apply(g.onTimer(state, id, { now, rng }));
        },
      });
    }
    options.sort((a, b) => a.at - b.at);
    const next = options[0];
    if (!next) throw new Error('stalled');
    now = Math.max(now, next.at);
    next.run();
  }
  return { state, correct };
}

describe('fuzzing and hidden information', () => {
  it('plays seeded all-bot matches to the end without leaking the word', () => {
    let totalCorrect = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const seats = [0, 1, 2, 3, 4, 5].slice(0, 3 + (seed % 4));
      const { state, correct } = playBotMatch(seed, seats);
      expect(state.phase).toBe('OVER');
      expect(game.getResults(state).placements).toHaveLength(seats.length);
      totalCorrect += correct;
    }
    expect(totalCorrect).toBeGreaterThan(0); // bots do guess right sometimes
  });

  it('never lets a guesser’s view depend on the word (leak checker)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      simulateMatch<DrawState, DrawEvent>(game, {
        seats: 3 + (seed % 4),
        seed,
        settings: { rounds: 1 },
        perturbHidden: perturbDrawHidden,
      });
    }
  });
});
