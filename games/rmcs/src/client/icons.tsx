import type { Role } from '../shared/types';

/** Original, simple SVG role icons (no third-party artwork). */

interface IconProps {
  size?: number;
}

const stroke = { stroke: 'var(--cb-outline)', strokeWidth: 1.6, strokeLinejoin: 'round' as const };

export function CrownIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 8.5l4.2 3.6L12 4.5l4.8 7.6L21 8.5l-1.6 9.3H4.6z"
        fill="var(--cb-yellow)"
        {...stroke}
      />
      <rect
        x="4.4"
        y="17.8"
        width="15.2"
        height="2.8"
        rx="1"
        fill="var(--cb-yellow-deep)"
        {...stroke}
      />
      <circle cx="12" cy="4.2" r="1.3" fill="var(--cb-pink)" {...stroke} />
      <circle cx="3" cy="8.3" r="1.1" fill="var(--cb-cyan)" {...stroke} />
      <circle cx="21" cy="8.3" r="1.1" fill="var(--cb-cyan)" {...stroke} />
    </svg>
  );
}

export function ScrollIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" fill="var(--cb-paper)" {...stroke} />
      <rect x="3" y="3" width="18" height="3.4" rx="1.7" fill="var(--cb-cyan)" {...stroke} />
      <rect x="3" y="17.6" width="18" height="3.4" rx="1.7" fill="var(--cb-cyan)" {...stroke} />
      <path
        d="M8 9.5h8M8 12.2h8M8 14.9h5"
        stroke="var(--cb-pencil)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ShieldIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5l8 3v6.2c0 4.9-3.4 8.4-8 10.3-4.6-1.9-8-5.4-8-10.3V5.5z"
        fill="var(--cb-lime)"
        {...stroke}
      />
      <path
        d="M12 6.2v12M7.6 10.4h8.8"
        stroke="var(--cb-outline)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MaskIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 10c2.5-2.8 6-2.6 9.5-.6 3.5-2 7-2.2 9.5.6-.4 3.6-2.6 5.6-5.4 5.6-2 0-3-1.3-4.1-1.3S10 15.6 7.9 15.6C5.1 15.6 2.9 13.6 2.5 10z"
        fill="var(--cb-pink)"
        {...stroke}
      />
      <ellipse cx="7.8" cy="11.6" rx="2" ry="1.3" fill="var(--cb-outline)" />
      <ellipse cx="16.2" cy="11.6" rx="2" ry="1.3" fill="var(--cb-outline)" />
    </svg>
  );
}

/** A chunky arrow pointing down at the accused player. */
export function PointerIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 2.5h6v9.5h4.5L12 21.5 4.5 12H9z" fill="var(--cb-yellow)" {...stroke} />
    </svg>
  );
}

export function RoleIcon({ role, size }: { role: Role; size?: number }) {
  switch (role) {
    case 'RAJA':
      return <CrownIcon size={size} />;
    case 'MANTRI':
      return <ScrollIcon size={size} />;
    case 'SIPAHI':
      return <ShieldIcon size={size} />;
    case 'CHOR':
      return <MaskIcon size={size} />;
  }
}

export const ROLE_ACCENT: Record<Role, string> = {
  RAJA: 'var(--cb-yellow)',
  MANTRI: 'var(--cb-cyan)',
  SIPAHI: 'var(--cb-lime)',
  CHOR: 'var(--cb-pink)',
};
