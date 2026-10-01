import type { Accent } from '@cg/game-sdk/client';
import type { CSSProperties } from 'react';
import { accentVar } from '../colors';

export interface AvatarProps {
  name: string;
  accent: Accent;
  size?: number;
  /** When set, shows a small bot tag with this (translated) label. */
  botLabel?: string;
}

/** Round sticker avatar showing the player's initial. */
export function Avatar({ name, accent, size = 44, botLabel }: AvatarProps) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.48),
    '--avatar-bg': accentVar(accent),
  } as CSSProperties;
  return (
    <span className="cb-avatar" style={style} aria-hidden="true">
      {initial}
      {botLabel && <span className="cb-avatar__bot">{botLabel}</span>}
    </span>
  );
}
