import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffects } from '../effects';

/** A rubber-stamp verdict that thumps onto the table ("CHOR CAUGHT!"). */
export function Stamp({
  tone = 'success',
  delayMs = 0,
  children,
}: {
  tone?: 'success' | 'danger';
  delayMs?: number;
  children: ReactNode;
}) {
  const mode = useEffects();
  const style = {
    '--stamp-color': tone === 'success' ? 'var(--color-success)' : 'var(--cb-pink)',
  } as CSSProperties;
  if (mode === 'reduced') {
    return (
      <span className="cb-stamp" style={{ ...style, transform: 'rotate(-8deg)' }}>
        {children}
      </span>
    );
  }
  return (
    <motion.span
      className="cb-stamp"
      style={style}
      initial={{ scale: mode === 'full' ? 2.6 : 1.3, opacity: 0, rotate: -26 }}
      animate={{ scale: 1, opacity: 1, rotate: -8 }}
      transition={{
        type: 'spring',
        stiffness: 460,
        damping: mode === 'full' ? 15 : 30,
        delay: delayMs / 1000,
      }}
    >
      {children}
    </motion.span>
  );
}
