import type { ReactNode } from 'react';

/*
 * Original item icons for the category pack — drawn for this project (no
 * third-party art, no brands or logos). Flat fills with the Color Burst Arcade
 * outline. Each icon is a 48 × 48 drawing.
 */

const OUT = '#07041a';
const C = {
  yellow: '#ffd23f',
  gold: '#f4b43a',
  orange: '#ff8a3d',
  red: '#ff4d6a',
  pink: '#ff7eb6',
  green: '#3ec46d',
  lime: '#9cf04a',
  cyan: '#2de2e6',
  blue: '#4c8dff',
  violet: '#9b7bff',
  deepViolet: '#6440ea',
  brown: '#a0622d',
  tan: '#e7b77a',
  paper: '#fff7e3',
  grey: '#a9aec4',
  white: '#ffffff',
  ink: '#1f1647',
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <g stroke={OUT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">
      {children}
    </g>
  );
}

const Dot = ({ x, y, r = 1.8 }: { x: number; y: number; r?: number }) => (
  <circle cx={x} cy={y} r={r} fill={OUT} stroke="none" />
);

/** A semicircle spiral (radius grows 2.6 per half-turn), like a jalebi. */
const JALEBI =
  'M21.4 24a2.6 2.6 0 0 1 5.2 0a5.2 5.2 0 0 1-10.4 0a7.8 7.8 0 0 1 15.6 0a10.4 10.4 0 0 1-20.8 0a13 13 0 0 1 26 0';

const DRAWINGS: Record<string, ReactNode> = {
  // ── Fruits ──
  mango: (
    <Svg>
      <path
        d="M12 31c-3-10 5-20 15-19 8 1 11 9 8 17-3 9-13 13-18 11-3-1-4-5-5-9z"
        fill={C.orange}
      />
      <path d="M27 13c1-5 6-7 11-6-1 5-6 7-11 6z" fill={C.green} />
      <path d="M16 27c0-5 3-9 7-10" fill="none" stroke={C.paper} strokeWidth={2} />
    </Svg>
  ),
  banana: (
    <Svg>
      <path d="M9 13c2 14 13 23 29 22 3 0 4-3 1-4-12-1-20-8-24-19-1-3-6-3-6 1z" fill={C.yellow} />
      <path d="M10 12l-2-5" fill="none" />
      <path d="M38 35l3 1" fill="none" />
    </Svg>
  ),
  apple: (
    <Svg>
      <path
        d="M24 16c-4-3-13-3-15 5-2 10 4 20 10 20 2 0 3-1 5-1s3 1 5 1c6 0 12-10 10-20-2-8-11-8-15-5z"
        fill={C.red}
      />
      <path d="M24 16c0-4 1-7 3-9" fill="none" />
      <path d="M26 12c3-4 8-4 10-2-3 3-7 4-10 2z" fill={C.green} />
      <path d="M14 23c1-3 3-4 5-4" fill="none" stroke={C.paper} strokeWidth={2} />
    </Svg>
  ),
  grapes: (
    <Svg>
      <path d="M24 13c0-3 1-5 3-7" fill="none" />
      <path d="M26 10c3-3 8-3 10 0-3 2-7 3-10 0z" fill={C.green} />
      {[
        [17, 18],
        [26, 17],
        [35, 18],
        [21, 26],
        [30, 26],
        [25, 34],
        [16, 32],
        [34, 33],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={(y as number) + 1} r={5.2} fill={C.violet} />
      ))}
    </Svg>
  ),

  // ── Animals ──
  lion: (
    <Svg>
      <path
        d="M24 5l5 4 6-1 2 6 6 3-2 6 3 5-5 3v6l-6 1-3 5-6-2-6 2-3-5-6-1v-6l-5-3 3-5-2-6 6-3 2-6 6 1z"
        fill={C.orange}
      />
      <circle cx={24} cy={26} r={11} fill={C.yellow} />
      <Dot x={20} y={24} />
      <Dot x={28} y={24} />
      <path d="M22 29h4l-2 2.5z" fill={OUT} />
      <path d="M21 33c2 1.5 4 1.5 6 0" fill="none" />
    </Svg>
  ),
  elephant: (
    <Svg>
      <path d="M13 13c-8 0-10 14-2 18l5 1z" fill={C.violet} />
      <path d="M35 13c8 0 10 14 2 18l-5 1z" fill={C.violet} />
      <path d="M14 22c0-8 5-13 10-13s10 5 10 13c0 5-3 8-6 9v6c0 4-4 5-6 3" fill={C.grey} />
      <path d="M14 22c0 5 3 8 6 9" fill="none" />
      <Dot x={19} y={21} />
      <Dot x={29} y={21} />
    </Svg>
  ),
  monkey: (
    <Svg>
      <circle cx={10} cy={24} r={6} fill={C.tan} />
      <circle cx={38} cy={24} r={6} fill={C.tan} />
      <circle cx={24} cy={24} r={15} fill={C.brown} />
      <path d="M13 27c0-5 5-6 11-3 6-3 11-2 11 3 0 7-5 11-11 11s-11-4-11-11z" fill={C.tan} />
      <Dot x={19} y={21} />
      <Dot x={29} y={21} />
      <path d="M19 31c3 2 7 2 10 0" fill="none" />
    </Svg>
  ),
  peacock: (
    <Svg>
      {[-60, -30, 0, 30, 60].map((angle) => (
        <g key={angle} transform={`rotate(${angle} 24 38)`}>
          <ellipse cx={24} cy={17} rx={5} ry={12} fill={C.green} />
          <circle cx={24} cy={10} r={3} fill={C.cyan} />
          <Dot x={24} y={10} r={1.4} />
        </g>
      ))}
      <path d="M24 44c-5 0-6-6-4-12 1-4 1-8 4-8s3 4 4 8c2 6 1 12-4 12z" fill={C.blue} />
      <Dot x={24} y={28} r={1.3} />
    </Svg>
  ),

  // ── Sports ──
  cricket: (
    <Svg>
      <path d="M9 39l17-24 6 4-17 24c-2 2-4 2-6 0z" fill={C.tan} />
      <path d="M26 15l5-7 4 3-5 6z" fill={C.brown} />
      <circle cx={34} cy={34} r={7} fill={C.red} />
      <path
        d="M29 30c3 2 5 5 6 9"
        fill="none"
        stroke={C.paper}
        strokeWidth={1.6}
        strokeDasharray="1.5 2"
      />
    </Svg>
  ),
  football: (
    <Svg>
      <circle cx={24} cy={24} r={17} fill={C.white} />
      <path d="M24 17l6 4-2 7h-8l-2-7z" fill={C.ink} />
      <path d="M24 17V8M30 21l8-3M28 28l5 7M20 28l-5 7M18 21l-8-3" fill="none" />
    </Svg>
  ),
  badminton: (
    <Svg>
      <path d="M15 7l18 0-4 20h-10z" fill={C.white} />
      <path d="M21 7l1 20M27 7l-1 20M17 15h14" fill="none" strokeWidth={1.6} />
      <path d="M18 27h12v3c0 6-3 10-6 10s-6-4-6-10z" fill={C.cyan} />
    </Svg>
  ),
  chess: (
    <Svg>
      <circle cx={24} cy={12} r={5} fill={C.violet} />
      <path d="M18 19h12l-2 4h-8z" fill={C.violet} />
      <path d="M20 23h8c0 6 2 10 5 13H15c3-3 5-7 5-13z" fill={C.violet} />
      <rect x={12} y={36} width={24} height={6} rx={2} fill={C.deepViolet} />
    </Svg>
  ),

  // ── Street food ──
  samosa: (
    <Svg>
      <path d="M24 7L42 38c-10 4-26 4-36 0z" fill={C.gold} />
      <path d="M24 7l-6 33M24 7l6 33" fill="none" strokeWidth={1.8} />
      <Dot x={17} y={30} r={1.1} />
      <Dot x={31} y={28} r={1.1} />
      <Dot x={24} y={22} r={1.1} />
    </Svg>
  ),
  'pani-puri': (
    <Svg>
      <circle cx={17} cy={29} r={10} fill={C.tan} />
      <ellipse cx={17} cy={24} rx={5} ry={2.4} fill={C.lime} />
      <circle cx={32} cy={23} r={10} fill={C.tan} />
      <ellipse cx={32} cy={18} rx={5} ry={2.4} fill={C.lime} />
      <path d="M8 40h32" fill="none" />
    </Svg>
  ),
  jalebi: (
    <Svg>
      <path d={JALEBI} fill="none" strokeWidth={7} />
      <path d={JALEBI} fill="none" stroke={C.orange} strokeWidth={3.5} />
    </Svg>
  ),
  'vada-pav': (
    <Svg>
      <path d="M8 24c0-9 7-14 16-14s16 5 16 14z" fill={C.tan} />
      <path d="M7 24h34c0 3-1 5-3 6H10c-2-1-3-3-3-6z" fill={C.orange} />
      <path d="M10 30h28" fill="none" stroke={C.green} strokeWidth={3} />
      <path d="M9 32h30c0 5-4 8-15 8S9 37 9 32z" fill={C.tan} />
      <Dot x={18} y={16} r={0.9} />
      <Dot x={26} y={14} r={0.9} />
      <Dot x={31} y={18} r={0.9} />
    </Svg>
  ),

  // ── Vehicles ──
  'auto-rickshaw': (
    <Svg>
      <path d="M8 18c0-5 4-8 9-8h14c5 0 9 3 9 8v4H8z" fill={OUT} />
      <path d="M8 22h32v12H8z" fill={C.yellow} />
      <path d="M8 22h10v12H8z" fill={C.green} />
      <path d="M22 22h12v6H22z" fill={C.cyan} strokeWidth={2} />
      <circle cx={14} cy={36} r={4.5} fill={C.ink} />
      <circle cx={35} cy={36} r={4.5} fill={C.ink} />
    </Svg>
  ),
  bus: (
    <Svg>
      <rect x={5} y={11} width={38} height={24} rx={4} fill={C.red} />
      <path d="M9 15h7v7H9zM19 15h7v7h-7zM29 15h10v7H29z" fill={C.cyan} strokeWidth={2} />
      <path d="M5 27h38" fill="none" />
      <circle cx={14} cy={36} r={4} fill={C.ink} />
      <circle cx={34} cy={36} r={4} fill={C.ink} />
    </Svg>
  ),
  train: (
    <Svg>
      <path d="M12 12c0-4 3-6 7-6h10c4 0 7 2 7 6v22H12z" fill={C.blue} />
      <rect x={16} y={11} width={16} height={9} rx={2} fill={C.cyan} />
      <circle cx={17} cy={28} r={2.2} fill={C.yellow} />
      <circle cx={31} cy={28} r={2.2} fill={C.yellow} />
      <path d="M14 34l-4 8M34 34l4 8M12 39h24" fill="none" />
    </Svg>
  ),
  bicycle: (
    <Svg>
      <circle cx={12} cy={31} r={8} fill="none" />
      <circle cx={36} cy={31} r={8} fill="none" />
      <path
        d="M12 31l8-13h12l4 13M20 18l6 13 6-13M24 31h2"
        fill="none"
        stroke={C.lime}
        strokeWidth={3}
      />
      <path d="M17 15h6M30 13l2 5" fill="none" />
    </Svg>
  ),

  // ── Stationery ──
  pencil: (
    <Svg>
      <path d="M33 6l9 9-22 22-9-9z" fill={C.yellow} />
      <path d="M33 6l4-4 9 9-4 4z" fill={C.pink} />
      <path d="M11 28l9 9-12 4z" fill={C.tan} />
      <path d="M8 41l3-1-2-2z" fill={OUT} />
    </Svg>
  ),
  eraser: (
    <Svg>
      <path d="M6 30L26 10l16 16-20 20z" fill={C.pink} />
      <path d="M6 30l10-10 16 16-10 10z" fill={C.blue} />
    </Svg>
  ),
  sharpener: (
    <Svg>
      <rect x={10} y={14} width={28} height={22} rx={4} fill={C.cyan} />
      <path d="M16 18h16v5H16z" fill={C.grey} strokeWidth={2} />
      <circle cx={24} cy={30} r={4} fill={C.ink} />
    </Svg>
  ),
  ruler: (
    <Svg>
      <path d="M4 32L32 4l12 12-28 28z" fill={C.violet} />
      <path d="M12 24l3 3M17 19l4 4M22 14l3 3M27 9l4 4" fill="none" strokeWidth={2} />
    </Svg>
  ),

  // ── Sky ──
  sun: (
    <Svg>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M24 3l3 7h-6z" fill={C.yellow} transform={`rotate(${angle} 24 24)`} />
      ))}
      <circle cx={24} cy={24} r={11} fill={C.orange} />
    </Svg>
  ),
  moon: (
    <Svg>
      <path
        d="M30 6c-11 2-18 12-15 23 3 9 13 14 22 11-7-3-12-10-11-18 0-6 2-11 4-16z"
        fill={C.violet}
      />
      <circle cx={35} cy={14} r={1.5} fill={C.yellow} stroke="none" />
      <circle cx={40} cy={24} r={1.2} fill={C.yellow} stroke="none" />
    </Svg>
  ),
  star: (
    <Svg>
      <path
        d="M24 5l5.6 12 13 1.4-9.8 8.8 2.8 12.8L24 33.5 12.4 40l2.8-12.8L5.4 18.4l13-1.4z"
        fill={C.yellow}
      />
    </Svg>
  ),
  rainbow: (
    <Svg>
      <path d="M5 34a19 19 0 0 1 38 0" fill="none" strokeWidth={13} />
      <path d="M5 34a19 19 0 0 1 38 0" fill="none" stroke={C.red} strokeWidth={9} />
      <path d="M10 34a14 14 0 0 1 28 0" fill="none" stroke={C.yellow} strokeWidth={4.5} />
      <path d="M14.5 34a9.5 9.5 0 0 1 19 0" fill="none" stroke={C.blue} strokeWidth={4} />
      <ellipse cx={8} cy={36} rx={7} ry={4} fill={C.white} />
      <ellipse cx={40} cy={36} rx={7} ry={4} fill={C.white} />
    </Svg>
  ),

  // ── Music ──
  tabla: (
    <Svg>
      <path d="M8 22c0 11 4 18 13 18s13-7 13-18z" fill={C.brown} />
      <ellipse cx={21} cy={22} rx={13} ry={5} fill={C.paper} />
      <ellipse cx={21} cy={22} rx={5} ry={2} fill={C.ink} />
      <path d="M30 14h11v22c0 2-2 4-5 4s-6-2-6-4z" fill={C.orange} />
      <ellipse cx={35.5} cy={14} rx={5.5} ry={2.5} fill={C.paper} />
    </Svg>
  ),
  guitar: (
    <Svg>
      <path d="M31 6l6 6-12 12" fill="none" strokeWidth={5} />
      <path d="M31 6l6 6-12 12" fill="none" stroke={C.brown} strokeWidth={2} />
      <path
        d="M22 20c-3-3-9-2-11 2-1 2-1 4 0 5-4 1-6 6-3 10 3 4 9 4 11 0 1 1 3 1 5 0 4-2 5-8 2-11 2-2 1-4-4-6z"
        fill={C.pink}
      />
      <circle cx={19} cy={30} r={3} fill={C.ink} />
      <path d="M35 6l3-3M39 10l3-3" fill="none" />
    </Svg>
  ),
  flute: (
    <Svg>
      <path d="M5 38L37 6l5 5-32 32z" fill={C.lime} />
      <Dot x={16} y={32} r={1.6} />
      <Dot x={21} y={27} r={1.6} />
      <Dot x={26} y={22} r={1.6} />
      <Dot x={31} y={17} r={1.6} />
      <path d="M33 10l5 5" fill="none" />
    </Svg>
  ),
  trumpet: (
    <Svg>
      <path d="M6 24h22" fill="none" strokeWidth={5} />
      <path d="M6 24h22" fill="none" stroke={C.yellow} strokeWidth={2} />
      <path d="M28 21l14-9v24l-14-9z" fill={C.yellow} />
      <path d="M12 24v-6M17 24v-6M22 24v-6" fill="none" />
      <rect x={10} y={24} width={14} height={8} rx={4} fill="none" />
      <path d="M4 22v4" fill="none" />
    </Svg>
  ),

  // ── Childhood toys ──
  kite: (
    <Svg>
      <path d="M24 4l14 16-14 16-14-16z" fill={C.pink} />
      <path d="M24 4v32M10 20h28" fill="none" strokeWidth={1.8} />
      <path d="M24 36c-3 3 3 5 0 8" fill="none" />
      <path d="M21 39l3 1-1 3zM27 41l-3 1 1-3z" fill={C.yellow} strokeWidth={1.5} />
    </Svg>
  ),
  'spinning-top': (
    <Svg>
      <path d="M24 6v6" fill="none" />
      <path d="M8 18c0-4 7-6 16-6s16 2 16 6c0 9-8 16-16 25-8-9-16-16-16-25z" fill={C.orange} />
      <path
        d="M9 22c5 2 25 2 30 0M12 28c5 2 19 2 24 0"
        fill="none"
        stroke={C.yellow}
        strokeWidth={2.5}
      />
    </Svg>
  ),
  marbles: (
    <Svg>
      <circle cx={16} cy={30} r={9} fill={C.cyan} />
      <path d="M11 30c2-4 7-4 9-1" fill="none" stroke={C.white} strokeWidth={2} />
      <circle cx={33} cy={33} r={7} fill={C.blue} />
      <path d="M29 33c2-3 6-3 7 0" fill="none" stroke={C.yellow} strokeWidth={2} />
      <circle cx={28} cy={15} r={7} fill={C.green} />
      <path d="M24 15c2-3 6-3 7 0" fill="none" stroke={C.white} strokeWidth={2} />
    </Svg>
  ),
  'yo-yo': (
    <Svg>
      <path d="M24 4v14" fill="none" strokeWidth={2} />
      <path d="M22 4c2-2 4-2 4 0" fill="none" />
      <circle cx={24} cy={30} r={14} fill={C.violet} />
      <circle cx={24} cy={30} r={6} fill={C.yellow} />
      <Dot x={24} y={30} r={1.6} />
    </Svg>
  ),

  // ── Ocean ──
  fish: (
    <Svg>
      <path d="M6 24c6-9 18-11 27-4l9-7v22l-9-7c-9 7-21 5-27-4z" fill={C.orange} />
      <path d="M20 16c2 3 2 13 0 16" fill="none" strokeWidth={2} />
      <Dot x={13} y={22} />
    </Svg>
  ),
  crab: (
    <Svg>
      <path
        d="M10 18c-4-2-6-7-3-10 2 3 5 3 7 1 1 3 0 7-4 9zM38 18c4-2 6-7 3-10-2 3-5 3-7 1-1 3 0 7 4 9z"
        fill={C.red}
      />
      <path d="M8 30l-4 4M9 35l-3 5M40 30l4 4M39 35l3 5" fill="none" />
      <ellipse cx={24} cy={30} rx={15} ry={10} fill={C.red} />
      <path d="M20 20v-5M28 20v-5" fill="none" />
      <circle cx={20} cy={14} r={2.5} fill={C.white} />
      <circle cx={28} cy={14} r={2.5} fill={C.white} />
      <path d="M20 33c2 2 6 2 8 0" fill="none" />
    </Svg>
  ),
  octopus: (
    <Svg>
      <path
        d="M11 30c-2 5-6 6-7 10M17 32c-1 5-3 8-2 11M24 33v11M31 32c1 5 3 8 2 11M37 30c2 5 6 6 7 10"
        fill="none"
        strokeWidth={5}
      />
      <path
        d="M11 30c-2 5-6 6-7 10M17 32c-1 5-3 8-2 11M24 33v11M31 32c1 5 3 8 2 11M37 30c2 5 6 6 7 10"
        fill="none"
        stroke={C.violet}
        strokeWidth={2}
      />
      <path d="M10 22c0-10 6-16 14-16s14 6 14 16c0 7-6 11-14 11s-14-4-14-11z" fill={C.violet} />
      <Dot x={19} y={21} />
      <Dot x={29} y={21} />
      <path d="M21 27c2 1.5 4 1.5 6 0" fill="none" />
    </Svg>
  ),
  whale: (
    <Svg>
      <path
        d="M6 28c0-8 8-12 18-12 9 0 14 5 16 10l4-5 1 9-4 7c-3 4-9 5-17 5-11 0-18-6-18-14z"
        fill={C.cyan}
      />
      <path d="M8 31c6 4 20 5 30-1" fill="none" strokeWidth={2} />
      <Dot x={15} y={25} />
      <path
        d="M22 13c0-4-3-5-5-6M22 13c0-4 3-5 5-6M22 13V8"
        fill="none"
        stroke={C.blue}
        strokeWidth={2.5}
      />
    </Svg>
  ),
};

export function hasItemIcon(itemId: string): boolean {
  return itemId in DRAWINGS;
}

/** The drawing for an item. Decorative: always paired with the item's label. */
export function ItemIcon({ item, size = 40 }: { item: string; size?: number }) {
  return (
    <svg
      className="sp-icon"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      {DRAWINGS[item] ?? (
        <circle cx={24} cy={24} r={14} fill={C.grey} stroke={OUT} strokeWidth={2.5} />
      )}
    </svg>
  );
}
