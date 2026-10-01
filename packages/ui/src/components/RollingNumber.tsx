import { animate } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { durationFor, useEffects } from '../effects';

const format = (n: number) => Math.round(n).toLocaleString('en-IN');

/** A number that rolls from its previous value to the new one (instant in reduced mode). */
export function RollingNumber({
  value,
  durationMs = 900,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const mode = useEffects();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current;
    const from = shown.current;
    shown.current = value;
    if (!el) return;
    const ms = durationFor(mode, durationMs);
    if (ms === 0 || from === value) {
      el.textContent = format(value);
      return;
    }
    el.textContent = format(from);
    const controls = animate(from, value, {
      duration: ms / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, mode, durationMs]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
