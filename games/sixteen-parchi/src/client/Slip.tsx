import { accentVar, durationFor, useEffects } from '@cg/ui';
import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { ITEM_LABELS } from '../../content/en';
import { itemDef } from '../shared/categories';
import { ItemIcon } from './icons/items';

export type SlipSize = 'hand' | 'mini';

/**
 * A paper slip (parchi). Open: item icon + label on notebook paper with a
 * crease. Folded: flipped shut along the crease (3D in full, quick in lite,
 * instant in reduced). `item = null` is a slip you may not see inside.
 */
export function Slip({
  item,
  folded,
  size,
  glow = false,
  unfoldAfterMs,
}: {
  item: string | null;
  folded: boolean;
  size: SlipSize;
  glow?: boolean;
  /** Arrives folded and opens after this delay (a received slip). */
  unfoldAfterMs?: number;
}) {
  const mode = useEffects();
  const accent = item ? itemDef(item)?.accent : undefined;
  const style = (accent ? { '--slip-accent': accentVar(accent) } : {}) as CSSProperties;
  const showBack = folded || item === null;
  return (
    <span
      className={`sp-slip sp-slip--${size}${glow ? ' is-glow' : ''}`}
      style={style}
      data-folded={showBack}
    >
      <motion.span
        className="sp-slip__inner"
        initial={unfoldAfterMs !== undefined && mode !== 'reduced' ? { rotateX: 180 } : false}
        animate={{ rotateX: showBack ? 180 : 0 }}
        transition={{
          duration: durationFor(mode, 380, 180) / 1000,
          delay: (unfoldAfterMs ?? 0) / 1000,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <span className="sp-slip__face sp-slip__front">
          {item && (
            <>
              <ItemIcon item={item} size={size === 'hand' ? 44 : 22} />
              {size === 'hand' && (
                <span className="sp-slip__label">{ITEM_LABELS[item] ?? item}</span>
              )}
            </>
          )}
        </span>
        <span className="sp-slip__face sp-slip__back" aria-hidden="true" />
      </motion.span>
    </span>
  );
}
