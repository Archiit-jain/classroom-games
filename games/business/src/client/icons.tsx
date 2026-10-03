import type { CornerId, TransportId } from '../shared';

/** Line glyph helper: 24 × 24, stroked with currentColor. */
const Glyph = ({ d, size, title }: { d: string; size: number; title?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden={title ? undefined : true}
    role={title ? 'img' : undefined}
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {title && <title>{title}</title>}
    <path d={d} />
  </svg>
);

/** Each city's own small mark — original line drawings, no landmarks' trade dress. */
const CITY: Record<string, string> = {
  // East
  patna: 'M4 20h16M6 20a6 6 0 0 1 12 0M12 8V5M10 5h4', // a dome granary
  ranchi: 'M4 5h16M7 5c0 6 1 10 0 15M12 5v15M17 5c0 6-1 10 0 15M4 20h16', // falls
  bhubaneswar: 'M3 20h18M6 20c0-5 1-9 3-11M12 20V7M18 20c0-5-1-9-3-11', // rice field
  guwahati: 'M2 18c4-3 6 3 10 0s6 3 10 0M4 14l4-6 3 4 3-5 6 7', // river and hills
  kolkata: 'M5 7h14v9H5zM5 11h14M8 16l-2 4M16 16l2 4M12 3v4M9 3h6', // a tram
  // South
  kochi: 'M3 20h18M6 20 12 7l6 13M12 7 4 11M12 7l8 4M8 15h8', // fishing net
  thiruvananthapuram:
    'M8 21V10M8 10C6 7 3 7 2 9M8 10c2-3 5-3 6-1M14 17c2 1 5 1 7 0M14 20c2 1 5 1 7 0', // palm and waves
  visakhapatnam: 'M3 15h18l-3 5H6zM7 15V9h8v6M10 9V5h3', // a ship
  chennai: 'M10 21l1-14h2l1 14zM9 7h6M12 3v4M7 5 4 4M17 5l3-1', // a lighthouse
  hyderabad: 'M4 21V7M20 21V7M4 12h16M8 21v-5a4 4 0 0 1 8 0v5M3 7h2M19 7h2', // twin towers and arch
  bengaluru: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4', // a chip
  // West
  goa: 'M12 20V9M12 9C9 6 5 7 4 9M12 9c3-3 7-2 8 0M12 9c-1-4-4-5-6-5M3 19c3 2 15 2 18 0', // palm and boat
  surat: 'M6 4h12l4 5-10 12L2 9zM2 9h20M9 4l3 17 3-17', // a diamond
  pune: 'M3 20h18M5 20v-8l3-2V7h3v3l2 1 2-1V7h3v3l3 2v8', // a hill fort
  ahmedabad: 'M12 3l7 9-7 9-7-9zM12 3v18M5 12h14M12 21c1 1 1 2 0 3', // a kite
  mumbai: 'M2 19h20M7 19V5l-5 14M7 5l5 14M17 19V8l-4 11M17 8l4 11', // a sea link
  // North
  jammu: 'M2 20 9 8l4 6 3-4 6 10z', // mountains
  dehradun: 'M7 20l4-9 4 9zM13 20l4-12 4 12zM3 20h18', // pines
  lucknow: 'M5 21V11h14v10M9 21v-6a3 3 0 0 1 6 0v6M7 11a5 5 0 0 1 10 0', // an arched gate
  jaipur: 'M4 21V6h16v15M4 10h16M8 10v11M12 10v11M16 10v11M4 6l8-3 8 3', // a latticed façade
  chandigarh: 'M5 21V7h14v14M5 11h14M5 15h14M9 7v14M15 7v14', // a planned grid
  delhi: 'M4 20V9h16v11M8 20v-7a4 4 0 0 1 8 0v7M3 9h18M6 6h12', // a grand arch
};
export const CityIcon = ({ id, size = 18 }: { id: string; size?: number }) => (
  <Glyph d={CITY[id] ?? 'M4 20h16'} size={size} />
);

const TRANSPORT: Record<TransportId, string> = {
  railways: 'M6 3h12v12H6zM6 9h12M9 15l-3 5M15 15l3 5M8 18h8M9 12h.01M15 12h.01',
  roadways: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1',
  waterways: 'M3 15h18l-3 5H6zM8 15V7l8 8M8 7h3M2 21c3 1 17 1 20 0',
  airways: 'M3 13l8-2 4-7h2l-2 7 6 1 1 2-7 1-2 6h-2l1-6-8-1z',
  petroleum: 'M7 4h10v16H7zM7 9h10M7 15h10M12 2v2M10 20v2M14 20v2',
  satellite: 'M4 18a8 8 0 0 0 8-8M4 14a4 4 0 0 0 4-4M13 3l8 8-3 3-8-8zM17 13l3 3M3 21l2-2',
};
export const TransportIcon = ({ id, size = 20 }: { id: TransportId; size?: number }) => (
  <Glyph d={TRANSPORT[id]} size={size} />
);

const CORNER: Record<CornerId, string> = {
  start: 'M3 12h14M12 6l6 6-6 6M21 4v16',
  jail: 'M5 3v18M10 3v18M14 3v18M19 3v18M3 3h18M3 21h18M3 12h18',
  club: 'M6 3h6l-3 7zM9 10v7M6 17h6M15 6h5v4a2.5 2.5 0 0 1-5 0zM17.5 12.5V17M15 17h5',
  resort: 'M12 4a8 8 0 0 1 8 7H4a8 8 0 0 1 8-7zM12 11v8M3 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0',
};
export const CornerIcon = ({ id, size = 28 }: { id: CornerId; size?: number }) => (
  <Glyph d={CORNER[id]} size={size} />
);

export const DeckIcon = ({ deck, size = 20 }: { deck: 'chance' | 'chest'; size?: number }) => (
  <Glyph
    d={
      deck === 'chance'
        ? 'M9 9a3 3 0 1 1 4 2.8c-.7.4-1 1-1 1.7V15M12 18h.01M4 3h16v18H4z'
        : 'M3 9h18v11H3zM3 9l2-5h14l2 5M10 13h4M12 9v4'
    }
    size={size}
  />
);

/** Six distinct board-game tokens (by seat), each in its player colour with light and shadow. */
const TOKEN_SHAPES = [
  // pawn
  'M16 6a5 5 0 1 1-.01 0zM12 15h8l2 7h-12zM8 24h16v4H8z',
  // tower
  'M10 4h3v3h2V4h2v3h2V4h3v7l-2 2v9h-10v-9l-2-2zM8 24h16v4H8z',
  // cone hat
  'M16 3l7 19H9zM7 24h18v4H7z',
  // gem
  'M10 5h12l5 6-11 13L5 11zM8 24h16v4H8z',
  // lantern
  'M14 3h4v3h-4zM11 6h10l2 14H9zM10 22h12v2H10zM8 25h16v3H8z',
  // ship's wheel-top
  'M16 4a6 6 0 1 1-.01 0zM16 7v6M13 10h6M13 16h6l2 6H11zM8 24h16v4H8z',
] as const;
export function Token({
  seat,
  color,
  size = 30,
  you = false,
}: {
  seat: number;
  color: string;
  size?: number;
  you?: boolean;
}) {
  const id = `tok${seat}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className="bz-token-svg"
    >
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="25%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="35%" stopColor={color} />
          <stop offset="100%" stopColor="#1a1030" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="29.5" rx="9" ry="2" fill="rgba(0,0,0,0.35)" />
      <path
        d={TOKEN_SHAPES[seat % TOKEN_SHAPES.length]}
        fill={`url(#${id}-g)`}
        stroke="#140b2b"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {you && <circle cx="26" cy="6" r="4" fill="#fff" stroke="#140b2b" strokeWidth={1} />}
    </svg>
  );
}

/** An isometric house (green roof) — up to three sit on a city's band. */
export const House = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    aria-hidden="true"
    focusable="false"
    className="bz-house"
  >
    <path d="M3 10l7-4 7 4v6l-7 3-7-3z" fill="#f6f1e4" stroke="#1f1633" strokeWidth={1} />
    <path d="M10 6v13M3 10l7 3 7-3" fill="none" stroke="#1f1633" strokeWidth={0.8} opacity={0.5} />
    <path d="M2 10l8-6 8 6-8 3.5z" fill="#2fbf71" stroke="#1f1633" strokeWidth={1} />
    <path d="M10 4v9.5" stroke="#1d8f52" strokeWidth={1} />
    <path d="M6 14.5v-2.5l2 .9v2.5z" fill="#7a4a2a" />
  </svg>
);

/** The hotel (red block with a sign) that replaces three houses. */
export const Hotel = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    className="bz-hotel"
  >
    <path d="M3 9l9-4 9 4v9l-9 4-9-4z" fill="#e8445a" stroke="#1f1633" strokeWidth={1} />
    <path d="M12 5v17M3 9l9 4 9-4" fill="none" stroke="#1f1633" strokeWidth={0.9} opacity={0.6} />
    <path
      d="M5 12l2 .9M5 15l2 .9M15.5 13l2-.9M15.5 16l2-.9M19 12l-1 .4"
      stroke="#ffe6a3"
      strokeWidth={1.4}
    />
    <path d="M8 3h8v3H8z" fill="#ffd23f" stroke="#1f1633" strokeWidth={0.8} />
  </svg>
);

/** A ₹ chip used in money animations. */
export const RupeeChip = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" fill="#ffd23f" stroke="#7a5a00" strokeWidth={1.5} />
    <circle cx="12" cy="12" r="7" fill="none" stroke="#c99400" strokeWidth={1} />
    <path
      d="M8.5 7.5h7M8.5 10.5h7M9.5 7.5c4 0 4 6 0 6h-1l5 4"
      fill="none"
      stroke="#5a3d00"
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  </svg>
);

/** Game icon: a square board corner with a token. */
export function BusinessIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect
        x={4}
        y={4}
        width={40}
        height={40}
        rx={6}
        fill="#f7ecd2"
        stroke="#07041a"
        strokeWidth={2.5}
      />
      <rect
        x={12}
        y={12}
        width={24}
        height={24}
        rx={3}
        fill="#1e7d6b"
        stroke="#07041a"
        strokeWidth={2}
      />
      <path
        d="M4 12h8M4 20h8M4 28h8M4 36h8M12 44v-8M20 44v-8M28 44v-8M36 44v-8"
        stroke="#07041a"
        strokeWidth={1.5}
      />
      <path d="M4 4h8v8H4z" fill="#ff8a1f" stroke="#07041a" strokeWidth={1.5} />
      <circle cx={24} cy={24} r={6} fill="#ffd23f" stroke="#07041a" strokeWidth={2} />
      <path
        d="M21.5 22h5M21.5 24h5M22.5 22c2.5 0 2.5 4 0 4l3 2"
        fill="none"
        stroke="#07041a"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
