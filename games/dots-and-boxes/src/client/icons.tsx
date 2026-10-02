const OUT = '#07041a';

/** Game icon: a corner of squared paper — dots, two marker lines and a claimed box. */
export function DotsIcon({ size = 40 }: { size?: number }) {
  const dots = [10, 24, 38];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect
        x={3}
        y={3}
        width={42}
        height={42}
        rx={7}
        fill="#fdfcff"
        stroke={OUT}
        strokeWidth={2.5}
      />
      <rect x={10} y={10} width={14} height={14} fill="#ff3e8a" opacity={0.35} />
      <g strokeLinecap="round" strokeWidth={3.5}>
        <path d="M10 10h14v14H10z" fill="none" stroke="#d1105a" />
        <path d="M24 24h14" stroke="#0e9aa7" />
        <path d="M38 24v14" stroke="#0e9aa7" />
      </g>
      {dots.map((x) =>
        dots.map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.6} fill={OUT} />),
      )}
    </svg>
  );
}
