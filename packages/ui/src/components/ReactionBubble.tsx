import type { BoardReaction } from '@cg/game-sdk/client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffects } from '../effects';

/**
 * A quick-reaction speech bubble for a seat. Pops in when a new reaction
 * arrives (a new `key`) and floats away when the platform removes it.
 * Full: springy pop; lite: short fade/scale; reduced: appears and disappears.
 */
export function ReactionBubble({ reaction }: { reaction: BoardReaction | undefined }) {
  const mode = useEffects();
  const enter =
    mode === 'reduced'
      ? { initial: false as const, exit: { opacity: 0, transition: { duration: 0 } } }
      : {
          initial: { opacity: 0, scale: 0.3, y: 12 },
          exit: { opacity: 0, y: -14, scale: 0.9 },
          transition:
            mode === 'full'
              ? { type: 'spring' as const, stiffness: 520, damping: 16 }
              : { duration: 0.16 },
        };
  return (
    <span className="cb-reaction">
      <AnimatePresence>
        {reaction && (
          <motion.span
            key={reaction.key}
            className="cb-reaction__bubble"
            role="img"
            aria-label={reaction.label}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            {...enter}
          >
            {reaction.emoji}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
