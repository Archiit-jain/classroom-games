import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { durationFor, useEffects } from '../effects';

export interface PaperChitProps {
  /** Face-up shows `children`; face-down shows a folded paper back. */
  faceUp: boolean;
  width?: number;
  height?: number;
  /** Slight hand-placed tilt in degrees. */
  tilt?: number;
  /** Accessible description of what the chit currently shows. */
  label: string;
  children?: ReactNode;
}

/**
 * The folded paper chit of classroom games. Flips in 3D (full), quickly
 * (lite) or instantly (reduced). Shared by RMCS and, later, 16 Parchi.
 */
export function PaperChit({
  faceUp,
  width = 64,
  height = 84,
  tilt = 0,
  label,
  children,
}: PaperChitProps) {
  const mode = useEffects();
  const ms = durationFor(mode, 620, 280);
  return (
    <div
      className="cb-chit"
      style={{ width, height, rotate: `${tilt}deg` }}
      role="img"
      aria-label={label}
    >
      <motion.div
        className="cb-chit__inner"
        initial={false}
        animate={{ rotateY: faceUp ? 180 : 0 }}
        transition={{ duration: ms / 1000, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="cb-chit__face cb-chit__back">
          <span aria-hidden="true">?</span>
        </div>
        <div className="cb-chit__face cb-chit__front">{children}</div>
      </motion.div>
    </div>
  );
}
