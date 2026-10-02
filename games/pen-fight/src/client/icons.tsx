const OUT = '#07041a';

/** Game icon: two crossed ballpoint pens with a spark. */
export function PenFightIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g stroke={OUT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">
        <g transform="rotate(-38 24 24)">
          <rect x={6} y={20} width={30} height={7} rx={3.5} fill="#4c8dff" />
          <path d="M36 20l7 3.5-7 3.5z" fill="#fff7e3" />
          <rect x={6} y={20} width={7} height={7} rx={2} fill="#ff3e8a" />
        </g>
        <g transform="rotate(38 24 24)">
          <rect x={6} y={20} width={30} height={7} rx={3.5} fill="#ffd23f" />
          <path d="M36 20l7 3.5-7 3.5z" fill="#fff7e3" />
          <rect x={6} y={20} width={7} height={7} rx={2} fill="#3ec46d" />
        </g>
        <path d="M24 4l2 5 5-2-3 5 5 2-6 1" fill="#ff8a3d" strokeWidth={2} />
      </g>
    </svg>
  );
}

/** The winner's crown. */
export function CrownIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M4 24l2-14 6 6 4-9 4 9 6-6 2 14z"
        fill="#ffd23f"
        stroke={OUT}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
