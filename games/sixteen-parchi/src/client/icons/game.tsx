const OUT = '#07041a';

/** Game icon: a fan of folded paper slips. */
export function ParchiIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g stroke={OUT} strokeWidth={2.5} strokeLinejoin="round">
        <rect
          x={7}
          y={12}
          width={18}
          height={26}
          rx={3}
          fill="#9b7bff"
          transform="rotate(-16 16 25)"
        />
        <rect
          x={23}
          y={12}
          width={18}
          height={26}
          rx={3}
          fill="#2de2e6"
          transform="rotate(14 32 25)"
        />
        <rect x={15} y={9} width={18} height={28} rx={3} fill="#fff7e3" />
        <path d="M15 23h18" strokeDasharray="2 3" />
      </g>
      <text
        x={24}
        y={20}
        textAnchor="middle"
        fontFamily="'Baloo 2 Variable', sans-serif"
        fontWeight={800}
        fontSize={10}
        fill="#ff3e8a"
      >
        16
      </text>
    </svg>
  );
}

const MEDAL_COLOURS: Record<number, [string, string]> = {
  1: ['#ffd23f', '#e39b00'],
  2: ['#dfe3f2', '#9aa0b5'],
  3: ['#ff9d5c', '#c4621e'],
  4: ['#b9afe8', '#6b5fa3'],
};

/** A placement medal with its number. */
export function Medal({ place, size = 34 }: { place: number; size?: number }) {
  const [face, rim] = MEDAL_COLOURS[place] ?? (MEDAL_COLOURS[4] as [string, string]);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <g stroke={OUT} strokeWidth={2.5} strokeLinejoin="round">
        <path d="M12 2h7l3 12h-7zM28 2h-7l-3 12h7z" fill="#ff3e8a" />
        <circle cx={20} cy={25} r={12} fill={face} />
        <circle cx={20} cy={25} r={8.5} fill="none" stroke={rim} strokeWidth={2} />
      </g>
      <text
        x={20}
        y={30}
        textAnchor="middle"
        fontFamily="'Baloo 2 Variable', sans-serif"
        fontWeight={800}
        fontSize={14}
        fill={OUT}
      >
        {place}
      </text>
    </svg>
  );
}
