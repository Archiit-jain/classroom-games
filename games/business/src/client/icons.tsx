import type { CornerId, Deck, IndustryId } from '../shared';

const OUT = '#07041a';

/** Game icon: a gold coin on a loop of road. */
export function BusinessIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect
        x={9}
        y={3}
        width={30}
        height={42}
        rx={9}
        fill="#3d2c7a"
        stroke={OUT}
        strokeWidth={2.5}
      />
      <rect
        x={15}
        y={9}
        width={18}
        height={30}
        rx={5}
        fill="#fdf6e3"
        stroke={OUT}
        strokeWidth={2}
      />
      <path d="M12 12v24M36 12v24" stroke="#ffd23f" strokeWidth={1.6} strokeDasharray="3 3" />
      <circle cx={24} cy={24} r={8} fill="#ffd23f" stroke={OUT} strokeWidth={2.2} />
      <path d="M24 19.5v9M21 22h6" stroke={OUT} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** Our coin (never the ₹ sign). */
export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx={12} cy={12} r={10} fill="#ffd23f" stroke={OUT} strokeWidth={2} />
      <circle cx={12} cy={12} r={6} fill="none" stroke="#c99400" strokeWidth={1.6} />
      <path d="M12 9v6M10 11h4" stroke={OUT} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

const glyph = (d: string, size: number, fill = 'none') => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill={fill}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const INDUSTRY: Record<IndustryId, string> = {
  // A tea leaf with its vein
  tea: 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14Zm0 0 9-9',
  // A thread spool
  textile: 'M7 4h10M7 20h10M8 4v16M16 4v16M8 8l8 2M8 12l8 2M8 16l8 2',
  // A film clapper
  film: 'M4 9h16v10H4V9Zm0 0 2-4 14-1 0 4M9 5l2 4M14 4l2 4',
};
export const IndustryIcon = ({ id, size = 20 }: { id: IndustryId; size?: number }) =>
  glyph(INDUSTRY[id], size);

const CORNER: Record<CornerId, string> = {
  // A flag on a pole
  start: 'M6 21V4M6 4h11l-2 4 2 4H6',
  // A chai glass with steam
  chai: 'M6 9h10l-1.5 11h-7L6 9Zm10 2h2a2 2 0 0 1 0 4h-2.5M9 3c0 2 2 2 2 4M13 3c0 2 2 2 2 4',
  // A traffic cone
  jam: 'M9 4h6l4 15H5L9 4Zm-1.5 6h9M6.5 15h11M3 20h18',
  // A giant wheel
  lucky: 'M12 12m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0M12 5v14M5 12h14M7 7l10 10M17 7 7 17M9 21h6',
};
export const CornerIcon = ({ id, size = 22 }: { id: CornerId; size?: number }) =>
  glyph(CORNER[id], size);

const DECK: Record<Deck, string> = {
  // A folded newspaper
  news: 'M4 6h13v13H6a2 2 0 0 1-2-2V6Zm13 3h3v8a2 2 0 0 1-2 2M7 9h7M7 12h7M7 15h4',
  // Bunting flags
  mela: 'M3 6c6 3 12 3 18 0M5 7l1.5 5L8 7.6M10.5 8.3 12 13l1.5-4.7M16 7.6l1.5 4.4L19 7',
};
export const DeckIcon = ({ deck, size = 20 }: { deck: Deck; size?: number }) =>
  glyph(DECK[deck], size);

/** The six tokens (seat order): auto-rickshaw, scooter, bicycle, kite, cricket bat, chai cup. */
const TOKENS = [
  'M4 16V9a4 4 0 0 1 4-4h6l5 6v5H4Zm3 0a2 2 0 1 0 4 0m4 0a2 2 0 1 0 4 0M14 5v6h5',
  'M6 17a2.5 2.5 0 1 0 0-.1M18 17a2.5 2.5 0 1 0 0-.1M8 17h7l2-6h-4M13 11 11 6H8',
  'M6 17a3 3 0 1 0 0-.1M18 17a3 3 0 1 0 0-.1M6 17l4-7h6l2 7M10 10 9 7H7m9 3-1-4h3',
  'M12 3 19 11 12 19 5 11 12 3Zm0 0v16M5 11h14M12 19c-1 2 1 3 0 4',
  'M17 3l4 4-9 9-4-4 9-9ZM8 12l-4 4 2 2 4-4M5 21a1.5 1.5 0 1 0 0-.1',
  'M6 9h10l-1.5 11h-7L6 9Zm10 2h2a2 2 0 0 1 0 4h-2.5',
] as const;
export const TokenIcon = ({ seat, size = 16 }: { seat: number; size?: number }) =>
  glyph(TOKENS[seat % TOKENS.length] as string, size);

/** A stall → mall building for the development level (1–4). */
const BUILDINGS = [
  'M4 20V11l8-5 8 5v9M4 11h16M9 20v-5h6v5', // stall (awning)
  'M5 20V9h14v11M5 9l2-4h10l2 4M9 20v-5h6v5M8 12h2M14 12h2', // shop
  'M4 20V7h16v13M4 7l8-3 8 3M7 10h10v4H7zM9 20v-3h6v3', // showroom
  'M3 20V6h18v14M3 6l3-3h12l3 3M6 9h3v3H6zM10.5 9h3v3h-3zM15 9h3v3h-3zM6 14h3v3H6zM15 14h3v3h-3zM10.5 20v-6h3v6', // mall
] as const;
export const BuildingIcon = ({ level, size = 18 }: { level: number; size?: number }) =>
  glyph(BUILDINGS[Math.max(0, Math.min(3, level - 1))] as string, size);
