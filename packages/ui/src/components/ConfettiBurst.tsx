import { createRng } from '@cg/game-sdk';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { useEffects } from '../effects';

const COLORS = [
  'var(--cb-pink)',
  'var(--cb-yellow)',
  'var(--cb-cyan)',
  'var(--cb-lime)',
  'var(--cb-orange)',
  'var(--cb-violet)',
];

/**
 * A burst of paper confetti. Full: `count` pieces; lite: a third; reduced: none.
 * Change `burstKey` to fire again. Deterministic per key (no Math.random in render).
 */
export function ConfettiBurst({ burstKey = 1, count = 40 }: { burstKey?: number; count?: number }) {
  const mode = useEffects();
  const n = mode === 'full' ? count : mode === 'lite' ? Math.round(count / 3) : 0;
  const pieces = useMemo(() => {
    const rng = createRng(burstKey * 7919 + n);
    return Array.from({ length: n }, (_, i) => {
      const angle = rng.next() * Math.PI * 2;
      const distance = 120 + rng.next() * 220;
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance * 0.7 - 80,
        rotate: rng.int(-540, 540),
        color: COLORS[i % COLORS.length] as string,
        delay: rng.next() * 0.15,
      };
    });
  }, [burstKey, n]);

  if (n === 0) return null;
  return (
    <div className="cb-confetti" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={`${burstKey}-${p.id}`}
          className="cb-confetti__piece"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{
            x: p.x,
            y: [0, p.y, p.y + 320],
            opacity: [1, 1, 0],
            rotate: p.rotate,
            scale: 1,
          }}
          transition={{ duration: 1.9, delay: p.delay, ease: 'easeOut', times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  );
}
